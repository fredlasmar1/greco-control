/**
 * Resolvedor de fonte: CSV vs Trinks — "mais recente vence".
 *
 * Para cada mês (YYYY-MM), comparamos:
 *   - timestamp do CSV financeiro importado (importadoEm)
 *   - timestamp do último sync Trinks (syncedAt do trinksSyncMeta)
 * E retornamos a fonte vencedora + metadados para badge na UI.
 *
 * Também converte CSV financeiro em "transações sintéticas" no formato
 * compatível com os adapters da Trinks (getTrindsDailyRevenueChart,
 * getTrinksPaymentMethodData, getTrinksMonthTotals, etc.).
 */
import { kvGet } from "./db";
import * as trinksImport from "./trinksImport";
import { getSyncMeta } from "./trinksSyncMeta";
import type { FinanceiroPayload, RankingPayload } from "./trinksImport";

export type FonteDados = "trinks" | "csv" | "nenhuma";

export interface ResolverFonteResult {
  fonte: FonteDados;
  /** ISO do último sync Trinks daquele mês (se houver). */
  trinksAt: string | null;
  /** ISO do importadoEm do CSV financeiro daquele mês (se houver). */
  csvAt: string | null;
  /** Razão humana — ajuda diagnóstico. */
  motivo: string;
}

/** Lê do kv_store o CSV financeiro do mês e retorna seu importadoEm (ISO). */
async function getCsvFinanceiroImportadoEm(mes: string): Promise<{ importadoEm: string | null; payload: FinanceiroPayload | null }> {
  // O kv_store guarda o payload diretamente; o "importadoEm" não fica gravado
  // no payload em si — está no índice de imports. Lemos do índice.
  // Estrutura: trinks_import:_index → { [chave]: ImportSummary }
  try {
    const idx = await kvGet<Record<string, any>>("trinks_import:_index");
    const chave = trinksImport.kvKeyFor("financeiro", mes);
    const summary = idx?.[chave];
    const importadoEm = summary?.importadoEm || null;
    let payload: FinanceiroPayload | null = null;
    if (importadoEm) {
      payload = await kvGet<FinanceiroPayload>(chave);
    }
    return { importadoEm, payload };
  } catch {
    return { importadoEm: null, payload: null };
  }
}

/**
 * Modo de resolução de fonte. Configurado via env TRINKS_MODE.
 *   - "csv-first" (default desde 22/05/2026): CSV vence sempre que existir.
 *     Trinks só é usada para meses sem CSV. Recomendado: zero risco de estourar API.
 *   - "mais-recente": comportamento antigo — quem tem timestamp mais recente vence.
 */
export type ModoFonte = "csv-first" | "mais-recente";

export function getModoFonte(): ModoFonte {
  const env = String(process.env.TRINKS_MODE || "").toLowerCase().trim();
  if (env === "mais-recente") return "mais-recente";
  return "csv-first";
}

/** Decide qual fonte vence para um mês. */
export async function resolverFonte(mes: string): Promise<ResolverFonteResult> {
  const [trinksMeta, csvInfo] = await Promise.all([
    getSyncMeta(mes),
    getCsvFinanceiroImportadoEm(mes),
  ]);
  const trinksAt = trinksMeta?.syncedAt || null;
  const csvAt = csvInfo.importadoEm || null;
  const modo = getModoFonte();

  if (!trinksAt && !csvAt) {
    return { fonte: "nenhuma", trinksAt, csvAt, motivo: "Sem CSV importado e sem sync Trinks registrado." };
  }
  if (trinksAt && !csvAt) {
    return { fonte: "trinks", trinksAt, csvAt, motivo: "Apenas Trinks disponível." };
  }
  if (!trinksAt && csvAt) {
    return { fonte: "csv", trinksAt, csvAt, motivo: "Apenas CSV disponível." };
  }
  // Ambos disponíveis:
  if (modo === "csv-first") {
    return { fonte: "csv", trinksAt, csvAt, motivo: "CSV é a fonte principal (modo csv-first)." };
  }
  // modo "mais-recente": comparar timestamps
  const tT = new Date(trinksAt!).getTime();
  const tC = new Date(csvAt!).getTime();
  if (tC > tT) {
    return { fonte: "csv", trinksAt, csvAt, motivo: "CSV mais recente que Trinks." };
  }
  return { fonte: "trinks", trinksAt, csvAt, motivo: "Trinks mais recente que CSV." };
}

/** Verifica se um mês já tem CSV importado. Útil para decidir se vale chamar Trinks. */
export async function temCsvDoMes(mes: string): Promise<boolean> {
  const info = await getCsvFinanceiroImportadoEm(mes);
  return !!info.importadoEm;
}

