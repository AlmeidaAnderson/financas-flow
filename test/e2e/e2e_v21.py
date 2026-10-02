"""End-to-end tests of the v2.1 features (Google/CNPJ help, per-purchase memory for parcelas, deficit carry-over,
"Lembrar" defaults, Saúde dos dados) in headless Chromium.

Usage: npm run build:artifact && python3 test/e2e/e2e_v21.py
  A. Artifact build (dist-artifact/financas-flow.html) with the fake window.claude (test/fake-claude.js) and a SYNTHETIC
     dataset seeded into the fake db: every feature, 390px light; screenshots at 390/1280 × light/dark.
  B. Netlify build (site/) on test/e2e/netlify_harness.mjs (CSP from netlify.toml, real api-core, test-only fake
     Identity and a test-only stand-in for BrasilAPI): "Consultar CNPJ" → activity + category chip, no CSP violations.
  C. The user's REAL artifact data (read-only snapshot, FF_REAL_ARTIFACT_DB; skipped when absent) loaded at runtime
     through the fake db: the data-health checks run without throwing and flag the bank extrato inside the card account.
     Nothing of it is written to the repo; no screenshots of it are taken; only warning ids/titles are printed, with
     names masked.
Screenshots: screens/v21/*.png (gitignored)."""
import sys, os, json, re, time, subprocess, glob, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402

PORT = int(os.environ.get('FF_V21_PORT', '8791'))
HPORT = int(os.environ.get('FF_V21_HARNESS_PORT', '8792'))
URL = f'http://127.0.0.1:{PORT}/'
HURL = f'http://127.0.0.1:{HPORT}/'
SCR = os.path.join(ROOT, 'screens', 'v21')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
FAKE_ID = open(os.path.join(HERE, 'fake_identity.mjs'), encoding='utf-8').read()
REAL_DB = os.environ.get('FF_REAL_ARTIFACT_DB', '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db2/data/users/me/ff')
UID = 'u_e2e_v21'
BASE = f'data/users/{UID}/ff'
RUN = str(int(time.time()))
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
PAGES = []
CSP_HOOK = """window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));"""


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    (PASSES if cond else FAILS).append(msg)
    return cond


def section(t):
    print('\n== ' + t, flush=True)


def J(pg, expr, arg=None):
    return pg.evaluate(expr, arg) if arg is not None else pg.evaluate(expr)


def wait(pg, js, timeout=8000):
    try:
        pg.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


def shot(pg, name, full=False):
    pg.wait_for_timeout(250)
    pg.screenshot(path=os.path.join(SCR, name + '.png'), full_page=full)


