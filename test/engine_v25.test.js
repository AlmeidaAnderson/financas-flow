'use strict';
// v2.5: money between the user's own accounts — isOwnName, counterparty, detectTransfers, owner-name candidates,
// migration (schema 3) + "Desfazer revisão", learned transfer rules, overview, data health. All data synthetic
// (people/companies below are made up).
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../site/engine.js');

let seq = 0;
const tx = (date, amount, raw, accountId, extra) => Object.assign({ id: 'r' + (++seq), date, amount, rawDescription: raw, merchant: raw, accountId,
  kind: amount < 0 ? 'expense' : 'income', categoryId: null, catSource: null, updatedAt: '2026-09-01T00:00:00.000Z' }, extra || {});
const ACC = [
  { id: 'card', name: 'Nubank Crédito', type: 'credit_card' },
  { id: 'roxo', name: 'Nubank Corrente', type: 'checking' },
  { id: 'azul', name: 'Mercado Pago Corrente', type: 'checking' },
  { id: 'wise', name: 'Wise', type: 'checking' }
];
const OWN = ['Fulana Beltrana de Tal'];
const byId = (r, id) => r.transactions.find(t => t.id === id);

test('isOwnName: accents/case, particles, truncated tokens, first name + one more, relatives and companies never', () => {
  const o = ['Fulana Beltrana de Tal'];
  assert.equal(E.isOwnName('FULANA BELTRANA DE TAL', o), true);
  assert.equal(E.isOwnName('Fulána de Tal', o), true, 'accents, particle "de" ignored');
  assert.equal(E.isOwnName('FULANA BELTR DE T', o), true, 'truncated column: BELTR is a prefix (≥ 4) of BELTRANA');
  assert.equal(E.isOwnName('FULA BELTRANA', o), true, 'truncated first name (prefix ≥ 4)');
  assert.equal(E.isOwnName('FUL BELTRANA', o), false, 'prefix of 3 letters is not enough');
  assert.equal(E.isOwnName('Tal Beltrana Fulana', o), false, 'the FIRST name has to match');
  assert.equal(E.isOwnName('Ciclano Beltrano de Tal', o), false, 'relative: same surname, other first name');
  assert.equal(E.isOwnName('Fulana', o), false, 'first name alone is not enough');
  assert.equal(E.isOwnName('Fulana Souza', o), false, 'first name + an unrelated surname');
  assert.equal(E.isOwnName('Fulana de Tal Ltda', o), false, 'a company never matches');
  assert.equal(E.isOwnName('FULANA DE TAL 12.345.678/0001-90', o), false, 'a CNPJ never matches');
  assert.equal(E.isOwnName('Fulana Tal', ['Fulana']), false, 'one-word owner names are ignored');
  assert.equal(E.isOwnName('fulana   tal', ['FULANA DA SILVA TAL', 'Outro Nome']), true, 'any of several names');
  assert.deepEqual(E.nameTokens('Maria das Dores e Souza'), ['MARIA', 'DORES', 'SOUZA']);
});

test('counterparty: ≥ 12 statement formats', () => {
  const cases = [
    ['Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - BCO SANTANDER (BRASIL) S.A. (0033) Agência: 1 Conta: 2', 'FULANA BELTRANA DE TAL', 'out', 'santander'],
    ['Transferência recebida pelo Pix - Ciclano da Silva - •••.111.222-•• - ITAÚ UNIBANCO S.A. (0341)', 'CICLANO DA SILVA', 'in', 'itau'],
    ['Transferência Recebida - Fulana Beltrana de Tal - •••.123.456-•• - NU PAGAMENTOS - IP (0260)', 'FULANA BELTRANA DE TAL', 'in', 'nubank'],
    ['Reembolso recebido pelo Pix - Ciclano da Silva - •••.111.222-•• - BANCO INTER (0077)', 'CICLANO DA SILVA', 'in', 'inter'],
    ['Pix enviado para Fulana de Tal', 'FULANA DE TAL', 'out', null],
    ['PIX RECEBIDO FULANA DE TAL 05/09', 'FULANA DE TAL', 'in', null],
    ['PIX REM: FULANA DE TAL', 'FULANA DE TAL', 'in', null],
    ['TRANSFERENCIA PIX DES: CICLANO SOUZA 05/09', 'CICLANO SOUZA', 'out', null],
    ['TED recebida de FULANA BELTRANA DE TAL', 'FULANA BELTRANA DE TAL', 'in', null],
    ['DOC ELET ENVIADO CICLANO SOUZA', 'CICLANO SOUZA', 'out', null],
    ['TEF ENVIADA PARA FULANA DE TAL', 'FULANA DE TAL', 'out', null],
    ['Recebeu dinheiro de Fulana Beltrana de Tal com a referência ""', 'FULANA BELTRANA DE TAL', 'in', null],
    ['Enviou dinheiro para FULANA DE TAL', 'FULANA DE TAL', 'out', null],
    ['Sent money to Fulana de Tal', 'FULANA DE TAL', 'out', null],
    ['Transferência Pix enviada Ciclano Souza', 'CICLANO SOUZA', 'out', null]
  ];
  for (const [raw, name, dir, bank] of cases) {
    const c = E.counterparty(raw);
    assert.ok(c, raw);
    assert.equal(c.name, name, raw);
    assert.equal(c.direction, dir, raw);
    assert.equal(c.bankKey || null, bank, raw);
    assert.equal(c.company, false, raw);
  }
  const co = E.counterparty('Transferência enviada pelo Pix - MERCADO PAGO INSTITUICAO DE PAGAMENTO LTDA - 10.573.521/0001-91 - MERCADO PAGO IP LTDA. (0323)');
  assert.equal(co.company, true); assert.equal(co.institution, 'mercadopago');
  assert.equal(E.counterparty('NETFLIX.COM'), null);
  assert.equal(E.counterparty('Compra no débito - PADARIA'), null);
});

