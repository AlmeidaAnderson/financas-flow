/* TEST-ONLY fake of the claude.ai Artifact runtime (`window.claude.use`) for site/store-artifact.js.
 * Follows the capability contracts (artifact-capabilities 0.2.66: claude.d.ts, db.d.ts, user.d.ts, downloads.d.ts):
 *  - claude.use(name) → memoized Promise resolving LATER (delayMs) to a frozen namespace, or null when not granted.
 *  - db: doc()/collection() path grammar (even/odd segments, allowed chars, limits) → TypeError synchronously;
 *    get/set/update/delete/onSnapshot on docs, get/onSnapshot/doc/add on collections (+ where/orderBy/limit);
 *    snapshots are frozen; QuerySnapshot.docChanges(); own writes reach own listeners immediately;
 *    bodies must be plain objects ≤ 256 KiB → otherwise reject {code:'invalid_argument'}; update() requires the doc;
 *    data/users/<other>/… reads as non-existent and rejects writes (invalid_argument).
 *  - user: id() / me() / isOwner() / canEdit() / can().
 *  - downloads: save({filename, data}) → {status:'saved'}; extension allowlist → {code:'rejected_extension'}.
 * Backends: createMemoryBackend() (node: several "devices" share one object) and createHttpBackend(base, ns)
 * (browser: test/e2e/artifact_server.py, polled for changes) — same async interface.
 * Fault injection: fake.inject({ op:'set'|'get'|'update'|'delete'|'list', code:'unavailable', times:1 }).
 */
