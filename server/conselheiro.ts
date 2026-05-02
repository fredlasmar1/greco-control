// ═══════════════════════════════════════════════════════════
//  conselheiro.ts — Helpers do Conselheiro IA (Greco Control)
// ═══════════════════════════════════════════════════════════
//  Constrói o snapshot da empresa a partir do estado em memória
//  e monta o system prompt do consultor estratégico.
// ═══════════════════════════════════════════════════════════

export interface ConselheiroSnapshot {
  periodo: {
    hoje: string;                  // YYYY-MM-DD
    dia_semana: string;            // ex: "sexta-feira"
    mes_atual: string;              // ex: "maio de 2026"
    mes_atual_iso: string;          // YYYY-MM
    dia_do_mes: number;             // 1..31
    dias_no_mes: number;            // 28..31
    dias_decorridos: number;        // dias do mês já passados (incluindo hoje)
    dias_uteis_decorridos: number;  // seg-sáb, excluindo domingos
    dias_uteis_total: number;
    dias_uteis_restantes: number;
    mes_corrente_parcial: boolean;  // true se hoje < último dia do mês
    gerado_em: string;
  };
  financeiro: {
    faturamento_mes: number;
    faturamento_anterior: number;
    var_faturamento: number;
    ritmo_diario: number;           // faturamento_mes / dias_uteis_decorridos (≈ media diaria)
    projecao_fim_mes: number;       // ritmo_diario * dias_uteis_total (estimativa linear)
    despesas_mes: number;
    despesas_anterior: number;
    var_despesas: number;
    despesas_lancadas: boolean;     // false se não houve nenhum lançamento de despesa no mês
    resultado_liquido: number;
    var_resultado: number;
    margem_percentual: number;
    inadimplencia: number;
    var_inadimplencia: number;
  };
  fluxo_caixa: {
    entradas_mes: number;
    saidas_mes: number;
    saldo_periodo: number;
    pix_mes: number;
    cartao_mes: number;
    dinheiro_mes: number;
  };
  contas_receber: { total_titulos: number; total_valor: number; vencido: number; a_vencer: number };
  contas_pagar: { total_titulos: number; total_valor: number; vencido: number; a_vencer: number };
  clientes: { total_clientes: number; clientes_ativos: number; novos_30_dias: number; em_risco_churn: number };
  servicos: {
    total_servicos: number;
    top_5_mes: string;
    /** Top 5 serviços do mês corrente com volume e receita (vindo do Trinks). */
    top_5_real: Array<{ nome: string; quantidade: number; receita: number; preco_medio: number }>;
  };
  equipe: {
    total_barbeiros: number;
    ativos: number;
    folha_total: number;
    pct_folha_faturamento: number;
    /** Top 5 barbeiros do mês corrente (ordenados por faturamento). */
    top_mes: Array<{
      nome: string;
      faturamento: number;
      atendimentos: number;
      ticket_medio: number;
      pct_do_total: number;
    }>;
  };
  meta_mensal: { target: number; achieved: number; pct: number };
  /** Agendamentos confirmados ainda por vir (pipeline). */
  pipeline: {
    semana: { qtd: number; valor: number };
    mes: { qtd: number; valor: number };
  };
  /** Caixa fechado de hoje + comparação com média do mês. */
  hoje: {
    faturamento: number;
    comandas: number;
    pix: number;
    cartao: number;
    dinheiro: number;
    outros: number;
    ritmo_vs_media: number;
  };
  historico_mensal: Array<{ mes: string; faturamento: number; clientes: number }>;
}

interface DailyEntry {
  id: string;
  date: string;
  type: 'receita' | 'despesa';
  description: string;
  amount: number;
  clients?: number;
  pix?: number;
  cartao?: number;
  dinheiro?: number;
  category?: string;
}

interface Barber {
  id: string;
  name: string;
  commission?: number;
  revenue?: number;
  clients?: number;
  active?: boolean;
}

