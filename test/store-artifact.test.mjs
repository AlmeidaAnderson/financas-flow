// Testes do site/store-artifact.js (mode "artifact") em node, com um runtime claude.use FALSO e fiel
// aos contratos (test/fake-claude.js). Vários "aparelhos" compartilham um backend em memória.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storeLib = require('../site/store.js');
const { createArtifactStore, covers } = require('../site/store-artifact.js');
const { createFakeClaude, createMemoryBackend } = require('./fake-claude.js');

const T0 = Date.parse('2026-10-01T12:00:00Z');
const UID = 'u_alice';
const BASE = `data/users/${UID}/ff`;

function fakeLocalStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _map: m };
}
function world() {
  const backend = createMemoryBackend();
  let clock = T0;
  const now = () => (clock += 1000);
  const stores = [];
  function device(o = {}) {
    const fake = createFakeClaude({ backend, userId: o.userId === undefined ? UID : o.userId, delayMs: o.delayMs ?? 5, caps: o.caps });
    const events = [];
    const store = createArtifactStore({ claude: fake.claude, window: null, now, storage: o.storage || fakeLocalStorage(), indexedDB: null, splitBytes: o.splitBytes });
    store.subscribe((ev) => events.push(ev));
    stores.push(store);
    return { store, fake, events };
  }
  async function settle() {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 5));
      const busy = stores.some((s) => { const S = s._debug(); return S.flushing || S.dirty.size || S.retryTimer; });
      if (!busy) { await new Promise((r) => setTimeout(r, 10)); if (!stores.some((s) => { const S = s._debug(); return S.flushing || S.dirty.size || S.retryTimer; })) return; }
      await Promise.all(stores.map((s) => s.flush()));
    }
    throw new Error('did not settle');
  }
  return { backend, device, settle, now };
}
const tx = (id, date, amount, extra = {}) => ({ id, date, amount, rawDescription: 'LOJA ' + id, merchant: 'LOJA ' + id, accountId: 'nu', kind: amount < 0 ? 'expense' : 'income', categoryId: null, ...extra });
const ids = (rows) => rows.map((r) => r.id).sort();

test('init: claude.use resolve depois; modo artifact, usuário {id, email:null}, status synced, sem login', async () => {
  const w = world();
  const { store } = w.device({ delayMs: 60 });
  const statuses = []; store.onStatus((s) => statuses.push(s));
  const auth = []; store.onAuth((e) => auth.push(e));
  const t = Date.now();
  const r = await store.init();
  assert.ok(Date.now() - t >= 50, 'waited for claude.use');
  assert.deepEqual(r, { mode: 'artifact', user: { id: UID, email: null } });
  assert.equal(store.status, 'synced');
  assert.equal(auth.length, 1);
  assert.deepEqual(await store.login(), { id: UID, email: null });
  await store.logout();
  assert.equal(store.status, 'synced', 'logout is a no-op; never signed_out');
  const all = await store.loadAll();
  assert.deepEqual(all, { meta: { settings: null, categories: null, rules: null, profiles: null, accounts: null, imports: null }, months: {} });
});

test('save/load: caminhos privados data/users/<id>/ff/{v2meta,v2months}, mesmos formatos da Netlify', async () => {
  const w = world();
  const A = w.device();
  await A.store.init();
  await A.store.saveMeta('accounts', { items: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }] });
  await A.store.saveMonth('2026-09', [tx('a1', '2026-09-10', -4590), tx('a2', '2026-09-12', -12000)]);
  await w.settle();
  const meta = JSON.parse(w.backend.docs.get(`${BASE}/v2meta/accounts`).json);
  assert.equal(meta.v, 2); assert.equal(meta.kind, 'meta'); assert.equal(meta.name, 'accounts');
  assert.deepEqual(meta.data, { items: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }] });
  const month = JSON.parse(w.backend.docs.get(`${BASE}/v2months/2026-09`).json);
  assert.equal(month.kind, 'month'); assert.equal(month.ym, '2026-09');
  assert.deepEqual(ids(month.transactions), ['a1', 'a2']);
  assert.ok(month.transactions.every((t) => typeof t.updatedAt === 'string'));
  assert.ok([...w.backend.docs.keys()].every((k) => k.startsWith(`data/users/${UID}/`)), 'nothing outside the private subtree');
  // outro aparelho (mesma conta) carrega tudo
  const B = w.device();
  await B.store.init();
  const all = await B.store.loadAll();
  assert.deepEqual(all.meta.accounts, { items: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }] });
  assert.deepEqual(ids(all.months['2026-09']), ['a1', 'a2']);
  // outro usuário não vê nada
  const X = w.device({ userId: 'u_bob' });
  await X.store.init();
  assert.deepEqual((await X.store.loadAll()).months, {});
});

