/**
 * Helpers de mês (formato YYYY-MM) com timezone America/Sao_Paulo.
 * Compartilhados entre Dashboard, Fechamento e demais páginas com seletor de mês.
 */

/** Retorna o mês atual em SP no formato "YYYY-MM". */
export function mesAtualSP(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  });
  return fmt.format(new Date()).slice(0, 7);
}

/** Mês deslocado por N posições (delta negativo = anterior, positivo = próximo). */
export function mesAdjacente(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Label amigável em PT-BR (ex: "2026-04" → "Abril de 2026"). */
export function labelMesPtBR(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const txt = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
