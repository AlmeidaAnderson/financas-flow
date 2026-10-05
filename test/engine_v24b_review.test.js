// v2.4b review — PDFs made by an independent generator (test/fixtures/pdf/make_pdfs_review.py, standard PDF fonts, all
// data made up) to catch a reader tuned to one layout: amounts on the left of the date, "05.09.2026" dates, C/D markers,
// descriptions wrapped to 2 lines, a two-column page, "05 SET 2026" dates, a US$ column + R$ column with
// "Dólar de conversão", a "Valor total" label above its value, parcelas printed with the POSTING date. node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../site/engine.js');

const FX = path.join(__dirname, 'fixtures', 'pdf');
let pdfjs = null;
function lib() {
  if (pdfjs) return pdfjs;
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = log; console.warn = warn; }
  return pdfjs;
}
async function analyze(name) { return E.analyzePdf(await E.readPdf(lib(), fs.readFileSync(path.join(FX, name)))); }
function importRows(a, type) {
  const prof = E.profileFromAnalysis(a);
  const r = E.applyProfile(a.rows, prof, { accountId: 'acc', importId: 'imp1' });
  const ing = E.ingest([], r.transactions, { rules: [], accounts: [{ id: 'acc', name: 'Conta', type }], categories: E.DEFAULT_CATEGORIES });
  return Object.assign(r, { rows: ing.added });
}
const it = (page, y, x, str, h = 10) => ({ page, y, x, str, w: str.length * h * 0.5, h });
const right = (page, y, x2, str, h = 10) => it(page, y, x2 - str.length * h * 0.5, str, h);

test('review PDF: extrato with the amount BEFORE the date, "05.09.2026", C/D, descriptions on 2 lines, saldo check', async () => {
  const a = await analyze('extrato_cd_quebra.pdf');
  assert.equal(a.pdf.kind, 'extrato');
  const r = importRows(a, 'checking');
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 7);
  assert.deepEqual(r.rows.map(t => t.date), ['2026-09-03', '2026-09-04', '2026-09-09', '2026-09-12', '2026-09-15', '2026-09-22', '2026-09-28']);
  assert.deepEqual(r.rows.map(t => t.amount), [650000, -18766, -4500, -9321, -2990, 12000, 30000]);
  // the wrapped line is part of the description (not a detail): the payee of the Pix is kept
  assert.equal(r.rows.find(t => t.amount === 12000).rawDescription, 'PIX RECEBIDO FULANO DE TAL FICTICIO');
  assert.equal(r.rows.find(t => t.amount === -9321).rawDescription, 'COMPRA CARTAO DEBITO MERCEARIA DO BAIRRO');
  assert.equal(r.rows.find(t => t.amount === -4500).rawDescription, 'PIX ENVIADO');
  assert.ok(a.pdf.excluded.some(e => e.reason === 'saldos' && e.count === 2));
  assert.ok(a.pdf.checksum && a.pdf.checksum.ok, 'saldo anterior + rows = saldo final');
});

test('review PDF: a page in two side-by-side columns → 10 separate records, left column first', async () => {
  const a = await analyze('extrato_2colunas.pdf');
  const r = importRows(a, 'checking');
  assert.equal(r.rows.length, 10);
  assert.ok(r.rows.every(t => !/\d{2}\/\d{2}\/\d{4}/.test(t.rawDescription)), 'no record swallowed the other column');
  assert.deepEqual(r.rows.map(t => t.date.slice(8)), ['01', '02', '04', '06', '08', '15', '18', '21', '25', '29']);
  assert.equal(r.rows.reduce((s, t) => s + t.amount, 0), 8580);
  assert.equal(r.rows.find(t => /Transferência recebida/.test(t.rawDescription)).amount, 50000);
});

test('review PDF: fatura "05 SET 2026", nacionais + internacionais (US$ and EUR in a US$ column, conversão lines), IOF linked', async () => {
  const a = await analyze('fatura_intl_set.pdf');
  const P = a.pdf;
  assert.equal(P.kind, 'fatura');
  assert.equal(P.meta.dueDate, '2026-10-10');
  assert.equal(P.meta.total, 103898, '"Valor total" above its value');
  assert.ok(P.checksum && P.checksum.ok);
  assert.deepEqual(P.sections.filter(s => !s.skip).map(s => s.title), ['Lançamentos nacionais', 'Lançamentos internacionais']);
  const r = importRows(a, 'credit_card');
  assert.equal(r.rows.length, 9);
  assert.equal(r.rows.filter(t => t.kind === 'card_payment').length, 1);
  const gh = r.rows.find(t => /GITHUB/.test(t.rawDescription));
  assert.deepEqual([gh.amount, gh.fx.currency, gh.fx.amount, gh.fx.rate], [-11445, 'USD', -2100, 5.45]);
  const bk = r.rows.find(t => /BOOKSHOP/.test(t.rawDescription));
  assert.deepEqual([bk.amount, bk.fx.currency, bk.fx.amount, bk.fx.rate], [-19110, 'EUR', -3000, 6.37]);
  const iofs = r.rows.filter(t => /IOF/.test(t.rawDescription));
  assert.equal(iofs.length, 2);
  assert.ok(iofs.every(t => t.categoryId === 'impostos.iof' && !t.fx));
  assert.deepEqual(iofs.map(t => t.linkedTo).sort(), [gh.id, bk.id].sort());
  const sum = E.fxSummary(r.rows, {});
  assert.deepEqual([sum.count, sum.total, sum.iof], [2, 11445 + 19110, 401 + 669], 'IOF counted once, apart from the purchases');
  // the parcela is printed with its posting date (11 SET, inside this fatura): booked there, purchase date one month earlier
  const inst = r.rows.find(t => t.installment);
  assert.equal(P.installmentPosted, true);
  assert.deepEqual([inst.date, inst.originalDate, inst.installment.n], ['2026-09-11', '2026-08-11', 2]);
  assert.ok(!r.rows.some(t => t.date > P.meta.dueDate), 'nothing booked after the due date');
});

