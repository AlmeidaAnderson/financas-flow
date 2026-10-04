// v2.4b — PDF statements (layout reconstruction) + foreign currencies. node --test
// Synthetic item lists (pure engine) + the synthetic PDFs of test/fixtures/pdf (read with pdfjs-dist, the same pdf.js the
// app loads) + the user's two real PDFs when present (FF_REAL_PDF_DIR; only counts/booleans are asserted — no names or
// amounts of the real files live in this repo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../site/engine.js');

const FX = path.join(__dirname, 'fixtures', 'pdf');
const REAL = process.env.FF_REAL_PDF_DIR || '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/pdfs';
let pdfjs = null;
function lib() {
  if (pdfjs) return pdfjs;
  // the legacy build prints "Cannot polyfill DOMMatrix/Path2D" warnings when `canvas` is absent (rendering only; text works)
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = log; console.warn = warn; }
  return pdfjs;
}
async function readFixture(name, opts) { return E.readPdf(lib(), fs.readFileSync(path.join(FX, name)), opts); }
const ctxFor = type => ({ rules: [], accounts: [{ id: 'acc', name: 'Conta', type }], categories: E.DEFAULT_CATEGORIES });
function importRows(analysis, type, opts) {
  const prof = E.profileFromAnalysis(analysis);
  const r = E.applyProfile(analysis.rows, prof, Object.assign({ accountId: 'acc', importId: 'imp1' }, opts || {}));
  const ing = E.ingest([], r.transactions, ctxFor(type));
  return Object.assign(r, { rows: ing.added, profile: prof });
}

// ------------------------------------------------------------------------------------------------ synthetic items
// it(page, y, x, str, h): one text run, like pdf.js getTextContent() after readPdf
const it = (page, y, x, str, h = 10) => ({ page, y, x, str, w: str.length * h * 0.5, h });
const right = (page, y, x2, str, h = 10) => it(page, y, x2 - str.length * h * 0.5, str, h);

test('pdfLines: y clustering with tolerance, x order, word gaps merged, column gaps kept', () => {
  const L = E.pdfLines([it(1, 700.4, 200, 'Loja'), it(1, 700, 40, '03/10'), it(1, 699.8, 222, 'Centro'), right(1, 700.2, 550, 'R$ 10,00'), it(1, 680, 40, 'Outra linha')]);
  assert.equal(L.length, 2);
  assert.deepEqual(L[0].segs.map(s => s.str), ['03/10', 'Loja Centro', 'R$ 10,00']);
  assert.equal(L[1].text, 'Outra linha');
});

test('analyzePdf: date header lines + two-line records (time, wallet), wallet moves, footer repeated on every page', () => {
  const items = [it(1, 800, 40, 'Cartão Benefícios Exemplo'), it(1, 770, 40, 'Extrato atualizado em 04/10/2026 10:00'), it(1, 30, 200, 'Gerado em 04/10/2026'),
    it(1, 700, 40, '3 outubro 2026', 14), it(1, 670, 90, 'Cantina Alfa', 11), right(1, 670, 550, '-R$ 50,00', 11), it(1, 656, 90, 'Compra no Refeição • 12:30'),
    it(1, 600, 90, 'Transferência entre Carteiras', 11), right(1, 600, 550, '+R$ 20,00', 11), it(1, 586, 90, 'Alimentação • 00:00'),
    it(1, 530, 90, 'Transferência entre Carteiras', 11), right(1, 530, 550, '-R$ 20,00', 11), it(1, 516, 90, 'Refeição • 00:00'),
    it(2, 30, 200, 'Gerado em 04/10/2026'),
    it(2, 780, 40, '28 setembro 2026', 14), it(2, 750, 90, 'Crédito de benefício', 11), right(2, 750, 550, '+R$ 500,00', 11), it(2, 736, 90, 'Refeição • 00:00'),
    it(2, 680, 90, 'Mercado Beta', 11), right(2, 680, 550, '-R$ 80,10', 11), it(2, 666, 90, 'Compra no Alimentação • 18:05')];
  const a = E.analyzePdf({ items, pages: 2, pageSizes: [{ w: 595, h: 842 }, { w: 595, h: 842 }] });
  assert.equal(a.pdf.kind, 'beneficio');
  assert.equal(a.pdf.records.length, 5);
  assert.deepEqual(a.pdf.records.map(r => r.date), ['2026-10-03', '2026-10-03', '2026-10-03', '2026-09-28', '2026-09-28']);
  assert.deepEqual(a.pdf.records.map(r => r.time), ['12:30', null, null, null, '18:05']);
  assert.deepEqual(a.pdf.records.map(r => r.wallet), ['Refeição', 'Alimentação', 'Refeição', 'Refeição', 'Alimentação']);
  assert.ok(a.pdf.excluded.some(e => e.reason === 'cabecalho'));
  const r = importRows(a, 'benefit');
  const tr = r.rows.filter(t => t.kind === 'transfer');
  assert.equal(tr.length, 2);
  assert.equal(tr.reduce((s, t) => s + t.amount, 0), 0);
  const cred = r.rows.find(t => t.amount === 50000);
  assert.equal(cred.kind, 'income'); assert.equal(cred.categoryId, 'renda.beneficios');
  const food = r.rows.find(t => t.amount === -5000);
  assert.equal(food.categoryId, 'alimentacao.restaurante'); assert.equal(food.catSource, 'wallet'); assert.deepEqual(food.tags, ['Refeição']);
  assert.equal(r.rows.find(t => t.amount === -8010).categoryId, 'alimentacao.mercado');
});

