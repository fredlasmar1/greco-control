import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { formatCurrency, formatPercent, monthlyGoals, getMonthTotals } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp, Calendar, AlertTriangle, CheckCircle } from "lucide-react";

export default function Metas() {
  const { settings } = useStore();
  const totals = useMemo(() => getMonthTotals(), []);

  const target = settings.monthlyTarget;
  const achieved = totals.totalRevenue;
  const percentage = (achieved / target) * 100;
  const remaining = target - achieved;
  const daysInMonth = 31;
  const dayOfMonth = 18;
  const remainingDays = daysInMonth - dayOfMonth;

  const dailyPace = remainingDays > 0 ? remaining / remainingDays : 0;
  const currentDailyAvg = achieved / dayOfMonth;
  const projection = currentDailyAvg * daysInMonth;
  const onTrack = projection >= target;

  // Circle progress visualization
  const circumference = 2 * Math.PI * 80;
  const strokeDashoffset = circumference - (Math.min(percentage, 100) / 100) * circumference;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h2 className="text-lg font-semibold">Metas</h2>
        <p className="text-sm text-muted-foreground">Acompanhamento da meta mensal de faturamento</p>
      </div>

      {/* Main goal visualization */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row items-center gap-8">
            {/* Circle progress */}
            <div className="relative flex-shrink-0">
              <svg width="200" height="200" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="80" fill="none" stroke="#222" strokeWidth="12" />
                <circle
                  cx="100"
                  cy="100"
                  r="80"
                  fill="none"
                  stroke="#01696F"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  transform="rotate(-90 100 100)"
                  className="transition-all duration-1000"
                />
                <text x="100" y="90" textAnchor="middle" fill="#e5e5e5" fontSize="28" fontWeight="700" fontFamily="Inter">
                  {percentage.toFixed(1)}%
                </text>
                <text x="100" y="115" textAnchor="middle" fill="#888" fontSize="11" fontFamily="Inter">
                  da meta
                </text>
              </svg>
            </div>

            {/* Goal details */}
            <div className="flex-1 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Meta de Março 2026</p>
                <p className="text-2xl font-bold">{formatCurrency(target)}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Realizado</p>
                  <p className="text-lg font-bold text-[#01696F]">{formatCurrency(achieved)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Faltam</p>
                  <p className="text-lg font-bold text-orange-400">{formatCurrency(remaining)}</p>
                </div>
              </div>

              <Progress value={percentage} className="h-3 [&>div]:bg-[#01696F]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pace indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-orange-400" />
              <p className="text-xs text-muted-foreground font-medium">Ritmo Necessário</p>
            </div>
            <p className="text-xl font-bold">{formatCurrency(dailyPace)}<span className="text-sm font-normal text-muted-foreground">/dia</span></p>
            <p className="text-xs text-muted-foreground mt-1">
              Para atingir a meta nos próximos {remainingDays} dias
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-[#01696F]" />
              <p className="text-xs text-muted-foreground font-medium">Projeção</p>
            </div>
            <p className={`text-xl font-bold ${onTrack ? 'text-green-500' : 'text-orange-400'}`}>
              {formatCurrency(projection)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              No ritmo atual ({formatCurrency(currentDailyAvg)}/dia)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              {onTrack ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-orange-400" />
              )}
              <p className="text-xs text-muted-foreground font-medium">Status</p>
            </div>
            <p className={`text-lg font-bold ${onTrack ? 'text-green-500' : 'text-orange-400'}`}>
              {onTrack ? 'No Caminho' : 'Atenção'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {onTrack
                ? 'Projeção acima da meta!'
                : `Precisa aumentar ${formatPercent(((dailyPace / currentDailyAvg) - 1) * 100)} o ritmo`
              }
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Historical */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Histórico de Metas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Mês</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Meta</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Realizado</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">%</th>
                  <th className="text-center p-3 text-xs text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {monthlyGoals.map(goal => {
                  const pct = (goal.achieved / goal.target) * 100;
                  const hit = pct >= 100;
                  const monthLabel = new Date(goal.month + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                  return (
                    <tr key={goal.month} className="border-b border-border/50 hover:bg-muted/30" data-testid={`goal-${goal.month}`}>
                      <td className="p-3 font-medium capitalize">{monthLabel}</td>
                      <td className="p-3 text-right">{formatCurrency(goal.target)}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(goal.achieved)}</td>
                      <td className="p-3 text-right">
                        <span className={hit ? 'text-green-500' : 'text-orange-400'}>{formatPercent(pct)}</span>
                      </td>
                      <td className="p-3 text-center">
                        {hit ? (
                          <CheckCircle className="w-4 h-4 text-green-500 inline" />
                        ) : goal.month === '2026-03' ? (
                          <span className="text-xs text-muted-foreground">Em andamento</span>
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-orange-400 inline" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
