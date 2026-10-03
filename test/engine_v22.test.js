'use strict';
// v2.2: multi-file import (batch), spending per category over time, "Não identificado". All data synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../site/engine.js');

// ------------------------------------------------------------------ synthetic XP-style files
const FAT_HDR = 'Data;Estabelecimento;Portador;Valor;Parcela';
const fatJul = [FAT_HDR,
  '10/05/2026;LOJA TESTE PARCELADA;FULANO;150,00;3 de 10',
  '02/07/2026;POSTO SHELL;FULANO;210,00;-',
  '05/07/2026;IFOOD *RESTAURANTE;FULANO;45,90;-',
  '20/07/2026;NETFLIX.COM;FULANO;55,90;-',
  '25/07/2026;Pagamento de fatura;FULANO;-900,00;-'].join('\n');
const fatAgo = [FAT_HDR,
  '10/05/2026;LOJA TESTE PARCELADA;FULANO;150,00;4 de 10',
  '03/08/2026;SEM PARAR PEDAGIO;FULANO;12,50;-',
  '03/08/2026;SEM PARAR PEDAGIO;FULANO;12,50;-', // two identical tolls on the same day: both are real
  '08/08/2026;IFOOD *RESTAURANTE;FULANO;45,90;-',
  '20/08/2026;NETFLIX.COM;FULANO;55,90;-',
  '25/08/2026;Pagamento de fatura;FULANO;-461,80;-'].join('\n');
const fatSet = [FAT_HDR,
  '10/05/2026;LOJA TESTE PARCELADA;FULANO;150,00;5 de 10',
  '07/09/2026;DROGASIL 0412;FULANO;38,40;-',
  '20/09/2026;NETFLIX.COM;FULANO;55,90;-'].join('\n');
const extrato = ['Data;Hora;Descrição;Valor;Saldo',
  '01/07/26;08:15;Rendimento automático;0,10;1.000,10',
  '05/07/26;09:30;TED recebida de EMPRESA TESTE LTDA;5.000,00;6.000,10',
  '25/07/26;10:00;PAGAMENTO DE FATURA;-900,00;5.100,10',
  '05/08/26;09:30;TED recebida de EMPRESA TESTE LTDA;5.000,00;10.100,10',
  '25/08/26;10:00;PAGAMENTO DE FATURA;-461,80;9.638,30',
  '10/09/26;11:00;Pix enviado para Joao Padeiro;-30,00;9.608,30'].join('\n');

const accounts = [{ id: 'cartao', name: 'Cartão XP', type: 'credit_card' }, { id: 'conta', name: 'Conta XP', type: 'checking' }];
const ctx = { rules: [], dictionary: E.DEFAULT_DICTIONARY, categories: E.DEFAULT_CATEGORIES, accounts };
const profileOf = text => E.profileFromAnalysis(E.analyzeTable(text));
const item = (name, text, accountId) => ({ name, text, profile: profileOf(text), accountId, importId: 'imp-' + name });
const files = () => [item('fatura-jul', fatJul, 'cartao'), item('fatura-ago', fatAgo, 'cartao'), item('fatura-set', fatSet, 'cartao'), item('extrato', extrato, 'conta')];
const strip = list => list.map(t => JSON.stringify(t)).sort();

/** the single-file path, one file after the other (what the app did before v2.2) */
function oneByOne(existing, its) {
  let cur = existing.slice();
  for (const it of its) {
    const r = E.applyProfile(it.text, it.profile, { accountId: it.accountId, importId: it.importId });
    const dd = E.dedupe(cur, r.transactions);
    const ing = E.ingest(cur, dd.fresh.map(t => Object.assign({}, t, { importId: it.importId })), ctx);
    const ch = new Map(ing.changed.map(t => [t.id, t]));
    cur = cur.map(t => ch.get(t.id) || t).concat(ing.added);
  }
  return cur;
}

