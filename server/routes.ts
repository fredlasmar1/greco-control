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
interface PlanoAssinatura {
  id: string;
  nome: string;
  valor: number; // preço padrão
  ativo: boolean;
}
let assinaturaClientes: AssinaturaCliente[] = [];
let assinaturaPlanos: PlanoAssinatura[] = [
  { id: "express_corte", nome: "Express Corte", valor: 80, ativo: true },
  { id: "express_cabelo_barba", nome: "Express Cabelo e Barba", valor: 160, ativo: true },
];

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

  // Cache the result
  const ttl = CACHE_TTLS[endpointPath] || 15 * 60 * 1000;
  setCache(cacheKey, allItems, ttl);
  log(`Cache SET for ${endpointPath}: ${allItems.length} items (TTL: ${Math.round(ttl / 60000)}min)`, "trinks");
  
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

      const data = await trinksFetchAll("transacoes", { dataInicio: hoje, dataFim: hoje });
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
      if (!forceRefresh) {
        const cachedSync = getCached("full_sync");
        if (cachedSync) {
          const cacheHasData = (cachedSync.agendamentos?.length > 0 || cachedSync.transacoes?.length > 0);
          if (cacheHasData) {
            log("Sync: returning cached data (use ?force=true to refresh)", "trinks");
            return res.json({ ...cachedSync, fromCache: true });
          } else {
            log("Sync: memory cache has empty data, fetching fresh", "trinks");
            invalidateCache("full_sync");
          }
        }
      }

      // Check disk cache as fallback (survives server restarts)
      if (!forceRefresh) {
        const diskCache = loadSyncCacheFromDisk();
        if (diskCache) {
          // Only use disk cache if it has actual data
          const diskHasData = (diskCache.agendamentos?.length > 0 || diskCache.transacoes?.length > 0);
          if (diskHasData) {
            setCache("full_sync", diskCache);
            return res.json({ ...diskCache, fromCache: true, fromDisk: true });
          } else {
            log("Sync: disk cache has empty data, fetching fresh", "trinks");
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

      // Only cache if we actually got data (avoid caching empty results)
      const hasData = syncResult.agendamentos.length > 0 || syncResult.transacoes.length > 0;
      if (hasData) {
        setCache("full_sync", syncResult);
        saveSyncCacheToDisk(syncResult);
      } else {
        log("Sync: skipping cache — agendamentos and transacoes are empty", "trinks");
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

  // ─── GET /api/version — Debug: confirm deployed version ───
  app.get("/api/version", (_req: Request, res: Response) => {
    return res.json({ version: "2026-04-06-v2", features: ["duplicados", "precificacao", "financeiro-trinks"] });
  });

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
    const { nome, valor } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: "Nome é obrigatório" });
    const id = nome.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") + "_" + Date.now().toString(36);
    assinaturaPlanos.push({ id, nome: nome.trim(), valor: Number(valor) || 0, ativo: true });
    saveAssinaturaPlanos();
    return res.json({ id, message: "Plano criado" });
  });

  // PUT /api/assinaturas/planos/:id — editar plano
  app.put("/api/assinaturas/planos/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const idx = assinaturaPlanos.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: "Plano não encontrado" });
    const { nome, valor, ativo } = req.body;
    if (nome !== undefined) assinaturaPlanos[idx].nome = String(nome).trim();
    if (valor !== undefined) assinaturaPlanos[idx].valor = Number(valor);
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

  return httpServer;
}
