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

// ====================================================================
// v42: Comissão a partir do RANKING (apelido antes do hífen × Total Serviços)
// ====================================================================
// O CSV "Ranking de Profissionais" traz o campo `Profissional` no formato
// "APELIDO - NOME COMPLETO" (ex.: "ANDRÉ - CARLOS ANDRÉ"). O match
// profissional→categoria é feito pelo APELIDO (token antes do primeiro hífen).
//
// Regra confirmada (categorias exclusivas):
//   André                                  → VIP        → 50%
//   Pedro Henrique, Lucas, José Armando,    → Clássico   → 40%
//   Matheus
//   César, Leonardo                         → Express    → 50%
//   Débora, Ellen, Patrícia                 → Assistente → 40%
//
// IMPORTANTE: comissão R$ = `Total Serviços` × (% da categoria). Usa-se
// `Total Serviços` (NÃO `Valor Total`), que separa serviço de produto por pessoa.
// Profissional sem categoria → categoria=null, comissão=0 e `mapeado=false`:
// o chamador DEVE avisar (nunca pagar zero em silêncio nem inventar categoria).

export type CategoriaComissao = "VIP" | "Express" | "Classico" | "Assistente";

// Apelidos normalizados (sem acento, minúsculo) → categoria.
const APELIDO_CATEGORIA: Record<string, CategoriaComissao> = {
  "andre": "VIP",
  "pedro": "Classico", "pedro henrique": "Classico",
  "lucas": "Classico",
  "jose armando": "Classico", "armando": "Classico", "armandinho": "Classico",
  "matheus": "Classico",
  "cesar": "Express",
  "leonardo": "Express",
  "debora": "Assistente",
  "ellen": "Assistente",
  "patricia": "Assistente",
  // Recepção: ganha comissão QUANDO faz um serviço da grade (regra do dono, 02/07).
  // 40% sobre o Total Serviços (ex.: Bruna R$170 → R$68, bate com o fechamento).
  // Produtos comissionam à parte (barber_product_sales / semComissao).
  "bruna": "Assistente",
  "camila": "Assistente",
  // Larissa: secretária de manhã, atende como assistente à tarde. A comissão
  // sai de `Total Serviços` (só a parte de atendimento, ~R$1.555 em jun/2026),
  // nunca de `Valor Total` — vendas de produto/recepção dela não comissionam.
  "larissa": "Assistente",
};

// Apelidos NÃO-COMISSIONÁVEIS por definição (administrativo / não atende mais).
// Diferente de "não-mapeado": aqui a comissão é R$ 0 INTENCIONAL e SILENCIOSA —
// não entra no banner de "sem categoria" (não é um cadastro faltando).
//   - Guilherme: ex-barbeiro, hoje no administrativo. Os R$330 de serviço em
//     abril são resíduo já acertado por fora; não comissiona em mês nenhum.
const NAO_COMISSIONAVEL = new Set<string>(["guilherme"]);

const PCT_CATEGORIA: Record<CategoriaComissao, number> = {
  VIP: COMISSAO_VIP_EXPRESS,        // 50%
  Express: COMISSAO_VIP_EXPRESS,    // 50%
  Classico: COMISSAO_PADRAO,        // 40%
  Assistente: COMISSAO_PADRAO,      // 40%
};

/** Extrai o apelido (token antes do primeiro hífen) já normalizado. */
export function apelidoDoRanking(profissional: string): string {
  const antesDoHifen = String(profissional || "").split(/[-–—]/)[0];
  return norm(antesDoHifen);
}

/** Categoria pelo apelido do ranking, ou null se não mapeado (não assume nada). */
export function categoriaPorApelidoRanking(profissional: string): CategoriaComissao | null {
  const ap = apelidoDoRanking(profissional);
  if (!ap) return null;
  if (APELIDO_CATEGORIA[ap]) return APELIDO_CATEGORIA[ap];
  // fallback: primeiro nome do apelido (ex.: "pedro henrique" → "pedro")
  const token1 = ap.split(/\s+/)[0];
  if (token1 && APELIDO_CATEGORIA[token1]) return APELIDO_CATEGORIA[token1];
  return null;
}

/** % (fração) da categoria. */
export function pctDaCategoria(cat: CategoriaComissao): number {
  return PCT_CATEGORIA[cat];
}

/** Apelido é administrativo / não-comissionável por definição? */
export function ehNaoComissionavel(profissional: string): boolean {
  const ap = apelidoDoRanking(profissional);
  if (!ap) return false;
  if (NAO_COMISSIONAVEL.has(ap)) return true;
  const token1 = ap.split(/\s+/)[0];
  return !!token1 && NAO_COMISSIONAVEL.has(token1);
}

export interface ComissaoRankingResult {
  categoria: CategoriaComissao | "Administrativo" | null;
  pct: number;          // fração (0.50 / 0.40 / 0)
  comissao: number;     // R$ = totalServicos × pct
  mapeado: boolean;     // false → chamador deve AVISAR (sem categoria)
  naoComissionavel: boolean; // true → R$ 0 INTENCIONAL, NÃO avisar (administrativo)
}

/**
 * Comissão de serviços a partir do ranking:
 *   comissão R$ = `Total Serviços` × (% da categoria do apelido).
 *
 * Três estados distintos:
 *   - mapeado a categoria de barbeiro → comissão = TS × %.
 *   - NÃO-comissionável por definição (administrativo) → comissão 0, mapeado=true,
 *     naoComissionavel=true → silencioso (não entra no banner).
 *   - não-mapeado (desconhecido) → comissão 0, mapeado=false → chamador AVISA.
 */