(function (root) {
  'use strict';
  var SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;
  var MAX_DOC = 256 * 1024;

  function bytes(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3; } return n; }
  function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); } return o; }
  function dbErr(code, message) { var e = { code: code, message: message || code }; return e; }
  function splitPath(path, kind) {
    if (typeof path !== 'string' || !path) throw new TypeError('path must be a non-empty string');
    if (path.length > 1000) throw new TypeError('path longer than 1000 bytes');
    var segs = path.split('/');
    if (segs.length > 16) throw new TypeError('more than 16 segments');
    segs.forEach(function (s) {
      if (!s || !SEG_RE.test(s) || s === '.' || s === '..' || bytes(s) > 200) throw new TypeError('bad segment "' + s + '"');
    });
    if (kind === 'doc' && segs.length % 2 !== 0) throw new TypeError('document path needs an even number of segments (got ' + segs.length + ')');
    if (kind === 'coll' && segs.length % 2 !== 1) throw new TypeError('collection path needs an odd number of segments (got ' + segs.length + ')');
    return segs;
  }
  function parentColl(path) { return path.split('/').slice(0, -1).join('/'); }

  /* ------------------------------------------------------------ backends */
  function createMemoryBackend() {
    var docs = new Map(); var listeners = new Set(); var version = 0;
    var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
    var notify = function (path, data) { listeners.forEach(function (fn) { try { fn({ path: path, data: data }); } catch (e) { console.error(e); } }); };
    return {
      docs: docs,
      get: function (path) { return tick().then(function () { var d = docs.get(path); return d ? { exists: true, data: JSON.parse(d.json), version: d.version } : { exists: false }; }); },
      list: function (coll) {
        return tick().then(function () {
          var out = [];
          docs.forEach(function (d, p) { if (parentColl(p) === coll) out.push({ id: p.split('/').pop(), path: p, data: JSON.parse(d.json), version: d.version }); });
          return out;
        });
      },
      set: function (path, data) { var json = JSON.stringify(data); docs.set(path, { json: json, version: ++version }); notify(path, JSON.parse(json)); return tick(); },
      del: function (path) { if (docs.has(path)) { docs.delete(path); notify(path, null); } return tick(); },
      onChange: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
    };
  }

  /** Browser backend: the e2e server keeps the store; changes are polled (≈ the platform's fallback refresh). */
  function createHttpBackend(base, ns, pollMs) {
    var q = function (extra) { return '?ns=' + encodeURIComponent(ns) + (extra || ''); };
    var listeners = new Set(); var seq = 0; var timer = null;
    var notify = function (path, data) { listeners.forEach(function (fn) { try { fn({ path: path, data: data }); } catch (e) { console.error(e); } }); };
    var post = function (op, body) {
      return fetch(base + '/' + op + q(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { if (!r.ok) throw dbErr('unavailable', 'fake server ' + r.status); return r.json(); });
    };
    var poll = function () {
      return fetch(base + '/changes' + q('&since=' + seq)).then(function (r) { return r.json(); }).then(function (j) {
        seq = Math.max(seq, j.seq);
        (j.changes || []).forEach(function (c) { notify(c.path, c.data); });
      }).catch(function () { /* next poll */ });
    };
    return {
      get: function (path) { return fetch(base + '/doc' + q('&path=' + encodeURIComponent(path))).then(function (r) { return r.json(); }); },
      list: function (coll) { return fetch(base + '/list' + q('&coll=' + encodeURIComponent(coll))).then(function (r) { return r.json(); }); },
      set: function (path, data) { return post('set', { path: path, data: data }).then(function () { notify(path, JSON.parse(JSON.stringify(data))); }); },
      del: function (path) { return post('delete', { path: path }).then(function () { notify(path, null); }); },
      onChange: function (fn) {
        listeners.add(fn);
        if (!timer) {
          // start from "now": earlier history is covered by the listener's own initial list()
          fetch(base + '/changes' + q('&since=-1')).then(function (r) { return r.json(); }).then(function (j) { seq = j.seq; }).catch(function () {}).then(function () {
            timer = setInterval(poll, pollMs || 150);
          });
        }
        return function () { listeners.delete(fn); };
      },
    };
  }

  /* ------------------------------------------------------------ the fake runtime */
  function createFakeClaude(o) {
    o = o || {};
    var backend = o.backend || createMemoryBackend();
    var userId = o.userId === undefined ? 'u_test' : o.userId;
    var delayMs = o.delayMs == null ? 0 : o.delayMs;
    var caps = Object.assign({ db: true, user: true, downloads: true }, o.caps || {});
    var injections = [];
    var saved = o.saved || [];
    var subs = 0;
    var calls = { set: 0, get: 0, update: 0, del: 0, list: 0 };

    function maybeFail(op) {
      for (var i = 0; i < injections.length; i++) {
        var f = injections[i];
        if (f.op === op || f.op === '*') { if (--f.times <= 0) injections.splice(i, 1); return Promise.reject(dbErr(f.code, 'injected ' + f.code)); }
      }
      return null;
    }
    function hidden(path) {
      var s = path.split('/');
      return s[0] === 'data' && s[1] === 'users' && s.length >= 3 && s[2] !== userId;
    }
    function checkBody(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return dbErr('invalid_argument', 'body must be an object');
      var json; try { json = JSON.stringify(data); } catch (e) { return dbErr('invalid_argument', 'not JSON'); }
      if (bytes(json) > MAX_DOC) return dbErr('invalid_argument', 'document over 256 KiB (' + bytes(json) + ' bytes)');
      return null;
    }
    function docSnap(id, exists, data, pending) {
      var frozen = exists ? deepFreeze(JSON.parse(JSON.stringify(data))) : undefined;
      return Object.freeze({ id: id, exists: !!exists, data: function () { return frozen; }, metadata: Object.freeze({ fromCache: false, hasPendingWrites: !!pending }) });
    }
    function merge(a, b) {
      var out = Object.assign({}, a);
      Object.keys(b).forEach(function (k) {
        var v = b[k];
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? merge(out[k], v) : v;
      });
      return out;
    }

    function docRef(path) {
      var segs = splitPath(path, 'doc');
      var id = segs[segs.length - 1];
      var ref = {
        id: id, path: path,
        get: function () {
          calls.get++;
          return maybeFail('get') || backend.get(path).then(function (r) { return docSnap(id, r.exists && !hidden(path), r.data); });
        },
        set: function (data) {
          calls.set++;
          var bad = checkBody(data); if (bad) return Promise.reject(bad);
          if (hidden(path)) return Promise.reject(dbErr('invalid_argument', 'not your subtree'));
          return maybeFail('set') || backend.set(path, JSON.parse(JSON.stringify(data)));
        },
        update: function (data) {
          calls.update++;
          var bad = checkBody(data); if (bad) return Promise.reject(bad);
          if (hidden(path)) return Promise.reject(dbErr('invalid_argument', 'not your subtree'));
          return maybeFail('update') || backend.get(path).then(function (r) {
            if (!r.exists) throw dbErr('invalid_argument', 'update requires an existing document');
            var next = merge(r.data, data); var bad2 = checkBody(next); if (bad2) throw bad2;
            return backend.set(path, next);
          });
        },
        delete: function () { calls.del++; if (hidden(path)) return Promise.reject(dbErr('invalid_argument', 'not your subtree')); return maybeFail('delete') || backend.del(path); },
        acquire: function () { return Promise.resolve({ acquired: true, version: 1, expiresAt: new Date(Date.now() + 30000).toISOString() }); },
        onSnapshot: function (next, error) {
          if (++subs > 64) { subs--; setTimeout(function () { if (error) error(dbErr('resource_exhausted', 'subscription cap')); }, 0); return function () {}; }
          var dead = false, last = null;
          var deliver = function (exists, data) {
            var key = exists ? JSON.stringify(data) : null; if (key === last) return; last = key;
            if (!dead) next(docSnap(id, exists, data));
          };
          backend.get(path).then(function (r) { deliver(r.exists && !hidden(path), r.data); });
          var off = backend.onChange(function (c) { if (c.path === path && !hidden(path)) deliver(c.data != null, c.data); });
          return function () { if (!dead) { dead = true; subs--; off(); } };
        },
        collection: function (sub) { return collRef(path + '/' + sub); },
      };
      return Object.freeze(ref);
    }

    function collRef(path, q) {
      splitPath(path, 'coll');
      q = q || { where: [], order: null, limit: 0 };
      var apply = function (rows) {
        var out = rows.filter(function (r) { return !hidden(r.path); }).filter(function (r) {
          return q.where.every(function (w) {
            var v = r.data[w[0]];
            switch (w[1]) {
              case '==': return v === w[2]; case '!=': return v !== w[2]; case '<': return v < w[2]; case '<=': return v <= w[2];
              case '>': return v > w[2]; case '>=': return v >= w[2]; case 'in': return w[2].indexOf(v) >= 0; case 'not-in': return w[2].indexOf(v) < 0;
              case 'array-contains': return Array.isArray(v) && v.indexOf(w[2]) >= 0; default: return false;
            }
          });
        });
        out.sort(function (a, b) {
          if (q.order) { var f = q.order[0], d = q.order[1] === 'desc' ? -1 : 1; var x = a.data[f], y = b.data[f]; if (x !== y) return (x === undefined ? 1 : y === undefined ? -1 : x < y ? -1 : 1) * d; }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return q.limit ? out.slice(0, q.limit) : out;
      };
      var qsnap = function (rows, changes) {
        var docs = rows.map(function (r) { return r.snap; });
        return Object.freeze({ docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return changes; }, metadata: Object.freeze({ fromCache: false, hasPendingWrites: false }) });
      };
      var c = {
        path: path,
        doc: function (id) { return docRef(path + '/' + (id || ('d' + Math.random().toString(36).slice(2, 12)))); },
        add: function (data) { var r = c.doc(); return r.set(data).then(function () { return r; }); },
        where: function (f, op, v) { return collRef(path, { where: q.where.concat([[f, op, v]]), order: q.order, limit: q.limit }); },
        orderBy: function (f, d) { return collRef(path, { where: q.where, order: [f, d || 'asc'], limit: q.limit }); },
        limit: function (n) { if (!(n >= 1 && n <= 1000)) throw dbErr('invalid_argument', 'limit'); return collRef(path, { where: q.where, order: q.order, limit: n }); },
        get: function () {
          calls.list++;
          return maybeFail('list') || backend.list(path).then(function (rows) {
            var out = apply(rows).map(function (r) { return { id: r.id, snap: docSnap(r.id, true, r.data) }; });
            return qsnap(out, out.map(function (r, i) { return { type: 'added', doc: r.snap, oldIndex: -1, newIndex: i }; }));
          });
        },
        onSnapshot: function (next, error) {
          if (++subs > 64) { subs--; setTimeout(function () { if (error) error(dbErr('resource_exhausted', 'subscription cap')); }, 0); return function () {}; }
          var dead = false;
          var state = new Map(); // id -> {json, snap, data, path}
          var ready = false, queued = [];
          var emit = function (changes) {
            if (dead || !changes.length) return;
            var rows = apply(Array.from(state.values()).map(function (v) { return { id: v.id, path: v.path, data: v.data, snap: v.snap }; }));
            var idx = new Map(rows.map(function (r, i) { return [r.id, i]; }));
            next(qsnap(rows, changes.map(function (ch) { return { type: ch.type, doc: ch.snap, oldIndex: ch.type === 'added' ? -1 : 0, newIndex: ch.type === 'removed' ? -1 : (idx.has(ch.snap.id) ? idx.get(ch.snap.id) : -1) }; })));
          };
          var onChange = function (ch) {
            if (parentColl(ch.path) !== path || hidden(ch.path)) return;
            if (!ready) { queued.push(ch); return; }
            var id = ch.path.split('/').pop();
            var prev = state.get(id);
            if (ch.data == null) {
              if (!prev) return;
              state.delete(id);
              emit([{ type: 'removed', snap: prev.snap }]);
              return;
            }
            var json = JSON.stringify(ch.data);
            if (prev && prev.json === json) return; // unchanged document: no delivery
            var snap = docSnap(id, true, ch.data);
            state.set(id, { id: id, path: ch.path, json: json, data: snap.data(), snap: snap });
            emit([{ type: prev ? 'modified' : 'added', snap: snap }]);
          };
          var off = backend.onChange(onChange);
          backend.list(path).then(function (rows) {
            rows.forEach(function (r) { if (hidden(r.path)) return; var s = docSnap(r.id, true, r.data); state.set(r.id, { id: r.id, path: r.path, json: JSON.stringify(r.data), data: s.data(), snap: s }); });
            ready = true;
            var initial = apply(Array.from(state.values()).map(function (v) { return { id: v.id, path: v.path, data: v.data, snap: v.snap }; }));
            if (!dead) next(qsnap(initial, initial.map(function (r, i) { return { type: 'added', doc: r.snap, oldIndex: -1, newIndex: i }; })));
            var qd = queued; queued = []; qd.forEach(onChange);
          });
          return function () { if (!dead) { dead = true; subs--; off(); } };
        },
      };
      return Object.freeze(c);
    }

    var db = Object.freeze({ doc: docRef, collection: collRef });
    var user = Object.freeze({
      id: function () { return Promise.resolve(userId); },
      me: function () { return Promise.resolve({ id: userId, name: '', avatarUrl: 'data:,', color: '#888', email: null, isOwner: true, canEdit: true }); },
      isOwner: function () { return Promise.resolve(true); },
      canEdit: function () { return Promise.resolve(true); },
      can: function () { return Promise.resolve(null); },
      profiles: function (ids) { var o2 = {}; [].concat(ids).forEach(function (i) { o2[i] = { id: i, name: '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === userId, guest: false }; }); return Promise.resolve(o2); },
      name: function () { return Promise.resolve(''); }, avatarUrl: function () { return Promise.resolve(null); }, search: function () { return Promise.resolve([]); }, email: function () { return Promise.resolve(null); },
    });
    var ALLOWED = /\.(gif|png|jpe?g|webp|mp4|webm|txt|json|md|docx|pptx|epub|csv|ttf|html|svg|pdf|xlsx|zip)$/i;
    var downloads = Object.freeze({
      save: function (req) {
        if (!req || typeof req.filename !== 'string' || !req.filename || req.data == null || req.data === '') return Promise.reject({ code: 'bad_request', message: 'bad request' });
        if (!ALLOWED.test(req.filename)) return Promise.reject({ code: 'rejected_extension', message: 'extension' });
        if (o.declineDownloads) return Promise.reject({ code: 'declined', message: 'declined' });
        saved.push({ filename: req.filename, data: typeof req.data === 'string' ? req.data : String(req.data) });
        return Promise.resolve({ status: 'saved' });
      },
    });
    var spaces = { db: db, user: user, downloads: downloads };
    var memo = {};
    var claude = Object.freeze({
      use: function (name) {
        if (!caps[name] || !spaces[name]) return new Promise(function (r) { setTimeout(function () { r(null); }, delayMs); });
        if (!memo[name]) memo[name] = new Promise(function (r) { setTimeout(function () { r(spaces[name]); }, delayMs); });
        return memo[name];
      },
    });
    return {
      claude: claude, backend: backend, saved: saved, calls: calls,
      inject: function (f) { injections.push(Object.assign({ times: 1 }, f)); },
      subscriptions: function () { return subs; },
    };
  }

  var lib = { createFakeClaude: createFakeClaude, createMemoryBackend: createMemoryBackend, createHttpBackend: createHttpBackend };
  root.FakeClaude = lib;
  if (typeof module === 'object' && module.exports) module.exports = lib;
})(typeof window !== 'undefined' ? window : globalThis);
