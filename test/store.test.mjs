// Testes do site/store.js em node: fetch falso ligado ao handler real da API
// (com Blobs em memória), localStorage falso e Identity falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHandler } from '../netlify/lib/api-core.mjs';

const require = createRequire(import.meta.url);
const { createStore, normalizeBackup, merge3, mergeRows } = require('../site/store.js');

const ORIGIN = 'https://financas.example';
const T0 = Date.parse('2026-10-01T12:00:00Z');

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}
function memBlobs() {
  const mem = new Map(); let n = 0;
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    mem,
    async getWithMetadata(key, o = {}) { await tick(); const e = mem.get(key); return e ? { data: o.type === 'json' ? JSON.parse(e.body) : e.body, etag: e.etag, metadata: {} } : null; },
    async setJSON(key, v, o = {}) {
      await tick(); const e = mem.get(key);
      if (o.onlyIfNew && e) return { modified: false };
      if (o.onlyIfMatch !== undefined && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
      const etag = `"${++n}"`; mem.set(key, { body: JSON.stringify(v), etag }); return { modified: true, etag };
    },
    async list({ prefix = '' } = {}) { await tick(); return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: mem.get(key).etag })), directories: [] }; },
    async delete(k) { mem.delete(k); },
  };
}

/** Um "servidor" Netlify falso + fábrica de aparelhos. */
function world() {
  const blobs = memBlobs();
  let clock = T0;
  const handler = createHandler({
    getUser: async (req) => {
      const a = req.headers.get('authorization') || '';
      const m = /^Bearer (\w+)$/.exec(a);
      return m ? { id: m[1] } : null;
    },
    getStore: () => blobs,
    now: () => clock,
    log: { error() {} },
  });
  const calls = [];
  function device(name, userId = 'alice', storage = fakeLocalStorage()) {
    const net = { offline: false, failNext: 0, failStatus: 503, token: userId };
    const fetchFn = async (path, init = {}) => {
      if (path === '/.netlify/identity/settings') return new Response('{"external":{"google":true},"disable_signup":true}', { headers: { 'content-type': 'application/json' } });
      if (net.offline) throw new TypeError('Failed to fetch');
      calls.push(`${name} ${init.method || 'GET'} ${path}`);
      if (net.failNext > 0) { net.failNext--; return new Response('{"error":"x"}', { status: net.failStatus, headers: { 'content-type': 'application/json' } }); }
      const headers = new Headers(init.headers || {});
      // o fetch real manda o cookie nf_jwt; aqui simulamos via Authorization
      headers.set('authorization', `Bearer ${net.token}`);
      return handler(new Request(ORIGIN + path, { method: init.method || 'GET', headers, body: init.body }), {});
    };
    const identity = {
      getUser: async () => (net.token ? { id: userId, email: `${userId}@x.com` } : null),
      refreshSession: async () => null,
      onAuthChange: () => () => {},
      logout: async () => {},
    };
    const store = createStore({ mode: 'netlify', fetch: fetchFn, storage, indexedDB: null, identity, window: null, pollMs: 0, now: () => clock });
    const events = []; const statuses = [];
    store.subscribe((e) => events.push(e));
    store.onStatus((s) => statuses.push(s));
    return { store, net, events, statuses, storage, name };
  }
  return { blobs, device, calls, advance: (ms) => { clock += ms; }, get clock() { return clock; } };
}
const tx = (id, extra = {}) => Object.assign({ id, date: '2026-09-10', amount: -1000, merchant: 'X', accountId: 'acc' }, extra);
const ids = (rows) => rows.map((r) => r.id).sort();
const settle = () => new Promise((r) => setTimeout(r, 5));

test('modo local: salva, carrega, apaga mês e não usa rede', async () => {
  const ls = fakeLocalStorage();
  const s = createStore({ mode: 'local', storage: ls, window: null, fetch: () => { throw new Error('sem rede'); } });
  const info = await s.init();
  assert.equal(info.mode, 'local'); assert.equal(info.user, null);
  assert.equal(s.status, 'local');
  await s.saveMeta('accounts', { items: [{ id: 'a', name: 'A', type: 'cash' }] });
  await s.saveMonth('2026-09', [tx('t1'), tx('t2')]);
  let d = await s.loadAll();
  assert.deepEqual(d.meta.accounts, { items: [{ id: 'a', name: 'A', type: 'cash' }] });
  assert.equal(d.meta.settings, null);
  assert.deepEqual(ids(d.months['2026-09']), ['t1', 't2']);
  assert.ok(d.months['2026-09'].every((t) => typeof t.updatedAt === 'string'));
  await s.deleteMonth('2026-09');
  d = await s.loadAll();
  assert.equal(d.months['2026-09'], undefined);
  await assert.rejects(s.saveMeta('hack', {}));
  await assert.rejects(s.saveMonth('2026-13', []));
  // persistiu de verdade
  const s2 = createStore({ mode: 'local', storage: ls, window: null });
  assert.deepEqual((await s2.loadAll()).meta.accounts.items[0].id, 'a');
});

