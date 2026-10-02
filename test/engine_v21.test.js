'use strict';
// v2.1: CNPJ/CNAE help, installment-series memory, deficit carry-over, Sankey carry, data health. All data synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../site/engine.js');

let seq = 0;
const tx = (date, amount, raw, extra) => Object.assign({ id: 't' + (++seq), date, amount, rawDescription: raw, merchant: E.normalizeDescription(raw).merchant,
  accountId: 'cc', kind: amount < 0 ? 'expense' : 'income', categoryId: null, catSource: null, importId: 'imp1' }, extra || {});
const hubBalanced = g => {
  const inn = g.links.filter(l => l.target === 'hub').reduce((s, l) => s + l.value, 0);
  const out = g.links.filter(l => l.source === 'hub').reduce((s, l) => s + l.value, 0);
  return Math.abs(inn - out) <= 1;
};

// ---------------------------------------------------------------- feature 1: CNPJ / CNAE
test('v2.1 CNPJ: check digits, formatted or 14 digits inside a description', () => {
  assert.equal(E.validCNPJ('11222333000181'), true);
  assert.equal(E.validCNPJ('11.222.333/0001-81'), true);
  assert.equal(E.validCNPJ('11222333000180'), false);
  assert.equal(E.validCNPJ('00000000000000'), false);
  assert.equal(E.validCNPJ('1122233300018'), false);
  assert.equal(E.findCNPJ('PAGTO BOLETO DROGARIA X 11.222.333/0001-81 SP'), '11222333000181');
  assert.equal(E.findCNPJ('PIX ENVIADO 11222333000181 LOJA'), '11222333000181');
  assert.equal(E.findCNPJ('COMPRA 11222333000180'), null, 'invalid check digits are not a CNPJ');
  assert.equal(E.findCNPJ('IFOOD *RESTAURANTE 12345'), null);
  assert.equal(E.findCNPJ('CPF 123.456.789-09'), null);
  assert.equal(E.formatCNPJ('11222333000181'), '11.222.333/0001-81');
});

test('v2.1 searchQuery: merchant + city when the raw description has one', () => {
  assert.equal(E.searchQuery({ rawDescription: 'PADARIA SAO JORGE 123 SAO PAULO BR', merchant: 'PADARIA SAO JORGE' }), 'PADARIA SAO JORGE SAO PAULO');
  assert.equal(E.searchQuery({ rawDescription: 'SUMUP *BAR DO ZECA' }), 'BAR DO ZECA');
  assert.equal(E.searchQuery({ rawDescription: 'NETFLIX.COM INTERNET', merchant: 'NETFLIX.COM' }), 'NETFLIX.COM');
});

test('v2.1 suggestFromCNAE: code formats, pasted text/JSON, most specific prefix wins, never auto-assigns', () => {
  const s = x => { const r = E.suggestFromCNAE(x); return r && r.categoryId; };
  for (const v of ['4771-7/01', '47.71-7-01', '4771701', '4771-7', '47.71-7/01', 'CNAE principal: 4771-7/01 - Comércio varejista de produtos farmacêuticos']) assert.equal(s(v), 'saude.farmacia', v);
  assert.equal(E.suggestFromCNAE('4771-7/01').code, '4771-7/01');
  assert.equal(s('5611-2/01'), 'alimentacao.restaurante');
  assert.equal(s('5611-2/04'), 'lazer.bares', 'subclass beats the division 56');
  assert.equal(s('5620-1/02'), 'alimentacao.restaurante', 'division 56 fallback');
  assert.ok(E.suggestFromCNAE('5611204').confidence > E.suggestFromCNAE('5620102').confidence);
  assert.equal(s('{"cnpj":"11222333000181","cnae_fiscal":4711302,"cnae_fiscal_descricao":"Comércio varejista de mercadorias em geral - supermercados","cep":"01001000"}'), 'alimentacao.mercado');
  assert.equal(s('"cnae_fiscal": 9313100, "cnae_fiscal_descricao": "Atividades de condicionamento físico"'), 'saude.academia');
  assert.equal(s('Comércio varejista de mercadorias em geral, com predominância de produtos alimentícios - supermercados'), 'alimentacao.mercado');
  assert.equal(s('Restaurantes e similares'), 'alimentacao.restaurante');
  assert.equal(E.suggestFromCNAE('Restaurantes e similares').confidence, 0.5);
  assert.equal(E.suggestFromCNAE('xyz'), null);
  assert.equal(E.suggestFromCNAE(''), null);
  assert.equal(E.suggestFromCNAE('0111-3/01'), null, 'agriculture: no mapping, no guess');
  const expect = {
    '4711-3/02': 'alimentacao.mercado', '4712-1/00': 'alimentacao.mercado', '4721-1/02': 'alimentacao.padaria', '4722-9/01': 'alimentacao.mercado', '4724-5/00': 'alimentacao.mercado',
    '4772-5/00': 'pessoal.beleza', '4731-8/00': 'transporte.combustivel', '4923-0/01': 'transporte.app', '4921-3/01': 'transporte.publico', '4922-1/01': 'transporte.publico',
    '5223-1/00': 'transporte.estacionamento', '4520-0/01': 'transporte.manutencao', '4530-7/03': 'transporte.manutencao', '8630-5/03': 'saude.consultas', '8513-9/00': 'educacao.escola',
    '9313-1/00': 'saude.academia', '9329-8/99': 'lazer.eventos', '9001-9/01': 'lazer.eventos', '5914-6/00': 'lazer.eventos', '4781-4/00': 'compras.vestuario', '4782-2/01': 'compras.vestuario',
    '4753-9/00': 'compras.eletronicos', '4754-7/01': 'compras.casa', '4744-0/01': 'moradia.manutencao', '4761-0/01': 'educacao.livros', '4762-8/00': 'educacao.livros',
    '9602-5/01': 'pessoal.beleza', '7500-1/00': 'pessoal.pets', '4789-0/04': 'pessoal.pets', '6110-8/01': 'servicos.telefone', '3514-0/00': 'moradia.energia', '3600-6/01': 'moradia.agua',
    '6422-1/00': 'servicos.bancos', '6511-1/01': 'servicos.seguros', '6619-3/99': 'servicos.bancos', '7911-2/00': 'lazer.viagem', '5510-8/01': 'lazer.viagem', '6201-5/01': 'servicos.software', '6319-4/00': 'servicos.software'
  };
  for (const [code, cat] of Object.entries(expect)) assert.equal(s(code), cat, code);
  assert.ok(Object.keys(E.CNAE_MAP).length >= 40);
  for (const v of Object.values(E.CNAE_MAP)) assert.ok(E.DEFAULT_CATEGORIES.some(g => g.children.some(c => c.id === v.categoryId)), v.categoryId);
});