test('analyzePdf: year-less dates roll back across the year boundary from the due date', () => {
  const items = [it(1, 800, 40, 'Fatura do cartão'), it(1, 780, 40, 'Vencimento: 10/01/2027'), it(1, 760, 40, 'Total a pagar'), it(1, 760, 200, 'R$ 300,00'),
    it(1, 700, 40, 'Lançamentos'), it(1, 680, 40, 'Data'), it(1, 680, 100, 'Descrição'), right(1, 680, 550, 'Valor'),
    it(1, 660, 40, '28/12'), it(1, 660, 100, 'LOJA DEZEMBRO'), right(1, 660, 550, '100,00'),
    it(1, 645, 40, '02/01'), it(1, 645, 100, 'LOJA JANEIRO'), right(1, 645, 550, '200,00')];
  const a = E.analyzePdf({ items, pages: 1 });
  assert.equal(a.pdf.kind, 'fatura');
  assert.deepEqual(a.pdf.records.map(r => r.date), ['2026-12-28', '2027-01-02']);
  assert.equal(a.pdf.meta.dueDate, '2027-01-10');
  assert.ok(a.pdf.checksum.ok, 'unsigned card purchases sum to the total');
});

test('analyzePdf: amount styles — D/C, parentheses, trailing minus, running balance; Saldo column and SALDO lines left out', () => {
  const items = [it(1, 800, 40, 'Extrato de conta corrente'), it(1, 785, 40, 'Período: 01/09/2026 a 30/09/2026'),
    it(1, 700, 40, 'Data'), it(1, 700, 100, 'Histórico'), right(1, 700, 450, 'Valor'), right(1, 700, 550, 'Saldo'),
    it(1, 680, 40, '01/09'), it(1, 680, 100, 'SALDO ANTERIOR'), right(1, 680, 550, '1.000,00'),
    it(1, 665, 40, '02/09'), it(1, 665, 100, 'PIX RECEBIDO'), right(1, 665, 450, '500,00 C'), right(1, 665, 550, '1.500,00'),
    it(1, 650, 40, '03/09'), it(1, 650, 100, 'CONTA DE LUZ'), right(1, 650, 450, '(200,00)'), right(1, 650, 550, '1.300,00'),
    it(1, 635, 40, '04/09'), it(1, 635, 100, 'PADARIA'), right(1, 635, 450, '1.234,56-'), right(1, 635, 550, '65,44'),
    it(1, 620, 40, '05/09'), it(1, 620, 100, 'TARIFA'), right(1, 620, 450, '10,00 D'), right(1, 620, 550, '55,44'),
    it(1, 605, 100, 'SALDO DO DIA'), right(1, 605, 550, '55,44')];
  const a = E.analyzePdf({ items, pages: 1 });
  assert.equal(a.pdf.kind, 'extrato');
  assert.deepEqual(a.pdf.records.map(r => r.amount), [50000, -20000, -123456, -1000]);
  assert.deepEqual(a.pdf.records.map(r => r.balance), [150000, 130000, 6544, 5544]);
  assert.equal(a.pdf.excluded.find(e => e.reason === 'saldos').count, 2);
  assert.ok(a.pdf.checksum && a.pdf.checksum.ok, 'opening + rows = closing');
  assert.equal(a.pdf.meta.cycleStart, '2026-09-01');
});

