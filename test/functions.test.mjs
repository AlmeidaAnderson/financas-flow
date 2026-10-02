// Testes da API (netlify/lib/api-core.mjs) com contexto de Identity simulado.
// Armazenamento: um mock em memória que segue a API documentada do @netlify/blobs
// (getWithMetadata devolve etag; setJSON com onlyIfMatch/onlyIfNew devolve {modified}).
// O servidor local do @netlify/blobs (BlobsServer) é usado num teste de compatibilidade,
// mas ele NÃO devolve etag no GET, então não serve para testar escrita condicional.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';
import { getStore } from '@netlify/blobs';
import { createHandler, mergeTransactions } from '../netlify/lib/api-core.mjs';

const ORIGIN = 'https://financas.example';
let server, port, dir;
const token = 'test-token';
let clock = Date.parse('2026-10-01T12:00:00Z');

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blobs-'));
  server = new BlobsServer({ directory: dir, token, port: 0 });
  ({ port } = await server.start());
});
test.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const realStore = () => getStore({
  name: 'finflow', siteID: 'site-test', token,
  edgeURL: `http://localhost:${port}`, uncachedEdgeURL: `http://localhost:${port}`, consistency: 'strong',
});

// mock em memória com escrita condicional + "await" entre leitura e escrita para intercalar requisições
const mem = new Map(); let etagN = 0;
const tick = () => new Promise((r) => setImmediate(r));
const memStore = {
  async getWithMetadata(key, opts = {}) {
    await tick();
    const e = mem.get(key); if (!e) return null;
    return { data: opts.type === 'json' ? JSON.parse(e.body) : e.body, etag: e.etag, metadata: {} };
  },
  async setJSON(key, value, opts = {}) {
    await tick();
    const e = mem.get(key);
    if (opts.onlyIfNew && e) return { modified: false };
    if (opts.onlyIfMatch !== undefined && (!e || e.etag !== opts.onlyIfMatch)) return { modified: false };
    const etag = `"e${++etagN}"`;
    mem.set(key, { body: JSON.stringify(value), etag });
    return { modified: true, etag };
  },
  async list({ prefix = '' } = {}) {
    await tick();
    return { blobs: [...mem.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, etag: e.etag })), directories: [] };
  },
  async delete(key) { await tick(); mem.delete(key); },
};
const mkStore = () => memStore;
// usuários "verificados" vêm do contexto simulado (como faria o Identity)
const handlerFor = (userId) => createHandler({
  getUser: async () => (userId ? { id: userId, email: userId + '@x.com' } : null),
  getStore: mkStore,
  now: () => clock,
  log: { error() {} },
});

function req(method, p, body, headers = {}) {
  const h = Object.assign({ 'x-finflow': '1' }, headers);
  let b;
  if (body !== undefined) { b = typeof body === 'string' ? body : JSON.stringify(body); if (!h['content-type']) h['content-type'] = 'application/json'; }
  return new Request(ORIGIN + p, { method, headers: h, body: b });
}
async function call(user, method, p, body, headers) {
  const res = await handlerFor(user)(req(method, p, body, headers), {});
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const tx = (id, updatedAt, extra = {}) => Object.assign({ id, date: '2026-09-10', amount: -100, updatedAt }, extra);

test('401 sem usuário verificado, em todas as rotas', async () => {
  for (const [m, p] of [['GET', '/api/all'], ['GET', '/api/changes?since=0'], ['GET', '/api/export'], ['PUT', '/api/meta/settings'], ['PUT', '/api/month/2026-09'], ['DELETE', '/api/month/2026-09']]) {
    const r = await call(null, m, p, m === 'PUT' ? {} : undefined);
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  // id de usuário estranho também é rejeitado
  const r = await call('../evil', 'GET', '/api/all');
  assert.equal(r.status, 401);
});

test('exige cabeçalho do cliente e mesma origem (CSRF)', async () => {
  const h = handlerFor('alice');
  let res = await h(new Request(ORIGIN + '/api/all'), {});
  assert.equal(res.status, 403);
  res = await h(req('PUT', '/api/meta/settings', {}, { origin: 'https://evil.example' }), {});
  assert.equal(res.status, 403);
  res = await h(req('GET', '/api/all', undefined, { origin: ORIGIN }), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('validação: nome, mês, JSON, tamanho, content-type', async () => {
  assert.equal((await call('alice', 'PUT', '/api/meta/secrets', {})).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/meta/..%2Fsettings', {})).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-13', [])).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-1', [])).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-09~x', [])).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-09', '{bad json')).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-09', 'x', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-09', [{ amount: 1 }])).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-09', [tx('a', 'x'), tx('a', 'x')])).status, 400);
  assert.equal((await call('alice', 'PUT', '/api/meta/settings', 'null')).status, 400);
  const big = JSON.stringify({ blob: 'x'.repeat(1024 * 1024 + 10) });
  assert.equal((await call('alice', 'PUT', '/api/meta/settings', big)).status, 413);
  assert.equal((await call('alice', 'GET', '/api/changes?since=-1')).status, 400);
  assert.equal((await call('alice', 'GET', '/api/nope')).status, 404);
  assert.equal((await call('alice', 'GET', '/api/month/2026-09/extra')).status, 404);
  assert.equal((await call('alice', 'PUT', '/api/month/2026-09~1', [tx('p1', '2026-09-01T00:00:00Z')])).status, 200);
});

