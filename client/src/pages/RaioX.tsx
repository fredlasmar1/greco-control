import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  CalendarDays,
  DollarSign,
  Users,
} from "lucide-react";
import { useTrinksStore, mapTrinksProfissionais, getTrinksMonthTotals } from "@/lib/trinksStore";
import { formatCurrency, barbers as demoBarbers } from "@/lib/demoData";
import { useToast } from "@/hooks/use-toast";

// ─── Constants ────────────────────────────────────────────
const MONTHLY_GOAL = 150_000;

// ─── Date helpers ─────────────────────────────────────────
function formatDatePT(date: Date): string {
  const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${days[date.getDay()]}, ${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

function formatDateShort(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getDayOfMonth(date: Date): number {
  return date.getDate();
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// ─── Initials Avatar ──────────────────────────────────────
function InitialsAvatar({ initials, size = "md" }: { initials: string; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  return (
    <div
      className={`${sizeClass} rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center font-bold text-[#5B8AC4] flex-shrink-0`}
    >
      {initials}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────
function SectionHeader({
  icon,
  title,
  badge,
  isOpen,
  onToggle,
}: {
  icon: string;
  title: string;
  badge?: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <CollapsibleTrigger asChild>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors rounded-t-lg"
        onClick={onToggle}
        data-testid={`section-toggle-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className="text-xl">{icon}</span>
        <span className="text-base font-semibold text-foreground flex-1 text-left">{title}</span>
        {badge !== undefined && (
          <Badge variant="secondary" className="bg-primary/20 text-[#5B8AC4] border-primary/30 text-xs mr-2">
            {badge}
          </Badge>
        )}
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
    </CollapsibleTrigger>
  );
}

// ─── Task Checklist Item ──────────────────────────────────
function ChecklistItem({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(val) => onChange(!!val)}
        className="border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        data-testid={`checkbox-${id}`}
      />
      <label
        htmlFor={id}
        className={`text-sm cursor-pointer transition-colors ${checked ? "line-through text-muted-foreground" : "text-foreground"}`}
      >
        {label}
      </label>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────
interface BarberTask {
  limpeza: boolean;
  reposicao: boolean;
  agenda: boolean;
}

interface AdminTasks {
  aberturaCaixa: boolean;
  verificarAgendamentos: boolean;
  conferirEstoque: boolean;
  pagamentosPendentes: boolean;
  redesSociais: boolean;
  fecharCaixa: boolean;
}

interface BarberData {
  id: string;
  name: string;
  initials: string;
  revenue: number;
}

// ─── Barber Card ──────────────────────────────────────────
function BarberCard({
  barber,
  meta,
  dayOfMonth,
  daysInMonth,
  tasks,
  onTaskChange,
}: {
  barber: BarberData;
  meta: number;
  dayOfMonth: number;
  daysInMonth: number;
  tasks: BarberTask;
  onTaskChange: (field: keyof BarberTask, val: boolean) => void;
}) {
  const pct = meta > 0 ? Math.min(100, (barber.revenue / meta) * 100) : 0;

  // Expected progress: days elapsed / total days
  const expectedPct = (dayOfMonth / daysInMonth) * 100;
  const onTrack = pct >= expectedPct * 0.9; // 90% of expected = "no ritmo"

  // Remaining revenue needed
  const remaining = Math.max(0, meta - barber.revenue);
  const remainingDays = Math.max(1, daysInMonth - dayOfMonth + 1);
  const dailyNeeded = remaining / remainingDays;

  const taskItems: { field: keyof BarberTask; label: string }[] = [
    { field: "limpeza", label: "Limpeza da estação" },
    { field: "reposicao", label: "Reposição de materiais" },
    { field: "agenda", label: "Verificar agenda do dia" },
  ];

  return (
    <Card
      className="bg-card border-border"
      data-testid={`barber-card-${barber.id}`}
    >
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-3">
          <InitialsAvatar initials={barber.initials} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{barber.name}</p>
            <p className="text-xs text-muted-foreground">Barbeiro</p>
          </div>
          <Badge
            className={`text-xs shrink-0 ${
              onTrack
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/15 text-amber-400 border-amber-500/30"
            }`}
            variant="outline"
          >
            {onTrack ? "No ritmo" : "Atenção"}
          </Badge>
        </div>

        {/* Revenue progress */}
        <div className="mb-3">
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-xs text-muted-foreground">Faturamento do mês</span>
            <span className="text-xs font-semibold text-[#5B8AC4]">{pct.toFixed(0)}%</span>
          </div>
          <Progress
            value={pct}
            className="h-1.5 bg-white/10 [&>div]:bg-primary"
          />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-foreground font-medium">{formatCurrency(barber.revenue)}</span>
            <span className="text-xs text-muted-foreground">meta {formatCurrency(meta)}</span>
          </div>
        </div>

        {/* Status message */}
        {!onTrack && remaining > 0 && (
          <div className="flex items-start gap-2 mb-3 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              Precisa faturar <span className="font-semibold">{formatCurrency(dailyNeeded)}/dia</span> para bater a meta
            </p>
          </div>
        )}
        {onTrack && (
          <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <p className="text-xs text-emerald-300">No ritmo para atingir a meta</p>
          </div>
        )}

        {/* Daily tasks */}
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Tarefas do dia</p>
          <div className="space-y-0.5">
            {taskItems.map((t) => (
              <ChecklistItem
                key={t.field}
                id={`${barber.id}-${t.field}`}
                label={t.label}
                checked={tasks[t.field]}
                onChange={(val) => onTaskChange(t.field, val)}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────
export default function RaioX() {
  const today = useMemo(() => new Date(), []);
  const dayOfMonth = getDayOfMonth(today);
  const daysInMonth = getDaysInMonth(today);

  const { toast } = useToast();

  // Trinks data
  const trinks = useTrinksStore((s) => s.trinks);
  const rateLimited = useTrinksStore((s) => s.rateLimited);

  // Resolve barbers
  const barbers: BarberData[] = useMemo(() => {
    if (trinks && !rateLimited) {
      const mapped = mapTrinksProfissionais(trinks);
      if (mapped.length > 0) {
        return mapped.filter((b) => b.active).map((b) => ({
          id: b.id,
          name: b.name,
          initials: b.initials,
          revenue: b.revenue,
        }));
      }
    }
    // Demo fallback
    return demoBarbers.map((b) => ({
      id: b.id,
      name: b.name,
      initials: b.initials,
      revenue: b.revenue,
    }));
  }, [trinks, rateLimited]);

  const usingDemoData = !trinks || rateLimited || barbers.every((b) => b.revenue === 0 && trinks === null);

  // Meta per barber
  const metaPerBarber = barbers.length > 0 ? MONTHLY_GOAL / barbers.length : MONTHLY_GOAL / 8;

  // Total revenue
  const totalRevenue = useMemo(() => {
    if (trinks && !rateLimited) {
      const totals = getTrinksMonthTotals(trinks);
      if (totals.totalRevenue > 0) return totals.totalRevenue;
    }
    return demoBarbers.reduce((sum, b) => sum + b.revenue, 0);
  }, [trinks, rateLimited]);

  // Today's appointments (from Trinks or demo estimate)
  const todayAppointments = useMemo(() => {
    if (trinks && !rateLimited) {
      const totals = getTrinksMonthTotals(trinks);
      return totals.todayClients;
    }
    return Math.floor(barbers.length * 6.5);
  }, [trinks, rateLimited, barbers.length]);

  // Projected revenue
  const projectedRevenue = useMemo(() => {
    if (dayOfMonth === 0) return totalRevenue;
    return (totalRevenue / dayOfMonth) * daysInMonth;
  }, [totalRevenue, dayOfMonth, daysInMonth]);

  // Barbers behind (< 60% of expected progress)
  const expectedPct = (dayOfMonth / daysInMonth) * 100;
  const barbersBehind = barbers.filter((b) => {
    const pct = (b.revenue / metaPerBarber) * 100;
    return pct < expectedPct * 0.6;
  });

  // Section open states
  const [barbersOpen, setBarbersOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);
  const [socioOpen, setSocioOpen] = useState(true);
  const [briefingOpen, setBriefingOpen] = useState(true);

  // Barber tasks state: { barberId: BarberTask }
  const [barberTasks, setBarberTasks] = useState<Record<string, BarberTask>>(() => {
    const init: Record<string, BarberTask> = {};
    demoBarbers.forEach((b) => {
      init[b.id] = { limpeza: false, reposicao: false, agenda: false };
    });
    return init;
  });

  function getBarberTask(id: string): BarberTask {
    return barberTasks[id] || { limpeza: false, reposicao: false, agenda: false };
  }

  function setBarberTask(id: string, field: keyof BarberTask, val: boolean) {
    setBarberTasks((prev) => ({
      ...prev,
      [id]: { ...getBarberTask(id), [field]: val },
    }));
  }

  // Admin tasks
  const [adminTasks, setAdminTasks] = useState<AdminTasks>({
    aberturaCaixa: false,
    verificarAgendamentos: false,
    conferirEstoque: false,
    pagamentosPendentes: false,
    redesSociais: false,
    fecharCaixa: false,
  });

  function toggleAdmin(field: keyof AdminTasks) {
    setAdminTasks((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  // Sócio notes
  const [socioNotes, setSocioNotes] = useState("");

  // Copied state
  const [copied, setCopied] = useState(false);

  // ─── Build briefing text ───────────────────────────────
  const briefingText = useMemo(() => {
    const dateShort = formatDateShort(today);
    const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const dayName = dayNames[today.getDay()];

    const barberLines = barbers
      .map((b) => {
        const pct = metaPerBarber > 0 ? (b.revenue / metaPerBarber) * 100 : 0;
        const bExpectedPct = (dayOfMonth / daysInMonth) * 100;
        const onTrack = pct >= bExpectedPct * 0.9;
        const icon = onTrack ? "✅" : "⚠️";
        const status = onTrack ? "No ritmo" : "Atenção";
        return `${icon} ${b.name.split(" ")[0]} — ${formatCurrency(b.revenue)} (${pct.toFixed(0)}% da meta) — ${status}`;
      })
      .join("\n");

    const adminLines = [
      adminTasks.aberturaCaixa ? "✅" : "□",
      " Abertura do caixa\n",
      adminTasks.verificarAgendamentos ? "✅" : "□",
      " Verificar agendamentos\n",
      adminTasks.conferirEstoque ? "✅" : "□",
      " Conferir estoque\n",
      adminTasks.pagamentosPendentes ? "✅" : "□",
      " Pagamentos pendentes\n",
      adminTasks.redesSociais ? "✅" : "□",
      " Atualizar redes sociais",
    ].join("");

    const goalPct = MONTHLY_GOAL > 0 ? (totalRevenue / MONTHLY_GOAL) * 100 : 0;
    const alertLine =
      barbersBehind.length > 0
        ? `⚠️ Alerta: ${barbersBehind.length} barbeiro${barbersBehind.length > 1 ? "s" : ""} abaixo de 60% da meta esperada`
        : "✅ Todos os barbeiros no ritmo";

    return `📊 RAIO-X DIÁRIO — Greco Barbearia
📅 ${dayName}, ${dateShort}

👊 BARBEIROS & ASSISTENTES
${barberLines}

📋 ADMINISTRATIVO
${adminLines}

👔 SÓCIO
Meta: ${formatCurrency(totalRevenue)} / ${formatCurrency(MONTHLY_GOAL)} (${goalPct.toFixed(1)}%)
Projeção: ${formatCurrency(projectedRevenue)}
${alertLine}${socioNotes ? `\n\n📝 Observações:\n${socioNotes}` : ""}`;
  }, [barbers, metaPerBarber, dayOfMonth, daysInMonth, today, adminTasks, totalRevenue, projectedRevenue, barbersBehind, socioNotes]);

  async function copyBriefing() {
    try {
      await navigator.clipboard.writeText(briefingText);
      setCopied(true);
      toast({ title: "Briefing copiado!", description: "Texto copiado para o clipboard." });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: "Erro ao copiar", description: "Use Ctrl+A e Ctrl+C na caixa de texto.", variant: "destructive" });
    }
  }

  const totalGoalPct = MONTHLY_GOAL > 0 ? (totalRevenue / MONTHLY_GOAL) * 100 : 0;

  // Admin task list definition
  const adminTaskDefs: { field: keyof AdminTasks; label: string }[] = [
    { field: "aberturaCaixa", label: "Abertura do caixa" },
    { field: "verificarAgendamentos", label: "Verificar agendamentos do dia" },
    { field: "conferirEstoque", label: "Conferir estoque de produtos" },
    { field: "pagamentosPendentes", label: "Verificar pagamentos pendentes" },
    { field: "redesSociais", label: "Atualizar redes sociais" },
    { field: "fecharCaixa", label: "Fechar caixa ao final do dia" },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6" data-testid="raio-x-page">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Raio-X Diário</h1>
            {usingDemoData && (
              <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/40 bg-amber-500/10">
                Demo
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{formatDatePT(today)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Briefing matinal da equipe</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-primary/40 text-[#5B8AC4] hover:bg-primary/10 hover:border-primary shrink-0"
          onClick={copyBriefing}
          data-testid="btn-gerar-relatorio"
        >
          {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
          {copied ? "Copiado!" : "Copiar Briefing"}
        </Button>
      </div>

      {/* ── Section 1: Barbeiros & Assistentes ── */}
      <Collapsible open={barbersOpen}>
        <Card className="bg-card border-border overflow-hidden">
          <SectionHeader
            icon="👊"
            title="Barbeiros & Assistentes"
            badge={barbers.length}
            isOpen={barbersOpen}
            onToggle={() => setBarbersOpen((v) => !v)}
          />
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-1">
                {barbers.map((barber) => (
                  <BarberCard
                    key={barber.id}
                    barber={barber}
                    meta={metaPerBarber}
                    dayOfMonth={dayOfMonth}
                    daysInMonth={daysInMonth}
                    tasks={getBarberTask(barber.id)}
                    onTaskChange={(field, val) => setBarberTask(barber.id, field, val)}
                  />
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ── Section 2: Administrativo ── */}
      <Collapsible open={adminOpen}>
        <Card className="bg-card border-border overflow-hidden">
          <SectionHeader
            icon="📋"
            title="Administrativo"
            isOpen={adminOpen}
            onToggle={() => setAdminOpen((v) => !v)}
          />
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <Card className="bg-background/50 border-border mt-1">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-3 font-medium">Checklist diário</p>
                  <div className="space-y-1">
                    {adminTaskDefs.map((t) => (
                      <ChecklistItem
                        key={t.field}
                        id={`admin-${t.field}`}
                        label={t.label}
                        checked={adminTasks[t.field]}
                        onChange={() => toggleAdmin(t.field)}
                      />
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Progresso</span>
                      <span className="font-medium text-[#5B8AC4]">
                        {Object.values(adminTasks).filter(Boolean).length} / {adminTaskDefs.length} concluídas
                      </span>
                    </div>
                    <Progress
                      value={(Object.values(adminTasks).filter(Boolean).length / adminTaskDefs.length) * 100}
                      className="h-1.5 mt-1.5 bg-white/10 [&>div]:bg-primary"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ── Section 3: Sócio ── */}
      <Collapsible open={socioOpen}>
        <Card className="bg-card border-border overflow-hidden">
          <SectionHeader
            icon="👔"
            title="Sócio (Fred)"
            isOpen={socioOpen}
            onToggle={() => setSocioOpen((v) => !v)}
          />
          <CollapsibleContent>
            <div className="px-4 pb-4 space-y-3 mt-1">
              {/* Meta mensal */}
              <Card className="bg-background/50 border-border">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Target className="w-3.5 h-3.5" /> Meta Mensal
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-2xl font-bold text-foreground">{formatCurrency(totalRevenue)}</span>
                    <span className="text-sm text-muted-foreground">/ {formatCurrency(MONTHLY_GOAL)}</span>
                  </div>
                  <Progress
                    value={Math.min(100, totalGoalPct)}
                    className="h-2 mb-2 bg-white/10 [&>div]:bg-primary"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{totalGoalPct.toFixed(1)}% atingido</span>
                    <span>Projeção: {formatCurrency(projectedRevenue)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Indicadores do dia */}
              <div className="grid grid-cols-2 gap-3">
                <Card className="bg-background/50 border-border">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CalendarDays className="w-4 h-4 text-primary" />
                      <span className="text-xs text-muted-foreground font-medium">Agendados hoje</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground" data-testid="today-appointments">
                      {todayAppointments}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">atendimentos</p>
                  </CardContent>
                </Card>
                <Card className="bg-background/50 border-border">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-primary" />
                      <span className="text-xs text-muted-foreground font-medium">Estimativa hoje</span>
                    </div>
                    <p className="text-lg font-bold text-foreground" data-testid="today-revenue-estimate">
                      {formatCurrency(totalRevenue > 0 ? totalRevenue / dayOfMonth : 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">média diária</p>
                  </CardContent>
                </Card>
              </div>

              {/* Alertas */}
              <Card className="bg-background/50 border-border">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5" /> Alertas
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {barbersBehind.length === 0 ? (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                      <p className="text-sm text-emerald-300">Todos os barbeiros no ritmo esperado 👏</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20 mb-2">
                        <TrendingDown className="w-4 h-4 text-red-400" />
                        <p className="text-sm text-red-300 font-medium">
                          {barbersBehind.length} barbeiro{barbersBehind.length > 1 ? "s" : ""} abaixo de 60% da meta esperada
                        </p>
                      </div>
                      {barbersBehind.map((b) => {
                        const pct = metaPerBarber > 0 ? (b.revenue / metaPerBarber) * 100 : 0;
                        return (
                          <div
                            key={b.id}
                            className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-white/5"
                            data-testid={`alert-barber-${b.id}`}
                          >
                            <span className="text-foreground font-medium">{b.name.split(" ")[0]}</span>
                            <span className="text-red-400 font-semibold">{pct.toFixed(0)}% da meta</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Decisões pendentes */}
              <Card className="bg-background/50 border-border">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Users className="w-3.5 h-3.5" /> Decisões Pendentes / Observações
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <Textarea
                    placeholder="Anote decisões, observações ou lembretes para o dia..."
                    value={socioNotes}
                    onChange={(e) => setSocioNotes(e.target.value)}
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground resize-none text-sm min-h-[80px]"
                    data-testid="socio-notes"
                  />
                </CardContent>
              </Card>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ── Briefing Text ── */}
      <Collapsible open={briefingOpen}>
        <Card className="bg-card border-border overflow-hidden">
          <SectionHeader
            icon="📤"
            title="Texto do Briefing"
            isOpen={briefingOpen}
            onToggle={() => setBriefingOpen((v) => !v)}
          />
          <CollapsibleContent>
            <div className="px-4 pb-4 mt-1">
              <div className="relative">
                <pre className="bg-background/60 border border-border rounded-lg p-4 text-xs text-foreground font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">
                  {briefingText}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2 border-primary/40 text-[#5B8AC4] hover:bg-primary/10 hover:border-primary text-xs"
                  onClick={copyBriefing}
                  data-testid="btn-copiar-briefing"
                >
                  {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                  {copied ? "Copiado!" : "Copiar"}
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
