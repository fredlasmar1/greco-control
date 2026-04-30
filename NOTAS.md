# Greco Control — Notas de Estado

> Arquivo de continuidade entre sessões. Atualize ao final de cada plano.

## Versão atual em produção

- **Build**: `2026-04-29-trinks-import-v25-etapa3` (commit `fe612c0`)
- **URL**: https://grecocontrol.com.br/
- **Healthcheck**: `GET /api/version`

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