test('isolamento: dados de um usuário nunca aparecem para outro', async () => {
  await call('u1', 'PUT', '/api/meta/accounts', { items: [{ id: 'nubank', name: 'Nubank' }] });
  await call('u1', 'PUT', '/api/month/2026-08', [tx('t1', '2026-09-01T00:00:00Z')]);
  const a = await call('u1', 'GET', '/api/all');
  assert.deepEqual(a.body.meta.accounts.data, { items: [{ id: 'nubank', name: 'Nubank' }] });
  assert.equal(a.body.months['2026-08'].transactions.length, 1);
  const b = await call('u2', 'GET', '/api/all');
  assert.deepEqual(b.body, { seq: 0, meta: {}, months: {} });
  const bx = await call('u2', 'GET', '/api/export');
  assert.deepEqual(bx.body.months, {});
  assert.deepEqual(bx.body.meta, {});
  // u2 escrevendo o "mesmo" mês não mexe no de u1
  await call('u2', 'PUT', '/api/month/2026-08', [tx('t9', '2026-09-01T00:00:00Z')]);
  const a2 = await call('u1', 'GET', '/api/all');
  assert.deepEqual(a2.body.months['2026-08'].transactions.map((t) => t.id), ['t1']);
  // chaves no armazenamento: sempre u/<id>/...
  const { blobs } = await mkStore().list();
  assert.ok(blobs.length > 0);
  assert.ok(blobs.every((b) => /^u\/(u1|u2|alice)\/(index|meta\/[a-z]+|months\/\d{4}-\d{2}(~\d+)?)$/.test(b.key)), blobs.map((b) => b.key).join(','));
});

test('mês: dois aparelhos escrevendo ao mesmo tempo não perdem linhas', async () => {
  const u = 'merge-user';
  // aparelho A e B partem do mesmo estado e cada um adiciona uma linha
  await call(u, 'PUT', '/api/month/2026-09', [tx('base', '2026-09-01T00:00:00Z')]);
  const [ra, rb] = await Promise.all([
    call(u, 'PUT', '/api/month/2026-09', [tx('base', '2026-09-01T00:00:00Z'), tx('fromA', '2026-09-02T00:00:00Z')]),
    call(u, 'PUT', '/api/month/2026-09', [tx('base', '2026-09-01T00:00:00Z'), tx('fromB', '2026-09-02T00:00:00Z')]),
  ]);
  assert.equal(ra.status, 200); assert.equal(rb.status, 200);
  const all = await call(u, 'GET', '/api/all');
  assert.deepEqual(all.body.months['2026-09'].transactions.map((t) => t.id).sort(), ['base', 'fromA', 'fromB']);
  // edição mais nova vence; edição velha não sobrescreve
  await call(u, 'PUT', '/api/month/2026-09', [tx('base', '2026-09-05T00:00:00Z', { note: 'novo' })]);
  await call(u, 'PUT', '/api/month/2026-09', [tx('base', '2026-09-03T00:00:00Z', { note: 'velho' })]);
  const all2 = await call(u, 'GET', '/api/all');
  assert.equal(all2.body.months['2026-09'].transactions.find((t) => t.id === 'base').note, 'novo');
  // relógio adiantado é limitado ao "agora" do servidor
  await call(u, 'PUT', '/api/month/2026-09', [tx('future', '2099-01-01T00:00:00Z')]);
  const fut = (await call(u, 'GET', '/api/all')).body.months['2026-09'].transactions.find((t) => t.id === 'future');
  assert.equal(fut.updatedAt, new Date(clock).toISOString());
});

