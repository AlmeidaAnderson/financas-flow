"""Corpus run in headless Chromium: the user's REAL statements folder (FF_CORPUS_DIR; skipped when absent) imported
through the Artifact build with the fake window.claude db, exactly as a user would — one batch per institution
("Escolher arquivos" with every file of the institution, "Configurar" once per new layout, "Conta para todos os
arquivos" = the institution's account, "Alterar só este" for the files of another account, "Importar") — and then the
whole folder again in ONE batch (everything must be "Já importado"). The rows per account must equal what the engine
imports in node for the same files (test/corpus/plan.js). Runtime only: prints counts; no screenshots, no file names.

Usage: npm run build:artifact && FF_CORPUS_DIR=<folder> python3 test/e2e/e2e_corpus.py"""
import sys, os, json, re, time, subprocess
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402

DIR = os.environ.get('FF_CORPUS_DIR')
PORT = int(os.environ.get('FF_CORPUS_PORT', '8821'))
URL = f'http://127.0.0.1:{PORT}/'
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
UID = 'u_e2e_corpus'
BASE = f'data/users/{UID}/ff'
STAMP = '2026-10-01T12:00:00.000Z'
PDFJS = {n: open(os.path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', n), 'rb').read() for n in ('pdf.min.js', 'pdf.worker.min.js')}
XLSX = open(os.path.join(ROOT, 'site', 'vendor', 'xlsx.full.min.js'), 'rb').read()
FAILS, PASSES = [], []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    (PASSES if cond else FAILS).append(msg)
    return cond


def J(pg, expr, arg=None):
    return pg.evaluate(expr, arg) if arg is not None else pg.evaluate(expr)


def post(path, body):
    import urllib.request
    req = urllib.request.Request(path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def seed(ns, meta):
    for name, data in meta.items():
        doc = {'v': 2, 'kind': 'meta', 'name': name, 'data': data, 'updatedAt': STAMP, 'writer': 'seed', 'vid': 'seed-' + name, 'parent': None}
        post(f'{URL}__fakedb/set?ns={ns}', {'path': f'{BASE}/v2meta/{name}', 'data': doc})


def cdn(route):
    url = route.request.url
    name = url.rsplit('/', 1)[-1]
    if 'xlsx' in url:
        route.fulfill(status=200, body=XLSX, content_type='application/javascript', headers={'access-control-allow-origin': '*'})
    elif name in PDFJS:
        route.fulfill(status=200, body=PDFJS[name], content_type='application/javascript', headers={'access-control-allow-origin': '*'})
    else:
        route.fulfill(status=404, body='')


def open_artifact(b, ns):
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)/.*'), cdn)
    cfg = {'ns': ns, 'uid': UID}
    ctx.add_init_script(FAKE_JS + '\n;(function(c){ window.__saved = [];'
                        ' var f = FakeClaude.createFakeClaude({ backend: FakeClaude.createHttpBackend("/__fakedb", c.ns, 150), userId: c.uid, delayMs: 20, saved: window.__saved });'
                        ' window.claude = Object.freeze({ use: f.claude.use });'
                        '})(' + json.dumps(cfg) + ');')
    pg = ctx.new_page()
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))
    pg.goto(URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000)
    pg.wait_for_timeout(300)
    return ctx, pg


def to_import(pg):
    J(pg, '() => { __ff.state().imp = null; }')
    pg.click('.tab[data-tab="painel"]'); pg.wait_for_timeout(150)
    pg.click('.tab[data-tab="import"]'); pg.wait_for_timeout(250)


def load_batch(pg, files):
    pg.set_input_files('#imp-file', files)
    pg.wait_for_selector('#bf-list .bf', timeout=60000)
    pg.wait_for_function('() => !document.querySelector("#bf-busy")', timeout=180000)
    pg.wait_for_timeout(300)


def items(pg):
    return J(pg, '() => __ff.state().imp.batch.items.map(it => ({ key: it.key, name: it.name, err: it.err || null, ready: !!(it.profile && (it.matched || it.configured)), fp: it.analysis && it.analysis.fingerprint, kind: it.kind || null, fresh: it.preview ? it.preview.fresh : null, dup: it.preview ? (it.preview.dup != null ? it.preview.dup : null) : null }))')


