'use strict';
// v2.4a: CNAE from text copied off a company page; "Gerenciar dados" deletions (selection + integrity afterwards).
// All data synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../site/engine.js');

let seq = 0;
const tx = (date, amount, raw, accountId, importId, extra) => Object.assign({ id: 'r' + (++seq), date, amount, rawDescription: raw, merchant: raw, accountId, importId, kind: amount < 0 ? 'expense' : 'income', updatedAt: '2026-09-01T00:00:00.000Z' }, extra || {});

function fixture() {
  seq = 0;
  const accounts = [{ id: 'cartao', name: 'Cartão XP', type: 'credit_card' }, { id: 'conta', name: 'Conta XP', type: 'checking' }, { id: 'nu', name: 'Nubank', type: 'credit_card' }];
  const rows = [
    // fatura ago (cartão) incl. a parcela 2/3 and the card-side payment
    tx('2026-08-03', -5000, 'MERCADO A', 'cartao', 'imp-ago'),
    tx('2026-08-10', -3000, 'LOJA PARC', 'cartao', 'imp-ago', { installment: { n: 2, total: 3 }, originalDate: '2026-07-10' }),
    tx('2026-08-12', 20000, 'PAGAMENTO RECEBIDO', 'cartao', 'imp-ago', { kind: 'card_payment' }),
    // fatura set (cartão), same file name imported twice (second time only one new row)
    tx('2026-09-02', -4000, 'MERCADO B', 'cartao', 'imp-set1'),
    tx('2026-09-10', -3000, 'LOJA PARC', 'cartao', 'imp-set1', { installment: { n: 3, total: 3 }, originalDate: '2026-07-10' }),
    tx('2026-09-15', -1500, 'PADARIA', 'cartao', 'imp-set2'),
    // extrato (conta), Aug + Sep; the Aug bill payment is linked to the card-side payment
    tx('2026-08-05', 900000, 'SALARIO', 'conta', 'imp-ext'),
    tx('2026-08-12', -20000, 'PAGTO FATURA CARTAO', 'conta', 'imp-ext', { kind: 'card_payment' }),
    tx('2026-09-05', 900000, 'SALARIO', 'conta', 'imp-ext'),
    // Nubank (another card)
    tx('2026-09-20', -7000, 'UBER', 'nu', 'imp-nu')
  ];
  rows[2].linkedTo = rows[7].id; rows[7].linkedTo = rows[2].id;
  const imports = {};
  const rec = (id, fileName, accountId) => { const r = rows.filter(t => t.importId === id); const d = r.map(t => t.date).sort(); imports[id] = { id, fileName, accountId, at: '2026-09-25T10:00:00.000Z', count: r.length, total: r.reduce((a, t) => a + t.amount, 0), from: d[0], to: d[d.length - 1] }; };
  rec('imp-ago', 'fatura-ago.csv', 'cartao'); rec('imp-set1', 'fatura-set.csv', 'cartao'); rec('imp-set2', 'fatura-set.csv', 'cartao');
  rec('imp-ext', 'extrato.csv', 'conta'); rec('imp-nu', 'nubank.csv', 'nu');
  const series = E.rememberInstallmentSeries(rows[1], 'compras.casa', [], { now: '2026-09-01T00:00:00.000Z' });
  const rules = [{ id: 'learn1', field: 'merchant', op: 'equals', value: 'UBER', set: { categoryId: 'transporte.app' } }].concat(series.rules);
  const settings = { budgets: {}, dismissedAlerts: ['fatura_fechou:nu:2026-09', 'fatura_fechou:cartao:2026-09', 'configurar:nu'] };
  const profiles = [{ id: 'pf-nu', name: 'Nubank CSV', defaultAccountId: 'nu', columns: {} }, { id: 'pf-xp', name: 'Fatura XP', defaultAccountId: 'cartao', columns: {} }];
  return { transactions: rows, imports, rules, settings, profiles, accounts };
}
const apply = (data, sel, opts) => {
  const s = E.selectForDeletion(data.transactions, sel, data.imports);
  return { s, r: E.applyDeletion(data, s.ids, Object.assign({ now: '2026-10-04T12:00:00.000Z' }, opts || {})) };
};
const after = (data, r) => ({ transactions: r.transactions, imports: r.imports, accounts: r.accounts });

test('v2.4a fixture is consistent', () => {
  const d = fixture();
  assert.deepEqual(E.dataIntegrity(d), []);
});

