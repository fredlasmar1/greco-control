import { create } from "zustand";

// ─── Types ────────────────────────────────────────────────

export interface TrinksData {
  estabelecimento: any;
  profissionais: any[];
  servicos: any[];
  agendamentos: any[];
  transacoes: any[];
  clientes: any[];
  syncedAt: string;
  fromCache?: boolean;
  fromDisk?: boolean;
  rateLimited?: boolean;
  warning?: string;
}

interface TrinksState {
  // Connection state
  isConnected: boolean;
  isSyncing: boolean;
  isTesting: boolean;
  isLoadingConfig: boolean;

  // Data
  trinks: TrinksData | null;
  lastSync: string | null;
  error: string | null;

  // Config
  hasConfig: boolean;
  savedMaskedKey: string | null;
  savedEstablishmentId: string | null;
  establishmentName: string | null;

  // Cache/rate info
  fromCache: boolean;
  rateLimited: boolean;
  warning: string | null;

  // Actions
  loadSavedConfig: () => Promise<void>;
  saveConfig: (apiKey: string, establishmentId: string) => Promise<void>;
  testConnection: () => Promise<{ ok: boolean; name?: string; error?: string }>;
  syncData: (force?: boolean) => Promise<{ ok: boolean; error?: string }>;
  clearCache: () => Promise<void>;
}

const API_BASE = () => (globalThis as any).__API_BASE__ || "";

