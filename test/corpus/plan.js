'use strict';
// Prints (stdout, JSON) what the e2e corpus run needs: the accounts to create, each statement file on disk with the
// account its rows go to (ZIP entries keyed by the entry name inside the ZIP), and what the engine imports in node
// for the same batch (rows per account, total). Runtime only — the output is never written into the repo.
// Usage: node test/corpus/plan.js <folder>
const path = require('path');
const C = require('./corpus.js');
const I = require('./importer.js');

(async () => {
  const dir = process.argv[2];
  const entries = (await C.loadCorpus(dir)).filter(e => e.parsed);
  const accounts = C.planAccounts(entries);
  const d = I.emptyStore(); d.accounts = JSON.parse(JSON.stringify(accounts)); d.settings.fxRates = C.fxRates();
  I.importFiles(d, entries.map(e => ({ name: e.name, analysis: e.parsed.analysis, accountId: e.accountId })));
  const perAcc = {}; d.txs.forEach(t => { perAcc[t.accountId] = (perAcc[t.accountId] || 0) + 1; });
  const files = [], byName = {};
  for (const e of entries) {
    byName[e.name] = e.accountId;
    if (!e.inZip) files.push(path.join(dir, e.rel));
  }
  const zips = require('./pipeline.js').listFiles(dir).filter(f => /\.zip$/i.test(f));
  process.stdout.write(JSON.stringify({ accounts, files: files.concat(zips), accountOf: byName, expect: { total: d.txs.length, perAcc, empty: entries.filter(e => !e.parsed.result.transactions.length).map(e => e.name) }, fxRates: d.settings.fxRates }));
})().catch(e => { console.error(e); process.exit(1); });
