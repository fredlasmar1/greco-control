# Arquitetura — Greco Control

Painel financeiro e operacional da **Greco Barbearia (Anápolis)**. Centraliza
faturamento, equipe, comissões, metas, estoque, conciliação bancária e
fechamento mensal, cruzando dados da **API Trinks** (sistema de agenda/PDV) com
**CSVs exportados** do próprio Trinks.

> **Produção:** Railway projeto `zestful-elegance` → serviço `greco-control` +
> Postgres. Domínio: **grecocontrol.com.br**. Repo: `fredlasmar1/greco-control`.

---

## 1. Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js + `tsx` (TypeScript sem build em dev) |
| Backend | Express (1 processo, porta `PORT` / 5000) |
| Frontend | React 18 + Vite + Wouter (routing **hash-based**) |
| UI | Tailwind + shadcn/ui (Radix) + lucide-react + recharts + framer-motion |
| Estado (client) | Zustand (3 stores) + TanStack Query |
| Persistência | **Postgres** (tabela KV única) com **fallback em arquivos JSON** |
| Auth | express-session + passport-local (sessão em memória) |
| IA | `@anthropic-ai/sdk` (Conselheiro / análise financeira) |
| Agendamento | `node-cron` (resumos Telegram, snapshots, pré-fetch Trinks) |
| Planilhas | `xlsx` + `multer` (upload e parse de CSV/XLSX) |

Não há ORM relacional em uso: `drizzle` está nas deps mas o armazenamento real é
um **key-value** sobre Postgres (ver §4). `shared/schema.ts` define apenas tipos
TypeScript/Zod, não tabelas.

---

## 2. Topologia de pastas

```
client/src/
  pages/         22 telas (Dashboard, Equipe, Financeiro, Fechamento, Metas,
                 Estoque, Assinaturas, CaixaDia, Conciliacao, Precificacao,
                 VendasProdutos, ImportarTrinks, TrinksAuditoria, Conselheiro,
                 ClientesDuplicados, MeuPainel, Login, ...)
  components/    AppLayout (sidebar+header), dashboard/, equipe/, financeiro/,
                 lancamentos/, pagamento/, precificacao/, ui/ (shadcn)
  lib/           store.ts (CRM), trinksStore.ts (dados Trinks), authStore.ts,
                 queryClient.ts (apiRequest), mesUtils.ts, demoData.ts
  hooks/         useTrinksMonth.ts, use-toast.ts, use-mobile.tsx

server/
  index.ts            bootstrap Express + http server
  routes.ts           ~11.5k linhas — TODAS as rotas (177 endpoints) + rate
                      limiter Trinks + crons
  db.ts               camada KV sobre Postgres (kvGet/kvSet)
  mesService.ts       SERVIÇO CANÔNICO de dados mensais (ver §6)
  fonteResolver.ts    decide CSV vs Trinks; converte CSV → transações sintéticas
  trinksImport.ts     parse/persistência dos CSVs (caixa, financeiro, ranking)
  trinksSyncMeta.ts   metadados do último sync Trinks por mês
  trinksAgendamentosCsv.ts / trinksAuditLog.ts
  snapshotDiario.ts   captura diária de fechamento
  conselheiro.ts      IA (Anthropic) — copiloto financeiro
  caixaDiario.ts, configFinanceira.ts, comissaoCategoria.ts, pagamentos.ts,
  metasProfissional.ts, movimentacoesEstoque.ts, produtosCustos.ts, ...
  telegram.ts / telegramIndividual.ts  resumos automáticos
  storage.ts          MemStorage de usuários (legado/auth helper)

shared/schema.ts       tipos TS (Barber, Service, DailyEntry, ...)
script/build.ts        build de produção (esbuild server + vite client → dist/)
```

---

## 3. Boot e ciclo de vida (`server/index.ts` → `registerRoutes`)

1. Express sobe, registra middlewares (json, sessão, passport).
2. `db.ts` cria a tabela `kv_store` se não existir (`CREATE TABLE IF NOT EXISTS`
   — idempotente, **não escreve dados no boot**).
3. `registerRoutes` aguarda o DB (`waitForDb`) e **carrega o estado do Postgres,
   sobrescrevendo o que veio dos arquivos JSON**.
4. Config Trinks é lida das env vars (`TRINKS_API_KEY`, `TRINKS_ESTABLISHMENT_ID`).
5. Crons `node-cron` são agendados (§7).
6. `httpServer.listen(PORT)` — em produção o mesmo processo serve a API **e** o
   frontend estático (`server/static.ts`); em dev usa Vite middleware
   (`server/vite.ts`).

---

## 4. Persistência híbrida (DB + arquivo)

Padrão central em `routes.ts` (`loadData` / `persistData`):

