// Gerencia o estado MENSAL de pagamento por profissional:
// - vale do dia 15 (manual)
// - ajuste manual no fechamento (com nota)
// - snapshot imutável quando o mês é "fechado"
//
// kv_store: chave "pagamentos" -> { [mes: "YYYY-MM"]: { [profId]: PagamentoMes } }

import { kvGet, kvSet } from "./db";
import { log } from "./index";

export interface PagamentoMes {
  profissionalId: string;
  mes: string; // YYYY-MM
  vale: number;          // valor do vale do dia 15 (manual)
  valeNota?: string;
  valePagoEm?: string;   // ISO — quando foi marcado como pago
  ajuste: number;        // ajuste manual no saldo (positivo ou negativo)
  ajusteNota?: string;
  consumoInterno: number;     // consumo interno do barbeiro no mês (desconta do saldo)
  consumoInternoNota?: string;
  fechado: boolean;      // se true, snapshot é imutável
  fechadoEm?: string;    // ISO
  // Snapshot dos valores no momento do fechamento (preservado para histórico
  // mesmo se overrides/percentuais mudarem depois)
  snapshot?: {
    servicosLiquido: number;
    produtosLiquidoComissionavel: number;
    planoReais: number;
    pctServico: number;
    pctProduto: number;
    pctPlano: number;
    pctBonusExcedente: number;
    metaReais: number;
    salarioFixo: number;
    comissaoServicos: number;
    comissaoProdutos: number;
    comissaoPlano: number;
    bonusExcedente: number;
    totalBruto: number;     // tudo somado (sem subtrair vale)
    consumoInterno: number;
    taxaCartaoEstimada: number; // informativo (já abatido no líquido)
    saldoAReceber: number;  // totalBruto - vale - consumoInterno + ajuste
  };
  atualizadoEm: string;
}

type PagamentosMap = Record<string, Record<string, PagamentoMes>>;

const KV_KEY = "pagamentos";

let cache: PagamentosMap | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

async function loadAll(): Promise<PagamentosMap> {
  const agora = Date.now();
  if (cache && agora - cacheAt < TTL_MS) return cache;
  try {
    const data = await kvGet<PagamentosMap>(KV_KEY);
    cache = data && typeof data === "object" ? data : {};
    cacheAt = agora;
    return cache;
  } catch (err: any) {
    log(`pagamentos.loadAll error: ${err.message}`, "pagamentos");
    return {};
  }
}

function invalidate() {
  cache = null;
  cacheAt = 0;
}

export async function getPagamentoMes(mes: string, profissionalId: string): Promise<PagamentoMes | null> {
  const all = await loadAll();
  return all[mes]?.[profissionalId] || null;
}

export async function getPagamentosDoMes(mes: string): Promise<Record<string, PagamentoMes>> {
  const all = await loadAll();
  return all[mes] || {};
}

export async function upsertPagamentoMes(
  mes: string,
  profissionalId: string,
  patch: Partial<PagamentoMes>,
): Promise<PagamentoMes> {
  const all = await loadAll();
  if (!all[mes]) all[mes] = {};
  const atual = all[mes][profissionalId] || {
    profissionalId,
    mes,
    vale: 0,
    ajuste: 0,
    consumoInterno: 0,
    fechado: false,
    atualizadoEm: new Date().toISOString(),
  };
  if (atual.fechado && !patch.fechado) {
    // Mês já fechado: bloqueia edições (exceto reabrir).
    throw new Error(`Mês ${mes} já está fechado para ${profissionalId}. Reabra antes de editar.`);
  }
  const novo: PagamentoMes = {
    ...atual,
    ...patch,
    profissionalId,
    mes,
    atualizadoEm: new Date().toISOString(),
  };
  all[mes][profissionalId] = novo;
  await kvSet(KV_KEY, all);
  invalidate();
  return novo;
}

export async function fecharMes(
  mes: string,
  profissionalId: string,
  snapshot: PagamentoMes["snapshot"],
): Promise<PagamentoMes> {
  const all = await loadAll();
  if (!all[mes]) all[mes] = {};
  const atual = all[mes][profissionalId] || {
    profissionalId, mes, vale: 0, ajuste: 0, consumoInterno: 0, fechado: false,
    atualizadoEm: new Date().toISOString(),
  };
  const novo: PagamentoMes = {
    ...atual,
    fechado: true,
    fechadoEm: new Date().toISOString(),
    snapshot,
    atualizadoEm: new Date().toISOString(),
  };
  all[mes][profissionalId] = novo;
  await kvSet(KV_KEY, all);
  invalidate();
  return novo;
}

export async function reabrirMes(mes: string, profissionalId: string): Promise<PagamentoMes | null> {
  const all = await loadAll();
  if (!all[mes]?.[profissionalId]) return null;
  const atual = all[mes][profissionalId];
  const novo: PagamentoMes = {
    ...atual,
    fechado: false,
    fechadoEm: undefined,
    atualizadoEm: new Date().toISOString(),
  };
  all[mes][profissionalId] = novo;
  await kvSet(KV_KEY, all);
  invalidate();
  return novo;
}
