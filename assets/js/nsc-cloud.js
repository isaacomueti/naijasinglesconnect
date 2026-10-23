/*
 * Supabase backend for the NSC data layer (assets/js/nsc-store.js).
 * Keeps an in-memory copy of everything the signed-in person is allowed to see,
 * pushes every change to Supabase, and listens for live changes from others.
 * Security is enforced in the database by supabase/schema.sql, not here.
 */
(function () {
  'use strict';
  var S = window.NSC, CFG = window.NSC_CONFIG || {};
  if (!S) return;

  try {
    var q = new URLSearchParams(location.search);
    if (q.get('demo') === '1') sessionStorage.setItem('nsc.mode', 'demo');
    if (q.get('demo') === '0') sessionStorage.removeItem('nsc.mode');
  } catch (e) {}
  var demo = false;
  try { demo = sessionStorage.getItem('nsc.mode') === 'demo'; } catch (e) {}
  if (demo || !CFG.supabaseUrl || !CFG.supabaseKey) { S.mode = 'demo'; return; }
  if (!window.supabase || !window.supabase.createClient) { S.mode = 'demo'; console.error('NSC: Supabase library failed to load; using demo data.'); return; }

  var REF = new URL(CFG.supabaseUrl).hostname.split('.')[0];
  /* The team login is stored apart from the member login, so testing a member account in
     another tab of the same browser can't swap the admin page's session. */
  var ADMIN_PAGE = /^\/admin/.test(location.pathname);
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !ADMIN_PAGE,
      storageKey: ADMIN_PAGE ? 'sb-' + REF + '-admin-auth' : 'sb-' + REF + '-auth-token',
      /* Supabase's default cross-tab browser lock can stall sign-in forever when another NSC tab
         is open or asleep. A pass-through lock keeps each tab independent. */
      lock: function (name, acquireTimeout, fn) { return fn(); } }
  });
  var cache = { members: [], intros: [], messages: [], reports: [], activity: [], reads: {}, notes: [], settings: {}, team: [], payments: [] };
  var st = { user: null, isAdmin: false, as: 'none', loaded: false, channel: null };
  var PROFILE_DEFAULTS = { first: '', last: '', gender: '', dob: '', location: '', nationality: '', heritage: '', openTo: 'both', origin: '', lga: '', qual: '', job: '',
    religion: '', denom: '', worship: '', marital: '', genotype: '', children: '', wantkids: '', intent: '', agemin: '', agemax: '', ploc: '', lookfor: '',
    dealbreakers: [], bio: '', photos: [], circle: false };

  function ms(t) { return t ? Date.parse(t) : null; }
  function iso(n) { return n ? new Date(n).toISOString() : null; }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fail(what, err) { S.error((what ? what + ': ' : '') + (err && err.message ? err.message : String(err))); }
  function check(res, what) { if (res && res.error) throw Object.assign(new Error(res.error.message), { what: what }); return res ? res.data : null; }

  /* ---------- row mapping (database <-> page shape) ---------- */
  function memberRow(m, p, inCircle) {
    return {
      id: m.id, email: m.email, phone: m.phone || '', status: m.status, adminNote: m.admin_note || '',
      submittedAt: ms(m.submitted_at), approvedAt: ms(m.approved_at), blocked: m.blocked || [], payment: m.payment || { status: 'none' },
      createdAt: ms(m.created_at), privacy: p ? p.privacy : 'full', demo: false,
      plan: m.plan || null, paidUntil: ms(m.paid_until), creditMonths: m.credit_months || 0,
      profile: Object.assign({}, PROFILE_DEFAULTS, p ? p.profile : {}, { circle: !!inCircle })
    };
  }
  /* match_profiles() only returns members who are active, or already linked by an introduction */
  function otherRow(r) {
    var pr = Object.assign({}, PROFILE_DEFAULTS, r.profile || {}, { circle: !!r.circle });
    if (pr.hiddenPhotos) pr.photos = ['hidden'];
    return { id: r.id, email: '', phone: '', status: 'approved', adminNote: '', submittedAt: null, approvedAt: null, blocked: [],
      payment: {}, plan: null, paidUntil: 8.64e15, creditMonths: 0, createdAt: 0, privacy: r.privacy || 'full', demo: false, profile: pr };
  }
  function payRow(x) { return { id: x.id, member: x.member_id, plan: x.plan, months: x.months, amount: x.amount, ref: x.ref, file: x.file, status: x.status, note: x.note || '', createdAt: ms(x.created_at), reviewedAt: ms(x.reviewed_at) }; }
  function introRow(i) { return { id: i.id, from: i.from_id, to: i.to_id, status: i.status, note: i.note || '', createdAt: ms(i.created_at), respondedAt: ms(i.responded_at) }; }
  function msgRow(x) { return { id: x.id, thread: x.thread, from: x.from_id, body: x.body, at: ms(x.at) }; }
  function reportRow(r) { return { id: r.id, by: r.by_id, about: r.about_id, thread: r.thread, reason: r.reason, details: r.details || '', status: r.status, action: r.action, at: ms(r.at), resolvedAt: ms(r.resolved_at) }; }
  function noteRow(n) { return { id: n.id, member: n.member_id, body: n.body, by: n.by_email, at: ms(n.at) }; }
  /* tables added by a later schema.sql: a missing one shouldn't stop the rest from loading */
  function soft(p) { return Promise.resolve(p).then(function (r) { return r && r.error ? { data: null, missing: true } : r; }, function () { return { data: null, missing: true }; }); }

  /* ---------- loading ---------- */
  var loading = null;
  function load() {
    if (loading) return loading;
    var me = st.user && st.user.id; if (!me) return Promise.resolve();
    var admin = st.as === 'admin' && st.isAdmin;
    /* everyone: their own rows (or all rows for the team); RLS decides what comes back */
    var q = {
      members: admin ? sb.from('members').select('*') : sb.from('members').select('*').eq('id', me),
      profiles: admin ? sb.from('profiles').select('*') : sb.from('profiles').select('*').eq('id', me),
      circle: admin ? sb.from('circle_members').select('member_id') : sb.from('circle_members').select('member_id').eq('member_id', me),
      intros: sb.from('intros').select('*'),
      messages: sb.from('messages').select('*').order('at'),
      reads: admin ? sb.from('reads').select('*').eq('reader', 'admin') : sb.from('reads').select('*'),
      settings: soft(sb.from('settings').select('data').eq('id', 1).maybeSingle()),
      payments: soft(sb.from('payments').select('*').order('created_at'))
    };
    if (admin) {
      q.reports = sb.from('reports').select('*');
      q.activity = sb.from('activity').select('*').order('at', { ascending: false }).limit(200);
      q.notes = soft(sb.from('team_notes').select('*').order('at'));
      q.team = soft(sb.rpc('team_list'));
    } else q.matches = sb.rpc('match_profiles');
    var names = Object.keys(q);
    loading = Promise.all(names.map(function (k) { return q[k]; })).then(function (list) {
      var r = {}; names.forEach(function (k, i) { r[k] = list[i]; });
      var pById = {}; check(r.profiles, 'profiles').forEach(function (p) { pById[p.id] = p; });
      var cSet = {}; check(r.circle, 'circle').forEach(function (c) { cSet[c.member_id] = true; });
      var members = check(r.members, 'members').map(function (m) { return memberRow(m, pById[m.id], cSet[m.id]); });
      var intros = check(r.intros, 'intros').map(introRow), messages = check(r.messages, 'messages').map(msgRow), reads = {};
      check(r.reads, 'reads').forEach(function (x) { reads[x.reader + '|' + x.thread] = ms(x.at); });
      if (!admin) check(r.matches, 'matches').forEach(function (x) { members.push(otherRow(x)); });
      cache.members = members; cache.intros = intros; cache.messages = messages; cache.reads = reads;
      cache.reports = admin ? check(r.reports, 'reports').map(reportRow) : [];
      cache.activity = admin ? check(r.activity, 'activity').map(function (a) { return { at: ms(a.at), text: a.text }; }) : [];
      cache.settings = r.settings.data ? r.settings.data.data || {} : {};
      cache.payments = (r.payments.data || []).map(payRow);
      S.needsUpgrade = !!(r.settings.missing || r.payments.missing);
      if (admin) {
        cache.notes = (r.notes.data || []).map(noteRow);
        cache.team = r.team.data || [];
        S.needsUpgrade = S.needsUpgrade || !!r.notes.missing || !!r.team.missing;
      }
      st.loaded = true; S._emit();
    }).catch(function (e) { fail(e.what ? 'Could not load ' + e.what : 'Could not load your data', e); })
      .then(function () { loading = null; });
    return loading;
  }
  var reloadT = null;
  function reloadSoon(ms_) { clearTimeout(reloadT); reloadT = setTimeout(load, ms_ || 400); }

  function subscribe() {
    if (st.channel) return;
    var admin = st.as === 'admin' && st.isAdmin;
    var ch = sb.channel('nsc-' + st.user.id);
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, function (e) {
      var row = msgRow(e.new);
      if (!cache.messages.some(function (x) { return x.id === row.id; })) { cache.messages.push(row); S._emit(); }
      else { cache.messages = cache.messages.map(function (x) { return x.id === row.id ? row : x; }); }
    });
    ['intros', 'members', 'payments'].concat(admin ? ['profiles', 'circle_members', 'reports'] : []).forEach(function (t) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, function () { reloadSoon(); });
    });
    ch.subscribe();
    st.channel = ch;
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reloadSoon(50); });
    setInterval(function () { if (document.visibilityState === 'visible') load(); }, admin ? 30000 : 60000);
  }

  /* ---------- writes ---------- */
  function find(t, id) { return cache[t].filter(function (r) { return r.id === id; })[0] || null; }
  function remote(p, onFail) { return Promise.resolve(p).then(function (res) { if (res && res.error) throw res.error; return res; }).catch(function (e) { fail('Could not save', e); if (onFail) onFail(); reloadSoon(50); }); }

  function insert(t, row) {
    if (!cache[t]) { fail('', 'Unknown table ' + t); return null; }
    cache[t].push(row); S._emit();
    var undo = function () { cache[t] = cache[t].filter(function (r) { return r !== row; }); S._emit(); };
    if (t === 'messages') remote(sb.from('messages').insert({ id: row.id, thread: row.thread, from_id: row.from, body: row.body }), undo);
    else if (t === 'intros') remote(sb.from('intros').insert({ id: row.id, from_id: row.from, to_id: row.to, note: row.note || '' }), undo);
    else if (t === 'reports') remote(sb.from('reports').insert({ id: row.id, by_id: row.by, about_id: row.about, thread: row.thread || null, reason: row.reason, details: row.details || '' }), undo);
    else if (t === 'notes') remote(sb.from('team_notes').insert({ id: row.id, member_id: row.member, body: row.body }), undo);
    /* the database sets the amount, reference and (for members) the status */
    else if (t === 'payments') remote(sb.from('payments').insert({ id: row.id, member_id: row.member, plan: row.plan, months: row.months, file: row.file || null,
      status: row.status, amount: row.amount || 0, note: row.note || '' }), undo);
    else { undo(); fail('', 'New ' + t + ' rows are created by the server'); return null; }
    return row;
  }

  function update(t, id, patch) {
    var row = find(t, id); if (!row) return null;
    var before = clone(row);
    if (typeof patch === 'function') patch(row); else Object.assign(row, patch);
    S._emit();
    var undo = function () { Object.keys(row).forEach(function (k) { delete row[k]; }); Object.assign(row, before); S._emit(); };
    var jobs = [];
    if (t === 'members') {
      var m = {}, b = before;
      if (row.phone !== b.phone) m.phone = row.phone;
      if (row.status !== b.status) m.status = row.status;
      if (row.adminNote !== b.adminNote) m.admin_note = row.adminNote;
      if (row.submittedAt !== b.submittedAt) m.submitted_at = iso(row.submittedAt);
      if (row.approvedAt !== b.approvedAt) m.approved_at = iso(row.approvedAt);
      if (JSON.stringify(row.blocked) !== JSON.stringify(b.blocked)) m.blocked = row.blocked;
      if (JSON.stringify(row.payment) !== JSON.stringify(b.payment)) m.payment = row.payment;
      var pNew = Object.assign({}, row.profile), pOld = Object.assign({}, b.profile);
      var circleNew = !!pNew.circle, circleOld = !!pOld.circle; delete pNew.circle; delete pOld.circle;
      var pPatch = {};
      if (JSON.stringify(pNew) !== JSON.stringify(pOld)) pPatch.profile = pNew;
      if (row.privacy !== b.privacy) pPatch.privacy = row.privacy;
      // profile first, so a submission is never reviewed with stale answers
      if (Object.keys(pPatch).length) { pPatch.updated_at = new Date().toISOString(); jobs.push(function () { return sb.from('profiles').update(pPatch).eq('id', id); }); }
      if (circleNew !== circleOld) jobs.push(function () { return circleNew ? sb.from('circle_members').insert({ member_id: id }) : sb.from('circle_members').delete().eq('member_id', id); });
      if (Object.keys(m).length) jobs.push(function () { return sb.from('members').update(m).eq('id', id); });
    } else if (t === 'intros') {
      var ip = {};
      if (row.status !== before.status) ip.status = row.status;
      if (row.respondedAt !== before.respondedAt) ip.responded_at = iso(row.respondedAt);
      if (row.note !== before.note) ip.note = row.note;
      if (Object.keys(ip).length) jobs.push(function () { return sb.from('intros').update(ip).eq('id', id); });
    } else if (t === 'payments') {
      var pp = {};
      if (row.status !== before.status) pp.status = row.status;
      if (row.note !== before.note) pp.note = row.note;
      if (Object.keys(pp).length) jobs.push(function () { return sb.from('payments').update(pp).eq('id', id); });
    } else if (t === 'reports') {
      var rp = {};
      if (row.status !== before.status) rp.status = row.status;
      if (row.action !== before.action) rp.action = row.action;
      if (row.resolvedAt !== before.resolvedAt) rp.resolved_at = iso(row.resolvedAt);
      if (Object.keys(rp).length) jobs.push(function () { return sb.from('reports').update(rp).eq('id', id); });
    }
    var chain = Promise.resolve();
    jobs.forEach(function (j) { chain = chain.then(function () { return j().then(function (res) { if (res && res.error) throw res.error; }); }); });
    remote(chain, undo);
    return row;
  }

  function removeRow(t, id) {
    var row = find(t, id); if (!row) return;
    cache[t] = cache[t].filter(function (r) { return r !== row; }); S._emit();
    var table = { payments: 'payments' }[t];
    if (!table) { fail('', 'Rows in ' + t + ' cannot be removed here'); return; }
    remote(sb.from(table).delete().eq('id', id), function () { cache[t].push(row); S._emit(); });
  }

  function markRead(reader, thread) {
    cache.reads[reader + '|' + thread] = Date.now(); S._emit();
    remote(sb.from('reads').upsert({ reader: reader, thread: thread, at: new Date().toISOString() }));
  }
  function log(text) {
    if (st.as === 'admin') { cache.activity.unshift({ at: Date.now(), text: text }); S._emit(); }
    sb.from('activity').insert({ text: text }).then(function () {});
  }

  /* ---------- storage ---------- */
  function blobFromDataUrl(u) {
    var parts = u.split(','), mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg', bin = atob(parts[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function needUser() { if (!st.user) throw new Error('Please log in again.'); return st.user.id; }

  /* ---------- wire into NSC ---------- */
  S._useBackend({ cache: cache, insert: insert, update: update, remove: removeRow, markRead: markRead, log: log });
  S.uid = function () { return uuid(); };

  S.ready = function (opts) {
    st.as = (opts && opts.as) || 'none';
    return sb.auth.getSession().then(function (res) {
      st.user = res.data && res.data.session ? res.data.session.user : null;
      if (!st.user) return;
      return sb.from('admins').select('user_id').eq('user_id', st.user.id).maybeSingle().then(function (a) {
        st.isAdmin = !!(a && a.data);
        if (st.as === 'member' || (st.as === 'admin' && st.isAdmin)) return load().then(subscribe);
      });
    }).catch(function (e) { fail('Could not connect', e); });
  };

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT') { st.user = null; st.isAdmin = false; cache.members = []; cache.intros = []; cache.messages = []; cache.reports = []; cache.activity = []; cache.reads = {}; S._emit(); }
    else if (session) st.user = session.user;
    if (event === 'PASSWORD_RECOVERY') { S._recovering = true; try { window.dispatchEvent(new CustomEvent('nsc:recovery')); } catch (e) {} }
  });

  function friendly(e) {
    var m = e && e.message || String(e);
    if (/invalid login credentials/i.test(m)) return 'That email and password don’t match an account.';
    if (/email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the code we sent.';
    if (/token has expired|otp.*expired|expired/i.test(m)) return 'That code isn\u2019t right or has expired. Check the latest email, or tap \u201cResend code\u201d for a new one.';
    if (/invalid.*(token|otp)|token.*invalid/i.test(m)) return 'That code isn\u2019t right. Check the email and try again.';
    if (/for security purposes|after \d+ seconds/i.test(m)) return 'Please wait a minute before asking for another code.';
    if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists. Log in instead.';
    if (/password should be at least/i.test(m)) return 'Your password needs at least 8 characters.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    return m;
  }
  S.auth = {
    signUp: function (d) {
      return sb.auth.signUp({ email: d.email, password: d.password, options: { emailRedirectTo: location.origin + '/dashboard',
        data: { first: d.first, last: d.last, phone: d.phone, nationality: d.country || '' } } })
        .then(function (r) { if (r.error) throw new Error(friendly(r.error));
          if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw new Error(friendly({ message: 'already registered' }));
          st.user = r.data.session ? r.data.user : null;
          return { id: r.data.user && r.data.user.id, needsConfirm: !r.data.session }; });
    },
    signIn: function (email, password) {
      return sb.auth.signInWithPassword({ email: String(email).trim(), password: password })
        .then(function (r) {
          if (r.error) { var err = new Error(friendly(r.error)); err.code = /email not confirmed/i.test(r.error.message) ? 'email_not_confirmed' : (r.error.code || ''); throw err; }
          if (window.nscTrack && r.data.session) window.nscTrack('login', { token: r.data.session.access_token, path: ADMIN_PAGE ? '/admin' : '/auth' });
          st.user = r.data.user; return { id: r.data.user.id };
        });
    },
    /* confirm a sign-up with the code from the email; signs the member in */
    /* Confirms a sign-up with the emailed code. This talks to Supabase Auth directly and stores the
       login where supabase-js reads it, because the library's own verify step can stall in some
       browsers after a correct code. The dashboard picks the login up when it loads. */
    verifyOtp: function (email, code) {
      email = String(email).trim(); code = String(code).trim();
      var key = 'sb-' + REF + '-auth-token';
      function attempt(type) {
        var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 15000);
        return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/auth/v1/verify', {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey },
          body: JSON.stringify({ type: type, email: email, token: code })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (j) { clearTimeout(t); return { ok: res.ok, body: j }; });
        }, function (e) {
          clearTimeout(t);
          throw new Error(e && e.name === 'AbortError' ? 'The server took too long to answer. Check your connection and try again.' : 'Could not reach NSC. Check your connection and try again.');
        });
      }
      function why(b) { return (b.error_code || '') + ' ' + (b.msg || b.error_description || b.message || ''); }
      return attempt('email').then(function (r) {
        // some projects confirm sign-ups only with type "signup"; retry once with it
        return !r.ok && /otp_expired|invalid/i.test(why(r.body)) ? attempt('signup') : r;
      }).then(function (r) {
        if (!r.ok) throw new Error(friendly({ message: why(r.body).trim() || 'That code didn\u2019t work. Try again.' }));
        var s = r.body;
        if (!s.access_token || !s.user) throw new Error('Your email is confirmed. Please log in.');
        if (!s.expires_at) s.expires_at = Math.round(Date.now() / 1000) + (s.expires_in || 3600);
        try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) { throw new Error('Your browser blocked saving the login. Turn off private browsing and try again.'); }
        if (window.nscTrack) window.nscTrack('signup', { token: s.access_token, path: '/auth' });
        st.user = s.user; return { id: s.user.id };
      });
    },
    resend: function (email) {
      return sb.auth.resend({ type: 'signup', email: String(email).trim(), options: { emailRedirectTo: location.origin + '/dashboard' } })
        .then(function (r) { if (r.error) throw new Error(friendly(r.error)); });
    },
    signOut: function () { return sb.auth.signOut(); },
    resetPassword: function (email) {
      return sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: location.origin + '/auth?reset=1' })
        .then(function (r) { if (r.error) throw new Error(friendly(r.error)); });
    },
    updatePassword: function (pw) { return sb.auth.updateUser({ password: pw }).then(function (r) { if (r.error) throw new Error(friendly(r.error)); }); }
  };

  S.session = {
    get: function () { return st.user ? { id: st.user.id } : null; },
    set: function () {},
    clear: function () { return sb.auth.signOut(); }
  };
  S.admin = {
    email: '',
    check: function (email, pw) {
      return S.auth.signIn(email, pw).then(function () {
        return sb.from('admins').select('user_id').eq('user_id', st.user.id).maybeSingle();
      }).then(function (a) {
        st.isAdmin = !!(a && a.data);
        if (!st.isAdmin) return sb.auth.signOut().then(function () { return false; });
        st.as = 'admin'; return load().then(subscribe).then(function () { return true; });
      }).catch(function () { return false; });
    },
    get: function () { return st.user && st.isAdmin ? { id: st.user.id } : null; },
    set: function () {},
    clear: function () { return sb.auth.signOut(); }
  };

  S.uploadImage = function (dataUrl) {
    try { var me = needUser(); } catch (e) { return Promise.reject(e); }
    var path = me + '/' + uuid() + '.jpg';
    return sb.storage.from('photos').upload(path, blobFromDataUrl(dataUrl), { contentType: 'image/jpeg', upsert: false }).then(function (r) {
      if (r.error) throw r.error;
      return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    });
  };
  S.uploadReceipt = function (file, dataUrl) {
    try { var me = needUser(); } catch (e) { return Promise.reject(e); }
    var body = dataUrl ? blobFromDataUrl(dataUrl) : file, type = dataUrl ? 'image/jpeg' : (file.type || 'application/pdf');
    var ext = type === 'application/pdf' ? 'pdf' : type.split('/')[1] || 'jpg', path = me + '/' + uuid() + '.' + ext;
    return sb.storage.from('receipts').upload(path, body, { contentType: type, upsert: false }).then(function (r) {
      if (r.error) throw r.error;
      return { name: file.name, type: type, path: path };
    });
  };
  S.receiptUrl = function (f) {
    if (!f) return Promise.resolve(null);
    if (!f.path) return Promise.resolve(f.dataUrl || null);
    return sb.storage.from('receipts').createSignedUrl(f.path, 3600).then(function (r) { return r.data ? r.data.signedUrl : null; });
  };
  /* ---------- team tools (admin only; the database refuses everyone else) ---------- */
  S.saveSettings = function (data) {
    var next = Object.assign({}, cache.settings, data);
    return sb.from('settings').update({ data: next, updated_at: new Date().toISOString() }).eq('id', 1).select('id').then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw new Error('Settings are not set up yet. Run supabase/schema.sql again.');
      cache.settings = next; S._emit();
    });
  };
  S.sendMany = function (items, from) {
    var rows = items.filter(function (i) { return String(i.body || '').trim(); })
      .map(function (i) { return { id: uuid(), thread: i.thread, from: from, body: String(i.body).trim().slice(0, 2000), at: Date.now() }; });
    if (!rows.length) return [];
    rows.forEach(function (x) { cache.messages.push(x); }); S._emit();
    var undo = function () { cache.messages = cache.messages.filter(function (x) { return rows.indexOf(x) < 0; }); S._emit(); };
    var chain = Promise.resolve();
    for (var i = 0; i < rows.length; i += 200) (function (part) {
      // broadcasts are quiet: they never trigger an email to every member at once
      chain = chain.then(function () { return sb.from('messages').insert(part.map(function (x) { return { id: x.id, thread: x.thread, from_id: x.from, body: x.body, quiet: true }; })).then(function (res) { if (res.error) throw res.error; }); });
    })(rows.slice(i, i + 200));
    remote(chain, undo);
    return rows;
  };
  S.team = {
    list: function () { return cache.team; },
    load: function () { return sb.rpc('team_list').then(function (r) { if (r.error) throw r.error; cache.team = r.data || []; S._emit(); }); },
    add: function (email) { return sb.rpc('team_add', { p_email: String(email).trim() }).then(function (r) { if (r.error) throw r.error; return S.team.load(); }); },
    remove: function (id) { return sb.rpc('team_remove', { p_user: id }).then(function (r) { if (r.error) throw r.error; return S.team.load(); }); }
  };
  /* visits and logins for the team's Traffic page: the last 30 days in detail, plus all-time totals */
  S.traffic = function () {
    var since = new Date(Date.now() - 30 * 864e5).toISOString();
    function page(from) {
      return sb.from('events').select('at,kind,path,referrer,visitor,session,device,user_id').gte('at', since).order('at', { ascending: false }).range(from, from + 999)
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    }
    function all(from, acc) { return page(from).then(function (rows) { acc = acc.concat(rows); return rows.length === 1000 && acc.length < 20000 ? all(from + 1000, acc) : acc; }); }
    return Promise.all([all(0, []), sb.rpc('admin_traffic_totals'), sb.rpc('admin_last_sign_ins')]).then(function (r) {
      if (r[1].error) throw r[1].error;
      var seen = {}; (r[2].data || []).forEach(function (x) { seen[x.user_id] = ms(x.last_sign_in); });
      return { events: r[0].map(function (e) { return { at: ms(e.at), kind: e.kind, path: e.path, referrer: e.referrer, visitor: e.visitor, session: e.session, device: e.device, user: e.user_id }; }),
        totals: (r[1].data || [])[0] || {}, lastSignIn: seen };
    });
  };
  S.emailLog = function () { return sb.rpc('admin_email_log', { p_limit: 40 }).then(function (r) { if (r.error) throw r.error; return r.data || []; }); };
  S.testEmail = function () { return sb.rpc('admin_test_email').then(function (r) { if (r.error) throw r.error; }); };
  /* removes their photos and receipts from storage, then the account and everything linked to it */
  S.deleteMember = function (id) {
    function clear(bucket) {
      return sb.storage.from(bucket).list(id, { limit: 1000 }).then(function (r) {
        var paths = (r.data || []).map(function (o) { return id + '/' + o.name; });
        return paths.length ? sb.storage.from(bucket).remove(paths) : null;
      });
    }
    return Promise.all([clear('photos'), clear('receipts')]).then(function () { return sb.rpc('admin_delete_member', { p_member: id }); }).then(function (r) {
      if (r.error) throw r.error;
      var intros = cache.intros.filter(function (i) { return i.from === id || i.to === id; }).map(function (i) { return i.id; });
      cache.members = cache.members.filter(function (x) { return x.id !== id; });
      cache.intros = cache.intros.filter(function (i) { return intros.indexOf(i.id) < 0; });
      cache.messages = cache.messages.filter(function (x) { return x.thread !== 'support:' + id && x.from !== id && intros.indexOf(x.thread) < 0; });
      cache.reports = cache.reports.filter(function (x) { return x.by !== id && x.about !== id; });
      cache.notes = cache.notes.filter(function (n) { return n.member !== id; });
      cache.payments = cache.payments.filter(function (x) { return x.member !== id; });
      S._emit(); reloadSoon(800);
    });
  };
  S.supabase = sb;
})();
