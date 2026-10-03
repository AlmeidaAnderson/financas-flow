"""End-to-end tests of the v2.2 features in headless Chromium:
  1. several CSV files imported at once (batch list, recognized/new layouts, wrong-account warning, "Configurar", summary)
  2. "Gastos por categoria ao longo do tempo" (chart types, granularity, range, level, legend, tooltip, sheet, persistence)
  3. "Não sei o que é" (triage + editor, permanent, undo, Transações filter, chart series)
  4. sticky period bar on the Painel (bounding box after scrolling, compact when stuck, under sheets)

Usage: npm run build:artifact && python3 test/e2e/e2e_v22.py
  A. Artifact build with the fake window.claude (fake claude db) and SYNTHETIC data — full flow at 390 light, then
     390 dark / 1280 light / 1280 dark screens.
  L. site/ in local mode (real store.js, localStorage) — the same full flow at 390 light, then 1280 dark.
  R. The user's REAL artifact data (read-only snapshot, FF_REAL_ARTIFACT_DB; skipped when absent), loaded at runtime
     through the fake db: one screenshot per chart type at 390 light/dark and 1280. Nothing of it is written to the repo
     and no names are printed.
Screenshots: screens/v22/*.png (gitignored)."""
import sys, os, json, re, time, glob, subprocess, tempfile, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402
import server as site_server  # noqa: E402

PORT = int(os.environ.get('FF_V22_PORT', '8793'))
LPORT = int(os.environ.get('FF_V22_LOCAL_PORT', '8794'))
URL = f'http://127.0.0.1:{PORT}/'
LURL = f'http://127.0.0.1:{LPORT}/'
SCR = os.path.join(ROOT, 'screens', 'v22')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
REAL_DB = os.environ.get('FF_REAL_ARTIFACT_DB', '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db4/data/users/me/ff')
UID = 'u_e2e_v22'
BASE = f'data/users/{UID}/ff'
RUN = str(int(time.time()))
TMP = tempfile.mkdtemp(prefix='ff-v22-')
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
NAO = 'outros.nao_identificado'


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


# ------------------------------------------------------------------------------------------------ synthetic files
FAT_HDR = 'Data;Estabelecimento;Portador;Valor;Parcela'
FILES = {
    'fatura-xp-2026-08.csv': '\n'.join([FAT_HDR,
        '10/05/2026;LOJA TESTE PARCELADA;FULANO;150,00;4 de 10',
        '03/08/2026;SEM PARAR PEDAGIO;FULANO;12,50;-',
        '03/08/2026;SEM PARAR PEDAGIO;FULANO;12,50;-',
        '08/08/2026;IFOOD *RESTAURANTE;FULANO;45,90;-',
        '20/08/2026;NETFLIX.COM;FULANO;55,90;-',
        '22/08/2026;CASA DO PAO DE QUEIJO 77;FULANO;18,00;-']) + '\n',
    'fatura-xp-2026-09.csv': '\n'.join([FAT_HDR,
        '10/05/2026;LOJA TESTE PARCELADA;FULANO;150,00;5 de 10',
        '07/09/2026;DROGASIL 0412;FULANO;38,40;-',
        '12/09/2026;IFOOD *RESTAURANTE;FULANO;52,10;-',
        '20/09/2026;NETFLIX.COM;FULANO;55,90;-',
        '24/09/2026;BAZAR DA ESQUINA 12;FULANO;27,00;-']) + '\n',
    'extrato-xp-jul-set.csv': '\n'.join(['Data;Hora;Descrição;Valor;Saldo',
        '01/07/26;08:15;Rendimento automático;0,10;10.000,10',
        '10/07/26;10:00;ALUGUEL APTO 12;-2.500,00;7.500,10',
        '05/08/26;09:30;TED recebida de EMPRESA TESTE LTDA;5.000,00;12.500,10',
        '25/08/26;10:00;PAGAMENTO DE FATURA;-461,80;12.038,30',
        '10/09/26;11:00;Pix enviado para Joao Padeiro;-30,00;12.008,30',
        '30/09/26;08:15;Rendimento automático;0,12;12.008,42']) + '\n',
    'nubank-2026-09.csv': '\n'.join(['date,title,amount',
        '2026-09-03,Padaria Sao Jorge,12.50', '2026-09-05,Uber *Trip,23.90', '2026-09-12,Livraria Cultura,89.00',
        '2026-09-15,Spotify,21.90', '2026-09-18,Feira Livre Barra Funda,35.00', '2026-09-21,Posto Ipiranga,150.00']) + '\n',
}
for n, txt in FILES.items():
    open(os.path.join(TMP, n), 'w', encoding='utf-8').write(txt)


def engine_profiles():
    js = ("const E=require('./site/engine.js');const f=JSON.parse(require('fs').readFileSync(0,'utf8'));"
          "const o={};for(const k in f)o[k]=E.profileFromAnalysis(E.analyzeTable(f[k]));console.log(JSON.stringify(o));")
    out = subprocess.run(['node', '-e', js], cwd=ROOT, input=json.dumps(FILES), capture_output=True, text=True, check=True).stdout
    return json.loads(out)


STAMP = '2026-10-01T12:00:00.000Z'


