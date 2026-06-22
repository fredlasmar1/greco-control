/**
 * Contas mensais — despesas recorrentes que vencem no mesmo dia todo mês.
 * Persistido em kv_store (Postgres Railway). Sobrevive a deploys.
 *
 * Usado pela mensagem matinal do Telegram (08h ter-sáb): se hoje é dia de
 * vencimento de alguma conta (ou se cai em fim de semana/feriado e hoje é
 * o último dia útil antes), avisa.
 */
import { kvGet, kvSet } from "./db";

export interface ContaMensal {
  id: string;          // gerado: "conta_<timestamp>_<rand>"
  nome: string;        // "Aluguel", "Cartão Itaú"
  diaVencimento: number; // 1-31
  valor: number | null;  // null = varia/não cadastrado
  observacao?: string;   // texto livre opcional
  ativa: boolean;        // permite "pausar" sem deletar
  criadoEm: string;      // ISO
  atualizadoEm: string;  // ISO
}

const KV_KEY = "contas_mensais:lista";

// ─── CRUD básico ────────────────────────────────────────────────────────────

export async function listarContas(): Promise<ContaMensal[]> {
  const data = await kvGet<ContaMensal[]>(KV_KEY);
  return Array.isArray(data) ? data : [];
}

export async function criarConta(input: {
  nome: string;
  diaVencimento: number;
  valor?: number | null;
  observacao?: string;
}): Promise<ContaMensal> {
  const contas = await listarContas();
  const agora = new Date().toISOString();
  const nova: ContaMensal = {
    id: `conta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    nome: input.nome.trim(),
    diaVencimento: Math.max(1, Math.min(31, Math.round(input.diaVencimento))),
    valor: input.valor ?? null,
    observacao: input.observacao?.trim() || undefined,
    ativa: true,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  contas.push(nova);
  await kvSet(KV_KEY, contas);
  return nova;
}

export async function atualizarConta(id: string, patch: Partial<Omit<ContaMensal, "id" | "criadoEm">>): Promise<ContaMensal | null> {
  const contas = await listarContas();
  const idx = contas.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const atual = contas[idx];
  const atualizada: ContaMensal = {
    ...atual,
    ...patch,
    id: atual.id,
    criadoEm: atual.criadoEm,
    atualizadoEm: new Date().toISOString(),
    // Sanitiza diaVencimento se vier
    diaVencimento: patch.diaVencimento
      ? Math.max(1, Math.min(31, Math.round(patch.diaVencimento)))
      : atual.diaVencimento,
  };
  contas[idx] = atualizada;
  await kvSet(KV_KEY, contas);
  return atualizada;
}

export async function deletarConta(id: string): Promise<boolean> {
  const contas = await listarContas();
  const filtradas = contas.filter((c) => c.id !== id);
  if (filtradas.length === contas.length) return false;
  await kvSet(KV_KEY, filtradas);
  return true;
}

// ─── Bootstrap inicial: cadastra as 6 contas iniciais se ainda não existem ───

export async function bootstrapContasIniciais(): Promise<void> {
  const existentes = await listarContas();
  if (existentes.length > 0) return; // já tem coisa cadastrada, não sobrescreve

  const iniciais: Array<{ nome: string; diaVencimento: number }> = [
    { nome: "Aluguel", diaVencimento: 5 },
    { nome: "Cartão Itaú", diaVencimento: 5 },
    { nome: "Conta de luz", diaVencimento: 7 },
    { nome: "Cartão Santander", diaVencimento: 10 },
    { nome: "Imposto", diaVencimento: 20 },
    { nome: "Marketing", diaVencimento: 20 },
  ];
  for (const c of iniciais) {
    await criarConta(c);
  }
}

// ─── Lógica de "vence hoje?" considerando fim de semana e feriado nacional ──

/** Feriados nacionais BR (data fixa) — ano corrente e próximo. Suficiente. */
function feriadosNacionais(ano: number): Set<string> {
  const set = new Set<string>();
  const fixos = [
    `${ano}-01-01`, // Confraternização
    `${ano}-04-21`, // Tiradentes
    `${ano}-05-01`, // Trabalho
    `${ano}-09-07`, // Independência
    `${ano}-10-12`, // N. Sra. Aparecida
    `${ano}-11-02`, // Finados
    `${ano}-11-15`, // Proclamação da República
    `${ano}-11-20`, // Consciência Negra
    `${ano}-12-25`, // Natal
  ];
  for (const f of fixos) set.add(f);
  return set;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function ehDiaUtil(d: Date, feriados: Set<string>): boolean {
  const dow = d.getDay(); // 0=dom, 6=sáb
  if (dow === 0 || dow === 6) return false;
  if (feriados.has(ymd(d))) return false;
  return true;
}

/**
 * Para um vencimento `diaVencimento` no mês/ano de `hoje`,
 * retorna a data efetiva de aviso (último dia útil ≤ vencimento original).
 *
 * Ex: vencimento dia 7, mas dia 7 é sábado → antecipa pra sexta (dia 6).
 *     Se dia 6 também for feriado, antecipa pra dia 5.
 */
function dataAvisoEfetiva(diaVencimento: number, hoje: Date): Date {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  // Clampa o dia ao último dia do mês (ex: dia 31 em fev vira 28/29)
  const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate();
  const diaReal = Math.min(diaVencimento, ultimoDiaDoMes);

  const feriados = new Set<string>([
    ...feriadosNacionais(ano),
    ...feriadosNacionais(ano + 1),
  ]);

  let d = new Date(ano, mes, diaReal);
  // Anda pra trás até cair num dia útil
  while (!ehDiaUtil(d, feriados)) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * Lista as contas que devem aparecer no aviso de HOJE.
 * Considera: vencimento original OU data antecipada por fim de semana/feriado.
 */
export async function contasParaAvisarHoje(hoje: Date = new Date()): Promise<ContaMensal[]> {
  const contas = await listarContas();
  const ativas = contas.filter((c) => c.ativa);
  const hojeStr = ymd(hoje);

  return ativas.filter((c) => {
    const dataAviso = dataAvisoEfetiva(c.diaVencimento, hoje);
    return ymd(dataAviso) === hojeStr;
  });
}

// ─── Pagamentos da equipe (dia 1 e dia 15) ──────────────────────────────────

export interface PagamentoEquipe {
  tipo: "comissao-mensal" | "vale";
  diaCadenciado: 1 | 15;
  descricao: string;
}

export function pagamentosEquipeParaAvisarHoje(hoje: Date = new Date()): PagamentoEquipe[] {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const feriados = new Set<string>([
    ...feriadosNacionais(ano),
    ...feriadosNacionais(ano + 1),
  ]);
  const hojeStr = ymd(hoje);

  const resultados: PagamentoEquipe[] = [];

  // Dia 1: comissão mensal
  let d1 = new Date(ano, mes, 1);
  while (!ehDiaUtil(d1, feriados)) d1.setDate(d1.getDate() + 1); // dia 1: posterga PRA FRENTE (não antecipa)
  // ↑ regra de pagamento de salário: se dia 1 cai em fim de semana, paga no 1º dia útil ÚTIL seguinte.
  // (Inverso das contas a pagar, que se beneficiam de antecipar.)
  if (ymd(d1) === hojeStr) {
    resultados.push({
      tipo: "comissao-mensal",
      diaCadenciado: 1,
      descricao: "Fechamento mensal — comissão dos barbeiros",
    });
  }

  // Dia 15: vale
  let d15 = new Date(ano, mes, 15);
  while (!ehDiaUtil(d15, feriados)) d15.setDate(d15.getDate() + 1);
  if (ymd(d15) === hojeStr) {
    resultados.push({
      tipo: "vale",
      diaCadenciado: 15,
      descricao: "Vale (adiantamento) dos barbeiros",
    });
  }

  return resultados;
}
