'use strict';
// v2.3: update alerts — statement cycles per card, reminders per account, inference of the closing/due day.
// All data synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../site/engine.js');

const card = (extra) => Object.assign({ id: 'cartao', name: 'Cartão XP', type: 'credit_card', closingDay: 28, dueDay: 5 }, extra || {});
const conta = (extra) => Object.assign({ id: 'conta', name: 'Conta XP', type: 'checking' }, extra || {});
let seq = 0;
const tx = (date, amount, raw, accountId, importId, extra) => Object.assign({ id: 't' + (++seq), date, amount, rawDescription: raw, merchant: raw, accountId, importId, kind: amount < 0 ? 'expense' : 'income' }, extra || {});
/** a synthetic fatura: purchases from `from` to `to` (every 4 days + the last day) */
function fatura(importId, from, to, accountId) {
  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 4)) rows.push(tx(d, -(1000 + rows.length * 37), 'LOJA ' + rows.length, accountId || 'cartao', importId));
  if (rows[rows.length - 1].date !== to) rows.push(tx(to, -2500, 'POSTO FINAL', accountId || 'cartao', importId));
  return rows;
}
function addDays(iso, k) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + k)); return d.toISOString().slice(0, 10); }
const ids = list => list.map(a => a.id);

test('v2.3 cardCycles: closing/due dates, month-end clamp, February, leap year', () => {
  const cs = E.cardCycles(card({ closingDay: 31, dueDay: 10 }), { from: '2026-01-15', to: '2026-04-30' });
  const by = Object.fromEntries(cs.map(c => [c.ym, c]));
  assert.equal(by['2026-01'].closeDate, '2026-01-31');
  assert.equal(by['2026-02'].closeDate, '2026-02-28', '31 in February → last day');
  assert.equal(by['2026-02'].start, '2026-01-31');
  assert.equal(by['2026-02'].end, '2026-02-27');
  assert.equal(by['2026-02'].dueDate, '2026-03-10', 'due day before the closing day → next month');
  assert.equal(by['2026-04'].closeDate, '2026-04-30');
  assert.equal(by['2026-03'].start, '2026-02-28');
  const leap = E.cardCycles(card({ closingDay: 30, dueDay: 31 }), { from: '2028-02-01', to: '2028-02-29' }).find(c => c.ym === '2028-02');
  assert.equal(leap.closeDate, '2028-02-29', 'leap year');
  assert.equal(leap.dueDate, '2028-02-29', 'due day after the closing day → same month, clamped');
  assert.deepEqual(E.cardCycles({ id: 'x', type: 'credit_card' }, { from: '2026-01-01', to: '2026-03-01' }), [], 'not configured → no cycles');
  assert.deepEqual(E.cardCycles(card({ closingDay: 0 }), {}), []);
});

test('v2.3 cardCycles: a cycle crossing the year boundary', () => {
  const cs = E.cardCycles(card(), { from: '2026-12-01', to: '2027-01-31' });
  const dez = cs.find(c => c.ym === '2026-12'), jan = cs.find(c => c.ym === '2027-01');
  assert.deepEqual([dez.start, dez.end, dez.closeDate, dez.dueDate], ['2026-11-28', '2026-12-27', '2026-12-28', '2027-01-05']);
  assert.deepEqual([jan.start, jan.closeDate, jan.dueDate], ['2026-12-28', '2027-01-28', '2027-02-05']);
});

test('v2.3 cardCycles: a per-cycle override date ("Fechou em outra data")', () => {
  const acc = card({ cycleOverrides: { '2026-09': '2026-09-26' } });
  const cs = E.cardCycles(acc, { from: '2026-08-01', to: '2026-10-31' });
  const set = cs.find(c => c.ym === '2026-09'), out = cs.find(c => c.ym === '2026-10');
  assert.equal(set.closeDate, '2026-09-26');
  assert.equal(set.end, '2026-09-25');
  assert.equal(set.overridden, true);
  assert.equal(set.dueDate, '2026-10-05', 'the due date does not move');
  assert.equal(out.start, '2026-09-26', 'the next cycle starts on the real closing date');
  const al = E.updateAlerts({ accounts: [acc], transactions: [], imports: {}, today: '2026-09-27' });
  assert.equal(al[0].title, 'Fatura de Cartão XP fechou em 26/09');
  // a nonsense override (far from the closing day) is ignored
  assert.equal(E.cardCycles(card({ cycleOverrides: { '2026-09': '2026-07-01' } }), { from: '2026-09-01', to: '2026-09-30' }).find(c => c.ym === '2026-09').closeDate, '2026-09-28');
});

