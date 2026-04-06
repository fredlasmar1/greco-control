import type { Barber, Service, DailyEntry, WeeklySummary, MonthlyGoal, Settings } from "@shared/schema";

// Currency formatter for Brazilian Real
export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ─── Barbers ─────────────────────────────────────────────
export const barbers: Barber[] = [
  { id: '1', name: 'Lucas Silva', initials: 'LS', commission: 45, revenue: 7200, clients: 98, avgTicket: 73.5, occupationRate: 82, active: true },
  { id: '2', name: 'Rafael Costa', initials: 'RC', commission: 45, revenue: 6800, clients: 92, avgTicket: 73.9, occupationRate: 78, active: true },
  { id: '3', name: 'Pedro Souza', initials: 'PS', commission: 40, revenue: 5900, clients: 84, avgTicket: 70.2, occupationRate: 72, active: true },
  { id: '4', name: 'Guilherme Oliveira', initials: 'GO', commission: 40, revenue: 5400, clients: 78, avgTicket: 69.2, occupationRate: 68, active: true },
  { id: '5', name: 'Anderson Lima', initials: 'AL', commission: 40, revenue: 4800, clients: 72, avgTicket: 66.7, occupationRate: 65, active: true },
  { id: '6', name: 'Bruno Ferreira', initials: 'BF', commission: 40, revenue: 4200, clients: 65, avgTicket: 64.6, occupationRate: 60, active: true },
  { id: '7', name: 'Thiago Santos', initials: 'TS', commission: 35, revenue: 3500, clients: 55, avgTicket: 63.6, occupationRate: 55, active: true },
  { id: '8', name: 'Felipe Rodrigues', initials: 'FR', commission: 35, revenue: 2338, clients: 42, avgTicket: 55.7, occupationRate: 48, active: true },
];

// ─── Services ────────────────────────────────────────────
export const services: Service[] = [
  { id: '1', name: 'Corte', price: 60, avgDuration: 30, cost: 8, margin: 86.7, popularity: 320 },
  { id: '2', name: 'Barba', price: 40, avgDuration: 20, cost: 5, margin: 87.5, popularity: 180 },
  { id: '3', name: 'Combo Corte+Barba', price: 90, avgDuration: 45, cost: 12, margin: 86.7, popularity: 145 },
  { id: '4', name: 'Pigmentação', price: 80, avgDuration: 40, cost: 15, margin: 81.3, popularity: 48 },
  { id: '5', name: 'Hidratação', price: 50, avgDuration: 25, cost: 10, margin: 80.0, popularity: 62 },
  { id: '6', name: 'Corte Infantil', price: 45, avgDuration: 25, cost: 6, margin: 86.7, popularity: 55 },
  { id: '7', name: 'Platinado', price: 150, avgDuration: 90, cost: 35, margin: 76.7, popularity: 22 },
  { id: '8', name: 'Design de Sobrancelha', price: 30, avgDuration: 15, cost: 3, margin: 90.0, popularity: 88 },
];

// ─── Daily revenue data for March 2026 ──────────────────
// Generate ~R$40,138 total through day 18
function generateDailyRevenue(): DailyEntry[] {
  const entries: DailyEntry[] = [];
  const dailyRevenues = [
    { day: 1, rev: 1800, cli: 25 }, // Sunday - lower
    { day: 2, rev: 2400, cli: 34 },
    { day: 3, rev: 2600, cli: 37 },
    { day: 4, rev: 2200, cli: 31 },
    { day: 5, rev: 2500, cli: 36 },
    { day: 6, rev: 2800, cli: 40 },
    { day: 7, rev: 3200, cli: 45 }, // Saturday peak
    { day: 8, rev: 1600, cli: 22 }, // Sunday
    { day: 9, rev: 2300, cli: 33 },
    { day: 10, rev: 2550, cli: 36 },
    { day: 11, rev: 2100, cli: 30 },
    { day: 12, rev: 2650, cli: 38 },
    { day: 13, rev: 2900, cli: 41 },
    { day: 14, rev: 3400, cli: 48 }, // Saturday
    { day: 15, rev: 1500, cli: 21 }, // Sunday
    { day: 16, rev: 2200, cli: 31 },
    { day: 17, rev: 2700, cli: 38 },
    { day: 18, rev: 838, cli: 12 }, // Today partial
  ];

  dailyRevenues.forEach(({ day, rev, cli }) => {
    const pix = Math.round(rev * 0.45);
    const cartao = Math.round(rev * 0.35);
    const dinheiro = rev - pix - cartao;
    entries.push({
      id: `rev-${day}`,
      date: `2026-03-${String(day).padStart(2, '0')}`,
      type: 'receita',
      description: 'Fechamento do dia',
      amount: rev,
      clients: cli,
      pix,
      cartao,
      dinheiro,
    });
  });

  return entries;
}