// ---------------------------------------------------------------- feature 2: installment series
test('v2.1 series: remembering one purchase on an ambiguous marketplace — only that series inherits', () => {
  // Mercado-Livre-like: two different purchases on the same (ambiguous) merchant, both in 10x
  const a = [1, 2, 3].map(n => tx(E.shiftDateMonths('2026-06-10', n - 1), -15000, 'MERCADOLIVRE*VENDEDOR', { installment: { n, total: 10 }, originalDate: n > 1 ? '2026-06-10' : undefined }));
  const b = [1, 2].map(n => tx(E.shiftDateMonths('2026-07-03', n - 1), -8990, 'MERCADOLIVRE*VENDEDOR', { installment: { n, total: 10 }, originalDate: n > 1 ? '2026-07-03' : undefined }));
  const all = a.concat(b);
  for (const t of all) assert.equal(E.classify(t, {}).categoryId, null, 'ambiguous: nothing by itself');
  const s1 = E.installmentSeries(a[1]);
  assert.equal(s1.start, '2026-06-10');
  assert.equal(E.installmentSeries(a[0]).key, s1.key, 'n=1 (no originalDate) has the same key as the later parcelas');
  const r = E.rememberInstallmentSeries(a[1], 'compras.eletronicos', [], { now: '2026-09-01T00:00:00Z' });
  assert.ok(r.created);
  assert.equal(r.created.origin, 'installment');
  assert.equal(r.created.expiresAfter, '2027-03', 'month of the 10th parcela');
  assert.equal(r.created.updatedAt, '2026-09-01T00:00:00Z');
  const ctx = { rules: r.rules };
  for (const t of a) { const c = E.classify(t, ctx); assert.equal(c.categoryId, 'compras.eletronicos'); assert.equal(c.catSource, 'series'); assert.equal(c.kind, 'expense'); }
  for (const t of b) assert.equal(E.classify(t, ctx).categoryId, null, 'the other purchase does not inherit');
  // a future import of parcela 4 of the same purchase is classified automatically (±1 cent tolerated)
  const p4 = tx('2026-09-10', -15001, 'MERCADOLIVRE*VENDEDOR', { installment: { n: 4, total: 10 }, originalDate: '2026-06-10' });
  assert.equal(E.classify(p4, ctx).categoryId, 'compras.eletronicos');
  assert.equal(E.classify(Object.assign({}, p4, { amount: -15003 }), ctx).categoryId, null, 'more than 1 cent away: another purchase');
  // same rule again: unchanged; another category: updated in place
  assert.equal(E.rememberInstallmentSeries(a[2], 'compras.eletronicos', r.rules).created, null);
  const r2 = E.rememberInstallmentSeries(a[2], 'compras.casa', r.rules);
  assert.equal(r2.rules.length, 1); assert.equal(r2.rules[0].set.categoryId, 'compras.casa');
});

test('v2.1 series: priority manual > installment series > user rules > learned > dictionary; pruning', () => {
  const p = tx('2026-08-05', -20000, 'MAGALU PARCELA 2/6', { installment: { n: 2, total: 6 }, originalDate: '2026-07-05' });
  const user = { id: 'u1', origin: 'user', priority: 100, match: { field: 'merchant', op: 'contains', value: 'MAGALU' }, set: { categoryId: 'compras.casa' } };
  const learned = { id: 'l1', origin: 'learned', match: { field: 'merchant', op: 'equals', value: p.merchant }, set: { categoryId: 'compras.presentes' } };
  const series = E.rememberInstallmentSeries(p, 'compras.eletronicos', []).created;
  assert.equal(E.classify(p, { rules: [learned] }).categoryId, 'compras.presentes');
  assert.equal(E.classify(p, { rules: [learned, user] }).categoryId, 'compras.casa');
  assert.equal(E.classify(p, { rules: [learned, user, series] }).categoryId, 'compras.eletronicos');
  assert.equal(E.classify(Object.assign({}, p, { catSource: 'manual', categoryId: 'lazer.jogos' }), { rules: [series] }).categoryId, 'lazer.jogos', 'manual wins');
  assert.equal(E.classify(Object.assign({}, p, { installment: null }), { rules: [series] }).categoryId, null, 'not a parcela: series rules do not apply');
  const pr = E.pruneSeriesRules([series, user], '2026-12');
  assert.equal(pr.removed, 0);
  const pr2 = E.pruneSeriesRules([series, user], '2027-01');
  assert.equal(pr2.removed, 1); assert.deepEqual(pr2.rules, [user]);
});

