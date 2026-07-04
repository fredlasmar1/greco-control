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
