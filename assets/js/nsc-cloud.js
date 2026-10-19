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

  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var cache = { members: [], intros: [], messages: [], reports: [], activity: [], reads: {} };
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
      profile: Object.assign({}, PROFILE_DEFAULTS, p ? p.profile : {}, { circle: !!inCircle })
    };
  }
  function otherRow(r) {
    var pr = Object.assign({}, PROFILE_DEFAULTS, r.profile || {}, { circle: !!r.circle });
    if (pr.hiddenPhotos) pr.photos = ['hidden'];
    return { id: r.id, email: '', phone: '', status: 'approved', adminNote: '', submittedAt: null, approvedAt: null, blocked: [],
      payment: { status: 'confirmed' }, createdAt: 0, privacy: r.privacy || 'full', demo: false, profile: pr };
  }
  function introRow(i) { return { id: i.id, from: i.from_id, to: i.to_id, status: i.status, note: i.note || '', createdAt: ms(i.created_at), respondedAt: ms(i.responded_at) }; }
  function msgRow(x) { return { id: x.id, thread: x.thread, from: x.from_id, body: x.body, at: ms(x.at) }; }
  function reportRow(r) { return { id: r.id, by: r.by_id, about: r.about_id, thread: r.thread, reason: r.reason, details: r.details || '', status: r.status, action: r.action, at: ms(r.at), resolvedAt: ms(r.resolved_at) }; }

  /* ---------- loading ---------- */
  var loading = null;
  function load() {
    if (loading) return loading;
    var me = st.user && st.user.id; if (!me) return Promise.resolve();
    var admin = st.as === 'admin' && st.isAdmin;
    var jobs = admin ? [
      sb.from('members').select('*'), sb.from('profiles').select('*'), sb.from('circle_members').select('member_id'),
      sb.from('intros').select('*'), sb.from('messages').select('*').order('at'), sb.from('reports').select('*'),
      sb.from('activity').select('*').order('at', { ascending: false }).limit(200), sb.from('reads').select('*').eq('reader', 'admin')
    ] : [
      sb.from('members').select('*').eq('id', me), sb.from('profiles').select('*').eq('id', me), sb.from('circle_members').select('member_id').eq('member_id', me),
      sb.from('intros').select('*'), sb.from('messages').select('*').order('at'), sb.rpc('match_profiles'), sb.from('reads').select('*')
    ];
    loading = Promise.all(jobs).then(function (r) {
      var members = check(r[0], 'members'), profiles = check(r[1], 'profiles'), circle = check(r[2], 'circle');
      var pById = {}; profiles.forEach(function (p) { pById[p.id] = p; });
      var cSet = {}; circle.forEach(function (c) { cSet[c.member_id] = true; });
      var next = { members: members.map(function (m) { return memberRow(m, pById[m.id], cSet[m.id]); }), intros: check(r[3], 'intros').map(introRow),
        messages: check(r[4], 'messages').map(msgRow), reports: [], activity: [], reads: {} };
      if (admin) {
        next.reports = check(r[5], 'reports').map(reportRow);
        next.activity = check(r[6], 'activity').map(function (a) { return { at: ms(a.at), text: a.text }; });
        check(r[7], 'reads').forEach(function (x) { next.reads[x.reader + '|' + x.thread] = ms(x.at); });
      } else {
        check(r[5], 'matches').forEach(function (x) { next.members.push(otherRow(x)); });
        check(r[6], 'reads').forEach(function (x) { next.reads[x.reader + '|' + x.thread] = ms(x.at); });
      }
      cache.members = next.members; cache.intros = next.intros; cache.messages = next.messages;
      cache.reports = next.reports; cache.activity = next.activity; cache.reads = next.reads;
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
    ['intros', 'members'].concat(admin ? ['profiles', 'circle_members', 'reports'] : []).forEach(function (t) {
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
  S._useBackend({ cache: cache, insert: insert, update: update, markRead: markRead, log: log });
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
    if (/token has expired|otp.*expired|expired/i.test(m)) return 'That code has expired. Tap \u201cResend code\u201d for a new one.';
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
          st.user = r.data.user; return { id: r.data.user.id };
        });
    },
    /* confirm a sign-up with the code from the email; signs the member in */
    verifyOtp: function (email, code) {
      return sb.auth.verifyOtp({ email: String(email).trim(), token: String(code).trim(), type: 'signup' })
        .then(function (r) { if (r.error) throw new Error(friendly(r.error)); if (!r.data.session) throw new Error('Your email is confirmed. Please log in.'); st.user = r.data.user; return { id: r.data.user.id }; });
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
  S.supabase = sb;
})();