// ---------------------------------------------------------------- feature 3: carry-over + Sankey
test('v2.1 carryover: deficit chain, repayment, excluded months pass through, coverage, no double counting', () => {
  const accounts = [{ id: 'cc', type: 'checking' }, { id: 'card', type: 'credit_card' }];
  const T = [
    tx('2026-01-05', 500000, 'SALARIO ACME', { kind: 'income', categoryId: 'renda.salario' }),
    tx('2026-01-10', -300000, 'ALUGUEL', { categoryId: 'moradia.aluguel' }),
    tx('2026-01-15', -400000, 'LOJA X', { accountId: 'card' }),               // Jan: net -200000
    tx('2026-01-20', 50000, 'RESGATE CDB', { kind: 'investment' }),          // redemption covers part of it
    tx('2026-01-25', -999999, 'PAGAMENTO FATURA', { kind: 'card_payment' }), // never counted
    tx('2026-01-26', -777777, 'TRANSF ENTRE CONTAS', { kind: 'transfer' }),
    tx('2026-02-05', 500000, 'SALARIO ACME', { kind: 'income' }),
    tx('2026-02-10', -350000, 'ALUGUEL'),                                     // Feb: +150000 → repays 150000
    tx('2026-03-05', 100000, 'SALARIO ACME', { kind: 'income' }),             // Mar: -400000 but excluded
    tx('2026-03-10', -500000, 'ALUGUEL'),
    tx('2026-04-05', 500000, 'SALARIO ACME', { kind: 'income' }),             // Apr: +100000 → repays 50000 → 0
    tx('2026-04-10', -400000, 'ALUGUEL'),
    tx('2026-05-05', 500000, 'SALARIO ACME', { kind: 'income' }),
    tx('2026-05-10', -600000, 'ALUGUEL', { accountId: 'card' })               // May: -100000
  ];
  const rows = E.carryover(T, { startMonth: '2026-01', endMonth: '2026-05', accounts, excludedMonths: ['2026-03'] });
  const by = Object.fromEntries(rows.map(r => [r.month, r]));
  assert.deepEqual(rows.map(r => r.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  assert.equal(by['2026-01'].net, -200000);
  assert.equal(by['2026-01'].carryOut, 200000);
  assert.deepEqual(by['2026-01'].coverage, { card: 200000, investments: 0, balance: 0 }, 'card purchases (paid next month) cover first');
  assert.equal(by['2026-02'].carryIn, 200000); assert.equal(by['2026-02'].repaid, 150000); assert.equal(by['2026-02'].carryOut, 50000);
  assert.equal(by['2026-03'].excluded, true); assert.equal(by['2026-03'].carryIn, 50000); assert.equal(by['2026-03'].carryOut, 50000, 'excluded: passes D through, adds nothing');
  assert.equal(by['2026-04'].repaid, 50000); assert.equal(by['2026-04'].carryOut, 0);
  assert.equal(by['2026-05'].carryOut, 100000);
  assert.deepEqual(by['2026-05'].coverage, { card: 100000, investments: 0, balance: 0 });
  // coverage order: card, then redemptions, then balance
  const c2 = E.carryover([tx('2026-06-01', 100000, 'SALARIO', { kind: 'income' }), tx('2026-06-02', -150000, 'LOJA', { accountId: 'card' }), tx('2026-06-03', -200000, 'ALUGUEL'), tx('2026-06-04', 60000, 'RESGATE CDB', { kind: 'investment' })], { accounts });
  assert.deepEqual(c2[0].coverage, { card: 150000, investments: 60000, balance: 40000 });
  // disabled: nothing carried
  assert.ok(E.carryover(T, { startMonth: '2026-01', endMonth: '2026-05', accounts, enabled: false }).every(r => r.carryIn === 0 && r.carryOut === 0));
  // start later: earlier months ignored
  assert.equal(E.carryover(T, { startMonth: '2026-04', accounts })[0].carryIn, 0);
});

test('v2.1 buildSankey with carry: repaid leaf, coverage sources, hub balanced; without carry unchanged', () => {
  const T = [tx('2026-02-05', 500000, 'SALARIO ACME', { kind: 'income', categoryId: 'renda.salario' }), tx('2026-02-10', -350000, 'ALUGUEL', { categoryId: 'moradia.aluguel' })];
  const plain = E.buildSankey(T, {});
  const g = E.buildSankey(T, { carry: { month: '2026-02', repaid: 100000 } });
  assert.ok(hubBalanced(plain) && hubBalanced(g));
  const carry = g.nodes.find(n => n.id === 'carry');
  assert.ok(carry); assert.equal(carry.value, 100000); assert.match(carry.name, /^Déficit de janeiro \(pagando\)$/);
  assert.equal(g.nodes.find(n => n.id === 'sobra').value, 50000, 'surplus minus what pays the old deficit');
  assert.equal(g.meta.repaid, 100000);
  // repaid can never exceed the surplus
  const g2 = E.buildSankey(T, { carry: { month: '2026-02', repaid: 900000 } });
  assert.equal(g2.nodes.find(n => n.id === 'carry').value, 150000); assert.ok(!g2.nodes.some(n => n.id === 'sobra')); assert.ok(hubBalanced(g2));
  // a short month: the "Déficit" source is split by what covered it
  const S = [tx('2026-03-05', 100000, 'SALARIO ACME', { kind: 'income', categoryId: 'renda.salario' }), tx('2026-03-10', -250000, 'LOJA', { categoryId: 'compras.casa', accountId: 'card' })];
  const g3 = E.buildSankey(S, { carry: { month: '2026-03', repaid: 0, coverage: { card: 100000, investments: 20000, balance: 30000 } } });
  assert.deepEqual(g3.nodes.filter(n => n.column === 0 && /^deficit/.test(n.id)).map(n => [n.id, n.value]), [['deficit:card', 100000], ['deficit:inv', 20000], ['deficit:bal', 30000]]);
  assert.ok(!g3.nodes.some(n => n.id === 'deficit'));
  assert.equal(g3.nodes.find(n => n.id === 'deficit:card').name, 'Cartão (paga no mês seguinte)');
  assert.ok(hubBalanced(g3));
  const g4 = E.buildSankey(S, {});
  assert.equal(g4.nodes.find(n => n.id === 'deficit').value, 150000, 'no carry → single Déficit node');
});

// ---------------------------------------------------------------- feature 5: data health
const acc = [{ id: 'cc', name: 'Conta', type: 'checking' }, { id: 'card', name: 'Cartão', type: 'credit_card' }];
function extratoRows(from, to, opts) {
  opts = opts || {};
  const out = []; let bal = opts.balance0 || 100000; let ri = 0;
  for (let d = from; d <= to; d = addDay(d)) {
    if (opts.skip && opts.skip.includes(d)) { bal -= 1000; continue; }
    bal -= 1000;
    out.push(tx(d, -1000, 'PIX ENVIADO PADARIA ' + d.slice(8), Object.assign({ accountId: opts.acc || 'cc', importId: opts.imp || 'ext1', rowIndex: ri++, time: '10:00' }, opts.noBalance ? {} : { balance: bal })));
  }
  return out;
}
function addDay(iso) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
const H = (txs, extra) => E.dataHealth(Object.assign({ transactions: txs, accounts: acc, imports: {}, settings: {}, today: '2026-12-15' }, extra || {}));
const ids = ws => ws.map(w => w.id);
const has = (ws, prefix) => ws.some(w => w.id.startsWith(prefix));

test('v2.1 dataHealth a/e: month gaps and partial months are blocking; full months are fine', () => {
  const full = extratoRows('2026-07-01', '2026-07-31').concat(extratoRows('2026-09-01', '2026-09-30', { imp: 'ext2', balance0: 1000 }));
  const ws = H(full);
  assert.ok(ws.some(w => w.id === 'a:gap:cc:2026-08' && w.severity === 'blocking' && w.months[0] === '2026-08'), ids(ws).join());
  assert.equal(ws.errors.length, 0);
  const part = extratoRows('2026-07-03', '2026-10-01');
  const wp = H(part);
  assert.deepEqual(wp.filter(w => w.id.startsWith('e:')).map(w => w.months[0]).sort(), ['2026-07', '2026-10']);
  assert.ok(wp.filter(w => w.id.startsWith('e:')).every(w => w.severity === 'blocking'));
  assert.deepEqual(Object.keys(E.blockingMonths(wp)).sort(), ['2026-07', '2026-10']);
  assert.ok(!has(H(extratoRows('2026-07-01', '2026-09-30')), 'e:'), 'whole months: no warning');
});

test('v2.1 dataHealth b: extrato in a card account, fatura in a checking account, mixed account (with the move action)', () => {
  const ext = extratoRows('2026-07-01', '2026-07-31', { acc: 'card', imp: 'extX' });
  const fat = [];
  for (let i = 0; i < 20; i++) fat.push(tx('2026-07-' + String(i + 5).padStart(2, '0'), -5000 - i, 'LOJA ' + i, { accountId: 'card', importId: 'fatY', installment: i < 4 ? { n: 2, total: 5 } : null }));
  const ws = H(ext.concat(fat), { imports: { extX: { id: 'extX', fileName: 'extrato.csv' }, fatY: { id: 'fatY', fileName: 'fatura.csv' } } });
  const b = ws.find(w => w.id === 'b:extrato-in-card:extX');
  assert.ok(b, ids(ws).join());
  assert.equal(b.action.type, 'move-import'); assert.equal(b.action.label, 'Mover importação'); assert.deepEqual(b.importIds, ['extX']);
  assert.ok(!ws.some(w => w.id === 'b:mixed:card'), 'the extrato-in-card warning already covers it: no second warning for the same import');
  assert.equal(E.importKind(ext), 'extrato'); assert.equal(E.importKind(fat), 'fatura');
  const fat2 = fat.map(t => Object.assign({}, t, { accountId: 'cc' }));
  assert.ok(has(H(fat2), 'b:fatura-in-checking:'));
  assert.ok(!has(H(extratoRows('2026-07-01', '2026-07-31')), 'b:'), 'extrato in a checking account: fine');
});

test('v2.1 dataHealth c: payment without fatura (blocking), amount mismatch, fatura never paid', () => {
  const fatJul = [tx('2026-06-28', -40000, 'LOJA A', { accountId: 'card', importId: 'fJul' }), tx('2026-07-20', -60000, 'LOJA B', { accountId: 'card', importId: 'fJul', installment: { n: 2, total: 3 } }), tx('2026-07-27', -1000, 'LOJA C', { accountId: 'card', importId: 'fJul' })];
  const fatAug = [tx('2026-07-28', -30000, 'LOJA D', { accountId: 'card', importId: 'fAug' }), tx('2026-08-27', -20000, 'LOJA E', { accountId: 'card', importId: 'fAug', installment: { n: 3, total: 3 } })];
  const bank = extratoRows('2026-07-01', '2026-09-30', { noBalance: true })
    .concat([tx('2026-07-07', -77700, 'PAGAMENTO DE FATURA', { kind: 'card_payment', importId: 'ext1' }),     // no fatura closes before 07/07 → missing June fatura
      tx('2026-08-06', -101000, 'PAGAMENTO DE FATURA', { kind: 'card_payment', importId: 'ext1' }),              // fJul exact
      tx('2026-09-04', -50370, 'PAGAMENTO DE FATURA', { kind: 'card_payment', importId: 'ext1' })]);              // fAug: R$ 3,70 off
  const ws = H(bank.concat(fatJul, fatAug));
  const miss = ws.find(w => w.id.startsWith('c:no-fatura:'));
  assert.ok(miss && miss.severity === 'blocking' && miss.months[0] === '2026-06', ids(ws).join());
  assert.equal(miss.action.type, 'import'); assert.equal(miss.action.label, 'Importar fatura (venc. julho)');
  assert.match(miss.detail, /vencimento em julho 2026/); assert.match(miss.detail, /anterior a "fJul"/); assert.match(miss.detail, /até 27\/06\/2026/);
  const mm = ws.filter(w => w.id.startsWith('c:mismatch:'));
  assert.equal(mm.length, 1); assert.match(mm[0].detail, /R\$ 3,70/);
  assert.ok(!has(ws, 'c:no-payment:'), 'both faturas paid');
  // fatura with no payment while an extrato covers the period
  const ws2 = H(extratoRows('2026-07-01', '2026-09-30', { noBalance: true }).concat(fatJul));
  assert.ok(has(ws2, 'c:no-payment:fJul'));
  // extrato not covering the payment window → no reverse warning
  assert.ok(!has(H(extratoRows('2026-07-01', '2026-07-31', { noBalance: true }).concat(fatJul)), 'c:no-payment:'));
});

test('v2.1 dataHealth d: running-balance breaks inside an import and between imports; dedupe-explained gaps are fine', () => {
  const ok = extratoRows('2026-07-01', '2026-07-31');
  assert.ok(!has(H(ok), 'd:'));
  const broken = extratoRows('2026-07-01', '2026-07-31', { skip: ['2026-07-10', '2026-07-11'] });
  const w = H(broken).find(x => x.id === 'd:break:ext1');
  assert.ok(w && w.severity === 'blocking' && w.months[0] === '2026-07');
  // descending row order (newest first) is understood
  const desc = ok.slice().reverse().map((t, i) => Object.assign({}, t, { rowIndex: i }));
  assert.ok(!has(H(desc), 'd:'));
  // a missing row that exists in another import of the same account (dropped as duplicate) is not a break
  const dropped = ok.filter(t => t.date !== '2026-07-10');
  const other = [Object.assign({}, ok.find(t => t.date === '2026-07-10'), { id: 'o1', importId: 'ext0', balance: undefined })];
  assert.ok(!has(H(dropped.concat(other)), 'd:break'));
  // discontinuity between two consecutive imports
  const a = extratoRows('2026-07-01', '2026-07-31', { imp: 'e1' });
  const b = extratoRows('2026-08-01', '2026-08-31', { imp: 'e2', balance0: 5000000 });
  assert.ok(has(H(a.concat(b)), 'd:gap:e1:e2'));
  const b2 = extratoRows('2026-08-01', '2026-08-31', { imp: 'e2', balance0: a[a.length - 1].balance });
  assert.ok(!has(H(a.concat(b2)), 'd:gap'));
});

test('v2.1 applyProfile keeps the running balance per row when the file has a Saldo column', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'xp_extrato_hora.csv'), 'utf8');
  const an = E.analyzeTable(text);
  const res = E.applyProfile(text, E.profileFromAnalysis(an), { accountId: 'cc', importId: 'x', referenceYear: 2026 });
  assert.ok(res.transactions.length >= 4 && res.transactions.every(t => typeof t.balance === 'number'));
  assert.equal(res.transactions[0].balance, 100010);
  const noBal = E.applyProfile('Data;Descrição;Valor\n01/09/2026;LOJA;-10,00\n', E.profileFromAnalysis(E.analyzeTable('Data;Descrição;Valor\n01/09/2026;LOJA;-10,00\n')), {});
  assert.ok(noBal.transactions.every(t => !('balance' in t)));
});