test('tombstones: exclusão propaga, não ressuscita, e expira após 90 dias', async () => {
  const u = 'tomb-user';
  await call(u, 'PUT', '/api/month/2026-07', [tx('x', '2026-09-01T00:00:00Z'), tx('y', '2026-09-01T00:00:00Z')]);
  await call(u, 'PUT', '/api/month/2026-07', [{ id: 'x', deleted: true, updatedAt: '2026-09-02T00:00:00Z', amount: 999 }]);
  let rows = (await call(u, 'GET', '/api/all')).body.months['2026-07'].transactions;
  assert.deepEqual(rows.find((t) => t.id === 'x'), { id: 'x', deleted: true, updatedAt: '2026-09-02T00:00:00Z' });
  // aparelho atrasado reenviando a versão antiga não ressuscita
  await call(u, 'PUT', '/api/month/2026-07', [tx('x', '2026-09-01T00:00:00Z'), tx('y', '2026-09-01T00:00:00Z')]);
  rows = (await call(u, 'GET', '/api/all')).body.months['2026-07'].transactions;
  assert.equal(rows.find((t) => t.id === 'x').deleted, true);
  // DELETE do mês inteiro → tudo vira tombstone; export não mostra
  const del = await call(u, 'DELETE', '/api/month/2026-07');
  assert.equal(del.status, 200);
  rows = (await call(u, 'GET', '/api/all')).body.months['2026-07'].transactions;
  assert.ok(rows.every((t) => t.deleted));
  assert.equal((await call(u, 'GET', '/api/export')).body.months['2026-07'], undefined);
  // depois de 90 dias os tombstones somem na próxima escrita
  const merged = mergeTransactions(rows, [], clock + 91 * 24 * 3600 * 1000);
  assert.equal(merged.length, 0);
  // DELETE de mês inexistente é ok
  assert.equal((await call(u, 'DELETE', '/api/month/2020-01')).status, 200);
});

test('tombstone com relógio adiantado: data limitada ao "agora" do servidor e conteúdo descartado', async () => {
  const u = 'skew-user';
  const r = await call(u, 'PUT', '/api/month/2026-08', [{ id: 'z', deleted: true, updatedAt: '2099-01-01T00:00:00Z', amount: -5, merchant: 'segredo' }]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.transactions, [{ id: 'z', deleted: true, updatedAt: new Date(clock).toISOString() }]);
});

test('changes?since devolve só o que mudou, com contador por usuário', async () => {
  const u = 'chg-user';
  const s0 = (await call(u, 'GET', '/api/changes?since=0')).body;
  assert.deepEqual(s0, { seq: 0, changes: [] });
  const w1 = await call(u, 'PUT', '/api/meta/categories', { items: [{ id: 'a' }] });
  const w2 = await call(u, 'PUT', '/api/month/2026-05', [tx('m1', '2026-09-01T00:00:00Z')]);
  assert.equal(w1.body.seq, 1); assert.equal(w2.body.seq, 2);
  let c = (await call(u, 'GET', '/api/changes?since=1')).body;
  assert.equal(c.seq, 2);
  assert.equal(c.changes.length, 1);
  assert.equal(c.changes[0].kind, 'month');
  assert.equal(c.changes[0].key, '2026-05');
  assert.equal(c.changes[0].etag, w2.body.etag);
  c = (await call(u, 'GET', '/api/changes?since=0')).body;
  assert.deepEqual(c.changes.map((x) => x.kind + ':' + x.key), ['meta:categories', 'month:2026-05']);
  assert.deepEqual(c.changes[0].data, { items: [{ id: 'a' }] });
  c = (await call(u, 'GET', '/api/changes?since=2')).body;
  assert.deepEqual(c.changes, []);
  c = (await call(u, 'GET', '/api/changes?since=99')).body;
  assert.equal(c.reset, true);
  await call(u, 'DELETE', '/api/month/2026-05');
  c = (await call(u, 'GET', '/api/changes?since=2')).body;
  assert.equal(c.changes[0].deleted, true);
  // o contador de outro usuário é independente
  assert.equal((await call('chg-other', 'GET', '/api/changes?since=0')).body.seq, 0);
});

test('meta: If-Match devolve 412 com o documento atual quando outro aparelho salvou antes', async () => {
  const u = 'meta-user';
  const a = await call(u, 'PUT', '/api/meta/rules', { rules: [], history: [] });
  const b = await call(u, 'PUT', '/api/meta/rules', { rules: [{ id: 'r1' }], history: [] }, { 'if-match': a.body.etag });
  assert.equal(b.status, 200);
  const stale = await call(u, 'PUT', '/api/meta/rules', { rules: [{ id: 'r2' }], history: [] }, { 'if-match': a.body.etag });
  assert.equal(stale.status, 412);
  assert.deepEqual(stale.body.current.data, { rules: [{ id: 'r1' }], history: [] });
  assert.equal(stale.body.current.etag, b.body.etag);
  // sem If-Match = última escrita vence
  assert.equal((await call(u, 'PUT', '/api/meta/rules', { rules: [], history: [] })).status, 200);
  // If-Match: * = só cria se não existir
  assert.equal((await call(u, 'PUT', '/api/meta/profiles', { items: [] }, { 'if-match': '*' })).status, 200);
  assert.equal((await call(u, 'PUT', '/api/meta/profiles', { items: [] }, { 'if-match': '*' })).status, 412);
});

