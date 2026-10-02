'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../site/engine.js');

const FX = path.join(__dirname, 'fixtures');
function load(name, opts) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FX, name)));
  const dec = E.decodeBytes(bytes);
  const analysis = E.analyzeTable(dec.text);
  const profile = E.profileFromAnalysis(analysis);
  const res = E.applyProfile(dec.text, profile, Object.assign({ accountId: 'acc', importId: 'imp1', referenceYear: 2026 }, opts || {}));
  return { dec, analysis, profile, res };
}
const roleIdx = (a, role) => (a.columns.find(c => c.role === role) || {}).index;
const sum = arr => arr.reduce((s, x) => s + x, 0);

// ---------------------------------------------------------------- API surface
test('exports every contract function', () => {
  const names = ['decodeBytes', 'analyzeTable', 'analyzeRows', 'profileFromAnalysis', 'applyProfile', 'matchProfile', 'parseAmount',
    'detectNumberFormat', 'parseDate', 'normalizeDescription', 'classify', 'classifyAll', 'learnFromCorrection', 'dedupe',
    'linkCardPayments', 'summarize', 'buildSankey', 'monthlySeries', 'futureInstallments', 'formatBRL', 'payslipToTransactions',
    'buildAIPrompt', 'validateAIProfile'];
  for (const n of names) assert.equal(typeof E[n], 'function', n);
  assert.ok(Array.isArray(E.DEFAULT_CATEGORIES));
  assert.ok(Array.isArray(E.DEFAULT_DICTIONARY));
  assert.equal(globalThis.FinEngine, E);
});

// ---------------------------------------------------------------- primitives
test('parseAmount handles BR/US formats and sign notations', () => {
  const cases = [['1.234,56', 'br', 123456], ['1,234.56', 'us', 123456], ['-1.234,56', 'br', -123456], ['R$ 1.234,56', 'br', 123456],
    ['1.234,56-', 'br', -123456], ['(1.234,56)', 'br', -123456], ['1.234,56 D', 'br', -123456], ['1.234,56 C', 'br', 123456],
    ['123,4', 'br', 12340], ['-R$ 5,00', 'br', -500], ['1.234.567,89', 'br', 123456789], ['1.234', 'br', 123400], ['1.234', 'us', 123],
    ['45.90', 'us', 4590], ['12', 'br', 1200], ['abc', 'br', null], ['', 'br', null], ['12/09/2026', 'br', null]];
  for (const [s, f, exp] of cases) assert.equal(E.parseAmount(s, f), exp, s + ' ' + f);
  // auto (no format): decimal is the separator followed by 1-2 digits at the end
  assert.equal(E.parseAmount('1.234,56'), 123456);
  assert.equal(E.parseAmount('1,234.56'), 123456);
});

test('detectNumberFormat looks at the whole column', () => {
  assert.equal(E.detectNumberFormat(['1.234,56', '12,00', '3,5']).format, 'br');
  assert.equal(E.detectNumberFormat(['1,234.56', '12.00', '-3.50']).format, 'us');
  // "1.234" alone is ambiguous, but the column decides
  const r = E.detectNumberFormat(['1.234', '10,50', '2.000']);
  assert.equal(r.format, 'br');
  assert.ok(E.detectNumberFormat(['1,234.56', '1.000.000,00']).confidence < 0.8);
});

test('parseDate handles many formats and yearless dates', () => {
  const o = { referenceYear: 2026 };
  assert.equal(E.parseDate('15/09/2026', 'DD/MM/YYYY', o), '2026-09-15');
  assert.equal(E.parseDate('15/09/26', 'DD/MM/YY', o), '2026-09-15');
  assert.equal(E.parseDate('2026-09-15', 'YYYY-MM-DD', o), '2026-09-15');
  assert.equal(E.parseDate('15-09-2026', 'DD-MM-YYYY', o), '2026-09-15');
  assert.equal(E.parseDate('15 SET', 'DD MMM', o), '2026-09-15');
  assert.equal(E.parseDate('15/set', 'DD MMM', o), '2026-09-15');
  assert.equal(E.parseDate('15 de setembro de 2026', null, o), '2026-09-15');
  assert.equal(E.parseDate('03 FEV 2025', null, o), '2025-02-03');
  assert.equal(E.parseDate('09/14/2026', 'MM/DD/YYYY', o), '2026-09-14');
  assert.equal(E.parseDate('05/04/2026', 'MM/DD/YYYY', o), '2026-05-04');
  assert.equal(E.parseDate('05/04/2026', 'DD/MM/YYYY', o), '2026-04-05');
  assert.equal(E.parseDate('31/02/2026', 'DD/MM/YYYY', o), null);
  assert.equal(E.parseDate('nada', 'DD/MM/YYYY', o), null);
  // roll back to the previous year when month is ahead of the statement month
  assert.equal(E.parseDate('20 DEZ', 'DD MMM', { referenceYear: 2026, referenceMonth: 1 }), '2025-12-20');
});

test('decodeBytes: utf-8, BOM and windows-1252', () => {
  const utf = new Uint8Array(Buffer.from('﻿Data;Descrição\n', 'utf8'));
  assert.deepEqual(E.decodeBytes(utf), { text: 'Data;Descrição\n', encoding: 'utf-8' });
  const lat = new Uint8Array(Buffer.from('Histórico;Crédito\n', 'latin1'));
  const d = E.decodeBytes(lat);
  assert.equal(d.encoding, 'windows-1252');
  assert.equal(d.text, 'Histórico;Crédito\n');
});

test('normalizeDescription strips gateways, geo, card digits, dates and extracts installments', () => {
  const N = s => E.normalizeDescription(s);
  assert.equal(N('MP*MERCADOLIVRE').merchant, 'MERCADOLIVRE');
  assert.equal(N('PG *LOJA ABC SAO PAULO BR').merchant, 'LOJA ABC');
  assert.equal(N('IFD*IFOOD').merchant, 'IFOOD');
  assert.equal(N('EC *PADARIA PAO QUENTE').merchant, 'PADARIA PAO QUENTE');
  assert.equal(N('PAYPAL *STEAM').merchant, 'STEAM');
  assert.equal(N('MERCPAGO*LOJINHA').merchant, 'LOJINHA');
  assert.equal(N('PAG*Drogasil').merchant, 'DROGASIL');
  assert.equal(N('NETFLIX.COM SAO PAULO BRA').merchant, 'NETFLIX.COM');
  assert.equal(N('UBER *TRIP 15/09').merchant, 'UBER TRIP');
  assert.equal(N('POSTO SHELL **** 1234').merchant, 'POSTO SHELL');
  assert.equal(N('Café  Açúcar  *** ').merchant, 'CAFE ACUCAR');
  const pix = N('PIX ENVIADO - João da Silva');
  assert.equal(pix.merchant, 'PIX ENVIADO JOAO DA SILVA');
  assert.equal(pix.counterparty, 'JOAO DA SILVA');
  assert.equal(N('Transferência recebida pelo Pix - EMPRESA XYZ LTDA - 12.345.678/0001-90 - ITAÚ').merchant, 'PIX RECEBIDO EMPRESA XYZ LTDA');
  assert.deepEqual(N('LOJA X PARC 02/10'), Object.assign(N('LOJA X PARC 02/10'), { merchant: 'LOJA X', installment: { n: 2, total: 10 } }));
  assert.deepEqual(N('Mercado Livre Parcela 2 de 10').installment, { n: 2, total: 10 });
  assert.deepEqual(N('Magazine Luiza 2/10').installment, { n: 2, total: 10 });
  assert.deepEqual(N('Magazine Luiza - Parcela 3/10').installment, { n: 3, total: 10 });
  assert.equal(N('Magazine Luiza - Parcela 3/10').merchant, 'MAGAZINE LUIZA');
  assert.equal(N('NETFLIX').installment, null);
});