test('detecção automática: netlify quando /.netlify/identity/settings responde, senão local; lembra offline', async () => {
  const ls = fakeLocalStorage();
  const ok = async () => new Response('{"external":{},"disable_signup":true}', { headers: { 'content-type': 'application/json' } });
  const s = createStore({ fetch: ok, storage: ls, indexedDB: null, window: null, pollMs: 0, identity: { getUser: async () => null } });
  const r = await s.init();
  assert.equal(r.mode, 'netlify'); assert.equal(r.user, null); assert.equal(s.status, 'signed_out');
  assert.deepEqual((await s.loadAll()).months, {});
  // offline na próxima abertura: continua netlify (não cai para "local" silenciosamente)
  const s2 = createStore({ fetch: async () => { throw new TypeError('offline'); }, storage: ls, indexedDB: null, window: null, pollMs: 0, identity: { getUser: async () => null } });
  assert.equal((await s2.init()).mode, 'netlify');
  const s3 = createStore({ fetch: async () => new Response('not found', { status: 404 }), storage: fakeLocalStorage(), window: null });
  assert.equal((await s3.init()).mode, 'local');
});

test('netlify: salvar num aparelho aparece no outro; sem eco no próprio', async () => {
  const w = world();
  const A = w.device('A'); const B = w.device('B');
  assert.deepEqual((await A.store.init()).user, { id: 'alice', email: 'alice@x.com' });
  await B.store.init();
  await A.store.loadAll(); await B.store.loadAll();
  await A.store.saveMonth('2026-09', [tx('t1')]);
  await A.store.saveMeta('categories', { items: [{ id: 'c1' }] });
  await A.store.sync();
  assert.equal(A.store.status, 'synced');
  await A.store.sync(); // poll do próprio aparelho
  assert.equal(A.events.length, 0, 'sem eco das próprias escritas');
  await B.store.sync();
  assert.deepEqual(B.events.map((e) => `${e.kind}:${e.key}`).sort(), ['meta:categories', 'month:2026-09']);
  const m = B.events.find((e) => e.kind === 'month');
  assert.deepEqual(ids(m.data), ['t1']);
  const dB = await B.store.loadAll();
  assert.deepEqual(dB.meta.categories, { items: [{ id: 'c1' }] });
  // outro usuário não vê nada
  const C = w.device('C', 'bob');
  await C.store.init();
  assert.deepEqual((await C.store.loadAll()).months, {});
  [A, B, C].forEach((d) => d.store.destroy());
});

test('offline: fila persiste, sobrevive a recarregar a página e sobe quando volta a rede', async () => {
  const w = world();
  const A = w.device('A');
  await A.store.init(); await A.store.loadAll();
  A.net.offline = true;
  await A.store.saveMonth('2026-08', [tx('o1', { date: '2026-08-01' })]);
  await A.store.sync();
  assert.equal(A.store.status, 'offline');
  // leitura offline usa o cache
  assert.deepEqual(ids((await A.store.loadAll()).months['2026-08']), ['o1']);
  A.store.destroy();
  // "recarrega" com o mesmo armazenamento local
  const A2 = w.device('A2', 'alice', A.storage);
  A2.net.offline = true;
  await A2.store.init();
  assert.deepEqual(ids((await A2.store.loadAll()).months['2026-08']), ['o1']);
  A2.net.offline = false;
  await A2.store.sync();
  assert.equal(A2.store.status, 'synced');
  const B = w.device('B'); await B.store.init();
  assert.deepEqual(ids((await B.store.loadAll()).months['2026-08']), ['o1']);
  [A2, B].forEach((d) => d.store.destroy());
});

test('retry: erro 503 vira nova tentativa; nada se perde', async () => {
  const w = world();
  const A = w.device('A'); await A.store.init(); await A.store.loadAll();
  A.net.failNext = 1;
  await A.store.saveMonth('2026-07', [tx('r1', { date: '2026-07-02' })]);
  await A.store.sync();
  assert.notEqual(A.store.status, 'synced');
  await A.store.sync();
  assert.equal(A.store.status, 'synced');
  const B = w.device('B'); await B.store.init();
  assert.deepEqual(ids((await B.store.loadAll()).months['2026-07']), ['r1']);
  [A, B].forEach((d) => d.store.destroy());
});

