'use strict';
// Corpus regression harness: the user's REAL statements folder, read at runtime only (FF_CORPUS_DIR; skipped when
// absent). Nothing about the files is stored in the repo; the diagnostics print only counts (no names, amounts, ids or
// file names). For every file: the app's pipeline (layout detection → rows) against an independent Python reader
// (test/corpus/reference.py): row counts, net totals (in the statement's own currency), running-balance continuity,
// printed totals of PDF faturas. Then the whole folder imported as a user would (one account per institution and kind,
// one per currency for a multi-currency wallet): batch per institution vs everything at once vs reversed order, re-import,
// identical copies (a ZIP and its extracted files); transfers between the accounts; monthly totals; data health.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../site/engine.js');
const C = require('./corpus/corpus.js');
const I = require('./corpus/importer.js');

const DIR = process.env.FF_CORPUS_DIR;
const has = !!DIR && fs.existsSync(DIR);
const skip = !has && 'no corpus at FF_CORPUS_DIR';

let state = null;
async function load() {
  if (state) return state;
  const entries = await C.loadCorpus(DIR);
  const ref = JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'corpus', 'reference.py'), DIR], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const accounts = C.planAccounts(entries.filter(e => e.parsed));
  state = { entries, ref, accounts };
  return state;
}
function store(accounts) { const d = I.emptyStore(); d.accounts = JSON.parse(JSON.stringify(accounts)); d.settings.fxRates = C.fxRates(); return d; }
const item = e => ({ name: e.name, analysis: e.parsed.analysis, accountId: e.accountId });
const count = (arr, f) => arr.reduce((o, x) => { const k = f(x); if (k != null) o[k] = (o[k] || 0) + 1; return o; }, {});
const accLabel = (accounts) => { const m = {}; accounts.forEach((a, i) => { m[a.id] = 'A' + (i + 1) + ':' + a.type + (a.currency ? ':' + a.currency : ''); }); return id => m[id] || (id === 'external' ? 'fora' : '?'); };
// institutions are numbered in the order of the folder (never named in the output)
const groupLabel = (entries) => { const gs = [...new Set(entries.map(e => e.group))]; return g => 'I' + (gs.indexOf(g) + 1); };

test('corpus 1: every file parses like the independent reference (counts, totals, balances, printed totals)', { skip }, async (t) => {
  const { entries, ref } = await load();
  const gl = groupLabel(entries);
  const per = {};
  let checked = 0;
  for (const e of entries) {
    assert.ok(!e.error, 'file opens: ' + gl(e.group) + ' ' + e.error);
    const r = e.parsed.result, txs = r.transactions;
    const g = per[gl(e.group)] = per[gl(e.group)] || { files: 0, rows: 0, errors: 0, skipped: {}, kinds: {}, refOK: 0 };
    g.files++; g.rows += txs.length; g.errors += r.errors.length;
    (r.skipped || []).forEach(s => { g.skipped[s.reason] = (g.skipped[s.reason] || 0) + 1; });
    g.kinds[e.parsed.kind || 'vazio'] = (g.kinds[e.parsed.kind || 'vazio'] || 0) + 1;
    assert.equal(r.errors.length, 0, gl(e.group) + ': no row errors');
    const rf = ref[e.rel];
    assert.ok(rf && rf.format !== 'error' && rf.format !== 'unknown', gl(e.group) + ': the reference reads it too');
    // native currency: a foreign-only statement books BRL with the month's rate; compare in its own currency
    const native = txs.reduce((s, x) => s + (x.fx && (x.fx.source === 'file' || x.fx.source === 'manual') ? x.fx.amount : x.amount), 0);
    if (rf.count != null) {
      assert.equal(txs.length, rf.count, gl(e.group) + ': row count = reference');
      assert.equal(native, rf.net, gl(e.group) + ': net total = reference');
      if (rf.balance) assert.equal(rf.balance.breaks, 0, gl(e.group) + ': the file itself has a continuous balance');
      if (rf.statement && rf.statement.printed_balance != null) assert.equal(native, rf.statement.printed_balance, gl(e.group) + ': rows add up to the printed balance');
      if (rf.skipped) assert.equal((r.skipped || []).filter(s => s.reason === 'saldo ou total').length, rf.skipped, gl(e.group) + ': every daily-balance line left out, none else');
      if (rf.from) { const ds = txs.map(x => x.originalDate || x.date).sort(); assert.ok(ds[0] >= rf.from && ds[ds.length - 1] <= rf.to, gl(e.group) + ': dates inside the reference range'); }
    } else if (rf.format === 'card-pdf') {
      const st = rf.statement, deb = -txs.filter(x => x.amount < 0).reduce((s, x) => s + x.amount, 0), cred = txs.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0);
      assert.equal(deb, st.total, gl(e.group) + ': fatura charges = printed total');
      assert.equal(cred, st.credits || 0, gl(e.group) + ': fatura credits = printed payments/credits');
      assert.ok(e.parsed.analysis.pdf.checksum && e.parsed.analysis.pdf.checksum.ok, gl(e.group) + ': the app\'s own checksum reconciles');
    }
    g.refOK++; checked++;
  }
  for (const [k, g] of Object.entries(per)) t.diagnostic(k + ': ' + JSON.stringify(g));
  t.diagnostic('files checked against the reference: ' + checked + '/' + entries.length);
});