test('v2.4a selectForDeletion: by import, by file name, by month (+ account), by account, by ids; nothing without criteria', () => {
  const d = fixture();
  const a = E.selectForDeletion(d.transactions, { importIds: ['imp-set1'] }, d.imports);
  assert.equal(a.count, 2); assert.deepEqual(a.months, ['2026-09']); assert.equal(a.sum, -7000); assert.deepEqual(a.importIds, ['imp-set1']);
  const f = E.selectForDeletion(d.transactions, { fileName: 'fatura-set.csv' }, d.imports);
  assert.equal(f.count, 3, 'every import of the same file name'); assert.deepEqual(f.importIds, ['imp-set1', 'imp-set2']);
  const m = E.selectForDeletion(d.transactions, { month: '2026-08' }, d.imports);
  assert.equal(m.count, 5); assert.deepEqual(m.accounts, ['cartao', 'conta']);
  const ma = E.selectForDeletion(d.transactions, { month: '2026-09', accountId: 'cartao' }, d.imports);
  assert.equal(ma.count, 3); assert.deepEqual(ma.accounts, ['cartao']);
  const acc = E.selectForDeletion(d.transactions, { accountId: 'nu' }, d.imports);
  assert.deepEqual(acc.ids, ['r10']);
  const ids = E.selectForDeletion(d.transactions, { ids: ['r1', 'r9', 'nope'] }, d.imports);
  assert.deepEqual(ids.ids, ['r1', 'r9']); assert.deepEqual(ids.months, ['2026-08', '2026-09']); assert.equal(ids.sum, 895000);
  assert.equal(E.selectForDeletion(d.transactions, {}, d.imports).count, 0);
  // tombstones never selected
  const withTomb = d.transactions.concat([{ id: 'dead', deleted: true, updatedAt: 'x', date: '2026-08-01' }]);
  assert.equal(E.selectForDeletion(withTomb, { month: '2026-08' }, d.imports).count, 5);
});

test('v2.4a delete one import: record removed, others untouched, integrity kept', () => {
  const d = fixture();
  const { r } = apply(d, { importIds: ['imp-set2'] });
  assert.equal(r.removed.length, 1);
  assert.ok(!r.imports['imp-set2'] && r.imports['imp-set1']);
  assert.deepEqual(r.meta, ['imports']);
  assert.deepEqual(E.dataIntegrity(after(d, r)), []);
});

test('v2.4a delete a month: partial imports get count/total/from/to of what is left; links to removed rows cleared', () => {
  const d = fixture();
  const { r } = apply(d, { month: '2026-08' });
  assert.ok(!r.imports['imp-ago'], 'import with no rows left → removed');
  const ext = r.imports['imp-ext'];
  assert.equal(ext.count, 1); assert.equal(ext.from, '2026-09-05'); assert.equal(ext.to, '2026-09-05'); assert.equal(ext.total, 900000);
  assert.equal(ext.updatedAt, '2026-10-04T12:00:00.000Z');
  assert.deepEqual(E.dataIntegrity(after(d, r)), []);
  assert.equal(r.transactions.length, 5);
});

test('v2.4a month + one account: the linked payment on the other account loses its dangling link', () => {
  const d = fixture();
  const { r } = apply(d, { month: '2026-08', accountId: 'cartao' });
  const pay = r.transactions.find(t => t.rawDescription === 'PAGTO FATURA CARTAO');
  assert.equal(pay.linkedTo, undefined);
  assert.equal(pay.kind, 'card_payment', 'still a bill payment, only the link goes');
  assert.ok(r.changed.some(t => t.id === pay.id) && pay.updatedAt === '2026-10-04T12:00:00.000Z');
  assert.deepEqual(E.dataIntegrity(after(d, r)), []);
});

test('v2.4a installment-series rule: kept while a parcela remains, removed when only removed rows matched it', () => {
  const d = fixture();
  const one = apply(d, { importIds: ['imp-ago'] }).r;
  assert.ok(one.rules.some(x => x.origin === 'installment'), 'parcela 3/3 still there → rule kept');
  const both = apply(d, { ids: ['r2', 'r5'] }).r;
  assert.ok(!both.rules.some(x => x.origin === 'installment'), 'every parcela gone → rule gone');
  assert.ok(both.rules.some(x => x.id === 'learn1'), 'ordinary rules never touched');
  assert.ok(both.meta.includes('rules'));
});

