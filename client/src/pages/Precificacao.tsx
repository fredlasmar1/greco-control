import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTrinksStore } from "@/lib/trinksStore";
import { formatCurrency, formatPercent } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText,
  Copy,
  FlaskConical,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────
interface CostItem {
  id: string;
  name: string;
  category: "produto" | "descartavel" | "quimico" | "energia" | "outro";
  quantity: number;
  unitCost: number;
}

interface ServiceCostData {
  serviceId: string;
  serviceName: string;
  items: CostItem[];
  comissaoPct?: number;        // v24: override por serviço
  margemDesejadaPct?: number;  // v24: override por serviço
}

// v24: Contexto operacional do mês (custo fixo/min)
interface PrecificacaoContexto {
  ok: boolean;
  mes: string;
  operacional: { cadeiras: number; horasDia: number; diasMes: number; ocupacaoPct: number };
  totalFixas: number;
  minutosProdutivosMes: number;
  custoFixoPorMinuto: number;
}

// v24: Helpers de detecção (espelham backend)
function normTxt(s: any): string {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function comissaoPctPadrao(servicoNome: string): number {
  const n = normTxt(servicoNome);
  return /\bvip\b|\bexpress\b/.test(n) ? 50 : 40;
}
function margemDesejadaPadrao(categoria: string, servicoNome: string): number {
  const txt = `${normTxt(categoria)} ${normTxt(servicoNome)}`;
  if (/\bvip\b/.test(txt)) return 40;
  if (/depilac/.test(txt)) return 40;
  if (/quimic|tintur|colorac|descolor|alisa|progressiv|relaxa|matiza/.test(txt)) return 35;
  if (/estetic|limpez|hidrat|sobrancelh|pestan|massag|micropigment/.test(txt)) return 35;
  if (/corte|barba|cabelo|combo|navalh/.test(txt)) return 30;
  return 30;
}

// ─── Preset items common in barbershops ───────────────────
const PRESET_ITEMS: { name: string; category: CostItem["category"]; unitCost: number }[] = [
  { name: "Lâmina descartável", category: "descartavel", unitCost: 1.5 },
  { name: "Lâmina de navalhete", category: "descartavel", unitCost: 0.8 },
  { name: "Papel toalha (folhas)", category: "descartavel", unitCost: 0.1 },
  { name: "Protetor de pescoço", category: "descartavel", unitCost: 0.3 },
  { name: "Luvas descartáveis (par)", category: "descartavel", unitCost: 0.5 },
  { name: "Creme de barbear (dose)", category: "produto", unitCost: 2.0 },
  { name: "Pós-barba (dose)", category: "produto", unitCost: 1.5 },
  { name: "Shampoo (dose)", category: "produto", unitCost: 1.0 },
  { name: "Condicionador (dose)", category: "produto", unitCost: 1.0 },
  { name: "Cera/Pomada (dose)", category: "produto", unitCost: 2.0 },
  { name: "Gel (dose)", category: "produto", unitCost: 0.8 },
  { name: "Óleo para barba (dose)", category: "produto", unitCost: 2.5 },
  { name: "Toalha quente (uso)", category: "produto", unitCost: 0.5 },
  { name: "Descolorante (dose)", category: "quimico", unitCost: 5.0 },
  { name: "Tintura (dose)", category: "quimico", unitCost: 8.0 },
  { name: "Alisante (dose)", category: "quimico", unitCost: 10.0 },
  { name: "Energia/água (por serviço)", category: "energia", unitCost: 2.0 },
];

const CATEGORY_LABELS: Record<string, string> = {
  produto: "Produto",
  descartavel: "Descartável",
  quimico: "Químico",
  energia: "Energia/Água",
  outro: "Outro",
};

const CATEGORY_COLORS: Record<string, string> = {
  produto: "bg-blue-500/15 text-blue-400",
  descartavel: "bg-purple-500/15 text-purple-400",
  quimico: "bg-amber-500/15 text-amber-400",
  energia: "bg-cyan-500/15 text-cyan-400",
  outro: "bg-slate-500/15 text-slate-400",
};

// ─── Cost Detail Dialog ───────────────────────────────────
function CostDetailDialog({
  open,
  onClose,
  service,
  items,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  service: { id: string; name: string; price: number; duration: number; category: string };
  items: CostItem[];
  onSave: (items: CostItem[]) => void;
}) {
  const [localItems, setLocalItems] = useState<CostItem[]>(items);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    setLocalItems(items);
  }, [items, open]);

  const addItem = (preset?: typeof PRESET_ITEMS[0]) => {
    const newItem: CostItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: preset?.name || "",
      category: preset?.category || "produto",
      quantity: 1,
      unitCost: preset?.unitCost || 0,
    };
    setLocalItems(prev => [...prev, newItem]);
    setShowPresets(false);
  };

  const updateItem = (id: string, field: keyof CostItem, value: any) => {
    setLocalItems(prev =>
      prev.map(item => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (id: string) => {
    setLocalItems(prev => prev.filter(item => item.id !== id));
  };

  const totalCost = localItems.reduce((s, item) => s + item.quantity * item.unitCost, 0);
  const commission40 = service.price * 0.4;
  const netProfit = service.price - totalCost - commission40;
  const margin = service.price > 0 ? (netProfit / service.price) * 100 : 0;

  const handleSave = () => {
    onSave(localItems);
    onClose();
  };

  // Group items by category for summary
  const categoryTotals = localItems.reduce((acc, item) => {
    const cat = item.category;
    acc[cat] = (acc[cat] || 0) + item.quantity * item.unitCost;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-card-border max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Ficha Técnica — {service.name}
          </DialogTitle>
        </DialogHeader>

        {/* Service info bar */}
        <div className="flex items-center gap-4 px-3 py-2 rounded-md bg-muted/30 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Preço: </span>
            <span className="font-semibold">{formatCurrency(service.price)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Duração: </span>
            <span className="font-medium">{service.duration}min</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Categoria: </span>
            <span className="font-medium">{service.category}</span>
          </div>
        </div>

        {/* Items list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Itens de Custo
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowPresets(!showPresets)}
              >
                <Package className="w-3 h-3 mr-1" />
                Itens Comuns
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => addItem()}
              >
                <Plus className="w-3 h-3 mr-1" />
                Item Manual
              </Button>
            </div>
          </div>

          {/* Presets dropdown */}
          {showPresets && (
            <Card className="bg-muted/20 border-card-border">
              <CardContent className="p-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {PRESET_ITEMS.map((preset, i) => (
                    <button
                      key={i}
                      className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50 text-left text-xs transition-colors"
                      onClick={() => addItem(preset)}
                    >
                      <span className="flex items-center gap-2">
                        <Badge className={`text-[9px] border-0 px-1.5 ${CATEGORY_COLORS[preset.category]}`}>
                          {CATEGORY_LABELS[preset.category]}
                        </Badge>
                        <span>{preset.name}</span>
                      </span>
                      <span className="text-muted-foreground ml-2">{formatCurrency(preset.unitCost)}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Items table */}
          {localItems.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              Nenhum item adicionado. Use "Itens Comuns" para começar rapidamente.
            </div>
          ) : (
            <div className="space-y-1.5">
              {localItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-muted/10 border border-border/50"
                >
                  <Select
                    value={item.category}
                    onValueChange={v => updateItem(item.id, "category", v)}
                  >
                    <SelectTrigger className="w-[110px] h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={item.name}
                    onChange={e => updateItem(item.id, "name", e.target.value)}
                    placeholder="Nome do item"
                    className="flex-1 h-7 text-xs"
                  />

                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={item.quantity || ""}
                      onChange={e => updateItem(item.id, "quantity", Number(e.target.value) || 0)}
                      className="w-14 h-7 text-xs text-center"
                      placeholder="Qtd"
                    />
                    <span className="text-[10px] text-muted-foreground">x</span>
                    <div className="relative">
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">R$</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.unitCost || ""}
                        onChange={e => updateItem(item.id, "unitCost", Number(e.target.value) || 0)}
                        className="w-20 h-7 text-xs text-right pl-7"
                        placeholder="0,00"
                      />
                    </div>
                  </div>

                  <span className="text-xs font-medium w-16 text-right flex-shrink-0">
                    {formatCurrency(item.quantity * item.unitCost)}
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cost breakdown summary */}
        {localItems.length > 0 && (
          <Card className="bg-muted/10 border-card-border">
            <CardContent className="p-3 space-y-2">
              {/* Category breakdown */}
              {Object.entries(categoryTotals).length > 1 && (
                <div className="flex flex-wrap gap-3 pb-2 border-b border-border/50">
                  {Object.entries(categoryTotals).map(([cat, total]) => (
                    <div key={cat} className="flex items-center gap-1.5">
                      <Badge className={`text-[9px] border-0 px-1.5 ${CATEGORY_COLORS[cat]}`}>
                        {CATEGORY_LABELS[cat]}
                      </Badge>
                      <span className="text-xs font-medium">{formatCurrency(total)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Final calculation */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Preço do serviço</span>
                  <span className="font-semibold">{formatCurrency(service.price)}</span>
                </div>
                <div className="flex justify-between text-red-400">
                  <span>− Custo total ({localItems.length} itens)</span>
                  <span className="font-medium">{formatCurrency(totalCost)}</span>
                </div>
                <div className="flex justify-between text-orange-400">
                  <span>− Comissão (40%)</span>
                  <span className="font-medium">{formatCurrency(commission40)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-border/50">
                  <span className="font-semibold">= Lucro líquido</span>
                  <span className={`font-bold text-base ${netProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatCurrency(netProfit)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margem</span>
                  <Badge
                    className={`text-[10px] border-0 ${
                      margin >= 30
                        ? "bg-green-500/15 text-green-500"
                        : margin >= 15
                          ? "bg-yellow-500/15 text-yellow-500"
                          : "bg-red-500/15 text-red-500"
                    }`}
                  >
                    {formatPercent(margin)}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            className="bg-primary hover:bg-primary/80 text-white"
            onClick={handleSave}
          >
            <Save className="w-4 h-4 mr-2" />
            Salvar Ficha Técnica
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────
export default function Precificacao() {
  const { toast } = useToast();
  const qClient = useQueryClient();
  const { isConnected, trinks } = useTrinksStore();
  const hasTrinksData = isConnected && trinks !== null;

  // Mes corrente YYYY-MM (sempre America/Sao_Paulo via tz do servidor; aqui usamos o mes local)
  const mesAtual = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const [editingService, setEditingService] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // v24 Etapa 5: modo simulação (toggle 'travar custo antes da comissão') — só visualização, não persiste
  const [modoSimulacao, setModoSimulacao] = useState<boolean>(false);

  // Fetch saved costs from server
  const { data: savedCosts = [] } = useQuery<ServiceCostData[]>({
    queryKey: ["/api/service-costs"],
  });

  // v24: Contexto operacional do mês (custo fixo por minuto)
  const { data: contexto } = useQuery<PrecificacaoContexto>({
    queryKey: ["/api/precificacao/contexto", mesAtual],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/precificacao/contexto/${mesAtual}`);
      return r.json();
    },
  });

  // v24: estado local editável dos parâmetros operacionais (no painel topo)
  const [opLocal, setOpLocal] = useState<{ cadeiras: number; horasDia: number; diasMes: number; ocupacaoPct: number } | null>(null);
  useEffect(() => {
    if (contexto?.operacional && !opLocal) {
      setOpLocal({ ...contexto.operacional });
    }
  }, [contexto, opLocal]);

  // v24: Mutation para salvar parâmetros operacionais
  const opMutation = useMutation({
    mutationFn: async (op: { cadeiras: number; horasDia: number; diasMes: number; ocupacaoPct: number }) => {
      const res = await apiRequest("PUT", "/api/config/financeira", op);
      return res.json();
    },
    onSuccess: () => {
      qClient.invalidateQueries({ queryKey: ["/api/precificacao/contexto"] });
      toast({ description: "Parâmetros operacionais atualizados." });
    },
    onError: (err: any) => {
      toast({ description: err.message || "Erro ao salvar parâmetros.", variant: "destructive" });
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (costs: ServiceCostData[]) => {
      const res = await apiRequest("POST", "/api/service-costs", { costs });
      return res.json();
    },
    onSuccess: () => {
      qClient.invalidateQueries({ queryKey: ["/api/service-costs"] });
      toast({ description: "Ficha técnica salva com sucesso." });
    },
    onError: (err: any) => {
      toast({ description: err.message || "Erro ao salvar.", variant: "destructive" });
    },
  });

  // Copy items from another service
  const handleCopyFrom = (targetServiceId: string, sourceServiceId: string) => {
    const source = savedCosts.find(c => c.serviceId === sourceServiceId);
    if (!source || source.items.length === 0) {
      toast({ description: "Serviço de origem não tem itens.", variant: "destructive" });
      return;
    }
    const copiedItems = source.items.map(item => ({
      ...item,
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    }));
    handleSaveItems(targetServiceId, copiedItems);
  };

  // Build services list from Trinks
  const services = useMemo(() => {
    if (!hasTrinksData) return [];
    const servicos = trinks!.servicos || [];
    const agendamentos = trinks!.agendamentos || [];

    const usageCount: Record<number, number> = {};
    agendamentos.forEach((a: any) => {
      if ((a.status?.nome || "").toLowerCase() !== "finalizado") return;
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

  const getItems = (serviceId: string): CostItem[] => {
    return savedCosts.find(c => c.serviceId === serviceId)?.items || [];
  };

  const getTotalCost = (serviceId: string): number => {
    return getItems(serviceId).reduce((s, item) => s + item.quantity * item.unitCost, 0);
  };

  const handleSaveItems = (serviceId: string, items: CostItem[]) => {
    const svc = services.find(s => s.id === serviceId);
    const existing = savedCosts.filter(c => c.serviceId !== serviceId);
    const updated: ServiceCostData[] = [
      ...existing,
      { serviceId, serviceName: svc?.name || "", items },
    ];
    saveMutation.mutate(updated);
  };

  // v24: Análise expandida por serviço (custo fixo rateado + comissão por categoria + preço sugerido)
  const cfm = contexto?.custoFixoPorMinuto || 0;
  const analysis = useMemo(() => {
    return services.map((s: any) => {
      const totalCost = getTotalCost(s.id);                    // ficha técnica
      const sc = savedCosts.find(c => c.serviceId === s.id);
      const itemCount = sc?.items.length || 0;

      // Comissão e margem desejada: override se houver, senão defaults por categoria
      const comissaoPct = sc?.comissaoPct !== undefined
        ? sc.comissaoPct
        : comissaoPctPadrao(s.name);
      const margemDesejadaPct = sc?.margemDesejadaPct !== undefined
        ? sc.margemDesejadaPct
        : margemDesejadaPadrao(s.category, s.name);

      // Fórmulas v24
      const custoFixoRateado = s.duration * cfm;
      // v24 Etapa 5: em modo simulação, comissão = (preço − ficha) × % (trava custo antes da comissão)
      // No modo padrão, comissão = preço × % (sobre o preço cheio)
      const commissionValue = modoSimulacao
        ? Math.max(0, s.price - totalCost) * (comissaoPct / 100)
        : s.price * (comissaoPct / 100);
      const custoTotal = totalCost + custoFixoRateado + commissionValue;
      const netProfit = s.price - custoTotal;
      const margin = s.price > 0 ? (netProfit / s.price) * 100 : 0;

      // Preço sugerido baseado em margem desejada
      const denom = 1 - (comissaoPct / 100) - (margemDesejadaPct / 100);
      const precoSugerido = denom > 0 ? (totalCost + custoFixoRateado) / denom : null;
      const precoSugeridoErro = denom <= 0
        ? `Comissão (${comissaoPct}%) + margem (${margemDesejadaPct}%) ≥ 100%`
        : null;

      return {
        ...s,
        totalCost,
        custoFixoRateado,
        comissaoPct,
        margemDesejadaPct,
        commissionValue,
        custoTotal,
        netProfit,
        margin,
        precoSugerido,
        precoSugeridoErro,
        revenueMonth: s.price * s.usage,
        profitMonth: netProfit * s.usage,
        itemCount,
        healthy: margin >= 30,
        warning: margin >= 15 && margin < 30,
        critical: margin < 15,
      };
    });
  }, [services, savedCosts, cfm, modoSimulacao]);

  // Summary KPIs
  const summary = useMemo(() => {
    const totalRevenue = analysis.reduce((s, a) => s + a.revenueMonth, 0);
    const totalCost = analysis.reduce((s, a) => s + a.totalCost * a.usage, 0);
    const totalCommission = analysis.reduce((s, a) => s + a.commissionValue * a.usage, 0);
    const totalProfit = analysis.reduce((s, a) => s + a.profitMonth, 0);
    const criticalCount = analysis.filter(a => a.critical && a.itemCount > 0).length;
    const withoutCost = analysis.filter(a => a.itemCount === 0).length;

    return { totalRevenue, totalCost, totalCommission, totalProfit, criticalCount, withoutCost };
  }, [analysis]);

  // Chart
  const chartData = analysis
    .filter(a => a.usage > 0 && a.itemCount > 0)
    .sort((a, b) => b.profitMonth - a.profitMonth)
    .slice(0, 10)
    .map(a => ({
      name: a.name.length > 22 ? a.name.slice(0, 20) + "…" : a.name,
      lucro: Math.round(a.profitMonth),
      custo: Math.round(a.totalCost * a.usage),
      comissao: Math.round(a.commissionValue * a.usage),
    }));

  // Editing dialog state
  const editingServiceData = editingService
    ? services.find(s => s.id === editingService)
    : null;

  if (!hasTrinksData) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <div>
          <h2 className="text-lg font-semibold">Precificação</h2>
          <p className="text-sm text-muted-foreground">Ficha técnica e margens por serviço</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <Info className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs">
            Conecte a Trinks nas{" "}
            <Link href="/configuracoes" className="underline hover:text-amber-400">Configurações</Link>{" "}
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
            Ficha técnica, custos e margens — {monthLabelCapital}
            <span className="text-primary ml-1">• Dados Trinks</span>
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Percent className="w-4 h-4" />
            <span>Comissão por categoria: <strong className="text-primary">VIP/Express 50%</strong> • <strong className="text-primary">demais 40%</strong></span>
          </div>
          {/* v24 Etapa 5: toggle modo simulação */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-card/50">
            <FlaskConical className={`w-3.5 h-3.5 ${modoSimulacao ? "text-amber-400" : "text-muted-foreground"}`} />
            <Label htmlFor="toggle-simulacao" className="text-xs cursor-pointer select-none">
              Travar custo antes da comissão
            </Label>
            <Switch
              id="toggle-simulacao"
              checked={modoSimulacao}
              onCheckedChange={setModoSimulacao}
              data-testid="toggle-modo-simulacao"
            />
            {modoSimulacao && (
              <Badge variant="outline" className="text-[10px] h-5 border-amber-400/40 text-amber-400 bg-amber-400/10">
                Simulação
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* v24: Painel Operacional — parâmetros para custo fixo/min */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calculator className="w-4 h-4 text-primary" />
            Parâmetros Operacionais (custo fixo por minuto de cadeira)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">Cadeiras</Label>
              <Input
                type="number" min={1}
                value={opLocal?.cadeiras ?? ""}
                onChange={e => opLocal && setOpLocal({ ...opLocal, cadeiras: Number(e.target.value) || 0 })}
                className="h-8 text-sm"
                data-testid="input-cadeiras"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Horas/dia</Label>
              <Input
                type="number" min={1} max={24}
                value={opLocal?.horasDia ?? ""}
                onChange={e => opLocal && setOpLocal({ ...opLocal, horasDia: Number(e.target.value) || 0 })}
                className="h-8 text-sm"
                data-testid="input-horas"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Dias/mês</Label>
              <Input
                type="number" min={1} max={31}
                value={opLocal?.diasMes ?? ""}
                onChange={e => opLocal && setOpLocal({ ...opLocal, diasMes: Number(e.target.value) || 0 })}
                className="h-8 text-sm"
                data-testid="input-dias"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Ocupação média (%)</Label>
              <Input
                type="number" min={0} max={100}
                value={opLocal?.ocupacaoPct ?? ""}
                onChange={e => opLocal && setOpLocal({ ...opLocal, ocupacaoPct: Number(e.target.value) || 0 })}
                className="h-8 text-sm"
                data-testid="input-ocupacao"
              />
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-border/50">
            <div className="text-xs space-y-0.5">
              <div>
                Despesas fixas do mês: <strong className="text-red-400">{formatCurrency(contexto?.totalFixas || 0)}</strong>
                {(contexto?.totalFixas || 0) === 0 && (
                  <span className="text-muted-foreground ml-1">(cadastre em Financeiro)</span>
                )}
              </div>
              <div>
                Minutos produtivos/mês: <strong>{(contexto?.minutosProdutivosMes || 0).toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                Custo fixo por minuto: <strong className="text-primary">{formatCurrency(contexto?.custoFixoPorMinuto || 0)}/min</strong>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/80 text-white h-8 text-xs"
              disabled={!opLocal || opMutation.isPending}
              onClick={() => opLocal && opMutation.mutate(opLocal)}
              data-testid="button-salvar-operacional"
            >
              <Save className="w-3 h-3 mr-1" />
              Salvar parâmetros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center">
                <DollarSign className="w-3.5 h-3.5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground">Faturamento Mês</p>
            </div>
            <p className="text-xl font-bold">{formatCurrency(summary.totalRevenue)}</p>
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
              <div className="w-7 h-7 rounded-md bg-amber-500/15 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <p className="text-xs text-muted-foreground">Sem Ficha Técnica</p>
            </div>
            <p className="text-xl font-bold text-amber-400">{summary.withoutCost}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">de {services.length} serviços</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-red-500/15 flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              </div>
              <p className="text-xs text-muted-foreground">Margem Crítica</p>
            </div>
            <p className="text-xl font-bold text-red-400">{summary.criticalCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Abaixo de 15%</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              Lucro vs Custo por Serviço (realizados no mês)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                  <XAxis type="number" stroke="#666" fontSize={11}
                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <YAxis dataKey="name" type="category" stroke="#666" fontSize={10} width={150} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      name === "lucro" ? "Lucro" : name === "custo" ? "Custo Material" : "Comissão",
                    ]}
                    contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Bar dataKey="lucro" stackId="a" fill="#1E3A5F" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="custo" stackId="b" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="comissao" stackId="b" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-primary" /><span>Lucro</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-red-500" /><span>Custo</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-orange-500" /><span>Comissão</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Services list */}
      <div className="space-y-2">
        {analysis.map((item) => {
          const items = getItems(item.id);
          const isExpanded = !!expanded[item.id];

          return (
            <Card key={item.id} className="bg-card border-card-border" data-testid={`pricing-card-${item.id}`}>
              <CardContent className="p-0">
                {/* Main row */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/5 transition-colors"
                  onClick={() => setExpanded(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                >
                  <Scissors className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{item.name}</span>
                      <Badge variant="outline" className="text-[9px] px-1.5 border-border">
                        {item.category}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">{item.duration}min</span>
                      {item.itemCount > 0 ? (
                        <span className="text-[10px] text-primary">{item.itemCount} itens na ficha</span>
                      ) : (
                        <span className="text-[10px] text-amber-400">Sem ficha técnica</span>
                      )}
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Preço</p>
                      <p className="text-sm font-semibold">{formatCurrency(item.price)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Custo</p>
                      <p className="text-sm font-medium text-red-400">
                        {item.itemCount > 0 ? formatCurrency(item.totalCost) : "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Lucro</p>
                      <p className={`text-sm font-semibold ${item.netProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {item.itemCount > 0 ? formatCurrency(item.netProfit) : "—"}
                      </p>
                    </div>
                    <div className="text-right w-14">
                      <p className="text-[10px] text-muted-foreground">Margem</p>
                      {item.itemCount > 0 ? (
                        <Badge className={`text-[10px] border-0 ${
                          item.healthy ? "bg-green-500/15 text-green-500"
                            : item.warning ? "bg-yellow-500/15 text-yellow-500"
                              : "bg-red-500/15 text-red-500"
                        }`}>{formatPercent(item.margin)}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="text-right w-20 hidden lg:block">
                      <p className="text-[10px] text-muted-foreground">Sugerido</p>
                      {item.precoSugerido !== null && item.itemCount > 0 ? (
                        <p className="text-xs font-medium text-primary">{formatCurrency(item.precoSugerido)}</p>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="text-right w-10">
                      <p className="text-[10px] text-muted-foreground">Mês</p>
                      <p className="text-xs">{item.usage}x</p>
                    </div>
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  )}
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border/50 p-3 bg-muted/5">
                    {/* Mobile stats */}
                    <div className="sm:hidden grid grid-cols-2 gap-2 mb-3">
                      <div><p className="text-[10px] text-muted-foreground">Preço</p><p className="text-sm font-semibold">{formatCurrency(item.price)}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Ficha técnica</p><p className="text-sm text-red-400">{item.itemCount > 0 ? formatCurrency(item.totalCost) : "—"}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Custo fixo ({item.duration}min)</p><p className="text-sm text-red-400">{formatCurrency(item.custoFixoRateado)}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Comissão ({item.comissaoPct}%)</p><p className="text-sm text-orange-400">{formatCurrency(item.commissionValue)}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Lucro</p><p className={`text-sm font-semibold ${item.netProfit >= 0 ? "text-green-500" : "text-red-500"}`}>{item.itemCount > 0 ? formatCurrency(item.netProfit) : "—"}</p></div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Preço sugerido (margem {item.margemDesejadaPct}%)</p>
                        <p className="text-sm font-semibold text-primary">
                          {item.precoSugerido !== null ? formatCurrency(item.precoSugerido) : "—"}
                        </p>
                      </div>
                    </div>

                    {/* Items preview */}
                    {items.length > 0 ? (
                      <div className="space-y-1 mb-3">
                        {items.map(ci => (
                          <div key={ci.id} className="flex items-center gap-2 text-xs">
                            <Badge className={`text-[8px] border-0 px-1 ${CATEGORY_COLORS[ci.category]}`}>
                              {CATEGORY_LABELS[ci.category]}
                            </Badge>
                            <span className="flex-1 truncate">{ci.name}</span>
                            <span className="text-muted-foreground">{ci.quantity}x {formatCurrency(ci.unitCost)}</span>
                            <span className="font-medium w-16 text-right">{formatCurrency(ci.quantity * ci.unitCost)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between pt-1 border-t border-border/50 text-xs font-semibold">
                          <span>Total de custos</span>
                          <span className="text-red-400">{formatCurrency(item.totalCost)}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mb-3">
                        Nenhum custo cadastrado. Clique em "Editar Ficha" para adicionar os itens.
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-primary hover:bg-primary/80 text-white h-7 text-xs"
                        onClick={() => setEditingService(item.id)}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        {items.length > 0 ? "Editar Ficha" : "Criar Ficha Técnica"}
                      </Button>
                      {/* Copy from another service */}
                      {items.length === 0 && savedCosts.some(c => c.items.length > 0) && (
                        <Select onValueChange={v => handleCopyFrom(item.id, v)}>
                          <SelectTrigger className="h-7 w-auto text-xs">
                            <Copy className="w-3 h-3 mr-1" />
                            <SelectValue placeholder="Copiar de..." />
                          </SelectTrigger>
                          <SelectContent>
                            {savedCosts
                              .filter(c => c.items.length > 0 && c.serviceId !== item.id)
                              .map(c => (
                                <SelectItem key={c.serviceId} value={c.serviceId} className="text-xs">
                                  {c.serviceName} ({c.items.length} itens)
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Detail Dialog */}
      {editingServiceData && (
        <CostDetailDialog
          open={!!editingService}
          onClose={() => setEditingService(null)}
          service={editingServiceData}
          items={getItems(editingServiceData.id)}
          onSave={(items) => handleSaveItems(editingServiceData.id, items)}
        />
      )}

      {/* Info */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20">
        <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs text-primary">
          <p className="font-medium mb-1">Como usar:</p>
          <p>1. Clique em um serviço para expandir e ver os detalhes</p>
          <p>2. Clique em "Criar Ficha Técnica" para adicionar os itens de custo (produtos, descartáveis, etc.)</p>
          <p>3. Use "Itens Comuns" para adicionar rapidamente itens frequentes de barbearia</p>
          <p>4. Use "Copiar de..." para copiar a ficha de um serviço similar</p>
          <p className="mt-1">Fórmula v24: <strong>Custo total = ficha + (duração × custo fixo/min) + (preço × comissão%)</strong></p>
          <p className="mt-0.5">Preço sugerido = (ficha + custo fixo rateado) ÷ (1 − comissão% − margem desejada%)</p>
          <p className="mt-0.5 text-muted-foreground">Comissão automática: VIP/Express 50%, demais 40%. Margem desejada padrão: Cortes/Barbas 30%, Químicas/Estética 35%, Depilação/VIP 40%.</p>
          <p className="mt-1"><strong>Modo simulação</strong> (toggle no topo): comissão = <strong>(preço − ficha) × %</strong> em vez de preço × %. Útil para travar o custo do produto antes da comissão. Não altera dados — só recalcula visualmente.</p>
        </div>
      </div>
    </div>
  );
}
