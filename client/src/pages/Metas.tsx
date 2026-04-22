import { useMemo, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useTrinksStore, getTrinksMonthTotals, mapTrinksProfissionais } from "@/lib/trinksStore";
import { formatCurrency, formatPercent, getMonthTotals, barbers as demoBarbers } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Target, TrendingUp, Calendar, AlertTriangle, CheckCircle, Users, Pencil, X, RotateCcw, Loader2, CalendarPlus, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface MetaHistorico {
  month: string;
  target: number;
  achieved: number;
}

const API_BASE = (globalThis as any).__API_BASE__ || "";

export default function Metas() {
  const { settings } = useStore();
  const { isConnected, trinks } = useTrinksStore();
  const hasTrinksData = isConnected && trinks !== null;

  const totals = useMemo(
    () => hasTrinksData ? getTrinksMonthTotals(trinks!) : getMonthTotals(),
    [hasTrinksData, trinks]
  );

  const target = settings.monthlyTarget;
  const achieved = totals.totalRevenue;
  const percentage = target > 0 ? (achieved / target) * 100 : 0;
  const remaining = Math.max(0, target - achieved);

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const remainingDays = daysInMonth - dayOfMonth;

  const dailyPace = remainingDays > 0 ? remaining / remainingDays : 0;
  const currentDailyAvg = dayOfMonth > 0 ? achieved / dayOfMonth : 0;
  const projection = currentDailyAvg * daysInMonth;
  const onTrack = projection >= target;

  const monthLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const monthLabelCapital = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  // Circle progress
  const circumference = 2 * Math.PI * 80;
  const strokeDashoffset = circumference - (Math.min(percentage, 100) / 100) * circumference;

  // ─── Historical metas from API ─────────────────────────
  const [historico, setHistorico] = useState<MetaHistorico[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/metas`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setHistorico(data);
      })
      .catch(() => {});
  }, []);

  // Auto-save current month's target + achieved
  useEffect(() => {
    if (target > 0 && achieved >= 0) {
      fetch(`${API_BASE}/api/metas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: currentMonth, target, achieved }),
      }).catch(() => {});
    }
  }, [target, achieved, currentMonth]);

  // Merge historical with current month for display
  const displayHistorico = useMemo(() => {
    const all = [...historico];
    const currentIdx = all.findIndex(m => m.month === currentMonth);
    if (currentIdx >= 0) {
      all[currentIdx] = { month: currentMonth, target, achieved };
    } else {
      all.push({ month: currentMonth, target, achieved });
    }
    return all.sort((a, b) => a.month.localeCompare(b.month));
  }, [historico, currentMonth, target, achieved]);

  // ─── Meta Diária (manual) ───────────────────────────
  const [metaDiaria, setMetaDiaria] = useState<number>(5000);
  const [metaDiariaInput, setMetaDiariaInput] = useState<string>("");
  const [metaDiariaSaving, setMetaDiariaSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/metas/diaria`)
      .then(r => r.json())
      .then(data => {
        if (data && typeof data.valor === "number") {
          setMetaDiaria(data.valor);
          setMetaDiariaInput(String(Math.round(data.valor)));
        }
      })
      .catch(() => {});
  }, []);

  // ─── Custom barber metas from server ────────────────────
  const { toast } = useToast();
  const [customMetas, setCustomMetas] = useState<Record<string, number>>({});
  const [editingBarber, setEditingBarber] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/metas/barbeiros/${currentMonth}`)
      .then(r => r.json())
      .then(data => {
        if (data && typeof data === "object") setCustomMetas(data);
      })
      .catch(() => {});
  }, [currentMonth]);

  function startEdit(barberId: string, currentMeta: number) {
    setEditingBarber(barberId);
    setEditValue(Math.round(currentMeta).toString());
  }

  function cancelEdit() {
    setEditingBarber(null);
    setEditValue("");
  }

  async function saveBarberMeta(barberId: string) {
    const val = Number(editValue);
    if (!val || val <= 0) {
      toast({ title: "Valor inválido", description: "Digite um valor maior que zero.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/metas/barbeiros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: currentMonth, barberId, meta: val }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      if (data.metas) setCustomMetas(data.metas);
      toast({ title: "Meta salva!", description: `Meta atualizada para ${formatCurrency(val)}` });
      setEditingBarber(null);
      setEditValue("");
    } catch (err: any) {
      console.error("[Metas] Erro ao salvar:", err);
      toast({ title: "Erro ao salvar", description: "Não foi possível salvar a meta. Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveMetaDiaria() {
    const val = Number(metaDiariaInput);
    if (!Number.isFinite(val) || val < 0) {
      toast({ title: "Valor inválido", description: "Digite um valor válido.", variant: "destructive" });
      return;
    }
    setMetaDiariaSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/metas/diaria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: val }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      setMetaDiaria(data.valor);
      toast({ title: "Meta diária salva!", description: `Agora: ${formatCurrency(data.valor)}/dia` });
    } catch {
      toast({ title: "Erro", description: "Não foi possível salvar.", variant: "destructive" });
    } finally {
      setMetaDiariaSaving(false);
    }
  }

  async function resetBarberMeta(barberId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/metas/barbeiros`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: currentMonth, barberId }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setCustomMetas(prev => {
        const next = { ...prev };
        delete next[barberId];
        return next;
      });
      toast({ title: "Meta resetada", description: "Voltou para proporcional à comissão." });
    } catch {
      toast({ title: "Erro", description: "Não foi possível resetar a meta.", variant: "destructive" });
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent, barberId: string) {
    if (e.key === "Enter") saveBarberMeta(barberId);
    if (e.key === "Escape") cancelEdit();
  }

  // ─── Barbers with proportional goals ───────────────────
  const barbersData = useMemo(() => {
    let list: { id: string; name: string; initials: string; revenue: number; commission: number }[];
    if (hasTrinksData) {
      const mapped = mapTrinksProfissionais(trinks!);
      list = mapped.filter(b => b.active).map(b => ({
        id: b.id, name: b.name, initials: b.initials,
        revenue: b.revenue, commission: b.commission || 40,
      }));
      if (list.length === 0) list = demoBarbers.map(b => ({
        id: b.id, name: b.name, initials: b.initials || b.name.slice(0, 2).toUpperCase(),
        revenue: b.revenue, commission: b.commission || 40,
      }));
    } else {
      list = demoBarbers.map(b => ({
        id: b.id, name: b.name, initials: b.initials || b.name.slice(0, 2).toUpperCase(),
        revenue: b.revenue, commission: b.commission || 40,
      }));
    }
    const totalComm = list.reduce((s, b) => s + b.commission, 0) || 1;
    return list.map(b => ({
      ...b,
      meta: customMetas[b.id] != null ? customMetas[b.id] : (b.commission / totalComm) * target,
      isCustom: customMetas[b.id] != null,
    }));
  }, [hasTrinksData, trinks, target, customMetas]);

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
            <div className="relative flex-shrink-0">
              <svg width="200" height="200" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="80" fill="none" stroke="#222" strokeWidth="12" />
                <circle
                  cx="100" cy="100" r="80" fill="none"
                  stroke="#1E3A5F" strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                  transform="rotate(-90 100 100)" className="transition-all duration-1000"
                />
                <text x="100" y="90" textAnchor="middle" fill="#e5e5e5" fontSize="28" fontWeight="700" fontFamily="Inter">
                  {percentage.toFixed(1)}%
                </text>
                <text x="100" y="115" textAnchor="middle" fill="#888" fontSize="11" fontFamily="Inter">
                  da meta
                </text>
              </svg>
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Meta de {monthLabelCapital}
                  {hasTrinksData && <span className="text-primary ml-1">• Dados Trinks</span>}
                </p>
                <p className="text-2xl font-bold">{formatCurrency(target)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Realizado</p>
                  <p className="text-lg font-bold text-primary">{formatCurrency(achieved)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Faltam</p>
                  <p className="text-lg font-bold text-orange-400">{formatCurrency(remaining)}</p>
                </div>
              </div>
              <Progress value={percentage} className="h-3 [&>div]:bg-primary" />
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
              <TrendingUp className="w-4 h-4 text-primary" />
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
                : currentDailyAvg > 0
                  ? `Precisa aumentar ${formatPercent(((dailyPace / currentDailyAvg) - 1) * 100)} o ritmo`
                  : 'Sem dados suficientes'
              }
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Meta Diária (manual) */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">Meta Diária</CardTitle>
            <span className="text-xs text-muted-foreground">(usada na previsão do Dashboard)</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px]">
              <p className="text-xs text-muted-foreground mb-1">Valor por dia de funcionamento</p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-[220px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                  <Input
                    type="number"
                    min="0"
                    step="100"
                    value={metaDiariaInput}
                    onChange={(e) => setMetaDiariaInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveMetaDiaria(); }}
                    className="pl-10 h-9"
                    data-testid="input-meta-diaria"
                  />
                </div>
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/80 text-white h-9"
                  onClick={saveMetaDiaria}
                  disabled={metaDiariaSaving}
                  data-testid="btn-save-meta-diaria"
                >
                  {metaDiariaSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 mr-1" /> Salvar
                    </>
                  )}
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              <p>Meta atual: <span className="font-semibold text-foreground">{formatCurrency(metaDiaria)}</span>/dia</p>
              <p className="mt-0.5">Estimativa mensal (22 dias úteis): <span className="font-medium">{formatCurrency(metaDiaria * 22)}</span></p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-barber goals */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">Metas por Barbeiro</CardTitle>
            <span className="text-xs text-muted-foreground">(proporcional à comissão)</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Barbeiro</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Comissão</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Meta</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Realizado</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">%</th>
                  <th className="text-center p-3 text-xs text-muted-foreground font-medium">Status</th>
                  <th className="text-center p-3 text-xs text-muted-foreground font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {barbersData.map(b => {
                  const bPct = b.meta > 0 ? (b.revenue / b.meta) * 100 : 0;
                  const expectedPct = (dayOfMonth / daysInMonth) * 100;
                  const bOnTrack = bPct >= expectedPct * 0.9;
                  const isEditing = editingBarber === b.id;
                  return (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="p-3 font-medium">
                        {b.name.split(" ").slice(0, 2).join(" ")}
                        {b.isCustom && <span className="text-[10px] text-primary ml-1">custom</span>}
                      </td>
                      <td className="p-3 text-right text-muted-foreground">{b.commission}%</td>
                      <td className="p-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">R$</span>
                              <Input
                                type="number"
                                inputMode="numeric"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => handleEditKeyDown(e, b.id)}
                                className="h-9 w-28 text-sm text-right"
                                autoFocus
                              />
                            </div>
                            <div className="flex gap-1">
                              <Button size="sm" className="h-9 px-3 bg-green-600 hover:bg-green-700 text-white text-xs" onClick={() => saveBarberMeta(b.id)} disabled={saving}>
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-9 px-2 text-xs" onClick={cancelEdit}>
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          formatCurrency(b.meta)
                        )}
                      </td>
                      <td className="p-3 text-right font-medium">{formatCurrency(b.revenue)}</td>
                      <td className="p-3 text-right">
                        <span className={bOnTrack ? 'text-green-500' : 'text-orange-400'}>{formatPercent(bPct)}</span>
                      </td>
                      <td className="p-3 text-center">
                        {bOnTrack ? (
                          <CheckCircle className="w-4 h-4 text-green-500 inline" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-orange-400 inline" />
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {!isEditing && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                              onClick={() => startEdit(b.id, b.meta)}
                              title="Editar meta"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {b.isCustom && !isEditing && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-orange-400"
                              onClick={() => resetBarberMeta(b.id)}
                              title="Voltar para proporcional"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Historical */}
      {displayHistorico.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-medium">Histórico de Metas</CardTitle>
            </div>
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
                  {displayHistorico.map(goal => {
                    const pct = goal.target > 0 ? (goal.achieved / goal.target) * 100 : 0;
                    const hit = pct >= 100;
                    const isCurrent = goal.month === currentMonth;
                    const mLabel = new Date(goal.month + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                    return (
                      <tr key={goal.month} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="p-3 font-medium capitalize">
                          {mLabel}
                          {isCurrent && <span className="text-xs text-primary ml-2">• atual</span>}
                        </td>
                        <td className="p-3 text-right">{formatCurrency(goal.target)}</td>
                        <td className="p-3 text-right font-medium">{formatCurrency(goal.achieved)}</td>
                        <td className="p-3 text-right">
                          <span className={hit ? 'text-green-500' : 'text-orange-400'}>{formatPercent(pct)}</span>
                        </td>
                        <td className="p-3 text-center">
                          {hit ? (
                            <CheckCircle className="w-4 h-4 text-green-500 inline" />
                          ) : isCurrent ? (
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
      )}
    </div>
  );
}
