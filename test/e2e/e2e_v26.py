"""End-to-end tests of v2.6 — the Painel window steps by its own length, and every transaction row is editable — in
headless Chromium:
  - period bar: ‹ › move 1 / 3 / 6 / 12 months (the whole window), the label shows the window ("jul–set 2026"), › is
    disabled when the window already ends at the current month and a step past it is clamped; aria labels say
    "3 meses anteriores" / "Próximos 3 meses"; keyboard focus stays on the arrow; the sticky bar on the phone;
  - every row in the Painel sheets is a button: Sankey drill-down, category-chart drill-down, Transferências (rows and
    pairs) → the editor opens ON TOP of the sheet; Salvar / Cancelar / Esc come back to the same sheet (scroll kept) with
    its list and the Painel numbers already updated (no reload);
  - the category chip of each row ("Sem categoria" → tap → picker) with "Lembrar", "+ Nova categoria", "Não sei", Desfazer;
  - projected parcelas (Parcelas futuras) are not editable; the pencil opens the purchase they come from;
  - a tap on a Transações row still opens the editor; a second synced page sees the changes.
All data is SYNTHETIC (made-up companies), dated relative to the current month.

Usage: npm run build:artifact && python3 test/e2e/e2e_v26.py [A] [S] [L]
  A. Artifact build with the fake window.claude (fake claude db) — full flow at 390 light + a second page (1280 dark).
  S. 390 dark / 1280 light / 1280 dark screens (period bar, sticky bar, sheet with chips, stacked editor, picker).
  L. site/ in local mode (real store.js, localStorage): the flow at 390 light, 1280 dark screens.
Screenshots: screens/v26/*.png (gitignored)."""
import sys, os, json, re, time, datetime, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402
import server as site_server  # noqa: E402

PORT = int(os.environ.get('FF_V26_PORT', '8813'))
LPORT = int(os.environ.get('FF_V26_LOCAL_PORT', '8814'))
URL = f'http://127.0.0.1:{PORT}/'
LURL = f'http://127.0.0.1:{LPORT}/'
SCR = os.path.join(ROOT, 'screens', 'v26')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
UID = 'u_e2e_v26'
BASE = f'data/users/{UID}/ff'
RUN = str(int(time.time()))
STAMP = '2026-01-01T12:00:00.000Z'
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
TODAY = datetime.date.today()
NOW = f'{TODAY.year}-{TODAY.month:02d}'


def add_months(ym, k):
    y, m = map(int, ym.split('-'))
    m += k
    while m < 1:
        m += 12; y -= 1
    while m > 12:
        m -= 12; y += 1
    return f'{y}-{m:02d}'


PREV = add_months(NOW, -1)  # the month with the drill-down data


def label(end, n):
    ey, em = map(int, end.split('-'))
    if n == 1:
        return f'{MES[em - 1]} {ey}'
    sy, sm = map(int, add_months(end, -(n - 1)).split('-'))
    return MES3[sm - 1] + (f' {sy}' if sy != ey else '') + '–' + MES3[em - 1] + f' {ey}'


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    (PASSES if cond else FAILS).append(msg)
    return cond


def section(t):
    print('\n== ' + t, flush=True)


def J(pg, expr, arg=None):
    return pg.evaluate(expr, arg) if arg is not None else pg.evaluate(expr)


def wait(pg, js, timeout=8000, arg=None):
    try:
        if arg is None:
            pg.wait_for_function(js, timeout=timeout)
        else:
            pg.wait_for_function(js, arg=arg, timeout=timeout)
        return True
    except Exception:
        return False


def shot(pg, name, full=False):
    pg.wait_for_timeout(250)
    pg.screenshot(path=os.path.join(SCR, name + '.png'), full_page=full)


