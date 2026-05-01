// ═══════════════════════════════════════════════════════════
//  conselheiro.ts — Helpers do Conselheiro IA (Greco Control)
// ═══════════════════════════════════════════════════════════
//  Constrói o snapshot da empresa a partir do estado em memória
//  e monta o system prompt do consultor estratégico.
// ═══════════════════════════════════════════════════════════

export interface ConselheiroSnapshot {
  periodo: { mes_atual: string; gerado_em: string };
  financeiro: {
    faturamento_mes: number;
    faturamento_anterior: number;
    var_faturamento: number;
    despesas_mes: number;
    despesas_anterior: number;
    var_despesas: number;
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
  servicos: { total_servicos: number; top_5_mes: string };
  equipe: { total_barbeiros: number; ativos: number; folha_total: number; pct_folha_faturamento: number };
  meta_mensal: { target: number; achieved: number; pct: number };
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
  payments: Array<{ mes: string; pago: boolean; valor: number }>;
}

interface MetaHistorico { month: string; target: number; achieved: number }

export interface ConselheiroDataSources {
  entries: DailyEntry[];
  barbers: Barber[];
  services: Service[];
  financeEntries: FinanceEntry[];
  assinaturaClientes: AssinaturaCliente[];
  metasHistorico: MetaHistorico[];
  monthlyTarget?: number;
  shopName?: string;
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

  const faturamento_mes = receitasMes.reduce((s, e) => s + e.amount, 0);
  const faturamento_anterior = receitasMesAnt.reduce((s, e) => s + e.amount, 0);
  const despesas_mes = despesasEntries.reduce((s, e) => s + e.amount, 0) + despesasFinance;
  const despesas_anterior = despesasEntriesAnt.reduce((s, e) => s + e.amount, 0) + despesasFinanceAnt;

  const var_faturamento = faturamento_anterior > 0 ? ((faturamento_mes - faturamento_anterior) / faturamento_anterior) * 100 : 0;
  const var_despesas = despesas_anterior > 0 ? ((despesas_mes - despesas_anterior) / despesas_anterior) * 100 : 0;
  const resultado_liquido = faturamento_mes - despesas_mes;
  const resultado_anterior = faturamento_anterior - despesas_anterior;
  const var_resultado = Math.abs(resultado_anterior) > 0 ? ((resultado_liquido - resultado_anterior) / Math.abs(resultado_anterior)) * 100 : 0;
  const margem_percentual = faturamento_mes > 0 ? (resultado_liquido / faturamento_mes) * 100 : 0;

  // Inadimplência: assinantes com pagamento atrasado
  const assinantes = data.assinaturaClientes || [];
  const inadimplentes = assinantes.filter(c => {
    if (c.status !== 'active') return false;
    const start = new Date(c.contractDate);
    const end = new Date(c.contractEndDate);
    const limite = now < end ? now : end;
    const pagoSet = new Set(c.payments.filter(p => p.pago).map(p => p.mes));
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d <= limite) {
      const m = ym(d);
      if (!pagoSet.has(m)) return true;
      d.setMonth(d.getMonth() + 1);
    }
    return false;
  });
  const inadimplencia = inadimplentes.reduce((s, c) => {
    const planoValor = c.payments[c.payments.length - 1]?.valor || 0;
    return s + planoValor;
  }, 0);

  // Fluxo de caixa por meio de pagamento
  const pix_mes = receitasMes.reduce((s, e) => s + (e.pix || 0), 0);
  const cartao_mes = receitasMes.reduce((s, e) => s + (e.cartao || 0), 0);
  const dinheiro_mes = receitasMes.reduce((s, e) => s + (e.dinheiro || 0), 0);

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

  // Top 5 serviços por popularidade
  const top5 = (data.services || [])
    .slice()
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 5)
    .map(s => s.name)
    .join(', ');

  // Equipe
  const barbeirosAtivos = (data.barbers || []).filter(b => b.active !== false);
  const folhaTotal = barbeirosAtivos.reduce((s, b) => s + ((b.revenue || 0) * ((b.commission || 0) / 100)), 0);
  const pct_folha_faturamento = faturamento_mes > 0 ? (folhaTotal / faturamento_mes) * 100 : 0;

  // Meta do mês
  const metaAtual = (data.metasHistorico || []).find(m => m.month === mesAtual);
  const target = metaAtual?.target || data.monthlyTarget || 0;
  const achieved = metaAtual?.achieved || faturamento_mes;
  const pctMeta = target > 0 ? (achieved / target) * 100 : 0;

  // Histórico mensal (12 últimos meses) a partir das entries
  const historicoMap = new Map<string, { faturamento: number; clientes: number }>();
  for (const e of entries) {
    if (e.type !== 'receita') continue;
    const m = ym(e.date);
    const cur = historicoMap.get(m) || { faturamento: 0, clientes: 0 };
    cur.faturamento += e.amount;
    cur.clientes += e.clients || 0;
    historicoMap.set(m, cur);
  }
  const historico_mensal = Array.from(historicoMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([mes, v]) => ({ mes, faturamento: Math.round(v.faturamento), clientes: v.clientes }));

  return {
    periodo: {
      mes_atual: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      gerado_em: now.toISOString(),
    },
    financeiro: {
      faturamento_mes,
      faturamento_anterior,
      var_faturamento,
      despesas_mes,
      despesas_anterior,
      var_despesas,
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
    },
    equipe: {
      total_barbeiros: (data.barbers || []).length,
      ativos: barbeirosAtivos.length,
      folha_total: folhaTotal,
      pct_folha_faturamento,
    },
    meta_mensal: { target, achieved, pct: pctMeta },
    historico_mensal,
  };
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const pct = (v: number) => `${(v || 0).toFixed(1)}%`;

