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

// Profissionais que SEMPRE atendem VIP ou Express (defaults).
// Podem ser sobrescritos via config (Configurações → Profissionais e Categorias).
const PROFISSIONAIS_VIP_DEFAULT = ["andre"];
const PROFISSIONAIS_EXPRESS_DEFAULT = ["leonardo", "cesar", "césar"];

// Config opcional injetada de storeData.settings em runtime.
// Se não setada, usa os defaults acima.
export interface ComissaoConfig {
  profissionaisVip?: string[];
  profissionaisExpress?: string[];
  comissaoVipExpressPct?: number; // 0..100
  comissaoPadraoPct?: number;     // 0..100
}

let runtimeConfig: ComissaoConfig | null = null;

export function setComissaoConfig(config: ComissaoConfig | null) {
  runtimeConfig = config;
}

function getVipList(): Set<string> {
  const lista = runtimeConfig?.profissionaisVip ?? PROFISSIONAIS_VIP_DEFAULT;
  return new Set(lista.map(norm).filter(Boolean));
}
function getExpressList(): Set<string> {
  const lista = runtimeConfig?.profissionaisExpress ?? PROFISSIONAIS_EXPRESS_DEFAULT;
  return new Set(lista.map(norm).filter(Boolean));
}
function getPctVipExpress(): number {
  const p = runtimeConfig?.comissaoVipExpressPct;
  return typeof p === "number" && p > 0 ? p / 100 : COMISSAO_VIP_EXPRESS;
}
function getPctPadrao(): number {
  const p = runtimeConfig?.comissaoPadraoPct;
  return typeof p === "number" && p > 0 ? p / 100 : COMISSAO_PADRAO;
}

export function ehProfissionalVipExpress(nomeProfissional: string): boolean {
  const n = norm(nomeProfissional);
  if (!n) return false;
  // Match por primeiro nome ou nome inteiro contendo o termo
  const vips = Array.from(getVipList());
  for (const p of vips) if (n === p || n.startsWith(p + " ") || n.includes(" " + p)) return true;
  const expresses = Array.from(getExpressList());
  for (const p of expresses) if (n === p || n.startsWith(p + " ") || n.includes(" " + p)) return true;
  return false;
}

// Decide a comissao % baseado no servico (prioridade) ou no profissional (fallback).
// Retorna fração (ex: 0.50 para 50%).
export function getComissaoPctDoServico(
  nomeServico?: string | null,
  nomeProfissional?: string | null,
): number {
  if (nomeServico && ehServicoVipExpress(nomeServico)) return getPctVipExpress();
  if (nomeProfissional && ehProfissionalVipExpress(nomeProfissional)) return getPctVipExpress();
  return getPctPadrao();
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
  comissaoPct: number;        // 0..100 — comissão do BARBEIRO/EXECUTOR
  comissaoAssistentePct?: number;  // 0..100 — % adicional pro assistente (default 0)
  margemDesejadaPct: number;  // 0..100
}

export interface CalculoServicoOutput {
  custoFixoRateado: number;
  comissaoValor: number;          // soma barbeiro + assistente
  comissaoBarbeiroValor: number;  // só barbeiro
  comissaoAssistenteValor: number; // só assistente (0 se não usado)
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
  const ass = Math.max(0, Math.min(100, Number(input.comissaoAssistentePct) || 0));
  const comTot = Math.min(100, com + ass); // % total de comissão (barbeiro + assistente)
  const mar = Math.max(0, Math.min(100, Number(input.margemDesejadaPct) || 0));

  const custoFixoRateado = dur * cfm;
  const comissaoBarbeiroValor = preco * (com / 100);
  const comissaoAssistenteValor = preco * (ass / 100);
  const comissaoValor = comissaoBarbeiroValor + comissaoAssistenteValor;
  const custoTotal = ficha + custoFixoRateado + comissaoValor;
  const margemRealValor = preco - custoTotal;
  const margemRealPct = preco > 0 ? (margemRealValor / preco) * 100 : 0;

  let precoSugerido: number | null = null;
  let precoSugeridoErro: string | undefined;
  const denom = 1 - (comTot / 100) - (mar / 100);
  if (denom <= 0) {
    precoSugeridoErro = `Comissão total (${comTot}%) + margem (${mar}%) ≥ 100%. Impossível calcular preço sugerido.`;
  } else {
    precoSugerido = (ficha + custoFixoRateado) / denom;
  }

  return {
    custoFixoRateado: Number(custoFixoRateado.toFixed(2)),
    comissaoValor: Number(comissaoValor.toFixed(2)),
    comissaoBarbeiroValor: Number(comissaoBarbeiroValor.toFixed(2)),
    comissaoAssistenteValor: Number(comissaoAssistenteValor.toFixed(2)),
    custoTotal: Number(custoTotal.toFixed(2)),
    margemRealValor: Number(margemRealValor.toFixed(2)),
    margemRealPct: Number(margemRealPct.toFixed(2)),
    precoSugerido: precoSugerido !== null ? Number(precoSugerido.toFixed(2)) : null,
    ...(precoSugeridoErro ? { precoSugeridoErro } : {}),
  };
}
