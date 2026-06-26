/**
 * Cota Trinks configurável do Greco Control (espelha a do Grecometas).
 * A Trinks não expõe a cota via API, então o admin informa aqui: a FATIA base
 * do Greco Control (renova todo mês) e os TOKENS comprados avulsos no mês (somam
 * à fatia e zeram sozinhos no mês novo, pois a chave é por mês). Guardado no kv_store.
 *
 *  - trinks_fatia_base    → fatia mensal base do Greco Control (renova). Default 2500.
 *  - trinks_tokens_extras → JSON { "YYYY-MM": qtdComprada }.
 */
import { kvGet, kvSet } from "./db";

const K_FATIA = "trinks_fatia_base";
const K_EXTRAS = "trinks_tokens_extras";
const DEFAULT_FATIA = Number(process.env.TRINKS_MONTHLY_BUDGET || 2500);

export function mesAtual(): string {
  return new Date().toISOString().slice(0, 7);
}

export interface TrinksCota {
  mes: string;
  fatiaBase: number; // fatia base do Greco Control (renova mensal)
  extras: number; // tokens comprados avulsos NESTE mês
  fatiaEfetiva: number; // base + extras (teto do Greco Control neste mês)
}

export async function getTrinksCota(): Promise<TrinksCota> {
  const mes = mesAtual();
  const fatiaBase = Number(await kvGet<number>(K_FATIA)) || DEFAULT_FATIA;
  const extrasMap = (await kvGet<Record<string, number>>(K_EXTRAS)) || {};
  const extras = Number(extrasMap[mes] || 0);
  return { mes, fatiaBase, extras, fatiaEfetiva: fatiaBase + extras };
}

export async function setFatiaBase(valor: number): Promise<void> {
  await kvSet(K_FATIA, Math.max(0, Math.round(valor)));
}

/** Registra a compra de tokens avulsos no mês (soma ao que já houver). */
export async function comprarTokens(quantidade: number, mes?: string): Promise<number> {
  const m = mes || mesAtual();
  const map = (await kvGet<Record<string, number>>(K_EXTRAS)) || {};
  map[m] = Number(map[m] || 0) + Math.max(0, Math.round(quantidade));
  await kvSet(K_EXTRAS, map);
  return map[m];
}
