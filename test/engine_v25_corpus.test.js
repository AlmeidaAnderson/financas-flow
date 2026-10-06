'use strict';
// v2.5 corpus review: each failure pattern found by importing a real multi-bank statements folder (test/corpus.test.js),
// reproduced with SYNTHETIC files that only mimic the STRUCTURE (made-up people, companies, amounts and numbers).
// The fixes are generic rules — none of them knows a bank or a file name.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const E = require('../site/engine.js');

const OWN = ['Fulana Beltrana de Tal'];
let seq = 0;
const tx = (date, amount, raw, accountId, extra) => Object.assign({ id: 'c' + (++seq), date, amount, rawDescription: raw, merchant: raw, accountId,
  kind: amount < 0 ? 'expense' : 'income', categoryId: null, catSource: null }, extra || {});
const parse = (text, name) => { const a = E.analyzeTable(text); const p = E.profileFromAnalysis(a); return { a, p, r: E.applyProfile(a.rows, p, { accountId: 'acc', importId: 'imp', fxRates: { USD: { '2026-08': 5, '2026-09': 5 }, CNY: { '2026-08': 0.7, '2026-09': 0.7 } } }), name }; };

test('spreadsheet printed page by page: the preamble and header repeated on every page are left out, never errors', () => {
  const pre = [['', 'Extrato de conta', '', '', '', '', 'gerado 2026-10-01 10:00'], ['', 'Cliente:', 'Fulana Beltrana de Tal'], ['', 'CPF:', '000.000.000-00'],
    ['', 'Período:', '01/07/2026 a 30/09/2026'], [], ['', 'Data e hora', 'Categoria', 'Transação', 'Descrição', 'Valor']];
  const day = (d, rows, bal) => rows.map(r => ['', d + ' 10:00', r[0], r[1], r[2], r[3]]).concat([['', d + ' 23:59', '', '', 'Saldo Diário', bal]]);
  const page1 = day('01/07/2026', [['Salário', 'Pagamento de salário', 'Empresa Exemplo Ltda', '5000.00']], '5000.00')
    .concat(day('03/07/2026', [['Transferência', 'Pix enviado', 'Ciclano Souza', '-120.50']], '4879.50'));
  const page2 = day('10/07/2026', [['Outros', 'Pagamento de boleto', 'Concessionaria Luz', '-80.00']], '4799.50');
  const rows = pre.concat(page1, [['', '', '', '', '© Banco Exemplo - CNPJ 00.000.000/0001-00']], pre, page2);
  const a = E.analyzeRows(rows), p = E.profileFromAnalysis(a), r = E.applyProfile(a.rows, p, { accountId: 'acc', importId: 'imp' });
  assert.equal(r.transactions.length, 3);
  assert.deepEqual(r.errors, []);
  const why = r.skipped.reduce((o, s) => (o[s.reason] = (o[s.reason] || 0) + 1, o), {});
  assert.equal(why['saldo ou total'], 3, 'daily balance lines');
  assert.equal(why['cabeçalho repetido'], 1);
  assert.ok(why['topo do arquivo repetido'] >= 4, 'Cliente/CPF/Período/title of page 2');
  assert.equal(r.total, 500000 - 12050 - 8000);
  // the bank's own type column says "salary" when the description is only a name; "Extrato_" in the name = extrato
  const cl = E.classifyAll(r.transactions, { rules: [], dictionary: E.DEFAULT_DICTIONARY });
  assert.equal(cl[0].categoryId, 'renda.salario');
  assert.equal(E.importKind(r.transactions.map((t, i) => Object.assign({}, t, cl[i])), { fileName: 'Extrato_2026-07-01_a_2026-09-30_123.xlsx' }), 'extrato');
});

test('card CSV printing parcelas on their POSTING date (inside the bill) books them as printed; purchase-date files still shift', () => {
  const posted = 'date,title,amount\n2026-09-02,Padaria Exemplo,"12,00"\n2026-09-15,Streaming Exemplo,"39,90"\n2026-08-28,Loja Exemplo - Parcela 3/5,"50,00"\n2026-09-12,Pagamento recebido,"- 300,00"\n';
  const r = parse(posted).r;
  const p3 = r.transactions.find(t => t.installment);
  assert.equal(p3.date, '2026-08-28'); assert.equal(p3.originalDate, undefined); assert.equal(r.installmentDate, 'as_is');
  const purchase = 'Data;Estabelecimento;Valor;Parcela\n02/09/2026;PADARIA EXEMPLO;R$ 12,00;-\n15/09/2026;STREAMING;R$ 39,90;-\n10/07/2026;LOJA EXEMPLO;R$ 50,00;3 de 5\n';
  const q = parse(purchase).r;
  const s3 = q.transactions.find(t => t.installment);
  assert.equal(s3.date, '2026-09-10', 'bought 10/07, parcela 3 → September'); assert.equal(q.installmentDate, 'shift');
});