export const useTrinksStore = create<TrinksState>((set, get) => ({
  isConnected: false,
  isSyncing: false,
  isTesting: false,
  isLoadingConfig: false,
  trinks: null,
  lastSync: null,
  error: null,
  hasConfig: false,
  savedMaskedKey: null,
  savedEstablishmentId: null,
  establishmentName: null,
  fromCache: false,
  rateLimited: false,
  warning: null,

  // ── Load saved config from server on startup ──
  loadSavedConfig: async () => {
    set({ isLoadingConfig: true });
    try {
      const res = await fetch(`${API_BASE()}/api/trinks/config`);
      const data = await res.json();
      if (data.hasConfig) {
        set({
          hasConfig: true,
          savedMaskedKey: data.maskedKey || null,
          savedEstablishmentId: data.establishmentId || null,
          isLoadingConfig: false,
        });
        // Auto-sync if config exists
        await get().syncData(false);
      } else {
        set({ isLoadingConfig: false });
      }
    } catch (err) {
      set({ isLoadingConfig: false });
    }
  },

  // ── Save API key + establishment ID to server ──
  saveConfig: async (apiKey: string, establishmentId: string) => {
    try {
      const res = await fetch(`${API_BASE()}/api/trinks/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, establishmentId }),
      });
      if (res.ok) {
        // Reload config to get masked key
        const configRes = await fetch(`${API_BASE()}/api/trinks/config`);
        const configData = await configRes.json();
        set({
          hasConfig: true,
          savedMaskedKey: configData.maskedKey || null,
          savedEstablishmentId: configData.establishmentId || establishmentId || null,
        });
      }
    } catch (err) {
      // ignore
    }
  },

  // ── Test connection (1 API call) ──
  testConnection: async () => {
    set({ isTesting: true });
    try {
      const res = await fetch(`${API_BASE()}/api/trinks/test`);
      const data = await res.json();
      set({ isTesting: false });

      if (res.ok && data.ok) {
        const estabs = data.data?.data || data.data || [];
        const first = Array.isArray(estabs) ? estabs[0] : estabs;
        const name = first?.nome || "Conectado";
        set({
          isConnected: true,
          establishmentName: name,
        });
        return { ok: true, name };
      } else {
        return { ok: false, error: data.error || "Falha na conexão" };
      }
    } catch (err: any) {
      set({ isTesting: false });
      return { ok: false, error: err.message || "Erro de conexão" };
    }
  },

  // ── Sync all data ──
  syncData: async (force = false) => {
    set({ isSyncing: true, error: null });
    try {
      const url = force
        ? `${API_BASE()}/api/trinks/sync?force=true`
        : `${API_BASE()}/api/trinks/sync`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        set({ isSyncing: false, error: data.error || `Erro ${res.status}` });
        return { ok: false, error: data.error };
      }

      // Extract establishment name
      let estabName: string | null = null;
      const estab = data.estabelecimento;
      if (estab) {
        if (estab.data && Array.isArray(estab.data) && estab.data[0]) {
          estabName = estab.data[0].nome;
        } else if (Array.isArray(estab) && estab[0]) {
          estabName = estab[0].nome;
        } else if (estab.nome) {
          estabName = estab.nome;
        }
      }

      set({
        isConnected: true,
        isSyncing: false,
        trinks: data,
        lastSync: data.syncedAt || new Date().toISOString(),
        establishmentName: estabName || get().establishmentName,
        fromCache: !!data.fromCache,
        rateLimited: !!data.rateLimited,
        warning: data.warning || null,
        error: null,
      });

      return { ok: true };
    } catch (err: any) {
      set({ isSyncing: false, error: err.message });
      return { ok: false, error: err.message || "Erro de conexão" };
    }
  },

  // ── Clear server cache ──
  clearCache: async () => {
    try {
      await fetch(`${API_BASE()}/api/trinks/cache/clear`, { method: "POST" });
    } catch {
      // ignore
    }
  },
}));

// ─── Helpers ──────────────────────────────────────────────

/** Extract numeric value from a transaction (Trinks uses totalPagar) */
function getTransactionValue(t: any): number {
  return Number(t.totalPagar || t.valor || t.amount || t.valorTotal || 0);
}

/** Extract the date string from an item */
function getItemDate(item: any): string {
  const raw = item.dataHoraInicio || item.dataHora || item.dataReferencia || item.data || item.date || "";
  return typeof raw === "string" ? raw.split("T")[0] : "";
}

/** Get status name from agendamento */
function getStatusName(a: any): string {
  const st = a.status;
  if (!st) return "";
  if (typeof st === "string") return st;
  if (typeof st === "object") return st.descricao || st.nome || String(st.id || "");
  return String(st);
}

/** Check if agendamento is completed */
function isCompleted(a: any): boolean {
  const st = getStatusName(a).toLowerCase();
  return st === "finalizado" || st === "realizado" || st === "concluido" || st === "concluído";
}

/** Get professional ID from an item */
function getProfId(item: any): string {
  if (item.profissionalId) return String(item.profissionalId);
  if (item.profissional && typeof item.profissional === "object") return String(item.profissional.id || "");
  return "";
}

/** Get professional name from an item */
function getProfName(item: any): string {
  if (item.profissional && typeof item.profissional === "object") return item.profissional.nome || "";
  return "";
}

// ─── KPI Calculations ─────────────────────────────────────

export function getTrinksMonthTotals(trinks: TrinksData) {
  const transacoes = trinks.transacoes || [];
  const agendamentos = trinks.agendamentos || [];

  const totalRevenue = transacoes.reduce((sum: number, t: any) => {
    return sum + getTransactionValue(t);
  }, 0);

  const completedAgendamentos = agendamentos.filter(isCompleted);
  const totalClients = completedAgendamentos.length || agendamentos.length;
  const avgTicket = totalClients > 0 ? totalRevenue / totalClients : 0;

  const today = new Date().toISOString().split("T")[0];
  const todayAgendamentos = agendamentos.filter((a: any) => getItemDate(a).startsWith(today));
  const todayCompleted = todayAgendamentos.filter(isCompleted);
  const todayRevenue = todayCompleted.reduce((s: number, a: any) => s + Number(a.valor || 0), 0);

  // Payment method breakdown
  let totalPix = 0;
  let totalCartao = 0;
  let totalDinheiro = 0;
  let totalOutros = 0;

  transacoes.forEach((t: any) => {
    const formas = t.formasPagamentos || t.formasPagamento || [];
    if (Array.isArray(formas) && formas.length > 0) {
      formas.forEach((fp: any) => {
        const nome = (fp.nome || fp.descricao || "").toLowerCase();
        const val = Number(fp.valor || 0);
        if (nome.includes("pix")) {
          totalPix += val;
        } else if (nome.includes("créd") || nome.includes("cred") || nome.includes("déb") || nome.includes("deb") || nome.includes("cart")) {
          totalCartao += val;
        } else if (nome.includes("dinhe") || nome.includes("espécie") || nome.includes("cash")) {
          totalDinheiro += val;
        } else {
          totalOutros += val;
        }
      });
    } else {
      const val = getTransactionValue(t);
      const method = (t.formaPagamento || t.metodoPagamento || "").toLowerCase();
      if (method.includes("pix")) totalPix += val;
      else if (method.includes("cart")) totalCartao += val;
      else if (method.includes("dinhe")) totalDinheiro += val;
      else totalOutros += val;
    }
  });

  const profCount = (trinks.profissionais || []).length || 1;
  const dayOfMonth = new Date().getDate();
  const totalSlots = profCount * 10 * dayOfMonth;
  const occupationRate = totalSlots > 0 ? Math.min(100, (totalClients / totalSlots) * 100) : 0;

  return {
    totalRevenue,
    totalClients,
    avgTicket,
    todayClients: todayAgendamentos.length,
    todayRevenue,
    totalPix,
    totalCartao,
    totalDinheiro,
    totalOutros,
    occupationRate,
    daysOpen: dayOfMonth,
  };
}

export function getTrindsDailyRevenueChart(trinks: TrinksData) {
  const transacoes = trinks.transacoes || [];
  const agendamentos = trinks.agendamentos || [];
  const dailyMap: Record<string, { revenue: number; clients: number }> = {};

  transacoes.forEach((t: any) => {
    const date = getItemDate(t);
    if (!date) return;
    if (!dailyMap[date]) dailyMap[date] = { revenue: 0, clients: 0 };
    dailyMap[date].revenue += getTransactionValue(t);
  });

  agendamentos.forEach((a: any) => {
    const date = getItemDate(a);
    if (!date) return;
    if (!dailyMap[date]) dailyMap[date] = { revenue: 0, clients: 0 };
    if (isCompleted(a)) dailyMap[date].clients += 1;
  });

  return Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date: date.slice(8),
      fullDate: date,
      revenue: data.revenue,
      clients: data.clients,
    }));
}

export function getTrinksBarberRanking(trinks: TrinksData) {
  const profissionais = trinks.profissionais || [];
  const agendamentos = trinks.agendamentos || [];
  const profRevenue: Record<string, { revenue: number; clients: number; name: string }> = {};

  profissionais.forEach((p: any) => {
    const id = String(p.id || "");
    const name = p.nome || p.name || "Profissional";
    profRevenue[id] = { revenue: 0, clients: 0, name };
  });

  agendamentos.forEach((a: any) => {
    if (!isCompleted(a)) return;
    const profId = getProfId(a);
    if (profId && profRevenue[profId]) {
      profRevenue[profId].revenue += Number(a.valor || 0);
      profRevenue[profId].clients += 1;
    } else if (profId) {
      profRevenue[profId] = {
        revenue: Number(a.valor || 0),
        clients: 1,
        name: getProfName(a) || `Prof ${profId}`,
      };
    }
  });

  return Object.values(profRevenue)
    .sort((a, b) => b.revenue - a.revenue)
    .map((p) => ({
      name: p.name.split(" ")[0],
      revenue: p.revenue,
      clients: p.clients,
    }));
}

export function getTrinksPaymentMethodData(trinks: TrinksData) {
  const totals = getTrinksMonthTotals(trinks);
  const data = [
    { name: "Pix", value: totals.totalPix, color: "#01696F" },
    { name: "Cartão", value: totals.totalCartao, color: "#22c55e" },
    { name: "Dinheiro", value: totals.totalDinheiro, color: "#eab308" },
  ];
  if (totals.totalOutros > 0) {
    data.push({ name: "Outros", value: totals.totalOutros, color: "#8b5cf6" });
  }
  return data;
}

// ─── Revenue Summary (Day / Week / Month) ───────────────

export function getTrinksRevenueSummary(trinks: TrinksData) {
  const transacoes = trinks.transacoes || [];
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Start of current week (Monday)
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);
  const weekStartStr = monday.toISOString().split("T")[0];

  let dayRevenue = 0;
  let weekRevenue = 0;
  let monthRevenue = 0;

  transacoes.forEach((t: any) => {
    const date = getItemDate(t);
    if (!date) return;
    const val = getTransactionValue(t);
    monthRevenue += val;
    if (date >= weekStartStr) weekRevenue += val;
    if (date === todayStr) dayRevenue += val;
  });

  return { dayRevenue, weekRevenue, monthRevenue };
}

/** Revenue for a custom date range */
export function getTrinksRevenueByRange(trinks: TrinksData, startDate: string, endDate: string) {
  const transacoes = trinks.transacoes || [];
  let total = 0;
  transacoes.forEach((t: any) => {
    const date = getItemDate(t);
    if (!date) return;
    if (date >= startDate && date <= endDate) {
      total += getTransactionValue(t);
    }
  });
  return total;
}

// ─── Map Trinks profissionais to Barber format ────────────
export function mapTrinksProfissionais(trinks: TrinksData) {
  const profissionais = trinks.profissionais || [];
  const ranking = getTrinksBarberRanking(trinks);
  const rankingMap = new Map(ranking.map((r) => [r.name, r]));

  return profissionais.map((p: any, i: number) => {
    const name = p.nome || p.name || `Profissional ${i + 1}`;
    const firstName = name.split(" ")[0];
    const rank = rankingMap.get(firstName);
    const names = name.split(" ");
    const initials =
      names.length >= 2
        ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
        : name.slice(0, 2).toUpperCase();

    return {
      id: String(p.id || `trinks-${i}`),
      name,
      initials,
      commission: p.comissao || p.percentualComissao || 40,
      revenue: rank?.revenue || 0,
      clients: rank?.clients || 0,
      avgTicket: rank && rank.clients > 0 ? rank.revenue / rank.clients : 0,
      occupationRate: 0,
      active: p.ativo !== false && p.status !== "INATIVO",
    };
  });
}

// ─── Map Trinks servicos to Service format ────────────────
export function mapTrinksServicos(trinks: TrinksData) {
  const servicos = trinks.servicos || [];
  const agendamentos = trinks.agendamentos || [];

  const serviceCount: Record<string, number> = {};
  agendamentos.forEach((a: any) => {
    const svcId = String(a.servicoId || a.servico?.id || "");
    if (svcId) serviceCount[svcId] = (serviceCount[svcId] || 0) + 1;
    if (a.servicos && Array.isArray(a.servicos)) {
      a.servicos.forEach((s: any) => {
        const id = String(s.id || s.servicoId || "");
        if (id) serviceCount[id] = (serviceCount[id] || 0) + 1;
      });
    }
  });

  return servicos.map((s: any, i: number) => {
    const price = Number(s.preco || s.valor || s.price || 0);
    const cost = Number(s.custo || s.cost || 0);
    const duration = Number(s.duracao || s.duracaoMinutos || s.duration || 30);
    const id = String(s.id || `svc-${i}`);
    return {
      id,
      name: s.nome || s.name || `Serviço ${i + 1}`,
      price,
      avgDuration: duration,
      cost,
      margin: price > 0 ? ((price - cost) / price) * 100 : 0,
      popularity: serviceCount[id] || 0,
    };
  });
}

// ─── Format relative time for "last sync" display ────────
export function formatLastSync(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} minuto${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} hora${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}
