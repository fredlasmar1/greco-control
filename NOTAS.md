# Greco Control — Notas de Estado

> Arquivo de continuidade entre sessões. Atualize ao final de cada plano.

## Versão atual em produção

- **Build**: `2026-05-01-fonte-mais-recente` (commit `cf1897e`)
- **URL**: https://grecocontrol.com.br/
- **Healthcheck**: `GET /api/version`

### v74 — Custo fixo/atend = média das fixas ÷ média atendimentos (meses fechados) (27/06/2026) [concluído]

**Decisão do dono:** custo fixo vem do "fechamento mensal" → média dos meses fechados. **Feito:** helper `custoFixoAtendimentoMedio(mes)` = (média do totalFixas dos meses fechados via computeTotaisDoMes) ÷ (média de atendimentos dos meses fechados). `/contexto` e `/calcular` usam; contexto expõe `mediaFixas`. Validado: média fixas R$19 ÷ 940 atend = R$0,02 (baixo pq meses fechados jan-mai SEM fixas categorizadas — confirma que falta dado, não lógica). **Próximo (dono escolheu opção 2): montar REGRAS de categorização das fixas** (`expense-regras` + classificarDescricao já existem; cria regra por keyword → classifica auto todo mês) + importar extrato Itaú. Engine 100% automática; só falta alimentar. (Custos fixos típicos discutidos: aluguel/condomínio/IPTU, energia, água, internet/telefone, salários fixos+pró-labore, encargos, contador, software/Trinks, seguro, manutenção/limpeza, taxas bancárias fixas.)

### v73 — Editor de custo dentro de cada serviço (Meus Serviços) (27/06/2026) [concluído]

**Pedido (confirmado o mockup antes):** editar cada serviço pra achar o custo, fórmula = produtos(ficha)+fixo/atend+comissão(barb+assist)+imposto+taxa+outros → margem real → margem-alvo → preço ideal. Imposto/taxa globais; ficha = produtos adicionados. **Feito:** `PUT /api/service-costs/:serviceId` (upsert de UM serviço, não mexe nos outros). `ListaServicos` agora carrega contexto (custoFixoPorAtendimento/taxa/imposto) + savedCosts; cada serviço expande inline o `EditorServicoCusto` (ficha add/remove, comissão, assistente, outros, preço editável, margem-alvo→preço ideal, tudo recalcula ao vivo; salva via PUT). Badge de margem% na linha. Validado: PUT salva/persiste. (Dívida: serviceCosts em arquivo .service-costs.json — perde no deploy Railway sem volume.)

### v72 — Aba "Meus Serviços" (catálogo cacheado, independe da API) (27/06/2026) [concluído]

**Raiz descoberta:** os serviços só vinham da API ao vivo (`hasTrinksData && trinks.servicos`) — no modo CSV a lista ficava VAZIA (dono frustrado: "preciso editar cada serviço, não está dando essa opção"). **Feito:** `GET /api/servicos/lista` (cacheia em kv `catalogo_servicos`; usa cache, só toca a Trinks se vazio ou `?refresh=1`) — 59 serviços. Nova aba **"✂️ Meus Serviços"** (1ª, default) `ListaServicos`: agrupada por categoria (nome·duração·preço), busca + botão "↻ Atualizar da Trinks". Independe da API estar no ar. **Dono quer corrigir a precificação "um a um" — este foi o passo 1 (ter a lista visível).** Próximos passos a definir com ele.

### v71 — Editar cada serviço (botão na Visão Geral) + "outros custos" (27/06/2026) [concluído]

**Pedido:** "preciso editar cada serviço, você não está me dando essa opção". O editor (CostDetailDialog) existia mas escondido na aba Ficha de Serviços. **Feito:** (1) `outrosCustos` ponta-a-ponta — `ServiceCostEntry.outrosCustos` (backend persiste no POST /api/service-costs), input no CostDetailDialog, `analysis` client + `/calcular` somam no custo e no preço sugerido; (2) botão **✏️ Editar** em cada SERVIÇO na aba Visão Geral → `onEditarServico(id)` → `setEditingService`; (3) CostDetailDialog MOVIDO pra fora dos TabsContent (abre de qualquer aba — antes Radix desmontava). Editor ajusta ficha+comissão barbeiro/assistente+margem+outros custos → salva → recalcula. Validado: ficha 3 + outros 5 + fixo 0,39 + comissão 24 → custo 38,09, margem 36,52%. Produtos editam na aba Custos de Produtos. (serviceCosts ainda em arquivo .service-costs.json — perde no deploy Railway sem volume; dívida.)

### v70 — Custo fixo POR ATENDIMENTO + aba Visão Geral unificada (27/06/2026) [parcial: falta calculadora 1-a-1 de produto + taxas Itaú]

**Decisões do dono (precificação):** (1) custo fixo ÷ ATENDIMENTOS (não por minuto); (2) NÃO flutuar → usar média de atendimentos dos meses fechados; (3) "custo variável" = compras+cartão+outros custos; (4) taxas do Itaú ele vai mandar (ponderar cartão/PIX). Quer 2 abas: "1 a 1" (serviço E produto) + "todos pesquisável".

**Feito:** `comissaoCategoria.calcularMargemServico` ganhou `custoFixoPorAtendimento` (prioridade sobre por-minuto) + `outrosCustos`. `routes.ts`: helper `mediaAtendimentosMes()` (média de comandas dos meses fechados, exclui corrente); `/contexto` e `/calcular` expõem/usam `custoFixoPorAtendimento` (= totalFixas÷média). Validado: média 940 (5 meses), custo fixo/atend R$0,39 (baixo até categorizar fixas), Corte R$60 margem 55,85%. Frontend: `analysis` usa custoFixoPorAtendimento; nova aba **📊 Visão Geral** (`VisaoGeral`: serviços+produtos juntos, busca, filtro Todos/Serviços/Produtos, margem+semáforo, pior no topo); removida a aba "Custos de Produtos" antiga (CustosProdutosPanel, vazia); abas renomeadas; default = Visão Geral.

**FALTA (próximo):** (a) Calculadora 1-a-1 de PRODUTO (hoje só serviço); (b) input "outros custos" na tela (motor já aceita); (c) taxas do Itaú (ponderar cartão/PIX) — aguardando dono.

### v69 — Margem de Produtos: preenchimento em massa de custos (27/06/2026) [concluído]

**Pedido:** fechar os custos de produto (dono escolheu preencher na tela; 45/51 sem custo). **Feito (frontend, `MargemProdutos`):** Enter salva + foca o próximo input de custo; `salvarCusto` atualiza a linha LOCALMENTE (recalcula margem c/ taxa+imposto+comissão) sem refetch → ordem não reembaralha; lista ordenada estável por categoria+nome. Backend (PUT /api/produtos/catalogo/custo) inalterado. Fluxo: digita custo → Enter → próximo, margem 🔴🟡🟢 na hora. Catálogo: 51 produtos (Bebidas/Doces/Pomadas/Shampoos/Óleos/Tônicos/etc); 6 vieram do Trinks com custo (4 errados).

### v68 — Faturamento acumulado do ano no topo do Dashboard (26/06/2026) [concluído]

**Pedido:** ver o total faturado no ano no Dashboard. **Feito:** componente `FaturamentoAno` no topo do Dashboard — soma `receita` de `/api/historico/mensal` (Caixa por mês): total 2026, atendimentos, média/mês, melhor mês + mini-barras por mês. Validado: ~R$493.889 jan-jun (mai melhor, R$89.490). Mês corrente parcial; atualiza ao importar cada mês.

### v67 — Retenção de Clientes no Dashboard (análise de churn/gargalo) (26/06/2026) [concluído]

**Pedido:** dono quer entender o gargalo de clientes. **Feito:** `GET /api/clientes/retencao` — cruza Caixas jan-jun por clienteId: por mês {ativos, novos, retornaram, perdidos, taxaRetorno}; frequência semestre (1/2-3/4+ visitas); recorrência por meses distintos; fiéis (4+ meses); inativos (sem vir ≥2 meses). Card `RetencaoClientes` no Dashboard (entre cota e Resumo). **Validado: 1.216 clientes; 37,7% (458) vieram 1x só; 40,6% inativos; 30% fiéis; ~200 churn/mês; retorno 58%→83%.** Gargalo = 1ª visita não vira 2ª.

### v66 — Tela de Evolução (histórico mês a mês: clientes + barbeiros) (26/06/2026) [concluído]

**Pedido:** dono quer ver números reais mês a mês desde jan/2026 (clientes e barbeiros). Importou Caixa de jan-jun (jan 77.905/867com, fev 78.736/883, mar 82.616/953, abr 88.205/1001, mai 89.490/996, jun atualizado 816com/75.918). Estado: caixa jan-jun; ranking mar-jun (faltam jan/fev); financeiro abr-jun.