def configure_new_layouts(pg, tag):
    n = 0
    for _ in range(20):
        todo = [it for it in items(pg) if not it['ready'] and not it['err']]
        if not todo:
            break
        k = todo[0]['key']
        pg.click(f'.bf[data-key="{k}"] [data-act="bf-config"]')
        pg.wait_for_selector('[data-act="imp-step"][data-s="3"]', timeout=15000)
        pg.click('[data-act="imp-step"][data-s="3"]')
        pg.wait_for_selector('#imp-layout', timeout=15000)
        pg.fill('#imp-layout', f'Layout {tag} {n + 1}')
        pg.click('#imp-batch-save'); pg.wait_for_selector('#bf-list', timeout=15000)
        n += 1
    return n


def single(pg, f, acc, tag):
    """one file of an institution: the 4-step wizard (Arquivo → Detecção → Conferência → Salvar)"""
    pg.select_option('#imp-acc', acc)
    pg.set_input_files('#imp-file', f)
    pg.wait_for_selector('[data-act="imp-step"][data-s="3"], #scr-import .banner.err', timeout=60000)
    if not check(not pg.locator('#scr-import .banner.err').count(), f'{tag}: file read'):
        return 0
    pg.click('[data-act="imp-step"][data-s="3"]'); pg.wait_for_selector('[data-act="imp-step"][data-s="4"]', timeout=15000)
    pg.click('[data-act="imp-step"][data-s="4"]'); pg.wait_for_selector('#imp-layout', timeout=15000)
    if not pg.input_value('#imp-layout'):
        pg.fill('#imp-layout', f'Layout {tag}')
    pg.click('[data-act="imp-commit"]'); pg.wait_for_selector('#imp-done', timeout=60000)
    return J(pg, '() => __ff.state().imp.done.imported')


def set_accounts(pg, plan, shared):
    pg.select_option('#bf-shared', shared); pg.wait_for_timeout(200)
    over = 0
    for it in items(pg):
        want = plan['accountOf'].get(it['name'])
        cur = J(pg, '(k) => { const it = __ff.state().imp.batch.items.find(x => x.key === k); return it.ov ? it.ov.id : __ff.state().imp.batch.shared; }', it['key'])
        if want and cur != want:
            if not pg.locator(f'[data-bfacc="{it["key"]}"]').count():
                pg.click(f'#bf-own-{it["key"]}'); pg.wait_for_timeout(100)
            pg.select_option(f'[data-bfacc="{it["key"]}"]', want); pg.wait_for_timeout(120)
            over += 1
    return over