test('analyzePdf: unsigned extrato rows get their sign from the running balance', () => {
  const items = [it(1, 800, 40, 'Extrato'), it(1, 790, 40, 'Emitido em 30/09/2026'), it(1, 700, 40, 'Data'), it(1, 700, 100, 'Lançamento'), right(1, 700, 450, 'Valor'), right(1, 700, 550, 'Saldo'),
    it(1, 680, 40, '02/09/2026'), it(1, 680, 100, 'DEPOSITO'), right(1, 680, 450, '100,00'), right(1, 680, 550, '1.100,00'),
    it(1, 665, 40, '03/09/2026'), it(1, 665, 100, 'MERCADO'), right(1, 665, 450, '40,00'), right(1, 665, 550, '1.060,00'),
    it(1, 650, 40, '04/09/2026'), it(1, 650, 100, 'FARMACIA'), right(1, 650, 450, '10,00'), right(1, 650, 550, '1.050,00')];
  const a = E.analyzePdf({ items, pages: 1 });
  assert.deepEqual(a.pdf.records.map(r => r.amount).slice(1), [-4000, -1000]);
});

test('analyzePdf: card sections (payments = credits), offers, future installments and limits excluded; parcelas + IOF + fx', () => {
  const items = [it(1, 810, 40, 'Fatura Cartão Exemplo'), it(1, 795, 40, 'Vence em'), it(1, 780, 40, '15/10/2026'), it(1, 795, 200, 'Emitida em: 05/10/2026'),
    it(1, 760, 40, 'Total a pagar'), it(1, 745, 40, 'R$ 289,32'), it(1, 730, 40, 'Limite disponível'), it(1, 730, 200, 'R$ 5.000,00'),
    it(1, 700, 40, 'Pagamentos e créditos'),
    it(1, 685, 40, '20/09'), it(1, 685, 100, 'Pagamento da fatura'), right(1, 685, 550, 'R$ 400,00'),
    it(1, 650, 40, 'Compras'),
    it(1, 635, 40, '10/06'), it(1, 635, 100, 'LOJA PARCELADA'), it(1, 635, 330, 'Parcela 4 de 6'), right(1, 635, 550, 'R$ 100,00'),
    it(1, 620, 40, '25/09'), it(1, 620, 100, 'APP STORE'), it(1, 620, 300, 'US$ 10,00'), right(1, 620, 550, 'R$ 53,00'),
    it(1, 605, 40, '25/09'), it(1, 605, 100, 'IOF COMPRA EXTERIOR'), right(1, 605, 550, 'R$ 2,12'),
    it(1, 590, 40, '26/09'), it(1, 590, 100, 'MULTA POR ATRASO'), right(1, 590, 550, 'R$ 9,20'),
    it(1, 575, 40, '26/09'), it(1, 575, 100, 'JUROS DO ROTATIVO'), right(1, 575, 550, 'R$ 525,00'),
    it(1, 540, 40, 'Parcele sua fatura'), it(1, 525, 40, '1 + [4]x R$ 77,40'), it(1, 510, 40, 'Total: R$ 387,00'),
    it(1, 480, 40, 'Lançamentos futuros'), it(1, 465, 40, '10/11'), it(1, 465, 100, 'LOJA PARCELADA'), it(1, 465, 330, 'Parcela 5 de 6'), right(1, 465, 550, 'R$ 100,00')];
  const a = E.analyzePdf({ items, pages: 1 });
  assert.equal(a.pdf.kind, 'fatura');
  assert.equal(a.pdf.records.length, 6);
  const ex = Object.fromEntries(a.pdf.excluded.map(e => [e.reason, e.count]));
  assert.ok(ex.ofertas >= 2, 'offers'); assert.equal(ex.futuras, 1); assert.ok(ex.limites >= 1);
  assert.equal(a.pdf.meta.dueDate, '2026-10-15'); assert.equal(a.pdf.meta.issueDate, '2026-10-05'); assert.equal(a.pdf.meta.total, 28932);
  assert.deepEqual(a.pdf.records.map(r => r.amount), [40000, -10000, -5300, -212, -920, -52500]);
  assert.equal(a.pdf.checksum.computed, 28932 - 40000 + 40000 + 0, 'debits − credits');
  const r = importRows(a, 'credit_card');
  const pay = r.rows.find(t => t.amount === 40000);
  assert.equal(pay.kind, 'card_payment');
  const inst = r.rows.find(t => t.installment);
  assert.deepEqual(inst.installment, { n: 4, total: 6 });
  assert.equal(inst.originalDate, '2026-06-10'); assert.equal(inst.date, '2026-09-10');
  const app = r.rows.find(t => t.fx);
  assert.deepEqual([app.fx.currency, app.fx.amount, app.amount], ['USD', -1000, -5300]);
  assert.equal(app.fx.rate, 5.3);
  const iof = r.rows.find(t => /IOF/.test(t.rawDescription));
  assert.equal(iof.categoryId, 'impostos.iof'); assert.equal(iof.kind, 'expense'); assert.equal(iof.linkedTo, app.id);
  assert.equal(r.rows.find(t => /MULTA/.test(t.rawDescription)).categoryId, 'servicos.bancos');
  assert.equal(r.rows.find(t => /JUROS/.test(t.rawDescription)).kind, 'expense');
  const sum = E.fxSummary(r.rows, {});
  assert.deepEqual([sum.count, sum.total, sum.iof], [1, 5300, 212]);
  // moving the import to another card keeps the IOF ↔ purchase link
  const moved = E.moveImport(r.rows, 'imp1', 'acc2', { accounts: [{ id: 'acc', type: 'credit_card' }, { id: 'acc2', type: 'credit_card' }], rules: [] });
  assert.equal(moved.find(t => /IOF/.test(t.rawDescription)).linkedTo, app.id);
});

