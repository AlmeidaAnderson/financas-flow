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
  a company page (v2.4a: cnpj.biz; before: BrasilAPI) and offers a "Colar CNAE" field instead (`FinEngine.suggestFromCNAE`).
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
- Meta sync (review fix): `merge3` treats a NESTED object carrying `updatedAt` on both sides (a rule, a layout,
  `settings.ui.categoryChart`) as one unit — the newer wins whole; the doc root still merges field-wise. When a remote meta
  change arrives while this device's own write of that doc is still pending, the app 3-way merges it (base = the version it
  last saw/sent, `P.metaBase`) instead of dropping it — two devices changing the chart at once now converge on the newest.
- `ensureBuiltinCategories` adds a group of its own (`outros_gastos`) when the user's "outros" group is income/investment;
  "Não sei o que é" always sets kind `expense`.


## v2.3 additions — update alerts ("Alertas de atualização")
- **Accounts meta doc**, per account (all optional; absent = not configured, old accounts stay untouched; every change
  stamps the account's `updatedAt`, so a concurrent edit on two devices resolves to the newest account as a unit):
  `closingDay` (1–31), `dueDay` (1–31), `dueAlert: false` (turns off the "vence em N dias" reminder), `alerts` (false =
  no alerts for the account), `remind: { freq: weekly|biweekly|monthly|never, day? }` (checking/savings/other),
  `cycleOverrides: { "YYYY-MM": "YYYY-MM-DD" }` (one cycle closed on another date; key = month of the usual closing).
- **settings.dismissedAlerts: [alertId]** (synced) — "Já importei / Ignorar este ciclo". Alert ids are stable per account
  + cycle (`fatura_fechou:<acc>:<YYYY-MM>`, `fatura_vence:<acc>:<YYYY-MM>`, `extrato_desatualizado:<acc>:<reminder date>`,
  `configurar:<acc>`), so a dismissal covers one cycle only.
- Engine: `cardCycles(account, {from, to})` → `[{ym, closeDate, dueDate, start, end, nominalClose, overridden}]`
  (day clamped to the month's last day; start = previous closeDate, end = closeDate − 1; dueDate = first dueDay after the
  nominal closing day; overrides move closeDate, never the due date). `updateAlerts({accounts, imports, transactions,
  today, settings})` → alerts `{id, accountId, kind, severity, title, short, detail, cycle, date, action}`; a fatura
  import covers a cycle when its file-name date (`fileDates`) is the cycle's due date (±3 days), or else when that cycle
  holds ≥ 60% of its purchases (parcelas and payments left out; up to 2 days after a closing still counts for it) and the
  file was imported on/after the closing date (`at`; without it: purchases until ≤ 10 days before the closing) —
  `cycleOfImport`; extratos never count. A "hole" (older closed cycle) is judged by the first non-parcela purchase. A card
  account holding only extratos gets no "configurar" alert (data health already says "Mover importação"). `inferCardDays({accountId, accounts, transactions, imports})`
  ("Sugerir pelos dados": closing day = most frequent first-purchase day / day after the last purchase of each fatura;
  due day = the date in the fatura file names, else the usual day of the fatura payments) — the UI only pre-fills.
- dataHealth "c" (payment ↔ fatura): when the card has closing + due day, each payment is matched to the cycle whose due
  date is nearest (≤ 12 days) — only for the card it is linked to / sits in, or when every card account is configured —
  and the "sem a fatura" / "não bate" texts name the due date and purchase period. Without configured cards the old
  date-window logic runs unchanged.
- App: bell + count in the header (every tab, real data only), the most urgent alert as one line under the sticky period
  bar on the Painel, the "Alertas" sheet (Importar agora → Importar with the account pre-selected, Fechou em outra data
  with the dd/mm/aaaa field, Ignorar este ciclo, Configurar conta), "Alertas de atualização" per account in Contas e
  importações. Recomputed after every commit and when the device's date changes (memo key = data version + local date).
  No browser notifications.

## v2.4a additions — batch account, CNPJ page, "Gerenciar dados"
- **Batch import account** (app only, no data-shape change): `S.imp.batch.shared` = "Conta para todos os arquivos"; a file
  follows it unless it has `it.ov = { id, auto, note }` ("Alterar só este" → manual; auto = layout suggestion before the user
  touches the shared selector, or the file's kind (fatura/extrato) mismatching the shared account's type when exactly one
  fitting account exists / the layout's account fits). Shared pre-fill: step-1 account the user picked > the alert's account >
  the recognized layouts' `defaultAccountId` when they all agree. "+ Nova conta" (top or a row) adds a PENDING account
  `__nova:N` to `batch.newAccs` (listed in every selector); the same name (normalized) reuses the pending or existing account;
  "Importar" creates each used pending account once (`addAccount`).
- **CNPJ help**: Artifact build (and Netlify when signed out) links "Consultar CNPJ" to `https://cnpj.biz/<14 digits>` plus a
  small "Outra fonte" (Google "CNPJ <formatted>"); no user-facing link to a JSON API. The paste box ("Colar atividade ou
  CNAE") accepts page text: `suggestFromCNAE` first looks for strict codes (`47.71-7-01`, `4771-7/01`, `47.71-7/01`), the one
  after "principal" winning; long text without a code only uses the activity text after "principal" (never a CNPJ/CEP/phone).
  Netlify build: `/api/cnpj` unchanged; the answer is shown as a card (razão social, nome fantasia, atividade principal +
  CNAE, cidade/UF).
- **Gerenciar dados** (Ajustes and Contas e importações → Importações): delete by file (one import, or every import with the
  same `fileName`), by month (+ optional account), an account (or only its rows), or a selection in Transações ("Selecionar",
  "Todos do filtro", "Excluir selecionados", "Mudar categoria"). Each shows an in-page plan (rows, months, sum, accounts,
  imports/account touched) before deleting, then a toast "Desfazer" (10 s) and a "Desfazer" banner in the sheet (last 5
  deletions, this session only: rows re-saved with a new `updatedAt`, newer than their tombstones; meta records restored).
  Deletes use `commit({ remove })` → rows left out of `saveMonth` / `deleteMonth` when a month empties → store tombstones (a
  stale device's save of the month cannot resurrect them). "Excluir importação" in Contas e importações uses the same path.
- Engine: `selectForDeletion(transactions, { ids?, importIds?, fileName?, month?, accountId? }, imports)` →
  `{ ids, rows, count, months, sum, accounts, importIds }`; `applyDeletion({ transactions, imports, rules, accounts, profiles,
  settings }, ids, { removeAccountIds, now })` → remaining rows + `changed` (dangling `linkedTo` cleared), import records left
  without rows removed (others get count/total/from/to of what is left), installment-series rules that only matched removed
  rows removed, `settings.dismissedAlerts` of removed accounts cleared, profiles' `defaultAccountId` of removed accounts
  cleared; `meta` = changed doc names. `dataIntegrity({ transactions, imports, accounts })` → orphan_import, import_count,
  import_account, unknown_account, dangling_link.

## v2.4b additions — PDF statements + foreign currencies
- **PDF text** (`FinEngine.readPdf(pdfjsLib, bytes, { password, onPage })`): pdf.js **3.11.174** is injected, so the same
  engine code runs in the browser and in node tests (`pdfjs-dist` legacy build, devDependency pinned). Items
  `{str, x, y, w, h, page}`; errors carry `code`: `pdf_password` | `pdf_password_wrong` | `pdf_no_text` (image only) |
  `pdf_invalid`. `isEvalSupported:false`, no font loading, no network fetches. The password is used for that call only.
  - Netlify build: `site/vendor/pdf.min.js` + `pdf.worker.min.js` (same files as `pdfjs-dist/build`, Apache-2.0,
    `vendor/pdf.LICENSE.txt`), loaded only when a PDF is chosen; parsing in a same-origin Web Worker (`worker-src 'self'`).
  - Artifact build: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js` and `pdf.worker.min.js`, loaded
    lazily as `<script>`s (the build checks the URL is cdnjs + pinned). Loading the worker file as a script defines
    `globalThis.pdfjsWorker`, so pdf.js uses its in-thread "fake worker": no Worker, no cross-origin fetch, no eval
    (verified under a CSP equal to the allowlist in e2e_v24b). Fallback per file (error or 60 s timeout, or the file
    loaded but its global is missing): `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js` /
    `pdf.worker.min.js` (the same files as the pinned `node_modules/pdfjs-dist/build/`; the build checks this URL too).
    Both hosts failing → error `pdf_load_cdn` with a pt-BR message (connection / blocked sites / use CSV-XLSX meanwhile);
    the failed load is not cached, so a new try works when the network is back.
- **Layout review fixes** (generic, no per-bank rules): pages printed in two side-by-side columns of records are cut at
  the gutter when ≥ 3 lines split at the same x (`pdfColumns`; two date columns of ONE record never split — the left
  part has no amount); a date right after a leading amount / document number (`1.234,56 D  05.09.2026  HISTÓRICO`);
  a description wrapped to the next line (plain text starting at the description's x, no amount/time/parcela/wallet)
  joins the description instead of becoming a detail; a "Valor total" label alone above its value; parcelas printed
  with their POSTING date (shifting would push most of them past the due date / cycle) → `pdf.installmentPosted`, the
  table gets the purchase date so the installment rule books them in this fatura.
- **Layout reconstruction** (pure): `pdfLines(items)` (y clusters with tolerance, x order, word gaps merged, column gaps
  kept as segments) → `analyzePdf({items,pages,pageSizes})`: repeated top/bottom lines on ≥ 2 pages (digits masked) and
  "Página x de y" dropped; money tokens (`R$`, `-R$`, `+R$`, `D/C`, `(…)`, trailing `-`, `US$/USD/€/EUR/£/ISO`, rates after
  "Cotação/conversão" kept apart); amount columns = clusters of right edges, roles from table headers (Saldo / US$ /
  Cotação) and the currency markers; dates at the line start (`dd/mm`, `dd/mm/aa(aa)`, `3 outubro 2026`, `03 OUT`, `03/out`),
  date-HEADER lines (only when the document uses them), year-less dates resolved from the due/closing/issue date (≤ 7 days
  ahead, else previous year); detail lines (closer to the record above than to the next line) give time, wallet, parcela,
  foreign amount; section titles (text followed by records / a table header); regions excluded by title or line:
  resumo, limites, ofertas de parcelamento (`1 + [3]x`, `Total:`), lançamentos futuros / próximas faturas, totais, saldos.
  Signs: explicit sign/D/C; on a fatura unsigned = charge, payment/credit keywords or sections = credit, a "−" only on
  payments means credit; extratos: the other sign, the running balance, section/keywords.
  Metadata (`pdf.meta`): due, issue, closing, cycle (`Consumos de 03/08 a 02/09`, `Período …`, `28 AGO a 27 SET`),
  total, previous fatura balance, opening/closing balance, card last 4, currency. `pdfChecksum`: fatura total = previous
  + debits − credits; extrato closing = opening + rows. Kind: fatura | extrato | beneficio (→ account type).
- **Output = the CSV path**: `analysis.rows` is a reconstructed table (Data dd/mm/aaaa, Descrição, Parcela, Hora,
  Valor em R$, Valor (moeda estrangeira), Moeda, Cotação, Saldo, Carteira, Seção, Detalhe — only the columns that have
  data) with roles, `source:'pdf'`, `analysis.pdf = { kind, meta, excluded:[{reason,label,count,samples}], sections,
  records, checksum, accountType, currency }`, fingerprint `fpdf_<hash of table headers + section titles + title lines,
  digits/months masked>`; profiles from it get `kind:'pdf'`. Same wizard, batch, dedupe, installments, classify.
- **New profile/tx fields**: column roles `fxAmount`, `fxCurrency`, `fxRate`, `tag`, `section`, `detail`; profile
  `currency` (foreign-only file). Transactions may carry `fx: { currency, amount (cents, signed like the row), rate?,
  source?: 'file'|'manual' }`, `tags: [wallet]`, `section`, `detail`; an IOF row gets `linkedTo` = its foreign purchase
  (`linkFxIof`, also redone by `moveImport`).
- **Foreign currencies**: CSV headers `Valor US$/USD/EUR/€/Moeda original` → fxAmount (never the BRL amount),
  `Cotação/Câmbio` → fxRate, `Moeda/Currency` → fxCurrency; cells with markers detected too; a bare `$` is USD only when
  the file says "dólar". Only foreign amounts → `analysis.currency`/`profile.currency` (account gets `currency`):
  `applyProfile(…, { fxRates })` books `round(foreign × rate)` with the month's rate from **settings.fxRates**
  `{ "USD": { "YYYY-MM": 5.2 } }` (exact month; missing → row error + `result.needRates`); `applyFxRates` recomputes
  `source:'manual'` rows after a rate change. `fxSummary` → Painel "Compras internacionais: R$ X (+ IOF R$ Y)".
- **Benefit cards**: account type `benefit` ("Benefício (VA/VR)"); "Transferência entre Carteiras" → transfer;
  money in on a benefit account → income `renda.beneficios`; purchases keep the wallet in `tags` and get a category hint
  (`walletCategory`: Refeição → alimentacao.restaurante, Alimentação → alimentacao.mercado, …; `catSource:'wallet'`,
  below rules/learned/dictionary).
- **Import records** of PDFs: `source:'pdf'`, `docKind`, `pages`, `dueDate`, `cycleStart`/`cycleEnd` (also `from`/`to`),
  `closeDate` (day after the cycle's last day), `statementTotal`, `cardLast4`. `importGroups` uses `dueDate` as a file date
  (cycle matching) and `inferCardDays` the printed closing/due; a card without closing/due day is configured from its
  first PDF fatura.
- App: file inputs/batch accept `.pdf`; "Lendo PDF… página i de n"; inline "Senha do PDF" (single + batch rows; never
  stored); image-only message; detection chips + "Ignorado: …" (collapsible, with samples) in steps 2/3 and batch rows;
  checksum pre-filled with the statement total; rate inputs for foreign-only files; currency badge on rows; filter
  "Moeda estrangeira"; Ajustes → "Cotações".

## v2.5 additions — transfers between your own accounts and payments
Problem: Pix/TED/Wise moves between the user's own accounts, currency conversions and fatura payments counted as income
or spending. Everything below is generic (formats + columns + names), never per-bank.
- **settings** (synced, field-wise merge): `ownerNames: [name]` (your name as statements print it — set only by the user:
  "Quem é você nos extratos?" card / Transferências sheet), `ownerNamesAsked`, `ownerNamesDismissed: [candidateKey]`,
  `transferRejected: ["p:<idA>|<idB>" pair keys, "o:<id>" row keys]` ("Não é transferência", undo → never proposed again),
  `transferReview: { at, version, counts, rows: {reason: n}, changes: [{id, reason, prev}], undone? }` (the one migration
  review, "Desfazer revisão"); `schemaVersion: 3`.
- **Transactions** may carry: `transferAccountId` (other account id or `"external"` = "Conta não cadastrada"),
  `transferSubtype: "conversion"`, `transferSource: auto|user`, `transferBank` (bank key of an outside account),
  `cardAccountId` (card a payment pays), `kindSource: "manual"` (user changed the Tipo — detection never flips it), and from
  import columns `counterparty` (Payer/Payee Name, Favorecido, Nome…), `txType` (a bank's "Transação"/"Transaction Details
  Type"), `exchange: {from, to, toAmount (cents), rate}` (Exchange From/To columns). Import records may carry `holderName`.
- **Import**: new column roles `payer`, `payee`, `counterparty`, `txType`, `fxFrom`, `fxTo`, `fxToAmount`, `holder` — taken only
  by header from columns nothing else used (amount/description/date never change; ids unchanged). `analysis.holder` from a
  "Cliente:/Titular:/Olá, NAME" preamble; `applyProfile(...).holder` from a holder column; `importHolder(analysis, result)`;
  `adoptInfoColumns(profile, analysis)` lets a layout saved earlier adopt them (single + batch import).
- **Engine**: `isOwnName(name, ownerNames)` (accents/case off, particles de/da/do/dos/das/e dropped, truncated tokens = prefix
  ≥ 4, FIRST name + ≥ 1 other token; relatives with another first name, companies/CNPJs never); `counterparty(row|text)`
  (≥ 12 description formats + `tx.counterparty`/`tx.txType` columns → `{name, direction, bankKey, institution, company,
  source}`); `conversionOf(tx)`; `detectTransfers(txs, {accounts, ownerNames, settings})` → `{transactions, changed,
  changes:[{id, reason, prev}], suggestions, counts, pairs}` — reasons: `pair` (one-to-one across accounts: same amount or
  fee ≤ R$ 5/1 %, 0–4 days (business days), foreign 3 % / same fx currency 1 %; strong when a side is your name, names the
  other account's bank, or — without names — the same person on both sides with the exact amount in 0–2 days), `own_name`
  (no pair → `external`), `conversion`, `card_payment` (+ "Débito por dívida/pagamento mínimo da fatura"; linked to the card
  by bank/linked row/nearest due date), `investment` (reservado/retirado/caixinha/aplicação/resgate, not rendimentos);
  medium/ambiguous pairs and "Pix to an institution where you have an account" → suggestions. Manual rows (catSource or
  kindSource manual) are never flipped. `undoTransferChanges`, `ownerNameCandidates` (variants grouped; holder/linked pairs
  pre-tick; never applied without "Confirmar"), `transferOverview` (pairs, flows, outside accounts by bank, conversions,
  total), `learnTransferRule` (Lembrar: counterparty → `set:{kind:'transfer'}` rule).
- `ingest` runs `detectTransfers` after classify (a new extrato completes a pair left open). `migrateData` (schema < 3) applies
  the high-confidence changes once (own name only when names exist) and stores `transferReview`.
- **dataHealth**: `m:nopair:<id>` "Transferência sem entrada correspondente" (an outflow to an own account that is in the app
  and whose rows cover the days after it, with no linked entry); `f` names the outside banks; `importKind` treats mostly
  money-in / salary rows / an "Extrato" file name as an extrato → `b:extrato-in-card` flags it inside a card account.
- **App**: editor Tipo = Gasto / Entrada / Transferência entre minhas contas (account picker incl. "Conta não cadastrada",
  optional counterpart row, Lembrar) / Pagamento de fatura (card picker) / Investimento; triage "É transferência minha" →
  account buttons (+ likely pair) → Desfazer; Painel chip "Entre suas contas: R$ X" + first-run card; "Transferências"
  sheet (also Ajustes); Sankey "Por conta" lists flows between accounts under the chart. Totals (summarize, carryover,
  categorySeries, Sankey) already exclude `transfer`/`card_payment`.

## v2.5 corpus review — a real multi-bank folder (generic rules only)
- **Files**: `fileKindOf(name, bytes)` (pdf | xlsx | zip | text; a ZIP holding a workbook is a spreadsheet, any other ZIP an
  archive of statements, whatever the name says) and `unzipEntries(bytes, { inflate })` (central directory, stored/deflated,
  folders flattened, hidden files/__MACOSX/non-statements left out; codes `zip_invalid|zip_encrypted|zip_method`). The app
  expands a ZIP into the batch list (`DecompressionStream('deflate-raw')`); file inputs accept `.zip`.
- **applyProfile**: rows equal to the header row or to a line above it (a statement printed page by page repeats both) are
  left out, never errors; `result.skipped: [{rowIndex, reason}]` ("saldo ou total", "cabeçalho repetido", "topo do arquivo
  repetido"); `result.installmentDate` — with no `profile.installmentDate`, parcelas n>1 printed among the bill's own dates
  (≥ 60 %, shifting would push them past the last row) are POSTING dates → booked as printed (`as_is`), else shifted.
  A header-only file → `analysis.empty`, 0 rows, 0 errors (batch: nothing to configure). A file rate is a BRL rate only when
  the row's Exchange From/To has BRL on one side (BRL→X = 1/rate); a USD→CNY card rate falls back to `settings.fxRates`.
  Generic "Descrição/Description/Histórico" headers beat narrower ones (Merchant, Payee) for the description.
- **dedupe**: fuzzy matches (±2 days) never join two rows whose running balances (or times) differ.
- **importKind**: file names split on `_ . -`; the bank's transaction type (`txType`) counts as wording. The batch passes the
  file name.
- **classify**: no category from the description → the bank's type (`txType`: "Pagamento de salário/adiantamento/rescisão")
  as a category hint (never a transfer/card payment); money in typed as a card purchase (CARD/COMPRA) = refund (expense).
- **Owner names**: `isOwnName` — every other name on the statement must be one of yours (all your variants with that first
  name pooled): a statement may drop or cut names, never add one (a sibling "Fulana Tal Souza" ≠ "Fulana Beltrana de Tal").
- **detectTransfers**: Exchange columns on a card purchase abroad are not a conversion; the other leg of a conversion is
  itself a conversion holding the OTHER side's amount (money out ↔ "to", money in ↔ "from"); your name at a bank where you
  have an account in the app (no pair) → that account (`transferAccountId`), else "external"; a Pix/boleto to a card's
  issuer of exactly an imported fatura's total (≤ 40 days after its last purchase) → that card's payment; rows patched and
  patched back are not changes (idempotent). `linkCardPayments`: a Pix to a person is never a bill payment; a row linked
  on an earlier import lets go when a better (hinted) match arrives — same result in any import order.
- **dataHealth**: `filePeriod` reads month names ("01ABR2026_30ABR2026"); running balances compared in the statement's own
  currency (fx source file/manual); a month inside the period a file says it covers is never a gap; check c counts every
  payment of one cycle together (bills paid in parts), uses the printed due date of PDF faturas, and names the payment's own
  card in "Pagamento de fatura sem a fatura"; no salary expected after a severance payment. `inferCardDays`: with ≥ 2 pairs
  of consecutive bills, the closing day allowed by every window (after one bill's last purchase, on/before the next one's
  first) wins over "the first purchase day" (sparse bills of one subscription).
- **App**: no import record when every row was a duplicate (no orphan imports); batch account suggestion and the shared
  account respect the account currency (a USD statement goes to the USD account, with a note).
- **Corpus harness** (runtime only, nothing stored): `test/corpus.test.js` + `test/corpus/{pipeline,corpus,importer,plan}.js`
  + `test/corpus/reference.py` (independent reader) + `test/e2e/e2e_corpus.py`, all keyed on `FF_CORPUS_DIR`.
