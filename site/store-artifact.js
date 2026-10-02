/* Finanças Flow — store-artifact.js
 * Terceiro adaptador do Store (ARCHITECTURE.md): mode "artifact", para rodar como Artifact do claude.ai.
 * Só é usado no build `npm run build:artifact` (dist-artifact/financas-flow.html); a versão Netlify não
 * carrega este arquivo. Usa o runtime do Artifact:
 *   const db = await claude.use("db"); const user = await claude.use("user"); const downloads = await claude.use("downloads");
 * (o artifact precisa ser publicado com capabilities { db: {}, user: {}, downloads: {} }).
 *
 * Login: a própria conta do claude.ai. user = { id, email: null }; login/logout não fazem nada; nunca "signed_out".
 * Sem db ou sem id (claude.use resolveu null, página aberta fora do claude.ai…): cai no adaptador "local"
 * do store.js (localStorage) e o status fica "local" ("Só neste aparelho").
 *
 * Onde ficam os dados (subárvore privada do usuário, ninguém mais lê — nem o dono do artifact):
 *   data/users/<id>/ff/v2meta/<settings|categories|rules|profiles|accounts|imports>
 *        { v:2, kind:'meta', name, data, updatedAt, writer, vid, parent }
 *   data/users/<id>/ff/v2months/<YYYY-MM>   (e <YYYY-MM>~n quando o mês passa de ~200 KB; limite do doc: 256 KiB)
 *        { v:2, kind:'month', ym, transactions:[...com tombstones], updatedAt, writer, vid }
 * (data/users/<id> é uma COLEÇÃO pela gramática de caminhos do db, por isso o doc intermediário "ff".)
 * Os corpos são os mesmos da Netlify (doc meta {data}, doc mês {transactions}) + writer/vid/parent para
 * reconhecer o eco das próprias escritas e detectar escrita concorrente.
 *
 * Sincronização: um onSnapshot por coleção (assinado uma vez no init). Eventos subscribe() só para mudanças
 * de OUTRA aba/aparelho. Meses: merge por id de lançamento, updatedAt mais novo vence, tombstones (90 dias) —
 * os mesmos mergeRows/stampRowsAt do store.js. Meta: merge de 3 vias (merge3 do store.js).
 * O db é last-writer-wins sem transações: cada escrita relê o doc e mescla antes do set (uma escrita por vez);
 * se um snapshot mostra que outro aparelho sobrescreveu sem ver a nossa versão, reescrevemos o merge (reparo).
 */