async function importAll(entries, accounts, order) {
  const d = store(accounts);
  const groups = [...new Set(entries.map(e => e.group))];
  if (order === 'all') I.importFiles(d, entries.map(item));
  else for (const g of (order === 'reverse' ? groups.slice().reverse() : groups)) I.importFiles(d, entries.filter(e => e.group === g).map(item));
  return d;
}
const sig = d => d.txs.map(t => [t.id, t.accountId, t.date, t.amount, t.kind, t.categoryId || '', t.linkedTo || '', t.transferAccountId || '', t.cardAccountId || ''].join('|')).sort();

test('corpus 2: same rows in any import order; re-import adds nothing; identical copies are duplicates', { skip }, async (t) => {
  const { entries, accounts } = await load();
  const ok = entries.filter(e => e.parsed);
  const A = await importAll(ok, accounts, 'groups');
  const B = await importAll(ok, accounts, 'all');
  const R = await importAll(ok, accounts, 'reverse');
  // the transfer pass on the final data (what the app shows after the last import) is the same everywhere
  const settle = d => { d.txs = E.detectTransfers(d.txs, { accounts: d.accounts, settings: d.settings }).transactions; return d; };
  [A, B, R].forEach(settle);
  assert.deepEqual(sig(B), sig(A), 'everything at once = one institution at a time');
  assert.deepEqual(sig(R), sig(A), 'reverse institution order = same result');
  const again = I.importFiles(A, ok.map(item));
  assert.equal(again.reduce((s, x) => s + x.added, 0), 0, 're-importing everything adds 0 rows');
  // byte-identical files (a ZIP's entries and the same files extracted): only the first one adds rows
  const crypto = require('crypto');
  const byHash = {};
  for (const e of ok) { const h = crypto.createHash('sha1').update(Buffer.from(e.bytes)).digest('hex'); (byHash[h] = byHash[h] || []).push(e); }
  const copies = Object.values(byHash).filter(l => l.length > 1);
  const d = store(accounts);
  let dupRows = 0, copyAdded = 0;
  for (const l of copies) {
    const s = I.importFiles(d, l.map(item));
    copyAdded += s.slice(1).reduce((n, x) => n + x.added, 0);
    dupRows += s.slice(1).reduce((n, x) => n + x.dup, 0);
  }
  assert.equal(copyAdded, 0, 'identical copies add nothing');
  t.diagnostic('rows: ' + A.txs.length + ' · copies: ' + copies.reduce((n, l) => n + l.length - 1, 0) + ' files, ' + dupRows + ' duplicate rows · zip entries: ' + ok.filter(e => e.inZip).length);
  t.diagnostic('rows per account: ' + JSON.stringify(count(A.txs, x => accLabel(accounts)(x.accountId))));
});