test('export: formato v2 com meses juntando partes e sem tombstones', async () => {
  const u = 'exp-user';
  await call(u, 'PUT', '/api/meta/settings', { budgets: { a: 1 } });
  await call(u, 'PUT', '/api/month/2026-04', [tx('e1', '2026-09-01T00:00:00Z'), { id: 'e2', deleted: true, updatedAt: '2026-09-01T00:00:00Z' }]);
  await call(u, 'PUT', '/api/month/2026-04~1', [tx('e3', '2026-09-01T00:00:00Z')]);
  const r = await call(u, 'GET', '/api/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="financas-flow-backup-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(r.body.version, 2);
  assert.deepEqual(r.body.meta.settings, { budgets: { a: 1 } });
  assert.deepEqual(r.body.months['2026-04'].map((t) => t.id).sort(), ['e1', 'e3']);
});

test('erros internos não vazam conteúdo e viram 500', async () => {
  const logged = [];
  const h = createHandler({
    getUser: async () => ({ id: 'boom' }),
    getStore: () => ({ getWithMetadata: async () => { throw new Error('segredo do usuário'); } }),
    log: { error: (...a) => logged.push(a.join(' ')) },
  });
  const res = await h(req('GET', '/api/all'), {});
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal' });
  assert.ok(!logged.join(' ').includes('segredo'));
});

test('compatibilidade com o @netlify/blobs real (servidor local): grava, lista e lê', async () => {
  const h = createHandler({ getUser: async () => ({ id: 'compat' }), getStore: realStore, log: { error() {} } });
  let res = await h(req('PUT', '/api/month/2026-09', [tx('c1', '2026-09-01T00:00:00Z')]), {});
  assert.equal(res.status, 200);
  res = await h(req('PUT', '/api/meta/settings', { budgets: {} }), {});
  assert.equal(res.status, 200);
  res = await h(req('GET', '/api/all'), {});
  const all = await res.json();
  assert.deepEqual(all.months['2026-09'].transactions.map((t) => t.id), ['c1']);
  assert.deepEqual(all.meta.settings.data, { budgets: {} });
  assert.equal(all.seq, 2);
});

test('verifiedUser: exige claims do runtime iguais ao usuário do getUser()', async () => {
  const { makeVerifiedUser } = await import('../netlify/lib/verified-user.mjs');
  const u = { id: 'abc', email: 'a@x.com' };
  // sem contexto de Identity (ex.: netlify dev): vale o getUser()
  assert.deepEqual(await makeVerifiedUser(async () => u, () => null)(), { id: 'abc', email: 'a@x.com' });
  // contexto com claims do mesmo usuário: ok
  assert.deepEqual(await makeVerifiedUser(async () => u, () => ({ url: 'x', token: 'op', user: { sub: 'abc' } }))(), { id: 'abc', email: 'a@x.com' });
  // contexto sem claims (requisição sem Bearer): recusa, mesmo que getUser devolva alguém
  assert.equal(await makeVerifiedUser(async () => u, () => ({ url: 'x', token: 'op' }))(), null);
  // claims de outro usuário: recusa
  assert.equal(await makeVerifiedUser(async () => u, () => ({ token: 'op', user: { sub: 'zzz' } }))(), null);
  // contexto sem token de operador: getUser() validou o cookie no próprio Identity → aceita
  assert.deepEqual(await makeVerifiedUser(async () => u, () => ({ url: 'x' }))(), { id: 'abc', email: 'a@x.com' });
  // getUser falhando/sem usuário: recusa
  assert.equal(await makeVerifiedUser(async () => { throw new Error('x'); }, () => null)(), null);
  assert.equal(await makeVerifiedUser(async () => null, () => ({ token: 'op', user: { sub: 'abc' } }))(), null);
});

// ---------------------------------------------------------------- v2.1: GET /api/cnpj/:digits
test('cnpj: autenticação, validação, campos filtrados, cache de 30 dias, limite por usuário, timeout', async () => {
  const CNPJ = '11222333000181';
  const calls = [];
  let mode = 'ok';
  const fakeFetch = async (url, opts) => {
    calls.push(url);
    if (mode === 'hang') return new Promise((_, rej) => { opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    if (mode === '404') return new Response('{"message":"CNPJ não encontrado"}', { status: 404 });
    return new Response(JSON.stringify({ cnpj: CNPJ, razao_social: 'PADARIA EXEMPLO LTDA', nome_fantasia: 'PADARIA EX', cnae_fiscal: 1091102,
      cnae_fiscal_descricao: 'Fabricação de produtos de padaria', municipio: 'SAO PAULO', uf: 'SP', qsa: [{ nome_socio: 'FULANO' }], email: 'x@y.z', ddd_telefone_1: '11999999999' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let t = Date.parse('2026-10-02T10:00:00Z');
  const h = (uid) => createHandler({ getUser: async () => (uid ? { id: uid, email: '' } : null), getStore: mkStore, now: () => t, log: { error() {} }, fetch: fakeFetch });
  const get = async (uid, p, headers) => { const r = await h(uid)(req('GET', p, undefined, headers), {}); const x = await r.text(); return { status: r.status, body: x ? JSON.parse(x) : null, headers: r.headers }; };

  assert.equal((await get(null, '/api/cnpj/' + CNPJ)).status, 401);
  assert.equal((await get('cnpjA', '/api/cnpj/' + CNPJ, { 'x-finflow': '' })).status, 403);
  assert.equal((await get('cnpjA', '/api/cnpj/11222333000180')).status, 400, 'dígito verificador errado');
  assert.equal((await get('cnpjA', '/api/cnpj/1122233300018')).status, 400, '13 dígitos');
  assert.equal((await get('cnpjA', '/api/cnpj/11111111111111')).status, 400, 'repetidos');
  assert.equal((await get('cnpjA', '/api/cnpj/..%2F..%2Fx')).status, 400);
  assert.equal(calls.length, 0, 'nada vai para fora sem CNPJ válido');
  const r = await get('cnpjA', '/api/cnpj/' + CNPJ);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['cached', 'cnae_fiscal', 'cnae_fiscal_descricao', 'cnpj', 'municipio', 'nome_fantasia', 'razao_social', 'uf']);
  assert.equal(r.body.cnae_fiscal, 1091102);
  assert.ok(!JSON.stringify(r.body).includes('FULANO') && !JSON.stringify(r.body).includes('x@y.z'), 'sem sócios/contatos');
  assert.equal(calls[0], 'https://brasilapi.com.br/api/cnpj/v1/' + CNPJ);
  // cache: second call (any user) does not hit upstream
  const r2 = await get('cnpjB', '/api/cnpj/' + CNPJ);
  assert.equal(r2.status, 200); assert.equal(r2.body.cached, true); assert.equal(calls.length, 1);
  t += 31 * 24 * 3600 * 1000; // cache expired
  assert.equal((await get('cnpjB', '/api/cnpj/' + CNPJ)).body.cached, false); assert.equal(calls.length, 2);
  // rate limit: 30 per hour per user (only uncached lookups count)
  const mkCnpj = (base12) => { const d = String(base12).padStart(12, '0'); const dv = (s, w) => { const r = [...s].reduce((a, c, i) => a + Number(c) * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    const d1 = dv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); const d2 = dv(d + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return d + d1 + d2; };
  t = Date.parse('2026-12-01T10:00:00Z');
  const n0 = calls.length;
  let last;
  for (let i = 0; i < 30; i++) { last = await get('cnpjC', '/api/cnpj/' + mkCnpj(123456780000 + i)); assert.equal(last.status, 200, 'lookup ' + i); }
  assert.equal(calls.length - n0, 30);
  assert.equal((await get('cnpjC', '/api/cnpj/' + mkCnpj(123456780000))).status, 200, 'cached lookups do not count');
  last = await get('cnpjC', '/api/cnpj/' + mkCnpj(123456789999));
  assert.equal(last.status, 429);
  assert.equal(calls.length - n0, 30, 'over the limit: nothing sent upstream');
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.equal((await get('cnpjD', '/api/cnpj/' + CNPJ)).status, 200, 'other users are not limited');
  // upstream 404 / timeout
  t += 3600 * 1000 * 24 * 40;
  mode = '404'; assert.equal((await get('cnpjE', '/api/cnpj/' + CNPJ)).status, 404);
  mode = 'hang';
  const t0 = Date.now();
  const rt = await get('cnpjE', '/api/cnpj/' + CNPJ);
  assert.equal(rt.status, 504); assert.ok(Date.now() - t0 < 7000);
  // only GET
  assert.equal((await h('cnpjA')(req('PUT', '/api/cnpj/' + CNPJ, {}), {})).status, 405);
});