test('analyzePdf: a statement with only foreign amounts → account currency; rates per month from settings.fxRates', () => {
  const items = [it(1, 800, 40, 'Global Account'), it(1, 785, 40, 'Statement generated 02/10/2026'), it(1, 700, 40, 'Data'), it(1, 700, 120, 'Descrição'), right(1, 700, 550, 'Valor'),
    it(1, 680, 40, '12/09/2026'), it(1, 680, 120, 'Cafe Paris'), right(1, 680, 550, '-€ 10,00'),
    it(1, 665, 40, '01/10/2026'), it(1, 665, 120, 'Metro'), right(1, 665, 550, '-€ 2,00'),
    it(1, 650, 40, '02/10/2026'), it(1, 650, 120, 'Deposit'), right(1, 650, 550, '+€ 100,00')];
  const a = E.analyzePdf({ items, pages: 1 });
  assert.equal(a.currency, 'EUR');
  const prof = E.profileFromAnalysis(a);
  assert.equal(prof.currency, 'EUR');
  const r0 = E.applyProfile(a.rows, prof, { accountId: 'eu', importId: 'i' });
  assert.equal(r0.transactions.length, 0);
  assert.deepEqual(r0.needRates.map(n => n.key), ['EUR|2026-09', 'EUR|2026-10']);
  const rates = { EUR: { '2026-09': 6.0, '2026-10': 6.5 } };
  const r1 = E.applyProfile(a.rows, prof, { accountId: 'eu', importId: 'i', fxRates: rates });
  assert.deepEqual(r1.transactions.map(t => t.amount), [-6000, -1300, 65000]);
  assert.deepEqual(r1.transactions[0].fx, { currency: 'EUR', amount: -1000, rate: 6, source: 'manual' });
  // the user fixes October's rate later: only those rows change
  const ch = E.applyFxRates(r1.transactions, { EUR: { '2026-09': 6.0, '2026-10': 7 } });
  assert.deepEqual(ch.map(t => t.amount), [-1400, 70000]);
});