test('corpus 3: owner names, transfers between the accounts, card payments, monthly totals without double counting', { skip }, async (t) => {
  const { entries, accounts } = await load();
  const d = await importAll(entries.filter(e => e.parsed), accounts, 'groups');
  const al = accLabel(accounts);
  // "Quem é você nos extratos?": the pre-ticked candidates must all be ONE person (first name + only names of theirs)
  const cands = E.ownerNameCandidates(d.txs, { accounts: d.accounts, imports: d.imports, settings: d.settings });
  const sug = cands.filter(c => c.suggested);
  t.diagnostic('name candidates: ' + cands.length + ', pre-ticked: ' + sug.length + ' (variants: ' + sug.map(c => c.variants.length).join(',') + ')');
  assert.ok(sug.length >= 1, 'the holder is proposed');
  const names = sug.flatMap(c => c.variants);
  for (const v of names) assert.ok(E.isOwnName(v, names.filter(w => w !== v).concat(names.length === 1 ? [v] : [])), 'every pre-ticked variant is the same person');
  for (const c of cands.filter(c => !c.suggested)) assert.ok(!c.variants.some(v => E.isOwnName(v, names)), 'other candidates are other people');
  const before = d.txs;
  d.settings.ownerNames = names;
  const dt = E.detectTransfers(d.txs, { accounts: d.accounts, settings: d.settings });
  const tx = dt.transactions, byId = new Map(tx.map(x => [x.id, x]));
  const typeOf = id => (d.accounts.find(a => a.id === id) || {}).type;
  // pairs: both sides transfers, linked to each other, in two different accounts, opposite signs
  const linked = tx.filter(x => x.kind === 'transfer' && x.linkedTo);
  for (const x of linked) {
    const o = byId.get(x.linkedTo);
    assert.ok(o && o.linkedTo === x.id && o.kind === 'transfer', 'pairs are mutual');
    assert.notEqual(o.accountId, x.accountId, 'a pair joins two accounts');
    assert.equal(Math.sign(o.amount), -Math.sign(x.amount), 'money out ↔ money in');
    if (x.transferSubtype === 'conversion') assert.equal(o.transferSubtype, 'conversion', 'a conversion pairs with a conversion');
  }
  const pairs = count(linked.filter(x => x.amount < 0), x => al(x.accountId) + '→' + al(byId.get(x.linkedTo).accountId) + (x.transferSubtype ? ' (câmbio)' : ''));
  t.diagnostic('pairs between own accounts: ' + JSON.stringify(pairs));
  // every unpaired transfer is your own name (to an account outside the app or not covered), a conversion or a wallet move
  const unpaired = tx.filter(x => x.kind === 'transfer' && !x.linkedTo);
  for (const x of unpaired) {
    const c = E.counterparty(x);
    const own = (c && c.name && E.isOwnName(c.name, names)) || E.isOwnName(x.rawDescription, names) || E.isOwnName(x.counterparty, names);
    assert.ok(own || x.transferSubtype === 'conversion' || typeOf(x.accountId) === 'benefit', 'an unpaired transfer is yours, a conversion or a benefit wallet move');
  }
  t.diagnostic('own transfers without a pair: ' + JSON.stringify(count(unpaired, x => x.transferSubtype ? 'câmbio' : typeOf(x.accountId) === 'benefit' ? 'carteiras do benefício' : x.transferAccountId === 'external' ? 'conta fora do app' : 'conta do app sem o extrato do dia')));
  // salary stays income; third parties never become transfers
  assert.equal(tx.filter(x => /^renda\.salario/.test(x.categoryId || '') && x.kind !== 'income').length, 0, 'salary stays income');
  const prev = new Map(before.map(x => [x.id, x]));
  const flipped = tx.filter(x => prev.get(x.id) && prev.get(x.id).kind !== x.kind);
  assert.ok(flipped.every(x => ['transfer', 'card_payment', 'investment'].includes(x.kind)), 'names only turn rows into transfers');
  // benefit wallet moves: transfers that net to zero
  const wallet = tx.filter(x => typeOf(x.accountId) === 'benefit' && x.kind === 'transfer');
  assert.equal(wallet.reduce((s, x) => s + x.amount, 0), 0, 'wallet moves net zero');
  // card payments: every bill payment from a bank account says which card it paid
  const pays = tx.filter(x => x.kind === 'card_payment' && x.amount < 0 && typeOf(x.accountId) !== 'credit_card');
  assert.ok(pays.every(x => x.cardAccountId && typeOf(x.cardAccountId) === 'credit_card'), 'each bill payment names its card');
  t.diagnostic('card payments per card: ' + JSON.stringify(count(pays, x => al(x.cardAccountId) + (x.linkedTo ? ' (ligado à fatura)' : ' (fatura não importada)'))));
  t.diagnostic('changes by reason: ' + JSON.stringify(count(dt.changes, c => c.reason)) + ' · suggestions: ' + dt.suggestions.length + ' ' + JSON.stringify(count(dt.suggestions, s => s.type)));
  t.diagnostic('kinds: ' + JSON.stringify(count(tx, x => x.kind + (x.transferSubtype ? ':' + x.transferSubtype : ''))));
  // monthly totals: income/expense only from income/expense rows — transfers (both sides), card payments, investments out
  const months = [...new Set(tx.map(x => x.date.slice(0, 7)))].sort();
  for (const ym of months) {
    const s = E.summarize(tx, { from: ym + '-01', to: ym + '-31' });
    const rows = tx.filter(x => x.date.slice(0, 7) === ym);
    const inc = rows.filter(x => x.kind === 'income').reduce((a, x) => a + x.amount, 0);
    const exp = -rows.filter(x => x.kind === 'expense').reduce((a, x) => a + x.amount, 0);
    assert.equal(s.income, inc, ym + ': income = income rows only');
    assert.equal(s.expense, exp, ym + ': spending = expense rows only (card purchases once, bill payments out)');
  }
  // a second pass changes nothing (stable)
  assert.equal(E.detectTransfers(tx, { accounts: d.accounts, settings: d.settings }).changes.length, 0, 'idempotent');
  state.final = { tx, d };
});

