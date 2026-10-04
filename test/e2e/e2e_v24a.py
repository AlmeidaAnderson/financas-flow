"""End-to-end tests of the v2.4a changes in headless Chromium:
  1. several files at once with ONE "Conta para todos os arquivos" + "Alterar só este" per file; "+ Nova conta" created
     once (pending until "Importar"), shown in every selector, reused by name; kind mismatch → automatic override.
  2. CNPJ help: the Artifact build links to a readable company page (cnpj.biz) + "Outra fonte" (Google); the paste box
     takes text copied from such a page. The Netlify build shows the /api/cnpj answer (mocked here) as a readable card.
  3. "Gerenciar dados": delete by file (one import / every import of the same file name), by month (+ account), an
     account (or only its rows), a selection in Transações (+ "Mudar categoria"); in-page confirmation, "Desfazer",
     dependent data cleaned; deletions reach a second page and survive its stale save of the same month.

Usage: npm run build:artifact && python3 test/e2e/e2e_v24a.py [A] [S] [L] [R] [N]
  A. Artifact build with the fake window.claude (fake claude db), SYNTHETIC data — full flow at 390 light, two pages.
  S. 390 dark / 1280 light / 1280 dark: batch list, CNPJ help, Gerenciar dados and selection screens.
  L. site/ in local mode (real store.js, localStorage): the full flow at 390 light and 1280 dark.
  R. the user's real data (read-only snapshot through the fake db, when present): Gerenciar dados plans on realistic
     volumes; prints only counts.
  N. Netlify build (test harness, CSP on, fake Identity) with /api/cnpj mocked by the browser.
Screenshots: screens/v24a/*.png (gitignored)."""
import sys, os, json, re, time, glob, subprocess, tempfile, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402
import server as site_server  # noqa: E402

PORT = int(os.environ.get('FF_V24A_PORT', '8797'))
HPORT = int(os.environ.get('FF_V24A_HARNESS_PORT', '8798'))
LPORT = int(os.environ.get('FF_V24A_LOCAL_PORT', '8799'))
LURL = f'http://127.0.0.1:{LPORT}/'
REAL_DB = os.environ.get('FF_REAL_ARTIFACT_DB', '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db5/data/users/me/ff')
URL = f'http://127.0.0.1:{PORT}/'
HURL = f'http://127.0.0.1:{HPORT}/'
SCR = os.path.join(ROOT, 'screens', 'v24a')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
FAKE_ID = open(os.path.join(HERE, 'fake_identity.mjs'), encoding='utf-8').read()
CSP_HOOK = """window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));"""
UID = 'u_e2e_v24a'
BASE = f'data/users/{UID}/ff'
RUN = str(int(time.time()))
TMP = tempfile.mkdtemp(prefix='ff-v24a-')
STAMP = '2026-10-01T12:00:00.000Z'
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []


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


