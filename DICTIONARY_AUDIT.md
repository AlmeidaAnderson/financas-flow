# Auditoria do dicionário de estabelecimentos (v2)

O dicionário (`DEFAULT_DICTIONARY` em `site/engine.js`) categoriza lançamentos automaticamente quando nenhuma regra sua ou
aprendida se aplica. Na v1 ele tinha 488 padrões e alguns deles categorizavam errado — o caso real foi
**"Pix enviado para Mercado Pago Instituicao de Pagamento Ltda" → Alimentação › Mercado**, porque o padrão genérico
`MERCADO` casava com o nome do intermediário de pagamento (D5).

## O que mudou na forma de casar

1. **Limite de palavra.** Padrões literais agora só casam palavras inteiras: `OI` não casa dentro de "D**OI**S IRMÃOS",
   `TIM` não casa em "ES**TIM**ULO", `DIA` não casa em "ME**DIA**", `MAX` não casa em "**MAX**IMO", `AMIL` não casa em
   "F**AMIL**IA", `ENEL` não casa em "PAI**NEL**". Um "S" de plural no fim é tolerado ("DROGARIAS" casa `DROGARIA`).
2. **Específico × ambíguo.** Cada entrada é *específica* (categoriza sozinha) ou **ambígua** (nunca categoriza sozinha).
   Um lançamento que casa com uma entrada ambígua fica **sem categoria** e a triagem mostra as categorias sugeridas
   como atalhos. Assim que você escolhe (com "Lembrar esta categoria" marcado), vira uma regra aprendida só para aquele
   estabelecimento.
3. **Desempate.** Vence o casamento que começa mais cedo no texto; empate → o padrão mais longo. Por isso
   `GOOGLE YOUTUBE` (específico, Streaming) vence `GOOGLE` (ambíguo), `UBER EATS` (Delivery) vence `UBER` (App de
   transporte), `AMAZON PRIME` vence `AMAZON`, `SHELL SELECT` (conveniência) vence `SHELL` (combustível).
4. **Palavras genéricas nunca são padrão sozinhas:** `MERCADO`, `CASA`, `LOJA`, `LOJAS`, `SHOP`, `STORE`, `CENTER`, `PAG`,
   `PIX`, `COMERCIO`, `SERVICOS`, `LTDA`, `BRASIL`, `ONLINE`, `EXTRA`. Elas aparecem em nomes de qualquer tipo de negócio.
   Um teste automático (`v2 D5/item 8`) garante isso.

## Padrões que passaram a ser AMBÍGUOS

