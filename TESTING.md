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

## v2.1 (5 features) — 10 min
- [ ] **Não sabe o que é?** In triage / the editor of an uncategorized spending: "Pesquisar no Google" opens a new tab;
      with a CNPJ in the description → "Consultar CNPJ" (Netlify: activity + category chip; Artifact: BrasilAPI page,
      then paste the CNAE or the whole answer into "Colar CNAE" → chip). Nothing is categorized until you tap a chip.
- [ ] **Parcelas**: classify one parcela of a Mercado Livre/Amazon purchase with "Lembrar" unticked → the other parcelas of
      THAT purchase get the category ("lembrado para esta compra (parcelas 3–10)"); another purchase at the same store
      does not. Desfazer removes it. Next month's fatura: the new parcela arrives already classified.
- [ ] **Déficit acumulado**: Painel shows "Déficit acumulado: R$ X (desde <mês>)" → tap → month by month. Ajustes →
      "Déficit entre meses": on/off, "Começar a contar em", "Mês incompleto — não transportar" (also in the ⋯ next to the month).
- [ ] **Lembrar**: unticking it for a category makes it start unticked next time for that category; ticking again
      undoes it. Mercado Livre/Amazon/Shopee start unticked.
- [ ] **Saúde dos dados** chip on the Painel → each warning has its button (Mover importação, Importar fatura de <mês>,
      Isto é você?, Marcar mês como completo, Ignorar aviso). Your current data: the bank extrato inside "Banco XP"
      (cartão) is flagged → "Mover importação" to a new Conta corrente.
- Automated: `npm test` (test/engine_v21.test.js + /api/cnpj in functions.test.mjs) and `python3 test/e2e/e2e_v21.py`
  (synthetic data in the Artifact build at 390/1280 light/dark, Netlify build CNPJ lookup under CSP, and a read-only
  run on the real artifact snapshot when present). Screenshots: `screens/v21/`.
