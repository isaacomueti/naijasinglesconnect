/*
 * NSC's own visit counter. Records page views, logins and sign-ups in public.events
 * (supabase/schema.sql). No cookies and no third parties: a random visitor ID is kept in
 * this browser, and the database links signed-in visits to the account itself.
 * Respects "Do Not Track", and only counts on the live site (add ?track=1 to test elsewhere).
 */
(function () {
  'use strict';
  var CFG = window.NSC_CONFIG || {};
  var live = /(^|\.)naijasinglesconnect\.com$/.test(location.hostname) || /[?&]track=1/.test(location.search);
  var dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';
  var demo = false; try { demo = sessionStorage.getItem('nsc.mode') === 'demo' || /[?&]demo=1/.test(location.search); } catch (e) {}
  var on = !!(CFG.supabaseUrl && CFG.supabaseKey && live && !dnt && !demo);
  var ref = CFG.supabaseUrl ? new URL(CFG.supabaseUrl).hostname.split('.')[0] : '';

  function id(store, key) {
    try {
      var v = store.getItem(key);
      if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 32); store.setItem(key, v); }
      return v;
    } catch (e) { return ''; }
  }
  function device() { var w = Math.min(screen.width || innerWidth, innerWidth); return w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop'; }
  /* the signed-in person's token, so the database can tell who it is */
  function token() {
    try {
      var key = /^\/admin/.test(location.pathname) ? 'sb-' + ref + '-admin-auth' : 'sb-' + ref + '-auth-token';
      var s = JSON.parse(localStorage.getItem(key) || 'null');
      return s && s.access_token && s.expires_at * 1000 > Date.now() ? s.access_token : null;
    } catch (e) { return null; }
  }
  function referrer() {
    try { if (!document.referrer) return ''; var u = new URL(document.referrer); return u.hostname === location.hostname ? '' : u.hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  /* dashboard sections are pages of their own; elsewhere a #link is just a jump down the page */
  function here() { return location.pathname + (/^\/dashboard/.test(location.pathname) && /^#[a-z]+/.test(location.hash) ? location.hash.split('/')[0] : ''); }
  function send(kind, opts) {
    if (!on) return;
    opts = opts || {};
    var body = { kind: kind, path: (opts.path || here()).slice(0, 200),
      referrer: kind === 'view' ? referrer().slice(0, 200) : '', visitor: id(localStorage, 'nsc.vid'), session: id(sessionStorage, 'nsc.sid'), device: device() };
    try {
      fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/events', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + (opts.token || token() || CFG.supabaseKey), Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {}
  }
  window.nscTrack = send;

  /* team pages count logins only; everything else counts each page, and each dashboard section */
  if (!/^\/admin/.test(location.pathname)) {
    var last = '';
    var view = function () { var p = here(); if (p !== last) { last = p; send('view'); } };
    view();
    window.addEventListener('hashchange', view);
  }
})();