test('parseConversion: "X BRL convertidos para Y USD" and English; words only → {}', () => {
  const c = E.parseConversion('1.082,22 BRL convertidos para 200,00 USD');
  assert.deepEqual(c, { from: { currency: 'BRL', amount: 108222 }, to: { currency: 'USD', amount: 20000 } });
  assert.deepEqual(E.parseConversion('Converted 50.00 USD to 270.10 BRL').to, { currency: 'BRL', amount: 27010 });
  assert.deepEqual(E.parseConversion('CAMBIO ENTRE CONTAS'), {});
  assert.equal(E.parseConversion('IOF CAMBIO COMPRA EXTERIOR'), null);
  assert.equal(E.parseConversion('PADARIA'), null);
});

function scenario() {
  seq = 0;
  const rows = {
    // a. pair across accounts (own name on one side), 1 day later, R$ 2 fee
    pOut: tx('2026-09-02', -100000, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - MERCADO PAGO IP LTDA. (0323)', 'roxo'),
    pIn: tx('2026-09-03', 99800, 'Pix recebido de Fulana B de Tal', 'azul'),
    // generic pair, bank of the other account named, same day
    gOut: tx('2026-09-10', -25000, 'Pix enviado - MERCADO PAGO', 'roxo'),
    gIn: tx('2026-09-10', 25000, 'Transferência recebida - NU PAGAMENTOS', 'azul'),
    // too far apart (9 days) — not paired
    farOut: tx('2026-09-12', -33300, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - MERCADO PAGO IP LTDA. (0323)', 'roxo'),
    farIn: tx('2026-09-21', 33300, 'Pix recebido de Fulana Beltrana de Tal', 'azul'),
    // third party: same amount, but an employer pays one and a friend receives the other
    salary: tx('2026-09-05', 500000, 'TED recebida de ACME TECNOLOGIA LTDA', 'azul', { categoryId: 'renda.salario', catSource: 'rule' }),
    friendOut: tx('2026-09-05', -500000, 'Pix enviado para Ciclano Souza', 'roxo'),
    // relative (same surname): stays an expense
    relative: tx('2026-09-07', -20000, 'Pix enviado para Ciclano Beltrano de Tal', 'roxo'),
    // own name, no pair (bank not in the app) → external
    extIn: tx('2026-09-15', 70000, 'Transferência Recebida - Fulana Beltrana de Tal - •••.123.456-•• - BCO SANTANDER (0033)', 'roxo'),
    // card payments: new wordings
    cp1: tx('2026-09-12', -40000, 'Débito por dívida Pagamento mínimo da fatura', 'azul'),
    cp2: tx('2026-09-13', -80000, 'Débito para pagar sua fatura Nubank', 'roxo'),
    // conversion inside the multi-currency account
    conv: tx('2026-09-08', -108222, '1.082,22 BRL convertidos para 200,00 USD', 'wise', { categoryId: 'compras.marketplace', catSource: 'dictionary' }),
    // investment move
    inv: tx('2026-09-09', -50000, 'Dinheiro reservado', 'azul'),
    invBack: tx('2026-09-20', 20000, 'Dinheiro retirado', 'azul'),
    // a manual expense in your own name: never flipped
    manual: tx('2026-09-18', -15000, 'Pix enviado para Fulana Beltrana de Tal', 'roxo', { categoryId: 'compras.presentes', catSource: 'manual' }),
    // real spending
    shop: tx('2026-09-11', -4590, 'PADARIA DO BAIRRO', 'roxo', { categoryId: 'alimentacao.padaria', catSource: 'dictionary' })
  };
  return rows;
}

test('detectTransfers: pairs (fee, days), own name → external, conversions, card payments, investments; third parties untouched', () => {
  const R = scenario();
  const list = Object.values(R);
  const r = E.detectTransfers(list, { accounts: ACC, ownerNames: OWN });
  const g = k => byId(r, R[k].id);
  // pair with fee
  assert.equal(g('pOut').kind, 'transfer'); assert.equal(g('pIn').kind, 'transfer');
  assert.equal(g('pOut').linkedTo, R.pIn.id); assert.equal(g('pIn').linkedTo, R.pOut.id);
  assert.equal(g('pOut').transferAccountId, 'azul'); assert.equal(g('pIn').transferAccountId, 'roxo');
  // generic pair: each side names the other account's bank
  assert.equal(g('gOut').kind, 'transfer'); assert.equal(g('gOut').linkedTo, R.gIn.id);
  // far apart: not a pair; both are your name → own transfers. The outflow names the bank of one of your accounts in
  // the app (corpus review) → that account, unlinked; the inflow names no bank → "Conta não cadastrada"
  assert.equal(g('farOut').linkedTo, undefined);
  assert.equal(g('farOut').transferAccountId, 'azul'); assert.equal(g('farIn').transferAccountId, 'external');
  // third parties
  assert.equal(g('salary').kind, 'income'); assert.equal(g('salary').categoryId, 'renda.salario');
  assert.equal(g('friendOut').kind, 'expense');
  assert.equal(g('relative').kind, 'expense');
  // own name, unpaired
  assert.equal(g('extIn').kind, 'transfer'); assert.equal(g('extIn').transferAccountId, 'external'); assert.equal(g('extIn').transferBank, 'santander');
  // card payments
  assert.equal(g('cp1').kind, 'card_payment'); assert.equal(g('cp2').kind, 'card_payment');
  assert.equal(g('cp2').cardAccountId, 'card', 'linked to the card of the bank it names');
  // conversion
  assert.equal(g('conv').kind, 'transfer'); assert.equal(g('conv').transferSubtype, 'conversion'); assert.equal(g('conv').categoryId, null);
  assert.equal(g('conv').fx.currency, 'USD'); assert.equal(g('conv').fx.amount, -20000);
  // investments
  assert.equal(g('inv').kind, 'investment'); assert.equal(g('invBack').kind, 'investment');
  // manual + real spending untouched
  assert.equal(g('manual').kind, 'expense'); assert.equal(g('manual').categoryId, 'compras.presentes');
  assert.equal(g('shop').kind, 'expense');
  assert.ok(!r.changes.some(c => [R.salary.id, R.friendOut.id, R.relative.id, R.manual.id, R.shop.id].includes(c.id)));
  assert.equal(r.counts.pair, 4); assert.equal(r.counts.own_name, 3); assert.equal(r.counts.conversion, 1);
  assert.equal(r.counts.card_payment, 2); assert.equal(r.counts.investment, 2);
  // every change keeps the fields it had before
  const c = r.changes.find(x => x.id === R.conv.id);
  assert.equal(c.prev.kind, 'expense'); assert.equal(c.prev.categoryId, 'compras.marketplace');
  // income / expense of the month: only the salary and the real spending (+ relative, friend, manual) remain
  const s0 = E.summarize(list, { from: '2026-09-01', to: '2026-09-30' });
  const s1 = E.summarize(r.transactions, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(s1.income, 500000);
  assert.ok(s1.income < s0.income && s1.expense < s0.expense);
  assert.equal(s1.expense, 500000 + 20000 + 15000 + 4590);
  // idempotent
  const r2 = E.detectTransfers(r.transactions, { accounts: ACC, ownerNames: OWN });
  assert.equal(r2.changes.length, 0);
});

test('detectTransfers without owner names: pairs/conversions/card payments still found; own-name rows left alone', () => {
  const R = scenario();
  const r = E.detectTransfers(Object.values(R), { accounts: ACC, settings: {} });
  assert.equal(byId(r, R.gOut.id).kind, 'transfer', 'pair by the other account\'s bank');
  assert.equal(byId(r, R.conv.id).transferSubtype, 'conversion');
  assert.equal(byId(r, R.cp1.id).kind, 'card_payment');
  assert.equal(byId(r, R.extIn.id).kind, 'income', 'no names → no own-name guess');
  assert.equal(byId(r, R.farIn.id).kind, 'income');
});

test('detectTransfers: medium confidence and ambiguity become suggestions; rejected keys never come back', () => {
  seq = 0;
  const a = tx('2026-09-02', -30000, 'Transferência enviada', 'roxo');
  const b = tx('2026-09-03', 30000, 'Transferência recebida', 'azul');
  let r = E.detectTransfers([a, b], { accounts: ACC, ownerNames: OWN });
  assert.equal(r.changes.length, 0, 'no names, no bank → not automatic');
  assert.equal(r.suggestions.length, 1); assert.equal(r.suggestions[0].type, 'pair'); assert.deepEqual(r.suggestions[0].ids.sort(), [a.id, b.id].sort());
  r = E.detectTransfers([a, b], { accounts: ACC, settings: { ownerNames: OWN, transferRejected: [r.suggestions[0].key] } });
  assert.equal(r.suggestions.length, 0, '"Não é transferência" sticks');
  // two equal candidates for one outflow → a suggestion, not a guess
  seq = 10;
  const o = tx('2026-09-02', -40000, 'Pix enviado para Fulana Beltrana de Tal', 'roxo');
  const i1 = tx('2026-09-03', 40000, 'Pix recebido de Fulana Beltrana de Tal', 'azul');
  const i2 = tx('2026-09-03', 40000, 'Recebeu dinheiro de Fulana Beltrana de Tal', 'wise');
  r = E.detectTransfers([o, i1, i2], { accounts: ACC, ownerNames: OWN });
  assert.equal(r.pairs.length, 0);
  assert.equal(r.suggestions.filter(s => s.type === 'pair').length, 1);
  // institution of one of your accounts as the counterparty, unpaired → suggestion
  seq = 20;
  const mp = tx('2026-09-02', -24680, 'Transferência enviada pelo Pix - MERCADO PAGO INSTITUICAO DE PAGAMENTO LTDA - 10.573.521/0001-91 - MERCADO PAGO IP LTDA. (0323)', 'roxo');
  r = E.detectTransfers([mp], { accounts: ACC, ownerNames: OWN });
  assert.equal(r.changes.length, 0);
  assert.equal(r.suggestions[0].type, 'institution'); assert.equal(r.suggestions[0].accountId, 'azul');
});

test('detectTransfers: foreign amounts pair within 3 %; manual choices win; card-account rows never paired', () => {
  seq = 0;
  const o = tx('2026-09-02', -108000, 'Pix enviado - WISE', 'roxo');
  const i = tx('2026-09-04', 105500, 'Recebeu dinheiro de NU PAGAMENTOS', 'wise', { fx: { currency: 'USD', amount: 19500 } });
  let r = E.detectTransfers([o, i], { accounts: ACC, ownerNames: OWN });
  assert.equal(r.pairs.length, 1, '2.3 % apart, FX → paired');
  seq = 5;
  const o2 = tx('2026-09-02', -108000, 'Pix enviado - WISE', 'roxo');
  const i2 = tx('2026-09-04', 100000, 'Recebeu dinheiro de NU PAGAMENTOS', 'wise', { fx: { currency: 'USD', amount: 18500 } });
  r = E.detectTransfers([o2, i2], { accounts: ACC, ownerNames: OWN });
  assert.equal(r.pairs.length, 0, '7 % apart → not a pair');
  // manual: the user said "income" — stays
  seq = 10;
  const mo = tx('2026-09-02', -50000, 'Pix enviado para Fulana Beltrana de Tal', 'roxo');
  const mi = tx('2026-09-02', 50000, 'Pix recebido de Fulana Beltrana de Tal', 'azul', { categoryId: 'renda.outros', catSource: 'manual' });
  r = E.detectTransfers([mo, mi], { accounts: ACC, ownerNames: OWN });
  assert.equal(byId(r, mi.id).kind, 'income');
  assert.equal(byId(r, mo.id).transferAccountId, 'external', 'the other side alone → own transfer to an account not in the app');
  // a card account's rows are not transfers
  seq = 20;
  const co = tx('2026-09-02', -9900, 'Pix enviado - MERCADO PAGO', 'roxo');
  const ci = tx('2026-09-02', 9900, 'ESTORNO MERCADO PAGO', 'card');
  r = E.detectTransfers([co, ci], { accounts: ACC, ownerNames: OWN });
  assert.equal(r.pairs.length, 0);
});

test('migrateData → schema 3: review stored, idempotent, "Desfazer revisão" restores the previous kinds', () => {
  const R = scenario();
  const input = { settings: { budgets: {}, schemaVersion: 2, ownerNames: OWN }, accounts: ACC, txs: Object.values(R), imports: {} };
  const m = E.migrateData(input, { now: '2026-10-01T00:00:00.000Z' });
  assert.equal(m.data.settings.schemaVersion, 3);
  const rv = m.data.settings.transferReview;
  assert.ok(rv && rv.changes.length >= 10);
  assert.equal(rv.rows.own_name, 3); assert.equal(rv.rows.conversion, 1);
  const conv = m.data.txs.find(t => t.id === R.conv.id);
  assert.equal(conv.kind, 'transfer'); assert.equal(conv.updatedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(m.data.txs.find(t => t.id === R.manual.id).kind, 'expense');
  // second run: nothing changes
  const m2 = E.migrateData(m.data, { now: '2026-10-02T00:00:00.000Z' });
  assert.equal(m2.report.transferChanges, undefined, 'the review runs once');
  const k1 = new Map(m.data.txs.map(t => [t.id, t.kind + '|' + (t.linkedTo || '') + '|' + (t.transferAccountId || '')]));
  assert.ok(m2.data.txs.every(t => k1.get(t.id) === t.kind + '|' + (t.linkedTo || '') + '|' + (t.transferAccountId || '')), 'second run: no kind/link changes');
  assert.equal(m2.data.settings.transferReview.at, '2026-10-01T00:00:00.000Z');
  // undo
  const back = E.undoTransferChanges(m.data.txs, rv.changes);
  const b = back.find(t => t.id === R.conv.id);
  // back to what it was right before the review (the dictionary pass of the same migration runs first)
  const prevConv = rv.changes.find(c => c.id === R.conv.id).prev;
  assert.equal(b.kind, 'expense'); assert.equal(b.categoryId || null, prevConv.categoryId); assert.equal(b.transferSubtype, undefined);
  const p = back.find(t => t.id === R.pOut.id);
  assert.equal(p.kind, 'expense'); assert.equal(p.linkedTo, undefined);
  // without owner names: pairs / conversions / card payments only
  const m3 = E.migrateData({ settings: { budgets: {}, schemaVersion: 2 }, accounts: ACC, txs: Object.values(scenario()), imports: {} }, { now: '2026-10-01T00:00:00.000Z' });
  assert.ok(!m3.data.settings.transferReview.rows.own_name);
  assert.equal(m3.data.settings.transferReview.rows.conversion, 1);
});

test('ownerNameCandidates: variants grouped by first name + surname, relatives apart, holder pre-ticks; never automatic', () => {
  seq = 0;
  const rows = [
    tx('2026-09-02', -10000, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - BCO SANTANDER (0033)', 'roxo'),
    tx('2026-09-03', 10000, 'Recebeu dinheiro de Fulana de Tal com a referência ""', 'wise'),
    tx('2026-09-04', -5000, 'Enviou dinheiro para FULANA B DE TAL', 'wise'),
    tx('2026-09-05', 7000, 'Transferência Recebida - Fulana Beltrana de Tal - •••.123.456-•• - BCO SANTANDER (0033)', 'roxo'),
    tx('2026-09-06', -3000, 'Pix enviado para Ciclano Beltrano de Tal', 'roxo'),
    tx('2026-09-07', -3000, 'Pix enviado para Ciclano Beltrano de Tal', 'roxo'),
    tx('2026-09-08', 3000, 'Pix recebido de Ciclano Beltrano de Tal', 'roxo'),
    tx('2026-09-09', -2000, 'Pix enviado para ACME COMERCIO LTDA', 'roxo')
  ];
  const c = E.ownerNameCandidates(rows, { accounts: ACC });
  assert.ok(c.length >= 1);
  assert.match(c[0].name, /^Fulana/);
  assert.equal(c[0].count, 4); assert.equal(c[0].accounts, 2);
  assert.equal(c[0].suggested, true);
  assert.ok(c[0].variants.length >= 2);
  const rel = c.find(x => /^Ciclano/.test(x.name));
  assert.ok(!rel || !rel.suggested, 'a relative is never pre-ticked');
  assert.ok(!c.some(x => /ACME/i.test(x.name)), 'companies never');
  // a PDF holder name wins the pre-tick
  const c2 = E.ownerNameCandidates(rows, { accounts: ACC, imports: { i1: { holderName: 'CICLANO BELTRANO DE TAL' } } });
  assert.equal(c2.find(x => /^Ciclano/.test(x.name)).holder, true);
  // dismissed / confirmed names are not offered again
  const c3 = E.ownerNameCandidates(rows, { accounts: ACC, settings: { ownerNames: ['Fulana Beltrana de Tal'], ownerNamesDismissed: [rel ? rel.key : 'x'] } });
  assert.ok(!c3.some(x => /^Fulana/.test(x.name)));
  // the input is not changed
  assert.ok(rows.every(t => t.kind !== 'transfer'));
});

test('learnTransferRule ("Lembrar"): the counterparty becomes a transfer rule that classify follows', () => {
  seq = 0;
  const t = tx('2026-09-02', -10000, 'Pix enviado para Fulana Beltrana de Tal', 'roxo');
  const r = E.learnTransferRule(t, [], { now: '2026-09-02T00:00:00.000Z', transferAccountId: 'azul' });
  assert.ok(r.created); assert.equal(r.created.set.kind, 'transfer'); assert.equal(r.created.transferAccountId, 'azul');
  assert.equal(E.learnTransferRule(t, r.rules).created, null, 'once');
  const c = E.classify(tx('2026-09-20', -5000, 'PIX ENVIADO PARA FULANA BELTRANA DE TAL', 'roxo'), { rules: r.rules });
  assert.equal(c.kind, 'transfer'); assert.equal(c.categoryId, null);
  assert.equal(E.learnTransferRule(tx('2026-09-02', -100, 'NETFLIX', 'roxo'), []).created, null, 'no counterparty → no rule');
});

test('transferOverview: pairs, flows, external own transfers and conversions; the month total', () => {
  const R = scenario();
  const r = E.detectTransfers(Object.values(R), { accounts: ACC, ownerNames: OWN });
  const ov = E.transferOverview(r.transactions, { accounts: ACC, ownerNames: OWN, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(ov.pairs.length, 2);
  assert.equal(ov.flows[0].from, 'roxo'); assert.equal(ov.flows[0].to, 'azul'); assert.equal(ov.flows[0].amount, 125000);
  assert.equal(ov.conversions.length, 1);
  assert.ok(ov.external.some(g => g.bank === 'santander' && g.in === 70000));
  assert.equal(ov.total, 125000 + 70000 + 33300 + 33300);
});

test('ingest: a new extrato completes a pair left open before', () => {
  seq = 0;
  const out = tx('2026-09-02', -100000, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - MERCADO PAGO IP LTDA. (0323)', 'roxo', { kind: 'transfer', transferAccountId: 'external', transferSource: 'auto' });
  const fresh = [tx('2026-09-02', 100000, 'Pix recebido de Fulana Beltrana de Tal', 'azul')];
  const res = E.ingest([out], fresh, { accounts: ACC, settings: { ownerNames: OWN } });
  assert.equal(res.added[0].kind, 'transfer'); assert.equal(res.added[0].linkedTo, out.id);
  assert.equal(res.changed[0].id, out.id); assert.equal(res.changed[0].transferAccountId, 'azul');
});

test('dataHealth: "Transferência sem entrada correspondente" only when the receiving account covers the days; extrato inside a card flagged', () => {
  seq = 0;
  const accounts = ACC;
  const rows = [
    tx('2026-09-02', -100000, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - MERCADO PAGO IP LTDA. (0323)', 'roxo', { kind: 'transfer', transferAccountId: 'azul', importId: 'i-roxo' }),
    tx('2026-08-28', 10, 'Rendimentos', 'azul', { importId: 'i-azul' }),
    tx('2026-09-20', 10, 'Rendimentos', 'azul', { importId: 'i-azul' })
  ];
  let h = E.dataHealth({ transactions: rows, accounts, imports: {}, settings: { ownerNames: OWN }, today: '2026-10-05' });
  const m = h.filter(w => /^m:nopair/.test(w.id));
  assert.equal(m.length, 1); assert.equal(m[0].title, 'Transferência sem entrada correspondente');
  // the receiving account's rows stop before → nothing to say
  h = E.dataHealth({ transactions: rows.slice(0, 2), accounts, imports: {}, settings: { ownerNames: OWN }, today: '2026-10-05' });
  assert.equal(h.filter(w => /^m:nopair/.test(w.id)).length, 0);
  // paired → nothing
  const inn = tx('2026-09-03', 100000, 'Pix recebido', 'azul', { kind: 'transfer', linkedTo: rows[0].id, importId: 'i-azul' });
  const paired = [Object.assign({}, rows[0], { linkedTo: inn.id }), rows[1], rows[2], inn];
  h = E.dataHealth({ transactions: paired, accounts, imports: {}, settings: { ownerNames: OWN }, today: '2026-10-05' });
  assert.equal(h.filter(w => /^m:nopair/.test(w.id)).length, 0);
  // a bank statement (salary + bare names, no Pix words, no balance) imported into the card account → flagged
  seq = 100;
  const ext = [
    tx('2026-07-05', 900000, 'Acme Consultoria em Tecnologia Ltda', 'card', { importId: 'i-bad', categoryId: 'renda.salario', catSource: 'rule' }),
    tx('2026-08-05', 900000, 'Acme Consultoria em Tecnologia Ltda', 'card', { importId: 'i-bad', categoryId: 'renda.salario', catSource: 'rule' }),
    tx('2026-08-07', -300000, 'Fulana Beltrana de Tal', 'card', { importId: 'i-bad' }),
    tx('2026-08-09', 12000, 'Ciclano Souza', 'card', { importId: 'i-bad' }),
    tx('2026-08-10', -5000, 'Padaria do Bairro', 'card', { importId: 'i-bad' })
  ];
  const fat = [tx('2026-08-03', -5000, 'MERCADO A', 'card', { importId: 'i-fat', installment: { n: 1, total: 3 } }), tx('2026-08-04', -6000, 'MERCADO B', 'card', { importId: 'i-fat' }),
    tx('2026-08-05', -7000, 'MERCADO C', 'card', { importId: 'i-fat' }), tx('2026-08-06', -8000, 'LOJA D', 'card', { importId: 'i-fat' }), tx('2026-08-07', -9000, 'LOJA E', 'card', { importId: 'i-fat' })];
  h = E.dataHealth({ transactions: ext.concat(fat), accounts, imports: { 'i-bad': { id: 'i-bad', fileName: 'Extrato_2026-07-01_a_2026-08-31.xlsx', accountId: 'card' }, 'i-fat': { id: 'i-fat', fileName: 'fatura-ago.csv', accountId: 'card' } }, settings: {}, today: '2026-10-05' });
  const b = h.find(w => w.id === 'b:extrato-in-card:i-bad');
  assert.ok(b, 'extrato in the card flagged'); assert.equal(b.action.type, 'move-import');
  assert.ok(!h.some(w => w.id === 'b:extrato-in-card:i-fat'));
  // even without the file name telling it
  h = E.dataHealth({ transactions: ext.concat(fat), accounts, imports: { 'i-bad': { id: 'i-bad', fileName: 'arquivo.xlsx', accountId: 'card' } }, settings: {}, today: '2026-10-05' });
  assert.ok(h.some(w => w.id === 'b:extrato-in-card:i-bad'));
});

test('import keeps who paid/received, the transaction type and currency exchange (Wise-like CSV, made-up data)', () => {
  const csv = [
    '"TransferWise ID",Date,Amount,Currency,Description,"Running Balance","Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name","Payee Account Number","Card Holder Full Name","Exchange To Amount","Transaction Type","Transaction Details Type"',
    'BALANCE-1,09-09-2026,-45.63,BRL,"45,63 BRL convertidos para 57,60 CNY",959.01,BRL,CNY,1.31479,,,,,57.60,DEBIT,CONVERSION',
    'TRANSFER-2,08-09-2026,620.53,BRL,"Recebeu dinheiro de Fulana Beltrana de Tal com a referência """"",1004.64,,,,Fulana Beltrana de Tal,,,,,CREDIT,DEPOSIT',
    'TRANSFER-3,07-09-2026,-100.00,BRL,"Enviou dinheiro para ACME PIZZA LTDA",384.11,,,,,ACME PIZZA LTDA,123,,,DEBIT,TRANSFER',
    'CARD-4,06-09-2026,-12.00,BRL,"Transação por cartão",484.11,,,,,,,FULANA B DE TAL,,DEBIT,CARD'
  ].join('\n');
  const a = E.analyzeTable(csv);
  const role = h => (a.columns.find(c => c.header === h) || {}).role;
  assert.equal(role('Payer Name'), 'payer'); assert.equal(role('Payee Name'), 'payee');
  assert.equal(role('Exchange From'), 'fxFrom'); assert.equal(role('Exchange To'), 'fxTo'); assert.equal(role('Exchange To Amount'), 'fxToAmount');
  assert.equal(role('Transaction Details Type'), 'txType'); assert.equal(role('Card Holder Full Name'), 'holder');
  assert.equal(role('Amount'), 'amount'); assert.equal(role('Description'), 'description', 'amount/description untouched');
  const p = E.profileFromAnalysis(a);
  const r = E.applyProfile(csv, p, { accountId: 'wise', importId: 'i1' });
  const [conv, dep, pay] = r.transactions;
  assert.deepEqual(conv.exchange, { from: 'BRL', to: 'CNY', toAmount: 5760, rate: 1.31479 }, 'cents, like every amount');
  assert.equal(conv.txType, 'CONVERSION');
  assert.equal(dep.counterparty, 'Fulana Beltrana de Tal', 'money in → the payer');
  assert.equal(pay.counterparty, 'ACME PIZZA LTDA', 'money out → the payee');
  assert.equal(r.holder, 'FULANA B DE TAL');
  assert.equal(E.importHolder(a, r), 'FULANA B DE TAL');
  // the conversion is found by its columns too, and the ids do not depend on the new fields
  const cv = E.conversionOf(Object.assign({}, conv, { rawDescription: 'Conversão' }));
  assert.equal(cv.from.currency, 'BRL'); assert.equal(cv.to.currency, 'CNY'); assert.equal(cv.to.amount, 5760);
  const old = Object.assign({}, p, { columns: { date: p.columns.date, amount: p.columns.amount, description: p.columns.description } });
  assert.equal(E.applyProfile(csv, old, { accountId: 'wise', importId: 'i1' }).transactions[0].id, conv.id);
  // a layout saved before v2.5 adopts the new columns (never one it already uses)
  const ad = E.adoptInfoColumns(old, a);
  assert.ok(ad.added.includes('payer') && ad.added.includes('fxFrom') && ad.added.includes('txType'));
  assert.equal(E.adoptInfoColumns(ad.profile, a).added.length, 0);
  // counterparty from the column, detectTransfers with names
  assert.equal(E.counterparty(dep).name, 'FULANA BELTRANA DE TAL');
  assert.equal(E.counterparty(pay).company, true);
  const dt = E.detectTransfers(r.transactions, { accounts: ACC, ownerNames: OWN });
  assert.equal(dt.transactions[0].transferSubtype, 'conversion');
  assert.equal(dt.transactions[1].transferAccountId, 'external');
  assert.equal(dt.transactions[2].kind, 'expense');
});

test('a bank\'s "Transação" column next to a name-only description ("Pix enviado" | NAME) + "Cliente:" holder line', () => {
  const rows = [
    ['', 'Extrato de conta corrente'], [], ['', 'Cliente:', 'Fulana Beltrana De Tal'], ['', 'CPF:', '000.000.000-00'], [],
    ['', 'Data e hora', 'Categoria', 'Transação', 'Descrição', 'Valor'],
    ['', '05/09/2026 10:00', 'Transferência', 'Pix enviado', 'Fulana Beltrana De Tal', '-7801.47'],
    ['', '05/09/2026 12:00', 'Salário', 'Pagamento de salário', 'Acme Consultoria Ltda', '2590.16'],
    ['', '06/09/2026 09:00', 'Transferência', 'Pix enviado', 'Ciclano Beltrano De Tal', '-120.00'],
    ['', '07/09/2026 09:00', 'Transporte', 'Pix enviado', 'Posto Avenida', '-80.00']
  ];
  const a = E.analyzeRows(rows);
  assert.equal(a.holder, 'Fulana Beltrana De Tal');
  assert.equal((a.columns.find(c => c.header === 'Transação') || {}).role, 'txType');
  assert.equal((a.columns.find(c => c.header === 'Descrição') || {}).role, 'description');
  const r = E.applyProfile(rows, E.profileFromAnalysis(a), { accountId: 'roxo', importId: 'b1' });
  const own = r.transactions[0];
  assert.equal(own.txType, 'Pix enviado');
  assert.equal(own.rawDescription, 'Fulana Beltrana De Tal', 'the description stays as it was');
  const c = E.counterparty(own);
  assert.equal(c.name, 'FULANA BELTRANA DE TAL'); assert.equal(c.direction, 'out'); assert.equal(c.via, 'pix');
  const dt = E.detectTransfers(r.transactions, { accounts: ACC, ownerNames: OWN });
  assert.equal(dt.transactions[0].kind, 'transfer');
  assert.equal(dt.transactions[1].kind, 'income', 'salary');
  assert.equal(dt.transactions[2].kind, 'expense', 'relative');
  assert.equal(dt.transactions[3].kind, 'expense', 'a station paid by Pix');
  // the holder pre-ticks the candidate
  const cand = E.ownerNameCandidates(r.transactions.concat([tx('2026-09-09', 5000, 'Pix recebido de Fulana Beltrana de Tal', 'azul')]), { accounts: ACC, imports: { b1: { holderName: a.holder } } });
  assert.ok(cand[0].holder && cand[0].suggested);
});

test('the same person on both sides: without your names only an exact amount within 0–2 days pairs; with names, a third party never', () => {
  seq = 0;
  const o = tx('2026-09-12', -3985, 'Pix enviado para Beltrano Souza', 'azul');
  const i = tx('2026-09-11', 3938, 'Transferência recebida pelo Pix - BELTRANO SOUZA - •••.111.222-•• - BCO SANTANDER (0033)', 'roxo');
  let r = E.detectTransfers([o, i], { accounts: ACC, settings: {} });
  assert.equal(r.pairs.length, 0, 'a friend paid back — different amount, earlier');
  seq = 5;
  const o2 = tx('2026-09-12', -357911, 'Pix enviado para Fulana Beltrana de Tal', 'azul');
  const i2 = tx('2026-09-12', 357911, 'Pix recebido de Fulana Beltrana de Tal', 'roxo');
  r = E.detectTransfers([o2, i2], { accounts: ACC, settings: {} });
  assert.equal(r.pairs.length, 1, 'same name both sides, same amount, same day → your own transfer');
  r = E.detectTransfers([o2, i2], { accounts: ACC, ownerNames: ['Outra Pessoa da Silva'] });
  assert.equal(r.pairs.length, 0, 'with your names known, someone else on both sides is a third party');
});