| Padrão | Antes | Sugestões na triagem | Por quê |
|---|---|---|---|
| `MERCADOLIVRE`, `MERCADO LIVRE` | Marketplace | Marketplace, Eletrônicos, Casa, Vestuário | Marketplace: vende de tudo; "Marketplace" não diz para onde foi o dinheiro. |
| `MERCADO PAGO`, `MERCADOPAGO` | (casava `MERCADO` → Mercado) | Marketplace, Mercado, Restaurante | Intermediário de pagamento (maquininha, link, Pix). O comércio real fica escondido. **Corrige o D5.** |
| `/^MP ?\*/` (prefixo `MP *`) | — | Marketplace | Prefixo do Mercado Pago. Normalmente o nome do lojista vem depois do `*` e é ele que é classificado. |
| `AMAZON`, `AMZN`, `AMAZON MARKETPLACE` | Marketplace | Marketplace, Eletrônicos, Casa, Livros | Vende de tudo. **Exceções específicas:** `AMAZON PRIME`, `AMAZONPRIME`, `PRIME VIDEO`, `PRIMEVIDEO`, `AMAZON MUSIC` (Streaming), `KINDLE`, `AMAZON KINDLE` (Livros), `AMAZON WEB SERVICES`, `AWS` (Software). |
| `SHOPEE` | Marketplace | Marketplace, Casa, Vestuário | Marketplace. |
| `SHEIN` | Marketplace | Vestuário, Casa, Marketplace | Majoritariamente moda, mas vende casa e beleza; a primeira sugestão é Vestuário. |
| `ALIEXPRESS` | Marketplace | Marketplace, Eletrônicos | Marketplace. |
| `TEMU` | Marketplace | Marketplace, Casa | Marketplace. |
| `MAGALU`, `MAGAZINE LUIZA` | Marketplace | Marketplace, Eletrônicos, Casa | Varejo multi-categoria + marketplace. |
| `AMERICANAS` | Marketplace | Marketplace, Eletrônicos, Casa, Mercado | Loja física vende até alimentos; online é marketplace. |
| `CASAS BAHIA` | Marketplace | Eletrônicos, Casa, Marketplace | Eletro e móveis. |
| `SUBMARINO`, `SHOPTIME`, `EBAY`, `OLX` | Marketplace | Marketplace (+ Eletrônicos/Casa) | Marketplaces/classificados. |
| `ELO7` | Marketplace | Presentes, Casa | Marketplace artesanal. |
| `HAVAN` | (sem entrada) | Casa, Vestuário, Eletrônicos | Loja de departamentos. |
| `PERNAMBUCANAS` | Vestuário | Vestuário, Casa, Eletrônicos | Também vende cama/mesa/banho e eletro. |
| `DECATHLON` | Vestuário | Vestuário, Eventos | Artigos esportivos: tanto roupa quanto equipamento. |
| `RAPPI` | Delivery | Delivery, Mercado, Farmácia | Rappi Turbo é mercado; também entrega farmácia. |
| `GOOGLE` | Software | Software, Streaming, Jogos | Google Play, Ads, Cloud, YouTube… **Específicos mantidos:** `GOOGLE YOUTUBE`, `YOUTUBE`, `YOUTUBE PREMIUM` (Streaming), `GOOGLE ONE`, `GOOGLE STORAGE`, `GOOGLE WORKSPACE` (Software). |
| `GOOGLE PLAY` | — | Jogos, Software, Streaming | Loja de apps. |
| `APPLE.COM/BILL`, `APPLE.COM` | Software | Software, Streaming, Jogos | Uma linha só para App Store, iCloud, Apple Music, TV+ e jogos. Específicos mantidos: `ICLOUD`, `APPLE MUSIC`, `APPLE TV`, `APPLE STORE`. |
| `PAYPAL` | (prefixo removido) | Marketplace, Software | Intermediário. |
| `PICPAY` | (prefixo removido) | Marketplace | Carteira digital. |
| `PAGSEGURO`, `PAGBANK` | (prefixo removido) | Marketplace | Intermediário / maquininha. |
| `STONE`, `CIELO`, `GETNET`, `SUMUP` | (prefixo removido) | Marketplace | Maquininhas: quando aparecem sozinhas não identificam o comércio. Quando vêm como `SUMUP *BAR DO ZECA`, o prefixo é removido e "BAR DO ZECA" é que é classificado. |
| `CARREFOUR.COM`, `CARREFOUR E-COMMERCE`, `CARREFOUR ECOMMERCE` | (casava `CARREFOUR` → Mercado) | Mercado, Eletrônicos, Casa | A loja online vende eletro e casa. |
| `EXTRA.COM` | (casava `EXTRA` → Mercado) | Mercado, Eletrônicos, Casa | E-commerce do Extra é principalmente eletro. |

## Padrões REMOVIDOS

| Padrão | Antes | Por quê |
|---|---|---|
| `/\bMERCADO\b\|\bMERCADINHO\b/` | Mercado | `MERCADO` sozinho é genérico (Mercado Pago, Mercado Livre, "Mercado de Peixes"…). **Causa do D5.** `MERCADINHO`, `MINIMERCADO`, `SUPERMERCADO`, `HIPERMERCADO`, `MERCEARIA` continuam específicos. |
| `/\bEXTRA\b/` | Mercado | "EXTRA" é palavra comum ("HORA EXTRA", "EXTRA FARMA"). Ficaram específicos só os nomes compostos da rede: `EXTRA HIPER`, `HIPER EXTRA`, `EXTRA SUPERMERCADO`, `SUPERMERCADO EXTRA`, `MERCADO EXTRA`, `MINI EXTRA`, `MINIEXTRA`. |
| `MORA` | Bancos/Tarifas | Casava sobrenomes e nomes de loja. Substituído por `JUROS DE MORA`. |
| `COMBUSTIVE`, `ODONTO`, `PSICOLOG`, `DEDETIZ`, `CABELEIREIR`, `VETERINAR` | (mesma categoria) | Eram prefixos de palavra; com o limite de palavra viraram regex equivalentes: `/\bCOMBUSTIVE(?:L\|IS)\b/`, `/\bODONTO/`, `/\bPSICOLOG/`, `/\bDEDETIZ/`, `/\bCABELEIREIR/`, `/\bVETERINAR/`. |
| `/\bTEMU\b/`, `/\bOLX\b/` | Marketplace | Substituídos pelas entradas ambíguas `TEMU` e `OLX`. |

