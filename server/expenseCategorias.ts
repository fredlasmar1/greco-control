// Categorias editáveis de despesas + regras de auto-classificação.
// Substitui (com retrocompat) os enums hard-coded `CategoriaGasto` e
// `FinanceEntry.category` quando o usuário começa a usar este sistema.
import { kvGet, kvSet } from "./db";
import { log } from "./index";

// Tipos contábeis — fixos (a app define) — usados pra agregar no DRE e ratear na Precificação.
export type ExpenseTipo =
  // ── ENTRADAS ──
  | 'faturamento'   // venda (serviço/produto/Clube) — entra como receita do mês
  // ── SAÍDAS ──
  | 'fixo'          // aluguel, internet, software (não varia com volume)
  | 'variavel'      // produtos, embalagem (varia com volume)
  | 'recorrente'    // assinaturas mensais (subset de fixo, mas exibido separado)
  | 'cartao'        // taxa de máquina + parcelamento de cartão da empresa
  | 'comissao'      // comissão de barbeiros (saída ligada à receita)
  | 'bonus'         // bônus de meta
  | 'imposto'       // simples/iss/inss (% sobre faturamento)
  | 'insumo'        // ficha técnica de serviço (matéria-prima direta)
  | 'investimento'  // capex (não entra no resultado operacional)
  // ── NEUTRO (aparece e fica justificado, mas NÃO conta no resultado) ──
  | 'neutro'        // reposição/retirada de caixa, transferência própria, estorno, aporte/empréstimo
  | 'outros';

// Tipos que são ENTRADA (faturamento). O resto (menos 'neutro') é saída.
export const TIPOS_ENTRADA: ExpenseTipo[] = ['faturamento'];
export const TIPOS_NEUTROS: ExpenseTipo[] = ['neutro'];
export function tipoConta(tipo: ExpenseTipo): 'entrada' | 'saida' | 'neutro' {
  if (TIPOS_ENTRADA.includes(tipo)) return 'entrada';
  if (TIPOS_NEUTROS.includes(tipo)) return 'neutro';
  return 'saida';
}

export interface ExpenseCategoria {
  id: string;
  nome: string;
  tipo: ExpenseTipo;
  cor: string;        // hex #RRGGBB
  ativa: boolean;
  ordem: number;      // pra exibir em ordem fixa (menor primeiro)
  criadoEm: string;
}

export interface ExpenseRegra {
  id: string;
  // Padrão simples: substring case-insensitive em description (espaços normalizados).
  // Ex.: "ifood" cobre "IFOOD MARKETPLACE", "ifood pago" etc.
  pattern: string;
  categoriaId: string;
  // Subcategoria opcional pra granularidade (ex: tipo=fixo, subcategoria='aluguel').
  subcategoria?: string;
  ativa: boolean;
  criadaEm: string;
  // Estatística pra UI: quantas vezes essa regra já casou.
  vezesAplicada?: number;
}

const KV_CATS = "expense_categorias";
const KV_REGRAS = "expense_regras";

