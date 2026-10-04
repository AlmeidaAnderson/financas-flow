"""End-to-end tests of the v2.3 update alerts ("Alertas de atualização") in headless Chromium:
  closing/due day per card (accounts sheet, "Sugerir pelos dados"), the bell + count in the header, the one-line alert on
  the Painel, the alerts sheet (Importar agora, Já importei / Ignorar este ciclo, Fechou em outra data, Configurar conta),
  checking-account reminders, persistence across reload and a second synced device.

Usage: npm run build:artifact && python3 test/e2e/e2e_v23.py [A] [S] [L] [R]
  The device clock is fixed at 2026-10-03 10:00 (Playwright clock, time keeps flowing).
  A. Artifact build with the fake window.claude (fake claude.ai db), SYNTHETIC data, 390 light: the full flow + a second page.
  S. Artifact build, configured synthetic data: 390 dark, 1280 light, 1280 dark screens (Painel line, bell, sheets, sticky).
  L. site/ in local mode (real store.js, localStorage): the full flow at 390 light, screens at 1280 dark.
  R. The user's REAL artifact data (read-only snapshot, FF_REAL_ARTIFACT_DB; skipped when absent), loaded at runtime through
     the fake db: "Sugerir pelos dados" on each card account; prints only the inferred days (no names, no amounts) and
     checks nothing is saved without confirming and there are no exceptions.
Screenshots: screens/v23/*.png (gitignored)."""
import sys, os, json, re, time, glob, subprocess, tempfile, datetime, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402
import server as site_server  # noqa: E402

PORT = int(os.environ.get('FF_V23_PORT', '8795'))
LPORT = int(os.environ.get('FF_V23_LOCAL_PORT', '8796'))
URL = f'http://127.0.0.1:{PORT}/'
LURL = f'http://127.0.0.1:{LPORT}/'
SCR = os.path.join(ROOT, 'screens', 'v23')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
REAL_DB = os.environ.get('FF_REAL_ARTIFACT_DB', '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db5/data/users/me/ff')
UID = 'u_e2e_v23'
BASE = f'data/users/{UID}/ff'
RUN = str(int(time.time()))
TMP = tempfile.mkdtemp(prefix='ff-v23-')
NOW = datetime.datetime(2026, 10, 3, 10, 0, 0)
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
REPORT = []


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
    check(r[0] <= r[1], f'{label}: no horizontal page scroll ({r[0]} <= {r[1]})')


# ------------------------------------------------------------------------------------------------ synthetic data
FAT_HDR = 'Data;Estabelecimento;Portador;Valor;Parcela'


def fatura_csv(start, end):
    """purchases every 3 days from start to end (inclusive), dd/mm/aaaa"""
    d0 = datetime.date.fromisoformat(start)
    d1 = datetime.date.fromisoformat(end)
    rows, i, d = [FAT_HDR], 0, d0
    shops = ['IFOOD *RESTAURANTE', 'DROGASIL 0412', 'POSTO SHELL', 'PADARIA SAO JORGE', 'NETFLIX.COM', 'MERCADO BOM']
    while d <= d1:
        rows.append(f'{d.strftime("%d/%m/%Y")};{shops[i % len(shops)]} {i};FULANO;{20 + i * 3},{i % 10}0;-')
        i += 1
        d += datetime.timedelta(days=3)
    if rows[-1].split(';')[0] != d1.strftime('%d/%m/%Y'):
        rows.append(f'{d1.strftime("%d/%m/%Y")};POSTO FINAL;FULANO;99,90;-')
    return '\n'.join(rows) + '\n'


FILES = {
    'Fatura2026-08-05.csv': fatura_csv('2026-06-28', '2026-07-27'),
    'Fatura2026-09-05.csv': fatura_csv('2026-07-28', '2026-08-27'),
    'Fatura2026-10-05.csv': fatura_csv('2026-08-28', '2026-09-27'),
}
for n, txt in FILES.items():
    open(os.path.join(TMP, n), 'w', encoding='utf-8').write(txt)

STAMP = '2026-10-01T12:00:00.000Z'