interface Service {
  id: string;
  name: string;
  price?: number;
  popularity?: number;
}

interface FinanceEntry {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  recurrent: boolean;
}

interface AssinaturaCliente {
  id: string;
  status: 'active' | 'cancelled' | 'expired';
  contractDate: string;
  contractEndDate: string;
  paymentDay?: number;
  planValue?: number;
  payments: Array<{ mes: string; pago: boolean; valor: number }>;
}

interface MetaHistorico { month: string; target: number; achieved: number }

export interface TrinksFinanceiroMes {
  totalValor: number;
  totalLinhas: number;
  resumoPorForma?: Record<string, number>;
  resumoPorDia?: Record<string, number>;
}

export interface TrinksDREMes {
  totalReceitas: number;
  totalDespesas: number;
  resultadoPeriodo: number;
}

export interface TrinksMesCorrente {
  faturamento: number;       // soma de transações fechadas no mês corrente
  clientes: number;          // clientes únicos atendidos
  agendamentosCount: number; // total de agendamentos do mês (fechados ou não)
  pix?: number;
  cartao?: number;
  dinheiro?: number;
  outros?: number;
}

export interface RankingBarbeiroMes {
  profissionalId: string;
  nome: string;
  faturamento: number;
  atendimentos: number;
}

export interface TopServicoMes {
  nome: string;
  quantidade: number;
  receita: number;
  preco_medio: number;
}

export interface ConselheiroDataSources {
  entries: DailyEntry[];
  barbers: Barber[];
  services: Service[];
  financeEntries: FinanceEntry[];
  assinaturaClientes: AssinaturaCliente[];
  metasHistorico: MetaHistorico[];
  monthlyTarget?: number;
  shopName?: string;
  // Dados ricos do Trinks (preferenciais quando presentes)
  trinksFinanceiroPorMes?: Record<string, TrinksFinanceiroMes>;
  trinksDREPorMes?: Record<string, TrinksDREMes>;
  trinksMesCorrente?: TrinksMesCorrente;
  /** Ranking de barbeiros do mês corrente (do endpoint de pagamento). */
  rankingBarbeirosMes?: RankingBarbeiroMes[];
  /** Top serviços do mês corrente (vindos de agendamentos finalizados do Trinks). */
  topServicosMes?: TopServicoMes[];
  /** Folha real do mês corrente (do endpoint de pagamento — comissões + bônus + ajustes). */
  folhaReal?: {
    totalBruto: number;
    totalSaldoAPagar: number;
    qtdProfissionaisComMovimento: number;
  };
  /** Agendamentos futuros (pipeline) do mês corrente — a partir de hoje. */
  pipeline?: {
    semana: { qtd: number; valor: number };
    mes: { qtd: number; valor: number };
  };
  /** Resumo do dia atual (caixa fechado + ritmo). */
  hoje?: {
    faturamento: number;
    comandas: number;
    pix: number;
    cartao: number;
    dinheiro: number;
    outros: number;
    /** ritmo do dia comparado à média diária do mês (-1 a +1, ex: 0.2 = 20% acima). */
    ritmo_vs_media: number;
  };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ym(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d + 'T12:00:00') : d;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }

