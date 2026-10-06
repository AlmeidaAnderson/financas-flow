'use strict';
// Node mirror of the app's file → analysis → profile → rows pipeline (site/app.js readFileAnalysis / bfRead /
// batchDetectKind), used by the corpus harness. Reads ANY folder of statements given at runtime; nothing here knows a
// bank, a file name or a person. ZIP archives are expanded the way the app expands them (FinEngine.unzipEntries).
const fs = require('fs');
const path = require('path');
const E = require('../../site/engine.js');

let XLSX = null, pdfjs = null;
function xlsx() { if (!XLSX) XLSX = require('../../site/vendor/xlsx.full.min.js'); return XLSX; }
function pdflib() {
  if (pdfjs) return pdfjs;
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = log; console.warn = warn; }
  return pdfjs;
}

/** every statement file under dir (recursive), sorted; archives listed as files too */
function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n), st = fs.statSync(p);
      if (st.isDirectory()) walk(p); else if (/\.(csv|txt|tsv|xlsx|xls|pdf|zip)$/i.test(n)) out.push(p);
    }
  })(dir);
  return out;
}

/** the app's tableFileKind on bytes + name */
function fileKind(name, b) {
  return E.fileKindOf ? E.fileKindOf(name, b) : null;
}

/** expands a file into [{ name, bytes }] (a ZIP gives its statement entries, anything else itself) */
async function expand(name, bytes) {
  if (fileKind(name, bytes) === 'zip') {
    const entries = await E.unzipEntries(bytes, { inflate: inflateNode });
    return entries.map(e => ({ name: e.name, bytes: e.bytes, from: name }));
  }
  return [{ name, bytes }];
}
function inflateNode(raw) { return new Uint8Array(require('zlib').inflateRawSync(Buffer.from(raw))); }

async function analyzeBytes(name, bytes) {
  const kind = fileKind(name, bytes);
  if (kind === 'pdf') {
    const res = await E.readPdf(pdflib(), new Uint8Array(bytes), {});
    return { encoding: 'PDF', analysis: E.analyzePdf(res, { fileName: name }) };
  }
  if (kind === 'xlsx') {
    const X = xlsx();
    const wb = X.read(bytes, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false }).map(r => r.map(c => c == null ? '' : String(c)));
    return { encoding: 'Planilha Excel', analysis: E.analyzeRows(rows) };
  }
  if (kind !== 'text') throw new Error('unsupported: ' + kind);
  const dec = E.decodeBytes(new Uint8Array(bytes));
  return { encoding: dec.encoding, analysis: E.analyzeTable(dec.text) };
}

/** one file → { analysis, profile, result (applyProfile), kind } like a batch row before "Importar" */
async function parseFile(name, bytes, opts) {
  opts = opts || {};
  const { encoding, analysis } = await analyzeBytes(name, bytes);
  const profile = E.profileFromAnalysis(analysis);
  const result = E.applyProfile(analysis.rows, profile, { accountId: opts.accountId || '__kind', importId: opts.importId || '__kind', fxRates: opts.fxRates });
  let kind = analysis.pdf && analysis.pdf.kind;
  if (!kind) {
    kind = E.importKind(result.transactions, { fileName: name }) || null;
    if (!kind) { const g = E.guessAccountType(analysis, result.transactions); kind = g === 'checking' ? 'extrato' : g === 'credit_card' ? 'fatura' : null; }
  }
  return { encoding, analysis, profile, result, kind };
}

module.exports = { listFiles, expand, analyzeBytes, parseFile, fileKind };