def no_hscroll(pg, label):
    r = J(pg, '() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    check(r[0] <= r[1], f'{label}: no horizontal scroll ({r[0]} <= {r[1]})')


# ------------------------------------------------------------------------------------------------ synthetic data
STAMP = '2026-10-01T12:00:00.000Z'


def shift(iso, k):
    y, m, d = map(int, iso.split('-'))
    m += k
    while m > 12:
        m -= 12; y += 1
    import calendar
    d = min(d, calendar.monthrange(y, m)[1])
    return f'{y}-{m:02d}-{d:02d}'


def synthetic():
    txs = []
    n = [0]

    def t(date, amount, raw, acc, imp, **kw):
        n[0] += 1
        row = {'id': f'v21-{n[0]}', 'date': date, 'amount': amount, 'rawDescription': raw, 'merchant': '', 'accountId': acc,
               'kind': kw.pop('kind', 'expense' if amount < 0 else 'income'), 'categoryId': None, 'catSource': None, 'importId': imp, 'updatedAt': STAMP}
        row.update(kw)
        txs.append(row)
        return row

    def parc(start, n_, total, amount, raw, imp):
        return t(shift(start, n_ - 1), amount, raw, 'cartao', imp, installment={'n': n_, 'total': total}, **({'originalDate': start} if n_ > 1 else {}))

    # card faturas: July (28/06–27/07) and August (28/07–27/08)
    jul = [parc('2026-05-10', 3, 10, -15000, 'MERCADOLIVRE*LOJAXYZ', 'imp-fjul'), parc('2026-06-15', 2, 5, -8990, 'MERCADOLIVRE*LOJAXYZ', 'imp-fjul'),
           t('2026-06-28', -2500, 'PADARIA PAO QUENTE', 'cartao', 'imp-fjul'),
           t('2026-07-02', -5490, 'JOSE FARMA LTDA 11.222.333/0001-81', 'cartao', 'imp-fjul'),
           t('2026-07-03', -1290, 'CASA DA DONA CIDA SAO PAULO BR', 'cartao', 'imp-fjul'),
           t('2026-07-12', -12990, 'AMAZON MARKETPLACE', 'cartao', 'imp-fjul'),
           t('2026-07-12', -5590, 'NETFLIX.COM', 'cartao', 'imp-fjul'),
           t('2026-07-18', -600000, 'KABUM COMERCIO', 'cartao', 'imp-fjul'),
           t('2026-07-26', -1990, 'CASA DA DONA CIDA SAO PAULO BR', 'cartao', 'imp-fjul')]
    aug = [parc('2026-05-10', 4, 10, -15000, 'MERCADOLIVRE*LOJAXYZ', 'imp-faug'), parc('2026-06-15', 3, 5, -8990, 'MERCADOLIVRE*LOJAXYZ', 'imp-faug'),
           t('2026-07-28', -3000, 'PADARIA PAO QUENTE', 'cartao', 'imp-faug'),
           t('2026-08-12', -5590, 'NETFLIX.COM', 'cartao', 'imp-faug'),
           t('2026-08-20', -8000, 'RESTAURANTE BOM PRATO', 'cartao', 'imp-faug')]
    tot_jul = -sum(x['amount'] for x in jul)
    tot_aug = -sum(x['amount'] for x in aug)
    # bank extrato 01/07–30/09 with running balance, time and row order
    bank = [('2026-07-01', 5, 'RENDIMENTO AUTOMATICO'), ('2026-07-05', 500000, 'TED RECEBIDA SALARIO ACME TECNOLOGIA'),
            ('2026-07-06', -77700, 'PAGAMENTO DE FATURA'), ('2026-07-10', -300000, 'ALUGUEL APTO 12'),
            ('2026-07-20', 100000, 'Pix recebido de Maria Exemplo da Silva'), ('2026-07-31', 7, 'RENDIMENTO AUTOMATICO'),
            ('2026-08-05', 500000, 'TED RECEBIDA SALARIO ACME TECNOLOGIA'), ('2026-08-06', -tot_jul, 'PAGAMENTO DE FATURA'),
            ('2026-08-10', -300000, 'ALUGUEL APTO 12'), ('2026-08-20', 80000, 'Pix recebido de Maria Exemplo da Silva'),
            ('2026-09-05', 500000, 'TED RECEBIDA SALARIO ACME TECNOLOGIA'), ('2026-09-06', -(tot_aug + 370), 'PAGAMENTO DE FATURA'),
            ('2026-09-10', -300000, 'ALUGUEL APTO 12'), ('2026-09-21', -50000, 'Pix enviado para Maria Exemplo da Silva'), ('2026-09-30', 9, 'RENDIMENTO AUTOMATICO')]
    bal = 2000000
    for i, (d, a, raw) in enumerate(bank):
        bal += a
        t(d, a, raw, 'conta', 'imp-ext', rowIndex=i, time=f'{8 + i % 10:02d}:{(i * 7) % 60:02d}', balance=bal,
          **({'kind': 'card_payment'} if 'FATURA' in raw else {}))
    # a second extrato imported into the CARD account by mistake (01/09–30/09)
    bal = 50000
    for i, (d, a, raw) in enumerate([('2026-09-01', 3, 'RENDIMENTO AUTOMATICO'), ('2026-09-08', -2000, 'Pix enviado para Joao Padeiro'),
                                     ('2026-09-15', 10000, 'TED RECEBIDA REEMBOLSO'), ('2026-09-22', -3000, 'Pix enviado para Joao Padeiro'),
                                     ('2026-09-30', 4, 'RENDIMENTO AUTOMATICO')]):
        bal += a
        t(d, a, raw, 'cartao', 'imp-wrong', rowIndex=i, time='09:00', balance=bal)
    meta = {
        'accounts': {'items': [{'id': 'conta', 'name': 'Conta Teste', 'type': 'checking'}, {'id': 'cartao', 'name': 'Cartão Teste', 'type': 'credit_card'}]},
        'imports': {
            'imp-ext': {'id': 'imp-ext', 'fileName': 'extrato-jul-set.csv', 'at': '2026-10-01T10:00:00Z', 'accountId': 'conta', 'hasBalance': True},
            'imp-fjul': {'id': 'imp-fjul', 'fileName': 'fatura-julho.csv', 'at': '2026-10-01T10:01:00Z', 'accountId': 'cartao'},
            'imp-faug': {'id': 'imp-faug', 'fileName': 'fatura-agosto.csv', 'at': '2026-10-01T10:02:00Z', 'accountId': 'cartao', 'duplicates': 2},
            'imp-wrong': {'id': 'imp-wrong', 'fileName': 'extrato-poupanca-set.csv', 'at': '2026-10-01T10:03:00Z', 'accountId': 'cartao', 'hasBalance': True}},
        'settings': {'budgets': {}, 'schemaVersion': 2},
    }
    return meta, txs


def post(path, body):
    req = urllib.request.Request(path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def seed(ns, meta, months_rows, raw_docs=False):
    """meta: name -> data (or full doc when raw_docs); months_rows: ym -> rows (or full doc)"""
    for name, data in meta.items():
        doc = data if raw_docs else {'v': 2, 'kind': 'meta', 'name': name, 'data': data, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + name, 'parent': None}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2meta/{name}', 'data': doc})
    for ym, rows in months_rows.items():
        doc = rows if raw_docs else {'v': 2, 'kind': 'month', 'ym': ym, 'transactions': rows, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + ym}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2months/{ym}', 'data': doc})


def seed_synthetic(ns):
    meta, txs = synthetic()
    months = {}
    for r in txs:
        months.setdefault(r['date'][:7], []).append(r)
    seed(ns, meta, months)
    return meta, txs


def db_meta(ns, name):
    return (artifact_server.docs(ns).get(f'{BASE}/v2meta/{name}') or {}).get('data', {}).get('data')


def open_artifact(b, ns, scheme='light', w=390, h=844):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* xlsx stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    ctx.route(re.compile(r'https://(www\.google\.com|brasilapi\.com\.br)/.*'), lambda r: r.fulfill(status=200, body='external', content_type='text/plain'))
    cfg = {'ns': ns, 'uid': UID}
    ctx.add_init_script(FAKE_JS + '\n;(function(c){ window.__saved = [];'
                        ' var f = FakeClaude.createFakeClaude({ backend: FakeClaude.createHttpBackend("/__fakedb", c.ns, 150), userId: c.uid, delayMs: 100, saved: window.__saved });'
                        ' window.claude = Object.freeze({ use: f.claude.use });'
                        '})(' + json.dumps(cfg) + ');')
    pg = ctx.new_page()
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))
    pg.goto(URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(300)
    PAGES.append(pg)
    return ctx, pg


def goto_tab(pg, tab):
    pg.click(f'.tab[data-tab="{tab}"]')
    pg.wait_for_timeout(150)


def set_month(pg, ym):
    J(pg, '(ym) => { __ff.state().ui.month = ym; __ff.state().ui.range = 1; }', ym)
    goto_tab(pg, 'painel')


def flushed(pg):
    J(pg, '() => __ff.flush()')
    wait(pg, '() => __ff.store().status === "synced"', 8000)
    pg.wait_for_timeout(250)


def tx_by_raw(pg, raw, extra='true'):
    return J(pg, '([r, e]) => __ff.live().filter(t => t.rawDescription === r && eval(e))', [raw, extra])


def open_editor(pg, tx_id):
    goto_tab(pg, 'tx')
    J(pg, '() => { const s = __ff.state(); s.ui.filter = "all"; s.ui.q = ""; s.ui.adv = null; }')
    goto_tab(pg, 'painel'); goto_tab(pg, 'tx')
    tx = J(pg, '(id) => __ff.live().find(t => t.id === id)', tx_id)
    pg.fill('#tx-search', tx['rawDescription'][:18]); pg.wait_for_timeout(300)
    pg.click(f'#tx-list .tx[data-id="{tx_id}"]')
    pg.wait_for_selector('#ed-cat')


def triage_to(pg, tx_id):
    for _ in range(60):
        cur = J(pg, '() => document.querySelector("#tri-card") && document.querySelector("#tri-card").dataset.id')
        if cur == tx_id or not cur:
            return cur == tx_id
        pg.click('[data-act="tri-skip"]')
    return False


def health_ids(pg):
    return J(pg, '() => __ff.health().map(w => w.id)')


# ------------------------------------------------------------------------------------------------ A. artifact, all features
def scenario_artifact(b):
    ns = 'v21a' + RUN
    meta, txs = seed_synthetic(ns)
    ctx, pg = open_artifact(b, ns)
    section('A0. boot with seeded synthetic data (artifact build, fake claude.ai db)')
    check(J(pg, '() => __ff.state().auth.mode') == 'artifact', 'artifact mode')
    check(J(pg, '() => __ff.live().length') == len(txs), f'all {len(txs)} synthetic rows loaded')

    section('5. Saúde dos dados: checks, chip, sheet, actions')
    ids = health_ids(pg)
    print('     warnings:', ids)
    errs = J(pg, '() => FinEngine.dataHealth({ transactions: __ff.live(), accounts: __ff.D().accounts, imports: __ff.D().imports, settings: __ff.D().settings }).errors')
    check(errs == [], f'no check threw ({errs})')
    for pre, what in [('b:extrato-in-card:imp-wrong', 'b: extrato inside the card account'), 
                      ('c:no-fatura:', 'c: payment without fatura'), ('c:mismatch:', 'c: payment ≠ fatura total'), ('f:ask:', 'f: "Isto é você?"'),
                      ('j:ok:', None)]:
        if what:
            check(any(i.startswith(pre) for i in ids), what)
    check(not any(i.startswith('b:mixed:') for i in ids), 'b: no second "mistura" warning for the import already flagged')
    sev = J(pg, '() => FinEngine.dataHealth({ transactions: __ff.live(), accounts: __ff.D().accounts, imports: __ff.D().imports, settings: __ff.D().settings }).find(w => w.id.startsWith("c:no-fatura:")).severity')
    check(sev == 'blocking', 'payment without fatura blocks its month')
    set_month(pg, '2026-08')
    check(pg.is_visible('#health-chip'), 'Painel shows the "Saúde dos dados" chip')
    check(pg.inner_text('#health-count') == str(len(ids)), f'chip count = {len(ids)}')
    check(pg.get_attribute('#health-chip', 'data-sev') == 'blocking', 'chip colored by the worst severity (blocking)')
    shot(pg, 'painel-aug-light')
    no_hscroll(pg, 'Painel 390')
    pg.click('#health-chip'); pg.wait_for_selector('#health-body .hw')
    check(pg.locator('.hw-group h3').count() >= 2, 'warnings grouped by month')
    check(pg.locator('.hw [data-act="hw-dismiss"]').count() == len(ids), 'every warning has "Ignorar aviso"')
    shot(pg, 'health-sheet-light')
    no_hscroll(pg, 'health sheet')
    # Ignorar aviso → settings.dismissedWarnings (synced) → restore
    mm = next(i for i in ids if i.startswith('c:mismatch:'))
    pg.click(f'.hw[data-wid="{mm}"] [data-act="hw-dismiss"]'); pg.wait_for_timeout(200)
    check(mm not in health_ids(pg) and not pg.is_visible(f'.hw[data-wid="{mm}"]'), 'Ignorar aviso hides it right away')
    flushed(pg)
    check(mm in (db_meta(ns, 'settings') or {}).get('dismissedWarnings', []), 'dismissed id saved in settings (db)')
    check(bool((db_meta(ns, 'settings') or {}).get('updatedAt')), 'settings write sets updatedAt')
    pg.click('#hw-undismiss'); pg.wait_for_timeout(200)
    check(mm in health_ids(pg), '"Mostrar avisos ignorados" restores them')
    # Marcar mês como completo (blocking c → June)
    nf = next(i for i in ids if i.startswith('c:no-fatura:'))
    pg.click(f'.hw[data-wid="{nf}"] [data-act="hw-complete"]'); pg.wait_for_timeout(200)
    check('2026-06' in J(pg, '() => __ff.D().settings.carry.included'), 'Marcar mês como completo → settings.carry.included')
    check(pg.is_visible(f'.hw[data-wid="{nf}"] .tag.ok'), 'warning shows "mês marcado como completo"')
    # Isto é você? → ownerNames → own-account transfers → Marcar como transferência
    ask = next(i for i in health_ids(pg) if i.startswith('f:ask:'))
    pg.click(f'.hw[data-wid="{ask}"] [data-act="hw-act"]'); pg.wait_for_timeout(250)
    check(J(pg, '() => __ff.D().settings.ownerNames') == ['MARIA EXEMPLO DA SILVA'], '"Isto é você?" saves the name in settings')
    own = next((i for i in health_ids(pg) if i.startswith('f:own:')), None)
    check(bool(own), 'own-name transfers outside the app are now flagged')
    pg.click(f'.hw[data-wid="{own}"] [data-act="hw-act"]'); pg.wait_for_timeout(250)
    kinds = [t['kind'] for t in J(pg, '() => __ff.live().filter(t => /Maria Exemplo/.test(t.rawDescription))')]
    check(kinds == ['transfer'] * 3, f'"Marcar como transferência" → kind transfer ({kinds})')
    # Mover importação → accounts sheet with the move box → new checking account → warning gone
    bw = 'b:extrato-in-card:imp-wrong'
    flushed(pg)  # let the sync echo settle (a remote refresh re-renders the accounts sheet)
    pg.click(f'.hw[data-wid="{bw}"] [data-act="hw-act"]')
    pg.wait_for_selector('#move-box')
    check(pg.is_visible('#move-box') and J(pg, '() => __ff.state().accUI.move.id') == 'imp-wrong', '"Mover importação" opens the move box for that import')
    pg.select_option('#mv-acc', '__new'); pg.fill('#mv-name', 'Poupança Teste'); pg.select_option('#mv-type', 'savings')
    pg.wait_for_timeout(300)
    pg.click('#mv-confirm'); pg.wait_for_timeout(300)
    wait(pg, '() => !__ff.health().some(w => w.id === "b:extrato-in-card:imp-wrong" || w.id === "b:mixed:cartao")', 5000)
    hid = health_ids(pg)
    accs = J(pg, '() => __ff.D().accounts.map(a => a.id + ":" + a.type)')
    where = J(pg, '() => [...new Set(__ff.live().filter(t => t.importId === "imp-wrong").map(t => t.accountId))]')
    check(bw not in hid and 'b:mixed:cartao' not in hid, f'after moving: extrato-in-card and mixed warnings are gone ({hid}; {accs}; {where})')
    pg.keyboard.press('Escape')

    section('3. deficit carry-over: Painel line, Sankey, sheet, month menu, Ajustes')
    set_month(pg, '2026-08')
    ci = J(pg, '() => __ff.carry().rows.map(r => [r.month, r.net, r.carryIn, r.repaid, r.carryOut, r.excluded])')
    print('     carry rows:', ci)
    jul = next(r for r in ci if r[0] == '2026-07')
    augr = next(r for r in ci if r[0] == '2026-08')
    check(J(pg, '() => __ff.carry().start') == '2026-07', 'default start = first month without a blocking warning (July)')
    check(jul[1] < 0 and jul[4] == -jul[1], 'July closes negative → carried')
    check(augr[2] == jul[4] and augr[3] == min(augr[1], augr[2]) and augr[4] == augr[2] - augr[3], 'August repays from its surplus')
    check(pg.is_visible('#carry-line') and 'Déficit acumulado' in pg.inner_text('#carry-line') and 'desde jul/26' in pg.inner_text('#carry-line'), f'Painel: "{pg.inner_text("#carry-line")}"')
    check(int(pg.get_attribute('#carry-total', 'data-cents')) == augr[4], 'line amount = carryOut of August')
    check(pg.locator('.sk-node[data-id="carry"]').count() == 1, 'Sankey (August): "Déficit de julho (pagando)" leaf')
    check('Déficit de julho (pagando)' in J(pg, '() => __ff.state()._sankey.nodes.map(n => n.name).join("|")'), 'leaf named after the previous month')
    sk = J(pg, '() => { const g = __ff.state()._sankey; const i = g.links.filter(l => l.target === "hub").reduce((s, l) => s + l.value, 0); const o = g.links.filter(l => l.source === "hub").reduce((s, l) => s + l.value, 0); return [i, o]; }')
    check(abs(sk[0] - sk[1]) <= 1, f'hub balanced {sk}')
    set_month(pg, '2026-07')
    ids7 = J(pg, '() => __ff.state()._sankey.nodes.map(n => n.id)')
    check('deficit:card' in ids7 and 'deficit' not in ids7, f'Sankey (July): Déficit split by coverage ({[i for i in ids7 if i.startswith("deficit")]})')
    shot(pg, 'painel-jul-light')
    set_month(pg, '2026-08')
    pg.click('#carry-line'); pg.wait_for_selector('#carry-rows')
    check(pg.locator('#carry-rows .cm-row').count() == len(ci), 'sheet explains month by month')
    shot(pg, 'carry-sheet-light')
    pg.click('#carry-rows [data-carryx="2026-07"]'); pg.wait_for_timeout(250)
    check(J(pg, '() => __ff.carry().rows.find(r => r.month === "2026-08").carryOut') == 0, 'July marked incomplete → nothing carried into August')
    flushed(pg)
    check('2026-07' in ((db_meta(ns, 'settings') or {}).get('carry') or {}).get('excluded', []), 'settings.carry.excluded saved (db)')
    pg.click('#carry-rows [data-carryx="2026-07"]'); pg.wait_for_timeout(250)
    check(J(pg, '() => __ff.carry().rows.find(r => r.month === "2026-08").carryOut') == augr[4], 'switch back → carried again')
    # an auto-excluded month (June: payment without fatura, re-included above) can be excluded again and re-included
    check(J(pg, '() => __ff.carry().auto["2026-06"] != null'), 'June is auto-excluded by data health')
    pg.keyboard.press('Escape')
    # month selector menu
    set_month(pg, '2026-07')
    pg.click('#btn-month-menu'); pg.wait_for_selector('#month-incomplete')
    pg.click('#month-incomplete'); pg.wait_for_timeout(200)
    check(J(pg, '() => __ff.carry().excluded.has ? [...__ff.carry().excluded].includes("2026-07") : false'), 'month menu: "Mês incompleto — não transportar"')
    shot(pg, 'month-menu-light')
    pg.click('#month-incomplete'); pg.wait_for_timeout(200)
    pg.keyboard.press('Escape')
    # Ajustes: toggle, start month
    set_month(pg, '2026-08')
    pg.click('#btn-settings'); pg.wait_for_selector('#carry-set')
    check(pg.is_checked('#carry-enabled'), 'Ajustes: "Transportar déficit entre meses" on by default')
    pg.locator('#carry-set').scroll_into_view_if_needed()
    shot(pg, 'settings-carry-light')
    pg.click('#carry-enabled'); pg.wait_for_timeout(200)
    check(J(pg, '() => __ff.D().settings.carry.enabled') is False and J(pg, '() => __ff.carry().rows.every(r => r.carryOut === 0)'), 'toggle off → nothing carried')
    pg.click('#carry-enabled'); pg.wait_for_timeout(200)
    pg.select_option('#carry-start', '2026-08'); pg.wait_for_timeout(200)
    check(J(pg, '() => __ff.carry().rows[0].month') == '2026-08' and J(pg, '() => __ff.carry().rows[0].carryIn') == 0, '"Começar a contar em" agosto → July not counted')
    pg.select_option('#carry-start', ''); pg.wait_for_timeout(200)
    pg.keyboard.press('Escape')
    set_month(pg, '2026-08')
    check(pg.is_visible('#carry-line'), 'line back after resetting the start month')

    section('1. Google + CNPJ help (artifact: link to BrasilAPI + "Colar CNAE")')
    drog = tx_by_raw(pg, 'JOSE FARMA LTDA 11.222.333/0001-81')[0]
    pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-card')
    check(triage_to(pg, drog['id']), 'triage reached the card with a CNPJ')
    pg.click('#tri-card .help-d summary')
    g = pg.get_attribute('#tri-google', 'href')
    gq = urllib.parse.unquote(g)
    check(g.startswith('https://www.google.com/search?q=') and 'JOSE FARMA' in gq and '0001' not in gq, f'"Pesquisar no Google" → {gq}')
    check(pg.get_attribute('#tri-google', 'target') == '_blank' and pg.get_attribute('#tri-google', 'rel') == 'noopener noreferrer', 'opens in a new tab, noopener noreferrer')
    check(pg.get_attribute('#tri-cnpj', 'href') == 'https://brasilapi.com.br/api/cnpj/v1/11222333000181', 'artifact: "Consultar CNPJ" links to BrasilAPI (CSP: no fetch)')
    check('Nada é enviado' in pg.inner_text('#tri-help'), 'privacy hint shown')
    shot(pg, 'triage-help-light')
    no_hscroll(pg, 'triage with help')
    pg.fill('#tri-cnae', '{"cnpj":"11222333000181","cnae_fiscal":4771701,"cnae_fiscal_descricao":"Comércio varejista de produtos farmacêuticos"}')
    pg.wait_for_selector('#tri-cnae-out .sug-btn')
    check('Farmácia' in pg.inner_text('#tri-cnae-out'), 'pasted BrasilAPI JSON → chip "Saúde › Farmácia"')
    check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', drog['id']) is None, 'nothing auto-assigned before the tap')
    pg.click('#tri-cnae-out .sug-btn'); pg.wait_for_timeout(250)
    check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', drog['id']) == 'saude.farmacia', 'tap on the chip classifies')
    casa = tx_by_raw(pg, 'CASA DA DONA CIDA SAO PAULO BR')
    check(triage_to(pg, casa[0]['id']) or triage_to(pg, casa[-1]['id']) or True, 'triage: card without CNPJ')
    cur = J(pg, '() => document.querySelector("#tri-card") && __ff.live().find(t => t.id === document.querySelector("#tri-card").dataset.id)')
    if cur and 'CASA DA DONA' in cur['rawDescription']:
        pg.click('#tri-card .help-d summary')
        h = pg.get_attribute('#tri-cnpj-name', 'href')
        check('CNPJ' in urllib.parse.unquote_plus(h) and 'CASA DA DONA CIDA' in urllib.parse.unquote_plus(h), f'"Buscar CNPJ pelo nome" → {h}')
        check('SAO PAULO' in urllib.parse.unquote(pg.get_attribute('#tri-google', 'href')), 'Google query includes the city')
        pg.fill('#tri-cnae', '47.12-1-00')
        check('Mercado' in pg.inner_text('#tri-cnae-out'), '"47.12-1-00" → Alimentação › Mercado chip')
        pg.fill('#tri-cnae', 'xyz'); pg.wait_for_timeout(100)
        check('Não reconheci' in pg.inner_text('#tri-cnae-out'), 'unknown text → plain message, no chip')
    pg.click('[data-act="tri-close"]'); pg.wait_for_timeout(200)

    section('2. per-purchase memory for parcelas (Mercado-Livre-like ambiguous merchant)')
    a_ids = [t['id'] for t in J(pg, '() => __ff.live().filter(t => /MERCADOLIVRE/.test(t.rawDescription) && t.installment.total === 10)')]
    b_ids = [t['id'] for t in J(pg, '() => __ff.live().filter(t => /MERCADOLIVRE/.test(t.rawDescription) && t.installment.total === 5)')]
    rules0 = len(J(pg, '() => __ff.D().rules'))
    pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-card')
    check(triage_to(pg, a_ids[0]) or triage_to(pg, a_ids[1]), 'triage reached a parcela of purchase A')
    first = J(pg, '() => document.querySelector("#tri-card").dataset.id')
    check(not pg.is_checked('#tri-remember'), '4: ambiguous merchant → "Lembrar" unticked by default')
    pg.click('.tri-grid [data-act="tri-group"][data-g="compras"]')
    pg.click('.tri-grid [data-act="tri-pick"][data-cat="compras.eletronicos"]'); pg.wait_for_timeout(250)
    rules = J(pg, '() => __ff.D().rules')
    sr = [r for r in rules if r.get('origin') == 'installment']
    check(len(rules) == rules0 + 1 and len(sr) == 1 and sr[0]['set']['categoryId'] == 'compras.eletronicos', 'unticked "Lembrar" on a parcela → installment-series rule')
    check(sr and sr[0].get('expiresAfter') == '2027-02' and sr[0].get('updatedAt'), f'rule expires after the last parcela ({sr and sr[0].get("expiresAfter")})')
    st = J(pg, '(ids) => ids.map(id => { const t = __ff.live().find(x => x.id === id); return [t.categoryId, t.catSource]; })', a_ids)
    check(all(x[0] == 'compras.eletronicos' for x in st) and sorted(x[1] for x in st) == ['manual', 'series'], f'all parcelas of purchase A got the category (picked: manual, the other: series) ({st})')
    stb = J(pg, '(ids) => ids.map(id => __ff.live().find(x => x.id === id).categoryId)', b_ids)
    check(stb == [None] * len(b_ids), 'purchase B (same merchant) did not inherit')
    lbl = pg.inner_text('#tri-undo')
    check('lembrado para esta compra (parcelas 3–10)' in lbl, f'undo label: "{lbl}"')
    pg.click('#tri-undo'); pg.wait_for_timeout(250)
    check(not [r for r in J(pg, '() => __ff.D().rules') if r.get('origin') == 'installment'], 'Desfazer removes the series rule')
    check(J(pg, '(ids) => ids.every(id => !__ff.live().find(x => x.id === id).categoryId)', a_ids), 'Desfazer restores the parcelas')
    check(J(pg, '() => document.querySelector("#tri-card").dataset.id') == first, 'back on the same card')
    pg.click('.tri-grid [data-act="tri-group"][data-g="compras"]')
    pg.click('.tri-grid [data-act="tri-pick"][data-cat="compras.eletronicos"]'); pg.wait_for_timeout(250)
    pg.click('[data-act="tri-close"]'); pg.wait_for_timeout(200)
    flushed(pg)
    rdoc = db_meta(ns, 'rules') or {}
    check(any(r.get('origin') == 'installment' for r in rdoc.get('rules', [])), 'series rule saved (db)')
    open_editor(pg, a_ids[1])
    check(pg.is_visible('#ed-series') and 'parcelas 3–10' in pg.inner_text('#ed-series'), f'editor note: "{pg.inner_text("#ed-series") if pg.is_visible("#ed-series") else ""}"')
    shot(pg, 'editor-series-light')
    pg.keyboard.press('Escape')
    # a future import of the same purchase (parcela 5/10) inherits automatically
    nxt = J(pg, '''() => { const c = { rules: __ff.D().rules, categories: __ff.D().categories, accounts: __ff.D().accounts };
      const t = { id: 'x', date: '2026-09-10', amount: -15000, rawDescription: 'MERCADOLIVRE*LOJAXYZ', installment: { n: 5, total: 10 }, originalDate: '2026-05-10', accountId: 'cartao' };
      return FinEngine.classify(t, c); }''')
    check(nxt['categoryId'] == 'compras.eletronicos' and nxt['catSource'] == 'series', 'future import of parcela 5/10 → same category')

    section('4. "Lembrar" default: rememberOff per category, live update, ambiguous merchants')
    casa = [t for t in tx_by_raw(pg, 'CASA DA DONA CIDA SAO PAULO BR') if not t.get('categoryId')]
    target = casa[0]['id'] if casa else tx_by_raw(pg, 'NETFLIX.COM')[0]['id']
    open_editor(pg, target)
    check(pg.is_checked('#ed-remember'), 'regular merchant → ticked')
    pg.select_option('#ed-cat', 'compras.presentes')
    check(pg.is_checked('#ed-remember'), 'still ticked for a category never unticked')
    pg.uncheck('#ed-remember'); pg.click('[data-act="savetx"]'); pg.wait_for_timeout(250)
    check('compras.presentes' in (J(pg, '() => __ff.D().settings.rememberOff') or []), 'explicit untick → settings.rememberOff')
    other = tx_by_raw(pg, 'RESTAURANTE BOM PRATO')[0]['id']
    open_editor(pg, other)
    check(pg.is_checked('#ed-remember'), 'other merchant, its own category → ticked')
    pg.select_option('#ed-cat', 'compras.presentes')
    check(not pg.is_checked('#ed-remember'), 'live: switching to a category in rememberOff unticks')
    pg.select_option('#ed-cat', 'lazer.eventos')
    check(pg.is_checked('#ed-remember'), 'live: switching to another category ticks again')
    pg.select_option('#ed-cat', 'compras.presentes'); pg.check('#ed-remember')
    shot(pg, 'editor-remember-light')
    pg.click('[data-act="savetx"]'); pg.wait_for_timeout(250)
    check('compras.presentes' not in (J(pg, '() => __ff.D().settings.rememberOff') or []), 'ticking it again removes the category from rememberOff')
    flushed(pg)
    check('rememberOff' in (db_meta(ns, 'settings') or {}), 'rememberOff synced in settings (db)')
    amz = tx_by_raw(pg, 'AMAZON MARKETPLACE')[0]['id']
    open_editor(pg, amz)
    check(not pg.is_checked('#ed-remember'), 'ambiguous merchant (Amazon) → unticked')
    check(pg.is_visible('#ed-help') or pg.locator('.help-d').count() == 1, 'editor has the search help')
    pg.click('.help-d summary') if not pg.is_visible('#ed-google') else None
    check(pg.get_attribute('#ed-cnpj-name', 'target') == '_blank', 'editor: "Buscar CNPJ pelo nome" opens a new tab')
    shot(pg, 'editor-help-light')
    pg.keyboard.press('Escape')

    section('A9. no console errors')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()


def scenario_screens(b):
    section('screens: 390 / 1280 × light / dark (synthetic data)')
    for (w, scheme) in ((390, 'dark'), (1280, 'light'), (1280, 'dark')):
        ns = f'v21s{w}{scheme}' + RUN
        seed_synthetic(ns)
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        tag = f'{w}-{scheme}'
        set_month(pg, '2026-08')
        check(pg.is_visible('#health-chip') and pg.is_visible('#carry-line'), f'{tag}: chip + deficit line')
        no_hscroll(pg, f'{tag} Painel')
        shot(pg, f'painel-aug-{tag}')
        pg.click('#health-chip'); pg.wait_for_selector('#health-body .hw')
        no_hscroll(pg, f'{tag} health sheet')
        shot(pg, f'health-sheet-{tag}')
        pg.keyboard.press('Escape')
        pg.click('#carry-line'); pg.wait_for_selector('#carry-rows')
        shot(pg, f'carry-sheet-{tag}')
        pg.keyboard.press('Escape')
        set_month(pg, '2026-07')
        shot(pg, f'painel-jul-{tag}')
        drog = tx_by_raw(pg, 'JOSE FARMA LTDA 11.222.333/0001-81')[0]
        pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-card')
        triage_to(pg, drog['id'])
        pg.click('#tri-card .help-d summary')
        pg.fill('#tri-cnae', '4771-7/01')
        no_hscroll(pg, f'{tag} triage help')
        shot(pg, f'triage-help-{tag}')
        pg.click('[data-act="tri-close"]'); pg.wait_for_timeout(150)
        pg.click('#btn-settings'); pg.wait_for_selector('#carry-set')
        pg.locator('#carry-set').scroll_into_view_if_needed()
        shot(pg, f'settings-carry-{tag}')
        pg.keyboard.press('Escape')
        check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')
        ctx.close()


# ------------------------------------------------------------------------------------------------ B. Netlify build: server CNPJ lookup
def scenario_netlify(b):
    section('B. Netlify build: "Consultar CNPJ" through /api/cnpj (CSP on, test-only BrasilAPI stand-in)')
    env = dict(os.environ, PORT=str(HPORT))
    proc = subprocess.Popen(['node', os.path.join(HERE, 'netlify_harness.mjs'), str(HPORT)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(HURL + 'index.html', timeout=1); break
            except Exception:
                time.sleep(0.1)
        for (w, scheme) in ((390, 'light'), (1280, 'dark')):
            ctx = b.new_context(viewport={'width': w, 'height': 900}, color_scheme=scheme, device_scale_factor=2, service_workers='block')
            ctx.route(re.compile(r'https://fonts\.googleapis\.com/.*'), lambda r: r.fulfill(status=200, body='/* fonts */', content_type='text/css'))
            ctx.route(re.compile(r'https://fonts\.gstatic\.com/.*'), lambda r: r.fulfill(status=404, body=''))
            ctx.route('**/vendor/netlify-identity.js', lambda r: r.fulfill(status=200, body=FAKE_ID, content_type='text/javascript'))
            ctx.add_init_script(CSP_HOOK)
            pg = ctx.new_page()
            pg._errs = []
            pg.on('console', lambda m, pg=pg: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e, pg=pg: pg._errs.append('PAGEERROR ' + str(e)))
            pg.goto(HURL)
            pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
            tag = f'{w}-{scheme}'
            pg.click('#signed-out [data-act="login"]'); pg.wait_for_selector('#ffl-email')
            pg.fill('#ffl-email', f'cnpj{w}{scheme}{RUN}@exemplo.com'); pg.fill('#ffl-pass', 'senha-certa-123')
            pg.click('.ffl-card button[type="submit"]')
            wait(pg, '() => !!__ff.state().auth.user', 10000)
            # import two rows by pasting (new checking account)
            pg.click('.tab[data-tab="import"]'); pg.wait_for_timeout(200)
            pg.select_option('#imp-acc', '__new'); pg.fill('#imp-acc-name', 'Conta CNPJ'); pg.select_option('#imp-acc-type', 'checking')
            pg.click('#scr-import details summary')
            pg.fill('#imp-paste', 'Data;Descrição;Valor\n05/09/2026;JOSE FARMA LTDA 11.222.333/0001-81;-54,90\n06/09/2026;LOJA SEM CADASTRO;-12,00\n')
            pg.click('[data-act="imp-paste"]')
            pg.wait_for_selector('[data-act="imp-step"][data-s="3"], [data-act="imp-step"][data-s="4"]')
            if not pg.is_visible('[data-act="imp-step"][data-s="4"]'):
                pg.click('[data-act="imp-step"][data-s="3"]')
            pg.click('[data-act="imp-step"][data-s="4"]'); pg.click('[data-act="imp-commit"]'); pg.wait_for_selector('#imp-done')
            drog = J(pg, '() => __ff.live().find(t => /JOSE FARMA/.test(t.rawDescription))')
            check(drog is not None and drog['categoryId'] is None, f'{tag}: imported, uncategorized')
            imp = J(pg, '() => Object.values(__ff.D().imports)[0]')
            check(imp.get('from') == '2026-09-05' and imp.get('to') == '2026-09-06' and imp.get('updatedAt') and 'duplicates' in imp, f'{tag}: import record keeps from/to/duplicates/updatedAt')
            pg.click('#imp-done [data-act="triage"]'); pg.wait_for_selector('#tri-card')
            triage_to(pg, drog['id'])
            pg.click('#tri-card .help-d summary')
            check(pg.is_visible('#tri-cnpj') and J(pg, '() => document.querySelector("#tri-cnpj").tagName') == 'BUTTON', f'{tag}: Netlify build → "Consultar CNPJ" is a server lookup button')
            check(not pg.is_visible('#tri-cnae'), f'{tag}: no "Colar CNAE" when the server can look it up')
            calls0 = J(pg, '() => performance.getEntriesByType("resource").filter(e => /\\/api\\/cnpj\\//.test(e.name)).length')
            check(calls0 == 0, f'{tag}: nothing requested before the tap')
            pg.click('#tri-cnpj')
            pg.wait_for_selector('#tri-cnpj-out .cnpj-res', timeout=8000)
            out = pg.inner_text('#tri-cnpj-out')
            check('DROGA EXEMPLO' in out and 'farmacêuticos' in out and 'SAO PAULO/SP' in out, f'{tag}: shows name, activity and city')
            check('NÃO DEVE APARECER' not in out, f'{tag}: only the allowed fields come back')
            check(pg.locator('#tri-cnpj-out .sug-btn').count() == 1 and 'Farmácia' in pg.inner_text('#tri-cnpj-out .sug-btn'), f'{tag}: category suggestion chip')
            shot(pg, f'netlify-cnpj-{tag}')
            no_hscroll(pg, f'{tag} netlify triage')
            pg.click('#tri-cnpj-out .sug-btn'); pg.wait_for_timeout(250)
            check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', drog['id']) == 'saude.farmacia', f'{tag}: chip tap classifies')
            pg.click('[data-act="tri-close"]'); pg.wait_for_timeout(150)
            pg.click('#health-chip') if pg.is_visible('#health-chip') else None
            pg.wait_for_timeout(200)
            csp = J(pg, '() => window.__csp')
            check(not csp, f'{tag}: no CSP violations {csp[:3]}')
            errs = [e for e in pg._errs if 'fonts.gstatic' not in e]
            check(not errs, f'{tag}: no console errors {errs[:3]}')
            ctx.close()
    finally:
        proc.terminate()


# ------------------------------------------------------------------------------------------------ C. real data (read-only snapshot)
def scenario_real(b):
    section('C. the user\'s real artifact data (read-only snapshot through the fake db)')
    if not os.path.isdir(os.path.join(REAL_DB, 'v2meta')):
        print('  skip (no snapshot at FF_REAL_ARTIFACT_DB)')
        return
    ns = 'v21real' + RUN
    meta = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2meta', '*.json'))}
    months = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2months', '*.json'))}
    n = sum(len(d.get('transactions', [])) for d in months.values())
    seed(ns, meta, months, raw_docs=True)
    ctx, pg = open_artifact(b, ns)
    check(J(pg, '() => __ff.live().length') == n, f'all {n} rows loaded')
    res = J(pg, '''() => { const d = __ff.D(); const ws = FinEngine.dataHealth({ transactions: __ff.live(), accounts: d.accounts, imports: d.imports, settings: d.settings });
      const names = d.accounts.map(a => a.name).concat(__ff.live().map(t => t.merchant)).filter(Boolean).sort((a, b) => b.length - a.length);
      const mask = s => { let o = s; for (const n of names) if (n.length > 2) o = o.split(n).join('…'); return o; };
      const imps = Object.values(d.imports || {}).map(i => ({ id: i.id, kind: FinEngine.importKind(__ff.live().filter(t => t.importId === i.id), i), acc: (d.accounts.find(a => a.id === i.accountId) || {}).type }));
      return { errors: ws.errors, list: ws.map(w => ({ id: w.id.split(':').slice(0, 2).join(':'), sev: w.severity, title: mask(w.title), months: w.months, action: w.action && w.action.type, imp: w.importIds })), imps }; }''')
    print('     imports:', [(i['kind'], i['acc']) for i in res['imps']])
    for w in res['list']:
        print(f"     [{w['sev']}] {w['id']} — {w['title']} {w['months']} {w['action'] or ''}")
    check(res['errors'] == [], f'no check threw ({res["errors"]})')
    ext = [i['id'] for i in res['imps'] if i['kind'] == 'extrato' and i['acc'] == 'credit_card']
    check(len(ext) == 1, 'one import classified as a bank extrato inside the credit-card account')
    hit = [w for w in res['list'] if w['id'] == 'b:extrato-in-card' and ext and ext[0] in (w['imp'] or [])]
    check(bool(hit) and hit[0]['action'] == 'move-import', '(b) fires for the extrato in the card account, with "Mover importação"')
    check(not any(w['id'] == 'b:mixed' for w in res['list']), '(b) no second "mistura" warning for the same misplaced import')
    check(not any(w['id'] == 'j:dups' for w in res['list']), '(j) a debit toll reversed in the extrato is not a repeat of the card toll')
    set_month(pg, J(pg, '() => __ff.live().map(t => t.date.slice(0, 7)).sort().pop()'))
    check(pg.is_visible('#health-chip'), 'Painel shows the chip with the real data')
    pg.click('#health-chip'); pg.wait_for_selector('#health-body .hw')
    check(pg.locator('.hw').count() == len(res['list']), 'sheet lists every warning')
    pg.keyboard.press('Escape')
    J(pg, '() => __ff.carry()')
    check(not pg._errs, f'no console errors with the real data {pg._errs[:2]}')
    ctx.close()


def main():
    srv = artifact_server.start(PORT)
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            scenario_artifact(b)
            scenario_screens(b)
            scenario_netlify(b)
            scenario_real(b)
        finally:
            b.close()
    srv.shutdown()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
