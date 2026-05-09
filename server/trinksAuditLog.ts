/**
 * Auditoria de consumo da API Trinks.
 *
 * Cada chamada *real à rede* (sucesso, 429 ou erro) é registrada em buckets
 * agregados por dia (TZ America/Sao_Paulo). Persistimos no kv_store (Postgres
 * Railway) para sobreviver a deploys/restarts — diferente do contador em
 * memória existente, que zera a cada deploy (61 deploys em maio = contador
 * sempre baixo, mas Trinks já bloqueada).
 *
 * Estrutura no kv_store:
 *   trinks_audit:YYYY-MM-DD → {
 *     dia, total, ok, rate429, erros,
 *     porHora: { "00".."23": n },
 *     porEndpoint: { "agendamentos": n, "transacoes": n, ... },
 *     porOrigem: { "cron-manha": n, "sync-mes": n, "dashboard": n, ... },
 *     ultimoStatus429At, primeiroEventoAt, ultimoEventoAt
 *   }
 *
 * Estratégia de gravação: buffer em memória + flush a cada 30s (ou na primeira
 * leitura). Evita 1 write Postgres por request — agrupa em batch.
 */
import { kvGet, kvSet } from "./db";
import { AsyncLocalStorage } from "async_hooks";

// ── Contexto de origem (AsyncLocalStorage) ──────────────────────────────
// Permite marcar todas as chamadas Trinks que acontecem dentro de um bloco
// como vindas de uma origem específica (ex: "cron-manha", "sync-mes",
// "dashboard"). Sem isso teria que passar `origem` em cascata por dezenas
// de funções. Últil em todos os crons e endpoints relevantes.
const origemStorage = new AsyncLocalStorage<string>();
export function comOrigem<T>(origem: string, fn: () => Promise<T>): Promise<T> {
  return origemStorage.run(origem, fn);
}
export function origemAtual(): string | undefined {
  return origemStorage.getStore();
}

// ── Tipos ───────────────────────────────────────────────────────────────
export type StatusEvento = "ok" | "rate429" | "erro";

export interface BucketDia {
  dia: string; // YYYY-MM-DD em SP
  total: number;
  ok: number;
  rate429: number;
  erros: number;
  porHora: Record<string, number>; // "00".."23"
  porEndpoint: Record<string, number>;
  porOrigem: Record<string, number>;
  primeiroEventoAt: string | null; // ISO
  ultimoEventoAt: string | null; // ISO
  ultimoStatus429At: string | null; // ISO
}

// ── Helpers de tempo (TZ America/Sao_Paulo) ─────────────────────────────
function diaSP(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
}

function horaSP(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", hour12: false,
  });
  // saída tipo "08" — pega só os dígitos
  const out = fmt.format(d);
  const m = out.match(/(\d{2})/);
  return m ? m[1] : "00";
}

function chaveKv(dia: string): string {
  return `trinks_audit:${dia}`;
}

// ── Buffer em memória (flush periódico) ─────────────────────────────────
const buffer: Map<string, BucketDia> = new Map();
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL_MS = 30_000; // 30s

function bucketVazio(dia: string): BucketDia {
  return {
    dia,
    total: 0, ok: 0, rate429: 0, erros: 0,
    porHora: {}, porEndpoint: {}, porOrigem: {},
    primeiroEventoAt: null, ultimoEventoAt: null, ultimoStatus429At: null,
  };
}

function mergeBuckets(a: BucketDia, b: BucketDia): BucketDia {
  const merged: BucketDia = {
    dia: a.dia,
    total: a.total + b.total,
    ok: a.ok + b.ok,
    rate429: a.rate429 + b.rate429,
    erros: a.erros + b.erros,
    porHora: { ...a.porHora },
    porEndpoint: { ...a.porEndpoint },
    porOrigem: { ...a.porOrigem },
    primeiroEventoAt: a.primeiroEventoAt && b.primeiroEventoAt
      ? (a.primeiroEventoAt < b.primeiroEventoAt ? a.primeiroEventoAt : b.primeiroEventoAt)
      : (a.primeiroEventoAt || b.primeiroEventoAt),
    ultimoEventoAt: a.ultimoEventoAt && b.ultimoEventoAt
      ? (a.ultimoEventoAt > b.ultimoEventoAt ? a.ultimoEventoAt : b.ultimoEventoAt)
      : (a.ultimoEventoAt || b.ultimoEventoAt),
    ultimoStatus429At: a.ultimoStatus429At && b.ultimoStatus429At
      ? (a.ultimoStatus429At > b.ultimoStatus429At ? a.ultimoStatus429At : b.ultimoStatus429At)
      : (a.ultimoStatus429At || b.ultimoStatus429At),
  };
  for (const [k, v] of Object.entries(b.porHora)) merged.porHora[k] = (merged.porHora[k] || 0) + v;
  for (const [k, v] of Object.entries(b.porEndpoint)) merged.porEndpoint[k] = (merged.porEndpoint[k] || 0) + v;
  for (const [k, v] of Object.entries(b.porOrigem)) merged.porOrigem[k] = (merged.porOrigem[k] || 0) + v;
  return merged;
}