**Feito:** `GET /api/historico/mensal` — itera 2026-01..12, lê Caixa (receita/comandas/clientes únicos por clienteId/ticket) + Ranking (barbeiros: atend/serviços/produtos/comissão via comissaoServicosRanking). Clientes novos = primeira aparição no histórico. Nova página **Evolução** (`/evolucao`, menu após Viabilidade, ícone LineChart): barras de faturamento/mês + tabela clientes (novos×recorrentes×%recorrência×ticket) + barbeiros por mês (seletor, só meses c/ ranking) + aviso de meses sem ranking. Validado: recorrência 0%(jan)→83%(jun) = base fidelizando. Rankings jan/fev entram sozinhos quando importados.

### v65 — Cota Trinks: proteger POST com auth admin (26/06/2026) [concluído]

**Contexto:** cota Trinks configurável já feita (commit d00eade, outra aba, no ar): `trinksQuota.ts` (kv `trinks_fatia_base` + `trinks_tokens_extras` por mês), endpoints GET/POST `/api/trinks/cota` + POST `/comprar`, controles no Dashboard (`TrinksCotaControls`). **Ponta solta do HANDOFF_COTA_TRINKS.md:** os 2 POST estavam SEM auth.

**Feito:** os 2 POST (`/api/trinks/cota`, `/api/trinks/cota/comprar`) agora exigem admin (`getUserFromToken(extractToken(req))` + `role !== "admin"` → 403, padrão dos outros endpoints admin). GET livre. Frontend: `TrinksCotaControls` usa `authFetch` (envia Bearer), trata 403, esconde controles de escrita p/ não-admin. Validado: GET ok sem token; POST sem token → 403. (Cota compartilhada Trinks: Grecometas + Greco Control, bancos separados, fatia só alerta — hard-stop segue MAX_REQUESTS_PER_MONTH=4500.)

### v64 — Margem de Produtos (aba editável do catálogo) (25/06/2026) [concluído]

**Objetivo:** corrigir o "Produtos 96,5% otimista" → margem real por produto. Bloqueio: custo de compra (Trinks v1 NÃO expõe; catálogo importado veio 45/51 sem custo, e os 6 que tinham estão ERRADOS — custo de caixa, ex: AMENDOIM custo 45 vende 2).

**Feito:** `GET /api/produtos/catalogo` (margem por produto do kv catalogo_produtos: preço − custo − comissão − taxa − imposto; local, sem API) + `PUT /api/produtos/catalogo/custo` (grava custo por nome). Aba **"Margem de Produtos"** na Precificação: tabela com custo EDITÁVEL inline (Enter salva), margem% c/ semáforo, resumo (com/sem custo, N prejuízo), ordenada prejuízo→sem-custo. Avisa custos suspeitos (margem negativa = custo de caixa). Validado: PUT salva; margem calcula. **Dono completa/corrige os 45 custos pra margem ficar real.** Margem AGREGADA na Viabilidade (card Produtos) ainda usa receita−taxa−imposto (sem CMV) — fica pra quando custos preenchidos + vendas por produto.

### v63 — Estética AUTOMÁTICA pela agenda da Trinks (25/06/2026) [concluído]

**Contexto:** API Trinks VOLTOU a responder (25/06; mês teve 17.467 ok / 11.422 429 → limite é por janela/rajada, não mensal; cota compartilhada c/ grecometas → manter economia). Agendamentos trazem `servico.nome`+valor+status → dá pra automatizar a Estética (era manual v59).

**Feito:** `POST /api/viabilidade/estetica-auto/:mes` — 1 sync paginado da agenda do mês (trinksFetchAll, ~36 req p/ junho, cache 2h), classifica estética por keyword `/barboterap|spa|sobrancelh|pigment|limpez|hidrat|massag|pestan|depilac|peeling|micropigment|design|pés/i`, soma valor dos NÃO-cancelados, grava em `viab_estetica:mes` (mesmo registro do manual, comissaoPct 35, auto:true, lista de serviços). 429 → 503 "tente depois". Botão "↻ Calcular pela agenda (Trinks)" na aba Viabilidade + msg com resumo. **Validado junho: R$7.594 em 184 atend (Design Sobrancelha 1790, Massagem Corporal 1600, Barboterapia 1388, Hidratação, Spa dos Pés, Pigmentação Barba, Lavagem c/ Massagem, Limpeza de Pele…); margem 60,5%.** Química (Progressiva/Selagem) fica FORA (não é estética pura). Cortes/barbas fora (correto). Manual continua (pode sobrescrever).

### v62.1 — Caixa do Dia: PIX vem da coluna "Outros" do Caixa (24/06/2026) [concluído]

**Descoberta:** CSV de Caixa não tem coluna PIX — no Trinks o PIX é lançado em **"Total (R$) Outros"** (col 21). Confirmado: 02/06 totalOutros R$1.323 vs PIX caiu no Itaú R$1.286 (dif R$37). **Fix:** fallback csv-caixa mapeia `vend.pix = totalOutros` (vale-presente → outros). Aviso no front: "PIX vem de Outros, pode incluir outras formas". Validado: 02/06 PIX agora BATE (era zerado). Crédito/Débito/PIX os 3 batem no meio de semana.

### v62 — Caixa do Dia: fallback CSV Caixa pro "vendido por forma" (24/06/2026) [concluído]

**Problema:** Conferência D+1 mostrava vendido por forma = R$0 em dias fora do range do financeiro importado (financeiro junho só cobre 13–23/06) — caía na API Trinks (429 crônico). O CSV de Caixa tinha as formas (totalCredito/totalDebito/totalDinheiro/totalPrePago por comanda) mas não era usado.

**Fix (`routes.ts` /api/caixa-dia/conferencia + `CaixaDia.tsx`):** novo fallback `fonteVenda="csv-caixa"` — quando financeiro do dia vazio + API indisponível, usa as formas do CSV Caixa. Caixa fecha sem tocar a Trinks. Badge "● CSV Caixa" + aviso (Caixa não separa PIX → some em "outros"; confira crédito/débito). Validado prod: 02/06 Crédito BATE (dif R$2,74)/Débito BATE; 12/06 (sexta) não bate pq liquida segunda c/ sáb+dom (limitação fim-de-semana conhecida).

### v61 — Financeiro: aceita variante "por Data de Atendimento/Venda" (24/06/2026) [concluído]

**Problema:** CSV financeiro variante (header "Mês da Data do Atendimento/Venda" em vez de "Mês de Previsão de Recebimento") dava "tipo não reconhecido". Mesmas 22 colunas, só muda a 1ª. A Trinks exporta o financeiro em 2 recortes: previsão de recebimento (competência caixa) e data de atendimento (competência venda).

**Fix (`trinksImport.ts`):** `detectTrinksType` financeiro aceita "mês de previsão de recebimento" OU "mês da data do atendimento". `FINANCEIRO_HEADER_REGEX` afrouxado p/ `/^"?M[eê]s d[ae] (Previs[aã]o de Recebimento|Data do Atendimento)/i`. Parser lê as colunas por nome (iguais). Validado: variante → financeiro, mês 2026-06, R$68.043, 681 linhas. **Dono: tanto faz a versão; último que subir no mês vale (sobrescreve).** Nota: as 2 versões dão valores diferentes (atendimento R$68k vs previsão R$41k junho parcial).

### v60 — Parser de Catálogo de Produtos (importação) (23/06/2026) [concluído]

**Problema do dono:** `produtos.csv` (catálogo Trinks) dava "tipo não reconhecido" — não havia parser. (Os 2 `relatorio.csv` que ele mandou eram Caixa+Financeiro de MAIO, já reconhecidos.)

**Feito (`trinksImport.ts` + `routes.ts` + `ImportarTrinks.tsx`):** novo tipo **"produtos"**. Detecção: header com "valor de compra" + "código de barras". `parseProdutos` extrai Nome·Categoria·Preço·%Comissão·Custo(Valor De Compra)·paraRevenda → `ProdutosPayload`. Confirm salva em kv fixo **`catalogo_produtos`** (NÃO por mês). Preview/summarize/UI (label "Catálogo de Produtos", ícone Wallet, `PreviewProdutos` com total/com-custo/sem-custo + amostra). Validado: produtos.csv → 51 produtos, 6 com custo, 45 sem. **Ressalva: 45/51 vieram SEM custo da Trinks** (dono completa em Custos de Produtos). Catálogo entra no sistema (nome/preço/comissão); margem de produto exata depende dos custos. Próximo possível: usar `catalogo_produtos` pra margem real de Produtos na Viabilidade.

### v59 — Estética como 5ª categoria via valor manual (23/06/2026) [concluído]

**Contexto:** A2 só fez 4 categorias (faltou Estética). Estética precisa do nome do serviço × valor — só vem da API agendamentos (429 crônico) ou relatório por serviço (Trinks do dono não exporta; os CSVs que mandou eram financeiro/caixa/catálogo-produtos). Decisão do dono: **campo manual**.

