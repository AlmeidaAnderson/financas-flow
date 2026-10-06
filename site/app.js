/* Finanças Flow v2 — app.js
 * Phone-first UI. No inline scripts/handlers (CSP script-src 'self'): every interaction goes through the
 * delegated listeners at the bottom ([data-act] clicks, input/change by id/data-*).
 * Persistence ONLY via the Store interface (store.js, ARCHITECTURE.md). One central state (S) and one commit()
 * that persists through the store and re-renders every view (badges, banners, Painel, Transações...).
 */
(function () {
'use strict';
const FEATURES = { ai: false }; // AI code paths stay dormant: no buttons, no network

/* ================= helpers ================= */
const E = window.FinEngine;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const KIND_LBL = { expense: 'Saída', income: 'Entrada', transfer: 'Transferência', card_payment: 'Pagamento de fatura', investment: 'Investimento' };
/* v2.5: the "Tipo" choices in the editor, in plain pt-BR */
const EDIT_KIND_LBL = [['expense', 'Gasto'], ['income', 'Entrada'], ['transfer', 'Transferência entre minhas contas'], ['card_payment', 'Pagamento de fatura'], ['investment', 'Investimento']];
const TR_REASON_LBL = { pair: 'pares entre suas contas', own_name: 'em seu nome (conta fora do app)', conversion: 'conversões de moeda', card_payment: 'pagamentos de fatura', investment: 'movimentos de investimento', card_link: 'faturas ligadas ao cartão', transfer_link: 'transferências ligadas ao par' };
const TYPE_FILTER_LBL = { expense: 'Gasto', income: 'Entrada', transfer: 'Transferência', card_payment: 'Pagamento de fatura', investment: 'Investimento' };
const SRC_LBL = { rule: 'regra', learned: 'aprendido', dictionary: 'dicionário', ai: 'IA', manual: 'manual', series: 'lembrado p/ esta compra', wallet: 'pela carteira' };
const SRC_FILTER = [['rule', 'Regra'], ['learned', 'Aprendido'], ['series', 'Compra parcelada lembrada'], ['dictionary', 'Dicionário'], ['wallet', 'Carteira do benefício'], ['manual', 'Manual'], ['none', 'Sem categoria']];
const ACC_TYPES = { credit_card: 'Cartão de crédito', checking: 'Conta corrente', savings: 'Poupança', benefit: 'Benefício (VA/VR)', cash: 'Dinheiro', payslip: 'Holerite' };
const NEW_ACC_TYPES = ['credit_card', 'checking', 'savings', 'benefit', 'cash'];
const ROLE_LBL = { ignore: 'Ignorar', date: 'Data', time: 'Hora', description: 'Descrição', amount: 'Valor em R$', fxAmount: 'Valor (moeda estrangeira)', fxCurrency: 'Moeda', fxRate: 'Cotação', debit: 'Débito', credit: 'Crédito', dcFlag: 'Indicador D/C', installment: 'Parcela', balance: 'Saldo (ignorar)', tag: 'Carteira', section: 'Seção', detail: 'Detalhe', payer: 'Quem pagou', payee: 'Quem recebeu', counterparty: 'Nome (de/para)', txType: 'Tipo de transação', fxFrom: 'Câmbio: de', fxTo: 'Câmbio: para', fxToAmount: 'Câmbio: valor convertido', holder: 'Titular' };
const SIGN_LBL = { negative_is_expense: 'Negativos = gasto', positive_is_expense: 'Compras positivas = gasto', dc_flag: 'Coluna D/C', split_columns: 'Débito e crédito separados' };
const SORTS = [['date_desc', 'Data (padrão, mais recentes)'], ['date_asc', 'Data (antigas primeiro)'], ['amt_desc', 'Maior valor'], ['amt_asc', 'Menor valor'], ['merchant', 'Estabelecimento A–Z'], ['category', 'Categoria']];
const PALETTE = ['#4F7DF3', '#F2994A', '#9B6BF2', '#2BB3C0', '#E25D7B', '#E8B931', '#C86DD7', '#6C8EAD', '#C08457', '#3BA99C', '#D9534F', '#5B8C3A'];
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const NAO_ID = 'outros.nao_identificado'; // "Não sei o que é" (v2.2)
const pad2 = n => String(n).padStart(2, '0');
const ymOf = d => String(d || '').slice(0, 7);
function addMonths(ym, k) { let [y, m] = ym.split('-').map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + pad2(m); }
function lastDay(ym) { const [y, m] = ym.split('-').map(Number); return ym + '-' + pad2(new Date(y, m, 0).getDate()); }
function slug(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conta'; }
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
const nowISO = () => new Date().toISOString();
const isoToBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const isoToDM = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] : ''; };
function brToISO(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || y < 1970 || y > 2100) return null;
  if (d > new Date(y, mo, 0).getDate()) return null;
  return y + '-' + pad2(mo) + '-' + pad2(d);
}
const ss = {
  get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
const normU = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

let lastErrAt = 0;
function toast(msg, err, action) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  toast._act = null;
  if (action && action.label && typeof action.fn === 'function') {
    const b = document.createElement('button'); b.type = 'button'; b.className = 't-act'; b.id = 'toast-act'; b.dataset.act = 'toast-act'; b.textContent = action.label;
    t.appendChild(b); toast._act = action.fn;
  }
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; toast._act = null; }, err ? 6000 : action ? (action.ms || 6000) : 2800);
}
function reportErr(msg) { console.error(msg); const n = Date.now(); if (n - lastErrAt > 1200) { lastErrAt = n; toast(msg, true); } }
/* every engine call goes through here */
function eng(fn, ...args) {
  try {
    if (!E || typeof E[fn] !== 'function') throw new Error('o motor de cálculo não tem "' + fn + '"');
    return E[fn](...args);
  } catch (e) { reportErr('Não deu para concluir (' + fn + '): ' + (e && e.message || e)); return undefined; }
}
function brl(c) {
  try { if (E && E.formatBRL) return E.formatBRL(Math.round(c || 0)); } catch (e) { /* fallthrough */ }
  return (c < 0 ? '-' : '') + 'R$ ' + (Math.abs(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function brlShort(c) {
  const v = Math.abs(c) / 100;
  if (v >= 100000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
  if (v >= 10000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}
function parseMoney(str) {
  if (str == null || String(str).trim() === '') return null;
  let v = null;
  try { v = E.parseAmount(String(str).replace(/R\$\s*/, '').trim(), 'br'); } catch (e) { /* ignore */ }
  if (v == null) { const n = Number(String(str).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); v = isFinite(n) ? Math.round(n * 100) : null; }
  return v;
}
const centsToInput = c => c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ================= state ================= */
function emptyData() {
  let cats = [];
  try { cats = clone(E.DEFAULT_CATEGORIES || []); } catch (e) { reportErr('Categorias padrão indisponíveis.'); }
  return { categories: cats, rules: [], history: [], profiles: [], accounts: [], settings: { budgets: {}, schemaVersion: (E && E.SCHEMA_VERSION) || 3 }, imports: {}, txs: [] };
}
const S = {
  mode: 'example',        // example | real
  booted: false,
  auth: { mode: null, user: null },
  status: 'signed_out',
  real: null, example: null,
  ver: 0,
  ui: { tab: 'painel', month: null, range: 1, view: 'category', full: false, filter: 'all', q: '', sort: 'date_desc', adv: null, txLimit: 200 },
  imp: null,
  sheet: null              // { kind, id } of the open sheet (for remote-refresh decisions)
};
const D = () => (S.mode === 'real' ? S.real : S.example) || emptyData();
let _liveCache = { ver: -1, mode: null, list: [] };
/** live transactions: tombstones never reach a view or an engine call */
function live() {
  if (_liveCache.ver === S.ver && _liveCache.mode === S.mode && _liveCache.src === D().txs) return _liveCache.list;
  _liveCache = { ver: S.ver, mode: S.mode, src: D().txs, list: (D().txs || []).filter(t => t && !t.deleted) };
  return _liveCache.list;
}
const txById = id => live().find(t => t.id === id);

function catIndex() {
  const map = {};
  for (const g of D().categories || []) {
    map[g.id] = { id: g.id, name: g.name, group: g, isGroup: true };
    for (const c of g.children || []) map[c.id] = { id: c.id, name: c.name, group: g, isGroup: false };
  }
  return map;
}
function groupOf(catId) {
  if (!catId) return null;
  const gid = String(catId).split('.')[0];
  return (D().categories || []).find(g => g.id === gid) || null;
}
function catLabel(catId) {
  if (!catId) return 'Sem categoria';
  if (catId === NAO_ID) return 'Não identificado';
  const m = catIndex()[catId];
  if (!m) return catId;
  return m.isGroup ? m.name : m.group.name + ' › ' + m.name;
}
function accName(id) { const a = (D().accounts || []).find(a => a.id === id); return a ? a.name : id; }
function accType(id) { const a = (D().accounts || []).find(a => a.id === id); return a ? a.type : null; }
function ctx() { const st = D().settings || {}; return { rules: D().rules || [], dictionary: (E && E.DEFAULT_DICTIONARY) || [], categories: D().categories, accounts: D().accounts || [], settings: st, ownerNames: st.ownerNames || [] }; }
const countable = t => t.kind !== 'card_payment' && t.kind !== 'transfer';
/** v2.4b: a row with a foreign amount — or the IOF tied to one */
const isFxRow = t => !!(t.fx && t.fx.currency && t.fx.currency !== 'BRL') || !!(t.linkedTo && /\bIOF\b/i.test(t.rawDescription || '') && (() => { const o = txById(t.linkedTo); return o && o.fx; })());
const isUncat = t => !t.categoryId && countable(t);
const kindFor = catId => (E && E.kindForCategory ? E.kindForCategory(catId, D().categories) : null);
const uncatCount = () => live().filter(isUncat).length;

/* ---------- v2.1: settings, data health (memoized per data version), deficit carry-over ---------- */
const SEV_LBL = { blocking: 'Bloqueia o mês', warning: 'Atenção', info: 'Info' };
function settingsObj() { const d = D(); if (!d.settings) d.settings = { budgets: {} }; return d.settings; }
/** changes settings (synced meta doc), stamps updatedAt, persists and re-renders */
function updateSettings(fn, opts) { const st = settingsObj(); fn(st); st.updatedAt = nowISO(); commit(Object.assign({ meta: ['settings'] }, opts || {})); }
function carrySettings() {
  const c = settingsObj().carry || {};
  return { enabled: c.enabled !== false, startMonth: c.startMonth || null, excluded: Array.isArray(c.excluded) ? c.excluded : [], included: Array.isArray(c.included) ? c.included : [] };
}
const fmtYm = ym => { const [y, m] = String(ym).split('-').map(Number); return (MES[m - 1] || ym) + ' ' + (y || ''); };
const _memo = { health: { key: null, list: [] }, carry: { key: null, v: null } };
function memoKey() { return S.ver + '|' + S.mode + '|' + (D().txs || []).length; }
/** data-health warnings (dismissed ones filtered by the engine); recomputed only when the data version changes */
function health() {
  const k = memoKey();
  if (_memo.health.key === k) return _memo.health.list;
  const d = D();
  const list = eng('dataHealth', { transactions: live(), accounts: d.accounts || [], imports: d.imports || {}, settings: d.settings || {} }) || [];
  if (list.errors && list.errors.length) console.error('dataHealth', list.errors);
  _memo.health = { key: k, list };
  return list;
}
function healthWorst(ws) { return ws.some(w => w.severity === 'blocking') ? 'blocking' : ws.some(w => w.severity === 'warning') ? 'warning' : ws.length ? 'info' : 'ok'; }
function dataMonthsList() { return [...new Set(live().map(t => ymOf(t.date)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort(); }
/** { enabled, start, autoStart, rows, auto:{month:[reasons]}, excluded:Set, manual:Set } */
function carryInfo() {
  const k = memoKey();
  if (_memo.carry.key === k) return _memo.carry.v;
  const cs = carrySettings();
  const months = dataMonthsList();
  const auto = eng('blockingMonths', health()) || {};
  const autoStart = months.find(m => !auto[m]) || months[0] || null;
  const start = cs.startMonth && months.length && cs.startMonth <= months[months.length - 1] ? cs.startMonth : autoStart;
  const excluded = new Set(cs.excluded.concat(Object.keys(auto).filter(m => !cs.included.includes(m))));
  const end = months.length ? months[months.length - 1] : null;
  const rows = start && end ? (eng('carryover', live(), { startMonth: start, endMonth: end, enabled: cs.enabled, excludedMonths: [...excluded], accounts: D().accounts || [] }) || []) : [];
  const v = { enabled: cs.enabled, start, autoStart, rows, auto, excluded, manual: new Set(cs.excluded), included: new Set(cs.included), months };
  _memo.carry = { key: k, v };
  return v;
}
/** "Mês incompleto — não transportar": on = leave the month out of the carry-over */
function setMonthExcluded(m, on) {
  const ci = carryInfo();
  updateSettings(st => {
    const c = Object.assign({ enabled: true, startMonth: null, excluded: [], included: [] }, st.carry || {});
    c.excluded = (c.excluded || []).filter(x => x !== m); c.included = (c.included || []).filter(x => x !== m);
    if (on) { if (!ci.auto[m]) c.excluded.push(m); }
    else if (ci.auto[m]) c.included.push(m);
    st.carry = c;
  });
}
/** "Lembrar" default: off for categories the user unticked last time, and for ambiguous dictionary merchants */
function rememberDefault(t, catId) {
  if (catId === NAO_ID) return false; // "Não sei o que é" is about this one row, not the store
  if (catId && (settingsObj().rememberOff || []).includes(catId)) return false;
  if (t && E && E.ambiguousMatch && E.ambiguousMatch(t, ctx())) return false;
  return true;
}
/** remembers an explicit untick (and forgets it when ticked again); returns true when settings changed */
function noteRememberChoice(catId, remember, def) {
  if (!catId) return false;
  const st = settingsObj(); const list = Array.isArray(st.rememberOff) ? st.rememberOff : [];
  if (!remember && def && !list.includes(catId)) st.rememberOff = list.concat([catId]);
  else if (remember && list.includes(catId)) st.rememberOff = list.filter(x => x !== catId);
  else return false;
  st.updatedAt = nowISO(); P.meta.add('settings');
  return true;
}

/* ================= store glue ================= */
let store = null;
const META = ['settings', 'categories', 'rules', 'profiles', 'accounts', 'imports'];
const P = { months: new Set(), meta: new Set(), timer: null, busy: false, again: false, metaBase: {} };
/** the last version of each meta doc this device saw from / sent to the store: the base of a 3-way merge when a remote
 *  change arrives while our own write of that doc is still pending (else one device's change was silently lost) */
const setMetaBase = (name, body) => { P.metaBase[name] = body == null ? undefined : clone(body); };

function canPersist() {
  if (!store) return false;
  if (S.auth.mode === 'netlify' && !S.auth.user) return false;
  return true;
}
function metaBody(name, d) {
  d = d || S.real;
  if (name === 'settings') return Object.assign({ budgets: {} }, d.settings || {});
  if (name === 'rules') return { rules: d.rules || [], history: (d.history || []).slice(-500) };
  if (name === 'imports') return d.imports || {};
  return { items: d[name] || [] };
}
function metaIn(name, body) {
  if (body == null) return undefined;
  if (name === 'settings') return Object.assign({ budgets: {} }, body);
  if (name === 'rules') return Array.isArray(body) ? { rules: body, history: [] } : { rules: body.rules || [], history: body.history || [] };
  if (name === 'imports') {
    if (Array.isArray(body)) { const o = {}; body.forEach(r => { if (r && r.id) o[r.id] = r; }); return o; }
    if (body.items && !Array.isArray(body.items) && typeof body.items === 'object') return body.items;
    return body;
  }
  return Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []);
}
function applyMeta(d, name, body) {
  const v = metaIn(name, body);
  if (v === undefined) return;
  if (name === 'rules') { d.rules = v.rules; d.history = v.history; }
  else if (name === 'categories') { d.categories = v.length ? v : clone(E.DEFAULT_CATEGORIES); const eb = E.ensureBuiltinCategories ? E.ensureBuiltinCategories(d.categories) : null; if (eb && eb.changed) d.categories = eb.categories; }
  else d[name] = v;
}
function flatFromLoad(all) {
  const d = emptyData();
  d.settings = { budgets: {} };
  const meta = (all && all.meta) || {};
  META.forEach(n => applyMeta(d, n, meta[n]));
  const txs = [];
  Object.keys((all && all.months) || {}).forEach(ym => (all.months[ym] || []).forEach(t => { if (t && t.id) txs.push(t); }));
  d.txs = txs;
  return d;
}
function markMonths(txs) { (txs || []).forEach(t => { const ym = ymOf(t && t.date); if (/^\d{4}-\d{2}$/.test(ym)) P.months.add(ym); }); }
function schedulePersist(ms) {
  if (S.mode !== 'real') { P.months.clear(); P.meta.clear(); return; }
  clearTimeout(P.timer); P.timer = setTimeout(flushPersist, ms == null ? 350 : ms);
}
async function flushPersist() {
  if (S.mode !== 'real' || !canPersist()) return;
  if (P.busy) { P.again = true; return; }
  P.busy = true;
  const months = [...P.months], meta = [...P.meta];
  P.months.clear(); P.meta.clear();
  try {
    for (const n of meta) { const body = metaBody(n); await store.saveMeta(n, body); setMetaBase(n, body); }
    for (const ym of months) {
      const rows = live().filter(t => ymOf(t.date) === ym);
      if (rows.length) await store.saveMonth(ym, rows); else await store.deleteMonth(ym);
    }
  } catch (e) {
    months.forEach(m => P.months.add(m)); meta.forEach(m => P.meta.add(m));
    reportErr('Não consegui salvar agora (' + (e && e.message || e) + '). Tento de novo na próxima alteração.');
  } finally {
    P.busy = false;
    if (P.again) { P.again = false; schedulePersist(50); }
  }
}

/**
 * The ONE way to change data. ch = { txs?: Transaction[] (new/updated records), remove?: id[], meta?: name[],
 * keepStamp?: bool, render?: false }. Stamps updatedAt, persists through the store (debounced) and re-renders
 * every view. Returns nothing; reads go through live()/D().
 */
function commit(ch) {
  ch = ch || {};
  const d = D();
  const stamp = nowISO();
  if (ch.txs && ch.txs.length) {
    const idx = new Map(d.txs.map((t, i) => [t && t.id, i]));
    for (const t0 of ch.txs) {
      const t = ch.keepStamp && t0.updatedAt ? t0 : Object.assign({}, t0, { updatedAt: stamp });
      const i = idx.get(t.id);
      if (i != null) { markMonths([d.txs[i]]); d.txs[i] = t; } else { idx.set(t.id, d.txs.length); d.txs.push(t); }
      markMonths([t]);
    }
  }
  if (ch.remove && ch.remove.length) {
    const rm = new Set(ch.remove);
    markMonths(d.txs.filter(t => t && rm.has(t.id)));
    d.txs = d.txs.filter(t => !(t && rm.has(t.id)));
  }
  (ch.meta || []).forEach(n => P.meta.add(n));
  S.ver++;
  schedulePersist();
  if (ch.render !== false) renderAfterChange(false);
}

/* ================= load / migrate ================= */
async function loadFromStore(reason) {
  let all = null;
  try { all = await store.loadAll(); } catch (e) { reportErr('Não consegui carregar seus dados (' + (e && e.message || e) + ').'); all = null; }
  const d = flatFromLoad(all || {});
  P.metaBase = {};
  if (all && all.meta) META.forEach(n => setMetaBase(n, all.meta[n]));
  const hasData = d.txs.length || (d.accounts || []).length;
  if (!hasData) {
    S.real = d;
    S.mode = 'example';
    S.ver++;
    renderAfterChange(true);
    return { migrated: null };
  }
  const m = eng('migrateData', d);
  S.real = m && m.data ? m.data : d;
  S.mode = 'real';
  // installment-series rules whose last parcela already passed
  const pr = eng('pruneSeriesRules', S.real.rules, todayISO().slice(0, 7));
  if (pr && pr.removed && canPersist()) { S.real.rules = pr.rules; P.meta.add('rules'); schedulePersist(0); }
  if (m && (m.changedTxIds.length || m.changedMeta.length) && canPersist()) {
    const ids = new Set(m.changedTxIds);
    markMonths(S.real.txs.filter(t => t && ids.has(t.id)));
    m.changedMeta.forEach(n => P.meta.add(n));
    schedulePersist(0);
  }
  S.ver++;
  renderAfterChange(true);
  if (m && reason !== 'silent') {
    const r = m.report, bits = [];
    if (r.kinds) bits.push(r.kinds + ' tipo' + (r.kinds > 1 ? 's' : '') + ' corrigido' + (r.kinds > 1 ? 's' : ''));
    if (r.recategorized) bits.push(r.recategorized + ' recategorizado' + (r.recategorized > 1 ? 's' : ''));
    if (r.rulesCreated) bits.push(r.rulesCreated + ' regra' + (r.rulesCreated > 1 ? 's' : '') + ' aprendida' + (r.rulesCreated > 1 ? 's' : ''));
    if (bits.length) toast('Dados atualizados: ' + bits.join(' · ') + (r.transferChanges ? ' · ' + r.transferChanges + ' transferência' + (r.transferChanges > 1 ? 's' : '') + ' revisada' + (r.transferChanges > 1 ? 's' : '') : ''), false, r.transferChanges ? { label: 'Ver', fn: () => openTransfersSheet() } : null);
    else if (r.transferChanges) toast('Revisão de transferências: ' + r.transferChanges + ' lançamento' + (r.transferChanges > 1 ? 's' : '') + ' ajustado' + (r.transferChanges > 1 ? 's' : '') + '.', false, { label: 'Ver', fn: () => openTransfersSheet() });
  }
  return { migrated: m };
}

function applyRemote(ev) {
  if (!ev || !ev.kind) return;
  if (!S.real) S.real = emptyData();
  const d = S.real;
  if (ev.kind === 'meta') {
    if (META.indexOf(ev.key) < 0) return;
    if (P.meta.has(ev.key)) {
      // our write of this doc is still pending: merge the remote change into it (3-way, base = what we last saw), keep
      // it pending so the merge is what gets written. Ignoring it lost the other device's change: the store had already
      // taken the remote version as its base, so our later save looked like a plain edit of it.
      const lib = window.FinStoreLib;
      if (!lib || !lib.merge3) return;
      const m = lib.merge3(P.metaBase[ev.key], metaBody(ev.key, d), ev.data);
      setMetaBase(ev.key, ev.data);
      if (m === undefined) return;
      applyMeta(d, ev.key, m);
    } else {
      applyMeta(d, ev.key, ev.data);
      setMetaBase(ev.key, ev.data);
    }
  } else if (ev.kind === 'month') {
    const ym = ev.key;
    const incoming = (ev.data || []).filter(t => t && t.id && !t.deleted);
    const mine = d.txs.filter(t => t && ymOf(t.date) === ym);
    let rows = incoming;
    if (P.months.has(ym)) {
      // local edits not yet sent: keep the newest version of each row
      const map = new Map(incoming.map(t => [t.id, t]));
      for (const t of mine) { const o = map.get(t.id); if (!o || String(t.updatedAt || '') > String(o.updatedAt || '')) map.set(t.id, t); }
      rows = [...map.values()];
    }
    d.txs = d.txs.filter(t => !(t && ymOf(t.date) === ym)).concat(rows);
  }
  const hasData = d.txs.length || (d.accounts || []).length;
  if (S.mode !== 'real' && hasData) S.mode = 'real';
  S.ver++;
  renderAfterChange(false, true);
}

/* ================= shell & central render ================= */
const SCREENS = { painel: '#scr-painel', tx: '#scr-tx', import: '#scr-import', cats: '#scr-cats' };
function setTab(tab) {
  S.ui.tab = tab;
  Object.entries(SCREENS).forEach(([k, sel]) => { $(sel).hidden = (k !== tab); });
  $$('.tab').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  ss.set('ff-tab', tab);
  renderCurrent(); window.scrollTo({ top: 0 });
}
function renderCurrent() {
  try {
    if (S.ui.tab === 'painel') renderPainel();
    else if (S.ui.tab === 'tx') renderTx();
    else if (S.ui.tab === 'import') renderImport();
    else if (S.ui.tab === 'cats') renderCats();
  } catch (e) {
    console.error(e);
    const scr = $(SCREENS[S.ui.tab]);
    scr.innerHTML = '<div class="banner err"><div><b>Esta tela não carregou.</b> ' + esc(e.message || e) + '. Tente outra aba ou recarregue a página.</div></div>';
  }
}
let _deferRender = false;
/** Re-render everything that depends on data. remote=true: keep what the user is typing (open editor, inputs). */
function renderAfterChange(first, remote) {
  if (first) pickMonth(true);
  renderStorePill(); renderBanner(); renderBadge(); renderAlertsBell();
  try { health(); refreshOpenSheet(); } catch (e) { console.error(e); }
  if (remote) {
    const ae = document.activeElement;
    const scr = $(SCREENS[S.ui.tab]);
    // never wipe an input the user is typing in, nor the import wizard in progress
    if (S.ui.tab === 'import' || (ae && scr && scr.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) { _deferRender = true; return; }
  }
  if ($('#triage-root').innerHTML) { if (!remote) return; triageRemoteRefresh(); return; }
  renderCurrent();
  if (S.sheet && S.sheet.kind === 'accounts') renderAccountsSheet();
}
function pickMonth(force) {
  const months = live().map(t => ymOf(t.date)).filter(Boolean).sort();
  if (force || !S.ui.month) {
    const nowYm = todayISO().slice(0, 7);
    S.ui.month = months.length ? (months.includes(nowYm) ? nowYm : months[months.length - 1]) : nowYm;
  }
}
const STATUS_LBL = { synced: ['Sincronizado', 'ok'], saving: ['Salvando…', ''], offline: ['Offline', 'warn'], local: ['Só neste aparelho', 'warn'], signed_out: ['Entre para sincronizar', 'warn'], error: ['Erro ao salvar', 'err'] };
function renderStorePill() {
  const p = $('#store-pill'); if (!p) return;
  if (!S.booted) { p.textContent = 'Carregando…'; p.className = 'store-pill'; return; }
  let st = S.status;
  if (S.auth.mode === 'netlify' && !S.auth.user) st = 'signed_out';
  const [t, c] = STATUS_LBL[st] || ['Carregando…', ''];
  if (S.mode === 'example' && st !== 'signed_out') { p.innerHTML = '<span class="dotp"></span>Exemplo · ' + esc(t); p.className = 'store-pill warn'; }
  else { p.innerHTML = '<span class="dotp"></span>' + esc(t); p.className = 'store-pill ' + c; }
  p.dataset.status = st;
  const ab = $('#btn-account');
  if (ab) {
    const u = S.auth.user;
    ab.innerHTML = u && u.email ? esc(u.email.charAt(0).toUpperCase()) : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5c1.4-3.4 4-5 7.2-5s5.8 1.6 7.2 5"/></svg>';
    ab.setAttribute('aria-label', u ? (u.email ? 'Conta: ' + u.email : 'Conta') : (S.auth.mode === 'netlify' ? 'Entrar' : 'Conta'));
  }
}
function signedOut() { return S.auth.mode === 'netlify' && !S.auth.user; }
function renderBanner() {
  const b = $('#example-banner');
  if (signedOut()) {
    b.hidden = false;
    b.innerHTML = `<div class="welcome" id="signed-out"><span class="eyebrow">Finanças Flow</span><h2>Entre para ver e sincronizar seus dados</h2>
      <p class="muted">Seus extratos ficam guardados na sua conta e aparecem no PC e no celular. Enquanto isso, explore com dados de exemplo — nada é salvo.</p>
      <div class="row"><button class="btn primary" type="button" data-act="login">Entrar</button><button class="btn ghost" type="button" data-act="goto" data-tab="painel">Explorar exemplo</button></div></div>`;
    return;
  }
  if (S.mode === 'example') {
    b.hidden = false;
    b.innerHTML = '<div class="banner" style="margin-bottom:14px"><div class="grow"><b>Dados de exemplo</b> — importe seus extratos para substituir. Nada disto é salvo.</div><button class="btn sm" data-act="goto" data-tab="import" type="button">Importar</button></div>';
  } else b.hidden = true;
}
function renderBadge() {
  const n = uncatCount(); const b = $('#tab-badge');
  b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
}

/* ================= period ================= */
function period() {
  const end = S.ui.month; const start = addMonths(end, -(S.ui.range - 1));
  return { from: start + '-01', to: lastDay(end), start, end };
}
function periodLabel(short) {
  const p = period(); const [ey, em] = p.end.split('-').map(Number); const [sy, sm] = p.start.split('-').map(Number);
  if (short) return S.ui.range === 1 ? MES3[em - 1] + '/' + String(ey).slice(2) : MES3[sm - 1] + '–' + MES3[em - 1] + '/' + String(ey).slice(2);
  if (S.ui.range === 1) return MES[em - 1] + ' ' + ey;
  return MES3[sm - 1] + (sy !== ey ? ' ' + sy : '') + ' – ' + MES3[em - 1] + ' ' + ey;
}
const inPeriod = (t, p) => t.date >= p.from && t.date <= p.to;

/* ================= PAINEL ================= */
function renderPainel() {
  const el = $('#scr-painel'); const p = period();
  const sum = eng('summarize', live(), { from: p.from, to: p.to }) || { income: 0, expense: 0, net: 0, byGroup: {}, byCategory: {}, count: 0 };
  const inc = sum.income || 0, exp = sum.expense || 0;
  const net = (typeof sum.net === 'number') ? sum.net : inc - exp;
  const rate = inc > 0 ? (inc - exp) / inc : null;
  const narrow = el.clientWidth < 600 || window.innerWidth < 600;
  const unc = uncatCount();
  el.innerHTML = `
    ${unc && S.mode === 'real' ? `<div class="banner" id="triage-banner"><div class="grow"><b>${unc} lançamento${unc > 1 ? 's' : ''} sem categoria.</b> Classifique para o painel ficar certo.</div><button class="btn sm primary" type="button" data-act="triage">Classificar agora</button></div>` : ''}
    <div class="period" id="period-bar">
      <div class="month-nav">
        <button class="icon-btn" type="button" data-act="month" data-d="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <span class="lbl-m" id="period-label"><span class="lbl-long">${esc(periodLabel())}</span><span class="lbl-short" aria-hidden="true">${esc(periodLabel(true))}</span></span>
        <button class="icon-btn" type="button" data-act="month" data-d="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
        <button class="icon-btn" type="button" data-act="month-menu" id="btn-month-menu" aria-label="Opções do mês"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg></button>
      </div>
      <div class="seg" role="group" aria-label="Período">
        ${[1, 3, 6, 12].map(r => `<button type="button" data-act="range" data-r="${r}" aria-pressed="${S.ui.range === r}">${r === 1 ? 'Mês' : r + 'm'}</button>`).join('')}
      </div>
    </div>
    ${alertLineHTML()}
    <div class="kpis" role="list">
      <div class="kpi" role="listitem"><span class="eyebrow">Entradas</span><span class="v money in" id="kpi-income" data-cents="${inc}">${brl(inc)}</span></div>
      <div class="kpi" role="listitem"><span class="eyebrow">Saídas</span><span class="v money out" id="kpi-expense" data-cents="${exp}">${brl(exp)}</span></div>
      <div class="kpi" role="listitem"><span class="eyebrow">Saldo</span><span class="v money ${net < 0 ? 'out' : ''}" id="kpi-net" data-cents="${net}">${brl(net)}</span></div>
      <div class="kpi" role="listitem"><span class="eyebrow">Taxa de poupança</span><span class="v num ${rate != null && rate < 0 ? 'out' : ''}">${rate == null ? '—' : (rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</span></div>
    </div>
    <div class="pn-sum" id="pn-sum">${healthChipHTML()}${carryLineHTML()}${fxLineHTML(p)}${trPainelHTML()}</div>
    ${whoCardVisible() ? whoCardHTML('painel') : ''}
    <div class="card" id="sankey-card">
      <div class="card-h">
        <h2>Para onde foi o dinheiro</h2>
        <div class="seg" role="group" aria-label="Visão do fluxo">
          <button type="button" data-act="view" data-v="category" aria-pressed="${S.ui.view === 'category'}">Por categoria</button>
          <button type="button" data-act="view" data-v="account" aria-pressed="${S.ui.view === 'account'}">Por conta/cartão</button>
        </div>
      </div>
      <div class="sankey-wrap" id="sankey-wrap"></div>
      ${S.ui.view === 'account' ? skFlowsHTML() : ''}
      <div class="row" style="justify-content:space-between">
        <span class="sk-hint">Toque num bloco para ver os lançamentos.</span>
        ${S.ui.view === 'category' || narrow ? `<button class="btn ghost sm" type="button" data-act="full">${S.ui.full ? 'Resumir em 3 colunas' : (S.ui.view === 'category' ? 'Detalhar subcategorias' : 'Detalhar por grupo')}</button>` : ''}
      </div>
    </div>
    <div class="card" id="catchart-card"></div>
    <div class="card" id="budget-card"></div>
    <div class="card">
      <div class="card-h"><h2>Entradas × saídas</h2><div class="legend"><span><i style="background:var(--in)"></i>Entradas</span><span><i style="background:var(--out)"></i>Saídas</span></div></div>
      <div id="series-chart"></div>
    </div>
    <div class="card" id="future-card"></div>`;
  drawSankey(narrow);
  renderCatChart();
  syncTopbarH(); updateStuck();
  renderBudget(sum);
  drawSeries();
  renderFuture();
}
/* ---------- Painel: international purchases (v2.4b) ---------- */
function fxLineHTML(p) {
  const f = eng('fxSummary', live(), { from: p.from, to: p.to });
  if (!f || (!f.count && !f.iof)) return '';
  const cur = Object.keys(f.byCurrency || {}).map(c => E.formatFx({ currency: c, amount: f.byCurrency[c].amount })).join(' + ');
  return `<button type="button" class="pn-fx" id="pn-fx" data-act="fx-list"><span>Compras internacionais: <b class="money">${brl(f.total)}</b>${f.iof ? ` (+ IOF <b class="money">${brl(f.iof)}</b>)` : ''}</span>${cur ? `<span class="xs faint">${esc(cur)}</span>` : ''}</button>`;
}
/* ---------- Painel summary: data health chip + accumulated deficit ---------- */
function healthChipHTML(){
  const ws = health();
  if(!ws.length && S.mode!=='real') return '';
  const worst = healthWorst(ws);
  return `<button type="button" class="hchip sev-${worst}" data-act="health" id="health-chip" data-sev="${worst}" aria-label="Saúde dos dados: ${ws.length} aviso${ws.length===1?'':'s'}"><span class="hdot" aria-hidden="true"></span>Saúde dos dados${ws.length?`<span class="cnt" id="health-count">${ws.length}</span>`:' · tudo certo'}</button>`;
}
function carrySince(rows, idx){ let j = idx; while(j>0 && rows[j-1].carryOut>0) j--; return rows[j] ? rows[j].month : null; }
function carryLineHTML(){
  const ci = carryInfo(); if(!ci.enabled) return '';
  const idx = ci.rows.findIndex(r=>r.month===S.ui.month); if(idx<0) return '';
  const row = ci.rows[idx];
  if(row.excluded && row.carryOut>0) return `<button type="button" class="carry-line" data-act="carry" id="carry-line"><span>Déficit acumulado: <b class="money out" id="carry-total" data-cents="${row.carryOut}">${brl(row.carryOut)}</b> <span class="muted small">· este mês fica fora da conta</span></span><span aria-hidden="true">›</span></button>`;
  if(!(row.carryOut>0)) return row.carryIn>0 ? `<button type="button" class="carry-line ok" data-act="carry" id="carry-line"><span>Déficit acumulado quitado neste mês <span class="muted small">(${brl(row.repaid)} pagos)</span></span><span aria-hidden="true">›</span></button>` : '';
  const since = carrySince(ci.rows, idx);
  return `<button type="button" class="carry-line" data-act="carry" id="carry-line"><span>Déficit acumulado: <b class="money out" id="carry-total" data-cents="${row.carryOut}">${brl(row.carryOut)}</b> <span class="muted small">(desde ${esc(since ? MES3[+since.slice(5,7)-1]+'/'+since.slice(2,4) : '')})</span></span><span aria-hidden="true">›</span></button>`;
}
/* ---------- Sankey ---------- */
function sankeyCarry(){
  if(S.ui.range!==1) return null;
  const ci = carryInfo(); if(!ci.enabled) return null;
  const row = ci.rows.find(r=>r.month===S.ui.month);
  if(!row || row.excluded) return null;
  if(!(row.repaid>0) && !(row.newDeficit>0)) return null;
  return { month: row.month, repaid: row.repaid, coverage: row.newDeficit>0 ? row.coverage : null };
}
function prepareSankey(narrow){
  const p = period();
  const g = eng('buildSankey', live(), { from:p.from, to:p.to, categories:D().categories, accounts:D().accounts, view:S.ui.view, maxNodes: narrow ? 8 : 14, carry: sankeyCarry() });
  if(!g || !Array.isArray(g.nodes) || !g.nodes.length) return null;
  const nodes = g.nodes.map((n,i)=>Object.assign({}, n, { _i:i, id: n.id!=null ? String(n.id) : String(i) }));
  const byId = {}; nodes.forEach(n=>byId[n.id]=n);
  const ref = r => (typeof r==='number' && !byId[String(r)] && nodes[r]) ? nodes[r].id : (r && typeof r==='object' ? String(r.id) : String(r));
  let links = (g.links||[]).map(l=>({ source:ref(l.source), target:ref(l.target), value:Math.abs(l.value||0) })).filter(l=>byId[l.source]&&byId[l.target]&&l.value>0);
  // columns: trust engine, else derive from depth
  if(nodes.some(n=>typeof n.column!=='number')){
    const depth = {}; const incoming = {}; links.forEach(l=>{ (incoming[l.target]=incoming[l.target]||[]).push(l.source); });
    const dfs = (id, seen) => { if(depth[id]!=null) return depth[id]; if(seen.has(id)) return 0; seen.add(id); const ins = incoming[id]||[]; return depth[id] = ins.length ? 1+Math.max(...ins.map(s=>dfs(s,seen))) : 0; };
    nodes.forEach(n=>{ if(typeof n.column!=='number') n.column = dfs(n.id, new Set()); });
  }
  const showFull = S.ui.full || (S.ui.view!=='category' && !narrow); // 4 columns do not fit labels at phone width
  if(!showFull){
    const maxCol = Math.max(...nodes.map(n=>n.column));
    if(maxCol >= 3){
      const keep = new Set();
      nodes.forEach(n=>{
        if(n.column<=2) keep.add(n.id);
        else { const srcs = links.filter(l=>l.target===n.id).map(l=>byId[l.source]); if(srcs.length && srcs.every(s=>s.column<=1)){ n.column = 2; keep.add(n.id); } }
      });
      const nn = nodes.filter(n=>keep.has(n.id));
      links = links.filter(l=>keep.has(l.source)&&keep.has(l.target));
      return { nodes:nn, links, byId };
    }
  }
  return { nodes, links, byId };
}
function drawSankey(narrow){
  const wrap = $('#sankey-wrap'); if(!wrap) return;
  const g = prepareSankey(narrow);
  if(!g){ wrap.innerHTML = '<div class="empty"><b>Sem movimento neste período.</b><span class="small">Escolha outro mês ou importe um extrato.</span></div>'; return; }
  const {nodes, links} = g;
  const cols = [...new Set(nodes.map(n=>n.column))].sort((a,b)=>a-b);
  const colIdx = {}; cols.forEach((c,i)=>colIdx[c]=i);
  const nCols = cols.length;
  const avail = Math.max(300, (wrap.clientWidth || 372) - 32);
  const W = (S.ui.full && nCols>3) ? Math.max(avail, 700) : avail;
  const rightLbl = Math.min(150, Math.max(116, W*0.36));
  const nodeW = 10, hubW = 22, top = 20, bottom = 8;
  const perCol = {}; nodes.forEach(n=>{ (perCol[n.column]=perCol[n.column]||[]).push(n); });
  const maxCount = Math.max(...Object.values(perCol).map(a=>a.length));
  let H = Math.max(280, Math.min(640, maxCount*38 + 40));
  const gap = 12;
  const out = {}, inn = {};
  links.forEach(l=>{ (out[l.source]=out[l.source]||[]).push(l); (inn[l.target]=inn[l.target]||[]).push(l); });
  nodes.forEach(n=>{
    const so = (out[n.id]||[]).reduce((s,l)=>s+l.value,0), si = (inn[n.id]||[]).reduce((s,l)=>s+l.value,0);
    n.v = Math.max(Math.abs(n.value||0), so, si);
  });
  const hubCol = cols.length>1 ? cols[1] : null;
  // one scale for every column
  let k = Infinity;
  cols.forEach(c=>{ const arr = perCol[c]; const tot = arr.reduce((s,n)=>s+n.v,0); if(tot>0) k = Math.min(k, (H-top-bottom-gap*(arr.length-1))/tot); });
  if(!isFinite(k)) k = 0;
  const xFor = ci => { const span = W - rightLbl - nodeW; return nCols<=1 ? 0 : Math.round(ci * span/(nCols-1)); };
  cols.forEach((c,ci)=>{
    const arr = perCol[c];
    if(ci>=2){
      // order by the position of the parent so bands do not cross
      arr.forEach(n=>{ const ins = inn[n.id]||[]; n._p = ins.length ? Math.min(...ins.map(l=>g.byId[l.source]._y0||0)) : 1e9; });
      arr.sort((a,b)=> (a._p-b._p) || (isLeafSpecial(a)-isLeafSpecial(b)) || (b.v-a.v));
    }
    const tot = arr.reduce((s,n)=>s+n.v*k,0) + gap*(arr.length-1);
    const minSlot = (c===hubCol) ? 0 : 27;
    const need = arr.reduce((s,n)=>s+Math.max(n.v*k+gap, minSlot),0) - gap;
    let y = top + Math.max(0,(H-top-bottom-Math.max(tot,need))/2);
    arr.forEach(n=>{ n._x = xFor(ci); n._w = (c===hubCol) ? hubW : nodeW; if(c===hubCol) n._x -= (hubW-nodeW)/2; n._y0 = y; n._y1 = y + Math.max(1, n.v*k); y = Math.max(n._y1 + gap, n._y0 + minSlot); n._ci = ci; });
  });
  H = Math.max(H, Math.ceil(Math.max(...nodes.map(n=>n._y1))) + bottom);
  // stack link ends
  nodes.forEach(n=>{
    let sy = n._y0; (out[n.id]||[]).sort((a,b)=>g.byId[a.target]._y0-g.byId[b.target]._y0).forEach(l=>{ l._sy0 = sy; sy += l.value*k; l._sy1 = sy; });
    let ty = n._y0; (inn[n.id]||[]).sort((a,b)=>g.byId[a.source]._y0-g.byId[b.source]._y0).forEach(l=>{ l._ty0 = ty; ty += l.value*k; l._ty1 = ty; });
  });
  const colorOf = n => n.color ? chartColor(n.color) : 'var(--accent)'; // same shades as the category chart
  const linkPaths = links.map(l=>{
    const s = g.byId[l.source], t = g.byId[l.target];
    const x0 = s._x + s._w, x1 = t._x, xm = (x0+x1)/2;
    const col = (t.column===hubCol) ? colorOf(s) : colorOf(t);
    const d = `M${x0},${l._sy0}C${xm},${l._sy0} ${xm},${l._ty0} ${x1},${l._ty0}L${x1},${l._ty1}C${xm},${l._ty1} ${xm},${l._sy1} ${x0},${l._sy1}Z`;
    return `<path class="sk-link" d="${d}" fill="${esc(col)}" fill-opacity=".3"><title>${esc(s.name)} → ${esc(t.name)}: ${esc(brl(l.value))}</title></path>`;
  }).join('');
  const trunc = (s,n) => { s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; };
  const nodeEls = nodes.map(n=>{
    const h = n._y1-n._y0, isHub = n.column===hubCol, last = n._ci===nCols-1;
    let label = '';
    if(isHub){
      const cx = n._x + n._w/2, cy = (n._y0+n._y1)/2;
      const hubTxt = trunc(n.name,18)+' · '+brlShort(n.v);
      label = h > hubTxt.length*6.6+16 ? `<text transform="translate(${cx+4},${cy}) rotate(-90)" text-anchor="middle" style="font-size:11.5px;font-weight:700;fill:var(--surface);letter-spacing:.02em">${esc(hubTxt)}</text>`
                      : `<text x="${cx}" y="${n._y0-4}" text-anchor="middle" class="sk-val" style="font-weight:700">${esc(brlShort(n.v))}</text>`;
    } else {
      const lx = n._x + n._w + 6; const cy = (n._y0+n._y1)/2;
      const maxCh = last ? Math.floor((rightLbl-8)/6.6) : Math.max(6, Math.floor((xFor(n._ci+1)-n._x-n._w-hubW/2-12)/6.6));
      if(h >= 24) label = `<text x="${lx}" y="${cy-2}" class="sk-label">${esc(trunc(n.name,maxCh))}</text><text x="${lx}" y="${cy+11}" class="sk-val">${esc(last?brl(n.v):brlShort(n.v))}</text>`;
      else { const vs = brlShort(n.v); const fits = n.name.length + vs.length + 1 <= maxCh;
        label = fits ? `<text x="${lx}" y="${cy+4}" class="sk-label">${esc(n.name)} <tspan class="sk-val" style="font-weight:500">${esc(vs)}</tspan></text>`
                     : `<text x="${lx}" y="${cy-1}" class="sk-label">${esc(trunc(n.name,maxCh))}</text><text x="${lx}" y="${cy+10}" class="sk-val">${esc(vs)}</text>`; }
    }
    const fill = isHub ? 'var(--ipe)' : colorOf(n);
    return `<g class="sk-node" tabindex="0" role="button" data-act="sknode" data-id="${esc(n.id)}" aria-label="${esc(n.name)}: ${esc(brl(n.v))}">
      <rect class="sk-hit" x="${n._x-2}" y="${n._y0-2}" width="${n._w+4}" height="${Math.max(6,h)+4}" fill="transparent" rx="3"/>
      <rect x="${n._x}" y="${n._y0}" width="${n._w}" height="${Math.max(1,h)}" rx="${isHub?5:2.5}" fill="${esc(fill)}"/>${label}</g>`;
  }).join('');
  wrap.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fluxo de dinheiro de ${esc(periodLabel())}">${linkPaths}${nodeEls}</svg>`;
  // fit labels with real text metrics (char-width estimates clip bold labels at the right edge)
  try{
    const svg = wrap.querySelector('svg');
    svg.querySelectorAll('text.sk-label').forEach(tx=>{
      const x = +tx.getAttribute('x'); const limit = W - 2 - x; let guard = 40;
      const target = tx.firstChild && tx.firstChild.nodeType===3 ? tx.firstChild : null;
      if(!target) return;
      const full = target.nodeValue;
      while(tx.getComputedTextLength() > limit && target.nodeValue.replace(/…\s*$/,'').trim().length > 3 && guard--){
        target.nodeValue = target.nodeValue.replace(/…\s*$/,'').trimEnd().slice(0,-1).trimEnd() + (tx.querySelector('tspan') ? '… ' : '…');
      }
      if(target.nodeValue!==full && !tx.querySelector('title')){ const t = document.createElementNS('http://www.w3.org/2000/svg','title'); t.textContent = full; tx.appendChild(t); }
    });
  }catch(e){}
  S._sankey = g;
}
function isLeafSpecial(n){ return /sobra|poupan|d[ée]ficit|impost/i.test(n.name||'') ? 1 : 0; }

/* figure out which transactions sit behind a node (ids are engine-defined, so match loosely) */
function txForNode(node){
  const p = period(); const txs = live().filter(t=>inPeriod(t,p) && countable(t));
  const cats0 = catIndex(); const accs0 = D().accounts||[]; const id0 = String(node.id);
  const out0 = t => t.amount<0 || t.kind==='expense' || t.kind==='investment';
  const inGroup = (t,gid) => t.categoryId===gid || String(t.categoryId||'').split('.')[0]===gid;
  // engine id scheme: src:<cat|__outras>, grp:<gid|__none>, cat:<catId>, cat:grp:<gid>|__outros, acc:<accId>, ag:<accId>:<gid>, ag:acc:<accId>|__outros
  let m;
  if((m = id0.match(/^cat:grp:(.+)\|__outros$/))){
    const gid = m[1]; const shown = new Set((S._sankey&&S._sankey.nodes||[]).map(n=>String(n.id)).filter(x=>x.startsWith('cat:')&&!x.includes('|')).map(x=>x.slice(4)));
    const g = cats0[gid]; return { kind: g?'cat':'other', cat:g, txs: txs.filter(t=>out0(t) && inGroup(t,gid) && !shown.has(t.categoryId)) };
  }
  if((m = id0.match(/^ag:acc:(.+)\|__outros$/))){
    const accId = m[1]; const shown = new Set((S._sankey&&S._sankey.nodes||[]).map(n=>String(n.id)).filter(x=>x.startsWith('ag:'+accId+':')).map(x=>x.slice(4+accId.length)));
    return { kind:'other', txs: txs.filter(t=>out0(t) && t.accountId===accId && !shown.has(String(t.categoryId||'__none').split('.')[0])) };
  }
  if((m = id0.match(/^ag:(.+):([^:]+)$/))){
    const accId = m[1], gid = m[2];
    return { kind:'other', txs: txs.filter(t=>out0(t) && t.accountId===accId && (gid==='__none' ? !t.categoryId : inGroup(t,gid))) };
  }
  if(id0==='grp:__none') return { kind:'uncat', txs: txs.filter(t=>!t.categoryId && out0(t)) };
  if(id0==='src:__outras') return { kind:'other', txs: txs.filter(t=>t.kind==='income' && !t.categoryId) };
  if((m = id0.match(/^src:(.+)$/)) && cats0[m[1]]){ const c = cats0[m[1]]; return { kind:'cat', cat:c, txs: txs.filter(t=>t.kind==='income' && (t.categoryId===c.id || (c.isGroup && inGroup(t,c.id)))) }; }
  if((m = id0.match(/^(?:grp|cat):(.+)$/)) && cats0[m[1]]){ const c = cats0[m[1]]; return { kind:'cat', cat:c, txs: txs.filter(t=>out0(t) && (t.categoryId===c.id || (c.isGroup && inGroup(t,c.id)))) }; }
  if((m = id0.match(/^acc:(.+)$/))){ const a = accs0.find(a=>a.id===m[1]); if(a) return { kind:'acc', acc:a, txs: txs.filter(t=>t.accountId===a.id && out0(t)) }; }
  const cands = new Set([node.id]); const parts = String(node.id).split(/[:|/]/); cands.add(parts[parts.length-1]);
  const cats = catIndex(); const accs = D().accounts||[];
  for(const c of cands){
    if(cats[c]) return { kind:'cat', cat:cats[c], txs: txs.filter(t=> t.categoryId===c || (cats[c].isGroup && String(t.categoryId||'').split('.')[0]===c)) };
    const a = accs.find(a=>a.id===c); if(a) return { kind:'acc', acc:a, txs: txs.filter(t=>t.accountId===c && t.amount<0) };
  }
  const byName = Object.values(cats).find(c=>c.name===node.name);
  if(byName) return { kind:'cat', cat:byName, txs: txs.filter(t=> t.categoryId===byName.id || (byName.isGroup && String(t.categoryId||'').split('.')[0]===byName.id)) };
  const accN = accs.find(a=>a.name===node.name); if(accN) return { kind:'acc', acc:accN, txs: txs.filter(t=>t.accountId===accN.id && t.amount<0) };
  if(/sem categoria|n[ãa]o categoriz/i.test(node.name||'')) return { kind:'uncat', txs: txs.filter(t=>!t.categoryId) };
  return { kind:'other', txs:[] };
}
function openNodeSheet(id){
  const g = S._sankey; if(!g) return; const node = g.byId[id]; if(!node) return;
  const info = txForNode(node);
  let body = '';
  if(info.kind==='cat' && info.cat.isGroup){
    const by = {}; info.txs.forEach(t=>{ const k=t.categoryId||info.cat.id; by[k]=(by[k]||0)+Math.abs(t.amount); });
    const rows = Object.entries(by).sort((a,b)=>b[1]-a[1]); const mx = rows.length ? rows[0][1] : 1;
    body += rows.length ? `<div class="bud">${rows.map(([cid,v])=>`<div class="bud-row"><div class="bud-top"><span class="nm">${esc(catIndex()[cid]?catIndex()[cid].name:cid)}</span><span class="money">${brl(v)}</span></div><div class="bud-bar"><i style="width:${(v/mx*100).toFixed(1)}%;background:${esc(info.cat.group.color||'var(--accent)')}"></i></div></div>`).join('')}</div>` : '';
  }
  if(info.txs.length){
    const sorted = info.txs.slice().sort((a,b)=>b.date.localeCompare(a.date));
    body += `<h3>${sorted.length} lançamento${sorted.length>1?'s':''}</h3><div class="txlist">${sorted.slice(0,80).map(txRow).join('')}</div>`;
    if(sorted.length>80) body += `<p class="small muted">Mostrando 80 de ${sorted.length}. Veja todos em Transações.</p>`;
  } else if(String(node.id)==='carry') body += '<p class="muted">Parte da sobra deste mês que paga o déficit que veio dos meses anteriores. Enquanto houver déficit acumulado, a sobra vai primeiro para ele.</p><div class="row"><button class="btn sm" type="button" data-act="carry">Ver mês a mês</button></div>';
  else if(/^deficit/.test(String(node.id))) body += `<p class="muted">${({'deficit:card':'Gastos no cartão deste mês que só serão pagos na fatura do mês que vem. Por isso o mês fecha no vermelho sem faltar dinheiro agora.','deficit:inv':'Dinheiro que saiu de investimentos (resgates) para cobrir os gastos do mês.','deficit:bal':'O que faltou e saiu do saldo da conta ou da reserva.'})[node.id] || 'Quanto as saídas passaram das entradas no período.'}</p><div class="row"><button class="btn sm" type="button" data-act="carry">Ver mês a mês</button></div>`;
  else if(/sobra|poupan/i.test(node.name)) body += '<p class="muted">É o que sobrou das entradas depois das saídas no período. Investimentos e aplicações entram aqui quando não são classificados como gasto.</p>';
  else if(/impost|inss|irrf/i.test(node.name)) body += '<p class="muted">Descontos do holerite (INSS, IRRF e outros). Eles saem do salário bruto antes de o dinheiro chegar na conta.</p>';
  else if(/or[çc]amento/i.test(node.name)) body += '<p class="muted">Tudo o que entrou no período, antes de ser distribuído entre os gastos e a sobra.</p>';
  else body += '<p class="muted">Este bloco agrupa valores sem lançamentos individuais para mostrar aqui.</p>';
  openSheet(`<div><span class="eyebrow">${esc(periodLabel())}</span><h2>${esc(node.name)}</h2><p class="money" style="font-size:1.1rem;font-weight:700">${brl(node.v)}</p></div>`, body);
}

/* ---------- v2.1 sheets: Saúde dos dados, déficit mês a mês, menu do mês ---------- */
function refreshOpenSheet(){
  if(!S.sheet) return;
  if(S.sheet.kind==='health') renderHealthSheet();
  else if(S.sheet.kind==='carry') renderCarrySheet();
  else if(S.sheet.kind==='month') renderMonthMenu();
  else if(S.sheet.kind==='alerts') renderAlertsSheet();
  else if(S.sheet.kind==='manage') renderManageSheet();
  else if(S.sheet.kind==='transfers') renderTransfersSheet();
  else if(S.sheet.kind==='settings'){ const el = $('#carry-set'); if(el) el.innerHTML = carrySettingsHTML(); }
}
function warningById(id){ return health().find(w=>w.id===id) || null; }
function openHealthSheet(month){
  S.healthUI = { month: month || null };
  openSheet('<span class="eyebrow">Painel</span><h2>Saúde dos dados</h2>', '<div id="health-body"></div>', () => { S.healthUI = null; }, { kind:'health', label:'Saúde dos dados' });
  renderHealthSheet();
}
function renderHealthSheet(){
  const el = $('#health-body'); if(!el) return;
  const U = S.healthUI || {};
  const all = health();
  const ws = U.month ? all.filter(w=>(w.months||[]).includes(U.month)) : all;
  const nDis = (settingsObj().dismissedWarnings||[]).length;
  const ci = carryInfo();
  const cnt = k => all.filter(w=>w.severity===k).length;
  const groups = new Map();
  ws.forEach(w=>{ const k = (w.months||[])[0] || ''; if(!groups.has(k)) groups.set(k, []); groups.get(k).push(w); });
  const keys = [...groups.keys()].sort((a,b)=> a===''?1:b===''?-1:b.localeCompare(a));
  const card = w => {
    const blocking = w.severity==='blocking';
    const ms = (w.months||[]);
    const done = blocking && ms.length && ms.every(m=>ci.included.has(m));
    return `<div class="hw sev-${w.severity}" data-wid="${esc(w.id)}">
      <div class="hw-top"><span class="tag ${w.severity==='blocking'?'err':w.severity==='warning'?'warn':'acc'}">${esc(SEV_LBL[w.severity]||w.severity)}</span>${w.accountId?`<span class="tag">${esc(accName(w.accountId))}</span>`:''}${ms.length>1?`<span class="tag">${esc(ms.map(m=>MES3[+m.slice(5,7)-1]+'/'+m.slice(2,4)).join(', '))}</span>`:''}${done?'<span class="tag ok">mês marcado como completo</span>':''}</div>
      <b class="hw-t">${esc(w.title)}</b><p class="small muted">${esc(w.detail)}</p>
      <div class="row">${w.action&&w.action.label?`<button class="btn sm primary" type="button" data-act="hw-act" data-id="${esc(w.id)}">${esc(w.action.label)}</button>`:''}${blocking&&!done&&ms.length?`<button class="btn sm" type="button" data-act="hw-complete" data-id="${esc(w.id)}">Marcar mês como completo</button>`:''}<button class="btn sm ghost" type="button" data-act="hw-dismiss" data-id="${esc(w.id)}">Ignorar aviso</button></div></div>`;
  };
  el.innerHTML = `<p class="small muted">O que pode estar faltando ou fora do lugar nos seus dados. Meses com aviso <b>que bloqueia o mês</b> ficam fora do déficit acumulado até você resolver ou marcar o mês como completo.</p>
    ${all.length?`<div class="row" id="health-sum">${cnt('blocking')?`<span class="tag err">${cnt('blocking')} bloqueia${cnt('blocking')>1?'m':''} o mês</span>`:''}${cnt('warning')?`<span class="tag warn">${cnt('warning')} de atenção</span>`:''}${cnt('info')?`<span class="tag acc">${cnt('info')} info</span>`:''}</div>`:''}
    ${U.month?`<div class="row"><span class="small">Só ${esc(fmtYm(U.month))}</span><button class="btn sm ghost" type="button" data-act="health-all">Ver todos</button></div>`:''}
    ${ws.length ? keys.map(k=>`<div class="hw-group"><h3>${esc(k?fmtYm(k):'Geral')}</h3>${groups.get(k).sort((a,b)=>String(a.accountId||'').localeCompare(String(b.accountId||''))).map(card).join('')}</div>`).join('')
      : `<div class="empty" id="health-empty"><b>Nenhum aviso${U.month?' neste mês':''}.</b><span class="small">Seus dados parecem completos.</span></div>`}
    ${nDis?`<div class="row"><button class="btn sm ghost" type="button" data-act="hw-undismiss" id="hw-undismiss">Mostrar ${nDis} aviso${nDis>1?'s':''} ignorado${nDis>1?'s':''}</button></div>`:''}`;
}
function healthAction(id){
  const w = warningById(id); if(!w || !w.action) return;
  const a = w.action;
  if(a.type==='move-import'){
    closeSheet(); openAccountsSheet();
    S.accUI.move = { id:a.importId, to:null }; S.accUI.del = null; renderAccountsSheet();
    const box = $('#move-box'); if(box) box.scrollIntoView({ block:'center' });
  } else if(a.type==='import'){
    closeSheet(); S.imp = newImp();
    if(a.accountId && (D().accounts||[]).some(x=>x.id===a.accountId)) S.imp.accountId = a.accountId;
    setTab('import');
  } else if(a.type==='owner-name'){
    updateSettings(st=>{ st.ownerNames = (st.ownerNames||[]).filter(n=>n!==a.name).concat([a.name]); st.ownerNamesAsked = true; });
    // nothing else changes until the user says so
    const dt = trDetect(); const n = dt.changed.length;
    toast('Nome salvo: transferências em seu nome agora são reconhecidas.', false, n ? { label: 'Aplicar a ' + n + ' lançamento' + (n>1?'s':''), ms: 9000, fn: () => trApplyPending() } : null);
  } else if(a.type==='transfers'){
    closeSheet(); openTransfersSheet();
  } else if(a.type==='mark-transfer'){
    const ids = new Set(a.txIds||[]);
    const ch = live().filter(t=>ids.has(t.id)).map(t=>Object.assign({}, t, { kind:'transfer', categoryId:null, catSource:'manual' }));
    commit({ txs: ch });
    toast(ch.length+' lançamento'+(ch.length===1?'':'s')+' marcado'+(ch.length===1?'':'s')+' como transferência.');
  } else if(a.type==='triage'){
    closeSheet(); startTriage();
  } else if(a.type==='filter-unid'){
    closeSheet(); S.ui.filter = 'unid'; S.ui.txLimit = 200; saveTxPrefs(); setTab('tx');
  }
}
function healthComplete(id){
  const w = warningById(id); if(!w) return;
  updateSettings(st=>{
    const c = Object.assign({ enabled:true, startMonth:null, excluded:[], included:[] }, st.carry||{});
    for(const m of w.months||[]){ c.excluded = (c.excluded||[]).filter(x=>x!==m); if(!(c.included||[]).includes(m)) c.included = (c.included||[]).concat([m]); }
    st.carry = c;
  });
  toast('Mês marcado como completo: volta para o déficit acumulado.');
}
function healthDismiss(id){
  updateSettings(st=>{ st.dismissedWarnings = (st.dismissedWarnings||[]).filter(x=>x!==id).concat([id]).slice(-500); });
  toast('Aviso ignorado.');
}
function openCarrySheet(){
  openSheet('<span class="eyebrow">Painel</span><h2>Déficit acumulado</h2>', '<div id="carry-body"></div>', null, { kind:'carry', label:'Déficit acumulado' });
  renderCarrySheet();
}
function monthExcludedReason(ci, m){
  if(ci.manual.has(m)) return 'você marcou como incompleto';
  if(ci.auto[m] && !ci.included.has(m)) return ci.auto[m][0];
  return '';
}
function renderCarrySheet(){
  const el = $('#carry-body'); if(!el) return;
  const ci = carryInfo();
  if(!ci.enabled){ el.innerHTML = '<p class="muted">O transporte de déficit está desligado em Ajustes.</p><div class="row"><button class="btn sm" type="button" data-act="settings">Abrir Ajustes</button></div>'; return; }
  const rows = ci.rows.slice().reverse();
  el.innerHTML = `<p class="small muted">Quando um mês fecha no vermelho, a diferença passa para o mês seguinte e é paga com a sobra dos próximos meses. Contando desde ${esc(ci.start?fmtYm(ci.start):'—')}.</p>
    <div id="carry-rows">${rows.map(r=>{
      const why = monthExcludedReason(ci, r.month);
      const cov = r.newDeficit>0 ? [r.coverage.card?`cartão ${brl(r.coverage.card)}`:'', r.coverage.investments?`resgates ${brl(r.coverage.investments)}`:'', r.coverage.balance?`saldo/reserva ${brl(r.coverage.balance)}`:''].filter(Boolean).join(', ') : '';
      return `<div class="cm-row ${r.excluded?'excl':''}" data-month="${esc(r.month)}">
        <div class="top"><b>${esc(fmtYm(r.month))}</b><span class="money ${r.carryOut>0?'out':''}" data-cents="${r.carryOut}">${r.carryOut>0?brl(r.carryOut):'zerado'}</span></div>
        <div class="xs muted">Saldo do mês <span class="money ${r.net<0?'out':''}">${brl(r.net)}</span>${r.excluded?' · não entra na conta':''}${!r.excluded&&r.repaid?` · pagou <span class="money">${brl(r.repaid)}</span> do déficit`:''}${!r.excluded&&r.newDeficit?` · novo déficit coberto por ${esc(cov)}`:''}</div>
        <label class="switch sm"><input type="checkbox" data-carryx="${esc(r.month)}" ${r.excluded?'checked':''}>Mês incompleto — não transportar</label>
        ${why?`<span class="xs ${ci.auto[r.month]&&!ci.manual.has(r.month)?'warn-t':'muted'}">${esc(why)}${ci.auto[r.month]&&!ci.manual.has(r.month)?' (Saúde dos dados). Desmarque para incluir mesmo assim.':''}</span>`:''}
      </div>`; }).join('')}</div>
    <div class="row"><button class="btn sm" type="button" data-act="settings" data-focus="carry">Ajustes do déficit</button><button class="btn sm ghost" type="button" data-act="health">Saúde dos dados</button></div>`;
}
function openMonthMenu(){
  openSheet(`<span class="eyebrow">Mês</span><h2>${esc(fmtYm(S.ui.month))}</h2>`, '<div id="month-body"></div>', null, { kind:'month', label:'Opções do mês' });
  renderMonthMenu();
}
function renderMonthMenu(){
  const el = $('#month-body'); if(!el) return;
  const m = S.ui.month; const ci = carryInfo();
  const excl = ci.excluded.has(m);
  const why = monthExcludedReason(ci, m);
  const nW = health().filter(w=>(w.months||[]).includes(m)).length;
  el.innerHTML = `<label class="switch"><input type="checkbox" data-carryx="${esc(m)}" id="month-incomplete" ${excl?'checked':''}>Mês incompleto — não transportar</label>
    <p class="xs muted">${why?esc(why)+'. ':''}Um mês incompleto não entra no déficit acumulado: o que vem de antes passa direto para o mês seguinte.</p>
    <div class="row"><button class="btn sm" type="button" data-act="health" data-month="${esc(m)}">Saúde dos dados deste mês${nW?` · ${nW}`:''}</button><button class="btn sm ghost" type="button" data-act="carry">Déficit mês a mês</button></div>`;
}
function carrySettingsHTML(){
  const ci = carryInfo();
  const ms = ci.months;
  return `<span class="lbl">Déficit entre meses</span>
    <label class="switch"><input type="checkbox" id="carry-enabled" ${ci.enabled?'checked':''}>Transportar déficit entre meses</label>
    <div class="field" ${ci.enabled?'':'hidden'}><label for="carry-start">Começar a contar em</label><select id="carry-start"><option value="">Automático (${esc(ci.autoStart?fmtYm(ci.autoStart):'—')})</option>${ms.map(m=>`<option value="${esc(m)}" ${carrySettings().startMonth===m?'selected':''}>${esc(fmtYm(m))}</option>`).join('')}</select>
    <span class="xs muted">Automático: o primeiro mês sem aviso que bloqueia em Saúde dos dados.</span></div>
    ${ci.enabled&&ms.length?`<div class="carry-months" id="carry-months">${ms.slice().reverse().map(m=>{ const why = monthExcludedReason(ci, m); const on = ci.manual.has(m) || (ci.auto[m] && !ci.included.has(m));
      return `<label class="switch sm"><input type="checkbox" data-carryx="${esc(m)}" ${on?'checked':''}><span>${esc(fmtYm(m))} — incompleto, não transportar${why?` <span class="xs muted">(${esc(why)})</span>`:ci.auto[m]?' <span class="xs muted">(incluído manualmente)</span>':''}</span></label>`; }).join('')}</div>`:''}`;
}

/* ---------- v2.3: update alerts (bell in the header, Painel line, sheet, per-account settings) ---------- */
const AL_KIND = { fatura_fechou: ['Fatura fechou', 'warn'], fatura_vence: ['Vencimento', 'acc'], extrato_desatualizado: ['Extrato', 'warn'], configurar: ['Configurar', 'acc'] };
const FREQ_LBL = [['never', 'Nunca'], ['weekly', 'Toda semana'], ['biweekly', 'A cada 15 dias'], ['monthly', 'Todo mês']];
let _alMemo = { key: null, list: [] };
/** open alerts (dismissed ones left out by the engine); recomputed when the data or the device's date changes */
function alerts() {
  if (S.mode !== 'real' || !S.real) return [];
  const today = todayISO();
  const k = memoKey() + '|' + today;
  if (_alMemo.key === k) return _alMemo.list;
  const d = D();
  const list = eng('updateAlerts', { accounts: d.accounts || [], imports: d.imports || {}, transactions: live(), today, settings: d.settings || {} }) || [];
  _alMemo = { key: k, list };
  return list;
}
function renderAlertsBell() {
  const b = $('#btn-alerts'); if (!b) return;
  S._alDay = todayISO();
  const on = S.booted && S.mode === 'real' && !signedOut();
  b.hidden = !on;
  const list = on ? alerts() : [];
  const n = list.length;
  const badge = $('#alerts-badge');
  if (badge) { badge.textContent = n > 9 ? '9+' : String(n); badge.hidden = !n; }
  b.dataset.count = String(n);
  b.dataset.sev = n ? list[0].severity : '';
  b.setAttribute('aria-label', n ? 'Alertas de atualização: ' + n + ' aberto' + (n > 1 ? 's' : '') : 'Alertas de atualização: nenhum');
}
/** the most urgent alert, one line at the top of the Painel (under the sticky period bar) */
function alertLineHTML() {
  const list = alerts(); if (!list.length) return '';
  const a = list[0];
  return `<div class="al-line sev-${esc(a.severity)}" id="alert-line" data-aid="${esc(a.id)}">
    <button type="button" class="al-line-main" data-act="alerts"><span class="al-dot" aria-hidden="true"></span><span class="al-txt" title="${esc(a.title)}"><span class="al-lead">${esc(a.short || a.title)}</span>${a.short && a.accountId ? `<span class="al-rest">&nbsp;· ${esc(accName(a.accountId))}</span>` : ''}</span>${list.length > 1 ? `<span class="al-more" aria-label="mais ${list.length - 1}">+${list.length - 1}</span>` : ''}</button>
    ${a.action && a.action.type === 'import' ? `<button class="btn sm" type="button" data-act="al-import" data-id="${esc(a.id)}" id="alert-line-import">Importar</button>` : ''}</div>`;
}
function alertById(id) { return alerts().find(a => a.id === id) || null; }
function openAlertsSheet() {
  S.alertUI = { other: null, err: '' };
  openSheet('<span class="eyebrow">Alertas</span><h2>Dados novos para importar</h2>', '<div id="alerts-body"></div>', () => { S.alertUI = null; }, { kind: 'alerts', label: 'Alertas de atualização' });
  renderAlertsSheet();
}
function renderAlertsSheet() {
  const el = $('#alerts-body'); if (!el) return;
  const U = S.alertUI || (S.alertUI = { other: null, err: '' });
  const list = alerts();
  const nDis = (settingsObj().dismissedAlerts || []).length;
  const card = a => {
    const [lbl, cls] = AL_KIND[a.kind] || ['Alerta', 'acc'];
    const other = U.other === a.id && a.cycle;
    const dis = a.kind === 'configurar' ? 'Agora não' : a.kind === 'fatura_fechou' ? 'Já importei / Ignorar este ciclo' : 'Ignorar este ciclo';
    return `<div class="hw al sev-${esc(a.severity)}" data-aid="${esc(a.id)}" data-kind="${esc(a.kind)}">
      <div class="hw-top"><span class="tag ${cls}">${esc(lbl)}</span>${a.accountId ? `<span class="tag">${esc(accName(a.accountId))}</span>` : ''}</div>
      <b class="hw-t">${esc(a.title)}</b><p class="small muted">${esc(a.detail)}</p>
      ${other ? `<div class="newcat" id="al-other-box">${dateField('al-other-date', a.cycle.closeDate, 'Data em que esta fatura fechou')}
        <p class="xs muted">Só para este ciclo (o normal é dia ${esc(String(+a.cycle.nominalClose.slice(8, 10)))}). As compras a partir dessa data ficam para a próxima fatura.</p>
        ${U.err ? `<span class="xs err-msg" id="al-other-err">${esc(U.err)}</span>` : ''}
        <div class="row end"><button class="btn sm" type="button" data-act="al-other-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="al-other-save" data-id="${esc(a.id)}" id="al-other-save">Salvar data</button></div></div>` : ''}
      <div class="row">
        ${a.action && a.action.type === 'import' ? `<button class="btn sm primary" type="button" data-act="al-import" data-id="${esc(a.id)}">Importar agora</button>` : ''}
        ${a.kind === 'configurar' ? `<button class="btn sm primary" type="button" data-act="al-config" data-acc="${esc(a.accountId)}">Configurar conta</button>` : ''}
        ${a.kind === 'fatura_fechou' && !other ? `<button class="btn sm" type="button" data-act="al-other" data-id="${esc(a.id)}">Fechou em outra data</button>` : ''}
        <button class="btn sm ghost" type="button" data-act="al-dismiss" data-id="${esc(a.id)}">${dis}</button>
        ${a.kind !== 'configurar' ? `<button class="btn sm ghost" type="button" data-act="al-config" data-acc="${esc(a.accountId)}">Configurar conta</button>` : ''}
      </div></div>`;
  };
  el.innerHTML = `<p class="small muted">Avisos de quando há extrato ou fatura nova para importar, pelo dia de fechamento de cada cartão e pelo lembrete de cada conta (Ajustes → Contas e importações).</p>
    ${list.length ? `<div class="hw-group" id="alerts-list">${list.map(card).join('')}</div>`
      : `<div class="empty" id="alerts-empty"><b>Nada para importar agora.</b><span class="small">Quando uma fatura fechar ou um extrato ficar desatualizado, aparece aqui.</span></div>`}
    <div class="row"><button class="btn sm" type="button" data-act="accounts">Configurar contas</button>${nDis ? `<button class="btn sm ghost" type="button" data-act="al-undismiss" id="al-undismiss">Mostrar ${nDis} alerta${nDis > 1 ? 's' : ''} ignorado${nDis > 1 ? 's' : ''}</button>` : ''}</div>`;
}
function alertImport(id) {
  const a = alertById(id);
  const accId = a && a.accountId;
  closeSheet();
  if ($('#triage-root').innerHTML) stopTriage();
  S.imp = newImp();
  if (accId && (D().accounts || []).some(x => x.id === accId)) {
    S.imp.accountId = accId; S.imp.fromAlert = accId;
    S.imp.alertNote = a.kind === 'extrato_desatualizado' ? 'Extrato novo de ' + accName(accId) + (a.cycle && a.cycle.last ? ', a partir de ' + isoToBR(a.cycle.last) : '') + '.'
      : a.cycle ? 'Fatura de ' + accName(accId) + (a.cycle.dueDate ? ' com vencimento em ' + isoToBR(a.cycle.dueDate) : '') + ' — compras de ' + isoToDM(a.cycle.start) + ' a ' + isoToDM(a.cycle.end) + '.' : '';
  }
  setTab('import');
}
function alertDismiss(id) {
  updateSettings(st => { st.dismissedAlerts = (st.dismissedAlerts || []).filter(x => x !== id).concat([id]).slice(-300); });
  toast('Alerta ignorado neste ciclo.');
}
function alertOtherSave(id) {
  const a = alertById(id); if (!a || !a.cycle) return;
  const U = S.alertUI || {};
  const iso = readDateField('al-other-date', true);
  if (!iso) { U.err = 'Data inválida. Use dd/mm/aaaa.'; renderAlertsSheet(); return; }
  const dist = Math.abs((Date.parse(iso) - Date.parse(a.cycle.nominalClose)) / 864e5);
  if (dist > 20) { U.err = 'Escolha uma data perto de ' + isoToBR(a.cycle.nominalClose) + ' (até 20 dias antes ou depois).'; renderAlertsSheet(); return; }
  const acc = (D().accounts || []).find(x => x.id === a.accountId); if (!acc) return;
  const ov = Object.assign({}, acc.cycleOverrides || {});
  if (iso === a.cycle.nominalClose) delete ov[a.cycle.ym]; else ov[a.cycle.ym] = iso;
  acc.cycleOverrides = ov; acc.updatedAt = nowISO();
  U.other = null; U.err = '';
  commit({ meta: ['accounts'] });
  toast('Esta fatura de ' + acc.name + ' fechou em ' + isoToBR(iso) + '.');
}
function alertConfig(accId) {
  closeSheet(); openAccountsSheet();
  S.accUI.cfg = accId; renderAccountsSheet();
  const box = $('#acc-al-' + CSS.escape(accId)); if (box) box.scrollIntoView({ block: 'start' });
}
/* --- per-account settings (accounts sheet) --- */
function alDraft(a) {
  const U = S.accUI || (S.accUI = { move: null, del: null });
  U.draft = U.draft || {};
  if (!U.draft[a.id]) {
    const r = a.remind || {};
    U.draft[a.id] = { alerts: a.alerts !== false, closingDay: a.closingDay ? String(a.closingDay) : '', dueDay: a.dueDay ? String(a.dueDay) : '', dueAlert: a.dueAlert !== false,
      freq: ['weekly', 'biweekly', 'monthly', 'never'].includes(r.freq) ? r.freq : 'never', day: r.day ? String(r.day) : '', suggest: null, err: '' };
  }
  return U.draft[a.id];
}
function alSummary(a) {
  if (a.alerts === false) return ['alertas desligados', ''];
  if (a.type === 'credit_card') return a.closingDay ? ['fecha dia ' + a.closingDay + (a.dueDay ? ' · vence dia ' + a.dueDay : ''), 'ok'] : ['sem dia de fechamento', 'warn'];
  const r = a.remind || {};
  if (!r.freq || r.freq === 'never') return ['sem lembrete', ''];
  return [r.freq === 'monthly' ? 'lembrar todo dia ' + (r.day || 1) : r.freq === 'weekly' ? 'lembrar toda semana' : 'lembrar a cada 15 dias', 'ok'];
}
function alSettingsHTML(a) {
  if (a.type === 'payslip') return '';
  const U = S.accUI || {};
  const dr = alDraft(a); const id = esc(a.id);
  const [sum, sc] = alSummary(a);
  const isCard = a.type === 'credit_card';
  const ovs = Object.entries(a.cycleOverrides || {}).filter(([, v]) => v).sort((x, y) => y[0].localeCompare(x[0])).slice(0, 6);
  const sug = dr.suggest;
  return `<details class="acc-al" id="acc-al-${id}" data-accal="${id}" ${U.cfg === a.id || (U.open && U.open[a.id]) ? 'open' : ''}><summary><span>Alertas de atualização</span><span class="tag ${sc}">${esc(sum)}</span></summary>
    <div class="acc-al-body">
      <label class="switch sm"><input type="checkbox" id="al-on-${id}" data-alf="alerts" data-acc="${id}" ${dr.alerts ? 'checked' : ''}>Avisar quando houver dados novos para importar</label>
      ${isCard ? `<div class="form-grid al-days">
          <div class="field"><label for="al-close-${id}">Dia de fechamento</label><input type="number" inputmode="numeric" min="1" max="31" step="1" id="al-close-${id}" data-alf="closingDay" data-acc="${id}" value="${esc(dr.closingDay)}" placeholder="1–31"></div>
          <div class="field"><label for="al-due-${id}">Dia de vencimento</label><input type="number" inputmode="numeric" min="1" max="31" step="1" id="al-due-${id}" data-alf="dueDay" data-acc="${id}" value="${esc(dr.dueDay)}" placeholder="1–31"></div></div>
        <p class="xs muted">Num mês sem esse dia (31 em fevereiro, por exemplo), vale o último dia do mês. Se o banco fechar em outra data num mês, ajuste pelo próprio alerta ("Fechou em outra data").</p>
        <label class="switch sm"><input type="checkbox" id="al-duealert-${id}" data-alf="dueAlert" data-acc="${id}" ${dr.dueAlert ? 'checked' : ''}>Lembrar 3 dias antes do vencimento se o pagamento ainda não apareceu no extrato</label>
        ${sug ? (sug.closingDay || sug.dueDay ? `<div class="banner al-sug" id="al-sug-${id}"><div class="grow"><b>Sugestão pelos seus dados:</b> ${[sug.closingDay ? 'fechamento dia ' + sug.closingDay : '', sug.dueDay ? 'vencimento dia ' + sug.dueDay : ''].filter(Boolean).join(', ')}. Os campos acima foram preenchidos: confira e toque em <b>Salvar</b>.<ul class="xs">${sug.basis.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div></div>`
          : `<div class="banner al-sug" id="al-sug-${id}"><div class="grow">Não deu para sugerir: importe pelo menos uma fatura deste cartão (ou preencha os dias da sua fatura).</div></div>`) : ''}
        ${ovs.length ? `<div class="al-ovs"><span class="xs muted">Fechamentos em outra data:</span>${ovs.map(([ym, d]) => `<span class="tag">${esc(isoToBR(d))} <button type="button" class="al-x" data-act="al-ov-del" data-acc="${id}" data-ym="${esc(ym)}" aria-label="Voltar ao dia normal no ciclo de ${esc(fmtYm(ym))}">×</button></span>`).join('')}</div>` : ''}`
      : `<div class="form-grid al-days rem">
          <div class="field"><label for="al-freq-${id}">Lembrar de atualizar</label><select id="al-freq-${id}" data-alf="freq" data-acc="${id}">${FREQ_LBL.map(([k, v]) => `<option value="${k}" ${dr.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field" ${dr.freq === 'monthly' ? '' : 'hidden'} id="al-dayf-${id}"><label for="al-day-${id}">Dia do mês</label><input type="number" inputmode="numeric" min="1" max="31" step="1" id="al-day-${id}" data-alf="day" data-acc="${id}" value="${esc(dr.day)}" placeholder="1–31"></div></div>
        <p class="xs muted">O alerta aparece quando o último extrato importado ficar mais velho que isso.</p>`}
      <span class="xs err-msg" id="al-err-${id}" ${dr.err ? '' : 'hidden'}>${esc(dr.err)}</span>
      <div class="row">${isCard ? `<button class="btn sm" type="button" data-act="al-suggest" data-acc="${id}" id="al-suggest-${id}">Sugerir pelos dados</button>` : ''}<span class="grow"></span><button class="btn sm primary" type="button" data-act="al-save" data-acc="${id}" id="al-save-${id}">Salvar</button></div>
    </div></details>`;
}
function alSuggest(accId) {
  const a = (D().accounts || []).find(x => x.id === accId); if (!a) return;
  const dr = alDraft(a);
  const r = eng('inferCardDays', { accountId: accId, accounts: D().accounts || [], transactions: live(), imports: D().imports || {} }) || { closingDay: null, dueDay: null, basis: [] };
  dr.suggest = r; dr.err = '';
  if (r.closingDay) dr.closingDay = String(r.closingDay);
  if (r.dueDay) dr.dueDay = String(r.dueDay);
  S.accUI.cfg = accId;
  renderAccountsSheet();
}
function alSave(accId) {
  const a = (D().accounts || []).find(x => x.id === accId); if (!a) return;
  const dr = alDraft(a);
  const day = v => { const s = String(v == null ? '' : v).trim(); if (!s) return ''; const n = Number(s); return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null; };
  const fail = m => { dr.err = m; S.accUI.cfg = accId; renderAccountsSheet(); };
  if (a.type === 'credit_card') {
    const cd = day(dr.closingDay), dd = day(dr.dueDay);
    if (cd === null || dd === null) return fail('Use um dia entre 1 e 31.');
    if (dd && !cd) return fail('Informe também o dia de fechamento.');
    if (cd) a.closingDay = cd; else delete a.closingDay;
    if (dd) a.dueDay = dd; else delete a.dueDay;
    if (dr.dueAlert) delete a.dueAlert; else a.dueAlert = false;
  } else {
    const d = day(dr.day);
    if (dr.freq === 'monthly' && !d) return fail('Escolha o dia do mês (1 a 31).');
    a.remind = dr.freq === 'monthly' ? { freq: 'monthly', day: d } : { freq: dr.freq };
  }
  a.alerts = !!dr.alerts;
  a.updatedAt = nowISO();
  delete S.accUI.draft[accId];
  S.accUI.cfg = accId;
  commit({ meta: ['accounts'] });
  toast('Alertas de ' + a.name + ' salvos.');
}
function alInput(t) {
  const a = (D().accounts || []).find(x => x.id === t.dataset.acc); if (!a) return;
  const dr = alDraft(a);
  const f = t.dataset.alf;
  dr[f] = t.type === 'checkbox' ? t.checked : t.value;
  dr.err = '';
  if (f === 'freq') { const box = $('#al-dayf-' + CSS.escape(a.id)); if (box) box.hidden = t.value !== 'monthly'; }
}

/* ---------- budget ---------- */
/* ---------- v2.5: transfers between your own accounts ("Transferências"), "Quem é você nos extratos?" ---------- */
const ownerNames = () => (settingsObj().ownerNames || []).filter(Boolean);
_memo.tr = { key: null, v: null }; _memo.who = { key: null, v: null };
function trKey() { const st = settingsObj(); return memoKey() + '|' + JSON.stringify([st.ownerNames || [], (st.transferRejected || []).length, st.ownerNamesDismissed || []]); }
/** detectTransfers on the current data (suggestions + the high-confidence changes not applied yet), memoized */
function trDetect() {
  const k = trKey();
  if (_memo.tr.key === k) return _memo.tr.v;
  const d = D();
  const v = eng('detectTransfers', live(), { accounts: d.accounts || [], settings: d.settings || {} }) || { suggestions: [], changes: [], changed: [], counts: {} };
  _memo.tr = { key: k, v };
  return v;
}
function whoCandidates() {
  const k = trKey();
  if (_memo.who.key === k) return _memo.who.v;
  const d = D();
  const v = eng('ownerNameCandidates', live(), { accounts: d.accounts || [], imports: d.imports || {}, settings: d.settings || {} }) || [];
  _memo.who = { key: k, v };
  return v;
}
function trOverview(p) {
  p = p || period();
  return eng('transferOverview', live(), { accounts: D().accounts || [], ownerNames: ownerNames(), from: p.from, to: p.to }) || { total: 0, pairs: [], external: [], conversions: [], flows: [], unmatched: [] };
}
/** show the first-run card: real data, no names yet, not dismissed, something to propose */
function whoCardVisible() { return S.mode === 'real' && !ownerNames().length && !settingsObj().ownerNamesAsked && whoCandidates().length > 0; }
function whoCardHTML(where) {
  const cands = whoCandidates();
  const U = S.trUI || {};
  const sel = U.who || null;
  return `<div class="who-card card" id="who-${where}" data-who-where="${where}">
    <div><span class="eyebrow">Transferências</span><h2 style="margin:2px 0 4px">Quem é você nos extratos?</h2>
    <p class="small muted">Marque os nomes que são <b>você</b> (outra conta sua). Pix e transferências em seu nome deixam de contar como entrada ou gasto. Nada muda antes de você confirmar.</p></div>
    <div class="who-list">${cands.map(c => { const on = sel ? sel.includes(c.key) : c.suggested; return `<label class="who-opt"><input type="checkbox" data-who="${esc(c.key)}" ${on ? 'checked' : ''}><span class="grow"><b>${esc(c.name)}</b>${c.variants.length > 1 ? `<span class="xs muted"> · também ${esc(c.variants.slice(1).join(', '))}</span>` : ''}<br><span class="xs muted">${c.count} Pix/TED${c.in && c.out ? ' de e para' : c.in ? ' recebidos' : ' enviados'} · ${c.accounts} conta${c.accounts === 1 ? '' : 's'}${c.holder ? ' · nome no extrato em PDF' : ''}</span></span></label>`; }).join('')}</div>
    <div class="row"><button class="btn sm primary" type="button" data-act="who-confirm" data-where="${where}" id="who-confirm-${where}">Confirmar</button><button class="btn sm ghost" type="button" data-act="who-later" id="who-later-${where}">Agora não</button></div></div>`;
}
function whoSelected(where) {
  const root = $('#who-' + where); if (!root) return [];
  return $$('[data-who]', root).filter(i => i.checked).map(i => i.dataset.who);
}
/** saves names (synced settings), then applies the high-confidence changes they bring; asks before touching rows the
 *  user set by hand ("Aplicar a N lançamentos?") */
function applyOwnerNames(names, opts) {
  opts = opts || {};
  const before = ownerNames();
  const all = [...new Set(before.concat(names.map(n => String(n).trim()).filter(Boolean)))];
  const st = settingsObj();
  st.ownerNames = all; st.ownerNamesAsked = true; st.updatedAt = nowISO();
  P.meta.add('settings');
  const d = D();
  const dt = eng('detectTransfers', live(), { accounts: d.accounts || [], settings: st }) || { changed: [], changes: [] };
  const prev = (dt.changes || []).map(c => Object.assign({}, txById(c.id)));
  if (dt.changed && dt.changed.length) commit({ txs: dt.changed, meta: ['settings'] }); else commit({ meta: ['settings'] });
  // rows you set by hand with your own name that are not transfers: ask
  const manual = live().filter(t => t.catSource === 'manual' && t.kind !== 'transfer' && t.kind !== 'card_payment' && (() => { const c = E.counterparty(t); return c && c.name && !c.company && E.isOwnName(c.name, all); })());
  S.trUI = Object.assign(S.trUI || {}, { askManual: manual.map(t => t.id), who: null });
  const n = (dt.changed || []).length;
  toast(n ? n + ' lançamento' + (n > 1 ? 's' : '') + ' em seu nome agora ' + (n > 1 ? 'são transferências' : 'é transferência') + '.' : 'Nome salvo.', false, n ? { label: 'Desfazer', fn: () => {
    commit({ txs: prev.map(x => clone(x)) });
    updateSettings(s2 => { s2.ownerNames = before; s2.transferRejected = [...new Set((s2.transferRejected || []).concat(prev.map(x => 'o:' + x.id)))].slice(-3000); });
    toast('Desfeito');
  } } : null);
  refreshOpenSheet(); if (S.ui.tab === 'painel' && !S.sheet) renderPainel();
}
function applyManualOwn() {
  const ids = new Set((S.trUI && S.trUI.askManual) || []);
  const rows = live().filter(t => ids.has(t.id));
  const prev = rows.map(t => clone(t));
  commit({ txs: rows.map(t => Object.assign({}, t, { kind: 'transfer', categoryId: null, catSource: 'manual', transferAccountId: t.transferAccountId || 'external', transferSource: 'user' })) });
  S.trUI.askManual = [];
  toast(rows.length + ' lançamento' + (rows.length > 1 ? 's' : '') + ' marcado' + (rows.length > 1 ? 's' : '') + ' como transferência.', false, { label: 'Desfazer', fn: () => { commit({ txs: prev }); toast('Desfeito'); } });
  refreshOpenSheet();
}
/** "Por conta/cartão": money moved between your accounts, listed under the flow (thin links would clutter it) */
function skFlowsHTML() {
  if (S.mode !== 'real' && !live().some(t => t.kind === 'transfer')) return '';
  const ov = trOverview();
  if (!ov.flows.length && !ov.external.length) return '';
  const ext = ov.external.filter(g => g.out > 0);
  return `<div class="sk-flows" id="sk-flows"><span class="lbl">Entre suas contas <span class="xs muted">(não entra no fluxo)</span></span>${ov.flows.map(f => `<div class="tr-flow"><span class="grow">${esc(accName(f.from))} → ${esc(accName(f.to))}</span><span class="money">${brl(f.amount)}</span></div>`).join('')}${ext.map(g => `<div class="tr-flow"><span class="grow">→ ${esc(g.label)}${g.accountId ? '' : ' <span class="xs muted">(fora do app)</span>'}</span><span class="money">${brl(g.out)}</span></div>`).join('')}</div>`;
}
function trPainelHTML() {
  if (S.mode !== 'real') return '';
  const ov = trOverview();
  const sug = trDetect().suggestions.length + (trDetect().changed.length ? 1 : 0);
  if (!ov.total && !sug && !ov.conversions.length) return '';
  return `<button type="button" class="pn-fx pn-tr" id="pn-tr" data-act="transfers"><span>Entre suas contas: <b class="money" id="pn-tr-total" data-cents="${ov.total}">${brl(ov.total)}</b>${sug ? ` <span class="tag acc" id="pn-tr-sug">${sug} para revisar</span>` : ''}</span><span class="xs faint">fora de entradas e gastos</span></button>`;
}
function openTransfersSheet() {
  S.trUI = Object.assign({ who: null, askManual: [], addName: '' }, S.trUI || {});
  openSheet(`<span class="eyebrow">${esc(periodLabel())}</span><h2>Transferências</h2>`, '<div id="tr-body"></div>', null, { kind: 'transfers', label: 'Transferências' });
  renderTransfersSheet();
}
const trRow = (t, extra) => `<div class="tr-row" data-tx="${esc(t.id)}"><span class="grow"><span class="small"><b>${esc(accName(t.accountId))}</b> · ${esc(isoToDM(t.date))}</span><br><span class="xs muted tr-desc">${esc(t.rawDescription)}</span></span><span class="money ${t.amount > 0 ? 'in' : ''}">${t.amount > 0 ? '+' : ''}${brl(t.amount)}</span>${extra || ''}</div>`;
function renderTransfersSheet() {
  const el = $('#tr-body'); if (!el) return;
  const U = S.trUI || {};
  const st = settingsObj();
  const ov = trOverview();
  const dt = trDetect();
  const names = ownerNames();
  const rv = st.transferReview;
  const accLbl = id => id === 'external' ? 'Conta não cadastrada' : accName(id);
  const flows = ov.flows.length ? `<div class="tr-flows">${ov.flows.map(f => `<div class="tr-flow"><span class="grow">${esc(accName(f.from))} → ${esc(accName(f.to))}${f.count > 1 ? ` <span class="xs muted">(${f.count})</span>` : ''}</span><span class="money">${brl(f.amount)}</span></div>`).join('')}</div>` : '';
  const sugHTML = dt.suggestions.map(sg => {
    const rows = sg.ids.map(id => txById(id)).filter(Boolean);
    return `<div class="hw sev-info tr-sug" data-key="${esc(sg.key)}"><b class="hw-t">${sg.type === 'pair' ? esc(accName(sg.from)) + ' → ' + esc(accName(sg.to)) + ' · ' + brl(sg.amount) : 'Para sua conta ' + esc(accName(sg.accountId)) + '?'}</b>
      <p class="xs muted">${esc(sg.reason)}</p>${rows.map(t => trRow(t)).join('')}
      <div class="row"><button class="btn sm primary" type="button" data-act="tr-confirm" data-key="${esc(sg.key)}">Confirmar</button><button class="btn sm ghost" type="button" data-act="tr-reject" data-key="${esc(sg.key)}">Não é transferência</button></div></div>`;
  }).join('');
  const pend = dt.changed.length;
  const rvCounts = rv && rv.rows ? Object.entries(rv.rows).filter(([, n]) => n > 0) : [];
  el.innerHTML = `
    <div class="tr-total-box" id="tr-sum"><span class="small">Entre suas contas ${S.ui.range === 1 ? 'este mês' : 'no período'}:</span> <b class="money" id="tr-total" data-cents="${ov.total}">${brl(ov.total)}</b>
      <p class="xs muted">Dinheiro que só mudou de lugar: de uma conta sua para outra (também as que não estão no app). Não conta como entrada nem como gasto — conversões de moeda e pagamentos de fatura também ficam de fora.</p>${flows}</div>
    ${!names.length && whoCandidates().length ? whoCardHTML('sheet') : ''}
    <div class="field" id="tr-names"><span class="lbl">Seus nomes nos extratos</span>
      ${names.length ? `<div class="row">${names.map(n => `<span class="tag acc tr-name">${esc(n)}<button type="button" class="x" data-act="tr-name-del" data-name="${esc(n)}" aria-label="Remover ${esc(n)}">×</button></span>`).join('')}</div>` : '<p class="xs muted">Nenhum ainda. Com o seu nome, Pix em seu nome viram transferência sozinhos.</p>'}
      <div class="row"><input type="text" id="tr-name-new" placeholder="Seu nome como aparece no extrato" value="${esc(U.addName || '')}" style="flex:1 1 200px;min-width:0"><button class="btn sm" type="button" data-act="tr-name-add" id="tr-name-add">Adicionar</button></div></div>
    ${(U.askManual || []).length ? `<div class="banner" id="tr-ask-manual"><div class="grow"><b>Aplicar a ${U.askManual.length} lançamento${U.askManual.length > 1 ? 's' : ''}?</b> Você classificou ${U.askManual.length > 1 ? 'estes' : 'este'} à mão, mas ${U.askManual.length > 1 ? 'são' : 'é'} em seu nome. Virar transferência?</div><button class="btn sm primary" type="button" data-act="tr-apply-manual" id="tr-apply-manual">Aplicar</button><button class="btn sm ghost" type="button" data-act="tr-skip-manual">Não</button></div>` : ''}
    ${pend ? `<div class="banner" id="tr-pending"><div class="grow"><b>${pend} ajuste${pend > 1 ? 's' : ''} automático${pend > 1 ? 's' : ''} encontrado${pend > 1 ? 's' : ''}</b> (${esc(Object.entries(dt.changes.reduce((o, c) => (o[c.reason] = (o[c.reason] || 0) + 1, o), {})).map(([r, n]) => n + ' ' + (TR_REASON_LBL[r] || r)).join(', '))}).</div><button class="btn sm primary" type="button" data-act="tr-apply-pending" id="tr-apply-pending">Aplicar</button></div>` : ''}
    ${dt.suggestions.length ? `<h3>Para confirmar (${dt.suggestions.length})</h3><div class="tr-list" id="tr-sugs">${sugHTML}</div>` : ''}
    <h3>Entre suas contas</h3>
    ${ov.pairs.length ? `<div class="tr-list" id="tr-pairs">${ov.pairs.map(p => `<div class="tr-pair" data-out="${esc(p.out.id)}"><div class="row" style="justify-content:space-between"><b class="small">${esc(accName(p.from))} → ${esc(accName(p.to))}</b><span class="money">${brl(p.amount)}</span></div><span class="xs muted">${esc(isoToDM(p.out.date))}${p.in.date !== p.out.date ? ' → ' + esc(isoToDM(p.in.date)) : ''}${p.in.amount !== p.amount ? ' · chegou ' + esc(brl(p.in.amount)) : ''}</span></div>`).join('')}</div>` : `<p class="small muted" id="tr-pairs-empty">Nenhum par neste período.</p>`}
    ${ov.external.length ? `<h3>Para contas fora do app</h3><div class="tr-list" id="tr-ext">${ov.external.map(g => `<details class="tr-ext" data-key="${esc(g.key)}"><summary><span class="grow"><b>${esc(g.label)}</b>${g.accountId ? '' : ' <span class="xs muted">· conta não cadastrada</span>'}<br><span class="xs muted">${g.rows.length} lançamento${g.rows.length > 1 ? 's' : ''}${g.out ? ' · saiu ' + esc(brl(g.out)) : ''}${g.in ? ' · entrou ' + esc(brl(g.in)) : ''}</span></span></summary>${g.rows.map(t => trRow(t)).join('')}${g.accountId ? '' : `<div class="row"><button class="btn sm" type="button" data-act="goto" data-tab="import">Importar essa conta</button></div>`}</details>`).join('')}</div>` : ''}
    ${ov.conversions.length ? `<h3>Conversões de moeda</h3><div class="tr-list" id="tr-conv">${ov.conversions.map(t => trRow(t)).join('')}</div>` : ''}
    ${rv && rvCounts.length ? `<div class="hw sev-info" id="tr-review"><b class="hw-t">Revisão de transferências${rv.undone ? ' (desfeita)' : ''}</b><p class="xs muted">Em ${esc(isoToBR(String(rv.at || '').slice(0, 10)))}, ao atualizar o app: ${esc(rvCounts.map(([r, n]) => n + ' ' + (TR_REASON_LBL[r] || r)).join(', '))}.</p>${rv.undone ? '' : '<div class="row"><button class="btn sm" type="button" data-act="tr-review-undo" id="tr-review-undo">Desfazer revisão</button></div>'}</div>` : ''}`;
}
function trConfirm(key) {
  const sg = trDetect().suggestions.find(x => x.key === key); if (!sg) return;
  const rows = sg.ids.map(id => txById(id)).filter(Boolean);
  const prev = rows.map(t => clone(t));
  let upd;
  if (sg.type === 'pair' && rows.length === 2) {
    const [a, b] = rows;
    upd = [Object.assign({}, a, { kind: 'transfer', categoryId: null, catSource: 'manual', transferSource: 'user', linkedTo: b.id, transferAccountId: b.accountId }),
      Object.assign({}, b, { kind: 'transfer', categoryId: null, catSource: 'manual', transferSource: 'user', linkedTo: a.id, transferAccountId: a.accountId })];
  } else upd = rows.map(t => Object.assign({}, t, { kind: 'transfer', categoryId: null, catSource: 'manual', transferSource: 'user', transferAccountId: sg.accountId || 'external' }));
  commit({ txs: upd });
  toast('Transferência confirmada.', false, { label: 'Desfazer', fn: () => { commit({ txs: prev }); toast('Desfeito'); } });
}
function trReject(key) {
  updateSettings(st => { st.transferRejected = [...new Set((st.transferRejected || []).concat([key]))].slice(-3000); });
  toast('Ok, não é transferência.', false, { label: 'Desfazer', fn: () => { updateSettings(st => { st.transferRejected = (st.transferRejected || []).filter(k => k !== key); }); toast('Desfeito'); } });
}
function trApplyPending() {
  const dt = trDetect();
  const prev = dt.changes.map(c => clone(txById(c.id))).filter(Boolean);
  commit({ txs: dt.changed });
  toast(dt.changed.length + ' ajuste' + (dt.changed.length > 1 ? 's' : '') + ' aplicado' + (dt.changed.length > 1 ? 's' : '') + '.', false, { label: 'Desfazer', fn: () => {
    commit({ txs: prev });
    updateSettings(st => { st.transferRejected = [...new Set((st.transferRejected || []).concat(prev.map(t => 'o:' + t.id)))].slice(-3000); });
    toast('Desfeito');
  } });
}
/** "Desfazer revisão": the kinds/links from before the v2.5 review come back (rows you edited since are left alone) */
function trReviewUndo() {
  const rv = settingsObj().transferReview; if (!rv || rv.undone) return;
  const at = String(rv.at || '');
  const changes = (rv.changes || []).filter(c => { const t = txById(c.id); return t && !(t.catSource === 'manual' && String(t.updatedAt || '') > at); });
  const rows = eng('undoTransferChanges', live(), changes) || [];
  commit({ txs: rows, render: false });
  updateSettings(st => {
    st.transferReview = Object.assign({}, st.transferReview, { undone: nowISO() });
    st.transferRejected = [...new Set((st.transferRejected || []).concat(changes.map(c => 'o:' + c.id)))].slice(-3000);
  });
  toast('Revisão desfeita: ' + rows.length + ' lançamento' + (rows.length === 1 ? '' : 's') + ' como antes.');
}

/* --- editor: "Transferência entre minhas contas" (other account + optional counterpart row) and "Pagamento de fatura" --- */
/** rows that could be the other side of t: another account, opposite sign, amount within 5 % (or R$ 5), ±7 days */
function transferCandidates(t, accId) {
  const a = Math.abs(t.amount);
  return live().filter(o => o.id !== t.id && o.accountId !== t.accountId && (!accId || accId === 'external' ? true : o.accountId === accId) && Math.sign(o.amount) === -Math.sign(t.amount) &&
    o.kind !== 'card_payment' && Math.abs(Math.abs(o.amount) - a) <= Math.max(500, a * 0.05) && Math.abs((new Date(o.date) - new Date(t.date)) / 864e5) <= 7 && (!o.linkedTo || o.linkedTo === t.id))
    .sort((x, y) => Math.abs(Math.abs(x.amount) - a) - Math.abs(Math.abs(y.amount) - a) || Math.abs(new Date(x.date) - new Date(t.date)) - Math.abs(new Date(y.date) - new Date(t.date))).slice(0, 6);
}
function edPairHTML(t, accId, sel) {
  if (accId === 'external') return '<p class="xs muted">Uma conta sua que não está no app. Fica fora de entradas e gastos.</p>';
  const c = transferCandidates(t, accId || null);
  if (!c.length) return '<p class="xs muted" id="ed-tr-none">Nenhum lançamento parecido nas outras contas (±7 dias). Tudo bem: fica como transferência mesmo assim.</p>';
  const cur = sel === undefined ? (t.linkedTo && c.some(o => o.id === t.linkedTo) ? t.linkedTo : '') : sel;
  return `<span class="lbl">Qual é o outro lado? <span class="xs muted">(opcional)</span></span><div class="tr-cands">${c.map(o => `<label class="who-opt"><input type="radio" name="ed-tr-pair" value="${esc(o.id)}" ${cur === o.id ? 'checked' : ''}><span class="grow small">${esc(accName(o.accountId))} · ${esc(isoToDM(o.date))}<br><span class="xs muted tr-desc">${esc(o.rawDescription)}</span></span><span class="money ${o.amount > 0 ? 'in' : ''}">${brl(o.amount)}</span></label>`).join('')}<label class="who-opt"><input type="radio" name="ed-tr-pair" value="" ${!cur ? 'checked' : ''}><span class="small">Nenhum destes</span></label></div>`;
}
function edTransferHTML(t) {
  const accs = (D().accounts || []).filter(a => a.id !== t.accountId && a.type !== 'payslip' && a.type !== 'credit_card');
  const linked = t.linkedTo && txById(t.linkedTo);
  const cur = t.transferAccountId || (linked ? linked.accountId : '') || '';
  const cand0 = !cur ? transferCandidates(t)[0] : null;
  const pre = cur || (cand0 ? cand0.accountId : '');
  const c = E.counterparty ? E.counterparty(t) : null;
  const cards = (D().accounts || []).filter(a => a.type === 'credit_card' && a.id !== t.accountId);
  return `<div class="field ed-sub" id="ed-tr" ${t.kind === 'transfer' ? '' : 'hidden'}><label for="ed-tr-acc">${t.amount < 0 ? 'Para qual conta sua?' : 'De qual conta sua?'}</label>
      <select id="ed-tr-acc"><option value="" ${!pre ? 'selected' : ''}>Escolha…</option>${accs.map(a => `<option value="${esc(a.id)}" ${pre === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="external" ${pre === 'external' ? 'selected' : ''}>Conta não cadastrada</option></select>
      <div id="ed-tr-pairs">${pre ? edPairHTML(t, pre) : ''}</div>
      ${c && c.name && !c.company ? `<label class="remember small" for="ed-tr-remember"><input type="checkbox" id="ed-tr-remember"><span>Lembrar: lançamentos com <b>${esc(E.titleName ? E.titleName(c.name) : c.name)}</b> são transferências minhas</span></label>` : ''}</div>
    <div class="field ed-sub" id="ed-cp" ${t.kind === 'card_payment' ? '' : 'hidden'}><label for="ed-card">Qual cartão?</label><select id="ed-card"><option value="">Não sei / outro</option>${cards.map(a => `<option value="${esc(a.id)}" ${(t.cardAccountId || (linked && linked.accountId)) === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>`;
}
/** marks t as a transfer between your accounts; links the chosen counterpart (and unlinks an old one). -> previous rows */
function setTransfer(t, accId, pairId, remember) {
  const before = [clone(t)];
  const upd = Object.assign({}, t, { kind: 'transfer', categoryId: null, catSource: 'manual', transferSource: 'user', transferAccountId: accId || 'external' });
  delete upd.transferSubtype;
  const changed = [upd];
  const old = t.linkedTo && t.linkedTo !== pairId ? txById(t.linkedTo) : null;
  if (old && old.linkedTo === t.id) { before.push(clone(old)); const o2 = Object.assign({}, old); delete o2.linkedTo; if (o2.transferAccountId === t.accountId) delete o2.transferAccountId; changed.push(o2); }
  if (pairId) {
    const o = txById(pairId);
    if (o) { before.push(clone(o)); upd.linkedTo = o.id; upd.transferAccountId = o.accountId; changed.push(Object.assign({}, o, { kind: 'transfer', categoryId: null, catSource: 'manual', transferSource: 'user', linkedTo: t.id, transferAccountId: t.accountId })); }
  } else if (t.linkedTo && old) delete upd.linkedTo;
  const d = D(); let rulesPrev = null, n = 0;
  if (remember) {
    const r = eng('learnTransferRule', t, d.rules, { now: nowISO(), transferAccountId: accId && accId !== 'external' ? accId : undefined });
    if (r && r.created) {
      rulesPrev = clone(d.rules || []); d.rules = r.rules;
      // the same counterparty's other rows that are not manual follow the rule
      const val = r.created.match.value;
      for (const o of live()) {
        if (o.id === t.id || changed.some(x => x.id === o.id) || o.catSource === 'manual' || o.kind === 'transfer' || o.kind === 'card_payment') continue;
        if (normU(o.rawDescription).indexOf(val) < 0) continue;
        before.push(clone(o)); n++;
        changed.push(Object.assign({}, o, { kind: 'transfer', categoryId: null, catSource: 'learned', transferAccountId: o.accountId === accId ? 'external' : (accId || 'external') }));
      }
    }
  }
  commit({ txs: changed, meta: rulesPrev ? ['rules'] : [] });
  return { txs: before, rules: rulesPrev, n };
}
function undoRecord(res) {
  return () => { const d = D(); const meta = []; if (res.rules) { d.rules = res.rules; meta.push('rules'); } commit({ txs: (res.txs || []).map(x => clone(x)), meta }); toast('Desfeito'); };
}
function renderBudget(sum){
  const el = $('#budget-card'); const budgets = D().settings.budgets || {};
  const groups = (D().categories||[]).filter(g=>g.kind!=='income');
  const byGroup = sum.byGroup || {};
  const rows = groups.map(g=>({ g, actual: Math.abs(byGroup[g.id]||0), budget: (budgets[g.id]||0)*S.ui.range })).filter(r=>r.actual>0||r.budget>0).sort((a,b)=>(b.budget>0)-(a.budget>0) || b.actual-a.actual);
  const hasBudget = rows.some(r=>r.budget>0);
  const mx = Math.max(1, ...rows.map(r=>Math.max(r.actual, r.budget)));
  el.innerHTML = `<div class="card-h"><h2>Orçamento × realizado</h2><button class="btn ghost sm" type="button" data-act="goto" data-tab="cats">Ajustar</button></div>
    ${!hasBudget?'<p class="small muted">Defina um limite mensal por grupo em Categorias para acompanhar aqui.</p>':''}
    ${rows.length ? `<div class="bud">${rows.map(r=>{
      const over = r.budget>0 && r.actual>r.budget; const ref = r.budget>0 ? r.budget : mx;
      const pct = Math.min(100, r.actual/ref*100);
      return `<div class="bud-row"><div class="bud-top"><span class="nm"><span class="dot" style="width:9px;height:9px;border-radius:3px;background:${esc(r.g.color)};flex:none"></span><span>${esc(r.g.name)}</span></span>
      <span class="money ${over?'out':''}" style="white-space:nowrap">${brl(r.actual)}${r.budget>0?` <span class="faint">/ ${brlShort(r.budget)}</span>`:''}</span></div>
      <div class="bud-bar ${over?'over':''}"><i style="width:${pct.toFixed(1)}%;background:${over?'var(--out)':esc(r.g.color)}"></i></div>
      ${over?`<span class="xs out">${brl(r.actual-r.budget)} acima do limite</span>`:''}</div>`; }).join('')}</div>` : '<p class="muted small">Nenhum gasto no período.</p>'}`;
}

/* ---------- 6-month series ---------- */
function niceMax(v){ if(v<=0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v/p; return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p; }
function drawSeries(){
  const el = $('#series-chart'); if(!el) return;
  const ser = eng('monthlySeries', live(), 6, S.ui.month) || [];
  if(!ser.length){ el.innerHTML = '<p class="muted small">Sem dados.</p>'; return; }
  const W = Math.max(300, el.clientWidth||330), H = 190, L = 58, B = 24, T = 10, R = 4;
  const vals = ser.flatMap(s=>[Math.abs(s.income||0), Math.abs(s.expense||0)]);
  const ymax = niceMax(Math.max(...vals)); const ticks = [0, ymax/2, ymax];
  const y = v => T + (H-T-B) * (1 - v/ymax);
  const bw = (W-L-R)/ser.length; const barW = Math.min(18, bw*0.32);
  let svg = ticks.map(t=>`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${L-6}" y="${y(t)+3.5}" text-anchor="end">${esc(brlShort(t))}</text>`).join('');
  ser.forEach((s,i)=>{
    const cx = L + bw*i + bw/2; const inc = Math.abs(s.income||0), exp = Math.abs(s.expense||0);
    const cur = s.month===S.ui.month;
    svg += `<rect x="${cx-barW-1}" y="${y(inc)}" width="${barW}" height="${Math.max(0,y(0)-y(inc))}" rx="3" fill="var(--in)" opacity="${cur?1:.75}"><title>${esc(s.month)} entradas ${esc(brl(inc))}</title></rect>`;
    svg += `<rect x="${cx+1}" y="${y(exp)}" width="${barW}" height="${Math.max(0,y(0)-y(exp))}" rx="3" fill="var(--out)" opacity="${cur?1:.75}"><title>${esc(s.month)} saídas ${esc(brl(exp))}</title></rect>`;
    const m = Number(String(s.month).slice(5,7));
    svg += `<text x="${cx}" y="${H-7}" text-anchor="middle" style="${cur?'fill:var(--ink);font-weight:700':''}">${MES3[m-1]||esc(s.month)}</text>`;
  });
  el.innerHTML = `<svg class="chart-svg" width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas dos últimos 6 meses">${svg}</svg>`;
}

/* ---------- future installments ---------- */
function renderFuture(){
  const el = $('#future-card');
  const fut = (eng('futureInstallments', live()) || []).filter(f=>f && (f.total||0)!==0).slice(0,6);
  const grand = fut.reduce((s,f)=>s+Math.abs(f.total||0),0);
  el.innerHTML = `<div class="card-h"><h2>Parcelas futuras</h2>${fut.length?`<span class="money muted small">${brl(grand)} comprometidos</span>`:''}</div>
  ${fut.length ? `<div>${fut.map(f=>{
    const [yy,mm] = String(f.month).split('-').map(Number);
    const items = (f.items||[]);
    return `<details class="inst-month" style="display:block"><summary style="justify-content:space-between;color:var(--ink)"><span class="grow">${MES[mm-1]||f.month} ${yy||''} <span class="faint xs">· ${items.length} parcela${items.length===1?'':'s'}</span></span><span class="money" style="font-weight:650">${brl(Math.abs(f.total))}</span></summary>
      <div style="padding:8px 0 0 14px;display:flex;flex-direction:column;gap:6px">${items.map(it=>{
        const nm = it.merchant || it.name || it.rawDescription || 'Parcela';
        const inst = it.installment || (it.n!=null ? {n:it.n,total:it.total} : null);
        const amt = it.amount!=null ? it.amount : it.value;
        return `<div class="row small" style="justify-content:space-between;flex-wrap:nowrap"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nm)} ${inst&&inst.n?`<span class="tag">${inst.n}/${inst.total}</span>`:''}${it.originalDate?` <span class="xs faint">compra em ${esc(isoToDM(it.originalDate))}</span>`:''}</span><span class="money">${amt!=null?brl(Math.abs(amt)):''}</span></div>`; }).join('')}</div></details>`; }).join('')}</div><p class="xs faint">Projeção das parcelas que ainda vão chegar. Não entra nos totais: quando a fatura com a parcela real for importada, ela aparece no mês dela.</p>`
  : '<p class="muted small">Nenhuma compra parcelada em aberto.</p>'}`;
}

/* ================= v2.2: chart colors (ONE place) ================= */
/* Stored category colors -> chart shades per theme, validated with the dataviz skill's validate_palette.js
 * (light vs --surface #FFFFFF, dark vs #152328; adjacent pairs in taxonomy order: lightness band, chroma floor,
 * CVD ΔE ≥ 8, normal-vision ΔE ≥ 15, contrast ≥ 3:1 — dark "Serviços" 2.9:1 relies on the legend + table view).
 * Hue kept; only lightness/chroma nudged where a gate failed. Used by the Sankey AND the category chart, so a
 * category has the same color everywhere. Custom colors picked by the user are used as they are. */
const SHADES = {
  '#4f7df3': ['#4F7DF3', '#4F7DF3'], // Moradia
  '#f2994a': ['#D6802F', '#D37D2B'], // Alimentação
  '#9b6bf2': ['#9B6BF2', '#9B6BF2'], // Transporte
  '#e25d7b': ['#E25D7B', '#E25D7B'], // Saúde
  '#2bb3c0': ['#0EA4B0', '#1BA8B5'], // Educação
  '#e8b931': ['#B78F0A', '#B78F0A'], // Lazer
  '#c86dd7': ['#C76CD6', '#C268D1'], // Compras
  '#6c8ead': ['#27689B', '#296DA4'], // Serviços
  '#c08457': ['#C28354', '#C28354'], // Pessoal
  '#8d8f99': ['#5C616B', '#9AA0AA'], // Impostos (neutral, darkest/lightest step)
  '#8a93a3': ['#8A93A3', '#6F7A8C'], // Outros › Não identificado (neutral mid step)
  '#8a94a6': ['#A9B0BB', '#56606C']  // engine NEUTRAL (Sankey "Sem categoria"/"Outros")
};
const ROLE_SHADES = { __none: ['#A9B0BB', '#56606C'], __outros: ['#CDD2D9', '#3E4954'] };
// subcategories have no color of their own: fixed slots (position among the group's children), same validated hues
const SLOT_HEX = ['#4f7df3', '#f2994a', '#9b6bf2', '#e25d7b', '#2bb3c0', '#e8b931', '#c86dd7', '#6c8ead', '#c08457'];
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true; if (t === 'light') return false;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
}
function chartColor(hex) {
  const k = String(hex || '').toLowerCase(); const s = SHADES[k];
  return s ? s[isDark() ? 1 : 0] : (hex || 'var(--accent)');
}
function seriesFill(s) {
  if (ROLE_SHADES[s.id]) return ROLE_SHADES[s.id][isDark() ? 1 : 0];
  if (s.color) return chartColor(s.color);
  if (s.slot != null && s.slot < SLOT_HEX.length) return chartColor(SLOT_HEX[s.slot]);
  return chartColor(SLOT_HEX[Math.abs(String(s.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % SLOT_HEX.length]);
}

/* ================= v2.2: Gastos por categoria ao longo do tempo ================= */
const CC_TYPES = [['stacked', 'Barras empilhadas'], ['pct', 'Barras 100%'], ['grouped', 'Barras agrupadas'], ['lines', 'Linhas por categoria'], ['heat', 'Mapa de calor']];
const CC_GRAN = [['week', 'Semana'], ['month', 'Mês'], ['quarter', 'Trimestre'], ['year', 'Ano']];
const CC_RANGES = [[6, 'Últimos 6'], [12, 'Últimos 12'], [24, 'Últimos 24'], ['all', 'Tudo']];
const CC_DEFAULT = { type: 'stacked', gran: 'month', range: 6, level: 'group', groupId: null, hidden: [] };
const CC_LS = 'ff-catchart';
function ccValid(p) {
  const o = Object.assign({}, CC_DEFAULT);
  if (!p || typeof p !== 'object') return o;
  if (CC_TYPES.some(t => t[0] === p.type)) o.type = p.type;
  if (CC_GRAN.some(t => t[0] === p.gran)) o.gran = p.gran;
  if (CC_RANGES.some(t => t[0] === p.range)) o.range = p.range;
  if (p.level === 'category' && p.groupId) { o.level = 'category'; o.groupId = String(p.groupId); }
  if (Array.isArray(p.hidden)) o.hidden = p.hidden.filter(x => typeof x === 'string').slice(0, 60);
  if (p.updatedAt) o.updatedAt = String(p.updatedAt);
  return o;
}
/** the newest of the synced setting (settings.ui.categoryChart) and its local mirror (instant on reload) */
function ccPrefs() {
  let loc = null; try { loc = JSON.parse(ls.get(CC_LS) || 'null'); } catch (e) { loc = null; }
  const st = (settingsObj().ui || {}).categoryChart || null;
  const pick = !st ? loc : !loc ? st : (String(st.updatedAt || '') >= String(loc.updatedAt || '') ? st : loc);
  return ccValid(pick);
}
function ccSet(patch) {
  const p = Object.assign(ccPrefs(), patch, { updatedAt: nowISO() });
  ls.set(CC_LS, JSON.stringify(p));
  updateSettings(st => { st.ui = Object.assign({}, st.ui || {}, { categoryChart: p }); }, { render: false });
  renderCatChart();
}
function ccEnd() {
  const m = S.ui.month || todayISO().slice(0, 7);
  const t = todayISO();
  return m === t.slice(0, 7) ? t : lastDay(m);
}
function ccData(P) {
  P = P || ccPrefs();
  const groupOk = P.level === 'category' && (D().categories || []).some(g => g.id === P.groupId);
  const r = eng('categorySeries', live(), { granularity: P.gran, periods: P.range, end: ccEnd(), level: groupOk ? 'category' : 'group', groupId: groupOk ? P.groupId : null,
    topN: P.type === 'grouped' ? 5 : 7, categories: D().categories }) || { periods: [], series: [] };
  r.series.forEach(s => { s.fill = seriesFill(s); });
  return r;
}
const fmtK = c => { const v = Math.abs(c) / 100; return v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: v >= 100000 ? 0 : 1 }) + ' mil' : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
const pct = (v, t) => t > 0 ? (v / t * 100).toLocaleString('pt-BR', { maximumFractionDigits: v / t < 0.1 ? 1 : 0 }) + '%' : '—';
function ccPeriodName(p, gran) {
  if (gran === 'week') return 'semana ' + p.label.slice(1) + ' (' + isoToDM(p.from) + ' a ' + isoToDM(p.to) + ')';
  if (gran === 'month') { const [y, m] = p.key.split('-').map(Number); return MES[m - 1] + ' ' + y; }
  if (gran === 'quarter') return p.label.replace('T', '') .replace('/', 'º trimestre de 20');
  return p.label;
}
function catChartCardHTML() {
  const P = ccPrefs();
  const groups = (D().categories || []).filter(g => (g.kind || 'expense') === 'expense');
  const gid = P.level === 'category' && groups.some(g => g.id === P.groupId) ? P.groupId : null;
  return `<div class="card-h"><h2>Gastos por categoria ao longo do tempo</h2></div>
    <div class="cc-controls">
      <div class="field cc-type"><label for="cc-type">Gráfico</label><select id="cc-type">${CC_TYPES.map(([k, v]) => `<option value="${k}" ${P.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field cc-range"><label for="cc-range">Períodos</label><select id="cc-range">${CC_RANGES.map(([k, v]) => `<option value="${k}" ${P.range === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="seg cc-gran" role="group" aria-label="Agrupar por">${CC_GRAN.map(([k, v]) => `<button type="button" data-act="cc-gran" data-v="${k}" aria-pressed="${P.gran === k}">${v}</button>`).join('')}</div>
      <div class="cc-level"><div class="seg" role="group" aria-label="Nível"><button type="button" data-act="cc-level" data-v="group" aria-pressed="${!gid}">Grupos</button><button type="button" data-act="cc-level" data-v="category" aria-pressed="${!!gid}">Categorias</button></div>
        ${gid ? `<select id="cc-group" aria-label="Grupo">${groups.map(g => `<option value="${esc(g.id)}" ${g.id === gid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>` : ''}</div>
    </div>
    <div class="cc-legend" id="cc-legend" role="group" aria-label="Séries (toque para mostrar ou esconder)"></div>
    <div class="cc-box" id="cc-chart"></div>
    <div class="cc-tip" id="cc-tip" role="tooltip" hidden></div>
    <div class="row" style="justify-content:space-between"><span class="sk-hint" id="cc-hint">Toque numa barra para ver os lançamentos.</span><button class="btn ghost sm" type="button" data-act="cc-table" id="cc-table-btn" aria-expanded="${!!S.ui.ccTable}">${S.ui.ccTable ? 'Esconder tabela' : 'Ver tabela'}</button></div>
    <div id="cc-table" ${S.ui.ccTable ? '' : 'hidden'}></div>`;
}
function renderCatChart() {
  const card = $('#catchart-card'); if (!card) return;
  const keepScroll = ($('#cc-chart .cc-plot') || {}).scrollLeft;
  card.innerHTML = catChartCardHTML();
  const P = ccPrefs();
  const data = ccData(P);
  S._cc = { data, P };
  const hidden = new Set(P.hidden);
  const vis = data.series.filter(s => !hidden.has(s.id));
  const leg = $('#cc-legend');
  const lineKey = P.type === 'lines';
  leg.innerHTML = data.series.map(s => `<button type="button" class="cc-li" data-act="cc-toggle" data-id="${esc(s.id)}" aria-pressed="${!hidden.has(s.id)}"><i class="${lineKey ? 'ln' : 'bx'}${s.id === '__none' ? ' hatch' : ''}" style="--c:${esc(s.fill)}"></i><span></span></button>`).join('');
  $$('.cc-li span', leg).forEach((sp, i) => { sp.textContent = data.series[i].name; });
  const el = $('#cc-chart');
  const hint = $('#cc-hint');
  if (!data.series.length || !data.periods.some(p => p.total)) {
    el.innerHTML = '<p class="muted small" id="cc-empty">Sem gastos neste período.</p>'; $('#cc-table').innerHTML = ''; return;
  }
  if (!vis.length) { el.innerHTML = '<p class="muted small" id="cc-empty">Todas as séries estão escondidas. Toque na legenda para mostrar.</p>'; return; }
  const fn = { stacked: ccBars, pct: ccBars, grouped: ccGrouped, lines: ccLines, heat: ccHeat }[P.type] || ccBars;
  fn(el, data, vis, P);
  hint.textContent = P.type === 'heat' ? 'Cor mais forte = mais gasto. Toque numa célula para ver os lançamentos.' : P.type === 'lines' ? 'Mesma escala em todos os quadros. Toque para ver os lançamentos.' : 'Toque numa barra para ver os lançamentos.';
  el.dataset.type = P.type;
  // newest period visible first when the plot scrolls sideways (the y axis stays put)
  const pl = $('.cc-plot', el);
  if (pl && pl.scrollWidth > pl.clientWidth) pl.scrollLeft = keepScroll != null && S._ccKeep ? keepScroll : pl.scrollWidth;
  S._ccKeep = false;
  if (S.ui.ccTable) renderCcTable(data, vis, P);
}
/** short period labels when the band is narrow: "mai" (+"/26" on the first one and on January) */
function ccLabel(p, i, periods, gran, narrow) {
  if (!narrow || gran !== 'month') return p.label;
  return i === 0 || p.key.slice(5) === '01' ? p.label : p.label.split('/')[0];
}
/** y axis that stays put while the plot scrolls sideways: [axis svg, plot svg] inside .cc-frame */
function ccFrame(el, H, L, T, B, ymax, fmt, plotW, inner, aria) {
  const y = v => T + (H - T - B) * (1 - v / ymax);
  const ticks = [0, ymax / 2, ymax];
  const ax = ticks.map(t => `<text x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" class="cc-ax">${esc(fmt(t))}</text>`).join('');
  const grid = ticks.map(t => `<line x1="0" x2="${plotW}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="cc-grid"/>`).join('');
  el.innerHTML = `<div class="cc-frame"><svg class="cc-y" width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" aria-hidden="true">${ax}</svg>
    <div class="cc-plot"><svg class="cc-svg" width="${plotW}" height="${H}" viewBox="0 0 ${plotW} ${H}" role="img" aria-label="${esc(aria)}">${ccDefs()}${grid}${inner}</svg></div></div>`;
}
function roundTop(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
/** y-axis width that fits its widest tick label ("12,5 mil" was cut at the left edge; ≈6.2px per character at 10.5px) */
function ccAxisW(ymax, fmt, min) { return Math.max(min, Math.ceil(Math.max(...[0, ymax / 2, ymax].map(t => String(fmt(t)).length)) * 6.2) + 10); }
/** usable width inside the chart box */
function ccAvail(el) { return Math.max(260, el.clientWidth || 340); }
const ccMark = (attrs, s, p, extra) => `data-s="${esc(s)}" data-p="${p}" ${attrs || ''}${extra || ''}`;
function ccBars(el, data, vis, P) {
  const pctMode = P.type === 'pct';
  const totals = data.periods.map((_, i) => vis.reduce((s, x) => s + Math.max(0, x.values[i]), 0));
  const ymax0 = pctMode ? 1 : niceMax(Math.max(1, ...totals));
  const n = data.periods.length, L = pctMode ? 38 : ccAxisW(ymax0, fmtK, 40), T = 18, B = 26, H = 230;
  const avail = ccAvail(el) - L;
  const band = Math.max(36, avail / n), plotW = Math.max(avail, band * n);
  const narrow = band < 48;
  // the number over a bar is the period's net spending of the visible series (refunds larger than a category's spending
  // net out, as in the table and in "Saídas"); the bar itself can only stack the positive parts
  const nets = data.periods.map((_, i) => vis.reduce((s, x) => s + x.values[i], 0));
  const ymax = ymax0;
  const y = v => T + (H - T - B) * (1 - v / ymax);
  let svg = '';
  const bw = Math.min(24, Math.max(10, band * 0.56));
  data.periods.forEach((p, i) => {
    const cx = band * i + band / 2, x = cx - bw / 2;
    const tot = totals[i];
    let acc = 0;
    const segs = vis.map(s => ({ s, v: Math.max(0, s.values[i]) })).filter(o => o.v > 0);
    svg += `<g class="cc-col" tabindex="0" role="button" data-act="cc-open" data-p="${i}" aria-label="${esc(ccPeriodName(p, P.gran))}: ${esc(brl(nets[i]))}"><rect class="cc-hitcol" x="${(band * i).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${H - T - B}" fill="transparent"/>`;
    segs.forEach((o, k) => {
      const v0 = pctMode ? acc / tot : acc, v1 = pctMode ? (acc + o.v) / tot : acc + o.v;
      acc += o.v;
      const y0 = y(v0), y1 = y(v1); const top = k === segs.length - 1;
      const h = Math.max(0, y0 - y1 - (top ? 0 : 2)); // 2px surface gap between segments
      const yy = top ? y1 : y1 + 2;
      const d = top ? roundTop(x, yy, bw, h, 4) : `M${x},${yy + h}V${yy}H${x + bw}V${yy + h}Z`;
      if (h > 0) svg += `<path class="cc-seg${o.s.id === '__none' ? ' hatch' : ''}" d="${d}" fill="${esc(o.s.fill)}" ${ccMark('data-act="cc-open"', o.s.id, i)}/>`;
    });
    svg += '</g>';
    if (!pctMode && tot > 0) {
      // keep the label inside the plot: the first/last one would be cut at the edge (≈6px per character at 10.5px)
      const lbl = (nets[i] < 0 ? '−' : '') + fmtK(nets[i]), half = lbl.length * 3.2 + 2;
      const anchor = cx + half > plotW ? 'end' : cx - half < 0 ? 'start' : 'middle';
      const tx = anchor === 'end' ? plotW - 1 : anchor === 'start' ? 1 : cx;
      svg += `<text x="${tx.toFixed(1)}" y="${(y(tot) - 5).toFixed(1)}" text-anchor="${anchor}" class="cc-tot" data-act="cc-open" data-p="${i}">${esc(lbl)}</text>`;
    }
    svg += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cc-ax${i === n - 1 ? ' cur' : ''}">${esc(ccLabel(p, i, data.periods, P.gran, narrow))}</text>`;
  });
  ccFrame(el, H, L, T, B, ymax, pctMode ? (t => Math.round(t * 100) + '%') : (t => fmtK(t)), plotW, svg,
    (pctMode ? 'Participação de cada categoria nos gastos' : 'Gastos por categoria') + ' por ' + CC_GRAN.find(g => g[0] === P.gran)[1].toLowerCase());
}
function ccGrouped(el, data, vis, P) {
  const ymax = niceMax(Math.max(1, ...vis.flatMap(s => s.values.map(v => Math.max(0, v)))));
  const n = data.periods.length, k = vis.length, L = ccAxisW(ymax, fmtK, 40), T = 14, B = 26, H = 230;
  const gapIn = 2, bwMin = 5;
  const avail = ccAvail(el) - L;
  const band = Math.max(k * (bwMin + gapIn) + 12, avail / n), plotW = Math.max(avail, band * n);
  const narrow = band < 48;
  const y = v => T + (H - T - B) * (1 - v / ymax);
  let svg = '';
  const bw = Math.min(14, Math.max(bwMin, (band - 12) / k - gapIn));
  data.periods.forEach((p, i) => {
    const gw = k * bw + (k - 1) * gapIn, x0 = band * i + (band - gw) / 2;
    svg += `<g class="cc-col" tabindex="0" role="button" data-act="cc-open" data-p="${i}" aria-label="${esc(ccPeriodName(p, P.gran))}"><rect class="cc-hitcol" x="${(band * i).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${H - T - B}" fill="transparent"/>`;
    vis.forEach((s, j) => {
      const v = Math.max(0, s.values[i]); const h = y(0) - y(v);
      if (h > 0) svg += `<path class="cc-seg${s.id === '__none' ? ' hatch' : ''}" d="${roundTop(x0 + j * (bw + gapIn), y(v), bw, Math.max(h, 1), 3)}" fill="${esc(s.fill)}" ${ccMark('data-act="cc-open"', s.id, i)}/>`;
    });
    svg += '</g>';
    svg += `<text x="${(band * i + band / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cc-ax${i === n - 1 ? ' cur' : ''}">${esc(ccLabel(p, i, data.periods, P.gran, narrow))}</text>`;
  });
  ccFrame(el, H, L, T, B, ymax, t => fmtK(t), plotW, svg, 'Gastos por categoria lado a lado');
}
function ccLines(el, data, vis, P) {
  // small multiples: one panel per series, the same y scale in all of them
  const avail = ccAvail(el);
  const cols = avail >= 900 ? 4 : avail >= 600 ? 3 : 2;
  const gap = 10, pw = Math.floor((avail - gap * (cols - 1)) / cols), ph = 112, n = data.periods.length;
  const ymax = niceMax(Math.max(1, ...vis.flatMap(s => s.values.map(v => Math.max(0, v)))));
  const L = 6, R = 10, T = 30, B = 18;
  const x = i => L + (n === 1 ? (pw - L - R) / 2 : (pw - L - R) * i / (n - 1));
  const y = v => T + (ph - T - B) * (1 - Math.max(0, v) / ymax);
  const step = (pw - L - R) / Math.max(1, n - 1);
  const panels = vis.map(s => {
    const pts = s.values.map((v, i) => [x(i), y(v)]);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
    const area = path + `L${pts[n - 1][0].toFixed(1)},${y(0)}L${pts[0][0].toFixed(1)},${y(0)}Z`;
    const hits = data.periods.map((p, i) => `<rect class="cc-hit" x="${(x(i) - step / 2).toFixed(1)}" y="${T - 6}" width="${step.toFixed(1)}" height="${ph - T - B + 12}" fill="transparent" ${ccMark('data-act="cc-open"', s.id, i)}/>`).join('');
    return `<div class="cc-panel"><svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}" role="img" aria-label="">
      <line x1="${L}" x2="${pw - R}" y1="${y(0)}" y2="${y(0)}" class="cc-grid"/><line x1="${L}" x2="${pw - R}" y1="${y(ymax)}" y2="${y(ymax)}" class="cc-grid"/>
      <text x="${L}" y="12" class="cc-pt"></text><text x="${L}" y="25" class="cc-pv">${esc(brlShort(s.total))} no período</text>
      <path d="${area}" fill="${esc(s.fill)}" fill-opacity=".1"/>
      <path d="${path}" fill="none" stroke="${esc(s.fill)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${pts[n - 1][0].toFixed(1)}" cy="${pts[n - 1][1].toFixed(1)}" r="4" fill="${esc(s.fill)}" class="cc-dot"/>
      <line class="cc-cross" x1="0" x2="0" y1="${T - 4}" y2="${ph - B}" hidden/>
      <text x="${L}" y="${ph - 4}" class="cc-ax">${esc(data.periods[0].label)}</text><text x="${pw - R}" y="${ph - 4}" text-anchor="end" class="cc-ax">${esc(data.periods[n - 1].label)}</text>
      ${hits}</svg></div>`;
  });
  el.innerHTML = `<div class="cc-multi" style="grid-template-columns:repeat(${cols},1fr)">${panels.join('')}</div><p class="xs faint">Mesma escala em todos os quadros: de R$ 0 a ${esc(brl(ymax))}.</p>`;
  $$('.cc-panel', el).forEach((pn, i) => { const t = $('.cc-pt', pn); t.textContent = vis[i].name; pn.querySelector('svg').setAttribute('aria-label', vis[i].name + ': ' + brl(vis[i].total) + ' no período'); });
}
function ccHeat(el, data, vis, P) {
  const n = data.periods.length, rows = vis.length;
  const avail = ccAvail(el);
  const Lw = Math.min(118, Math.max(84, avail * 0.28)), T = 22, cellH = 30, gapC = 2;
  const cw = Math.max(30, (avail - Lw) / n);
  const plotW = Math.max(avail - Lw, n * cw), H = T + rows * cellH + 4;
  const narrow = cw < 52;
  const vmax = Math.max(1, ...vis.flatMap(s => s.values.map(v => Math.max(0, v))));
  // perceptual (square-root) intensity so one big month does not wash out the rest; the scale shows it
  const alpha = v => v > 0 ? 0.1 + 0.9 * Math.sqrt(v / vmax) : 0;
  let plot = data.periods.map((p, i) => `<text x="${(cw * i + cw / 2).toFixed(1)}" y="14" text-anchor="middle" class="cc-ax${i === n - 1 ? ' cur' : ''}">${esc(ccLabel(p, i, data.periods, P.gran, narrow))}</text>`).join('');
  let lab = '';
  vis.forEach((s, r) => {
    const yy = T + r * cellH;
    lab += `<text x="${Lw - 8}" y="${yy + cellH / 2 + 4}" text-anchor="end" class="cc-rl" data-r="${r}"></text>`;
    s.values.forEach((v, i) => {
      plot += `<rect class="cc-cell" x="${(cw * i + gapC / 2).toFixed(1)}" y="${yy + gapC / 2}" width="${(cw - gapC).toFixed(1)}" height="${cellH - gapC}" rx="3" fill="${v > 0 ? 'var(--accent)' : 'var(--surface-2)'}" fill-opacity="${v > 0 ? alpha(v).toFixed(3) : 1}" ${ccMark('data-act="cc-open"', s.id, i)}/>`;
    });
  });
  el.innerHTML = `<div class="cc-frame"><svg class="cc-y" width="${Lw}" height="${H}" viewBox="0 0 ${Lw} ${H}" aria-hidden="true">${lab}</svg>
    <div class="cc-plot"><svg class="cc-svg" width="${plotW}" height="${H}" viewBox="0 0 ${plotW} ${H}" role="img" aria-label="Mapa de calor: categorias por período">${plot}</svg></div></div>
    <div class="cc-scale" aria-hidden="true"><span class="xs muted">R$ 0</span><span class="bar"><i></i><b class="xs muted">${esc(fmtK(vmax / 4))}</b></span><span class="xs muted">${esc(brl(vmax))}</span></div>`;
  $$('.cc-rl', el).forEach(t => { const s = vis[+t.dataset.r]; let nm = s.name; t.textContent = nm; while (t.getComputedTextLength && t.getComputedTextLength() > Lw - 12 && nm.length > 4) { nm = nm.slice(0, -1); t.textContent = nm.trimEnd() + '…'; } });
}
function ccDefs() {
  return `<defs><pattern id="cc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--cc-hatch-bg)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--cc-hatch-ln)" stroke-width="2.4"/></pattern></defs>`;
}
function renderCcTable(data, vis, P) {
  const el = $('#cc-table'); if (!el) return;
  const rows = vis.map(s => `<tr><th scope="row"><i class="sw" style="background:${esc(s.fill)}"></i><span class="nm"></span></th>${s.values.map(v => `<td class="num">${v ? esc(brl(v)) : '—'}</td>`).join('')}<td class="num"><b>${esc(brl(s.total))}</b></td></tr>`).join('');
  const tot = data.periods.map((_, i) => vis.reduce((s, x) => s + x.values[i], 0));
  el.innerHTML = `<div class="table-wrap"><table class="pv cc-tbl"><thead><tr><th>Categoria</th>${data.periods.map(p => `<th class="num">${esc(p.label)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${rows}
    <tr class="tot"><th scope="row">Total</th>${tot.map(v => `<td class="num"><b>${esc(brl(v))}</b></td>`).join('')}<td class="num"><b>${esc(brl(tot.reduce((a, b) => a + b, 0)))}</b></td></tr></tbody></table></div>`;
  $$('.cc-tbl tbody tr', el).forEach((tr, i) => { const nm = $('.nm', tr); if (nm && vis[i]) nm.textContent = vis[i].name; });
}
/* tooltip: values lead, labels follow; names inserted with textContent */
function ccTip(target, ev) {
  const tip = $('#cc-tip'); const cc = S._cc; if (!tip || !cc) return;
  const sid = target.dataset.s, i = +target.dataset.p;
  const s = cc.data.series.find(x => x.id === sid); const p = cc.data.periods[i];
  if (!s || !p) { tip.hidden = true; return; }
  const hidden = new Set(cc.P.hidden);
  const tot = cc.data.series.filter(x => !hidden.has(x.id)).reduce((a, x) => a + Math.max(0, x.values[i]), 0);
  tip.innerHTML = '<b class="money"></b><span class="tl"><i class="ln"></i><span class="nm"></span></span><span class="xs muted pp"></span>';
  $('b', tip).textContent = brl(s.values[i]);
  $('.ln', tip).style.background = s.fill;
  $('.nm', tip).textContent = s.name + ' · ' + p.label;
  $('.pp', tip).textContent = pct(Math.max(0, s.values[i]), tot) + ' dos gastos ' + (cc.P.gran === 'week' ? 'da semana' : cc.P.gran === 'month' ? 'do mês' : cc.P.gran === 'quarter' ? 'do trimestre' : 'do ano');
  tip.hidden = false;
  const card = $('#catchart-card').getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = (ev && ev.clientX != null ? ev.clientX : r.left + r.width / 2) - card.left - tw / 2;
  left = Math.max(6, Math.min(card.width - tw - 6, left));
  let top = r.top - card.top - th - 8; if (top < 4) top = r.bottom - card.top + 8;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
  $$('.cc-seg.on, .cc-cell.on', $('#cc-chart')).forEach(x => x.classList.remove('on'));
  target.classList.add('on');
  // crosshair on small multiples
  const pn = target.closest('.cc-panel');
  $$('.cc-cross').forEach(c => { c.setAttribute('hidden', ''); });
  if (pn) { const c = $('.cc-cross', pn); const hx = +target.getAttribute('x') + +target.getAttribute('width') / 2; c.setAttribute('x1', hx); c.setAttribute('x2', hx); c.removeAttribute('hidden'); }
}
function ccTipHide() { const tip = $('#cc-tip'); if (tip) tip.hidden = true; $$('.cc-seg.on, .cc-cell.on').forEach(x => x.classList.remove('on')); $$('.cc-cross').forEach(c => c.setAttribute('hidden', '')); }
/** the spending rows behind a series (or the whole period when sid is null) */
function ccTxs(sid, i) {
  const cc = S._cc; if (!cc) return [];
  const p = cc.data.periods[i]; if (!p) return [];
  const s = sid ? cc.data.series.find(x => x.id === sid) : null;
  // the same category → group mapping as FinEngine.categorySeries (built once, not once per row)
  const ci = {}; for (const g of D().categories || []) { ci[g.id] = { group: g.id }; for (const c of g.children || []) ci[c.id] = { group: g.id }; }
  const opt = { level: cc.data.level, catIndex: ci };
  const gid = cc.data.level === 'category' ? cc.data.groupId : null;
  const hidden = new Set(cc.P.hidden);
  const members = s && s.members ? new Set(s.members) : null;
  const shown = new Set(cc.data.series.filter(x => !hidden.has(x.id)).flatMap(x => x.members || [x.id]));
  return live().filter(t => countable(t) && t.kind === 'expense' && t.date >= p.from && t.date <= p.to).filter(t => {
    if (gid && !(t.categoryId && t.categoryId !== E.NAO_ID && (ci[t.categoryId] ? ci[t.categoryId].group : String(t.categoryId).split('.')[0]) === gid)) return false;
    const k = E.categorySeriesKey(t, opt);
    if (!s) return shown.has(k);
    return members ? members.has(k) : k === s.id;
  });
}
function ccOpen(sid, i) {
  const cc = S._cc; if (!cc) return;
  const p = cc.data.periods[i]; if (!p) return;
  const s = sid ? cc.data.series.find(x => x.id === sid) : null;
  const txs = ccTxs(sid, i).sort((a, b) => b.date.localeCompare(a.date));
  const hidden = new Set(cc.P.hidden);
  const tot = cc.data.series.filter(x => !hidden.has(x.id)).reduce((a, x) => a + Math.max(0, x.values[i]), 0);
  const v = s ? s.values[i] : cc.data.series.filter(x => !hidden.has(x.id)).reduce((a, x) => a + x.values[i], 0);
  let body = '';
  if (!s) {
    const rows = cc.data.series.filter(x => !hidden.has(x.id) && x.values[i] > 0).sort((a, b) => b.values[i] - a.values[i]);
    const mx = rows.length ? rows[0].values[i] : 1;
    body += `<div class="bud">${rows.map(x => `<div class="bud-row"><div class="bud-top"><span class="nm"><i class="sw" style="background:${esc(x.fill)};width:10px;height:10px;border-radius:3px;display:inline-block"></i><span data-nm="${esc(x.id)}"></span></span><span class="money">${brl(x.values[i])} <span class="xs faint">${pct(x.values[i], tot)}</span></span></div><div class="bud-bar"><i style="width:${(x.values[i] / mx * 100).toFixed(1)}%;background:${esc(x.fill)}"></i></div></div>`).join('')}</div>`;
  }
  body += txs.length ? `<h3>${txs.length} lançamento${txs.length > 1 ? 's' : ''}</h3><div class="txlist">${txs.slice(0, 80).map(txRow).join('')}</div>${txs.length > 80 ? `<p class="small muted">Mostrando 80 de ${txs.length}. Veja todos em Transações.</p>` : ''}` : '<p class="muted">Nenhum lançamento.</p>';
  openSheet(`<div><span class="eyebrow">${esc(ccPeriodName(p, cc.P.gran))}</span><h2 id="cc-sheet-title"></h2><p class="money" style="font-size:1.1rem;font-weight:700">${brl(v)}${s ? ` <span class="small muted" style="font-weight:500">· ${pct(Math.max(0, v), tot)} do período</span>` : ''}</p></div>`, body, null, { kind: 'cc', label: 'Lançamentos' });
  $('#cc-sheet-title').textContent = s ? s.name : 'Gastos do período';
  $$('[data-nm]').forEach(x => { const se = cc.data.series.find(y => y.id === x.dataset.nm); if (se) x.textContent = se.name; });
}


/* ================= reusable components ================= */
/* --- date field: dd/mm/aaaa mask + calendar button (hidden native date input via showPicker) --- */
const CAL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';
function dateField(id, iso, label, opts) {
  opts = opts || {};
  return `<div class="field ${opts.cls || ''}"><label for="${id}">${esc(label)}</label>
    <div class="datef"><input type="text" id="${id}" data-datemask="1" inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" maxlength="10" value="${esc(isoToBR(iso))}" aria-describedby="${id}-err">
    <button type="button" class="icon-btn" data-act="datepick" data-for="${id}" aria-label="Abrir calendário para ${esc(label)}">${CAL_SVG}</button>
    <input type="date" class="date-native" id="${id}-native" data-native-for="${id}" tabindex="-1" aria-hidden="true" value="${esc(iso || '')}"></div>
    <span class="xs err-msg" id="${id}-err" hidden>Data inválida. Use dd/mm/aaaa.</span></div>`;
}
function maskDate(v) {
  const dg = String(v || '').replace(/\D/g, '').slice(0, 8);
  if (dg.length <= 2) return dg;
  if (dg.length <= 4) return dg.slice(0, 2) + '/' + dg.slice(2);
  return dg.slice(0, 2) + '/' + dg.slice(2, 4) + '/' + dg.slice(4);
}
/** value of a date field as ISO, '' when empty, null when invalid (and shows the error) */
function readDateField(id, required) {
  const inp = $('#' + id); if (!inp) return '';
  const v = inp.value.trim();
  const err = $('#' + id + '-err');
  if (!v) { if (err) err.hidden = !required; inp.classList.toggle('invalid', !!required); return required ? null : ''; }
  const iso = brToISO(v);
  if (err) err.hidden = !!iso;
  inp.classList.toggle('invalid', !iso);
  return iso;
}
function openDatePicker(id) {
  const txt = $('#' + id), nat = $('#' + id + '-native');
  if (!txt || !nat) return;
  const iso = brToISO(txt.value); if (iso) nat.value = iso;
  try { if (typeof nat.showPicker === 'function') { nat.showPicker(); return; } throw new Error('no showPicker'); }
  catch (e) { try { nat.style.pointerEvents = 'auto'; nat.focus(); nat.click(); } catch (e2) { /* ignore */ } finally { setTimeout(() => { nat.style.pointerEvents = ''; }, 500); } }
}

/* --- category picker with "+ Nova categoria" --- */
function categoryOptions(sel, kindFilter) {
  return (D().categories || []).filter(g => !kindFilter || g.kind === kindFilter || !g.kind).map(g => `<optgroup label="${esc(g.name)}"><option value="${esc(g.id)}" ${sel === g.id ? 'selected' : ''}>${esc(g.name)} (geral)</option>${(g.children || []).map(c => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}
function catSelect(id, sel, opts) {
  opts = opts || {};
  return `<select id="${id}" data-catsel="${id}">${opts.allowNone ? '<option value="">Sem categoria</option>' : ''}${categoryOptions(sel)}<option value="__new">+ Nova categoria…</option></select>`;
}
/** inline form: pick an existing group or create a new one (name + color), then the category name */
function newCatForm(p, opts) {
  opts = opts || {};
  const groups = D().categories || [];
  const kind = opts.kind || 'expense';
  const def = groups.find(g => (g.kind || 'expense') === kind) || groups[0];
  const color = PALETTE.find(c => !groups.some(g => (g.color || '').toLowerCase() === c.toLowerCase())) || PALETTE[groups.length % PALETTE.length];
  return `<div class="newcat" id="${p}-nc" ${opts.open ? '' : 'hidden'} data-ncfor="${p}">
    <b class="small">Nova categoria</b>
    <div class="field"><label for="${p}-nc-group">Grupo</label><select id="${p}-nc-group" data-ncgroup="${p}">${groups.map(g => `<option value="${esc(g.id)}" ${def && def.id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="__newgroup">+ Novo grupo…</option></select></div>
    <div id="${p}-nc-ng" hidden style="display:flex;flex-direction:column;gap:10px">
      <div class="form-grid"><div class="field"><label for="${p}-nc-gname">Nome do grupo</label><input type="text" id="${p}-nc-gname" placeholder="Ex.: Filhos"></div>
      <div class="field"><label for="${p}-nc-gcolor">Cor</label><input type="color" class="color-in" id="${p}-nc-gcolor" value="${esc(color)}"></div></div>
      <div class="field"><label for="${p}-nc-gkind">Tipo do grupo</label><select id="${p}-nc-gkind"><option value="expense" ${kind === 'expense' ? 'selected' : ''}>Gastos</option><option value="income" ${kind === 'income' ? 'selected' : ''}>Renda</option><option value="investment">Investimentos</option></select></div>
    </div>
    <div class="field"><label for="${p}-nc-name">Nome da categoria</label><input type="text" id="${p}-nc-name" placeholder="Ex.: Escola das crianças"></div>
    <span class="xs err-msg" id="${p}-nc-err" hidden></span>
    <div class="row end"><button class="btn sm" type="button" data-act="nc-cancel" data-p="${p}">Cancelar</button><button class="btn sm primary" type="button" data-act="nc-save" data-p="${p}">Criar e usar</button></div>
  </div>`;
}
/** creates the category from the inline form; returns the new id or null (and shows the problem) */
function createCategoryFromForm(p) {
  const err = $('#' + p + '-nc-err');
  const fail = m => { if (err) { err.textContent = m; err.hidden = false; } return null; };
  const name = (($('#' + p + '-nc-name') || {}).value || '').trim();
  let gid = ($('#' + p + '-nc-group') || {}).value;
  const cats = D().categories;
  let g;
  if (gid === '__newgroup') {
    const gname = (($('#' + p + '-nc-gname') || {}).value || '').trim();
    if (!gname) return fail('Dê um nome ao grupo novo.');
    let id = slug(gname).replace(/-/g, '_'); const ids = new Set(cats.map(x => x.id)); let k = 2; const base = id; while (ids.has(id)) id = base + '_' + (k++);
    g = { id, name: gname, color: ($('#' + p + '-nc-gcolor') || {}).value || PALETTE[0], kind: ($('#' + p + '-nc-gkind') || {}).value || 'expense', children: [] };
    cats.push(g);
  } else g = cats.find(x => x.id === gid);
  if (!g) return fail('Escolha um grupo.');
  if (!name) { if (gid === '__newgroup') { commit({ meta: ['categories'], render: false }); return g.id; } return fail('Dê um nome à categoria.'); }
  const existing = (g.children || []).find(c => normU(c.name) === normU(name));
  if (existing) { commit({ meta: ['categories'], render: false }); return existing.id; }
  let id = g.id + '.' + slug(name).replace(/-/g, '_'); const ids = new Set((g.children || []).map(c => c.id)); let k = 2; const b = id; while (ids.has(id)) id = b + '_' + (k++);
  (g.children = g.children || []).push({ id, name });
  commit({ meta: ['categories'], render: false });
  toast('Categoria criada: ' + g.name + ' › ' + name);
  return id;
}

/* ---------- sheet ---------- */
function openSheet(head, body, onClose, meta) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim" data-act="closesheet"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc((meta && meta.label) || 'Detalhes')}"><div class="grab"></div>
    <div class="sheet-h"><div class="grow">${head}</div><button class="icon-btn" type="button" data-act="closesheet" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="sheet-body" id="sheet-body">${body}</div></div>`;
  S._sheetClose = onClose || null;
  S.sheet = meta || { kind: 'other' };
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const f = root.querySelector('.sheet input:not([type=date]), .sheet select, .sheet button:not([data-act=closesheet])'); if (f && !('ontouchstart' in window)) f.focus({ preventScroll: true }); }, 50);
}
function closeSheet() {
  $('#sheet-root').innerHTML = ''; document.body.style.overflow = '';
  const c = S._sheetClose; S._sheetClose = null; S.sheet = null; if (c) c();
  if (_deferRender) { _deferRender = false; renderCurrent(); }
}

/* ================= TRANSAÇÕES ================= */
function txIcon(t) {
  const g = groupOf(t.categoryId);
  const letter = (t.merchant || t.rawDescription || '?').replace(/[^A-Za-zÀ-ú0-9]/g, '').charAt(0).toUpperCase() || '?';
  const bg = t.kind === 'card_payment' || t.kind === 'transfer' ? 'var(--ink-3)' : (g ? g.color : 'var(--ink-3)');
  return `<span class="ic" style="background:${esc(bg)}" aria-hidden="true">${esc(letter)}</span>`;
}
/** "14:32" · "compra em 10/06 · parcela 3/10" — only what the file had */
function txMetaBits(t) {
  const bits = [];
  if (t.time) bits.push(`<span class="t" data-time>${esc(t.time)}</span>`);
  if (t.installment && t.installment.n) {
    bits.push(`<span data-inst>${t.originalDate ? 'compra em ' + esc(isoToDM(t.originalDate)) + ' · ' : ''}parcela ${t.installment.n}/${t.installment.total}</span>`);
  }
  if (t.fx && t.fx.currency && t.fx.currency !== 'BRL') bits.push(`<span class="fxb" data-fx title="Valor original${t.fx.rate ? ' · cotação ' + esc(String(t.fx.rate).replace('.', ',')) : ''}">${esc(E.formatFx ? E.formatFx(t.fx) : t.fx.currency)}</span>`);
  if (t.tags && t.tags.length) bits.push(`<span data-wallet>${esc(t.tags.join(', '))}</span>`);
  return bits;
}
function txRow(t) {
  const g = groupOf(t.categoryId); const unc = isUncat(t);
  const tags = [];
  if (t.categoryId) tags.push(`<span class="tag"><span class="dot" style="background:${esc(g ? g.color : 'var(--ink-3)')}"></span>${esc(catLabel(t.categoryId))}</span>`);
  else if (countable(t)) tags.push('<span class="tag warn">Sem categoria</span>');
  if (t.kind === 'card_payment' || t.kind === 'transfer' || t.kind === 'investment') tags.push(`<span class="tag acc">${esc(KIND_LBL[t.kind])}</span>`);
  if (t.catSource) tags.push(`<span class="tag ${t.catSource === 'ai' ? 'acc' : ''}">${esc(SRC_LBL[t.catSource] || t.catSource)}</span>`);
  if (t.note) tags.push('<span class="tag">nota</span>');
  const cls = t.amount > 0 ? 'in' : (t.kind === 'card_payment' || t.kind === 'transfer' ? 'muted' : '');
  const meta = txMetaBits(t);
  const sel = S.ui.sel;
  return `<button type="button" class="tx ${unc ? 'uncat' : ''}" ${sel ? `data-act="seltx" aria-pressed="${sel.has(t.id)}"` : 'data-act="edittx"'} data-id="${esc(t.id)}">${sel ? `<span class="ck" aria-hidden="true">${sel.has(t.id) ? '✓' : ''}</span>` : ''}${txIcon(t)}
    <span class="mid"><span class="mer">${esc(t.merchant || t.rawDescription)}</span>${meta.length ? `<span class="meta">${meta.join('<span aria-hidden="true">·</span>')}</span>` : ''}<span class="raw">${esc(t.rawDescription)} · ${esc(accName(t.accountId))}</span><span class="tags">${tags.join('')}</span></span>
    <span class="amt ${cls}">${t.amount > 0 ? '+' : ''}${brl(t.amount)}</span></button>`;
}

/* --- filters (session-remembered) --- */
function emptyAdv() { return { from: '', to: '', min: '', max: '', types: [], accounts: [], cats: [], sources: [], inst: false, note: false, fx: false, text: '' }; }
function loadTxPrefs() {
  try { const j = JSON.parse(ss.get('ff-tx-prefs') || 'null'); if (j) { S.ui.adv = Object.assign(emptyAdv(), j.adv || {}); if (SORTS.some(s => s[0] === j.sort)) S.ui.sort = j.sort; if (j.filter) S.ui.filter = j.filter; if (typeof j.q === 'string') S.ui.q = j.q; } } catch (e) { /* ignore */ }
  if (!S.ui.adv) S.ui.adv = emptyAdv();
}
function saveTxPrefs() { ss.set('ff-tx-prefs', JSON.stringify({ adv: S.ui.adv, sort: S.ui.sort, filter: S.ui.filter, q: S.ui.q })); }
function advCount(a) {
  a = a || S.ui.adv || emptyAdv();
  let n = 0;
  if (a.from || a.to) n++;
  if (a.min !== '' && a.min != null || a.max !== '' && a.max != null) n++;
  ['types', 'accounts', 'cats', 'sources'].forEach(k => { if ((a[k] || []).length) n++; });
  if (a.inst) n++; if (a.note) n++; if (a.fx) n++; if ((a.text || '').trim()) n++;
  return n;
}
function applyAdv(list, a) {
  if (!a) return list;
  const inGroupOrCat = (t, sel) => sel.some(id => t.categoryId === id || (id.indexOf('.') < 0 && String(t.categoryId || '').split('.')[0] === id));
  const min = a.min !== '' && a.min != null ? Math.abs(parseMoney(a.min) || 0) : null;
  const max = a.max !== '' && a.max != null ? Math.abs(parseMoney(a.max) || 0) : null;
  const text = normU(a.text || '');
  return list.filter(t => {
    if (a.from && t.date < a.from) return false;
    if (a.to && t.date > a.to) return false;
    const abs = Math.abs(t.amount || 0);
    if (min != null && abs < min) return false;
    if (max != null && abs > max) return false;
    if ((a.types || []).length && !a.types.includes(t.kind)) return false;
    if ((a.accounts || []).length && !a.accounts.includes(t.accountId)) return false;
    if ((a.cats || []).length && !inGroupOrCat(t, a.cats)) return false;
    if ((a.sources || []).length && !a.sources.includes(t.catSource || 'none')) return false;
    if (a.inst && !(t.installment && t.installment.n)) return false;
    if (a.note && !(t.note && String(t.note).trim())) return false;
    if (a.fx && !isFxRow(t)) return false;
    if (text && !normU(t.rawDescription).includes(text) && !normU(t.merchant).includes(text)) return false;
    return true;
  });
}
function sortList(list, sort) {
  const by = {
    date_desc: (a, b) => b.date.localeCompare(a.date) || String(b.time || '').localeCompare(String(a.time || '')) || a.amount - b.amount,
    date_asc: (a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')) || a.amount - b.amount,
    amt_desc: (a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.date.localeCompare(a.date),
    amt_asc: (a, b) => Math.abs(a.amount) - Math.abs(b.amount) || b.date.localeCompare(a.date),
    merchant: (a, b) => String(a.merchant || a.rawDescription).localeCompare(String(b.merchant || b.rawDescription), 'pt-BR') || b.date.localeCompare(a.date),
    category: (a, b) => (a.categoryId ? 0 : 1) - (b.categoryId ? 0 : 1) || catLabel(a.categoryId).localeCompare(catLabel(b.categoryId), 'pt-BR') || b.date.localeCompare(a.date)
  }[sort] || null;
  return list.slice().sort(by || ((a, b) => b.date.localeCompare(a.date)));
}
function filteredTxs() {
  const f = S.ui.filter; const q = S.ui.q.trim().toUpperCase();
  let list = live().slice();
  if (f === 'uncat') list = list.filter(isUncat);
  else if (f === 'unid') list = list.filter(t => t.categoryId === NAO_ID);
  else if (f === 'in') list = list.filter(t => t.amount > 0 && countable(t));
  else if (f === 'out') list = list.filter(t => t.amount < 0 && countable(t));
  else if (f.startsWith('acc:')) list = list.filter(t => t.accountId === f.slice(4));
  if (q) {
    const qn = q.replace(/[R$\s]/g, '');
    list = list.filter(t => (t.merchant || '').toUpperCase().includes(q) || (t.rawDescription || '').toUpperCase().includes(q) || catLabel(t.categoryId).toUpperCase().includes(q) || (t.note || '').toUpperCase().includes(q) || (qn && /\d/.test(qn) && brl(Math.abs(t.amount)).replace(/[R$\s]/g, '').includes(qn)));
  }
  list = applyAdv(list, S.ui.adv);
  return sortList(list, S.ui.sort);
}
function renderTx() {
  const el = $('#scr-tx');
  if (!S.ui.adv) loadTxPrefs();
  const unc = uncatCount();
  const nUnid = live().filter(t => t.categoryId === NAO_ID).length;
  const accs = (D().accounts || []).filter(a => live().some(t => t.accountId === a.id));
  const f = S.ui.filter;
  const n = advCount();
  const chip = (key, label, extra) => `<button type="button" class="chip" data-act="filter" data-f="${esc(key)}" aria-pressed="${f === key}">${label}${extra || ''}</button>`;
  el.innerHTML = `
    <div class="row" style="justify-content:space-between"><h2 style="font-size:1.35rem">Transações</h2>
      <button type="button" class="btn primary sm" data-act="triage" id="btn-triage" ${unc ? '' : 'disabled'}>Modo triagem${unc ? ` · ${unc}` : ''}</button></div>
    <div class="searchbar"><input type="search" id="tx-search" placeholder="Buscar estabelecimento, descrição ou valor" value="${esc(S.ui.q)}" aria-label="Buscar transações"></div>
    <div class="chips" role="group" aria-label="Filtros rápidos">
      ${chip('all', 'Todas')}${chip('uncat', 'Sem categoria', unc ? `<span class="cnt">${unc}</span>` : '')}${nUnid || f === 'unid' ? chip('unid', 'Não identificado', nUnid ? `<span class="cnt muted-cnt">${nUnid}</span>` : '') : ''}${chip('in', 'Entradas')}${chip('out', 'Saídas')}
      ${accs.map(a => chip('acc:' + a.id, esc(a.name))).join('')}
    </div>
    <div class="toolbar">
      <button type="button" class="btn sm" data-act="filters" id="btn-filters" aria-label="Filtros${n ? ' (' + n + ' ativos)' : ''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtros${n ? `<span class="cnt" id="filters-count">${n}</span>` : ''}</button>
      ${n ? '<button type="button" class="btn ghost sm" data-act="filters-clear" id="btn-filters-clear">Limpar</button>' : ''}
      <label class="sr-only" for="tx-sort">Ordenar</label>
      <select id="tx-sort" aria-label="Ordenar">${SORTS.map(([k, v]) => `<option value="${k}" ${S.ui.sort === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      ${S.mode === 'real' && !S.ui.sel ? '<button type="button" class="btn sm" data-act="sel-start" id="btn-select">Selecionar</button>' : ''}
    </div>
    ${selBarHTML()}
    <div id="tx-list"></div>`;
  renderTxList();
}
function renderTxList() {
  const el = $('#tx-list'); if (!el) return;
  const list = filteredTxs();
  const f = S.ui.filter;
  if (!list.length) { el.innerHTML = `<div class="empty"><b>${f === 'uncat' && !advCount() ? 'Tudo categorizado.' : 'Nada encontrado.'}</b><span class="small">${f === 'uncat' && !advCount() ? 'Nenhum lançamento esperando categoria.' : 'Tente outro filtro ou busca.'}</span></div>`; return; }
  const LIMIT = S.ui.txLimit || 200;
  const byDate = S.ui.sort === 'date_desc' || S.ui.sort === 'date_asc';
  let html = '';
  if (byDate) {
    const groups = []; let cur = null;
    list.slice(0, LIMIT).forEach(t => { if (!cur || cur.date !== t.date) { cur = { date: t.date, items: [] }; groups.push(cur); } cur.items.push(t); });
    html = groups.map(gr => {
      const d = new Date(gr.date + 'T12:00:00');
      const lbl = isNaN(d) ? gr.date : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      const tot = gr.items.filter(countable).reduce((s, t) => s + t.amount, 0);
      return `<div class="daygroup"><div class="dayhead"><span>${esc(lbl)}</span><span class="money">${brl(tot)}</span></div><div class="txlist">${gr.items.map(txRow).join('')}</div></div>`;
    }).join('');
  } else {
    const tot = list.filter(countable).reduce((s, t) => s + t.amount, 0);
    html = `<div class="daygroup"><div class="dayhead"><span>${list.length} lançamento${list.length > 1 ? 's' : ''}</span><span class="money">${brl(tot)}</span></div><div class="txlist">${list.slice(0, LIMIT).map(t => txRow(t).replace('<span class="raw">', `<span class="raw">${esc(isoToBR(t.date))} · `)).join('')}</div></div>`;
  }
  el.innerHTML = html + (list.length > LIMIT ? `<div class="row" style="justify-content:center;padding-top:12px"><button class="btn" type="button" data-act="more">Mostrar mais (${list.length - LIMIT})</button></div>` : '');
}

/* --- filter sheet --- */
function openFilters() {
  const a = S.ui.adv || emptyAdv();
  const accs = D().accounts || [];
  const cats = D().categories || [];
  const chk = (name, val, on, label) => `<label class="check-chip"><input type="checkbox" data-fchk="${name}" value="${esc(val)}" ${on ? 'checked' : ''}>${esc(label)}</label>`;
  const body = `
    <div class="field"><span class="lbl">Período</span>
      <div class="preset-row">${[['month', 'Este mês'], ['last', 'Mês passado'], ['90', 'Últimos 90 dias'], ['year', 'Este ano']].map(([k, v]) => `<button type="button" class="chip" data-act="f-preset" data-k="${k}">${v}</button>`).join('')}</div>
      <div class="form-grid">${dateField('f-from', a.from, 'De')}${dateField('f-to', a.to, 'Até')}</div></div>
    <div class="form-grid">
      <div class="field"><label for="f-min">Valor mínimo (R$)</label><input type="text" inputmode="decimal" class="money-in" id="f-min" value="${esc(a.min || '')}" placeholder="0,00"></div>
      <div class="field"><label for="f-max">Valor máximo (R$)</label><input type="text" inputmode="decimal" class="money-in" id="f-max" value="${esc(a.max || '')}" placeholder="sem limite"></div>
    </div>
    <div class="field"><span class="lbl">Tipo</span><div class="check-list">${Object.entries(TYPE_FILTER_LBL).map(([k, v]) => chk('types', k, (a.types || []).includes(k), v)).join('')}</div></div>
    ${accs.length ? `<div class="field"><span class="lbl">Contas</span><div class="check-list">${accs.map(x => chk('accounts', x.id, (a.accounts || []).includes(x.id), x.name)).join('')}</div></div>` : ''}
    <div class="field"><span class="lbl">Grupo / categoria</span>
      <div id="f-cats">${cats.map(g => `<div class="cat-check-group"><div class="gh"><label class="check-chip"><input type="checkbox" data-fchk="cats" value="${esc(g.id)}" ${(a.cats || []).includes(g.id) ? 'checked' : ''}><span class="dot" style="width:9px;height:9px;border-radius:3px;background:${esc(g.color)}"></span>${esc(g.name)} (todo o grupo)</label></div>
        <div class="check-list">${(g.children || []).map(c => chk('cats', c.id, (a.cats || []).includes(c.id), c.name)).join('')}</div></div>`).join('')}</div>
      <button type="button" class="btn ghost sm" data-act="nc-open" data-p="flt" style="align-self:flex-start">+ Nova categoria</button>
      ${newCatForm('flt')}</div>
    <div class="field"><span class="lbl">Origem da categoria</span><div class="check-list">${SRC_FILTER.map(([k, v]) => chk('sources', k, (a.sources || []).includes(k), v)).join('')}</div></div>
    <div class="check-list"><label class="check-chip"><input type="checkbox" id="f-inst" ${a.inst ? 'checked' : ''}>Só parceladas</label><label class="check-chip"><input type="checkbox" id="f-note" ${a.note ? 'checked' : ''}>Com nota</label><label class="check-chip"><input type="checkbox" id="f-fx" ${a.fx ? 'checked' : ''}>Moeda estrangeira</label></div>
    <div class="field"><label for="f-text">Texto na descrição</label><input type="search" id="f-text" value="${esc(a.text || '')}" placeholder="Ex.: PIX, UBER"></div>
    <div class="row end"><button class="btn" type="button" data-act="filters-clear">Limpar</button><button class="btn primary" type="button" data-act="filters-apply" id="f-apply">Aplicar</button></div>`;
  openSheet('<h2>Filtros</h2>', body, null, { kind: 'filters', label: 'Filtros' });
}
function readFilters() {
  const from = readDateField('f-from'), to = readDateField('f-to');
  if (from === null || to === null) return null;
  const vals = name => $$(`[data-fchk="${name}"]`).filter(i => i.checked).map(i => i.value);
  return { from: from || '', to: to || '', min: ($('#f-min') || {}).value || '', max: ($('#f-max') || {}).value || '',
    types: vals('types'), accounts: vals('accounts'), cats: vals('cats'), sources: vals('sources'),
    inst: !!($('#f-inst') || {}).checked, note: !!($('#f-note') || {}).checked, fx: !!($('#f-fx') || {}).checked, text: ($('#f-text') || {}).value || '' };
}
function presetRange(k) {
  const t = todayISO(), ym = t.slice(0, 7);
  if (k === 'month') return [ym + '-01', lastDay(ym)];
  if (k === 'last') { const p = addMonths(ym, -1); return [p + '-01', lastDay(p)]; }
  if (k === '90') { const d = new Date(); d.setDate(d.getDate() - 89); return [d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), t]; }
  if (k === 'year') return [t.slice(0, 4) + '-01-01', t.slice(0, 4) + '-12-31'];
  return ['', ''];
}

/* --- editor --- */
/* --- v2.1: "não sabe o que é?" — Google, CNPJ and CNAE help (nothing is sent anywhere until the user taps) --- */
const gUrl = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
const EXT = 'target="_blank" rel="noopener noreferrer"';
/* a company page people can read (the Artifact build cannot fetch anything itself); "Outra fonte" = a Google search */
const cnpjPageUrl = cnpj => 'https://cnpj.biz/' + String(cnpj || '').replace(/\D/g, '');
const cnpjOtherUrl = cnpj => gUrl('CNPJ ' + (E.formatCNPJ ? E.formatCNPJ(cnpj) : cnpj));
function canLookupCnpj() { return S.auth.mode === 'netlify' && !!S.auth.user && store && typeof store.lookupCnpj === 'function'; }
function lookupHelpHTML(t, p) {
  const q = (E.searchQuery ? E.searchQuery(t) : (t.merchant || t.rawDescription)) || t.rawDescription || '';
  const merchant = t.merchant || t.rawDescription || '';
  const cnpj = E.findCNPJ ? E.findCNPJ(t.rawDescription) : null;
  const viaServer = cnpj && canLookupCnpj();
  return `<div class="help-box" id="${p}-help">
    <div class="row help-links">
      <a class="btn sm" id="${p}-google" href="${esc(gUrl(q))}" ${EXT}>Pesquisar no Google</a>
      ${cnpj ? (viaServer ? `<button class="btn sm" type="button" id="${p}-cnpj" data-act="cnpj-lookup" data-p="${p}" data-cnpj="${esc(cnpj)}">Consultar CNPJ</button>`
        : `<a class="btn sm" id="${p}-cnpj" href="${esc(cnpjPageUrl(cnpj))}" ${EXT}>Consultar CNPJ</a><a class="xs" id="${p}-cnpj-alt" href="${esc(cnpjOtherUrl(cnpj))}" ${EXT}>Outra fonte</a>`)
        : `<a class="btn sm" id="${p}-cnpj-name" href="${esc(gUrl(merchant + ' CNPJ'))}" ${EXT}>Buscar CNPJ pelo nome</a>`}
    </div>
    ${cnpj ? `<span class="xs muted">CNPJ na descrição: ${esc(E.formatCNPJ ? E.formatCNPJ(cnpj) : cnpj)}</span>` : ''}
    <div id="${p}-cnpj-out" aria-live="polite"></div>
    ${viaServer ? '' : `<div class="field"><label for="${p}-cnae">Colar atividade ou CNAE</label><textarea id="${p}-cnae" data-cnae="${p}" rows="2" autocomplete="off" spellcheck="false" placeholder="Ex.: 47.71-7-01, ou cole o texto da página da empresa"></textarea><span class="xs muted">${cnpj ? 'Na página da empresa, copie a "Atividade principal" (ou a página toda) e cole aqui.' : 'Achou o CNPJ? Copie a atividade principal (CNAE) e cole aqui.'}</span></div>`}
    <div class="sug-row" id="${p}-cnae-out" aria-live="polite"></div>
    <p class="xs faint">Nada é enviado a ninguém até você tocar num destes botões.</p>
  </div>`;
}
function cnaeChipHTML(sug, p) {
  if (!sug || !catIndex()[sug.categoryId]) return '';
  const g = groupOf(sug.categoryId);
  return `<button type="button" class="sug-btn" data-act="cnae-pick" data-p="${esc(p)}" data-cat="${esc(sug.categoryId)}" title="${esc((sug.code ? 'CNAE ' + sug.code + ' · ' : '') + (sug.description || ''))}"><span class="sw" style="background:${esc(g ? g.color : 'var(--accent)')}"></span>${esc(catLabel(sug.categoryId))}</button>`;
}
function renderCnaeSuggestion(p, value) {
  const out = $('#' + p + '-cnae-out'); if (!out) return;
  const v = String(value || '').trim();
  if (!v) { out.innerHTML = ''; return; }
  const sug = E.suggestFromCNAE ? E.suggestFromCNAE(v) : null;
  out.innerHTML = sug && catIndex()[sug.categoryId]
    ? `<span class="xs muted" style="flex-basis:100%">${sug.code ? 'CNAE ' + esc(sug.code) + ' · ' : ''}${esc(sug.description || '')} — toque para usar:</span>${cnaeChipHTML(sug, p)}`
    : '<span class="xs muted">Não reconheci esse código ou atividade. Escolha a categoria abaixo.</span>';
}
async function cnpjLookup(p, cnpj) {
  const out = $('#' + p + '-cnpj-out'); if (!out) return;
  out.innerHTML = '<span class="small"><span class="spinner"></span> Consultando…</span>';
  try {
    const r = await store.lookupCnpj(cnpj);
    const o = $('#' + p + '-cnpj-out'); if (!o) return;
    const sug = (E.suggestFromCNAE && (E.suggestFromCNAE(r.cnae_fiscal != null ? String(r.cnae_fiscal) : '') || E.suggestFromCNAE(r.cnae_fiscal_descricao || ''))) || null;
    const code = r.cnae_fiscal != null && /^\d{7}$/.test(String(r.cnae_fiscal)) ? String(r.cnae_fiscal).replace(/^(\d{4})(\d)(\d{2})$/, '$1-$2/$3') : (r.cnae_fiscal != null ? String(r.cnae_fiscal) : '');
    const str = v => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    o.innerHTML = `<div class="cnpj-res" id="${p}-cnpj-card"><b>${esc(str(r.nome_fantasia) || str(r.razao_social) || 'Empresa')}</b>
      <dl>${str(r.razao_social) ? `<dt>Razão social</dt><dd>${esc(str(r.razao_social))}</dd>` : ''}${str(r.nome_fantasia) ? `<dt>Nome fantasia</dt><dd>${esc(str(r.nome_fantasia))}</dd>` : ''}
        <dt>Atividade principal</dt><dd>${esc(str(r.cnae_fiscal_descricao) || '—')}${code ? ' <span class="faint">(' + esc(code) + ')</span>' : ''}</dd>
        ${str(r.municipio) ? `<dt>Cidade/UF</dt><dd>${esc(str(r.municipio))}${str(r.uf) ? '/' + esc(str(r.uf)) : ''}</dd>` : ''}</dl>
      ${sug && catIndex()[sug.categoryId] ? `<div class="sug-row"><span class="xs muted" style="flex-basis:100%">Sugestão — toque para usar:</span>${cnaeChipHTML(sug, p)}</div>` : ''}</div>`;
  } catch (e) {
    const o = $('#' + p + '-cnpj-out'); if (!o) return;
    const msg = { rate_limited: 'Muitas consultas nesta hora. Tente mais tarde.', cnpj_not_found: 'CNPJ não encontrado na Receita.', invalid_cnpj: 'CNPJ inválido.', upstream_timeout: 'O serviço de CNPJ não respondeu a tempo. Tente de novo.', upstream_unavailable: 'O serviço de CNPJ está fora do ar. Tente de novo mais tarde.', network: 'Sem conexão. Tente quando a internet voltar.' }[e && e.code] || 'Não consegui consultar agora.';
    o.innerHTML = `<span class="small out">${esc(msg)}</span>`;
  }
}
function cnaePick(p, catId) {
  if (p === 'tri') { triagePick(catId); return; }
  const sel = $('#ed-cat'); if (!sel) return;
  sel.value = catId; sel.dispatchEvent(new Event('change', { bubbles: true }));
  toast('Categoria escolhida: ' + catLabel(catId) + '. Toque em Salvar.');
}
/** installment-series rule that covers t (if any) + the parcelas range it covers */
function seriesNote(t) {
  if (!t || !t.installment || !E.seriesRuleMatches) return null;
  const r = (D().rules || []).find(x => x && x.origin === 'installment' && E.seriesRuleMatches(x, t));
  if (!r) return null;
  const ns = live().filter(o => o.installment && E.seriesRuleMatches(r, o)).map(o => o.installment.n);
  return { rule: r, from: Math.min(...ns, t.installment.n), to: t.installment.total };
}

function openTxEditor(id) {
  const t = txById(id); if (!t) return;
  const head = `<span class="eyebrow">${esc(new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }))}${t.time ? ' · ' + esc(t.time) : ''} · ${esc(accName(t.accountId))}</span>
    <h2 style="word-break:break-word">${esc(t.merchant || t.rawDescription)}</h2><p class="money ${t.amount > 0 ? 'in' : ''}" style="font-size:1.25rem;font-weight:700">${t.amount > 0 ? '+' : ''}${brl(t.amount)}</p>
    ${txMetaBits(t).length ? `<p class="small muted" id="ed-meta">${txMetaBits(t).join(' · ')}</p>` : ''}
    <p class="xs faint" style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${esc(t.rawDescription)}</p>`;
  const body = `
    <div class="field cat-picker"><label for="ed-cat">Categoria</label>${catSelect('ed-cat', t.categoryId, { allowNone: true })}${newCatForm('ed', { kind: t.amount > 0 ? 'income' : 'expense' })}</div>
    <label class="remember" for="ed-remember"><input type="checkbox" id="ed-remember" ${rememberDefault(t, t.categoryId) ? 'checked' : ''}><span>Lembrar esta categoria para <b>${esc(t.merchant || t.rawDescription)}</b><br><span class="xs muted">Cria uma regra e categoriza os outros lançamentos desse estabelecimento que estão sem categoria ou vieram do dicionário. Desmarque para mudar só este.</span></span></label>
    <div class="field"><label for="ed-kind">Tipo</label><select id="ed-kind">${EDIT_KIND_LBL.map(([k, v]) => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="xs muted">O tipo acompanha a categoria (Renda → entrada, Investimentos → investimento, demais → gasto; valores positivos em gastos são estornos). Transferência entre suas contas e pagamento de fatura não contam como entrada nem gasto.</span></div>
    ${edTransferHTML(t)}
    <div class="field"><label for="ed-note">Observação</label><input type="text" id="ed-note" value="${esc(t.note || '')}" placeholder="Opcional"></div>
    ${(() => { const sn = seriesNote(t); return sn ? `<p class="xs muted" id="ed-series">Lembrado para esta compra (parcelas ${sn.from}–${sn.to}): ${esc(catLabel(sn.rule.set.categoryId))}.</p>` : ''; })()}
    ${t.amount < 0 && countable(t) ? `<details class="help-d" ${isUncat(t) ? 'open' : ''}><summary>Não sabe o que é? Pesquise</summary>${lookupHelpHTML(t, 'ed')}</details>` : ''}
    ${t.amount < 0 && countable(t) && t.categoryId !== NAO_ID ? `<div class="row"><button class="btn sm" type="button" data-act="ed-unid" data-id="${esc(t.id)}" id="ed-unid">Não sei o que é</button><span class="xs muted grow">Conta como gasto em "Não identificado". Dá para rever depois em Transações.</span></div>` : ''}
    ${t.catSource ? `<p class="xs muted">Categoria atual veio de: ${esc(SRC_LBL[t.catSource] || t.catSource)}.</p>` : ''}
    <div class="row end"><button class="btn" type="button" data-act="closesheet">Cancelar</button><button class="btn primary" type="button" data-act="savetx" data-id="${esc(t.id)}">Salvar</button></div>`;
  openSheet(head, body, null, { kind: 'editor', id: t.id, label: 'Editar lançamento' });
}

/**
 * Sets a category on one transaction (manual) and optionally remembers it for the merchant:
 * creates/updates a learned rule and re-classifies the merchant's other uncategorized / dictionary transactions
 * (never manual ones). Returns an undo record { txs: [previous records], rules, history, created, n }.
 */
function setCategory(t, catId, opts) {
  opts = opts || {};
  const d = D();
  const before = [clone(t)];
  const prevRules = clone(d.rules || []), prevHistory = clone(d.history || []);
  const upd = Object.assign({}, t, { categoryId: catId || null, catSource: catId ? 'manual' : null });
  if (opts.kind) upd.kind = opts.kind;
  else if (catId) { const k = kindFor(catId); if (k && countable(t)) upd.kind = k; }
  if (opts.note !== undefined) { if (opts.note) upd.note = opts.note; else delete upd.note; }
  const changed = [upd];
  let created = null, ruleChanged = false;
  if (catId && opts.remember) {
    const r = eng('learnFromCorrection', t, catId, d.rules, d.history, { immediate: true, categories: d.categories });
    if (r && Array.isArray(r.rules)) { d.rules = r.rules; created = r.created || r.existing || null; ruleChanged = !!r.created; }
    if (d.history.length > 500) d.history = d.history.slice(-500);
    // re-classify the same merchant's other transactions that are uncategorized or dictionary-classified
    const m = normU(t.merchant);
    const c = ctx();
    for (const o of live()) {
      if (o.id === t.id || normU(o.merchant) !== m) continue;
      if (o.catSource && o.catSource !== 'dictionary') continue; // never overwrite manual / rule / learned
      if (!countable(o)) continue;
      const cl = eng('classify', Object.assign({}, o, { catSource: null, categoryId: null }), c);
      if (!cl || cl.catSource !== 'learned' || cl.categoryId !== catId) continue;
      before.push(clone(o));
      const k = kindFor(catId);
      changed.push(Object.assign({}, o, { categoryId: catId, catSource: 'learned', kind: k || o.kind }));
    }
  }
  // "Lembrar" unticked on a parcela: remember the category for THIS purchase only (its series of parcelas)
  let series = null;
  if (catId && !opts.remember && t.installment && countable(t)) {
    const r = eng('rememberInstallmentSeries', t, catId, d.rules, { now: nowISO() });
    const rule = r && (r.created || r.existing);
    if (rule) {
      if (r.created) { d.rules = r.rules; ruleChanged = true; }
      const ns = [t.installment.n];
      for (const o of live()) {
        if (o.id === t.id || !o.installment || o.catSource === 'manual' || !countable(o)) continue;
        if (!E.seriesRuleMatches(rule, o)) continue;
        ns.push(o.installment.n);
        if (o.categoryId === catId && o.catSource === 'series') continue;
        before.push(clone(o));
        const k = kindFor(catId);
        changed.push(Object.assign({}, o, { categoryId: catId, catSource: 'series', kind: k || o.kind }));
      }
      series = { from: Math.min(...ns), to: t.installment.total, n: ns.length - 1 };
    }
  }
  commit({ txs: changed, meta: ruleChanged || created ? ['rules'] : [] });
  return { txs: before, rules: ruleChanged ? prevRules : null, history: ruleChanged ? prevHistory : null, created: ruleChanged && opts.remember ? created : null, n: changed.length - 1, series };
}
const seriesLabel = sr => sr ? 'lembrado para esta compra (parcelas ' + sr.from + '–' + sr.to + ')' : '';
function saveTxEdit(id) {
  const t = txById(id); if (!t) return;
  let cat = ($('#ed-cat') || {}).value || null;
  if (cat === '__new') { toast('Termine de criar a categoria ou escolha uma existente.', true); return false; }
  const kind = ($('#ed-kind') || {}).value || t.kind;
  const note = (($('#ed-note') || {}).value || '').trim();
  const remember = !!($('#ed-remember') || {}).checked;
  // v2.5: a transfer between your accounts — the other account, the counterpart row, "Lembrar" for the counterparty
  if (kind === 'transfer') {
    const accId = ($('#ed-tr-acc') || {}).value || '';
    if (!accId) { toast('Escolha a outra conta (ou "Conta não cadastrada").', true); const s0 = $('#ed-tr-acc'); if (s0) s0.focus(); return false; }
    const pr = document.querySelector('input[name="ed-tr-pair"]:checked');
    const res = setTransfer(Object.assign({}, t, note ? { note } : {}), accId, pr && pr.value ? pr.value : null, !!($('#ed-tr-remember') || {}).checked);
    const other = pr && pr.value ? txById(pr.value) : null;
    toast('Transferência ' + (t.amount < 0 ? 'para ' : 'de ') + (accId === 'external' ? 'conta não cadastrada' : accName(accId)) + (other ? ' · par ligado' : '') + (res.n ? ' · +' + res.n + ' pela regra' : ''), false, { label: 'Desfazer', fn: undoRecord(res) });
    return true;
  }
  if (kind === 'card_payment') {
    const card = ($('#ed-card') || {}).value || '';
    const before = clone(t);
    const upd = Object.assign({}, t, { kind: 'card_payment', categoryId: null, catSource: 'manual' });
    if (card) upd.cardAccountId = card; else delete upd.cardAccountId;
    if (note) upd.note = note; else delete upd.note;
    commit({ txs: [upd] });
    toast('Pagamento de fatura' + (card ? ' · ' + accName(card) : ''), false, { label: 'Desfazer', fn: () => { commit({ txs: [before] }); toast('Desfeito'); } });
    return true;
  }
  // leaving "transfer": the row stops pointing at its pair (and the pair at it)
  if (t.kind === 'transfer' && kind !== 'transfer' && (t.linkedTo || t.transferAccountId)) {
    const o = t.linkedTo && txById(t.linkedTo);
    if (o && o.linkedTo === t.id) { const o2 = Object.assign({}, o); delete o2.linkedTo; commit({ txs: [o2], render: false }); }
    const t2 = Object.assign({}, t, { kindSource: 'manual' }); ['linkedTo', 'transferAccountId', 'transferSubtype', 'transferSource', 'transferBank'].forEach(k => delete t2[k]);
    commit({ txs: [t2], render: false });
    return saveTxEdit(id);
  }
  const changedCat = cat !== (t.categoryId || null);
  let res = null;
  if (changedCat && cat) noteRememberChoice(cat, remember, rememberDefault(t, cat));
  if (changedCat) res = setCategory(t, cat, { kind, note, remember });
  else {
    const upd = Object.assign({}, t, { kind });
    if (note) upd.note = note; else delete upd.note;
    if (kind !== t.kind && !upd.categoryId) upd.catSource = 'manual';
    if (kind !== t.kind) upd.kindSource = 'manual'; // v2.5: the automatic transfer detection never flips it back
    commit({ txs: [upd] });
  }
  const bits = ['Salvo'];
  if (res && res.created) bits.push('regra aprendida para ' + (t.merchant || ''));
  if (res && res.series) bits.push(seriesLabel(res.series));
  else if (res && res.n) bits.push(res.n + ' outro' + (res.n > 1 ? 's' : '') + ' de ' + t.merchant);
  toast(bits.join(' · '));
  return true;
}

/* ================= TRIAGEM ================= */
const TRI = { queue: [], idx: 0, done: 0, total: 0, start: 0, timer: null, streak: 0, group: null, undo: [], newCat: false, remember: true, touched: false, trPick: false };
function startTriage() {
  const q = live().filter(isUncat).sort((a, b) => b.date.localeCompare(a.date));
  if (!q.length) { toast('Nada para classificar.'); return; }
  Object.assign(TRI, { queue: q.map(t => t.id), idx: 0, done: 0, total: q.length, start: Date.now(), streak: 0, group: null, undo: [], newCat: false, remember: true, touched: false, trPick: false });
  closeSheet(); renderTriage();
  clearInterval(TRI.timer); TRI.timer = setInterval(tickTriage, 1000);
  document.body.style.overflow = 'hidden';
}
function stopTriage() {
  clearInterval(TRI.timer); $('#triage-root').innerHTML = ''; document.body.style.overflow = '';
  TRI.undo = [];
  renderAfterChange(false);
}
function triageLeft() { return Math.max(0, 600 - Math.floor((Date.now() - TRI.start) / 1000)); }
function tickTriage() {
  const el = $('#tri-timer'); if (!el) { clearInterval(TRI.timer); return; }
  const s = triageLeft(); el.textContent = Math.floor(s / 60) + ':' + pad2(s % 60); el.classList.toggle('low', s < 60);
  if (s === 0) { clearInterval(TRI.timer); renderTriage(true); }
}
function likelyGroups(t) {
  const kind = t.amount > 0 ? 'income' : 'expense';
  const freq = {}; live().forEach(x => { if (x.categoryId) { const g = String(x.categoryId).split('.')[0]; freq[g] = (freq[g] || 0) + 1; } });
  const sug = eng('classify', t, ctx()); const sugG = sug && sug.categoryId ? String(sug.categoryId).split('.')[0] : null;
  const own = (D().categories || []).filter(g => (g.kind || 'expense') === kind && !((g.children || []).length && (g.children || []).every(c => c.id === NAO_ID)));
  const other = t.amount > 0 ? (D().categories || []).filter(g => (g.kind || 'expense') !== kind) : [];
  return own.sort((a, b) => ((b.id === sugG) - (a.id === sugG)) || ((freq[b.id] || 0) - (freq[a.id] || 0))).concat(other).slice(0, 10);
}
function triageCurrent() {
  while (TRI.idx < TRI.queue.length) { const t = txById(TRI.queue[TRI.idx]); if (t && isUncat(t)) return t; TRI.idx++; }
  return null;
}
function triageRemoteRefresh() {
  // a remote change while sorting: keep the card unless it was categorized elsewhere
  const t = TRI.queue[TRI.idx] && txById(TRI.queue[TRI.idx]);
  if (!t || !isUncat(t)) renderTriage();
}
function pushUndo(entry) { TRI.undo.push(entry); if (TRI.undo.length > 50) TRI.undo.shift(); }
function renderTriage(timeUp) {
  const root = $('#triage-root');
  const t = triageCurrent();
  const finished = !t;
  const left = triageLeft();
  const last = TRI.undo[TRI.undo.length - 1];
  const undoBtn = last ? `<button class="undo-btn" type="button" data-act="tri-undo" id="tri-undo" title="Desfazer: ${esc(last.label)}"><span aria-hidden="true">↶</span><span>Desfazer: ${esc(last.label)}</span>${TRI.undo.length > 1 ? `<span class="tag">${TRI.undo.length}</span>` : ''}</button>` : '';
  const head = `<div class="tri-top"><button class="btn sm" type="button" data-act="tri-close">Sair</button><div class="grow"></div><span class="streak" ${TRI.streak < 3 ? 'hidden' : ''}>Sequência ${TRI.streak}</span><span class="timer ${left < 60 ? 'low' : ''}" id="tri-timer" aria-label="Tempo restante">${Math.floor(left / 60)}:${pad2(left % 60)}</span></div>
    <div><div class="row" style="justify-content:space-between"><b id="tri-progress">${TRI.done} de ${TRI.total} classificadas</b><span class="small muted">sprint de 10 minutos</span></div><div class="prog" style="margin-top:6px"><i style="width:${(TRI.done / Math.max(1, TRI.total) * 100).toFixed(1)}%"></i></div></div>
    ${undoBtn ? `<div class="row">${undoBtn}</div>` : ''}`;
  if (finished || timeUp) {
    const rest = uncatCount();
    root.innerHTML = `<div class="triage" role="dialog" aria-modal="true" aria-label="Modo triagem"><div class="triage-in">${head}
      <div class="tri-card" style="text-align:center;align-items:center" id="tri-done"><span class="eyebrow">${timeUp && !finished ? 'Tempo esgotado' : 'Fila zerada'}</span><div class="big">${TRI.done} classificada${TRI.done === 1 ? '' : 's'}</div>
      <p class="muted">${rest ? `Faltam ${rest}. As regras aprendidas já cuidam das próximas compras desses lugares.` : 'Nenhum lançamento sem categoria. Os próximos extratos vão chegar mais organizados.'}</p></div>
      <div class="row">${rest && timeUp ? '<button class="btn" type="button" data-act="triage">Mais 10 minutos</button>' : ''}<button class="btn primary grow" type="button" data-act="tri-close" id="tri-finish">Ver painel</button></div></div></div>`;
    return;
  }
  const sameN = live().filter(x => isUncat(x) && normU(x.merchant) === normU(t.merchant)).length;
  const sugs = (eng('suggestCategories', t, Object.assign(ctx(), { transactions: live() })) || []).filter(s => catIndex()[s.categoryId]).slice(0, 4);
  const amb = eng('ambiguousMatch', t, ctx());
  let choices;
  if (TRI.trPick) {
    // v2.5 "É transferência minha": which other account? (a likely counterpart row is shown and linked)
    const accs = (D().accounts || []).filter(a => a.id !== t.accountId && a.type !== 'payslip' && a.type !== 'credit_card');
    const cands = transferCandidates(t);
    choices = `<div class="row"><button class="btn ghost sm" type="button" data-act="tri-tr-back">‹ Voltar</button><b>${t.amount < 0 ? 'Para qual conta sua?' : 'De qual conta sua?'}</b></div><div class="tri-grid" id="tri-tr-accs">
      ${accs.map(a => { const c = cands.find(o => o.accountId === a.id); return `<button type="button" class="tri-btn sub" data-act="tri-tr-acc" data-acc="${esc(a.id)}"${c ? ` data-pair="${esc(c.id)}"` : ''}><span class="sw" style="background:var(--accent)"></span><span>${esc(a.name)}${c ? `<br><span class="xs muted">par: ${esc(isoToDM(c.date))} · ${esc(brl(c.amount))}</span>` : ''}</span></button>`; }).join('')}
      <button type="button" class="tri-btn sub" data-act="tri-tr-acc" data-acc="external" id="tri-tr-ext"><span class="sw" style="background:var(--line-2)"></span>Conta não cadastrada</button></div>`;
  } else if (TRI.newCat) {
    choices = newCatForm('tri', { open: true, kind: t.amount > 0 ? 'income' : 'expense' });
  } else if (TRI.group) {
    const g = (D().categories || []).find(x => x.id === TRI.group);
    const off = new Set(settingsObj().rememberOff || []);
    const onlyThis = id => !TRI.touched && off.has(id) ? ' <span class="xs faint" title="Da última vez você desmarcou Lembrar para esta categoria">· só este</span>' : '';
    choices = `<div class="row"><button class="btn ghost sm" type="button" data-act="tri-back">‹ Grupos</button><b>${esc(g.name)}</b></div><div class="tri-grid">
      ${(g.children || []).map(c => `<button type="button" class="tri-btn sub" data-act="tri-pick" data-cat="${esc(c.id)}"><span class="sw" style="background:${esc(g.color)}"></span>${esc(c.name)}${onlyThis(c.id)}</button>`).join('')}
      <button type="button" class="tri-btn sub" data-act="tri-pick" data-cat="${esc(g.id)}"><span class="sw" style="background:${esc(g.color)};opacity:.4"></span>${esc(g.name)} (geral)</button></div>`;
  } else {
    choices = `${sugs.length ? `<div class="field"><span class="lbl">${amb ? 'Sugestões (estabelecimento ambíguo: ' + esc(amb.note || amb.pattern) + ')' : 'Sugestões'}</span><div class="sug-row" id="tri-sugs">${sugs.map(s => { const g = groupOf(s.categoryId); return `<button type="button" class="sug-btn" data-act="tri-pick" data-cat="${esc(s.categoryId)}" title="${esc(s.reason)}"><span class="sw" style="background:${esc(g ? g.color : 'var(--accent)')}"></span>${esc(catLabel(s.categoryId))}</button>`; }).join('')}</div></div>` : ''}
      <div class="tri-grid">${likelyGroups(t).map(g => `<button type="button" class="tri-btn" data-act="tri-group" data-g="${esc(g.id)}"><span class="sw" style="background:${esc(g.color)}"></span>${esc(g.name)}</button>`).join('')}
      <button type="button" class="tri-btn" data-act="tri-newcat" id="tri-newcat"><span class="sw" style="background:var(--line-2)"></span>+ Nova categoria</button></div>`;
  }
  const meta = txMetaBits(t);
  root.innerHTML = `<div class="triage" role="dialog" aria-modal="true" aria-label="Modo triagem"><div class="triage-in">${head}
    <div class="tri-card pop" id="tri-card" data-id="${esc(t.id)}"><span class="eyebrow">${esc(new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }))}${t.time ? ' · ' + esc(t.time) : ''} · ${esc(accName(t.accountId))}</span>
      <div class="big">${esc(t.merchant || t.rawDescription)}</div><div class="amt money ${t.amount > 0 ? 'in' : ''}">${brl(t.amount)}</div>
      ${meta.length ? `<div class="tri-meta">${meta.join('<span aria-hidden="true">·</span>')}</div>` : ''}
      <span class="xs faint" style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${esc(t.rawDescription)}</span>
      <label class="remember small" for="tri-remember"><input type="checkbox" id="tri-remember" ${(TRI.touched ? TRI.remember : !amb) ? 'checked' : ''}><span>Lembrar esta categoria para <b>${esc(t.merchant || t.rawDescription)}</b>${sameN > 1 ? ` <span class="faint">(e as outras ${sameN - 1} sem categoria)</span>` : ''}${amb && !TRI.touched ? '<br><span class="xs muted">Desmarcado: este estabelecimento vende de tudo.</span>' : ''}${t.installment ? '<br><span class="xs muted">Desmarcado, a categoria vale só para esta compra parcelada.</span>' : ''}</span></label>
      ${t.amount < 0 ? `<details class="help-d"><summary>Não sabe o que é? Pesquise</summary>${lookupHelpHTML(t, 'tri')}</details>` : ''}</div>
    ${choices}
    <div class="row"><button class="btn grow" type="button" data-act="tri-skip">Pular</button><button class="btn grow" type="button" data-act="tri-transfer" id="tri-transfer">É transferência minha</button>${t.amount < 0 ? '<button class="btn grow" type="button" data-act="tri-unid" id="tri-unid" title="Conta como gasto em &quot;Não identificado&quot; e sai da fila">Não sei o que é</button>' : ''}</div>
  </div></div>`;
}
const triState = () => ({ idx: TRI.idx, done: TRI.done, streak: TRI.streak });
function triagePick(catId, extra) {
  const t = triageCurrent(); if (!t) return;
  const box = $('#tri-remember');
  const def = rememberDefault(t, catId);
  const remember = TRI.touched && box ? box.checked : def;
  if (TRI.touched) noteRememberChoice(catId, remember, def);
  const st = triState();
  const before = uncatCount();
  const res = setCategory(t, catId, Object.assign({ remember }, extra || {}));
  const after = uncatCount();
  const label = catLabel(catId) + ' para ' + (t.merchant || t.rawDescription) + (res.created ? ' + regra' : '') + (res.series ? ' · ' + seriesLabel(res.series) : (res.n ? ' (+' + res.n + ')' : ''));
  if (res.series) toast(seriesLabel(res.series).replace(/^./, c => c.toUpperCase()));
  TRI.touched = false;
  pushUndo({ label, txs: res.txs, rules: res.rules, history: res.history, tri: st });
  TRI.done = Math.min(TRI.total, TRI.done + Math.max(1, before - after)); TRI.streak++; TRI.group = null; TRI.newCat = false; TRI.trPick = false; TRI.idx++;
  renderTriage();
}
/** "Não sei o que é": built-in category "Não identificado" — counts as spending and leaves the queue for good */
function triageUnid() {
  const t = triageCurrent(); if (!t) return;
  triagePick(NAO_ID, { kind: 'expense' }); // always spending, whatever group holds the category
}
function editorUnid(id) {
  const t = txById(id); if (!t) return;
  const d = D();
  const res = setCategory(t, NAO_ID, { remember: false, kind: 'expense' });
  closeSheet();
  toast('Marcado como "Não identificado"', false, { label: 'Desfazer', fn: () => {
    const meta = [];
    if (res.rules) { d.rules = res.rules; meta.push('rules'); }
    if (res.history) d.history = res.history;
    commit({ txs: (res.txs || []).map(x => clone(x)), meta });
    toast('Desfeito');
  } });
}
function triageSkip() {
  const t = triageCurrent(); if (!t) return;
  pushUndo({ label: 'Pular ' + (t.merchant || t.rawDescription), txs: [], tri: triState() });
  TRI.idx++; TRI.streak = 0; TRI.group = null; TRI.newCat = false; TRI.touched = false; TRI.trPick = false; renderTriage();
}
function triageTransfer() {
  const t = triageCurrent(); if (!t) return;
  TRI.trPick = true; TRI.group = null; TRI.newCat = false; renderTriage();
}
/** "É transferência minha" → the other account (or "Conta não cadastrada"); the counterpart row found there is linked */
function triageTransferTo(accId, pairId) {
  const t = triageCurrent(); if (!t) return;
  const st = triState();
  const before = uncatCount();
  // "Lembrar" ticked: the counterparty (a person's name, never a company) becomes a transfer rule — like a category
  const rb = $('#tri-remember'); const cp = E.counterparty ? E.counterparty(t) : null;
  const res = setTransfer(t, accId, pairId || null, !!(rb && rb.checked && cp && cp.name && !cp.company));
  pushUndo({ label: 'Transferência: ' + (t.merchant || t.rawDescription), txs: res.txs, rules: res.rules, tri: st });
  TRI.done = Math.min(TRI.total, TRI.done + Math.max(1, before - uncatCount())); TRI.streak++; TRI.idx++; TRI.group = null; TRI.newCat = false; TRI.touched = false; TRI.trPick = false; renderTriage();
}
function triageUndo() {
  const u = TRI.undo.pop(); if (!u) return;
  const d = D();
  const meta = [];
  if (u.rules) { d.rules = u.rules; meta.push('rules'); }
  if (u.history) d.history = u.history;
  // restored records get a fresh updatedAt so the merge on the server keeps the undo
  commit({ txs: (u.txs || []).map(t => clone(t)), meta });
  Object.assign(TRI, u.tri, { group: null, newCat: false, touched: false, trPick: false });
  renderTriage();
  toast('Desfeito: ' + u.label);
}
/* ================= IMPORTAR ================= */
/* file pickers: some Android WebViews do not implement the file chooser, so the tap does nothing. Detected by UA up
   front, and at runtime (Android only): a tap on the picker that within 1.5 s neither hides/blurs the page nor fires
   change (nor a later cancel) counts as "picker did not open". The only effect is that the paste section opens (no text). */
const FILE_ACCEPT = '.csv,.txt,.tsv,.xlsx,.xls,.pdf,.zip,text/*,application/pdf,application/zip,application/x-zip-compressed,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream';
const BACKUP_ACCEPT = '.json,application/json,text/*,application/octet-stream';
const UA = navigator.userAgent || '';
const IS_ANDROID = /Android/i.test(UA);
const IS_ANDROID_WV = IS_ANDROID && (/; wv\)/.test(UA) || /Version\/\d+\.\d+ Chrome\//.test(UA));
const PICK = { failed: false, armed: null };
const pickerBlocked = () => IS_ANDROID_WV || PICK.failed;
function armPicker(id) {
  if (id !== 'imp-file' || !IS_ANDROID || IS_ANDROID_WV || PICK.armed) return;
  const st = { id, opened: false, at: Date.now() };
  const mark = () => { st.opened = true; };
  const onVis = () => { if (document.visibilityState === 'hidden') mark(); };
  // a "cancel" right after the tap, with the page never hidden/blurred, is the WebView refusing the chooser
  const onCancel = () => { if (!st.opened && Date.now() - st.at < 500) { clearTimeout(st.t); done(); } else mark(); };
  const inp = document.getElementById(id);
  window.addEventListener('blur', mark); document.addEventListener('visibilitychange', onVis);
  if (inp) { inp.addEventListener('change', mark); inp.addEventListener('cancel', onCancel); }
  PICK.armed = st;
  const done = () => {
    window.removeEventListener('blur', mark); document.removeEventListener('visibilitychange', onVis);
    if (inp) { inp.removeEventListener('change', mark); inp.removeEventListener('cancel', onCancel); }
    PICK.armed = null;
    if (st.opened || PICK.failed) return;
    PICK.failed = true;
    if (S.imp) S.imp.pasteOpen = true;
    const box = $('#imp-paste-box'); if (box) box.open = true;
  };
  st.t = setTimeout(done, 1500);
}
/** reads a File's bytes; falls back to FileReader when Blob.arrayBuffer is missing or fails (some WebViews) */
async function readBytes(file) {
  try { if (file.arrayBuffer) return new Uint8Array(await file.arrayBuffer()); } catch (e) { /* fall through */ }
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result));
    fr.onerror = () => reject(new Error('o sistema não liberou o conteúdo do arquivo; tente de novo ou cole o conteúdo'));
    try { fr.readAsArrayBuffer(file); } catch (e) { reject(new Error('o sistema não liberou o conteúdo do arquivo; tente de novo ou cole o conteúdo')); }
  });
}
/** 'xlsx' | 'text' | error message: by extension first, then by content (Android may hand over odd names/MIME types) */
function tableFileKind(file, bytes) { return E.fileKindOf(file.name, bytes); }
/** ZIP of statements (a bank's "download all"): its CSV/XLSX/PDF files go to the list as if chosen one by one */
async function inflateRaw(raw) {
  if (typeof DecompressionStream === 'undefined') { const e = new Error('zip_browser'); e.code = 'zip_browser'; throw e; }
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
async function expandArchives(files) {
  const out = [], errs = [];
  for (const f of files) {
    let buf = null;
    try { buf = await readBytes(f); } catch (e) { out.push(f); continue; }
    if (tableFileKind(f, buf) !== 'zip') { out.push(f); continue; }
    try {
      const ents = await E.unzipEntries(buf, { inflate: inflateRaw });
      if (!ents.length) errs.push('"' + f.name + '" não tem extratos (CSV, XLSX, PDF) dentro.');
      for (const en of ents) out.push(new File([en.bytes], en.name));
    } catch (e) { errs.push('Não consegui abrir "' + f.name + '": ' + fileErrMsg(e)); }
  }
  return { files: out, errs };
}
function newImp(){ return { fxRates:{}, pdf:null, pdfPw:null, tab:'arquivo', step:1, accountId: defaultAccountId(), newAcc:{ name:'', type:'credit_card' }, paste:'', fileName:'', encoding:'', analysis:null, profile:null, matched:null, result:null, dedup:null, checksum:'', layoutName:'', ai:null, aiProblems:[], done:null, hol:null, importId:null, err:'', pasteOpen:false, reading:'', fromPaste:false, pasted:0 }; }
function defaultAccountId(){ const a = (S.mode==='real' && S.real ? S.real.accounts : []).filter(a=>a.type!=='payslip'); return a.length ? a[0].id : '__new'; }
function renderImport(){
  if(!S.imp) S.imp = newImp();
  const I = S.imp; const el = $('#scr-import');
  const tabs = `<div class="seg" role="group" aria-label="Tipo de importação" style="align-self:flex-start"><button type="button" data-act="imp-tab" data-t="arquivo" aria-pressed="${I.tab==='arquivo'}">Extrato ou fatura</button><button type="button" data-act="imp-tab" data-t="holerite" aria-pressed="${I.tab==='holerite'}">Holerite</button></div>`;
  if(I.tab==='holerite'){ el.innerHTML = `<h2 style="font-size:1.35rem">Importar</h2>${tabs}<div id="hol"></div>`; renderHolerite(); return; }
  if(I.batch && !I.batchKey){ el.innerHTML = `<h2 style="font-size:1.35rem">Importar</h2>${tabs}<div id="imp-body" class="screen"></div>`; renderBatch($('#imp-body')); return; }
  const stepNames = ['Arquivo','Detecção','Conferência','Salvar'];
  const steps = `<ol class="steps" aria-label="Etapas">${stepNames.map((n,i)=>`<li class="${I.step===i+1?'on':I.step>i+1?'done':''}" ${I.step===i+1?'aria-current="step"':''}>${i+1}. ${n}</li>`).join('')}</ol>`;
  el.innerHTML = `<h2 style="font-size:1.35rem">Importar</h2>${tabs}${I.done?'':steps}<div id="imp-body" class="screen"></div>`;
  const b = $('#imp-body');
  if(I.done) return renderImportDone(b);
  if(I.step===1) renderStep1(b); else if(I.step===2) renderStep2(b); else if(I.step===3) renderStep3(b); else renderStep4(b);
}
function accountSelect(id, sel, includePayslip){
  const accs = (S.mode==='real'&&S.real?S.real.accounts:[]).filter(a=>includePayslip || a.type!=='payslip');
  return `<select id="${id}">${accs.map(a=>`<option value="${esc(a.id)}" ${sel===a.id?'selected':''}>${esc(a.name)} · ${esc(ACC_TYPES[a.type]||a.type)}</option>`).join('')}<option value="__new" ${sel==='__new'?'selected':''}>Nova conta ou cartão…</option></select>`;
}
function renderStep1(b){
  const I = S.imp;
  b.innerHTML = `
    <div class="card">
      <h3>De qual conta é este arquivo?</h3>
      ${I.alertNote ? `<p class="small al-note" id="imp-alert-note">${esc(I.alertNote)}</p>` : ''}
      <p class="xs muted">Vários arquivos de uma vez? Escolha todos abaixo: esta conta vale para todos, e dá para trocar só a de um arquivo.</p>
      <div class="field"><label for="imp-acc">Conta</label>${accountSelect('imp-acc', I.accountId)}</div>
      <div class="form-grid" ${I.accountId==='__new'?'':'hidden'} id="new-acc">
        <div class="field"><label for="imp-acc-name">Nome</label><input type="text" id="imp-acc-name" placeholder="Ex.: Nubank cartão" value="${esc(I.newAcc.name)}"></div>
        <div class="field"><label for="imp-acc-type">Tipo</label><select id="imp-acc-type">${NEW_ACC_TYPES.map(k=>`<option value="${k}" ${I.newAcc.type===k?'selected':''}>${ACC_TYPES[k]}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="card">
      <h3>Envie o arquivo</h3>
      <input type="file" id="imp-file" class="file-in" multiple accept="${FILE_ACCEPT}">
      <label class="drop" id="drop" for="imp-file">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 15v4h14v-4"/></svg>
        <b>Escolher arquivos</b><span class="small muted">PDF, CSV, TXT, TSV, XLSX ou XLS do seu banco, cartão ou vale (VA/VR) — um ou vários (faturas e extratos de meses diferentes)</span><span class="xs faint drop-hint">No computador, também dá para arrastar os arquivos para cá.</span>
      </label>
      ${I.reading?`<p class="row small" id="imp-reading"><span class="spinner"></span> <span id="imp-reading-t">${esc(I.reading)}</span></p>`:''}
      ${I.pdfPw && !I.reading ? `<div class="pdf-pw" id="imp-pdf-pw-box"><b class="small">"${esc(I.pdfPw.file.name)}" tem senha</b>
        <div class="field"><label for="imp-pdf-pw">Senha do PDF</label><input type="password" id="imp-pdf-pw" autocomplete="off" inputmode="text" spellcheck="false" ${I.pdfPw.wrong ? 'aria-invalid="true"' : ''}></div>
        ${I.pdfPw.wrong ? '<p class="small out" id="imp-pdf-pw-err" role="alert">Senha incorreta. Confira e tente de novo.</p>' : ''}
        <p class="xs muted">Muitos bancos usam os números do CPF (só os dígitos) ou parte deles. A senha só abre o arquivo aqui no navegador e não é guardada.</p>
        <div class="row end"><button class="btn" type="button" data-act="imp-pdf-pw-cancel">Cancelar</button><button class="btn primary" type="button" data-act="imp-pdf-pw" id="imp-pdf-pw-go">Abrir PDF</button></div></div>` : ''}
      ${I.fileName&&!I.reading?`<p class="small muted">Último: ${esc(I.fileName)}</p>`:''}
      <details id="imp-paste-box" ${I.paste||I.pasteOpen||pickerBlocked()?'open':''}><summary>Ou cole o conteúdo do arquivo</summary>
        <div class="field" style="margin-top:10px"><label for="imp-paste">Abra o arquivo (ou o extrato no internet banking), copie tudo e cole aqui. Vários arquivos? Um de cada vez.</label><textarea id="imp-paste" spellcheck="false" autocomplete="off" placeholder="Data;Descrição;Valor&#10;05/09/2026;IFOOD *RESTAURANTE;-54,90">${esc(I.paste)}</textarea></div>
        ${I.pasted?`<p class="xs muted" id="imp-pasted">${I.pasted} arquivo${I.pasted===1?'':'s'} colado${I.pasted===1?'':'s'} já importado${I.pasted===1?'':'s'}.</p>`:''}
        <div class="row end" style="margin-top:8px"><button class="btn primary" type="button" data-act="imp-paste" ${I.reading?'disabled':''}>Analisar texto colado</button></div>
      </details>
      ${I.err?`<div class="banner err"><div>${esc(I.err)}</div></div>`:''}
    </div>
    <p class="small faint">O arquivo é lido aqui no navegador. Nada é enviado para fora sem você pedir.</p>`;
}
function resolveAccount(){
  const I = S.imp;
  const sel = $('#imp-acc'); if(sel) I.accountId = sel.value;
  if(I.accountId!=='__new') return I.accountId;
  const nm = ($('#imp-acc-name')||{}).value || I.newAcc.name; const tp = ($('#imp-acc-type')||{}).value || I.newAcc.type;
  I.newAcc = { name:nm, type:tp };
  if(!nm.trim()){ I.err = 'Dê um nome para a conta nova (ex.: "Nubank cartão").'; return null; }
  return '__new';
}
function commitNewAccount(){
  const I = S.imp; if(I.accountId!=='__new') return I.accountId;
  ensureReal();
  const id = addAccount(I.newAcc.name, I.newAcc.type);
  I.accountId = id; return id;
}
async function handleFile(file, password){
  const I = S.imp; I.err = ''; I.pdfPw = null;
  if(!resolveAccount()){ renderImport(); return; }
  I.fileName = file.name; I.fromPaste = false;
  I.reading = 'Lendo arquivo…'; renderImport();
  try{
    const r = await readFileAnalysis(file, { password, onPage: (i, n) => setReading('Lendo PDF… página ' + i + ' de ' + n) });
    password = null;
    I.reading = '';
    if(!r.analysis || !Array.isArray(r.analysis.rows)) throw new Error('não reconheci uma tabela');
    I.encoding = r.encoding;
    startAnalysis(r.analysis);
  }catch(e){
    password = null; I.reading = '';
    if(e && (e.code==='pdf_password' || e.code==='pdf_password_wrong')){ I.pdfPw = { file, wrong: e.code==='pdf_password_wrong' }; renderImport(); const pw = $('#imp-pdf-pw'); if(pw) pw.focus(); return; }
    I.err = 'Não consegui abrir "'+file.name+'": '+fileErrMsg(e); renderImport();
  }
}
function setReading(txt){ if(S.imp) S.imp.reading = txt; const el = $('#imp-reading-t'); if(el) el.textContent = txt; const b = $('#bf-busy-t'); if(b) b.textContent = txt; }
/** pt-BR message for a file that could not be read (PDF error codes from FinEngine.readPdf) */
function fileErrMsg(e){
  const c = e && e.code;
  if(c==='pdf_no_text') return 'este PDF é só imagem (foi digitalizado ou salvo como foto) e não tem texto para ler. Ainda não dá para importar PDFs assim: baixe o PDF original no app ou site do banco, ou exporte em CSV/XLSX.';
  if(c==='pdf_password_wrong') return 'senha do PDF incorreta.';
  if(c==='pdf_invalid') return 'o arquivo não parece um PDF válido (corrompido ou incompleto).';
  if(c==='pdf_load_cdn') return 'o leitor de PDF não carregou: nem o cdnjs nem o jsDelivr responderam. Confira a conexão (ou se uma rede/extensão bloqueia esses sites) e tente de novo. Enquanto isso, dá para importar o extrato em CSV/XLSX.';
  if(c==='zip_encrypted') return 'o ZIP tem senha. Extraia os arquivos no computador/celular e escolha-os direto.';
  if(c==='zip_invalid' || c==='zip_method') return 'não consegui abrir este ZIP. Extraia os arquivos e escolha-os direto.';
  if(c==='zip_browser') return 'este navegador não abre ZIP. Extraia os arquivos e escolha-os direto.';
  if(c==='pdf_unavailable' || c==='pdf_load') return 'o leitor de PDF não carregou. Confira a conexão e tente de novo.';
  return (e && e.message || String(e)) + '.';
}
/* ---------- v2.4b: PDF reader (pdf.js 3.11.174) ----------
   Netlify build: same-origin copies in /vendor (CSP script-src 'self'; the parsing runs in a same-origin Web Worker).
   claude.ai Artifact build: the pinned files from cdnjs (allow-listed), loaded only when a PDF is chosen; the worker file
   is loaded as a plain <script> so globalThis.pdfjsWorker exists and pdf.js parses in this thread (no cross-origin worker). */
const PDFJS_VER = '3.11.174';
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/';
// fallback (also on the Artifact allowlist): the same files of the pinned npm package (pdfjs-dist/build/)
const PDFJS_CDN2 = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/';
let _pdfjs = null;
function loadScriptOnce(src, cross, timeoutMs){
  const have = Array.from(document.scripts).find(x => x.src === src);
  if(have && have.dataset.loaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    let timer = null;
    const fail = why => { clearTimeout(timer); el.remove(); const e = new Error('não carregou ' + src + (why ? ' (' + why + ')' : '')); e.code = 'pdf_load'; reject(e); };
    el.src = src; el.async = true; if(cross) el.crossOrigin = 'anonymous';
    el.addEventListener('load', () => { clearTimeout(timer); el.dataset.loaded = '1'; resolve(); }, { once: true });
    el.addEventListener('error', () => fail(''), { once: true });
    if(timeoutMs) timer = setTimeout(() => fail('tempo esgotado'), timeoutMs);
    document.head.appendChild(el);
  });
}
/** the first host that serves the file; each file falls back on its own (cdnjs → jsDelivr) */
async function loadFromCdns(file, check){
  let last = null;
  for(const base of [PDFJS_CDN, PDFJS_CDN2]){
    try { await loadScriptOnce(base + file, true, 60000); if(!check || check()) return base; last = new Error('arquivo incompleto em ' + base); }
    catch(e){ last = e; }
  }
  const e = new Error('o leitor de PDF (pdf.js) não carregou de nenhum dos servidores (cdnjs e jsDelivr)' + (last ? ': ' + last.message : ''));
  e.code = 'pdf_load_cdn';
  throw e;
}
function loadPdfJs(){
  if(_pdfjs) return _pdfjs;
  _pdfjs = (async () => {
    if(window.FINSTORE_BUILD === 'artifact'){
      await loadFromCdns('pdf.min.js', () => window.pdfjsLib && typeof window.pdfjsLib.getDocument === 'function');
      await loadFromCdns('pdf.worker.min.js', () => window.pdfjsWorker && window.pdfjsWorker.WorkerMessageHandler);
    } else {
      await loadScriptOnce(new URL('vendor/pdf.min.js', document.baseURI).href);
      if(window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', document.baseURI).href;
    }
    const lib = window.pdfjsLib;
    if(!lib || typeof lib.getDocument !== 'function'){ const e = new Error('leitor de PDF não carregou'); e.code = 'pdf_load'; throw e; }
    return lib;
  })();
  _pdfjs.catch(() => { _pdfjs = null; });
  return _pdfjs;
}
/** settings.fxRates + the rates typed in this import (not saved yet) */
function fxRatesAll(){
  const base = clone((settingsObj().fxRates) || {}) || {};
  const pend = (S.imp && S.imp.fxRates) || {};
  for(const c of Object.keys(pend)) base[c] = Object.assign({}, base[c] || {}, pend[c]);
  return base;
}
const brDate = iso => iso ? iso.split('-').reverse().join('/') : '—';
/** the fields a PDF adds to the import record (also read by the update alerts: due date, closing, cycle) */
function pdfImportFields(pdf){
  if(!pdf || !pdf.meta) return {};
  const m = pdf.meta; const o = { source: 'pdf', docKind: pdf.kind || null, pages: pdf.pages || null };
  if(m.dueDate) o.dueDate = m.dueDate;
  if(m.cycleStart && m.cycleEnd){ o.cycleStart = m.cycleStart; o.cycleEnd = m.cycleEnd; }
  const close = m.cycleEnd ? addDaysISO(m.cycleEnd, 1) : m.closeDate;
  if(pdf.kind === 'fatura' && close) o.closeDate = close;
  if(m.total != null) o.statementTotal = m.total;
  if(m.cardLast4) o.cardLast4 = m.cardLast4;
  return o;
}
function addDaysISO(iso, k){ const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + k); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
/** after importing a PDF: a card with no closing/due day takes the ones printed on the fatura; a foreign-only file sets
 *  the account currency. -> note for the summary or '' */
function pdfAdoptAccount(accId, pdf, profile){
  const a = (D().accounts || []).find(x => x.id === accId); if(!a) return '';
  let note = '';
  const f = pdfImportFields(pdf);
  if(pdf && pdf.kind === 'fatura' && a.type === 'credit_card' && !a.closingDay && f.closeDate && f.dueDate){
    a.closingDay = +f.closeDate.slice(8, 10); a.dueDay = +f.dueDate.slice(8, 10); a.updatedAt = nowISO();
    note = 'Cartão configurado pela fatura: fecha dia ' + a.closingDay + ', vence dia ' + a.dueDay + '.';
  }
  const cur = profile && profile.currency && profile.currency !== 'BRL' ? profile.currency : null;
  if(cur && a.currency !== cur){ a.currency = cur; a.updatedAt = nowISO(); }
  return note;
}
function saveFxRates(){
  const pend = (S.imp && S.imp.fxRates) || {};
  if(!Object.keys(pend).length) return false;
  const st = settingsObj(); st.fxRates = st.fxRates || {};
  for(const c of Object.keys(pend)) st.fxRates[c] = Object.assign({}, st.fxRates[c] || {}, pend[c]);
  st.updatedAt = nowISO(); S.imp.fxRates = {};
  return true;
}
/** "Ignorado: resumo (12), ofertas de parcelamento (5)…" — the regions of the PDF that did not become rows */
function pdfExcludedHTML(pdf, id){
  const ex = (pdf && pdf.excluded) || [];
  if(!ex.length) return '';
  const total = ex.reduce((n, e) => n + e.count, 0);
  return `<details class="pdf-ex" id="${id || 'pdf-ex'}"><summary>Ignorado: ${ex.map(e => esc(e.label) + ' (' + e.count + ')').join(', ')}</summary>
    <p class="xs muted">${total} linha${total === 1 ? '' : 's'} do PDF não ${total === 1 ? 'virou lançamento' : 'viraram lançamentos'}: resumos, totais, saldos, ofertas, lançamentos futuros e cabeçalhos repetidos. Confira se nada de verdade ficou aqui.</p>
    ${ex.map(e => `<div class="pdf-ex-g" data-reason="${esc(e.reason)}"><b class="small">${esc(e.label[0].toUpperCase() + e.label.slice(1))} · ${e.count}</b>${e.samples.map(x => `<div class="xs faint pdf-ex-l">${esc(x)}</div>`).join('')}${e.count > e.samples.length ? `<div class="xs faint">… e mais ${e.count - e.samples.length}</div>` : ''}</div>`).join('')}</details>`;
}
/** checksum of a PDF: the total the user confirms (pre-filled) vs the rows read (fatura: previous + debits − credits) */
function pdfCheckRead(pdf, total){
  const m = (pdf && pdf.meta) || {};
  if(pdf && pdf.kind === 'fatura') return { read: (m.previousBalance || 0) - (total || 0), prev: m.previousBalance || 0 };
  if(m.openingBalance != null) return { read: m.openingBalance + (total || 0), opening: m.openingBalance };
  return null;
}
function moneyIn(c){ return E.formatBRL ? E.formatBRL(c).replace(/^R\$\s*/, '').replace(/^-R\$\s*/, '-') : String(c / 100); }
function handlePaste(){
  const I = S.imp; I.err = ''; I.paste = ($('#imp-paste')||{}).value || '';
  if(!resolveAccount()){ renderImport(); return; }
  if(!I.paste.trim()){ I.err = 'Cole pelo menos algumas linhas da tabela.'; renderImport(); return; }
  I.fileName = 'texto colado'; I.encoding = 'texto colado'; I.fromPaste = true;
  I.reading = 'Analisando texto colado…'; renderImport();
  // let the spinner paint before the (synchronous) analysis of a large paste
  setTimeout(() => {
    try { const a = eng('analyzeTable', I.paste); I.reading = ''; if(!a || !Array.isArray(a.rows)) throw new Error('não reconheci uma tabela'); startAnalysis(a); }
    catch(e){ I.reading = ''; I.err = 'Não consegui ler o texto colado: '+(e.message||e)+'. Copie desde a linha de títulos (Data, Descrição, Valor…).'; renderImport(); }
  }, 30);
}
function loadXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  const fail = () => new Error('leitor de planilhas não carregou; recarregue a página ou salve como CSV');
  // build do Artifact: SheetJS vem de CDN com async; espera o carregamento em andamento (até 15 s)
  const tag = document.querySelector('script[data-xlsx]');
  if(!tag || tag.dataset.failed) return Promise.reject(fail());
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(t); window.XLSX ? resolve(window.XLSX) : reject(fail()); };
    const t = setTimeout(done, 15000);
    tag.addEventListener('load', done, { once: true });
    tag.addEventListener('error', done, { once: true });
  });
}
function startAnalysis(analysis){
  const I = S.imp;
  if(!analysis || !Array.isArray(analysis.rows)){ I.err = I.err || 'Não reconheci uma tabela neste conteúdo.'; renderImport(); return; }
  I.analysis = analysis; I.ai = null; I.aiProblems = []; I.checksum = '';
  I.pdf = analysis.source === 'pdf' ? analysis.pdf : null;
  if(I.pdf){
    const ck = I.pdf.checksum;
    if(ck && ck.expected != null) I.checksum = moneyIn(ck.expected);
    if(I.accountId === '__new' && I.pdf.accountType && !I.accTypeTouched) I.newAcc.type = I.pdf.accountType;
  }
  I.importId = 'imp-'+Date.now().toString(36);
  const profiles = S.mode==='real' && S.real ? S.real.profiles : [];
  const m = profiles.length ? eng('matchProfile', analysis, profiles) : null;
  I.matched = m || null;
  I.profile = m ? clone(m) : (eng('profileFromAnalysis', analysis) || null);
  if(I.profile) curFromFile(I.profile, analysis);
  I.upgraded = [];
  if(m && I.profile){
    // layouts saved before v2 ignored the Parcela/Hora columns (D1/D2): adopt what the analysis finds now
    // (v2.5: also who paid/received, the transaction type and currency exchange columns)
    const ad = eng('adoptInfoColumns', I.profile, analysis);
    if(ad && ad.added.length){ I.profile = ad.profile; I.upgraded = ad.added.map(r=>ROLE_LBL[r]||r); }
  }
  if(!I.profile){ I.err = 'Não consegui montar a leitura deste layout.'; I.step = 2; renderImport(); return; }
  I.layoutName = m ? m.name : '';
  runPreview();
  I.step = m ? 3 : 2;
  renderImport();
}
function runPreview(){
  const I = S.imp; if(!I.analysis || !I.profile) return;
  const accId = I.accountId==='__new' || !I.accountId ? '__pending' : I.accountId;
  const res = eng('applyProfile', I.analysis.rows, I.profile, { accountId:accId, importId:I.importId, fxRates: fxRatesAll() });
  I.result = res || { transactions:[], errors:[], total:0, needRates:[] };
  const existing = S.mode==='real' ? live() : [];
  const dd = existing.length ? eng('dedupe', existing, I.result.transactions) : null;
  I.dedup = dd || { fresh: I.result.transactions, duplicates: [] };
}
function confColor(c){ return c>=0.8 ? 'var(--in)' : c>=0.6 ? 'var(--warn)' : 'var(--out)'; }
function detBox(k, v, c){ return `<div class="det"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>${c!=null?`<div class="conf" title="Confiança ${Math.round(c*100)}%"><i style="width:${Math.round(c*100)}%;background:${confColor(c)}"></i></div><span class="xs faint">${Math.round(c*100)}% de confiança</span>`:''}</div>`; }
function renderStep2(b){
  const I = S.imp; const a = I.analysis || {};
  const delimName = {';':'Ponto e vírgula ( ; )', ',':'Vírgula ( , )', '\t':'Tabulação', '|':'Barra ( | )'};
  const dateCol = (a.columns||[]).find(c=>c.role==='date');
  const oc = a.overallConfidence!=null ? a.overallConfidence : 1;
  const prompt = (FEATURES.ai && oc<0.7 && S.sample && !I.pdf) ? eng('buildAIPrompt', a) : null;
  if(I.pdf){ renderStep2Pdf(b, oc); return; }
  b.innerHTML = `
    ${I.matched?`<div class="banner info"><div><b>Layout reconhecido: ${esc(I.matched.name)}</b>. Pule direto para a conferência.</div></div>`:''}
    <div class="card">
      <div class="card-h"><h3>O que encontramos em ${esc(I.fileName)}</h3><span class="tag ${oc>=0.8?'ok':oc>=0.7?'warn':'err'}">Confiança geral ${Math.round(oc*100)}%</span></div>
      <div class="det-grid">
        ${detBox('Codificação', I.encoding==='windows-1252'?'Windows-1252 (Latin-1)':I.encoding==='utf-8'?'UTF-8':I.encoding||'—', null)}
        ${a.delimiter!=null?detBox('Separador', delimName[a.delimiter]||JSON.stringify(a.delimiter), a.delimiterConfidence):''}
        ${detBox('Formato numérico', (I.profile.numberFormat||a.numberFormat)==='us'?'1,234.56 (americano)':'1.234,56 (brasileiro)', a.numberFormatConfidence)}
        ${detBox('Formato de data', I.profile.dateFormat||a.dateFormat||'—', dateCol?dateCol.confidence:null)}
        ${detBox('Convenção de sinal', SIGN_LBL[I.profile.signConvention||a.signConvention]||'—', a.signConfidence)}
        ${detBox('Linhas de dados', String(Math.max(0,(a.dataEnd!=null?a.dataEnd+1:a.rows.length)-(a.dataStart??0))), null)}
      </div>
      ${(a.warnings||[]).length?`<div class="banner"><div>${a.warnings.map(w=>esc(w)).join('<br>')}</div></div>`:''}
      ${(a.skippedRows||[]).length?`<details><summary>${a.skippedRows.length} linha${a.skippedRows.length>1?'s':''} ignorada${a.skippedRows.length>1?'s':''} (cabeçalho, rodapé, saldo)</summary>
        <div class="table-wrap" style="margin-top:8px"><table class="pv"><thead><tr><th>Linha</th><th>Motivo</th><th>Conteúdo</th></tr></thead><tbody>${a.skippedRows.slice(0,60).map(s=>`<tr><td class="rn">${s.index+1}</td><td>${esc(s.reason)}</td><td>${esc(s.text)}</td></tr>`).join('')}</tbody></table></div></details>`:''}
    </div>
    ${prompt?`<div class="card" id="ai-card">
      <h3>Layout difícil de ler</h3>
      <p class="small muted">A confiança ficou abaixo de 70%. Você pode ajustar as colunas na próxima etapa ou pedir ao Claude para mapear o layout.</p>
      <div class="sent-box"><b>O que é enviado:</b> só a estrutura das primeiras ~40 linhas, com valores e nomes mascarados. Nenhum dado é salvo pelo Claude.
        <details><summary>Ver o texto exato</summary><pre>${esc(prompt)}</pre></details></div>
      ${I.ai==='busy'?'<p class="row small"><span class="spinner"></span> Analisando…</p>':''}
      ${(I.aiProblems||[]).length?`<div class="banner"><div><b>Pontos para conferir:</b><br>${I.aiProblems.map(esc).join('<br>')}</div></div>`:''}
      <div class="row"><button class="btn" type="button" data-act="imp-ai" data-ai-btn ${I.ai==='busy'?'disabled':''}>Analisar com IA</button></div>
    </div>`:''}
    <div class="row end"><button class="btn" type="button" data-act="imp-back">${I.batchKey?'Voltar à lista':'Voltar'}</button><button class="btn primary" type="button" data-act="imp-step" data-s="3">Conferir prévia</button></div>`;
  if(!FEATURES.ai || !S.sample) $$('[data-ai-btn]').forEach(x=>x.closest('.row').hidden = true);
}
/** step 2 for a PDF: what the layout analysis found (statement kind, dates, totals, pages) + what it left out */
function renderStep2Pdf(b, oc){
  const I = S.imp; const P = I.pdf; const m = P.meta || {};
  const ck = P.checksum;
  const tot = P.kind === 'fatura' ? (m.total != null ? ['Total da fatura', brl(m.total)] : null) : (m.closingBalance != null ? ['Saldo no PDF', brl(m.closingBalance)] : null);
  const chips = [
    ['Tipo', KIND_LBL2[P.kind] || 'Não identificado'],
    ['Páginas', String(P.pages)],
    ['Lançamentos', String(P.records.length)],
    m.dueDate ? ['Vencimento', brDate(m.dueDate)] : null,
    m.cycleStart ? [P.kind === 'fatura' ? 'Compras do ciclo' : 'Período', brDate(m.cycleStart) + ' a ' + brDate(m.cycleEnd)] : null,
    m.issueDate ? ['Emissão', brDate(m.issueDate)] : null,
    tot,
    m.cardLast4 ? ['Cartão', 'final ' + m.cardLast4] : null,
    P.currency && P.currency !== 'BRL' ? ['Moeda', P.currency + ' (conta em moeda estrangeira)'] : null,
    ck ? ['Conferência', ck.ok ? '✓ total bate' : 'diferença de ' + brl(Math.abs(ck.diff))] : null
  ].filter(Boolean);
  b.innerHTML = `
    ${I.matched?`<div class="banner info"><div><b>Layout reconhecido: ${esc(I.matched.name)}</b>. Pule direto para a conferência.</div></div>`:''}
    <div class="card" id="pdf-detect">
      <div class="card-h"><h3>O que encontramos em ${esc(I.fileName)}</h3><span class="tag ${oc>=0.8?'ok':oc>=0.7?'warn':'err'}">Confiança ${Math.round(oc*100)}%</span></div>
      <p class="small muted">PDF lido aqui no navegador: as linhas foram remontadas pela posição do texto (data, descrição, valor, parcela, seção).</p>
      <div class="det-grid">${chips.map(([k, v]) => `<div class="det"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
      ${(I.analysis.warnings||[]).length?`<div class="banner"><div>${I.analysis.warnings.map(esc).join('<br>')}</div></div>`:''}
      ${pdfExcludedHTML(P, 'pdf-ex2')}
    </div>
    <div class="row end"><button class="btn" type="button" data-act="imp-back">${I.batchKey?'Voltar à lista':'Voltar'}</button><button class="btn primary" type="button" data-act="imp-step" data-s="3">Conferir prévia</button></div>`;
}
async function runAIProfile(){
  const I = S.imp; const sample = FEATURES.ai ? S.sample : null;
  if(!sample){ toast('A IA não está disponível nesta visualização.', true); return; }
  const prompt = eng('buildAIPrompt', I.analysis); if(!prompt) return;
  I.ai = 'busy'; renderImport();
  try{
    const json = await sample.json(prompt, { modelTier:'default' });
    const v = eng('validateAIProfile', json, I.analysis);
    if(v && v.profile){ I.profile = v.profile; I.aiProblems = v.problems||[]; I.ai = 'ok'; runPreview(); I.step = 3; toast('Layout sugerido pela IA. Confira a prévia.'); }
    else { I.ai = null; I.aiProblems = (v && v.problems) || ['A resposta não trouxe um mapeamento utilizável.']; }
  }catch(e){
    I.ai = null;
    const msg = { not_granted:'Uso da IA não autorizado.', rate_limited:'Muitas chamadas seguidas. Tente em um minuto.', invalid_json:'A resposta veio num formato inesperado. Tente de novo.', prompt_too_large:'O arquivo é grande demais para a análise.' }[e && e.code] || ('A IA não respondeu ('+(e&&(e.code||e.message)||e)+').');
    I.aiProblems = [msg];
  }
  renderImport();
}
function currentRoles(){
  const roles = {}; const cols = S.imp.profile.columns || {};
  Object.entries(cols).forEach(([role, idx])=>{ if(typeof idx==='number' && idx>=0) roles[idx] = role; });
  (S.imp.analysis.columns||[]).forEach(c=>{ if(roles[c.index]==null && c.role==='balance') roles[c.index]='balance'; });
  return roles;
}
function previewParsed(row){
  const P = S.imp.profile; const c = P.columns||{};
  const cell = i => (typeof i==='number' && i>=0) ? (row[i]||'') : '';
  let date = null, amt = null;
  try{ date = E.parseDate(cell(c.date), P.dateFormat, { referenceYear: Number(S.ui.month.slice(0,4)) }); }catch(e){}
  try{
    if(P.signConvention==='split_columns'){ const d = E.parseAmount(cell(c.debit), P.numberFormat)||0, cr = E.parseAmount(cell(c.credit), P.numberFormat)||0; amt = (cell(c.debit)||cell(c.credit)) ? cr - Math.abs(d) : null; }
    else { amt = E.parseAmount(cell(c.amount), P.numberFormat);
      if(amt!=null && P.signConvention==='positive_is_expense') amt = -amt;
      if(amt!=null && P.signConvention==='dc_flag'){ const f = cell(c.dcFlag).trim().toUpperCase(); amt = /^(D|DEB|-)/.test(f) ? -Math.abs(amt) : Math.abs(amt); } }
  }catch(e){}
  return { date, amt };
}
function renderStep3(b){
  const I = S.imp; const a = I.analysis; const P = I.profile; const R = I.result || {transactions:[],errors:[],total:0};
  const ncol = Math.max(1, ...a.rows.slice(a.dataStart||0, (a.dataStart||0)+30).map(r=>r.length));
  const roles = currentRoles();
  const errBy = {}; (R.errors||[]).forEach(e=>errBy[e.rowIndex]=e);
  const skipBy = {}; (a.skippedRows||[]).forEach(s=>skipBy[s.index]=s);
  const start = a.dataStart||0, end = Math.min(a.rows.length, a.dataEnd!=null ? a.dataEnd+1 : a.rows.length); // engine dataEnd is inclusive
  const maxRows = I.pdf ? 80 : 15;
  const rowsIdx = []; for(let i=start;i<end && rowsIdx.length<maxRows;i++) rowsIdx.push(i);
  // make sure error rows are visible even past the first 15
  (R.errors||[]).forEach(e=>{ if(!rowsIdx.includes(e.rowIndex) && rowsIdx.length<25 && e.rowIndex>=0) rowsIdx.push(e.rowIndex); });
  rowsIdx.sort((x,y)=>x-y);
  const header = a.headerRowIndex!=null ? a.rows[a.headerRowIndex]||[] : [];
  const curLbl = P.currency && P.currency !== 'BRL' ? 'Valor (' + P.currency + ')' : null;
  const roleOpts = sel => Object.entries(ROLE_LBL).map(([k,v])=>`<option value="${k}" ${sel===k?'selected':''}>${k==='amount' && curLbl ? curLbl : v}</option>`).join('');
  const nDup = (I.dedup.duplicates||[]).length, nErr = (R.errors||[]).length, nFresh = (I.dedup.fresh||[]).length, nAll = (R.transactions||[]).length;
  const ck = I.checksum ? parseMoney(I.checksum) : null;
  let ckHtml = '';
  const pck = I.pdf ? pdfCheckRead(I.pdf, R.total) : null;
  if(ck!=null && pck){
    const diff = Math.abs(pck.read - ck);
    const parts = I.pdf.kind === 'fatura'
      ? `${pck.prev ? 'Fatura anterior ' + brl(pck.prev) + ' + ' : ''}lançamentos ${brl(-(R.transactions||[]).filter(t=>t.amount<0).reduce((x,t)=>x+t.amount,0))} − pagamentos e créditos ${brl((R.transactions||[]).filter(t=>t.amount>0).reduce((x,t)=>x+t.amount,0))} = ${brl(pck.read)}`
      : `Saldo anterior ${brl(pck.opening)} + movimento ${brl(R.total||0)} = ${brl(pck.read)}`;
    ckHtml = (diff<=1 ? `<span class="check-res in" id="pdf-ck-ok">✓ Bate com o PDF (${brl(ck)})</span>` : `<span class="check-res out" id="pdf-ck-diff">Diferença de ${brl(diff)}</span>`) + `<span class="xs muted" id="pdf-ck-parts">${esc(parts)}</span>`;
  } else if(ck!=null){
    const diff = Math.abs(Math.abs(R.total||0) - Math.abs(ck));
    ckHtml = diff<=1 ? `<span class="check-res in">✓ Bate com o arquivo (${brl(Math.abs(R.total||0))})</span>`
      : `<span class="check-res out">Diferença de ${brl(diff)}</span><span class="small muted">Lido: ${brl(Math.abs(R.total||0))}. Confira as linhas em vermelho, o formato numérico e se há lançamentos fora do período.</span>`;
  }
  const accT = I.accountId==='__new' ? I.newAcc.type : accType(I.accountId);
  const guess = I.pdf ? (I.pdf.kind==='fatura' ? 'credit_card' : I.pdf.kind==='beneficio' ? 'benefit' : I.pdf.kind==='extrato' ? 'checking' : null) : eng('guessAccountType', a, R.transactions);
  const mismatch = guess && accT && accT!=='payslip' && (I.pdf ? kindMismatch(I.pdf.kind, accT) : ((guess==='checking' && accT==='credit_card') || (guess==='credit_card' && (accT==='checking'||accT==='savings'))));
  const fxNeed = fxNeedList(R, P);
  const nInst = (R.transactions||[]).filter(t=>t.installment && t.originalDate).length;
  const nTime = (R.transactions||[]).filter(t=>t.time).length;
  b.innerHTML = `
    ${mismatch?`<div class="banner err" id="acc-mismatch"><div class="grow"><b>Conta parece errada.</b> Este arquivo parece ${guess==='benefit'?'um <b>extrato de cartão benefício</b> (VA/VR)':guess==='checking'?'um <b>extrato de conta corrente</b> (tem saldo, Pix, TED ou rendimentos)':'uma <b>fatura de cartão</b> (compras positivas, parcelas)'}, mas a conta escolhida é <b>${esc(ACC_TYPES[accT]||accT)}</b>. Isso muda o tipo dos lançamentos (entradas viram estornos).</div><button class="btn sm" type="button" data-act="imp-back">Trocar conta</button></div>`:''}
    ${(I.upgraded||[]).length?`<div class="banner info" id="layout-upgraded"><div>Layout salvo <b>${esc(I.matched?I.matched.name:'')}</b> atualizado: agora lê ${I.upgraded.map(x=>'a coluna <b>'+esc(x)+'</b>').join(' e ')}.</div></div>`:''}
    ${nInst?`<div class="banner info"><div><b>${nInst} parcela${nInst>1?'s':''}</b> lançada${nInst>1?'s':''} no mês da parcela (data da compra + parcelas já pagas). A data original da compra fica guardada.</div></div>`:''}
    <div class="card">
      <div class="card-h"><h3>Confira a leitura</h3>${I.matched?`<span class="tag ok">${esc(I.matched.name)}</span>`:''}</div>
      <p class="small muted">${I.pdf ? 'Tabela montada a partir do PDF (com a seção de cada linha). Se uma coluna estiver errada, troque o papel dela no cabeçalho.' : 'Se uma coluna estiver errada, troque o papel dela no cabeçalho. A prévia se atualiza na hora.'}</p>
      ${fxNeed.length ? fxRatesHTML(fxNeed, P) : ''}
      ${(R.transactions||[]).some(t=>t.fx && t.fx.source!=='manual') ? `<p class="xs muted" id="imp-fx-note">${(R.transactions||[]).filter(t=>t.fx).length} lançamento(s) em moeda estrangeira: o valor em R$ é o cobrado; o valor original fica guardado (${esc([...new Set((R.transactions||[]).filter(t=>t.fx).map(t=>t.fx.currency))].join(', '))}).</p>` : ''}
      <div class="row" ${I.pdf ? 'hidden' : ''}>
        <div class="seg" role="group" aria-label="Formato numérico"><button type="button" data-act="imp-num" data-v="br" aria-pressed="${P.numberFormat!=='us'}">1.234,56</button><button type="button" data-act="imp-num" data-v="us" aria-pressed="${P.numberFormat==='us'}">1,234.56</button></div>
        <select id="imp-sign" aria-label="Convenção de sinal" style="width:auto;flex:1;min-width:180px">${Object.entries(SIGN_LBL).map(([k,v])=>`<option value="${k}" ${P.signConvention===k?'selected':''}>${v}</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table class="pv">
        <thead><tr><th>#</th>${Array.from({length:ncol},(_,i)=>`<th><select id="imp-col-${i}" data-col="${i}" aria-label="Papel da coluna ${i+1}">${roleOpts(roles[i]||'ignore')}</select><div class="xs faint" style="font-weight:500;margin-top:3px">${esc(header[i]|| (a.columns&&a.columns[i]&&a.columns[i].header) || 'Coluna '+(i+1))}</div></th>`).join('')}<th>Data lida</th><th>Valor lido</th><th>Situação</th></tr></thead>
        <tbody>${rowsIdx.map(ri=>{
          const row = a.rows[ri]||[]; const er = errBy[ri]; const sk = skipBy[ri]; const pp = previewParsed(row);
          return `<tr class="${er?'err':sk?'skip':''}"><td class="rn">${ri+1}</td>${Array.from({length:ncol},(_,i)=>`<td title="${esc(row[i]||'')}">${esc(row[i]||'')}</td>`).join('')}
            <td class="num">${pp.date?esc(pp.date.split('-').reverse().join('/')):'—'}</td><td class="num ${pp.amt>0?'in':pp.amt<0?'out':''}">${pp.amt!=null?brl(pp.amt):'—'}</td>
            <td>${er?esc(er.reason):sk?esc('Ignorada: '+sk.reason):'ok'}</td></tr>`; }).join('')}</tbody></table></div>
      ${nTime?`<p class="xs muted">Horário da compra encontrado em ${nTime} lançamento${nTime>1?'s':''}.</p>`:''}
      ${I.pdf && end - start > rowsIdx.length ? `<p class="xs muted">Mostrando ${rowsIdx.length} de ${end - start} linhas.</p>` : ''}
      ${I.pdf ? pdfExcludedHTML(I.pdf, 'pdf-ex3') : ''}
      <p class="small"><b class="num">${nAll}</b> lançamento${nAll===1?'':'s'} · <b class="num">${nDup}</b> duplicado${nDup===1?'':'s'} ignorado${nDup===1?'':'s'} · <b class="num ${nErr?'out':''}">${nErr}</b> com erro</p>
      ${nErr?`<details><summary>Ver ${nErr} linha${nErr>1?'s':''} com erro</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${R.errors.map(e=>`<div class="small"><span class="tag err">linha ${e.rowIndex+1}</span> ${esc(e.reason)}<div class="xs faint" style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${esc(Array.isArray(e.raw)?e.raw.join(' | '):e.raw)}</div></div>`).join('')}</div></details>`:''}
      <div class="check-box">
        <label class="lbl" for="imp-check">${I.pdf && I.pdf.kind==='fatura' ? 'Total da fatura (lido do PDF; confira)' : I.pdf && pck ? 'Saldo final do PDF (confira)' : 'Total no seu extrato/fatura'}</label>
        <input type="text" inputmode="decimal" id="imp-check" class="money-in" placeholder="Ex.: 4.123,45" value="${esc(I.checksum)}">
        <div id="check-res" style="display:flex;flex-direction:column;gap:2px">${ckHtml || '<span class="small muted">Digite o total impresso no arquivo para conferir se nada ficou de fora. Soma lida: <b class="money">'+brl(Math.abs(R.total||0))+'</b></span>'}</div>
      </div>
    </div>
    ${I.batchKey ? `<div class="card"><div class="field"><label for="imp-layout">Salvar layout como…</label><input type="text" id="imp-layout" placeholder="Ex.: Fatura XP" value="${esc(I.layoutName||'')}"></div>
      <div class="row end"><button class="btn" type="button" data-act="imp-step" data-s="2">Voltar</button><button class="btn primary" type="button" data-act="imp-batch-save" id="imp-batch-save">Salvar e voltar à lista</button></div></div>`
    : `<div class="row end"><button class="btn" type="button" data-act="imp-step" data-s="2">Voltar</button><button class="btn primary" type="button" data-act="imp-step" data-s="4" ${nFresh?'':'disabled'}>Continuar com ${nFresh}</button></div>`}`;
}
/** currencies × months that need a rate typed by the user (foreign-only files) + the ones already in use */
function fxNeedList(R, P){
  const out = []; const seen = new Set();
  const add = (cur, ym, need) => { const k = cur + '|' + ym; if(seen.has(k)) return; seen.add(k); out.push({ key:k, currency:cur, ym, need }); };
  (R.needRates||[]).forEach(n => add(n.currency, n.ym, true));
  (R.transactions||[]).forEach(t => { if(t.fx && t.fx.source==='manual') add(t.fx.currency, ymOf(t.date), false); });
  return out.sort((a,b)=>a.key.localeCompare(b.key));
}
function fxRatesHTML(list){
  const all = fxRatesAll();
  return `<div class="fx-rates" id="imp-fx-rates"><b class="small">Conta em moeda estrangeira: informe a cotação de cada mês</b>
    <p class="xs muted">Quantos reais valia 1 unidade da moeda (ex.: 5,40). Sem internet para buscar cotações: use a do seu banco ou do dia da fatura. Dá para mudar depois em Ajustes → Cotações.</p>
    <div class="fx-grid">${list.map(n => { const cur = all[n.currency] && all[n.currency][n.ym]; const prev = E.fxRateFor ? E.fxRateFor(all, n.currency, n.ym) : null;
      return `<div class="field"><label for="fx-${esc(n.key.replace('|','-'))}">${esc(n.currency)} em ${esc(fmtYm(n.ym))}</label><input type="text" inputmode="decimal" id="fx-${esc(n.key.replace('|','-'))}" data-fxrate="${esc(n.key)}" value="${cur ? esc(String(cur).replace('.', ',')) : ''}" placeholder="${prev ? esc(String(prev.rate).replace('.', ',')) : 'ex.: 5,40'}" ${n.need && !cur ? 'aria-invalid="true"' : ''}></div>`; }).join('')}</div>
    ${list.some(n=>n.need) ? `<p class="small out" id="imp-fx-missing">${list.filter(n=>n.need).length} mês(es) sem cotação: esses lançamentos ainda não entram.</p>` : ''}</div>`;
}
function setColumnRole(col, role){
  const P = S.imp.profile; const cols = Object.assign({}, P.columns||{});
  Object.keys(cols).forEach(r=>{ if(cols[r]===col) delete cols[r]; });
  if(role!=='ignore' && role!=='balance'){ delete cols[role]; cols[role] = col; }
  P.columns = cols;
  if(role==='debit' || role==='credit'){ if(cols.debit!=null && cols.credit!=null) P.signConvention = 'split_columns'; }
  if(role==='dcFlag') P.signConvention = 'dc_flag';
  if(role==='amount' && P.signConvention==='split_columns') P.signConvention = 'negative_is_expense';
  runPreview(); renderImport();
}
function renderStep4(b){
  const I = S.imp; const nFresh = (I.dedup.fresh||[]).length;
  const accLabel = I.accountId==='__new' ? I.newAcc.name : accName(I.accountId);
  b.innerHTML = `<div class="card">
      <h3>Salvar layout</h3>
      <p class="small muted">Da próxima vez que você enviar um arquivo com este formato, ele será reconhecido e a importação vai direto para a conferência.</p>
      <div class="field"><label for="imp-layout">Salvar layout como…</label><input type="text" id="imp-layout" placeholder="Ex.: Fatura Nubank CSV" value="${esc(I.layoutName || (I.matched?I.matched.name:'') || (I.pdf && I.profile ? I.profile.name : ''))}"></div>
    </div>
    <div class="card"><p><b class="num">${nFresh}</b> lançamentos novos vão para <b>${esc(accLabel)}</b>.</p>
      ${S.mode==='example'?'<p class="small muted">Os dados de exemplo serão substituídos pelos seus.</p>':''}
      <div class="row end"><button class="btn" type="button" data-act="imp-step" data-s="3">Voltar</button><button class="btn primary" type="button" data-act="imp-commit">Importar ${nFresh}</button></div></div>`;
}
function commitImport(){
  const I = S.imp; const name = (($('#imp-layout')||{}).value||'').trim(); I.layoutName = name;
  if(signedOut()){ toast('Entre na sua conta para importar e sincronizar.', true); return; }
  ensureReal();
  const accId = commitNewAccount();
  if(I.accountId!==accId) I.accountId = accId;
  runPreview(); // re-run with the final account id so ids/dedupe are right
  const fresh = (I.dedup.fresh||[]).map(t=>Object.assign({}, t, { accountId:accId, importId:I.importId }));
  const metaN = ['accounts','imports'];
  let profileId = null;
  if(name){
    const prof = Object.assign({}, I.profile, { name, defaultAccountId:accId });
    prof.fingerprint = prof.fingerprint || I.analysis.fingerprint;
    const idx = S.real.profiles.findIndex(p=>p.fingerprint===prof.fingerprint);
    if(idx>=0){ prof.id = S.real.profiles[idx].id; S.real.profiles[idx] = prof; } else { prof.id = prof.id || 'pf-'+Date.now().toString(36); S.real.profiles.push(prof); }
    profileId = prof.id; metaN.push('profiles');
  } else if(I.matched){
    profileId = I.matched.id;
    if((I.upgraded||[]).length){ const idx = S.real.profiles.findIndex(p=>p.id===I.matched.id); if(idx>=0){ S.real.profiles[idx] = Object.assign({}, S.real.profiles[idx], { columns: I.profile.columns }); metaN.push('profiles'); } }
  }
  const added = addTransactions(fresh);
  S.real.imports = S.real.imports || {};
  const dts = added.map(t=>t.date).sort();
  S.real.imports[I.importId] = { id:I.importId, fileName:I.fileName||'arquivo', at:nowISO(), updatedAt:nowISO(), accountId:accId, profileId, count:added.length, total:added.reduce((s,t)=>s+t.amount,0),
    from: dts[0]||null, to: dts[dts.length-1]||null, duplicates:(I.dedup.duplicates||[]).length, hasBalance: (I.result.transactions||[]).some(t=>t.balance!=null), kindGuess: eng('guessAccountType', I.analysis, I.result.transactions) || null };
  { const hn = eng('importHolder', I.analysis, I.result); if(hn) S.real.imports[I.importId].holderName = hn; }
  let pdfNote = '';
  if(I.pdf){
    const f = pdfImportFields(I.pdf); Object.assign(S.real.imports[I.importId], f);
    if(f.cycleStart){ S.real.imports[I.importId].from = f.cycleStart; S.real.imports[I.importId].to = f.cycleEnd; }
  }
  pdfNote = pdfAdoptAccount(accId, I.pdf, I.profile);
  // every row was already there: no import record (an import without rows would be an orphan in Gerenciar dados)
  if(!added.length) delete S.real.imports[I.importId];
  if(saveFxRates()) metaN.push('settings');
  const auto = added.filter(t=>t.categoryId).length;
  const tri = added.filter(isUncat).length;
  I.done = { imported: added.length, auto, triage: tri, dup:(I.dedup.duplicates||[]).length, err:(I.result.errors||[]).length, importId:I.importId, note: pdfNote };
  const months = added.map(t=>ymOf(t.date)).sort(); if(months.length) S.ui.month = months[months.length-1];
  commit({ meta: metaN });
}
function renderImportDone(b){
  const d = S.imp.done;
  const left = live().filter(t=>t.importId===d.importId && isUncat(t)).length;
  b.innerHTML = `<div class="card" style="align-items:flex-start" id="imp-done">
    <span class="eyebrow">Importação concluída</span>
    <div class="result-big"><span class="num">${d.imported}</span> importados</div>
    <p><b class="num in">${d.auto}</b> categorizados automaticamente · ${left?`<b class="num out" id="imp-left">${left}</b> para triagem`:'<b class="in" id="imp-left">tudo classificado ✓</b>'}</p>
    ${d.dup||d.err?`<p class="small muted">${d.dup} duplicado${d.dup===1?'':'s'} ignorado${d.dup===1?'':'s'}${d.err?` · ${d.err} linha${d.err>1?'s':''} com erro não importada${d.err>1?'s':''}`:''}</p>`:''}
    ${d.note?`<p class="small" id="imp-done-note">${esc(d.note)}</p>`:''}
    <div class="row">${left?'<button class="btn primary" type="button" data-act="triage">Classificar agora</button>':''}<button class="btn" type="button" data-act="goto" data-tab="painel">Ver painel</button>${S.imp.fromPaste?'<button class="btn" type="button" data-act="imp-paste-again" id="imp-paste-again">Colar outro arquivo</button>':''}<button class="btn ghost" type="button" data-act="imp-reset">Importar outro</button></div></div>`;
}

/* ================= v2.2: several files at once (batch) ================= */
const KIND_LBL2 = { fatura: 'Fatura de cartão', extrato: 'Extrato bancário', beneficio: 'Extrato de benefício (VA/VR)' };
const kindMismatch = (kind, type) => ((kind === 'extrato' || kind === 'beneficio') && type === 'credit_card') || (kind === 'fatura' && (type === 'checking' || type === 'savings' || type === 'benefit'));
const kindAccType = kind => kind === 'fatura' ? 'credit_card' : kind === 'beneficio' ? 'benefit' : 'checking';
/** reads one file into a table analysis (CSV/TXT/TSV text or the first sheet of an XLSX/XLS) */
async function readFileAnalysis(file, opts) {
  opts = opts || {};
  const buf = await readBytes(file);
  const kind = tableFileKind(file, buf);
  if (kind === 'pdf') {
    // v2.4b: PDF statements — text with positions (pdf.js) → lines → sections/records (FinEngine.analyzePdf)
    const lib = await loadPdfJs();
    const res = await E.readPdf(lib, buf, { password: opts.password, onPage: opts.onPage });
    const a = eng('analyzePdf', res, { fileName: file.name });
    if (!a) throw new Error('não consegui montar a tabela do PDF');
    return { encoding: 'PDF', analysis: a };
  }
  if (kind === 'zip') throw new Error('é um arquivo ZIP — escolha-o junto com outros arquivos ou arraste-o para a lista; os extratos de dentro entram um por um');
  if (kind !== 'xlsx' && kind !== 'text') throw new Error(kind);
  if (kind === 'xlsx') {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false }).map(r => r.map(c => c == null ? '' : String(c)));
    return { encoding: 'Planilha Excel', analysis: eng('analyzeRows', rows) };
  }
  const dec = eng('decodeBytes', buf);
  if (!dec) throw new Error('não consegui ler o texto do arquivo');
  return { encoding: dec.encoding, analysis: eng('analyzeTable', dec.text) };
}
async function handleFiles(list) {
  let files = Array.from(list || []).filter(f => f && f.name);
  if (!files.length) return;
  const I = S.imp;
  if (files.some(f => /\.zip$/i.test(f.name) || /zip/.test(f.type || ''))) {
    const x = await expandArchives(files);
    if (x.errs.length) toast(x.errs.join(' '), true);
    files = x.files;
    if (!files.length) return;
    // a ZIP always opens the list (it usually holds several statements)
    if (files.length === 1 && !I.batch) I.batch = { items: [], done: null, shared: '', sharedTouched: false, newAccs: [], form: null, seq: 0 };
  }
  if (files.length === 1 && !I.batch) { handleFile(files[0]); return; }
  I.err = '';
  const B = I.batch || (I.batch = { items: [], done: null, shared: '', sharedTouched: false, newAccs: [], form: null, seq: 0 });
  B.done = null;
  B.busy = true; renderImport();
  const added = [];
  for (const f of files) {
    const it = { key: 'bf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: f.name, checksum: '', ov: null, sug: null, configured: false, layoutName: '' };
    B.busyText = 'Lendo ' + f.name + '…'; setReading(B.busyText);
    await bfRead(it, f, null);
    it.importId = 'imp-' + Date.now().toString(36) + '-' + B.items.length;
    B.items.push(it); added.push(it);
  }
  B.busy = false;
  bfInitShared(B);
  bfAutoAll(B);
  batchPreview();
  renderImport();
}
/** reads one batch file (CSV/XLSX/PDF) into the item; a PDF with a password waits for it (it.pw) */
async function bfRead(it, f, password) {
  it.err = null; it.pw = null; it.file = null;
  try {
    const r = await readFileAnalysis(f, { password, onPage: (i, n) => setReading('Lendo PDF ' + f.name + '… página ' + i + ' de ' + n) });
    password = null;
    if (!r.analysis || !Array.isArray(r.analysis.rows)) throw new Error('não reconheci uma tabela');
    it.encoding = r.encoding; it.analysis = r.analysis;
    const profiles = S.mode === 'real' && S.real ? S.real.profiles : [];
    const m = profiles.length ? eng('matchProfile', r.analysis, profiles) : null;
    it.matched = m || null;
    it.profile = m ? clone(m) : eng('profileFromAnalysis', r.analysis);
    if (m) { const ad = eng('adoptInfoColumns', it.profile, r.analysis); if (ad && ad.added.length) it.profile = ad.profile; }
    // the currency is the file's own (one layout serves a wallet's USD, CNY and BRL statements alike)
    curFromFile(it.profile, r.analysis);
    // only a header (a period without movements): nothing to configure, nothing to import
    if (!m && r.analysis.empty) { it.configured = true; it.layoutName = it.profile.name; it.empty = true; }
    if (r.analysis.source === 'pdf') {
      it.pdf = r.analysis.pdf;
      // a PDF needs no column setup: the reconstructed table is ready (the user can still "Revisar leitura")
      if (!m && it.pdf.records.length) { it.configured = true; it.layoutName = it.profile.name; }
      if (it.pdf.checksum && it.pdf.checksum.expected != null && !it.checksum) it.checksum = moneyIn(it.pdf.checksum.expected);
    }
    batchDetectKind(it);
    it.sug = suggestAccount(it);
  } catch (e) {
    password = null;
    if (e && (e.code === 'pdf_password' || e.code === 'pdf_password_wrong')) { it.pw = { wrong: e.code === 'pdf_password_wrong' }; it.file = f; return; }
    it.err = 'Não consegui abrir: ' + fileErrMsg(e);
  }
}
async function bfPassword(key) {
  const it = bfItem(key); if (!it || !it.file) return;
  const inp = $('#bf-pw-' + CSS.escape(key)); const pw = inp ? inp.value : '';
  if (inp) inp.value = '';
  if (!pw) { toast('Digite a senha do PDF.', true); if (inp) inp.focus(); return; }
  const B = S.imp.batch; B.busy = true; renderImport();
  await bfRead(it, it.file, pw);
  B.busy = false; bfAuto(B, it); bfInitShared(B); bfRefresh();
  if (it.pw) { const n = $('#bf-pw-' + CSS.escape(key)); if (n) n.focus(); }
}
function batchDetectKind(it) {
  if (it.pdf && it.pdf.kind) { it.kind = it.pdf.kind; return; }
  if (!it.profile || !it.analysis) { it.kind = null; return; }
  const r = eng('applyProfile', it.analysis.rows, it.profile, { accountId: '__kind', importId: '__kind' }) || { transactions: [] };
  let k = eng('importKind', r.transactions, { fileName: it.name }) || null;
  if (!k) { const g = eng('guessAccountType', it.analysis, r.transactions); k = g === 'checking' ? 'extrato' : g === 'credit_card' ? 'fatura' : null; }
  it.kind = k;
}
/** account pre-fill: the layout's account, else the account earlier imports of this layout+kind went to; when that one
 *  does not fit the kind (a bank extrato into a card) and an account of the right type exists, that one instead. */
function suggestAccount(it) {
  const accs = (S.mode === 'real' && S.real ? S.real.accounts : []).filter(a => a.type !== 'payslip');
  const byId = id => accs.find(a => a.id === id) || null;
  const imps = Object.values(D().imports || {}).filter(r => r && r.id && r.accountId);
  const kindOfImp = r => { const txs = live().filter(t => t.importId === r.id); return txs.length ? eng('importKind', txs, r) : null; };
  const freq = recs => { const f = {}; recs.forEach(r => { if (byId(r.accountId)) f[r.accountId] = (f[r.accountId] || 0) + 1; }); return Object.entries(f).sort((a, b) => b[1] - a[1]).map(([id]) => byId(id)); };
  const cands = [];
  if (it.matched && byId(it.matched.defaultAccountId)) cands.push(byId(it.matched.defaultAccountId));
  if (it.matched) freq(imps.filter(r => r.profileId === it.matched.id && (!it.kind || kindOfImp(r) === it.kind))).forEach(a => { if (!cands.includes(a)) cands.push(a); });
  const fits = a => (!it.kind || !kindMismatch(it.kind, a.type)) && curFits(it, a, accs);
  // a statement in a foreign currency goes to the account in that currency when there is one
  if (fileCur(it) !== 'BRL') { const c = accs.filter(a => a.currency === fileCur(it) && fits(a)); if (c.length === 1) return { id: c[0].id, note: cands[0] && cands[0] !== c[0] ? { from: cands[0].id, to: c[0].id } : null }; }
  const ok = cands.find(fits);
  if (ok) return { id: ok.id, note: cands[0] !== ok ? { from: cands[0].id, to: ok.id } : null };
  if (cands.length && it.kind) {
    const right = freq(imps.filter(r => kindOfImp(r) === it.kind)).filter(fits)[0] || (accs.filter(fits).length === 1 ? accs.filter(fits)[0] : null);
    if (right) return { id: right.id, note: { from: cands[0].id, to: right.id } };
    return { id: cands[0].id, note: null };
  }
  const pref = S.imp && S.imp.fromAlert ? byId(S.imp.fromAlert) : null; // "Importar agora" from an alert
  if (pref && fits(pref)) return { id: pref.id, note: null };
  return { id: '', note: null };
}
const bfReadyLayout = it => !!(it.profile && (it.matched || it.configured));
/* v2.4a: ONE account for the whole batch ("Conta para todos os arquivos", B.shared); a file follows it unless it has an
   override it.ov = { id, auto, note } ("Alterar só este" → manual; auto = kind mismatch / layout suggestion). Accounts
   created in the batch are pending ("__nova:N", B.newAccs) until "Importar": created ONCE, shown in every selector, and
   a second "+ Nova conta" with the same name reuses it. */
const isPendingAcc = id => /^__nova:/.test(id || '');
function bfPending(id) { const B = S.imp && S.imp.batch; return B && B.newAccs ? B.newAccs.find(a => a.id === id) || null : null; }
function bfAccounts() {
  const real = (S.mode === 'real' && S.real ? S.real.accounts : []).filter(a => a.type !== 'payslip');
  const B = S.imp && S.imp.batch;
  return real.concat(B && B.newAccs ? B.newAccs.map(a => Object.assign({ pending: true }, a)) : []);
}
const bfAccTypeOf = id => { const p = bfPending(id); return p ? p.type : accType(id); };
const bfAccNameOf = id => { const p = bfPending(id); return p ? p.name : accName(id); };
const bfAcc = it => it.ov ? (it.ov.id || '') : ((S.imp && S.imp.batch && S.imp.batch.shared) || '');
const bfAccType = it => bfAccTypeOf(bfAcc(it));
function bfReady(it) {
  return !it.err && bfReadyLayout(it) && !!bfAcc(it) && it.preview && it.preview.fresh > 0;
}
/** the shared account at the start: the step-1 account the user picked, else the alert's account, else the layouts'
 *  account when every recognized file agrees on it */
function bfInitShared(B) {
  if (B.shared || B.sharedTouched) return;
  const I = S.imp; const real = (S.mode === 'real' && S.real ? S.real.accounts : []);
  const exists = id => real.some(a => a.id === id && a.type !== 'payslip');
  if (I.accTouched) {
    if (I.accountId === '__new' && (I.newAcc.name || '').trim()) { B.shared = bfNewAccount(I.newAcc.name, I.newAcc.type).id; B.sharedTouched = true; return; }
    if (exists(I.accountId)) { B.shared = I.accountId; B.sharedTouched = true; return; }
  }
  if (I.fromAlert && exists(I.fromAlert)) { B.shared = I.fromAlert; return; }
  const defs = B.items.filter(it => !it.err && it.matched && exists(it.matched.defaultAccountId)).map(it => it.matched.defaultAccountId);
  if (defs.length && defs.every(x => x === defs[0])) { B.shared = defs[0]; return; }
  if (!bfAccounts().length && !B.form) B.form = { target: 'shared', name: '', type: bfMajorityType(B), prev: '' };
}
function bfMajorityType(B) {
  const k = B.items.filter(it => it.kind).map(it => it.kind);
  const nf = k.filter(x => x === 'fatura').length;
  return k.length && nf * 2 < k.length ? 'checking' : 'credit_card';
}
/** an account of the file's kind: the layout's suggestion when it fits, else the only account of that type */
/** the currency of a file (a statement kept in USD/EUR/CNY…) and whether an account can hold it: an account in another
 *  currency never can; with an account in the file's currency, only that one */
const fileCur = it => (it && ((it.analysis && it.analysis.currency) || (it.profile && it.profile.currency))) || 'BRL';
function curFits(it, a, accs) {
  const cur = fileCur(it), ac = (a && a.currency) || 'BRL';
  if (!a) return true;
  if (a.currency && ac !== cur) return false;
  if (cur !== 'BRL' && (accs || []).some(x => x.currency === cur)) return ac === cur;
  return true;
}
function curFromFile(profile, analysis) {
  if (!profile || !analysis || analysis.source === 'pdf' && !analysis.currency) return;
  if (analysis.currency && analysis.currency !== 'BRL') profile.currency = analysis.currency; else delete profile.currency;
}
function bfFitFor(it) {
  const accs = bfAccounts();
  const byCur = fileCur(it) !== 'BRL' ? accs.filter(a => a.currency === fileCur(it)) : [];
  if (byCur.length === 1 && (!it.kind || !kindMismatch(it.kind, byCur[0].type))) return byCur[0].id;
  if (!it.kind) return null;
  const s = it.sug && it.sug.id ? accs.find(a => a.id === it.sug.id) : null;
  if (s && !kindMismatch(it.kind, s.type)) return s.id;
  const exact = accs.filter(a => a.type === kindAccType(it.kind));
  return exact.length === 1 ? exact[0].id : null;
}
/** recomputes the automatic overrides (manual ones stay) */
function bfAuto(B, it) {
  if (it.err || (it.ov && !it.ov.auto)) return;
  it.ov = null;
  const sh = B.shared;
  const sug = it.sug || { id: '', note: null };
  if (!B.sharedTouched && sug.id && sug.id !== sh) { it.ov = { id: sug.id, auto: true, note: sug.note ? Object.assign({ layout: true }, sug.note) : (sh ? { layout: true, to: sug.id } : null) }; return; }
  const at = sh ? bfAccTypeOf(sh) : null;
  const shAcc = sh ? bfAccounts().find(a => a.id === sh) : null;
  if (sh && ((it.kind && at && kindMismatch(it.kind, at)) || (shAcc && !curFits(it, shAcc, bfAccounts())))) {
    const fit = bfFitFor(it);
    const curOnly = !(it.kind && at && kindMismatch(it.kind, at));
    if (fit && fit !== sh) it.ov = { id: fit, auto: true, note: Object.assign({ shared: true, from: sh, to: fit }, curOnly ? { cur: fileCur(it) } : {}) };
  }
}
function bfAutoAll(B) { B.items.forEach(it => bfAuto(B, it)); }
/** "+ Nova conta" in the batch: reuses an account (existing or pending) with the same name; else a pending one */
function bfNewAccount(name, type) {
  const B = S.imp.batch; const nm = String(name || '').trim(); const k = normU(nm);
  const real = (S.mode === 'real' && S.real ? S.real.accounts : []).find(a => a.type !== 'payslip' && normU(a.name) === k);
  if (real) return { id: real.id, reused: 'real' };
  const p = (B.newAccs || []).find(a => normU(a.name) === k);
  if (p) return { id: p.id, reused: 'pending' };
  const a = { id: '__nova:' + (++B.seq), name: nm, type: type || 'checking' };
  B.newAccs.push(a);
  return { id: a.id, reused: null };
}
function bfFormOpen(target, type) {
  const B = S.imp.batch;
  const it = target === 'shared' ? null : bfItem(target);
  B.form = { target, name: '', type: type || (it && it.kind ? kindAccType(it.kind) : bfMajorityType(B)), prev: target === 'shared' ? B.shared : (it && it.ov ? it.ov.id : bfAcc(it)) };
  if (it) it.ov = { id: '', auto: false, prev: B.form.prev };
  bfRefresh();
  const n = $('#bf-new-name'); if (n) n.focus();
}
function bfFormCreate() {
  const B = S.imp.batch; const F = B.form; if (!F) return;
  const nmEl = $('#bf-new-name'); const tpEl = $('#bf-new-type');
  const name = ((nmEl ? nmEl.value : F.name) || '').trim(); const type = (tpEl ? tpEl.value : F.type) || 'checking';
  if (!name) { toast('Dê um nome para a conta nova (ex.: "Nubank cartão").', true); if (nmEl) nmEl.focus(); return; }
  const r = bfNewAccount(name, type);
  if (F.target === 'shared') { B.shared = r.id; B.sharedTouched = true; }
  else { const it = bfItem(F.target); if (it) it.ov = { id: r.id, auto: false }; }
  B.form = null;
  bfAutoAll(B);
  bfRefresh();
  toast(r.reused ? 'Já existe "' + bfAccNameOf(r.id) + '": usei essa conta.' : 'Conta "' + name + '" pronta — aparece em todos os arquivos. Ela é criada ao importar.');
}
function bfFormCancel() {
  const B = S.imp.batch; const F = B.form; if (!F) return;
  if (F.target !== 'shared') { const it = bfItem(F.target); if (it) it.ov = F.prev && F.prev !== (B.shared || '') ? { id: F.prev, auto: false } : null; }
  B.form = null; bfAutoAll(B); bfRefresh();
}
function bfAccOptions(sel, placeholder) {
  const accs = bfAccounts();
  return (sel ? '' : `<option value="" selected>${esc(placeholder || 'Escolha a conta…')}</option>`)
    + accs.map(a => `<option value="${esc(a.id)}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)} · ${esc(ACC_TYPES[a.type] || a.type)}${a.pending ? ' (nova)' : ''}</option>`).join('')
    + `<option value="__new" ${sel === '__new' ? 'selected' : ''}>+ Nova conta…</option>`;
}
function bfFormHTML() {
  const F = S.imp.batch.form; if (!F) return '';
  return `<div class="newcat bf-newacc" id="bf-newacc" data-target="${esc(F.target)}"><div class="form-grid">
      <div class="field"><label for="bf-new-name">Nome da conta nova</label><input type="text" id="bf-new-name" value="${esc(F.name)}" autocomplete="off" placeholder="${F.type === 'credit_card' ? 'Ex.: Cartão XP' : 'Ex.: Conta XP'}"></div>
      <div class="field"><label for="bf-new-type">Tipo</label><select id="bf-new-type">${NEW_ACC_TYPES.map(k => `<option value="${k}" ${F.type === k ? 'selected' : ''}>${ACC_TYPES[k]}</option>`).join('')}</select></div></div>
    <p class="xs muted">Criada uma vez só: fica disponível para todos os arquivos desta lista.</p>
    <div class="row end"><button class="btn sm" type="button" data-act="bf-new-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="bf-new-create" id="bf-new-create">Criar conta</button></div></div>`;
}
/** dry run of the whole batch (pure): rows, errors, duplicates (vs stored rows AND the other files), date range */
function batchPreview() {
  const B = S.imp.batch; if (!B) return;
  const items = B.items.filter(it => it.profile && it.analysis && !it.err);
  const pseudo = (B.newAccs || []).map(a => ({ id: a.id, name: a.name, type: a.type }));
  const c = Object.assign(ctx(), { accounts: (D().accounts || []).concat(pseudo) });
  const fxr = fxRatesAll();
  const res = eng('importBatch', S.mode === 'real' ? live() : [], items.map(it => ({ rows: it.analysis.rows, profile: it.profile, accountId: bfAcc(it) || '__pending:' + it.key, importId: 'pv-' + it.key, name: it.name, applyOpts: { fxRates: fxr } })), c);
  const by = new Map(((res && res.results) || []).map(r => [r.importId, r]));
  B.order = ((res && res.results) || []).map(r => r.importId.slice(3));
  for (const it of B.items) {
    const r = by.get('pv-' + it.key);
    it.preview = r ? { count: r.count, fresh: r.addedIds.length, dups: r.duplicates.length, errors: r.errors.length, from: r.from, to: r.to, total: r.total, needRates: r.errors.filter(e => e.needRate).length } : null;
  }
}
const fmtRange = (a, b) => !a ? '—' : a.slice(0, 4) === (b || a).slice(0, 4) ? isoToDM(a) + ' – ' + isoToBR(b || a) : isoToBR(a) + ' – ' + isoToBR(b);
function bfCheckHTML(it) {
  const ck = it.checksum ? parseMoney(it.checksum) : null;
  if (ck == null || !it.preview) return '';
  const pck = it.pdf ? pdfCheckRead(it.pdf, it.preview.total) : null;
  if (pck) { const d = Math.abs(pck.read - ck); return d <= 1 ? `<span class="check-res in">✓ Bate com o PDF (${brl(ck)})</span>` : `<span class="check-res out">Diferença de ${brl(d)}</span><span class="xs muted">Lido: ${brl(pck.read)}</span>`; }
  const diff = Math.abs(Math.abs(it.preview.total || 0) - Math.abs(ck));
  return diff <= 1 ? `<span class="check-res in">✓ Bate (${brl(Math.abs(it.preview.total || 0))})</span>` : `<span class="check-res out">Diferença de ${brl(diff)}</span><span class="xs muted">Lido: ${brl(Math.abs(it.preview.total || 0))}</span>`;
}
function bfRowHTML(it) {
  const B = S.imp.batch;
  const accs = bfAccounts().filter(a => a.type !== 'cash');
  const p = it.preview;
  const layoutTag = it.err ? '<span class="tag err">Não abriu</span>'
    : it.matched ? `<span class="tag ok">Layout reconhecido: ${esc(it.matched.name.replace(/^Layout:\s*/, ''))}</span>`
      : it.configured ? `<span class="tag ok">Layout configurado${it.layoutName ? ': ' + esc(it.layoutName) : ''}</span>` : '<span class="tag warn">Novo layout</span>';
  const kindTag = (it.kind ? `<span class="tag acc">${KIND_LBL2[it.kind]}</span>` : (it.err ? '' : '<span class="tag">Tipo não identificado</span>'))
    + (p && p.count > 0 && p.fresh === 0 && p.dups > 0 ? '<span class="tag warn" data-already>Já importado: nada novo</span>' : '');
  const acc = bfAcc(it);
  const at = bfAccType(it);
  const formHere = B.form && B.form.target === it.key;
  const mis = !formHere && it.kind && acc && at && kindMismatch(it.kind, at);
  const right = mis ? accs.find(a => !kindMismatch(it.kind, a.type)) : null;
  const accLabel = bfAccNameOf(acc);
  const k = esc(it.key);
  const n = it.ov && it.ov.auto ? it.ov.note : null;
  const kindTxt = it.kind === 'extrato' ? 'um extrato bancário' : 'uma fatura de cartão';
  const note = !n || !acc ? '' : `<div class="banner info xs" data-note="${k}"><div class="grow">${n.cur
      ? `Só este arquivo vai para <b>${esc(bfAccNameOf(n.to))}</b>: o extrato está em ${esc(n.cur)}, a moeda dessa conta.`
      : n.from && n.to && fileCur(it) !== 'BRL' && (bfAccounts().find(a => a.id === n.to) || {}).currency === fileCur(it)
      ? `Escolhi <b>${esc(bfAccNameOf(n.to))}</b>: o extrato está em ${esc(fileCur(it))}, a moeda dessa conta.`
      : n.shared
      ? `Só este arquivo vai para <b>${esc(bfAccNameOf(n.to))}</b>: é ${kindTxt} e a conta de todos (${esc(bfAccNameOf(n.from))}) é ${esc((ACC_TYPES[bfAccTypeOf(n.from)] || '').toLowerCase())}.`
      : n.from ? `Escolhi <b>${esc(bfAccNameOf(n.to))}</b>: este arquivo é ${kindTxt} e o layout estava ligado a ${esc(accName(n.from))} (${esc(ACC_TYPES[accType(n.from)] || '')}).`
        : `Este layout costuma ir para <b>${esc(bfAccNameOf(n.to))}</b>.`}</div></div>`;
  const shared = B.shared || '';
  const accBox = it.ov || formHere
    ? `<div class="field bf-own"><label for="bf-acc-${k}">Conta só deste arquivo</label><select id="bf-acc-${k}" data-bfacc="${k}">${bfAccOptions(formHere ? '__new' : acc)}</select></div>
      ${formHere ? bfFormHTML() : ''}
      <div class="row"><button class="btn ghost sm" type="button" data-act="bf-default" data-key="${k}" id="bf-default-${k}">${shared ? 'Voltar ao padrão (' + esc(bfAccNameOf(shared)) + ')' : 'Voltar ao padrão'}</button></div>`
    : `<div class="bf-inh" data-inherit="${k}"><span class="small grow">Conta: ${shared ? `<b>${esc(bfAccNameOf(shared))}</b> <span class="faint">· a de todos</span>` : '<span class="warn-t" data-needacc>escolha a conta acima</span>'}</span>
      <button class="btn ghost sm" type="button" data-act="bf-own" data-key="${k}" id="bf-own-${k}">Alterar só este</button></div>`;
  return `<div class="bf${mis ? ' bad' : ''}" data-key="${k}">
    <div class="bf-top"><span class="nm">${esc(it.name)}</span><button class="icon-btn" type="button" data-act="bf-remove" data-key="${k}" aria-label="Remover da lista" title="Remover da lista"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    ${it.pw ? `<div class="pdf-pw bf-pw" data-pw="${k}"><b class="small">PDF com senha</b>
      <div class="field"><label for="bf-pw-${k}">Senha do PDF</label><input type="password" id="bf-pw-${k}" data-bfpw="${k}" autocomplete="off" spellcheck="false" ${it.pw.wrong ? 'aria-invalid="true"' : ''}></div>
      ${it.pw.wrong ? '<p class="small out" role="alert">Senha incorreta. Confira e tente de novo.</p>' : ''}<p class="xs muted">Muitos bancos usam os dígitos do CPF. A senha não é guardada.</p>
      <div class="row end"><button class="btn sm primary" type="button" data-act="bf-pw" data-key="${k}" id="bf-pw-go-${k}">Abrir PDF</button></div></div>`
    : it.err ? `<div class="banner err"><div>${esc(it.err)}</div></div>` : `
    <div class="bf-tags">${layoutTag}${kindTag}${it.pdf ? `<span class="tag" data-pdf>PDF · ${it.pdf.pages} pág.</span>` : ''}${p && p.needRates ? `<span class="tag warn" data-needrate>Falta cotação</span>` : ''}</div>
    ${it.pdf ? pdfExcludedHTML(it.pdf, 'bf-ex-' + k) : ''}
    <div class="bf-stats small" data-stats="${k}">${p ? `${esc(fmtRange(p.from, p.to))} · <b class="num">${p.count}</b> linha${p.count === 1 ? '' : 's'} · <b class="num ${p.errors ? 'out' : ''}">${p.errors}</b> erro${p.errors === 1 ? '' : 's'} · <b class="num">${p.dups}</b> duplicado${p.dups === 1 ? '' : 's'}` : 'Sem leitura'}</div>
    ${accBox}
    ${mis ? `<div class="mismatch" role="alert" data-mismatch="${k}"><div><b>Conta errada?</b> Este arquivo parece ${it.kind === 'extrato' ? 'um <b>extrato bancário</b> (Pix, TED, saldo ou rendimentos)' : 'uma <b>fatura de cartão</b> (compras, parcelas)'}, mas <b>${esc(accLabel)}</b> é ${esc((ACC_TYPES[at] || at).toLowerCase())}. Misturados, lançamentos do extrato e da fatura podem ser descartados como repetidos e os pagamentos de fatura ficam errados.</div>
      <div class="row">${right ? `<button class="btn sm primary" type="button" data-act="bf-fix" data-key="${k}" data-to="${esc(right.id)}">Usar ${esc(right.name)}</button>` : ''}<button class="btn sm${right ? '' : ' primary'}" type="button" data-act="bf-fix" data-key="${k}" data-to="__new">Criar ${it.kind === 'extrato' ? 'conta corrente' : 'cartão de crédito'}</button></div></div>` : ''}
    ${note}
    <details class="bf-ckd" ${it.checksum ? 'open' : ''}><summary>Conferir total (opcional)</summary><div class="bf-ck"><input type="text" inputmode="decimal" class="money-in" data-bfck="${k}" id="bf-ck-${k}" placeholder="Total do arquivo" value="${esc(it.checksum)}" aria-label="Total impresso em ${esc(it.name)}"><span class="bf-ckres" id="bf-ckres-${k}" style="display:flex;flex-direction:column">${bfCheckHTML(it)}</span></div></details>
    ${bfReadyLayout(it) ? (it.matched || it.configured ? `<div class="row"><button class="btn ghost sm" type="button" data-act="bf-config" data-key="${k}">Revisar leitura</button></div>` : '') : `<div class="row"><button class="btn sm primary" type="button" data-act="bf-config" data-key="${k}">Configurar</button><span class="xs muted grow">Layout novo: confira as colunas uma vez; da próxima vez ele é reconhecido.</span></div>`}`}
  </div>`;
}
function renderBatch(b) {
  const B = S.imp.batch;
  if (B.done) return renderBatchDone(b);
  const ready = B.items.filter(bfReady);
  const order = (B.order || []).map(k => B.items.find(it => it.key === k)).filter(Boolean);
  const pending = B.items.length - ready.length;
  const formShared = B.form && B.form.target === 'shared';
  const nOwn = B.items.filter(it => !it.err && it.ov && it.ov.id).length;
  b.innerHTML = `
    <div class="card"><div class="card-h"><h3>${B.items.length} arquivo${B.items.length === 1 ? '' : 's'}</h3><button class="btn ghost sm" type="button" data-act="bf-reset">Cancelar</button></div>
      <div class="bf-shared" id="bf-shared-box">
        <div class="field"><label for="bf-shared">Conta para todos os arquivos</label><select id="bf-shared">${bfAccOptions(formShared ? '__new' : (B.shared || ''))}</select></div>
        ${formShared ? bfFormHTML() : ''}
        <p class="xs muted" id="bf-shared-hint">Todos os arquivos seguem esta conta${nOwn ? ` — <b>${nOwn}</b> com conta própria` : ''}. Arquivo de outra conta? Toque em "Alterar só este" nele.</p>
      </div>
      <p class="small muted">A importação segue a ordem das datas (mais antigo primeiro), então parcelas e repetidos são tratados como se você importasse um por vez.</p>
      ${B.busy ? `<p class="row small" id="bf-busy"><span class="spinner"></span> <span id="bf-busy-t">${esc(B.busyText || 'Lendo arquivos…')}</span></p>` : ''}
      <div class="bf-list" id="bf-list">${B.items.map(bfRowHTML).join('')}</div>
      <input type="file" id="imp-file" class="file-in" multiple accept="${FILE_ACCEPT}"><label class="drop" id="drop" for="imp-file" style="padding:12px"><b>+ Adicionar arquivos</b></label>
    </div>
    ${order.length > 1 ? `<p class="xs faint" id="bf-order">Ordem: ${order.map(it => esc(it.name)).join(' → ')}</p>` : ''}
    <div class="row end">${pending ? `<span class="small muted grow" id="bf-pending">${pending} arquivo${pending === 1 ? '' : 's'} ainda precisa${pending === 1 ? '' : 'm'} de conta, configuração ou não ${pending === 1 ? 'tem' : 'têm'} lançamentos novos.</span>` : ''}
      <button class="btn primary" type="button" data-act="bf-import" id="bf-import" ${ready.length ? '' : 'disabled'}>Importar ${ready.length} arquivo${ready.length === 1 ? '' : 's'}</button></div>`;
}
function bfItem(key) { const B = S.imp && S.imp.batch; return B ? B.items.find(it => it.key === key) : null; }
function bfRefresh() { batchPreview(); renderImport(); }
/** "Configurar": the single-file wizard (steps 2–3) on this file; saving returns to the list */
function bfConfigure(key) {
  const it = bfItem(key); if (!it || !it.analysis) return;
  const I = S.imp;
  Object.assign(I, { analysis: it.analysis, pdf: it.pdf || null, profile: clone(it.profile), matched: it.matched, fileName: it.name, encoding: it.encoding, importId: it.importId,
    accountId: bfAcc(it), layoutName: it.layoutName || (it.matched ? it.matched.name : ''), checksum: it.checksum || '', upgraded: [], batchKey: key, err: '' });
  runPreview(); I.step = 2; renderImport(); window.scrollTo({ top: 0 });
}
function bfConfigSave() {
  const I = S.imp; const it = bfItem(I.batchKey); if (!it) { I.batchKey = null; renderImport(); return; }
  const name = (($('#imp-layout') || {}).value || '').trim();
  if (!name) { toast('Dê um nome ao layout (ex.: "Fatura XP").', true); const n = $('#imp-layout'); if (n) n.focus(); return; }
  it.profile = Object.assign(clone(I.profile), { name }); it.profile.fingerprint = it.profile.fingerprint || it.analysis.fingerprint;
  it.layoutName = name; it.configured = !it.matched; if (it.matched) it.matched = Object.assign({}, it.matched, { name });
  it.checksum = I.checksum || it.checksum;
  batchDetectKind(it);
  // other files of the same (new) layout take the same reading
  for (const o of S.imp.batch.items) if (o !== it && !o.matched && !o.configured && o.analysis && o.analysis.fingerprint === it.analysis.fingerprint) { o.profile = clone(it.profile); curFromFile(o.profile, o.analysis); o.layoutName = name; o.configured = true; batchDetectKind(o); o.sug = suggestAccount(o); bfAuto(S.imp.batch, o); }
  it.sug = suggestAccount(it); bfAuto(S.imp.batch, it);
  I.batchKey = null; I.step = 1;
  bfRefresh(); window.scrollTo({ top: 0 });
}
function bfImport() {
  const I = S.imp; const B = I.batch; if (!B) return;
  if (signedOut()) { toast('Entre na sua conta para importar e sincronizar.', true); return; }
  batchPreview();
  const ready = B.items.filter(bfReady);
  if (!ready.length) return;
  ensureReal();
  const d = S.real; const now = nowISO(); const metaN = new Set(['accounts', 'imports']);
  // accounts created in the list: each one ONCE, however many files use it
  const made = {};
  for (const it of ready) {
    const id = bfAcc(it);
    if (isPendingAcc(id) && !made[id]) { const pa = bfPending(id); made[id] = addAccount(pa.name, pa.type); }
    it.accountId = made[id] || id;
  }
  if (Object.keys(made).length) {
    if (made[B.shared]) B.shared = made[B.shared];
    B.items.forEach(it => { if (it.ov && made[it.ov.id]) it.ov.id = made[it.ov.id]; });
    B.newAccs = B.newAccs.filter(a => !made[a.id]);
  }
  // layouts: save new ones; a recognized layout follows the account the user picked when it fits the file
  for (const it of ready) {
    if (it.configured && it.layoutName) {
      const fp = it.profile.fingerprint || it.analysis.fingerprint;
      const prof = Object.assign({}, it.profile, { name: it.layoutName, fingerprint: fp, defaultAccountId: it.accountId, updatedAt: now });
      const idx = d.profiles.findIndex(p => p.fingerprint === fp);
      if (idx >= 0) { prof.id = d.profiles[idx].id; d.profiles[idx] = prof; } else { prof.id = 'pf-' + Date.now().toString(36) + '-' + d.profiles.length; d.profiles.push(prof); }
      it.profileId = prof.id; metaN.add('profiles');
    } else if (it.matched) {
      it.profileId = it.matched.id;
      const idx = d.profiles.findIndex(p => p.id === it.matched.id);
      const fitsKind = !it.kind || !kindMismatch(it.kind, accType(it.accountId));
      if (idx >= 0 && fitsKind && (d.profiles[idx].defaultAccountId !== it.accountId || d.profiles[idx].name !== it.matched.name || JSON.stringify(d.profiles[idx].columns) !== JSON.stringify(it.profile.columns))) {
        d.profiles[idx] = Object.assign({}, d.profiles[idx], { defaultAccountId: it.accountId, name: it.matched.name, columns: it.profile.columns, updatedAt: now }); metaN.add('profiles');
      }
    }
  }
  const fxr = fxRatesAll();
  const res = eng('importBatch', live(), ready.map(it => ({ rows: it.analysis.rows, profile: it.profile, accountId: it.accountId, importId: it.importId, name: it.name, applyOpts: { fxRates: fxr } })), ctx());
  if (!res) return;
  const byId = new Map(res.transactions.map(t => [t.id, t]));
  commit({ txs: res.addedIds.concat(res.changedIds).map(id => byId.get(id)).filter(Boolean), render: false });
  d.imports = d.imports || {};
  const summary = [];
  for (const r of res.results) {
    const it = ready.find(x => x.importId === r.importId);
    const added = r.addedIds.map(id => txById(id)).filter(Boolean);
    const dts = added.map(t => t.date).sort();
    const parsedRes = eng('applyProfile', it.analysis.rows, it.profile, { accountId: it.accountId, importId: it.importId, fxRates: fxr }) || { transactions: [] };
    const parsed = parsedRes.transactions;
    d.imports[r.importId] = { id: r.importId, fileName: it.name, at: now, updatedAt: now, accountId: it.accountId, profileId: it.profileId || null, count: added.length,
      total: added.reduce((s, t) => s + t.amount, 0), from: dts[0] || null, to: dts[dts.length - 1] || null, duplicates: r.duplicates.length,
      hasBalance: parsed.some(t => t.balance != null), kindGuess: eng('guessAccountType', it.analysis, parsed) || null, batch: true };
    { const hn = eng('importHolder', it.analysis, parsedRes); if (hn) d.imports[r.importId].holderName = hn; }
    let note = '';
    if (it.pdf) {
      const f = pdfImportFields(it.pdf); Object.assign(d.imports[r.importId], f);
      if (f.cycleStart) { d.imports[r.importId].from = f.cycleStart; d.imports[r.importId].to = f.cycleEnd; }
    }
    note = pdfAdoptAccount(it.accountId, it.pdf, it.profile);
    if (!added.length) delete d.imports[r.importId]; // only duplicates (or an empty file): nothing to record
    summary.push({ name: it.name, importId: r.importId, imported: added.length, dup: r.duplicates.length, err: r.errors.length, auto: added.filter(t => t.categoryId).length, account: accName(it.accountId), note });
  }
  const addedAll = res.addedIds.map(id => txById(id)).filter(Boolean);
  const months = addedAll.map(t => ymOf(t.date)).sort(); if (months.length) S.ui.month = months[months.length - 1];
  B.items = B.items.filter(it => !ready.includes(it));
  B.done = { files: summary, imported: addedAll.length, auto: addedAll.filter(t => t.categoryId).length, importIds: summary.map(x => x.importId) };
  if (saveFxRates()) metaN.add('settings');
  commit({ meta: [...metaN] });
}
function renderBatchDone(b) {
  const B = S.imp.batch, D0 = B.done;
  const left = live().filter(t => D0.importIds.includes(t.importId) && isUncat(t)).length;
  b.innerHTML = `<div class="card" style="align-items:flex-start" id="batch-done">
    <span class="eyebrow">Importação concluída</span>
    <div class="result-big"><span class="num">${D0.imported}</span> importados de ${D0.files.length} arquivo${D0.files.length === 1 ? '' : 's'}</div>
    <div style="align-self:stretch">${D0.files.map(f => `<div class="bf-sum" data-imp="${esc(f.importId)}"><b class="small" style="overflow-wrap:anywhere">${esc(f.name)}</b><span class="xs muted">${esc(f.account)} · <b class="num">${f.imported}</b> importado${f.imported === 1 ? '' : 's'} · <b class="num">${f.dup}</b> duplicado${f.dup === 1 ? '' : 's'} · <b class="num ${f.err ? 'out' : ''}">${f.err}</b> com erro</span>${f.note ? `<span class="xs">${esc(f.note)}</span>` : ''}</div>`).join('')}</div>
    <p><b class="num in">${D0.auto}</b> categorizados automaticamente</p>
    <div class="row">${left ? `<button class="btn primary" type="button" data-act="triage" id="bf-triage">${left} para triagem</button>` : '<b class="in" id="bf-triage-done">tudo classificado ✓</b>'}<button class="btn" type="button" data-act="goto" data-tab="painel">Ver painel</button>
      ${B.items.length ? `<button class="btn" type="button" data-act="bf-pending-back" id="bf-back">Voltar aos ${B.items.length} pendente${B.items.length === 1 ? '' : 's'}</button>` : ''}<button class="btn ghost" type="button" data-act="imp-reset">Importar outros</button></div></div>`;
}
/* ================= data operations ================= */
function ensureReal() {
  if (S.mode === 'real') return;
  if (!S.real) S.real = emptyData();
  // keep taxonomy/rules edits the user made while exploring the example
  S.real.categories = clone(S.example.categories); S.real.settings = clone(S.example.settings) || { budgets: {} };
  S.real.settings.budgets = clone(S.example.userBudgets || {});
  S.real.settings.schemaVersion = 2;
  S.real.rules = clone(S.example.rules); S.real.history = clone(S.example.history || []);
  S.real.profiles = clone(S.example.profiles || []);
  S.real.accounts = S.real.accounts && S.real.accounts.length ? S.real.accounts : [];
  S.real.imports = S.real.imports || {};
  S.real.txs = (S.real.txs || []).filter(t => t && !t.deleted);
  S.mode = 'real';
  ['settings', 'categories', 'rules', 'profiles', 'accounts', 'imports'].forEach(n => P.meta.add(n));
}
function addAccount(name, type) {
  const d = D();
  let id = slug(name); const ids = new Set(d.accounts.map(a => a.id)); let k = 2; const base = id; while (ids.has(id)) id = base + '-' + (k++);
  d.accounts.push({ id, name: String(name).trim(), type });
  P.meta.add('accounts');
  return id;
}
/** classifies the fresh rows, links card payments across everything (FinEngine.ingest); commits new + changed rows (no render) */
function addTransactions(fresh) {
  const r = eng('ingest', live(), fresh, ctx()) || { added: fresh, changed: [] };
  commit({ txs: r.changed.concat(r.added), render: false });
  return fresh.map(t => txById(t.id)).filter(Boolean);
}
function reclassifyUncategorized() {
  const list = live().filter(t => !t.categoryId && countable(t) && t.catSource !== 'manual');
  if (!list.length) return 0;
  const res = eng('classifyAll', list, ctx());
  if (!Array.isArray(res)) return 0;
  const changed = [];
  res.forEach((t, i) => { if (t.categoryId) { const o = list[i]; const k = kindFor(t.categoryId); changed.push(Object.assign({}, o, { categoryId: t.categoryId, catSource: t.catSource, kind: (o.kind === 'card_payment' || o.kind === 'transfer') ? o.kind : (k || t.kind) })); } });
  if (changed.length) commit({ txs: changed, render: false });
  return changed.length;
}

/* ---------- holerite (adiantamento + date mask) ---------- */
function holDefaults() {
  const date = todayISO().slice(0, 8) + '05';
  return { date, employer: '', gross: '', inss: '', irrf: '', others: [], net: '', netTouched: false, result: null,
    adv: false, advPct: '40', advDate: (E.defaultAdvanceDate ? E.defaultAdvanceDate(date) : ''), advDateTouched: false };
}
function holSplit(H) {
  return eng('payslipSplit', { date: H.date, gross: parseMoney(H.gross) || 0, inss: parseMoney(H.inss) || 0, irrf: parseMoney(H.irrf) || 0,
    otherDeductions: H.others.map(o => ({ name: o.name, amount: parseMoney(o.amount) || 0 })), net: H.netTouched ? parseMoney(H.net) : null,
    advance: { enabled: H.adv, percent: Number(String(H.advPct).replace(',', '.')) || 0, date: H.advDate || null } }) || { gross: 0, net: 0, advance: 0, finalDeposit: 0 };
}
function renderHolerite() {
  const I = S.imp;
  if (!I.hol) I.hol = holDefaults();
  const H = I.hol;
  const ded = (parseMoney(H.inss) || 0) + (parseMoney(H.irrf) || 0) + H.others.reduce((s, o) => s + (parseMoney(o.amount) || 0), 0);
  const calc = (parseMoney(H.gross) || 0) - ded;
  if (!H.netTouched) H.net = H.gross ? centsToInput(calc) : '';
  const net = parseMoney(H.net);
  const mismatch = H.netTouched && net != null && Math.abs(net - calc) > 1;
  if (H.adv && !H.advDateTouched && brToISO(isoToBR(H.date))) H.advDate = E.defaultAdvanceDate(H.date);
  $('#hol').innerHTML = H.result ? `<div class="card" id="hol-done"><span class="eyebrow">Holerite importado</span><div class="result-big">${H.result} lançamento${H.result > 1 ? 's' : ''}</div><p class="small muted">Salário bruto entra como renda${H.adv ? ' (dividido entre adiantamento e saldo)' : ''}, e os descontos aparecem como "Impostos" no fluxo do painel.</p><div class="row"><button class="btn primary" type="button" data-act="goto" data-tab="painel">Ver painel</button><button class="btn ghost" type="button" data-act="hol-reset">Lançar outro</button></div></div>` : `
    <div class="card">
      <h3>Lançar holerite</h3>
      <div class="form-grid">
        ${dateField('hol-date', H.date, 'Data do pagamento')}
        <div class="field"><label for="hol-emp">Empresa</label><input type="text" id="hol-emp" value="${esc(H.employer)}" placeholder="Ex.: Acme Tecnologia"></div>
        <div class="field full"><label for="hol-gross">Salário bruto (R$)</label><input type="text" inputmode="decimal" class="money-in hol-in" id="hol-gross" value="${esc(H.gross)}" placeholder="12.000,00"></div>
        <div class="field"><label for="hol-inss">INSS (R$)</label><input type="text" inputmode="decimal" class="money-in hol-in" id="hol-inss" value="${esc(H.inss)}" placeholder="951,59"></div>
        <div class="field"><label for="hol-irrf">IRRF (R$)</label><input type="text" inputmode="decimal" class="money-in hol-in" id="hol-irrf" value="${esc(H.irrf)}" placeholder="2.142,31"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Outros descontos</span>
        ${H.others.map((o, i) => `<div class="od-row"><div class="field"><input type="text" id="hol-od-n-${i}" data-od="${i}" data-f="name" value="${esc(o.name)}" placeholder="Plano de saúde" aria-label="Nome do desconto"></div><div class="field"><input type="text" inputmode="decimal" class="money-in hol-in" id="hol-od-v-${i}" data-od="${i}" data-f="amount" value="${esc(o.amount)}" placeholder="0,00" aria-label="Valor"></div><button class="icon-btn" type="button" data-act="hol-del" data-i="${i}" aria-label="Remover desconto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('')}
        <button class="btn ghost sm" type="button" data-act="hol-add" style="align-self:flex-start">+ Adicionar desconto</button>
      </div>
      <div class="field"><label for="hol-net">Líquido (R$)</label><input type="text" inputmode="decimal" class="money-in" id="hol-net" value="${esc(H.net)}"><span class="xs muted" id="hol-calc">Calculado: ${brl(calc)}. Edite se o holerite mostrar outro valor.</span></div>
      ${mismatch ? `<div class="banner"><div>O líquido informado difere do calculado em <b class="money">${brl(Math.abs(net - calc))}</b>. Confira se falta algum desconto (VT, VR, pensão, previdência privada).</div></div>` : ''}
      <label class="switch" for="hol-adv"><input type="checkbox" id="hol-adv" ${H.adv ? 'checked' : ''}>Adiantamento salarial</label>
      <div id="hol-adv-box" ${H.adv ? '' : 'hidden'} style="display:flex;flex-direction:column;gap:10px">
        <div class="form-grid">
          <div class="field"><label for="hol-adv-pct">Percentual do bruto (%)</label><input type="text" inputmode="decimal" class="money-in" id="hol-adv-pct" value="${esc(H.advPct)}"></div>
          ${dateField('hol-adv-date', H.advDate, 'Data do adiantamento')}
        </div>
      </div>
      <div id="hol-split">${holSplitHTML(H)}</div>
      <div class="row end"><button class="btn primary" type="button" data-act="hol-save">Importar holerite</button></div>
    </div>`;
}
function holLiveNet(H) {
  const ded = (parseMoney(H.inss) || 0) + (parseMoney(H.irrf) || 0) + H.others.reduce((s, o) => s + (parseMoney(o.amount) || 0), 0);
  const calc = (parseMoney(H.gross) || 0) - ded;
  if (!H.netTouched) { H.net = H.gross ? centsToInput(calc) : ''; const n = $('#hol-net'); if (n) n.value = H.net; }
  const c = $('#hol-calc'); if (c) c.textContent = 'Calculado: ' + brl(calc) + '. Edite se o holerite mostrar outro valor.';
}
function holSplitHTML(H) {
  holLiveNet(H);
  const sp = holSplit(H);
  if (!sp.gross) return '';
  const advD = sp.advanceDate || H.advDate;
  return `<div class="split" id="hol-split-box" aria-live="polite">
    <span>Salário bruto (renda)</span><span class="money">${brl(sp.gross)}</span>
    <span>Descontos (INSS, IRRF, outros)</span><span class="money out">-${brl(sp.deductions)}</span>
    ${H.adv && sp.advance ? `<span>Adiantamento ${esc(String(sp.percent).replace('.', ','))}% do bruto · ${esc(isoToDM(advD))}</span><span class="money" id="hol-split-adv">${brl(sp.advance)}</span>
    <span>Depósito final (líquido − adiantamento) · ${esc(isoToDM(H.date))}</span><span class="money" id="hol-split-final">${brl(sp.finalDeposit)}</span>` : ''}
    <span class="tot">Líquido total</span><span class="money tot" id="hol-split-net">${brl(sp.net)}</span></div>`;
}
function readHolerite() {
  const H = S.imp.hol; if (!H) return;
  const v = id => ($(id) || {}).value;
  const d = brToISO(v('#hol-date') || ''); if (d) H.date = d;
  H.employer = v('#hol-emp') ?? H.employer; H.gross = v('#hol-gross') ?? H.gross;
  H.inss = v('#hol-inss') ?? H.inss; H.irrf = v('#hol-irrf') ?? H.irrf;
  const adv = $('#hol-adv'); if (adv) H.adv = adv.checked;
  H.advPct = v('#hol-adv-pct') ?? H.advPct;
  const ad = brToISO(v('#hol-adv-date') || ''); if (ad && ad !== H.advDate) { H.advDate = ad; }
  $$('[data-od]').forEach(inp => { const o = H.others[+inp.dataset.od]; if (o) o[inp.dataset.f] = inp.value; });
}
function saveHolerite() {
  readHolerite(); const H = S.imp.hol;
  const date = readDateField('hol-date', true);
  if (!date) { toast('Data do pagamento inválida. Use dd/mm/aaaa.', true); return; }
  H.date = date;
  let advDate = null;
  if (H.adv) { advDate = readDateField('hol-adv-date', true); if (!advDate) { toast('Data do adiantamento inválida.', true); return; } H.advDate = advDate; }
  const gross = parseMoney(H.gross); if (!gross) { toast('Informe o salário bruto.', true); return; }
  if (!H.employer.trim()) { toast('Informe a empresa.', true); return; }
  const pct = Number(String(H.advPct).replace(',', '.'));
  if (H.adv && !(pct > 0 && pct < 100)) { toast('Percentual do adiantamento deve ficar entre 0 e 100.', true); return; }
  if (signedOut()) { toast('Entre na sua conta para importar e sincronizar.', true); return; }
  ensureReal();
  const accId = 'holerite-' + slug(H.employer);
  if (!S.real.accounts.some(a => a.id === accId)) { S.real.accounts.push({ id: accId, name: 'Holerite ' + H.employer.trim(), type: 'payslip' }); P.meta.add('accounts'); }
  const importId = 'hol-' + Date.now().toString(36);
  const txs = eng('payslipToTransactions', { date: H.date, gross, inss: parseMoney(H.inss) || 0, irrf: parseMoney(H.irrf) || 0,
    otherDeductions: H.others.filter(o => o.name || o.amount).map(o => ({ name: o.name || 'Desconto', amount: parseMoney(o.amount) || 0 })), net: parseMoney(H.net), employer: H.employer.trim(), accountId: accId,
    importId, advance: { enabled: H.adv, percent: pct, date: advDate } });
  if (!Array.isArray(txs) || !txs.length) { toast('Não consegui gerar os lançamentos do holerite.', true); return; }
  const dd = eng('dedupe', live(), txs) || { fresh: txs, duplicates: [] };
  if (!dd.fresh.length) { toast('Este holerite já foi importado.', true); return; }
  const added = addTransactions(dd.fresh.map(t => Object.assign({}, t, { importId })));
  S.real.imports[importId] = { id: importId, fileName: 'Holerite ' + H.employer.trim() + ' ' + isoToBR(H.date), at: nowISO(), accountId: accId, profileId: null, count: added.length, total: added.reduce((s, t) => s + t.amount, 0) };
  H.result = added.length; S.ui.month = ymOf(H.date) || S.ui.month;
  commit({ meta: ['accounts', 'imports'] });
}
/* ================= CATEGORIAS ================= */
function renderCats(){
  const el = $('#scr-cats'); const d = D();
  const budgets = d.settings.budgets||{};
  const ruleText = r => {
    if(r.origin==='installment' && r.series) return `compra parcelada <code>${esc(r.series.merchant)}</code> de ${esc(isoToBR(r.series.start))} em ${r.series.total}x → <b>${esc(catLabel(r.set&&r.set.categoryId))}</b> <span class="xs faint">até ${esc(fmtYm(r.expiresAfter||''))}</span>`;
    const opT = {contains:'contém', equals:'é igual a', startsWith:'começa com', regex:'casa com'}[r.match&&r.match.op]||'';
    const fT = (r.match&&r.match.field)==='rawDescription' ? 'descrição' : 'estabelecimento';
    return `${fT} ${opT} <code>${esc(r.match&&r.match.value)}</code> → <b>${esc(catLabel(r.set&&r.set.categoryId))}</b>${r.set&&r.set.kind?` · ${esc(KIND_LBL[r.set.kind]||r.set.kind)}`:''}`;
  };
  const originTag = o => `<span class="tag ${o==='ai'?'acc':o==='learned'||o==='installment'?'ok':''}">${o==='ai'?'IA':o==='learned'?'aprendida':o==='installment'?'só esta compra':'sua'}</span>`;
  const unc = [...new Set(live().filter(isUncat).map(t=>t.merchant).filter(Boolean))];
  el.innerHTML = `
    <h2 style="font-size:1.35rem">Categorias</h2>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${(d.categories||[]).map(g=>`<details class="grp" ${S.ui.openGroup===g.id?'open':''} data-gid="${esc(g.id)}"><summary><span class="sw" style="background:${esc(g.color)}"></span><span class="grow" style="font-weight:650">${esc(g.name)}</span>${g.kind!=='income'&&budgets[g.id]?`<span class="small muted money">${brlShort(budgets[g.id])}/mês</span>`:''}</summary>
        <div class="grp-body">
          <div class="row" style="align-items:flex-end;flex-wrap:nowrap">
            <div class="field grow"><label for="g-name-${esc(g.id)}">Nome</label><input type="text" id="g-name-${esc(g.id)}" data-gname="${esc(g.id)}" value="${esc(g.name)}"></div>
            <div class="field"><label for="g-color-${esc(g.id)}">Cor</label><input type="color" class="color-in" id="g-color-${esc(g.id)}" data-gcolor="${esc(g.id)}" value="${esc(/^#[0-9a-f]{6}$/i.test(g.color)?g.color:'#1d4fa0')}"></div>
          </div>
          ${g.kind!=='income'?`<div class="field"><label for="g-bud-${esc(g.id)}">Orçamento mensal (R$)</label><input type="text" inputmode="decimal" class="money-in" id="g-bud-${esc(g.id)}" data-gbud="${esc(g.id)}" value="${esc(budgets[g.id]?centsToInput(budgets[g.id]):'')}" placeholder="Sem limite"></div>`:''}
          <span class="lbl">Subcategorias</span>
          <div style="display:flex;flex-direction:column;gap:6px">${(g.children||[]).map(c=>`<input type="text" id="c-name-${esc(c.id)}" data-cname="${esc(c.id)}" data-g="${esc(g.id)}" value="${esc(c.name)}" aria-label="Nome da subcategoria ${esc(c.name)}">`).join('')}</div>
          <div class="row" style="flex-wrap:nowrap"><input type="text" id="c-new-${esc(g.id)}" placeholder="Nova subcategoria" aria-label="Nova subcategoria em ${esc(g.name)}"><button class="btn sm" type="button" data-act="addchild" data-g="${esc(g.id)}">Adicionar</button></div>
        </div></details>`).join('')}
    </div>
    <div class="row"><button class="btn sm" type="button" data-act="nc-open" data-p="cat">+ Nova categoria</button></div>
    ${newCatForm('cat')}
    <div class="card">
      <div class="card-h"><h2>Regras</h2><button class="btn sm" type="button" data-act="rule-new">Nova regra</button></div>
      <p class="small muted">Aplicadas antes do dicionário. As aprendidas surgem quando você escolhe uma categoria com "Lembrar esta categoria" marcado. Categorias manuais nunca são trocadas por regras.</p>
      ${(d.rules||[]).length?`<div id="rule-list">${d.rules.slice().sort((a,b)=>(b.priority||0)-(a.priority||0)).map(r=>`<div class="rule" data-rule="${esc(r.match?r.match.value:(r.series?r.series.merchant:''))}"><div class="txt">${ruleText(r)} ${originTag(r.origin)}${r.hits?` <span class="xs faint">${r.hits} uso${r.hits>1?'s':''}</span>`:''}</div>
        ${r.origin==='installment'?'':`<button class="btn sm" type="button" data-act="rule-edit" data-id="${esc(r.id)}">Editar</button>`}
        ${S.ui.confirmRule===r.id?`<button class="btn sm danger" type="button" data-act="rule-del" data-id="${esc(r.id)}">Confirmar</button>`:`<button class="btn sm" type="button" data-act="rule-ask" data-id="${esc(r.id)}" aria-label="Excluir regra">Excluir</button>`}</div>`).join('')}</div>`:'<p class="small muted">Nenhuma regra ainda.</p>'}
    </div>
    <div class="card" id="ai-cat-card" ${FEATURES.ai&&S.sample?'':'hidden'}>
      <div class="card-h"><h2>Sugerir categorias com IA</h2></div>
      ${unc.length?`<div class="sent-box"><b>O que é enviado:</b> só os ${unc.length} nomes de estabelecimentos sem categoria e a lista de códigos de categoria. Sem valores, datas ou nomes de contas.
        <details><summary>Ver nomes</summary><pre>${esc(unc.join('\n'))}</pre></details></div>`:'<p class="small muted">Nenhum estabelecimento sem categoria agora.</p>'}
      <div id="ai-sug">${renderSuggestions()}</div>
      ${FEATURES.ai && unc.length && !(S.aiSug && S.aiSug.items) ?`<div class="row"><button class="btn" type="button" data-act="ai-cats" ${S.aiSug&&S.aiSug.busy?'disabled':''}>${S.aiSug&&S.aiSug.busy?'<span class="spinner"></span> Analisando…':'Sugerir categorias com IA'}</button></div>`:''}
    </div>`;
}
function renderSuggestions(){
  const s = S.aiSug; if(!s) return '';
  if(s.err) return `<div class="banner err"><div>${esc(s.err)}</div></div>`;
  if(!s.items) return '';
  if(!s.items.length) return '<p class="small muted">A IA não teve sugestões confiáveis.</p>';
  return `<div>${s.items.map((it,i)=>`<div class="sug"><input type="checkbox" id="sug-ok-${i}" data-sug="${i}" ${it.ok?'checked':''} aria-label="Aprovar ${esc(it.merchant)}"><div class="grow" style="min-width:0"><label for="sug-ok-${i}" style="font-weight:650;overflow-wrap:anywhere">${esc(it.merchant)}</label>
    <select id="sug-cat-${i}" data-sugcat="${i}" aria-label="Categoria para ${esc(it.merchant)}">${categoryOptions(it.categoryId)}</select></div></div>`).join('')}</div>
    <div class="row end"><button class="btn" type="button" data-act="ai-cats-clear">Descartar</button><button class="btn primary" type="button" data-act="ai-cats-apply">Criar regras aprovadas</button></div>`;
}
async function runAICategories(){
  const sample = FEATURES.ai ? S.sample : null; if(!sample) return;
  const merchants = [...new Set(live().filter(isUncat).map(t=>t.merchant).filter(Boolean))].slice(0,150);
  const ids = []; (D().categories||[]).forEach(g=>{ ids.push(g.id); (g.children||[]).forEach(c=>ids.push(c.id)); });
  S.aiSug = { busy:true }; renderCats();
  const prompt = 'Você classifica estabelecimentos de extratos bancários brasileiros em categorias de orçamento pessoal.\n'
    + 'Categorias permitidas (use exatamente estes ids):\n' + ids.join('\n')
    + '\n\nEstabelecimentos:\n' + merchants.join('\n')
    + '\n\nResponda só com um array JSON de objetos {"merchant": "<nome exatamente como veio>", "categoryId": "<id da lista>"}. Omita os que você não souber classificar com confiança. Exemplo: [{"merchant":"PADARIA SAO JORGE","categoryId":"alimentacao.padaria"}]';
  try{
    const out = await sample.json(prompt, { modelTier:'quick' });
    const valid = new Set(ids); const ms = new Set(merchants);
    const items = (Array.isArray(out)?out:[]).filter(x=>x && ms.has(x.merchant) && valid.has(x.categoryId)).map(x=>({ merchant:x.merchant, categoryId:x.categoryId, ok:true }));
    S.aiSug = { items };
  }catch(e){
    S.aiSug = { err: ({not_granted:'Uso da IA não autorizado.', rate_limited:'Muitas chamadas seguidas. Tente em um minuto.', invalid_json:'Resposta em formato inesperado. Tente de novo.'})[e&&e.code] || 'A IA não respondeu ('+(e&&(e.code||e.message)||e)+').' };
  }
  renderCats();
}
function applyAISuggestions(){
  const s = S.aiSug; if(!s || !s.items) return;
  $$('[data-sug]').forEach(cb=>{ s.items[+cb.dataset.sug].ok = cb.checked; });
  $$('[data-sugcat]').forEach(sel=>{ s.items[+sel.dataset.sugcat].categoryId = sel.value; });
  const ok = s.items.filter(i=>i.ok);
  ok.forEach((it,k)=>D().rules.push({ id:'ai-'+Date.now().toString(36)+'-'+k, match:{ field:'merchant', op:'equals', value:it.merchant }, set:{ categoryId:it.categoryId }, origin:'ai', priority:40, hits:0 }));
  P.meta.add('rules');
  const n = reclassifyUncategorized();
  S.aiSug = null; commit({ meta:['rules'] });
  toast(ok.length+' regra'+(ok.length===1?'':'s')+' criada'+(ok.length===1?'':'s')+' · '+n+' lançamento'+(n===1?'':'s')+' categorizado'+(n===1?'':'s'));
}
function openRuleEditor(id){
  const r = id ? D().rules.find(x=>x.id===id) : null;
  const m = r ? r.match : { field:'merchant', op:'contains', value:'' };
  openSheet(`<h2>${r?'Editar regra':'Nova regra'}</h2>`, `
    <div class="form-grid">
      <div class="field"><label for="rl-field">Campo</label><select id="rl-field"><option value="merchant" ${m.field==='merchant'?'selected':''}>Estabelecimento</option><option value="rawDescription" ${m.field==='rawDescription'?'selected':''}>Descrição original</option></select></div>
      <div class="field"><label for="rl-op">Condição</label><select id="rl-op">${[['contains','contém'],['equals','é igual a'],['startsWith','começa com'],['regex','expressão regular']].map(([k,v])=>`<option value="${k}" ${m.op===k?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field full"><label for="rl-value">Texto</label><input type="text" id="rl-value" value="${esc(m.value)}" placeholder="Ex.: IFOOD" autocapitalize="characters"></div>
      <div class="field full cat-picker"><label for="rl-cat">Categoria</label>${catSelect('rl-cat', r&&r.set?r.set.categoryId:null)}${newCatForm('rl')}</div>
      <div class="field full"><label for="rl-kind">Tipo (opcional)</label><select id="rl-kind"><option value="">Manter</option>${Object.entries(KIND_LBL).map(([k,v])=>`<option value="${k}" ${r&&r.set&&r.set.kind===k?'selected':''}>${v}</option>`).join('')}</select></div>
    </div>
    <p class="small muted" id="rl-preview"></p>
    <div class="row end"><button class="btn" type="button" data-act="closesheet">Cancelar</button><button class="btn primary" type="button" data-act="rule-save" data-id="${esc(id||'')}">Salvar regra</button></div>`, null, { kind:'rule', label: r?'Editar regra':'Nova regra' });
  updateRulePreview();
}
function updateRulePreview(){
  const el = $('#rl-preview'); if(!el) return;
  const f = $('#rl-field').value, op = $('#rl-op').value, v = $('#rl-value').value.trim();
  if(!v){ el.textContent=''; return; }
  let re = null; if(op==='regex'){ try{ re = new RegExp(v,'i'); }catch(e){ el.textContent='Expressão regular inválida.'; return; } }
  const V = v.toUpperCase();
  const n = live().filter(t=>{ const s = String(t[f]||'').toUpperCase(); return op==='contains'?s.includes(V):op==='equals'?s===V:op==='startsWith'?s.startsWith(V):re.test(s); }).length;
  el.textContent = n+' lançamento'+(n===1?'':'s')+' atende'+(n===1?'':'m')+' a esta condição.';
}
function saveRule(id){
  const v = $('#rl-value').value.trim(); if(!v){ toast('Digite o texto da regra.', true); return; }
  if($('#rl-op').value==='regex'){ try{ new RegExp(v); }catch(e){ toast('Expressão regular inválida.', true); return; } }
  const cv = $('#rl-cat').value; if(!cv || cv==='__new'){ toast('Escolha ou crie a categoria da regra.', true); return; }
  const set = { categoryId: cv }; const k = $('#rl-kind').value; if(k) set.kind = k;
  const rule = { id: id || 'r-'+Date.now().toString(36), match:{ field:$('#rl-field').value, op:$('#rl-op').value, value: $('#rl-op').value==='regex'? v : v.toUpperCase() }, set, origin:'user', priority:100, hits:0 };
  if(id){ const i = D().rules.findIndex(r=>r.id===id); if(i>=0){ rule.origin = D().rules[i].origin==='user'?'user':D().rules[i].origin; rule.priority = D().rules[i].priority; rule.hits = D().rules[i].hits||0; D().rules[i] = rule; } }
  else D().rules.push(rule);
  closeSheet();
  const n = reclassifyUncategorized(); commit({ meta:['rules'] });
  toast('Regra salva'+(n?' · '+n+' categorizado'+(n>1?'s':''):''));
}

/* ================= example data ================= */
function buildExample(){
  const d = emptyData();
  d.accounts = [
    { id:'itau-cc', name:'Itaú conta', type:'checking' },
    { id:'nubank-cartao', name:'Nubank cartão', type:'credit_card' },
    { id:'va-beneficio', name:'VA benefício', type:'checking' },
    { id:'holerite-acme', name:'Holerite Acme', type:'payslip' }
  ];
  d.settings.budgets = { alimentacao:180000, moradia:400000, transporte:70000, lazer:40000, saude:50000 };
  let seed = 7; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
  const between = (a,b) => Math.round((a + rnd()*(b-a)))*1;
  let n = 0; const txs = [];
  const mk = (date, amount, raw, accountId, extra) => {
    let norm = { merchant: raw.toUpperCase(), installment: null };
    try{ norm = Object.assign(norm, E.normalizeDescription(raw)); }catch(e){}
    txs.push(Object.assign({ id:'ex-'+(++n), date, amount, rawDescription:raw, merchant:norm.merchant, installment:norm.installment||null,
      accountId, kind: amount>0?'income':'expense', categoryId:null, catSource:null, importId:'exemplo' }, extra||{}));
  };
  const months = ['2026-07','2026-08','2026-09'];
  let prevCard = 412350;
  months.forEach((ym, mi) => {
    const day = k => ym+'-'+pad2(k);
    // payslip
    const gross=1200000, inss=95159, irrf=214231, saude=18000;
    const net = gross-inss-irrf-saude;
    const slip = (()=>{ try{ return E.payslipToTransactions({ date:day(5), gross, inss, irrf, otherDeductions:[{name:'Plano de saúde', amount:saude}], net, employer:'Acme Tecnologia', accountId:'holerite-acme' }); }catch(e){ return null; } })();
    if(Array.isArray(slip) && slip.length){ slip.forEach(t=>{ t.id = t.id || 'ex-'+(++n); t.importId='exemplo'; txs.push(t); }); }
    else mk(day(5), net, 'SALARIO ACME TECNOLOGIA', 'holerite-acme', { kind:'income' });
    mk(day(5), net, 'TED RECEBIDA ACME TECNOLOGIA LTDA', 'itau-cc', { kind:'transfer' });
    // VA
    mk(day(1), 110000, 'CREDITO BENEFICIO VA ALELO', 'va-beneficio', { kind:'income' });
    mk(day(between(3,9)), -between(22000,38000), 'SUPERMERCADO DIA%', 'va-beneficio');
    mk(day(between(12,18)), -between(25000,41000), 'CARREFOUR HIPER', 'va-beneficio');
    mk(day(between(20,27)), -between(9000,16000), 'HORTIFRUTI VILA MADALENA', 'va-beneficio');
    // checking
    mk(day(6), -280000, 'PIX ENVIADO JOAO CARLOS IMOVEIS LTDA', 'itau-cc');
    mk(day(10), -72000, 'BOLETO CONDOMINIO ED AURORA', 'itau-cc');
    mk(day(12), -between(19800,27500), 'ENEL SP CONTA ENERGIA', 'itau-cc');
    mk(day(15), -12999, 'VIVO FIBRA INTERNET', 'itau-cc');
    mk(day(8), -prevCard, 'PAGAMENTO FATURA NUBANK', 'itau-cc', { kind:'card_payment' });
    mk(day(7), -150000, 'APLICACAO CDB ITAU', 'itau-cc', { kind:'investment' });
    mk(day(20), -3990, 'TARIFA PACOTE SERVICOS', 'itau-cc');
    if(mi!==1) mk(day(between(14,24)), between(12000,30000), 'PIX RECEBIDO MARIANA S OLIVEIRA', 'itau-cc', { kind:'income' });
    if(mi===2) mk(day(18), 85000, 'PIX RECEBIDO FREELA DESIGN', 'itau-cc', { kind:'income' });
    // card
    let card = 0; const c = (k, v, raw) => { card += v; mk(day(k), -v, raw, 'nubank-cartao'); };
    for(let i=0;i<7;i++) c(between(1,28), between(3200,9400), 'IFOOD *IFOOD'+(i%2?' RESTAURANTE':''));
    txs[txs.length-1].time = pad2(between(11,22))+':'+pad2(between(0,59));
    for(let i=0;i<9;i++) c(between(1,28), between(1400,4800), i%4===3 ? '99APP *99RIDE' : 'UBER *TRIP HELP.UBER.COM');
    c(between(2,8), between(28000,46000), 'PAO DE ACUCAR 1234');
    c(between(14,22), between(18000,32000), 'ASSAI ATACADISTA');
    c(3, 5590, 'NETFLIX.COM');
    c(9, 2190, 'SPOTIFY');
    c(11, 11990, 'SMARTFIT MENSALIDADE');
    c(between(5,25), between(18000,26000), 'SHELL BOX POSTO');
    c(between(5,25), between(4500,13000), 'DROGASIL 0412');
    c(16, 18990, 'AMAZON MARKETPLACE PARC '+pad2(mi+3)+'/10');
    c(21, 34900, 'MAGALU PARCELA '+(mi+1)+'/6');
    if(mi===2) c(19, 59900, 'CASAS BAHIA PARC 01/12');
    // the uncategorized backlog: small local merchants a dictionary will not know
    const local = [
      ['PAG*JOSEFERREIRA', 3800, 6500], ['MP *QUITANDAFLOR', 2400, 5200], ['SUMUP *BAR DO ZECA', 6800, 14500],
      ['EC *ARTESANATO MINAS', 4500, 9800], ['LOJA DONA CIDA', 2900, 7900], ['PAG*ESTAC CENTRAL', 1500, 3200],
      ['CIELO *PADARIA S JORGE', 1200, 3600], ['STONE *BARBEARIA DOM', 4500, 6000], ['PICPAY *ACADEMIA YOGA SOL', 9000, 12000]
    ];
    local.forEach((l,i)=>{ if((i+mi)%3!==0 || mi===2) c(between(1,28), between(l[1],l[2]), l[0]); });
    prevCard = card;
  });
  let out = txs;
  const lk = (()=>{ try{ return E.linkCardPayments(out, d.accounts); }catch(e){ return null; } })(); if(Array.isArray(lk)) out = lk;
  const cl = (()=>{ try{ return E.classifyAll(out, { rules:[], dictionary:E.DEFAULT_DICTIONARY||[], categories:d.categories, accounts:d.accounts }); }catch(e){ return null; } })(); if(Array.isArray(cl)) out = cl;
  // keep the kinds the example set by construction
  const forced = {}; txs.forEach(t=>{ if(t.kind==='transfer'||t.kind==='card_payment'||t.kind==='investment') forced[t.id]=t.kind; });
  out.forEach(t=>{ if(forced[t.id]) t.kind = forced[t.id]; if(t.kind==='transfer'||t.kind==='card_payment'){ t.categoryId = t.categoryId||null; } });
  d.txs = out.map(t => Object.assign(t, { updatedAt: '2026-09-30T12:00:00.000Z' }));
  d.imports = (E.backfillImports ? E.backfillImports(d.txs, {}).imports : {});
  return d;
}


/* ================= SETTINGS / ACCOUNT / BACKUP ================= */
function applyTheme(t) {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
}
function storageText() {
  if (signedOut()) return 'Você não entrou. Nada é salvo: entre para guardar e sincronizar seus dados entre PC e celular.';
  if (S.auth.mode === 'local') return 'Modo local: os dados ficam só neste navegador (desenvolvimento). Exporte um backup de vez em quando.';
  if (S.auth.mode === 'artifact') {
    const sa = { synced: 'Sincronizado.', saving: 'Salvando alterações…', offline: 'Sem conexão: as alterações sobem quando voltar.', error: 'Houve um erro ao salvar' + (store && store.lastError ? ': ' + store.lastError : '.') }[S.status] || '';
    return 'Dados guardados na sua conta do claude.ai (só você vê) e sincronizados entre os seus aparelhos. ' + sa;
  }
  const st = { synced: 'Sincronizado com a sua conta.', saving: 'Salvando alterações…', offline: 'Sem conexão: as alterações ficam guardadas aqui e sobem quando a internet voltar.', error: 'Houve um erro ao salvar. Vamos tentar de novo.' }[S.status] || '';
  return (S.auth.user ? 'Conta: ' + S.auth.user.email + '. ' : '') + st;
}
function openSettings(step) {
  const theme = ls.get('ff-theme') || 'system';
  const st = S.mode === 'example' && !signedOut() ? 'Você está vendo dados de exemplo. Nada é salvo até você importar. ' + storageText() : storageText();
  const nTx = S.real ? (S.real.txs || []).filter(t => t && !t.deleted).length : 0;
  let danger;
  if (step === 'wipe') danger = `<div class="banner err"><div class="grow"><b>Apagar todos os seus dados?</b> ${nTx} lançamentos, contas, regras, layouts e orçamentos. Não dá para desfazer.</div></div><div class="row end"><button class="btn" type="button" data-act="settings">Cancelar</button><button class="btn danger" type="button" data-act="wipe-yes">Apagar tudo</button></div>`;
  else if (step === 'restore') {
    const n = S._restore && S._restore.stats ? S._restore.stats.transactions : '?';
    danger = `<div class="banner" id="restore-confirm"><div class="grow"><b>Substituir seus dados pelo backup?</b> ${n} lançamentos no arquivo. O que está salvo agora será trocado.</div></div><div class="row end"><button class="btn" type="button" data-act="settings">Cancelar</button><button class="btn primary" type="button" data-act="restore-yes" id="restore-yes">Substituir</button></div>`;
  } else danger = `<div class="row">
      ${S.mode === 'real' ? '<button class="btn" type="button" data-act="example-view">Ver dados de exemplo</button>' : (S.real && (S.real.txs || []).length ? '<button class="btn" type="button" data-act="example-exit">Voltar aos meus dados</button>' : '')}
      ${S.real && ((S.real.txs || []).length || (S.real.accounts || []).length) ? '<button class="btn" type="button" data-act="wipe-ask" style="color:var(--out)">Apagar tudo</button>' : ''}</div>`;
  openSheet('<h2>Ajustes</h2>', `
    <div class="field"><span class="lbl">Tema</span><div class="seg" role="group" aria-label="Tema">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, v]) => `<button type="button" data-act="theme" data-v="${k}" aria-pressed="${theme === k}">${v}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Armazenamento</span><p class="small">${esc(st)}</p>
      ${signedOut() ? '<div class="row"><button class="btn primary sm" type="button" data-act="login">Entrar</button></div>' : ''}</div>
    <div class="field"><span class="lbl">Contas</span><div class="row"><button class="btn" type="button" data-act="accounts" id="btn-accounts">Contas e importações</button><button class="btn" type="button" data-act="manage" id="btn-manage">Gerenciar dados</button><button class="btn" type="button" data-act="transfers" id="btn-transfers">Transferências e seus nomes</button></div>
      <p class="xs faint">Gerenciar dados: excluir o que entrou errado — um arquivo, um mês, uma conta ou lançamentos escolhidos.</p></div>
    <div class="field" id="carry-set">${carrySettingsHTML()}</div>
    ${fxSettingsHTML()}
    <div class="field"><span class="lbl">Backup</span>
      <div class="row"><button class="btn" type="button" data-act="export" id="btn-export" ${S.mode === 'real' && store ? '' : 'disabled'}>Exportar backup</button>
      <input type="file" id="restore-file" class="file-in" accept="${BACKUP_ACCEPT}"><label class="btn" for="restore-file">Importar backup</label></div>
      <p class="xs faint">O backup é um arquivo JSON com tudo (lançamentos, contas, regras, layouts). "Importar backup" aceita também o backup da versão anterior.</p></div>
    <div class="field"><span class="lbl">Dados</span>${danger}</div>`, null, { kind: 'settings', label: 'Ajustes' });
}
/* ---------- v2.4b: conversion rates of foreign-currency accounts (settings.fxRates) ---------- */
function fxSettingsHTML() {
  const rates = settingsObj().fxRates || {};
  const keys = new Set();
  for (const c of Object.keys(rates)) for (const ym of Object.keys(rates[c] || {})) keys.add(c + '|' + ym);
  live().forEach(t => { if (t.fx && t.fx.source === 'manual') keys.add(t.fx.currency + '|' + ymOf(t.date)); });
  if (!keys.size) return '';
  const list = [...keys].sort();
  return `<div class="field" id="fx-set"><span class="lbl">Cotações (contas em moeda estrangeira)</span>
    <p class="xs faint">R$ por 1 unidade da moeda, por mês. Ao mudar, os lançamentos daquele mês são recalculados (o valor original fica guardado).</p>
    <div class="fx-grid">${list.map(k => { const [c, ym] = k.split('|'); const v = rates[c] && rates[c][ym]; return `<div class="field"><label for="fxs-${esc(c)}-${esc(ym)}">${esc(c)} em ${esc(fmtYm(ym))}</label><input type="text" inputmode="decimal" id="fxs-${esc(c)}-${esc(ym)}" data-fxset="${esc(k)}" value="${v ? esc(String(v).replace('.', ',')) : ''}" placeholder="ex.: 5,40"></div>`; }).join('')}</div>
    <div class="row"><button class="btn sm" type="button" data-act="fx-save" id="fx-save">Salvar cotações</button></div></div>`;
}
function saveFxSettings() {
  const st = settingsObj(); const rates = clone(st.fxRates || {}) || {};
  $$('[data-fxset]').forEach(i => { const [c, ym] = i.dataset.fxset.split('|'); const v = E.parseRate(i.value); rates[c] = rates[c] || {}; if (v) rates[c][ym] = v; else delete rates[c][ym]; });
  const changed = eng('applyFxRates', live(), rates) || [];
  const now = nowISO();
  if (changed.length) commit({ txs: changed.map(t => Object.assign(t, { updatedAt: now })), render: false });
  updateSettings(x => { x.fxRates = rates; });
  toast(changed.length ? 'Cotações salvas · ' + changed.length + ' lançamento' + (changed.length === 1 ? '' : 's') + ' recalculado' + (changed.length === 1 ? '' : 's') : 'Cotações salvas');
}
function openAccountSheet() {
  if (S.auth.mode === 'netlify' && !S.auth.user) { doLogin(); return; }
  const u = S.auth.user;
  if (S.auth.mode === 'artifact') { openSheet('<h2>Conta</h2>', `<p>Você está usando a sua conta do claude.ai.</p><p class="small muted">${esc(storageText())}</p>`, null, { kind: 'account', label: 'Conta' }); return; }
  openSheet('<h2>Conta</h2>', u ? `<p>Conectado como <b>${esc(u.email)}</b>.</p><p class="small muted">${esc(storageText())}</p>
      <div class="row end"><button class="btn" type="button" data-act="logout" id="btn-logout">Sair</button></div>`
    : `<p class="small muted">${esc(storageText())}</p>`, null, { kind: 'account', label: 'Conta' });
}
async function doLogin() { try { if (store) await store.login(); } catch (e) { reportErr('Não consegui abrir o login (' + (e && e.message || e) + ').'); } }
async function doLogout() { closeSheet(); try { if (store) await store.logout(); } catch (e) { reportErr('Não consegui sair (' + (e && e.message || e) + ').'); } }

async function exportBackup() {
  if (!store || S.mode !== 'real') return;
  try {
    await flushPersist();
    const obj = await store.exportAll();
    const name = 'financas-flow-backup-' + todayISO() + '.json';
    const text = JSON.stringify(obj, null, 1);
    // Artifact do claude.ai: <a download> é bloqueado; o store oferece o arquivo pelo runtime (downloads.save)
    if (typeof store.saveFile === 'function' && (await store.saveFile(name, text)) !== false) { toast('Backup exportado.'); return; }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Backup exportado.');
  } catch (e) {
    if (e && e.code === 'declined') { toast('Exportação cancelada.'); return; }
    reportErr('Não consegui exportar (' + (e && (e.message || e.code) || e) + ').');
  }
}
async function readBackup(file) {
  try {
    const n = String(file.name || '').toLowerCase();
    if (/\.(csv|tsv|txt|xlsx?|pdf|ofx)$/.test(n)) throw new Error('escolha o arquivo .json do backup (exportado em "Exportar backup")');
    toast('Lendo backup…');
    const bytes = await readBytes(file);
    const dec = eng('decodeBytes', bytes);
    const text = dec ? dec.text : new TextDecoder().decode(bytes);
    if (!/^\s*[{[]/.test(text)) throw new Error('o arquivo não é um backup JSON (exportado em "Exportar backup")');
    let obj; try { obj = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { throw new Error('o JSON está incompleto ou corrompido'); }
    let stats = null;
    try { stats = store && store.parseBackup ? store.parseBackup(obj).stats : null; } catch (e) { throw e; }
    S._restore = { obj, stats };
    openSettings('restore');
  } catch (e) { toast('Backup inválido: ' + (e.message || e), true); }
}
async function restoreBackup() {
  const r = S._restore; S._restore = null; if (!r || !store) return;
  if (signedOut()) { toast('Entre na sua conta antes de importar o backup.', true); return; }
  closeSheet();
  try {
    toast('Importando backup…');
    await flushPersist();
    await store.importAll(r.obj);
    S.imp = null;
    const res = await loadFromStore('silent');
    const m = res && res.migrated;
    const n = live().length;
    const rep = m && m.report;
    toast('Backup importado: ' + n + ' lançamentos' + (rep && (rep.kinds || rep.recategorized || rep.rulesCreated) ? ' · migração: ' + [rep.kinds ? rep.kinds + ' tipos corrigidos' : '', rep.recategorized ? rep.recategorized + ' recategorizados' : '', rep.rulesCreated ? rep.rulesCreated + ' regras' : ''].filter(Boolean).join(', ') : ''));
  } catch (e) { reportErr('Não consegui importar o backup (' + (e && e.message || e) + ').'); }
}
async function wipeAll() {
  if (!S.real) return;
  const months = [...new Set((S.real.txs || []).map(t => ymOf(t.date)).filter(m => /^\d{4}-\d{2}$/.test(m)))];
  closeSheet();
  if (canPersist()) {
    try {
      for (const ym of months) await store.deleteMonth(ym);
      const e = emptyData();
      for (const n of META) await store.saveMeta(n, metaBody(n, e));
    } catch (e) { reportErr('Nem tudo foi apagado (' + (e && e.message || e) + ').'); }
  }
  S.real = emptyData(); S.mode = 'example'; P.months.clear(); P.meta.clear();
  S.imp = null; S.ver++; renderAfterChange(true); toast('Dados apagados.');
}

/* ---------- accounts & imports ---------- */
function importsList() {
  const d = D();
  const imps = Object.values(d.imports || {}).filter(r => r && r.id);
  const counts = {};
  live().forEach(t => { if (t.importId) { const c = counts[t.importId] = counts[t.importId] || { n: 0, total: 0 }; c.n++; c.total += t.amount; } });
  return imps.map(r => Object.assign({}, r, { count: counts[r.id] ? counts[r.id].n : 0, total: counts[r.id] ? counts[r.id].total : 0 }))
    .filter(r => r.count > 0)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
function openAccountsSheet() {
  S.accUI = S.accUI || { move: null, del: null };
  openSheet('<h2>Contas e importações</h2>', '<div id="acc-body"></div>', () => { S.accUI = null; }, { kind: 'accounts', label: 'Contas e importações' });
  renderAccountsSheet();
}
function renderAccountsSheet() {
  const el = $('#acc-body'); if (!el) return;
  const d = D(); const U = S.accUI || (S.accUI = { move: null, del: null });
  const accs = d.accounts || [];
  const nBy = {}; live().forEach(t => { nBy[t.accountId] = (nBy[t.accountId] || 0) + 1; });
  const imps = importsList();
  el.innerHTML = `
    <div class="card"><h3>Contas</h3>
      ${accs.length ? accs.map(a => `<div class="acc-row" data-acc="${esc(a.id)}">
        <div class="field"><label for="acc-name-${esc(a.id)}">Nome <span class="faint">· ${nBy[a.id] || 0} lançamentos</span></label><input type="text" id="acc-name-${esc(a.id)}" data-accname="${esc(a.id)}" value="${esc(a.name)}"></div>
        <div class="field"><label for="acc-type-${esc(a.id)}">Tipo</label><select id="acc-type-${esc(a.id)}" data-acctype="${esc(a.id)}">${Object.entries(ACC_TYPES).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>${alSettingsHTML(a)}</div>`).join('')
      : '<p class="small muted">Nenhuma conta ainda. Elas são criadas ao importar um extrato.</p>'}
      <p class="xs muted">Trocar o tipo recalcula entradas, estornos e pagamentos de fatura dessa conta. Categorias manuais são mantidas.</p>
    </div>
    <div class="card"><div class="card-h"><h3>Importações</h3><button class="btn sm" type="button" data-act="manage" id="btn-manage-imp">Gerenciar dados</button></div>
      ${imps.length ? `<div id="imp-list">${imps.map(r => {
        const moving = U.move && U.move.id === r.id, deleting = U.del === r.id;
        const others = accs.filter(a => a.id !== r.accountId && a.type !== 'payslip');
        return `<div class="imp-row" data-imp="${esc(r.id)}">
          <div class="top"><div class="grow" style="min-width:0"><div class="nm">${esc(r.fileName || r.id)}</div>
            <div class="xs muted">${r.at ? esc(new Date(r.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })) : '—'} · ${esc(accName(r.accountId))} · ${r.count} lançamento${r.count === 1 ? '' : 's'}${r.backfilled ? ' · da v1' : ''}</div></div>
            <span class="money small" style="white-space:nowrap">${brl(r.total)}</span></div>
          ${moving ? `<div class="newcat" id="move-box"><div class="field"><label for="mv-acc">Mover para</label><select id="mv-acc">${others.map(a => `<option value="${esc(a.id)}" ${U.move.to === a.id ? 'selected' : ''}>${esc(a.name)} · ${esc(ACC_TYPES[a.type] || a.type)}</option>`).join('')}<option value="__new" ${U.move.to === '__new' || !others.length ? 'selected' : ''}>Nova conta…</option></select></div>
              <div class="form-grid" id="mv-new" ${U.move.to === '__new' || !others.length ? '' : 'hidden'}><div class="field"><label for="mv-name">Nome</label><input type="text" id="mv-name" placeholder="Ex.: XP conta corrente" value="${esc(U.move.name || '')}"></div>
              <div class="field"><label for="mv-type">Tipo</label><select id="mv-type">${['checking', 'credit_card', 'savings', 'benefit', 'cash'].map(k => `<option value="${k}" ${(U.move.type || 'checking') === k ? 'selected' : ''}>${ACC_TYPES[k]}</option>`).join('')}</select></div></div>
              <div class="row end"><button class="btn sm" type="button" data-act="imp-move-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="imp-move-do" data-id="${esc(r.id)}" id="mv-confirm">Mover ${r.count}</button></div></div>`
          : deleting ? `<div class="banner err" id="del-box"><div class="grow"><b>Excluir esta importação?</b> ${r.count} lançamento${r.count === 1 ? '' : 's'} somem de todas as telas (inclusive categorias manuais)${(() => { const pl = delPlan({ importIds: [r.id] }); return ' · ' + esc(pl.months.map(ymShort).join(', ')) + ' · soma ' + brl(pl.sum); })()}. Dá para desfazer logo depois, no aviso.</div></div>
              <div class="row end"><button class="btn sm" type="button" data-act="imp-del-cancel">Cancelar</button><button class="btn sm danger" type="button" data-act="imp-del-do" data-id="${esc(r.id)}" id="del-confirm">Excluir ${r.count}</button></div>`
          : `<div class="row"><button class="btn sm" type="button" data-act="imp-move" data-id="${esc(r.id)}">Mover para outra conta</button><button class="btn sm ghost" type="button" data-act="imp-del" data-id="${esc(r.id)}" style="color:var(--out)">Excluir importação</button></div>`}
        </div>`; }).join('')}</div>` : '<p class="small muted">Nenhuma importação ainda.</p>'}
    </div>`;
}
function moveImportTo(impId) {
  const d = D(); const U = S.accUI || {};
  let to = ($('#mv-acc') || {}).value;
  if (!to) return;
  if (to === '__new') {
    const nm = (($('#mv-name') || {}).value || '').trim();
    if (!nm) { toast('Dê um nome para a conta nova.', true); return; }
    if (S.mode !== 'real') ensureReal();
    to = addAccount(nm, ($('#mv-type') || {}).value || 'checking');
  }
  const next = eng('moveImport', d.txs, impId, to, Object.assign(ctx(), { accounts: d.accounts }));
  if (!Array.isArray(next)) return;
  const prev = new Map(d.txs.map(t => [t.id, t]));
  const changed = next.filter(t => t && !t.deleted && prev.get(t.id) !== t);
  if (d.imports && d.imports[impId]) d.imports[impId] = Object.assign({}, d.imports[impId], { accountId: to });
  U.move = null;
  commit({ txs: changed, meta: ['accounts', 'imports'] });
  toast(changed.length + ' lançamentos movidos para ' + accName(to));
}
function deleteImport(impId) {
  if (S.accUI) S.accUI.del = null;
  const r = (D().imports || {})[impId];
  runDeletion(delPlan({ importIds: [impId] }, { label: 'importação ' + (r && r.fileName || '') }));
}
function changeAccountType(accId, type) {
  const d = D();
  const a = d.accounts.find(x => x.id === accId); if (!a || a.type === type) return;
  a.type = type; a.updatedAt = nowISO();
  let txs = d.txs;
  const imps = [...new Set(live().filter(t => t.accountId === accId).map(t => t.importId))];
  for (const imp of imps) txs = eng('moveImport', txs, imp, accId, Object.assign(ctx(), { accounts: d.accounts })) || txs;
  const prev = new Map(d.txs.map(t => [t.id, t]));
  const changed = txs.filter(t => t && !t.deleted && t.accountId === accId && prev.get(t.id) !== t);
  commit({ txs: changed, meta: ['accounts'] });
  toast('Tipo da conta atualizado' + (changed.length ? ' · ' + changed.length + ' lançamentos recalculados' : ''));
}

/* ================= v2.4a: Gerenciar dados — deletions with an in-page confirmation and "Desfazer" =================
   Every deletion: FinEngine.selectForDeletion (what) → in-page summary (rows, months, sum) → runDeletion: applyDeletion
   cleans what depended on the rows (imports, series rules, dismissed alerts, layouts' default account) and commit({remove})
   leaves the rows out of saveMonth (deleteMonth when a month empties) → store tombstones → synced, never resurrected.
   "Desfazer" (session only) re-saves the kept rows with a new updatedAt (newer than the tombstones) and the meta. */
const UNDO = { list: [] };
const ymShort = ym => { const [y, m] = String(ym).split('-'); return (MES3[+m - 1] || m) + '/' + String(y).slice(2); };
function delPlan(sel, opts) {
  opts = opts || {};
  const s = eng('selectForDeletion', live(), sel, D().imports || {}) || { ids: [], rows: [], count: 0, months: [], sum: 0, accounts: [], importIds: [] };
  return Object.assign(s, { sel, removeAccountIds: opts.removeAccountIds || [], label: opts.label || '', section: opts.section || null });
}
function delPlanHTML(plan, cancelAct) {
  const n = plan.count;
  const accRm = plan.removeAccountIds.map(accName);
  const gone = new Set(plan.ids);
  const nImp = Object.values(D().imports || {}).filter(r => r && (plan.removeAccountIds.includes(r.accountId) || (plan.importIds.includes(r.id) && live().every(t => t.importId !== r.id || gone.has(t.id))))).length;
  const lines = [`<li><b class="num" data-del-count>${n}</b> lançamento${n === 1 ? '' : 's'}</li>`];
  if (n) lines.push(`<li>Mês${plan.months.length === 1 ? '' : 'es'}: <span data-del-months>${esc(plan.months.map(ymShort).join(', '))}</span></li>`, `<li>Soma: <b class="money" data-del-sum>${brl(plan.sum)}</b></li>`, `<li>Conta${plan.accounts.length === 1 ? '' : 's'}: ${esc(plan.accounts.map(accName).join(', '))}</li>`);
  if (nImp) lines.push(`<li>${nImp} importaç${nImp === 1 ? 'ão' : 'ões'} ${plan.removeAccountIds.length ? 'da conta' : 'ficam sem lançamentos'}${plan.removeAccountIds.length ? '' : ' (o registro some)'}</li>`);
  if (accRm.length) lines.push(`<li>A conta <b>${esc(accRm.join(', '))}</b> (alertas e layouts ligados a ela)</li>`);
  const can = n > 0 || accRm.length > 0;
  return `<div class="del-plan" id="del-plan" role="group" aria-label="Confirmar exclusão"><b>${can ? 'Vai excluir:' : 'Nada para excluir.'}</b>${can ? `<ul>${lines.join('')}</ul><span class="xs muted">Some deste aparelho e dos outros. Dá para desfazer logo depois, no aviso.</span>` : ''}
    <div class="row end"><button class="btn sm" type="button" data-act="${cancelAct || 'del-cancel'}" id="del-cancel">Cancelar</button>${can ? `<button class="btn sm danger" type="button" data-act="del-do" id="del-do">${n ? 'Excluir ' + n : 'Excluir conta'}</button>` : ''}</div></div>`;
}
function runDeletion(plan) {
  if (!plan || S.mode !== 'real' || (!plan.count && !plan.removeAccountIds.length)) return null;
  if (signedOut()) { toast('Entre na sua conta para alterar seus dados.', true); return null; }
  const d = D(); const now = nowISO();
  const before = { imports: clone(d.imports || {}), rules: clone(d.rules || []), accounts: clone(d.accounts || []), profiles: clone(d.profiles || []), settings: clone(d.settings || {}) };
  const r = eng('applyDeletion', { transactions: live(), imports: d.imports || {}, rules: d.rules || [], accounts: d.accounts || [], profiles: d.profiles || [], settings: d.settings || {} }, plan.ids, { removeAccountIds: plan.removeAccountIds, now });
  if (!r) return null;
  const prevChanged = r.changed.map(t => clone(txById(t.id))).filter(Boolean);
  d.imports = r.imports; d.rules = r.rules; d.accounts = r.accounts; d.profiles = r.profiles; d.settings = r.settings;
  const u = { id: 'del' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label: plan.label, rows: clone(r.removed), prevChanged, report: r.report, before, n: r.removed.length };
  UNDO.list.push(u); if (UNDO.list.length > 5) UNDO.list.shift();
  if (S.ui.sel) plan.ids.forEach(id => S.ui.sel.delete(id));
  commit({ remove: plan.ids, txs: r.changed, meta: r.meta });
  const what = u.n ? u.n + ' lançamento' + (u.n === 1 ? '' : 's') + ' excluído' + (u.n === 1 ? '' : 's') : 'Conta excluída';
  toast(what + (r.report.accountsRemoved.length && u.n ? ' · conta excluída' : '') + '.', false, { label: 'Desfazer', fn: () => undoDeletion(u.id), ms: 10000 });
  return u;
}
function undoDeletion(id) {
  const u = UNDO.list.find(x => x.id === id); if (!u) { toast('Nada para desfazer.', true); return; }
  UNDO.list = UNDO.list.filter(x => x !== u);
  const d = D(); const now = nowISO(); const meta = new Set(); const rep = u.report; const B = u.before;
  const rkey = r => r && (r.id || r.seriesKey);
  if (rep.importsRemoved.length || rep.importsUpdated.length) {
    d.imports = Object.assign({}, d.imports || {});
    rep.importsRemoved.concat(rep.importsUpdated).forEach(k => { if (B.imports[k]) d.imports[k] = Object.assign({}, B.imports[k], { updatedAt: now }); });
    meta.add('imports');
  }
  if (rep.rulesRemoved.length) {
    const have = new Set((d.rules || []).map(rkey));
    B.rules.filter(r => rep.rulesRemoved.includes(rkey(r)) && !have.has(rkey(r))).forEach(r => d.rules.push(Object.assign({}, r, { updatedAt: now })));
    meta.add('rules');
  }
  if (rep.accountsRemoved.length) {
    const cur = new Map((d.accounts || []).map(a => [a.id, a]));
    const back = B.accounts.filter(a => cur.has(a.id) || rep.accountsRemoved.includes(a.id)).map(a => cur.get(a.id) || Object.assign({}, a, { updatedAt: now }));
    d.accounts = back.concat((d.accounts || []).filter(a => !back.some(x => x.id === a.id)));
    meta.add('accounts');
  }
  if (rep.profilesUpdated.length) {
    d.profiles = (d.profiles || []).map(p => { const b = rep.profilesUpdated.includes(p.id) && B.profiles.find(x => x.id === p.id); return b && b.defaultAccountId && !p.defaultAccountId ? Object.assign({}, p, { defaultAccountId: b.defaultAccountId, updatedAt: now }) : p; });
    meta.add('profiles');
  }
  if (rep.alertsCleared.length) {
    const st = settingsObj(); st.dismissedAlerts = [...new Set((st.dismissedAlerts || []).concat(rep.alertsCleared))]; st.updatedAt = now; meta.add('settings');
  }
  commit({ txs: u.rows.concat(u.prevChanged), meta: [...meta] });
  toast('Exclusão desfeita: ' + (u.n ? u.n + ' lançamento' + (u.n === 1 ? '' : 's') + ' de volta.' : 'conta de volta.'));
}
/* --- the "Gerenciar dados" sheet --- */
function importRange(impId) { const ds = live().filter(t => t.importId === impId).map(t => t.date).sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : [null, null]; }
function openManageSheet() {
  S.manUI = S.manUI || { file: null, allFile: false, month: '', monthAcc: '', acc: '', keepAcc: false, plan: null };
  openSheet('<h2>Gerenciar dados</h2><p class="small muted">Exclua o que entrou errado. Antes de excluir você vê exatamente o que sai.</p>', '<div id="man-body"></div>', () => { S.manUI = null; }, { kind: 'manage', label: 'Gerenciar dados' });
  renderManageSheet();
}
function renderManageSheet() {
  const el = $('#man-body'); if (!el) return;
  const U = S.manUI || (S.manUI = { file: null, allFile: false, month: '', monthAcc: '', acc: '', keepAcc: false, plan: null });
  if (S.mode !== 'real') { el.innerHTML = '<p class="small muted" id="man-empty">Você está vendo dados de exemplo: não há nada seu para excluir.</p>'; return; }
  const imps = importsList();
  const byName = {}; imps.forEach(r => { byName[r.fileName || r.id] = (byName[r.fileName || r.id] || 0) + 1; });
  const accs = (D().accounts || []);
  const nByAcc = {}; live().forEach(t => { nByAcc[t.accountId] = (nByAcc[t.accountId] || 0) + 1; });
  const months = dataMonthsList().slice().reverse();
  const nByMonth = {}; live().forEach(t => { const m = ymOf(t.date); nByMonth[m] = (nByMonth[m] || 0) + 1; });
  const planIn = sec => U.plan && U.plan.section === sec ? delPlanHTML(U.plan) : '';
  const last = UNDO.list[UNDO.list.length - 1];
  const fileRec = U.file ? imps.find(r => r.id === U.file) : null;
  el.innerHTML = `
    ${last ? `<div class="banner info" id="man-undo"><div class="grow">Última exclusão: ${last.n} lançamento${last.n === 1 ? '' : 's'}${last.label ? ' (' + esc(last.label) + ')' : ''}.</div><button class="btn sm" type="button" data-act="del-undo" data-id="${esc(last.id)}" id="man-undo-btn">Desfazer</button></div>` : ''}
    <div class="card man-sec" id="man-file"><h3>Excluir por arquivo</h3>
      ${imps.length ? `<div class="man-pick" role="group" aria-label="Importações">${imps.map(r => { const [a, b] = importRange(r.id); return `<button type="button" class="man-opt" data-act="man-file" data-id="${esc(r.id)}" aria-pressed="${U.file === r.id}"><span class="grow"><b class="small">${esc(r.fileName || r.id)}</b><br><span class="xs muted">${esc(accName(r.accountId))} · ${esc(fmtRange(a, b))} · ${r.count} lançamento${r.count === 1 ? '' : 's'}${r.at ? ' · importado em ' + esc(isoToBR(String(r.at).slice(0, 10))) : ''}</span></span><span class="money small">${brl(r.total)}</span></button>`; }).join('')}</div>
        ${fileRec && byName[fileRec.fileName || fileRec.id] > 1 ? `<label class="check-chip" id="man-allfile-l"><input type="checkbox" id="man-allfile" ${U.allFile ? 'checked' : ''}>Excluir todas as ${byName[fileRec.fileName || fileRec.id]} importações de "${esc(fileRec.fileName)}"</label>` : ''}
        ${planIn('file')}` : '<p class="small muted">Nenhuma importação com lançamentos.</p>'}
    </div>
    <div class="card man-sec" id="man-month"><h3>Excluir mês</h3>
      <div class="form-grid"><div class="field"><label for="man-month-sel">Mês</label><select id="man-month-sel"><option value="">Escolha o mês…</option>${months.map(m => `<option value="${m}" ${U.month === m ? 'selected' : ''}>${esc(fmtYm(m))} · ${nByMonth[m]}</option>`).join('')}</select></div>
        <div class="field"><label for="man-month-acc">Conta</label><select id="man-month-acc"><option value="">Todas as contas</option>${accs.map(a => `<option value="${esc(a.id)}" ${U.monthAcc === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div></div>
      ${U.plan && U.plan.section === 'month' ? planIn('month') : `<div class="row end"><button class="btn sm" type="button" data-act="man-month-go" id="man-month-go" ${U.month ? '' : 'disabled'}>Revisar exclusão</button></div>`}
    </div>
    <div class="card man-sec" id="man-acc"><h3>Excluir conta ou banco</h3>
      <div class="field"><label for="man-acc-sel">Conta</label><select id="man-acc-sel"><option value="">Escolha a conta…</option>${accs.map(a => `<option value="${esc(a.id)}" ${U.acc === a.id ? 'selected' : ''}>${esc(a.name)} · ${esc(ACC_TYPES[a.type] || a.type)} · ${nByAcc[a.id] || 0}</option>`).join('')}</select></div>
      <div class="check-list" role="radiogroup" aria-label="O que excluir"><label class="check-chip"><input type="radio" name="man-keep" id="man-keep-no" value="no" ${U.keepAcc ? '' : 'checked'}>Excluir a conta e tudo dela</label><label class="check-chip"><input type="radio" name="man-keep" id="man-keep-yes" value="yes" ${U.keepAcc ? 'checked' : ''}>Manter a conta, apagar só os lançamentos</label></div>
      ${U.plan && U.plan.section === 'account' ? planIn('account') : `<div class="row end"><button class="btn sm" type="button" data-act="man-acc-go" id="man-acc-go" ${U.acc ? '' : 'disabled'}>Revisar exclusão</button></div>`}
    </div>
    <div class="card man-sec"><h3>Escolher lançamentos</h3><p class="small muted">Em Transações, marque os lançamentos (ou todos do filtro) e exclua ou mude a categoria de uma vez.</p>
      <div class="row"><button class="btn sm" type="button" data-act="sel-go" id="man-sel-go">Selecionar em Transações</button></div></div>`;
  const pl = $('#del-plan'); if (pl && S._planScroll) { S._planScroll = false; pl.scrollIntoView({ block: 'nearest' }); }
}
function manPlanFile() {
  const U = S.manUI; const rec = (D().imports || {})[U.file]; if (!rec) { U.plan = null; return; }
  const all = U.allFile && Object.values(D().imports || {}).filter(r => r && r.fileName === rec.fileName).length > 1;
  U.plan = all ? delPlan({ fileName: rec.fileName }, { label: 'todas as importações de ' + rec.fileName, section: 'file' }) : delPlan({ importIds: [rec.id] }, { label: rec.fileName || rec.id, section: 'file' });
  S._planScroll = true;
}
/* --- Transações: selection mode --- */
function selStart() { S.ui.sel = S.ui.sel || new Set(); S.ui.selPlan = null; }
function selBarHTML() {
  const sel = S.ui.sel; if (!sel) return '';
  const n = sel.size; const nF = filteredTxs().length;
  return `<div class="sel-bar" id="sel-bar"><span class="small grow"><b class="num" id="sel-count">${n}</b> selecionado${n === 1 ? '' : 's'}</span>
    <button class="btn sm ghost" type="button" data-act="sel-all" id="sel-all">Todos do filtro (${nF})</button>
    ${n ? '<button class="btn sm ghost" type="button" data-act="sel-none" id="sel-none">Limpar</button>' : ''}
    <button class="btn sm" type="button" data-act="sel-cat" id="sel-cat" ${n ? '' : 'disabled'}>Mudar categoria</button>
    <button class="btn sm danger" type="button" data-act="sel-del" id="sel-del" ${n ? '' : 'disabled'}>Excluir selecionados</button>
    <button class="btn sm" type="button" data-act="sel-done" id="sel-done">Concluir</button>
    ${S.ui.selPlan ? `<div style="flex-basis:100%">${delPlanHTML(S.ui.selPlan, 'sel-plan-cancel')}</div>` : ''}</div>`;
}
function selRefresh() { const b = $('#sel-bar'); if (b) b.outerHTML = selBarHTML(); renderTxList(); }
function openBulkCategory() {
  const n = S.ui.sel ? S.ui.sel.size : 0; if (!n) return;
  openSheet(`<h2>Mudar categoria</h2><p class="small muted">${n} lançamento${n === 1 ? '' : 's'} selecionado${n === 1 ? '' : 's'}. Transferências e pagamentos de fatura ficam como estão.</p>`,
    `<div class="field cat-picker"><label for="bulk-cat">Categoria</label>${catSelect('bulk-cat', null, { allowNone: true })}</div>
     <div class="row end"><button class="btn" type="button" data-act="closesheet">Cancelar</button><button class="btn primary" type="button" data-act="bulk-cat-apply" id="bulk-cat-apply">Aplicar</button></div>`, null, { kind: 'bulkcat', label: 'Mudar categoria' });
}
function bulkCategory() {
  const catId = ($('#bulk-cat') || {}).value || '';
  if (!catId || catId === '__new') { toast('Escolha uma categoria.', true); return; }
  const rows = [...(S.ui.sel || [])].map(txById).filter(t => t && countable(t));
  if (!rows.length) { closeSheet(); toast('Nenhum dos selecionados aceita categoria (transferências / pagamentos de fatura).', true); return; }
  const before = rows.map(clone);
  const k = kindFor(catId);
  closeSheet();
  commit({ txs: rows.map(t => Object.assign({}, t, { categoryId: catId, catSource: 'manual', kind: k || t.kind })) });
  toast(rows.length + ' lançamento' + (rows.length === 1 ? '' : 's') + ' → ' + catLabel(catId), false, { label: 'Desfazer', fn: () => { commit({ txs: before.filter(b => txById(b.id)) }); toast('Categorias de volta.'); }, ms: 10000 });
}

/* ================= events ================= */
function ncOpen(p) {
  const f = $('#' + p + '-nc'); if (!f) return;
  f.hidden = false;
  const n = $('#' + p + '-nc-name'); if (n) n.focus({ preventScroll: false });
}
function ncClose(p) {
  const f = $('#' + p + '-nc'); if (f) f.hidden = true;
  const sel = NC_SELECT[p] ? $('#' + NC_SELECT[p]) : null;
  if (sel && sel.value === '__new') sel.value = sel.dataset.prev || (sel.querySelector('option[value=""]') ? '' : sel.options[0].value);
}
const NC_SELECT = { ed: 'ed-cat', rl: 'rl-cat' };
function ncSave(p) {
  const id = createCategoryFromForm(p);
  if (!id) return;
  if (p === 'tri') { TRI.newCat = false; triagePick(id); return; }
  if (NC_SELECT[p]) {
    const sel = $('#' + NC_SELECT[p]);
    if (sel) {
      const keepNone = sel.querySelector('option[value=""]') ? { allowNone: true } : {};
      const html = catSelect(NC_SELECT[p], id, keepNone);
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      sel.replaceWith(tmp.firstElementChild);
      const ns = $('#' + NC_SELECT[p]); if (ns) { ns.value = id; ns.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    const f = $('#' + p + '-nc'); if (f) f.hidden = true;
    return;
  }
  if (p === 'flt') {
    const a = readFilters() || S.ui.adv;
    a.cats = (a.cats || []).concat([id]);
    S.ui.adv = a; saveTxPrefs(); openFilters();
    return;
  }
  if (p === 'cat') { S.ui.openGroup = id.split('.')[0]; renderCats(); }
}

const ACT = {
  goto: el => { closeSheet(); if ($('#triage-root').innerHTML) stopTriage(); setTab(el.dataset.tab); },
  login: () => doLogin(),
  logout: () => doLogout(),
  account: () => openAccountSheet(),
  month: el => { S.ui.month = addMonths(S.ui.month, +el.dataset.d); renderPainel(); },
  range: el => { S.ui.range = +el.dataset.r; renderPainel(); },
  view: el => { S.ui.view = el.dataset.v; renderPainel(); },
  full: () => { S.ui.full = !S.ui.full; renderPainel(); },
  sknode: el => openNodeSheet(el.dataset.id),
  filter: el => { S.ui.filter = el.dataset.f; S.ui.txLimit = 200; saveTxPrefs(); $$('.chips .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.f === S.ui.filter)); renderTxList(); },
  filters: () => openFilters(),
  'filters-apply': () => { const a = readFilters(); if (!a) { toast('Confira as datas (dd/mm/aaaa).', true); return; } S.ui.adv = a; S.ui.txLimit = 200; saveTxPrefs(); closeSheet(); renderTx(); },
  'filters-clear': () => { S.ui.adv = emptyAdv(); saveTxPrefs(); if (S.sheet && S.sheet.kind === 'filters') closeSheet(); renderTx(); },
  'f-preset': el => { const [f, t] = presetRange(el.dataset.k); const a = $('#f-from'), b = $('#f-to'); if (a) a.value = isoToBR(f); if (b) b.value = isoToBR(t); readDateField('f-from'); readDateField('f-to'); },
  datepick: el => openDatePicker(el.dataset.for),
  more: () => { S.ui.txLimit = (S.ui.txLimit || 200) + 200; renderTxList(); },
  edittx: el => { if ($('#triage-root').innerHTML) return; openTxEditor(el.dataset.id); },
  closesheet: () => closeSheet(),
  savetx: el => { if (saveTxEdit(el.dataset.id) !== false) closeSheet(); },
  'nc-open': el => ncOpen(el.dataset.p),
  'nc-cancel': el => { if (el.dataset.p === 'tri') { TRI.newCat = false; renderTriage(); return; } ncClose(el.dataset.p); },
  'nc-save': el => ncSave(el.dataset.p),
  triage: () => startTriage(),
  'tri-close': () => stopTriage(),
  'tri-group': el => { TRI.group = el.dataset.g; renderTriage(); },
  'tri-back': () => { TRI.group = null; renderTriage(); },
  'tri-pick': el => triagePick(el.dataset.cat),
  'tri-newcat': () => { const b = $('#tri-remember'); if (b) TRI.remember = b.checked; TRI.newCat = true; renderTriage(); const n = $('#tri-nc-name'); if (n) n.focus(); },
  'tri-skip': () => triageSkip(),
  'tri-unid': () => triageUnid(),
  'ed-unid': el => editorUnid(el.dataset.id),
  'toast-act': () => { const f = toast._act; toast._act = null; $('#toast').hidden = true; if (f) f(); },
  'tri-transfer': () => triageTransfer(),
  'tri-tr-back': () => { TRI.trPick = false; renderTriage(); },
  'tri-tr-acc': el => triageTransferTo(el.dataset.acc, el.dataset.pair || null),
  transfers: () => { if ($('#triage-root').innerHTML) return; openTransfersSheet(); },
  'who-confirm': el => { const sel = whoSelected(el.dataset.where); const names = whoCandidates().filter(c => sel.includes(c.key)).flatMap(c => c.variants); if (!names.length) { toast('Marque pelo menos um nome — ou toque em "Agora não".', true); return; } applyOwnerNames(names); },
  'who-later': () => { const keys = whoCandidates().map(c => c.key); updateSettings(st => { st.ownerNamesAsked = true; st.ownerNamesDismissed = [...new Set((st.ownerNamesDismissed || []).concat(keys))].slice(-200); }); toast('Tudo bem. Dá para informar depois em Ajustes → Transferências.'); },
  'tr-confirm': el => trConfirm(el.dataset.key),
  'tr-reject': el => trReject(el.dataset.key),
  'tr-apply-pending': () => trApplyPending(),
  'tr-apply-manual': () => applyManualOwn(),
  'tr-skip-manual': () => { S.trUI.askManual = []; renderTransfersSheet(); },
  'tr-review-undo': () => trReviewUndo(),
  'tr-name-add': () => { const i = $('#tr-name-new'); const v = i ? i.value.trim() : ''; if (!v || v.split(/\s+/).length < 2) { toast('Digite nome e sobrenome, como aparece no extrato.', true); return; } S.trUI.addName = ''; applyOwnerNames([v]); },
  'tr-name-del': el => { const n = el.dataset.name; updateSettings(st => { st.ownerNames = (st.ownerNames || []).filter(x => x !== n); }); toast('Nome removido. Os lançamentos já ajustados continuam como estão.'); },
  'tri-undo': () => triageUndo(),
  'imp-tab': el => { S.imp.tab = el.dataset.t; renderImport(); },
  'imp-paste': () => handlePaste(),
  'imp-back': () => { S.imp.step = 1; if (S.imp.batchKey) { S.imp.batchKey = null; bfRefresh(); return; } renderImport(); },
  'imp-batch-save': () => bfConfigSave(),
  'bf-remove': el => { const B = S.imp.batch; B.items = B.items.filter(it => it.key !== el.dataset.key); if (!B.items.length) S.imp.batch = null; bfRefresh(); },
  'bf-config': el => bfConfigure(el.dataset.key),
  'bf-pw': el => bfPassword(el.dataset.key),
  'imp-pdf-pw': () => { const I = S.imp; if (!I.pdfPw) return; const inp = $('#imp-pdf-pw'); const pw = inp ? inp.value : ''; if (inp) inp.value = ''; if (!pw) { toast('Digite a senha do PDF.', true); if (inp) inp.focus(); return; } handleFile(I.pdfPw.file, pw); },
  'imp-pdf-pw-cancel': () => { S.imp.pdfPw = null; renderImport(); },
  'fx-list': () => { const p = period(); S.ui.adv = Object.assign(emptyAdv(), { fx: true, from: p.from, to: p.to }); S.ui.filter = 'all'; saveTxPrefs(); setTab('tx'); },
  'fx-save': () => saveFxSettings(),
  'bf-fix': el => { const it = bfItem(el.dataset.key); if (!it) return; if (el.dataset.to === '__new') { bfFormOpen(it.key, kindAccType(it.kind)); return; } it.ov = { id: el.dataset.to, auto: false }; bfRefresh(); },
  'bf-own': el => { const it = bfItem(el.dataset.key); if (!it) return; it.ov = { id: bfAcc(it), auto: false }; bfRefresh(); const s = $('#bf-acc-' + CSS.escape(it.key)); if (s) s.focus(); },
  'bf-default': el => { const it = bfItem(el.dataset.key); if (!it) return; const B = S.imp.batch; if (B.form && B.form.target === it.key) B.form = null; it.ov = null; it.sug = null; bfRefresh(); },
  'bf-new-create': () => bfFormCreate(),
  'bf-new-cancel': () => bfFormCancel(),
  'bf-import': () => bfImport(),
  'bf-reset': () => { S.imp.batch = null; S.imp.step = 1; renderImport(); },
  'bf-pending-back': () => { S.imp.batch.done = null; bfRefresh(); },
  'imp-step': el => { const s = +el.dataset.s; if (s === 4 && !(S.imp.dedup.fresh || []).length) return; S.imp.step = s; renderImport(); window.scrollTo({ top: 0 }); },
  'imp-num': el => { S.imp.profile.numberFormat = el.dataset.v; runPreview(); renderImport(); },
  'imp-ai': () => runAIProfile(),
  'imp-commit': () => commitImport(),
  'imp-paste-again': () => { const P = S.imp; S.imp = newImp(); S.imp.tab = P.tab; S.imp.pasteOpen = true; S.imp.pasted = (P.pasted || 0) + 1; if (P.accountId && P.accountId !== '__new') S.imp.accountId = P.accountId; renderImport(); const ta = $('#imp-paste'); if (ta) { ta.focus(); ta.scrollIntoView({ block: 'center' }); } },
  'imp-reset': () => { const t = S.imp.tab; S.imp = newImp(); S.imp.tab = t; renderImport(); },
  'hol-add': () => { readHolerite(); S.imp.hol.others.push({ name: '', amount: '' }); renderHolerite(); },
  'hol-del': el => { readHolerite(); S.imp.hol.others.splice(+el.dataset.i, 1); renderHolerite(); },
  'hol-save': () => saveHolerite(),
  'hol-reset': () => { S.imp.hol = null; renderHolerite(); },
  addchild: el => {
    const g = D().categories.find(x => x.id === el.dataset.g); const inp = $('#c-new-' + CSS.escape(g.id)); const nm = (inp.value || '').trim();
    if (!nm) { inp.focus(); return; }
    let id = g.id + '.' + slug(nm).replace(/-/g, '_'); const ids = new Set((g.children || []).map(c => c.id)); let k = 2; const b = id; while (ids.has(id)) id = b + '_' + (k++);
    (g.children = g.children || []).push({ id, name: nm }); S.ui.openGroup = g.id; commit({ meta: ['categories'] }); toast('Subcategoria criada');
  },
  'rule-new': () => openRuleEditor(null),
  'rule-edit': el => openRuleEditor(el.dataset.id),
  'rule-save': el => saveRule(el.dataset.id || null),
  'rule-ask': el => { S.ui.confirmRule = el.dataset.id; renderCats(); },
  'rule-del': el => { D().rules = D().rules.filter(r => r.id !== el.dataset.id); S.ui.confirmRule = null; commit({ meta: ['rules'] }); toast('Regra excluída'); },
  'ai-cats': () => runAICategories(),
  'ai-cats-clear': () => { S.aiSug = null; renderCats(); },
  'ai-cats-apply': () => applyAISuggestions(),
  settings: el => { openSettings(); if (el && el.dataset && el.dataset.focus === 'carry') { const c = $('#carry-set'); if (c) c.scrollIntoView({ block: 'start' }); } },
  health: el => { if ($('#triage-root').innerHTML) return; openHealthSheet(el && el.dataset ? el.dataset.month : null); },
  'health-all': () => { S.healthUI = { month: null }; renderHealthSheet(); },
  'hw-act': el => healthAction(el.dataset.id),
  'hw-complete': el => healthComplete(el.dataset.id),
  'hw-dismiss': el => healthDismiss(el.dataset.id),
  'hw-undismiss': () => { updateSettings(st => { st.dismissedWarnings = []; }); },
  carry: () => openCarrySheet(),
  'month-menu': () => openMonthMenu(),
  alerts: () => { if ($('#triage-root').innerHTML) return; openAlertsSheet(); },
  'al-import': el => alertImport(el.dataset.id),
  'al-dismiss': el => alertDismiss(el.dataset.id),
  'al-other': el => { S.alertUI = Object.assign(S.alertUI || {}, { other: el.dataset.id, err: '' }); renderAlertsSheet(); const i = $('#al-other-date'); if (i) i.focus(); },
  'al-other-cancel': () => { if (S.alertUI) { S.alertUI.other = null; S.alertUI.err = ''; } renderAlertsSheet(); },
  'al-other-save': el => alertOtherSave(el.dataset.id),
  'al-config': el => alertConfig(el.dataset.acc),
  'al-undismiss': () => { updateSettings(st => { st.dismissedAlerts = []; }); },
  'al-suggest': el => alSuggest(el.dataset.acc),
  'al-save': el => alSave(el.dataset.acc),
  'al-ov-del': el => { const a = (D().accounts || []).find(x => x.id === el.dataset.acc); if (!a || !a.cycleOverrides) return; const ov = Object.assign({}, a.cycleOverrides); delete ov[el.dataset.ym]; a.cycleOverrides = ov; a.updatedAt = nowISO(); S.accUI.cfg = a.id; commit({ meta: ['accounts'] }); toast('Fechamento voltou ao dia normal nesse ciclo.'); },
  'cc-gran': el => ccSet({ gran: el.dataset.v }),
  'cc-level': el => {
    if (el.dataset.v === 'group') { ccSet({ level: 'group', groupId: null }); return; }
    const P = ccPrefs(); const groups = (D().categories || []).filter(g => (g.kind || 'expense') === 'expense');
    let gid = groups.some(g => g.id === P.groupId) ? P.groupId : null;
    if (!gid) { const d = S._cc && S._cc.data; const top = d && d.level === 'group' ? d.series.filter(x => groups.some(g => g.id === x.id) && x.id !== 'outros').sort((a, b) => b.total - a.total)[0] : null; gid = top ? top.id : (groups[0] || {}).id; }
    if (gid) ccSet({ level: 'category', groupId: gid });
  },
  'cc-toggle': el => { const P = ccPrefs(); const id = el.dataset.id; const h = new Set(P.hidden); if (h.has(id)) h.delete(id); else h.add(id); S._ccKeep = true; ccSet({ hidden: [...h] }); },
  'cc-table': () => { S.ui.ccTable = !S.ui.ccTable; S._ccKeep = true; renderCatChart(); },
  'cc-open': (el, ev) => { if (ev && ev.target && ev.target.closest && ev.target.closest('[data-s]') && ev.target.closest('[data-s]') !== el) return; ccTipHide(); ccOpen(el.dataset.s || null, +el.dataset.p); },
  'cnpj-lookup': el => cnpjLookup(el.dataset.p, el.dataset.cnpj),
  'cnae-pick': el => cnaePick(el.dataset.p, el.dataset.cat),
  accounts: () => openAccountsSheet(),
  'imp-move': el => { S.accUI.move = { id: el.dataset.id, to: null }; S.accUI.del = null; renderAccountsSheet(); },
  'imp-move-cancel': () => { S.accUI.move = null; renderAccountsSheet(); },
  'imp-move-do': el => moveImportTo(el.dataset.id),
  'imp-del': el => { S.accUI.del = el.dataset.id; S.accUI.move = null; renderAccountsSheet(); },
  'imp-del-cancel': () => { S.accUI.del = null; renderAccountsSheet(); },
  'imp-del-do': el => deleteImport(el.dataset.id),
  manage: () => openManageSheet(),
  'man-file': el => { const U = S.manUI; if (U.file === el.dataset.id && U.plan) { U.file = null; U.plan = null; U.allFile = false; } else { if (U.file !== el.dataset.id) U.allFile = false; U.file = el.dataset.id; manPlanFile(); } renderManageSheet(); },
  'man-month-go': () => { const U = S.manUI; if (!U.month) return; U.plan = delPlan({ month: U.month, accountId: U.monthAcc || undefined }, { label: fmtYm(U.month) + (U.monthAcc ? ' · ' + accName(U.monthAcc) : ''), section: 'month' }); S._planScroll = true; renderManageSheet(); },
  'man-acc-go': () => { const U = S.manUI; if (!U.acc) return; U.plan = delPlan({ accountId: U.acc }, { label: (U.keepAcc ? 'lançamentos de ' : 'conta ') + accName(U.acc), section: 'account', removeAccountIds: U.keepAcc ? [] : [U.acc] }); S._planScroll = true; renderManageSheet(); },
  'del-cancel': () => { if (S.manUI) { S.manUI.plan = null; if (S.manUI.file) S.manUI.file = null; } renderManageSheet(); },
  'del-do': () => {
    if (S.ui.selPlan && S.ui.tab === 'tx' && !(S.sheet && S.sheet.kind === 'manage')) { const p = S.ui.selPlan; S.ui.selPlan = null; runDeletion(p); selRefresh(); return; }
    const U = S.manUI; if (!U || !U.plan) return; const p = U.plan; U.plan = null; U.file = null; U.allFile = false;
    if (p.section === 'account' && p.removeAccountIds.length) U.acc = '';
    runDeletion(p); renderManageSheet();
  },
  'del-undo': el => { undoDeletion(el.dataset.id); },
  'sel-go': () => { closeSheet(); selStart(); setTab('tx'); },
  'sel-start': () => { selStart(); renderTx(); },
  'sel-done': () => { S.ui.sel = null; S.ui.selPlan = null; renderTx(); },
  seltx: el => { const s = S.ui.sel; if (!s) return; const id = el.dataset.id; if (s.has(id)) s.delete(id); else s.add(id); S.ui.selPlan = null; const on = s.has(id); el.setAttribute('aria-pressed', on); const ck = el.querySelector('.ck'); if (ck) ck.textContent = on ? '✓' : ''; const b = $('#sel-bar'); if (b) b.outerHTML = selBarHTML(); },
  'sel-all': () => { const s = S.ui.sel; if (!s) return; filteredTxs().forEach(t => s.add(t.id)); S.ui.selPlan = null; selRefresh(); },
  'sel-none': () => { if (S.ui.sel) S.ui.sel.clear(); S.ui.selPlan = null; selRefresh(); },
  'sel-del': () => { const s = S.ui.sel; if (!s || !s.size) return; S.ui.selPlan = delPlan({ ids: [...s] }, { label: s.size + ' selecionado' + (s.size === 1 ? '' : 's') }); selRefresh(); const p = $('#del-plan'); if (p) p.scrollIntoView({ block: 'nearest' }); },
  'sel-plan-cancel': () => { S.ui.selPlan = null; selRefresh(); },
  'sel-cat': () => openBulkCategory(),
  'bulk-cat-apply': () => bulkCategory(),
  theme: el => { const v = el.dataset.v; if (v === 'system') ls.del('ff-theme'); else ls.set('ff-theme', v); applyTheme(v); openSettings(); if (S.ui.tab === 'painel') renderPainel(); },
  export: () => exportBackup(),
  'wipe-ask': () => openSettings('wipe'),
  'wipe-yes': () => wipeAll(),
  'restore-yes': () => restoreBackup(),
  'example-view': () => { S.mode = 'example'; closeSheet(); S.ver++; renderAfterChange(true); },
  'example-exit': () => { S.mode = 'real'; closeSheet(); S.ver++; renderAfterChange(true); }
};
document.addEventListener('click', ev => {
  const tab = ev.target.closest('.tab');
  if (tab) { closeSheet(); if ($('#triage-root').innerHTML) stopTriage(); setTab(tab.dataset.tab); return; }
  const el = ev.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'DETAILS' || el.tagName === 'SUMMARY') return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  try { fn(el, ev); } catch (e) { reportErr('Algo deu errado: ' + (e.message || e)); console.error(e); }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target && ev.target.id === 'imp-pdf-pw') { ev.preventDefault(); ACT['imp-pdf-pw'](); return; }
  if (ev.key === 'Enter' && ev.target && ev.target.dataset && ev.target.dataset.bfpw) { ev.preventDefault(); bfPassword(ev.target.dataset.bfpw); return; }
  if (ev.key === 'Escape') { if ($('#sheet-root').innerHTML) closeSheet(); else if ($('#triage-root').innerHTML) stopTriage(); }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('sk-node')) { ev.preventDefault(); openNodeSheet(ev.target.dataset.id); }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && $('#triage-root').innerHTML && TRI.undo.length && !/^(INPUT|TEXTAREA)$/.test((ev.target || {}).tagName || '')) { ev.preventDefault(); triageUndo(); }
});
let searchT = null;
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.datemask) {
    const before = t.value; const m = maskDate(before);
    if (m !== before) { t.value = m; try { t.setSelectionRange(m.length, m.length); } catch (e) { /* ignore */ } }
    if (m.length === 10) readDateField(t.id); else { t.classList.remove('invalid'); const er = $('#' + t.id + '-err'); if (er) er.hidden = true; }
    if (/^hol-/.test(t.id) && m.length === 10 && S.imp && S.imp.hol) { readHolerite(); if (t.id === 'hol-adv-date') S.imp.hol.advDateTouched = true; if (t.id === 'hol-date' && S.imp.hol.adv && !S.imp.hol.advDateTouched) { S.imp.hol.advDate = E.defaultAdvanceDate(S.imp.hol.date); const ad = $('#hol-adv-date'); if (ad) ad.value = isoToBR(S.imp.hol.advDate); } const sp = $('#hol-split'); if (sp) sp.innerHTML = holSplitHTML(S.imp.hol); }
    return;
  }
  if (t.dataset && t.dataset.cnae) { renderCnaeSuggestion(t.dataset.cnae, t.value); return; }
  if (t.dataset && t.dataset.alf) { alInput(t); return; }
  if (t.id === 'tx-search') { clearTimeout(searchT); searchT = setTimeout(() => { S.ui.q = t.value; S.ui.txLimit = 200; saveTxPrefs(); renderTxList(); }, 150); }
  else if (t.id === 'imp-check') { S.imp.checksum = t.value; clearTimeout(searchT); searchT = setTimeout(() => { renderImport(); const i = $('#imp-check'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 500); }
  else if (t.id === 'hol-net') { S.imp.hol.net = t.value; S.imp.hol.netTouched = t.value.trim() !== ''; const sp = $('#hol-split'); if (sp) sp.innerHTML = holSplitHTML(S.imp.hol); }
  else if (S.imp && S.imp.hol && (t.classList.contains('hol-in') || t.id === 'hol-adv-pct')) { readHolerite(); const sp = $('#hol-split'); if (sp) sp.innerHTML = holSplitHTML(S.imp.hol); }
  else if (t.id === 'rl-value' || t.id === 'rl-op' || t.id === 'rl-field') updateRulePreview();
  else if (t.id === 'imp-acc-name' && S.imp) S.imp.newAcc.name = t.value;
  else if (t.id === 'bf-new-name' && S.imp && S.imp.batch && S.imp.batch.form) S.imp.batch.form.name = t.value;
  else if (t.dataset && t.dataset.bfck) { const it = bfItem(t.dataset.bfck); if (it) { it.checksum = t.value; const o = $('#bf-ckres-' + CSS.escape(it.key)); if (o) o.innerHTML = bfCheckHTML(it); } }
  else if (t.id === 'mv-name' && S.accUI && S.accUI.move) S.accUI.move.name = t.value;
});
document.addEventListener('focusout', ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.datemask && t.value) readDateField(t.id);
  if (_deferRender && !$('#sheet-root').innerHTML) {
    setTimeout(() => { const ae = document.activeElement; const scr = $(SCREENS[S.ui.tab]); if (_deferRender && !(ae && scr && scr.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) && S.ui.tab !== 'import') { _deferRender = false; renderCurrent(); } }, 0);
  }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  try {
    if (t.dataset && t.dataset.nativeFor) {
      const txt = $('#' + t.dataset.nativeFor);
      if (txt && t.value) { txt.value = isoToBR(t.value); txt.dispatchEvent(new Event('input', { bubbles: true })); readDateField(txt.id); }
      return;
    }
    if (t.dataset && t.dataset.catsel) {
      const p = t.id === 'ed-cat' ? 'ed' : t.id === 'rl-cat' ? 'rl' : null;
      if (t.value === '__new') { if (p) ncOpen(p); return; }
      t.dataset.prev = t.value;
      if (p) { const f = $('#' + p + '-nc'); if (f) f.hidden = true; }
      if (t.id === 'ed-cat' && t.value) { const k = kindFor(t.value); const ks = $('#ed-kind'); const cur = txById(((S.sheet || {}).id) || ''); if (k && ks && (!cur || countable(cur))) { ks.value = k; ks.dispatchEvent(new Event('change', { bubbles: true })); } const rb = $('#ed-remember'); if (rb && cur) rb.checked = rememberDefault(cur, t.value); }
      return;
    }
    if (t.dataset && t.dataset.alf) { alInput(t); return; }
    if (t.dataset && t.dataset.ncgroup) { const ng = $('#' + t.dataset.ncgroup + '-nc-ng'); if (ng) ng.hidden = t.value !== '__newgroup'; return; }
    if (t.id === 'tri-remember') { TRI.remember = t.checked; TRI.touched = true; return; }
    if (t.id === 'ed-kind') { const a = $('#ed-tr'), b = $('#ed-cp'); if (a) a.hidden = t.value !== 'transfer'; if (b) b.hidden = t.value !== 'card_payment'; return; }
    if (t.id === 'ed-tr-acc') { const cur = txById(((S.sheet || {}).id) || ''); const box = $('#ed-tr-pairs'); if (cur && box) box.innerHTML = t.value ? edPairHTML(cur, t.value) : ''; return; }
    if (t.dataset && t.dataset.who) { const root = t.closest('[data-who-where]'); if (root) { S.trUI = Object.assign(S.trUI || {}, { who: whoSelected(root.dataset.whoWhere) }); } return; }
    if (t.id === 'cc-type') { ccSet({ type: t.value }); return; }
    if (t.id === 'cc-range') { ccSet({ range: t.value === 'all' ? 'all' : +t.value }); return; }
    if (t.id === 'cc-group') { ccSet({ level: 'category', groupId: t.value }); return; }
    if (t.id === 'tx-sort') { S.ui.sort = t.value; saveTxPrefs(); renderTxList(); return; }
    if (t.dataset && t.dataset.carryx) { setMonthExcluded(t.dataset.carryx, t.checked); return; }
    if (t.id === 'carry-enabled') { updateSettings(st => { st.carry = Object.assign({ excluded: [], included: [] }, st.carry || {}, { enabled: t.checked }); }); return; }
    if (t.id === 'carry-start') { updateSettings(st => { st.carry = Object.assign({ enabled: true, excluded: [], included: [] }, st.carry || {}, { startMonth: t.value || null }); }); return; }
    if (t.dataset && t.dataset.bfacc) { const it = bfItem(t.dataset.bfacc); if (!it) return; const B = S.imp.batch; if (t.value === '__new') { bfFormOpen(it.key); return; } if (B.form && B.form.target === it.key) B.form = null; it.ov = { id: t.value, auto: false }; bfRefresh(); return; }
    if (t.id === 'bf-shared') { const B = S.imp.batch; if (t.value === '__new') { bfFormOpen('shared'); return; } if (B.form && B.form.target === 'shared') B.form = null; B.shared = t.value; B.sharedTouched = true; bfAutoAll(B); bfRefresh(); return; }
    if (t.id === 'bf-new-type') { if (S.imp && S.imp.batch && S.imp.batch.form) S.imp.batch.form.type = t.value; return; }
    if (t.dataset && t.dataset.fxrate && S.imp) {
      const [cur, ym] = t.dataset.fxrate.split('|'); const v = E.parseRate(t.value);
      S.imp.fxRates[cur] = S.imp.fxRates[cur] || {};
      if (v) S.imp.fxRates[cur][ym] = v; else delete S.imp.fxRates[cur][ym];
      if (S.imp.batch && !S.imp.batchKey) bfRefresh(); else { runPreview(); renderImport(); }
      return;
    }
    if (t.id === 'imp-file' && t.files && t.files.length) { const fs = Array.from(t.files); t.value = ''; handleFiles(fs); }
    else if (t.id === 'restore-file' && t.files && t.files[0]) readBackup(t.files[0]);
    else if (t.id === 'imp-acc') { S.imp.accountId = t.value; S.imp.accTouched = true; $('#new-acc').hidden = t.value !== '__new'; const an = $('#imp-alert-note'); if (an) an.hidden = t.value !== S.imp.fromAlert; }
    else if (t.id === 'imp-acc-type') { S.imp.newAcc.type = t.value; S.imp.accTypeTouched = true; }
    else if (t.dataset && t.dataset.col != null && t.id.startsWith('imp-col-')) setColumnRole(+t.dataset.col, t.value);
    else if (t.id === 'imp-sign') { S.imp.profile.signConvention = t.value; runPreview(); renderImport(); }
    else if (t.id === 'hol-adv') { readHolerite(); const box = $('#hol-adv-box'); if (box) box.hidden = !t.checked; if (t.checked && !S.imp.hol.advDateTouched) { S.imp.hol.advDate = E.defaultAdvanceDate(S.imp.hol.date); const ad = $('#hol-adv-date'); if (ad) ad.value = isoToBR(S.imp.hol.advDate); } const sp = $('#hol-split'); if (sp) sp.innerHTML = holSplitHTML(S.imp.hol); }
    else if (t.id === 'hol-emp' || (t.dataset && t.dataset.od != null)) { readHolerite(); }
    else if (t.id === 'man-month-sel' && S.manUI) { S.manUI.month = t.value; if (S.manUI.plan && S.manUI.plan.section === 'month') S.manUI.plan = null; renderManageSheet(); }
    else if (t.id === 'man-month-acc' && S.manUI) { S.manUI.monthAcc = t.value; if (S.manUI.plan && S.manUI.plan.section === 'month') S.manUI.plan = null; renderManageSheet(); }
    else if (t.id === 'man-acc-sel' && S.manUI) { S.manUI.acc = t.value; if (S.manUI.plan && S.manUI.plan.section === 'account') S.manUI.plan = null; renderManageSheet(); }
    else if (t.name === 'man-keep' && S.manUI) { S.manUI.keepAcc = t.value === 'yes'; if (S.manUI.plan && S.manUI.plan.section === 'account') S.manUI.plan = null; renderManageSheet(); }
    else if (t.id === 'man-allfile' && S.manUI) { S.manUI.allFile = t.checked; manPlanFile(); renderManageSheet(); }
    else if (t.id === 'mv-acc') { if (S.accUI && S.accUI.move) S.accUI.move.to = t.value; const nb = $('#mv-new'); if (nb) nb.hidden = t.value !== '__new'; }
    else if (t.id === 'mv-type') { if (S.accUI && S.accUI.move) S.accUI.move.type = t.value; }
    else if (t.dataset && t.dataset.accname) { const a = D().accounts.find(x => x.id === t.dataset.accname); if (a && t.value.trim() && a.name !== t.value.trim()) { a.name = t.value.trim(); a.updatedAt = nowISO(); commit({ meta: ['accounts'] }); toast('Conta renomeada'); } }
    else if (t.dataset && t.dataset.acctype) changeAccountType(t.dataset.acctype, t.value);
    else if (t.dataset && t.dataset.gname) { const g = D().categories.find(x => x.id === t.dataset.gname); if (g && t.value.trim()) { g.name = t.value.trim(); S.ui.openGroup = g.id; commit({ meta: ['categories'], render: false }); renderBadge(); } }
    else if (t.dataset && t.dataset.gcolor) { const g = D().categories.find(x => x.id === t.dataset.gcolor); if (g) { g.color = t.value; S.ui.openGroup = g.id; commit({ meta: ['categories'] }); } }
    else if (t.dataset && t.dataset.cname) { const g = D().categories.find(x => x.id === t.dataset.g); const c = g && (g.children || []).find(x => x.id === t.dataset.cname); if (c && t.value.trim()) { c.name = t.value.trim(); commit({ meta: ['categories'], render: false }); } }
    else if (t.dataset && t.dataset.gbud) { const v = parseMoney(t.value); const b = D().settings.budgets = D().settings.budgets || {}; if (v) b[t.dataset.gbud] = Math.abs(v); else delete b[t.dataset.gbud]; if (S.mode === 'example') { const ub = S.example.userBudgets = S.example.userBudgets || {}; if (v) ub[t.dataset.gbud] = Math.abs(v); else delete ub[t.dataset.gbud]; } t.value = v ? centsToInput(Math.abs(v)) : ''; commit({ meta: ['settings'], render: false }); }
  } catch (e) { reportErr('Algo deu errado: ' + (e.message || e)); console.error(e); }
});
document.addEventListener('toggle', ev => {
  const d = ev.target;
  if (d.classList && d.classList.contains('grp') && d.open) S.ui.openGroup = d.dataset.gid;
  if (d.classList && d.classList.contains('acc-al') && S.accUI) { S.accUI.open = S.accUI.open || {}; S.accUI.open[d.dataset.accal] = d.open; if (!d.open && S.accUI.cfg === d.dataset.accal) S.accUI.cfg = null; }
}, true);
document.addEventListener('dragover', ev => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', ev => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) d.classList.remove('over'); });
/* file pickers: arm the "did it open?" check (Android) */
document.addEventListener('click', ev => {
  const l = ev.target.closest && ev.target.closest('label[for="imp-file"], label[for="restore-file"], #imp-file, #restore-file');
  if (l) armPicker(l.id === 'imp-file' || l.id === 'restore-file' ? l.id : l.getAttribute('for'));
}, true);
/* pasting anywhere on the import screen (step 1) fills the paste box */
document.addEventListener('paste', ev => {
  if (S.ui.tab !== 'import' || !S.imp || S.imp.tab !== 'arquivo' || S.imp.step !== 1 || S.imp.batch || S.imp.done) return;
  const t = ev.target; if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
  const sc = $('#scr-import'); if (!sc || sc.hidden) return;
  const txt = ev.clipboardData && ev.clipboardData.getData('text');
  if (!txt || !txt.trim()) return;
  ev.preventDefault();
  S.imp.paste = txt; S.imp.pasteOpen = true; S.imp.err = '';
  const ta = $('#imp-paste'); const box = $('#imp-paste-box');
  if (ta && box) { box.open = true; ta.value = txt; ta.scrollIntoView({ block: 'center' }); } else renderImport();
  toast('Texto colado — confira a conta e toque em "Analisar texto colado".');
});
document.addEventListener('drop', ev => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) { ev.preventDefault(); d.classList.remove('over'); const fs = ev.dataTransfer && ev.dataTransfer.files; if (fs && fs.length) handleFiles(fs); } });
/* category chart: hover/focus tooltip (touch: a tap opens the transactions) */
document.addEventListener('pointermove', ev => {
  if (ev.pointerType === 'touch') return;
  const m = ev.target.closest && ev.target.closest('#cc-chart [data-s][data-p]');
  if (m) ccTip(m, ev); else if (ev.target.closest && !ev.target.closest('#cc-tip')) { const tip = $('#cc-tip'); if (tip && !tip.hidden) ccTipHide(); }
}, { passive: true });
document.addEventListener('focusin', ev => {
  const col = ev.target.closest && ev.target.closest('#cc-chart .cc-col');
  if (col) { const segs = $$('[data-s]', col); if (segs.length) ccTip(segs[segs.length - 1]); }
});
document.addEventListener('focusout', ev => { if (ev.target.closest && ev.target.closest('#cc-chart .cc-col')) ccTipHide(); });
/* sticky period bar: header height → CSS var; "stuck" → compact layout */
function syncTopbarH() { const tb = $('.topbar-in'); if (tb) document.documentElement.style.setProperty('--topbar-h', Math.ceil(tb.getBoundingClientRect().height + 1) + 'px'); }
let _stuckRaf = 0;
function updateStuck() {
  _stuckRaf = 0;
  const pb = $('#period-bar'); if (!pb || S.ui.tab !== 'painel') return;
  const top = parseFloat(getComputedStyle(pb).top) || 0;
  const r = pb.getBoundingClientRect();
  const stuck = window.scrollY > 8 && r.top <= top + 1;
  if (pb.classList.contains('stuck') !== stuck) pb.classList.toggle('stuck', stuck);
}
window.addEventListener('scroll', () => { if (!_stuckRaf) _stuckRaf = requestAnimationFrame(updateStuck); }, { passive: true });
try { if (window.ResizeObserver) new ResizeObserver(syncTopbarH).observe(document.querySelector('.topbar-in')); } catch (e) { /* ignore */ }
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.ui.tab === 'painel' && S.booted) renderPainel(); }); } catch (e) { /* ignore */ }
let rT = null, lastW = window.innerWidth;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 30 && S.ui.tab === 'painel') { lastW = window.innerWidth; renderPainel(); } }, 200); });

/* ================= boot ================= */
async function boot() {
  applyTheme(ls.get('ff-theme') || 'system');
  if (!E) { $('#scr-painel').innerHTML = '<div class="banner err"><div><b>O motor de cálculo não carregou.</b> Recarregue a página.</div></div>'; return; }
  try { S.example = buildExample(); } catch (e) { console.error(e); S.example = emptyData(); reportErr('Não consegui montar os dados de exemplo: ' + (e.message || e)); }
  loadTxPrefs();
  const savedTab = ss.get('ff-tab');
  S.ui.tab = ['painel', 'tx', 'import', 'cats'].includes(savedTab) ? savedTab : 'painel';
  pickMonth(true);
  setTab(S.ui.tab);
  if (typeof window.createStore !== 'function') {
    S.booted = true; S.status = 'error'; renderStorePill();
    reportErr('A camada de armazenamento (store.js) não carregou. Nada será salvo.');
    return;
  }
  try {
    store = window.createStore({});
    window.FinStore = store;
  } catch (e) { reportErr('Não consegui iniciar o armazenamento: ' + (e.message || e)); return; }
  store.onStatus(st => { S.status = st; renderStorePill(); });
  store.onAuth(async ev => {
    const u = ev && ev.user || null;
    const was = S.auth.user && S.auth.user.id;
    S.auth.user = u;
    if ((u && u.id) !== was) {
      if (u) await loadFromStore(); else { S.real = null; S.mode = 'example'; P.months.clear(); P.meta.clear(); S.ver++; renderAfterChange(true); }
    }
    renderStorePill(); renderBanner();
  });
  store.subscribe(ev => { try { applyRemote(ev); } catch (e) { console.error(e); } });
  try {
    const r = await store.init();
    S.auth.mode = r && r.mode || 'local';
    S.auth.user = r && r.user || null;
    S.status = store.status || (S.auth.mode === 'local' ? 'local' : 'signed_out');
  } catch (e) { reportErr('Não consegui iniciar o armazenamento: ' + (e.message || e)); S.auth.mode = 'local'; }
  S.booted = true;
  if (!signedOut()) await loadFromStore();
  else { S.mode = 'example'; S.ver++; renderAfterChange(true); }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushPersist(); return; }
    // a new day since the last render: the alerts depend on the device's date
    if (S._alDay && S._alDay !== todayISO() && !$('#triage-root').innerHTML) renderAfterChange(false, true);
  });
  window.addEventListener('pagehide', () => { flushPersist(); });
}
// test hook (read-only views of the state), harmless in production
window.__ff = { state: () => S, live: () => live(), D: () => D(), period: () => period(), flush: () => flushPersist(), store: () => store, health: () => health(), carry: () => carryInfo(), alerts: () => alerts() };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