/**
 * Registra um evento da API Trinks. Não bloqueia a chamada principal
 * (acumula em memória e o flush periódico grava no kv_store em background).
 */
export function registrarEventoTrinks(params: {
  endpoint: string;
  status: StatusEvento;
  origem?: string; // ex: "cron-manha", "sync-mes", "dashboard", "ad-hoc"
}): void {
  const now = new Date();
  const dia = diaSP(now);
  const hora = horaSP(now);
  const iso = now.toISOString();

  let b = buffer.get(dia);
  if (!b) {
    b = bucketVazio(dia);
    buffer.set(dia, b);
  }

  // Normaliza endpoint: pega só o nome principal (ex: "agendamentos?dataInicio=..." → "agendamentos")
  const endpointBase = params.endpoint.split("?")[0].split("/").filter(Boolean)[0] || "outros";
  const origem = params.origem || origemAtual() || "ad-hoc";

  b.total += 1;
  if (params.status === "ok") b.ok += 1;
  else if (params.status === "rate429") {
    b.rate429 += 1;
    b.ultimoStatus429At = iso;
  } else b.erros += 1;

  b.porHora[hora] = (b.porHora[hora] || 0) + 1;
  b.porEndpoint[endpointBase] = (b.porEndpoint[endpointBase] || 0) + 1;
  b.porOrigem[origem] = (b.porOrigem[origem] || 0) + 1;
  if (!b.primeiroEventoAt) b.primeiroEventoAt = iso;
  b.ultimoEventoAt = iso;

  // Agenda flush se ainda não houver
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Faz flush do buffer atual para o kv_store. Mescla com o que já existe lá
 * (importante: várias instâncias/processos não devem rodar simultaneamente,
 * mas o merge minimiza perda em caso de race).
 */
export async function flush(): Promise<void> {
  if (buffer.size === 0) return;
  const entries = Array.from(buffer.entries());
  buffer.clear();

  for (const [dia, b] of entries) {
    try {
      const existente = await kvGet<BucketDia>(chaveKv(dia));
      const merged = existente ? mergeBuckets(existente, b) : b;
      await kvSet(chaveKv(dia), merged);
    } catch {
      // Se falhar, devolve ao buffer pra tentar de novo no próximo flush
      const cur = buffer.get(dia);
      buffer.set(dia, cur ? mergeBuckets(cur, b) : b);
    }
  }
}

/**
 * Lê os buckets de N dias até hoje (inclusive), no fuso de SP.
 * Default: últimos 30 dias.
 */
export async function lerUltimosDias(n: number = 30): Promise<BucketDia[]> {
  // Primeiro flush para garantir que o buffer foi para o disco
  await flush();

  const hoje = new Date();
  const out: BucketDia[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const dia = diaSP(d);
    const b = await kvGet<BucketDia>(chaveKv(dia));
    out.push(b || bucketVazio(dia));
  }
  return out;
}

/**
 * Resumo agregado dos últimos N dias.
 */
export async function resumoUltimosDias(n: number = 30): Promise<{
  diaInicio: string;
  diaFim: string;
  totais: { total: number; ok: number; rate429: number; erros: number };
  porDia: BucketDia[];
  topEndpoints: Array<{ endpoint: string; count: number }>;
  topOrigens: Array<{ origem: string; count: number }>;
  porHoraAgregada: Record<string, number>;
}> {
  const dias = await lerUltimosDias(n);
  const totais = dias.reduce(
    (acc, b) => ({
      total: acc.total + b.total,
      ok: acc.ok + b.ok,
      rate429: acc.rate429 + b.rate429,
      erros: acc.erros + b.erros,
    }),
    { total: 0, ok: 0, rate429: 0, erros: 0 },
  );

  const endpointMap: Record<string, number> = {};
  const origemMap: Record<string, number> = {};
  const horaMap: Record<string, number> = {};
  for (const b of dias) {
    for (const [k, v] of Object.entries(b.porEndpoint)) endpointMap[k] = (endpointMap[k] || 0) + v;
    for (const [k, v] of Object.entries(b.porOrigem)) origemMap[k] = (origemMap[k] || 0) + v;
    for (const [k, v] of Object.entries(b.porHora)) horaMap[k] = (horaMap[k] || 0) + v;
  }
  const topEndpoints = Object.entries(endpointMap)
    .map(([endpoint, count]) => ({ endpoint, count }))
    .sort((a, b) => b.count - a.count);
  const topOrigens = Object.entries(origemMap)
    .map(([origem, count]) => ({ origem, count }))
    .sort((a, b) => b.count - a.count);

  return {
    diaInicio: dias[0]?.dia || diaSP(),
    diaFim: dias[dias.length - 1]?.dia || diaSP(),
    totais,
    porDia: dias,
    topEndpoints,
    topOrigens,
    porHoraAgregada: horaMap,
  };
}
