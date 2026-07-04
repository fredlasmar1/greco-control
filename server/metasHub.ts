/**
 * Cliente do HUB do Greco Metas (integração Control ⇄ Metas — Fase B).
 *
 * O Metas é a fonte AO VIVO (API Trinks) do histórico de atendimento. O Control
 * consome daqui pra mostrar, em cada assinante do Clube Greco, o USO REAL:
 * última visita, total de visitas e visitas no mês. Cruzamento pela chave telefone.
 * Config: METAS_HUB_URL (default produção) + HUB_API_KEY (mesma chave dos dois).
 */
const BASE = process.env.METAS_HUB_URL || "https://grecometas-production.up.railway.app";
const KEY = process.env.HUB_API_KEY || "";

export interface UsoMetas {
  totalVisitas: number;
  ultimaVisita: string | null;
  visitasMes: number;
}

// Cache curto por mês (5min) — o Metas é ao vivo, mas não precisa martelar.
const cache = new Map<string, { at: number; data: Record<string, UsoMetas> }>();

// BOCA ÚNICA (Passo 1) — busca agendamentos do HUB do Metas (servidos do banco,
// 0 token Trinks), no mesmo formato do /v1/agendamentos. Retorna null se o HUB
// não responder, pra o chamador cair no fallback (Trinks ao vivo).
export async function getMetasAgendamentos(dataInicio: string, dataFim: string): Promise<any[] | null> {
  if (!KEY) return null;
  try {
    const url = `${BASE}/api/hub/agendamentos?dataInicio=${encodeURIComponent(dataInicio)}&dataFim=${encodeURIComponent(dataFim)}`;
    const r = await fetch(url, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok: boolean; agendamentos?: any[] };
    if (!j?.ok || !Array.isArray(j.agendamentos)) return null;
    return j.agendamentos;
  } catch {
    return null;
  }
}

// BOCA ÚNICA (Passo 2) — pega um recurso da Trinks pelo PROXY do Metas (uma boca
// só + cache no HUB). Retorna os itens no formato cru da Trinks, ou null se o HUB
// não responder (chamador cai no fallback ao vivo). Ex.: transacoes.
export async function getMetasTrinks(recurso: string, params: Record<string, string>): Promise<any[] | null> {
  if (!KEY) return null;
  try {
    const qs = new URLSearchParams();
    for (const k of ["dataInicio", "dataFim", "data", "profissionalId"]) {
      if (params[k]) qs.set(k, params[k]);
    }
    const url = `${BASE}/api/hub/trinks/${encodeURIComponent(recurso)}?${qs.toString()}`;
    const r = await fetch(url, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok: boolean; items?: any[] };
    if (!j?.ok || !Array.isArray(j.items)) return null;
    return j.items;
  } catch {
    return null;
  }
}

// PASSO 3 — quota do Metas (consumo Trinks dele + teto do plano da conta).
export interface MetasQuota { usados: number; plano: number; cotaConta: number; erro429: number; }
let mqCache: { at: number; data: MetasQuota } | null = null;
export async function getMetasQuota(): Promise<MetasQuota | null> {
  if (!KEY) return null;
  if (mqCache && Date.now() - mqCache.at < 2 * 60 * 1000) return mqCache.data;
  try {
    const r = await fetch(`${BASE}/api/hub/quota`, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return mqCache?.data || null;
    const j = (await r.json()) as any;
    if (!j?.ok) return mqCache?.data || null;
    const data = { usados: Number(j.usados || 0), plano: Number(j.plano || 0), cotaConta: Number(j.cotaConta || 0), erro429: Number(j.erro429 || 0) };
    mqCache = { at: Date.now(), data };
    return data;
  } catch { return mqCache?.data || null; }
}

export async function getMetasVisitas(phones: string[], mes: string): Promise<Record<string, UsoMetas>> {
  if (!KEY || !phones.length) return {};
  const key = `${mes}|${phones.length}`;
  const hit = cache.get(mes);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  try {
    const r = await fetch(`${BASE}/api/hub/clientes-visitas`, {
      method: "POST",
      headers: { "x-hub-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ phones, mes }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return hit?.data || {};
    const j = (await r.json()) as { ok: boolean; clientes?: Record<string, UsoMetas> };
    if (!j?.ok) return hit?.data || {};
    const data = j.clientes || {};
    cache.set(mes, { at: Date.now(), data });
    return data;
  } catch {
    return hit?.data || {};
  }
}