**Feito:** `POST /api/viabilidade/estetica/:mes` salva `{receita, comissaoPct}` em kv `viab_estetica:YYYY-MM` (receita=0 limpa). `calcularCategoriasMargem` lê e monta 5ª linha `estetica` (margem = receita − comissão(receita×pct) − taxa − imposto − fixo rateado por participação). `esteticaPendente` agora = `!estetica`. Aba Viabilidade: 5º card "Estética" (quando lançado) + campo de lançamento (receita R$ + comissão % + Salvar → reloadKey). Recorte da receita de serviço (já contada nos barbeiros) — sinalizado p/ não parecer dupla-contagem. Validado: R$3.000/40% → margem 55,5%.

**5 categorias completas:** Express/Clássico/VIP (ranking) + Produtos (ranking) + Estética (manual). Quando a API liberar / houver relatório por serviço, dá pra automatizar a estética (helper já estruturado).

### v58 — Reajuste de Preços: raio-X lucro/prejuízo + preço pra margem 30% (23/06/2026) [concluído]

**Ideia do dono:** o preço dos serviços ELE define; o sistema só diz se cada um lucra ou dá prejuízo (custo × preço atual) e qual preço pra atingir margem-alvo (30%). Inverte o problema (não caçar custo perfeito; usar o preço existente). "Serviço é chute no escuro hoje."

**Feito (frontend puro, reusa `analysis` v56 com taxa+imposto):** state `margemAlvo` (default 30, editável). Nova aba **"Reajuste de Preços"** (`ReajustePrecos` em Precificacao.tsx): tabela de TODOS os serviços ordenada por margem crescente (prejuízo no topo): Serviço · Preço atual · Custo · Margem hoje (🔴/🟡/🟢) · Preço p/ alvo% · Reajuste(+R$). Resumo "N no prejuízo · N abaixo de X%". Preço-alvo = (ficha+fixo)/(1−comissão%−taxa%−imposto%−alvo%). Ressalva na tela: sem ficha → custo subestimado.

(v57 = A2 margem por categoria na Viabilidade — Express 45,5%/Clássico 55,5%/VIP 45,5%/Produtos 96,5%; registrado na memória do projeto.)

### v56 — Calculadora de Preço guiada + custo completo (taxa cartão + imposto) (23/06/2026) [concluído]

**Pedido do dono:** sistema que ajude a chegar no preço base com TODOS os custos (fixos, variáveis, barbeiro, assistente, produtos do serviço) + margem. **Diagnóstico:** o motor (v50 `calcularMargemServico`) já fazia ficha+custo-fixo+comissão→preço, mas faltavam 2 variáveis: **taxa de cartão** e **imposto**.

**Backend:** `ConfigFinanceira.impostoPct` (novo, dono edita; clamp 0..100). `calcularMargemServico` ganhou `taxaCartaoPct`+`impostoPct`: custo = produtos+fixo+comissão(barbeiro+assistente)+**taxaCartaoValor**+**impostoValor**; `precoSugerido = (ficha+custoFixo) / (1 − comissão% − taxa% − imposto% − margem%)`. PUT `/api/config/financeira` aceita impostoPct; `/api/precificacao/calcular` e `/contexto` passam/expõem taxaCartaoPct+impostoPct.

**Frontend (`Precificacao.tsx`):** `analysis` client-side replica a fórmula com taxa+imposto. Nova aba **"Calculadora de Preço"** (agora a 1ª/default): campo imposto% editável (PUT config), seletor de serviço → decomposição passo a passo (produtos·fixo·comissão barbeiro·assistente·taxa·imposto = custo total) + **slider de margem** → preço base; compara com preço atual; avisa ficha vazia.

**Validado:** Corte+Barba R$90 → taxa 3,15 + imposto 5,40 no custo (total 45,06), fórmula correta. Build verde. **Preço sugerido só fica realista após categorizar as fixas** (hoje totalFixas=R$60 → custo fixo ~0).

### v55 — Blindagem anti-vazamento: fechamento-mes + Conselheiro csv-first (23/06/2026) [concluído]

**Varredura completa do consumo Trinks (pedido do dono: o que precisa ao vivo vs CSV).** Resultado:
- **AO VIVO (justifica token):** Dashboard hoje/hoje-completo/amanhã (dia corrente; já throttle 2h v54), Caixa do Dia dia recente sem CSV (já csv-first v54).
- **VAZAMENTOS confirmados (mês fechado batendo API à toa):** `/api/fechamento-mes` (aba Pagamento — MAIOR uso) e Conselheiro `calcularFaturamentoTrinksMes`. O vazamento que eu suspeitei no `/api/mes/dados` NÃO existia (já blindado por mesService+guard mês fechado).
- **NÃO blindáveis (precisam detalhe item×profissional que só a API tem):** conciliação órfãs/status, vendas-produtos (`t.servicos[]`/`t.produtos[]`). CSV não carrega isso. Economia deles = cache 2h (v54).

**Feito:** helper **`transacoesMesCsvFirst(mes)`** (reusa `getMesDataCanonical` — mês fechado=CSV 0 API, corrente=API c/ fallback+cache). Aplicado em `/api/fechamento-mes` e `calcularFaturamentoTrinksMes`. Validado: fechamento-mes jun → fonte csv-financeiro 40.975,55, 0 chamada bem-sucedida à API. Build verde.

### v54 — Economia de cota Trinks + fatia mensal + contador no Dashboard (22/06/2026) [concluído]

**Contexto:** conta Trinks tem ~5000 req/mês TOTAL, COMPARTILHADAS com o grecometas. O greco-control estava com teto 4500 (quase tudo) e a auditoria real mostrou **26.865 requisições no mês / 9.405 recusadas (429)** — sufocava o grecometas. Causa do teto não segurar: `requestsThisMonth` mora em CACHE_FILE no disco, que o Railway (sem volume) apaga a cada deploy → zera → 4500 nunca atinge. Auditoria persistente (kv/Postgres) é a real.

**Economias (`routes.ts`):** crons 4→2 (mantidos Telegram 08h + snapshot 23h30 csv-first; **desligados** pré-fetch 03h `if(false)` + refino 6h `if(false)`); `CACHE_TTLS` transacoes/agendamentos/lancamentos 30min→**2h**, full_sync 15min→1h; `DASH_FETCH_THROTTLE_MS` 60s→**2h** (Dashboard.tsx — parava de martelar a cada foco); **Caixa do Dia csv-first** (conferencia/:data usa CSV do dia se existir = 0 API; só toca API em dia sem CSV).

**Fatia mensal (decisão dono: 2500=metade; NÃO bloqueia, só alerta forte):** `TRINKS_FATIA_MENSAL = env TRINKS_MONTHLY_BUDGET || 2500`. `MAX_REQUESTS_PER_MONTH=4500` fica como teto absoluto de segurança. `GET /api/trinks/contador` (novo) devolve hoje/mês ok+429 (de `trinksAuditLog`), `fatiaMensal`, `consumoMes` (=total req do mês), `fatiaEstourada`, `trinks429Agora` (circuitOpenUntil).

**Contador no Dashboard (`Dashboard.tsx`):** widget "consumo / 2500 (X%)" + hoje ok/recusadas; vermelho "Fatia estourada — consumindo cota do grecometas" quando passa; âmbar quando Trinks recusando agora. Validado: 26.865/2500 → vermelho. Economias derrubam o consumo daqui pra frente. Build verde.

### v53.1 — Caixa do Dia híbrido (API Trinks ao vivo → CSV reserva) + aviso 429 (22/06/2026) [concluído]

**Pedido do dono:** caixa do dia deveria usar a API Trinks ao vivo; e o medidor "não avisou" que os tokens acabaram. **Diagnóstico:** o 429 NÃO é a nossa cota (58/4500 OK) — é o limite da CONTA Trinks (externo, compartilhado, << 4500). O contador conta certo; o "4500" é enganoso. O aviso de 429 JÁ EXISTE na aba Auditoria Trinks (card "Rate Limit (429)" via `trinksAuditLog`), só estava escondido. Conserto = surfaçar o status onde o dado é usado.

**Feito:** `GET /api/caixa-dia/conferencia/:data` agora tenta **API Trinks ao vivo primeiro** (transacoes, timeout 6s) e cai no **CSV Financeiro** se 429/vazio. Retorna `fonteVenda`('trinks'|'csv'), `trinks429`, `qtdVendas`. `CaixaDia.tsx`: badge "● Trinks ao vivo" (verde) / "● CSV importado" (âmbar) + aviso "⚠ Trinks indisponível (429) — usando CSV" quando fallback. Validado: Trinks em 429 → caiu no CSV, marcou aviso, crédito 11/06 segue 1.449.

### v53 — Caixa do Dia → Conferência D+1 (cartão/PIX vendido vs caiu no Itaú) (22/06/2026) [concluído]

**Pedido do dono:** conferir vendas do dia X vs o que caiu no banco em X+1, por forma (créd/déb/pix), com botão "caixa bate / não bate" + justificativa. Substituiu o caixa físico (dinheiro) antigo.

**Regras do dono:** (1) esperado DESCONTA taxa da maquininha (cfg.taxaCartaoPct 3,5%; PIX sem taxa); (2) Crédito/Débito caem **D+1 ÚTIL** (pula sáb/dom), PIX no mesmo dia; (3) só Cartão+PIX (Dinheiro/Planos fora — não têm D+1).

