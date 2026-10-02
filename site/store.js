/* Finanças Flow — store.js
 * A ÚNICA camada de persistência/autenticação usada pelo app (ver ARCHITECTURE.md).
 *
 *   window.FinStore = createStore({ mode })   // "netlify" | "local" | "auto" (padrão)
 *
 * Adaptadores:
 *  - "netlify": login com Netlify Identity (lib @netlify/identity vendorizada em /vendor),
 *    dados na API /api/* (Netlify Functions + Blobs), cache local (IndexedDB → localStorage),
 *    fila de escrita offline, sondagem a cada 20 s com a aba visível e imediata em
 *    focus/visibilitychange/online. Eventos de mudança remota só para o que NÃO veio deste aparelho.
 *  - "local": tudo no localStorage (desenvolvimento/testes).
 *
 * Formatos dos documentos "meta" (iguais aos docs da v1, o store não interpreta o conteúdo):
 *   settings   { budgets:{}, ... }        categories { items:[...] }    rules { rules:[], history:[] }
 *   profiles   { items:[...] }            accounts   { items:[...] }    imports (livre, definido pelo app)
 * Meses: Transaction[] (cada uma com id e updatedAt ISO). Exclusões viram tombstones
 * {id, deleted:true, updatedAt} (mantidos 90 dias) — o app nunca vê tombstones.
 *
 * Script clássico (sem módulos) para funcionar com CSP script-src 'self'. Também carrega em node
 * (module.exports) para os testes.
 */