test('v2.1 dataHealth f: asks "Isto é você?" for the frequent own-looking name; with ownerNames flags transfers outside the app', () => {
  const T = extratoRows('2026-07-01', '2026-07-31', { noBalance: true }).concat([
    tx('2026-07-05', 300000, 'Pix recebido de Maria Exemplo da Silva', { importId: 'ext1' }),
    tx('2026-08-05', 250000, 'Pix recebido de Maria Exemplo da Silva', { importId: 'ext1' }),
    tx('2026-07-20', -90000, 'Pix enviado para Maria Exemplo da Silva', { importId: 'ext1' }),
    tx('2026-07-21', -5000, 'Pix enviado para Mercado Pago Instituicao de Pagamento Ltda', { importId: 'ext1' }),
    tx('2026-07-22', -5000, 'Pix enviado para Mercado Pago Instituicao de Pagamento Ltda', { importId: 'ext1' })]);
  const ask = H(T).find(w => w.id.startsWith('f:ask:'));
  assert.ok(ask); assert.equal(ask.action.type, 'owner-name'); assert.equal(ask.action.label, 'Isto é você?'); assert.equal(ask.action.name, 'MARIA EXEMPLO DA SILVA');
  const own = H(T, { settings: { ownerNames: ['MARIA EXEMPLO DA SILVA'] } }).find(w => w.id.startsWith('f:own:'));
  assert.ok(own && own.severity === 'warning');
  assert.equal(own.action.type, 'mark-transfer'); assert.equal(own.action.txIds.length, 3);
  // matched by a tracked account (opposite amount in another account): not flagged
  const T2 = T.concat([tx('2026-07-05', -300000, 'TED ENVIADA MARIA EXEMPLO DA SILVA', { accountId: 'card', importId: 'z' }), tx('2026-08-05', -250000, 'X', { accountId: 'card', importId: 'z' }), tx('2026-07-20', 90000, 'Y', { accountId: 'card', importId: 'z' })]);
  assert.ok(!has(H(T2, { settings: { ownerNames: ['Maria Exemplo da Silva'] } }), 'f:own:'));
});