test('dois aparelhos editam o mesmo mês offline: ninguém perde linhas; exclusão propaga', async () => {
  const w = world();
  const A = w.device('A'); const B = w.device('B');
  await A.store.init(); await B.store.init();
  await A.store.loadAll();
  await A.store.saveMonth('2026-09', [tx('base')]);
  await A.store.sync();
  await B.store.loadAll();
  A.net.offline = true; B.net.offline = true;
  w.advance(1000);
  await A.store.saveMonth('2026-09', [tx('base'), tx('fromA')]);
  w.advance(1000);
  await B.store.saveMonth('2026-09', [tx('base', { note: 'editado no B' }), tx('fromB')]);
  A.net.offline = false; B.net.offline = false;
  await Promise.all([A.store.sync(), B.store.sync()]);
  await A.store.sync(); await B.store.sync();
  const dA = await A.store.loadAll(); const dB = await B.store.loadAll();
  assert.deepEqual(ids(dA.months['2026-09']), ['base', 'fromA', 'fromB']);
  assert.deepEqual(ids(dB.months['2026-09']), ['base', 'fromA', 'fromB']);
  assert.equal(dA.months['2026-09'].find((t) => t.id === 'base').note, 'editado no B');
  assert.ok(A.events.some((e) => e.kind === 'month' && ids(e.data).includes('fromB')), 'A recebeu evento com a linha do B');
  // exclusão no A → some no B (tombstone), sem o app ver tombstones
  w.advance(1000);
  await A.store.saveMonth('2026-09', dA.months['2026-09'].filter((t) => t.id !== 'fromB'));
  await A.store.sync();
  B.events.length = 0;
  await B.store.sync();
  const last = B.events.filter((e) => e.kind === 'month').pop();
  assert.deepEqual(ids(last.data), ['base', 'fromA']);
  assert.ok(last.data.every((t) => !t.deleted));
  // B (atrasado) reenviando a lista antiga não ressuscita... desde que não tenha editado depois
  const dB2 = await B.store.loadAll();
  assert.deepEqual(ids(dB2.months['2026-09']), ['base', 'fromA']);
  // deleteMonth propaga como mês vazio
  await A.store.deleteMonth('2026-09'); await A.store.sync();
  B.events.length = 0; await B.store.sync();
  assert.equal(B.events[0].deleted, true);
  assert.equal((await B.store.loadAll()).months['2026-09'], undefined);
  [A, B].forEach((d) => d.store.destroy());
});

