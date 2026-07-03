/**
 * Compras da barbearia — comprovantes de PIX e notas enviados no grupo do
 * Telegram, lidos por IA (Claude vision) e registrados por mês. Persistido em
 * kv_store (Postgres Railway) → sobrevive a deploys. Não gasta token da Trinks.
 *
 * Fluxo: foto no grupo → webhook → Claude extrai {valor,data,loja,categoria} →
 * salvarCompra → bot confirma no grupo → aparece na aba "Compras do Mês".
 */
import { kvGet, kvSet } from "./db";

// Categorias de compra — os principais gastos de uma barbearia. A IA escolhe uma.
export const CATEGORIAS_COMPRA = [
  "Salários & Equipe",       // PIX/pagamento a barbeiros, assistentes, secretárias
  "Produtos & Insumos",      // cosméticos, pomada, shampoo, tinta, navalha, lâmina
  "Bebidas & Bomboniere",    // cerveja, refri, energético, água, doces (revenda)
  "Limpeza & Higiene",       // produtos de limpeza, papel, descartáveis
  "Manutenção & Reparos",    // conserto, obra, elétrica, hidráulica, pintura
  "Equipamentos & Móveis",   // máquina, cadeira, secador, espelho, móveis
  "Aluguel",                 // aluguel do ponto
  "Contas & Utilidades",     // água, luz, energia, internet, telefone
  "Impostos & Contador",     // impostos, taxas, DAS/Simples, honorário contábil
  "Software & Sistemas",     // Trinks, sistemas, apps, assinaturas de software
  "Marketing & Publicidade", // anúncio, tráfego, gráfica, panfleto, brinde
  "Alimentação",             // comida/lanche da equipe
  "Outros",
] as const;

export interface Compra {
  id: string;
  mes: string;          // YYYY-MM (bucket)
  data: string;         // YYYY-MM-DD (data do comprovante)
  valor: number;        // positivo, em reais
  loja: string;         // beneficiário / estabelecimento
  categoria: string;
  descricao?: string;
  tipo: "pix" | "compra" | "boleto" | "outro";
  origem: "telegram" | "manual";
  telegramFileId?: string;
  telegramFrom?: string; // quem mandou no grupo
  confianca?: "alta" | "media" | "baixa";
  criadoEm: string;
  atualizadoEm: string;
}

const kvKey = (mes: string) => `compras:${mes}`;

export async function listarCompras(mes: string): Promise<Compra[]> {
  const d = await kvGet<Compra[]>(kvKey(mes));
  const arr = Array.isArray(d) ? d : [];
  return arr.slice().sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
}

export async function salvarCompra(
  input: Omit<Compra, "id" | "criadoEm" | "atualizadoEm"> & { id?: string },
): Promise<Compra> {
  const lista = await listarCompras(input.mes);
  const agora = new Date().toISOString();
  const nova: Compra = {
    ...input,
    id: input.id || `compra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    criadoEm: agora,
    atualizadoEm: agora,
  } as Compra;
  lista.push(nova);
  await kvSet(kvKey(input.mes), lista);
  return nova;
}

export async function atualizarCompra(mes: string, id: string, patch: Partial<Compra>): Promise<Compra | null> {
  const lista = await listarCompras(mes);
  const i = lista.findIndex(c => c.id === id);
  if (i < 0) return null;
  lista[i] = { ...lista[i], ...patch, id, mes, atualizadoEm: new Date().toISOString() };
  await kvSet(kvKey(mes), lista);
  return lista[i];
}

export async function removerCompra(mes: string, id: string): Promise<boolean> {
  const lista = await listarCompras(mes);
  const nova = lista.filter(c => c.id !== id);
  if (nova.length === lista.length) return false;
  await kvSet(kvKey(mes), nova);
  return true;
}

export function resumoCompras(compras: Compra[]) {
  const total = compras.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const porCategoria: Record<string, { total: number; count: number }> = {};
  for (const c of compras) {
    const k = c.categoria || "Outros";
    if (!porCategoria[k]) porCategoria[k] = { total: 0, count: 0 };
    porCategoria[k].total += Number(c.valor) || 0;
    porCategoria[k].count += 1;
  }
  const categorias = Object.entries(porCategoria)
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.total - a.total);
  return { total, count: compras.length, categorias };
}

/** Normaliza a categoria vinda da IA pra uma das oficiais (fallback Outros). */
export function normalizarCategoria(cat: string | undefined | null): string {
  if (!cat) return "Outros";
  const n = String(cat).toLowerCase();
  const match = CATEGORIAS_COMPRA.find(c => c.toLowerCase() === n);
  if (match) return match;
  // heurística leve por palavra-chave (fallback quando a IA devolve algo fora da lista)
  if (/salári|salario|comiss|vale|equipe|barbeiro|assistente|funcion|secretár|secretar/.test(n)) return "Salários & Equipe";
  if (/limp|higien|papel|detergen|desinfe|descartáv|descartav/.test(n)) return "Limpeza & Higiene";
  if (/manut|conserto|reparo|obra|elétric|eletric|hidrául|hidraul|pintura|encanad/.test(n)) return "Manutenção & Reparos";
  if (/equip|máquina|maquina|cadeira|secador|espelho|móvel|movel|mobíli|mobili/.test(n)) return "Equipamentos & Móveis";
  if (/aluguel|locaç|locac/.test(n)) return "Aluguel";
  if (/conta|luz|energia|água|agua|internet|telefone|celular|utilidad/.test(n)) return "Contas & Utilidades";
  if (/imposto|taxa|contador|contábil|contabil|\bdas\b|simples/.test(n)) return "Impostos & Contador";
  if (/software|sistema|assinatura|trinks|\bapp\b|licenç|licenc/.test(n)) return "Software & Sistemas";
  if (/market|anúncio|anuncio|impuls|tráfego|trafego|publicid|gráfic|grafic|panfleto|brinde/.test(n)) return "Marketing & Publicidade";
  if (/comida|lanche|aliment|refei|restaurante|ifood|padaria/.test(n)) return "Alimentação";
  if (/bebida|cerveja|refri|energétic|energetic|doce|choc|bombon/.test(n)) return "Bebidas & Bomboniere";
  if (/produto|insumo|cosmétic|cosmetic|pomada|shampoo|condicion|óleo|oleo|tinta|navalha|lâmina|lamina|pente/.test(n)) return "Produtos & Insumos";
  return "Outros";
}