test('two date columns of ONE record (compra / lançamento) are not mistaken for a two-column page', () => {
  const rows = [['05/09', '06/09', 'LOJA UM', 'R$ 10,00'], ['07/09', '08/09', 'LOJA DOIS', 'R$ 20,00'], ['09/09', '10/09', 'LOJA TRES', 'R$ 30,00']];
  const items = [it(1, 800, 40, 'Fatura Exemplo'), it(1, 785, 40, 'Vencimento: 15/10/2026')];
  rows.forEach((r, k) => { const y = 700 - k * 15; items.push(it(1, y, 40, r[0]), it(1, y, 100, r[1]), it(1, y, 160, r[2]), right(1, y, 550, r[3])); });
  const a = E.analyzePdf({ items, pages: 1 });
  assert.equal(a.pdf.records.length, 3);
  assert.deepEqual(a.pdf.records.map(r => r.amount), [-1000, -2000, -3000]);
});

test('parcelas printed with the PURCHASE date keep the shift rule (no false "posted" detection)', () => {
  const items = [it(1, 800, 40, 'Fatura Exemplo'), it(1, 785, 40, 'Vencimento: 15/10/2026'), it(1, 770, 40, 'Total a pagar R$ 330,00'),
    it(1, 700, 40, '10/04'), it(1, 700, 100, 'LOJA A'), it(1, 700, 300, 'Parcela 6 de 10'), right(1, 700, 550, 'R$ 100,00'),
    it(1, 685, 40, '20/07'), it(1, 685, 100, 'LOJA B'), it(1, 685, 300, 'Parcela 3 de 5'), right(1, 685, 550, 'R$ 200,00'),
    it(1, 670, 40, '25/09'), it(1, 670, 100, 'PADARIA'), right(1, 670, 550, 'R$ 30,00')];
  const a = E.analyzePdf({ items, pages: 1 });
  assert.equal(a.pdf.installmentPosted, false);
  const r = importRows(a, 'credit_card');
  const A = r.rows.find(t => /LOJA A/.test(t.rawDescription));
  assert.deepEqual([A.originalDate, A.date], ['2026-04-10', '2026-09-10']);
});

test('a wrapped line that carries a time/amount stays a detail (benefit layout unchanged)', () => {
  const items = [it(1, 800, 40, 'Cartão Benefícios Exemplo'), it(1, 785, 40, 'Extrato atualizado em 03/10/2026 09:15'),
    it(1, 700, 40, '3 outubro 2026', 14), it(1, 670, 90, 'Cantina Alfa', 11), right(1, 670, 550, '-R$ 50,00', 11), it(1, 656, 90, 'Compra no Refeição • 12:30'),
    it(1, 630, 40, '2 outubro 2026', 14),
    it(1, 600, 90, 'Mercado Beta', 11), right(1, 600, 550, '-R$ 10,00', 11), it(1, 586, 90, 'Compra no Alimentação • 18:05')];
  const a = E.analyzePdf({ items, pages: 1 });
  const r = importRows(a, 'benefit');
  assert.deepEqual(r.rows.map(t => t.rawDescription), ['Cantina Alfa', 'Mercado Beta']);
  assert.deepEqual(r.rows.map(t => t.time), ['12:30', '18:05']);
});

test('CSV with "Valor US$" + "Valor R$" (no rate column): books the R$, keeps the dollars + implied rate, IOF linked, counted once', () => {
  const csv = 'Data;Descrição;Valor US$;Valor R$\n05/09/2026;SERVICO ONLINE EXEMPLO;12,99;67,55\n05/09/2026;IOF COMPRA INTERNACIONAL;;2,36\n07/09/2026;PADARIA;;10,00\n';
  const a = E.analyzeTable(csv);
  assert.deepEqual(a.columns.map(c => c.role), ['date', 'description', 'fxAmount', 'amount']);
  const r = E.applyProfile(csv, E.profileFromAnalysis(a), { accountId: 'acc' });
  const ing = E.ingest([], r.transactions, { rules: [], accounts: [{ id: 'acc', name: 'Cartão', type: 'credit_card' }], categories: E.DEFAULT_CATEGORIES });
  const [buy, iof, pad] = ing.added;
  assert.deepEqual([buy.amount, buy.fx.currency, buy.fx.amount], [-6755, 'USD', -1299]);
  assert.ok(Math.abs(buy.fx.rate - 5.2) < 0.001);
  assert.deepEqual([iof.amount, iof.fx || null, iof.linkedTo, iof.categoryId], [-236, null, buy.id, 'impostos.iof']);
  assert.ok(!pad.fx);
  const sum = E.fxSummary(ing.added, {});
  assert.deepEqual([sum.count, sum.total, sum.iof], [1, 6755, 236], 'the IOF is not inside the purchases total');
});
