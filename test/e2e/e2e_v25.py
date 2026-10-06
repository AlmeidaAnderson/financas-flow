"""End-to-end tests of v2.5 — transfers between your own accounts and payments — in headless Chromium:
  - migration to schema 3: one "Revisão de transferências" (pairs, conversions, card payments) stored in settings,
    "Desfazer revisão" brings the old kinds back;
  - "Quem é você nos extratos?" (first-run card, confirm only) → Pix/Wise/TED in your name stop counting as income/spending;
  - "Transferências" sheet (Painel chip + Ajustes): pairs, accounts outside the app, conversions, suggestions
    (Confirmar / Não é transferência), monthly "Entre suas contas: R$ X";
  - editor "Tipo": Transferência entre minhas contas (account + counterpart row) / Pagamento de fatura (card);
  - triage "É transferência minha" → account picker → Desfazer;
  - data health: "Transferência sem entrada correspondente", extrato inside a card account;
  - a second synced page sees the names and the changes.
All data is SYNTHETIC (made-up people and companies).

Usage: npm run build:artifact && python3 test/e2e/e2e_v25.py [A] [S] [L] [R]
  A. Artifact build with the fake window.claude (fake claude db) — full flow at 390 light + a second page (1280 dark).
  S. 390 dark / 1280 light / 1280 dark screens (Painel card + chip, Transferências sheet, editor, triage picker).
  L. site/ in local mode (real store.js, localStorage): the flow at 390 light, 1280 dark screens.
  R. the user's real data (read-only snapshot through the fake db, when present): prints only counts; no screenshots.
Screenshots: screens/v25/*.png (gitignored)."""
import sys, os, json, re, time, glob, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import artifact_server  # noqa: E402
import server as site_server  # noqa: E402

PORT = int(os.environ.get('FF_V25_PORT', '8811'))
LPORT = int(os.environ.get('FF_V25_LOCAL_PORT', '8812'))
URL = f'http://127.0.0.1:{PORT}/'
LURL = f'http://127.0.0.1:{LPORT}/'
REAL_DB = os.environ.get('FF_REAL_ARTIFACT_DB', '/tmp/claude-0/-home-claude-financas-flow/b494ed90-56db-5b17-a31c-28396f0d7f79/scratchpad/db6/data/users/me/ff')
SCR = os.path.join(ROOT, 'screens', 'v25')
FAKE_JS = open(os.path.join(ROOT, 'test', 'fake-claude.js'), encoding='utf-8').read()
UID = 'u_e2e_v25'
BASE = f'data/users/{UID}/ff'
RUN = str(int(time.time()))
STAMP = '2026-10-01T12:00:00.000Z'
os.makedirs(SCR, exist_ok=True)
FAILS, PASSES = [], []
OWNER = 'Fulana Beltrana de Tal'


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


