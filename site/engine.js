/* Finanças MVP — engine.js
 * Pure logic, no DOM, no network. Works in browser (globalThis.FinEngine) and node (module.exports).
 * All money values are integer CENTS. Negative = money out, positive = money in.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------
  function stripAccents(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function norm(s) {
    return stripAccents(s).toUpperCase().replace(/[  \s]+/g, ' ').trim();
  }
  function hashStr(s) {
    s = String(s);
    let h1 = 0x811c9dc5, h2 = 0x9747b28c;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 16777619);
      h2 ^= c; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x5bd1e995);
    }
    h2 ^= h2 >>> 15;
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function round2(x) { return Math.round(x * 100) / 100; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isArr(x) { return Array.isArray(x); }
  function cellStr(v) { return v == null ? '' : String(v).replace(/\r/g, '').trim(); }
  function nowParts() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
  function monthOf(date) { return String(date || '').slice(0, 7); }
  function addMonths(ym, k) {
    let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }
  function dayNum(iso) { // days since epoch, for date distance
    const p = String(iso).split('-').map(Number);
    return Math.round(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1) / 86400000);
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // ---------------------------------------------------------------------------
  // Encoding
  // ---------------------------------------------------------------------------
  const CP1252 = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
    0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161,
    0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };

  function cpsToString(cps) {
    let out = '';
    for (let i = 0; i < cps.length; i += 8192) out += String.fromCodePoint.apply(null, cps.slice(i, i + 8192));
    return out;
  }
  function decodeUtf8Strict(b, start) {
    const cps = [];
    let i = start;
    while (i < b.length) {
      const c = b[i];
      if (c < 0x80) { cps.push(c); i++; continue; }
      let n, cp;
      if (c >= 0xC2 && c <= 0xDF) { n = 1; cp = c & 0x1F; }
      else if (c >= 0xE0 && c <= 0xEF) { n = 2; cp = c & 0x0F; }
      else if (c >= 0xF0 && c <= 0xF4) { n = 3; cp = c & 0x07; }
      else return null;
      for (let k = 1; k <= n; k++) {
        const cc = b[i + k];
        if (cc === undefined || (cc & 0xC0) !== 0x80) return null;
        cp = (cp << 6) | (cc & 0x3F);
      }
      if ((n === 2 && cp < 0x800) || (n === 3 && (cp < 0x10000 || cp > 0x10FFFF)) || (cp >= 0xD800 && cp <= 0xDFFF)) return null;
      cps.push(cp); i += n + 1;
    }
    return cpsToString(cps);
  }
  function decodeCp1252(b, start) {
    const cps = new Array(b.length - start);
    for (let i = start; i < b.length; i++) { const c = b[i]; cps[i - start] = (c >= 0x80 && c <= 0x9F && CP1252[c]) ? CP1252[c] : c; }
    return cpsToString(cps);
  }
  function decodeUtf16le(b, start) {
    const cps = [];
    for (let i = start; i + 1 < b.length; i += 2) cps.push(b[i] | (b[i + 1] << 8));
    let out = '';
    for (let i = 0; i < cps.length; i += 8192) out += String.fromCharCode.apply(null, cps.slice(i, i + 8192));
    return out;
  }

  /** utf-8 vs windows-1252 heuristic; strips BOM. */
  function decodeBytes(input) {
    if (typeof input === 'string') return { text: input.replace(/^﻿/, ''), encoding: 'utf-8' };
    let b = input;
    if (b && typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer) b = new Uint8Array(b);
    if (!b || typeof b.length !== 'number') return { text: '', encoding: 'utf-8' };
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return { text: decodeUtf16le(b, 2), encoding: 'utf-16le' };
    let start = 0;
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) start = 3;
    const u = decodeUtf8Strict(b, start);
    if (u !== null) return { text: u, encoding: 'utf-8' };
    return { text: decodeCp1252(b, start), encoding: 'windows-1252' };
  }

  // ---------------------------------------------------------------------------
  // Delimited text parsing
  // ---------------------------------------------------------------------------
  function parseDelimited(text, d) {
    const rows = [];
    let row = [], cell = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"' && cell.trim() === '') { inQ = true; cell = ''; i++; continue; }
      if (c === d) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(cellStr));
  }

  function preprocessText(text) {
    let t = String(text || '').replace(/^﻿/, '');
    let forced = null;
    const m = t.match(/^sep=(.)\r?\n/i);
    if (m) { forced = m[1]; t = t.slice(m[0].length); }
    return { text: t, forced };
  }

  const DELIMS = ['\t', '|', ';', ','];
  const DELIM_WEIGHT = { '\t': 1.1, '|': 1.1, ';': 1.05, ',': 1 };

  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).slice(0, 300).join('\n');
    const res = [];
    for (const d of DELIMS) {
      const rows = parseDelimited(lines, d).filter(r => r.some(c => c !== ''));
      if (!rows.length) { res.push({ d, score: 0, cons: 0, q: 0 }); continue; }
      const freq = new Map();
      for (const r of rows) if (r.length >= 2) freq.set(r.length, (freq.get(r.length) || 0) + 1);
      let m = 0, f = 0;
      for (const [k, v] of freq) if (v > f || (v === f && k > m)) { m = k; f = v; }
      if (!m) { res.push({ d, score: 0, cons: 0, q: 0 }); continue; }
      // cell quality: cells in modal rows should not contain other strong delimiters unless they're numbers/dates
      let clean = 0, tot = 0;
      for (const r of rows) {
        if (r.length !== m) continue;
        for (const c of r) {
          tot++;
          if (c === '' || !/[;\t|]/.test(c) || isDateLike(c) || isNumLike(c)) clean++;
        }
      }
      const q = tot ? clean / tot : 0;
      const cons = f / rows.length;
      const score = f * (1 + 0.05 * Math.min(m, 10)) * DELIM_WEIGHT[d] * (0.2 + 0.8 * q * q);
      res.push({ d, score, cons, q });
    }
    res.sort((a, b) => b.score - a.score);
    const best = res[0], second = res[1];
    if (!best || best.score === 0) return { delimiter: ',', confidence: 0.1 };
    const margin = second && best.score ? 1 - second.score / best.score : 1;
    const confidence = clamp01(best.cons * best.q * (0.7 + 0.3 * margin));
    return { delimiter: best.d, confidence: round2(confidence) };
  }

  // ---------------------------------------------------------------------------
  // Numbers
  // ---------------------------------------------------------------------------
  /** Parses money strings into cents. numberFormat "br" | "us" | null(auto). */
  function parseAmount(str, numberFormat) {
    if (typeof str === 'number') return isFinite(str) ? Math.round(str * 100) : null;
    if (str == null) return null;
    let s = String(str).replace(/[  ]/g, ' ').replace(/−/g, '-').trim().toUpperCase();
    if (!s) return null;
    let neg = false;
    s = s.replace(/R\$|US\$|BRL|\$/g, ' ').trim();
    for (let iter = 0; iter < 5; iter++) {
      const before = s;
      if (/^\(.*\)$/.test(s)) { neg = !neg; s = s.slice(1, -1).trim(); }
      if (/^-/.test(s)) { neg = !neg; s = s.slice(1).trim(); }
      else if (/^\+/.test(s)) { s = s.slice(1).trim(); }
      if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1).trim(); }
      else if (/\+$/.test(s)) { s = s.slice(0, -1).trim(); }
      let m = s.match(/^(.*\d)\s*(D|DB|DEB)$/);
      if (m) { neg = true; s = m[1].trim(); }
      m = s.match(/^(.*\d)\s*(C|CR|CRED)$/);
      if (m) { s = m[1].trim(); }
      s = s.replace(/R\$|\$/g, '').trim();
      if (s === before) break;
    }
    s = s.replace(/\s+/g, '').replace(/'/g, '');
    if (!/^[0-9.,]+$/.test(s) || !/\d/.test(s)) return null;
    const li = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    let intPart = s, frac = '', decChar = null;
    if (li >= 0) {
      const sep = s[li];
      const after = s.slice(li + 1);
      const count = s.split(sep).length - 1;
      const other = sep === '.' ? ',' : '.';
      const hasOther = s.indexOf(other) >= 0;
      if (after.length === 0) return null;
      if (after.length <= 2) decChar = sep;
      else if (after.length === 3) {
        if (count > 1) decChar = null;
        else if (hasOther) decChar = sep;
        else if (numberFormat === 'br') decChar = sep === ',' ? ',' : null;
        else if (numberFormat === 'us') decChar = sep === '.' ? '.' : null;
        else decChar = null;
      } else {
        if (count > 1) return null;
        if ((numberFormat === 'br' && sep === ',') || (numberFormat === 'us' && sep === '.') || !numberFormat) decChar = sep;
        else if (!hasOther) decChar = sep; else return null;
      }
      if (decChar) { intPart = s.slice(0, li); frac = after; }
      if (decChar && intPart.indexOf(decChar) >= 0) return null;
    }
    if (intPart === '') intPart = '0';
    if (/[.,]/.test(intPart)) {
      if (!/^\d{1,3}([.,]\d{3})+$/.test(intPart)) return null;
      const seps = intPart.replace(/\d/g, '');
      if (new Set(seps.split('')).size > 1) return null;
    }
    const intDigits = intPart.replace(/[.,]/g, '');
    if (!/^\d+$/.test(intDigits)) return null;
    let cents = Number(intDigits) * 100;
    if (frac) cents += frac.length <= 2 ? Number(frac.padEnd(2, '0')) : Math.round(Number('0.' + frac) * 100);
    if (!isFinite(cents)) return null;
    return neg ? -cents : cents;
  }

  /** Votes on decimal separator: the separator followed by 1–2 digits at the end is the decimal. */
  function detectNumberFormat(strings) {
    let br = 0, us = 0, strong = 0;
    for (const raw of strings || []) {
      if (raw == null) continue;
      let s = String(raw).toUpperCase().replace(/R\$|US\$|\$|BRL/g, '').replace(/[\s()+\-]/g, '').replace(/(D|C|DB|CR)$/, '');
      if (!/^[0-9.,]+$/.test(s)) continue;
      const li = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
      if (li < 0) continue;
      const sep = s[li], after = s.slice(li + 1);
      const other = sep === '.' ? ',' : '.';
      const count = s.split(sep).length - 1;
      if (after.length >= 1 && after.length <= 2 && count === 1) { if (sep === ',') br++; else us++; strong++; }
      else if (after.length === 3) {
        if (s.indexOf(other) >= 0 && s.indexOf(other) < li) { if (sep === ',') br++; else us++; strong++; }
        else if (count > 1) { if (sep === '.') br += 1; else us += 1; strong++; }
        else { if (sep === '.') br += 0.3; else us += 0.3; }
      }
    }
    const tot = br + us;
    if (!tot) return { format: 'br', confidence: 0.5 };
    const format = br >= us ? 'br' : 'us';
    const share = Math.max(br, us) / tot;
    return { format, confidence: round2(clamp01(share * Math.min(1, 0.6 + 0.1 * strong))) };
  }

  function isNumLike(s) {
    if (!s || !/\d/.test(s)) return false;
    if (isDateLike(s)) return false;
    return parseAmount(s, null) !== null;
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------
  const MONTHS = {
    JAN: 1, JANEIRO: 1, JANUARY: 1, FEV: 2, FEVEREIRO: 2, FEB: 2, FEBRUARY: 2, MAR: 3, MARCO: 3, MARCH: 3,
    ABR: 4, ABRIL: 4, APR: 4, APRIL: 4, MAI: 5, MAIO: 5, MAY: 5, JUN: 6, JUNHO: 6, JUNE: 6, JUL: 7, JULHO: 7, JULY: 7,
    AGO: 8, AGOSTO: 8, AUG: 8, AUGUST: 8, SET: 9, SETEMBRO: 9, SEP: 9, SEPT: 9, SEPTEMBER: 9, OUT: 10, OUTUBRO: 10,
    OCT: 10, OCTOBER: 10, NOV: 11, NOVEMBRO: 11, NOVEMBER: 11, DEZ: 12, DEZEMBRO: 12, DEC: 12, DECEMBER: 12
  };
  function monthFromName(w) {
    w = String(w || '').replace(/\./g, '');
    if (MONTHS[w]) return MONTHS[w];
    if (w.length >= 3 && MONTHS[w.slice(0, 3)] && w.length <= 9) {
      // accept full names not in table (e.g. typos) only if the prefix is a known abbreviation
      const full = Object.keys(MONTHS).find(k => k.length > 3 && k.startsWith(w));
      if (full) return MONTHS[full];
    }
    return null;
  }
  function fixYear(y) {
    y = +y;
    if (y < 100) { const cur = nowParts().y % 100; y = y <= cur + 20 ? 2000 + y : 1900 + y; }
    return y;
  }
  /** returns {y,m,d,hasYear} or null */
  function parseDateParts(str, fmt) {
    if (str == null) return null;
    let s = norm(str);
    if (!s || !/\d/.test(s)) return null;
    s = s.replace(/T\d{2}:\d{2}.*$/, '').replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/, '').trim();
    const mdy = /^MM/.test(fmt || '');
    let m, y, mo, d, hasYear = true;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) {
      let a = +m[1], b = +m[2]; y = fixYear(m[3]);
      if (mdy) { mo = a; d = b; if (mo > 12 && d <= 12) { mo = b; d = a; } }
      else { d = a; mo = b; if (mo > 12 && d <= 12) { mo = a; d = b; } }
    }
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) {
      hasYear = false;
      if (mdy) { mo = +m[1]; d = +m[2]; } else { d = +m[1]; mo = +m[2]; }
    }
    else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/)) && /^(19|20)/.test(s)) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})\s*(?:DE\s+)?[/.\- ]?\s*([A-Z]{3,10})\.?(?:\s*(?:DE\s+)?[/.\- ]?\s*(\d{2}|\d{4}))?$/))) {
      d = +m[1]; mo = monthFromName(m[2]); if (!mo) return null;
      if (m[3]) y = fixYear(m[3]); else hasYear = false;
    }
    else if ((m = s.match(/^([A-Z]{3,10})\.?\s+(\d{1,2}),?(?:\s+(\d{4}))?$/))) {
      mo = monthFromName(m[1]); d = +m[2]; if (!mo) return null;
      if (m[3]) y = +m[3]; else hasYear = false;
    }
    else return null;
    if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
    if (hasYear && (y < 1970 || y > 2100)) return null;
    if (d > daysInMonth(hasYear ? y : 2024, mo)) return null;
    return { y, m: mo, d, hasYear };
  }
  function isDateLike(s) {
    if (!s || s.length > 40 || !/\d/.test(s)) return false;
    return parseDateParts(s, null) !== null;
  }
  /** parseDate(str, dateFormat, { referenceYear, referenceMonth }) -> "YYYY-MM-DD" | null
   * Year-less dates use referenceYear; if referenceMonth is given (or no options at all, then "today")
   * a month ahead of it rolls back to the previous year. */
  function parseDate(str, dateFormat, opts) {
    const p = parseDateParts(str, dateFormat);
    if (!p) return null;
    let y = p.y;
    if (!p.hasYear) {
      const now = nowParts();
      const o = opts || {};
      y = o.referenceYear || now.y;
      const refM = o.referenceMonth != null ? o.referenceMonth : (o.referenceYear ? null : now.m);
      if (refM != null && p.m > refM) y -= 1;
      if (p.d > daysInMonth(y, p.m)) return null;
    }
    return y + '-' + pad2(p.m) + '-' + pad2(p.d);
  }

  function detectDateFormat(strings) {
    const types = {};
    let dmyEvidence = 0, mdyEvidence = 0, sepUsed = {}, yLen = {};
    for (const raw of strings) {
      const s = norm(raw).replace(/\s+\d{1,2}:\d{2}.*$/, '').replace(/T\d{2}:.*$/, '');
      let m, t = null;
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)) t = 'YYYY-MM-DD';
      else if ((m = s.match(/^(\d{1,2})([/.\-])(\d{1,2})\2(\d{2}|\d{4})$/))) {
        t = 'NUM3'; sepUsed[m[2]] = (sepUsed[m[2]] || 0) + 1; yLen[m[4].length] = (yLen[m[4].length] || 0) + 1;
        if (+m[1] > 12) dmyEvidence++; if (+m[3] > 12) mdyEvidence++;
      }
      else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) { t = 'NUM2'; if (+m[1] > 12) dmyEvidence++; if (+m[2] > 12) mdyEvidence++; }
      else if (/^\d{8}$/.test(s)) t = 'YYYYMMDD';
      else if (/^\d{1,2}\s+DE\s+[A-Z]+\s+DE\s+\d{4}$/.test(s)) t = 'DD de MMMM de YYYY';
      else if (/^\d{1,2}\s*[/.\- ]?\s*[A-Z]{3,10}\.?\s*[/.\- ]?\s*\d{2,4}$/.test(s)) t = 'DD MMM YYYY';
      else if (/^\d{1,2}\s*[/.\- ]?\s*[A-Z]{3,10}\.?$/.test(s)) t = 'DD MMM';
      else if (/^[A-Z]{3,10}\.?\s+\d{1,2}/.test(s)) t = 'MMM DD';
      if (t) types[t] = (types[t] || 0) + 1;
    }
    const entries = Object.entries(types).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return { format: 'DD/MM/YYYY', confidence: 0.2 };
    const total = entries.reduce((a, e) => a + e[1], 0);
    let [t, c] = entries[0];
    let conf = c / total;
    const isMDY = mdyEvidence > 0 && dmyEvidence === 0;
    if (t === 'NUM3') {
      const sep = Object.entries(sepUsed).sort((a, b) => b[1] - a[1])[0][0];
      const yl = (yLen[2] || 0) > (yLen[4] || 0) ? 'YY' : 'YYYY';
      t = (isMDY ? 'MM' + sep + 'DD' : 'DD' + sep + 'MM') + sep + yl;
      if (!dmyEvidence && !mdyEvidence) conf *= 0.85;
      if (dmyEvidence && mdyEvidence) conf *= 0.5;
    } else if (t === 'NUM2') {
      t = isMDY ? 'MM/DD' : 'DD/MM';
      if (!dmyEvidence && !mdyEvidence) conf *= 0.8;
    }
    return { format: t, confidence: round2(conf) };
  }

  // ---------------------------------------------------------------------------
  // Description normalization
  // ---------------------------------------------------------------------------
  const CITIES = ['SAO PAULO', 'RIO DE JANEIRO', 'BELO HORIZONTE', 'CURITIBA', 'PORTO ALEGRE', 'BRASILIA', 'SALVADOR',
    'FORTALEZA', 'RECIFE', 'CAMPINAS', 'OSASCO', 'BARUERI', 'SANTOS', 'GUARULHOS', 'SAO BERNARDO DO CAMPO', 'SAO BERNARDO DO C',
    'SANTO ANDRE', 'NITEROI', 'FLORIANOPOLIS', 'GOIANIA', 'MANAUS', 'BELEM', 'VITORIA', 'SAO JOSE DOS CAMPOS', 'SAO JOSE DOS CAM',
    'RIBEIRAO PRETO', 'SOROCABA', 'JUNDIAI', 'CONTAGEM', 'UBERLANDIA', 'LONDRINA', 'JOINVILLE', 'BLUMENAU', 'NATAL',
    'JOAO PESSOA', 'MACEIO', 'ARACAJU', 'TERESINA', 'SAO LUIS', 'CUIABA', 'CAMPO GRANDE', 'PORTO VELHO', 'PALMAS',
    'MACAPA', 'RIO BRANCO', 'CAXIAS DO SUL', 'MAUA', 'DIADEMA', 'TABOAO DA SERRA', 'COTIA', 'CARAPICUIBA', 'MOGI DAS CRUZES',
    'SAO CAETANO DO SUL', 'SAO CAETANO DO S', 'PRAIA GRANDE', 'SAO VICENTE', 'NOVA IGUACU', 'DUQUE DE CAXIAS', 'SAO GONCALO',
    'PETROPOLIS', 'MARINGA', 'CASCAVEL', 'PIRACICABA', 'BAURU', 'FRANCA', 'LIMEIRA', 'ITU', 'VALINHOS', 'VINHEDO',
    'SAN FRANCISCO', 'DUBLIN', 'LUXEMBOURG', 'LUXEMBURGO', 'AMSTERDAM', 'LONDON', 'SEATTLE', 'CUPERTINO', 'MOUNTAIN VIEW',
    'NEW YORK', 'MIAMI', 'LOS GATOS', 'SINGAPORE', 'SAN JOSE', 'MENLO PARK', 'REDMOND', 'PALO ALTO', 'INTERNET', 'WWW'];
  CITIES.sort((a, b) => b.length - a.length);
  const CITY_RE = new RegExp('\\s+(?:' + CITIES.map(c => c.replace(/ /g, '\\s+')).join('|') + ')(?:\\s+[A-Z]{2})?$');
  const COUNTRY_RE = /\s+(?:BR|BRA|BRASIL|BRAZIL|US|USA|IE|IRL|GB|GBR|NL|NLD|LU|LUX|UY|AR|PT|ES|FR|DE)$/;
  const UF_RE = /\s+(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;
  const GATEWAY_RE = /^(MERCADOPAGO|MERCADO PAGO|MERCPAGO|PAGSEGURO|PAGSEG|PAYPAL|SUMUP|STONE|CIELO|GETNET|EBANX|PICPAY|ZOOP|ASAAS|IUGU|PAGARME|PAGAR ME|VINDI|YAPAY|APPMAX|MP|PAG|PG|IFD|EC|EBN|DL|SQ|ZP|PP|HTM|SMP|NUPAY|CP|BR|PAYGO|PIXPAG)\s*\*\s*/;
  const PREFIX_RES = [
    /^COMPRAS?\s+(?:NO\s+|COM\s+)?(?:CARTAO\s+)?(?:DE\s+)?(?:DEBITO|CREDITO|DEB|CRED)?(?:\s+(?:MC|VISA|ELO|MASTER|MASTERCARD|MAESTRO|ELECTRON))*\s*[-:]?\s*/,
    /^(?:CARTAO|CART)\s+(?:DE\s+)?(?:DEBITO|CREDITO)\s*[-:]?\s*/,
    /^(?:DEB(?:ITO)?|CRED(?:ITO)?)\s+(?:VISA\s+ELECTRON|VISA|MAESTRO|ELO|MASTER)\s*[-:]?\s*/,
    /^(?:PAGTO|PAGAMENTO|PAG|PGTO)\.?\s+(?:ELETRON(?:ICO)?\s+)?(?:DE\s+)?(?:COBRANCA|BOLETO|TITULO|CONTA|CONVENIO)(?:\s+(?:EFETUADO|REALIZADO|PAGO))?\s*[-:]?\s*/,
    /^(?:DEBITO|DEB)\.?\s+(?:AUTOMATICO|AUTOM|AUT|AUTOR)\.?\s*[-:]?\s*/,
    /^(?:INT|INTL|INTERNACIONAL)\s*[-*]\s*/
  ];
  const REFUND_RE = /^(?:ESTORNO|EST|DEVOLUCAO|CANCELAMENTO|CREDITO DE COMPRA|CHARGEBACK)\b\.?\s*(?:DE\s+|DA\s+)?(?:COMPRA\s+)?(?:DE\s+)?[-:]?\s*/;
  const PIX_RE = /^(?:(?:TRANSF(?:ERENCIA)?|PAGAMENTO|PAGTO)\s+(ENVIADA|RECEBIDA|ENVIADO|RECEBIDO)?\s*(?:PELO|VIA|POR|DE)\s+PIX|PIX\s*[-:]?\s*(ENVIADO|RECEBIDO|ENVIADA|RECEBIDA|ENV|REC|TRANSF|TRANSFERENCIA|QRS|QR\s*CODE|DES|CRED|DEB|SAIDA|ENTRADA)?(?:\s+(?:ENVIADO|RECEBIDO))?|TRANSFERENCIA\s+PIX\s+(ENVIADA|RECEBIDA))(?=\s|$|-|:|\*)\s*[-:*]?\s*/;

  /** "3 de 10", "3/10", "03/10", "Parcela 3 de 10", "Parc. 3/10" -> {n,total}; "-", "Única", "1x", "1/1", "" -> null */
  function parseInstallmentText(s) {
    const t = norm(s).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(?:PARC(?:ELAS?)?\.?\s*)?(\d{1,2})\s*(?:\/|DE|OF)\s*(\d{1,3})$/);
    if (!m) return null;
    const n = +m[1], total = +m[2];
    if (n >= 1 && total >= 2 && n <= total && total <= 72) return { n, total };
    return null;
  }
  /** true for any value an installment column may hold, including "no installment" markers */
  function isInstallmentCell(s) {
    const t = norm(s);
    if (!t || /^(-+|—|–|\.|0|1X|1 X|A VISTA|AVISTA|UNICA|UNICO|PARCELA UNICA|SEM PARCELAMENTO|N\/A|NA|1\/1|01\/01|1 DE 1)$/.test(t)) return true;
    return !!parseInstallmentText(t);
  }
  /** "YYYY-MM-DD" + k months, clamping the day to the target month's end (31/01 + 1 -> 28/02 or 29/02). */
  function shiftDateMonths(iso, k) {
    const p = String(iso || '').split('-').map(Number);
    if (p.length < 3 || !p[0]) return iso;
    let y = p[0], m = p[1] - 1 + (k || 0);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    const d = Math.min(p[2], daysInMonth(y, m + 1));
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }
  const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(?:H|HS|HRS)?$/i;
  /** "14:32", "9:05:10" -> "14:32" | null */
  function parseTime(s) {
    const m = String(s == null ? '' : s).trim().match(TIME_RE);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return pad2(h) + ':' + pad2(mi);
  }
  /** time embedded in a datetime cell: "15/09/2026 14:32", "2026-09-15T14:32:00" */
  function timeFromDateCell(s) {
    const m = String(s == null ? '' : s).trim().match(/(?:\s|T)(\d{1,2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/);
    if (!m) return null;
    const t = parseTime(m[1]);
    return t === '00:00' && /T00:00(:00)?/.test(s) ? null : t;
  }

  function normalizeDescription(raw) {
    const original = norm(raw);
    let s = original;
    let installment = null;
    const instRes = [
      /\s*[-–]?\s*\bPARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\s*$/,
      /\s*[-–]?\s*\bPARC(?:ELA)?\.?\s*(\d{1,2})\s+(?:DE|OF)\s+(\d{1,2})\s*$/,
      /\s+(\d{1,2})\s+DE\s+(\d{1,2})\s*$/,
      /(?:^|\s|\*|-)(\d{1,2})\s*\/\s*(\d{1,2})\s*$/
    ];
    for (const re of instRes) {
      const m = s.match(re);
      if (m) {
        const n = +m[1], total = +m[2];
        if (n >= 1 && total >= 2 && n <= total && total <= 72) {
          installment = { n, total };
          s = s.slice(0, m.index).trim();
          break;
        }
      }
    }
    let refund = false, gateway = null, prefix = null, counterparty = null;
    const rm = s.match(REFUND_RE);
    if (rm && s.length > rm[0].length) { refund = true; s = s.slice(rm[0].length); }

    // PIX
    const pm = s.match(PIX_RE);
    if (pm && /^(PIX|TRANSF|PAG|PGTO)/.test(s) && /PIX/.test(pm[0])) {
      const dirWord = pm[1] || pm[2] || pm[3] || '';
      let dir = /RECEB|REC$|CRED|ENTRADA/.test(dirWord) ? 'RECEBIDO' : (/ENV|TRANSF|DES|DEB|SAIDA/.test(dirWord) || /^(PAG|PGTO)/.test(pm[0]) ? 'ENVIADO' : '');
      prefix = dir ? 'PIX ' + dir : 'PIX';
      let rest = s.slice(pm[0].length).replace(/^(?:PARA|P\/|PRA|DE|DA|DO)\s+/, '');
      const parts = rest.split(/\s+-\s+|\s*\|\s*/).map(x => x.trim()).filter(Boolean);
      let name = '';
      for (const p of parts) {
        const cleaned = p.replace(/[•*X\d.\-\/]{5,}/g, ' ').replace(/\b(CPF|CNPJ)\b[:\s]*/g, ' ').replace(/\s+/g, ' ').trim();
        if (/[A-Z]{2,}/.test(cleaned) && !/^(AGENCIA|CONTA|BCO|BANCO|AG\b)/.test(cleaned)) { name = cleaned; break; }
      }
      name = name.replace(/^(?:PARA|P\/|PRA|DE|DA|DO)\s+/, '').replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?$/, '').replace(/\s+\d+$/, '').replace(/[*]/g, ' ').replace(/\s+/g, ' ').trim();
      counterparty = name || null;
      return { merchant: (prefix + (name ? ' ' + name : '')).trim(), installment, prefix, counterparty, refund, gateway };
    }

    for (const re of PREFIX_RES) {
      const m = s.match(re);
      if (m && m[0].length && s.length > m[0].length + 1) s = s.slice(m[0].length);
    }
    for (let k = 0; k < 3; k++) {
      const g = s.match(GATEWAY_RE);
      if (g && s.length > g[0].length + 1) { gateway = gateway || g[1].replace(/\s+/g, ''); s = s.slice(g[0].length); } else break;
    }
    // trailing noise
    let hadGeo = false;
    for (let k = 0; k < 6; k++) {
      const before = s;
      // "RENDIMENTO AUTOMATICO DO DIA 22/09/2026", "TARIFA REF 09/2026", "COMPRA EM 15/09"
      const dm = s.match(/\s+(?:(?:DO|NO)\s+DIA|DIA|REF\.?|REFERENTE\s+(?:A|AO)|EM|DE|DO|ATE|COMPETENCIA)\s+\d{1,2}\/\d{1,4}(?:\/\d{2,4})?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
      if (dm && s.length > dm[0].length + 2) s = s.slice(0, dm.index);
      s = s.replace(/\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/, '')
        .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, '')
        .replace(/\s+\d{1,2}\s*(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)$/, '')
        .replace(/\s*(?:FINAL|FIM|CARTAO|CART|CARD)\s*[X*•.\d]{4,}$/, '')
        .replace(/\s*[X*•]{2,}\s*\d{4}$/, '')
        .replace(/\s+\d{4,}$/, '')
        .replace(/[\s\-*./|:]+$/, '');
      const c1 = s.replace(COUNTRY_RE, '');
      if (c1 !== s && c1.length >= 3) { s = c1; hadGeo = true; }
      const c2 = s.replace(CITY_RE, '');
      if (c2 !== s && c2.length >= 3) { s = c2; hadGeo = true; }
      if (hadGeo) { const c3 = s.replace(UF_RE, ''); if (c3 !== s && c3.length >= 3) s = c3; }
      if (s === before) break;
    }
    // trailing store/terminal numbers ("DROGA RAIA 123", "LOJA 01") when there is a real name before them
    s = s.replace(/^(.*[A-Z]{3,}.*?)\s+\d{1,3}$/, '$1');
    s = s.replace(/^\d{5,}\s+/, '')
      .replace(/\*/g, ' ')
      .replace(/\s+-\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-.:/|]+|[\s\-.:/|]+$/g, '')
      .trim();
    // collapse repeated words ("IFOOD IFOOD")
    const words = s.split(' ');
    const out = [];
    for (const w of words) if (!out.length || out[out.length - 1] !== w) out.push(w);
    s = out.join(' ');
    if (!s) s = original.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
    return { merchant: s, installment, prefix, counterparty, refund, gateway };
  }

  // ---------------------------------------------------------------------------
  // Categories & dictionary
  // ---------------------------------------------------------------------------
  function grp(id, name, color, kind, children) {
    return { id, name, color, kind, children: children.map(([cid, cname]) => ({ id: id + '.' + cid, name: cname })) };
  }
  const DEFAULT_CATEGORIES = [
    grp('moradia', 'Moradia', '#4F7DF3', 'expense', [['aluguel', 'Aluguel'], ['condominio', 'Condomínio'], ['energia', 'Energia'], ['agua', 'Água'], ['gas', 'Gás'], ['internet', 'Internet'], ['manutencao', 'Manutenção']]),
    grp('alimentacao', 'Alimentação', '#F2994A', 'expense', [['mercado', 'Mercado'], ['restaurante', 'Restaurante'], ['delivery', 'Delivery'], ['padaria', 'Padaria/Café']]),
    grp('transporte', 'Transporte', '#9B6BF2', 'expense', [['combustivel', 'Combustível'], ['app', 'App de transporte'], ['publico', 'Transporte público'], ['estacionamento', 'Estacionamento'], ['pedagio', 'Pedágio'], ['manutencao', 'Manutenção do carro'], ['ipva_seguro', 'IPVA/Seguro']]),
    grp('saude', 'Saúde', '#E25D7B', 'expense', [['farmacia', 'Farmácia'], ['plano', 'Plano de saúde'], ['consultas', 'Consultas/Exames'], ['academia', 'Academia']]),
    grp('educacao', 'Educação', '#2BB3C0', 'expense', [['cursos', 'Cursos'], ['livros', 'Livros'], ['escola', 'Escola']]),
    grp('lazer', 'Lazer', '#E8B931', 'expense', [['streaming', 'Streaming/Assinaturas'], ['viagem', 'Viagem'], ['bares', 'Bares'], ['eventos', 'Eventos'], ['jogos', 'Jogos']]),
    grp('compras', 'Compras', '#C86DD7', 'expense', [['vestuario', 'Vestuário'], ['eletronicos', 'Eletrônicos'], ['casa', 'Casa'], ['presentes', 'Presentes'], ['marketplace', 'Marketplace']]),
    grp('servicos', 'Serviços', '#6C8EAD', 'expense', [['telefone', 'Telefone'], ['bancos', 'Bancos/Tarifas'], ['seguros', 'Seguros'], ['software', 'Assinaturas de software']]),
    grp('pessoal', 'Pessoal', '#C08457', 'expense', [['beleza', 'Beleza'], ['pets', 'Pets'], ['doacoes', 'Doações']]),
    grp('impostos', 'Impostos', '#8D8F99', 'expense', [['ir', 'IR'], ['inss', 'INSS'], ['iof', 'IOF'], ['outros', 'Outros impostos']]),
    grp('investimentos', 'Investimentos', '#3BA99C', 'investment', [['aplicacoes', 'Aplicações']]),
    grp('renda', 'Renda', '#34A853', 'income', [['salario', 'Salário'], ['13', '13º salário'], ['ferias', 'Férias'], ['plr', 'PLR/Bônus'], ['beneficios', 'Benefícios VA/VR'], ['rendimentos', 'Rendimentos'], ['reembolsos', 'Reembolsos'], ['outros', 'Outros']])
  ];

  // Dictionary source lines:
  //   "PATTERN|categoryId|kind?"        specific: auto-assigns the category
  //   "?PATTERN|sug1,sug2,...|note"     AMBIGUOUS: never auto-assigns; triage shows the suggestions
  // PATTERN is an uppercase literal matched on WORD BOUNDARIES (a trailing plural S is tolerated),
  // or a /regex/ matched on the normalized text. Generic words (MERCADO, CASA, LOJA, SHOP, STORE,
  // CENTER, PAG, PIX) must never be a pattern on their own — see DICTIONARY_AUDIT.md.
  const DICT_SRC = [
    // delivery
    'IFOOD|alimentacao.delivery', 'IFD*|alimentacao.delivery', 'ZE DELIVERY|alimentacao.delivery', 'ZEDELIVERY|alimentacao.delivery',
    'UBER EATS|alimentacao.delivery', 'UBEREATS|alimentacao.delivery', 'AIQFOME|alimentacao.delivery', 'JAMES DELIVERY|alimentacao.delivery', 'DELIVERY MUCH|alimentacao.delivery',
    '99FOOD|alimentacao.delivery', '99 FOOD|alimentacao.delivery',
    '?RAPPI|alimentacao.delivery,alimentacao.mercado,saude.farmacia|Rappi vende delivery, mercado (Turbo) e farmácia',
    // mercado
    'CARREFOUR|alimentacao.mercado', '?CARREFOUR.COM|alimentacao.mercado,compras.eletronicos,compras.casa|loja online do Carrefour vende eletro e casa',
    '?CARREFOUR E-COMMERCE|alimentacao.mercado,compras.eletronicos,compras.casa|loja online', '?CARREFOUR ECOMMERCE|alimentacao.mercado,compras.eletronicos,compras.casa|loja online',
    'PAO DE ACUCAR|alimentacao.mercado', 'MINUTO PA|alimentacao.mercado', 'ASSAI|alimentacao.mercado', 'ATACADAO|alimentacao.mercado',
    'EXTRA HIPER|alimentacao.mercado', 'HIPER EXTRA|alimentacao.mercado', 'EXTRA SUPERMERCADO|alimentacao.mercado', 'SUPERMERCADO EXTRA|alimentacao.mercado',
    'MERCADO EXTRA|alimentacao.mercado', 'MINI EXTRA|alimentacao.mercado', 'MINIEXTRA|alimentacao.mercado',
    '?EXTRA.COM|alimentacao.mercado,compras.eletronicos,compras.casa|e-commerce do Extra vende eletro e casa',
    '/^DIA\\b|\\bSUPERMERCADOS? DIA\\b|\\bDIA BRASIL\\b/|alimentacao.mercado', 'OXXO|alimentacao.mercado', 'SUPERMERCADO|alimentacao.mercado', 'MERCADINHO|alimentacao.mercado',
    'MINIMERCADO|alimentacao.mercado', 'MERCEARIA|alimentacao.mercado', 'QUITANDA|alimentacao.mercado', 'ATACAREJO|alimentacao.mercado',
    'HORTIFRUTI|alimentacao.mercado', 'SONDA|alimentacao.mercado', 'ST MARCHE|alimentacao.mercado', 'ZONA SUL|alimentacao.mercado', 'PREZUNIC|alimentacao.mercado',
    'GUANABARA|alimentacao.mercado', 'MAMBO|alimentacao.mercado', 'SAMS CLUB|alimentacao.mercado', 'MAKRO|alimentacao.mercado',
    'SAVEGNAGO|alimentacao.mercado', 'ANGELONI|alimentacao.mercado', 'ZAFFARI|alimentacao.mercado', 'TENDA ATACADO|alimentacao.mercado', 'ATACADISTA|alimentacao.mercado',
    'HIPERMERCADO|alimentacao.mercado', 'SACOLAO|alimentacao.mercado', 'ACOUGUE|alimentacao.mercado', 'EMPORIO|alimentacao.mercado', 'BIG BOMPRECO|alimentacao.mercado',
    'MUFFATO|alimentacao.mercado', 'WHOLE FOODS|alimentacao.mercado',
    // conveniência de posto (não é combustível)
    'AM PM|alimentacao.mercado', 'AMPM|alimentacao.mercado', 'BR MANIA|alimentacao.mercado', 'SHELL SELECT|alimentacao.mercado', 'SELECT SHELL|alimentacao.mercado', 'CONVENIENCIA|alimentacao.mercado',
    // restaurante
    'RESTAURANTE|alimentacao.restaurante', 'OUTBACK|alimentacao.restaurante', 'MCDONALDS|alimentacao.restaurante', 'MC DONALDS|alimentacao.restaurante', 'BURGER KING|alimentacao.restaurante',
    'BK BRASIL|alimentacao.restaurante', 'SUBWAY|alimentacao.restaurante', 'HABIBS|alimentacao.restaurante', 'SPOLETO|alimentacao.restaurante', 'MADERO|alimentacao.restaurante',
    'GIRAFFAS|alimentacao.restaurante', 'CHURRASCARIA|alimentacao.restaurante', 'PIZZARIA|alimentacao.restaurante', 'PIZZA|alimentacao.restaurante', 'LANCHONETE|alimentacao.restaurante',
    'CHINA IN BOX|alimentacao.restaurante', 'KFC|alimentacao.restaurante', 'POPEYES|alimentacao.restaurante', 'COCO BAMBU|alimentacao.restaurante', 'FOGO DE CHAO|alimentacao.restaurante',
    'SUSHI|alimentacao.restaurante', 'TEMAKERIA|alimentacao.restaurante', '/\\bBOBS\\b/|alimentacao.restaurante', 'HAMBURGUERIA|alimentacao.restaurante', 'BURGER|alimentacao.restaurante', 'RESTAURANT|alimentacao.restaurante',
    // padaria / cafe
    'PADARIA|alimentacao.padaria', 'PANIFICADORA|alimentacao.padaria', 'STARBUCKS|alimentacao.padaria', '/\\bCAFE\\b|CAFETERIA/|alimentacao.padaria', 'KOPENHAGEN|alimentacao.padaria',
    'CACAU SHOW|alimentacao.padaria', 'CONFEITARIA|alimentacao.padaria', 'DOCERIA|alimentacao.padaria', 'SORVETERIA|alimentacao.padaria',
    // transporte
    '/^UBER\\b|\\bUBER TRIP|UBER DO BRASIL/|transporte.app', 'UBERRIDES|transporte.app', 'UBER RIDES|transporte.app', '99APP|transporte.app', '99 POP|transporte.app',
    '/\\b99\\s?(APP|POP|TAXI|TECNOLOGIA|RIDE)\\b/|transporte.app', 'CABIFY|transporte.app', 'INDRIVER|transporte.app', 'BLABLACAR|transporte.app',
    '/\\bPOSTO\\b/|transporte.combustivel', 'SHELL|transporte.combustivel', 'SHELL BOX|transporte.combustivel', 'IPIRANGA|transporte.combustivel',
    'PETROBRAS|transporte.combustivel', 'AUTO POSTO|transporte.combustivel', 'RAIZEN|transporte.combustivel', '/\\bCOMBUSTIVE(?:L|IS)\\b/|transporte.combustivel', 'ALE COMBUSTIVEIS|transporte.combustivel',
    '/\\bMETRO\\b|METRO RIO|METROFOR/|transporte.publico', 'CPTM|transporte.publico', 'SPTRANS|transporte.publico', 'BILHETE UNICO|transporte.publico', 'RIOCARD|transporte.publico', '/\\bONIBUS\\b/|transporte.publico',
    'ESTAPAR|transporte.estacionamento', 'ESTACIONAMENTO|transporte.estacionamento', 'ZONA AZUL|transporte.estacionamento', 'MULTIPARK|transporte.estacionamento', 'INDIGO|transporte.estacionamento',
    'SEM PARAR|transporte.pedagio', 'CONECTCAR|transporte.pedagio', 'VELOE|transporte.pedagio', 'MOVE MAIS|transporte.pedagio', 'PEDAGIO|transporte.pedagio', 'AUTOBAN|transporte.pedagio', 'ECOVIAS|transporte.pedagio',
    'AUTOPISTA|transporte.pedagio', 'ARTERIS|transporte.pedagio',
    'OFICINA|transporte.manutencao', 'AUTO CENTER|transporte.manutencao', 'AUTOCENTER|transporte.manutencao', '/\\bPNEUS?\\b/|transporte.manutencao', 'LAVA RAPIDO|transporte.manutencao', 'MECANICA|transporte.manutencao',
    'IPVA|transporte.ipva_seguro', 'DETRAN|transporte.ipva_seguro', 'LICENCIAMENTO|transporte.ipva_seguro', 'DPVAT|transporte.ipva_seguro', 'SEGURO AUTO|transporte.ipva_seguro',
    // saude
    'DROGASIL|saude.farmacia', 'DROGA RAIA|saude.farmacia', '/\\bRAIA\\b/|saude.farmacia', 'PAGUE MENOS|saude.farmacia', 'PANVEL|saude.farmacia', 'DROGARIA SAO PAULO|saude.farmacia',
    'DROGARIA|saude.farmacia', 'FARMACIA|saude.farmacia', 'DROGAO|saude.farmacia', 'ULTRAFARMA|saude.farmacia', 'ONOFRE|saude.farmacia', 'PACHECO|saude.farmacia', 'NISSEI|saude.farmacia', 'VENANCIO|saude.farmacia', 'RD SAUDE|saude.farmacia',
    'UNIMED|saude.plano', 'AMIL|saude.plano', 'BRADESCO SAUDE|saude.plano', 'SULAMERICA SAUDE|saude.plano', 'HAPVIDA|saude.plano', 'NOTREDAME|saude.plano', 'PREVENT SENIOR|saude.plano', 'ODONTOPREV|saude.plano', 'PORTO SAUDE|saude.plano',
    'LABORATORIO|saude.consultas', 'FLEURY|saude.consultas', 'DELBONI|saude.consultas', 'LAVOISIER|saude.consultas', 'HOSPITAL|saude.consultas', 'CLINICA|saude.consultas',
    'CONSULTORIO|saude.consultas', 'DR CONSULTA|saude.consultas', 'SABIN|saude.consultas', 'HERMES PARDINI|saude.consultas', '/\\bODONTO/|saude.consultas', '/\\bPSICOLOG/|saude.consultas',
    'SMART FIT|saude.academia', 'SMARTFIT|saude.academia', 'BLUEFIT|saude.academia', 'BIO RITMO|saude.academia', 'BODYTECH|saude.academia', 'SELFIT|saude.academia',
    'GYMPASS|saude.academia', 'WELLHUB|saude.academia', 'TOTALPASS|saude.academia', 'ACADEMIA|saude.academia', 'CROSSFIT|saude.academia',
    // educacao
    'UDEMY|educacao.cursos', 'ALURA|educacao.cursos', 'COURSERA|educacao.cursos', 'DUOLINGO|educacao.cursos', 'ROCKETSEAT|educacao.cursos', 'HOTMART|educacao.cursos',
    '/\\bCURSOS?\\b/|educacao.cursos', 'WIZARD|educacao.cursos', 'CCAA|educacao.cursos', '/\\bFISK\\b/|educacao.cursos', 'DOMESTIKA|educacao.cursos',
    'LIVRARIA|educacao.livros', 'SARAIVA|educacao.livros', 'KINDLE|educacao.livros', 'ESTANTE VIRTUAL|educacao.livros', 'AMAZON KINDLE|educacao.livros',
    'COLEGIO|educacao.escola', '/\\bESCOLA\\b/|educacao.escola', 'FACULDADE|educacao.escola', 'UNIVERSIDADE|educacao.escola', 'MENSALIDADE ESCOLAR|educacao.escola', 'ANHANGUERA|educacao.escola', 'ESTACIO|educacao.escola',
    // lazer
    'NETFLIX|lazer.streaming', 'SPOTIFY|lazer.streaming', 'DISNEY|lazer.streaming', 'PRIME VIDEO|lazer.streaming', 'AMAZON PRIME|lazer.streaming', 'AMAZONPRIME|lazer.streaming', 'PRIMEVIDEO|lazer.streaming',
    'AMAZON MUSIC|lazer.streaming', 'HBO|lazer.streaming', '/^MAX\\b|\\bHBOMAX\\b|\\bHBO MAX\\b/|lazer.streaming', 'GLOBOPLAY|lazer.streaming', 'YOUTUBE|lazer.streaming',
    'GOOGLE YOUTUBE|lazer.streaming', 'YOUTUBE PREMIUM|lazer.streaming', 'YOUTUBEPREMIUM|lazer.streaming', 'DEEZER|lazer.streaming', 'PARAMOUNT|lazer.streaming',
    'CRUNCHYROLL|lazer.streaming', 'APPLE TV|lazer.streaming', 'TELECINE|lazer.streaming', 'DAZN|lazer.streaming', 'MUBI|lazer.streaming', 'AUDIBLE|lazer.streaming', 'APPLE MUSIC|lazer.streaming',
    'LATAM|lazer.viagem', '/\\bGOL\\b(?! ?FINHO)/|lazer.viagem', '/\\bAZUL\\b/|lazer.viagem', '/^AZUL[A-Z0-9]{6}$/|lazer.viagem', 'AIRBNB|lazer.viagem', 'BOOKING|lazer.viagem', 'DECOLAR|lazer.viagem',
    '123MILHAS|lazer.viagem', 'MAXMILHAS|lazer.viagem', 'HOTEL|lazer.viagem', 'POUSADA|lazer.viagem', 'EXPEDIA|lazer.viagem', 'HURB|lazer.viagem', '/\\bCVC\\b/|lazer.viagem',
    'SMILES|lazer.viagem', 'LOCALIZA|lazer.viagem', 'MOVIDA|lazer.viagem', 'UNIDAS|lazer.viagem', 'BUSER|lazer.viagem', 'CLICKBUS|lazer.viagem', 'RODOVIARIA|lazer.viagem', 'TRIVAGO|lazer.viagem',
    '/\\bBAR\\b/|lazer.bares', 'BOTECO|lazer.bares', 'CHOPERIA|lazer.bares', '/\\bPUB\\b/|lazer.bares', 'CERVEJARIA|lazer.bares', 'ADEGA|lazer.bares',
    'INGRESSO|lazer.eventos', 'SYMPLA|lazer.eventos', 'EVENTIM|lazer.eventos', 'TICKETMASTER|lazer.eventos', 'CINEMARK|lazer.eventos', 'CINEMA|lazer.eventos',
    '/\\bUCI\\b/|lazer.eventos', 'KINOPLEX|lazer.eventos', 'TEATRO|lazer.eventos', 'INGRESSE|lazer.eventos', 'TICKET360|lazer.eventos',
    'STEAM|lazer.jogos', 'PLAYSTATION|lazer.jogos', '/\\bPSN\\b/|lazer.jogos', 'XBOX|lazer.jogos', 'NINTENDO|lazer.jogos', 'EPIC GAMES|lazer.jogos', 'RIOT GAMES|lazer.jogos', 'BLIZZARD|lazer.jogos', 'ROBLOX|lazer.jogos', 'GARENA|lazer.jogos',
    // compras
    'RENNER|compras.vestuario', 'RIACHUELO|compras.vestuario', '/\\bC ?& ?A\\b|\\bCEA\\b/|compras.vestuario', '/\\bZARA\\b/|compras.vestuario', 'HERING|compras.vestuario', 'CENTAURO|compras.vestuario',
    'NETSHOES|compras.vestuario', '/\\bNIKE\\b/|compras.vestuario', 'ADIDAS|compras.vestuario', 'DAFITI|compras.vestuario', '/\\bMARISA\\b/|compras.vestuario', 'AREZZO|compras.vestuario',
    'YOUCOM|compras.vestuario', 'OLYMPIKUS|compras.vestuario',
    'KABUM|compras.eletronicos', 'FAST SHOP|compras.eletronicos', 'FASTSHOP|compras.eletronicos', 'PONTO FRIO|compras.eletronicos', 'APPLE STORE|compras.eletronicos', 'SAMSUNG|compras.eletronicos',
    'PICHAU|compras.eletronicos', 'TERABYTE|compras.eletronicos', 'XIAOMI|compras.eletronicos',
    'LEROY MERLIN|compras.casa', 'TOK STOK|compras.casa', 'TOKSTOK|compras.casa', 'CAMICADO|compras.casa', 'MOBLY|compras.casa', 'MADEIRAMADEIRA|compras.casa', 'TELHA NORTE|compras.casa',
    'FERRAGENS|compras.casa', 'MATERIAIS DE CONSTRUCAO|compras.casa', 'ETNA|compras.casa',
    'FLORICULTURA|compras.presentes', 'GIULIANA FLORES|compras.presentes', 'PRESENTES|compras.presentes',
    // marketplaces e lojas multi-categoria: AMBÍGUOS (nunca categorizam sozinhos)
    '?AMAZON|compras.marketplace,compras.eletronicos,compras.casa,educacao.livros|marketplace multi-categoria',
    '?AMZN|compras.marketplace,compras.eletronicos,compras.casa|marketplace multi-categoria', '?AMAZON MARKETPLACE|compras.marketplace,compras.eletronicos,compras.casa|marketplace',
    '?MERCADOLIVRE|compras.marketplace,compras.eletronicos,compras.casa,compras.vestuario|marketplace multi-categoria', '?MERCADO LIVRE|compras.marketplace,compras.eletronicos,compras.casa,compras.vestuario|marketplace multi-categoria',
    '?SHOPEE|compras.marketplace,compras.casa,compras.vestuario|marketplace', '?SHEIN|compras.vestuario,compras.casa,compras.marketplace|moda, mas vende casa e beleza',
    '?ALIEXPRESS|compras.marketplace,compras.eletronicos|marketplace', '?TEMU|compras.marketplace,compras.casa|marketplace',
    '?MAGALU|compras.marketplace,compras.eletronicos,compras.casa|varejo multi-categoria', '?MAGAZINE LUIZA|compras.marketplace,compras.eletronicos,compras.casa|varejo multi-categoria',
    '?CASAS BAHIA|compras.eletronicos,compras.casa,compras.marketplace|eletro e móveis', '?AMERICANAS|compras.marketplace,compras.eletronicos,compras.casa,alimentacao.mercado|varejo multi-categoria',
    '?SUBMARINO|compras.marketplace,compras.eletronicos|marketplace', '?SHOPTIME|compras.marketplace,compras.casa|marketplace', '?ELO7|compras.presentes,compras.casa|marketplace artesanal',
    '?OLX|compras.marketplace|classificados', '?EBAY|compras.marketplace|marketplace', '?HAVAN|compras.casa,compras.vestuario,compras.eletronicos|loja de departamentos',
    '?PERNAMBUCANAS|compras.vestuario,compras.casa,compras.eletronicos|loja de departamentos', '?DECATHLON|compras.vestuario,lazer.eventos|artigos esportivos: roupa ou equipamento',
    // intermediários de pagamento e gateways: AMBÍGUOS
    '?MERCADO PAGO|compras.marketplace,alimentacao.mercado,alimentacao.restaurante|intermediário de pagamento', '?MERCADOPAGO|compras.marketplace|intermediário de pagamento',
    '?/^MP ?\\*/|compras.marketplace|intermediário (Mercado Pago)', '?PAYPAL|compras.marketplace,servicos.software|intermediário de pagamento',
    '?PICPAY|compras.marketplace|carteira digital', '?PAGSEGURO|compras.marketplace|intermediário de pagamento', '?PAGBANK|compras.marketplace|intermediário de pagamento',
    '?STONE|compras.marketplace|maquininha', '?CIELO|compras.marketplace|maquininha', '?GETNET|compras.marketplace|maquininha', '?SUMUP|compras.marketplace|maquininha',
    '?APPLE.COM/BILL|servicos.software,lazer.streaming,lazer.jogos|App Store/iCloud/Apple One na mesma linha', '?APPLE.COM|servicos.software,lazer.streaming,lazer.jogos|App Store',
    '?GOOGLE|servicos.software,lazer.streaming,lazer.jogos|Google Play, Ads, Cloud...', '?GOOGLE PLAY|lazer.jogos,servicos.software,lazer.streaming|loja de apps',
    // moradia
    'ALUGUEL|moradia.aluguel', 'QUINTOANDAR|moradia.aluguel', 'QUINTO ANDAR|moradia.aluguel', 'IMOBILIARIA|moradia.aluguel',
    'CONDOMINIO|moradia.condominio', 'COND ED|moradia.condominio',
    'ENEL|moradia.energia', 'CEMIG|moradia.energia', '/\\bLIGHT\\b/|moradia.energia', 'COPEL|moradia.energia', 'CPFL|moradia.energia', 'ELETROPAULO|moradia.energia', 'COELBA|moradia.energia',
    'CELPE|moradia.energia', 'ENERGISA|moradia.energia', 'EQUATORIAL|moradia.energia', 'NEOENERGIA|moradia.energia', 'CELESC|moradia.energia', '/\\bEDP\\b/|moradia.energia', 'ENERGIA ELETRICA|moradia.energia',
    'SABESP|moradia.agua', 'CEDAE|moradia.agua', 'COPASA|moradia.agua', 'SANEPAR|moradia.agua', 'EMBASA|moradia.agua', 'CAESB|moradia.agua', 'COMPESA|moradia.agua', 'AGUAS DE|moradia.agua',
    'CORSAN|moradia.agua', 'CASAN|moradia.agua', 'SANEAGO|moradia.agua', 'SANASA|moradia.agua', 'CAGECE|moradia.agua',
    'COMGAS|moradia.gas', 'NATURGY|moradia.gas', 'ULTRAGAZ|moradia.gas', 'LIQUIGAS|moradia.gas', 'SUPERGASBRAS|moradia.gas', 'COPERGAS|moradia.gas',
    'VIVO FIBRA|moradia.internet', 'CLARO NET|moradia.internet', 'NET SERVICOS|moradia.internet', 'OI FIBRA|moradia.internet', 'BRISANET|moradia.internet', 'TIM LIVE|moradia.internet', 'CLARO RESIDENCIAL|moradia.internet',
    'ELETRICISTA|moradia.manutencao', 'ENCANADOR|moradia.manutencao', 'CHAVEIRO|moradia.manutencao', '/\\bDEDETIZ/|moradia.manutencao',
    // servicos
    '/\\bVIVO\\b/|servicos.telefone', '/\\bCLARO\\b/|servicos.telefone', '/\\bTIM\\b/|servicos.telefone', '/\\bOI\\b/|servicos.telefone', 'TELEFONICA|servicos.telefone', 'ALGAR|servicos.telefone', 'RECARGA CELULAR|servicos.telefone',
    'TARIFA|servicos.bancos', 'ANUIDADE|servicos.bancos', 'CESTA DE SERVICOS|servicos.bancos', 'PACOTE DE SERVICOS|servicos.bancos', '/\\bTAR\\b/|servicos.bancos', 'JUROS|servicos.bancos', 'MULTA|servicos.bancos', 'ENCARGOS|servicos.bancos', 'JUROS DE MORA|servicos.bancos',
    'SEGURO|servicos.seguros', 'PORTO SEGURO|servicos.seguros', 'SULAMERICA|servicos.seguros', 'MAPFRE|servicos.seguros', 'ALLIANZ|servicos.seguros', 'TOKIO MARINE|servicos.seguros', 'YOUSE|servicos.seguros', 'AZUL SEGUROS|servicos.seguros', 'SEGURADORA|servicos.seguros',
    'ICLOUD|servicos.software', 'GOOGLE ONE|servicos.software', 'GOOGLE STORAGE|servicos.software', 'GOOGLE WORKSPACE|servicos.software', 'MICROSOFT|servicos.software', 'ADOBE|servicos.software',
    'CHATGPT|servicos.software', 'OPENAI|servicos.software', 'CLAUDE.AI|servicos.software', '/\\bCLAUDE\\b/|servicos.software', 'ANTHROPIC|servicos.software', 'DROPBOX|servicos.software', 'NOTION|servicos.software',
    'CANVA|servicos.software', 'GITHUB|servicos.software', '/\\bZOOM\\b/|servicos.software', '1PASSWORD|servicos.software', 'NORDVPN|servicos.software', 'FIGMA|servicos.software',
    'AMAZON WEB SERVICES|servicos.software', '/\\bAWS\\b/|servicos.software', 'DIGITALOCEAN|servicos.software', 'HOSTINGER|servicos.software', 'GODADDY|servicos.software', 'REGISTRO.BR|servicos.software',
    // pessoal
    'SALAO|pessoal.beleza', '/\\bCABELEIREIR/|pessoal.beleza', 'BARBEARIA|pessoal.beleza', 'BOTICARIO|pessoal.beleza', '/\\bNATURA\\b/|pessoal.beleza', 'SEPHORA|pessoal.beleza', '/\\bAVON\\b/|pessoal.beleza',
    'BELEZA NA WEB|pessoal.beleza', 'EPOCA COSMETICOS|pessoal.beleza', 'MANICURE|pessoal.beleza', 'ESTETICA|pessoal.beleza', 'EUDORA|pessoal.beleza',
    'PETZ|pessoal.pets', 'COBASI|pessoal.pets', '/\\bPET\\b|PET SHOP|PETSHOP/|pessoal.pets', '/\\bVETERINAR/|pessoal.pets', 'PETLOVE|pessoal.pets',
    'DOACAO|pessoal.doacoes', 'VAKINHA|pessoal.doacoes', 'IGREJA|pessoal.doacoes', 'DIZIMO|pessoal.doacoes', 'UNICEF|pessoal.doacoes', 'MEDICOS SEM FRONTEIRAS|pessoal.doacoes',
    // impostos
    '/\\bIOF\\b/|impostos.iof', 'DARF|impostos.ir', 'IRPF|impostos.ir', 'RECEITA FEDERAL|impostos.ir', 'IMPOSTO DE RENDA|impostos.ir', '/\\bIRRF\\b/|impostos.ir',
    '/\\bINSS\\b/|impostos.inss', 'IPTU|impostos.outros', '/\\bDAS\\b/|impostos.outros', 'SIMPLES NACIONAL|impostos.outros', 'PREFEITURA|impostos.outros', '/\\bGNRE\\b/|impostos.outros',
    // investimentos
    '/\\bAPLICACAO\\b|\\bAPLIC\\b/|investimentos.aplicacoes|investment', '/\\bCDB\\b/|investimentos.aplicacoes|investment', 'TESOURO|investimentos.aplicacoes|investment',
    '/\\bRESGATE\\b|\\bRESG\\b/|investimentos.aplicacoes|investment', '/\\bLCI\\b|\\bLCA\\b|\\bRDB\\b/|investimentos.aplicacoes|investment', 'POUPANCA|investimentos.aplicacoes|investment',
    'CORRETORA|investimentos.aplicacoes|investment', 'XP INVESTIMENTOS|investimentos.aplicacoes|investment', 'NUINVEST|investimentos.aplicacoes|investment', 'BTG PACTUAL|investimentos.aplicacoes|investment',
    // renda (only matches positive amounts)
    'SALARIO|renda.salario|income', 'PAYROLL|renda.salario|income', 'CRED SALARIO|renda.salario|income', 'PROVENTOS|renda.salario|income', 'FOLHA DE PAGAMENTO|renda.salario|income', 'FOLHA PAGAMENTO|renda.salario|income', 'REMUNERACAO|renda.salario|income',
    '/\\b13O? ?SALARIO|DECIMO TERCEIRO/|renda.13|income', '/\\bFERIAS\\b/|renda.ferias|income', '/\\bPLR\\b|PARTICIPACAO NOS LUCROS|\\bBONUS\\b/|renda.plr|income',
    '/RENDIMENTOS?\\b|REND PAGO|JUROS SOBRE CAPITAL|DIVIDENDO/|renda.rendimentos|income', 'REEMBOLSO|renda.reembolsos|income', 'CASHBACK|renda.reembolsos|income',
    '/\\b(ALELO|SODEXO|PLUXEE|VR BENEFICIOS|TICKET SERVICOS|FLASH BENEFICIOS|CAJU BENEFICIOS)\\b/|renda.beneficios|income',
    'PIX RECEBIDO|renda.outros|income', 'TED RECEBIDA|renda.outros|income', 'DOC RECEBIDO|renda.outros|income', 'TRANSFERENCIA RECEBIDA|renda.outros|income',
    // card payments / transfers (no category)
    'PAGAMENTO FATURA||card_payment', 'PAGAMENTO DE FATURA||card_payment', 'PAG FATURA||card_payment', 'PGTO FATURA||card_payment', 'PAGTO FATURA||card_payment', 'FATURA CARTAO||card_payment',
    'TRANSF ENTRE CONTAS||transfer', 'TRANSFERENCIA ENTRE CONTAS||transfer', 'TRANSFERENCIA PROPRIA||transfer', 'MESMA TITULARIDADE||transfer'
  ];
  /** Words that are never a dictionary pattern on their own (they appear in every kind of business name). */
  const GENERIC_WORDS = ['MERCADO', 'CASA', 'LOJA', 'LOJAS', 'SHOP', 'STORE', 'CENTER', 'PAG', 'PIX', 'COMERCIO', 'SERVICOS', 'LTDA', 'BRASIL', 'ONLINE', 'EXTRA'];
  function parseDictLine(line) {
    let ambiguous = false;
    if (line[0] === '?') { ambiguous = true; line = line.slice(1); }
    let pattern, rest;
    if (line[0] === '/') {
      // regex patterns may contain '|' — a regex starts with '/' and ends at the last '/' followed by '|'
      const end = line.lastIndexOf('/|');
      pattern = line.slice(0, end + 1);
      rest = line.slice(end + 2).split('|');
    } else { const parts = line.split('|'); pattern = parts[0]; rest = parts.slice(1); }
    if (ambiguous) {
      const e = { pattern, categoryId: null, ambiguous: true, suggestions: (rest[0] || '').split(',').filter(Boolean) };
      if (rest[1]) e.note = rest[1];
      return e;
    }
    const e = { pattern, categoryId: rest[0] || null };
    if (rest[1]) e.kind = rest[1];
    return e;
  }
  const DEFAULT_DICTIONARY = DICT_SRC.map(parseDictLine);

  const _reCache = new Map();
  const _wordReCache = new Map();
  function compilePattern(p, flags) {
    const key = p + '\u0000' + (flags || '');
    if (_reCache.has(key)) return _reCache.get(key);
    let re = null;
    try {
      if (p.length > 2 && p[0] === '/' && p.lastIndexOf('/') > 0) {
        const end = p.lastIndexOf('/');
        re = new RegExp(p.slice(1, end), (p.slice(end + 1) || '') + (flags || ''));
      }
    } catch (e) { re = null; }
    _reCache.set(key, re);
    return re;
  }
  /** literal pattern -> word-boundary regex: "OI" must not match inside "DOIS", "DIA" not inside "MEDIA".
   *  Boundaries apply only on sides where the pattern starts/ends with a letter or digit; a plural S is tolerated. */
  function wordRegex(p) {
    if (_wordReCache.has(p)) return _wordReCache.get(p);
    const np = norm(p);
    const escd = np.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const lead = /^[A-Z0-9]/.test(np) ? '(?:^|[^A-Z0-9])' : '';
    const trail = /[A-Z0-9]$/.test(np) ? '(?=$|[^A-Z0-9]|S(?![A-Z0-9]))' : '';
    const re = new RegExp(lead + '(' + escd + ')' + trail);
    _wordReCache.set(p, re);
    return re;
  }
  /** returns null or { pos, len } */
  function dictMatch(entry, text) {
    const p = entry.pattern;
    if (!p) return null;
    if (p[0] === '/' && p.lastIndexOf('/') > 0) {
      const re = compilePattern(p, '');
      if (!re) return null;
      const m = re.exec(text);
      return m ? { pos: m.index, len: Math.max(1, m[0].length) } : null;
    }
    const m = wordRegex(p).exec(text);
    if (!m) return null;
    return { pos: m.index + (m[0].length - m[1].length), len: m[1].length };
  }
  /** Best dictionary entry (may be an ambiguous one). Earliest match wins (the brand usually comes first),
   *  ties -> longest pattern, so "UBER EATS" beats "UBER" and "GOOGLE YOUTUBE" beats the ambiguous "GOOGLE". */
  function lookupDictionaryEntry(dictionary, merchant, raw, amount) {
    const texts = [norm(merchant), norm(raw)];
    for (const text of texts) {
      if (!text) continue;
      // generic catch-alls ("PIX RECEBIDO", "TED RECEBIDA" -> renda.outros) only win when nothing specific matches,
      // so "TED RECEBIDA SALARIO ACME" is salary, not "outras receitas"
      let best = null, bp = Infinity, bl = 0, gen = null, gp = Infinity, gl = 0;
      for (const e of dictionary) {
        if (e.kind === 'income' && !(amount > 0)) continue;
        const m = dictMatch(e, text);
        if (!m) continue;
        if (/\.outros$/.test(e.categoryId || '')) { if (m.pos < gp || (m.pos === gp && m.len > gl)) { gen = e; gp = m.pos; gl = m.len; } continue; }
        if (m.pos < bp || (m.pos === bp && m.len > bl)) { best = e; bp = m.pos; bl = m.len; }
      }
      if (best || gen) return best || gen;
    }
    return null;
  }
  /** Specific entries only: an ambiguous best match means "do not auto-assign". */
  function lookupDictionary(dictionary, merchant, raw, amount) {
    const e = lookupDictionaryEntry(dictionary, merchant, raw, amount);
    return e && !e.ambiguous ? e : null;
  }

  function buildCatIndex(categories) {
    const idx = {};
    for (const g of categories || DEFAULT_CATEGORIES) {
      idx[g.id] = { id: g.id, name: g.name, color: g.color, kind: g.kind || 'expense', group: g.id, groupName: g.name };
      for (const c of g.children || []) idx[c.id] = { id: c.id, name: c.name, color: c.color || g.color, kind: g.kind || 'expense', group: g.id, groupName: g.name };
    }
    return idx;
  }
  const DEFAULT_CAT_INDEX = buildCatIndex(DEFAULT_CATEGORIES);

  // ---------------------------------------------------------------------------
  // Kind detection & classification
  // ---------------------------------------------------------------------------
  const CARD_PAYMENT_RE = /\b(?:PAGAMENTO|PAGTO|PGTO|PAG)\.?\s+(?:DE\s+|DA\s+)?FATURA\b|\bFATURA\s+(?:DO\s+|DE\s+)?CART(?:AO)?\b|\bPAGAMENTO\s+(?:DE\s+|DO\s+)?CARTAO(?:\s+DE\s+CREDITO)?\b|\bPAG(?:TO)?\s+CARTAO\s+CRED|\bDEB(?:ITO)?\s+(?:AUT(?:OMATICO)?\.?\s+)?FATURA\b/;
  const CARD_SIDE_PAYMENT_RE = /\bPAGAMENTO\s+(?:RECEBIDO|EFETUADO|REALIZADO)\b|^PAGAMENTO\b|\bPAGTO\s+(?:RECEBIDO|EFETUADO)|\bPAGAMENTO\s+(?:EM\s+)?(?:DEBITO|CONTA)\b|\bPAGAMENTO\s+ON\s*-?\s*LINE\b|\bPGTO\s+(?:RECEBIDO|EFETUADO)|\bPAYMENT\b/;
  const TRANSFER_RE = /\bTRANSF(?:ERENCIA)?\.?\s+(?:ENTRE\s+CONTAS|PROPRIA|P\/\s*PROPRIA|MESMA\s+TITULARIDADE|MESMO\s+TITULAR)|\bENTRE\s+CONTAS\b|\bMESMA\s+TITULARIDADE\b|\bMESMO\s+TITULAR\b/;
  const REND_RE = /\bRENDIMENTOS?\b|\bREND\.?\s+PAGO|\bJUROS\s+SOBRE\s+CAPITAL|\bDIVIDENDOS?\b/;
  const INVEST_RE = /\b(?:APLICACAO|APLIC|RESGATE|RESG|CDB|LCI|LCA|RDB|TESOURO|POUPANCA|COMPRA\s+DE\s+TITULO|CORRETORA)\b|\bINVESTIMENTOS?\b/;
  const REFUND_ANY_RE = /\bESTORNO|\bDEVOLUCAO|\bCREDITO\s+DE\s+COMPRA|\bCHARGEBACK|\bCANCELAMENTO\s+DE\s+COMPRA/;
  const INCOME_RE = /\b(?:SALARIO|PROVENTOS?|FOLHA\s+(?:DE\s+)?PAGAMENTO|REMUNERACAO|PIX\s+RECEBIDO|TED\s+RECEBIDA|DOC\s+RECEBIDO|TRANSF(?:ERENCIA)?\s+RECEBIDA|RECEBIMENTO|DECIMO\s+TERCEIRO|FERIAS|PLR|BONUS|REEMBOLSO|CASHBACK)\b/;

  function accountTypeOf(tx, ctx) {
    if (!ctx) return tx.accountType || null;
    if (ctx.accountType) return ctx.accountType;
    const accs = ctx.accounts;
    if (accs) {
      if (isArr(accs)) { const a = accs.find(x => x && x.id === tx.accountId); if (a) return a.type; }
      else if (accs[tx.accountId]) return accs[tx.accountId].type || accs[tx.accountId];
    }
    return tx.accountType || null;
  }

  /** returns { kind, explicit } — explicit=false means it came only from the sign */
  function detectKind(tx, accountType, nd) {
    nd = nd || normalizeDescription(tx.rawDescription || '');
    const t = norm(tx.rawDescription) + ' | ' + norm(tx.merchant || nd.merchant);
    const a = tx.amount || 0;
    if (CARD_PAYMENT_RE.test(t)) return { kind: 'card_payment', explicit: true };
    if (accountType === 'credit_card' && a > 0 && CARD_SIDE_PAYMENT_RE.test(norm(tx.rawDescription))) return { kind: 'card_payment', explicit: true };
    if (TRANSFER_RE.test(t)) return { kind: 'transfer', explicit: true };
    if (a > 0 && (REFUND_ANY_RE.test(t) || nd.refund)) return { kind: 'expense', explicit: true, refund: true };
    if (a > 0 && REND_RE.test(t)) return { kind: 'income', explicit: true };
    if (INVEST_RE.test(t) && accountType !== 'credit_card') return { kind: 'investment', explicit: true };
    if (a > 0 && accountType === 'credit_card') return { kind: 'expense', explicit: true, refund: true };
    if (a > 0 && INCOME_RE.test(t)) return { kind: 'income', explicit: true };
    if (accountType === 'payslip') return { kind: a > 0 ? 'income' : 'expense', explicit: true };
    return { kind: a > 0 ? 'income' : 'expense', explicit: false };
  }

  function ruleMatches(rule, tx, merchant) {
    if (!rule || !rule.match) return false;
    const field = rule.match.field === 'rawDescription' ? tx.rawDescription : merchant;
    const v = norm(field), val = norm(rule.match.value);
    let ok = false;
    switch (rule.match.op) {
      case 'equals': ok = v === val; break;
      case 'startsWith': ok = v.startsWith(val); break;
      case 'regex': {
        try { ok = new RegExp(rule.match.value, 'i').test(stripAccents(field || '')) || new RegExp(rule.match.value, 'i').test(v); } catch (e) { ok = false; }
        break;
      }
      default: ok = val !== '' && v.indexOf(val) >= 0;
    }
    if (!ok) return false;
    if (rule.sign === 'in' && !((tx.amount || 0) > 0)) return false;
    if (rule.sign === 'out' && !((tx.amount || 0) < 0)) return false;
    const abs = Math.abs(tx.amount || 0);
    if (rule.amountMin != null && abs < rule.amountMin) return false;
    if (rule.amountMax != null && abs > rule.amountMax) return false;
    return true;
  }
  function sortRules(rules) {
    return (rules || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /** classify(tx, { rules, dictionary, accounts?, categories? }) -> { kind, categoryId, catSource, merchant } */
  function classify(tx, ctx) {
    ctx = ctx || {};
    if (tx.catSource === 'manual') {
      return { kind: tx.kind, categoryId: tx.categoryId == null ? null : tx.categoryId, catSource: 'manual', merchant: tx.merchant || normalizeDescription(tx.rawDescription).merchant };
    }
    const catIdx = ctx.categories ? buildCatIndex(ctx.categories) : DEFAULT_CAT_INDEX;
    const nd = normalizeDescription(tx.rawDescription || '');
    let merchant = tx.merchant || nd.merchant;
    const accType = accountTypeOf(tx, ctx);
    const all = ctx.rules || [];
    const userRules = sortRules(all.filter(r => (r.origin || 'user') === 'user'));
    const learned = sortRules(all.filter(r => r.origin === 'learned' || r.origin === 'ai'));
    let categoryId = null, catSource = null, ruleKind = null;
    for (const [list, srcFn] of [[userRules, () => 'rule'], [learned, r => (r.origin === 'ai' ? 'ai' : 'learned')]]) {
      if (catSource) break;
      for (const r of list) {
        if (ruleMatches(r, tx, merchant)) {
          const set = r.set || {};
          if (set.merchant) merchant = norm(set.merchant);
          if (set.kind) ruleKind = set.kind;
          if (set.categoryId !== undefined) { categoryId = set.categoryId; }
          catSource = srcFn(r);
          break;
        }
      }
    }
    const dk = detectKind(Object.assign({}, tx, { merchant }), accType, nd);
    let kind = ruleKind || dk.kind;
    if (!catSource) {
      const dict = ctx.dictionary || DEFAULT_DICTIONARY;
      const e = lookupDictionary(dict, merchant, tx.rawDescription, tx.amount);
      if (e) {
        categoryId = e.categoryId || null;
        catSource = categoryId ? 'dictionary' : null;
        if (e.kind && !dk.explicit && !ruleKind) {
          if (e.kind !== 'income' || tx.amount > 0) kind = e.kind;
        }
        if (e.kind === 'card_payment' || e.kind === 'transfer') kind = ruleKind || e.kind;
      }
    }
    // positive amount on an expense category with only sign-based kind => refund, i.e. a negative expense
    if (!ruleKind && categoryId && kind === 'income' && !dk.explicit) {
      const ci = catIdx[categoryId];
      if (ci && ci.kind === 'expense') kind = 'expense';
    }
    if (!ruleKind && categoryId && kind === 'income') {
      const ci = catIdx[categoryId];
      if (ci && ci.kind === 'expense' && dk.refund) kind = 'expense';
    }
    if (kind === 'investment' && !categoryId) { categoryId = 'investimentos.aplicacoes'; catSource = catSource || 'dictionary'; }
    if (kind === 'card_payment' || kind === 'transfer') {
      if (!ruleKind || !categoryId) { categoryId = null; if (catSource === 'dictionary') catSource = null; }
    }
    if (kind === 'expense' && categoryId) {
      const ci = catIdx[categoryId];
      if (ci && ci.kind === 'income' && catSource === 'dictionary') { categoryId = null; catSource = null; }
    }
    if (categoryId == null) categoryId = null;
    if (categoryId == null && catSource === 'dictionary') catSource = null;
    // a category chosen by a rule (user/learned/ai) decides the kind: renda.* -> income, investimentos.* -> investment,
    // expense groups -> expense (positive amounts there are refunds)
    if (categoryId && !ruleKind && catSource && catSource !== 'dictionary') {
      const k = kindForCategory(categoryId, catIdx);
      if (k) kind = k;
    }
    return { kind, categoryId, catSource, merchant };
  }

  /** The kind a category implies, from its group: income | investment | expense. null when unknown. */
  function kindForCategory(categoryId, categoriesOrIndex) {
    if (!categoryId) return null;
    const idx = !categoriesOrIndex ? DEFAULT_CAT_INDEX : isArr(categoriesOrIndex) ? buildCatIndex(categoriesOrIndex) : categoriesOrIndex;
    let ci = idx[categoryId];
    if (!ci) {
      const gid = String(categoryId).split('.')[0];
      ci = idx[gid] || DEFAULT_CAT_INDEX[categoryId] || DEFAULT_CAT_INDEX[gid];
    }
    if (!ci) return null;
    return ci.kind === 'income' ? 'income' : ci.kind === 'investment' ? 'investment' : 'expense';
  }
  /** Applies the category -> kind invariant to a transaction (returns a new object when something changes). */
  function applyCategoryKind(tx, categories) {
    if (!tx || !tx.categoryId) return tx;
    const k = kindForCategory(tx.categoryId, categories);
    if (!k || k === tx.kind) return tx;
    return Object.assign({}, tx, { kind: k });
  }

  /** Category suggestions for triage: ambiguous dictionary hits and the categories other transactions of the
   *  same merchant already got. -> [{ categoryId, reason }] (no duplicates, best first) */
  function suggestCategories(tx, ctx) {
    ctx = ctx || {};
    const out = [], seen = new Set();
    const add = (id, reason) => { if (id && !seen.has(id)) { seen.add(id); out.push({ categoryId: id, reason }); } };
    const merchant = tx.merchant || normalizeDescription(tx.rawDescription || '').merchant;
    const m = norm(merchant);
    const counts = {};
    for (const o of ctx.transactions || []) {
      if (!o || o.deleted || o.id === tx.id || !o.categoryId) continue;
      if (norm(o.merchant) === m) counts[o.categoryId] = (counts[o.categoryId] || 0) + 1;
    }
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([id]) => add(id, 'usada antes para ' + merchant));
    const e = lookupDictionaryEntry(ctx.dictionary || DEFAULT_DICTIONARY, merchant, tx.rawDescription, tx.amount);
    if (e && e.ambiguous) for (const id of e.suggestions || []) add(id, (e.note || 'estabelecimento ambíguo') + ' (' + e.pattern + ')');
    else if (e && e.categoryId) add(e.categoryId, 'dicionário');
    return out;
  }
  /** The ambiguous dictionary entry that blocked auto-classification, or null. */
  function ambiguousMatch(tx, ctx) {
    const merchant = tx.merchant || normalizeDescription(tx.rawDescription || '').merchant;
    const e = lookupDictionaryEntry((ctx && ctx.dictionary) || DEFAULT_DICTIONARY, merchant, tx.rawDescription, tx.amount);
    return e && e.ambiguous ? e : null;
  }

  function classifyAll(transactions, ctx) {
    return (transactions || []).map(tx => {
      if (!tx || tx.deleted) return tx;
      const c = classify(tx, ctx);
      return Object.assign({}, tx, c);
    });
  }

  /** history: array of past manual corrections ({txId|id, merchant, categoryId}); this correction is appended to it. */
  function learnFromCorrection(tx, newCategoryId, rules, history, opts) {
    opts = opts || {};
    rules = (rules || []).slice();
    const merchant = norm(tx.merchant || normalizeDescription(tx.rawDescription || '').merchant);
    const hist = isArr(history) ? history : [];
    const txId = tx.id || hashStr(JSON.stringify([tx.date, tx.amount, tx.rawDescription]));
    if (!hist.some(h => (h.txId || h.id) === txId && h.categoryId === newCategoryId)) {
      hist.push({ txId, merchant, categoryId: newCategoryId, at: new Date().toISOString() });
    }
    const ids = new Set();
    for (const h of hist) {
      if (norm(h.merchant || '') === merchant && h.categoryId === newCategoryId) ids.add(h.txId || h.id);
    }
    if (!merchant || !newCategoryId) return { rules, created: null };
    // opts.immediate: the user ticked "Lembrar esta categoria" — remember right away
    if (ids.size < 2 && !opts.immediate) return { rules, created: null };
    const existingIdx = rules.findIndex(r => r.origin === 'learned' && r.match && r.match.field === 'merchant' && r.match.op === 'equals' && norm(r.match.value) === merchant);
    if (existingIdx >= 0) {
      const ex = rules[existingIdx];
      if (ex.set && ex.set.categoryId === newCategoryId) return { rules, created: null, existing: ex };
      const updated = Object.assign({}, ex, { set: Object.assign({}, ex.set, { categoryId: newCategoryId }), hits: 0, updatedAt: new Date().toISOString() });
      if (kindForCategory(newCategoryId, opts.categories) === 'income') updated.sign = 'in'; else delete updated.sign;
      rules[existingIdx] = updated;
      return { rules, created: updated };
    }
    const created = {
      id: 'learned_' + hashStr(merchant),
      match: { field: 'merchant', op: 'equals', value: merchant },
      set: { categoryId: newCategoryId },
      origin: 'learned', priority: 0, hits: 0, updatedAt: new Date().toISOString()
    };
    // an income category learned from a deposit must not turn later debits of the same name into negative income
    if (kindForCategory(newCategoryId, opts.categories) === 'income') created.sign = 'in';
    rules.push(created);
    return { rules, created };
  }

  // ---------------------------------------------------------------------------
  // Table analysis
  // ---------------------------------------------------------------------------
  const SKIP_PATTERNS = [
    '^[(=+\\-\\s]*SALDO\\b', '^S A L D O', '^SDO\\b', '^(SUB)?TOTAL(\\s*:|\\s*$|\\s+(GERAL|DA|DO|DOS|DAS|DE|NO|NA|EM|A PAGAR|LANCAMENTOS|COMPRAS|FATURA|PARCIAL)\\b)',
    '^LANCAMENTOS FUTUROS', '^VALOR TOTAL', '^LIMITE\\b', '^RESUMO\\b'
  ];
  function compileSkip(patterns) {
    return (patterns || []).map(p => { try { return new RegExp(p); } catch (e) { return null; } }).filter(Boolean);
  }
  function rowMatchesSkip(row, skipRes, descIdx) {
    const cells = descIdx != null && row[descIdx] ? [row[descIdx]] : row;
    for (const c of cells) {
      if (!c) continue;
      if (isDateLike(c) || isNumLike(c)) continue;
      const n = norm(c);
      for (const re of skipRes) if (re.test(n)) return true;
    }
    return false;
  }

  const HDR = {
    dc: /^(D\/C|C\/D|DC|CD|D\/ ?C|TIPO|NATUREZA|SINAL|DEB\/CRED|CRED\/DEB|TYPE|DEBITO\/CREDITO|CREDITO\/DEBITO|D-C|C-D)$/,
    balance: /\bSALDO\b|\bBALANCE\b/,
    ignore: /\bDOC\b|DOCTO|DOCUMENTO|^N[O°º]?\.?$|^NUMERO|^ID$|IDENTIFICADOR|AGENCIA|^AG\b|ORIGEM|^CONTA\b|\bCPF\b|CNPJ|CATEGORIA|CATEGORY|CARTAO|\bCARD\b|PORTADOR|COTACAO|US\$|\bUSD\b|DOLAR|MOEDA ORIGINAL|\bCODIGO\b|^COD\b/,
    debit: /DEBITO|\bDEBIT\b|SAIDAS?\b|RETIRADAS?|WITHDRAW|\bOUT\b|DESPESA/,
    credit: /CREDITO|\bCREDIT\b|ENTRADAS?\b|DEPOSITOS?|DEPOSIT\b|\bIN\b|RECEITA/,
    amount: /VALOR|AMOUNT|VALUE|MONTANTE|QUANTIA|\bVLR\b|R\$|PRICE|IMPORTE|\bTOTAL\b/,
    installment: /PARCELA|INSTALLMENT|\bPARC\b/,
    time: /^(HORA|HORARIO|TIME|HR|HRS)\b/,
    date: /^(DATA|DATE|DT|DIA)\b|\bDATA\b|\bDATE\b/,
    description: /HISTORICO|DESCRI|LANCAMENTO|TITLE|TITULO|ESTABELECIMENTO|MEMO|PAYEE|DETALHE|NARRATIVA|TRANSACAO|COMERCIO|MERCHANT|\bNOME\b|DETAILS|\bTEXTO\b|OBSERVACAO|FAVORECIDO/
  };
  function headerHint(h) {
    const n = norm(h).replace(/\s*\(R\$\)\s*/, ' R$').trim();
    if (!n) return null;
    if (HDR.dc.test(n)) return 'dcFlag';
    if (HDR.time.test(n) && !HDR.date.test(n)) return 'time';
    if (HDR.date.test(n)) return 'date';
    if (HDR.balance.test(n)) return 'balance';
    if (HDR.ignore.test(n)) return 'ignore';
    if (HDR.installment.test(n)) return 'installment';
    if (HDR.debit.test(n) && !HDR.credit.test(n)) return 'debit';
    if (HDR.credit.test(n) && !HDR.debit.test(n)) return 'credit';
    if (HDR.amount.test(n)) return 'amount';
    if (HDR.description.test(n)) return 'description';
    return null;
  }

  const FLAG_RE = /^(D|C|DB|CR|DEB|CRED|DEBITO|CREDITO|DEBIT|CREDIT|-|\+|SAIDA|ENTRADA)$/;
  function flagSign(v) {
    const n = norm(v);
    if (!n) return 0;
    if (/^(D|DB|DEB|DEBITO|DEBIT|-|SAIDA)/.test(n)) return -1;
    if (/^(C|CR|CRED|CREDITO|CREDIT|\+|ENTRADA)/.test(n)) return 1;
    return 0;
  }

  const PAYMENT_KW_RE = /\bPAGAMENTO\b|\bPAGTO\b|\bPGTO\b|\bPAYMENT\b/;
  const INCOME_KW_RE = /\bSALARIO\b|\bRECEBID[OA]\b|\bPROVENTOS\b|\bRENDIMENTO|\bDEPOSITO\b/;

  function runningBalanceScore(amts, bals) {
    let ok = 0, tot = 0, prev = null, prevA = null;
    for (let i = 0; i < amts.length; i++) {
      const a = amts[i], b = bals[i];
      if (a == null || b == null) { continue; }
      if (prev != null) {
        tot++;
        if (Math.abs(b - prev - a) <= 1 || Math.abs(prev - b - prevA) <= 1 || Math.abs(prev - b - a) <= 1 || Math.abs(b - prev + a) <= 1) ok++;
      }
      prev = b; prevA = a;
    }
    return tot ? ok / tot : 0;
  }

  function analyzeGrid(rowsIn, delimiter, delimiterConfidence, encoding) {
    const rows = (rowsIn || []).map(r => (isArr(r) ? r : [r]).map(cellStr));
    const warnings = [];
    const feats = rows.map(r => {
      const dateIdx = [], numIdx = [];
      let nonEmpty = 0;
      r.forEach((c, j) => {
        if (!c) return; nonEmpty++;
        if (isDateLike(c)) dateIdx.push(j); else if (isNumLike(c)) numIdx.push(j);
      });
      return { nonEmpty, dateIdx, numIdx, dataLike: nonEmpty >= 2 && dateIdx.length > 0 && numIdx.length > 0 };
    });
    const skipRes = compileSkip(SKIP_PATTERNS);
    let dataStart = feats.findIndex(f => f.dataLike);
    let dataEnd = -1;
    for (let i = feats.length - 1; i >= 0; i--) if (feats[i].dataLike) { dataEnd = i; break; }
    const base = {
      rows, delimiter: delimiter == null ? null : delimiter, delimiterConfidence: delimiterConfidence == null ? 1 : delimiterConfidence,
      encoding: encoding || 'utf-8', headerRowIndex: null, dataStart: Math.max(0, dataStart), dataEnd: Math.max(-1, dataEnd), skippedRows: [], columns: [],
      numberFormat: 'br', numberFormatConfidence: 0.5, dateFormat: 'DD/MM/YYYY', dateFormatConfidence: 0.2,
      signConvention: 'negative_is_expense', signConfidence: 0.2, fingerprint: '', overallConfidence: 0, warnings
    };
    if (dataStart < 0) {
      warnings.push('Não encontrei linhas com data e valor. Verifique o arquivo ou ajuste as colunas manualmente.');
      const W = rows.reduce((a, r) => Math.max(a, r.length), 0);
      base.dataStart = 0; base.dataEnd = rows.length - 1;
      base.columns = Array.from({ length: W }, (_, j) => ({ index: j, header: '', role: 'ignore', confidence: 0, samples: rows.slice(0, 5).map(r => r[j] || '').filter(Boolean) }));
      base.fingerprint = 'fp_' + hashStr('EMPTY|' + W + '|' + (delimiter || ''));
      return base;
    }
    // data rows for scoring
    const scoringIdx = [];
    for (let i = dataStart; i <= dataEnd; i++) {
      if (feats[i].dataLike && !rowMatchesSkip(rows[i], skipRes, null)) scoringIdx.push(i);
    }
    // width = modal length of data rows
    const lenFreq = {};
    for (const i of scoringIdx) lenFreq[rows[i].length] = (lenFreq[rows[i].length] || 0) + 1;
    let W = +Object.entries(lenFreq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    // header detection
    let headerRowIndex = null;
    for (let i = dataStart - 1; i >= Math.max(0, dataStart - 3); i--) {
      const r = rows[i], f = feats[i];
      if (f.nonEmpty === 0) continue;
      if (f.dateIdx.length || f.numIdx.length > 0) break;
      const hints = r.filter(c => c && headerHint(c)).length;
      if (f.nonEmpty >= 2 && (hints >= 1 || f.nonEmpty >= Math.ceil(W * 0.6)) && Math.abs(r.length - W) <= 2) { headerRowIndex = i; }
      break;
    }
    if (headerRowIndex != null) W = Math.max(W, rows[headerRowIndex].length);
    const header = headerRowIndex != null ? rows[headerRowIndex] : [];
    const sample = scoringIdx.slice(0, 1000).map(i => rows[i]);
    const n = sample.length || 1;

    // column stats
    const stats = [];
    for (let j = 0; j < W; j++) {
      const vals = sample.map(r => r[j] || '');
      const ne = vals.filter(Boolean);
      const neN = ne.length || 1;
      const isD = ne.map(isDateLike);
      const isN = ne.map((v, k) => !isD[k] && isNumLike(v));
      const dateC = isD.filter(Boolean).length;
      const numC = isN.filter(Boolean).length;
      const decC = ne.filter(v => /[.,]\d{1,2}\s*(?:-|\)|D|C|DB|CR)?$/i.test(v.trim())).length;
      const flagC = ne.filter(v => FLAG_RE.test(norm(v))).length;
      const instC = ne.filter(v => parseInstallmentText(v) && !/\d{4}/.test(v)).length;
      const instAnyC = vals.filter(v => isInstallmentCell(v) && !/\d{4}/.test(v)).length;
      const timeC = ne.filter(v => parseTime(v)).length;
      const idC = ne.filter(v => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) || (/^[A-Z0-9-]{12,}$/i.test(v) && /\d/.test(v))).length;
      const negC = ne.filter(v => { const a = parseAmount(v, null); return a != null && a < 0; }).length;
      const distinct = new Set(ne.map(norm)).size / neN;
      const avgLen = ne.reduce((a, v) => a + v.length, 0) / neN;
      const letters = ne.reduce((a, v) => a + (v.match(/[A-Za-zÀ-ÿ]/g) || []).length, 0) / Math.max(1, ne.reduce((a, v) => a + v.length, 0));
      const hint = headerHint(header[j] || '');
      stats.push({ j, vals, ne, fill: ne.length / n, dateF: dateC / neN, numF: numC / neN, decF: decC / neN, flagF: flagC / neN, instF: instC / neN, instAnyF: instAnyC / (vals.length || 1), timeF: timeC / neN,
        idF: idC / neN, negF: negC / neN, distinct, avgLen, letters, hint, header: header[j] || '' });
    }
    const roles = new Array(W).fill('ignore');
    const conf = new Array(W).fill(0.5);
    // installment by header
    stats.forEach(s => { if (s.hint === 'installment' && (s.instF >= 0.5 || s.fill < 0.6 || (s.instAnyF >= 0.8 && s.dateF < 0.9))) { roles[s.j] = 'installment'; conf[s.j] = 0.9; } });
    // time column (HH:MM[:SS]) — must never be mistaken for the description
    stats.forEach(s => { if (roles[s.j] === 'ignore' && s.ne.length && s.timeF >= 0.8 && s.fill >= 0.5) { roles[s.j] = 'time'; conf[s.j] = s.hint === 'time' ? 0.95 : 0.8; } });
    // dcFlag
    stats.forEach(s => {
      if (roles[s.j] !== 'ignore') return;
      if (s.ne.length && s.flagF >= 0.9 && s.fill >= 0.8) { roles[s.j] = 'dcFlag'; conf[s.j] = s.hint === 'dcFlag' ? 0.95 : 0.85; }
    });
    // date
    let dateCol = null, dateScore = -1;
    stats.forEach(s => {
      if (roles[s.j] !== 'ignore') return;
      if (s.dateF >= 0.7 && s.fill >= 0.5) {
        const sc = s.dateF * s.fill + (s.hint === 'date' ? 0.3 : 0) - 0.02 * s.j;
        if (sc > dateScore) { dateScore = sc; dateCol = s.j; }
      }
    });
    if (dateCol != null) {
      roles[dateCol] = 'date';
      const s = stats[dateCol];
      conf[dateCol] = round2(clamp01(s.dateF * s.fill * 0.85 + (s.hint === 'date' ? 0.15 : 0.1)));
      // other yearless n/total columns → installment
      stats.forEach(o => {
        if (roles[o.j] === 'ignore' && o.j !== dateCol && o.ne.length && o.instF >= 0.8 && o.dateF >= 0.5 && /\d{4}|[A-Z]{3}/i.test(s.ne[0] || '')) {
          roles[o.j] = 'installment'; conf[o.j] = 0.6;
        }
      });
    } else warnings.push('Coluna de data não identificada.');
    stats.forEach(o => {
      if (roles[o.j] === 'ignore' && o.ne.length && o.instAnyF >= 0.95 && o.instF >= 0.05 && o.numF < 0.5 && o.hint !== 'ignore' && o.dateF < 0.9) { roles[o.j] = 'installment'; conf[o.j] = 0.6; }
    });
    // numeric columns
    const numeric = stats.filter(s => roles[s.j] === 'ignore' && s.ne.length && s.numF >= 0.8 && s.dateF < 0.5);
    for (const s of numeric) {
      if (s.hint === 'ignore') { roles[s.j] = 'ignore'; conf[s.j] = 0.8; }
      else if (s.hint === 'balance') { roles[s.j] = 'balance'; conf[s.j] = 0.95; }
    }
    let free = numeric.filter(s => roles[s.j] === 'ignore' && s.hint !== 'ignore');
    let hdrDebit = free.find(s => s.hint === 'debit'), hdrCredit = free.find(s => s.hint === 'credit');
    let amountCol = null, debitCol = null, creditCol = null, splitByHeader = false;
    if (hdrDebit && hdrCredit) { debitCol = hdrDebit.j; creditCol = hdrCredit.j; splitByHeader = true; }
    else {
      const hdrAmt = free.filter(s => s.hint === 'amount');
      if (hdrAmt.length) {
        const pick = hdrAmt.find(s => /R\$/.test(s.header)) || hdrAmt.sort((a, b) => b.fill - a.fill)[0];
        amountCol = pick.j; conf[amountCol] = 0.95;
      } else {
        let cand = free.filter(s => s.decF >= 0.5);
        if (!cand.length) cand = free.slice();
        // split pair?
        let pair = null;
        for (let a = 0; a < cand.length && !pair; a++) for (let b = a + 1; b < cand.length && !pair; b++) {
          const A = cand[a], B = cand[b];
          if (A.fill > 0.95 || B.fill > 0.95) continue;
          let both = 0, any = 0;
          for (let k = 0; k < sample.length; k++) { const x = !!A.vals[k], y = !!B.vals[k]; if (x && y) both++; if (x || y) any++; }
          if (both / n <= 0.1 && any / n >= 0.85) pair = [A, B];
        }
        if (pair) {
          let [A, B] = pair;
          let deb = A, cred = B;
          if (B.negF > A.negF) { deb = B; cred = A; }
          else if (A.negF === B.negF && B.ne.length > A.ne.length) { deb = B; cred = A; }
          debitCol = deb.j; creditCol = cred.j;
          conf[debitCol] = conf[creditCol] = (deb.negF > 0.5 ? 0.75 : 0.5);
        } else if (cand.length === 1) { amountCol = cand[0].j; conf[amountCol] = cand[0].decF >= 0.5 ? 0.85 : 0.6; }
        else if (cand.length > 1) {
          // decide amount vs balance with running-balance check
          let best = null;
          for (const A of cand) for (const B of cand) {
            if (A === B) continue;
            const amts = sample.map(r => parseAmount(r[A.j] || '', null));
            const bals = sample.map(r => parseAmount(r[B.j] || '', null));
            const sc = runningBalanceScore(amts, bals);
            if (!best || sc > best.sc) best = { A, B, sc };
          }
          if (best && best.sc >= 0.6) {
            amountCol = best.A.j; conf[amountCol] = 0.85;
            roles[best.B.j] = 'balance'; conf[best.B.j] = round2(0.6 + 0.3 * best.sc);
          } else {
            const pick = cand.slice().sort((a, b) => (b.negF - a.negF) || (b.fill - a.fill) || (a.j - b.j))[0];
            amountCol = pick.j; conf[amountCol] = 0.5;
            warnings.push('Mais de uma coluna numérica; confirme qual é o valor.');
          }
        }
      }
    }
    if (amountCol != null) roles[amountCol] = 'amount';
    if (debitCol != null) { roles[debitCol] = 'debit'; roles[creditCol] = 'credit'; if (splitByHeader) conf[debitCol] = conf[creditCol] = 0.95; }
    // with header balance not present: check whether another numeric column is a running balance
    if (amountCol != null && !roles.includes('balance')) {
      for (const s of free) {
        if (roles[s.j] !== 'ignore') continue;
        const amts = sample.map(r => parseAmount(r[amountCol] || '', null));
        const bals = sample.map(r => parseAmount(r[s.j] || '', null));
        if (runningBalanceScore(amts, bals) >= 0.6) { roles[s.j] = 'balance'; conf[s.j] = 0.8; }
      }
    }
    if (amountCol == null && debitCol == null) warnings.push('Coluna de valor não identificada.');
    // description
    let descCol = null, descBest = -1, descSecond = -1;
    stats.forEach(s => {
      if (roles[s.j] !== 'ignore' || !s.ne.length) return;
      if (s.hint === 'ignore' && s.hint !== 'description') { /* still eligible but penalised */ }
      const textF = 1 - s.dateF - s.numF;
      if (textF < 0.3) return;
      let sc = textF * s.fill * (0.4 + 0.6 * Math.min(1, s.avgLen / 12)) * (0.4 + 0.6 * s.distinct) * (1 - 0.9 * s.idF) * (0.3 + 0.7 * s.letters);
      if (s.hint === 'description') sc += 0.6;
      if (s.hint === 'ignore') sc *= 0.3;
      if (sc > descBest) { descSecond = descBest; descBest = sc; descCol = s.j; } else if (sc > descSecond) descSecond = sc;
    });
    if (descCol != null) {
      roles[descCol] = 'description';
      const s = stats[descCol];
      let c = 0.5 + 0.5 * (descSecond > 0 ? clamp01(1 - descSecond / descBest) : 1);
      if (s.hint === 'description') c = Math.max(c, 0.9);
      conf[descCol] = round2(clamp01(c));
    } else warnings.push('Coluna de descrição não identificada.');

    // number format
    const numCols = roles.map((r, j) => (['amount', 'debit', 'credit', 'balance'].includes(r) ? j : -1)).filter(j => j >= 0);
    const nfStrings = [];
    for (const j of (numCols.length ? numCols : numeric.map(s => s.j))) for (const r of sample) if (r[j]) nfStrings.push(r[j]);
    const nf = detectNumberFormat(nfStrings);
    // date format
    const df = dateCol != null ? detectDateFormat(sample.map(r => r[dateCol]).filter(Boolean)) : { format: 'DD/MM/YYYY', confidence: 0.2 };

    // sign convention
    let signConvention = 'negative_is_expense', signConfidence = 0.3;
    const dcCol = roles.indexOf('dcFlag');
    if (dcCol >= 0 && amountCol != null) { signConvention = 'dc_flag'; signConfidence = conf[dcCol]; }
    else if (debitCol != null) { signConvention = 'split_columns'; signConfidence = splitByHeader ? 0.95 : conf[debitCol]; }
    else if (amountCol != null) {
      let pos = 0, neg = 0, score = 0, embeddedDC = 0;
      for (const r of sample) {
        const raw = r[amountCol] || '';
        const a = parseAmount(raw, nf.format);
        if (a == null || a === 0) continue;
        if (/\d\s*(D|C|DB|CR)$/i.test(raw.trim())) embeddedDC++;
        if (a > 0) pos++; else neg++;
        const d = descCol != null ? norm(r[descCol]) : norm(r.join(' '));
        if (PAYMENT_KW_RE.test(d) && !/RECEBIDO DE|SALARIO/.test(d) && a < 0 && /FATURA|RECEBIDO|EFETUADO|^PAGAMENTO\b|PAYMENT/.test(d)) score += 2;
        if (INCOME_KW_RE.test(d)) score += a > 0 ? -2 : 1;
        if (REFUND_ANY_RE.test(d)) score += a < 0 ? 1 : -1;
      }
      const tot = pos + neg;
      if (embeddedDC > tot * 0.5) { signConvention = 'negative_is_expense'; signConfidence = 0.9; }
      else if (tot) {
        const posF = pos / tot;
        if (posF > 0.7) score += posF > 0.9 ? 2 : 1;
        if (posF < 0.5) score -= 2;
        score = Math.max(-4, Math.min(4, score));
        if (score >= 2) { signConvention = 'positive_is_expense'; signConfidence = round2(Math.min(0.95, 0.5 + 0.12 * score)); }
        else { signConvention = 'negative_is_expense'; signConfidence = round2(score <= -2 ? 0.95 : score <= 0 ? 0.8 : 0.55); }
      }
    }

    // skipped rows
    const skippedRows = [];
    rows.forEach((r, i) => {
      if (i === headerRowIndex) return;
      const f = feats[i];
      if (!f.nonEmpty) return;
      const text = r.filter(Boolean).join(' | ');
      if (i < dataStart) skippedRows.push({ index: i, text, reason: 'preâmbulo' });
      else if (i > dataEnd) skippedRows.push({ index: i, text, reason: 'rodapé' });
      else if (rowMatchesSkip(r, skipRes, descCol)) skippedRows.push({ index: i, text, reason: 'saldo/total' });
      else if (!f.dataLike) skippedRows.push({ index: i, text, reason: 'linha sem data ou valor' });
    });

    const columns = [];
    for (let j = 0; j < W; j++) {
      columns.push({ index: j, header: header[j] || '', role: roles[j], confidence: round2(conf[j]),
        samples: sample.map(r => r[j] || '').filter(Boolean).slice(0, 5) });
    }
    const headerNorm = header.map(h => norm(h).replace(/[^A-Z0-9$]+/g, ' ').trim());
    const fpSrc = headerRowIndex != null
      ? 'H|' + (delimiter || 'rows') + '|' + headerNorm.join(';')
      : 'N|' + (delimiter || 'rows') + '|' + W + '|' + roles.join(',') + '|' + df.format + '|' + nf.format;
    const fingerprint = 'fp_' + hashStr(fpSrc);

    const cDate = dateCol != null ? conf[dateCol] : 0;
    const cDesc = descCol != null ? conf[descCol] : 0;
    const cAmt = amountCol != null ? conf[amountCol] : debitCol != null ? conf[debitCol] : 0;
    let overall = 0.15 * (delimiterConfidence == null ? 1 : delimiterConfidence) + 0.2 * cDate + 0.15 * cDesc + 0.2 * cAmt + 0.15 * nf.confidence + 0.15 * signConfidence;
    if (!cDate || !cAmt) overall = Math.min(overall, 0.3);
    if (Math.min(cDate, cDesc, cAmt, signConfidence) < 0.45) overall *= 0.85;
    if (nf.confidence < 0.6) warnings.push('Formato numérico incerto (' + nf.format + '); confirme.');
    if (signConfidence < 0.6) warnings.push('Convenção de sinal incerta; confirme se despesas são negativas ou positivas.');
    if (delimiterConfidence != null && delimiterConfidence < 0.6) warnings.push('Separador de colunas incerto.');
    if (df.confidence < 0.6) warnings.push('Formato de data incerto (' + df.format + ').');

    return Object.assign(base, {
      headerRowIndex, dataStart, dataEnd, skippedRows, columns,
      numberFormat: nf.format, numberFormatConfidence: nf.confidence,
      dateFormat: df.format, dateFormatConfidence: df.confidence,
      signConvention, signConfidence, fingerprint, overallConfidence: round2(clamp01(overall)), width: W
    });
  }

  function textToRows(text, delimiter) {
    const pre = preprocessText(text);
    let d = delimiter || pre.forced, dc = pre.forced ? 1 : null;
    if (!d) { const det = detectDelimiter(pre.text); d = det.delimiter; dc = det.confidence; }
    return { rows: parseDelimited(pre.text, d), delimiter: d, delimiterConfidence: dc == null ? 1 : dc };
  }

  function analyzeTable(text, opts) {
    let encoding = (opts && opts.encoding) || 'utf-8';
    if (typeof text !== 'string') { const dec = decodeBytes(text); text = dec.text; encoding = dec.encoding; }
    const t = textToRows(text, null);
    return analyzeGrid(t.rows, t.delimiter, t.delimiterConfidence, encoding);
  }
  function analyzeRows(rows) {
    return analyzeGrid((rows || []).map(r => (r || []).map(c => (c instanceof Date ? isoFromDate(c) : typeof c === 'number' ? numToCell(c) : cellStr(c)))), null, 1, 'utf-8');
  }
  function isoFromDate(d) { return isNaN(d) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function numToCell(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2); }

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------
  function profileFromAnalysis(analysis, overrides) {
    const a = analysis || {};
    const cols = {};
    for (const c of a.columns || []) {
      if (c.role && c.role !== 'ignore' && cols[c.role] == null) cols[c.role] = c.index;
    }
    const columns = {};
    for (const k of ['date', 'time', 'description', 'amount', 'debit', 'credit', 'dcFlag', 'installment', 'balance']) if (cols[k] != null) columns[k] = cols[k];
    const hdr = a.headerRowIndex != null && a.rows ? a.rows[a.headerRowIndex].filter(Boolean).slice(0, 4).join(', ') : (a.columns || []).length + ' colunas';
    const p = {
      id: 'prof_' + hashStr(a.fingerprint || JSON.stringify(columns)),
      name: 'Layout: ' + hdr,
      fingerprint: a.fingerprint || '',
      encoding: a.encoding === 'windows-1252' ? 'windows-1252' : 'utf-8',
      delimiter: a.delimiter || ';',
      headerRowIndex: a.headerRowIndex == null ? null : a.headerRowIndex,
      skipTop: a.dataStart || 0,
      skipBottomPatterns: SKIP_PATTERNS.slice(),
      columns,
      dateFormat: a.dateFormat || 'DD/MM/YYYY',
      numberFormat: a.numberFormat || 'br',
      signConvention: a.signConvention || 'negative_is_expense'
    };
    const o = overrides || {};
    const out = Object.assign({}, p, o);
    if (o.columns) {
      out.columns = Object.assign({}, p.columns, o.columns);
      for (const k of Object.keys(out.columns)) if (out.columns[k] == null || out.columns[k] === -1) delete out.columns[k];
    }
    return out;
  }

  function matchProfile(analysis, profiles) {
    if (!analysis || !profiles) return null;
    return profiles.find(p => p && p.fingerprint && p.fingerprint === analysis.fingerprint) || null;
  }

  function resolveRows(rowsOrText, profile) {
    if (isArr(rowsOrText)) return rowsOrText.map(r => (isArr(r) ? r : [r]).map(c => (c instanceof Date ? isoFromDate(c) : typeof c === 'number' ? numToCell(c) : cellStr(c))));
    let text = rowsOrText;
    if (typeof text !== 'string') text = decodeBytes(text).text;
    return textToRows(text, profile && profile.delimiter).rows;
  }

  function amountFromRow(r, profile) {
    const c = profile.columns || {}, nf = profile.numberFormat || 'br';
    const conv = profile.signConvention || 'negative_is_expense';
    if (conv === 'split_columns' || (c.amount == null && c.debit != null)) {
      const dv = c.debit != null ? (r[c.debit] || '') : '', cv = c.credit != null ? (r[c.credit] || '') : '';
      const d = dv ? parseAmount(dv, nf) : null, cr = cv ? parseAmount(cv, nf) : null;
      if ((dv && d == null) || (cv && cr == null)) return { error: 'valor inválido' };
      if (d == null && cr == null) {
        if (c.amount != null && r[c.amount]) { const a = parseAmount(r[c.amount], nf); return a == null ? { error: 'valor inválido' } : { amount: a }; }
        return { error: 'sem valor' };
      }
      return { amount: (cr ? Math.abs(cr) : 0) - (d ? Math.abs(d) : 0) };
    }
    const raw = c.amount != null ? (r[c.amount] || '') : '';
    if (!raw) return { error: 'sem valor' };
    const a = parseAmount(raw, nf);
    if (a == null) return { error: 'valor inválido' };
    if (conv === 'positive_is_expense') return { amount: -a };
    if (conv === 'dc_flag') {
      const f = c.dcFlag != null ? flagSign(r[c.dcFlag]) : 0;
      if (!f) return a < 0 ? { amount: a } : { error: 'indicador D/C ausente' };
      return { amount: f * Math.abs(a) };
    }
    return { amount: a };
  }

  /** applyProfile(rowsOrText, profile, { accountId, importId, referenceYear?, referenceMonth? }) */
  function applyProfile(rowsOrText, profile, opts) {
    opts = opts || {};
    const rows = resolveRows(rowsOrText, profile);
    const c = profile.columns || {};
    const start = Math.max(profile.skipTop || 0, profile.headerRowIndex != null ? profile.headerRowIndex + 1 : 0);
    const skipRes = compileSkip(profile.skipBottomPatterns || SKIP_PATTERNS);
    const errors = [];
    const pending = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const nonEmpty = r.filter(Boolean).length;
      if (!nonEmpty) continue;
      if (rowMatchesSkip(r, skipRes, c.description)) continue;
      const raw = r.filter(Boolean).join(' | ');
      const dp = parseDateParts(r[c.date] || '', profile.dateFormat);
      if (!dp) { if (nonEmpty >= 2) errors.push({ rowIndex: i, raw, reason: 'data inválida' }); continue; }
      const am = amountFromRow(r, profile);
      if (am.error) { errors.push({ rowIndex: i, raw, reason: am.error }); continue; }
      if (am.amount === 0) { errors.push({ rowIndex: i, raw, reason: 'valor zero' }); continue; }
      const desc = (c.description != null ? r[c.description] : '') || '';
      const time = (c.time != null ? parseTime(r[c.time]) : null) || timeFromDateCell(r[c.date]);
      pending.push({ i, dp, amount: am.amount, desc: desc || '(sem descrição)', instCell: c.installment != null ? r[c.installment] : '', time });
    }
    // resolve year-less dates
    const withYear = pending.filter(p => p.dp.hasYear);
    const yearless = pending.filter(p => !p.dp.hasYear);
    if (yearless.length) {
      const now = nowParts();
      const refYear = opts.referenceYear || (withYear.length ? Math.max.apply(null, withYear.map(p => p.dp.y)) : now.y);
      let latest = opts.referenceMonth;
      if (latest == null) {
        const ms = yearless.map(p => p.dp.m);
        const mx = Math.max.apply(null, ms), mn = Math.min.apply(null, ms);
        latest = mx - mn > 6 ? Math.max.apply(null, ms.filter(m => m <= 6)) : mx;
      }
      for (const p of yearless) {
        p.dp.y = refYear - (p.dp.m > latest ? 1 : 0);
        if (p.dp.d > daysInMonth(p.dp.y, p.dp.m)) p.dp.d = daysInMonth(p.dp.y, p.dp.m);
      }
    }
    const occ = {};
    const transactions = [];
    let total = 0;
    const accountId = opts.accountId || profile.defaultAccountId || 'conta';
    const importId = opts.importId || 'imp_' + hashStr(String(Date.now()));
    const shiftInst = profile.installmentDate !== 'as_is';
    for (const p of pending) {
      const purchaseDate = p.dp.y + '-' + pad2(p.dp.m) + '-' + pad2(p.dp.d);
      const nd = normalizeDescription(p.desc);
      let installment = nd.installment;
      if (p.instCell) installment = parseInstallmentText(p.instCell) || installment;
      // each parcela counts in the month of the parcela: n of N bought on D is booked on D + (n-1) months
      const date = installment && shiftInst ? shiftDateMonths(purchaseDate, installment.n - 1) : purchaseDate;
      const key = date + '|' + p.amount + '|' + p.desc + '|' + accountId + (installment ? '|p' + installment.n + '/' + installment.total : '');
      occ[key] = (occ[key] || 0) + 1;
      const tx = {
        id: 'tx_' + hashStr(key + '|' + (occ[key] - 1)),
        date, amount: p.amount, rawDescription: p.desc, merchant: nd.merchant, installment,
        accountId, kind: p.amount < 0 ? 'expense' : 'income', categoryId: null, catSource: null, importId,
        rowIndex: p.i
      };
      if (installment && date !== purchaseDate) tx.originalDate = purchaseDate;
      if (p.time) tx.time = p.time;
      total += p.amount;
      transactions.push(tx);
    }
    return { transactions, errors, total };
  }

  // ---------------------------------------------------------------------------
  // Dedupe & card payment linking
  // ---------------------------------------------------------------------------
  function merchantSimilar(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return a === b;
    if (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
    const ta = new Set(a.split(/[^A-Z0-9]+/).filter(w => w.length > 1)), tb = new Set(b.split(/[^A-Z0-9]+/).filter(w => w.length > 1));
    let inter = 0; for (const w of ta) if (tb.has(w)) inter++;
    const uni = ta.size + tb.size - inter;
    if (uni && inter / uni >= 0.5) return true;
    const fa = [...ta][0], fb = [...tb][0];
    return !!fa && fa === fb && fa.length >= 4;
  }
  function sameInstallment(a, b) {
    const x = a && a.installment, y = b && b.installment;
    if (!x && !y) return true;
    if (!x || !y) return false;
    return x.n === y.n && x.total === y.total;
  }
  function dedupe(existing, incoming) {
    const ex = (existing || []).filter(t => t && !t.deleted);
    const used = new Set();
    const byId = new Map(ex.map((t, i) => [t.id, i]));
    const fresh = [], duplicates = [];
    for (const t of incoming || []) {
      let hit = -1;
      if (byId.has(t.id) && !used.has(byId.get(t.id)) && sameInstallment(ex[byId.get(t.id)], t)) hit = byId.get(t.id);
      if (hit < 0) {
        const dn = dayNum(t.date);
        for (let i = 0; i < ex.length; i++) {
          if (used.has(i)) continue;
          const e = ex[i];
          if (e.accountId !== t.accountId || e.amount !== t.amount) continue;
          if (!sameInstallment(e, t)) continue; // parcela 4/10 is never a duplicate of 3/10
          if (Math.abs(dayNum(e.date) - dn) > 2) continue;
          if (!merchantSimilar(e.merchant || e.rawDescription, t.merchant || t.rawDescription)) continue;
          hit = i; break;
        }
      }
      if (hit >= 0) { used.add(hit); duplicates.push(Object.assign({}, t, { duplicateOf: ex[hit].id })); }
      else fresh.push(t);
    }
    return { fresh, duplicates };
  }

  /** linkCardPayments(transactions, accounts?) — marks fatura payments kind "card_payment" on both sides. */
  function linkCardPayments(transactions, accounts) {
    const txs = (transactions || []).filter(t => t && !t.deleted).map(t => Object.assign({}, t));
    const typeOf = t => accountTypeOf(t, accounts ? { accounts } : null);
    const isCardAcc = t => typeOf(t) === 'credit_card';
    const mark = t => { if (t.catSource === 'manual' && t.kind !== 'card_payment') return; t.kind = 'card_payment'; t.categoryId = null; if (t.catSource === 'dictionary') t.catSource = null; };
    // explicit keywords
    for (const t of txs) {
      const d = norm(t.rawDescription) + ' | ' + norm(t.merchant);
      if (CARD_PAYMENT_RE.test(d)) mark(t);
      else if (t.amount > 0 && CARD_SIDE_PAYMENT_RE.test(norm(t.rawDescription)) && (isCardAcc(t) || typeOf(t) == null)) {
        // card side: needs a credit_card account, or (unknown account) a matching bank-side debit
        if (isCardAcc(t) || txs.some(o => o !== t && o.accountId !== t.accountId && o.amount === -t.amount && Math.abs(dayNum(o.date) - dayNum(t.date)) <= 5)) mark(t);
      }
    }
    // match bank-side debits with card-side payments
    const cardSide = txs.filter(t => t.kind === 'card_payment' && t.amount > 0);
    const usedBank = new Set();
    for (const c of cardSide) {
      // candidates: other non-card account, exact opposite amount, within 5 days.
      // Prefer ones whose text hints at a card/bill payment; without hints accept only a unique candidate.
      const cands = [];
      for (const b of txs) {
        if (b === c || b.accountId === c.accountId || b.amount !== -c.amount || usedBank.has(b)) continue;
        if (isCardAcc(b) || (b.kind && b.kind !== 'expense' && b.kind !== 'card_payment')) continue;
        if (b.catSource === 'manual' && b.kind !== 'card_payment') continue;
        const dd = Math.abs(dayNum(b.date) - dayNum(c.date));
        if (dd > 5) continue;
        const d = norm(b.rawDescription) + ' ' + norm(b.merchant);
        const hint = /FATURA|CARTAO|CARD|PAGAMENTO|PAGTO|PGTO|BOLETO|\bPIX\b|NU PAGAMENTOS|NUBANK|ITAUCARD|BANCO|\bBCO\b/.test(d) && !b.categoryId;
        cands.push({ b, dd, hint });
      }
      const hinted = cands.filter(x => x.hint);
      const pool = hinted.length ? hinted : (cands.length === 1 ? cands : []);
      pool.sort((x, y) => x.dd - y.dd);
      const best = pool.length ? pool[0].b : null;
      if (best) { usedBank.add(best); mark(best); best.linkedTo = c.id; c.linkedTo = best.id; }
    }
    return txs;
  }

  // ---------------------------------------------------------------------------
  // Aggregations
  // ---------------------------------------------------------------------------
  function rangeFilter(from, to) {
    const f = from ? (from.length === 7 ? from + '-01' : from) : null;
    const t = to ? (to.length === 7 ? to + '-31' : to) : null;
    return tx => !!tx && !tx.deleted && (!f || tx.date >= f) && (!t || tx.date <= t);
  }
  /** When payslip transactions exist, drop the bank-side net salary deposit they explain. */
  function dropPayslipDuplicates(txs) {
    const slips = txs.filter(t => t.payslip && t.payslipNet > 0 && (t.payslipRole === 'gross' || t.payslipRole === 'net' || t.payslipRole === 'advance'));
    if (!slips.length) return txs;
    const drop = new Set();
    for (const s of slips) {
      const tol = Math.max(100, Math.round(s.payslipNet * 0.01));
      let best = null, bd = 99;
      for (const t of txs) {
        if (t.payslip || drop.has(t) || t.kind !== 'income') continue;
        if (Math.abs(t.amount - s.payslipNet) > tol) continue;
        const dd = Math.abs(dayNum(t.date) - dayNum(s.date));
        if (dd <= 20 && dd < bd) { best = t; bd = dd; }
      }
      if (best) drop.add(best);
    }
    return txs.filter(t => !drop.has(t));
  }
  function effective(txs, from, to) {
    const inR = rangeFilter(from, to);
    return dropPayslipDuplicates((txs || []).filter(inR)).filter(t => t.kind !== 'card_payment' && t.kind !== 'transfer');
  }

  function summarize(transactions, opts) {
    opts = opts || {};
    const inR = rangeFilter(opts.from, opts.to);
    const inRange = (transactions || []).filter(inR);
    const eff = effective(transactions, opts.from, opts.to);
    let income = 0, expense = 0, investment = 0, uncategorized = 0;
    const byCategory = {}, byGroup = {}, byAccount = {}, byAccountDetail = {};
    for (const t of eff) {
      const acc = t.accountId || 'conta';
      byAccountDetail[acc] = byAccountDetail[acc] || { income: 0, expense: 0, net: 0 };
      let v = 0;
      if (t.kind === 'income') { income += t.amount; v = t.amount; byAccountDetail[acc].income += t.amount; }
      else if (t.kind === 'expense') {
        v = -t.amount; expense += v; byAccountDetail[acc].expense += v;
        byAccount[acc] = (byAccount[acc] || 0) + v;
        if (!t.categoryId) uncategorized += v;
      } else if (t.kind === 'investment') { v = -t.amount; investment += v; }
      byAccountDetail[acc].net += t.amount;
      const cid = t.categoryId || (t.kind === 'income' ? 'renda.outros' : 'uncategorized');
      byCategory[cid] = (byCategory[cid] || 0) + v;
      const g = cid.split('.')[0];
      byGroup[g] = (byGroup[g] || 0) + v;
    }
    return { income, expense, net: income - expense, investment, uncategorized, byCategory, byGroup, byAccount, byAccountDetail, count: inRange.length };
  }

  function monthlySeries(transactions, months, endMonth) {
    months = months || 6;
    if (!endMonth) {
      const ds = (transactions || []).filter(t => t && !t.deleted).map(t => t.date).filter(Boolean).sort();
      endMonth = ds.length ? monthOf(ds[ds.length - 1]) : (nowParts().y + '-' + pad2(nowParts().m));
    }
    const list = [];
    for (let k = months - 1; k >= 0; k--) list.push(addMonths(endMonth, -k));
    const map = {};
    for (const m of list) map[m] = { month: m, income: 0, expense: 0, net: 0, investment: 0 };
    const eff = effective(transactions, list[0] + '-01', endMonth + '-31');
    for (const t of eff) {
      const r = map[monthOf(t.date)]; if (!r) continue;
      if (t.kind === 'income') r.income += t.amount;
      else if (t.kind === 'expense') r.expense += -t.amount;
      else if (t.kind === 'investment') r.investment += -t.amount;
    }
    return list.map(m => { const r = map[m]; r.net = r.income - r.expense; return r; });
  }

  /** Remaining installments projected forward. totals/amounts are positive cents to be paid. */
  function futureInstallments(transactions) {
    const purchases = new Map();
    for (const t of transactions || []) {
      // the last parcela (n == total) still counts: it tells us nothing is left to project for that purchase
      if (!t || t.deleted || !t.installment || !(t.installment.total >= t.installment.n) || !(t.amount < 0)) continue;
      if (t.kind && t.kind !== 'expense') continue;
      const m = monthOf(t.date);
      const startM = t.originalDate ? monthOf(t.originalDate) : addMonths(m, -(t.installment.n - 1));
      const key = [t.accountId, norm(t.merchant || t.rawDescription), Math.abs(t.amount), t.installment.total, startM].join('|');
      const cur = purchases.get(key);
      if (!cur || t.installment.n > cur.installment.n) purchases.set(key, t);
    }
    const byMonth = {};
    for (const t of purchases.values()) {
      if (!(t.installment.total > t.installment.n)) continue;
      const m = monthOf(t.date);
      for (let k = t.installment.n + 1; k <= t.installment.total; k++) {
        const fm = addMonths(m, k - t.installment.n);
        byMonth[fm] = byMonth[fm] || { month: fm, total: 0, items: [] };
        const amt = Math.abs(t.amount);
        byMonth[fm].total += amt;
        byMonth[fm].items.push({ sourceId: t.id, merchant: t.merchant, amount: amt, n: k, total: t.installment.total, originalDate: t.originalDate || null,
          accountId: t.accountId, categoryId: t.categoryId == null ? null : t.categoryId });
      }
    }
    return Object.values(byMonth).sort((a, b) => (a.month < b.month ? -1 : 1));
  }

  function formatBRL(cents) {
    let c = Math.round(Number(cents) || 0);
    const neg = c < 0; c = Math.abs(c);
    const r = Math.floor(c / 100), f = c % 100;
    return (neg ? '-' : '') + 'R$ ' + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + pad2(f);
  }

  // ---------------------------------------------------------------------------
  // Payslip
  // ---------------------------------------------------------------------------
  function toCents(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 100);
    return parseAmount(v, 'br');
  }
  function deductionCategory(name) {
    const n = norm(name);
    if (/\bINSS\b|PREVIDENCIA SOCIAL/.test(n)) return 'impostos.inss';
    if (/\bIRRF?\b|IMPOSTO DE RENDA/.test(n)) return 'impostos.ir';
    if (/VALE TRANSPORTE|\bVT\b/.test(n)) return 'transporte.publico';
    if (/VALE REFEICAO|VALE ALIMENTACAO|\bVR\b|\bVA\b/.test(n)) return 'alimentacao.restaurante';
    if (/PLANO DE SAUDE|ASSIST(ENCIA)? MEDICA|UNIMED|AMIL|SAUDE/.test(n)) return 'saude.plano';
    if (/ODONTO/.test(n)) return 'saude.plano';
    if (/SEGURO DE VIDA|SEGURO/.test(n)) return 'servicos.seguros';
    if (/PREVIDENCIA PRIVADA|\bPGBL\b|\bVGBL\b|FUNDACAO/.test(n)) return 'investimentos.aplicacoes';
    if (/SINDICA|CONTRIBUICAO/.test(n)) return 'impostos.outros';
    return 'impostos.outros';
  }
  /** Default advance date: day 20 of the month before the payment when the salary is paid in the first days
   *  of the month (the usual "adiantamento dia 20 / saldo dia 5"), else day 20 of the same month. */
  function defaultAdvanceDate(payDate) {
    const p = String(payDate || '').split('-').map(Number);
    if (p.length < 3 || !p[0]) return payDate;
    const ym = p[0] + '-' + pad2(p[1]);
    const target = p[2] <= 20 ? addMonths(ym, -1) : ym;
    return target + '-20';
  }
  /** Live split for the payslip form. Amounts in cents.
   *  -> { gross, deductions, net, advance, finalDeposit, advanceDate } ; advance = percent of GROSS. */
  function payslipSplit(p) {
    p = p || {};
    const gross = Math.abs(toCents(p.gross) || 0);
    const deductions = Math.abs(toCents(p.inss) || 0) + Math.abs(toCents(p.irrf) || 0) +
      (p.otherDeductions || []).reduce((a, d) => a + Math.abs(toCents(d.amount) || 0), 0);
    let net = toCents(p.net); if (net == null) net = gross - deductions;
    const adv = p.advance || {};
    const pct = adv.percent == null || adv.percent === '' ? 40 : Number(adv.percent);
    const advance = adv.enabled && gross > 0 && pct > 0 ? Math.round(gross * Math.min(100, pct) / 100) : 0;
    return { gross, deductions, net, advance, finalDeposit: net - advance, percent: pct,
      advanceDate: adv.enabled ? (adv.date || defaultAdvanceDate(p.date)) : null };
  }
  function payslipToTransactions(p) {
    p = p || {};
    const date = p.date || (nowParts().y + '-' + pad2(nowParts().m) + '-' + pad2(nowParts().d));
    const accountId = p.accountId || 'holerite';
    const employer = norm(p.employer || 'EMPREGADOR');
    const gross = toCents(p.gross), inss = toCents(p.inss), irrf = toCents(p.irrf);
    let net = toCents(p.net);
    const others = (p.otherDeductions || []).map(d => ({ name: d.name || 'Desconto', amount: toCents(d.amount) })).filter(d => d.amount);
    const importId = p.importId || ('payslip_' + hashStr(date + '|' + employer + '|' + gross + '|' + net));
    const mk = (role, raw, amount, categoryId, kind, d) => ({
      id: 'tx_' + hashStr([d || date, amount, raw, accountId, role].join('|')),
      date: d || date, amount, rawDescription: raw, merchant: role === 'gross' || role === 'net' || role === 'advance' ? employer : norm(raw),
      installment: null, accountId, kind, categoryId, catSource: 'manual', importId,
      payslip: true, payslipRole: role
    });
    const out = [];
    if (gross) {
      const deds = [];
      if (inss) deds.push({ name: 'INSS', amount: Math.abs(inss), cat: 'impostos.inss' });
      if (irrf) deds.push({ name: 'IRRF', amount: Math.abs(irrf), cat: 'impostos.ir' });
      for (const d of others) deds.push({ name: d.name, amount: Math.abs(d.amount), cat: deductionCategory(d.name) });
      let dsum = deds.reduce((a, d) => a + d.amount, 0);
      if (net == null) net = gross - dsum;
      const diff = gross - dsum - net;
      if (diff > 0) deds.push({ name: 'Outros descontos', amount: diff, cat: 'impostos.outros' });
      // adiantamento salarial: a percentage of GROSS paid on its own date; income over both dates totals gross,
      // the final deposit is net - advance
      const sp = payslipSplit({ gross, net, date, advance: p.advance });
      const g = mk('gross', 'SALARIO BRUTO ' + employer, Math.abs(gross) - sp.advance, 'renda.salario', 'income');
      g.payslipNet = net - sp.advance;
      if (diff < 0) g.note = 'Descontos somam mais que bruto - líquido (' + formatBRL(-diff) + ')';
      if (sp.advance > 0) {
        const a = mk('advance', 'ADIANTAMENTO SALARIAL ' + employer, sp.advance, 'renda.salario', 'income', sp.advanceDate);
        a.payslipNet = sp.advance;
        a.advancePercent = sp.percent;
        g.payslipAdvance = sp.advance;
        out.push(a);
      }
      out.push(g);
      for (const d of deds) out.push(mk('deduction', d.name, -d.amount, d.cat, 'expense'));
    } else if (net) {
      const t = mk('net', 'SALARIO LIQUIDO ' + employer, Math.abs(net), 'renda.salario', 'income');
      t.payslipNet = Math.abs(net);
      out.push(t);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Sankey
  // ---------------------------------------------------------------------------
  function buildSankey(transactions, opts) {
    opts = opts || {};
    const categories = opts.categories || DEFAULT_CATEGORIES;
    const ci = buildCatIndex(categories);
    const maxNodes = Math.max(2, opts.maxNodes || 8);
    const view = opts.view === 'account' ? 'account' : 'category';
    const accName = id => {
      const a = (opts.accounts || []).find(x => x.id === id);
      return a ? a.name : id;
    };
    let all = (transactions || []).filter(t => t && !t.deleted);
    if (opts.payslips && opts.payslips.length) {
      const ids = new Set(all.map(t => t.id));
      for (const p of opts.payslips) {
        const txs = p && p.amount !== undefined && p.date && p.rawDescription !== undefined ? [p] : payslipToTransactions(p);
        for (const t of txs) if (!ids.has(t.id)) { all.push(t); ids.add(t.id); }
      }
    }
    const eff = effective(all, opts.from, opts.to);
    const income = new Map(); // key -> cents
    const exp = new Map(); // acc|cat -> cents
    for (const t of eff) {
      if (t.kind === 'income') {
        const k = t.categoryId || '__outras';
        income.set(k, (income.get(k) || 0) + t.amount);
      } else if (t.kind === 'expense' || t.kind === 'investment') {
        const cat = t.categoryId || (t.kind === 'investment' ? 'investimentos.aplicacoes' : '__none');
        const k = (t.accountId || 'conta') + '\u0001' + cat;
        exp.set(k, (exp.get(k) || 0) - t.amount);
      }
    }
    // negative category nets (refunds/resgates larger than spend) become income sources
    for (const [k, v] of [...exp]) {
      if (v < 0) {
        const cat = k.split('\u0001')[1];
        const src = cat.startsWith('investimentos') ? '__resgates' : '__estornos';
        income.set(src, (income.get(src) || 0) - v);
        exp.delete(k);
      } else if (v === 0) exp.delete(k);
    }
    for (const [k, v] of [...income]) {
      if (v < 0) { income.delete(k); exp.set('__neg\u0001__none', (exp.get('__neg\u0001__none') || 0) - v); }
      else if (v === 0) income.delete(k);
    }
    const totalIn = [...income.values()].reduce((a, b) => a + b, 0);
    const totalOut = [...exp.values()].reduce((a, b) => a + b, 0);
    if (!totalIn && !totalOut) return { nodes: [], links: [], meta: { income: 0, expense: 0, surplus: 0, deficit: 0 } };
    const surplus = Math.max(0, totalIn - totalOut), deficit = Math.max(0, totalOut - totalIn);
    const nodes = [], links = [];
    const nodeMap = new Map();
    const addNode = (id, name, color, column) => { if (!nodeMap.has(id)) { const n = { id, name, color, value: 0, column }; nodeMap.set(id, n); nodes.push(n); } return nodeMap.get(id); };
    const linkMap = new Map();
    const addLink = (s, t, v) => { if (!(v > 0)) return; const k = s + '\u0002' + t; linkMap.set(k, (linkMap.get(k) || 0) + v); };
    const NEUTRAL = '#8A94A6', GREEN = '#34A853', TEAL = '#3BA99C', RED = '#E5484D';
    const HUB = 'hub';
    addNode(HUB, 'Orçamento', NEUTRAL, 1);

    // column 0: income sources
    const srcName = k => k === '__outras' ? 'Outras receitas' : k === '__resgates' ? 'Resgates' : k === '__estornos' ? 'Estornos' : (ci[k] ? ci[k].name : k);
    let srcs = [...income.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    const srcSlots = maxNodes - (deficit > 0 ? 1 : 0);
    if (srcs.length > srcSlots) {
      const keep = srcs.slice(0, Math.max(1, srcSlots - 1));
      const rest = srcs.slice(keep.length);
      keep.push({ k: '__outros_src', v: rest.reduce((a, b) => a + b.v, 0), name: 'Outras receitas' });
      srcs = keep;
    }
    for (const s of srcs) {
      const id = 'src:' + s.k;
      addNode(id, s.name || srcName(s.k), (ci[s.k] && ci[s.k].color) || GREEN, 0);
      addLink(id, HUB, s.v);
    }
    if (deficit > 0) { addNode('deficit', 'Déficit', RED, 0); addLink('deficit', HUB, deficit); }

    const fold3 = (entries) => { // entries: {parent, key, name, color, v}
      entries.sort((a, b) => b.v - a.v);
      let K = Math.min(entries.length, maxNodes), dropped = [];
      for (; K >= 0; K--) {
        dropped = entries.slice(K);
        const parents = new Set(dropped.map(e => e.parent));
        if (K + parents.size <= maxNodes) break;
      }
      const kept = entries.slice(0, Math.max(0, K));
      const agg = new Map();
      for (const d of dropped) {
        const a = agg.get(d.parent) || { parent: d.parent, key: d.parent + '|__outros', name: 'Outros', color: d.color, v: 0 };
        a.v += d.v; agg.set(d.parent, a);
      }
      return kept.concat([...agg.values()]);
    };

    if (view === 'category') {
      const groups = new Map(); // gid -> {v, children: Map}
      for (const [k, v] of exp) {
        const cat = k.split('\u0001')[1];
        const gid = cat === '__none' ? '__none' : (ci[cat] ? ci[cat].group : cat.split('.')[0]);
        const g = groups.get(gid) || { v: 0, children: new Map() };
        g.v += v; g.children.set(cat, (g.children.get(cat) || 0) + v);
        groups.set(gid, g);
      }
      let glist = [...groups.entries()].map(([gid, g]) => ({ gid, v: g.v, children: g.children })).sort((a, b) => b.v - a.v);
      const gSlots = maxNodes - (surplus > 0 ? 1 : 0);
      let foldedGroups = null;
      if (glist.length > gSlots) {
        const keep = glist.slice(0, Math.max(1, gSlots - 1));
        foldedGroups = glist.slice(keep.length);
        glist = keep;
      }
      const childEntries = [];
      for (const g of glist) {
        const gInfo = ci[g.gid];
        const id = 'grp:' + g.gid;
        const name = g.gid === '__none' ? 'Sem categoria' : (gInfo ? gInfo.groupName : g.gid);
        const color = g.gid === '__none' ? NEUTRAL : (gInfo ? gInfo.color : NEUTRAL);
        addNode(id, name, color, 2);
        addLink(HUB, id, g.v);
        if (g.gid === '__none') continue;
        for (const [cat, v] of g.children) {
          const cname = cat === g.gid ? (name + ' (geral)') : (ci[cat] ? ci[cat].name : cat);
          childEntries.push({ parent: id, key: 'cat:' + cat, name: cname, color, v });
        }
      }
      if (foldedGroups) {
        addNode('grp:__outros', 'Outros', NEUTRAL, 2);
        addLink(HUB, 'grp:__outros', foldedGroups.reduce((a, b) => a + b.v, 0));
      }
      for (const e of fold3(childEntries)) {
        const id = e.key.startsWith('cat:') ? e.key : 'cat:' + e.key;
        addNode(id, e.name, e.color, 3);
        addLink(e.parent, id, e.v);
      }
    } else {
      const accs = new Map();
      for (const [k, v] of exp) {
        const [acc, cat] = k.split('\u0001');
        const gid = cat === '__none' ? '__none' : (ci[cat] ? ci[cat].group : cat.split('.')[0]);
        const a = accs.get(acc) || { v: 0, groups: new Map() };
        a.v += v; a.groups.set(gid, (a.groups.get(gid) || 0) + v);
        accs.set(acc, a);
      }
      let alist = [...accs.entries()].map(([acc, a]) => ({ acc, v: a.v, groups: a.groups })).sort((x, y) => y.v - x.v);
      const aSlots = maxNodes - (surplus > 0 ? 1 : 0);
      let folded = null;
      if (alist.length > aSlots) { const keep = alist.slice(0, Math.max(1, aSlots - 1)); folded = alist.slice(keep.length); alist = keep; }
      const entries = [];
      const palette = ['#4F7DF3', '#F2994A', '#9B6BF2', '#2BB3C0', '#E25D7B', '#E8B931', '#C86DD7', '#6C8EAD'];
      alist.forEach((a, i) => {
        const id = 'acc:' + a.acc;
        const color = palette[i % palette.length];
        addNode(id, accName(a.acc), color, 2);
        addLink(HUB, id, a.v);
        for (const [gid, v] of a.groups) {
          const g = ci[gid];
          entries.push({ parent: id, key: 'ag:' + a.acc + ':' + gid, name: gid === '__none' ? 'Sem categoria' : (g ? g.groupName : gid), color: g ? g.color : NEUTRAL, v });
        }
      });
      if (folded) { addNode('acc:__outros', 'Outras contas', NEUTRAL, 2); addLink(HUB, 'acc:__outros', folded.reduce((s, b) => s + b.v, 0)); }
      for (const e of fold3(entries)) {
        const id = e.key.startsWith('ag:') ? e.key : 'ag:' + e.key;
        addNode(id, e.name, e.color, 3);
        addLink(e.parent, id, e.v);
      }
    }
    if (surplus > 0) { addNode('sobra', 'Sobra / Poupança', TEAL, 2); addLink(HUB, 'sobra', surplus); }

    for (const [k, v] of linkMap) {
      const [s, t] = k.split('\u0002');
      if (v > 0) links.push({ source: s, target: t, value: Math.round(v) });
    }
    // node values = max(in, out)
    const inSum = new Map(), outSum = new Map();
    for (const l of links) { outSum.set(l.source, (outSum.get(l.source) || 0) + l.value); inSum.set(l.target, (inSum.get(l.target) || 0) + l.value); }
    const used = new Set(links.flatMap(l => [l.source, l.target]));
    const finalNodes = nodes.filter(n => used.has(n.id));
    for (const n of finalNodes) n.value = Math.max(inSum.get(n.id) || 0, outSum.get(n.id) || 0);
    return { nodes: finalNodes, links, meta: { income: totalIn, expense: totalOut, surplus, deficit } };
  }

  // ---------------------------------------------------------------------------
  // Account-type guess, import moves, migration
  // ---------------------------------------------------------------------------
  const BANKISH_RE = /\bPIX\b|\bTED\b|\bDOC\b|RENDIMENTO|\bSALDO\b|TRANSFERENCIA|\bBOLETO\b|PAGAMENTO DE FATURA|DEPOSITO|SAQUE/;
  /** 'checking' | 'credit_card' | null — from an analysis (columns/sign) and/or parsed transactions */
  function guessAccountType(analysis, transactions) {
    let bank = 0, card = 0;
    const a = analysis || {};
    const roles = (a.columns || []).map(c => c.role);
    if (roles.includes('balance')) bank += 3;
    if (roles.includes('installment')) card += 3;
    if (a.signConvention === 'positive_is_expense') card += 2;
    const txs = (transactions || []).filter(t => t && !t.deleted);
    let bankTx = 0, inst = 0;
    for (const t of txs) {
      const d = norm(t.rawDescription);
      if (BANKISH_RE.test(d)) bankTx++;
      if (t.installment) inst++;
    }
    if (txs.length) {
      if (bankTx / txs.length >= 0.25) bank += 3;
      if (inst) card += 1;
    }
    if (bank >= 3 && bank > card) return 'checking';
    if (card >= 2 && card > bank) return 'credit_card';
    return null;
  }

  /** Move every transaction of an import to another account and re-derive what depends on the account type:
   *  non-manual classification (kind/category) and card-payment linking. -> new full list (tombstones kept). */
  function moveImport(transactions, importId, accountId, ctx) {
    ctx = ctx || {};
    const now = ctx.now || new Date().toISOString();
    const all = (transactions || []).slice();
    const moved = all.map(t => {
      if (!t || t.deleted || t.importId !== importId) return t;
      let u = Object.assign({}, t, { accountId, updatedAt: now });
      if (u.catSource !== 'manual') {
        const base = Object.assign({}, u, { kind: u.amount < 0 ? 'expense' : 'income', catSource: null, categoryId: null, linkedTo: undefined });
        delete base.linkedTo;
        u = Object.assign(base, classify(base, ctx));
      } else u = applyCategoryKind(u, ctx.categories);
      return u;
    });
    const live = moved.filter(t => t && !t.deleted);
    const linked = linkCardPayments(live, ctx.accounts);
    const byId = new Map(linked.map(t => [t.id, t]));
    return moved.map(t => {
      if (!t || t.deleted) return t;
      const l = byId.get(t.id);
      if (!l) return t;
      const changed = l.kind !== t.kind || l.categoryId !== t.categoryId || l.linkedTo !== t.linkedTo;
      return changed ? Object.assign({}, l, { updatedAt: now }) : t;
    });
  }

  /** Tombstones for every live transaction of an import. */
  function tombstonesForImport(transactions, importId, now) {
    now = now || new Date().toISOString();
    return (transactions || []).filter(t => t && !t.deleted && t.importId === importId)
      .map(t => ({ id: t.id, deleted: true, updatedAt: now, date: t.date }));
  }

  function importLabel(txs, importId) {
    if (/^payslip|^hol-/.test(importId)) return 'Holerite';
    if (importId === 'exemplo') return 'Dados de exemplo';
    const live = (txs || []).filter(t => t && !t.deleted);
    const bankish = live.filter(t => BANKISH_RE.test(norm(t.rawDescription))).length;
    const g = live.length && bankish / live.length < 0.1 ? 'credit_card' : guessAccountType(null, txs);
    return g === 'checking' ? 'Extrato bancário (importado na v1)' : g === 'credit_card' ? 'Fatura de cartão (importada na v1)' : 'Importação anterior (v1)';
  }
  /** Rebuild the imports index from the transactions (keeps existing records, fills the missing ones). */
  function backfillImports(transactions, imports) {
    const out = Object.assign({}, imports || {});
    const by = new Map();
    for (const t of transactions || []) {
      if (!t || t.deleted || !t.importId) continue;
      if (!by.has(t.importId)) by.set(t.importId, []);
      by.get(t.importId).push(t);
    }
    let added = 0;
    for (const [id, txs] of by) {
      const freq = {};
      for (const t of txs) freq[t.accountId] = (freq[t.accountId] || 0) + 1;
      const accountId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      const total = txs.reduce((a, t) => a + (t.amount || 0), 0);
      const dates = txs.map(t => t.date).filter(Boolean).sort();
      if (!out[id]) {
        const m = /^imp-([0-9a-z]+)$/.exec(id);
        let at = null;
        if (m) { const ms = parseInt(m[1], 36); if (ms > 1.5e12 && ms < 4e12) at = new Date(ms).toISOString(); }
        out[id] = { id, fileName: importLabel(txs, id), at: at || (dates[dates.length - 1] || null), accountId, profileId: null,
          count: txs.length, total, from: dates[0] || null, to: dates[dates.length - 1] || null, backfilled: true };
        added++;
      } else {
        out[id] = Object.assign({}, out[id], { count: txs.length, total, from: dates[0] || null, to: dates[dates.length - 1] || null });
        if (!out[id].accountId) out[id].accountId = accountId;
      }
    }
    for (const id of Object.keys(out)) if (!by.has(id)) out[id] = Object.assign({}, out[id], { count: 0, total: 0 });
    return { imports: out, added };
  }

  const SCHEMA_VERSION = 2;
  /** Idempotent data migration to schema 2. Input/Output "flat" data:
   *  { settings, categories, rules, history, profiles, accounts, imports, txs }.
   *  - D3: kind follows the category group (renda.* income, investimentos.* investment, else expense)
   *  - D6: re-normalizes merchants ("... DO DIA 22/09/2026") — not for rule-set merchants
   *  - re-runs the (reworked) dictionary on dictionary/uncategorized transactions; manual ones are never touched
   *  - D4: learned rules for merchants the user corrected consistently in rules.history
   *  - backfills meta.imports, adds updatedAt everywhere; never deletes, never moves accounts
   * -> { data, changedTxIds: string[], changedMeta: string[], report } */
  function migrateData(input, opts) {
    opts = opts || {};
    const now = opts.now || new Date().toISOString();
    const d = Object.assign({}, input);
    d.settings = Object.assign({ budgets: {} }, d.settings || {});
    d.categories = isArr(d.categories) && d.categories.length ? d.categories : DEFAULT_CATEGORIES.map(g => JSON.parse(JSON.stringify(g)));
    d.rules = isArr(d.rules) ? d.rules.slice() : [];
    d.history = isArr(d.history) ? d.history : [];
    d.accounts = isArr(d.accounts) ? d.accounts : [];
    d.profiles = isArr(d.profiles) ? d.profiles : [];
    const changedTx = new Set(), changedMeta = new Set();
    const report = { kinds: 0, merchants: 0, recategorized: 0, rulesCreated: 0, importsAdded: 0, updatedAt: 0, schemaFrom: d.settings.schemaVersion || 1 };
    const catIdx = buildCatIndex(d.categories);
    const merchantMap = new Map(); // old -> new (for learned rules)
    let txs = (d.txs || []).map(t => {
      if (!t || t.deleted) { if (t && !t.updatedAt) { changedTx.add(t.id); return Object.assign({}, t, { updatedAt: now }); } return t; }
      let u = t, touched = false;
      const set = (k, v) => { if (u === t) u = Object.assign({}, t); u[k] = v; touched = true; };
      if (u.catSource !== 'rule' && u.rawDescription) {
        const nm = normalizeDescription(u.rawDescription).merchant;
        if (nm && nm !== u.merchant) { if (u.merchant) merchantMap.set(norm(u.merchant), nm); set('merchant', nm); report.merchants++; }
      }
      if (u.categoryId && (u.kind === 'expense' || u.kind === 'income' || u.kind === 'investment' || !u.kind)) {
        const k = kindForCategory(u.categoryId, catIdx);
        if (k && k !== u.kind) { set('kind', k); report.kinds++; }
      }
      if (!u.updatedAt) { set('updatedAt', now); report.updatedAt++; }
      else if (touched) u.updatedAt = now;
      if (touched) changedTx.add(u.id);
      return u;
    });
    // learned rules from consistent manual corrections (D4)
    const txById = new Map(txs.filter(t => t && !t.deleted).map(t => [t.id, t]));
    const hist = new Map();
    for (const h of d.history) {
      if (!h || !h.categoryId) continue;
      const tx = txById.get(h.txId || h.id);
      const m = norm(tx ? tx.merchant : (merchantMap.get(norm(h.merchant)) || normalizeDescription(h.merchant || '').merchant));
      if (!m) continue;
      if (!hist.has(m)) hist.set(m, new Set());
      hist.get(m).add(h.categoryId);
    }
    for (const r of d.rules) {
      if (r && r.origin === 'learned' && r.match && r.match.field === 'merchant' && merchantMap.has(norm(r.match.value))) {
        r.match = Object.assign({}, r.match, { value: merchantMap.get(norm(r.match.value)) }); changedMeta.add('rules');
      }
    }
    for (const [m, cats] of hist) {
      if (cats.size !== 1) continue; // contradictory corrections: let the user decide
      const cat = [...cats][0];
      if (!catIdx[cat] && !DEFAULT_CAT_INDEX[cat]) continue;
      const exists = d.rules.some(r => r && r.match && r.match.field === 'merchant' && r.match.op === 'equals' && norm(r.match.value) === m);
      if (exists) continue;
      const nr = { id: 'learned_' + hashStr(m), match: { field: 'merchant', op: 'equals', value: m }, set: { categoryId: cat },
        origin: 'learned', priority: 0, hits: 0, updatedAt: now, fromHistory: true };
      if (kindForCategory(cat, catIdx) === 'income') nr.sign = 'in';
      d.rules.push(nr);
      report.rulesCreated++; changedMeta.add('rules');
    }
    // re-run rules + reworked dictionary on everything that is not manual
    const ctx = { rules: d.rules, dictionary: opts.dictionary || DEFAULT_DICTIONARY, categories: d.categories, accounts: d.accounts };
    txs = txs.map(t => {
      if (!t || t.deleted || t.catSource === 'manual' || t.payslip) return t;
      if (t.kind === 'card_payment' || t.kind === 'transfer') return t;
      const c = classify(Object.assign({}, t, { catSource: null, categoryId: null }), ctx);
      if (c.categoryId === t.categoryId && (c.catSource || null) === (t.catSource || null)) return t;
      const u = Object.assign({}, t, { categoryId: c.categoryId, catSource: c.catSource });
      const k = c.categoryId ? kindForCategory(c.categoryId, catIdx) : null;
      if (k && (u.kind === 'expense' || u.kind === 'income' || u.kind === 'investment')) u.kind = k;
      else if (!c.categoryId && t.catSource === 'dictionary' && t.categoryId && kindForCategory(t.categoryId, catIdx) !== null) {
        // the old dictionary category decided the kind; fall back to what the description/sign says
        if (c.kind === 'expense' || c.kind === 'income' || c.kind === 'investment') u.kind = c.kind;
      }
      u.updatedAt = now; report.recategorized++; changedTx.add(u.id);
      return u;
    });
    const bi = backfillImports(txs, d.imports);
    if (bi.added || !d.imports) changedMeta.add('imports');
    d.imports = bi.imports; report.importsAdded = bi.added;
    if (d.settings.schemaVersion !== SCHEMA_VERSION) { d.settings = Object.assign({}, d.settings, { schemaVersion: SCHEMA_VERSION }); changedMeta.add('settings'); }
    d.txs = txs;
    return { data: d, changedTxIds: [...changedTx], changedMeta: [...changedMeta], report };
  }

  // ---------------------------------------------------------------------------
  // AI prompt + validation
  // ---------------------------------------------------------------------------
  function buildAIPrompt(analysis) {
    const a = analysis || {};
    const rows = (a.rows || []).slice(0, 40);
    const keep = new Set((a.columns || []).filter(c => ['date', 'amount', 'debit', 'credit', 'balance', 'dcFlag'].includes(c.role)).map(c => c.index));
    const masked = rows.map((r, i) => {
      const inData = i >= (a.dataStart || 0) && i <= (a.dataEnd == null ? Infinity : a.dataEnd);
      const isHeader = i === a.headerRowIndex;
      return r.map((c, j) => {
        if (isHeader) return c;
        if (inData && keep.has(j)) return c;
        if (inData && (isDateLike(c) || isNumLike(c)) && !/[A-Za-z]{3,}/.test(c)) {
          // unknown-role numeric/date-looking cells inside the data area keep their shape (could be the real amount/date)
          return c;
        }
        return String(c).replace(/\d/g, '9');
      });
    });
    const guess = profileFromAnalysis(a);
    const lines = masked.map((r, i) => i + ': ' + JSON.stringify(r)).join('\n');
    return [
      'You are an expert at reading bank and credit-card statement exports (CSV/TSV/XLSX) from Brazil and elsewhere.',
      'Below are the first ' + rows.length + ' rows of a file the user wants to import into a personal-finance app, already split into cells (0-based row index, then a JSON array of cells; column indices are 0-based).',
      'For privacy, digits inside free-text cells were replaced by "9". Date and money columns are intact so you can infer their formats.',
      'The file may start with preamble lines (bank name, account, period, "Saldo anterior") and end with footer totals ("Total", "Saldo final"); these are not transactions.',
      '',
      'ROWS:',
      lines,
      '',
      'A heuristic parser guessed this (may be wrong): ' + JSON.stringify({ headerRowIndex: guess.headerRowIndex, skipTop: guess.skipTop, columns: guess.columns, dateFormat: guess.dateFormat, numberFormat: guess.numberFormat, signConvention: guess.signConvention }),
      '',
      'TASK: work out the layout and reply with ONLY one JSON object, no prose, no markdown fences, with exactly these keys:',
      '{',
      '  "headerRowIndex": <row index of the header row, or null if there is none>,',
      '  "skipTop": <number of rows before the first transaction row>,',
      '  "columns": { "date": <int>, "description": <int>, "amount": <int or null>, "debit": <int or null>, "credit": <int or null>, "dcFlag": <int or null>, "installment": <int or null> },',
      '  "dateFormat": one of "DD/MM/YYYY", "DD/MM/YY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD.MM.YYYY", "DD/MM", "DD MMM", "DD MMM YYYY", "DD de MMMM de YYYY",',
      '  "numberFormat": "br" (1.234,56) or "us" (1,234.56),',
      '  "signConvention": "negative_is_expense" (money out is negative) | "positive_is_expense" (e.g. credit-card statements where purchases are positive and payments negative) | "dc_flag" (a separate column says D/C) | "split_columns" (separate debit and credit columns),',
      '  "skipBottomPatterns": [<regex strings, uppercase, matching description cells of non-transaction rows such as "^SALDO", "^TOTAL">],',
      '  "confidence": <0..1>',
      '}',
      'Rules: use "amount" for a single signed value column; use "debit" and "credit" (and set signConvention "split_columns") when money in and out are in different columns; never point a role at a running-balance ("Saldo") column.'
    ].join('\n');
  }

  function validateAIProfile(json, analysis) {
    const problems = [];
    const a = analysis || {};
    let obj = json;
    if (typeof obj === 'string') {
      let s = obj.replace(/```(?:json)?/gi, '');
      const i = s.indexOf('{'), j = s.lastIndexOf('}');
      if (i < 0 || j < i) return { profile: null, problems: ['Resposta da IA não contém JSON.'] };
      try { obj = JSON.parse(s.slice(i, j + 1)); } catch (e) { return { profile: null, problems: ['JSON inválido: ' + e.message] }; }
    }
    if (!obj || typeof obj !== 'object') return { profile: null, problems: ['Resposta vazia.'] };
    if (obj.profile && typeof obj.profile === 'object') obj = obj.profile;
    const W = Math.max(a.width || 0, (a.columns || []).length, (a.rows || []).reduce((m, r) => Math.max(m, r.length), 0));
    const cols = {};
    const srcCols = obj.columns || {};
    for (const k of ['date', 'description', 'amount', 'debit', 'credit', 'dcFlag', 'installment']) {
      const v = srcCols[k];
      if (v == null || v === '' || v === -1) continue;
      const n = typeof v === 'number' ? v : parseInt(v, 10);
      if (!Number.isInteger(n) || n < 0 || n >= W) { problems.push('Coluna "' + k + '" aponta para índice inexistente (' + v + ').'); continue; }
      cols[k] = n;
    }
    if (cols.date == null) problems.push('Falta a coluna de data.');
    if (cols.description == null) problems.push('Falta a coluna de descrição.');
    if (cols.amount == null && (cols.debit == null || cols.credit == null)) {
      if (cols.debit == null && cols.credit == null) problems.push('Falta a coluna de valor (ou débito/crédito).');
    }
    let signConvention = obj.signConvention;
    const validSign = ['negative_is_expense', 'positive_is_expense', 'dc_flag', 'split_columns'];
    if (!validSign.includes(signConvention)) {
      if (signConvention != null) problems.push('signConvention inválida: ' + signConvention);
      signConvention = cols.debit != null || cols.credit != null ? 'split_columns' : cols.dcFlag != null ? 'dc_flag' : (a.signConvention || 'negative_is_expense');
    }
    if (signConvention === 'dc_flag' && cols.dcFlag == null) problems.push('signConvention "dc_flag" exige a coluna dcFlag.');
    if (signConvention === 'split_columns' && cols.debit == null && cols.credit == null) problems.push('signConvention "split_columns" exige colunas de débito/crédito.');
    let numberFormat = obj.numberFormat;
    if (numberFormat !== 'br' && numberFormat !== 'us') { if (numberFormat != null) problems.push('numberFormat inválido: ' + numberFormat); numberFormat = a.numberFormat || 'br'; }
    let dateFormat = typeof obj.dateFormat === 'string' && obj.dateFormat ? obj.dateFormat : (a.dateFormat || 'DD/MM/YYYY');
    let headerRowIndex = obj.headerRowIndex == null ? null : parseInt(obj.headerRowIndex, 10);
    if (headerRowIndex != null && (!Number.isInteger(headerRowIndex) || headerRowIndex < 0 || headerRowIndex >= (a.rows || []).length)) { problems.push('headerRowIndex inválido.'); headerRowIndex = null; }
    let skipTop = obj.skipTop == null ? null : parseInt(obj.skipTop, 10);
    if (skipTop == null || !Number.isInteger(skipTop) || skipTop < 0) skipTop = headerRowIndex != null ? headerRowIndex + 1 : (a.dataStart || 0);
    const overrides = { headerRowIndex, skipTop, dateFormat, numberFormat, signConvention, columns: Object.assign({ date: null, description: null, amount: null, debit: null, credit: null, dcFlag: null, installment: null, balance: null }, cols) };
    if (isArr(obj.skipBottomPatterns)) {
      const ok = obj.skipBottomPatterns.filter(p => { try { new RegExp(p); return typeof p === 'string'; } catch (e) { return false; } });
      overrides.skipBottomPatterns = SKIP_PATTERNS.concat(ok);
    }
    const profile = profileFromAnalysis(a, overrides);
    profile.origin = 'ai';
    let parsedRatio = 0;
    if (cols.date != null && (cols.amount != null || cols.debit != null || cols.credit != null)) {
      const rows = a.rows || [];
      const skipRes = compileSkip(profile.skipBottomPatterns);
      const start = Math.max(skipTop, headerRowIndex != null ? headerRowIndex + 1 : 0);
      let cand = 0;
      for (let i = start; i < rows.length; i++) {
        const r = rows[i];
        if (r.filter(Boolean).length < 2) continue;
        if (rowMatchesSkip(r, skipRes, cols.description)) continue;
        cand++;
      }
      const res = applyProfile(rows, profile, { accountId: '_ai_check', importId: '_ai_check' });
      parsedRatio = cand ? res.transactions.length / cand : 0;
      if (parsedRatio < 0.8) problems.push('O perfil só interpretou ' + Math.round(parsedRatio * 100) + '% das linhas de dados (mínimo 80%).');
    }
    return { profile, problems, parsedRatio: round2(parsedRatio) };
  }

  // ---------------------------------------------------------------------------
  const FinEngine = {
    version: '2.0.0',
    decodeBytes, analyzeTable, analyzeRows, profileFromAnalysis, applyProfile, matchProfile,
    parseAmount, detectNumberFormat, parseDate, normalizeDescription,
    DEFAULT_CATEGORIES, DEFAULT_DICTIONARY,
    classify, classifyAll, learnFromCorrection, dedupe, linkCardPayments,
    summarize, buildSankey, monthlySeries, futureInstallments, formatBRL, payslipToTransactions,
    buildAIPrompt, validateAIProfile,
    // v2
    SCHEMA_VERSION, GENERIC_WORDS, kindForCategory, applyCategoryKind, suggestCategories, ambiguousMatch, parseInstallmentText,
    isInstallmentCell, shiftDateMonths, parseTime, payslipSplit, defaultAdvanceDate, guessAccountType, moveImport,
    tombstonesForImport, backfillImports, migrateData, lookupDictionaryEntry: (d, m, r, a) => lookupDictionaryEntry(d || DEFAULT_DICTIONARY, m, r, a),
    // extras (helpers, stable but not part of the contract)
    _internal: { parseDelimited, detectDelimiter, detectDateFormat, norm, stripAccents, hashStr, SKIP_PATTERNS, parseInstallmentText, detectKind }
  };
  root.FinEngine = FinEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = FinEngine;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
