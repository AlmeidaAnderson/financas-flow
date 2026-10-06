#!/usr/bin/env python3
"""Independent reference reader for the corpus harness (test/corpus/corpus.test.js).

It does NOT share code with the app: plain csv/openpyxl/pdfplumber reading keyed on the header row of each file, so the
app's detection can be checked against a second opinion. Signs follow the app's convention (money out < 0; on a card
bill purchases < 0, payments/credits > 0). Prints one JSON object {relative path: result} to stdout. Nothing about the
files is stored. Usage: python3 test/corpus/reference.py <folder>

result = { format, count, net (cents), from, to, balance: {checked, breaks} | null, statement: {...} | null, skipped }
"""
import csv, io, json, os, re, sys, zipfile
from datetime import date

def cents(s):
    """'R$ 1.234,56' / '-1234.56' / '- 99,99' / '1,234.56' / 12.5 → int cents"""
    if isinstance(s, (int, float)):
        return int(round(s * 100))
    t = str(s).strip().replace('R$', '').replace(' ', ' ').replace(' ', '')
    neg = t.startswith('-') or t.startswith('(') or t.endswith('-')
    t = t.strip('-+()')
    if re.search(r',\d{1,2}$', t):
        t = t.replace('.', '').replace(',', '.')
    else:
        t = t.replace(',', '')
    v = int(round(float(t) * 100))
    return -v if neg else v

def iso(d):
    d = d.strip()
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', d)
    if m: return '%s-%s-%s' % m.groups()
    m = re.match(r'^(\d{2})[/-](\d{2})[/-](\d{2,4})', d)
    if m:
        y = m.group(3); y = ('20' + y) if len(y) == 2 else y
        return '%s-%s-%s' % (y, m.group(2), m.group(1))
    return None

def result(fmt, rows, balance=None, statement=None, skipped=0):
    ds = sorted(r[0] for r in rows)
    return {'format': fmt, 'count': len(rows), 'net': sum(r[1] for r in rows), 'from': ds[0] if ds else None, 'to': ds[-1] if ds else None,
            'balance': balance, 'statement': statement, 'skipped': skipped}

def continuity(seq):
    """seq = [(amount, balance_after)] in chronological order → number of breaks (balance_i != balance_{i-1} + amount_i)"""
    breaks = 0
    for i in range(1, len(seq)):
        if abs(seq[i - 1][1] + seq[i][0] - seq[i][1]) > 1:
            breaks += 1
    return {'checked': max(0, len(seq) - 1), 'breaks': breaks}

def text_of(b):
    for enc in ('utf-8-sig', 'cp1252'):
        try: return b.decode(enc)
        except UnicodeDecodeError: pass
    return b.decode('latin-1')

def read_csv_bytes(b):
    txt = text_of(b)
    lines = txt.splitlines()
    head = '\n'.join(lines[:12])
    delim = ';' if head.count(';') > head.count(',') else ','
    return list(csv.reader(io.StringIO(txt), delimiter=delim))

def ref_csv(b):
    rows = [r for r in read_csv_bytes(b)]
    hdr_i = next((i for i, r in enumerate(rows) if r and any(c.strip().lower() in ('date', 'data', 'release_date') for c in r)), None)
    if hdr_i is None:
        return {'format': 'unknown', 'count': 0, 'net': 0}
    h = [c.strip() for c in rows[hdr_i]]
    body = [r for r in rows[hdr_i + 1:] if any(c.strip() for c in r)]
    H = {c: i for i, c in enumerate(h)}
    if 'RELEASE_DATE' in H:  # summary table above + release table with partial balance
        out, seq = [], []
        for r in body:
            out.append((iso(r[H['RELEASE_DATE']]), cents(r[H['TRANSACTION_NET_AMOUNT']])))
            seq.append((out[-1][1], cents(r[H['PARTIAL_BALANCE']])))
        summ = rows[hdr_i - 2] if hdr_i >= 2 else None
        st = None
        if summ and len(summ) >= 4:
            ini, cr, de, fin = [cents(x) for x in summ[:4]]
            st = {'initial_plus_rows_eq_final': abs(ini + sum(o[1] for o in out) - fin) <= 1,
                  'first_balance_ok': bool(seq) and abs(ini + seq[0][0] - seq[0][1]) <= 1}
        return result('release-table', out, continuity(seq), st)
    if 'Identificador' in H:  # account csv, dot decimals
        out = [(iso(r[H['Data']]), cents(r[H['Valor']])) for r in body]
        return result('data-valor-id', out)
    if h[:3] == ['date', 'title', 'amount']:  # card csv: positive = purchase
        out = [(iso(r[0]), -cents(r[2])) for r in body]
        return result('card-date-title-amount', out)
    if 'Running Balance' in H:  # multi-column wallet statement, newest first
        out, seq = [], []
        for r in body:
            out.append((iso(r[H['Date']]), cents(r[H['Amount']])))
            seq.append((cents(r[H['Amount']]), cents(r[H['Running Balance']])))
        seq.reverse()
        cur = body[0][H['Currency']] if body else None
        return result('wallet-running-balance', out, continuity(seq), {'currency': cur})
    if 'Saldo' in H and 'Valor' in H:  # account with balance
        out, seq = [], []
        for r in body:
            out.append((iso(r[H['Data']]), cents(r[H['Valor']])))
            seq.append((out[-1][1], cents(r[H['Saldo']])))
        # file may be newest first
        if len(seq) > 1 and continuity(seq)['breaks'] > continuity(seq[::-1])['breaks']:
            seq = seq[::-1]
        return result('account-saldo', out, continuity(seq))
    if 'Estabelecimento' in H:  # card bill: positive = purchase, negative = payment/credit
        out = [(iso(r[H['Data']]), -cents(r[H['Valor']])) for r in body]
        return result('card-estabelecimento', out)
    return {'format': 'unknown-header', 'count': 0, 'net': 0}