**Backend (`routes.ts`):**
- `GET /api/caixa-dia/conferencia/:data` — vendido por forma (CSV Financeiro `tipoFormaPagamento`) + por tipo (CSV Caixa serviço/produto/pacote); esperado líquido=venda×(1−taxa); caiu no Itaú: REDE …AT=crédito / …DB=débito no dia útil seguinte, PIX (RECEB/QR) no mesmo dia; status bate se |dif|≤R$50; exclui contas observação.
- `POST /api/caixa-dia/conferencia/:data` — salva `{status:'bate'|'nao_bate', justificativa}` em kv `caixa_conferencia:DATA`.
- D+1 útil: pula fds (getUTCDay 0/6). **Limite conhecido: fim de semana acumula** (sex+sáb liquidam juntas na segunda → "não bate", sinalizado na UI pra justificar).
- Endpoints antigos de caixa físico (`/api/caixa-dia/:data`, `/fechar`) ficaram órfãos (não removidos — alteração mínima).

**Frontend (`CaixaDia.tsx` reescrito):** seletor de dia, vendido por forma+tipo, tabela conferência (forma·vendido·esperado líq·caiu·dif·🟢/🔴) c/ aviso de fds, veredito + botões "Caixa bate"/"não bate" + justificativa.

**Validado (dados reais):** 11/06 (qui→sex) Crédito vend 1.449→esperado 1.398→caiu 1.399 dif **R$1,18 🟢**, Débito dif R$25 🟢, PIX +100 🔴. Mecânica D+1 correta. **Dia 18 (caso do dono) é qui→sex, funciona limpo — mas CSV Financeiro em prod só vai até 13/06, dono reimporta.** Build verde.

### v52 — Lançamentos: sub-abas Entradas / Saídas (Fixa/Variável → totalFixas) (22/06/2026) [concluído]

**Objetivo:** separar Entradas de Saídas, e Saídas em Fixas/Variáveis — o que alimenta o `totalFixas` da Viabilidade (hoje R$60 furado). Decisões do dono: override manual vence a categoria; herda da categoria automaticamente.

**Backend (`routes.ts`):**
- Campo **`tipoDespesa?: 'fixa'|'variavel'`** em `TransacaoBanco` + `FinanceEntry` (aditivo).
- `computeTotaisDoMes`: override `tipoDespesa` vence a category/categoria; **funciona MESMO SEM categoria** (uma despesa do extrato sem categoria marcada "fixa" entra no totalFixas — é o que destrava o R$60). Sem override → herda (regra atual).
- **`PATCH /api/lancamentos/despesa/:id/tipo`** `{tipoDespesa}` — acha em financeEntries OU transacoesBanco, persiste.
- **`GET /api/lancamentos/saidas/:mes`** — unificado (manual + extrato), cada item com `efetivo` (override ou herdado), `override`, `conflito` + somas totalFixas/totalVariaveis/totalAClassificar.

**Frontend (`Lancamentos.tsx`):** 2 sub-abas novas (as 4 antigas preservadas): **Entradas** (faturamento+breakdown canônico, zero digitação) e **Saídas** (resumo Fixas/Variáveis/Total + bloco "⚠ A classificar" no topo + listas, cada linha c/ botões Fixa/Variável, origem, badge override). Marcar → PATCH → recalcula saídas+viabilidade (reloadKey).

**Validado:** marcar SANEAGO(503)+Seguro(305) como fixa → viabilidade fixo R$60→868,11, margem 48,4%→46,4%; reverte certo. **Jun: 65/70 saídas "a classificar" (R$87 mil) — trabalho do dono pra margem virar real.** Build verde.

### v51 — Motor de Viabilidade Fase A (margem real ao vivo + guia de fixas) (22/06/2026) [concluído]

**Queixa do dono:** abas não conversam (receita no Dashboard, variável no Lançamentos, fixo no Financeiro, margem na Precificação). Quer o sistema CALCULAR a viabilidade do que já flui, ao vivo — não foto digitada.

**A1 (feito):** **`GET /api/viabilidade/:mes`** — cascata receita → (−)variável → margem contribuição → (−)fixo → resultado + margem real %. Reusa (NÃO duplica): receita=`getMesDataCanonical`; variável=`construirEntradasAuto` (comissão ranking v42 + material fichas) + taxa cartão (`cfg.taxaCartaoPct`×breakdown cartão) + extrato variável (`computeTotaisDoMes.totalVariaveis`−comissão−material); fixo=`computeTotaisDoMes.totalFixas`. **Guia de fixas:** detecta totalFixas<5% receita (implausível) → lista transações do Itaú com keyword fixa (aluguel/energia/água/internet/contador/sistema/seguro…) sem categoria/“outros” pra classificar inline (`PUT /api/expenses/bank/:id/categoria` → recalcula ao vivo) + checklist (Aluguel/Energia/Água/Internet/Contador/Sistemas/Salários, marca o que já tem fixo categorizado). Aba nova **`/viabilidade`** (`Viabilidade.tsx`, menu icon Calculator). **Validado jun:** receita 40.975,55 − variável 21.100 (comissão 16.372 + taxa 880 + material 0 + extrato 3.848) = margem contrib 19.875 − fixo 60 = resultado 19.815/48,4% (otimista pq fixo=R$60, é o que o guia ataca). Material 0 (fichas vazias). Receita sem pacote separado até dono reimportar Caixa completo.

**A2 (parcial feito — v57, 23/06, NO AR):** 4 das 5 categorias (faltou Estética). Helper `calcularCategoriasMargem(mes)` em routes.ts: agrega o ranking por `categoriaPorApelidoRanking` (Express/Clássico/VIP = serviço por profissional) + Produtos (totalProdutos). Por categoria: receita, ticket, comissão (comissaoServicosRanking), taxa cartão + imposto (config), custo fixo RATEADO por participação na receita de serviço → margem real R$/%. Exposto no `/api/viabilidade/:mes` campo `categorias`. Aba Viabilidade mostra 4 cards com semáforo. **Validado jun: Express 45,5% · Clássico 55,5% · VIP 45,5% · Produtos 96,5%** (confirma a tese: comissão 50% do Express/VIP < margem do Clássico 40%). **Estética PENDENTE** (precisa relatório Trinks por serviço; hoje embutida na categoria do barbeiro; R$4.853 de serviço de assistentes/não-mapeados sinalizado à parte). Produtos otimista (falta custo de mercadoria). Custo fixo baixo até categorizar fixas. (Bug no caminho: bloco fora posto no endpoint /resumo; movido p/ helper no /viabilidade.)

### v50 — Precificação confiável: tapar os 3 furos da margem (18/06/2026) [concluído]

**Diagnóstico:** margem por serviço distorcida por 3 dados frágeis (motor de cálculo está certo): (1) ocupação chute 50% → contamina custoFixoPorMinuto; (2) totalFixas depende de categorização manual (incompleta → margem inflada); (3) ficha técnica vazia → custo material 0 → margem inflada. Objetivo: alimentar com dado real + DENUNCIAR quando incompleto, nunca margem confiante sobre base furada.

**Parte 1 (ocupação real) [feita]:** `GET /api/precificacao/contexto/:mes` devolve `comandas`, `ocupacaoRealEstimada` (minutos usados ÷ disponíveis; agenda real se houver duração, senão comandas×50min) e `baseOcupacao`. `Precificacao.tsx`: ao lado do campo Ocupação mostra "Real estimada: X% [usar]" + aviso quando em 50% (chute) + preview ao vivo do custo/min ao mexer (antes de salvar). **Validado jun: real 18,7% vs chute 50%** → custo/min hoje subestimado ~2,7×, margens infladas. (Notado: totalFixas jun = R$60, quase nada categorizado → furo nº2.)

**Parte 2 (feita):** contexto devolve `qtdLancamentosFixos` (conta extrato categoria fixo/recorrente, exclui observação, + manuais 'fixo'). `Precificacao.tsx`: mostra "você marcou N lançamentos como fixo" + alerta amber quando ≤2 ("parece faltar fixa — aluguel/energia/água/internet/contador/sistemas; margem inflada") + Link "Categorizar fixas →" pra /lancamentos. Validado jun: 1 fixo (R$60) → alerta dispara.
**Parte 3 (feita):** `Precificacao.tsx` (frontend, usa `analysis` client-side já existente): selo de 2 níveis por serviço — `itemCount===0` → "⚠ sem ficha" (vermelho), `itemCount>0 && totalCost===0` → "⚠ ficha R$0?" (amber); banner topo "X de Y serviços sem ficha técnica — margem não confiável" (gate `summary.withoutCost>0`). Sem backend novo.
**Parte 4 (feita):** `Precificacao.tsx` (frontend): bloco "Dando prejuízo ou margem crítica (N)" no topo — serviços COM ficha e margem<15%, ordenados crescente, clicáveis (abre o detalhe), mostram preço/lucro-por-serviço/margem%/sugerido. Badge de confiança por linha: "● margem confiável" (verde) quando `baseConfiavel` (fixas>2 lançamentos E ocupação≠50%) E ficha (itens+custo>0); senão "● margem estimada" (amber, com tooltip do que falta). Sem backend novo. **v50 [concluído] — 4 partes no ar.**