// ─── Expense entries ─────────────────────────────────────
const expenseEntries: DailyEntry[] = [
  { id: 'exp-1', date: '2026-03-01', type: 'despesa', description: 'Aluguel', amount: 8000, category: 'Aluguel' },
  { id: 'exp-2', date: '2026-03-05', type: 'despesa', description: 'Folha de pagamento', amount: 15000, category: 'Folha' },
  { id: 'exp-3', date: '2026-03-03', type: 'despesa', description: 'Produtos de barbeiro', amount: 2500, category: 'Produtos' },
  { id: 'exp-4', date: '2026-03-10', type: 'despesa', description: 'Conta de energia', amount: 1200, category: 'Energia' },
  { id: 'exp-5', date: '2026-03-10', type: 'despesa', description: 'Conta de água', amount: 400, category: 'Água' },
  { id: 'exp-6', date: '2026-03-01', type: 'despesa', description: 'Internet', amount: 300, category: 'Internet' },
  { id: 'exp-7', date: '2026-03-15', type: 'despesa', description: 'Manutenção equipamentos', amount: 800, category: 'Manutenção' },
];

export const dailyEntries: DailyEntry[] = [...generateDailyRevenue(), ...expenseEntries];

// ─── Computed totals ─────────────────────────────────────
export function getMonthTotals() {
  const revenueEntries = dailyEntries.filter(e => e.type === 'receita');
  const expenseEntriesOnly = dailyEntries.filter(e => e.type === 'despesa');
  
  const totalRevenue = revenueEntries.reduce((sum, e) => sum + e.amount, 0);
  const totalExpenses = expenseEntriesOnly.reduce((sum, e) => sum + e.amount, 0);
  const totalClients = revenueEntries.reduce((sum, e) => sum + (e.clients || 0), 0);
  const totalPix = revenueEntries.reduce((sum, e) => sum + (e.pix || 0), 0);
  const totalCartao = revenueEntries.reduce((sum, e) => sum + (e.cartao || 0), 0);
  const totalDinheiro = revenueEntries.reduce((sum, e) => sum + (e.dinheiro || 0), 0);
  const avgTicket = totalClients > 0 ? totalRevenue / totalClients : 0;
  const daysOpen = revenueEntries.length;
  const occupationRate = 72.5; // average

  return {
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    totalClients,
    avgTicket,
    totalPix,
    totalCartao,
    totalDinheiro,
    daysOpen,
    occupationRate,
  };
}

