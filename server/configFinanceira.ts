// Configurações financeiras globais (taxa cartão, custos operacionais, etc).
// Persistido em kv_store (Postgres) sob a chave "config_financeira".
import { kvGet, kvSet } from "./db";
import { log } from "./index";

export interface ConfigFinanceira {
  // Taxa única de cartão (média ponderada de débito/crédito/parcelado).
  // Aplicada proporcionalmente ao valor que veio em cartão na transação.
  // 0..100. Default 0 (não desconta).
  taxaCartaoPct: number;

  // ─── Parâmetros operacionais (v24) ───
  // Usados para ratear o custo fixo da operação por minuto de cadeira.
  cadeiras: number;       // n. de cadeiras (postos de trabalho). Default 9.
  horasDia: number;       // horas que a barbearia opera por dia. Default 12.
  diasMes: number;        // dias úteis no mês (ter-sáb ~22). Default 22.
  ocupacaoPct: number;    // % média de ocupação esperada. 0..100. Default 50.

  atualizadoEm: string;
}

const KV_KEY = "config_financeira";

const DEFAULT: ConfigFinanceira = {
  taxaCartaoPct: 0,
  cadeiras: 9,
  horasDia: 12,
  diasMes: 22,
  ocupacaoPct: 50,
  atualizadoEm: new Date(0).toISOString(),
};

function clampPct(n: number, fallback = 0): number {
  const v = Number(n);
  if (!isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, v));
}
function clampPos(n: number, fallback: number): number {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return fallback;
  return v;
}

export async function getConfig(): Promise<ConfigFinanceira> {
  try {
    const data = await kvGet<Partial<ConfigFinanceira>>(KV_KEY);
    if (!data) return { ...DEFAULT };
    return {
      taxaCartaoPct: clampPct(data.taxaCartaoPct ?? 0, 0),
      cadeiras: clampPos(data.cadeiras ?? DEFAULT.cadeiras, DEFAULT.cadeiras),
      horasDia: clampPos(data.horasDia ?? DEFAULT.horasDia, DEFAULT.horasDia),
      diasMes: clampPos(data.diasMes ?? DEFAULT.diasMes, DEFAULT.diasMes),
      ocupacaoPct: clampPct(data.ocupacaoPct ?? DEFAULT.ocupacaoPct, DEFAULT.ocupacaoPct),
      atualizadoEm: data.atualizadoEm || DEFAULT.atualizadoEm,
    };
  } catch (err: any) {
    log(`getConfig error: ${err.message}`, "config");
    return { ...DEFAULT };
  }
}

export async function setConfig(input: Partial<ConfigFinanceira>): Promise<ConfigFinanceira> {
  const atual = await getConfig();
  const novo: ConfigFinanceira = {
    taxaCartaoPct: input.taxaCartaoPct !== undefined
      ? clampPct(input.taxaCartaoPct, atual.taxaCartaoPct)
      : atual.taxaCartaoPct,
    cadeiras: input.cadeiras !== undefined
      ? clampPos(input.cadeiras, atual.cadeiras)
      : atual.cadeiras,
    horasDia: input.horasDia !== undefined
      ? clampPos(input.horasDia, atual.horasDia)
      : atual.horasDia,
    diasMes: input.diasMes !== undefined
      ? clampPos(input.diasMes, atual.diasMes)
      : atual.diasMes,
    ocupacaoPct: input.ocupacaoPct !== undefined
      ? clampPct(input.ocupacaoPct, atual.ocupacaoPct)
      : atual.ocupacaoPct,
    atualizadoEm: new Date().toISOString(),
  };
  await kvSet(KV_KEY, novo);
  return novo;
}

// Helper: dado um array de formasPagamentos do Trinks, retorna a fração
// (0..1) do valor que foi pago em cartão. Usado para ratear a taxa.
export function fracaoCartao(formasPagamentos: any[]): number {
  if (!Array.isArray(formasPagamentos) || formasPagamentos.length === 0) return 0;
  const total = formasPagamentos.reduce((s, fp) => s + Number(fp?.valor || 0), 0);
  if (total <= 0) return 0;
  const cartao = formasPagamentos.reduce((s, fp) => {
    const nome = String(fp?.nome || "").toLowerCase();
    const ehCartao = nome.includes("cart") || nome.includes("crédit") || nome.includes("credit") || nome.includes("débit") || nome.includes("debit") || nome.includes("visa") || nome.includes("master") || nome.includes("elo") || nome.includes("hiper") || nome.includes("amex");
    return s + (ehCartao ? Number(fp?.valor || 0) : 0);
  }, 0);
  return Math.max(0, Math.min(1, cartao / total));
}

// ─── v24: Custo fixo por minuto da operação ───
// Fórmula:
//   minutosProdutivosMes = cadeiras × horasDia × 60 × diasMes × (ocupacaoPct/100)
//   custoFixoPorMinuto   = totalDespesasFixas ÷ minutosProdutivosMes
// Retorna 0 se ocupação ou outros parâmetros forem zero (evita divisão por zero).
export interface CustoFixoMinutoResult {
  mes: string;
  totalFixas: number;
  cadeiras: number;
  horasDia: number;
  diasMes: number;
  ocupacaoPct: number;
  minutosProdutivosMes: number;
  custoFixoPorMinuto: number;
}

export function calcularCustoFixoPorMinuto(
  mes: string,
  totalFixas: number,
  cfg: Pick<ConfigFinanceira, "cadeiras" | "horasDia" | "diasMes" | "ocupacaoPct">,
): CustoFixoMinutoResult {
  const ocup = (cfg.ocupacaoPct || 0) / 100;
  const minutosProdutivosMes = cfg.cadeiras * cfg.horasDia * 60 * cfg.diasMes * ocup;
  const custoFixoPorMinuto = minutosProdutivosMes > 0 ? totalFixas / minutosProdutivosMes : 0;
  return {
    mes,
    totalFixas: Number((totalFixas || 0).toFixed(2)),
    cadeiras: cfg.cadeiras,
    horasDia: cfg.horasDia,
    diasMes: cfg.diasMes,
    ocupacaoPct: cfg.ocupacaoPct,
    minutosProdutivosMes: Number(minutosProdutivosMes.toFixed(2)),
    custoFixoPorMinuto: Number(custoFixoPorMinuto.toFixed(4)),
  };
}