// ---------------------------------------------------------------- fixtures
test('Nubank-like card CSV: positive purchases, negative payment', () => {
  const { analysis: a, res, profile } = load('nubank_cartao.csv');
  assert.equal(a.delimiter, ',');
  assert.equal(a.headerRowIndex, 0);
  assert.equal(a.numberFormat, 'us');
  assert.equal(a.dateFormat, 'YYYY-MM-DD');
  assert.equal(roleIdx(a, 'date'), 0);
  assert.equal(roleIdx(a, 'description'), 1);
  assert.equal(roleIdx(a, 'amount'), 2);
  assert.equal(a.signConvention, 'positive_is_expense');
  assert.ok(a.signConfidence >= 0.7);
  assert.equal(profile.signConvention, 'positive_is_expense');
  assert.equal(res.transactions.length, 10);
  assert.equal(res.errors.length, 0);
  // purchases total 4590+2345+5590+19990+8730+123456+412+2190 = 167303 ; payment +150000 ; refund +2345
  assert.equal(res.total, -167303 + 150000 + 2345);
  const pay = res.transactions.find(t => /Pagamento/.test(t.rawDescription));
  assert.equal(pay.amount, 150000);
  const cl = E.classifyAll(res.transactions, { rules: [], dictionary: E.DEFAULT_DICTIONARY, accountType: 'credit_card' });
  assert.equal(cl.find(t => /Pagamento/.test(t.rawDescription)).kind, 'card_payment');
  const est = cl.find(t => /Estorno/.test(t.rawDescription));
  assert.equal(est.kind, 'expense');
  assert.equal(est.categoryId, 'transporte.app');
  assert.equal(est.amount, 2345);
  const mg = cl.find(t => /Magazine/.test(t.rawDescription));
  assert.deepEqual(mg.installment, { n: 3, total: 10 });
  // v2: marketplaces are ambiguous — never auto-assigned, offered as triage suggestions
  assert.equal(mg.categoryId, null);
  assert.ok(E.suggestCategories(mg, {}).some(s => s.categoryId === 'compras.marketplace'));
  assert.equal(mg.date, '2026-11-08'); // parcela 3/10 bought 08/09 is booked two months later
  assert.equal(mg.originalDate, '2026-09-08');
  assert.equal(cl.find(t => /Ifood/.test(t.rawDescription)).categoryId, 'alimentacao.delivery');
  assert.equal(cl.find(t => /Drogasil/.test(t.rawDescription)).merchant, 'DROGASIL');
  assert.equal(cl.find(t => /IOF/.test(t.rawDescription)).categoryId, 'impostos.iof');
});

test('Nubank-like account CSV (Data,Valor,Identificador,Descrição)', () => {
  const { analysis: a, res } = load('nubank_conta.csv');
  assert.equal(a.delimiter, ',');
  assert.equal(roleIdx(a, 'date'), 0);
  assert.equal(roleIdx(a, 'amount'), 1);
  assert.equal(roleIdx(a, 'description'), 3);
  assert.equal(a.columns[2].role, 'ignore');
  assert.equal(a.signConvention, 'negative_is_expense');
  assert.equal(res.total, 850000 - 150000 - 220000 - 18943 - 100000 + 1234);
  const cl = E.classifyAll(res.transactions, { accountType: 'checking' });
  const k = d => cl.find(t => t.rawDescription.startsWith(d));
  assert.equal(k('Transferência recebida').kind, 'income');
  assert.equal(k('Transferência recebida').merchant, 'PIX RECEBIDO EMPRESA XYZ LTDA');
  assert.equal(k('Pagamento de fatura').kind, 'card_payment');
  assert.equal(k('Aplicação RDB').kind, 'investment');
  assert.equal(k('Rendimento RDB').kind, 'income');
  assert.equal(k('Rendimento RDB').categoryId, 'renda.rendimentos');
  assert.equal(k('Pagamento de boleto').categoryId, 'moradia.energia');
});

test('Itaú-like semicolon extrato with preamble and SALDO rows', () => {
  const { analysis: a, res } = load('itau_extrato.csv');
  assert.equal(a.delimiter, ';');
  assert.equal(a.headerRowIndex, 4);
  assert.equal(a.numberFormat, 'br');
  assert.equal(roleIdx(a, 'amount'), 2);
  assert.equal(roleIdx(a, 'balance'), 3);
  assert.equal(a.signConvention, 'negative_is_expense');
  const reasons = a.skippedRows.map(s => s.index);
  for (const i of [0, 1, 2, 5, 8, 12]) assert.ok(reasons.includes(i), 'skipped ' + i);
  assert.equal(res.transactions.length, 7);
  assert.ok(!res.transactions.some(t => /SALDO/.test(t.rawDescription)));
  assert.equal(res.total, 543210 - 15000 - 4590 - 234567 - 9876 - 31245 + 321);
  assert.equal(res.errors.length, 0);
});

test('Bradesco-like windows-1252 with separate Crédito/Débito columns and footer total', () => {
  const { dec, analysis: a, res } = load('bradesco_latin1.csv');
  assert.equal(dec.encoding, 'windows-1252');
  assert.equal(a.delimiter, ';');
  assert.equal(a.headerRowIndex, 3);
  assert.equal(a.signConvention, 'split_columns');
  assert.equal(roleIdx(a, 'credit'), 3);
  assert.equal(roleIdx(a, 'debit'), 4);
  assert.equal(roleIdx(a, 'balance'), 5);
  assert.equal(roleIdx(a, 'description'), 1);
  assert.equal(res.transactions.length, 5);
  assert.equal(res.total, 200000 - 85000 - 12345 - 2350 - 3500);
  assert.ok(res.transactions.some(t => t.rawDescription === 'Pagto Eletron Cobranca Condomínio Edifício'));
  const cl = E.classifyAll(res.transactions, {});
  assert.equal(cl.find(t => /Condom/.test(t.rawDescription)).categoryId, 'moradia.condominio');
  assert.equal(cl.find(t => /Comg/.test(t.rawDescription)).categoryId, 'moradia.gas');
});

test('US-format file (comma thousands, dot decimal, MM/DD)', () => {
  const { analysis: a, res } = load('us_format.csv');
  assert.equal(a.numberFormat, 'us');
  assert.equal(a.dateFormat, 'MM/DD/YYYY');
  assert.equal(res.transactions[0].date, '2026-09-14');
  assert.equal(res.transactions[0].amount, -123456);
  assert.equal(res.total, -123456 + 350000 - 675 - 4510 - 1549 - 8999);
});

test('D/C flag column', () => {
  const { analysis: a, res } = load('dc_flag.csv');
  assert.equal(a.signConvention, 'dc_flag');
  assert.equal(roleIdx(a, 'dcFlag'), 3);
  assert.equal(res.total, 400000 - 15000 - 9990 - 6540 + 30000);
  const cl = E.classifyAll(res.transactions, {});
  assert.equal(cl[0].kind, 'income');
  assert.equal(cl[0].categoryId, 'renda.salario');
  assert.equal(cl[1].categoryId, 'transporte.combustivel');
});

test('tab-separated', () => {
  const { analysis: a, res } = load('tabulado.tsv');
  assert.equal(a.delimiter, '\t');
  assert.equal(res.total, -1250 - 12999 + 20000 - 54321);
});

test('pipe-separated', () => {
  const { analysis: a, res } = load('pipe.txt');
  assert.equal(a.delimiter, '|');
  assert.equal(res.total, -21033 - 1890 + 320000 - 4560);
  const cl = E.classifyAll(res.transactions, {});
  assert.equal(cl[1].categoryId, 'transporte.app');
  assert.equal(cl[3].categoryId, 'saude.farmacia');
});

test('file without header row', () => {
  const { analysis: a, res } = load('sem_header.csv');
  assert.equal(a.headerRowIndex, null);
  assert.equal(a.dataStart, 0);
  assert.equal(a.dateFormat, 'DD/MM/YY');
  assert.equal(roleIdx(a, 'date'), 0);
  assert.equal(roleIdx(a, 'description'), 1);
  assert.equal(roleIdx(a, 'amount'), 2);
  assert.equal(res.transactions[0].date, '2026-09-05');
  assert.equal(res.total, -15000 - 7990 - 3850 + 50000 - 2490);
  const cl = E.classifyAll(res.transactions, {});
  assert.equal(cl[0].merchant, 'MERCADOLIVRE');
  assert.equal(cl[1].merchant, 'SHOPEE');
  assert.equal(cl[2].categoryId, 'alimentacao.delivery');
});

test('"15 SET" dates, installments, card statement with footer total', () => {
  const { analysis: a, res } = load('cartao_parcelas.csv');
  assert.equal(a.dateFormat, 'DD MMM');
  assert.equal(a.signConvention, 'positive_is_expense');
  assert.equal(res.transactions.length, 6);
  assert.ok(a.skippedRows.some(s => /Total/.test(s.text)));
  assert.equal(res.total, -10000 - 5590 - 30000 + 120000 - 345 - 8000);
  const lx = res.transactions.find(t => /LOJA X/.test(t.rawDescription));
  // v2: parcela n of N counts in the month of the parcela (purchase date + n-1 months)
  assert.equal(lx.date, '2026-11-15');
  assert.equal(lx.originalDate, '2026-09-15');
  assert.deepEqual(lx.installment, { n: 3, total: 10 });
  assert.equal(lx.merchant, 'LOJA X');
  assert.equal(res.transactions.find(t => /LOJA Y/.test(t.rawDescription)).date, '2026-08-20');
});