test('v2.1 dataHealth g/h/i: salary missing, subscription missing, payslip without deposit', () => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08'];
  const T = [];
  for (const m of months) T.push(...extratoRows(m + '-01', m + '-' + (m === '2026-06' ? '30' : '31'), { noBalance: true, imp: 'e' + m }));
  for (const m of ['2026-05', '2026-06', '2026-07']) {
    T.push(tx(m + '-05', 800000, 'TED RECEBIDA SALARIO ACME', { kind: 'income', categoryId: 'renda.salario', importId: 'e' + m }));
    T.push(tx(m + '-12', -5590, 'NETFLIX.COM', { importId: 'e' + m }));
  }
  const ws = H(T);
  assert.ok(ws.some(w => w.id === 'g:salary:salario:2026-08' && w.severity === 'warning'), ids(ws).join());
  assert.ok(ws.some(w => w.id.startsWith('h:sub:') && w.months[0] === '2026-08' && w.severity === 'info'));
  // the in-progress month (data only up to day 2) is not flagged yet
  const T2 = T.concat(extratoRows('2026-09-01', '2026-09-02', { noBalance: true, imp: 'e9' }));
  assert.ok(!H(T2).some(w => w.id === 'g:salary:salario:2026-09'));
  // payslips: net 700000 on 05/08 without deposit → warning; the deposit of 05/07 matches
  const slips = [E.payslipToTransactions({ date: '2026-08-05', gross: 1000000, inss: 100000, irrf: 200000, employer: 'ACME', accountId: 'hol' }),
    E.payslipToTransactions({ date: '2026-07-05', gross: 1000000, inss: 100000, irrf: 100000, employer: 'ACME', accountId: 'hol' })].flat();
  const ws3 = E.dataHealth({ transactions: T.concat(slips), accounts: acc.concat([{ id: 'hol', name: 'Holerite', type: 'payslip' }]), imports: {}, settings: {}, today: '2026-12-01' });
  assert.ok(ws3.some(w => w.id.startsWith('i:slip:') && w.months[0] === '2026-08'), ids(ws3).join());
  assert.ok(!ws3.some(w => w.id.startsWith('i:slip:') && w.months[0] === '2026-07'));
  assert.ok(ws3.some(w => w.id.startsWith('i:dep:')), 'salary deposits with no matching payslip are reported');
});

