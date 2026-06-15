/**
 * mesService — serviço CANÔNICO de dados mensais.
 *
 * Substitui as 4 cascatas espalhadas (caixa-dia, hoje-completo, mes/dados,
 * equipe-periodo) por UM ponto de verdade. Endpoints param de divergir.
 *
 * Como funciona:
 *   1. Tenta TODAS as fontes disponíveis (API Trinks, CSV financeiro, CSV
 *      caixa, snapshots).
 *   2. Escolhe a MAIS COMPLETA (maior faturamento e maior contagem).
 *   3. Cacheia agressivamente (eterno pra mês fechado, 5min pra corrente).
 *   4. Expõe metadados de TODAS as fontes pra UI auditar/comparar.
 *
 * Todos os endpoints (Dashboard, Equipe, DRE, Fechamento, Pagamento) devem
 * passar a ler daqui pra que os números fechem entre as abas.
 */

import { kvGet } from "./db";
import * as trinksImport from "./trinksImport";

/** Resultado canônico — fonte da verdade pro mês inteiro. */
export interface MesData {
  mes: string;                              // "YYYY-MM"
  fonte: FonteEscolhida;                    // qual fonte foi escolhida
  comandas: number;                         // qtd de "comandas" (transações)
  faturamento: number;                      // R$ total recebido
  breakdown: BreakdownPagamento;            // por forma de pagamento
  transacoes: any[];                        // raw (compatível com formato Trinks)
  agendamentos: any[];                      // raw (compatível com formato Trinks)
  fontesAuditoria: FontesAuditoria;         // metadados de TODAS as fontes
  capturadoEm: string;                      // ISO
}

export type FonteEscolhida = "api-trinks" | "csv-caixa" | "csv-financeiro" | "snapshot" | "vazio";

export interface BreakdownPagamento {
  pix: number;
  cartaoCredito: number;
  cartaoDebito: number;
  dinheiro: number;
  plano: number;        // pré-pago / depósito
  voucher: number;
  outros: number;
}

/** Metadado de cada fonte — pra UI mostrar "API tem X, CSV tem Y". */
export interface FontesAuditoria {
  apiTrinks: { disponivel: boolean; faturamento: number; comandas: number; capturadoEm: string | null };
  csvCaixa: { disponivel: boolean; faturamento: number; comandas: number; geradoEm: string | null };
  csvFinanceiro: { disponivel: boolean; faturamento: number; pagamentos: number; geradoEm: string | null };
}

// ─── Cache ──────────────────────────────────────────────────────────────
// Cache em memória do processo + opcionalmente persistente no Postgres
// (não persistido por agora — simples invalidação por restart é aceitável).

interface CacheEntry { data: MesData; expiraEm: number; }
const memCache = new Map<string, CacheEntry>();

function getCacheTtl(mes: string): number {
  const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const mesCorrente = hojeSP.slice(0, 7);
  // Mês fechado é imutável → 24h. Mês corrente muda durante o dia → 5min.
  if (mes < mesCorrente) return 24 * 60 * 60 * 1000;
  return 5 * 60 * 1000;
}

/** Invalida cache do mês — chamar quando CSV importado ou sync Trinks roda. */
export function invalidarMesCache(mes: string): void {
  memCache.delete(mes);
}

/** Invalida tudo. */
export function invalidarTodos(): void {
  memCache.clear();
}

// ─── Coletores por fonte ────────────────────────────────────────────────

interface ResultadoFonte {
  fonte: FonteEscolhida;
  faturamento: number;
  comandas: number;
  transacoes: any[];
  agendamentos: any[];
}