def main():
    if not DIR or not os.path.isdir(DIR):
        print('skip (no corpus at FF_CORPUS_DIR)')
        return
    plan = json.loads(subprocess.run(['node', os.path.join(ROOT, 'test', 'corpus', 'plan.js'), DIR], capture_output=True, text=True, check=True).stdout)
    accs = plan['accounts']
    alabel = {a['id']: f'A{i + 1}' for i, a in enumerate(accs)}
    srv = artifact_server.start(PORT)
    ns = 'corpus' + str(int(time.time()))
    seed(ns, {'accounts': {'items': accs}, 'settings': {'budgets': {}, 'schemaVersion': 3, 'fxRates': plan['fxRates'], 'updatedAt': STAMP}})
    groups = {}
    for f in plan['files']:
        g = os.path.relpath(f, DIR).split(os.sep)[0]
        groups.setdefault(g, []).append(f)
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            ctx, pg = open_artifact(b, ns)
            print('\n== batches, one per institution')
            for gi, (g, files) in enumerate(groups.items()):
                tag = f'I{gi + 1}'
                to_import(pg)
                if len(files) == 1 and not files[0].lower().endswith('.zip'):
                    n = single(pg, files[0], plan['accountOf'][os.path.basename(files[0])], tag)
                    print(f'  {tag}: 1 file (wizard), {n} rows')
                    continue
                load_batch(pg, files)
                its = items(pg)
                check(not [it for it in its if it['err']], f'{tag}: {len(its)} files read, none failed')
                n = configure_new_layouts(pg, tag)
                # the institution's account (bank / benefit) is the shared one; cards and other currencies per file
                mains = [plan['accountOf'][it['name']] for it in its if it['kind'] != 'fatura' and it['name'] in plan['accountOf']]
                shared = max(set(mains), key=mains.count) if mains else plan['accountOf'][its[0]['name']]
                over = set_accounts(pg, plan, shared)
                pg.wait_for_timeout(300)
                ready = J(pg, '() => __ff.state().imp.batch.items.filter(it => !it.err && it.profile && (it.matched || it.configured) && it.preview && it.preview.fresh > 0).length')
                print(f'  {tag}: {len(its)} files, {n} new layouts configured, {over} with their own account, {ready} with new rows')
                if ready:
                    pg.click('#bf-import'); pg.wait_for_selector('#batch-done', timeout=120000)
                    errs = J(pg, '() => [...document.querySelectorAll("#batch-done .bf-sum")].map(e => e.textContent).filter(t => /[1-9]\\d* com erro/.test(t)).length')
                    check(errs == 0, f'{tag}: no file with row errors')
            J(pg, '() => __ff.flush()')
            pg.wait_for_timeout(1500)
            live = J(pg, '() => __ff.live().map(t => ({ a: t.accountId, k: t.kind }))')
            per = {}
            for t in live:
                per[t['a']] = per.get(t['a'], 0) + 1
            print('  rows per account: ' + json.dumps({alabel.get(k, '?'): v for k, v in per.items()}))
            check(len(live) == plan['expect']['total'], f'all batches: {len(live)} rows = engine in node {plan["expect"]["total"]}')
            check(per == plan['expect']['perAcc'], 'rows per account = engine in node')
            recs = J(pg, '() => Object.values(__ff.D().imports)')
            check(all(r.get('count', 0) > 0 for r in recs), f'{len(recs)} import records, none without rows')
            print('\n== the whole folder again, in ONE batch')
            to_import(pg)
            load_batch(pg, plan['files'])
            its = items(pg)
            nr = [it for it in its if not it['ready'] and not it['err']]
            for it in nr + [it for it in its if it['fresh']]:
                print(f'    · {alabel.get(plan["accountOf"].get(it["name"]), "?")} kind={it["kind"]} ready={it["ready"]} fresh={it["fresh"]} fp={str(it["fp"])[:12]}')
            check(not nr, f'{len(its)} files: every layout recognized from the first import')
            # no shared account touched: each file goes where its layout / kind / currency says
            wrong = J(pg, '(m) => __ff.state().imp.batch.items.filter(it => !it.empty && m[it.name] && (it.ov ? it.ov.id : __ff.state().imp.batch.shared) !== m[it.name]).length', plan['accountOf'])
            check(wrong == 0, f'every file suggested into its own account ({wrong} elsewhere)')
            ready = J(pg, '() => { const B = __ff.state().imp.batch; return B.items.filter(it => it.preview && it.preview.fresh > 0).length; }')
            check(ready == 0, f'nothing new to import ({ready} files with new rows)')
            check(not pg.locator('#bf-import').count() or not pg.is_enabled('#bf-import') or 'Importar' not in (pg.inner_text('#bf-import') or ''), '"Importar" offers nothing')
            # reload: what was saved comes back the same
            pg.reload(); pg.wait_for_function('() => window.__ff && window.__ff.state().booted && __ff.state().mode === "real"', timeout=20000); pg.wait_for_timeout(800)
            check(J(pg, '() => __ff.live().length') == plan['expect']['total'], 'after reload: the same rows (saved in the db)')
            health = J(pg, '() => FinEngine.dataHealth({ transactions: __ff.live(), accounts: __ff.D().accounts, imports: __ff.D().imports, settings: __ff.D().settings, today: "2026-10-06" }).map(w => w.severity + " · " + w.id.split(":")[0])')
            hc = {}
            for w in health:
                hc[w] = hc.get(w, 0) + 1
            print('  data health by check: ' + json.dumps(hc))
            check(not [e for e in pg._errs if 'fonts' not in e], f'no console errors ({pg._errs[:2]})')
            ctx.close()
        finally:
            b.close()
            srv.shutdown()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
