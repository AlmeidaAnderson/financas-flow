# Finanças Flow

App de finanças pessoais (funciona no computador e no celular, com os dados sincronizados).
Hospedado na **Netlify**, com o código no **GitHub**. Login e dados ficam na sua conta da Netlify.

> Leia um passo de cada vez. Cada passo é curto. Marque ✅ quando terminar.

---

## Parte A — GitHub (onde o código mora)

**A1.** Entre em <https://github.com> (crie uma conta se não tiver).

**A2.** No canto de cima, à direita, clique no **+** → **New repository**.

**A3.** Em **Repository name**, escreva: `financas-flow`

**A4.** Marque **Private**.

**A5.** **Não** marque nada em "Add a README", ".gitignore" ou "license". O repositório tem que nascer vazio.

**A6.** Clique no botão verde **Create repository**.

**A7.** Copie o endereço que aparece (algo como `https://github.com/SEU-USUARIO/financas-flow`) e mande para o Claude.

**A8.** O Claude envia o código para esse repositório. Espere ele avisar "enviado". ✅

---

## Parte B — Netlify (onde o app roda)

**B1.** Entre em <https://app.netlify.com> e clique em **Sign up** → **GitHub** (use a mesma conta do GitHub).

**B2.** No painel, clique em **Add new project** → **Import an existing project**.
(Em telas antigas o botão se chama **Add new site** → **Import from Git**. É a mesma coisa.)

**B3.** Clique em **GitHub**. Se pedir, clique em **Authorize** / **Install** e permita acesso ao repositório `financas-flow`.

**B4.** Escolha `financas-flow` na lista.

**B5.** Na tela de configuração **não mude nada** (o arquivo `netlify.toml` já diz tudo). Clique em **Deploy** / **Publish**.

**B6.** Espere 1–2 minutos até aparecer **Published**. Anote o endereço do site (algo como `https://nome-aleatorio.netlify.app`). ✅

> Dica: em **Project configuration → Change project name** dá para trocar o nome do endereço, por exemplo `financas-seunome.netlify.app`.

---

## Parte C — Login (Netlify Identity)

**C1.** No painel do seu projeto, no menu, clique em **Identity**.

**C2.** Clique em **Enable Identity**.

**C3.** Ainda em **Identity**, vá em **Registration** → **Registration preferences** → **Configure**.

**C4.** Escolha **Invite only** e clique em **Save**. (Assim ninguém consegue criar conta sozinho.) ✅

**C5.** Volte para **Identity** (aba **Users**) e clique em **Invite users**.

**C6.** Digite **o seu próprio e-mail** e clique em **Send**.

**C7.** Abra o e-mail que chegou ("You've been invited…" — veja o spam). Clique no link **Accept the invite**.

**C8.** O app abre com a tela **Criar sua senha**. Escolha uma senha (mínimo 8 caracteres), repita e toque em **Salvar senha**.

**C9.** Pronto: você entrou. ✅

### C-extra (opcional) — "Entrar com Google"

**G1.** Em **Identity** → **Registration** → **External providers** → **Add provider** → **Google**.

**G2.** Deixe a configuração padrão (**Use default configuration**) e clique em **Save** / **Enable**.

**G3.** Como o cadastro é **Invite only**, o Google só funciona para e-mails convidados — convide o seu Gmail (passo C5) se ele for diferente.

**G4.** Recarregue o app: o botão **Entrar com Google** aparece sozinho.

---

## Parte D — Celular

**D1.** No celular, abra o endereço do site (passo B6) e entre com seu e-mail e senha.

**D2. Android (Chrome):** menu **⋮** → **Adicionar à tela inicial** (ou **Instalar app**).
**iPhone (Safari):** botão **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início** → **Adicionar**.

**D3.** Abra pelo ícone novo. Ele funciona como um app. ✅

---

## Parte E — Trazer seus dados da versão antiga

**E1.** Na versão antiga (o artifact do Claude), abra **Ajustes** → **Exportar backup (JSON)**. Salve o arquivo.

**E2.** Na versão nova, abra **Ajustes** → **Importar backup** e escolha esse arquivo.

**E3.** Confirme. Em alguns segundos os lançamentos aparecem — e já sincronizam com o celular. ✅

---

## Segurança: o que protege seus dados

- **Só entra quem você convidou.** O cadastro está em *Invite only*; sem convite não dá para criar conta.
- **O servidor confere quem é você em toda requisição.** A função `/api` só responde se o Netlify Identity confirmar o seu login; sem isso, recusa (erro 401).
- **Cada pessoa tem a sua gaveta.** Os dados ficam no Netlify Blobs em chaves `u/<seu-id>/…`, montadas só a partir do id confirmado pelo login — nunca do que o navegador manda.
- **Nada de terceiros rodando no app.** Todas as bibliotecas ficam dentro do próprio site (pasta `site/vendor`), sem CDN. Uma política de segurança (CSP) proíbe scripts de fora.
- **Sem "espiar" em logs.** A função não grava o conteúdo dos seus lançamentos em log.
- **Conexão sempre criptografada (HTTPS)**, com HSTS ligado.
- **No aparelho**, uma cópia fica guardada para o app abrir sem internet. Ao **Sair**, essa cópia é apagada (se não houver nada esperando para subir). Em computador compartilhado, sempre use **Sair**.
- **Não há criptografia extra com senha própria** (decisão sua). Quem administra a conta Netlify consegue, tecnicamente, ver os dados — por isso proteja a sua conta Netlify/GitHub com senha forte e verificação em duas etapas.