test('v2.2 batch: 3 consecutive faturas + 1 extrato in random order = one by one in date order', () => {
  const inDateOrder = files(); // extrato starts 01/07, then the faturas (each starts with its oldest purchase)
  const ordered = E.batchOrder(inDateOrder.map(it => { const ds = E.applyProfile(it.text, it.profile, { accountId: it.accountId }).transactions.map(t => t.date).sort(); return Object.assign({}, it, { from: ds[0], to: ds[ds.length - 1] }); }));
  const seq = oneByOne([], ordered);
  for (const perm of [[2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]]) {
    const its = files(); const shuffled = perm.map(i => its[i]);
    const b = E.importBatch([], shuffled, ctx);
    assert.deepEqual(strip(b.transactions), strip(seq), 'perm ' + perm);
    assert.deepEqual(b.results.map(r => r.name), ordered.map(o => o.name), 'imported oldest first');
  }
});

test('v2.2 batch: parcelas n and n+1 are not duplicates; identical tolls in one fatura are both kept; one result per file', () => {
  const b = E.importBatch([], files(), ctx);
  const parc = b.transactions.filter(t => /LOJA TESTE/.test(t.rawDescription)).map(t => t.installment.n + '@' + t.date).sort();
  assert.deepEqual(parc, ['3@2026-07-10', '4@2026-08-10', '5@2026-09-10'], 'each parcela in its own month');
  assert.equal(b.transactions.filter(t => /PEDAGIO/.test(t.rawDescription)).length, 2);
  assert.equal(b.results.length, 4);
  for (const r of b.results) assert.equal(r.duplicates.length, 0, r.name);
  assert.equal(new Set(b.transactions.map(t => t.importId)).size, 4);
  // fatura payments linked between the card and the bank: no spending, no income
  assert.ok(b.transactions.filter(t => /PAGAMENTO DE FATURA/i.test(t.rawDescription)).every(t => t.kind === 'card_payment'));
  // importing the same batch again: everything is a duplicate
  const again = E.importBatch(b.transactions, files(), ctx);
  assert.equal(again.addedIds.length, 0);
  assert.equal(again.results.reduce((s, r) => s + r.duplicates.length, 0), b.transactions.length);
  // one fatura already stored + the batch: only the others come in
  const stored = E.importBatch([], [files()[1]], ctx).transactions;
  const rest = E.importBatch(stored, files(), ctx);
  assert.equal(rest.results.find(r => r.name === 'fatura-ago').addedIds.length, 0);
  assert.equal(rest.transactions.length, b.transactions.length, 'same rows as importing all four');
});

test('v2.2 ingest = classify new rows + link card payments (the app path)', () => {
  const r = E.applyProfile(fatJul, profileOf(fatJul), { accountId: 'cartao', importId: 'i1' });
  const ing = E.ingest([], r.transactions, ctx);
  assert.equal(ing.added.length, r.transactions.length);
  assert.equal(ing.added.find(t => /NETFLIX/.test(t.rawDescription)).categoryId, 'lazer.streaming');
  assert.equal(ing.changed.length, 0);
});

// ------------------------------------------------------------------ periods
test('v2.2 periodOf: ISO weeks Mon–Sun, pt-BR labels', () => {
  assert.deepEqual(E.periodOf('2026-09-14', 'week'), { key: '2026-W38', label: 'S38', from: '2026-09-14', to: '2026-09-20', year: 2026 });
  assert.equal(E.periodOf('2026-09-20', 'week').key, '2026-W38', 'Sunday closes the week');
  assert.equal(E.periodOf('2027-01-01', 'week').key, '2026-W53', 'ISO year of the Thursday');
  assert.equal(E.periodOf('2026-09-14', 'month').label, 'set/26');
  assert.equal(E.periodOf('2026-09-14', 'quarter').label, 'T3/26');
  assert.equal(E.periodOf('2026-08-01', 'quarter').from, '2026-07-01');
  assert.equal(E.periodOf('2026-09-14', 'year').label, '2026');
});