const WALLET_HDR = '"ID",Date,Amount,Currency,Description,"Running Balance","Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name",Merchant,"Total fees","Exchange To Amount","Transaction Type","Transaction Details Type"\n';
test('wallet statement in a foreign currency: a USD→CNY card rate is never used as a BRL rate; BRL→USD uses 1/rate; Description beats Merchant', () => {
  const usd = WALLET_HDR +
    'CARD-2,05-09-2026,-10.00,USD,"Card transaction of 70.00 CNY issued by Shop Exemplo",90.00,USD,CNY,7.00,,,"Shop Exemplo",0.10,70.00,DEBIT,CARD\n' +
    'CONV-1,01-09-2026,100.00,USD,"500,00 BRL convertidos para 100,00 USD",100.00,BRL,USD,0.2,,,,0,100.00,CREDIT,CONVERSION\n';
  const { a, r } = parse(usd);
  assert.equal(a.currency, 'USD');
  assert.equal(a.columns.find(c => c.role === 'description').header, 'Description');
  const card = r.transactions.find(t => /Card/.test(t.rawDescription)), conv = r.transactions.find(t => /convertidos/.test(t.rawDescription));
  assert.equal(card.amount, -5000, 'USD 10 × the month rate 5 (not × 7 CNY per USD)');
  assert.equal(conv.amount, 50000, 'USD 100 ÷ 0.2 (BRL→USD rate) = BRL 500');
  assert.equal(E.conversionOf(card), null, 'a card purchase abroad is spending, not a conversion');
  assert.ok(E.conversionOf(conv));
  // a statement with only its header: known and empty — no row errors
  const empty = parse(WALLET_HDR.trim() + '\n');
  assert.equal(empty.r.transactions.length, 0); assert.deepEqual(empty.r.errors, []); assert.equal(empty.a.empty, true);
});

test('conversion legs: the money in pairs with the "from" amount in the other account; never with a purchase of that amount', () => {
  const accounts = [{ id: 'brl', name: 'Wise BRL', type: 'checking' }, { id: 'cny', name: 'Wise CNY', type: 'checking', currency: 'CNY' }];
  const out = tx('2026-09-09', -6000, '60,00 BRL convertidos para 78,00 CNY', 'brl', { txType: 'CONVERSION', exchange: { from: 'BRL', to: 'CNY', toAmount: 7800, rate: 1.3 } });
  const inn = tx('2026-09-09', 6000, '60,00 BRL convertidos para 78,00 CNY', 'cny', { txType: 'CONVERSION', fx: { currency: 'CNY', amount: 7800, rate: 0.77, source: 'manual' }, exchange: { from: 'BRL', to: 'CNY', toAmount: 7800, rate: 1.3 } });
  const buy = tx('2026-09-09', -6000, 'Card transaction of 78.00 CNY issued by Shop Exemplo', 'cny', { txType: 'CARD', fx: { currency: 'CNY', amount: -7800, rate: 0.77, source: 'manual' } });
  for (const order of [[out, inn, buy], [buy, inn, out], [inn, buy, out]]) {
    const r = E.detectTransfers(order, { accounts });
    const g = id => r.transactions.find(t => t.id === id);
    assert.equal(g(buy.id).kind, 'expense', 'the purchase stays spending');
    assert.equal(g(out.id).linkedTo, inn.id); assert.equal(g(inn.id).linkedTo, out.id);
    assert.equal(E.detectTransfers(r.transactions, { accounts }).changes.length, 0, 'a second pass changes nothing');
  }
});

test('dedupe: the same tiny amount on the last day of one statement and the first of the next is two rows (balances differ)', () => {
  const a = [tx('2026-03-31', 3, 'Rendimentos', 'mp', { balance: 50003 })];
  const b = [tx('2026-04-01', 3, 'Rendimentos', 'mp', { balance: 50006 })];
  b[0].id = 'other';
  assert.equal(E.dedupe(a, b).fresh.length, 1);
  b[0].balance = 50003; // a real re-export of the same row
  assert.equal(E.dedupe(a, b).duplicates.length, 1);
});

