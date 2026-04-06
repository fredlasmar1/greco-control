import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTrinksStore, mapTrinksServicos } from "@/lib/trinksStore";
import { formatCurrency, formatPercent } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Scissors,
  DollarSign,
  TrendingUp,
  Save,
  Info,
  Calculator,
  Percent,
  Package,
  AlertTriangle,
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

interface ServiceCost {
  serviceId: string;
  serviceName: string;
  materialCost: number;
  otherCost: number;
}

export default function Precificacao() {
  const { toast } = useToast();
  const qClient = useQueryClient();
  const { isConnected, trinks } = useTrinksStore();
  const hasTrinksData = isConnected && trinks !== null;

  // Default commission %
  const [commission, setCommission] = useState(40);

  // Fetch saved costs from server
  const { data: savedCosts = [] } = useQuery<ServiceCost[]>({
    queryKey: ["/api/service-costs"],
  });

  // Local edits (serviceId -> { materialCost, otherCost })
  const [edits, setEdits] = useState<Record<string, { materialCost: string; otherCost: string }>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (costs: ServiceCost[]) => {
      const res = await apiRequest("POST", "/api/service-costs", { costs });
      return res.json();
    },
    onSuccess: () => {
      qClient.invalidateQueries({ queryKey: ["/api/service-costs"] });
      toast({ description: "Custos salvos com sucesso." });
      setHasChanges(false);
    },
    onError: (err: any) => {
      toast({ description: err.message || "Erro ao salvar custos.", variant: "destructive" });
    },
  });

  // Build services list from Trinks
  const services = useMemo(() => {
    if (!hasTrinksData) return [];
    const servicos = trinks!.servicos || [];
    const agendamentos = trinks!.agendamentos || [];

    // Count usage per service
    const usageCount: Record<number, number> = {};
    agendamentos.forEach((a: any) => {
      const statusName = (a.status?.nome || "").toLowerCase();
      if (statusName !== "finalizado") return;
      const svcId = a.servico?.id;
      if (svcId) usageCount[svcId] = (usageCount[svcId] || 0) + 1;
    });

    return servicos
      .filter((s: any) => s.preco > 0 && s.visivelParaCliente)
      .map((s: any) => ({
        id: String(s.id),
        name: s.nome || "Serviço",
        price: Number(s.preco || 0),
        duration: Number(s.duracaoEmMinutos || 30),
        category: (s.categoria || "").trim(),
        usage: usageCount[s.id] || 0,
      }))
      .sort((a: any, b: any) => b.usage - a.usage || b.price - a.price);
  }, [hasTrinksData, trinks]);

  // Merge saved costs with local edits
  const getCost = (serviceId: string): { materialCost: number; otherCost: number } => {
    if (edits[serviceId]) {
      return {
        materialCost: Number(edits[serviceId].materialCost) || 0,
        otherCost: Number(edits[serviceId].otherCost) || 0,
      };
    }
    const saved = savedCosts.find(c => c.serviceId === serviceId);
    return {
      materialCost: saved?.materialCost || 0,
      otherCost: saved?.otherCost || 0,
    };
  };

  const updateCost = (serviceId: string, field: "materialCost" | "otherCost", value: string) => {
    const current = edits[serviceId] || {
      materialCost: String(getCost(serviceId).materialCost || ""),
      otherCost: String(getCost(serviceId).otherCost || ""),
    };
    setEdits(prev => ({ ...prev, [serviceId]: { ...current, [field]: value } }));
    setHasChanges(true);
  };

  // Save all costs
  const handleSave = () => {
    const costs: ServiceCost[] = services.map((s: any) => {
      const cost = getCost(s.id);
      return {
        serviceId: s.id,
        serviceName: s.name,
        materialCost: cost.materialCost,
        otherCost: cost.otherCost,
      };
    });
    saveMutation.mutate(costs);
  };

  // Calculate analysis per service
  const analysis = useMemo(() => {
    return services.map((s: any) => {
      const cost = getCost(s.id);
      const totalCost = cost.materialCost + cost.otherCost;
      const commissionValue = s.price * (commission / 100);
      const netProfit = s.price - totalCost - commissionValue;
      const margin = s.price > 0 ? (netProfit / s.price) * 100 : 0;
      const revenueMonth = s.price * s.usage;
      const costMonth = totalCost * s.usage;
      const commissionMonth = commissionValue * s.usage;
      const profitMonth = netProfit * s.usage;

      return {
        ...s,
        totalCost,
        commissionValue,
        netProfit,
        margin,
        revenueMonth,
        costMonth,
        commissionMonth,
        profitMonth,
        healthy: margin >= 30,
        warning: margin >= 15 && margin < 30,
        critical: margin < 15,
      };
    });
  }, [services, edits, savedCosts, commission]);

  // Summary KPIs
  const summary = useMemo(() => {
    const totalRevenue = analysis.reduce((s, a) => s + a.revenueMonth, 0);
    const totalCost = analysis.reduce((s, a) => s + a.costMonth, 0);
    const totalCommission = analysis.reduce((s, a) => s + a.commissionMonth, 0);
    const totalProfit = analysis.reduce((s, a) => s + a.profitMonth, 0);
    const avgMargin = analysis.length > 0
      ? analysis.reduce((s, a) => s + a.margin, 0) / analysis.length
      : 0;
    const criticalCount = analysis.filter(a => a.critical).length;

    return { totalRevenue, totalCost, totalCommission, totalProfit, avgMargin, criticalCount };
  }, [analysis]);

  // Chart data - top services by profit
  const chartData = analysis
    .filter(a => a.usage > 0)
    .sort((a, b) => b.profitMonth - a.profitMonth)
    .slice(0, 10)
    .map(a => ({
      name: a.name.length > 20 ? a.name.slice(0, 18) + "…" : a.name,
      lucro: a.profitMonth,
      custo: a.costMonth,
      comissao: a.commissionMonth,
    }));

  if (!hasTrinksData) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <div>
          <h2 className="text-lg font-semibold">Precificação</h2>
          <p className="text-sm text-muted-foreground">Custos e margens por serviço</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <Info className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs">
            Conecte a Trinks nas{" "}
            <Link href="/configuracoes" className="underline hover:text-amber-400">
              Configurações
            </Link>{" "}
            para ver seus serviços e precificar.
          </p>
        </div>
      </div>
    );
  }

  const monthLabel = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthLabelCapital = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Precificação</h2>
          <p className="text-sm text-muted-foreground">
            Custos, margens e comissões — {monthLabelCapital}
            <span className="text-[#01696F] ml-1">• Dados Trinks</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Percent className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Comissão:</span>
            <Input
              type="number"
              value={commission}
              onChange={e => setCommission(Number(e.target.value) || 0)}
              className="w-16 h-8 text-sm text-center"
              data-testid="commission-input"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
          {hasChanges && (
            <Button
              className="bg-[#01696F] hover:bg-[#0C4E54] text-white"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="save-costs-btn"
            >
              <Save className="w-4 h-4 mr-2" />
              Salvar Custos
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-[#01696F]/15 flex items-center justify-center">
                <DollarSign className="w-3.5 h-3.5 text-[#01696F]" />
              </div>
              <p className="text-xs text-muted-foreground">Faturamento Mês</p>
            </div>
            <p className="text-xl font-bold">{formatCurrency(summary.totalRevenue)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-red-500/15 flex items-center justify-center">
                <Package className="w-3.5 h-3.5 text-red-400" />
              </div>
              <p className="text-xs text-muted-foreground">Custos + Comissão</p>
            </div>
            <p className="text-xl font-bold text-red-400">
              {formatCurrency(summary.totalCost + summary.totalCommission)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-green-500/15 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-green-500" />
              </div>
              <p className="text-xs text-muted-foreground">Lucro Líquido</p>
            </div>
            <p className="text-xl font-bold text-green-500">{formatCurrency(summary.totalProfit)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-orange-500/15 flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
              </div>
              <p className="text-xs text-muted-foreground">Serviços Críticos</p>
            </div>
            <p className="text-xl font-bold text-orange-400">{summary.criticalCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Margem abaixo de 15%</p>
          </CardContent>
        </Card>
      </div>

      {/* Profit Chart */}
      {chartData.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#01696F]" />
              Lucro por Serviço (realizados no mês)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke="#666"
                    fontSize={11}
                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                  />
                  <YAxis dataKey="name" type="category" stroke="#666" fontSize={10} width={140} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      name === "lucro" ? "Lucro" : name === "custo" ? "Custo" : "Comissão",
                    ]}
                    contentStyle={{
                      backgroundColor: "#1a1a1a",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="lucro" stackId="a" fill="#01696F" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="custo" stackId="b" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="comissao" stackId="b" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-[#01696F]" />
                <span>Lucro</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                <span>Custo</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-orange-500" />
                <span>Comissão</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Services Table */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Scissors className="w-4 h-4 text-[#01696F]" />
            Serviços — Preencha o custo de material/produto de cada serviço
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="pricing-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Serviço</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Preço</th>
                  <th className="text-center p-3 text-xs text-muted-foreground font-medium">Custo Material</th>
                  <th className="text-center p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">Outros Custos</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Comissão</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Lucro Líq.</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Margem</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">Qtd. Mês</th>
                </tr>
              </thead>
              <tbody>
                {analysis.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-border/50 hover:bg-muted/30"
                    data-testid={`pricing-row-${item.id}`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Scissors className="w-3.5 h-3.5 text-[#01696F] flex-shrink-0" />
                        <div>
                          <span className="font-medium text-sm">{item.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">{item.duration}min</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-right font-semibold">{formatCurrency(item.price)}</td>
                    <td className="p-3">
                      <div className="flex justify-center">
                        <Input
                          type="number"
                          placeholder="0"
                          value={edits[item.id]?.materialCost ?? (getCost(item.id).materialCost || "")}
                          onChange={e => updateCost(item.id, "materialCost", e.target.value)}
                          className="w-20 h-7 text-xs text-center"
                          data-testid={`cost-material-${item.id}`}
                        />
                      </div>
                    </td>
                    <td className="p-3 hidden sm:table-cell">
                      <div className="flex justify-center">
                        <Input
                          type="number"
                          placeholder="0"
                          value={edits[item.id]?.otherCost ?? (getCost(item.id).otherCost || "")}
                          onChange={e => updateCost(item.id, "otherCost", e.target.value)}
                          className="w-20 h-7 text-xs text-center"
                          data-testid={`cost-other-${item.id}`}
                        />
                      </div>
                    </td>
                    <td className="p-3 text-right text-orange-400">{formatCurrency(item.commissionValue)}</td>
                    <td className={`p-3 text-right font-semibold ${item.netProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatCurrency(item.netProfit)}
                    </td>
                    <td className="p-3 text-right">
                      <Badge
                        className={`text-[10px] border-0 ${
                          item.healthy
                            ? "bg-green-500/15 text-green-500"
                            : item.warning
                              ? "bg-yellow-500/15 text-yellow-500"
                              : "bg-red-500/15 text-red-500"
                        }`}
                      >
                        {formatPercent(item.margin)}
                      </Badge>
                    </td>
                    <td className="p-3 text-right text-muted-foreground hidden sm:table-cell">{item.usage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Info box */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-[#01696F]/10 border border-[#01696F]/20">
        <Info className="w-4 h-4 text-[#01696F] flex-shrink-0 mt-0.5" />
        <div className="text-xs text-[#01696F]">
          <p className="font-medium mb-1">Como funciona:</p>
          <p>Lucro Líquido = Preço − Custo Material − Outros Custos − Comissão ({commission}%)</p>
          <p className="mt-0.5">Preencha o custo de cada serviço e clique em "Salvar Custos". Os valores são usados para calcular a margem real de cada serviço.</p>
        </div>
      </div>
    </div>
  );
}