test('v2.3 updateAlerts: fatura_fechou appears after the closing date and disappears after importing that fatura', () => {
  const acc = card();
  const prev = fatura('imp-ago', '2026-07-28', '2026-08-27');
  const imports = { 'imp-ago': { id: 'imp-ago', fileName: 'Fatura2026-09-05.csv' } };
  // on the closing day itself: nothing yet
  assert.deepEqual(E.updateAlerts({ accounts: [acc], transactions: prev, imports, today: '2026-09-28' }).filter(a => a.kind === 'fatura_fechou'), []);
  const al = E.updateAlerts({ accounts: [acc], transactions: prev, imports, today: '2026-10-01' });
  const f = al.find(a => a.kind === 'fatura_fechou');
  assert.ok(f, 'alert after the closing date');
  assert.equal(f.id, 'fatura_fechou:cartao:2026-09');
  assert.equal(f.title, 'Fatura de Cartão XP fechou em 28/09');
  assert.match(f.detail, /importe a fatura \(vence 05\/10\)/i);
  assert.match(f.detail, /28\/08 a 27\/09/);
  assert.equal(f.severity, 'warning');
  assert.deepEqual(f.action, { type: 'import', label: 'Importar agora', accountId: 'cartao' });
  assert.equal(f.cycle.dueDate, '2026-10-05');
  // stable id: same alert the next day
  assert.equal(E.updateAlerts({ accounts: [acc], transactions: prev, imports, today: '2026-10-02' }).find(a => a.kind === 'fatura_fechou').id, f.id);
  // import the matching fatura (by its file name = due date) → gone
  const set = fatura('imp-set', '2026-08-28', '2026-09-27');
  const imp2 = Object.assign({}, imports, { 'imp-set': { id: 'imp-set', fileName: 'Fatura2026-10-05.csv' } });
  assert.equal(E.updateAlerts({ accounts: [acc], transactions: prev.concat(set), imports: imp2, today: '2026-10-01' }).filter(a => a.kind === 'fatura_fechou').length, 0);
  // …also without a date in the file name: its purchases reach the last days of the cycle
  const imp3 = Object.assign({}, imports, { 'imp-set': { id: 'imp-set', fileName: 'fatura.csv' } });
  assert.equal(E.updateAlerts({ accounts: [acc], transactions: prev.concat(set), imports: imp3, today: '2026-10-01' }).filter(a => a.kind === 'fatura_fechou').length, 0);
  // a fatura that stops in the middle of the cycle does not count
  const half = fatura('imp-set', '2026-08-28', '2026-09-12');
  assert.equal(E.updateAlerts({ accounts: [acc], transactions: prev.concat(half), imports: imp3, today: '2026-10-01' }).filter(a => a.kind === 'fatura_fechou').length, 1);
  // dismissed for this cycle
  assert.equal(E.updateAlerts({ accounts: [acc], transactions: prev, imports, today: '2026-10-01', settings: { dismissedAlerts: [f.id] } }).filter(a => a.kind === 'fatura_fechou').length, 0);
  // alerts off for the account
  assert.deepEqual(E.updateAlerts({ accounts: [card({ alerts: false })], transactions: prev, imports, today: '2026-10-01' }), []);
});

test('v2.3 updateAlerts: older closed cycles only when they are a hole in the data', () => {
  const acc = card();
  // nothing imported at all: only the latest closed cycle
  const none = E.updateAlerts({ accounts: [acc], transactions: [], imports: {}, today: '2026-10-10' }).filter(a => a.kind === 'fatura_fechou');
  assert.deepEqual(ids(none), ['fatura_fechou:cartao:2026-09']);
  // data from July, August missing → both August and September
  const jul = fatura('imp-jul', '2026-06-28', '2026-07-27');
  const two = E.updateAlerts({ accounts: [acc], transactions: jul, imports: { 'imp-jul': { id: 'imp-jul', fileName: 'Fatura2026-08-05.csv' } }, today: '2026-10-10' }).filter(a => a.kind === 'fatura_fechou');
  assert.deepEqual(ids(two).sort(), ['fatura_fechou:cartao:2026-08', 'fatura_fechou:cartao:2026-09']);
});

