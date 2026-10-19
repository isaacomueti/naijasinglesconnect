# NaijaSinglesConnect website

Static site, ready for Vercel. No build step. Data, sign-in, files and live updates run on Supabase.

## Structure
- `index.html`: homepage
- `auth.html`: sign up, log in, reset password (served at `/auth`)
- `dashboard.html`: member dashboard (`/dashboard`): overview, matches, member profiles, introductions, messages, my profile, privacy, membership
- `admin.html`: team dashboard (`/admin`): overview, review queue, payments, support inbox, reports, members, introductions, matchmaker, broadcasts, insights, activity log, team and settings. The member drawer also holds private team notes, data export and account deletion.
- `404.html`: not-found page
- `supabase/schema.sql`: database tables, security rules, triggers and storage buckets
- `assets/js/config.js`: public Supabase URL and publishable key
- `assets/js/nsc-store.js`: shared data layer used by every page (also holds the demo data)
- `assets/js/nsc-cloud.js`: Supabase backend for the data layer
- `assets/js/countries.js`: every country with its dialling code, grouped by region
- `assets/css/app.css`: shared styles for the member and admin dashboards
- `assets/`: logo, icons, social image and web images
- `vercel.json`: clean URLs, caching and security headers
- `robots.txt`, `sitemap.xml`, `llms.txt`, `site.webmanifest`: SEO and AEO
- `brand/`: logo concepts, full-resolution images and brand mockups (not deployed, see `.vercelignore`)

## Supabase setup (once)
1. **Database:** open Supabase > SQL Editor > New query, paste all of `supabase/schema.sql` and click Run. It is safe to run again after changes.
2. **Email confirmation (off until Resend is connected):** Authentication > Sign In / Providers > Email, turn off **Confirm email**, and save.
3. **Allowed addresses:** Authentication > URL Configuration. Set **Site URL** to `https://naijasinglesconnect.com` and add these **Redirect URLs**: `http://localhost:3000/**`, `https://naijasinglesconnect.com/**` and your Vercel address (for example `https://naijasinglesconnect.vercel.app/**`).
4. **Team login:** Authentication > Users > Add user > Create new user, with the team email and a strong password, and tick auto-confirm. Then in the SQL Editor run:
   ```sql
   insert into public.admins(user_id)
   select id from auth.users where email = 'admin@naijasinglesconnect.com';
   ```
   This is only needed for the first team member. After that, add or remove people from **Team** in `/admin`.
5. **Settings:** in `/admin` > Settings, enter the membership fee and bank details. Members see them on their Membership page.

`assets/js/config.js` holds the project URL and the publishable key. Both are meant to be public; the security rules in `schema.sql` decide what each visitor can read or change. Never put the secret or service_role key in this repository.

## How the data is protected
- `members` (email, phone, status, payment, blocked list) is readable only by the member and admins.
- `profiles` is never read directly by other members. They get a masked copy from `match_profiles()`: last name, place of worship and Private Circle status are removed, and photos and first name follow the member's privacy setting until an introduction is accepted.
- Members only see members they are eligible to meet: both approved, both open to each other's nationality group, both in or both out of the Private Circle, and neither has blocked the other.
- Database triggers stop members approving themselves, confirming their own payment, editing admin notes, or answering introduction requests sent by them.
- Messages are readable only by the two people in an accepted introduction, or by the member and admins for support threads.
- Photos live in a public bucket under random file names; receipts live in a private bucket and admins see them through links that expire after an hour.
- Helper functions sit in a `private` schema the API does not expose.

## How the two sides connect
Both dashboards read and write through `assets/js/nsc-store.js`, backed by Supabase. Changes arrive live through Supabase Realtime, so an admin action shows up on the member's screen without a reload.

| Member does | Admin sees |
| --- | --- |
| Creates an account | New account in Members and in activity; a welcome message in their support thread |
| Submits profile | Profile appears in the Review queue |
| Uploads a receipt | Receipt appears in Payments to confirm |
| Messages support | Conversation appears in the Support inbox |
| Reports a member | Report appears in Reports with the conversation attached |

| Admin does | Member sees |
| --- | --- |
| Approves | Status becomes Approved, matches unlock, a support message arrives |
| Requests changes / rejects / pauses | A banner with the admin's note on the dashboard, plus a support message |
| Confirms or rejects a receipt | Payment status updates, plus a support message |
| Replies in the support inbox | The reply in their NSC Support conversation |

Members chat with each other once an introduction is accepted. Each conversation has a safety note, Report and Block.

## Across borders
Members add a nationality and choose who they are open to meeting: Nigerians, people from other countries, or both. People with Nigerian heritage count as Nigerian. Two members only see each other when each is open to the other's group. Sign-up takes any country code, and state of origin and LGA are only asked of Nigerian members.

## Private Circle (members living with HIV)
An optional, opt-in space. Members who join are matched only with other circle members and are hidden from everyone else; joining closes any pending introductions outside the circle. Membership is stored in its own `circle_members` table with the time consent was given. Admins see a "sensitive" banner on circle members.

HIV status is special-category health data under the Nigeria Data Protection Act 2023. Still to do before launch:
- add a privacy notice that explains the circle, and keep a record of consent wording
- keep the circle out of analytics, logs and emails, and never put it in notification or email subject lines
- confirm which team members may see the circle flag, and add only them as admins

## Demo mode
Add `?demo=1` to any address (for example `/admin?demo=1`) to switch that browser tab to sample data stored in the browser, and `?demo=0` to switch back. Demo members reply to messages and accept introductions automatically so the flows can be shown without real users.
- Sample member logins: any seeded email such as `tobi@example.com` or `chiamaka@example.com`, password `Demo1234`
- Demo team login at `/admin?demo=1`: `admin@naijasinglesconnect.com`, password `Admin1234`
- "Reset demo data" in the admin sidebar (demo mode only) restores the sample data.

## Still to connect
- **Resend:** confirmation, approval and password-reset emails. Until then, Supabase's built-in email sends reset links, with a low hourly limit.
- **Payments:** Paystack or Flutterwave, when the client is ready.

## Run locally
```
npx serve . -l 3000
```

## Deploy
```
npx vercel        # preview
npx vercel --prod # production
```
In the Vercel project settings use Framework Preset "Other", no build command, and output directory `.`.
Add naijasinglesconnect.com under Domains when it is registered.
