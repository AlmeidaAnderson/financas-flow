'use strict';
// Shared corpus loader for test/corpus.test.js and the e2e corpus run: reads every statement under FF_CORPUS_DIR
// (ZIPs expanded), parses it with the app's pipeline and plans the accounts the way a user would set them up — one
// account per institution folder and kind (bank account, card, benefit card), and for a wallet with statements in several
// currencies one account per currency. The folder names are only used as the user's own account names at runtime.
const fs = require('fs');
const path = require('path');
const P = require('./pipeline.js');

const FX = { USD: 5.4, EUR: 6.3, GBP: 7.2, CNY: 0.75 }; // synthetic monthly rates (the user types theirs in "Cotações")
function fxRates() {
  const o = {};
  for (const c of Object.keys(FX)) { o[c] = {}; for (let y = 2024; y <= 2027; y++) for (let m = 1; m <= 12; m++) o[c][y + '-' + String(m).padStart(2, '0')] = FX[c]; }
  return o;
}

async function loadCorpus(dir) {
  const entries = [];
  for (const f of P.listFiles(dir)) {
    const rel = path.relative(dir, f);
    const group = rel.split(path.sep)[0];
    let parts;
    try { parts = await P.expand(path.basename(f), fs.readFileSync(f)); } catch (e) { entries.push({ rel, group, error: e.code || e.message }); continue; }
    for (const p of parts) {
      const label = rel + (p.from ? ' > ' + p.name : '');
      try {
        const parsed = await P.parseFile(p.name, p.bytes, { fxRates: fxRates() });
        entries.push({ rel: label, group, name: p.name, bytes: p.bytes, inZip: !!p.from, parsed });
      } catch (e) { entries.push({ rel: label, group, name: p.name, error: e.code || e.message }); }
    }
  }
  return entries;
}

/** accounts the user creates: [{ id, name, type, currency? }] + entry → account id */
function planAccounts(entries) {
  const accounts = [], byKey = {};
  const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const curs = {};
  for (const e of entries) if (e.parsed && e.parsed.kind !== 'fatura' && e.parsed.kind !== 'beneficio' && e.parsed.result.transactions.length) {
    (curs[e.group] = curs[e.group] || new Set()).add(e.parsed.analysis.currency || 'BRL');
  }
  const acc = (group, kind, cur) => {
    const type = kind === 'fatura' ? 'credit_card' : kind === 'beneficio' ? 'benefit' : 'checking';
    const suffix = type === 'credit_card' ? 'cartão' : type === 'benefit' ? 'benefício' : (curs[group] && curs[group].size > 1 ? cur : 'conta');
    const name = group + ' ' + suffix;
    if (!byKey[name]) { const a = { id: slug(name), name, type }; if (type === 'checking' && cur && cur !== 'BRL') a.currency = cur; accounts.push(a); byKey[name] = a.id; }
    return byKey[name];
  };
  for (const e of entries) if (e.parsed) e.accountId = acc(e.group, e.parsed.kind, e.parsed.analysis.currency || 'BRL');
  return accounts;
}

module.exports = { loadCorpus, planAccounts, fxRates, FX };