test('corpus 4: data health — no warning contradicts the files; card days inferred', { skip }, async (t) => {
  const { entries, accounts, ref } = await load();
  if (!state.final) { const d = await importAll(entries.filter(e => e.parsed), accounts, 'groups'); state.final = { tx: d.txs, d }; }
  const { tx, d } = state.final;
  const h = E.dataHealth({ transactions: tx, accounts: d.accounts, imports: d.imports, settings: d.settings, today: '2026-10-06' });
  t.diagnostic('warnings: ' + JSON.stringify(count(h, w => w.severity + ' · ' + w.title.replace(/ em .*| de [a-zç]+$| em [a-zç]+$/i, '').replace(/^[A-ZÇ][a-zç]+ \d{4} /, '<mês> '))));
  const byImp = new Map();
  for (const e of entries.filter(e => e.parsed)) for (const r of Object.values(d.imports)) if (r.fileName === e.name && r.accountId === e.accountId) byImp.set(r.id, e);
  // running balance: a file whose own balance is continuous never gets "Saldo não fecha"
  for (const w of h.filter(w => /^d:break:/.test(w.id))) {
    const e = byImp.get(w.importIds[0]);
    assert.ok(!(e && ref[e.rel] && ref[e.rel].balance && ref[e.rel].balance.breaks === 0), '"Saldo não fecha" on a file whose balance is continuous');
  }
  // months inside the period a file says it covers are never "sem lançamentos" / "incompleto" for that account
  const covered = (acc, m) => Object.values(d.imports).some(r => r.accountId === acc && (() => { const p = E.filePeriod(r.fileName); return p && p[0] <= m + '-01' && p[1] >= m + '-28'; })());
  for (const w of h.filter(w => /^a:gap:|^e:partial:/.test(w.id) && w.severity === 'blocking')) assert.ok(!covered(w.accountId, w.months[0]), 'a covered month is not flagged');
  // a fatura paid in parts: the parts together match it (no "não bate" when they add up)
  for (const w of h.filter(w => /^c:mismatch:/.test(w.id))) {
    const f = Object.values(d.imports).find(r => w.importIds.includes(r.id) && r.accountId && (d.accounts.find(a => a.id === r.accountId) || {}).type === 'credit_card');
    if (!f) continue;
    const total = -tx.filter(x => x.importId === f.id && x.kind !== 'card_payment').reduce((s, x) => s + x.amount, 0);
    const paid = -tx.filter(x => x.kind === 'card_payment' && x.amount < 0 && x.cardAccountId === f.accountId && x.date >= (f.dueDate || f.to) && x.date <= E.shiftDateMonths(f.dueDate || f.to, 1)).reduce((s, x) => s + x.amount, 0);
    assert.ok(Math.abs(total - paid) > 100, 'payments that add up to the fatura are not "não bate"');
  }
  // no orphan import records
  assert.deepEqual(E.dataIntegrity({ transactions: tx, imports: d.imports, accounts: d.accounts }).filter(x => x.kind === 'orphan_import'), [], 'no import record without rows');
  for (const a of d.accounts.filter(a => a.type === 'credit_card')) {
    const inf = E.inferCardDays({ accountId: a.id, accounts: d.accounts, transactions: tx, imports: d.imports });
    t.diagnostic('card ' + accLabel(accounts)(a.id) + ': inferred closing ' + inf.closingDay + ' / due ' + inf.dueDay + (a.closingDay ? ' · from its PDF: ' + a.closingDay + ' / ' + a.dueDay : ''));
    assert.ok(inf.closingDay && inf.dueDay, 'closing and due day inferred');
    if (a.closingDay) assert.equal(inf.closingDay, a.closingDay, 'inference agrees with the printed closing day');
    // every fatura's own purchases fall inside one cycle of the inferred days (rows booked as printed)
    const acc = Object.assign({}, a, { closingDay: inf.closingDay, dueDay: inf.dueDay });
    const recs = Object.values(d.imports).filter(r => r.accountId === a.id);
    let inside = 0, total = 0;
    for (const r of recs) {
      const ds = tx.filter(x => x.importId === r.id && x.kind !== 'card_payment' && !x.originalDate && x.amount < 0).map(x => x.date).sort();
      if (ds.length < 1) continue;
      total++;
      const cyc = E.cardCycles(acc, { from: ds[0], to: ds[ds.length - 1] });
      if (cyc.some(c => c.start <= ds[0] && c.end >= ds[ds.length - 1])) inside++;
    }
    t.diagnostic('  faturas whose purchases fit one inferred cycle: ' + inside + '/' + total);
  }
  const al = E.updateAlerts({ accounts: d.accounts, imports: d.imports, transactions: tx, today: '2026-10-06', settings: d.settings });
  t.diagnostic('alerts: ' + JSON.stringify(count(al, a => a.kind)));
});