test('v2.3 updateAlerts: fatura_vence until the payment shows up in a bank account (can be turned off)', () => {
  const set = fatura('imp-set', '2026-08-28', '2026-09-27');
  const imports = { 'imp-set': { id: 'imp-set', fileName: 'Fatura2026-10-05.csv' } };
  const al = E.updateAlerts({ accounts: [card(), conta()], transactions: set, imports, today: '2026-10-03' });
  const v = al.find(a => a.kind === 'fatura_vence');
  assert.ok(v);
  assert.equal(v.id, 'fatura_vence:cartao:2026-09');
  assert.equal(v.title, 'Fatura de Cartão XP vence em 2 dias (05/10)');
  assert.equal(v.severity, 'info');
  assert.equal(E.updateAlerts({ accounts: [card(), conta()], transactions: set, imports, today: '2026-10-05' }).find(a => a.kind === 'fatura_vence').title, 'Fatura de Cartão XP vence hoje (05/10)');
  assert.equal(E.updateAlerts({ accounts: [card(), conta()], transactions: set, imports, today: '2026-09-30' }).filter(a => a.kind === 'fatura_vence').length, 0, 'more than 3 days before');
  const paid = set.concat([tx('2026-10-02', -40000, 'PAGAMENTO DE FATURA', 'conta', 'imp-ext', { kind: 'card_payment' })]);
  assert.equal(E.updateAlerts({ accounts: [card(), conta()], transactions: paid, imports, today: '2026-10-03' }).filter(a => a.kind === 'fatura_vence').length, 0, 'paid');
  assert.equal(E.updateAlerts({ accounts: [card({ dueAlert: false }), conta()], transactions: set, imports, today: '2026-10-03' }).filter(a => a.kind === 'fatura_vence').length, 0, 'turned off');
});

test('v2.3 updateAlerts: checking-account reminders (semanal / quinzenal / mensal dia X / nunca)', () => {
  const rows = last => [tx(addDays(last, -20), -100, 'PIX', 'conta', 'imp-e'), tx(last, -100, 'PIX', 'conta', 'imp-e')];
  const run = (remind, last, today, extra) => E.updateAlerts({ accounts: [conta(Object.assign({ remind }, extra || {}))], transactions: rows(last), imports: {}, today });
  // weekly
  const w = run({ freq: 'weekly' }, '2026-09-24', '2026-10-03');
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'extrato_desatualizado');
  assert.equal(w[0].id, 'extrato_desatualizado:conta:2026-10-01', 'one id per reminder occurrence');
  assert.equal(w[0].title, 'Extrato de Conta XP desatualizado');
  assert.match(w[0].detail, /vão até 24\/09 \(há 9 dias\).*toda semana/);
  assert.equal(run({ freq: 'weekly' }, '2026-09-28', '2026-10-03').length, 0);
  assert.equal(run({ freq: 'weekly' }, '2026-09-24', '2026-10-09')[0].id, 'extrato_desatualizado:conta:2026-10-08', 'next week → next occurrence');
  // biweekly
  assert.equal(run({ freq: 'biweekly' }, '2026-09-24', '2026-10-03').length, 0);
  assert.equal(run({ freq: 'biweekly' }, '2026-09-10', '2026-10-03')[0].id, 'extrato_desatualizado:conta:2026-09-25');
  // monthly on day 5
  assert.equal(run({ freq: 'monthly', day: 5 }, '2026-09-30', '2026-10-03').length, 0, 'before the 5th: September was reminded on 05/09 and the data is newer');
  const m = run({ freq: 'monthly', day: 5 }, '2026-09-30', '2026-10-06');
  assert.equal(m.length, 1);
  assert.equal(m[0].id, 'extrato_desatualizado:conta:2026-10-05');
  assert.match(m[0].detail, /todo mês \(dia 5\)/);
  assert.equal(run({ freq: 'monthly', day: 5 }, '2026-10-03', '2026-10-06').length, 0, 'data up to (almost) the reminder day');
  assert.equal(run({ freq: 'monthly', day: 31 }, '2026-01-20', '2026-02-28')[0].id, 'extrato_desatualizado:conta:2026-02-28', 'day 31 in February');
  // never / not configured / off
  assert.equal(run({ freq: 'never' }, '2026-01-01', '2026-10-03').length, 0);
  assert.equal(E.updateAlerts({ accounts: [conta()], transactions: rows('2026-01-01'), imports: {}, today: '2026-10-03' }).length, 0, 'old accounts (no fields) give nothing');
  assert.equal(run({ freq: 'weekly' }, '2026-09-01', '2026-10-03', { alerts: false }).length, 0);
  // the period printed in the file name counts as covered
  const ext = [tx('2026-09-20', -100, 'PIX', 'conta', 'imp-x')];
  const al = E.updateAlerts({ accounts: [conta({ remind: { freq: 'weekly' } })], transactions: ext, imports: { 'imp-x': { id: 'imp-x', fileName: 'extrato_de_01-09-2026_ate_01-10-2026.csv' } }, today: '2026-10-03' });
  assert.equal(al.length, 0);
});

