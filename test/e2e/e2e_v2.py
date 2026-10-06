"""End-to-end tests for Finanças Flow v2 (site/) in headless Chromium.

Usage: python3 test/e2e/e2e_v2.py
  - serves site/ itself (test/e2e/server.py) on 127.0.0.1:8766
  - most scenarios use the REAL site/store.js in "local" mode (no Netlify here → auto-detects local)
  - netlify-mode scenarios (signed-out screen, login, PC↔phone sync) use test/e2e/stub_store.js, a test-only
    Store stub backed by the server's shared /__stub/* endpoints (two browser contexts = two devices)
  - the user's real v1 data (FF_REAL_DATA, default: the session scratchpad) is copied to a temp file at runtime
    and imported through "Importar backup"; it is never written into the repo. Scenario skipped if absent.
Screenshots: screens/v2/*.png (390px, light + dark)."""
import sys, os, json, glob, re, tempfile, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import server  # noqa: E402

PORT = 8766
URL = f'http://127.0.0.1:{PORT}/'
FX = os.path.join(ROOT, 'test', 'fixtures')
SCR = os.path.join(ROOT, 'screens', 'v2')
REAL = os.environ.get('FF_REAL_DATA', '/tmp/claude-0/-home-claude/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db/data/users/me/store')
TMP = tempfile.mkdtemp(prefix='ff-e2e-')
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
REALIDS = {}
STUB_JS = open(os.path.join(ROOT, 'site', 'store.js'), encoding='utf-8').read() + '\n' + open(os.path.join(HERE, 'stub_store.js'), encoding='utf-8').read()


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    (PASSES if cond else FAILS).append(msg)
    return cond


def section(t):
    print('\n== ' + t, flush=True)