test('currencyOf / parseRate / formatFx / parseAmount with markers', () => {
  assert.equal(E.currencyOf('US$ 12,99'), 'USD'); assert.equal(E.currencyOf('USD 12.99'), 'USD'); assert.equal(E.currencyOf('€ 5,00'), 'EUR');
  assert.equal(E.currencyOf('EUR'), 'EUR'); assert.equal(E.currencyOf('£ 3,10'), 'GBP'); assert.equal(E.currencyOf('R$ 1,00'), 'BRL');
  assert.equal(E.currencyOf('$ 4.00'), null); assert.equal(E.currencyOf('$ 4.00', { dollar: true }), 'USD'); assert.equal(E.currencyOf('ARS 1.500,00'), 'ARS');
  assert.equal(E.parseRate('5,2034'), 5.2034); assert.equal(E.parseRate('R$ 5,20'), 5.2); assert.equal(E.parseRate(''), null);
  assert.equal(E.formatFx({ currency: 'USD', amount: -1299 }), 'US$ 12,99'); assert.equal(E.formatFx({ currency: 'CHF', amount: 123456 }), 'CHF 1.234,56');
  assert.equal(E.parseAmount('€ 18,50', 'br'), 1850); assert.equal(E.parseAmount('-USD 12.99', null), -1299); assert.equal(E.parseAmount('GBP 3,10', 'br'), 310);
});

test('CSV: foreign-amount + rate + BRL columns; the foreign column is never the BRL amount', () => {
  const csv = 'Data;Descrição;Valor US$;Cotação;Valor R$\n05/09/2026;NETFLIX.COM;12,99;5,20;67,55\n05/09/2026;IOF COMPRA INTERNACIONAL;;;2,36\n07/09/2026;PADARIA;;;10,00\n08/09/2026;LOJA;;;15,00\n';
  const a = E.analyzeTable(csv);
  const roles = Object.fromEntries(a.columns.map(c => [c.header, c.role]));
  assert.deepEqual(roles, { 'Data': 'date', 'Descrição': 'description', 'Valor US$': 'fxAmount', 'Cotação': 'fxRate', 'Valor R$': 'amount' });
  const r = E.applyProfile(csv, E.profileFromAnalysis(a), { accountId: 'c' });
  assert.deepEqual(r.transactions[0].fx, { currency: 'USD', amount: -1299, rate: 5.2 });
  assert.equal(r.transactions[0].amount, -6755);
  assert.equal(r.transactions[1].linkedTo, r.transactions[0].id);
  // a USD-only account export (Currency column)
  const usd = 'Date,Description,Amount,Currency\n2026-09-05,Coffee,-4.50,USD\n2026-09-06,Book,-20.00,USD\n';
  const b = E.analyzeTable(usd);
  assert.equal(b.currency, 'USD');
  const r2 = E.applyProfile(usd, E.profileFromAnalysis(b), { accountId: 'u', fxRates: { USD: { '2026-09': 5 } } });
  assert.deepEqual(r2.transactions.map(t => [t.amount, t.fx.amount]), [[-2250, -450], [-10000, -2000]]);
  // a plain BRL file is untouched
  const plain = E.analyzeTable('Data;Descrição;Valor\n01/09/2026;A;-1,00\n02/09/2026;B;-2,00\n');
  assert.equal(plain.currency, 'BRL');
});

test('classify: wallet moves are transfers, a benefit card credit is income, wallet hint stays below the dictionary', () => {
  const c = ctxFor('benefit');
  const k = d => E.classify({ rawDescription: d.raw, amount: d.a, accountId: 'acc', tags: d.tags }, c);
  assert.equal(k({ raw: 'Transferência entre Carteiras', a: 1000 }).kind, 'transfer');
  assert.equal(k({ raw: 'Disponibilizacao De Beneficio Online (credito)', a: 55000 }).categoryId, 'renda.beneficios');
  assert.equal(k({ raw: 'Restaurante Qualquer', a: -1000, tags: ['Refeição'] }).catSource, 'dictionary', 'RESTAURANTE is in the dictionary');
  assert.deepEqual(k({ raw: 'Casa do Zé', a: -1000, tags: ['Alimentação'] }).categoryId, 'alimentacao.mercado');
  assert.equal(k({ raw: 'Drogaria Boa', a: -1000, tags: ['Refeição'] }).categoryId, 'saude.farmacia', 'dictionary wins over the wallet');
  assert.equal(E.classify({ rawDescription: 'Débito para pagar sua fatura', amount: 5000, accountId: 'acc' }, ctxFor('credit_card')).kind, 'card_payment');
});

