'use strict';
// Node mirror of the app's batch "Importar" (site/app.js runBatch): FinEngine.importBatch over the stored rows, import
// records like the app writes them (count/total/from/to/duplicates/hasBalance/kindGuess/holderName + PDF fields), the
// card configured from its first PDF fatura, the account currency of a foreign-only file. Pure data in, data out.
const E = require('../../site/engine.js');

function emptyStore() {
  return { categories: JSON.parse(JSON.stringify(E.DEFAULT_CATEGORIES)), rules: [], history: [], profiles: [], accounts: [],
    settings: { budgets: {}, schemaVersion: E.SCHEMA_VERSION || 3 }, imports: {}, txs: [] };
}
function ctxOf(d) {
  const st = d.settings || {};
  return { rules: d.rules, dictionary: E.DEFAULT_DICTIONARY, categories: d.categories, accounts: d.accounts, settings: st, ownerNames: st.ownerNames || [] };
}
function addDays(iso, k) { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); }
function pdfFields(pdf) {
  if (!pdf || !pdf.meta) return {};
  const m = pdf.meta, o = { source: 'pdf', docKind: pdf.kind || null, pages: pdf.pages || null };
  if (m.dueDate) o.dueDate = m.dueDate;
  if (m.cycleStart && m.cycleEnd) { o.cycleStart = m.cycleStart; o.cycleEnd = m.cycleEnd; }
  const close = m.cycleEnd ? addDays(m.cycleEnd, 1) : m.closeDate;
  if (pdf.kind === 'fatura' && close) o.closeDate = close;
  if (m.total != null) o.statementTotal = m.total;
  if (m.cardLast4) o.cardLast4 = m.cardLast4;
  return o;
}
let seq = 0;
/** items: [{ name, analysis, profile (as parsed), accountId }] — one "Importar" click of the batch list */
function importFiles(d, items, opts) {
  opts = opts || {};
  const now = opts.now || '2026-10-06T12:00:00.000Z';
  const fxRates = (d.settings && d.settings.fxRates) || {};
  const ready = items.map(it => {
    const m = E.matchProfile(it.analysis, d.profiles);
    let profile = m ? JSON.parse(JSON.stringify(m)) : E.profileFromAnalysis(it.analysis);
    if (m) { const ad = E.adoptInfoColumns(profile, it.analysis); if (ad && ad.added.length) profile = ad.profile; }
    if (!m) { const p = Object.assign({}, profile, { id: 'pf-' + (++seq), defaultAccountId: it.accountId, updatedAt: now }); d.profiles.push(p); profile = p; }
    return Object.assign({}, it, { profile, profileId: profile.id, importId: 'imp-' + (++seq) });
  });
  const res = E.importBatch(d.txs, ready.map(it => ({ rows: it.analysis.rows, profile: it.profile, accountId: it.accountId, importId: it.importId, name: it.name, applyOpts: { fxRates } })), ctxOf(d));
  d.txs = res.transactions;
  const summary = [];
  for (const r of res.results) {
    const it = ready.find(x => x.importId === r.importId);
    const byId = new Map(d.txs.map(t => [t.id, t]));
    const added = r.addedIds.map(id => byId.get(id)).filter(Boolean);
    const dts = added.map(t => t.date).sort();
    const parsedRes = E.applyProfile(it.analysis.rows, it.profile, { accountId: it.accountId, importId: it.importId, fxRates });
    {
      const rec = { id: r.importId, fileName: it.name, at: now, updatedAt: now, accountId: it.accountId, profileId: it.profileId, count: added.length,
        total: added.reduce((s, t) => s + t.amount, 0), from: dts[0] || null, to: dts[dts.length - 1] || null, duplicates: r.duplicates.length,
        hasBalance: parsedRes.transactions.some(t => t.balance != null), kindGuess: E.guessAccountType(it.analysis, parsedRes.transactions) || null, batch: true };
      const hn = E.importHolder(it.analysis, parsedRes); if (hn) rec.holderName = hn;
      if (it.analysis.pdf) { const f = pdfFields(it.analysis.pdf); Object.assign(rec, f); if (f.cycleStart) { rec.from = f.cycleStart; rec.to = f.cycleEnd; } }
      if (added.length) d.imports[r.importId] = rec; // like the app: no record when every row was a duplicate
    }
    // the card takes its closing/due day from its first PDF fatura; a foreign-only file sets the account currency
    const a = d.accounts.find(x => x.id === it.accountId);
    if (a && it.analysis.pdf && it.analysis.pdf.kind === 'fatura' && a.type === 'credit_card' && !a.closingDay) {
      const f = pdfFields(it.analysis.pdf); if (f.closeDate && f.dueDate) { a.closingDay = +f.closeDate.slice(8, 10); a.dueDay = +f.dueDate.slice(8, 10); }
    }
    const cur = it.profile.currency && it.profile.currency !== 'BRL' ? it.profile.currency : null;
    if (a && cur && a.currency !== cur) a.currency = cur;
    summary.push({ name: it.name, importId: r.importId, accountId: it.accountId, added: added.length, dup: r.duplicates.length, err: r.errors.length });
  }
  return summary;
}

module.exports = { emptyStore, ctxOf, importFiles };