- **Leitura:** tenta `kvGet(dbKey)` no Postgres; se falhar/`null`, lê o arquivo
  JSON local (`.store-data.json`, `.usuarios.json`, `.trinks-cache.json`, etc.).
- **Escrita:** grava **nos dois** — `kvSet` no Postgres (fire-and-forget) **e**
  `fs.writeFileSync` no arquivo (backup local).

O Postgres expõe uma **tabela única** `kv_store (key TEXT PK, value JSONB,
updated_at)`. Tudo é namespaced por chave string, ex.:
`trinks_import:caixa:2026-06`, `trinks_import:_index`, `store`, `metas:*`,
`snapshot-dia:*`. Não há schema relacional — é um document store sobre Postgres.

> ⚠️ Em produção, os arquivos JSON são **efêmeros** (somem a cada deploy se não
> houver Volume montado em `/data`). O Postgres é a fonte durável.

---

## 5. Integração Trinks (API) e o problema do 429

A API Trinks (`https://api.trinks.com/v1/...`, `estabelecimentoId` via **header**)
tem limite rígido (~5000 req/mês, ~60/min) e historicamente **estourava 429**,
fazendo o painel mostrar faturamento incompleto. Mitigações em `routes.ts`:

- **Rate limiter** próprio: `MAX_REQUESTS_PER_MINUTE = 40`,
  `MAX_REQUESTS_PER_MONTH = 4500` (margens de segurança). Contagem persistida
  no cache (`monthlyUsage`), reseta no dia 1º.
- **Circuit breaker:** se o backoff acumulado por 429 passar de 60s
  (`CIRCUIT_OPEN_THRESHOLD_MS`), o circuito **abre por 5 min**
  (`CIRCUIT_COOLDOWN_MS`) — para de queimar quota tentando.
- **Retry com backoff exponencial** em 429 (5s/10s/20s + jitter), `MAX_RETRIES=3`.
- **Cache server-side** + reuso de janela mensal (`trinksFetchAllRange`): uma
  busca de mês inteiro serve as consultas de dia/semana sem novas chamadas.
- **Pré-fetch noturno** (cron 03h SP) aquece o cache fora do horário de pico.

### A virada: CSV-import-first
A solução definitiva foi **parar de depender da API em tempo real**. O modo
padrão (`TRINKS_MODE=csv-first`, default desde 22/05/2026 em
`fonteResolver.ts`) faz o **CSV exportado vencer sempre** que existir; a API
Trinks só é usada para meses sem CSV. Resultado: uso da API despencou (ordem de
~150/4500 por mês) e o 429 deixou de afetar os números.

---

## 6. O serviço canônico do mês (`mesService.ts`)

Coração da consistência de dados. Antes, 4 cascatas diferentes (caixa-dia,
hoje-completo, mes/dados, equipe-período) divergiam entre si. `getMesData(mes)`
unifica:

1. Coleta **todas as fontes em paralelo**: API Trinks, CSV-Caixa, CSV-Financeiro.
2. Escolhe a **mais completa** por score ponderado
   (`0.7 × faturamento + 0.3 × comandas`); empate → preferência
   `api-trinks > csv-caixa > csv-financeiro`.
3. Normaliza tudo para um formato único (`MesData`: `fonte`, `comandas`,
   `faturamento`, `breakdown` por forma de pagamento, `transacoes`,
   `agendamentos`) e calcula o **breakdown** (pix/crédito/débito/dinheiro/
   plano/voucher/outros).
4. **Cacheia em memória**: 24h para mês fechado (imutável), 5 min para o mês
   corrente. Invalidação manual em import/sync (`invalidarMesCache`).
5. Expõe `fontesAuditoria` — os números de **cada** fonte — para a UI comparar
   (telas Dashboard com 2 painéis lado a lado e TrinksAuditoria).

As fontes CSV:
- **CSV-Caixa** (por comanda): mais rico, traz breakdown de pagamento por linha.
- **CSV-Financeiro** (por previsão de recebimento): usado p/ conciliação.
- `fonteResolver.csvFinanceiroParaTransacoes` converte linhas de CSV em
  "transações sintéticas" no mesmo formato dos adapters Trinks do frontend.

> 🐛 **Bug aberto conhecido:** `/api/mes/:mes/dados` ainda tenta a API Trinks
> "API-first" para meses passados antes do fallback CSV e **pendura** (timeout
> ~12s) quando a API está lenta/429. O endpoint `/api/dashboard/import/:mes`
> (CSV direto) responde na hora. Correção pendente: forçar CSV-first quando já
> há import do mês.

---

## 7. Crons (`node-cron`, fuso America/Sao_Paulo)

