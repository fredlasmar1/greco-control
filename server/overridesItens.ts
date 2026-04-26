// Overrides manuais de profissional por item de transação.
// Usado pela aba Conciliação para atribuir manualmente um profissional a
// itens (servico ou produto) que vieram do Trinks SEM profissionalId.
//
// Não modifica nada no Trinks — apenas guarda no kv_store local. O cálculo
// da equipe (calcularPeriodoPorProfissional) consulta esses overrides antes
// de pular itens órfãos.
//
// Estrutura kv: chave "overrides_itens" -> { [itemKey]: { profissionalId, atualizadoEm } }
// itemKey = `${transacaoId}:${tipo}:${index}` onde tipo = "s" (serviço) ou "p" (produto)
// e index é a posição dentro do array de servicos/produtos.

import { kvGet, kvSet } from "./db";
import { log } from "./index";

export interface OverrideItem {
  profissionalId: string;
  atualizadoEm: string;
  // "skip" → o usuário marcou para IGNORAR esse item (cortesia, erro de lançamento).
  // Se profissionalId vazio + skip true, o item não conta no líquido nem no bruto.
  skip?: boolean;
}

export type OverridesMap = Record<string, OverrideItem>;

const KV_KEY = "overrides_itens";

let cache: OverridesMap | null = null;
let cacheAt = 0;
const TTL_MS = 30_000; // 30s — overrides mudam pouco; cache barato

export async function getOverrides(): Promise<OverridesMap> {
  const agora = Date.now();
  if (cache && agora - cacheAt < TTL_MS) return cache;
  try {
    const data = await kvGet<OverridesMap>(KV_KEY);
    cache = data && typeof data === "object" ? data : {};
    cacheAt = agora;
    return cache;
  } catch (err: any) {
    log(`getOverrides error: ${err.message}`, "conciliacao");
    return {};
  }
}

export function invalidateOverridesCache() {
  cache = null;
  cacheAt = 0;
}

export async function setOverride(
  transacaoId: string | number,
  tipo: "s" | "p",
  index: number,
  profissionalId: string,
  opts: { skip?: boolean } = {},
): Promise<OverrideItem> {
  const all = await getOverrides();
  const key = `${transacaoId}:${tipo}:${index}`;
  const item: OverrideItem = {
    profissionalId: String(profissionalId || "").trim(),
    atualizadoEm: new Date().toISOString(),
    skip: !!opts.skip,
  };
  all[key] = item;
  await kvSet(KV_KEY, all);
  invalidateOverridesCache();
  return item;
}

export async function deleteOverride(
  transacaoId: string | number,
  tipo: "s" | "p",
  index: number,
): Promise<void> {
  const all = await getOverrides();
  const key = `${transacaoId}:${tipo}:${index}`;
  if (key in all) {
    delete all[key];
    await kvSet(KV_KEY, all);
    invalidateOverridesCache();
  }
}

// Helper síncrono usado dentro do loop de cálculo: dado o mapa já carregado,
// retorna o profissionalId override (ou null) para um item específico.
export function lookupOverride(
  overrides: OverridesMap,
  transacaoId: string | number,
  tipo: "s" | "p",
  index: number,
): OverrideItem | null {
  const key = `${transacaoId}:${tipo}:${index}`;
  return overrides[key] || null;
}