# ------------------------------------------------------------------------------------------------ synthetic data
def synthetic():
    txs = []

    def t(key, date, amount, raw, acc, imp, cat=None, src=None, **kw):
        row = {'id': 'v25-' + key, 'date': date, 'amount': amount, 'rawDescription': raw, 'merchant': raw.upper()[:40], 'accountId': acc,
               'kind': kw.pop('kind', 'expense' if amount < 0 else 'income'), 'categoryId': cat, 'catSource': src if src else ('rule' if cat else None),
               'importId': imp, 'updatedAt': STAMP}
        row.update(kw)
        txs.append(row)
    # a pair between two of your accounts (each side names the other bank) → paired by the migration
    t('gout', '2026-09-10', -25000, 'Pix enviado - MERCADO PAGO', 'roxo', 'i-roxo')
    t('gin', '2026-09-10', 25000, 'Transferência recebida - NU PAGAMENTOS', 'azul', 'i-azul')
    # a currency conversion inside the multi-currency account → transfer (conversion)
    t('conv', '2026-09-08', -108222, '1.082,22 BRL convertidos para 200,00 USD', 'wise', 'i-wise')
    # a card payment worded differently → card_payment linked to the card
    t('cp', '2026-09-13', -80000, 'Débito para pagar sua fatura Nubank', 'roxo', 'i-roxo')
    # your own name, no account in the app on the other side (counted as income / spending until you say who you are)
    t('ownin', '2026-09-15', 70000, f'Recebeu dinheiro de {OWNER} com a referência ""', 'wise', 'i-wise')
    t('ownout', '2026-09-18', -40000, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - BCO SANTANDER (BRASIL) S.A. (0033)', 'roxo', 'i-roxo')
    t('ownout2', '2026-09-20', -31000, 'Enviou dinheiro para FULANA B DE TAL', 'wise', 'i-wise')
    # to your XP account, which IS in the app and covers those days, but has no entry → data health
    t('noxp', '2026-09-03', -60000, 'Transferência enviada pelo Pix - FULANA BELTRANA DE TAL - •••.123.456-•• - Banco XP S.A. (0102)', 'roxo', 'i-roxo')
    t('xp1', '2026-09-01', 10, 'Rendimento automático', 'xp', 'i-xp')
    t('xp2', '2026-09-29', 12, 'Rendimento automático', 'xp', 'i-xp')
    # salary and a relative (same surname): never transfers
    t('salary', '2026-09-05', 500000, 'TED recebida de ACME TECNOLOGIA LTDA', 'azul', 'i-azul', 'renda.salario')
    t('relative', '2026-09-07', -20000, 'Pix enviado para Ciclano Beltrano de Tal', 'roxo', 'i-roxo')
    # medium confidence → suggestions (one confirmed, one rejected)
    t('sout', '2026-09-21', -30000, 'Transferência enviada', 'roxo', 'i-roxo')
    t('sin', '2026-09-22', 30000, 'Transferência recebida', 'azul', 'i-azul')
    t('sout2', '2026-09-24', -12345, 'Transferência enviada', 'azul', 'i-azul')
    t('sin2', '2026-09-24', 12345, 'Transferência recebida', 'wise', 'i-wise')
    # editor targets
    t('eout', '2026-09-25', -15000, 'COMPRA LOJA EXEMPLO', 'roxo', 'i-roxo')
    t('ein', '2026-09-26', 15000, 'CREDITO EM CONTA', 'azul', 'i-azul')
    t('deb', '2026-09-26', -9000, 'DEBITO AUTOMATICO 4455', 'roxo', 'i-roxo')
    # triage target (the newest row without a category)
    t('tri', '2026-09-28', -5000, 'Pix enviado para Beltrano Souza', 'roxo', 'i-roxo')
    # real spending
    t('shop', '2026-09-11', -4590, 'PADARIA DO BAIRRO', 'roxo', 'i-roxo', 'alimentacao.padaria')
    t('card1', '2026-09-04', -12000, 'MERCADO CENTRAL', 'card', 'i-fat', 'alimentacao.mercado')
    t('card2', '2026-09-06', -8000, 'LOJA DE ROUPAS', 'card', 'i-fat', 'compras.vestuario')
    # a bank statement imported into the card account (salary + names, no balance) → data health
    t('bad1', '2026-07-05', 900000, 'Acme Consultoria em Tecnologia Ltda', 'card', 'i-bad', 'renda.salario')
    t('bad2', '2026-08-05', 900000, 'Acme Consultoria em Tecnologia Ltda', 'card', 'i-bad', 'renda.salario')
    t('bad3', '2026-08-09', 12000, 'Beltrano Souza', 'card', 'i-bad')
    t('bad4', '2026-08-10', -5000, 'Padaria do Bairro', 'card', 'i-bad')

    def rec(i, fn, acc, **kw):
        rows = [r for r in txs if r['importId'] == i]
        ds = sorted(r['date'] for r in rows)
        out = {'id': i, 'fileName': fn, 'at': '2026-10-01T10:00:00Z', 'updatedAt': STAMP, 'accountId': acc, 'count': len(rows), 'total': sum(r['amount'] for r in rows), 'from': ds[0], 'to': ds[-1]}
        out.update(kw)
        return out
    meta = {
        'accounts': {'items': [{'id': 'card', 'name': 'Nubank Crédito', 'type': 'credit_card'}, {'id': 'roxo', 'name': 'Nubank Corrente', 'type': 'checking'},
                               {'id': 'azul', 'name': 'Mercado Pago Corrente', 'type': 'checking'}, {'id': 'wise', 'name': 'Wise', 'type': 'checking'},
                               {'id': 'xp', 'name': 'XP Corrente', 'type': 'checking'}]},
        'imports': {'i-roxo': rec('i-roxo', 'nu-conta-2026-09.csv', 'roxo'), 'i-azul': rec('i-azul', 'mp-2026-09.csv', 'azul'),
                    'i-wise': rec('i-wise', 'statement_BRL_2026-09.csv', 'wise', holderName='FULANA B DE TAL'), 'i-xp': rec('i-xp', 'xp-extrato-2026-09.csv', 'xp'),
                    'i-fat': rec('i-fat', 'fatura-nubank-2026-09.csv', 'card'), 'i-bad': rec('i-bad', 'Extrato_2026-07-01_a_2026-09-30.xlsx', 'card')},
        'settings': {'budgets': {}, 'schemaVersion': 2, 'updatedAt': STAMP},
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


def db_meta(ns, name):
    return (artifact_server.docs(ns).get(f'{BASE}/v2meta/{name}') or {}).get('data', {}).get('data')


def db_month(ns, ym):
    d = (artifact_server.docs(ns).get(f'{BASE}/v2months/{ym}') or {}).get('data') or {}
    return {r['id']: r for r in (d.get('transactions') or [])}


def stored_settings(pg, ns):
    if ns:
        return db_meta(ns, 'settings') or {}
    return J(pg, '() => { const d = JSON.parse(localStorage.getItem("ff2:local") || "{}"); return ((d.meta || {}).settings) || {}; }') or {}


def stored_tx(pg, ns, tid):
    if ns:
        for ym in ('2026-07', '2026-08', '2026-09'):
            r = db_month(ns, ym).get(tid)
            if r:
                return r
        return {}
    return J(pg, '(id) => { const d = JSON.parse(localStorage.getItem("ff2:local") || "{}"); for (const rows of Object.values(d.months || {})) { const r = rows.find(x => x.id === id); if (r) return r; } return {}; }', tid) or {}


def new_ctx(b, scheme, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, body='/* stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
    ctx.route(re.compile(r'https://cdnjs\.cloudflare\.com/.*'), lambda r: r.fulfill(status=200, body='/* stub */', content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
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
    pg.wait_for_timeout(400)
    return ctx, pg


def open_local(b, meta, txs, scheme='light', w=390, h=844):
    ctx = new_ctx(b, scheme, w, h)
    pg = ctx.new_page()
    attach(pg)
    pg.goto(LURL)
    pg.wait_for_function('() => window.__ff && window.__ff.state().booted', timeout=15000)
    J(pg, 'async (b) => { await __ff.store().importAll(b); }', {'version': 2, 'meta': meta, 'months': by_month(txs)})
    reload(pg)
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


def row(pg, key):
    return J(pg, '(id) => __ff.live().find(t => t.id === id) || null', 'v25-' + key)


def close_sheet(pg):
    if pg.is_visible('.sheet'):
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)


def kpi(pg, name):
    return int(pg.get_attribute(f'#kpi-{name}', 'data-cents'))


def open_transfers(pg, via='chip'):
    close_sheet(pg)
    if via == 'chip':
        goto_tab(pg, 'painel'); pg.click('#pn-tr')
    else:
        pg.click('#btn-settings'); pg.wait_for_selector('#btn-transfers'); pg.click('#btn-transfers')
    pg.wait_for_selector('#tr-body #tr-sum')


def open_editor(pg, key):
    close_sheet(pg)
    goto_tab(pg, 'tx')
    r = row(pg, key)
    pg.fill('#tx-search', r['rawDescription'][:14]); pg.wait_for_timeout(300)
    pg.click(f'#tx-list .tx[data-id="v25-{key}"]'); pg.wait_for_selector('#ed-kind')


# ------------------------------------------------------------------------------------------------ flows
def flow_migration(pg, tag, ns):
    section(f'{tag} 1. migration to schema 3: one transfer review, high confidence only')
    st = stored_settings(pg, ns)
    rv = st.get('transferReview') or {}
    check(st.get('schemaVersion') == J(pg, '() => FinEngine.SCHEMA_VERSION') == 3, f'{tag}: schemaVersion 3 saved')
    check((rv.get('rows') or {}).get('pair') == 2 and rv['rows'].get('conversion') == 1 and rv['rows'].get('card_payment') == 1, f'{tag}: review stored (pair 2, conversion 1, card payment 1): {rv.get("rows")}')
    check(not (rv.get('rows') or {}).get('own_name'), f'{tag}: no own-name change before you confirm your name')
    check(row(pg, 'gout')['kind'] == 'transfer' and row(pg, 'gout')['linkedTo'] == 'v25-gin' and row(pg, 'gin')['transferAccountId'] == 'roxo', f'{tag}: pair linked both ways')
    check(row(pg, 'conv')['transferSubtype'] == 'conversion', f'{tag}: "BRL convertidos para USD" → conversion')
    check(row(pg, 'cp')['kind'] == 'card_payment' and row(pg, 'cp')['cardAccountId'] == 'card', f'{tag}: "Débito para pagar sua fatura" → card payment of the Nubank card')
    check(row(pg, 'salary')['kind'] == 'income' and row(pg, 'relative')['kind'] == 'expense', f'{tag}: salary and a relative untouched')
    check(stored_tx(pg, ns, 'v25-conv').get('kind') == 'transfer', f'{tag}: changes saved to the store')
    # health: extrato inside the card account
    check(J(pg, '() => __ff.health().some(w => w.id === "b:extrato-in-card:i-bad")'), f'{tag}: data health flags the extrato inside the card')


def flow_who(pg, tag, ns):
    section(f'{tag} 2. "Quem é você nos extratos?" → your name; Pix in your name stop counting as income/spending')
    goto_tab(pg, 'painel')
    check(pg.is_visible('#who-painel'), f'{tag}: first-run card on the Painel')
    boxes = J(pg, '() => [...document.querySelectorAll("#who-painel [data-who]")].map(i => [i.checked, i.closest("label").innerText])')
    check(boxes and boxes[0][0] and 'Fulana' in boxes[0][1], f'{tag}: your name pre-ticked (holder name of the Wise file)')
    check(not any(b[0] and 'Ciclano' in b[1] for b in boxes), f'{tag}: a relative is never pre-ticked')
    pg.locator('#who-painel').scroll_into_view_if_needed()
    shot(pg, f'{tag}-who-card')
    inc0, exp0 = kpi(pg, 'income'), kpi(pg, 'expense')
    pg.click('#who-confirm-painel'); pg.wait_for_timeout(400)
    flushed(pg)
    names = stored_settings(pg, ns).get('ownerNames') or []
    check(any('Fulana' in n for n in names), f'{tag}: ownerNames saved in the synced settings ({len(names)} variants)')
    for k in ('ownin', 'ownout', 'ownout2'):
        r = row(pg, k)
        check(r['kind'] == 'transfer' and r.get('transferAccountId') == 'external', f'{tag}: {k} → transfer to an account outside the app')
    # your name at XP, where you HAVE an account in the app (no arrival there): that account, not "Conta não cadastrada"
    r = row(pg, 'noxp')
    check(r['kind'] == 'transfer' and r.get('transferAccountId') == 'xp' and not r.get('linkedTo'), f'{tag}: noxp → transfer to your XP account (no pair)')
    check(row(pg, 'relative')['kind'] == 'expense' and row(pg, 'salary')['kind'] == 'income', f'{tag}: relative + salary still expense/income')
    goto_tab(pg, 'painel')
    inc1, exp1 = kpi(pg, 'income'), kpi(pg, 'expense')
    check(inc0 - inc1 == 70000, f'{tag}: Entradas fell by exactly the money from your own name ({inc0 - inc1})')
    check(exp0 - exp1 == 40000 + 31000 + 60000, f'{tag}: Saídas fell by exactly the money to your own name ({exp0 - exp1})')
    check(not pg.is_visible('#who-painel'), f'{tag}: the card is gone')
    h = J(pg, '() => __ff.health().filter(w => w.id.startsWith("m:nopair:")).map(w => w.title)')
    check(h == ['Transferência sem entrada correspondente'], f'{tag}: "Transferência sem entrada correspondente" for the money sent to XP ({h})')


def flow_sheet(pg, tag, ns):
    section(f'{tag} 3. Transferências: pairs, outside the app, conversions, suggestions, "Desfazer revisão"')
    goto_tab(pg, 'painel')
    total = int(pg.get_attribute('#pn-tr-total', 'data-cents'))
    exp_total = J(pg, '() => FinEngine.transferOverview(__ff.live(), { accounts: __ff.D().accounts, from: "2026-09-01", to: "2026-09-30" }).total')
    check(total == exp_total and total > 0, f'{tag}: Painel chip "Entre suas contas" = {total}')
    open_transfers(pg)
    check('Nubank Corrente → Mercado Pago Corrente' in pg.inner_text('#tr-pairs'), f'{tag}: the pair listed with both accounts')
    check(pg.is_visible('#tr-ext') and 'Santander' in pg.inner_text('#tr-ext'), f'{tag}: accounts outside the app grouped by bank')
    check(pg.is_visible('#tr-conv'), f'{tag}: conversions listed')
    sugs = J(pg, '() => [...document.querySelectorAll("#tr-sugs .tr-sug")].map(e => e.dataset.key)')
    check(len(sugs) == 2, f'{tag}: two suggestions to confirm ({len(sugs)})')
    no_hscroll(pg, f'{tag} transfers sheet')
    shot(pg, f'{tag}-transfers', full=False)
    k1 = J(pg, '() => [...document.querySelectorAll("#tr-sugs .tr-sug")].find(e => e.innerText.includes("Nubank Corrente → Mercado Pago")).dataset.key')
    k2 = [k for k in sugs if k != k1][0]
    pg.click(f'#tr-sugs [data-act="tr-confirm"][data-key="{k1}"]'); pg.wait_for_timeout(300)
    check(row(pg, 'sout')['kind'] == 'transfer' and row(pg, 'sout')['linkedTo'] == 'v25-sin' and row(pg, 'sin')['catSource'] == 'manual', f'{tag}: Confirmar → pair linked (manual)')
    pg.click(f'#tr-sugs [data-act="tr-reject"][data-key="{k2}"]'); pg.wait_for_timeout(300)
    flushed(pg)
    check(k2 in (stored_settings(pg, ns).get('transferRejected') or []), f'{tag}: "Não é transferência" remembered in the synced settings')
    check(not pg.is_visible('#tr-sugs'), f'{tag}: no suggestion left')
    check(row(pg, 'sin2')['kind'] == 'income', f'{tag}: the rejected pair stays as it was')
    # Desfazer revisão
    pg.locator('#tr-review').scroll_into_view_if_needed()
    pg.click('#tr-review-undo'); pg.wait_for_timeout(400)
    check(row(pg, 'conv')['kind'] == 'expense' and not row(pg, 'conv').get('transferSubtype'), f'{tag}: Desfazer revisão → the conversion is back to a spending')
    check(row(pg, 'gout')['kind'] == 'expense' and not row(pg, 'gout').get('linkedTo'), f'{tag}: …and the pair unlinked')
    flushed(pg)
    st = stored_settings(pg, ns)
    check((st.get('transferReview') or {}).get('undone'), f'{tag}: review marked as undone (synced)')
    check('desfeita' in pg.inner_text('#tr-review'), f'{tag}: the sheet says it was undone')
    trd = J(pg, '() => { const d = __ff.D(); return FinEngine.detectTransfers(__ff.live(), { accounts: d.accounts, settings: d.settings }).changes.map(c => c.id); }')
    check('v25-conv' not in trd and 'v25-gout' not in trd, f'{tag}: undone rows are not proposed again')


def flow_editor(pg, tag, ns):
    section(f'{tag} 4. editor "Tipo": Transferência entre minhas contas (+ counterpart) / Pagamento de fatura')
    open_editor(pg, 'eout')
    opts = J(pg, '() => [...document.querySelectorAll("#ed-kind option")].map(o => o.textContent)')
    check(opts == ['Gasto', 'Entrada', 'Transferência entre minhas contas', 'Pagamento de fatura', 'Investimento'], f'{tag}: Tipo options in plain pt-BR')
    pg.select_option('#ed-kind', 'transfer'); pg.wait_for_timeout(100)
    check(pg.is_visible('#ed-tr-acc'), f'{tag}: account picker shows')
    accs = J(pg, '() => [...document.querySelectorAll("#ed-tr-acc option")].map(o => o.textContent)')
    check('Conta não cadastrada' in accs and 'Nubank Crédito' not in accs, f'{tag}: picker = your other accounts + "Conta não cadastrada"')
    pg.select_option('#ed-tr-acc', 'azul'); pg.wait_for_timeout(150)
    check(pg.locator('input[name="ed-tr-pair"][value="v25-ein"]').count() == 1, f'{tag}: the likely counterpart row offered')
    pg.check('input[name="ed-tr-pair"][value="v25-ein"]')
    pg.locator('#ed-tr').scroll_into_view_if_needed()
    no_hscroll(pg, f'{tag} editor')
    shot(pg, f'{tag}-editor-transfer')
    pg.click('[data-act="savetx"]'); pg.wait_for_timeout(300)
    a, b_ = row(pg, 'eout'), row(pg, 'ein')
    check(a['kind'] == 'transfer' and a['linkedTo'] == 'v25-ein' and a['transferAccountId'] == 'azul' and b_['linkedTo'] == 'v25-eout' and b_['kind'] == 'transfer', f'{tag}: both rows are a linked transfer')
    pg.wait_for_selector('#toast-act'); pg.click('#toast-act'); pg.wait_for_timeout(300)
    check(row(pg, 'eout')['kind'] == 'expense' and row(pg, 'ein')['kind'] == 'income' and not row(pg, 'ein').get('linkedTo'), f'{tag}: Desfazer → both back')
    # again, kept (the second page checks it)
    open_editor(pg, 'eout')
    pg.select_option('#ed-kind', 'transfer'); pg.select_option('#ed-tr-acc', 'azul'); pg.wait_for_timeout(150)
    pg.check('input[name="ed-tr-pair"][value="v25-ein"]'); pg.click('[data-act="savetx"]'); pg.wait_for_timeout(300)
    # Pagamento de fatura
    open_editor(pg, 'deb')
    pg.select_option('#ed-kind', 'card_payment'); pg.wait_for_timeout(100)
    check(pg.is_visible('#ed-card') and not pg.is_visible('#ed-tr-acc'), f'{tag}: card picker instead of the account picker')
    pg.select_option('#ed-card', 'card'); pg.click('[data-act="savetx"]'); pg.wait_for_timeout(300)
    r = row(pg, 'deb')
    check(r['kind'] == 'card_payment' and r['cardAccountId'] == 'card', f'{tag}: Pagamento de fatura of Nubank Crédito')
    # a manual choice wins over the detection
    trd = J(pg, '() => { const d = __ff.D(); return FinEngine.detectTransfers(__ff.live(), { accounts: d.accounts, settings: d.settings }).changes.map(c => c.id); }')
    check(not any(x in trd for x in ('v25-eout', 'v25-ein', 'v25-deb')), f'{tag}: manual choices are never changed by the detection')
    flushed(pg)
    check(stored_tx(pg, ns, 'v25-ein').get('linkedTo') == 'v25-eout', f'{tag}: saved')


def flow_triage(pg, tag):
    section(f'{tag} 5. triage "É transferência minha" → account → Desfazer')
    close_sheet(pg)
    goto_tab(pg, 'painel')
    pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-transfer')
    for _ in range(12):
        if 'Beltrano Souza' in pg.inner_text('#triage-root'):
            break
        pg.click('[data-act="tri-skip"]'); pg.wait_for_timeout(120)
    check('Beltrano Souza' in pg.inner_text('#triage-root'), f'{tag}: the row is in the queue')
    check(pg.inner_text('#tri-transfer').strip() == 'É transferência minha', f'{tag}: button reads "É transferência minha"')
    pg.uncheck('#tri-remember')
    pg.click('#tri-transfer'); pg.wait_for_selector('#tri-tr-accs')
    btns = J(pg, '() => [...document.querySelectorAll("#tri-tr-accs .tri-btn")].map(b => b.innerText.split("\\n")[0])')
    check('Conta não cadastrada' in btns and 'Mercado Pago Corrente' in btns and 'Nubank Crédito' not in btns, f'{tag}: quick account picker ({len(btns)} choices)')
    no_hscroll(pg, f'{tag} triage picker')
    shot(pg, f'{tag}-triage-picker')
    pg.click('#tri-tr-ext'); pg.wait_for_timeout(300)
    r = row(pg, 'tri')
    check(r['kind'] == 'transfer' and r['transferAccountId'] == 'external', f'{tag}: marked as transfer to an account outside the app')
    pg.click('#tri-undo'); pg.wait_for_timeout(300)
    check(row(pg, 'tri')['kind'] == 'expense', f'{tag}: Desfazer → back')
    pg.click('.tri-top [data-act="tri-close"]')
    pg.wait_for_timeout(200)


def flow_second_page(b, ns, A):
    section('A 6. a second page (1280 dark): names + changes arrive; no first-run card there')
    cb, B = open_artifact(b, ns, 'dark', 1280, 900)
    check(any('Fulana' in n for n in J(B, '() => __ff.D().settings.ownerNames || []')), 'B: your names are there')
    check(not B.is_visible('#who-painel'), 'B: no "Quem é você" card')
    check(J(B, '() => __ff.live().find(t => t.id === "v25-ein").linkedTo') == 'v25-eout', 'B: the pair made in the editor')
    # A marks one more row; B sees it without reloading
    open_editor(A, 'tri')
    A.select_option('#ed-kind', 'transfer'); A.select_option('#ed-tr-acc', 'external'); A.click('[data-act="savetx"]'); A.wait_for_timeout(200)
    flushed(A)
    J(B, '() => window.dispatchEvent(new Event("focus"))')
    ok = wait(B, '() => (__ff.live().find(t => t.id === "v25-tri") || {}).kind === "transfer"', 25000)
    check(ok, 'B: the change arrives (sync)')
    goto_tab(B, 'painel')
    check(B.is_visible('#pn-tr'), 'B: Painel chip')
    open_transfers(B, via='settings')
    no_hscroll(B, 'B transfers 1280 dark')
    shot(B, 'art-1280-dark-B-transfers')
    check(not B._errs, f'B: no console errors {B._errs[:3]}')
    cb.close()


def screens(pg, tag):
    goto_tab(pg, 'painel')
    check(pg.is_visible('#who-painel') and pg.is_visible('#pn-tr'), f'{tag}: Painel shows the card and the chip')
    no_hscroll(pg, f'{tag} painel')
    shot(pg, f'{tag}-painel')
    pg.locator('#who-painel').scroll_into_view_if_needed()
    shot(pg, f'{tag}-who-card')
    pg.click('#who-confirm-painel'); pg.wait_for_timeout(300)
    open_transfers(pg)
    no_hscroll(pg, f'{tag} transfers')
    shot(pg, f'{tag}-transfers')
    open_editor(pg, 'eout')
    pg.select_option('#ed-kind', 'transfer'); pg.select_option('#ed-tr-acc', 'azul'); pg.wait_for_timeout(150)
    pg.locator('#ed-tr').scroll_into_view_if_needed()
    no_hscroll(pg, f'{tag} editor')
    shot(pg, f'{tag}-editor-transfer')
    close_sheet(pg)
    goto_tab(pg, 'painel')
    pg.click('#triage-banner [data-act="triage"]'); pg.wait_for_selector('#tri-transfer')
    pg.click('#tri-transfer'); pg.wait_for_selector('#tri-tr-accs')
    no_hscroll(pg, f'{tag} triage')
    shot(pg, f'{tag}-triage-picker')
    pg.click('[data-act="tri-tr-back"]')
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')


# ------------------------------------------------------------------------------------------------ scenarios
def scenario_artifact(b):
    section('A. Artifact build (fake claude.ai db), synthetic data, 390 light')
    meta, txs = synthetic()
    ns = 'v25a' + RUN
    seed_artifact(ns, meta, by_month(txs))
    ctx, pg = open_artifact(b, ns)
    check(J(pg, '() => __ff.state().auth.mode') == 'artifact', 'artifact mode')
    flushed(pg)
    tag = 'art-390-light'
    flow_migration(pg, tag, ns)
    flow_who(pg, tag, ns)
    flow_sheet(pg, tag, ns)
    flow_editor(pg, tag, ns)
    flow_triage(pg, tag)
    flow_second_page(b, ns, pg)
    # reload: everything persisted
    reload(pg)
    check(row(pg, 'ownin')['kind'] == 'transfer' and row(pg, 'ein')['linkedTo'] == 'v25-eout' and row(pg, 'conv')['kind'] == 'expense', 'A after reload: names, pairs and the undone review persisted')
    check(J(pg, '() => __ff.D().settings.schemaVersion') == 3 and not J(pg, '() => __ff.D().settings.transferReview.changes.length === 0'), 'A after reload: the review ran once (not again)')
    check(not pg._errs, f'no console errors {pg._errs[:3]}')
    ctx.close()


def scenario_screens(b):
    meta, txs = synthetic()
    for (w, scheme) in ((390, 'dark'), (1280, 'light'), (1280, 'dark')):
        tag = f'art-{w}-{scheme}'
        section(tag)
        ns = f'v25s{w}{scheme}' + RUN
        seed_artifact(ns, meta, by_month(txs))
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        screens(pg, tag)
        ctx.close()


def scenario_local(b):
    section('L. site/ in local mode (real store.js, localStorage), synthetic data, 390 light')
    meta, txs = synthetic()
    ctx, pg = open_local(b, meta, txs)
    check(J(pg, '() => __ff.state().auth.mode') == 'local', 'local mode')
    flushed(pg)
    tag = 'loc-390-light'
    flow_migration(pg, tag, None)
    flow_who(pg, tag, None)
    flow_sheet(pg, tag, None)
    flow_editor(pg, tag, None)
    flow_triage(pg, tag)
    reload(pg)
    check(row(pg, 'ownin')['kind'] == 'transfer' and row(pg, 'ein')['linkedTo'] == 'v25-eout', f'{tag}: after reload everything persisted')
    check(not pg._errs, f'{tag}: no console errors {pg._errs[:3]}')
    ctx.close()
    section('L. local mode 1280 dark screens')
    ctx, pg = open_local(b, meta, txs, 'dark', 1280, 900)
    screens(pg, 'loc-1280-dark')
    ctx.close()


def scenario_real(b):
    section("R. the user's real data (read-only snapshot through the fake db): counts only, no screenshots")
    if not os.path.isdir(os.path.join(REAL_DB, 'v2meta')):
        print('  skip (no snapshot at FF_REAL_ARTIFACT_DB)')
        return
    meta = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2meta', '*.json'))}
    months = {os.path.basename(f)[:-5]: json.load(open(f, encoding='utf-8')) for f in glob.glob(os.path.join(REAL_DB, 'v2months', '*.json'))}
    n = sum(len([t for t in d.get('transactions', []) if not t.get('deleted')]) for d in months.values())
    for (w, scheme) in ((390, 'light'), (1280, 'dark')):
        ns = f'v25real{w}{scheme}' + RUN
        seed_artifact(ns, meta, months, raw_docs=True)
        ctx, pg = open_artifact(b, ns, scheme, w, 900)
        tag = f'real-{w}-{scheme}'
        check(J(pg, '() => __ff.live().length') == n, f'{tag}: all {n} rows loaded')
        rv = J(pg, '() => (__ff.D().settings.transferReview || {}).rows || {}')
        print(f'  review rows by reason: {json.dumps(rv)}')
        check(not rv.get('own_name'), f'{tag}: nothing changed by name before you confirm one')
        cands = J(pg, '() => [...document.querySelectorAll("#who-painel [data-who]")].map(i => i.checked)')
        print(f'  "Quem é você" candidates: {len(cands)}, pre-ticked: {sum(1 for c in cands if c)}')
        check(len(cands) >= 1, f'{tag}: first-run card offers candidates')
        check(J(pg, '() => __ff.health().some(w => w.id.startsWith("b:extrato-in-card:"))'), f'{tag}: the extrato inside the card account is flagged')
        inc0 = kpi(pg, 'income')
        if cands:
            pg.click('#who-confirm-painel'); pg.wait_for_timeout(500)
            ext = J(pg, '() => __ff.live().filter(t => t.kind === "transfer" && t.transferAccountId === "external").length')
            print(f'  after confirming: transfers to accounts outside the app: {ext}; income of the month changed {kpi(pg, "income") - inc0:+d} cents' if False else f'  after confirming: transfers to accounts outside the app: {ext}')
        goto_tab(pg, 'painel')
        open_transfers(pg)
        no_hscroll(pg, f'{tag} transfers')
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
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    for f in FAILS:
        print('  FAIL', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
