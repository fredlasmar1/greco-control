# Handoff — Cota Trinks configurável (Greco Control)

> Cole isto como primeiro prompt na aba do Claude Code do **greco-control** pra continuar de onde paramos.

## Contexto
A conta Trinks tem cota mensal **compartilhada entre dois sistemas**: o **Grecometas** e o **Greco Control**. O dono comprou tokens avulsos (o plano de 5.000 acabou; +5.000 comprados este mês). A Trinks **não expõe a cota via API**, então a cota é informada manualmente no sistema.

Decisão do dono: **replicar a lógica de cota nos dois sistemas** (cada um com sua tela e sua fatia), porque os bancos são separados (Railway distintos) e não dá um contador único trivial.

A parte do **Grecometas** já está pronta e no ar. A parte do **Greco Control** (este repo) foi implementada e deployada — falta só **uma** ponta.

## O que JÁ foi feito neste repo (commit `d00eade`, já no `origin/main`, deployado)
- **`server/trinksQuota.ts`** (novo) — cota configurável persistida no `kv_store` (via `kvGet`/`kvSet` de `server/db.ts`):
  - `trinks_fatia_base` → fatia mensal base do Greco Control (renova todo mês). Default `2500`.
  - `trinks_tokens_extras` → JSON `{ "YYYY-MM": qtdComprada }` (chave por mês → **zera sozinho no mês novo**).
  - Funções: `getTrinksCota()`, `setFatiaBase(v)`, `comprarTokens(qtd, mes?)`. Fatia efetiva = base + extras do mês.
- **`server/routes.ts`**:
  - `GET /api/trinks/contador` agora usa a **fatia efetiva** (base + comprados) e devolve `fatiaBase` + `tokensComprados`.
  - Novos endpoints: `GET /api/trinks/cota`, `POST /api/trinks/cota` (edita `fatiaBase`), `POST /api/trinks/cota/comprar` (`{ quantidade }`).
- **`client/src/pages/Dashboard.tsx`** — componente `TrinksCotaControls` (no fim do arquivo, renderizado no grid do widget de cota): "Comprei tokens" + editar fatia base. Mostra "base + comprados = efetiva".
- **NÃO mexe no sync/bloqueio** — a fatia é só alerta (decisão antiga do dono); o hard-stop continua `MAX_REQUESTS_PER_MONTH` = 4500.

Estado verificado no ar: `GET /api/trinks/cota` → `{ fatiaBase: 2500, extras: 0, fatiaEfetiva: 2500 }`.

## O que FALTA terminar (a única ponta solta)
**Proteger os endpoints de escrita da cota com autenticação.** Hoje `POST /api/trinks/cota` e `POST /api/trinks/cota/comprar` estão **sem login** (segui o padrão dos outros endpoints `/api/trinks/*`, que também não têm). Para um valor que mexe em cota, o ideal é exigir admin.

**Tarefa:** aplicar o mesmo middleware/checagem de auth que os outros endpoints administrativos do Greco Control usam (ex.: rotas de configuração/escrita) nos dois `POST` de cota. O `GET /api/trinks/cota` pode ficar livre (leitura).
- Localize como os endpoints admin protegidos checam sessão/role neste repo e replique nos dois POST em `server/routes.ts` (procure por `app.post("/api/trinks/cota"` e `app.post("/api/trinks/cota/comprar"`).

## Cuidados ao continuar
- **Antes de qualquer push: `git pull --rebase origin main`** — o commit `d00eade` (cota) já está no remoto.
- **Build é `npm run build` (`tsx script/build.ts`), NÃO `tsc`.** O `tsc --noEmit` acusa **~69 erros pré-existentes** (não são da cota) — ignore-os; o que vale é `npm run build` sair 0.
- Divisão atual da conta (10.000 = plano 5.000 + 5.000 comprados): **Grecometas 5.800** (800 base + 5.000 extras) + **Greco Control 2.500** = 8.300. O dono pode redistribuir registrando tokens na tela de cada sistema.

## Dúvida em aberto pro dono
Quanto dos 5.000 tokens comprados deve ir pro Greco Control? (Hoje estão 100% no Grecometas.) Se parte for daqui, registrar em **Dashboard › Cota Trinks › "Comprei tokens"**.