// ------------------------------------------------------------------ categorySeries
let seq = 0;
const tx = (date, amount, categoryId, extra) => Object.assign({ id: 's' + (++seq), date, amount, rawDescription: 'X' + seq, merchant: 'X', accountId: 'cc',
  kind: amount < 0 ? 'expense' : 'income', categoryId, catSource: categoryId ? 'manual' : null }, extra || {});
const sample = () => [
  tx('2026-07-03', -10000, 'alimentacao.mercado'), tx('2026-07-10', -5000, 'transporte.app'), tx('2026-07-12', 2000, 'alimentacao.mercado', { kind: 'expense' }), // refund (estorno) nets out
  tx('2026-08-03', -20000, 'alimentacao.restaurante'), tx('2026-08-04', -3000, null), tx('2026-08-05', -4000, E.NAO_ID),
  tx('2026-08-10', -15000, 'transporte.combustivel', { installment: { n: 2, total: 3 }, originalDate: '2026-07-10' }),
  tx('2026-09-01', -7000, 'lazer.streaming'), tx('2026-09-02', 500000, 'renda.salario'),
  tx('2026-09-03', -100000, null, { kind: 'card_payment' }), tx('2026-09-04', -50000, null, { kind: 'transfer' }), tx('2026-09-05', -80000, 'investimentos.aplicacoes', { kind: 'investment' }),
  tx('2026-09-06', -1000, 'moradia.energia', { deleted: true })];

test('v2.2 categorySeries: months, groups, refunds net, parcelas in their month, only spending', () => {
  const r = E.categorySeries(sample(), { granularity: 'month', periods: 3, end: '2026-09', categories: E.DEFAULT_CATEGORIES });
  assert.deepEqual(r.periods.map(p => p.label), ['jul/26', 'ago/26', 'set/26']);
  const by = Object.fromEntries(r.series.map(s => [s.id, s.values]));
  assert.deepEqual(by.alimentacao, [8000, 20000, 0]);
  assert.deepEqual(by.transporte, [5000, 15000, 0], 'parcela 2/3 counts in August');
  assert.deepEqual(by.lazer, [0, 0, 7000]);
  assert.deepEqual(by[E.NAO_ID], [0, 4000, 0]);
  assert.deepEqual(by.__none, [0, 3000, 0]);
  assert.ok(!by.investimentos && !by.renda && !by.moradia, 'no income/investment/deleted');
  assert.deepEqual(r.periods.map(p => p.total), [13000, 42000, 7000]);
  assert.equal(r.series.find(s => s.id === E.NAO_ID).name, 'Não identificado');
  // taxonomy order, Não identificado + Sem categoria last
  assert.deepEqual(r.series.map(s => s.id), ['alimentacao', 'transporte', 'lazer', E.NAO_ID, '__none']);
  // totals agree with summarize
  const sum = E.summarize(sample(), { from: '2026-07-01', to: '2026-09-30' });
  assert.equal(r.periods.reduce((s, p) => s + p.total, 0), sum.expense);
});