def no_hscroll(pg, label):
    r = J(pg, '() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    check(r[0] <= r[1], f'{label}: no horizontal page scroll ({r[0]} <= {r[1]})')


# ------------------------------------------------------------------------------------------------ synthetic files
FAT_HDR = 'Data;Estabelecimento;Portador;Valor;Parcela'
FILES = {
    'fatura-y-2026-08.csv': '\n'.join([FAT_HDR,
        '04/08/2026;PADARIA DO BAIRRO 1;FULANO;14,50;-',
        '09/08/2026;IFOOD *LANCHE;FULANO;38,90;-',
        '15/08/2026;LIVRARIA CENTRAL;FULANO;79,00;-',
        '21/08/2026;POSTO AVENIDA;FULANO;150,00;-']) + '\n',
    'fatura-y-2026-09.csv': '\n'.join([FAT_HDR,
        '03/09/2026;PADARIA DO BAIRRO 2;FULANO;16,00;-',
        '11/09/2026;CINEMA SHOPPING;FULANO;64,00;-',
        '19/09/2026;FARMACIA POPULAR 9;FULANO;27,30;-']) + '\n',
    'extrato-y-2026-09.csv': '\n'.join(['Data;Hora;Descrição;Valor;Saldo',
        '02/09/26;08:15;Rendimento automático;0,22;3.000,22',
        '08/09/26;10:00;TED recebida de CLIENTE TESTE;1.200,00;4.200,22',
        '14/09/26;11:00;Pix enviado para Maria Teste;-80,00;4.120,22',
        '28/09/26;09:30;Conta de luz;-140,00;3.980,22']) + '\n',
}
for n_, txt in FILES.items():
    open(os.path.join(TMP, n_), 'w', encoding='utf-8').write(txt)


def engine_profiles():
    js = ("const E=require('./site/engine.js');const f=JSON.parse(require('fs').readFileSync(0,'utf8'));"
          "const o={};for(const k in f)o[k]=E.profileFromAnalysis(E.analyzeTable(f[k]));console.log(JSON.stringify(o));")
    out = subprocess.run(['node', '-e', js], cwd=ROOT, input=json.dumps(FILES), capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def synthetic():
    prof = engine_profiles()
    # recognized layouts WITHOUT an account: the batch has to ask for one (shared)
    fy = dict(prof['fatura-y-2026-08.csv'], id='pf-faty', name='Fatura Y')
    ey = dict(prof['extrato-y-2026-09.csv'], id='pf-exty', name='Extrato Y')
    nu = {'id': 'pf-nu', 'name': 'Nubank CSV', 'defaultAccountId': 'nu', 'columns': {'date': 0, 'description': 1, 'amount': 2}, 'fingerprint': 'nu-fp', 'updatedAt': STAMP}
    txs = []
    n = [0]

    def t(date, amount, raw, acc, imp, cat=None, **kw):
        n[0] += 1
        row = {'id': f'v24-{n[0]}', 'date': date, 'amount': amount, 'rawDescription': raw, 'merchant': raw.upper(), 'accountId': acc,
               'kind': kw.pop('kind', 'expense' if amount < 0 else 'income'), 'categoryId': cat, 'catSource': 'manual' if cat else None,
               'importId': imp, 'updatedAt': STAMP}
        row.update(kw)
        txs.append(row)
    for m in ('07', '08', '09'):
        t(f'2026-{m}-05', 500000, 'SALARIO ACME', 'conta', 'imp-ext', 'renda.salario')
        t(f'2026-{m}-10', -250000, 'ALUGUEL APTO 12', 'conta', 'imp-ext', 'moradia.aluguel')
    # the same fatura file imported twice (the second time it brought one more row)
    t('2026-07-06', -6000, 'SUPERMERCADO BOM', 'cartao', 'imp-j1', 'alimentacao.mercado')
    t('2026-07-12', -1200, 'UBER TRIP', 'cartao', 'imp-j1', 'transporte.app')
    t('2026-07-20', -5590, 'NETFLIX', 'cartao', 'imp-j1', 'lazer.streaming')
    t('2026-07-25', -2500, 'BANCA JORNAL', 'cartao', 'imp-j2')
    for d, a, raw, cat in [('2026-08-03', -7000, 'SUPERMERCADO BOM', 'alimentacao.mercado'), ('2026-08-11', -5490, 'JOSE FARMA LTDA 11.222.333/0001-81', None),
                           ('2026-08-16', -5590, 'NETFLIX', 'lazer.streaming'), ('2026-08-22', -3100, 'BAR DO ZE', None)]:
        t(d, a, raw, 'cartao', 'imp-ago', cat)
    for d, a, raw in [('2026-09-03', -2390, 'UBER *TRIP'), ('2026-09-12', -8900, 'LIVRARIA CULTURA'), ('2026-09-21', -15000, 'POSTO IPIRANGA')]:
        t(d, a, raw, 'nu', 'imp-nu')

    def rec(i, fn, acc, at):
        rows = [r for r in txs if r['importId'] == i]
        ds = sorted(r['date'] for r in rows)
        return {'id': i, 'fileName': fn, 'at': at, 'updatedAt': STAMP, 'accountId': acc, 'count': len(rows), 'total': sum(r['amount'] for r in rows), 'from': ds[0], 'to': ds[-1]}
    meta = {
        'accounts': {'items': [{'id': 'cartao', 'name': 'Cartão XP', 'type': 'credit_card'}, {'id': 'conta', 'name': 'Conta XP', 'type': 'checking'},
                               {'id': 'nu', 'name': 'Nubank', 'type': 'credit_card', 'closingDay': 28, 'dueDay': 5, 'updatedAt': STAMP}]},
        'profiles': {'items': [fy, ey, nu]},
        'imports': {'imp-ext': rec('imp-ext', 'extrato-xp.csv', 'conta', '2026-10-01T10:00:00Z'),
                    'imp-j1': rec('imp-j1', 'fatura-xp-2026-07.csv', 'cartao', '2026-08-02T10:00:00Z'),
                    'imp-j2': rec('imp-j2', 'fatura-xp-2026-07.csv', 'cartao', '2026-08-03T10:00:00Z'),
                    'imp-ago': rec('imp-ago', 'fatura-xp-2026-08.csv', 'cartao', '2026-09-02T10:00:00Z'),
                    'imp-nu': rec('imp-nu', 'nubank-2026-09.csv', 'nu', '2026-10-01T09:00:00Z')},
        'settings': {'budgets': {}, 'schemaVersion': 2, 'dismissedAlerts': ['fatura_fechou:nu:2026-09', 'configurar:cartao'], 'updatedAt': STAMP},
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


def seed_artifact(ns, meta, months, raw_docs=False):
    for name, data in meta.items():
        doc = data if raw_docs else {'v': 2, 'kind': 'meta', 'name': name, 'data': data, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + name, 'parent': None}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2meta/{name}', 'data': doc})
    for ym, rows in months.items():
        doc = rows if raw_docs else {'v': 2, 'kind': 'month', 'ym': ym, 'transactions': rows, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + ym}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2months/{ym}', 'data': doc})


def db_month(ns, ym):
    d = (artifact_server.docs(ns).get(f'{BASE}/v2months/{ym}') or {}).get('data') or {}
    return {r['id']: r for r in (d.get('transactions') or [])}


def db_meta(ns, name):
    return (artifact_server.docs(ns).get(f'{BASE}/v2meta/{name}') or {}).get('data', {}).get('data')


def stored_month(pg, ns, ym):
    """rows as the store keeps them: the fake claude db (artifact, tombstones included) or localStorage (local mode)"""
    if ns:
        return db_month(ns, ym)
    rows = J(pg, '(ym) => { const d = JSON.parse(localStorage.getItem("ff2:local") || "{}"); return ((d.months || {})[ym]) || []; }', ym)
    return {r['id']: r for r in rows}


def stored_meta(pg, ns, name):
    if ns:
        return db_meta(ns, name)
    return J(pg, '(n) => { const d = JSON.parse(localStorage.getItem("ff2:local") || "{}"); return ((d.meta || {})[n]) || null; }', name)


def gone_in_store(pg, ns, ym, ids):
    st = stored_month(pg, ns, ym)
    return all((i not in st) or st[i].get('deleted') for i in ids)


def live_in_store(pg, ns, ym, ids):
    st = stored_month(pg, ns, ym)
    return all(i in st and not st[i].get('deleted') for i in ids)


def new_ctx(b, scheme, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* xlsx stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    ctx.route(re.compile(r'https://(www\.google\.com|cnpj\.biz|brasilapi\.com\.br)/.*'), lambda r: r.fulfill(status=200, body='external', content_type='text/plain'))
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
    pg.wait_for_timeout(300)
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


def ids_where(pg, pred):
    return J(pg, f'() => __ff.live().filter(t => {pred}).map(t => t.id).sort()')


def open_manage(pg):
    if pg.is_visible('.sheet'):
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.click('#btn-settings'); pg.wait_for_selector('#btn-manage')
    pg.click('#btn-manage'); pg.wait_for_selector('#man-body #man-file')


def toast_undo(pg):
    pg.wait_for_selector('#toast-act', timeout=4000)
    check('Desfazer' in pg.inner_text('#toast-act'), 'toast offers "Desfazer"')
    pg.click('#toast-act'); pg.wait_for_timeout(300)


def row_sel(name):
    return f'.bf:has(.nm:text-is("{name}"))'


def opt_count(pg, sel, label):
    return J(pg, '([s, l]) => [...document.querySelectorAll(s + " option")].filter(o => o.textContent.startsWith(l)).length', [sel, label])


# ------------------------------------------------------------------------------------------------ 1. batch
def flow_batch(pg, tag):
    section(f'{tag} 1. several files, one account for all, override per file, "+ Nova conta" once')
    goto_tab(pg, 'import')
    n_acc0 = J(pg, '() => __ff.D().accounts.length')
    names = ['fatura-y-2026-09.csv', 'extrato-y-2026-09.csv', 'fatura-y-2026-08.csv']
    pg.set_input_files('#imp-file', [os.path.join(TMP, x) for x in names])
    pg.wait_for_selector('#bf-list .bf >> nth=2', timeout=10000)
    keys = {x: pg.get_attribute(row_sel(x), 'data-key') for x in names}
    fa, fb, ex = keys['fatura-y-2026-08.csv'], keys['fatura-y-2026-09.csv'], keys['extrato-y-2026-09.csv']
    check(pg.is_visible('#bf-shared') and 'Conta para todos os arquivos' in pg.inner_text('#bf-shared-box'), f'{tag}: ONE "Conta para todos os arquivos" selector at the top')
    check(pg.input_value('#bf-shared') == '', f'{tag}: layouts without an account → nothing pre-selected')
    check(pg.locator('[data-needacc]').count() == 3 and pg.is_disabled('#bf-import'), f'{tag}: every file waits for the shared account; nothing to import yet')
    check(pg.locator('[data-bfacc]').count() == 0, f'{tag}: no per-file account selector until "Alterar só este"')
    check('Extrato bancário' in pg.inner_text(row_sel('extrato-y-2026-09.csv')) and 'Fatura de cartão' in pg.inner_text(row_sel('fatura-y-2026-08.csv')), f'{tag}: kinds detected')
    # "+ Nova conta" at the top
    pg.select_option('#bf-shared', '__new'); pg.wait_for_selector('#bf-newacc')
    check(pg.input_value('#bf-new-type') == 'credit_card', f'{tag}: new shared account typed from the files (2 faturas, 1 extrato → cartão)')
    pg.fill('#bf-new-name', 'Cartão Y'); pg.click('#bf-new-create'); pg.wait_for_timeout(250)
    pend = J(pg, '() => __ff.state().imp.batch.newAccs')
    check(len(pend) == 1 and pend[0]['name'] == 'Cartão Y' and J(pg, '() => __ff.D().accounts.length') == n_acc0, f'{tag}: created ONCE, pending until "Importar" ({pend})')
    check(pg.input_value('#bf-shared') == pend[0]['id'], f'{tag}: the shared selector now shows it')
    for k in (fa, fb):
        check('Cartão Y' in pg.inner_text(f'[data-inherit="{k}"]'), f'{tag}: fatura row inherits "Cartão Y"')
    # the extrato does not fit a card: automatic override to the only checking account, with a note
    check(pg.input_value(f'[data-bfacc="{ex}"]') == 'conta' and pg.is_visible(f'[data-note="{ex}"]') and 'Só este arquivo' in pg.inner_text(f'[data-note="{ex}"]'), f'{tag}: extrato → auto-override to Conta XP with a note')
    check(not pg.is_visible(f'[data-mismatch="{ex}"]'), f'{tag}: …so no red warning')
    check(opt_count(pg, '#bf-shared', 'Cartão Y') == 1 and opt_count(pg, f'[data-bfacc="{ex}"]', 'Cartão Y') == 1, f'{tag}: the new account appears in every selector, once')
    check(pg.inner_text('#bf-import').strip() == 'Importar 3 arquivos', f'{tag}: all 3 ready ({pg.inner_text("#bf-import")})')
    shot(pg, f'{tag}-batch-shared')
    no_hscroll(pg, f'{tag} batch')
    # a row picks "+ Nova conta" with the same name (other case) → the same pending account
    pg.click(f'#bf-own-{fb}'); pg.wait_for_selector(f'[data-bfacc="{fb}"]')
    pg.select_option(f'[data-bfacc="{fb}"]', '__new'); pg.wait_for_selector('#bf-newacc')
    pg.fill('#bf-new-name', '  cartão y '); pg.click('#bf-new-create'); pg.wait_for_timeout(250)
    check(len(J(pg, '() => __ff.state().imp.batch.newAccs')) == 1 and pg.input_value(f'[data-bfacc="{fb}"]') == pend[0]['id'], f'{tag}: same name in a row → reuses the pending account (no duplicate)')
    # switch back and forth: still one
    pg.select_option('#bf-shared', 'cartao'); pg.wait_for_timeout(150)
    check(pg.input_value(f'[data-bfacc="{ex}"]') == 'conta', f'{tag}: shared → Cartão XP: the extrato keeps its auto-override')
    pg.select_option('#bf-shared', pend[0]['id']); pg.wait_for_timeout(150)
    check(len(J(pg, '() => __ff.state().imp.batch.newAccs')) == 1 and opt_count(pg, '#bf-shared', 'Cartão Y') == 1, f'{tag}: back and forth → still ONE pending account')
    # one manual override: fatura-09 → Cartão XP
    pg.select_option(f'[data-bfacc="{fb}"]', 'cartao'); pg.wait_for_timeout(150)
    check(pg.input_value(f'[data-bfacc="{fb}"]') == 'cartao' and 'Voltar ao padrão' in pg.inner_text(f'#bf-default-{fb}'), f'{tag}: "Alterar só este" → this file to Cartão XP')
    check('1' in pg.inner_text('#bf-shared-hint') or '2' in pg.inner_text('#bf-shared-hint'), f'{tag}: the top says how many files have their own account')
    # extrato back to the default → red warning + one-tap fix
    pg.click(f'#bf-default-{ex}'); pg.wait_for_timeout(200)
    mis = f'[data-mismatch="{ex}"]'
    check(pg.is_visible(mis) and 'Conta errada?' in pg.inner_text(mis), f'{tag}: extrato following the card → red mismatch warning')
    shot(pg, f'{tag}-batch-mismatch')
    pg.click(f'{mis} [data-act="bf-fix"][data-to="conta"]'); pg.wait_for_timeout(200)
    check(not pg.is_visible(mis) and pg.input_value(f'[data-bfacc="{ex}"]') == 'conta', f'{tag}: "Usar Conta XP" fixes it for that file only')
    check(pg.is_visible(f'[data-inherit="{fa}"]'), f'{tag}: fatura-08 still follows the shared account')
    shot(pg, f'{tag}-batch-override')
    pg.click('#bf-import'); pg.wait_for_selector('#batch-done', timeout=10000)
    accs = J(pg, '() => __ff.D().accounts')
    ys = [a for a in accs if a['name'] == 'Cartão Y']
    check(len(ys) == 1 and ys[0]['type'] == 'credit_card' and len(accs) == n_acc0 + 1, f'{tag}: exactly one "Cartão Y" account created ({[a["name"] for a in accs]})')
    yid = ys[0]['id'] if ys else None
    recs = {r['fileName']: r for r in J(pg, '() => Object.values(__ff.D().imports)')}
    check(recs['fatura-y-2026-08.csv']['accountId'] == yid and recs['fatura-y-2026-09.csv']['accountId'] == 'cartao' and recs['extrato-y-2026-09.csv']['accountId'] == 'conta',
          f'{tag}: each file went to its account (shared / override / fix)')
    check(J(pg, '(y) => __ff.live().filter(t => t.accountId === y).length', yid) == 4, f'{tag}: the 4 rows of fatura-08 are in Cartão Y')
    shot(pg, f'{tag}-batch-done')
    # next batch: "+ Nova conta" with the name of an existing account → that account, never a second one
    pg.click('[data-act="imp-reset"]'); pg.wait_for_timeout(200)
    pg.set_input_files('#imp-file', [os.path.join(TMP, 'fatura-y-2026-08.csv'), os.path.join(TMP, 'fatura-y-2026-09.csv')])
    pg.wait_for_selector('#bf-list .bf >> nth=1')
    check(pg.input_value('#bf-shared') in (yid, 'cartao'), f'{tag}: next time the layout knows its account ({pg.input_value("#bf-shared")})')
    pg.select_option('#bf-shared', '__new'); pg.fill('#bf-new-name', 'CARTÃO Y'); pg.click('#bf-new-create'); pg.wait_for_timeout(200)
    check(pg.input_value('#bf-shared') == yid and not J(pg, '() => __ff.state().imp.batch.newAccs.length'), f'{tag}: "+ Nova conta" "CARTÃO Y" → the existing Cartão Y, no new account')
    pg.click('[data-act="bf-reset"]'); pg.wait_for_timeout(150)
    flushed(pg)
    return yid


# ------------------------------------------------------------------------------------------------ 2. CNPJ (artifact)
CNPJ_PAGE = ('JOSE FARMA LTDA\nCNPJ: 11.222.333/0001-81\nAbertura: 01/02/2003\nCEP: 01310-100 · (11) 3333-4444\n'
             'Atividade Principal\n47.71-7-01 - Comércio varejista de produtos farmacêuticos, sem manipulação de fórmulas\n'
             'Atividades Secundárias\n56.11-2-01 - Restaurantes e similares')


def flow_cnpj_artifact(pg, tag):
    section(f'{tag} 2. CNPJ help in the Artifact build: cnpj.biz + "Outra fonte" + paste the page text')
    tid = J(pg, '() => __ff.live().find(t => /JOSE FARMA/.test(t.rawDescription)).id')
    goto_tab(pg, 'tx')
    pg.fill('#tx-search', 'JOSE FARMA'); pg.wait_for_timeout(300)
    pg.click(f'#tx-list .tx[data-id="{tid}"]'); pg.wait_for_selector('#ed-cat')
    if not pg.is_visible('#ed-cnpj'):
        pg.click('.sheet .help-d summary')
    check(pg.get_attribute('#ed-cnpj', 'href') == 'https://cnpj.biz/11222333000181', f'{tag}: "Consultar CNPJ" → https://cnpj.biz/<14 digits>')
    alt = urllib.parse.unquote_plus(pg.get_attribute('#ed-cnpj-alt', 'href') or '')
    check(alt.startswith('https://www.google.com/search?q=') and 'CNPJ 11.222.333/0001-81' in alt and 'Outra fonte' in pg.inner_text('#ed-cnpj-alt'), f'{tag}: small "Outra fonte" → Google "CNPJ <formatted>"')
    check(pg.get_attribute('#ed-cnpj', 'target') == '_blank' and pg.get_attribute('#ed-cnpj-alt', 'rel') == 'noopener noreferrer', f'{tag}: both open a new tab')
    check(not J(pg, '() => [...document.querySelectorAll("a[href]")].some(a => /brasilapi|\\/api\\/cnpj/i.test(a.href))'), f'{tag}: no link to the JSON API anywhere')
    pg.fill('#ed-cnae', CNPJ_PAGE); pg.wait_for_selector('#ed-cnae-out .sug-btn')
    out = pg.inner_text('#ed-cnae-out')
    check('Farmácia' in out and '4771-7/01' in out, f'{tag}: page text pasted → CNAE 4771-7/01 → chip "Farmácia" ({out[:80]})')
    pg.fill('#ed-cnae', '4771-7/01'); pg.wait_for_timeout(100)
    check('Farmácia' in pg.inner_text('#ed-cnae-out'), f'{tag}: "4771-7/01" alone works too')
    pg.fill('#ed-cnae', 'Atividade econômica principal: Restaurantes e similares'); pg.wait_for_timeout(100)
    check('Restaurante' in pg.inner_text('#ed-cnae-out'), f'{tag}: the activity text alone → Restaurante chip')
    pg.fill('#ed-cnae', CNPJ_PAGE); pg.wait_for_selector('#ed-cnae-out .sug-btn')
    check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', tid) is None, f'{tag}: nothing assigned before the tap')
    pg.locator('#ed-cnpj').scroll_into_view_if_needed()
    shot(pg, f'{tag}-cnpj-artifact')
    no_hscroll(pg, f'{tag} editor')
    pg.click('#ed-cnae-out .sug-btn'); pg.wait_for_timeout(150)
    check(pg.input_value('#ed-cat') == 'saude.farmacia', f'{tag}: chip → category picked in the editor')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.fill('#tx-search', ''); pg.wait_for_timeout(250)


# ------------------------------------------------------------------------------------------------ 3. Gerenciar dados
def flow_delete(pg, tag, ns):
    section(f'{tag} 3a. Excluir por arquivo (one import, every import of the same file name) + Desfazer')
    open_manage(pg)
    txt = pg.inner_text('#man-file')
    check('fatura-xp-2026-07.csv' in txt and 'Cartão XP' in txt and '06/07 – 20/07/2026' in txt and '3 lançamentos' in txt, f'{tag}: list shows file, account, date range, rows')
    j1 = ids_where(pg, 't.importId === "imp-j1"'); j2 = ids_where(pg, 't.importId === "imp-j2"')
    pg.click('.man-opt[data-id="imp-j1"]'); pg.wait_for_selector('#del-plan')
    plan = pg.inner_text('#del-plan')
    check(pg.inner_text('[data-del-count]') == '3' and 'jul/26' in plan and 'R$' in plan, f'{tag}: confirmation shows rows, months and sum ({plan.splitlines()[:4]})')
    check(pg.is_visible('#man-allfile'), f'{tag}: same file imported twice → "Excluir todas as importações deste arquivo"')
    pg.check('#man-allfile'); pg.wait_for_timeout(150)
    check(pg.inner_text('[data-del-count]') == '4', f'{tag}: …covers both imports (4 rows)')
    shot(pg, f'{tag}-manage-file')
    no_hscroll(pg, f'{tag} manage')
    n0 = len(J(pg, '() => __ff.live()'))
    pg.click('#del-do'); pg.wait_for_timeout(300)
    check(len(J(pg, '() => __ff.live()')) == n0 - 4 and not J(pg, '() => ["imp-j1","imp-j2"].some(k => __ff.D().imports[k])'), f'{tag}: 4 rows + both import records gone')
    check(J(pg, '() => FinEngine.dataIntegrity({ transactions: __ff.live(), imports: __ff.D().imports, accounts: __ff.D().accounts }).length') == 0, f'{tag}: data consistent (no orphan imports)')
    toast_undo(pg)
    check(ids_where(pg, 't.importId === "imp-j1"') == j1 and ids_where(pg, 't.importId === "imp-j2"') == j2 and J(pg, '() => !!__ff.D().imports["imp-j1"] && !!__ff.D().imports["imp-j2"]'), f'{tag}: Desfazer → rows and records back')
    check(J(pg, '(ids) => ids.every(id => __ff.live().find(t => t.id === id).updatedAt > "2026-10-02")', j1), f'{tag}: restored rows re-saved with a new updatedAt')
    pg.click('.man-opt[data-id="imp-j1"]'); pg.wait_for_selector('#del-plan')
    pg.click('#del-do'); pg.wait_for_timeout(300)
    check(not ids_where(pg, 't.importId === "imp-j1"') and ids_where(pg, 't.importId === "imp-j2"') == j2, f'{tag}: only that import → its 3 rows go, the other import stays')
    flushed(pg)
    check(gone_in_store(pg, ns, '2026-07', j1), f'{tag}: the store no longer holds them' + (' (tombstones in the db)' if ns else ''))

    section(f'{tag} 3b. Excluir mês (+ one account) + Desfazer from the sheet')
    aug_conta = ids_where(pg, 't.date.startsWith("2026-08") && t.accountId === "conta"')
    aug_card = ids_where(pg, 't.date.startsWith("2026-08") && t.accountId !== "conta"')
    pg.select_option('#man-month-sel', '2026-08'); pg.wait_for_timeout(100)
    pg.select_option('#man-month-acc', 'conta'); pg.wait_for_timeout(100)
    pg.click('#man-month-go'); pg.wait_for_selector('#del-plan')
    check(pg.inner_text('[data-del-count]') == str(len(aug_conta)) and 'ago/26' in pg.inner_text('#del-plan') and 'Conta XP' in pg.inner_text('#del-plan'), f'{tag}: plan = Agosto of Conta XP only ({len(aug_conta)} rows)')
    shot(pg, f'{tag}-manage-month')
    pg.click('#del-do'); pg.wait_for_timeout(300)
    check(not ids_where(pg, 't.date.startsWith("2026-08") && t.accountId === "conta"') and ids_where(pg, 't.date.startsWith("2026-08") && t.accountId !== "conta"') == aug_card, f'{tag}: August of Conta XP gone, the card stays')
    ext = J(pg, '() => __ff.D().imports["imp-ext"]')
    check(ext['count'] == 4 and ext['from'] == '2026-07-05' and ext['to'] == '2026-09-10', f'{tag}: the extrato import record now covers what is left ({ext["count"]}, {ext["from"]}–{ext["to"]})')
    check(pg.is_visible('#man-undo-btn'), f'{tag}: "Desfazer" in Gerenciar dados too')
    pg.click('#man-undo-btn'); pg.wait_for_timeout(300)
    check(ids_where(pg, 't.date.startsWith("2026-08") && t.accountId === "conta"') == aug_conta and J(pg, '() => __ff.D().imports["imp-ext"].count') == 6, f'{tag}: undone → rows and the import record back')
    pg.select_option('#man-month-sel', '2026-08'); pg.select_option('#man-month-acc', 'conta'); pg.wait_for_timeout(100)
    pg.click('#man-month-go'); pg.wait_for_selector('#del-plan'); pg.click('#del-do'); pg.wait_for_timeout(300)
    flushed(pg)
    check(gone_in_store(pg, ns, '2026-08', aug_conta) and live_in_store(pg, ns, '2026-08', aug_card), f'{tag}: stored month: only the deleted rows are gone')

    section(f'{tag} 3c. Excluir conta (and dependents) + Desfazer; "Manter a conta, apagar só os lançamentos"')
    nu = ids_where(pg, 't.accountId === "nu"')
    pg.select_option('#man-acc-sel', 'nu'); pg.wait_for_timeout(100)
    pg.click('#man-acc-go'); pg.wait_for_selector('#del-plan')
    plan = pg.inner_text('#del-plan')
    check(pg.inner_text('[data-del-count]') == str(len(nu)) and 'A conta Nubank' in plan and 'set/26' in plan, f'{tag}: plan names the account, rows and months')
    shot(pg, f'{tag}-manage-account')
    pg.click('#del-do'); pg.wait_for_timeout(300)
    check(not J(pg, '() => __ff.D().accounts.some(a => a.id === "nu")') and not ids_where(pg, 't.accountId === "nu"'), f'{tag}: account + its rows gone')
    check(not J(pg, '() => __ff.D().imports["imp-nu"]'), f'{tag}: its import record gone')
    check(J(pg, '() => __ff.D().settings.dismissedAlerts') == ['configurar:cartao'], f'{tag}: dismissed alerts of the account cleaned')
    check(J(pg, '() => __ff.D().profiles.find(p => p.id === "pf-nu").defaultAccountId') is None, f'{tag}: the layout no longer points to it')
    check(J(pg, '() => FinEngine.dataIntegrity({ transactions: __ff.live(), imports: __ff.D().imports, accounts: __ff.D().accounts }).length') == 0, f'{tag}: data consistent')
    toast_undo(pg)
    check(J(pg, '() => __ff.D().accounts.some(a => a.id === "nu" && a.closingDay === 28)') and ids_where(pg, 't.accountId === "nu"') == nu, f'{tag}: Desfazer → account (with its settings) and rows back')
    check('fatura_fechou:nu:2026-09' in J(pg, '() => __ff.D().settings.dismissedAlerts') and J(pg, '() => __ff.D().profiles.find(p => p.id === "pf-nu").defaultAccountId') == 'nu' and J(pg, '() => !!__ff.D().imports["imp-nu"]'), f'{tag}: …and its alert dismissal, layout default and import record')
    pg.select_option('#man-acc-sel', 'nu'); pg.check('#man-keep-yes'); pg.wait_for_timeout(100)
    pg.click('#man-acc-go'); pg.wait_for_selector('#del-plan')
    check('A conta' not in pg.inner_text('#del-plan'), f'{tag}: "manter a conta" → only the rows in the plan')
    pg.click('#del-do'); pg.wait_for_timeout(300)
    check(J(pg, '() => __ff.D().accounts.some(a => a.id === "nu")') and not ids_where(pg, 't.accountId === "nu"'), f'{tag}: account kept, rows gone')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    flushed(pg)
    accs = stored_meta(pg, ns, 'accounts')
    check(accs and any(a['id'] == 'nu' for a in accs['items']), f'{tag}: stored accounts keep Nubank')

    section(f'{tag} 3d. Seleção em Transações: select, all in filter, change category, delete, undo')
    goto_tab(pg, 'tx')
    pg.click('#btn-select'); pg.wait_for_selector('#sel-bar')
    sep = ids_where(pg, 't.date.startsWith("2026-09") && t.accountId === "conta"')
    pg.fill('#tx-search', 'ALUGUEL'); pg.wait_for_timeout(300)
    n_f = len(J(pg, '() => [...document.querySelectorAll("#tx-list .tx")]'))
    pg.click('#sel-all'); pg.wait_for_timeout(150)
    check(pg.inner_text('#sel-count') == str(n_f) and n_f >= 2, f'{tag}: "Todos do filtro" selects the {n_f} rows of the current filter')
    pg.click('#sel-cat'); pg.wait_for_selector('#bulk-cat')
    pg.select_option('#bulk-cat', 'moradia.condominio'); pg.click('#bulk-cat-apply'); pg.wait_for_timeout(300)
    check(J(pg, '() => __ff.live().filter(t => t.rawDescription === "ALUGUEL APTO 12").every(t => t.categoryId === "moradia.condominio" && t.catSource === "manual")'), f'{tag}: "Mudar categoria dos selecionados"')
    toast_undo(pg)
    check(J(pg, '() => __ff.live().filter(t => t.rawDescription === "ALUGUEL APTO 12").every(t => t.categoryId === "moradia.aluguel")'), f'{tag}: Desfazer → categories back')
    pg.click('#sel-none'); pg.fill('#tx-search', ''); pg.wait_for_timeout(300)
    for i in sep[:2]:
        pg.click(f'#tx-list .tx[data-id="{i}"]'); pg.wait_for_timeout(80)
    check(pg.inner_text('#sel-count') == '2' and pg.locator('#tx-list .tx[aria-pressed="true"]').count() == 2, f'{tag}: tapping rows selects them (checkbox), no editor opens')
    check(not pg.is_visible('.sheet'), f'{tag}: …no editor sheet')
    shot(pg, f'{tag}-select')
    no_hscroll(pg, f'{tag} select mode')
    pg.click('#sel-del'); pg.wait_for_selector('#del-plan')
    check(pg.inner_text('[data-del-count]') == '2' and 'set/26' in pg.inner_text('#del-plan'), f'{tag}: "Excluir selecionados" → confirmation (2 rows, set/26)')
    shot(pg, f'{tag}-select-confirm')
    pg.click('#del-do'); pg.wait_for_timeout(300)
    check(not J(pg, '(ids) => __ff.live().some(t => ids.includes(t.id))', sep[:2]), f'{tag}: deleted')
    toast_undo(pg)
    check(J(pg, '(ids) => ids.every(id => __ff.live().some(t => t.id === id))', sep[:2]), f'{tag}: Desfazer → back')
    for i in sep[:2]:
        pg.click(f'#tx-list .tx[data-id="{i}"]'); pg.wait_for_timeout(80)
    pg.click('#sel-del'); pg.wait_for_selector('#del-plan'); pg.click('#del-do'); pg.wait_for_timeout(300)
    pg.click('#sel-done'); pg.wait_for_timeout(150)
    check(not pg.is_visible('#sel-bar') and pg.is_visible('#btn-select'), f'{tag}: "Concluir" leaves the selection mode')
    flushed(pg)

    section(f'{tag} 3f. a whole month (every account) → the month empties; Desfazer AFTER it was saved; reload')
    jul = ids_where(pg, 't.date.startsWith("2026-07")')
    open_manage(pg)
    pg.select_option('#man-month-sel', '2026-07'); pg.wait_for_timeout(100)
    pg.click('#man-month-go'); pg.wait_for_selector('#del-plan')
    check(pg.inner_text('[data-del-count]') == str(len(jul)) and 'Conta XP' in pg.inner_text('#del-plan') and 'Cartão XP' in pg.inner_text('#del-plan'), f'{tag}: "Todas as contas" → every row of July ({len(jul)}), both accounts named')
    pg.click('#del-do'); pg.wait_for_timeout(300)
    flushed(pg)
    check(not ids_where(pg, 't.date.startsWith("2026-07")') and gone_in_store(pg, ns, '2026-07', jul), f'{tag}: July emptied in the store')
    check('2026-07' not in J(pg, '() => [...document.querySelectorAll("#man-month-sel option")].map(o => o.value)'), f'{tag}: July no longer offered in "Excluir mês"')
    pg.click('#man-undo-btn'); pg.wait_for_timeout(300)
    flushed(pg)
    check(ids_where(pg, 't.date.startsWith("2026-07")') == jul and live_in_store(pg, ns, '2026-07', jul), f'{tag}: Desfazer after the save → rows live again in the store (newer than the tombstones)')
    reload(pg)
    check(ids_where(pg, 't.date.startsWith("2026-07")') == jul, f'{tag}: …and after a reload')
    check(J(pg, '() => FinEngine.dataIntegrity({ transactions: __ff.live(), imports: __ff.D().imports, accounts: __ff.D().accounts }).length') == 0, f'{tag}: data consistent after undo')
    open_manage(pg)
    pg.select_option('#man-month-sel', '2026-07'); pg.wait_for_timeout(100)
    pg.click('#man-month-go'); pg.wait_for_selector('#del-plan'); pg.click('#del-do'); pg.wait_for_timeout(300)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    flushed(pg)
    reload(pg)
    check(not ids_where(pg, 't.date.startsWith("2026-07")'), f'{tag}: deleted again → stays deleted after a reload')
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')
    return {'j1': j1, 'aug_conta': aug_conta, 'nu': nu, 'sep': sep[:2], 'jul': jul}


def flow_sync(b, ns, A, gone):
    section('A 3e. a second page: deletions arrive; its stale save of the same month does not bring them back')
    cb, B = open_artifact(b, ns, 'dark', 1280, 900)
    all_gone = gone['j1'] + gone['aug_conta'] + gone['nu'] + gone['sep'] + gone['jul']
    check(not J(B, '(ids) => __ff.live().some(t => ids.includes(t.id))', all_gone), 'B opens without any deleted row')
    # B goes stale (no change feed), A deletes more of September, B edits another September row and saves
    cb.route('**/__fakedb/changes*', lambda r: r.fulfill(status=200, body='{"seq":0,"changes":[]}', content_type='application/json'))
    B.wait_for_timeout(500)
    victims = ids_where(A, 't.date.startsWith("2026-09") && t.accountId === "cartao"')
    open_manage(A)
    A.select_option('#man-month-sel', '2026-09'); A.select_option('#man-month-acc', 'cartao'); A.wait_for_timeout(100)
    A.click('#man-month-go'); A.wait_for_selector('#del-plan'); A.click('#del-do'); A.wait_for_timeout(300)
    flushed(A)
    check(victims and all(db_month(ns, '2026-09').get(i, {}).get('deleted') for i in victims), f'A: {len(victims)} September card rows deleted (tombstones in the db)')
    stale = J(B, '(ids) => ids.filter(id => __ff.live().some(t => t.id === id)).length', victims)
    check(stale == len(victims), f'B is stale: still shows the {stale} deleted rows')
    keep = J(B, '() => __ff.live().find(t => t.date.startsWith("2026-09") && t.accountId === "conta")')
    goto_tab(B, 'tx'); B.fill('#tx-search', keep['rawDescription'][:12]); B.wait_for_timeout(300)
    B.click(f'#tx-list .tx[data-id="{keep["id"]}"]'); B.wait_for_selector('#ed-note')
    B.fill('#ed-note', 'editado no aparelho desatualizado'); B.click('[data-act="savetx"]'); B.wait_for_timeout(200)
    flushed(B)
    cb.unroute('**/__fakedb/changes*')
    st = db_month(ns, '2026-09')
    check(all(st.get(i, {}).get('deleted') for i in victims), 'after B saved its stale September: the deleted rows are still tombstones')
    check(st.get(keep['id'], {}).get('note') == 'editado no aparelho desatualizado', "…and B's edit is there")
    reload(A); reload(B)
    for nm, pg in (('A', A), ('B', B)):
        check(not J(pg, '(ids) => __ff.live().some(t => ids.includes(t.id))', victims + all_gone), f'{nm} after reload: no deleted row came back')
    check(J(A, '(id) => __ff.live().find(t => t.id === id).note', keep['id']) == 'editado no aparelho desatualizado', 'A sees B\'s edit')
    shot(B, 'sync-B-1280-dark')
    check(not B._errs, f'B: no console errors {B._errs[:3]}')
    cb.close()


# ------------------------------------------------------------------------------------------------ scenarios
def scenario_artifact(b):
    section('A. Artifact build (fake claude.ai db), synthetic data, 390 light')
    meta, txs = synthetic()
    ns = 'v24a' + RUN
    seed_artifact(ns, meta, by_month(txs))
    ctx, pg = open_artifact(b, ns)
    check(J(pg, '() => __ff.state().auth.mode') == 'artifact', 'artifact mode')
    flow_batch(pg, 'art-390-light')
    flow_cnpj_artifact(pg, 'art-390-light')
    gone = flow_delete(pg, 'art-390-light', ns)
    flow_sync(b, ns, pg, gone)
    # Contas e importações links to Gerenciar dados
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    pg.click('#btn-settings'); pg.click('#btn-accounts'); pg.wait_for_selector('#btn-manage-imp')
    pg.click('#btn-manage-imp'); pg.wait_for_selector('#man-body #man-file')
    check(True, 'Importações → "Gerenciar dados"')
    pg.keyboard.press('Escape')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()


def scenario_screens(b):
    meta, txs = synthetic()
    for (w, scheme) in ((390, 'dark'), (1280, 'light'), (1280, 'dark')):
        tag = f'art-{w}-{scheme}'
        section(tag)
        ns = f'v24s{w}{scheme}' + RUN
        seed_artifact(ns, meta, by_month(txs))
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        screens(pg, tag)
        ctx.close()


def screens(pg, tag):
    if True:
        goto_tab(pg, 'import')
        pg.set_input_files('#imp-file', [os.path.join(TMP, x) for x in FILES])
        pg.wait_for_selector('#bf-list .bf >> nth=2', timeout=10000)
        pg.select_option('#bf-shared', '__new'); pg.fill('#bf-new-name', 'Cartão Y'); pg.click('#bf-new-create'); pg.wait_for_timeout(200)
        key = pg.get_attribute(row_sel('fatura-y-2026-09.csv'), 'data-key')
        pg.click(f'#bf-own-{key}'); pg.wait_for_timeout(100)
        check(pg.inner_text('#bf-import').strip() == 'Importar 3 arquivos', f'{tag}: shared account → 3 ready')
        no_hscroll(pg, f'{tag} batch')
        shot(pg, f'{tag}-batch', full=True)
        pg.click('[data-act="bf-reset"]')
        flow_cnpj_artifact(pg, tag)
        open_manage(pg)
        pg.click('.man-opt[data-id="imp-j1"]'); pg.wait_for_selector('#del-plan')
        no_hscroll(pg, f'{tag} manage')
        shot(pg, f'{tag}-manage')
        pg.select_option('#man-acc-sel', 'nu'); pg.click('#man-acc-go'); pg.wait_for_selector('#man-acc #del-plan')
        pg.locator('#man-acc #del-plan').scroll_into_view_if_needed()
        shot(pg, f'{tag}-manage-account')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        goto_tab(pg, 'tx'); pg.click('#btn-select'); pg.wait_for_selector('#sel-bar')
        for i in J(pg, '() => [...document.querySelectorAll("#tx-list .tx")].slice(0, 3).map(e => e.dataset.id)'):
            pg.click(f'#tx-list .tx[data-id="{i}"]')
        pg.click('#sel-del'); pg.wait_for_selector('#del-plan')
        check(pg.inner_text('[data-del-count]') == '3', f'{tag}: 3 selected → plan')
        no_hscroll(pg, f'{tag} select')
        shot(pg, f'{tag}-select')
        pg.click('#del-do'); pg.wait_for_timeout(300)
        toast_undo(pg)
        check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')


def open_local(b, meta, txs, scheme='light', w=390, h=844):
    ctx = new_ctx(b, scheme, w, h)
    pg = ctx.new_page()
    attach(pg)
    pg.goto(LURL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    J(pg, 'async (b) => { await __ff.store().importAll(b); }', {'version': 2, 'meta': meta, 'months': by_month(txs)})
    reload(pg)
    return ctx, pg


def scenario_local(b):
    section('L. site/ in local mode (real store.js, localStorage), synthetic data, 390 light')
    meta, txs = synthetic()
    ctx, pg = open_local(b, meta, txs)
    check(J(pg, '() => __ff.state().auth.mode') == 'local', 'local mode')
    flow_batch(pg, 'loc-390-light')
    flow_cnpj_artifact(pg, 'loc-390-light')
    flow_delete(pg, 'loc-390-light', None)
    ctx.close()
    section('L. local mode 1280 dark screens')
    ctx, pg = open_local(b, meta, txs, 'dark', 1280, 900)
    screens(pg, 'loc-1280-dark')
    ctx.close()


def scenario_real(b):
    section("R. the user's real data (read-only snapshot through the fake db): Gerenciar dados on realistic volumes")
    if not os.path.isdir(os.path.join(REAL_DB, 'v2meta')):
        print('  skip (no snapshot at FF_REAL_ARTIFACT_DB)')
        return
    meta = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2meta', '*.json'))}
    months = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2months', '*.json'))}
    n = sum(len([t for t in d.get('transactions', []) if not t.get('deleted')]) for d in months.values())
    integ = '() => FinEngine.dataIntegrity({ transactions: __ff.live(), imports: __ff.D().imports, accounts: __ff.D().accounts }).length'
    for (w, scheme) in ((390, 'light'), (1280, 'dark')):
        ns = f'v24real{w}{scheme}' + RUN
        seed_artifact(ns, meta, months, raw_docs=True)
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        tag = f'real-{w}-{scheme}'
        check(J(pg, '() => __ff.live().length') == n, f'{tag}: all {n} rows loaded')
        bad0 = J(pg, integ)
        open_manage(pg)
        imps = J(pg, '() => [...document.querySelectorAll(".man-opt")].map(e => e.dataset.id)')
        check(len(imps) == len([r for r in J(pg, '() => Object.values(__ff.D().imports)') if r]), f'{tag}: every import listed ({len(imps)})')
        # the import with the most rows: plan = its rows
        big = J(pg, '() => { const c = {}; __ff.live().forEach(t => { if (t.importId) c[t.importId] = (c[t.importId] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; }')
        t0 = time.time()
        pg.click(f'.man-opt[data-id="{big[0]}"]'); pg.wait_for_selector('#del-plan')
        check(pg.inner_text('[data-del-count]') == str(big[1]), f'{tag}: biggest import → plan of {big[1]} rows ({int((time.time() - t0) * 1000)} ms)')
        no_hscroll(pg, f'{tag} manage file')
        shot(pg, f'{tag}-manage-file')
        pg.click('#del-cancel'); pg.wait_for_timeout(100)
        # every month: plan count = rows of the month
        for ym in J(pg, '() => [...document.querySelectorAll("#man-month-sel option")].map(o => o.value).filter(Boolean)'):
            pg.select_option('#man-month-sel', ym); pg.click('#man-month-go'); pg.wait_for_selector('#del-plan')
            exp = J(pg, '(ym) => __ff.live().filter(t => t.date.startsWith(ym)).length', ym)
            check(pg.inner_text('[data-del-count]') == str(exp), f'{tag}: month {ym} → plan of {exp} rows')
            pg.click('#del-cancel'); pg.wait_for_timeout(80)
        # every account: plan = its rows
        for acc in J(pg, '() => __ff.D().accounts.map(a => a.id)'):
            pg.select_option('#man-acc-sel', acc); pg.click('#man-acc-go'); pg.wait_for_selector('#del-plan')
            exp = J(pg, '(a) => __ff.live().filter(t => t.accountId === a).length', acc)
            check(pg.inner_text('[data-del-count]') == str(exp), f'{tag}: an account → plan of {exp} rows')
            pg.click('#del-cancel'); pg.wait_for_timeout(80)
        pg.select_option('#man-acc-sel', J(pg, '() => __ff.D().accounts[0].id')); pg.click('#man-acc-go'); pg.wait_for_selector('#del-plan')
        pg.locator('#man-acc #del-plan').scroll_into_view_if_needed()
        no_hscroll(pg, f'{tag} manage account')
        shot(pg, f'{tag}-manage-account')
        pg.click('#del-cancel'); pg.wait_for_timeout(80)
        # delete the biggest import, check consistency, undo → everything back (nothing saved to the snapshot: fake db only)
        pg.click(f'.man-opt[data-id="{big[0]}"]'); pg.wait_for_selector('#del-plan'); pg.click('#del-do'); pg.wait_for_timeout(400)
        check(J(pg, '() => __ff.live().length') == n - big[1] and J(pg, integ) <= bad0, f'{tag}: deleted {big[1]} rows; no new consistency issue ({bad0} before)')
        pg.click('#man-undo-btn'); pg.wait_for_timeout(400)
        check(J(pg, '() => __ff.live().length') == n and J(pg, '(id) => !!__ff.D().imports[id]', big[0]), f'{tag}: Desfazer → all {n} rows and the import record back')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        goto_tab(pg, 'tx'); pg.click('#btn-select'); pg.wait_for_selector('#sel-bar')
        t0 = time.time()
        pg.click('#sel-all'); pg.wait_for_timeout(100)
        nf = J(pg, '() => __ff.state().ui.sel.size')
        check(nf > 0 and pg.inner_text('#sel-count') == str(nf), f'{tag}: "Todos do filtro" on real volume ({nf} rows, {int((time.time() - t0) * 1000)} ms)')
        no_hscroll(pg, f'{tag} select')
        shot(pg, f'{tag}-select')
        pg.click('#sel-done')
        check(not pg._errs, f'{tag}: no console errors with the real data {pg._errs[:2]}')
        ctx.close()


def scenario_netlify(b):
    section('N. Netlify build: "Consultar CNPJ" → readable card from a mocked /api/cnpj (CSP on)')
    env = dict(os.environ, PORT=str(HPORT))
    proc = subprocess.Popen(['node', os.path.join(HERE, 'netlify_harness.mjs'), str(HPORT)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    MOCK = {'cnpj': '11222333000181', 'cached': False, 'razao_social': 'FARMACIA MOCK LTDA', 'nome_fantasia': 'FARMA MOCK',
            'cnae_fiscal': 4771701, 'cnae_fiscal_descricao': 'Comércio varejista de produtos farmacêuticos, sem manipulação de fórmulas', 'municipio': 'CAMPINAS', 'uf': 'SP'}
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(HURL + 'index.html', timeout=1); break
            except Exception:
                time.sleep(0.1)
        for (w, scheme) in ((390, 'light'), (1280, 'dark')):
            tag = f'netlify-{w}-{scheme}'
            ctx = b.new_context(viewport={'width': w, 'height': 900}, color_scheme=scheme, device_scale_factor=2, service_workers='block')
            ctx.route(re.compile(r'https://fonts\.googleapis\.com/.*'), lambda r: r.fulfill(status=200, body='/* fonts */', content_type='text/css'))
            ctx.route(re.compile(r'https://fonts\.gstatic\.com/.*'), lambda r: r.fulfill(status=404, body=''))
            ctx.route('**/vendor/netlify-identity.js', lambda r: r.fulfill(status=200, body=FAKE_ID, content_type='text/javascript'))
            calls = []

            ctx.route('**/api/cnpj/**', lambda route: (calls.append(route.request.url), route.fulfill(status=200, body=json.dumps(MOCK), content_type='application/json')))
            ctx.add_init_script(CSP_HOOK)
            pg = ctx.new_page()
            attach(pg)
            pg.goto(HURL)
            pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
            pg.click('#signed-out [data-act="login"]'); pg.wait_for_selector('#ffl-email')
            pg.fill('#ffl-email', f'v24a{w}{scheme}{RUN}@exemplo.com'); pg.fill('#ffl-pass', 'senha-certa-123')
            pg.click('.ffl-card button[type="submit"]')
            wait(pg, '() => !!__ff.state().auth.user', 10000)
            goto_tab(pg, 'import')
            pg.select_option('#imp-acc', '__new'); pg.fill('#imp-acc-name', 'Conta CNPJ'); pg.select_option('#imp-acc-type', 'checking')
            pg.click('#scr-import details summary')
            pg.fill('#imp-paste', 'Data;Descrição;Valor\n05/09/2026;JOSE FARMA LTDA 11.222.333/0001-81;-54,90\n06/09/2026;LOJA SEM CADASTRO;-12,00\n')
            pg.click('[data-act="imp-paste"]')
            pg.wait_for_selector('[data-act="imp-step"][data-s="3"], [data-act="imp-step"][data-s="4"]')
            if not pg.is_visible('[data-act="imp-step"][data-s="4"]'):
                pg.click('[data-act="imp-step"][data-s="3"]')
            pg.click('[data-act="imp-step"][data-s="4"]'); pg.click('[data-act="imp-commit"]'); pg.wait_for_selector('#imp-done')
            tid = J(pg, '() => __ff.live().find(t => /JOSE FARMA/.test(t.rawDescription)).id')
            goto_tab(pg, 'tx'); pg.fill('#tx-search', 'JOSE'); pg.wait_for_timeout(300)
            pg.click(f'#tx-list .tx[data-id="{tid}"]'); pg.wait_for_selector('#ed-cat')
            if not pg.is_visible('#ed-cnpj'):
                pg.click('.sheet .help-d summary')
            check(J(pg, '() => document.querySelector("#ed-cnpj").tagName') == 'BUTTON' and not pg.is_visible('#ed-cnae'), f'{tag}: Netlify → automatic lookup button, no paste box')
            check(not calls, f'{tag}: nothing requested before the tap')
            pg.click('#ed-cnpj'); pg.wait_for_selector('#ed-cnpj-card', timeout=8000)
            card = pg.inner_text('#ed-cnpj-card')
            check(len(calls) == 1 and calls[0].endswith('/api/cnpj/11222333000181'), f'{tag}: one call to /api/cnpj/<cnpj> ({calls})')
            for lbl, val in (('Razão social', 'FARMACIA MOCK LTDA'), ('Nome fantasia', 'FARMA MOCK'), ('Atividade principal', 'farmacêuticos'), ('Cidade/UF', 'CAMPINAS/SP')):
                check(lbl in card and val in card, f'{tag}: card shows {lbl}: {val}')
            check('{' not in card and 'cnae_fiscal' not in card and '"' not in card, f'{tag}: readable — no raw JSON')
            check('4771-7/01' in card, f'{tag}: CNAE formatted')
            check(pg.locator('#ed-cnpj-out .sug-btn').count() == 1 and 'Farmácia' in pg.inner_text('#ed-cnpj-out .sug-btn'), f'{tag}: category chip')
            check(not J(pg, '() => [...document.querySelectorAll("a[href]")].some(a => /brasilapi|\\/api\\/cnpj/i.test(a.href))'), f'{tag}: no user-facing link to the JSON API')
            pg.locator('#ed-cnpj-card').scroll_into_view_if_needed()
            shot(pg, f'{tag}-cnpj-card')
            no_hscroll(pg, tag)
            pg.click('#ed-cnpj-out .sug-btn'); pg.wait_for_timeout(150)
            check(pg.input_value('#ed-cat') == 'saude.farmacia', f'{tag}: chip → category picked')
            pg.keyboard.press('Escape')
            # Gerenciar dados works in the Netlify build too (CSP: no inline handlers)
            open_manage(pg)
            pg.click('.man-opt >> nth=0'); pg.wait_for_selector('#del-plan')
            pg.click('#del-do'); pg.wait_for_timeout(300)
            check(not J(pg, '() => __ff.live().length'), f'{tag}: delete the only import')
            toast_undo(pg)
            check(J(pg, '() => __ff.live().length') == 2, f'{tag}: Desfazer brings both rows back')
            csp = J(pg, '() => window.__csp')
            check(not csp, f'{tag}: no CSP violations {csp[:3]}')
            errs = [e for e in pg._errs if 'fonts.gstatic' not in e]
            check(not errs, f'{tag}: no console errors {errs[:3]}')
            ctx.close()
    finally:
        proc.terminate()


def main():
    srv = artifact_server.start(PORT)
    lsrv = site_server.start(LPORT)
    only = sys.argv[1:] or ['A', 'S', 'L', 'R', 'N']
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
            if 'N' in only:
                scenario_netlify(b)
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
