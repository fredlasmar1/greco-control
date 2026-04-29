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
  getConfig as getConfigFin,
  setConfig as setConfigFin,
  fracaoCartao,
  calcularCustoFixoPorMinuto,
} from "./configFinanceira";
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
  categoria?: CategoriaGasto; // só faz sentido pra valores negativos (gastos)
  importedAt: string;
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
  pagoEm?: string; // ISO date
  valor: number;
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
  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Verifica meses não pagos até o mês atual
  const start = new Date(c.contractDate);
  const end = new Date(c.contractEndDate);
  const current = now < end ? now : end;
  const mesStart = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const pagoSet = new Set(c.payments.filter(p => p.pago).map(p => p.mes));
  // Gera lista de meses do contrato até o mês atual
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= current) {
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
}

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
const MAX_REQUESTS_PER_MONTH = 4500; // safe margin under 5000
const MIN_DELAY_BETWEEN_REQUESTS_MS = 1200; // ~50 req/min max pace

let lastRequestTime = 0;

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

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  
  // Reset minute counter if window expired
  if (now - rateLimiter.minuteStart > 60000) {
    rateLimiter.requestsThisMinute = 0;
    rateLimiter.minuteStart = now;
  }
  
  // Check monthly limit
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

const CACHE_TTLS: Record<string, number> = {
  "estabelecimentos": 24 * 60 * 60 * 1000,    // 24h
  "profissionais": 24 * 60 * 60 * 1000,        // 24h
  "servicos": 24 * 60 * 60 * 1000,             // 24h
  "clientes": 6 * 60 * 60 * 1000,              // 6h
  "agendamentos": 30 * 60 * 1000,              // 30min
  "transacoes": 30 * 60 * 1000,                // 30min
  "lancamentos": 30 * 60 * 1000,               // 30min
  "full_sync": 15 * 60 * 1000,                 // 15min
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
        // Accept disk cache up to 2 hours old
        if (age < 2 * 60 * 60 * 1000) {
          log(`Loaded sync cache from disk (age: ${Math.round(age / 60000)}min)`, "trinks");
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

// ─── Helper: make Trinks API call ─────────────────────────
// IMPORTANT: Trinks API uses estabelecimentoId as an HTTP HEADER, not a query param.
async function trinksFetch(
  path: string,
  queryParams?: Record<string, string>,
  options?: { skipEstabHeader?: boolean }
) {
  if (!trinksConfig) {
    throw { status: 400, message: "Chave API da Trinks não configurada. Vá em Configurações para conectar." };
  }

  // Enforce rate limit before making request
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

  log(`API call #${rateLimiter.totalRequestsSession + 1} (${rateLimiter.requestsThisMinute + 1}/min, ${rateLimiter.requestsThisMonth + 1}/month): ${path}`, "trinks");

  const res = await fetch(url.toString(), { headers });
  recordRequest();

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log(`Trinks error ${res.status}: ${body}`, "trinks");
    if (res.status === 401) {
      throw { status: 401, message: "Chave API inválida. Verifique suas credenciais." };
    }
    if (res.status === 429) {
      // Record the 429 — API told us we're over limit
      log(`RATE LIMITED by Trinks API. Minute: ${rateLimiter.requestsThisMinute}, Month: ${rateLimiter.requestsThisMonth}`, "trinks");
      throw { status: 429, message: "Limite de requisições da Trinks excedido. O CRM usará dados do cache. Tente sincronizar novamente em alguns minutos." };
    }
    if (res.status === 403) {
      throw { status: 403, message: "Sem permissão para acessar este recurso." };
    }
    throw { status: res.status, message: body || `Erro ${res.status} da API Trinks.` };
  }

  const data = await res.json();
  return data;
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
  const maxPages = 20;

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
    const ttl = CACHE_TTLS[endpointPath] || 15 * 60 * 1000;
    setCache(cacheKey, allItems, ttl);
    log(`Cache SET for ${endpointPath}: ${allItems.length} items (TTL: ${Math.round(ttl / 60000)}min)`, "trinks");
  } else {
    log(`Cache SKIPPED for ${endpointPath}: lista vazia (possível falha silenciosa, não será cacheada)`, "trinks");
  }

  return allItems;
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
      if (dbStore && typeof dbStore === "object") storeData = dbStore;
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
  app.get("/api/meu-painel", (req: Request, res: Response) => {
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

  // GET /api/version — identifica qual código está rodando em produção
  app.get("/api/version", (_req: Request, res: Response) => {
    return res.json({
      build: "2026-04-29-precif-v24-etapa2",
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
    });
  });

  // ─── GET /api/trinks/estabelecimento ────────────────────
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

    // Sequencial para não saturar o rate limit da Trinks (40 req/min).
    // Produtos + profissionais são leves; transações e agendamentos são paginados pesados.
    const produtos: any[] = await trinksFetchAll("produtos").catch((e: any) => {
      log(`estoque: erro produtos: ${e?.message}`, "trinks");
      return [] as any[];
    });
    const profissionais: any[] = await trinksFetchAll("profissionais").catch((e: any) => {
      log(`estoque: erro profissionais: ${e?.message}`, "trinks");
      return [] as any[];
    });
    // Trinks /v1/transacoes usa intervalo semi-aberto [dataInicio, dataFim) — somar +1d.
    const transFim = ymdAddDays(hoje, 1);
    const transacoes: any[] = await trinksFetchAll("transacoes", { dataInicio: dataInicio30, dataFim: transFim }).catch((e: any) => {
      log(`estoque: erro transacoes: ${e?.message}`, "trinks");
      return [] as any[];
    });
    // Agendamentos em janela reduzida (14d) para heurística de nomes
    const agendamentos: any[] = await trinksFetchAll("agendamentos", { dataInicio: dataInicio14, dataFim: hoje }).catch((e: any) => {
      log(`estoque: erro agendamentos: ${e?.message}`, "trinks");
      return [] as any[];
    });
    log(`estoque: carregados produtos=${produtos.length} profissionais=${profissionais.length} transacoes=${transacoes.length} agendamentos=${agendamentos.length}`, "trinks");

    // Mapa ID → nome do profissional (cadastro atual via /v1/profissionais)
    const mapaProf = new Map<number, string>();
    for (const p of (profissionais || [])) {
      mapaProf.set(Number(p.id), p.nome || p.apelido || `Profissional ${p.id}`);
    }

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
        vendidos30d: qtd30d,
        faturamento30d: mov?.valor30d ?? 0,
        ultimaVenda,
        diasDesdeUltimaVenda: ultimaVenda ? diasDesdeUltimaVenda : null,
      };
    });

    const emAlerta = lista.filter(p => p.nivel !== "ok");
    const criticos = lista.filter(p => p.nivel === "critico");

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

    const resumo = {
      atualizadoEm: new Date().toISOString(),
      fonte: "trinks-transacoes-30d",
      limitacaoApi: "A API Trinks não expõe saldo/custo/valor de estoque. Dados derivados das transações (comandas) dos últimos 30 dias.",
      janela: { dataInicio: dataInicio30, dataFim: hoje },
      totalProdutos: lista.length,
      produtosEmAlerta: emAlerta.length,
      produtosCriticos: criticos.length,
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
  app.get("/api/trinks/agendamentos", async (req: Request, res: Response) => {
    try {
      const params: Record<string, string> = {};
      if (req.query.dataInicio) params.dataInicio = String(req.query.dataInicio);
      if (req.query.dataFim) params.dataFim = String(req.query.dataFim);
      const data = await trinksFetchAll("agendamentos", params);
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
    const [agendData, transData] = await Promise.all([
      trinksFetchAll("agendamentos", { dataInicio: hoje, dataFim: hoje }),
      trinksFetchAll("transacoes", { dataInicio: hoje, dataFim: transFim }),
    ]);

    const agendLista = Array.isArray(agendData) ? agendData : (agendData?.data || []);
    const transLista = Array.isArray(transData) ? transData : (transData?.data || []);

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
    return calcularDiaCompleto(dataOntem);
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
    // Buscar serial p/ não estourar rate limit do Trinks
    const profData = await trinksFetchAll("profissionais").catch((e: any) => {
      log(`[periodo ${dataInicio}..${dataFim}] erro profissionais: ${e?.message}`, "equipe");
      return [] as any[];
    });
    const agendData = await trinksFetchAll("agendamentos", { dataInicio, dataFim }).catch((e: any) => {
      log(`[periodo ${dataInicio}..${dataFim}] erro agendamentos: ${e?.message}`, "equipe");
      return [] as any[];
    });
    const transData = await trinksFetchAll("transacoes", { dataInicio, dataFim: transFim }).catch((e: any) => {
      log(`[periodo ${dataInicio}..${dataFim}] erro transacoes: ${e?.message}`, "equipe");
      return [] as any[];
    });
    const profLista = Array.isArray(profData) ? profData : (profData?.data || []);
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
      produtos:  { reais: number; count: number; bruto: number; liquido: number };
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

    const data = await trinksFetchAll("agendamentos", { dataInicio: amanha, dataFim: amanha });
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
      const cached = getCached(cacheKey);
      if (cached) return res.json({ ...cached, fromCache: true });
      const result = await calcularHojeCompleto();
      setCache(cacheKey, result, 2 * 60 * 1000);
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

      const data = await trinksFetchAll("agendamentos", { dataInicio: amanha, dataFim: amanha });
      const lista = Array.isArray(data) ? data : (data?.data || []);

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

  app.get("/api/clientes/duplicados", async (_req: Request, res: Response) => {
    try {
      // Get clients from sync cache or fetch
      let clientes: any[] = [];
      const syncCache = getCached("full_sync") || loadSyncCacheFromDisk();
      if (syncCache && Array.isArray(syncCache.clientes) && syncCache.clientes.length > 0) {
        clientes = syncCache.clientes;
      } else {
        // Fetch fresh
        clientes = await trinksFetchAll("clientes");
        if (!Array.isArray(clientes)) clientes = [];
      }

      // Normalize phone number: strip everything except digits, take last 8-9 digits
      function normalizePhone(ddd: string, telefone: string): string {
        const full = (ddd || "") + (telefone || "");
        const digits = full.replace(/\D/g, "");
        // Take last 9 digits (Brazilian mobile) or 8 (landline)
        return digits.length >= 9 ? digits.slice(-9) : digits.slice(-8);
      }

      // Group clients by normalized phone
      const phoneMap: Record<string, any[]> = {};
      let clientsWithPhone = 0;
      let clientsWithoutPhone = 0;

      clientes.forEach((c: any) => {
        const phones = c.telefones || [];
        if (phones.length === 0) {
          clientsWithoutPhone++;
          return;
        }
        clientsWithPhone++;

        phones.forEach((p: any) => {
          const normalized = normalizePhone(p.ddd || "", p.telefone || "");
          if (normalized.length < 8) return;
          if (!phoneMap[normalized]) phoneMap[normalized] = [];
          // Avoid adding same client twice to same phone group
          if (!phoneMap[normalized].find((x: any) => x.id === c.id)) {
            phoneMap[normalized].push({
              id: c.id,
              nome: c.nome || "",
              email: c.email || null,
              dataCadastro: c.dataCadastro || "",
              telefoneOriginal: `(${p.ddd || ""}) ${p.telefone || ""}`,
              telefoneNormalizado: normalized,
            });
          }
        });
      });

      // Filter out resolved duplicate IDs from each phone group
      const resolvedSet = new Set(resolvedDuplicateIds);
      for (const phone of Object.keys(phoneMap)) {
        phoneMap[phone] = phoneMap[phone].filter((c: any) => !resolvedSet.has(c.id));
        if (phoneMap[phone].length === 0) delete phoneMap[phone];
      }

      // Find groups with more than one client (duplicates)
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
      const uniqueAfterMerge = duplicateGroups.length;

      return res.json({
        totalClientes: clientes.length,
        clientsWithPhone,
        clientsWithoutPhone,
        totalGruposDuplicados: duplicateGroups.length,
        totalClientesDuplicados: totalDuplicateClients,
        potencialReducao: totalDuplicateClients - uniqueAfterMerge,
        grupos: duplicateGroups,
      });
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
      transito, contaDestinoId,
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
        // Lê como texto
        let textContent = "";
        if (isExcel) {
          // Precisa de lib pra ler xlsx no backend. Workaround: enviar base64 pro Claude
          // Mas Claude não aceita xlsx nativamente. Vamos avisar.
          return res.status(400).json({
            error: "Para Excel, use o upload normal. Se quiser IA, converta pra PDF ou CSV primeiro."
          });
        } else {
          textContent = req.file.buffer.toString("utf-8");
        }
        content = [
          {
            type: "text",
            text: `${prompt}\n\n--- CONTEÚDO DO CSV ---\n${textContent.slice(0, 100000)}`,
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

      transacoesBanco.push(...novas);
      saveTransacoesBanco();
      return res.json({ ok: true, inserted: novas.length });
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

      transacoesBanco.push(...novas);
      saveTransacoesBanco();
      return res.json({ ok: true, inserted: novas.length });
    } catch (err: any) {
      log(`PDF upload error: ${err.message}`, "consolidacao");
      return res.status(500).json({ error: err.message || "Erro processando PDF" });
    }
  });

  // POST /api/consolidacao/transacoes — bulk insert (do upload CSV)
  app.post("/api/consolidacao/transacoes", (req: Request, res: Response) => {
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

    transacoesBanco.push(...novas);
    saveTransacoesBanco();
    return res.json({ ok: true, inserted: novas.length });
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

  app.post("/api/service-costs", (req: Request, res: Response) => {
    const { costs } = req.body;
    if (!Array.isArray(costs)) {
      return res.status(400).json({ error: "costs must be an array" });
    }
    serviceCosts = costs.map((c: any) => ({
      serviceId: String(c.serviceId || ""),
      serviceName: String(c.serviceName || ""),
      items: Array.isArray(c.items) ? c.items.map((item: any) => ({
        id: String(item.id || ""),
        name: String(item.name || ""),
        category: String(item.category || "outro"),
        quantity: Number(item.quantity || 0),
        unitCost: Number(item.unitCost || 0),
      })) : [],
    }));
    saveServiceCosts();
    log(`Service costs: saved ${serviceCosts.length} entries`, "costs");
    return res.json({ ok: true, count: serviceCosts.length });
  });

  // ──────────────────────────────────────────────────────────────────
  // FINANCEIRO ROUTES
  // ──────────────────────────────────────────────────────────────────

  // ─── GET /api/financeiro — Return all entries for current month
  // Combines manual entries with auto-generated Trinks revenue entries
  app.get("/api/financeiro", (_req: Request, res: Response) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const monthPrefix = `${year}-${month}`;
    const monthEntries = financeEntries.filter(e => e.date.startsWith(monthPrefix));

    // Auto-generate revenue entries from Trinks sync data
    const trinksRevenue: FinanceEntry[] = [];
    const syncCache = getCached("full_sync") || loadSyncCacheFromDisk();
    if (syncCache) {
      const transacoes = syncCache.transacoes || [];
      // Group transacoes by day
      const dailyMap: Record<string, { revenue: number; count: number; pix: number; cartao: number; dinheiro: number; outros: number }> = {};

      transacoes.forEach((t: any) => {
        const raw = t.dataHora || t.dataReferencia || t.data || "";
        const date = typeof raw === "string" ? raw.split("T")[0] : "";
        if (!date || !date.startsWith(monthPrefix)) return;

        if (!dailyMap[date]) dailyMap[date] = { revenue: 0, count: 0, pix: 0, cartao: 0, dinheiro: 0, outros: 0 };
        dailyMap[date].revenue += Number(t.totalPagar || 0);
        dailyMap[date].count += 1;

        (t.formasPagamentos || []).forEach((fp: any) => {
          const nome = (fp.nome || "").toLowerCase();
          const val = Number(fp.valor || 0);
          if (nome.includes("pix")) dailyMap[date].pix += val;
          else if (nome.includes("créd") || nome.includes("cred") || nome.includes("déb") || nome.includes("deb") || nome.includes("cart")) dailyMap[date].cartao += val;
          else if (nome.includes("dinhe") || nome.includes("espécie")) dailyMap[date].dinheiro += val;
          else dailyMap[date].outros += val;
        });
      });

      Object.entries(dailyMap).forEach(([date, data]) => {
        const paymentParts: string[] = [];
        if (data.pix > 0) paymentParts.push(`Pix: R$${data.pix.toFixed(0)}`);
        if (data.cartao > 0) paymentParts.push(`Cartão: R$${data.cartao.toFixed(0)}`);
        if (data.dinheiro > 0) paymentParts.push(`Dinheiro: R$${data.dinheiro.toFixed(0)}`);
        if (data.outros > 0) paymentParts.push(`Outros: R$${data.outros.toFixed(0)}`);

        trinksRevenue.push({
          id: `trinks-rev-${date}`,
          date,
          description: `Faturamento Trinks (${data.count} transações)`,
          amount: data.revenue,
          category: "receita",
          subcategory: "Trinks",
          recurrent: false,
          notes: paymentParts.join(" | "),
          createdAt: date + "T23:59:59.000Z",
        });
      });
    }

    // Auto-generate commission entries per professional from agendamentos
    const trinksCommissions: FinanceEntry[] = [];
    const trinksMaterialCosts: FinanceEntry[] = [];

    if (syncCache) {
      const agendamentos = syncCache.agendamentos || [];
      const COMMISSION_RATE = 0.40; // 40% default

      // Group finalized agendamentos by professional per day
      const profDayMap: Record<string, { name: string; revenue: number; count: number }> = {};

      agendamentos.forEach((a: any) => {
        const statusName = (a.status?.nome || "").toLowerCase();
        if (statusName !== "finalizado") return;
        const raw = a.dataHoraInicio || "";
        const date = typeof raw === "string" ? raw.split("T")[0] : "";
        if (!date || !date.startsWith(monthPrefix)) return;

        const profName = a.profissional?.nome || "Profissional";
        const profId = a.profissional?.id || "unknown";
        const key = `${date}_${profId}`;
        if (!profDayMap[key]) profDayMap[key] = { name: profName, revenue: 0, count: 0 };
        profDayMap[key].revenue += Number(a.valor || 0);
        profDayMap[key].count += 1;
      });

      // Group commissions by date (aggregate all professionals per day)
      const commissionByDay: Record<string, { total: number; details: string[] }> = {};

      Object.entries(profDayMap).forEach(([key, data]) => {
        const date = key.split("_")[0];
        const commission = data.revenue * COMMISSION_RATE;
        if (commission <= 0) return;

        if (!commissionByDay[date]) commissionByDay[date] = { total: 0, details: [] };
        commissionByDay[date].total += commission;
        const firstName = data.name.split(" ")[0];
        commissionByDay[date].details.push(`${firstName}: R$${commission.toFixed(0)} (${data.count} atend.)`);
      });

      Object.entries(commissionByDay).forEach(([date, data]) => {
        trinksCommissions.push({
          id: `trinks-comm-${date}`,
          date,
          description: `Comissões do dia (40%)`,
          amount: -data.total,
          category: "variavel",
          subcategory: "Comissões",
          recurrent: false,
          notes: data.details.join(" | "),
          createdAt: date + "T23:59:58.000Z",
        });
      });

      // Auto-generate material cost entries from service cost sheets
      if (serviceCosts.length > 0) {
        // Build a map of service cost per service ID
        const costMap: Record<string, number> = {};
        serviceCosts.forEach(sc => {
          const total = (sc.items || []).reduce((s: number, item: any) =>
            s + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0);
          if (total > 0) costMap[sc.serviceId] = total;
        });

        if (Object.keys(costMap).length > 0) {
          // Group material costs by day from agendamentos
          const materialByDay: Record<string, { total: number; count: number }> = {};

          agendamentos.forEach((a: any) => {
            const statusName = (a.status?.nome || "").toLowerCase();
            if (statusName !== "finalizado") return;
            const raw = a.dataHoraInicio || "";
            const date = typeof raw === "string" ? raw.split("T")[0] : "";
            if (!date || !date.startsWith(monthPrefix)) return;

            const svcId = String(a.servico?.id || "");
            const cost = costMap[svcId];
            if (cost && cost > 0) {
              if (!materialByDay[date]) materialByDay[date] = { total: 0, count: 0 };
              materialByDay[date].total += cost;
              materialByDay[date].count += 1;
            }
          });

          Object.entries(materialByDay).forEach(([date, data]) => {
            trinksMaterialCosts.push({
              id: `trinks-mat-${date}`,
              date,
              description: `Custo de material (${data.count} serviços)`,
              amount: -data.total,
              category: "variavel",
              subcategory: "Material",
              recurrent: false,
              notes: "Calculado a partir das fichas técnicas de precificação",
              createdAt: date + "T23:59:57.000Z",
            });
          });
        }
      }
    }

    // Combine manual entries + Trinks revenue + commissions + material costs
    const allEntries = [...monthEntries, ...trinksRevenue, ...trinksCommissions, ...trinksMaterialCosts];
    // Sort by date descending, then by createdAt descending
    allEntries.sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return res.json(allEntries);
  });

  // Helper interno: calcula totais agregados por categoria para um mês YYYY-MM.
  // Reusado pelo endpoint /api/financeiro/totais/:mes e pelo cálculo de custo fixo/min.
  function computeTotaisDoMes(mes: string) {
    // 1) Lançamentos manuais do mês
    const manuais = financeEntries.filter(e => e.date.startsWith(mes));

    // 2) Lançamentos auto-gerados (Trinks): receita do dia + comissões + material
    const auto: FinanceEntry[] = [];
    const syncCache = getCached("full_sync") || loadSyncCacheFromDisk();
    if (syncCache) {
      const transacoes = syncCache.transacoes || [];
      const dailyRev: Record<string, number> = {};
      transacoes.forEach((t: any) => {
        const raw = t.dataHora || t.dataReferencia || t.data || "";
        const date = typeof raw === "string" ? raw.split("T")[0] : "";
        if (!date || !date.startsWith(mes)) return;
        dailyRev[date] = (dailyRev[date] || 0) + Number(t.totalPagar || 0);
      });
      Object.entries(dailyRev).forEach(([date, val]) => {
        auto.push({
          id: `trinks-rev-${date}`, date, description: "Faturamento Trinks",
          amount: val, category: "receita", recurrent: false, createdAt: date + "T23:59:59.000Z",
        });
      });

      // Comissões + material — usa mesma lógica do GET /api/financeiro
      const agendamentos = syncCache.agendamentos || [];
      const COMMISSION_RATE = 0.40;
      const profDayMap: Record<string, { revenue: number }> = {};
      agendamentos.forEach((a: any) => {
        const statusName = (a.status?.nome || "").toLowerCase();
        if (statusName !== "finalizado") return;
        const raw = a.dataHoraInicio || "";
        const date = typeof raw === "string" ? raw.split("T")[0] : "";
        if (!date || !date.startsWith(mes)) return;
        const profId = a.profissional?.id || "unknown";
        const key = `${date}_${profId}`;
        if (!profDayMap[key]) profDayMap[key] = { revenue: 0 };
        profDayMap[key].revenue += Number(a.valor || 0);
      });
      const commissionByDay: Record<string, number> = {};
      Object.entries(profDayMap).forEach(([key, data]) => {
        const date = key.split("_")[0];
        const c = data.revenue * COMMISSION_RATE;
        if (c > 0) commissionByDay[date] = (commissionByDay[date] || 0) + c;
      });
      Object.entries(commissionByDay).forEach(([date, total]) => {
        auto.push({
          id: `trinks-comm-${date}`, date, description: "Comissões do dia",
          amount: -total, category: "variavel", recurrent: false, createdAt: date + "T23:59:58.000Z",
        });
      });

      if (serviceCosts.length > 0) {
        const costMap: Record<string, number> = {};
        serviceCosts.forEach(sc => {
          const total = (sc.items || []).reduce((s: number, item: any) =>
            s + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0);
          if (total > 0) costMap[sc.serviceId] = total;
        });
        if (Object.keys(costMap).length > 0) {
          const materialByDay: Record<string, number> = {};
          agendamentos.forEach((a: any) => {
            const statusName = (a.status?.nome || "").toLowerCase();
            if (statusName !== "finalizado") return;
            const raw = a.dataHoraInicio || "";
            const date = typeof raw === "string" ? raw.split("T")[0] : "";
            if (!date || !date.startsWith(mes)) return;
            const svcId = String(a.servico?.id || "");
            const cost = costMap[svcId];
            if (cost && cost > 0) materialByDay[date] = (materialByDay[date] || 0) + cost;
          });
          Object.entries(materialByDay).forEach(([date, total]) => {
            auto.push({
              id: `trinks-mat-${date}`, date, description: "Custo de material",
              amount: -total, category: "variavel", recurrent: false, createdAt: date + "T23:59:57.000Z",
            });
          });
        }
      }
    }

    // 3) Soma por categoria. Lançamentos têm sinal: receitas positivas, despesas negativas.
    // Aqui retornamos o VALOR ABSOLUTO somado por categoria (mais útil pro custo fixo/min).
    const todos = [...manuais, ...auto];
    let totalFixas = 0, totalVariaveis = 0, totalReceitas = 0,
        totalParcelamentos = 0, totalInvestimentos = 0;

    todos.forEach(e => {
      const v = Math.abs(Number(e.amount) || 0);
      switch (e.category) {
        case "fixo": totalFixas += v; break;
        case "variavel": totalVariaveis += v; break;
        case "receita": totalReceitas += v; break;
        case "parcelamento": totalParcelamentos += v; break;
        case "investimento": totalInvestimentos += v; break;
      }
    });

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
  app.get("/api/financeiro/totais/:mes", (req: Request, res: Response) => {
    const mes = String(req.params.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "Mês inválido. Use formato YYYY-MM" });
    }
    return res.json(computeTotaisDoMes(mes));
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
      const totais = computeTotaisDoMes(mes);
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

  // GET /api/assinaturas/clientes — lista com status de pagamento calculado
  app.get("/api/assinaturas/clientes", (_req: Request, res: Response) => {
    const enriched = assinaturaClientes.map(c => ({
      ...c,
      paymentStatus: getPaymentStatus(c),
    }));
    return res.json(enriched.sort((a, b) => a.name.localeCompare(b.name)));
  });

  // GET /api/assinaturas/clientes/:id
  app.get("/api/assinaturas/clientes/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const c = assinaturaClientes.find(c => c.id === id);
    if (!c) return res.status(404).json({ error: "Cliente não encontrado" });
    return res.json({ ...c, paymentStatus: getPaymentStatus(c) });
  });

  // POST /api/assinaturas/clientes — cadastrar novo assinante
  app.post("/api/assinaturas/clientes", (req: Request, res: Response) => {
    const { name, phone, email, plan, planValue, contractDate, contractDurationMonths, paymentDay, contractUrl, notes } = req.body;
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
    const { name, phone, email, plan, planValue, contractDate, contractDurationMonths, paymentDay, contractUrl, notes, status } = req.body;
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
    const { mes, pago } = req.body; // mes: "YYYY-MM", pago: boolean
    if (!mes) return res.status(400).json({ error: "Mês é obrigatório (YYYY-MM)" });
    const idx = assinaturaClientes.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: "Cliente não encontrado" });
    const c = assinaturaClientes[idx];
    const pIdx = c.payments.findIndex(p => p.mes === mes);
    if (pago) {
      if (pIdx >= 0) {
        c.payments[pIdx].pago = true;
        c.payments[pIdx].pagoEm = new Date().toISOString();
      } else {
        c.payments.push({ mes, pago: true, pagoEm: new Date().toISOString(), valor: c.planValue });
      }
    } else {
      if (pIdx >= 0) {
        c.payments[pIdx].pago = false;
        c.payments[pIdx].pagoEm = undefined;
      }
    }
    c.updatedAt = new Date().toISOString();
    saveAssinaturaClientes();
    return res.json({ message: pago ? "Pagamento registrado" : "Pagamento desmarcado" });
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
    return res.json({
      totalAssinantes: assinaturaClientes.length,
      ativos: active.length,
      inadimplentes: inadimplentes.length,
      cancelados: assinaturaClientes.filter(c => c.status === "cancelled").length,
      monthlyRevenue,
      planDistribution,
      vencendoEmBreve: vencendoEmBreve.length,
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

  // POST /api/telegram/resumo-manha — monta e envia resumo matinal agora
  // Inclui FECHAMENTO de ontem + PREVISÃO de hoje + (opcional) previsão de amanhã.
  // (Bloco de produtos sem giro foi removido a pedido do usuário.)
  app.post("/api/telegram/resumo-manha", async (_req: Request, res: Response) => {
    try {
      const [hoje, ontem, amanhaData] = await Promise.all([
        calcularHojeCompleto(),
        calcularOntemFechado().catch(() => null),
        calcularAmanha().catch(() => null),
      ]);
      const msg = montarResumoManha(hoje, amanhaData, ontem);
      const r = await enviarMensagem(msg);
      return res.json({ ...r, enviado: r.ok });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
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
      return res.status(500).json({ ok: false, error: err.message });
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
  async function calcularLinhaPagamento(
    mes: string,
    profissionalId: string,
    profMes: any,
    meta: any,
    pagto: any,
  ) {
    const servicosLiquido = profMes?.servicos?.liquido || 0;
    const produtosLiquidoComissionavel = profMes?.produtos?.liquidoComissionavel || 0;
    const planoReais = profMes?.plano?.reais || 0;
    const taxaCartaoEstimada = profMes?.taxaCartao || 0; // informativo (já abatido no líquido)
    const pctServico = Number(meta?.pctServico || 0);
    const pctProduto = Number(meta?.pctProduto || 0);
    const pctPlano = Number(meta?.pctPlano || 0);
    const pctBonusExcedente = Number(meta?.pctBonusExcedente || 0);
    const metaReais = Number(meta?.metaReais || 0);
    const salarioFixo = Number(meta?.salarioFixo || 0);

    const comissaoServicos = (servicosLiquido * pctServico) / 100;
    const comissaoProdutos = (produtosLiquidoComissionavel * pctProduto) / 100;
    const comissaoPlano = (planoReais * pctPlano) / 100;
    const excedente = Math.max(0, servicosLiquido - metaReais);
    const bonusExcedente = (excedente * pctBonusExcedente) / 100;
    const totalBruto = comissaoServicos + comissaoProdutos + comissaoPlano + bonusExcedente + salarioFixo;

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
      },
      // Percentuais aplicados
      percentuais: {
        pctServico, pctProduto, pctPlano, pctBonusExcedente,
        metaReais, salarioFixo,
      },
      // Componentes calculados
      calculos: {
        comissaoServicos,
        comissaoProdutos,
        comissaoPlano,
        excedenteMeta: excedente,
        bonusExcedente,
        salarioFixo,
        totalBruto,
      },
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

      const [periodo, metas, pagamentosMes] = await Promise.all([
        calcularPeriodoPorProfissional(dataInicio, dataFim),
        getAllMetas(),
        getPagamentosDoMes(mes),
      ]);

      const ids = new Set<string>();
      Object.keys(periodo.porProfissional).forEach(id => ids.add(id));
      Object.keys(metas).forEach(id => ids.add(id));

      const linhas = await Promise.all(Array.from(ids).map(async (id) => {
        const profMes = periodo.porProfissional[id];
        const meta = metas[id];
        const pagto = pagamentosMes[id];
        return calcularLinhaPagamento(mes, id, profMes, meta, pagto);
      }));

      // Ordena por nome
      linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

      // Totais
      const totais = linhas.reduce((acc, l) => ({
        totalBruto: acc.totalBruto + l.calculos.totalBruto,
        totalVale: acc.totalVale + l.pagamento.vale,
        totalAjuste: acc.totalAjuste + l.pagamento.ajuste,
        totalConsumoInterno: acc.totalConsumoInterno + l.pagamento.consumoInterno,
        totalTaxaCartao: acc.totalTaxaCartao + l.bases.taxaCartaoEstimada,
        totalSaldo: acc.totalSaldo + l.pagamento.saldoAReceber,
      }), { totalBruto: 0, totalVale: 0, totalAjuste: 0, totalConsumoInterno: 0, totalTaxaCartao: 0, totalSaldo: 0 });

      return res.json({
        ok: true,
        mes,
        dataInicio,
        dataFim,
        linhas,
        totais,
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
      const agendamentos: any[] = await trinksFetchAll("agendamentos", { dataInicio: dataInicio14, dataFim: hoje }).catch((e: any) => {
        log(`[vendas-produtos] erro agendamentos: ${e?.message}`, "trinks");
        return [];
      });
      log(`[vendas-produtos] agendamentos=${agendamentos.length}`, "trinks");

      const mapaProf = new Map<number, string>();
      for (const p of profissionais || []) {
        mapaProf.set(Number(p.id), p.nome || p.apelido || `Profissional ${p.id}`);
      }

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
      const vendedoresArr = Array.from(consolidadoPorNome.values()).map(v => {
        const margemRS = v.receita - v.custoTotal;
        const margemPct = v.receita > 0 ? (margemRS / v.receita) * 100 : 0;
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
        };
      }).sort((a, b) => b.receita - a.receita);

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
        atualizadoEm: new Date().toISOString(),
      };
      setCache(ck, resp, 5 * 60 * 1000);
      return res.json(resp);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── EQUIPE: desempenho consolidado dia/semana/mês ────────────────
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
      log(`[equipe/desempenho] calculando dia ${hoje}...`, "equipe");
      const dia = await calcularPeriodoPorProfissional(hoje, hoje);
      log(`[equipe/desempenho] calculando semana ${semIni}..${semFim}...`, "equipe");
      const semana = await calcularPeriodoPorProfissional(semIni, semFim);
      log(`[equipe/desempenho] calculando mês ${mesIni}..${mesFim}...`, "equipe");
      const mesData = await calcularPeriodoPorProfissional(mesIni, mesFim);
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
      // Remove linhas "fantasma" (IDs históricos sem nome real e sem movimento e sem meta)
      const linhas = linhasRaw.filter(l => {
        if (l.meta) return true;
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
      // Mostra FECHAMENTO do dia anterior + PREVISÃO do dia atual
      cron.schedule("0 8 * * 2-6", async () => {
        log("[cron] disparando resumo da manhã...", "telegram");
        try {
          const [hoje, ontem, amanhaData] = await Promise.all([
            calcularHojeCompleto(),
            calcularOntemFechado().catch(() => null),
            calcularAmanha().catch(() => null),
          ]);
          const msg = montarResumoManha(hoje, amanhaData, ontem);
          const r = await enviarMensagem(msg);
          log(`[cron] resumo manhã: ${r.ok ? "OK" : "FALHOU: " + r.error}`, "telegram");
        } catch (err: any) {
          log(`[cron] erro resumo manhã: ${err.message}`, "telegram");
        }
      }, { timezone: "America/Sao_Paulo" });

      // Noite: 20:00 ter-sab
      cron.schedule("0 20 * * 2-6", async () => {
        log("[cron] disparando resumo da noite...", "telegram");
        try {
          const hoje = await calcularHojeCompleto();
          const msg = montarResumoNoite(hoje);
          const r = await enviarMensagem(msg);
          log(`[cron] resumo noite: ${r.ok ? "OK" : "FALHOU: " + r.error}`, "telegram");
        } catch (err: any) {
          log(`[cron] erro resumo noite: ${err.message}`, "telegram");
        }
      }, { timezone: "America/Sao_Paulo" });

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

      // Matinal individual: ter-sáb 08h00 (resumo do último dia útil + acumulado mês)
      cron.schedule("0 8 * * 2-6", async () => {
        log("[cron] disparando resumo matinal individual (Equipe)...", "telegram");
        await dispararIndividualParaTodos("matinal");
      }, { timezone: "America/Sao_Paulo" });

      // Semanal individual: sábado 21h
      cron.schedule("0 21 * * 6", async () => {
        log("[cron] disparando resumo semanal individual (Equipe)...", "telegram");
        await dispararIndividualParaTodos("semanal");
      }, { timezone: "America/Sao_Paulo" });

      // Mensal individual: 28-31 do mês às 21h, ter-sáb,
      // e só dispara se hoje for o último dia útil do mês.
      cron.schedule("0 21 28-31 * 2-6", async () => {
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
      cron.schedule("0 9 * * 2-6", async () => {
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
      }, { timezone: "America/Sao_Paulo" });

      log("[cron] schedulers Telegram ativos: geral 8h/20h (ter-sáb) + alerta estoque 9h (ter-sáb) + individual MATINAL 8h/SEMANAL sáb 21h/MENSAL último dia útil 21h", "telegram");
    } catch (err: any) {
      log(`[cron] falha ao registrar schedulers: ${err.message}`, "telegram");
    }
  } else {
    log("[cron] TELEGRAM_BOT_TOKEN não configurado — schedulers desativados", "telegram");
  }

  return httpServer;
}