// Conta dias úteis (seg-sáb, ignora domingo) entre duas datas inclusive.
function diasUteisEntre(inicio: Date, fim: Date): number {
  if (fim < inicio) return 0;
  let n = 0;
  const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const last = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  while (d <= last) {
    if (d.getDay() !== 0) n++; // 0 = domingo
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export function buildSnapshot(data: ConselheiroDataSources): ConselheiroSnapshot {
  const now = new Date();
  const mesAtual = ym(now);
  const mesAnterior = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const trintaDiasAtras = new Date(now); trintaDiasAtras.setDate(now.getDate() - 30);
  const noventaDiasAtras = new Date(now); noventaDiasAtras.setDate(now.getDate() - 90);

  const entries = data.entries || [];
  const receitasMes = entries.filter(e => e.type === 'receita' && ym(e.date) === mesAtual);
  const receitasMesAnt = entries.filter(e => e.type === 'receita' && ym(e.date) === mesAnterior);
  const despesasEntries = entries.filter(e => e.type === 'despesa' && ym(e.date) === mesAtual);
  const despesasEntriesAnt = entries.filter(e => e.type === 'despesa' && ym(e.date) === mesAnterior);

  // Financeiro adicional vem dos lançamentos do módulo Financeiro
  const financeMes = (data.financeEntries || []).filter(f => ym(f.date) === mesAtual);
  const financeMesAnt = (data.financeEntries || []).filter(f => ym(f.date) === mesAnterior);
  const despesasFinance = financeMes.filter(f => f.amount < 0).reduce((s, f) => s + Math.abs(f.amount), 0);
  const despesasFinanceAnt = financeMesAnt.filter(f => f.amount < 0).reduce((s, f) => s + Math.abs(f.amount), 0);

  // FATURAMENTO — prioridade: Trinks import > Trinks sync (mês corrente) > entries manuais
  const trinksFin = data.trinksFinanceiroPorMes || {};
  const trinksDre = data.trinksDREPorMes || {};
  const trinksHoje = data.trinksMesCorrente;

  const faturamento_mes_entries = receitasMes.reduce((s, e) => s + e.amount, 0);
  const faturamento_mes = trinksFin[mesAtual]?.totalValor
    ?? trinksHoje?.faturamento
    ?? faturamento_mes_entries;
  const faturamento_anterior = trinksFin[mesAnterior]?.totalValor
    ?? receitasMesAnt.reduce((s, e) => s + e.amount, 0);

  // DESPESAS — prioridade: DRE Trinks > entries+financeEntries
  const despesas_mes_manual = despesasEntries.reduce((s, e) => s + e.amount, 0) + despesasFinance;
  const despesas_anterior_manual = despesasEntriesAnt.reduce((s, e) => s + e.amount, 0) + despesasFinanceAnt;
  const despesas_mes = trinksDre[mesAtual]?.totalDespesas ?? despesas_mes_manual;
  const despesas_anterior = trinksDre[mesAnterior]?.totalDespesas ?? despesas_anterior_manual;

  const var_faturamento = faturamento_anterior > 0 ? ((faturamento_mes - faturamento_anterior) / faturamento_anterior) * 100 : 0;
  const var_despesas = despesas_anterior > 0 ? ((despesas_mes - despesas_anterior) / despesas_anterior) * 100 : 0;
  const resultado_liquido = faturamento_mes - despesas_mes;
  const resultado_anterior = faturamento_anterior - despesas_anterior;
  const var_resultado = Math.abs(resultado_anterior) > 0 ? ((resultado_liquido - resultado_anterior) / Math.abs(resultado_anterior)) * 100 : 0;
  const margem_percentual = faturamento_mes > 0 ? (resultado_liquido / faturamento_mes) * 100 : 0;

  // Inadimplência: assinantes com mês JÁ vencido sem pagamento
  // (mês atual só conta como devido depois do paymentDay)
  // Parse YYYY-MM-DD em timezone local para evitar off-by-one de UTC
  const parseLocalDate = (s: string): Date => {
    const [y, mo, d] = s.split('-').map(Number);
    return new Date(y, (mo || 1) - 1, d || 1);
  };
  const assinantes = data.assinaturaClientes || [];
  const inadimplentes = assinantes.filter(c => {
    if (c.status !== 'active') return false;
    const start = parseLocalDate(c.contractDate);
    const end = parseLocalDate(c.contractEndDate);
    const limite = now < end ? now : end;
    const payDay = c.paymentDay || 1;
    const ultimoDevido = limite.getDate() >= payDay
      ? new Date(limite.getFullYear(), limite.getMonth(), 1)
      : new Date(limite.getFullYear(), limite.getMonth() - 1, 1);
    const pagoSet = new Set(c.payments.filter(p => p.pago).map(p => p.mes));
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d <= ultimoDevido) {
      const m = ym(d);
      if (!pagoSet.has(m)) return true;
      d.setMonth(d.getMonth() + 1);
    }
    return false;
  });
  const inadimplencia = inadimplentes.reduce((s, c) => {
    return s + (c.planValue || c.payments[c.payments.length - 1]?.valor || 0);
  }, 0);

  // Fluxo de caixa por meio de pagamento — prefere Trinks (categoriza melhor)
  const formaTrinks = trinksFin[mesAtual]?.resumoPorForma;
  const sumByPattern = (rec: Record<string, number> | undefined, patterns: string[]): number => {
    if (!rec) return 0;
    let total = 0;
    for (const [k, v] of Object.entries(rec)) {
      const lk = k.toLowerCase();
      if (patterns.some(p => lk.includes(p))) total += v;
    }
    return total;
  };
  const pix_mes = formaTrinks
    ? sumByPattern(formaTrinks, ['pix'])
    : trinksHoje?.pix ?? receitasMes.reduce((s, e) => s + (e.pix || 0), 0);
  const cartao_mes = formaTrinks
    ? sumByPattern(formaTrinks, ['cartão', 'cartao', 'crédito', 'credito', 'débito', 'debito'])
    : trinksHoje?.cartao ?? receitasMes.reduce((s, e) => s + (e.cartao || 0), 0);
  const dinheiro_mes = formaTrinks
    ? sumByPattern(formaTrinks, ['dinheiro', 'à vista', 'a vista'])
    : trinksHoje?.dinheiro ?? receitasMes.reduce((s, e) => s + (e.dinheiro || 0), 0);

  // Contas a pagar (do módulo Financeiro): despesas futuras (próximos 30 dias)
  const proximos30 = new Date(now); proximos30.setDate(now.getDate() + 30);
  const contasPagarFuturas = (data.financeEntries || []).filter(f => {
    const dt = new Date(f.date + 'T12:00:00');
    return f.amount < 0 && dt >= now && dt <= proximos30;
  });
  const contasPagarVencidas = (data.financeEntries || []).filter(f => {
    const dt = new Date(f.date + 'T12:00:00');
    return f.amount < 0 && dt < now && ym(f.date) === mesAtual;
  });

  // Clientes ativos: aproximação via assinantes
  const clientesAtivos = assinantes.filter(c => c.status === 'active').length;
  const novosUltimos30 = assinantes.filter(c => new Date(c.contractDate) >= trintaDiasAtras).length;
  const emRiscoChurn = assinantes.filter(c => {
    if (c.status !== 'active') return false;
    const lastPayment = c.payments.filter(p => p.pago).slice(-1)[0];
    if (!lastPayment) return false;
    return new Date(lastPayment.mes + '-01') < noventaDiasAtras;
  }).length;

  // Top 5 serviços — preferir dados reais do Trinks; fallback para popularidade do mock
  const top5Real = (data.topServicosMes || []).slice(0, 5);
  const top5 = top5Real.length > 0
    ? top5Real.map(s => `${s.nome} (${s.quantidade})`).join(', ')
    : (data.services || [])
        .slice()
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 5)
        .map(s => s.name)
        .join(', ');

  // Equipe
  const barbeirosAtivos = (data.barbers || []).filter(b => b.active !== false);
  // Folha — preferir o cálculo real (comissões + bônus + ajustes do endpoint de Pagamento);
  // só cair no estimado mock se não houver dado real.
  const folhaEstimadaMock = barbeirosAtivos.reduce((s, b) => s + ((b.revenue || 0) * ((b.commission || 0) / 100)), 0);
  const folhaTotal = data.folhaReal?.totalBruto ?? folhaEstimadaMock;
  const pct_folha_faturamento = faturamento_mes > 0 ? (folhaTotal / faturamento_mes) * 100 : 0;

  // Top 5 barbeiros do mês (ranking real do Trinks via endpoint de pagamento)
  const ranking = data.rankingBarbeirosMes || [];
  const totalRanking = ranking.reduce((s, r) => s + r.faturamento, 0);
  const top_mes = ranking
    .slice()
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 5)
    .map(r => ({
      nome: r.nome,
      faturamento: r.faturamento,
      atendimentos: r.atendimentos,
      ticket_medio: r.atendimentos > 0 ? r.faturamento / r.atendimentos : 0,
      pct_do_total: totalRanking > 0 ? (r.faturamento / totalRanking) * 100 : 0,
    }));

  // Meta do mês
  const metaAtual = (data.metasHistorico || []).find(m => m.month === mesAtual);
  const target = metaAtual?.target || data.monthlyTarget || 0;
  const achieved = metaAtual?.achieved || faturamento_mes;
  const pctMeta = target > 0 ? (achieved / target) * 100 : 0;

  // Histórico mensal (12 últimos meses) — Trinks tem prioridade, entries complementa
  const historicoMap = new Map<string, { faturamento: number; clientes: number }>();
  // Base: entries manuais
  for (const e of entries) {
    if (e.type !== 'receita') continue;
    const m = ym(e.date);
    const cur = historicoMap.get(m) || { faturamento: 0, clientes: 0 };
    cur.faturamento += e.amount;
    cur.clientes += e.clients || 0;
    historicoMap.set(m, cur);
  }
  // Override: Trinks import (mais confiável). Se houver dado consolidado do Trinks, ele substitui.
  for (const [mes, fin] of Object.entries(trinksFin)) {
    historicoMap.set(mes, {
      faturamento: fin.totalValor,
      clientes: fin.totalLinhas, // qtd de pagamentos como aproximação de atendimentos
    });
  }
  // Mês corrente parcial via Trinks sync (se ainda não tem import financeiro)
  if (!trinksFin[mesAtual] && trinksHoje) {
    historicoMap.set(mesAtual, {
      faturamento: trinksHoje.faturamento,
      clientes: trinksHoje.clientes,
    });
  }
  const historico_mensal = Array.from(historicoMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([mes, v]) => ({ mes, faturamento: Math.round(v.faturamento), clientes: v.clientes }));

  // Contexto temporal — fundamental para o modelo entender que mês está em curso
  const inicioMes = startOfMonth(now);
  const fimMes = endOfMonth(now);
  const dia_do_mes = now.getDate();
  const dias_no_mes = fimMes.getDate();
  const dias_decorridos = dia_do_mes;
  const dias_uteis_decorridos = diasUteisEntre(inicioMes, now);
  const dias_uteis_total = diasUteisEntre(inicioMes, fimMes);
  const dias_uteis_restantes = Math.max(0, dias_uteis_total - dias_uteis_decorridos);
  const mes_corrente_parcial = dia_do_mes < dias_no_mes;
  const ritmo_diario = dias_uteis_decorridos > 0 ? faturamento_mes / dias_uteis_decorridos : 0;
  const projecao_fim_mes = ritmo_diario * dias_uteis_total;
  const despesas_lancadas = (despesasEntries.length + financeMes.filter(f => f.amount < 0).length) > 0 || !!trinksDre[mesAtual];
  const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  return {
    periodo: {
      hoje: ymd(now),
      dia_semana: diasSemana[now.getDay()],
      mes_atual: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      mes_atual_iso: mesAtual,
      dia_do_mes,
      dias_no_mes,
      dias_decorridos,
      dias_uteis_decorridos,
      dias_uteis_total,
      dias_uteis_restantes,
      mes_corrente_parcial,
      gerado_em: now.toISOString(),
    },
    financeiro: {
      faturamento_mes,
      faturamento_anterior,
      var_faturamento,
      ritmo_diario,
      projecao_fim_mes,
      despesas_mes,
      despesas_anterior,
      var_despesas,
      despesas_lancadas,
      resultado_liquido,
      var_resultado,
      margem_percentual,
      inadimplencia,
      var_inadimplencia: 0,
    },
    fluxo_caixa: {
      entradas_mes: faturamento_mes,
      saidas_mes: despesas_mes,
      saldo_periodo: resultado_liquido,
      pix_mes,
      cartao_mes,
      dinheiro_mes,
    },
    contas_receber: {
      total_titulos: inadimplentes.length,
      total_valor: inadimplencia,
      vencido: inadimplencia,
      a_vencer: 0,
    },
    contas_pagar: {
      total_titulos: contasPagarFuturas.length + contasPagarVencidas.length,
      total_valor: contasPagarFuturas.reduce((s, f) => s + Math.abs(f.amount), 0) + contasPagarVencidas.reduce((s, f) => s + Math.abs(f.amount), 0),
      vencido: contasPagarVencidas.reduce((s, f) => s + Math.abs(f.amount), 0),
      a_vencer: contasPagarFuturas.reduce((s, f) => s + Math.abs(f.amount), 0),
    },
    clientes: {
      total_clientes: assinantes.length,
      clientes_ativos: clientesAtivos,
      novos_30_dias: novosUltimos30,
      em_risco_churn: emRiscoChurn,
    },
    servicos: {
      total_servicos: (data.services || []).length,
      top_5_mes: top5 || 'Não disponível',
      top_5_real: top5Real,
    },
    equipe: {
      total_barbeiros: (data.barbers || []).length,
      ativos: barbeirosAtivos.length,
      folha_total: folhaTotal,
      pct_folha_faturamento,
      top_mes,
    },
    meta_mensal: { target, achieved, pct: pctMeta },
    pipeline: data.pipeline || { semana: { qtd: 0, valor: 0 }, mes: { qtd: 0, valor: 0 } },
    hoje: data.hoje || { faturamento: 0, comandas: 0, pix: 0, cartao: 0, dinheiro: 0, outros: 0, ritmo_vs_media: 0 },
    historico_mensal,
  };
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const pct = (v: number) => `${(v || 0).toFixed(1)}%`;