def new_page(browser, scheme='light', stub=None, w=390, h=844):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2, accept_downloads=True)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    if stub is not None:
        ctx.add_init_script('window.__STUB = ' + json.dumps(stub) + ';')
        ctx.route('**/store.js', lambda r: r.fulfill(status=200, body=STUB_JS, content_type='text/javascript'))
    pg = ctx.new_page()
    pg._errs = []
    pg.on('console', lambda m: pg._errs.append(m.type + ': ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: pg._errs.append('PAGEERROR ' + str(e)))
    pg.goto(URL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted')
    pg.wait_for_timeout(300)
    return ctx, pg


def J(pg, expr, arg=None):
    return pg.evaluate(expr, arg) if arg is not None else pg.evaluate(expr)


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


def import_file(pg, path, acc=None, new_acc=None, layout='', expect_dupes=None):
    """drives the import wizard: acc = existing account id; new_acc = (name, type)"""
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
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"], [data-act="imp-step"][data-s="3"]')
    if pg.is_visible('[data-act="imp-step"][data-s="3"]') and not pg.is_visible('[data-act="imp-step"][data-s="4"]'):
        pg.click('[data-act="imp-step"][data-s="3"]')
    pg.wait_for_selector('[data-act="imp-step"][data-s="4"]')
    info = J(pg, '() => ({ fresh: __ff.state().imp.dedup.fresh.length, dup: __ff.state().imp.dedup.duplicates.length, roles: __ff.state().imp.profile.columns, mismatch: !!document.querySelector("#acc-mismatch") })')
    if pg.is_disabled('[data-act="imp-step"][data-s="4"]'):
        return info
    pg.click('[data-act="imp-step"][data-s="4"]')
    if layout:
        pg.fill('#imp-layout', layout)
    pg.click('[data-act="imp-commit"]')
    pg.wait_for_selector('#imp-done')
    return info


def txs(pg):
    return J(pg, '() => __ff.live()')


def find(pg, pred_js):
    return J(pg, '() => __ff.live().filter(' + pred_js + ')')


def build_real_dump():
    if not os.path.isdir(REAL):
        return None
    meta = {}
    for f in glob.glob(os.path.join(REAL, 'meta', '*.json')):
        meta[os.path.basename(f)[:-5]] = json.load(open(f, encoding='utf-8'))
    months = {}
    for f in glob.glob(os.path.join(REAL, 'months', '*.json')):
        months[os.path.basename(f)[:-5]] = json.load(open(f, encoding='utf-8'))
    p = os.path.join(TMP, 'backup-v1-real.json')
    json.dump({'meta': meta, 'months': months}, open(p, 'w', encoding='utf-8'))
    # identifiers are derived from the data at runtime (no real ids/names hardcoded in the repo)
    rows = [t for m in months.values() for t in m.get('transactions', [])]
    imps = sorted({t.get('importId') for t in rows if t.get('importId')})
    bank = next(i for i in imps if any(t.get('importId') == i and re.search('rendimento', t.get('rawDescription', ''), re.I) for t in rows))
    REALIDS.update(bank=bank, card=next(i for i in imps if i != bank), acc=meta['accounts']['items'][0]['id'])
    return p


def wait_until(pg, js, timeout=8000):
    try:
        pg.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


def main():
    server.start(PORT)
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            scenario_example(b)
            scenario_real_data(b)
            scenario_signed_out_and_sync(b)
        finally:
            b.close()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


# --------------------------------------------------------------------------------------------- example / local
def scenario_example(b):
    section('first run (local mode): example data, look, layout')
    for scheme in ('light', 'dark'):
        ctx, pg = new_page(b, scheme)
        check(J(pg, '() => __ff.state().mode') == 'example', f'{scheme}: example mode on first run')
        check('Exemplo' in pg.inner_text('#store-pill') and 'Só neste aparelho' in pg.inner_text('#store-pill'), f'{scheme}: pill says Exemplo · Só neste aparelho')
        check(pg.is_visible('#example-banner .banner'), f'{scheme}: example banner')
        no_hscroll(pg, scheme + ' painel')
        shot(pg, f'painel-example-{scheme}')
        check(not pg._errs, f'{scheme}: no console errors {pg._errs[:3]}')
        ctx.close()
    ctx, pg = new_page(b, 'light', w=380, h=800)
    for t in ('painel', 'tx', 'import', 'cats'):
        goto_tab(pg, t)
        no_hscroll(pg, f'380px {t}')
    check(not J(pg, '() => !!document.querySelector("script:not([src])")'), 'no inline <script> blocks (CSP script-src self)')
    check(not J(pg, '() => [...document.querySelectorAll("*")].some(e => [...e.attributes].some(a => /^on/i.test(a.name)))'), 'no inline event handlers in the DOM')
    check(J(pg, '() => !!document.querySelector("link[rel=manifest][href=\'manifest.webmanifest\']") && !!document.querySelector("meta[name=viewport][content*=viewport-fit]")'), 'manifest link + viewport-fit=cover')
    check(J(pg, '() => !("claude" in window)'), 'no window.claude usage')
    check(J(pg, '() => !document.querySelector("[data-act=imp-ai],[data-act=ai-cats]") || [...document.querySelectorAll("[data-act=imp-ai],[data-act=ai-cats]")].every(e => !e.offsetParent)'), 'AI buttons hidden (FEATURES.ai=false)')
    ctx.close()


# --------------------------------------------------------------------------------------------- real data
def scenario_real_data(b):
    dump = build_real_dump()
    ctx, pg = new_page(b, 'light')
    if dump:
        section('import the real v1 data via "Importar backup" (store.importAll) → migration')
        pg.click('#btn-settings')
        pg.set_input_files('#restore-file', dump)
        pg.wait_for_selector('#restore-confirm')
        pg.click('#restore-yes')
        ok = wait_until(pg, '() => __ff.state().mode === "real" && __ff.live().length > 100', 15000)
        check(ok, 'backup imported, real mode, >100 transactions')
        check(J(pg, '() => __ff.D().settings.schemaVersion') == J(pg, '() => FinEngine.SCHEMA_VERSION'), 'settings.schemaVersion = current schema after migration')
        teds = find(pg, 't => /^TED RECEBIDA/i.test(t.rawDescription) && /^renda/.test(t.categoryId || "")')
        check(len(teds) >= 2 and all(t['kind'] == 'income' for t in teds), f'D3: salary/reimbursement TEDs are income now ({[t["kind"] for t in teds]})')
        check(all(t['catSource'] == 'manual' for t in teds), 'D3: manual categories kept')
        rend = find(pg, 't => /do dia 22\\/09/.test(t.rawDescription)')
        check(rend and rend[0]['merchant'] == 'RENDIMENTO AUTOMATICO', 'D6: "Rendimento automático do dia 22/09/2026" normalized')
        mp = find(pg, 't => /Mercado Pago/.test(t.rawDescription)')
        check(mp and all(t['categoryId'] is None for t in mp), 'D5: Pix to Mercado Pago no longer "Mercado" (now uncategorized)')
        check(all(t.get('updatedAt') for t in txs(pg)), 'every transaction has updatedAt')
        rules = J(pg, '() => __ff.D().rules')
        check(any(r.get('origin') == 'learned' for r in rules), f'D4: learned rules created from consistent history ({len(rules)} rules)')
        set_month(pg, '2026-09')
        inc = kpi(pg, 'income')
        check(inc > 3000000, f'Painel Sept income counts the TEDs as income (R$ {inc/100:.2f})')
        check(kpi(pg, 'expense') > 0, 'Painel Sept expense positive (no negative "expense" from deposits)')
        shot(pg, 'painel-real-light')

        section('item 9: accounts & imports — list, move, delete, rename, type')
        pg.click('#btn-settings'); pg.click('#btn-accounts')
        pg.wait_for_selector('#imp-list')
        rows = pg.query_selector_all('#imp-list .imp-row')
        check(len(rows) == 2, f'imports list shows 2 imports ({len(rows)})')
        ids = [r.get_attribute('data-imp') for r in rows]
        check(set(ids) == {REALIDS['bank'], REALIDS['card']}, f'backfilled imports {ids}')
        shot(pg, 'accounts-sheet-light')
        pg.click(f'.imp-row[data-imp="{REALIDS["bank"]}"] [data-act="imp-move"]')
        pg.wait_for_selector('#move-box')
        pg.select_option('#mv-acc', '__new')
        pg.fill('#mv-name', 'XP conta corrente')
        pg.select_option('#mv-type', 'checking')
        pg.click('#mv-confirm')
        pg.wait_for_timeout(300)
        moved = find(pg, 't => t.importId === "%s"' % REALIDS['bank'])
        newacc = J(pg, '() => __ff.D().accounts.find(a => a.name === "XP conta corrente")')
        check(newacc and newacc['type'] == 'checking', 'new checking account created')
        check(newacc and all(t['accountId'] == newacc['id'] for t in moved), f'all {len(moved)} extrato transactions moved')
        fat = [t for t in moved if re.search('PAGAMENTO DE FATURA', t['rawDescription'], re.I)]
        check(fat and all(t['kind'] == 'card_payment' for t in fat), 'fatura payments still card_payment after the move')
        check(J(pg, '() => __ff.D().imports["%s"].accountId' % REALIDS['bank']) == (newacc or {}).get('id'), 'imports record points to the new account')
        pg.click(f'.imp-row[data-imp="{REALIDS["card"]}"] [data-act="imp-del"]')
        pg.wait_for_selector('#del-box')
        check('Dá para desfazer' in pg.inner_text('#del-box') and 'soma' in pg.inner_text('#del-box'), 'in-page delete confirmation (months, sum, undo hint)')
        pg.click('#del-confirm')
        pg.wait_for_timeout(300)
        check(len(find(pg, 't => t.importId === "%s"' % REALIDS['card'])) == 0, 'card import deleted (its transactions are gone from every view)')
        check(len(pg.query_selector_all('#imp-list .imp-row')) == 1, 'imports list now has 1 import')
        pg.fill(f'[data-accname="{REALIDS["acc"]}"]', 'XP cartão de crédito')
        pg.press(f'[data-accname="{REALIDS["acc"]}"]', 'Tab')
        pg.wait_for_timeout(200)
        check(J(pg, '() => __ff.D().accounts.find(a => a.id === "%s").name' % REALIDS['acc']) == 'XP cartão de crédito', 'account renamed')
        pg.click('.sheet-h [data-act="closesheet"]')
        persisted = J(pg, '() => { const d = JSON.parse(localStorage.getItem("ff2:local") || "{}"); return { months: Object.keys(d.months || {}), imports: Object.keys((d.meta || {}).imports || {}) }; }')
        pg.wait_for_timeout(600)
        persisted = J(pg, '() => { const d = JSON.parse(localStorage.getItem("ff2:local") || "{}"); const n = Object.values(d.months || {}).reduce((s, m) => s + m.length, 0); return { n, imports: Object.keys((d.meta || {}).imports || {}), accounts: ((d.meta||{}).accounts||{}).items }; }')
        check(persisted['imports'] == [REALIDS['bank']] and persisted['n'] == len(txs(pg)), f'persisted through store.saveMonth/saveMeta ({persisted["n"]} rows, imports {persisted["imports"]})')
        card = REALIDS['acc']
    else:
        section('real data not found — skipping real-data import (FF_REAL_DATA)')
        card = None

    section('item 3 / D1: XP fatura with Parcela column → parcela in its month; next fatura not a duplicate')
    info = import_file(pg, os.path.join(FX, 'xp_fatura_ago.csv'), acc=card, new_acc=None if card else ('XP cartão', 'credit_card'), layout='Fatura XP v2')
    check(info['roles'].get('installment') == 4, f'Parcela column detected as installment, even with the old saved "Fatura XP" layout ({info["roles"]})')
    if card:
        profs = J(pg, '() => __ff.D().profiles')
        check(any(pr.get('columns', {}).get('installment') == 4 for pr in profs), 'saved layout upgraded with the Parcela column')
    loja = find(pg, 't => /LOJA TESTE/.test(t.rawDescription)')
    check(len(loja) == 1 and loja[0]['date'] == '2026-08-10' and loja[0]['originalDate'] == '2026-06-10' and loja[0]['installment'] == {'n': 3, 'total': 10}, f'parcela 3/10 of 10/06 booked on 10/08 ({loja})')
    hav = find(pg, 't => /HAVAN/.test(t.rawDescription) && t.installment')
    check(hav and hav[0]['date'] == '2026-09-02', 'parcela 9/10 bought 02/01 booked in September, not January')
    check(len(find(pg, 't => /MOVEIS BOA VISTA/.test(t.rawDescription) && t.date === "2026-08-31"')) == 1, '31/07 + 1 month clamps to 31/08')
    info2 = import_file(pg, os.path.join(FX, 'xp_fatura_set.csv'), acc=card or J(pg, '() => __ff.D().accounts[0].id'))
    check(info2['dup'] == 0 and info2['fresh'] == 4, f'next month fatura: parcela 4/10 NOT a duplicate (fresh {info2["fresh"]}, dup {info2["dup"]})')
    loja = find(pg, 't => /LOJA TESTE/.test(t.rawDescription)')
    check(sorted(t['date'] for t in loja) == ['2026-08-10', '2026-09-10'], 'both parcelas exist, each in its own month')
    info3 = import_file(pg, os.path.join(FX, 'xp_fatura_set.csv'), acc=card or J(pg, '() => __ff.D().accounts[0].id'))
    check(info3['fresh'] == 0 and info3['dup'] == 4, 'importing the same fatura again: all duplicates')
    goto_tab(pg, 'tx')
    pg.fill('#tx-search', 'LOJA TESTE'); pg.wait_for_timeout(300)
    meta_txt = pg.inner_text('#tx-list')
    check('compra em 10/06 · parcela 3/10' in meta_txt and 'compra em 10/06 · parcela 4/10' in meta_txt, 'list shows "compra em 10/06 · parcela 3/10"')
    pg.fill('#tx-search', ''); pg.wait_for_timeout(250)
    set_month(pg, '2026-10')
    fut = pg.text_content('#future-card')
    check('Parcelas futuras' in fut and 'LOJA TESTE' in fut, 'Parcelas futuras projects the remaining parcelas')
    fi = J(pg, '() => FinEngine.futureInstallments(__ff.live()).flatMap(f => (f.items || []).filter(i => /LOJA TESTE/.test(i.merchant || i.rawDescription || "")).map(i => [f.month, i.n]))')
    ns = [n for _, n in fi]
    check(ns == sorted(set(ns)) and ns and ns[0] == 5 and 3 not in ns and 4 not in ns, f'Parcelas futuras: LOJA projected from 5/10 on, once each, imported parcelas not projected again ({fi})')
    acc_card = card or J(pg, '() => __ff.D().accounts[0].id')
    sep = find(pg, 't => t.accountId === %s && t.date >= "2026-09-01" && t.date <= "2026-09-30" && t.kind === "expense"' % json.dumps(acc_card))
    check(sorted(t['amount'] for t in sep) == sorted([-15000, -20000, -4590, -1399]), f'September card expenses: each parcela once, nothing double counted ({sorted(t["amount"] for t in sep)})')
    set_month(pg, '2026-09')
    exp_sep = kpi(pg, 'expense')
    check(exp_sep == J(pg, '() => FinEngine.summarize(__ff.live(), {from: "2026-09-01", to: "2026-09-30"}).expense'), 'Painel September expense = engine summary (no double counting after the 2nd fatura)')
    # account type change: card → checking → card recalculates kinds, manual categories kept
    pg.click('#btn-settings'); pg.click('#btn-accounts'); pg.wait_for_selector('#acc-body')
    pg.select_option(f'[data-acctype="{acc_card}"]', 'checking'); pg.wait_for_timeout(300)
    check(J(pg, '(id) => __ff.D().accounts.find(a => a.id === id).type', acc_card) == 'checking', 'account type changed to Conta corrente')
    pg.select_option(f'[data-acctype="{acc_card}"]', 'credit_card'); pg.wait_for_timeout(300)
    check(J(pg, '(id) => __ff.D().accounts.find(a => a.id === id).type', acc_card) == 'credit_card', 'account type changed back to Cartão de crédito')
    pay = find(pg, 't => /Pagamento de fatura/i.test(t.rawDescription) && t.accountId === %s' % json.dumps(acc_card))
    check(pay and all(t['kind'] == 'card_payment' for t in pay), 'card payment row is card_payment again after the round trip of types')
    pg.click('.sheet-h [data-act="closesheet"]')
    for w in (1280,):
        pg.set_viewport_size({'width': w, 'height': 900})
        for t in ('painel', 'tx', 'import', 'cats'):
            goto_tab(pg, t)
            no_hscroll(pg, f'{w}px {t}')
        goto_tab(pg, 'painel')
        shot(pg, f'painel-{w}-light')
        pg.set_viewport_size({'width': 390, 'height': 844})

    section('item 4 / D2: time column in a bank extrato')
    accs = J(pg, '() => __ff.D().accounts')
    chk = next((a['id'] for a in accs if a['type'] == 'checking'), None)
    info4 = import_file(pg, os.path.join(FX, 'xp_extrato_hora.csv'), acc=chk, new_acc=None if chk else ('XP conta', 'checking'))
    check(info4['roles'].get('time') == 1, f'time column detected ({info4["roles"]})')
    ted = find(pg, 't => /EMPRESA TESTE/.test(t.rawDescription)')
    check(ted and ted[0].get('time') == '09:30', 'time HH:MM stored on the transaction')
    goto_tab(pg, 'tx')
    pg.fill('#tx-search', 'EMPRESA TESTE'); pg.wait_for_timeout(300)
    check('09:30' in pg.inner_text('#tx-list'), 'time shown in the list')
    pg.click('#tx-list .tx')
    check('09:30' in pg.inner_text('.sheet'), 'time shown in the editor')
    pg.click('.sheet-h [data-act="closesheet"]')
    pg.fill('#tx-search', ''); pg.wait_for_timeout(250)
    noTime = find(pg, 't => /LOJA TESTE/.test(t.rawDescription)')
    check(all('time' not in t for t in noTime), 'no time in the file → nothing shown/stored')
    # mismatch warning when a bank file goes to a card account (D2 prevention)
    if card:
        J(pg, '() => { __ff.state().imp = null; }'); goto_tab(pg, 'painel'); goto_tab(pg, 'import')
        pg.select_option('#imp-acc', card)
        pg.set_input_files('#imp-file', os.path.join(FX, 'xp_extrato_hora.csv'))
        pg.wait_for_selector('[data-act="imp-step"][data-s="3"], [data-act="imp-step"][data-s="4"]')
        if not pg.is_visible('#acc-mismatch'):
            if pg.is_visible('[data-act="imp-step"][data-s="3"]') and not pg.is_visible('[data-act="imp-step"][data-s="4"]'):
                pg.click('[data-act="imp-step"][data-s="3"]')
        check(pg.is_visible('#acc-mismatch'), 'D2: warns when a bank extrato is imported into a credit-card account')
        J(pg, '() => { __ff.state().imp = null; }')

    section('items 2 + 5 + 6: triage — remember rule, undo stack, new category, banner/badge update without reload')
    goto_tab(pg, 'painel')
    unc0 = J(pg, '() => __ff.live().filter(t => !t.categoryId && t.kind !== "transfer" && t.kind !== "card_payment").length')
    check(unc0 > 3, f'there is a triage backlog ({unc0})')
    check(pg.is_visible('#triage-banner'), '"Classificar agora" banner on the Painel')
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
    # find a card with a merchant that repeats (to see the rule re-classify the others)
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
    check(len(rules1) == rules0 + 1 and rules1[-1]['match']['value'] == m0, f'remember → learned rule for {m0}')
    still = len(find(pg, f't => t.merchant === {json.dumps(m0)} && !t.categoryId'))
    check(still == 0, f'other uncategorized {m0} re-classified ({same0} → {still})')
    lbl = pg.inner_text('#tri-undo')
    check('Desfazer' in lbl and m0[:10] in lbl and '+ regra' in lbl, f'undo button names what will be undone: "{lbl}"')
    pg.click('#tri-undo')
    pg.wait_for_timeout(200)
    check(len(J(pg, '() => __ff.D().rules')) == rules0, 'undo removed the rule')
    check(len(find(pg, f't => t.merchant === {json.dumps(m0)} && !t.categoryId')) == same0, 'undo restored the affected transactions')
    check(current()['id'] == t0['id'], 'undo went back to the same card')
    # unchecked remember → only this transaction
    pg.uncheck('#tri-remember')
    pg.click(f'.tri-grid [data-act="tri-group"][data-g="{g}"]')
    pg.click('.tri-grid [data-act="tri-pick"]')
    check(len(J(pg, '() => __ff.D().rules')) == rules0, 'unchecked → no rule')
    check(len(find(pg, f't => t.merchant === {json.dumps(m0)} && !t.categoryId')) == max(0, same0 - 1), 'unchecked → this transaction only')
    # skip + transfer + multi-level undo
    t1 = current()
    pg.click('[data-act="tri-skip"]')
    t2 = current()
    pg.click('[data-act="tri-transfer"]')
    pg.click('#tri-tr-ext')  # v2.5: "É transferência minha" → which account ("Conta não cadastrada")
    check(J(pg, f'() => __ff.live().find(t => t.id === {json.dumps(t2["id"])}).kind') == 'transfer', '"É transferência" marks transfer')
    check('Transferência' in pg.inner_text('#tri-undo'), 'undo names the transfer')
    pg.click('#tri-undo')
    check(J(pg, f'() => __ff.live().find(t => t.id === {json.dumps(t2["id"])}).kind') != 'transfer', 'undo transfer')
    check('Pular' in pg.inner_text('#tri-undo'), 'next undo level: Pular')
    pg.click('#tri-undo')
    check(current()['id'] == t1['id'], 'undo skip goes back')
    check('para' in pg.inner_text('#tri-undo'), 'next undo level: the category choice')
    pg.click('#tri-undo')
    check(current()['id'] == t0['id'] and len(find(pg, f't => t.merchant === {json.dumps(m0)} && !t.categoryId')) == same0, 'three undo levels back to the start')
    # new category from triage
    pg.check('#tri-remember')
    pg.click('#tri-newcat')
    pg.wait_for_selector('#tri-nc')
    pg.select_option('#tri-nc-group', '__newgroup')
    pg.fill('#tri-nc-gname', 'Viagens E2E')
    pg.fill('#tri-nc-name', 'Passagens')
    pg.click('#tri-nc [data-act="nc-save"]')
    pg.wait_for_timeout(200)
    cats = J(pg, '() => __ff.D().categories.map(g => g.name)')
    check('Viagens E2E' in cats, '+ Nova categoria: new group saved to the taxonomy')
    check(J(pg, f'() => __ff.live().find(t => t.id === {json.dumps(t0["id"])}).categoryId') == 'viagens_e2e.passagens', 'new category selected for the transaction')
    # suggestions for ambiguous merchants
    amb = J(pg, '() => !!document.querySelector("#tri-sugs")')
    # classify everything left
    guard = 0
    while pg.is_visible('#tri-card') and guard < 200:
        guard += 1
        if pg.is_visible('#tri-sugs .sug-btn'):
            amb = True
            pg.click('#tri-sugs .sug-btn')
        else:
            pg.click('.tri-grid [data-act="tri-group"]')
            pg.click('.tri-grid [data-act="tri-pick"]')
    check(amb, 'triage offered suggestion chips (ambiguous / history)')
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
    check(pg.is_visible('#tri-done'), f'queue finished ({guard} picks)')
    pg.click('#tri-finish')
    pg.wait_for_timeout(200)
    check(not pg.is_visible('#triage-banner'), 'banner "Classificar agora" gone right away (no reload)')
    check(pg.is_hidden('#tab-badge'), 'tab badge gone right away (no reload)')

    section('item 2: Painel numbers change right after a category change')
    set_month(pg, '2026-09')
    inc_before, exp_before = kpi(pg, 'income'), kpi(pg, 'expense')
    pg.click('.sk-node[data-id^="grp:"]')
    pg.wait_for_selector('.sheet .tx')
    tx_id = pg.get_attribute('.sheet .tx', 'data-id')
    amt = J(pg, f'() => __ff.live().find(t => t.id === {json.dumps(tx_id)}).amount')
    pg.click('.sheet .tx')
    pg.wait_for_selector('#ed-cat')
    pg.select_option('#ed-cat', 'renda.outros')
    check(pg.input_value('#ed-kind') == 'income', 'kind select follows the category (Renda → Entrada)')
    pg.uncheck('#ed-remember')
    pg.click('[data-act="savetx"]')
    pg.wait_for_timeout(200)
    inc_after, exp_after = kpi(pg, 'income'), kpi(pg, 'expense')
    check(inc_after == inc_before + amt and exp_after == exp_before + amt, f'KPIs updated in place: income {inc_before}→{inc_after}, expense {exp_before}→{exp_after} (amount {amt})')
    # and from the Transações tab
    goto_tab(pg, 'tx')
    pg.fill('#tx-search', 'EMPRESA TESTE'); pg.wait_for_timeout(300)
    pg.click('#tx-list .tx')
    pg.select_option('#ed-cat', 'compras.casa')
    pg.uncheck('#ed-remember')
    pg.click('[data-act="savetx"]')
    goto_tab(pg, 'painel')
    check(kpi(pg, 'income') == inc_after - 500000, 'Painel reflects a category change made in Transações')
    pg.fill('#tx-search', '') if pg.is_visible('#tx-search') else None
    J(pg, '() => { __ff.state().ui.q = ""; }')

    section('item 1: "+ Nova categoria" in the editor and the rule editor')
    goto_tab(pg, 'tx')
    pg.click('#tx-list .tx')
    pg.select_option('#ed-cat', '__new')
    check(pg.is_visible('#ed-nc'), 'editor: choosing "+ Nova categoria" opens the inline form')
    pg.select_option('#ed-nc-group', 'lazer')
    pg.fill('#ed-nc-name', 'Shows E2E')
    pg.click('#ed-nc [data-act="nc-save"]')
    check(pg.input_value('#ed-cat') == 'lazer.shows_e2e', 'editor: new category created and selected')
    pg.click('.sheet-h [data-act="closesheet"]')
    goto_tab(pg, 'cats')
    pg.click('[data-act="rule-new"]')
    pg.select_option('#rl-cat', '__new')
    check(pg.is_visible('#rl-nc'), 'rule editor: inline new-category form')
    pg.click('#rl-nc [data-act="nc-cancel"]')
    pg.click('.sheet-h [data-act="closesheet"]')

    section('item 7: Filtros sheet, count badge, Limpar, sort, remembered per session')
    goto_tab(pg, 'tx')
    chips_before = pg.inner_text('.chips')
    pg.click('#btn-filters')
    pg.wait_for_selector('#f-apply')
    pg.click('#f-from')
    pg.keyboard.type('01092026')
    check(pg.input_value('#f-from') == '01/09/2026', 'date mask types dd/mm/aaaa with automatic slashes')
    pg.fill('#f-to', '30/09/2026')
    pg.fill('#f-min', '100,00')
    pg.check('[data-fchk="types"][value="expense"]')
    shot(pg, 'filters-light')
    pg.click('#f-apply')
    pg.wait_for_timeout(250)
    check(pg.inner_text('#filters-count') == '3', f'active-filter count badge = 3 ({pg.inner_text("#filters-count")})')
    lst = J(pg, '() => [...document.querySelectorAll("#tx-list .tx")].map(e => __ff.live().find(t => t.id === e.dataset.id))')
    check(lst and all('2026-09-01' <= t['date'] <= '2026-09-30' and abs(t['amount']) >= 10000 and t['kind'] == 'expense' for t in lst), f'filters applied ({len(lst)} rows)')
    pg.select_option('#tx-sort', 'amt_desc')
    pg.wait_for_timeout(200)
    amts = J(pg, '() => [...document.querySelectorAll("#tx-list .tx")].map(e => Math.abs(__ff.live().find(t => t.id === e.dataset.id).amount))')
    check(amts == sorted(amts, reverse=True), 'sort: Maior valor')
    check(pg.inner_text('.chips') == chips_before, 'quick chips unchanged')
    pg.reload(); pg.wait_for_function('() => window.__ff && window.__ff.state().booted'); pg.wait_for_timeout(400)
    goto_tab(pg, 'tx')
    check(pg.input_value('#tx-sort') == 'amt_desc' and pg.is_visible('#filters-count'), 'filters + sort remembered in the session')
    shot(pg, 'transacoes-filtered-light')
    pg.click('#btn-filters-clear')
    check(not pg.is_visible('#filters-count'), '"Limpar" removes all filters')
    pg.select_option('#tx-sort', 'date_desc')

    section('items 10 + 11: holerite with adiantamento, masked date field + calendar button')
    goto_tab(pg, 'import')
    pg.click('[data-act="imp-tab"][data-t="holerite"]')
    pg.fill('#hol-date', '')
    pg.click('#hol-date')
    pg.keyboard.type('05102026')
    check(pg.input_value('#hol-date') == '05/10/2026', 'holerite date: typing works with the mask')
    pg.click('[data-act="datepick"][data-for="hol-date"]')
    check(not [e for e in pg._errs if 'PAGEERROR' in e], 'calendar button does not throw')
    pg.keyboard.press('Escape')
    pg.fill('#hol-emp', 'Acme')
    pg.fill('#hol-gross', '10.000,00'); pg.fill('#hol-inss', '951,59'); pg.fill('#hol-irrf', '2.142,31')
    pg.check('#hol-adv')
    pg.wait_for_selector('#hol-split-adv')
    check(pg.input_value('#hol-adv-pct') == '40' and pg.input_value('#hol-adv-date') == '20/09/2026', 'adiantamento defaults: 40%, day 20')
    check(pg.inner_text('#hol-split-adv') == 'R$ 4.000,00', 'live split: adiantamento 40% of gross')
    check(pg.inner_text('#hol-split-final') == 'R$ 2.906,10', f'live split: final deposit = líquido − adiantamento ({pg.inner_text("#hol-split-final")})')
    pg.fill('#hol-adv-pct', '30'); pg.wait_for_timeout(100)
    check(pg.inner_text('#hol-split-adv') == 'R$ 3.000,00', 'split preview updates live')
    pg.fill('#hol-adv-pct', '40')
    pg.fill('#hol-date', '31/02/2026'); pg.press('#hol-date', 'Tab')
    check(pg.is_visible('#hol-date-err'), 'invalid date flagged')
    pg.fill('#hol-date', '05/10/2026'); pg.press('#hol-date', 'Tab')
    shot(pg, 'holerite-light', full=True)
    pg.click('[data-act="hol-save"]')
    pg.wait_for_selector('#hol-done')
    hs = find(pg, 't => t.payslip')
    adv = [t for t in hs if t.get('payslipRole') == 'advance']
    check(adv and adv[0]['date'] == '2026-09-20' and adv[0]['amount'] == 400000, 'advance income on 20/09')
    check(sum(t['amount'] for t in hs if t['kind'] == 'income') == 1000000, 'income over both dates totals gross')
    check(sum(t['amount'] for t in hs) == 1000000 - 95159 - 214231, f"net cash of the holerite = líquido R$ 6.906,10 ({sum(t['amount'] for t in hs)})")
    check(sum(t['amount'] for t in hs if t['kind'] == 'expense') == -(95159 + 214231) and all(t['categoryId'].startswith('impostos') for t in hs if t['kind'] == 'expense'), 'deductions are impostos expenses')
    ctx2, pg2 = new_page(b, 'dark')
    shot(pg2, 'painel-dark-after')
    ctx2.close()
    check(not [e for e in pg._errs if 'PAGEERROR' in e], f'no page errors {pg._errs[:3]}')
    ctx.close()


# --------------------------------------------------------------------------------------------- netlify-mode (stub)
def scenario_signed_out_and_sync(b):
    section('signed out (netlify mode): "Entrar" screen, login, then PC ↔ phone live sync')
    ns = 'sync' + str(int(time.time()))
    import urllib.request

    def post(path, body):
        req = urllib.request.Request(f'{URL}__stub/{path}?ns={ns}', data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
        return json.loads(urllib.request.urlopen(req).read())
    stamp = '2026-09-30T10:00:00.000Z'
    seed = [
        {'id': 's1', 'date': '2026-09-10', 'amount': -4590, 'rawDescription': 'IFOOD *RESTAURANTE', 'merchant': 'IFOOD', 'accountId': 'nu', 'kind': 'expense', 'categoryId': 'alimentacao.delivery', 'catSource': 'dictionary', 'importId': 'imp-a', 'updatedAt': stamp, 'time': '20:15'},
        {'id': 's2', 'date': '2026-09-12', 'amount': -12000, 'rawDescription': 'LOJA DO BAIRRO', 'merchant': 'LOJA DO BAIRRO', 'accountId': 'nu', 'kind': 'expense', 'categoryId': None, 'catSource': None, 'importId': 'imp-a', 'updatedAt': stamp},
        {'id': 's3', 'date': '2026-09-05', 'amount': 800000, 'rawDescription': 'SALARIO ACME', 'merchant': 'SALARIO ACME', 'accountId': 'cc', 'kind': 'income', 'categoryId': 'renda.salario', 'catSource': 'dictionary', 'importId': 'imp-b', 'updatedAt': stamp}]
    post('month/2026-09', seed)
    post('meta/accounts', {'items': [{'id': 'nu', 'name': 'Nubank', 'type': 'credit_card'}, {'id': 'cc', 'name': 'Conta', 'type': 'checking'}]})
    post('meta/settings', {'budgets': {}, 'schemaVersion': 2})
    user = {'id': 'u-e2e', 'email': 'eu@exemplo.com'}
    for scheme in ('light', 'dark'):
        ctx, pg = new_page(b, scheme, stub={'ns': ns, 'mode': 'netlify', 'user': None, 'loginUser': user, 'pollMs': 300})
        check(pg.is_visible('#signed-out') and pg.is_visible('#signed-out [data-act="login"]'), f'{scheme}: signed-out screen offers "Entrar"')
        check('Entre para sincronizar' in pg.inner_text('#store-pill'), f'{scheme}: pill says "Entre para sincronizar"')
        check(J(pg, '() => __ff.state().mode') == 'example', f'{scheme}: signed out → example data, not saved')
        shot(pg, f'signed-out-{scheme}')
        if scheme == 'light':
            pg.click('#signed-out [data-act="login"]')
            ok = wait_until(pg, '() => __ff.state().mode === "real" && __ff.live().length === 3')
            check(ok, 'after "Entrar" the account data loads')
            wait_until(pg, '() => /Sincronizado/.test(document.querySelector("#store-pill").textContent)', 4000)
            check('Sincronizado' in pg.inner_text('#store-pill'), f'pill: Sincronizado ({pg.inner_text("#store-pill")})')
        ctx.close()

    # two devices
    ctxA, A = new_page(b, 'light', stub={'ns': ns, 'mode': 'netlify', 'user': user, 'pollMs': 300})
    ctxB, B = new_page(b, 'dark', stub={'ns': ns, 'mode': 'netlify', 'user': user, 'pollMs': 300}, w=390)
    goto_tab(B, 'tx')
    check(B.is_visible('#tx-list .tx[data-id="s2"]'), 'B (phone) shows the transaction')
    # B opens the editor of s1 and types an unsaved note
    B.click('#tx-list .tx[data-id="s1"]')
    B.fill('#ed-note', 'nota digitada no celular')
    # A (PC) categorizes s2
    goto_tab(A, 'tx')
    A.click('#tx-list .tx[data-id="s2"]')
    A.select_option('#ed-cat', 'compras.casa')
    A.click('[data-act="savetx"]')
    ok = wait_until(B, '() => (__ff.live().find(t => t.id === "s2") || {}).categoryId === "compras.casa"', 8000)
    check(ok, 'change made on A appears on B (store.subscribe)')
    B.wait_for_timeout(300)
    check(B.is_visible('#ed-note') and B.input_value('#ed-note') == 'nota digitada no celular', 'B: open editor kept its unsaved input during the remote update')
    shot(B, 'sync-phone-dark')
    B.click('.sheet-h [data-act="closesheet"]')
    B.wait_for_timeout(300)
    check('Casa' in B.inner_text('.tx[data-id="s2"]'), 'B re-rendered the list after closing the editor')
    # remote delete via A's import deletion reaches B
    A.click('#btn-settings'); A.click('#btn-accounts')
    A.click('.imp-row[data-imp="imp-b"] [data-act="imp-del"]')
    A.click('#del-confirm')
    ok = wait_until(B, '() => !__ff.live().some(t => t.id === "s3")', 8000)
    check(ok, 'deletion (tombstone) on A disappears on B')
    check(J(B, '() => __ff.live().every(t => !t.deleted)'), 'B never shows tombstones')
    goto_tab(B, 'painel')
    check(kpi(B, 'income') == 0, 'B Painel income dropped after the remote delete')
    check(not [e for e in A._errs + B._errs if 'PAGEERROR' in e], 'no page errors on A/B')
    ctxA.close(); ctxB.close()


if __name__ == '__main__':
    main()
