"""End-to-end checks of the file pickers on phones (headless Chromium, 390 px):
  No screen ever shows a notice about the picker / using another app or browser (import screen and Ajustes backup).
  W. Artifact build + Android WebView UA: no notice, the paste section is silently open; paste a CSV → wizard → import;
     "Colar outro arquivo" → a second paste → import; a ~100 KB paste does not freeze the page; a paste event on the
     import screen fills the box. Ajustes: no backup notice.
  N. Android Chrome UA (not a WebView): paste section closed; a tap on the picker that does not open it (headless) →
     the paste section opens, still no notice.
  C. site/ in local mode + desktop Chrome UA: no notice; setInputFiles with one file (wizard) and with two (batch list);
     an unsupported file (PDF) → clear error; inputs are visually hidden (not display:none), no overlay input;
     "Importar backup" via setInputFiles restores into a fresh browser.
Usage: npm run build:artifact && python3 test/e2e/e2e_mobile.py      Screenshots: screens/mobile/*.png (gitignored)."""
import sys, os, json, re, time, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402
import server as site_server  # noqa: E402

PORT = int(os.environ.get('FF_MOB_PORT', '8795'))
LPORT = int(os.environ.get('FF_MOB_LOCAL_PORT', '8796'))
URL = f'http://127.0.0.1:{PORT}/'
LURL = f'http://127.0.0.1:{LPORT}/'
SCR = os.path.join(ROOT, 'screens', 'mobile')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
RUN = str(int(time.time()))
TMP = tempfile.mkdtemp(prefix='ff-mob-')
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []

UA_WV = ('Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) '
         'Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36')
UA_ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
UA_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

CSV1 = 'Data;Descrição;Valor\n05/08/2026;IFOOD *RESTAURANTE;-54,90\n06/08/2026;PADARIA MOBTEST;-12,00\n10/08/2026;SALARIO EMPRESA;5000,00\n'
CSV2 = 'Data;Descrição;Valor\n05/09/2026;UBER *TRIP;-23,40\n07/09/2026;FARMACIA SAO JOAO;-41,10\n'


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


def shot(pg, name):
    pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(SCR, name + '.png'))


def new_ctx(b, ua, w=390, h=844, mobile=True):
    ctx = b.new_context(viewport={'width': w, 'height': h}, user_agent=ua, device_scale_factor=2, is_mobile=mobile, has_touch=mobile)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* xlsx stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    return ctx


def attach(pg):
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))


def open_artifact(b, ua, ns):
    ctx = new_ctx(b, ua)
    cfg = {'ns': ns, 'uid': 'u_mob'}
    ctx.add_init_script(FAKE_JS + '\n;(function(c){ window.__saved = [];'
                        ' var f = FakeClaude.createFakeClaude({ backend: FakeClaude.createHttpBackend("/__fakedb", c.ns, 150), userId: c.uid, delayMs: 40, saved: window.__saved });'
                        ' window.claude = Object.freeze({ use: f.claude.use });'
                        '})(' + json.dumps(cfg) + ');')
    pg = ctx.new_page(); attach(pg)
    pg.goto(URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=20000)
    pg.wait_for_timeout(300)
    return ctx, pg