def ref_xlsx(path_or_bytes):
    import openpyxl
    wb = openpyxl.load_workbook(path_or_bytes if isinstance(path_or_bytes, str) else io.BytesIO(path_or_bytes), data_only=True)
    ws = wb.worksheets[0]
    hdr = None; out = []; daily = []; day_sum = {}; skipped = 0
    for r in ws.iter_rows(values_only=True):
        cells = ['' if c is None else str(c).strip() for c in r]
        if 'Data e hora' in cells:
            hdr = {c: i for i, c in enumerate(cells) if c}
            continue
        if not hdr: continue
        d = cells[hdr['Data e hora']]
        if not re.match(r'^\d{2}/\d{2}/\d{4}', d):
            continue
        v = cents(r[hdr['Valor']]) if r[hdr['Valor']] not in (None, '') else None
        if v is None: continue
        dt = iso(d)
        if cells[hdr['Descrição']].lower().startswith('saldo di'):
            daily.append((dt, v)); skipped += 1
            continue
        out.append((dt, v)); day_sum[dt] = day_sum.get(dt, 0) + v
    # daily balance continuity: balance(day) = balance(previous listed day) + rows of that day
    daily.sort()
    # small positive gaps = yield credited to the balance without a row of its own (≤ 0.1 % of the balance)
    breaks = small = 0
    for i in range(1, len(daily)):
        gap = daily[i][1] - (daily[i - 1][1] + day_sum.get(daily[i][0], 0))
        if abs(gap) <= 1: continue
        if 0 < gap <= max(100, abs(daily[i][1]) // 1000): small += 1
        else: breaks += 1
    return result('xlsx-daily-balance', out, {'checked': max(0, len(daily) - 1), 'breaks': breaks, 'unlisted_yield_days': small}, skipped=skipped)

def ref_pdf(path):
    import pdfplumber
    with pdfplumber.open(path) as p:
        text = '\n'.join((pg.extract_text() or '') for pg in p.pages)
    flat = text.replace(' ', '')
    if re.search(r'Saldototal', flat):  # benefit wallet: one row per "+R$"/"-R$" amount, balance on top
        rows = [(None, cents(m.group(1) + m.group(2))) for m in re.finditer(r'([+-])R\$([\d.]+,\d{2})', flat)]
        bal = re.search(r'Saldototal\s*R\$([\d.]+,\d{2})', flat)
        r = result('wallet-pdf', [(d or '', a) for d, a in rows])
        r['statement'] = {'printed_balance': cents(bal.group(1)) if bal else None}
        return r
    # card bill: printed totals of the summary
    def grab(label):
        m = re.search(label + r'\s*R\$\s*([\d.]+,\d{2})', text)
        return cents(m.group(1)) if m else None
    tot = None
    for m in re.finditer(r'(?m)^Total\s+R\$\s*([\d.]+,\d{2})\s*$', text):
        tot = cents(m.group(1)); break
    return {'format': 'card-pdf', 'statement': {'total': tot, 'credits': grab(r'Pagamentos e créditos devolvidos'), 'previous': grab(r'Total da fatura de \w+')}}

def main(root):
    res = {}
    for dp, dn, fn in os.walk(root):
        dn.sort()
        for n in sorted(fn):
            p = os.path.join(dp, n); rel = os.path.relpath(p, root); low = n.lower()
            try:
                if low.endswith('.csv'): res[rel] = ref_csv(open(p, 'rb').read())
                elif low.endswith('.xlsx'): res[rel] = ref_xlsx(p)
                elif low.endswith('.pdf'): res[rel] = ref_pdf(p)
                elif low.endswith('.zip'):
                    with zipfile.ZipFile(p) as z:
                        for zi in z.infolist():
                            if zi.filename.lower().endswith('.csv'):
                                res[rel + ' > ' + os.path.basename(zi.filename)] = ref_csv(z.read(zi))
            except Exception as e:  # report, never crash the harness
                res[rel] = {'format': 'error', 'error': type(e).__name__ + ': ' + str(e)[:80]}
    json.dump(res, sys.stdout)

if __name__ == '__main__':
    main(sys.argv[1])