export function comissaoServicosRanking(
  profissional: string,
  totalServicos: number,
): ComissaoRankingResult {
  const ts = Math.max(0, Number(totalServicos) || 0);
  // Administrativo / não atende: R$ 0 intencional, sem alerta.
  if (ehNaoComissionavel(profissional)) {
    return { categoria: "Administrativo", pct: 0, comissao: 0, mapeado: true, naoComissionavel: true };
  }
  const cat = categoriaPorApelidoRanking(profissional);
  if (!cat) return { categoria: null, pct: 0, comissao: 0, mapeado: false, naoComissionavel: false };
  const pct = pctDaCategoria(cat);
  // v98: ESCALONAMENTO POR META (regra confirmada pelo dono, 02/07). Barbeiro do
  // CLÁSSICO que fizer MAIS de R$10.000 em serviços no mês ganha 45% sobre TUDO
  // (não só o excedente) — igual ao fechamento oficial da Trinks. Abaixo de 10k =
  // 40%. VIP/Express (50%) e Assistente (40%) seguem fixos.
  const LIMITE_ESCALA = 10000;
  const PCT_ESCALA = 0.45;
  let comissao: number;
  if (cat === "Classico" && ts > LIMITE_ESCALA) {
    comissao = ts * PCT_ESCALA; // 45% sobre o total
  } else {
    comissao = ts * pct;
  }
  return { categoria: cat, pct, comissao: Math.round(comissao * 100) / 100, mapeado: true, naoComissionavel: false };
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
  taxaCartaoPct?: number;     // v56: 0..100 — taxa da maquininha (% do preço)
  impostoPct?: number;        // v56: 0..100 — imposto sobre faturamento (% do preço)
  // v70: custo fixo POR ATENDIMENTO (totalFixas ÷ média de atendimentos/mês).
  // Quando informado, SUBSTITUI o rateio por minuto (decisão do dono). R$ por atendimento.
  custoFixoPorAtendimento?: number;
  outrosCustos?: number;      // v70: outros custos do serviço, em R$ (campo livre)
}

export interface CalculoServicoOutput {
  custoFixoRateado: number;
  outrosCustos: number;           // v70: outros custos em R$
  comissaoValor: number;          // soma barbeiro + assistente
  comissaoBarbeiroValor: number;  // só barbeiro
  comissaoAssistenteValor: number; // só assistente (0 se não usado)
  taxaCartaoValor: number;        // v56: R$ da taxa de cartão
  impostoValor: number;           // v56: R$ do imposto
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
  // v56: variáveis percentuais sobre o preço (taxa maquininha + imposto).
  const tax = Math.max(0, Math.min(100, Number(input.taxaCartaoPct) || 0));
  const imp = Math.max(0, Math.min(100, Number(input.impostoPct) || 0));

  // v70: custo fixo por ATENDIMENTO (se informado) tem prioridade sobre o por-minuto.
  const cfa = Number(input.custoFixoPorAtendimento);
  const custoFixoRateado = isFinite(cfa) && cfa >= 0 ? cfa : dur * cfm;
  const outros = Math.max(0, Number(input.outrosCustos) || 0);
  const comissaoBarbeiroValor = preco * (com / 100);
  const comissaoAssistenteValor = preco * (ass / 100);
  const comissaoValor = comissaoBarbeiroValor + comissaoAssistenteValor;
  const taxaCartaoValor = preco * (tax / 100);
  const impostoValor = preco * (imp / 100);
  const custoTotal = ficha + custoFixoRateado + outros + comissaoValor + taxaCartaoValor + impostoValor;
  const margemRealValor = preco - custoTotal;
  const margemRealPct = preco > 0 ? (margemRealValor / preco) * 100 : 0;

  let precoSugerido: number | null = null;
  let precoSugeridoErro: string | undefined;
  // Preço base cobre TODOS os % do preço (comissão + taxa + imposto) + a margem.
  const denom = 1 - (comTot / 100) - (tax / 100) - (imp / 100) - (mar / 100);
  if (denom <= 0) {
    precoSugeridoErro = `Comissão (${comTot}%) + taxa (${tax}%) + imposto (${imp}%) + margem (${mar}%) ≥ 100%. Impossível calcular preço.`;
  } else {
    precoSugerido = (ficha + custoFixoRateado + outros) / denom;
  }

  return {
    custoFixoRateado: Number(custoFixoRateado.toFixed(2)),
    outrosCustos: Number(outros.toFixed(2)),
    comissaoValor: Number(comissaoValor.toFixed(2)),
    comissaoBarbeiroValor: Number(comissaoBarbeiroValor.toFixed(2)),
    comissaoAssistenteValor: Number(comissaoAssistenteValor.toFixed(2)),
    taxaCartaoValor: Number(taxaCartaoValor.toFixed(2)),
    impostoValor: Number(impostoValor.toFixed(2)),
    custoTotal: Number(custoTotal.toFixed(2)),
    margemRealValor: Number(margemRealValor.toFixed(2)),
    margemRealPct: Number(margemRealPct.toFixed(2)),
    precoSugerido: precoSugerido !== null ? Number(precoSugerido.toFixed(2)) : null,
    ...(precoSugeridoErro ? { precoSugeridoErro } : {}),
  };
}
