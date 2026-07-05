/**
 * Agenda de Pagamentos — o que a barbearia TEM A PAGAR e QUANDO (visão pra
 * frente), separada das Compras (o que JÁ foi pago). Fica dentro da aba
 * "Compras do Mês". Persistido em kv_store (Postgres Railway) → sobrevive a
 * deploys. Não gasta token da Trinks.
 *
 * Cada item tem um vencimento; o mês (bucket) é o mês do vencimento. Ao marcar
 * "pago", a rota gera automaticamente uma Compra do mês, então a agenda alimenta
 * o total de gastos sem digitar duas vezes. Itens "recorrentes" (aluguel, luz,
 * DAS, salários…) podem ser copiados do mês anterior com 1 clique.
 */
import { kvGet, kvSet } from "./db";

export interface AgendaPagamento {
  id: string;
  mes: string;          // YYYY-MM (bucket = mês do vencimento)
  vencimento: string;   // YYYY-MM-DD
  descricao: string;    // ex.: "Aluguel do ponto", "Conta de luz"
  beneficiario: string; // pra quem paga
  valor: number;        // positivo, em reais (0 = valor ainda desconhecido)
  categoria: string;    // uma das CATEGORIAS_COMPRA
  natureza: "fixo" | "variavel";
  recorrente: boolean;  // todo mês (aluguel, luz, salário…)
  status: "pendente" | "pago";
  pagoEm?: string;      // YYYY-MM-DD
  compraId?: string;    // compra gerada ao marcar pago (pra não duplicar)
  criadoEm: string;
  atualizadoEm: string;
}

const kvKey = (mes: string) => `agenda:${mes}`;

export async function listarAgenda(mes: string): Promise<AgendaPagamento[]> {
  const d = await kvGet<AgendaPagamento[]>(kvKey(mes));
  const arr = Array.isArray(d) ? d : [];
  // ordena por vencimento crescente (o que vence primeiro no topo)
  return arr.slice().sort(
    (a, b) =>
      String(a.vencimento || "").localeCompare(String(b.vencimento || "")) ||
      String(a.criadoEm || "").localeCompare(String(b.criadoEm || "")),
  );
}

export async function salvarAgendaItem(
  input: Omit<AgendaPagamento, "id" | "criadoEm" | "atualizadoEm"> & { id?: string },
): Promise<AgendaPagamento> {
  const lista = await listarAgenda(input.mes);
  const agora = new Date().toISOString();
  const novo: AgendaPagamento = {
    ...input,
    id: input.id || `pag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    criadoEm: agora,
    atualizadoEm: agora,
  } as AgendaPagamento;
  lista.push(novo);
  await kvSet(kvKey(input.mes), lista);
  return novo;
}

export async function atualizarAgendaItem(
  mes: string,
  id: string,
  patch: Partial<AgendaPagamento>,
): Promise<AgendaPagamento | null> {
  const lista = await listarAgenda(mes);
  const i = lista.findIndex(c => c.id === id);
  if (i < 0) return null;
  lista[i] = { ...lista[i], ...patch, id, mes, atualizadoEm: new Date().toISOString() };
  await kvSet(kvKey(mes), lista);
  return lista[i];
}

export async function removerAgendaItem(mes: string, id: string): Promise<boolean> {
  const lista = await listarAgenda(mes);
  const nova = lista.filter(c => c.id !== id);
  if (nova.length === lista.length) return false;
  await kvSet(kvKey(mes), nova);
  return true;
}

/** Resumo da agenda: pendente, pago, atrasado e o que vence nos próximos 7 dias. */
export function resumoAgenda(itens: AgendaPagamento[], hoje: string) {
  const limite7 = addDias(hoje, 7);
  let pendente = 0, pago = 0, atrasado = 0, proximos = 0;
  let countPendente = 0, countPago = 0, countAtrasado = 0;
  for (const it of itens) {
    const v = Number(it.valor) || 0;
    if (it.status === "pago") { pago += v; countPago++; continue; }
    pendente += v; countPendente++;
    if (it.vencimento && it.vencimento < hoje) { atrasado += v; countAtrasado++; }
    else if (it.vencimento && it.vencimento <= limite7) { proximos += v; }
  }
  return {
    total: pendente + pago,
    pendente, pago, atrasado, proximos,
    count: itens.length, countPendente, countPago, countAtrasado,
  };
}

/**
 * Copia os itens marcados como "recorrente" do mês anterior para este mês,
 * como pendentes, com o vencimento no mesmo dia. Não duplica o que já existe
 * (mesma descrição + beneficiário). Retorna quantos foram criados.
 */
export async function gerarRecorrentes(mes: string): Promise<number> {
  const anterior = mesAnterior(mes);
  const [origem, atual] = await Promise.all([listarAgenda(anterior), listarAgenda(mes)]);
  const jaExiste = new Set(
    atual.map(i => `${(i.descricao || "").toLowerCase().trim()}|${(i.beneficiario || "").toLowerCase().trim()}`),
  );
  const recorrentes = origem.filter(i => i.recorrente);
  let criados = 0;
  for (const r of recorrentes) {
    const chave = `${(r.descricao || "").toLowerCase().trim()}|${(r.beneficiario || "").toLowerCase().trim()}`;
    if (jaExiste.has(chave)) continue;
    const dia = (r.vencimento || `${mes}-01`).slice(8, 10);
    await salvarAgendaItem({
      mes,
      vencimento: `${mes}-${dia}`,
      descricao: r.descricao,
      beneficiario: r.beneficiario,
      valor: r.valor,
      categoria: r.categoria,
      natureza: r.natureza,
      recorrente: true,
      status: "pendente",
    });
    jaExiste.add(chave);
    criados++;
  }
  return criados;
}

// ── datas (strings YYYY-MM-DD, sem fuso) ────────────────────────────────────
function addDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}
function mesAnterior(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return dt.toISOString().slice(0, 7);
}
