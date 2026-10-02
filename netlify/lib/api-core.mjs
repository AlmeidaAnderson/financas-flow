// Núcleo da API de dados do Finanças Flow.
// Não depende de @netlify/* diretamente: recebe `getUser` e `getStore` por injeção,
// assim os testes chamam o mesmo código com um contexto simulado (sem nenhum
// "bypass" de autenticação no código publicado — ver netlify/functions/api.mjs).
//
// Segurança:
//  - Sem usuário verificado → 401. As chaves dos blobs derivam SÓ do id verificado.
//  - name/ym validados por allowlist/regex; corpo JSON ≤ 1 MB.
//  - Nunca registra conteúdo de lançamentos em log.

export const META_NAMES = ['settings', 'categories', 'rules', 'profiles', 'accounts', 'imports'];
export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])(~\d+)?$/;
export const MAX_BODY = 1024 * 1024; // 1 MB
export const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TX_ID_MAX = 200;
const MAX_CHANGES = 200;
const MAX_RETRIES = 10;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
// consulta de CNPJ (BrasilAPI) — só quando o usuário toca em "Consultar CNPJ"
export const CNPJ_RATE_PER_HOUR = 30;
export const CNPJ_CACHE_MS = 30 * 24 * 3600 * 1000;
export const CNPJ_TIMEOUT_MS = 5000;
const CNPJ_FIELDS = ['razao_social', 'nome_fantasia', 'cnae_fiscal', 'cnae_fiscal_descricao', 'municipio', 'uf'];

/** 14 dígitos com dígitos verificadores válidos */
export function validCnpj(d) {
  if (typeof d !== 'string' || !/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * w[i];
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
function pickCnpj(j) {
  const out = {};
  for (const k of CNPJ_FIELDS) {
    const v = j ? j[k] : null;
    out[k] = v == null ? null : (k === 'cnae_fiscal' ? (Number.isFinite(Number(v)) ? Number(v) : null) : String(v).slice(0, 200));
  }
  return out;
}

class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; }
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function json(status, body, extraHeaders) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: Object.assign({}, BASE_HEADERS, extraHeaders || {}),
  });
}

const ts = (row) => {
  const t = row && typeof row.updatedAt === 'string' ? Date.parse(row.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Mescla linhas de um mês por `id`: vence o `updatedAt` mais novo; em empate,
 * a exclusão (tombstone) vence. Linhas ausentes do lado "incoming" são mantidas
 * (exclusões precisam vir como tombstone). Tombstones com mais de 90 dias são removidos.
 */
export function mergeTransactions(current, incoming, nowMs) {
  const map = new Map();
  for (const r of current || []) if (r && typeof r.id === 'string') map.set(r.id, r);
  for (const r of incoming || []) {
    const ex = map.get(r.id);
    if (!ex) { map.set(r.id, r); continue; }
    const a = ts(r), b = ts(ex);
    if (a > b || (a === b && r.deleted && !ex.deleted) || (a === b && !!r.deleted === !!ex.deleted)) map.set(r.id, r);
  }
  const out = [];
  for (const r of map.values()) {
    if (r.deleted && nowMs - ts(r) > TOMBSTONE_TTL_MS) continue;
    out.push(r);
  }
  return out;
}

function validateTransactions(list, nowMs) {
  if (!Array.isArray(list)) throw new HttpError(400, 'transactions_must_be_array');
  const seen = new Set();
  return list.map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new HttpError(400, 'invalid_transaction');
    if (typeof r.id !== 'string' || !r.id || r.id.length > TX_ID_MAX) throw new HttpError(400, 'invalid_transaction_id');
    if (seen.has(r.id)) throw new HttpError(400, 'duplicate_transaction_id');
    seen.add(r.id);
    if (r.updatedAt !== undefined && typeof r.updatedAt !== 'string') throw new HttpError(400, 'invalid_updatedAt');
    // relógio de aparelho adiantado não pode "vencer para sempre"
    const updatedAt = ts(r) > nowMs + FUTURE_SKEW_MS || !r.updatedAt ? new Date(nowMs).toISOString() : r.updatedAt;
    if (r.deleted) return { id: r.id, deleted: true, updatedAt };
    return updatedAt === r.updatedAt ? r : Object.assign({}, r, { updatedAt });
  });
}

async function readBody(req) {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'json_only');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > MAX_BODY) throw new HttpError(413, 'too_large');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf)); }
  catch { throw new HttpError(400, 'invalid_json'); }
}

