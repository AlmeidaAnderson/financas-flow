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
      with a CNPJ in the description → "Consultar CNPJ" (Netlify: activity + category chip; Artifact: company page,
      now cnpj.biz (v2.4a), then paste the activity / page text into "Colar atividade ou CNAE" → chip). Nothing is categorized until you tap a chip.
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

## v2.2 (4 features) — 10 min
- [ ] **Vários arquivos**: Importar → escolha 3 faturas + 1 extrato de uma vez (ou arraste no PC). Cada um mostra layout,
      tipo (fatura/extrato), período, linhas, erros, duplicados e a conta. Ponha o extrato no cartão → aviso vermelho
      "Conta errada?" → "Usar …"/"Criar conta corrente". Layout novo → "Configurar" → volta à lista. "Importar N arquivos"
      → resumo por arquivo + "N para triagem". Parcela n+1 da fatura seguinte não vira duplicada.
- [ ] **Gastos por categoria**: Painel → troque Gráfico (empilhadas, 100%, agrupadas, linhas, mapa de calor), Semana/Mês/
      Trimestre/Ano, Períodos, Grupos/Categorias; toque na legenda para esconder; toque numa barra → lançamentos.
      Recarregue (e abra no celular): a última escolha volta.
- [ ] **Não sei o que é**: na triagem → sai da fila de vez (recarregue); Desfazer funciona; aparece como "Não identificado"
      no gráfico e no filtro de Transações.
- [ ] **Barra do mês fixa**: role o Painel → mês e período ficam presos sob o cabeçalho (compactos no celular).
- Automated: `npm test` (test/engine_v22.test.js) and `python3 test/e2e/e2e_v22.py` (Artifact + local mode, 390/1280,
  light/dark; read-only run on the real snapshot when present; scenario X = review regressions: two devices changing the
  chart at once, refunds netting a category negative, labels at 390, re-importing files, a moved category). Screenshots: `screens/v22/`.

## File pickers on phones
- [ ] On a phone: "Escolher arquivos" opens the picker; bank CSVs are not greyed out; "Importar backup" works.
- [ ] Paste a CSV in "Ou cole o conteúdo do arquivo" → import → "Colar outro arquivo" → paste the next one.
- Automated: `python3 test/e2e/e2e_mobile.py` (WebView / Android / desktop UAs at 390 px; screenshots in `screens/mobile/`).

## v2.3 — Alertas de atualização (5 min)
- [ ] Ajustes → Contas e importações → seu cartão → **Alertas de atualização** → "Sugerir pelos dados" → confira os dias
      (nada é salvo antes de **Salvar**) → Salvar.
- [ ] Depois do fechamento: o sino no topo mostra o número de alertas; o Painel mostra "Fatura fechou em dd/mm · cartão".
      Toque → "Importar agora" abre Importar com o cartão escolhido → importe a fatura → o alerta some.
- [ ] "Fechou em outra data" (dd/mm/aaaa) muda só aquele ciclo; o × na conta volta ao dia normal.
- [ ] "Já importei / Ignorar este ciclo" → recarregue e abra no celular: continua ignorado.
- [ ] Conta corrente → "Lembrar de atualizar": Toda semana / A cada 15 dias / Todo mês (dia) / Nunca.
- Automated: `npm test` (test/engine_v23.test.js) and `python3 test/e2e/e2e_v23.py` (relógio fixo em 03/10/2026; Artifact +
  local mode, 390/1280, light/dark; segunda página sincronizada; leitura somente do snapshot real quando presente — só
  imprime os dias sugeridos). Screenshots: `screens/v23/`.

## v2.4a — conta única no lote, CNPJ legível, Gerenciar dados (10 min)
- [ ] **Vários arquivos**: Importar → escolha 3 arquivos → no topo, "Conta para todos os arquivos" → "+ Nova conta…" →
      nome + tipo → Criar: todos os arquivos seguem. Num arquivo, "Alterar só este" → outra conta; "Voltar ao padrão" volta.
      Escolha "+ Nova conta" com o mesmo nome em outro arquivo → usa a mesma (não cria outra). Um extrato com a conta de
      todos sendo cartão → vai sozinho para a conta corrente (aviso azul) ou mostra o aviso vermelho com o conserto.
      Importar → só UMA conta nova criada.