// ─── Conversão CSV financeiro → "transações sintéticas" ─────────────────────
//
// Os adapters do frontend (trinksStore.ts) leem `transacoes` e usam:
//   - getItemDate: dataHoraInicio | dataHora | dataReferencia | data | date
//   - getTransactionValue: totalPagar | valor | amount | valorTotal
//   - formaPagamento via t.formasPagamentos[].nome+valor (ou t.formaPagamento string)
//
// Geramos uma transação sintética por linha do CSV financeiro com:
//   { data, dataReferencia: data, totalPagar: valorReceber, formasPagamentos: [{nome,valor}] }

interface TransacaoSintetica {
  id: string;
  dataReferencia: string;
  data: string;
  totalPagar: number;
  formasPagamentos: Array<{ nome: string; valor: number }>;
  formaPagamento: string;
  cliente?: string;
  _sintetico: true;
}

/**
 * Mapeia nome bruto da forma de pagamento (CSV) para um label amigável que
 * os adapters do frontend conseguem categorizar (Pix / Cartão / Dinheiro / Outros).
 */
function normalizaFormaPagamento(formaPagamento: string, tipoFormaPagamento: string): string {
  const s = `${formaPagamento || ""} ${tipoFormaPagamento || ""}`.toLowerCase();
  if (s.includes("pix")) return "PIX";
  if (s.includes("créd") || s.includes("cred") || s.includes("déb") || s.includes("deb") || s.includes("cart")) {
    return "Cartão";
  }
  if (s.includes("dinhe") || s.includes("espécie") || s.includes("especie") || s.includes("à vista") || s.includes("a vista")) {
    return "Dinheiro";
  }
  return formaPagamento || "Outros";
}

/** Converte payload financeiro em array de transações sintéticas. */
export function csvFinanceiroParaTransacoes(payload: FinanceiroPayload): TransacaoSintetica[] {
  const out: TransacaoSintetica[] = [];
  for (let i = 0; i < payload.rows.length; i++) {
    const r = payload.rows[i];
    const valor = Number(r.valorReceber || r.valorPago || 0);
    if (!r.data || !valor) continue;
    const nomeForma = normalizaFormaPagamento(r.formaPagamento, r.tipoFormaPagamento);
    out.push({
      id: `csv-fin-${payload.mes}-${i}`,
      dataReferencia: r.data,
      data: r.data,
      totalPagar: Math.round(valor * 100) / 100,
      formasPagamentos: [{ nome: nomeForma, valor: Math.round(valor * 100) / 100 }],
      formaPagamento: nomeForma,
      cliente: r.cliente,
      _sintetico: true,
    });
  }
  return out;
}

/**
 * Monta um TrinksData sintético a partir do CSV financeiro (e ranking, se existir).
 *
 * Limitações conhecidas:
 *  - agendamentos fica vazio (CSV não tem agendamentos linha-a-linha por status).
 *    Como consequência, getTrinksMonthTotals.totalClients usa fallback (length de
 *    agendamentos), o que resulta em 0; ticket médio idem. Mas faturamento, gráfico
 *    diário e formas de pagamento ficam corretos.
 *  - profissionais virá da API Trinks se já estiver em cache, senão fica vazio.
 *  - O ranking de barbeiros é populado a partir do CSV ranking (se existir).
 */
export interface TrinksDataSintetico {
  estabelecimento: any;
  profissionais: any[];
  servicos: any[];
  agendamentos: any[];
  transacoes: TransacaoSintetica[];
  clientes: any[];
  syncedAt: string; // usaremos o importadoEm
  fromCsv: true;
  mes: string;
}

export async function montarTrinksDataDeCsv(mes: string, csvAt: string, payload: FinanceiroPayload): Promise<TrinksDataSintetico> {
  const transacoes = csvFinanceiroParaTransacoes(payload);
  return {
    estabelecimento: null,
    profissionais: [],
    servicos: [],
    agendamentos: [],
    transacoes,
    clientes: [],
    syncedAt: csvAt,
    fromCsv: true,
    mes,
  };
}

/** Atalho: lê o payload do mês e retorna TrinksData sintético, ou null se não houver. */
export async function carregarTrinksDataDoCsv(mes: string): Promise<TrinksDataSintetico | null> {
  const csvInfo = await getCsvFinanceiroImportadoEm(mes);
  if (!csvInfo.importadoEm || !csvInfo.payload) return null;
  return await montarTrinksDataDeCsv(mes, csvInfo.importadoEm, csvInfo.payload);
}