test('alerts: a PDF fatura import (due date + closing in the import record) covers its cycle and teaches the card days', () => {
  const acc = { id: 'cc', name: 'Cartão', type: 'credit_card' };
  const txs = [];
  for (const [d, imp] of [['2026-08-12', 'p1'], ['2026-08-30', 'p1'], ['2026-09-05', 'p1'], ['2026-09-12', 'p2'], ['2026-10-01', 'p2'], ['2026-10-08', 'p2']]) {
    txs.push({ id: 't' + txs.length, date: d, amount: -1000, accountId: 'cc', importId: imp, kind: 'expense', rawDescription: 'LOJA ' + txs.length });
  }
  const imports = { p1: { id: 'p1', fileName: 'fatura.pdf', docKind: 'fatura', dueDate: '2026-09-14', closeDate: '2026-09-10', cycleStart: '2026-08-10', cycleEnd: '2026-09-09' },
    p2: { id: 'p2', fileName: 'fatura (1).pdf', docKind: 'fatura', dueDate: '2026-10-14', closeDate: '2026-10-10', cycleStart: '2026-09-10', cycleEnd: '2026-10-09' } };
  const inf = E.inferCardDays({ accountId: 'cc', accounts: [acc], transactions: txs, imports });
  assert.deepEqual([inf.closingDay, inf.dueDay], [10, 14]);
  const al = E.updateAlerts({ accounts: [Object.assign({}, acc, { closingDay: 10, dueDay: 14 })], imports: Object.fromEntries(Object.entries(imports).map(([k, v]) => [k, Object.assign({}, v, { at: v.dueDate + 'T00:00:00Z' })])), transactions: txs, today: '2026-10-12' });
  assert.ok(!al.some(a => a.kind === 'fatura_fechou'), JSON.stringify(al.map(a => a.id)));
});

// ------------------------------------------------------------------------------------------------ synthetic PDFs (pdf.js)
test('PDF a: fatura with year-less dates, "−R$" payments, international section + IOF, future parcelas excluded', async () => {
  const a = E.analyzePdf(await readFixture('fatura_roxa.pdf'));
  const P = a.pdf;
  assert.equal(P.kind, 'fatura'); assert.equal(P.pages, 2);
  assert.equal(P.records.length, 12);
  assert.ok(P.checksum.ok, 'total = previous + purchases + charges − credits');
  assert.deepEqual([P.meta.dueDate, P.meta.cycleStart, P.meta.cycleEnd], ['2026-10-05', '2026-08-28', '2026-09-27']);
  assert.equal(P.excluded.find(e => e.reason === 'futuras').count, 4);
  assert.ok(P.excluded.find(e => e.reason === 'ofertas'));
  assert.ok(P.excluded.find(e => e.reason === 'cabecalho'));
  assert.ok(!a.rows.some(r => /Parcela 4\/10|4\/10/.test(r.join('|'))), 'next parcelas are not rows');
  const r = importRows(a, 'credit_card');
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.filter(t => t.kind === 'card_payment').length, 1);
  assert.equal(r.rows.filter(t => t.amount > 0 && t.kind === 'expense').length, 1, 'estorno = negative expense');
  const fx = r.rows.filter(t => t.fx);
  assert.deepEqual(fx.map(t => [t.fx.currency, t.fx.amount, t.fx.rate]), [['USD', -1299, 5.2], ['EUR', -500, 6]]);
  const iofs = r.rows.filter(t => /IOF/.test(t.rawDescription));
  assert.equal(iofs.length, 2);
  assert.deepEqual(iofs.map(t => fx.findIndex(f => f.id === t.linkedTo)), [0, 1]);
  assert.ok(iofs.every(t => t.categoryId === 'impostos.iof'));
  const inst = r.rows.find(t => t.installment);
  assert.deepEqual([inst.installment.n, inst.installment.total, inst.originalDate, inst.date], [3, 10, '2026-07-08', '2026-09-08']);
  assert.equal(r.rows.find(t => t.originalDate === '2026-08-28' || t.date === '2026-08-28').date.slice(0, 4), '2026');
  // the same layout is recognized next time (fingerprint stable), and it is not a CSV fingerprint
  assert.match(a.fingerprint, /^fpdf_/);
  const again = E.analyzePdf(await readFixture('fatura_roxa.pdf'));
  assert.equal(E.matchProfile(again, [Object.assign(E.profileFromAnalysis(a), { name: 'Fatura Roxa' })]).name, 'Fatura Roxa');
});

