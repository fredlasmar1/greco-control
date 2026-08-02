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

// PASSO 4 — resumo do mês do Metas (atendimentos + serviço por barbeiro, dos
// appointments). O Control usa pra conferir contra a fonte dele (Gmail + CSV).
export interface MetasResumoMes {
  atendimentos: number;
  servicoRS: number;
  porBarbeiro: Array<{ nome: string; atendimentos: number; servicoRS: number }>;
}
export async function getMetasResumoMes(mes: string): Promise<MetasResumoMes | null> {
  if (!KEY) return null;
  try {
    const r = await fetch(`${BASE}/api/hub/resumo-mes/${encodeURIComponent(mes)}`, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    if (!j?.ok) return null;
    return { atendimentos: Number(j.atendimentos || 0), servicoRS: Number(j.servicoRS || 0), porBarbeiro: Array.isArray(j.porBarbeiro) ? j.porBarbeiro : [] };
  } catch { return null; }
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

// LEADS do mês (cliente novo com desconto, cadastrado no Metas) → fechamento da folha.
export interface MetasLeads {
  leads: any[];
  porBarbeiro: any[];
  porFonte?: any[];
  totais: { leads: number; compareceram: number; retornaram?: number; taxaComparecimento?: number; taxaRetorno?: number; valorTabela: number; descontoRS: number; liquido: number };
}
const leadsCache = new Map<string, { at: number; data: MetasLeads }>();
export async function getMetasLeads(mes: string): Promise<MetasLeads | null> {
  if (!KEY) return null;
  const hit = leadsCache.get(mes);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  try {
    const r = await fetch(`${BASE}/api/hub/leads/${encodeURIComponent(mes)}`, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return hit?.data || null;
    const j = (await r.json()) as any;
    if (!j?.ok) return hit?.data || null;
    const data: MetasLeads = { leads: j.leads || [], porBarbeiro: j.porBarbeiro || [], porFonte: j.porFonte || [], totais: j.totais || { leads: 0, compareceram: 0, retornaram: 0, valorTabela: 0, descontoRS: 0, liquido: 0 } };
    leadsCache.set(mes, { at: Date.now(), data });
    return data;
  } catch { return hit?.data || null; }
}

// Histórico mês a mês da conversão dos leads (a campanha está melhorando?).
const leadsHistCache = new Map<string, { at: number; data: any[] }>();
export async function getMetasLeadsHistorico(meses = 6): Promise<any[] | null> {
  if (!KEY) return null;
  const ck = `h${meses}`;
  const hit = leadsHistCache.get(ck);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  try {
    const r = await fetch(`${BASE}/api/hub/leads-historico?meses=${meses}`, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return hit?.data || null;
    const j = (await r.json()) as any;
    if (!j?.ok) return hit?.data || null;
    const data = Array.isArray(j.historico) ? j.historico : [];
    leadsHistCache.set(ck, { at: Date.now(), data });
    return data;
  } catch { return hit?.data || null; }
}

// DESCONTOS de colaborador lançados no Metas (vale, multa, consumo, voucher,
// compra, outro) → aba "Pagamento da Equipe" do Control desconta do salário.
export interface MetasDescontoItem { id: number; tipo: string; valor: number; motivo: string | null; createdAt: string; }
export interface MetasDescontoProf {
  professionalId: number | null;
  trinksId: string | null;
  nome: string | null;
  total: number;
  itens: MetasDescontoItem[];
  porTipo: Record<string, number>;
}
export interface MetasDescontos {
  total: number;
  descontos: Array<MetasDescontoItem & { professionalId: number | null; trinksId: string | null; nome: string | null }>;
  porProfissional: MetasDescontoProf[];
}
const descontosCache = new Map<string, { at: number; data: MetasDescontos }>();

// BANCO DE HORAS das assistentes (ponto batido na barbearia, vem do Metas). O
// Control usa isto pra alimentar o salarioFixo de quem ganha por hora (Débora,
// Ellen). ⚠️ a Larissa BATE PONTO mas é CLT — quem paga por hora é decidido na
// folha (allowlist), não aqui: esta função só traz o que o Metas registrou.
export interface MetasHoraAssistente { nome: string | null; trinksId: string | null; horas: number; valor: number; dias: number; turnosAbertos: number; }
export interface MetasBancoHoras { mes: string; taxaPadrao: number; totalHoras: number; totalValor: number; porAssistente: MetasHoraAssistente[]; }
const bancoHorasCache = new Map<string, { at: number; data: MetasBancoHoras }>();
export async function getMetasBancoHoras(mes: string): Promise<MetasBancoHoras | null> {
  if (!KEY) return null;
  const hit = bancoHorasCache.get(mes);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  try {
    const r = await fetch(`${BASE}/api/hub/banco-horas/${encodeURIComponent(mes)}`, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return hit?.data || null;
    const j = (await r.json()) as any;
    if (!j?.ok) return hit?.data || null;
    const data: MetasBancoHoras = {
      mes: j.mes || mes,
      taxaPadrao: Number(j.taxaPadrao || 10),
      totalHoras: Number(j.totalHoras || 0),
      totalValor: Number(j.totalValor || 0),
      porAssistente: Array.isArray(j.porAssistente) ? j.porAssistente : [],
    };
    bancoHorasCache.set(mes, { at: Date.now(), data });
    return data;
  } catch { return hit?.data || null; }
}

export async function getMetasDescontos(mes: string): Promise<MetasDescontos | null> {
  if (!KEY) return null;
  const hit = descontosCache.get(mes);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  try {
    const r = await fetch(`${BASE}/api/hub/descontos/${encodeURIComponent(mes)}`, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return hit?.data || null;
    const j = (await r.json()) as any;
    if (!j?.ok) return hit?.data || null;
    const data: MetasDescontos = {
      total: Number(j.total || 0),
      descontos: Array.isArray(j.descontos) ? j.descontos : [],
      porProfissional: Array.isArray(j.porProfissional) ? j.porProfissional : [],
    };
    descontosCache.set(mes, { at: Date.now(), data });
    return data;
  } catch { return hit?.data || null; }
}

// ESCRITA no Metas: replica o que o Control apurou (consumo do relatório "Vendas
// de Produto" da Trinks + vales) na tela /descontos, que é onde a equipe vê. O
// Metas só tinha lançamento manual da recepção — em jul/2026, R$ 749 de consumo
// contra R$ 2.348,50 reais, e nenhum vale.
//
// Idempotente por origem (created_by) e respeita os DIAS FECHADOS da tela: dia
// conferido e travado pela recepção não é tocado.
export interface MetasSyncItem {
  trinksId?: string | null;
  nome?: string | null;
  tipo: "vale" | "consumo" | "multa" | "compra" | "outro";
  valor: number;
  motivo?: string;
  data?: string; // YYYY-MM-DD — vira o created_at (a tela agrupa consumo por dia)
}
export interface MetasSyncResultado {
  ok: boolean;
  mes: string;
  inseridos: number;
  total: number;
  removidos: number;
  removidosDetalhe: any[];
  naoCasaram: any[];
  diasFechados: string[];
  puladosDiaFechado: any[];
}
export async function syncMetasDescontos(
  mes: string, itens: MetasSyncItem[], substituirTipos: string[] = [],
): Promise<MetasSyncResultado> {
  if (!KEY) throw new Error("HUB_API_KEY não configurada — não dá pra escrever no Metas.");
  const r = await fetch(`${BASE}/api/hub/descontos/sync`, {
    method: "POST",
    headers: { "x-hub-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ mes, itens, substituirTipos, origem: "greco-control" }),
    signal: AbortSignal.timeout(30000),
  });
  const j = (await r.json()) as any;
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Metas respondeu ${r.status}`);
  return j as MetasSyncResultado;
}

// REATIVAR/COBRAR do Metas (motor de reativação: base rec_clients deduplicada +
// rec_reactivations). Alimenta a Retenção do Control com a lista AUTORITATIVA de
// quem reativar (com telefone/quem-atende), a saúde da carteira e o placar do mês.
export interface MetasReativacaoSeg { clube: number; fiel: number; poucas: number; novo: number; total: number; }
export interface MetasReativacao {
  mes: string;
  saude: { emDia: MetasReativacaoSeg; atrasados: MetasReativacaoSeg; sumidos: MetasReativacaoSeg };
  placar: { reativadosMes: number; aguardando: number; reativadosPorPessoa: Array<{ pessoa: string; total: number }> };
  totalReativar: number;
  topReativar: Array<{
    id: number; nome: string; phone: string | null; status: string; classificacao: string | null;
    ultimaVisita: string | null; diasSemVir: number | null; totalVisitas: number;
    profissional: string | null; statusContato: string | null; reativadoPor: string | null;
  }>;
}
const reativacaoCache = new Map<string, { at: number; data: MetasReativacao }>();
export async function getMetasReativacao(mes: string, limit = 150): Promise<MetasReativacao | null> {
  if (!KEY) return null;
  const ck = `${mes}|${limit}`;
  const hit = reativacaoCache.get(ck);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  try {
    const r = await fetch(`${BASE}/api/hub/reativacao/${encodeURIComponent(mes)}?limit=${limit}`, { headers: { "x-hub-key": KEY }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return hit?.data || null;
    const j = (await r.json()) as any;
    if (!j?.ok) return hit?.data || null;
    const data: MetasReativacao = {
      mes: j.mes || mes,
      saude: j.saude || { emDia: {}, atrasados: {}, sumidos: {} },
      placar: j.placar || { reativadosMes: 0, aguardando: 0, reativadosPorPessoa: [] },
      totalReativar: Number(j.totalReativar || 0),
      topReativar: Array.isArray(j.topReativar) ? j.topReativar : [],
    };
    reativacaoCache.set(ck, { at: Date.now(), data });
    return data;
  } catch { return hit?.data || null; }
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
