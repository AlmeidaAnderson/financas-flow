"""End-to-end tests of the claude.ai Artifact build (dist-artifact/financas-flow.html) in headless Chromium.

Usage: npm run build:artifact && python3 test/e2e/e2e_artifact.py
  - test/e2e/artifact_server.py serves the built file wrapped in a minimal skeleton (doctype/head/body), like the
    platform, plus a shared fake db backend
  - test/fake-claude.js is injected as window.claude before any page script (claude.use resolves after ~300 ms);
    several browser contexts on one namespace = several devices of one claude.ai account
  - SheetJS's CDN URL is answered with the vendored copy (same file), Google Fonts with empty CSS
  - also runs once WITHOUT window.claude and once with claude.use → null: local fallback ("Só neste aparelho")
All data is synthetic (test/fixtures). Screenshots: screens/artifact/*.png (390px, light + dark)."""
import sys, os, json, re, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402

PORT = int(os.environ.get('FF_ARTIFACT_PORT', '8788'))
URL = f'http://127.0.0.1:{PORT}/'
FX = os.path.join(ROOT, 'test', 'fixtures')
SCR = os.path.join(ROOT, 'screens', 'artifact')
DIST = os.path.join(ROOT, 'dist-artifact', 'financas-flow.html')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
XLSX_JS = open(os.path.join(ROOT, 'site', 'vendor', 'xlsx.full.min.js'), encoding='utf-8').read()
UID = 'u_e2e_artifact'
NS = 'art' + str(int(time.time()))
BASE = f'data/users/{UID}/ff'
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
ALL_PAGES = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    (PASSES if cond else FAILS).append(msg)
    return cond


def section(t):
    print('\n== ' + t, flush=True)


def J(pg, expr, arg=None):
    return pg.evaluate(expr, arg) if arg is not None else pg.evaluate(expr)


def new_page(b, scheme='light', fake=True, caps=None, ns=NS, w=390, h=844):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2, accept_downloads=True)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/npm/xlsx@0\.18\.5/dist/xlsx\.full\.min\.js'), lambda r: r.fulfill(status=200, body=XLSX_JS, content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    if fake:
        cfg = {'ns': ns, 'uid': UID, 'caps': caps or {}}
        ctx.add_init_script(FAKE_JS + '\n;(function(c){ window.__saved = []; window.__useCalls = 0;'
                            ' var f = FakeClaude.createFakeClaude({ backend: FakeClaude.createHttpBackend("/__fakedb", c.ns, 150), userId: c.uid, delayMs: 300, saved: window.__saved, caps: c.caps });'
                            ' var use = f.claude.use; window.claude = Object.freeze({ use: function (n) { window.__useCalls++; return use(n); } });'
                            '})(' + json.dumps(cfg) + ');')
    pg = ctx.new_page()
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))
    t0 = time.time()
    pg.goto(URL)
    pg._first_paint = J(pg, '() => !!document.querySelector("#scr-painel")')
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=20000)
    pg._boot_s = time.time() - t0
    pg.wait_for_timeout(300)
    ALL_PAGES.append(pg)
    return ctx, pg


def shot(pg, name, full=False):
    pg.wait_for_timeout(250)
    pg.screenshot(path=os.path.join(SCR, name + '.png'), full_page=full)


