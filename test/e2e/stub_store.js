/* TEST-ONLY stub of the Store interface (ARCHITECTURE.md), never served in production.
 * Served by test/e2e/server.py at /store.js AFTER the real site/store.js (so FinStoreLib.normalizeBackup is the real one).
 * Backend: the e2e server's /__stub/* endpoints (shared by every browser context => PC <-> phone sync tests).
 * Config (window.__STUB, set by the test via add_init_script):
 *   { ns: 'abc', mode: 'netlify'|'local', user: {id,email}|null, loginUser: {id,email}, pollMs: 400 }
 */
(function () {
  'use strict';
  const real = window.FinStoreLib || {};
  function createStubStore() {
    const cfg = Object.assign({ ns: 'default', mode: 'netlify', user: { id: 'u1', email: 'eu@exemplo.com' }, pollMs: 400 }, window.__STUB || {});
    const q = '?ns=' + encodeURIComponent(cfg.ns);
    const ev = () => { let f = []; return { on(fn) { f.push(fn); return () => { f = f.filter(x => x !== fn); }; }, emit(x) { f.slice().forEach(fn => { try { fn(x); } catch (e) { console.error(e); } }); } }; };
    const auth = ev(), stat = ev(), remote = ev();
    let user = cfg.user || null, status = 'signed_out', seq = 0, snap = { meta: {}, months: {} }, pending = 0, timer = null;
    const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
    const setStatus = s => { if (s !== status) { status = s; stat.emit(s); } };
    const idle = () => setStatus(cfg.mode === 'local' ? 'local' : (user ? 'synced' : 'signed_out'));
    async function get() { const r = await fetch('/__stub/state' + q, { cache: 'no-store' }); return r.json(); }
    async function post(path, body) {
      if (cfg.mode === 'netlify' && !user) throw new Error('Entre para sincronizar.');
      pending++; setStatus('saving');
      try { const r = await fetch('/__stub/' + path + q, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); return j; }
      finally { pending--; if (!pending) idle(); }
    }
    const live = rows => (rows || []).filter(r => r && !r.deleted);
    function shape(state) {
      const out = { meta: {}, months: {} };
      ['settings', 'categories', 'rules', 'profiles', 'accounts', 'imports'].forEach(n => { out.meta[n] = state.meta[n] === undefined ? null : state.meta[n]; });
      Object.keys(state.months).sort().forEach(ym => { const l = live(state.months[ym]); if (l.length) out.months[ym] = l; });
      return out;
    }
    async function poll() {
      if (cfg.mode === 'netlify' && !user) return;
      let st;
      try { st = await get(); } catch (e) { setStatus('offline'); return; }
      if (st.seq <= seq) return;
      const prev = snap; seq = st.seq; snap = st;
      if (pending) return;
      for (const n of Object.keys(st.meta)) if (JSON.stringify(prev.meta[n]) !== JSON.stringify(st.meta[n])) remote.emit({ kind: 'meta', key: n, data: clone(st.meta[n]) });
      const yms = new Set(Object.keys(prev.months).concat(Object.keys(st.months)));
      for (const ym of yms) {
        const a = live(prev.months[ym]), b = live(st.months[ym]);
        if (JSON.stringify(a) !== JSON.stringify(b)) remote.emit({ kind: 'month', key: ym, data: clone(b), deleted: !b.length });
      }
    }
    const api = {
      get status() { return status; }, get mode() { return cfg.mode; }, get user() { return user ? { id: user.id, email: user.email } : null; },
      async init() {
        const st = await get(); seq = st.seq; snap = st;
        idle();
        if (!timer && cfg.pollMs) timer = setInterval(poll, cfg.pollMs);
        return { mode: cfg.mode, user: api.user };
      },
      async login() { user = cfg.loginUser || cfg.user || { id: 'u1', email: 'eu@exemplo.com' }; idle(); auth.emit({ user: api.user }); return api.user; },
      async logout() { user = null; idle(); auth.emit({ user: null }); },
      onAuth: fn => auth.on(fn), onStatus: fn => stat.on(fn), subscribe: fn => remote.on(fn),
      async loadAll() { if (cfg.mode === 'netlify' && !user) return { meta: {}, months: {} }; const st = await get(); seq = st.seq; snap = st; return shape(st); },
      async saveMeta(name, data) { const r = await post('meta/' + name, data); if (r && r.seq) { seq = r.seq; snap = r.state; } },
      async saveMonth(ym, txs) { const r = await post('month/' + ym, txs); if (r && r.seq) { seq = r.seq; snap = r.state; } },
      async deleteMonth(ym) { const r = await post('month/' + ym, []); if (r && r.seq) { seq = r.seq; snap = r.state; } },
      async exportAll() { const d = await api.loadAll(); return { app: 'financas-flow', version: 2, exportedAt: new Date().toISOString(), meta: d.meta, months: d.months }; },
      parseBackup: obj => real.normalizeBackup(obj),
      async importAll(obj) {
        const n = real.normalizeBackup(obj);
        const cur = await api.loadAll();
        for (const name of Object.keys(n.meta)) await api.saveMeta(name, n.meta[name]);
        const now = new Date().toISOString();
        const yms = new Set(Object.keys(n.months).concat(Object.keys(cur.months)));
        for (const ym of yms) await api.saveMonth(ym, (n.months[ym] || []).map(t => Object.assign({}, t, { updatedAt: now })));
        return n.stats;
      },
      sync: poll
    };
    return api;
  }
  window.createStore = function () { return createStubStore(); };
})();