test('v2.3 updateAlerts: "configurar" for cards without a closing day', () => {
  const al = E.updateAlerts({ accounts: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }, conta()], transactions: [], imports: {}, today: '2026-10-03' });
  assert.equal(al.length, 1);
  assert.equal(al[0].kind, 'configurar');
  assert.equal(al[0].id, 'configurar:nu');
  assert.equal(al[0].title, 'Defina o dia de fechamento de Nubank');
  assert.equal(al[0].action.type, 'configure');
  assert.equal(E.updateAlerts({ accounts: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }], transactions: [], imports: {}, today: '2026-10-03', settings: { dismissedAlerts: ['configurar:nu'] } }).length, 0, 'dismissable');
  // the most urgent first
  const mixed = E.updateAlerts({ accounts: [{ id: 'nu', name: 'Nubank', type: 'credit_card' }, card()], transactions: [], imports: {}, today: '2026-10-03' });
  assert.deepEqual(mixed.map(a => a.kind), ['fatura_fechou', 'fatura_vence', 'configurar']);
});

test('v2.3 inferCardDays: closing day from the purchases, due day from the file names (or the payments)', () => {
  const rows = fatura('i1', '2026-06-28', '2026-07-27').concat(fatura('i2', '2026-07-28', '2026-08-27'), fatura('i3', '2026-08-28', '2026-09-27'));
  // a late fee posted after the closing of one fatura does not change the answer
  rows.push(tx('2026-07-29', -300, 'IOF', 'cartao', 'i1'));
  const imports = { i1: { id: 'i1', fileName: 'Fatura2026-08-05.csv' }, i2: { id: 'i2', fileName: 'Fatura2026-09-05.csv' }, i3: { id: 'i3', fileName: 'Fatura2026-10-05.csv' } };
  const r = E.inferCardDays({ accountId: 'cartao', accounts: [card({ closingDay: undefined, dueDay: undefined }), conta()], transactions: rows, imports });
  assert.equal(r.closingDay, 28);
  assert.equal(r.dueDay, 5);
  assert.equal(r.samples, 3);
  assert.ok(r.basis.length === 2 && /nome de 3 faturas/.test(r.basis[0]));
  // without dates in the names: the payments seen in the bank
  const noNames = { i1: { id: 'i1', fileName: 'a.csv' }, i2: { id: 'i2', fileName: 'b.csv' }, i3: { id: 'i3', fileName: 'c.csv' } };
  const pays = [tx('2026-08-04', -1, 'PAGAMENTO DE FATURA', 'conta', 'e', { kind: 'card_payment' }), tx('2026-09-05', -1, 'PAGAMENTO DE FATURA', 'conta', 'e', { kind: 'card_payment' }), tx('2026-10-05', -1, 'PAGAMENTO DE FATURA', 'conta', 'e', { kind: 'card_payment' })];
  const r2 = E.inferCardDays({ accountId: 'cartao', accounts: [card(), conta()], transactions: rows.concat(pays), imports: noNames });
  assert.equal(r2.closingDay, 28);
  assert.equal(r2.dueDay, 5);
  // nothing to go on
  const r3 = E.inferCardDays({ accountId: 'cartao', accounts: [card()], transactions: [], imports: {} });
  assert.deepEqual([r3.closingDay, r3.dueDay, r3.samples], [null, null, 0]);
  // an extrato kept in the card account is not used
  const ext = [];
  for (let i = 0; i < 8; i++) ext.push(tx(addDays('2026-07-03', i * 11), i % 2 ? 50000 : -2000, i % 2 ? 'TED RECEBIDA' : 'PIX ENVIADO', 'cartao', 'ex', { balance: 100000 + i }));
  assert.equal(E.inferCardDays({ accountId: 'cartao', accounts: [card()], transactions: ext, imports: { ex: { id: 'ex', fileName: 'extrato_de_03-07-2026_ate_01-10-2026.csv' } } }).samples, 0);
});