test('yearless dates roll back across year boundary', () => {
  const rows = [['Data', 'Descrição', 'Valor'], ['28 DEZ', 'LOJA A', '10,00'], ['05 JAN', 'LOJA B', '20,00'], ['10 JAN', 'LOJA C', '5,00']];
  const a = E.analyzeRows(rows);
  const r = E.applyProfile(rows, E.profileFromAnalysis(a), { accountId: 'c', importId: 'i', referenceYear: 2026 });
  assert.deepEqual(r.transactions.map(t => t.date), ['2025-12-28', '2026-01-05', '2026-01-10']);
});

test('R$ quoted values containing the delimiter', () => {
  const { analysis: a, res } = load('rs_quoted.csv');
  assert.equal(a.delimiter, ',');
  assert.equal(a.numberFormat, 'br');
  assert.equal(res.transactions.length, 6);
  assert.equal(res.transactions[0].rawDescription, 'ALUGUEL, SETEMBRO');
  assert.deepEqual(res.transactions.map(t => t.amount), [-250000, 789012, -123456, -98765, -123456, -1000]);
});

test('error rows are reported, not silently dropped', () => {
  const { res } = load('erros.csv');
  assert.equal(res.transactions.length, 3);
  assert.equal(res.errors.length, 2);
  assert.deepEqual(res.errors.map(e => e.rowIndex), [2, 3]);
  assert.ok(res.errors[1].raw.includes('VALOR RUIM'));
  assert.equal(res.total, -5900);
});

test('analyzeRows (XLSX cells incl. numbers and Date objects)', () => {
  const rows = [['Extrato'], [], ['Data', 'Histórico', 'Valor'], [new Date(2026, 8, 1), 'IFOOD', -32.5], ['02/09/2026', 'SALARIO', 5000], ['Saldo final', '', 4967.5]];
  const a = E.analyzeRows(rows);
  assert.equal(a.headerRowIndex, 2);
  const r = E.applyProfile(rows, E.profileFromAnalysis(a), { accountId: 'x', importId: 'i' });
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].date, '2026-09-01');
  assert.equal(r.total, -3250 + 500000);
});

test('fingerprint + matchProfile, profile overrides', () => {
  const a1 = load('itau_extrato.csv').analysis;
  const p = E.profileFromAnalysis(a1, { name: 'Itaú CC', defaultAccountId: 'itau' });
  assert.equal(p.name, 'Itaú CC');
  assert.equal(p.columns.amount, 2);
  const text = fs.readFileSync(path.join(FX, 'itau_extrato.csv'), 'utf8').replace('5.432,10', '5.000,00');
  const a2 = E.analyzeTable(text);
  assert.equal(E.matchProfile(a2, [p]), p);
  assert.equal(E.matchProfile(load('pipe.txt').analysis, [p]), null);
  const p2 = E.profileFromAnalysis(a1, { signConvention: 'positive_is_expense', columns: { balance: null } });
  assert.equal(p2.signConvention, 'positive_is_expense');
  assert.equal(p2.columns.balance, undefined);
  assert.equal(p2.columns.date, 0);
});

test('low-confidence analysis on garbage', () => {
  const a = E.analyzeTable('hello world\nfoo bar\n');
  assert.ok(a.overallConfidence < 0.5);
  assert.ok(a.warnings.length > 0);
});

test('stable ids with occurrence index for identical rows', () => {
  const rows = [['Data', 'Descrição', 'Valor'], ['01/09/2026', 'CAFE', '-5,00'], ['01/09/2026', 'CAFE', '-5,00']];
  const p = E.profileFromAnalysis(E.analyzeRows(rows));
  const r1 = E.applyProfile(rows, p, { accountId: 'a', importId: 'i1' });
  const r2 = E.applyProfile(rows, p, { accountId: 'a', importId: 'i2' });
  assert.notEqual(r1.transactions[0].id, r1.transactions[1].id);
  assert.deepEqual(r1.transactions.map(t => t.id), r2.transactions.map(t => t.id));
});

// ---------------------------------------------------------------- classification
function tx(o) {
  return Object.assign({ id: 't' + Math.random(), date: '2026-09-10', amount: -1000, rawDescription: 'X', accountId: 'cc', importId: 'i',
    kind: 'expense', categoryId: null, catSource: null, installment: null }, o, { merchant: o.merchant || E.normalizeDescription(o.rawDescription || 'X').merchant });
}

test('dictionary size and validity', () => {
  assert.ok(E.DEFAULT_DICTIONARY.length >= 120);
  const ids = new Set();
  for (const g of E.DEFAULT_CATEGORIES) { ids.add(g.id); for (const c of g.children) { ids.add(c.id); assert.ok(c.id.startsWith(g.id + '.')); assert.match(c.id, /^[a-z0-9_.]+$/); } }
  const colors = E.DEFAULT_CATEGORIES.map(g => g.color);
  assert.equal(new Set(colors).size, colors.length);
  for (const e of E.DEFAULT_DICTIONARY) if (e.categoryId) assert.ok(ids.has(e.categoryId), e.pattern + ' ' + e.categoryId);
});

test('classification order: user rule > learned > dictionary > null', () => {
  const t = tx({ rawDescription: 'IFD*IFOOD SAO PAULO BR' });
  assert.deepEqual(E.classify(t, { rules: [], dictionary: E.DEFAULT_DICTIONARY }),
    { kind: 'expense', categoryId: 'alimentacao.delivery', catSource: 'dictionary', merchant: 'IFOOD' });
  const learned = { id: 'l', match: { field: 'merchant', op: 'equals', value: 'IFOOD' }, set: { categoryId: 'alimentacao.restaurante' }, origin: 'learned', priority: 0 };
  assert.equal(E.classify(t, { rules: [learned] }).catSource, 'learned');
  const user = { id: 'u', match: { field: 'rawDescription', op: 'contains', value: 'ifood' }, set: { categoryId: 'lazer.eventos' }, origin: 'user', priority: 1 };
  const userHi = { id: 'u2', match: { field: 'merchant', op: 'startsWith', value: 'IF' }, set: { categoryId: 'pessoal.pets' }, origin: 'user', priority: 5 };
  assert.deepEqual(E.classify(t, { rules: [learned, user] }), { kind: 'expense', categoryId: 'lazer.eventos', catSource: 'rule', merchant: 'IFOOD' });
  assert.equal(E.classify(t, { rules: [learned, user, userHi] }).categoryId, 'pessoal.pets');
  const amt = { id: 'u3', match: { field: 'merchant', op: 'regex', value: '^IFO' }, amountMin: 5000, set: { categoryId: 'lazer.viagem' }, origin: 'user', priority: 9 };
  assert.equal(E.classify(t, { rules: [amt] }).categoryId, 'alimentacao.delivery');
  const unk = E.classify(tx({ rawDescription: 'LOJA DESCONHECIDA 123' }), {});
  assert.equal(unk.categoryId, null);
  assert.equal(unk.catSource, null);
  // manual is never overridden
  assert.equal(E.classify(Object.assign(t, { categoryId: 'pessoal.beleza', catSource: 'manual' }), {}).categoryId, 'pessoal.beleza');
});

test('kinds: income, card payment, investment, transfer, refund', () => {
  const K = (raw, amount, accountType) => E.classify(tx({ rawDescription: raw, amount }), { accountType });
  assert.equal(K('CRED SALARIO ACME', 500000).kind, 'income');
  assert.equal(K('CRED SALARIO ACME', 500000).categoryId, 'renda.salario');
  assert.equal(K('PROVENTOS', 500000).kind, 'income');
  assert.equal(K('PIX RECEBIDO FULANO', 10000).kind, 'income');
  assert.equal(K('TED RECEBIDA', 10000).kind, 'income');
  assert.equal(K('RENDIMENTO POUPANCA', 300).kind, 'income');
  assert.equal(K('PAGAMENTO FATURA NUBANK', -100000, 'checking').kind, 'card_payment');
  assert.equal(K('PGTO FATURA CARTAO', -100000, 'checking').kind, 'card_payment');
  assert.equal(K('PAG FATURA ITAUCARD', -100000).categoryId, null);
  assert.equal(K('PAGAMENTO RECEBIDO', 100000, 'credit_card').kind, 'card_payment');
  assert.equal(K('APLICACAO CDB', -100000, 'checking').kind, 'investment');
  assert.equal(K('RESGATE TESOURO', 100000, 'checking').kind, 'investment');
  assert.equal(K('TRANSF ENTRE CONTAS', -5000).kind, 'transfer');
  assert.equal(K('TRANSFERENCIA PROPRIA', 5000).kind, 'transfer');
  const est = K('ESTORNO NETFLIX.COM', 5590, 'credit_card');
  assert.equal(est.kind, 'expense');
  assert.equal(est.categoryId, 'lazer.streaming');
  // SALARIO keyword on a debit isn't income
  assert.notEqual(K('SALARIO DOMESTICA', -150000).kind, 'income');
});