| Schedule | Função |
|----------|--------|
| `0 8 * * 2-6` | Resumo da manhã (Telegram) |
| `0 20 * * 2-6` | Resumo da noite (Telegram) |
| `0 21 * * 6` | Resumo semanal (sábado) |
| `0 21 28-31 * 2-6` | Fechamento mensal |
| `0 9 * * 2-6` | Alerta de estoque |
| `30 23 * * *` | Snapshot diário de fechamento |
| `0 6 * * *` | Refino do snapshot |
| `0 19 * * 2-6` | Captura vespertina |
| `0 3 * * *` | **Pré-fetch noturno Trinks** (aquece cache) |

Telegram só dispara se `TELEGRAM_BOT_TOKEN` estiver setado (`TELEGRAM_CHAT_ID`
default do dono).

---

## 8. Frontend

- **Routing hash-based** (`wouter` + `useHashLocation`) — sem rotas server-side.
- **3 papéis de auth** (`AppRouter` em `App.tsx`):
  - sem login → só `/login`;
  - `barbeiro` → vê apenas `/meu-painel` (o próprio desempenho);
  - `admin` → acesso completo (`AdminRoutes`).
- **Stores Zustand:**
  - `store.ts` — CRM local (settings, barbers, services, entries), sincroniza
    com `/api/store`;
  - `trinksStore.ts` — dados Trinks/mês (config, sync, cache, rateLimited);
  - `authStore.ts` — sessão do usuário.
- **TanStack Query** para fetch/cache de endpoints; **toda** chamada HTTP passa
  por `apiRequest` (`lib/queryClient.ts`), nunca `fetch` cru.
- Rotas legadas redirecionam (ex.: `/servicos` → `/precificacao`,
  `/consolidacao` → `/lancamentos`).
- Convenções: `data-testid` em elementos interativos; moeda PT-BR
  (`formatCurrency`); tema dark (teal `#01696F`).

---

## 9. Famílias de endpoints (`/api`, 177 no total)

| Prefixo | Domínio |
|---------|---------|
| `/api/auth/*` | login, logout, usuários, troca de senha |
| `/api/store` | CRM unificado (settings/barbers/services/entries) |
| `/api/mes/:mes/*` | **dados canônicos do mês** (mesService) |
| `/api/trinks/*` | config, test, debug, rate-status, audit (API direta) |
| `/api/trinks-csv/*`, `/api/trinks-import/*` | import e leitura de CSVs |
| `/api/dashboard/import/:mes`, `/api/equipe/desempenho-import/:mes` | views CSV |
| `/api/snapshot-dia/*` | snapshots de fechamento diário |
| `/api/estoque/*`, `/api/movimentacoes/*` | estoque e produtos |
| `/api/consolidacao/*`, `/api/conciliacao/*` | contas bancárias e conciliação |
| `/api/metas/*`, `/api/pagamento/*` | metas e fechamento/comissões |
| `/api/conselheiro/*` | copiloto IA (Anthropic) |
| `/api/meu-painel` | visão restrita do barbeiro |

---

## 10. Rodar localmente

O app **não usa dotenv** — injete o `.env` via flag:

```bash
npm install
npx tsx --env-file=.env server/index.ts   # dev (porta do .env)
# ou
npm run dev        # NODE_ENV=development tsx server/index.ts
```

Variáveis (ver `.env.example`): `TRINKS_API_KEY`, `TRINKS_ESTABLISHMENT_ID`
(238676), `TRINKS_CSV_TOKEN`, `ANTHROPIC_API_KEY` (opcional),
`TELEGRAM_BOT_TOKEN` (opcional), `DATABASE_URL`, `PORT`.

> Para dados reais em dev, use a **`DATABASE_PUBLIC_URL`** do Postgres no Railway
> (proxy `*.proxy.rlwy.net`). A `DATABASE_URL` padrão aponta para o host interno
> `postgres.railway.internal`, que **não resolve fora da rede do Railway**.
> Cuidado: apontar dev para o banco de produção significa que ações de **escrita**
> (importar CSV, capturar snapshot, salvar config) afetam produção.

**Build de produção:** `npm run build` (`script/build.ts` → esbuild do server +
Vite do client em `dist/`); `npm start` roda `dist/index.cjs`.

---

## 11. Pontos de atenção / dívida técnica

- **`routes.ts` monolítico** (~11,5k linhas) concentra rotas + rate limiter +
  crons. Candidato a fatiamento por domínio.
- **Bug do `/api/mes/:mes` em meses passados** (§6) — timeout por tentar API
  antes do CSV.
- **Arquivos JSON efêmeros** em produção sem Volume — Postgres é a rede de
  segurança real.
- **Sessão em memória** (`memorystore`) — reinício do processo derruba logins.
- `drizzle`/`drizzle-kit` nas deps mas o storage real é KV; `db:push` não reflete
  o modelo de dados em uso.