export function buildSystemPrompt(snap: ConselheiroSnapshot, shopName = 'Greco Barbearia'): string {
  const p = snap.periodo;
  const f = snap.financeiro;
  const fc = snap.fluxo_caixa;
  const cr = snap.contas_receber;
  const cp = snap.contas_pagar;
  const cl = snap.clientes;
  const sv = snap.servicos;
  const eq = snap.equipe;
  const meta = snap.meta_mensal;
  const hist = snap.historico_mensal;

  const histTxt = hist.length > 0
    ? hist.map(h => `${h.mes} ${brl(h.faturamento)} (${h.clientes} atend.)`).join(', ')
    : 'sem histórico disponível';

  // Qualificadores de dado parcial/ausente — para o modelo não confundir ausência com queda
  const statusMes = p.mes_corrente_parcial
    ? `MÊS EM CURSO — hoje é ${p.hoje} (${p.dia_semana}), dia ${p.dia_do_mes} de ${p.dias_no_mes}. Decorreram ${p.dias_uteis_decorridos} de ${p.dias_uteis_total} dias úteis. Faltam ${p.dias_uteis_restantes} dias úteis.`
    : `MÊS FECHADO — todos os ${p.dias_uteis_total} dias úteis transcorridos.`;

  const qualifFaturamento = p.mes_corrente_parcial
    ? `Faturamento parcial: ${brl(f.faturamento_mes)} em ${p.dias_uteis_decorridos} dias úteis. Ritmo diário ${brl(f.ritmo_diario)}. Projeção linear de fechamento: ${brl(f.projecao_fim_mes)}.`
    : `Faturamento fechado: ${brl(f.faturamento_mes)}.`;

  const qualifDespesas = !f.despesas_lancadas
    ? `Despesas: nenhum lançamento registrado para ${p.mes_atual_iso} ainda. Não interprete como "despesa zero" — significa que não houve lançamento. Para o mês fechado de referência (${brl(f.despesas_anterior)} no mês anterior), os lançamentos costumam acontecer ao longo do mês.`
    : `Despesas lançadas no mês: ${brl(f.despesas_mes)} (${f.var_despesas >= 0 ? '+' : ''}${pct(f.var_despesas)} vs mês anterior).`;

  const qualifMeta = meta.target > 0
    ? `Meta mensal: ${brl(meta.target)}. Realizado até agora: ${brl(meta.achieved)} (${pct(meta.pct)}).`
    : 'Sem meta mensal cadastrada.';

  return `Você é o Conselheiro do Greco Control: um consultor financeiro e estratégico de ${shopName}, barbearia premium em Anápolis-GO. Sua função é ler os números abaixo e responder com análise útil — direta, factual, sem alarmismo.

CONTEXTO TEMPORAL
${statusMes}

DADOS FINANCEIROS DO MÊS
${qualifFaturamento}
${qualifDespesas}
Mês anterior fechou em ${brl(f.faturamento_anterior)} de receita.
${qualifMeta}

FLUXO DE CAIXA POR MEIO (mês corrente)
Pix ${brl(fc.pix_mes)}, Cartão ${brl(fc.cartao_mes)}, Dinheiro ${brl(fc.dinheiro_mes)}.

HOJE (${p.hoje}, ${p.dia_semana})
${snap.hoje.comandas > 0
  ? `${snap.hoje.comandas} comandas fechadas até agora somando ${brl(snap.hoje.faturamento)} (Pix ${brl(snap.hoje.pix)}, Cartão ${brl(snap.hoje.cartao)}, Dinheiro ${brl(snap.hoje.dinheiro)}). Ritmo do dia ${snap.hoje.ritmo_vs_media >= 0 ? '+' : ''}${pct(snap.hoje.ritmo_vs_media * 100)} vs média diária do mês.`
  : 'Nenhuma comanda fechada ainda hoje.'
}

PIPELINE (agendamentos confirmados ainda por vir, do hoje em diante)
${snap.pipeline.mes.qtd > 0
  ? `Total no resto do mês: ${snap.pipeline.mes.qtd} agendamentos (${brl(snap.pipeline.mes.valor)} estimados). Desse total, ${snap.pipeline.semana.qtd} são até o fim desta semana (${brl(snap.pipeline.semana.valor)}). Atenção: 'semana' está contida em 'mês', não some os dois.`
  : 'Sem agendamentos futuros visíveis no cache.'
}

ASSINATURAS
${cl.total_clientes} contratos no total, ${cl.clientes_ativos} ativos. Novos nos últimos 30 dias: ${cl.novos_30_dias}. Inadimplentes: ${cr.total_titulos} (${brl(cr.total_valor)}). Em risco de churn (sem pagamento há 90+ dias): ${cl.em_risco_churn}.

EQUIPE
${eq.ativos} de ${eq.total_barbeiros} barbeiros ativos. Comissões + bônus a pagar: ${brl(eq.folha_total)} (${pct(eq.pct_folha_faturamento)} do faturamento do mês).${
  eq.top_mes && eq.top_mes.length > 0
    ? `\nTop do mês (faturamento real do Trinks): ${eq.top_mes.map(b =>
        `${b.nome} ${brl(b.faturamento)} (${b.atendimentos} atend., ticket ${brl(b.ticket_medio)}, ${pct(b.pct_do_total)} do total)`
      ).join('; ')}.`
    : ''
}

SERVIÇOS
${sv.total_servicos} serviços no catálogo.${
  sv.top_5_real && sv.top_5_real.length > 0
    ? ` Top 5 do mês (Trinks ao vivo): ${sv.top_5_real.map(s =>
        `${s.nome} ${s.quantidade}× (${brl(s.receita)}, ticket ${brl(s.preco_medio)})`
      ).join('; ')}.`
    : ` Mais procurados (cadastro): ${sv.top_5_mes}.`
}

CONTAS A PAGAR (próximos 30 dias)
Total ${brl(cp.total_valor)} em ${cp.total_titulos} títulos. Vencidos ${brl(cp.vencido)}. A vencer ${brl(cp.a_vencer)}.

HISTÓRICO MENSAL (Trinks + CSV importado)
${histTxt}

═══════════════════════════════════════
REGRAS DE RACIOCÍNIO (siga sempre)

1. Hoje é ${p.hoje}. ${p.mes_corrente_parcial ? `O mês corrente (${p.mes_atual_iso}) está em curso.` : ''} NUNCA compare faturamento parcial do mês corrente com fechamento de meses anteriores como se fossem grandezas equivalentes. Se for citar o número do mês corrente, qualifique como "parcial até dia X" ou use a projeção linear.

2. Se um campo aparece zerado e marcado como "sem lançamento ainda" (ex: despesas), trate como ausência de dado — não como evidência. Diga "não há lançamento de X registrado ainda" em vez de extrapolar.

3. Não use percentuais quando o denominador for parcial (ex: "% da folha sobre faturamento" no início do mês dá número absurdo). Cite percentuais só sobre meses fechados ou sobre projeções qualificadas.

4. Não invente correlações ou diagnósticos a partir de ausências. Se você não tem o dado, diga "não tenho esse dado" — em vez de construir narrativa.

5. Use o histórico mensal para tendência. Hoje está disponível ${hist.length} ${hist.length === 1 ? 'mês' : 'meses'} de histórico — seja honesto sobre o limite estatístico de uma série curta.

6. Quando o usuário pedir projeção, baseie em dados reais. Use a projeção linear (${brl(f.projecao_fim_mes)} para o mês corrente) e o crescimento médio dos últimos meses fechados. Marque o intervalo de incerteza.

═══════════════════════════════════════
REGRAS DE FORMATAÇÃO (siga sempre)

- Responda em prosa direta. Frases corridas. Português do Brasil.
- NÃO use cabeçalhos markdown (#, ##, ###).
- NÃO use tabelas markdown com pipes (|).
- NÃO use linhas separadoras (---).
- NÃO use emojis em nenhuma circunstância.
- NÃO use rótulos como "Diagnóstico:", "Resumo:", "Conclusão:". Vá direto.
- NÃO escreva em caixa alta para enfatizar.
- Pode usar uma lista curta (máximo 3 itens, com hífen) APENAS quando forem passos discretos a executar. Em qualquer outro caso, use prosa.
- Negrito só em valores monetários ou nomes próprios quando ajudar legibilidade. Não use negrito como decoração.
- Comece a resposta direto na ideia central. Nada de "Vou ser direto com você".
- Resposta de 4 a 8 parágrafos curtos para perguntas analíticas. Mais curto se a pergunta for objetiva.

CONTEXTO ADICIONAL
Você pode pesquisar na web (SELIC, inflação, benchmarks de barbearia, mercado brasileiro) quando isso fortalecer a análise — não use só por usar.`;
}

export function buildMessages(
  historico: Array<{ role: string; content: string }>,
  mensagemAtual: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const h of (historico || []).slice(-10)) {
    if ((h.role === 'user' || h.role === 'assistant') && h.content) {
      msgs.push({ role: h.role, content: h.content });
    }
  }
  // Evita duplicar a mensagem atual se ela já estiver no fim do histórico
  if (msgs.length > 0 && msgs[msgs.length - 1].role === 'user' && msgs[msgs.length - 1].content === mensagemAtual) {
    msgs.pop();
  }
  msgs.push({ role: 'user', content: mensagemAtual });
  return msgs;
}