test('v2.1 dataHealth j/k/l: overlapping imports, parcela gaps, large uncategorized share; dismissed; nothing throws', () => {
  const f1 = [tx('2026-07-10', -4590, 'IFOOD *RESTAURANTE', { accountId: 'card', importId: 'f1' }), tx('2026-07-20', -15000, 'LOJA TESTE', { accountId: 'card', importId: 'f1', installment: { n: 3, total: 10 }, originalDate: '2026-05-20' }), tx('2026-07-25', -100, 'X', { accountId: 'card', importId: 'f1' })];
  const f2 = [tx('2026-07-11', -4590, 'IFOOD *RESTAURANTE', { accountId: 'card', importId: 'f2' }), tx('2026-07-24', -200, 'Y', { accountId: 'card', importId: 'f2' }), tx('2026-08-20', -15000, 'LOJA TESTE', { accountId: 'card', importId: 'f2', installment: { n: 5, total: 10 }, originalDate: '2026-05-20' }), tx('2026-08-25', -100, 'Z', { accountId: 'card', importId: 'f2' })];
  const ws = H(f1.concat(f2), { imports: { f2: { id: 'f2', duplicates: 3 } } });
  const j = ws.find(w => w.id === 'j:dups:f1:f2');
  assert.ok(j && j.severity === 'warning' && j.txIds.length === 2, ids(ws).join());
  const k = ws.find(w => w.id.startsWith('k:parc:'));
  assert.ok(k && /4\/10/.test(k.detail), 'parcela 4/10 (due 20/08) missing while 3/10 and 5/10 are there');
  assert.ok(k.months.includes('2026-08'));
  // dedupe did its job: info only
  const f2b = f2.filter(t => !/IFOOD/.test(t.rawDescription));
  const ok = H(f1.concat(f2b), { imports: { f2: { id: 'f2', duplicates: 3 } } });
  assert.ok(ok.some(w => w.id === 'j:ok:f1:f2' && w.severity === 'info'));
  // l: > 25% uncategorized
  const l = ws.find(w => w.id === 'l:uncat:2026-07');
  assert.ok(l && l.severity === 'info' && l.action.type === 'triage');
  const cat = f1.concat(f2).map(t => Object.assign({}, t, { categoryId: 'compras.casa' }));
  assert.ok(!has(H(cat), 'l:'));
  // dismissed warnings are filtered; ids are stable
  const again = H(f1.concat(f2), { imports: { f2: { id: 'f2', duplicates: 3 } }, settings: { dismissedWarnings: [j.id] } });
  assert.ok(!again.some(w => w.id === j.id) && again.some(w => w.id === k.id));
  // garbage input: no throw, no errors
  const g = E.dataHealth({ transactions: [null, { id: 'x' }, { id: 'y', date: '2026-07-01', amount: 0 }, tx('2026-07-01', -1, '')], accounts: null, imports: null });
  assert.ok(Array.isArray(g)); assert.deepEqual(g.errors, []);
  assert.deepEqual(E.dataHealth({}).errors, []);
});