test('sync ao vivo: mudança no A chega ao B via subscribe; sem eco no próprio A; uma assinatura por coleção', async () => {
  const w = world();
  const A = w.device(); const B = w.device();
  await A.store.init(); await B.store.init();
  await A.store.saveMonth('2026-09', [tx('s1', '2026-09-10', -100)]);
  await A.store.saveMeta('settings', { budgets: { lazer: 1000 } });
  await w.settle();
  assert.equal(A.events.length, 0, `no echo on A: ${JSON.stringify(A.events)}`);
  const mev = B.events.filter((e) => e.kind === 'month');
  assert.equal(mev.length, 1); assert.equal(mev[0].key, '2026-09'); assert.deepEqual(ids(mev[0].data), ['s1']);
  assert.deepEqual(B.events.find((e) => e.kind === 'meta').data, { budgets: { lazer: 1000 } });
  // muitas gravações não abrem novas assinaturas
  for (let i = 0; i < 5; i++) await A.store.saveMonth('2026-09', [tx('s1', '2026-09-10', -100 - i)]);
  await w.settle();
  assert.equal(A.fake.subscriptions(), 2); assert.equal(B.fake.subscriptions(), 2);
  assert.equal((await B.store.loadAll()).months['2026-09'][0].amount, -104);
  assert.equal(A.events.length, 0);
});

test('tombstones: exclusão no A some no B; cópia velha do B não ressuscita a linha', async () => {
  const w = world();
  const A = w.device(); const B = w.device();
  await A.store.init(); await B.store.init();
  await A.store.saveMonth('2026-09', [tx('k1', '2026-09-01', -100), tx('k2', '2026-09-02', -200), tx('k3', '2026-09-03', -300)]);
  await w.settle();
  const oldCopy = (await B.store.loadAll()).months['2026-09'];
  assert.equal(oldCopy.length, 3);
  B.events.length = 0;
  await A.store.saveMonth('2026-09', oldCopy.filter((t) => t.id !== 'k2'));
  await w.settle();
  const ev = B.events.filter((e) => e.kind === 'month').pop();
  assert.deepEqual(ids(ev.data), ['k1', 'k3']);
  const doc = JSON.parse(w.backend.docs.get(`${BASE}/v2months/2026-09`).json);
  assert.ok(doc.transactions.find((t) => t.id === 'k2' && t.deleted), 'tombstone stored');
  // B (desatualizado) grava a lista velha com k2 → a exclusão vence; B é avisado do estado real
  B.events.length = 0;
  await B.store.saveMonth('2026-09', oldCopy);
  await w.settle();
  assert.deepEqual(ids((await B.store.loadAll()).months['2026-09']), ['k1', 'k3']);
  assert.deepEqual(ids((await A.store.loadAll()).months['2026-09']), ['k1', 'k3']);
  assert.ok(B.events.some((e) => e.kind === 'month' && !e.data.some((t) => t.id === 'k2')), 'B told that k2 is gone');
  // deleteMonth: todas viram tombstones e o mês some no outro aparelho
  await A.store.deleteMonth('2026-09');
  await w.settle();
  assert.equal((await B.store.loadAll()).months['2026-09'], undefined);
  assert.ok(B.events.some((e) => e.kind === 'month' && e.deleted));
});

test('escritas concorrentes no mesmo mês (last-writer-wins do db) convergem sem perder linhas', async () => {
  const w = world();
  const A = w.device(); const B = w.device();
  await A.store.init(); await B.store.init();
  await A.store.saveMonth('2026-09', [tx('base', '2026-09-01', -1)]);
  await w.settle();
  const base = (await B.store.loadAll()).months['2026-09'];
  // os dois gravam "ao mesmo tempo", cada um sem ver o outro
  await Promise.all([
    A.store.saveMonth('2026-09', base.concat([tx('fromA', '2026-09-05', -50)])),
    B.store.saveMonth('2026-09', base.concat([tx('fromB', '2026-09-06', -60)])),
  ]);
  await w.settle();
  const a = ids((await A.store.loadAll()).months['2026-09']);
  const b = ids((await B.store.loadAll()).months['2026-09']);
  assert.deepEqual(a, ['base', 'fromA', 'fromB']);
  assert.deepEqual(b, a);
  const doc = JSON.parse(w.backend.docs.get(`${BASE}/v2months/2026-09`).json);
  assert.deepEqual(ids(doc.transactions), ['base', 'fromA', 'fromB']);
});