// Seed default — usado quando o KV está vazio. Cobre as categorias
// que já existem hoje no sistema sem causar surpresa pro usuário.
const SEED_CATS: Omit<ExpenseCategoria, "id" | "criadoEm">[] = [
  { nome: "Aluguel",            tipo: "fixo",         cor: "#ef4444", ativa: true, ordem: 10 },
  { nome: "Água & Luz",         tipo: "fixo",         cor: "#f59e0b", ativa: true, ordem: 11 },
  { nome: "Internet & Telefone",tipo: "fixo",         cor: "#0ea5e9", ativa: true, ordem: 12 },
  { nome: "Software & Sistemas",tipo: "recorrente",   cor: "#8b5cf6", ativa: true, ordem: 20 },
  { nome: "Streaming & Mídia",  tipo: "recorrente",   cor: "#a855f7", ativa: true, ordem: 21 },
  { nome: "Produtos & Insumos", tipo: "variavel",     cor: "#10b981", ativa: true, ordem: 30 },
  { nome: "Limpeza & Consumo",  tipo: "variavel",     cor: "#14b8a6", ativa: true, ordem: 31 },
  { nome: "Marketing",          tipo: "variavel",     cor: "#ec4899", ativa: true, ordem: 32 },
  { nome: "Taxa de Cartão",     tipo: "cartao",       cor: "#f43f5e", ativa: true, ordem: 40 },
  { nome: "Cartão da Empresa",  tipo: "cartao",       cor: "#dc2626", ativa: true, ordem: 41 },
  { nome: "Comissões",          tipo: "comissao",     cor: "#06b6d4", ativa: true, ordem: 50 },
  { nome: "Bônus",              tipo: "bonus",        cor: "#22d3ee", ativa: true, ordem: 51 },
  { nome: "Impostos",           tipo: "imposto",      cor: "#eab308", ativa: true, ordem: 60 },
  { nome: "Funcionários",       tipo: "fixo",         cor: "#84cc16", ativa: true, ordem: 13 },
  { nome: "Investimento (CapEx)",tipo:"investimento", cor: "#6366f1", ativa: true, ordem: 70 },
  // ── ENTRADAS (faturamento) ──
  { nome: "Faturamento Serviço", tipo: "faturamento", cor: "#10b981", ativa: true, ordem: 1 },
  { nome: "Faturamento Produto", tipo: "faturamento", cor: "#22c55e", ativa: true, ordem: 2 },
  { nome: "Faturamento Clube",   tipo: "faturamento", cor: "#0ea5e9", ativa: true, ordem: 3 },
  { nome: "Outras entradas",     tipo: "faturamento", cor: "#34d399", ativa: true, ordem: 4 },
  // ── NEUTROS (não contam no resultado) ──
  { nome: "Reposição de caixa",  tipo: "neutro", cor: "#94a3b8", ativa: true, ordem: 80 },
  { nome: "Retirada de caixa",   tipo: "neutro", cor: "#94a3b8", ativa: true, ordem: 81 },
  { nome: "Transferência própria",tipo:"neutro", cor: "#94a3b8", ativa: true, ordem: 82 },
  { nome: "Estorno",             tipo: "neutro", cor: "#94a3b8", ativa: true, ordem: 83 },
  { nome: "Aporte / Empréstimo", tipo: "neutro", cor: "#94a3b8", ativa: true, ordem: 84 },
  { nome: "Transferência interna",tipo:"outros",       cor: "#94a3b8", ativa: true, ordem: 90 },
  { nome: "Outros",             tipo: "outros",       cor: "#64748b", ativa: true, ordem: 99 },
];

// Regras seed — palavras-chave comuns em extrato Itaú/Santander que casam com categorias do seed.
// O segundo elemento é o NOME da categoria (resolveremos pra id no momento do seed).
const SEED_REGRAS: { pattern: string; categoriaNome: string; subcategoria?: string }[] = [
  { pattern: "aluguel",         categoriaNome: "Aluguel" },
  { pattern: "enel",            categoriaNome: "Água & Luz",         subcategoria: "Luz" },
  { pattern: "cemig",           categoriaNome: "Água & Luz",         subcategoria: "Luz" },
  { pattern: "light",           categoriaNome: "Água & Luz",         subcategoria: "Luz" },
  { pattern: "sabesp",          categoriaNome: "Água & Luz",         subcategoria: "Água" },
  { pattern: "cedae",           categoriaNome: "Água & Luz",         subcategoria: "Água" },
  { pattern: "copasa",          categoriaNome: "Água & Luz",         subcategoria: "Água" },
  { pattern: "vivo",            categoriaNome: "Internet & Telefone" },
  { pattern: "claro",           categoriaNome: "Internet & Telefone" },
  { pattern: "tim",             categoriaNome: "Internet & Telefone" },
  { pattern: "oi fixo",         categoriaNome: "Internet & Telefone" },
  { pattern: "netflix",         categoriaNome: "Streaming & Mídia" },
  { pattern: "spotify",         categoriaNome: "Streaming & Mídia" },
  { pattern: "youtube",         categoriaNome: "Streaming & Mídia" },
  { pattern: "trinks",          categoriaNome: "Software & Sistemas" },
  { pattern: "anthropic",       categoriaNome: "Software & Sistemas" },
  { pattern: "openai",          categoriaNome: "Software & Sistemas" },
  { pattern: "railway",         categoriaNome: "Software & Sistemas" },
  { pattern: "github",          categoriaNome: "Software & Sistemas" },
  { pattern: "google",          categoriaNome: "Software & Sistemas" },
  { pattern: "ifood",           categoriaNome: "Limpeza & Consumo" },
  { pattern: "uber",            categoriaNome: "Outros",             subcategoria: "Transporte" },
  { pattern: "99 ",             categoriaNome: "Outros",             subcategoria: "Transporte" },
  { pattern: "instagram",       categoriaNome: "Marketing" },
  { pattern: "meta ads",        categoriaNome: "Marketing" },
  { pattern: "facebook",        categoriaNome: "Marketing" },
  { pattern: "tarifa",          categoriaNome: "Outros",             subcategoria: "Tarifa bancária" },
  { pattern: "iof",             categoriaNome: "Impostos",           subcategoria: "IOF" },
  { pattern: "darf",            categoriaNome: "Impostos",           subcategoria: "DARF" },
  { pattern: "das simples",     categoriaNome: "Impostos",           subcategoria: "Simples Nacional" },
  { pattern: "inss",            categoriaNome: "Impostos",           subcategoria: "INSS" },
  { pattern: "iss",             categoriaNome: "Impostos",           subcategoria: "ISS" },
  { pattern: "fgts",            categoriaNome: "Impostos",           subcategoria: "FGTS" },
];

