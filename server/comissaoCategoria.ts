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