test('"Excluir importação" no A apaga no B e no servidor; cópia velha do B não ressuscita', async () => {
  const w = world();
  const A = w.device('A'); const B = w.device('B');
  await A.store.init(); await B.store.init();
  await A.store.loadAll();
  const imp = (id, extra) => tx(id, Object.assign({ importId: 'imp1' }, extra || {}));
  const keep = tx('keep', { importId: 'imp2' });
  const keepOct = tx('keepOct', { date: '2026-10-02', importId: 'imp2' });
  await A.store.saveMonth('2026-09', [imp('i1'), imp('i2'), keep]);
  await A.store.saveMonth('2026-10', [imp('i3', { date: '2026-10-01' }), keepOct]);
  await A.store.sync();
  const staleB = await B.store.loadAll();           // B tem a cópia completa (vai ficar velha)
  assert.deepEqual(ids(staleB.months['2026-09']), ['i1', 'i2', 'keep']);

  // A: o app exclui a importação deixando as linhas FORA do saveMonth
  w.advance(1000);
  const dA = await A.store.loadAll();
  await A.store.saveMonth('2026-09', dA.months['2026-09'].filter((t) => t.importId !== 'imp1'));
  await A.store.saveMonth('2026-10', dA.months['2026-10'].filter((t) => t.importId !== 'imp1'));
  await A.store.sync();
  // servidor: tombstones (o export não mostra as linhas)
  const srv = JSON.parse(w.blobs.mem.get('u/alice/months/2026-09').body).transactions;
  assert.ok(srv.find((r) => r.id === 'i1').deleted && srv.find((r) => r.id === 'i2').deleted);
  assert.ok(!srv.find((r) => r.id === 'keep').deleted);

  // Caso 1: B ainda NÃO sincronizou e edita outra linha do mesmo mês, mandando a cópia velha inteira
  w.advance(1000);
  B.events.length = 0;
  const edited = staleB.months['2026-09'].map((t) => (t.id === 'keep' ? Object.assign({}, t, { note: 'B', updatedAt: new Date(w.clock).toISOString() }) : t));
  await B.store.saveMonth('2026-09', edited);
  await B.store.sync();
  let ev = B.events.filter((e) => e.kind === 'month' && e.key === '2026-09').pop();
  assert.ok(ev, 'B recebe o mês corrigido');
  assert.deepEqual(ids(ev.data), ['keep']);
  assert.equal(ev.data[0].note, 'B');
  // Caso 2: B já recebeu os tombstones, mas o app (com edição pendente) ainda manda as linhas velhas
  w.advance(1000);
  B.events.length = 0;
  await B.store.saveMonth('2026-10', staleB.months['2026-10']);
  await new Promise((r) => setTimeout(r, 5));
  await B.store.sync();
  ev = B.events.filter((e) => e.kind === 'month' && e.key === '2026-10').pop();
  assert.ok(ev, 'B é avisado de que as linhas velhas continuam excluídas');
  assert.deepEqual(ids(ev.data), ['keepOct']);

  // estado final: servidor, A e B sem as linhas da importação excluída
  await A.store.sync();
  for (const d of [A, B]) {
    const all = await d.store.loadAll();
    assert.deepEqual(ids(all.months['2026-09']), ['keep'], d.name + ' set');
    assert.deepEqual(ids(all.months['2026-10']), ['keepOct'], d.name + ' out');
  }
  const exp = await A.store.exportAll();
  assert.deepEqual(Object.values(exp.months).flat().map((t) => t.id).sort(), ['keep', 'keepOct']);
  // um terceiro aparelho que entra depois também não vê nada da importação
  const C = w.device('C'); await C.store.init();
  const dC = await C.store.loadAll();
  assert.deepEqual(Object.values(dC.months).flat().map((t) => t.id).sort(), ['keep', 'keepOct']);
  [A, B, C].forEach((d) => d.store.destroy());
});

test('meta em conflito: merge de 3 vias mantém inclusões dos dois aparelhos', async () => {
  const w = world();
  const A = w.device('A'); const B = w.device('B');
  await A.store.init(); await B.store.init();
  await A.store.loadAll();
  await A.store.saveMeta('categories', { items: [{ id: 'c1', name: 'Um' }] });
  await A.store.sync();
  await B.store.loadAll();
  await A.store.saveMeta('categories', { items: [{ id: 'c1', name: 'Um' }, { id: 'cA', name: 'do A' }] });
  await A.store.sync();
  // B ainda não sincronizou: salva com base antiga → 412 → merge
  await B.store.saveMeta('categories', { items: [{ id: 'c1', name: 'Um (renomeado no B)' }, { id: 'cB', name: 'do B' }] });
  await B.store.sync();
  const dB = await B.store.loadAll();
  assert.deepEqual(dB.meta.categories.items.map((c) => c.id).sort(), ['c1', 'cA', 'cB']);
  assert.equal(dB.meta.categories.items.find((c) => c.id === 'c1').name, 'Um (renomeado no B)');
  assert.ok(B.events.some((e) => e.kind === 'meta' && e.key === 'categories'));
  await A.store.sync();
  assert.deepEqual((await A.store.loadAll()).meta.categories.items.map((c) => c.id).sort(), ['c1', 'cA', 'cB']);
  [A, B].forEach((d) => d.store.destroy());
});

test('401 → signed_out e onAuth avisa', async () => {
  const w = world();
  const A = w.device('A'); await A.store.init();
  const auth = []; A.store.onAuth((e) => auth.push(e));
  A.net.token = ''; // sessão expirada no servidor
  await A.store.loadAll();
  assert.equal(A.store.status, 'signed_out');
  assert.deepEqual(auth, [{ user: null }]);
  await assert.rejects(A.store.saveMonth('2026-01', []), /Entre para sincronizar/);
});