def open_local(b, ua, mobile=False):
    ctx = new_ctx(b, ua, mobile=mobile)
    pg = ctx.new_page(); attach(pg)
    pg.goto(LURL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    pg.wait_for_timeout(300)
    return ctx, pg


def goto_import(pg):
    pg.click('.tab[data-tab="painel"]'); pg.wait_for_timeout(100)
    pg.click('.tab[data-tab="import"]'); pg.wait_for_timeout(200)


def finish_wizard(pg):
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"], [data-act="imp-step"][data-s="3"]', timeout=15000)
    if pg.is_visible('[data-act="imp-step"][data-s="3"]') and not pg.is_visible('[data-act="imp-step"][data-s="4"]'):
        pg.click('[data-act="imp-step"][data-s="3"]')
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
    pg.click('[data-act="imp-step"][data-s="4"]')
    pg.click('[data-act="imp-commit"]')
    pg.wait_for_selector('#imp-done', timeout=10000)


def new_account(pg, name, typ='checking'):
    pg.select_option('#imp-acc', '__new'); pg.fill('#imp-acc-name', name); pg.select_option('#imp-acc-type', typ)


def no_hscroll(pg, label):
    r = J(pg, '() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    check(r[0] <= r[1], f'{label}: no horizontal page scroll ({r[0]} <= {r[1]})')


NOTICE_RX = r'/chrome|app claude|seletor|não abre|parece não ter aberto|abra este app|copiar link/i'


def no_notice(pg, label):
    r = J(pg, '() => { const rx = ' + NOTICE_RX + '; const roots = [...document.querySelectorAll("#scr-import, .sheet, [role=dialog], #restore-file")].map(e => e.closest(".sheet, [role=dialog]") || e);'
              ' const hits = [...document.querySelectorAll("#scr-import .banner, #scr-import [role=status], .sheet .banner, [role=dialog] .banner, #picker-notice, #restore-notice, #restore-notice-box")]'
              '.map(e => e.textContent.trim()); const txt = roots.map(e => e.innerText || "").join("\\n").split("\\n").filter(l => rx.test(l));'
              ' return { banners: hits, lines: txt }; }')
    check(not r['banners'] and not r['lines'], f'{label}: no picker / other-app notice ({r["banners"][:2]} {r["lines"][:2]})')


def input_hidden_ok(pg, sel, label):
    st = J(pg, '(s) => { const i = document.querySelector(s); if (!i) return null; const cs = getComputedStyle(i); const r = i.getBoundingClientRect();'
              ' return { disp: cs.display, w: r.width, h: r.height, inLabel: !!i.closest("label"), lbl: !!document.querySelector(`label[for="${i.id}"]`), accept: i.accept }; }', sel)
    check(st is not None and st['disp'] != 'none' and st['w'] <= 1 and st['h'] <= 1, f'{label}: {sel} visually hidden, not display:none ({st and st["disp"]}, {st and st["w"]}x{st and st["h"]})')
    check(st is not None and not st['inLabel'] and st['lbl'], f'{label}: {sel} is not inside the label; a <label for> opens it')
    return st


# ----------------------------------------------------------------------------------------------- W. Claude app WebView
def scenario_webview(b):
    section('W. Artifact build, Android WebView UA (Claude app), 390 px')
    ctx, pg = open_artifact(b, UA_WV, 'mobw' + RUN)
    goto_import(pg)
    no_notice(pg, 'wv import')
    check(J(pg, '() => document.querySelector("#imp-paste-box").open'), 'paste section is open (WebView UA)')
    st = input_hidden_ok(pg, '#imp-file', 'wv')
    check(st and 'text/*' in st['accept'] and 'application/octet-stream' in st['accept'] and '.xlsx' in st['accept'], 'wide accept list')
    no_hscroll(pg, 'wv import')
    shot(pg, 'wv-import-390')
    # 1st paste
    new_account(pg, 'Conta colada')
    pg.fill('#imp-paste', CSV1)
    pg.click('[data-act="imp-paste"]')
    finish_wizard(pg)
    check(J(pg, '() => __ff.live().filter(t => /IFOOD|PADARIA MOBTEST|SALARIO/.test(t.rawDescription)).length') == 3, '1st pasted file imported (3 rows)')
    check(pg.is_visible('#imp-paste-again'), '"Colar outro arquivo" offered')
    shot(pg, 'wv-done-390')
    # 2nd paste
    pg.click('#imp-paste-again')
    check(J(pg, '() => document.querySelector("#imp-paste-box").open && document.querySelector("#imp-paste").value === "" && document.activeElement === document.querySelector("#imp-paste")'), 'paste box open, empty and focused for the next file')
    check(J(pg, '() => document.querySelector("#imp-acc").value') == J(pg, '() => __ff.D().accounts.find(a => a.name === "Conta colada").id'), 'same account kept for the next paste')
    check(pg.is_visible('#imp-pasted'), 'counter of pasted files shown')
    pg.fill('#imp-paste', CSV2)
    pg.click('[data-act="imp-paste"]')
    finish_wizard(pg)
    check(J(pg, '() => __ff.live().filter(t => /UBER|FARMACIA/.test(t.rawDescription)).length') == 2, '2nd pasted file imported (2 rows)')
    check(J(pg, '() => Object.keys(__ff.D().imports).length') == 2, 'two import records')
    # paste event anywhere on the import screen
    pg.click('#imp-paste-again')
    J(pg, '() => document.activeElement && document.activeElement.blur()')
    J(pg, '(t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); document.querySelector("#scr-import h2").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }', CSV2)
    check(J(pg, '() => document.querySelector("#imp-paste").value') == CSV2, 'paste event on the import screen fills the box')
    # big paste (~100 KB) must not freeze
    lines = ['Data;Descrição;Valor'] + [f'{(i % 28) + 1:02d}/07/2026;LOJA TESTE NUMERO {i:05d} COMPRA;-{(i % 900) + 1},{i % 100:02d}' for i in range(2400)]
    big = '\n'.join(lines)
    check(len(big) > 95000, f'big paste is ~100 KB ({len(big)} bytes)')
    pg.fill('#imp-paste', big)
    J(pg, '() => { window.__gap = 0; let last = performance.now(); window.__tick = setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - last); last = n; }, 20); }')
    t0 = time.time()
    pg.click('[data-act="imp-paste"]')
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"], [data-act="imp-step"][data-s="3"]', timeout=15000)
    dt = time.time() - t0
    gap = J(pg, '() => { clearInterval(window.__tick); return window.__gap; }')
    check(dt < 6, f'big paste analyzed in {dt:.2f}s')
    check(gap < 2500, f'longest main-thread stall during the big paste {gap:.0f} ms')
    rows = J(pg, '() => (__ff.state().imp.result.transactions || []).length')
    check(rows == 2400, f'all 2400 rows read ({rows})')
    # backup notice in Ajustes
    pg.click('#btn-settings'); pg.wait_for_selector('#restore-file', state='attached')
    no_notice(pg, 'wv Ajustes')
    input_hidden_ok(pg, '#restore-file', 'wv backup')
    shot(pg, 'wv-settings-390')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()


# ----------------------------------------------------------------------------------------------- N. Android Chrome
def scenario_android_chrome(b):
    section('N. Android Chrome UA: picker that does not open → paste section opens, no notice')
    ctx, pg = open_artifact(b, UA_ANDROID_CHROME, 'mobn' + RUN)
    goto_import(pg)
    no_notice(pg, 'android before tap')
    check(not J(pg, '() => document.querySelector("#imp-paste-box").open'), 'paste section closed')
    pg.tap('#drop')
    ok = wait(pg, '() => document.querySelector("#imp-paste-box").open', 4000)
    check(ok, 'tap that did not open a picker (no blur/visibilitychange/change in 1.5 s) → paste section opens')
    pg.wait_for_timeout(300)
    no_notice(pg, 'android after failed tap')
    pg.click('#btn-settings'); pg.wait_for_selector('#restore-file', state='attached')
    pg.tap('label[for="restore-file"]'); pg.wait_for_timeout(1900)
    no_notice(pg, 'android Ajustes after failed tap')
    shot(pg, 'android-chrome-failed-390')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()


# ----------------------------------------------------------------------------------------------- C. desktop Chrome
def scenario_chrome(b):
    section('C. site/ local mode, desktop Chrome UA')
    ctx, pg = open_local(b, UA_DESKTOP)
    goto_import(pg)
    no_notice(pg, 'chrome import')
    input_hidden_ok(pg, '#imp-file', 'chrome')
    check(J(pg, '() => !document.querySelector(".drop input")'), 'no input overlaid inside the drop zone')
    f1 = os.path.join(TMP, 'extrato-ago.csv'); open(f1, 'w', encoding='utf-8').write(CSV1)
    f2 = os.path.join(TMP, 'extrato-set.csv'); open(f2, 'w', encoding='utf-8').write(CSV2)
    pdf = os.path.join(TMP, 'fatura.pdf'); open(pdf, 'wb').write(b'%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n')
    noext = os.path.join(TMP, 'download'); open(noext, 'w', encoding='utf-8').write(CSV2)
    # unsupported file
    new_account(pg, 'Conta arquivo')
    pg.set_input_files('#imp-file', pdf)
    pg.wait_for_selector('#scr-import .banner.err', timeout=8000)
    check('PDF' in J(pg, '() => document.querySelector("#scr-import .banner.err").textContent'), 'PDF → clear error')
    # single file
    new_account(pg, 'Conta arquivo')
    pg.set_input_files('#imp-file', f1)
    finish_wizard(pg)
    check(J(pg, '() => __ff.live().length') == 3, 'single file via setInputFiles imported')
    check(not pg.is_visible('#imp-paste-again'), 'no "Colar outro arquivo" after a file import')
    # a file with no extension (Android content URI names) is sniffed as text
    pg.click('[data-act="imp-reset"]')
    pg.set_input_files('#imp-file', noext)
    finish_wizard(pg)
    check(J(pg, '() => __ff.live().length') == 5, 'file without extension read as CSV')
    # several files → batch list
    pg.click('[data-act="imp-reset"]')
    pg.set_input_files('#imp-file', [f1, f2])
    ok = wait(pg, '() => document.querySelectorAll("#bf-list .bf").length === 2', 10000)
    check(ok, 'two files via setInputFiles → batch list with 2 rows')
    input_hidden_ok(pg, '#imp-file', 'chrome batch')
    pg.click('[data-act="bf-reset"]')
    # backup round trip
    J(pg, 'async () => { await __ff.flush(); }'); pg.wait_for_timeout(300)
    dump = J(pg, 'async () => JSON.stringify(await __ff.store().exportAll())')
    check(sum(len(v.get('transactions', v) if isinstance(v, dict) else v) for v in json.loads(dump)['months'].values()) >= 5, 'exported backup holds the transactions')
    bk = os.path.join(TMP, 'backup.json'); open(bk, 'w', encoding='utf-8').write(dump)
    n_before = J(pg, '() => __ff.live().length')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()
    ctx, pg = open_local(b, UA_DESKTOP)
    check(J(pg, '() => __ff.live().filter(t => /PADARIA MOBTEST/.test(t.rawDescription)).length') == 0, 'fresh browser starts without the data')
    pg.click('#btn-settings'); pg.wait_for_selector('#restore-file', state='attached')
    no_notice(pg, 'chrome Ajustes')
    input_hidden_ok(pg, '#restore-file', 'chrome backup')
    pg.set_input_files('#restore-file', bk)
    pg.wait_for_selector('#restore-confirm', timeout=8000)
    pg.click('#restore-yes')
    ok = wait(pg, f'() => __ff.state().mode === "real" && __ff.live().length === {n_before}', 15000)
    check(ok, f'backup restored via setInputFiles ({n_before} transactions; now {J(pg, "() => [__ff.state().mode, __ff.live().length]")})')
    # a CSV picked as backup → readable error, nothing restored
    pg.click('#btn-settings'); pg.wait_for_selector('#restore-file', state='attached')
    pg.set_input_files('#restore-file', f1)
    ok = wait(pg, '() => [...document.querySelectorAll(".toast, [role=status], [role=alert]")].some(e => /backup/i.test(e.textContent) && /json/i.test(e.textContent))', 5000)
    check(ok, 'CSV chosen as backup → readable error')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()


def main():
    srv = artifact_server.start(PORT)
    lsrv = site_server.start(LPORT)
    only = sys.argv[1:] or ['W', 'N', 'C']
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            if 'W' in only:
                scenario_webview(b)
            if 'N' in only:
                scenario_android_chrome(b)
            if 'C' in only:
                scenario_chrome(b)
        finally:
            b.close()
    srv.shutdown(); lsrv.shutdown()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