/** Lê o CSV Caixa (por comanda) — formato mais rico, com breakdown. */
async function lerCsvCaixa(mes: string): Promise<ResultadoFonte | null> {
  try {
    const payload: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
    if (!payload?.rows || !Array.isArray(payload.rows)) return null;
    const rows = payload.rows.filter((r: any) => String(r.data || "").startsWith(mes));
    if (rows.length === 0) return null;
    const transacoes = rows.map((r: any) => ({
      id: `csvcaixa-${r.data}-${r.clienteId || r.clienteNome}`.replace(/\s+/g, "-"),
      dataReferencia: r.data,
      dataHora: r.data,
      totalPagar: Number(r.totalGeral || 0),
      cliente: { id: r.clienteId, nome: r.clienteNome },
      formasPagamentos: [
        ...(Number(r.totalCredito) > 0 ? [{ nome: "Cartão de Crédito", valor: Number(r.totalCredito) }] : []),
        ...(Number(r.totalDebito) > 0 ? [{ nome: "Cartão de Débito", valor: Number(r.totalDebito) }] : []),
        ...(Number(r.totalDinheiro) > 0 ? [{ nome: "Dinheiro", valor: Number(r.totalDinheiro) }] : []),
        ...(Number(r.totalPrePago) > 0 ? [{ nome: "Pré-Pago", valor: Number(r.totalPrePago) }] : []),
        ...(Number(r.totalOutros) > 0 ? [{ nome: "Outros", valor: Number(r.totalOutros) }] : []),
      ],
    }));
    const faturamento = transacoes.reduce((s: number, t: any) => s + Number(t.totalPagar || 0), 0);
    return { fonte: "csv-caixa", faturamento, comandas: transacoes.length, transacoes, agendamentos: [] };
  } catch { return null; }
}

/** Lê o CSV Financeiro (por previsão de recebimento). */
async function lerCsvFinanceiro(mes: string): Promise<ResultadoFonte | null> {
  try {
    const payload: any = await kvGet(trinksImport.kvKeyFor("financeiro", mes));
    if (!payload?.rows || !Array.isArray(payload.rows)) return null;
    const rows = payload.rows.filter((r: any) => String(r.data || "").startsWith(mes));
    if (rows.length === 0) return null;
    const transacoes = rows.map((r: any) => ({
      id: `csvfin-${r.data}-${r.cliente || ""}-${r.valorPago || r.valorReceber || 0}`.replace(/\s+/g, "-"),
      dataReferencia: r.data,
      dataHora: r.data,
      totalPagar: Number(r.valorPago || r.valorReceber || 0),
      cliente: { nome: r.cliente || "" },
      formasPagamentos: [{ nome: r.formaPagamento || r.tipoFormaPagamento || "Outros", valor: Number(r.valorPago || r.valorReceber || 0) }],
    }));
    const faturamento = transacoes.reduce((s: number, t: any) => s + Number(t.totalPagar || 0), 0);
    return { fonte: "csv-financeiro", faturamento, comandas: transacoes.length, transacoes, agendamentos: [] };
  } catch { return null; }
}