// ---------------------------------------------------------------- tester regressions (synthetic data)
test('regression: an extrato row reversed by an estorno is not a "repeat" of the same purchase on the fatura', () => {
  const fat = [];
  for (let i = 0; i < 12; i++) fat.push(tx('2026-07-' + String(i + 10).padStart(2, '0'), -2000 - i, 'LOJA ' + i, { accountId: 'card', importId: 'fat', installment: i < 2 ? { n: 2, total: 4 } : null }));
  fat.push(tx('2026-07-29', -370, 'PEDAGIO RODOVIA X', { accountId: 'card', importId: 'fat' }));
  const ext = extratoRows('2026-07-01', '2026-07-31', { acc: 'card', imp: 'ext', noBalance: true }).concat([
    tx('2026-07-29', -370, 'PEDAGIO RODOVIA X  CIDADE BR', { accountId: 'card', importId: 'ext', time: '18:51' }),
    tx('2026-07-29', 370, 'Estorno PEDAGIO RODOVIA X  CIDADE BR', { accountId: 'card', importId: 'ext', kind: 'expense', time: '18:52' })]);
  const ws = H(fat.concat(ext));
  assert.ok(!has(ws, 'j:dups:'), ids(ws).join());
  assert.ok(has(ws, 'b:extrato-in-card:ext'));
  // two faturas (same kind) with the same line still are flagged
  const fat2 = fat.map(t => Object.assign({}, t, { id: t.id + 'b', importId: 'fat2' }));
  assert.ok(has(H(fat.concat(fat2)), 'j:dups:'));
});

test('regression: payment ≠ fatura by exactly a line found in another import → says the line was dropped as a repeat', () => {
  const fat = [tx('2026-07-28', -30000, 'LOJA D', { accountId: 'card', importId: 'fAug' }), tx('2026-07-29', -370, 'PEDAGIO RODOVIA X', { accountId: 'card', importId: 'fAug' }),
    tx('2026-08-27', -20000, 'LOJA E', { accountId: 'card', importId: 'fAug', installment: { n: 3, total: 3 } })];
  const bank = extratoRows('2026-07-01', '2026-09-30', { noBalance: true }).concat([
    tx('2026-07-29', -370, 'PEDAGIO RODOVIA X CIDADE', { importId: 'ext1' }), tx('2026-07-29', 370, 'Estorno PEDAGIO RODOVIA X CIDADE', { importId: 'ext1', kind: 'expense' }),
    tx('2026-09-04', -50740, 'PAGAMENTO DE FATURA', { kind: 'card_payment', importId: 'ext1' })]);
  const mm = H(bank.concat(fat)).find(w => w.id.startsWith('c:mismatch:'));
  assert.ok(mm, 'still a mismatch (true positive)');
  assert.match(mm.detail, /R\$ 3,70/); assert.match(mm.detail, /descartada como repetida/); assert.match(mm.detail, /importe "fAug" de novo|Importe "fAug" de novo/);
  // a plain shortfall gets the partial-payment explanation instead
  const bank2 = bank.map(t => t.kind === 'card_payment' ? Object.assign({}, t, { amount: -40000 }) : t);
  assert.match(H(bank2.concat(fat)).find(w => w.id.startsWith('c:mismatch:')).detail, /pagamento parcial/);
});