test('v2.2 categorySeries: weeks, quarters, years, "tudo", category level, topN folding', () => {
  const w = E.categorySeries(sample(), { granularity: 'week', periods: 2, end: '2026-08-10' });
  assert.deepEqual(w.periods.map(p => p.label), ['S32', 'S33']);
  assert.deepEqual(w.periods.map(p => p.total), [27000, 15000]);
  const q = E.categorySeries(sample(), { granularity: 'quarter', periods: 'all', end: '2026-09-30' });
  assert.deepEqual(q.periods.map(p => p.label), ['T3/26']);
  assert.equal(q.periods[0].total, 62000);
  const y = E.categorySeries(sample(), { granularity: 'year', periods: 2, end: '2026-09-30' });
  assert.deepEqual(y.periods.map(p => p.label), ['2025', '2026']);
  const all = E.categorySeries(sample(), { granularity: 'month', periods: 'all' });
  assert.equal(all.periods[0].key, '2026-07');
  const cat = E.categorySeries(sample(), { level: 'category', groupId: 'alimentacao', periods: 3, end: '2026-09' });
  assert.deepEqual(cat.series.map(s => s.id), ['alimentacao.mercado', 'alimentacao.restaurante']);
  assert.deepEqual(cat.series.map(s => s.slot), [0, 1], 'stable slot = position among the group\'s children');
  // many groups → topN + Outros, pinned series never folded
  const many = E.DEFAULT_CATEGORIES.filter(g => g.kind === 'expense' && g.id !== 'outros').map((g, i) => tx('2026-09-10', -(1000 + i * 100), g.children[0].id));
  many.push(tx('2026-09-11', -50, E.NAO_ID));
  const f = E.categorySeries(many, { periods: 1, end: '2026-09', topN: 5 });
  assert.equal(f.series.length, 6);
  assert.ok(f.series.some(s => s.id === E.NAO_ID));
  const out = f.series[f.series.length - 1];
  assert.equal(out.id, '__outros');
  assert.equal(out.members.length, many.length - 1 - 4);
  assert.equal(f.periods[0].total, -many.reduce((s, t) => s + t.amount, 0), 'folding keeps the total');
  assert.equal(E.categorySeriesKey({ categoryId: 'alimentacao.mercado' }, {}), 'alimentacao');
  assert.equal(E.categorySeriesKey({ categoryId: null }, {}), '__none');
});

// ------------------------------------------------------------------ Não identificado
test('v2.2 Não identificado: built-in category, migration adds it, Sankey names it, data health counts it apart', () => {
  assert.ok(E.DEFAULT_CATEGORIES.find(g => g.id === 'outros').children.some(c => c.id === E.NAO_ID));
  assert.equal(E.kindForCategory(E.NAO_ID), 'expense');
  const old = E.DEFAULT_CATEGORIES.filter(g => g.id !== 'outros').map(g => JSON.parse(JSON.stringify(g)));
  const m = E.migrateData({ categories: old, txs: [], settings: { schemaVersion: 2 } });
  assert.ok(m.changedMeta.includes('categories'));
  const og = m.data.categories.find(g => g.id === 'outros');
  assert.ok(og && og.children[0].id === E.NAO_ID);
  assert.ok(m.data.categories.indexOf(og) < m.data.categories.findIndex(g => g.id === 'investimentos'), 'before income/investment groups');
  const again = E.migrateData(m.data);
  assert.ok(!again.changedMeta.includes('categories'), 'idempotent');
  // a user group "outros" without the child gets it, keeping the user's name/color
  const mine = E.ensureBuiltinCategories([{ id: 'outros', name: 'Diversos', color: '#123456', kind: 'expense', children: [{ id: 'outros.presente', name: 'Presente' }] }]);
  assert.equal(mine.changed, true);
  assert.equal(mine.categories[0].name, 'Diversos');
  assert.deepEqual(mine.categories[0].children.map(c => c.id), ['outros.presente', E.NAO_ID]);
  // Sankey
  const txs = [tx('2026-09-01', 300000, 'renda.salario'), tx('2026-09-02', -4000, E.NAO_ID), tx('2026-09-03', -1000, 'alimentacao.mercado')];
  const sk = E.buildSankey(txs, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(sk.nodes.find(n => n.id === 'grp:outros').name, 'Não identificado');
  // data health: not uncategorized; its own info note when large
  const hw = E.dataHealth({ transactions: [tx('2026-09-02', -4000, E.NAO_ID), tx('2026-09-03', -1000, 'alimentacao.mercado')], accounts: [], imports: {}, settings: {}, today: '2026-10-03' });
  assert.ok(!hw.some(w => w.id.startsWith('l:uncat:')));
  const u = hw.find(w => w.id === 'l:unid:2026-09');
  assert.ok(u && u.severity === 'info' && /80%/.test(u.title));
});
