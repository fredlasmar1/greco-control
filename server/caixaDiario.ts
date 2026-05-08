// Storage de fechamentos diários de caixa físico (dupla confirmação).
// Cada registro representa o usuário "auditando" um dia: viu o que o sistema
// calculou (esperado), digitou quanto tem em caixa físico (contado), e marcou
// o status. Persiste em kv_store sob "caixa_diario".
import { kvGet, kvSet } from "./db";
import { log } from "./index";

export interface CaixaDiaFechamento {
  data: string;            // YYYY-MM-DD
  esperado: number;        // calculado pelo sistema (vendas Trinks dinheiro - depósitos do dia)
  contado: number;         // digitado pelo usuário
  diferenca: number;       // contado - esperado (positivo = sobra; negativo = falta)
  observacao?: string;
  status: "aberto" | "fechado_ok" | "fechado_divergente";
  fechadoEm: string;       // ISO timestamp
  fechadoPor?: string;     // username (futuro — hoje só Fred)
}

const KV_KEY = "caixa_diario";

export async function listFechamentos(): Promise<Record<string, CaixaDiaFechamento>> {
  return (await kvGet<Record<string, CaixaDiaFechamento>>(KV_KEY)) || {};
}

export async function getFechamento(data: string): Promise<CaixaDiaFechamento | null> {
  const all = await listFechamentos();
  return all[data] || null;
}

export async function upsertFechamento(input: Omit<CaixaDiaFechamento, "fechadoEm" | "status" | "diferenca"> & { observacao?: string }): Promise<CaixaDiaFechamento> {
  const all = await listFechamentos();
  const diff = Number((input.contado - input.esperado).toFixed(2));
  const status: CaixaDiaFechamento["status"] = Math.abs(diff) < 0.01 ? "fechado_ok" : "fechado_divergente";
  const novo: CaixaDiaFechamento = {
    data: input.data,
    esperado: Number(input.esperado.toFixed(2)),
    contado: Number(input.contado.toFixed(2)),
    diferenca: diff,
    observacao: input.observacao,
    status,
    fechadoEm: new Date().toISOString(),
  };
  all[input.data] = novo;
  await kvSet(KV_KEY, all);
  log(`caixa_diario ${input.data}: esperado=${novo.esperado} contado=${novo.contado} dif=${diff}`, "caixa");
  return novo;
}

export async function deleteFechamento(data: string): Promise<void> {
  const all = await listFechamentos();
  delete all[data];
  await kvSet(KV_KEY, all);
}