(function (root) {
  'use strict';

  var LIB = root.FinStoreLib || (typeof require === 'function' ? require('./store.js') : null);
  var META_NAMES = LIB.META_NAMES;
  var mergeRows = LIB.mergeRows, merge3 = LIB.merge3, normalizeBackup = LIB.normalizeBackup, stampRowsAt = LIB.stampRowsAt;
  var liveRows = LIB.liveRows, clone = LIB.clone, deepEqual = LIB.deepEqual, ts = LIB.ts, baseYm = LIB.baseYm, emitter = LIB.emitter;

  var SPLIT_BYTES = 200 * 1024;      // parte de mês: bem abaixo do limite de 256 KiB do documento
  var USE_TIMEOUT_MS = 12000;        // o runtime promete resolver null em 10 s; isto é só uma rede de segurança
  var TERMINAL = { revoked: 1, not_granted: 1, capability_disabled: 1, capability_removed: 1 };
  var PERMANENT = { invalid_argument: 1, transform_error: 1, quota_exceeded: 1 };

  function errCode(e) { return (e && typeof e.code === 'string') ? e.code : 'unavailable'; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(null); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v == null ? null : v); }, function () { clearTimeout(t); resolve(null); });
    });
  }
  function partIndex(key) { var m = /~(\d+)$/.exec(key); return m ? +m[1] : 0; }
  function partKey(ym, i) { return i ? ym + '~' + i : ym; }
  /** O remoto já contém tudo o que temos? (mesma regra de desempate do mergeRows com o remoto por último) */
  function covers(remoteRows, localRows) {
    var rm = new Map((remoteRows || []).map(function (r) { return [r.id, r]; }));
    return (localRows || []).every(function (l) {
      var r = rm.get(l.id);
      if (!r) return false;
      var a = ts(r), b = ts(l);
      return a > b || (a === b && (!!r.deleted === !!l.deleted || !!r.deleted));
    });
  }
  function sortRows(rows) { return rows.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }); }
  function sameRows(a, b) { return deepEqual(sortRows(a || []), sortRows(b || [])); }

  function createArtifactStore(opts) {
    opts = opts || {};
    var W = opts.window !== undefined ? opts.window : (typeof window !== 'undefined' ? window : null);
    var C = opts.claude || (W && W.claude) || null;
    var now = opts.now || function () { return Date.now(); };
    var splitBytes = opts.splitBytes || SPLIT_BYTES;
    var TAB = opts.tabId || ('t' + rid());   // identifica ESTA aba: ecos das próprias escritas são ignorados

    var authEv = emitter(), statusEv = emitter(), remoteEv = emitter();
    var S = {
      mode: 'artifact', status: 'saving', user: null, lastError: null,
      impl: null, initP: null, db: null, downloads: null, uid: null,
      metaColl: null, monthColl: null, unsubs: [],
      meta: {},        // name -> dados atuais (visão do app)
      base: {},        // name -> {vid, data}: versão remota em que a cópia local se baseia
      lastWritten: {}, // name -> {vid, pre:{vid,data}|null, data}: nossa última escrita (detectar sobrescrita)
      rows: {},        // ym -> linhas lógicas (com tombstones)
      remote: {},      // "meta:name" | "month:key" -> {vid, writer, parent, data|rows}
      dirty: new Set(), inflight: null, flightForeign: {}, touched: new Set(), ownDeletes: new Set(),
      flushing: null, retryTimer: null, backoff: 0, permErr: false, dead: false,
    };

    var api = {
      get status() { return S.status; },
      get mode() { return S.mode; },
      get user() { return S.impl ? S.impl.user : (S.user ? { id: S.user.id, email: null } : null); },
      get lastError() { return S.impl ? S.impl.lastError : S.lastError; },
      init: init,
      login: function () { return init().then(function () { return api.user; }); },
      logout: function () { return Promise.resolve(); },
      onAuth: function (fn) { return authEv.on(fn); },
      onStatus: function (fn) { return statusEv.on(fn); },
      subscribe: function (fn) { return remoteEv.on(fn); },
      loadAll: loadAll, saveMeta: saveMeta, saveMonth: saveMonth, deleteMonth: deleteMonth,
      exportAll: exportAll, importAll: importAll, parseBackup: normalizeBackup,
      saveFile: saveFile,
      sync: function () { return init().then(function () { return S.impl ? (S.impl.sync ? S.impl.sync() : null) : flush(); }); },
      flush: function () { return init().then(function () { return S.impl ? null : flush(); }); },
      destroy: destroy,
    };

    function setStatus(s) { if (S.status === s) return; S.status = s; statusEv.emit(s); }

    /* ---------------- init: capacidades do runtime, carga inicial, assinaturas */
    function init() {
      if (S.initP) return S.initP;
      S.initP = (async function () {
        var use = function (name) {
          try { return withTimeout(C && typeof C.use === 'function' ? C.use(name) : null, opts.useTimeoutMs || USE_TIMEOUT_MS); } catch (e) { return Promise.resolve(null); }
        };
        var caps = await Promise.all([use('db'), use('user'), use('downloads')]);
        S.db = caps[0]; S.downloads = caps[2];
        var user = caps[1];
        var uid = null;
        if (user && typeof user.id === 'function') { try { uid = await user.id(); } catch (e) { uid = null; } }
        if (!S.db || typeof uid !== 'string' || !uid) return fallbackLocal();
        try {
          var root_ = S.db.collection('data/users/' + uid).doc('ff');
          S.metaColl = root_.collection('v2meta');
          S.monthColl = root_.collection('v2months');
        } catch (e) { return fallbackLocal(); }
        S.uid = uid;
        try {
          var snaps = await Promise.all([retry(function () { return S.metaColl.get(); }), retry(function () { return S.monthColl.get(); })]);
          snaps[0].docs.forEach(function (d) { ingestMeta(d, true); });
          snaps[1].docs.forEach(function (d) { ingestMonthDoc(d.id, d.exists ? d.data() : null); });
          Object.keys(S.rows).forEach(function (ym) { S.rows[ym] = mergeRows([], remoteUnion(ym), now()); });
        } catch (e) {
          if (TERMINAL[errCode(e)]) return fallbackLocal();
          S.lastError = 'Não consegui ler seus dados no claude.ai (' + errCode(e) + ').';
          setStatus('error');
        }
        S.user = { id: uid, email: null };
        subscribeAll();
        if (S.status !== 'error') setStatus('synced');
        authEv.emit({ user: api.user });
      })().then(function () { return { mode: S.mode, user: api.user }; });
      return S.initP;
    }

    function fallbackLocal() {
      S.mode = 'local';
      var impl = LIB.createStore(Object.assign({}, opts, { mode: 'local' }));
      S.impl = impl;
      impl.onStatus(function (s) { setStatus(s); });
      impl.subscribe(function (ev) { remoteEv.emit(ev); });
      return impl.init().then(function () { setStatus(impl.status || 'local'); });
    }

    function subscribeAll() {
      var sub = function (coll, onDoc) {
        var unsub = null;
        var start = function () {
          unsub = coll.onSnapshot(function (qs) {
            try { qs.docChanges().forEach(function (ch) { onDoc(ch); }); afterSnapshot(); } catch (e) { if (root.console) console.error(e); }
          }, function (e) {
            var c = errCode(e);
            if (TERMINAL[c]) { S.dead = true; S.lastError = 'O acesso ao armazenamento do claude.ai foi encerrado. Recarregue a página.'; setStatus('error'); return; }
            if (c === 'unavailable') { setTimeout(start, 1000 + Math.random() * 2000); return; } // ponte caiu: só uma nova assinatura recupera
            S.lastError = 'A sincronização parou (' + c + '). Recarregue a página.'; setStatus('error');
          });
        };
        start();
        S.unsubs.push(function () { if (unsub) unsub(); });
      };
      sub(S.metaColl, function (ch) {
        if (ch.type === 'removed') return; // meta nunca é apagado por este app
        onRemoteMeta(ch.doc);
      });
      sub(S.monthColl, function (ch) {
        var key = ch.doc.id;
        if (ch.type === 'removed') {
          if (S.ownDeletes.has(key)) { S.ownDeletes.delete(key); ingestMonthDoc(key, null); return; }
          ingestMonthDoc(key, null);
        } else {
          var body = ch.doc.data();
          ingestMonthDoc(key, body);
          if (body && body.writer === TAB) return; // eco da própria escrita
        }
        S.touched.add(baseYm(key));
      });
    }

    function ingestMeta(docSnap, initial) {
      var name = docSnap.id; if (META_NAMES.indexOf(name) < 0 || !docSnap.exists) return;
      var b = docSnap.data();
      S.remote['meta:' + name] = { vid: b.vid || null, writer: b.writer || null, parent: b.parent || null, data: b.data };
      if (initial) { S.meta[name] = clone(b.data); S.base[name] = { vid: b.vid || null, data: clone(b.data) }; }
    }
    function ingestMonthDoc(key, body) {
      if (!LIB.YM_RE.test(key)) return;
      var k = 'month:' + key;
      if (!body) { delete S.remote[k]; return; }
      S.remote[k] = { vid: body.vid || null, writer: body.writer || null, rows: Array.isArray(body.transactions) ? body.transactions : [] };
      var ym = baseYm(key); if (!S.rows[ym]) S.rows[ym] = [];
    }
    function partKeys(ym) {
      return Object.keys(S.remote).filter(function (k) { return k.indexOf('month:') === 0 && baseYm(k.slice(6)) === ym; }).map(function (k) { return k.slice(6); });
    }
    function remoteUnion(ym) {
      var rows = [];
      partKeys(ym).sort(function (a, b) { return partIndex(a) - partIndex(b); }).forEach(function (key) { rows = mergeRows(rows, S.remote['month:' + key].rows); });
      return rows;
    }

    /* ---------------- mudanças remotas */
    function onRemoteMeta(docSnap) {
      var name = docSnap.id; if (META_NAMES.indexOf(name) < 0 || !docSnap.exists) return;
      var b = docSnap.data(); var k = 'meta:' + name;
      if (b.writer === TAB) { S.remote[k] = { vid: b.vid, writer: TAB, parent: b.parent || null, data: b.data }; return; } // eco
      var prevR = S.remote[k];
      if (prevR && prevR.vid && prevR.vid === b.vid) return;
      var lw = S.lastWritten[name];
      if (lw && lw.pre && lw.pre.vid && lw.pre.vid === b.vid) return; // entrega atrasada de uma versão que já mesclamos
      S.remote[k] = { vid: b.vid || null, writer: b.writer || null, parent: b.parent || null, data: b.data };
      var before = S.meta[name];
      if (S.inflight === k) { S.flightForeign[k] = true; return; }   // a escrita em andamento resolve depois
      if (S.dirty.has(k)) {
        // ainda não enviamos: incorpora o remoto mantendo as nossas mudanças
        var bs = S.base[name];
        var m = merge3(bs ? bs.data : undefined, before, b.data);
        S.meta[name] = m === undefined ? clone(b.data) : m;
        S.base[name] = { vid: b.vid || null, data: clone(b.data) };
      } else {
        var merged = clone(b.data);
        if (lw && b.parent !== lw.vid) {
          // outro aparelho gravou sem ter visto a nossa última escrita: mescla e regrava
          var m2 = merge3(lw.pre ? lw.pre.data : undefined, lw.data, b.data);
          if (m2 !== undefined) merged = m2;
        }
        S.lastWritten[name] = null;
        S.meta[name] = merged;
        S.base[name] = { vid: b.vid || null, data: clone(b.data) };
        if (!deepEqual(merged, b.data)) markDirty(k);
      }
      if (!deepEqual(before, S.meta[name])) remoteEv.emit({ kind: 'meta', key: name, data: clone(S.meta[name] === undefined ? null : S.meta[name]) });
    }

    function afterSnapshot() {
      var touched = S.touched; S.touched = new Set();
      touched.forEach(function (ym) {
        var k = 'month:' + ym;
        var ru = remoteUnion(ym);
        var before = liveRows(S.rows[ym]);
        S.rows[ym] = mergeRows(S.rows[ym] || [], ru, now());
        if (S.inflight === k) S.flightForeign[k] = true;
        else if (!S.dirty.has(k) && !covers(ru, S.rows[ym])) markDirty(k); // outro aparelho sobrescreveu linhas nossas
        var after = liveRows(S.rows[ym]);
        if (!sameRows(before, after)) remoteEv.emit({ kind: 'month', key: ym, data: clone(after), deleted: !after.length });
      });
    }

    /* ---------------- leitura */
    function emptyMeta() { var m = {}; META_NAMES.forEach(function (n) { m[n] = null; }); return m; }
    function snapshot() {
      var out = { meta: emptyMeta(), months: {} };
      META_NAMES.forEach(function (n) { if (S.meta[n] !== undefined && S.meta[n] !== null) out.meta[n] = clone(S.meta[n]); });
      Object.keys(S.rows).sort().forEach(function (ym) { var l = liveRows(S.rows[ym]); if (l.length) out.months[ym] = clone(l); });
      return out;
    }
    function loadAll() { return init().then(function () { return S.impl ? S.impl.loadAll() : snapshot(); }); }

    /* ---------------- escrita (otimista; o envio é serializado, uma escrita por vez) */
    function checkName(name) { if (META_NAMES.indexOf(name) < 0) throw new Error('Nome de documento inválido: ' + name); }
    function checkYm(ym) { if (typeof ym !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error('Mês inválido: ' + ym); }

    function saveMeta(name, data) {
      return init().then(function () {
        if (S.impl) return S.impl.saveMeta(name, data);
        checkName(name);
        S.meta[name] = clone(data);
        markDirty('meta:' + name);
      });
    }
    function saveMonth(ym, txs) {
      return init().then(function () {
        if (S.impl) return S.impl.saveMonth(ym, txs);
        checkYm(ym);
        if (!Array.isArray(txs)) throw new Error('saveMonth espera uma lista de lançamentos.');
        var rows = stampRowsAt(S.rows[ym] || [], txs, new Date(now()).toISOString());
        S.rows[ym] = rows;
        // o app mandou cópia velha de uma linha já excluída: avisa o estado real do mês
        var stale = txs.some(function (t) { return t && rows.some(function (r) { return r.id === t.id && r.deleted; }); });
        if (stale) { var liveNow = liveRows(rows); setTimeout(function () { remoteEv.emit({ kind: 'month', key: ym, data: clone(liveNow), deleted: !liveNow.length }); }, 0); }
        markDirty('month:' + ym);
      });
    }
    function deleteMonth(ym) {
      return init().then(function () {
        if (S.impl) return S.impl.deleteMonth(ym);
        checkYm(ym);
        var nowIso = new Date(now()).toISOString();
        S.rows[ym] = (S.rows[ym] || []).map(function (r) { return r.deleted ? r : { id: r.id, deleted: true, updatedAt: nowIso }; });
        markDirty('month:' + ym);
      });
    }

    function markDirty(k) {
      S.dirty.add(k);
      S.permErr = false;
      if (!S.dead) { setStatus('saving'); scheduleFlush(0); }
    }
    function scheduleFlush(ms) {
      if (S.retryTimer) clearTimeout(S.retryTimer);
      S.retryTimer = setTimeout(function () { S.retryTimer = null; flush(); }, ms || 0);
      if (S.retryTimer && S.retryTimer.unref) S.retryTimer.unref();
    }

    /** Chama o db; `unavailable` (ou código desconhecido) → uma nova tentativa após uma pausa aleatória. */
    function retry(fn) {
      return Promise.resolve().then(fn).catch(function (e) {
        var c = e && typeof e.code === 'string' ? e.code : '';
        if (TERMINAL[c] || PERMANENT[c] || c === 'resource_exhausted') throw e;
        return sleep(200 + Math.random() * 600).then(fn);
      });
    }

    function flush() {
      if (S.impl || !S.db || S.dead) return Promise.resolve();
      if (S.flushing) { S.again = true; return S.flushing; }
      S.flushing = (async function () {
        while (S.dirty.size) {
          var k = S.dirty.values().next().value;
          S.dirty.delete(k);
          S.inflight = k; S.flightForeign[k] = false;
          setStatus('saving');
          try {
            if (k.indexOf('meta:') === 0) await writeMeta(k.slice(5));
            else await writeMonth(k.slice(6));
            S.backoff = 0;
          } catch (e) {
            S.inflight = null;
            S.dirty.add(k);
            var c = errCode(e);
            if (TERMINAL[c]) { S.dead = true; S.lastError = 'O acesso ao armazenamento do claude.ai foi encerrado. Recarregue a página.'; setStatus('error'); return; }
            if (PERMANENT[c]) {
              S.permErr = true;
              S.lastError = c === 'quota_exceeded' ? 'O armazenamento deste artifact está cheio. Exporte um backup e apague dados antigos.'
                : 'O claude.ai recusou salvar (' + c + '). Talvez você só tenha permissão de leitura neste artifact.';
              setStatus('error');
              return; // tenta de novo na próxima alteração
            }
            S.lastError = c === 'resource_exhausted' ? 'Muitas gravações seguidas; tentando de novo em instantes.' : 'Sem conexão com o armazenamento do claude.ai; as alterações sobem quando voltar.';
            setStatus(c === 'resource_exhausted' ? 'saving' : 'offline');
            S.backoff = Math.min(60000, S.backoff ? S.backoff * 2 : 2000);
            scheduleFlush(S.backoff);
            return;
          }
          S.inflight = null;
        }
        setStatus(S.permErr ? 'error' : 'synced');
      })().finally(function () {
        S.flushing = null;
        if (S.again) { S.again = false; if (S.dirty.size && !S.permErr && !S.dead) scheduleFlush(0); }
      });
      return S.flushing;
    }

    async function writeMeta(name) {
      var k = 'meta:' + name;
      var ref = S.metaColl.doc(name);
      var sent = clone(S.meta[name]);
      var snap = await retry(function () { return ref.get(); });
      var R = snap && snap.exists ? snap.data() : null;
      var bs = S.base[name];
      var merged = sent;
      if (R && (!bs || R.vid !== bs.vid)) {
        var m = merge3(bs ? bs.data : undefined, sent, R.data);
        merged = m === undefined ? clone(R.data) : m;
      }
      if (R && deepEqual(R.data, merged)) {
        // nada a gravar: o remoto já é isto
        S.base[name] = { vid: R.vid || null, data: clone(R.data) };
        S.remote[k] = { vid: R.vid || null, writer: R.writer || null, parent: R.parent || null, data: R.data };
      } else {
        var vid = rid();
        var body = { v: 2, kind: 'meta', name: name, data: merged, updatedAt: new Date(now()).toISOString(), writer: TAB, vid: vid, parent: R ? (R.vid || null) : null };
        await retry(function () { return ref.set(body); });
        S.remote[k] = { vid: vid, writer: TAB, parent: body.parent, data: merged };
        S.lastWritten[name] = { vid: vid, pre: R ? { vid: R.vid || null, data: clone(R.data) } : null, data: clone(merged) };
        S.base[name] = { vid: vid, data: clone(merged) };
      }
      var cur = S.meta[name];
      var next = deepEqual(cur, sent) ? clone(merged) : (function () { var x = merge3(sent, cur, merged); return x === undefined ? cur : x; })();
      S.meta[name] = next;
      if (!deepEqual(next, merged) || S.flightForeign[k]) S.dirty.add(k);
      if (!deepEqual(cur, next)) remoteEv.emit({ kind: 'meta', key: name, data: clone(next) });
    }

    /** Divide o mês em partes de até ~200 KB (ym, ym~1, ym~2…). Ordem estável por id. */
    function partition(ym, rows) {
      var sorted = sortRows(rows);
      var parts = [[]], size = 0;
      if (utf8Bytes(JSON.stringify(sorted)) > splitBytes) {
        sorted.forEach(function (r) {
          var n = utf8Bytes(JSON.stringify(r)) + 1;
          if (parts[parts.length - 1].length && size + n > splitBytes) { parts.push([]); size = 0; }
          parts[parts.length - 1].push(r); size += n;
        });
      } else parts = [sorted];
      return parts.map(function (p, i) { return { key: partKey(ym, i), rows: p }; });
    }

    async function writeMonth(ym) {
      var k = 'month:' + ym;
      var keys = partKeys(ym); if (keys.indexOf(ym) < 0) keys.push(ym);
      var remoteRows = [];
      var exists = {};
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var snap = await retry(function () { return S.monthColl.doc(key).get(); });
        if (snap && snap.exists) { var b = snap.data(); exists[key] = true; ingestMonthDoc(key, b); remoteRows = mergeRows(remoteRows, b.transactions || []); }
        else ingestMonthDoc(key, null);
      }
      var merged = mergeRows(remoteRows, S.rows[ym] || [], now());
      var parts = partition(ym, merged);
      var nowIso = new Date(now()).toISOString();
      var written = [];
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        var r = S.remote['month:' + p.key];
        if (r && sameRows(r.rows, p.rows)) { written = written.concat(p.rows); continue; } // inalterado
        var vid = rid();
        var body = { v: 2, kind: 'month', ym: p.key, transactions: p.rows, updatedAt: nowIso, writer: TAB, vid: vid };
        await retry(function () { return S.monthColl.doc(p.key).set(body); });
        S.remote['month:' + p.key] = { vid: vid, writer: TAB, rows: p.rows };
        written = written.concat(p.rows);
      }
      // partes que sobraram de uma divisão anterior (as linhas delas já estão nas partes novas)
      var keep = new Set(parts.map(function (p) { return p.key; }));
      for (var q = 0; q < keys.length; q++) {
        var old = keys[q];
        if (keep.has(old) || !exists[old]) continue;
        S.ownDeletes.add(old);
        S.remote['month:' + old] = { vid: null, writer: TAB, rows: [] };
        await retry(function () { return S.monthColl.doc(old).delete(); });
        delete S.remote['month:' + old];
      }
      var cur = S.rows[ym] || [];
      var before = liveRows(cur);
      S.rows[ym] = mergeRows(merged, cur, now());
      if (!covers(written, S.rows[ym]) || S.flightForeign[k]) S.dirty.add(k);
      var after = liveRows(S.rows[ym]);
      if (!sameRows(before, after)) remoteEv.emit({ kind: 'month', key: ym, data: clone(after), deleted: !after.length });
    }

    /* ---------------- backup e arquivos */
    function exportAll() {
      return loadAll().then(function (d) {
        return { app: 'financas-flow', version: 2, exportedAt: new Date(now()).toISOString(), meta: d.meta, months: d.months };
      });
    }
    /** Mesma semântica do store.js: substitui (padrão) ou mescla ({mode:'merge'}). */
    function importAll(obj, o) {
      var mode = (o && o.mode) || 'replace';
      var n = normalizeBackup(obj);
      return init().then(function () {
        if (S.impl) return S.impl.importAll(obj, o);
        return loadAll().then(function (cur) {
          var nowIso = new Date(now()).toISOString();
          var ops = [];
          META_NAMES.forEach(function (name) { if (n.meta[name] !== undefined) ops.push(function () { return saveMeta(name, n.meta[name]); }); });
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
        }).then(function () { return flush(); }).then(function () { return n.stats; });
      });
    }
    /**
     * Oferece um arquivo para o usuário salvar (Artifacts bloqueiam <a download>).
     * Resolve {status} quando aceito; rejeita com {code} (ex.: 'declined'); resolve false se o runtime não
     * tem `downloads` (aí o app usa o <a download> de sempre).
     */
    function saveFile(filename, text) {
      return init().then(function () {
        if (!S.downloads || typeof S.downloads.save !== 'function') return false;
        return S.downloads.save({ filename: filename, data: text });
      });
    }

    function destroy() {
      S.unsubs.forEach(function (u) { try { u(); } catch (e) { /* ignore */ } });
      S.unsubs = [];
      if (S.retryTimer) clearTimeout(S.retryTimer);
      if (S.impl && S.impl.destroy) S.impl.destroy();
    }

    api._debug = function () { return S; };
    return api;
  }

  /** Tamanho em bytes UTF-8 (sem depender de TextEncoder). */
  function utf8Bytes(str) {
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
    }
    return n;
  }

  var lib = { createArtifactStore: createArtifactStore, covers: covers, SPLIT_BYTES: SPLIT_BYTES };
  root.FinStoreArtifact = lib;
  if (typeof module === 'object' && module.exports) module.exports = lib;
})(typeof window !== 'undefined' ? window : globalThis);