test('PDF b: checking extrato table, SALDO lines and repeated header/footer left out, balances kept', async () => {
  const a = E.analyzePdf(await readFixture('extrato_laranja.pdf'));
  const P = a.pdf;
  assert.equal(P.kind, 'extrato'); assert.equal(P.records.length, 19);
  assert.ok(P.checksum && P.checksum.ok);
  assert.ok(P.excluded.find(e => e.reason === 'saldos').count >= 15);
  assert.ok(P.excluded.find(e => e.reason === 'cabecalho'));
  assert.ok(!a.rows.some(r => /SALDO|Página|SAC/.test(r[1])));
  const r = importRows(a, 'checking');
  assert.equal(r.rows.filter(t => t.amount > 0).length, 5);
  assert.equal(r.rows.find(t => /PAGAMENTO FATURA/.test(t.rawDescription)).kind, 'card_payment');
  assert.equal(E.importKind(r.rows), 'extrato');
});

test('PDF c: benefit card, one line per record with C/D markers and a wallet column', async () => {
  const a = E.analyzePdf(await readFixture('beneficio_valebem.pdf'));
  assert.equal(a.pdf.kind, 'beneficio'); assert.equal(a.pdf.accountType, 'benefit');
  const r = importRows(a, 'benefit');
  assert.equal(r.rows.length, 8);
  assert.ok(r.rows.every(t => t.tags && t.tags.length === 1));
  const tr = r.rows.filter(t => t.kind === 'transfer');
  assert.equal(tr.length, 2); assert.equal(tr[0].amount + tr[1].amount, 0);
  assert.deepEqual(r.rows.filter(t => t.categoryId === 'renda.beneficios').map(t => t.amount), [60000, 40000]);
  const est = r.rows.find(t => /Estorno/.test(t.rawDescription));
  assert.equal(est.kind, 'expense', 'an estorno on a benefit card is a refund'); assert.ok(est.amount > 0);
  assert.equal(r.rows.find(t => /Mercado Bom/.test(t.rawDescription)).merchant, 'MERCADO BOM PRECO');
});

test('PDF d: password-protected — asks, rejects the wrong one, opens with the right one', async () => {
  await assert.rejects(readFixture('fatura_protegida.pdf'), e => e.code === 'pdf_password');
  await assert.rejects(readFixture('fatura_protegida.pdf', { password: '99999' }), e => e.code === 'pdf_password_wrong');
  const pages = [];
  const r = await readFixture('fatura_protegida.pdf', { password: '12345', onPage: (i, n) => pages.push(i + '/' + n) });
  assert.deepEqual(pages, ['1/1']);
  assert.equal(E.analyzePdf(r).pdf.records.length, 3);
});

test('PDF e: image only → pdf_no_text', async () => {
  await assert.rejects(readFixture('digitalizado.pdf'), e => e.code === 'pdf_no_text');
});

test('PDF f: EUR-only account → currency EUR, needs the month rates, then books BRL and keeps the euros', async () => {
  const a = E.analyzePdf(await readFixture('conta_eur.pdf'));
  assert.equal(a.currency, 'EUR');
  const prof = E.profileFromAnalysis(a);
  const r0 = E.applyProfile(a.rows, prof, { accountId: 'eu' });
  assert.deepEqual(r0.needRates.map(n => n.ym), ['2026-09', '2026-10']);
  const r1 = E.applyProfile(a.rows, prof, { accountId: 'eu', fxRates: { EUR: { '2026-09': 6.2, '2026-10': 6.3 } } });
  assert.equal(r1.transactions.length, 5);
  assert.ok(r1.transactions.every(t => t.fx.currency === 'EUR' && t.fx.source === 'manual'));
  assert.equal(r1.transactions[0].amount, Math.round(-1850 * 6.2));
});

test('a PDF not readable at all → pdf_invalid', async () => {
  await assert.rejects(E.readPdf(lib(), new TextEncoder().encode('%PDF-1.4 not really')), e => e.code === 'pdf_invalid');
});

