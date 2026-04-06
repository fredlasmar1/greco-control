import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatCurrency, getRevenueByDayOfWeek } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, ArrowDown, Users, DollarSign, TrendingUp, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function Fechamento() {
  const { weeklySummaries } = useStore();
  const dayOfWeekData = useMemo(() => getRevenueByDayOfWeek(), []);
  const [notes, setNotes] = useState(weeklySummaries[weeklySummaries.length - 1]?.notes || '');

  // Current week vs previous week
  const currentWeek = weeklySummaries[weeklySummaries.length - 1];
  const previousWeek = weeklySummaries.length >= 2 ? weeklySummaries[weeklySummaries.length - 2] : null;

  const revenueChange = previousWeek
    ? ((currentWeek.revenue - previousWeek.revenue) / previousWeek.revenue) * 100
    : 0;
  const clientsChange = previousWeek
    ? ((currentWeek.clients - previousWeek.clients) / previousWeek.clients) * 100
    : 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h2 className="text-lg font-semibold">Fechamento Semanal</h2>
        <p className="text-sm text-muted-foreground">Resumo e comparativo semanal</p>
      </div>

      {/* Weekly summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Faturamento</p>
              <DollarSign className="w-4 h-4 text-[#01696F]" />
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
              <Users className="w-4 h-4 text-[#01696F]" />
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
                      <Cell key={i} fill={entry.name === 'Sáb' ? '#01696F' : entry.name === 'Dom' ? '#333' : '#0C4E54'} />
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