test('v2.3 fileDates', () => {
  assert.deepEqual(E.fileDates('Fatura2026-10-05.csv'), ['2026-10-05']);
  assert.deepEqual(E.fileDates('fatura_05-10-2026.csv'), ['2026-10-05']);
  assert.deepEqual(E.fileDates('extrato_de_03-07-2026_ate_01-10-2026.csv'), ['2026-07-03', '2026-10-01']);
  assert.deepEqual(E.fileDates('NU_123456789_01ABR2026_30ABR2026.csv'), []);
  assert.deepEqual(E.fileDates('fatura-xp-2026-13-40.csv'), []);
});

test('v2.3 dataHealth c: with a configured card, each payment is checked against the cycle whose due date is nearest', () => {
  const accounts = [card(), conta()];
  const imports = { f9: { id: 'f9', fileName: 'Fatura2026-09-05.csv' }, f10: { id: 'f10', fileName: 'Fatura2026-10-05.csv' } };
  const f9 = fatura('f9', '2026-07-28', '2026-08-27'), f10 = fatura('f10', '2026-08-28', '2026-09-27');
  const tot = rows => -rows.reduce((s, t) => s + t.amount, 0);
  const pay = (date, amount, id) => tx(date, -amount, 'PAGAMENTO DE FATURA', 'conta', 'ext', { kind: 'card_payment', id });
  const ext = [tx('2026-07-01', 500000, 'TED RECEBIDA', 'conta', 'ext'), tx('2026-10-08', -100, 'PIX', 'conta', 'ext')];
  const H = (rows, accs) => E.dataHealth({ transactions: rows, accounts: accs || accounts, imports, settings: {}, today: '2026-10-20' });
  // paid on time, matching amounts → nothing in "c"
  const ok = H(ext.concat(f9, f10, [pay('2026-09-04', tot(f9), 'p9'), pay('2026-10-05', tot(f10), 'p10')]));
  assert.deepEqual(ok.filter(w => w.id.startsWith('c:')).map(w => w.id), []);
  // August payment (due 05/08) without its fatura: the message names the cycle
  const miss = H(ext.concat(f9, f10, [pay('2026-08-06', 33333, 'p8'), pay('2026-09-04', tot(f9), 'p9'), pay('2026-10-05', tot(f10), 'p10')]));
  const w = miss.find(w => w.id === 'c:no-fatura:p8');
  assert.ok(w, 'payment without fatura');
  assert.match(w.detail, /Importe a fatura de Cartão XP com vencimento em 05\/08\/2026 \(fechou em 28\/07\)/);
  assert.match(w.detail, /de 28\/06 a 27\/07/);
  assert.deepEqual(w.months, ['2026-07']);
  assert.equal(w.action.accountId, 'cartao');
  assert.ok(!miss.some(w => w.id.startsWith('c:mismatch:')), 'the other two still match their own cycles (not shifted by one)');
  // a payment matched by cycle with a different amount → mismatch names the due date
  const mm = H(ext.concat(f9, f10, [pay('2026-09-04', tot(f9) + 5000, 'p9'), pay('2026-10-05', tot(f10), 'p10')])).find(w => w.id === 'c:mismatch:p9');
  assert.ok(mm);
  assert.match(mm.detail, /vencimento 05\/09\/2026, compras de 28\/07 a 27\/08/);
  // an unconfigured second card: an unlinked payment is not forced into the configured card's cycle
  const two = H(ext.concat(f9, f10, [pay('2026-08-06', 33333, 'p8')]), accounts.concat([{ id: 'nu', name: 'Nubank', type: 'credit_card' }])).find(w => w.id === 'c:no-fatura:p8');
  assert.ok(two && !/fechou em/.test(two.detail), 'falls back to the old wording');
});
