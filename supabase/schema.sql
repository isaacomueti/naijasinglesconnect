-- =====================================================================
-- NaijaSinglesConnect: database, security rules and storage
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- It is safe to run again: it drops and recreates policies and functions.
-- =====================================================================

create extension if not exists pgcrypto;

-- Helper functions live in a schema the API does not expose, so they can be
-- used by security rules but never called directly by a visitor.
create schema if not exists private;
grant usage on schema private to authenticated, anon;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Private account data: only the member and admins can read it.
create table if not exists public.members (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  phone         text not null default '',
  status        text not null default 'draft'
                check (status in ('draft','pending','changes','approved','rejected','suspended')),
  admin_note    text not null default '',
  submitted_at  timestamptz,
  approved_at   timestamptz,
  blocked       uuid[] not null default '{}',
  payment       jsonb not null default jsonb_build_object('status','none','ref','','file',null,'uploadedAt',null),
  created_at    timestamptz not null default now()
);

-- Profile answers. Other members never read this table directly;
-- they get a privacy-masked copy through match_profiles() below.
create table if not exists public.profiles (
  id          uuid primary key references public.members(id) on delete cascade,
  profile     jsonb not null default '{}'::jsonb,
  privacy     text not null default 'full' check (privacy in ('full','nophoto','name')),
  updated_at  timestamptz not null default now()
);

-- Private Circle (members living with HIV). Kept in its own table so the
-- flag is never part of a profile row anyone else can read.
create table if not exists public.circle_members (
  member_id   uuid primary key references public.members(id) on delete cascade,
  consented_at timestamptz not null default now()
);

