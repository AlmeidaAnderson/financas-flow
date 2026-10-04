"""End-to-end tests of v2.4b — PDF statements + foreign currencies — in headless Chromium.

Usage: npm run build:artifact && python3 test/e2e/e2e_v24b.py [A] [S] [L] [N] [R]
  A. Artifact build under artifact-like conditions: a CSP equal to the claude.ai allowlist (scripts only from cdnjs /
     jsdelivr / unpkg + the inline ones, no other network, no workers but blob:/self) and the fake window.claude. pdf.js
     3.11.174 is requested from its cdnjs URL; the sandbox cannot reach cdnjs, so the SAME pinned files (pdfjs-dist
     3.11.174, also vendored in site/vendor) are served at that URL by route interception. 390 light, full flow:
     single PDF (fatura: chips, excluded regions, checksum, fx badge, "Compras internacionais", filter, card days),
     password (wrong → right), image-only PDF, batch of PDFs mixed with a CSV (benefit card, EUR account + rates,
     extrato), nothing but allow-listed hosts requested, no Worker constructed, no CSP violation.
  S. 390 dark / 1280 light / 1280 dark: detection, preview, batch and Transações screens (no horizontal page scroll).
  L. site/ in local mode: pdf.js from /vendor with a same-origin Web Worker.
  N. Netlify build (test harness with the real netlify.toml CSP + fake Identity): PDF import, no CSP violation.
  R. the user's two real PDFs when present (runtime only; prints counts, screenshots are gitignored).
All other data is synthetic (test/fixtures/pdf, made by make_pdfs.py). Screenshots: screens/v24b/*.png (gitignored)."""
import sys, os, json, re, time, glob, subprocess, tempfile, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402
import server as site_server  # noqa: E402

