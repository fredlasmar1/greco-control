import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { useTrinksStore } from "@/lib/trinksStore";
import { formatCurrency, formatPercent } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Users,
  TrendingUp,
  Trophy,
  Medal,
  ChevronDown,
  ChevronUp,
  Star,
  DollarSign,
  UserCheck,
  Award,
  Plus,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Link } from "wouter";
import type { Barber } from "@shared/schema";

// ─── Extended barber type for computed fields ────────────
interface ComputedBarber extends Barber {
  apelido?: string;
  paymentBreakdown?: Record<string, number>;
  topServices?: { name: string; count: number }[];
}

// ─── Rank badge component ────────────────────────────────
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-8 h-8 rounded-full bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-yellow-400">1</span>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-8 h-8 rounded-full bg-slate-400/20 border border-slate-400/40 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-slate-300">2</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-700/20 border border-amber-700/40 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-amber-600">3</span>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center flex-shrink-0">
      <span className="text-xs text-muted-foreground">{rank}</span>
    </div>
  );
}

// ─── Add Barber Dialog ───────────────────────────────────
function AddBarberDialog() {
  const { addBarber, barbers } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", commission: "40" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const names = form.name.split(" ");
    const initials =
      names.length >= 2
        ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
        : form.name.slice(0, 2).toUpperCase();
    const barber: Barber = {
      id: String(barbers.length + 1),
      name: form.name,
      initials,
      commission: Number(form.commission),
      revenue: 0,
      clients: 0,
      avgTicket: 0,
      occupationRate: 0,
      active: true,
    };
    addBarber(barber);
    setOpen(false);
    setForm({ name: "", commission: "40" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="bg-[#01696F] hover:bg-[#0C4E54] text-white"
          data-testid="add-barber-btn"
        >
          <Plus className="w-4 h-4 mr-2" />
          Adicionar Barbeiro
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-sm">
        <DialogHeader>
          <DialogTitle>Novo Barbeiro</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs">Nome Completo</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Nome do barbeiro"
              data-testid="input-barber-name"
            />
          </div>
          <div>
            <Label className="text-xs">Comissão (%)</Label>
            <Input
              type="number"
              value={form.commission}
              onChange={(e) =>
                setForm((p) => ({ ...p, commission: e.target.value }))
              }
              data-testid="input-barber-commission"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-[#01696F] hover:bg-[#0C4E54] text-white"
            data-testid="btn-save-barber"
          >
            Salvar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Expandable Details Panel ────────────────────────────
function ExpandedDetails({ barber }: { barber: ComputedBarber }) {
  const hasPayments =
    barber.paymentBreakdown &&
    Object.keys(barber.paymentBreakdown).length > 0;
  const hasServices =
    barber.topServices && barber.topServices.length > 0;

  if (!hasPayments && !hasServices) {
    return (
      <div className="mt-3 pt-3 border-t border-card-border">
        <p className="text-xs text-muted-foreground text-center">
          Detalhes disponíveis somente com dados Trinks
        </p>
      </div>
    );
  }

  const payments = barber.paymentBreakdown || {};
  const paymentTotal = Object.values(payments).reduce((s, v) => s + v, 0);

  return (
    <div className="mt-3 pt-3 border-t border-card-border space-y-4">
      {hasPayments && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            Formas de Pagamento
          </p>
          <div className="space-y-1.5">
            {Object.entries(payments).map(([method, amount]) => {
              const pct = paymentTotal > 0 ? (amount / paymentTotal) * 100 : 0;
              return (
                <div key={method} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24 flex-shrink-0 truncate">
                    {method}
                  </span>
                  <Progress value={pct} className="h-1.5 flex-1" />
                  <span className="text-xs font-medium w-20 text-right flex-shrink-0">
                    {formatCurrency(amount)}
                  </span>
                  <span className="text-[10px] text-muted-foreground w-10 text-right flex-shrink-0">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasServices && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            Top Serviços
          </p>
          <div className="space-y-1">
            {(barber.topServices || []).slice(0, 3).map((svc) => (
              <div
                key={svc.name}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-foreground truncate">{svc.name}</span>
                <Badge
                  variant="secondary"
                  className="ml-2 text-[10px] bg-[#01696F]/15 text-[#01696F] border-0"
                >
                  {svc.count}x
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────
export default function Equipe() {
  const { barbers: demoBarbers } = useStore();
  const { isConnected, trinks } = useTrinksStore();
  const hasTrinksData = isConnected && trinks !== null;

  // Per-barber expansion state (by id)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // ─── Compute barbers from Trinks or demo ──────────────
  const computedBarbers = useMemo((): ComputedBarber[] => {
    if (!hasTrinksData) return demoBarbers as ComputedBarber[];

    const profissionais = trinks!.profissionais || [];
    const transacoes = trinks!.transacoes || [];
    const agendamentos = trinks!.agendamentos || [];

    return profissionais
      .map((prof: any) => {
        const profId = prof.id;

        let revenue = 0;
        let paymentBreakdown: Record<string, number> = {};
        let serviceCount: Record<string, number> = {};

        transacoes.forEach((t: any) => {
          // Trinks transações: profissional is NOT at root level
          // It's in servicos[].idProfissionalQueRealizouServico and produtos[].IdProfissionalQueRealizouAVenda
          const matchingServicos = (t.servicos || []).filter(
            (s: any) => s.idProfissionalQueRealizouServico === profId
          );
          const matchingProdutos = (t.produtos || []).filter(
            (p: any) => p.IdProfissionalQueRealizouAVenda === profId
          );

          if (matchingServicos.length > 0 || matchingProdutos.length > 0) {
            // Revenue from services performed by this professional
            matchingServicos.forEach((s: any) => {
              revenue += Number(s.preco || s.valor || 0);
              const svcName = s.nome || "Serviço";
              serviceCount[svcName] = (serviceCount[svcName] || 0) + 1;
            });

            // Revenue from products sold by this professional
            matchingProdutos.forEach((p: any) => {
              revenue += Number(p.valorUnitario || p.valor || 0) * Number(p.quantidade || 1);
              const prodName = p.nome || "Produto";
              serviceCount[prodName] = (serviceCount[prodName] || 0) + 1;
            });

            // Payment methods
            (t.formasPagamentos || []).forEach((fp: any) => {
              const method = (fp.nome || fp.formaPagamento?.nome || "Outros").toUpperCase();
              const shortMethod = method.includes("PIX")
                ? "Pix"
                : method.includes("CRÉD") || method.includes("CRED")
                ? "Cartão Crédito"
                : method.includes("DÉB") || method.includes("DEB")
                ? "Cartão Débito"
                : method.includes("DINH")
                ? "Dinheiro"
                : fp.nome || "Outros";
              // Proportional split of payment by this prof's share of the transaction
              const totalTx = Number(t.totalPagar || 1);
              const profShare = (matchingServicos.reduce((s: number, sv: any) => s + Number(sv.preco || sv.valor || 0), 0)
                + matchingProdutos.reduce((s: number, p: any) => s + Number(p.valorUnitario || 0) * Number(p.quantidade || 1), 0));
              const ratio = totalTx > 0 ? profShare / totalTx : 0;
              paymentBreakdown[shortMethod] =
                (paymentBreakdown[shortMethod] || 0) +
                Number(fp.valor || 0) * ratio;
            });
          }
        });

        // Count completed agendamentos
        // status is an object { id, nome }, not a string
        const validStatuses = ["finalizado", "confirmado", "ematendimento"];
        const profAgendamentos = agendamentos.filter(
          (a: any) => {
            if (a.profissional?.id !== profId) return false;
            const statusName = (a.status?.nome || a.status || "").toString().toLowerCase().replace(/\s/g, "");
            return validStatuses.includes(statusName);
          }
        );
        const clients = profAgendamentos.length;

        // Top services from agendamentos
        profAgendamentos.forEach((a: any) => {
          // Trinks uses singular "servico" not plural "servicos"
          if (a.servico?.nome) {
            serviceCount[a.servico.nome] = (serviceCount[a.servico.nome] || 0) + 1;
          }
          // Also handle if there's a servicos array
          (a.servicos || []).forEach((s: any) => {
            const name = s.nome || "Serviço";
            serviceCount[name] = (serviceCount[name] || 0) + 1;
          });
        });

        const topServices = Object.entries(serviceCount)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([name, count]) => ({ name, count }));

        const names = (prof.nome || "").split(" ");
        const initials =
          names.length >= 2
            ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
            : (prof.nome || "XX").slice(0, 2).toUpperCase();

        return {
          id: String(profId),
          name: prof.nome || prof.apelido || "Profissional",
          apelido: prof.apelido || names[0] || "",
          initials,
          revenue,
          clients,
          avgTicket: clients > 0 ? revenue / clients : 0,
          commission: 40,
          active: true,
          occupationRate: 0,
          paymentBreakdown,
          topServices,
        } as ComputedBarber;
      })
      .sort((a: ComputedBarber, b: ComputedBarber) => b.revenue - a.revenue);
  }, [hasTrinksData, trinks, demoBarbers]);

  // ─── Summary KPIs ─────────────────────────────────────
  const totalRevenue = computedBarbers.reduce((s, b) => s + b.revenue, 0);
  const totalAtendimentos = computedBarbers.reduce((s, b) => s + b.clients, 0);
  const avgTicket =
    totalAtendimentos > 0 ? totalRevenue / totalAtendimentos : 0;
  const activeProfCount = computedBarbers.filter((b) => b.active).length;

  const topBarber = computedBarbers[0] ?? null;

  // ─── Chart data ───────────────────────────────────────
  const chartData = computedBarbers.map((b) => ({
    name: (b.name || "").split(" ")[0],
    revenue: b.revenue,
  }));

  // ─── Current month label ──────────────────────────────
  const monthLabel = new Date().toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  const monthLabelCapital =
    monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Ranking de Equipe</h2>
          <p className="text-sm text-muted-foreground">
            {activeProfCount} barbeiro{activeProfCount !== 1 ? "s" : ""} ativo
            {activeProfCount !== 1 ? "s" : ""}
            {hasTrinksData && (
              <span className="text-[#01696F] ml-1">• Dados Trinks</span>
            )}
          </p>
        </div>
        <AddBarberDialog />
      </div>

      {/* ── Demo mode warning ── */}
      {!hasTrinksData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <Info className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs">
            Dados de demonstração —{" "}
            <Link href="/configuracoes" className="underline hover:text-amber-400">
              conecte a Trinks nas Configurações
            </Link>
          </p>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-cards">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-[#01696F]/15 flex items-center justify-center">
                <DollarSign className="w-3.5 h-3.5 text-[#01696F]" />
              </div>
              <p className="text-xs text-muted-foreground">Faturamento Total</p>
            </div>
            <p className="text-xl font-bold" data-testid="kpi-total-revenue">
              {formatCurrency(totalRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-[#01696F]/15 flex items-center justify-center">
                <UserCheck className="w-3.5 h-3.5 text-[#01696F]" />
              </div>
              <p className="text-xs text-muted-foreground">Total Atendimentos</p>
            </div>
            <p className="text-xl font-bold" data-testid="kpi-total-atendimentos">
              {totalAtendimentos}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-[#01696F]/15 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-[#01696F]" />
              </div>
              <p className="text-xs text-muted-foreground">Ticket Médio</p>
            </div>
            <p className="text-xl font-bold" data-testid="kpi-avg-ticket">
              {formatCurrency(avgTicket)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-[#01696F]/15 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-[#01696F]" />
              </div>
              <p className="text-xs text-muted-foreground">Profissionais Ativos</p>
            </div>
            <p className="text-xl font-bold" data-testid="kpi-active-profs">
              {activeProfCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Destaque do Mês ── */}
      {topBarber && (
        <Card
          className="bg-gradient-to-r from-[#01696F]/20 to-[#0C4E54]/10 border border-[#01696F]/30"
          data-testid="destaque-card"
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start sm:items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-yellow-500/20 border-2 border-yellow-500/40 flex items-center justify-center flex-shrink-0">
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] sm:text-[11px] font-semibold text-[#01696F] uppercase tracking-widest">
                    Destaque do Mês
                  </p>
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">
                    #1 Ranking
                  </Badge>
                </div>
                <p className="text-sm sm:text-base font-bold mt-0.5">{topBarber.name}</p>
                <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">
                  Parabéns pelo desempenho incrível este mês! Continue assim.
                </p>
                <div className="flex gap-4 mt-2 sm:hidden">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Faturamento</p>
                    <p className="text-sm font-bold text-[#01696F]">
                      {formatCurrency(topBarber.revenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Atendimentos</p>
                    <p className="text-sm font-bold">{topBarber.clients}</p>
                  </div>
                </div>
              </div>
              <div className="hidden sm:flex gap-6 flex-shrink-0">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Faturamento</p>
                  <p className="text-base font-bold text-[#01696F]">
                    {formatCurrency(topBarber.revenue)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Atendimentos</p>
                  <p className="text-base font-bold">{topBarber.clients}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Performance Bar Chart ── */}
      {chartData.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Award className="w-4 h-4 text-[#01696F]" />
              Faturamento por Profissional — {monthLabelCapital}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="horizontal"
                  margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="name" stroke="#666" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#666"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                    }
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), "Faturamento"]}
                    contentStyle={{
                      backgroundColor: "#1a1a1a",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    cursor={{ fill: "rgba(1,105,111,0.08)" }}
                  />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          i === 0
                            ? "#01696F"
                            : i === 1
                            ? "#018a91"
                            : i === 2
                            ? "#0C4E54"
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

      {/* ── Ranking Table (desktop) ── */}
      <div className="hidden md:block">
        <Card className="bg-card border-card-border overflow-hidden">
          <CardHeader className="pb-2 border-b border-card-border">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Star className="w-4 h-4 text-[#01696F]" />
              Ranking de Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full" data-testid="ranking-table">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="text-left text-[10px] text-muted-foreground font-medium px-4 py-3 w-10">
                    #
                  </th>
                  <th className="text-left text-[10px] text-muted-foreground font-medium px-4 py-3">
                    Profissional
                  </th>
                  <th className="text-right text-[10px] text-muted-foreground font-medium px-4 py-3">
                    Faturamento
                  </th>
                  <th className="text-right text-[10px] text-muted-foreground font-medium px-4 py-3">
                    Atendimentos
                  </th>
                  <th className="text-right text-[10px] text-muted-foreground font-medium px-4 py-3">
                    Ticket Médio
                  </th>
                  <th className="text-left text-[10px] text-muted-foreground font-medium px-4 py-3 min-w-[140px]">
                    % do Total
                  </th>
                  <th className="text-right text-[10px] text-muted-foreground font-medium px-4 py-3">
                    Comissão Est.
                  </th>
                  <th className="w-8 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {computedBarbers.map((barber, index) => {
                  const pct =
                    totalRevenue > 0
                      ? (barber.revenue / totalRevenue) * 100
                      : 0;
                  const commission = barber.revenue * 0.4;
                  const isExpanded = !!expanded[barber.id];

                  return (
                    <>
                      <tr
                        key={barber.id}
                        className="border-b border-card-border/50 hover:bg-muted/5 transition-colors cursor-pointer"
                        onClick={() => toggleExpand(barber.id)}
                        data-testid={`ranking-row-${barber.id}`}
                      >
                        <td className="px-4 py-3">
                          <RankBadge rank={index + 1} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-[#01696F]/15 flex items-center justify-center text-[11px] font-bold text-[#01696F] flex-shrink-0">
                              {barber.initials}
                            </div>
                            <span className="text-sm font-medium">
                              {barber.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-semibold">
                            {formatCurrency(barber.revenue)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm">{barber.clients}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm">
                            {formatCurrency(barber.avgTicket)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Progress
                              value={pct}
                              className="h-1.5 flex-1 max-w-[80px]"
                            />
                            <span className="text-xs text-muted-foreground w-10 text-right">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm text-[#01696F] font-medium">
                            {formatCurrency(commission)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr
                          key={`${barber.id}-details`}
                          className="border-b border-card-border/50 bg-muted/5"
                        >
                          <td colSpan={8} className="px-6 pb-4 pt-2">
                            <ExpandedDetails barber={barber} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── Ranking Cards (mobile) ── */}
      <div className="md:hidden space-y-3" data-testid="ranking-cards-mobile">
        {computedBarbers.map((barber, index) => {
          const pct =
            totalRevenue > 0 ? (barber.revenue / totalRevenue) * 100 : 0;
          const commission = barber.revenue * 0.4;
          const isExpanded = !!expanded[barber.id];

          return (
            <Card
              key={barber.id}
              className="bg-card border-card-border"
              data-testid={`barber-card-${barber.id}`}
            >
              <CardContent className="p-4">
                {/* Card header row */}
                <div className="flex items-center gap-3 mb-3">
                  <RankBadge rank={index + 1} />
                  <div className="w-9 h-9 rounded-full bg-[#01696F]/15 flex items-center justify-center text-[11px] font-bold text-[#01696F] flex-shrink-0">
                    {barber.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{barber.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Comissão: {barber.commission}%
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 h-auto"
                    onClick={() => toggleExpand(barber.id)}
                    data-testid={`expand-btn-${barber.id}`}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Faturamento</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency(barber.revenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Atendimentos</p>
                    <p className="text-sm font-medium">{barber.clients}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Ticket Médio</p>
                    <p className="text-sm font-medium">
                      {formatCurrency(barber.avgTicket)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">
                      Comissão Est.
                    </p>
                    <p className="text-sm font-medium text-[#01696F]">
                      {formatCurrency(commission)}
                    </p>
                  </div>
                </div>

                {/* % do total */}
                <div className="mt-2.5 flex items-center gap-2">
                  <Progress value={pct} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-muted-foreground w-12 text-right flex-shrink-0">
                    {pct.toFixed(1)}% do total
                  </span>
                </div>

                {/* Expandable details */}
                {isExpanded && <ExpandedDetails barber={barber} />}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