def engine_rows():
    """profile of the fatura layout + the rows of the two older faturas, through the real engine"""
    js = ("const E=require('./site/engine.js');const f=JSON.parse(require('fs').readFileSync(0,'utf8'));"
          "const prof=E.profileFromAnalysis(E.analyzeTable(f['Fatura2026-10-05.csv']));const out={prof,rows:{}};"
          "for(const k of ['Fatura2026-08-05.csv','Fatura2026-09-05.csv']){const r=E.applyProfile(E.analyzeTable(f[k]).rows,prof,{accountId:'cartao',importId:'imp-'+k.slice(6,16)});out.rows[k]=r.transactions;}"
          "console.log(JSON.stringify(out));")
    out = subprocess.run(['node', '-e', js], cwd=ROOT, input=json.dumps(FILES), capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def synthetic(configured=False):
    e = engine_rows()
    prof = dict(e['prof'], id='pf-fatxp', name='Fatura XP', defaultAccountId='cartao')
    txs = []
    for k, rows in e['rows'].items():
        for r in rows:
            r = dict(r, updatedAt=STAMP, categoryId='alimentacao.restaurante', catSource='manual')
            txs.append(r)
    n = [0]

    def t(date, amount, raw, kind=None, cat=None):
        n[0] += 1
        txs.append({'id': f'v23-{n[0]}', 'date': date, 'amount': amount, 'rawDescription': raw, 'merchant': raw.upper(), 'accountId': 'conta',
                    'kind': kind or ('expense' if amount < 0 else 'income'), 'categoryId': cat, 'catSource': 'manual' if cat else None,
                    'importId': 'imp-ext', 'updatedAt': STAMP})
    for m in ['07', '08', '09']:
        t(f'2026-{m}-01', 500000, 'SALARIO ACME', cat='renda.salario')
        t(f'2026-{m}-05', -150000, 'PAGAMENTO DE FATURA', kind='card_payment')
        t(f'2026-{m}-10', -250000, 'ALUGUEL APTO 12', cat='moradia.aluguel')
    t('2026-09-20', -3000, 'PIX ENVIADO PADARIA', cat='alimentacao.padaria')
    card = {'id': 'cartao', 'name': 'Cartão XP', 'type': 'credit_card'}
    conta = {'id': 'conta', 'name': 'Conta XP', 'type': 'checking'}
    if configured:
        card.update(closingDay=28, dueDay=5, alerts=True, updatedAt=STAMP)
        conta.update(remind={'freq': 'weekly'}, alerts=True, updatedAt=STAMP)
    meta = {
        'accounts': {'items': [card, conta]},
        'profiles': {'items': [prof]},
        'imports': {
            'imp-2026-08-05': {'id': 'imp-2026-08-05', 'fileName': 'Fatura2026-08-05.csv', 'at': '2026-08-06T10:00:00Z', 'accountId': 'cartao', 'profileId': 'pf-fatxp'},
            'imp-2026-09-05': {'id': 'imp-2026-09-05', 'fileName': 'Fatura2026-09-05.csv', 'at': '2026-09-06T10:00:00Z', 'accountId': 'cartao', 'profileId': 'pf-fatxp'},
            'imp-ext': {'id': 'imp-ext', 'fileName': 'extrato-conta.csv', 'at': '2026-09-21T10:00:00Z', 'accountId': 'conta'}},
        'settings': {'budgets': {}, 'schemaVersion': 2},
    }
    return meta, txs


# ------------------------------------------------------------------------------------------------ pages
def post(path, body):
    req = urllib.request.Request(path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def seed_artifact(ns, meta, months, raw_docs=False):
    for name, data in meta.items():
        doc = data if raw_docs else {'v': 2, 'kind': 'meta', 'name': name, 'data': data, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + name, 'parent': None}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2meta/{name}', 'data': doc})
    for ym, rows in months.items():
        doc = rows if raw_docs else {'v': 2, 'kind': 'month', 'ym': ym, 'transactions': rows, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + ym}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2months/{ym}', 'data': doc})


def by_month(txs):
    months = {}
    for r in txs:
        months.setdefault(r['date'][:7], []).append(r)
    return months


def db_meta(ns, name):
    return (artifact_server.docs(ns).get(f'{BASE}/v2meta/{name}') or {}).get('data', {}).get('data')


def new_ctx(b, scheme, w, h, now=None):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2)
    ctx.clock.install(time=now or NOW)
    ctx.clock.resume()
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* xlsx stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    return ctx


def attach(pg):
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))