test('importAll aceita backup v1, db bruto v1 e backup v2; exportAll devolve v2', async () => {
  const v1backup = {
    app: 'financas-flow', version: 1, exportedAt: '2026-09-01T00:00:00Z',
    data: {
      settings: { budgets: { alimentacao: 50000 } },
      categories: [{ id: 'alimentacao', name: 'Alimentação', children: [] }],
      rules: [{ id: 'r1', match: { field: 'merchant', op: 'contains', value: 'IFOOD' }, set: { categoryId: 'alimentacao' } }],
      history: [{ at: '2026-09-01T00:00:00Z', merchant: 'IFOOD', categoryId: 'alimentacao', txId: 'a1' }],
      profiles: [], accounts: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }],
      txs: [tx('a1', { date: '2026-08-03' }), tx('a2', { date: '2026-09-05' }), { amount: 1 }],
    },
  };
  const n1 = normalizeBackup(v1backup);
  assert.equal(n1.stats.format, 'v1-backup');
  assert.equal(n1.stats.transactions, 2); assert.equal(n1.stats.skipped, 1);
  assert.deepEqual(n1.meta.accounts, { items: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }] });
  assert.equal(n1.meta.rules.rules.length, 1); assert.equal(n1.meta.rules.history.length, 1);
  assert.deepEqual(Object.keys(n1.months).sort(), ['2026-08', '2026-09']);

  // mesmo formato dos documentos do db da v1 (meta {items}/{rules,history}/{budgets}, meses com partes ~n)
  const v1db = {
    meta: {
      settings: { budgets: {} },
      categories: { items: [{ id: 'moradia', name: 'Moradia', children: [{ id: 'moradia.aluguel', name: 'Aluguel' }] }] },
      rules: { rules: [], history: [] },
      profiles: { items: [{ id: 'p1', name: 'Fatura', fingerprint: 'fp_x', columns: { date: 0, description: 2, amount: 3 } }] },
      accounts: { items: [{ id: 'cartao', name: 'Cartão', type: 'credit_card' }] },
    },
    months: {
      '2026-01': { month: '2026-01', part: 0, transactions: [tx('d1', { date: '2026-01-02', rowIndex: 2 })] },
      '2026-09': { month: '2026-09', part: 0, transactions: [tx('d2')] },
      '2026-09~1': { month: '2026-09', part: 1, transactions: [tx('d3')] },
    },
  };
  const n2 = normalizeBackup(v1db);
  assert.equal(n2.stats.format, 'v1-db');
  assert.deepEqual(ids(n2.months['2026-09']), ['d2', 'd3']);
  assert.deepEqual(n2.meta.profiles.items[0].id, 'p1');
  assert.deepEqual(n2.meta.settings, { budgets: {} });

  const w = world();
  const A = w.device('A'); await A.store.init(); await A.store.loadAll();
  await A.store.saveMonth('2026-02', [tx('old', { date: '2026-02-01' })]);
  const stats = await A.store.importAll(v1db);
  assert.equal(stats.transactions, 3);
  await A.store.sync();
  const B = w.device('B'); await B.store.init();
  const d = await B.store.loadAll();
  assert.deepEqual(Object.keys(d.months).sort(), ['2026-01', '2026-09'], 'substitui: o mês 2026-02 antigo foi apagado');
  assert.deepEqual(d.meta.accounts.items[0].id, 'cartao');
  const exp = await B.store.exportAll();
  assert.equal(exp.version, 2);
  assert.deepEqual(ids(exp.months['2026-09']), ['d2', 'd3']);
  // ida e volta: o export v2 reimporta igual
  const n3 = normalizeBackup(JSON.parse(JSON.stringify(exp)));
  assert.equal(n3.stats.format, 'v2');
  assert.equal(n3.stats.transactions, 3);
  // modo merge não apaga o que já existe
  await B.store.importAll({ version: 2, meta: {}, months: { '2026-03': [tx('m1', { date: '2026-03-01' })] } }, { mode: 'merge' });
  assert.deepEqual(Object.keys((await B.store.loadAll()).months).sort(), ['2026-01', '2026-03', '2026-09']);
  assert.throws(() => normalizeBackup({ foo: 1 }), /não parece um backup/);
  [A, B].forEach((x) => x.store.destroy());
});

test('merge3 e mergeRows (unidade)', () => {
  assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }), { a: 2, b: 3 });
  assert.deepEqual(
    merge3({ items: [{ id: 'x' }, { id: 'y' }] }, { items: [{ id: 'x' }] }, { items: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] }),
    { items: [{ id: 'x' }, { id: 'z' }] },
  );
  assert.deepEqual(merge3({ h: [1] }, { h: [1, 2] }, { h: [1, 3] }), { h: [1, 2, 3] });
  const rows = mergeRows([{ id: 'a', updatedAt: '2026-01-02T00:00:00Z', v: 1 }], [{ id: 'a', updatedAt: '2026-01-01T00:00:00Z', v: 0 }, { id: 'b', deleted: true, updatedAt: '2020-01-01T00:00:00Z' }], T0);
  assert.deepEqual(rows, [{ id: 'a', updatedAt: '2026-01-02T00:00:00Z', v: 1 }]);
});