test('learnFromCorrection creates a learned rule after 2 corrections', () => {
  const h = [];
  const a = tx({ id: 'a1', rawDescription: 'LOJA DO ZE 01' });
  const b = tx({ id: 'b1', rawDescription: 'LOJA DO ZE 02' });
  const r1 = E.learnFromCorrection(a, 'compras.casa', [], h);
  assert.equal(r1.created, null);
  const r1b = E.learnFromCorrection(a, 'compras.casa', r1.rules, h); // same tx twice doesn't count
  assert.equal(r1b.created, null);
  const r2 = E.learnFromCorrection(b, 'compras.casa', r1b.rules, h);
  assert.ok(r2.created);
  assert.equal(r2.created.origin, 'learned');
  assert.equal(r2.created.set.categoryId, 'compras.casa');
  const c = E.classify(tx({ rawDescription: 'LOJA DO ZE 03' }), { rules: r2.rules });
  assert.equal(c.categoryId, 'compras.casa');
  assert.equal(c.catSource, 'learned');
});

// ---------------------------------------------------------------- dedupe & linking
test('dedupe: same account/amount, ±2 days, similar merchant', () => {
  const ex = [tx({ id: 'e1', date: '2026-09-10', amount: -5000, rawDescription: 'IFOOD *REST', accountId: 'nu' })];
  const inc = [
    tx({ id: 'n1', date: '2026-09-11', amount: -5000, rawDescription: 'IFD*IFOOD REST', accountId: 'nu' }), // dup
    tx({ id: 'n2', date: '2026-09-15', amount: -5000, rawDescription: 'IFOOD *REST', accountId: 'nu' }), // too far
    tx({ id: 'n3', date: '2026-09-10', amount: -5000, rawDescription: 'IFOOD *REST', accountId: 'itau' }), // other account
    tx({ id: 'n4', date: '2026-09-10', amount: -5001, rawDescription: 'IFOOD *REST', accountId: 'nu' }), // amount differs
    tx({ id: 'n5', date: '2026-09-10', amount: -5000, rawDescription: 'POSTO SHELL', accountId: 'nu' }) // other merchant
  ];
  const r = E.dedupe(ex, inc);
  assert.deepEqual(r.duplicates.map(t => t.id), ['n1']);
  assert.deepEqual(r.fresh.map(t => t.id), ['n2', 'n3', 'n4', 'n5']);
  // re-importing the same file is fully duplicate
  const { res } = load('pipe.txt');
  assert.equal(E.dedupe(res.transactions, res.transactions).fresh.length, 0);
});

test('linkCardPayments marks bank-side fatura payment matching a card-side payment', () => {
  const txs = [
    tx({ id: 'bank', date: '2026-09-03', amount: -150000, rawDescription: 'PIX ENVIADO NU PAGAMENTOS', accountId: 'itau', kind: 'expense' }),
    tx({ id: 'card', date: '2026-09-05', amount: 150000, rawDescription: 'Pagamento recebido', accountId: 'nucard', kind: 'income' }),
    tx({ id: 'fat', date: '2026-09-07', amount: -80000, rawDescription: 'PAG FATURA ITAUCARD', accountId: 'itau', kind: 'expense', categoryId: 'servicos.bancos', catSource: 'dictionary' }),
    tx({ id: 'other', date: '2026-09-04', amount: -150000, rawDescription: 'ALUGUEL', accountId: 'itau', kind: 'expense' })
  ];
  const out = E.linkCardPayments(txs, [{ id: 'itau', type: 'checking' }, { id: 'nucard', type: 'credit_card' }]);
  const by = id => out.find(t => t.id === id);
  assert.equal(by('card').kind, 'card_payment');
  assert.equal(by('bank').kind, 'card_payment');
  assert.equal(by('bank').linkedTo, 'card');
  assert.equal(by('fat').kind, 'card_payment');
  assert.equal(by('fat').categoryId, null);
  assert.equal(by('other').kind, 'expense');
  assert.equal(txs[0].kind, 'expense', 'input not mutated');
});

// ---------------------------------------------------------------- aggregates
function sampleMonth() {
  const base = [
    tx({ id: 's1', date: '2026-09-01', amount: 800000, rawDescription: 'SALARIO', kind: 'income', categoryId: 'renda.salario', accountId: 'itau' }),
    tx({ id: 's2', date: '2026-09-02', amount: -250000, rawDescription: 'ALUGUEL', kind: 'expense', categoryId: 'moradia.aluguel', accountId: 'itau' }),
    tx({ id: 's3', date: '2026-09-03', amount: -45000, rawDescription: 'IFOOD', kind: 'expense', categoryId: 'alimentacao.delivery', accountId: 'nu' }),
    tx({ id: 's4', date: '2026-09-04', amount: -60000, rawDescription: 'CARREFOUR', kind: 'expense', categoryId: 'alimentacao.mercado', accountId: 'nu' }),
    tx({ id: 's5', date: '2026-09-05', amount: 5000, rawDescription: 'ESTORNO IFOOD', kind: 'expense', categoryId: 'alimentacao.delivery', accountId: 'nu' }),
    tx({ id: 's6', date: '2026-09-06', amount: -100000, rawDescription: 'PAG FATURA', kind: 'card_payment', accountId: 'itau' }),
    tx({ id: 's7', date: '2026-09-06', amount: 100000, rawDescription: 'PAGAMENTO RECEBIDO', kind: 'card_payment', accountId: 'nu' }),
    tx({ id: 's8', date: '2026-09-07', amount: -30000, rawDescription: 'TRANSF ENTRE CONTAS', kind: 'transfer', accountId: 'itau' }),
    tx({ id: 's9', date: '2026-09-08', amount: -12000, rawDescription: 'LOJA ???', kind: 'expense', categoryId: null, accountId: 'nu' }),
    tx({ id: 's10', date: '2026-09-09', amount: -100000, rawDescription: 'APLICACAO CDB', kind: 'investment', categoryId: 'investimentos.aplicacoes', accountId: 'itau' }),
    tx({ id: 'old', date: '2026-08-15', amount: -99999, rawDescription: 'OUTRO MES', kind: 'expense', categoryId: 'lazer.bares', accountId: 'nu' })
  ];
  return base;
}

