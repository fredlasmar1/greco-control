import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import {
  useTrinksStore,
  getTrinksMonthTotals,
  getTrindsDailyRevenueChart,
  getTrinksBarberRanking,
  getTrinksPaymentMethodData,
  getTrinksRevenueSummary,
  getTrinksRevenueByRange,
  formatLastSync,
} from "@/lib/trinksStore";
import {
  getMonthTotals,
  getDailyRevenueChartData,
  formatCurrency,
  formatPercent,
  getBarberRankingData,
  getPaymentMethodData,
  getRevenueSummary,
  getRevenueByRange,
} from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TrendingUp,
  Users,
  BarChart3,
  CalendarCheck,
  ArrowUp,
  ArrowDown,
  Info,
  RefreshCw,
  Clock,
  Calendar,
  CalendarDays,
  CalendarRange,
  Filter,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { Link } from "wouter";

interface KPICardProps {
  title: string;
  value: string;
  trend: number;
  icon: React.ReactNode;
  prefix?: string;
}

function KPICard({ title, value, trend, icon }: KPICardProps) {
  const isPositive = trend >= 0;
  return (
    <Card className="bg-card border-card-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {title}
            </p>
            <p
              className="text-xl font-bold mt-1 truncate"
              data-testid={`kpi-${title.toLowerCase().replace(/\s/g, "-")}`}
            >
              {value}
            </p>
            <div className="flex items-center gap-1 mt-1">
              {isPositive ? (
                <ArrowUp className="w-3 h-3 text-green-500" />
              ) : (
                <ArrowDown className="w-3 h-3 text-red-500" />
              )}
              <span
                className={`text-xs font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}
              >
                {isPositive ? "+" : ""}
                {trend}%
              </span>
              <span className="text-xs text-muted-foreground">
                vs mês anterior
              </span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FecharDiaDialog() {
  const { addEntry } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    clients: "",
    revenue: "",
    pix: "",
    cartao: "",
    dinheiro: "",
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(form.revenue) || 0;
    const entry = {
      id: `rev-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "receita" as const,
      description: "Fechamento do dia",
      amount: total,
      clients: Number(form.clients) || 0,
      pix: Number(form.pix) || 0,
      cartao: Number(form.cartao) || 0,
      dinheiro: Number(form.dinheiro) || 0,
      notes: form.notes,
    };
    addEntry(entry);
    setOpen(false);
    setForm({
      clients: "",
      revenue: "",
      pix: "",
      cartao: "",
      dinheiro: "",
      notes: "",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="bg-primary hover:bg-primary/80 text-white"
          data-testid="fechar-dia-btn"
        >
          <CalendarCheck className="w-4 h-4 mr-2" />
          Fechar o Dia
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader>
          <DialogTitle>Fechar o Dia</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Total de Clientes</Label>
              <Input
                type="number"
                value={form.clients}
                onChange={(e) =>
                  setForm((p) => ({ ...p, clients: e.target.value }))
                }
                placeholder="0"
                data-testid="input-clients"
              />
            </div>
            <div>
              <Label className="text-xs">Faturamento Total (R$)</Label>
              <Input
                type="number"
                value={form.revenue}
                onChange={(e) =>
                  setForm((p) => ({ ...p, revenue: e.target.value }))
                }
                placeholder="0,00"
                data-testid="input-revenue"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Pix (R$)</Label>
              <Input
                type="number"
                value={form.pix}
                onChange={(e) =>
                  setForm((p) => ({ ...p, pix: e.target.value }))
                }
                placeholder="0"
                data-testid="input-pix"
              />
            </div>
            <div>
              <Label className="text-xs">Cartão (R$)</Label>
              <Input
                type="number"
                value={form.cartao}
                onChange={(e) =>
                  setForm((p) => ({ ...p, cartao: e.target.value }))
                }
                placeholder="0"
                data-testid="input-cartao"
              />
            </div>
            <div>
              <Label className="text-xs">Dinheiro (R$)</Label>
              <Input
                type="number"
                value={form.dinheiro}
                onChange={(e) =>
                  setForm((p) => ({ ...p, dinheiro: e.target.value }))
                }
                placeholder="0"
                data-testid="input-dinheiro"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={form.notes}
              onChange={(e) =>
                setForm((p) => ({ ...p, notes: e.target.value }))
              }
              placeholder="Notas sobre o dia..."
              rows={2}
              data-testid="input-notes"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/80 text-white"
            data-testid="submit-fechar-dia"
          >
            Salvar Fechamento
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">Dia {label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium" style={{ color: p.color }}>
          {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

function DemoBanner() {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500"
      data-testid="demo-banner"
    >
      <Info className="w-4 h-4 flex-shrink-0" />
      <p className="text-xs">
        Dados de demonstração —{" "}
        <Link
          href="/configuracoes"
          className="underline hover:text-amber-400"
        >
          conecte a Trinks nas Configurações
        </Link>
      </p>
    </div>
  );
}

function SyncBanner({
  lastSync,
  isSyncing,
  onSync,
}: {
  lastSync: string;
  isSyncing: boolean;
  onSync: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20"
      data-testid="sync-banner"
    >
      <Clock className="w-4 h-4 text-primary flex-shrink-0" />
      <p className="text-xs text-primary flex-1">
        Dados Trinks — Última sincronização: {formatLastSync(lastSync)}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-primary hover:bg-primary/10"
        onClick={onSync}
        disabled={isSyncing}
      >
        <RefreshCw
          className={`w-3 h-3 mr-1 ${isSyncing ? "animate-spin" : ""}`}
        />
        <span className="text-[10px]">Atualizar</span>
      </Button>
    </div>
  );
}

export default function Dashboard() {
  const { isConnected, trinks, lastSync, isSyncing, syncData } =
    useTrinksStore();
  const hasTrinksData = isConnected && trinks !== null;

  // Period filter state
  const [periodFilter, setPeriodFilter] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Calculate period date range
  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    const today = new Date();
    const toStr = (d: Date) => d.toISOString().split("T")[0];
    const todayStr = toStr(today);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const dow = today.getDay();
    const mondayOff = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOff);

    const lastSunday = new Date(monday);
    lastSunday.setDate(monday.getDate() - 1);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);

    const formatBR = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

    switch (periodFilter) {
      case "hoje":
        return { periodStart: todayStr, periodEnd: todayStr, periodLabel: `Hoje — ${formatBR(today)}` };
      case "ontem":
        return { periodStart: toStr(yesterday), periodEnd: toStr(yesterday), periodLabel: `Ontem — ${formatBR(yesterday)}` };
      case "semana":
        return { periodStart: toStr(monday), periodEnd: todayStr, periodLabel: `Esta Semana — ${formatBR(monday)} a ${formatBR(today)}` };
      case "sem-passada":
        return { periodStart: toStr(lastMonday), periodEnd: toStr(lastSunday), periodLabel: `Semana Passada — ${formatBR(lastMonday)} a ${formatBR(lastSunday)}` };
      case "mes":
        return { periodStart: toStr(monthStart), periodEnd: todayStr, periodLabel: `Este Mês — ${formatBR(monthStart)} a ${formatBR(today)}` };
      case "mes-passado":
        return { periodStart: toStr(lastMonthStart), periodEnd: toStr(lastMonthEnd), periodLabel: `Mês Passado — ${formatBR(lastMonthStart)} a ${formatBR(lastMonthEnd)}` };
      case "custom":
        if (customStart && customEnd) {
          return { periodStart: customStart, periodEnd: customEnd, periodLabel: `${formatBR(new Date(customStart + "T12:00:00"))} a ${formatBR(new Date(customEnd + "T12:00:00"))}` };
        }
        return { periodStart: "", periodEnd: "", periodLabel: "" };
      default:
        return { periodStart: "", periodEnd: "", periodLabel: "" };
    }
  }, [periodFilter, customStart, customEnd]);

  const periodRevenue = useMemo(() => {
    if (!periodStart || !periodEnd) return 0;
    return hasTrinksData
      ? getTrinksRevenueByRange(trinks!, periodStart, periodEnd)
      : getRevenueByRange(periodStart, periodEnd);
  }, [hasTrinksData, trinks, periodStart, periodEnd]);

  // Calculate data from either Trinks or demo
  const totals = useMemo(
    () => (hasTrinksData ? getTrinksMonthTotals(trinks!) : getMonthTotals()),
    [hasTrinksData, trinks]
  );

  const revenueSummary = useMemo(
    () =>
      hasTrinksData
        ? getTrinksRevenueSummary(trinks!)
        : getRevenueSummary(),
    [hasTrinksData, trinks]
  );

  const chartData = useMemo(
    () =>
      hasTrinksData
        ? getTrindsDailyRevenueChart(trinks!)
        : getDailyRevenueChartData(),
    [hasTrinksData, trinks]
  );

  const barberData = useMemo(
    () =>
      hasTrinksData ? getTrinksBarberRanking(trinks!) : getBarberRankingData(),
    [hasTrinksData, trinks]
  );

  const paymentData = useMemo(
    () =>
      hasTrinksData
        ? getTrinksPaymentMethodData(trinks!)
        : getPaymentMethodData(),
    [hasTrinksData, trinks]
  );

  const target = 150000;
  const progressPercent = (totals.totalRevenue / target) * 100;
  const todayClients = hasTrinksData
    ? totals.todayClients
    : chartData[chartData.length - 1]?.clients || 0;

  const monthLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const monthLabelCapital = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  const handleSync = () => {
    syncData(true);
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Data source banner */}
      {hasTrinksData && lastSync ? (
        <SyncBanner
          lastSync={lastSync}
          isSyncing={isSyncing}
          onSync={handleSync}
        />
      ) : (
        <DemoBanner />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">{monthLabelCapital}</h2>
          <p className="text-sm text-muted-foreground">
            Visão geral da barbearia
          </p>
        </div>
        <FecharDiaDialog />
      </div>

      {/* Revenue Highlight */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-card-border relative overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hoje</span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-foreground" data-testid="revenue-today">
              {formatCurrency(revenueSummary.dayRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border relative overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <CalendarDays className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Esta Semana</span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-foreground" data-testid="revenue-week">
              {formatCurrency(revenueSummary.weekRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border relative overflow-hidden border-primary/30">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
          <CardContent className="p-4 relative">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <CalendarRange className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Este Mês</span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-primary" data-testid="revenue-month">
              {formatCurrency(revenueSummary.monthRevenue)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Period Filter */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Faturamento por Período</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { label: "Hoje", key: "hoje" },
                { label: "Ontem", key: "ontem" },
                { label: "Esta Semana", key: "semana" },
                { label: "Sem. Passada", key: "sem-passada" },
                { label: "Este Mês", key: "mes" },
                { label: "Mês Passado", key: "mes-passado" },
              ].map((p) => (
                <Button
                  key={p.key}
                  variant={periodFilter === p.key ? "default" : "outline"}
                  size="sm"
                  className={
                    periodFilter === p.key
                      ? "bg-primary hover:bg-primary/80 text-white h-7 text-xs"
                      : "h-7 text-xs"
                  }
                  onClick={() => {
                    setPeriodFilter(p.key);
                    setCustomStart("");
                    setCustomEnd("");
                  }}
                >
                  {p.label}
                </Button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={periodFilter === "custom" ? "default" : "outline"}
                    size="sm"
                    className={
                      periodFilter === "custom"
                        ? "bg-primary hover:bg-primary/80 text-white h-7 text-xs"
                        : "h-7 text-xs"
                    }
                  >
                    <CalendarRange className="w-3 h-3 mr-1" />
                    Personalizado
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3 bg-card border-card-border" align="end">
                  <div className="flex items-center gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">De</Label>
                      <Input
                        type="date"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                        className="h-8 text-xs w-36"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Até</Label>
                      <Input
                        type="date"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                        className="h-8 text-xs w-36"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/80 text-white h-8 mt-4"
                      disabled={!customStart || !customEnd}
                      onClick={() => setPeriodFilter("custom")}
                    >
                      Filtrar
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {periodFilter && (
            <div className="mt-3 pt-3 border-t border-card-border flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{periodLabel}</p>
                <p className="text-2xl font-bold text-primary" data-testid="revenue-period">
                  {formatCurrency(periodRevenue)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => {
                  setPeriodFilter("");
                  setCustomStart("");
                  setCustomEnd("");
                }}
              >
                Limpar filtro
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Ticket Médio"
          value={formatCurrency(totals.avgTicket)}
          trend={3.2}
          icon={<BarChart3 className="w-4 h-4 text-primary" />}
        />
        <KPICard
          title="Taxa de Ocupação"
          value={formatPercent(totals.occupationRate)}
          trend={-1.5}
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
        />
        <KPICard
          title="Atendimentos Hoje"
          value={`${todayClients} clientes`}
          trend={12.0}
          icon={<Users className="w-4 h-4 text-primary" />}
        />
      </div>

      {/* Revenue Chart + Goal Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Faturamento Diário — {monthLabelCapital}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" stroke="#666" fontSize={11} />
                  <YAxis
                    stroke="#666"
                    fontSize={11}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#1E3A5F"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#1E3A5F" }}
                    activeDot={{ r: 5, fill: "#5B8AC4" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Goal Progress */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Meta Mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-3">
                <p className="text-2xl font-bold text-primary">
                  {formatPercent(progressPercent)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatCurrency(totals.totalRevenue)} de{" "}
                  {formatCurrency(target)}
                </p>
              </div>
              <Progress
                value={progressPercent}
                className="h-2 [&>div]:bg-primary"
              />
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Faltam {formatCurrency(target - totals.totalRevenue)} para a
                meta
              </p>
            </CardContent>
          </Card>

          {/* Payment Methods */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Formas de Pagamento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {paymentData.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="text-xs">{p.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-medium">
                        {formatCurrency(p.value)}
                      </span>
                      {totals.totalRevenue > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          (
                          {formatPercent(
                            (p.value / totals.totalRevenue) * 100
                          )}
                          )
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom row: Barber ranking */}
      {barberData.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Ranking de Barbeiros — {monthLabelCapital}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barberData}
                  layout="vertical"
                  margin={{ left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#333"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    stroke="#666"
                    fontSize={11}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="#666"
                    fontSize={11}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: "#1a1a1a",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {barberData.map((_, index) => (
                      <Cell
                        key={index}
                        fill={
                          index === 0
                            ? "#1E3A5F"
                            : index < 3
                              ? "#152D4A"
                              : "#1a3a3c"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
