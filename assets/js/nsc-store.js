/*
 * NSC data layer, shared by auth, dashboard and admin.
 * Two backends sit behind the same API:
 *   - cloud (default): Supabase, attached by assets/js/nsc-cloud.js via NSC._useBackend()
 *   - demo (?demo=1):  sample data in this browser's localStorage under "nsc.db.v2",
 *                      synced live between open tabs
 * Pages read synchronously from an in-memory copy and listen with NSC.on().
 */
(function () {
  'use strict';
  var KEY = 'nsc.db.v3';
  var DEMO_HASH = '390c1fb37a84bbebd6425a08804081187b63492d8dc0756b8855f0c8df923b12';
  var ADMIN = { email: 'admin@naijasinglesconnect.com', hash: 'ecd4997df9fba0697cb6f4b59160343da463d79736865db4bb08bb95cfc56ea9' };
  var CARRIERS = ['AS', 'AC', 'SS', 'SC'];
  var COUNTRIES = ['Nigeria','Ghana','Cameroon','Benin','Togo','Kenya','South Africa','Uganda','Rwanda','Tanzania','Ethiopia','Senegal','Ivory Coast','Sierra Leone','Liberia','Zimbabwe','Zambia','Egypt','Morocco',
    'United Kingdom','Ireland','United States','Canada','Jamaica','Trinidad and Tobago','Barbados','Brazil','Germany','France','Netherlands','Belgium','Italy','Spain','Portugal','Sweden','Norway','Denmark','Switzerland','Poland',
    'United Arab Emirates','Saudi Arabia','Qatar','Turkey','India','Pakistan','China','Japan','South Korea','Philippines','Malaysia','Singapore','Australia','New Zealand','Other'];
  var STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];

  var listeners = [];
  var cache = null;
  var H = 3600e3, D = 24 * H;

  function uid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function now() { return Date.now(); }

  /* ---------- persistence ---------- */
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(db) {
    cache = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); NSC.lastError = null; }
    catch (e) { NSC.lastError = e; console.warn('NSC store: could not save. Storage may be full.', e); }
    emit();
  }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) { cache = null; emit(); } });
  var backend = null;
  function db() {
    if (backend) return backend.cache;
    if (!cache) cache = read();
    if (!cache) { cache = seed(); write(cache); }
    if (!cache.notes) cache.notes = [];
    if (!cache.payments) cache.payments = [];
    if (!cache.settings) cache.settings = defaultSettings();
    return cache;
  }

  /* site settings the team edits in /admin and members see in their dashboard */
  /* plans: weekly price by term in months; a month counts as 4 weeks */
  function defaultSettings() {
    return { bank: 'Zenith Bank', accountName: 'Best of Nature Ventures', accountNumber: '1012169172', parentCompany: 'Best of Nature Ventures',
      reviewTime: 'usually within 24 hours', supportEmail: 'support@naijasinglesconnect.com', alertEmail: 'justlynnonme@yahoo.com', goldIntroLimit: 5,
      plans: { gold: { '1': 1500, '3': 1000, '12': 500 }, platinum: { '1': 2250, '3': 1500, '12': 750 } } };
  }
  var PLAN_NAMES = { gold: 'Gold', platinum: 'Platinum' }, TERMS = [12, 3, 1];
  function addMonths(ts, n) { var d = new Date(ts); d.setMonth(d.getMonth() + n); return +d; }

  /* ---------- seed data (demo only) ---------- */
  function p(o) {
    return Object.assign({ first: '', last: '', gender: '', dob: '', location: '', nationality: 'Nigeria', heritage: '', openTo: 'both', origin: '', lga: '', qual: '', job: '', religion: '', denom: '', worship: '',
      marital: '', genotype: '', children: '', wantkids: '', intent: '', agemin: '', agemax: '', ploc: '', lookfor: '', dealbreakers: [], bio: '', photos: [], circle: false }, o);
  }
  function m(id, email, status, profile, extra) {
    return Object.assign({ id: id, email: email, phone: '', pwHash: DEMO_HASH, createdAt: now() - 20 * D, status: status, adminNote: '',
      submittedAt: now() - 10 * D, approvedAt: status === 'approved' ? now() - 8 * D : null, privacy: 'full', blocked: [], demo: true,
      payment: { ref: 'NSC-' + id.slice(2, 7).toUpperCase() },
      plan: status === 'approved' ? 'platinum' : null, paidUntil: status === 'approved' ? now() + 75 * D : null, creditMonths: 0,
      profile: p(profile) }, extra || {});
  }
  function seed() {
    var t = now();
    var members = [
      m('m_tobi', 'tobi@example.com', 'approved', { first: 'Tobi', openTo: 'nigerian', last: 'Adeyemi', gender: 'Man', dob: '1993-03-14', location: 'Abuja', origin: 'Ogun', lga: 'Ijebu-Ode', qual: "Bachelor's degree", job: 'Civil engineer', religion: 'Christianity', denom: 'RCCG', marital: 'Never married', genotype: 'AS', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 to 2 years', agemin: '25', agemax: '33', ploc: 'Abuja or Lagos', lookfor: 'Kind, prayerful and ambitious. Someone who laughs easily.', bio: 'I build bridges for a living and I want to build a home that is just as steady. Sunday jollof is non-negotiable.', photos: ['/assets/img/face-tobi.jpg'] }),
      m('m_emeka', 'emeka@example.com', 'approved', { first: 'Emeka', last: 'Nwosu', gender: 'Man', dob: '1990-07-02', location: 'Port Harcourt', origin: 'Imo', lga: 'Owerri North', qual: 'Professional certification', job: 'Chartered accountant', religion: 'Christianity', denom: 'Catholic', marital: 'Widowed', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 year', agemin: '27', agemax: '36', ploc: 'Anywhere in Nigeria', lookfor: 'A patient, honest woman who values family.', bio: 'I lost my wife four years ago. I am ready to love again and to build something calm and faithful.', photos: ['/assets/img/face-emeka.jpg'] }),
      m('m_femi', 'femi@example.com', 'approved', { first: 'Femi', last: 'Okeke', gender: 'Man', dob: '1995-01-20', location: 'Lagos', origin: 'Enugu', lga: 'Udi', qual: "Master's degree", job: 'Software developer', religion: 'Christianity', denom: 'Pentecostal', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Courtship first, then marriage', agemin: '24', agemax: '31', ploc: 'Lagos', bio: 'Quiet, curious and loyal. I play the keyboard in church and I make a mean pepper soup.' }, { privacy: 'nophoto' }),
      m('m_ibrahim', 'ibrahim@example.com', 'approved', { first: 'Ibrahim', openTo: 'nigerian', last: 'Musa', gender: 'Man', dob: '1992-05-11', location: 'Kaduna', origin: 'Kaduna', lga: 'Zaria', qual: "Master's degree", job: 'Architect', religion: 'Islam', denom: 'Sunni', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 year', agemin: '24', agemax: '32', ploc: 'Northern Nigeria or Abuja', bio: 'I design homes for other families. I would like to design one with my wife.' }, { privacy: 'name' }),
      m('m_chidi', 'chidi@example.com', 'approved', { first: 'Chidi', last: 'Eze', gender: 'Man', dob: '1991-09-30', location: 'Enugu', origin: 'Enugu', lga: 'Nsukka', qual: 'Doctorate', job: 'Medical doctor', religion: 'Christianity', denom: 'Anglican', marital: 'Divorced', genotype: 'AC', children: "Yes, they don't live with me", wantkids: 'Open to it', intent: 'Marriage within 1 to 2 years', agemin: '28', agemax: '38', ploc: 'South East', bio: 'Father of one. I work long hours but I always make time for the people I love.' }, { privacy: 'nophoto' }),
      m('m_chiamaka', 'chiamaka@example.com', 'approved', { first: 'Chiamaka', last: 'Okafor', gender: 'Woman', dob: '1997-02-08', location: 'Lagos', origin: 'Enugu', lga: 'Nsukka', qual: "Bachelor's degree", job: 'Hospital pharmacist', religion: 'Christianity', denom: 'Anglican', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 to 2 years', agemin: '29', agemax: '38', ploc: 'Lagos', lookfor: 'A God-fearing man who is kind to his mother and honest with his words.', bio: 'I sing in my parish choir, I cook for everyone I love, and I want a home that is calm, honest and full of laughter.', photos: ['/assets/img/face-chiamaka.jpg'] }),
      m('m_funmi', 'funmi@example.com', 'approved', { first: 'Funmilayo', openTo: 'nigerian', last: 'Bello', gender: 'Woman', dob: '1995-06-17', location: 'Ibadan', origin: 'Oyo', lga: 'Ibadan North', qual: "Bachelor's degree", job: 'Secondary school teacher', religion: 'Islam', denom: 'Sunni', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Courtship first, then marriage', agemin: '29', agemax: '38', ploc: 'South West', bio: 'Teacher by day, baker by weekend. Family means everything to me.', photos: ['/assets/img/face-funmi.jpg'] }),
      m('m_amina', 'amina@example.com', 'approved', { first: 'Amina', openTo: 'nigerian', last: 'Yusuf', gender: 'Woman', dob: '1998-11-03', location: 'Abuja', origin: 'Kano', lga: 'Nassarawa', qual: "Bachelor's degree", job: 'Product designer', religion: 'Islam', denom: 'Sunni', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 year', agemin: '28', agemax: '36', ploc: 'Abuja', bio: 'Calm, creative and family-first.' }, { privacy: 'nophoto' }),
      m('m_ngozi', 'ngozi@example.com', 'approved', { first: 'Ngozi', last: 'Obi', gender: 'Woman', dob: '1993-04-25', location: 'Lagos', origin: 'Anambra', lga: 'Onitsha North', qual: "Master's degree", job: 'Investment banker', religion: 'Christianity', denom: 'Catholic', marital: 'Never married', genotype: 'AS', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 to 2 years', agemin: '31', agemax: '40', ploc: 'Lagos', bio: 'Driven at work, soft at home.' }, { privacy: 'name' }),
      m('m_james', 'james@example.com', 'approved', { first: 'James', last: 'Whitfield', gender: 'Man', dob: '1991-02-12', location: 'Manchester, United Kingdom', nationality: 'United Kingdom', heritage: 'No', openTo: 'nigerian', qual: "Master's degree", job: 'Architect', religion: 'Christianity', denom: 'Anglican', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 to 2 years', agemin: '27', agemax: '36', ploc: 'Lagos or the UK', lookfor: 'A warm, family-minded woman. I would happily split our time between Lagos and Manchester.', bio: 'I fell in love with Nigerian food, music and people while working on a project in Lagos. Now I would like to build a family that spans both places.', photos: ['/assets/img/face-james.webp'] }),
      m('m_akosua', 'akosua@example.com', 'approved', { first: 'Akosua', last: 'Mensah', gender: 'Woman', dob: '1995-09-04', location: 'Accra, Ghana', nationality: 'Ghana', heritage: 'No', openTo: 'nigerian', qual: 'Doctorate', job: 'Medical doctor', religion: 'Christianity', denom: 'Methodist', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 to 2 years', agemin: '30', agemax: '39', ploc: 'Accra or Lagos', bio: 'Jollof debates aside, I have always admired Nigerian warmth. I am looking for a kind, ambitious man who loves God and family.', photos: ['/assets/img/face-akosua.webp'] }),
      m('m_bayo', 'bayo@example.com', 'approved', { first: 'Bayo', last: 'Adewale', gender: 'Man', dob: '1989-10-21', location: 'Lagos', origin: 'Oyo', lga: 'Ogbomosho North', qual: "Bachelor's degree", job: 'Logistics manager', religion: 'Christianity', denom: 'Baptist', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 to 2 years', agemin: '28', agemax: '38', ploc: 'Lagos', bio: 'Healthy, undetectable and hopeful. I want an honest partner who understands, and a home full of peace.', circle: true }, { privacy: 'nophoto' }),
      m('m_zainab', 'zainab@example.com', 'approved', { first: 'Zainab', last: 'Lawal', gender: 'Woman', dob: '1993-01-15', location: 'Abuja', origin: 'Kwara', lga: 'Ilorin West', qual: 'HND', job: 'Fashion designer', religion: 'Islam', denom: 'Sunni', marital: 'Divorced', genotype: 'AS', children: "Yes, they live with me", wantkids: 'Open to it', intent: 'Marriage within 1 to 2 years', agemin: '30', agemax: '42', ploc: 'Abuja or Lagos', bio: 'Mother of one, living well and looking forward. I would love to meet someone who will not need my story explained.', circle: true }, { privacy: 'name' }),
      m('m_kemi', 'kemi@example.com', 'pending', { first: 'Kemi', last: 'Alade', gender: 'Woman', dob: '1996-08-19', location: 'Lagos', origin: 'Ondo', lga: 'Akure South', qual: 'HND', job: 'Nurse', religion: 'Christianity', denom: 'Methodist', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 to 2 years', agemin: '28', agemax: '37', ploc: 'Lagos', lookfor: 'Someone patient and dependable.', bio: 'Night-shift nurse who still finds time for Sunday service and long phone calls with my mum.', photos: ['/assets/img/woman-phone.jpg'] },
        { submittedAt: t - 3 * H, payment: { ref: 'NSC-KEMI1' } }),
      m('m_uche', 'uche@example.com', 'pending', { first: 'Uche', last: 'Okonkwo', gender: 'Man', dob: '1994-12-01', location: 'Abuja', origin: 'Anambra', lga: 'Awka South', qual: "Bachelor's degree", job: 'Civil servant', religion: 'Christianity', denom: 'Catholic', marital: 'Never married', genotype: 'AA', children: 'No', wantkids: 'Yes', intent: 'Marriage within 1 year', agemin: '24', agemax: '31', ploc: 'Abuja', bio: 'Simple man, big heart.' },
        { submittedAt: t - 26 * H }),
      m('m_seun', 'seun@example.com', 'changes', { first: 'Seun', last: 'Bakare', gender: 'Man', dob: '1997-03-09', location: 'Lagos', origin: 'Lagos', lga: 'Ikeja', qual: 'OND / NCE', job: 'Entrepreneur', religion: 'Christianity', denom: '', marital: 'Never married', genotype: '', intent: 'Marriage within 1 to 2 years', bio: 'hi' },
        { submittedAt: t - 2 * D, adminNote: 'Please add a clear photo of your face, your genotype, and a few sentences about yourself.' })
    ];
    /* a third of approved members are on Gold; each has a confirmed 3-month payment */
    var prices = defaultSettings().plans, payments = [];
    members.filter(function (x) { return x.status === 'approved'; }).forEach(function (x, k) {
      if (k % 3 === 0) x.plan = 'gold';
      payments.push({ id: 'p_' + x.id, member: x.id, plan: x.plan, months: 3, amount: prices[x.plan]['3'] * 12, ref: x.payment.ref, file: null, status: 'confirmed', note: '', createdAt: t - 16 * D, reviewedAt: t - 15 * D });
    });
    payments.push({ id: 'p_kemi', member: 'm_kemi', plan: 'platinum', months: 3, amount: prices.platinum['3'] * 12, ref: 'NSC-KEMI1',
      file: { name: 'kemi-transfer.jpg', size: '214 KB', type: 'image/jpeg', dataUrl: null }, status: 'uploaded', note: '', createdAt: t - 2 * H, reviewedAt: null });
    return {
      version: 1,
      members: members,
      payments: payments,
      intros: [
        { id: 'i_seed1', from: 'm_tobi', to: 'm_chiamaka', status: 'accepted', note: 'Hello Chiamaka', createdAt: t - 6 * D, respondedAt: t - 6 * D + 3 * H }
      ],
      messages: [
        { id: 'x1', thread: 'i_seed1', from: 'system', body: 'You are now introduced. Be kind, take your time, and keep conversations on NSC until you are comfortable.', at: t - 6 * D + 3 * H },
        { id: 'x2', thread: 'i_seed1', from: 'm_tobi', body: 'Good evening Chiamaka. Thank you for accepting.', at: t - 6 * D + 4 * H },
        { id: 'x3', thread: 'i_seed1', from: 'm_chiamaka', body: 'Good evening Tobi. Nice to meet you.', at: t - 6 * D + 5 * H },
        { id: 'x4', thread: 'support:m_seun', from: 'admin', body: 'Hi Seun, thanks for submitting your profile. Please add a clear photo, your genotype and a few sentences about yourself, then resubmit.', at: t - 2 * D + H },
        { id: 'x5', thread: 'support:m_kemi', from: 'm_kemi', body: 'Good afternoon. I have uploaded my transfer receipt. Reference NSC-KEMI1.', at: t - 2 * H + 60e3 }
      ],
      reports: [],
      notes: [],
      settings: defaultSettings(),
      reads: {},
      activity: [
        { at: t - 2 * H, text: 'Kemi Alade uploaded a payment receipt' },
        { at: t - 3 * H, text: 'Kemi Alade submitted her profile for review' },
        { at: t - 26 * H, text: 'Uche Okonkwo submitted his profile for review' },
        { at: t - 2 * D, text: 'Changes requested for Seun Bakare' }
      ]
    };
  }

  /* ---------- generic table ops ---------- */
  function tx(fn) { var d = db(); var r = fn(d); write(d); return r; }
  function all(t) { return db()[t] || []; }
  function get(t, id) { return all(t).filter(function (r) { return r.id === id; })[0] || null; }
  function insert(t, row) { if (backend) return backend.insert(t, row); return tx(function (d) { d[t].push(row); return row; }); }
  function update(t, id, patch) {
    if (backend) return backend.update(t, id, patch);
    return tx(function (d) {
      var r = d[t].filter(function (x) { return x.id === id; })[0]; if (!r) return null;
      if (typeof patch === 'function') patch(r); else Object.assign(r, patch);
      return r;
    });
  }

  function remove(t, id) {
    if (backend) return backend.remove(t, id);
    return tx(function (d) { d[t] = d[t].filter(function (x) { return x.id !== id; }); });
  }

  /* ---------- helpers ---------- */
  function hash(pw) {
    var data = new TextEncoder().encode('nsc:' + pw);
    return crypto.subtle.digest('SHA-256', data).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function age(dob) {
    if (!dob) return null; var b = new Date(dob), n = new Date();
    var a = n.getFullYear() - b.getFullYear(); if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return isNaN(a) ? null : a;
  }
  function fullName(mem) { var pr = mem.profile || {}; return ((pr.first || '') + ' ' + (pr.last || '')).trim() || mem.email; }
  function initials(mem) { var pr = mem.profile || {}; return (((pr.first || mem.email || '?')[0] || '') + ((pr.last || '')[0] || '')).toUpperCase(); }
  function inNigeria(loc) {
    if (!loc) return true; var l = loc.toLowerCase();
    return l.indexOf('nigeria') >= 0 || STATES.some(function (s) { return l.indexOf(s.toLowerCase().replace('fct ', '')) >= 0; }) ||
      ['port harcourt', 'ibadan', 'abeokuta', 'owerri', 'aba', 'calabar', 'uyo', 'warri', 'benin', 'jos', 'ilorin', 'zaria', 'onitsha', 'akure', 'nsukka'].some(function (c) { return l.indexOf(c) >= 0; });
  }
  function breaks(viewer, other) {
    var a = viewer.profile, b = other.profile, db_ = a.dealbreakers || [];
    if (db_.indexOf('Different religion') >= 0 && a.religion && b.religion && a.religion !== b.religion) return true;
    if (db_.indexOf('Has children') >= 0 && b.children && b.children !== 'No') return true;
    if (db_.indexOf('Previously married') >= 0 && b.marital && b.marital !== 'Never married') return true;
    if (db_.indexOf('Lives outside Nigeria') >= 0 && !inNigeria(b.location)) return true;
    if (db_.indexOf('Incompatible genotype') >= 0 && genoRisk(a.genotype, b.genotype)) return true;
    return false;
  }
  /* nationality: matches only appear when both people are open to each other's group */
  function groupOf(mem) { var pr = mem.profile || {}; return (!pr.nationality || pr.nationality === 'Nigeria' || pr.heritage === 'Yes') ? 'nigerian' : 'international'; }
  function accepts(a, b) { var o = (a.profile || {}).openTo || 'both'; return o === 'both' || o === groupOf(b); }
  /* Private Circle: members living with HIV who opted in are matched only with each other */
  function eligible(a, b) { return active(a) && active(b) && accepts(a, b) && accepts(b, a) && !!a.profile.circle === !!b.profile.circle; }

  /* ---------- membership ---------- */
  function active(mem) { return !!mem && mem.status === 'approved' && (mem.paidUntil || 0) > now(); }
  function planPrice(plan, months) {
    var s = NSC.settings(), d = defaultSettings().plans[plan] || {}, pp = (s.plans || {})[plan] || {};
    var w = +pp[months] || +d[months] || 0, base = +pp['1'] || +d['1'] || w;
    return { weekly: w, total: w * months * 4, save: base > w ? Math.round((1 - w / base) * 100) : 0 };
  }
  function paymentsOf(id) { return all('payments').filter(function (x) { return x.member === id; }).sort(function (a, b) { return b.createdAt - a.createdAt; }); }
  function membership(mem) {
    var ps = paymentsOf(mem.id);
    return { active: active(mem), plan: mem.plan || null, until: mem.paidUntil || null, credit: mem.creditMonths || 0,
      pending: ps.filter(function (x) { return x.status === 'uploaded'; })[0] || null, last: ps[0] || null,
      paid: ps.some(function (x) { return x.status === 'confirmed'; }), list: ps };
  }
  /* the same rules the database applies (schema.sql: payment_after, member_membership) */
  function applyPayment(r, pay) {
    r.plan = pay.plan;
    if (r.status === 'approved') r.paidUntil = addMonths(Math.max(r.paidUntil || 0, now()), pay.months);
    else r.creditMonths = (r.creditMonths || 0) + pay.months;
  }
  function applyCredit(r) { if (r.creditMonths > 0) { r.paidUntil = addMonths(Math.max(r.paidUntil || 0, now()), r.creditMonths); r.creditMonths = 0; } }
  function confirmPayment(pid) {
    var pay = update('payments', pid, { status: 'confirmed', reviewedAt: now() }); if (!pay) return null;
    update('members', pay.member, function (r) { applyPayment(r, pay); });
    return pay;
  }
  function grantMembership(memberId, plan, months, note) {
    var mem = get('members', memberId); if (!mem) return null;
    var pay = insert('payments', { id: uid('p_'), member: memberId, plan: plan, months: months, amount: 0, ref: mem.payment.ref, file: null, status: 'confirmed', note: note || 'Added by the NSC team', createdAt: now(), reviewedAt: now() });
    if (pay) update('members', memberId, function (r) { applyPayment(r, pay); });
    return pay;
  }
  function introsLeft(mem) {
    if (!mem || mem.plan !== 'gold') return Infinity;
    var used = all('intros').filter(function (i) { return i.from === mem.id && now() - i.createdAt < 30 * D; }).length;
    return Math.max(0, (+NSC.settings().goldIntroLimit || 5) - used);
  }
  function genoRisk(g1, g2) { return CARRIERS.indexOf(g1) >= 0 && CARRIERS.indexOf(g2) >= 0; }
  function inRange(ageV, min, max) { if (ageV == null) return true; return (!min || ageV >= +min) && (!max || ageV <= +max); }
  function compat(a, b) {
    var A = a.profile, B = b.profile, s = 48;
    if (A.religion && A.religion === B.religion) s += 16;
    if (A.denom && B.denom && A.denom.toLowerCase() === B.denom.toLowerCase()) s += 4;
    if (A.intent && A.intent === B.intent) s += 9; else if (A.intent && B.intent) s += 4;
    if (inRange(age(B.dob), A.agemin, A.agemax)) s += 7;
    if (inRange(age(A.dob), B.agemin, B.agemax)) s += 5;
    if (A.wantkids && A.wantkids === B.wantkids) s += 5;
    if (A.location && B.location && A.location.split(',')[0].trim().toLowerCase() === B.location.split(',')[0].trim().toLowerCase()) s += 5;
    else if (A.origin && A.origin === B.origin) s += 3;
    if (genoRisk(A.genotype, B.genotype)) s -= 12;
    return Math.max(35, Math.min(97, s));
  }

  /* intros + visibility */
  function introBetween(a, b) {
    return all('intros').filter(function (i) { return (i.from === a && i.to === b) || (i.from === b && i.to === a); })
      .sort(function (x, y) { return y.createdAt - x.createdAt; })[0] || null;
  }
  function connected(a, b) { var i = introBetween(a, b); return !!(i && i.status === 'accepted'); }
  function view(mem, viewerId) {
    var open = viewerId === 'admin' || viewerId === mem.id || connected(mem.id, viewerId);
    var pr = mem.profile, mode = mem.privacy || 'full';
    var showName = open || mode !== 'name', showPhoto = open || mode === 'full';
    return {
      id: mem.id,
      name: showName ? (pr.first || 'Member') : initials(mem).split('').join('. ') + '.',
      initials: initials(mem),
      photo: showPhoto ? (pr.photos || [])[0] || null : null,
      photos: showPhoto ? pr.photos || [] : [],
      age: age(pr.dob),
      hiddenPhoto: !showPhoto && (pr.photos || []).length > 0,
      open: open
    };
  }
  function religionLabel(r) { return { Christianity: 'Christian', Islam: 'Muslim', 'Traditional religion': 'Traditional' }[r] || r || ''; }

  /* threads */
  function supportThread(id) { return 'support:' + id; }
  function threadMessages(thread) { return all('messages').filter(function (x) { return x.thread === thread; }).sort(function (a, b) { return a.at - b.at; }); }
  function lastRead(reader, thread) { return (db().reads || {})[reader + '|' + thread] || 0; }
  function markRead(reader, thread) { if (backend) return backend.markRead(reader, thread); tx(function (d) { d.reads = d.reads || {}; d.reads[reader + '|' + thread] = now(); }); }
  function unread(reader, thread) {
    var lr = lastRead(reader, thread);
    return threadMessages(thread).filter(function (x) { return x.at > lr && x.from !== reader && x.from !== 'system'; }).length;
  }
  function threadsFor(memberId) {
    var me = get('members', memberId); if (!me) return [];
    var out = all('intros').filter(function (i) { return i.status === 'accepted' && (i.from === memberId || i.to === memberId); }).map(function (i) {
      var otherId = i.from === memberId ? i.to : i.from, other = get('members', otherId);
      if (!other || (me.blocked || []).indexOf(otherId) >= 0 || (other.blocked || []).indexOf(memberId) >= 0) return null;
      return { id: i.id, kind: 'intro', other: other, intro: i };
    }).filter(Boolean);
    out.push({ id: supportThread(memberId), kind: 'support', other: null });
    out.forEach(function (t) {
      var ms = threadMessages(t.id); t.last = ms[ms.length - 1] || null; t.unread = unread(memberId, t.id);
      t.sortAt = t.last ? t.last.at : (t.intro ? t.intro.respondedAt || t.intro.createdAt : 0);
    });
    return out.sort(function (a, b) { return b.sortAt - a.sortAt; });
  }
  function send(thread, from, body) {
    body = String(body || '').trim(); if (!body) return null;
    return insert('messages', { id: NSC.uid('msg_'), thread: thread, from: from, body: body.slice(0, 2000), at: now() });
  }
  /* items: [{ thread, body }] */
  function sendMany(items, from) { return items.map(function (i) { return send(i.thread, from, i.body); }); }
  function log(text) { if (backend) return backend.log(text); tx(function (d) { d.activity.unshift({ at: now(), text: text }); d.activity = d.activity.slice(0, 200); }); }

  /* demo behaviour: seeded members respond so the flow can be reviewed alone */
  var demoLines = [
    'Thank you for your message. How has your week been?',
    'That is lovely to hear. What does a good weekend look like for you?',
    'I agree. Family and faith are very important to me too.',
    'I would like to keep talking. Have a blessed evening.'
  ];
  function demoReply(thread, demoId, delay) {
    if (backend) return;
    var mem = get('members', demoId); if (!mem || !mem.demo) return;
    setTimeout(function () {
      var mine = threadMessages(thread).filter(function (x) { return x.from === demoId; }).length;
      send(thread, demoId, demoLines[Math.min(mine, demoLines.length - 1)]);
    }, delay || 2200);
  }
  function demoAccept(introId, delay) {
    if (backend) return;
    setTimeout(function () {
      var i = get('intros', introId); if (!i || i.status !== 'pending') return;
      var to = get('members', i.to); if (!to || !to.demo) return;
      acceptIntro(introId);
      setTimeout(function () { send(introId, i.to, 'Hello! Thank you for the request. I am glad to be introduced.'); }, 1200);
    }, delay || 3500);
  }
  function acceptIntro(id) {
    var i = update('intros', id, { status: 'accepted', respondedAt: now() });
    if (i && !backend) insert('messages', { id: uid('msg_'), thread: id, from: 'system', body: 'You are now introduced. Be kind, take your time, and keep conversations on NSC until you are comfortable.', at: now() });
    return i;
  }
  /* when admin approves a member, demo members of the opposite gender send two requests */
  function onApproved(memberId) {
    if (backend) return;
    var me = get('members', memberId); if (!me) return;
    var want = me.profile.gender === 'Man' ? 'Woman' : me.profile.gender === 'Woman' ? 'Man' : null;
    var notes = ['I liked what you wrote about the home you want to build. I would love to be introduced.', 'We seem to share a lot of the same values. Would you be open to an introduction?'];
    var picks = all('members').filter(function (x) {
      return x.demo && x.status === 'approved' && x.id !== memberId && (!want || x.profile.gender === want) && eligible(me, x) && (me.profile.circle || (x.profile.photos || []).length) && !introBetween(x.id, memberId);
    }).slice(0, 2);
    picks.forEach(function (x, k) { insert('intros', { id: uid('i_'), from: x.id, to: memberId, status: 'pending', note: notes[k], createdAt: now() - k * 3600e3 }); });
  }

  /* time */
  function ago(ts) {
    var s = Math.round((now() - ts) / 1000);
    if (s < 60) return 'Just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 172800) return 'Yesterday'; return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function clock(ts) { return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function day(ts) {
    var d = new Date(ts), n = new Date(); var y = new Date(); y.setDate(n.getDate() - 1);
    if (d.toDateString() === n.toDateString()) return 'Today'; if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* sessions: per tab, so two tabs can be two different members */
  function ss(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || localStorage.getItem(k + '.keep') || 'null'); if (v === null) { sessionStorage.removeItem(k); localStorage.removeItem(k + '.keep'); } else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  var NSC = window.NSC = {
    STATES: STATES,
    uid: uid, all: all, get: get, insert: insert, update: update, tx: tx,
    on: function (f) { listeners.push(f); },
    reset: function () { if (backend) return; try { localStorage.removeItem(KEY); } catch (e) {} cache = null; db(); },
    mode: 'demo',
    /* resolves once the signed-in person and their data are loaded */
    ready: function () { return Promise.resolve(); },
    _useBackend: function (b) { backend = b; NSC.mode = 'cloud'; },
    _emit: emit,
    /* images: demo keeps them as data URLs; cloud uploads to Supabase Storage */
    uploadImage: function (dataUrl) { return Promise.resolve(dataUrl); },
    uploadReceipt: function (file, dataUrl) { return Promise.resolve({ name: file.name, type: file.type, dataUrl: dataUrl || null }); },
    receiptUrl: function (f) { return Promise.resolve(f && f.dataUrl || null); },
    error: function (msg) { try { window.dispatchEvent(new CustomEvent('nsc:error', { detail: msg })); } catch (e) {} console.warn('NSC:', msg); },
    settings: function () { return Object.assign(defaultSettings(), db().settings || {}); },
    saveSettings: function (data) { tx(function (d) { d.settings = Object.assign(defaultSettings(), d.settings, data); }); return Promise.resolve(); },
    team: {
      list: function () { return [{ user_id: 'admin', email: ADMIN.email, added_at: new Date(now() - 30 * D).toISOString() }]; },
      load: function () { return Promise.resolve(); },
      add: function () { return Promise.reject(new Error('Adding team members needs Supabase. Demo data has a single team login.')); },
      remove: function () { return Promise.reject(new Error('The team needs at least one person.')); }
    },
    /* permanent: the member and everything linked to them */
    deleteMember: function (id) {
      tx(function (d) {
        var intros = d.intros.filter(function (i) { return i.from === id || i.to === id; }).map(function (i) { return i.id; });
        d.members = d.members.filter(function (x) { return x.id !== id; });
        d.intros = d.intros.filter(function (i) { return intros.indexOf(i.id) < 0; });
        d.messages = d.messages.filter(function (x) { return x.thread !== supportThread(id) && x.from !== id && intros.indexOf(x.thread) < 0; });
        d.reports = d.reports.filter(function (r) { return r.by !== id && r.about !== id; });
        d.notes = d.notes.filter(function (n) { return n.member !== id; });
        d.payments = d.payments.filter(function (x) { return x.member !== id; });
      });
      log('A member account was permanently deleted');
      return Promise.resolve();
    },
    needsUpgrade: false,
    PLAN_NAMES: PLAN_NAMES, TERMS: TERMS, active: active, planPrice: planPrice, paymentsOf: paymentsOf, membership: membership,
    applyCredit: applyCredit, confirmPayment: confirmPayment, grantMembership: grantMembership, introsLeft: introsLeft,
    rejectPayment: function (pid, note) { return update('payments', pid, { status: 'rejected', note: note || '', reviewedAt: now() }); },
    remove: remove,
    COUNTRIES: COUNTRIES, groupOf: groupOf, accepts: accepts, eligible: eligible,
    hash: hash, age: age, fullName: fullName, initials: initials, compat: compat, breaks: breaks, genoRisk: genoRisk,
    view: view, connected: connected, introBetween: introBetween, religionLabel: religionLabel,
    supportThread: supportThread, threadMessages: threadMessages, threadsFor: threadsFor, send: send, sendMany: sendMany, unread: unread, markRead: markRead,
    acceptIntro: acceptIntro, onApproved: onApproved, demoReply: demoReply, demoAccept: demoAccept, log: log,
    ago: ago, clock: clock, day: day, esc: esc,
    memberByLogin: function (idf) {
      idf = String(idf || '').trim().toLowerCase(); var digits = idf.replace(/\D/g, '').slice(-10);
      return all('members').filter(function (x) { return x.email.toLowerCase() === idf || (digits.length === 10 && (x.phone || '').replace(/\D/g, '').slice(-10) === digits); })[0] || null;
    },
    session: {
      get: function () { return ss('nsc.session'); },
      set: function (id, keep) { ss('nsc.session', { id: id }); try { if (keep) localStorage.setItem('nsc.session.keep', JSON.stringify({ id: id })); } catch (e) {} },
      clear: function () { ss('nsc.session', null); }
    },
    admin: {
      email: ADMIN.email,
      check: function (email, pw) { return hash(pw).then(function (h) { return String(email).trim().toLowerCase() === ADMIN.email && h === ADMIN.hash; }); },
      get: function () { return ss('nsc.admin'); },
      set: function () { ss('nsc.admin', { at: now() }); },
      clear: function () { ss('nsc.admin', null); }
    }
  };
})();
