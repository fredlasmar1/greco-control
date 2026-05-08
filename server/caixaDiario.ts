// Storage de fechamentos diários de caixa físico (dupla confirmação).
// Cada registro representa o usuário "auditando" um dia: viu o que o sistema
// calculou (esperado), digitou quanto tem em caixa físico (contado), e marcou
// o status. Persiste em kv_store sob "caixa_diario".
import { kvGet, kvSet } from "./db";
import { log } from "./index";

export interface CaixaDiaFechamento {
  data: string;            // YYYY-MM-DD
  // Componentes do esperado (todos digitáveis pelo usuário, mas com defaults sugeridos)
  saldoInicial: number;    // saldo do fechamento do dia anterior (ou manual)
  trinksDinheiro: number;  // vendas em dinheiro do Trinks no dia
  depositosATM: number;    // dinheiro depositado no ATM no dia
  sangrias: number;        // dinheiro retirado do caixa pra pagar despesas pequenas
  esperado: number;        // = saldoInicial + trinksDinheiro - depositosATM - sangrias
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

export async function upsertFechamento(input: {
  data: string;
  saldoInicial: number;
  trinksDinheiro: number;
  depositosATM: number;
  sangrias: number;
  contado: number;
  observacao?: string;
}): Promise<CaixaDiaFechamento> {
  const all = await listFechamentos();
  const esperado = Number((input.saldoInicial + input.trinksDinheiro - input.depositosATM - input.sangrias).toFixed(2));
  const diff = Number((input.contado - esperado).toFixed(2));
  const status: CaixaDiaFechamento["status"] = Math.abs(diff) < 0.01 ? "fechado_ok" : "fechado_divergente";
  const novo: CaixaDiaFechamento = {
    data: input.data,
    saldoInicial: Number(input.saldoInicial.toFixed(2)),
    trinksDinheiro: Number(input.trinksDinheiro.toFixed(2)),
    depositosATM: Number(input.depositosATM.toFixed(2)),
    sangrias: Number(input.sangrias.toFixed(2)),
    esperado,
    contado: Number(input.contado.toFixed(2)),
    diferenca: diff,
    observacao: input.observacao,
    status,
    fechadoEm: new Date().toISOString(),
  };
  all[input.data] = novo;
  await kvSet(KV_KEY, all);
  log(`caixa_diario ${input.data}: ini=${novo.saldoInicial} +trinks=${novo.trinksDinheiro} -atm=${novo.depositosATM} -sang=${novo.sangrias} = esp=${esperado} contado=${novo.contado} dif=${diff}`, "caixa");
  return novo;
}

/** Busca fechamento mais recente ANTES da data dada — pra propor saldo inicial. */
export async function getFechamentoAnterior(data: string): Promise<CaixaDiaFechamento | null> {
  const all = await listFechamentos();
  const lista = Object.values(all).filter(f => f.data < data).sort((a, b) => b.data.localeCompare(a.data));
  return lista[0] || null;
}

export async function deleteFechamento(data: string): Promise<void> {
  const all = await listFechamentos();
  delete all[data];
  await kvSet(KV_KEY, all);
}