def no_hscroll(pg, label):
    r = J(pg, '() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    check(r[0] <= r[1], f'{label}: no horizontal scroll ({r[0]} <= {r[1]})')


def goto_tab(pg, tab):
    pg.click(f'.tab[data-tab="{tab}"]')
    pg.wait_for_timeout(150)


def kpi(pg, which):
    return int(pg.get_attribute(f'#kpi-{which}', 'data-cents'))


def set_month(pg, ym):
    J(pg, '(ym) => { __ff.state().ui.month = ym; }', ym)
    goto_tab(pg, 'painel')


def wait_until(pg, js, timeout=8000):
    try:
        pg.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


def import_file(pg, path, acc=None, new_acc=None, layout=''):
    J(pg, '() => { __ff.state().imp = null; }')
    goto_tab(pg, 'painel')
    goto_tab(pg, 'import')
    if pg.is_visible('[data-act="imp-tab"][data-t="arquivo"]'):
        pg.click('[data-act="imp-tab"][data-t="arquivo"]')
    if new_acc:
        pg.select_option('#imp-acc', '__new')
        pg.fill('#imp-acc-name', new_acc[0])
        pg.select_option('#imp-acc-type', new_acc[1])
    elif acc:
        pg.select_option('#imp-acc', acc)
    pg.set_input_files('#imp-file', path)
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"], [data-act="imp-step"][data-s="3"]', timeout=20000)
    if pg.is_visible('[data-act="imp-step"][data-s="3"]') and not pg.is_visible('[data-act="imp-step"][data-s="4"]'):
        pg.click('[data-act="imp-step"][data-s="3"]')
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
    info = J(pg, '() => ({ fresh: __ff.state().imp.dedup.fresh.length, dup: __ff.state().imp.dedup.duplicates.length })')
    if pg.is_disabled('[data-act="imp-step"][data-s="4"]'):
        return info
    pg.click('[data-act="imp-step"][data-s="4"]')
    if layout:
        pg.fill('#imp-layout', layout)
    pg.click('[data-act="imp-commit"]')
    pg.wait_for_selector('#imp-done')
    return info


def find(pg, pred_js):
    return J(pg, '() => __ff.live().filter(' + pred_js + ')')


def db_rows(ns=NS):
    """live rows stored in the fake db (all month docs and parts)"""
    rows = {}
    for p, d in artifact_server.docs(ns).items():
        if p.startswith(BASE + '/v2months/'):
            for t in d['data']['transactions']:
                if t['id'] not in rows or (t.get('updatedAt') or '') >= (rows[t['id']].get('updatedAt') or ''):
                    rows[t['id']] = t
    return {k: v for k, v in rows.items() if not v.get('deleted')}


def flushed(pg):
    """the app debounce + the store's write queue are both idle"""
    J(pg, '() => __ff.flush()')
    return wait_until(pg, '() => { const s = __ff.store()._debug ? __ff.store()._debug() : null; return !s || (!s.flushing && !s.dirty.size); }', 10000)


def main():
    if not os.path.exists(DIST):
        print('build first: npm run build:artifact'); sys.exit(2)
    artifact_server.start(PORT)
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            A = scenario_main(b)
            scenario_two_devices(b, A)
            scenario_local_fallback(b)
        finally:
            b.close()
    errs = [e for pg in ALL_PAGES for e in pg._errs]
    check(not errs, f'zero console errors across all pages {errs[:5]}')
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


# ------------------------------------------------------------------------------------------------ main flow
def scenario_main(b):
    section('artifact page: contract, first paint before claude.use resolves, example data')
    html = open(DIST, encoding='utf-8').read()
    check(html.startswith('<title>Finanças Flow</title>\n<style>'), 'file starts with <title> then <style>')
    check(not re.search(r'<!doctype|<html[\s>]|<head[\s>]|<body[\s>]', html, re.I), 'no doctype/html/head/body tags')
    tags = ''.join(re.findall(r'<(?:link|meta|script)\b[^>]*>', re.sub(r'<script>[\s\S]*?</script>', '', html)))
    check(not re.search(r'manifest|theme-color|netlify|/api|/\.netlify|sw\.js', tags), f'no manifest / theme-color / Identity / /api / sw tags ({len(tags)} chars of tags)')
    check(len(html.encode()) < 16 * 1024 * 1024, f'size {len(html.encode())//1024} KB < 16 MB')
    for scheme in ('light', 'dark'):
        ctx, pg = new_page(b, scheme)
        check(pg._first_paint, f'{scheme}: markup painted before the runtime answered')
        check(J(pg, '() => __ff.store().mode') == 'artifact', f'{scheme}: store mode artifact')
        check(J(pg, '() => __ff.state().auth.user') == {'id': UID, 'email': None}, f'{scheme}: user = claude.ai account id, email null')
        check(J(pg, '() => window.__useCalls') >= 3, f'{scheme}: claude.use called for db/user/downloads')
        check(J(pg, '() => __ff.state().mode') == 'example', f'{scheme}: example data on first run')
        pill = pg.inner_text('#store-pill')
        check('Exemplo' in pill and 'Sincronizado' in pill, f'{scheme}: pill "{pill}"')
        check(not pg.is_visible('#signed-out'), f'{scheme}: no login screen (claude.ai account is the auth)')
        check(J(pg, '() => document.title') == 'Finanças Flow', f'{scheme}: title')
        check(J(pg, '() => getComputedStyle(document.body).backgroundColor') != 'rgba(0, 0, 0, 0)', f'{scheme}: explicit body background')
        no_hscroll(pg, f'{scheme} painel')
        shot(pg, f'painel-example-{scheme}')
        ctx.close()

    ctx, pg = new_page(b, 'light')
    sw = J(pg, '() => navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0')
    check(sw == 0, 'no service worker registered')
    for t in ('painel', 'tx', 'import', 'cats'):
        goto_tab(pg, t)
        no_hscroll(pg, f'390px {t} (example)')
    pg.click('#btn-account')
    check('conta do claude.ai' in pg.inner_text('.sheet') and not pg.is_visible('#btn-logout'), 'account sheet: claude.ai account, no "Sair"')
    pg.click('.sheet-h [data-act="closesheet"]')

    section('import fixtures (CSV + XLSX via the SheetJS CDN tag) → real mode, saved in the private db subtree')
    import_file(pg, os.path.join(FX, 'xp_fatura_ago.csv'), new_acc=('XP cartão', 'credit_card'), layout='Fatura XP')
    check(J(pg, '() => __ff.state().mode') == 'real', 'real mode after the first import')
    card = J(pg, '() => __ff.D().accounts.find(a => a.name === "XP cartão").id')
    import_file(pg, os.path.join(FX, 'xp_fatura_set.csv'), acc=card)
    import_file(pg, os.path.join(FX, 'xp_extrato_hora.csv'), new_acc=('XP conta', 'checking'))
    import_file(pg, os.path.join(FX, 'nubank_cartao.csv'), new_acc=('Nubank', 'credit_card'))
    import_file(pg, os.path.join(FX, 'itau_extrato.csv'), new_acc=('Itaú', 'checking'))
    n_before_xlsx = len(J(pg, '() => __ff.live()'))
    import_file(pg, os.path.join(FX, 'extrato_br.xlsx'), new_acc=('Banco planilha', 'checking'))
    check(J(pg, '() => !!window.XLSX'), 'SheetJS loaded from its CDN <script async>')
    check(len(J(pg, '() => __ff.live()')) > n_before_xlsx, 'XLSX extrato imported')
    flushed(pg)
    stored = db_rows()
    live = J(pg, '() => __ff.live()')
    check(len(stored) == len(live) and len(live) > 20, f'every transaction is in the fake db ({len(stored)} / {len(live)})')
    docs = artifact_server.docs(NS)
    check(all(k.startswith(f'data/users/{UID}/ff/') for k in docs), 'all docs under data/users/<id>/ff/')
    check(f'{BASE}/v2meta/accounts' in docs and docs[f'{BASE}/v2meta/accounts']['data']['kind'] == 'meta', 'meta doc shape {kind:"meta", data}')
    m = docs.get(f'{BASE}/v2months/2026-09', {}).get('data', {})
    check(m.get('kind') == 'month' and m.get('ym') == '2026-09' and isinstance(m.get('transactions'), list), 'month doc shape {kind:"month", ym, transactions}')
    check(J(pg, '() => { try { return localStorage.getItem("ff2:local"); } catch (e) { return null; } }') is None, 'nothing written to localStorage (artifact mode)')
    shot(pg, 'painel-real-light')

    section('triage: Lembrar → rule; Desfazer; Painel/badge update')
    goto_tab(pg, 'painel')
    unc0 = J(pg, '() => __ff.live().filter(t => !t.categoryId && t.kind !== "transfer" && t.kind !== "card_payment").length')
    check(unc0 >= 3, f'triage backlog ({unc0})')
    pg.click('#triage-banner [data-act="triage"]')
    pg.wait_for_selector('#tri-card')
    # v2.1: an unticked "Lembrar" on a parcela creates a per-purchase rule — the rule checks below use a non-parcela card
    # (skipped parcelas are classified in a second pass at the end); ambiguous merchants start unticked
    skipped = 0
    for _ in range(40):
        c = J(pg, '() => { const id = document.querySelector("#tri-card").dataset.id; const t = __ff.live().find(t => t.id === id); return { inst: !!t.installment, amb: !!FinEngine.ambiguousMatch(t, {}) }; }')
        if not c['inst']:
            break
        pg.click('[data-act="tri-skip"]')
        skipped += 1
    check(pg.is_checked('#tri-remember') == (not c['amb']), '"Lembrar esta categoria" ticked by default (unticked for an ambiguous merchant)')
    pg.check('#tri-remember')
    shot(pg, 'triage-light')

    def current():
        return J(pg, '() => { const id = document.querySelector("#tri-card").dataset.id; return __ff.live().find(t => t.id === id); }')
    t0 = current()
    m0 = t0['merchant']
    same0 = len(find(pg, f't => t.merchant === {json.dumps(m0)} && !t.categoryId'))
    rules0 = len(J(pg, '() => __ff.D().rules'))
    g = pg.get_attribute('.tri-grid [data-act="tri-group"]', 'data-g')
    pg.click(f'.tri-grid [data-act="tri-group"][data-g="{g}"]')
    pg.click('.tri-grid [data-act="tri-pick"]')
    pg.wait_for_selector('#tri-undo')
    rules1 = J(pg, '() => __ff.D().rules')
    check(len(rules1) == rules0 + 1 and rules1[-1]['match']['value'] == m0, f'Lembrar → learned rule for {m0}')
    flushed(pg)
    rdoc = artifact_server.docs(NS).get(f'{BASE}/v2meta/rules', {}).get('data', {}).get('data', {})
    check(len(rdoc.get('rules', [])) == rules0 + 1, 'rule saved in the db')
    check('Desfazer' in pg.inner_text('#tri-undo'), 'undo button')
    pg.click('#tri-undo')
    pg.wait_for_timeout(200)
    check(len(J(pg, '() => __ff.D().rules')) == rules0, 'Desfazer removed the rule')
    check(len(find(pg, f't => t.merchant === {json.dumps(m0)} && !t.categoryId')) == same0, 'Desfazer restored the transactions')
    flushed(pg)
    rdoc = artifact_server.docs(NS).get(f'{BASE}/v2meta/rules', {}).get('data', {}).get('data', {})
    check(len(rdoc.get('rules', [])) == rules0, 'undo reached the db')
    guard = 0
    while pg.is_visible('#tri-card') and guard < 120:
        guard += 1
        if pg.is_visible('#tri-sugs .sug-btn'):
            pg.click('#tri-sugs .sug-btn')
        else:
            pg.click('.tri-grid [data-act="tri-group"]')
            pg.click('.tri-grid [data-act="tri-pick"]')
    if skipped and J(pg, '() => __ff.live().filter(t => !t.categoryId && t.kind !== "transfer" && t.kind !== "card_payment").length'):
        # second pass for the parcelas skipped at the start
        pg.click('#tri-finish'); pg.wait_for_timeout(200)
        pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-card')
        while pg.is_visible('#tri-card') and guard < 400:
            guard += 1
            if pg.is_visible('#tri-sugs .sug-btn'):
                pg.click('#tri-sugs .sug-btn')
            else:
                pg.click('.tri-grid [data-act="tri-group"]')
                pg.click('.tri-grid [data-act="tri-pick"]')
    check(pg.is_visible('#tri-done'), f'triage queue finished ({guard} picks)')
    pg.click('#tri-finish')
    pg.wait_for_timeout(200)
    check(not pg.is_visible('#triage-banner') and pg.is_hidden('#tab-badge'), 'banner + badge gone without reload')

    section('Painel updates right after a category change')
    set_month(pg, '2026-09')
    inc_before, exp_before = kpi(pg, 'income'), kpi(pg, 'expense')
    node = J(pg, '() => [...document.querySelectorAll(".sk-node[data-id^=\'grp:\']")].map(e => e.dataset.id).find(id => __ff.live().some(t => t.kind === "expense" && t.date.startsWith("2026-09") && String(t.categoryId || "").split(".")[0] === id.slice(4)))')
    check(bool(node), f'Painel has an expense group node ({node})')
    pg.click(f'.sk-node[data-id="{node}"]')
    pg.wait_for_selector('.sheet .tx')
    tx_id = J(pg, '() => [...document.querySelectorAll(".sheet .tx")].map(e => e.dataset.id).find(id => (__ff.live().find(t => t.id === id) || {}).kind === "expense")')
    pg.click(f'.sheet .tx[data-id="{tx_id}"]')
    amt = J(pg, f'() => __ff.live().find(t => t.id === {json.dumps(tx_id)}).amount')
    pg.wait_for_selector('#ed-cat')
    pg.select_option('#ed-cat', 'renda.outros')
    pg.uncheck('#ed-remember')
    pg.click('[data-act="savetx"]')
    pg.wait_for_timeout(200)
    check(kpi(pg, 'income') == inc_before + amt and kpi(pg, 'expense') == exp_before + amt, f'KPIs updated in place (amount {amt})')
    # v2.6: Salvar returns to the Sankey sheet (the editor was stacked on it) — close it
    check(J(pg, '() => (__ff.state().sheet || {}).kind') == 'node', 'Salvar returns to the Sankey sheet (v2.6)')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    flushed(pg)
    check((db_rows().get(tx_id) or {}).get('categoryId') == 'renda.outros', 'category change saved in the db')

    section('Filtros sheet, count badge, Limpar')
    goto_tab(pg, 'tx')
    pg.click('#btn-filters')
    pg.wait_for_selector('#f-apply')
    pg.click('#f-from')
    pg.keyboard.type('01092026')
    check(pg.input_value('#f-from') == '01/09/2026', 'date mask dd/mm/aaaa')
    pg.fill('#f-to', '30/09/2026')
    pg.check('[data-fchk="types"][value="expense"]')
    shot(pg, 'filters-light')
    pg.click('#f-apply')
    pg.wait_for_timeout(250)
    check(pg.inner_text('#filters-count') == '2', f'active-filter badge = 2 ({pg.inner_text("#filters-count")})')
    lst = J(pg, '() => [...document.querySelectorAll("#tx-list .tx")].map(e => __ff.live().find(t => t.id === e.dataset.id))')
    check(lst and all('2026-09-01' <= t['date'] <= '2026-09-30' and t['kind'] == 'expense' for t in lst), f'filters applied ({len(lst)} rows)')
    no_hscroll(pg, 'filtered list')
    shot(pg, 'transacoes-filtered-light')
    pg.click('#btn-filters-clear')
    check(not pg.is_visible('#filters-count'), 'Limpar removes the filters')

    section('holerite with adiantamento')
    goto_tab(pg, 'import')
    pg.click('[data-act="imp-tab"][data-t="holerite"]')
    pg.fill('#hol-date', '')
    pg.click('#hol-date')
    pg.keyboard.type('05102026')
    pg.fill('#hol-emp', 'Acme')
    pg.fill('#hol-gross', '10.000,00'); pg.fill('#hol-inss', '951,59'); pg.fill('#hol-irrf', '2.142,31')
    pg.check('#hol-adv')
    pg.wait_for_selector('#hol-split-adv')
    check(pg.inner_text('#hol-split-adv') == 'R$ 4.000,00' and pg.inner_text('#hol-split-final') == 'R$ 2.906,10', 'live split: adiantamento 40% / final deposit')
    no_hscroll(pg, 'holerite')
    shot(pg, 'holerite-light', full=True)
    pg.click('[data-act="hol-save"]')
    pg.wait_for_selector('#hol-done')
    hs = find(pg, 't => t.payslip')
    adv = [t for t in hs if t.get('payslipRole') == 'advance']
    check(adv and adv[0]['date'] == '2026-09-20' and adv[0]['amount'] == 400000, 'advance income on 20/09')
    check(sum(t['amount'] for t in hs) == 1000000 - 95159 - 214231, 'net cash of the holerite = líquido')
    flushed(pg)
    check(all(t['id'] in db_rows() for t in hs), 'holerite rows saved in the db')

    section('Importações: move and delete')
    pg.click('#btn-settings'); pg.click('#btn-accounts')
    pg.wait_for_selector('#imp-list')
    imps = J(pg, '() => __ff.D().imports')
    nub = next(k for k, v in imps.items() if (J(pg, '(id) => (__ff.D().accounts.find(a => a.id === id) || {}).name', v.get('accountId')) == 'Nubank'))
    xls = next(k for k, v in imps.items() if (J(pg, '(id) => (__ff.D().accounts.find(a => a.id === id) || {}).name', v.get('accountId')) == 'Banco planilha'))
    shot(pg, 'accounts-sheet-light')
    pg.click(f'.imp-row[data-imp="{nub}"] [data-act="imp-move"]')
    pg.wait_for_selector('#move-box')
    pg.select_option('#mv-acc', '__new')
    pg.fill('#mv-name', 'Nubank roxinho')
    pg.select_option('#mv-type', 'credit_card')
    pg.click('#mv-confirm')
    pg.wait_for_timeout(300)
    newacc = J(pg, '() => __ff.D().accounts.find(a => a.name === "Nubank roxinho")')
    moved = find(pg, 't => t.importId === "%s"' % nub)
    check(newacc and moved and all(t['accountId'] == newacc['id'] for t in moved), f'import moved ({len(moved)} rows)')
    pg.click(f'.imp-row[data-imp="{xls}"] [data-act="imp-del"]')
    pg.wait_for_selector('#del-box')
    pg.click('#del-confirm')
    pg.wait_for_timeout(300)
    check(len(find(pg, 't => t.importId === "%s"' % xls)) == 0, 'import deleted')
    pg.click('.sheet-h [data-act="closesheet"]')
    flushed(pg)
    stored = db_rows()
    check(not any(t.get('importId') == xls for t in stored.values()), 'deleted import gone from the db (tombstones)')
    check(all(stored[t['id']]['accountId'] == newacc['id'] for t in moved), 'move saved in the db')
    check(len(stored) == len(J(pg, '() => __ff.live()')), 'db and app agree on the live rows')

    section('export backup → downloads.save (no <a download>)')
    pg.click('#btn-settings')
    pg.click('#btn-export')
    ok = wait_until(pg, '() => window.__saved.length === 1', 8000)
    check(ok, 'downloads.save received the backup')
    if ok:
        f = J(pg, '() => window.__saved[0]')
        bk = json.loads(f['data'])
        n_bk = sum(len(v) for v in bk['months'].values())
        check(re.match(r'financas-flow-backup-\d{4}-\d{2}-\d{2}\.json$', f['filename']) and bk['version'] == 2 and n_bk == len(J(pg, '() => __ff.live()')), f'{f["filename"]}: v2 backup with {n_bk} transactions')
    check('Backup exportado' in (pg.inner_text('#toast') if pg.is_visible('#toast') else 'Backup exportado'), 'toast: Backup exportado')
    pg.click('.sheet-h [data-act="closesheet"]') if pg.is_visible('.sheet-h [data-act="closesheet"]') else None

    section('reload: data comes back from the db')
    n = len(J(pg, '() => __ff.live()'))
    pg.reload()
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=20000)
    check(J(pg, '() => __ff.state().mode') == 'real' and len(J(pg, '() => __ff.live()')) == n, f'reload: {n} transactions back from the db')
    for scheme in ('light', 'dark'):
        pg.emulate_media(color_scheme=scheme)
        set_month(pg, '2026-09')
        shot(pg, f'painel-real-{scheme}')
        goto_tab(pg, 'tx'); shot(pg, f'transacoes-{scheme}')
        goto_tab(pg, 'import'); shot(pg, f'importar-{scheme}')
        goto_tab(pg, 'cats'); shot(pg, f'categorias-{scheme}')
        for t in ('painel', 'tx', 'import', 'cats'):
            goto_tab(pg, t)
            no_hscroll(pg, f'{scheme} 390px {t} (real data)')
    pg.emulate_media(color_scheme='light')
    goto_tab(pg, 'painel')
    return pg