test('regression: dedupe matches exact ids first, so a re-import restores the 2nd of two identical rows dropped earlier', () => {
  const row = (id, ri) => ({ id, date: '2026-07-29', amount: -370, rawDescription: 'PEDAGIO RODOVIA X', merchant: 'PEDAGIO RODOVIA X', accountId: 'card', kind: 'expense', rowIndex: ri });
  // stored: only the SECOND toll (id occ1); the first was dropped as a duplicate of a since-moved extrato row
  const existing = [row('tx_occ1', 69), row('tx_other', 70)].map((t, i) => i ? Object.assign(t, { amount: -999, rawDescription: 'OUTRA', merchant: 'OUTRA' }) : t);
  const incoming = [row('tx_occ0', 62), row('tx_occ1', 69), Object.assign(row('tx_other', 70), { amount: -999, rawDescription: 'OUTRA', merchant: 'OUTRA' })];
  const d = E.dedupe(existing, incoming);
  assert.deepEqual(d.fresh.map(t => t.id), ['tx_occ0']);
  assert.deepEqual(d.duplicates.map(t => t.id).sort(), ['tx_occ1', 'tx_other']);
  // plain re-import of the same file: nothing new
  assert.equal(E.dedupe(incoming, incoming).fresh.length, 0);
});

test('regression: subscription on a fatura is not "missing" just because an extrato in the same account runs later', () => {
  const T = [];
  const fats = [['f6', '2026-05-28', '2026-06-27'], ['f7', '2026-06-28', '2026-07-27'], ['f8', '2026-07-28', '2026-08-27'], ['f9', '2026-08-28', '2026-09-27']];
  for (const [imp, a, b] of fats) {
    T.push(tx(a, -2999, 'STREAMING FLEX', { accountId: 'card', importId: imp }));
    for (let i = 0; i < 8; i++) T.push(tx(addDay(a).slice(0, 8) + String(5 + i * 2).padStart(2, '0'), -1000 - i, 'LOJA ' + i, { accountId: 'card', importId: imp, installment: i === 0 ? { n: 2, total: 3 } : null }));
    T.push(tx(b, -500, 'PADARIA', { accountId: 'card', importId: imp }));
  }
  // charges on 28/05, 28/06, 28/07, 28/08 → next on 28/09 is in the NEXT fatura (not imported); an extrato in the same account goes to 01/10
  const ext = extratoRows('2026-07-03', '2026-10-01', { acc: 'card', imp: 'ext', noBalance: true });
  const ws = H(T.concat(ext));
  assert.ok(!ws.some(w => w.id.startsWith('h:sub:') && /STREAMING/.test(w.title)), ids(ws).join());
  // when the fatura covering 28/09 IS imported and the charge is absent, it is reported
  const f10 = [];
  for (let i = 0; i < 8; i++) f10.push(tx('2026-09-' + String(29 - i).padStart(2, '0'), -700 - i, 'MERCADO ' + i, { accountId: 'card', importId: 'f10' }));
  f10.push(tx('2026-10-20', -500, 'PADARIA', { accountId: 'card', importId: 'f10' }));
  const ws2 = H(T.concat(f10));
  assert.ok(ws2.some(w => w.id.startsWith('h:sub:') && /STREAMING/.test(w.title) && w.months[0] === '2026-09'), ids(ws2).join());
});

test('regression: partial months use the period in the file name, explain the missing days; the running month is info but still out of the carry-over', () => {
  const part = extratoRows('2026-07-07', '2026-10-01');
  const ws = H(part, { imports: { ext1: { id: 'ext1', fileName: 'extrato_de_03-07-2026_ate_01-10-2026.csv' } }, today: '2026-10-02' });
  const jul = ws.find(w => w.id === 'e:partial:cc:2026-07');
  assert.ok(jul && jul.severity === 'blocking');
  assert.match(jul.detail, /começa em 03\/07\/2026/); assert.match(jul.detail, /do dia 1º ao dia 2/); assert.match(jul.detail, /déficit acumulado/); assert.match(jul.detail, /Marcar mês como completo/);
  const oct = ws.find(w => w.id === 'e:partial:cc:2026-10');
  assert.ok(oct && oct.severity === 'info' && oct.carryExclude === true && /em andamento/.test(oct.title));
  assert.deepEqual(Object.keys(E.blockingMonths(ws)).sort(), ['2026-07', '2026-10']);
  assert.equal(E.filePeriod('Fatura2026-10-05.csv'), null); assert.deepEqual(E.filePeriod('extrato_de_03-07-2026_ate_01-10-2026.csv'), ['2026-07-03', '2026-10-01']);
  // a past month that ends early is still blocking
  const ws2 = H(part, { today: '2026-12-15' });
  assert.equal(ws2.find(w => w.id === 'e:partial:cc:2026-10').severity, 'blocking');
});

test('regression: "Estas transferências são suas?" says whether they already are transfers', () => {
  const T = extratoRows('2026-07-01', '2026-07-31', { noBalance: true }).concat([
    tx('2026-07-05', 300000, 'Pix recebido de Maria Exemplo da Silva', { importId: 'ext1', kind: 'transfer' }),
    tx('2026-08-05', 250000, 'Pix recebido de Maria Exemplo da Silva', { importId: 'ext1', kind: 'transfer' })]);
  assert.match(H(T).find(w => w.id.startsWith('f:ask:')).detail, /já estão como transferência/);
  const T2 = T.map(t => t.kind === 'transfer' ? Object.assign({}, t, { kind: 'income' }) : t);
  assert.match(H(T2).find(w => w.id.startsWith('f:ask:')).detail, /2 estão contando como entrada/);
});
