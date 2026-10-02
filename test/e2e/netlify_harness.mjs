// TEST-ONLY harness (never deployed): serves site/ with the exact security headers from netlify.toml
// and runs the REAL API (netlify/lib/api-core.mjs) on /api/* with in-memory Blobs.
// The "verified user" comes from a fake bearer token `test-<id>` — this exists ONLY here, under test/e2e/.
// The production function (netlify/functions/api.mjs) uses @netlify/identity getUser() and has no bypass.
//
// Usage: [FF_FAKE_IDENTITY=1] node test/e2e/netlify_harness.mjs [port]
//   GET /.netlify/identity/settings  → makes site/store.js pick "netlify" mode
//   GET /__test/blobs?uid=x           → raw blob docs of a user (for assertions)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../../netlify/lib/api-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SITE = path.join(ROOT, 'site');
const PORT = Number(process.argv[2] || process.env.PORT || 8777);

/** Minimal parser for the [[headers]] blocks of netlify.toml (for = "...", Key = "value"). */
export function parseHeaders(toml) {
  const rules = []; let cur = null; let inValues = false;
  for (const raw of toml.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[[headers]]') { cur = { for: null, values: {} }; rules.push(cur); inValues = false; continue; }
    if (line.startsWith('[')) { inValues = cur && line === '[headers.values]'; if (!inValues && line !== '[headers.values]') cur = null; continue; }
    const m = /^("?)([A-Za-z0-9-]+)\1\s*=\s*"(.*)"$/.exec(line);
    if (!m || !cur) continue;
    if (!inValues && m[2] === 'for') cur.for = m[3];
    else if (inValues) cur.values[m[2]] = m[3];
  }
  return rules;
}
const RULES = parseHeaders(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8'));
const matches = (pattern, p) => pattern === p || (pattern.endsWith('/*') && p.startsWith(pattern.slice(0, -1)));
function headersFor(p) {
  const h = {};
  for (const r of RULES) if (r.for && matches(r.for, p)) Object.assign(h, r.values);
  delete h['Strict-Transport-Security']; // http://127.0.0.1
  return h;
}

// in-memory Blobs with conditional writes (same semantics as @netlify/blobs)
const mem = new Map(); let etagN = 0;
const blobs = {
  async getWithMetadata(key, o = {}) { const e = mem.get(key); return e ? { data: o.type === 'json' ? JSON.parse(e.body) : e.body, etag: e.etag, metadata: {} } : null; },
  async setJSON(key, v, o = {}) {
    const e = mem.get(key);
    if (o.onlyIfNew && e) return { modified: false };
    if (o.onlyIfMatch !== undefined && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
    const etag = `"h${++etagN}"`; mem.set(key, { body: JSON.stringify(v), etag }); return { modified: true, etag };
  },
  async list({ prefix = '' } = {}) { return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: mem.get(key).etag })), directories: [] }; },
  async delete(k) { mem.delete(k); },
};

const api = createHandler({
  getUser: async (req) => {
    const m = /^Bearer test-([A-Za-z0-9_-]+)$/.exec(req.headers.get('authorization') || '');
    return m ? { id: m[1], email: m[1] + '@exemplo.com' } : null;
  },
  getStore: () => blobs,
  log: { error: (...a) => console.error('[api]', ...a) },
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await api(new Request(url.href, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), {});
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (url.pathname === '/.netlify/identity/settings') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"external":{"google":false},"disable_signup":true}'); return;
    }
    if (url.pathname === '/__test/blobs') {
      const uid = url.searchParams.get('uid') || '';
      const out = {}; for (const [k, e] of mem) if (k.startsWith(`u/${uid}/`)) out[k.slice(uid.length + 3)] = JSON.parse(e.body);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); return;
    }
    // FF_FAKE_IDENTITY=1: serve the test-only fake Identity module (needed when a service worker fetches it,
    // because Playwright routes do not see service-worker requests)
    if (process.env.FF_FAKE_IDENTITY === '1' && url.pathname === '/vendor/netlify-identity.js') {
      res.writeHead(200, Object.assign({ 'content-type': TYPES['.js'] }, headersFor(url.pathname)));
      res.end(fs.readFileSync(path.join(HERE, 'fake_identity.mjs'))); return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(SITE, path.normalize(p));
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, headersFor(url.pathname)); res.end('not found'); return; }
    res.writeHead(200, Object.assign({ 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }, headersFor(url.pathname)));
    res.end(fs.readFileSync(file));
  } catch (e) {
    console.error(e); res.writeHead(500); res.end('err');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`harness on http://127.0.0.1:${PORT}`));
