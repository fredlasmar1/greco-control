# Greco Control — Notas de Estado

> Arquivo de continuidade entre sessões. Atualize ao final de cada plano.

## Versão atual em produção

- **Build**: `2026-05-01-fonte-mais-recente` (commit `cf1897e`)
- **URL**: https://grecocontrol.com.br/
- **Healthcheck**: `GET /api/version`

### v42 — Divisão de trabalho de fontes (CSV + Trinks) [concluído 15/06/2026]

Substitui "qual fonte vence" (score) por **"cada fonte governa a janela/domínio onde é melhor"**, com degradação graciosa (Trinks cair NUNCA pendura o mês).

- **`mesService.getMesData`**: removido o score `0.7×fat+0.3×comandas`. Regra nova:
  - Mês **fechado** → CSV sempre; API Trinks **nunca** (`ignorarApi` forçado).
  - **Domínio do faturamento** (fechado E corrente) → **CSV-Financeiro** (único líquido de troco + breakdown PIX/cartão/dinheiro/depósito/voucher); CSV-Caixa é fallback (pode vir incompleto — junho caixa R$20,6k vs financeiro R$41k); API só sem nenhum CSV.
  - `lerApiTrinksComTimeout` — timeout curto (4s), falha isolada.
- **`/api/mes/:mes/dados`**: removido o "API-first pra meses passados" (origem do timeout ~12s) + guarda que faz **mês fechado sem CSV retornar vazio na hora** (era 20s tentando a API, ex.: março).
- **`comissaoCategoria.ts`**: `comissaoServicosRanking` — comissão R$ = `Total Serviços` × % da categoria, match por **apelido antes do hífen** (André VIP 50% · Pedro/Lucas/José Armando/Matheus Clássico 40% · César/Leonardo Express 50% · Débora/Ellen/Patrícia Assistente 40%). Profissional com serviços>0 sem categoria → `semCategoria` (aviso UI + log), **não** comissão zero silenciosa.
- **Equipe (`MetasEquipePainel.tsx`)**: banner "N profissionais sem categoria".

Validado em produção: maio/abril respondem `csv-financeiro` em ~1s com **0 chamadas Trinks** (`requestsThisMonth=0`); março (sem CSV) vazio em 0,6s. Regressão de comissão com ranking real de junho: **André R$5.584,50 · Armandinho R$2.357,20** ✓. LARISSA (R$1.555 serviços) sinalizada. Junho importado em prod (ranking + financeiro R$41.003,55).

> Snapshots de pagamento já FECHADOS (`pagamentos.ts`) mantêm valores históricos por design (imutáveis); a comissão por categoria recalcula retroativo no caminho ao vivo (desempenho-import) a cada consulta.

### v42.1 — Follow-up (autoridade única + Larissa) [concluído 15/06/2026]

- **Autoridade única de fonte**: a decisão de qual fonte representa o mês é
  EXCLUSIVA do `mesService.getMesData`. O badge `/api/mes/:mes/fonte` agora deriva
  a fonte do mesService (antes usava `resolverFonte`/csv-first em paralelo, podia
  divergir do número). `fonteResolver.resolverFonte` rebaixada a helper de
  metadados (timestamps) + gating de API em sync-mes/cron — sem poder de decisão.
- **Larissa cadastrada** em `comissaoCategoria.ts` (apelido "larissa" → Assistente
  40%). Comissão sai de `Total Serviços` (parte de assistente, ~R$1.555 jun), nunca
  de `Valor Total`. Recálculo retroativo é automático (desempenho-import recomputa
  do ranking a cada consulta); saiu do banner "sem categoria".
- **Caixa de junho reimportado** completo: 437 comandas R$41.105,55 (antes 240/R$20,6k
  incompleto). Conciliação jun: 0 órfãs.
- **Rastreio jun**: exibido R$40.975,55 = financeiro bruto R$41.003,55 − R$28 (2
  linhas de atendimento em 27/05 pagas em jun: +R$40 PIX Otávio, −R$12 troco).
  Obs: `/api/conciliacao/orfas` lê Trinks ao vivo (não o CSV de caixa).

### v42.2 — Não-comissionável (administrativo) [concluído 15/06/2026]

