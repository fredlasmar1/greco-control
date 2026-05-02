import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatCurrency, getRevenueByDayOfWeek } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, ArrowDown, Users, DollarSign, TrendingUp, Minus, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { MonthSelector } from "@/components/MonthSelector";
import { useTrinksMonth } from "@/hooks/useTrinksMonth";
import { mesAtualSP } from "@/lib/mesUtils";

export default function Fechamento() {
  const { weeklySummaries: demoSummaries } = useStore();

  // Mês selecionado (persiste em localStorage; default = mês corrente)
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("fechamento.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("fechamento.selectedMes", selectedMes); } catch {}
  }, [selectedMes]);

  const {
    trinks, hasTrinksData, loading, error,
    fonte, trinksAt, csvAt, isMesCorrente,
  } = useTrinksMonth(selectedMes);

  // Derive weekly summaries from Trinks data when available
  const weeklySummaries = useMemo(() => {
    if (!hasTrinksData || !trinks) return isMesCorrente ? demoSummaries : [];

    const transacoes = trinks.transacoes || [];
    const agendamentos = trinks.agendamentos || [];

    // Group by week (ISO week starting Monday)
    const weekMap: Record<string, { revenue: number; clients: number; startDate: string; endDate: string }> = {};

    const getDate = (item: any): string => {
      const raw = item.dataHoraInicio || item.dataHora || item.dataReferencia || item.data || item.date || "";
      return typeof raw === "string" ? raw.split("T")[0] : "";
    };

    const getWeekKey = (dateStr: string) => {
      const d = new Date(dateStr + "T12:00:00");
      const day = d.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + mondayOffset);
      return monday.toISOString().split("T")[0];
    };

    transacoes.forEach((t: any) => {
      const date = getDate(t);
      if (!date) return;
      const weekKey = getWeekKey(date);
      if (!weekMap[weekKey]) weekMap[weekKey] = { revenue: 0, clients: 0, startDate: weekKey, endDate: date };
      weekMap[weekKey].revenue += Number(t.totalPagar || t.valor || 0);
      if (date > weekMap[weekKey].endDate) weekMap[weekKey].endDate = date;
    });

    agendamentos.forEach((a: any) => {
      const date = getDate(a);
      if (!date) return;
      const weekKey = getWeekKey(date);
      if (!weekMap[weekKey]) weekMap[weekKey] = { revenue: 0, clients: 0, startDate: weekKey, endDate: date };
      const st = (typeof a.status === 'string' ? a.status : a.status?.descricao || '').toLowerCase();
      if (st === "finalizado" || st === "realizado" || st === "concluido" || st === "concluído" || st === "confirmado" || st === "ematendimento") {
        weekMap[weekKey].clients += 1;
      }
      if (date > weekMap[weekKey].endDate) weekMap[weekKey].endDate = date;
    });

    return Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, data], i) => {
        const startLabel = new Date(data.startDate + "T12:00:00").toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const endLabel = new Date(data.endDate + "T12:00:00").toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        return {
          id: `week-${i + 1}`,
          weekLabel: `${startLabel} a ${endLabel}`,
          revenue: data.revenue,
          expenses: 0,
          profit: data.revenue,
          clients: data.clients,
          notes: '',
        };
      });
  }, [hasTrinksData, trinks, demoSummaries, isMesCorrente]);

  // Day of week data from Trinks
  const dayOfWeekData = useMemo(() => {
    if (!hasTrinksData || !trinks) return isMesCorrente ? getRevenueByDayOfWeek() : [];

    const transacoes = trinks.transacoes || [];
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];

    transacoes.forEach((t: any) => {
      const raw = t.dataHoraInicio || t.dataHora || t.dataReferencia || t.data || t.date || "";
      const dateStr = typeof raw === "string" ? raw.split("T")[0] : "";
      if (!dateStr) return;
      const dayIndex = new Date(dateStr + "T12:00:00").getDay();
      dayTotals[dayIndex] += Number(t.totalPagar || t.valor || 0);
    });

    return dayNames.map((name, i) => ({ name, total: dayTotals[i] }));
  }, [hasTrinksData, trinks, isMesCorrente]);

  const [notes, setNotes] = useState(weeklySummaries[weeklySummaries.length - 1]?.notes || '');

  // Current week vs previous week
  const currentWeek = weeklySummaries[weeklySummaries.length - 1];
  const previousWeek = weeklySummaries.length >= 2 ? weeklySummaries[weeklySummaries.length - 2] : null;

  // Variacao segura (divisao por zero quando semana anterior tem 0)
  const safePercent = (atual: number, anterior: number): number => {
    if (!anterior || anterior === 0) {
      if (!atual) return 0;
      return atual > 0 ? 100 : -100;
    }
    return ((atual - anterior) / anterior) * 100;
  };
  const revenueChange = previousWeek && currentWeek
    ? safePercent(currentWeek.revenue, previousWeek.revenue)
    : 0;
  const clientsChange = previousWeek && currentWeek
    ? safePercent(currentWeek.clients, previousWeek.clients)
    : 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Fechamento</h2>
          <p className="text-sm text-muted-foreground">Resumo e comparativo semanal do mês selecionado</p>
        </div>
        <MonthSelector
          selectedMes={selectedMes}
          onChange={setSelectedMes}
          mesCorrente={mesCorrente}
          isMesCorrente={isMesCorrente}
          loading={loading}
          error={error}
          fonte={fonte}
          trinksAt={trinksAt}
          csvAt={csvAt}
        />
      </div>

      {loading && !hasTrinksData && (
        <Card className="bg-card border-card-border">
          <CardContent className="p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Carregando fechamento de {selectedMes}...</span>
          </CardContent>
        </Card>
      )}

      {!loading && !hasTrinksData && !isMesCorrente && (
        <Card className="bg-card border-card-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Sem dados disponíveis para {selectedMes}.
            {error && <div className="mt-2 text-red-400">{error}</div>}
          </CardContent>
        </Card>
      )}

      {/* Weekly summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Faturamento</p>
              <DollarSign className="w-4 h-4 text-primary" />
            </div>
            <p className="text-xl font-bold">{formatCurrency(currentWeek?.revenue || 0)}</p>
            {previousWeek && (
              <div className="flex items-center gap-1 mt-1">
                {revenueChange >= 0 ? <ArrowUp className="w-3 h-3 text-green-500" /> : <ArrowDown className="w-3 h-3 text-red-500" />}
                <span className={`text-xs ${revenueChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}% vs semana anterior
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Despesas</p>
              <Minus className="w-4 h-4 text-red-400" />
            </div>
            <p className="text-xl font-bold text-red-400">{formatCurrency(currentWeek?.expenses || 0)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Lucro</p>
              <TrendingUp className="w-4 h-4 text-green-500" />
            </div>
            <p className="text-xl font-bold text-green-500">{formatCurrency(currentWeek?.profit || 0)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Atendimentos</p>
              <Users className="w-4 h-4 text-primary" />
            </div>
            <p className="text-xl font-bold">{currentWeek?.clients || 0}</p>
            {previousWeek && (
              <div className="flex items-center gap-1 mt-1">
                {clientsChange >= 0 ? <ArrowUp className="w-3 h-3 text-green-500" /> : <ArrowDown className="w-3 h-3 text-red-500" />}
                <span className={`text-xs ${clientsChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {clientsChange >= 0 ? '+' : ''}{clientsChange.toFixed(1)}%
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue by day of week */}
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Faturamento por Dia da Semana</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayOfWeekData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="name" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {dayOfWeekData.map((entry, i) => (
                      <Cell key={i} fill={entry.name === 'Sáb' ? '#1E3A5F' : entry.name === 'Dom' ? '#333' : '#152D4A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Observações da Semana</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anote observações importantes sobre a semana..."
              rows={6}
              className="mb-4"
              data-testid="week-notes"
            />
            <div className="text-xs text-muted-foreground">
              Última atualização: {currentWeek?.weekLabel || 'N/A'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weekly history */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Histórico Semanal</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Semana</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Faturamento</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Despesas</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Lucro</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Clientes</th>
                </tr>
              </thead>
              <tbody>
                {weeklySummaries.map(week => (
                  <tr key={week.id} className="border-b border-border/50 hover:bg-muted/30" data-testid={`week-${week.id}`}>
                    <td className="p-3 font-medium">{week.weekLabel}</td>
                    <td className="p-3 text-right text-green-500">{formatCurrency(week.revenue)}</td>
                    <td className="p-3 text-right text-red-400">{formatCurrency(week.expenses)}</td>
                    <td className="p-3 text-right font-medium">{formatCurrency(week.profit)}</td>
                    <td className="p-3 text-right text-muted-foreground">{week.clients}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