def open_artifact(b, ns, scheme='light', w=390, h=844, now=None):
    ctx = new_ctx(b, scheme, w, h, now)
    cfg = {'ns': ns, 'uid': UID}
    ctx.add_init_script(FAKE_JS + '\n;(function(c){ window.__saved = [];'
                        ' var f = FakeClaude.createFakeClaude({ backend: FakeClaude.createHttpBackend("/__fakedb", c.ns, 150), userId: c.uid, delayMs: 60, saved: window.__saved });'
                        ' window.claude = Object.freeze({ use: f.claude.use });'
                        '})(' + json.dumps(cfg) + ');')
    pg = ctx.new_page()
    attach(pg)
    pg.goto(URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(300)
    pg._ns = ns
    return ctx, pg


def open_local(b, meta, txs, scheme='light', w=390, h=844):
    ctx = new_ctx(b, scheme, w, h)
    pg = ctx.new_page()
    attach(pg)
    pg.goto(LURL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    J(pg, 'async (b) => { await __ff.store().importAll(b); }', {'version': 2, 'meta': meta, 'months': by_month(txs)})
    pg.reload()
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=15000)
    pg.wait_for_timeout(300)
    pg._ns = None
    return ctx, pg


def reload(pg):
    pg.reload()
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(400)


def goto_tab(pg, tab):
    pg.click(f'.tab[data-tab="{tab}"]')
    pg.wait_for_timeout(200)


def flushed(pg):
    J(pg, '() => __ff.flush()')
    wait(pg, '() => ["synced", "local"].includes(__ff.store().status)', 8000)
    pg.wait_for_timeout(300)


def bell(pg):
    return J(pg, '() => { const b = document.querySelector("#btn-alerts"); const g = document.querySelector("#alerts-badge"); return { shown: !b.hidden, count: +b.dataset.count, badge: g.hidden ? "" : g.textContent }; }')


def alert_ids(pg):
    return J(pg, '() => __ff.alerts().map(a => a.id)')


def close_sheet(pg):
    if pg.locator('.sheet').count():
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(150)


def open_acc_settings(pg, acc):
    close_sheet(pg)
    pg.click('#btn-settings'); pg.wait_for_selector('#btn-accounts')
    pg.click('#btn-accounts'); pg.wait_for_selector('#acc-body')
    det = f'#acc-al-{acc}'
    if not J(pg, f'() => document.querySelector("{det}").open'):
        pg.click(f'{det} > summary')
    pg.wait_for_timeout(150)


def sticky_ok(pg, tag):
    J(pg, '() => window.scrollTo(0, 0)'); pg.wait_for_timeout(150)
    tb = J(pg, '() => document.querySelector(".topbar").getBoundingClientRect().bottom')
    J(pg, '() => window.scrollTo(0, 1400)'); pg.wait_for_timeout(350)
    bb = J(pg, '() => { const r = document.querySelector("#period-bar").getBoundingClientRect(); return { top: r.top, stuck: document.querySelector("#period-bar").classList.contains("stuck") }; }')
    check(abs(bb['top'] - tb) <= 2 and bb['stuck'], f'{tag}: sticky period bar still pinned under the header (top {bb["top"]:.0f} vs {tb:.0f})')
    shot(pg, f'{tag}-sticky')
    J(pg, '() => window.scrollTo(0, 0)'); pg.wait_for_timeout(200)


# ------------------------------------------------------------------------------------------------ the flow
def flow(pg, tag, second=None):
    """second: callable opening another page on the same synced store (artifact mode), or None"""
    section(f'{tag} 1. card without a closing day → "Defina o dia de fechamento"')
    goto_tab(pg, 'painel')
    bl = bell(pg)
    check(bl['shown'] and bl['count'] == 1 and bl['badge'] == '1', f'{tag}: bell in the header with 1 open alert ({bl})')
    check(alert_ids(pg) == ['configurar:cartao'], f'{tag}: the alert is "configurar" for the card ({alert_ids(pg)})')
    check(pg.is_visible('#alert-line') and 'Defina o dia de fechamento' in pg.inner_text('#alert-line') and 'Cartão XP' in pg.inner_text('#alert-line'), f'{tag}: one-line alert on the Painel')
    for t in ['tx', 'import', 'cats']:
        goto_tab(pg, t)
        check(pg.is_visible('#btn-alerts') and bell(pg)['count'] == 1, f'{tag}: bell visible on {t}')
    goto_tab(pg, 'painel')
    pg.click('#btn-alerts'); pg.wait_for_selector('#alerts-list')
    check(pg.locator('#alerts-list .al').count() == 1, f'{tag}: sheet lists it')
    shot(pg, f'{tag}-sheet-configurar')
    pg.click('#alerts-list [data-act="al-config"]'); pg.wait_for_selector('#acc-al-cartao[open]')
    check(pg.is_visible('#al-close-cartao') and pg.is_visible('#al-due-cartao'), f'{tag}: "Configurar conta" opens the account settings (closing + due day)')
    check(not pg.is_visible('#al-freq-cartao'), f'{tag}: …a card has no "Lembrar de atualizar"')
    check(pg.is_visible('#al-freq-conta') or J(pg, '() => !!document.querySelector("#al-freq-conta")'), f'{tag}: the checking account has "Lembrar de atualizar"')
    section(f'{tag} 2. "Sugerir pelos dados" pre-fills, nothing saved until Salvar')
    pg.click('#al-suggest-cartao'); pg.wait_for_selector('#al-sug-cartao')
    check(pg.input_value('#al-close-cartao') == '28' and pg.input_value('#al-due-cartao') == '5', f'{tag}: suggestion 28 / 5 ({pg.input_value("#al-close-cartao")} / {pg.input_value("#al-due-cartao")})')
    check('Sugestão pelos seus dados' in pg.inner_text('#al-sug-cartao'), f'{tag}: suggestion explained')
    check(J(pg, '() => __ff.D().accounts.find(a => a.id === "cartao").closingDay') is None, f'{tag}: not saved before confirming')
    no_hscroll(pg, f'{tag} account settings')
    shot(pg, f'{tag}-account-suggest')
    pg.click('#al-save-cartao'); pg.wait_for_timeout(300)
    acc = J(pg, '() => __ff.D().accounts.find(a => a.id === "cartao")')
    check(acc.get('closingDay') == 28 and acc.get('dueDay') == 5 and acc.get('alerts') is True and acc.get('updatedAt'), f'{tag}: saved closingDay/dueDay/alerts/updatedAt')
    check(J(pg, '() => __ff.D().accounts.find(a => a.id === "conta").closingDay') is None and 'remind' not in J(pg, '() => __ff.D().accounts.find(a => a.id === "conta")'), f'{tag}: the other account untouched')
    flushed(pg)
    if pg._ns:
        stored = db_meta(pg._ns, 'accounts')
        check(any(a['id'] == 'cartao' and a.get('closingDay') == 28 for a in stored['items']), f'{tag}: stored in the accounts meta doc')
    close_sheet(pg)

    section(f'{tag} 3. the fatura closed on 28/09 → alert with the right dates')
    ids = alert_ids(pg)
    check(ids == ['fatura_fechou:cartao:2026-09', 'fatura_vence:cartao:2026-09'], f'{tag}: fatura_fechou + fatura_vence ({ids})')
    a = J(pg, '() => __ff.alerts()[0]')
    check(a['title'] == 'Fatura de Cartão XP fechou em 28/09', f'{tag}: title "{a["title"]}"')
    check('vence 05/10' in a['detail'] and '28/08 a 27/09' in a['detail'], f'{tag}: detail "{a["detail"]}"')
    check(bell(pg)['badge'] == '2', f'{tag}: badge 2')
    check('Fatura fechou em 28/09' in pg.inner_text('#alert-line') and 'Cartão XP' in pg.inner_text('#alert-line') and pg.is_visible('#alert-line-import'), f'{tag}: Painel line shows the most urgent one')
    fits = J(pg, '() => { const t = document.querySelector("#alert-line .al-lead"); return t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().right <= document.querySelector("#alert-line .al-txt").getBoundingClientRect().right + 1; }')
    check(fits, f'{tag}: …the date part is never cut (the account name may be)')
    lh = J(pg, '() => document.querySelector("#alert-line").getBoundingClientRect().height')
    check(lh <= 56, f'{tag}: the Painel line is one line ({lh:.0f}px)')
    no_hscroll(pg, f'{tag} Painel with alert')
    shot(pg, f'{tag}-painel-alert')
    sticky_ok(pg, tag)

    section(f'{tag} 4. "Fechou em outra data"')
    pg.click('#btn-alerts'); pg.wait_for_selector('#alerts-list')
    pg.click('#alerts-list [data-aid="fatura_fechou:cartao:2026-09"] [data-act="al-other"]'); pg.wait_for_selector('#al-other-date')
    check(pg.input_value('#al-other-date') == '28/09/2026', f'{tag}: date field (dd/mm/aaaa) starts at the usual date')
    pg.fill('#al-other-date', '15082026'); pg.click('#al-other-save'); pg.wait_for_timeout(200)
    check(pg.is_visible('#al-other-err') and 'perto de 28/09/2026' in pg.inner_text('#al-other-err'), f'{tag}: a date far away is refused')
    pg.fill('#al-other-date', '26092026')
    check(pg.input_value('#al-other-date') == '26/09/2026', f'{tag}: typing digits masks to dd/mm/aaaa')
    no_hscroll(pg, f'{tag} override form')
    shot(pg, f'{tag}-sheet-override')
    pg.click('#al-other-save'); pg.wait_for_timeout(300)
    check(J(pg, '() => __ff.D().accounts.find(a => a.id === "cartao").cycleOverrides') == {'2026-09': '2026-09-26'}, f'{tag}: cycleOverrides["2026-09"] = 2026-09-26')
    a = J(pg, '() => __ff.alerts()[0]')
    check(a['id'] == 'fatura_fechou:cartao:2026-09' and a['title'].endswith('fechou em 26/09') and '28/08 a 25/09' in a['detail'], f'{tag}: same alert, new date ({a["title"]} · {a["detail"]})')
    check('fechou em 26/09' in pg.inner_text('#alerts-list [data-aid="fatura_fechou:cartao:2026-09"]'), f'{tag}: the sheet shows it')
    close_sheet(pg)
    open_acc_settings(pg, 'cartao')
    check('26/09/2026' in pg.inner_text('#acc-al-cartao .al-ovs'), f'{tag}: the account lists the override')
    pg.click('#acc-al-cartao [data-act="al-ov-del"]'); pg.wait_for_timeout(300)
    check(not J(pg, '() => __ff.D().accounts.find(a => a.id === "cartao").cycleOverrides["2026-09"]'), f'{tag}: removing it brings the usual day back')
    check(J(pg, '() => __ff.alerts()[0].title').endswith('28/09'), f'{tag}: …alert at 28/09 again')
    close_sheet(pg)

    section(f'{tag} 5. "Importar agora" → import the matching fatura → the alert disappears')
    pg.click('#btn-alerts'); pg.wait_for_selector('#alerts-list')
    pg.click('#alerts-list [data-aid="fatura_fechou:cartao:2026-09"] [data-act="al-import"]'); pg.wait_for_selector('#imp-acc')
    check(J(pg, '() => __ff.state().ui.tab') == 'import' and pg.input_value('#imp-acc') == 'cartao', f'{tag}: Importar opens with the card pre-selected')
    check(pg.is_visible('#imp-alert-note') and '05/10/2026' in pg.inner_text('#imp-alert-note'), f'{tag}: …and says which fatura ({pg.inner_text("#imp-alert-note")})')
    shot(pg, f'{tag}-import-from-alert')
    pg.set_input_files('#imp-file', [os.path.join(TMP, 'Fatura2026-10-05.csv')])
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"]', timeout=10000)
    pg.click('[data-act="imp-step"][data-s="4"]'); pg.wait_for_selector('[data-act="imp-commit"]')
    pg.click('[data-act="imp-commit"]'); pg.wait_for_timeout(600)
    rec = J(pg, '() => Object.values(__ff.D().imports).find(r => r.fileName === "Fatura2026-10-05.csv")')
    check(rec and rec.get('accountId') == 'cartao' and rec.get('to') == '2026-09-27', f'{tag}: imported into the card (to {rec and rec.get("to")})')
    ids = alert_ids(pg)
    check('fatura_fechou:cartao:2026-09' not in ids, f'{tag}: fatura_fechou gone after the import ({ids})')
    check(ids == ['fatura_vence:cartao:2026-09'], f'{tag}: the due-date reminder stays (payment not seen yet)')
    check(bell(pg)['badge'] == '1', f'{tag}: badge 1')
    goto_tab(pg, 'painel')
    check('Fatura vence em 05/10' in pg.inner_text('#alert-line'), f'{tag}: Painel line now "{pg.inner_text("#alert-line").strip()}"')

    section(f'{tag} 6. "Ignorar este ciclo" persists (reload, second device)')
    pg.click('#btn-alerts'); pg.wait_for_selector('#alerts-list')
    pg.click('#alerts-list [data-aid="fatura_vence:cartao:2026-09"] [data-act="al-dismiss"]'); pg.wait_for_timeout(300)
    check(pg.is_visible('#alerts-empty') and pg.is_visible('#al-undismiss'), f'{tag}: sheet empty, "Mostrar 1 alerta ignorado"')
    shot(pg, f'{tag}-sheet-empty')
    close_sheet(pg)
    bl = bell(pg)
    check(bl['shown'] and bl['count'] == 0 and bl['badge'] == '', f'{tag}: bell without a badge ({bl})')
    check(not pg.is_visible('#alert-line'), f'{tag}: no line on the Painel')
    check(J(pg, '() => __ff.D().settings.dismissedAlerts') == ['fatura_vence:cartao:2026-09'], f'{tag}: settings.dismissedAlerts')
    flushed(pg)
    reload(pg)
    check(alert_ids(pg) == [] and bell(pg)['count'] == 0, f'{tag}: still dismissed after reload')
    if second:
        c2, p2 = second()
        check(J(p2, '() => __ff.alerts().length') == 0 and J(p2, '() => __ff.D().settings.dismissedAlerts') == ['fatura_vence:cartao:2026-09'], f'{tag}: second synced page: dismissed there too')
        check(J(p2, '() => __ff.D().accounts.find(a => a.id === "cartao").closingDay') == 28, f'{tag}: second page has the closing day')
    section(f'{tag} 7. checking-account reminder')
    open_acc_settings(pg, 'conta')
    pg.select_option('#al-freq-conta', 'weekly'); pg.wait_for_timeout(100)
    check(not pg.is_visible('#al-day-conta'), f'{tag}: weekly → no day field')
    pg.click('#al-save-conta'); pg.wait_for_timeout(300)
    check(J(pg, '() => __ff.D().accounts.find(a => a.id === "conta").remind') == {'freq': 'weekly'}, f'{tag}: remind {{freq: weekly}} saved')
    ids = alert_ids(pg)
    check(ids == ['extrato_desatualizado:conta:2026-09-27'], f'{tag}: extrato_desatualizado (last data 20/09, weekly) ({ids})')
    a = J(pg, '() => __ff.alerts()[0]')
    check(a['title'] == 'Extrato de Conta XP desatualizado' and 'vão até 20/09 (há 13 dias)' in a['detail'] and 'toda semana' in a['detail'], f'{tag}: "{a["detail"]}"')
    pg.select_option('#al-freq-conta', 'monthly'); pg.wait_for_timeout(100)
    check(pg.is_visible('#al-day-conta'), f'{tag}: monthly → "Dia do mês"')
    pg.click('#al-save-conta'); pg.wait_for_timeout(200)
    check(pg.is_visible('#al-err-conta') and 'dia do mês' in pg.inner_text('#al-err-conta'), f'{tag}: monthly without a day is refused')
    pg.fill('#al-day-conta', '1'); pg.click('#al-save-conta'); pg.wait_for_timeout(300)
    check(alert_ids(pg) == ['extrato_desatualizado:conta:2026-10-01'], f'{tag}: monthly day 1 → reminder of 01/10 ({alert_ids(pg)})')
    no_hscroll(pg, f'{tag} checking settings')
    shot(pg, f'{tag}-account-checking')
    pg.select_option('#al-freq-conta', 'never'); pg.click('#al-save-conta'); pg.wait_for_timeout(300)
    check(alert_ids(pg) == [], f'{tag}: "Nunca" → no reminder')
    pg.select_option('#al-freq-conta', 'weekly'); pg.click('#al-save-conta'); pg.wait_for_timeout(300)
    close_sheet(pg)
    check(bell(pg)['count'] == 1, f'{tag}: weekly again → 1 alert')
    # alerts off for the account
    open_acc_settings(pg, 'conta')
    pg.uncheck('#al-on-conta'); pg.click('#al-save-conta'); pg.wait_for_timeout(300)
    check(alert_ids(pg) == [] and J(pg, '() => __ff.D().accounts.find(a => a.id === "conta").alerts') is False, f'{tag}: alerts off for the account → none')
    pg.check('#al-on-conta'); pg.click('#al-save-conta'); pg.wait_for_timeout(300)
    close_sheet(pg)
    flushed(pg)
    if second:
        ok = wait(p2, '() => __ff.alerts().length === 1 && __ff.alerts()[0].kind === "extrato_desatualizado"', 15000)
        check(ok, f'{tag}: second page receives the reminder settings (synced)')
        check(not p2._errs, f'{tag}: second page: no console errors {p2._errs[:3]}')
        c2.close()
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')


def screens(pg, tag):
    goto_tab(pg, 'painel')
    bl = bell(pg)
    check(bl['count'] == 3, f'{tag}: 3 open alerts ({alert_ids(pg)})')
    no_hscroll(pg, f'{tag} Painel')
    shot(pg, f'{tag}-painel')
    sticky_ok(pg, tag)
    pg.click('#btn-alerts'); pg.wait_for_selector('#alerts-list')
    n_sheet = pg.locator('#alerts-list .al').count()
    check(n_sheet == bl['count'] and bl['badge'] == str(n_sheet), f'{tag}: badge {bl["badge"]} = {n_sheet} cards in the sheet')
    no_hscroll(pg, f'{tag} alerts sheet')
    shot(pg, f'{tag}-sheet')
    pg.click('#alerts-list [data-aid="fatura_fechou:cartao:2026-09"] [data-act="al-other"]'); pg.wait_for_selector('#al-other-date')
    shot(pg, f'{tag}-sheet-override')
    close_sheet(pg)
    open_acc_settings(pg, 'cartao')
    pg.click('#al-suggest-cartao'); pg.wait_for_selector('#al-sug-cartao')
    J(pg, '() => document.querySelector("#acc-al-cartao").scrollIntoView({ block: "start" })')
    no_hscroll(pg, f'{tag} account settings')
    shot(pg, f'{tag}-account')
    close_sheet(pg)
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')


# ------------------------------------------------------------------------------------------------ scenarios
def scenario_artifact(b):
    section('A. Artifact build (fake claude.ai db), synthetic data, 390 light')
    meta, txs = synthetic()
    ns = 'v23a' + RUN
    seed_artifact(ns, meta, by_month(txs))
    ctx, pg = open_artifact(b, ns)
    check(J(pg, '() => __ff.state().auth.mode') == 'artifact', 'artifact mode')
    check(J(pg, '() => __ff.D().accounts.every(a => !("closingDay" in a) && !("remind" in a) && !("alerts" in a))'), 'migration keeps the existing accounts untouched')
    flow(pg, 'art-390-light', second=lambda: open_artifact(b, ns))
    ctx.close()
    section('A2. the next cycle (device date 29/10/2026): a dismissal covers one cycle only')
    ctx, pg = open_artifact(b, ns, now=datetime.datetime(2026, 10, 29, 10, 0, 0))
    ids = alert_ids(pg)
    check('fatura_fechou:cartao:2026-10' in ids and not any(i.endswith(':2026-09') for i in ids), f'29/10: the October fatura alert shows, September stays dismissed/imported ({ids})')
    goto_tab(pg, 'painel')
    check('Fatura fechou em 28/10' in pg.inner_text('#alert-line'), f'29/10: Painel line "{pg.inner_text("#alert-line").strip()}"')
    pg.click('#btn-alerts'); pg.wait_for_selector('#alerts-list')
    check(pg.locator('#alerts-list .al').count() == bell(pg)['count'], '29/10: badge = cards in the sheet')
    check(not pg._errs, f'29/10: no console errors {pg._errs[:3]}')
    ctx.close()


def scenario_screens(b):
    meta, txs = synthetic(configured=True)
    for (w, scheme) in ((390, 'dark'), (1280, 'light'), (1280, 'dark')):
        ns = f'v23s{w}{scheme}' + RUN
        seed_artifact(ns, meta, by_month(txs))
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        tag = f'art-{w}-{scheme}'
        section(f'S. {tag}')
        screens(pg, tag)
        ctx.close()


def scenario_local(b):
    section('L. site/ in local mode (real store.js), synthetic data')
    meta, txs = synthetic()
    ctx, pg = open_local(b, meta, txs)
    check(J(pg, '() => __ff.state().auth.mode') == 'local', 'local mode')
    flow(pg, 'loc-390-light')
    ctx.close()
    meta, txs = synthetic(configured=True)
    ctx, pg = open_local(b, meta, txs, 'dark', 1280, 900)
    screens(pg, 'loc-1280-dark')
    ctx.close()


def scenario_real(b):
    section('R. the user\'s real data (read-only snapshot through the fake db): "Sugerir pelos dados"')
    if not os.path.isdir(os.path.join(REAL_DB, 'v2meta')):
        print('  skip (no snapshot at FF_REAL_ARTIFACT_DB)')
        return
    meta = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2meta', '*.json'))}
    months = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2months', '*.json'))}
    n = sum(len([t for t in d.get('transactions', []) if not t.get('deleted')]) for d in months.values())
    for (w, scheme) in ((390, 'light'), (390, 'dark'), (1280, 'light')):
        ns = f'v23real{w}{scheme}' + RUN
        seed_artifact(ns, meta, months, raw_docs=True)
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        tag = f'real-{w}-{scheme}'
        check(J(pg, '() => __ff.live().length') == n, f'{tag}: all {n} rows loaded')
        before = json.dumps(db_meta(ns, 'accounts'), sort_keys=True)
        kinds = J(pg, '() => __ff.alerts().map(a => a.kind)')
        check(all(k == 'configurar' for k in kinds) and bell(pg)['count'] == len(kinds), f'{tag}: before configuring, only "configurar" alerts ({len(kinds)})')
        goto_tab(pg, 'painel')
        no_hscroll(pg, f'{tag} Painel')
        shot(pg, f'{tag}-painel')
        cards = J(pg, '() => __ff.D().accounts.filter(a => a.type === "credit_card").map(a => a.id)')
        open_acc_settings(pg, cards[0])
        for i, acc in enumerate(cards):
            if i:
                pg.click(f'#acc-al-{acc} > summary'); pg.wait_for_timeout(100)
            pg.click(f'#al-suggest-{acc}'); pg.wait_for_selector(f'#al-sug-{acc}')
            cd, dd = pg.input_value(f'#al-close-{acc}'), pg.input_value(f'#al-due-{acc}')
            n_imp = J(pg, f'() => Object.values(__ff.D().imports).filter(r => r.accountId === {json.dumps(acc)}).length')
            if w == 390 and scheme == 'light':
                REPORT.append(f'card #{i + 1} ({n_imp} imports): closing day {cd or "-"}, due day {dd or "-"}')
                print(f'  inferred: card #{i + 1}: closing day {cd or "-"}, due day {dd or "-"}')
            if cd:
                check(1 <= int(cd) <= 31 and (not dd or 1 <= int(dd) <= 31), f'{tag}: card #{i + 1}: plausible days ({cd}/{dd})')
            else:
                check('Não deu para sugerir' in pg.inner_text(f'#al-sug-{acc}') or dd, f'{tag}: card #{i + 1}: says it could not suggest')
            J(pg, f'() => document.querySelector("#acc-al-{acc}").scrollIntoView({{ block: "start" }})')
            shot(pg, f'{tag}-suggest-{i + 1}')
        no_hscroll(pg, f'{tag} account settings')
        flushed(pg)
        check(json.dumps(db_meta(ns, 'accounts'), sort_keys=True) == before, f'{tag}: nothing saved without "Salvar"')
        check(all(not a.get('closingDay') for a in J(pg, '() => __ff.D().accounts')), f'{tag}: …nor in memory')
        if w == 390 and scheme == 'light':
            # confirm the first card's suggestion → its alerts compute with no exceptions
            pg.click(f'#al-save-{cards[0]}'); pg.wait_for_timeout(300)
            ks = J(pg, '() => __ff.alerts().map(a => a.kind)')
            REPORT.append('after saving card #1: alerts ' + ', '.join(ks))
            print('  alerts after saving card #1:', ks)
            check(isinstance(ks, list), f'{tag}: alerts computed after confirming')
            close_sheet(pg)
            goto_tab(pg, 'painel')
            shot(pg, f'{tag}-painel-configured')
            pg.click('#btn-alerts'); pg.wait_for_selector('#alerts-body')
            no_hscroll(pg, f'{tag} alerts sheet')
            shot(pg, f'{tag}-sheet')
            close_sheet(pg)
            hc = J(pg, '() => __ff.health().filter(w => w.id.startsWith("c:")).length')
            check(hc >= 0, f'{tag}: data health with cycles computes ({hc} payment notes)')
        check(not pg._errs, f'{tag}: no console errors with the real data {pg._errs[:2]}')
        ctx.close()


def main():
    srv = artifact_server.start(PORT)
    lsrv = site_server.start(LPORT)
    only = sys.argv[1:] or ['A', 'S', 'L', 'R']
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            if 'A' in only:
                scenario_artifact(b)
            if 'S' in only:
                scenario_screens(b)
            if 'L' in only:
                scenario_local(b)
            if 'R' in only:
                scenario_real(b)
        finally:
            b.close()
    srv.shutdown()
    lsrv.shutdown()
    if REPORT:
        print('\nReal snapshot:')
        for r in REPORT:
            print('  ' + r)
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
