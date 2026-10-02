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
const TYPE_FILTER_LBL = { expense: 'Gasto', income: 'Entrada', transfer: 'Transferência', card_payment: 'Pagamento de fatura', investment: 'Investimento' };
const SRC_LBL = { rule: 'regra', learned: 'aprendido', dictionary: 'dicionário', ai: 'IA', manual: 'manual' };
const SRC_FILTER = [['rule', 'Regra'], ['learned', 'Aprendido'], ['dictionary', 'Dicionário'], ['manual', 'Manual'], ['none', 'Sem categoria']];
const ACC_TYPES = { credit_card: 'Cartão de crédito', checking: 'Conta corrente', savings: 'Poupança', cash: 'Dinheiro', payslip: 'Holerite' };
const ROLE_LBL = { ignore: 'Ignorar', date: 'Data', time: 'Hora', description: 'Descrição', amount: 'Valor', debit: 'Débito', credit: 'Crédito', dcFlag: 'Indicador D/C', installment: 'Parcela', balance: 'Saldo (ignorar)' };
const SIGN_LBL = { negative_is_expense: 'Negativos = gasto', positive_is_expense: 'Compras positivas = gasto', dc_flag: 'Coluna D/C', split_columns: 'Débito e crédito separados' };
const SORTS = [['date_desc', 'Data (padrão, mais recentes)'], ['date_asc', 'Data (antigas primeiro)'], ['amt_desc', 'Maior valor'], ['amt_asc', 'Menor valor'], ['merchant', 'Estabelecimento A–Z'], ['category', 'Categoria']];
const PALETTE = ['#4F7DF3', '#F2994A', '#9B6BF2', '#2BB3C0', '#E25D7B', '#E8B931', '#C86DD7', '#6C8EAD', '#C08457', '#3BA99C', '#D9534F', '#5B8C3A'];
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
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
function toast(msg, err) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2800);
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
  return { categories: cats, rules: [], history: [], profiles: [], accounts: [], settings: { budgets: {}, schemaVersion: 2 }, imports: {}, txs: [] };
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
  const m = catIndex()[catId];
  if (!m) return catId;
  return m.isGroup ? m.name : m.group.name + ' › ' + m.name;
}
function accName(id) { const a = (D().accounts || []).find(a => a.id === id); return a ? a.name : id; }
function accType(id) { const a = (D().accounts || []).find(a => a.id === id); return a ? a.type : null; }
function ctx() { return { rules: D().rules || [], dictionary: (E && E.DEFAULT_DICTIONARY) || [], categories: D().categories, accounts: D().accounts || [] }; }
const countable = t => t.kind !== 'card_payment' && t.kind !== 'transfer';
const isUncat = t => !t.categoryId && countable(t);
const kindFor = catId => (E && E.kindForCategory ? E.kindForCategory(catId, D().categories) : null);
const uncatCount = () => live().filter(isUncat).length;

/* ================= store glue ================= */
let store = null;
const META = ['settings', 'categories', 'rules', 'profiles', 'accounts', 'imports'];
const P = { months: new Set(), meta: new Set(), timer: null, busy: false, again: false };

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
  else if (name === 'categories') d.categories = v.length ? v : clone(E.DEFAULT_CATEGORIES);
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
    for (const n of meta) await store.saveMeta(n, metaBody(n));
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
    if (bits.length) toast('Dados atualizados para a v2: ' + bits.join(' · '));
  }
  return { migrated: m };
}