test('isOwnName: a statement may drop or cut names, never add one (a sibling with your first name and one surname)', () => {
  assert.equal(E.isOwnName('Fulana Tal Pereira', OWN), false);
  assert.equal(E.isOwnName('FULANA B TAL', OWN), true);
  assert.equal(E.isOwnName('Fulana Beltrana Tal', ['Fulana Tal', 'Fulana Beltrana de Tal']), true);
  const txs = [tx('2026-09-01', 100000, 'Recebeu dinheiro de Fulana Tal Pereira', 'w', { counterparty: 'Fulana Tal Pereira' }),
    tx('2026-09-02', -50000, 'Pix enviado', 'b', { counterparty: 'Fulana Beltrana de Tal' }), tx('2026-09-03', 50000, 'Pix recebido de Fulana Beltrana de Tal', 'x')];
  const c = E.ownerNameCandidates(txs.concat(txs.map(t => Object.assign({}, t, { id: t.id + 'b', date: '2026-08-' + t.date.slice(8) }))), { accounts: [], imports: { i: { id: 'i', holderName: 'Fulana Beltrana de Tal' } }, settings: {} });
  const sug = c.filter(x => x.suggested);
  assert.equal(sug.length, 1); assert.ok(!sug[0].variants.some(v => /Pereira/i.test(v)), 'the other person is not a variant');
});

test('card payments: a Pix to a PERSON is never linked as a bill payment; a better match later releases the first link (any import order)', () => {
  const accounts = [{ id: 'b1', name: 'Banco Um', type: 'checking' }, { id: 'b2', name: 'Banco Dois', type: 'checking' }, { id: 'cc', name: 'Cartão Dois', type: 'credit_card' }];
  const pixMe = tx('2026-07-07', -250000, 'Fulana Beltrana de Tal', 'b1', { txType: 'Pix enviado' });
  const arrive = tx('2026-07-07', 250000, 'Pix recebido de Fulana Beltrana de Tal', 'b2');
  const payBill = tx('2026-07-07', -250000, 'PAGAMENTO DE FATURA', 'b2');
  const cardSide = tx('2026-07-07', 250000, 'Pagamento de fatura', 'cc', { kind: 'card_payment' });
  for (const steps of [[[pixMe, cardSide], [arrive, payBill]], [[pixMe, arrive, payBill, cardSide]]]) {
    let cur = [];
    for (const s of steps) cur = E.linkCardPayments(cur.concat(s.map(t => Object.assign({}, t))), accounts);
    const g = id => cur.find(t => t.id === id);
    assert.notEqual(g(pixMe.id).kind, 'card_payment', 'the Pix to yourself is not the bill payment');
    assert.equal(g(payBill.id).linkedTo, cardSide.id); assert.equal(g(cardSide.id).linkedTo, payBill.id);
    const r = E.detectTransfers(cur, { accounts, ownerNames: OWN });
    assert.equal(r.transactions.find(t => t.id === pixMe.id).linkedTo, arrive.id, 'it pairs with the arrival instead');
  }
  // a generic debit linked as the only candidate lets go when the real bill payment arrives in a later import
  const generic = tx('2026-07-07', -250000, 'TRANSF ENVIADA', 'b1');
  let cur = E.linkCardPayments([generic, cardSide].map(t => Object.assign({}, t)), accounts);
  assert.equal(cur.find(t => t.id === generic.id).kind, 'card_payment');
  cur = E.linkCardPayments(cur.concat([Object.assign({}, payBill)]), accounts);
  const g = id => cur.find(t => t.id === id);
  assert.equal(g(generic.id).kind, 'expense'); assert.equal(g(generic.id).linkedTo, undefined);
  assert.equal(g(payBill.id).linkedTo, cardSide.id); assert.equal(g(cardSide.id).linkedTo, payBill.id);
});