export function buildSystemPrompt(snap: ConselheiroSnapshot, shopName = 'Greco Barbearia'): string {
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
    ? hist.map(h => `${h.mes}: ${brl(h.faturamento)} (${h.clientes} clientes)`).join(' | ')
    : 'Não disponível';

  return `Você é o CONSELHEIRO do Greco Control — um consultor sênior com mais de 20 anos de experiência em gestão de barbearias e PMEs brasileiras. Você atende ${shopName}.

Você tem acesso em tempo real a todos os dados da operação. Use-os para dar conselhos precisos, embasados e acionáveis. Nunca seja vago. Sempre relacione sua resposta com os números reais da empresa.

═══════════════════════════════════════
DADOS DA EMPRESA — ${snap.periodo.mes_atual}
═══════════════════════════════════════

📊 FINANCEIRO DO MÊS:
• Faturamento: ${brl(f.faturamento_mes)} (${f.var_faturamento >= 0 ? '+' : ''}${pct(f.var_faturamento)} vs mês anterior)
• Despesas:    ${brl(f.despesas_mes)} (${f.var_despesas >= 0 ? '+' : ''}${pct(f.var_despesas)} vs mês anterior)
• Resultado líquido: ${brl(f.resultado_liquido)} | Margem: ${pct(f.margem_percentual)}
• Inadimplência (assinantes em atraso): ${brl(f.inadimplencia)}

🎯 META DO MÊS:
• Alvo: ${brl(meta.target)} | Realizado: ${brl(meta.achieved)} | Atingido: ${pct(meta.pct)}

💰 FLUXO DE CAIXA — MEIOS DE PAGAMENTO:
• Pix:      ${brl(fc.pix_mes)}
• Cartão:   ${brl(fc.cartao_mes)}
• Dinheiro: ${brl(fc.dinheiro_mes)}

📋 CONTAS A PAGAR (próximos 30 dias):
• Total: ${brl(cp.total_valor)} (${cp.total_titulos} contas)
• Vencidas no mês: ${brl(cp.vencido)}
• A vencer: ${brl(cp.a_vencer)}

📋 ASSINATURAS / RECORRÊNCIA:
• Inadimplentes: ${brl(cr.total_valor)} (${cr.total_titulos} clientes)

👥 CLIENTES (assinantes):
• Total: ${cl.total_clientes} | Ativos: ${cl.clientes_ativos}
• Novos nos últimos 30 dias: ${cl.novos_30_dias}
• Em risco de churn (sem pagamento há 90+ dias): ${cl.em_risco_churn}

✂️ SERVIÇOS:
• Catálogo: ${sv.total_servicos} serviços ativos
• Top 5 do mês: ${sv.top_5_mes}

👨‍💼 EQUIPE:
• Barbeiros ativos: ${eq.ativos} de ${eq.total_barbeiros}
• Comissões a pagar: ${brl(eq.folha_total)}
• % da folha sobre faturamento: ${pct(eq.pct_folha_faturamento)}

📈 HISTÓRICO (últimos meses): ${histTxt}

═══════════════════════════════════════
COMO VOCÊ DEVE AGIR:
═══════════════════════════════════════

1. Seja direto e específico — use os números reais acima, não generalize.
2. Dê conselhos acionáveis — diga o que o dono deve FAZER amanhã.
3. Use contexto de mercado quando relevante — busque na web SELIC, inflação, benchmarks de barbearia.
4. Alerte riscos com clareza — se algo estiver preocupante, diga sem rodeios.
5. Reconheça o que vai bem — celebre evidências positivas.
6. Sugira no máximo 3 próximos passos concretos.
7. Linguagem clara e direta, como um conselheiro de confiança.

Você pode pesquisar na web para SELIC atual, inflação, câmbio, benchmarks do setor de barbearia, dados do mercado brasileiro e notícias econômicas relevantes.

Responda sempre em português do Brasil.`;
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