function routeOf(req) {
  const url = new URL(req.url);
  const i = url.pathname.indexOf('/api/');
  const rest = i >= 0 ? url.pathname.slice(i + 5) : '';
  const parts = rest.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return '\u0000'; } });
  return { parts, url };
}

/** Pequeno pool para ler blobs em paralelo sem estourar conexões. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

export function createHandler({ getUser, getStore, now = () => Date.now(), log = console, fetch: fetchFn = globalThis.fetch }) {
  if (typeof getUser !== 'function' || typeof getStore !== 'function') throw new Error('createHandler: deps missing');

  return async function handler(req, context) {
    try {
      // 1) autenticação: usuário verificado pelo Netlify Identity, senão 401
      let user = null;
      try { user = await getUser(req, context); } catch { user = null; }
      const uid = user && typeof user.id === 'string' && USER_ID_RE.test(user.id) ? user.id : null;
      if (!uid) return json(401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });

      // 2) defesa CSRF: exige cabeçalho próprio (força preflight entre origens, que falha: não há CORS)
      //    e, se houver Origin, que seja a mesma origem.
      if (req.headers.get('x-finflow') !== '1') return json(403, { error: 'missing_client_header' });
      const origin = req.headers.get('origin');
      if (origin && origin !== new URL(req.url).origin) return json(403, { error: 'cross_origin' });

      const store = getStore();
      const prefix = `u/${uid}/`;
      const indexKey = `${prefix}index`;
      const nowMs = now();
      const { parts, url } = routeOf(req);
      const method = req.method.toUpperCase();
      const [head, arg, extra] = parts;
      if (extra !== undefined) return json(404, { error: 'not_found' });

      // ---- helpers que dependem do usuário
      const readIndex = async () => {
        const r = await store.getWithMetadata(indexKey, { type: 'json', consistency: 'strong' });
        if (!r) return { data: { v: 2, seq: 0, docs: {} }, etag: null, exists: false };
        const d = r.data && typeof r.data === 'object' ? r.data : {};
        return { data: { v: 2, seq: Number(d.seq) || 0, docs: d.docs && typeof d.docs === 'object' ? d.docs : {} }, etag: r.etag, exists: true };
      };
      const bumpIndex = async (rel, entry) => {
        for (let i = 0; i < MAX_RETRIES; i++) {
          const { data, etag, exists } = await readIndex();
          data.seq += 1;
          data.docs[rel] = Object.assign({ seq: data.seq }, entry);
          const res = await store.setJSON(indexKey, data, etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true });
          if (res && res.modified !== false) return data.seq;
        }
        throw new HttpError(503, 'busy_retry');
      };
      const casUpdate = async (key, mutate) => {
        for (let i = 0; i < MAX_RETRIES; i++) {
          const cur = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
          const next = mutate(cur ? cur.data : null, cur ? cur.etag : null);
          if (next && next.abort) return next;
          // Sem etag não há escrita condicional segura (ex.: sandbox local antigo): grava direto.
          const cond = cur ? (cur.etag ? { onlyIfMatch: cur.etag } : {}) : { onlyIfNew: true };
          const res = await store.setJSON(key, next.doc, cond);
          if (res && res.modified !== false) return { doc: next.doc, etag: res.etag || null };
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * (i + 1)));
        }
        throw new HttpError(503, 'busy_retry');
      };
      const relOf = (key) => key.slice(prefix.length);
      const docPayload = (rel, blob) => {
        const d = blob.data || {};
        if (rel.startsWith('meta/')) return { kind: 'meta', key: rel.slice(5), data: d.data === undefined ? null : d.data, etag: blob.etag, updatedAt: d.updatedAt || null };
        return { kind: 'month', key: rel.slice(7), transactions: Array.isArray(d.transactions) ? d.transactions : [], etag: blob.etag, updatedAt: d.updatedAt || null };
      };
      const listDocs = async () => {
        const { blobs } = await store.list({ prefix });
        return blobs.map((b) => b.key).filter((k) => k !== indexKey && (k.startsWith(prefix + 'meta/') || k.startsWith(prefix + 'months/')));
      };

      // ---- rotas
      if (head === 'all' && arg === undefined) {
        if (method !== 'GET') return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
        const idx = await readIndex();
        const keys = await listDocs();
        const docs = await mapLimit(keys, 8, async (k) => {
          const b = await store.getWithMetadata(k, { type: 'json', consistency: 'strong' });
          return b ? docPayload(relOf(k), b) : null;
        });
        const out = { seq: idx.data.seq, meta: {}, months: {} };
        for (const d of docs) {
          if (!d) continue;
          const e = idx.data.docs[(d.kind === 'meta' ? 'meta/' : 'months/') + d.key];
          const seq = e && Number(e.seq) ? Number(e.seq) : 0;
          if (d.kind === 'meta') out.meta[d.key] = { data: d.data, etag: d.etag, updatedAt: d.updatedAt, seq };
          else out.months[d.key] = { transactions: d.transactions, etag: d.etag, updatedAt: d.updatedAt, seq };
        }
        return json(200, out);
      }

      if (head === 'changes' && arg === undefined) {
        if (method !== 'GET') return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
        const sinceRaw = url.searchParams.get('since');
        if (sinceRaw === null || !/^\d{1,15}$/.test(sinceRaw)) return json(400, { error: 'invalid_since' });
        const since = Number(sinceRaw);
        const idx = await readIndex();
        const seq = idx.data.seq;
        if (since > seq) return json(200, { seq, reset: true, changes: [] });
        if (since === seq) return json(200, { seq, changes: [] });
        const entries = Object.entries(idx.data.docs).filter(([, e]) => e && e.seq > since).sort((a, b) => a[1].seq - b[1].seq);
        if (entries.length > MAX_CHANGES) return json(200, { seq, reset: true, changes: [] });
        const changes = await mapLimit(entries, 8, async ([rel, e]) => {
          const isMeta = rel.startsWith('meta/');
          const key = isMeta ? rel.slice(5) : rel.slice(7);
          const b = await store.getWithMetadata(prefix + rel, { type: 'json', consistency: 'strong' });
          if (!b) return { kind: isMeta ? 'meta' : 'month', key, deleted: true, seq: e.seq, etag: null, updatedAt: e.updatedAt || null };
          return Object.assign(docPayload(rel, b), { seq: e.seq, deleted: !!e.deleted });
        });
        return json(200, { seq, changes });
      }

      if (head === 'export' && arg === undefined) {
        if (method !== 'GET') return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
        const keys = await listDocs();
        const out = { app: 'financas-flow', version: 2, exportedAt: new Date(nowMs).toISOString(), meta: {}, months: {} };
        const docs = await mapLimit(keys, 8, async (k) => {
          const b = await store.getWithMetadata(k, { type: 'json', consistency: 'strong' });
          return b ? docPayload(relOf(k), b) : null;
        });
        for (const d of docs) {
          if (!d) continue;
          if (d.kind === 'meta') out.meta[d.key] = d.data;
          else {
            const ym = d.key.split('~')[0];
            const live = d.transactions.filter((t) => t && !t.deleted);
            if (live.length) out.months[ym] = (out.months[ym] || []).concat(live);
          }
        }
        const day = out.exportedAt.slice(0, 10);
        return json(200, out, { 'content-disposition': `attachment; filename="financas-flow-backup-${day}.json"` });
      }

      if (head === 'cnpj') {
        if (method !== 'GET') return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
        if (typeof arg !== 'string' || !validCnpj(arg)) return json(400, { error: 'invalid_cnpj' });
        // cache por CNPJ (dado público da Receita; chave = só os 14 dígitos validados), 30 dias
        const cacheKey = `cache/cnpj/${arg}`;
        const cached = await store.getWithMetadata(cacheKey, { type: 'json', consistency: 'strong' });
        if (cached && cached.data && nowMs - Number(cached.data.at || 0) < CNPJ_CACHE_MS && cached.data.result) {
          return json(200, Object.assign({ cnpj: arg, cached: true }, pickCnpj(cached.data.result)));
        }
        // limite por usuário: 30 consultas por hora (contador em blob, chave derivada só do id verificado)
        const hour = Math.floor(nowMs / 3600000);
        const rl = await casUpdate(`${prefix}ratelimit/cnpj`, (cur) => {
          const n = cur && cur.hour === hour ? Number(cur.n) || 0 : 0;
          if (n >= CNPJ_RATE_PER_HOUR) return { abort: true };
          return { doc: { hour, n: n + 1 } };
        });
        if (rl.abort) return json(429, { error: 'rate_limited', retryAfter: (hour + 1) * 3600 - Math.floor(nowMs / 1000) }, { 'retry-after': String((hour + 1) * 3600 - Math.floor(nowMs / 1000)) });
        if (typeof fetchFn !== 'function') return json(502, { error: 'upstream_unavailable' });
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), CNPJ_TIMEOUT_MS);
        let up, body;
        try {
          up = await fetchFn(`https://brasilapi.com.br/api/cnpj/v1/${arg}`, { headers: { accept: 'application/json' }, signal: ctl.signal });
          if (up.status === 404) return json(404, { error: 'cnpj_not_found' });
          if (!up.ok) return json(502, { error: 'upstream_unavailable' });
          body = await up.json();
        } catch {
          return ctl.signal.aborted ? json(504, { error: 'upstream_timeout' }) : json(502, { error: 'upstream_unavailable' });
        } finally { clearTimeout(timer); }
        const result = pickCnpj(body);
        try { await store.setJSON(cacheKey, { at: nowMs, result }); } catch { /* cache é opcional */ }
        return json(200, Object.assign({ cnpj: arg, cached: false }, result));
      }

      if (head === 'meta') {
        if (!META_NAMES.includes(arg)) return json(400, { error: 'invalid_name' });
        if (method !== 'PUT') return json(405, { error: 'method_not_allowed' }, { allow: 'PUT' });
        const body = await readBody(req);
        if (body === null || typeof body !== 'object') return json(400, { error: 'meta_must_be_object_or_array' });
        const ifMatch = req.headers.get('if-match');
        const rel = `meta/${arg}`;
        const updatedAt = new Date(nowMs).toISOString();
        const r = await casUpdate(prefix + rel, (cur, etag) => {
          if (ifMatch && ifMatch !== '*' && ifMatch !== etag) return { abort: true, cur, etag };
          if (ifMatch === '*' && cur) return { abort: true, cur, etag };
          return { doc: { v: 2, kind: 'meta', name: arg, data: body, updatedAt } };
        });
        if (r.abort) {
          return json(412, { error: 'precondition_failed', current: r.cur ? { data: r.cur.data, etag: r.etag, updatedAt: r.cur.updatedAt || null } : null });
        }
        const seq = await bumpIndex(rel, { etag: r.etag, updatedAt });
        return json(200, { key: arg, etag: r.etag, updatedAt, seq });
      }

      if (head === 'month') {
        if (typeof arg !== 'string' || !YM_RE.test(arg)) return json(400, { error: 'invalid_month' });
        const rel = `months/${arg}`;
        const updatedAt = new Date(nowMs).toISOString();
        if (method === 'PUT') {
          const body = await readBody(req);
          const list = Array.isArray(body) ? body : body && typeof body === 'object' ? body.transactions : undefined;
          const incoming = validateTransactions(list, nowMs);
          const r = await casUpdate(prefix + rel, (cur) => {
            const merged = mergeTransactions(cur && Array.isArray(cur.transactions) ? cur.transactions : [], incoming, nowMs);
            return { doc: { v: 2, kind: 'month', ym: arg, transactions: merged, updatedAt } };
          });
          const live = r.doc.transactions.some((t) => !t.deleted);
          const seq = await bumpIndex(rel, { etag: r.etag, updatedAt, deleted: !live });
          return json(200, { key: arg, etag: r.etag, updatedAt, seq, transactions: r.doc.transactions });
        }
        if (method === 'DELETE') {
          // Exclusão = tudo vira tombstone (evita que outro aparelho "ressuscite" o mês com dados antigos).
          const cur0 = await store.getWithMetadata(prefix + rel, { type: 'json', consistency: 'strong' });
          if (!cur0) return json(200, { key: arg, deleted: true, etag: null, seq: (await readIndex()).data.seq });
          const r = await casUpdate(prefix + rel, (cur) => {
            const rows = cur && Array.isArray(cur.transactions) ? cur.transactions : [];
            const tomb = rows.filter((t) => t && typeof t.id === 'string').map((t) => (t.deleted ? t : { id: t.id, deleted: true, updatedAt }));
            return { doc: { v: 2, kind: 'month', ym: arg, transactions: mergeTransactions([], tomb, nowMs), updatedAt } };
          });
          const seq = await bumpIndex(rel, { etag: r.etag, updatedAt, deleted: true });
          return json(200, { key: arg, deleted: true, etag: r.etag, seq, transactions: r.doc.transactions });
        }
        return json(405, { error: 'method_not_allowed' }, { allow: 'PUT, DELETE' });
      }

      return json(404, { error: 'not_found' });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, Object.assign({ error: err.code }, err.extra || {}));
      // sem conteúdo do usuário no log: só o tipo do erro
      try { log.error('api_error', err && err.name ? err.name : 'Error'); } catch { /* ignore */ }
      return json(500, { error: 'internal' });
    }
  };
}
