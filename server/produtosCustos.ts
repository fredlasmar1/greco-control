// Cadastro local de pre\u00e7os de custo dos produtos.
// A API Trinks (v1) N\u00c3O exp\u00f5e custo dos produtos, ent\u00e3o mantemos esse
// dado em kv_store mapeado por ID de produto Trinks.
//
// Persistido em kv_store sob a chave "produtos_custos" como um objeto:
// { [produtoId: string]: { custo: number; atualizadoEm: string; atualizadoPor?: string } }

import { kvGet, kvSet } from "./db";
import { log } from "./index";

const KV_KEY = "produtos_custos";

export type CustoProduto = {
  custo: number;
  atualizadoEm: string;
  atualizadoPor?: string;
};

export type MapaCustos = Record<string, CustoProduto>;

let cache: MapaCustos | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function getProdutosCustos(): Promise<MapaCustos> {
  const agora = Date.now();
  if (cache && agora - cacheAt < TTL_MS) return cache;
  try {
    const obj = await kvGet<MapaCustos>(KV_KEY);
    cache = (obj && typeof obj === "object") ? obj : {};
    cacheAt = agora;
    return cache;
  } catch (err: any) {
    log(`getProdutosCustos error: ${err.message}`, "produtos");
    return {};
  }
}

export function invalidateProdutosCustosCache() {
  cache = null;
  cacheAt = 0;
}

export async function setProdutoCusto(produtoId: string, custo: number, atualizadoPor?: string): Promise<MapaCustos> {
  const id = String(produtoId || "").trim();
  if (!id) throw new Error("produtoId obrigat\u00f3rio");
  const valor = Math.max(0, Number(custo) || 0);
  const all = await getProdutosCustos();
  all[id] = {
    custo: valor,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor,
  };
  await kvSet(KV_KEY, all);
  invalidateProdutosCustosCache();
  return all;
}

export async function setProdutosCustosBulk(items: Array<{ id: string; custo: number }>, atualizadoPor?: string): Promise<MapaCustos> {
  const all = await getProdutosCustos();
  const ts = new Date().toISOString();
  for (const it of items || []) {
    const id = String(it?.id || "").trim();
    if (!id) continue;
    const valor = Math.max(0, Number(it?.custo) || 0);
    all[id] = { custo: valor, atualizadoEm: ts, atualizadoPor };
  }
  await kvSet(KV_KEY, all);
  invalidateProdutosCustosCache();
  return all;
}

export function getCustoOf(map: MapaCustos, produtoId: string | number): number {
  const id = String(produtoId || "");
  return Number(map[id]?.custo || 0);
}