### v49 — Reconstrução de Lançamentos (livro editável Itaú) [concluído] (18/06/2026)

**Visão do dono:** Lançamentos = lista editável de TODAS as entradas/saídas do Itaú, onde cada linha é **categorizada + justificada** (todas as categorias e regras à mão, pra entrada E saída). Ex.: "peguei dinheiro do caixa e repus" → categoria **neutra** + justificativa, não distorce o fechamento. No fim, **compara com a Trinks (API+CSV)**. Motivo: as 4-blocos+5-abas viraram um labirinto.

**Fase 1 (modelo, commit pendente) [feita]:** `expenseCategorias.ts` — novos `ExpenseTipo` **`faturamento`** (entrada) e **`neutro`** (não conta). Helpers `tipoConta()`/`TIPOS_ENTRADA`/`TIPOS_NEUTROS`. Seed novas categorias: Faturamento Serviço/Produto/Clube, Outras entradas, Reposição/Retirada de caixa, Transferência própria, Estorno, Aporte/Empréstimo. **Merge idempotente** em `ensureSeed` (prod ganha as novas no boot sem apagar). justificativa já tem endpoint (`PUT /api/expenses/bank/:id/justificativa`).

**Fase 2 (feita):** `ExtratoDetalhado.tsx` agora deixa categorizar **ENTRADAS** também (antes só saída mostrava dropdown; lista filtrada por `tipoContaCli`: entrada→faturamento+neutro, saída→despesa+neutro) + campo **justificativa** inline (PUT `/api/expenses/bank/:id/justificativa`) + filtro padrão "todas". `Lancamentos.tsx` reescrito: aba "Visão do Mês" = **resumo** (Entrou/Saiu/Sobra/A classificar + neutro) + **comparação Trinks** (extrato × canônico/API/CSV) + **`ExtratoDetalhado` embutido** (o livro editável). Removidos os 4 blocos antigos, a aba "Extrato detalhado" separada (virou a Visão) e o entulho. Abas agora: Visão · Banco/Importar extrato · Conciliação Trinks · Categorias & Regras.
**Fase 3 (feita):** endpoint **`GET /api/lancamentos/resumo/:mes`** agrega o Itaú por `tipoConta` (entrada/saída/neutro), `incluidoNoFluxo` respeitado, devolve entrou/saiu(porTipo)/neutro/aClassificar/sobra + `trinks{canonico,api,csvCaixa,csvFinanceiro}` + diff. Validado local: categorizar entrada (PIX 135→Faturamento Serviço) reflete no resumo; justificativa salva; auto-rules já classificam saídas (IOF→imposto). **v49 [concluído].**

**v49.1 (18/06):** "Gastos do Mês" (em `Consolidacao.tsx`, aba Banco) usava o enum legado `CategoriaGasto`+`CATEGORIAS_INFO` (lista chumbada). Convertido pro sistema editável: dropdown puxa `/api/expense-categorias` (todas as categorias de Categorias & Regras, exceto faturamento), grava via `/api/expenses/bank/:id/categoria` (categoriaId), agrega por categoriaId, cards usam nome/cor da categoria. `CategoriaSelector` recebe `cats` + usa categoriaId. Unifica a categorização num sistema só (acabou o fork enum vs ExpenseCategoria nessa tela).

### v48 — Modelo de contas: só Itaú conta; InfinitePay=observação; Santander removido (18/06/2026) [concluído]

**Regra de negócio (dono):** **Itaú = único extrato** que conta pro fechamento + conciliação Trinks. **InfinitePay = só observação** do Clube (acompanhamento de adimplência) — **NÃO entra na contabilidade**, e o extrato dele é importado na aba **Assinaturas**. **Santander = removido.**

**O que mudou:**
- `ContaConsolidacao` ganhou flag **`observacao?: boolean`** (POST /api/consolidacao/contas trata). Contas observação são **excluídas** de: conferência (funil), `computeTotaisDoMes` (despesas), e da tela do Banco (`Consolidacao.tsx` filtra contas+transações de observação → só mostra Itaú).
- **Assinaturas (`Assinaturas.tsx`):** o botão "Extrato InfinitePay" (que ia pra /consolidacao) virou **"Importar extrato InfinitePay"** in-place: sobe o CSV pra conta InfinitePay (observação) via `/api/consolidacao/upload-ia` + atualiza `sugestoes-extrato` (auto-match dos mensalistas). Import saiu de Lançamentos.
- **Dados (prod):** Santander deletado; InfinitePay marcado `observacao=true` (mantidas as 30 tx de Clube, que alimentam o auto-match das Assinaturas).

**Resultado:** Lançamentos/Conciliação só vê o **Itaú**. InfinitePay vive em Assinaturas, fora da contabilidade.

### v47 — Unifica navegação: Conciliação vira sub-aba de Lançamentos (18/06/2026) [concluído]

**Problema (dono):** dois itens de menu confusos — "Conciliação" (topo, `/conciliacao` = `Conciliacao.tsx`, ÓRFÃS do Trinks, NÃO importa extrato) vs a sub-aba "Conciliação Bancária" dentro de Lançamentos (`Consolidacao.tsx`, onde importa extrato). Dono procurou o extrato do Itaú no menu errado.

**Diagnóstico:** o extrato do Itaú NUNCA foi importado (conta ITAÚ tinha só 2 tx em junho; 30 tx estão na conta INFINITEPAY = Clube). Por isso o Bloco 3 zerado. Contas em prod: SANTANDER(transito), ITAÚ(destino), INFINITEPAY(transito).

**O que mudou (só frontend):**
- Removido o item de menu "/conciliacao" (`AppLayout.tsx`); rota `/conciliacao` agora redireciona pra `/lancamentos` (`App.tsx`), igual `/consolidacao`.
- `Lancamentos.tsx`: a página de órfãs (`Conciliacao`) virou sub-aba **"Conciliação Trinks"**. Sub-aba do banco renomeada "Conciliação Bancária" → **"Banco / Importar extrato"**. CTA **"Importar extrato do Itaú"** no Bloco 3 quando nada caiu no mês (leva pra aba do banco).
- Abas de Lançamentos agora: Visão do Mês · Banco/Importar extrato · Extrato detalhado · Conciliação Trinks · Categorias & Regras.

**Ação do dono:** importar o extrato do Itaú em Lançamentos → "Banco / Importar extrato" → conta ITAÚ. Aí o Bloco 3 casa.

### v46 — Lançamentos reorganizado em 4 blocos + conferência Itaú (Etapa 2) (18/06/2026) [concluído]

**Tema:** Etapa 2 do trabalho de Lançamentos (Etapa 1 = v45, blindagem). Reestrutura `Lancamentos.tsx` (aba "Visão do Mês") em 4 blocos claros, baseados no fluxo real do dono (Itaú = conta-funil única; InfinitePay só Clube, não soma no caixa).

