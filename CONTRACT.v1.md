# Finanças MVP — shared contract

Personal finance app for a user in Brazil. Phone-first, single-page HTML app published as a claude.ai Artifact.
Two parts built in parallel by different agents:

- `engine.js` — pure logic, no DOM, no network. Runs in browser AND node (for tests).
- `app.html` — UI. Inlines `engine.js` at build time (the integrator pastes engine.js into a `<script>` block).
  While developing, the UI agent may load it with `<script src="engine.js">`; the final artifact must be ONE file.

## Global object

engine.js defines `globalThis.FinEngine = { ... }` and also `module.exports = FinEngine` when `module` exists.
No imports, no dependencies. ES2020.

## Data shapes

```js
// Transaction (amounts in integer CENTS, negative = money out, positive = money in)
{
  id: string,               // stable hash of date|amount|rawDescription|accountId|occurrenceIndex
  date: "YYYY-MM-DD",
  amount: number,           // cents, signed
  rawDescription: string,   // exactly as in file
  merchant: string,         // normalized, e.g. "IFOOD"
  installment: null | { n: number, total: number },
  accountId: string,        // e.g. "nubank-cartao" (user-chosen source)
  kind: "expense" | "income" | "transfer" | "card_payment" | "investment",
  categoryId: string | null,// e.g. "alimentacao.delivery"; null = uncategorized
  catSource: "rule" | "learned" | "dictionary" | "ai" | "manual" | null,
  importId: string,
  note?: string, tags?: string[]
}

// Account
{ id, name, type: "credit_card" | "checking" | "savings" | "payslip" | "cash" }

// Category taxonomy: two levels
{ id: "alimentacao", name: "Alimentação", color: "#hex", kind: "expense", children: [ { id: "alimentacao.delivery", name: "Delivery" }, ... ] }
// income groups too, e.g. id "renda" with children "renda.salario", "renda.13", "renda.ferias", "renda.beneficios", "renda.outros"

// Rule (user rules + learned rules share shape)
{ id, match: { field: "merchant"|"rawDescription", op: "contains"|"equals"|"startsWith"|"regex", value: string },
  amountMin?: number, amountMax?: number,   // cents, compared on Math.abs(amount)
  set: { categoryId?: string, kind?: string, merchant?: string },
  origin: "user" | "learned" | "ai", priority: number, hits?: number }

// Import profile (saved "setup" for a file layout)
{ id, name, fingerprint: string,          // from header row / column shape
  encoding: "utf-8"|"windows-1252", delimiter: ";"|","|"\t"|"|",
  headerRowIndex: number|null, skipTop: number, skipBottomPatterns: string[],
  columns: { date: number, description: number, amount?: number, debit?: number, credit?: number, dcFlag?: number, installment?: number },
  dateFormat: "DD/MM/YYYY"|"DD/MM/YY"|"YYYY-MM-DD"|"MM/DD/YYYY"|"DD MMM"|...,
  numberFormat: "br" | "us",               // br = 1.234,56   us = 1,234.56
  signConvention: "negative_is_expense" | "positive_is_expense" | "dc_flag" | "split_columns",
  defaultAccountId?: string }
```

## engine.js API (all pure, synchronous)