create table if not exists public.intros (
  id            uuid primary key default gen_random_uuid(),
  from_id       uuid not null references public.members(id) on delete cascade,
  to_id         uuid not null references public.members(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted','declined')),
  note          text not null default '',
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (from_id <> to_id)
);
create index if not exists intros_from_idx on public.intros(from_id);
create index if not exists intros_to_idx on public.intros(to_id);

-- thread = an intro id, or 'support:<member id>'
-- from_id = a member id, 'admin' or 'system'
create table if not exists public.messages (
  id       uuid primary key default gen_random_uuid(),
  thread   text not null,
  from_id  text not null,
  body     text not null check (char_length(body) between 1 and 2000),
  at       timestamptz not null default now()
);
create index if not exists messages_thread_idx on public.messages(thread, at);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  by_id       uuid not null references public.members(id) on delete cascade,
  about_id    uuid not null references public.members(id) on delete cascade,
  thread      text,
  reason      text not null,
  details     text not null default '',
  status      text not null default 'open' check (status in ('open','resolved')),
  action      text,
  at          timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.activity (
  id    bigint generated always as identity primary key,
  at    timestamptz not null default now(),
  text  text not null
);

-- last time a reader opened a thread (reader = member id or 'admin')
create table if not exists public.reads (
  reader  text not null,
  thread  text not null,
  at      timestamptz not null default now(),
  primary key (reader, thread)
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Membership: plan bought, when it runs out, and months paid for before approval
-- (they start counting on the day the profile is approved).
alter table public.members add column if not exists plan text check (plan in ('gold','platinum'));
alter table public.members add column if not exists paid_until timestamptz;
alter table public.members add column if not exists credit_months int not null default 0;
-- quiet messages (broadcasts) never trigger an email
alter table public.messages add column if not exists quiet boolean not null default false;

-- One row per bank transfer receipt. The amount is set by the database from the plan prices.
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members(id) on delete cascade,
  plan         text not null check (plan in ('gold','platinum')),
  months       int  not null check (months in (1,3,12)),
  amount       int  not null default 0,
  ref          text not null default '',
  file         jsonb,
  status       text not null default 'uploaded' check (status in ('uploaded','confirmed','rejected')),
  note         text not null default '',
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists payments_member_idx on public.payments(member_id, created_at);

-- ---------------------------------------------------------------------
-- Helper functions (security definer so policies can use them safely)
-- ---------------------------------------------------------------------
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function private.is_approved(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = uid and status = 'approved');
$$;

-- approved and inside a paid membership period
create or replace function private.is_active(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = uid and status = 'approved' and paid_until > now());
$$;

create or replace function private.in_circle(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.circle_members where member_id = uid);
$$;

-- nationality group used for cross-border matching
create or replace function private.nat_group(p jsonb) returns text
language sql immutable as $$
  select case when coalesce(p->>'nationality','Nigeria') in ('','Nigeria') or p->>'heritage' = 'Yes'
              then 'nigerian' else 'international' end;
$$;

-- can members a and b ever see each other?
create or replace function private.eligible(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a <> b
     and private.is_active(a) and private.is_active(b)
     and private.in_circle(a) = private.in_circle(b)
     and exists (
       select 1 from public.profiles pa, public.profiles pb
       where pa.id = a and pb.id = b
         and (coalesce(pa.profile->>'openTo','both') in ('both', private.nat_group(pb.profile)))
         and (coalesce(pb.profile->>'openTo','both') in ('both', private.nat_group(pa.profile)))
     )
     and not exists (select 1 from public.members m where m.id = a and b = any(m.blocked))
     and not exists (select 1 from public.members m where m.id = b and a = any(m.blocked));
$$;

create or replace function private.connected(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.intros
                 where status = 'accepted' and ((from_id = a and to_id = b) or (from_id = b and to_id = a)));
$$;

-- Profiles another member is allowed to see, with privacy applied:
-- last name, place of worship and the circle flag are never shared;
-- photos and first name follow the member's privacy setting until an
-- introduction is accepted.
create or replace function public.match_profiles()
returns table (id uuid, profile jsonb, privacy text, circle boolean, connected boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query
  select p.id,
         case when private.connected(me, p.id) then (p.profile - 'last' - 'circle')
              else (p.profile - 'last' - 'circle' - 'worship')
                   || case when p.privacy = 'full' then '{}'::jsonb else jsonb_build_object('photos','[]'::jsonb,'hiddenPhotos', jsonb_array_length(coalesce(p.profile->'photos','[]'::jsonb)) > 0) end
                   || case when p.privacy = 'name' then jsonb_build_object('first', upper(left(coalesce(p.profile->>'first','?'),1)) || '.') else '{}'::jsonb end
         end,
         p.privacy,
         private.in_circle(p.id) and private.in_circle(me),
         private.connected(me, p.id)
  from public.profiles p
  where p.id <> me
    and (private.eligible(me, p.id)
         or exists (select 1 from public.intros i where (i.from_id = me and i.to_id = p.id) or (i.to_id = me and i.from_id = p.id)));
end $$;

-- Members cannot approve themselves, confirm their own payment or edit admin notes.
create or replace function private.guard_member_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if private.is_admin() then return new; end if;
  if new.status <> old.status and not (old.status in ('draft','changes','rejected') and new.status = 'pending') then
    raise exception 'Only the NSC team can change your status';
  end if;
  if new.admin_note is distinct from old.admin_note or new.approved_at is distinct from old.approved_at or new.email <> old.email
     or new.plan is distinct from old.plan or new.paid_until is distinct from old.paid_until or new.credit_months <> old.credit_months then
    raise exception 'That field can only be changed by the NSC team';
  end if;
  if (new.payment->>'status') = 'confirmed' and (old.payment->>'status') is distinct from 'confirmed' then
    raise exception 'Only the NSC team can confirm a payment';
  end if;
  if (old.payment->>'status') = 'confirmed' and new.payment is distinct from old.payment then
    raise exception 'A confirmed payment cannot be changed';
  end if;
  new.payment := jsonb_set(new.payment, '{ref}', to_jsonb(coalesce(old.payment->>'ref','')));
  return new;
end $$;
drop trigger if exists guard_member_update on public.members;
create trigger guard_member_update before update on public.members
  for each row execute function private.guard_member_update();

-- Intro rules: only the recipient answers; requests only between eligible members.
create or replace function private.guard_intro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not private.is_admin() and not private.eligible(new.from_id, new.to_id) then
      raise exception 'You can only request introductions to your matches';
    end if;
    -- Gold includes a set number of requests every 30 days; Platinum is unlimited
    if not private.is_admin() and (select plan from public.members where id = new.from_id) = 'gold'
       and (select count(*) from public.intros where from_id = new.from_id and created_at > now() - interval '30 days')
           >= coalesce((select (data->>'goldIntroLimit')::int from public.settings where id = 1), 5) then
      raise exception 'You have used this month''s introduction requests on Gold. Upgrade to Platinum for unlimited requests.';
    end if;
    new.status := 'pending';
    return new;
  end if;
  if not private.is_admin() and auth.uid() <> old.to_id then
    raise exception 'Only the person who received this request can answer it';
  end if;
  if new.status = 'accepted' and old.status <> 'accepted' and not private.is_admin() and not private.is_active(auth.uid()) then
    raise exception 'Renew your membership to accept introductions';
  end if;
  if new.status = 'accepted' and old.status <> 'accepted' then
    insert into public.messages(thread, from_id, body)
    values (new.id::text, 'system', 'You are now introduced. Be kind, take your time, and keep conversations on NSC until you are comfortable.');
  end if;
  return new;
end $$;
drop trigger if exists guard_intro on public.intros;
create trigger guard_intro before insert or update on public.intros
  for each row execute function private.guard_intro();

-- New sign-ups get a member row, a profile row, a payment reference and a welcome message.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.members(id, email, phone, payment)
  values (new.id, lower(new.email), coalesce(meta->>'phone',''),
          jsonb_build_object('status','none','ref','NSC-' || upper(substr(replace(new.id::text,'-',''),1,6)),'file',null,'uploadedAt',null))
  on conflict (id) do nothing;
  insert into public.profiles(id, profile)
  values (new.id, jsonb_build_object('first', coalesce(meta->>'first',''), 'last', coalesce(meta->>'last',''),
                                     'nationality', coalesce(meta->>'nationality',''), 'openTo','both', 'dealbreakers','[]'::jsonb, 'photos','[]'::jsonb))
  on conflict (id) do nothing;
  insert into public.messages(thread, from_id, body)
  values ('support:' || new.id, 'admin',
          'Welcome to NaijaSinglesConnect' || coalesce(', ' || nullif(meta->>'first',''), '') ||
          '. Complete your profile and upload your payment receipt, and our team will review you, usually within 24 hours. Reply here any time if you need help.');
  insert into public.activity(text) values (trim(coalesce(meta->>'first','') || ' ' || coalesce(meta->>'last','')) || ' created an account');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

grant execute on all functions in schema private to authenticated, anon;
revoke execute on function public.match_profiles() from anon, public;
grant execute on function public.match_profiles() to authenticated;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.members        enable row level security;
alter table public.profiles       enable row level security;
alter table public.circle_members enable row level security;
alter table public.intros         enable row level security;
alter table public.messages       enable row level security;
alter table public.reports        enable row level security;
alter table public.activity       enable row level security;
alter table public.reads          enable row level security;
alter table public.admins         enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in
    ('members','profiles','circle_members','intros','messages','reports','activity','reads','admins')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

create policy "members: self or admin read"   on public.members for select using (id = auth.uid() or private.is_admin());
create policy "members: self or admin update" on public.members for update using (id = auth.uid() or private.is_admin());

create policy "profiles: self or admin read"   on public.profiles for select using (id = auth.uid() or private.is_admin());
create policy "profiles: self or admin update" on public.profiles for update using (id = auth.uid() or private.is_admin());

create policy "circle: own row or admin"  on public.circle_members for select using (member_id = auth.uid() or private.is_admin());
create policy "circle: join yourself"     on public.circle_members for insert with check (member_id = auth.uid());
create policy "circle: leave yourself"    on public.circle_members for delete using (member_id = auth.uid() or private.is_admin());

create policy "intros: parties or admin read" on public.intros for select using (auth.uid() in (from_id, to_id) or private.is_admin());
create policy "intros: request as yourself"   on public.intros for insert with check (from_id = auth.uid());
create policy "intros: answer"                on public.intros for update using (auth.uid() = to_id or private.is_admin());

create policy "messages: read your threads" on public.messages for select using (
  private.is_admin()
  or thread = 'support:' || auth.uid()
  or exists (select 1 from public.intros i where i.id::text = messages.thread and i.status = 'accepted' and auth.uid() in (i.from_id, i.to_id))
);
create policy "messages: write your threads" on public.messages for insert with check (
  (from_id = 'admin' and private.is_admin())
  or (from_id = auth.uid()::text and (
        thread = 'support:' || auth.uid()
        or exists (select 1 from public.intros i where i.id::text = messages.thread and i.status = 'accepted' and auth.uid() in (i.from_id, i.to_id)
                   and private.is_active(auth.uid()))
  ))
);

create policy "reports: file as yourself" on public.reports for insert with check (by_id = auth.uid());
create policy "reports: admin read"       on public.reports for select using (private.is_admin());
create policy "reports: admin update"     on public.reports for update using (private.is_admin());

create policy "activity: signed-in write" on public.activity for insert with check (auth.uid() is not null);
create policy "activity: admin read"      on public.activity for select using (private.is_admin());

create policy "reads: own"       on public.reads for all using (reader = auth.uid()::text or (reader = 'admin' and private.is_admin()))
                                                with check (reader = auth.uid()::text or (reader = 'admin' and private.is_admin()));

create policy "admins: see yourself" on public.admins for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Live updates (chat, approvals, introductions)
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.intros;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.members;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.reports;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when others then null; end;
  begin alter publication supabase_realtime add table public.circle_members; exception when others then null; end;
  begin alter publication supabase_realtime add table public.payments; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Storage: profile photos (public, unguessable paths) and receipts (private)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880;

drop policy if exists "photos: upload own"  on storage.objects;
drop policy if exists "photos: delete own"  on storage.objects;
drop policy if exists "receipts: upload own" on storage.objects;
drop policy if exists "receipts: read own or admin" on storage.objects;
drop policy if exists "receipts: delete own" on storage.objects;

create policy "photos: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin()));
create policy "receipts: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Team tools for /admin: site settings, private team notes, managing the
-- team, and deleting an account on request (NDPA right to erasure).
-- ---------------------------------------------------------------------
alter table public.admins add column if not exists added_at timestamptz not null default now();

-- one row of site settings (fee, bank details); every signed-in member can read it
create table if not exists public.settings (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
insert into public.settings(id) values (1) on conflict (id) do nothing;

-- notes the team keeps about a member; members never see these
create table if not exists public.team_notes (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  by_email   text not null default '',
  at         timestamptz not null default now()
);
create index if not exists team_notes_member_idx on public.team_notes(member_id, at);

create or replace function private.stamp_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.by_email := coalesce((select email from auth.users where id = auth.uid()), '');
  new.at := now();
  return new;
end $$;
drop trigger if exists stamp_note on public.team_notes;
create trigger stamp_note before insert on public.team_notes
  for each row execute function private.stamp_note();

alter table public.settings   enable row level security;
alter table public.team_notes enable row level security;
drop policy if exists "settings: signed-in read" on public.settings;
drop policy if exists "settings: admin write"    on public.settings;
drop policy if exists "notes: admin only"        on public.team_notes;
create policy "settings: signed-in read" on public.settings for select to authenticated using (true);
create policy "settings: admin write"    on public.settings for update using (private.is_admin()) with check (private.is_admin());
create policy "notes: admin only"        on public.team_notes for all using (private.is_admin()) with check (private.is_admin());

create or replace function public.team_list()
returns table (user_id uuid, email text, added_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the NSC team can see this'; end if;
  return query select a.user_id, u.email::text, a.added_at
               from public.admins a join auth.users u on u.id = a.user_id order by a.added_at;
end $$;

create or replace function public.team_add(p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not private.is_admin() then raise exception 'Only the NSC team can add team members'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No NSC login uses that email yet. Ask them to create an account first, or add the user in Supabase.'; end if;
  insert into public.admins(user_id) values (uid) on conflict (user_id) do nothing;
  insert into public.activity(text) values (lower(trim(p_email)) || ' was added to the team');
  return uid;
end $$;

create or replace function public.team_remove(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the NSC team can remove team members'; end if;
  if p_user = auth.uid() then raise exception 'You can''t remove yourself. Ask another team member.'; end if;
  if (select count(*) from public.admins) <= 1 then raise exception 'The team needs at least one person'; end if;
  delete from public.admins where user_id = p_user;
  insert into public.activity(text) values ('A team member was removed');
end $$;

-- Permanently deletes a member and everything linked to them. Photos and
-- receipts are removed from storage by the admin page before this runs.
create or replace function public.admin_delete_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the NSC team can delete accounts'; end if;
  if exists (select 1 from public.admins where user_id = p_member) then raise exception 'Remove this person from the team first'; end if;
  delete from public.messages where thread = 'support:' || p_member::text or from_id = p_member::text
     or thread in (select id::text from public.intros where p_member in (from_id, to_id));
  delete from public.reads where reader = p_member::text or thread = 'support:' || p_member::text;
  delete from auth.users where id = p_member;
  insert into public.activity(text) values ('A member account was permanently deleted');
end $$;

revoke execute on function public.team_list() from anon, public;
revoke execute on function public.team_add(text) from anon, public;
revoke execute on function public.team_remove(uuid) from anon, public;
revoke execute on function public.admin_delete_member(uuid) from anon, public;
grant execute on function public.team_list(), public.team_add(text), public.team_remove(uuid), public.admin_delete_member(uuid) to authenticated;

-- the team can list and remove any member's photos and receipts (for deletion requests)
drop policy if exists "storage: team read"   on storage.objects;
drop policy if exists "storage: team delete" on storage.objects;
create policy "storage: team read"   on storage.objects for select to authenticated using (bucket_id in ('photos','receipts') and private.is_admin());
create policy "storage: team delete" on storage.objects for delete to authenticated using (bucket_id in ('photos','receipts') and private.is_admin());

-- ---------------------------------------------------------------------
-- Memberships and payments
-- Gold and Platinum, for 1, 3 or 12 months, priced per week (a month counts
-- as 4 weeks). Prices live in settings so the team can change them in /admin.
-- ---------------------------------------------------------------------
update public.settings set data = data || jsonb_build_object(
    'bank', 'Zenith Bank', 'accountName', 'Best of Nature Ventures', 'accountNumber', '1012169172',
    'parentCompany', 'Best of Nature Ventures', 'alertEmail', 'justlynnonme@yahoo.com', 'goldIntroLimit', 5,
    'plans', jsonb_build_object('gold',     jsonb_build_object('1', 1500, '3', 1000, '12', 500),
                                'platinum', jsonb_build_object('1', 2250, '3', 1500, '12', 750)))
  where id = 1 and not (data ? 'plans');

create or replace function private.plan_price(p_plan text, p_months int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (data->'plans'->p_plan->>p_months::text)::int from public.settings where id = 1),
                  case p_plan when 'platinum' then case p_months when 12 then 750 when 3 then 1500 else 2250 end
                              else case p_months when 12 then 500 when 3 then 1000 else 1500 end end) * p_months * 4;
$$;

-- Members can only file a receipt for themselves, at the listed price, one at a time.
-- A team decision on a receipt is final.
create or replace function private.payment_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not private.is_admin() then
      if new.member_id is distinct from auth.uid() then raise exception 'You can only pay for your own membership'; end if;
      if exists (select 1 from public.payments where member_id = new.member_id and status = 'uploaded') then
        raise exception 'Your last receipt is still being checked. Cancel it first to choose another plan.';
      end if;
      new.status := 'uploaded'; new.note := ''; new.reviewed_at := null;
      new.amount := private.plan_price(new.plan, new.months);
    elsif new.status <> 'uploaded' then
      new.reviewed_at := now();
    end if;
    new.ref := coalesce((select payment->>'ref' from public.members where id = new.member_id), '');
    new.created_at := now();
    return new;
  end if;
  if old.status <> 'uploaded' and new.status <> old.status then raise exception 'This payment has already been reviewed'; end if;
  if new.status <> old.status then new.reviewed_at := now(); end if;
  return new;
end $$;
drop trigger if exists payment_before on public.payments;
create trigger payment_before before insert or update on public.payments
  for each row execute function private.payment_before();

-- A confirmed payment extends the membership. Before approval the months are held
-- as credit and start on the day the profile is approved.
create or replace function private.payment_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.members; who text; first text;
begin
  select * into m from public.members where id = new.member_id;
  select coalesce(profile->>'first', '') into first from public.profiles where id = new.member_id;
  who := trim(first || ' ' || coalesce((select profile->>'last' from public.profiles where id = new.member_id), ''));
  if tg_op = 'INSERT' and new.status = 'uploaded' then
    insert into public.activity(text) values (coalesce(nullif(who, ''), m.email) || ' uploaded a receipt for ' || initcap(new.plan) || ', ' || new.months || ' months');
    perform private.notify('receipt', jsonb_build_object('to', private.alert_email(), 'name', coalesce(nullif(who, ''), m.email), 'email', m.email,
      'plan', new.plan, 'months', new.months, 'amount', new.amount, 'ref', new.ref));
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
    if m.status = 'approved' then
      update public.members set plan = new.plan,
        paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(months => new.months) where id = new.member_id;
    else
      update public.members set plan = new.plan, credit_months = credit_months + new.months where id = new.member_id;
    end if;
    perform private.notify('paid', jsonb_build_object('to', m.email, 'first', first, 'plan', new.plan, 'months', new.months, 'amount', new.amount,
      'until', (select paid_until from public.members where id = new.member_id), 'approved', m.status = 'approved'));
  end if;
  if tg_op = 'UPDATE' and new.status = 'rejected' and old.status <> 'rejected' then
    perform private.notify('receipt_rejected', jsonb_build_object('to', m.email, 'first', first, 'note', new.note));
  end if;
  return null;
end $$;
drop trigger if exists payment_after on public.payments;
create trigger payment_after after insert or update on public.payments
  for each row execute function private.payment_after();

-- months paid before approval start counting on approval day
create or replace function private.member_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.credit_months > 0 then
    new.paid_until := greatest(coalesce(new.paid_until, now()), now()) + make_interval(months => new.credit_months);
    new.credit_months := 0;
  end if;
  return new;
end $$;
drop trigger if exists member_membership on public.members;
create trigger member_membership before update on public.members
  for each row execute function private.member_membership();

alter table public.payments enable row level security;
drop policy if exists "payments: own or team read"   on public.payments;
drop policy if exists "payments: add own or team"    on public.payments;
drop policy if exists "payments: team review"        on public.payments;
drop policy if exists "payments: cancel own pending" on public.payments;
create policy "payments: own or team read"   on public.payments for select using (member_id = auth.uid() or private.is_admin());
create policy "payments: add own or team"    on public.payments for insert with check (member_id = auth.uid() or private.is_admin());
create policy "payments: team review"        on public.payments for update using (private.is_admin()) with check (private.is_admin());
create policy "payments: cancel own pending" on public.payments for delete using ((member_id = auth.uid() and status = 'uploaded') or private.is_admin());

-- ---------------------------------------------------------------------
-- Email notifications
-- The database posts each event to the "notify" Edge Function, which sends
-- the email through Resend. Copy the secret this creates into the function:
--   select value from private.config where key = 'notify_secret';
-- ---------------------------------------------------------------------
create extension if not exists pg_net;
create table if not exists private.config (key text primary key, value text not null);
-- no policies: only the database owner (and so private.notify) can read it
alter table private.config enable row level security;
revoke all on private.config from anon, authenticated;
insert into private.config values ('notify_url', 'https://mnojvwqrlagezgiirbpt.supabase.co/functions/v1/notify') on conflict (key) do nothing;
insert into private.config values ('notify_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;

create or replace function private.alert_email() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select data->>'alertEmail' from public.settings where id = 1), ''), 'justlynnonme@yahoo.com');
$$;

-- every email the database asks for, so the team can see in /admin whether it went out
create table if not exists private.email_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kind        text not null,
  recipient   text not null default '',
  request_id  bigint,
  error       text
);
alter table private.email_log enable row level security;
revoke all on private.email_log from anon, authenticated;

-- never lets an email problem stop the change that caused it
create or replace function private.notify(p_kind text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text; rid bigint; who text := coalesce(p->>'to', '');
begin
  select value into u from private.config where key = 'notify_url';
  select value into s from private.config where key = 'notify_secret';
  if who = '' or who = '[]' then return; end if;
  if u is null or s is null then
    insert into private.email_log(kind, recipient, error) values (p_kind, who, 'Email is not set up: notify_url or notify_secret is missing');
    return;
  end if;
  select net.http_post(url := u, body := jsonb_build_object('kind', p_kind) || p,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-nsc-secret', s)) into rid;
  insert into private.email_log(kind, recipient, request_id) values (p_kind, who, rid);
exception when others then
  begin insert into private.email_log(kind, recipient, error) values (p_kind, who, sqlerrm); exception when others then null; end;
  raise warning 'NSC email not sent (%): %', p_kind, sqlerrm;
end $$;

-- recent emails with the reply from the email function (pg_net keeps replies for about 6 hours)
create or replace function public.admin_email_log(p_limit int default 40)
returns table (at timestamptz, kind text, recipient text, status int, error text, reply text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the NSC team can see this'; end if;
  return query
  select l.at, l.kind, l.recipient, r.status_code, coalesce(l.error, r.error_msg), left(r.content::text, 300)
  from private.email_log l left join net._http_response r on r.id = l.request_id
  order by l.at desc limit greatest(1, least(p_limit, 200));
end $$;

-- sends a test email to the team alert address
create or replace function public.admin_test_email() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the NSC team can send a test email'; end if;
  perform private.notify('test', jsonb_build_object('to', private.alert_email()));
end $$;
revoke execute on function public.admin_email_log(int) from anon, public;
revoke execute on function public.admin_test_email() from anon, public;
grant execute on function public.admin_email_log(int), public.admin_test_email() to authenticated;

create or replace function private.first_of(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select profile->>'first' from public.profiles where id = uid), '');
$$;

-- profile decisions, and "you have a new match" for everyone who can now see a newly active member
create or replace function private.member_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare was boolean; now_on boolean; g text; list jsonb;
begin
  if new.status <> old.status and new.status in ('approved','changes','rejected','suspended') then
    perform private.notify('status', jsonb_build_object('to', new.email, 'first', private.first_of(new.id), 'status', new.status,
      'note', new.admin_note, 'until', new.paid_until, 'active', new.paid_until > now(), 'credit', new.credit_months > 0));
  end if;
  was := old.status = 'approved' and coalesce(old.paid_until > now(), false);
  now_on := new.status = 'approved' and coalesce(new.paid_until > now(), false);
  if now_on and not was then
    select profile->>'gender' into g from public.profiles where id = new.id;
    select coalesce(jsonb_agg(o.email), '[]'::jsonb) into list from (
      select m.email from public.members m join public.profiles p on p.id = m.id
      where m.id <> new.id and private.eligible(new.id, m.id)
        and (g is null or g = '' or coalesce(p.profile->>'gender', '') in ('', case g when 'Man' then 'Woman' when 'Woman' then 'Man' else g end))
        and not exists (select 1 from public.intros i where (i.from_id = new.id and i.to_id = m.id) or (i.to_id = new.id and i.from_id = m.id))
      limit 100) o;
    if jsonb_array_length(list) > 0 then perform private.notify('new_match', jsonb_build_object('to', list)); end if;
  end if;
  return null;
end $$;
drop trigger if exists member_notify on public.members;
create trigger member_notify after update on public.members
  for each row execute function private.member_notify();

create or replace function private.intro_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify('intro_request', jsonb_build_object('to', (select email from public.members where id = new.to_id), 'first', private.first_of(new.to_id)));
  elsif new.status = 'accepted' and old.status <> 'accepted' then
    perform private.notify('intro_accepted', jsonb_build_object('to', (select email from public.members where id = new.from_id),
      'first', private.first_of(new.from_id), 'other', private.first_of(new.to_id)));
  end if;
  return null;
end $$;
drop trigger if exists intro_notify on public.intros;
create trigger intro_notify after insert or update on public.intros
  for each row execute function private.intro_notify();

-- New messages, at most one email per conversation every few hours so people aren't flooded
create or replace function private.message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare mid uuid; i public.intros; other uuid;
begin
  if new.quiet or new.from_id = 'system' then return null; end if;
  if new.thread like 'support:%' then
    mid := substr(new.thread, 9)::uuid;
    if new.from_id = 'admin' then
      -- skip the automatic welcome message sent at sign-up
      if exists (select 1 from public.members where id = mid and created_at > now() - interval '15 minutes') then return null; end if;
      if exists (select 1 from public.messages where thread = new.thread and from_id = 'admin' and id <> new.id and at > now() - interval '6 hours') then return null; end if;
      perform private.notify('team_message', jsonb_build_object('to', (select email from public.members where id = mid), 'first', private.first_of(mid), 'preview', left(new.body, 220)));
    else
      if exists (select 1 from public.messages where thread = new.thread and from_id <> 'admin' and id <> new.id and at > now() - interval '1 hour') then return null; end if;
      perform private.notify('support_in', jsonb_build_object('to', private.alert_email(),
        'name', trim(private.first_of(mid) || ' ' || coalesce((select profile->>'last' from public.profiles where id = mid), '')), 'preview', left(new.body, 220)));
    end if;
    return null;
  end if;
  select * into i from public.intros where id::text = new.thread;
  if i.id is null then return null; end if;
  other := case when new.from_id = i.from_id::text then i.to_id else i.from_id end;
  if exists (select 1 from public.messages where thread = new.thread and from_id = new.from_id and id <> new.id and at > now() - interval '6 hours') then return null; end if;
  perform private.notify('member_message', jsonb_build_object('to', (select email from public.members where id = other),
    'first', private.first_of(other), 'other', private.first_of(new.from_id::uuid)));
  return null;
end $$;
drop trigger if exists message_notify on public.messages;
create trigger message_notify after insert on public.messages
  for each row execute function private.message_notify();

-- daily reminders: 3 days before a membership ends, and the day after it ends
create or replace function private.membership_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, email, plan, paid_until from public.members where status = 'approved'
             and paid_until between now() + interval '3 days' and now() + interval '4 days' loop
    perform private.notify('expiring', jsonb_build_object('to', r.email, 'first', private.first_of(r.id), 'plan', r.plan, 'until', r.paid_until));
  end loop;
  for r in select id, email, plan, paid_until from public.members where status = 'approved'
             and paid_until between now() - interval '1 day' and now() loop
    perform private.notify('expired', jsonb_build_object('to', r.email, 'first', private.first_of(r.id), 'plan', r.plan, 'until', r.paid_until));
  end loop;
end $$;
-- ---------------------------------------------------------------------
-- Visits and logins, counted by NSC itself (no third-party analytics).
-- Visitors get a random ID kept in their browser; signed-in people are linked
-- to their account by the database, never by what the page sends.
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  kind      text not null check (kind in ('view','login','signup')),
  path      text not null default '' check (char_length(path) <= 200),
  referrer  text not null default '' check (char_length(referrer) <= 200),
  visitor   text not null default '' check (char_length(visitor) <= 40),
  session   text not null default '' check (char_length(session) <= 40),
  device    text not null default '' check (device in ('','mobile','tablet','desktop')),
  user_id   uuid references auth.users(id) on delete set null
);
create index if not exists events_at_idx on public.events(at);
create index if not exists events_user_idx on public.events(user_id, at);

create or replace function private.stamp_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.at := now();
  new.user_id := auth.uid();
  return new;
end $$;
drop trigger if exists stamp_event on public.events;
create trigger stamp_event before insert on public.events
  for each row execute function private.stamp_event();

alter table public.events enable row level security;
drop policy if exists "events: anyone records" on public.events;
drop policy if exists "events: team reads"     on public.events;
create policy "events: anyone records" on public.events for insert to anon, authenticated with check (true);
create policy "events: team reads"     on public.events for select using (private.is_admin());
grant insert on public.events to anon, authenticated;

-- all-time counts, and when each account last signed in (from Supabase Auth)
create or replace function public.admin_traffic_totals()
returns table (views bigint, visitors bigint, logins bigint, first_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the NSC team can see this'; end if;
  return query select count(*) filter (where kind = 'view'), count(distinct visitor) filter (where kind = 'view'),
                      count(*) filter (where kind = 'login'), min(at) from public.events;
end $$;
create or replace function public.admin_last_sign_ins()
returns table (user_id uuid, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the NSC team can see this'; end if;
  return query select id, last_sign_in_at from auth.users;
end $$;
revoke execute on function public.admin_traffic_totals() from anon, public;
revoke execute on function public.admin_last_sign_ins() from anon, public;
grant execute on function public.admin_traffic_totals(), public.admin_last_sign_ins() to authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'nsc-tidy';
  perform cron.schedule('nsc-tidy', '30 3 * * *', $job$
    delete from public.events where at < now() - interval '13 months';
    delete from private.email_log where at < now() - interval '90 days';
  $job$);
exception when others then raise notice 'Clean-up job was not scheduled: %', sqlerrm;
end $$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'nsc-membership-reminders';
  perform cron.schedule('nsc-membership-reminders', '0 8 * * *', 'select private.membership_reminders()');
exception when others then raise notice 'Membership reminders were not scheduled: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- Make yourself an admin (run once, after creating your team login):
--   insert into public.admins(user_id)
--   select id from auth.users where email = 'admin@naijasinglesconnect.com';
-- ---------------------------------------------------------------------
