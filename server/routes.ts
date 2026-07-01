import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { log } from "./index";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { kvGet, kvSet, waitForDb, isDbReady } from "./db";
import { buildSnapshot, buildSystemPrompt, buildMessages, type ConselheiroDataSources } from "./conselheiro";
import * as trinksImport from "./trinksImport";
import * as XLSX from "xlsx";
import type {
  TrinksImportPayload,
  TrinksImportType,
  ImportSummary,
} from "./trinksImport";
import { registrarSyncTrinks, getSyncMeta } from "./trinksSyncMeta";
import { resolverFonte, carregarTrinksDataDoCsv, getModoFonte, temCsvDoMes } from "./fonteResolver";
import { getMesData as getMesDataCanonical, invalidarMesCache as invalidarMesCacheCanonical } from "./mesService";
import {
  listarContas as listarContasMensais,
  criarConta as criarContaMensal,
  atualizarConta as atualizarContaMensal,
  deletarConta as deletarContaMensal,
  bootstrapContasIniciais,
  contasParaAvisarHoje,
  pagamentosEquipeParaAvisarHoje,
} from "./contasMensais";
import type { PagamentoHojeItem } from "./telegram";
import { registrarEventoTrinks, comOrigem, resumoUltimosDias, lerUltimosDias } from "./trinksAuditLog";
import { getTrinksCota, setFatiaBase, comprarTokens } from "./trinksQuota";
import * as cron from "node-cron";
import {
  enviarMensagem,
  isTelegramConfigured,
  getChatId,
  montarResumoManha,
  montarResumoNoite,
  montarAlertasEstoque,
  type ResumoDiaData,
  type ResumoAmanhaData,
} from "./telegram";
import {
  getAllMetas,
  getMeta,
  upsertMeta,
  deleteMeta,
  type MetaProfissional,
} from "./metasProfissional";
import {
  parseCsvAgendamentos,
  salvarImportAgendamentos,
  getUltimoImportAgendamentos,
  getAgendamentosCsvFreshOrNull,
  resetImportAgendamentos,
  type AgendamentoCsv,
} from "./trinksAgendamentosCsv";
import {
  getSnapshot, saveSnapshot, listSnapshotsDoMes, snapshotVazio, classificarFormaPagamento,
  type SnapshotDia, type FonteSnapshot,
} from "./snapshotDiario";
import { sincronizarEmailsTrinks } from "./trinksEmail";
import {
  listFechamentos as listCaixaFechamentos,
  getFechamento as getCaixaFechamento,
  upsertFechamento as upsertCaixaFechamento,
  deleteFechamento as deleteCaixaFechamento,
  getFechamentoAnterior as getCaixaFechamentoAnterior,
} from "./caixaDiario";
import {
  listCategorias as listExpenseCategorias,
  listRegras as listExpenseRegras,
  upsertCategoria as upsertExpenseCategoria,
  deleteCategoria as deleteExpenseCategoria,
  upsertRegra as upsertExpenseRegra,
  deleteRegra as deleteExpenseRegra,
  classificarDescricao,
  bumpRegrasAplicadas,
  tipoConta,
  type ExpenseCategoria,
  type ExpenseRegra,
  type ExpenseTipo,
} from "./expenseCategorias";
import {
  getConfig as getConfigFin,
  setConfig as setConfigFin,
  fracaoCartao,
  calcularCustoFixoPorMinuto,
} from "./configFinanceira";
import {
  getComissaoPctDoServico,
  setComissaoConfig,
  getCategoriaServico,
  getMargemDesejadaDefault,
  calcularMargemServico,
  comissaoServicosRanking,
  categoriaPorApelidoRanking,
} from "./comissaoCategoria";
import {
  getOverrides,
  setOverride,
  deleteOverride,
  lookupOverride,
} from "./overridesItens";
import {
  getProdutosSemComissao,
  setProdutosSemComissao,
  sugerirSemComissao,
} from "./produtosSemComissao";
import {
  getProdutosCustos,
  setProdutoCusto,
  setProdutosCustosBulk,
  setProdutoMinimo,
  getCustoOf,
  getMinimoOf,
} from "./produtosCustos";
import {
  getMovimentacoesEstoque,
  addMovimentacao,
  deleteMovimentacao,
  getDeltasPorProduto,
  getMovimentacoesDe,
  type MovimentacaoEstoque,
  type TipoMovimentacao,
} from "./movimentacoesEstoque";
import {
  getPagamentoMes,
  getPagamentosDoMes,
  upsertPagamentoMes,
  fecharMes as fecharPagMes,
  reabrirMes as reabrirPagMes,
} from "./pagamentos";
import {
  montarResumoDiarioIndividual,
  montarResumoMatinalIndividual,
  montarResumoSemanalIndividual,
  montarResumoMensalIndividual,
  enviarParaProfissional,
  listarMetasAtivas,
  type PayloadIndividual,
} from "./telegramIndividual";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Financeiro Data ──────────────────────────────────────
interface FinanceEntry {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // positive = income, negative = expense
  category: 'fixo' | 'variavel' | 'parcelamento' | 'receita' | 'investimento';
  subcategory: string;
  recurrent: boolean;
  notes?: string;
  createdAt: string;
  // v27: categorização nova (substitui category/subcategory quando preenchida)
  categoriaId?: string;
  subcategoriaNova?: string;
  // v52: override manual fixa/variável (vence a categoria no cálculo do totalFixas).
  tipoDespesa?: 'fixa' | 'variavel';
}

// Diretório de dados persistente. No Railway, configurar um Volume montado em /data.
// Se DATA_DIR não existir, usa o cwd (ephemeral — dados se perdem em cada deploy).
const DATA_DIR = (() => {
  const candidate = process.env.DATA_DIR || "/data";
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      // Testa se é gravável
      const testFile = path.join(candidate, ".write-test");
      fs.writeFileSync(testFile, "ok");
      fs.unlinkSync(testFile);
      log(`Persistência: usando ${candidate}`, "data");
      return candidate;
    }
  } catch { /* não gravável, usa cwd */ }
  log(`⚠️ Persistência: usando cwd (dados se perdem em cada deploy). Configure Volume no Railway em /data`, "data");
  return process.cwd();
})();

const FINANCEIRO_FILE = path.join(DATA_DIR, ".financeiro-data.json");
const DUPLICADOS_RESOLVIDOS_FILE = path.join(DATA_DIR, ".duplicados-resolvidos.json");
const METAS_FILE = path.join(DATA_DIR, ".metas-data.json");
const METAS_BARBEIROS_FILE = path.join(DATA_DIR, ".metas-barbeiros.json");
const META_DIARIA_FILE = path.join(DATA_DIR, ".meta-diaria.json");
const CHECKLIST_FILE = path.join(DATA_DIR, ".checklist-data.json");
const CONSOLIDACAO_CONTAS_FILE = path.join(DATA_DIR, ".consolidacao-contas.json");
const CONSOLIDACAO_TRANSACOES_FILE = path.join(DATA_DIR, ".consolidacao-transacoes.json");
const USUARIOS_FILE = path.join(DATA_DIR, ".usuarios.json");
const STORE_FILE = path.join(DATA_DIR, ".store-data.json");
const ASSINATURAS_FILE = path.join(DATA_DIR, ".assinaturas-clientes.json");
const ASSINATURAS_PLANOS_FILE = path.join(DATA_DIR, ".assinaturas-planos.json");

// ─── Persistência híbrida: DB (Postgres) + arquivo JSON (fallback) ───
// Todos os loads tentam DB primeiro; se falhar, lê do arquivo.
// Todos os saves gravam no DB E no arquivo (redundância).
async function loadData<T>(dbKey: string, file: string, defaultValue: T): Promise<T> {
  try {
    if (isDbReady()) {
      const fromDb = await kvGet<T>(dbKey);
      if (fromDb !== null) return fromDb;
    }
  } catch {}
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
    }
  } catch {}
  return defaultValue;
}

function persistData(dbKey: string, file: string, data: any) {
  // Grava no DB (async, fire-and-forget)
  kvSet(dbKey, data).catch(() => {});
  // Grava no arquivo (sync, backup local)
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}
let financeEntries: FinanceEntry[] = [];
let resolvedDuplicateIds: number[] = [];

// ─── Metas Data ──────────────────────────────────────────
interface MetaHistorico {
  month: string; // YYYY-MM
  target: number;
  achieved: number;
}
let metasHistorico: MetaHistorico[] = [];

// ─── Metas por Barbeiro ──────────────────────────────────
// { "YYYY-MM": { "barberId": metaValue } }
let metasBarbeiros: Record<string, Record<string, number>> = {};

// ─── Meta Diária (manual) ────────────────────────────────
// Valor único salvo no disco/DB — default R$ 5.000/dia
let metaDiaria: number = 5000;

// ─── Consolidação: Contas e Transações ───────────────────
type MeioRecebimento = 'pix' | 'debito' | 'credito' | 'dinheiro';
interface ContaConsolidacao {
  id: string;
  nome: string;
  tipo: 'banco' | 'maquininha' | 'caixa';
  meios: MeioRecebimento[]; // que tipos de pagamento essa conta recebe
  taxaDebito?: number; // %
  taxaCredito?: number; // %
  taxaPix?: number; // % (alguns provedores cobram)
  taxaAntecipacao?: number; // % por antecipação
  diasLiquidacaoDebito?: number; // padrão 1
  diasLiquidacaoCredito?: number; // padrão 30
  // Conta de trânsito: recebe e transfere pra outra conta (ex: InfinityPay → Itaú)
  // O valor conta como recebido mas as entradas da conta destino (que vieram daqui) são excluídas
  transito?: boolean;
  contaDestinoId?: string; // ID da conta pra onde transfere (se transito=true)
  // Conta de OBSERVAÇÃO (ex: InfinitePay): serve só pra acompanhar pagamento do
  // Clube nas Assinaturas. NÃO entra na contabilidade (caixa/DRE/conferência) nem
  // na lista da Conciliação Bancária. Só o Itaú conta pro fechamento.
  observacao?: boolean;
  ativa: boolean;
  createdAt: string;
}
type TipoTransacao = 'pix' | 'debito' | 'credito' | 'antecipacao' | 'tarifa' | 'transferencia' | 'outro';
type CategoriaGasto = 'sistema' | 'funcionario' | 'aluguel' | 'agua_luz' | 'produtos' | 'imposto' | 'transferencia_interna' | 'esporadica' | 'outros';
interface TransacaoBanco {
  id: string;
  contaId: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // positivo = entrada
  tipo?: TipoTransacao;
  categoria?: CategoriaGasto; // legado: enum hard-coded — só pra retrocompat
  importedAt: string;
  /** Quando false, a transação fica visível mas não conta no fluxo de caixa
   *  e nem no DRE. Permite ao usuário "ignorar" lançamentos sem deletá-los. */
  incluidoNoFluxo?: boolean;
  // v27: categorização nova baseada em ExpenseCategoria (id editável pelo usuário)
  categoriaId?: string;
  subcategoria?: string;
  // Quando preenchido, indica que a categoria foi atribuída por uma regra automática.
  // null/undefined = atribuição manual ou ainda sem categoria.
  regraIdAplicada?: string;
  // v28: par de transferência interna entre contas (saída de uma conta + entrada
  // espelho na outra). Ambas as transações apontam uma pra outra. Quando preenchido,
  // ambas saem do cálculo de entradas/saídas líquidas (não dupla-contam).
  transferenciaParId?: string;
  // Confiança do match automático: 1.0 = exato, < 1.0 = aproximado (data/valor com tolerância)
  transferenciaConfianca?: number;
  // v29: justificativa livre digitada pelo usuário no fechamento do mês
  // (ex: "juros de cheque especial — Itaú entrou negativo dia 06"). Persiste
  // entre meses e aparece como tooltip/badge nas próximas análises.
  justificativa?: string;
  justificadoEm?: string; // ISO timestamp
  // v52: override manual fixa/variável (vence a categoria no cálculo do totalFixas).
  tipoDespesa?: 'fixa' | 'variavel';
  // Quando preenchido, indica que esta transação foi gerada (ou vinculada
  // manualmente) a partir de uma mensalidade de assinatura. Permite desfazer
  // o pagamento e remover a entrada correspondente sem ambiguidade.
  origemAssinatura?: { clienteId: string; mes: string };
}

/** Chave de deduplicação: contaId + date + amount + descrição normalizada (sem
 *  pontuação/espaços extras, lowercase). Duas transações com mesma chave são
 *  consideradas duplicatas. */
function chaveDedupTransacao(t: TransacaoBanco): string {
  const desc = (t.description || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  return `${t.contaId}|${t.date}|${t.amount.toFixed(2)}|${desc}`;
}

/** Remove duplicatas mantendo a transação mais antiga (primeiro insert vence).
 *
 *  IMPORTANTE: aplica APENAS em saídas (amount < 0). Entradas bancárias
 *  com mesma data/valor/descrição (ex: 4 transferências de R$ 5.000 da
 *  InfinityPay em dias próximos com a mesma descrição) são frequentemente
 *  legítimas — não duplicatas. Saídas duplicadas geralmente vêm de upload
 *  duplo do mesmo extrato.
 *
 *  Retorna { removidas, restantes }. Não chama saveTransacoesBanco — caller decide.
 */
function dedupTransacoesBancoInPlace(): { removidas: number; restantes: number } {
  const vistas = new Set<string>();
  const ordenadas = [...transacoesBanco].sort((a, b) =>
    (a.importedAt || "").localeCompare(b.importedAt || "")
  );
  const filtradas: TransacaoBanco[] = [];
  for (const t of ordenadas) {
    // Entradas: nunca dedupar (preserva sempre).
    if (t.amount >= 0) { filtradas.push(t); continue; }
    const k = chaveDedupTransacao(t);
    if (vistas.has(k)) continue;
    vistas.add(k);
    filtradas.push(t);
  }
  const removidas = transacoesBanco.length - filtradas.length;
  transacoesBanco = filtradas;
  return { removidas, restantes: filtradas.length };
}

// Regras de auto-categorização: { palavra-chave (lower) → categoria }
let regrasGastos: Record<string, CategoriaGasto> = {};
const REGRAS_GASTOS_FILE = path.join(process.cwd(), ".regras-gastos.json");
let contasConsolidacao: ContaConsolidacao[] = [];
let transacoesBanco: TransacaoBanco[] = [];

// ─── Assinaturas (Greco Assinaturas) ────────────────────
interface PagamentoMensal {
  mes: string; // YYYY-MM
  pago: boolean;
  pagoEm?: string; // ISO timestamp do registro
  valor: number;
  // Como o assinante pagou esse mês — registrado na hora de marcar pago.
  // Quando preenchido, o sistema gera/vincula uma TransacaoBanco correspondente
  // pra entrada aparecer no fluxo de caixa da conta certa.
  formaPagamento?: 'dinheiro' | 'pix' | 'cartao' | 'infinitepay' | 'outro';
  contaId?: string;            // conta destino (id em contasConsolidacao)
  dataPagamento?: string;      // YYYY-MM-DD (quando o dinheiro entrou)
  transacaoBancoId?: string;   // id da transacao gerada/vinculada (link bidirecional)
}
interface AssinaturaCliente {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  plan: string; // express_corte | express_cabelo_barba | personalizada
  planValue: number;
  // Contrato
  contractDate: string; // data da assinatura do contrato (YYYY-MM-DD)
  contractDurationMonths: number; // duração em meses (ex: 3, 6, 12)
  contractEndDate: string; // data de fim do contrato (YYYY-MM-DD)
  contractUrl?: string; // link do ZapSign ou URL do arquivo
  contractFileName?: string; // nome do PDF salvo
  // Pagamento
  paymentDay: number; // dia do mês
  payments: PagamentoMensal[]; // histórico mensal
  // Status
  status: 'active' | 'cancelled' | 'expired';
  notes?: string;
  // Vendedor & comissão (20% padrão sobre cada mensalidade paga)
  seller?: string;
  commissionPct?: number;
  createdAt: string;
  updatedAt: string;
}
interface PlanoServico {
  servicoId: string;
  servicoNome: string;
  quantidade: number;
  precoUnitario: number;
}
interface PlanoAssinatura {
  id: string;
  nome: string;
  servicos: PlanoServico[]; // composição do plano
  valor: number; // preço final (pode ter desconto sobre a soma)
  ativo: boolean;
}
let assinaturaClientes: AssinaturaCliente[] = [];
let assinaturaPlanos: PlanoAssinatura[] = [];

function saveAssinaturaClientes() {
  persistData("assinaturas_clientes", ASSINATURAS_FILE, assinaturaClientes);
}
function saveAssinaturaPlanos() {
  persistData("assinaturas_planos", ASSINATURAS_PLANOS_FILE, assinaturaPlanos);
}

// Calcula status de pagamento do cliente
function getPaymentStatus(c: AssinaturaCliente): 'em_dia' | 'inadimplente' | 'cancelado' | 'expirado' {
  if (c.status === 'cancelled') return 'cancelado';
  if (c.status === 'expired') return 'expirado';
  // Parse YYYY-MM-DD em timezone local (evita o off-by-one de TZ ao usar new Date())
  const parseLocalDate = (s: string): Date => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const now = new Date();
  const start = parseLocalDate(c.contractDate);
  const end = parseLocalDate(c.contractEndDate);
  const current = now < end ? now : end;
  const pagoSet = new Set(c.payments.filter(p => p.pago).map(p => p.mes));
  // O mês corrente só vira "devido" depois do paymentDay; antes disso, ainda está dentro do prazo.
  const payDay = c.paymentDay || 1;
  const ultimoDevido = current.getDate() >= payDay
    ? new Date(current.getFullYear(), current.getMonth(), 1)
    : new Date(current.getFullYear(), current.getMonth() - 1, 1);
  // Itera mês a mês do início do contrato até o último mês cuja data de pagamento já passou
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= ultimoDevido) {
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!pagoSet.has(m)) return 'inadimplente';
    d.setMonth(d.getMonth() + 1);
  }
  return 'em_dia';
}

// ─── Usuários / Autenticação ─────────────────────────────
interface Usuario {
  id: string;
  username: string;
  passwordHash: string; // formato: salt:hash
  role: 'admin' | 'barbeiro';
  nome: string;
  barberId?: string; // ID do profissional no Trinks (apenas para barbeiros)
  ativo: boolean;
  createdAt: string;
}
let usuarios: Usuario[] = [];

// Tokens de sessão em memória: token → { userId, expiresAt }
const sessoesAtivas = new Map<string, { userId: string; expiresAt: number }>();
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(testHash, "hex"));
  } catch { return false; }
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getUserFromToken(token: string | undefined): Usuario | null {
  if (!token) return null;
  const session = sessoesAtivas.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessoesAtivas.delete(token);
    return null;
  }
  return usuarios.find(u => u.id === session.userId && u.ativo) || null;
}

function extractToken(req: Request): string | undefined {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}

// ─── Checklist Data ──────────────────────────────────────
interface ChecklistDay {
  date: string; // YYYY-MM-DD
  tasks: Record<string, boolean>; // taskId → completed
}
let checklistData: Record<string, ChecklistDay> = {}; // keyed by date

// Load on startup
try {
  if (fs.existsSync(FINANCEIRO_FILE)) {
    const raw = fs.readFileSync(FINANCEIRO_FILE, "utf-8");
    financeEntries = JSON.parse(raw) || [];
    log(`Financeiro: loaded ${financeEntries.length} entries from disk`, "financeiro");
  }
} catch (err) {
  log("Financeiro: could not load data from disk, starting fresh", "financeiro");
}

// Load resolved duplicates on startup
try {
  if (fs.existsSync(DUPLICADOS_RESOLVIDOS_FILE)) {
    const raw = fs.readFileSync(DUPLICADOS_RESOLVIDOS_FILE, "utf-8");
    resolvedDuplicateIds = JSON.parse(raw) || [];
    log(`Duplicados: loaded ${resolvedDuplicateIds.length} resolved IDs from disk`, "duplicados");
  }
} catch (err) {
  log("Duplicados: could not load resolved IDs from disk, starting fresh", "duplicados");
}

function saveResolvedDuplicates() {
  kvSet("duplicados_resolvidos", resolvedDuplicateIds).catch(() => {});
  try {
    fs.writeFileSync(DUPLICADOS_RESOLVIDOS_FILE, JSON.stringify(resolvedDuplicateIds, null, 2), "utf-8");
  } catch (err) {
    log("Duplicados: could not save resolved IDs to disk", "duplicados");
  }
}

function saveFinanceEntries() {
  kvSet("financeiro", financeEntries).catch(() => {});
  try {
    fs.writeFileSync(FINANCEIRO_FILE, JSON.stringify(financeEntries, null, 2), "utf-8");
  } catch (err) {
    log("Financeiro: could not save data to disk", "financeiro");
  }
}

// Load metas on startup
try {
  if (fs.existsSync(METAS_FILE)) {
    const raw = fs.readFileSync(METAS_FILE, "utf-8");
    metasHistorico = JSON.parse(raw) || [];
    log(`Metas: loaded ${metasHistorico.length} months from disk`, "metas");
  }
} catch { log("Metas: starting fresh", "metas"); }

// Load checklist on startup
try {
  if (fs.existsSync(CHECKLIST_FILE)) {
    const raw = fs.readFileSync(CHECKLIST_FILE, "utf-8");
    checklistData = JSON.parse(raw) || {};
    log(`Checklist: loaded ${Object.keys(checklistData).length} days from disk`, "checklist");
  }
} catch { log("Checklist: starting fresh", "checklist"); }

function saveMetas() {
  kvSet("metas", metasHistorico).catch(() => {});
  try { fs.writeFileSync(METAS_FILE, JSON.stringify(metasHistorico, null, 2), "utf-8"); }
  catch { log("Metas: could not save to disk", "metas"); }
}

// Load metas barbeiros on startup
try {
  if (fs.existsSync(METAS_BARBEIROS_FILE)) {
    const raw = fs.readFileSync(METAS_BARBEIROS_FILE, "utf-8");
    metasBarbeiros = JSON.parse(raw) || {};
    log(`Metas barbeiros: loaded from disk`, "metas");
  }
} catch { log("Metas barbeiros: starting fresh", "metas"); }

function saveMetasBarbeiros() {
  kvSet("metas_barbeiros", metasBarbeiros).catch(() => {});
  try { fs.writeFileSync(METAS_BARBEIROS_FILE, JSON.stringify(metasBarbeiros, null, 2), "utf-8"); }
  catch { log("Metas barbeiros: could not save to disk", "metas"); }
}

// Load meta diária on startup
try {
  if (fs.existsSync(META_DIARIA_FILE)) {
    const raw = fs.readFileSync(META_DIARIA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.valor === "number") metaDiaria = parsed.valor;
    log(`Meta diária: loaded R$${metaDiaria} from disk`, "metas");
  }
} catch { log("Meta diária: starting with default R$5.000", "metas"); }

function saveMetaDiaria() {
  kvSet("meta_diaria", { valor: metaDiaria }).catch(() => {});
  try { fs.writeFileSync(META_DIARIA_FILE, JSON.stringify({ valor: metaDiaria }, null, 2), "utf-8"); }
  catch { log("Meta diária: could not save to disk", "metas"); }
}

// Consolidação: load on startup
try {
  if (fs.existsSync(CONSOLIDACAO_CONTAS_FILE)) {
    contasConsolidacao = JSON.parse(fs.readFileSync(CONSOLIDACAO_CONTAS_FILE, "utf-8")) || [];
    // Migração: contas antigas sem campo "meios"
    let migrated = false;
    contasConsolidacao = contasConsolidacao.map((c: any) => {
      if (!Array.isArray(c.meios) || c.meios.length === 0) {
        migrated = true;
        const meios: MeioRecebimento[] =
          c.tipo === 'banco' ? ['pix']
          : c.tipo === 'maquininha' ? ['debito', 'credito']
          : c.tipo === 'caixa' ? ['dinheiro']
          : [];
        return { ...c, meios };
      }
      return c;
    });
    if (migrated) saveContasConsolidacao();
    log(`Consolidação: ${contasConsolidacao.length} contas carregadas`, "consolidacao");
  }
} catch { log("Consolidação contas: starting fresh", "consolidacao"); }
try {
  if (fs.existsSync(CONSOLIDACAO_TRANSACOES_FILE)) {
    transacoesBanco = JSON.parse(fs.readFileSync(CONSOLIDACAO_TRANSACOES_FILE, "utf-8")) || [];
    log(`Consolidação: ${transacoesBanco.length} transações carregadas`, "consolidacao");
  }
} catch { log("Consolidação transações: starting fresh", "consolidacao"); }

function saveContasConsolidacao() {
  kvSet("consolidacao_contas", contasConsolidacao).catch(() => {});
  try { fs.writeFileSync(CONSOLIDACAO_CONTAS_FILE, JSON.stringify(contasConsolidacao, null, 2), "utf-8"); }
  catch { log("Consolidação contas: could not save", "consolidacao"); }
}
function saveTransacoesBanco() {
  kvSet("consolidacao_transacoes", transacoesBanco).catch(() => {});
  try { fs.writeFileSync(CONSOLIDACAO_TRANSACOES_FILE, JSON.stringify(transacoesBanco, null, 2), "utf-8"); }
  catch { log("Consolidação transações: could not save", "consolidacao"); }
}

// Carrega regras de gastos
try {
  if (fs.existsSync(REGRAS_GASTOS_FILE)) {
    regrasGastos = JSON.parse(fs.readFileSync(REGRAS_GASTOS_FILE, "utf-8")) || {};
    log(`Regras gastos: ${Object.keys(regrasGastos).length} regras carregadas`, "consolidacao");
  }
} catch { log("Regras gastos: starting fresh", "consolidacao"); }

function saveRegrasGastos() {
  kvSet("regras_gastos", regrasGastos).catch(() => {});
  try { fs.writeFileSync(REGRAS_GASTOS_FILE, JSON.stringify(regrasGastos, null, 2), "utf-8"); }
  catch { log("Regras gastos: could not save", "consolidacao"); }
}

// Auto-categoriza pela descrição
function autoCategorizarGasto(description: string): CategoriaGasto | undefined {
  const d = (description || "").toLowerCase();

  // Primeiro: regras aprendidas pelo usuário (match parcial)
  // (helper antiga — categorias hard-coded; mantido pra retrocompat)
  for (const [palavra, categoria] of Object.entries(regrasGastos)) {
    if (d.includes(palavra.toLowerCase())) return categoria;
  }

  // Depois: padrões nativos básicos
  if (/aluguel|imobili|imovel/.test(d)) return "aluguel";
  if (/energia|enel|equatorial|cemig|copel|celpe|coelba|luz/.test(d)) return "agua_luz";
  if (/saneago|sabesp|cedae|sanepar|caesb|agua/.test(d)) return "agua_luz";
  if (/iss\b|darf|gps |inss|simples\s*nacional|imposto|tribut/.test(d)) return "imposto";
  if (/trinks|infinitypay\s*plano|vivo|claro|tim|oi |internet|netflix|sistema/.test(d)) return "sistema";
  if (/transf.*entre.*contas|transf\s*propria|para\s*minha\s*conta/.test(d)) return "transferencia_interna";

  return undefined;
}

/** Aplica regras do sistema novo (ExpenseCategoria) a um batch de transações
 *  recém-criadas. Muta as transações em-place. Não persiste — caller chama
 *  saveTransacoesBanco() depois. Persiste apenas o contador `vezesAplicada`
 *  das regras. Robusto a erros: falha silenciosa não trava a importação. */
async function classificarBatchNovo(novas: TransacaoBanco[]): Promise<void> {
  try {
    const regras = await listExpenseRegras();
    const counts = new Map<string, number>();
    for (const t of novas) {
      if (t.amount >= 0) continue;
      if (t.categoriaId) continue; // já veio classificada
      const m = classificarDescricao(t.description, regras);
      if (!m) continue;
      t.categoriaId = m.categoriaId;
      t.subcategoria = m.subcategoria;
      t.regraIdAplicada = m.regraId;
      counts.set(m.regraId, (counts.get(m.regraId) || 0) + 1);
    }
    if (counts.size > 0) await bumpRegrasAplicadas(counts);
  } catch (err: any) {
    log(`classificarBatchNovo erro: ${err.message}`, "expense");
  }
}

const CATEGORIAS_VALIDAS: CategoriaGasto[] = [
  'sistema', 'funcionario', 'aluguel', 'agua_luz', 'produtos', 'imposto',
  'transferencia_interna', 'esporadica', 'outros',
];

// Usuários: load on startup
try {
  if (fs.existsSync(USUARIOS_FILE)) {
    usuarios = JSON.parse(fs.readFileSync(USUARIOS_FILE, "utf-8")) || [];
    log(`Usuários: ${usuarios.length} carregados`, "auth");
  }
} catch { log("Usuários: starting fresh", "auth"); }

function saveUsuarios() {
  kvSet("usuarios", usuarios).catch(() => {});
  try { fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2), "utf-8"); }
  catch { log("Usuários: could not save", "auth"); }
}

// ─── Store unificado (settings, barbers, services, entries, weeklySummaries) ─
interface StoreData {
  settings?: any;
  barbers?: any[];
  services?: any[];
  entries?: any[];
  weeklySummaries?: any[];
  updatedAt?: string;
}
let storeData: StoreData = {};
try {
  if (fs.existsSync(STORE_FILE)) {
    storeData = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) || {};
    log(`Store: dados carregados do disco`, "store");
  }
} catch { log("Store: starting fresh", "store"); }

function saveStore() {
  storeData.updatedAt = new Date().toISOString();
  kvSet("store", storeData).catch(() => {});
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(storeData, null, 2), "utf-8");
  } catch { log("Store: could not save", "store"); }
  // Atualiza config de comissão por categoria sempre que settings mudam
  syncComissaoConfig();
}

function syncComissaoConfig() {
  const s = storeData.settings;
  if (!s) { setComissaoConfig(null); return; }
  setComissaoConfig({
    profissionaisVip: s.profissionaisVip,
    profissionaisExpress: s.profissionaisExpress,
    comissaoVipExpressPct: s.comissaoVipExpressPct,
    comissaoPadraoPct: s.comissaoPadraoPct,
  });
}
// Sincroniza no boot inicial (caso storeData já tenha sido carregado do disco)
syncComissaoConfig();

// Cria admin padrão se não existir nenhum usuário
if (usuarios.length === 0) {
  const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";
  usuarios.push({
    id: `user-${Date.now()}-admin`,
    username: "admin",
    passwordHash: hashPassword(defaultAdminPassword),
    role: "admin",
    nome: "Administrador",
    ativo: true,
    createdAt: new Date().toISOString(),
  });
  saveUsuarios();
  log(`Usuário admin padrão criado (user=admin, pass=${defaultAdminPassword})`, "auth");
}

function saveChecklist() {
  kvSet("checklist", checklistData).catch(() => {});
  try { fs.writeFileSync(CHECKLIST_FILE, JSON.stringify(checklistData, null, 2), "utf-8"); }
  catch { log("Checklist: could not save to disk", "checklist"); }
}

// Zod schema for entry validation
const financeEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  description: z.string().min(1, "Description is required"),
  amount: z.number(),
  category: z.enum(['fixo', 'variavel', 'parcelamento', 'receita', 'investimento']),
  subcategory: z.string().default(""),
  recurrent: z.boolean().default(false),
  notes: z.string().optional(),
});

// ─── Service Costs Data (Ficha Técnica) ─────────────────────
interface CostItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unitCost: number;
}

interface ServiceCostEntry {
  serviceId: string;
  serviceName: string;
  items: CostItem[];
  // v24: overrides opcionais por serviço.
  // Se ausentes, sistema usa defaults (comissão pela categoria do serviço,
  // margem desejada pela categoria do produto/serviço).
  comissaoPct?: number;        // 0..100. % do BARBEIRO/EXECUTOR.
  // v31: comissão adicional do assistente (ex: químicos, depilação, mãos).
  // 0 (default) = serviço sem assistente. Soma com comissaoPct no cálculo.
  comissaoAssistentePct?: number;  // 0..100
  margemDesejadaPct?: number;  // 0..100. Margem alvo para o preço sugerido.
  outrosCustos?: number;       // v70: outros custos do serviço em R$ (campo livre).
}

const SERVICE_COSTS_FILE = path.join(process.cwd(), ".service-costs.json");
let serviceCosts: ServiceCostEntry[] = [];

try {
  if (fs.existsSync(SERVICE_COSTS_FILE)) {
    const raw = fs.readFileSync(SERVICE_COSTS_FILE, "utf-8");
    serviceCosts = JSON.parse(raw) || [];
    log(`Service costs: loaded ${serviceCosts.length} entries from disk`, "costs");
  }
} catch (err) {
  log("Service costs: could not load from disk, starting fresh", "costs");
}

function saveServiceCosts() {
  try {
    fs.writeFileSync(SERVICE_COSTS_FILE, JSON.stringify(serviceCosts, null, 2), "utf-8");
  } catch (err) {
    log("Service costs: could not save to disk", "costs");
  }
}

// ─── Persistent Trinks config ─────────────────────────────
const CONFIG_FILE = path.join(process.cwd(), ".trinks-config.json");
const CACHE_FILE = path.join(process.cwd(), ".trinks-cache.json");

interface TrinksConfigData {
  apiKey: string;
  establishmentId: string;
}

let trinksConfig: TrinksConfigData | null = null;

// Load config: ENV VARS first (Railway/production), then disk file (local dev)
if (process.env.TRINKS_API_KEY) {
  trinksConfig = {
    apiKey: process.env.TRINKS_API_KEY,
    establishmentId: process.env.TRINKS_ESTABLISHMENT_ID || "",
  };
  log("Trinks config loaded from environment variables", "trinks");
} else {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.apiKey) {
        trinksConfig = { apiKey: parsed.apiKey, establishmentId: parsed.establishmentId || "" };
        log("Trinks config loaded from disk", "trinks");
      }
    }
  } catch (err) {
    // Ignore errors reading config — will start fresh
  }
}

function saveTrinksConfig(config: TrinksConfigData) {
  trinksConfig = config;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    log("Trinks config saved to disk", "trinks");
  } catch (err) {
    log("Warning: could not persist config to disk", "trinks");
  }
}

const TRINKS_BASE = "https://api.trinks.com";

// ─── Rate Limiter ─────────────────────────────────────────
// Trinks limits: 60 req/min, 5000 req/month
// We enforce: max 40 req/min (safe margin) + sequential requests with delays
// We also track monthly usage to warn before hitting 5000

interface RateLimiterState {
  requestsThisMinute: number;
  minuteStart: number;       // timestamp when current minute window started
  requestsThisMonth: number;
  monthKey: string;           // "2026-03" format to track monthly usage
  totalRequestsSession: number;
}

const rateLimiter: RateLimiterState = {
  requestsThisMinute: 0,
  minuteStart: Date.now(),
  requestsThisMonth: 0,
  monthKey: "",
  totalRequestsSession: 0,
};

const MAX_REQUESTS_PER_MINUTE = 40;  // safe margin under 60
const MAX_REQUESTS_PER_MONTH = 4500; // teto absoluto de segurança (hard-stop)
const MIN_DELAY_BETWEEN_REQUESTS_MS = 1200; // ~50 req/min max pace
// v54: a conta Trinks tem ~5000 req/mês TOTAL, COMPARTILHADAS com o grecometas.
// Esta é a FATIA do Greco Control (metade). Não bloqueia (decisão do dono) — só
// alerta forte no widget quando o consumo real do mês passar dela.
const TRINKS_FATIA_MENSAL = Number(process.env.TRINKS_MONTHLY_BUDGET || 2500);

let lastRequestTime = 0;

// Mutex serializa waitForRateLimit. Sem isso, várias requisições paralelas
// passam pelo check ao mesmo tempo, ignoram o MIN_DELAY e estouram o rate
// limit do Trinks em rajadas curtas (causa do 429 em deploy fresco).
let rateLimitMutex: Promise<void> = Promise.resolve();

// Indica que a Trinks ainda está em backoff por causa de 429 recente.
// Bloqueia novas chamadas durante o cooldown sem precisar tentar e falhar.
let trinksBackoffUntil = 0;

// Load monthly counter from cache file
function loadMonthlyCounter() {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  rateLimiter.monthKey = currentMonthKey;
  
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.monthlyUsage && parsed.monthlyUsage.monthKey === currentMonthKey) {
        rateLimiter.requestsThisMonth = parsed.monthlyUsage.count || 0;
        log(`Monthly API usage loaded: ${rateLimiter.requestsThisMonth} requests this month`, "trinks");
      }
    }
  } catch (err) {
    // ignore
  }
}

function saveMonthlyCounter() {
  try {
    let cacheData: any = {};
    if (fs.existsSync(CACHE_FILE)) {
      cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    }
    cacheData.monthlyUsage = {
      monthKey: rateLimiter.monthKey,
      count: rateLimiter.requestsThisMonth,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf-8");
  } catch (err) {
    // ignore
  }
}

loadMonthlyCounter();

// v34: circuit breaker. Quando o backoff acumulado pular pra mais de
// CIRCUIT_OPEN_THRESHOLD_MS no futuro, considera o circuito ABERTO e
// recusa novas chamadas imediatamente (sem esperar) por
// CIRCUIT_COOLDOWN_MS. Evita que workers/scheduler fiquem queimando tempo
// e quota tentando bater numa API que claramente está dando 429.
const CIRCUIT_OPEN_THRESHOLD_MS = 60_000;   // backoff > 60s = circuito abre
const CIRCUIT_COOLDOWN_MS = 5 * 60_000;     // após abrir, espera 5 min antes de testar
let circuitOpenUntil = 0;

// ─── Hard-stop REAL de cota mensal (v55) ──────────────────
// O contador em memória (rateLimiter.requestsThisMonth) é inútil como teto: mora
// num arquivo local (.trinks-cache.json) que o Railway zera a cada deploy — em
// junho/2026 foram 61 deploys, então nunca chegou a 4500 e passaram 35 mil
// chamadas na conta compartilhada com o Greco Metas. Este teto lê o consumo REAL
// do mês da auditoria persistente (trinks_audit no Postgres), que sobrevive a
// deploys e é único entre instâncias. Ao atingir, para de bater na API e o painel
// cai no fallback que já existe (snapshot + e-mail + CSV, modo csv-first).
const TRINKS_HARD_CAP_DEFAULT = Number(process.env.TRINKS_HARD_CAP || 2000);
let consumoMesCache = { at: 0, total: 0, lido: false };

async function getTetoMensalTrinks(): Promise<number> {
  try {
    const v = await kvGet<number>("trinks_hard_cap");
    if (typeof v === "number" && v > 0) return v;
  } catch { /* usa default */ }
  return TRINKS_HARD_CAP_DEFAULT;
}

// Consumo real do mês corrente (soma dos buckets trinks_audit do mês), cache 60s.
async function getConsumoMesTrinks(): Promise<number> {
  const agora = Date.now();
  if (consumoMesCache.lido && agora - consumoMesCache.at < 60_000) {
    return consumoMesCache.total;
  }
  try {
    const buckets = await lerUltimosDias(32);
    // monthKey vem do ÚLTIMO bucket (hoje em fuso SP, mesmo fuso em que a auditoria
    // é chaveada). Usar new Date() do servidor (UTC) erraria o mês na virada: das
    // 21h às 23h59 de SP o UTC já está no dia/mês seguinte e o filtro zeraria.
    const hojeSP = buckets.length ? (buckets[buckets.length - 1].dia || "") : "";
    const monthKey = hojeSP.slice(0, 7); // "YYYY-MM"
    const total = monthKey
      ? buckets
          .filter((b) => (b.dia || "").startsWith(monthKey))
          .reduce((s, b) => s + (b.total || 0), 0)
      : 0;
    consumoMesCache = { at: agora, total, lido: true };
    return total;
  } catch {
    // Falha de leitura: reusa o último valor conhecido (não derruba o painel).
    return consumoMesCache.lido ? consumoMesCache.total : 0;
  }
}

async function waitForRateLimit(): Promise<void> {
  // Serializa via mutex: cada chamada espera a anterior terminar.
  // Sem isso, múltiplas requisições paralelas verificam rateLimiter ao mesmo
  // tempo, todas passam e disparam em rajada (causa do 429 em deploy fresco).
  const previous = rateLimitMutex;
  let release: () => void;
  rateLimitMutex = new Promise<void>(r => { release = r; });
  await previous;

  try {
    // Circuit breaker: se está aberto, falha imediato sem tentar request.
    if (circuitOpenUntil > Date.now()) {
      throw { status: 429, message: `Circuit breaker aberto até ${new Date(circuitOpenUntil).toISOString()}. API Trinks recebeu 429 recentemente — pausando chamadas pra economizar quota.` };
    }
    // Se o backoff acumulado já passou do limiar, abre o circuito.
    if (trinksBackoffUntil - Date.now() > CIRCUIT_OPEN_THRESHOLD_MS) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      log(`⚠️ Circuit breaker ABERTO por ${CIRCUIT_COOLDOWN_MS / 60_000}min (backoff acumulado ${Math.round((trinksBackoffUntil - Date.now()) / 1000)}s)`, "trinks");
      throw { status: 429, message: `Circuit breaker aberto. API Trinks está em backoff prolongado — pausando 5min.` };
    }
    // Se a Trinks está em backoff (429 recente), espera até o cooldown acabar
    if (trinksBackoffUntil > Date.now()) {
      const wait = trinksBackoffUntil - Date.now();
      log(`Trinks em backoff: aguardando ${Math.round(wait / 1000)}s antes de tentar`, "trinks");
      await new Promise(r => setTimeout(r, wait));
    }

    const now = Date.now();

    // Reset minute counter if window expired
    if (now - rateLimiter.minuteStart > 60000) {
      rateLimiter.requestsThisMinute = 0;
      rateLimiter.minuteStart = now;
    }

    // Hard-stop REAL (v55): consumo persistente do mês x teto da fatia do GC.
    // Sobrevive a deploys e múltiplas instâncias (o de memória abaixo não).
    const tetoMes = await getTetoMensalTrinks();
    const consumoMes = await getConsumoMesTrinks();
    if (consumoMes >= tetoMes) {
      throw { status: 429, message: `Teto mensal do Greco Control atingido (${consumoMes}/${tetoMes}). Cota Trinks é compartilhada com o Greco Metas — usando e-mail/CSV até o mês virar.` };
    }

    // Check monthly limit (contador em memória — redundância; zera a cada deploy)
    if (rateLimiter.requestsThisMonth >= MAX_REQUESTS_PER_MONTH) {
      throw { status: 429, message: `Limite mensal de requisições atingido (${rateLimiter.requestsThisMonth}/${MAX_REQUESTS_PER_MONTH}). O limite reseta no 1º dia do próximo mês.` };
    }

    // If we're near the per-minute limit, wait until next minute window
    if (rateLimiter.requestsThisMinute >= MAX_REQUESTS_PER_MINUTE) {
      const waitTime = 60000 - (now - rateLimiter.minuteStart) + 500;
      log(`Rate limit: waiting ${Math.round(waitTime / 1000)}s for next minute window (${rateLimiter.requestsThisMinute} reqs this minute)`, "trinks");
      await new Promise(r => setTimeout(r, waitTime));
      rateLimiter.requestsThisMinute = 0;
      rateLimiter.minuteStart = Date.now();
    }

    // Enforce minimum delay between requests
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < MIN_DELAY_BETWEEN_REQUESTS_MS) {
      const delay = MIN_DELAY_BETWEEN_REQUESTS_MS - timeSinceLastRequest;
      await new Promise(r => setTimeout(r, delay));
    }
  } finally {
    release!();
  }
}

function recordRequest() {
  const now = Date.now();
  if (now - rateLimiter.minuteStart > 60000) {
    rateLimiter.requestsThisMinute = 0;
    rateLimiter.minuteStart = now;
  }
  rateLimiter.requestsThisMinute++;
  rateLimiter.requestsThisMonth++;
  rateLimiter.totalRequestsSession++;
  lastRequestTime = now;
  
  // Save monthly counter every 5 requests
  if (rateLimiter.totalRequestsSession % 5 === 0) {
    saveMonthlyCounter();
  }
}

// ─── Server-side cache ────────────────────────────────────
// Cache TTLs:
// - profissionais, servicos: 24 hours (rarely change)
// - estabelecimento: 24 hours
// - clientes: 6 hours
// - agendamentos, transacoes: 30 minutes (change frequently, but no need to refetch on every page load)
// - full sync result: 15 minutes

interface CacheEntry {
  data: any;
  timestamp: number;
  ttlMs: number;
}

const memoryCache: Record<string, CacheEntry> = {};

// Deduplica fetches Trinks em voo por chave de cache. Sem isso, polling do
// dashboard (5s) dispara N chamadas paralelas pro mesmo dia, saturando o
// rate limit (40/min) e fazendo o dashboard mostrar dados parciais.
const inflightTrinksFetches: Map<string, Promise<any[]>> = new Map();

const CACHE_TTLS: Record<string, number> = {
  "estabelecimentos": 24 * 60 * 60 * 1000,    // 24h
  "profissionais": 24 * 60 * 60 * 1000,        // 24h
  "servicos": 24 * 60 * 60 * 1000,             // 24h
  "clientes": 6 * 60 * 60 * 1000,              // 6h
  "agendamentos": 2 * 60 * 60 * 1000,          // 2h (v54: economia de cota)
  "transacoes": 2 * 60 * 60 * 1000,            // 2h (v54: economia de cota)
  "lancamentos": 2 * 60 * 60 * 1000,           // 2h (v54: economia de cota)
  "full_sync": 60 * 60 * 1000,                 // 1h (v54: era 15min)
};

function getCached(key: string): any | null {
  const entry = memoryCache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttlMs) {
    delete memoryCache[key];
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any, ttlOverride?: number) {
  const ttl = ttlOverride || CACHE_TTLS[key] || 15 * 60 * 1000;
  memoryCache[key] = { data, timestamp: Date.now(), ttlMs: ttl };
}

function invalidateCache(prefix?: string) {
  if (prefix) {
    Object.keys(memoryCache).forEach(key => {
      if (key.startsWith(prefix)) delete memoryCache[key];
    });
  } else {
    Object.keys(memoryCache).forEach(key => delete memoryCache[key]);
  }
}

// Also try to load last sync from disk cache for instant display
function loadSyncCacheFromDisk(): any | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.lastSync && parsed.lastSync.data && parsed.lastSync.timestamp) {
        const age = Date.now() - parsed.lastSync.timestamp;
        // Aceita cache de até 24h: deploy fresco ou restart não dispara
        // a tempestade de chamadas iniciais (causa do 429 no boot).
        // O usuário ainda pode forçar refresh em qualquer aba se quiser dado live.
        if (age < 24 * 60 * 60 * 1000) {
          const ageH = Math.floor(age / 3600000);
          const ageM = Math.round((age % 3600000) / 60000);
          log(`Loaded sync cache from disk (age: ${ageH}h${ageM}min)`, "trinks");
          return parsed.lastSync.data;
        }
      }
    }
  } catch (err) { /* ignore */ }
  return null;
}

function saveSyncCacheToDisk(data: any) {
  try {
    let cacheData: any = {};
    if (fs.existsSync(CACHE_FILE)) {
      cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    }
    cacheData.lastSync = { data, timestamp: Date.now() };
    // Preserve monthly usage
    if (!cacheData.monthlyUsage) {
      cacheData.monthlyUsage = { monthKey: rateLimiter.monthKey, count: rateLimiter.requestsThisMonth };
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf-8");
    log("Sync cache saved to disk", "trinks");
  } catch (err) {
    log("Warning: could not save sync cache to disk", "trinks");
  }
}

// ─── Helper: make Trinks API call (com retry em 429) ─────────────
// IMPORTANT: Trinks API uses estabelecimentoId as an HTTP HEADER, not a query param.
async function trinksFetch(
  path: string,
  queryParams?: Record<string, string>,
  options?: { skipEstabHeader?: boolean }
) {
  if (!trinksConfig) {
    throw { status: 400, message: "Chave API da Trinks não configurada. Vá em Configurações para conectar." };
  }

  // Backoff exponencial em 429: 5s, 10s, 20s + jitter 1-5s.
  // Total máximo de tentativas: 4. Se todas falharem, propaga 429.
  const MAX_RETRIES = 3;
  const BASE_DELAYS_MS = [5000, 10000, 20000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForRateLimit();

    const url = new URL(`/v1/${path}`, TRINKS_BASE);
    if (queryParams) {
      Object.entries(queryParams).forEach(([k, v]) => {
        if (v) url.searchParams.set(k, v);
      });
    }

    const headers: Record<string, string> = {
      "X-Api-Key": trinksConfig.apiKey,
      "Accept": "application/json",
    };

    if (!options?.skipEstabHeader && trinksConfig.establishmentId) {
      headers["estabelecimentoId"] = trinksConfig.establishmentId;
    }

    log(`API call #${rateLimiter.totalRequestsSession + 1} (${rateLimiter.requestsThisMinute + 1}/min, ${rateLimiter.requestsThisMonth + 1}/month): ${path}${attempt > 0 ? ` [retry ${attempt}]` : ""}`, "trinks");

    const res = await fetch(url.toString(), { headers });
    recordRequest();

    if (res.ok) {
      const data = await res.json();
      // Auditoria: chamada real de sucesso
      try { registrarEventoTrinks({ endpoint: path, status: "ok" }); } catch {}
      // v34: sucesso → reseta circuit breaker (e backoff se necessário)
      if (circuitOpenUntil > 0) {
        log(`✅ Circuit breaker FECHADO (API Trinks recuperada)`, "trinks");
        circuitOpenUntil = 0;
      }
      if (trinksBackoffUntil > Date.now()) {
        trinksBackoffUntil = 0;
      }
      return data;
    }

    const body = await res.text().catch(() => "");
    log(`Trinks error ${res.status}: ${body}`, "trinks");

    if (res.status === 401) {
      try { registrarEventoTrinks({ endpoint: path, status: "erro" }); } catch {}
      throw { status: 401, message: "Chave API inválida. Verifique suas credenciais." };
    }
    if (res.status === 403) {
      try { registrarEventoTrinks({ endpoint: path, status: "erro" }); } catch {}
      throw { status: 403, message: "Sem permissão para acessar este recurso." };
    }

    // 429: retry com backoff exponencial + jitter
    if (res.status === 429 && attempt < MAX_RETRIES) {
      try { registrarEventoTrinks({ endpoint: path, status: "rate429" }); } catch {}
      const baseDelay = BASE_DELAYS_MS[attempt];
      const jitter = 1000 + Math.floor(Math.random() * 4000); // 1000–5000ms
      const totalDelay = baseDelay + jitter;
      // Marca backoff global pra outras requisições paralelas também esperarem
      trinksBackoffUntil = Math.max(trinksBackoffUntil, Date.now() + totalDelay);
      log(`429 em ${path}. Backoff ${Math.round(totalDelay / 1000)}s antes de retry ${attempt + 1}/${MAX_RETRIES}`, "trinks");
      await new Promise(r => setTimeout(r, totalDelay));
      continue;
    }

    if (res.status === 429) {
      try { registrarEventoTrinks({ endpoint: path, status: "rate429" }); } catch {}
      log(`RATE LIMITED by Trinks API após ${MAX_RETRIES} retries. Minute: ${rateLimiter.requestsThisMinute}, Month: ${rateLimiter.requestsThisMonth}`, "trinks");
      throw { status: 429, message: "Limite de requisições da Trinks excedido após várias tentativas. O CRM usará dados do cache." };
    }

    try { registrarEventoTrinks({ endpoint: path, status: "erro" }); } catch {}
    throw { status: res.status, message: body || `Erro ${res.status} da API Trinks.` };
  }

  // Inalcançável: o loop sempre retorna ou lança
  throw { status: 500, message: "trinksFetch: caminho inalcançável" };
}

// Helper: soma dias a uma string YYYY-MM-DD (TZ-safe via UTC noon).
function ymdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Paginate through all pages of a Trinks endpoint — SEQUENTIAL to control rate
async function trinksFetchAll(
  endpointPath: string,
  queryParams?: Record<string, string>,
  options?: { skipEstabHeader?: boolean }
) {
  // Check cache first
  const cacheKey = `${endpointPath}_${JSON.stringify(queryParams || {})}`;
  const cached = getCached(cacheKey);
  if (cached !== null) {
    log(`Cache HIT for ${endpointPath} (${Array.isArray(cached) ? cached.length + ' items' : 'object'})`, "trinks");
    return cached;
  }

  const allItems: any[] = [];
  let page = 1;
  // Aumentado de 20 para 40 — abril/2026 tem 917+ transações e estava sendo truncado em 1000.
  // 40 páginas × 50 itens = 2000 itens máximo, suficiente para meses com alto volume.
  const maxPages = 40;

  while (page <= maxPages) {
    const data = await trinksFetch(endpointPath, { ...queryParams, page: String(page) }, options);

    const items = Array.isArray(data) ? data : (data?.data || data?.items || data?.content || []);

    if (Array.isArray(items) && items.length > 0) {
      allItems.push(...items);
      const pageSize = data?.pageSize || 50;
      if (items.length < pageSize) break;
      page++;
      // No extra delay here — waitForRateLimit() handles pacing
    } else if (!Array.isArray(items) && typeof data === 'object' && data !== null && !data.data && !data.items && !data.content) {
      // Single object response
      const ttl = CACHE_TTLS[endpointPath] || 15 * 60 * 1000;
      setCache(cacheKey, data, ttl);
      return data;
    } else {
      break;
    }
  }

  // Cache the result — mas NUNCA cachear lista vazia (provavelmente erro silencioso da Trinks)
  // Sem essa guarda, um 429/timeout transient deixaria o sistema travado mostrando "0 produtos" até o TTL expirar.
  if (allItems.length > 0) {
    let ttl = CACHE_TTLS[endpointPath] || 15 * 60 * 1000;
    // Cache estendido pra dias/meses passados — dados imutáveis.
    // - dataFim < primeiro do mês: 30 dias (mês fechado)
    // - dataFim < hoje: 7 dias (dia passado do mês corrente)
    // Reduz drasticamente as chamadas Trinks ao navegar em histórico.
    const df = queryParams?.dataFim;
    if (df && (endpointPath === "agendamentos" || endpointPath === "transacoes" || endpointPath === "lancamentos")) {
      const fmtSP = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      });
      const hojeSP = fmtSP.format(new Date()); // YYYY-MM-DD
      const primeiroDoMesSP = `${hojeSP.slice(0, 7)}-01`;
      if (df < primeiroDoMesSP) {
        ttl = 30 * 24 * 60 * 60 * 1000; // 30 dias — mês fechado, imutável
      } else if (df < hojeSP) {
        ttl = 7 * 24 * 60 * 60 * 1000; // 7 dias — dia passado do mês corrente
      }
    }
    setCache(cacheKey, allItems, ttl);
    log(`Cache SET for ${endpointPath}: ${allItems.length} items (TTL: ${Math.round(ttl / 60000)}min)`, "trinks");
  } else {
    log(`Cache SKIPPED for ${endpointPath}: lista vazia (possível falha silenciosa, não será cacheada)`, "trinks");
  }

  return allItems;
}

// ─── Otimização A: reuso de janela mensal para dia/semana ───
// Quando já existe cache de uma janela MAIOR (ex.: mês inteiro) que contém a janela pedida
// (ex.: hoje, ou semana corrente), filtramos a lista em memória em vez de fazer um novo fetch
// na Trinks. Aplicável apenas a endpoints com dataInicio/dataFim (agendamentos, transacoes).
// Aditivo: não altera trinksFetchAll nem o cache existente.
function trinksTryFromCachedRange(
  endpointPath: string,
  queryParams: Record<string, string>
): any[] | null {
  const di = queryParams?.dataInicio;
  const df = queryParams?.dataFim;
  if (!di || !df) return null;
  if (endpointPath !== "agendamentos" && endpointPath !== "transacoes") return null;
  // Campo da data dentro de cada item para filtragem local
  const dataField = endpointPath === "agendamentos" ? "dataHoraInicio" : "dataHora";

  // Procura uma entrada de cache do MESMO endpointPath cuja janela contenha [di, df).
  // Cache key tem o formato `${endpointPath}_${JSON.stringify(queryParams)}`.
  const prefix = `${endpointPath}_`;
  for (const key of Object.keys(memoryCache)) {
    if (!key.startsWith(prefix)) continue;
    const entry = memoryCache[key];
    if (!entry) continue;
    if (Date.now() - entry.timestamp > entry.ttlMs) continue;
    if (!Array.isArray(entry.data)) continue;
    // Extrai os queryParams da chave
    let qp: Record<string, string> = {};
    try {
      const jsonPart = key.slice(prefix.length);
      qp = JSON.parse(jsonPart);
    } catch { continue; }
    // Os outros parâmetros (não-data) precisam coincidir.
    const restCached = { ...qp }; delete restCached.dataInicio; delete restCached.dataFim;
    const restPedido = { ...queryParams }; delete restPedido.dataInicio; delete restPedido.dataFim;
    if (JSON.stringify(restCached) !== JSON.stringify(restPedido)) continue;
    const cdi = qp.dataInicio; const cdf = qp.dataFim;
    if (!cdi || !cdf) continue;
    // Janela cacheada precisa CONTER a janela pedida.
    // (Trinks /transacoes usa intervalo semi-aberto [dataInicio, dataFim+1); essa propriedade é
    //  comparada como string YYYY-MM-DD, o que é correto para datas ISO.)
    if (cdi <= di && cdf >= df) {
      // Filtra os itens pela data dentro da janela [di, df) (se transacoes) ou [di, df] (agendamentos).
      // Para uniformidade, filtramos por `slice(0,10)` >= di e <= df-1day no caso transacoes.
      // Para evitar cálculo de offset, aplicamos a mesma regra usada no resto do código:
      //   - agendamentos: dataField slice(0,10) BETWEEN di AND df (inclusivo)
      //   - transacoes:   dataField slice(0,10) >= di AND < df
      const filtered = entry.data.filter((item: any) => {
        const dt = String(item?.[dataField] || item?.data || "").slice(0, 10);
        if (!dt) return false;
        if (endpointPath === "transacoes") return dt >= di && dt < df;
        return dt >= di && dt <= df;
      });
      log(`Cache HIT (range) ${endpointPath} ${di}..${df} via ${cdi}..${cdf}: ${filtered.length}/${entry.data.length}`, "trinks");
      return filtered;
    }
  }
  return null;
}

// Wrapper: tenta servir de uma janela cacheada maior antes de chamar trinksFetchAll.
// Mantém 100% de compatibilidade com a assinatura de trinksFetchAll para os usos relevantes.
async function trinksFetchAllRange(
  endpointPath: string,
  queryParams: Record<string, string>,
  options?: { skipEstabHeader?: boolean }
) {
  // Primeiro: cache exato (já feito por trinksFetchAll). Aqui tentamos só o reuso de janela.
  const fromRange = trinksTryFromCachedRange(endpointPath, queryParams);
  if (fromRange !== null) return fromRange;
  return trinksFetchAll(endpointPath, queryParams, options);
}

// v33: Wrapper específico para AGENDAMENTOS. Prefere o cache do CSV importado
// por email (≤ 24h) quando ele cobre todo o intervalo pedido. Caso contrário,
// cai pra trinksFetchAll (API). Economiza tokens da Trinks pra endpoints que
// só querem a agenda futura/recente — NÃO usar onde precisa de dados detalhados
// de pagamento (CSV não tem formaPagamento, totalPagar exato, IDs originais).
async function getAgendamentosPreferCsv(
  queryParams: { dataInicio?: string; dataFim?: string } & Record<string, string | undefined>,
  apiFallback: () => Promise<any[]>,
): Promise<any[]> {
  const r = await getAgendamentosPreferCsvVerbose(queryParams, apiFallback);
  return r.data;
}

// v34: variante que retorna também a FONTE — pra UI mostrar badge ('CSV' | 'trinks-api')
async function getAgendamentosPreferCsvVerbose(
  queryParams: { dataInicio?: string; dataFim?: string } & Record<string, string | undefined>,
  apiFallback: () => Promise<any[]>,
): Promise<{ data: any[]; fonte: "csv" | "trinks-api"; csvGeradoEm?: string }> {
  const csvInfo = await getUltimoImportAgendamentos();
  const csv = csvInfo ? await getAgendamentosCsvFreshOrNull(24) : null;
  if (!csv || csv.length === 0) return { data: await apiFallback(), fonte: "trinks-api" };

  const ini = queryParams.dataInicio;
  const fim = queryParams.dataFim;
  if (!ini || !fim) return { data: await apiFallback(), fonte: "trinks-api" };

  let csvMin = "9999-99-99", csvMax = "0000-00-00";
  for (const a of csv) {
    const d = (a.dataHoraInicio || "").slice(0, 10);
    if (d && d < csvMin) csvMin = d;
    if (d && d > csvMax) csvMax = d;
  }
  if (ini < csvMin || fim > csvMax) return { data: await apiFallback(), fonte: "trinks-api" };

  const filtered = csv.filter(a => {
    const d = (a.dataHoraInicio || "").slice(0, 10);
    return d >= ini && d <= fim;
  });
  return { data: filtered, fonte: "csv", csvGeradoEm: csvInfo?.geradoEm };
}

// ─── Error handler wrapper ────────────────────────────────
function handleTrinksError(err: any, res: Response) {
  if (err && typeof err === "object" && "status" in err) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return res.status(503).json({ error: "Erro de conexão com a Trinks. Verifique sua internet." });
  }
  console.error("Trinks API error:", err);
  return res.status(500).json({ error: err?.message || "Erro interno ao acessar a API Trinks." });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Aguarda DB conectar e puxa dados do DB (sobrescreve dos arquivos) ──
  try {
    await waitForDb(8000);
    if (isDbReady()) {
      log("Carregando dados do PostgreSQL...", "db");
      const [
        dbUsuarios, dbFinanceiro, dbMetas, dbMetasBarb, dbChecklist,
        dbContas, dbTransacoes, dbRegras, dbDuplicados, dbStore,
        dbAssinaturaClientes, dbAssinaturaPlanos,
      ] = await Promise.all([
        kvGet<typeof usuarios>("usuarios"),
        kvGet<typeof financeEntries>("financeiro"),
        kvGet<typeof metasHistorico>("metas"),
        kvGet<typeof metasBarbeiros>("metas_barbeiros"),
        kvGet<typeof checklistData>("checklist"),
        kvGet<typeof contasConsolidacao>("consolidacao_contas"),
        kvGet<typeof transacoesBanco>("consolidacao_transacoes"),
        kvGet<typeof regrasGastos>("regras_gastos"),
        kvGet<typeof resolvedDuplicateIds>("duplicados_resolvidos"),
        kvGet<typeof storeData>("store"),
        kvGet<typeof assinaturaClientes>("assinaturas_clientes"),
        kvGet<typeof assinaturaPlanos>("assinaturas_planos"),
      ]);
      if (Array.isArray(dbUsuarios) && dbUsuarios.length > 0) usuarios = dbUsuarios;
      if (Array.isArray(dbFinanceiro)) financeEntries = dbFinanceiro;
      if (Array.isArray(dbMetas)) metasHistorico = dbMetas;
      if (dbMetasBarb && typeof dbMetasBarb === "object") metasBarbeiros = dbMetasBarb;
      if (dbChecklist && typeof dbChecklist === "object") checklistData = dbChecklist;
      if (Array.isArray(dbContas)) contasConsolidacao = dbContas;
      if (Array.isArray(dbTransacoes)) transacoesBanco = dbTransacoes;
      if (dbRegras && typeof dbRegras === "object") regrasGastos = dbRegras;
      if (Array.isArray(dbDuplicados)) resolvedDuplicateIds = dbDuplicados;
      if (dbStore && typeof dbStore === "object") { storeData = dbStore; syncComissaoConfig(); }
      if (Array.isArray(dbAssinaturaClientes)) assinaturaClientes = dbAssinaturaClientes;
      if (Array.isArray(dbAssinaturaPlanos) && dbAssinaturaPlanos.length > 0) assinaturaPlanos = dbAssinaturaPlanos;

      // Se este é o primeiro boot com DB, migra os dados que estão em memória para ele
      const anyData = [dbUsuarios, dbFinanceiro, dbMetas, dbMetasBarb, dbChecklist, dbContas, dbTransacoes, dbRegras, dbDuplicados, dbStore].some(v => v !== null);
      if (!anyData) {
        log("Primeira inicialização com DB — migrando dados em memória para Postgres", "db");
        await Promise.all([
          kvSet("usuarios", usuarios),
          kvSet("financeiro", financeEntries),
          kvSet("metas", metasHistorico),
          kvSet("metas_barbeiros", metasBarbeiros),
          kvSet("checklist", checklistData),
          kvSet("consolidacao_contas", contasConsolidacao),
          kvSet("consolidacao_transacoes", transacoesBanco),
          kvSet("regras_gastos", regrasGastos),
          kvSet("duplicados_resolvidos", resolvedDuplicateIds),
          kvSet("store", storeData),
          kvSet("assinaturas_clientes", assinaturaClientes),
          kvSet("assinaturas_planos", assinaturaPlanos),
        ]);
      }
      log("Dados carregados do Postgres", "db");
    }
  } catch (err: any) {
    log(`Erro ao carregar do DB (usando dados dos arquivos): ${err.message}`, "db");
  }

  // ─── Bootstrap das contas mensais (cadastra 6 iniciais se kv vazio) ─────
  try {
    await bootstrapContasIniciais();
  } catch (err: any) {
    log(`[contasMensais] bootstrap falhou: ${err.message}`, "db");
  }

  // ──────────────────────────────────────────────────────────────────
  // AUTH ROUTES
  // ──────────────────────────────────────────────────────────────────

  // POST /api/auth/login — autentica e retorna token
  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios." });
    }
    const user = usuarios.find(u => u.username.toLowerCase() === String(username).toLowerCase() && u.ativo);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Usuário ou senha incorretos." });
    }
    const token = generateToken();
    sessoesAtivas.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_DURATION_MS });
    const { passwordHash, ...userSafe } = user;
    return res.json({ token, user: userSafe });
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const token = extractToken(req);
    if (token) sessoesAtivas.delete(token);
    return res.json({ ok: true });
  });

  // GET /api/auth/me — retorna usuário atual
  app.get("/api/auth/me", (req: Request, res: Response) => {
    const user = getUserFromToken(extractToken(req));
    if (!user) return res.status(401).json({ error: "Não autenticado." });
    const { passwordHash, ...userSafe } = user;
    return res.json(userSafe);
  });

  // GET /api/auth/usuarios — admin lista todos os usuários
  app.get("/api/auth/usuarios", (req: Request, res: Response) => {
    const user = getUserFromToken(extractToken(req));
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Acesso negado." });
    return res.json(usuarios.map(u => {
      const { passwordHash, ...rest } = u;
      return rest;
    }));
  });

  // POST /api/auth/usuarios — admin cria novo usuário
  app.post("/api/auth/usuarios", (req: Request, res: Response) => {
    const admin = getUserFromToken(extractToken(req));
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Acesso negado." });
    const { username, password, nome, role, barberId } = req.body;
    if (!username || !password || !nome || !role) {
      return res.status(400).json({ error: "username, password, nome e role são obrigatórios." });
    }
    if (role !== "admin" && role !== "barbeiro") {
      return res.status(400).json({ error: "role deve ser 'admin' ou 'barbeiro'." });
    }
    if (usuarios.some(u => u.username.toLowerCase() === String(username).toLowerCase())) {
      return res.status(409).json({ error: "Usuário já existe." });
    }
    const newUser: Usuario = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username: String(username),
      passwordHash: hashPassword(String(password)),
      role,
      nome: String(nome),
      barberId: barberId ? String(barberId) : undefined,
      ativo: true,
      createdAt: new Date().toISOString(),
    };
    usuarios.push(newUser);
    saveUsuarios();
    const { passwordHash, ...userSafe } = newUser;
    return res.json(userSafe);
  });

  // PUT /api/auth/usuarios/:id — admin atualiza usuário (nome, role, barberId, ativo)
  app.put("/api/auth/usuarios/:id", (req: Request, res: Response) => {
    const admin = getUserFromToken(extractToken(req));
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Acesso negado." });
    const user = usuarios.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    const { nome, role, barberId, ativo } = req.body;
    if (nome != null) user.nome = String(nome);
    if (role != null && (role === "admin" || role === "barbeiro")) user.role = role;
    if (barberId !== undefined) user.barberId = barberId ? String(barberId) : undefined;
    if (ativo != null) user.ativo = !!ativo;
    saveUsuarios();
    const { passwordHash, ...userSafe } = user;
    return res.json(userSafe);
  });

  // POST /api/auth/usuarios/:id/reset-password — admin reseta senha
  app.post("/api/auth/usuarios/:id/reset-password", (req: Request, res: Response) => {
    const admin = getUserFromToken(extractToken(req));
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Acesso negado." });
    const user = usuarios.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    const { password } = req.body;
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: "Senha deve ter ao menos 4 caracteres." });
    }
    user.passwordHash = hashPassword(String(password));
    saveUsuarios();
    return res.json({ ok: true });
  });

  // DELETE /api/auth/usuarios/:id
  app.delete("/api/auth/usuarios/:id", (req: Request, res: Response) => {
    const admin = getUserFromToken(extractToken(req));
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Acesso negado." });
    if (req.params.id === admin.id) {
      return res.status(400).json({ error: "Você não pode excluir a si mesmo." });
    }
    const before = usuarios.length;
    usuarios = usuarios.filter(u => u.id !== req.params.id);
    saveUsuarios();
    return res.json({ ok: true, removed: before - usuarios.length });
  });

  // ──────────────────────────────────────────────────────────────────
  // STORE — persistência de settings, barbers, services, entries
  // ──────────────────────────────────────────────────────────────────

  // GET /api/store — retorna todo o store persistido
  app.get("/api/store", (_req: Request, res: Response) => {
    return res.json(storeData);
  });

  // PUT /api/store — atualiza um ou mais slices do store
  app.put("/api/store", (req: Request, res: Response) => {
    const { settings, barbers, services, entries, weeklySummaries } = req.body || {};
    if (settings !== undefined) storeData.settings = settings;
    if (barbers !== undefined) storeData.barbers = Array.isArray(barbers) ? barbers : [];
    if (services !== undefined) storeData.services = Array.isArray(services) ? services : [];
    if (entries !== undefined) storeData.entries = Array.isArray(entries) ? entries : [];
    if (weeklySummaries !== undefined) storeData.weeklySummaries = Array.isArray(weeklySummaries) ? weeklySummaries : [];
    saveStore();
    return res.json({ ok: true, updatedAt: storeData.updatedAt });
  });

  // POST /api/auth/change-password — usuário muda a própria senha
  app.post("/api/auth/change-password", (req: Request, res: Response) => {
    const user = getUserFromToken(extractToken(req));
    if (!user) return res.status(401).json({ error: "Não autenticado." });
    const { currentPassword, newPassword } = req.body;
    if (!verifyPassword(String(currentPassword || ""), user.passwordHash)) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: "Nova senha deve ter ao menos 4 caracteres." });
    }
    user.passwordHash = hashPassword(String(newPassword));
    saveUsuarios();
    return res.json({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────────
  // PAINEL DO BARBEIRO
  // ──────────────────────────────────────────────────────────────────

  // GET /api/meu-painel — dados do barbeiro logado
  app.get("/api/meu-painel", async (req: Request, res: Response) => {
    const user = getUserFromToken(extractToken(req));
    if (!user) return res.status(401).json({ error: "Não autenticado." });
    if (user.role !== "barbeiro") return res.status(403).json({ error: "Apenas barbeiros têm painel." });
    if (!user.barberId) return res.status(400).json({ error: "Seu usuário não está vinculado a um profissional." });

    const syncCache = getCached("full_sync") || loadSyncCacheFromDisk();
    const profissionais = syncCache?.profissionais || [];
    const agendamentos = syncCache?.agendamentos || [];
    const transacoes = syncCache?.transacoes || [];

    const prof = profissionais.find((p: any) => String(p.id) === user.barberId);

    // Helpers
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const dow = today.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    const weekStart = monday.toISOString().slice(0, 10);
    const monthStart = todayStr.slice(0, 7) + "-01";

    function isMine(item: any): boolean {
      const pid = item.profissionalId || item.profissional?.id;
      return String(pid || "") === user.barberId;
    }
    function getDate(item: any): string {
      const raw = item.dataHoraInicio || item.dataHora || item.data || "";
      return typeof raw === "string" ? raw.slice(0, 10) : "";
    }
    function getValue(item: any): number {
      return Number(item.totalPagar || item.valor || 0);
    }
    function isCompleted(a: any): boolean {
      const st = a.status;
      const name = typeof st === "string" ? st : st?.descricao || st?.nome || "";
      return /finalizado|realizado|concluido|concluído/i.test(name);
    }

    // Meu faturamento por período
    let diaFat = 0, semanaFat = 0, mesFat = 0;
    transacoes.filter(isMine).forEach((t: any) => {
      const d = getDate(t);
      if (!d) return;
      const v = getValue(t);
      if (d >= monthStart) mesFat += v;
      if (d >= weekStart) semanaFat += v;
      if (d === todayStr) diaFat += v;
    });

    // Clientes por período (agendamentos finalizados)
    let diaCli = 0, semanaCli = 0, mesCli = 0;
    agendamentos.filter(isMine).forEach((a: any) => {
      const d = getDate(a);
      if (!d) return;
      if (!isCompleted(a)) return;
      if (d >= monthStart) mesCli += 1;
      if (d >= weekStart) semanaCli += 1;
      if (d === todayStr) diaCli += 1;
    });

    // Próximos agendamentos de hoje (não finalizados)
    const proximosHoje = agendamentos
      .filter(isMine)
      .filter((a: any) => getDate(a) === todayStr && !isCompleted(a))
      .sort((a: any, b: any) => (a.dataHoraInicio || "").localeCompare(b.dataHoraInicio || ""))
      .slice(0, 10)
      .map((a: any) => ({
        hora: (a.dataHoraInicio || "").slice(11, 16),
        cliente: a.cliente?.nome || a.clienteNome || "Cliente",
        servico: a.servico?.nome || (Array.isArray(a.servicos) ? a.servicos.map((s: any) => s.nome).join(", ") : "Serviço"),
        valor: getValue(a),
      }));

    // Meta: usa meta customizada do mês se houver, senão proporcional
    const currentMonth = todayStr.slice(0, 7);
    const metasDoMes = metasBarbeiros[currentMonth] || {};
    const metaGlobal = metasHistorico.find(m => m.month === currentMonth)?.target || 150000;

    let minhaMeta = metasDoMes[user.barberId!];
    if (minhaMeta == null) {
      // Fallback: proporcional à comissão
      const ativos = (profissionais || []).filter((p: any) => p.ativo !== false);
      const totalComm = ativos.reduce((s: number, p: any) => s + (Number(p.comissao || p.percentualComissao || 40)), 0) || 1;
      const minhaComm = Number(prof?.comissao || prof?.percentualComissao || 40);
      minhaMeta = (minhaComm / totalComm) * metaGlobal;
    }

    // D3 (v42.5): mês com ranking CSV → faturamento/clientes/comissão do barbeiro
    // vêm do ranking (definitivo), reusando montarEquipeDeRanking. Dia/semana
    // seguem ao vivo (intradiário). Sem ranking → tudo ao vivo, como antes.
    let minhaComissao: number | null = null;
    let fonteMes: "ranking-csv" | "ao-vivo" = "ao-vivo";
    try {
      const rankEquipe = await montarEquipeDeRanking(currentMonth, await getAllMetas());
      const meu = rankEquipe?.byId.get(String(user.barberId));
      if (meu) {
        mesFat = meu.faturamento.total;
        mesCli = meu.atendimentos.total;
        minhaComissao = meu.comissaoServicos;
        fonteMes = "ranking-csv";
      }
    } catch { /* sem ranking → mantém ao vivo */ }

    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dayOfMonth = today.getDate();
    const remainingDays = Math.max(1, daysInMonth - dayOfMonth + 1);
    const restaFaturar = Math.max(0, minhaMeta - mesFat);
    const dailyNeeded = restaFaturar / remainingDays;

    return res.json({
      barberId: user.barberId,
      nome: user.nome,
      profissional: prof ? { nome: prof.nome, comissao: prof.comissao || prof.percentualComissao } : null,
      meta: minhaMeta,
      faturamento: { dia: diaFat, semana: semanaFat, mes: mesFat },
      clientes: { dia: diaCli, semana: semanaCli, mes: mesCli },
      comissaoMes: minhaComissao,   // D3: comissão do mês (ranking×categoria) ou null se ao vivo
      fonteMes,                     // 'ranking-csv' (definitivo) | 'ao-vivo' (provisório)
      restaFaturar,
      dailyNeeded,
      remainingDays,
      daysInMonth,
      dayOfMonth,
      proximosHoje,
      mes: currentMonth,
      dataSync: syncCache?.syncedAt || null,
    });
  });

  // GET /api/trinks/config — Load saved credentials ────
  app.get("/api/trinks/config", (_req: Request, res: Response) => {
    if (trinksConfig) {
      const masked = trinksConfig.apiKey.length > 8
        ? trinksConfig.apiKey.slice(0, 4) + "****" + trinksConfig.apiKey.slice(-4)
        : "****";
      return res.json({
        ok: true,
        hasConfig: true,
        maskedKey: masked,
        establishmentId: trinksConfig.establishmentId,
      });
    }
    return res.json({ ok: true, hasConfig: false });
  });

  // ─── POST /api/trinks/config — Save credentials ────────
  app.post("/api/trinks/config", (req: Request, res: Response) => {
    const { apiKey, establishmentId } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: "API Key é obrigatória." });
    }
    saveTrinksConfig({ apiKey, establishmentId: establishmentId || "" });
    // Invalidate all caches when credentials change
    invalidateCache();
    return res.json({ ok: true });
  });

  // ─── GET /api/trinks/test — Test connection (1 API call) ─
  app.get("/api/trinks/test", async (_req: Request, res: Response) => {
    try {
      const data = await trinksFetch("estabelecimentos", undefined, { skipEstabHeader: true });
      return res.json({ ok: true, data });
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/debug — Debug: testa qualquer endpoint arbitrário via query ?path=
  // Exemplo: /api/trinks/debug?path=produtos
  // Passar &bypass=1 faz a chamada ignorando o rate limiter mensal (uso pontual)
  app.get("/api/trinks/debug", async (req: Request, res: Response) => {
    try {
      const path = String(req.query.path || "").replace(/^\/+/, "");
      if (!path) return res.status(400).json({ ok: false, error: "query param 'path' obrigatório" });
      const bypass = String(req.query.bypass || "") === "1";
      const queryParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) {
        if (k === "path" || k === "bypass") continue;
        if (typeof v === "string") queryParams[k] = v;
      }

      if (bypass) {
        // Chamada direta à Trinks sem passar pelo trinksFetch (sem contar no limite mensal)
        if (!trinksConfig) return res.status(400).json({ ok: false, error: "TRINKS não configurado" });
        const url = new URL(`/v1/${path}`, "https://api.trinks.com");
        for (const [k, v] of Object.entries(queryParams)) url.searchParams.append(k, v);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Api-Key": trinksConfig.apiKey,
        };
        if (trinksConfig.establishmentId) headers["estabelecimentoId"] = trinksConfig.establishmentId;
        const r = await fetch(url.toString(), { method: "GET", headers });
        const text = await r.text();
        let body: any = text;
        try { body = JSON.parse(text); } catch {}
        return res.json({ ok: r.ok, path, status: r.status, data: body });
      }

      const data = await trinksFetch(path, queryParams);
      return res.json({ ok: true, path, data });
    } catch (err: any) {
      return res.status(200).json({ ok: false, path: String(req.query.path || ""), error: err?.message || String(err), status: err?.status });
    }
  });

  // ─── GET /api/trinks/rate-status — consulta contador mensal/minuto
  app.get("/api/trinks/rate-status", (_req: Request, res: Response) => {
    return res.json({
      monthKey: rateLimiter.monthKey,
      requestsThisMonth: rateLimiter.requestsThisMonth,
      maxPerMonth: MAX_REQUESTS_PER_MONTH,
      requestsThisMinute: rateLimiter.requestsThisMinute,
      maxPerMinute: MAX_REQUESTS_PER_MINUTE,
      totalRequestsSession: rateLimiter.totalRequestsSession,
    });
  });

  // ─── GET /api/trinks/contador — v54: widget do Dashboard.
  // Consumo REAL da Trinks (auditoria persistente): hoje e mês, com 429.
  // Honesto: mostra chamadas OK e recusadas (429) — o limite real é da conta Trinks.
  app.get("/api/trinks/contador", async (_req: Request, res: Response) => {
    try {
      const hojeBuckets = await lerUltimosDias(1);
      const h = hojeBuckets[hojeBuckets.length - 1] || { total: 0, ok: 0, rate429: 0, erros: 0 };
      const mes = await resumoUltimosDias(31);
      const trinks429Agora = circuitOpenUntil > Date.now();
      const cota = await getTrinksCota();
      const fatiaMensal = cota.fatiaEfetiva; // base + tokens comprados no mês
      return res.json({
        ok: true,
        hoje: { ok: h.ok, rate429: h.rate429, erros: h.erros, total: h.total },
        mes: { ok: mes.totais.ok, rate429: mes.totais.rate429, erros: mes.totais.erros, total: mes.totais.total },
        trinks429Agora,
        // Fatia mensal CONFIGURÁVEL do Greco Control (base + tokens comprados).
        // Consumo real = total de requisições do mês (auditoria persistente).
        fatiaMensal,
        fatiaBase: cota.fatiaBase,
        tokensComprados: cota.extras,
        consumoMes: mes.totais.total,
        fatiaEstourada: mes.totais.total > fatiaMensal,
        // contador interno (nossa contagem em memória) — referência secundária
        sessao: { requestsThisMonth: rateLimiter.requestsThisMonth, maxPerMonth: MAX_REQUESTS_PER_MONTH },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // ─── Cota Trinks CONFIGURÁVEL (fatia base + tokens comprados) ───
  app.get("/api/trinks/cota", async (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, ...(await getTrinksCota()) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });
  app.post("/api/trinks/cota", async (req: Request, res: Response) => {
    try {
      const admin = getUserFromToken(extractToken(req));
      if (!admin || admin.role !== "admin") return res.status(403).json({ ok: false, error: "Acesso negado." });
      const { fatiaBase } = req.body || {};
      if (fatiaBase != null) await setFatiaBase(Number(fatiaBase));
      return res.json({ ok: true, ...(await getTrinksCota()) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });
  app.post("/api/trinks/cota/comprar", async (req: Request, res: Response) => {
    try {
      const admin = getUserFromToken(extractToken(req));
      if (!admin || admin.role !== "admin") return res.status(403).json({ ok: false, error: "Acesso negado." });
      const qtd = Number((req.body || {}).quantidade);
      if (!qtd || qtd <= 0) return res.status(400).json({ ok: false, error: "Quantidade inválida." });
      await comprarTokens(qtd);
      return res.json({ ok: true, ...(await getTrinksCota()) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // POST /api/trinks/reset-monthly — zera o contador mensal Trinks em memória.
  // Útil quando o contador estourou (4500/4500) mas o mês real ainda não virou.
  // Também permite "liberar" se você importou todos os CSVs e quer voltar a usar Trinks.
  app.post("/api/trinks/reset-monthly", async (_req: Request, res: Response) => {
    const antes = rateLimiter.requestsThisMonth;
    rateLimiter.requestsThisMonth = 0;
    rateLimiter.requestsThisMinute = 0;
    rateLimiter.minuteStart = Date.now();
    // Atualiza cache em disco também (sobrevive a 1 restart)
    try { saveMonthlyCounter(); } catch {}
    log(`[trinks] contador mensal resetado manualmente: era ${antes}, agora 0`, "trinks");
    return res.json({
      ok: true,
      antes,
      agora: rateLimiter.requestsThisMonth,
      monthKey: rateLimiter.monthKey,
      maxPerMonth: MAX_REQUESTS_PER_MONTH,
    });
  });

  // GET /api/trinks/audit — auditoria persistente do consumo Trinks
  // Conta cada chamada real à rede (ok, 429, erro), agrupada por dia/hora/endpoint/origem.
  // Persiste em kv_store (Postgres Railway) — sobrevive a deploys, diferente do contador em memória.
  app.get("/api/trinks/audit", async (req: Request, res: Response) => {
    try {
      const dias = Math.max(1, Math.min(180, parseInt(String(req.query.dias || "30"), 10) || 30));
      const resumo = await resumoUltimosDias(dias);
      return res.json({
        ok: true,
        ...resumo,
        // Dados auxiliares pro UI
        rateLimiterEmMemoria: {
          monthKey: rateLimiter.monthKey,
          requestsThisMonth: rateLimiter.requestsThisMonth,
          maxPerMonth: MAX_REQUESTS_PER_MONTH,
          totalRequestsSession: rateLimiter.totalRequestsSession,
          uptimeSec: Math.round(process.uptime()),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "falha" });
    }
  });

  // GET /api/version — identifica qual código está rodando em produção
  app.get("/api/version", (_req: Request, res: Response) => {
    return res.json({
      build: "2026-06-27-ontem-via-trinks-email",
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TRINKS CSV IMPORT (v33) — agendamentos enviados por email pela Trinks
  // (atendimento@trinks.com). Importação automática via Apps Script no Gmail
  // ou upload manual via UI. Reduz uso de tokens da API Trinks.
  // ════════════════════════════════════════════════════════════════════════

  /** Helper: valida token de auth dos imports automáticos (Apps Script).
   *  - Em produção, exige header X-Csv-Token === env TRINKS_CSV_TOKEN
   *  - Sem env configurado: aceita qualquer (modo dev) */
  function checkCsvImportAuth(req: Request): { ok: boolean; reason?: string } {
    const expected = process.env.TRINKS_CSV_TOKEN || "";
    if (!expected) return { ok: true }; // dev mode
    const got = String(req.headers["x-csv-token"] || req.query.token || "");
    if (got !== expected) return { ok: false, reason: "token inválido" };
    return { ok: true };
  }

  // POST /api/trinks-csv/agendamentos — recebe CSV (multipart 'file' OU raw text body)
  // e parseia / persiste. Header obrigatório: X-Csv-Token quando env definido.
  app.post(
    "/api/trinks-csv/agendamentos",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const auth = checkCsvImportAuth(req);
        if (!auth.ok) return res.status(401).json({ ok: false, error: auth.reason });

        let buf: Buffer | null = null;
        if (req.file?.buffer) {
          buf = req.file.buffer;
        } else if (req.body) {
          // Apps Script manda como body raw (text/plain ou base64)
          if (typeof req.body === "string") {
            buf = Buffer.from(req.body, "utf-8");
          } else if (req.body.csvBase64) {
            buf = Buffer.from(String(req.body.csvBase64), "base64");
          } else if (req.body.csv) {
            buf = Buffer.from(String(req.body.csv), "utf-8");
          }
        }
        if (!buf || buf.length === 0) {
          return res.status(400).json({ ok: false, error: "Nenhum CSV recebido (envie 'file' multipart ou body com 'csvBase64')" });
        }

        const remetente = String(req.body?.from || req.headers["x-email-from"] || "");
        const parsed = parseCsvAgendamentos(buf);
        if (remetente) (parsed as any).origemEmail = remetente;

        const stats = await salvarImportAgendamentos(parsed);
        log(`csv-import/agendamentos: csv=${parsed.totalLinhas} linhas → +${stats.novos} novos / ~${stats.atualizados} atualizados / -${stats.removidos} removidos / total acumulado=${stats.totalAcumulado}`, "csv");

        return res.json({
          ok: true,
          totalLinhasCsv: parsed.totalLinhas,
          novos: stats.novos,
          atualizados: stats.atualizados,
          removidos: stats.removidos,
          totalAcumulado: stats.totalAcumulado,
          // mantém compat com versão anterior do Apps Script
          totalLinhas: stats.totalAcumulado,
          confirmados: parsed.totalConfirmados,
          cancelados: parsed.totalCancelados,
          finalizados: parsed.totalFinalizados,
          dataInicio: parsed.dataInicio,
          dataFim: parsed.dataFim,
          geradoEm: parsed.geradoEm,
        });
      } catch (err: any) {
        log(`csv-import/agendamentos ERROR: ${err.message}`, "csv");
        return res.status(500).json({ ok: false, error: err.message });
      }
    },
  );

  // GET /api/trinks-csv/agendamentos/status — metadata do último import
  app.get("/api/trinks-csv/agendamentos/status", async (_req: Request, res: Response) => {
    try {
      const last = await getUltimoImportAgendamentos();
      if (!last) return res.json({ ok: true, importado: false });
      const ageMs = Date.now() - new Date(last.geradoEm).getTime();
      const ageHoras = Math.round(ageMs / (1000 * 60 * 60));
      return res.json({
        ok: true,
        importado: true,
        geradoEm: last.geradoEm,
        ageHoras,
        ageFresco: ageHoras <= 24,
        totalLinhas: last.totalLinhas,
        confirmados: last.totalConfirmados,
        cancelados: last.totalCancelados,
        finalizados: last.totalFinalizados,
        dataInicio: last.dataInicio,
        dataFim: last.dataFim,
        origemEmail: (last as any).origemEmail || null,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/trinks-csv/agendamentos — apaga tudo (reset). Usado pra
  // limpar histórico antes de reimportar tudo do zero. Protegido por token.
  app.delete("/api/trinks-csv/agendamentos", async (req: Request, res: Response) => {
    try {
      const auth = checkCsvImportAuth(req);
      if (!auth.ok) return res.status(401).json({ ok: false, error: auth.reason });
      await resetImportAgendamentos();
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/trinks-csv/agendamentos/lista — devolve a lista de agendamentos
  // do último import (compatível com o formato consumido pelos endpoints da UI)
  app.get("/api/trinks-csv/agendamentos/lista", async (_req: Request, res: Response) => {
    try {
      const last = await getUltimoImportAgendamentos();
      if (!last) return res.json({ ok: true, agendamentos: [], totalLinhas: 0 });
      return res.json({
        ok: true,
        agendamentos: last.agendamentos,
        totalLinhas: last.totalLinhas,
        geradoEm: last.geradoEm,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // PROFISSIONAIS CONHECIDOS (v38) — dicionário manual id → nome
  // Pra resolver IDs órfãos que aparecem nas transações Trinks (ex: 644414)
  // que não estão na lista oficial /profissionais (geralmente IDs legados de
  // profissionais antigos que saíram). Usuário cadastra manualmente o nome.
  // ════════════════════════════════════════════════════════════════════════
  const KV_PROFS_CONHECIDOS = "profissionais_conhecidos";
  const KV_PROFS_INATIVOS = "profissionais_inativos";

  async function getProfsConhecidos(): Promise<Record<string, string>> {
    return (await kvGet<Record<string, string>>(KV_PROFS_CONHECIDOS)) || {};
  }

  // Lista de IDs inativos — saíram da equipe mas têm histórico no sistema.
  // Mantemos o nome no dicionário pra dados antigos não virar "Profissional XXX",
  // mas excluímos do ranking de Equipe.
  async function getProfsInativos(): Promise<Set<string>> {
    const lista = (await kvGet<string[]>(KV_PROFS_INATIVOS)) || [];
    return new Set(lista.map(String));
  }
  async function setProfsInativos(ids: string[]): Promise<void> {
    await kvSet(KV_PROFS_INATIVOS, Array.from(new Set(ids.map(String))));
  }

  // GET /api/profissionais-conhecidos — lista o dicionário
  app.get("/api/profissionais-conhecidos", async (_req: Request, res: Response) => {
    try {
      const m = await getProfsConhecidos();
      return res.json({ ok: true, total: Object.keys(m).length, profissionais: m });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/profissionais-conhecidos — cadastra/atualiza um id → nome
  // body: { id: "644414", nome: "Fulano da Silva" }
  app.post("/api/profissionais-conhecidos", async (req: Request, res: Response) => {
    try {
      const id = String((req.body || {}).id || "").trim();
      const nome = String((req.body || {}).nome || "").trim();
      if (!id || !nome) return res.status(400).json({ ok: false, error: "id e nome obrigatórios" });
      const atual = await getProfsConhecidos();
      atual[id] = nome;
      await kvSet(KV_PROFS_CONHECIDOS, atual);
      log(`profs-conhecidos: ${id} → ${nome}`, "config");
      return res.json({ ok: true, id, nome });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/profissionais-conhecidos/:id
  app.delete("/api/profissionais-conhecidos/:id", async (req: Request, res: Response) => {
    try {
      const atual = await getProfsConhecidos();
      delete atual[String(req.params.id)];
      await kvSet(KV_PROFS_CONHECIDOS, atual);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/profissionais-inativos — lista IDs marcados como ex-funcionários
  app.get("/api/profissionais-inativos", async (_req: Request, res: Response) => {
    try {
      const set = await getProfsInativos();
      return res.json({ ok: true, total: set.size, ids: Array.from(set) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  // POST /api/profissionais-inativos { id }  → marca como inativo
  app.post("/api/profissionais-inativos", async (req: Request, res: Response) => {
    try {
      const id = String((req.body || {}).id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "id obrigatório" });
      const atual = await getProfsInativos();
      atual.add(id);
      await setProfsInativos(Array.from(atual));
      invalidateCache("equipe-desempenho-completo");
      return res.json({ ok: true, id });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  // DELETE /api/profissionais-inativos/:id → reativa
  app.delete("/api/profissionais-inativos/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const atual = await getProfsInativos();
      atual.delete(id);
      await setProfsInativos(Array.from(atual));
      invalidateCache("equipe-desempenho-completo");
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // SNAPSHOT DIÁRIO (v36) — Cérebro de Dados
  // Captura fotografia persistente do dia, em cascata Trinks→CSV→CSV-financeiro.
  // Snapshot é fonte da verdade pra endpoints históricos. Trinks pode sumir
  // que os dados já capturados ficam preservados.
  // ════════════════════════════════════════════════════════════════════════

  /** Tenta capturar o snapshot de UM dia. Cascata: Trinks → CSV agendamentos → vazio.
   *  Sempre salva o resultado (mesmo vazio) — exceto quando "vazio" e já existe
   *  snapshot anterior com dados (aí preserva o anterior). */
  async function capturarSnapshotDia(data: string, opts: { preferirCsv?: boolean } = {}): Promise<SnapshotDia> {
    const avisos: string[] = [];
    const transFim = ymdAddDays(data, 1);

    // ─── Guard: snapshot fonte=trinks-email é verdade absoluta (vem do e-mail oficial) ───
    // Não sobrescreve com CSV de agendamentos / API — esses subestimam (só serviços agendados).
    const existente = await getSnapshot(data);
    if (existente && existente.fonte === "trinks-email") {
      return existente;
    }

    // ─── Tentativa 1: API Trinks (a menos que preferirCsv) ───
    if (!opts.preferirCsv) {
      try {
        const trans: any = await trinksFetchAll("transacoes", { dataInicio: data, dataFim: transFim });
        const arr: any[] = Array.isArray(trans) ? trans : (trans?.data || []);
        if (arr.length > 0) {
          let total = 0, pix = 0, cartao = 0, dinheiro = 0, plano = 0, voucher = 0, outros = 0;
          for (const t of arr) {
            total += Number(t.totalPagar || 0);
            for (const fp of (t.formasPagamentos || [])) {
              const v = Number(fp.valor || 0);
              const bucket = classificarFormaPagamento(fp.nome || "");
              if (bucket === "pix") pix += v;
              else if (bucket === "cartao") cartao += v;
              else if (bucket === "dinheiro") dinheiro += v;
              else if (bucket === "plano") plano += v;
              else if (bucket === "voucher") voucher += v;
              else outros += v;
            }
          }
          const snap: SnapshotDia = {
            data, fonte: "trinks-api",
            capturadoEm: new Date().toISOString(),
            faturamento: { total, pix, cartao, dinheiro, plano, voucher, outros, qtdTransacoes: arr.length },
            agendamentos: { finalizados: 0, confirmados: 0, cancelados: 0, noShow: 0 },
            transacoesIds: arr.map((t: any) => String(t.id || "")).filter(Boolean),
            transacoesRaw: arr, // v36 F3: guarda raw pra reprocessar (ranking, comissões, etc)
          };
          await saveSnapshot(snap);
          return snap;
        }
        avisos.push("Trinks /transacoes retornou vazio");
      } catch (err: any) {
        avisos.push(`Trinks /transacoes falhou: ${err?.message || err}`);
      }
    }

    const mesData = data.slice(0, 7);

    // ─── Tentativa 2 (v39, MAIS PRECISA): CSV CAIXA por comanda ───
    // Tem breakdown completo de forma de pagamento (crédito/débito/dinheiro/
    // pré-pago) + serviço vs produto separados — fonte ideal pra fechar dia.
    try {
      const caixaPayload: any = await kvGet(trinksImport.kvKeyFor("caixa", mesData));
      if (caixaPayload?.rows && Array.isArray(caixaPayload.rows)) {
        const rowsDia = caixaPayload.rows.filter((r: any) => (r.data || "").startsWith(data));
        if (rowsDia.length > 0) {
          let total = 0, cartao = 0, dinheiro = 0, plano = 0, outros = 0;
          for (const r of rowsDia) {
            total += Number(r.totalGeral || 0);
            cartao += Number(r.totalCredito || 0) + Number(r.totalDebito || 0);
            dinheiro += Number(r.totalDinheiro || 0);
            plano += Number(r.totalPrePago || 0);
            outros += Number(r.totalOutros || 0);
          }
          const snap: SnapshotDia = {
            data, fonte: "csv-financeiro", // mantém compat de UI
            capturadoEm: new Date().toISOString(),
            faturamento: {
              total, pix: 0, cartao, dinheiro, plano, voucher: 0, outros,
              qtdTransacoes: rowsDia.length,
            },
            agendamentos: { finalizados: rowsDia.length, confirmados: 0, cancelados: 0, noShow: 0 },
            transacoesRaw: rowsDia.map((r: any) => ({
              dataHora: r.data, cliente: { id: r.clienteId, nome: r.clienteNome },
              totalPagar: r.totalGeral,
              formasPagamentos: [
                ...(r.totalCredito > 0 ? [{ nome: "Cartão de Crédito", valor: r.totalCredito }] : []),
                ...(r.totalDebito > 0 ? [{ nome: "Cartão de Débito", valor: r.totalDebito }] : []),
                ...(r.totalDinheiro > 0 ? [{ nome: "Dinheiro", valor: r.totalDinheiro }] : []),
                ...(r.totalPrePago > 0 ? [{ nome: "Pré-Pago", valor: r.totalPrePago }] : []),
                ...(r.totalOutros > 0 ? [{ nome: "Outros", valor: r.totalOutros }] : []),
              ],
            })),
            avisos: [`Fonte: trinks_import:caixa:${mesData} (${caixaPayload.rows.length} comandas no mês, ${rowsDia.length} nesta data)`],
          };
          await saveSnapshot(snap);
          return snap;
        }
      }
    } catch (err: any) {
      avisos.push(`csv-caixa falhou: ${err?.message || err}`);
    }

    // ─── Tentativa 3 (CSV financeiro formato antigo) ───
    try {
      const finPayload: any = await kvGet(trinksImport.kvKeyFor("financeiro", mesData));
      if (finPayload?.rows && Array.isArray(finPayload.rows) && finPayload.rows.length > 0) {
        const rowsDia = finPayload.rows.filter((r: any) => (r.data || "").startsWith(data));
        if (rowsDia.length > 0) {
          let total = 0, pix = 0, cartao = 0, dinheiro = 0, plano = 0, voucher = 0, outros = 0;
          for (const r of rowsDia) {
            const v = Number(r.valorReceber || r.valorPago || 0);
            total += v;
            const bucket = classificarFormaPagamento(r.formaPagamento || r.tipoFormaPagamento || "");
            if (bucket === "pix") pix += v;
            else if (bucket === "cartao") cartao += v;
            else if (bucket === "dinheiro") dinheiro += v;
            else if (bucket === "plano") plano += v;
            else if (bucket === "voucher") voucher += v;
            else outros += v;
          }
          // v37.2: ENRIQUECE row do CSV financeiro com servicos[].idProfissional
          // derivado do CSV de agendamentos. Sem isso, calcularPeriodoPorProfissional
          // não conseguia atribuir valor a profissional (ranking ficava zerado).
          let agendamentosRaw: any[] = [];
          let comissoesPorProf: Record<string, any> = {};
          let rowsEnriquecidas: any[] = rowsDia;
          try {
            const csv = await getAgendamentosCsvFreshOrNull(72);
            if (csv) {
              const agendDia = csv.filter(a => (a.dataHoraInicio || "").startsWith(data));
              agendamentosRaw = agendDia;
              // Index agendamentos por cliente (lower-trim) → profissional+valor
              const norm = (s: string) => String(s || "").toLowerCase().trim();
              const idxCliente = new Map<string, { profId: string; profNome: string; valor: number; servicoNome: string }>();
              for (const a of agendDia) {
                const status = (a.status?.nome || "").toLowerCase();
                if (status.includes("cancel")) continue;
                const nomeCli = norm(a.cliente?.nome || "");
                if (!nomeCli) continue;
                if (!idxCliente.has(nomeCli)) {
                  idxCliente.set(nomeCli, {
                    profId: a.profissional?.id || "?",
                    profNome: a.profissional?.nome || "?",
                    valor: a.valor || 0,
                    servicoNome: a.servico?.nome || "",
                  });
                }
              }
              // Enriquecer cada row do CSV financeiro com servicos[]+profissional.
              // calcularPeriodoPorProfissional lê servicos[].idProfissionalQueRealizouServico.
              rowsEnriquecidas = rowsDia.map((r: any) => {
                const nomeCli = norm(r.cliente);
                const match = idxCliente.get(nomeCli);
                if (match) {
                  return {
                    ...r,
                    dataHora: r.data, // alias pra função
                    cliente: { nome: r.cliente },
                    servicos: [{
                      idProfissionalQueRealizouServico: match.profId,
                      preco: Number(r.valorReceber || 0),
                      valor: Number(r.valorReceber || 0),
                      nome: match.servicoNome,
                    }],
                    formasPagamentos: [{ nome: r.formaPagamento || "outros", valor: Number(r.valorReceber || 0) }],
                  };
                }
                return r;
              });
              // Agrega por profissional usando agendamentos do CSV (não-cancelados)
              for (const a of agendDia) {
                const status = (a.status?.nome || "").toLowerCase();
                if (status.includes("cancel")) continue;
                const profNome = a.profissional?.nome || "?";
                const profId = a.profissional?.id || "?";
                if (!comissoesPorProf[profId]) {
                  comissoesPorProf[profId] = {
                    nome: profNome, servicosLiquido: 0, produtosLiquido: 0,
                    planoReais: 0, qtdAtendimentos: 0,
                  };
                }
                comissoesPorProf[profId].servicosLiquido += (a.valor || 0);
                comissoesPorProf[profId].qtdAtendimentos += 1;
              }
            }
          } catch { /* sem enriquecimento, segue */ }

          const snap: SnapshotDia = {
            data, fonte: "csv-financeiro",
            capturadoEm: new Date().toISOString(),
            faturamento: { total, pix, cartao, dinheiro, plano, voucher, outros, qtdTransacoes: rowsDia.length },
            agendamentos: { finalizados: rowsDia.length, confirmados: agendamentosRaw.length, cancelados: 0, noShow: 0 },
            transacoesRaw: rowsEnriquecidas,
            agendamentosRaw,
            comissoesPorProf: Object.keys(comissoesPorProf).length > 0 ? comissoesPorProf : undefined,
            avisos: [`Fonte: trinks_import:financeiro:${mesData} (${finPayload.rows.length} rows no mês, ${rowsDia.length} nesta data); enriquecimento prof: ${agendamentosRaw.length} agendamentos`],
          };
          await saveSnapshot(snap);
          return snap;
        }
      }
    } catch (err: any) {
      avisos.push(`csv-financeiro falhou: ${err?.message || err}`);
    }

    // ─── Tentativa 3: CSV de agendamentos (do email) ───
    const csv = await getAgendamentosCsvFreshOrNull(72); // tolera até 3 dias
    if (csv && csv.length > 0) {
      const doDia = csv.filter(a => (a.dataHoraInicio || "").startsWith(data));
      if (doDia.length > 0) {
        let total = 0, qtdTrans = 0;
        let finalizados = 0, confirmados = 0, cancelados = 0;
        for (const a of doDia) {
          const status = (a.status?.nome || "").toLowerCase();
          if (status.includes("cancel")) { cancelados++; continue; }
          if (status.includes("finaliz")) { finalizados++; total += a.valor || 0; qtdTrans++; }
          else if (status.includes("confirm")) {
            confirmados++;
            // Confirmados PASSADOS (data <= hoje SP) contam como receita realizada
            const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
            if (data <= hoje) { total += a.valor || 0; qtdTrans++; }
          }
        }
        const snap: SnapshotDia = {
          data, fonte: "csv-agendamentos",
          capturadoEm: new Date().toISOString(),
          faturamento: { total, pix: 0, cartao: 0, dinheiro: 0, plano: 0, voucher: 0, outros: total, qtdTransacoes: qtdTrans },
          agendamentos: { finalizados, confirmados, cancelados, noShow: 0 },
          agendamentosIds: doDia.map(a => a.id),
          agendamentosRaw: doDia, // v36 F3: lista bruta pra reusar em comissões/ranking
          avisos: ["CSV não distingue meio de pagamento — total em 'outros'."],
        };
        await saveSnapshot(snap);
        return snap;
      }
      avisos.push(`CSV de agendamentos não tem linhas para ${data}`);
    } else {
      avisos.push("Sem CSV de agendamentos fresco (≤72h)");
    }

    // ─── Nenhuma fonte: preserva snapshot anterior se houver ───
    const anterior = await getSnapshot(data);
    if (anterior) {
      avisos.push("Nenhuma fonte nova disponível — mantendo snapshot anterior.");
      return { ...anterior, avisos: [...(anterior.avisos || []), ...avisos] };
    }
    const vazio = snapshotVazio(data);
    vazio.avisos = avisos;
    await saveSnapshot(vazio);
    return vazio;
  }

  // POST /api/snapshot-dia/capturar/:data
  app.post("/api/snapshot-dia/capturar/:data", async (req: Request, res: Response) => {
    try {
      const data = String(req.params.data);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ ok: false, error: "data inválida YYYY-MM-DD" });
      const preferirCsv = String(req.query.preferirCsv || "") === "true";
      const snap = await capturarSnapshotDia(data, { preferirCsv });
      return res.json({ ok: true, snapshot: snap });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/snapshot-dia/capturar-mes/:mes — captura todos os dias do mês em sequência
  app.post("/api/snapshot-dia/capturar-mes/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido YYYY-MM" });
      const preferirCsv = String(req.query.preferirCsv || "") === "true";
      const [y, m] = mes.split("-").map(Number);
      const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const ultimoDia = new Date(y, m, 0).getDate();
      const resultados: Array<{ data: string; fonte: FonteSnapshot; total: number }> = [];
      for (let d = 1; d <= ultimoDia; d++) {
        const dataStr = `${mes}-${String(d).padStart(2, "0")}`;
        if (dataStr > hojeStr) break; // não captura futuro
        const snap = await capturarSnapshotDia(dataStr, { preferirCsv });
        resultados.push({ data: dataStr, fonte: snap.fonte, total: snap.faturamento.total });
      }
      const totalMes = resultados.reduce((s, r) => s + r.total, 0);
      return res.json({ ok: true, mes, resultados, totalMes });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/snapshot-dia/set-mes-oficial
  // Body: { "mes": "2026-06", "dataReferencia": "2026-06-25", "total": 74458.65 }
  // Grava o acumulado mensal oficial Trinks (vindo do campo "Total Junho/2026" do e-mail).
  // O helper de acumulado vai usar ESSE valor como base e somar só dias APOS dataReferencia.
  app.post("/api/snapshot-dia/set-mes-oficial", async (req: Request, res: Response) => {
    try {
      const { mes, dataReferencia, total } = (req.body || {}) as { mes?: string; dataReferencia?: string; total?: number };
      if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido YYYY-MM" });
      if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) return res.status(400).json({ ok: false, error: "dataReferencia inválida" });
      if (typeof total !== "number" || !Number.isFinite(total)) return res.status(400).json({ ok: false, error: "total inválido" });
      await kvSet(`trinks_mes_oficial:${mes}`, { dataReferencia, totalAcumulado: total, gravadoEm: new Date().toISOString() });
      return res.json({ ok: true, mes, dataReferencia, total });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/snapshot-dia/mes-oficial/:mes
  app.get("/api/snapshot-dia/mes-oficial/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido YYYY-MM" });
      const dados = await kvGet<{ dataReferencia: string; totalAcumulado: number; gravadoEm: string }>(`trinks_mes_oficial:${mes}`);
      return res.json({ ok: true, mes, dados });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/snapshot-dia/backfill-trinks-email
  // Body: { "2026-06-25": 3790.00, "2026-06-24": 4813.00, ... }
  // Grava cada par como snapshot fonte="trinks-email" (verdade oficial Trinks).
  // Substitui qualquer snapshot existente (csv-agendamentos, vazio, etc).
  app.post("/api/snapshot-dia/backfill-trinks-email", async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, number>;
      const entries = Object.entries(body);
      if (entries.length === 0) {
        return res.status(400).json({ ok: false, error: "body vazio. Envie { 'YYYY-MM-DD': valor, ... }" });
      }
      const gravados: Array<{ data: string; total: number }> = [];
      for (const [data, totalRaw] of entries) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
        const total = Number(totalRaw);
        if (!Number.isFinite(total) || total < 0) continue;
        const anterior = await getSnapshot(data);
        const snap: SnapshotDia = {
          data,
          fonte: "trinks-email",
          capturadoEm: new Date().toISOString(),
          faturamento: {
            total,
            // Sem breakdown detalhado no e-mail — zera. Total é o que importa pro acumulado.
            pix: 0, cartao: 0, dinheiro: 0, plano: 0, voucher: 0, outros: total,
            qtdTransacoes: anterior?.faturamento?.qtdTransacoes || 0,
          },
          agendamentos: anterior?.agendamentos || { finalizados: 0, confirmados: 0, cancelados: 0, noShow: 0 },
          comissoesPorProf: anterior?.comissoesPorProf,
          agendamentosRaw: anterior?.agendamentosRaw,
          avisos: ["Backfill via e-mail Trinks 'Resumo do dia' (Valor Total oficial)."],
        };
        await saveSnapshot(snap);
        gravados.push({ data, total });
      }
      const totalSomado = gravados.reduce((s, g) => s + g.total, 0);
      return res.json({ ok: true, gravados: gravados.length, total: totalSomado, detalhe: gravados });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/trinks-email/sincronizar — lê os e-mails "Resumo do dia" da Trinks
  // (Gmail IMAP) e grava os fechamentos como snapshot oficial. Body opcional: {dias,max}.
  app.post("/api/trinks-email/sincronizar", async (req: Request, res: Response) => {
    try {
      const dias = Number(req.body?.dias) || 7;
      const max = Number(req.body?.max) || 12;
      const r = await sincronizarEmailsTrinks({ dias, max });
      return res.status(r.ok ? 200 : 500).json(r);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/snapshot-dia/:data
  app.get("/api/snapshot-dia/:data", async (req: Request, res: Response) => {
    try {
      const data = String(req.params.data);
      const snap = await getSnapshot(data);
      if (!snap) return res.json({ ok: true, encontrado: false });
      return res.json({ ok: true, encontrado: true, snapshot: snap });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/snapshot-dia/mes/:mes — lista todos os snapshots do mês
  app.get("/api/snapshot-dia/mes/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      const lista = await listSnapshotsDoMes(mes);
      const totalMes = lista.reduce((s, r) => s + r.faturamento.total, 0);
      return res.json({ ok: true, mes, totalSnapshots: lista.length, totalMes, snapshots: lista });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/health/persistencia — diagnóstico de onde os dados estão indo
  app.get("/api/health/persistencia", async (_req: Request, res: Response) => {
    const persistInfo: any = {
      DATA_DIR,
      DATA_DIR_isVolume: DATA_DIR === "/data",
      env_DATA_DIR: process.env.DATA_DIR || null,
      uptimeSec: Math.round(process.uptime()),
      arquivos: {} as Record<string, any>,
      kv: {} as Record<string, any>,
    };
    // Testa cada arquivo persistido em disco
    const ARQUIVOS_DISCO = [
      { nome: "financeiro", path: FINANCEIRO_FILE },
      { nome: "consolidacao_contas", path: CONSOLIDACAO_CONTAS_FILE },
      { nome: "consolidacao_transacoes", path: CONSOLIDACAO_TRANSACOES_FILE },
      { nome: "regras_gastos", path: REGRAS_GASTOS_FILE },
    ];
    for (const a of ARQUIVOS_DISCO) {
      try {
        const stat = fs.statSync(a.path);
        persistInfo.arquivos[a.nome] = {
          existe: true,
          path: a.path,
          tamanhoKB: Math.round(stat.size / 1024),
          modificadoEm: stat.mtime.toISOString(),
        };
      } catch {
        persistInfo.arquivos[a.nome] = { existe: false, path: a.path };
      }
    }
    // KV: contagem por chave
    const KV_CHAVES = [
      "financeiro", "consolidacao_contas", "consolidacao_transacoes", "regras_gastos",
      "metas_profissional", "expense_categorias", "expense_regras", "caixa_diario",
    ];
    for (const k of KV_CHAVES) {
      try {
        const v: any = await kvGet(k);
        if (v == null) {
          persistInfo.kv[k] = { existe: false };
        } else if (Array.isArray(v)) {
          persistInfo.kv[k] = { existe: true, qtd: v.length };
        } else if (typeof v === "object") {
          persistInfo.kv[k] = { existe: true, chaves: Object.keys(v).length };
        } else {
          persistInfo.kv[k] = { existe: true, tipo: typeof v };
        }
      } catch (err: any) {
        persistInfo.kv[k] = { erro: err.message };
      }
    }
    return res.json({ ok: true, ...persistInfo });
  });

  // ============================================================================
  // v25 Etapa 1: IMPORTAÇÃO DE RELATÓRIOS CSV DA TRINKS
  // Permite operar mesmo com a Trinks API em 429.
  // ============================================================================

  type TrinksImportIndex = Record<string, ImportSummary>;
  const TRINKS_IMPORT_INDEX_KEY = "trinks_import:_index";

  async function loadTrinksImportIndex(): Promise<TrinksImportIndex> {
    try {
      const idx = await kvGet<TrinksImportIndex>(TRINKS_IMPORT_INDEX_KEY);
      return idx || {};
    } catch {
      return {};
    }
  }

  async function saveTrinksImportIndex(idx: TrinksImportIndex): Promise<void> {
    await kvSet(TRINKS_IMPORT_INDEX_KEY, idx);
  }

  // POST /api/trinks-import/preview — retorna preview SEM persistir
  app.post("/api/trinks-import/preview", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Arquivo não enviado." });
      let payload: TrinksImportPayload;
      try {
        payload = trinksImport.parseTrinksCsv(req.file.buffer);
      } catch (e: any) {
        return res.status(400).json({
          error: e.message || "Falha ao processar o CSV.",
          arquivo: req.file.originalname,
        });
      }

      const importadoEm = new Date().toISOString();
      const idx = await loadTrinksImportIndex();
      const summaries: Array<ImportSummary & { chave: string; sobrescreve: ImportSummary | null }> = [];

      if (payload.tipo === "ranking") {
        for (const p of payload.periodos) {
          if (!p.mes) continue;
          const s = trinksImport.summarize(payload, importadoEm, p.mes);
          const chave = trinksImport.kvKeyFor("ranking", p.mes);
          summaries.push({ ...s, chave, sobrescreve: idx[chave] || null });
        }
      } else {
        const s = trinksImport.summarize(payload, importadoEm);
        const chave = payload.tipo === "clientes"
          ? trinksImport.clientesKvKey(payload)
          : payload.tipo === "produtos"
          ? "catalogo_produtos"
          : trinksImport.kvKeyFor(payload.tipo, payload.mes);
        summaries.push({ ...s, chave, sobrescreve: idx[chave] || null });
      }

      const previewData: any = { tipo: payload.tipo };
      if (payload.tipo === "financeiro") {
        previewData.mes = payload.mes;
        previewData.periodoInicio = payload.periodoInicio;
        previewData.periodoFim = payload.periodoFim;
        previewData.totalLinhas = payload.totalLinhas;
        previewData.totalValor = payload.totalValor;
        previewData.resumoPorForma = payload.resumoPorForma;
        previewData.amostra = payload.rows.slice(0, 5);
      } else if (payload.tipo === "dre") {
        previewData.mes = payload.mes;
        previewData.totalReceitas = payload.totalReceitas;
        previewData.totalDespesas = payload.totalDespesas;
        previewData.resultadoPeriodo = payload.resultadoPeriodo;
        previewData.receitas = payload.receitas;
        previewData.despesasSubgrupos = payload.despesasSubgrupos;
      } else if (payload.tipo === "ranking") {
        previewData.periodos = payload.periodos.map(p => ({
          mes: p.mes,
          periodoInicio: p.periodoInicio,
          periodoFim: p.periodoFim,
          total: p.total,
          qtdProfissionais: p.profissionais.length,
          top3: p.profissionais.slice(0, 3),
        }));
      } else if (payload.tipo === "clientes") {
        previewData.mes = payload.mes;
        previewData.periodoInicio = payload.periodoInicio;
        previewData.periodoFim = payload.periodoFim;
        previewData.role = trinksImport.clientesEhBase(payload) ? "base" : "mensal";
        previewData.totalClientes = payload.totalClientes;
        previewData.novosNoMes = payload.rows.filter(r => r.novoCliente).length;
        // top 5 por gasto — sem expor contato (email/telefone)
        previewData.top5 = payload.rows
          .slice()
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
          .map(r => ({ nome: r.nome, total: r.total, visitasPeriodo: r.visitasPeriodo }));
      } else if (payload.tipo === "produtos") {
        previewData.totalProdutos = payload.totalProdutos;
        previewData.comCusto = payload.comCusto;
        previewData.semCusto = payload.totalProdutos - payload.comCusto;
        previewData.amostra = payload.produtos.slice(0, 5).map(p => ({ nome: p.nome, preco: p.preco, custo: p.custo, comissaoPct: p.comissaoPct }));
      }

      log(`Trinks import preview: ${req.file.originalname} → ${payload.tipo} (${summaries.length} chave(s))`, "trinks-import");
      return res.json({
        ok: true,
        arquivo: req.file.originalname,
        tamanhoBytes: req.file.size,
        preview: previewData,
        chaves: summaries,
      });
    } catch (err: any) {
      log(`Trinks import preview error: ${err?.message}`, "trinks-import");
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // POST /api/trinks-import/confirm — persiste em kv_store (sobrescreve)
  app.post("/api/trinks-import/confirm", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Arquivo não enviado." });
      let payload: TrinksImportPayload;
      try {
        payload = trinksImport.parseTrinksCsv(req.file.buffer);
      } catch (e: any) {
        return res.status(400).json({ error: e.message || "Falha ao processar o CSV." });
      }

      const importadoEm = new Date().toISOString();
      const idx = await loadTrinksImportIndex();
      const persistidas: ImportSummary[] = [];

      if (payload.tipo === "ranking") {
        for (const p of payload.periodos) {
          if (!p.mes) continue;
          const subPayload = {
            tipo: "ranking" as const,
            geradoEm: payload.geradoEm,
            periodos: [p],
          };
          const chave = trinksImport.kvKeyFor("ranking", p.mes);
          await kvSet(chave, subPayload);
          const s = trinksImport.summarize(payload, importadoEm, p.mes);
          idx[chave] = s;
          persistidas.push(s);
        }
      } else if (payload.tipo === "clientes") {
        const ehBase = trinksImport.clientesEhBase(payload);
        const chave = trinksImport.clientesKvKey(payload);
        await kvSet(chave, payload);
        const s = trinksImport.summarize(payload, importadoEm);
        if (ehBase) {
          // Base de sumidos: não é "do mês"; rotula e tira do mapa mensal.
          s.mes = "";
          s.descricao = `Base de sumidos · ${payload.totalClientes} clientes · ${payload.periodoInicio} → ${payload.periodoFim}`;
        }
        idx[chave] = s;
        persistidas.push(s);
      } else if (payload.tipo === "produtos") {
        // Catálogo não é por mês — chave fixa. Também popula produtos_custos
        // (por NOME, já que o CSV não traz ID Trinks) pra a margem usar o custo.
        const chave = "catalogo_produtos";
        await kvSet(chave, payload);
        const s = trinksImport.summarize(payload, importadoEm);
        s.mes = "";
        idx[chave] = s;
        persistidas.push(s);
      } else {
        const chave = trinksImport.kvKeyFor(payload.tipo, payload.mes);
        await kvSet(chave, payload);
        const s = trinksImport.summarize(payload, importadoEm);
        idx[chave] = s;
        persistidas.push(s);
      }

      await saveTrinksImportIndex(idx);
      // Invalida cache canônico dos meses afetados — auto-reconciliação:
      // próxima leitura via mesService vai recomparar fontes e atualizar.
      for (const p of persistidas) {
        if (p.mes) invalidarMesCacheCanonical(p.mes);
      }
      // D2: limpa o cache do mapa de comissão por ranking (reimport reflete na hora).
      _rankComissaoCache.clear();
      log(`Trinks import confirm: ${req.file.originalname} → ${persistidas.length} chave(s)`, "trinks-import");
      return res.json({ ok: true, importadas: persistidas });
    } catch (err: any) {
      log(`Trinks import confirm error: ${err?.message}`, "trinks-import");
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // GET /api/trinks-import/list — lista importações feitas
  app.get("/api/trinks-import/list", async (_req: Request, res: Response) => {
    try {
      const idx = await loadTrinksImportIndex();
      const items = Object.entries(idx)
        .map(([chave, s]) => ({ chave, ...s }))
        .sort((a, b) => {
          if (a.mes !== b.mes) return b.mes.localeCompare(a.mes);
          return a.tipo.localeCompare(b.tipo);
        });
      return res.json({ ok: true, items });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // GET /api/trinks-import/:tipo/:mes — retorna payload completo
  app.get("/api/trinks-import/:tipo/:mes", async (req: Request, res: Response) => {
    try {
      const tipo = req.params.tipo as TrinksImportType;
      const mes = req.params.mes;
      if (!/^(financeiro|dre|ranking|caixa|clientes)$/.test(tipo)) {
        return res.status(400).json({ error: "Tipo inválido. Use: financeiro | dre | ranking | caixa | clientes." });
      }
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: "Mês inválido. Use formato YYYY-MM." });
      }
      const data = await kvGet<TrinksImportPayload>(trinksImport.kvKeyFor(tipo, mes));
      if (!data) return res.status(404).json({ error: "Importação não encontrada." });
      return res.json({ ok: true, data });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // DELETE /api/trinks-import/:tipo/:mes — remove
  app.delete("/api/trinks-import/:tipo/:mes", async (req: Request, res: Response) => {
    try {
      const tipo = req.params.tipo as TrinksImportType;
      const mes = req.params.mes;
      if (!/^(financeiro|dre|ranking|caixa|clientes)$/.test(tipo) || !/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: "Parâmetros inválidos." });
      }
      const chave = trinksImport.kvKeyFor(tipo, mes);
      await kvSet(chave, null);
      const idx = await loadTrinksImportIndex();
      delete idx[chave];
      await saveTrinksImportIndex(idx);
      log(`Trinks import delete: ${chave}`, "trinks-import");
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // GET /api/clientes/ranking/:mes — agregados de cliente do "Ranking de Clientes"
  // (Fase 2). Papéis separados: cards do mês (novos/recompra/ticket) vêm do export
  // MENSAL (trinks_import:clientes:YYYY-MM); sumidos vêm da BASE de janela longa
  // (trinks_import:clientes:base). Nunca Trinks ao vivo. PRIVACIDADE: sem email/telefone.
  app.get("/api/clientes/ranking/:mes", async (req: Request, res: Response) => {
    try {
      const mes = req.params.mes;
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ ok: false, error: "Mês inválido. Use YYYY-MM." });
      }
      const mensal = await kvGet<any>(trinksImport.kvKeyFor("clientes", mes));
      const base = await kvGet<any>(trinksImport.CLIENTES_BASE_KEY);
      const temMensal = !!(mensal && Array.isArray(mensal.rows));
      const temBase = !!(base && Array.isArray(base.rows));
      if (!temMensal && !temBase) {
        return res.json({ ok: true, vazio: true, mes });
      }

      // Sumidos: último atendimento > 60 dias atrás (TZ America/Sao_Paulo, vs hoje).
      const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const hojeMs = Date.parse(`${hojeSP}T00:00:00Z`);
      const diasDesde = (ymd: string): number | null => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return null;
        return Math.floor((hojeMs - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);
      };

      const resp: any = { ok: true, mes, temMensal, temBase };

      // ── Cards do mês (export mensal) ──
      if (temMensal) {
        const rows: any[] = mensal.rows;
        const totalClientes = rows.length;
        const comRecompra = rows.filter(r => Number(r.visitasPeriodo) > 1).length;
        const somaTotal = rows.reduce((s, r) => s + Number(r.total || 0), 0);
        resp.totalClientes = totalClientes;
        resp.novosNoMes = rows.filter(r => r.novoCliente).length;
        resp.recompraPct = totalClientes > 0 ? Math.round((comRecompra / totalClientes) * 1000) / 10 : 0;
        resp.ticketMedioClientes = totalClientes > 0 ? Math.round((somaTotal / totalClientes) * 100) / 100 : 0;
        resp.geradoEm = mensal.geradoEm || "";
        resp.periodoInicio = mensal.periodoInicio || "";
        resp.periodoFim = mensal.periodoFim || "";
      }

      // ── Sumidos: prefere a base (janela longa); fallback no mensal (≈0). ──
      const fonteSumidos = temBase ? base : (temMensal ? mensal : null);
      if (fonteSumidos) {
        const sumidos = (fonteSumidos.rows as any[])
          .map(r => ({ nome: r.nome, dias: diasDesde(r.ultimoAtendimento) }))
          .filter(x => x.dias !== null && (x.dias as number) > 60) as { nome: string; dias: number }[];
        sumidos.sort((a, b) => a.dias - b.dias); // mais recuperáveis primeiro
        resp.clientesSumidos = {
          total: sumidos.length,
          lista: sumidos.slice(0, 20).map(x => ({ nome: x.nome, diasSemVir: x.dias })),
          fonte: temBase ? "base" : "mensal",
          baseGeradoEm: temBase ? (base.geradoEm || "") : "",
          basePeriodo: temBase ? `${base.periodoInicio} → ${base.periodoFim}` : "",
        };
      }

      return res.json(resp);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // ============================================================================
  // v25 Etapa 3: INTEGRAÇÃO dos imports com dashboards existentes
  // Quando a Trinks API está fora (HTTP 429) consumimos os CSVs persistidos.
  // ============================================================================

  // GET /api/equipe/desempenho-import/:mes
  // Entrega no MESMO formato de /api/equipe/desempenho, porém alimentado pelo
  // ranking importado do mês. Janelas dia/semana ficam zeradas (CSV é mensal).
  // Resposta inclui flag fonte="trinks-import" para a UI mostrar badge.
  app.get("/api/equipe/desempenho-import/:mes", async (req: Request, res: Response) => {
    try {
      const mes = req.params.mes;
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ ok: false, error: "Mês inválido. Use YYYY-MM." });
      }

      const chaveRanking = trinksImport.kvKeyFor("ranking", mes);
      const rankingData = await kvGet<any>(chaveRanking);
      if (!rankingData) {
        return res.status(404).json({ ok: false, error: `Nenhum ranking importado para ${mes}.` });
      }

      const periodo = rankingData?.periodos?.[0];
      if (!periodo) {
        return res.status(404).json({ ok: false, error: `Ranking ${mes} está vazio.` });
      }

      // Mapa nome → profissionalId via metas cadastradas (mesmo padrão usado em
      // calcularPeriodoPorProfissional). Quando não casa, usamos id sintético
      // "import:<nome>" — a tela ainda exibe o profissional.
      const metas = await getAllMetas();
      const nomeParaIdPrimario = new Map<string, string>();
      for (const meta of Object.values(metas)) {
        const norm = (meta.nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        if (norm) nomeParaIdPrimario.set(norm, meta.profissionalId);
      }

      const cfgFin = await getConfigFin().catch(() => null);
      const config = { taxaCartaoPct: (cfgFin as any)?.taxaCartaoPct || 0 };

      const mesData = trinksImport.rankingPeriodoParaResultado(periodo, nomeParaIdPrimario, config);

      // v42: comissão por categoria (apelido antes do hífen × `Total Serviços`).
      // Profissional com `Total Serviços > 0` que não casa com o mapa de
      // categorias NÃO recebe comissão em silêncio — vai pra `semCategoria`
      // (aviso na UI + log) pro Fred cadastrar.
      const normNomeImport = (s: string) =>
        String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
      const comissaoPorNome = new Map<string, { categoria: string | null; pct: number; comissaoServicos: number; totalServicos: number; naoComissionavel: boolean }>();
      const semCategoria: Array<{ nome: string; totalServicos: number }> = [];
      for (const p of (periodo.profissionais || [])) {
        const ts = Number(p.totalServicos || 0);
        const r = comissaoServicosRanking(p.profissional, ts);
        comissaoPorNome.set(normNomeImport(p.profissional), {
          categoria: r.categoria, pct: r.pct, comissaoServicos: r.comissao, totalServicos: ts,
          naoComissionavel: r.naoComissionavel,
        });
        // Banner = só NÃO-MAPEADO (cadastro faltando). Administrativo/não-comissionável
        // (r.mapeado=true, r.naoComissionavel=true) sai daqui de propósito: R$ 0 é intencional.
        if (!r.mapeado && ts > 0) {
          semCategoria.push({ nome: p.profissional, totalServicos: ts });
          log(`[equipe/desempenho-import] ${mes}: "${p.profissional}" sem categoria de comissão (Total Serviços R$ ${ts.toFixed(2)}) — comissão NÃO calculada, cadastrar categoria`, "comissao");
        }
      }

      // dia/semana = vazio (CSV é mensal). Mantemos formato compatível.
      const diaVazio = trinksImport.periodoVazio(periodo.periodoInicio, periodo.periodoInicio);
      const semVazio = trinksImport.periodoVazio(periodo.periodoInicio, periodo.periodoFim);

      // Referência: usa o mês do ranking. dias úteis calculados sobre o intervalo do CSV.
      const ultimoDia = ultimoDiaDoMes(`${mes}-01`);
      const diasUteisTotal = contarDiasUteis(`${mes}-01`, ultimoDia);
      const diasUteisDecorridos = contarDiasUteis(`${mes}-01`, periodo.periodoFim);

      // Posição no mês
      const profsMes = Object.values(mesData.porProfissional).sort((a, b) => b.total.reais - a.total.reais);
      const totalProfsComMov = profsMes.length;
      const posicaoMap = new Map<string, number>();
      profsMes.forEach((p, i) => posicaoMap.set(p.profissionalId, i + 1));

      const idsTodos = new Set<string>([
        ...Object.keys(mesData.porProfissional),
        ...Object.keys(metas),
      ]);

      function calcularMetasProporcionais(meta: { metaReais: number; metaAtendimentos: number } | null) {
        if (!meta || diasUteisTotal === 0) {
          return {
            mes: { reais: meta?.metaReais || 0, atend: meta?.metaAtendimentos || 0 },
            semana: { reais: 0, atend: 0 },
            dia: { reais: 0, atend: 0 },
            diasUteisTotal,
            diasUteisDecorridos,
          };
        }
        const reaisDia = meta.metaReais / diasUteisTotal;
        const atendDia = meta.metaAtendimentos / diasUteisTotal;
        return {
          mes: { reais: meta.metaReais, atend: meta.metaAtendimentos },
          semana: { reais: reaisDia * 5, atend: atendDia * 5 },
          dia: { reais: reaisDia, atend: atendDia },
          diasUteisTotal,
          diasUteisDecorridos,
        };
      }

      function calcularStatus(realizado: { reais: number; count: number }, metaJanela: { reais: number; atend: number }) {
        const temMeta = (metaJanela.reais > 0) || (metaJanela.atend > 0);
        if (!temMeta) {
          return { temMeta: false, percReais: 0, percAtend: 0, bateu: false, farol: "sem-meta" as const };
        }
        const pR = metaJanela.reais > 0 ? (realizado.reais / metaJanela.reais) * 100 : 0;
        const pA = metaJanela.atend > 0 ? (realizado.count / metaJanela.atend) * 100 : 0;
        const bateu = metaJanela.reais > 0 ? pR >= 100 : pA >= 100;
        return { temMeta: true, percReais: Math.round(pR * 10) / 10, percAtend: Math.round(pA * 10) / 10, bateu, farol: (bateu ? "verde" : "vermelho") as "verde" | "vermelho" };
      }

      const z = { reais: 0, count: 0, avulsoReais: 0, avulsoCount: 0, planoReais: 0, planoCount: 0, servicosReais: 0, servicosCount: 0, servicosBruto: 0, servicosLiquido: 0, produtosReais: 0, produtosCount: 0, produtosBruto: 0, produtosLiquido: 0, produtosBrutoComissionavel: 0, produtosLiquidoComissionavel: 0 };
      const mkObj = (p: any) => p ? {
        reais: p.total.reais, count: p.total.count,
        avulsoReais: p.avulso.reais, avulsoCount: p.avulso.count,
        planoReais: p.plano.reais, planoCount: p.plano.count,
        servicosReais: p.servicos.reais, servicosCount: p.servicos.count,
        servicosBruto: p.servicos.bruto, servicosLiquido: p.servicos.liquido,
        produtosReais: p.produtos.reais, produtosCount: p.produtos.count,
        produtosBruto: p.produtos.bruto, produtosLiquido: p.produtos.liquido,
        produtosBrutoComissionavel: p.produtos.brutoComissionavel || 0,
        produtosLiquidoComissionavel: p.produtos.liquidoComissionavel || 0,
      } : { ...z };

      const linhasRaw = Array.from(idsTodos).map(id => {
        const profMes = mesData.porProfissional[id];
        const meta = metas[id];
        const nome = (profMes?.nome || meta?.nome || "—");
        const metasCalc = calcularMetasProporcionais(meta || null);
        const diaObj = { ...z };
        const semanaObj = { ...z };
        const mesObj = mkObj(profMes);
        const comInfo = comissaoPorNome.get(normNomeImport(nome));
        return {
          profissionalId: id, nome,
          comissao: comInfo
            ? { categoria: comInfo.categoria, pct: comInfo.pct, comissaoServicos: comInfo.comissaoServicos, totalServicos: comInfo.totalServicos, naoComissionavel: comInfo.naoComissionavel, semCategoria: comInfo.categoria === null && !comInfo.naoComissionavel && comInfo.totalServicos > 0 }
            : { categoria: null, pct: 0, comissaoServicos: 0, totalServicos: 0, naoComissionavel: false, semCategoria: false },
          meta: meta ? { metaReais: meta.metaReais, metaAtendimentos: meta.metaAtendimentos, telegramChatId: meta.telegramChatId, ativoEnvio: meta.ativoEnvio, pctServico: meta.pctServico || 0, pctProduto: meta.pctProduto || 0, pctPlano: meta.pctPlano || 0 } : null,
          metasCalculadas: metasCalc,
          dia: diaObj,
          semana: semanaObj,
          mes: mesObj,
          status: {
            dia: calcularStatus(diaObj, metasCalc.dia),
            semana: calcularStatus(semanaObj, metasCalc.semana),
            mes: calcularStatus(mesObj, metasCalc.mes),
          },
          posicaoMes: posicaoMap.get(id) || null,
          totalProfsRanking: totalProfsComMov,
        };
      }).filter(l => {
        if (l.meta) return true;
        if (l.mes.count > 0 || l.mes.reais > 0) return true;
        return false;
      });
      linhasRaw.sort((a, b) => b.mes.reais - a.mes.reais);

      const result = {
        ok: true,
        fonte: "trinks-import" as const,
        referencia: {
          hoje: ymdHoje(),
          semana: { dataInicio: periodo.periodoInicio, dataFim: periodo.periodoFim },
          mes,
          diasUteisTotal,
          diasUteisDecorridos,
          periodoCSV: { inicio: periodo.periodoInicio, fim: periodo.periodoFim },
        },
        totais: { dia: diaVazio.totais, semana: semVazio.totais, mes: mesData.totais },
        config,
        linhas: linhasRaw,
        // v42: profissionais com Total Serviços > 0 sem categoria de comissão.
        // UI deve avisar (não pagar zero em silêncio).
        semCategoria,
        importInfo: { geradoEm: rankingData?.geradoEm || null },
        fetchedAt: new Date().toISOString(),
      };
      return res.json(result);
    } catch (err: any) {
      log(`[equipe/desempenho-import] erro: ${err.message}`, "equipe");
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/dashboard/import/:mes
  // Resumo agregado (financeiro + DRE + ranking) do mês, já formatado para
  // alimentar o Dashboard quando a API ao vivo não estiver disponível.
  app.get("/api/dashboard/import/:mes", async (req: Request, res: Response) => {
    try {
      const mes = req.params.mes;
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ ok: false, error: "Mês inválido. Use YYYY-MM." });
      }

      const [fin, dre, rank] = await Promise.all([
        kvGet<any>(trinksImport.kvKeyFor("financeiro", mes)),
        kvGet<any>(trinksImport.kvKeyFor("dre", mes)),
        kvGet<any>(trinksImport.kvKeyFor("ranking", mes)),
      ]);

      const periodo = rank?.periodos?.[0];
      const top = (periodo?.profissionais || [])
        .slice()
        .sort((a: any, b: any) => b.valorTotal - a.valorTotal)
        .slice(0, 10)
        .map((p: any) => ({
          nome: p.profissional,
          funcao: p.funcao,
          valorTotal: p.valorTotal,
          atendimentos: p.qtdAtendimentos,
          ticketMedio: p.ticketMedio,
        }));

      const out: any = {
        ok: true,
        fonte: "trinks-import" as const,
        mes,
        disponivel: { financeiro: !!fin, dre: !!dre, ranking: !!rank },
      };

      if (fin) {
        out.financeiro = {
          totalLinhas: fin.totalLinhas,
          totalValor: fin.totalValor,
          periodoInicio: fin.periodoInicio,
          periodoFim: fin.periodoFim,
          resumoPorForma: fin.resumoPorForma || {},
        };
      }
      if (dre) {
        out.dre = {
          totalReceitas: dre.totalReceitas,
          totalDespesas: dre.totalDespesas,
          resultadoPeriodo: dre.resultadoPeriodo,
          despesasSubgrupos: (dre.despesasSubgrupos || []).map((s: any) => ({ nome: s.nome, total: s.total })),
        };
      }
      if (rank && periodo) {
        out.ranking = {
          periodoInicio: periodo.periodoInicio,
          periodoFim: periodo.periodoFim,
          totalProfs: periodo.profissionais.length,
          total: periodo.total,
          top10: top,
        };
      }

      return res.json(out);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // ─── endpoints originais da Trinks API (mantidos intactos) ───
  app.get("/api/trinks/estabelecimento", async (_req: Request, res: Response) => {
    try {
      const data = await trinksFetchAll("estabelecimentos", undefined, { skipEstabHeader: true });
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/profissionais ──────────────────────
  app.get("/api/trinks/profissionais", async (_req: Request, res: Response) => {
    try {
      const data = await trinksFetchAll("profissionais");
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/servicos ───────────────────────────
  app.get("/api/trinks/servicos", async (_req: Request, res: Response) => {
    try {
      const data = await trinksFetchAll("servicos");
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // GET /api/trinks/produtos
  app.get("/api/trinks/produtos", async (_req: Request, res: Response) => {
    try {
      const data = await trinksFetchAll("produtos");
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // GET /api/trinks/produtos-movimentacoes
  // NOTA: A API Trinks (v1) NÃO expõe endpoint de movimentação de estoque dedicado.
  // Usamos /v1/transacoes como fonte — contém produtos vendidos em cada comanda
  // com IdProfissionalQueRealizouAVenda (quem vendeu).
  app.get("/api/trinks/produtos-movimentacoes", async (req: Request, res: Response) => {
    try {
      const params: Record<string, string> = {};
      if (req.query.dataInicio) params.dataInicio = String(req.query.dataInicio);
      if (req.query.dataFim) params.dataFim = String(req.query.dataFim);
      const [transacoes, profissionais] = await Promise.all([
        trinksFetchAll("transacoes", params).catch(() => [] as any[]),
        trinksFetchAll("profissionais").catch(() => [] as any[]),
      ]);
      const mapaProf = new Map<number, string>();
      for (const p of (profissionais || [])) {
        mapaProf.set(Number(p.id), p.nome || p.apelido || "—");
      }
      // Expande cada transação em uma linha por produto
      const movimentacoes = (transacoes || []).flatMap((t: any) => {
        const prods = Array.isArray(t.produtos) ? t.produtos : [];
        return prods.map((p: any) => {
          const idProf = Number(p.IdProfissionalQueRealizouAVenda || 0) || null;
          return {
            id: `${t.id}-${p.id}`,
            data: t.dataHora,
            produtoId: p.id,
            produtoNome: p.nome || "",
            tipo: "saida",
            quantidade: Number(p.quantidade || 0),
            valorUnitario: Number(p.valorUnitario || 0),
            valor: Number(p.valorUnitario || 0) * Number(p.quantidade || 0),
            unidade: p.unidadeDeMedida || "",
            vendedorId: idProf,
            vendedor: idProf ? (mapaProf.get(idProf) || `Profissional ${idProf}`) : "—",
            clienteNome: t.cliente?.nome || "",
            comandaId: t.id,
          };
        });
      });
      return res.json({ path: "transacoes", data: movimentacoes });
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // Função interna reutilizável para montar resumo de estoque
  // IMPORTANTE: A API Trinks (v1) não retorna saldo/custo/valor no endpoint /produtos.
  // Estratégia: usar /v1/transacoes (últimos 30 dias) — que contém produtos vendidos
  // em cada comanda COM IdProfissionalQueRealizouAVenda (quem vendeu). Permite:
  //  - detectar produtos com movimento / parados / em ruptura
  //  - ranking de vendedores de produtos por profissional
  //  - detalhar quem vendeu cada produto em cada comanda
  async function calcularEstoqueResumo(): Promise<any> {
    const ck = "estoque-resumo";
    const cached = getCached(ck);
    if (cached) return cached;

    const tzFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = tzFmt.formatToParts(new Date());
    const pick = (t: string) => parts.find(p => p.type === t)?.value || "";
    const hoje = `${pick("year")}-${pick("month")}-${pick("day")}`;

    // Janela de 30 dias para análise de movimento
    const d30 = new Date();
    d30.setDate(d30.getDate() - 30);
    const parts30 = tzFmt.formatToParts(d30);
    const pick30 = (t: string) => parts30.find(p => p.type === t)?.value || "";
    const dataInicio30 = `${pick30("year")}-${pick30("month")}-${pick30("day")}`;

    // Janela menor para agendamentos (heurística de nomes de vendedores)
    // para não estourar rate limit. 14 dias são suficientes para cobrir
    // a maior parte dos IDs legados ativos.
    const d14 = new Date();
    d14.setDate(d14.getDate() - 14);
    const parts14 = tzFmt.formatToParts(d14);
    const pick14 = (t: string) => parts14.find(p => p.type === t)?.value || "";
    const dataInicio14 = `${pick14("year")}-${pick14("month")}-${pick14("day")}`;

    // Custos/preços manuais cadastrados localmente (kv_store)
    const custosMap = await getProdutosCustos();
    // Movimentações manuais (entradas/saídas/inventário) cadastradas localmente
    const movs = await getMovimentacoesEstoque();
    const deltaPorProd = getDeltasPorProduto(movs);

    // v38.2: cache PERSISTENTE em kv_store. Quando Trinks responde, salva.
    // Quando falha (429), usa cache anterior. Estoque continua funcionando
    // mesmo com API morta indefinidamente.
    const KV_CACHE_PRODUTOS = "cache_trinks_produtos";
    const KV_CACHE_PROFS_TRINKS = "cache_trinks_profissionais";
    const KV_CACHE_TRANS_30D = `cache_trinks_transacoes_30d`;
    // v38.3: rastreia quando cada fonte veio do cache (pra UI mostrar idade)
    const fontesCache: { produtos: string | null; profissionais: string | null; transacoes: string | null } = {
      produtos: null, profissionais: null, transacoes: null,
    };

    const produtos: any[] = await trinksFetchAll("produtos").then(async (data) => {
      const arr = Array.isArray(data) ? data : (data?.data || []);
      if (arr.length > 0) {
        await kvSet(KV_CACHE_PRODUTOS, { produtos: arr, salvoEm: new Date().toISOString() }).catch(()=>{});
      }
      return arr;
    }).catch(async (e: any) => {
      log(`estoque: erro produtos: ${e?.message} — usando cache kv`, "trinks");
      const cache = await kvGet<{ produtos: any[]; salvoEm: string }>(KV_CACHE_PRODUTOS).catch(() => null);
      if (cache?.produtos?.length) {
        log(`estoque: cache produtos: ${cache.produtos.length} itens (salvo ${cache.salvoEm})`, "trinks");
        fontesCache.produtos = cache.salvoEm;
        return cache.produtos;
      }
      return [] as any[];
    });
    const profissionais: any[] = await trinksFetchAll("profissionais").then(async (data) => {
      const arr = Array.isArray(data) ? data : (data?.data || []);
      if (arr.length > 0) {
        await kvSet(KV_CACHE_PROFS_TRINKS, { profissionais: arr, salvoEm: new Date().toISOString() }).catch(()=>{});
      }
      return arr;
    }).catch(async (e: any) => {
      log(`estoque: erro profissionais: ${e?.message} — usando cache kv`, "trinks");
      const cache = await kvGet<{ profissionais: any[]; salvoEm: string }>(KV_CACHE_PROFS_TRINKS).catch(() => null);
      if (cache?.profissionais?.length) {
        fontesCache.profissionais = cache.salvoEm;
        return cache.profissionais;
      }
      return [] as any[];
    });
    // Trinks /v1/transacoes usa intervalo semi-aberto [dataInicio, dataFim) — somar +1d.
    const transFim = ymdAddDays(hoje, 1);
    const transacoes: any[] = await trinksFetchAll("transacoes", { dataInicio: dataInicio30, dataFim: transFim }).then(async (data) => {
      const arr = Array.isArray(data) ? data : (data?.data || []);
      if (arr.length > 0) {
        await kvSet(KV_CACHE_TRANS_30D, { transacoes: arr, salvoEm: new Date().toISOString(), periodo: { dataInicio: dataInicio30, dataFim: hoje } }).catch(()=>{});
      }
      return arr;
    }).catch(async (e: any) => {
      log(`estoque: erro transacoes: ${e?.message} — usando cache kv`, "trinks");
      const cache = await kvGet<{ transacoes: any[]; salvoEm: string; periodo: any }>(KV_CACHE_TRANS_30D).catch(() => null);
      if (cache?.transacoes?.length) {
        log(`estoque: cache transacoes: ${cache.transacoes.length} itens (salvo ${cache.salvoEm}, periodo ${JSON.stringify(cache.periodo)})`, "trinks");
        fontesCache.transacoes = cache.salvoEm;
        return cache.transacoes;
      }
      return [] as any[];
    });
    // Agendamentos em janela reduzida (14d) para heurística de nomes
    const agendamentos: any[] = await getAgendamentosPreferCsv(
      { dataInicio: dataInicio14, dataFim: hoje },
      () => trinksFetchAll("agendamentos", { dataInicio: dataInicio14, dataFim: hoje }),
    ).catch((e: any) => {
      log(`estoque: erro agendamentos: ${e?.message}`, "trinks");
      return [] as any[];
    });
    log(`estoque: carregados produtos=${produtos.length} profissionais=${profissionais.length} transacoes=${transacoes.length} agendamentos=${agendamentos.length}`, "trinks");

    // Mapa ID → nome do profissional (cadastro atual via /v1/profissionais)
    const mapaProf = new Map<number, string>();
    for (const p of (profissionais || [])) {
      mapaProf.set(Number(p.id), p.nome || p.apelido || `Profissional ${p.id}`);
    }
    // v39.1: também aplica dicionário manual de IDs legados (Configurações)
    try {
      const conhecidos = await getProfsConhecidos();
      for (const [id, nome] of Object.entries(conhecidos)) {
        mapaProf.set(Number(id), String(nome));
      }
    } catch { /* ignora */ }

    // Heurística: a API Trinks guarda em /v1/transacoes IDs legados
    // (ex: 55740, 653128) que NÃO batem com /v1/profissionais (825xxx, 829xxx).
    // Para mapear esses IDs legados a nomes reais, cruzamos com /v1/agendamentos
    // (que contém profissional.id novo + profissional.nome + cliente + data).
    //
    // Estratégia 1: índice (dataReferencia, clienteId) → nome
    //   Quando uma transação tem mesmo cliente+data que um agendamento, assumimos
    //   que é a mesma visita e o profissional do agendamento vendeu o produto.
    // Estratégia 2: acumula idLegado → frequência de nomes encontrados,
    //   usa o mais frequente como fallback geral.
    type IdxKey = string; // "YYYY-MM-DD|clienteId"
    const idxAgendPorDataCliente = new Map<IdxKey, { nome: string; idProf: number }[]>();
    for (const ag of (agendamentos || [])) {
      const dt = String(ag.dataHoraInicio || ag.data || "").slice(0, 10);
      const cli = Number(ag.cliente?.id || 0);
      const nomeProf = ag.profissional?.nome || ag.profissional?.apelido || "";
      const idProf = Number(ag.profissional?.id || 0);
      if (!dt || !cli || !nomeProf) continue;
      const k = `${dt}|${cli}`;
      const arr = idxAgendPorDataCliente.get(k) || [];
      arr.push({ nome: nomeProf, idProf });
      idxAgendPorDataCliente.set(k, arr);
    }

    // Primeira passada: construir mapa idLegado → {nome: contador}
    // baseado no cruzamento data+cliente entre transações e agendamentos
    const freqNomePorIdLegado = new Map<number, Map<string, number>>();
    for (const t of (transacoes || [])) {
      const dt = String(t.dataHora || "").slice(0, 10);
      const cli = Number(t.cliente?.id || 0);
      if (!dt || !cli) continue;
      const agCand = idxAgendPorDataCliente.get(`${dt}|${cli}`);
      if (!agCand || agCand.length === 0) continue;

      // Coleta todos os IDs legados usados na transação (produtos + serviços)
      const idsLegados = new Set<number>();
      for (const p of (t.produtos || [])) {
        const v = Number(p.IdProfissionalQueRealizouAVenda || 0);
        if (v) idsLegados.add(v);
      }
      for (const s of (t.servicos || [])) {
        const v = Number(s.idProfissionalQueRealizouServico || 0);
        if (v) idsLegados.add(v);
      }

      // Se tem 1 agendamento e 1 ID legado → match forte
      // Se tem N agendamentos e o nome se repete → ainda dá sinal
      for (const idLeg of idsLegados) {
        const mp = freqNomePorIdLegado.get(idLeg) || new Map<string, number>();
        for (const cand of agCand) {
          const peso = agCand.length === 1 ? 3 : 1; // match 1:1 vale mais
          mp.set(cand.nome, (mp.get(cand.nome) || 0) + peso);
        }
        freqNomePorIdLegado.set(idLeg, mp);
      }
    }

    // Consolida: para cada ID legado, escolhe o nome com maior frequência
    const mapaIdLegado = new Map<number, string>();
    for (const [idLeg, freq] of freqNomePorIdLegado) {
      let melhorNome = "";
      let melhorScore = 0;
      for (const [nome, score] of freq) {
        if (score > melhorScore) {
          melhorScore = score;
          melhorNome = nome;
        }
      }
      if (melhorNome) mapaIdLegado.set(idLeg, melhorNome);
    }

    const nomeVendedor = (id: number | null | undefined): string => {
      if (!id) return "—";
      const n = Number(id);
      // 1º tenta cadastro novo
      const novo = mapaProf.get(n);
      if (novo) return novo;
      // 2º tenta mapa legado inferido
      const leg = mapaIdLegado.get(n);
      if (leg) return leg;
      return `Profissional ${n}`;
    };

    // Agregações
    type MovProd = { qtd30d: number; valor30d: number; ultimaVenda: string | null; qtdHoje: number; valorHoje: number; valorUnitarioMedio: number };
    const movPorProduto = new Map<number, MovProd>();
    const movHoje: any[] = [];

    // Ranking de vendedores (por profissional)
    type VendedorStats = { id: number; nome: string; unidades: number; faturamento: number; produtosDistintos: Set<number>; transacoesDistintas: Set<number> };
    const rankingMap = new Map<number, VendedorStats>();

    for (const t of (transacoes || [])) {
      const dataHora = String(t.dataHora || "");
      const dataTransacao = dataHora.slice(0, 10);
      const isHoje = dataTransacao === hoje;
      const prods = Array.isArray(t.produtos) ? t.produtos : [];
      for (const p of prods) {
        const pid = Number(p.id);
        if (!pid) continue;
        const qtd = Number(p.quantidade || 0);
        const vu = Number(p.valorUnitario || 0);
        const valor = vu * qtd;
        const idVendedor = Number(p.IdProfissionalQueRealizouAVenda || 0) || null;

        // Agrega por produto
        const cur = movPorProduto.get(pid) || { qtd30d: 0, valor30d: 0, ultimaVenda: null, qtdHoje: 0, valorHoje: 0, valorUnitarioMedio: 0 };
        cur.qtd30d += qtd;
        cur.valor30d += valor;
        if (vu > 0) cur.valorUnitarioMedio = vu;
        if (!cur.ultimaVenda || dataTransacao > cur.ultimaVenda) cur.ultimaVenda = dataTransacao;
        if (isHoje) {
          cur.qtdHoje += qtd;
          cur.valorHoje += valor;
          movHoje.push({
            id: `${t.id}-${pid}`,
            data: dataHora,
            produtoId: pid,
            produtoNome: p.nome || "",
            tipo: "saida",
            quantidade: qtd,
            valorUnitario: vu,
            valor,
            vendedorId: idVendedor,
            vendedor: nomeVendedor(idVendedor),
            clienteNome: t.cliente?.nome || "",
            comandaId: t.id,
            observacao: "",
          });
        }
        movPorProduto.set(pid, cur);

        // Ranking por vendedor (ignora itens sem profissional associado)
        if (idVendedor) {
          const rk = rankingMap.get(idVendedor) || {
            id: idVendedor,
            nome: nomeVendedor(idVendedor),
            unidades: 0,
            faturamento: 0,
            produtosDistintos: new Set<number>(),
            transacoesDistintas: new Set<number>(),
          };
          rk.unidades += qtd;
          rk.faturamento += valor;
          rk.produtosDistintos.add(pid);
          rk.transacoesDistintas.add(Number(t.id));
          rankingMap.set(idVendedor, rk);
        }
      }
    }

    const lista = (produtos || []).map((p: any) => {
      const idStr = String(p.id);
      const mov = movPorProduto.get(Number(p.id));
      const qtd30d = mov?.qtd30d ?? 0;
      const ultimaVenda = mov?.ultimaVenda ?? null;
      const valorVendaObs = mov?.valorUnitarioMedio ?? 0;
      const diasDesdeUltimaVenda = ultimaVenda
        ? Math.floor((new Date(hoje).getTime() - new Date(ultimaVenda).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      // Custos/preços manuais cadastrados localmente
      const custoEntry = custosMap[idStr];
      const custoUnit = Number(custoEntry?.custo || 0);
      const precoVendaManual = typeof custoEntry?.precoVenda === "number" && custoEntry.precoVenda > 0 ? custoEntry.precoVenda : 0;
      const precoVendaCatalogo = Number(p.preco || 0);
      // efetivo: manual > catálogo Trinks > observado nas transações
      const valorVenda = precoVendaManual || precoVendaCatalogo || valorVendaObs;
      const minimo = Number(custoEntry?.minimo || 0);

      // Saldo derivado dos ajustes manuais (Trinks não fornece saldo).
      // Baseline 0 + soma dos deltas (entradas +, saídas -, inventário ajusta para contagem).
      const saldo = Math.max(0, Number(deltaPorProd[idStr] || 0));
      const valorEstoque = saldo * custoUnit;

      // Classificação:
      // - ruptura: saldo abaixo do mínimo cadastrado (prioridade máxima)
      // - critico: produto SEM movimento nos últimos 30d (parado)
      // - atencao: última venda há mais de 14 dias
      // - ok: movimento recente
      let nivel: "ok" | "atencao" | "critico" | "ruptura" = "ok";
      if (minimo > 0 && saldo <= minimo) nivel = "ruptura";
      else if (diasDesdeUltimaVenda >= 30) nivel = "critico";
      else if (diasDesdeUltimaVenda >= 14) nivel = "atencao";

      // Giro: produtos com estoque parado pesando capital
      // - parado: tem saldo mas não vende há 60+ dias (ou nunca vendeu nos 30d capturados)
      // - giroLento: tem saldo, vende pouco (≤2 unidades em 30d), mas não está parado
      const temSaldo = saldo > 0;
      const parado = temSaldo && (ultimaVenda === null || diasDesdeUltimaVenda >= 60);
      const giroLento = temSaldo && !parado && qtd30d <= 2;

      return {
        id: p.id,
        nome: p.nome || p.descricao || "",
        categoria: p.categoria?.nome || p.categoriaNome || "",
        fabricante: p.fabricante?.nome || p.fabricanteNome || "",
        saldo,
        minimo,
        custoMedio: custoUnit, // preço de COMPRA cadastrado manualmente
        custo: custoUnit,
        precoVendaManual: precoVendaManual || null,
        precoVendaCatalogo,
        precoVendaObservado: valorVendaObs,
        valorVenda, // efetivo
        valorEstoque,
        nivel,
        giroLento,
        parado,
        vendidos30d: qtd30d,
        faturamento30d: mov?.valor30d ?? 0,
        ultimaVenda,
        diasDesdeUltimaVenda: ultimaVenda ? diasDesdeUltimaVenda : null,
      };
    });

    const emAlerta = lista.filter(p => p.nivel !== "ok");
    const criticos = lista.filter(p => p.nivel === "critico");
    const giroLento = lista.filter(p => p.giroLento);
    const parados = lista.filter(p => p.parado);
    const valorEmGiroLento = giroLento.reduce((s, p) => s + (p.valorEstoque || 0), 0);
    const valorParado = parados.reduce((s, p) => s + (p.valorEstoque || 0), 0);

    // Converte ranking Set → número
    const rankingVendedores = Array.from(rankingMap.values())
      .map(r => ({
        id: r.id,
        nome: r.nome,
        unidades: r.unidades,
        faturamento: r.faturamento,
        produtosDistintos: r.produtosDistintos.size,
        comandas: r.transacoesDistintas.size,
      }))
      .sort((a, b) => b.faturamento - a.faturamento || b.unidades - a.unidades);

    // Ordena movimentações de hoje do mais recente para o mais antigo
    movHoje.sort((a, b) => String(b.data).localeCompare(String(a.data)));

    // v38.3: se alguma fonte veio do cache, marca a mais antiga e expõe pra UI.
    const cacheUsado = !!(fontesCache.produtos || fontesCache.profissionais || fontesCache.transacoes);
    const idadesCache = [fontesCache.produtos, fontesCache.profissionais, fontesCache.transacoes]
      .filter((d): d is string => !!d)
      .map(d => Date.now() - new Date(d).getTime());
    const cacheIdadeMs = idadesCache.length > 0 ? Math.max(...idadesCache) : null;
    const cacheIdadeHoras = cacheIdadeMs ? Math.round(cacheIdadeMs / (1000 * 60 * 60)) : null;

    const resumo = {
      atualizadoEm: new Date().toISOString(),
      fonte: "trinks-transacoes-30d",
      // v38.3: status de frescor do dado pra UI mostrar badge
      cacheUsado,
      cacheIdadeHoras,
      fontesCache, // detalhe: { produtos: salvoEm, profissionais: salvoEm, transacoes: salvoEm }
      limitacaoApi: "A API Trinks não expõe saldo/custo/valor de estoque. Dados derivados das transações (comandas) dos últimos 30 dias.",
      janela: { dataInicio: dataInicio30, dataFim: hoje },
      totalProdutos: lista.length,
      produtosEmAlerta: emAlerta.length,
      produtosCriticos: criticos.length,
      produtosGiroLento: giroLento.length,
      produtosParados: parados.length,
      valorEmGiroLento,
      valorParado,
      valorTotalEstoque: 0,
      movimentacoesHojeCount: movHoje.length,
      saidasHoje: movHoje.length,
      entradasHoje: 0,
      faturamentoProdutos30d: lista.reduce((s, p) => s + (p.faturamento30d || 0), 0),
      produtos: lista,
      alertas: emAlerta,
      movimentacoesHoje: movHoje,
      rankingVendedores,
    };
    setCache(ck, resumo, 5 * 60 * 1000); // 5 minutos
    return resumo;
  }

  // GET /api/estoque/resumo - consolidado
  app.get("/api/estoque/resumo", async (_req: Request, res: Response) => {
    try {
      const resumo = await calcularEstoqueResumo();
      return res.json(resumo);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/agendamentos ───────────────────────
  // v33: tenta primeiro o CSV importado por email (≤24h) → fallback pra API
  app.get("/api/trinks/agendamentos", async (req: Request, res: Response) => {
    try {
      const params: Record<string, string> = {};
      if (req.query.dataInicio) params.dataInicio = String(req.query.dataInicio);
      if (req.query.dataFim) params.dataFim = String(req.query.dataFim);
      const data = await getAgendamentosPreferCsv(
        params,
        () => trinksFetchAll("agendamentos", params),
      );
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/transacoes ─────────────────────────
  // GET /api/trinks/hoje — apenas comandas fechadas de hoje (economiza chamadas)
  app.get("/api/trinks/hoje", async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const hoje = now.toISOString().slice(0, 10);
      const cacheKey = `hoje_${hoje}`;
      // Cache curto de 3 minutos para não esbaforir a API
      const cached = getCached(cacheKey);
      if (cached) return res.json({ ...cached, fromCache: true });

      // Trinks /v1/transacoes usa intervalo semi-aberto [dataInicio, dataFim).
      const transFim = ymdAddDays(hoje, 1);
      const data = await trinksFetchAll("transacoes", { dataInicio: hoje, dataFim: transFim });
      const lista = Array.isArray(data) ? data : (data?.data || []);

      // Calcula resumo
      let total = 0;
      let pix = 0, cartao = 0, dinheiro = 0, outros = 0;
      const comandas: any[] = [];

      lista.forEach((t: any) => {
        const val = Number(t.totalPagar || t.valor || 0);
        total += val;

        // Extrai informações da comanda
        const cliente = t.cliente?.nome || t.clienteNome || "Cliente";
        const profissional = t.profissional?.nome || t.profissionalNome || "—";
        const hora = (t.dataHoraInicio || t.dataHora || "").slice(11, 16);

        // Detecta meios de pagamento
        const formas = t.formasPagamentos || t.formasPagamento || [];
        const meiosDaComanda: string[] = [];
        if (Array.isArray(formas) && formas.length > 0) {
          formas.forEach((fp: any) => {
            const nome = (fp.nome || fp.descricao || "").toLowerCase();
            const v = Number(fp.valor || 0);
            if (nome.includes("pix")) { pix += v; meiosDaComanda.push("pix"); }
            else if (/créd|cred|déb|deb|cart/.test(nome)) { cartao += v; meiosDaComanda.push("cartao"); }
            else if (/dinhe|espécie|cash/.test(nome)) { dinheiro += v; meiosDaComanda.push("dinheiro"); }
            else { outros += v; meiosDaComanda.push("outros"); }
          });
        } else {
          const method = (t.formaPagamento || t.metodoPagamento || "").toLowerCase();
          if (method.includes("pix")) { pix += val; meiosDaComanda.push("pix"); }
          else if (/cart/.test(method)) { cartao += val; meiosDaComanda.push("cartao"); }
          else if (/dinhe/.test(method)) { dinheiro += val; meiosDaComanda.push("dinheiro"); }
          else { outros += val; meiosDaComanda.push("outros"); }
        }

        comandas.push({
          id: t.id,
          hora,
          cliente,
          profissional,
          total: val,
          meios: Array.from(new Set(meiosDaComanda)),
        });
      });

      // Ordena por hora (mais recente primeiro)
      comandas.sort((a, b) => (b.hora || "").localeCompare(a.hora || ""));

      const result = {
        data: hoje,
        total,
        count: comandas.length,
        breakdown: { pix, cartao, dinheiro, outros },
        comandas,
        fetchedAt: new Date().toISOString(),
      };

      setCache(cacheKey, result, 3 * 60 * 1000); // 3 min
      return res.json(result);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // Função interna: retorna dados completos do dia (usada por endpoint e cron)
  // Versão genérica: calcula resumo completo (previsto + fechado) para qualquer dia.
  // Usada por calcularHojeCompleto() (com data atual) e pelo resumo da manhã
  // (que precisa do FECHAMENTO de ontem).
  async function calcularDiaCompleto(dataYMD?: string): Promise<ResumoDiaData & {
    horaAgora: string; breakdown: any; agendamentos: any[]; comandas: any[]; fetchedAt: string;
  }> {
    const tzFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    let hoje: string;
    if (dataYMD) {
      hoje = dataYMD;
    } else {
      const parts = tzFmt.formatToParts(new Date());
      const pick = (t: string) => parts.find(p => p.type === t)?.value || "";
      hoje = `${pick("year")}-${pick("month")}-${pick("day")}`;
    }

    // ⚠️ /v1/transacoes da Trinks usa intervalo SEMI-ABERTO [dataInicio, dataFim).
    // Para pegar 1 dia inteiro precisamos passar dataFim = dia + 1.
    // (Já /v1/agendamentos aceita dataInicio=dataFim normalmente.)
    const transFim = ymdAddDays(hoje, 1);

    // v35: Resposta rápida + atualização em background.
    // 1. Agendamentos vêm do CSV (instantâneo)
    // 2. Transações: se já tem cache fresco (≤ 2min), usa. Senão, dispara
    //    fetch em background e retorna com transacoesPendente=true. Próxima
    //    request pega o cache atualizado.
    const transCacheKey = `transacoes_dia:${hoje}`;
    const TRANS_CACHE_TTL_MS = 2 * 60 * 1000;
    const cachedTrans = getCached(transCacheKey) as { data: any[]; at: number } | null;
    const cachedFresh = cachedTrans && (Date.now() - cachedTrans.at) < TRANS_CACHE_TTL_MS;

    let transData: any[] = cachedFresh ? (cachedTrans!.data || []) : [];
    let transOk = !!cachedFresh;
    let transacoesPendente = false;

    // Agendamentos: rápido (CSV ou API com circuit breaker que falha rápido)
    const agendResult = await getAgendamentosPreferCsvVerbose(
      { dataInicio: hoje, dataFim: hoje },
      () => trinksFetchAll("agendamentos", { dataInicio: hoje, dataFim: hoje }),
    ).catch((err: any) => {
      log(`calcularDiaCompleto: agendamentos falhou — ${err?.message}`, "trinks");
      return { data: [], fonte: "trinks-api" as const };
    });
    const agendInfo = agendResult;
    const agendData = agendInfo.data;
    const fonteAgendamentos = agendInfo.fonte;
    const fonteTransacoes: "trinks-api" = "trinks-api";

    // Transações: race entre fetch real e timeout de 2.5s
    if (!cachedFresh) {
      let inflight = inflightTrinksFetches.get(transCacheKey);
      if (!inflight) {
        inflight = trinksFetchAll("transacoes", { dataInicio: hoje, dataFim: transFim })
          .then((d: any[]) => {
            setCache(transCacheKey, { data: d, at: Date.now() }, TRANS_CACHE_TTL_MS);
            return d;
          })
          .catch((err: any) => {
            // Em 429 persistente, popula cache vazio por 60s pra parar o
            // polling do frontend e evitar disparar nova chamada Trinks
            // a cada 5s (5s polling × 429 = storm).
            if (err?.status === 429) {
              const fallback = (cachedTrans?.data) || [];
              setCache(transCacheKey, { data: fallback, at: Date.now() }, 60_000);
            }
            throw err;
          })
          .finally(() => { inflightTrinksFetches.delete(transCacheKey); });
        inflightTrinksFetches.set(transCacheKey, inflight);
      }
      const fetchPromise = inflight
        .then((d: any[]) => ({ ok: true, data: d }))
        .catch((err: any) => {
          log(`calcularDiaCompleto: transacoes falhou — ${err?.message}`, "trinks");
          return { ok: false, data: [] as any[] };
        });
      const timeoutPromise = new Promise<{ ok: false; data: any[]; timedOut: true }>(resolve =>
        setTimeout(() => resolve({ ok: false, data: [], timedOut: true }), 1500) // v35: 1.5s pra resposta total ficar ~2s
      );
      const result = await Promise.race([fetchPromise, timeoutPromise]);
      if ((result as any).timedOut) {
        // Background fetch continua rodando, vai popular o cache quando terminar
        transacoesPendente = true;
        transOk = false;
        log(`calcularDiaCompleto: transacoes em background (timeout 2.5s)`, "trinks");
      } else {
        transData = result.data;
        transOk = result.ok;
      }
    }

    const agendLista = Array.isArray(agendData) ? agendData : (agendData?.data || []);
    const transLista = Array.isArray(transData) ? transData : (transData?.data || []);

    // Fallback unificado: API trouxe vazio mas o CSV "Caixa por comanda" do
    // mês cobre este dia. Monta transações sintéticas (mesmo formato Trinks)
    // pra alimentar totalFechado + breakdown + comandas downstream. Mesma
    // lógica usada em capturarSnapshotDia e caixa-dia.
    if (transLista.length === 0) {
      try {
        const caixaPayload: any = await kvGet(trinksImport.kvKeyFor("caixa", hoje.slice(0, 7)));
        const rowsDia = (caixaPayload?.rows || []).filter((r: any) => (r.data || "").startsWith(hoje));
        if (rowsDia.length > 0) {
          for (const r of rowsDia) {
            transLista.push({
              dataHora: r.data,
              cliente: { nome: r.clienteNome || "Cliente" },
              totalPagar: Number(r.totalGeral || 0),
              formasPagamentos: [
                ...(Number(r.totalCredito) > 0 ? [{ nome: "Cartão de Crédito", valor: Number(r.totalCredito) }] : []),
                ...(Number(r.totalDebito) > 0 ? [{ nome: "Cartão de Débito", valor: Number(r.totalDebito) }] : []),
                ...(Number(r.totalDinheiro) > 0 ? [{ nome: "Dinheiro", valor: Number(r.totalDinheiro) }] : []),
                ...(Number(r.totalPrePago) > 0 ? [{ nome: "Pré-Pago", valor: Number(r.totalPrePago) }] : []),
                ...(Number(r.totalOutros) > 0 ? [{ nome: "Outros", valor: Number(r.totalOutros) }] : []),
              ],
            });
          }
          transOk = true;
          transacoesPendente = false;
          log(`calcularDiaCompleto/${hoje}: CSV fallback (${rowsDia.length} comandas)`, "trinks");
        }
      } catch { /* segue com transLista vazia */ }
    }

    const statusIgnorar = ["cancelado", "cancelada", "no show", "no-show", "faltou"];
    const getStatusStr = (a: any) =>
      (typeof a.status === "string" ? a.status : (a.status?.descricao || a.status?.nome || "")).toLowerCase();
    const isValido = (a: any) => !statusIgnorar.some(s => getStatusStr(a).includes(s));

    const extractValor = (a: any) => {
      let v = Number(a.valor || a.valorTotal || a.totalPagar || 0);
      if ((!v || v === 0) && Array.isArray(a.servicos)) {
        v = a.servicos.reduce((s: number, svc: any) =>
          s + Number(svc.preco || svc.valor || svc.valorServico || 0), 0);
      }
      return v;
    };

    let totalPrevisto = 0;
    let agendCount = 0;
    const agendamentos: any[] = [];
    const porProfissionalPrev: Record<string, { nome: string; total: number; count: number }> = {};

    agendLista.filter(isValido).forEach((a: any) => {
      const val = extractValor(a);
      totalPrevisto += val;
      agendCount += 1;
      const profId = String(a.profissionalId || a.profissional?.id || "");
      const profNome = a.profissional?.nome || a.profissionalNome || "—";
      if (profId) {
        if (!porProfissionalPrev[profId]) porProfissionalPrev[profId] = { nome: profNome, total: 0, count: 0 };
        porProfissionalPrev[profId].total += val;
        porProfissionalPrev[profId].count += 1;
      }
      const hora = (a.dataHoraInicio || a.dataHora || "").slice(11, 16);
      const servicoNome = a.servico?.nome
        || (Array.isArray(a.servicos) ? a.servicos.map((s: any) => s.nome).filter(Boolean).join(", ") : "")
        || a.servicoNome || "—";
      agendamentos.push({
        id: a.id, hora, cliente: a.cliente?.nome || a.clienteNome || "Cliente",
        profissional: profNome, servico: servicoNome, valor: val,
        status: (typeof a.status === "string" ? a.status : (a.status?.descricao || a.status?.nome || "")) || "agendado",
      });
    });
    agendamentos.sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));

    let totalFechado = 0;
    let pix = 0, cartao = 0, dinheiro = 0, outros = 0;
    const comandas: any[] = [];
    const porProfissionalFech: Record<string, { nome: string; total: number; count: number }> = {};

    transLista.forEach((t: any) => {
      const val = Number(t.totalPagar || t.valor || 0);
      totalFechado += val;
      const profId = String(t.profissionalId || t.profissional?.id || "");
      const profNome = t.profissional?.nome || t.profissionalNome || "—";
      if (profId) {
        if (!porProfissionalFech[profId]) porProfissionalFech[profId] = { nome: profNome, total: 0, count: 0 };
        porProfissionalFech[profId].total += val;
        porProfissionalFech[profId].count += 1;
      }
      const formas = t.formasPagamentos || t.formasPagamento || [];
      const meiosDaComanda: string[] = [];
      if (Array.isArray(formas) && formas.length > 0) {
        formas.forEach((fp: any) => {
          const nome = (fp.nome || fp.descricao || "").toLowerCase();
          const v = Number(fp.valor || 0);
          if (nome.includes("pix")) { pix += v; meiosDaComanda.push("pix"); }
          else if (/créd|cred|déb|deb|cart/.test(nome)) { cartao += v; meiosDaComanda.push("cartao"); }
          else if (/dinhe|espécie|cash/.test(nome)) { dinheiro += v; meiosDaComanda.push("dinheiro"); }
          else { outros += v; meiosDaComanda.push("outros"); }
        });
      } else {
        const method = (t.formaPagamento || t.metodoPagamento || "").toLowerCase();
        if (method.includes("pix")) { pix += val; meiosDaComanda.push("pix"); }
        else if (/cart/.test(method)) { cartao += val; meiosDaComanda.push("cartao"); }
        else if (/dinhe/.test(method)) { dinheiro += val; meiosDaComanda.push("dinheiro"); }
        else { outros += val; meiosDaComanda.push("outros"); }
      }
      comandas.push({
        id: t.id,
        hora: (t.dataHoraInicio || t.dataHora || "").slice(11, 16),
        cliente: t.cliente?.nome || t.clienteNome || "Cliente",
        profissional: profNome, total: val,
        meios: Array.from(new Set(meiosDaComanda)),
      });
    });
    comandas.sort((a, b) => (b.hora || "").localeCompare(a.hora || ""));

    const hhmmAgora = new Date().toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const agendamentosRestantes = agendamentos.filter(a => (a.hora || "99:99") >= hhmmAgora);
    const agendamentosJaPassaram = agendamentos.filter(a => (a.hora || "00:00") < hhmmAgora);
    const valorRestante = agendamentosRestantes.reduce((s, a) => s + a.valor, 0);
    // ─── Atendimentos de PLANO (assinatura) ───────────────────────────
    // Heurística: agendamento com status "Confirmado" ou "Finalizado"
    // cujo NOME do cliente NÃO aparece em nenhuma transação do dia.
    // Trinks não cria comanda para serviço coberto por plano de assinatura.
    const norm = (s: any) => String(s || "").trim().toLowerCase();
    const nomesComTransacao = new Set<string>();
    transLista.forEach((t: any) => {
      const n = norm(t.cliente?.nome || t.clienteNome);
      if (n) nomesComTransacao.add(n);
    });
    const planoAtendimentos: any[] = [];
    const porProfissionalPlano: Record<string, { nome: string; count: number; valor: number }> = {};
    let planoValorTabela = 0;
    agendLista.forEach((a: any) => {
      const status = (typeof a.status === "string" ? a.status : (a.status?.nome || a.status?.descricao || "")).toLowerCase();
      if (!(status.includes("confirm") || status.includes("finaliz"))) return;
      const nomeCli = norm(a.cliente?.nome || a.clienteNome);
      if (!nomeCli || nomesComTransacao.has(nomeCli)) return;
      const val = Number(a.valor || a.valorTotal || 0)
        || (Array.isArray(a.servicos) ? a.servicos.reduce((s: number, svc: any) => s + Number(svc.preco || svc.valor || 0), 0) : 0);
      planoValorTabela += val;
      const profId = String(a.profissionalId || a.profissional?.id || "");
      const profNome = (a.profissional?.nome || a.profissionalNome || "—").trim();
      if (profId) {
        if (!porProfissionalPlano[profId]) porProfissionalPlano[profId] = { nome: profNome, count: 0, valor: 0 };
        porProfissionalPlano[profId].count += 1;
        porProfissionalPlano[profId].valor += val;
      }
      planoAtendimentos.push({
        id: a.id,
        hora: (a.dataHoraInicio || a.dataHora || "").slice(11, 16),
        cliente: a.cliente?.nome || a.clienteNome || "Cliente",
        profissional: profNome,
        servico: a.servico?.nome || (Array.isArray(a.servicos) ? a.servicos.map((s: any) => s.nome).filter(Boolean).join(", ") : "—"),
        valor: val,
        status: status.includes("finaliz") ? "Finalizado" : "Confirmado",
      });
    });
    planoAtendimentos.sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
    const planoRankingProfs = Object.values(porProfissionalPlano).sort((a, b) => b.count - a.count);

    const totalEsperado = Math.max(totalPrevisto, totalFechado + valorRestante);

    const metaDia = metaDiaria;
    const atingeMeta = totalEsperado >= metaDia;
    const falta = Math.max(0, metaDia - totalEsperado);
    const progressoPct = metaDia > 0 ? (totalEsperado / metaDia) * 100 : 0;
    const progressoFechadoPct = metaDia > 0 ? (totalFechado / metaDia) * 100 : 0;

    const todosProfs = new Set([
      ...Object.keys(porProfissionalPrev), ...Object.keys(porProfissionalFech),
    ]);
    const rankingProfissionais = Array.from(todosProfs).map(id => {
      const prev = porProfissionalPrev[id] || { nome: "—", total: 0, count: 0 };
      const fech = porProfissionalFech[id] || { nome: prev.nome, total: 0, count: 0 };
      return {
        nome: prev.nome !== "—" ? prev.nome : fech.nome,
        previsto: prev.total, fechado: fech.total,
        countPrevisto: prev.count, countFechado: fech.count,
        total: Math.max(prev.total, fech.total),
      };
    }).sort((a, b) => b.total - a.total);

    return {
      data: hoje,
      horaAgora: hhmmAgora,
      previsto: totalPrevisto,
      fechado: totalFechado,
      restante: valorRestante,
      totalEsperado,
      breakdown: { pix, cartao, dinheiro, outros },
      agendamentosCount: agendCount,
      agendamentosRestantesCount: agendamentosRestantes.length,
      agendamentosJaPassaramCount: agendamentosJaPassaram.length,
      comandasCount: comandas.length,
      metaDiaria: metaDia,
      atingeMeta, falta, progressoPct, progressoFechadoPct,
      porProfissional: rankingProfissionais,
      agendamentos, comandas,
      plano: {
        count: planoAtendimentos.length,
        valorTabela: planoValorTabela,
        atendimentos: planoAtendimentos,
        porProfissional: planoRankingProfs,
      },
      // v34/35: fonte dos dados pra UI mostrar 'CSV' / 'Trinks API' embaixo de cada card
      fonteAgendamentos,
      fonteTransacoes,
      transacoesOk: transOk,
      transacoesPendente,  // v35: true = API ainda processando em background
      csvGeradoEm: agendInfo.fonte === "csv" ? (agendInfo as any).csvGeradoEm : null,
      fetchedAt: new Date().toISOString(),
    };
  }

  // Wrapper retrocompatível: calcula sempre o dia atual (em São Paulo).
  async function calcularHojeCompleto(): Promise<ResumoDiaData & {
    horaAgora: string; breakdown: any; agendamentos: any[]; comandas: any[]; fetchedAt: string;
  }> {
    return calcularDiaCompleto();
  }

  // Calcula apenas o que aconteceu ontem (útil para o resumo da manhã).
  // Retorna fechamento real do dia anterior + meta atingida ou não.
  async function calcularOntemFechado(): Promise<ResumoDiaData & {
    horaAgora: string; breakdown: any; agendamentos: any[]; comandas: any[]; fetchedAt: string;
  }> {
    const tzFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const parts = tzFmt.formatToParts(ontem);
    const pick = (t: string) => parts.find(p => p.type === t)?.value || "";
    const dataOntem = `${pick("year")}-${pick("month")}-${pick("day")}`;
    const base = await calcularDiaCompleto(dataOntem);

    // Se temos snapshot fonte=trinks-email (caixa fechado oficial), usa esse valor
    // como Faturamento de ontem (senão, mantém o cálculo via API/CSV).
    try {
      const snap = await getSnapshot(dataOntem);
      if (snap && snap.fonte === "trinks-email" && snap.faturamento?.total > 0) {
        (base as any).fechado = snap.faturamento.total;
        (base as any).fonteFechado = "trinks-email";
      }
    } catch {}
    return base;
  }

  // ─── Cálculo agregado por profissional em uma janela de tempo ─────────
  // Usado pela aba Equipe (dia/semana/mês) e pelos resumos individuais.
  // dataInicio e dataFim são YYYY-MM-DD inclusivos.
  // Reusa a heurística de plano: agendamento Confirmado/Finalizado sem transação do mesmo cliente.
  async function calcularPeriodoPorProfissional(dataInicio: string, dataFim: string): Promise<{
    dataInicio: string; dataFim: string;
    porProfissional: Record<string, {
      profissionalId: string; nome: string; idsConhecidos: string[];
      avulso:    { reais: number; count: number };
      plano:     { reais: number; count: number };
      servicos:  { reais: number; count: number; bruto: number; liquido: number };
      produtos:  { reais: number; count: number; bruto: number; liquido: number; liquidoComissionavel: number; brutoComissionavel: number };
      taxaCartao: number; // taxa de cartão agregada (já abatida do líquido)
      custoInsumos: number; // soma da ficha técnica dos serviços feitos pelo profissional
      total:     { reais: number; count: number };
    }>;
    totais: { reais: number; count: number; avulsoReais: number; avulsoCount: number; planoReais: number; planoCount: number; servicosReais: number; servicosCount: number; servicosBruto: number; servicosLiquido: number; produtosReais: number; produtosCount: number; produtosBruto: number; produtosLiquido: number; produtosLiquidoComissionavel: number; produtosBrutoComissionavel: number };
    config: { taxaCartaoPct: number };
    fetchedAt: string;
  }> {
    const cacheKey = `equipe-periodo:${dataInicio}:${dataFim}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Trinks /v1/transacoes usa intervalo semi-aberto: [dataInicio, dataFim+1)
    const transFim = ymdAddDays(dataFim, 1);

    // v36 Fase 3: SNAPSHOT FIRST. Tenta montar dados a partir dos snapshots
    // persistentes antes de bater na API Trinks. Se cobrirem o período inteiro,
    // evita 100% das chamadas Trinks (sistema continua funcionando mesmo com
    // API morta indefinidamente).
    let snapshotsAgend: any[] = [];
    let snapshotsTrans: any[] = [];
    let snapshotCobertura = 0;
    let snapshotDias = 0;
    try {
      // Gera lista de datas YYYY-MM-DD no intervalo
      const datas: string[] = [];
      let cur = dataInicio;
      while (cur <= dataFim) {
        datas.push(cur);
        cur = ymdAddDays(cur, 1);
      }
      const snaps = await Promise.all(datas.map(d => getSnapshot(d)));
      for (const s of snaps) {
        if (!s) continue;
        if (s.fonte === "vazio") continue;
        snapshotDias++;
        if (Array.isArray(s.agendamentosRaw)) snapshotsAgend.push(...s.agendamentosRaw);
        if (Array.isArray(s.transacoesRaw)) snapshotsTrans.push(...s.transacoesRaw);
      }
      snapshotCobertura = datas.length > 0 ? snapshotDias / datas.length : 0;
      log(`[periodo ${dataInicio}..${dataFim}] snapshot cobertura: ${snapshotDias}/${datas.length} (${Math.round(snapshotCobertura * 100)}%) — agend=${snapshotsAgend.length} trans=${snapshotsTrans.length}`, "equipe");
    } catch (err: any) {
      log(`[periodo ${dataInicio}..${dataFim}] erro lendo snapshots: ${err?.message}`, "equipe");
    }

    // Pra meses passados, NUNCA confia 100% nos snapshots — eles podem ter sido
    // capturados durante 429 da Trinks (dado parcial). Força a chamada pra API
    // (já fica em cache estendido 7d/30d). Pro período corrente/futuro, mantém
    // o snapshot-first pra evitar storm de 429 em uso ao vivo.
    const hojeSP_periodo = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const periodoEhPassado = dataFim < hojeSP_periodo;
    // Se snapshots cobrem 100% do período E tem dado, NÃO chama Trinks — EXCETO
    // se for mês passado (aí prefere API que tem o dado completo).
    const cobreTudo = !periodoEhPassado
      && snapshotCobertura >= 1
      && (snapshotsAgend.length > 0 || snapshotsTrans.length > 0);

    // Buscar serial p/ não estourar rate limit do Trinks.
    // Timeout 5s pra não travar quando Trinks está rate-limited (retries com
    // backoff somam 30s+ por chamada). Vai usar fallback de metas se vazio.
    const profData = await Promise.race([
      trinksFetchAll("profissionais").catch((e: any) => {
        log(`[periodo ${dataInicio}..${dataFim}] erro profissionais: ${e?.message} — fallback pra metas`, "equipe");
        return [] as any[];
      }),
      new Promise<any[]>(resolve => setTimeout(() => {
        log(`[periodo ${dataInicio}..${dataFim}] timeout Trinks profissionais — fallback pra metas`, "equipe");
        resolve([]);
      }, 5000)),
    ]);
    // v37.3: fallback — se profData vier vazio (API 429), monta lista a partir
    // das metas persistidas. As metas têm profissionalId real (Trinks) + nome,
    // o que permite que resolveProf relacione os agendamentos do CSV (que tem
    // só nome) com o profissional real.
    let profListaEffective = Array.isArray(profData) ? profData : (profData?.data || []);
    if (profListaEffective.length === 0) {
      try {
        const metasMap = await getAllMetas();
        profListaEffective = Object.values(metasMap).map((m: any) => ({
          id: m.profissionalId, nome: m.nome, apelido: m.nome,
        }));
        log(`[periodo ${dataInicio}..${dataFim}] usando ${profListaEffective.length} profissionais das metas (Trinks vazio)`, "equipe");
      } catch (e: any) {
        log(`[periodo ${dataInicio}..${dataFim}] fallback metas falhou: ${e?.message}`, "equipe");
      }
    }
    // Se snapshots cobrem tudo, usa direto sem chamar API. Senão chama com
    // timeout de 5s — se Trinks demorar (rate limit + retries com backoff),
    // abandona e usa o que tiver de snapshot pra não travar a página.
    const PERIODO_TRINKS_TIMEOUT_MS = 5000;
    const withTimeout = <T>(p: Promise<T>, fallback: T, label: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>(resolve => setTimeout(() => {
          log(`[periodo ${dataInicio}..${dataFim}] timeout Trinks ${label} — usando snapshots`, "equipe");
          resolve(fallback);
        }, PERIODO_TRINKS_TIMEOUT_MS)),
      ]);
    const agendData = cobreTudo ? snapshotsAgend : await withTimeout(
      trinksFetchAllRange("agendamentos", { dataInicio, dataFim }).catch((e: any) => {
        log(`[periodo ${dataInicio}..${dataFim}] erro agendamentos: ${e?.message} — fallback pra snapshots`, "equipe");
        return snapshotsAgend;
      }),
      snapshotsAgend,
      "agendamentos",
    );
    const transData = cobreTudo ? snapshotsTrans : await withTimeout(
      trinksFetchAllRange("transacoes", { dataInicio, dataFim: transFim }).catch((e: any) => {
        log(`[periodo ${dataInicio}..${dataFim}] erro transacoes: ${e?.message} — fallback pra snapshots`, "equipe");
        return snapshotsTrans;
      }),
      snapshotsTrans,
      "transacoes",
    );
    const profLista = profListaEffective; // v37.3: usa fallback de metas se Trinks zerou
    const agendLista = Array.isArray(agendData) ? agendData : (agendData?.data || []);
    const transLista = Array.isArray(transData) ? transData : (transData?.data || []);

    const norm = (s: any) => String(s || "").trim().toLowerCase();

    // ── Mapa ID novo → nome canonico, e nome canonico → ID primário ──
    const idNovoParaNome: Map<string, string> = new Map();
    const nomeParaIdPrimario: Map<string, string> = new Map();
    profLista.forEach((p: any) => {
      const id = String(p.id);
      const nome = (p.nome || p.apelido || "").trim();
      if (!id || !nome) return;
      idNovoParaNome.set(id, nome);
      if (!nomeParaIdPrimario.has(norm(nome))) nomeParaIdPrimario.set(norm(nome), id);
    });
    // v39.1: dicionário manual de IDs (Configurações → profissionais conhecidos).
    // Essencial quando a API Trinks está bloqueada: resolve IDs legados
    // (ex: 653128 → ANDRÉ) que não vêm das metas nem da API.
    try {
      const conhecidos = await getProfsConhecidos();
      for (const [id, nome] of Object.entries(conhecidos)) {
        const n = String(nome || "").trim();
        if (!id || !n) continue;
        idNovoParaNome.set(String(id), n);
        if (!nomeParaIdPrimario.has(norm(n))) nomeParaIdPrimario.set(norm(n), String(id));
      }
    } catch { /* ignora */ }

    // ── Heurística ID legado → nome via cruzamento (data, nomeCliente) com agendamentos ──
    // IMPORTANTE: cliente.id difere entre /v1/agendamentos e /v1/transacoes (namespaces distintos).
    // O nome do cliente normalizado é o pivot estável.
    type IdxKey = string;
    const idxAgendPorDataCliente = new Map<IdxKey, { nome: string }[]>();
    agendLista.forEach((ag: any) => {
      const dt = String(ag.dataHoraInicio || ag.data || "").slice(0, 10);
      const nomeCli = norm(ag.cliente?.nome);
      const nomeProf = (ag.profissional?.nome || ag.profissional?.apelido || "").trim();
      if (!dt || !nomeCli || !nomeProf) return;
      const k = `${dt}|${nomeCli}`;
      const arr = idxAgendPorDataCliente.get(k) || [];
      arr.push({ nome: nomeProf });
      idxAgendPorDataCliente.set(k, arr);
    });
    const freqNomePorIdLegado = new Map<string, Map<string, number>>();
    transLista.forEach((t: any) => {
      const dt = String(t.dataHora || "").slice(0, 10);
      const nomeCli = norm(t.cliente?.nome);
      if (!dt || !nomeCli) return;
      const cands = idxAgendPorDataCliente.get(`${dt}|${nomeCli}`);
      if (!cands || cands.length === 0) return;
      const idsLeg = new Set<string>();
      (t.produtos || []).forEach((p: any) => {
        const v = String(p.IdProfissionalQueRealizouAVenda || p.idProfissionalQueRealizouAVenda || "");
        if (v) idsLeg.add(v);
      });
      (t.servicos || []).forEach((s: any) => {
        const v = String(s.idProfissionalQueRealizouServico || s.IdProfissionalQueRealizouOServico || "");
        if (v) idsLeg.add(v);
      });
      idsLeg.forEach(idLeg => {
        const mp = freqNomePorIdLegado.get(idLeg) || new Map<string, number>();
        cands.forEach(c => {
          const peso = cands.length === 1 ? 3 : 1;
          mp.set(c.nome, (mp.get(c.nome) || 0) + peso);
        });
        freqNomePorIdLegado.set(idLeg, mp);
      });
    });
    const idLegadoParaNome = new Map<string, string>();
    freqNomePorIdLegado.forEach((freq, idLeg) => {
      let melhorNome = ""; let melhorScore = 0;
      freq.forEach((score, nome) => { if (score > melhorScore) { melhorScore = score; melhorNome = nome; } });
      if (melhorNome) idLegadoParaNome.set(idLeg, melhorNome);
    });

    // Resolve qualquer ID (novo ou legado) → { nome, idPrimario }.
    const resolveProf = (id: string): { nome: string; idPrimario: string } | null => {
      if (!id) return null;
      // 1º ID novo direto
      const nomeNovo = idNovoParaNome.get(id);
      if (nomeNovo) return { nome: nomeNovo, idPrimario: nomeParaIdPrimario.get(norm(nomeNovo)) || id };
      // 2º ID legado mapeado por heurística
      const nomeLeg = idLegadoParaNome.get(id);
      if (nomeLeg) {
        const idPrim = nomeParaIdPrimario.get(norm(nomeLeg)) || id;
        return { nome: nomeLeg, idPrimario: idPrim };
      }
      // 3º desconhecido: usa o próprio ID
      return { nome: `Profissional ${id}`, idPrimario: id };
    };

    // Agrega por idPrimario (canonico)
    const porProf: Record<string, {
      profissionalId: string; nome: string; idsConhecidos: string[];
      avulso:    { reais: number; count: number };
      plano:     { reais: number; count: number };
      servicos:  { reais: number; count: number; bruto: number; liquido: number };
      produtos:  { reais: number; count: number; bruto: number; liquido: number; liquidoComissionavel: number; brutoComissionavel: number };
      taxaCartao: number;
      custoInsumos: number;
      total:     { reais: number; count: number };
    }> = {};
    const ensureProf = (idPrim: string, nome: string, idOriginal: string) => {
      if (!porProf[idPrim]) porProf[idPrim] = {
        profissionalId: idPrim, nome, idsConhecidos: [],
        avulso:    { reais: 0, count: 0 },
        plano:     { reais: 0, count: 0 },
        servicos:  { reais: 0, count: 0, bruto: 0, liquido: 0 },
        produtos:  { reais: 0, count: 0, bruto: 0, liquido: 0, liquidoComissionavel: 0, brutoComissionavel: 0 },
        taxaCartao: 0,
        custoInsumos: 0,
        total:     { reais: 0, count: 0 },
      };
      if (idOriginal && !porProf[idPrim].idsConhecidos.includes(idOriginal)) porProf[idPrim].idsConhecidos.push(idOriginal);
      return porProf[idPrim];
    };

    // Carrega taxa de cartao para descontar do liquido proporcionalmente.
    const cfg = await getConfigFin();
    const taxaCartao = (cfg.taxaCartaoPct || 0) / 100; // 0..1

    // Carrega overrides manuais de profissional por item (aba Conciliação).
    // Usado quando o Trinks não trouxe profId no item original.
    const overrides = await getOverrides();

    // Lista de produtos que NÃO entram no cálculo de comissão (bebidas, doces).
    // Bruto/Líquido continuam contando para rastreabilidade; o que muda é o
    // valor que vai para a base de comissão do profissional.
    const semComissao = await getProdutosSemComissao();

    // Índice de nomes de cliente em transações por dia (p/ heurística de plano)
    const transKeysPorDia: Map<string, Set<string>> = new Map();
    transLista.forEach((t: any) => {
      const dia = (t.dataHora || "").slice(0, 10);
      if (!dia) return;
      if (!transKeysPorDia.has(dia)) transKeysPorDia.set(dia, new Set());
      const n = norm(t.cliente?.nome);
      if (n) transKeysPorDia.get(dia)!.add(n);
    });

    // ── Avulso: atribui o totalPagar INTEGRAL ao profissional principal da transação.
    // Critério: profissional do item de maior valor (geralmente o serviço principal).
    // Isso garante: Σ avulso por profissional == Σ totalPagar (igual Dashboard).
    transLista.forEach((t: any) => {
      const totalT = Number(t.totalPagar || 0);
      if (totalT === 0) return;
      // Helper local: resolve profId aplicando override manual quando o original é vazio/skip.
      // Retorna "" se item deve ser ignorado (skip=true ou sem override e sem profId).
      const transId = String(t.id || "");
      const profIdServico = (s: any, idx: number): string => {
        const original = String(s.idProfissionalQueRealizouServico || s.IdProfissionalQueRealizouOServico || "");
        if (original) return original;
        const ov = lookupOverride(overrides, transId, "s", idx);
        if (!ov) return "";
        if (ov.skip) return ""; // explicitamente ignorado
        return ov.profissionalId || "";
      };
      const profIdProduto = (p: any, idx: number): string => {
        const original = String(p.IdProfissionalQueRealizouAVenda || p.idProfissionalQueRealizouAVenda || "");
        if (original) return original;
        const ov = lookupOverride(overrides, transId, "p", idx);
        if (!ov) return "";
        if (ov.skip) return "";
        return ov.profissionalId || "";
      };

      const itens: { profId: string; valor: number; tipo: "servico" | "produto" }[] = [];
      (t.servicos || []).forEach((s: any, i: number) => {
        const profId = profIdServico(s, i);
        const valor = Number(s.preco || s.valor || 0);
        if (profId) itens.push({ profId, valor, tipo: "servico" });
      });
      (t.produtos || []).forEach((p: any, i: number) => {
        const profId = profIdProduto(p, i);
        const valor = Number(p.valorUnitario || p.valor || 0) * Number(p.quantidade || 1);
        if (profId) itens.push({ profId, valor, tipo: "produto" });
      });

      // Determina profissional principal: maior valor (serviço pesa mais que produto se empate).
      let profPrincipal = "";
      if (itens.length > 0) {
        const ordenado = [...itens].sort((a, b) => {
          if (b.valor !== a.valor) return b.valor - a.valor;
          if (a.tipo === "servico" && b.tipo !== "servico") return -1;
          if (b.tipo === "servico" && a.tipo !== "servico") return 1;
          return 0;
        });
        profPrincipal = ordenado[0].profId;
      } else {
        profPrincipal = String(t.profissionalId || t.profissional?.id || "");
      }
      if (!profPrincipal) return;
      const r = resolveProf(profPrincipal);
      if (!r) return;
      const p = ensureProf(r.idPrimario, r.nome, profPrincipal);
      p.avulso.reais += totalT;
      p.avulso.count += 1;

      // ── Quebra item-a-item por dono real (serviços × produtos) ──
      // BRUTO   = soma de valorUnitario × quantidade (preço de tabela do item)
      // LÍQUIDO = bruto × fator(totalPagar/Σitens) × (1 - taxaCartão × fraçãoCartão)
      //   - fator absorve descontos/cortesias da transação
      //   - taxa cartão só incide sobre a parcela que foi paga em cartão
      const somaServicos = (t.servicos || []).reduce((a: number, s: any) => a + Number(s.preco || s.valor || 0), 0);
      const somaProdutos = (t.produtos || []).reduce((a: number, pp: any) =>
        a + (Number(pp.valorUnitario || pp.valor || 0) * Number(pp.quantidade || 1)), 0);
      const somaItens = somaServicos + somaProdutos;
      // Fator de proporção: se Σitens=0 (transação só com pacote/sem itens), usa 1.
      const fator = somaItens > 0 && totalT > 0 ? totalT / somaItens : 1;
      // Fração do totalPagar que veio em cartão (0..1)
      const fCart = fracaoCartao(t.formasPagamentos || []);
      // Multiplicador líquido depois da taxa cartão
      const ajusteLiquido = fator * (1 - taxaCartao * fCart);
      // Multiplicador da taxa cartão em si (para agregar em separado).
      const fatorTaxaCartao = fator * taxaCartao * fCart;

      (t.servicos || []).forEach((s: any, i: number) => {
        const profId = profIdServico(s, i);
        const valorBruto = Number(s.preco || s.valor || 0);
        if (!profId || valorBruto <= 0) return;
        const rs = resolveProf(profId);
        if (!rs) return;
        const ps = ensureProf(rs.idPrimario, rs.nome, profId);
        const valorLiquido = valorBruto * ajusteLiquido;
        ps.servicos.bruto   += valorBruto;
        ps.servicos.liquido += valorLiquido;
        // 'reais' mantido para compatibilidade = liquido (base de comissão)
        ps.servicos.reais   += valorLiquido;
        ps.servicos.count   += 1;
        ps.taxaCartao       += valorBruto * fatorTaxaCartao;
      });
      (t.produtos || []).forEach((pp: any, i: number) => {
        const profId = profIdProduto(pp, i);
        const qtd = Number(pp.quantidade || 1);
        const valorBruto = Number(pp.valorUnitario || pp.valor || 0) * qtd;
        if (!profId || valorBruto <= 0) return;
        const rp = resolveProf(profId);
        if (!rp) return;
        const pr = ensureProf(rp.idPrimario, rp.nome, profId);
        const valorLiquido = valorBruto * ajusteLiquido;
        pr.produtos.bruto   += valorBruto;
        pr.produtos.liquido += valorLiquido;
        pr.produtos.reais   += valorLiquido;
        pr.produtos.count   += qtd;
        pr.taxaCartao       += valorBruto * fatorTaxaCartao;
        // Comissionável: exclui produtos marcados como "sem comissão"
        // (bebidas, doces, snacks). Usado como base para cálculo de comissão
        // de produto na aba Pagamento, mantendo bruto/líquido total intactos.
        const produtoIdStr = String(pp.id || pp.produtoId || "");
        if (produtoIdStr && !semComissao.has(produtoIdStr)) {
          pr.produtos.brutoComissionavel   += valorBruto;
          pr.produtos.liquidoComissionavel += valorLiquido;
        }
      });
    });

    // ── Plano: agendamentos Confirmado/Finalizado sem transação do mesmo cliente ──
    agendLista.forEach((a: any) => {
      const status = (typeof a.status === "string" ? a.status : (a.status?.nome || a.status?.descricao || "")).toLowerCase();
      if (!(status.includes("confirm") || status.includes("finaliz"))) return;
      const dia = (a.dataHoraInicio || a.dataHora || "").slice(0, 10);
      const nomeCli = norm(a.cliente?.nome);
      const nomesDoDia = transKeysPorDia.get(dia);
      if (nomeCli && nomesDoDia && nomesDoDia.has(nomeCli)) return;
      const profId = String(a.profissionalId || a.profissional?.id || "");
      if (!profId) return;
      const r = resolveProf(profId);
      if (!r) return;
      const valor = Number(a.valor || a.valorTotal || 0)
        || (Array.isArray(a.servicos) ? a.servicos.reduce((s: number, sv: any) => s + Number(sv.preco || sv.valor || 0), 0) : 0);
      const p = ensureProf(r.idPrimario, r.nome, profId);
      p.plano.reais += valor;
      p.plano.count += 1;
    });

    // Custo de insumos por profissional: soma a ficha técnica dos serviços
    // executados (agendamentos finalizados). Usado se o modo de comissão for
    // 'liquido' (profissional não recebe comissão sobre o custo do material).
    const custoFichaPorServicoId = new Map<string, number>();
    for (const sc of serviceCosts) {
      const total = (sc.items || []).reduce(
        (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0),
        0
      );
      custoFichaPorServicoId.set(String(sc.serviceId), total);
    }
    agendLista.forEach((a: any) => {
      const status = (typeof a.status === "string" ? a.status : (a.status?.nome || "")).toLowerCase();
      if (!status.includes("finaliz")) return;
      const profIdRaw = String(a.profissionalId || a.profissional?.id || "");
      if (!profIdRaw) return;
      const r = resolveProf(profIdRaw);
      if (!r) return;
      const p = porProf[r.idPrimario];
      if (!p) return;
      const svcId = String(a.servico?.id || a.servicoId || "");
      const custoUnit = svcId ? (custoFichaPorServicoId.get(svcId) || 0) : 0;
      if (custoUnit > 0) p.custoInsumos += custoUnit;
    });

    // Totais consolidados por profissional
    Object.values(porProf).forEach(p => {
      p.total.reais = p.avulso.reais + p.plano.reais;
      p.total.count = p.avulso.count + p.plano.count;
    });

    const totais = Object.values(porProf).reduce(
      (acc, p) => ({
        reais: acc.reais + p.total.reais, count: acc.count + p.total.count,
        avulsoReais: acc.avulsoReais + p.avulso.reais, avulsoCount: acc.avulsoCount + p.avulso.count,
        planoReais: acc.planoReais + p.plano.reais,   planoCount: acc.planoCount + p.plano.count,
        servicosReais: acc.servicosReais + p.servicos.reais, servicosCount: acc.servicosCount + p.servicos.count,
        servicosBruto: acc.servicosBruto + p.servicos.bruto, servicosLiquido: acc.servicosLiquido + p.servicos.liquido,
        produtosReais: acc.produtosReais + p.produtos.reais, produtosCount: acc.produtosCount + p.produtos.count,
        produtosBruto: acc.produtosBruto + p.produtos.bruto, produtosLiquido: acc.produtosLiquido + p.produtos.liquido,
        produtosBrutoComissionavel: acc.produtosBrutoComissionavel + p.produtos.brutoComissionavel,
        produtosLiquidoComissionavel: acc.produtosLiquidoComissionavel + p.produtos.liquidoComissionavel,
      }),
      { reais: 0, count: 0, avulsoReais: 0, avulsoCount: 0, planoReais: 0, planoCount: 0, servicosReais: 0, servicosCount: 0, servicosBruto: 0, servicosLiquido: 0, produtosReais: 0, produtosCount: 0, produtosBruto: 0, produtosLiquido: 0, produtosBrutoComissionavel: 0, produtosLiquidoComissionavel: 0 }
    );

    const result = {
      dataInicio, dataFim, porProfissional: porProf, totais,
      config: { taxaCartaoPct: cfg.taxaCartaoPct || 0 },
      _diag: { profCount: profLista.length, agendCount: agendLista.length, transCount: transLista.length, idsLegMapeados: idLegadoParaNome.size },
      fetchedAt: new Date().toISOString(),
    };
    setCache(cacheKey, result, 3 * 60 * 1000); // cache 3min
    return result;
  }

  // Função interna: retorna previsão do próximo dia útil (terça..sábado)
  async function calcularAmanha(): Promise<ResumoAmanhaData & { agendamentos: any[] }> {
    const tzFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    });
    const addDays = (base: Date, days: number) => new Date(base.getTime() + days * 86400000);
    const hojeBase = new Date();
    const pick = (parts: Intl.DateTimeFormatPart[], type: string) =>
      parts.find(p => p.type === type)?.value || "";
    const weekdayToNum: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    let offset = 1;
    let alvo = addDays(hojeBase, offset);
    let info = tzFmt.formatToParts(alvo);
    let dow = weekdayToNum[pick(info, "weekday")] ?? -1;
    while (dow === 0 || dow === 1) {
      offset += 1;
      alvo = addDays(hojeBase, offset);
      info = tzFmt.formatToParts(alvo);
      dow = weekdayToNum[pick(info, "weekday")] ?? -1;
      if (offset > 7) break;
    }
    const amanha = `${pick(info, "year")}-${pick(info, "month")}-${pick(info, "day")}`;
    const proxDiaUtil = offset > 1;

    const data = await getAgendamentosPreferCsv(
      { dataInicio: amanha, dataFim: amanha },
      () => trinksFetchAll("agendamentos", { dataInicio: amanha, dataFim: amanha }),
    );
    const lista = Array.isArray(data) ? data : (data?.data || []);
    const statusIgnorar = ["cancelado", "cancelada", "no show", "no-show", "faltou"];
    const isValido = (a: any) => {
      const s = (typeof a.status === "string" ? a.status : (a.status?.descricao || a.status?.nome || "")).toLowerCase();
      return !statusIgnorar.some(ig => s.includes(ig));
    };

    let total = 0;
    const porProf: Record<string, { nome: string; total: number; count: number }> = {};
    const agendamentos: any[] = [];
    lista.filter(isValido).forEach((a: any) => {
      let v = Number(a.valor || a.valorTotal || a.totalPagar || 0);
      if ((!v || v === 0) && Array.isArray(a.servicos)) {
        v = a.servicos.reduce((s: number, svc: any) =>
          s + Number(svc.preco || svc.valor || svc.valorServico || 0), 0);
      }
      total += v;
      const profId = String(a.profissionalId || a.profissional?.id || "");
      const profNome = a.profissional?.nome || a.profissionalNome || "—";
      if (profId) {
        if (!porProf[profId]) porProf[profId] = { nome: profNome, total: 0, count: 0 };
        porProf[profId].total += v;
        porProf[profId].count += 1;
      }
      agendamentos.push({
        hora: (a.dataHoraInicio || a.dataHora || "").slice(11, 16),
        valor: v, profissional: profNome,
      });
    });
    const ranking = Object.values(porProf).sort((a, b) => b.total - a.total);
    const metaDia = metaDiaria;
    return {
      data: amanha,
      proxDiaUtil,
      total,
      count: agendamentos.length,
      metaDiaria: metaDia,
      atingeMeta: total >= metaDia,
      falta: Math.max(0, metaDia - total),
      progressoPct: metaDia > 0 ? (total / metaDia) * 100 : 0,
      porProfissional: ranking,
      agendamentos,
    };
  }

  // ─── GET /api/trinks/hoje-completo ─────────────────────────
  // Retorna dados completos do dia: faturamento previsto (agendamentos) +
  // já fechado (comandas) + restante esperado. Útil para o card 'Hoje'.
  app.get("/api/trinks/hoje-completo", async (_req: Request, res: Response) => {
    try {
      const cacheKey = `hoje_completo_${new Date().toISOString().slice(0, 10)}`;
      const cached = getCached(cacheKey) as any;
      // v35: se o cache tem dado mas marcado como pendente, ignora e calcula
      // de novo (transações podem ter chegado em background)
      if (cached && !cached.transacoesPendente) return res.json({ ...cached, fromCache: true });
      const result = await calcularHojeCompleto();
      // TTL menor (30s) quando pendente, pra polling pegar atualização rápido
      const ttl = (result as any).transacoesPendente ? 30 * 1000 : 2 * 60 * 1000;
      setCache(cacheKey, result, ttl);
      return res.json(result);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  app.get("/api/trinks/transacoes", async (req: Request, res: Response) => {
    try {
      const params: Record<string, string> = {};
      if (req.query.dataInicio) params.dataInicio = String(req.query.dataInicio);
      if (req.query.dataFim) params.dataFim = String(req.query.dataFim);
      const data = await trinksFetchAll("transacoes", params);
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/amanha ─ Previsão de faturamento do próximo dia útil ───
  // Considera funcionamento terça a sábado (fecha domingo e segunda)
  app.get("/api/trinks/amanha", async (_req: Request, res: Response) => {
    try {
      // Descobre o próximo dia útil (terça a sábado) em TZ America/Sao_Paulo
      const tzFmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric", month: "2-digit", day: "2-digit",
        weekday: "short",
      });

      const addDays = (base: Date, days: number) => new Date(base.getTime() + days * 86400000);
      const hojeBase = new Date();

      // Encontra próximo dia útil: terça..sábado (dow 2..6)
      let offset = 1;
      let alvo = addDays(hojeBase, offset);
      let info = tzFmt.formatToParts(alvo);
      const pick = (parts: Intl.DateTimeFormatPart[], type: string) =>
        parts.find(p => p.type === type)?.value || "";
      const weekdayToNum: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      let dow = weekdayToNum[pick(info, "weekday")] ?? -1;
      // Pula domingo (0) e segunda (1)
      while (dow === 0 || dow === 1) {
        offset += 1;
        alvo = addDays(hojeBase, offset);
        info = tzFmt.formatToParts(alvo);
        dow = weekdayToNum[pick(info, "weekday")] ?? -1;
        if (offset > 7) break; // safety
      }

      const yyyy = pick(info, "year");
      const mm = pick(info, "month");
      const dd = pick(info, "day");
      const amanha = `${yyyy}-${mm}-${dd}`;
      const proxDiaUtil = offset > 1; // verdadeiro se pulou dias

      const cacheKey = `amanha_${amanha}`;
      const cached = getCached(cacheKey);
      if (cached) return res.json({ ...cached, fromCache: true });

      const verbose = await getAgendamentosPreferCsvVerbose(
        { dataInicio: amanha, dataFim: amanha },
        () => trinksFetchAll("agendamentos", { dataInicio: amanha, dataFim: amanha }),
      );
      const data = verbose.data;
      const fonteAmanha = verbose.fonte; // "csv" | "trinks-api"
      const csvGeradoEmAmanha = verbose.csvGeradoEm;
      const lista = Array.isArray(data) ? data : ((data as any)?.data || []);

      // Status que NÃO contam (cancelados, no-show etc.)
      const statusIgnorar = ["cancelado", "cancelada", "no show", "no-show", "faltou"];
      const isAgendamentoValido = (a: any) => {
        const st = a.status;
        const nome = (typeof st === "string" ? st : (st?.descricao || st?.nome || "")).toLowerCase();
        return !statusIgnorar.some(s => nome.includes(s));
      };

      let totalPrevisto = 0;
      const porProfissional: Record<string, { nome: string; total: number; count: number }> = {};
      const agendamentos: any[] = [];

      lista.filter(isAgendamentoValido).forEach((a: any) => {
        // Tenta vários campos de valor
        let val = Number(a.valor || a.valorTotal || a.totalPagar || 0);

        // Se houver array de serviços, soma
        if ((!val || val === 0) && Array.isArray(a.servicos)) {
          val = a.servicos.reduce((s: number, svc: any) => {
            return s + Number(svc.preco || svc.valor || svc.valorServico || 0);
          }, 0);
        }

        totalPrevisto += val;

        const profId = String(a.profissionalId || a.profissional?.id || "");
        const profNome = a.profissional?.nome || a.profissionalNome || "—";
        if (profId) {
          if (!porProfissional[profId]) {
            porProfissional[profId] = { nome: profNome, total: 0, count: 0 };
          }
          porProfissional[profId].total += val;
          porProfissional[profId].count += 1;
        }

        const hora = (a.dataHoraInicio || a.dataHora || "").slice(11, 16);
        const clienteNome = a.cliente?.nome || a.clienteNome || "Cliente";
        const servicoNome = a.servico?.nome
          || (Array.isArray(a.servicos) ? a.servicos.map((s: any) => s.nome).filter(Boolean).join(", ") : "")
          || a.servicoNome
          || "—";
        const statusStr = (typeof a.status === "string" ? a.status : (a.status?.descricao || a.status?.nome || "")) || "agendado";

        agendamentos.push({
          id: a.id,
          hora,
          cliente: clienteNome,
          profissional: profNome,
          servico: servicoNome,
          valor: val,
          status: statusStr,
        });
      });

      agendamentos.sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));

      const ranking = Object.values(porProfissional)
        .sort((a, b) => b.total - a.total);

      const metaDia = metaDiaria;
      const atingeMeta = totalPrevisto >= metaDia;
      const falta = Math.max(0, metaDia - totalPrevisto);
      const progressoPct = metaDia > 0 ? (totalPrevisto / metaDia) * 100 : 0;

      const result = {
        data: amanha,
        proxDiaUtil, // true se não for literalmente "amanhã" (pulou fim de semana / folga)
        total: totalPrevisto,
        count: agendamentos.length,
        metaDiaria: metaDia,
        atingeMeta,
        falta,
        progressoPct,
        porProfissional: ranking,
        agendamentos,
        // v34: fonte dos dados pra UI mostrar 'CSV' ou 'Trinks API'
        fonteAgendamentos: fonteAmanha,
        csvGeradoEm: csvGeradoEmAmanha || null,
        fetchedAt: new Date().toISOString(),
      };

      setCache(cacheKey, result, 5 * 60 * 1000); // 5 min
      return res.json(result);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/clientes ───────────────────────────
  app.get("/api/trinks/clientes", async (_req: Request, res: Response) => {
    try {
      const data = await trinksFetchAll("clientes");
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/lancamentos ────────────────────────
  app.get("/api/trinks/lancamentos", async (req: Request, res: Response) => {
    try {
      const params: Record<string, string> = {};
      if (req.query.dataInicio) params.dataInicio = String(req.query.dataInicio);
      if (req.query.dataFim) params.dataFim = String(req.query.dataFim);
      const data = await trinksFetchAll("lancamentos", params);
      return res.json(data);
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/sync — Smart sync with cache ───────
  app.get("/api/trinks/sync", async (req: Request, res: Response) => {
    try {
      if (!trinksConfig) {
        return res.status(400).json({ error: "Chave API da Trinks não configurada." });
      }

      const forceRefresh = req.query.force === "true";

      // Check if we have a valid full sync cache
      // CRÍTICO: validar que AMBOS agendamentos E transações têm dados.
      // Se um deles está zerado em mes corrente, o cache foi corrompido por erro temporário do Trinks.
      function cacheLooksHealthy(c: any): boolean {
        if (!c) return false;
        const ag = c.agendamentos?.length || 0;
        const tr = c.transacoes?.length || 0;
        // Em mes ativo, se ag>50 mas tr==0 (ou vice-versa), cache está quebrado.
        // Tolera ambos zerados (início do mês ou estabelecimento sem movimento).
        if (ag === 0 && tr === 0) return false;
        if (ag > 50 && tr === 0) return false; // tem agend mas perdeu trans
        if (tr > 50 && ag === 0) return false; // tem trans mas perdeu agend
        return true;
      }

      if (!forceRefresh) {
        const cachedSync = getCached("full_sync");
        if (cachedSync) {
          if (cacheLooksHealthy(cachedSync)) {
            log("Sync: returning cached data (use ?force=true to refresh)", "trinks");
            return res.json({ ...cachedSync, fromCache: true });
          } else {
            log(`Sync: memory cache unhealthy (ag=${cachedSync.agendamentos?.length||0}, tr=${cachedSync.transacoes?.length||0}), fetching fresh`, "trinks");
            invalidateCache("full_sync");
          }
        }
      }

      // Check disk cache as fallback (survives server restarts)
      if (!forceRefresh) {
        const diskCache = loadSyncCacheFromDisk();
        if (diskCache) {
          if (cacheLooksHealthy(diskCache)) {
            setCache("full_sync", diskCache);
            return res.json({ ...diskCache, fromCache: true, fromDisk: true });
          } else {
            log(`Sync: disk cache unhealthy (ag=${diskCache.agendamentos?.length||0}, tr=${diskCache.transacoes?.length||0}), fetching fresh`, "trinks");
          }
        }
      }

      // If forcing refresh, clear caches for time-sensitive data
      if (forceRefresh) {
        invalidateCache("agendamentos");
        invalidateCache("transacoes");
        invalidateCache("lancamentos");
        invalidateCache("full_sync");
        log("Sync: force refresh — cleared time-sensitive caches", "trinks");
      }

      // Current month date range
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const dataInicio = `${year}-${month}-01`;
      const dataFim = `${year}-${month}-${String(now.getDate()).padStart(2, "0")}`;
      const dateParams = { dataInicio, dataFim };

      // SEQUENTIAL fetching to control rate precisely
      // Each trinksFetchAll checks its own cache first, so cached endpoints cost 0 API calls
      log("Sync: fetching estabelecimento...", "trinks");
      const estabelecimento = await trinksFetchAll("estabelecimentos", undefined, { skipEstabHeader: true })
        .catch((e: any) => { log(`estabelecimento error: ${e.message}`, "trinks"); return { _error: e.message }; });

      log("Sync: fetching profissionais...", "trinks");
      const profissionais = await trinksFetchAll("profissionais")
        .catch((e: any) => { log(`profissionais error: ${e.message}`, "trinks"); return []; });

      log("Sync: fetching servicos...", "trinks");
      const servicos = await trinksFetchAll("servicos")
        .catch((e: any) => { log(`servicos error: ${e.message}`, "trinks"); return []; });

      log("Sync: fetching agendamentos...", "trinks");
      const agendamentos = await trinksFetchAll("agendamentos", dateParams)
        .catch((e: any) => { log(`agendamentos error: ${e.message}`, "trinks"); return []; });

      log("Sync: fetching transacoes...", "trinks");
      const transacoes = await trinksFetchAll("transacoes", dateParams)
        .catch((e: any) => { log(`transacoes error: ${e.message}`, "trinks"); return []; });

      log("Sync: fetching clientes...", "trinks");
      const clientes = await trinksFetchAll("clientes")
        .catch((e: any) => { log(`clientes error: ${e.message}`, "trinks"); return []; });

      const syncResult = {
        estabelecimento,
        profissionais: Array.isArray(profissionais) ? profissionais : [],
        servicos: Array.isArray(servicos) ? servicos : [],
        agendamentos: Array.isArray(agendamentos) ? agendamentos : [],
        transacoes: Array.isArray(transacoes) ? transacoes : [],
        clientes: Array.isArray(clientes) ? clientes : [],
        syncedAt: new Date().toISOString(),
      };

      log(`Sync complete: ${syncResult.profissionais.length} profissionais, ${syncResult.servicos.length} servicos, ${syncResult.agendamentos.length} agendamentos, ${syncResult.transacoes.length} transacoes, ${syncResult.clientes.length} clientes`, "trinks");

      // Only cache if we actually got data AND it's healthy
      // (avoid persistir cache pela metade quando 1 dos fetches falha)
      const ag = syncResult.agendamentos.length;
      const tr = syncResult.transacoes.length;
      const isHealthy = (ag > 0 && tr > 0) || (ag === 0 && tr === 0);
      const hasAny = ag > 0 || tr > 0;
      if (isHealthy && hasAny) {
        setCache("full_sync", syncResult);
        saveSyncCacheToDisk(syncResult);
      } else if (!hasAny) {
        log("Sync: skipping cache — agendamentos and transacoes both empty", "trinks");
      } else {
        log(`Sync: skipping cache — unhealthy (ag=${ag}, tr=${tr}). Result still returned but not cached.`, "trinks");
      }

      // Registra timestamp do sync Trinks por mês (resolvedor de fonte CSV vs Trinks)
      // Só registra quando temos dados saudáveis — sync com 0/0 ou parcial não conta.
      if (isHealthy && hasAny) {
        try {
          const mesSync = `${year}-${month}`;
          await registrarSyncTrinks(mesSync, { agendamentos: ag, transacoes: tr });
        } catch (e: any) {
          log(`Sync: erro ao registrar meta (${e?.message}) — ignorando`, "trinks");
        }
      }

      return res.json(syncResult);
    } catch (err: any) {
      // On rate limit error, try to return cached data
      if (err?.status === 429) {
        const diskCache = loadSyncCacheFromDisk();
        if (diskCache) {
          log("Sync: rate limited, returning disk cache as fallback", "trinks");
          return res.json({ ...diskCache, fromCache: true, rateLimited: true, 
            warning: "Limite de requisições atingido. Mostrando dados do último sync." });
        }
      }
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/trinks/sync-mes/:mes — sync para mês arbitrário ───
  // Retorna o MESMO formato de /api/trinks/sync, mas para o mês pedido (YYYY-MM).
  // Usado pelo Dashboard quando o usuário seleciona um mês ≠ corrente.
  // Reaproveita o cache (com TTL 24h em meses fechados via otimização C).
  app.get("/api/trinks/sync-mes/:mes", async (req: Request, res: Response) => {
    try {
      if (!trinksConfig) {
        return res.status(400).json({ error: "Chave API da Trinks não configurada." });
      }
      const mes = String(req.params.mes || "").trim();
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: "Mês inválido. Use YYYY-MM." });
      }

      // ├── Modo csv-first: se já temos CSV importado do mês, não gasta Trinks.
      //    Use ?force=1 pra ignorar (sync explícito do usuário admin).
      const force = String(req.query.force || "").trim() === "1";
      if (!force && getModoFonte() === "csv-first" && await temCsvDoMes(mes)) {
        log(`[sync-mes/${mes}] bloqueado: modo csv-first e já existe CSV do mês. Use ?force=1 para sobrescrever.`, "trinks");
        return res.status(409).json({
          error: `Mês ${mes} já tem CSV importado. Sync Trinks bloqueado em modo csv-first. Use ?force=1 se realmente quiser sincronizar (gasta API).`,
          motivo: "csv-first",
          mes,
        });
      }

      // ├── Trava 6h: protege contra cliques repetidos no botão de sync.
      //    Cada sync de mês dispara 80-200 chamadas (paginated). Sem trava, 1 usuário
      //    abrindo o dashboard 10x pode queimar 2000+ tokens. Com ?force=1 pula a trava.
      if (!force) {
        const travaKey = `trinks:sync-mes:trava:${mes}`;
        const ultimoSync = await kvGet<number>(travaKey);
        const agora = Date.now();
        const SEIS_HORAS = 6 * 60 * 60 * 1000;
        if (ultimoSync && (agora - ultimoSync) < SEIS_HORAS) {
          const minutosFalta = Math.ceil((SEIS_HORAS - (agora - ultimoSync)) / 60000);
          log(`[sync-mes/${mes}] bloqueado pela trava 6h (faltam ${minutosFalta}min). Use ?force=1.`, "trinks");
          return res.status(429).json({
            error: `Sync deste mês foi feito há menos de 6h. Aguarde ${minutosFalta} minutos ou use ?force=1.`,
            motivo: "trava-6h",
            ultimoSyncAt: new Date(ultimoSync).toISOString(),
          });
        }
        // Registra agora; se o sync falhar, vai sobrescrever no próximo ok.
        try { await kvSet(travaKey, agora); } catch {}
      }
      // Calcula primeiro e último dia do mês pedido
      const [yStr, mStr] = mes.split("-");
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const ultimoDia = new Date(y, m, 0).getDate(); // mês 1-12 → day 0 do mês seguinte = último do mês atual
      const dataInicio = `${mes}-01`;
      const dataFim = `${mes}-${String(ultimoDia).padStart(2, "0")}`;

      // Em meses fechados, o trinksFetchAll já aplica TTL 24h (otimização C).
      // No corrente, segue 30min.
      const dateParams = { dataInicio, dataFim };

      log(`[sync-mes/${mes}] fetching profissionais/servicos/agendamentos/transacoes/clientes...`, "trinks");
      const profissionais = await trinksFetchAll("profissionais")
        .catch((e: any) => { log(`profissionais error: ${e.message}`, "trinks"); return []; });
      const servicos = await trinksFetchAll("servicos")
        .catch((e: any) => { log(`servicos error: ${e.message}`, "trinks"); return []; });
      const agendamentos = await trinksFetchAllRange("agendamentos", dateParams)
        .catch((e: any) => { log(`agendamentos error: ${e.message}`, "trinks"); return []; });
      // Trinks /v1/transacoes usa intervalo semi-aberto [dataInicio, dataFim) — sem +1
      // o último dia do mês é perdido (em abril/26 sumiam ~107 transações = R\$ 4-5 mil).
      const transFim = ymdAddDays(dataFim, 1);
      const transacoes = await trinksFetchAllRange("transacoes", { dataInicio, dataFim: transFim })
        .catch((e: any) => { log(`transacoes error: ${e.message}`, "trinks"); return []; });
      const clientes = await trinksFetchAll("clientes")
        .catch((e: any) => { log(`clientes error: ${e.message}`, "trinks"); return []; });

      const result = {
        estabelecimento: null,
        profissionais: Array.isArray(profissionais) ? profissionais : [],
        servicos: Array.isArray(servicos) ? servicos : [],
        agendamentos: Array.isArray(agendamentos) ? agendamentos : [],
        transacoes: Array.isArray(transacoes) ? transacoes : [],
        clientes: Array.isArray(clientes) ? clientes : [],
        syncedAt: new Date().toISOString(),
        mes,
        periodoIni: dataInicio,
        periodoFim: dataFim,
      };

      log(`[sync-mes/${mes}] complete: ag=${result.agendamentos.length} tr=${result.transacoes.length}`, "trinks");

      // Registra meta do sync por mês (resolvedor CSV vs Trinks)
      const ag2 = result.agendamentos.length;
      const tr2 = result.transacoes.length;
      const hasAny2 = ag2 > 0 || tr2 > 0;
      const isHealthy2 = (ag2 > 0 && tr2 > 0) || (ag2 === 0 && tr2 === 0);
      if (isHealthy2 && hasAny2) {
        try {
          await registrarSyncTrinks(mes, { agendamentos: ag2, transacoes: tr2 });
        } catch (e: any) {
          log(`[sync-mes/${mes}] erro ao registrar meta (${e?.message}) — ignorando`, "trinks");
        }
      }

      return res.json(result);
    } catch (err: any) {
      if (err?.status === 429) {
        return res.status(429).json({
          error: "Limite Trinks excedido. Tente novamente em alguns minutos.",
          rateLimited: true,
        });
      }
      return handleTrinksError(err, res);
    }
  });

  // ─── GET /api/mes/:mes/canonico — fonte ÚNICA da verdade (mesService) ──
  // Retorna a fonte escolhida + breakdown + auditoria de TODAS as fontes.
  // Substitui as cascatas espalhadas. Todos os endpoints novos devem usar.
  app.get("/api/mes/:mes/canonico", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "").trim();
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: "Mês inválido. Use YYYY-MM." });
      }
      const force = String(req.query.force || "") === "1";
      const data = await getMesDataCanonical(mes, { trinksFetchAllRange, log }, { force });
      return res.json(data);
    } catch (err: any) {
      log(`/api/mes/${req.params.mes}/canonico erro: ${err?.message}`, "mesService");
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // ─── GET /api/mes/:mes/fonte — badge da fonte do mês ──
  // v42.1: a DECISÃO de qual fonte representa o mês é do mesService (autoridade
  // ÚNICA). resolverFonte virou helper de metadados — usada aqui só para os
  // timestamps (csvAt/trinksAt) do badge, SEM poder de decisão. Assim o badge
  // nunca diverge do número exibido (antes podia: csv-first decidia em paralelo).
  app.get("/api/mes/:mes/fonte", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "").trim();
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: "Mês inválido. Use YYYY-MM." });
      }
      const [data, ts] = await Promise.all([
        getMesDataCanonical(mes, { trinksFetchAllRange, log }),
        resolverFonte(mes), // só p/ timestamps
      ]);
      const fonteUi =
        data.fonte === "api-trinks" ? "trinks" :
        (data.fonte === "csv-caixa" || data.fonte === "csv-financeiro") ? "csv" :
        "nenhuma";
      return res.json({
        fonte: fonteUi,
        fonteDetalhada: data.fonte,
        trinksAt: ts.trinksAt,
        csvAt: ts.csvAt,
        motivo: `Fonte do mês decidida pelo mesService: ${data.fonte}.`,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // ─── GET /api/mes/:mes/dados — divisão de trabalho por janela-de-tempo ──
  // v42: cada fonte governa a janela onde é melhor (não competem por score):
  //   • mês fechado  → CSV sempre (Financeiro p/ faturamento+breakdown); API NUNCA.
  //   • mês corrente → API governa o "agora"; CSV importado como provisório.
  // Retorna TrinksData da fonte da janela + meta de auditoria.
  app.get("/api/mes/:mes/dados", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "").trim();
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: "Mês inválido. Use YYYY-MM." });
      }

      // v41: mesService primeiro — fonte única canônica. Se devolveu dado,
      // usa esse e pula a cascata legada (CSV → API → snapshot). Garante
      // que TODAS as telas vejam o mesmo número pra um mês.
      // Timeout 12s: se a API Trinks tá lenta (paginação ou rate limit),
      // cai pra cascata legada que tem seus próprios fallbacks.
      try {
        const canonical = await Promise.race([
          getMesDataCanonical(mes, { trinksFetchAllRange, log }),
          new Promise<null>((_, rej) => setTimeout(() => rej(new Error("mesService timeout 12s")), 12_000)),
        ]);
        if (canonical && canonical.fonte !== "vazio" && canonical.transacoes.length > 0) {
          const fonteUi =
            canonical.fonte === "api-trinks" ? "trinks" :
            canonical.fonte === "csv-caixa" || canonical.fonte === "csv-financeiro" ? "csv" :
            "nenhuma";
          // Fase 1: dias úteis (ter-sáb, TZ SP) p/ projeção no Dashboard.
          const ultimoDiaMes = ultimoDiaDoMes(`${mes}-01`);
          const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          const fimDecorrido = mes < hojeSP.slice(0, 7) ? ultimoDiaMes : (hojeSP <= ultimoDiaMes ? hojeSP : ultimoDiaMes);
          const diasUteisTotal = contarDiasUteis(`${mes}-01`, ultimoDiaMes);
          const diasUteisDecorridos = contarDiasUteis(`${mes}-01`, fimDecorrido);
          return res.json({
            fonte: fonteUi,
            fonteDetalhada: canonical.fonte,
            trinksAt: canonical.fontesAuditoria.apiTrinks.capturadoEm,
            csvAt: canonical.fontesAuditoria.csvCaixa.geradoEm || canonical.fontesAuditoria.csvFinanceiro.geradoEm,
            motivo: `Fonte do mês: ${canonical.fonte} (${canonical.comandas} comandas, R$ ${canonical.faturamento.toFixed(2)}). Divergências entre fontes são nota de auditoria, não disputa.`,
            fontesAuditoria: canonical.fontesAuditoria,
            // Fase 1: campos JÁ calculados pelo mesService, antes descartados.
            faturamento: canonical.faturamento,
            comandas: canonical.comandas,
            breakdown: canonical.breakdown,
            diasUteisDecorridos,
            diasUteisTotal,
            dados: {
              estabelecimento: null,
              profissionais: [],
              servicos: [],
              agendamentos: canonical.agendamentos,
              transacoes: canonical.transacoes,
              clientes: [],
              syncedAt: canonical.capturadoEm,
              mes,
            },
          });
        }
      } catch (err: any) {
        log(`/api/mes/${mes}/dados mesService falhou, cai pra legado: ${err?.message}`, "mesService");
      }

      const meta = await resolverFonte(mes);

      // v42: REMOVIDO o "API-first pra meses passados".
      // Era a origem do timeout de ~12s: para um mês fechado com a Trinks em 429,
      // o endpoint tentava a API antes do CSV e pendurava a tela inteira mesmo
      // havendo CSV pronto. Agora mês fechado responde direto da cascata CSV
      // abaixo, sem JAMAIS tocar na Trinks. (O dia corrente segue ao vivo via
      // os endpoints dedicados de "hoje" e via mesService canônico acima.)

      // v39: cascata CSV (mês corrente OU API falhou)
      // 1. CSV CAIXA (relatório por comanda, breakdown PIX/cartão/dinheiro/pré-pago) — MAIS RICO
      // 2. CSV FINANCEIRO (formato antigo, valor agregado por pagamento)
      // 3. CSV de agendamentos do email
      // 4. API Trinks (fallback)
      try {
        const caixaPayload: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
        if (caixaPayload?.rows && Array.isArray(caixaPayload.rows) && caixaPayload.rows.length > 0) {
          // Constrói transações sintéticas pro mês a partir do CSV caixa
          const transSinteticas = caixaPayload.rows
            .filter((r: any) => (r.data || "").startsWith(mes))
            .map((r: any) => {
              const formas: any[] = [];
              if (r.totalCredito > 0) formas.push({ nome: "Cartão de Crédito", valor: r.totalCredito });
              if (r.totalDebito > 0) formas.push({ nome: "Cartão de Débito", valor: r.totalDebito });
              if (r.totalDinheiro > 0) formas.push({ nome: "Dinheiro", valor: r.totalDinheiro });
              if (r.totalPrePago > 0) formas.push({ nome: "Pré-Pago", valor: r.totalPrePago });
              if (r.totalOutros > 0) formas.push({ nome: "Outros", valor: r.totalOutros });
              return {
                id: `csvcaixa-${r.data}-${r.clienteId || r.clienteNome}`.replace(/\s+/g, "-"),
                dataReferencia: r.data,
                dataHora: r.data,
                totalPagar: r.totalGeral,
                formasPagamentos: formas,
                cliente: { id: r.clienteId, nome: r.clienteNome },
                totalServico: r.totalServico,
                totalProdutos: r.totalProdutos,
                qtdServicos: r.qtdServico,
                qtdProdutos: r.qtdProdutos,
              };
            });
          if (transSinteticas.length > 0) {
            return res.json({
              fonte: "csv-caixa",
              trinksAt: meta.trinksAt,
              csvAt: caixaPayload.geradoEm || meta.csvAt,
              motivo: `CSV Caixa Trinks (${transSinteticas.length} comandas no mês, breakdown completo de forma de pagamento).`,
              dados: {
                estabelecimento: null,
                profissionais: [],
                servicos: [],
                agendamentos: [],
                transacoes: transSinteticas,
                clientes: [],
                syncedAt: caixaPayload.geradoEm || new Date().toISOString(),
                mes,
              },
            });
          }
        }
      } catch { /* segue cascata */ }

      try {
        const finPayload: any = await kvGet(trinksImport.kvKeyFor("financeiro", mes));
        if (finPayload?.rows && Array.isArray(finPayload.rows) && finPayload.rows.length > 0) {
          // Constrói transacoes sintéticas a partir do CSV financeiro
          const transSinteticas = finPayload.rows
            .filter((r: any) => (r.data || "").startsWith(mes))
            .map((r: any) => ({
              id: `csvfin-${r.data}-${r.cliente || ""}-${r.valorReceber}`.replace(/\s+/g, "-"),
              dataReferencia: r.data,
              dataHora: r.data,
              totalPagar: Number(r.valorReceber || r.valorPago || 0),
              formasPagamentos: [{ nome: r.formaPagamento || r.tipoFormaPagamento || "outros", valor: Number(r.valorReceber || 0) }],
              cliente: { nome: r.cliente || "" },
            }));
          if (transSinteticas.length > 0) {
            return res.json({
              fonte: "csv-financeiro",
              trinksAt: meta.trinksAt,
              csvAt: finPayload.geradoEm || meta.csvAt,
              motivo: `CSV financeiro Trinks (${transSinteticas.length} transações no mês).`,
              dados: {
                estabelecimento: null,
                profissionais: [],
                servicos: [],
                agendamentos: [],
                transacoes: transSinteticas,
                clientes: [],
                syncedAt: finPayload.geradoEm || new Date().toISOString(),
                mes,
              },
            });
          }
        }
      } catch { /* segue cascata */ }

      // 2. CSV de AGENDAMENTOS (vindo do email Trinks via Apps Script) — fallback
      // quando não tem CSV financeiro. Resolve o caso de mês corrente com 429.
      const csvAgendamentos = await getAgendamentosCsvFreshOrNull(24);
      if (csvAgendamentos && csvAgendamentos.length > 0) {
        // Filtra agendamentos do mês
        const mesAgend = csvAgendamentos.filter(a => (a.dataHoraInicio || "").startsWith(mes));
        if (mesAgend.length > 0) {
          // v35.1: gera transações sintéticas pra TODOS os agendamentos passados
          // que NÃO foram cancelados. Inclui Finalizados + Confirmados passados —
          // este último cobre o LAG entre o atendimento acontecer e o Trinks
          // trocar status pra "Finalizado". Sem isso, faturamento real ficaria
          // muito subestimado (~80% menos).
          // Hoje, em São Paulo
          const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          const transacoesSinteticas = mesAgend
            .filter(a => {
              const status = (a.status?.nome || "").toLowerCase();
              if (status.includes("cancel")) return false; // canceladas fora
              const data = (a.dataHoraInicio || "").slice(0, 10);
              // Finalizados sempre contam. Confirmados só contam se data já passou.
              if (status.includes("finaliz")) return true;
              return data <= hoje;
            })
            .map(a => ({
              id: `csv-${a.id}`,
              dataReferencia: a.dataHoraInicio,
              dataHora: a.dataHoraInicio,
              totalPagar: a.valor,
              formasPagamentos: [{ nome: "agendamento_csv", valor: a.valor }],
              profissional: a.profissional,
              cliente: a.cliente,
              servico: a.servico,
              status: a.status,
            }));
          const ultimoImport = await getUltimoImportAgendamentos();
          return res.json({
            fonte: "csv-agendamentos",
            trinksAt: meta.trinksAt,
            csvAt: ultimoImport?.geradoEm,
            motivo: "CSV de agendamentos (email Trinks) tem prioridade — evita 429 da API.",
            dados: {
              estabelecimento: null,
              profissionais: [],
              servicos: [],
              agendamentos: mesAgend,
              transacoes: transacoesSinteticas,
              clientes: [],
              syncedAt: ultimoImport?.geradoEm || new Date().toISOString(),
              mes,
            },
          });
        }
      }

      // Caso 1: nenhuma fonte → tenta Trinks online (pode ser primeira vez), e
      // se também falhar devolve estrutura vazia com fonte="nenhuma".
      // Caso 2: CSV vence → monta TrinksData sintético do CSV financeiro.
      // Caso 3: Trinks vence → reusa lógica do /api/trinks/sync-mes via fetch interno.

      if (meta.fonte === "csv") {
        const sintetico = await carregarTrinksDataDoCsv(mes);
        if (sintetico) {
          return res.json({
            fonte: "csv",
            trinksAt: meta.trinksAt,
            csvAt: meta.csvAt,
            motivo: meta.motivo,
            dados: sintetico,
          });
        }
        // Se não conseguir carregar o CSV (race condition), cai no Trinks abaixo.
      }

      // Trinks vence (ou CSV indisponível). Reaproveita a mesma lógica do
      // sync-mes: se houver config Trinks, busca; se 429 ou sem config, devolve
      // o que tiver de meta.
      if (!trinksConfig) {
        // Sem config Trinks e sem CSV: devolve estrutura vazia.
        return res.json({
          fonte: meta.fonte,
          trinksAt: meta.trinksAt,
          csvAt: meta.csvAt,
          motivo: meta.motivo,
          dados: {
            estabelecimento: null,
            profissionais: [],
            servicos: [],
            agendamentos: [],
            transacoes: [],
            clientes: [],
            syncedAt: meta.trinksAt || new Date().toISOString(),
            mes,
          },
        });
      }

      // v42: mês FECHADO nunca consulta a API Trinks (regra de janela-de-tempo).
      // Se chegou aqui sem CSV, não há dado pro mês — devolve vazio na hora em
      // vez de pendurar ~20s tentando a API (que era o bug original em meses
      // fechados sem import, ex.: março/2026).
      {
        const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const mesCorrente = hojeSP.slice(0, 7);
        if (mes < mesCorrente) {
          log(`/api/mes/${mes}/dados mês fechado sem CSV — retorna vazio (API Trinks não é consultada)`, "mesService");
          return res.json({
            fonte: "nenhuma",
            trinksAt: meta.trinksAt,
            csvAt: meta.csvAt,
            motivo: "Mês fechado sem CSV importado. A API Trinks não é consultada para meses fechados.",
            dados: {
              estabelecimento: null, profissionais: [], servicos: [],
              agendamentos: [], transacoes: [], clientes: [],
              syncedAt: meta.trinksAt || new Date().toISOString(), mes,
            },
          });
        }
      }

      try {
        const [yStr, mStr] = mes.split("-");
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        const ultimoDia = new Date(y, m, 0).getDate();
        const dataInicio = `${mes}-01`;
        const dataFim = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
        const transFim = ymdAddDays(dataFim, 1);
        const dateParams = { dataInicio, dataFim };

        const profissionais = await trinksFetchAll("profissionais")
          .catch((e: any) => { log(`profissionais error: ${e.message}`, "trinks"); return []; });
        const servicos = await trinksFetchAll("servicos")
          .catch((e: any) => { log(`servicos error: ${e.message}`, "trinks"); return []; });
        const agendamentos = await trinksFetchAllRange("agendamentos", dateParams)
          .catch((e: any) => { log(`agendamentos error: ${e.message}`, "trinks"); return []; });
        // Transações: intervalo semi-aberto [dataInicio, dataFim+1) para incluir o último dia
        const transacoes = await trinksFetchAllRange("transacoes", { dataInicio, dataFim: transFim })
          .catch((e: any) => { log(`transacoes error: ${e.message}`, "trinks"); return []; });
        const clientes = await trinksFetchAll("clientes")
          .catch((e: any) => { log(`clientes error: ${e.message}`, "trinks"); return []; });

        const dados = {
          estabelecimento: null,
          profissionais: Array.isArray(profissionais) ? profissionais : [],
          servicos: Array.isArray(servicos) ? servicos : [],
          agendamentos: Array.isArray(agendamentos) ? agendamentos : [],
          transacoes: Array.isArray(transacoes) ? transacoes : [],
          clientes: Array.isArray(clientes) ? clientes : [],
          syncedAt: new Date().toISOString(),
          mes,
          periodoIni: dataInicio,
          periodoFim: dataFim,
        };

        // Se houve dados frescos, registra meta (atualiza trinksAt). Mas só
        // se realmente buscou rede (trinksFetchAllRange usa cache TTL 24h em
        // meses fechados, então registrar aqui pode ficar desatualizado em
        // relação à última chamada de rede de fato. Aceitável: registrar quando
        // o endpoint serviu dados saudáveis para esse mês).
        const ag2 = dados.agendamentos.length;
        const tr2 = dados.transacoes.length;
        const isHealthy2 = (ag2 > 0 && tr2 > 0) || (ag2 === 0 && tr2 === 0);
        if (isHealthy2 && (ag2 > 0 || tr2 > 0)) {
          try {
            await registrarSyncTrinks(mes, { agendamentos: ag2, transacoes: tr2 });
          } catch (e: any) {
            log(`[mes/${mes}/dados] erro ao registrar meta (${e?.message})`, "trinks");
          }
        }

        // Atualiza meta para refletir o trinksAt recém-gravado
        const metaAtualizada = await resolverFonte(mes);

        return res.json({
          fonte: metaAtualizada.fonte,
          trinksAt: metaAtualizada.trinksAt,
          csvAt: metaAtualizada.csvAt,
          motivo: metaAtualizada.motivo,
          dados,
        });
      } catch (err: any) {
        // Trinks falhou — se temos CSV, devolve CSV mesmo que não seja o vencedor.
        if (err?.status === 429 || err?.status >= 500) {
          const sintetico = await carregarTrinksDataDoCsv(mes);
          if (sintetico) {
            return res.json({
              fonte: "csv",
              trinksAt: meta.trinksAt,
              csvAt: meta.csvAt,
              motivo: `${meta.motivo} (Trinks indisponível, usando CSV como fallback.)`,
              dados: sintetico,
              fallback: true,
            });
          }
          return res.status(429).json({
            error: "Limite Trinks excedido e nenhum CSV disponível. Tente em alguns minutos.",
            rateLimited: true,
          });
        }
        return handleTrinksError(err, res);
      }
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // ─── GET /api/trinks/status — API usage stats ───────────
  app.get("/api/trinks/status", (_req: Request, res: Response) => {
    const cacheStats: Record<string, { items: number | string; ageMinutes: number }> = {};
    Object.entries(memoryCache).forEach(([key, entry]) => {
      const age = Math.round((Date.now() - entry.timestamp) / 60000);
      const items = Array.isArray(entry.data) ? entry.data.length : 
                    (typeof entry.data === "object" ? "object" : "value");
      cacheStats[key] = { items, ageMinutes: age };
    });

    return res.json({
      rateLimits: {
        requestsThisMinute: rateLimiter.requestsThisMinute,
        maxPerMinute: MAX_REQUESTS_PER_MINUTE,
        requestsThisMonth: rateLimiter.requestsThisMonth,
        maxPerMonth: MAX_REQUESTS_PER_MONTH,
        monthKey: rateLimiter.monthKey,
        totalSessionRequests: rateLimiter.totalRequestsSession,
      },
      cache: cacheStats,
      hasConfig: !!trinksConfig,
    });
  });

  // ─── POST /api/trinks/cache/clear — Manually clear cache ─
  app.post("/api/trinks/cache/clear", (_req: Request, res: Response) => {
    invalidateCache();
    log("All caches cleared manually", "trinks");
    return res.json({ ok: true, message: "Cache limpo. Próxima sincronização buscará dados novos." });
  });

  // ──────────────────────────────────────────────────────────────────
  // CLIENT DUPLICATES ROUTES
  // ──────────────────────────────────────────────────────────────────

  // NOTA: rota /api/version já está definida acima (contém build date + uptime).

  app.get("/api/clientes/duplicados", async (req: Request, res: Response) => {
    // Normaliza telefone: só dígitos, últimos 9 (celular) ou 8 (fixo).
    const normPhone = (raw: string): string => {
      const d = (raw || "").replace(/\D/g, "");
      return d.length >= 9 ? d.slice(-9) : d.slice(-8);
    };
    const normNome = (s: string): string =>
      String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    // O CSV não tem ID Cliente → id sintético = hash NEGATIVO do nome normalizado.
    // Negativo nunca colide com id real da Trinks (sempre positivo), então o resolver
    // (que exige typeof number) continua funcionando pros dois mundos.
    const idDoNome = (nome: string): number => {
      const s = normNome(nome);
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return -(Math.abs(h) || 1);
    };

    type NC = { id: any; nome: string; email: string | null; dataCadastro: string; phones: { normalized: string; original: string }[] };

    // Mesma rotina de agrupamento por telefone, independente da fonte dos dados.
    const montar = (clientes: NC[], fonte: string) => {
      const phoneMap: Record<string, any[]> = {};
      let clientsWithPhone = 0;
      let clientsWithoutPhone = 0;
      for (const c of clientes) {
        if (c.phones.length === 0) { clientsWithoutPhone++; continue; }
        clientsWithPhone++;
        for (const p of c.phones) {
          if (p.normalized.length < 8) continue;
          if (!phoneMap[p.normalized]) phoneMap[p.normalized] = [];
          if (!phoneMap[p.normalized].find((x: any) => x.id === c.id)) {
            phoneMap[p.normalized].push({
              id: c.id,
              nome: c.nome || "",
              email: c.email || null,
              dataCadastro: c.dataCadastro || "",
              telefoneOriginal: p.original,
              telefoneNormalizado: p.normalized,
            });
          }
        }
      }
      const resolvedSet = new Set(resolvedDuplicateIds);
      for (const phone of Object.keys(phoneMap)) {
        phoneMap[phone] = phoneMap[phone].filter((c: any) => !resolvedSet.has(c.id));
        if (phoneMap[phone].length === 0) delete phoneMap[phone];
      }
      const duplicateGroups = Object.entries(phoneMap)
        .filter(([_, clients]) => clients.length > 1)
        .map(([phone, clients]) => ({
          telefone: phone,
          telefoneFormatado: clients[0]?.telefoneOriginal || phone,
          count: clients.length,
          clientes: clients.sort((a: any, b: any) =>
            (a.dataCadastro || "").localeCompare(b.dataCadastro || "")
          ),
        }))
        .sort((a, b) => b.count - a.count);
      const totalDuplicateClients = duplicateGroups.reduce((s, g) => s + g.count, 0);
      return {
        totalClientes: clientes.length,
        clientsWithPhone,
        clientsWithoutPhone,
        totalGruposDuplicados: duplicateGroups.length,
        totalClientesDuplicados: totalDuplicateClients,
        potencialReducao: totalDuplicateClients - duplicateGroups.length,
        grupos: duplicateGroups,
        fonte,
      };
    };

    // Adapta clientes da API Trinks (telefones[] {ddd,telefone}) → forma normalizada.
    const daApi = (clientes: any[]): NC[] => clientes.map((c: any) => ({
      id: c.id,
      nome: c.nome || "",
      email: c.email || null,
      dataCadastro: c.dataCadastro || "",
      phones: (c.telefones || []).map((p: any) => ({
        normalized: normPhone((p.ddd || "") + (p.telefone || "")),
        original: `(${p.ddd || ""}) ${p.telefone || ""}`,
      })),
    }));

    // Fonte CSV "Ranking de Clientes" (kv): base de janela longa, fallback mensal recente.
    // Tem telefone, NÃO depende da API → imune ao 429. Esta é a fonte padrão do badge.
    const doCsv = async (): Promise<NC[]> => {
      let payload: any = await kvGet<any>(trinksImport.CLIENTES_BASE_KEY);
      if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) {
        const now = new Date();
        for (let i = 0; i < 3 && !(payload && payload.rows?.length); i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          payload = await kvGet<any>(trinksImport.kvKeyFor("clientes", mes));
        }
      }
      if (!payload || !Array.isArray(payload.rows)) return [];
      return payload.rows.map((r: any) => ({
        id: idDoNome(r.nome),
        nome: r.nome || "",
        email: r.email || null,
        dataCadastro: r.dataCadastro || "",
        phones: String(r.telefones || "")
          .split(/[\/;\n]+/)
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((s: string) => ({ normalized: normPhone(s), original: s }))
          .filter((p: any) => p.normalized.length >= 8),
      }));
    };

    try {
      const refresh = req.query.refresh === "1";

      // 1) sync ao vivo já carregado (mais fresco, sem custo de API)
      const syncCache = getCached("full_sync") || loadSyncCacheFromDisk();
      if (syncCache && Array.isArray(syncCache.clientes) && syncCache.clientes.length > 0) {
        const resultado = montar(daApi(syncCache.clientes), "trinks-sync");
        await kvSet("clientes_duplicados:cache", resultado);
        return res.json(resultado);
      }

      // 2) refresh explícito → tenta a API ao vivo (só quando a janela da Trinks abre).
      //    Se cair no 429, NÃO falha: segue pro CSV abaixo.
      if (refresh) {
        try {
          let clientes = await trinksFetchAll("clientes");
          if (!Array.isArray(clientes)) clientes = [];
          if (clientes.length > 0) {
            const resultado = montar(daApi(clientes), "trinks-api");
            await kvSet("clientes_duplicados:cache", resultado);
            return res.json(resultado);
          }
        } catch (e: any) {
          log(`duplicados: refresh via API falhou (${e?.message || e}); caindo pro CSV`, "duplicados");
        }
      }

      // 3) CSV "Ranking de Clientes" — fonte padrão, imune ao 429
      const csv = await doCsv();
      if (csv.length > 0) {
        const resultado = montar(csv, "csv-ranking-clientes");
        await kvSet("clientes_duplicados:cache", resultado);
        return res.json(resultado);
      }

      // 4) nada disponível → último resultado salvo, senão vazio (pede importar CSV)
      const cache: any = await kvGet("clientes_duplicados:cache");
      if (cache) return res.json(cache);
      return res.json({ totalClientes: 0, clientsWithPhone: 0, clientsWithoutPhone: 0, totalGruposDuplicados: 0, totalClientesDuplicados: 0, potencialReducao: 0, grupos: [], precisaSincronizar: true });
    } catch (err: any) {
      return handleTrinksError(err, res);
    }
  });

  // ─── POST /api/clientes/duplicados/resolver — Mark a client as resolved (hide from duplicates) ───
  app.post("/api/clientes/duplicados/resolver", (req: Request, res: Response) => {
    try {
      const { clientId } = req.body;
      if (!clientId || typeof clientId !== "number") {
        return res.status(400).json({ error: "clientId (number) é obrigatório" });
      }

      if (!resolvedDuplicateIds.includes(clientId)) {
        resolvedDuplicateIds.push(clientId);
        saveResolvedDuplicates();
        log(`Marked client #${clientId} as resolved duplicate`, "duplicados");
      }

      return res.json({ ok: true, resolvedId: clientId });
    } catch (err: any) {
      return res.status(500).json({ error: "Erro ao marcar duplicado como resolvido." });
    }
  });

  // ─── DELETE /api/clientes/duplicados/resolver/:id — Undo resolved (show again in duplicates) ───
  app.delete("/api/clientes/duplicados/resolver/:id", (req: Request, res: Response) => {
    try {
      const clientId = parseInt(req.params.id as string, 10);
      if (isNaN(clientId)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      resolvedDuplicateIds = resolvedDuplicateIds.filter((id) => id !== clientId);
      saveResolvedDuplicates();
      log(`Unresolved client #${clientId} from duplicates`, "duplicados");

      return res.json({ ok: true, unresolvedId: clientId });
    } catch (err: any) {
      return res.status(500).json({ error: "Erro ao desfazer resolução de duplicado." });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // METAS ROUTES
  // ──────────────────────────────────────────────────────────────────

  // GET /api/metas — load all historical metas
  app.get("/api/metas", (_req: Request, res: Response) => {
    return res.json(metasHistorico);
  });

  // POST /api/metas — save/update a month's meta
  app.post("/api/metas", (req: Request, res: Response) => {
    const { month, target, achieved } = req.body;
    if (!month || target == null) {
      return res.status(400).json({ error: "month and target are required" });
    }
    const existing = metasHistorico.find(m => m.month === month);
    if (existing) {
      existing.target = Number(target);
      if (achieved != null) existing.achieved = Number(achieved);
    } else {
      metasHistorico.push({ month, target: Number(target), achieved: Number(achieved || 0) });
    }
    metasHistorico.sort((a, b) => a.month.localeCompare(b.month));
    saveMetas();
    return res.json({ ok: true, metas: metasHistorico });
  });

  // GET /api/metas/diaria — get daily target
  app.get("/api/metas/diaria", (_req: Request, res: Response) => {
    return res.json({ valor: metaDiaria });
  });

  // POST /api/metas/diaria — update daily target
  app.post("/api/metas/diaria", (req: Request, res: Response) => {
    const { valor } = req.body;
    const num = Number(valor);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: "valor inválido" });
    }
    metaDiaria = num;
    saveMetaDiaria();
    return res.json({ ok: true, valor: metaDiaria });
  });

  // POST /api/metas/atualizar-atual — update current month's achieved from Trinks or manual
  app.post("/api/metas/atualizar-atual", (req: Request, res: Response) => {
    const { achieved } = req.body;
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const existing = metasHistorico.find(m => m.month === currentMonth);
    if (existing) {
      existing.achieved = Number(achieved || 0);
    }
    saveMetas();
    return res.json({ ok: true });
  });

  // GET /api/metas/barbeiros/:month — get individual barber metas for a month
  app.get("/api/metas/barbeiros/:month", (req: Request, res: Response) => {
    const { month } = req.params;
    return res.json(metasBarbeiros[month] || {});
  });

  // POST /api/metas/barbeiros — save individual barber meta
  app.post("/api/metas/barbeiros", (req: Request, res: Response) => {
    const { month, barberId, meta } = req.body;
    if (!month || !barberId || meta == null) {
      return res.status(400).json({ error: "month, barberId and meta are required" });
    }
    if (!metasBarbeiros[month]) metasBarbeiros[month] = {};
    metasBarbeiros[month][barberId] = Number(meta);
    saveMetasBarbeiros();
    return res.json({ ok: true, metas: metasBarbeiros[month] });
  });

  // DELETE /api/metas/barbeiros — remove custom meta (revert to proportional)
  app.delete("/api/metas/barbeiros", (req: Request, res: Response) => {
    const { month, barberId } = req.body;
    if (!month || !barberId) {
      return res.status(400).json({ error: "month and barberId are required" });
    }
    if (metasBarbeiros[month]) {
      delete metasBarbeiros[month][barberId];
      saveMetasBarbeiros();
    }
    return res.json({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────────
  // CHECKLIST ROUTES
  // ──────────────────────────────────────────────────────────────────

  // GET /api/checklist/:date — get checklist for a specific day
  app.get("/api/checklist/:date", (req: Request, res: Response) => {
    const { date } = req.params;
    return res.json(checklistData[date] || { date, tasks: {} });
  });

  // POST /api/checklist — save checklist for a day
  app.post("/api/checklist", (req: Request, res: Response) => {
    const { date, tasks } = req.body;
    if (!date || !tasks) {
      return res.status(400).json({ error: "date and tasks are required" });
    }
    checklistData[date] = { date, tasks };
    saveChecklist();
    return res.json({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────────
  // CONSOLIDAÇÃO ROUTES
  // ──────────────────────────────────────────────────────────────────

  // GET /api/consolidacao/contas — lista todas as contas
  app.get("/api/consolidacao/contas", (_req: Request, res: Response) => {
    return res.json(contasConsolidacao);
  });

  // POST /api/consolidacao/contas — cria ou atualiza conta
  app.post("/api/consolidacao/contas", (req: Request, res: Response) => {
    const {
      id, nome, tipo, meios,
      taxaDebito, taxaCredito, taxaPix, taxaAntecipacao,
      diasLiquidacaoDebito, diasLiquidacaoCredito, ativa,
      transito, contaDestinoId, observacao,
    } = req.body;
    if (!nome || !tipo) {
      return res.status(400).json({ error: "nome e tipo são obrigatórios" });
    }
    const meiosValidos: MeioRecebimento[] = ['pix', 'debito', 'credito', 'dinheiro'];
    const meiosFiltrados: MeioRecebimento[] = Array.isArray(meios)
      ? meios.filter((m: any) => meiosValidos.includes(m))
      : (tipo === 'banco' ? ['pix']
         : tipo === 'maquininha' ? ['debito', 'credito']
         : tipo === 'caixa' ? ['dinheiro']
         : []);

    const num = (v: any) => v != null && v !== "" ? Number(v) : undefined;

    if (id) {
      const idx = contasConsolidacao.findIndex(c => c.id === id);
      if (idx >= 0) {
        contasConsolidacao[idx] = {
          ...contasConsolidacao[idx],
          nome, tipo,
          meios: meiosFiltrados,
          taxaDebito: num(taxaDebito),
          taxaCredito: num(taxaCredito),
          taxaPix: num(taxaPix),
          taxaAntecipacao: num(taxaAntecipacao),
          diasLiquidacaoDebito: num(diasLiquidacaoDebito) ?? 1,
          diasLiquidacaoCredito: num(diasLiquidacaoCredito) ?? 30,
          transito: !!transito,
          contaDestinoId: transito && contaDestinoId ? String(contaDestinoId) : undefined,
          observacao: !!observacao,
          ativa: ativa !== false,
        };
        saveContasConsolidacao();
        return res.json(contasConsolidacao[idx]);
      }
    }
    const newConta: ContaConsolidacao = {
      id: `conta-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      nome, tipo,
      meios: meiosFiltrados,
      taxaDebito: num(taxaDebito),
      taxaCredito: num(taxaCredito),
      taxaPix: num(taxaPix),
      taxaAntecipacao: num(taxaAntecipacao),
      diasLiquidacaoDebito: num(diasLiquidacaoDebito) ?? 1,
      diasLiquidacaoCredito: num(diasLiquidacaoCredito) ?? 30,
      transito: !!transito,
      contaDestinoId: transito && contaDestinoId ? String(contaDestinoId) : undefined,
      observacao: !!observacao,
      ativa: ativa !== false,
      createdAt: new Date().toISOString(),
    };
    contasConsolidacao.push(newConta);
    saveContasConsolidacao();
    return res.json(newConta);
  });

  // DELETE /api/consolidacao/contas/:id
  app.delete("/api/consolidacao/contas/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const before = contasConsolidacao.length;
    contasConsolidacao = contasConsolidacao.filter(c => c.id !== id);
    transacoesBanco = transacoesBanco.filter(t => t.contaId !== id);
    saveContasConsolidacao();
    saveTransacoesBanco();
    return res.json({ ok: true, removed: before - contasConsolidacao.length });
  });

  // GET /api/consolidacao/transacoes — query params: contaId?, mes? (YYYY-MM)
  app.get("/api/consolidacao/transacoes", (req: Request, res: Response) => {
    const { contaId, mes } = req.query;
    let result = transacoesBanco;
    if (contaId) result = result.filter(t => t.contaId === contaId);
    if (mes) result = result.filter(t => t.date.startsWith(String(mes)));
    return res.json(result);
  });

  // POST /api/consolidacao/upload-ia — extrai transações de QUALQUER arquivo via Claude
  app.post("/api/consolidacao/upload-ia", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor." });
      if (!req.file) return res.status(400).json({ error: "Arquivo não enviado." });

      const contaId = (req.body.contaId || "").toString();
      const mes = (req.body.mes || "").toString();
      const conta = contasConsolidacao.find(c => c.id === contaId);
      if (!conta) return res.status(404).json({ error: "Conta não encontrada." });

      const name = (req.file.originalname || "").toLowerCase();
      const isPdf = name.endsWith(".pdf");
      const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");
      const isCsv = name.endsWith(".csv") || name.endsWith(".txt");

      log(`IA upload: ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)}kb) → ${conta.nome}`, "consolidacao");

      const anthropic = new Anthropic({ apiKey });
      const prompt = `Este é um extrato bancário. Extraia TODAS as transações e retorne APENAS JSON (sem markdown).

Formato:
{
  "transacoes": [
    { "date": "YYYY-MM-DD", "description": "descrição completa", "amount": -100.50, "tipo": "pix|debito|credito|antecipacao|tarifa|transferencia|outro" }
  ]
}

Regras CRÍTICAS:
- amount: número puro em reais. Use ponto como separador decimal
- NEGATIVO para saídas (débito/pagamento/saída/transferência enviada)
- POSITIVO para entradas (crédito/recebimento/transferência recebida)
- Valores brasileiros: "1.234,56" significa 1234.56 (mil duzentos e trinta e quatro reais)
- IGNORE a coluna "Documento" (número da transação, geralmente grande)
- IGNORE a coluna "Saldo" (cumulativo)
- Use APENAS a coluna de "Valor" para o amount
- Ignore linhas de saldo anterior, saldo atual, subtotais, cabeçalhos
- tipo: analise a descrição. "Antecipacao" → antecipacao, "Pix" → pix, "Cartao Debito/Credito" → debito/credito, "Tarifa/Anuidade" → tarifa`;

      let content: any[];
      if (isPdf) {
        const pdfBase64 = req.file.buffer.toString("base64");
        content = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: prompt },
        ];
      } else if (isExcel || isCsv) {
        // Lê como texto. Excel é convertido pra CSV via lib xlsx antes de mandar à IA.
        let textContent = "";
        let label = "CSV";
        if (isExcel) {
          try {
            const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
            // Junta todas as planilhas (a maioria de extratos tem só uma, mas alguns têm várias)
            const partes: string[] = [];
            for (const nomeSheet of wb.SheetNames) {
              const sheet = wb.Sheets[nomeSheet];
              const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
              if (csv && csv.trim().length > 0) {
                partes.push(wb.SheetNames.length > 1 ? `# Planilha: ${nomeSheet}\n${csv}` : csv);
              }
            }
            textContent = partes.join("\n\n");
            label = "EXCEL CONVERTIDO PARA CSV";
            log(`IA upload: convertido xlsx (${wb.SheetNames.length} planilha${wb.SheetNames.length > 1 ? "s" : ""}, ${textContent.length} chars)`, "consolidacao");
          } catch (e: any) {
            return res.status(400).json({ error: `Falha ao ler Excel: ${e.message}` });
          }
        } else {
          textContent = req.file.buffer.toString("utf-8");
        }
        content = [
          {
            type: "text",
            text: `${prompt}\n\n--- CONTEÚDO DO ${label} ---\n${textContent.slice(0, 100000)}`,
          },
        ];
      } else {
        return res.status(400).json({ error: "Formato não suportado. Use CSV, Excel ou PDF." });
      }

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      });

      const text = response.content.find(b => b.type === "text")?.text || "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      let parsed: { transacoes: any[] };
      try { parsed = JSON.parse(cleaned); }
      catch {
        log(`IA parse error. Claude retornou: ${text.slice(0, 500)}`, "consolidacao");
        return res.status(500).json({ error: "IA não conseguiu extrair as transações." });
      }

      if (!Array.isArray(parsed?.transacoes) || parsed.transacoes.length === 0) {
        return res.status(400).json({ error: "Nenhuma transação encontrada." });
      }

      if (mes) {
        transacoesBanco = transacoesBanco.filter(t =>
          t.contaId !== contaId || !t.date.startsWith(mes)
        );
      }

      const now = new Date().toISOString();
      const novas: TransacaoBanco[] = parsed.transacoes.map((t: any, i: number) => {
        const amount = Number(t.amount || 0);
        let categoria: CategoriaGasto | undefined;
        if (amount < 0) categoria = autoCategorizarGasto(String(t.description || ""));
        return {
          id: `tx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          contaId,
          date: String(t.date || "").slice(0, 10),
          description: String(t.description || ""),
          amount,
          tipo: t.tipo || undefined,
          categoria,
          importedAt: now,
        };
      }).filter(t => t.date && !isNaN(t.amount) && t.amount !== 0);

      await classificarBatchNovo(novas);
      transacoesBanco.push(...novas);
      saveTransacoesBanco();
      const contagemPorMes: Record<string, number> = {};
      for (const t of novas) {
        const m = (t.date || "").slice(0, 7);
        if (m) contagemPorMes[m] = (contagemPorMes[m] || 0) + 1;
      }
      const mesPredominante = Object.entries(contagemPorMes)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const mesesEntradas = Array.from(new Set(novas.filter(t => t.amount > 0).map(t => t.date.slice(0, 7))));
      const matchesAssinaturas = autoMatchAssinaturas(mesesEntradas);
      return res.json({ ok: true, inserted: novas.length, mesPredominante, matchesAssinaturas });
    } catch (err: any) {
      log(`IA upload error: ${err.message}`, "consolidacao");
      return res.status(500).json({ error: err.message || "Erro processando arquivo com IA" });
    }
  });

  // POST /api/consolidacao/upload-pdf — extrai transações de PDF via Claude
  app.post("/api/consolidacao/upload-pdf", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor." });
      if (!req.file) return res.status(400).json({ error: "Arquivo não enviado." });

      const contaId = (req.body.contaId || "").toString();
      const mes = (req.body.mes || "").toString();
      const conta = contasConsolidacao.find(c => c.id === contaId);
      if (!conta) return res.status(404).json({ error: "Conta não encontrada." });

      log(`PDF upload: ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)}kb) → ${conta.nome}`, "consolidacao");

      const anthropic = new Anthropic({ apiKey });
      const pdfBase64 = req.file.buffer.toString("base64");

      const prompt = `Este é um extrato bancário em PDF. Extraia TODAS as transações e retorne em JSON puro (sem markdown, sem backticks, sem texto extra).

Formato:
{
  "transacoes": [
    { "date": "YYYY-MM-DD", "description": "descrição completa", "amount": -100.50, "tipo": "pix|debito|credito|antecipacao|tarifa|transferencia|outro" }
  ]
}

Regras CRÍTICAS:
- amount: número puro em reais. Use ponto como separador decimal
- NEGATIVO para saídas (débito/pagamento/envio), POSITIVO para entradas (crédito/recebimento)
- Valores brasileiros: "1.234,56" significa 1234.56 (mil duzentos e trinta e quatro reais)
- Use APENAS a coluna "Valor" para o amount, NUNCA a coluna "Saldo" (que é cumulativo)
- Na descrição, combine o tipo de lançamento com o nome/razão social (ex: "PIX ENVIADO CAMILA BARBOSA DE OLIVEIRA")
- Ignore linhas de saldo (SALDO EM CONTA, SALDO TOTAL DISPONÍVEL, SALDO ANTERIOR), subtotais, cabeçalhos
- tipo: analise a descrição. "Pix" → pix, "Cartao Debito/Credito" → debito/credito, "Tarifa/TAR/IOF" → tarifa, "Antecipacao" → antecipacao, "Boleto/Pagamento" → outro, "Juros" → tarifa, "DEP DIN" → outro
- Se não conseguir detectar o tipo, use "outro"`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });

      const text = response.content.find(b => b.type === "text")?.text || "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      let parsed: { transacoes: any[] };
      try { parsed = JSON.parse(cleaned); }
      catch {
        log(`PDF parse error. Claude retornou: ${text.slice(0, 500)}`, "consolidacao");
        return res.status(500).json({ error: "IA não conseguiu extrair as transações. Tente CSV ou Excel." });
      }

      if (!Array.isArray(parsed?.transacoes) || parsed.transacoes.length === 0) {
        return res.status(400).json({ error: "Nenhuma transação encontrada no PDF." });
      }

      // Remove do mês se replaceMonth
      if (mes) {
        transacoesBanco = transacoesBanco.filter(t =>
          t.contaId !== contaId || !t.date.startsWith(mes)
        );
      }

      const now = new Date().toISOString();
      const novas: TransacaoBanco[] = parsed.transacoes.map((t: any, i: number) => {
        const amount = Number(t.amount || 0);
        let categoria: CategoriaGasto | undefined;
        if (amount < 0) categoria = autoCategorizarGasto(String(t.description || ""));
        return {
          id: `tx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          contaId,
          date: String(t.date || "").slice(0, 10),
          description: String(t.description || ""),
          amount,
          tipo: t.tipo || undefined,
          categoria,
          importedAt: now,
        };
      }).filter(t => t.date && !isNaN(t.amount) && t.amount !== 0);

      await classificarBatchNovo(novas);
      transacoesBanco.push(...novas);
      saveTransacoesBanco();
      // Detecta o mês predominante das transações inseridas (pra UX no frontend)
      const contagemPorMes: Record<string, number> = {};
      for (const t of novas) {
        const m = (t.date || "").slice(0, 7);
        if (m) contagemPorMes[m] = (contagemPorMes[m] || 0) + 1;
      }
      const mesPredominante = Object.entries(contagemPorMes)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const mesesEntradas = Array.from(new Set(novas.filter(t => t.amount > 0).map(t => t.date.slice(0, 7))));
      const matchesAssinaturas = autoMatchAssinaturas(mesesEntradas);
      return res.json({ ok: true, inserted: novas.length, mesPredominante, matchesAssinaturas });
    } catch (err: any) {
      log(`PDF upload error: ${err.message}`, "consolidacao");
      return res.status(500).json({ error: err.message || "Erro processando PDF" });
    }
  });

  // POST /api/consolidacao/transacoes — bulk insert (do upload CSV)
  app.post("/api/consolidacao/transacoes", async (req: Request, res: Response) => {
    const { contaId, transacoes, replaceMonth } = req.body;
    if (!contaId || !Array.isArray(transacoes)) {
      return res.status(400).json({ error: "contaId e transacoes[] são obrigatórios" });
    }
    const conta = contasConsolidacao.find(c => c.id === contaId);
    if (!conta) return res.status(404).json({ error: "Conta não encontrada" });

    // Opcional: remover transações do mês antes de inserir (evita duplicar)
    if (replaceMonth) {
      transacoesBanco = transacoesBanco.filter(t =>
        t.contaId !== contaId || !t.date.startsWith(String(replaceMonth))
      );
    }

    const now = new Date().toISOString();
    const novas: TransacaoBanco[] = transacoes.map((t: any, i: number) => {
      const description = String(t.description || "");
      const amount = Number(t.amount || 0);
      // Auto-categoriza só se for gasto (negativo) e ainda não veio com categoria
      let categoria: CategoriaGasto | undefined = t.categoria;
      if (!categoria && amount < 0) {
        categoria = autoCategorizarGasto(description);
      }
      return {
        id: `tx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        contaId,
        date: String(t.date || "").slice(0, 10),
        description,
        amount,
        tipo: t.tipo || undefined,
        categoria,
        importedAt: now,
      };
    }).filter((t: TransacaoBanco) => t.date && !isNaN(t.amount));

    await classificarBatchNovo(novas);
    transacoesBanco.push(...novas);
    saveTransacoesBanco();
    const contagemPorMes: Record<string, number> = {};
    for (const t of novas) {
      const m = (t.date || "").slice(0, 7);
      if (m) contagemPorMes[m] = (contagemPorMes[m] || 0) + 1;
    }
    const mesPredominante = Object.entries(contagemPorMes)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const mesesEntradas = Array.from(new Set(novas.filter(t => t.amount > 0).map(t => t.date.slice(0, 7))));
    const matchesAssinaturas = autoMatchAssinaturas(mesesEntradas);
    return res.json({ ok: true, inserted: novas.length, mesPredominante, matchesAssinaturas });
  });

  // PUT /api/consolidacao/transacoes/:id — atualiza valor/tipo/descrição de uma transação
  app.put("/api/consolidacao/transacoes/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const { amount, tipo, description, flipSign } = req.body;
    const tx = transacoesBanco.find(t => t.id === id);
    if (!tx) return res.status(404).json({ error: "Transação não encontrada" });
    if (flipSign) tx.amount = -tx.amount;
    else if (amount != null) tx.amount = Number(amount);
    if (tipo) tx.tipo = tipo;
    if (description != null) tx.description = String(description);
    saveTransacoesBanco();
    return res.json({ ok: true, transacao: tx });
  });

  // PUT /api/consolidacao/transacoes/:id/categoria — atualiza categoria de uma tx
  app.put("/api/consolidacao/transacoes/:id/categoria", (req: Request, res: Response) => {
    const { id } = req.params;
    const { categoria, aprenderRegra } = req.body;
    const tx = transacoesBanco.find(t => t.id === id);
    if (!tx) return res.status(404).json({ error: "Transação não encontrada" });

    if (categoria === null || categoria === "") {
      tx.categoria = undefined;
    } else if (CATEGORIAS_VALIDAS.includes(categoria)) {
      tx.categoria = categoria;
    } else {
      return res.status(400).json({ error: "Categoria inválida" });
    }
    saveTransacoesBanco();

    // Aprender regra: extrai o "núcleo" da descrição e salva
    if (aprenderRegra && tx.categoria) {
      // Remove números, datas e caracteres especiais — pega palavras significativas
      const palavras = tx.description
        .toLowerCase()
        .replace(/[\d/.,\-]+/g, " ")
        .split(/\s+/)
        .filter(p => p.length >= 4)
        .slice(0, 3); // pega até 3 palavras significativas
      const chave = palavras.join(" ").trim();
      if (chave.length >= 4) {
        regrasGastos[chave] = tx.categoria;
        saveRegrasGastos();

        // Aplica retroativamente em transações similares sem categoria
        let count = 0;
        transacoesBanco.forEach(other => {
          if (other.id !== tx.id && !other.categoria && other.amount < 0) {
            const desc = other.description.toLowerCase();
            if (desc.includes(chave)) {
              other.categoria = tx.categoria;
              count++;
            }
          }
        });
        if (count > 0) saveTransacoesBanco();
        return res.json({ ok: true, categoria: tx.categoria, regraAprendida: chave, aplicadaEm: count });
      }
    }

    return res.json({ ok: true, categoria: tx.categoria });
  });

  // GET /api/consolidacao/regras-gastos — lista regras aprendidas
  app.get("/api/consolidacao/regras-gastos", (_req: Request, res: Response) => {
    return res.json(regrasGastos);
  });

  // DELETE /api/consolidacao/regras-gastos/:chave — remove regra
  app.delete("/api/consolidacao/regras-gastos/:chave", (req: Request, res: Response) => {
    const chave = decodeURIComponent(req.params.chave);
    delete regrasGastos[chave];
    saveRegrasGastos();
    return res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // CONCILIAÇÃO MULTIBANCO (v28)
  // Detecta transferências internas entre contas (saída em A + entrada espelho
  // em B). Para o caso Greco: vendas caem no Santander/InfinityPay e são
  // transferidas pro Itaú — sem o detector, esse R$ aparece 2x nas entradas.
  // ════════════════════════════════════════════════════════════════════════

  /** Para cada saída de conta com transito=true, procura entrada espelho na
   *  contaDestinoId em ±janela de dias com mesmo valor (tolerância). Marca o par.
   *  Retorna estatísticas. dryRun=true só calcula sem persistir. */
  function detectarTransferenciasInternas(opts: {
    mes?: string;          // YYYY-MM (limitar escopo) — opcional
    janelaDias?: number;   // padrão 3
    toleranciaReais?: number; // padrão 1.00
    dryRun?: boolean;
    forceRematch?: boolean;
  } = {}): {
    pareados: number;
    pares: Array<{ outId: string; inId: string; valor: number; data: string; confianca: number; outConta: string; inConta: string }>;
    naoCasadas: { outs: number; ins: number };
  } {
    const janela = opts.janelaDias ?? 3;
    const tol = opts.toleranciaReais ?? 1.0;
    const force = !!opts.forceRematch;

    const contasMap = new Map(contasConsolidacao.map(c => [c.id, c]));
    const contasTransito = contasConsolidacao.filter(c => c.transito && c.contaDestinoId);

    // Reseta pares anteriores se forceRematch (libera pra rematch limpo)
    if (force) {
      for (const t of transacoesBanco) {
        if (t.transferenciaParId) {
          t.transferenciaParId = undefined;
          t.transferenciaConfianca = undefined;
        }
      }
    }

    // Filtra ao mês se passado
    const noEscopo = (t: TransacaoBanco) => !opts.mes || t.date.startsWith(opts.mes);

    // Pra cada conta de trânsito, pega saídas no escopo, e candidatos de entrada na destino
    const pares: Array<{ outId: string; inId: string; valor: number; data: string; confianca: number; outConta: string; inConta: string }> = [];
    const usadasEntradas = new Set<string>(); // já pareadas neste run
    for (const cT of contasTransito) {
      const destinoId = cT.contaDestinoId!;
      const destino = contasMap.get(destinoId);
      if (!destino) continue;

      const saidas = transacoesBanco.filter(t =>
        t.contaId === cT.id && t.amount < 0 && !t.transferenciaParId && noEscopo(t)
      );
      // Candidatos: entradas no destino — não restringimos pelo mês na destino
      // pra cobrir transferências cruzando virada de mês (ex: saída 30/abr → entrada 02/mai)
      const entradasDestino = transacoesBanco.filter(t =>
        t.contaId === destinoId && t.amount > 0 && !t.transferenciaParId && !usadasEntradas.has(t.id)
      );

      for (const out of saidas) {
        const valorAlvo = Math.abs(out.amount);
        const dataOut = new Date(out.date + "T12:00:00").getTime();

        let melhor: TransacaoBanco | null = null;
        let melhorScore = -1;
        let melhorDelta = 99;

        for (const inn of entradasDestino) {
          if (usadasEntradas.has(inn.id)) continue;
          // Valor: mesma magnitude (tol)
          const dif = Math.abs(inn.amount - valorAlvo);
          if (dif > tol) continue;
          // Data: dentro da janela
          const dataIn = new Date(inn.date + "T12:00:00").getTime();
          const deltaDias = Math.round((dataIn - dataOut) / (1000 * 60 * 60 * 24));
          if (deltaDias < 0 || deltaDias > janela) continue; // entrada DEPOIS da saída

          // Score: valor exato (dif=0) + data próxima
          const score = (1 - dif / Math.max(0.01, tol)) * 0.5 + (1 - deltaDias / janela) * 0.5;
          if (score > melhorScore) {
            melhor = inn;
            melhorScore = score;
            melhorDelta = deltaDias;
          }
        }

        if (melhor) {
          usadasEntradas.add(melhor.id);
          pares.push({
            outId: out.id,
            inId: melhor.id,
            valor: valorAlvo,
            data: out.date,
            confianca: Math.max(0, Math.min(1, melhorScore)),
            outConta: cT.nome,
            inConta: destino.nome,
          });
          if (!opts.dryRun) {
            out.transferenciaParId = melhor.id;
            out.transferenciaConfianca = melhorScore;
            melhor.transferenciaParId = out.id;
            melhor.transferenciaConfianca = melhorScore;
          }
        }
      }
    }

    if (!opts.dryRun && pares.length > 0) saveTransacoesBanco();

    // Conta o que ficou sem casar (no escopo do mês)
    let outsSemPar = 0, insSemPar = 0;
    for (const cT of contasTransito) {
      outsSemPar += transacoesBanco.filter(t => t.contaId === cT.id && t.amount < 0 && !t.transferenciaParId && noEscopo(t)).length;
      const destinoId = cT.contaDestinoId!;
      insSemPar += transacoesBanco.filter(t => t.contaId === destinoId && t.amount > 0 && !t.transferenciaParId && noEscopo(t)).length;
    }

    return { pareados: pares.length, pares, naoCasadas: { outs: outsSemPar, ins: insSemPar } };
  }

  // POST /api/conciliacao-multibanco/detectar/:mes
  app.post("/api/conciliacao-multibanco/detectar/:mes", (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido" });
      const force = !!(req.body || {}).force;
      const r = detectarTransferenciasInternas({ mes, forceRematch: force });
      log(`multibanco/detectar mes=${mes}: pareados=${r.pareados} sem-par=${r.naoCasadas.outs}out/${r.naoCasadas.ins}in`, "consolidacao");
      return res.json({ ok: true, ...r });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/conciliacao-multibanco/desfazer-par
  // body: { txId } — remove o pareamento dos dois lados
  app.post("/api/conciliacao-multibanco/desfazer-par", (req: Request, res: Response) => {
    try {
      const txId = String((req.body || {}).txId || "");
      const tx = transacoesBanco.find(t => t.id === txId);
      if (!tx || !tx.transferenciaParId) return res.status(404).json({ ok: false, error: "par não encontrado" });
      const par = transacoesBanco.find(t => t.id === tx.transferenciaParId);
      tx.transferenciaParId = undefined;
      tx.transferenciaConfianca = undefined;
      if (par) { par.transferenciaParId = undefined; par.transferenciaConfianca = undefined; }
      saveTransacoesBanco();
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/conciliacao-multibanco/parear-manual
  // body: { outId, inId } — força um par mesmo que não casaria automaticamente
  app.post("/api/conciliacao-multibanco/parear-manual", (req: Request, res: Response) => {
    try {
      const outId = String((req.body || {}).outId || "");
      const inId = String((req.body || {}).inId || "");
      const out = transacoesBanco.find(t => t.id === outId);
      const inn = transacoesBanco.find(t => t.id === inId);
      if (!out || !inn) return res.status(404).json({ ok: false, error: "transação não encontrada" });
      if (out.amount >= 0 || inn.amount <= 0) return res.status(400).json({ ok: false, error: "outId precisa ser saída e inId entrada" });
      out.transferenciaParId = inn.id;
      out.transferenciaConfianca = 1.0;
      inn.transferenciaParId = out.id;
      inn.transferenciaConfianca = 1.0;
      saveTransacoesBanco();
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/conciliacao-multibanco/:mes — visão consolidada do batimento
  app.get("/api/conciliacao-multibanco/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido" });

      const txMes = transacoesBanco.filter(t => t.date.startsWith(mes) && t.incluidoNoFluxo !== false);
      const contasMap = new Map(contasConsolidacao.map(c => [c.id, c]));

      // Por conta: brutas e líquidas (líquidas excluem transferências internas do PAR)
      type ResumoConta = {
        id: string;
        nome: string;
        transito: boolean;
        contaDestinoId?: string;
        entradasBrutas: number; entradasQtd: number;
        saidasBrutas: number; saidasQtd: number;
        transferOut: number; transferOutQtd: number;  // saídas que são transferência interna (saem do líquido)
        transferIn: number; transferInQtd: number;    // entradas que são transferência interna (saem do líquido)
        entradasLiquidas: number; saidasLiquidas: number;
      };
      const porConta = new Map<string, ResumoConta>();
      for (const c of contasConsolidacao) {
        porConta.set(c.id, {
          id: c.id, nome: c.nome, transito: !!c.transito, contaDestinoId: c.contaDestinoId,
          entradasBrutas: 0, entradasQtd: 0, saidasBrutas: 0, saidasQtd: 0,
          transferOut: 0, transferOutQtd: 0, transferIn: 0, transferInQtd: 0,
          entradasLiquidas: 0, saidasLiquidas: 0,
        });
      }

      for (const t of txMes) {
        const r = porConta.get(t.contaId);
        if (!r) continue;
        if (t.amount > 0) {
          r.entradasBrutas += t.amount; r.entradasQtd += 1;
          if (t.transferenciaParId) { r.transferIn += t.amount; r.transferInQtd += 1; }
        } else {
          const v = Math.abs(t.amount);
          r.saidasBrutas += v; r.saidasQtd += 1;
          if (t.transferenciaParId) { r.transferOut += v; r.transferOutQtd += 1; }
        }
      }
      for (const r of porConta.values()) {
        r.entradasLiquidas = r.entradasBrutas - r.transferIn;
        r.saidasLiquidas = r.saidasBrutas - r.transferOut;
      }

      // Pares detectados (lista pra UI)
      const paresMap = new Map<string, { outId: string; inId: string; valor: number; data: string; confianca: number; outConta: string; inConta: string }>();
      for (const t of txMes) {
        if (!t.transferenciaParId) continue;
        const par = transacoesBanco.find(x => x.id === t.transferenciaParId);
        if (!par) continue;
        const out = t.amount < 0 ? t : par;
        const inn = t.amount > 0 ? t : par;
        const key = [out.id, inn.id].sort().join("|");
        if (paresMap.has(key)) continue;
        paresMap.set(key, {
          outId: out.id, inId: inn.id,
          valor: Math.abs(out.amount), data: out.date,
          confianca: t.transferenciaConfianca || 0,
          outConta: contasMap.get(out.contaId)?.nome || "?",
          inConta: contasMap.get(inn.contaId)?.nome || "?",
        });
      }

      // Totais consolidados
      const totalEntradasBrutas = Array.from(porConta.values()).reduce((s, r) => s + r.entradasBrutas, 0);
      const totalEntradasLiquidas = Array.from(porConta.values()).reduce((s, r) => s + r.entradasLiquidas, 0);
      const totalSaidasBrutas = Array.from(porConta.values()).reduce((s, r) => s + r.saidasBrutas, 0);
      const totalSaidasLiquidas = Array.from(porConta.values()).reduce((s, r) => s + r.saidasLiquidas, 0);
      const totalTransferenciasInternas = Array.from(porConta.values()).reduce((s, r) => s + r.transferOut, 0);

      return res.json({
        ok: true,
        mes,
        contas: Array.from(porConta.values()),
        pares: Array.from(paresMap.values()).sort((a, b) => (a.data < b.data ? 1 : -1)),
        totais: {
          entradasBrutas: totalEntradasBrutas,
          entradasLiquidas: totalEntradasLiquidas,
          saidasBrutas: totalSaidasBrutas,
          saidasLiquidas: totalSaidasLiquidas,
          transferenciasInternas: totalTransferenciasInternas,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // FECHAMENTO MÊS (v29) — visão consolidada usada pelo bloco "Fechamento"
  // dentro da aba Pagamento. Junta: receita Trinks por meio, entradas líquidas
  // por banco, transferências internas, cobranças bancárias automáticas
  // (juros, IOF, tarifa, antecipação, fatura cartão), e gap de caixa físico.
  // ════════════════════════════════════════════════════════════════════════

  // PUT /api/expenses/bank/:id/justificativa — salva nota de auditoria
  app.put("/api/expenses/bank/:id/justificativa", (req: Request, res: Response) => {
    try {
      const t = transacoesBanco.find(x => x.id === String(req.params.id));
      if (!t) return res.status(404).json({ ok: false, error: "transação não encontrada" });
      const txt = String((req.body || {}).justificativa || "").trim();
      if (!txt) {
        t.justificativa = undefined;
        t.justificadoEm = undefined;
      } else {
        t.justificativa = txt.slice(0, 500);
        t.justificadoEm = new Date().toISOString();
      }
      saveTransacoesBanco();
      return res.json({ ok: true, transacao: t });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/fechamento-mes/:mes — consolidado pra aba Pagamento
  app.get("/api/fechamento-mes/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido" });

      const contasMap = new Map(contasConsolidacao.map(c => [c.id, c]));
      const txMes = transacoesBanco.filter(t => t.date.startsWith(mes) && t.incluidoNoFluxo !== false);

      // ── 1) Trinks: breakdown por meio (puxa via API, com cache)
      let trinks = { total: 0, pix: 0, cartao: 0, dinheiro: 0, plano: 0, voucher: 0, descontoProf: 0, outros: 0, qtd: 0 };
      try {
        // v55: csv-first — mês fechado vem do CSV (0 API).
        const arr: any[] = await transacoesMesCsvFirst(mes);
        for (const t of arr) {
          const raw = t.dataHora || t.dataReferencia || t.data || "";
          const date = typeof raw === "string" ? raw.split("T")[0] : "";
          if (!date.startsWith(mes)) continue;
          trinks.total += Number(t.totalPagar || 0);
          trinks.qtd += 1;
          for (const fp of (t.formasPagamentos || t.formasPagamento || [])) {
            const nome = String(fp.nome || "").toLowerCase();
            const v = Number(fp.valor || 0);
            if (nome.includes("pix")) trinks.pix += v;
            else if (nome.includes("créd") || nome.includes("cred") || nome.includes("déb") || nome.includes("deb") || nome.includes("cart")) trinks.cartao += v;
            else if (nome.includes("dinhe") || nome.includes("espéc") || nome.includes("espec")) trinks.dinheiro += v;
            else if (nome.includes("depósito") || nome.includes("deposito") || nome.includes("saldo") || nome.includes("plano") || nome.includes("assinatura")) trinks.plano += v;
            else if (nome.includes("voucher") || nome.includes("cortes") || nome.includes("promo")) trinks.voucher += v;
            else if (nome.includes("descontar") && nome.includes("profissional")) trinks.descontoProf += v;
            else trinks.outros += v;
          }
        }
      } catch (err: any) {
        log(`fechamento/trinks erro: ${err.message}`, "fechamento");
      }

      // ── 2) Entradas líquidas por banco (sem dupla contagem de transferência interna)
      type BancoResumo = {
        id: string; nome: string; transito: boolean;
        entradasBrutas: number; entradasLiquidas: number; entradasQtd: number;
        saidasBrutas: number; saidasLiquidas: number; saidasQtd: number;
        transferOut: number; transferIn: number;
      };
      const bancos = new Map<string, BancoResumo>();
      for (const c of contasConsolidacao) {
        bancos.set(c.id, { id: c.id, nome: c.nome.trim(), transito: !!c.transito,
          entradasBrutas: 0, entradasLiquidas: 0, entradasQtd: 0,
          saidasBrutas: 0, saidasLiquidas: 0, saidasQtd: 0,
          transferOut: 0, transferIn: 0 });
      }
      for (const t of txMes) {
        const r = bancos.get(t.contaId);
        if (!r) continue;
        if (t.amount > 0) {
          r.entradasBrutas += t.amount; r.entradasQtd++;
          if (t.transferenciaParId) r.transferIn += t.amount;
        } else {
          const v = Math.abs(t.amount);
          r.saidasBrutas += v; r.saidasQtd++;
          if (t.transferenciaParId) r.transferOut += v;
        }
      }
      for (const r of bancos.values()) {
        r.entradasLiquidas = r.entradasBrutas - r.transferIn;
        r.saidasLiquidas = r.saidasBrutas - r.transferOut;
      }

      // ── 3) Detector de cobranças bancárias automáticas (saídas)
      const PADROES_COBRANCA = [
        { tipo: "juros_limite",  rx: /JUROS\s*(LIMITE|EXCESSO|SALDO|UTILIZ|ROTATIV|REMUNER)|JURO/i, rotulo: "Juros (cheque especial / limite)" },
        { tipo: "darf",          rx: /\bDARF\b|REC\s*FED|REC\.FED|DA\s*REC/i,                         rotulo: "DARF / Imposto Federal" },
        { tipo: "iof",           rx: /\bIOF\b/i,                                                       rotulo: "IOF" },
        { tipo: "tarifa_pix",    rx: /TARIFA\s*PIX|TAR\s*PIX|TARIFA\s*AVULSA|TAR\s*PIXQR/i,            rotulo: "Tarifa PIX" },
        { tipo: "tarifa_pacote", rx: /PACOTE\s*SERV|MENSALID|CESTA|TARIFA\s*MANUTEN/i,                 rotulo: "Pacote / Mensalidade banco" },
        { tipo: "tarifa_outra",  rx: /^TARIFA\b|\bTAR\b/i,                                             rotulo: "Tarifa avulsa" },
        { tipo: "fatura_cartao", rx: /PAGAM.*CART[ÃA]O\s*CRED|CARTAO\s*MASTER|FATURA\s*CART/i,         rotulo: "Pagamento de fatura (cartão da empresa)" },
        { tipo: "antecipacao",   rx: /ANTECIPA[ÇC][ÃA]O/i,                                             rotulo: "Antecipação de cartão" },
      ];
      type Cobranca = {
        tipo: string; rotulo: string;
        id: string; date: string; description: string; amount: number;
        contaId: string; contaNome: string;
        categoriaId?: string; justificativa?: string;
      };
      const cobrancas: Cobranca[] = [];
      for (const t of txMes) {
        if (t.amount >= 0) continue;
        const desc = String(t.description || "");
        for (const p of PADROES_COBRANCA) {
          if (p.rx.test(desc)) {
            cobrancas.push({
              tipo: p.tipo, rotulo: p.rotulo,
              id: t.id, date: t.date, description: desc, amount: t.amount,
              contaId: t.contaId, contaNome: contasMap.get(t.contaId)?.nome.trim() || "?",
              categoriaId: t.categoriaId, justificativa: t.justificativa,
            });
            break;
          }
        }
      }
      cobrancas.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

      // Agrega por tipo
      const cobrancaPorTipo: Record<string, { rotulo: string; total: number; qtd: number; itens: Cobranca[] }> = {};
      for (const c of cobrancas) {
        if (!cobrancaPorTipo[c.tipo]) cobrancaPorTipo[c.tipo] = { rotulo: c.rotulo, total: 0, qtd: 0, itens: [] };
        cobrancaPorTipo[c.tipo].total += Math.abs(c.amount);
        cobrancaPorTipo[c.tipo].qtd += 1;
        cobrancaPorTipo[c.tipo].itens.push(c);
      }

      // ── 4) Pares de transferência detectados (resumo)
      const paresIdsVistos = new Set<string>();
      const pares: Array<{ outId: string; inId: string; valor: number; data: string; confianca: number; outConta: string; inConta: string }> = [];
      for (const t of txMes) {
        if (!t.transferenciaParId) continue;
        const par = transacoesBanco.find(x => x.id === t.transferenciaParId);
        if (!par) continue;
        const out = t.amount < 0 ? t : par;
        const inn = t.amount > 0 ? t : par;
        const key = [out.id, inn.id].sort().join("|");
        if (paresIdsVistos.has(key)) continue;
        paresIdsVistos.add(key);
        pares.push({
          outId: out.id, inId: inn.id, valor: Math.abs(out.amount), data: out.date,
          confianca: t.transferenciaConfianca || 0,
          outConta: contasMap.get(out.contaId)?.nome.trim() || "?",
          inConta: contasMap.get(inn.contaId)?.nome.trim() || "?",
        });
      }

      // ── 5) Totalizações
      const totalEntradasLiq = Array.from(bancos.values()).reduce((s, r) => s + r.entradasLiquidas, 0);
      const totalSaidasLiq   = Array.from(bancos.values()).reduce((s, r) => s + r.saidasLiquidas, 0);
      const totalCobrancas   = cobrancas.reduce((s, c) => s + Math.abs(c.amount), 0);
      const fluxoMes         = totalEntradasLiq - totalSaidasLiq;
      const gapTrinksBanco   = trinks.total - totalEntradasLiq;
      const gapDinheiro      = trinks.dinheiro - (() => {
        // Soma só os depósitos em ATM
        return txMes.filter(t => t.amount > 0 && /DEP\s*DIN|DEPOSITO/i.test(t.description)).reduce((s, t) => s + t.amount, 0);
      })();

      return res.json({
        ok: true,
        mes,
        trinks,
        bancos: Array.from(bancos.values()).sort((a, b) => {
          if (a.transito !== b.transito) return a.transito ? 1 : -1;
          return b.entradasBrutas - a.entradasBrutas;
        }),
        pares,
        cobrancas: { porTipo: cobrancaPorTipo, total: totalCobrancas, qtd: cobrancas.length },
        totais: {
          entradasLiquidas: totalEntradasLiq,
          saidasLiquidas: totalSaidasLiq,
          fluxoMes,
          gapTrinksBanco,
          gapDinheiroFisico: gapDinheiro,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // CAIXA DO DIA (v30) — dupla confirmação dia-a-dia. Sistema mostra o esperado,
  // usuário digita o contado, salva diferença + observação.
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/caixa-dia/:data — visão consolidada do dia
  app.get("/api/caixa-dia/:data", async (req: Request, res: Response) => {
    try {
      const data = String(req.params.data);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ ok: false, error: "data inválida (YYYY-MM-DD)" });
      const contasMap = new Map(contasConsolidacao.map(c => [c.id, c]));

      // ── Trinks do dia (breakdown por meio)
      // 'plano' (Depósito/saldo pré-pago, NÃO é dinheiro novo entrando — cliente
      // pagou antes), 'voucher' (cortesia, sem dinheiro), 'descontoProf'
      // (abatimento da comissão), 'outros' (qualquer coisa não identificada).
      let trinks = { total: 0, pix: 0, cartao: 0, dinheiro: 0, plano: 0, voucher: 0, descontoProf: 0, outros: 0, qtd: 0 };
      try {
        const dataObj = new Date(data + "T12:00:00");
        const next = new Date(dataObj.getTime() + 24 * 60 * 60 * 1000);
        const fim = next.toISOString().slice(0, 10);
        // Timeout de 5s pra Trinks — se rate-limit+retries fazem demorar,
        // segue com trinks zerado em vez de travar a aba Caixa do Dia.
        const transApi: any = await Promise.race([
          trinksFetchAll("transacoes", { dataInicio: data, dataFim: fim }),
          new Promise((resolve) => setTimeout(() => {
            log(`caixa-dia/trinks timeout 5s — seguindo sem dados Trinks`, "caixa");
            resolve([]);
          }, 5000)),
        ]);
        const arr: any[] = Array.isArray(transApi) ? transApi : (transApi?.data || []);
        for (const t of arr) {
          const raw = t.dataHora || t.dataReferencia || t.data || "";
          const d = typeof raw === "string" ? raw.split("T")[0] : "";
          if (d !== data) continue;
          trinks.total += Number(t.totalPagar || 0);
          trinks.qtd += 1;
          for (const fp of (t.formasPagamentos || t.formasPagamento || [])) {
            const nome = String(fp.nome || "").toLowerCase();
            const v = Number(fp.valor || 0);
            if (nome.includes("pix")) trinks.pix += v;
            else if (nome.includes("créd") || nome.includes("cred") || nome.includes("déb") || nome.includes("deb") || nome.includes("cart")) trinks.cartao += v;
            else if (nome.includes("dinhe") || nome.includes("espéc") || nome.includes("espec")) trinks.dinheiro += v;
            else if (nome.includes("depósito") || nome.includes("deposito") || nome.includes("saldo") || nome.includes("plano") || nome.includes("assinatura")) trinks.plano += v;
            else if (nome.includes("voucher") || nome.includes("cortes") || nome.includes("promo")) trinks.voucher += v;
            else if (nome.includes("descontar") && nome.includes("profissional")) trinks.descontoProf += v;
            else trinks.outros += v;
          }
        }
      } catch (err: any) {
        log(`caixa-dia/trinks erro: ${err.message}`, "caixa");
      }

      // ── Fallback: API Trinks não trouxe nada (rate limit) → usa o CSV
      // "Caixa por comanda" importado em /importar-trinks. Mesma lógica do
      // capturarSnapshotDia (tentativa 2). Mapeia crédito+débito → cartao,
      // pré-pago → plano.
      if (trinks.qtd === 0) {
        try {
          const mesData = data.slice(0, 7);
          const caixaPayload: any = await kvGet(trinksImport.kvKeyFor("caixa", mesData));
          if (caixaPayload?.rows && Array.isArray(caixaPayload.rows)) {
            const rowsDia = caixaPayload.rows.filter((r: any) => (r.data || "").startsWith(data));
            for (const r of rowsDia) {
              trinks.total += Number(r.totalGeral || 0);
              trinks.qtd += 1;
              trinks.cartao += Number(r.totalCredito || 0) + Number(r.totalDebito || 0);
              trinks.dinheiro += Number(r.totalDinheiro || 0);
              trinks.plano += Number(r.totalPrePago || 0);
              trinks.outros += Number(r.totalOutros || 0);
            }
            if (rowsDia.length > 0) {
              log(`caixa-dia/${data}: usando CSV importado (${rowsDia.length} comandas, R$ ${trinks.total})`, "caixa");
            }
          }
        } catch (err: any) {
          log(`caixa-dia/csv-fallback erro: ${err.message}`, "caixa");
        }
      }

      // ── Banco do dia: entradas e saídas por conta
      const txDia = transacoesBanco.filter(t => t.date === data && t.incluidoNoFluxo !== false);
      type RBanco = { id: string; nome: string; transito: boolean;
        entradas: number; entradasQtd: number; saidas: number; saidasQtd: number;
        depositosATM: number; transferOut: number; transferIn: number;
        itens: any[];
      };
      const bancos = new Map<string, RBanco>();
      for (const c of contasConsolidacao) {
        bancos.set(c.id, { id: c.id, nome: c.nome.trim(), transito: !!c.transito,
          entradas: 0, entradasQtd: 0, saidas: 0, saidasQtd: 0,
          depositosATM: 0, transferOut: 0, transferIn: 0, itens: [] });
      }
      let depositosATMDia = 0;
      for (const t of txDia) {
        const r = bancos.get(t.contaId);
        if (!r) continue;
        r.itens.push({
          id: t.id, description: t.description, amount: t.amount,
          categoriaId: t.categoriaId, transferenciaParId: t.transferenciaParId,
          justificativa: t.justificativa,
        });
        if (t.amount > 0) {
          r.entradas += t.amount; r.entradasQtd++;
          if (/DEP\s*DIN|DEPOSITO/i.test(t.description)) {
            r.depositosATM += t.amount;
            depositosATMDia += t.amount;
          }
          if (t.transferenciaParId) r.transferIn += t.amount;
        } else {
          r.saidas += Math.abs(t.amount); r.saidasQtd++;
          if (t.transferenciaParId) r.transferOut += Math.abs(t.amount);
        }
      }

      // ── Saldo inicial sugerido = saldo final do último dia fechado anterior
      // (contado, não esperado — o que de fato tinha em caixa). Se não há
      // fechamento anterior, sugerimos 0 e marcamos com flag pra UI alertar.
      const fechamentoSalvo = await getCaixaFechamento(data);
      const fechamentoAnterior = await getCaixaFechamentoAnterior(data);
      const saldoInicialSugerido = fechamentoSalvo
        ? fechamentoSalvo.saldoInicial
        : (fechamentoAnterior ? fechamentoAnterior.contado : 0);
      const saldoInicialFonte: "fechamento_anterior" | "manual_zero" =
        fechamentoSalvo
          ? (fechamentoSalvo.saldoInicial === (fechamentoAnterior?.contado ?? 0) ? "fechamento_anterior" : "manual_zero")
          : (fechamentoAnterior ? "fechamento_anterior" : "manual_zero");

      // ── Esperado COM o saldo inicial. Sangrias começa em 0 (usuário digita).
      const sangrias = fechamentoSalvo?.sangrias ?? 0;
      const esperadoCaixa = Number((saldoInicialSugerido + trinks.dinheiro - depositosATMDia - sangrias).toFixed(2));

      return res.json({
        ok: true,
        data,
        trinks,
        bancos: Array.from(bancos.values()).sort((a, b) => {
          if (a.transito !== b.transito) return a.transito ? 1 : -1;
          return b.entradas - a.entradas;
        }),
        depositosATMDia,
        saldoInicialSugerido,
        saldoInicialFonte,
        fechamentoAnterior: fechamentoAnterior ? { data: fechamentoAnterior.data, contado: fechamentoAnterior.contado } : null,
        esperadoCaixa,
        fechamento: fechamentoSalvo,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/caixa-dia/:data/fechar — salva fechamento do dia
  // body: { saldoInicial, trinksDinheiro, depositosATM, sangrias, contado, observacao? }
  app.post("/api/caixa-dia/:data/fechar", async (req: Request, res: Response) => {
    try {
      const data = String(req.params.data);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ ok: false, error: "data inválida" });
      const b = req.body || {};
      const saldoInicial = Number(b.saldoInicial);
      const trinksDinheiro = Number(b.trinksDinheiro);
      const depositosATM = Number(b.depositosATM);
      const sangrias = Number(b.sangrias);
      const contado = Number(b.contado);
      for (const [k, v] of [["saldoInicial",saldoInicial],["trinksDinheiro",trinksDinheiro],["depositosATM",depositosATM],["sangrias",sangrias],["contado",contado]]) {
        if (!isFinite(v as number) || (v as number) < 0) return res.status(400).json({ ok: false, error: `${k} inválido` });
      }

      const novo = await upsertCaixaFechamento({
        data, saldoInicial, trinksDinheiro, depositosATM, sangrias, contado,
        observacao: b.observacao ? String(b.observacao).slice(0, 500) : undefined,
      });
      return res.json({ ok: true, fechamento: novo });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── v53: Caixa do Dia — Conferência D+1 (cartão/PIX vendido vs caiu no Itaú)
  // Vende dia X → cartão cai dia X+1 (REDE AT=crédito, DB=débito), PIX cai dia X.
  // Esperado líquido = venda − taxa (maquininha). "bate" se |dif| ≤ tolerância.
  app.get("/api/caixa-dia/conferencia/:data", async (req: Request, res: Response) => {
    try {
      const data = String(req.params.data);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ ok: false, error: "data inválida (YYYY-MM-DD)" });
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const mes = data.slice(0, 7);
      const cfg = await getConfigFin();
      const taxaPct = Number(cfg.taxaCartaoPct || 0);
      const TOL = 50; // tolerância R$

      // dia seguinte ÚTIL (D+1) pra liquidação de cartão — pula sáb/dom
      // (venda de sexta liquida na segunda). getUTCDay: 0=dom, 6=sáb.
      const d1 = new Date(data + "T12:00:00Z"); d1.setUTCDate(d1.getUTCDate() + 1);
      while (d1.getUTCDay() === 0 || d1.getUTCDay() === 6) d1.setUTCDate(d1.getUTCDate() + 1);
      const dataMais1 = d1.toISOString().slice(0, 10);

      // ── Vendido no dia (por forma) — API Trinks ao vivo PRIMEIRO, CSV de reserva ──
      const vend = { credito: 0, debito: 0, pix: 0, dinheiro: 0, plano: 0, outros: 0 };
      const classificaForma = (nome: string, v: number) => {
        const f = (nome || "").toLowerCase();
        if (f.includes("pix")) vend.pix += v;
        else if (f.includes("créd") || f.includes("cred")) vend.credito += v;
        else if (f.includes("déb") || f.includes("deb")) vend.debito += v;
        else if (f.includes("dinhe") || f.includes("vista") || f.includes("espéc") || f.includes("espec")) vend.dinheiro += v;
        else if (f.includes("depós") || f.includes("depos") || f.includes("pré") || f.includes("pre-") || f.includes("plano") || f.includes("assinatura") || f.includes("saldo")) vend.plano += v;
        else vend.outros += v;
      };
      let fonteVenda: "trinks" | "csv" | "csv-caixa" | null = null;
      let trinks429 = false;
      let qtdVendas = 0;

      // v85 csv-only: usa SÓ o CSV (0 chamadas Trinks — a API ao vivo era 429 crônico
      // e travava ~6s esperando timeout). Se há financeiro do dia, usa; senão o CSV
      // Caixa abaixo cobre como fallback. Sem CSV nenhum → "sem dados" (rápido).
      const finPayload: any = await kvGet(trinksImport.kvKeyFor("financeiro", mes));
      const finRows: any[] = Array.isArray(finPayload?.rows) ? finPayload.rows.filter((r: any) => (r.data || "").startsWith(data)) : [];
      if (finRows.length > 0) {
        for (const r of finRows) {
          classificaForma(`${r.tipoFormaPagamento || ""} ${r.formaPagamento || ""}`, Number(r.valorPago || r.valorReceber || 0));
        }
        fonteVenda = "csv";
        qtdVendas = finRows.length;
      }

      // ── Vendido por tipo + por forma (CSV Caixa) ──
      // O CSV de Caixa traz, por comanda, tanto o breakdown por tipo (serviço/
      // produto/pacote) quanto por forma de pagamento (crédito/débito/dinheiro/
      // pré-pago). Servem de reserva pro "vendido por forma" quando o financeiro
      // do dia não existe e a API está em 429 — fecha o caixa sem tocar a Trinks.
      const tipo = { servico: 0, produto: 0, pacote: 0 };
      const vendCaixa = { credito: 0, debito: 0, pix: 0, dinheiro: 0, plano: 0, outros: 0 };
      const caixaPayload: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
      const caixaRows: any[] = Array.isArray(caixaPayload?.rows) ? caixaPayload.rows.filter((r: any) => (r.data || "").startsWith(data)) : [];
      for (const r of caixaRows) {
        tipo.servico += Number(r.totalServico || 0);
        tipo.produto += Number(r.totalProdutos || 0);
        tipo.pacote += Number(r.totalPacotes || 0);
        vendCaixa.credito += Number(r.totalCredito || 0);
        vendCaixa.debito += Number(r.totalDebito || 0);
        vendCaixa.dinheiro += Number(r.totalDinheiro || 0);
        vendCaixa.plano += Number(r.totalPrePago || 0);
        // No relatório de Caixa da Trinks o PIX é lançado em "Total Outros"
        // (não há coluna PIX dedicada). Confirmado batendo com o PIX que caiu no
        // Itaú (02/06: outros R$1.323 vs caiu R$1.286). Vale-presente → outros.
        vendCaixa.pix += Number(r.totalOutros || 0);
        vendCaixa.outros += Number(r.totalVale || 0);
      }
      // fallback: financeiro do dia vazio + API indisponível → usa as formas do Caixa.
      if (fonteVenda === null && caixaRows.length > 0 &&
          (vendCaixa.credito + vendCaixa.debito + vendCaixa.dinheiro + vendCaixa.plano + vendCaixa.pix + vendCaixa.outros) > 0) {
        vend.credito = vendCaixa.credito;
        vend.debito = vendCaixa.debito;
        vend.dinheiro = vendCaixa.dinheiro;
        vend.plano = vendCaixa.plano;
        vend.pix = vendCaixa.pix;
        vend.outros = vendCaixa.outros;
        fonteVenda = "csv-caixa";
        qtdVendas = caixaRows.length;
      }

      // ── Caiu no Itaú ──
      const contasObs = new Set(contasConsolidacao.filter(c => c.observacao).map(c => c.id));
      let caiuCredito = 0, caiuDebito = 0, caiuPix = 0;
      for (const t of transacoesBanco) {
        if (contasObs.has(t.contaId) || Number(t.amount) <= 0 || t.incluidoNoFluxo === false) continue;
        const up = (t.description || "").toUpperCase();
        if (t.date === dataMais1 && up.includes("REDE")) {
          if (/\bAT\d|AT0|VISA AT|MAST AT|ELO AT|AMEX AT/.test(up) || up.includes(" AT")) caiuCredito += t.amount;
          else if (/\bDB\d|DB0|VISA DB|MAST DB|ELO DB| DB/.test(up)) caiuDebito += t.amount;
        }
        if (t.date === data && up.includes("PIX") && (up.includes("RECEB") || up.includes("QR"))) caiuPix += t.amount;
      }

      // ── Esperado líquido (desconta taxa do cartão) ──
      const linhaConf = (forma: string, vendido: number, taxa: number, caiu: number) => {
        const esperadoLiq = r2(vendido * (1 - taxa / 100));
        const dif = r2(caiu - esperadoLiq);
        return { forma, vendido: r2(vendido), taxaPct: taxa, esperadoLiquido: esperadoLiq, caiu: r2(caiu), diferenca: dif, bate: Math.abs(dif) <= TOL };
      };
      const linhas = [
        linhaConf("Crédito", vend.credito, taxaPct, caiuCredito),
        linhaConf("Débito", vend.debito, taxaPct, caiuDebito),
        linhaConf("PIX", vend.pix, 0, caiuPix),
      ];
      const todasBatem = linhas.every(l => l.bate);
      const temVenda = fonteVenda !== null;

      const fechamento = await kvGet<any>(`caixa_conferencia:${data}`);

      return res.json({
        ok: true, data, dataMais1,
        temVenda, fonteVenda, trinks429, qtdVendas,
        vendido: { credito: r2(vend.credito), debito: r2(vend.debito), pix: r2(vend.pix), dinheiro: r2(vend.dinheiro), plano: r2(vend.plano), outros: r2(vend.outros) },
        porTipo: { servico: r2(tipo.servico), produto: r2(tipo.produto), pacote: r2(tipo.pacote) },
        linhas, todasBatem, taxaPct, tolerancia: TOL,
        fechamento: fechamento || null,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // v82: lista os FECHAMENTOS diários (snapshot/email Trinks) + quanto caiu no Itaú
  // por dia, pra conferir o caixa de manhã. Últimos N dias com movimento.
  app.get("/api/caixa-dia-fechamentos", async (req: Request, res: Response) => {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const TOL = 50;
      const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes)) ? String(req.query.mes) : ymdHoje().slice(0, 7);
      const contasObs = new Set(contasConsolidacao.filter(c => c.observacao).map(c => c.id));

      // ── Calculadora do mês POR FORMA (fonte: Caixa CSV, que tem o breakdown) ──
      const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
      const cxRows = Array.isArray(caixa?.rows) ? caixa.rows : [];
      let pix = 0, credito = 0, debito = 0, dinheiro = 0, planos = 0, totalCaixa = 0;
      for (const r of cxRows) {
        pix += Number(r.totalOutros || 0);        // no Trinks, PIX cai em "Outros"
        credito += Number(r.totalCredito || 0);
        debito += Number(r.totalDebito || 0);
        dinheiro += Number(r.totalDinheiro || 0);
        planos += Number(r.totalPacotes || 0);    // venda de pacote/Clube (recorte por tipo)
        totalCaixa += Number(r.totalGeral || 0);
      }

      // ── Fechamentos de TODOS os dias do mês (snapshot/email) + caiu no Itaú ──
      const snaps = await listSnapshotsDoMes(mes);
      const comMovimento = snaps.filter((s: any) => Number(s?.faturamento?.total || 0) > 0)
        .sort((a: any, b: any) => b.data.localeCompare(a.data));
      let totalEmail = 0;
      const fechamentos = comMovimento.map((snap: any) => {
        const data = snap.data;
        const d1 = new Date(data + "T12:00:00Z"); d1.setUTCDate(d1.getUTCDate() + 1);
        while (d1.getUTCDay() === 0 || d1.getUTCDay() === 6) d1.setUTCDate(d1.getUTCDate() + 1);
        const dataMais1 = d1.toISOString().slice(0, 10);
        let caiu = 0;
        for (const t of transacoesBanco) {
          if (contasObs.has(t.contaId) || Number(t.amount) <= 0 || t.incluidoNoFluxo === false) continue;
          const up = (t.description || "").toUpperCase();
          if (t.date === dataMais1 && up.includes("REDE")) caiu += t.amount;
          else if (t.date === data && up.includes("PIX") && (up.includes("RECEB") || up.includes("QR"))) caiu += t.amount;
        }
        const fechamentoTrinks = Number(snap.faturamento.total || 0);
        totalEmail += fechamentoTrinks;
        return { data, fechamentoTrinks: r2(fechamentoTrinks), fonte: snap.fonte, caiuItau: r2(caiu), diferenca: r2(caiu - fechamentoTrinks) };
      });

      // receita OFICIAL do mês (Total Mês do email Trinks — inclui Clube/recorrente)
      const tm: any = await kvGet(`trinks_total_mes:${mes}`);
      const totalOficial = Number(tm?.total || 0);
      const recorrente = totalOficial > 0 ? r2(totalOficial - totalCaixa) : 0;

      return res.json({
        ok: true, mes, tolerancia: TOL,
        calculadora: {
          pix: r2(pix), credito: r2(credito), debito: r2(debito), dinheiro: r2(dinheiro),
          planos: r2(planos), totalCaixa: r2(totalCaixa), totalEmail: r2(totalEmail),
          totalOficial: r2(totalOficial),               // receita oficial Trinks (com Clube)
          recorrente: recorrente > 0 ? recorrente : 0,  // diferença = Clube/recorrente fora do caixa
        },
        fechamentos,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // v86 Tier2: GET /api/caixa-dinheiro?mes= — caixa em dinheiro + débitos de
  // clientes, por dia e consolidado do mês (fonte: e-mail Trinks "Resumo do dia").
  app.get("/api/caixa-dinheiro", async (req: Request, res: Response) => {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes)) ? String(req.query.mes) : ymdHoje().slice(0, 7);
      const snaps = await listSnapshotsDoMes(mes);
      const comCaixa = snaps.filter((s: any) => s.caixaDinheiro).sort((a: any, b: any) => b.data.localeCompare(a.data));
      const tot = { abertura: 0, recebido: 0, troco: 0, despesas: 0, totalDinheiro: 0, sangria: 0, saldo: 0 };
      const totDeb = { clientesEmDebito: 0, servicosDebito: 0, produtosDebito: 0, totalDebito: 0 };
      const dias = comCaixa.map((s: any) => {
        const cx = s.caixaDinheiro, db = s.debitos || { clientesEmDebito: 0, servicosDebito: 0, produtosDebito: 0, totalDebito: 0 };
        for (const k of Object.keys(tot)) (tot as any)[k] += Number(cx[k] || 0);
        for (const k of Object.keys(totDeb)) (totDeb as any)[k] += Number(db[k] || 0);
        return { data: s.data, ...cx, ...db };
      });
      // o "débito do mês" relevante é o do ÚLTIMO dia (saldo devedor acumulado), não a soma
      const ultimoDebito = comCaixa.length ? (comCaixa[0].debitos || null) : null;
      const r2obj = (o: any) => { const x: any = {}; for (const k of Object.keys(o)) x[k] = r2(o[k]); return x; };
      return res.json({
        ok: true, mes,
        dias,
        totaisCaixa: r2obj(tot),
        totaisDebitoMes: r2obj(totDeb),
        debitoAtual: ultimoDebito ? r2obj(ultimoDebito) : null,
        // reconciliação: abertura + recebido + troco - despesas - sangria = saldo
        reconciliacao: r2(tot.abertura + tot.recebido + tot.troco - tot.despesas - tot.sangria),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // POST /api/caixa-dia/conferencia/:data — salva "bate / não bate" + justificativa
  app.post("/api/caixa-dia/conferencia/:data", async (req: Request, res: Response) => {
    try {
      const data = String(req.params.data);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ ok: false, error: "data inválida" });
      const status = req.body?.status;
      if (status !== "bate" && status !== "nao_bate") return res.status(400).json({ ok: false, error: "status deve ser 'bate' ou 'nao_bate'" });
      const reg = {
        data, status,
        justificativa: req.body?.justificativa ? String(req.body.justificativa).slice(0, 500) : "",
        fechadoEm: new Date().toISOString(),
      };
      await kvSet(`caixa_conferencia:${data}`, reg);
      return res.json({ ok: true, fechamento: reg });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // DELETE /api/caixa-dia/:data — reabre o dia (apaga fechamento)
  app.delete("/api/caixa-dia/:data", async (req: Request, res: Response) => {
    try {
      const data = String(req.params.data);
      await deleteCaixaFechamento(data);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/caixa-dia/historico/:mes — todos fechamentos do mês (calendário)
  app.get("/api/caixa-dia-historico/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido" });
      const all = await listCaixaFechamentos();
      const lista = Object.values(all).filter(f => f.data.startsWith(mes)).sort((a, b) => a.data.localeCompare(b.data));
      const totalDif = lista.reduce((s, f) => s + f.diferenca, 0);
      return res.json({ ok: true, mes, total: lista.length, totalDif, fechamentos: lista });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/consolidacao/dedup — remove duplicatas (mesma chave) mantendo a mais antiga
  app.post("/api/consolidacao/dedup", (_req: Request, res: Response) => {
    const before = transacoesBanco.length;
    const { removidas, restantes } = dedupTransacoesBancoInPlace();
    if (removidas > 0) saveTransacoesBanco();
    log(`[consolidacao/dedup] removidas=${removidas} antes=${before} depois=${restantes}`, "consolidacao");
    return res.json({ ok: true, removidas, restantes });
  });

  // PATCH /api/consolidacao/transacoes/:id/fluxo — toggle inclusão no fluxo
  app.patch("/api/consolidacao/transacoes/:id/fluxo", (req: Request, res: Response) => {
    const id = String(req.params.id || "");
    const { incluido } = req.body;
    const tx = transacoesBanco.find(t => t.id === id);
    if (!tx) return res.status(404).json({ ok: false, error: "Transação não encontrada" });
    tx.incluidoNoFluxo = incluido !== false; // default true
    saveTransacoesBanco();
    return res.json({ ok: true, transacao: tx });
  });

  // DELETE /api/consolidacao/transacoes/:id — apaga uma transação específica
  app.delete("/api/consolidacao/transacoes/:id", (req: Request, res: Response) => {
    const id = String(req.params.id || "");
    const before = transacoesBanco.length;
    transacoesBanco = transacoesBanco.filter(t => t.id !== id);
    if (transacoesBanco.length === before) {
      return res.status(404).json({ ok: false, error: "Transação não encontrada" });
    }
    saveTransacoesBanco();
    return res.json({ ok: true });
  });

  // DELETE /api/consolidacao/transacoes — body: { contaId, mes }
  app.delete("/api/consolidacao/transacoes", (req: Request, res: Response) => {
    const { contaId, mes } = req.body;
    const before = transacoesBanco.length;
    transacoesBanco = transacoesBanco.filter(t => {
      if (contaId && t.contaId !== contaId) return true;
      if (mes && !t.date.startsWith(mes)) return true;
      return false;
    });
    saveTransacoesBanco();
    return res.json({ ok: true, removed: before - transacoesBanco.length });
  });

  // ──────────────────────────────────────────────────────────────────
  // SERVICE COSTS ROUTES
  // ──────────────────────────────────────────────────────────────────

  app.get("/api/service-costs", (_req: Request, res: Response) => {
    return res.json(serviceCosts);
  });

  // v72: upsert de UM serviço (não mexe nos demais) — usado pelo editor por serviço.
  app.put("/api/service-costs/:serviceId", (req: Request, res: Response) => {
    const id = String(req.params.serviceId || "");
    if (!id) return res.status(400).json({ ok: false, error: "serviceId obrigatório" });
    const c = req.body || {};
    const clamp = (v: any) => Math.max(0, Math.min(100, Number(v) || 0));
    const entry: ServiceCostEntry = {
      serviceId: id,
      serviceName: String(c.serviceName || ""),
      items: Array.isArray(c.items) ? c.items.map((it: any) => ({
        id: String(it.id || `item-${Math.random().toString(36).slice(2, 8)}`),
        name: String(it.name || ""), category: it.category || "produto",
        quantity: Math.max(0, Number(it.quantity) || 0), unitCost: Math.max(0, Number(it.unitCost) || 0),
      })) : [],
    };
    if (c.comissaoPct !== undefined && c.comissaoPct !== null && c.comissaoPct !== "") entry.comissaoPct = clamp(c.comissaoPct);
    if (c.comissaoAssistentePct !== undefined && c.comissaoAssistentePct !== null && c.comissaoAssistentePct !== "") entry.comissaoAssistentePct = clamp(c.comissaoAssistentePct);
    if (c.margemDesejadaPct !== undefined && c.margemDesejadaPct !== null && c.margemDesejadaPct !== "") entry.margemDesejadaPct = clamp(c.margemDesejadaPct);
    if (c.outrosCustos !== undefined && c.outrosCustos !== null && c.outrosCustos !== "") { const v = Number(c.outrosCustos); if (isFinite(v) && v >= 0) entry.outrosCustos = v; }
    serviceCosts = serviceCosts.filter(x => x.serviceId !== id);
    serviceCosts.push(entry);
    saveServiceCosts();
    return res.json({ ok: true, serviceCost: entry });
  });

  app.post("/api/service-costs", (req: Request, res: Response) => {
    const { costs } = req.body;
    if (!Array.isArray(costs)) {
      return res.status(400).json({ error: "costs must be an array" });
    }
    serviceCosts = costs.map((c: any) => {
      const entry: ServiceCostEntry = {
        serviceId: String(c.serviceId || ""),
        serviceName: String(c.serviceName || ""),
        items: Array.isArray(c.items) ? c.items.map((item: any) => ({
          id: String(item.id || ""),
          name: String(item.name || ""),
          category: String(item.category || "outro"),
          quantity: Number(item.quantity || 0),
          unitCost: Number(item.unitCost || 0),
        })) : [],
      };
      // Persistir overrides apenas se vierem com valor válido (0..100).
      if (c.comissaoPct !== undefined && c.comissaoPct !== null && c.comissaoPct !== "") {
        const v = Number(c.comissaoPct);
        if (isFinite(v)) entry.comissaoPct = Math.max(0, Math.min(100, v));
      }
      if (c.margemDesejadaPct !== undefined && c.margemDesejadaPct !== null && c.margemDesejadaPct !== "") {
        const v = Number(c.margemDesejadaPct);
        if (isFinite(v)) entry.margemDesejadaPct = Math.max(0, Math.min(100, v));
      }
      if (c.comissaoAssistentePct !== undefined && c.comissaoAssistentePct !== null && c.comissaoAssistentePct !== "") {
        const v = Number(c.comissaoAssistentePct);
        if (isFinite(v)) entry.comissaoAssistentePct = Math.max(0, Math.min(100, v));
      }
      if (c.outrosCustos !== undefined && c.outrosCustos !== null && c.outrosCustos !== "") {
        const v = Number(c.outrosCustos);
        if (isFinite(v) && v >= 0) entry.outrosCustos = v;  // v70
      }
      return entry;
    });
    saveServiceCosts();
    log(`Service costs: saved ${serviceCosts.length} entries`, "costs");
    return res.json({ ok: true, count: serviceCosts.length });
  });

  // ──────────────────────────────────────────────────────────────────
  // FINANCEIRO ROUTES
  // ──────────────────────────────────────────────────────────────────

  // ─── GET /api/financeiro — Return all entries for current month
  // Combines manual entries with auto-generated Trinks revenue entries
  app.get("/api/financeiro", async (req: Request, res: Response) => {
    // Etapa 1: respeita ?mes=YYYY-MM (default = mês corrente SP). Antes usava `now`
    // e IGNORAVA o mês. Linhas AUTO (faturamento/comissão/material) vêm da fonte
    // canônica via construirEntradasAuto — blindado contra 429 (não zera mais).
    const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const mesQ = String(req.query.mes || "");
    const mes = /^\d{4}-\d{2}$/.test(mesQ) ? mesQ : hojeSP.slice(0, 7);
    const monthEntries = financeEntries.filter(e => e.date.startsWith(mes));

    const { entries: autoEntries } = await construirEntradasAuto(mes);

    const allEntries = [...monthEntries, ...autoEntries];
    // Sort by date descending, then by createdAt descending
    allEntries.sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    return res.json(allEntries);
  });

  // GET /api/lancamentos/resumo/:mes — v49: livro do Itaú categorizado.
  // Agrega o extrato do Itaú por tipo de categoria: ENTRADA (faturamento) /
  // SAÍDA (despesas por tipo) / NEUTRO (caixa/transferência/estorno — não conta).
  // No fim compara o faturamento marcado × Trinks (API + CSV). Só o Itaú conta.
  app.get("/api/lancamentos/resumo/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "Mês inválido." });

      // conta-funil Itaú (exclui observação)
      const ativas = contasConsolidacao.filter(c => c.ativa !== false && !c.observacao);
      let itau = ativas.find(c => /ita[uú]/i.test(c.nome || ""));
      if (!itau) { const t = ativas.find(c => c.transito && c.contaDestinoId); if (t) itau = ativas.find(c => c.id === t!.contaDestinoId); }
      if (!itau) { const b = ativas.filter(c => c.tipo === "banco"); if (b.length === 1) itau = b[0]; else if (ativas.length === 1) itau = ativas[0]; }

      const cats = await listExpenseCategorias();
      const catMap = new Map(cats.map(c => [c.id, c]));
      const tx = itau ? transacoesBanco.filter(t => t.contaId === itau!.id && t.date.startsWith(mes) && t.incluidoNoFluxo !== false) : [];

      const entrou = { total: 0, porCategoria: {} as Record<string, number> };
      const saiu = { total: 0, porTipo: {} as Record<string, number> };
      const neutro = { total: 0 };
      let aClassificarEntrada = 0, aClassificarSaida = 0;

      for (const t of tx) {
        const cat = t.categoriaId ? catMap.get(t.categoriaId) : null;
        const v = Number(t.amount || 0);
        if (!cat) {
          if (v > 0) aClassificarEntrada += v; else aClassificarSaida += Math.abs(v);
          continue;
        }
        const tc = tipoConta(cat.tipo);
        if (tc === "entrada") { entrou.total += Math.abs(v); entrou.porCategoria[cat.nome] = (entrou.porCategoria[cat.nome] || 0) + Math.abs(v); }
        else if (tc === "neutro") { neutro.total += Math.abs(v); }
        else { saiu.total += Math.abs(v); saiu.porTipo[cat.tipo] = (saiu.porTipo[cat.tipo] || 0) + Math.abs(v); }
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;

      // Trinks (API + CSV) p/ comparação
      let md: any = null;
      try { md = await getMesDataCanonical(mes, { trinksFetchAllRange, log }); } catch {}
      const fa = md?.fontesAuditoria || {};
      const trinks = {
        canonico: r2(md?.faturamento || 0),
        fonte: md?.fonte || null,
        api: r2(fa.apiTrinks?.faturamento || 0),
        csvCaixa: r2(fa.csvCaixa?.faturamento || 0),
        csvFinanceiro: r2(fa.csvFinanceiro?.faturamento || 0),
      };

      return res.json({
        ok: true, mes,
        contaItau: itau ? { id: itau.id, nome: itau.nome } : null,
        entrou: { total: r2(entrou.total), porCategoria: Object.fromEntries(Object.entries(entrou.porCategoria).map(([k, v]) => [k, r2(v)])) },
        saiu: { total: r2(saiu.total), porTipo: Object.fromEntries(Object.entries(saiu.porTipo).map(([k, v]) => [k, r2(v)])) },
        neutro: { total: r2(neutro.total) },
        aClassificarEntrada: r2(aClassificarEntrada),
        aClassificarSaida: r2(aClassificarSaida),
        sobra: r2(entrou.total - saiu.total),
        trinks,
        diffFaturamentoVsTrinks: r2(entrou.total - (md?.faturamento || 0)),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // GET /api/lancamentos/conferencia/:mes — Etapa 2 (Bloco 3): esperado (faturamento
  // canônico) vs caiu no Itaú (extrato da conta-funil), por forma de pagamento.
  // Granularidade do extrato: PIX · Cartão (créd+déb juntos) · Dinheiro. Clube Greco
  // (InfinitePay→Itaú) é linha à parte com status "a caminho" (não soma como erro).
  app.get("/api/lancamentos/conferencia/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ ok: false, error: "Mês inválido. Use YYYY-MM." });
      }
      const TOL = 100;

      // 1) Esperado — breakdown canônico (não zera em 429 se há CSV).
      let md: any = null;
      try { md = await getMesDataCanonical(mes, { trinksFetchAllRange, log }); } catch { md = null; }
      const b = md?.breakdown || { pix: 0, cartaoCredito: 0, cartaoDebito: 0, dinheiro: 0, plano: 0, voucher: 0, outros: 0 };
      const esperado = { pix: b.pix || 0, cartao: (b.cartaoCredito || 0) + (b.cartaoDebito || 0), dinheiro: b.dinheiro || 0 };
      const clubeEsperado = b.plano || 0;

      // 2) Conta-funil Itaú — auto-detect: nome contém "itaú/itau" → destino de conta
      //    de trânsito → única conta banco → única conta.
      // Só contas contábeis (exclui observação tipo InfinitePay).
      const ativas = contasConsolidacao.filter(c => c.ativa !== false && !c.observacao);
      let contaItau = ativas.find(c => /ita[uú]/i.test(c.nome || ""));
      if (!contaItau) {
        const trans = ativas.find(c => c.transito && c.contaDestinoId);
        if (trans) contaItau = ativas.find(c => c.id === trans!.contaDestinoId);
      }
      if (!contaItau) {
        const bancos = ativas.filter(c => c.tipo === "banco");
        if (bancos.length === 1) contaItau = bancos[0];
        else if (ativas.length === 1) contaItau = ativas[0];
      }

      // 3) Caiu no Itaú — entradas da conta-funil no mês, classificadas por forma.
      const classifica = (t: any): "pix" | "cartao" | "dinheiro" | "outros" => {
        const tipo = (t.tipo || "").toLowerCase();
        if (tipo === "pix") return "pix";
        if (/cred|deb/.test(tipo)) return "cartao";
        const d = (t.description || "").toLowerCase();
        if (d.includes("pix")) return "pix";
        if (/maquin|cart|cred|deb|antecip/.test(d)) return "cartao";
        if (/deposit|dep dinh/.test(d)) return "dinheiro";
        return "outros";
      };
      const caiu = { pix: 0, cartao: 0, dinheiro: 0 };
      const detalhe: Record<string, Array<{ date: string; description: string; amount: number }>> = { pix: [], cartao: [], dinheiro: [], clube: [] };
      let clubeCaiu = 0;
      const txItau = contaItau
        ? transacoesBanco.filter(t => t.contaId === contaItau!.id && t.date.startsWith(mes) && t.amount > 0 && t.incluidoNoFluxo !== false)
        : [];
      for (const t of txItau) {
        const linha = { date: t.date, description: t.description, amount: t.amount };
        // Clube = transferência interna (InfinitePay→Itaú) OU recebimento de
        // assinatura/Clube (não é venda no cartão — vai pra linha do Clube).
        const desc = (t.description || "").toLowerCase();
        if (t.transferenciaParId || (t.tipo || "").toLowerCase() === "transferencia"
            || /assinatura|clube|infinitepay|infinite pay/.test(desc)) {
          clubeCaiu += t.amount; detalhe.clube.push(linha); continue;
        }
        const f = classifica(t);
        if (f === "outros") continue;
        caiu[f] += t.amount;
        detalhe[f].push(linha);
      }

      const statusDe = (esp: number, real: number): "verde" | "amarelo" | "vermelho" => {
        const dif = real - esp;
        if (Math.abs(dif) <= TOL) return "verde";
        return dif < 0 ? "vermelho" : "amarelo"; // faltou=vermelho, sobrou=amarelo
      };
      const mk = (forma: string, esp: number, real: number) => ({ forma, esperado: esp, caiu: real, diferenca: real - esp, status: statusDe(esp, real) });
      const linhas = [
        mk("PIX", esperado.pix, caiu.pix),
        mk("Cartão", esperado.cartao, caiu.cartao),
        mk("Dinheiro", esperado.dinheiro, caiu.dinheiro),
      ];

      // 4) Clube Greco — "a caminho" (neutro) até o limiar; nunca vermelho de erro.
      const diasThreshold = Number((await kvGet("lancamentos_clube_dias")) || 15) || 15;
      const fimMes = ultimoDiaDoMes(`${mes}-01`);
      const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const fimRef = hojeSP < fimMes ? hojeSP : fimMes;
      const diasDesde = Math.floor((Date.parse(`${hojeSP}T00:00:00Z`) - Date.parse(`${fimRef}T00:00:00Z`)) / 86_400_000);
      let clubeStatus: "verde" | "a_caminho" | "pendente";
      if (clubeCaiu >= clubeEsperado - TOL) clubeStatus = "verde";
      else if (diasDesde <= diasThreshold) clubeStatus = "a_caminho";
      else clubeStatus = "pendente";
      const clube = { esperado: clubeEsperado, caiu: clubeCaiu, diferenca: clubeCaiu - clubeEsperado, status: clubeStatus, diasThreshold, diasDesde };

      return res.json({
        ok: true, mes,
        fonteEsperado: md?.fonte || null,
        contaItau: contaItau ? { id: contaItau.id, nome: contaItau.nome } : null,
        linhas, clube, detalhe,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // ── ETAPA 1 (blindagem 429): linhas AUTO de Lançamentos via FONTE CANÔNICA v42 ──
  // Antes, receita/comissão/material liam o full_sync da Trinks AO VIVO e ZERAVAM em
  // 429. Agora: faturamento ← mesService (mês fechado=CSV, nunca Trinks; corrente=API
  // c/ fallback CSV); comissão ← ranking×categoria (getRankComissaoMap, mesmo motor do
  // Pagamento/v42) quando há ranking, senão ao vivo; material só com agendamentos ao
  // vivo, senão omite com nota (nunca número fake). Reusado por GET /api/financeiro e
  // computeTotaisDoMes — fonte única, sem duplicar regra.
  // v55: transações de um mês com csv-first (anti-vazamento de cota Trinks).
  // Reusa o mesService canônico: mês fechado → CSV (0 API); corrente → API c/
  // fallback CSV + cache. Substitui os trinksFetchAll("transacoes", {mês}) que
  // batiam a API ao vivo mesmo em mês fechado (Pagamento/Conciliação/etc).
  async function transacoesMesCsvFirst(mes: string): Promise<any[]> {
    try {
      const md: any = await getMesDataCanonical(mes, { trinksFetchAllRange, log });
      return Array.isArray(md?.transacoes) ? md.transacoes : [];
    } catch { return []; }
  }

  // v70: média de atendimentos/mês dos meses FECHADOS (Caixa), pra ratear o custo
  // fixo POR ATENDIMENTO de forma estável (não flutua com o mês corrente parcial).
  async function mediaAtendimentosMes(mesCorrente?: string): Promise<{ media: number; meses: number }> {
    const corrente = mesCorrente || new Date().toISOString().slice(0, 7);
    const totais: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const mes = `2026-${String(m).padStart(2, "0")}`;
      if (mes >= corrente) continue; // exclui o mês corrente (parcial) e futuros
      const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
      if (Array.isArray(caixa?.rows) && caixa.rows.length > 0) {
        const n = caixa.rows.filter((r: any) => !String(r.tipo || "").toLowerCase().includes("estorno")).length;
        if (n > 0) totais.push(n);
      }
    }
    if (totais.length === 0) return { media: 0, meses: 0 };
    return { media: Math.round(totais.reduce((a, b) => a + b, 0) / totais.length), meses: totais.length };
  }

  // v74: custo fixo por atendimento = MÉDIA das despesas fixas ÷ MÉDIA de
  // atendimentos, ambos dos MESES FECHADOS (decisão do dono: estável, do
  // "fechamento mensal"). Reflete automaticamente quando as fixas forem
  // categorizadas (extrato Itaú + regras).
  async function custoFixoAtendimentoMedio(mesCorrente?: string): Promise<{
    custoFixoPorAtendimento: number; mediaFixas: number; mediaAtendimentos: number; meses: number;
  }> {
    const corrente = mesCorrente || new Date().toISOString().slice(0, 7);
    const fixasArr: number[] = [], atendArr: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const mes = `2026-${String(m).padStart(2, "0")}`;
      if (mes >= corrente) continue;
      const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
      if (!Array.isArray(caixa?.rows) || caixa.rows.length === 0) continue;
      const atend = caixa.rows.filter((r: any) => !String(r.tipo || "").toLowerCase().includes("estorno")).length;
      if (atend === 0) continue;
      let totFix = 0;
      try { totFix = Number((await computeTotaisDoMes(mes))?.totalFixas || 0); } catch {}
      fixasArr.push(totFix);
      atendArr.push(atend);
    }
    if (fixasArr.length === 0) return { custoFixoPorAtendimento: 0, mediaFixas: 0, mediaAtendimentos: 0, meses: 0 };
    const mediaFixas = fixasArr.reduce((a, b) => a + b, 0) / fixasArr.length;
    const mediaAtend = atendArr.reduce((a, b) => a + b, 0) / atendArr.length;
    return {
      custoFixoPorAtendimento: mediaAtend > 0 ? Math.round((mediaFixas / mediaAtend) * 100) / 100 : 0,
      mediaFixas: Math.round(mediaFixas * 100) / 100,
      mediaAtendimentos: Math.round(mediaAtend),
      meses: fixasArr.length,
    };
  }

  // A2: margem por categoria (Express/Clássico/VIP + Produtos) do ranking de
  // profissionais. Estética PENDENTE (precisa do relatório por serviço). Custo
  // fixo do mês é rateado por participação na receita de serviço; taxa+imposto da config.
  async function calcularCategoriasMargem(mes: string): Promise<any | null> {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const rk: any = await kvGet(trinksImport.kvKeyFor("ranking", mes));
      const profs = rk?.periodos?.[0]?.profissionais;
      if (!Array.isArray(profs) || profs.length === 0) return null;
      const cfg = await getConfigFin();
      const totais = await computeTotaisDoMes(mes);
      const taxa = Number(cfg.taxaCartaoPct || 0) / 100;
      const imp = Number(cfg.impostoPct || 0) / 100;
      const acc: Record<string, { receita: number; comissao: number; atend: number }> = {
        Express: { receita: 0, comissao: 0, atend: 0 },
        Classico: { receita: 0, comissao: 0, atend: 0 },
        VIP: { receita: 0, comissao: 0, atend: 0 },
      };
      let produtosReceita = 0, semCategoria = 0;
      for (const p of profs) {
        const cat = categoriaPorApelidoRanking(p.profissional);
        const serv = Number(p.totalServicos || 0);
        produtosReceita += Number(p.totalProdutos || 0);
        if (cat === "VIP" || cat === "Express" || cat === "Classico") {
          acc[cat].receita += serv;
          acc[cat].comissao += comissaoServicosRanking(p.profissional, serv).comissao;
          acc[cat].atend += Number(p.qtdAtendimentos || 0);
        } else {
          semCategoria += serv;
        }
      }
      const receitaServTotal = acc.Express.receita + acc.Classico.receita + acc.VIP.receita + semCategoria;
      const fixoTotal = Number(totais.totalFixas || 0);
      const linhaCat = (nome: string, a: { receita: number; comissao: number; atend: number }) => {
        const receita = a.receita;
        const taxaV = receita * taxa, impV = receita * imp;
        const fixoV = receitaServTotal > 0 ? fixoTotal * (receita / receitaServTotal) : 0;
        const custo = a.comissao + taxaV + impV + fixoV;
        const margem = receita - custo;
        return {
          nome, receita: r2(receita), atendimentos: a.atend,
          ticketMedio: a.atend > 0 ? r2(receita / a.atend) : 0,
          comissao: r2(a.comissao), taxaCartao: r2(taxaV), imposto: r2(impV), custoFixoRateado: r2(fixoV),
          custoTotal: r2(custo), margemReal: r2(margem),
          margemPct: receita > 0 ? r2((margem / receita) * 100) : 0,
        };
      };
      // Estética: valor MANUAL informado pelo dono (a API/CSV não separa por serviço).
      // Recorte da receita de serviço (já contada nas categorias dos barbeiros) — informativo.
      let estetica: any = null;
      try {
        const est: any = await kvGet(`viab_estetica:${mes}`);
        if (est && Number(est.receita) > 0) {
          const receita = Number(est.receita);
          const comPct = Number(est.comissaoPct || 40) / 100;
          const comissaoV = receita * comPct;
          const taxaV = receita * taxa, impV = receita * imp;
          const fixoV = receitaServTotal > 0 ? fixoTotal * (receita / receitaServTotal) : 0;
          const custo = comissaoV + taxaV + impV + fixoV;
          const margem = receita - custo;
          estetica = {
            nome: "Estética", manual: true, comissaoPct: Number(est.comissaoPct || 40),
            receita: r2(receita), comissao: r2(comissaoV), taxaCartao: r2(taxaV), imposto: r2(impV),
            custoFixoRateado: r2(fixoV), custoTotal: r2(custo), margemReal: r2(margem),
            margemPct: receita > 0 ? r2((margem / receita) * 100) : 0,
            nota: "valor informado manualmente; recorte da receita de serviço (já contada nas categorias dos barbeiros)",
          };
        }
      } catch {}

      const prodTaxa = produtosReceita * taxa, prodImp = produtosReceita * imp;
      return {
        linhas: [linhaCat("Express", acc.Express), linhaCat("Clássico", acc.Classico), linhaCat("VIP", acc.VIP)],
        estetica,
        produtos: {
          nome: "Produtos", receita: r2(produtosReceita),
          taxaCartao: r2(prodTaxa), imposto: r2(prodImp),
          margemReal: r2(produtosReceita - prodTaxa - prodImp),
          margemPct: produtosReceita > 0 ? r2(((produtosReceita - prodTaxa - prodImp) / produtosReceita) * 100) : 0,
          nota: "sem custo de mercadoria nem comissão de produto descontados",
        },
        esteticaPendente: !estetica,
        semCategoriaServico: r2(semCategoria),
        avisoFixoRateado: "custo fixo rateado por participação na receita de serviço",
      };
    } catch { return null; }
  }

  async function construirEntradasAuto(mes: string): Promise<{ entries: FinanceEntry[]; notas: string[] }> {
    const entries: FinanceEntry[] = [];
    const notas: string[] = [];

    let md: any = null;
    try { md = await getMesDataCanonical(mes, { trinksFetchAllRange, log }); } catch { md = null; }
    const transacoes: any[] = Array.isArray(md?.transacoes) ? md.transacoes : [];
    const agendamentos: any[] = Array.isArray(md?.agendamentos) ? md.agendamentos : [];
    const fonteLabel = md?.fonte === "api-trinks" ? "Trinks (ao vivo)"
      : md?.fonte === "csv-caixa" ? "CSV Caixa"
      : md?.fonte === "csv-financeiro" ? "CSV Financeiro" : "Trinks";

    // 1) Receita por dia (shape de mesService = compatível com o antigo full_sync).
    const dailyMap: Record<string, { revenue: number; count: number; pix: number; cartao: number; dinheiro: number; outros: number }> = {};
    transacoes.forEach((t: any) => {
      const raw = t.dataHora || t.dataReferencia || t.data || "";
      const date = typeof raw === "string" ? raw.split("T")[0] : "";
      if (!date || !date.startsWith(mes)) return;
      if (!dailyMap[date]) dailyMap[date] = { revenue: 0, count: 0, pix: 0, cartao: 0, dinheiro: 0, outros: 0 };
      dailyMap[date].revenue += Number(t.totalPagar || 0);
      dailyMap[date].count += 1;
      (t.formasPagamentos || []).forEach((fp: any) => {
        const nome = (fp.nome || "").toLowerCase();
        const val = Number(fp.valor || 0);
        if (nome.includes("pix")) dailyMap[date].pix += val;
        else if (/créd|cred|déb|deb|cart/.test(nome)) dailyMap[date].cartao += val;
        else if (/dinhe|espéc|espec/.test(nome)) dailyMap[date].dinheiro += val;
        else dailyMap[date].outros += val;
      });
    });
    Object.entries(dailyMap).forEach(([date, data]) => {
      const parts: string[] = [];
      if (data.pix > 0) parts.push(`Pix: R$${data.pix.toFixed(0)}`);
      if (data.cartao > 0) parts.push(`Cartão: R$${data.cartao.toFixed(0)}`);
      if (data.dinheiro > 0) parts.push(`Dinheiro: R$${data.dinheiro.toFixed(0)}`);
      if (data.outros > 0) parts.push(`Outros: R$${data.outros.toFixed(0)}`);
      entries.push({
        id: `trinks-rev-${date}`, date,
        description: `Faturamento (${data.count} transações)`,
        amount: data.revenue, category: "receita", subcategory: fonteLabel,
        recurrent: false, notes: parts.join(" | "), createdAt: date + "T23:59:59.000Z",
      });
    });

    // 2) Comissão: ranking (blindado) quando existe; senão ao vivo (agendamentos da API).
    // Usa montarEquipeDeRanking (dedup por id — mesma visão do Pagamento/v42); NÃO
    // somar getRankComissaoMap.keys (mapa de lookup, 3 chaves por prof → triplicaria).
    const equipeRank = await montarEquipeDeRanking(mes, await getAllMetas());
    if (equipeRank) {
      let totalComiss = 0;
      for (const e of equipeRank.byId.values()) totalComiss += Number(e.comissaoServicos || 0);
      if (totalComiss > 0) {
        const ultimoDia = ultimoDiaDoMes(`${mes}-01`);
        entries.push({
          id: `rank-comm-${mes}`, date: ultimoDia,
          description: "Comissões do mês (ranking)",
          amount: -totalComiss, category: "variavel", subcategory: "Comissões",
          recurrent: false, notes: "Fonte: ranking×categoria (v42) — blindado contra 429",
          createdAt: ultimoDia + "T23:59:58.000Z",
        });
      }
    } else {
      // Sem ranking → cálculo ao vivo por dia (preserva mês corrente; vazio em 429).
      const profDayCatMap: Record<string, { revenue: number; pct: number }> = {};
      agendamentos.forEach((a: any) => {
        if ((a.status?.nome || "").toLowerCase() !== "finalizado") return;
        const raw = a.dataHoraInicio || "";
        const date = typeof raw === "string" ? raw.split("T")[0] : "";
        if (!date || !date.startsWith(mes)) return;
        const profName = a.profissional?.nome || "";
        const profId = a.profissional?.id || "unknown";
        const servicoNome = a.servico?.nome
          || (Array.isArray(a.servicos) ? a.servicos.map((s: any) => s.nome).filter(Boolean).join(", ") : "") || "";
        const pct = getComissaoPctDoServico(servicoNome, profName);
        const key = `${date}_${profId}_${pct}`;
        if (!profDayCatMap[key]) profDayCatMap[key] = { revenue: 0, pct };
        profDayCatMap[key].revenue += Number(a.valor || 0);
      });
      const commissionByDay: Record<string, number> = {};
      Object.entries(profDayCatMap).forEach(([key, data]) => {
        const date = key.split("_")[0];
        const c = data.revenue * data.pct;
        if (c > 0) commissionByDay[date] = (commissionByDay[date] || 0) + c;
      });
      Object.entries(commissionByDay).forEach(([date, total]) => {
        entries.push({
          id: `trinks-comm-${date}`, date, description: "Comissões do dia",
          amount: -total, category: "variavel", subcategory: "Comissões",
          recurrent: false, createdAt: date + "T23:59:58.000Z",
        });
      });
      if (agendamentos.length === 0) {
        notas.push("Comissões: sem ranking do mês e sem dados ao vivo (Trinks indisponível) — importe o ranking do mês.");
      }
    }

    // 3) Material: só com agendamentos ao vivo (fichas técnicas). Senão omite com nota.
    if (serviceCosts.length > 0) {
      if (agendamentos.length > 0) {
        const costMap: Record<string, number> = {};
        serviceCosts.forEach(sc => {
          const total = (sc.items || []).reduce((s: number, item: any) =>
            s + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0);
          if (total > 0) costMap[sc.serviceId] = total;
        });
        if (Object.keys(costMap).length > 0) {
          const materialByDay: Record<string, { total: number; count: number }> = {};
          agendamentos.forEach((a: any) => {
            if ((a.status?.nome || "").toLowerCase() !== "finalizado") return;
            const raw = a.dataHoraInicio || "";
            const date = typeof raw === "string" ? raw.split("T")[0] : "";
            if (!date || !date.startsWith(mes)) return;
            const cost = costMap[String(a.servico?.id || "")];
            if (cost && cost > 0) {
              if (!materialByDay[date]) materialByDay[date] = { total: 0, count: 0 };
              materialByDay[date].total += cost;
              materialByDay[date].count += 1;
            }
          });
          Object.entries(materialByDay).forEach(([date, data]) => {
            entries.push({
              id: `trinks-mat-${date}`, date,
              description: `Custo de material (${data.count} serviços)`,
              amount: -data.total, category: "variavel", subcategory: "Material",
              recurrent: false, notes: "Calculado a partir das fichas técnicas de precificação",
              createdAt: date + "T23:59:57.000Z",
            });
          });
        }
      } else {
        notas.push("Custo de material: sem dados de agendamentos ao vivo (Trinks indisponível) — linha omitida.");
      }
    }

    return { entries, notas };
  }

  // Helper interno: calcula totais agregados por categoria para um mês YYYY-MM.
  // Reusado pelo endpoint /api/financeiro/totais/:mes e pelo cálculo de custo fixo/min.
  async function computeTotaisDoMes(mes: string) {
    // 1) Lançamentos manuais do mês
    const manuais = financeEntries.filter(e => e.date.startsWith(mes));

    // 2) Lançamentos auto-gerados via fonte canônica (blindado contra 429 — Etapa 1).
    const { entries: auto } = await construirEntradasAuto(mes);

    // 3) Soma por categoria. Lançamentos têm sinal: receitas positivas, despesas negativas.
    // Aqui retornamos o VALOR ABSOLUTO somado por categoria (mais útil pro custo fixo/min).
    const todos = [...manuais, ...auto];
    let totalFixas = 0, totalVariaveis = 0, totalReceitas = 0,
        totalParcelamentos = 0, totalInvestimentos = 0;

    todos.forEach(e => {
      const v = Math.abs(Number(e.amount) || 0);
      // v52: override manual fixa/variável vence a category (só pra despesas).
      const ov = (e as any).tipoDespesa;
      if (ov === "fixa") { totalFixas += v; return; }
      if (ov === "variavel") { totalVariaveis += v; return; }
      switch (e.category) {
        case "fixo": totalFixas += v; break;
        case "variavel": totalVariaveis += v; break;
        case "receita": totalReceitas += v; break;
        case "parcelamento": totalParcelamentos += v; break;
        case "investimento": totalInvestimentos += v; break;
      }
    });

    // 4) Despesas do extrato bancário categorizadas pelo sistema novo (v27).
    // Mapeia o TIPO da ExpenseCategoria pra balde contábil aqui usado.
    // - fixo, recorrente   → totalFixas (rateáveis na precificação)
    // - variavel, imposto  → totalVariaveis (variam com volume ou faturamento)
    // - investimento       → totalInvestimentos
    // - cartao, comissao, bonus, outros, insumo → ignorados aqui pra não dupla-contar
    //   (insumo já vem da ficha técnica via auto[]; comissão idem; cartão é fee
    //   indireto; outros/cartão da empresa não compõem custo operacional ratável).
    try {
      const cats: ExpenseCategoria[] = await listExpenseCategorias();
      const catMap = new Map(cats.map(c => [c.id, c]));
      // Contas de observação (InfinitePay) não entram na contabilidade.
      const contasObs = new Set(contasConsolidacao.filter(c => c.observacao).map(c => c.id));
      for (const t of transacoesBanco) {
        if (contasObs.has(t.contaId)) continue;
        if (t.amount >= 0) continue;
        if (t.incluidoNoFluxo === false) continue;
        if (t.transferenciaParId) continue;     // transferência interna não conta
        if (!t.date.startsWith(mes)) continue;
        const v = Math.abs(t.amount);
        // v52: override manual fixa/variável vence a categoria — e funciona MESMO
        // SEM categoria (é o que destrava o totalFixas do guia de fixas).
        if (t.tipoDespesa === "fixa") { totalFixas += v; continue; }
        if (t.tipoDespesa === "variavel") { totalVariaveis += v; continue; }
        if (!t.categoriaId) continue;
        const cat = catMap.get(t.categoriaId);
        if (!cat) continue;
        switch (cat.tipo) {
          case "fixo":
          case "recorrente":
            totalFixas += v; break;
          case "variavel":
          case "imposto":
            totalVariaveis += v; break;
          case "investimento":
            totalInvestimentos += v; break;
          // cartao, comissao, bonus, outros, insumo: pulados intencionalmente
        }
      }
    } catch (err: any) {
      log(`computeTotaisDoMes: erro lendo expense_categorias: ${err.message}`, "totais");
    }

    const saldo = totalReceitas - totalFixas - totalVariaveis - totalParcelamentos - totalInvestimentos;

    return {
      mes,
      totalFixas: Number(totalFixas.toFixed(2)),
      totalVariaveis: Number(totalVariaveis.toFixed(2)),
      totalReceitas: Number(totalReceitas.toFixed(2)),
      totalParcelamentos: Number(totalParcelamentos.toFixed(2)),
      totalInvestimentos: Number(totalInvestimentos.toFixed(2)),
      saldo: Number(saldo.toFixed(2)),
    };
  }

  // ─── GET /api/financeiro/totais/:mes — Totais agregados por categoria de um mês
  // mes no formato YYYY-MM (ex: 2026-04). Soma manuais + auto-gerados (Trinks).
  app.get("/api/financeiro/totais/:mes", async (req: Request, res: Response) => {
    const mes = String(req.params.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "Mês inválido. Use formato YYYY-MM" });
    }
    return res.json(await computeTotaisDoMes(mes));
  });

  // ─── v52: PATCH /api/lancamentos/despesa/:id/tipo — toggle Fixa/Variável
  // Grava o override tipoDespesa numa despesa (manual ou do extrato). null limpa.
  app.patch("/api/lancamentos/despesa/:id/tipo", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const tipo = req.body?.tipoDespesa;
      if (tipo !== "fixa" && tipo !== "variavel" && tipo !== null) {
        return res.status(400).json({ error: "tipoDespesa deve ser 'fixa', 'variavel' ou null." });
      }
      const fe = financeEntries.find(e => e.id === id);
      if (fe) {
        if (tipo === null) delete (fe as any).tipoDespesa; else fe.tipoDespesa = tipo;
        saveFinanceEntries();
        return res.json({ ok: true, origem: "manual", id, tipoDespesa: tipo });
      }
      const tx = transacoesBanco.find(t => t.id === id);
      if (tx) {
        if (tipo === null) delete tx.tipoDespesa; else tx.tipoDespesa = tipo;
        saveTransacoesBanco();
        return res.json({ ok: true, origem: "extrato", id, tipoDespesa: tipo });
      }
      return res.status(404).json({ error: "Despesa não encontrada." });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro interno." });
    }
  });

  // ─── v52: GET /api/lancamentos/saidas/:mes — saídas unificadas (manual + extrato)
  // Cada despesa com tipo EFETIVO (override tipoDespesa, senão herdado da categoria).
  app.get("/api/lancamentos/saidas/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "Mês inválido." });
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const cats = await listExpenseCategorias();
      const catMap = new Map(cats.map(c => [c.id, c]));
      const contasObs = new Set(contasConsolidacao.filter(c => c.observacao).map(c => c.id));

      // herda fixa/variável do tipo da categoria (mesma regra do computeTotaisDoMes).
      const herdado = (tipoCat?: string): "fixa" | "variavel" | null => {
        if (tipoCat === "fixo" || tipoCat === "recorrente") return "fixa";
        if (tipoCat === "variavel" || tipoCat === "imposto") return "variavel";
        return null;
      };

      const itens: any[] = [];

      // manuais (financeEntries) — só despesas (amount < 0)
      for (const e of financeEntries) {
        if (!e.date.startsWith(mes) || Number(e.amount) >= 0) continue;
        const cat = e.categoriaId ? catMap.get(e.categoriaId) : null;
        const catNome = cat?.nome || (e.category === "fixo" ? "Fixo" : e.category === "variavel" ? "Variável" : e.category);
        const herd = e.tipoDespesa ?? (cat ? herdado(cat.tipo) : (e.category === "fixo" ? "fixa" : e.category === "variavel" ? "variavel" : null));
        itens.push({
          id: e.id, origem: "manual", date: e.date, description: e.description,
          valor: r2(Math.abs(Number(e.amount))), categoria: catNome,
          tipoDespesa: e.tipoDespesa || null,
          efetivo: herd, override: !!e.tipoDespesa,
          conflito: !!e.tipoDespesa && cat ? herdado(cat.tipo) && herdado(cat.tipo) !== e.tipoDespesa : false,
        });
      }
      // extrato (transacoesBanco) — despesas, exclui observação/transferência
      for (const t of transacoesBanco) {
        if (contasObs.has(t.contaId) || Number(t.amount) >= 0) continue;
        if (t.incluidoNoFluxo === false || t.transferenciaParId) continue;
        if (!t.date.startsWith(mes)) continue;
        const cat = t.categoriaId ? catMap.get(t.categoriaId) : null;
        const herd = t.tipoDespesa ?? (cat ? herdado(cat.tipo) : null);
        itens.push({
          id: t.id, origem: "extrato", date: t.date, description: t.description,
          valor: r2(Math.abs(Number(t.amount))), categoria: cat?.nome || null,
          tipoDespesa: t.tipoDespesa || null,
          efetivo: herd, override: !!t.tipoDespesa,
          conflito: !!t.tipoDespesa && cat ? herdado(cat.tipo) && herdado(cat.tipo) !== t.tipoDespesa : false,
        });
      }
      itens.sort((a, b) => b.valor - a.valor);

      const soma = (f: (i: any) => boolean) => r2(itens.filter(f).reduce((s, i) => s + i.valor, 0));
      return res.json({
        ok: true, mes,
        itens,
        totalFixas: soma(i => i.efetivo === "fixa"),
        totalVariaveis: soma(i => i.efetivo === "variavel"),
        totalAClassificar: soma(i => !i.efetivo),
        qtdAClassificar: itens.filter(i => !i.efetivo).length,
        total: soma(() => true),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // ─── GET /api/financeiro/comissoes-debug/:mes — v24
  // Log de diferença: antes (40% global) vs depois (por categoria).
  // Usado para validar manualmente o impacto da nova regra antes/depois
  // do deploy. Não altera nada — só retorna numeros.
  app.get("/api/financeiro/comissoes-debug/:mes", (req: Request, res: Response) => {
    const mes = String(req.params.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "Mês inválido. Use formato YYYY-MM" });
    }
    const syncCache = getCached("full_sync") || loadSyncCacheFromDisk();
    if (!syncCache) {
      return res.json({ mes, ok: false, motivo: "Sem sync cache (Trinks). Sincronize primeiro." });
    }
    const agendamentos = syncCache.agendamentos || [];
    let totalRevenue = 0, totalAntes = 0, totalDepois = 0;
    let countVipExpress = 0, countPadrao = 0;
    let revenueVipExpress = 0, revenuePadrao = 0;
    const porProfissional: Record<string, { nome: string; categoria: string; pct: number; receita: number; comAntes: number; comDepois: number; atendimentos: number }> = {};

    agendamentos.forEach((a: any) => {
      const statusName = (a.status?.nome || "").toLowerCase();
      if (statusName !== "finalizado") return;
      const raw = a.dataHoraInicio || "";
      const date = typeof raw === "string" ? raw.split("T")[0] : "";
      if (!date || !date.startsWith(mes)) return;
      const valor = Number(a.valor || 0);
      if (valor <= 0) return;

      const profName = a.profissional?.nome || "Profissional";
      const profId = String(a.profissional?.id || "unknown");
      const servicoNome = a.servico?.nome
        || (Array.isArray(a.servicos) ? a.servicos.map((s: any) => s.nome).filter(Boolean).join(", ") : "")
        || "";
      const categoria = getCategoriaServico(servicoNome, profName);
      const pctDepois = getComissaoPctDoServico(servicoNome, profName);
      const pctAntes = 0.40;

      totalRevenue += valor;
      totalAntes += valor * pctAntes;
      totalDepois += valor * pctDepois;
      if (categoria === "vip_express") { countVipExpress++; revenueVipExpress += valor; }
      else { countPadrao++; revenuePadrao += valor; }

      if (!porProfissional[profId]) {
        porProfissional[profId] = { nome: profName, categoria, pct: pctDepois, receita: 0, comAntes: 0, comDepois: 0, atendimentos: 0 };
      }
      porProfissional[profId].receita += valor;
      porProfissional[profId].comAntes += valor * pctAntes;
      porProfissional[profId].comDepois += valor * pctDepois;
      porProfissional[profId].atendimentos += 1;
    });

    const profissionais = Object.values(porProfissional)
      .map(p => ({
        nome: p.nome, categoria: p.categoria,
        comissaoPct: Math.round(p.pct * 100),
        atendimentos: p.atendimentos,
        receita: Number(p.receita.toFixed(2)),
        comAntes: Number(p.comAntes.toFixed(2)),
        comDepois: Number(p.comDepois.toFixed(2)),
        delta: Number((p.comDepois - p.comAntes).toFixed(2)),
      }))
      .sort((a, b) => b.receita - a.receita);

    return res.json({
      mes,
      totalReceita: Number(totalRevenue.toFixed(2)),
      antesGlobal40: Number(totalAntes.toFixed(2)),
      depoisPorCategoria: Number(totalDepois.toFixed(2)),
      diferenca: Number((totalDepois - totalAntes).toFixed(2)),
      diferencaPct: totalAntes > 0 ? Number((((totalDepois - totalAntes) / totalAntes) * 100).toFixed(2)) : 0,
      atendimentosVipExpress: countVipExpress,
      atendimentosPadrao: countPadrao,
      receitaVipExpress: Number(revenueVipExpress.toFixed(2)),
      receitaPadrao: Number(revenuePadrao.toFixed(2)),
      porProfissional: profissionais,
    });
  });

  // ─── GET /api/config/operacional/custo-fixo-minuto/:mes — v24
  // Retorna o custo fixo por minuto de cadeira para um mês especifico,
  // combinando totalFixas do mês com cadeiras/horas/dias/ocupacao da config.
  app.get("/api/config/operacional/custo-fixo-minuto/:mes", async (req: Request, res: Response) => {
    const mes = String(req.params.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "Mês inválido. Use formato YYYY-MM" });
    }
    try {
      const cfg = await getConfigFin();
      const totais = await computeTotaisDoMes(mes);
      const result = calcularCustoFixoPorMinuto(mes, totais.totalFixas, {
        cadeiras: cfg.cadeiras,
        horasDia: cfg.horasDia,
        diasMes: cfg.diasMes,
        ocupacaoPct: cfg.ocupacaoPct,
      });
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/precificacao/contexto/:mes — v24
  // Pacote de contexto que a tela Precificação consome de uma vez:
  //   - parametros operacionais (cadeiras/horas/dias/ocupacao)
  //   - totalFixas do mês
  //   - custoFixoPorMinuto já calculado
  app.get("/api/precificacao/contexto/:mes", async (req: Request, res: Response) => {
    const mes = String(req.params.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "Mês inválido. Use formato YYYY-MM" });
    }
    try {
      const cfg = await getConfigFin();
      const totais = await computeTotaisDoMes(mes);
      const cfm = calcularCustoFixoPorMinuto(mes, totais.totalFixas, {
        cadeiras: cfg.cadeiras,
        horasDia: cfg.horasDia,
        diasMes: cfg.diasMes,
        ocupacaoPct: cfg.ocupacaoPct,
      });
      // v74: custo fixo POR ATENDIMENTO = média das fixas ÷ média de atendimentos
      // dos MESES FECHADOS (decisão do dono — "fechamento mensal", estável).
      const cfaMedio = await custoFixoAtendimentoMedio(mes);
      const custoFixoPorAtendimento = cfaMedio.custoFixoPorAtendimento;
      const mediaAtd = { media: cfaMedio.mediaAtendimentos, meses: cfaMedio.meses };

      // Parte 1: ocupação REAL estimada (pra comparar com o chute manual).
      // minutos usados ÷ minutos disponíveis. Usa duração real da agenda quando
      // houver; senão comandas × 50min (média assumida, igual grecometas).
      let comandas = 0, ocupacaoRealEstimada = 0, baseOcupacao = "sem dados";
      try {
        const md: any = await getMesDataCanonical(mes, { trinksFetchAllRange, log });
        comandas = Number(md?.comandas || 0);
        const ags: any[] = Array.isArray(md?.agendamentos) ? md.agendamentos : [];
        const finalizados = ags.filter(a => (a.status?.nome || "").toLowerCase() === "finalizado");
        const durOf = (a: any) => Number(a.duracaoEmMinutos || a.duracao || a.servico?.duracao || 0) || 0;
        const temDuracao = finalizados.some(a => durOf(a) > 0);
        const AVG_DUR = 50;
        const minutosDisponiveis = cfg.cadeiras * cfg.horasDia * 60 * cfg.diasMes;
        let minutosUsados = 0;
        if (temDuracao) {
          minutosUsados = finalizados.reduce((s, a) => s + durOf(a), 0);
          baseOcupacao = "agenda real";
        } else if (comandas > 0) {
          minutosUsados = comandas * AVG_DUR;
          baseOcupacao = `estimada (${comandas} comandas × ${AVG_DUR}min)`;
        }
        ocupacaoRealEstimada = minutosDisponiveis > 0 ? Math.round((minutosUsados / minutosDisponiveis) * 1000) / 10 : 0;
      } catch { /* sem dados → mantém 0 */ }

      // Parte 2: quantos lançamentos compõem o totalFixas (pra denunciar fixas
      // incompletas). Conta extrato (categoria tipo fixo/recorrente, exclui
      // observação) + lançamentos manuais 'fixo' do mês.
      let qtdLancamentosFixos = 0;
      try {
        const cats = await listExpenseCategorias();
        const catMap = new Map(cats.map(c => [c.id, c]));
        const contasObs = new Set(contasConsolidacao.filter(c => c.observacao).map(c => c.id));
        for (const t of transacoesBanco) {
          if (contasObs.has(t.contaId)) continue;
          if (t.amount >= 0 || t.incluidoNoFluxo === false || t.transferenciaParId) continue;
          if (!t.date.startsWith(mes) || !t.categoriaId) continue;
          const cat = catMap.get(t.categoriaId);
          if (cat && (cat.tipo === "fixo" || cat.tipo === "recorrente")) qtdLancamentosFixos++;
        }
        qtdLancamentosFixos += financeEntries.filter(e => e.date.startsWith(mes) && e.category === "fixo").length;
      } catch { /* ignora */ }

      return res.json({
        ok: true,
        mes,
        operacional: {
          cadeiras: cfg.cadeiras,
          horasDia: cfg.horasDia,
          diasMes: cfg.diasMes,
          ocupacaoPct: cfg.ocupacaoPct,
        },
        totalFixas: totais.totalFixas,
        minutosProdutivosMes: cfm.minutosProdutivosMes,
        custoFixoPorMinuto: cfm.custoFixoPorMinuto,
        custoFixoPorAtendimento,                 // v70/v74
        mediaAtendimentos: mediaAtd.media,       // v70
        mesesMediaAtendimentos: mediaAtd.meses,  // v70
        mediaFixas: cfaMedio.mediaFixas,         // v74 (média das fixas dos meses fechados)
        comandas,
        ocupacaoRealEstimada,
        baseOcupacao,
        qtdLancamentosFixos,
        taxaCartaoPct: cfg.taxaCartaoPct,  // v56
        impostoPct: cfg.impostoPct,        // v56
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/viabilidade/:mes — Motor de Viabilidade Fase A (margem real ao vivo)
  // Junta as fontes que já fluem pro sistema (NÃO duplica): receita (mesService),
  // variável (comissão v42 + taxa cartão + material das fichas + variável do extrato),
  // fixo (computeTotaisDoMes). Cascata receita → margem contribuição → resultado.
  // + Guia de fixas: transações do Itaú que parecem fixas e ainda não foram
  // categorizadas, pra destravar o totalFixas (hoje furado).
  app.get("/api/viabilidade/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "Mês inválido. Use YYYY-MM." });
      const r2 = (n: number) => Math.round(n * 100) / 100;

      const md: any = await getMesDataCanonical(mes, { trinksFetchAllRange, log });
      const { entries, notas } = await construirEntradasAuto(mes);
      const totais = await computeTotaisDoMes(mes);
      const cfg = await getConfigFin();

      const receita = Number(md?.faturamento || 0);
      const b = md?.breakdown || {};
      // Componentes da variável (detalhe pra cascata) — reusam construirEntradasAuto.
      const comissao = entries.filter(e => e.subcategory === "Comissões").reduce((s, e) => s + Math.abs(Number(e.amount || 0)), 0);
      const material = entries.filter(e => e.subcategory === "Material").reduce((s, e) => s + Math.abs(Number(e.amount || 0)), 0);
      const taxaCartao = ((Number(b.cartaoCredito || 0) + Number(b.cartaoDebito || 0)) * Number(cfg.taxaCartaoPct || 0)) / 100;
      // O que sobra de totalVariaveis (que já inclui comissão+material) é o extrato variável/imposto.
      const variavelExtrato = Math.max(0, Number(totais.totalVariaveis || 0) - comissao - material);
      const variavelTotal = comissao + material + taxaCartao + variavelExtrato;

      const margemContribuicao = receita - variavelTotal;
      const fixo = Number(totais.totalFixas || 0);
      const resultado = margemContribuicao - fixo;
      const margemRealPct = receita > 0 ? (resultado / receita) * 100 : 0;

      // ── Guia de fixas: transações do Itaú que parecem fixas e estão sem categoria ──
      const cats = await listExpenseCategorias();
      const catMap = new Map(cats.map(c => [c.id, c]));
      const contasObs = new Set(contasConsolidacao.filter(c => c.observacao).map(c => c.id));
      const KW_FIXA = /aluguel|energia|enel|cemig|equatorial|luz|[aá]gua|saneago|internet|vivo|claro|tim|oi |contador|honor[aá]rio|cont[aá]bil|sistema|software|trinks|seguro|iptu|condom[ií]nio|sal[aá]rio|pr[oó].?labore/i;
      const candidatasFixas: Array<{ id: string; date: string; description: string; valor: number }> = [];
      for (const t of transacoesBanco) {
        if (contasObs.has(t.contaId)) continue;
        if (t.amount >= 0 || t.incluidoNoFluxo === false || t.transferenciaParId) continue;
        if (!t.date.startsWith(mes)) continue;
        const cat = t.categoriaId ? catMap.get(t.categoriaId) : null;
        const semCatOuOutros = !cat || cat.tipo === "outros";
        if (semCatOuOutros && KW_FIXA.test(t.description || "")) {
          candidatasFixas.push({ id: t.id, date: t.date, description: t.description, valor: r2(Math.abs(t.amount)) });
        }
      }
      candidatasFixas.sort((a, b2) => b2.valor - a.valor);

      // Checklist do que toda barbearia costuma ter como fixa — marca o que já tem
      // lançamento categorizado como fixo/recorrente no mês (por keyword na descrição).
      const fixasCategorizadas = transacoesBanco.filter(t => {
        if (contasObs.has(t.contaId) || t.amount >= 0 || t.incluidoNoFluxo === false) return false;
        if (!t.date.startsWith(mes) || !t.categoriaId) return false;
        const c = catMap.get(t.categoriaId);
        return c && (c.tipo === "fixo" || c.tipo === "recorrente");
      });
      const temKw = (re: RegExp) => fixasCategorizadas.some(t => re.test(t.description || ""));
      const checklist = [
        { item: "Aluguel", ok: temKw(/aluguel|condom[ií]nio|iptu/i) },
        { item: "Energia", ok: temKw(/energia|enel|cemig|equatorial|luz/i) },
        { item: "Água", ok: temKw(/[aá]gua|saneago/i) },
        { item: "Internet/Telefone", ok: temKw(/internet|vivo|claro|tim|oi /i) },
        { item: "Contador", ok: temKw(/contador|honor[aá]rio|cont[aá]bil/i) },
        { item: "Sistemas/Software", ok: temKw(/sistema|software|trinks/i) },
        { item: "Salários/Pró-labore", ok: temKw(/sal[aá]rio|pr[oó].?labore|folha/i) },
      ];
      // Implausível: fixas < 5% da receita (heurística do prompt).
      const fixasImplausivel = receita > 0 && fixo < receita * 0.05;

      return res.json({
        ok: true, mes,
        receita: r2(receita),
        fonteReceita: md?.fonte || null,
        variavel: {
          total: r2(variavelTotal),
          comissao: r2(comissao),
          taxaCartao: r2(taxaCartao),
          material: r2(material),
          outrosExtrato: r2(variavelExtrato),
        },
        margemContribuicao: r2(margemContribuicao),
        fixo: r2(fixo),
        resultado: r2(resultado),
        margemRealPct: r2(margemRealPct),
        guiaFixas: {
          implausivel: fixasImplausivel,
          totalFixasAtual: r2(fixo),
          candidatas: candidatasFixas.slice(0, 30),
          checklist,
        },
        avisos: notas,
        categorias: await calcularCategoriasMargem(mes),  // A2
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // POST /api/viabilidade/estetica/:mes — valor manual da estética do mês (a API/CSV
  // não separa por serviço). body: { receita, comissaoPct }. receita=0/null limpa.
  app.post("/api/viabilidade/estetica/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "Mês inválido." });
      const receita = Number(req.body?.receita || 0);
      const comissaoPct = Math.max(0, Math.min(100, Number(req.body?.comissaoPct ?? 40)));
      if (!receita || receita <= 0) {
        await kvSet(`viab_estetica:${mes}`, null);
        return res.json({ ok: true, limpo: true });
      }
      const reg = { receita: Math.round(receita * 100) / 100, comissaoPct, salvoEm: new Date().toISOString() };
      await kvSet(`viab_estetica:${mes}`, reg);
      return res.json({ ok: true, estetica: reg });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // POST /api/viabilidade/estetica-auto/:mes — calcula a estética pela AGENDA da
  // Trinks (1 sync paginado do mês, guarda o resultado). Classifica serviços de
  // estética pelo nome (barboterapia, spa, sobrancelha, pigmentação, limpeza,
  // hidratação, massagem, depilação…). Soma o valor dos NÃO-cancelados e grava em
  // viab_estetica:mes (mesmo registro do manual). Econômico: roda 1x por mês.
  app.post("/api/viabilidade/estetica-auto/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "Mês inválido." });
      const [ano, m] = mes.split("-").map(Number);
      const ini = `${mes}-01`;
      const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10); // último dia do mês
      // keywords de estética desta barbearia (validadas com a agenda real)
      const EST_RE = /barboterap|spa|sobrancelh|pigment|limpez|hidrat|massag|pestan|depilac|peeling|micropigment|design|p[eé]s\b/i;
      let ags: any[] = [];
      try {
        ags = await trinksFetchAll("agendamentos", { dataInicio: ini, dataFim: fim });
      } catch (e: any) {
        if (e?.status === 429 || /limit|429/i.test(e?.message || "")) {
          return res.status(503).json({ ok: false, error: "Trinks recusou (429) agora. Tente daqui a pouco." });
        }
        throw e;
      }
      const porServ: Record<string, { qtd: number; valor: number; estetica: boolean }> = {};
      let totalEstetica = 0, qtdEstetica = 0;
      for (const a of ags) {
        const st = (a?.status?.nome || "").toLowerCase();
        if (st.includes("cancel")) continue; // ignora cancelados
        const nome = a?.servico?.nome || "—";
        const valor = Number(a?.valor || 0);
        const ehEst = EST_RE.test(nome);
        if (!porServ[nome]) porServ[nome] = { qtd: 0, valor: 0, estetica: ehEst };
        porServ[nome].qtd++;
        porServ[nome].valor += valor;
        if (ehEst) { totalEstetica += valor; qtdEstetica++; }
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const listaEstetica = Object.entries(porServ).filter(([, v]) => v.estetica)
        .map(([nome, v]) => ({ nome, qtd: v.qtd, valor: r2(v.valor) })).sort((a, b) => b.valor - a.valor);
      const outros = Object.entries(porServ).filter(([, v]) => !v.estetica)
        .map(([nome, v]) => ({ nome, qtd: v.qtd, valor: r2(v.valor) })).sort((a, b) => b.valor - a.valor);

      if (totalEstetica <= 0) {
        return res.json({ ok: true, mes, totalEstetica: 0, qtdEstetica: 0, listaEstetica, outros, totalAgendamentos: ags.length, avisoVazio: true });
      }
      const reg = {
        receita: r2(totalEstetica), comissaoPct: 35, auto: true,
        qtdAtendimentos: qtdEstetica, servicos: listaEstetica,
        salvoEm: new Date().toISOString(),
      };
      await kvSet(`viab_estetica:${mes}`, reg);
      return res.json({ ok: true, mes, totalEstetica: r2(totalEstetica), qtdEstetica, listaEstetica, outros: outros.slice(0, 20), totalAgendamentos: ags.length, estetica: reg });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // GET /api/historico/mensal — evolução mês a mês (clientes + barbeiros) a partir
  // do CAIXA (receita/comandas/clientes) + RANKING (barbeiros). Local, sem API.
  // Clientes novos = primeira aparição no histórico disponível.
  // v76: painel executivo — HOJE (API ao vivo + fallback CSV) / SEMANA / MÊS dia a dia.
  // Metas: diária (metaDiaria), semana = diária×5 (ter–sáb, 5 dias úteis), mês = metasHistorico ou 100k.
  // Por categoria: proporção histórica (serv 79% / planos 15% / produtos 6%).
  app.get("/api/dashboard/painel", async (_req: Request, res: Response) => {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const hoje = ymdHoje();
      const mes = hoje.slice(0, 7);
      const metaDia = metaDiaria;
      const metaSemana = metaDiaria * 5; // ter–sáb = 5 dias úteis
      const metaMes = (metasHistorico.find(m => m.month === mes)?.target) || 100000;
      const PROP = { serv: 0.79, plano: 0.15, prod: 0.06 };

      // ── MÊS (caixa CSV do mês corrente, dia a dia) ──
      const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
      const rows = (Array.isArray(caixa?.rows) ? caixa.rows : []).filter((r: any) => !String(r.tipo || "").toLowerCase().includes("estorno"));
      const porDiaMap: Record<string, number> = {};
      let mesServ = 0, mesProd = 0, mesPlano = 0, mesTotal = 0;
      for (const r of rows) {
        const dia = String(r.data || "").slice(0, 10);
        if (!dia) continue;
        porDiaMap[dia] = (porDiaMap[dia] || 0) + Number(r.totalGeral || 0);
        mesServ += Number(r.totalServico || 0);
        mesProd += Number(r.totalProdutos || 0);
        mesPlano += Number(r.totalPacotes || 0);
        mesTotal += Number(r.totalGeral || 0);
      }
      const porDia = Object.entries(porDiaMap).map(([dia, valor]) => ({ dia, valor: r2(valor) })).sort((a, b) => a.dia.localeCompare(b.dia));
      const melhorDia = porDia.reduce((a: any, b: any) => (b.valor > (a?.valor || 0) ? b : a), null as any);
      const ultimoDiaCaixa = porDia.length ? porDia[porDia.length - 1].dia : null;
      // receita OFICIAL do mês (Total Mês do email) — corrige o caixa parcial
      const tmMes: any = await kvGet(`trinks_total_mes:${mes}`);
      const mesOficial = Number(tmMes?.total || 0);
      const mesRealizado = mesOficial > 0 ? mesOficial : mesTotal;

      // ── SEMANA (terça→sábado, ancorada na terça; acumula dia a dia) ──
      // A barbearia opera terça a sábado; a semana de trabalho começa SEMPRE na
      // terça. Dom/seg (fechado) mostram a semana que terminou no sábado. Os dias
      // futuros da semana ainda não têm caixa → somam 0 e vão entrando dia a dia.
      const dowHojePainel = new Date(`${hoje}T12:00:00-03:00`).getUTCDay(); // 0=dom…6=sáb
      const diasDesdeTerca = (dowHojePainel + 5) % 7; // ter→0 qua→1 … sáb→4 dom→5 seg→6
      const inicioSemana = ymdAddDays(hoje, -diasDesdeTerca);
      const fimSemana = ymdAddDays(inicioSemana, 4); // terça + 4 = sábado
      let semServ = 0, semProd = 0, semPlano = 0, semTotal = 0;
      for (const r of rows) {
        const dia = String(r.data || "").slice(0, 10);
        if (dia >= inicioSemana && dia <= fimSemana) {
          semServ += Number(r.totalServico || 0); semProd += Number(r.totalProdutos || 0);
          semPlano += Number(r.totalPacotes || 0); semTotal += Number(r.totalGeral || 0);
        }
      }

      // ── HOJE (v78: SÓ CSV — rápido, sem tocar a API). O "ao vivo" vem do
      // endpoint separado /api/dashboard/hoje (assíncrono, não trava a tela). ──
      let hojeRealizado = 0, hojeAtend = 0, hojeFonte: "csv" | "ultimo" = "csv", hojeDataRef = hoje;
      const rowsHoje = rows.filter((r: any) => String(r.data || "").slice(0, 10) === hoje);
      let precisaAoVivo = false;
      if (rowsHoje.length > 0) {
        hojeRealizado = rowsHoje.reduce((s: number, r: any) => s + Number(r.totalGeral || 0), 0);
        hojeAtend = rowsHoje.length; hojeFonte = "csv";
      } else if (ultimoDiaCaixa) {
        // sem caixa de hoje → mostra o último dia fechado e sinaliza buscar ao vivo
        hojeRealizado = porDiaMap[ultimoDiaCaixa] || 0;
        hojeAtend = rows.filter((r: any) => String(r.data || "").slice(0, 10) === ultimoDiaCaixa).length;
        hojeFonte = "ultimo"; hojeDataRef = ultimoDiaCaixa; precisaAoVivo = true;
      }

      return res.json({
        ok: true,
        hoje: {
          data: hojeDataRef, ehHoje: hojeDataRef === hoje, fonte: hojeFonte, precisaAoVivo,
          meta: metaDia, realizado: r2(hojeRealizado), atendimentos: hojeAtend,
          pct: metaDia > 0 ? Math.round((hojeRealizado / metaDia) * 100) : 0,
        },
        semana: {
          inicio: inicioSemana, fim: fimSemana, meta: metaSemana, realizado: r2(semTotal),
          pct: metaSemana > 0 ? Math.round((semTotal / metaSemana) * 100) : 0,
          servicos: r2(semServ), planos: r2(semPlano), produtos: r2(semProd),
          metaServicos: r2(metaSemana * PROP.serv), metaPlanos: r2(metaSemana * PROP.plano), metaProdutos: r2(metaSemana * PROP.prod),
        },
        mes: {
          mes, meta: metaMes, realizado: r2(mesRealizado),
          realizadoCaixa: r2(mesTotal), oficial: r2(mesOficial),
          pct: metaMes > 0 ? Math.round((mesRealizado / metaMes) * 100) : 0,
          servicos: r2(mesServ), planos: r2(mesPlano), produtos: r2(mesProd),
          porDia, melhorDia, ultimoDia: ultimoDiaCaixa,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // v88: GET /api/dashboard/consultar?dia= OU ?semanaFim= — busca o fechamento de
  // um dia específico ou a soma de uma semana (7 dias até a data), via snapshots.
  app.get("/api/dashboard/consultar", async (req: Request, res: Response) => {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const dia = String(req.query.dia || "");
      const semanaFim = String(req.query.semanaFim || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
        const s: any = await getSnapshot(dia);
        return res.json({
          ok: true, tipo: "dia", data: dia, encontrado: !!s,
          realizado: r2(Number(s?.faturamento?.total || 0)),
          atendimentos: Number(s?.faturamento?.qtdTransacoes || s?.agendamentos?.finalizados || 0),
          fonte: s?.fonte || null,
        });
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(semanaFim)) {
        // Semana ancorada na TERÇA (barbearia opera ter–sáb). A data recebida é
        // "qualquer dia da semana alvo" → cai pra terça daquela semana.
        const dowRef = new Date(`${semanaFim}T12:00:00-03:00`).getUTCDay(); // 0=dom…6=sáb
        const diasDesdeTerca = (dowRef + 5) % 7; // ter→0 qua→1 … sáb→4 dom→5 seg→6
        const inicio = ymdAddDays(semanaFim, -diasDesdeTerca);
        const fim = ymdAddDays(inicio, 4); // terça + 4 = sábado
        let total = 0; const dias: any[] = [];
        for (let i = 0; i < 5; i++) { // ter…sáb = 5 dias
          const dt = ymdAddDays(inicio, i);
          const s: any = await getSnapshot(dt);
          const v = Number(s?.faturamento?.total || 0);
          total += v;
          dias.push({ dia: dt, valor: r2(v) });
        }
        const metaSemana = metaDiaria * 5;
        return res.json({ ok: true, tipo: "semana", inicio, fim, realizado: r2(total), meta: metaSemana, pct: metaSemana > 0 ? Math.round((total / metaSemana) * 100) : 0, dias });
      }
      return res.status(400).json({ ok: false, error: "Informe ?dia=YYYY-MM-DD ou ?semanaFim=YYYY-MM-DD" });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // v79: HOJE = ÚLTIMO DIA FECHADO via SNAPSHOT (cron noturno). Lê do kv
  // (snapshot_dia), 0 token, instantâneo. O fechamento das 23:50 alimenta isso;
  // de manhã o dono trabalha com o fechamento do dia anterior. Sem tocar a API.
  app.get("/api/dashboard/hoje", async (_req: Request, res: Response) => {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const hoje = ymdHoje();
      const metaDia = metaDiaria;
      // pega o snapshot mais recente COM faturamento (hoje, ontem, ou último do mês)
      const candidatos = [hoje, ymdAddDays(hoje, -1)];
      let snap: any = null;
      for (const dt of candidatos) {
        const s: any = await getSnapshot(dt);
        if (s && Number(s?.faturamento?.total) > 0) { snap = s; break; }
      }
      if (!snap) {
        const doMes = await listSnapshotsDoMes(hoje.slice(0, 7));
        snap = doMes.filter((s: any) => Number(s?.faturamento?.total) > 0).sort((a: any, b: any) => b.data.localeCompare(a.data))[0] || null;
      }
      if (!snap) {
        return res.json({ ok: true, fonte: "vazio", data: null, meta: metaDia, realizado: 0, atendimentos: 0, pct: 0 });
      }
      const realizado = Number(snap.faturamento.total || 0);
      const atend = Number(snap.faturamento.qtdTransacoes || snap.agendamentos?.finalizados || 0);
      return res.json({
        ok: true, data: snap.data, ehHoje: snap.data === hoje, fonte: "snapshot",
        capturadoEm: snap.capturadoEm || null, fonteSnapshot: snap.fonte,
        meta: metaDia, realizado: r2(realizado), atendimentos: atend,
        pct: metaDia > 0 ? Math.round((realizado / metaDia) * 100) : 0,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // v80: aviso de atualização de CSVs — quão atual está o caixa do mês + o que falta.
  app.get("/api/dashboard/avisos-csv", async (_req: Request, res: Response) => {
    try {
      const hoje = ymdHoje();
      const mes = hoje.slice(0, 7);
      const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
      const rows = Array.isArray(caixa?.rows) ? caixa.rows : [];
      let ultimo: string | null = null;
      for (const r of rows) {
        const d = String(r.data || "").slice(0, 10);
        if (d && (!ultimo || d > ultimo)) ultimo = d;
      }
      const diasDesde = ultimo
        ? Math.round((new Date(hoje + "T12:00:00Z").getTime() - new Date(ultimo + "T12:00:00Z").getTime()) / 86400000)
        : null;
      const labels: Record<string, string> = { caixa: "Caixa", financeiro: "Financeiro", ranking: "Ranking" };
      const faltando: string[] = [];
      for (const t of ["caixa", "financeiro", "ranking"]) {
        const x: any = await kvGet(trinksImport.kvKeyFor(t, mes));
        const tem = t === "ranking" ? !!x?.periodos?.[0]?.profissionais?.length : !!(Array.isArray(x?.rows) && x.rows.length);
        if (!tem) faltando.push(labels[t]);
      }
      const desatualizado = (diasDesde == null) || diasDesde >= 2 || faltando.length > 0;
      return res.json({ ok: true, mes, ultimoCaixaData: ultimo, diasDesde, faltando, desatualizado });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  app.get("/api/historico/mensal", async (_req: Request, res: Response) => {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const meses: any[] = [];
      for (let m = 1; m <= 12; m++) {
        const mes = `2026-${String(m).padStart(2, "0")}`;
        const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
        if (!Array.isArray(caixa?.rows) || caixa.rows.length === 0) continue;
        const rows = caixa.rows.filter((r: any) => !String(r.tipo || "").toLowerCase().includes("estorno"));
        let receita = 0, servico = 0, produto = 0, pacote = 0;
        const clientes = new Set<string>();
        for (const r of rows) {
          receita += Number(r.totalGeral || 0);
          servico += Number(r.totalServico || 0);
          produto += Number(r.totalProdutos || 0);
          pacote += Number(r.totalPacotes || 0);
          const cid = String(r.clienteId || "").trim();
          if (cid) clientes.add(cid);
        }
        // barbeiros do ranking (se houver)
        const ranking: any = await kvGet(trinksImport.kvKeyFor("ranking", mes));
        const profs = ranking?.periodos?.[0]?.profissionais;
        let barbeiros: any = null;
        if (Array.isArray(profs)) {
          barbeiros = profs.map((p: any) => {
            const serv = Number(p.totalServicos || 0);
            return {
              nome: String(p.profissional || "").trim(),
              atendimentos: Number(p.qtdAtendimentos || 0),
              servicos: r2(serv),
              produtos: r2(Number(p.totalProdutos || 0)),
              comissao: r2(comissaoServicosRanking(p.profissional, serv).comissao),
            };
          }).filter((b: any) => b.servicos > 0 || b.produtos > 0).sort((a: any, b: any) => b.servicos - a.servicos);
        }
        // receita OFICIAL do mês (Total Mês do email Trinks) — bate com a Trinks.
        // Usa o oficial quando existe (corrige mês parcial no caixa); senão o caixa.
        const tm: any = await kvGet(`trinks_total_mes:${mes}`);
        const receitaOficial = Number(tm?.total || 0);
        meses.push({
          mes,
          receita: r2(receitaOficial > 0 ? receitaOficial : receita), // oficial quando disponível
          receitaCaixa: r2(receita),
          receitaOficial: r2(receitaOficial),
          servico: r2(servico), produto: r2(produto), pacote: r2(pacote),
          comandas: rows.length, clientesUnicos: clientes.size,
          ticketMedio: rows.length ? r2(receita / rows.length) : 0,
          temRanking: !!barbeiros, barbeiros,
          _clientes: Array.from(clientes),
        });
      }
      // clientes novos vs recorrentes (primeira aparição no histórico)
      const vistos = new Set<string>();
      for (const mm of meses) {
        let novos = 0;
        for (const c of mm._clientes) { if (!vistos.has(c)) { novos++; vistos.add(c); } }
        mm.clientesNovos = novos;
        mm.clientesRecorrentes = mm.clientesUnicos - novos;
        delete mm._clientes;
      }
      return res.json({ ok: true, meses });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // v86: GET /api/ocupacao — taxa de ocupação por mês. Capacidade = nº barbeiros
  // × horas abertas (ter–sex 11h, sáb 10h; fecha dom/seg). Ocupado = atendimentos
  // × duração média. Defaults configuráveis por query (barbeiros, duracaoMin).
  app.get("/api/ocupacao", async (req: Request, res: Response) => {
    try {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const nBarbeiros = Number(req.query.barbeiros) || 7;
      const durMin = Number(req.query.duracaoMin) || 50;
      // horas abertas por dia da semana (0=dom … 6=sáb)
      const horasDOW: Record<number, number> = { 0: 0, 1: 0, 2: 11, 3: 11, 4: 11, 5: 11, 6: 10 };
      const meses: any[] = [];
      for (let m = 1; m <= 12; m++) {
        const mes = `2026-${String(m).padStart(2, "0")}`;
        const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
        if (!Array.isArray(caixa?.rows) || caixa.rows.length === 0) continue;
        const atendimentos = caixa.rows.filter((r: any) => !String(r.tipo || "").toLowerCase().includes("estorno")).length;
        // dias do mês: último dia de atendimento no caixa (pra não contar dias futuros num mês parcial)
        const datasCaixa = caixa.rows.map((r: any) => (r.data || "").slice(0, 10)).filter(Boolean).sort();
        const ultimoDia = datasCaixa.length ? Number(datasCaixa[datasCaixa.length - 1].slice(8, 10)) : new Date(2026, m, 0).getDate();
        let horasAbertas = 0;
        for (let d = 1; d <= ultimoDia; d++) {
          const dow = new Date(Date.UTC(2026, m - 1, d)).getUTCDay();
          horasAbertas += horasDOW[dow] || 0;
        }
        const capacidadeH = nBarbeiros * horasAbertas;
        const ocupadoH = atendimentos * (durMin / 60);
        meses.push({
          mes, atendimentos, horasAbertas, capacidadeH: r2(capacidadeH), ocupadoH: r2(ocupadoH),
          ocupacaoPct: capacidadeH > 0 ? r2((ocupadoH / capacidadeH) * 100) : 0,
          ultimoDia,
        });
      }
      return res.json({ ok: true, nBarbeiros, duracaoMin: durMin, meses });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // GET /api/clientes/retencao — análise de retenção/churn a partir dos Caixas
  // (cada comanda tem clienteId+data). Responde: ativos/novos/retornaram/perdidos
  // por mês + distribuição de frequência + fiéis + inativos (gargalo).
  app.get("/api/clientes/retencao", async (_req: Request, res: Response) => {
    try {
      const mesesDisp: string[] = [];
      const porCliente = new Map<string, { nome: string; meses: Set<string>; visitas: number; valorTotal: number; ultimaData: string }>();
      for (let m = 1; m <= 12; m++) {
        const mes = `2026-${String(m).padStart(2, "0")}`;
        const caixa: any = await kvGet(trinksImport.kvKeyFor("caixa", mes));
        if (!Array.isArray(caixa?.rows) || caixa.rows.length === 0) continue;
        mesesDisp.push(mes);
        for (const r of caixa.rows) {
          if (String(r.tipo || "").toLowerCase().includes("estorno")) continue;
          const id = String(r.clienteId || "").trim();
          if (!id) continue; // walk-in sem cadastro não entra na retenção
          let c = porCliente.get(id);
          if (!c) { c = { nome: String(r.clienteNome || "").trim(), meses: new Set(), visitas: 0, valorTotal: 0, ultimaData: "" }; porCliente.set(id, c); }
          c.meses.add(mes); c.visitas++;
          c.valorTotal += Number(r.totalGeral || 0);
          const dt = (r.data || "").slice(0, 10);
          if (dt > c.ultimaData) c.ultimaData = dt;
          if (!c.nome && r.clienteNome) c.nome = String(r.clienteNome).trim();
        }
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const ultimoMes = mesesDisp[mesesDisp.length - 1] || "";
      const idxMes = (mes: string) => mesesDisp.indexOf(mes);

      const ativosPorMes = new Map<string, Set<string>>();
      for (const mes of mesesDisp) ativosPorMes.set(mes, new Set());
      for (const [id, c] of porCliente) for (const mes of c.meses) ativosPorMes.get(mes)!.add(id);

      const primeiroMesDe = new Map<string, string>();
      for (const [id, c] of porCliente) {
        let pm = "9999"; for (const mes of c.meses) if (mes < pm) pm = mes;
        primeiroMesDe.set(id, pm);
      }

      const meses = mesesDisp.map((mes, i) => {
        const ativos = ativosPorMes.get(mes)!;
        let novos = 0, retornaram = 0;
        for (const id of ativos) (primeiroMesDe.get(id) === mes ? novos++ : retornaram++);
        let perdidos = 0;
        if (i > 0) {
          const ant = ativosPorMes.get(mesesDisp[i - 1])!;
          for (const id of ant) if (!ativos.has(id)) perdidos++;
        }
        return { mes, ativos: ativos.size, novos, retornaram, perdidos, taxaRetorno: ativos.size > 0 ? r2((retornaram / ativos.size) * 100) : 0 };
      });

      let umaVez = 0, duasTres = 0, quatroMais = 0;
      const mesesDistrib = { "1": 0, "2": 0, "3": 0, "4+": 0 } as Record<string, number>;
      for (const [, c] of porCliente) {
        const nm = c.meses.size;
        if (nm === 1) mesesDistrib["1"]++; else if (nm === 2) mesesDistrib["2"]++;
        else if (nm === 3) mesesDistrib["3"]++; else mesesDistrib["4+"]++;
        if (c.visitas === 1) umaVez++; else if (c.visitas <= 3) duasTres++; else quatroMais++;
      }
      const totalClientes = porCliente.size;
      const fieis = mesesDistrib["4+"];
      const ultIdx = mesesDisp.length - 1;
      let inativos = 0;
      const listaInativos: any[] = [];
      for (const [, c] of porCliente) {
        let um = ""; for (const mes of c.meses) if (mes > um) um = mes;
        if (ultIdx - idxMes(um) >= 2) {
          inativos++;
          // só quem veio 2+ vezes (cliente de verdade que sumiu, vale reativar)
          if (c.visitas >= 2) listaInativos.push({
            nome: c.nome || "(sem nome)", visitas: c.visitas, valorTotal: r2(c.valorTotal),
            ultimaVisita: c.ultimaData, mesesSemVir: ultIdx - idxMes(um),
          });
        }
      }
      // prioridade de reativação: quem mais gastou primeiro
      listaInativos.sort((a, b) => b.valorTotal - a.valorTotal);

      return res.json({
        ok: true, mesesDisponiveis: mesesDisp, ultimoMes, totalClientes, meses,
        frequencia: { umaVisita: umaVez, duasATres: duasTres, quatroMais, pctUmaVisita: totalClientes ? r2((umaVez / totalClientes) * 100) : 0 },
        recorrenciaMeses: mesesDistrib,
        fieis, pctFieis: totalClientes ? r2((fieis / totalClientes) * 100) : 0,
        inativos, pctInativos: totalClientes ? r2((inativos / totalClientes) * 100) : 0,
        listaInativos: listaInativos.slice(0, 100), // top 100 mais valiosos pra reativar
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  // ─── POST /api/precificacao/calcular — v24
  // Recebe lista de servicos e retorna calculo expandido para cada um.
  // Body: { mes: "YYYY-MM", servicos: [{ id, nome, categoria, preco, duracao }, ...] }
  // Output: { contexto, servicos: [{ ...input, fichaTecnica, comissaoPct, margemDesejadaPct, calculo }] }
  app.post("/api/precificacao/calcular", async (req: Request, res: Response) => {
    try {
      const mes = String(req.body?.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: "Mês inválido. Use formato YYYY-MM" });
      }
      const servicos = Array.isArray(req.body?.servicos) ? req.body.servicos : [];
      const cfg = await getConfigFin();
      const totais = await computeTotaisDoMes(mes);
      const cfm = calcularCustoFixoPorMinuto(mes, totais.totalFixas, {
        cadeiras: cfg.cadeiras,
        horasDia: cfg.horasDia,
        diasMes: cfg.diasMes,
        ocupacaoPct: cfg.ocupacaoPct,
      });
      // v74: custo fixo por atendimento = média fixas ÷ média atendimentos (meses fechados)
      const cfaMedio = await custoFixoAtendimentoMedio(mes);
      const custoFixoPorAtendimento = cfaMedio.custoFixoPorAtendimento;

      const result = servicos.map((s: any) => {
        const id = String(s.id || "");
        const nome = String(s.nome || "");
        const categoria = String(s.categoria || "");
        const preco = Number(s.preco || 0);
        const duracao = Number(s.duracao || 0);

        // Ficha técnica salva (soma dos itens)
        const sc = serviceCosts.find(c => c.serviceId === id);
        const fichaTecnica = sc ? sc.items.reduce((sum, it) =>
          sum + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0), 0) : 0;

        // Comissão: override se houver, senão regra por categoria
        const comissaoPct = sc?.comissaoPct !== undefined
          ? sc.comissaoPct
          : Math.round(getComissaoPctDoServico(nome) * 100);
        const comissaoAssistentePct = sc?.comissaoAssistentePct ?? 0;

        // Margem desejada: override se houver, senão default por categoria
        const margemDesejadaPct = sc?.margemDesejadaPct !== undefined
          ? sc.margemDesejadaPct
          : getMargemDesejadaDefault(categoria, nome);

        const calculo = calcularMargemServico({
          preco,
          duracaoMin: duracao,
          fichaTecnica,
          custoFixoPorMinuto: cfm.custoFixoPorMinuto,
          custoFixoPorAtendimento,           // v70 — prioridade sobre o por-minuto
          outrosCustos: Number((sc as any)?.outrosCustos || 0),  // v70
          comissaoPct,
          comissaoAssistentePct,
          margemDesejadaPct,
          taxaCartaoPct: cfg.taxaCartaoPct,  // v56
          impostoPct: cfg.impostoPct,        // v56
        });

        return {
          id, nome, categoria, preco, duracao,
          fichaTecnica: Number(fichaTecnica.toFixed(2)),
          itensFicha: sc ? sc.items.length : 0,
          comissaoPct,
          comissaoOverride: sc?.comissaoPct !== undefined,
          comissaoAssistentePct,
          comissaoAssistenteOverride: sc?.comissaoAssistentePct !== undefined && sc.comissaoAssistentePct > 0,
          margemDesejadaPct,
          margemDesejadaOverride: sc?.margemDesejadaPct !== undefined,
          ...calculo,
        };
      });

      return res.json({
        ok: true,
        mes,
        contexto: {
          totalFixas: totais.totalFixas,
          minutosProdutivosMes: cfm.minutosProdutivosMes,
          custoFixoPorMinuto: cfm.custoFixoPorMinuto,
          operacional: {
            cadeiras: cfg.cadeiras,
            horasDia: cfg.horasDia,
            diasMes: cfg.diasMes,
            ocupacaoPct: cfg.ocupacaoPct,
          },
          taxaCartaoPct: cfg.taxaCartaoPct,  // v56
          impostoPct: cfg.impostoPct,        // v56
        },
        servicos: result,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── POST /api/financeiro — Add single entry
  app.post("/api/financeiro", (req: Request, res: Response) => {
    const result = financeEntrySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.errors.map(e => e.message).join(", ") });
    }
    const entry: FinanceEntry = {
      id: `fin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...result.data,
      createdAt: new Date().toISOString(),
    };
    financeEntries.push(entry);
    saveFinanceEntries();
    log(`Financeiro: added entry "${entry.description}" (${entry.amount})`, "financeiro");
    return res.status(201).json(entry);
  });

  // ─── POST /api/financeiro/bulk — Add multiple entries at once
  app.post("/api/financeiro/bulk", (req: Request, res: Response) => {
    const bodySchema = z.object({ entries: z.array(financeEntrySchema) });
    const result = bodySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.errors.map(e => e.message).join(", ") });
    }
    const newEntries: FinanceEntry[] = result.data.entries.map(e => ({
      id: `fin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...e,
      createdAt: new Date().toISOString(),
    }));
    financeEntries.push(...newEntries);
    saveFinanceEntries();
    log(`Financeiro: bulk added ${newEntries.length} entries`, "financeiro");
    return res.status(201).json({ added: newEntries.length, entries: newEntries });
  });

  // ─── DELETE /api/financeiro/:id — Delete entry
  app.delete("/api/financeiro/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const idx = financeEntries.findIndex(e => e.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Entrada não encontrada." });
    }
    financeEntries.splice(idx, 1);
    saveFinanceEntries();
    log(`Financeiro: deleted entry ${id}`, "financeiro");
    return res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // EXPENSE CATEGORIAS & REGRAS (v27)
  // Categorias editáveis pelo usuário + regras de auto-classificação que
  // se aplicam a TransacaoBanco (extrato) e FinanceEntry (manual).
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/expense-categorias
  app.get("/api/expense-categorias", async (_req: Request, res: Response) => {
    try {
      const cats = await listExpenseCategorias();
      return res.json({ ok: true, categorias: cats });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/expense-categorias  (cria ou atualiza)
  app.post("/api/expense-categorias", async (req: Request, res: Response) => {
    try {
      const b = req.body || {};
      if (!b.nome || !b.tipo) return res.status(400).json({ ok: false, error: "nome e tipo são obrigatórios" });
      const tipos: ExpenseTipo[] = ['fixo','variavel','recorrente','cartao','comissao','bonus','imposto','insumo','investimento','outros'];
      if (!tipos.includes(b.tipo)) return res.status(400).json({ ok: false, error: "tipo inválido" });
      const novo = await upsertExpenseCategoria({
        id: b.id,
        nome: String(b.nome).trim(),
        tipo: b.tipo,
        cor: b.cor || "#64748b",
        ativa: b.ativa !== false,
        ordem: Number(b.ordem) || 50,
      });
      return res.json({ ok: true, categoria: novo });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/expense-categorias/:id
  app.delete("/api/expense-categorias/:id", async (req: Request, res: Response) => {
    try {
      const r = await deleteExpenseCategoria(String(req.params.id));
      if (!r.ok) return res.status(409).json({ ok: false, error: `Categoria em uso por ${r.usadaEm} regra(s). Remova as regras antes.` });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/expense-regras
  app.get("/api/expense-regras", async (_req: Request, res: Response) => {
    try {
      const regras = await listExpenseRegras();
      return res.json({ ok: true, regras });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/expense-regras  (cria ou atualiza)
  app.post("/api/expense-regras", async (req: Request, res: Response) => {
    try {
      const b = req.body || {};
      if (!b.pattern || !b.categoriaId) return res.status(400).json({ ok: false, error: "pattern e categoriaId obrigatórios" });
      const novo = await upsertExpenseRegra({
        id: b.id,
        pattern: String(b.pattern).toLowerCase().trim(),
        categoriaId: String(b.categoriaId),
        subcategoria: b.subcategoria ? String(b.subcategoria).trim() : undefined,
        ativa: b.ativa !== false,
      });
      return res.json({ ok: true, regra: novo });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/expense-regras/:id
  app.delete("/api/expense-regras/:id", async (req: Request, res: Response) => {
    try {
      await deleteExpenseRegra(String(req.params.id));
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/expenses/classificar-tudo
  // Aplica regras a TODAS as despesas (saídas bancárias + lançamentos manuais).
  // Por padrão NÃO sobrescreve atribuições manuais — passa { force: true } pra forçar.
  app.post("/api/expenses/classificar-tudo", async (req: Request, res: Response) => {
    try {
      const force = !!(req.body || {}).force;
      const regras = await listExpenseRegras();
      const counts = new Map<string, number>();
      let bankAtualizadas = 0;
      let bankPuladas = 0;
      let manualAtualizadas = 0;
      let manualPuladas = 0;

      // Bancárias (saídas apenas — entradas não precisam de categoria)
      for (const t of transacoesBanco) {
        if (t.amount >= 0) continue;
        const jaTinha = !!t.categoriaId;
        const eraManual = jaTinha && !t.regraIdAplicada;
        if (jaTinha && !force && eraManual) { bankPuladas++; continue; }
        const m = classificarDescricao(t.description, regras);
        if (!m) continue;
        if (jaTinha && t.categoriaId === m.categoriaId && t.regraIdAplicada === m.regraId) continue;
        t.categoriaId = m.categoriaId;
        t.subcategoria = m.subcategoria;
        t.regraIdAplicada = m.regraId;
        bankAtualizadas++;
        counts.set(m.regraId, (counts.get(m.regraId) || 0) + 1);
      }
      if (bankAtualizadas > 0) saveTransacoesBanco();

      // Manuais (despesas apenas)
      for (const e of financeEntries) {
        if (e.amount >= 0) continue;
        const jaTinha = !!e.categoriaId;
        if (jaTinha && !force) { manualPuladas++; continue; }
        const m = classificarDescricao(e.description, regras);
        if (!m) continue;
        e.categoriaId = m.categoriaId;
        e.subcategoriaNova = m.subcategoria;
        manualAtualizadas++;
        counts.set(m.regraId, (counts.get(m.regraId) || 0) + 1);
      }
      if (manualAtualizadas > 0) saveFinanceEntries();

      await bumpRegrasAplicadas(counts);

      log(`expenses/classificar-tudo: bank=${bankAtualizadas}/+${bankPuladas} skip; manual=${manualAtualizadas}/+${manualPuladas} skip`, "expense");
      return res.json({
        ok: true,
        bank: { atualizadas: bankAtualizadas, puladas: bankPuladas },
        manual: { atualizadas: manualAtualizadas, puladas: manualPuladas },
        regrasUsadas: counts.size,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/expenses/:fonte/:id/categoria
  // Atribuição manual de categoria a uma despesa específica.
  // fonte = "bank" | "manual"
  app.put("/api/expenses/:fonte/:id/categoria", async (req: Request, res: Response) => {
    try {
      const { fonte, id } = req.params;
      const b = req.body || {};
      const categoriaId: string | null = b.categoriaId ? String(b.categoriaId) : null;
      const subcategoria: string | undefined = b.subcategoria ? String(b.subcategoria).trim() : undefined;

      if (categoriaId !== null) {
        const cats = await listExpenseCategorias();
        if (!cats.find(c => c.id === categoriaId)) {
          return res.status(400).json({ ok: false, error: "categoriaId não existe" });
        }
      }

      if (fonte === "bank") {
        const t = transacoesBanco.find(x => x.id === id);
        if (!t) return res.status(404).json({ ok: false, error: "transação não encontrada" });
        t.categoriaId = categoriaId || undefined;
        t.subcategoria = subcategoria;
        t.regraIdAplicada = undefined; // atribuição manual desliga origem-regra
        saveTransacoesBanco();
        return res.json({ ok: true, transacao: t });
      }
      if (fonte === "manual") {
        const e = financeEntries.find(x => x.id === id);
        if (!e) return res.status(404).json({ ok: false, error: "lançamento não encontrado" });
        e.categoriaId = categoriaId || undefined;
        e.subcategoriaNova = subcategoria;
        saveFinanceEntries();
        return res.json({ ok: true, entry: e });
      }
      return res.status(400).json({ ok: false, error: "fonte inválida (bank|manual)" });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/expenses/sumario/:mes  → totais por categoria + tipo, agrupando bank+manual
  app.get("/api/expenses/sumario/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes); // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido" });

      const cats = await listExpenseCategorias();
      const byId = new Map(cats.map(c => [c.id, c]));

      type Bucket = {
        categoriaId: string | null;
        categoriaNome: string;
        tipo: ExpenseTipo | "sem_categoria";
        cor: string;
        total: number;
        qtd: number;
        subcategorias: Record<string, { total: number; qtd: number }>;
      };
      const buckets = new Map<string, Bucket>();
      function getBucket(catId: string | null): Bucket {
        const k = catId || "_sem";
        if (buckets.has(k)) return buckets.get(k)!;
        const c = catId ? byId.get(catId) : null;
        const b: Bucket = {
          categoriaId: catId,
          categoriaNome: c ? c.nome : "Sem categoria",
          tipo: c ? c.tipo : "sem_categoria",
          cor: c ? c.cor : "#475569",
          total: 0, qtd: 0, subcategorias: {},
        };
        buckets.set(k, b);
        return b;
      }
      function addSubcat(b: Bucket, sub: string | undefined, value: number) {
        const key = (sub || "—").trim() || "—";
        if (!b.subcategorias[key]) b.subcategorias[key] = { total: 0, qtd: 0 };
        b.subcategorias[key].total += value;
        b.subcategorias[key].qtd += 1;
      }

      // Saídas bancárias do mês — incluidoNoFluxo !== false
      for (const t of transacoesBanco) {
        if (t.amount >= 0) continue;
        if (t.incluidoNoFluxo === false) continue;
        if (!t.date.startsWith(mes)) continue;
        const v = Math.abs(t.amount);
        const b = getBucket(t.categoriaId || null);
        b.total += v; b.qtd += 1;
        addSubcat(b, t.subcategoria, v);
      }
      // Manuais do mês — só despesas
      for (const e of financeEntries) {
        if (e.amount >= 0) continue;
        if (!e.date.startsWith(mes)) continue;
        const v = Math.abs(e.amount);
        const b = getBucket(e.categoriaId || null);
        b.total += v; b.qtd += 1;
        addSubcat(b, e.subcategoriaNova || e.subcategory, v);
      }

      const lista = Array.from(buckets.values()).sort((a, b) => b.total - a.total);
      const totalGeral = lista.reduce((s, b) => s + b.total, 0);

      // Totais por TIPO contábil — base pra DRE/precificação.
      const porTipo: Record<string, { total: number; qtd: number }> = {};
      for (const b of lista) {
        const k = String(b.tipo);
        if (!porTipo[k]) porTipo[k] = { total: 0, qtd: 0 };
        porTipo[k].total += b.total;
        porTipo[k].qtd += b.qtd;
      }

      return res.json({ ok: true, mes, totalGeral, porTipo, categorias: lista });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/expenses/categoria/:catId/:mes — drill-down: todas as despesas de uma
  // categoria no mês (bank + manual), com nome da conta enriquecido.
  app.get("/api/expenses/categoria/:catId/:mes", async (req: Request, res: Response) => {
    try {
      const { catId, mes } = req.params;
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido" });
      const contasMap = new Map(contasConsolidacao.map(c => [c.id, c]));
      // Trata "_sem" como filtro de "sem categoria"
      const filtraSem = catId === "_sem";

      const bank = transacoesBanco
        .filter(t => t.amount < 0
          && t.incluidoNoFluxo !== false
          && t.date.startsWith(mes)
          && (filtraSem ? !t.categoriaId : t.categoriaId === catId))
        .map(t => ({
          fonte: "bank" as const,
          id: t.id, date: t.date, description: t.description, amount: t.amount,
          contaId: t.contaId, contaNome: contasMap.get(t.contaId)?.nome.trim() || "?",
          subcategoria: t.subcategoria,
          regraIdAplicada: t.regraIdAplicada,
        }));

      const manual = financeEntries
        .filter(e => e.amount < 0
          && e.date.startsWith(mes)
          && (filtraSem ? !e.categoriaId : e.categoriaId === catId))
        .map(e => ({
          fonte: "manual" as const,
          id: e.id, date: e.date, description: e.description, amount: e.amount,
          contaId: null, contaNome: "Manual",
          subcategoria: e.subcategoriaNova || e.subcategory,
          regraIdAplicada: undefined as string | undefined,
        }));

      const itens = [...bank, ...manual].sort((a, b) => (a.date < b.date ? 1 : -1));
      const total = itens.reduce((s, i) => s + Math.abs(i.amount), 0);
      return res.json({ ok: true, mes, categoriaId: catId, total, qtd: itens.length, itens });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/expenses/sem-categoria/:mes — saídas (bank+manual) ainda sem classificação
  app.get("/api/expenses/sem-categoria/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes inválido" });
      const itens: any[] = [];
      for (const t of transacoesBanco) {
        if (t.amount >= 0 || t.incluidoNoFluxo === false) continue;
        if (!t.date.startsWith(mes)) continue;
        if (t.categoriaId) continue;
        itens.push({ fonte: "bank", id: t.id, date: t.date, description: t.description, amount: t.amount });
      }
      for (const e of financeEntries) {
        if (e.amount >= 0) continue;
        if (!e.date.startsWith(mes)) continue;
        if (e.categoriaId) continue;
        itens.push({ fonte: "manual", id: e.id, date: e.date, description: e.description, amount: e.amount });
      }
      itens.sort((a, b) => (a.date < b.date ? 1 : -1));
      return res.json({ ok: true, mes, total: itens.length, itens });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── POST /api/financeiro/analyze — AI analysis with Anthropic
  app.post("/api/financeiro/analyze", async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const monthPrefix = `${year}-${month}`;
      const monthEntries = financeEntries.filter(e => e.date.startsWith(monthPrefix));

      if (monthEntries.length === 0) {
        return res.status(400).json({ error: "Nenhum lançamento encontrado para o mês atual. Adicione entradas antes de analisar." });
      }

      const receitas = monthEntries.filter(e => e.amount > 0);
      const despesas = monthEntries.filter(e => e.amount < 0);
      const totalReceitas = receitas.reduce((s, e) => s + e.amount, 0);
      const totalDespesas = despesas.reduce((s, e) => s + Math.abs(e.amount), 0);
      const saldo = totalReceitas - totalDespesas;

      const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const entriesSummary = monthEntries.map(e => 
        `${e.date} | ${e.description} | ${e.category} | ${e.subcategory} | ${formatBRL(e.amount)} | recorrente: ${e.recurrent}`
      ).join("\n");

      const prompt = `Você é um consultor financeiro especializado em pequenos negócios. Analise os lançamentos financeiros abaixo de uma barbearia chamada Greco Barbearia Anápolis (proprietário: Fred Lasmar) com meta de receita de R$150.000/mês e cerca de 16 profissionais.

Mês de referência: ${month}/${year}

RESUMO DO MÊS:
- Total de Receitas: ${formatBRL(totalReceitas)}
- Total de Despesas: ${formatBRL(totalDespesas)}
- Saldo: ${formatBRL(saldo)}

LANÇAMENTOS (data | descrição | categoria | subcategoria | valor | recorrente):
${entriesSummary}

Por favor, forneça uma análise completa em português brasileiro com as seguintes seções:

## 1. Visão Geral do Mês
Resumo executivo dos números do mês e como estão em relação à meta de R$150.000.

## 2. Gargalos Identificados
Principais problemas e despesas que estão impactando negativamente o resultado. Seja específico com valores.

## 3. Análise de Custos Fixos vs Variáveis
Comentário sobre a proporção entre custos fixos, variáveis e parcelamentos em relação à receita.

## 4. Oportunidades e Ações Recomendadas
Liste pelo menos 3 ações práticas e específicas que Fred pode tomar este mês para melhorar o resultado financeiro.

## 5. Indicadores de Alerta
Qualquer sinal de atenção que deva ser monitorado nos próximos meses.`;

      const client = new Anthropic();
      const message = await client.messages.create({
        model: "claude_sonnet_4_6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      const analysisText = content.type === "text" ? content.text : "Erro ao obter análise.";

      log(`Financeiro: AI analysis completed (${message.usage?.output_tokens || 0} tokens)`, "financeiro");
      return res.json({ analysis: analysisText, entriesAnalyzed: monthEntries.length });
    } catch (err: any) {
      log(`Financeiro: AI analysis error: ${err?.message}`, "financeiro");
      return res.status(500).json({ error: err?.message || "Erro ao processar análise com IA." });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // COPILOTO GRECO — Chat IA integrado
  // ──────────────────────────────────────────────────────────────────

  // Intents com keywords para classificação rápida
  const COPILOT_INTENTS: Record<string, { name: string; keywords: string[]; gatherData: () => any }> = {
    resumo_dia: {
      name: "Resumo do Dia",
      keywords: ["resumo do dia", "como foi hoje", "resultado de hoje", "faturamento hoje", "receita hoje", "vendas hoje", "movimento hoje"],
      gatherData: () => {
        const hoje = new Date().toISOString().slice(0, 10);
        const trinksCache = loadTrinksCache();
        const agendamentos = trinksCache?.agendamentos || [];
        const agendHoje = agendamentos.filter((a: any) => String(a.data || a.dataAgendamento || "").startsWith(hoje));
        const entradas = financeEntries.filter(e => e.date === hoje);
        return { data: hoje, agendamentosHoje: agendHoje.length, entradas, trinksAgendamentos: agendHoje.slice(0, 30) };
      },
    },
    resumo_semana: {
      name: "Resumo da Semana",
      keywords: ["resumo da semana", "como foi a semana", "resultado semanal", "faturamento semanal"],
      gatherData: () => {
        const now = new Date();
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + 1);
        const start = weekStart.toISOString().slice(0, 10);
        const end = now.toISOString().slice(0, 10);
        const entradas = financeEntries.filter(e => e.date >= start && e.date <= end);
        return { periodo: `${start} a ${end}`, entradas };
      },
    },
    equipe: {
      name: "Diagnóstico de Equipe",
      keywords: ["quem piorou", "piora na equipe", "desempenho do barbeiro", "performance barbeiro", "equipe", "barbeiro", "diagnostico barbeiro", "rendimento barbeiro"],
      gatherData: () => {
        const trinksCache = loadTrinksCache();
        return { profissionais: trinksCache?.profissionais || [], agendamentos: (trinksCache?.agendamentos || []).slice(0, 100) };
      },
    },
    assinantes: {
      name: "Análise de Assinaturas",
      keywords: ["assinantes em risco", "churn", "assinatura", "clube", "inadimplente", "assinantes sumidos", "cancelamento"],
      gatherData: () => {
        return { assinantes: assinaturaClientes, totalAtivos: assinaturaClientes.filter(c => c.status === "active").length };
      },
    },
    financeiro: {
      name: "Análise Financeira",
      keywords: ["financeiro", "despesa", "gasto", "receita", "lucro", "caixa", "fluxo de caixa", "faturamento do mes"],
      gatherData: () => {
        const mes = new Date().toISOString().slice(0, 7);
        const doMes = financeEntries.filter(e => e.date.startsWith(mes));
        return { mes, entradas: doMes };
      },
    },
    consolidacao: {
      name: "Consolidação Bancária",
      keywords: ["consolidação", "conciliação", "divergencia", "caixa não fecha", "banco", "extrato"],
      gatherData: () => {
        const mes = new Date().toISOString().slice(0, 7);
        const txMes = transacoesBanco.filter(t => t.date.startsWith(mes));
        return { mes, transacoes: txMes.length, contas: contasConsolidacao.map(c => c.nome) };
      },
    },
    metas: {
      name: "Progresso de Metas",
      keywords: ["meta", "progresso", "quanto falta", "vai bater a meta", "projeção"],
      gatherData: () => {
        const mes = new Date().toISOString().slice(0, 7);
        return { metas: metasHistorico.filter(m => m.month === mes), metasBarbeiros: metasBarbeiros[mes] || {} };
      },
    },
    servicos: {
      name: "Análise de Serviços",
      keywords: ["serviço mais vendido", "servico", "preço", "precificação", "margem", "ticket medio"],
      gatherData: () => {
        const trinksCache = loadTrinksCache();
        return { servicos: trinksCache?.servicos || [] };
      },
    },
  };

  function loadTrinksCache(): any {
    try {
      if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    } catch {}
    return null;
  }

  function normalizeText(text: string): string {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  }

  function classifyIntent(pergunta: string): { intentCode: string; name: string } {
    const normalized = normalizeText(pergunta);
    for (const [code, intent] of Object.entries(COPILOT_INTENTS)) {
      for (const kw of intent.keywords) {
        const nkw = normalizeText(kw);
        const words = nkw.split(" ");
        if (words.every(w => normalized.includes(w))) {
          return { intentCode: code, name: intent.name };
        }
      }
    }
    return { intentCode: "resumo_dia", name: "Resumo Geral" };
  }

  const COPILOT_SYSTEM_PROMPT = `Você é o Copiloto Greco, assistente de inteligência de negócios da Greco Barbearia Anápolis.

## Sua Função
Analisa dados reais do sistema (agendamentos, receitas, despesas, equipe, assinaturas, consolidação bancária) e fornece respostas claras, objetivas e acionáveis para o dono da barbearia (Fred).

## Tom e Estilo
- Fale como um consultor de confiança direto ao ponto
- Use números concretos, não generalizações ("faturou R$ 1.847 hoje" > "faturou bem")
- Quando os dados são ruins, diga claramente
- Quando são bons, celebre brevemente
- Responda em português brasileiro, máximo 3-4 parágrafos
- Termine com 1-2 ações práticas sugeridas
- Use formatação markdown simples (negrito, listas)

## Contexto do Negócio
- Barbearia com 16+ profissionais
- Meta mensal: R$ 150.000
- Meios de pagamento: Pix, Cartão (Getnet/InfinitePay), Dinheiro
- Sistema integrado com Trinks (agendamentos/vendas)
- Data de hoje: ${new Date().toLocaleDateString("pt-BR")}`;

  // POST /api/copilot/ask
  app.post("/api/copilot/ask", async (req: Request, res: Response) => {
    const { pergunta } = req.body;
    if (!pergunta || typeof pergunta !== "string" || pergunta.trim().length < 3) {
      return res.status(400).json({ error: "Pergunta muito curta" });
    }

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada" });

      // 1. Classifica o intent
      const { intentCode, name: intentName } = classifyIntent(pergunta);
      const intent = COPILOT_INTENTS[intentCode];

      // 2. Coleta dados relevantes
      const dados = intent.gatherData();

      // 3. Chama Claude
      const anthropic = new Anthropic({ apiKey });
      const userPrompt = `O dono da barbearia perguntou: "${pergunta}"

Dados do sistema (intent: ${intentName}):
\`\`\`json
${JSON.stringify(dados, null, 2).slice(0, 8000)}
\`\`\`

Responda de forma clara e objetiva. Se os dados estiverem vazios, informe que não há dados disponíveis para o período e sugira sincronizar com a Trinks.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [
          { role: "user", content: userPrompt },
        ],
        system: COPILOT_SYSTEM_PROMPT,
      });

      const texto = message.content[0]?.type === "text" ? message.content[0].text : "Não consegui gerar uma resposta.";

      // Ações sugeridas por intent
      const acoesSugeridas: Record<string, string[]> = {
        resumo_dia: ["Ver lançamentos do dia", "Fechar o dia"],
        resumo_semana: ["Ver fechamento semanal", "Comparar com semana passada"],
        equipe: ["Ver aba Equipe", "Abrir Raio-X"],
        assinantes: ["Ver aba Assinaturas", "Checar inadimplentes"],
        financeiro: ["Ver aba Financeiro", "Analisar despesas"],
        consolidacao: ["Ver aba Consolidação", "Importar extrato"],
        metas: ["Ver aba Metas", "Ajustar meta mensal"],
        servicos: ["Ver aba Serviços", "Revisar precificação"],
      };

      return res.json({
        texto,
        intentCode,
        intentName,
        evidencias: {
          dados: typeof dados === "object" ? Object.entries(dados).map(([k, v]) => ({
            label: k,
            value: Array.isArray(v) ? `${v.length} registros` : String(v),
          })).slice(0, 10) : [],
        },
        acoesSugeridas: acoesSugeridas[intentCode] || ["Ver Dashboard"],
        tokensUsados: message.usage?.output_tokens || 0,
      });
    } catch (err: any) {
      log(`Copiloto erro: ${err.message}`, "copilot");
      return res.status(500).json({ error: "Erro ao processar pergunta. Tente novamente." });
    }
  });

  // POST /api/copilot/feedback
  app.post("/api/copilot/feedback", (req: Request, res: Response) => {
    const { messageId, util } = req.body;
    log(`Copiloto feedback: msg=${messageId} util=${util}`, "copilot");
    return res.json({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────────
  // ASSINATURAS ROUTES
  // ──────────────────────────────────────────────────────────────────

  // Aplica matches automáticos entre transações de entrada (sem origem) e
  // mensalidades de assinaturas em aberto. Usado depois de importar extrato.
  // Critério: amount ≈ planValue (±0,02), date dentro de ±10 dias do paymentDay
  // do mês de cada parcela em aberto. Pega 1 match por (cliente,mes) — o mais
  // próximo do dia de pagamento — e não toca em transações já vinculadas.
  // Retorna número de matches aplicados.
  function autoMatchAssinaturas(meses: string[]): number {
    if (meses.length === 0) return 0;
    let aplicados = 0;
    const txsUsadas = new Set<string>();

    for (const c of assinaturaClientes) {
      if (c.status !== "active") continue;
      const diaPg = Math.min(c.paymentDay || 10, 28);

      for (const mes of meses) {
        if (!/^\d{4}-\d{2}$/.test(mes)) continue;
        // Está dentro do contrato?
        const inicioContrato = c.contractDate.slice(0, 7);
        const fimContrato = c.contractEndDate.slice(0, 7);
        if (mes < inicioContrato || mes > fimContrato) continue;
        // Já pago?
        const pg = c.payments.find(p => p.mes === mes);
        if (pg?.pago) continue;

        const [y, m] = mes.split("-").map(Number);
        const centro = new Date(Date.UTC(y, m - 1, diaPg));
        const inicio = new Date(centro.getTime() - 10 * 86400000).toISOString().slice(0, 10);
        const fim = new Date(centro.getTime() + 10 * 86400000).toISOString().slice(0, 10);

        const candidata = transacoesBanco
          .filter(t =>
            !txsUsadas.has(t.id) &&
            t.amount > 0 &&
            !t.origemAssinatura &&
            t.date >= inicio && t.date <= fim &&
            Math.abs(t.amount - c.planValue) < 0.02
          )
          .sort((a, b) => {
            const da = Math.abs(new Date(a.date).getTime() - centro.getTime());
            const db = Math.abs(new Date(b.date).getTime() - centro.getTime());
            return da - db;
          })[0];

        if (!candidata) continue;
        txsUsadas.add(candidata.id);
        candidata.origemAssinatura = { clienteId: c.id, mes };
        if (!/assinatura/i.test(candidata.description || "")) {
          candidata.description = `${candidata.description} • Assinatura ${c.name}`.trim();
        }

        const pIdx = c.payments.findIndex(p => p.mes === mes);
        const pagamento: PagamentoMensal = {
          mes,
          pago: true,
          pagoEm: new Date().toISOString(),
          valor: candidata.amount,
          formaPagamento: 'infinitepay',
          contaId: candidata.contaId,
          dataPagamento: candidata.date,
          transacaoBancoId: candidata.id,
        };
        if (pIdx >= 0) c.payments[pIdx] = { ...c.payments[pIdx], ...pagamento };
        else c.payments.push(pagamento);
        c.updatedAt = new Date().toISOString();
        aplicados++;
      }
    }
    if (aplicados > 0) {
      saveTransacoesBanco();
      saveAssinaturaClientes();
      log(`auto-match assinaturas: ${aplicados} pagamento(s) vinculado(s) ao extrato`, "consolidacao");
    }
    return aplicados;
  }

  // Helper: comissão como BÔNUS ÚNICO sobre a 1ª parcela paga (não recorrente).
  // Retorna { comissaoBonusRS, comissaoPaga, primeiraParcelaMes }.
  function calcularComissao(c: AssinaturaCliente, pct: number) {
    const comissaoBonusRS = (c.planValue || 0) * (pct / 100);
    // Primeira parcela = mês do início do contrato.
    const inicio = new Date(c.contractDate);
    const primeiraParcelaMes = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}`;
    const pgPrimeira = c.payments.find(p => p.mes === primeiraParcelaMes);
    const comissaoPaga = !!pgPrimeira?.pago;
    return { comissaoBonusRS, comissaoPaga, primeiraParcelaMes };
  }

  // GET /api/assinaturas/matriz-pagamentos?ate=YYYY-MM&meses=6
  // Visão matricial cliente × mês pra acompanhar quem pagou em cada mês.
  // Cada célula tem um status: pago | atrasado | pendente | futuro | sem_contrato.
  // Calcula também inadimplenciaConsecutiva (meses seguidos sem pagar antes do mês atual).
  app.get("/api/assinaturas/matriz-pagamentos", (req: Request, res: Response) => {
    const meses = Math.max(1, Math.min(24, Number(req.query.meses) || 6));
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    const ateMes = String(req.query.ate || mesAtual);
    if (!/^\d{4}-\d{2}$/.test(ateMes)) return res.status(400).json({ error: "ate inválido (YYYY-MM)" });

    // Gera lista de meses pra exibir (terminando em ateMes, indo pra trás `meses` meses)
    const [yAte, mAte] = ateMes.split("-").map(Number);
    const colunas: string[] = [];
    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(yAte, mAte - 1 - i, 1));
      colunas.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }

    const limiarAlerta = Math.max(1, Number(storeData.settings?.assinaturaAlertaMesesInadimplente ?? 2));

    const linhas = assinaturaClientes
      .filter(c => c.status === 'active')
      .map(c => {
        const inicioContrato = c.contractDate.slice(0, 7);
        const fimContrato = c.contractEndDate.slice(0, 7);
        const pagoMap = new Map(c.payments.map(p => [p.mes, p]));

        const cells = colunas.map(mes => {
          const dentroContrato = mes >= inicioContrato && mes <= fimContrato;
          if (!dentroContrato) return { mes, status: 'sem_contrato' as const };
          const pg = pagoMap.get(mes);
          if (pg?.pago) {
            return {
              mes,
              status: 'pago' as const,
              formaPagamento: pg.formaPagamento,
              dataPagamento: pg.dataPagamento,
              transacaoBancoId: pg.transacaoBancoId,
            };
          }
          if (mes > mesAtual) return { mes, status: 'futuro' as const };
          if (mes === mesAtual) return { mes, status: 'pendente' as const };
          return { mes, status: 'atrasado' as const };
        });

        // Inadimplência consecutiva: meses antes (ou incluindo) o atual, contando
        // pra trás, parando no primeiro mês pago ou fora de contrato.
        let inadimplenciaConsecutiva = 0;
        const mesesAteHoje: string[] = [];
        const [yH, mH] = mesAtual.split("-").map(Number);
        const limiteHistorico = 60; // pra evitar loop infinito
        for (let i = 0; i < limiteHistorico; i++) {
          const d = new Date(Date.UTC(yH, mH - 1 - i, 1));
          const mes = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          if (mes < inicioContrato) break;
          if (mes > fimContrato) continue;
          mesesAteHoje.push(mes);
        }
        for (const mes of mesesAteHoje) {
          if (mes === mesAtual) continue; // mês atual ainda pode ser pago dentro do prazo
          const pg = pagoMap.get(mes);
          if (pg?.pago) break;
          inadimplenciaConsecutiva++;
        }

        return {
          clienteId: c.id,
          name: c.name,
          phone: c.phone,
          planValue: c.planValue,
          plan: c.plan,
          seller: c.seller,
          contractDate: c.contractDate,
          contractEndDate: c.contractEndDate,
          paymentDay: c.paymentDay,
          cells,
          inadimplenciaConsecutiva,
          deveAlertarCancelamento: inadimplenciaConsecutiva >= limiarAlerta,
        };
      })
      // Ordena: mais inadimplentes primeiro, depois por nome
      .sort((a, b) => {
        if (b.inadimplenciaConsecutiva !== a.inadimplenciaConsecutiva) {
          return b.inadimplenciaConsecutiva - a.inadimplenciaConsecutiva;
        }
        return a.name.localeCompare(b.name);
      });

    return res.json({
      meses: colunas,
      mesAtual,
      limiarAlerta,
      linhas,
    });
  });

  // GET /api/assinaturas/clientes — lista com status de pagamento calculado
  app.get("/api/assinaturas/clientes", (_req: Request, res: Response) => {
    const pctPadrao = Number(storeData.settings?.comissaoPlanoPadraoPct ?? 20);
    const enriched = assinaturaClientes.map(c => {
      const pct = Number(c.commissionPct ?? pctPadrao);
      const pagos = c.payments.filter(p => p.pago).length;
      const { comissaoBonusRS, comissaoPaga, primeiraParcelaMes } = calcularComissao(c, pct);
      return {
        ...c,
        paymentStatus: getPaymentStatus(c),
        commissionPctEfetivo: pct,
        commissionPctFonte: c.commissionPct != null ? 'cliente' : 'global',
        // Bônus único: valor potencial e se já foi pago.
        comissaoBonusRS,
        comissaoPaga,
        primeiraParcelaMes,
        // Retrocompat: campos antigos refletem o bônus único, não recorrência.
        comissaoMensalRS: 0,
        comissaoAcumuladaRS: comissaoPaga ? comissaoBonusRS : 0,
        mesesPagos: pagos,
      };
    });
    return res.json(enriched.sort((a, b) => a.name.localeCompare(b.name)));
  });

  // GET /api/assinaturas/clientes/:id
  app.get("/api/assinaturas/clientes/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const c = assinaturaClientes.find(c => c.id === id);
    if (!c) return res.status(404).json({ error: "Cliente não encontrado" });
    const pctPadrao = Number(storeData.settings?.comissaoPlanoPadraoPct ?? 20);
    const pct = Number(c.commissionPct ?? pctPadrao);
    const pagos = c.payments.filter(p => p.pago).length;
    const { comissaoBonusRS, comissaoPaga, primeiraParcelaMes } = calcularComissao(c, pct);
    return res.json({
      ...c,
      paymentStatus: getPaymentStatus(c),
      commissionPctEfetivo: pct,
      commissionPctFonte: c.commissionPct != null ? 'cliente' : 'global',
      comissaoBonusRS,
      comissaoPaga,
      primeiraParcelaMes,
      comissaoMensalRS: 0,
      comissaoAcumuladaRS: comissaoPaga ? comissaoBonusRS : 0,
      mesesPagos: pagos,
    });
  });

  // POST /api/assinaturas/clientes — cadastrar novo assinante
  app.post("/api/assinaturas/clientes", (req: Request, res: Response) => {
    const { name, phone, email, plan, planValue, contractDate, contractDurationMonths, paymentDay, contractUrl, notes, seller, commissionPct } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório" });
    if (!plan) return res.status(400).json({ error: "Plano é obrigatório" });
    if (!planValue) return res.status(400).json({ error: "Valor é obrigatório" });
    if (!contractDate) return res.status(400).json({ error: "Data do contrato é obrigatória" });
    if (!contractDurationMonths) return res.status(400).json({ error: "Duração é obrigatória" });
    if (!paymentDay) return res.status(400).json({ error: "Dia de pagamento é obrigatório" });

    const duration = Number(contractDurationMonths);
    const endDate = new Date(contractDate);
    endDate.setMonth(endDate.getMonth() + duration);
    const now = new Date().toISOString();

    const cliente: AssinaturaCliente = {
      id: `asc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: String(name).trim(),
      phone: phone || undefined,
      email: email || undefined,
      plan,
      planValue: Number(planValue),
      contractDate,
      contractDurationMonths: duration,
      contractEndDate: endDate.toISOString().slice(0, 10),
      contractUrl: contractUrl || undefined,
      paymentDay: Number(paymentDay),
      payments: [],
      status: "active",
      notes: notes || undefined,
      seller: seller ? String(seller).trim() : undefined,
      commissionPct: commissionPct != null && commissionPct !== '' ? Number(commissionPct) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    assinaturaClientes.push(cliente);
    saveAssinaturaClientes();
    return res.json({ id: cliente.id, message: "Assinante cadastrado" });
  });

  // PUT /api/assinaturas/clientes/:id — editar assinante
  app.put("/api/assinaturas/clientes/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const idx = assinaturaClientes.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: "Cliente não encontrado" });
    const c = assinaturaClientes[idx];
    const { name, phone, email, plan, planValue, contractDate, contractDurationMonths, paymentDay, contractUrl, notes, status, seller, commissionPct } = req.body;
    if (name !== undefined) c.name = String(name).trim();
    if (phone !== undefined) c.phone = phone || undefined;
    if (email !== undefined) c.email = email || undefined;
    if (plan !== undefined) c.plan = plan;
    if (planValue !== undefined) c.planValue = Number(planValue);
    if (contractDate !== undefined) c.contractDate = contractDate;
    if (contractDurationMonths !== undefined) {
      c.contractDurationMonths = Number(contractDurationMonths);
      const end = new Date(c.contractDate);
      end.setMonth(end.getMonth() + c.contractDurationMonths);
      c.contractEndDate = end.toISOString().slice(0, 10);
    }
    if (paymentDay !== undefined) c.paymentDay = Number(paymentDay);
    if (contractUrl !== undefined) c.contractUrl = contractUrl || undefined;
    if (notes !== undefined) c.notes = notes || undefined;
    if (status !== undefined) c.status = status as any;
    if (seller !== undefined) c.seller = seller ? String(seller).trim() : undefined;
    if (commissionPct !== undefined) c.commissionPct = commissionPct === '' || commissionPct === null ? undefined : Number(commissionPct);
    c.updatedAt = new Date().toISOString();
    saveAssinaturaClientes();
    return res.json({ message: "Assinante atualizado" });
  });

  // DELETE /api/assinaturas/clientes/:id
  app.delete("/api/assinaturas/clientes/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const before = assinaturaClientes.length;
    assinaturaClientes = assinaturaClientes.filter(c => c.id !== id);
    if (assinaturaClientes.length === before) return res.status(404).json({ error: "Cliente não encontrado" });
    saveAssinaturaClientes();
    return res.json({ message: "Assinante excluído" });
  });

  // PUT /api/assinaturas/clientes/bulk-vendedor — atribuir vendedor + % comissão em lote
  app.put("/api/assinaturas/clientes/bulk-vendedor", (req: Request, res: Response) => {
    const { ids, seller, commissionPct } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids precisa ser um array não vazio" });
    }
    if (seller === undefined || seller === null) {
      return res.status(400).json({ error: "seller é obrigatório (use string vazia '' para remover)" });
    }
    const now = new Date().toISOString();
    const sellerVal = String(seller).trim();
    let atualizados = 0;
    for (const id of ids) {
      const c = assinaturaClientes.find(x => x.id === id);
      if (!c) continue;
      c.seller = sellerVal || undefined;
      if (commissionPct !== undefined) {
        c.commissionPct = (commissionPct === '' || commissionPct === null)
          ? undefined
          : Number(commissionPct);
      }
      c.updatedAt = now;
      atualizados++;
    }
    if (atualizados > 0) saveAssinaturaClientes();
    return res.json({ atualizados, total: ids.length });
  });

  // PUT /api/assinaturas/clientes/:id/cancelar
  app.put("/api/assinaturas/clientes/:id/cancelar", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const idx = assinaturaClientes.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: "Cliente não encontrado" });
    assinaturaClientes[idx].status = "cancelled";
    assinaturaClientes[idx].updatedAt = new Date().toISOString();
    saveAssinaturaClientes();
    return res.json({ message: "Assinatura cancelada" });
  });

  // PUT /api/assinaturas/clientes/:id/pagamento — registrar pagamento de um mês
  app.put("/api/assinaturas/clientes/:id/pagamento", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const {
      mes, pago,
      formaPagamento, contaId, dataPagamento, valor,
      vincularTransacaoId, // se preenchido, NÃO cria nova: marca a existente como origem
    } = req.body;
    if (!mes) return res.status(400).json({ error: "Mês é obrigatório (YYYY-MM)" });
    const idx = assinaturaClientes.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: "Cliente não encontrado" });
    const c = assinaturaClientes[idx];
    const pIdx = c.payments.findIndex(p => p.mes === mes);

    if (pago) {
      const valorPago = Number(valor ?? c.planValue);
      const dataPg = (dataPagamento && /^\d{4}-\d{2}-\d{2}$/.test(dataPagamento))
        ? dataPagamento
        : new Date().toISOString().slice(0, 10);
      let transacaoBancoId: string | undefined;

      // Caminho 1: vincula a uma transação já existente no extrato (não duplica).
      if (vincularTransacaoId) {
        const tIdx = transacoesBanco.findIndex(t => t.id === vincularTransacaoId);
        if (tIdx < 0) return res.status(404).json({ error: "Transação a vincular não encontrada" });
        transacoesBanco[tIdx].origemAssinatura = { clienteId: id, mes };
        // Anota descrição pra ficar legível na lista do extrato.
        const descAtual = transacoesBanco[tIdx].description || "";
        if (!/assinatura/i.test(descAtual)) {
          transacoesBanco[tIdx].description = `${descAtual} • Assinatura ${c.name}`.trim();
        }
        saveTransacoesBanco();
        transacaoBancoId = vincularTransacaoId;
      }
      // Caminho 2: cria uma transação nova na conta destino (forma dinheiro/pix/cartão).
      else if (formaPagamento && contaId) {
        const conta = contasConsolidacao.find(cc => cc.id === contaId);
        if (!conta) return res.status(404).json({ error: "Conta destino não encontrada" });
        const tipoMap: Record<string, TipoTransacao> = {
          dinheiro: 'outro', pix: 'pix', cartao: 'credito', infinitepay: 'pix', outro: 'outro',
        };
        const novaTx: TransacaoBanco = {
          id: `tx_assin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          contaId,
          date: dataPg,
          description: `Assinatura ${c.name} (${mes})`,
          amount: valorPago,
          tipo: tipoMap[formaPagamento] || 'outro',
          importedAt: new Date().toISOString(),
          incluidoNoFluxo: true,
          origemAssinatura: { clienteId: id, mes },
        };
        transacoesBanco.push(novaTx);
        saveTransacoesBanco();
        transacaoBancoId = novaTx.id;
      }
      // Caminho 3: sem forma/conta — só marca pago (retrocompat com chamadas antigas).

      const pagamento: PagamentoMensal = {
        mes,
        pago: true,
        pagoEm: new Date().toISOString(),
        valor: valorPago,
        formaPagamento,
        contaId,
        dataPagamento: dataPg,
        transacaoBancoId,
      };
      if (pIdx >= 0) c.payments[pIdx] = { ...c.payments[pIdx], ...pagamento };
      else c.payments.push(pagamento);
    } else {
      // Desfazer: se tinha transação vinculada, remove (se foi criada por nós) ou
      // só desvincula (se foi um match com transação existente do extrato).
      if (pIdx >= 0) {
        const antigo = c.payments[pIdx];
        if (antigo.transacaoBancoId) {
          const tIdx = transacoesBanco.findIndex(t => t.id === antigo.transacaoBancoId);
          if (tIdx >= 0) {
            const tx = transacoesBanco[tIdx];
            // Heurística: transações criadas por nós têm id começando com "tx_assin_".
            // Se for assim, removemos. Se era do extrato, só limpamos a origem.
            if (tx.id.startsWith("tx_assin_")) {
              transacoesBanco.splice(tIdx, 1);
            } else {
              tx.origemAssinatura = undefined;
              tx.description = tx.description.replace(/\s*•\s*Assinatura .+$/i, "");
            }
            saveTransacoesBanco();
          }
        }
        c.payments[pIdx] = {
          ...antigo,
          pago: false,
          pagoEm: undefined,
          transacaoBancoId: undefined,
        };
      }
    }
    c.updatedAt = new Date().toISOString();
    saveAssinaturaClientes();
    return res.json({ message: pago ? "Pagamento registrado" : "Pagamento desmarcado" });
  });

  // GET /api/assinaturas/clientes/:id/match-transacoes?mes=YYYY-MM&janelaDias=7
  // Lista transações de entrada (amount > 0) sem origemAssinatura, com valor
  // próximo ao planValue (±0,01) dentro de uma janela em torno do dia de
  // pagamento do mês. Usado pra "vincular a transação existente".
  app.get("/api/assinaturas/clientes/:id/match-transacoes", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const mes = String(req.query.mes || ""); // YYYY-MM
    const janela = Math.max(0, Math.min(30, Number(req.query.janelaDias) || 7));
    if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: "Mês inválido" });
    const c = assinaturaClientes.find(c => c.id === id);
    if (!c) return res.status(404).json({ error: "Cliente não encontrado" });

    const [y, m] = mes.split("-").map(Number);
    const diaPg = Math.min(c.paymentDay || 10, 28);
    const centro = new Date(Date.UTC(y, m - 1, diaPg));
    const inicio = new Date(centro.getTime() - janela * 86400000);
    const fim = new Date(centro.getTime() + janela * 86400000);
    const iniStr = inicio.toISOString().slice(0, 10);
    const fimStr = fim.toISOString().slice(0, 10);
    const valorAlvo = c.planValue;

    const candidatas = transacoesBanco
      .filter(t =>
        t.amount > 0 &&
        !t.origemAssinatura &&
        t.date >= iniStr && t.date <= fimStr &&
        Math.abs(t.amount - valorAlvo) < 0.02
      )
      .map(t => {
        const conta = contasConsolidacao.find(cc => cc.id === t.contaId);
        return {
          id: t.id,
          date: t.date,
          amount: t.amount,
          description: t.description,
          contaId: t.contaId,
          contaNome: conta?.nome || "—",
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.json({ candidatas, janela: { inicio: iniStr, fim: fimStr, diaPg } });
  });

  // GET /api/assinaturas/sugestoes-extrato?mes=YYYY-MM
  // Para cada assinante com mensalidade em aberto no mês, busca transações
  // de entrada sem origemAssinatura no extrato cuja janela bate. Retorna
  // 1 sugestão por assinante (a mais próxima do dia de pagamento). Usado
  // como aviso na tela Consolidação depois de importar extrato novo.
  app.get("/api/assinaturas/sugestoes-extrato", (req: Request, res: Response) => {
    const mes = String(req.query.mes || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: "Mês inválido (YYYY-MM)" });
    const janela = Math.max(0, Math.min(30, Number(req.query.janelaDias) || 10));
    const [y, m] = mes.split("-").map(Number);

    const sugestoes: Array<{
      clienteId: string; clienteNome: string; mes: string; planValue: number;
      transacao: { id: string; date: string; amount: number; description: string; contaId: string; contaNome: string };
    }> = [];

    for (const c of assinaturaClientes) {
      if (c.status !== "active") continue;
      // Já marcado como pago neste mês? pula.
      const pg = c.payments.find(p => p.mes === mes);
      if (pg?.pago) continue;
      // Está dentro do contrato?
      const inicioContrato = c.contractDate.slice(0, 7);
      const fimContrato = c.contractEndDate.slice(0, 7);
      if (mes < inicioContrato || mes > fimContrato) continue;

      const diaPg = Math.min(c.paymentDay || 10, 28);
      const centro = new Date(Date.UTC(y, m - 1, diaPg));
      const inicio = new Date(centro.getTime() - janela * 86400000).toISOString().slice(0, 10);
      const fim = new Date(centro.getTime() + janela * 86400000).toISOString().slice(0, 10);

      const match = transacoesBanco
        .filter(t =>
          t.amount > 0 &&
          !t.origemAssinatura &&
          t.date >= inicio && t.date <= fim &&
          Math.abs(t.amount - c.planValue) < 0.02
        )
        .sort((a, b) => {
          // Mais próximo da data de pagamento
          const da = Math.abs(new Date(a.date).getTime() - centro.getTime());
          const db = Math.abs(new Date(b.date).getTime() - centro.getTime());
          return da - db;
        })[0];

      if (match) {
        const conta = contasConsolidacao.find(cc => cc.id === match.contaId);
        sugestoes.push({
          clienteId: c.id,
          clienteNome: c.name,
          mes,
          planValue: c.planValue,
          transacao: {
            id: match.id, date: match.date, amount: match.amount,
            description: match.description, contaId: match.contaId,
            contaNome: conta?.nome || "—",
          },
        });
      }
    }
    return res.json({ sugestoes, mes });
  });

  // POST /api/assinaturas/sugestoes-extrato/aplicar
  // Aplica em lote: aceita [{ clienteId, mes, transacaoId }] e marca cada
  // pagamento como pago vinculando a transação correspondente.
  app.post("/api/assinaturas/sugestoes-extrato/aplicar", (req: Request, res: Response) => {
    const itens: Array<{ clienteId: string; mes: string; transacaoId: string }> = req.body?.itens || [];
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: "Lista vazia" });
    }
    let aplicados = 0;
    for (const it of itens) {
      const c = assinaturaClientes.find(c => c.id === it.clienteId);
      const tIdx = transacoesBanco.findIndex(t => t.id === it.transacaoId);
      if (!c || tIdx < 0) continue;
      const tx = transacoesBanco[tIdx];
      if (tx.origemAssinatura) continue;

      tx.origemAssinatura = { clienteId: c.id, mes: it.mes };
      if (!/assinatura/i.test(tx.description || "")) {
        tx.description = `${tx.description} • Assinatura ${c.name}`.trim();
      }

      const pIdx = c.payments.findIndex(p => p.mes === it.mes);
      const pagamento: PagamentoMensal = {
        mes: it.mes,
        pago: true,
        pagoEm: new Date().toISOString(),
        valor: tx.amount,
        formaPagamento: 'infinitepay',
        contaId: tx.contaId,
        dataPagamento: tx.date,
        transacaoBancoId: tx.id,
      };
      if (pIdx >= 0) c.payments[pIdx] = { ...c.payments[pIdx], ...pagamento };
      else c.payments.push(pagamento);
      c.updatedAt = new Date().toISOString();
      aplicados++;
    }
    saveTransacoesBanco();
    saveAssinaturaClientes();
    return res.json({ aplicados });
  });

  // POST /api/assinaturas/clientes/:id/contrato — upload do contrato (PDF)
  app.post("/api/assinaturas/clientes/:id/contrato", upload.single("file"), (req: Request, res: Response) => {
    const id = req.params.id as string;
    const idx = assinaturaClientes.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: "Cliente não encontrado" });
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });

    const fileName = `contrato-${id}-${Date.now()}.pdf`;
    const filePath = path.join(DATA_DIR, fileName);
    try { fs.writeFileSync(filePath, req.file.buffer); } catch {}
    assinaturaClientes[idx].contractFileName = fileName;
    assinaturaClientes[idx].updatedAt = new Date().toISOString();
    saveAssinaturaClientes();
    return res.json({ message: "Contrato salvo", fileName });
  });

  // GET /api/assinaturas/contratos/:fileName — baixar contrato
  app.get("/api/assinaturas/contratos/:fileName", (req: Request, res: Response) => {
    const fileName = req.params.fileName as string;
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Contrato não encontrado" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    return res.send(fs.readFileSync(filePath));
  });

  // ─── Planos ──────────────────────────────────────────────

  // GET /api/assinaturas/planos
  app.get("/api/assinaturas/planos", (_req: Request, res: Response) => {
    return res.json(assinaturaPlanos);
  });

  // POST /api/assinaturas/planos — criar plano
  app.post("/api/assinaturas/planos", (req: Request, res: Response) => {
    const { nome, valor, servicos } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: "Nome é obrigatório" });
    const id = `plano_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    assinaturaPlanos.push({
      id, nome: nome.trim(), valor: Number(valor) || 0,
      servicos: Array.isArray(servicos) ? servicos : [],
      ativo: true,
    });
    saveAssinaturaPlanos();
    return res.json({ id, message: "Plano criado" });
  });

  // PUT /api/assinaturas/planos/:id — editar plano
  app.put("/api/assinaturas/planos/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const idx = assinaturaPlanos.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: "Plano não encontrado" });
    const { nome, valor, servicos, ativo } = req.body;
    if (nome !== undefined) assinaturaPlanos[idx].nome = String(nome).trim();
    if (valor !== undefined) assinaturaPlanos[idx].valor = Number(valor);
    if (servicos !== undefined) assinaturaPlanos[idx].servicos = Array.isArray(servicos) ? servicos : [];
    if (ativo !== undefined) assinaturaPlanos[idx].ativo = !!ativo;
    saveAssinaturaPlanos();
    return res.json({ message: "Plano atualizado" });
  });

  // DELETE /api/assinaturas/planos/:id
  app.delete("/api/assinaturas/planos/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    assinaturaPlanos = assinaturaPlanos.filter(p => p.id !== id);
    saveAssinaturaPlanos();
    return res.json({ message: "Plano excluído" });
  });

  // GET /api/assinaturas/dashboard — resumo geral
  app.get("/api/assinaturas/dashboard", (_req: Request, res: Response) => {
    const active = assinaturaClientes.filter(c => c.status === "active");
    const inadimplentes = active.filter(c => getPaymentStatus(c) === "inadimplente");
    const monthlyRevenue = active.reduce((s, c) => s + (c.planValue || 0), 0);
    // Distribuição por plano
    const planMap: Record<string, number> = {};
    active.forEach(c => { planMap[c.plan] = (planMap[c.plan] || 0) + 1; });
    const planDistribution = Object.entries(planMap).map(([name, count]) => ({ name, count }));
    // Contratos vencendo nos próximos 30 dias
    const now = new Date();
    const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
    const vencendoEmBreve = active.filter(c => {
      const end = new Date(c.contractEndDate);
      return end >= now && end <= in30;
    });

    // ─── Comissões por vendedor ───
    // BÔNUS ÚNICO: 20% (configurável) sobre a 1ª parcela paga. Não recorre.
    // - comissaoPagaRS:    total já creditado (1ª parcela paga)
    // - comissaoPendenteRS: bônus de vendas onde a 1ª parcela AINDA não foi paga
    // - comissaoMesAtualRS: bônus pagos NESTE mês (1ª parcela quitada em mês atual)
    const pctPadrao = Number(storeData.settings?.comissaoPlanoPadraoPct ?? 20);
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    type CommBucket = {
      seller: string;
      assinantes: number;
      mesesPagos: number;
      comissaoAcumuladaRS: number;   // = comissaoPagaRS (mantém nome pra retrocompat UI)
      comissaoPendenteRS: number;
      comissaoMesAtualRS: number;
      receitaMensalRS: number;
    };
    const byVendedor = new Map<string, CommBucket>();
    for (const c of assinaturaClientes) {
      const seller = (c.seller || "").trim();
      if (!seller) continue;
      const pct = Number(c.commissionPct ?? pctPadrao);
      const pagos = c.payments.filter(p => p.pago).length;
      const { comissaoBonusRS, comissaoPaga, primeiraParcelaMes } = calcularComissao(c, pct);
      const pgPrimeira = c.payments.find(p => p.mes === primeiraParcelaMes);
      const bonusFoiNesteMes = comissaoPaga && pgPrimeira?.pagoEm?.slice(0, 7) === mesAtual;
      const key = seller.toLowerCase();
      const b = byVendedor.get(key) || {
        seller, assinantes: 0, mesesPagos: 0,
        comissaoAcumuladaRS: 0, comissaoPendenteRS: 0,
        comissaoMesAtualRS: 0, receitaMensalRS: 0,
      };
      b.assinantes += 1;
      b.mesesPagos += pagos;
      if (comissaoPaga) b.comissaoAcumuladaRS += comissaoBonusRS;
      else b.comissaoPendenteRS += comissaoBonusRS;
      if (bonusFoiNesteMes) b.comissaoMesAtualRS += comissaoBonusRS;
      if (c.status === 'active') b.receitaMensalRS += (c.planValue || 0);
      byVendedor.set(key, b);
    }
    const rankingComissoes = Array.from(byVendedor.values())
      .sort((a, b) => b.comissaoAcumuladaRS - a.comissaoAcumuladaRS);
    const totalComissaoMesAtual = rankingComissoes.reduce((s, r) => s + r.comissaoMesAtualRS, 0);
    const totalComissaoAcumulada = rankingComissoes.reduce((s, r) => s + r.comissaoAcumuladaRS, 0);
    const semVendedor = assinaturaClientes.filter(c => !c.seller || !c.seller.trim()).length;

    return res.json({
      totalAssinantes: assinaturaClientes.length,
      ativos: active.length,
      inadimplentes: inadimplentes.length,
      cancelados: assinaturaClientes.filter(c => c.status === "cancelled").length,
      monthlyRevenue,
      planDistribution,
      vencendoEmBreve: vencendoEmBreve.length,
      // novos
      pctPlanoPadrao: pctPadrao,
      rankingComissoes,
      totalComissaoMesAtual,
      totalComissaoAcumulada,
      assinantesSemVendedor: semVendedor,
    });
  });

  // ─── TELEGRAM BOT ────────────────────────────────────────
  // GET /api/telegram/status — verifica se o bot está configurado
  app.get("/api/telegram/status", (_req: Request, res: Response) => {
    res.json({
      configured: isTelegramConfigured(),
      chatId: getChatId(),
      schedules: {
        morning: "08:00 (terça a sábado)",
        evening: "20:00 (terça a sábado)",
      },
    });
  });

  // POST /api/telegram/testar — envia mensagem de teste
  app.post("/api/telegram/testar", async (_req: Request, res: Response) => {
    const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const msg = `✅ <b>Bot @fredgreco_bot conectado!</b>\n\nTeste enviado em ${agora}\nChat ID: <code>${getChatId()}</code>\n\nA partir de agora você vai receber:\n☀️ <b>08:00</b> — Previsão do dia + meta\n🌙 <b>20:00</b> — Fechamento + performance\n\nTudo funcionando 👉`;
    const r = await enviarMensagem(msg);
    return res.json(r);
  });

  // ─── /api/contas-mensais — CRUD das despesas recorrentes ─────────────────
  // Listadas na mensagem matinal do Telegram quando vencem hoje (ou hoje é o
  // último dia útil antes do vencimento real).
  app.get("/api/contas-mensais", async (_req: Request, res: Response) => {
    try {
      const contas = await listarContasMensais();
      return res.json(contas);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "erro ao listar contas" });
    }
  });

  app.post("/api/contas-mensais", async (req: Request, res: Response) => {
    try {
      const { nome, diaVencimento, valor, observacao } = req.body || {};
      if (!nome || typeof nome !== "string" || !nome.trim()) {
        return res.status(400).json({ error: "Nome é obrigatório." });
      }
      const dia = Number(diaVencimento);
      if (!Number.isFinite(dia) || dia < 1 || dia > 31) {
        return res.status(400).json({ error: "Dia de vencimento deve estar entre 1 e 31." });
      }
      const valorNum = valor === "" || valor === null || valor === undefined ? null : Number(valor);
      if (valorNum !== null && !Number.isFinite(valorNum)) {
        return res.status(400).json({ error: "Valor inválido." });
      }
      const nova = await criarContaMensal({
        nome: String(nome),
        diaVencimento: dia,
        valor: valorNum,
        observacao: typeof observacao === "string" ? observacao : undefined,
      });
      return res.status(201).json(nova);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "erro ao criar conta" });
    }
  });

  app.put("/api/contas-mensais/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { nome, diaVencimento, valor, observacao, ativa } = req.body || {};
      const patch: any = {};
      if (typeof nome === "string" && nome.trim()) patch.nome = nome.trim();
      if (diaVencimento !== undefined) {
        const dia = Number(diaVencimento);
        if (!Number.isFinite(dia) || dia < 1 || dia > 31) {
          return res.status(400).json({ error: "Dia de vencimento deve estar entre 1 e 31." });
        }
        patch.diaVencimento = dia;
      }
      if (valor !== undefined) {
        const valorNum = valor === "" || valor === null ? null : Number(valor);
        if (valorNum !== null && !Number.isFinite(valorNum)) {
          return res.status(400).json({ error: "Valor inválido." });
        }
        patch.valor = valorNum;
      }
      if (observacao !== undefined) {
        patch.observacao = typeof observacao === "string" ? observacao : undefined;
      }
      if (typeof ativa === "boolean") patch.ativa = ativa;

      const atualizada = await atualizarContaMensal(id, patch);
      if (!atualizada) return res.status(404).json({ error: "Conta não encontrada." });
      return res.json(atualizada);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "erro ao atualizar conta" });
    }
  });

  app.delete("/api/contas-mensais/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const ok = await deletarContaMensal(id);
      if (!ok) return res.status(404).json({ error: "Conta não encontrada." });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "erro ao deletar conta" });
    }
  });

  // ─── Helper: acumulado da SEMANA (ter→ontem) e do MÊS (dia 1→ontem) ─────
  // Dias úteis da Greco = terça a sábado (exclui dom/seg) + feriados nacionais.
  // Soma `faturamento.total` dos snapshots diários já fechados (não inclui hoje).
  // Se um dia não tem snapshot ainda, simplesmente não conta — evita inflar.
  async function montarAcumuladoSemanaMes(): Promise<{
    semana: { dias: number; total: number; inicio: string; fim: string };
    mes:    { dias: number; total: number; inicio: string; fim: string };
  }> {
    // Feriados nacionais (data fixa) — mesma lógica do contasMensais
    const feriadosBR = (ano: number): Set<string> => new Set([
      `${ano}-01-01`, `${ano}-04-21`, `${ano}-05-01`, `${ano}-09-07`,
      `${ano}-10-12`, `${ano}-11-02`, `${ano}-11-15`, `${ano}-11-20`, `${ano}-12-25`,
    ]);

    // Hoje em SP
    const tzFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    });
    const partsHoje = tzFmt.formatToParts(new Date());
    const pick = (t: string) => partsHoje.find(p => p.type === t)?.value || "";
    const hojeYMD = `${pick("year")}-${pick("month")}-${pick("day")}`;
    const ano = Number(pick("year"));
    const mes = pick("month");
    const feriadosSet = new Set<string>([...feriadosBR(ano), ...feriadosBR(ano + 1)]);

    // getDay de uma YMD interpretada como meia-noite SP (é robusto pra fuso)
    const dowYMD = (ymdStr: string): number => {
      // Cria Date em SP usando string ISO + offset −3h (BRT, sem horário de verão desde 2019)
      const d = new Date(`${ymdStr}T12:00:00-03:00`);
      return d.getUTCDay(); // 0=dom … 6=sáb. Como pegamos meio-dia, fuso não quebra.
    };
    const ehDiaUtilGreco = (ymdStr: string): boolean => {
      const dow = dowYMD(ymdStr);
      if (dow === 0 || dow === 1) return false;          // dom/seg fechados
      if (feriadosSet.has(ymdStr)) return false;
      return true;
    };

    // ── Janela da semana: terça anterior (ou da semana corrente) até ontem
    // Regra: a "semana" começa sempre na terça-feira da semana corrente em SP.
    // Se hoje é dom/seg, mostramos a semana que acabou sábado.
    const ontemYMD = ymdAddDays(hojeYMD, -1);
    const dowHoje = dowYMD(hojeYMD);
    // Quantos dias voltar de hoje até a última terça (inclusive)
    // dow: 0=dom 1=seg 2=ter 3=qua 4=qui 5=sex 6=sáb
    const diasDesdeTerca = (dowHoje + 5) % 7; // 2→0 3→1 4→2 5→3 6→4 0→5 1→6
    const inicioSemana = ymdAddDays(hojeYMD, -diasDesdeTerca);

    let totalSemana = 0; let diasSemana = 0;
    let cur = inicioSemana;
    while (cur < hojeYMD) { // não inclui hoje
      if (ehDiaUtilGreco(cur)) {
        const snap = await getSnapshot(cur).catch(() => null);
        if (snap && snap.fonte !== "vazio" && snap.faturamento?.total > 0) {
          totalSemana += snap.faturamento.total;
          diasSemana++;
        }
      }
      cur = ymdAddDays(cur, 1);
    }

    // ── Janela do mês: dia 01 do mês corrente até ontem
    const inicioMes = `${ano}-${mes}-01`;
    const mesAtual = `${ano}-${mes}`;

    // Se existe "mes-oficial" (acumulado Trinks via e-mail), usa como BASE
    // e soma somente os dias APÓS dataReferencia até ontem.
    const mesOficial = await kvGet<{ dataReferencia: string; totalAcumulado: number }>(`trinks_mes_oficial:${mesAtual}`).catch(() => null);

    let totalMes = 0; let diasMes = 0;
    let inicioContagemDiaria = inicioMes;
    if (mesOficial && mesOficial.dataReferencia && Number.isFinite(mesOficial.totalAcumulado)) {
      totalMes = mesOficial.totalAcumulado;
      // Conta os dias úteis de 01 até dataReferencia como "já incluídos"
      let c = inicioMes;
      while (c <= mesOficial.dataReferencia) {
        if (ehDiaUtilGreco(c)) diasMes++;
        c = ymdAddDays(c, 1);
      }
      // Daqui em diante, somar snapshots a partir do dia seguinte à dataReferencia
      inicioContagemDiaria = ymdAddDays(mesOficial.dataReferencia, 1);
    }

    cur = inicioContagemDiaria;
    while (cur <= ontemYMD) {
      if (ehDiaUtilGreco(cur)) {
        const snap = await getSnapshot(cur).catch(() => null);
        if (snap && snap.fonte !== "vazio" && snap.faturamento?.total > 0) {
          totalMes += snap.faturamento.total;
          diasMes++;
        }
      }
      cur = ymdAddDays(cur, 1);
    }

    return {
      semana: { dias: diasSemana, total: totalSemana, inicio: inicioSemana, fim: ontemYMD },
      mes:    { dias: diasMes,    total: totalMes,    inicio: inicioMes,    fim: ontemYMD },
    };
  }

  // ─── Helper: monta lista de pagamentos a avisar HOJE ─────────────────────
  async function montarPagamentosHoje(): Promise<PagamentoHojeItem[]> {
    const itens: PagamentoHojeItem[] = [];
    try {
      const contas = await contasParaAvisarHoje();
      for (const c of contas) {
        itens.push({
          tipo: "conta",
          nome: c.nome,
          valor: c.valor,
          observacao: c.observacao,
        });
      }
      const equipe = pagamentosEquipeParaAvisarHoje();
      for (const e of equipe) {
        itens.push({
          tipo: "equipe",
          nome: e.tipo === "comissao-mensal" ? "Fechamento mensal (dia 01)" : "Vale dos barbeiros (dia 15)",
          observacao: e.descricao,
        });
      }
    } catch (err: any) {
      log(`[pagamentosHoje] erro: ${err?.message}`, "telegram");
    }
    return itens;
  }

  // POST /api/telegram/resumo-manha — monta e envia resumo matinal agora
  // Única mensagem diária do Greco Control (08h ter-sáb).
  // Inclui: fechamento ontem + previsão hoje (serviços + Clube Greco) + pagamentos.
  app.post("/api/telegram/resumo-manha", async (_req: Request, res: Response) => {
    try {
      const [hoje, ontem, amanhaData, pagamentos, acumulado] = await Promise.all([
        calcularHojeCompleto(),
        calcularOntemFechado().catch(() => null),
        calcularAmanha().catch(() => null),
        montarPagamentosHoje(),
        montarAcumuladoSemanaMes().catch(() => null),
      ]);
      const msg = montarResumoManha(hoje, amanhaData, ontem, pagamentos, acumulado);
      const r = await enviarMensagem(msg);
      return res.json({ ...r, enviado: r.ok, pagamentos });
    } catch (err: any) {
      // Fallback: avisa no Telegram que o sistema está vivo mas a Trinks falhou
      const isRate = err?.status === 429 || /limite|429|rate/i.test(err?.message || "");
      const motivo = isRate
        ? "limite de requisições da Trinks excedido"
        : `falha ao consultar Trinks (${err?.message || "erro desconhecido"})`;
      const aviso = `⚠️ *Resumo da manhã indisponível*\n\nNão foi possível gerar o resumo agora: ${motivo}.\n\nO sistema continua rodando — vou tentar novamente nos próximos disparos. Se quiser, abra o Dashboard para conferir os números do CSV.`;
      const r = await enviarMensagem(aviso).catch(() => ({ ok: false }));
      return res.status(200).json({ ok: false, fallbackEnviado: !!(r as any).ok, error: err.message });
    }
  });

  // POST /api/telegram/resumo-noite — monta e envia fechamento agora
  // (Bloco de produtos sem giro foi removido a pedido do usuário.)
  app.post("/api/telegram/resumo-noite", async (_req: Request, res: Response) => {
    try {
      const hoje = await calcularHojeCompleto();
      const msg = montarResumoNoite(hoje);
      const r = await enviarMensagem(msg);
      return res.json({ ...r, enviado: r.ok });
    } catch (err: any) {
      // Fallback: avisa no Telegram que o sistema está vivo mas a Trinks falhou
      const isRate = err?.status === 429 || /limite|429|rate/i.test(err?.message || "");
      const motivo = isRate
        ? "limite de requisições da Trinks excedido"
        : `falha ao consultar Trinks (${err?.message || "erro desconhecido"})`;
      const aviso = `⚠️ *Resumo da noite indisponível*\n\nNão foi possível fechar o dia agora: ${motivo}.\n\nO sistema continua rodando — amanhã cedo tento de novo. Para conferir o dia, abra o Dashboard (dados do CSV).`;
      const r = await enviarMensagem(aviso).catch(() => ({ ok: false }));
      return res.status(200).json({ ok: false, fallbackEnviado: !!(r as any).ok, error: err.message });
    }
  });

  // ─── EQUIPE: helpers de janela de tempo (TZ America/Sao_Paulo) ─────
  function ymdHoje(): string {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    });
    return fmt.format(new Date());
  }
  // Funcionamento: terça a sábado. Semana útil = terça..sábado da semana atual.
  function janelaSemanaUtil(refYMD?: string): { dataInicio: string; dataFim: string } {
    const hoje = refYMD || ymdHoje();
    const [y, m, d] = hoje.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    const dow = dt.getUTCDay(); // 0=dom, 1=seg, ..., 6=sab
    let offsetTerca = dow - 2;
    if (offsetTerca < 0) offsetTerca += 7;
    const dataInicio = ymdAddDays(hoje, -offsetTerca);
    return { dataInicio, dataFim: hoje };
  }
  function janelaMesAtual(refYMD?: string): { dataInicio: string; dataFim: string; mes: string } {
    const hoje = refYMD || ymdHoje();
    const [y, m] = hoje.split("-");
    return { dataInicio: `${y}-${m}-01`, dataFim: hoje, mes: `${y}-${m}` };
  }
  function contarDiasUteis(dataInicio: string, dataFim: string): number {
    const [y1, m1, d1] = dataInicio.split("-").map(Number);
    const [y2, m2, d2] = dataFim.split("-").map(Number);
    const ini = Date.UTC(y1, m1 - 1, d1, 12);
    const fim = Date.UTC(y2, m2 - 1, d2, 12);
    let count = 0;
    for (let t = ini; t <= fim; t += 86400000) {
      const dow = new Date(t).getUTCDay();
      if (dow >= 2 && dow <= 6) count += 1;
    }
    return count;
  }
  function ultimoDiaDoMes(ymd: string): string {
    const [y, m] = ymd.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }

  // ─── EQUIPE: endpoints CRUD de metas ──────────────────────────────
  // ─── Configuração financeira (taxa cartão global) ──────────
  app.get("/api/config/financeira", async (_req: Request, res: Response) => {
    try {
      const cfg = await getConfigFin();
      return res.json({ ok: true, config: cfg });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put("/api/config/financeira", async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      // Aceita atualizações parciais. Se um campo não vier, mantém o valor atual.
      const patch: any = {};
      if (body.taxaCartaoPct !== undefined) patch.taxaCartaoPct = Number(body.taxaCartaoPct);
      if (body.cadeiras !== undefined) patch.cadeiras = Number(body.cadeiras);
      if (body.horasDia !== undefined) patch.horasDia = Number(body.horasDia);
      if (body.diasMes !== undefined) patch.diasMes = Number(body.diasMes);
      if (body.ocupacaoPct !== undefined) patch.ocupacaoPct = Number(body.ocupacaoPct);
      if (body.impostoPct !== undefined) patch.impostoPct = Number(body.impostoPct);
      const cfg = await setConfigFin(patch);
      // Invalida cache de equipe (por período + completo) pra refletir nova taxa imediatamente
      try {
        invalidateCache("equipe-desempenho-completo");
        invalidateCache("equipe-periodo:");
      } catch { /* ignore */ }
      return res.json({ ok: true, config: cfg });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── CONCILIAÇÃO: órfãs + batimento diário caixa-vs-equipe ──────────────────
  // Considera "órfão" um item (serviço ou produto) que veio do Trinks
  // SEM profissional vinculado e que ainda não tem override manual (atribuída
  // ou marcada como skip). Também retorna o batimento diário total Trinks vs
  // soma da equipe para evidenciar divergências.
  app.get("/api/conciliacao/orfas", async (req: Request, res: Response) => {
    try {
      const mes = String(req.query.mes || "").match(/^\d{4}-\d{2}$/)
        ? String(req.query.mes)
        : ymdHoje().slice(0, 7);
      const dataInicio = `${mes}-01`;
      const hoje = ymdHoje();
      // Se mês atual: até hoje. Senão: até último dia do mês.
      const dataFim = mes === hoje.slice(0, 7) ? hoje : ultimoDiaDoMes(`${mes}-01`);
      const transFim = ymdAddDays(dataFim, 1);

      const [transData, profData, overrides] = await Promise.all([
        trinksFetchAll("transacoes", { dataInicio, dataFim: transFim }).catch(() => [] as any[]),
        trinksFetchAll("profissionais").catch(() => [] as any[]),
        getOverrides(),
      ]);
      const transLista = Array.isArray(transData) ? transData : (transData?.data || []);
      const profLista = Array.isArray(profData) ? profData : (profData?.data || []);

      // Mapa id Trinks -> nome (só IDs novos cadastrados)
      const profNome = new Map<string, string>();
      profLista.forEach((p: any) => {
        const id = String(p.id || "");
        const nome = (p.nome || p.apelido || "").trim();
        if (id && nome) profNome.set(id, nome);
      });

      // Agrega órfãs e batimento diário
      type Orfa = {
        transacaoId: string;
        dataHora: string;
        cliente: string;
        tipo: "servico" | "produto";
        index: number;
        descricao: string;
        valor: number;
        // Se houver override aplicado, mostra o atual
        overrideProfId?: string;
        overrideProfNome?: string;
        overrideSkip?: boolean;
      };
      const orfas: Orfa[] = [];
      const batPorDia = new Map<string, { trinksTotal: number; trinksCount: number }>();

      transLista.forEach((t: any) => {
        const dia = String(t.dataHora || "").slice(0, 10);
        const total = Number(t.totalPagar || 0);
        const transId = String(t.id || "");
        if (dia) {
          const cur = batPorDia.get(dia) || { trinksTotal: 0, trinksCount: 0 };
          cur.trinksTotal += total;
          cur.trinksCount += 1;
          batPorDia.set(dia, cur);
        }
        const nomeCli = String(t.cliente?.nome || "").trim();

        (t.servicos || []).forEach((s: any, i: number) => {
          const original = String(s.idProfissionalQueRealizouServico || s.IdProfissionalQueRealizouOServico || "");
          if (original) return; // tem dono, não é órfã
          const valor = Number(s.preco || s.valor || 0);
          if (valor <= 0) return; // ignora itens zerados (cortesia interna)
          const ov = lookupOverride(overrides, transId, "s", i);
          orfas.push({
            transacaoId: transId,
            dataHora: t.dataHora || "",
            cliente: nomeCli,
            tipo: "servico",
            index: i,
            descricao: s.nome || s.descricao || s.servico?.nome || "Serviço",
            valor,
            overrideProfId: ov?.profissionalId || undefined,
            overrideProfNome: ov?.profissionalId ? profNome.get(ov.profissionalId) : undefined,
            overrideSkip: ov?.skip || undefined,
          });
        });
        (t.produtos || []).forEach((p: any, i: number) => {
          const original = String(p.IdProfissionalQueRealizouAVenda || p.idProfissionalQueRealizouAVenda || "");
          if (original) return;
          const qtd = Number(p.quantidade || 1);
          const valor = Number(p.valorUnitario || p.valor || 0) * qtd;
          if (valor <= 0) return;
          const ov = lookupOverride(overrides, transId, "p", i);
          orfas.push({
            transacaoId: transId,
            dataHora: t.dataHora || "",
            cliente: nomeCli,
            tipo: "produto",
            index: i,
            descricao: p.descricao || p.produto?.nome || p.nome || "Produto",
            valor,
            overrideProfId: ov?.profissionalId || undefined,
            overrideProfNome: ov?.profissionalId ? profNome.get(ov.profissionalId) : undefined,
            overrideSkip: ov?.skip || undefined,
          });
        });
      });

      // Soma da equipe por dia: reagrega aqui só com totalPagar das transações
      // que têm ao menos um item com profId (original ou via override).
      // Mais barato que rodar calcularPeriodoPorProfissional só pra batimento.
      const equipePorDia = new Map<string, number>();
      transLista.forEach((t: any) => {
        const dia = String(t.dataHora || "").slice(0, 10);
        const total = Number(t.totalPagar || 0);
        if (!dia || total === 0) return;
        // Só conta no "equipe" se tem ao menos 1 item com profId resolvido (com ou sem override)
        const transId = String(t.id || "");
        let temDono = false;
        (t.servicos || []).forEach((s: any, i: number) => {
          const original = String(s.idProfissionalQueRealizouServico || s.IdProfissionalQueRealizouOServico || "");
          if (original) { temDono = true; return; }
          const ov = lookupOverride(overrides, transId, "s", i);
          if (ov && !ov.skip && ov.profissionalId) temDono = true;
        });
        if (!temDono) {
          (t.produtos || []).forEach((p: any, i: number) => {
            const original = String(p.IdProfissionalQueRealizouAVenda || p.idProfissionalQueRealizouAVenda || "");
            if (original) { temDono = true; return; }
            const ov = lookupOverride(overrides, transId, "p", i);
            if (ov && !ov.skip && ov.profissionalId) temDono = true;
          });
        }
        if (!temDono) return;
        equipePorDia.set(dia, (equipePorDia.get(dia) || 0) + total);
      });

      const diasSet = new Set<string>();
      Array.from(batPorDia.keys()).forEach(d => diasSet.add(d));
      Array.from(equipePorDia.keys()).forEach(d => diasSet.add(d));
      const dias = Array.from(diasSet).sort();
      const batimento = dias.map(dia => {
        const tk = batPorDia.get(dia) || { trinksTotal: 0, trinksCount: 0 };
        const eq = equipePorDia.get(dia) || 0;
        return {
          dia,
          trinksTotal: Math.round(tk.trinksTotal * 100) / 100,
          trinksCount: tk.trinksCount,
          equipeTotal: Math.round(eq * 100) / 100,
          diferenca: Math.round((tk.trinksTotal - eq) * 100) / 100,
        };
      });

      // Conta de órfãs pendentes (sem override válido)
      const pendentes = orfas.filter(o => !o.overrideProfId && !o.overrideSkip).length;

      return res.json({
        ok: true,
        mes,
        periodo: { dataInicio, dataFim },
        orfas,
        pendentes,
        totalOrfas: orfas.length,
        valorOrfas: Math.round(orfas.reduce((s, o) => s + o.valor, 0) * 100) / 100,
        batimento,
        totaisPeriodo: {
          trinksTotal: Math.round(batimento.reduce((s, b) => s + b.trinksTotal, 0) * 100) / 100,
          equipeTotal: Math.round(batimento.reduce((s, b) => s + b.equipeTotal, 0) * 100) / 100,
          diferenca: Math.round(batimento.reduce((s, b) => s + b.diferenca, 0) * 100) / 100,
        },
        // util p/ frontend popular o select de profissionais
        profissionais: profLista.map((p: any) => ({
          id: String(p.id),
          nome: (p.nome || p.apelido || "").trim(),
        })).filter((p: any) => p.nome).sort((a: any, b: any) => a.nome.localeCompare(b.nome)),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      log(`[conciliacao/orfas] erro: ${err.message}`, "conciliacao");
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/conciliacao/status?mes=YYYY-MM — leve, só conta. Usado para gate.
  app.get("/api/conciliacao/status", async (req: Request, res: Response) => {
    try {
      const mes = String(req.query.mes || "").match(/^\d{4}-\d{2}$/)
        ? String(req.query.mes)
        : ymdHoje().slice(0, 7);
      const dataInicio = `${mes}-01`;
      const hoje = ymdHoje();
      const dataFim = mes === hoje.slice(0, 7) ? hoje : ultimoDiaDoMes(`${mes}-01`);
      const transFim = ymdAddDays(dataFim, 1);
      const [transData, overrides] = await Promise.all([
        trinksFetchAll("transacoes", { dataInicio, dataFim: transFim }).catch(() => [] as any[]),
        getOverrides(),
      ]);
      const transLista = Array.isArray(transData) ? transData : (transData?.data || []);
      let pendentes = 0;
      let valorPendente = 0;
      transLista.forEach((t: any) => {
        const transId = String(t.id || "");
        (t.servicos || []).forEach((s: any, i: number) => {
          const original = String(s.idProfissionalQueRealizouServico || s.IdProfissionalQueRealizouOServico || "");
          if (original) return;
          const valor = Number(s.preco || s.valor || 0);
          if (valor <= 0) return;
          const ov = lookupOverride(overrides, transId, "s", i);
          if (ov && (ov.skip || ov.profissionalId)) return;
          pendentes += 1; valorPendente += valor;
        });
        (t.produtos || []).forEach((p: any, i: number) => {
          const original = String(p.IdProfissionalQueRealizouAVenda || p.idProfissionalQueRealizouAVenda || "");
          if (original) return;
          const qtd = Number(p.quantidade || 1);
          const valor = Number(p.valorUnitario || p.valor || 0) * qtd;
          if (valor <= 0) return;
          const ov = lookupOverride(overrides, transId, "p", i);
          if (ov && (ov.skip || ov.profissionalId)) return;
          pendentes += 1; valorPendente += valor;
        });
      });
      return res.json({
        ok: true,
        mes,
        pendentes,
        valorPendente: Math.round(valorPendente * 100) / 100,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/conciliacao/atribuir — grava override de um item específico
  app.put("/api/conciliacao/atribuir", async (req: Request, res: Response) => {
    try {
      const { transacaoId, tipo, index, profissionalId, skip } = req.body || {};
      if (!transacaoId) return res.status(400).json({ ok: false, error: "transacaoId obrigatório" });
      if (tipo !== "s" && tipo !== "p") return res.status(400).json({ ok: false, error: "tipo deve ser 's' ou 'p'" });
      const idx = Number(index);
      if (!isFinite(idx) || idx < 0) return res.status(400).json({ ok: false, error: "index inválido" });
      if (!skip && !profissionalId) return res.status(400).json({ ok: false, error: "profissionalId obrigatório quando skip=false" });
      const item = await setOverride(
        String(transacaoId),
        tipo as "s" | "p",
        idx,
        skip ? "" : String(profissionalId),
        { skip: !!skip },
      );
      // Invalida caches de equipe pra refletir override imediatamente
      try {
        invalidateCache("equipe-desempenho-completo");
        invalidateCache("equipe-periodo:");
      } catch { /* ignore */ }
      return res.json({ ok: true, override: item });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/conciliacao/atribuir — remove override (volta a ser órfão)
  app.delete("/api/conciliacao/atribuir", async (req: Request, res: Response) => {
    try {
      const { transacaoId, tipo, index } = req.body || {};
      if (!transacaoId) return res.status(400).json({ ok: false, error: "transacaoId obrigatório" });
      if (tipo !== "s" && tipo !== "p") return res.status(400).json({ ok: false, error: "tipo deve ser 's' ou 'p'" });
      const idx = Number(index);
      if (!isFinite(idx) || idx < 0) return res.status(400).json({ ok: false, error: "index inválido" });
      await deleteOverride(String(transacaoId), tipo as "s" | "p", idx);
      try {
        invalidateCache("equipe-desempenho-completo");
        invalidateCache("equipe-periodo:");
      } catch { /* ignore */ }
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/metas-profissional", async (_req: Request, res: Response) => {
    try {
      const [metas, profData] = await Promise.all([
        getAllMetas(),
        trinksFetchAll("profissionais").catch(() => [] as any[]),
      ]);
      const profLista = Array.isArray(profData) ? profData : (profData?.data || []);
      const lista: any[] = profLista.map((p: any) => {
        const id = String(p.id);
        const nome = (p.nome || p.apelido || "").trim();
        const meta = metas[id] || {
          profissionalId: id, nome, metaReais: 0, metaAtendimentos: 0,
          telegramChatId: "", ativoEnvio: false, atualizadoEm: "",
          pctServico: 0, pctProduto: 0, pctPlano: 0,
        };
        return { ...meta, nome: nome || meta.nome };
      });
      const idsTrinks = new Set(profLista.map((p: any) => String(p.id)));
      Object.values(metas).forEach((m) => { if (!idsTrinks.has(m.profissionalId)) lista.push(m); });
      lista.sort((a: any, b: any) => (a.nome || "").localeCompare(b.nome || ""));
      return res.json({ metas: lista });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put("/api/metas-profissional/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const body = req.body || {};
      // Helper para clamp 0..100 nos percentuais
      const clampPct = (v: any): number => {
        const n = Number(v);
        if (!isFinite(n) || isNaN(n)) return 0;
        return Math.max(0, Math.min(100, n));
      };
      const modoIn = String(body.modoComissao || "global").toLowerCase();
      const modoSan: 'bruto' | 'liquido' | 'global' =
        modoIn === 'bruto' || modoIn === 'liquido' ? (modoIn as 'bruto' | 'liquido') : 'global';
      const meta = await upsertMeta({
        profissionalId: id,
        nome: body.nome || "",
        metaReais: Number(body.metaReais || 0),
        metaAtendimentos: Number(body.metaAtendimentos || 0),
        telegramChatId: String(body.telegramChatId || "").trim(),
        ativoEnvio: !!body.ativoEnvio,
        pctServico: clampPct(body.pctServico),
        pctProduto: clampPct(body.pctProduto),
        pctPlano: clampPct(body.pctPlano),
        pctBonusExcedente: clampPct(body.pctBonusExcedente),
        salarioFixo: Math.max(0, Number(body.salarioFixo) || 0),
        modoComissao: modoSan,
      });
      return res.json({ ok: true, meta });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete("/api/metas-profissional/:id", async (req: Request, res: Response) => {
    try {
      await deleteMeta(String(req.params.id));
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // v20 — APIs de PAGAMENTO
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/produtos/sem-comissao — lista produtos do Trinks + flag isSemComissao
  app.get("/api/produtos/sem-comissao", async (_req: Request, res: Response) => {
    try {
      const [produtos, semComissao] = await Promise.all([
        trinksFetchAll("produtos").catch(() => [] as any[]),
        getProdutosSemComissao(),
      ]);
      const lista = (produtos || []).map((p: any) => ({
        id: String(p.id),
        nome: p.nome || p.descricao || "—",
        valorVenda: Number(p.valorVenda || p.valorUnitario || 0),
        isSemComissao: semComissao.has(String(p.id)),
      })).sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));
      const sugestoes = sugerirSemComissao(produtos || []);
      return res.json({
        ok: true,
        produtos: lista,
        ids: Array.from(semComissao),
        sugestoes,
        total: lista.length,
        totalSemComissao: lista.filter((p: any) => p.isSemComissao).length,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/produtos/sem-comissao — substitui a lista completa de IDs
  app.put("/api/produtos/sem-comissao", async (req: Request, res: Response) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const lista = await setProdutosSemComissao(ids.map(String));
      // Invalida caches de equipe pois a base de comissão muda.
      try {
        invalidateCache("equipe-desempenho-completo");
        invalidateCache("equipe-periodo:");
      } catch { /* ignore */ }
      return res.json({ ok: true, ids: lista, total: lista.length });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Helper local: calcula linha de pagamento de um profissional para o mês.
  // Retorna estrutura pronta para a UI/PDF.
  // ─── D2 (v42.3): comissão de SERVIÇOS canônica = ranking CSV × categoria ──
  // Quando EXISTE ranking importado do mês, a comissão de serviços vem do ranking
  // (regra v42 — reusa `comissaoServicosRanking`, NÃO duplica). Sem ranking →
  // cálculo ao vivo (`baseComissaoServicos × pctServico`). Mesma filosofia de
  // janela-de-tempo do mesService: a fonte congelada (CSV) assume assim que existe.
  // Cache por mês, limpo no import confirm. Match nome→ranking por nome completo,
  // apelido (antes do hífen) e resto (depois do hífen) — cobre o join metas↔ranking.
  const _rankComissaoCache = new Map<string, { keys: Map<string, number>; temRanking: boolean }>();
  const normRank = (s: any) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  async function getRankComissaoMap(mes: string): Promise<{ keys: Map<string, number>; temRanking: boolean }> {
    const hit = _rankComissaoCache.get(mes);
    if (hit) return hit;
    const keys = new Map<string, number>();
    let temRanking = false;
    try {
      const rk: any = await kvGet(trinksImport.kvKeyFor("ranking", mes));
      const profs = rk?.periodos?.[0]?.profissionais || [];
      if (Array.isArray(profs) && profs.length > 0) {
        temRanking = true;
        for (const p of profs) {
          const r = comissaoServicosRanking(p.profissional, Number(p.totalServicos || 0));
          const partes = String(p.profissional || "").split(/[-–—]/);
          const full = normRank(p.profissional);
          const apel = normRank(partes[0]);
          const resto = normRank(partes.slice(1).join(" "));
          // nomes completos (full/resto) são únicos; apelido só preenche se livre.
          if (full && !keys.has(full)) keys.set(full, r.comissao);
          if (resto && !keys.has(resto)) keys.set(resto, r.comissao);
          if (apel && !keys.has(apel)) keys.set(apel, r.comissao);
        }
      }
    } catch { /* sem ranking → cálculo ao vivo */ }
    const out = { keys, temRanking };
    _rankComissaoCache.set(mes, out);
    return out;
  }

  // ─── Bloco 1 (v42.4): per-profissional do mês a partir do RANKING CSV ──
  // Fonte única e LIMPA (deduplicada por id) pra Equipe/Metas quando existe
  // ranking do mês. Receita = `Valor Total` do ranking; comissão de serviços
  // reusa `comissaoServicosRanking` (v42, sem duplicar). Join nome→id das metas
  // por nome completo (após hífen) / apelido. Retorna null se não há ranking →
  // chamador usa o cálculo ao vivo (preserva o dia corrente antes do export).
  async function montarEquipeDeRanking(
    mes: string,
    metas: Record<string, any>,
  ): Promise<null | { byId: Map<string, any>; totais: any }> {
    let rk: any = null;
    try { rk = await kvGet(trinksImport.kvKeyFor("ranking", mes)); } catch {}
    const profs = rk?.periodos?.[0]?.profissionais;
    if (!Array.isArray(profs) || profs.length === 0) return null;

    // mapa norm(meta.nome) → id (+ primeiro token) pra resolver o id real
    const metaPorNome = new Map<string, string>();
    for (const mt of Object.values(metas) as any[]) {
      const n = normRank(mt?.nome); if (!n) continue;
      if (!metaPorNome.has(n)) metaPorNome.set(n, mt.profissionalId);
      const tok = n.split(/\s+/)[0]; if (tok && !metaPorNome.has(tok)) metaPorNome.set(tok, mt.profissionalId);
    }

    const byId = new Map<string, any>();
    const tot = { faturamento: 0, atendimentos: 0, servicosBruto: 0, servicosLiquido: 0, produtosBruto: 0, produtosLiquido: 0, planoReais: 0, novosClientes: 0, clientesDistintos: 0, _retPond: 0 };
    for (const p of profs) {
      const partes = String(p.profissional || "").split(/[-–—]/);
      const apel = normRank(partes[0]);
      const resto = normRank(partes.slice(1).join(" "));
      const id = metaPorNome.get(resto) || metaPorNome.get(apel)
        || metaPorNome.get((resto.split(/\s+/)[0] || "")) || `import:${apel || resto}`;
      const r = comissaoServicosRanking(p.profissional, Number(p.totalServicos || 0));
      const revTotal = Number(p.valorTotal || 0);
      const serv = Number(p.totalServicos || 0);
      const prod = Number(p.totalProdutos || 0);
      const atend = Number(p.qtdAtendimentos || 0);
      // Fase 1: campos de cliente já parseados do ranking (antes descartados).
      const novos = Number(p.novosClientes || 0);
      const distintos = Number(p.clientesDistintos || 0);
      const pctRet = Number(p.pctRetorno || 0);
      const ent = byId.get(id);
      if (ent) {
        // dois nomes do ranking → mesmo id cadastrado: soma (dedup do André dobrado)
        ent.faturamento.total += revTotal; ent.faturamento.servicos += serv;
        ent.faturamento.servicosBruto += serv; ent.faturamento.servicosLiquido += serv;
        ent.faturamento.produtos += prod; ent.faturamento.produtosBruto += prod; ent.faturamento.produtosLiquido += prod;
        ent.faturamento.avulso += revTotal;
        ent.atendimentos.total += atend;
        ent.comissaoServicos += r.comissao;
        ent.ticketMedio = ent.atendimentos.total > 0 ? ent.faturamento.total / ent.atendimentos.total : 0;
        ent.novosClientes += novos; ent.clientesDistintos += distintos;
        ent._retPond += pctRet * atend; // % retorno ponderado por atendimentos
        ent.pctRetorno = ent.atendimentos.total > 0 ? ent._retPond / ent.atendimentos.total : 0;
      } else {
        byId.set(id, {
          id, nome: p.profissional,
          faturamento: { total: revTotal, servicos: serv, servicosBruto: serv, servicosLiquido: serv, plano: 0, produtos: prod, produtosBruto: prod, produtosLiquido: prod, avulso: revTotal },
          atendimentos: { total: atend, servicos: Number(p.numServicosRealizados || 0), plano: 0, produtos: Number(p.unidadesProdutos || 0), avulso: atend },
          ticketMedio: Number(p.ticketMedio || 0) || (atend > 0 ? revTotal / atend : 0),
          taxaCartao: 0,
          comissaoServicos: r.comissao,
          categoria: r.categoria,
          comissaoServicosFonte: "ranking-csv" as const,
          novosClientes: novos,
          clientesDistintos: distintos,
          pctRetorno: pctRet,
          _retPond: pctRet * atend,
        });
      }
      tot.faturamento += revTotal; tot.atendimentos += atend;
      tot.servicosBruto += serv; tot.servicosLiquido += serv;
      tot.produtosBruto += prod; tot.produtosLiquido += prod;
      tot.novosClientes += novos; tot.clientesDistintos += distintos;
      tot._retPond += pctRet * atend;
    }
    // limpa acumulador interno das linhas
    for (const e of byId.values()) delete e._retPond;
    const totaisOut = {
      faturamento: tot.faturamento, atendimentos: tot.atendimentos,
      servicosBruto: tot.servicosBruto, servicosLiquido: tot.servicosLiquido,
      produtosBruto: tot.produtosBruto, produtosLiquido: tot.produtosLiquido, planoReais: tot.planoReais,
      novosClientes: tot.novosClientes, clientesDistintos: tot.clientesDistintos,
      pctRetornoMedio: tot.atendimentos > 0 ? tot._retPond / tot.atendimentos : 0,
    };
    return { byId, totais: totaisOut };
  }

  async function calcularLinhaPagamento(
    mes: string,
    profissionalId: string,
    profMes: any,
    meta: any,
    pagto: any,
    clubeGreco?: { assinantes: number; valorVendasRS: number; comissaoRS: number; pctEfetivo: number },
  ) {
    const servicosLiquido = profMes?.servicos?.liquido || 0;
    const produtosLiquidoComissionavel = profMes?.produtos?.liquidoComissionavel || 0;
    const planoReais = profMes?.plano?.reais || 0;
    const taxaCartaoEstimada = profMes?.taxaCartao || 0; // informativo (já abatido no líquido)
    const custoInsumos = profMes?.custoInsumos || 0;
    const pctServico = Number(meta?.pctServico || 0);
    // v32: defaults globais (Settings) aplicados quando o profissional não tem
    // override em MetaProfissional. "Produto = 10%, Plano = 20%" do dono.
    const pctProdutoDefault = Number(storeData.settings?.comissaoProdutoPadraoPct ?? 10);
    const pctPlanoDefault = Number(storeData.settings?.comissaoPlanoPadraoPct ?? 20);
    const pctProduto = Number(meta?.pctProduto && meta.pctProduto > 0 ? meta.pctProduto : pctProdutoDefault);
    const pctPlano = Number(meta?.pctPlano && meta.pctPlano > 0 ? meta.pctPlano : pctPlanoDefault);
    const pctProdutoFonte: 'profissional' | 'global' = meta?.pctProduto && meta.pctProduto > 0 ? 'profissional' : 'global';
    const pctPlanoFonte: 'profissional' | 'global' = meta?.pctPlano && meta.pctPlano > 0 ? 'profissional' : 'global';
    const pctBonusExcedente = Number(meta?.pctBonusExcedente || 0);
    const metaReais = Number(meta?.metaReais || 0);
    const salarioFixo = Number(meta?.salarioFixo || 0);

    // Modo de comissão: 'bruto' = sobre serviços líquido (atual)
    //                   'liquido' = sobre serviços líquido − custo de insumos
    // Hierarquia: meta.modoComissao (override por prof) → settings.modoComissaoDefault → 'bruto'
    const modoSetting = (storeData.settings?.modoComissaoDefault === 'liquido') ? 'liquido' : 'bruto';
    const modoMeta = meta?.modoComissao;
    const modoAplicado: 'bruto' | 'liquido' =
      modoMeta === 'bruto' || modoMeta === 'liquido' ? modoMeta : modoSetting;
    // Base de comissão de serviços. No modo líquido, descontamos os insumos que
    // o profissional consumiu (a barbearia 'cobra' o material antes da comissão).
    const baseComissaoServicos = modoAplicado === 'liquido'
      ? Math.max(0, servicosLiquido - custoInsumos)
      : servicosLiquido;

    // D2 (v42.3): se há ranking CSV do mês, comissão de serviços = ranking×categoria
    // (fonte congelada). Senão, cálculo ao vivo. Só SERVIÇOS — produtos/plano/clube
    // /bônus/salário seguem ao vivo (ver dívida D2-fase2 no NOTAS.md).
    let comissaoServicos = (baseComissaoServicos * pctServico) / 100;
    let comissaoServicosFonte: 'ranking-csv' | 'ao-vivo' = 'ao-vivo';
    const _rankMap = await getRankComissaoMap(mes);
    if (_rankMap.temRanking) {
      const nomeLinha = normRank(profMes?.nome || meta?.nome || "");
      const tok = nomeLinha.split(/\s+/)[0];
      const val = _rankMap.keys.get(nomeLinha) ?? (tok ? _rankMap.keys.get(tok) : undefined);
      if (val != null) { comissaoServicos = val; comissaoServicosFonte = 'ranking-csv'; }
      // não-casou com ranking → mantém ao vivo (não força 0; evita zerar por falha de join)
    }
    const comissaoProdutos = (produtosLiquidoComissionavel * pctProduto) / 100;
    // v91: Ranking é a fonte ÚNICA de serviços (decisão do dono, 30/06). Quando há
    // ranking do mês, os serviços do cliente de plano JÁ entram na produção do
    // ranking (Total Serviços) — pagar comissão de plano por agendamento dobraria a
    // conta (além de vir de snapshots parciais capturados durante o 429). Zera.
    // Sem ranking → cálculo ao vivo mantém o comportamento antigo. A comissão do
    // Clube Greco é a TAXA da assinatura (à parte) e permanece.
    const comissaoPlano = _rankMap.temRanking ? 0 : (planoReais * pctPlano) / 100;
    const comissaoClubeGreco = Number(clubeGreco?.comissaoRS || 0);
    const excedente = Math.max(0, servicosLiquido - metaReais);
    const bonusExcedente = (excedente * pctBonusExcedente) / 100;
    const totalBruto = comissaoServicos + comissaoProdutos + comissaoPlano + comissaoClubeGreco + bonusExcedente + salarioFixo;

    const vale = Number(pagto?.vale || 0);
    const ajuste = Number(pagto?.ajuste || 0);
    const consumoInterno = Number(pagto?.consumoInterno || 0);
    const saldoAReceber = totalBruto - vale - consumoInterno + ajuste;

    return {
      profissionalId,
      nome: profMes?.nome || meta?.nome || "—",
      // Bases
      bases: {
        servicosLiquido,
        produtosLiquidoComissionavel,
        produtosLiquidoTotal: profMes?.produtos?.liquido || 0,
        planoReais,
        taxaCartaoEstimada,
        custoInsumos,
        baseComissaoServicos, // serviçosLiquido (modo bruto) OU serviçosLiquido − insumos (modo líquido)
      },
      // Percentuais aplicados
      percentuais: {
        pctServico, pctProduto, pctPlano, pctBonusExcedente,
        metaReais, salarioFixo,
        pctProdutoFonte, pctPlanoFonte,
      },
      // Modo aplicado nesta linha (pra UI mostrar)
      modoComissao: modoAplicado,
      modoFonte: modoMeta === 'bruto' || modoMeta === 'liquido' ? 'profissional' : 'global' as 'profissional' | 'global',
      // Categoria de ranking (preenchida pelo caller a partir da lista de assistentes)
      categoriaRanking: 'barbeiro' as 'barbeiro' | 'assistente',
      // Posição no ranking da categoria (1 = top, null = fora do ranking)
      posicaoRanking: null as number | null,
      // Componentes calculados
      calculos: {
        comissaoServicos,
        comissaoServicosFonte, // 'ranking-csv' (mês com ranking) | 'ao-vivo'
        comissaoProdutos,
        comissaoPlano,
        comissaoClubeGreco,
        excedenteMeta: excedente,
        bonusExcedente,
        bonusRanking: 0,    // preenchido pelo caller pra top 1 de cada categoria
        salarioFixo,
        totalBruto,
      },
      // Detalhe Clube Greco (assinaturas vendidas via aba Assinaturas)
      clubeGreco: clubeGreco || { assinantes: 0, valorVendasRS: 0, comissaoRS: 0, pctEfetivo: 0 },
      // Estado mensal
      pagamento: {
        vale,
        valeNota: pagto?.valeNota || "",
        valePagoEm: pagto?.valePagoEm || null,
        ajuste,
        ajusteNota: pagto?.ajusteNota || "",
        consumoInterno,
        consumoInternoNota: pagto?.consumoInternoNota || "",
        saldoAReceber,
        fechado: !!pagto?.fechado,
        fechadoEm: pagto?.fechadoEm || null,
        snapshot: pagto?.snapshot || null,
      },
    };
  }

  // GET /api/pagamento/:mes — linha de pagamento de TODOS os profissionais com meta
  app.get("/api/pagamento/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes deve ser YYYY-MM" });
      const [y, m] = mes.split("-").map(Number);
      const dataInicio = `${mes}-01`;
      const ultimoDia = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
      const dataFimReal = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
      const hoje = ymdHoje();
      // Se o mês ainda está em curso, limita até hoje (não calcula no futuro).
      const dataFim = hoje < dataFimReal ? hoje : dataFimReal;

      // Force refresh: faz backup do cache, invalida e re-coleta.
      // Se o refetch vier zerado (rate limit Trinks), restaura backup e retorna 503.
      const force = req.query.force === "true";
      const transFim = ymdAddDays(dataFim, 1);
      const cacheKeysParaForce = [
        `equipe-periodo:${dataInicio}:${dataFim}`,
        `transacoes_{"dataInicio":"${dataInicio}","dataFim":"${transFim}"}`,
        `agendamentos_{"dataInicio":"${dataInicio}","dataFim":"${dataFimReal}"}`,
      ];
      const backups: Record<string, any> = {};
      if (force) {
        for (const k of cacheKeysParaForce) {
          const v = getCached(k);
          if (v !== null) backups[k] = v;
        }
        cacheKeysParaForce.forEach(k => invalidateCache(k));
        log(`[pagamento/${mes}] force=true — backup feito, caches invalidados`, "pagamento");
      }

      const [periodo, metas, pagamentosMes] = await Promise.all([
        calcularPeriodoPorProfissional(dataInicio, dataFim),
        getAllMetas(),
        getPagamentosDoMes(mes),
      ]);

      // Detecção de refetch falho: se force=true E o periodo veio vazio mas o backup tinha dados,
      // restaura o backup e retorna 503 (provável rate limit).
      if (force && Object.keys(backups).length > 0) {
        const backupPeriodo = backups[`equipe-periodo:${dataInicio}:${dataFim}`];
        const periodoTotalNovo = periodo.totais?.reais || 0;
        const periodoTotalOld = backupPeriodo?.totais?.reais || 0;
        const venouMuitoMenor = periodoTotalOld > 0 && periodoTotalNovo < periodoTotalOld * 0.1;
        if (venouMuitoMenor) {
          // Restaura o cache antigo (com TTLs originais)
          for (const [k, v] of Object.entries(backups)) {
            const ttl = k.startsWith("equipe-periodo") ? 3 * 60 * 1000 : 24 * 60 * 60 * 1000;
            setCache(k, v, ttl);
          }
          log(`[pagamento/${mes}] force=true falhou (rate limit?). Cache restaurado: ${periodoTotalOld} > ${periodoTotalNovo}`, "pagamento");
          return res.status(503).json({
            ok: false,
            error: "Atualização falhou — Trinks indisponível ou rate limited. Cache anterior preservado, tente novamente em 1 minuto.",
            rateLimited: true,
          });
        }
      }

      const ids = new Set<string>();
      Object.keys(periodo.porProfissional).forEach(id => ids.add(id));
      Object.keys(metas).forEach(id => ids.add(id));

      // ─── Comissão Clube Greco por seller no mês ───
      // 20% (ou pct individual) sobre mensalidades pagas DO MÊS REQUISITADO.
      const pctClubePadrao = Number(storeData.settings?.comissaoPlanoPadraoPct ?? 20);
      const normNomeBusca = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      type ClubeBucket = { seller: string; assinantes: number; valorVendasRS: number; comissaoRS: number; pctSoma: number; pctCount: number };
      const clubeBySeller = new Map<string, ClubeBucket>();
      for (const c of assinaturaClientes) {
        const seller = (c.seller || "").trim();
        if (!seller) continue;
        const pagouNoMes = c.payments.some(p => p.mes === mes && p.pago);
        if (!pagouNoMes) continue;
        const pct = Number(c.commissionPct ?? pctClubePadrao);
        const valor = Number(c.planValue || 0);
        const comissao = valor * (pct / 100);
        const key = normNomeBusca(seller);
        const b = clubeBySeller.get(key) || { seller, assinantes: 0, valorVendasRS: 0, comissaoRS: 0, pctSoma: 0, pctCount: 0 };
        b.assinantes += 1;
        b.valorVendasRS += valor;
        b.comissaoRS += comissao;
        b.pctSoma += pct;
        b.pctCount += 1;
        clubeBySeller.set(key, b);
      }
      // Matching seller → profissional por nome (substring tolerante)
      const matchClubePorProfId = new Map<string, { assinantes: number; valorVendasRS: number; comissaoRS: number; pctEfetivo: number }>();
      const sellersUsados = new Set<string>();
      for (const id of ids) {
        const profMes = periodo.porProfissional[id];
        const meta = metas[id];
        const nomeProf = profMes?.nome || meta?.nome || "";
        if (!nomeProf) continue;
        const n = normNomeBusca(nomeProf);
        let match: ClubeBucket | undefined;
        for (const [k, v] of clubeBySeller) {
          if (sellersUsados.has(k)) continue;
          if (n === k || n.includes(k) || k.includes(n)) { match = v; sellersUsados.add(k); break; }
        }
        if (match) {
          matchClubePorProfId.set(id, {
            assinantes: match.assinantes,
            valorVendasRS: match.valorVendasRS,
            comissaoRS: match.comissaoRS,
            pctEfetivo: match.pctCount > 0 ? match.pctSoma / match.pctCount : pctClubePadrao,
          });
        }
      }

      let linhas = await Promise.all(Array.from(ids).map(async (id) => {
        const profMes = periodo.porProfissional[id];
        const meta = metas[id];
        const pagto = pagamentosMes[id];
        const clube = matchClubePorProfId.get(id);
        return calcularLinhaPagamento(mes, id, profMes, meta, pagto, clube);
      }));

      // v91: descarta linhas-fantasma — ids SEM meta E sem nenhum valor a pagar.
      // Surgiam de agendamentos com profissionalId hasheado (snapshots durante o
      // 429) que só carregavam plano; agora que o plano não dobra o ranking, ficam
      // zeradas. Mantém qualquer profissional com meta (mesmo R$0) ou com valor real.
      linhas = linhas.filter(l => !!metas[l.profissionalId] || l.calculos.totalBruto > 0.005);

      // v32: classifica cada linha em barbeiro vs assistente, calcula ranking e
      // aplica bônus pro top 1 de cada categoria.
      const normNome = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const assistentes = (storeData.settings?.profissionaisAssistente || [])
        .map((n: string) => normNome(n)).filter(Boolean);
      const isAssistente = (nome: string): boolean => {
        const n = normNome(nome);
        return assistentes.some((a: string) => n === a || n.includes(a) || a.includes(n));
      };
      for (const l of linhas) {
        l.categoriaRanking = isAssistente(l.nome) ? 'assistente' : 'barbeiro';
      }
      // Top 1 de cada categoria = mais faturamento em SERVIÇOS no mês.
      // Linhas com 0 serviços não entram no ranking (evita prêmio acidental).
      const ordBarbeiros = linhas
        .filter(l => l.categoriaRanking === 'barbeiro' && l.bases.servicosLiquido > 0)
        .sort((a, b) => b.bases.servicosLiquido - a.bases.servicosLiquido);
      const ordAssistentes = linhas
        .filter(l => l.categoriaRanking === 'assistente' && l.bases.servicosLiquido > 0)
        .sort((a, b) => b.bases.servicosLiquido - a.bases.servicosLiquido);
      ordBarbeiros.forEach((l, i) => { l.posicaoRanking = i + 1; });
      ordAssistentes.forEach((l, i) => { l.posicaoRanking = i + 1; });

      const bonusBarbeiro = Number(storeData.settings?.bonusTop1BarbeiroReais ?? 150);
      const bonusAssistente = Number(storeData.settings?.bonusTop1AssistenteReais ?? 150);
      // Aplica bônus + recalcula totalBruto + saldoAReceber
      for (const l of linhas) {
        if (l.posicaoRanking === 1) {
          const bonus = l.categoriaRanking === 'assistente' ? bonusAssistente : bonusBarbeiro;
          if (bonus > 0) {
            l.calculos.bonusRanking = bonus;
            l.calculos.totalBruto += bonus;
            l.pagamento.saldoAReceber += bonus;
          }
        }
      }

      // Ordena por nome
      linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

      // Sellers do Clube Greco que NÃO bateram com nenhum profissional ativo —
      // útil pra UI alertar "fulano vendeu mas não tem cadastro"
      const clubeOrfaos: Array<{ seller: string; assinantes: number; valorVendasRS: number; comissaoRS: number }> = [];
      for (const [k, v] of clubeBySeller) {
        if (!sellersUsados.has(k)) clubeOrfaos.push({ seller: v.seller, assinantes: v.assinantes, valorVendasRS: v.valorVendasRS, comissaoRS: v.comissaoRS });
      }

      // Totais
      const totais = linhas.reduce((acc, l) => ({
        totalBruto: acc.totalBruto + l.calculos.totalBruto,
        totalComissaoServicos: acc.totalComissaoServicos + l.calculos.comissaoServicos,
        totalComissaoProdutos: acc.totalComissaoProdutos + l.calculos.comissaoProdutos,
        totalComissaoPlano: acc.totalComissaoPlano + l.calculos.comissaoPlano,
        totalComissaoClubeGreco: acc.totalComissaoClubeGreco + l.calculos.comissaoClubeGreco,
        totalBonusExcedente: acc.totalBonusExcedente + l.calculos.bonusExcedente,
        totalBonusRanking: acc.totalBonusRanking + l.calculos.bonusRanking,
        totalSalarioFixo: acc.totalSalarioFixo + l.calculos.salarioFixo,
        totalVale: acc.totalVale + l.pagamento.vale,
        totalAjuste: acc.totalAjuste + l.pagamento.ajuste,
        totalConsumoInterno: acc.totalConsumoInterno + l.pagamento.consumoInterno,
        totalTaxaCartao: acc.totalTaxaCartao + l.bases.taxaCartaoEstimada,
        totalSaldo: acc.totalSaldo + l.pagamento.saldoAReceber,
      }), {
        totalBruto: 0, totalComissaoServicos: 0, totalComissaoProdutos: 0,
        totalComissaoPlano: 0, totalComissaoClubeGreco: 0,
        totalBonusExcedente: 0, totalBonusRanking: 0, totalSalarioFixo: 0,
        totalVale: 0, totalAjuste: 0, totalConsumoInterno: 0, totalTaxaCartao: 0, totalSaldo: 0,
      });

      return res.json({
        ok: true,
        mes,
        dataInicio,
        dataFim,
        linhas,
        totais,
        clubeOrfaos, // sellers do Clube Greco sem match em profissional ativo
        // Faturamento bruto do período (todas as transações da Trinks no intervalo)
        // — útil pra comparar com o cálculo de comissões e detectar discrepâncias.
        faturamento: {
          totalReais: periodo.totais?.reais || 0,
          totalAtendimentos: periodo.totais?.count || 0,
          servicosBruto: periodo.totais?.servicosBruto || 0,
          servicosLiquido: periodo.totais?.servicosLiquido || 0,
          produtosBruto: periodo.totais?.produtosBruto || 0,
          produtosLiquido: periodo.totais?.produtosLiquido || 0,
          planoReais: periodo.totais?.planoReais || 0,
        },
        fetchedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/pagamento/:mes/:profId — atualiza vale, ajuste, notas
  app.put("/api/pagamento/:mes/:profId", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      const profId = String(req.params.profId || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes deve ser YYYY-MM" });
      if (!profId) return res.status(400).json({ ok: false, error: "profId obrigatório" });
      const { vale, valeNota, valePagoEm, ajuste, ajusteNota, consumoInterno, consumoInternoNota } = req.body || {};
      const patch: any = {};
      if (vale !== undefined) patch.vale = Math.max(0, Number(vale) || 0);
      if (valeNota !== undefined) patch.valeNota = String(valeNota || "");
      if (valePagoEm !== undefined) patch.valePagoEm = valePagoEm ? String(valePagoEm) : undefined;
      if (ajuste !== undefined) patch.ajuste = Number(ajuste) || 0;
      if (ajusteNota !== undefined) patch.ajusteNota = String(ajusteNota || "");
      if (consumoInterno !== undefined) patch.consumoInterno = Math.max(0, Number(consumoInterno) || 0);
      if (consumoInternoNota !== undefined) patch.consumoInternoNota = String(consumoInternoNota || "");
      const novo = await upsertPagamentoMes(mes, profId, patch);
      return res.json({ ok: true, pagamento: novo });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // POST /api/pagamento/:mes/:profId/fechar — congela snapshot do mês
  app.post("/api/pagamento/:mes/:profId/fechar", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      const profId = String(req.params.profId || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes deve ser YYYY-MM" });
      const [y, m] = mes.split("-").map(Number);
      const dataInicio = `${mes}-01`;
      const ultimoDia = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
      const dataFimReal = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
      const hoje = ymdHoje();
      const dataFim = hoje < dataFimReal ? hoje : dataFimReal;
      const [periodo, meta, pagto] = await Promise.all([
        calcularPeriodoPorProfissional(dataInicio, dataFim),
        getMeta(profId),
        getPagamentoMes(mes, profId),
      ]);
      const profMes = periodo.porProfissional[profId];
      if (!profMes && !meta) return res.status(404).json({ ok: false, error: "Profissional sem dados nem meta no mês" });
      const linha = await calcularLinhaPagamento(mes, profId, profMes, meta, pagto);
      const snapshot = {
        servicosLiquido: linha.bases.servicosLiquido,
        produtosLiquidoComissionavel: linha.bases.produtosLiquidoComissionavel,
        planoReais: linha.bases.planoReais,
        pctServico: linha.percentuais.pctServico,
        pctProduto: linha.percentuais.pctProduto,
        pctPlano: linha.percentuais.pctPlano,
        pctBonusExcedente: linha.percentuais.pctBonusExcedente,
        metaReais: linha.percentuais.metaReais,
        salarioFixo: linha.percentuais.salarioFixo,
        comissaoServicos: linha.calculos.comissaoServicos,
        comissaoProdutos: linha.calculos.comissaoProdutos,
        comissaoPlano: linha.calculos.comissaoPlano,
        bonusExcedente: linha.calculos.bonusExcedente,
        totalBruto: linha.calculos.totalBruto,
        consumoInterno: linha.pagamento.consumoInterno,
        taxaCartaoEstimada: linha.bases.taxaCartaoEstimada,
        saldoAReceber: linha.pagamento.saldoAReceber,
      };
      const novo = await fecharPagMes(mes, profId, snapshot);
      return res.json({ ok: true, pagamento: novo });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/pagamento/:mes/:profId/reabrir — destrava o snapshot
  app.post("/api/pagamento/:mes/:profId/reabrir", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      const profId = String(req.params.profId || "");
      const novo = await reabrirPagMes(mes, profId);
      if (!novo) return res.status(404).json({ ok: false, error: "Pagamento não encontrado" });
      return res.json({ ok: true, pagamento: novo });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/pagamento/:mes/recibo/:profId — gera PDF do holerite
  app.get("/api/pagamento/:mes/recibo/:profId", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      const profId = String(req.params.profId || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes deve ser YYYY-MM" });
      const [y, m] = mes.split("-").map(Number);
      const dataInicio = `${mes}-01`;
      const ultimoDia = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
      const dataFimReal = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
      const hoje = ymdHoje();
      // Mesma janela do GET /api/pagamento — não calcula plano de dias futuros.
      const dataFim = hoje < dataFimReal ? hoje : dataFimReal;
      const [periodo, meta, pagto] = await Promise.all([
        calcularPeriodoPorProfissional(dataInicio, dataFim),
        getMeta(profId),
        getPagamentoMes(mes, profId),
      ]);
      const profMes = periodo.porProfissional[profId];
      const linha = await calcularLinhaPagamento(mes, profId, profMes, meta, pagto);

      // Se há snapshot fechado, prefere os valores travados (histórico fiel).
      const snap = pagto?.snapshot;
      const usarSnap = pagto?.fechado && snap;
      const valor = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
      const mesLabel = (() => {
        const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
        return `${meses[m - 1]} de ${y}`;
      })();

      // PDF gerado com pdfkit (já dependência do projeto se existir, senão HTML imprimível)
      let PDFDocument: any;
      try {
        PDFDocument = (await import("pdfkit")).default;
      } catch {
        // Fallback: HTML imprimível
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Recibo ${linha.nome} ${mes}</title>
<style>body{font-family:Arial,sans-serif;max-width:600px;margin:24px auto;padding:24px;color:#222}h1{margin:0 0 4px;font-size:18px}h2{margin:24px 0 8px;font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin-bottom:8px}td{padding:6px 8px;border-bottom:1px solid #eee;font-size:13px}td.r{text-align:right;font-variant-numeric:tabular-nums}.tot{font-weight:bold;background:#f5f5f5}.foot{margin-top:48px;border-top:1px solid #000;padding-top:8px;text-align:center;font-size:12px}.assin{margin-top:64px;border-top:1px solid #000;padding-top:4px;text-align:center;font-size:12px}</style></head><body>
<h1>Greco Barbearia — Recibo de Pagamento</h1>
<div>Profissional: <b>${linha.nome}</b> · Período: <b>${mesLabel}</b></div>
${pagto?.fechado ? `<div style="font-size:11px;color:#666">Mês fechado em ${new Date(pagto.fechadoEm || "").toLocaleString("pt-BR")}</div>` : `<div style="font-size:11px;color:#a60">⚠ Prévia (mês não fechado)</div>`}
<h2>Bases de cálculo</h2><table>
<tr><td>Serviços (líquido)</td><td class="r">${valor(usarSnap ? snap!.servicosLiquido : linha.bases.servicosLiquido)}</td></tr>
<tr><td>Produtos comissionáveis (líquido)</td><td class="r">${valor(usarSnap ? snap!.produtosLiquidoComissionavel : linha.bases.produtosLiquidoComissionavel)}</td></tr>
<tr><td>Plano/assinatura</td><td class="r">${valor(usarSnap ? snap!.planoReais : linha.bases.planoReais)}</td></tr>
${(() => { const tx = usarSnap ? (snap as any).taxaCartaoEstimada || 0 : linha.bases.taxaCartaoEstimada; return tx > 0 ? `<tr style="color:#666"><td>(info) Taxa cartão já abatida</td><td class="r">− ${valor(tx)}</td></tr>` : ""; })()}
</table>
<h2>Componentes</h2><table>
<tr><td>Comissão serviços (${linha.percentuais.pctServico}%)</td><td class="r">${valor(usarSnap ? snap!.comissaoServicos : linha.calculos.comissaoServicos)}</td></tr>
<tr><td>Comissão produtos (${linha.percentuais.pctProduto}%)</td><td class="r">${valor(usarSnap ? snap!.comissaoProdutos : linha.calculos.comissaoProdutos)}</td></tr>
<tr><td>Comissão plano (${linha.percentuais.pctPlano}%)</td><td class="r">${valor(usarSnap ? snap!.comissaoPlano : linha.calculos.comissaoPlano)}</td></tr>
<tr><td>Bônus por exceder meta (${linha.percentuais.pctBonusExcedente}%)</td><td class="r">${valor(usarSnap ? snap!.bonusExcedente : linha.calculos.bonusExcedente)}</td></tr>
${linha.percentuais.salarioFixo > 0 ? `<tr><td>Salário fixo</td><td class="r">${valor(linha.percentuais.salarioFixo)}</td></tr>` : ""}
<tr class="tot"><td>Total bruto</td><td class="r">${valor(usarSnap ? snap!.totalBruto : linha.calculos.totalBruto)}</td></tr>
</table>
<h2>Pagamentos do mês</h2><table>
<tr><td>(−) Vale do dia 15${linha.pagamento.valeNota ? " — " + linha.pagamento.valeNota : ""}</td><td class="r">${valor(linha.pagamento.vale)}</td></tr>
${linha.pagamento.consumoInterno > 0 ? `<tr><td>(−) Consumo interno${linha.pagamento.consumoInternoNota ? " — " + linha.pagamento.consumoInternoNota : ""}</td><td class="r">${valor(linha.pagamento.consumoInterno)}</td></tr>` : ""}
${linha.pagamento.ajuste !== 0 ? `<tr><td>(${linha.pagamento.ajuste >= 0 ? "+" : "−"}) Ajuste${linha.pagamento.ajusteNota ? " — " + linha.pagamento.ajusteNota : ""}</td><td class="r">${valor(Math.abs(linha.pagamento.ajuste))}</td></tr>` : ""}
<tr class="tot"><td>Saldo a receber</td><td class="r">${valor(usarSnap ? snap!.saldoAReceber : linha.pagamento.saldoAReceber)}</td></tr>
</table>
<div class="assin">Recebi a importância acima descrita</div>
<div class="foot">Greco Barbearia · Anápolis-GO · Emitido em ${new Date().toLocaleString("pt-BR")}</div>
</body></html>`;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(html);
      }

      // Geração com pdfkit
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="recibo-${profId}-${mes}.pdf"`);
      doc.pipe(res);
      doc.fontSize(16).text("Greco Barbearia — Recibo de Pagamento", { align: "center" });
      doc.moveDown(0.4);
      doc.fontSize(11).text(`Profissional: ${linha.nome}`);
      doc.text(`Período: ${mesLabel}`);
      if (pagto?.fechado) doc.fillColor("#666").text(`Mês fechado em ${new Date(pagto.fechadoEm || "").toLocaleString("pt-BR")}`).fillColor("#000");
      else doc.fillColor("#a60").text("⚠ Prévia (mês não fechado)").fillColor("#000");
      doc.moveDown(0.6);

      const linhaTab = (label: string, val: string, opts: any = {}) => {
        const y0 = doc.y;
        if (opts.bold) doc.font("Helvetica-Bold"); else doc.font("Helvetica");
        doc.fontSize(opts.bold ? 12 : 11);
        doc.text(label, 48, y0, { width: 350 });
        doc.text(val, 48, y0, { width: 500, align: "right" });
        doc.moveDown(0.3);
      };

      doc.fontSize(12).font("Helvetica-Bold").text("Bases de cálculo");
      doc.moveDown(0.2);
      linhaTab("Serviços (líquido)", valor(usarSnap ? snap!.servicosLiquido : linha.bases.servicosLiquido));
      linhaTab("Produtos comissionáveis (líquido)", valor(usarSnap ? snap!.produtosLiquidoComissionavel : linha.bases.produtosLiquidoComissionavel));
      linhaTab("Plano/assinatura", valor(usarSnap ? snap!.planoReais : linha.bases.planoReais));
      {
        const tx = usarSnap ? (snap as any).taxaCartaoEstimada || 0 : linha.bases.taxaCartaoEstimada;
        if (tx > 0) {
          doc.fillColor("#666");
          linhaTab("(info) Taxa cartão já abatida", `− ${valor(tx)}`);
          doc.fillColor("#000");
        }
      }
      doc.moveDown(0.4);

      doc.fontSize(12).font("Helvetica-Bold").text("Componentes");
      doc.moveDown(0.2);
      linhaTab(`Comissão serviços (${linha.percentuais.pctServico}%)`, valor(usarSnap ? snap!.comissaoServicos : linha.calculos.comissaoServicos));
      linhaTab(`Comissão produtos (${linha.percentuais.pctProduto}%)`, valor(usarSnap ? snap!.comissaoProdutos : linha.calculos.comissaoProdutos));
      linhaTab(`Comissão plano (${linha.percentuais.pctPlano}%)`, valor(usarSnap ? snap!.comissaoPlano : linha.calculos.comissaoPlano));
      linhaTab(`Bônus exceder meta (${linha.percentuais.pctBonusExcedente}%)`, valor(usarSnap ? snap!.bonusExcedente : linha.calculos.bonusExcedente));
      if (linha.percentuais.salarioFixo > 0) linhaTab("Salário fixo", valor(linha.percentuais.salarioFixo));
      linhaTab("Total bruto", valor(usarSnap ? snap!.totalBruto : linha.calculos.totalBruto), { bold: true });
      doc.moveDown(0.4);

      doc.fontSize(12).font("Helvetica-Bold").text("Pagamentos do mês");
      doc.moveDown(0.2);
      const labelVale = linha.pagamento.valeNota ? `(−) Vale do dia 15 — ${linha.pagamento.valeNota}` : "(−) Vale do dia 15";
      linhaTab(labelVale, valor(linha.pagamento.vale));
      if (linha.pagamento.consumoInterno > 0) {
        const labelCons = linha.pagamento.consumoInternoNota ? `(−) Consumo interno — ${linha.pagamento.consumoInternoNota}` : "(−) Consumo interno";
        linhaTab(labelCons, valor(linha.pagamento.consumoInterno));
      }
      if (linha.pagamento.ajuste !== 0) {
        const sinal = linha.pagamento.ajuste >= 0 ? "+" : "−";
        const labelAj = linha.pagamento.ajusteNota ? `(${sinal}) Ajuste — ${linha.pagamento.ajusteNota}` : `(${sinal}) Ajuste`;
        linhaTab(labelAj, valor(Math.abs(linha.pagamento.ajuste)));
      }
      linhaTab("Saldo a receber", valor(usarSnap ? snap!.saldoAReceber : linha.pagamento.saldoAReceber), { bold: true });

      doc.moveDown(2.4);
      const yAss = doc.y;
      doc.font("Helvetica").fontSize(11);
      doc.text("_______________________________________________", 48, yAss, { align: "center" });
      doc.text("Recebi a importância acima descrita", 48, yAss + 14, { align: "center" });
      doc.fontSize(9).fillColor("#666");
      doc.text(`Greco Barbearia · Anápolis-GO · Emitido em ${new Date().toLocaleString("pt-BR")}`, 48, yAss + 60, { align: "center" });
      doc.end();
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══ v21: Aba VENDAS DE PRODUTOS ══════════════════════════════════════

  // GET /api/produtos/custos — lista todos os produtos do catálogo Trinks
  // mesclados com preço médio observado nas vendas dos últimos 30 dias
  // (Trinks /produtos não expõe preço) + custos cadastrados localmente.
  app.get("/api/produtos/custos", async (_req: Request, res: Response) => {
    try {
      const hojeYmd = ymdHoje();
      const d30 = new Date();
      d30.setDate(d30.getDate() - 30);
      const dataInicio30 = d30.toISOString().slice(0, 10);
      const transFim = ymdAddDays(hojeYmd, 1);
      const custos = await getProdutosCustos();
      const produtos: any[] = await trinksFetchAll("produtos").catch(() => [] as any[]);
      const transacoes: any[] = await trinksFetchAll("transacoes", { dataInicio: dataInicio30, dataFim: transFim }).catch(() => [] as any[]);
      // Preço médio observado nas vendas
      const precoObservado = new Map<string, number>();
      for (const t of transacoes || []) {
        for (const p of (t.produtos || [])) {
          const id = String(p.id || "");
          if (!id) continue;
          const vu = Number(p.valorUnitario || 0);
          if (vu > 0) precoObservado.set(id, vu);
        }
      }
      const lista = (produtos || []).map((p: any) => {
        const id = String(p.id);
        const c = custos[id];
        const pcat = Number(p.preco || 0);
        const pobs = precoObservado.get(id) || 0;
        const precoManual = typeof c?.precoVenda === "number" && c.precoVenda > 0 ? c.precoVenda : 0;
        // efetivo: manual > catálogo > observado
        const precoEfetivo = precoManual || pcat || pobs;
        return {
          id,
          nome: p.nome || p.descricao || "",
          categoria: p.categoria?.nome || p.categoriaNome || "",
          fabricante: p.fabricante?.nome || p.fabricanteNome || "",
          precoVenda: precoEfetivo,           // preço efetivo (usado nas telas)
          precoVendaManual: precoManual || null, // preço cadastrado manualmente (null se não houver)
          precoVendaCatalogo: pcat || 0,      // preço do catálogo Trinks
          precoVendaObservado: pobs || 0,     // último preço visto em vendas
          custo: Number(c?.custo || 0),
          minimo: Number(c?.minimo || 0),
          atualizadoEm: c?.atualizadoEm || null,
          atualizadoPor: c?.atualizadoPor || null,
        };
      }).sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));
      return res.json({ ok: true, produtos: lista });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/produtos/catalogo — margem por produto a partir do CATÁLOGO importado
  // (kv catalogo_produtos: nome/preço/comissão/custo). Local e rápido (não toca a
  // API). Margem = preço − custo − comissão − taxa cartão − imposto.
  // GET /api/servicos/lista — catálogo de TODOS os serviços, com CACHE (kv
  // catalogo_servicos). Não depende da API estar no ar: usa o cache; só toca a
  // Trinks se o cache estiver vazio OU ?refresh=1. Resolve a lista sumir no modo CSV.
  app.get("/api/servicos/lista", async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === "1";
      const cache: any = await kvGet("catalogo_servicos");
      let servicos: any[] = Array.isArray(cache?.servicos) ? cache.servicos : [];
      let fonte = "cache";
      let geradoEm = cache?.salvoEm || null;
      if (refresh || servicos.length === 0) {
        try {
          const arr: any = await trinksFetchAll("servicos");
          const list = Array.isArray(arr) ? arr : (arr?.data || []);
          if (Array.isArray(list) && list.length > 0) {
            servicos = list;
            geradoEm = new Date().toISOString();
            await kvSet("catalogo_servicos", { servicos, salvoEm: geradoEm });
            fonte = "trinks";
          }
        } catch { /* mantém cache */ }
      }
      const lista = servicos
        .filter((s: any) => Number(s.preco) > 0)
        .map((s: any) => ({
          id: String(s.id), nome: String(s.nome || "Serviço").trim(),
          preco: Number(s.preco || 0), duracao: Number(s.duracaoEmMinutos || 30),
          categoria: String(s.categoria || "").trim(), visivel: s.visivelParaCliente !== false,
        }))
        .sort((a: any, b: any) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
      return res.json({ ok: true, fonte, geradoEm, total: lista.length, servicos: lista });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Erro interno." });
    }
  });

  app.get("/api/produtos/catalogo", async (_req: Request, res: Response) => {
    try {
      const cat: any = await kvGet("catalogo_produtos");
      const cfg = await getConfigFin();
      const taxa = Number(cfg.taxaCartaoPct || 0) / 100;
      const imp = Number(cfg.impostoPct || 0) / 100;
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const prods: any[] = Array.isArray(cat?.produtos) ? cat.produtos : [];
      const lista = prods.map((p: any) => {
        const preco = Number(p.preco || 0);
        const custo = Number(p.custo || 0);
        const comV = preco * (Number(p.comissaoPct || 0) / 100);
        const taxaV = preco * taxa, impV = preco * imp;
        const margem = preco - custo - comV - taxaV - impV;
        return {
          nome: p.nome, categoria: p.categoria || "", preco: r2(preco), custo: r2(custo),
          comissaoPct: Number(p.comissaoPct || 0), comissaoValor: r2(comV), taxaCartao: r2(taxaV), imposto: r2(impV),
          margemReal: r2(margem), margemPct: preco > 0 ? r2((margem / preco) * 100) : 0,
          semCusto: custo <= 0, paraRevenda: p.paraRevenda !== false,
        };
      }).sort((a: any, b: any) => (a.semCusto === b.semCusto ? a.margemPct - b.margemPct : a.semCusto ? 1 : -1));
      return res.json({
        ok: true, importado: !!cat, geradoEm: cat?.geradoEm || null,
        total: lista.length, semCusto: lista.filter((x: any) => x.semCusto).length,
        taxaCartaoPct: cfg.taxaCartaoPct, impostoPct: cfg.impostoPct, produtos: lista,
      });
    } catch (err: any) { return res.status(500).json({ ok: false, error: err.message }); }
  });

  // PUT /api/produtos/catalogo/custo — grava o custo de UM produto do catálogo (por nome).
  app.put("/api/produtos/catalogo/custo", async (req: Request, res: Response) => {
    try {
      const nome = String(req.body?.nome || "").trim();
      const custo = Math.max(0, Number(req.body?.custo || 0));
      if (!nome) return res.status(400).json({ ok: false, error: "nome obrigatório" });
      const cat: any = await kvGet("catalogo_produtos");
      if (!cat?.produtos) return res.status(404).json({ ok: false, error: "catálogo não importado" });
      const p = cat.produtos.find((x: any) => x.nome === nome);
      if (!p) return res.status(404).json({ ok: false, error: "produto não encontrado" });
      p.custo = custo;
      cat.comCusto = cat.produtos.filter((x: any) => Number(x.custo || 0) > 0).length;
      await kvSet("catalogo_produtos", cat);
      return res.json({ ok: true, nome, custo });
    } catch (err: any) { return res.status(500).json({ ok: false, error: err.message }); }
  });

  // PUT /api/produtos/custos/:id — atualiza custo (e opcionalmente preço de venda) de um produto
  // body: { custo: number, precoVenda?: number | null }
  //   - precoVenda undefined: mantém o atual
  //   - precoVenda null: limpa (volta a usar catálogo Trinks)
  //   - precoVenda número: sobrescreve
  app.put("/api/produtos/custos/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "");
      if (!id) return res.status(400).json({ ok: false, error: "id obrigatório" });
      const body = req.body || {};
      let custo: number;
      if (body.custo === undefined) {
        // permite atualizar só o precoVenda mantendo o custo anterior
        const atual = await getProdutosCustos();
        custo = Number(atual[id]?.custo || 0);
      } else {
        custo = Number(body.custo);
        if (Number.isNaN(custo)) return res.status(400).json({ ok: false, error: "custo deve ser numérico" });
      }
      let precoVenda: number | null | undefined = undefined;
      if (body.precoVenda === null) {
        precoVenda = null;
      } else if (body.precoVenda !== undefined) {
        const n = Number(body.precoVenda);
        if (Number.isNaN(n)) return res.status(400).json({ ok: false, error: "precoVenda deve ser numérico ou null" });
        precoVenda = n;
      }
      const atualizadoPor = (req as any).user?.username || "admin";
      await setProdutoCusto(id, custo, atualizadoPor, precoVenda);
      invalidateCache("vendas-produtos");
      invalidateCache("estoque");
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/produtos/custos — update em lote {items:[{id,custo?,precoVenda?}]}
  app.put("/api/produtos/custos", async (req: Request, res: Response) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const atualizadoPor = (req as any).user?.username || "admin";
      await setProdutosCustosBulk(items, atualizadoPor);
      invalidateCache("vendas-produtos");
      invalidateCache("estoque");
      return res.json({ ok: true, count: items.length });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // ═══ v23: Controle de estoque — ajustes manuais e estoque mínimo ═════════════════

  // PUT /api/produtos/minimo/:id — atualiza o estoque mínimo de um produto
  // body: { minimo: number | null }  (null limpa)
  app.put("/api/produtos/minimo/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "");
      if (!id) return res.status(400).json({ ok: false, error: "id obrigatório" });
      const raw = req.body?.minimo;
      let minimo: number | null;
      if (raw === null || raw === undefined || raw === "") {
        minimo = null;
      } else {
        minimo = Number(raw);
        if (Number.isNaN(minimo)) return res.status(400).json({ ok: false, error: "minimo deve ser numérico ou null" });
      }
      const atualizadoPor = (req as any).user?.username || "admin";
      await setProdutoMinimo(id, minimo, atualizadoPor);
      invalidateCache("estoque");
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // GET /api/estoque/movimentacoes — lista todas as movimentações manuais
  // Query params: produtoId? (filtra por produto), limit? (default 200)
  app.get("/api/estoque/movimentacoes", async (req: Request, res: Response) => {
    try {
      const produtoId = String(req.query.produtoId || "").trim();
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
      const all = await getMovimentacoesEstoque();
      let lista = all;
      if (produtoId) lista = getMovimentacoesDe(all, produtoId);
      else lista = [...all].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
      // Enriquecer com nome do produto
      const produtos: any[] = await trinksFetchAll("produtos").catch(() => [] as any[]);
      const nomePorId = new Map<string, string>();
      for (const p of produtos) nomePorId.set(String(p.id), p.nome || p.descricao || "");
      const out = lista.slice(0, limit).map((m) => ({
        ...m,
        produtoNome: nomePorId.get(String(m.produtoId)) || "",
      }));
      return res.json({ ok: true, movimentacoes: out, total: lista.length });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/estoque/movimentacoes — cria um ajuste manual
  // body: { produtoId, tipo: "entrada"|"saida"|"inventario", quantidade, motivo?, custoUnitario? }
  // Para tipo="inventario", quantidade = saldo final desejado (contagem física)
  app.post("/api/estoque/movimentacoes", async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const produtoId = String(body.produtoId || "").trim();
      if (!produtoId) return res.status(400).json({ ok: false, error: "produtoId obrigatório" });
      const tipo = String(body.tipo || "") as TipoMovimentacao;
      if (!(["entrada", "saida", "inventario"] as const).includes(tipo as any)) {
        return res.status(400).json({ ok: false, error: "tipo inválido (entrada|saida|inventario)" });
      }
      const quantidade = Number(body.quantidade);
      if (Number.isNaN(quantidade) || quantidade < 0) {
        return res.status(400).json({ ok: false, error: "quantidade inválida" });
      }

      // Custo unitário: se não vier no body, usa o cadastrado
      const custosMap = await getProdutosCustos();
      let custoUnitario = Number(body.custoUnitario);
      if (Number.isNaN(custoUnitario) || custoUnitario <= 0) {
        custoUnitario = getCustoOf(custosMap, produtoId);
      }

      // Para inventário, descobre o saldo atual (delta acumulado)
      let saldoAnterior: number | undefined;
      if (tipo === "inventario") {
        const movs = await getMovimentacoesEstoque();
        const deltas = getDeltasPorProduto(movs);
        saldoAnterior = Math.max(0, Number(deltas[produtoId] || 0));
      }

      const usuario = (req as any).user?.username || "admin";
      const mov = await addMovimentacao({
        produtoId,
        tipo,
        quantidade,
        custoUnitario,
        motivo: String(body.motivo || ""),
        usuario,
        saldoAnterior,
      });
      invalidateCache("estoque");
      return res.json({ ok: true, movimentacao: mov });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/estoque/movimentacoes/:id — remove um ajuste (correção de erro)
  app.delete("/api/estoque/movimentacoes/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "");
      if (!id) return res.status(400).json({ ok: false, error: "id obrigatório" });
      const ok = await deleteMovimentacao(id);
      if (!ok) return res.status(404).json({ ok: false, error: "movimentação não encontrada" });
      invalidateCache("estoque");
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // GET /api/vendas-produtos/:mes — agrega vendas de produtos de um mês
  // com custo cadastrado, margem, ranking de barbeiros e top produtos.
  // Reaproveita /v1/transacoes (mesma fonte da aba Estoque).
  app.get("/api/vendas-produtos/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ ok: false, error: "mes deve ser YYYY-MM" });
      }
      const ck = `vendas-produtos:${mes}`;
      const cached = getCached(ck);
      if (cached) return res.json({ ...cached, fromCache: true });

      const dataInicio = `${mes}-01`;
      const ultimoDia = ultimoDiaDoMes(`${mes}-01`);
      const hoje = ymdHoje();
      const dataFim = ultimoDia < hoje ? ultimoDia : hoje;
      const transFim = ymdAddDays(dataFim, 1); // intervalo semi-aberto

      // Janela menor para agendamentos (heurística de IDs legados)
      const d14 = new Date();
      d14.setDate(d14.getDate() - 14);
      const dataInicio14 = d14.toISOString().slice(0, 10);
      // SEQUENCIAL: rate limit Trinks 40/min. Paralelizar 4 fetches paginados
      // estoura e zera silenciosamente.
      const custosMap = await getProdutosCustos();
      log(`[vendas-produtos] mes=${mes} carregando produtos...`, "trinks");
      const produtos: any[] = await trinksFetchAll("produtos").catch((e: any) => {
        log(`[vendas-produtos] erro produtos: ${e?.message}`, "trinks");
        return [];
      });
      log(`[vendas-produtos] produtos=${produtos.length} carregando profissionais...`, "trinks");
      const profissionais: any[] = await trinksFetchAll("profissionais").catch((e: any) => {
        log(`[vendas-produtos] erro profissionais: ${e?.message}`, "trinks");
        return [];
      });
      log(`[vendas-produtos] profissionais=${profissionais.length} carregando transacoes...`, "trinks");
      const transacoes: any[] = await trinksFetchAll("transacoes", { dataInicio, dataFim: transFim }).catch((e: any) => {
        log(`[vendas-produtos] erro transacoes: ${e?.message}`, "trinks");
        return [];
      });
      log(`[vendas-produtos] transacoes=${transacoes.length} carregando agendamentos...`, "trinks");
      const agendamentos: any[] = await getAgendamentosPreferCsv(
      { dataInicio: dataInicio14, dataFim: hoje },
      () => trinksFetchAll("agendamentos", { dataInicio: dataInicio14, dataFim: hoje }),
    ).catch((e: any) => {
        log(`[vendas-produtos] erro agendamentos: ${e?.message}`, "trinks");
        return [];
      });
      log(`[vendas-produtos] agendamentos=${agendamentos.length}`, "trinks");

      const mapaProf = new Map<number, string>();
      for (const p of profissionais || []) {
        mapaProf.set(Number(p.id), p.nome || p.apelido || `Profissional ${p.id}`);
      }
      // v38: também carrega dicionário manual de profs conhecidos (kv_store)
      // pra resolver IDs órfãos (ex: 644414 que não está em /profissionais)
      try {
        const conhecidos = await getProfsConhecidos();
        for (const [id, nome] of Object.entries(conhecidos)) {
          mapaProf.set(Number(id), String(nome));
        }
      } catch { /* ignora */ }

      // Heurística: Trinks /v1/transacoes guarda IDs legados (ex: 55740, 653128)
      // que não batem com /v1/profissionais (825xxx). Cruzamos via agendamentos
      // por (data, clienteId) para inferir o nome real.
      const idxAgendPorDataCliente = new Map<string, { nome: string }[]>();
      for (const ag of agendamentos || []) {
        const dt = String(ag.dataHoraInicio || ag.data || "").slice(0, 10);
        const cli = Number(ag.cliente?.id || 0);
        const nomeProf = ag.profissional?.nome || ag.profissional?.apelido || "";
        if (!dt || !cli || !nomeProf) continue;
        const k = `${dt}|${cli}`;
        const arr = idxAgendPorDataCliente.get(k) || [];
        arr.push({ nome: nomeProf });
        idxAgendPorDataCliente.set(k, arr);
      }
      const freqNomePorIdLegado = new Map<number, Map<string, number>>();
      for (const t of transacoes || []) {
        const dt = String(t.dataHora || "").slice(0, 10);
        const cli = Number(t.cliente?.id || 0);
        if (!dt || !cli) continue;
        const cand = idxAgendPorDataCliente.get(`${dt}|${cli}`);
        if (!cand || cand.length === 0) continue;
        const idsLegados = new Set<number>();
        for (const pp of (t.produtos || [])) {
          const v = Number(pp.IdProfissionalQueRealizouAVenda || 0);
          if (v) idsLegados.add(v);
        }
        for (const idLeg of idsLegados) {
          const mp = freqNomePorIdLegado.get(idLeg) || new Map<string, number>();
          for (const c of cand) {
            const peso = cand.length === 1 ? 3 : 1;
            mp.set(c.nome, (mp.get(c.nome) || 0) + peso);
          }
          freqNomePorIdLegado.set(idLeg, mp);
        }
      }
      const mapaIdLegado = new Map<number, string>();
      for (const [idLeg, freq] of freqNomePorIdLegado) {
        let melhor = "", melhorScore = 0;
        for (const [n, s] of freq) if (s > melhorScore) { melhorScore = s; melhor = n; }
        if (melhor) mapaIdLegado.set(idLeg, melhor);
      }
      const nomeVendedor = (id: number): string => {
        return mapaProf.get(id) || mapaIdLegado.get(id) || `Profissional ${id}`;
      };

      // Agrega por produto
      type ProdAgg = {
        id: string;
        nome: string;
        categoria: string;
        fabricante: string;
        unidades: number;
        receita: number;
        custoTotal: number;
        precoVendaMedio: number;
        custoUnit: number;
        margemRS: number;
        margemPct: number;
      };
      const porProduto = new Map<string, ProdAgg>();

      // Ranking por vendedor
      type VendAgg = {
        id: number;
        nome: string;
        unidades: number;
        receita: number;
        custoTotal: number;
        margemRS: number;
        margemPct: number;
        produtosDistintos: Set<string>;
        comandas: Set<number>;
      };
      const porVendedor = new Map<number, VendAgg>();

      let totalUnidades = 0;
      let totalReceita = 0;
      let totalCusto = 0;
      const comandasComProduto = new Set<number>();

      for (const t of transacoes || []) {
        const prods = Array.isArray(t.produtos) ? t.produtos : [];
        if (prods.length === 0) continue;
        comandasComProduto.add(Number(t.id));
        for (const p of prods) {
          const pid = String(p.id || "");
          if (!pid) continue;
          const qtd = Number(p.quantidade || 0);
          const vuTrans = Number(p.valorUnitario || 0);
          const precoVendaManual = Number(custosMap[pid]?.precoVenda || 0);
          // Se houver preço manual cadastrado, ele sobrescreve o que veio na transação
          const vu = precoVendaManual > 0 ? precoVendaManual : vuTrans;
          const receita = vu * qtd;
          const custoUnit = Number(custosMap[pid]?.custo || 0);
          const custoTotal = custoUnit * qtd;
          const idVend = Number(p.IdProfissionalQueRealizouAVenda || 0) || null;

          totalUnidades += qtd;
          totalReceita += receita;
          totalCusto += custoTotal;

          // produto
          const prod = porProduto.get(pid) || {
            id: pid,
            nome: p.nome || "",
            categoria: "",
            fabricante: "",
            unidades: 0,
            receita: 0,
            custoTotal: 0,
            precoVendaMedio: 0,
            custoUnit,
            margemRS: 0,
            margemPct: 0,
          };
          prod.unidades += qtd;
          prod.receita += receita;
          prod.custoTotal += custoTotal;
          if (vu > 0) prod.precoVendaMedio = vu;
          prod.custoUnit = custoUnit;
          porProduto.set(pid, prod);

          // vendedor
          if (idVend) {
            const vd = porVendedor.get(idVend) || {
              id: idVend,
              nome: nomeVendedor(idVend),
              unidades: 0,
              receita: 0,
              custoTotal: 0,
              margemRS: 0,
              margemPct: 0,
              produtosDistintos: new Set<string>(),
              comandas: new Set<number>(),
            };
            vd.unidades += qtd;
            vd.receita += receita;
            vd.custoTotal += custoTotal;
            vd.produtosDistintos.add(pid);
            vd.comandas.add(Number(t.id));
            porVendedor.set(idVend, vd);
          }
        }
      }

      // Enriquece nomes/categoria via catálogo
      const catalogoMap = new Map<string, any>();
      for (const p of produtos || []) catalogoMap.set(String(p.id), p);
      const produtosArr = Array.from(porProduto.values()).map(p => {
        const cat = catalogoMap.get(p.id);
        const nomeCat = cat?.categoria?.nome || cat?.categoriaNome || "";
        const fab = cat?.fabricante?.nome || cat?.fabricanteNome || "";
        const margemRS = p.receita - p.custoTotal;
        const margemPct = p.receita > 0 ? (margemRS / p.receita) * 100 : 0;
        return {
          ...p,
          nome: p.nome || cat?.nome || "",
          categoria: nomeCat,
          fabricante: fab,
          margemRS,
          margemPct,
        };
      }).sort((a, b) => b.receita - a.receita);

      // Consolida por NOME (Trinks usa vários IDs legados para o mesmo profissional).
      // Se 3 IDs distintos resolvem para "Carlos André", soma tudo numa linha só.
      const consolidadoPorNome = new Map<string, {
        ids: number[]; nome: string; unidades: number; receita: number;
        custoTotal: number; produtosDistintos: Set<string>; comandas: Set<number>;
      }>();
      for (const v of porVendedor.values()) {
        const key = v.nome.trim().toUpperCase();
        const cur = consolidadoPorNome.get(key) || {
          ids: [], nome: v.nome, unidades: 0, receita: 0, custoTotal: 0,
          produtosDistintos: new Set<string>(), comandas: new Set<number>(),
        };
        cur.ids.push(v.id);
        cur.unidades += v.unidades;
        cur.receita += v.receita;
        cur.custoTotal += v.custoTotal;
        v.produtosDistintos.forEach(p => cur.produtosDistintos.add(p));
        v.comandas.forEach(c => cur.comandas.add(c));
        consolidadoPorNome.set(key, cur);
      }
      // v39.2: comissão por profissional — busca metas individuais e aplica default global
      const metasMap = await getAllMetas().catch(() => ({} as any));
      const pctProdutoDefault = Number(storeData.settings?.comissaoProdutoPadraoPct ?? 10);
      // Cria índice nome normalizado → pctProduto (das metas)
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
      const metaPorNome = new Map<string, number>();
      for (const m of Object.values(metasMap) as any[]) {
        const pct = Number(m?.pctProduto);
        if (m?.nome && pct > 0) metaPorNome.set(norm(m.nome), pct);
      }
      const buscarPct = (nome: string): { pct: number; fonte: "meta"|"default" } => {
        const n = norm(nome);
        for (const [mn, p] of metaPorNome) {
          if (n === mn || n.includes(mn) || mn.includes(n)) return { pct: p, fonte: "meta" };
        }
        return { pct: pctProdutoDefault, fonte: "default" };
      };

      // v38.1: separa ranking de ativos vs histórico (ex-funcionários).
      // Não-ativos NÃO disputam pódio com os atuais — apresentado separado.
      const todosVendedores = Array.from(consolidadoPorNome.values()).map(v => {
        const margemRS = v.receita - v.custoTotal;
        const margemPct = v.receita > 0 ? (margemRS / v.receita) * 100 : 0;
        const { pct: pctComissao, fonte: pctFonte } = buscarPct(v.nome);
        const comissaoRS = (v.receita * pctComissao) / 100;
        return {
          id: v.ids[0], // primeiro ID (para chave React)
          ids: v.ids,
          nome: v.nome,
          unidades: v.unidades,
          receita: v.receita,
          custoTotal: v.custoTotal,
          margemRS,
          margemPct,
          produtosDistintos: v.produtosDistintos.size,
          comandas: v.comandas.size,
          ticketMedio: v.comandas.size > 0 ? v.receita / v.comandas.size : 0,
          // v39.2: comissão sobre produtos
          pctComissao,
          pctComissaoFonte: pctFonte, // 'meta' = override individual / 'default' = padrão global
          comissaoRS,
          historico: /ex.?func|hist[oó]rico|sem identif|profissional \d+/i.test(v.nome),
        };
      }).sort((a, b) => b.receita - a.receita);
      const vendedoresArr = todosVendedores.filter(v => !v.historico);
      const vendedoresHistorico = todosVendedores.filter(v => v.historico);

      const totalMargemRS = totalReceita - totalCusto;
      const totalMargemPct = totalReceita > 0 ? (totalMargemRS / totalReceita) * 100 : 0;
      const produtosSemCusto = produtosArr.filter(p => p.custoUnit === 0).length;

      const resp = {
        ok: true,
        mes,
        dataInicio,
        dataFim,
        totais: {
          unidades: totalUnidades,
          receita: totalReceita,
          custo: totalCusto,
          margemRS: totalMargemRS,
          margemPct: totalMargemPct,
          comandasComProduto: comandasComProduto.size,
          produtosDistintos: produtosArr.length,
          produtosSemCusto,
        },
        produtos: produtosArr,
        ranking: vendedoresArr,
        rankingHistorico: vendedoresHistorico, // v38.1: ex-funcionários separados
        atualizadoEm: new Date().toISOString(),
      };
      setCache(ck, resp, 5 * 60 * 1000);
      return res.json(resp);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── EQUIPE: desempenho consolidado dia/semana/mês ────────────────
  // GET /api/financeiro/dre/:mes — DRE consolidada do mês (entradas/saídas detalhadas)
  // Agrega: serviços por categoria de profissional, planos, produtos, comissões,
  // taxa cartão, despesas manuais por categoria, saldo bancário (consolidação).
  // Inclui também o mês anterior para comparativo.
  app.get("/api/financeiro/dre/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes deve ser YYYY-MM" });

      // Profissionais que fazem estética (configurável depois via storeData.settings).
      // Hoje hardcoded baseado no setup do cliente: Patricia, Débora, Ellen.
      const NOMES_ESTETICA = (storeData.settings?.profissionaisEstetica as string[] | undefined)
        || ["PATRICIA", "DEBORA", "DÉBORA", "ELLEN"];
      const isEstetica = (nome: string) => {
        const n = nome.toUpperCase();
        return NOMES_ESTETICA.some((e: string) => n.includes(e.toUpperCase()));
      };

      async function calcularDREMes(mesParam: string) {
        const [y, m] = mesParam.split("-").map(Number);
        const dataInicio = `${mesParam}-01`;
        const ultimoDia = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
        const dataFimReal = `${mesParam}-${String(ultimoDia).padStart(2, "0")}`;
        const hojeStr = ymdHoje();
        // Pra mês corrente, limita ao dia atual (não calcula no futuro)
        const dataFim = mesParam === hojeStr.slice(0, 7) && hojeStr < dataFimReal ? hojeStr : dataFimReal;

        // 1. Periodo por profissional (fonte: Trinks)
        const periodo = await calcularPeriodoPorProfissional(dataInicio, dataFim).catch(() => null);

        let servicosBarbeiros = 0;
        let servicosEstetica = 0;
        let planos = 0;
        let produtosVendidos = 0;
        let totalAtendimentos = 0;
        let totalTrinksReais = 0;
        if (periodo) {
          for (const p of Object.values(periodo.porProfissional)) {
            const fatServicos = p.servicos.reais || 0;
            if (isEstetica(p.nome)) servicosEstetica += fatServicos;
            else servicosBarbeiros += fatServicos;
            planos += p.plano.reais || 0;
            produtosVendidos += p.produtos.reais || 0;
            totalAtendimentos += p.total.count || 0;
            totalTrinksReais += p.total.reais || 0;
          }
        }
        // "Outros" cobre o gap entre total Trinks e a soma de barbeiros+estética+
        // plano+produtos. Inclui pacotes, gorjetas, descontos, ajustes, etc.
        // Sem isso o DRE fica R$ 10k abaixo do Fechamento (Trinks) e a conta não
        // fecha entre as abas.
        const outrosTrinks = Math.max(0, totalTrinksReais - servicosBarbeiros - servicosEstetica - planos - produtosVendidos);

        // 2. Comissões + bônus + taxa cartão (fonte: cálculo de pagamento)
        let comissoes = 0;
        let taxaCartao = 0;
        if (periodo) {
          const metas = await getAllMetas().catch(() => ({} as any));
          const pagamentosMes = await getPagamentosDoMes(mesParam).catch(() => ({} as any));
          const idsTodos = new Set<string>([
            ...Object.keys(periodo.porProfissional),
            ...Object.keys(metas),
          ]);
          const linhas = await Promise.all(
            Array.from(idsTodos).map(id =>
              calcularLinhaPagamento(mesParam, id, periodo.porProfissional[id], metas[id], pagamentosMes[id])
            )
          );
          comissoes = linhas.reduce((s, l) => s + l.calculos.totalBruto, 0);
          taxaCartao = linhas.reduce((s, l) => s + l.bases.taxaCartaoEstimada, 0);
        }

        // 3. Custo dos produtos vendidos (fonte: /api/vendas-produtos)
        let custoProdutos = 0;
        let receitaProdutosCustos = 0;
        try {
          // Reusa a mesma lógica de vendas-produtos: agrega por produto a partir de transacoes
          // Aqui é mais simples: o endpoint /api/vendas-produtos/:mes já calcula tudo,
          // mas pra evitar refetch chamamos a função base se existir; senão estimamos do periodo.
          // Por enquanto usamos transacoes do periodo agregadas pelos produtos cadastrados.
          // Aproximação: custoProdutos = produtosVendidos × (1 - margemMédia42%) — depois substituir
          // por valor real do endpoint quando refatoração permitir reuso da função.
          // TODO: extrair calcularVendasProdutos pra função reutilizável; por hora chamamos endpoint.
        } catch {}

        // 4. Despesas manuais (entries do /api/financeiro)
        const finMes = financeEntries.filter(f => (f.date || "").slice(0, 7) === mesParam);
        const despesasFixas = finMes.filter(f => f.category === "fixo" && f.amount < 0).reduce((s, f) => s + Math.abs(f.amount), 0);
        const despesasVariaveis = finMes.filter(f => f.category === "variavel" && f.amount < 0).reduce((s, f) => s + Math.abs(f.amount), 0);
        const parcelamentos = finMes.filter(f => f.category === "parcelamento" && f.amount < 0).reduce((s, f) => s + Math.abs(f.amount), 0);
        const investimentos = finMes.filter(f => f.category === "investimento" && f.amount < 0).reduce((s, f) => s + Math.abs(f.amount), 0);
        const outrasReceitas = finMes.filter(f => f.category === "receita" && f.amount > 0).reduce((s, f) => s + f.amount, 0);

        // 5. Saldo bancário (fonte: consolidação)
        let saldoBancario = { entradas: 0, saidas: 0, saldo: 0 };
        try {
          const txMes = transacoesBanco.filter((t: any) => (t.date || "").slice(0, 7) === mesParam);
          const entradas = txMes.filter((t: any) => (t.amount || 0) > 0).reduce((s: number, t: any) => s + t.amount, 0);
          const saidas = txMes.filter((t: any) => (t.amount || 0) < 0).reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
          saldoBancario = { entradas, saidas, saldo: entradas - saidas };
        } catch {}

        const totalEntradas = servicosBarbeiros + servicosEstetica + planos + produtosVendidos + outrosTrinks + outrasReceitas;
        const totalSaidas = comissoes + taxaCartao + custoProdutos + despesasFixas + despesasVariaveis + parcelamentos + investimentos;
        const resultadoLiquido = totalEntradas - totalSaidas;
        const margem = totalEntradas > 0 ? (resultadoLiquido / totalEntradas) * 100 : 0;

        return {
          mes: mesParam,
          dataInicio,
          dataFim,
          entradas: {
            servicosBarbeiros,
            servicosEstetica,
            planos,
            produtosVendidos,
            outrosTrinks,
            outrasReceitas,
            total: totalEntradas,
            atendimentos: totalAtendimentos,
          },
          saidas: {
            comissoes,
            taxaCartao,
            custoProdutos,
            despesasFixas,
            despesasVariaveis,
            parcelamentos,
            investimentos,
            total: totalSaidas,
          },
          resultadoLiquido,
          margem,
          saldoBancario,
        };
      }

      // Mês anterior (pra comparativo)
      const [y, m] = mes.split("-").map(Number);
      const mesAntDate = new Date(y, m - 2, 1);
      const mesAnterior = `${mesAntDate.getFullYear()}-${String(mesAntDate.getMonth() + 1).padStart(2, "0")}`;

      const [dreAtual, dreAnterior] = await Promise.all([
        calcularDREMes(mes),
        calcularDREMes(mesAnterior).catch(() => null),
      ]);

      return res.json({
        ok: true,
        atual: dreAtual,
        anterior: dreAnterior,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      log(`/api/financeiro/dre/${req.params.mes} erro: ${err.message}`, "financeiro");
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/equipe/mes/:mes — ranking de equipe pra um mês específico
  // Reusa calcularPeriodoPorProfissional (mesma fonte usada por Pagamento — garante
  // que os números batem entre as abas Equipe e Pagamento).
  app.get("/api/equipe/mes/:mes", async (req: Request, res: Response) => {
    try {
      const mes = String(req.params.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: "mes deve ser YYYY-MM" });
      const [y, m] = mes.split("-").map(Number);
      const dataInicio = `${mes}-01`;
      const ultimoDia = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
      const dataFimReal = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
      const hoje = ymdHoje();
      const dataFim = hoje < dataFimReal ? hoje : dataFimReal;

      const inativos = await getProfsInativos();
      const metasMes = await getAllMetas();

      // Bloco 1 (v42.4): tem ranking do mês → fonte CONGELADA (ranking×categoria,
      // deduplicada). Sem ranking → cálculo ao vivo (preserva o dia corrente).
      const rankEquipe = await montarEquipeDeRanking(mes, metasMes);
      const fonteEquipe: "ranking-csv" | "ao-vivo" = rankEquipe ? "ranking-csv" : "ao-vivo";

      let profsRanked: any[];
      let totaisOut: any;
      let configOut: any = { taxaCartaoPct: 0 };

      if (rankEquipe) {
        profsRanked = Array.from(rankEquipe.byId.values())
          .map(p => ({ ...p, comissaoServicosFonte: "ranking-csv" }))
          .filter(p => !inativos.has(String(p.id)))
          .filter(p => !String(p.nome || "").startsWith("Profissional "))
          .filter(p => p.faturamento.total > 0 || p.atendimentos.total > 0)
          .sort((a, b) => b.faturamento.total - a.faturamento.total);
        const t = rankEquipe.totais;
        totaisOut = {
          faturamento: t.faturamento, atendimentos: t.atendimentos,
          ticketMedio: t.atendimentos > 0 ? t.faturamento / t.atendimentos : 0,
          profissionaisAtivos: profsRanked.length,
          servicosBruto: t.servicosBruto, servicosLiquido: t.servicosLiquido,
          produtosBruto: t.produtosBruto, produtosLiquido: t.produtosLiquido,
          planoReais: t.planoReais,
          // Fase 1: agregados de cliente p/ card de retenção
          novosClientes: t.novosClientes, clientesDistintos: t.clientesDistintos,
          pctRetornoMedio: t.pctRetornoMedio,
        };
      } else {
        const periodo = await calcularPeriodoPorProfissional(dataInicio, dataFim);
        configOut = periodo.config;
        profsRanked = Object.values(periodo.porProfissional)
          .map(p => ({
            id: p.profissionalId, nome: p.nome,
            faturamento: {
              total: p.total.reais, servicos: p.servicos.reais,
              servicosBruto: p.servicos.bruto, servicosLiquido: p.servicos.liquido,
              plano: p.plano.reais, produtos: p.produtos.reais,
              produtosBruto: p.produtos.bruto, produtosLiquido: p.produtos.liquido,
              avulso: p.avulso.reais,
            },
            atendimentos: {
              total: p.total.count, servicos: p.servicos.count,
              plano: p.plano.count, produtos: p.produtos.count, avulso: p.avulso.count,
            },
            ticketMedio: p.total.count > 0 ? p.total.reais / p.total.count : 0,
            taxaCartao: p.taxaCartao,
            comissaoServicos: 0, categoria: null, comissaoServicosFonte: "ao-vivo",
          }))
          .filter(p => !inativos.has(String(p.id)))
          .filter(p => !String(p.nome || "").startsWith("Profissional "))
          .filter(p => p.faturamento.total > 0 || p.atendimentos.total > 0)
          .sort((a, b) => b.faturamento.total - a.faturamento.total);
        totaisOut = {
          faturamento: periodo.totais?.reais || 0,
          atendimentos: periodo.totais?.count || 0,
          ticketMedio: (periodo.totais?.count || 0) > 0 ? (periodo.totais?.reais || 0) / (periodo.totais!.count) : 0,
          profissionaisAtivos: profsRanked.length,
          servicosBruto: periodo.totais?.servicosBruto || 0,
          servicosLiquido: periodo.totais?.servicosLiquido || 0,
          produtosBruto: periodo.totais?.produtosBruto || 0,
          produtosLiquido: periodo.totais?.produtosLiquido || 0,
          planoReais: periodo.totais?.planoReais || 0,
        };
      }

      // v41: anexa auditoria de fontes (informativo, lado a lado com o número exibido)
      const canonicoAudit = await getMesDataCanonical(mes, { trinksFetchAllRange, log })
        .then(c => ({ fonteEscolhida: c.fonte, faturamento: c.faturamento, comandas: c.comandas, fontesAuditoria: c.fontesAuditoria }))
        .catch(() => null);

      return res.json({
        ok: true,
        mes,
        dataInicio,
        dataFim,
        fonte: fonteEquipe,
        totais: totaisOut,
        profissionais: profsRanked,
        config: configOut,
        canonico: canonicoAudit,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      log(`/api/equipe/mes/${req.params.mes} erro: ${err.message}`, "equipe");
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/equipe/desempenho", async (_req: Request, res: Response) => {
    try {
      const cacheKey = "equipe-desempenho-completo";
      const cached = getCached(cacheKey);
      if (cached) return res.json({ ...cached, fromCache: true });

      const hoje = ymdHoje();
      const { dataInicio: semIni, dataFim: semFim } = janelaSemanaUtil(hoje);
      const { dataInicio: mesIni, dataFim: mesFim, mes } = janelaMesAtual(hoje);
      const ultimoDia = ultimoDiaDoMes(hoje);
      const diasUteisTotal = contarDiasUteis(`${mes}-01`, ultimoDia);
      const diasUteisDecorridos = contarDiasUteis(`${mes}-01`, hoje);

      // Serial para evitar competir pelo rate limit do Trinks (40/min) com 9 fetches paralelos.
      // Otimização A: mês PRIMEIRO — popula cache mensal de agendamentos/transacoes;
      // semana e dia em seguida reaproveitam essa janela via trinksFetchAllRange (zero fetches reais).
      // Paralelo: a serialização original era pra reaproveitar cache do mês
      // nos cálculos de semana/dia, mas com Trinks rate-limited as 3 chamadas
      // viravam timeout serial (30s+) e Railway matava a request. Paralelo,
      // cada uma tem timeout interno de 5s por fetch, total ~10s.
      log(`[equipe/desempenho] calculando mês/semana/dia em paralelo...`, "equipe");
      const [mesData, semana, dia] = await Promise.all([
        calcularPeriodoPorProfissional(mesIni, mesFim),
        calcularPeriodoPorProfissional(semIni, semFim),
        calcularPeriodoPorProfissional(hoje, hoje),
      ]);
      const metas = await getAllMetas();
      log(`[equipe/desempenho] dia=${Object.keys(dia.porProfissional).length} sem=${Object.keys(semana.porProfissional).length} mes=${Object.keys(mesData.porProfissional).length} metas=${Object.keys(metas).length}`, "equipe");

      const profsMes = Object.values(mesData.porProfissional).sort((a, b) => b.total.reais - a.total.reais);
      const totalProfsComMov = profsMes.length;
      const posicaoMap = new Map<string, number>();
      profsMes.forEach((p, i) => posicaoMap.set(p.profissionalId, i + 1));

      const idsTodos = new Set<string>([
        ...Object.keys(dia.porProfissional),
        ...Object.keys(semana.porProfissional),
        ...Object.keys(mesData.porProfissional),
        ...Object.keys(metas),
      ]);

      // Helper para calcular metas proporcionais por dias úteis trabalhados
      // Regra: meta diária = metaMensal / diasUteisTotal; meta semanal = diaria * 5
      function calcularMetasProporcionais(meta: { metaReais: number; metaAtendimentos: number } | null) {
        if (!meta || diasUteisTotal === 0) {
          return {
            mes: { reais: meta?.metaReais || 0, atend: meta?.metaAtendimentos || 0 },
            semana: { reais: 0, atend: 0 },
            dia: { reais: 0, atend: 0 },
            diasUteisTotal,
            diasUteisDecorridos,
          };
        }
        const reaisDia = meta.metaReais / diasUteisTotal;
        const atendDia = meta.metaAtendimentos / diasUteisTotal;
        return {
          mes: { reais: meta.metaReais, atend: meta.metaAtendimentos },
          semana: { reais: reaisDia * 5, atend: atendDia * 5 },
          dia: { reais: reaisDia, atend: atendDia },
          diasUteisTotal,
          diasUteisDecorridos,
        };
      }

      function calcularStatus(realizado: { reais: number; count: number }, metaJanela: { reais: number; atend: number }) {
        const temMeta = (metaJanela.reais > 0) || (metaJanela.atend > 0);
        if (!temMeta) {
          return { temMeta: false, percReais: 0, percAtend: 0, bateu: false, farol: "sem-meta" as const };
        }
        const pR = metaJanela.reais > 0 ? (realizado.reais / metaJanela.reais) * 100 : 0;
        const pA = metaJanela.atend > 0 ? (realizado.count / metaJanela.atend) * 100 : 0;
        // Bateu se atingiu a meta principal (R$). Se só tem meta de atendimentos, usa essa.
        const bateu = metaJanela.reais > 0 ? pR >= 100 : pA >= 100;
        return { temMeta: true, percReais: Math.round(pR * 10) / 10, percAtend: Math.round(pA * 10) / 10, bateu, farol: (bateu ? "verde" : "vermelho") as "verde" | "vermelho" };
      }

      const linhasRaw = Array.from(idsTodos).map(id => {
        const profDia = dia.porProfissional[id];
        const profSem = semana.porProfissional[id];
        const profMes = mesData.porProfissional[id];
        const meta = metas[id];
        const nome = (profMes?.nome || profSem?.nome || profDia?.nome || meta?.nome || "—");
        const z = { reais: 0, count: 0, avulsoReais: 0, avulsoCount: 0, planoReais: 0, planoCount: 0, servicosReais: 0, servicosCount: 0, servicosBruto: 0, servicosLiquido: 0, produtosReais: 0, produtosCount: 0, produtosBruto: 0, produtosLiquido: 0, produtosBrutoComissionavel: 0, produtosLiquidoComissionavel: 0 };
        const metasCalc = calcularMetasProporcionais(meta || null);
        const mkObj = (p: any) => p ? {
          reais: p.total.reais, count: p.total.count,
          avulsoReais: p.avulso.reais, avulsoCount: p.avulso.count,
          planoReais: p.plano.reais, planoCount: p.plano.count,
          servicosReais: p.servicos.reais, servicosCount: p.servicos.count,
          servicosBruto: p.servicos.bruto, servicosLiquido: p.servicos.liquido,
          produtosReais: p.produtos.reais, produtosCount: p.produtos.count,
          produtosBruto: p.produtos.bruto, produtosLiquido: p.produtos.liquido,
          produtosBrutoComissionavel: p.produtos.brutoComissionavel || 0,
          produtosLiquidoComissionavel: p.produtos.liquidoComissionavel || 0,
        } : { ...z };
        const diaObj    = mkObj(profDia);
        const semanaObj = mkObj(profSem);
        const mesObj    = mkObj(profMes);
        return {
          profissionalId: id, nome,
          meta: meta ? { metaReais: meta.metaReais, metaAtendimentos: meta.metaAtendimentos, telegramChatId: meta.telegramChatId, ativoEnvio: meta.ativoEnvio, pctServico: meta.pctServico || 0, pctProduto: meta.pctProduto || 0, pctPlano: meta.pctPlano || 0 } : null,
          metasCalculadas: metasCalc,
          dia: diaObj,
          semana: semanaObj,
          mes: mesObj,
          status: {
            dia: calcularStatus(diaObj, metasCalc.dia),
            semana: calcularStatus(semanaObj, metasCalc.semana),
            mes: calcularStatus(mesObj, metasCalc.mes),
          },
          posicaoMes: posicaoMap.get(id) || null,
          totalProfsRanking: totalProfsComMov,
        };
      });
      // Exclui ex-funcionários marcados como inativos, mesmo com histórico.
      const inativos = await getProfsInativos();
      // Remove linhas "fantasma" (IDs históricos sem nome real e sem movimento e sem meta)
      const linhas = linhasRaw.filter(l => {
        if (inativos.has(String(l.profissionalId))) return false;
        if (l.meta) return true;
        // Exclui nome sintético "Profissional <id>" sem meta — IDs legados
        // (hex ou Trinks puro) de snapshots que perderam o vínculo com o
        // profissional real. Sem meta + nome sintético = ruído no ranking.
        if (String(l.nome || "").startsWith("Profissional ")) return false;
        if (l.dia.count > 0 || l.semana.count > 0 || l.mes.count > 0) return true;
        if (l.dia.reais > 0 || l.semana.reais > 0 || l.mes.reais > 0) return true;
        return false;
      });
      linhas.sort((a, b) => b.mes.reais - a.mes.reais);

      const result = {
        ok: true,
        referencia: { hoje, semana: { dataInicio: semIni, dataFim: semFim }, mes, diasUteisTotal, diasUteisDecorridos },
        totais: { dia: dia.totais, semana: semana.totais, mes: mesData.totais },
        config: { taxaCartaoPct: (mesData as any).config?.taxaCartaoPct || 0 },
        linhas,
        _diag: { dia: (dia as any)._diag, semana: (semana as any)._diag, mes: (mesData as any)._diag },
        fetchedAt: new Date().toISOString(),
      };
      setCache(cacheKey, result, 3 * 60 * 1000);
      return res.json(result);
    } catch (err: any) {
      log(`[equipe/desempenho] erro: ${err.message}`, "equipe");
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── EQUIPE: helper p/ montar payload individual ──────────────────
  async function montarPayloadIndividual(
    profissionalId: string,
    incluir: { dia?: boolean; semana?: boolean; mes?: boolean },
  ): Promise<PayloadIndividual | null> {
    const metas = await getAllMetas();
    const meta = metas[profissionalId];
    if (!meta) return null;

    const hoje = ymdHoje();
    const { dataInicio: semIni, dataFim: semFim } = janelaSemanaUtil(hoje);
    const { dataInicio: mesIni, dataFim: mesFim, mes } = janelaMesAtual(hoje);
    const ultimoDia = ultimoDiaDoMes(hoje);
    const diasUteisTotal = contarDiasUteis(`${mes}-01`, ultimoDia);
    const diasUteisDecorridos = contarDiasUteis(`${mes}-01`, hoje);

    const diaData = incluir.dia    ? await calcularPeriodoPorProfissional(hoje, hoje)    : null;
    const semData = incluir.semana ? await calcularPeriodoPorProfissional(semIni, semFim) : null;
    const mesData = incluir.mes    ? await calcularPeriodoPorProfissional(mesIni, mesFim) : null;

    const profDia = diaData?.porProfissional?.[profissionalId];
    const profSem = semData?.porProfissional?.[profissionalId];
    const profMes = mesData?.porProfissional?.[profissionalId];

    let posicaoEquipeMes: { posicao: number; total: number } | undefined;
    if (mesData) {
      const ord = Object.values(mesData.porProfissional).sort((a, b) => b.total.reais - a.total.reais);
      const idx = ord.findIndex(p => p.profissionalId === profissionalId);
      if (idx >= 0) posicaoEquipeMes = { posicao: idx + 1, total: ord.length };
    }

    return {
      profissional: { id: profissionalId, nome: meta.nome },
      meta,
      dia: profDia ? { dataReferencia: hoje, reais: profDia.total.reais, count: profDia.total.count, avulsoReais: profDia.avulso.reais, avulsoCount: profDia.avulso.count, planoReais: profDia.plano.reais, planoCount: profDia.plano.count, servicosReais: profDia.servicos.reais, servicosCount: profDia.servicos.count, servicosBruto: profDia.servicos.bruto, servicosLiquido: profDia.servicos.liquido, produtosReais: profDia.produtos.reais, produtosCount: profDia.produtos.count, produtosBruto: profDia.produtos.bruto, produtosLiquido: profDia.produtos.liquido, produtosBrutoComissionavel: profDia.produtos.brutoComissionavel || 0, produtosLiquidoComissionavel: profDia.produtos.liquidoComissionavel || 0 } : undefined,
      semana: profSem ? { dataInicio: semIni, dataFim: semFim, reais: profSem.total.reais, count: profSem.total.count, avulsoReais: profSem.avulso.reais, avulsoCount: profSem.avulso.count, planoReais: profSem.plano.reais, planoCount: profSem.plano.count, servicosReais: profSem.servicos.reais, servicosCount: profSem.servicos.count, servicosBruto: profSem.servicos.bruto, servicosLiquido: profSem.servicos.liquido, produtosReais: profSem.produtos.reais, produtosCount: profSem.produtos.count, produtosBruto: profSem.produtos.bruto, produtosLiquido: profSem.produtos.liquido, produtosBrutoComissionavel: profSem.produtos.brutoComissionavel || 0, produtosLiquidoComissionavel: profSem.produtos.liquidoComissionavel || 0 } : undefined,
      mes: profMes ? { mes, diasUteisDecorridos, diasUteisTotal, reais: profMes.total.reais, count: profMes.total.count, avulsoReais: profMes.avulso.reais, avulsoCount: profMes.avulso.count, planoReais: profMes.plano.reais, planoCount: profMes.plano.count, servicosReais: profMes.servicos.reais, servicosCount: profMes.servicos.count, servicosBruto: profMes.servicos.bruto, servicosLiquido: profMes.servicos.liquido, produtosReais: profMes.produtos.reais, produtosCount: profMes.produtos.count, produtosBruto: profMes.produtos.bruto, produtosLiquido: profMes.produtos.liquido, produtosBrutoComissionavel: profMes.produtos.brutoComissionavel || 0, produtosLiquidoComissionavel: profMes.produtos.liquidoComissionavel || 0 } : undefined,
      posicaoEquipeMes,
    };
  }

  // POST /api/telegram/individual/:tipo/:id — envia para um profissional
  app.post("/api/telegram/individual/:tipo/:id", async (req: Request, res: Response) => {
    try {
      const tipo = String(req.params.tipo).toLowerCase();
      const id = String(req.params.id);
      if (!["diario", "matinal", "semanal", "mensal"].includes(tipo)) {
        return res.status(400).json({ ok: false, error: `tipo inválido: ${tipo}` });
      }
      const incluir = (tipo === "diario" || tipo === "matinal") ? { dia: true, mes: true } :
                      tipo === "semanal" ? { semana: true, mes: true } :
                                           { mes: true };
      // Para 'matinal' o dia de referência é o último dia útil anterior; demais usam hoje.
      const dataDia = tipo === "matinal" ? diaUtilAnterior(ymdHoje()) : undefined;
      const payload = await montarPayloadIndividual(id, incluir, { dataDia });
      if (!payload) return res.status(404).json({ ok: false, error: "meta não cadastrada para este profissional" });
      const texto =
        tipo === "diario"  ? montarResumoDiarioIndividual(payload)  :
        tipo === "matinal" ? montarResumoMatinalIndividual(payload) :
        tipo === "semanal" ? montarResumoSemanalIndividual(payload) :
                             montarResumoMensalIndividual(payload);
      const r = await enviarParaProfissional(payload.meta, texto);
      return res.json({ ...r, enviado: r.ok, preview: texto });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/telegram/individual/:tipo — envia para todos os ativos
  app.post("/api/telegram/individual/:tipo", async (req: Request, res: Response) => {
    try {
      const tipo = String(req.params.tipo).toLowerCase();
      if (!["diario", "matinal", "semanal", "mensal"].includes(tipo)) {
        return res.status(400).json({ ok: false, error: `tipo inválido: ${tipo}` });
      }
      const ativas = await listarMetasAtivas();
      if (ativas.length === 0) return res.json({ ok: true, total: 0, results: [], aviso: "Nenhuma meta com envio ativo" });
      const incluir = (tipo === "diario" || tipo === "matinal") ? { dia: true, mes: true } :
                      tipo === "semanal" ? { semana: true, mes: true } :
                                           { mes: true };
      const dataDia = tipo === "matinal" ? diaUtilAnterior(ymdHoje()) : undefined;
      const results: any[] = [];
      for (const meta of ativas) {
        try {
          const payload = await montarPayloadIndividual(meta.profissionalId, incluir, { dataDia });
          if (!payload) { results.push({ id: meta.profissionalId, ok: false, error: "sem payload" }); continue; }
          const texto =
            tipo === "diario"  ? montarResumoDiarioIndividual(payload)  :
            tipo === "matinal" ? montarResumoMatinalIndividual(payload) :
            tipo === "semanal" ? montarResumoSemanalIndividual(payload) :
                                 montarResumoMensalIndividual(payload);
          const r = await enviarParaProfissional(meta, texto);
          results.push({ id: meta.profissionalId, nome: meta.nome, ok: r.ok, viaProprio: r.viaProprio, error: r.error });
        } catch (err: any) {
          results.push({ id: meta.profissionalId, ok: false, error: err.message });
        }
        await new Promise(r => setTimeout(r, 250));
      }
      return res.json({ ok: true, total: ativas.length, results });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── Scheduler (cron interno) ───────────────────────────────
  // Roda de terça a sábado (dia de funcionamento) em TZ America/Sao_Paulo
  // 8h — resumo da manhã; 20h — fechamento do dia
  if (isTelegramConfigured()) {
    try {
      // Manhã: 08:00 ter-sab (dias 2-6 da semana)
      // Mostra FECHAMENTO do dia anterior + PREVISÃO do dia atual.
      // Otimização F: após o resumo geral, dispara o matinal individual no MESMO cron.
      // O cache de agendamentos/transacoes do dia (e do dia anterior) já está quente,
      // então cada profissional reaproveita via trinksFetchAllRange (zero fetches Trinks adicionais).
      cron.schedule("0 8 * * 2-6", async () => { await comOrigem("cron-manha", async () => {
        log("[cron] disparando resumo da manhã (única mensagem do dia)...", "telegram");
        try {
          const [hoje, ontem, amanhaData, pagamentos, acumulado] = await Promise.all([
            calcularHojeCompleto(),
            calcularOntemFechado().catch(() => null),
            calcularAmanha().catch(() => null),
            montarPagamentosHoje(),
            montarAcumuladoSemanaMes().catch(() => null),
          ]);
          const msg = montarResumoManha(hoje, amanhaData, ontem, pagamentos, acumulado);
          const r = await enviarMensagem(msg);
          log(`[cron] resumo manhã: ${r.ok ? "OK" : "FALHOU: " + r.error} (${pagamentos.length} pagamentos)`, "telegram");
        } catch (err: any) {
          log(`[cron] erro resumo manhã: ${err.message}`, "telegram");
          // Fallback: avisa que o sistema está vivo mas a Trinks falhou.
          // Pagamentos ainda são avisados separadamente para não perder a info.
          try {
            const isRate = err?.status === 429 || /limite|429|rate/i.test(err?.message || "");
            const motivo = isRate
              ? "limite de requisições da Trinks excedido"
              : `falha ao consultar Trinks (${err?.message || "erro desconhecido"})`;
            const pagamentos = await montarPagamentosHoje();
            let aviso = `⚠️ *Resumo da manhã indisponível*\n\nNão foi possível gerar o resumo agora: ${motivo}.\n\nAbra o Dashboard para ver os números do CSV.`;
            if (pagamentos.length > 0) {
              aviso += `\n\n💸 *Pagamentos de hoje:*\n`;
              for (const p of pagamentos) {
                aviso += `· ${p.nome}${p.valor ? " — R$ " + p.valor.toFixed(2) : ""}\n`;
              }
            }
            await enviarMensagem(aviso);
            log("[cron] aviso de falha (manhã) + pagamentos enviado", "telegram");
          } catch (e2: any) {
            log(`[cron] falha também no aviso de manhã: ${e2?.message}`, "telegram");
          }
        }
        // Mensagens individuais aos barbeiros foram desativadas em 21/06/2026.
      }); }, { timezone: "America/Sao_Paulo" });

      // Noite: 20:00 ter-sab — DESATIVADO em 21/06/2026 (só mensagem matinal fica)
      if (false) cron.schedule("0 20 * * 2-6", async () => { await comOrigem("cron-noite", async () => {
        log("[cron] disparando resumo da noite...", "telegram");
        try {
          const hoje = await calcularHojeCompleto();
          const msg = montarResumoNoite(hoje);
          const r = await enviarMensagem(msg);
          log(`[cron] resumo noite: ${r.ok ? "OK" : "FALHOU: " + r.error}`, "telegram");
        } catch (err: any) {
          log(`[cron] erro resumo noite: ${err.message}`, "telegram");
          // Fallback: avisa que o sistema está vivo mas a Trinks falhou
          try {
            const isRate = err?.status === 429 || /limite|429|rate/i.test(err?.message || "");
            const motivo = isRate
              ? "limite de requisições da Trinks excedido"
              : `falha ao consultar Trinks (${err?.message || "erro desconhecido"})`;
            const aviso = `⚠️ *Resumo da noite indisponível*\n\nNão foi possível fechar o dia agora: ${motivo}.\n\nO sistema continua rodando — amanhã cedo tento de novo. Para conferir o dia, abra o Dashboard (dados do CSV).`;
            await enviarMensagem(aviso);
            log("[cron] aviso de falha (noite) enviado", "telegram");
          } catch (e2: any) {
            log(`[cron] falha também no aviso de noite: ${e2?.message}`, "telegram");
          }
        }
      }); }, { timezone: "America/Sao_Paulo" });

      // ─── Crons individuais por profissional (Equipe) ───
      // Helper que dispara mensagem individual para todos ativos
      async function dispararIndividualParaTodos(tipo: "matinal" | "diario" | "semanal" | "mensal") {
        try {
          const ativas = await listarMetasAtivas();
          if (ativas.length === 0) {
            log(`[cron] individual ${tipo}: nenhuma meta ativa`, "telegram");
            return;
          }
          const incluir = (tipo === "diario" || tipo === "matinal") ? { dia: true, mes: true } :
                          tipo === "semanal" ? { semana: true, mes: true } :
                                               { mes: true };
          const dataDia = tipo === "matinal" ? diaUtilAnterior(ymdHoje()) : undefined;
          let okCount = 0, falhas = 0;
          for (const meta of ativas) {
            try {
              const payload = await montarPayloadIndividual(meta.profissionalId, incluir, { dataDia });
              if (!payload) { falhas++; continue; }
              const texto =
                tipo === "diario"  ? montarResumoDiarioIndividual(payload)  :
                tipo === "matinal" ? montarResumoMatinalIndividual(payload) :
                tipo === "semanal" ? montarResumoSemanalIndividual(payload) :
                                     montarResumoMensalIndividual(payload);
              const r = await enviarParaProfissional(meta, texto);
              if (r.ok) okCount++; else falhas++;
            } catch (err: any) {
              falhas++;
              log(`[cron] individual ${tipo} ${meta.nome}: erro ${err.message}`, "telegram");
            }
            await new Promise(r => setTimeout(r, 300));
          }
          log(`[cron] individual ${tipo}: ${okCount}/${ativas.length} enviados (falhas: ${falhas})`, "telegram");
        } catch (err: any) {
          log(`[cron] individual ${tipo}: erro geral ${err.message}`, "telegram");
        }
      }

      // Otimização F: matinal individual foi CONSOLIDADO no cron do resumo geral das 8h acima
      // (evita 2 crons disparando ao mesmo tempo e disputando o rate limit Trinks).

      // Semanal individual: sábado 21h
      // Semanal sáb 21h — DESATIVADO em 21/06/2026
      if (false) cron.schedule("0 21 * * 6", async () => { await comOrigem("cron-semanal", async () => {
        log("[cron] disparando resumo semanal individual (Equipe)...", "telegram");
        await dispararIndividualParaTodos("semanal");
      }); }, { timezone: "America/Sao_Paulo" });

      // Mensal individual: 28-31 do mês às 21h, ter-sáb,
      // e só dispara se hoje for o último dia útil do mês.
      // Mensal último dia útil 21h — DESATIVADO em 21/06/2026
      if (false) cron.schedule("0 21 28-31 * 2-6", async () => {
        const hoje = ymdHoje();
        const ultimo = ultimoDiaDoMes(hoje);
        // Avançar dia a dia a partir de hoje até o último dia do mês:
        // se nenhum desses for dia útil (ter-sáb), então hoje é o último dia útil do mês.
        const [y, m, d] = hoje.split("-").map(Number);
        const [, , ld] = ultimo.split("-").map(Number);
        let temDiaUtilDepois = false;
        for (let dd = d + 1; dd <= ld; dd++) {
          const dow = new Date(Date.UTC(y, m - 1, dd, 12)).getUTCDay();
          if (dow >= 2 && dow <= 6) { temDiaUtilDepois = true; break; }
        }
        if (temDiaUtilDepois) {
          log(`[cron] mensal individual pulado: ${hoje} não é o último dia útil`, "telegram");
          return;
        }
        log(`[cron] disparando resumo mensal individual (último dia útil: ${hoje})...`, "telegram");
        await dispararIndividualParaTodos("mensal");
      }, { timezone: "America/Sao_Paulo" });

      // Alerta diário de estoque baixo: ter-sáb 09h00 (após o resumo da manhã)
      // Envia uma mensagem consolidada com produtos abaixo do mínimo cadastrado.
      // Alerta estoque 09h — DESATIVADO em 21/06/2026 (só matinal 8h fica)
      if (false) cron.schedule("0 9 * * 2-6", async () => { await comOrigem("cron-estoque", async () => {
        try {
          const resumo = await calcularEstoqueResumo();
          const ruptura = (resumo?.produtos || []).filter((p: any) => p.nivel === "ruptura");
          if (ruptura.length === 0) {
            log("[cron] alerta estoque: nenhum produto em ruptura", "telegram");
            return;
          }
          const linhas = ruptura
            .sort((a: any, b: any) => (a.saldo - a.minimo) - (b.saldo - b.minimo))
            .slice(0, 30)
            .map((p: any) => {
              const fmt = (n: number) => Number(n || 0).toLocaleString("pt-BR");
              return `• *${p.nome}* — saldo *${fmt(p.saldo)}* / mínimo ${fmt(p.minimo)}`;
            })
            .join("\n");
          const extras = ruptura.length > 30 ? `\n\n_+ ${ruptura.length - 30} outros itens_` : "";
          const msg = `📦 *Alerta de estoque baixo*\n\n${ruptura.length} produto(s) abaixo do mínimo:\n\n${linhas}${extras}`;
          const r = await enviarMensagem(msg);
          log(`[cron] alerta estoque: ${ruptura.length} itens, ${r.ok ? "OK" : "FALHOU: " + r.error}`, "telegram");
        } catch (err: any) {
          log(`[cron] erro alerta estoque: ${err.message}`, "telegram");
        }
      }); }, { timezone: "America/Sao_Paulo" });

      // v36 Fase 2 / v79: Cron noturno de SNAPSHOT — FECHAMENTO do dia às 23:50 SP
      // todo dia. Fecha os valores do dia (+ refina ontem) pra o dono trabalhar no
      // dia seguinte. Alimenta o painel (lê do snapshot, 0 token). Em csv-first,
      // preferirCsv:true pra não queimar Trinks quando o CSV já tem o dia.
      cron.schedule("50 23 * * *", async () => { await comOrigem("cron-snapshot-23h50", async () => {
        try {
          const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          const ontem = (() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          })();
          const preferirCsv = getModoFonte() === "csv-first";
          log(`[cron-snapshot] capturando ${ontem} e ${hoje} (preferirCsv=${preferirCsv})...`, "snapshot");
          const snapOntem = await capturarSnapshotDia(ontem, { preferirCsv });
          const snapHoje = await capturarSnapshotDia(hoje, { preferirCsv });
          log(`[cron-snapshot] ontem ${ontem}: fonte=${snapOntem.fonte} R$${snapOntem.faturamento.total.toFixed(2)} | hoje ${hoje}: fonte=${snapHoje.fonte} R$${snapHoje.faturamento.total.toFixed(2)}`, "snapshot");
        } catch (err: any) {
          log(`[cron-snapshot] erro: ${err.message}`, "snapshot");
        }
      }); }, { timezone: "America/Sao_Paulo" });

      // v81: Cron MATINAL — lê o e-mail "Resumo do dia" da Trinks (Gmail IMAP) e
      // grava o fechamento de ontem como snapshot OFICIAL (0 token Trinks). 7h SP.
      cron.schedule("0 7 * * *", async () => {
        try {
          const r = await sincronizarEmailsTrinks({ dias: 3, max: 5 });
          log(`[cron-trinks-email] ${r.ok ? `processados ${r.processados}` : "erro: " + r.erro}`, "trinks-email");
        } catch (err: any) {
          log(`[cron-trinks-email] erro: ${err.message}`, "trinks-email");
        }
      }, { timezone: "America/Sao_Paulo" });

      // Cron matinal de refinamento — 6h SP recaptura ontem (caso o CSV do email
      // tenha chegado durante a madrugada com status mais atualizado)
      // v54: DESATIVADO p/ economizar cota Trinks — o snapshot 23h30 já captura ontem.
      if (false) cron.schedule("0 6 * * *", async () => { await comOrigem("cron-snapshot-refino-6h", async () => {
        try {
          const ontem = (() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          })();
          const preferirCsv = getModoFonte() === "csv-first";
          log(`[cron-snapshot] refinando snapshot de ${ontem} (preferirCsv=${preferirCsv})...`, "snapshot");
          const snap = await capturarSnapshotDia(ontem, { preferirCsv });
          log(`[cron-snapshot] refinamento ${ontem}: fonte=${snap.fonte} R$${snap.faturamento.total.toFixed(2)}`, "snapshot");
        } catch (err: any) {
          log(`[cron-snapshot] erro refinamento: ${err.message}`, "snapshot");
        }
      }); }, { timezone: "America/Sao_Paulo" });

      // ─── Lembrete CSV 19h ter-sáb ─────────────────────────────────────────
      // Em modo csv-first, o sistema depende do upload diário do relatório Trinks.
      // Este cron lembra o usuário antes do fechamento das 20h, para garantir que
      // o resumo da noite tenha dados frescos.
      // Lembrete CSV 19h — DESATIVADO em 21/06/2026
      if (false) cron.schedule("0 19 * * 2-6", async () => {
        try {
          // Só envia se estamos em modo csv-first
          if (getModoFonte() !== "csv-first") {
            log("[cron] lembrete CSV pulado: modo não é csv-first", "telegram");
            return;
          }
          // Só manda se o CSV de hoje (mês atual) parece desatualizado
          // (importado há mais de 12h ou nunca importado neste mês)
          const mesAtual = ymdHoje().slice(0, 7); // "YYYY-MM"
          const meta = await resolverFonte(mesAtual);
          const csvAt = meta.csvAt ? new Date(meta.csvAt).getTime() : 0;
          const horasDesdeUltimoCsv = csvAt ? (Date.now() - csvAt) / (60 * 60 * 1000) : 999;
          if (horasDesdeUltimoCsv < 12) {
            log(`[cron] lembrete CSV pulado: CSV atualizado há ${horasDesdeUltimoCsv.toFixed(1)}h`, "telegram");
            return;
          }
          const ultimoUploadTxt = meta.csvAt
            ? new Date(meta.csvAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
            : "nunca";
          const aviso = `⏰ *Lembrete: subir o CSV do dia*\n\nO sistema agora usa o CSV da Trinks como fonte principal.\n\nÚltimo upload: *${ultimoUploadTxt}*\n\nPara o resumo da noite (20h) sair com os números corretos:\n1. Entre no painel Trinks → Relatórios → Financeiro\n2. Exporte o CSV de hoje\n3. Suba em [grecocontrol.com.br/importar-trinks](https://grecocontrol.com.br/importar-trinks)\n\nSe já subiu, pode ignorar.`;
          const r = await enviarMensagem(aviso);
          log(`[cron] lembrete CSV: ${r.ok ? "OK" : "FALHOU: " + r.error}`, "telegram");
        } catch (err: any) {
          log(`[cron] erro lembrete CSV: ${err.message}`, "telegram");
        }
      }, { timezone: "America/Sao_Paulo" });

      log("[cron] schedulers Telegram ativos: geral 8h/20h (ter-sáb) + lembrete CSV 19h (ter-sáb) + alerta estoque 9h (ter-sáb) + individual MATINAL 8h/SEMANAL sáb 21h/MENSAL último dia útil 21h + snapshot 23h30 (refinamento 6h)", "telegram");
    } catch (err: any) {
      log(`[cron] falha ao registrar schedulers: ${err.message}`, "telegram");
    }
  } else {
    log("[cron] TELEGRAM_BOT_TOKEN não configurado — schedulers desativados", "telegram");
  }

  // ─── Pré-fetch noturno: 03h SP, todo dia ──────────────────────────
  // Baixa em UMA chamada agendamentos+transações do mês corrente
  // (1º até ontem). Como dataFim < hoje, fica em cache por 7 dias.
  // Próximas consultas a qualquer dia passado do mês servem do cache
  // via trinksTryFromCachedRange — zero chamadas Trinks extras.
  // Economia: ~150 chamadas/mês por usuário ativo no dashboard.
  // v54: pré-fetch 03h DESATIVADO p/ economizar cota Trinks. O snapshot 23h30
  // (csv-first) já captura o dia; com a Trinks em 429 crônico, o pré-fetch só
  // queimava retries. Religar = trocar `if (false)` por `if (true)`.
  try {
    if (false) cron.schedule("0 3 * * *", async () => {
      try {
        const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const ontemSP = (() => {
          const d = new Date(hojeSP + "T12:00:00");
          d.setDate(d.getDate() - 1);
          return d.toISOString().slice(0, 10);
        })();
        const primeiroDoMes = `${hojeSP.slice(0, 7)}-01`;
        if (ontemSP < primeiroDoMes) {
          log(`[prefetch] primeiro dia do mês — nada a pré-buscar`, "trinks");
          return;
        }
        log(`[prefetch] aquecendo cache ${primeiroDoMes}..${ontemSP} (transFim=${hojeSP})...`, "trinks");
        const [trans, agend] = await Promise.allSettled([
          trinksFetchAllRange("transacoes", { dataInicio: primeiroDoMes, dataFim: hojeSP }),
          trinksFetchAllRange("agendamentos", { dataInicio: primeiroDoMes, dataFim: ontemSP }),
        ]);
        const tCount = trans.status === "fulfilled" && Array.isArray(trans.value) ? trans.value.length : 0;
        const aCount = agend.status === "fulfilled" && Array.isArray(agend.value) ? agend.value.length : 0;
        log(`[prefetch] cache aquecido — transacoes=${tCount} agendamentos=${aCount}`, "trinks");
      } catch (err: any) {
        log(`[prefetch] erro: ${err?.message || err}`, "trinks");
      }
    }, { timezone: "America/Sao_Paulo" });
    log("[cron] pré-fetch noturno 03h DESATIVADO (economia de cota)", "trinks");
  } catch (err: any) {
    log(`[cron] falha registrar pré-fetch: ${err.message}`, "trinks");
  }

  // ──────────────────────────────────────────────────────────────────
  // CONSELHEIRO IA — consultor estratégico com Claude Opus
  // ──────────────────────────────────────────────────────────────────

  // Calcula o faturamento de um mês a partir das transações da Trinks.
  // Usa trinksFetchAllRange (cache 24h em meses fechados, 30min no corrente).
  async function calcularFaturamentoTrinksMes(mes: string): Promise<{
    total: number; count: number; clientes: number;
    pix: number; cartao: number; dinheiro: number; outros: number;
  } | null> {
    try {
      const [yStr, mStr] = mes.split("-");
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const ultimoDia = new Date(y, m, 0).getDate();
      const dataInicio = `${mes}-01`;
      const dataFim = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
      // v55: csv-first — só faturamento/formas (CSV tem); mês fechado = 0 API.
      const transacoes = await transacoesMesCsvFirst(mes);
      if (!Array.isArray(transacoes) || transacoes.length === 0) return null;

      let total = 0, pix = 0, cartao = 0, dinheiro = 0, outros = 0;
      const clientes = new Set<any>();
      for (const t of transacoes) {
        const val = Number(t.totalPagar ?? t.valor ?? 0);
        total += val;
        const cid = t.cliente?.id ?? t.clienteId;
        if (cid) clientes.add(cid);
        const formas = t.formasPagamentos || t.formasPagamento || [];
        if (Array.isArray(formas) && formas.length > 0) {
          for (const fp of formas) {
            const nome = String(fp.nome || fp.descricao || "").toLowerCase();
            const v = Number(fp.valor || 0);
            if (nome.includes("pix")) pix += v;
            else if (/créd|cred|déb|deb|cart/.test(nome)) cartao += v;
            else if (/dinhe|espécie|especie|à vista|a vista/.test(nome)) dinheiro += v;
            else outros += v;
          }
        } else {
          const nome = String(t.formaPagamento || t.metodoPagamento || "").toLowerCase();
          if (nome.includes("pix")) pix += val;
          else if (/cart/.test(nome)) cartao += val;
          else if (/dinhe/.test(nome)) dinheiro += val;
          else outros += val;
        }
      }
      return { total, count: transacoes.length, clientes: clientes.size, pix, cartao, dinheiro, outros };
    } catch (err: any) {
      log(`Conselheiro: trinksFetchAllRange falhou para ${mes}: ${err.message}`, "conselheiro");
      return null;
    }
  }

  async function getConselheiroSources(): Promise<ConselheiroDataSources> {
    const trinksFinanceiroPorMes: Record<string, any> = {};
    const trinksDREPorMes: Record<string, any> = {};

    // 1. Imports CSV (lê do kv_store — barato)
    const csvFinanceiro: Record<string, any> = {};
    const csvImportadoEm: Record<string, string> = {};
    try {
      const idx = await loadTrinksImportIndex();
      const promessas: Promise<void>[] = [];
      for (const [chave, summary] of Object.entries(idx)) {
        if (!summary || !summary.mes) continue;
        if (summary.tipo === "financeiro") {
          csvImportadoEm[summary.mes] = summary.importadoEm || "";
          promessas.push(
            kvGet<any>(chave).then(p => {
              if (p) {
                csvFinanceiro[summary.mes] = {
                  totalValor: p.totalValor || 0,
                  totalLinhas: p.totalLinhas || 0,
                  resumoPorForma: p.resumoPorForma || {},
                  resumoPorDia: p.resumoPorDia || {},
                };
              }
            }).catch(() => {})
          );
        } else if (summary.tipo === "dre") {
          promessas.push(
            kvGet<any>(chave).then(p => {
              if (p) {
                trinksDREPorMes[summary.mes] = {
                  totalReceitas: p.totalReceitas || 0,
                  totalDespesas: p.totalDespesas || 0,
                  resultadoPeriodo: p.resultadoPeriodo || 0,
                };
              }
            }).catch(() => {})
          );
        }
      }
      await Promise.all(promessas);
    } catch (err: any) {
      log(`Conselheiro: erro carregando trinks_import: ${err.message}`, "conselheiro");
    }

    // 2. Trinks ao vivo (mês corrente + 3 anteriores) — usa cache 24h em meses fechados
    const now = new Date();
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const mesesParaTrinks: string[] = [];
    for (let k = 0; k < 4; k++) {
      const dt = new Date(now.getFullYear(), now.getMonth() - k, 1);
      mesesParaTrinks.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
    }
    const trinksLive: Record<string, any> = {};
    if (trinksConfig) {
      const results = await Promise.all(
        mesesParaTrinks.map(async (mes) => {
          const r = await calcularFaturamentoTrinksMes(mes);
          return { mes, r };
        })
      );
      for (const { mes, r } of results) {
        if (r) trinksLive[mes] = r;
      }
    }

    // 3. Resolução "mais recente vence" para cada mês
    //    - Se Trinks ao vivo tem dados → considera mais novo que CSV (Trinks é always-fresh)
    //    - Senão, usa CSV
    const todosMeses = new Set([...Object.keys(csvFinanceiro), ...Object.keys(trinksLive)]);
    for (const mes of todosMeses) {
      const tr = trinksLive[mes];
      const csv = csvFinanceiro[mes];
      if (tr && csv) {
        // Ambos: usa o de MAIOR total (assumindo que Trinks reflete o estado real;
        // se CSV é maior, provavelmente é porque Trinks ainda não consolidou o mês fechado)
        const useTrinks = tr.total >= csv.totalValor;
        trinksFinanceiroPorMes[mes] = useTrinks
          ? { totalValor: tr.total, totalLinhas: tr.count, resumoPorForma: { Pix: tr.pix, Cartão: tr.cartao, Dinheiro: tr.dinheiro, Outros: tr.outros } }
          : csv;
      } else if (tr) {
        trinksFinanceiroPorMes[mes] = {
          totalValor: tr.total,
          totalLinhas: tr.count,
          resumoPorForma: { Pix: tr.pix, Cartão: tr.cartao, Dinheiro: tr.dinheiro, Outros: tr.outros },
        };
      } else if (csv) {
        trinksFinanceiroPorMes[mes] = csv;
      }
    }

    // 4. Mês corrente — preferir trinksLive[mesAtual], cair pra cache de "hoje" + sync
    let trinksMesCorrente: any | undefined;
    if (trinksLive[mesAtual]) {
      const r = trinksLive[mesAtual];
      trinksMesCorrente = {
        faturamento: r.total,
        clientes: r.clientes,
        agendamentosCount: 0,
        pix: r.pix, cartao: r.cartao, dinheiro: r.dinheiro, outros: r.outros,
      };
      const sync = getCached("full_sync");
      if (sync && Array.isArray(sync.agendamentos)) {
        trinksMesCorrente.agendamentosCount = sync.agendamentos.filter((a: any) =>
          typeof a.dataHoraInicio === "string" && a.dataHoraInicio.startsWith(mesAtual)
        ).length;
      }
    } else {
      // Fallback: cache de hoje (caso trinksFetchAllRange tenha falhado)
      try {
        const hojeStr = now.toISOString().slice(0, 10);
        const hojeCache = getCached(`hoje_${hojeStr}`);
        if (hojeCache && typeof hojeCache.total === "number") {
          const b = hojeCache.breakdown || {};
          trinksMesCorrente = {
            faturamento: hojeCache.total,
            clientes: hojeCache.count || 0,
            agendamentosCount: 0,
            pix: b.pix || 0, cartao: b.cartao || 0, dinheiro: b.dinheiro || 0, outros: b.outros || 0,
          };
        }
      } catch {}
    }

    // Pipeline de agendamentos futuros + caixa de hoje (lê do cache do sync e do hoje_)
    let pipeline: any | undefined;
    let hojeResumo: any | undefined;
    // Mapa servicoId -> preço (usado tanto no pipeline quanto no top serviços)
    const precoPorServicoId = new Map<number, number>();
    try {
      const sync0 = getCached("full_sync");
      if (sync0 && Array.isArray(sync0.servicos)) {
        for (const s of sync0.servicos) {
          if (s?.id) precoPorServicoId.set(Number(s.id), Number(s.preco || 0));
        }
      }
    } catch {}
    try {
      const now = new Date();
      const hojeStr = now.toISOString().slice(0, 10);

      // Caixa fechado de hoje (cache de /api/trinks/hoje)
      const hojeCache = getCached(`hoje_${hojeStr}`);
      if (hojeCache && typeof hojeCache.total === "number") {
        const b = hojeCache.breakdown || {};
        // Ritmo: faturamento de hoje vs média diária do mês até ontem
        // Não fazemos divisão se ainda não tem média (primeiro dia do mês).
        let ritmoVsMedia = 0;
        const finPorMes = trinksFinanceiroPorMes[mesAtual];
        if (finPorMes && finPorMes.totalValor > 0 && now.getDate() > 1) {
          const totalAteOntem = finPorMes.totalValor - hojeCache.total;
          const diasAteOntem = now.getDate() - 1;
          if (totalAteOntem > 0 && diasAteOntem > 0) {
            const mediaDiaria = totalAteOntem / diasAteOntem;
            if (mediaDiaria > 0) ritmoVsMedia = (hojeCache.total - mediaDiaria) / mediaDiaria;
          }
        }
        hojeResumo = {
          faturamento: hojeCache.total,
          comandas: hojeCache.count || 0,
          pix: b.pix || 0,
          cartao: b.cartao || 0,
          dinheiro: b.dinheiro || 0,
          outros: b.outros || 0,
          ritmo_vs_media: ritmoVsMedia,
        };
      }

      // Pipeline: agendamentos a partir de hoje no cache do sync
      const sync = getCached("full_sync");
      if (sync && Array.isArray(sync.agendamentos)) {
        // Limite da semana corrente: domingo da próxima semana
        const dow = now.getDay(); // 0..6
        const fimSemana = new Date(now);
        fimSemana.setDate(now.getDate() + (7 - dow));
        const fimSemanaStr = fimSemana.toISOString().slice(0, 10);

        let qtdSemana = 0, valorSemana = 0;
        let qtdMes = 0, valorMes = 0;
        for (const a of sync.agendamentos) {
          const dt = String(a.dataHoraInicio || "").slice(0, 10);
          if (!dt || dt < hojeStr || !dt.startsWith(mesAtual)) continue;
          const status = String(a.status?.nome || "").toLowerCase();
          if (status === "cancelado" || status === "finalizado" || status === "realizado") continue;
          const svcId = Number(a.servico?.id || 0);
          const valor = precoPorServicoId.get(svcId) ?? Number(a.servico?.preco || a.valor || 0);
          qtdMes += 1;
          valorMes += valor;
          if (dt < fimSemanaStr) {
            qtdSemana += 1;
            valorSemana += valor;
          }
        }
        pipeline = {
          semana: { qtd: qtdSemana, valor: valorSemana },
          mes: { qtd: qtdMes, valor: valorMes },
        };
      }
    } catch (err: any) {
      log(`Conselheiro: erro montando pipeline/hoje: ${err.message}`, "conselheiro");
    }

    // Top serviços do mês corrente — vêm dos agendamentos finalizados (cache do sync)
    let topServicosMes: any[] = [];
    try {
      const sync = getCached("full_sync");
      if (sync && Array.isArray(sync.agendamentos)) {
        const counter = new Map<string, { nome: string; quantidade: number; receita: number }>();
        for (const a of sync.agendamentos) {
          const status = String(a.status?.nome || "").toLowerCase();
          if (status !== "finalizado" && status !== "realizado" && status !== "concluído" && status !== "concluido") continue;
          const dt = String(a.dataHoraInicio || "").slice(0, 7);
          if (dt !== mesAtual) continue;
          const nome = String(a.servico?.nome || "").trim();
          if (!nome) continue;
          const svcId = Number(a.servico?.id || 0);
          const preco = precoPorServicoId.get(svcId) ?? Number(a.servico?.preco || a.valor || 0);
          const cur = counter.get(nome) || { nome, quantidade: 0, receita: 0 };
          cur.quantidade += 1;
          cur.receita += preco;
          counter.set(nome, cur);
        }
        topServicosMes = Array.from(counter.values())
          .sort((a, b) => b.quantidade - a.quantidade)
          .slice(0, 5)
          .map(s => ({ ...s, preco_medio: s.quantidade > 0 ? s.receita / s.quantidade : 0 }));
      }
    } catch (err: any) {
      log(`Conselheiro: erro montando top serviços: ${err.message}`, "conselheiro");
    }

    // Ranking de barbeiros + folha real do mês corrente — reusa o cálculo da Pagamento
    let rankingBarbeirosMes: any[] = [];
    let folhaReal: any | undefined;
    try {
      const dataInicio = `${mesAtual}-01`;
      const [yy, mm] = mesAtual.split("-").map(Number);
      const ultimoDia = new Date(yy, mm, 0).getDate();
      const dataFimReal = `${mesAtual}-${String(ultimoDia).padStart(2, "0")}`;
      const hojeYmd = new Date().toISOString().slice(0, 10);
      const dataFim = hojeYmd < dataFimReal ? hojeYmd : dataFimReal;

      const [periodo, metas, pagamentosMes] = await Promise.all([
        calcularPeriodoPorProfissional(dataInicio, dataFim),
        getAllMetas(),
        getPagamentosDoMes(mesAtual),
      ]);

      rankingBarbeirosMes = Object.values(periodo.porProfissional)
        .map((p: any) => ({
          profissionalId: p.profissionalId,
          nome: p.nome,
          faturamento: Number(p.total?.reais || 0),
          atendimentos: Number(p.total?.count || 0),
        }))
        .filter(r => r.faturamento > 0 || r.atendimentos > 0);

      // Folha real: soma totalBruto + saldoAReceber agregando todos os profissionais com movimento
      const idsParaFolha = new Set<string>();
      Object.keys(periodo.porProfissional).forEach(id => idsParaFolha.add(id));
      Object.keys(metas).forEach(id => idsParaFolha.add(id));
      const linhas = await Promise.all(
        Array.from(idsParaFolha).map(id => calcularLinhaPagamento(mesAtual, id, periodo.porProfissional[id], metas[id], pagamentosMes[id]))
      );
      const linhasComMovimento = linhas.filter(l => l.calculos.totalBruto > 0 || l.bases.servicosLiquido > 0);
      folhaReal = {
        totalBruto: linhasComMovimento.reduce((s, l) => s + l.calculos.totalBruto, 0),
        totalSaldoAPagar: linhasComMovimento.reduce((s, l) => s + l.pagamento.saldoAReceber, 0),
        qtdProfissionaisComMovimento: linhasComMovimento.length,
      };
    } catch (err: any) {
      log(`Conselheiro: erro montando ranking/folha: ${err.message}`, "conselheiro");
    }

    return {
      entries: (storeData.entries as any) || [],
      barbers: (storeData.barbers as any) || [],
      services: (storeData.services as any) || [],
      financeEntries,
      assinaturaClientes,
      metasHistorico,
      monthlyTarget: storeData.settings?.monthlyTarget,
      shopName: storeData.settings?.shopName,
      trinksFinanceiroPorMes,
      trinksDREPorMes,
      trinksMesCorrente,
      rankingBarbeirosMes,
      topServicosMes,
      folhaReal,
      pipeline,
      hoje: hojeResumo,
    };
  }

  app.get("/api/conselheiro/dados", async (req: Request, res: Response) => {
    try {
      // ?force=true só invalida o cache do mês CORRENTE (mais barato e seguro).
      // Para refresh de meses passados, usar /api/pagamento/:mes?force=true individualmente,
      // que tem proteção de backup/restore contra rate limit.
      if (req.query.force === "true") {
        const now = new Date();
        const ano = now.getFullYear();
        const mes = String(now.getMonth() + 1).padStart(2, "0");
        const ultimoDia = new Date(ano, now.getMonth() + 1, 0).getDate();
        const dataInicio = `${ano}-${mes}-01`;
        const dataFimReal = `${ano}-${mes}-${String(ultimoDia).padStart(2, "0")}`;
        const transFim = ymdAddDays(dataFimReal, 1);
        invalidateCache(`equipe-periodo:${dataInicio}:`);
        invalidateCache(`transacoes_{"dataInicio":"${dataInicio}","dataFim":"${transFim}"}`);
        invalidateCache(`agendamentos_{"dataInicio":"${dataInicio}","dataFim":"${dataFimReal}"}`);
        invalidateCache("full_sync");
        log(`Conselheiro: force=true — cache do mês corrente invalidado`, "conselheiro");
      }
      const snapshot = buildSnapshot(await getConselheiroSources());
      return res.json(snapshot);
    } catch (err: any) {
      log(`Conselheiro /dados erro: ${err.message}`, "conselheiro");
      return res.status(500).json({ error: "Falha ao carregar dados da empresa" });
    }
  });

  app.post("/api/conselheiro/chat", async (req: Request, res: Response) => {
    try {
      const { mensagem, historico = [], dados_empresa } = req.body || {};
      if (!mensagem || typeof mensagem !== "string" || mensagem.trim().length < 2) {
        return res.status(400).json({ error: "Mensagem obrigatória" });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada" });

      const sources = await getConselheiroSources();
      const snapshot = dados_empresa || buildSnapshot(sources);
      const systemPrompt = buildSystemPrompt(snapshot, sources.shopName);
      const messages = buildMessages(historico, mensagem.trim());

      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 1500,
        system: systemPrompt,
        tools: [{ type: "web_search_20250305", name: "web_search" } as any],
        messages: messages as any,
      });

      const resposta = response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");

      return res.json({ resposta, uso: response.usage });
    } catch (err: any) {
      log(`Conselheiro /chat erro: ${err.message}`, "conselheiro");
      return res.status(500).json({ error: "Falha ao processar mensagem" });
    }
  });

  return httpServer;
}