**Blocos (frontend `client/src/pages/Lancamentos.tsx`):**
1. **O que entrou** — breakdown canônico de `/api/mes/:mes/dados` (crédito/débito/pix/dinheiro/**Clube**=plano, origem InfinitePay) + total. Blindado (v45).
2. **O que saiu** — `SumarioDespesas` (feed blindado) + card faturado/saídas/**sobra**.
3. **Conferência** — esperado × caiu no Itaú (novo endpoint), semáforo ±R$100, detalhe sob demanda, Clube "a caminho".
4. **InfinitePay** — adimplência do Clube via `/api/assinaturas/matriz-pagamentos?ate=mes&meses=1` (pago/atrasado/a-vencer); aviso "já contado no Bloco 1". Sem parser de extrato InfinitePay (decisão do dono).

**Endpoint novo (`server/routes.ts`): `GET /api/lancamentos/conferencia/:mes`** — esperado (breakdown canônico) vs caiu no Itaú, por forma **PIX · Cartão(créd+déb) · Dinheiro** (extrato Itaú não separa créd/déb). **Conta Itaú auto-detectada** (nome ~/itaú/ → destino de conta `transito` → única conta banco/única). Entradas de assinatura/Clube/InfinitePay → linha **Clube** (não Cartão). Clube status **a_caminho** (neutro) até `lancamentos_clube_dias` (kv, default 15), depois **pendente**; nunca vermelho de erro. Retorna `linhas`, `clube`, `detalhe` (por forma, pra expandir), `contaItau`, `temMensal`. Tolerância ±R$100.

**Validado local (prod data, junho):** Bloco1 total 40.975,55; Conferência → Itaú auto-detectado, Clube verde (caiu 3.113 vs esp 2.961); Bloco4 42 pago/0 atraso/15 a-vencer. Build verde.

**⚠ Bloco 3 precisa do EXTRATO do Itaú importado** pra casar PIX/Cartão/Dinheiro — em prod só havia lançamentos de Clube, então essas linhas ficam vermelhas (caiu 0) até o dono subir o extrato do Itaú em Conciliação Bancária. Mecanismo correto; falta o dado.

### v45 — Lançamentos blindado contra 429 (D2-fase2, Etapa 1) (18/06/2026) [concluído]

**Tema:** as linhas AUTO de Lançamentos (faturamento/comissão/material) liam o `full_sync` da Trinks AO VIVO e ZERAVAM em 429. Agora vêm da fonte canônica v42. (Etapa 1 de 2; Etapa 2 = reorganizar a tela em 4 blocos, ainda pendente.)

**O que foi entregue (só `server/routes.ts`):**
- Helper único **`construirEntradasAuto(mes)`** (reusado por `GET /api/financeiro` e `computeTotaisDoMes`): receita ← `getMesDataCanonical` (mês fechado=CSV, nunca Trinks; corrente=API c/ fallback); comissão ← `montarEquipeDeRanking` (dedup por id, mesmo motor do Pagamento — **NÃO** somar `getRankComissaoMap.keys`, que tem 3 chaves/prof e triplica); material só com agendamentos ao vivo, senão omite c/ nota (nunca fake).
- `GET /api/financeiro` virou **async** e respeita **`?mes=`** (corrigido bug do `now` que ignorava o mês).
- **Preservada** a granularidade diária da receita no `Financeiro.tsx` (shape de `mesService.transacoes` é compatível). **Mudança de comportamento:** comissão no razão vira 1 linha mensal (ranking) em vez de diária.

**Validado local (Trinks em 429):** junho → faturamento R$40.975,55 + comissão R$16.372,40 (= idêntico ao `/api/pagamento`; contém André 5.584,50 / Armandinho 2.357,20), não zera. Maio (sem ranking) → receita CSV 87.900,99, comissão ao vivo. Build verde.

**Pendente:** Etapa 2 — reorganizar `Lancamentos.tsx` em 4 blocos (Entrou/Saiu/Conferência Itaú/InfinitePay). Conferência por forma = PIX·Cartão(créd+déb)·Dinheiro (extrato Itaú não separa créd/déb); Clube Greco = "a caminho" (não erro), InfinitePay não soma no caixa (só adimplência).

### v44 — Ranking de Clientes: parser + endpoint + cards (18/06/2026) [concluído]

**Tema:** dar vida ao CSV "Ranking de Clientes" (até então NÃO importado — `detectTrinksType` o rejeitava) e adicionar os cards de cliente no Dashboard. Continuação da Fase 1/v43.

**O que foi entregue:**
- **`server/trinksImport.ts`** — tipo `"clientes"` em `TrinksImportType`; interfaces `RankingClienteRow`/`ClientesPayload`; `parseClientes(text)` (preâmbulo «entre DD/MM e DD/MM» → mês; 14 colunas; `novoCliente`=Sim); detecção (assinatura "nome cliente"+"visitas com pagamento", sem colisão); roteamento em `parseTrinksCsv`; branch em `summarize`. Persistência reusa o fluxo genérico → chave `trinks_import:clientes:YYYY-MM`.
- **`server/routes.ts`** — `GET /api/clientes/ranking/:mes` (agregados no servidor, **sem PII**): cards do mês (`totalClientes`, `novosNoMes`, `recompraPct`, `ticketMedioClientes`) vêm do export MENSAL; `clientesSumidos` (>60d vs hoje TZ SP, cap 20, **mais recuperáveis 1º**) vem da BASE. Flags `temMensal`/`temBase` + `clientesSumidos.fonte`. Mês fechado = CSV persistido, nunca Trinks ao vivo; sem nenhum → `{vazio:true}`. Branch de preview p/ clientes (top5 por gasto + `role`, sem contato). Regex GET/DELETE `:tipo/:mes` aceita caixa|clientes.
- **`client/.../Dashboard.tsx`** — fetch `/api/clientes/ranking/:mes` + 4 cards no bloco "Resumo do Mês": Clientes/novos, Recompra, ⚠ Sumidos (60+) com popover da lista, Ticket/cliente.
- **`client/.../ImportarTrinks.tsx`** — tipo/label/ícone (UserPlus), `<PreviewClientes>`, coluna "Clientes" na Cobertura mensal (agora 4 tipos: financeiro/dre/ranking/clientes), textos-guia.

**Decisões do dono:** (1) endpoint NÃO expõe email/telefone (Dashboard roda em PC público; contato fica no kv); (2) sumidos ordenados por mais recuperáveis (menor dias 1º); (3) Clientes entra na matriz de Cobertura.

**Validado local c/ dados reais (junho, arquivo `~/Downloads/...rankingDeClientes.csv`):** preview→confirm→endpoint OK. 348 clientes · 32 novos · recompra 15,8% · ticket/cliente R$117,71. Build verde (vite 3,98s).

**Papéis separados (decisão do dono 18/06):** o "Ranking de Clientes" mistura 2 conceitos que não cabem num CSV só. **Export MENSAL** (janela ≤35 dias) → chave `clientes:YYYY-MM` (pelo mês FINAL) → cards do mês (novos/recompra/ticket, significado mensal). **Export LONGO** (janela >35 dias) → chave dedicada `clientes:base` → fonte do card de sumidos (clientes que sumiram há +60d, vs hoje). Roteamento automático por `clientesEhBase()`/`clientesKvKey()` em trinksImport.ts. O endpoint lê os dois e devolve `temMensal`/`temBase`/`clientesSumidos.fonte`. **Fluxo do dono:** subir 1 export mensal (cards do mês) + 1 export longo periódico (base de sumidos). Validado 18/06: mensal jun 348/32/15,8% + base Jan–Jun → 460 sumidos.

> **Refinos futuros (não-bloqueantes):** a base traz duplicatas do Trinks (mesmo cliente 2×) e clientes marcados "(Inativo)" no nome — inflam levemente os sumidos. Dedup/filtro de inativos = melhoria futura (o grecometas tem máquina de dedup; este app não).

### v43 — Resumo Executivo do mês no Dashboard (17/06/2026) [concluído]

**Tema:** bloco "Resumo do Mês" no topo do Dashboard, 100% alimentado pela fonte canônica (não quebra em 429). Entrega de quebra o item de UX #7 ("vs mês anterior").

**O que foi entregue (3 arquivos):**
- **`server/routes.ts`** — `/api/mes/:mes/dados` agora devolve os campos que o `mesService` já calculava e eram descartados: `faturamento`, `comandas`, `breakdown`, `diasUteisDecorridos`, `diasUteisTotal` (dias úteis ter-sáb via `contarDiasUteis`, TZ SP). `/api/equipe/mes` (`montarEquipeDeRanking`) ganhou agregados de cliente do ranking: `novosClientes`, `clientesDistintos`, `pctRetornoMedio` (retenção ponderada por atendimentos).
- **`client/src/hooks/useTrinksMonth.ts`** — expõe os campos canônicos (`canonico`).
- **`client/src/pages/Dashboard.tsx`** — bloco "Resumo do Mês": hero faturamento + projeção fim-do-mês vs meta (R$150k), cards (ticket / comandas-por-dia-útil / serviços-produtos / retenção+novos), top-5 profissionais e comparação **vs mês anterior** (faturamento e ticket). Hero usa `canonicoMes.faturamento` (caixa CSV); cards de produção usam o ranking.

**Validado local c/ dados reais (junho/2026):** `/api/mes/2026-06/dados` → fonte `csv`, faturamento R$40.975,55, comandas 414, 12/21 dias úteis. `/api/equipe/mes/2026-06` → ticket R$73,82, serviços R$36.752,25, produtos R$2.445,30, 39 novos, retenção 92%. Regressão bate: **André comissão R$5.584,50 · Armandinho R$2.357,20**. Build verde (vite 4,27s + esbuild). 0 chamadas Trinks.

**Pendências (inalteradas — fila do D2):** D2-fase2 (produtos/plano/bônus zeram em 429, R$2.554 jun fora da folha) segue sendo a nº1.

### v42 — Unificação de fontes (handoff da sessão 15/06/2026) [concluído]

**Tema:** substituir "fontes concorrendo" por **divisão de trabalho** (cada fonte governa a janela/domínio onde é melhor), com degradação graciosa — Trinks em 429 nunca mais zera ou pendura uma tela. Entregue em commits incrementais (v42 → v42.5), todos no `main`, deployados e validados em produção.

**Commits / o que foi entregue (em ordem):**

- **`5a7b73f` + `db3551e` — Núcleo:**
  - `mesService.getMesData` (`server/mesService.ts:256-274`): trocado o score "mais completa" por **janela-de-tempo**. Mês fechado → CSV sempre, **API Trinks nunca** (era a origem do timeout ~12-20s). Faturamento do mês = **CSV-Financeiro** (fechado E corrente), caixa fallback.
  - Removido o "API-first pra meses passados" em `/api/mes/:mes/dados` (`routes.ts`, antigo bloco ~4919-4962) + guarda "mês fechado sem CSV retorna vazio na hora" + timeout curto (4s, `lerApiTrinksComTimeout`) na API do dia corrente.
  - Comissão por categoria (`server/comissaoCategoria.ts`): `comissaoServicosRanking` = apelido antes do hífen × `Total Serviços`. André VIP 50% · Pedro/Lucas/José Armando(Armandinho)/Matheus Clássico 40% · César/Leonardo Express 50% · Débora/Ellen/Patrícia Assistente 40%. Não-mapeado c/ serviços>0 → aviso `semCategoria`, nunca zero silencioso.
  - `fonteResolver.ts` (resolverFonte): **rebaixado** — não decide mais a fonte *exibida* do mês (autoridade = `mesService.getMesData`/`getMesDataCanonical`). **Ressalva:** NÃO é código morto — segue fazendo *gating de chamadas à API* em sync-mes/cron e fornecendo timestamps de badge.
  - Criado `ARQUITETURA.md`.

- **`03e460e` (v42.2) — Não-comissionável:** `NAO_COMISSIONAVEL` + `ehNaoComissionavel()` em `comissaoCategoria.ts`. Guilherme (ex-barbeiro, hoje administrativo) = R$ 0 intencional, fora do banner. Distinção no código: "não-mapeado (alerta)" vs "não-comissionável (silencioso)".

- **`c36b0ae` (v42.3 / D2) — Motor único de comissão de serviços:** `calcularLinhaPagamento` (`routes.ts:9273`) recebe override; `/api/pagamento/:mes` (serve Pagamento + Lançamentos + recibo + folha + cron) usa `comissaoServicosRanking` quando há ranking do mês, senão cálculo ao vivo. Helper `getRankComissaoMap` (cache por mês, limpo no import confirm). Antes zerava em 429.

- **`c0729f8` (v42.4 / Bloco 1) — Equipe e Metas no ranking CSV:** helper `montarEquipeDeRanking` (dedup por id → resolveu o "André dobrado"); `/api/equipe/mes` usa ranking quando existe. Removido o **fallback demo-data** da Equipe (`Equipe.tsx`) e a **comissão fake `revenue×0.4`**. Metas puxa o mês de `/api/equipe/mes` (dia/semana seguem ao vivo). Badge de fonte (`comissaoServicosFonte`) + coluna Comissão. `/api/equipe/desempenho` NÃO foi tocado.

- **`d107586` (v42.5 / D3) — MeuPainel:** `/api/meu-painel` (async) usa `montarEquipeDeRanking` p/ o mês do barbeiro (faturamento, clientes, comissão); dia/semana seguem ao vivo (`full_sync`). Novo campo `comissaoMes`. Corrige barbeiro vendo R$ 0 no próprio painel em 429 — última tela da família "429 → zero".

**Autoridade canônica (resultado):** totais do mês → `mesService.getMesData`; por-profissional (comissão/desempenho) → ranking CSV × categoria (`montarEquipeDeRanking` / `comissaoServicosRanking`). Regra de gatilho: tem ranking do mês → ranking (congelado); sem ranking → ao vivo (preserva o dia corrente).

**Regressão validada em produção (junho):** André R$ 5.584,50 · Armandinho R$ 2.357,20 · Larissa R$ 622,10 batem em **Pagamento, Lançamentos, Metas, Equipe e MeuPainel**. Maio (sem ranking) segue ao vivo. Meses fechados respondem do CSV com **0 chamadas Trinks** (`requestsThisMonth=0`).

**Dados importados em prod (junho):** ranking de profissionais + financeiro (R$ 41.003,55, "Data Prevista de Recebimento") + caixa reimportado completo (437 comandas, R$ 41.105,55, corrigindo caixa incompleto de R$ 20.602). Rastreio: exibido R$ 40.975,55 = financeiro bruto R$ 41.003,55 − R$ 28 (2 linhas de atendimento 27/05 pagas em jun).

> **Pagamentos FECHADOS** (`pagamentos.ts`) mantêm snapshot histórico imutável por design; a comissão por categoria recalcula retroativo no caminho ao vivo a cada consulta.

**Pendências abertas (fila recomendada):**
1. **D2-fase2** — comissão de produtos/plano/Clube/bônus/salário ainda vem do cálculo ao vivo (zera em 429). **Impacto: junho tem R$ 2.554 em produtos fora da folha.** Blinda a folha de vez — fazer primeiro.
2. **Conciliação** (`/api/conciliacao/orfas`) lê Trinks ao vivo — trava se a API cair durante o fechamento. Atacar antes do fechamento de junho.
3. **D4** — VendasProdutos e CaixaDia ainda leem Trinks ao vivo em dias passados.
4. **UX** — exportar folha (#4), exportar DRE pro contador (#5), fechar mês inteiro de uma vez (#6), "vs mês anterior" nas demais abas (#7).

### Mais recente vence — CSV vs Trinks [concluído]

Regra: para cada mês, comparamos o timestamp de upload do CSV com o de sync Trinks. O **mais recente vence** e é a fonte usada em todo o sistema (Dashboard + Equipe). Badge discreto indica a fonte ativa.

- **Backend**:
  - `server/trinksSyncMeta.ts` (NOVO) — helpers `getSyncMeta`, `setSyncMeta`, `registrarSyncTrinks`. Persiste em `kv_store` com chave `trinks_sync_meta:YYYY-MM`.
  - `registrarSyncTrinks` integrado em `/api/trinks/sync` (mês corrente) e `/api/trinks/sync-mes/:mes` — grava timestamp só quando dados Trinks vêm saudáveis (ag>0 e tr>0).
  - `server/fonteResolver.ts` (NOVO) — `resolverFonte(mes)` retorna `{ fonte, trinksAt, csvAt, motivo }` e converte CSV financeiro em "transações sintéticas" no mesmo formato dos adapters (`getTrindsDailyRevenueChart`, `getTrinksPaymentMethodData`).
  - Novos endpoints: `GET /api/mes/:mes/fonte` (meta leve) e `GET /api/mes/:mes/dados` (TrinksData da fonte vencedora + meta + fallback Trinks→CSV em 429).
- **Frontend**:
  - `client/src/components/dashboard/FonteBadge.tsx` (NOVO) — badge reutilizável: ícone Database (Trinks verde) ou FileSpreadsheet (CSV âmbar) + "há Xmin/h/dias".
  - `Dashboard.tsx` agora chama `/api/mes/:mes/dados` para mês não-corrente e `/api/mes/:mes/fonte` para o corrente. Renderiza `FonteBadge` no header de mês.
  - `MetasEquipePainel.tsx` consulta `/api/mes/:mes/fonte` antes de decidir entre `/api/equipe/desempenho` (live) e `/api/equipe/desempenho-import/:mes` (CSV). Renderiza o mesmo `FonteBadge`.

Validado em produção: Abril/2026 mostra `Fonte: CSV · há 1 dia`, faturamento R$ 80.486,20 reconstruído do CSV financeiro, navegação ok.

### Dashboard com seletor de mês [concluído]

- **Backend**: novo endpoint `GET /api/trinks/sync-mes/:mes` (routes.ts · após `/api/trinks/sync`) que retorna o mesmo formato de TrinksData para um mês arbitrário (YYYY-MM). Usa `trinksFetchAllRange` (otimização A) e herda TTL 24h em meses fechados (otimização C).
- **Frontend (Dashboard.tsx)**:
  - State `selectedMes` persistido em `localStorage` com chave `dashboard.selectedMes`.
  - Header com botões `‹ [Mês Ano] ›` + botão "Voltar para mês atual" quando mês ≠ corrente.
  - Próximo mês desabilitado quando já é o corrente (não navega para futuro).
  - Quando `selectedMes ≠ mesCorrente`, fetch assíncrono de `/api/trinks/sync-mes/:mes` e o resultado alimenta `trinksEffective` que substitui `trinks` nos adapters `getTrinks*`.
  - Cards diários (`Hoje · tempo real`, `Previsão de Amanhã`) escondidos em mês passado.
  - Cards "Hoje" e "Esta Semana" do trio inicial escondidos em mês passado; resta o "Mês" centralizado.
  - `DashboardImportSummaryCard` recebe `mes={selectedMes}` para refletir o mês escolhido.
- Helpers: `mesAtualSP()`, `mesAdjacente(mes, delta)`, `labelMesPtBR(mes)` no topo de Dashboard.tsx.

Validado em produção: navegação de Maio/2026 → Abril/2026 funcional, cards diários escondem corretamente, card mensal mostra R$ 82.713,60 (CSV+Trinks), botão de retorno funciona.

### Otimização tokens Trinks F [concluído]

- **F** — Cron das 8h consolidado: o resumo geral (`calcularHojeCompleto + Ontem + Amanha`) roda primeiro e, ao final, encadeia `dispararIndividualParaTodos("matinal")` no MESMO cron. Antes: 2 crons disparavam às 8h00 simultaneamente disputando rate limit. Agora: cache já quente → matinal individual reaproveita agendamentos/transacoes via `trinksFetchAllRange` (zero fetches a mais por profissional).
- B avaliado e considerado já coberto pela Etapa 3 (frontend usa endpoints `-import` para histórico via seletor; fallback CSV ativa quando API ao vivo retorna vazio). Pagamento mensal segue precisando das bases finas da Trinks (servicosLiquido, taxaCartao etc.) que o CSV de ranking não tem.

### Otimização tokens Trinks A+C+E [concluído]

- **A** — `trinksFetchAllRange` (routes.ts · após `trinksFetchAll`): reuso de janela maior cacheada para janelas menores (mês → dia/semana). Aplicado em `agendamentos` e `transacoes` dentro de `calcularPeriodoPorProfissional`. `/api/equipe/desempenho` agora calcula mês PRIMEIRO para povoar o cache.
- **C** — TTL estendido para 24h em `agendamentos`/`transacoes`/`lancamentos` quando `dataFim < 1º dia do mês corrente (SP)`. Mês corrente segue 30min. Aplicado dentro de `trinksFetchAll`.
- **E** — Throttle module-level no `Dashboard.tsx`: `dashFetchCache` reusa payload de `/trinks/hoje`, `/hoje-completo` e `/amanha` por 3 min entre montagens.

Validação após deploy: `/api/version` ok, `/api/equipe/desempenho` retorna estrutura íntegra, `/api/equipe/desempenho-import/2026-04` segue retornando 23 linhas / R$ 75.571,20.

### v25 — Importação Trinks (CSV) [concluído]

- Etapa 1: parsers (financeiro/DRE/ranking) + endpoints upload/preview/confirm/list/delete
- Etapa 2: aba `/importar-trinks` (drag-drop, preview, confirmação, lista, deletar)
- Etapa 3: integração com Equipe e Dashboard
  - Endpoint `GET /api/equipe/desempenho-import/:mes` (formato compatível com `/api/equipe/desempenho`)
  - Endpoint `GET /api/dashboard/import/:mes` (resumo financeiro+DRE+ranking)
  - Tela Equipe: fallback automático quando API ao vivo retorna 0; badge "Dados via CSV importado"; seletor de mês para histórico
  - Dashboard: novo card `DashboardImportSummaryCard` (financeiro/DRE/top profs) aparece quando há import do mês atual
  - Janelas dia/semana ficam desabilitadas quando fonte = CSV (ranking é mensal)
  - Conserva intacta a integração original `calcularPeriodoPorProfissional` — quando Trinks API voltar, ela prevalece automaticamente

## Stack

**Backend**: Express + Drizzle (Postgres Railway) + kv_store + node-cron · persistência mista (kv_store + arquivos flat)
**Frontend**: React + Vite + Tailwind + shadcn/ui + wouter + react-query + zustand (`trinksStore`)
**Helpers úteis**:
- `apiRequest` em `client/src/lib/queryClient.ts`
- `formatCurrency` / `formatPercent` em `client/src/lib/demoData.ts`

## Padrão de deploy

```bash
cd /home/user/workspace/greco-control
npm run build
git -c user.email="fredlasmar@gmail.com" -c user.name="Fred Lasmar" add -A
git -c user.email="fredlasmar@gmail.com" -c user.name="Fred Lasmar" commit -m "..."
git -c user.email="fredlasmar@gmail.com" -c user.name="Fred Lasmar" push origin main
# api_credentials=["github"] no push
sleep 110 && curl -s https://grecocontrol.com.br/api/version
# Railway demora 100-180s para deploy completar
```

> `routes.ts` tem erros TS pré-existentes desde v17 — o build via tsx/esbuild ignora. Não tentar consertar.

## Regras de produto inegociáveis

1. Comunicação **sempre em pt-BR** (UI, commits, mensagens)
2. **NÃO refazer** o que já existe. Adicionar ou alterar o mínimo possível.
3. Manter **consistência visual** com o resto do app.
4. Se uma mudança quebrar algo funcional, **avisar antes**.
5. A **integração Trinks** que funciona deve continuar funcionando.
6. **Categorias EXCLUSIVAS** dos profissionais:
   - André → só VIP
   - Pedro Henrique, Lucas Pacheco, José Armando, Matheus → só Clássico
   - César, Leonardo → só Express
   - Débora, Ellen, Patrícia → Assistente/Estética
7. Quando regras mudarem, **recalcular retroativo** todos os meses passados.
8. Parâmetros operacionais ficam **no topo da Precificação**, visíveis (opção B).
9. **Nunca expor** token Telegram bot abertamente.
10. TZ `America/Sao_Paulo`, semana operacional ter-sáb.

## Defaults v24

| Parâmetro | Valor |
|---|---|
| Cadeiras | 9 |
| Horas/dia | 12 |
| Dias/mês | 22 |
| Ocupação | 50% |
| Taxa cartão | 3,5% |
| Comissão VIP/Express | 50% |
| Comissão demais | 40% |
| Margem desejada — Cortes/Barbas/Combos | 30% |
| Margem desejada — Químicas/Estética | 35% |
| Margem desejada — Depilação/VIP | 40% |

`minutosProdutivosMes = cadeiras × horasDia × 60 × diasMes × (ocupacaoPct/100)` = **71.280** com defaults
`custoFixoPorMinuto = totalFixas / minutosProdutivosMes`

## Fórmulas v24

```
custo_fixo_rateado = duracao × cfm
comissao_R$        = preco × (comissao_% / 100)              ← MODO PADRÃO
custo_total        = ficha + custo_fixo_rateado + comissao_R$
margem_real_R$     = preco − custo_total
preco_sugerido     = (ficha + custo_fixo_rateado) ÷ (1 − com% − margem%)
```

Erro se `(com + margem) ≥ 100%`.

**Modo simulação** (toggle "Travar custo antes da comissão" no header da Precificação):
```
comissao_R$ = max(0, preco − ficha) × (comissao_% / 100)
```
Não persiste — só recalcula visualmente client-side.

## Endpoints v24 (novos)

- `GET  /api/financeiro/totais/:mes` — despesas fixas/variáveis/etc agregadas
- `GET  /api/financeiro/comissoes-debug/:mes` — log antes/depois (recálculo retroativo)
- `GET  /api/config/operacional/custo-fixo-minuto/:mes`
- `GET  /api/precificacao/contexto/:mes` — pacote operacional consolidado
- `POST /api/precificacao/calcular` — cálculo expandido por serviço

## Arquivos-chave v24

- `server/configFinanceira.ts` — `ConfigFinanceira` com cadeiras/horas/dias/ocupação + `calcularCustoFixoPorMinuto()`
- `server/comissaoCategoria.ts` — categorias VIP/Express/Padrão + `getComissaoPctDoServico()` + `calcularMargemServico()` + defaults de margem
- `server/routes.ts` — endpoints novos + `computeTotaisDoMes()` helper + `ServiceCostEntry` com overrides
- `client/src/pages/Precificacao.tsx` — painel operacional no topo + toggle modo simulação + coluna "Sugerido" + fórmula expandida client-side

## Histórico de versões recentes

| Versão | Data | Resumo |
|---|---|---|
| v17 | (anterior) | Erros TS pré-existentes em routes.ts (ignorar) |
| v22 | (anterior) | (consultar git log se necessário) |
| v23 | (anterior) | (consultar git log se necessário) |
| **v24** | 29/04/2026 | Precificação com custo fixo + comissão por categoria + modo simulação |
| **v25** | (próximo) | Inserção manual de dados (operar sem Trinks) |

## Estado externo

- **Trinks API**: HTTP 429 desde 28/04/2026 ~14h40 — não dá para validar com dados reais. Estabelecimento `238676`, rate `40/min`, `4500/mês`.
- 44 inventários manuais salvos no `kv_store` intactos.

## Credenciais (referência rápida — não compartilhar)

- Login app: `admin` / `admin123`
- Telegram: `@fredgreco_bot`, chat `5565354217` (token nunca expor)
- Git: `fredlasmar@gmail.com` · Fred Lasmar
- Repo: `fredlasmar1/greco-control` (push com `api_credentials=["github"]`)

## Próximo plano — v25 (decidido com o Fred em 29/04/2026)

**Objetivo**: operar o sistema mesmo com Trinks em 429.

**Decisões já tomadas:**
- Prioridade: **ambos os tipos de lançamento manual, com FATURAMENTO AGREGADO PRIMEIRO** (rápido), depois agendamento individual.
- Conflito quando Trinks voltar: **Trinks prevalece** sobre o manual. Os dados manuais do mesmo período viram histórico/auditoria (não somam, não duplicam).

**Etapas sugeridas (a confirmar na próxima sessão):**
1. Schema + persistência de "faturamento manual diário" (totais por profissional, categoria, forma de pagamento) — kv_store provavelmente basta
2. Tela de lançamento agregado (1 form por dia, ter-sáb)
3. Integrar dados manuais nos endpoints/dashboards que hoje dependem da Trinks (com flag `fonte: 'manual' | 'trinks'`)
4. Tela de lançamento por agendamento individual
5. Lógica de "Trinks prevalece": ao receber dados Trinks de um dia que tem manual, marcar manual como `superseded` e exibir avisos
6. Build/commit/push/deploy