test('meta concorrente: merge de 3 vias mantém inclusões dos dois aparelhos', async () => {
  const w = world();
  const A = w.device(); const B = w.device();
  await A.store.init(); await B.store.init();
  await A.store.saveMeta('categories', { items: [{ id: 'casa', name: 'Casa', children: [] }] });
  await w.settle();
  const cur = (await B.store.loadAll()).meta.categories;
  await Promise.all([
    A.store.saveMeta('categories', { items: cur.items.concat([{ id: 'pets', name: 'Pets', children: [] }]) }),
    B.store.saveMeta('categories', { items: cur.items.concat([{ id: 'viagem', name: 'Viagem', children: [] }]) }),
  ]);
  await w.settle();
  const names = (s) => s.items.map((g) => g.id).sort();
  const a = (await A.store.loadAll()).meta.categories; const b = (await B.store.loadAll()).meta.categories;
  assert.deepEqual(names(a), ['casa', 'pets', 'viagem']);
  assert.deepEqual(names(b), ['casa', 'pets', 'viagem']);
  assert.deepEqual(names(JSON.parse(w.backend.docs.get(`${BASE}/v2meta/categories`).json).data), ['casa', 'pets', 'viagem']);
});

test('mês grande: divide em YYYY-MM~n (< 256 KiB por doc), o outro aparelho junta; ao encolher apaga as partes', async () => {
  const w = world();
  const A = w.device(); const B = w.device();
  await A.store.init(); await B.store.init();
  const big = Array.from({ length: 1400 }, (_, i) => tx('b' + String(i).padStart(4, '0'), '2026-08-' + String(1 + (i % 28)).padStart(2, '0'), -100 - i, { rawDescription: 'COMPRA COM DESCRIÇÃO BEM LONGA PARA OCUPAR ESPAÇO ' + 'x'.repeat(120) }));
  assert.ok(JSON.stringify(big).length > 256 * 1024, 'fixture really exceeds one document');
  await A.store.saveMonth('2026-08', big);
  await w.settle();
  const keys = [...w.backend.docs.keys()].filter((k) => k.includes('/v2months/2026-08')).sort();
  assert.ok(keys.length >= 2, `split into parts: ${keys}`);
  assert.ok(keys.includes(`${BASE}/v2months/2026-08~1`));
  for (const k of keys) assert.ok(Buffer.byteLength(w.backend.docs.get(k).json) <= 256 * 1024, `${k} fits`);
  assert.equal((await B.store.loadAll()).months['2026-08'].length, 1400);
  const C = w.device(); await C.store.init();
  assert.equal((await C.store.loadAll()).months['2026-08'].length, 1400, 'fresh device loads every part');
  // encolhe para 10 linhas: volta a ser um doc só (as outras viram tombstones, pequenos)
  await A.store.saveMonth('2026-08', big.slice(0, 10));
  await w.settle();
  const keys2 = [...w.backend.docs.keys()].filter((k) => k.includes('/v2months/2026-08')).sort();
  assert.deepEqual(keys2, [`${BASE}/v2months/2026-08`]);
  assert.equal((await B.store.loadAll()).months['2026-08'].length, 10);
  assert.equal((await C.store.loadAll()).months['2026-08'].length, 10);
});

test('erros do db: unavailable tenta de novo; quota_exceeded vira status error; próxima alteração retoma', async () => {
  const w = world();
  const A = w.device();
  await A.store.init();
  A.fake.inject({ op: 'set', code: 'unavailable', times: 1 });
  await A.store.saveMonth('2026-09', [tx('r1', '2026-09-01', -1)]);
  await w.settle();
  assert.ok(w.backend.docs.has(`${BASE}/v2months/2026-09`), 'saved after one retry');
  assert.equal(A.store.status, 'synced');
  A.fake.inject({ op: 'set', code: 'quota_exceeded', times: 2 });
  await A.store.saveMeta('settings', { budgets: { x: 1 } });
  await A.store.flush();
  assert.equal(A.store.status, 'error');
  assert.match(A.store.lastError, /cheio/);
  await A.store.saveMeta('settings', { budgets: { x: 2 } }); // consome a 2a falha injetada
  await A.store.flush();
  await A.store.saveMeta('settings', { budgets: { x: 3 } });
  await w.settle();
  assert.equal(A.store.status, 'synced');
  assert.deepEqual(JSON.parse(w.backend.docs.get(`${BASE}/v2meta/settings`).json).data, { budgets: { x: 3 } });
  // revoked: terminal
  A.fake.inject({ op: 'get', code: 'revoked', times: 1 });
  await A.store.saveMeta('settings', { budgets: { x: 4 } });
  await A.store.flush();
  assert.equal(A.store.status, 'error');
});

