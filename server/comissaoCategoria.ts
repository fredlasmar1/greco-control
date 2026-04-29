// Comissao por categoria de servico (v24)
//
// Regra confirmada pelo usuario (categorias exclusivas):
//   - VIP        -> 50%  (Andre)
//   - Express    -> 50%  (Leonardo, Cesar)
//   - Classico   -> 40%  (Pedro Henrique, Lucas Pacheco, Jose Armando, Matheus)
//   - Assistente -> 40%  (Debora, Ellen, Patricia)
//   - Estetica/Quimicas/Outros -> 40%
//
// Como categorias sao exclusivas por profissional, podemos detectar pelo
// nome do servico OU pelo nome do profissional. Usamos AMBOS como fonte
// para robustez (servico tem prioridade; profissional e fallback).

export const COMISSAO_VIP_EXPRESS = 0.50;
export const COMISSAO_PADRAO = 0.40;

function norm(s: any): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // remove acentos
    .toLowerCase()
    .trim();
}

// Detecta categoria pelo NOME do servico.
// Ex: "Corte VIP", "VIP - Cabelo + Barba", "Corte Express", "Barba Express"
export function ehServicoVipExpress(nomeServico: string): boolean {
  const n = norm(nomeServico);
  if (!n) return false;
  // Match em palavra inteira (evita falso positivo em palavras que contenham "vip")
  return /\bvip\b/.test(n) || /\bexpress\b/.test(n);
}

// Profissionais que SEMPRE atendem VIP ou Express (categorias exclusivas).
// Usado como fallback quando o servico nao identifica claramente.
const PROFISSIONAIS_VIP = new Set(["andre"]);
const PROFISSIONAIS_EXPRESS = new Set(["leonardo", "cesar", "césar"].map(norm));

export function ehProfissionalVipExpress(nomeProfissional: string): boolean {
  const n = norm(nomeProfissional);
  if (!n) return false;
  // Match por primeiro nome ou nome inteiro contendo o termo
  for (const p of PROFISSIONAIS_VIP) if (n === p || n.startsWith(p + " ")) return true;
  for (const p of PROFISSIONAIS_EXPRESS) if (n === p || n.startsWith(p + " ")) return true;
  return false;
}

// Decide a comissao % baseado no servico (prioridade) ou no profissional (fallback).
// Retorna 0.50 para VIP/Express, 0.40 para o resto.
export function getComissaoPctDoServico(
  nomeServico?: string | null,
  nomeProfissional?: string | null,
): number {
  if (nomeServico && ehServicoVipExpress(nomeServico)) return COMISSAO_VIP_EXPRESS;
  if (nomeProfissional && ehProfissionalVipExpress(nomeProfissional)) return COMISSAO_VIP_EXPRESS;
  return COMISSAO_PADRAO;
}

// Categoria textual (para logs/debug).
export function getCategoriaServico(
  nomeServico?: string | null,
  nomeProfissional?: string | null,
): "vip_express" | "padrao" {
  if (nomeServico && ehServicoVipExpress(nomeServico)) return "vip_express";
  if (nomeProfissional && ehProfissionalVipExpress(nomeProfissional)) return "vip_express";
  return "padrao";
}

// ====================================================================
// v24: Margem desejada por categoria de serviço (defaults)
// ====================================================================
// Usada como sugestão quando o serviço não tem margemDesejadaPct override.
// Detecta pela CATEGORIA do serviço (vinda da Trinks) ou pelo nome.
//
// Defaults aprovados:
//   - Cortes/Barbas/Combos:   30%
//   - Químicas/Estética:      35%
//   - Depilação/VIP:          40%
export function getMargemDesejadaDefault(
  categoriaServico?: string | null,
  nomeServico?: string | null,
): number {
  const cat = norm(categoriaServico);
  const nm = norm(nomeServico);
  const txt = `${cat} ${nm}`;

  // VIP → 40%
  if (/\bvip\b/.test(txt)) return 40;
  // Depilação → 40%
  if (/depilac/.test(txt)) return 40;
  // Químicas (tintura, descoloração, alisamento, progressiva, relaxamento) → 35%
  if (/quimic|tintur|colorac|descolor|alisa|progressiv|relaxa|matiza/.test(txt)) return 35;
  // Estética (limpeza pele, hidratação, sobrancelha, pestana, massagem) → 35%
  if (/estetic|limpez|hidrat|sobrancelh|pestan|massag|micropigment/.test(txt)) return 35;
  // Cortes/Barbas/Combos (caso básico) → 30%
  if (/corte|barba|cabelo|combo|navalh/.test(txt)) return 30;
  // Default geral: 30%
  return 30;
}

// ====================================================================
// v24: Cálculo expandido de margem para um serviço
// ====================================================================
// custo_total       = ficha + (duracao × custoFixo/min) + (preco × comissao%)
// margem_real_R$    = preco − custo_total
// margem_real_%     = margem_real_R$ ÷ preco
// preco_sugerido    = (ficha + custoFixoRateado) ÷ (1 − comissao% − margem%)
// Se (comissao% + margem%) >= 100 → erro tratado.

export interface CalculoServicoInput {
  preco: number;
  duracaoMin: number;
  fichaTecnica: number;       // total dos itens da ficha
  custoFixoPorMinuto: number; // vindo de calcularCustoFixoPorMinuto
  comissaoPct: number;        // 0..100
  margemDesejadaPct: number;  // 0..100
}

export interface CalculoServicoOutput {
  custoFixoRateado: number;
  comissaoValor: number;
  custoTotal: number;
  margemRealValor: number;
  margemRealPct: number;
  precoSugerido: number | null;
  precoSugeridoErro?: string;
}

export function calcularMargemServico(input: CalculoServicoInput): CalculoServicoOutput {
  const preco = Math.max(0, Number(input.preco) || 0);
  const dur = Math.max(0, Number(input.duracaoMin) || 0);
  const ficha = Math.max(0, Number(input.fichaTecnica) || 0);
  const cfm = Math.max(0, Number(input.custoFixoPorMinuto) || 0);
  const com = Math.max(0, Math.min(100, Number(input.comissaoPct) || 0));
  const mar = Math.max(0, Math.min(100, Number(input.margemDesejadaPct) || 0));

  const custoFixoRateado = dur * cfm;
  const comissaoValor = preco * (com / 100);
  const custoTotal = ficha + custoFixoRateado + comissaoValor;
  const margemRealValor = preco - custoTotal;
  const margemRealPct = preco > 0 ? (margemRealValor / preco) * 100 : 0;

  let precoSugerido: number | null = null;
  let precoSugeridoErro: string | undefined;
  const denom = 1 - (com / 100) - (mar / 100);
  if (denom <= 0) {
    precoSugeridoErro = `Comissão (${com}%) + margem desejada (${mar}%) ≥ 100%. Impossível calcular preço sugerido.`;
  } else {
    precoSugerido = (ficha + custoFixoRateado) / denom;
  }

  return {
    custoFixoRateado: Number(custoFixoRateado.toFixed(2)),
    comissaoValor: Number(comissaoValor.toFixed(2)),
    custoTotal: Number(custoTotal.toFixed(2)),
    margemRealValor: Number(margemRealValor.toFixed(2)),
    margemRealPct: Number(margemRealPct.toFixed(2)),
    precoSugerido: precoSugerido !== null ? Number(precoSugerido.toFixed(2)) : null,
    ...(precoSugeridoErro ? { precoSugeridoErro } : {}),
  };
}