let _cache: { cats: ExpenseCategoria[]; regras: ExpenseRegra[] } | null = null;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureSeed(): Promise<{ cats: ExpenseCategoria[]; regras: ExpenseRegra[] }> {
  let cats = (await kvGet<ExpenseCategoria[]>(KV_CATS)) || [];
  let regras = (await kvGet<ExpenseRegra[]>(KV_REGRAS)) || [];

  if (cats.length === 0) {
    const now = new Date().toISOString();
    cats = SEED_CATS.map(c => ({ ...c, id: rid("cat"), criadoEm: now }));
    await kvSet(KV_CATS, cats);
    log(`expense_categorias seed: ${cats.length} categorias criadas`, "expense");
  } else {
    // Merge idempotente: adiciona categorias do seed que ainda não existem (por nome).
    // Garante que instalações antigas (prod) ganhem as novas de entrada/neutro.
    const nomes = new Set(cats.map(c => c.nome.toLowerCase()));
    const faltantes = SEED_CATS.filter(c => !nomes.has(c.nome.toLowerCase()));
    if (faltantes.length > 0) {
      const now = new Date().toISOString();
      cats = [...cats, ...faltantes.map(c => ({ ...c, id: rid("cat"), criadoEm: now }))];
      await kvSet(KV_CATS, cats);
      log(`expense_categorias merge: +${faltantes.length} categorias novas (entrada/neutro)`, "expense");
    }
  }

  if (regras.length === 0) {
    const now = new Date().toISOString();
    const byNome = new Map(cats.map(c => [c.nome.toLowerCase(), c.id]));
    regras = SEED_REGRAS
      .map(r => {
        const id = byNome.get(r.categoriaNome.toLowerCase());
        if (!id) return null;
        return {
          id: rid("rgr"),
          pattern: r.pattern,
          categoriaId: id,
          subcategoria: r.subcategoria,
          ativa: true,
          criadaEm: now,
          vezesAplicada: 0,
        } as ExpenseRegra;
      })
      .filter((x): x is ExpenseRegra => x !== null);
    await kvSet(KV_REGRAS, regras);
    log(`expense_regras seed: ${regras.length} regras criadas`, "expense");
  }

  _cache = { cats, regras };
  return _cache;
}