PORT = int(os.environ.get('FF_V24B_PORT', '8801'))
HPORT = int(os.environ.get('FF_V24B_HARNESS_PORT', '8802'))
LPORT = int(os.environ.get('FF_V24B_LOCAL_PORT', '8803'))
URL = f'http://127.0.0.1:{PORT}/'
HURL = f'http://127.0.0.1:{HPORT}/'
LURL = f'http://127.0.0.1:{LPORT}/'
FXD = os.path.join(ROOT, 'test', 'fixtures', 'pdf')
REAL = os.environ.get('FF_REAL_PDF_DIR', '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/pdfs')
SCR = os.path.join(ROOT, 'screens', 'v24b')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
FAKE_ID = open(os.path.join(HERE, 'fake_identity.mjs'), encoding='utf-8').read()
PDFJS = {n: open(os.path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', n), 'rb').read() for n in ('pdf.min.js', 'pdf.worker.min.js')}
CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/'
# the claude.ai Artifact allowlist as a CSP: inline page scripts + the allowed CDNs; nothing else on the network
ART_CSP = ("default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com; "
           "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; "
           "connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'")
HOOKS = """window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
window.__workers = 0; (function(){ const W = window.Worker; if (!W) return; window.Worker = function(u, o) { window.__workers++; window.__workerUrls = (window.__workerUrls || []).concat(String(u)); return new W(u, o); }; window.Worker.prototype = W.prototype; })();"""
UID = 'u_e2e_v24b'
BASE = f'data/users/{UID}/ff'
RUN = str(int(time.time()))
STAMP = '2026-10-01T12:00:00.000Z'
TMP = tempfile.mkdtemp(prefix='ff-v24b-')
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
CSV = os.path.join(TMP, 'fatura-cartao-2026-09.csv')
open(CSV, 'w', encoding='utf-8').write('Data;Estabelecimento;Valor\n03/09/2026;PADARIA CENTRAL;12,50\n10/09/2026;CINEMA CENTRO;48,00\n15/09/2026;LIVRARIA LUZ;59,90\n')


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


def post(path, body):
    req = urllib.request.Request(path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def seed_artifact(ns, meta):
    for name, data in meta.items():
        doc = {'v': 2, 'kind': 'meta', 'name': name, 'data': data, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + name, 'parent': None}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2meta/{name}', 'data': doc})


def base_meta():
    return {'accounts': {'items': [{'id': 'conta', 'name': 'Conta Laranja', 'type': 'checking'}, {'id': 'vale', 'name': 'Vale Refeição', 'type': 'benefit'},
                                   {'id': 'cartao', 'name': 'Cartão Azul', 'type': 'credit_card'}, {'id': 'euro', 'name': 'Conta Euro', 'type': 'checking'}]},
            'settings': {'budgets': {}, 'schemaVersion': 2, 'updatedAt': STAMP}}


def attach(pg):
    pg._errs = []
    pg._reqs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))
    pg.on('request', lambda r: pg._reqs.append(r.url))


def cdn_route(route):
    name = route.request.url.rsplit('/', 1)[-1]
    if name in PDFJS:
        route.fulfill(status=200, body=PDFJS[name], content_type='application/javascript', headers={'access-control-allow-origin': '*'})
    else:
        route.fulfill(status=404, body='')


def open_artifact(b, ns, scheme='light', w=390, h=844):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* xlsx stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    ctx.route(re.compile(r'https://cdnjs\.cloudflare\.com/.*'), cdn_route)

    def page_with_csp(route):
        resp = route.fetch()
        hd = dict(resp.headers)
        hd['content-security-policy'] = ART_CSP
        # a page script that proves eval is blocked here (pdf.js must work without it)
        probe = "<script>try { new Function('return 1')(); window.__ev = 'allowed'; } catch (e) { window.__ev = 'blocked'; }</script>"
        route.fulfill(response=resp, headers=hd, body=resp.text().replace('</body>', probe + '</body>'))
    ctx.route(URL, page_with_csp)
    cfg = {'ns': ns, 'uid': UID}
    ctx.add_init_script(HOOKS + '\n' + FAKE_JS + '\n;(function(c){ window.__saved = [];'
                        ' var f = FakeClaude.createFakeClaude({ backend: FakeClaude.createHttpBackend("/__fakedb", c.ns, 150), userId: c.uid, delayMs: 60, saved: window.__saved });'
                        ' window.claude = Object.freeze({ use: f.claude.use });'
                        '})(' + json.dumps(cfg) + ');')
    pg = ctx.new_page()
    attach(pg)
    pg.goto(URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(300)
    # the eval probe of page_with_csp leaves one expected violation: keep its result, start the checks clean
    pg._ev = J(pg, '() => window.__ev || null')
    J(pg, '() => { window.__csp.length = 0; }')
    pg._errs.clear()
    return ctx, pg


def goto_tab(pg, tab):
    pg.click(f'.tab[data-tab="{tab}"]')
    pg.wait_for_timeout(200)


def start_import(pg, acc=None, new_acc=None):
    J(pg, '() => { __ff.state().imp = null; }')
    goto_tab(pg, 'painel')
    goto_tab(pg, 'import')
    if new_acc:
        pg.select_option('#imp-acc', '__new')
        pg.fill('#imp-acc-name', new_acc)
    elif acc:
        pg.select_option('#imp-acc', acc)


def wait_step(pg, timeout=30000):
    pg.wait_for_selector('#pdf-detect, [data-act="imp-step"][data-s="4"], #imp-pdf-pw-box, #scr-import .banner.err', timeout=timeout)


# ------------------------------------------------------------------------------------------------ flows
def flow_single(pg, tag, shots=True):
    section(f'{tag} 1. one PDF fatura: detection, excluded regions, checksum, import, card days, fx')
    start_import(pg, new_acc='Cartão Roxo')
    t0 = time.time()
    pg.set_input_files('#imp-file', os.path.join(FXD, 'fatura_roxa.pdf'))
    wait_step(pg)
    check(pg.is_visible('#pdf-detect'), f'{tag}: PDF read → detection step ({time.time() - t0:.1f}s)')
    det = pg.inner_text('#pdf-detect')
    for word in ('Fatura de cartão', 'Vencimento', '05/10/2026', 'Compras do ciclo', '28/08/2026', 'Total da fatura', 'R$ 717,91', '✓ total bate'):
        check(word in det, f'{tag}: detection shows "{word}"')
    ex = pg.inner_text('#pdf-ex2 summary')
    check('próximas faturas' in ex and 'ofertas de parcelamento' in ex and 'resumo' in ex and 'cabeçalhos' in ex, f'{tag}: "Ignorado: …" lists the excluded regions ({ex[:120]})')
    pg.click('#pdf-ex2 summary')
    check('Parcela 4/10' in pg.inner_text('#pdf-ex2'), f'{tag}: the next-fatura parcelas are visible in the ignored list')
    if shots:
        shot(pg, f'{tag}-pdf-detect')
    no_hscroll(pg, f'{tag} detection')
    pg.click('[data-act="imp-step"][data-s="3"]')
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
    heads = J(pg, '() => [...document.querySelectorAll("#imp-body table.pv thead select")].map(s => s.value)')
    check('fxAmount' in heads and 'amount' in heads and 'section' in heads and 'installment' in heads, f'{tag}: preview roles: Valor em R$ + Valor (moeda estrangeira) + Parcela + Seção ({heads})')
    labels = J(pg, '() => [...document.querySelectorAll("#imp-body table.pv thead select")].map(s => s.options[s.selectedIndex].text)')
    check('Valor (moeda estrangeira)' in labels and 'Valor em R$' in labels, f'{tag}: role labels in pt-BR')
    check(pg.input_value('#imp-check') == '717,91' and pg.is_visible('#pdf-ck-ok'), f'{tag}: checksum pre-filled with the fatura total and it matches')
    check('Fatura anterior' in pg.inner_text('#pdf-ck-parts'), f'{tag}: the checksum explains previous + purchases − payments')
    wrap = J(pg, '() => { const w = document.querySelector("#imp-body .table-wrap"); return [w.scrollWidth, w.clientWidth]; }')
    check(wrap[0] >= wrap[1], f'{tag}: the wide table scrolls inside its own box ({wrap})')
    no_hscroll(pg, f'{tag} preview')
    if shots:
        shot(pg, f'{tag}-pdf-preview')
    pg.click('[data-act="imp-step"][data-s="4"]')
    pg.click('[data-act="imp-commit"]')
    pg.wait_for_selector('#imp-done')
    rows = J(pg, '() => __ff.live().filter(t => t.importId === Object.values(__ff.D().imports).find(r => r.fileName === "fatura_roxa.pdf").id)')
    check(len(rows) == 12, f'{tag}: 12 rows imported ({len(rows)})')
    check(sum(1 for t in rows if t['kind'] == 'card_payment') == 1, f'{tag}: the payment is a card payment')
    fx = [t for t in rows if t.get('fx')]
    check(len(fx) == 2 and {t['fx']['currency'] for t in fx} == {'USD', 'EUR'}, f'{tag}: two foreign purchases (USD, EUR) keep the original amount')
    iof = [t for t in rows if 'IOF' in t['rawDescription']]
    check(len(iof) == 2 and all(t.get('linkedTo') in [f['id'] for f in fx] and t['categoryId'] == 'impostos.iof' for t in iof), f'{tag}: each IOF linked to its purchase, category IOF')
    acc = J(pg, '() => __ff.D().accounts.find(a => a.name === "Cartão Roxo")')
    check(acc and acc['type'] == 'credit_card' and acc.get('closingDay') == 28 and acc.get('dueDay') == 5, f'{tag}: new account typed "cartão" from the PDF and configured by it (fecha 28, vence 5)')
    check('Cartão configurado pela fatura' in pg.inner_text('#imp-done'), f'{tag}: the summary says so')
    rec = J(pg, '() => Object.values(__ff.D().imports).find(r => r.fileName === "fatura_roxa.pdf")')
    check(rec['source'] == 'pdf' and rec['docKind'] == 'fatura' and rec['dueDate'] == '2026-10-05' and rec['from'] == '2026-08-28' and rec['to'] == '2026-09-27', f'{tag}: import record = cycle + due date')
    if shots:
        shot(pg, f'{tag}-pdf-done')
    # Transações: badge + filter
    J(pg, '() => { __ff.state().ui.month = "2026-09"; }')
    goto_tab(pg, 'tx')
    pg.fill('#tx-search', 'Netflix'); pg.wait_for_timeout(300)
    badge = pg.inner_text('#tx-list [data-fx]') if pg.locator('#tx-list [data-fx]').count() else ''
    check(badge == 'US$ 12,99', f'{tag}: currency badge on the row ({badge})')
    pg.fill('#tx-search', ''); pg.wait_for_timeout(300)
    pg.click('[data-act="filters"]'); pg.wait_for_selector('#f-fx')
    pg.check('#f-fx'); pg.click('#f-apply'); pg.wait_for_timeout(300)
    n = pg.locator('#tx-list .tx').count()
    check(n == 4, f'{tag}: filter "Moeda estrangeira" → 2 purchases + their IOF ({n})')
    if shots:
        shot(pg, f'{tag}-tx-fx')
    no_hscroll(pg, f'{tag} transações')
    pg.click('[data-act="filters"]'); pg.wait_for_selector('#f-fx'); pg.click('#sheet-root [data-act="filters-clear"]'); pg.wait_for_timeout(200)
    # Painel: info line
    goto_tab(pg, 'painel')
    line = pg.inner_text('#pn-fx') if pg.locator('#pn-fx').count() else ''
    check('Compras internacionais: R$ 97,55' in line and 'IOF R$ 3,41' in line, f'{tag}: Painel "Compras internacionais: R$ X (+ IOF R$ Y)" ({line!r})')
    if shots:
        pg.locator('#pn-fx').scroll_into_view_if_needed()
        shot(pg, f'{tag}-painel-fx')
    return acc


def flow_password(pg, tag):
    section(f'{tag} 2. password-protected PDF, then an image-only PDF')
    start_import(pg, acc='cartao')
    pg.set_input_files('#imp-file', os.path.join(FXD, 'fatura_protegida.pdf'))
    wait_step(pg)
    check(pg.is_visible('#imp-pdf-pw') and 'Senha do PDF' in pg.inner_text('#imp-pdf-pw-box'), f'{tag}: asks for "Senha do PDF" in the page')
    check(J(pg, '() => document.querySelector("#imp-pdf-pw").type') == 'password', f'{tag}: password field')
    pg.fill('#imp-pdf-pw', '99999'); pg.click('#imp-pdf-pw-go')
    pg.wait_for_selector('#imp-pdf-pw-err', timeout=15000)
    check('Senha incorreta' in pg.inner_text('#imp-pdf-pw-err'), f'{tag}: wrong password → message')
    shot(pg, f'{tag}-pdf-password')
    no_hscroll(pg, f'{tag} password')
    pg.fill('#imp-pdf-pw', '12345'); pg.press('#imp-pdf-pw', 'Enter')
    wait_step(pg)
    check(pg.is_visible('#pdf-detect'), f'{tag}: right password (Enter) → opened')
    st = json.dumps(J(pg, '() => ({ s: __ff.state().imp, ls: Object.assign({}, localStorage), ss: Object.assign({}, sessionStorage) })'), default=str)
    check('12345' not in st, f'{tag}: the password is not kept anywhere (state, localStorage, sessionStorage)')
    pg.click('[data-act="imp-step"][data-s="3"]'); pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
    check(pg.locator('#imp-body table.pv tbody tr').count() == 3, f'{tag}: 3 rows read from the protected PDF')
    # image only
    start_import(pg, acc='cartao')
    pg.set_input_files('#imp-file', os.path.join(FXD, 'digitalizado.pdf'))
    wait_step(pg)
    err = pg.inner_text('#scr-import .banner.err') if pg.locator('#scr-import .banner.err').count() else ''
    check('imagem' in err and 'não tem texto' in err, f'{tag}: image-only PDF → clear message ({err[:80]})')
    shot(pg, f'{tag}-pdf-image')


def flow_batch(pg, tag, shots=True):
    section(f'{tag} 3. batch: PDFs (benefit card, EUR account, extrato) mixed with a CSV')
    J(pg, '() => { __ff.state().imp = null; }')
    goto_tab(pg, 'painel'); goto_tab(pg, 'import')
    files = [os.path.join(FXD, x) for x in ('beneficio_valebem.pdf', 'conta_eur.pdf', 'extrato_laranja.pdf')] + [CSV]
    pg.set_input_files('#imp-file', files)
    pg.wait_for_selector('#bf-list .bf >> nth=3', timeout=40000)
    wait(pg, '() => !document.querySelector("#bf-busy")', 30000)
    key = lambda n: pg.get_attribute(f'#bf-list .bf:has(.nm:text-is("{n}"))', 'data-key')
    kb, ke, kx, kc = key('beneficio_valebem.pdf'), key('conta_eur.pdf'), key('extrato_laranja.pdf'), key('fatura-cartao-2026-09.csv')
    row = lambda k: pg.inner_text(f'.bf[data-key="{k}"]')
    check('Extrato de benefício' in row(kb) and 'PDF · 1 pág.' in row(kb), f'{tag}: benefit PDF recognized')
    check('Extrato bancário' in row(kx) and 'PDF · 2 pág.' in row(kx), f'{tag}: extrato PDF recognized')
    check('Falta cotação' in row(ke), f'{tag}: EUR-only PDF asks for the rate')
    check('Ignorado:' in row(kx), f'{tag}: the ignored regions per PDF are listed in the batch row')
    pg.select_option('#bf-shared', 'conta'); pg.wait_for_timeout(200)
    # benefit file → its own account (a benefit PDF into a checking account is allowed, so pick it explicitly)
    pg.click(f'#bf-own-{kb}'); pg.select_option(f'[data-bfacc="{kb}"]', 'vale'); pg.wait_for_timeout(150)
    pg.click(f'#bf-own-{ke}'); pg.select_option(f'[data-bfacc="{ke}"]', 'euro'); pg.wait_for_timeout(150)
    # the CSV is a new layout: "Configurar" once (same wizard), then its own account
    check('Novo layout' in row(kc), f'{tag}: the CSV in the same list is a new layout')
    pg.click(f'.bf[data-key="{kc}"] [data-act="bf-config"]')
    pg.wait_for_selector('[data-act="imp-step"][data-s="3"]'); pg.click('[data-act="imp-step"][data-s="3"]')
    pg.fill('#imp-layout', 'Fatura Azul CSV'); pg.click('#imp-batch-save'); pg.wait_for_selector('#bf-list')
    if not pg.locator(f'[data-bfacc="{kc}"]').count():
        pg.click(f'#bf-own-{kc}')
    pg.select_option(f'[data-bfacc="{kc}"]', 'cartao'); pg.wait_for_timeout(150)
    # rates for the EUR file: "Revisar leitura" → step 3 → type the two months
    pg.click(f'.bf[data-key="{ke}"] [data-act="bf-config"]')
    pg.wait_for_selector('[data-act="imp-step"][data-s="3"]'); pg.click('[data-act="imp-step"][data-s="3"]')
    pg.wait_for_selector('#imp-fx-rates')
    check(pg.locator('[data-fxrate]').count() == 2 and pg.is_visible('#imp-fx-missing'), f'{tag}: two months need an EUR rate')
    pg.fill('[data-fxrate="EUR|2026-09"]', '6,20'); pg.dispatch_event('[data-fxrate="EUR|2026-09"]', 'change'); pg.wait_for_timeout(200)
    pg.fill('[data-fxrate="EUR|2026-10"]', '6,30'); pg.dispatch_event('[data-fxrate="EUR|2026-10"]', 'change'); pg.wait_for_timeout(200)
    check(not pg.is_visible('#imp-fx-missing'), f'{tag}: rates typed → all rows convert')
    if shots:
        shot(pg, f'{tag}-eur-rates')
    no_hscroll(pg, f'{tag} eur rates')
    pg.click('#imp-batch-save'); pg.wait_for_selector('#bf-list')
    check('Falta cotação' not in row(ke), f'{tag}: back in the list, the EUR file is ready')
    if shots:
        shot(pg, f'{tag}-batch')
    no_hscroll(pg, f'{tag} batch')
    check(pg.inner_text('#bf-import').strip() == 'Importar 4 arquivos', f'{tag}: 4 files ready ({pg.inner_text("#bf-import")})')
    pg.click('#bf-import'); pg.wait_for_selector('#batch-done', timeout=15000)
    recs = {r['fileName']: r for r in J(pg, '() => Object.values(__ff.D().imports)')}
    check(recs['beneficio_valebem.pdf']['accountId'] == 'vale' and recs['conta_eur.pdf']['accountId'] == 'euro' and recs['extrato_laranja.pdf']['accountId'] == 'conta'
          and recs['fatura-cartao-2026-09.csv']['accountId'] == 'cartao', f'{tag}: each file in its account')
    by = lambda f: J(pg, '(id) => __ff.live().filter(t => t.importId === id)', recs[f]['id'])
    ben = by('beneficio_valebem.pdf')
    tr = [t for t in ben if t['kind'] == 'transfer']
    check(len(ben) == 8 and len(tr) == 2 and sum(t['amount'] for t in tr) == 0, f'{tag}: benefit card: 8 rows, wallet moves are transfers netting zero')
    check(all(t['categoryId'] == 'renda.beneficios' and t['kind'] == 'income' for t in ben if 'Crédito de benefício' in t['rawDescription']), f'{tag}: benefit credits = income Benefícios VA/VR')
    check(any(t.get('catSource') == 'wallet' for t in ben), f'{tag}: a wallet hints a category (below the dictionary)')
    eur = by('conta_eur.pdf')
    check(len(eur) == 5 and all(t['fx']['currency'] == 'EUR' and t['fx']['source'] == 'manual' for t in eur), f'{tag}: EUR account: 5 rows with the original euros')
    check(next(t for t in eur if 'Café' in t['rawDescription'])['amount'] == round(-1850 * 6.2), f'{tag}: booked BRL = euros × the month rate')
    check(J(pg, '() => __ff.D().accounts.find(a => a.id === "euro").currency') == 'EUR', f'{tag}: the account is marked EUR')
    check(J(pg, '() => __ff.D().settings.fxRates') == {'EUR': {'2026-09': 6.2, '2026-10': 6.3}}, f'{tag}: rates saved in settings.fxRates')
    ext = by('extrato_laranja.pdf')
    check(len(ext) == 19 and not any('SALDO' in t['rawDescription'] for t in ext), f'{tag}: extrato: 19 rows, no SALDO lines')
    check(len(by('fatura-cartao-2026-09.csv')) == 3, f'{tag}: the CSV in the same batch: 3 rows')
    if shots:
        shot(pg, f'{tag}-batch-done')
    # Ajustes → Cotações: change October → October rows recomputed
    pg.click('#btn-settings') if pg.locator('#btn-settings').count() else J(pg, '() => document.querySelector("[data-act=\\"settings\\"]").click()')
    pg.wait_for_selector('#fx-set')
    pg.fill('[data-fxset="EUR|2026-10"]', '7,00'); pg.click('#fx-save'); pg.wait_for_timeout(300)
    metro = J(pg, '() => __ff.live().find(t => /Metro Paris/.test(t.rawDescription))')
    check(metro['amount'] == -1470 and metro['fx']['rate'] == 7, f'{tag}: Ajustes → Cotações recomputes that month ({metro["amount"]})')
    if shots:
        pg.locator('#fx-set').scroll_into_view_if_needed()
        shot(pg, f'{tag}-settings-fx')
    pg.keyboard.press('Escape')


def net_check(pg, tag, allowed_extra=()):
    hosts = set()
    for u in pg._reqs:
        m = re.match(r'^(https?://[^/]+)', u)
        if m:
            hosts.add(m.group(1))
    allowed = {URL.rstrip('/'), 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'} | set(allowed_extra)
    check(hosts <= allowed, f'{tag}: only allow-listed hosts requested ({sorted(hosts - allowed)})')
    pdf_reqs = [u for u in pg._reqs if 'pdf.js' in u or 'pdf.worker' in u or 'pdf.min' in u]
    check(any(u == CDN + 'pdf.min.js' for u in pdf_reqs) and any(u == CDN + 'pdf.worker.min.js' for u in pdf_reqs), f'{tag}: pdf.js 3.11.174 from cdnjs ({len(pdf_reqs)} requests)')
    check(J(pg, '() => window.__workers') == 0, f'{tag}: no Web Worker created (pdf.js runs in the page thread)')
    csp = J(pg, '() => window.__csp')
    check(not csp, f'{tag}: no CSP violations {csp[:3]}')
    errs = [e for e in pg._errs if 'fonts.gstatic' not in e]
    check(not errs, f'{tag}: no console errors {errs[:3]}')


# ------------------------------------------------------------------------------------------------ scenarios
def scenario_artifact(b):
    section('A. Artifact build, artifact-like CSP, pdf.js from (intercepted) cdnjs — 390 light')
    ns = 'v24bA' + RUN
    seed_artifact(ns, base_meta())
    ctx, pg = open_artifact(b, ns)
    check(not any('pdf' in u for u in pg._reqs), 'A: pdf.js is not loaded at startup (lazy)')
    ev = pg._ev
    check(ev == 'blocked', f'A: the injected CSP is enforced (eval in a page script is blocked: {ev})')
    check(J(pg, "async () => { try { await fetch('https://example.com/x'); return 'reached'; } catch (e) { return 'blocked'; } }") == 'blocked', 'A: …and other hosts are unreachable (connect-src)')
    J(pg, '() => { window.__csp.length = 0; }')
    pg._errs.clear()
    flow_single(pg, 'art-390-light')
    flow_password(pg, 'art-390-light')
    flow_batch(pg, 'art-390-light')
    net_check(pg, 'art-390-light')
    ctx.close()


def scenario_screens(b):
    for (w, scheme) in ((390, 'dark'), (1280, 'light'), (1280, 'dark')):
        tag = f'art-{w}-{scheme}'
        section(f'S. {tag}')
        ns = f'v24bS{w}{scheme}' + RUN
        seed_artifact(ns, base_meta())
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        flow_single(pg, tag)
        flow_batch(pg, tag)
        net_check(pg, tag)
        ctx.close()


def scenario_local(b):
    section('L. site/ in local mode: pdf.js from /vendor with a same-origin worker')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, color_scheme='light', device_scale_factor=2, service_workers='block')
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.add_init_script(HOOKS)
    pg = ctx.new_page()
    attach(pg)
    pg.goto(LURL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    start_import(pg, new_acc='Conta Laranja')
    pg.set_input_files('#imp-file', os.path.join(FXD, 'extrato_laranja.pdf'))
    wait_step(pg)
    check(pg.is_visible('#pdf-detect') and 'Extrato bancário' in pg.inner_text('#pdf-detect'), 'local: extrato PDF read')
    check(J(pg, '() => __ff.state().imp.newAcc.type') == 'checking', 'local: new account typed "conta corrente" from the PDF')
    wk = J(pg, '() => window.__workerUrls || []')
    check(len(wk) == 1 and wk[0].startswith(LURL + 'vendor/pdf.worker.min.js'), f'local: a same-origin Web Worker parses the PDF ({wk})')
    pg.click('[data-act="imp-step"][data-s="3"]'); pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
    check(pg.is_visible('#pdf-ck-ok'), 'local: opening + rows = closing balance ✓')
    pg.click('[data-act="imp-step"][data-s="4"]'); pg.click('[data-act="imp-commit"]'); pg.wait_for_selector('#imp-done')
    check(J(pg, '() => __ff.live().length') == 19, 'local: 19 rows imported')
    shot(pg, 'loc-390-light-done')
    check(not [e for e in pg._errs if 'fonts' not in e], f'local: no console errors {pg._errs[:2]}')
    ctx.close()


def scenario_netlify(b):
    section('N. Netlify build with the real netlify.toml CSP: PDF import (vendored pdf.js + same-origin worker)')
    env = dict(os.environ, PORT=str(HPORT))
    proc = subprocess.Popen(['node', os.path.join(HERE, 'netlify_harness.mjs'), str(HPORT)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
            ctx.add_init_script(HOOKS)
            pg = ctx.new_page()
            attach(pg)
            pg.goto(HURL)
            pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
            pg.click('#signed-out [data-act="login"]'); pg.wait_for_selector('#ffl-email')
            pg.fill('#ffl-email', f'v24b{w}{scheme}{RUN}@exemplo.com'); pg.fill('#ffl-pass', 'senha-certa-123')
            pg.click('.ffl-card button[type="submit"]')
            wait(pg, '() => !!__ff.state().auth.user', 10000)
            start_import(pg, new_acc='Cartão Roxo')
            pg.set_input_files('#imp-file', os.path.join(FXD, 'fatura_roxa.pdf'))
            wait_step(pg)
            check(pg.is_visible('#pdf-detect'), f'{tag}: PDF read under the Netlify CSP')
            pg.click('[data-act="imp-step"][data-s="3"]'); pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
            pg.click('[data-act="imp-step"][data-s="4"]'); pg.click('[data-act="imp-commit"]'); pg.wait_for_selector('#imp-done')
            check(J(pg, '() => __ff.live().length') == 12, f'{tag}: 12 rows imported')
            start_import(pg, acc=J(pg, '() => __ff.D().accounts[0].id'))
            pg.set_input_files('#imp-file', os.path.join(FXD, 'fatura_protegida.pdf'))
            wait_step(pg)
            pg.fill('#imp-pdf-pw', '12345'); pg.click('#imp-pdf-pw-go'); wait_step(pg)
            check(pg.is_visible('#pdf-detect'), f'{tag}: password PDF opened')
            shot(pg, f'{tag}-pdf')
            no_hscroll(pg, tag)
            wk = J(pg, '() => window.__workerUrls || []')
            check(wk and all(u.startswith(HURL + 'vendor/pdf.worker.min.js') for u in wk), f'{tag}: same-origin worker ({wk})')
            check(not any(re.match(r'https?://(?!127\.0\.0\.1)', u) and 'fonts.g' not in u for u in pg._reqs), f'{tag}: no third-party request')
            csp = J(pg, '() => window.__csp')
            check(not csp, f'{tag}: no CSP violations {csp[:3]}')
            errs = [e for e in pg._errs if 'fonts.gstatic' not in e]
            check(not errs, f'{tag}: no console errors {errs[:3]}')
            ctx.close()
    finally:
        proc.terminate()


def scenario_real(b):
    section("R. the user's real PDFs (runtime only; counts)")
    # the user's PDFs are found by content, never by name (no file names of real documents in the repo)
    mp = px = None
    for f in sorted(glob.glob(os.path.join(REAL, '*.pdf'))) if os.path.isdir(REAL) else []:
        head = subprocess.run(['pdftotext', '-l', '1', f, '-'], capture_output=True, text=True).stdout.upper()
        if re.search(r'BENEF[IÍ]CIO|CARTEIRA|REFEI[CÇ][AÃ]O', head) and not px:
            px = f
        elif re.search(r'FATURA|VENCIMENTO|VENCE EM', head) and not mp:
            mp = f
    if not (mp and px):
        print('  skip (real PDFs not present)')
        return
    for (w, scheme) in ((390, 'light'), (1280, 'dark')):
        tag = f'real-{w}-{scheme}'
        ns = f'v24bR{w}{scheme}' + RUN
        seed_artifact(ns, {'accounts': {'items': [{'id': 'conta', 'name': 'Conta', 'type': 'checking'}]}, 'settings': {'budgets': {}, 'schemaVersion': 2, 'updatedAt': STAMP}})
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        start_import(pg, new_acc='Cartão')
        pg.set_input_files('#imp-file', mp)
        wait_step(pg)
        check(pg.is_visible('#pdf-detect') and '✓ total bate' in pg.inner_text('#pdf-detect'), f'{tag}: fatura read, total reconciles')
        shot(pg, f'{tag}-fatura-detect')
        pg.click('[data-act="imp-step"][data-s="3"]'); pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
        no_hscroll(pg, f'{tag} fatura preview')
        shot(pg, f'{tag}-fatura-preview')
        pg.click('[data-act="imp-step"][data-s="4"]'); pg.click('[data-act="imp-commit"]'); pg.wait_for_selector('#imp-done')
        rows = J(pg, '() => __ff.live()')
        acc = J(pg, '() => __ff.D().accounts.find(a => a.type === "credit_card")')
        print(f'  fatura: {len(rows)} rows, {sum(1 for t in rows if t.get("installment"))} parcelas, {sum(1 for t in rows if t["kind"] == "card_payment")} payments, '
              f'{sum(1 for t in rows if t["amount"] < 0 and not t.get("installment"))} charges; card days configured: {bool(acc.get("closingDay") and acc.get("dueDay"))}')
        check(len(rows) == 11 and acc['type'] == 'credit_card' and acc.get('closingDay') and acc.get('dueDay'), f'{tag}: fatura imported, card days from the PDF')
        alerts = J(pg, '() => FinEngine.updateAlerts({ accounts: __ff.D().accounts, imports: __ff.D().imports, transactions: __ff.live(), today: "2026-09-20" })')
        check(not any(a['kind'] == 'fatura_fechou' for a in alerts), f'{tag}: the imported cycle is covered (no "fatura fechou" alert on 20/09)')
        start_import(pg, new_acc='Vale')
        pg.set_input_files('#imp-file', px)
        wait_step(pg)
        check(J(pg, '() => __ff.state().imp.newAcc.type') == 'benefit', f'{tag}: benefit extrato → new account typed "Benefício (VA/VR)"')
        shot(pg, f'{tag}-beneficio-detect')
        pg.click('[data-act="imp-step"][data-s="3"]'); pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
        no_hscroll(pg, f'{tag} benefit preview')
        shot(pg, f'{tag}-beneficio-preview')
        pg.click('[data-act="imp-step"][data-s="4"]'); pg.click('[data-act="imp-commit"]'); pg.wait_for_selector('#imp-done')
        vid = J(pg, '() => __ff.D().accounts.find(a => a.type === "benefit").id')
        ben = J(pg, '(v) => __ff.live().filter(t => t.accountId === v)', vid)
        tr = [t for t in ben if t['kind'] == 'transfer']
        print(f'  benefit: {len(ben)} rows, {len(tr)} wallet moves (net {sum(t["amount"] for t in tr)}), {sum(1 for t in ben if t["kind"] == "income")} credits, '
              f'{sum(1 for t in ben if t["kind"] == "expense")} purchases, {sum(1 for t in ben if t.get("time"))} with time')
        check(len(ben) == 33 and sum(t['amount'] for t in tr) == 0, f'{tag}: benefit imported, wallet moves net zero')
        goto_tab(pg, 'tx')
        shot(pg, f'{tag}-tx')
        check(not [e for e in pg._errs if 'fonts' not in e], f'{tag}: no console errors')
        ctx.close()


def main():
    srv = artifact_server.start(PORT)
    lsrv = site_server.start(LPORT)
    only = sys.argv[1:] or ['A', 'S', 'L', 'N', 'R']
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            if 'A' in only:
                scenario_artifact(b)
            if 'S' in only:
                scenario_screens(b)
            if 'L' in only:
                scenario_local(b)
            if 'N' in only:
                scenario_netlify(b)
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
