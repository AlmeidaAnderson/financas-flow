# Finanças Flow v2 — independent hosting on Netlify

User decisions (final):
- Host on **Netlify**, deployed from a **GitHub** repo (this folder becomes the repo root).
- Login + data **all on Netlify**: Netlify Identity (invite-only registration) + Netlify Blobs (per-user storage) + Netlify Functions (API).
- **No AI** for now: all AI buttons hidden behind `FEATURES.ai = false`; no API key anywhere.
- **No extra encryption** passphrase; protection = Identity login + server-side per-user isolation.
- Must work on PC and phone, synced; installable PWA on the phone.

## Layout
```
netlify.toml                 build/publish/functions config, security headers (CSP etc.)
package.json                 deps for functions (@netlify/blobs etc.) + dev/test scripts
site/                        publish dir (static, no build step required)
  index.html                 the app (normal full HTML document)
  engine.js                  FinEngine (pure logic, also used by node tests)
  store.js                   Store adapters (see interface below)
  vendor/                    pinned third-party libs vendored locally (d3, SheetJS...) — NO CDNs at runtime
  manifest.webmanifest, sw.js, icons/
netlify/functions/api.mjs    the data API (owned by infra agent)
test/                        node tests (engine + functions), e2e (Playwright)
README.md                    pt-BR step-by-step setup for the user
```

## Store interface (the ONLY way the app touches persistence/auth) — `site/store.js`
```js
window.FinStore = createStore({ mode })   // mode: "netlify" | "local" ; auto: netlify when served from a Netlify site with Identity, else local
store.init()            -> Promise<{ mode, user: { id, email } | null }>
store.login()           -> opens login (Identity); store.logout()
store.onAuth(fn)        -> unsubscribe; fn({ user|null })
store.loadAll()         -> Promise<{ meta: { settings, categories, rules, profiles, accounts, imports }, months: { "YYYY-MM": Transaction[] } }>
                           (missing docs → null/absent; app applies defaults)
store.saveMeta(name, data)   -> Promise<void>   name ∈ settings|categories|rules|profiles|accounts|imports
store.saveMonth(ym, txs)     -> Promise<void>   one doc per month; each tx has updatedAt (ISO) for merge
store.deleteMonth(ym)        -> Promise<void>
store.subscribe(fn)     -> unsubscribe; fn({ kind: "meta"|"month", key, data, deleted? }) for REMOTE changes only
store.status            -> "synced"|"saving"|"offline"|"local"|"error"|"signed_out";  store.onStatus(fn)
store.exportAll()       -> Promise<object>  (backup JSON, same shape as loadAll + {version:2, exportedAt})
store.importAll(obj)    -> Promise<void>    (accepts v2 backup AND the v1 artifact backup/db shape)
```
Semantics: writes are optimistic (UI updates immediately); conflicts resolved by the adapter: months merge by transaction `id`, newest `updatedAt` wins, deletions via tombstones `{id, deleted:true, updatedAt}` kept 90 days; meta docs merge field-wise where sensible (rules/categories by id), else last-write-wins. Offline: keep a local cache (IndexedDB or localStorage, try/catch) so the app opens read-only offline and queues writes, flushing on reconnect.
Sync PC↔phone: poll for changes every 20 s while the tab is visible, and immediately on focus/visibilitychange/online; cheap "changes since" call using a per-user change counter/etags.

The "local" adapter (localStorage) is used for dev, tests and when not signed in is NOT allowed to hold real data silently: the UI shows "Entre para sincronizar" when mode is netlify and the user is signed out.

## Security requirements
- Identity registration = **invite only** (README tells the user to set it and invite their own email). Functions must reject requests without a valid Identity JWT (context.clientContext.user) — 401.
- Blob keys derived ONLY from the verified user id (`sub`), never from request input: `u/<sub>/meta/<name>`, `u/<sub>/months/<ym>`. Validate name/ym against allowlist/regex. Body size limit (e.g. 1 MB).
- No test/auth bypass in deployed code. Tests call the handler directly with a mocked context.
- Headers via netlify.toml: strict CSP (self only; Identity endpoints on same origin `/.netlify/identity`), X-Frame-Options DENY, Referrer-Policy no-referrer, Permissions-Policy minimal, HSTS. No third-party scripts at runtime (vendor libs).
- Never log transaction contents in functions.