// Chart data - daily revenue for the month
export function getDailyRevenueChartData() {
  return dailyEntries
    .filter(e => e.type === 'receita')
    .map(e => ({
      date: e.date.slice(8), // just day
      fullDate: e.date,
      revenue: e.amount,
      clients: e.clients || 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Revenue by day of week
export function getRevenueByDayOfWeek() {
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const totals = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  
  dailyEntries.filter(e => e.type === 'receita').forEach(e => {
    const d = new Date(e.date + 'T12:00:00');
    const dow = d.getDay();
    totals[dow] += e.amount;
    counts[dow]++;
  });

  return days.map((name, i) => ({
    name,
    total: totals[i],
    avg: counts[i] > 0 ? Math.round(totals[i] / counts[i]) : 0,
  }));
}

// ─── Weekly summaries ────────────────────────────────────
export const weeklySummaries: WeeklySummary[] = [
  { id: 'w1', weekLabel: 'Semana 1 (01-07/03)', startDate: '2026-03-01', endDate: '2026-03-07', revenue: 17500, expenses: 10800, profit: 6700, clients: 248, notes: 'Primeira semana forte. Sábado foi o melhor dia.' },
  { id: 'w2', weekLabel: 'Semana 2 (08-14/03)', startDate: '2026-03-08', endDate: '2026-03-14', revenue: 17500, expenses: 7400, profit: 10100, clients: 248, notes: 'Manutenção feita nos equipamentos. Fluxo estável.' },
  { id: 'w3', weekLabel: 'Semana 3 (15-18/03)', startDate: '2026-03-15', endDate: '2026-03-18', revenue: 7238, expenses: 0, profit: 7238, clients: 102, notes: 'Semana em andamento.' },
];

// ─── Monthly goals ───────────────────────────────────────
export const monthlyGoals: MonthlyGoal[] = [
  { month: '2025-12', target: 130000, achieved: 138500 },
  { month: '2026-01', target: 140000, achieved: 142300 },
  { month: '2026-02', target: 145000, achieved: 136800 },
  { month: '2026-03', target: 150000, achieved: 40138 },
];

// ─── Settings ────────────────────────────────────────────
export const defaultSettings: Settings = {
  shopName: 'Greco Barbearia',
  address: 'Rua Example, 123 - Centro, Cidade - MG',
  hours: 'Seg-Sex: 09:00-20:00 | Sáb: 08:00-18:00 | Dom: 09:00-14:00',
  trinksApiKey: '',
  trinksEstablishmentId: '',
  perplexityApiKey: '',
  defaultCommission: 40,
  monthlyTarget: 150000,
  chairs: 8,
};

// ─── Expense breakdown by category ───────────────────────
export function getExpenseBreakdown() {
  const categories: Record<string, number> = {};
  dailyEntries
    .filter(e => e.type === 'despesa')
    .forEach(e => {
      const cat = e.category || 'Outros';
      categories[cat] = (categories[cat] || 0) + e.amount;
    });
  
  return Object.entries(categories).map(([name, value]) => ({
    name,
    value,
  }));
}

// ─── Monthly DRE (P&L) data ─────────────────────────────
export function getDREData() {
  return [
    {
      label: 'Janeiro/2026',
      revenue: 142300,
      variableCosts: 64035, // ~45% commissions
      grossMargin: 78265,
      fixedCosts: 28200,
      netProfit: 50065,
    },
    {
      label: 'Fevereiro/2026',
      revenue: 136800,
      variableCosts: 61560,
      grossMargin: 75240,
      fixedCosts: 28200,
      netProfit: 47040,
    },
    {
      label: 'Março/2026 (parcial)',
      revenue: 40138,
      variableCosts: 18062,
      grossMargin: 22076,
      fixedCosts: 28200,
      netProfit: -6124, // negative because partial month but full fixed costs
    },
  ];
}

// Revenue by payment method for charts
export function getPaymentMethodData() {
  const totals = getMonthTotals();
  return [
    { name: 'Pix', value: totals.totalPix, color: '#01696F' },
    { name: 'Cartão', value: totals.totalCartao, color: '#22c55e' },
    { name: 'Dinheiro', value: totals.totalDinheiro, color: '#eab308' },
  ];
}

// Barber ranking for charts
export function getBarberRankingData() {
  return [...barbers]
    .sort((a, b) => b.revenue - a.revenue)
    .map(b => ({
      name: b.name.split(' ')[0],
      revenue: b.revenue,
      clients: b.clients,
    }));
}