- [ ] **CNPJ** (Artifact): "Consultar CNPJ" abre cnpj.biz (página legível); "Outra fonte" abre o Google. Copie a página
      (ou só a atividade principal) e cole em "Colar atividade ou CNAE" → chip da categoria. Netlify: o resultado aparece
      como um cartão (razão social, nome fantasia, atividade, cidade/UF), nunca JSON.
- [ ] **Gerenciar dados** (Ajustes, ou Contas e importações → Importações): excluir um arquivo (e "todas as importações
      deste arquivo"), um mês (todas as contas ou uma), uma conta (ou só os lançamentos dela). Antes de excluir aparecem
      lançamentos, meses e soma; depois, "Desfazer" no aviso (e no topo de Gerenciar dados).
- [ ] **Transações → Selecionar**: marque linhas ou "Todos do filtro" → "Mudar categoria" / "Excluir selecionados" → Desfazer.
- [ ] Abra no celular: o que foi excluído não aparece, nem depois de editar algo do mesmo mês no celular.
- Automated: `npm test` (test/engine_v24a.test.js) and `python3 test/e2e/e2e_v24a.py` (Artifact + fake db at 390 light full
  flow incl. a second, stale page and a whole month emptied → Desfazer after the save; 390 dark / 1280 light / 1280 dark
  screens; local mode 390 light full flow + 1280 dark; plans checked on the real snapshot when present — prints only counts;
  Netlify build with /api/cnpj mocked, CSP on).
  Screenshots: `screens/v24a/`.

## v2.4b — PDF e moedas estrangeiras (10 min)
- [ ] Importar → escolha a fatura em PDF → "Lendo PDF… página x de y" → Detecção mostra tipo, vencimento, compras do
      ciclo, total e "✓ total bate"; abra "Ignorado: …" e confira que resumo, ofertas de parcelamento e próximas faturas
      ficaram de fora. Conferência: tabela com a Seção de cada linha; total já preenchido.
- [ ] Cartão sem dia de fechamento → depois de importar: "Cartão configurado pela fatura".
- [ ] PDF com senha → campo "Senha do PDF" → senha errada avisa; certa abre (a senha não fica salva).
- [ ] PDF digitalizado (foto) → mensagem clara de que não tem texto.
- [ ] Vale (VA/VR): conta "Benefício (VA/VR)"; transferências entre carteiras = Transferência (somam zero); créditos =
      Renda › Benefícios; compras com a carteira (Refeição/Alimentação) e horário.
- [ ] Compras internacionais: selo "US$ 12,99" na linha, filtro "Moeda estrangeira", Painel "Compras internacionais".
- [ ] Conta só em moeda estrangeira: informe a cotação de cada mês na conferência; Ajustes → Cotações recalcula.
- [ ] Vários arquivos: PDFs e CSVs juntos na mesma lista.
- Automated: `npm test` (test/engine_v24b.test.js: synthetic item lists, the synthetic PDFs of test/fixtures/pdf via
  pdfjs-dist, and the two real PDFs when present at `FF_REAL_PDF_DIR` — only counts asserted) and
  `python3 test/e2e/e2e_v24b.py` (Artifact build under a CSP equal to the claude.ai allowlist — the sandbox cannot reach
  cdnjs, so the same pinned pdf.js files are served at the cdnjs URL by route interception —, 390/1280 light/dark, local
  mode with the vendored worker, Netlify harness with the real CSP, real samples when present — incl. re-import → all
  duplicates and a batch CSV + PDF into one shared account; scenario F = CDN fallback: cdnjs unreachable → the pinned
  jsDelivr files, both unreachable → pt-BR message, retry works). Fixtures: `python3 test/fixtures/pdf/make_pdfs.py`
  (reportlab; all data made up). Review fixtures from an independent generator (`make_pdfs_review.py`: "05 SET 2026"
  dates, US$ + EUR in an international section with "Dólar de conversão", amount before a "05.09.2026" date with C/D,
  descriptions wrapped to 2 lines, a two-column page) → `test/engine_v24b_review.test.js`. Screenshots: `screens/v24b/`.

## v2.5 — transferências entre suas contas (10 min)
- [ ] Painel → "Quem é você nos extratos?" → confira os nomes marcados (só você, nunca parentes) → Confirmar. Pix/Wise em
      seu nome somem de Entradas/Saídas; "Desfazer" no aviso volta tudo.
- [ ] Painel → "Entre suas contas: R$ X" → Transferências: pares entre contas, contas fora do app (por banco), conversões de
      moeda, "Para confirmar" (Confirmar / Não é transferência), "Revisão de transferências" → "Desfazer revisão".
- [ ] Transações → um lançamento → Tipo "Transferência entre minhas contas" → conta (ou "Conta não cadastrada") → escolha o
      outro lado → Salvar → os dois ficam ligados. Tipo "Pagamento de fatura" → escolha o cartão.
- [ ] Triagem → "É transferência minha" → toque na conta → Desfazer.
- [ ] Saúde dos dados: "Transferência sem entrada correspondente" e "Extrato bancário dentro de um cartão".
- Automated: `npm test` (test/engine_v25.test.js, synthetic; test/engine_v25_real.test.js on the real snapshot when present —
  prints only counts per reason and the monthly income/expense change %) and `python3 test/e2e/e2e_v25.py` (Artifact + fake
  db 390 light full flow + second synced page at 1280 dark; 390 dark / 1280 light / 1280 dark screens; local mode; real
  snapshot read-only, counts only, no screenshots). Screenshots: `screens/v25/`.

## v2.5 — revisão com a pasta de extratos real (5 min)
- [ ] Importar → escolha o ZIP baixado do banco (ou vários arquivos de uma vez): cada extrato de dentro vira uma linha da lista.
- [ ] Uma conta por moeda na carteira internacional (ex.: "Wise USD", "Wise CNY"): o extrato em USD vai sozinho para a conta em USD.
- [ ] Reimportar a pasta inteira → "Já importado: nada novo" em todos.
- [ ] Contas e importações → cartão → "Sugerir pelos dados": o fechamento sugerido bate com a fatura.
- Automated (runtime only, nothing about the files is stored or printed except counts): `FF_CORPUS_DIR=<pasta> node --test
  test/corpus.test.js` (every file vs the independent reader `test/corpus/reference.py`; import order; re-import; copies;
  transfers; monthly totals; data health; card days) and `npm run build:artifact && FF_CORPUS_DIR=<pasta> python3
  test/e2e/e2e_corpus.py` (one batch per institution in the Artifact build with the fake db, then the whole folder again).
  Synthetic regressions of each pattern: `test/engine_v25_corpus.test.js`.

## v2.6 — período em blocos e categoria em qualquer lançamento (5 min)
- [ ] Painel → 3m → ‹ volta 3 meses inteiros (jul–set → abr–jun); › avança 3; no mês atual o › fica apagado; perto do mês
      atual o › para no mês atual (ago–out, não set–nov). Mesmo com 6m e 12m. Mês continua de 1 em 1.
- [ ] Celular: role o Painel até a barra grudar no topo → ‹ › funcionam ali, o rótulo ("abr–jun/26") aparece inteiro e a
      tela não pula.
- [ ] Toque num bloco do fluxo → num lançamento → o editor abre por cima → Salvar → volta para a mesma lista, na mesma
      posição, já sem o lançamento (e o Painel atrás já mudou). Esc / Cancelar também voltam para a lista.
- [ ] Na lista, toque em "Sem categoria" → escolha grupo → categoria → pronto (com Lembrar, "+ Nova categoria", "Não sei o
      que é"); "Desfazer" no aviso traz de volta.
- [ ] O mesmo numa barra do gráfico de categorias e em Transferências (linhas e pares).
- [ ] Parcelas futuras: as parcelas previstas não abrem nada; o lápis abre a compra.
- [ ] Outro aparelho: a mudança aparece, e a lista aberta lá se atualiza.
- Automated: `npm run build:artifact && python3 test/e2e/e2e_v26.py` (Artifact + fake db at 390 light full flow + a second
  synced page at 1280 dark; 390 dark / 1280 light / 1280 dark screens; local mode 390 light flow + 1280 dark screens —
  stepping by 1/3/6/12, clamp, labels, aria, keyboard focus, sticky bar, every Painel sheet → editor/picker → sheet and
  Painel updated, scroll kept, projected parcelas not editable). Screenshots: `screens/v26/`.