function applyRemote(ev) {
  if (!ev || !ev.kind) return;
  if (!S.real) S.real = emptyData();
  const d = S.real;
  if (ev.kind === 'meta') {
    if (META.indexOf(ev.key) < 0) return;
    if (P.meta.has(ev.key)) return; // our own pending write wins (the store merges server-side)
    applyMeta(d, ev.key, ev.data);
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
  renderStorePill(); renderBanner(); renderBadge();
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
function periodLabel() {
  const p = period(); const [ey, em] = p.end.split('-').map(Number); const [sy, sm] = p.start.split('-').map(Number);
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
    <div class="period">
      <div class="month-nav">
        <button class="icon-btn" type="button" data-act="month" data-d="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <span class="lbl-m" id="period-label">${esc(periodLabel())}</span>
        <button class="icon-btn" type="button" data-act="month" data-d="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <div class="seg" role="group" aria-label="Período">
        ${[1, 3, 6, 12].map(r => `<button type="button" data-act="range" data-r="${r}" aria-pressed="${S.ui.range === r}">${r === 1 ? 'Mês' : r + 'm'}</button>`).join('')}
      </div>
    </div>
    <div class="kpis" role="list">
      <div class="kpi" role="listitem"><span class="eyebrow">Entradas</span><span class="v money in" id="kpi-income" data-cents="${inc}">${brl(inc)}</span></div>
      <div class="kpi" role="listitem"><span class="eyebrow">Saídas</span><span class="v money out" id="kpi-expense" data-cents="${exp}">${brl(exp)}</span></div>
      <div class="kpi" role="listitem"><span class="eyebrow">Saldo</span><span class="v money ${net < 0 ? 'out' : ''}" id="kpi-net" data-cents="${net}">${brl(net)}</span></div>
      <div class="kpi" role="listitem"><span class="eyebrow">Taxa de poupança</span><span class="v num ${rate != null && rate < 0 ? 'out' : ''}">${rate == null ? '—' : (rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</span></div>
    </div>
    <div class="card" id="sankey-card">
      <div class="card-h">
        <h2>Para onde foi o dinheiro</h2>
        <div class="seg" role="group" aria-label="Visão do fluxo">
          <button type="button" data-act="view" data-v="category" aria-pressed="${S.ui.view === 'category'}">Por categoria</button>
          <button type="button" data-act="view" data-v="account" aria-pressed="${S.ui.view === 'account'}">Por conta/cartão</button>
        </div>
      </div>
      <div class="sankey-wrap" id="sankey-wrap"></div>
      <div class="row" style="justify-content:space-between">
        <span class="sk-hint">Toque num bloco para ver os lançamentos.</span>
        ${S.ui.view === 'category' || narrow ? `<button class="btn ghost sm" type="button" data-act="full">${S.ui.full ? 'Resumir em 3 colunas' : (S.ui.view === 'category' ? 'Detalhar subcategorias' : 'Detalhar por grupo')}</button>` : ''}
      </div>
    </div>
    <div class="card" id="budget-card"></div>
    <div class="card">
      <div class="card-h"><h2>Entradas × saídas</h2><div class="legend"><span><i style="background:var(--in)"></i>Entradas</span><span><i style="background:var(--out)"></i>Saídas</span></div></div>
      <div id="series-chart"></div>
    </div>
    <div class="card" id="future-card"></div>`;
  drawSankey(narrow);
  renderBudget(sum);
  drawSeries();
  renderFuture();
}
/* ---------- Sankey ---------- */
function prepareSankey(narrow){
  const p = period();
  const g = eng('buildSankey', live(), { from:p.from, to:p.to, categories:D().categories, accounts:D().accounts, view:S.ui.view, maxNodes: narrow ? 8 : 14 });
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
  const colorOf = n => n.color || 'var(--accent)';
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
  } else if(/sobra|poupan/i.test(node.name)) body += '<p class="muted">É o que sobrou das entradas depois das saídas no período. Investimentos e aplicações entram aqui quando não são classificados como gasto.</p>';
  else if(/impost|inss|irrf/i.test(node.name)) body += '<p class="muted">Descontos do holerite (INSS, IRRF e outros). Eles saem do salário bruto antes de o dinheiro chegar na conta.</p>';
  else if(/or[çc]amento/i.test(node.name)) body += '<p class="muted">Tudo o que entrou no período, antes de ser distribuído entre os gastos e a sobra.</p>';
  else body += '<p class="muted">Este bloco agrupa valores sem lançamentos individuais para mostrar aqui.</p>';
  openSheet(`<div><span class="eyebrow">${esc(periodLabel())}</span><h2>${esc(node.name)}</h2><p class="money" style="font-size:1.1rem;font-weight:700">${brl(node.v)}</p></div>`, body);
}

/* ---------- budget ---------- */
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
  return `<button type="button" class="tx ${unc ? 'uncat' : ''}" data-act="edittx" data-id="${esc(t.id)}">${txIcon(t)}
    <span class="mid"><span class="mer">${esc(t.merchant || t.rawDescription)}</span>${meta.length ? `<span class="meta">${meta.join('<span aria-hidden="true">·</span>')}</span>` : ''}<span class="raw">${esc(t.rawDescription)} · ${esc(accName(t.accountId))}</span><span class="tags">${tags.join('')}</span></span>
    <span class="amt ${cls}">${t.amount > 0 ? '+' : ''}${brl(t.amount)}</span></button>`;
}

/* --- filters (session-remembered) --- */
function emptyAdv() { return { from: '', to: '', min: '', max: '', types: [], accounts: [], cats: [], sources: [], inst: false, note: false, text: '' }; }
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
  if (a.inst) n++; if (a.note) n++; if ((a.text || '').trim()) n++;
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
  const accs = (D().accounts || []).filter(a => live().some(t => t.accountId === a.id));
  const f = S.ui.filter;
  const n = advCount();
  const chip = (key, label, extra) => `<button type="button" class="chip" data-act="filter" data-f="${esc(key)}" aria-pressed="${f === key}">${label}${extra || ''}</button>`;
  el.innerHTML = `
    <div class="row" style="justify-content:space-between"><h2 style="font-size:1.35rem">Transações</h2>
      <button type="button" class="btn primary sm" data-act="triage" id="btn-triage" ${unc ? '' : 'disabled'}>Modo triagem${unc ? ` · ${unc}` : ''}</button></div>
    <div class="searchbar"><input type="search" id="tx-search" placeholder="Buscar estabelecimento, descrição ou valor" value="${esc(S.ui.q)}" aria-label="Buscar transações"></div>
    <div class="chips" role="group" aria-label="Filtros rápidos">
      ${chip('all', 'Todas')}${chip('uncat', 'Sem categoria', unc ? `<span class="cnt">${unc}</span>` : '')}${chip('in', 'Entradas')}${chip('out', 'Saídas')}
      ${accs.map(a => chip('acc:' + a.id, esc(a.name))).join('')}
    </div>
    <div class="toolbar">
      <button type="button" class="btn sm" data-act="filters" id="btn-filters" aria-label="Filtros${n ? ' (' + n + ' ativos)' : ''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtros${n ? `<span class="cnt" id="filters-count">${n}</span>` : ''}</button>
      ${n ? '<button type="button" class="btn ghost sm" data-act="filters-clear" id="btn-filters-clear">Limpar</button>' : ''}
      <label class="sr-only" for="tx-sort">Ordenar</label>
      <select id="tx-sort" aria-label="Ordenar">${SORTS.map(([k, v]) => `<option value="${k}" ${S.ui.sort === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </div>
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
    <div class="check-list"><label class="check-chip"><input type="checkbox" id="f-inst" ${a.inst ? 'checked' : ''}>Só parceladas</label><label class="check-chip"><input type="checkbox" id="f-note" ${a.note ? 'checked' : ''}>Com nota</label></div>
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
    inst: !!($('#f-inst') || {}).checked, note: !!($('#f-note') || {}).checked, text: ($('#f-text') || {}).value || '' };
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
function openTxEditor(id) {
  const t = txById(id); if (!t) return;
  const head = `<span class="eyebrow">${esc(new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }))}${t.time ? ' · ' + esc(t.time) : ''} · ${esc(accName(t.accountId))}</span>
    <h2 style="word-break:break-word">${esc(t.merchant || t.rawDescription)}</h2><p class="money ${t.amount > 0 ? 'in' : ''}" style="font-size:1.25rem;font-weight:700">${t.amount > 0 ? '+' : ''}${brl(t.amount)}</p>
    ${txMetaBits(t).length ? `<p class="small muted" id="ed-meta">${txMetaBits(t).join(' · ')}</p>` : ''}
    <p class="xs faint" style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${esc(t.rawDescription)}</p>`;
  const body = `
    <div class="field cat-picker"><label for="ed-cat">Categoria</label>${catSelect('ed-cat', t.categoryId, { allowNone: true })}${newCatForm('ed', { kind: t.amount > 0 ? 'income' : 'expense' })}</div>
    <label class="remember" for="ed-remember"><input type="checkbox" id="ed-remember" checked><span>Lembrar esta categoria para <b>${esc(t.merchant || t.rawDescription)}</b><br><span class="xs muted">Cria uma regra e categoriza os outros lançamentos desse estabelecimento que estão sem categoria ou vieram do dicionário. Desmarque para mudar só este.</span></span></label>
    <div class="field"><label for="ed-kind">Tipo</label><select id="ed-kind">${Object.entries(KIND_LBL).map(([k, v]) => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="xs muted">O tipo acompanha a categoria (Renda → entrada, Investimentos → investimento, demais → gasto; valores positivos em gastos são estornos).</span></div>
    <div class="field"><label for="ed-note">Observação</label><input type="text" id="ed-note" value="${esc(t.note || '')}" placeholder="Opcional"></div>
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
  commit({ txs: changed, meta: ruleChanged || created ? ['rules'] : [] });
  return { txs: before, rules: ruleChanged ? prevRules : null, history: ruleChanged ? prevHistory : null, created: ruleChanged ? created : null, n: changed.length - 1 };
}
function saveTxEdit(id) {
  const t = txById(id); if (!t) return;
  let cat = ($('#ed-cat') || {}).value || null;
  if (cat === '__new') { toast('Termine de criar a categoria ou escolha uma existente.', true); return false; }
  const kind = ($('#ed-kind') || {}).value || t.kind;
  const note = (($('#ed-note') || {}).value || '').trim();
  const remember = !!($('#ed-remember') || {}).checked;
  const changedCat = cat !== (t.categoryId || null);
  let res = null;
  if (changedCat) res = setCategory(t, cat, { kind, note, remember });
  else {
    const upd = Object.assign({}, t, { kind });
    if (note) upd.note = note; else delete upd.note;
    if (kind !== t.kind && !upd.categoryId) upd.catSource = 'manual';
    commit({ txs: [upd] });
  }
  const bits = ['Salvo'];
  if (res && res.created) bits.push('regra aprendida para ' + (t.merchant || ''));
  if (res && res.n) bits.push(res.n + ' outro' + (res.n > 1 ? 's' : '') + ' de ' + t.merchant);
  toast(bits.join(' · '));
  return true;
}

/* ================= TRIAGEM ================= */
const TRI = { queue: [], idx: 0, done: 0, total: 0, start: 0, timer: null, streak: 0, group: null, undo: [], newCat: false, remember: true };
function startTriage() {
  const q = live().filter(isUncat).sort((a, b) => b.date.localeCompare(a.date));
  if (!q.length) { toast('Nada para classificar.'); return; }
  Object.assign(TRI, { queue: q.map(t => t.id), idx: 0, done: 0, total: q.length, start: Date.now(), streak: 0, group: null, undo: [], newCat: false, remember: true });
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
  const own = (D().categories || []).filter(g => (g.kind || 'expense') === kind);
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
  if (TRI.newCat) {
    choices = newCatForm('tri', { open: true, kind: t.amount > 0 ? 'income' : 'expense' });
  } else if (TRI.group) {
    const g = (D().categories || []).find(x => x.id === TRI.group);
    choices = `<div class="row"><button class="btn ghost sm" type="button" data-act="tri-back">‹ Grupos</button><b>${esc(g.name)}</b></div><div class="tri-grid">
      ${(g.children || []).map(c => `<button type="button" class="tri-btn sub" data-act="tri-pick" data-cat="${esc(c.id)}"><span class="sw" style="background:${esc(g.color)}"></span>${esc(c.name)}</button>`).join('')}
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
      <label class="remember small" for="tri-remember"><input type="checkbox" id="tri-remember" ${TRI.remember ? 'checked' : ''}><span>Lembrar esta categoria para <b>${esc(t.merchant || t.rawDescription)}</b>${sameN > 1 ? ` <span class="faint">(e as outras ${sameN - 1} sem categoria)</span>` : ''}</span></label></div>
    ${choices}
    <div class="row"><button class="btn grow" type="button" data-act="tri-skip">Pular</button><button class="btn grow" type="button" data-act="tri-transfer">É transferência</button></div>
  </div></div>`;
}
const triState = () => ({ idx: TRI.idx, done: TRI.done, streak: TRI.streak });
function triagePick(catId) {
  const t = triageCurrent(); if (!t) return;
  const box = $('#tri-remember'); const remember = box ? box.checked : true;
  TRI.remember = remember;
  const st = triState();
  const before = uncatCount();
  const res = setCategory(t, catId, { remember });
  const after = uncatCount();
  const label = catLabel(catId) + ' para ' + (t.merchant || t.rawDescription) + (res.created ? ' + regra' : '') + (res.n ? ' (+' + res.n + ')' : '');
  pushUndo({ label, txs: res.txs, rules: res.rules, history: res.history, tri: st });
  TRI.done = Math.min(TRI.total, TRI.done + Math.max(1, before - after)); TRI.streak++; TRI.group = null; TRI.newCat = false; TRI.idx++;
  renderTriage();
}
function triageSkip() {
  const t = triageCurrent(); if (!t) return;
  pushUndo({ label: 'Pular ' + (t.merchant || t.rawDescription), txs: [], tri: triState() });
  TRI.idx++; TRI.streak = 0; TRI.group = null; TRI.newCat = false; renderTriage();
}
function triageTransfer() {
  const t = triageCurrent(); if (!t) return;
  pushUndo({ label: 'Transferência: ' + (t.merchant || t.rawDescription), txs: [clone(t)], tri: triState() });
  commit({ txs: [Object.assign({}, t, { kind: 'transfer', categoryId: null, catSource: 'manual' })] });
  TRI.done = Math.min(TRI.total, TRI.done + 1); TRI.streak++; TRI.idx++; TRI.group = null; TRI.newCat = false; renderTriage();
}
function triageUndo() {
  const u = TRI.undo.pop(); if (!u) return;
  const d = D();
  const meta = [];
  if (u.rules) { d.rules = u.rules; meta.push('rules'); }
  if (u.history) d.history = u.history;
  // restored records get a fresh updatedAt so the merge on the server keeps the undo
  commit({ txs: (u.txs || []).map(t => clone(t)), meta });
  Object.assign(TRI, u.tri, { group: null, newCat: false });
  renderTriage();
  toast('Desfeito: ' + u.label);
}
/* ================= IMPORTAR ================= */
function newImp(){ return { tab:'arquivo', step:1, accountId: defaultAccountId(), newAcc:{ name:'', type:'credit_card' }, paste:'', fileName:'', encoding:'', analysis:null, profile:null, matched:null, result:null, dedup:null, checksum:'', layoutName:'', ai:null, aiProblems:[], done:null, hol:null, importId:null, err:'' }; }
function defaultAccountId(){ const a = (S.mode==='real' && S.real ? S.real.accounts : []).filter(a=>a.type!=='payslip'); return a.length ? a[0].id : '__new'; }
function renderImport(){
  if(!S.imp) S.imp = newImp();
  const I = S.imp; const el = $('#scr-import');
  const tabs = `<div class="seg" role="group" aria-label="Tipo de importação" style="align-self:flex-start"><button type="button" data-act="imp-tab" data-t="arquivo" aria-pressed="${I.tab==='arquivo'}">Extrato ou fatura</button><button type="button" data-act="imp-tab" data-t="holerite" aria-pressed="${I.tab==='holerite'}">Holerite</button></div>`;
  if(I.tab==='holerite'){ el.innerHTML = `<h2 style="font-size:1.35rem">Importar</h2>${tabs}<div id="hol"></div>`; renderHolerite(); return; }
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
      <div class="field"><label for="imp-acc">Conta</label>${accountSelect('imp-acc', I.accountId)}</div>
      <div class="form-grid" ${I.accountId==='__new'?'':'hidden'} id="new-acc">
        <div class="field"><label for="imp-acc-name">Nome</label><input type="text" id="imp-acc-name" placeholder="Ex.: Nubank cartão" value="${esc(I.newAcc.name)}"></div>
        <div class="field"><label for="imp-acc-type">Tipo</label><select id="imp-acc-type">${['credit_card','checking','savings','cash'].map(k=>`<option value="${k}" ${I.newAcc.type===k?'selected':''}>${ACC_TYPES[k]}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="card">
      <h3>Envie o arquivo</h3>
      <label class="drop" id="drop" for="imp-file">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 15v4h14v-4"/></svg>
        <b>Escolher arquivo</b><span class="small muted">CSV, TXT, TSV, XLSX ou XLS do seu banco ou cartão</span>
        <input type="file" id="imp-file" accept=".csv,.txt,.tsv,.xlsx,.xls,text/csv,text/plain">
      </label>
      ${I.fileName?`<p class="small muted">Último: ${esc(I.fileName)}</p>`:''}
      <details ${I.paste?'open':''}><summary>Ou cole a tabela</summary>
        <div class="field" style="margin-top:10px"><label for="imp-paste">Copie as linhas do internet banking ou da planilha e cole aqui</label><textarea id="imp-paste" placeholder="Data;Descrição;Valor&#10;05/09/2026;IFOOD *RESTAURANTE;-54,90">${esc(I.paste)}</textarea></div>
        <div class="row end" style="margin-top:8px"><button class="btn primary" type="button" data-act="imp-paste">Analisar texto colado</button></div>
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
async function handleFile(file){
  const I = S.imp; I.err = '';
  if(!resolveAccount()){ renderImport(); return; }
  I.fileName = file.name;
  try{
    const buf = await file.arrayBuffer();
    let analysis;
    if(/\.xlsx?$/i.test(file.name)){
      const XLSX = await loadXLSX();
      const wb = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:'', blankrows:false }).map(r=>r.map(c=>c==null?'':String(c)));
      I.encoding = 'Planilha Excel';
      analysis = eng('analyzeRows', rows);
    } else {
      const dec = eng('decodeBytes', new Uint8Array(buf));
      if(!dec) throw new Error('não consegui ler o texto do arquivo');
      I.encoding = dec.encoding;
      analysis = eng('analyzeTable', dec.text);
    }
    startAnalysis(analysis);
  }catch(e){ I.err = 'Não consegui abrir "'+file.name+'": '+(e.message||e)+'. Se for PDF, exporte como CSV ou XLSX no app do banco.'; renderImport(); }
}
function handlePaste(){
  const I = S.imp; I.err = ''; I.paste = ($('#imp-paste')||{}).value || '';
  if(!resolveAccount()){ renderImport(); return; }
  if(!I.paste.trim()){ I.err = 'Cole pelo menos algumas linhas da tabela.'; renderImport(); return; }
  I.fileName = 'texto colado'; I.encoding = 'texto colado';
  startAnalysis(eng('analyzeTable', I.paste));
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
  I.importId = 'imp-'+Date.now().toString(36);
  const profiles = S.mode==='real' && S.real ? S.real.profiles : [];
  const m = profiles.length ? eng('matchProfile', analysis, profiles) : null;
  I.matched = m || null;
  I.profile = m ? clone(m) : (eng('profileFromAnalysis', analysis) || null);
  I.upgraded = [];
  if(m && I.profile){
    // layouts saved before v2 ignored the Parcela/Hora columns (D1/D2): adopt what the analysis finds now
    const used = new Set(Object.values(I.profile.columns||{}));
    for(const role of ['installment','time']){
      const c = (analysis.columns||[]).find(x=>x.role===role);
      if(c && I.profile.columns[role]==null && !used.has(c.index)){ I.profile.columns = Object.assign({}, I.profile.columns, { [role]: c.index }); used.add(c.index); I.upgraded.push(ROLE_LBL[role]); }
    }
  }
  if(!I.profile){ I.err = 'Não consegui montar a leitura deste layout.'; I.step = 2; renderImport(); return; }
  I.layoutName = m ? m.name : '';
  runPreview();
  I.step = m ? 3 : 2;
  renderImport();
}
function runPreview(){
  const I = S.imp; if(!I.analysis || !I.profile) return;
  const accId = I.accountId==='__new' ? '__pending' : I.accountId;
  const res = eng('applyProfile', I.analysis.rows, I.profile, { accountId:accId, importId:I.importId });
  I.result = res || { transactions:[], errors:[], total:0 };
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
  const prompt = (FEATURES.ai && oc<0.7 && S.sample) ? eng('buildAIPrompt', a) : null;
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
    <div class="row end"><button class="btn" type="button" data-act="imp-back">Voltar</button><button class="btn primary" type="button" data-act="imp-step" data-s="3">Conferir prévia</button></div>`;
  if(!FEATURES.ai || !S.sample) $$('[data-ai-btn]').forEach(x=>x.closest('.row').hidden = true);
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
  const rowsIdx = []; for(let i=start;i<end && rowsIdx.length<15;i++) rowsIdx.push(i);
  // make sure error rows are visible even past the first 15
  (R.errors||[]).forEach(e=>{ if(!rowsIdx.includes(e.rowIndex) && rowsIdx.length<25 && e.rowIndex>=0) rowsIdx.push(e.rowIndex); });
  rowsIdx.sort((x,y)=>x-y);
  const header = a.headerRowIndex!=null ? a.rows[a.headerRowIndex]||[] : [];
  const roleOpts = sel => Object.entries(ROLE_LBL).map(([k,v])=>`<option value="${k}" ${sel===k?'selected':''}>${v}</option>`).join('');
  const nDup = (I.dedup.duplicates||[]).length, nErr = (R.errors||[]).length, nFresh = (I.dedup.fresh||[]).length, nAll = (R.transactions||[]).length;
  const ck = I.checksum ? parseMoney(I.checksum) : null;
  let ckHtml = '';
  if(ck!=null){
    const diff = Math.abs(Math.abs(R.total||0) - Math.abs(ck));
    ckHtml = diff<=1 ? `<span class="check-res in">✓ Bate com o arquivo (${brl(Math.abs(R.total||0))})</span>`
      : `<span class="check-res out">Diferença de ${brl(diff)}</span><span class="small muted">Lido: ${brl(Math.abs(R.total||0))}. Confira as linhas em vermelho, o formato numérico e se há lançamentos fora do período.</span>`;
  }
  const accT = I.accountId==='__new' ? I.newAcc.type : accType(I.accountId);
  const guess = eng('guessAccountType', a, R.transactions);
  const mismatch = guess && accT && accT!=='payslip' && ((guess==='checking' && accT==='credit_card') || (guess==='credit_card' && (accT==='checking'||accT==='savings')));
  const nInst = (R.transactions||[]).filter(t=>t.installment && t.originalDate).length;
  const nTime = (R.transactions||[]).filter(t=>t.time).length;
  b.innerHTML = `
    ${mismatch?`<div class="banner err" id="acc-mismatch"><div class="grow"><b>Conta parece errada.</b> Este arquivo parece ${guess==='checking'?'um <b>extrato de conta corrente</b> (tem saldo, Pix, TED ou rendimentos)':'uma <b>fatura de cartão</b> (compras positivas, parcelas)'}, mas a conta escolhida é <b>${esc(ACC_TYPES[accT]||accT)}</b>. Isso muda o tipo dos lançamentos (entradas viram estornos).</div><button class="btn sm" type="button" data-act="imp-back">Trocar conta</button></div>`:''}
    ${(I.upgraded||[]).length?`<div class="banner info" id="layout-upgraded"><div>Layout salvo <b>${esc(I.matched?I.matched.name:'')}</b> atualizado: agora lê ${I.upgraded.map(x=>'a coluna <b>'+esc(x)+'</b>').join(' e ')}.</div></div>`:''}
    ${nInst?`<div class="banner info"><div><b>${nInst} parcela${nInst>1?'s':''}</b> lançada${nInst>1?'s':''} no mês da parcela (data da compra + parcelas já pagas). A data original da compra fica guardada.</div></div>`:''}
    <div class="card">
      <div class="card-h"><h3>Confira a leitura</h3>${I.matched?`<span class="tag ok">${esc(I.matched.name)}</span>`:''}</div>
      <p class="small muted">Se uma coluna estiver errada, troque o papel dela no cabeçalho. A prévia se atualiza na hora.</p>
      <div class="row">
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
      <p class="small"><b class="num">${nAll}</b> lançamento${nAll===1?'':'s'} · <b class="num">${nDup}</b> duplicado${nDup===1?'':'s'} ignorado${nDup===1?'':'s'} · <b class="num ${nErr?'out':''}">${nErr}</b> com erro</p>
      ${nErr?`<details><summary>Ver ${nErr} linha${nErr>1?'s':''} com erro</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${R.errors.map(e=>`<div class="small"><span class="tag err">linha ${e.rowIndex+1}</span> ${esc(e.reason)}<div class="xs faint" style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${esc(Array.isArray(e.raw)?e.raw.join(' | '):e.raw)}</div></div>`).join('')}</div></details>`:''}
      <div class="check-box">
        <label class="lbl" for="imp-check">Total no seu extrato/fatura</label>
        <input type="text" inputmode="decimal" id="imp-check" class="money-in" placeholder="Ex.: 4.123,45" value="${esc(I.checksum)}">
        <div id="check-res" style="display:flex;flex-direction:column;gap:2px">${ckHtml || '<span class="small muted">Digite o total impresso no arquivo para conferir se nada ficou de fora. Soma lida: <b class="money">'+brl(Math.abs(R.total||0))+'</b></span>'}</div>
      </div>
    </div>
    <div class="row end"><button class="btn" type="button" data-act="imp-step" data-s="2">Voltar</button><button class="btn primary" type="button" data-act="imp-step" data-s="4" ${nFresh?'':'disabled'}>Continuar com ${nFresh}</button></div>`;
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
      <div class="field"><label for="imp-layout">Salvar layout como…</label><input type="text" id="imp-layout" placeholder="Ex.: Fatura Nubank CSV" value="${esc(I.layoutName || (I.matched?I.matched.name:''))}"></div>
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
  S.real.imports[I.importId] = { id:I.importId, fileName:I.fileName||'arquivo', at:nowISO(), accountId:accId, profileId, count:added.length, total:added.reduce((s,t)=>s+t.amount,0) };
  const auto = added.filter(t=>t.categoryId).length;
  const tri = added.filter(isUncat).length;
  I.done = { imported: added.length, auto, triage: tri, dup:(I.dedup.duplicates||[]).length, err:(I.result.errors||[]).length, importId:I.importId };
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
    <div class="row">${left?'<button class="btn primary" type="button" data-act="triage">Classificar agora</button>':''}<button class="btn" type="button" data-act="goto" data-tab="painel">Ver painel</button><button class="btn ghost" type="button" data-act="imp-reset">Importar outro</button></div></div>`;
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
/** classifies the fresh rows, links card payments across everything; commits new + changed rows (no render) */
function addTransactions(fresh) {
  const all = live().concat(fresh);
  const linked = eng('linkCardPayments', all, D().accounts || []);
  const base = Array.isArray(linked) ? linked : all;
  const freshIds = new Set(fresh.map(t => t.id));
  const toClassify = base.filter(t => freshIds.has(t.id));
  const classified = eng('classifyAll', toClassify, ctx());
  const cmap = {};
  (Array.isArray(classified) ? classified : toClassify).forEach((t, i) => {
    const before = toClassify[i];
    if (before && (before.kind === 'card_payment' || before.kind === 'transfer')) t.kind = before.kind;
    cmap[t.id] = t;
  });
  const prev = new Map(live().map(t => [t.id, t]));
  const changed = [];
  for (const t of base) {
    if (freshIds.has(t.id)) { changed.push(cmap[t.id] || t); continue; }
    const p = prev.get(t.id);
    if (p && (p.kind !== t.kind || p.categoryId !== t.categoryId || p.linkedTo !== t.linkedTo)) changed.push(t);
  }
  commit({ txs: changed, render: false });
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
    const opT = {contains:'contém', equals:'é igual a', startsWith:'começa com', regex:'casa com'}[r.match&&r.match.op]||'';
    const fT = (r.match&&r.match.field)==='rawDescription' ? 'descrição' : 'estabelecimento';
    return `${fT} ${opT} <code>${esc(r.match&&r.match.value)}</code> → <b>${esc(catLabel(r.set&&r.set.categoryId))}</b>${r.set&&r.set.kind?` · ${esc(KIND_LBL[r.set.kind]||r.set.kind)}`:''}`;
  };
  const originTag = o => `<span class="tag ${o==='ai'?'acc':o==='learned'?'ok':''}">${o==='ai'?'IA':o==='learned'?'aprendida':'sua'}</span>`;
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
      ${(d.rules||[]).length?`<div id="rule-list">${d.rules.slice().sort((a,b)=>(b.priority||0)-(a.priority||0)).map(r=>`<div class="rule" data-rule="${esc(r.match&&r.match.value)}"><div class="txt">${ruleText(r)} ${originTag(r.origin)}${r.hits?` <span class="xs faint">${r.hits} uso${r.hits>1?'s':''}</span>`:''}</div>
        <button class="btn sm" type="button" data-act="rule-edit" data-id="${esc(r.id)}">Editar</button>
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
    <div class="field"><span class="lbl">Contas</span><div class="row"><button class="btn" type="button" data-act="accounts" id="btn-accounts">Contas e importações</button></div></div>
    <div class="field"><span class="lbl">Backup</span>
      <div class="row"><button class="btn" type="button" data-act="export" id="btn-export" ${S.mode === 'real' && store ? '' : 'disabled'}>Exportar backup</button>
      <label class="btn" for="restore-file" style="position:relative;overflow:hidden">Importar backup<input type="file" id="restore-file" accept=".json,application/json" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label></div>
      <p class="xs faint">O backup é um arquivo JSON com tudo (lançamentos, contas, regras, layouts). "Importar backup" aceita também o backup da versão anterior.</p></div>
    <div class="field"><span class="lbl">Dados</span>${danger}</div>`, null, { kind: 'settings', label: 'Ajustes' });
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
    const obj = JSON.parse(await file.text());
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
        <div class="field"><label for="acc-type-${esc(a.id)}">Tipo</label><select id="acc-type-${esc(a.id)}" data-acctype="${esc(a.id)}">${Object.entries(ACC_TYPES).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>`).join('')
      : '<p class="small muted">Nenhuma conta ainda. Elas são criadas ao importar um extrato.</p>'}
      <p class="xs muted">Trocar o tipo recalcula entradas, estornos e pagamentos de fatura dessa conta. Categorias manuais são mantidas.</p>
    </div>
    <div class="card"><h3>Importações</h3>
      ${imps.length ? `<div id="imp-list">${imps.map(r => {
        const moving = U.move && U.move.id === r.id, deleting = U.del === r.id;
        const others = accs.filter(a => a.id !== r.accountId && a.type !== 'payslip');
        return `<div class="imp-row" data-imp="${esc(r.id)}">
          <div class="top"><div class="grow" style="min-width:0"><div class="nm">${esc(r.fileName || r.id)}</div>
            <div class="xs muted">${r.at ? esc(new Date(r.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })) : '—'} · ${esc(accName(r.accountId))} · ${r.count} lançamento${r.count === 1 ? '' : 's'}${r.backfilled ? ' · da v1' : ''}</div></div>
            <span class="money small" style="white-space:nowrap">${brl(r.total)}</span></div>
          ${moving ? `<div class="newcat" id="move-box"><div class="field"><label for="mv-acc">Mover para</label><select id="mv-acc">${others.map(a => `<option value="${esc(a.id)}" ${U.move.to === a.id ? 'selected' : ''}>${esc(a.name)} · ${esc(ACC_TYPES[a.type] || a.type)}</option>`).join('')}<option value="__new" ${U.move.to === '__new' || !others.length ? 'selected' : ''}>Nova conta…</option></select></div>
              <div class="form-grid" id="mv-new" ${U.move.to === '__new' || !others.length ? '' : 'hidden'}><div class="field"><label for="mv-name">Nome</label><input type="text" id="mv-name" placeholder="Ex.: XP conta corrente" value="${esc(U.move.name || '')}"></div>
              <div class="field"><label for="mv-type">Tipo</label><select id="mv-type">${['checking', 'credit_card', 'savings', 'cash'].map(k => `<option value="${k}" ${(U.move.type || 'checking') === k ? 'selected' : ''}>${ACC_TYPES[k]}</option>`).join('')}</select></div></div>
              <div class="row end"><button class="btn sm" type="button" data-act="imp-move-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="imp-move-do" data-id="${esc(r.id)}" id="mv-confirm">Mover ${r.count}</button></div></div>`
          : deleting ? `<div class="banner err" id="del-box"><div class="grow"><b>Excluir esta importação?</b> ${r.count} lançamento${r.count === 1 ? '' : 's'} somem de todas as telas (inclusive categorias manuais). Não dá para desfazer.</div></div>
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
  const d = D();
  const ids = live().filter(t => t.importId === impId).map(t => t.id);
  if (d.imports) delete d.imports[impId];
  if (S.accUI) S.accUI.del = null;
  commit({ remove: ids, meta: ['imports'] });
  toast(ids.length + ' lançamentos excluídos.');
}
function changeAccountType(accId, type) {
  const d = D();
  const a = d.accounts.find(x => x.id === accId); if (!a || a.type === type) return;
  a.type = type;
  let txs = d.txs;
  const imps = [...new Set(live().filter(t => t.accountId === accId).map(t => t.importId))];
  for (const imp of imps) txs = eng('moveImport', txs, imp, accId, Object.assign(ctx(), { accounts: d.accounts })) || txs;
  const prev = new Map(d.txs.map(t => [t.id, t]));
  const changed = txs.filter(t => t && !t.deleted && t.accountId === accId && prev.get(t.id) !== t);
  commit({ txs: changed, meta: ['accounts'] });
  toast('Tipo da conta atualizado' + (changed.length ? ' · ' + changed.length + ' lançamentos recalculados' : ''));
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
  'tri-transfer': () => triageTransfer(),
  'tri-undo': () => triageUndo(),
  'imp-tab': el => { S.imp.tab = el.dataset.t; renderImport(); },
  'imp-paste': () => handlePaste(),
  'imp-back': () => { S.imp.step = 1; renderImport(); },
  'imp-step': el => { const s = +el.dataset.s; if (s === 4 && !(S.imp.dedup.fresh || []).length) return; S.imp.step = s; renderImport(); window.scrollTo({ top: 0 }); },
  'imp-num': el => { S.imp.profile.numberFormat = el.dataset.v; runPreview(); renderImport(); },
  'imp-ai': () => runAIProfile(),
  'imp-commit': () => commitImport(),
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
  settings: () => openSettings(),
  accounts: () => openAccountsSheet(),
  'imp-move': el => { S.accUI.move = { id: el.dataset.id, to: null }; S.accUI.del = null; renderAccountsSheet(); },
  'imp-move-cancel': () => { S.accUI.move = null; renderAccountsSheet(); },
  'imp-move-do': el => moveImportTo(el.dataset.id),
  'imp-del': el => { S.accUI.del = el.dataset.id; S.accUI.move = null; renderAccountsSheet(); },
  'imp-del-cancel': () => { S.accUI.del = null; renderAccountsSheet(); },
  'imp-del-do': el => deleteImport(el.dataset.id),
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
  if (t.id === 'tx-search') { clearTimeout(searchT); searchT = setTimeout(() => { S.ui.q = t.value; S.ui.txLimit = 200; saveTxPrefs(); renderTxList(); }, 150); }
  else if (t.id === 'imp-check') { S.imp.checksum = t.value; clearTimeout(searchT); searchT = setTimeout(() => { renderImport(); const i = $('#imp-check'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 500); }
  else if (t.id === 'hol-net') { S.imp.hol.net = t.value; S.imp.hol.netTouched = t.value.trim() !== ''; const sp = $('#hol-split'); if (sp) sp.innerHTML = holSplitHTML(S.imp.hol); }
  else if (S.imp && S.imp.hol && (t.classList.contains('hol-in') || t.id === 'hol-adv-pct')) { readHolerite(); const sp = $('#hol-split'); if (sp) sp.innerHTML = holSplitHTML(S.imp.hol); }
  else if (t.id === 'rl-value' || t.id === 'rl-op' || t.id === 'rl-field') updateRulePreview();
  else if (t.id === 'imp-acc-name' && S.imp) S.imp.newAcc.name = t.value;
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
      if (t.id === 'ed-cat' && t.value) { const k = kindFor(t.value); const ks = $('#ed-kind'); const cur = txById(((S.sheet || {}).id) || ''); if (k && ks && (!cur || countable(cur))) ks.value = k; }
      return;
    }
    if (t.dataset && t.dataset.ncgroup) { const ng = $('#' + t.dataset.ncgroup + '-nc-ng'); if (ng) ng.hidden = t.value !== '__newgroup'; return; }
    if (t.id === 'tri-remember') { TRI.remember = t.checked; return; }
    if (t.id === 'tx-sort') { S.ui.sort = t.value; saveTxPrefs(); renderTxList(); return; }
    if (t.id === 'imp-file' && t.files && t.files[0]) handleFile(t.files[0]);
    else if (t.id === 'restore-file' && t.files && t.files[0]) readBackup(t.files[0]);
    else if (t.id === 'imp-acc') { S.imp.accountId = t.value; $('#new-acc').hidden = t.value !== '__new'; }
    else if (t.id === 'imp-acc-type') { S.imp.newAcc.type = t.value; }
    else if (t.dataset && t.dataset.col != null && t.id.startsWith('imp-col-')) setColumnRole(+t.dataset.col, t.value);
    else if (t.id === 'imp-sign') { S.imp.profile.signConvention = t.value; runPreview(); renderImport(); }
    else if (t.id === 'hol-adv') { readHolerite(); const box = $('#hol-adv-box'); if (box) box.hidden = !t.checked; if (t.checked && !S.imp.hol.advDateTouched) { S.imp.hol.advDate = E.defaultAdvanceDate(S.imp.hol.date); const ad = $('#hol-adv-date'); if (ad) ad.value = isoToBR(S.imp.hol.advDate); } const sp = $('#hol-split'); if (sp) sp.innerHTML = holSplitHTML(S.imp.hol); }
    else if (t.id === 'hol-emp' || (t.dataset && t.dataset.od != null)) { readHolerite(); }
    else if (t.id === 'mv-acc') { if (S.accUI && S.accUI.move) S.accUI.move.to = t.value; const nb = $('#mv-new'); if (nb) nb.hidden = t.value !== '__new'; }
    else if (t.id === 'mv-type') { if (S.accUI && S.accUI.move) S.accUI.move.type = t.value; }
    else if (t.dataset && t.dataset.accname) { const a = D().accounts.find(x => x.id === t.dataset.accname); if (a && t.value.trim() && a.name !== t.value.trim()) { a.name = t.value.trim(); commit({ meta: ['accounts'] }); toast('Conta renomeada'); } }
    else if (t.dataset && t.dataset.acctype) changeAccountType(t.dataset.acctype, t.value);
    else if (t.dataset && t.dataset.gname) { const g = D().categories.find(x => x.id === t.dataset.gname); if (g && t.value.trim()) { g.name = t.value.trim(); S.ui.openGroup = g.id; commit({ meta: ['categories'], render: false }); renderBadge(); } }
    else if (t.dataset && t.dataset.gcolor) { const g = D().categories.find(x => x.id === t.dataset.gcolor); if (g) { g.color = t.value; S.ui.openGroup = g.id; commit({ meta: ['categories'] }); } }
    else if (t.dataset && t.dataset.cname) { const g = D().categories.find(x => x.id === t.dataset.g); const c = g && (g.children || []).find(x => x.id === t.dataset.cname); if (c && t.value.trim()) { c.name = t.value.trim(); commit({ meta: ['categories'], render: false }); } }
    else if (t.dataset && t.dataset.gbud) { const v = parseMoney(t.value); const b = D().settings.budgets = D().settings.budgets || {}; if (v) b[t.dataset.gbud] = Math.abs(v); else delete b[t.dataset.gbud]; if (S.mode === 'example') { const ub = S.example.userBudgets = S.example.userBudgets || {}; if (v) ub[t.dataset.gbud] = Math.abs(v); else delete ub[t.dataset.gbud]; } t.value = v ? centsToInput(Math.abs(v)) : ''; commit({ meta: ['settings'], render: false }); }
  } catch (e) { reportErr('Algo deu errado: ' + (e.message || e)); console.error(e); }
});
document.addEventListener('toggle', ev => { const d = ev.target; if (d.classList && d.classList.contains('grp') && d.open) S.ui.openGroup = d.dataset.gid; }, true);
document.addEventListener('dragover', ev => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', ev => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', ev => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) { ev.preventDefault(); d.classList.remove('over'); const f = ev.dataTransfer.files[0]; if (f) handleFile(f); } });
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersist(); });
  window.addEventListener('pagehide', () => { flushPersist(); });
}
// test hook (read-only views of the state), harmless in production
window.__ff = { state: () => S, live: () => live(), D: () => D(), period: () => period(), flush: () => flushPersist(), store: () => store };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