test('a Pix to the card issuer of EXACTLY an imported fatura total is that card\'s payment; your name at a bank you have in the app = that account', () => {
  const accounts = [{ id: 'chk', name: 'Banco Um', type: 'checking' }, { id: 'mpc', name: 'Mercado Pago Cartão', type: 'credit_card' }, { id: 'mpa', name: 'Mercado Pago Conta', type: 'checking' }, { id: 'xp', name: 'XP Conta', type: 'checking' }];
  const bill = [tx('2026-08-20', -30000, 'LOJA EXEMPLO', 'mpc', { importId: 'f1' }), tx('2026-09-05', -21234, 'MERCADO EXEMPLO', 'mpc', { importId: 'f1' })];
  const pay = tx('2026-09-18', -51234, 'Pix enviado para Mercado Pago Instituicao de Pagamento Ltda', 'chk');
  const other = tx('2026-09-19', -51200, 'Pix enviado para Mercado Pago Instituicao de Pagamento Ltda', 'chk');
  const me = tx('2026-03-05', -100000, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - Banco XP S.A. (0102) Agência: 1 Conta: 2', 'chk');
  const r = E.detectTransfers(bill.concat([pay, other, me]), { accounts, ownerNames: OWN });
  const g = id => r.transactions.find(t => t.id === id);
  assert.equal(g(pay.id).kind, 'card_payment'); assert.equal(g(pay.id).cardAccountId, 'mpc');
  assert.equal(g(other.id).kind, 'expense', 'another amount stays as it was');
  assert.equal(g(me.id).kind, 'transfer'); assert.equal(g(me.id).transferAccountId, 'xp', 'the XP account of the app, not "Conta não cadastrada"');
});

test('classify: a credit the bank types as a card purchase is a refund; the bank type names the salary/advance/severance', () => {
  const ctx = { rules: [], dictionary: E.DEFAULT_DICTIONARY };
  assert.equal(E.classify(tx('2026-09-01', 2500, 'Card transaction of -20.00 CNY issued by Shop', 'w', { txType: 'CARD' }), ctx).kind, 'expense');
  assert.equal(E.classify(tx('2026-09-01', 2500, 'Ciclano Souza', 'w', { txType: 'Pix recebido' }), ctx).kind, 'income');
  for (const t of ['Pagamento de adiantamento', 'Pagamento de rescisão']) assert.equal(E.classify(tx('2026-09-20', 300000, 'Empresa Exemplo', 'b', { txType: t }), ctx).categoryId, 'renda.salario');
});

test('data health on statements as printed: foreign-currency balances, quiet months inside the file period, month names in file names, bills paid in parts, severance', () => {
  assert.deepEqual(E.filePeriod('XX_000000000_01ABR2026_30ABR2026.csv'), ['2026-04-01', '2026-04-30']);
  const accounts = [{ id: 'usd', name: 'Carteira USD', type: 'checking', currency: 'USD' }, { id: 'chk', name: 'Banco Um', type: 'checking' },
    { id: 'cc', name: 'Cartão Um', type: 'credit_card', closingDay: 10, dueDay: 14 }];
  const fx = (amt) => ({ currency: 'USD', amount: amt, rate: 5, source: 'manual' });
  const usd = [tx('2026-01-05', -5000, 'Card A', 'usd', { importId: 'u', fx: fx(-1000), balance: 9000, rowIndex: 3 }),
    tx('2026-01-02', 50000, 'Topup', 'usd', { importId: 'u', fx: fx(10000), balance: 10000, rowIndex: 4 }),
    tx('2026-08-10', -2500, 'Card B', 'usd', { importId: 'u', fx: fx(-500), balance: 8000, rowIndex: 1 }),
    tx('2026-08-09', -2500, 'Card C', 'usd', { importId: 'u', fx: fx(-500), balance: 8500, rowIndex: 2 })];
  // a monthly extrato whose name says it covers all of April; the first movement on the 7th
  const chk = [tx('2026-04-07', -1000, 'Padaria', 'chk', { importId: 'n4' }), tx('2026-04-20', 300000, 'Pagamento de salário', 'chk', { importId: 'n4', categoryId: 'renda.salario' }),
    tx('2026-05-20', 300000, 'Pagamento de salário', 'chk', { importId: 'n5', categoryId: 'renda.salario' }), tx('2026-06-20', 300000, 'Pagamento de salário', 'chk', { importId: 'n6', categoryId: 'renda.salario' }),
    tx('2026-06-25', 900000, 'Pagamento de rescisão', 'chk', { importId: 'n6', categoryId: 'renda.salario' }), tx('2026-07-29', -1000, 'Padaria', 'chk', { importId: 'n7' }),
    // a bill of 300,00 paid in two parts after its due date (14/05)
    tx('2026-05-20', -5000, 'Débito por dívida Pagamento mínimo da fatura', 'chk', { importId: 'n5', kind: 'card_payment', cardAccountId: 'cc' }),
    tx('2026-05-20', -25000, 'Pagamento Cartão de crédito', 'chk', { importId: 'n5', kind: 'card_payment', cardAccountId: 'cc' })];
  const bill = [tx('2026-04-21', -30000, 'LOJA', 'cc', { importId: 'f5' })];
  const imports = { u: { id: 'u', fileName: 'statement_1_USD_2026-01-01_2026-09-30.csv', accountId: 'usd' },
    n4: { id: 'n4', fileName: 'XX_1_01ABR2026_30ABR2026.csv' }, n5: { id: 'n5', fileName: 'XX_1_01MAI2026_31MAI2026.csv' }, n6: { id: 'n6', fileName: 'XX_1_01JUN2026_30JUN2026.csv' },
    n7: { id: 'n7', fileName: 'XX_1_01JUL2026_31JUL2026.csv' }, f5: { id: 'f5', fileName: 'fatura.pdf', docKind: 'fatura', dueDate: '2026-05-14', closeDate: '2026-05-10' } };
  const h = E.dataHealth({ transactions: usd.concat(chk, bill), accounts, imports, settings: {}, today: '2026-10-06' });
  const ids = h.map(w => w.id);
  assert.ok(!ids.some(i => /^d:break:u/.test(i)), 'the USD balance is continuous in USD');
  assert.ok(!ids.some(i => /^a:gap:usd:/.test(i)), 'quiet months inside the printed period are not gaps');
  assert.ok(!ids.some(i => /^e:partial:chk:2026-0[4-7]/.test(i)), 'the month in the file name is covered');
  assert.ok(!ids.some(i => /^c:(mismatch|no-fatura):/.test(i)), 'two payments of one cycle add up to the bill');
  assert.ok(!ids.some(i => /^g:salary:/.test(i)), 'no salary expected after a severance payment');
});

test('inferCardDays: sparse bills (one subscription each) — the days allowed between consecutive bills win', () => {
  const accounts = [{ id: 'cc', name: 'Cartão', type: 'credit_card' }];
  const txs = [], imports = {};
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  months.forEach((m, i) => {
    const id = 'f' + i, due = E.shiftDateMonths(m + '-12', 1);
    imports[id] = { id, fileName: 'Cartao_' + due + '.csv', accountId: 'cc' };
    txs.push(tx(m + '-15', -3990, 'Streaming', 'cc', { importId: id }), tx(due.slice(0, 7) + '-01', -1200, 'Padaria', 'cc', { importId: id }),
      tx(m + '-12', 50000, 'Pagamento recebido', 'cc', { importId: id, kind: 'card_payment' }));
  });
  txs.push(tx('2026-07-05', -5000, 'Loja - Parcela 2/3', 'cc', { importId: 'f6', installment: { n: 2, total: 3 } }), tx('2026-07-20', -3990, 'Streaming', 'cc', { importId: 'f6' }));
  imports.f6 = { id: 'f6', fileName: 'Cartao_2026-08-12.csv', accountId: 'cc' };
  const r = E.inferCardDays({ accountId: 'cc', accounts, transactions: txs, imports });
  assert.equal(r.dueDay, 12);
  assert.ok(r.closingDay >= 2 && r.closingDay <= 5, 'closing between the last purchase (day 1) and the posted parcela (day 5): ' + r.closingDay);
});

function zipOf(files) {
  const parts = [], central = []; let off = 0;
  const u16 = n => Buffer.from([n & 255, (n >> 8) & 255]), u32 = n => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  for (const f of files) {
    const name = Buffer.from(f.name), raw = Buffer.from(f.data), comp = f.store ? raw : zlib.deflateRawSync(raw), method = f.store ? 0 : 8;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(0), u32(comp.length), u32(raw.length), u16(name.length), u16(0), name, comp]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(0), u32(comp.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name]));
    parts.push(local); off += local.length;
  }
  const cd = Buffer.concat(central);
  return new Uint8Array(Buffer.concat(parts.concat([cd, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(off), u16(0)])));
}
test('ZIP of statements: recognized by content (not as a spreadsheet), statement entries extracted (stored + deflated), others left out', async () => {
  const z = zipOf([{ name: 'pasta/extrato_usd.csv', data: WALLET_HDR }, { name: 'leia-me.html', data: '<p>x</p>' }, { name: '__MACOSX/._extrato.csv', data: 'x' },
    { name: 'fatura.csv', data: 'date,title,amount\n2026-09-02,Padaria,"12,00"\n', store: true }]);
  assert.equal(E.fileKindOf('extratos-baixados.pdf.zip', z), 'zip');
  assert.equal(E.fileKindOf('arquivo.xlsx', z), 'zip', 'a ZIP with CSVs is not a workbook, whatever the name');
  const ents = await E.unzipEntries(z, { inflate: raw => new Uint8Array(zlib.inflateRawSync(Buffer.from(raw))) });
  assert.deepEqual(ents.map(e => e.name), ['extrato_usd.csv', 'fatura.csv']);
  assert.equal(Buffer.from(ents[1].bytes).toString(), 'date,title,amount\n2026-09-02,Padaria,"12,00"\n');
  await assert.rejects(E.unzipEntries(new Uint8Array([1, 2, 3])), e => e.code === 'zip_invalid');
  await assert.rejects(E.unzipEntries(z), e => e.code === 'zip_method', 'deflated entry without an inflater');
});