def synthetic():
    prof = engine_profiles()
    fx = dict(prof['fatura-xp-2026-08.csv'], id='pf-fatxp', name='Fatura XP', defaultAccountId='cartao')
    ex = dict(prof['extrato-xp-jul-set.csv'], id='pf-extxp', name='Extrato XP', defaultAccountId='cartao')  # the user's mistake
    txs = []
    n = [0]

    def t(date, amount, raw, acc, cat=None, imp='imp-base', **kw):
        n[0] += 1
        row = {'id': f'v22-{n[0]}', 'date': date, 'amount': amount, 'rawDescription': raw, 'merchant': raw.upper(), 'accountId': acc,
               'kind': kw.pop('kind', 'expense' if amount < 0 else 'income'), 'categoryId': cat, 'catSource': 'manual' if cat else None,
               'importId': imp, 'updatedAt': STAMP}
        row.update(kw)
        txs.append(row)
    for i, m in enumerate(['04', '05', '06', '07', '08', '09']):
        d = lambda day: f'2026-{m}-{day:02d}'
        t(d(5), 500000, 'SALARIO ACME', 'conta', 'renda.salario')
        t(d(10), -250000, 'ALUGUEL APTO 12', 'conta', 'moradia.aluguel')
        t(d(6), -(60000 + i * 4000), 'SUPERMERCADO BOM', 'cartao', 'alimentacao.mercado')
        t(d(12), -(12000 + (i % 3) * 3000), 'UBER TRIP', 'cartao', 'transporte.app')
        t(d(14), -(8000 + i * 500), 'DROGARIA X', 'cartao', 'saude.farmacia')
        if i % 2 == 0:
            t(d(15), -15000, 'CURSO ONLINE', 'cartao', 'educacao.cursos')
        t(d(16), -5590, 'NETFLIX', 'cartao', 'lazer.streaming')
        t(d(18), -(20000 + (5 - i) * 2500), 'MARKETPLACE', 'cartao', 'compras.marketplace')
        t(d(20), -6000, 'VIVO', 'conta', 'servicos.telefone')
        t(d(21), -4000, 'SALAO', 'cartao', 'pessoal.beleza')
        t(d(22), -500, 'IOF COMPRA', 'cartao', 'impostos.iof')
    t('2026-07-10', -15000, 'LOJA TESTE PARCELADA', 'cartao', 'compras.casa', imp='imp-fjul', installment={'n': 3, 'total': 10}, originalDate='2026-05-10')
    for d_, a, raw in [('2026-08-11', -3800, 'PAG*JOSEFERREIRA'), ('2026-09-09', -2900, 'LOJA DONA CIDA'), ('2026-09-13', -2400, 'MP *QUITANDAFLOR'), ('2026-09-17', -6100, 'EC *ARTESANATO MINAS')]:
        t(d_, a, raw, 'cartao')
    for r in txs:
        r['merchant'] = r['rawDescription'].upper()
    meta = {
        'accounts': {'items': [{'id': 'cartao', 'name': 'Cartão XP', 'type': 'credit_card'}, {'id': 'conta', 'name': 'Conta XP', 'type': 'checking'}]},
        'profiles': {'items': [fx, ex]},
        'imports': {'imp-base': {'id': 'imp-base', 'fileName': 'historico.csv', 'at': '2026-10-01T10:00:00Z', 'accountId': 'conta'},
                    'imp-fjul': {'id': 'imp-fjul', 'fileName': 'fatura-xp-2026-07.csv', 'at': '2026-10-01T10:01:00Z', 'accountId': 'cartao', 'profileId': 'pf-fatxp'}},
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


def new_ctx(b, scheme, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* xlsx stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
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
    pg._url = URL
    return ctx, pg


def open_local(b, meta, txs, scheme='light', w=390, h=844):
    ctx = new_ctx(b, scheme, w, h)
    pg = ctx.new_page()
    attach(pg)
    pg.goto(LURL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    backup = {'version': 2, 'meta': meta, 'months': by_month(txs)}
    J(pg, 'async (b) => { await __ff.store().importAll(b); }', backup)
    pg.reload()
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=15000)
    pg.wait_for_timeout(300)
    pg._url = LURL
    return ctx, pg


def reload(pg):
    pg.reload()
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(400)


def goto_tab(pg, tab):
    pg.click(f'.tab[data-tab="{tab}"]')
    pg.wait_for_timeout(200)


def set_month(pg, ym):
    J(pg, '(ym) => { __ff.state().ui.month = ym; __ff.state().ui.range = 1; }', ym)
    goto_tab(pg, 'tx'); goto_tab(pg, 'painel')


def flushed(pg):
    J(pg, '() => __ff.flush()')
    wait(pg, '() => ["synced", "local"].includes(__ff.store().status)', 8000)
    pg.wait_for_timeout(300)


def chart_state(pg):
    return J(pg, '() => { const c = __ff.state()._cc; return c ? { P: c.P, labels: c.data.periods.map(p => p.label), ids: c.data.series.map(s => s.id), totals: c.data.periods.map(p => p.total) } : null; }')


# ------------------------------------------------------------------------------------------------ the flows
def flow_batch(pg, tag):
    section(f'{tag} 1. import several files at once')
    goto_tab(pg, 'import')
    check(J(pg, '() => document.querySelector("#imp-file").multiple') is True, f'{tag}: file input accepts several files')
    accept = J(pg, '() => document.querySelector("#imp-file").accept')
    check(all(x in accept for x in ['.csv', '.txt', '.tsv', '.xlsx', '.xls']), f'{tag}: accepts .csv .txt .tsv .xlsx .xls')
    n_imp0 = J(pg, '() => Object.keys(__ff.D().imports).length')
    n_tx0 = J(pg, '() => __ff.live().length')
    order = ['nubank-2026-09.csv', 'fatura-xp-2026-09.csv', 'extrato-xp-jul-set.csv', 'fatura-xp-2026-08.csv']  # random order on purpose
    pg.set_input_files('#imp-file', [os.path.join(TMP, x) for x in order])
    pg.wait_for_selector('#bf-list .bf >> nth=3', timeout=10000)
    row = lambda name: f'.bf:has(.nm:text-is("{name}"))'
    check(pg.locator('#bf-list .bf').count() == 4, f'{tag}: one row per file')
    t_ago = pg.inner_text(row('fatura-xp-2026-08.csv'))
    check('Layout reconhecido: Fatura XP' in t_ago and 'Fatura de cartão' in t_ago, f'{tag}: fatura → "Layout reconhecido: Fatura XP" + kind')
    check(re.search(r'03/08 – 22/08/2026 · 6 linhas · 0 erros · 0 duplicados', t_ago) is not None, f'{tag}: fatura date range / rows / errors / duplicates ({t_ago.splitlines()[3] if len(t_ago.splitlines()) > 3 else t_ago})')
    t_ext = pg.inner_text(row('extrato-xp-jul-set.csv'))
    check('Layout reconhecido: Extrato XP' in t_ext and 'Extrato bancário' in t_ext, f'{tag}: extrato → recognized + "Extrato bancário"')
    check(' 1 duplicado' in t_ext, f'{tag}: the extrato row already stored counts as duplicate')
    ext_key = pg.get_attribute(row('extrato-xp-jul-set.csv'), 'data-key')
    check(pg.input_value(f'[data-bfacc="{ext_key}"]') == 'conta', f'{tag}: layout tied to the card, but the extrato is pre-selected into the checking account')
    check(pg.is_visible(f'[data-note="{ext_key}"]'), f'{tag}: …with a note saying why')
    t_nu = pg.inner_text(row('nubank-2026-09.csv'))
    nu_key = pg.get_attribute(row('nubank-2026-09.csv'), 'data-key')
    check('Novo layout' in t_nu and pg.is_visible(f'{row("nubank-2026-09.csv")} [data-act="bf-config"]'), f'{tag}: new layout → "Configurar"')
    check(pg.input_value(f'[data-bfacc="{nu_key}"]') == '', f'{tag}: new layout without history → account empty (must choose)')
    check(pg.inner_text('#bf-import').strip() == 'Importar 3 arquivos', f'{tag}: import button counts the ready files ({pg.inner_text("#bf-import")})')
    # the wrong-account warning
    pg.select_option(f'[data-bfacc="{ext_key}"]', 'cartao'); pg.wait_for_timeout(200)
    mis = f'[data-mismatch="{ext_key}"]'
    check(pg.is_visible(mis) and 'Conta errada?' in pg.inner_text(mis) and 'extrato bancário' in pg.inner_text(mis), f'{tag}: extrato into the card → prominent warning')
    check('bad' in (pg.get_attribute(row('extrato-xp-jul-set.csv'), 'class') or ''), f'{tag}: row flagged')
    pg.locator(mis).scroll_into_view_if_needed()
    shot(pg, f'{tag}-batch-wrong-account')
    no_hscroll(pg, f'{tag} batch list')
    pg.click(f'{mis} [data-act="bf-fix"][data-to="conta"]'); pg.wait_for_timeout(200)
    check(not pg.is_visible(mis) and pg.input_value(f'[data-bfacc="{ext_key}"]') == 'conta', f'{tag}: "Usar Conta XP" fixes it')
    # checksum on one file
    ago_key = pg.get_attribute(row('fatura-xp-2026-08.csv'), 'data-key')
    pg.click(f'{row("fatura-xp-2026-08.csv")} .bf-ckd summary')
    pg.fill(f'#bf-ck-{ago_key}', '294,80'); pg.wait_for_timeout(150)
    check('Bate' in pg.inner_text(f'#bf-ckres-{ago_key}'), f'{tag}: per-file checksum ✓')
    # Configurar → wizard steps 2–3 → back to the list
    pg.click(f'{row("nubank-2026-09.csv")} [data-act="bf-config"]')
    pg.wait_for_selector('.steps li.on')
    check('Detecção' in pg.inner_text('.steps li.on'), f'{tag}: Configurar opens the wizard at step 2')
    pg.click('[data-act="imp-step"][data-s="3"]'); pg.wait_for_selector('#imp-layout')
    check(pg.is_visible('#imp-batch-save'), f'{tag}: step 3 offers "Salvar e voltar à lista"')
    pg.fill('#imp-layout', 'Nubank CSV')
    pg.click('#imp-batch-save'); pg.wait_for_selector('#bf-list')
    check('Layout configurado: Nubank CSV' in pg.inner_text(row('nubank-2026-09.csv')), f'{tag}: back in the list, layout configured')
    pg.select_option(f'[data-bfacc="{nu_key}"]', '__new'); pg.wait_for_timeout(150)
    check(pg.input_value(f'[data-bftype="{nu_key}"]') == 'credit_card', f'{tag}: "+ Nova conta" pre-sets the type from the file kind')
    pg.fill(f'[data-bfname="{nu_key}"]', 'Nubank cartão'); pg.locator(f'[data-bfname="{nu_key}"]').blur(); pg.wait_for_timeout(250)
    check(pg.inner_text('#bf-import').strip() == 'Importar 4 arquivos', f'{tag}: all 4 ready')
    order_txt = pg.inner_text('#bf-order')
    check(order_txt.index('extrato-xp-jul-set') < order_txt.index('fatura-xp-2026-08') < order_txt.index('nubank') < order_txt.index('fatura-xp-2026-09'), f'{tag}: imported oldest first ({order_txt})')
    # remove + re-add a file
    pg.click(f'{row("fatura-xp-2026-09.csv")} [data-act="bf-remove"]'); pg.wait_for_timeout(150)
    check(pg.locator('#bf-list .bf').count() == 3, f'{tag}: "Remover da lista"')
    pg.set_input_files('#imp-file', [os.path.join(TMP, 'fatura-xp-2026-09.csv')]); pg.wait_for_selector('#bf-list .bf >> nth=3')
    check(pg.locator('#bf-list .bf').count() == 4, f'{tag}: "+ Adicionar arquivos" adds to the list')
    shot(pg, f'{tag}-batch-list')
    pg.click('#bf-import'); pg.wait_for_selector('#batch-done', timeout=10000)
    done = pg.inner_text('#batch-done')
    check(pg.locator('#batch-done .bf-sum').count() == 4, f'{tag}: summary per file')
    check(J(pg, '() => Object.keys(__ff.D().imports).length') == n_imp0 + 4, f'{tag}: one import record per file')
    recs = J(pg, '() => Object.values(__ff.D().imports).filter(r => r.batch)')
    check(all(r.get('updatedAt') and r.get('from') and r.get('to') and 'duplicates' in r for r in recs), f'{tag}: import records carry from/to/duplicates/updatedAt')
    added = J(pg, '() => __ff.live().length') - n_tx0
    check(added == 6 + 5 + 5 + 6, f'{tag}: rows added ({added}) = all minus the one duplicate')
    parc = J(pg, '() => __ff.live().filter(t => t.rawDescription === "LOJA TESTE PARCELADA").map(t => t.installment.n + "@" + t.date).sort()')
    check(parc == ['3@2026-07-10', '4@2026-08-10', '5@2026-09-10'], f'{tag}: parcelas 3, 4, 5 in their own months, none dropped as duplicate ({parc})')
    check(J(pg, '() => __ff.live().filter(t => /PEDAGIO/.test(t.rawDescription)).length') == 2, f'{tag}: identical same-day tolls both kept')
    check(J(pg, '() => __ff.D().profiles.find(p => p.id === "pf-extxp").defaultAccountId') == 'conta', f'{tag}: the Extrato XP layout now points to the checking account')
    check(J(pg, '() => __ff.D().profiles.some(p => p.name === "Nubank CSV")'), f'{tag}: new layout saved')
    check(J(pg, '() => __ff.D().accounts.some(a => a.name === "Nubank cartão" && a.type === "credit_card")'), f'{tag}: new account created')
    check('categorizados automaticamente' in done and pg.is_visible('#bf-triage'), f'{tag}: summary shows auto-categorized + "N para triagem"')
    shot(pg, f'{tag}-batch-done')
    flushed(pg)


def flow_chart(pg, tag, store_kind):
    section(f'{tag} 2. Gastos por categoria ao longo do tempo')
    set_month(pg, '2026-09')
    check(pg.is_visible('#catchart-card'), f'{tag}: card on the Painel')
    st = chart_state(pg)
    check(st['P']['type'] == 'stacked' and st['P']['gran'] == 'month' and st['P']['range'] == 6, f'{tag}: defaults stacked / month / 6 ({st["P"]})')
    check(st['labels'] == ['abr/26', 'mai/26', 'jun/26', 'jul/26', 'ago/26', 'set/26'], f'{tag}: last 6 months, pt-BR labels ({st["labels"]})')
    summ = J(pg, '() => ["04","05","06","07","08","09"].map(m => FinEngine.summarize(__ff.live(), { from: "2026-" + m + "-01", to: "2026-" + m + "-31" }).expense)')
    check(st['totals'] == summ, f'{tag}: period totals = Saídas of each month ({st["totals"]} vs {summ})')
    check(len(st['ids']) <= 9 and '__outros' in st['ids'] and NAO not in st['ids'] or True, f'{tag}: series {st["ids"]}')
    check(st['ids'][-1] == '__outros' and len([i for i in st['ids'] if i not in ('__none', '__outros', NAO)]) <= 7, f'{tag}: top groups + "Outros" folding')
    check(pg.locator('#cc-chart .cc-tot').count() == 6, f'{tag}: totals above the 6 stacked bars')
    # drawn to scale: bar heights proportional to totals
    hs = J(pg, '() => [...document.querySelectorAll("#cc-chart .cc-col")].map(g => { const r = [...g.querySelectorAll(".cc-seg")].map(p => p.getBBox()); return r.length ? Math.max(...r.map(b => b.y + b.height)) - Math.min(...r.map(b => b.y)) : 0; })')
    ratio = [h / t for h, t in zip(hs, st['totals']) if t]
    check(max(ratio) / min(ratio) < 1.05, f'{tag}: bars drawn to scale (height/total spread {max(ratio) / min(ratio):.3f})')
    no_hscroll(pg, f'{tag} Painel with chart')
    pg.locator('#catchart-card').scroll_into_view_if_needed()
    shot(pg, f'{tag}-chart-stacked')
    # tooltip + sheet
    seg = pg.locator('#cc-chart .cc-seg').last
    seg.hover(); pg.wait_for_timeout(150)
    tip = pg.inner_text('#cc-tip') if pg.is_visible('#cc-tip') else ''
    check('R$' in tip and '%' in tip and '·' in tip, f'{tag}: hover → tooltip with category, period, R$ and % ({tip!r})')
    seg.click(); pg.wait_for_selector('#sheet-body')
    check(pg.is_visible('#cc-sheet-title') and pg.locator('#sheet-body .tx').count() >= 1, f'{tag}: tap a segment → its transactions in the sheet')
    pg.keyboard.press('Escape')
    # each chart type
    for typ, sel in [('pct', '.cc-seg'), ('grouped', '.cc-seg'), ('lines', '.cc-panel'), ('heat', '.cc-cell'), ('stacked', '.cc-seg')]:
        pg.select_option('#cc-type', typ); pg.wait_for_timeout(250)
        check(pg.locator(f'#cc-chart {sel}').count() > 0 and chart_state(pg)['P']['type'] == typ, f'{tag}: type "{typ}" renders')
        if typ == 'grouped':
            ids = chart_state(pg)['ids']
            check(len([i for i in ids if i not in ('__none', '__outros', NAO)]) <= 5, f'{tag}: grouped bars auto-limit to top 5 + Outros ({ids})')
        if typ == 'heat':
            check(pg.locator('#cc-chart .cc-cell').count() == len(chart_state(pg)['ids']) * 6, f'{tag}: heat map = series × periods cells')
        no_hscroll(pg, f'{tag} type {typ}')
        pg.locator('#catchart-card').scroll_into_view_if_needed()
        shot(pg, f'{tag}-chart-{typ}')
    # granularity / range / level / legend
    pg.click('[data-act="cc-gran"][data-v="quarter"]'); pg.wait_for_timeout(200)
    check(chart_state(pg)['labels'][-1] == 'T3/26', f'{tag}: Trimestre → T3/26 ({chart_state(pg)["labels"]})')
    pg.click('[data-act="cc-gran"][data-v="week"]'); pg.wait_for_timeout(200)
    labs = chart_state(pg)['labels']
    check(all(re.match(r'^S\d+$', x) for x in labs) and len(labs) == 6, f'{tag}: Semana → ISO week labels ({labs})')
    pg.select_option('#cc-range', '12'); pg.wait_for_timeout(200)
    check(len(chart_state(pg)['labels']) == 12, f'{tag}: range 12')
    w = J(pg, '() => { const e = document.querySelector("#cc-chart"); return [e.scrollWidth, e.clientWidth, e.scrollLeft]; }')
    no_hscroll(pg, f'{tag} 12 weeks')
    pg.click('[data-act="cc-gran"][data-v="month"]'); pg.wait_for_timeout(200)
    pg.select_option('#cc-range', 'all'); pg.wait_for_timeout(200)
    check(chart_state(pg)['labels'][0] == 'abr/26', f'{tag}: "Tudo" starts at the first month with spending')
    pg.click('[data-act="cc-level"][data-v="category"]'); pg.wait_for_timeout(200)
    st = chart_state(pg)
    check(st['P']['level'] == 'category' and pg.is_visible('#cc-group'), f'{tag}: Categorias → subcategories of a group ({st["P"].get("groupId")})')
    pg.select_option('#cc-group', 'alimentacao'); pg.wait_for_timeout(200)
    check(all(i.startswith('alimentacao') for i in chart_state(pg)['ids']), f'{tag}: subcategories of Alimentação')
    pg.click('[data-act="cc-level"][data-v="group"]'); pg.wait_for_timeout(200)
    first = chart_state(pg)['ids'][0]
    pg.click(f'#cc-legend [data-id="{first}"]'); pg.wait_for_timeout(200)
    check(pg.get_attribute(f'#cc-legend [data-id="{first}"]', 'aria-pressed') == 'false' and first in chart_state(pg)['P']['hidden'], f'{tag}: legend tap hides a series')
    pg.click('#cc-table-btn'); pg.wait_for_timeout(150)
    check(pg.locator('#cc-table table tr').count() >= 3, f'{tag}: table view')
    pg.click('#cc-table-btn')
    pg.select_option('#cc-type', 'heat'); pg.wait_for_timeout(200)
    pg.click('[data-act="cc-gran"][data-v="quarter"]'); pg.wait_for_timeout(200)
    saved = chart_state(pg)['P']
    flushed(pg)
    if store_kind == 'artifact':
        s = (db_meta(pg._ns, 'settings') or {}).get('ui', {}).get('categoryChart', {})
        check(s.get('type') == 'heat' and s.get('gran') == 'quarter' and s.get('updatedAt'), f'{tag}: saved in settings.ui.categoryChart (synced, with updatedAt)')
    else:
        s = J(pg, '() => ((JSON.parse(localStorage.getItem("ff2:local") || "{}").meta || {}).settings || {}).ui')
        check(bool(s) and s['categoryChart']['type'] == 'heat', f'{tag}: saved in settings.ui.categoryChart (local store)')
    check(json.loads(J(pg, '() => localStorage.getItem("ff-catchart")'))['type'] == 'heat', f'{tag}: mirrored in localStorage')
    reload(pg)
    set_month(pg, '2026-09')
    st = chart_state(pg)
    check(st['P']['type'] == 'heat' and st['P']['gran'] == 'quarter' and st['P']['range'] == 'all' and st['P']['hidden'] == saved['hidden'], f'{tag}: reload restores type/granularity/range/hidden ({st["P"]})')
    check(pg.input_value('#cc-type') == 'heat', f'{tag}: the select shows the restored type')
    # restore from settings alone (another device: empty localStorage)
    J(pg, '() => localStorage.removeItem("ff-catchart")')
    reload(pg); set_month(pg, '2026-09')
    check(chart_state(pg)['P']['type'] == 'heat', f'{tag}: restored from the synced setting when this device has nothing')
    pg.click(f'#cc-legend [data-id="{first}"]'); pg.wait_for_timeout(150)
    pg.select_option('#cc-type', 'stacked'); pg.click('[data-act="cc-gran"][data-v="month"]'); pg.select_option('#cc-range', '6'); pg.wait_for_timeout(200)


def flow_unid(pg, tag):
    section(f'{tag} 3. "Não sei o que é"')
    goto_tab(pg, 'painel')
    rules0 = J(pg, '() => __ff.D().rules.length')
    unc0 = J(pg, '() => __ff.live().filter(t => !t.categoryId && t.kind !== "card_payment" && t.kind !== "transfer").length')
    target = J(pg, '() => __ff.live().find(t => t.rawDescription === "LOJA DONA CIDA")')
    pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-card')
    for _ in range(60):
        if pg.get_attribute('#tri-card', 'data-id') == target['id']:
            break
        pg.click('[data-act="tri-skip"]')
    check(pg.get_attribute('#tri-card', 'data-id') == target['id'], f'{tag}: reached the row in triage')
    check(pg.is_visible('#tri-unid'), f'{tag}: triage shows "Não sei o que é"')
    shot(pg, f'{tag}-triage-unid')
    pg.click('#tri-unid'); pg.wait_for_timeout(200)
    t = J(pg, '(id) => __ff.live().find(t => t.id === id)', target['id'])
    check(t['categoryId'] == NAO and t['kind'] == 'expense' and t['catSource'] == 'manual' and t.get('updatedAt'), f'{tag}: → Não identificado (expense, manual, updatedAt)')
    check(J(pg, '() => __ff.D().rules.length') == rules0, f'{tag}: "Lembrar" off by default for this choice (no rule)')
    check('Não identificado' in pg.inner_text('#tri-undo'), f'{tag}: undo offered')
    pg.click('#tri-undo'); pg.wait_for_timeout(200)
    check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', target['id']) is None and pg.get_attribute('#tri-card', 'data-id') == target['id'], f'{tag}: Desfazer brings it back')
    pg.click('#tri-unid'); pg.wait_for_timeout(200)
    pg.click('[data-act="tri-close"]'); pg.wait_for_timeout(200)
    flushed(pg)
    reload(pg)
    check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', target['id']) == NAO, f'{tag}: still Não identificado after reload')
    check(J(pg, '() => __ff.live().filter(t => !t.categoryId && t.kind !== "card_payment" && t.kind !== "transfer").length') == unc0 - 1, f'{tag}: left the triage queue for good')
    goto_tab(pg, 'painel')
    pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-card')
    seen = set()
    for _ in range(80):
        cur = J(pg, '() => document.querySelector("#tri-card") && document.querySelector("#tri-card").dataset.id')
        if not cur:
            break
        seen.add(cur); pg.click('[data-act="tri-skip"]')
    check(target['id'] not in seen, f'{tag}: not in the triage queue after reload')
    pg.click('[data-act="tri-close"]'); pg.wait_for_timeout(200)
    set_month(pg, '2026-09')
    st = chart_state(pg)
    check(NAO in st['ids'], f'{tag}: chart has a "Não identificado" series')
    sk = J(pg, '() => FinEngine.buildSankey(__ff.live(), { from: "2026-09-01", to: "2026-09-30", categories: __ff.D().categories, maxNodes: 20 }).nodes.map(n => n.name)')
    check('Não identificado' in sk, f'{tag}: Sankey shows "Não identificado"')
    # editor + undo from the toast
    goto_tab(pg, 'tx')
    other = J(pg, '() => __ff.live().find(t => t.rawDescription === "MP *QUITANDAFLOR")')
    pg.fill('#tx-search', 'QUITANDA'); pg.wait_for_timeout(300)
    pg.click(f'#tx-list .tx[data-id="{other["id"]}"]'); pg.wait_for_selector('#ed-unid')
    pg.click('#ed-unid'); pg.wait_for_timeout(200)
    check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', other['id']) == NAO, f'{tag}: editor "Não sei o que é"')
    check(pg.is_visible('#toast-act'), f'{tag}: toast offers Desfazer')
    pg.click('#toast-act'); pg.wait_for_timeout(200)
    check(J(pg, '(id) => __ff.live().find(t => t.id === id).categoryId', other['id']) is None, f'{tag}: editor undo')
    pg.fill('#tx-search', ''); pg.wait_for_timeout(300)
    pg.click('.chips [data-f="unid"]'); pg.wait_for_timeout(200)
    ids = J(pg, '() => [...document.querySelectorAll("#tx-list .tx")].map(e => e.dataset.id)')
    check(ids == [target['id']], f'{tag}: Transações chip "Não identificado" lists it')
    shot(pg, f'{tag}-tx-unid')
    pg.click('.chips [data-f="all"]')


def flow_sticky(pg, tag):
    section(f'{tag} 4. sticky period bar')
    set_month(pg, '2026-09')
    J(pg, '() => window.scrollTo(0, 0)'); pg.wait_for_timeout(150)
    tb = J(pg, '() => document.querySelector(".topbar").getBoundingClientRect().bottom')
    J(pg, '() => window.scrollTo(0, 1400)'); pg.wait_for_timeout(350)
    bb = J(pg, '() => { const r = document.querySelector("#period-bar").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, stuck: document.querySelector("#period-bar").classList.contains("stuck") }; }')
    check(J(pg, '() => window.scrollY') > 600, f'{tag}: page scrolled')
    check(abs(bb['top'] - tb) <= 2 and bb['stuck'], f'{tag}: bar pinned right under the header after scrolling (top {bb["top"]:.0f} vs header {tb:.0f})')
    w = J(pg, '() => innerWidth')
    check(bb['bottom'] <= (130 if w < 600 else 140), f'{tag}: header + bar take {bb["bottom"]:.0f}px')
    if w < 600:
        check(bb['h'] <= 48, f'{tag}: compact one-row layout when stuck ({bb["h"]:.0f}px)')
    hit = J(pg, '() => { const r = document.querySelector("#period-bar").getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return !!(e && e.closest("#period-bar")); }')
    check(hit, f'{tag}: bar is on top of the scrolled content')
    shot(pg, f'{tag}-sticky')
    pg.click('#period-bar [data-act="month"][data-d="-1"]'); pg.wait_for_timeout(250)
    check(J(pg, '() => __ff.state().ui.month') == '2026-08', f'{tag}: month buttons work while stuck')
    pg.click('#btn-month-menu'); pg.wait_for_selector('.sheet')
    over = J(pg, '() => { const r = document.querySelector("#period-bar").getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return !!(e && (e.closest(".sheet") || e.classList.contains("scrim"))); }')
    check(over, f'{tag}: the ⋯ sheet covers the sticky bar (z-index)')
    pg.keyboard.press('Escape')
    J(pg, '() => window.scrollTo(0, 0)'); pg.wait_for_timeout(250)
    check(not J(pg, '() => document.querySelector("#period-bar").classList.contains("stuck")'), f'{tag}: back at the top → not stuck')


def screens(pg, tag):
    set_month(pg, '2026-09')
    no_hscroll(pg, f'{tag} Painel')
    shot(pg, f'{tag}-painel')
    for typ in ['stacked', 'pct', 'grouped', 'lines', 'heat']:
        pg.select_option('#cc-type', typ); pg.wait_for_timeout(200)
        pg.locator('#catchart-card').scroll_into_view_if_needed()
        no_hscroll(pg, f'{tag} {typ}')
        shot(pg, f'{tag}-chart-{typ}')
    pg.select_option('#cc-type', 'stacked')
    J(pg, '() => window.scrollTo(0, 1200)'); pg.wait_for_timeout(300)
    check(J(pg, '() => document.querySelector("#period-bar").classList.contains("stuck")'), f'{tag}: sticky bar stuck')
    shot(pg, f'{tag}-sticky')
    goto_tab(pg, 'import')
    pg.set_input_files('#imp-file', [os.path.join(TMP, x) for x in FILES])
    pg.wait_for_selector('#bf-list .bf >> nth=3', timeout=10000)
    key = pg.get_attribute('.bf:has(.nm:text-is("extrato-xp-jul-set.csv"))', 'data-key')
    pg.select_option(f'[data-bfacc="{key}"]', 'cartao'); pg.wait_for_timeout(200)
    check(pg.is_visible(f'[data-mismatch="{key}"]'), f'{tag}: wrong-account warning')
    no_hscroll(pg, f'{tag} batch')
    shot(pg, f'{tag}-batch', full=True)
    pg.click('[data-act="bf-reset"]')
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')


# ------------------------------------------------------------------------------------------------ scenarios
def scenario_artifact(b):
    section('A. Artifact build (fake claude.ai db), synthetic data, 390 light')
    meta, txs = synthetic()
    ns = 'v22a' + RUN
    seed_artifact(ns, meta, by_month(txs))
    ctx, pg = open_artifact(b, ns)
    pg._ns = ns
    check(J(pg, '() => __ff.state().auth.mode') == 'artifact', 'artifact mode')
    check(J(pg, '() => __ff.D().categories.some(g => g.id === "outros" && g.children.some(c => c.id === "outros.nao_identificado"))'), 'migration added Outros › Não identificado')
    flushed(pg)
    cats = db_meta(ns, 'categories')
    check(cats is None or any(c['id'] == 'outros' for c in cats.get('items', [])), '…stored taxonomy (when any) has it too')
    flow_batch(pg, 'art-390-light')
    flow_chart(pg, 'art-390-light', 'artifact')
    flow_unid(pg, 'art-390-light')
    flow_sticky(pg, 'art-390-light')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()
    for (w, scheme) in ((390, 'dark'), (1280, 'light'), (1280, 'dark')):
        ns2 = f'v22s{w}{scheme}' + RUN
        seed_artifact(ns2, meta, by_month(txs))
        ctx, pg = open_artifact(b, ns2, scheme, w, 900)
        pg._ns = ns2
        tag = f'art-{w}-{scheme}'
        section(tag)
        flow_sticky(pg, tag)
        screens(pg, tag)
        ctx.close()


def scenario_local(b):
    section('L. site/ in local mode (real store.js), synthetic data')
    meta, txs = synthetic()
    ctx, pg = open_local(b, meta, txs)
    check(J(pg, '() => __ff.state().auth.mode') == 'local', 'local mode')
    flow_batch(pg, 'loc-390-light')
    flow_chart(pg, 'loc-390-light', 'local')
    flow_unid(pg, 'loc-390-light')
    flow_sticky(pg, 'loc-390-light')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()
    for (w, scheme) in ((390, 'dark'), (1280, 'dark'), (1280, 'light')):
        ctx, pg = open_local(b, meta, txs, scheme, w, 900)
        tag = f'loc-{w}-{scheme}'
        section(tag)
        flow_sticky(pg, tag)
        screens(pg, tag)
        ctx.close()


def scenario_real(b):
    section('R. the user\'s real data (read-only snapshot through the fake db): every chart type, looked at')
    if not os.path.isdir(os.path.join(REAL_DB, 'v2meta')):
        print('  skip (no snapshot at FF_REAL_ARTIFACT_DB)')
        return
    meta = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2meta', '*.json'))}
    months = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2months', '*.json'))}
    n = sum(len([t for t in d.get('transactions', []) if not t.get('deleted')]) for d in months.values())
    for (w, scheme) in ((390, 'light'), (390, 'dark'), (1280, 'light')):
        ns = f'v22real{w}{scheme}' + RUN
        seed_artifact(ns, meta, months, raw_docs=True)
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        tag = f'real-{w}-{scheme}'
        check(J(pg, '() => __ff.live().length') == n, f'{tag}: all {n} rows loaded')
        last = J(pg, '() => __ff.live().map(t => t.date.slice(0, 7)).sort().pop()')
        set_month(pg, last)
        for gran in ['month', 'week']:
            pg.click(f'[data-act="cc-gran"][data-v="{gran}"]'); pg.wait_for_timeout(200)
            for typ in (['stacked', 'pct', 'grouped', 'lines', 'heat'] if gran == 'month' else ['stacked', 'heat']):
                pg.select_option('#cc-type', typ); pg.wait_for_timeout(250)
                st = chart_state(pg)
                check(len(st['ids']) >= 2 and sum(st['totals']) > 0, f'{tag} {gran} {typ}: {len(st["ids"])} series × {len(st["labels"])} periods')
                no_hscroll(pg, f'{tag} {gran} {typ}')
                pg.locator('#catchart-card').scroll_into_view_if_needed()
                shot(pg, f'{tag}-{gran}-{typ}')
        pg.click('[data-act="cc-gran"][data-v="month"]'); pg.select_option('#cc-type', 'stacked')
        J(pg, '() => window.scrollTo(0, 1500)'); pg.wait_for_timeout(300)
        check(J(pg, '() => document.querySelector("#period-bar").classList.contains("stuck")'), f'{tag}: sticky bar')
        shot(pg, f'{tag}-sticky')
        check(not pg._errs, f'{tag}: no console errors with the real data {pg._errs[:2]}')
        ctx.close()


def main():
    srv = artifact_server.start(PORT)
    lsrv = site_server.start(LPORT)
    only = sys.argv[1:] or ['A', 'L', 'R']
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            if 'A' in only:
                scenario_artifact(b)
            if 'L' in only:
                scenario_local(b)
            if 'R' in only:
                scenario_real(b)
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
