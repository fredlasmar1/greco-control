// Configurações financeiras globais (taxa cartão, custos operacionais, etc).
// Persistido em kv_store (Postgres) sob a chave "config_financeira".
import { kvGet, kvSet } from "./db";
import { log } from "./index";

export interface ConfigFinanceira {
  // Taxa única de cartão (média ponderada de débito/crédito/parcelado).
  // Aplicada proporcionalmente ao valor que veio em cartão na transação.
  // 0..100. Default 0 (não desconta).
  taxaCartaoPct: number;
  atualizadoEm: string;
}

const KV_KEY = "config_financeira";

const DEFAULT: ConfigFinanceira = {
  taxaCartaoPct: 0,
  atualizadoEm: new Date(0).toISOString(),
};

export async function getConfig(): Promise<ConfigFinanceira> {
  try {
    const data = await kvGet<ConfigFinanceira>(KV_KEY);
    if (!data) return { ...DEFAULT };
    return {
      taxaCartaoPct: Number(data.taxaCartaoPct) || 0,
      atualizadoEm: data.atualizadoEm || DEFAULT.atualizadoEm,
    };
  } catch (err: any) {
    log(`getConfig error: ${err.message}`, "config");
    return { ...DEFAULT };
  }
}

export async function setConfig(input: Partial<ConfigFinanceira>): Promise<ConfigFinanceira> {
  const atual = await getConfig();
  const taxa = input.taxaCartaoPct !== undefined ? Number(input.taxaCartaoPct) : atual.taxaCartaoPct;
  const novo: ConfigFinanceira = {
    taxaCartaoPct: Math.max(0, Math.min(100, isFinite(taxa) ? taxa : 0)),
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