# ------------------------------------------------------------------------------------------------ two devices
def scenario_two_devices(b, A):
    section('two pages sharing one fake db (same claude.ai account): live sync both ways')
    ctxB, B = new_page(b, 'dark')
    nA = len(J(A, '() => __ff.live()'))
    check(J(B, '() => __ff.state().mode') == 'real' and len(J(B, '() => __ff.live()')) == nA, f'B opens with the same {nA} transactions')
    # A categorizes something on the PC → B sees it live
    goto_tab(A, 'tx')
    tid = A.get_attribute('#tx-list .tx', 'data-id')
    A.click(f'#tx-list .tx[data-id="{tid}"]')
    A.select_option('#ed-cat', 'compras.casa')
    A.uncheck('#ed-remember')
    A.click('[data-act="savetx"]')
    ok = wait_until(B, '() => (__ff.live().find(t => t.id === %s) || {}).categoryId === "compras.casa"' % json.dumps(tid), 10000)
    check(ok, 'A → B: category change arrives live (onSnapshot → subscribe)')
    goto_tab(B, 'tx')
    shot(B, 'sync-phone-dark')
    # B deletes an import → A drops those rows live
    imps = J(B, '() => Object.keys(__ff.D().imports)')
    victim = imps[0]
    nv = len(find(B, 't => t.importId === "%s"' % victim))
    B.click('#btn-settings'); B.click('#btn-accounts')
    B.wait_for_selector('#imp-list')
    B.click(f'.imp-row[data-imp="{victim}"] [data-act="imp-del"]')
    B.wait_for_selector('#del-box')
    B.click('#del-confirm')
    B.click('.sheet-h [data-act="closesheet"]')
    ok = wait_until(A, '() => !__ff.live().some(t => t.importId === %s)' % json.dumps(victim), 10000)
    check(ok and nv > 0, f'B → A: deleting an import ({nv} rows) reaches A (tombstones)')
    check(J(A, '() => __ff.live().every(t => !t.deleted)'), 'A never shows tombstones')
    check(not J(A, '() => Object.keys(__ff.D().imports).includes(%s)' % json.dumps(victim)), 'A: imports meta updated too')
    # concurrent edits of the same month on both pages converge
    ids = J(A, '() => __ff.live().filter(t => t.date.startsWith("2026-09")).slice(0, 2).map(t => t.id)')
    goto_tab(A, 'tx'); goto_tab(B, 'tx')
    for pg, i, note in ((A, ids[0], 'nota do PC'), (B, ids[1], 'nota do celular')):
        pg.fill('#tx-search', '')
        pg.wait_for_timeout(200)
        pg.click(f'#tx-list .tx[data-id="{i}"]') if pg.is_visible(f'#tx-list .tx[data-id="{i}"]') else J(pg, '() => 0')
    if A.is_visible('#ed-note') and B.is_visible('#ed-note'):
        A.fill('#ed-note', 'nota do PC'); B.fill('#ed-note', 'nota do celular')
        A.click('[data-act="savetx"]'); B.click('[data-act="savetx"]')
        ok = wait_until(A, '() => (__ff.live().find(t => t.id === %s) || {}).note === "nota do celular"' % json.dumps(ids[1]), 10000) and \
            wait_until(B, '() => (__ff.live().find(t => t.id === %s) || {}).note === "nota do PC"' % json.dumps(ids[0]), 10000)
        check(ok, 'simultaneous edits of the same month on A and B: both survive on both')
        flushed(A); flushed(B)
        st = db_rows()
        check(st[ids[0]].get('note') == 'nota do PC' and st[ids[1]].get('note') == 'nota do celular', 'db holds both edits')
    else:
        check(False, 'could not open both editors for the concurrent-edit check')
    check(len(J(A, '() => __ff.live()')) == len(J(B, '() => __ff.live()')), 'A and B agree on the transaction count')
    check(J(B, '() => window.__useCalls') >= 3 and J(A, '() => __ff.store().status') == 'synced', 'status Sincronizado after sync')
    ctxB.close()