## Recategorizados

| Padrão | Antes | Agora | Por quê |
|---|---|---|---|
| `BR MANIA` | Combustível | Mercado | BR Mania é a loja de conveniência dos postos BR, não o combustível. |

## Decisões tomadas (mantidos como específicos, com justificativa)

- **`CARREFOUR`, `PAO DE ACUCAR`, `MINUTO PA` → Mercado.** Hipermercados vendem eletrônicos, mas a linha típica da
  fatura ("CARREFOUR HIPER", "PAO DE ACUCAR 1234") é compra de supermercado. As lojas online (que vendem eletro) ficaram
  ambíguas (`CARREFOUR.COM`, `EXTRA.COM`). Se você compra uma TV no hipermercado, corrija aquele lançamento; com
  "Lembrar" desmarcado a correção vale só para ele.
- **`EXTRA`** só em nomes compostos (ver "Removidos").
- **`/\bPOSTO\b/`, `SHELL`, `IPIRANGA`, `PETROBRAS`, `AUTO POSTO`, `RAIZEN` → Combustível.** Uma linha "POSTO X" é quase
  sempre abastecimento. A conveniência tem nome próprio na fatura e foi separada: `AM PM`, `AMPM`, `BR MANIA`,
  `SHELL SELECT`, `SELECT SHELL`, `CONVENIENCIA` → Mercado. `SHELL BOX` (app de pagamento de combustível) → Combustível.
- **`UBER` × `UBER EATS`.** `UBER`, `UBER TRIP`, `UBERRIDES` (novo — aparecia no seu cartão como "DL*UBERRIDES"),
  `UBER RIDES` → App de transporte; `UBER EATS`, `UBEREATS` → Delivery. O mais longo vence no empate.
- **`99` × `99FOOD`.** `99APP`, `99 POP`, `99 TAXI`… → App de transporte; `99FOOD`, `99 FOOD` (novos) → Delivery.
- **`LEROY MERLIN` → Casa.** Material de construção, ferramentas e decoração cabem todos em "Casa".
- **`IFOOD` → Delivery.** O iFood também tem mercado, mas a esmagadora maioria das linhas é delivery de restaurante.
- **`PONTO FRIO`, `FAST SHOP`, `KABUM` → Eletrônicos.** Varejo especializado (eletro/eletrônicos).
- **`HOTMART` → Cursos.** Plataforma de infoprodutos, quase sempre cursos.
- **Renda genérica** (`PIX RECEBIDO`, `TED RECEBIDA`, `DOC RECEBIDO`, `TRANSFERENCIA RECEBIDA` → Renda › Outros) continua,
  mas só para valores positivos e só quando nada mais específico casa (ex.: "TED RECEBIDA SALARIO ACME" → Salário).

## Adicionados

`99FOOD`, `99 FOOD`, `UBERRIDES`, `UBER RIDES`, `SHELL BOX`, `AM PM`, `AMPM`, `SHELL SELECT`, `SELECT SHELL`,
`CONVENIENCIA`, `MINIMERCADO`, `MERCEARIA`, `QUITANDA`, `ATACAREJO`, `AUTOPISTA` e `ARTERIS` (pedágio), `AMAZON MUSIC`, `GOOGLE YOUTUBE`, `YOUTUBE PREMIUM`, `YOUTUBEPREMIUM`, `GOOGLE STORAGE`,
`GOOGLE WORKSPACE`, `JUROS DE MORA`, `/^AZUL[A-Z0-9]{6}$/` (localizador de reserva da Azul, ex.: "AZULAB12CD").

## O que acontece com os seus dados

A migração da v2 (ao abrir o app / depois de "Importar backup") reaplica o dicionário novo **só** em lançamentos que
estavam categorizados pelo dicionário ou sem categoria. **Categorias manuais nunca são alteradas.** Isso tira de "Mercado"
os Pix para o Mercado Pago e manda para a triagem compras ambíguas (ex.: Mercado Livre).
