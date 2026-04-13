import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { log } from "./index";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

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

const FINANCEIRO_FILE = path.join(process.cwd(), ".financeiro-data.json");
const DUPLICADOS_RESOLVIDOS_FILE = path.join(process.cwd(), ".duplicados-resolvidos.json");
let financeEntries: FinanceEntry[] = [];
let resolvedDuplicateIds: number[] = [];

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
  try {
    fs.writeFileSync(DUPLICADOS_RESOLVIDOS_FILE, JSON.stringify(resolvedDuplicateIds, null, 2), "utf-8");
  } catch (err) {
    log("Duplicados: could not save resolved IDs to disk", "duplicados");
  }
}

function saveFinanceEntries() {
  try {
    fs.writeFileSync(FINANCEIRO_FILE, JSON.stringify(financeEntries, null, 2), "utf-8");
  } catch (err) {
    log("Financeiro: could not save data to disk", "financeiro");
  }
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

  // ─── GET /api/trinks/config — Load saved credentials ────
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

  return httpServer;
}
