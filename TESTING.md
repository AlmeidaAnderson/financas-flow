# Test checklist (after deploy)

Do one block per sitting. Tick each line. If something fails, note **what you clicked** and **what you saw**, then tell Claude.

## 1. Login (5 min)
- [ ] Open the site on the PC → login screen appears (no data visible before login)
- [ ] Sign in with the invited email → app opens with example data banner
- [ ] Open the same site on the phone → sign in → "Adicionar à tela inicial" → opens like an app

## 2. Import your old data (5 min)
- [ ] PC: Ajustes → Importar backup → `backup-v1-para-v2.json`
- [ ] Painel shows your real months; salary appears as **income**, not spending
- [ ] Ajustes → Importações shows 2 imports
- [ ] Move the bank-statement import to a new account "Conta XP" (type: conta corrente)
- [ ] Delete the old card import

## 3. Re-import card bills (10 min)
- [ ] Importar → pick the oldest XP fatura → account "Credito XP" (cartão de crédito)
- [ ] Detection shows a **Parcela** column; preview shows "parcela 3/10" style badges
- [ ] Type the bill total in the checksum box → ✓
- [ ] Import the next month's fatura → parcela n+1 is **not** marked duplicate
- [ ] Painel → "Parcelas futuras" lists what is still to come

## 4. Classify (10-minute sprint 🎮)
- [ ] Classificar agora → classify with "Lembrar" ticked → other rows of that store update too
- [ ] Desfazer → the last choice comes back (also after Pular / É transferência)
- [ ] "+ Nova categoria" from the picker works
- [ ] When the queue is empty, the banner/badge disappear **without reloading**
- [ ] Change a category in Transações → Painel numbers change immediately

## 5. Sync PC ↔ phone (3 min)
- [ ] Change a category on the PC → within ~20 s (or when you switch back to the app) the phone shows it
- [ ] Phone in airplane mode → make a change → turn network on → PC receives it

## 6. Holerite (3 min)
- [ ] Type the date with the keyboard (e.g. 05102026) and with the calendar button
- [ ] Turn on Adiantamento 40% → two income entries; total income = gross

## 7. Filters
- [ ] Transações → Filtros: date range, min/max value, account, category → count badge → Limpar
- [ ] Change the sort order; default is newest first

## Test build inside claude.ai (no Netlify deploy)
- `npm run build:artifact` → `dist-artifact/financas-flow.html` (gitignored). Publish it as an Artifact with
  capabilities `{ db: {}, user: {}, downloads: {} }`; data lives in your private `data/users/<id>/` subtree.
- Automated: `npm test` (includes `test/store-artifact.test.mjs`) and `python3 test/e2e/e2e_artifact.py`
  (fake `window.claude`, screenshots in `screens/artifact/`).
