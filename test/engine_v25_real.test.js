'use strict';
// v2.5 on the user's REAL data (read-only snapshot of the claude.ai artifact db, when present at FF_REAL_ARTIFACT_DB).
// Prints ONLY counts per reason and the monthly income/expense change in % — never names, amounts or ids.
// Asserts: no salary (renda.salario) became a transfer; no row became a transfer to/from a third party (only pairs,
// conversions, card payments and your own name); spending only moved out through those reasons; data health flags the
// extrato imported into a card account. The owner names are the pre-ticked candidates of "Quem é você nos extratos?".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../site/engine.js');

const DB = process.env.FF_REAL_ARTIFACT_DB || '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db6/data/users/me/ff';
const has = fs.existsSync(path.join(DB, 'v2meta')) && fs.existsSync(path.join(DB, 'v2months'));

function load() {
  const meta = {};
  for (const f of fs.readdirSync(path.join(DB, 'v2meta'))) {
    const j = JSON.parse(fs.readFileSync(path.join(DB, 'v2meta', f), 'utf8'));
    const d = j && j.data !== undefined ? j.data : j;
    meta[f.replace(/\.json$/, '')] = d && d.items !== undefined ? d.items : d;
  }
  const txs = [];
  for (const f of fs.readdirSync(path.join(DB, 'v2months'))) {
    const j = JSON.parse(fs.readFileSync(path.join(DB, 'v2months', f), 'utf8'));
    for (const t of (Array.isArray(j) ? j : j.transactions || [])) if (t && !t.deleted) txs.push(t);
  }
  return { meta, txs };
}
const pct = (a, b) => (a ? ((b - a) / a * 100).toFixed(1) + '%' : '—');

test('v2.5 on the real snapshot: counts per reason, monthly income change, nothing wrong flipped', { skip: !has && 'no snapshot at FF_REAL_ARTIFACT_DB' }, (t) => {
  const { meta, txs } = load();
  const before = JSON.parse(JSON.stringify(txs));
  const d = { settings: meta.settings || {}, categories: meta.categories, rules: meta.rules, profiles: meta.profiles, accounts: meta.accounts || [], imports: meta.imports || {}, txs };
  // 1. the migration (schema 3): high-confidence review without names
  const m = E.migrateData(JSON.parse(JSON.stringify(d)), { now: '2026-10-06T00:00:00.000Z' });
  const rv = m.data.settings.transferReview;
  t.diagnostic('migration review rows by reason: ' + JSON.stringify(rv.rows));
  assert.ok(!rv.rows.own_name, 'no own-name changes before the user confirms a name');
  // 2. "Quem é você nos extratos?" — the pre-ticked candidates, confirmed
  const cands = E.ownerNameCandidates(m.data.txs, { accounts: d.accounts, imports: d.imports, settings: m.data.settings });
  t.diagnostic('name candidates: ' + cands.length + ', pre-ticked: ' + cands.filter(c => c.suggested).length);
  const names = cands.filter(c => c.suggested).flatMap(c => c.variants);
  const st = Object.assign({}, m.data.settings, { ownerNames: names });
  const dt = E.detectTransfers(m.data.txs, { accounts: d.accounts, settings: st });
  t.diagnostic('after confirming names, changes by reason: ' + JSON.stringify(dt.changes.reduce((o, c) => (o[c.reason] = (o[c.reason] || 0) + 1, o), {})) + ' · suggestions: ' + dt.suggestions.length);
  const after = dt.transactions;
  const months = [...new Set(before.map(x => x.date.slice(0, 7)))].sort();
  for (const ym of months) {
    const a = E.summarize(before, { from: ym + '-01', to: ym + '-31' }), b = E.summarize(after, { from: ym + '-01', to: ym + '-31' });
    t.diagnostic(ym + ' income ' + pct(a.income, b.income) + ' · expense ' + pct(a.expense, b.expense));
  }
  const prev = new Map(before.map(x => [x.id, x]));
  const flipped = after.filter(x => prev.get(x.id) && prev.get(x.id).kind !== x.kind);
  // no employer salary became a transfer
  assert.equal(flipped.filter(x => /^renda\.salario/.test(prev.get(x.id).categoryId || '') && x.kind === 'transfer').length, 0, 'salary untouched');
  // every new transfer is a pair, a conversion, a card payment or your own name — never a third party
  const bad = flipped.filter(x => x.kind === 'transfer' && x.transferSubtype !== 'conversion' && !x.linkedTo).filter(x => {
    const c = E.counterparty(x);
    return !(c && c.name && E.isOwnName(c.name, names)) && !E.isOwnName(x.rawDescription, names);
  });
  assert.equal(bad.length, 0, 'no third-party payment became a transfer');
  // spending left the totals only through those kinds (no expense became income/other)
  assert.ok(flipped.every(x => ['transfer', 'card_payment', 'investment'].includes(x.kind)), 'only transfer / card payment / investment');
  // manual rows never flipped
  assert.equal(flipped.filter(x => prev.get(x.id).catSource === 'manual').length, 0, 'manual rows kept');
  // data health: the extrato inside the card account is flagged
  const h = E.dataHealth({ transactions: after, accounts: d.accounts, imports: d.imports, settings: st, today: '2026-10-06' });
  const kinds = h.reduce((o, w) => { const k = w.id.split(':').slice(0, 2).join(':'); o[k] = (o[k] || 0) + 1; return o; }, {});
  t.diagnostic('data health: ' + JSON.stringify(kinds));
  const cardIds = new Set((d.accounts || []).filter(a => a.type === 'credit_card').map(a => a.id));
  const salaryInCard = after.some(x => cardIds.has(x.accountId) && x.kind === 'income' && /^renda\.salario/.test(x.categoryId || ''));
  if (salaryInCard) assert.ok(h.some(w => /^b:extrato-in-card:/.test(w.id)), 'salary rows inside a card account → "Extrato bancário dentro de um cartão"');
  // idempotent
  assert.equal(E.detectTransfers(after, { accounts: d.accounts, settings: st }).changes.length, 0);
  const m2 = E.migrateData(m.data, { now: '2026-10-07T00:00:00.000Z' });
  assert.equal(m2.report.transferChanges, undefined);
});