test('summarize excludes card payments and transfers; refunds reduce expense', () => {
  const s = E.summarize(sampleMonth(), { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(s.income, 800000);
  assert.equal(s.expense, 250000 + 45000 + 60000 - 5000 + 12000);
  assert.equal(s.net, s.income - s.expense);
  assert.equal(s.byCategory['alimentacao.delivery'], 40000);
  assert.equal(s.byGroup.alimentacao, 100000);
  assert.equal(s.byCategory.uncategorized, 12000);
  assert.equal(s.byAccount.nu, 45000 + 60000 - 5000 + 12000);
  assert.equal(s.count, 10);
});

function checkSankey(sk) {
  const ids = sk.nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const l of sk.links) {
    assert.ok(Number.isInteger(l.value) && l.value > 0, 'positive int link');
    assert.ok(ids.includes(l.source) && ids.includes(l.target), 'link endpoints exist');
    const s = sk.nodes.find(n => n.id === l.source), t = sk.nodes.find(n => n.id === l.target);
    assert.ok(s.column < t.column, 'flows left to right (no cycles)');
  }
  const hubIn = sum(sk.links.filter(l => l.target === 'hub').map(l => l.value));
  const hubOut = sum(sk.links.filter(l => l.source === 'hub').map(l => l.value));
  assert.equal(hubIn, hubOut, 'hub balanced');
  // every middle node balanced
  for (const n of sk.nodes) {
    const i = sum(sk.links.filter(l => l.target === n.id).map(l => l.value));
    const o = sum(sk.links.filter(l => l.source === n.id).map(l => l.value));
    if (i && o) assert.equal(i, o, 'node balanced ' + n.id);
    assert.equal(n.value, Math.max(i, o));
  }
  return { hubIn, hubOut };
}

test('buildSankey: surplus, exclusions, balance', () => {
  const sk = E.buildSankey(sampleMonth(), { from: '2026-09-01', to: '2026-09-30', categories: E.DEFAULT_CATEGORIES, view: 'category' });
  const { hubIn } = checkSankey(sk);
  assert.equal(hubIn, 800000);
  const sobra = sk.links.find(l => l.target === 'sobra');
  assert.equal(sobra.value, 800000 - (362000 + 100000));
  assert.ok(!sk.nodes.some(n => n.id === 'deficit'));
  assert.ok(!sk.nodes.some(n => /FATURA|TRANSF/i.test(n.name)));
  assert.equal(sk.nodes.find(n => n.id === 'hub').column, 1);
  assert.equal(sk.links.find(l => l.source === 'grp:alimentacao' && l.target === 'cat:alimentacao.delivery').value, 40000);
});

test('buildSankey: deficit, account view, maxNodes folding', () => {
  const txs = [tx({ date: '2026-09-01', amount: 100000, rawDescription: 'SALARIO', kind: 'income', categoryId: 'renda.salario' })];
  const cats = E.DEFAULT_CATEGORIES.filter(g => g.kind === 'expense').flatMap(g => g.children.map(c => c.id));
  cats.forEach((c, i) => txs.push(tx({ date: '2026-09-02', amount: -(1000 + i * 137), rawDescription: 'X' + i, kind: 'expense', categoryId: c, accountId: 'acc' + (i % 11) })));
  const total = -sum(txs.filter(t => t.amount < 0).map(t => t.amount));
  const sk = E.buildSankey(txs, { maxNodes: 5 });
  const { hubIn } = checkSankey(sk);
  assert.equal(hubIn, Math.max(100000, total));
  assert.equal(sk.links.find(l => l.source === 'deficit').value, total - 100000);
  for (const col of [0, 2, 3]) assert.ok(sk.nodes.filter(n => n.column === col).length <= 5, 'col ' + col);
  assert.ok(sk.nodes.some(n => n.name === 'Outros'));
  const ska = E.buildSankey(txs, { view: 'account', maxNodes: 4, accounts: [{ id: 'acc0', name: 'Nubank', type: 'credit_card' }] });
  checkSankey(ska);
  assert.ok(ska.nodes.some(n => n.name === 'Nubank' && n.column === 2));
  assert.ok(ska.nodes.filter(n => n.column === 2).length <= 4);
  assert.deepEqual(E.buildSankey([], {}), { nodes: [], links: [], meta: { income: 0, expense: 0, surplus: 0, deficit: 0 } });
});

test('buildSankey with payslip: gross salary source, taxes leaf, bank net deposit not double counted', () => {
  const slip = { date: '2026-09-05', gross: 1000000, inss: 90000, irrf: 150000, otherDeductions: [{ name: 'Plano de saúde', amount: 20000 }], net: 740000, employer: 'ACME', accountId: 'holerite' };
  const bank = [
    tx({ id: 'dep', date: '2026-09-05', amount: 740000, rawDescription: 'CRED SALARIO ACME', kind: 'income', categoryId: 'renda.salario', accountId: 'itau' }),
    tx({ id: 'al', date: '2026-09-06', amount: -300000, rawDescription: 'ALUGUEL', kind: 'expense', categoryId: 'moradia.aluguel', accountId: 'itau' })
  ];
  const sk = E.buildSankey(bank, { payslips: [slip] });
  const { hubIn } = checkSankey(sk);
  assert.equal(hubIn, 1000000);
  assert.equal(sk.links.find(l => l.source === 'src:renda.salario').value, 1000000);
  assert.equal(sk.links.find(l => l.target === 'grp:impostos').value, 240000);
  assert.equal(sk.links.find(l => l.target === 'sobra').value, 1000000 - 240000 - 20000 - 300000);
});

test('payslipToTransactions: gross - deductions = net', () => {
  const t = E.payslipToTransactions({ date: '2026-09-05', gross: 1000000, inss: 90000, irrf: 150000, otherDeductions: [{ name: 'Vale transporte', amount: 12000 }], net: 740000, employer: 'Acme', accountId: 'h' });
  assert.equal(sum(t.map(x => x.amount)), 740000);
  const g = t.find(x => x.amount > 0);
  assert.equal(g.categoryId, 'renda.salario');
  assert.equal(g.kind, 'income');
  assert.equal(t.find(x => x.rawDescription === 'INSS').categoryId, 'impostos.inss');
  assert.equal(t.find(x => x.rawDescription === 'IRRF').categoryId, 'impostos.ir');
  assert.equal(t.find(x => x.rawDescription === 'Vale transporte').categoryId, 'transporte.publico');
  assert.equal(t.find(x => x.rawDescription === 'Outros descontos').amount, -8000);
  for (const x of t) { assert.equal(x.date, '2026-09-05'); assert.equal(x.accountId, 'h'); assert.ok(x.id); }
  const onlyNet = E.payslipToTransactions({ date: '2026-09-05', net: 500000, employer: 'X' });
  assert.equal(onlyNet.length, 1);
  assert.equal(onlyNet[0].amount, 500000);
  const noNet = E.payslipToTransactions({ date: '2026-09-05', gross: 100000, inss: 7500 });
  assert.equal(sum(noNet.map(x => x.amount)), 92500);
});

test('futureInstallments projects remaining parcelas', () => {
  const { res } = load('cartao_parcelas.csv');
  const fut = E.futureInstallments(E.classifyAll(res.transactions, { accountType: 'credit_card' }));
  // v2 booking: LOJA X 3/10 bought 15/09 -> booked 2026-11 -> 4..10 => Dec 2026..Jun 2027 ;
  // LOJA Y 1/3 bought 20/08 -> Sep, Oct ; SHEIN 2/4 bought 28/08 -> booked Sep -> Oct, Nov
  const by = Object.fromEntries(fut.map(f => [f.month, f]));
  assert.equal(by['2026-09'].total, 30000);
  assert.equal(by['2026-10'].total, 30000 + 8000);
  assert.equal(by['2026-11'].total, 8000);
  assert.equal(by['2026-12'].total, 10000);
  assert.equal(by['2027-06'].total, 10000);
  assert.equal(by['2027-07'], undefined);
  assert.equal(sum(fut.map(f => f.items.length)), 7 + 2 + 2);
  assert.deepEqual(fut.map(f => f.month), fut.map(f => f.month).slice().sort());
});

test('monthlySeries and formatBRL', () => {
  const ms = E.monthlySeries(sampleMonth(), 3, '2026-09');
  assert.deepEqual(ms.map(m => m.month), ['2026-07', '2026-08', '2026-09']);
  assert.equal(ms[1].expense, 99999);
  assert.equal(ms[2].income, 800000);
  assert.equal(ms[2].expense, 362000);
  assert.equal(E.formatBRL(123456), 'R$ 1.234,56');
  assert.equal(E.formatBRL(-5), '-R$ 0,05');
  assert.equal(E.formatBRL(0), 'R$ 0,00');
  assert.equal(E.formatBRL(100000000), 'R$ 1.000.000,00');
});

// ---------------------------------------------------------------- AI
test('buildAIPrompt masks description digits, keeps dates/amounts, max 40 rows', () => {
  const { analysis: a } = load('nubank_conta.csv');
  const p = E.buildAIPrompt(a);
  assert.ok(p.includes('01/09/2026'));
  assert.ok(p.includes('8500.00'));
  assert.ok(!p.includes('12.345.678/0001-90'));
  assert.ok(p.includes('99.999.999/9999-99'));
  assert.ok(/JSON/.test(p) && /signConvention/.test(p) && /headerRowIndex/.test(p) && /skipTop/.test(p));
  const big = [['Data', 'Descrição', 'Valor']];
  for (let i = 0; i < 100; i++) big.push(['01/09/2026', 'LOJA ' + i, '-1,00']);
  const p2 = E.buildAIPrompt(E.analyzeRows(big));
  assert.ok(p2.includes('39: '));
  assert.ok(!p2.includes('\n40: '));
});

test('validateAIProfile accepts a good mapping and reports a bad one', () => {
  const { analysis: a } = load('itau_extrato.csv');
  const good = '```json\n{"headerRowIndex":4,"skipTop":5,"columns":{"date":0,"description":1,"amount":2},"dateFormat":"DD/MM/YYYY","numberFormat":"br","signConvention":"negative_is_expense"}\n```';
  const r = E.validateAIProfile(good, a);
  assert.deepEqual(r.problems, []);
  assert.equal(r.profile.columns.amount, 2);
  const res = E.applyProfile(a.rows, r.profile, { accountId: 'x', importId: 'y' });
  assert.equal(res.transactions.length, 7);
  const bad = E.validateAIProfile({ headerRowIndex: 4, skipTop: 5, columns: { date: 1, description: 9, amount: 0 }, dateFormat: 'DD/MM/YYYY', numberFormat: 'br', signConvention: 'weird' }, a);
  assert.ok(bad.problems.some(p => /inexistente/.test(p)));
  assert.ok(bad.problems.some(p => /80%/.test(p)));
  assert.ok(bad.problems.some(p => /signConvention/.test(p)));
  assert.ok(E.validateAIProfile('not json', a).problems.length > 0);
});

test('classify: generic "TED/PIX RECEBIDO" does not shadow a specific salary match', () => {
  const mk = raw => ({ rawDescription: raw, merchant: E.normalizeDescription(raw).merchant, amount: 854000, accountId: 'b' });
  assert.equal(E.classify(mk('TED RECEBIDA SALARIO ACME LTDA'), {}).categoryId, 'renda.salario');
  assert.equal(E.classify(mk('PIX RECEBIDO CARLOS'), {}).categoryId, 'renda.outros');
});

test('linkCardPayments + classify with accounts: card-side positive payment is card_payment', () => {
  const accs = [{ id: 'c', type: 'credit_card' }];
  const t = { id: 'x', date: '2026-09-05', amount: 150000, rawDescription: 'Pagamento recebido', merchant: 'PAGAMENTO RECEBIDO', accountId: 'c' };
  assert.equal(E.linkCardPayments([t], accs)[0].kind, 'card_payment');
  assert.equal(E.classify(t, { accounts: accs }).kind, 'card_payment');
});


// =====================================================================================================
// v2
// =====================================================================================================
const v2load = (name, accountId, opts) => {
  const text = fs.readFileSync(path.join(FX, name), 'utf8');
  const analysis = E.analyzeTable(text);
  const profile = E.profileFromAnalysis(analysis);
  const res = E.applyProfile(text, profile, Object.assign({ accountId: accountId || 'xp-cartao', importId: 'imp-' + name }, opts || {}));
  return { analysis, profile, res };
};
const accsV2 = [{ id: 'xp-cartao', name: 'XP cartão', type: 'credit_card' }, { id: 'xp-conta', name: 'XP conta', type: 'checking' }];
const ctxV2 = extra => Object.assign({ rules: [], dictionary: E.DEFAULT_DICTIONARY, accounts: accsV2 }, extra || {});

test('v2 installments: Parcela column values parsed ("3 de 10", "3/10", "03/10", "Parcela 3 de 10", "-", "Única", "1x")', () => {
  const P = E.parseInstallmentText;
  assert.deepEqual(P('3 de 10'), { n: 3, total: 10 });
  assert.deepEqual(P('3/10'), { n: 3, total: 10 });
  assert.deepEqual(P('03/10'), { n: 3, total: 10 });
  assert.deepEqual(P('Parcela 3 de 10'), { n: 3, total: 10 });
  assert.deepEqual(P('Parc. 3/10'), { n: 3, total: 10 });
  for (const none of ['-', 'Única', 'UNICA', '1x', '', '1/1']) { assert.equal(P(none), null, none); assert.ok(E.isInstallmentCell(none), none); }
  assert.ok(!E.isInstallmentCell('IFOOD'));
});

test('v2 D1: XP fatura with Parcela column — detected, booked in the month of the parcela, originalDate kept', () => {
  const { analysis: a, res } = v2load('xp_fatura_ago.csv');
  assert.equal(roleIdx(a, 'installment'), 4);
  assert.equal(roleIdx(a, 'description'), 1);
  assert.equal(roleIdx(a, 'amount'), 3);
  assert.equal(a.signConvention, 'positive_is_expense');
  assert.equal(res.errors.length, 0);
  const loja = res.transactions.find(t => /LOJA TESTE/.test(t.rawDescription));
  assert.deepEqual(loja.installment, { n: 3, total: 10 });
  assert.equal(loja.originalDate, '2026-06-10');
  assert.equal(loja.date, '2026-08-10');
  const havan = res.transactions.find(t => /HAVAN/.test(t.rawDescription));
  assert.equal(havan.date, '2026-09-02'); // 9 de 10 from 02/01 -> 02/09 (not January)
  // end-of-month clamp: 31/07 + 1 month -> 31/08 ; 31/01 + 1 -> 28/02 ; leap year 29/02
  assert.equal(res.transactions.find(t => /MOVEIS/.test(t.rawDescription)).date, '2026-08-31');
  assert.equal(E.shiftDateMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(E.shiftDateMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(E.shiftDateMonths('2026-12-15', 2), '2027-02-15');
  assert.equal(res.transactions.find(t => /FARMACIA/.test(t.rawDescription)).installment, null);
  assert.equal(res.transactions.find(t => /NETFLIX/.test(t.rawDescription)).originalDate, undefined);
  // the card file looks like a card
  assert.equal(E.guessAccountType(a, res.transactions), 'credit_card');
});

test('v2 D1: next month\'s fatura with parcela n+1 is NOT a duplicate; the same file again is', () => {
  const ago = v2load('xp_fatura_ago.csv').res.transactions;
  const set = v2load('xp_fatura_set.csv').res.transactions;
  const dd = E.dedupe(ago, set);
  assert.equal(dd.duplicates.length, 0, JSON.stringify(dd.duplicates.map(d => d.rawDescription)));
  assert.equal(dd.fresh.length, 4);
  const again = E.dedupe(ago, v2load('xp_fatura_ago.csv').res.transactions);
  assert.equal(again.fresh.length, 0);
  // same purchase, same amount, n differs, dates within 2 days (hand-made) -> still not a duplicate
  const a = { id: 'a', accountId: 'c', amount: -1000, date: '2026-09-10', merchant: 'LOJA', installment: { n: 3, total: 10 } };
  const b = Object.assign({}, a, { id: 'b', date: '2026-09-11', installment: { n: 4, total: 10 } });
  assert.equal(E.dedupe([a], [b]).fresh.length, 1);
});

test('v2 D1: no double counting — projected parcelas never enter summarize/sankey/series; a real parcela replaces its projection', () => {
  const ago = E.classifyAll(v2load('xp_fatura_ago.csv').res.transactions, ctxV2());
  const sep = E.classifyAll(v2load('xp_fatura_set.csv').res.transactions, ctxV2());
  const sOnlyAgo = E.summarize(ago, { from: '2026-09-01', to: '2026-09-30' });
  // only HAVAN 9/10 (booked 02/09) is in September from the August file
  assert.equal(sOnlyAgo.expense, 1399);
  const fut = E.futureInstallments(ago);
  const fSep = fut.find(f => f.month === '2026-09');
  assert.ok(fSep.items.some(i => /LOJA TESTE/.test(i.merchant) && i.n === 4));
  const both = ago.concat(sep);
  const s = E.summarize(both, { from: '2026-09-01', to: '2026-09-30' });
  // real Sept parcelas: LOJA 4/10 (10/09) 15000 + MOVEIS 3/3 (30/09) 20000 + IFOOD 4590 + HAVAN 9/10 1399 (HAVAN 10/10 is October)
  assert.equal(s.expense, 15000 + 20000 + 4590 + 1399);
  const series = E.monthlySeries(both, 2, '2026-09');
  assert.equal(series[1].expense, s.expense);
  const sk = E.buildSankey(both, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(sk.meta.expense, s.expense);
  const fut2 = E.futureInstallments(both);
  assert.ok(!fut2.some(f => f.month === '2026-09'), 'September is real now, not projected');
  const oct = fut2.find(f => f.month === '2026-10');
  assert.ok(oct.items.some(i => /LOJA TESTE/.test(i.merchant) && i.n === 5));
  assert.ok(!oct.items.some(i => /HAVAN/.test(i.merchant)), 'HAVAN 10/10 is the last one, nothing left to project from it');
});

test('v2 D2/item 4: bank extrato with a time column (HH:MM[:SS]) and datetime cells', () => {
  const { analysis: a, res } = v2load('xp_extrato_hora.csv', 'xp-conta');
  assert.equal(roleIdx(a, 'time'), 1);
  assert.equal(roleIdx(a, 'description'), 2);
  assert.equal(roleIdx(a, 'amount'), 3);
  assert.equal(roleIdx(a, 'balance'), 4);
  assert.equal(a.dateFormat, 'DD/MM/YY');
  assert.equal(res.transactions[0].time, '08:15');
  assert.equal(res.transactions[1].time, '09:30');
  assert.equal(E.guessAccountType(a, res.transactions), 'checking');
  const dt = E.applyProfile([['Data', 'Descrição', 'Valor'], ['15/09/2026 14:32', 'PADARIA X', '-10,00'], ['16/09/2026', 'PADARIA Y', '-5,00']],
    { columns: { date: 0, description: 1, amount: 2 }, headerRowIndex: 0, dateFormat: 'DD/MM/YYYY', numberFormat: 'br', signConvention: 'negative_is_expense' }, { accountId: 'x' });
  assert.equal(dt.transactions[0].time, '14:32');
  assert.equal(dt.transactions[1].time, undefined);
  assert.equal(E.parseTime('25:00'), null);
});

test('v2 D3: kind follows the category group', () => {
  assert.equal(E.kindForCategory('renda.salario'), 'income');
  assert.equal(E.kindForCategory('renda'), 'income');
  assert.equal(E.kindForCategory('investimentos.aplicacoes'), 'investment');
  assert.equal(E.kindForCategory('alimentacao.mercado'), 'expense');
  assert.equal(E.kindForCategory('nao.existe'), null);
  const t = { id: 't', amount: 400000, kind: 'expense', categoryId: 'renda.salario', catSource: 'manual', rawDescription: 'TED recebida de X' };
  assert.equal(E.applyCategoryKind(t).kind, 'income');
  // a learned income rule on a positive deposit wins over the credit-card "positive = refund" default
  const rule = { id: 'r', match: { field: 'merchant', op: 'equals', value: 'TED RECEBIDA DE EMPRESA' }, set: { categoryId: 'renda.salario' }, origin: 'learned', sign: 'in' };
  const c = E.classify({ rawDescription: 'TED RECEBIDA DE EMPRESA', amount: 500000, accountId: 'xp-cartao' }, ctxV2({ rules: [rule] }));
  assert.equal(c.categoryId, 'renda.salario');
  assert.equal(c.kind, 'income');
  // ...and never matches a debit of the same name (sign-restricted)
  assert.equal(E.classify({ rawDescription: 'TED RECEBIDA DE EMPRESA', amount: -500, accountId: 'xp-conta' }, ctxV2({ rules: [rule] })).catSource, null);
  // a positive amount on an expense category stays an expense (refund)
  assert.equal(E.applyCategoryKind({ amount: 370, kind: 'income', categoryId: 'transporte.pedagio' }).kind, 'expense');
});

test('v2 D3/D6/item 13: migrateData fixes kinds, merchants, imports, updatedAt — idempotent, manual kept, nothing deleted', () => {
  const now = '2026-10-02T10:00:00.000Z';
  const txs = [
    { id: 'a', date: '2026-09-02', amount: 1234500, rawDescription: 'TED recebida de EMPRESA TESTE', merchant: 'TED RECEBIDA DE EMPRESA TESTE', kind: 'expense', categoryId: 'renda.reembolsos', catSource: 'manual', importId: 'imp-extrato01', accountId: 'cartao' },
    { id: 'b', date: '2026-09-04', amount: 512300, rawDescription: 'TED recebida de EMPRESA TESTE', merchant: 'TED RECEBIDA DE EMPRESA TESTE', kind: 'expense', categoryId: 'renda.salario', catSource: 'manual', importId: 'imp-extrato01', accountId: 'cartao' },
    { id: 'c', date: '2026-09-30', amount: 18, rawDescription: 'Rendimento automático do dia 22/09/2026', merchant: 'RENDIMENTO AUTOMATICO DO DIA', kind: 'income', categoryId: 'renda.rendimentos', catSource: 'dictionary', importId: 'imp-extrato01', accountId: 'cartao' },
    { id: 'd', date: '2026-08-26', amount: -25000, rawDescription: 'Pix enviado para Mercado Pago Instituicao de Pagamento Ltda', merchant: 'PIX ENVIADO PARA MERCADO PAGO INSTITUICA', kind: 'expense', categoryId: 'alimentacao.mercado', catSource: 'dictionary', importId: 'imp-extrato01', accountId: 'cartao' },
    { id: 'e', date: '2026-07-06', amount: -8000, rawDescription: 'CLINICA SORRISO', merchant: 'CLINICA SORRISO', kind: 'expense', categoryId: 'saude', catSource: 'manual', importId: 'imp-fatura01', accountId: 'cartao' },
    { id: 'f', date: '2026-07-13', amount: -12000, rawDescription: 'CLINICA SORRISO', merchant: 'CLINICA SORRISO', kind: 'expense', categoryId: null, catSource: null, importId: 'imp-fatura01', accountId: 'cartao' },
    { id: 'g', date: '2026-07-07', amount: 300000, rawDescription: 'Pix recebido de Fulano', merchant: 'PIX RECEBIDO FULANO', kind: 'transfer', categoryId: null, catSource: 'manual', importId: 'imp-extrato01', accountId: 'cartao' },
    { id: 'h', deleted: true, date: '2026-07-01' }
  ];
  const history = [{ txId: 'e', merchant: 'CLINICA SORRISO', categoryId: 'saude' }, { txId: 'a', merchant: 'TED RECEBIDA DE EMPRESA TESTE', categoryId: 'renda.reembolsos' }, { txId: 'b', merchant: 'TED RECEBIDA DE EMPRESA TESTE', categoryId: 'renda.salario' }];
  const input = { settings: { budgets: {} }, rules: [], history, accounts: [{ id: 'cartao', name: 'Cartao Teste', type: 'credit_card' }], txs };
  const m = E.migrateData(input, { now });
  const by = Object.fromEntries(m.data.txs.map(t => [t.id, t]));
  assert.equal(by.a.kind, 'income'); assert.equal(by.a.categoryId, 'renda.reembolsos'); assert.equal(by.a.catSource, 'manual');
  assert.equal(by.b.kind, 'income');
  assert.equal(by.c.merchant, 'RENDIMENTO AUTOMATICO');
  assert.equal(by.d.categoryId, null, 'D5: Mercado Pago is an intermediary, not a supermarket');
  assert.equal(by.g.kind, 'transfer');
  assert.ok(by.h.deleted);
  assert.equal(m.data.txs.length, txs.length, 'nothing deleted');
  assert.ok(m.data.txs.every(t => t.updatedAt));
  assert.equal(m.data.settings.schemaVersion, 2);
  assert.equal(Object.keys(m.data.imports).length, 2);
  assert.equal(m.data.imports['imp-extrato01'].count, 5);
  assert.equal(m.data.imports['imp-fatura01'].accountId, 'cartao');
  assert.match(m.data.imports['imp-extrato01'].fileName, /Extrato/);
  // D4: consistent corrections become learned rules (CLINICA SORRISO), contradictory ones (TED) do not
  assert.ok(m.data.rules.some(r => r.match.value === 'CLINICA SORRISO' && r.set.categoryId === 'saude' && r.origin === 'learned'));
  assert.ok(!m.data.rules.some(r => /TED RECEBIDA/.test(r.match.value)));
  assert.equal(by.f.categoryId, 'saude'); assert.equal(by.f.catSource, 'learned');
  const sum = E.summarize(m.data.txs, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(sum.income, 1234500 + 512300 + 18);
  // idempotent
  const m2 = E.migrateData(m.data, { now: '2026-10-03T00:00:00.000Z' });
  assert.deepEqual(m2.changedTxIds, []);
  assert.deepEqual(m2.changedMeta, []);
  assert.deepEqual(m2.data.txs, m.data.txs);
});

test('v2 D4: learnFromCorrection — immediate when "Lembrar" is ticked; two corrections of different txs otherwise', () => {
  const t1 = { id: 'x1', rawDescription: 'CLINICA SORRISO', merchant: 'CLINICA SORRISO', amount: -8000 };
  const t2 = { id: 'x2', rawDescription: 'CLINICA SORRISO', merchant: 'CLINICA SORRISO', amount: -12000 };
  const im = E.learnFromCorrection(t1, 'saude', [], [], { immediate: true });
  assert.ok(im.created); assert.equal(im.created.match.value, 'CLINICA SORRISO');
  const h = [];
  assert.equal(E.learnFromCorrection(t1, 'saude', [], h).created, null);
  const r2 = E.learnFromCorrection(t2, 'saude', [], h);
  assert.ok(r2.created, 'CLINICA SORRISO corrected twice identically -> rule');
  const inc = E.learnFromCorrection({ id: 'y', merchant: 'TED RECEBIDA DE X', rawDescription: 'TED RECEBIDA DE X', amount: 100 }, 'renda.salario', [], [], { immediate: true });
  assert.equal(inc.created.sign, 'in');
});

test('v2 D5/item 8: ambiguous merchants never auto-assign; word boundaries; specific beats ambiguous', () => {
  const C = (raw, amount) => E.classify({ rawDescription: raw, amount: amount == null ? -1000 : amount, accountId: 'x' }, {});
  assert.equal(C('Pix enviado para Mercado Pago Instituicao de Pagamento Ltda').categoryId, null);
  assert.equal(C('MP *MERCADOLIVRE').categoryId, null);
  assert.equal(C('MERCADOLIVRE*RELAXMEDI').categoryId, null);
  assert.equal(C('AMAZON MARKETPLACE').categoryId, null);
  assert.equal(C('AMAZON PRIME VIDEO').categoryId, 'lazer.streaming');
  assert.equal(C('PRIME VIDEO').categoryId, 'lazer.streaming');
  assert.equal(C('GOOGLE YOUTUBE').categoryId, 'lazer.streaming');
  assert.equal(C('GOOGLE ONE').categoryId, 'servicos.software');
  assert.equal(C('GOOGLE *ADS').categoryId, null);
  assert.equal(C('APPLE.COM/BILL').categoryId, null);
  assert.equal(C('PAYPAL *FOO').categoryId, null);
  assert.equal(C('UBER EATS').categoryId, 'alimentacao.delivery');
  assert.equal(C('UBER *TRIP').categoryId, 'transporte.app');
  assert.equal(C('DL*UBERRIDES').categoryId, 'transporte.app');
  assert.equal(C('99FOOD').categoryId, 'alimentacao.delivery');
  assert.equal(C('99APP *99RIDE').categoryId, 'transporte.app');
  assert.equal(C('SHOPEE').categoryId, null);
  assert.equal(C('HAVAN CENTRO').categoryId, null);
  assert.equal(C('CARREFOUR HIPER').categoryId, 'alimentacao.mercado');
  assert.equal(C('POSTO IPIRANGA').categoryId, 'transporte.combustivel');
  assert.equal(C('AM PM CONVENIENCIA').categoryId, 'alimentacao.mercado');
  assert.equal(C('BR MANIA').categoryId, 'alimentacao.mercado');
  assert.equal(C('LEROY MERLIN').categoryId, 'compras.casa');
  // word boundaries: OI/TIM/DIA/MAX/EXTRA/AMIL/ENEL inside other words never match
  assert.equal(C('DOIS IRMAOS LANCHES').categoryId, null);
  assert.equal(C('ESTIMULO ARTES').categoryId, null);
  assert.equal(C('MEDIA MARKT').categoryId, null);
  assert.equal(C('MAXIMO ACABAMENTOS').categoryId, null);
  assert.equal(C('HORA EXTRA LTDA').categoryId, null);
  assert.equal(C('FAMILIA SOUZA').categoryId, null);
  assert.equal(C('PAINEL SOLAR').categoryId, null);
  assert.equal(C('VIVO').categoryId, 'servicos.telefone');
  assert.equal(C('DROGARIAS PACHECO').categoryId, 'saude.farmacia', 'plural S tolerated');
  // generic words are never patterns on their own
  for (const e of E.DEFAULT_DICTIONARY) {
    if (e.pattern[0] === '/') { for (const w of E.GENERIC_WORDS) assert.ok(!new RegExp(e.pattern.slice(1, e.pattern.lastIndexOf('/'))).test(w) || /^(EXTRA)$/.test(w) && false, e.pattern + ' matches bare ' + w); }
    else assert.ok(!E.GENERIC_WORDS.includes(e.pattern), 'generic pattern ' + e.pattern);
  }
  for (const w of E.GENERIC_WORDS) assert.equal(C(w).categoryId, null, w);
  // suggestions for ambiguous hits feed the triage
  const sug = E.suggestCategories({ rawDescription: 'MP *MERCADOLIVRE', amount: -100 }, {});
  assert.ok(sug.length >= 2 && sug[0].categoryId === 'compras.marketplace');
  assert.ok(E.ambiguousMatch({ rawDescription: 'SHOPEE', amount: -1 }, {}));
  const audit = fs.readFileSync(path.join(__dirname, '..', 'DICTIONARY_AUDIT.md'), 'utf8');
  for (const e of E.DEFAULT_DICTIONARY.filter(x => x.ambiguous)) assert.ok(audit.includes(e.pattern.replace(/\\\\/g, '\\')), 'audit lists ' + e.pattern);
});

test('v2 D6: "DO DIA <data>" suffixes are stripped', () => {
  const N = s => E.normalizeDescription(s).merchant;
  assert.equal(N('Rendimento automático do dia 22/09/2026'), N('Rendimento automático'));
  assert.equal(N('TARIFA PACOTE REF 09/2026'), 'TARIFA PACOTE');
  assert.equal(N('Pix enviado para Fulana de Tal'), 'PIX ENVIADO FULANA DE TAL');
});

test('v2 item 10: payslip with adiantamento salarial (percentage of gross, own date)', () => {
  const p = { date: '2026-10-05', gross: 1000000, inss: 95159, irrf: 214231, employer: 'Acme', accountId: 'h', advance: { enabled: true, percent: 40 } };
  const sp = E.payslipSplit(p);
  assert.equal(sp.advance, 400000);
  assert.equal(sp.net, 1000000 - 95159 - 214231);
  assert.equal(sp.finalDeposit, sp.net - 400000);
  assert.equal(sp.advanceDate, '2026-09-20');
  assert.equal(E.defaultAdvanceDate('2026-10-25'), '2026-10-20');
  const txs = E.payslipToTransactions(p);
  const inc = txs.filter(t => t.kind === 'income');
  assert.equal(inc.length, 2);
  assert.equal(sum(inc.map(t => t.amount)), 1000000, 'income over both dates totals gross');
  const adv = inc.find(t => t.payslipRole === 'advance');
  assert.equal(adv.date, '2026-09-20'); assert.equal(adv.amount, 400000);
  assert.equal(inc.find(t => t.payslipRole === 'gross').date, '2026-10-05');
  assert.equal(sum(txs.filter(t => t.kind === 'expense').map(t => t.amount)), -(95159 + 214231));
  assert.ok(txs.filter(t => t.kind === 'expense').every(t => /^impostos\./.test(t.categoryId)));
  // bank deposits (advance on the 20th, rest on the 5th) are recognised and not double counted
  const bank = [
    { id: 'b1', date: '2026-09-20', amount: 400000, kind: 'income', categoryId: 'renda.salario', accountId: 'cc', rawDescription: 'TED RECEBIDA ACME' },
    { id: 'b2', date: '2026-10-05', amount: sp.finalDeposit, kind: 'income', categoryId: 'renda.salario', accountId: 'cc', rawDescription: 'TED RECEBIDA ACME' }];
  const s9 = E.summarize(txs.concat(bank), { from: '2026-09-01', to: '2026-10-31' });
  assert.equal(s9.income, 1000000);
  const off = E.payslipSplit({ gross: 1000000, inss: 0, advance: { enabled: false } });
  assert.equal(off.advance, 0); assert.equal(off.finalDeposit, 1000000);
  assert.equal(E.payslipSplit({ gross: 1000000, advance: { enabled: true, percent: 30, date: '2026-09-15' } }).advanceDate, '2026-09-15');
});

test('v2 item 9: moveImport re-derives kinds for the new account type; tombstones vanish from every view', () => {
  const card = 'xp-cartao', bank = 'xp-conta';
  const { res } = v2load('xp_extrato_hora.csv', card);
  let txs = E.classifyAll(res.transactions, ctxV2());
  const ted = txs.find(t => /TED/.test(t.rawDescription));
  assert.equal(ted.kind, 'expense', 'on a credit-card account a positive amount looks like a refund (the D2 situation)');
  const moved = E.moveImport(txs, 'imp-xp_extrato_hora.csv', bank, ctxV2({ now: 'N' }));
  const ted2 = moved.find(t => t.id === ted.id);
  assert.equal(ted2.accountId, bank);
  assert.equal(ted2.kind, 'income');
  assert.equal(ted2.updatedAt, 'N');
  // tombstones
  const tomb = E.tombstonesForImport(moved, 'imp-xp_extrato_hora.csv', 'T');
  assert.equal(tomb.length, moved.length);
  assert.ok(tomb.every(t => t.deleted && t.updatedAt === 'T' && t.date));
  const merged = tomb;
  const s = E.summarize(merged, {});
  assert.equal(s.count, 0); assert.equal(s.income, 0);
  assert.deepEqual(E.buildSankey(merged, {}).nodes, []);
  assert.equal(E.futureInstallments(merged).length, 0);
  assert.equal(E.dedupe(merged, res.transactions).fresh.length, res.transactions.length);
  assert.ok(E.classifyAll(merged, {}).every(t => t.deleted));
});