Distingue no código **"não-mapeado (alerta)"** de **"não-comissionável por definição (silencioso)"**. Novo `NAO_COMISSIONAVEL` em `comissaoCategoria.ts` + flag `naoComissionavel` em `ComissaoRankingResult` e `ehNaoComissionavel()`.
- **Guilherme** (ex-barbeiro, hoje administrativo): comissão R$ 0 **intencional** em todos os meses, categoria "Administrativo", **fora** do banner de "sem categoria". Abril não recalcula (resíduo R$330 já acertado por fora; comissão dele sempre foi 0).
- Banner de não-mapeados só pega `mapeado=false` (cadastro faltando). Admin tem `mapeado=true, naoComissionavel=true`.

### v42.3 — D2: motor único de comissão de serviços [concluído 15/06/2026]

Unifica a comissão de **serviços** numa fonte só. `calcularLinhaPagamento` agora usa
`comissaoServicosRanking` (ranking CSV × categoria, regra v42 — **sem duplicar**)
**sempre que existir ranking importado do mês** (gatilho = "tem ranking", cobre
fechados E o corrente já exportado). Sem ranking → cálculo ao vivo
(`baseComissaoServicos × pctServico`). Helper `getRankComissaoMap(mes)` (cache por
mês, limpo no import confirm); join nome→ranking por nome completo/apelido/resto.
Cobre os 5 call-sites (Pagamento, Lançamentos, recibo, folha, cron) de uma vez.

Antes: Pagamento mostrava comissão R$ 0 em mês fechado (Trinks 429 → `servicosLiquido=0`),
enquanto a Metas mostrava o valor real do ranking. Agora as 3 telas batem.
`pctServico` individual de todos os barbeiros já = % da categoria (sem acordo
individual a preservar); única exceção era Larissa (0%→40%, corrigido).

> **DÍVIDA ABERTA — D2-fase2:** em mês fechado, a comissão de **produtos, plano,
> Clube Greco, bônus e salário** ainda vem do **cálculo ao vivo** (zerada quando
> Trinks 429). Falta migrar essas bases pro ranking/CSV. **Impacto conhecido:
> junho tem R$ 2.554 em produtos cuja comissão NÃO entra na folha até resolver.**

### v42.4 — Bloco 1: Equipe/Metas no ranking CSV [concluído 15/06/2026]

Estende o motor do D2 pras telas Equipe e Metas (itens #1+#2+#8 do raio-x).
- **#1 (servidor):** novo helper `montarEquipeDeRanking(mes, metas)` — per-profissional
  do mês a partir do **ranking CSV** (receita = `Valor Total`, comissão via
  `comissaoServicosRanking`, **deduplicado por id** → some o "André dobrado"),
  join nome→id por nome-após-hífen/apelido. `/api/equipe/mes/:mes` usa ranking
  quando existe (`fonte:'ranking-csv'`), senão cálculo ao vivo (`'ao-vivo'`).
  Metas passou a puxar o **mês** sempre de `/api/equipe/mes` (dia/semana seguem
  ao vivo via `/api/equipe/desempenho` só no corrente). `/api/equipe/desempenho`
  NÃO foi tocado.
- **#2 (frontend):** removido o fallback **demo-data** da Equipe (`Equipe.tsx`) —
  sem dado agora é estado "sem dados" honesto, nunca número fictício. Também
  removida a comissão FAKE `revenue×0.4` → usa a comissão real (ranking×categoria).
- **#8:** badge de fonte (CSV definitivo / ao vivo) na Equipe e na Metas + coluna
  "Comissão" na Metas.

Validado: junho `ranking-csv` R$39.197,55 (André sem duplicar; comissão 5.584,50 /
Armandinho 2.357,20 / Larissa 622,10 — bate Pagamento/Metas); maio `ao-vivo`
(preserva o caso sem ranking). Não tocado: D2-fase2, D3-MeuPainel, D4.

### v42.5 — D3 MeuPainel no ranking CSV [concluído 15/06/2026]

`/api/meu-painel` (agora async): o faturamento/clientes/comissão do **MÊS** do
barbeiro vêm do ranking CSV quando existe (reusa `montarEquipeDeRanking`),
`fonteMes:'ranking-csv'`. Dia/semana seguem do `full_sync` ao vivo (intradiário).
Sem ranking → tudo ao vivo. Novo campo `comissaoMes` (o barbeiro passa a ver a
comissão de serviços). Frontend: comissão + badge de fonte no painel.

Antes: barbeiro via faturamento ZERO no próprio painel em 429 (full_sync vazio).
Era a última tela da família "429 → zero" (Dashboard/Equipe/Metas/Pagamento já ok).

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