/** Lê da API Trinks — chamada injetada (pra evitar import circular). */
async function lerApiTrinks(
  mes: string,
  trinksFetchAllRange: (path: string, params: Record<string, string>) => Promise<any[]>,
): Promise<ResultadoFonte | null> {
  try {
    const [yStr, mStr] = mes.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const ultimoDia = new Date(y, m, 0).getDate();
    const dataInicio = `${mes}-01`;
    const dataFim = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
    // [dataInicio, dataFim+1) semi-aberto
    const transFimStr = (() => {
      const d = new Date(y, m, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    })();
    const [transacoes, agendamentos] = await Promise.all([
      trinksFetchAllRange("transacoes", { dataInicio, dataFim: transFimStr }).catch(() => [] as any[]),
      trinksFetchAllRange("agendamentos", { dataInicio, dataFim }).catch(() => [] as any[]),
    ]);
    if (!Array.isArray(transacoes) || transacoes.length === 0) return null;
    const faturamento = transacoes.reduce((s: number, t: any) => s + Number(t.totalPagar || 0), 0);
    return {
      fonte: "api-trinks",
      faturamento,
      comandas: transacoes.length,
      transacoes,
      agendamentos: Array.isArray(agendamentos) ? agendamentos : [],
    };
  } catch { return null; }
}

/**
 * v42: lê a API Trinks com TIMEOUT CURTO e falha isolada.
 * A Trinks NUNCA deve segurar o render do mês — se a API estiver lenta/429,
 * resolvemos null em poucos segundos e o chamador cai pro CSV. O dia corrente
 * ("agora") é a única janela que depende dela, e mesmo essa degrada graciosa.
 */
async function lerApiTrinksComTimeout(
  mes: string,
  trinksFetchAllRange: (path: string, params: Record<string, string>) => Promise<any[]>,
  log?: (msg: string, source?: string) => void,
  timeoutMs = 4000,
): Promise<ResultadoFonte | null> {
  try {
    return await Promise.race([
      lerApiTrinks(mes, trinksFetchAllRange),
      new Promise<null>((resolve) => setTimeout(() => {
        log?.(`[mesService] API Trinks ${mes} estourou timeout de ${timeoutMs}ms — usando CSV`, "mesService");
        resolve(null);
      }, timeoutMs)),
    ]);
  } catch { return null; }
}

// ─── Breakdown por forma de pagamento ──────────────────────────────────

function calcularBreakdown(transacoes: any[]): BreakdownPagamento {
  const b: BreakdownPagamento = {
    pix: 0, cartaoCredito: 0, cartaoDebito: 0, dinheiro: 0, plano: 0, voucher: 0, outros: 0,
  };
  for (const t of transacoes) {
    const formas = t.formasPagamentos || t.formasPagamento || [];
    if (Array.isArray(formas) && formas.length > 0) {
      for (const fp of formas) {
        const nome = String(fp.nome || "").toLowerCase();
        const v = Number(fp.valor || 0);
        if (nome.includes("pix")) b.pix += v;
        else if (nome.includes("créd") || nome.includes("cred")) b.cartaoCredito += v;
        else if (nome.includes("déb") || nome.includes("deb")) b.cartaoDebito += v;
        else if (nome.includes("dinhe") || nome.includes("espéc") || nome.includes("espec")) b.dinheiro += v;
        else if (nome.includes("depós") || nome.includes("depos") || nome.includes("pré") || nome.includes("pre-") || nome.includes("saldo") || nome.includes("plano")) b.plano += v;
        else if (nome.includes("voucher") || nome.includes("cortes")) b.voucher += v;
        else b.outros += v;
      }
    } else {
      b.outros += Number(t.totalPagar || 0);
    }
  }
  return b;
}

// ─── Função principal: a fonte da verdade ───────────────────────────────

export interface GetMesDataDeps {
  trinksFetchAllRange: (path: string, params: Record<string, string>) => Promise<any[]>;
  log?: (msg: string, source?: string) => void;
}

/**
 * Retorna os dados canônicos do mês. TODAS as telas devem ler daqui.
 *
 * Estratégia: tenta todas as fontes em paralelo, escolhe a MAIS COMPLETA
 * (maior faturamento E maior contagem). Em empate ou dúvida, prefere API
 * Trinks > CSV-Caixa > CSV-Financeiro.
 */
export async function getMesData(
  mes: string,
  deps: GetMesDataDeps,
  opts?: { force?: boolean; ignorarApi?: boolean },
): Promise<MesData> {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new Error(`mes inválido: ${mes}`);
  }

  // Cache hit
  if (!opts?.force) {
    const cached = memCache.get(mes);
    if (cached && cached.expiraEm > Date.now()) {
      return cached.data;
    }
  }

  // ── v42: regra de JANELA-DE-TEMPO (substitui o score "mais completa") ──
  // As fontes não competem; cada uma governa a janela onde é melhor.
  //   • Mês FECHADO  → CSV SEMPRE; API Trinks NUNCA é consultada (era a origem
  //     do timeout de 12s quando a API dá 429).
  //   • Mês CORRENTE → API governa o "agora" (tem o dia de hoje ao vivo); se
  //     falhar/vier vazia, cai pro CSV importado (preenchimento provisório).
  const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const mesCorrente = hojeSP.slice(0, 7);
  const ehMesFechado = mes < mesCorrente;
  const ignorarApi = opts?.ignorarApi || ehMesFechado;

  // Coleta paralela das fontes permitidas para a janela
  const [resApi, resCaixa, resFinanceiro, payloadCaixa, payloadFinanceiro] = await Promise.all([
    ignorarApi ? Promise.resolve(null) : lerApiTrinksComTimeout(mes, deps.trinksFetchAllRange, deps.log),
    lerCsvCaixa(mes),
    lerCsvFinanceiro(mes),
    kvGet<any>(trinksImport.kvKeyFor("caixa", mes)),
    kvGet<any>(trinksImport.kvKeyFor("financeiro", mes)),
  ]);

  // Monta auditoria — sempre todas as fontes, com seus números
  const fontesAuditoria: FontesAuditoria = {
    apiTrinks: {
      disponivel: !!resApi,
      faturamento: resApi?.faturamento || 0,
      comandas: resApi?.comandas || 0,
      capturadoEm: resApi ? new Date().toISOString() : null,
    },
    csvCaixa: {
      disponivel: !!resCaixa,
      faturamento: resCaixa?.faturamento || 0,
      comandas: resCaixa?.comandas || 0,
      geradoEm: payloadCaixa?.geradoEm || null,
    },
    csvFinanceiro: {
      disponivel: !!resFinanceiro,
      faturamento: resFinanceiro?.faturamento || 0,
      pagamentos: resFinanceiro?.comandas || 0,
      geradoEm: payloadFinanceiro?.geradoEm || null,
    },
  };

  // ── Escolha por JANELA-DE-TEMPO + DOMÍNIO (sem score) ──
  // Mês fechado: o faturamento oficial vem do CSV-FINANCEIRO ("Data Prevista de
  //   Recebimento") — único líquido de troco e com breakdown de pagamento
  //   (PIX/crédito/débito/dinheiro/depósito/voucher). CSV-Caixa é só fallback.
  // Mês corrente: API ao vivo (tem o dia de hoje); se indisponível, CSV importado.
  // A divergência entre fontes (ex.: critério de data) deixa de ser "quem vence"
  // e passa a ser apenas NOTA DE AUDITORIA em `fontesAuditoria`.
  // DOMÍNIO: o faturamento do mês (e o breakdown de pagamento) vem do
  // CSV-FINANCEIRO sempre que existir — fechado OU corrente. CSV-Caixa é
  // fallback (pode vir incompleto, ex.: junho/2026 caixa = R$20,6k vs
  // financeiro = R$41k). A API só entra quando NÃO há nenhum CSV; o "hoje ao
  // vivo" fica nos endpoints dedicados de hoje, não neste agregado mensal.
  let escolhida: ResultadoFonte | null = null;
  if (ehMesFechado) {
    escolhida = resFinanceiro || resCaixa || null;
  } else {
    escolhida = resFinanceiro || resCaixa || ((resApi && resApi.comandas > 0) ? resApi : null);
  }

  const data: MesData = escolhida ? {
    mes,
    fonte: escolhida.fonte,
    comandas: escolhida.comandas,
    faturamento: escolhida.faturamento,
    breakdown: calcularBreakdown(escolhida.transacoes),
    transacoes: escolhida.transacoes,
    agendamentos: escolhida.agendamentos,
    fontesAuditoria,
    capturadoEm: new Date().toISOString(),
  } : {
    mes,
    fonte: "vazio",
    comandas: 0,
    faturamento: 0,
    breakdown: { pix: 0, cartaoCredito: 0, cartaoDebito: 0, dinheiro: 0, plano: 0, voucher: 0, outros: 0 },
    transacoes: [],
    agendamentos: [],
    fontesAuditoria,
    capturadoEm: new Date().toISOString(),
  };

  // Cacheia
  memCache.set(mes, { data, expiraEm: Date.now() + getCacheTtl(mes) });
  deps.log?.(`[mesService] ${mes} resolvido: fonte=${data.fonte} fat=R$${data.faturamento.toFixed(2)} comandas=${data.comandas}`, "mesService");
  return data;
}