```js
FinEngine.decodeBytes(uint8Array) -> { text, encoding }              // utf-8 vs windows-1252 heuristic, strips BOM
FinEngine.analyzeTable(text) -> Analysis
FinEngine.analyzeRows(rows: string[][]) -> Analysis                  // for XLSX already split into cells
// Analysis = { rows: string[][], delimiter, delimiterConfidence (0-1),
//   headerRowIndex, dataStart, dataEnd, skippedRows: [{index, text, reason}],
//   columns: [{ index, header, role: "date"|"description"|"amount"|"debit"|"credit"|"dcFlag"|"installment"|"balance"|"ignore",
//               confidence, samples: string[] }],
//   numberFormat, numberFormatConfidence, dateFormat, signConvention, signConfidence,
//   fingerprint, overallConfidence (0-1), warnings: string[] }
FinEngine.profileFromAnalysis(analysis, overrides?) -> Profile
FinEngine.applyProfile(rowsOrText, profile, { accountId, importId }) -> { transactions: Transaction[], errors: [{rowIndex, raw, reason}], total: number /*cents, sum of amounts*/ }
FinEngine.matchProfile(analysis, profiles[]) -> Profile | null      // by fingerprint
FinEngine.parseAmount(str, numberFormat) -> cents | null
FinEngine.detectNumberFormat(strings[]) -> { format, confidence }
FinEngine.parseDate(str, dateFormat, { referenceYear }) -> "YYYY-MM-DD" | null   // handles "15 SET", "15/set", pt-BR month names
FinEngine.normalizeDescription(raw) -> { merchant, installment }
FinEngine.DEFAULT_CATEGORIES -> Category[]                           // pt-BR taxonomy
FinEngine.DEFAULT_DICTIONARY -> [{ pattern: string (uppercase substring or /regex/), categoryId, kind? }]
FinEngine.classify(tx, { rules, dictionary }) -> { kind, categoryId, catSource, merchant }
FinEngine.classifyAll(transactions, ctx) -> Transaction[]
FinEngine.learnFromCorrection(tx, newCategoryId, rules, history) -> { rules, created: Rule|null }
     // after the same merchant is manually set to the same category 2 times -> create learned rule
FinEngine.dedupe(existing[], incoming[]) -> { fresh[], duplicates[] }  // same account, amount, date ±2 days, similar merchant
FinEngine.linkCardPayments(transactions) -> transactions              // marks bank-side fatura payments kind "card_payment"
FinEngine.summarize(transactions, { from, to }) -> { income, expense, net, byCategory: {id: cents}, byGroup, byAccount, count }
FinEngine.buildSankey(transactions, { from, to, categories, accounts, view: "category"|"account", payslips?, maxNodes? }) -> { nodes: [{id, name, color, value, column}], links: [{source, target, value}] }
     // Layout like the reference image: income sources (col 0) -> "Orçamento" hub (col 1) -> groups (col 2) -> categories (col 3)
     // If income > expense add "Sobra / Poupança" leaf. If expense > income add "Déficit" source on the left.
     // Small items fold into "Outros". view "account": hub -> accounts/cards instead of groups.
     // card_payment and transfer are excluded (no double counting). Payslip deductions (INSS, IRRF) become a "Impostos" leaf
     // and gross salary is the income source, when payslip transactions exist.
FinEngine.monthlySeries(transactions, months: number, endMonth: "YYYY-MM") -> [{ month, income, expense }]
FinEngine.futureInstallments(transactions) -> [{ month, total, items[] }]   // remaining parcelas projected forward
FinEngine.formatBRL(cents) -> "R$ 1.234,56"
FinEngine.payslipToTransactions({ date, gross, inss, irrf, otherDeductions:[{name,amount}], net, employer, accountId }) -> Transaction[]
FinEngine.buildAIPrompt(analysis) -> string   // prompt asking an LLM to return a Profile-shaped JSON mapping for an unknown layout (only first ~40 rows, values masked except shape)
FinEngine.validateAIProfile(json, analysis) -> { profile, problems[] }
```

## AI (phase-1 scope, restricted)
The app uses the artifact `sample` capability ONLY for:
1. "Analisar com IA" on the import screen when analysis.overallConfidence < 0.7 → sends buildAIPrompt(analysis), receives a profile mapping, user still confirms in the preview.
2. "Sugerir categorias" for uncategorized transactions → sends ONLY distinct merchant names + the category id list. No amounts, dates, names.
Nothing else calls AI.

## Storage
Artifact `db` capability, private per user: `data/users/<userId>/...`
- `.../meta/settings`, `.../meta/categories`, `.../meta/rules`, `.../meta/profiles`, `.../meta/accounts`
- `.../months/<YYYY-MM>` → `{ transactions: Transaction[] }` (doc limit 256 KiB, so split by month)
Fallback when db is null: in-memory + localStorage (try/catch everything).