(function (root) {
  'use strict';

  var META_NAMES = ['settings', 'categories', 'rules', 'profiles', 'accounts', 'imports'];
  var YM_RE = /^\d{4}-(0[1-9]|1[0-2])(~\d+)?$/;
  var TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;
  var AUTH_HASH_RE = /^#(confirmation_token|recovery_token|invite_token|email_change_token|access_token|error)=/;
  var DEFAULT_POLL_MS = 20000;
  var LS_LOCAL_KEY = 'ff2:local';
  var LS_MODE_KEY = 'ff2:mode';

  var SCRIPT_SRC = (function () {
    try { return (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || null; } catch (e) { return null; }
  })();

  /* ------------------------------------------------------------------ utilidades */
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined; });
    var kb = Object.keys(b).filter(function (k) { return b[k] !== undefined; });
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) if (!deepEqual(a[ka[j]], b[ka[j]])) return false;
    return true;
  }
  function ts(row) {
    var t = row && typeof row.updatedAt === 'string' ? Date.parse(row.updatedAt) : NaN;
    return isFinite(t) ? t : 0;
  }
  function withoutStamp(r) { var c = Object.assign({}, r); delete c.updatedAt; return c; }
  function baseYm(key) { return String(key).split('~')[0]; }
  function emitter() {
    var fns = [];
    return {
      on: function (fn) { fns.push(fn); return function () { fns = fns.filter(function (f) { return f !== fn; }); }; },
      emit: function (ev) { fns.slice().forEach(function (f) { try { f(ev); } catch (e) { if (root.console) console.error(e); } }); },
    };
  }

  /** Mescla linhas por id: updatedAt mais novo vence; empate → tombstone vence. Igual ao servidor. */
  function mergeRows(a, b, nowMs) {
    var map = new Map();
    (a || []).forEach(function (r) { if (r && typeof r.id === 'string') map.set(r.id, r); });
    (b || []).forEach(function (r) {
      if (!r || typeof r.id !== 'string') return;
      var ex = map.get(r.id);
      if (!ex) { map.set(r.id, r); return; }
      var x = ts(r), y = ts(ex);
      if (x > y || (x === y && r.deleted && !ex.deleted) || (x === y && !!r.deleted === !!ex.deleted)) map.set(r.id, r);
    });
    var out = [];
    map.forEach(function (r) { if (!(r.deleted && nowMs != null && nowMs - ts(r) > TOMBSTONE_TTL_MS)) out.push(r); });
    return out;
  }
  function liveRows(rows) { return (rows || []).filter(function (r) { return r && !r.deleted; }); }

  /**
   * Merge de 3 vias para docs "meta" quando dois aparelhos salvaram ao mesmo tempo.
   * Objetos: campo a campo. Arrays de objetos com id: por id (inclusões dos dois lados ficam,
   * exclusões só se o outro lado não mexeu). Outros arrays: local + novidades remotas.
   * Valores simples: vence o local (é a ação mais recente do usuário neste aparelho).
   */
  function merge3(base, local, remote) {
    if (deepEqual(local, remote)) return clone(local);
    if (deepEqual(local, base)) return clone(remote);
    if (deepEqual(remote, base)) return clone(local);
    if (local === undefined) return base === undefined ? clone(remote) : undefined; // apagado aqui, mudado lá: respeita a exclusão só se lá não mudou (já tratado acima)
    if (remote === undefined) return base === undefined ? clone(local) : clone(local);
    if (isObj(local) && isObj(remote)) {
      var b = isObj(base) ? base : {};
      var out = {};
      var keys = Object.keys(local).concat(Object.keys(remote).filter(function (k) { return !(k in local); }));
      keys.forEach(function (k) {
        var l = local[k], r = remote[k], bb = b[k];
        if (l === undefined && r !== undefined) { if (bb !== undefined && deepEqual(r, bb)) return; out[k] = clone(r); return; }
        if (r === undefined && l !== undefined) { if (bb !== undefined && deepEqual(l, bb)) return; out[k] = clone(l); return; }
        var m = merge3(bb, l, r); if (m !== undefined) out[k] = m;
      });
      return out;
    }
    var hasIds = function (arr) { return Array.isArray(arr) && arr.every(function (x) { return isObj(x) && typeof x.id === 'string'; }); };
    if (hasIds(local) && hasIds(remote) && (base === undefined || hasIds(base))) {
      var bm = new Map((base || []).map(function (x) { return [x.id, x]; }));
      var rm = new Map(remote.map(function (x) { return [x.id, x]; }));
      var lm = new Map(local.map(function (x) { return [x.id, x]; }));
      var res = [];
      local.forEach(function (l) {
        var r = rm.get(l.id), bb = bm.get(l.id);
        if (r === undefined) { if (bb !== undefined && deepEqual(l, bb)) return; res.push(clone(l)); return; }
        res.push(merge3(bb, l, r));
      });
      remote.forEach(function (r) {
        if (lm.has(r.id)) return;
        var bb = bm.get(r.id);
        if (bb !== undefined && deepEqual(r, bb)) return; // apagado aqui
        res.push(clone(r));
      });
      return res;
    }
    if (Array.isArray(local) && Array.isArray(remote)) {
      var seen = new Set(local.map(function (x) { return JSON.stringify(x); }));
      var baseSet = new Set((Array.isArray(base) ? base : []).map(function (x) { return JSON.stringify(x); }));
      var out2 = clone(local);
      remote.forEach(function (x) { var s = JSON.stringify(x); if (!seen.has(s) && !baseSet.has(s)) { out2.push(clone(x)); seen.add(s); } });
      return out2;
    }
    return clone(local);
  }

  /* --------------------------------------------------------- importação de backups */
  /**
   * Aceita: backup v2 {version:2, meta:{}, months:{ym:[...]}}; backup v1 do artifact
   * {app:'financas-flow', version:1, data:{settings,categories,rules,history,profiles,accounts,txs}}
   * (ou o "data" sozinho); e o db bruto da v1 {meta:{...}, months:{"YYYY-MM[~n]":{transactions:[]}}}.
   * Devolve {meta:{name:data}, months:{ym: Transaction[]}, stats}.
   */
  function normalizeBackup(obj) {
    if (typeof obj === 'string') obj = JSON.parse(obj);
    if (!isObj(obj)) throw new Error('Arquivo de backup inválido.');
    var meta = {}, months = {}, stats = { transactions: 0, skipped: 0, months: 0, format: '' };
    var addTx = function (ymKey, t) {
      if (!isObj(t) || typeof t.id !== 'string' || !t.id || t.deleted) { stats.skipped++; return; }
      var ym = ymKey;
      if (typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.date)) ym = t.date.slice(0, 7);
      if (!ym || !YM_RE.test(ym)) { stats.skipped++; return; }
      ym = baseYm(ym);
      var list = months[ym] || (months[ym] = []);
      var i = list.findIndex(function (x) { return x.id === t.id; });
      if (i >= 0) { if (ts(t) >= ts(list[i])) list[i] = t; } else { list.push(t); stats.transactions++; }
    };
    var wrapMetaV1 = function (name, v) {
      if (v === undefined || v === null) return undefined;
      if (name === 'settings') return isObj(v) ? v : undefined;
      if (name === 'rules') return Array.isArray(v) ? { rules: v, history: [] } : (isObj(v) ? { rules: v.rules || [], history: v.history || [] } : undefined);
      if (name === 'imports') return v;
      return Array.isArray(v) ? { items: v } : (isObj(v) && Array.isArray(v.items) ? v : undefined);
    };

    var data = obj.data && isObj(obj.data) ? obj.data : obj;
    if (obj.version === 2 || (isObj(obj.meta) && isObj(obj.months) && Object.keys(obj.months).every(function (k) { return Array.isArray(obj.months[k]); }) && !obj.data)) {
      stats.format = 'v2';
      META_NAMES.forEach(function (n) { if (obj.meta && obj.meta[n] !== undefined && obj.meta[n] !== null) meta[n] = obj.meta[n]; });
      Object.keys(obj.months || {}).forEach(function (k) { (obj.months[k] || []).forEach(function (t) { addTx(k, t); }); });
    } else if (isObj(data.meta) || isObj(data.months)) {
      stats.format = 'v1-db';
      var m = data.meta || {};
      META_NAMES.forEach(function (n) { var w = wrapMetaV1(n, m[n]); if (w !== undefined) meta[n] = w; });
      Object.keys(data.months || {}).forEach(function (k) {
        var doc = data.months[k];
        var rows = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.transactions) ? doc.transactions : []);
        rows.forEach(function (t) { addTx(baseYm(k), t); });
      });
    } else if (Array.isArray(data.txs)) {
      stats.format = 'v1-backup';
      if (isObj(data.settings)) meta.settings = data.settings;
      if (Array.isArray(data.categories)) meta.categories = { items: data.categories };
      if (Array.isArray(data.rules) || Array.isArray(data.history)) meta.rules = { rules: data.rules || [], history: data.history || [] };
      if (Array.isArray(data.profiles)) meta.profiles = { items: data.profiles };
      if (Array.isArray(data.accounts)) meta.accounts = { items: data.accounts };
      if (data.imports !== undefined) meta.imports = data.imports;
      data.txs.forEach(function (t) { addTx(null, t); });
    } else {
      throw new Error('Este arquivo não parece um backup do Finanças Flow.');
    }
    stats.months = Object.keys(months).length;
    return { meta: meta, months: months, stats: stats };
  }

  /* ------------------------------------------------------------- armazenamento local */
  function makeLocalStorageKV(ls) {
    return {
      kind: 'localStorage',
      get: function (k) { try { var v = ls.getItem(k); return Promise.resolve(v == null ? null : JSON.parse(v)); } catch (e) { return Promise.resolve(null); } },
      set: function (k, v) { try { ls.setItem(k, JSON.stringify(v)); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); } },
      del: function (k) { try { ls.removeItem(k); } catch (e) { /* ignore */ } return Promise.resolve(); },
    };
  }
  function makeMemoryKV() {
    var m = new Map();
    return {
      kind: 'memory',
      get: function (k) { return Promise.resolve(m.has(k) ? clone(m.get(k)) : null); },
      set: function (k, v) { m.set(k, clone(v)); return Promise.resolve(true); },
      del: function (k) { m.delete(k); return Promise.resolve(); },
    };
  }
  function makeIdbKV(idb) {
    var dbp = null;
    var open = function () {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        var rq = idb.open('financas-flow', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
        rq.onblocked = function () { reject(new Error('idb blocked')); };
      });
      return dbp;
    };
    var run = function (mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('kv', mode); var st = tx.objectStore('kv'); var rq = fn(st);
          tx.oncomplete = function () { resolve(rq && rq.result); };
          tx.onerror = function () { reject(tx.error); }; tx.onabort = function () { reject(tx.error); };
        });
      });
    };
    return {
      kind: 'indexedDB',
      get: function (k) { return run('readonly', function (s) { return s.get(k); }).then(function (v) { return v === undefined ? null : v; }); },
      set: function (k, v) { return run('readwrite', function (s) { return s.put(v, k); }).then(function () { return true; }); },
      del: function (k) { return run('readwrite', function (s) { return s.delete(k); }); },
    };
  }
  /** IndexedDB se der; senão localStorage; senão memória. Sempre com try/catch. */
  function pickKV(opts, W) {
    if (opts.kv) return Promise.resolve(opts.kv);
    var ls = opts.storage !== undefined ? opts.storage : (function () { try { return W && W.localStorage; } catch (e) { return null; } })();
    var lsKV = ls ? makeLocalStorageKV(ls) : makeMemoryKV();
    var idb = opts.indexedDB !== undefined ? opts.indexedDB : (function () { try { return W && W.indexedDB; } catch (e) { return null; } })();
    if (!idb) return Promise.resolve(lsKV);
    var kv = makeIdbKV(idb);
    return kv.set('__probe', 1).then(function () { return kv; }, function () { return lsKV; });
  }

  /* ------------------------------------------------------------------ createStore */
  function createStore(opts) {
    opts = opts || {};
    var W = opts.window !== undefined ? opts.window : (typeof window !== 'undefined' ? window : null);
    var fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch.bind(root) : null);
    var now = opts.now || function () { return Date.now(); };
    var pollMs = opts.pollMs === undefined ? DEFAULT_POLL_MS : opts.pollMs;
    var lsRaw = opts.storage !== undefined ? opts.storage : (function () { try { return W && W.localStorage; } catch (e) { return null; } })();

    var authEv = emitter(), statusEv = emitter(), remoteEv = emitter();
    var S = {
      mode: null, user: null, status: 'signed_out', identity: null, idSettings: null,
      kv: null, uid: null,
      cache: null,           // {seq, docs:{ "meta:settings": {data, etag, seq}, "month:2026-09": {rows, etag, seq} }}
      pending: null,         // {"meta:settings": {kind, key, op, base?, ver}} (persistido)
      inflight: {}, flushing: null, timer: null, retryTimer: null, backoff: 0,
      local: null, initP: null, listeners: [], lastError: null,
    };

    var api = {
      get status() { return S.status; },
      get mode() { return S.mode; },
      get user() { return S.user ? { id: S.user.id, email: S.user.email } : null; },
      get lastError() { return S.lastError; },
      init: init, login: login, logout: logout,
      onAuth: function (fn) { return authEv.on(fn); },
      onStatus: function (fn) { return statusEv.on(fn); },
      subscribe: function (fn) { return remoteEv.on(fn); },
      loadAll: loadAll, saveMeta: saveMeta, saveMonth: saveMonth, deleteMonth: deleteMonth,
      exportAll: exportAll, importAll: importAll, parseBackup: normalizeBackup,
      sync: function () { return syncNow(); },
      destroy: destroy,
    };

    function setStatus(s) { if (S.status === s) return; S.status = s; statusEv.emit(s); }
    function isOnline() { try { return !(W && W.navigator && W.navigator.onLine === false); } catch (e) { return true; } }
    function lsGet(k) { try { return lsRaw ? lsRaw.getItem(k) : null; } catch (e) { return null; } }
    function lsSet(k, v) { try { if (lsRaw) lsRaw.setItem(k, v); return true; } catch (e) { return false; } }

    /* ---------------- detecção de modo */
    function detectMode() {
      if (opts.mode === 'netlify' || opts.mode === 'local') return Promise.resolve(opts.mode);
      if (!fetchFn) return Promise.resolve('local');
      var remembered = lsGet(LS_MODE_KEY);
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var t = ctl ? setTimeout(function () { ctl.abort(); }, 5000) : null;
      return fetchFn('/.netlify/identity/settings', { cache: 'no-store', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
        .then(function (res) {
          var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
          if (!res.ok || ct.indexOf('json') < 0) return 'local';
          return res.json().then(function (j) { S.idSettings = j; return j && isObj(j) && ('external' in j || 'disable_signup' in j) ? 'netlify' : 'local'; });
        }, function () {
          // sem rede: usa o último modo detectado (abrir offline não pode "trocar" para local)
          if (remembered === 'netlify' || remembered === 'local') return remembered;
          try { if (W && /\.netlify\.app$/.test(W.location.hostname)) return 'netlify'; } catch (e) { /* ignore */ }
          return 'local';
        })
        .then(function (m) { if (t) clearTimeout(t); lsSet(LS_MODE_KEY, m); return m; });
    }

    function loadIdentity() {
      if (opts.identity) return Promise.resolve(typeof opts.identity === 'function' ? opts.identity() : opts.identity);
      var url = new URL('vendor/netlify-identity.js', SCRIPT_SRC || (W && W.location ? W.location.href : 'http://localhost/')).href;
      return import(/* webpackIgnore: true */ url);
    }

    /* ---------------- init */
    function init() {
      if (S.initP) return S.initP;
      S.initP = detectMode().then(function (mode) {
        S.mode = mode;
        if (mode === 'local') return initLocal();
        return initNetlify();
      }).then(function () { return { mode: S.mode, user: api.user }; });
      return S.initP;
    }

    function initLocal() {
      S.local = readLocal();
      setStatus('local');
      S.user = null;
      if (W && W.addEventListener) {
        var onStorage = function (e) {
          if (e.key !== LS_LOCAL_KEY) return;
          var prev = S.local; S.local = readLocal();
          diffAndEmit(prev, S.local);
        };
        W.addEventListener('storage', onStorage); S.listeners.push(['storage', onStorage]);
      }
      return Promise.resolve();
    }
    function readLocal() {
      var raw = lsGet(LS_LOCAL_KEY);
      try { var d = raw ? JSON.parse(raw) : null; if (d && isObj(d.meta) && isObj(d.months)) return d; } catch (e) { /* ignore */ }
      return { meta: {}, months: {} };
    }
    function writeLocal() {
      if (!lsSet(LS_LOCAL_KEY, JSON.stringify(S.local))) { S.lastError = 'Armazenamento do navegador cheio ou bloqueado.'; setStatus('error'); return false; }
      if (S.status === 'error') setStatus('local');
      return true;
    }
    function diffAndEmit(prev, next) {
      META_NAMES.forEach(function (n) {
        if (!deepEqual(prev.meta[n], next.meta[n])) remoteEv.emit({ kind: 'meta', key: n, data: clone(next.meta[n] === undefined ? null : next.meta[n]) });
      });
      var yms = new Set(Object.keys(prev.months).concat(Object.keys(next.months)));
      yms.forEach(function (ym) {
        if (deepEqual(prev.months[ym], next.months[ym])) return;
        var rows = next.months[ym] || [];
        remoteEv.emit({ kind: 'month', key: ym, data: clone(rows), deleted: !rows.length });
      });
    }

    function initNetlify() {
      var idP = loadIdentity().catch(function () { return null; });
      return Promise.all([pickKV(opts, W), idP]).then(function (r) {
        if (!r[1]) {
          S.kv = r[0];
          S.lastError = 'Não consegui carregar o login. Verifique a internet e recarregue a página.';
          setStatus('error');
          return;
        }
        S.kv = r[0]; S.identity = r[1];
        var id = S.identity;
        // eventos do Identity (login/logout em outra aba, renovação de token)
        if (id.onAuthChange) {
          id.onAuthChange(function (event, user) {
            if (event === 'logout') { if (S.user) handleSignedOut(); }
            else if ((event === 'login' || event === 'token_refresh' || event === 'user_updated') && user && (!S.user || S.user.id !== user.id)) handleSignedIn(user);
          });
        }
        if (!S.idSettings && id.getSettings) {
          Promise.resolve().then(function () { return id.getSettings(); }).then(function (st) { if (st && st.providers) S.idSettings = { external: st.providers }; }, function () { /* ignore */ });
        }
        var hash = '';
        try { hash = (W && W.location && W.location.hash) || ''; } catch (e) { hash = ''; }
        var cb = AUTH_HASH_RE.test(hash) && id.handleAuthCallback
          ? id.handleAuthCallback().then(function (res) { clearHash(); return res; }, function (err) { clearHash(); S.lastError = authMsg(err); return { type: 'error', error: err }; })
          : Promise.resolve(null);
        return cb.then(function (res) {
          return Promise.resolve(id.getUser ? id.getUser() : null).catch(function () { return null; }).then(function (user) {
            if (user) return handleSignedIn(user, true).then(function () { return res; });
            setStatus('signed_out');
            return res;
          });
        }).then(function (res) {
          if (res && res.type === 'invite' && res.token) openLogin('invite', { token: res.token });
          else if (res && res.type === 'recovery') openLogin('reset');
          else if (res && res.type === 'error') openLogin('login', { error: S.lastError || 'Não consegui confirmar o link. Ele pode ter expirado.' });
          attachSyncListeners();
        });
      });
    }
    function clearHash() {
      try { if (W && W.history && W.history.replaceState) W.history.replaceState(null, '', W.location.pathname + W.location.search); } catch (e) { /* ignore */ }
    }

    function cacheKey() { return 'ff2:cache:' + S.uid; }
    function queueKey() { return 'ff2:queue:' + S.uid; }
    function persist() {
      if (!S.kv || !S.uid) return Promise.resolve();
      return Promise.all([S.kv.set(cacheKey(), S.cache), S.kv.set(queueKey(), S.pending)]).catch(function () { /* cache é best-effort */ });
    }

    function handleSignedIn(user, silent) {
      var same = S.user && S.user.id === user.id;
      S.user = { id: user.id, email: user.email || '' };
      if (same) return Promise.resolve();
      S.uid = user.id;
      return Promise.all([S.kv.get(cacheKey()), S.kv.get(queueKey())]).then(function (r) {
        S.cache = r[0] && isObj(r[0].docs) ? r[0] : { seq: 0, docs: {} };
        S.pending = isObj(r[1]) ? r[1] : {};
        setStatus(isOnline() ? (Object.keys(S.pending).length ? 'saving' : 'synced') : 'offline');
        authEv.emit({ user: api.user });
        startPolling();
        if (!silent) closeLogin();
        if (Object.keys(S.pending).length) scheduleFlush(0);
      });
    }
    function handleSignedOut() {
      stopPolling();
      var hadPending = S.pending && Object.keys(S.pending).length;
      var uid = S.uid;
      S.user = null; S.uid = null; S.cache = null; S.pending = null; S.inflight = {};
      // privacidade: apaga a cópia local se não houver nada esperando para subir
      if (uid && S.kv && !hadPending) { S.kv.del('ff2:cache:' + uid); S.kv.del('ff2:queue:' + uid); }
      setStatus('signed_out');
      authEv.emit({ user: null });
    }

    function login() {
      if (S.mode === 'local') return Promise.resolve(null);
      return init().then(function () {
        // não atropela a tela de "criar senha" de um convite/recuperação já aberta
        if (!S.identity) return null; // biblioteca de login não carregou (status "error")
        if (!S.user && !(UI && (UI.view === 'invite' || UI.view === 'reset'))) openLogin('login');
        return api.user;
      });
    }
    function logout() {
      if (S.mode !== 'netlify') return Promise.resolve();
      var p = S.identity && S.identity.logout ? Promise.resolve(S.identity.logout()).catch(function () {}) : Promise.resolve();
      return p.then(function () { if (S.user) handleSignedOut(); });
    }

    /* ---------------- HTTP */
    function bearer() {
      try {
        var m = /(?:^|; )nf_jwt=([^;]*)/.exec((W && W.document && W.document.cookie) || '');
        return m ? decodeURIComponent(m[1]) : null;
      } catch (e) { return null; }
    }
    function request(method, path, body, headers, retried) {
      var h = Object.assign({ 'x-finflow': '1', accept: 'application/json' }, headers || {});
      var init = { method: method, headers: h, credentials: 'same-origin', cache: 'no-store' };
      if (body !== undefined) { h['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
      var pre = !retried && S.identity && S.identity.refreshSession ? Promise.resolve(S.identity.refreshSession()).catch(function () { return null; }) : Promise.resolve();
      // o token é lido DEPOIS da renovação (senão o primeiro pedido após expirar sairia com o token velho)
      return pre.then(function () { var jwt = bearer(); if (jwt) h.authorization = 'Bearer ' + jwt; return fetchFn(path, init); }).then(function (res) {
        if (res.status === 401 && !retried && S.identity && S.identity.refreshSession) {
          return Promise.resolve(S.identity.refreshSession()).catch(function () { return null; }).then(function () { return request(method, path, body, headers, true); });
        }
        return res.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
          return { status: res.status, body: j };
        });
      });
    }
    function netErr() { var e = new Error('network'); e.network = true; return e; }

    /* ---------------- leitura */
    function monthKeysFor(ym) {
      return Object.keys(S.cache.docs).filter(function (k) { return k.indexOf('month:') === 0 && baseYm(k.slice(6)) === ym; });
    }
    function logicalRows(ym) {
      var rows = [];
      monthKeysFor(ym).forEach(function (k) { rows = mergeRows(rows, S.cache.docs[k].rows); });
      return rows;
    }
    function snapshot() {
      var out = { meta: {}, months: {} };
      META_NAMES.forEach(function (n) { var d = S.cache.docs['meta:' + n]; out.meta[n] = d ? clone(d.data) : null; });
      var yms = new Set();
      Object.keys(S.cache.docs).forEach(function (k) { if (k.indexOf('month:') === 0) yms.add(baseYm(k.slice(6))); });
      Array.from(yms).sort().forEach(function (ym) { var l = liveRows(logicalRows(ym)); if (l.length) out.months[ym] = clone(l); });
      return out;
    }

    function applyServerAll(body) {
      var docs = {};
      Object.keys(body.meta || {}).forEach(function (n) { var d = body.meta[n]; docs['meta:' + n] = { data: d.data, etag: d.etag, seq: d.seq || 0 }; });
      Object.keys(body.months || {}).forEach(function (k) { var d = body.months[k]; docs['month:' + k] = { rows: d.transactions || [], etag: d.etag, seq: d.seq || 0 }; });
      // docs com escrita pendente: mantém a versão local (a escrita fará o merge no servidor)
      Object.keys(S.pending).forEach(function (pk) {
        var p = S.pending[pk];
        if (p.kind === 'month') {
          var local = S.cache.docs[pk];
          var srv = docs[pk];
          docs[pk] = { rows: mergeRows(srv ? srv.rows : [], local ? local.rows : []), etag: srv ? srv.etag : null, seq: srv ? srv.seq : 0 };
        } else if (S.cache.docs[pk]) {
          docs[pk] = Object.assign({}, S.cache.docs[pk]); // base/etag antigos ficam; o PUT condicional resolve
        }
      });
      S.cache = { seq: body.seq || 0, docs: docs };
    }

    function loadAll() {
      return init().then(function () {
        if (S.mode === 'local') return toLoadShape(S.local);
        if (!S.user) return { meta: emptyMeta(), months: {} };
        if (!isOnline()) { setStatus('offline'); return snapshot(); }
        return request('GET', '/api/all').then(function (r) {
          if (r.status === 200 && r.body) {
            applyServerAll(r.body);
            return persist().then(function () {
              setStatus(Object.keys(S.pending).length ? 'saving' : 'synced');
              if (Object.keys(S.pending).length) scheduleFlush(0);
              return snapshot();
            });
          }
          if (r.status === 401) { handleSignedOut(); return { meta: emptyMeta(), months: {} }; }
          S.lastError = 'Servidor respondeu ' + r.status; setStatus('error');
          return snapshot();
        }, function () { setStatus(isOnline() ? 'error' : 'offline'); S.lastError = 'Sem conexão com o servidor.'; return snapshot(); });
      });
    }
    function emptyMeta() { var m = {}; META_NAMES.forEach(function (n) { m[n] = null; }); return m; }
    function toLoadShape(d) {
      var out = { meta: emptyMeta(), months: {} };
      META_NAMES.forEach(function (n) { if (d.meta[n] !== undefined) out.meta[n] = clone(d.meta[n]); });
      Object.keys(d.months).sort().forEach(function (ym) { if (d.months[ym] && d.months[ym].length) out.months[ym] = clone(d.months[ym]); });
      return out;
    }

    /* ---------------- escrita (otimista) */
    function checkName(name) { if (META_NAMES.indexOf(name) < 0) throw new Error('Nome de documento inválido: ' + name); }
    function checkYm(ym) { if (typeof ym !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error('Mês inválido: ' + ym); }

    function saveMeta(name, data) {
      return init().then(function () {
        checkName(name);
        data = clone(data);
        if (S.mode === 'local') { S.local.meta[name] = data; writeLocal(); return; }
        if (!S.user) throw new Error('Entre para sincronizar.');
        var k = 'meta:' + name;
        var cur = S.cache.docs[k];
        var p = S.pending[k];
        // "base" = última versão confirmada pelo servidor (para o merge de 3 vias se houver conflito)
        var base = p ? p.base : (cur ? clone(cur.data) : undefined);
        var baseEtag = p ? p.baseEtag : (cur ? cur.etag : null);
        S.cache.docs[k] = { data: data, etag: cur ? cur.etag : null, seq: cur ? cur.seq : 0 };
        S.pending[k] = { kind: 'meta', key: name, op: 'put', base: base, baseEtag: baseEtag, ver: ((p && p.ver) || 0) + 1 };
        return afterLocalWrite();
      });
    }

    function stampRows(prevRows, txs) {
      var nowIso = new Date(now()).toISOString();
      var prev = new Map((prevRows || []).map(function (r) { return [r.id, r]; }));
      var seen = new Set();
      var out = [];
      (txs || []).forEach(function (t) {
        if (!isObj(t) || typeof t.id !== 'string' || !t.id) throw new Error('Lançamento sem id.');
        if (seen.has(t.id)) return; seen.add(t.id);
        var p = prev.get(t.id);
        var row = clone(t); delete row.deleted;
        if (p && !p.deleted && deepEqual(withoutStamp(p), withoutStamp(row))) { out.push(p); return; }
        // cópia velha de uma linha que já foi excluída (aqui ou em outro aparelho): a exclusão vence.
        // Só uma edição feita DEPOIS da exclusão (updatedAt mais novo) traz a linha de volta.
        if (p && p.deleted && (!row.updatedAt || ts(row) <= ts(p))) { out.push(p); return; }
        if (!(row.updatedAt && (!p || ts(row) > ts(p)))) row.updatedAt = nowIso;
        out.push(row);
      });
      prev.forEach(function (p, id) {
        if (seen.has(id)) return;
        out.push(p.deleted ? p : { id: id, deleted: true, updatedAt: nowIso });
      });
      return out;
    }

    function saveMonth(ym, txs) {
      return init().then(function () {
        checkYm(ym);
        if (!Array.isArray(txs)) throw new Error('saveMonth espera uma lista de lançamentos.');
        if (S.mode === 'local') {
          var nowIso = new Date(now()).toISOString();
          var prevL = new Map((S.local.months[ym] || []).map(function (r) { return [r.id, r]; }));
          var rowsL = clone(txs).map(function (t) {
            var p = prevL.get(t.id);
            if (!t.updatedAt || (p && !deepEqual(withoutStamp(p), withoutStamp(t)) && ts(t) <= ts(p))) t.updatedAt = nowIso;
            return t;
          });
          if (rowsL.length) S.local.months[ym] = rowsL; else delete S.local.months[ym];
          writeLocal(); return;
        }
        if (!S.user) throw new Error('Entre para sincronizar.');
        var k = 'month:' + ym;
        var rows = stampRows(logicalRows(ym), txs);
        // se o app mandou cópias velhas de linhas já excluídas, avisa o app do estado real do mês
        var stale = txs.some(function (t) { return t && rows.some(function (r) { return r.id === t.id && r.deleted; }); });
        // linhas de "partes" antigas (ym~n) passam a morar no doc principal
        monthKeysFor(ym).forEach(function (pk) { if (pk !== k) S.cache.docs[pk] = Object.assign({}, S.cache.docs[pk], { rows: [] }); });
        var cur = S.cache.docs[k];
        S.cache.docs[k] = { rows: rows, etag: cur ? cur.etag : null, seq: cur ? cur.seq : 0 };
        var p = S.pending[k];
        S.pending[k] = { kind: 'month', key: ym, op: 'put', ver: ((p && p.ver) || 0) + 1 };
        if (stale) {
          var liveNow = liveRows(logicalRows(ym));
          setTimeout(function () { remoteEv.emit({ kind: 'month', key: ym, data: clone(liveNow), deleted: !liveNow.length }); }, 0);
        }
        return afterLocalWrite();
      });
    }

    function deleteMonth(ym) {
      return init().then(function () {
        checkYm(ym);
        if (S.mode === 'local') { delete S.local.months[ym]; writeLocal(); return; }
        if (!S.user) throw new Error('Entre para sincronizar.');
        var nowIso = new Date(now()).toISOString();
        monthKeysFor(ym).concat(['month:' + ym]).forEach(function (k) {
          var cur = S.cache.docs[k];
          var rows = (cur ? cur.rows : []).map(function (r) { return r.deleted ? r : { id: r.id, deleted: true, updatedAt: nowIso }; });
          S.cache.docs[k] = { rows: rows, etag: cur ? cur.etag : null, seq: cur ? cur.seq : 0 };
          var p = S.pending[k];
          S.pending[k] = { kind: 'month', key: k.slice(6), op: 'delete', ver: ((p && p.ver) || 0) + 1 };
        });
        return afterLocalWrite();
      });
    }

    function afterLocalWrite() {
      S.permErr = false;
      setStatus(isOnline() ? 'saving' : 'offline');
      return persist().then(function () { scheduleFlush(300); });
    }

    /* ---------------- fila de envio */
    function scheduleFlush(ms) {
      if (S.retryTimer) clearTimeout(S.retryTimer);
      S.retryTimer = setTimeout(function () { S.retryTimer = null; flush(); }, ms || 0);
      if (S.retryTimer && S.retryTimer.unref) S.retryTimer.unref();
    }

    function flush() {
      if (S.mode !== 'netlify' || !S.user) return Promise.resolve();
      if (S.flushing) return S.flushing;
      if (!isOnline()) { setStatus('offline'); return Promise.resolve(); }
      var uid = S.uid;
      S.flushing = (function loop() {
        if (S.uid !== uid) return Promise.resolve();
        var keys = Object.keys(S.pending);
        if (!keys.length) {
          S.backoff = 0;
          setStatus(S.permErr ? 'error' : 'synced');
          return Promise.resolve();
        }
        setStatus('saving');
        return sendOne(keys[0]).then(loop);
      })().catch(function (err) {
        if (S.uid !== uid) return;
        if (err && err.auth) { handleSignedOut(); return; }
        S.lastError = err && err.network ? 'Sem conexão. As alterações ficam guardadas e sobem quando a internet voltar.' : (err && err.message) || 'Erro ao salvar.';
        setStatus(err && err.network ? 'offline' : 'error');
        S.backoff = Math.min(60000, S.backoff ? S.backoff * 2 : 2000);
        scheduleFlush(S.backoff);
      }).then(function () { S.flushing = null; return persist(); });
      return S.flushing;
    }

    function sendOne(k) {
      var p = S.pending[k];
      var ver = p.ver;
      S.inflight[k] = true;
      var done = function () { delete S.inflight[k]; };
      var finish = function () { if (S.pending[k] && S.pending[k].ver === ver) delete S.pending[k]; };
      var handleStatus = function (r) {
        if (r.status === 401) { var e = new Error('auth'); e.auth = true; throw e; }
        if (r.status >= 500 || r.status === 429 || r.status === 408) { var e2 = new Error('Servidor indisponível (' + r.status + ').'); e2.network = true; throw e2; }
        if (r.status >= 400 && r.status !== 412) {
          // erro permanente (validação/tamanho): não adianta repetir; dado fica no cache local
          S.lastError = r.status === 413 ? 'Mês grande demais para salvar (limite ~1 MB).' : 'O servidor recusou um documento (' + r.status + ').';
          finish(); S.permErr = true; setStatus('error');
          return false;
        }
        return true;
      };
      var pr;
      if (p.kind === 'meta') {
        var doc = S.cache.docs[k];
        var hdr = p.baseEtag ? { 'if-match': p.baseEtag } : (p.base === undefined ? { 'if-match': '*' } : {});
        pr = request('PUT', '/api/meta/' + p.key, doc.data, hdr).then(function (r) {
          if (!handleStatus(r)) return;
          if (r.status === 412) {
            var cur = r.body && r.body.current;
            var remote = cur ? cur.data : undefined;
            var merged = merge3(p.base, S.cache.docs[k].data, remote);
            if (merged === undefined) merged = remote === undefined ? S.cache.docs[k].data : remote;
            var changedForApp = !deepEqual(merged, S.cache.docs[k].data);
            S.cache.docs[k] = { data: merged, etag: cur ? cur.etag : null, seq: S.cache.docs[k].seq };
            S.pending[k] = { kind: 'meta', key: p.key, op: 'put', base: remote, baseEtag: cur ? cur.etag : null, ver: (S.pending[k] ? S.pending[k].ver : ver) + 1 };
            if (remote === undefined) S.pending[k].base = undefined;
            ver = S.pending[k].ver; // o reenvio é este mesmo item
            if (changedForApp) remoteEv.emit({ kind: 'meta', key: p.key, data: clone(merged) });
            return; // loop reenvia
          }
          var d = S.cache.docs[k];
          S.cache.docs[k] = { data: d.data, etag: r.body.etag, seq: r.body.seq };
          if (S.pending[k] && S.pending[k].ver !== ver) { S.pending[k].base = clone(doc.data); S.pending[k].baseEtag = r.body.etag; }
          finish();
        });
      } else if (p.op === 'delete') {
        pr = request('DELETE', '/api/month/' + encodeURIComponent(p.key)).then(function (r) {
          if (!handleStatus(r)) return;
          var d = S.cache.docs[k];
          S.cache.docs[k] = { rows: mergeRows(d ? d.rows : [], (r.body && r.body.transactions) || [], now()), etag: r.body.etag, seq: r.body.seq };
          finish();
        });
      } else {
        var sent = S.cache.docs[k].rows;
        pr = request('PUT', '/api/month/' + encodeURIComponent(p.key), { transactions: sent }).then(function (r) {
          if (!handleStatus(r)) return;
          var server = (r.body && r.body.transactions) || [];
          var ym = baseYm(p.key);
          var before = liveRows(logicalRows(ym));
          var d = S.cache.docs[k];
          // o servidor devolve o mês mesclado; mantém edições locais feitas durante o envio
          S.cache.docs[k] = { rows: mergeRows(server, d.rows, now()), etag: r.body.etag, seq: r.body.seq };
          finish();
          // eco: só avisa o app se o servidor trouxe algo que não saiu daqui
          var sentMap = new Map(sent.map(function (x) { return [x.id, x]; }));
          var foreign = server.some(function (x) { var s = sentMap.get(x.id); return !s || ts(x) > ts(s) || (!!x.deleted !== !!s.deleted && ts(x) >= ts(s)); });
          if (foreign) {
            var after = liveRows(logicalRows(ym));
            if (!deepEqual(before, after)) remoteEv.emit({ kind: 'month', key: ym, data: clone(after), deleted: !after.length });
          }
        });
      }
      return pr.then(function (v) { done(); return v; }, function (e) {
        done();
        if (e && (e.auth || e.network)) throw e;
        if (e && e.name === 'TypeError') throw netErr();
        throw e;
      });
    }

    /* ---------------- sondagem de mudanças remotas */
    function poll() {
      if (S.mode !== 'netlify' || !S.user || !isOnline()) return Promise.resolve();
      var uid = S.uid;
      return request('GET', '/api/changes?since=' + (S.cache.seq || 0)).then(function (r) {
        if (S.uid !== uid) return;
        if (r.status === 401) { handleSignedOut(); return; }
        if (r.status !== 200 || !r.body) return;
        if (r.body.reset) return fullRefresh();
        var changes = r.body.changes || [];
        var touched = new Set();
        changes.forEach(function (c) {
          var isMeta = c.kind === 'meta';
          var k = (isMeta ? 'meta:' : 'month:') + c.key;
          if (S.pending[k] || S.inflight[k]) return;             // nossa escrita vai mesclar
          var cur = S.cache.docs[k];
          if (cur && c.seq && cur.seq && c.seq <= cur.seq) return;  // já temos esta versão (ou mais nova)
          if (cur && c.etag && cur.etag === c.etag) { cur.seq = c.seq; return; } // eco da nossa própria escrita
          if (isMeta) {
            var before = cur ? cur.data : null;
            S.cache.docs[k] = { data: c.data === undefined ? null : c.data, etag: c.etag, seq: c.seq };
            if (!deepEqual(before, S.cache.docs[k].data)) remoteEv.emit({ kind: 'meta', key: c.key, data: clone(S.cache.docs[k].data) });
          } else {
            var ym = baseYm(c.key);
            var prev = liveRows(logicalRows(ym));
            S.cache.docs[k] = { rows: c.transactions || [], etag: c.etag, seq: c.seq };
            if (!touched.has(ym)) touched.add(ym);
            var next = liveRows(logicalRows(ym));
            if (!deepEqual(prev, next)) remoteEv.emit({ kind: 'month', key: ym, data: clone(next), deleted: !next.length });
          }
        });
        S.cache.seq = r.body.seq;
        if (S.status === 'error' || S.status === 'offline') setStatus(Object.keys(S.pending).length ? 'saving' : 'synced');
        return persist();
      }, function () { setStatus('offline'); });
    }

    function fullRefresh() {
      var before = snapshot();
      return request('GET', '/api/all').then(function (r) {
        if (r.status !== 200 || !r.body) return;
        applyServerAll(r.body);
        var after = snapshot();
        diffAndEmit(before, after);
        return persist();
      });
    }

    function syncNow() {
      if (S.mode !== 'netlify' || !S.user) return Promise.resolve();
      return flush().then(poll);
    }

    function startPolling() {
      stopPolling();
      if (!pollMs) return;
      S.timer = setInterval(function () {
        var visible = true;
        try { visible = !(W && W.document && W.document.visibilityState === 'hidden'); } catch (e) { visible = true; }
        if (visible) syncNow();
      }, pollMs);
    }
    function stopPolling() { if (S.timer) clearInterval(S.timer); S.timer = null; }

    function attachSyncListeners() {
      if (!W || !W.addEventListener || S.listeners.length) return;
      var on = function (target, ev, fn) { try { target.addEventListener(ev, fn); S.listeners.push([ev, fn, target]); } catch (e) { /* ignore */ } };
      on(W, 'focus', function () { syncNow(); });
      on(W, 'online', function () { S.backoff = 0; syncNow(); });
      on(W, 'offline', function () { if (S.user) setStatus('offline'); });
      if (W.document) on(W.document, 'visibilitychange', function () { if (W.document.visibilityState === 'visible') syncNow(); });
    }

    function destroy() {
      stopPolling();
      if (S.retryTimer) clearTimeout(S.retryTimer);
      S.listeners.forEach(function (l) { try { (l[2] || W).removeEventListener(l[0], l[1]); } catch (e) { /* ignore */ } });
      S.listeners = [];
      closeLogin();
    }

    /* ---------------- backup */
    function exportAll() {
      return loadAll().then(function (d) {
        return { app: 'financas-flow', version: 2, exportedAt: new Date(now()).toISOString(), meta: d.meta, months: d.months };
      });
    }
    /** Substitui (padrão) ou mescla ({mode:'merge'}) os dados atuais pelos do backup. */
    function importAll(obj, o) {
      var mode = (o && o.mode) || 'replace';
      var n = normalizeBackup(obj);
      return loadAll().then(function (cur) {
        var nowIso = new Date(now()).toISOString();
        var ops = [];
        META_NAMES.forEach(function (name) {
          if (n.meta[name] !== undefined) ops.push(function () { return saveMeta(name, n.meta[name]); });
        });
        var yms = new Set(Object.keys(n.months).concat(mode === 'replace' ? Object.keys(cur.months) : []));
        yms.forEach(function (ym) {
          var incoming = (n.months[ym] || []).map(function (t) { var c = clone(t); c.updatedAt = nowIso; return c; });
          if (mode === 'merge') {
            var map = new Map((cur.months[ym] || []).map(function (t) { return [t.id, t]; }));
            incoming.forEach(function (t) { map.set(t.id, t); });
            incoming = Array.from(map.values());
          }
          ops.push(function () { return incoming.length ? saveMonth(ym, incoming) : deleteMonth(ym); });
        });
        return ops.reduce(function (p, f) { return p.then(f); }, Promise.resolve());
      }).then(function () { return n.stats; });
    }

    /* ---------------- tela de login (Netlify Identity) */
    var UI = null;
    function authMsg(err) {
      var m = (err && (err.message || err.error_description || err.msg)) || '';
      var st = err && err.status;
      if (/invalid_grant|No user found|Invalid login|incorrect|invalid email or password/i.test(m) || st === 400 && /grant/i.test(m)) return 'E-mail ou senha incorretos.';
      if (/not confirmed|Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
      if (/signup|Signups not allowed|disabled/i.test(m)) return 'Cadastro só por convite. Peça o convite no painel da Netlify.';
      if (/expired|invalid token|Invalid token|not found/i.test(m)) return 'Este link expirou ou já foi usado. Peça um novo.';
      if (/password/i.test(m) && /short|least|weak/i.test(m)) return 'Senha fraca: use pelo menos 8 caracteres.';
      if (/fetch|network|Failed/i.test(m)) return 'Sem conexão. Tente de novo quando a internet voltar.';
      return 'Não deu certo' + (m ? ': ' + m : '.');
    }
    function googleEnabled() {
      var s = S.idSettings;
      return !!(s && s.external && s.external.google);
    }
    var CSS = '' +
      '.ffl-dlg{border:0;padding:0;background:transparent;max-width:100vw;max-height:100vh;color:var(--fg,var(--ink,#13232A));font-family:inherit}' +
      '.ffl-dlg::backdrop{background:rgba(13,24,28,.5)}' +
      '.ffl-wrap{position:fixed;inset:0;display:flex;align-items:flex-end;justify-content:center;z-index:2147483000;background:rgba(13,24,28,.5)}' +
      '@media (min-width:600px){.ffl-wrap{align-items:center}}' +
      '.ffl-card{box-sizing:border-box;width:min(420px,100vw);max-height:100vh;overflow:auto;background:var(--card,var(--surface,#fff));color:var(--fg,var(--ink,#13232A));border:1px solid var(--line,#D6DDD5);border-radius:20px 20px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom,0px));box-shadow:0 10px 40px rgba(0,0,0,.2)}' +
      '@media (min-width:600px){.ffl-card{border-radius:20px}}' +
      '.ffl-card h2{margin:0 0 6px;font-size:1.35rem;line-height:1.2}' +
      '.ffl-card p{margin:0 0 14px;color:var(--muted,var(--ink-2,#47585D));font-size:.95rem;line-height:1.4}' +
      '.ffl-card label{display:block;font-size:.9rem;font-weight:600;margin:12px 0 6px}' +
      '.ffl-card input{box-sizing:border-box;width:100%;font:inherit;font-size:16px;padding:12px 14px;border-radius:12px;border:1px solid var(--line,#C3CCC2);background:var(--bg,#fff);color:inherit}' +
      '.ffl-card input:focus-visible,.ffl-card button:focus-visible{outline:3px solid var(--accent,#1D4FA0);outline-offset:2px}' +
      '.ffl-btn{display:block;width:100%;margin-top:14px;padding:13px 16px;font:inherit;font-weight:700;border-radius:12px;border:1px solid var(--line,#C3CCC2);background:transparent;color:inherit;cursor:pointer;min-height:48px}' +
      '.ffl-btn.primary{background:var(--accent,#1D4FA0);border-color:var(--accent,#1D4FA0);color:var(--accent-ink,#fff)}' +
      '.ffl-btn[disabled]{opacity:.6;cursor:progress}' +
      '.ffl-link{background:none;border:0;padding:8px 0;margin-top:10px;font:inherit;color:var(--accent,#1D4FA0);text-decoration:underline;cursor:pointer;min-height:44px}' +
      '.ffl-row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
      '.ffl-err{margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(177,58,45,.12);color:var(--out,#B13A2D);font-size:.92rem}' +
      '.ffl-ok{margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(27,118,70,.12);color:var(--in,#1B7646);font-size:.92rem}' +
      '.ffl-or{display:flex;align-items:center;gap:10px;margin:16px 0 0;color:var(--muted,#77878A);font-size:.85rem}' +
      '.ffl-or:before,.ffl-or:after{content:"";flex:1;height:1px;background:var(--line,#D6DDD5)}' +
      '.ffl-x{float:right;background:none;border:0;font-size:1.6rem;line-height:1;color:var(--muted,#77878A);cursor:pointer;min-width:44px;min-height:44px;margin:-10px -10px 0 0}';

    function el(tag, attrs, kids) {
      var d = W.document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === 'text') d.textContent = attrs[k];
        else if (k === 'on') Object.keys(attrs.on).forEach(function (e) { d.addEventListener(e, attrs.on[e]); });
        else if (attrs[k] !== false && attrs[k] != null) d.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
      });
      (kids || []).forEach(function (c) { if (c) d.appendChild(c); });
      return d;
    }
    function closeLogin() {
      if (!UI) return;
      try { if (UI.dlg.close) UI.dlg.close(); } catch (e) { /* ignore */ }
      try { UI.root.remove(); } catch (e) { /* ignore */ }
      try { if (UI.prevFocus && UI.prevFocus.focus) UI.prevFocus.focus(); } catch (e) { /* ignore */ }
      UI = null;
    }

    function openLogin(view, ctx) {
      if (!W || !W.document || !W.document.body) return;
      ctx = ctx || {};
      var doc = W.document;
      if (!doc.getElementById('ffl-style')) { var st = doc.createElement('style'); st.id = 'ffl-style'; st.textContent = CSS; doc.head.appendChild(st); }
      if (!UI) {
        var useDialog = typeof W.HTMLDialogElement === 'function';
        var dlg = el(useDialog ? 'dialog' : 'div', { class: useDialog ? 'ffl-dlg' : 'ffl-wrap', 'aria-labelledby': 'ffl-title', role: useDialog ? null : 'dialog', 'aria-modal': useDialog ? null : 'true' });
        var card = el('div', { class: 'ffl-card' });
        if (useDialog) { var wrap = el('div', { class: 'ffl-wrap' }, [card]); dlg.appendChild(wrap); } else dlg.appendChild(card);
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeLogin(); });
        dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLogin(); });
        doc.body.appendChild(dlg);
        UI = { dlg: dlg, card: card, root: dlg, prevFocus: doc.activeElement };
        try { if (useDialog) dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
      }
      renderView(view, ctx);
    }

    function renderView(view, ctx) {
      var card = UI.card; card.textContent = '';
      UI.view = view;
      var id = S.identity;
      var msg = el('div', { role: 'status', 'aria-live': 'polite' });
      var showErr = function (t) { msg.className = 'ffl-err'; msg.textContent = t; };
      var showOk = function (t) { msg.className = 'ffl-ok'; msg.textContent = t; };
      if (ctx.error) showErr(ctx.error);
      var busy = function (btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; };
      var closeBtn = view === 'invite' || view === 'reset' ? null : el('button', { type: 'button', class: 'ffl-x', 'aria-label': 'Fechar', text: '×', on: { click: closeLogin } });
      var title, form;

      if (view === 'login') {
        title = el('h2', { id: 'ffl-title', text: 'Entrar' });
        var email = el('input', { id: 'ffl-email', type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', required: true, autocapitalize: 'off', spellcheck: 'false' });
        var pass = el('input', { id: 'ffl-pass', type: 'password', name: 'password', autocomplete: 'current-password', required: true });
        var go = el('button', { type: 'submit', class: 'ffl-btn primary', text: 'Entrar' });
        form = el('form', { novalidate: true }, [
          el('p', { text: 'Seus dados ficam guardados na sua conta e sincronizam entre o computador e o celular.' }),
          el('label', { for: 'ffl-email', text: 'E-mail' }), email,
          el('label', { for: 'ffl-pass', text: 'Senha' }), pass,
          go,
          googleEnabled() ? el('div', { class: 'ffl-or', text: 'ou' }) : null,
          googleEnabled() ? el('button', { type: 'button', class: 'ffl-btn', text: 'Entrar com Google', on: { click: function () { try { id.oauthLogin('google'); } catch (e) { showErr(authMsg(e)); } } } }) : null,
          el('div', { class: 'ffl-row' }, [el('button', { type: 'button', class: 'ffl-link', text: 'Esqueci minha senha', on: { click: function () { renderView('forgot', { email: email.value }); } } })]),
          msg,
        ]);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (!email.value || !pass.value) { showErr('Preencha e-mail e senha.'); return; }
          busy(go, true, 'Entrando…');
          Promise.resolve(id.login(email.value.trim(), pass.value)).then(function (user) { return handleSignedIn(user); })
            .then(function () { closeLogin(); }, function (err) { busy(go, false, 'Entrar'); showErr(authMsg(err)); });
        });
        setTimeout(function () { try { (ctx.email ? pass : email).focus(); } catch (e) { /* ignore */ } }, 0);
        if (ctx.email) email.value = ctx.email;
      } else if (view === 'forgot') {
        title = el('h2', { id: 'ffl-title', text: 'Recuperar senha' });
        var em = el('input', { id: 'ffl-email', type: 'email', autocomplete: 'username', inputmode: 'email', required: true, autocapitalize: 'off' });
        em.value = ctx.email || '';
        var send = el('button', { type: 'submit', class: 'ffl-btn primary', text: 'Enviar link por e-mail' });
        form = el('form', { novalidate: true }, [
          el('p', { text: 'Vamos mandar um link para você criar uma senha nova.' }),
          el('label', { for: 'ffl-email', text: 'E-mail' }), em, send,
          el('button', { type: 'button', class: 'ffl-link', text: 'Voltar', on: { click: function () { renderView('login', { email: em.value }); } } }),
          msg,
        ]);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (!em.value) { showErr('Digite seu e-mail.'); return; }
          busy(send, true, 'Enviando…');
          Promise.resolve(id.requestPasswordRecovery(em.value.trim())).then(function () {
            busy(send, false, 'Enviar de novo'); showOk('Pronto! Abra o e-mail e toque no link (veja também o spam).');
          }, function (err) { busy(send, false, 'Enviar link por e-mail'); showErr(authMsg(err)); });
        });
        setTimeout(function () { try { em.focus(); } catch (e) { /* ignore */ } }, 0);
      } else if (view === 'invite' || view === 'reset') {
        var invite = view === 'invite';
        title = el('h2', { id: 'ffl-title', text: invite ? 'Criar sua senha' : 'Criar senha nova' });
        var p1 = el('input', { id: 'ffl-p1', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
        var p2 = el('input', { id: 'ffl-p2', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
        var ok = el('button', { type: 'submit', class: 'ffl-btn primary', text: 'Salvar senha' });
        form = el('form', { novalidate: true }, [
          el('p', { text: invite ? 'Último passo do convite: escolha uma senha (mínimo 8 caracteres).' : 'Escolha a nova senha (mínimo 8 caracteres).' }),
          el('label', { for: 'ffl-p1', text: 'Senha' }), p1,
          el('label', { for: 'ffl-p2', text: 'Repita a senha' }), p2,
          ok, msg,
        ]);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (p1.value.length < 8) { showErr('Use pelo menos 8 caracteres.'); return; }
          if (p1.value !== p2.value) { showErr('As duas senhas estão diferentes.'); return; }
          busy(ok, true, 'Salvando…');
          var pr = invite ? id.acceptInvite(ctx.token, p1.value) : id.updateUser({ password: p1.value });
          Promise.resolve(pr).then(function (user) { return user && user.id ? handleSignedIn(user) : null; })
            .then(function () { closeLogin(); }, function (err) { busy(ok, false, 'Salvar senha'); showErr(authMsg(err)); });
        });
        setTimeout(function () { try { p1.focus(); } catch (e) { /* ignore */ } }, 0);
      }
      card.appendChild(el('div', {}, [closeBtn, title, form]));
    }

    return api;
  }

  var lib = { createStore: createStore, normalizeBackup: normalizeBackup, mergeRows: mergeRows, merge3: merge3, META_NAMES: META_NAMES };
  root.createStore = createStore;
  root.FinStoreLib = lib;
  // window.FinStore: criado sob demanda (o app pode também fazer `window.FinStore = createStore({...})`).
  if (typeof window !== 'undefined' && root === window && !Object.prototype.hasOwnProperty.call(window, 'FinStore')) {
    var inst = null;
    Object.defineProperty(window, 'FinStore', {
      configurable: true, enumerable: true,
      get: function () { if (!inst) inst = createStore({ mode: (window.FINSTORE_MODE || 'auto') }); return inst; },
      set: function (v) { Object.defineProperty(window, 'FinStore', { value: v, writable: true, configurable: true, enumerable: true }); },
    });
  }
  // PWA: registra o service worker (sw.js ao lado deste arquivo). Seguro chamar de novo no app.
  if (typeof window !== 'undefined' && root === window && !window.FINSTORE_NO_SW) {
    try {
      var nav = window.navigator;
      var secure = window.location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
      if (nav && nav.serviceWorker && secure) {
        var swUrl = new URL('sw.js', SCRIPT_SRC || window.location.href).href;
        window.addEventListener('load', function () { nav.serviceWorker.register(swUrl).catch(function () { /* sem SW, o app funciona igual */ }); });
      }
    } catch (e) { /* ignore */ }
  }
  if (typeof module === 'object' && module.exports) module.exports = lib;
})(typeof window !== 'undefined' ? window : globalThis);
