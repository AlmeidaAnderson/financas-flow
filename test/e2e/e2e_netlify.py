"""End-to-end tests of the REAL site/store.js in "netlify" mode against the REAL API core, in headless Chromium.

Usage: python3 test/e2e/e2e_netlify.py
  - starts test/e2e/netlify_harness.mjs (static site/ with the netlify.toml headers incl. CSP + api-core on /api/*)
  - CSP scenario uses the real vendored Identity library; the other scenarios swap it for test/e2e/fake_identity.mjs
    (the harness accepts only its fake `test-<id>` tokens — test-only, nothing of this is deployed)
  - two browser contexts = two devices (PC 1280 + phone 390), same user, shared server
  - the user's real v1 data (FF_REAL_DATA) is turned into a temp backup file at runtime; never written to the repo.
"""
import sys, os, json, re, subprocess, time, tempfile, glob, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PORT = int(os.environ.get('FF_HARNESS_PORT', '8777'))
URL = f'http://127.0.0.1:{PORT}/'
REAL = os.environ.get('FF_REAL_DATA', '/tmp/claude-0/-home-claude/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db/data/users/me/store')
TMP = tempfile.mkdtemp(prefix='ff-e2e-n-')
FAKE_ID = open(os.path.join(HERE, 'fake_identity.mjs'), encoding='utf-8').read()
FAILS, PASSES = [], []
CSP_HOOK = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.sourceFile || '') + ':' + e.lineNumber));
"""


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    (PASSES if cond else FAILS).append(msg)
    return cond


def section(t):
    print('\n== ' + t, flush=True)


def J(pg, expr, arg=None):
    return pg.evaluate(expr, arg) if arg is not None else pg.evaluate(expr)


def new_ctx(b, scheme='light', w=390, h=844, fake=True, local=False, sw='block'):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, accept_downloads=True, service_workers=sw)
    ctx.route(re.compile(r'https://fonts\.googleapis\.com/.*'), lambda r: r.fulfill(status=200, body='/* fonts */', content_type='text/css'))
    ctx.route(re.compile(r'https://fonts\.gstatic\.com/.*'), lambda r: r.fulfill(status=404, body=''))
    if fake:
        ctx.route('**/vendor/netlify-identity.js', lambda r: r.fulfill(status=200, body=FAKE_ID, content_type='text/javascript'))
    if local:
        ctx.route('**/.netlify/identity/settings', lambda r: r.fulfill(status=404, body='nope'))
    ctx.add_init_script(CSP_HOOK)
    return ctx


def open_page(ctx, url=None):
    pg = ctx.new_page()
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))
    pg.goto(url or URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    pg.wait_for_timeout(300)
    return pg


def wait(pg, js, timeout=10000):
    try:
        pg.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


def synced(pg, timeout=10000):
    return wait(pg, '() => __ff.store().status === "synced"', timeout)


def focus(pg):
    J(pg, '() => window.dispatchEvent(new Event("focus"))')


def login(pg, email, pw='senha-certa-123'):
    pg.click('#signed-out [data-act="login"]')
    pg.wait_for_selector('#ffl-email')
    pg.fill('#ffl-email', email)
    pg.fill('#ffl-pass', pw)
    pg.click('.ffl-card button[type="submit"]')


def blobs(uid):
    return json.loads(urllib.request.urlopen(f'{URL}__test/blobs?uid={uid}').read())


def server_live(uid):
    out = []
    for k, d in blobs(uid).items():
        if k.startswith('months/'):
            out += [t for t in d['transactions'] if not t.get('deleted')]
    return out


def live(pg, pred='t => true'):
    return J(pg, '() => __ff.live().filter(' + pred + ')')


def build_real_dump():
    if not os.path.isdir(REAL):
        return None, None
    meta = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL, 'meta', '*.json'))}
    months = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL, 'months', '*.json'))}
    p = os.path.join(TMP, 'v1-db.json')
    json.dump({'meta': meta, 'months': months}, open(p, 'w', encoding='utf-8'))
    rows = [t for m in months.values() for t in m.get('transactions', [])]
    imps = sorted({t.get('importId') for t in rows if t.get('importId')})
    bank = next(i for i in imps if any(t.get('importId') == i and re.search('rendimento', t.get('rawDescription', ''), re.I) for t in rows))
    return p, {'bank': bank, 'card': next(i for i in imps if i != bank), 'acc': meta['accounts']['items'][0]['id'], 'n': len(rows)}


# ------------------------------------------------------------------------------------------------ CSP
def scenario_csp(b):
    section('CSP from netlify.toml: zero violations, zero console errors (real Identity lib, signed out; and local mode)')
    for (w, scheme) in ((390, 'light'), (390, 'dark'), (1280, 'light'), (1280, 'dark')):
        ctx = new_ctx(b, scheme, w=w, h=900, fake=False)
        pg = open_page(ctx)
        hdr = J(pg, '() => fetch("/", {cache: "no-store"}).then(r => r.headers.get("content-security-policy"))')
        check(hdr and "script-src 'self'" in hdr, f'{w}/{scheme}: CSP header present on the page')
        check(J(pg, '() => __ff.state().auth.mode') == 'netlify', f'{w}/{scheme}: netlify mode detected')
        check(pg.is_visible('#signed-out'), f'{w}/{scheme}: signed-out screen')
        pg.click('#signed-out [data-act="login"]')
        check(wait(pg, '() => !!document.querySelector("#ffl-email")', 5000), f'{w}/{scheme}: login dialog opens (real Identity lib loaded under CSP)')
        pg.keyboard.press('Escape')
        for t in ('tx', 'import', 'cats', 'painel'):
            pg.click(f'.tab[data-tab="{t}"]'); pg.wait_for_timeout(120)
        pg.click('#btn-settings'); pg.wait_for_timeout(150); pg.keyboard.press('Escape')
        pg.wait_for_timeout(200)
        csp = J(pg, '() => window.__csp')
        check(not csp, f'{w}/{scheme}: no CSP violations {csp[:3]}')
        errs = [e for e in pg._errs if 'fonts.gstatic' not in e]
        check(not errs, f'{w}/{scheme}: no console errors {errs[:3]}')
        sw = J(pg, '() => fetch("/sw.js").then(r => r.headers.get("cache-control"))')
        check(sw == 'no-cache', 'sw.js served with Cache-Control no-cache')
        ctx.close()
    # local mode under the same CSP (all screens incl. import wizard + holerite + date picker)
    ctx = new_ctx(b, 'light', w=390, local=True)
    pg = open_page(ctx)
    check(J(pg, '() => __ff.state().auth.mode') == 'local', 'local mode when Identity is absent')
    pg.click('.tab[data-tab="import"]')
    pg.click('[data-act="imp-tab"][data-t="holerite"]')
    pg.click('[data-act="datepick"][data-for="hol-date"]')
    pg.wait_for_timeout(200); pg.keyboard.press('Escape')
    pg.click('.tab[data-tab="tx"]'); pg.click('[data-act="filters"]'); pg.wait_for_timeout(200); pg.keyboard.press('Escape')
    pg.click('.tab[data-tab="painel"]'); pg.wait_for_timeout(200)
    check(not J(pg, '() => window.__csp'), f'local mode: no CSP violations {J(pg, "() => window.__csp")[:3]}')
    errs = [e for e in pg._errs if 'fonts.gstatic' not in e and 'status of 404' not in e]  # the 404 is this test's own "no Identity" route
    check(not errs, f'local mode: no console errors {errs[:3]}')
    ctx.close()


# ------------------------------------------------------------------------------------------------ netlify mode, 2 devices
def scenario_netlify(b):
    dump, R = build_real_dump()
    user = 'eu' + str(int(time.time()))
    email = user + '@exemplo.com'

    section('signed out → login screen → login (netlify mode, real store.js + real API)')
    ctxA = new_ctx(b, 'light', w=390, h=844)
    A = open_page(ctxA)
    check(A.is_visible('#signed-out'), 'A: signed-out screen with "Entrar"')
    check('Entre para sincronizar' in A.inner_text('#store-pill'), 'A: pill "Entre para sincronizar"')
    check(J(A, '() => __ff.state().mode') == 'example', 'A: example data while signed out')
    r = J(A, '() => fetch("/api/all", {headers: {"x-finflow": "1"}}).then(r => r.status)')
    check(r == 401, f'API without a user → 401 ({r})')
    login(A, email, 'errada')
    check(wait(A, '() => /incorretos/.test((document.querySelector(".ffl-err")||{}).textContent||"")', 5000), 'wrong password → "E-mail ou senha incorretos."')
    A.fill('#ffl-pass', 'senha-certa-123'); A.click('.ffl-card button[type="submit"]')
    check(wait(A, '() => __ff.state().auth.user && !document.querySelector("#ffl-email")'), 'login closes the dialog')
    check(synced(A), 'A: status synced')
    check('Sincronizado' in A.inner_text('#store-pill'), 'A: pill "Sincronizado"')
    r = J(A, '() => fetch("/api/all").then(r => r.status)')
    check(r == 401, f'API call without X-FinFlow/Bearer from the page → 401 ({r})')

    if not dump:
        section('real data not found — skipping netlify real-data scenarios')
        ctxA.close(); return

    section('Ajustes → Importar backup (raw v1 db) in netlify mode → migration, saved on the server')
    A.click('#btn-settings')
    A.set_input_files('#restore-file', dump)
    A.wait_for_selector('#restore-confirm')
    A.click('#restore-yes')
    check(wait(A, '() => __ff.state().mode === "real" && __ff.live().length > 100', 20000), 'A: real data loaded')
    check(len(live(A)) == R['n'], f'A: all {R["n"]} v1 transactions present ({len(live(A))})')
    sal = live(A, 't => /^renda\\.salario/.test(t.categoryId || "")')
    check(sal and all(t['kind'] == 'income' for t in sal), f'salary rows are income ({len(sal)})')
    check(any(r.get('origin') == 'learned' for r in J(A, '() => __ff.D().rules')), 'learned rules created')
    check(sorted(J(A, '() => Object.keys(__ff.D().imports)')) == sorted([R['bank'], R['card']]), 'two imports backfilled')
    A.wait_for_timeout(800)
    check(synced(A, 20000), 'A: everything uploaded (synced)')
    srv = server_live(user)
    check(len(srv) == R['n'], f'server has all live rows ({len(srv)})')
    bl = blobs(user)
    check(all(k.startswith(('meta/', 'months/', 'index')) for k in bl), f'blob keys only under u/<id>/ meta|months|index ({sorted(bl)[:4]}…)')
    check(bl.get('meta/imports', {}).get('data', {}).get(R['bank']) is not None, 'imports meta saved as a plain map')
    check(isinstance(bl.get('meta/rules', {}).get('data', {}).get('rules'), list), 'rules meta saved as {rules, history}')
    check(isinstance(bl.get('meta/categories', {}).get('data', {}).get('items'), list), 'categories meta saved as {items}')
    check(isinstance(bl.get('meta/settings', {}).get('data', {}).get('budgets'), dict), 'settings meta saved with budgets')

    section('device B (PC 1280, dark) logs in → same data')
    ctxB = new_ctx(b, 'dark', w=1280, h=900)
    B = open_page(ctxB)
    login(B, email)
    check(wait(B, '() => __ff.state().mode === "real" && __ff.live().length > 100', 15000), 'B: data loaded from the server')
    check(len(live(B)) == R['n'], f'B: same number of rows ({len(live(B))})')
    check(synced(B), 'B: synced')
    B.wait_for_timeout(500)
    check(len(J(B, '() => window.__csp')) == 0 and len(J(A, '() => window.__csp')) == 0, 'no CSP violations on A/B while logged in')

    section('move the bank-extrato import to a new "Conta XP" checking account (on A) → B sees it')
    A.click('#btn-settings'); A.click('#btn-accounts'); A.wait_for_selector('#imp-list')
    A.click(f'.imp-row[data-imp="{R["bank"]}"] [data-act="imp-move"]')
    A.wait_for_selector('#move-box')
    A.select_option('#mv-acc', '__new')
    A.fill('#mv-name', 'Conta XP')
    A.select_option('#mv-type', 'checking')
    A.click('#mv-confirm'); A.wait_for_timeout(300)
    acc = J(A, '() => __ff.D().accounts.find(a => a.name === "Conta XP")')
    check(acc and acc['type'] == 'checking', 'Conta XP (checking) created')
    moved = live(A, f't => t.importId === "{R["bank"]}"')
    check(acc and moved and all(t['accountId'] == acc['id'] for t in moved), f'{len(moved)} rows moved to Conta XP')
    A.click('.sheet-h [data-act="closesheet"]')
    A.wait_for_timeout(500); check(synced(A), 'A: move synced')
    focus(B)
    check(wait(B, '() => __ff.D().accounts.some(a => a.name === "Conta XP") && __ff.live().filter(t => t.importId === %s).every(t => t.accountId === %s)' % (json.dumps(R['bank']), json.dumps(acc['id'] if acc else '')), 8000), 'B: sees Conta XP + moved rows after one focus/poll')

    section('"Excluir importação" on A while B is offline with a stale edit → deleted everywhere, never resurrected')
    card_rows = live(B, f't => t.importId === "{R["card"]}"')
    victim = card_rows[0]
    ctxB.set_offline(True)
    B.wait_for_timeout(200)
    J(B, '(id) => { const t = __ff.live().find(x => x.id === id); }', victim['id'])
    B.click('.tab[data-tab="tx"]')
    B.fill('#tx-search', victim['merchant'] or victim['rawDescription']); B.wait_for_timeout(300)
    B.click(f'#tx-list .tx[data-id="{victim["id"]}"]')
    B.wait_for_selector('#ed-cat')
    B.select_option('#ed-cat', 'compras.casa')
    B.click('[data-act="savetx"]'); B.wait_for_timeout(600)
    check(wait(B, '() => __ff.store().status === "offline"', 4000), 'B: offline, edit queued')
    A.wait_for_timeout(50)
    A.click('#btn-settings'); A.click('#btn-accounts'); A.wait_for_selector('#imp-list')
    A.click(f'.imp-row[data-imp="{R["card"]}"] [data-act="imp-del"]')
    A.wait_for_selector('#del-box'); A.click('#del-confirm'); A.wait_for_timeout(300)
    A.click('.sheet-h [data-act="closesheet"]')
    check(len(live(A, f't => t.importId === "{R["card"]}"')) == 0, 'A: card import rows gone')
    A.wait_for_timeout(500); check(synced(A), 'A: deletion synced')
    check(not [t for t in server_live(user) if t.get('importId') == R['card']], 'server: card import rows are tombstones')
    ctxB.set_offline(False)
    J(B, '() => window.dispatchEvent(new Event("online"))')
    check(synced(B, 15000), 'B: back online, queue flushed')
    B.wait_for_timeout(500); focus(B); B.wait_for_timeout(800)
    left = [t for t in server_live(user) if t.get('importId') == R['card']]
    check(not left, f'server: B\'s stale edit did NOT resurrect deleted rows ({len(left)})')
    check(wait(B, '() => !__ff.live().some(t => t.importId === %s)' % json.dumps(R['card']), 6000), 'B: card import rows disappeared')
    focus(A); A.wait_for_timeout(800)
    check(not live(A, f't => t.importId === "{R["card"]}"'), 'A: still gone after syncing with B')
    check(len(J(A, '() => Object.keys(__ff.D().imports)')) == 1, 'A: Importações lists 1 import')

    section('offline edits on A (account rename + type) queue and flush on reconnect; B sees them')
    ctxA.set_offline(True); A.wait_for_timeout(200)
    A.click('#btn-settings'); A.click('#btn-accounts'); A.wait_for_selector('#imp-list')
    A.fill(f'[data-accname="{acc["id"]}"]', 'XP Conta Corrente')
    A.press(f'[data-accname="{acc["id"]}"]', 'Tab'); A.wait_for_timeout(500)
    check(wait(A, '() => __ff.store().status === "offline"', 4000), 'A: offline status while editing')
    check('Offline' in A.inner_text('#store-pill'), 'A: pill shows Offline')
    A.click('.sheet-h [data-act="closesheet"]')
    ctxA.set_offline(False)
    J(A, '() => window.dispatchEvent(new Event("online"))')
    check(synced(A, 15000), 'A: queue flushed after reconnect')
    focus(B)
    check(wait(B, '() => __ff.D().accounts.some(a => a.name === "XP Conta Corrente")', 8000), 'B: sees the renamed account')
    # B reload: data comes from the server and the cache
    B.reload(); B.wait_for_function('() => window.__ff && window.__ff.state().booted')
    check(wait(B, '() => __ff.state().mode === "real" && __ff.D().accounts.some(a => a.name === "XP Conta Corrente")', 10000), 'B: after reload, still logged in with the latest data')

    section('export → import backup round trip (netlify mode)')
    A.click('#btn-settings')
    with A.expect_download() as dl:
        A.click('#btn-export')
    path = os.path.join(TMP, 'export.json'); dl.value.save_as(path)
    exp = json.load(open(path, encoding='utf-8'))
    n_before = len(live(A)); ids_before = sorted(t['id'] for t in live(A))
    check(exp.get('version') == 2 and sum(len(v) for v in exp['months'].values()) == n_before, f'export v2 has every live row ({n_before})')
    check(not any(t.get('deleted') for v in exp['months'].values() for t in v), 'export has no tombstones')
    A.keyboard.press('Escape')
    A.click('#btn-settings')
    A.set_input_files('#restore-file', path)
    A.wait_for_selector('#restore-confirm'); A.click('#restore-yes')
    A.wait_for_timeout(1500)
    check(synced(A, 15000), 'A: re-import synced')
    check(sorted(t['id'] for t in live(A)) == ids_before, 'round trip: same transactions')
    check(sorted(t['id'] for t in server_live(user)) == ids_before, 'round trip: server has the same rows')
    focus(B); B.wait_for_timeout(1000)
    check(sorted(t['id'] for t in live(B)) == ids_before, 'B: same rows after the round trip')

    section('logout')
    A.click('#btn-account'); A.click('#btn-logout'); A.wait_for_timeout(400)
    check(A.is_visible('#signed-out') and J(A, '() => __ff.state().mode') == 'example', 'logout → signed-out screen, example data')
    for nm, pg in (('A', A), ('B', B)):
        check(not J(pg, '() => window.__csp'), f'{nm}: no CSP violations overall')
        errs = [e for e in pg._errs if 'fonts.gstatic' not in e and 'ERR_INTERNET_DISCONNECTED' not in e and 'Failed to load resource' not in e]
        check(not errs, f'{nm}: no console errors {errs[:3]}')
    ctxA.close(); ctxB.close()


def scenario_pwa(b, url):
    section('PWA: service worker caches the app; offline reload opens with the cached data, edits queue and flush')
    dump, R = build_real_dump()
    if not dump:
        return
    email = 'pwa' + str(int(time.time())) + '@exemplo.com'
    ctx = new_ctx(b, 'light', w=390, h=844, fake=False, sw='allow')
    C = open_page(ctx, url)
    login(C, email)
    check(wait(C, '() => __ff.state().auth.user', 8000), 'C: logged in')
    C.click('#btn-settings'); C.set_input_files('#restore-file', dump)
    C.wait_for_selector('#restore-confirm'); C.click('#restore-yes')
    check(wait(C, '() => __ff.state().mode === "real" && __ff.live().length === %d' % R['n'], 20000), 'C: data imported')
    C.wait_for_timeout(800); check(synced(C, 15000), 'C: synced')
    check(wait(C, '() => navigator.serviceWorker.ready.then(() => true)', 10000), 'C: service worker installed')
    C.reload(); C.wait_for_function('() => window.__ff && window.__ff.state().booted')
    check(wait(C, '() => !!navigator.serviceWorker.controller', 8000), 'C: page controlled by the service worker')
    check(wait(C, '() => __ff.state().mode === "real" && __ff.live().length === %d' % R['n'], 10000), 'C: data after reload')
    C.wait_for_timeout(1000)
    ctx.set_offline(True)
    C.reload()
    check(wait(C, '() => window.__ff && window.__ff.state().booted', 15000), 'C: app boots offline from the SW cache')
    check(wait(C, '() => __ff.state().mode === "real" && __ff.live().length === %d' % R['n'], 10000), 'C: offline shows the cached data')
    check(wait(C, '() => __ff.store().status === "offline"', 5000), 'C: status offline')
    C.click('#btn-settings'); C.click('#btn-accounts'); C.wait_for_selector('#acc-body')
    first = J(C, '() => __ff.D().accounts[0].id')
    C.fill(f'[data-accname="{first}"]', 'Renomeada offline'); C.press(f'[data-accname="{first}"]', 'Tab'); C.wait_for_timeout(600)
    ctx.set_offline(False)
    J(C, '() => window.dispatchEvent(new Event("online"))')
    check(synced(C, 15000), 'C: offline edit flushed after reconnect')
    srv = json.loads(urllib.request.urlopen(url + '__test/blobs?uid=' + email.split('@')[0]).read())
    check(any(a['name'] == 'Renomeada offline' for a in srv['meta/accounts']['data']['items']), 'server got the offline edit')
    errs = [e for e in C._errs if 'fonts.gstatic' not in e and 'Failed to load resource' not in e and 'ERR_INTERNET_DISCONNECTED' not in e]
    check(not J(C, '() => window.__csp') and not errs, f'C: no CSP violations / console errors {errs[:3]}')
    ctx.close()


def main():
    proc = subprocess.Popen(['node', os.path.join(HERE, 'netlify_harness.mjs'), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url2 = f'http://localhost:{PORT + 1}/'
    proc2 = subprocess.Popen(['node', os.path.join(HERE, 'netlify_harness.mjs'), str(PORT + 1)], env=dict(os.environ, FF_FAKE_IDENTITY='1'), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for u in (URL, f'http://127.0.0.1:{PORT + 1}/'):
            for _ in range(50):
                try:
                    urllib.request.urlopen(u, timeout=1); break
                except Exception:
                    time.sleep(0.1)
        with sync_playwright() as p:
            b = p.chromium.launch()
            try:
                scenario_csp(b)
                scenario_netlify(b)
                scenario_pwa(b, url2.replace('localhost', '127.0.0.1'))
            finally:
                b.close()
    finally:
        proc.terminate(); proc2.terminate()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
