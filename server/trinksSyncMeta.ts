/**
 * Metadata do último sync Trinks por mês (YYYY-MM).
 *
 * Usado pelo resolvedor de fonte (CSV vs Trinks): "mais recente vence".
 * Cada vez que /api/trinks/sync ou /api/trinks/sync-mes/:mes traz dados frescos
 * (não-cache), gravamos o timestamp aqui. O resolvedor compara com o
 * `importadoEm` do CSV e escolhe a fonte mais nova.
 *
 * Persistido em kv_store (Postgres) — sobrevive a deploys/restart.
 */
import { kvGet, kvSet } from "./db";

const KEY_PREFIX = "trinks_sync_meta:";

export interface TrinksSyncMeta {
  mes: string;          // YYYY-MM
  syncedAt: string;     // ISO
  agendamentos: number; // contagem para diagnóstico
  transacoes: number;
}

function keyFor(mes: string): string {
  return `${KEY_PREFIX}${mes}`;
}

export async function getSyncMeta(mes: string): Promise<TrinksSyncMeta | null> {
  return await kvGet<TrinksSyncMeta>(keyFor(mes));
}

export async function setSyncMeta(meta: TrinksSyncMeta): Promise<void> {
  await kvSet(keyFor(meta.mes), meta);
}

/** Helper conveniente: grava agora() para um mês com contagens. */
export async function registrarSyncTrinks(
  mes: string,
  contagens: { agendamentos: number; transacoes: number }
): Promise<void> {
  await setSyncMeta({
    mes,
    syncedAt: new Date().toISOString(),
    agendamentos: contagens.agendamentos,
    transacoes: contagens.transacoes,
  });
}
