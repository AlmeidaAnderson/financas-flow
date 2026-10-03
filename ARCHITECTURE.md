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
window.FinStore = createStore({ mode })   // mode: "netlify" | "local" | "artifact" ; auto: artifact when window.claude.use exists (claude.ai Artifact build, site/store-artifact.js), netlify when served from a Netlify site with Identity, else local
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
store.saveFile?(name, text) -> optional (artifact mode): offers a file via the runtime's downloads.save; the app falls back to <a download> when absent or it resolves false
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

## v2.1 additions
- **API route `GET /api/cnpj/:cnpj`** (netlify/lib/api-core.mjs): verified user + `x-finflow` header required; the 14 digits
  are validated (check digits) before anything leaves the server; 30 uncached lookups per user per hour (counter blob
  `u/<sub>/ratelimit/cnpj`, keyed only by the verified id → 429 + Retry-After); server-side fetch of
  `https://brasilapi.com.br/api/cnpj/v1/<cnpj>` with a 5 s timeout (504/502 on failure); returns ONLY
  `{cnpj, cached, razao_social, nome_fantasia, cnae_fiscal, cnae_fiscal_descricao, municipio, uf}`; cached 30 days in the
  blob `cache/cnpj/<14 digits>` (public company data, shared across users). Called only when the user taps "Consultar
  CNPJ" (`store.lookupCnpj(cnpj)`, netlify adapter only). The Artifact build cannot reach other hosts: it links to
  BrasilAPI and offers a "Colar CNAE" field instead (`FinEngine.suggestFromCNAE`).
- **Transactions** may carry `balance` (cents; running balance when the file has a "Saldo" column) and `catSource: "series"`.
- **Rules**: `{origin:"installment", seriesKey, series:{merchant,start,total,amount}, set:{categoryId}, expiresAfter:"YYYY-MM", updatedAt}`
  remembers one installment purchase (classify priority: manual > installment series > user rules > learned > dictionary);
  pruned on load after `expiresAfter`.
- **Imports index** records: `from`, `to`, `duplicates`, `hasBalance`, `kindGuess`, `updatedAt`.
- **settings** (synced meta doc, field-wise merge; every write sets `settings.updatedAt`):
  `carry: {enabled (default true), startMonth|null, excluded:[ym], included:[ym]}` (deficit carry-over; months with a
  blocking data-health warning are excluded unless in `included`), `rememberOff: [categoryId]` ("Lembrar" starts unticked
  for these), `dismissedWarnings: [warningId]`, `ownerNames: [name]` (own-account transfer detection).
- Engine: `CNAE_MAP`, `suggestFromCNAE`, `findCNPJ`, `searchQuery`, `installmentSeries`, `rememberInstallmentSeries`,
  `pruneSeriesRules`, `carryover`, `buildSankey({carry})`, `dataHealth`, `blockingMonths`, `importKind`, `filePeriod`.
- Data-health notes: the running month's partial extrato is `info` with `carryExclude: true` (still out of the carry-over);
  coverage of an import uses the period in its file name when present; overlapping-import "repeats" are only checked between
  imports of the same kind and ignore rows reversed by an estorno; `dedupe` matches exact ids before fuzzy matches.

## v2.2 additions
- **Category** `outros.nao_identificado` ("Não identificado", built-in group "Outros", kind expense): "Não sei o que é" in
  triage/editor. `FinEngine.ensureBuiltinCategories` adds it to any taxonomy (migration + on load; never renames/recolors).
  Counts as spending (Sankey shows the group as "Não identificado"); data health counts it apart (`l:unid:<ym>`, info).
- **settings.ui.categoryChart** (synced, field-wise merge; mirrored in localStorage `ff-catchart` for an instant reload;
  the newer `updatedAt` wins): `{ type: stacked|pct|grouped|lines|heat, gran: week|month|quarter|year, range: 6|12|24|'all',
  level: group|category, groupId|null, hidden: [seriesId], updatedAt }`.
- **Imports index** records may carry `batch: true` (imported from the multi-file list). Profiles get `updatedAt`, and a
  recognized layout's `defaultAccountId` follows the account picked in the batch when it fits the file kind.
- Engine: `periodOf` (ISO weeks Mon–Sun "S38", "set/26", "T3/26", "2026"), `categorySeries`, `categorySeriesKey`,
  `ingest` (link card payments + classify new rows; the app's addTransactions), `batchOrder`, `importBatch` (pure: files
  oldest first, each deduped against stored rows + the files before it = importing one by one in date order).
- Chart colors live in ONE table in app.js (`SHADES`): stored category hex → validated light/dark shade (dataviz
  validate_palette.js; hue kept). Used by the Sankey and the category chart.
