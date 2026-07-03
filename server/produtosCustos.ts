// Cadastro local de preços de custo e (opcionalmente) preços de venda dos produtos.
// A API Trinks (v1) NÃO expõe custo dos produtos, e o preço de venda do catálogo
// nem sempre reflete o que está sendo cobrado nas comandas. Por isso, mantemos
// custos e (opcionalmente) preços de venda em kv_store, mapeados por ID Trinks.
//
// Persistido em kv_store sob a chave "produtos_custos" como um objeto:
// { [produtoId: string]: {
//     custo: number;
//     precoVenda?: number;        // se definido, sobrescreve o preço Trinks/observado
//     minimo?: number;            // estoque mínimo para alertas (v23)
//     atualizadoEm: string;
//     atualizadoPor?: string;
//   }
// }

import { kvGet, kvSet } from "./db";
import { log } from "./index";

const KV_KEY = "produtos_custos";

export type CustoProduto = {
  custo: number;
  precoVenda?: number;
  minimo?: number;
  comissaoPct?: number;   // % de comissão do barbeiro NAQUELE produto (0..100). Undefined = usa o padrão global.
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

export async function setProdutoCusto(
  produtoId: string,
  custo: number,
  atualizadoPor?: string,
  precoVenda?: number | null
): Promise<MapaCustos> {
  const id = String(produtoId || "").trim();
  if (!id) throw new Error("produtoId obrigatório");
  const valor = Math.max(0, Number(custo) || 0);
  const all = await getProdutosCustos();
  const prev = all[id] || ({} as CustoProduto);
  // Preserva campos anteriores (minimo, comissaoPct, precoVenda) — antes reconstruía
  // do zero e apagava minimo/comissaoPct ao só atualizar o custo.
  const next: CustoProduto = {
    ...prev,
    custo: valor,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor,
  };
  // precoVenda: null limpa; undefined mantém anterior; número atualiza
  if (precoVenda === null) delete next.precoVenda;
  else if (typeof precoVenda === "number" && !Number.isNaN(precoVenda)) next.precoVenda = Math.max(0, precoVenda);
  all[id] = next;
  await kvSet(KV_KEY, all);
  invalidateProdutosCustosCache();
  return all;
}

/** Define a % de comissão do barbeiro num produto (0..100). null/undefined limpa. */
export async function setProdutoComissaoPct(
  produtoId: string,
  comissaoPct: number | null,
  atualizadoPor?: string,
): Promise<MapaCustos> {
  const id = String(produtoId || "").trim();
  if (!id) throw new Error("produtoId obrigatório");
  const all = await getProdutosCustos();
  const prev = all[id] || ({ custo: 0 } as CustoProduto);
  const next: CustoProduto = { ...prev, custo: Number(prev.custo || 0), atualizadoEm: new Date().toISOString(), atualizadoPor };
  if (comissaoPct === null || comissaoPct === undefined || Number.isNaN(Number(comissaoPct))) delete next.comissaoPct;
  else next.comissaoPct = Math.max(0, Math.min(100, Number(comissaoPct)));
  all[id] = next;
  await kvSet(KV_KEY, all);
  invalidateProdutosCustosCache();
  return all;
}

/** % de comissão do produto (fração 0..1) ou undefined se não definida. */
export function getComissaoPctOf(map: MapaCustos, produtoId: string | number): number | undefined {
  const id = String(produtoId || "");
  const v = map[id]?.comissaoPct;
  return typeof v === "number" && v >= 0 ? v / 100 : undefined;
}

export async function setProdutosCustosBulk(
  items: Array<{ id: string; custo?: number; precoVenda?: number | null }>,
  atualizadoPor?: string
): Promise<MapaCustos> {
  const all = await getProdutosCustos();
  const ts = new Date().toISOString();
  for (const it of items || []) {
    const id = String(it?.id || "").trim();
    if (!id) continue;
    const prev = all[id] || ({} as CustoProduto);
    const next: CustoProduto = {
      custo: it?.custo !== undefined ? Math.max(0, Number(it.custo) || 0) : Number(prev.custo || 0),
      atualizadoEm: ts,
      atualizadoPor,
    };
    if (it?.precoVenda === null) {
      // limpa
    } else if (typeof it?.precoVenda === "number" && !Number.isNaN(it.precoVenda)) {
      next.precoVenda = Math.max(0, it.precoVenda);
    } else if (typeof prev.precoVenda === "number") {
      next.precoVenda = prev.precoVenda;
    }
    all[id] = next;
  }
  await kvSet(KV_KEY, all);
  invalidateProdutosCustosCache();
  return all;
}

export function getCustoOf(map: MapaCustos, produtoId: string | number): number {
  const id = String(produtoId || "");
  return Number(map[id]?.custo || 0);
}

export function getPrecoVendaManualOf(map: MapaCustos, produtoId: string | number): number | undefined {
  const id = String(produtoId || "");
  const v = map[id]?.precoVenda;
  return typeof v === "number" && v > 0 ? v : undefined;
}

export function getMinimoOf(map: MapaCustos, produtoId: string | number): number {
  const id = String(produtoId || "");
  return Number(map[id]?.minimo || 0);
}

export async function setProdutoMinimo(
  produtoId: string,
  minimo: number | null,
  atualizadoPor?: string
): Promise<MapaCustos> {
  const id = String(produtoId || "").trim();
  if (!id) throw new Error("produtoId obrigatório");
  const all = await getProdutosCustos();
  const prev = all[id] || ({ custo: 0, atualizadoEm: new Date().toISOString() } as CustoProduto);
  const next: CustoProduto = {
    ...prev,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: atualizadoPor ?? prev.atualizadoPor,
  };
  if (minimo === null || minimo === undefined) {
    delete next.minimo;
  } else {
    next.minimo = Math.max(0, Number(minimo) || 0);
  }
  all[id] = next;
  await kvSet(KV_KEY, all);
  invalidateProdutosCustosCache();
  return all;
}
