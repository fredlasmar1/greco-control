// Movimentações manuais de estoque (entradas, saídas e inventários).
// Trinks só fornece movimentações via comandas (saídas de venda). Para registrar
// compras, perdas, uso interno ou ajustes de contagem física, persistimos aqui.
//
// Persistido em kv_store sob a chave "movimentacoes_estoque" como um array:
// [
//   {
//     id: "uuid",
//     produtoId: "11311840",
//     tipo: "entrada" | "saida" | "inventario",
//     quantidade: number,        // sempre positiva. Para "inventario", representa a CONTAGEM (saldo final)
//     delta: number,             // diferença aplicada ao saldo (entrada=+qtd, saida=-qtd, inventario=contagem - saldoAnterior)
//     custoUnitario: number,     // snapshot do custo no momento (usado para valor)
//     motivo: string,            // ex: "compra fornecedor X", "quebra", "uso interno", "contagem física"
//     data: string,              // ISO
//     usuario?: string,
//     saldoAnterior?: number,    // só para inventário (ajuda auditoria)
//   }
// ]

import { kvGet, kvSet } from "./db";
import { log } from "./index";
import { randomUUID } from "crypto";

const KV_KEY = "movimentacoes_estoque";

export type TipoMovimentacao = "entrada" | "saida" | "inventario";

export type MovimentacaoEstoque = {
  id: string;
  produtoId: string;
  tipo: TipoMovimentacao;
  quantidade: number;
  delta: number;
  custoUnitario: number;
  motivo: string;
  data: string;
  usuario?: string;
  saldoAnterior?: number;
};

let cache: MovimentacaoEstoque[] | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function getMovimentacoesEstoque(): Promise<MovimentacaoEstoque[]> {
  const agora = Date.now();
  if (cache && agora - cacheAt < TTL_MS) return cache;
  try {
    const arr = await kvGet<MovimentacaoEstoque[]>(KV_KEY);
    cache = Array.isArray(arr) ? arr : [];
    cacheAt = agora;
    return cache;
  } catch (err: any) {
    log(`getMovimentacoesEstoque error: ${err.message}`, "estoque");
    return [];
  }
}

export function invalidateMovimentacoesCache() {
  cache = null;
  cacheAt = 0;
}

export async function addMovimentacao(input: {
  produtoId: string;
  tipo: TipoMovimentacao;
  quantidade: number;
  custoUnitario?: number;
  motivo?: string;
  usuario?: string;
  saldoAnterior?: number;
}): Promise<MovimentacaoEstoque> {
  const produtoId = String(input.produtoId || "").trim();
  if (!produtoId) throw new Error("produtoId obrigatório");
  const tipo = input.tipo;
  if (!["entrada", "saida", "inventario"].includes(tipo)) {
    throw new Error("tipo inválido");
  }
  const quantidade = Math.max(0, Number(input.quantidade) || 0);
  if (quantidade <= 0 && tipo !== "inventario") {
    throw new Error("quantidade deve ser maior que zero");
  }

  let delta = 0;
  if (tipo === "entrada") delta = quantidade;
  else if (tipo === "saida") delta = -quantidade;
  else if (tipo === "inventario") {
    const saldoAnterior = Number(input.saldoAnterior || 0);
    delta = quantidade - saldoAnterior;
  }

  const mov: MovimentacaoEstoque = {
    id: randomUUID(),
    produtoId,
    tipo,
    quantidade,
    delta,
    custoUnitario: Math.max(0, Number(input.custoUnitario) || 0),
    motivo: String(input.motivo || "").trim(),
    data: new Date().toISOString(),
    usuario: input.usuario,
    saldoAnterior: input.saldoAnterior,
  };

  const all = await getMovimentacoesEstoque();
  all.push(mov);
  await kvSet(KV_KEY, all);
  invalidateMovimentacoesCache();
  return mov;
}

export async function deleteMovimentacao(id: string): Promise<boolean> {
  const all = await getMovimentacoesEstoque();
  const idx = all.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  all.splice(idx, 1);
  await kvSet(KV_KEY, all);
  invalidateMovimentacoesCache();
  return true;
}

// Soma o delta total de ajustes manuais por produto (usado para enriquecer o saldo Trinks)
export function getDeltasPorProduto(movs: MovimentacaoEstoque[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of movs || []) {
    const id = String(m.produtoId);
    out[id] = (out[id] || 0) + Number(m.delta || 0);
  }
  return out;
}

// Filtra movimentações de um produto, mais recentes primeiro
export function getMovimentacoesDe(
  movs: MovimentacaoEstoque[],
  produtoId: string | number
): MovimentacaoEstoque[] {
  const id = String(produtoId || "");
  return (movs || [])
    .filter((m) => String(m.produtoId) === id)
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
}