export async function listCategorias(): Promise<ExpenseCategoria[]> {
  const { cats } = await ensureSeed();
  return [..._cache!.cats].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

export async function listRegras(): Promise<ExpenseRegra[]> {
  await ensureSeed();
  return [..._cache!.regras];
}

export async function upsertCategoria(input: Partial<ExpenseCategoria> & { nome: string; tipo: ExpenseTipo }): Promise<ExpenseCategoria> {
  await ensureSeed();
  const cats = [..._cache!.cats];
  if (input.id) {
    const i = cats.findIndex(c => c.id === input.id);
    if (i >= 0) {
      cats[i] = { ...cats[i], ...input } as ExpenseCategoria;
      _cache!.cats = cats;
      await kvSet(KV_CATS, cats);
      return cats[i];
    }
  }
  const novo: ExpenseCategoria = {
    id: rid("cat"),
    nome: input.nome,
    tipo: input.tipo,
    cor: input.cor || "#64748b",
    ativa: input.ativa !== false,
    ordem: input.ordem ?? 50,
    criadoEm: new Date().toISOString(),
  };
  cats.push(novo);
  _cache!.cats = cats;
  await kvSet(KV_CATS, cats);
  return novo;
}

export async function deleteCategoria(id: string): Promise<{ ok: boolean; usadaEm?: number }> {
  await ensureSeed();
  // Bloqueia delete se a categoria está em uso por alguma regra (proteção mínima).
  const usadaEmRegras = _cache!.regras.filter(r => r.categoriaId === id).length;
  if (usadaEmRegras > 0) return { ok: false, usadaEm: usadaEmRegras };
  _cache!.cats = _cache!.cats.filter(c => c.id !== id);
  await kvSet(KV_CATS, _cache!.cats);
  return { ok: true };
}

export async function upsertRegra(input: Partial<ExpenseRegra> & { pattern: string; categoriaId: string }): Promise<ExpenseRegra> {
  await ensureSeed();
  const regras = [..._cache!.regras];
  if (input.id) {
    const i = regras.findIndex(r => r.id === input.id);
    if (i >= 0) {
      regras[i] = { ...regras[i], ...input } as ExpenseRegra;
      _cache!.regras = regras;
      await kvSet(KV_REGRAS, regras);
      return regras[i];
    }
  }
  const novo: ExpenseRegra = {
    id: rid("rgr"),
    pattern: input.pattern.toLowerCase().trim(),
    categoriaId: input.categoriaId,
    subcategoria: input.subcategoria,
    ativa: input.ativa !== false,
    criadaEm: new Date().toISOString(),
    vezesAplicada: 0,
  };
  regras.push(novo);
  _cache!.regras = regras;
  await kvSet(KV_REGRAS, regras);
  return novo;
}

export async function deleteRegra(id: string): Promise<void> {
  await ensureSeed();
  _cache!.regras = _cache!.regras.filter(r => r.id !== id);
  await kvSet(KV_REGRAS, _cache!.regras);
}

/** Normaliza descrição pra match: lowercase, espaços colapsados. */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Aplica as regras a uma descrição. Retorna a primeira que casar (ordem do array).
 *  Não muta `vezesAplicada` aqui — caller decide quando persistir contagem. */
export function classificarDescricao(
  description: string,
  regras: ExpenseRegra[],
): { categoriaId: string; subcategoria?: string; regraId: string } | null {
  const d = norm(description);
  if (!d) return null;
  for (const r of regras) {
    if (!r.ativa) continue;
    if (d.includes(r.pattern)) {
      return { categoriaId: r.categoriaId, subcategoria: r.subcategoria, regraId: r.id };
    }
  }
  return null;
}

/** Incrementa `vezesAplicada` em batch e persiste. */
export async function bumpRegrasAplicadas(regraIdToCount: Map<string, number>): Promise<void> {
  if (regraIdToCount.size === 0) return;
  await ensureSeed();
  const regras = [..._cache!.regras];
  let mudou = false;
  for (const r of regras) {
    const inc = regraIdToCount.get(r.id);
    if (inc && inc > 0) {
      r.vezesAplicada = (r.vezesAplicada || 0) + inc;
      mudou = true;
    }
  }
  if (mudou) {
    _cache!.regras = regras;
    await kvSet(KV_REGRAS, regras);
  }
}

export function invalidateCache(): void {
  _cache = null;
}