test('v2.4a delete an account: rows, imports, dismissed alerts and profile default go; "keep account" keeps it', () => {
  const d = fixture();
  const { s, r } = apply(d, { accountId: 'nu' }, { removeAccountIds: ['nu'] });
  assert.equal(s.count, 1);
  assert.ok(!r.accounts.some(a => a.id === 'nu'));
  assert.ok(!r.imports['imp-nu']);
  assert.deepEqual(r.settings.dismissedAlerts, ['fatura_fechou:cartao:2026-09']);
  assert.equal(r.profiles.find(p => p.id === 'pf-nu').defaultAccountId, undefined);
  assert.equal(r.profiles.find(p => p.id === 'pf-xp').defaultAccountId, 'cartao');
  assert.deepEqual(r.meta.sort(), ['accounts', 'imports', 'profiles', 'settings']);
  assert.deepEqual(E.dataIntegrity(Object.assign(after(d, r))), []);
  const k = apply(d, { accountId: 'nu' }).r;
  assert.ok(k.accounts.some(a => a.id === 'nu'), 'keep the account, delete only the rows');
  assert.deepEqual(k.settings, d.settings);
  assert.deepEqual(E.dataIntegrity(after(d, k)), []);
});

test('v2.4a summaries after a deletion = summaries of the data without those rows', () => {
  const d = fixture();
  const { s, r } = apply(d, { fileName: 'fatura-set.csv' });
  const gone = new Set(s.ids);
  const expected = d.transactions.filter(t => !gone.has(t.id));
  for (const ym of ['2026-08', '2026-09']) {
    const a = E.summarize(r.transactions, { from: ym, to: ym, accounts: r.accounts });
    const b = E.summarize(expected, { from: ym, to: ym, accounts: d.accounts });
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), ym);
  }
  assert.ok(!r.transactions.some(t => gone.has(t.id)));
});

test('v2.4a dataIntegrity flags orphans, wrong counts, unknown accounts and dangling links', () => {
  const d = fixture();
  d.imports['imp-x'] = { id: 'imp-x', fileName: 'x.csv', accountId: 'gone', count: 3 };
  d.imports['imp-nu'].count = 9;
  d.transactions.push(tx('2026-09-01', -100, 'SOLTO', 'fantasma', null, { linkedTo: 'nope' }));
  const kinds = E.dataIntegrity(d).map(p => p.kind + ':' + p.id).sort();
  assert.deepEqual(kinds, ['dangling_link:r11', 'import_account:imp-x', 'import_count:imp-nu', 'orphan_import:imp-x', 'unknown_account:r11']);
});

test('v2.4a CNAE from text copied off a company page (cnpj.biz / Receita style)', () => {
  const page = 'JOSE FARMA LTDA\nCNPJ: 11.222.333/0001-81\nData da Abertura: 01/02/2003\nCEP: 01310-100 · Telefone (11) 3333-4444\n' +
    'Atividade Principal\n47.71-7-01 - Comércio varejista de produtos farmacêuticos, sem manipulação de fórmulas\n' +
    'Atividades Secundárias\n47.12-1-00 - Comércio varejista de mercadorias em geral\n56.11-2-01 - Restaurantes e similares';
  const a = E.suggestFromCNAE(page);
  assert.equal(a.categoryId, 'saude.farmacia'); assert.equal(a.code, '4771-7/01');
  assert.match(a.description, /farmacêuticos/);
  const sec = 'CNAEs secundários 56.11-2-01 Restaurantes\nCNAE principal: 4771-7/01 Comércio varejista de produtos farmacêuticos';
  assert.equal(E.suggestFromCNAE(sec).categoryId, 'saude.farmacia', 'the code after "principal" wins');
  assert.equal(E.suggestFromCNAE('47.71-7-01').categoryId, 'saude.farmacia');
  assert.equal(E.suggestFromCNAE('4771-7/01').categoryId, 'saude.farmacia');
  const noCode = 'Razão social: CANTINA EXEMPLO LTDA\nCNPJ 11.222.333/0001-81 · CEP 01310-100\nAtividade econômica principal: Restaurantes e similares\nNatureza jurídica: 206-2';
  assert.equal(E.suggestFromCNAE(noCode).categoryId, 'alimentacao.restaurante', 'activity text after "principal"');
  assert.equal(E.suggestFromCNAE('Comércio varejista de produtos farmacêuticos').categoryId, 'saude.farmacia');
  const onlyNumbers = 'CNPJ 11.222.333/0001-81\nCEP 01310-100\nTelefone (11) 3333-4444\nAbertura 01/02/2003 e mais um texto qualquer';
  assert.equal(E.suggestFromCNAE(onlyNumbers), null, 'CNPJ/CEP/phone on a page are not taken for a CNAE');
  // the v2.1 inputs keep working
  assert.equal(E.suggestFromCNAE('{"cnpj":"11222333000181","cnae_fiscal":4771701,"cnae_fiscal_descricao":"x"}').categoryId, 'saude.farmacia');
  assert.equal(E.suggestFromCNAE('47.12-1-00').categoryId, 'alimentacao.mercado');
});