# ------------------------------------------------------------------------------------------------ local fallback
def scenario_local_fallback(b):
    for label, kw in (('window.claude absent', {'fake': False}), ('claude.use → null', {'fake': True, 'caps': {'db': False, 'user': False, 'downloads': False}})):
        section(f'local fallback: {label}')
        ctx, pg = new_page(b, 'light', **kw)
        check(J(pg, '() => __ff.store().mode') == 'local', f'{label}: store falls back to local')
        check('Só neste aparelho' in pg.inner_text('#store-pill'), f'{label}: pill "Só neste aparelho" ({pg.inner_text("#store-pill")})')
        check(not pg.is_visible('#signed-out'), f'{label}: no login screen')
        import_file(pg, os.path.join(FX, 'nubank_cartao.csv'), new_acc=('Nubank', 'credit_card'))
        pg.wait_for_timeout(700)
        n = J(pg, '() => { const d = JSON.parse(localStorage.getItem("ff2:local") || "{}"); return Object.values(d.months || {}).reduce((s, m) => s + m.length, 0); }')
        check(n == len(J(pg, '() => __ff.live()')) and n > 0, f'{label}: saved in localStorage ({n} rows)')
        check('Só neste aparelho' in pg.inner_text('#store-pill'), f'{label}: real data, still "Só neste aparelho"')
        sw = J(pg, '() => navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0')
        check(sw == 0, f'{label}: no service worker')
        shot(pg, 'local-fallback-' + ('absent' if not kw.get('fake') else 'null'))
        ctx.close()


if __name__ == '__main__':
    main()