### Por que a CSP permite o que permite
- `style-src 'unsafe-inline'`: a tela de login e o app usam estilos embutidos (só estilo, não script).
- `fonts.googleapis.com` / `fonts.gstatic.com`: fontes do Google (só CSS e arquivos de fonte; nenhum script).
- `font-src 'self'` foi acrescentado para permitir fontes guardadas no próprio site, se um dia forem vendorizadas.
- O "Entrar com Google" funciona sem liberar nada: ele navega a página inteira para `/.netlify/identity/authorize` (mesmo site) e volta com o login no endereço (`#access_token=…`). CSP não bloqueia navegação de página inteira.

---

## Custos

- O plano **Free** da Netlify é baseado em **créditos: 300 por mês**, e é um limite fixo (não dá para comprar mais no Free).
- O **Netlify Identity** está incluído em todos os planos de créditos, **sem custo extra**.
- O que gasta créditos (valores da documentação da Netlify):
  - cada **publicação em produção** (cada vez que o código novo vai ao ar): **15 créditos**;
  - **requisições web**: 2 créditos a cada 10.000;
  - **banda**: 20 créditos por GB;
  - **processamento** das funções: 10 créditos por GB-hora.
- Para uso pessoal, o maior gasto costuma ser **publicar versões novas**. Evite publicar muitas vezes no mesmo mês.
- **Se os créditos acabarem, a Netlify pausa o site** até o mês virar (aparece "Site not available"). Seus dados não somem.
- Acompanhe em **Team settings → Billing / Usage** no painel.

---

## Para quem for mexer no código

```
npm install        # dependências (Node 22.12+)
npm test           # testes (motor, API e store) — também rodam em cada deploy
npm run icons      # regera os ícones (precisa de Python + Pillow)
npm run vendor:identity   # regera site/vendor/netlify-identity.js a partir do pacote npm
python3 test/e2e/e2e_v2.py        # e2e no Chromium (modo local + sincronização simulada); precisa de Playwright
python3 test/e2e/e2e_netlify.py   # e2e do store real contra a API real (harness local com a CSP do netlify.toml)
```

- Os testes e2e ficam fora do `npm test` (precisam de navegador). O harness `test/e2e/netlify_harness.mjs` aceita um
  token falso de teste e **só existe para testes** — nunca é publicado (a função de produção usa o Netlify Identity).

- `site/` é publicado como está (sem build). `site/store.js` é a única porta para dados e login (`window.FinStore`).
- `netlify/functions/api.mjs` → rotas `/api/all`, `/api/changes?since=N`, `/api/meta/:nome`, `/api/month/:aaaa-mm`, `/api/export`. Lógica em `netlify/lib/api-core.mjs`.
- Sincronização: meses são mesclados por `id` da transação (vence o `updatedAt` mais novo; exclusões viram *tombstones* guardados por 90 dias). Documentos "meta" usam gravação condicional (ETag) e, em conflito, merge de 3 vias no aparelho.
- Fora do site da Netlify (ex.: abrir o arquivo localmente), o store entra em modo **local** (só `localStorage`).
- Ao trocar arquivos em `site/vendor` ou `site/icons`, aumente `VERSION` em `site/sw.js`.

---

## Referências (documentação consultada em out/2026)

- Netlify Functions (API moderna, `export default async (req, context)`): <https://docs.netlify.com/build/functions/get-started/>
- Functions — objeto `context`: <https://docs.netlify.com/build/functions/api/>
- Functions — rotas com `config.path`, `node_bundler`: <https://docs.netlify.com/build/functions/configuration/>
- Functions — modo compatível com Lambda (descontinuado em 1/jul/2027): <https://docs.netlify.com/build/functions/lambda-compatibility/>
- Identity — visão geral e planos: <https://docs.netlify.com/manage/security/secure-access-to-sites/identity/overview/>
- Identity — ativar: <https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/>
- Identity — cadastro, convite, provedores externos (Google): <https://docs.netlify.com/manage/security/secure-access-to-sites/identity/registration-login/>
- Identity — gerenciar usuários: <https://docs.netlify.com/manage/security/secure-access-to-sites/identity/manage-existing-users/>
- Identity em Functions (`getUser()` de `@netlify/identity`): <https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/>
- Biblioteca `@netlify/identity` (README do pacote 2.0.0, recomendada para projetos novos em vez do `netlify-identity-widget`): <https://www.npmjs.com/package/@netlify/identity>
- Netlify Blobs (consistência forte, gravação condicional `onlyIfMatch`/`onlyIfNew`, limites): <https://docs.netlify.com/build/data-and-storage/netlify-blobs/>
- Importar projeto do GitHub: <https://docs.netlify.com/start/quickstarts/deploy-from-repository/>
- Créditos e plano Free: <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/>