def no_hscroll(pg, lbl):
    r = J(pg, '() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    check(r[0] <= r[1], f'{lbl}: no horizontal page scroll ({r[0]} <= {r[1]})')


def sheet_no_hscroll(pg, lbl):
    r = J(pg, '() => [...document.querySelectorAll("#sheet-root .sheet")].map(s => [s.scrollWidth, s.clientWidth])')
    check(all(a <= b for a, b in r), f'{lbl}: no horizontal scroll inside the sheet(s) {r}')


# ------------------------------------------------------------------------------------------------ synthetic data
def synthetic():
    txs = []

    def t(key, date, amount, raw, acc, cat=None, src=None, **kw):
        row = {'id': 'v26-' + key, 'date': date, 'amount': amount, 'rawDescription': raw, 'merchant': kw.pop('merchant', raw.upper()[:40]), 'accountId': acc,
               'kind': kw.pop('kind', 'expense' if amount < 0 else 'income'), 'categoryId': cat, 'catSource': src if src else ('manual' if cat else None),
               'importId': 'i-' + acc, 'updatedAt': STAMP}
        row.update(kw)
        txs.append(row)
    # 14 months of salary and groceries → the 3/6/12-month windows have known totals
    for k in range(-13, 1):
        m = add_months(NOW, k)
        t(f'sal{k}', f'{m}-05', 500000 + (13 + k) * 100, 'TED ACME TECNOLOGIA LTDA', 'conta', 'renda.salario')
        t(f'mer{k}', f'{m}-03', -30000, 'MERCADO CENTRAL ZETA', 'conta', 'alimentacao.mercado')
    # last month: twelve rows without a category (long Sankey drill-down list), made-up stores
    for i in range(12):
        t(f'unc{i}', f'{PREV}-{10 + i:02d}', -(1000 + i * 111), f'LOJA FICTICIA {chr(65 + i)}{i} LTDA', 'card')
    # a parcela: projected future parcelas (not editable) + the purchase itself
    t('inst', f'{PREV}-08', -25000, 'CURSO ONLINE QWERTY', 'card', 'educacao.cursos', installment={'n': 3, 'total': 6}, originalDate=f'{add_months(PREV, -2)}-08')
    # transfers: a pair between your two accounts + one to an account outside the app
    t('trout', f'{PREV}-12', -70000, 'Pix enviado - BANCO AZUL FICTICIO', 'conta', kind='transfer', transferAccountId='conta2', linkedTo='v26-trin', kindSource='manual')
    t('trin', f'{PREV}-12', 70000, 'Transferência recebida - BANCO VERDE FICTICIO', 'conta2', kind='transfer', transferAccountId='conta', linkedTo='v26-trout', kindSource='manual')
    t('trext', f'{PREV}-20', -15000, 'Pix enviado para conta propria', 'conta', kind='transfer', transferAccountId='external', kindSource='manual')
    # Transações target
    t('txrow', f'{PREV}-25', -4321, 'PAPELARIA FICTICIA', 'conta')
    meta = {
        'accounts': {'items': [{'id': 'conta', 'name': 'Conta Azul', 'type': 'checking'}, {'id': 'conta2', 'name': 'Conta Verde', 'type': 'checking'},
                               {'id': 'card', 'name': 'Cartão Roxo', 'type': 'credit_card'}]},
        'settings': {'budgets': {}, 'schemaVersion': 3, 'updatedAt': STAMP, 'ownerNamesAsked': True, 'transferReview': {'at': STAMP, 'rows': {}, 'changes': []}},
    }
    return meta, txs


# ------------------------------------------------------------------------------------------------ pages
def post(path, body):
    req = urllib.request.Request(path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def by_month(txs):
    months = {}
    for r in txs:
        months.setdefault(r['date'][:7], []).append(r)
    return months


def seed_artifact(ns, meta, months):
    for name, data in meta.items():
        doc = {'v': 2, 'kind': 'meta', 'name': name, 'data': data, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + name, 'parent': None}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2meta/{name}', 'data': doc})
    for ym, rows in months.items():
        doc = {'v': 2, 'kind': 'month', 'ym': ym, 'transactions': rows, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + ym}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2months/{ym}', 'data': doc})


def db_tx(ns, tid):
    for path, d in artifact_server.docs(ns).items():
        if '/v2months/' in path:
            for r in ((d or {}).get('data') or {}).get('transactions') or []:
                if r.get('id') == tid:
                    return r
    return {}


def new_ctx(b, scheme, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2, has_touch=False)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    ctx.route(re.compile(r'https://cdnjs\.cloudflare\.com/.*'), lambda r: r.fulfill(status=200, body='/* stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    return ctx


def attach(pg):
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))


def open_artifact(b, ns, scheme='light', w=390, h=844):
    ctx = new_ctx(b, scheme, w, h)
    cfg = {'ns': ns, 'uid': UID}
    ctx.add_init_script(FAKE_JS + '\n;(function(c){ window.__saved = [];'
                        ' var f = FakeClaude.createFakeClaude({ backend: FakeClaude.createHttpBackend("/__fakedb", c.ns, 150), userId: c.uid, delayMs: 60, saved: window.__saved });'
                        ' window.claude = Object.freeze({ use: f.claude.use });'
                        '})(' + json.dumps(cfg) + ');')
    pg = ctx.new_page()
    attach(pg)
    pg.goto(URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(400)
    return ctx, pg


def open_local(b, meta, txs, scheme='light', w=390, h=844):
    ctx = new_ctx(b, scheme, w, h)
    pg = ctx.new_page()
    attach(pg)
    pg.goto(LURL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    J(pg, 'async (b) => { await __ff.store().importAll(b); }', {'version': 2, 'meta': meta, 'months': by_month(txs)})
    reload(pg)
    return ctx, pg


def reload(pg):
    pg.reload()
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(500)


def goto_tab(pg, tab):
    pg.click(f'.tab[data-tab="{tab}"]')
    pg.wait_for_timeout(200)


def flushed(pg):
    J(pg, '() => __ff.flush()')
    wait(pg, '() => ["synced", "local"].includes(__ff.store().status)', 8000)
    pg.wait_for_timeout(400)


def row(pg, key):
    return J(pg, '(id) => __ff.live().find(t => t.id === id) || null', 'v26-' + key)


def kpi(pg, name):
    return int(pg.get_attribute(f'#kpi-{name}', 'data-cents'))


def layers(pg):
    return J(pg, '() => document.querySelectorAll("#sheet-root .sheet-layer").length')


def sheet_kind(pg):
    return J(pg, '() => (__ff.state().sheet || {}).kind || null')


def close_all(pg):
    for _ in range(4):
        if not layers(pg):
            break
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)


def lbl_text(pg):
    return pg.inner_text('#period-label .lbl-long')


def set_month1(pg, end):
    """through the UI: range button, then the arrows (never by poking state)"""
    goto_tab(pg, 'painel')
    pg.click('#period-bar [data-act="range"][data-r="1"]'); pg.wait_for_timeout(120)
    for _ in range(40):
        cur = J(pg, '() => __ff.state().ui.month')
        if cur == end:
            return True
        d = -1 if cur > end else 1
        if d == 1 and pg.is_disabled('#period-bar [data-act="month"][data-d="1"]'):
            return False
        pg.click(f'#period-bar [data-act="month"][data-d="{d}"]'); pg.wait_for_timeout(80)
    return False


def set_window(pg, end, n):
    ok = set_month1(pg, end)
    pg.click(f'#period-bar [data-act="range"][data-r="{n}"]'); pg.wait_for_timeout(150)
    return ok


def open_node(pg, nid):
    goto_tab(pg, 'painel')
    pg.locator(f'.sk-node[data-id="{nid}"]').first.click()
    pg.wait_for_selector('#sheet-root .sheet .txr')


# ------------------------------------------------------------------------------------------------ flows
def flow_period(pg, tag):
    section(f'{tag} 1. ‹ › step by the window length; label; clamp at the current month; aria; keyboard')
    goto_tab(pg, 'painel')
    check(J(pg, '() => __ff.state().ui.month') == NOW and J(pg, '() => __ff.state().ui.range') == 1, f'{tag}: starts at the current month, 1 month')
    nxt = '#period-bar [data-act="month"][data-d="1"]'
    prv = '#period-bar [data-act="month"][data-d="-1"]'
    check(pg.is_disabled(nxt), f'{tag}: › disabled at the current month')
    check(pg.get_attribute(prv, 'aria-label') == 'Mês anterior' and pg.get_attribute(nxt, 'aria-label') == 'Próximo mês', f'{tag}: 1-month aria labels')
    pg.click(prv); pg.wait_for_timeout(120)
    check(J(pg, '() => __ff.state().ui.month') == PREV and lbl_text(pg) == label(PREV, 1), f'{tag}: ‹ → 1 month back ({lbl_text(pg)})')
    check(not pg.is_disabled(nxt), f'{tag}: › enabled again')
    pg.click(nxt); pg.wait_for_timeout(120)
    check(J(pg, '() => __ff.state().ui.month') == NOW, f'{tag}: › → back to the current month')
    for n in (3, 6, 12):
        pg.click(f'#period-bar [data-act="range"][data-r="{n}"]'); pg.wait_for_timeout(150)
        check(lbl_text(pg) == label(NOW, n), f'{tag}: {n}m window label "{lbl_text(pg)}" == "{label(NOW, n)}"')
        check(pg.get_attribute(prv, 'aria-label') == f'{n} meses anteriores' and pg.get_attribute(nxt, 'aria-label') == f'Próximos {n} meses', f'{tag}: {n}m aria labels')
        check(pg.is_disabled(nxt), f'{tag}: {n}m › disabled (window ends at the current month)')
        p0 = J(pg, '() => __ff.period()')
        pg.click(prv); pg.wait_for_timeout(150)
        p1 = J(pg, '() => __ff.period()')
        check(p1['end'] == add_months(NOW, -n) and p1['start'] == add_months(p0['start'], -n), f'{tag}: {n}m ‹ moves the whole window ({p0["start"]}..{p0["end"]} → {p1["start"]}..{p1["end"]})')
        check(lbl_text(pg) == label(add_months(NOW, -n), n), f'{tag}: {n}m label after ‹ "{lbl_text(pg)}"')
        # Painel follows the window: income = the salaries inside it
        exp_inc = sum(500000 + (13 + k) * 100 for k in range(-13, 1) if p1['start'] <= add_months(NOW, k) <= p1['end'])
        check(kpi(pg, 'income') == exp_inc, f'{tag}: {n}m Entradas = salaries in the window ({kpi(pg, "income")} == {exp_inc})')
        pg.click(nxt); pg.wait_for_timeout(150)
        check(J(pg, '() => __ff.state().ui.month') == NOW, f'{tag}: {n}m › comes back to the window ending now')
    # clamp: a 3-month window ending 1 month ago → › ends at the current month (not 2 months ahead)
    pg.click('#period-bar [data-act="range"][data-r="1"]'); pg.wait_for_timeout(100)
    pg.click(prv); pg.wait_for_timeout(100)
    pg.click('#period-bar [data-act="range"][data-r="3"]'); pg.wait_for_timeout(120)
    check(J(pg, '() => __ff.period().end') == PREV, f'{tag}: 3m window ending last month')
    pg.click(nxt); pg.wait_for_timeout(120)
    check(J(pg, '() => __ff.period().end') == NOW and lbl_text(pg) == label(NOW, 3), f'{tag}: › clamped at the current month ({lbl_text(pg)})')
    check(pg.is_disabled(nxt), f'{tag}: › disabled after the clamp')
    # keyboard: Enter on ‹ keeps the focus on ‹; the label is announced (aria-live)
    pg.focus(prv); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
    check(J(pg, '() => document.activeElement && document.activeElement.dataset.act === "month" && document.activeElement.dataset.d === "-1"'), f'{tag}: focus stays on ‹ after Enter')
    check(pg.get_attribute('#period-label', 'aria-live') == 'polite', f'{tag}: period label is aria-live')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(120)
    check(J(pg, '() => __ff.period().end') == add_months(NOW, -6), f'{tag}: keyboard steps 3 months too')
    # Sankey / summary / carry-over follow the window
    check(J(pg, '() => __ff.state()._sankey && document.querySelectorAll(".sk-node").length > 0'), f'{tag}: Sankey drawn for the window')
    sticky(pg, tag)
    pg.click('#period-bar [data-act="range"][data-r="1"]'); pg.wait_for_timeout(100)
    J(pg, '() => window.scrollTo(0, 0)')
    while J(pg, '() => __ff.state().ui.month') != PREV:
        cur = J(pg, '() => __ff.state().ui.month')
        pg.click(prv if cur > PREV else nxt); pg.wait_for_timeout(80)


def sticky(pg, tag):
    w = J(pg, '() => window.innerWidth')
    J(pg, '() => window.scrollTo(0, 1400)'); pg.wait_for_timeout(300)
    stuck = J(pg, '() => document.querySelector("#period-bar").classList.contains("stuck")')
    check(stuck, f'{tag}: period bar sticks while scrolling')
    m0 = J(pg, '() => __ff.state().ui.month')
    y0 = J(pg, '() => window.scrollY')
    pg.click('#period-bar [data-act="month"][data-d="-1"]'); pg.wait_for_timeout(300)
    check(J(pg, '() => __ff.state().ui.month') == add_months(m0, -3), f'{tag}: ‹ in the stuck bar steps 3 months')
    st = J(pg, '() => [document.querySelector("#period-bar").classList.contains("stuck"), window.scrollY, document.documentElement.scrollHeight, window.innerHeight]')
    check(st[0] and abs(st[1] - y0) < 400, f'{tag}: still stuck, page did not jump ({y0} → {st})')
    clip = J(pg, '() => { const l = document.querySelector("#period-label"); return [l.scrollWidth, l.clientWidth]; }')
    check(clip[0] <= clip[1] + 1, f'{tag}: window label not cut in the stuck bar {clip}')
    if w < 600:
        # the longest short label: a window across two years
        pg.click('#period-bar [data-act="range"][data-r="12"]'); pg.wait_for_timeout(200)
        J(pg, '() => window.scrollTo(0, 1400)'); pg.wait_for_timeout(250)
        clip = J(pg, '() => { const l = document.querySelector("#period-label"); return [l.scrollWidth, l.clientWidth, l.innerText]; }')
        check(clip[0] <= clip[1] + 1, f'{tag}: 12m (two-year) label not cut either {clip}')
        pg.click('#period-bar [data-act="range"][data-r="3"]'); pg.wait_for_timeout(200)
        J(pg, '() => window.scrollTo(0, 1400)'); pg.wait_for_timeout(250)
        check(pg.is_visible('#period-bar .lbl-short') and pg.inner_text('#period-bar .lbl-short').count('–') == 1, f'{tag}: short window label in the stuck bar ({pg.inner_text("#period-bar .lbl-short")})')
    r = J(pg, '() => { const a = document.querySelector("#period-bar").getBoundingClientRect(); const t = document.querySelector(".topbar").getBoundingClientRect(); return [a.top, t.bottom, a.right, window.innerWidth]; }')
    check(r[0] >= r[1] - 1 and r[2] <= r[3] + 0.5, f'{tag}: stuck bar right under the header, inside the screen {r}')
    no_hscroll(pg, f'{tag} sticky bar')
    shot(pg, f'{tag}-sticky-3m')


def flow_node_sheet(pg, tag):
    section(f'{tag} 2. Sankey drill-down: row → editor on top → Salvar → same sheet, refreshed, scroll kept')
    goto_tab(pg, 'painel')
    check(J(pg, '() => __ff.period().end') == PREV, f'{tag}: last month')
    open_node(pg, 'grp:__none')
    n0 = pg.locator('#sheet-root .txr').count()
    check(n0 == 13, f'{tag}: 13 rows without a category in the block ({n0})')
    check(pg.locator('#sheet-root .txr .catchip.warn').count() == 13 and 'Sem categoria' in pg.inner_text('#sheet-root .txr .catchip >> nth=0'), f'{tag}: each row has a "Sem categoria" chip')
    check(J(pg, '() => [...document.querySelectorAll("#sheet-root .txr .tx")].every(b => b.tagName === "BUTTON" && b.dataset.act === "edittx")'), f'{tag}: rows are buttons (edittx)')
    total0 = int(pg.get_attribute('#node-total', 'data-cents'))
    sheet_no_hscroll(pg, f'{tag} node sheet')
    shot(pg, f'{tag}-node-sheet')
    # scroll the sheet, open a row low in the list
    J(pg, '() => { const s = document.querySelector("#sheet-root .sheet"); s.scrollTop = 260; }')
    sc0 = J(pg, '() => document.querySelector("#sheet-root .sheet").scrollTop')
    target = J(pg, '() => [...document.querySelectorAll("#sheet-root .txr .tx")].map(b => b.dataset.id)[7]')
    t = J(pg, '(id) => __ff.live().find(t => t.id === id)', target)
    inc0, exp0 = kpi(pg, 'income'), kpi(pg, 'expense')
    pg.click(f'#sheet-root .txr .tx[data-id="{target}"]')
    pg.wait_for_selector('#ed-cat')
    check(layers(pg) == 2 and sheet_kind(pg) == 'editor', f'{tag}: editor stacked over the sheet (layers {layers(pg)})')
    check(J(pg, '() => { const l = document.querySelectorAll("#sheet-root .sheet-layer"); return l[0].inert && l[0].getAttribute("aria-hidden") === "true" && !l[1].inert; }'), f'{tag}: the sheet under it is inert')
    z = J(pg, '() => [...document.querySelectorAll("#sheet-root .sheet, #sheet-root .scrim")].map(e => +getComputedStyle(e).zIndex)')
    check(z == sorted(z) and min(z) > 20, f'{tag}: stacking order scrim < sheet < scrim < editor, all above the sticky bar {z}')
    check(J(pg, '() => document.querySelectorAll("#sheet-body").length') == 1 and J(pg, '() => !!document.querySelector("#sheet-root .sheet-layer:last-child #sheet-body")'), f'{tag}: one #sheet-body (the top one)')
    sheet_no_hscroll(pg, f'{tag} stacked editor')
    shot(pg, f'{tag}-editor-stacked')
    # Esc closes only the editor
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check(layers(pg) == 1 and sheet_kind(pg) == 'node', f'{tag}: Esc → back to the sheet')
    check(abs(J(pg, '() => document.querySelector("#sheet-root .sheet").scrollTop') - sc0) <= 2, f'{tag}: scroll kept after Esc')
    check(J(pg, '() => document.activeElement && document.activeElement.dataset.id') == target, f'{tag}: focus back on the row')
    # again, now change the category → Lazer › Jogos, "Lembrar" off
    lz0 = J(pg, '() => (__ff.state()._sankey.byId["grp:lazer"] || { v: 0 }).v')
    pg.click(f'#sheet-root .txr .tx[data-id="{target}"]'); pg.wait_for_selector('#ed-cat')
    pg.select_option('#ed-cat', 'renda.outros')
    check(pg.input_value('#ed-kind') == 'income', f'{tag}: Tipo follows the category')
    pg.select_option('#ed-cat', 'lazer.jogos')
    check(pg.input_value('#ed-kind') == 'expense', f'{tag}: and back')
    pg.uncheck('#ed-remember')
    pg.click('[data-act="savetx"]'); pg.wait_for_timeout(300)
    check(layers(pg) == 1 and sheet_kind(pg) == 'node', f'{tag}: Salvar → back to the same sheet')
    check(pg.locator('#sheet-root .txr').count() == n0 - 1 and pg.locator(f'#sheet-root .txr[data-row="{target}"]').count() == 0, f'{tag}: the row left the block ({pg.locator("#sheet-root .txr").count()})')
    total1 = int(pg.get_attribute('#node-total', 'data-cents'))
    check(total1 == total0 - abs(t['amount']), f'{tag}: block total updated ({total0} → {total1})')
    lz1 = J(pg, '() => (__ff.state()._sankey.byId["grp:lazer"] || { v: 0 }).v')
    check(lz1 == lz0 + abs(t['amount']) and kpi(pg, 'expense') == exp0 and kpi(pg, 'income') == inc0, f'{tag}: Painel Sankey redrawn without reload (Lazer {lz0} → {lz1}), KPIs same')
    check(abs(J(pg, '() => document.querySelector("#sheet-root .sheet").scrollTop') - sc0) <= 2, f'{tag}: scroll kept after Salvar')
    check(row(pg, target[4:])['categoryId'] == 'lazer.jogos', f'{tag}: row saved')
    check(pg.is_visible('#toast-act'), f'{tag}: "Desfazer" in the toast')


def flow_chip(pg, tag):
    section(f'{tag} 3. category chip → picker directly (Lembrar, groups, + Nova categoria, Não sei, Desfazer)')
    check(sheet_kind(pg) == 'node', f'{tag}: still on the Sankey sheet')
    ids = J(pg, '() => [...document.querySelectorAll("#sheet-root .txr .catchip")].map(b => b.dataset.id)')
    a, b2, c = ids[0], ids[1], ids[2]
    n0 = len(ids)
    total0 = int(pg.get_attribute('#node-total', 'data-cents'))
    pg.click(f'#sheet-root .catchip[data-id="{a}"]'); pg.wait_for_selector('#qp-body #qp-groups')
    check(layers(pg) == 2 and sheet_kind(pg) == 'quickcat', f'{tag}: picker stacked over the sheet')
    check(pg.is_visible('#qp-remember') and pg.is_visible('#qp-newcat') and pg.is_visible('#qp-unid'), f'{tag}: Lembrar, + Nova categoria, Não sei')
    sheet_no_hscroll(pg, f'{tag} picker')
    shot(pg, f'{tag}-picker')
    pg.click('#qp-groups [data-g="lazer"]'); pg.wait_for_selector('#qp-cats')
    pg.click('#qp-cats [data-cat="lazer.eventos"]'); pg.wait_for_timeout(300)
    ta = J(pg, '(id) => __ff.live().find(t => t.id === id)', a)
    check(ta['categoryId'] == 'lazer.eventos' and ta['catSource'] == 'manual', f'{tag}: picked Lazer › Eventos')
    check(layers(pg) == 1 and sheet_kind(pg) == 'node' and pg.locator('#sheet-root .txr').count() == n0 - 1, f'{tag}: back to the sheet, row gone from "Sem categoria"')
    check(int(pg.get_attribute('#node-total', 'data-cents')) == total0 - abs(ta['amount']), f'{tag}: block total updated')
    check(J(pg, '() => __ff.D().rules.some(r => r.set && r.set.categoryId === "lazer.eventos")'), f'{tag}: "Lembrar" (default on) learned a rule')
    # Desfazer → the row is back in the open sheet
    pg.click('#toast-act'); pg.wait_for_timeout(300)
    check(row(pg, a[4:])['categoryId'] is None and pg.locator(f'#sheet-root .txr[data-row="{a}"]').count() == 1, f'{tag}: Desfazer → row back in the sheet')
    check(not J(pg, '() => __ff.D().rules.some(r => r.set && r.set.categoryId === "lazer.eventos")'), f'{tag}: Desfazer removed the rule')
    # + Nova categoria from the picker
    pg.click(f'#sheet-root .catchip[data-id="{b2}"]'); pg.wait_for_selector('#qp-newcat')
    pg.uncheck('#qp-remember')
    pg.click('#qp-newcat'); pg.wait_for_selector('#qp-nc-name')
    pg.select_option('#qp-nc-group', 'lazer'); pg.fill('#qp-nc-name', 'Hobby v26')
    pg.click('[data-act="nc-save"][data-p="qp"]'); pg.wait_for_timeout(300)
    tb = J(pg, '(id) => __ff.live().find(t => t.id === id)', b2)
    check(tb['categoryId'] == 'lazer.hobby_v26' and layers(pg) == 1, f'{tag}: + Nova categoria → created and applied ({tb["categoryId"]})')
    check(not J(pg, '() => __ff.D().rules.some(r => r.set && r.set.categoryId === "lazer.hobby_v26")'), f'{tag}: Lembrar unticked → no rule')
    # Não sei
    pg.click(f'#sheet-root .catchip[data-id="{c}"]'); pg.wait_for_selector('#qp-unid')
    pg.click('#qp-unid'); pg.wait_for_timeout(300)
    check(row(pg, c[4:])['categoryId'] == 'outros.nao_identificado' and layers(pg) == 1, f'{tag}: Não sei → Não identificado, back to the sheet')
    # "Mais opções" → the full editor, still on top of the sheet
    d = J(pg, '() => document.querySelector("#sheet-root .txr .catchip").dataset.id')
    pg.click(f'#sheet-root .catchip[data-id="{d}"]'); pg.wait_for_selector('#qp-more')
    pg.click('#qp-more'); pg.wait_for_selector('#ed-kind')
    check(layers(pg) == 2 and sheet_kind(pg) == 'editor', f'{tag}: Mais opções → editor on top of the sheet')
    pg.click('#sheet-root .sheet-layer:last-child [data-act="closesheet"].btn'); pg.wait_for_timeout(200)
    check(layers(pg) == 1 and sheet_kind(pg) == 'node', f'{tag}: Cancelar → back to the sheet')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check(layers(pg) == 0, f'{tag}: Esc on the sheet closes it')


def flow_cc_sheet(pg, tag):
    section(f'{tag} 4. category-chart drill-down: chip → picker → sheet + chart update')
    goto_tab(pg, 'painel')
    pg.locator('#catchart-card').scroll_into_view_if_needed()
    i = J(pg, '(ym) => __ff.state()._cc.data.periods.findIndex(p => p.key === ym)', PREV)
    check(i >= 0, f'{tag}: last month is in the chart (index {i})')
    pg.locator(f'#cc-chart .cc-seg[data-s="__none"][data-p="{i}"]').first.click()
    pg.wait_for_selector('#sheet-root .txr')
    v0 = int(pg.get_attribute('#cc-sheet-total', 'data-cents'))
    n0 = pg.locator('#sheet-root .txr').count()
    check(n0 >= 5 and pg.locator('#sheet-root .txr .catchip.warn').count() == n0, f'{tag}: "Sem categoria" bar → {n0} rows with chips')
    first = J(pg, '() => document.querySelector("#sheet-root .txr .catchip").dataset.id')
    amt = abs(row(pg, first[4:])['amount'])
    pg.click(f'#sheet-root .catchip[data-id="{first}"]'); pg.wait_for_selector('#qp-groups')
    pg.uncheck('#qp-remember')
    pg.click('#qp-groups [data-g="alimentacao"]'); pg.click('#qp-cats [data-cat="alimentacao.mercado"]'); pg.wait_for_timeout(300)
    check(sheet_kind(pg) == 'cc' and pg.locator('#sheet-root .txr').count() == n0 - 1, f'{tag}: back to the chart sheet, row gone')
    check(int(pg.get_attribute('#cc-sheet-total', 'data-cents')) == v0 - amt, f'{tag}: sheet total updated ({v0} → {pg.get_attribute("#cc-sheet-total", "data-cents")})')
    none_v = J(pg, '(i) => { const s = __ff.state()._cc.data.series.find(x => x.id === "__none"); return s ? s.values[i] : 0; }', i)
    check(none_v == v0 - amt, f'{tag}: the chart under it was redrawn ({none_v})')
    # row → editor on top → Salvar
    second = J(pg, '() => document.querySelector("#sheet-root .txr .tx").dataset.id')
    pg.click(f'#sheet-root .txr .tx[data-id="{second}"]'); pg.wait_for_selector('#ed-cat')
    check(layers(pg) == 2, f'{tag}: editor on top of the chart sheet')
    pg.select_option('#ed-cat', 'compras.casa'); pg.uncheck('#ed-remember'); pg.click('[data-act="savetx"]'); pg.wait_for_timeout(300)
    check(sheet_kind(pg) == 'cc' and pg.locator('#sheet-root .txr').count() == n0 - 2, f'{tag}: Salvar → back to the chart sheet, updated')
    close_all(pg)


def flow_transfers(pg, tag):
    section(f'{tag} 5. Transferências: rows and pairs open the editor on top; the sheet updates')
    goto_tab(pg, 'painel')
    pg.click('#pn-tr'); pg.wait_for_selector('#tr-body #tr-sum')
    tot0 = int(pg.get_attribute('#tr-total', 'data-cents'))
    exp0 = kpi(pg, 'expense')
    check(J(pg, '() => [...document.querySelectorAll("#tr-body .tr-pair, #tr-body .tr-row")].every(e => e.tagName === "BUTTON" && e.dataset.act === "edittx")'), f'{tag}: transfer rows and pairs are buttons')
    pg.click('#tr-body .tr-pair[data-out="v26-trout"]'); pg.wait_for_selector('#ed-kind')
    check(layers(pg) == 2 and pg.input_value('#ed-kind') == 'transfer', f'{tag}: pair → editor (transfer) on top')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check(sheet_kind(pg) == 'transfers', f'{tag}: Esc → back to Transferências')
    pg.locator('#tr-ext summary').first.click(); pg.wait_for_timeout(100)
    pg.click('#tr-ext .tr-row[data-id="v26-trext"]'); pg.wait_for_selector('#ed-kind')
    pg.select_option('#ed-kind', 'expense'); pg.select_option('#ed-cat', 'lazer.viagem'); pg.uncheck('#ed-remember')
    pg.click('[data-act="savetx"]'); pg.wait_for_timeout(300)
    check(sheet_kind(pg) == 'transfers' and pg.locator('#tr-body [data-id="v26-trext"]').count() == 0, f'{tag}: Salvar → back to Transferências, row gone')
    check(row(pg, 'trext')['kind'] == 'expense' and row(pg, 'trext')['categoryId'] == 'lazer.viagem', f'{tag}: now a Lazer › Viagem expense')
    check(int(pg.get_attribute('#tr-total', 'data-cents')) == tot0 - 15000, f'{tag}: "Entre suas contas" updated: only the pair is left ({tot0} → {pg.get_attribute("#tr-total", "data-cents")})')
    check(kpi(pg, 'expense') == exp0 + 15000, f'{tag}: Painel Saídas went up by it, without reload ({exp0} → {kpi(pg, "expense")})')
    sheet_no_hscroll(pg, f'{tag} transfers')
    close_all(pg)


def flow_future_and_tx(pg, tag):
    section(f'{tag} 6. Parcelas futuras: projected rows not editable; Transações row tap')
    goto_tab(pg, 'painel')
    pg.locator('#future-card').scroll_into_view_if_needed()
    pg.locator('#future-card details summary').first.click(); pg.wait_for_timeout(100)
    it = pg.locator('#future-card .fut-item').first
    check(it.get_attribute('data-projected') == '1' and it.get_attribute('data-act') is None and 'prevista' in it.inner_text(), f'{tag}: projected parcela marked "prevista", no action')
    check(J(pg, '() => [...document.querySelectorAll("#future-card .fut-item")].every(e => !e.matches("button, [role=button], [tabindex]") && !e.querySelector("[data-act]:not(.fut-src)"))'), f'{tag}: nothing in a projected row is interactive but the pencil')
    it.locator('.grow').click(); pg.wait_for_timeout(200)
    check(layers(pg) == 0, f'{tag}: tapping a projected parcela opens nothing')
    pg.locator('#future-card .fut-src').first.click(); pg.wait_for_selector('#ed-cat')
    check(J(pg, '() => __ff.state().sheet.id') == 'v26-inst' and layers(pg) == 1, f'{tag}: the pencil opens the purchase (last imported parcela)')
    shot(pg, f'{tag}-future-editor')
    close_all(pg)
    goto_tab(pg, 'tx')
    pg.fill('#tx-search', 'PAPELARIA'); pg.wait_for_timeout(300)
    pg.click('#tx-list .tx[data-id="v26-txrow"]'); pg.wait_for_selector('#ed-cat')
    check(layers(pg) == 1, f'{tag}: Transações row → editor (not stacked)')
    pg.select_option('#ed-cat', 'educacao.livros'); pg.uncheck('#ed-remember'); pg.click('[data-act="savetx"]'); pg.wait_for_timeout(250)
    check(layers(pg) == 0 and row(pg, 'txrow')['categoryId'] == 'educacao.livros', f'{tag}: saved and closed')
    J(pg, '() => { __ff.state().ui.q = ""; }'); pg.fill('#tx-search', '')
    goto_tab(pg, 'painel')
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')


def flow_second_page(b, ns, A):
    section('A 7. a second page (1280 dark) sees the changes; a chip change on A arrives without reload')
    flushed(A)
    cb, B = open_artifact(b, ns, 'dark', 1280, 900)
    check(J(B, '() => __ff.live().find(t => t.id === "v26-txrow").categoryId') == 'educacao.livros', 'B: Transações change is there')
    check(J(B, '() => __ff.live().find(t => t.id === "v26-trext").categoryId') == 'lazer.viagem', 'B: transfer → expense is there')
    # A: one more change through the chip, while B shows the same Sankey sheet
    for pg in (A, B):
        goto_tab(pg, 'painel')
        set_window(pg, PREV, 1)
    open_node(B, 'grp:__none')
    nb = B.locator('#sheet-root .txr').count()
    open_node(A, 'grp:__none')
    x = J(A, '() => document.querySelector("#sheet-root .txr .catchip").dataset.id')
    A.click(f'#sheet-root .catchip[data-id="{x}"]'); A.wait_for_selector('#qp-groups')
    A.uncheck('#qp-remember')
    A.click('#qp-groups [data-g="saude"]'); A.click('#qp-cats [data-cat="saude.farmacia"]'); A.wait_for_timeout(200)
    flushed(A)
    check(db_tx(ns, x).get('categoryId') == 'saude.farmacia', 'A: saved to the db')
    J(B, '() => window.dispatchEvent(new Event("focus"))')
    ok = wait(B, '(id) => (__ff.live().find(t => t.id === id) || {}).categoryId === "saude.farmacia"', 25000, x)
    check(ok, 'B: the change arrives (sync)')
    B.wait_for_timeout(300)
    check(B.locator('#sheet-root .txr').count() == nb - 1 and B.locator(f'#sheet-root .txr[data-row="{x}"]').count() == 0, f'B: its open sheet refreshed ({nb} → {B.locator("#sheet-root .txr").count()})')
    shot(B, 'art-1280-dark-B-node-sheet')
    check(not B._errs, f'B: no console errors {B._errs[:3]}')
    cb.close()
    close_all(A)


def screens(pg, tag):
    goto_tab(pg, 'painel')
    set_window(pg, PREV, 3)
    check(lbl_text(pg) == label(PREV, 3), f'{tag}: 3m label {lbl_text(pg)}')
    no_hscroll(pg, f'{tag} painel 3m')
    shot(pg, f'{tag}-painel-3m')
    sticky(pg, tag)
    J(pg, '() => window.scrollTo(0, 0)')
    set_window(pg, PREV, 1)
    open_node(pg, 'grp:__none')
    sheet_no_hscroll(pg, f'{tag} node sheet')
    shot(pg, f'{tag}-node-sheet')
    tid = J(pg, '() => document.querySelector("#sheet-root .txr .tx").dataset.id')
    pg.click(f'#sheet-root .txr .tx[data-id="{tid}"]'); pg.wait_for_selector('#ed-cat')
    no_hscroll(pg, f'{tag} stacked editor'); sheet_no_hscroll(pg, f'{tag} stacked editor')
    shot(pg, f'{tag}-editor-stacked')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.click(f'#sheet-root .catchip[data-id="{tid}"]'); pg.wait_for_selector('#qp-groups')
    sheet_no_hscroll(pg, f'{tag} picker')
    shot(pg, f'{tag}-picker')
    pg.click('#qp-groups [data-g="lazer"]'); pg.wait_for_selector('#qp-cats')
    shot(pg, f'{tag}-picker-group')
    close_all(pg)
    pg.click('#pn-tr'); pg.wait_for_selector('#tr-body #tr-sum')
    shot(pg, f'{tag}-transfers')
    close_all(pg)
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')


# ------------------------------------------------------------------------------------------------ scenarios
def full_flow(pg, tag):
    flow_period(pg, tag)
    flow_node_sheet(pg, tag)
    flow_chip(pg, tag)
    flow_cc_sheet(pg, tag)
    flow_transfers(pg, tag)
    flow_future_and_tx(pg, tag)


def scenario_artifact(b):
    section('A. Artifact build (fake claude.ai db), synthetic data, 390 light')
    meta, txs = synthetic()
    ns = 'v26a' + RUN
    seed_artifact(ns, meta, by_month(txs))
    ctx, pg = open_artifact(b, ns)
    check(J(pg, '() => __ff.state().auth.mode') == 'artifact', 'artifact mode')
    full_flow(pg, 'art-390-light')
    flow_second_page(b, ns, pg)
    reload(pg)
    check(row(pg, 'trext')['categoryId'] == 'lazer.viagem' and row(pg, 'txrow')['categoryId'] == 'educacao.livros', 'A after reload: changes persisted')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()


def scenario_screens(b):
    meta, txs = synthetic()
    for (w, scheme) in ((390, 'dark'), (1280, 'light'), (1280, 'dark')):
        tag = f'art-{w}-{scheme}'
        section(tag)
        ns = f'v26s{w}{scheme}' + RUN
        seed_artifact(ns, meta, by_month(txs))
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        screens(pg, tag)
        ctx.close()


def scenario_local(b):
    section('L. site/ in local mode (real store.js, localStorage), synthetic data, 390 light')
    meta, txs = synthetic()
    ctx, pg = open_local(b, meta, txs)
    check(J(pg, '() => __ff.state().auth.mode') == 'local', 'local mode')
    tag = 'loc-390-light'
    full_flow(pg, tag)
    flushed(pg)
    reload(pg)
    check(row(pg, 'trext')['categoryId'] == 'lazer.viagem' and row(pg, 'txrow')['categoryId'] == 'educacao.livros', f'{tag}: after reload everything persisted')
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')
    ctx.close()
    section('L. local mode 1280 dark screens')
    ctx, pg = open_local(b, meta, txs, 'dark', 1280, 900)
    screens(pg, 'loc-1280-dark')
    ctx.close()


def main():
    srv = artifact_server.start(PORT)
    lsrv = site_server.start(LPORT)
    only = sys.argv[1:] or ['A', 'S', 'L']
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            if 'A' in only:
                scenario_artifact(b)
            if 'S' in only:
                scenario_screens(b)
            if 'L' in only:
                scenario_local(b)
        finally:
            b.close()
    srv.shutdown()
    lsrv.shutdown()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
