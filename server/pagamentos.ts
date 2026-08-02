// Gerencia o estado MENSAL de pagamento por profissional:
// - vale do dia 15 (manual)
// - ajuste manual no fechamento (com nota)
// - snapshot imutável quando o mês é "fechado"
//
// kv_store: chave "pagamentos" -> { [mes: "YYYY-MM"]: { [profId]: PagamentoMes } }

import { kvGet, kvGetParaEscrita, kvSet } from "./db";
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
  multa: number;              // v107: multas por atraso/problemas (desconta do saldo)
  multaNota?: string;
  comprasCartao: number;      // v107: compras/cursos no cartão da barbearia (desconta)
  comprasCartaoNota?: string;
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
    multa: 0,
    comprasCartao: 0,
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
    profissionalId, mes, vale: 0, ajuste: 0, consumoInterno: 0, multa: 0, comprasCartao: 0, fechado: false,
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

// ─── LEDGER DE PAGAMENTOS DE FOLHA (fecha o circuito folha↔pagamento) ─────────
// Um pagamento a funcionário via Telegram é uma de duas coisas (o dono responde
// qual, não adivinhamos): (a) VALE/adiantamento do mês corrente → abate do saldo
// (campo `vale` acima); (b) FECHAMENTO do mês anterior → quita a folha daquele
// mês, NÃO abate o corrente. Sem distinguir, o dinheiro somia dos dois lados: o
// pagamento do dia 3 (comissão do mês passado) abatia o mês errado.
// Este ledger guarda os pagamentos de FECHAMENTO por mês-referência.
export interface PagamentoFolhaItem {
  profissionalId: string;
  nome: string;
  valor: number;
  data: string;        // YYYY-MM-DD do comprovante
  origem: string;      // "telegram" | "manual"
  registradoEm: string;
}
const folhaPagKey = (mesRef: string) => `folha_pagamentos:${mesRef}`;

export async function getPagamentosFolha(mesRef: string): Promise<PagamentoFolhaItem[]> {
  const d = await kvGet<PagamentoFolhaItem[]>(folhaPagKey(mesRef));
  return Array.isArray(d) ? d : [];
}

// Registra um pagamento que QUITA a folha de `mesRef`. Leitura estrita: se o
// banco falhar, ESTOURA em vez de gravar por cima de lista vazia (mesma trava
// das compras — perder o mês seria catastrófico).
/**
 * Remove um pagamento do ledger de fechamento de `mesRef`. Existe porque um clique
 * errado no botão do Telegram era IRREVERSÍVEL: em 30/07/2026 R$ 8.000 pagos ao
 * André (adiantamento de julho) e R$ 4.000 de transferência entre contas próprias
 * entraram como "fechamento de junho" e não havia como desfazer — junho parecia
 * quitado a mais e julho não abatia nada.
 *
 * Casa por valor + data + profissional (não por índice, que muda). Devolve o item
 * removido, ou null se não achou — o chamador decide se isso é erro.
 */
export async function removerPagamentoFolha(
  mesRef: string, profissionalId: string, valor: number, data: string,
): Promise<{ removido: PagamentoFolhaItem | null; restante: PagamentoFolhaItem[] }> {
  const d = await kvGetParaEscrita<PagamentoFolhaItem[]>(folhaPagKey(mesRef));
  if (d !== null && !Array.isArray(d)) throw new Error(`folha_pagamentos:${mesRef} corrompida (esperava array)`);
  const lista = Array.isArray(d) ? d.slice() : [];
  const i = lista.findIndex(p =>
    String(p.profissionalId) === String(profissionalId) &&
    Math.abs(Number(p.valor) - Number(valor)) < 0.005 &&
    String(p.data) === String(data));
  if (i < 0) return { removido: null, restante: lista };
  const [removido] = lista.splice(i, 1);
  await kvSet(folhaPagKey(mesRef), lista);
  return { removido, restante: lista };
}

export async function registrarPagamentoFolha(mesRef: string, item: Omit<PagamentoFolhaItem, "registradoEm">): Promise<PagamentoFolhaItem[]> {
  const d = await kvGetParaEscrita<PagamentoFolhaItem[]>(folhaPagKey(mesRef));
  if (d !== null && !Array.isArray(d)) throw new Error(`folha_pagamentos:${mesRef} corrompida (esperava array)`);
  const lista = Array.isArray(d) ? d.slice() : [];
  lista.push({ ...item, registradoEm: new Date().toISOString() });
  await kvSet(folhaPagKey(mesRef), lista);
  return lista;
}