// ------------------------------------------------------------------------------------------------ the user's real PDFs (runtime only)
// discovered by content (no file names of the user's documents in the repo)
const realPdfs = fs.existsSync(REAL) ? fs.readdirSync(REAL).filter(f => /\.pdf$/i.test(f)).map(f => path.join(REAL, f)) : [];
const realKind = new Map();
async function realOf(kind) {
  for (const f of realPdfs) {
    if (!realKind.has(f)) { try { realKind.set(f, E.analyzePdf(await E.readPdf(lib(), fs.readFileSync(f))).pdf.kind); } catch (e) { realKind.set(f, null); } }
    if (realKind.get(f) === kind) return f;
  }
  return null;
}
test('real sample: credit-card fatura (counts only)', { skip: !realPdfs.length && 'real PDFs not present' }, async (t) => {
  const realMP = await realOf('fatura'); if (!realMP) return t.skip('no fatura among the real PDFs');
  const a = E.analyzePdf(await E.readPdf(lib(), fs.readFileSync(realMP)));
  const P = a.pdf;
  assert.equal(P.kind, 'fatura');
  const r = importRows(a, 'credit_card');
  const purchases = r.rows.filter(t => t.installment);
  const credits = r.rows.filter(t => t.amount > 0);
  const charges = r.rows.filter(t => t.amount < 0 && !t.installment);
  console.log(`# real fatura: ${r.rows.length} rows · ${purchases.length} parcelas · ${credits.length} credits · ${charges.length} charges · excluded ${P.excluded.map(e => e.reason + ' ' + e.count).join(', ')}`);
  assert.equal(purchases.length, 5);
  assert.ok(purchases.every(t => t.installment.n >= 2 && t.installment.total >= t.installment.n && t.originalDate && t.date === E.shiftDateMonths(t.originalDate, t.installment.n - 1)));
  assert.equal(credits.length, 2); assert.ok(credits.every(t => t.kind === 'card_payment'));
  assert.equal(charges.length, 4); assert.ok(charges.every(t => t.kind === 'expense' && /^(impostos\.iof|servicos\.bancos)$/.test(t.categoryId)));
  assert.ok(P.excluded.find(e => e.reason === 'ofertas').count >= 4, 'installment-plan offers');
  assert.ok(!r.rows.some(t => /\[\d+\]x|\dx\b/i.test(t.rawDescription)));
  assert.ok(P.checksum && P.checksum.ok, 'statement total reconciles');
  assert.ok(P.meta.dueDate && P.meta.cycleStart && P.meta.cycleEnd && P.meta.closeDate);
  assert.ok(P.meta.cycleEnd > P.meta.cycleStart && P.meta.dueDate > P.meta.cycleEnd);
});
test('real sample: benefit-card extrato (counts only)', { skip: !realPdfs.length && 'real PDFs not present' }, async (t) => {
  const realPX = await realOf('beneficio'); if (!realPX) return t.skip('no benefit extrato among the real PDFs');
  const a = E.analyzePdf(await E.readPdf(lib(), fs.readFileSync(realPX)));
  assert.equal(a.pdf.kind, 'beneficio');
  const r = importRows(a, 'benefit');
  const tr = r.rows.filter(t => t.kind === 'transfer');
  const inc = r.rows.filter(t => t.kind === 'income');
  const buys = r.rows.filter(t => t.kind === 'expense');
  console.log(`# real benefit extrato: ${r.rows.length} rows · ${buys.length} purchases · ${tr.length} wallet moves · ${inc.length} credits · ${a.pdf.pages} pages`);
  assert.equal(r.errors.length, 0);
  assert.ok(r.rows.every(t => t.tags && t.tags.length === 1), 'every record has its wallet');
  assert.ok(buys.every(t => /^\d{2}:\d{2}$/.test(t.time || '')), 'every purchase has its time');
  assert.ok(tr.length >= 2); assert.equal(tr.reduce((s, t) => s + t.amount, 0), 0, 'wallet moves net zero');
  assert.ok(inc.length >= 1 && inc.every(t => t.categoryId === 'renda.beneficios'));
  assert.ok(buys.every(t => t.categoryId), 'purchases get a category (dictionary or wallet hint)');
  assert.equal(r.rows.length, tr.length + inc.length + buys.length);
});