test('sem capacidade (claude.use → null) ou sem id: cai no modo local ("Só neste aparelho")', async () => {
  for (const o of [{ caps: { db: false } }, { userId: null }, { caps: { user: false } }]) {
    const w = world();
    const ls = fakeLocalStorage();
    const A = w.device({ ...o, storage: ls });
    const r = await A.store.init();
    assert.equal(r.mode, 'local'); assert.equal(r.user, null);
    assert.equal(A.store.status, 'local');
    await A.store.saveMonth('2026-09', [tx('l1', '2026-09-01', -1)]);
    assert.ok(ls.getItem('ff2:local').includes('l1'), 'saved in localStorage');
    assert.deepEqual(ids((await A.store.loadAll()).months['2026-09']), ['l1']);
    assert.equal(w.backend.docs.size, 0, 'nothing written to the db');
  }
  // window.claude sem resposta: o próprio store desiste depois do timeout
  const never = { use: () => new Promise(() => {}) };
  const s = createArtifactStore({ claude: never, window: null, storage: fakeLocalStorage(), useTimeoutMs: 50 });
  assert.equal((await s.init()).mode, 'local');
});

test('backup: importAll aceita v2 e o db bruto da v1; exportAll v2; saveFile usa downloads.save', async () => {
  const w = world();
  const A = w.device(); const B = w.device();
  await A.store.init(); await B.store.init();
  const v1db = {
    meta: { accounts: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }], rules: [{ id: 'r1', match: { field: 'merchant', op: 'equals', value: 'X' }, categoryId: 'lazer' }] },
    months: { '2026-07': { transactions: [tx('v1a', '2026-07-03', -10)] }, '2026-07~1': { transactions: [tx('v1b', '2026-07-04', -20)] } },
  };
  const st = await A.store.importAll(v1db);
  assert.equal(st.format, 'v1-db'); assert.equal(st.transactions, 2);
  await w.settle();
  let all = await B.store.loadAll();
  assert.deepEqual(ids(all.months['2026-07']), ['v1a', 'v1b']);
  assert.deepEqual(all.meta.accounts, { items: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }] });
  assert.equal(all.meta.rules.rules[0].id, 'r1');
  const exp = await A.store.exportAll();
  assert.equal(exp.version, 2); assert.equal(exp.app, 'financas-flow'); assert.ok(exp.exportedAt);
  // v2 backup substitui: julho some (vira tombstones), setembro entra
  const st2 = await A.store.importAll({ version: 2, meta: { settings: { budgets: {} } }, months: { '2026-09': [tx('n1', '2026-09-09', -9)] } });
  assert.equal(st2.format, 'v2');
  await w.settle();
  all = await B.store.loadAll();
  assert.deepEqual(Object.keys(all.months), ['2026-09']);
  const r = await A.store.saveFile('financas-flow-backup.json', JSON.stringify(exp));
  assert.deepEqual(r, { status: 'saved' });
  assert.equal(A.fake.saved[0].filename, 'financas-flow-backup.json');
  assert.equal(JSON.parse(A.fake.saved[0].data).version, 2);
  // sem downloads: resolve false (o app usa o <a download>)
  const C = w.device({ caps: { downloads: false } }); await C.store.init();
  assert.equal(await C.store.saveFile('x.json', '{}'), false);
});

test('createStore detecta o runtime: window.claude.use → artifact; sem ele segue local/netlify; SW não registra', async () => {
  globalThis.FinStoreArtifact = require('../site/store-artifact.js');
  try {
    const w = world();
    const fake = createFakeClaude({ backend: w.backend, userId: UID, delayMs: 5 });
    const s = storeLib.createStore({ window: { claude: fake.claude }, storage: fakeLocalStorage() });
    assert.equal((await s.init()).mode, 'artifact');
    assert.equal(typeof s.saveFile, 'function');
    const l = storeLib.createStore({ window: {}, fetch: null, storage: fakeLocalStorage() });
    assert.equal((await l.init()).mode, 'local');
    assert.equal(storeLib.hasArtifactRuntime({ claude: fake.claude }), true);
    assert.equal(storeLib.hasArtifactRuntime({}), false);
  } finally { delete globalThis.FinStoreArtifact; }
});

test('covers (unidade): desempate igual ao mergeRows; tombstone vence empate', () => {
  const r = [{ id: 'a', updatedAt: '2026-01-02T00:00:00Z' }, { id: 'b', deleted: true, updatedAt: '2026-01-01T00:00:00Z' }];
  assert.equal(covers(r, [{ id: 'a', updatedAt: '2026-01-01T00:00:00Z' }]), true);
  assert.equal(covers(r, [{ id: 'a', updatedAt: '2026-01-03T00:00:00Z' }]), false);
  assert.equal(covers(r, [{ id: 'b', updatedAt: '2026-01-01T00:00:00Z' }]), true);
  assert.equal(covers(r, [{ id: 'c', updatedAt: '2026-01-01T00:00:00Z' }]), false);
  assert.equal(covers([{ id: 'b', updatedAt: '2026-01-01T00:00:00Z' }], [{ id: 'b', deleted: true, updatedAt: '2026-01-01T00:00:00Z' }]), false);
});
