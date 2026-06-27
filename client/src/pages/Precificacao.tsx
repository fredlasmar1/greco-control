import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency, formatPercent } from "@/lib/demoData";
import { MonthSelector } from "@/components/MonthSelector";
import { useTrinksMonth } from "@/hooks/useTrinksMonth";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Servicos from "@/pages/Servicos";
import CustosProdutosPanel from "@/components/precificacao/CustosProdutosPanel";
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
  comissaoPct?: number;        // v24: % do barbeiro/executor
  comissaoAssistentePct?: number; // v31: % adicional do assistente (default 0)
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
  custoFixoPorAtendimento?: number;  // v70
  mediaAtendimentos?: number;        // v70
  comandas?: number;
  ocupacaoRealEstimada?: number;
  baseOcupacao?: string;
  qtdLancamentosFixos?: number;
  taxaCartaoPct?: number;
  impostoPct?: number;
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
  comissaoPctInit,
  comissaoAssistentePctInit,
  margemDesejadaPctInit,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  service: { id: string; name: string; price: number; duration: number; category: string };
  items: CostItem[];
  comissaoPctInit: number;
  comissaoAssistentePctInit: number;
  margemDesejadaPctInit: number;
  onSave: (data: { items: CostItem[]; comissaoPct: number; comissaoAssistentePct: number; margemDesejadaPct: number }) => void;
}) {
  const [localItems, setLocalItems] = useState<CostItem[]>(items);
  const [showPresets, setShowPresets] = useState(false);
  const [comissaoStr, setComissaoStr] = useState(String(comissaoPctInit));
  const [assistenteStr, setAssistenteStr] = useState(String(comissaoAssistentePctInit));
  const [margemStr, setMargemStr] = useState(String(margemDesejadaPctInit));

  useEffect(() => {
    setLocalItems(items);
    setComissaoStr(String(comissaoPctInit));
    setAssistenteStr(String(comissaoAssistentePctInit));
    setMargemStr(String(margemDesejadaPctInit));
  }, [items, open, comissaoPctInit, comissaoAssistentePctInit, margemDesejadaPctInit]);

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

  const parsePct = (s: string): number => {
    const n = Number((s || "").replace(",", "."));
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  };
  const handleSave = () => {
    onSave({
      items: localItems,
      comissaoPct: parsePct(comissaoStr),
      comissaoAssistentePct: parsePct(assistenteStr),
      margemDesejadaPct: parsePct(margemStr),
    });
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
        <div className="flex items-center gap-4 px-3 py-2 rounded-md bg-muted/30 text-sm flex-wrap">
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

        {/* Comissões e margem desejada por serviço */}
        <div className="rounded-md border border-card-border bg-background/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Comissões e margem deste serviço
            </p>
            <Badge variant="outline" className="text-[9px]">
              Total comissão: {(parsePct(comissaoStr) + parsePct(assistenteStr)).toFixed(0)}%
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">% Barbeiro / Executor</label>
              <Input
                type="text" inputMode="decimal" placeholder="40"
                value={comissaoStr}
                onChange={e => setComissaoStr(e.target.value.replace(/[^\d.,]/g, ""))}
                className="h-8 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="text-[10px] text-pink-300 block mb-1">% Assistente <span className="text-muted-foreground">(0 se não tem)</span></label>
              <Input
                type="text" inputMode="decimal" placeholder="0"
                value={assistenteStr}
                onChange={e => setAssistenteStr(e.target.value.replace(/[^\d.,]/g, ""))}
                className="h-8 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="text-[10px] text-emerald-300 block mb-1">% Margem desejada</label>
              <Input
                type="text" inputMode="decimal" placeholder="30"
                value={margemStr}
                onChange={e => setMargemStr(e.target.value.replace(/[^\d.,]/g, ""))}
                className="h-8 text-sm tabular-nums"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            💡 Use o assistente quando o serviço exige duas pessoas (químicas, depilação, mãos&pés). A comissão total = barbeiro + assistente.
          </p>
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

  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("precificacao.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("precificacao.selectedMes", selectedMes); } catch {}
  }, [selectedMes]);

  const {
    trinks, hasTrinksData, loading, error,
    fonte, trinksAt, csvAt, isMesCorrente,
  } = useTrinksMonth(selectedMes);

  // Alias para os queries que usavam 'mesAtual' (agora reflete o mês selecionado)
  const mesAtual = selectedMes;

  const [editingService, setEditingService] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // v24 Etapa 5: modo simulação (toggle 'travar custo antes da comissão') — só visualização, não persiste
  const [modoSimulacao, setModoSimulacao] = useState<boolean>(false);
  // v58: margem-alvo única pra a aba "Reajuste de Preços" (default 30%, editável)
  const [margemAlvo, setMargemAlvo] = useState<number>(30);

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
    handleSaveItems(targetServiceId, {
      items: copiedItems,
      comissaoPct: source.comissaoPct ?? comissaoPctPadrao(source.serviceName),
      comissaoAssistentePct: source.comissaoAssistentePct ?? 0,
      margemDesejadaPct: source.margemDesejadaPct ?? 30,
    });
  };

  // Build services list from Trinks
  const services = useMemo(() => {
    if (!hasTrinksData || !trinks) return [];
    const servicos = trinks.servicos || [];
    const agendamentos = trinks.agendamentos || [];

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

  const handleSaveItems = (
    serviceId: string,
    data: { items: CostItem[]; comissaoPct: number; comissaoAssistentePct: number; margemDesejadaPct: number },
  ) => {
    const svc = services.find(s => s.id === serviceId);
    const existing = savedCosts.filter(c => c.serviceId !== serviceId);
    const updated: ServiceCostData[] = [
      ...existing,
      {
        serviceId,
        serviceName: svc?.name || "",
        items: data.items,
        comissaoPct: data.comissaoPct,
        comissaoAssistentePct: data.comissaoAssistentePct,
        margemDesejadaPct: data.margemDesejadaPct,
      },
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
      const comissaoAssistentePct = sc?.comissaoAssistentePct ?? 0;
      const comissaoTotalPct = comissaoPct + comissaoAssistentePct;
      const margemDesejadaPct = sc?.margemDesejadaPct !== undefined
        ? sc.margemDesejadaPct
        : margemDesejadaPadrao(s.category, s.name);

      // Fórmulas v24 + v56 (taxa de cartão + imposto entram no custo)
      const taxaCartaoPct = contexto?.taxaCartaoPct || 0;
      const impostoPct = contexto?.impostoPct || 0;
      // v70: custo fixo POR ATENDIMENTO (decisão do dono) tem prioridade sobre o por-minuto
      const cfa = contexto?.custoFixoPorAtendimento;
      const custoFixoRateado = (cfa != null && cfa >= 0) ? cfa : s.duration * cfm;
      // v24 Etapa 5: em modo simulação, comissão = (preço − ficha) × % (trava custo antes da comissão)
      // No modo padrão, comissão = preço × % (sobre o preço cheio)
      const baseComissao = modoSimulacao ? Math.max(0, s.price - totalCost) : s.price;
      const commissionBarbeiro = baseComissao * (comissaoPct / 100);
      const commissionAssistente = baseComissao * (comissaoAssistentePct / 100);
      const commissionValue = commissionBarbeiro + commissionAssistente;
      const taxaCartaoValor = s.price * (taxaCartaoPct / 100);
      const impostoValor = s.price * (impostoPct / 100);
      const custoTotal = totalCost + custoFixoRateado + commissionValue + taxaCartaoValor + impostoValor;
      const netProfit = s.price - custoTotal;
      const margin = s.price > 0 ? (netProfit / s.price) * 100 : 0;

      // Preço sugerido: cobre comissão + taxa + imposto + margem
      const denom = 1 - (comissaoTotalPct / 100) - (taxaCartaoPct / 100) - (impostoPct / 100) - (margemDesejadaPct / 100);
      const precoSugerido = denom > 0 ? (totalCost + custoFixoRateado) / denom : null;
      const precoSugeridoErro = denom <= 0
        ? `Comissão (${comissaoTotalPct}%) + taxa (${taxaCartaoPct}%) + imposto (${impostoPct}%) + margem (${margemDesejadaPct}%) ≥ 100%`
        : null;

      return {
        ...s,
        totalCost,
        custoFixoRateado,
        comissaoPct,
        comissaoAssistentePct,
        comissaoTotalPct,
        margemDesejadaPct,
        commissionValue,
        commissionBarbeiro,
        commissionAssistente,
        taxaCartaoValor,
        impostoValor,
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

  // Parte 4: confiança da margem + lista de prejuízo.
  // Margem só é confiável se: serviço tem ficha (itens + custo>0) E as fixas do
  // mês estão ok (>2 lançamentos) E a ocupação não está no chute padrão (50%).
  const fixasOk = (contexto?.qtdLancamentosFixos ?? 0) > 2;
  const ocupacaoOk = (contexto?.operacional?.ocupacaoPct ?? 50) !== 50;
  const baseConfiavel = fixasOk && ocupacaoOk;
  const margemConfiavel = (item: any) => baseConfiavel && item.itemCount > 0 && item.totalCost > 0;
  // Prejuízo / margem crítica: só serviços COM ficha (margem dos sem-ficha não vale).
  const prejuizo = useMemo(
    () => analysis.filter(a => a.itemCount > 0 && a.margin < 15).sort((a, b) => a.margin - b.margin),
    [analysis]
  );

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

  const monthLabelCapital = labelMesPtBR(selectedMes);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Serviços &amp; Precificação</h2>
          <p className="text-sm text-muted-foreground">
            Catálogo, ficha técnica e custos — {monthLabelCapital}
            <span className="text-primary ml-1">• Dados Trinks</span>
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
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

      <Tabs defaultValue="visao-geral" className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="visao-geral" data-testid="tab-visao-geral">📊 Visão Geral</TabsTrigger>
          <TabsTrigger value="calculadora" data-testid="tab-calculadora">🧮 Calculadora (1 a 1)</TabsTrigger>
          <TabsTrigger value="margem-produtos" data-testid="tab-margem-produtos">Custos de Produtos</TabsTrigger>
          <TabsTrigger value="reajuste" data-testid="tab-reajuste">Reajuste p/ Meta</TabsTrigger>
          <TabsTrigger value="catalogo" data-testid="tab-catalogo">Catálogo</TabsTrigger>
          <TabsTrigger value="ficha-servicos" data-testid="tab-ficha-servicos">Ficha de Serviços</TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral" className="mt-0">
          <VisaoGeral analysis={analysis} apiBase={(globalThis as any).__API_BASE__ || ""} />
        </TabsContent>

        <TabsContent value="calculadora" className="mt-0">
          <CalculadoraPreco analysis={analysis} contexto={contexto} onImpostoSalvo={() => qClient.invalidateQueries({ queryKey: ["/api/precificacao/contexto"] })} apiBase={(globalThis as any).__API_BASE__ || ""} />
        </TabsContent>

        <TabsContent value="reajuste" className="mt-0">
          <ReajustePrecos analysis={analysis} contexto={contexto} margemAlvo={margemAlvo} setMargemAlvo={setMargemAlvo} />
        </TabsContent>

        <TabsContent value="margem-produtos" className="mt-0">
          <MargemProdutos apiBase={(globalThis as any).__API_BASE__ || ""} />
        </TabsContent>

        <TabsContent value="catalogo" className="mt-0">
          <Servicos embedded />
        </TabsContent>

        <TabsContent value="ficha-servicos" className="space-y-6 mt-0">
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
                className={`h-8 text-sm ${opLocal?.ocupacaoPct === 50 ? "border-amber-500/50" : ""}`}
                data-testid="input-ocupacao"
              />
              {(contexto?.ocupacaoRealEstimada || 0) > 0 && (
                <div className="mt-1 text-[10px] flex items-center gap-1.5 flex-wrap" data-testid="ocupacao-real">
                  <span className="text-muted-foreground">Real estimada: <strong className="text-primary">{contexto!.ocupacaoRealEstimada}%</strong></span>
                  <button
                    type="button"
                    className="text-primary underline underline-offset-2"
                    onClick={() => opLocal && setOpLocal({ ...opLocal, ocupacaoPct: Math.round(contexto!.ocupacaoRealEstimada!) })}
                    data-testid="btn-usar-ocupacao-real"
                  >usar</button>
                </div>
              )}
              {contexto?.baseOcupacao && <div className="text-[9px] text-muted-foreground/70 mt-0.5">{contexto.baseOcupacao}</div>}
            </div>
          </div>
          {opLocal?.ocupacaoPct === 50 && (
            <div className="text-[11px] text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              Ocupação em 50% (chute padrão) — ajuste com a sua real, ela afeta a margem de TODOS os serviços.
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-border/50">
            <div className="text-xs space-y-0.5">
              <div>
                Despesas fixas do mês: <strong className="text-red-400">{formatCurrency(contexto?.totalFixas || 0)}</strong>
                <span className="text-muted-foreground ml-1">· você marcou <strong>{contexto?.qtdLancamentosFixos ?? 0}</strong> lançamento{(contexto?.qtdLancamentosFixos ?? 0) === 1 ? "" : "s"} como fixo</span>
              </div>
              {(contexto?.qtdLancamentosFixos ?? 0) <= 2 && (
                <div className="text-[11px] text-amber-400 flex items-start gap-1.5 max-w-md" data-testid="alerta-fixas">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  <span>
                    Parece faltar despesa fixa — confira aluguel, energia, água, internet, contador, sistemas. Com fixas incompletas, o custo por minuto fica baixo e a <strong>margem aparece inflada</strong>.
                    <Link href="/lancamentos" className="text-primary underline underline-offset-2 ml-1">Categorizar fixas →</Link>
                  </span>
                </div>
              )}
              <div>
                Minutos produtivos/mês: <strong>{(contexto?.minutosProdutivosMes || 0).toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                Custo fixo por minuto: <strong className="text-primary">{formatCurrency(contexto?.custoFixoPorMinuto || 0)}/min</strong>
                {(() => {
                  if (!opLocal || !contexto) return null;
                  const minDisp = opLocal.cadeiras * opLocal.horasDia * 60 * opLocal.diasMes * (opLocal.ocupacaoPct / 100);
                  const cfmPreview = minDisp > 0 ? (contexto.totalFixas / minDisp) : 0;
                  const mudou = Math.abs(cfmPreview - (contexto.custoFixoPorMinuto || 0)) > 0.001;
                  if (!mudou) return null;
                  return (
                    <span className="ml-1 text-amber-400" data-testid="cfm-preview">
                      → {formatCurrency(cfmPreview)}/min (prévia, salve pra aplicar)
                    </span>
                  );
                })()}
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

      {/* Parte 3: banner de confiabilidade da margem */}
      {summary.withoutCost > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-xs" data-testid="banner-sem-ficha">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <strong className="text-amber-400">{summary.withoutCost} de {services.length} serviços sem ficha técnica</strong> — a margem deles <strong>não é confiável</strong> (sem custo de material, o lucro aparece inflado). Preencha a ficha de cada um pra ver a margem real.
          </div>
        </div>
      )}

      {/* Parte 4: bloco "Dando prejuízo / margem crítica" no topo */}
      {prejuizo.length > 0 && (
        <Card className="border-red-500/40 bg-red-500/5" data-testid="bloco-prejuizo">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" />
              Dando prejuízo ou margem crítica ({prejuizo.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground -mt-1 mb-1">Serviços com ficha cuja margem real está negativa ou abaixo de 15% — atacar primeiro.</p>
            {prejuizo.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setExpanded(prev => ({ ...prev, [item.id]: true }))}
                className="w-full flex items-center justify-between gap-2 text-xs p-2 rounded border border-red-500/20 bg-card hover:bg-muted/20 text-left"
                data-testid={`prejuizo-${item.id}`}
              >
                <span className="truncate flex-1">{item.name}</span>
                <span className="flex items-center gap-3 flex-shrink-0 tabular-nums">
                  <span className="text-muted-foreground hidden sm:inline">{formatCurrency(item.price)}</span>
                  <span className={item.netProfit < 0 ? "text-red-500 font-semibold" : "text-red-400"}>{formatCurrency(item.netProfit)}/serv.</span>
                  <span className={`font-bold ${item.margin < 0 ? "text-red-500" : "text-red-400"}`}>{formatPercent(item.margin)}</span>
                  {item.precoSugerido != null && <span className="text-primary hidden md:inline">→ {formatCurrency(item.precoSugerido)}</span>}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

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
                      {margemConfiavel(item) ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 whitespace-nowrap" data-testid={`conf-${item.id}`}>● margem confiável</span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 whitespace-nowrap" data-testid={`conf-${item.id}`} title="Falta dado: ficha vazia, fixas incompletas ou ocupação no chute (50%)">● margem estimada</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">{item.duration}min</span>
                      {item.itemCount === 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30" data-testid={`sem-ficha-${item.id}`}>⚠ sem ficha — margem pode estar inflada</span>
                      ) : item.totalCost === 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30" data-testid={`ficha-zero-${item.id}`}>⚠ ficha R$0? confira</span>
                      ) : (
                        <span className="text-[10px] text-primary">{item.itemCount} itens na ficha</span>
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
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Comissão ({item.comissaoPct}%{item.comissaoAssistentePct > 0 ? ` + ${item.comissaoAssistentePct}% ass.` : ""})
                        </p>
                        <p className="text-sm text-orange-400">{formatCurrency(item.commissionValue)}</p>
                        {item.comissaoAssistentePct > 0 && (
                          <p className="text-[9px] text-pink-400/80">
                            Barbeiro {formatCurrency(item.commissionBarbeiro)} + Assist. {formatCurrency(item.commissionAssistente)}
                          </p>
                        )}
                      </div>
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
      {editingServiceData && (() => {
        const sc = savedCosts.find(c => c.serviceId === editingServiceData.id);
        const comInit = sc?.comissaoPct ?? comissaoPctPadrao(editingServiceData.name);
        const assInit = sc?.comissaoAssistentePct ?? 0;
        const marInit = sc?.margemDesejadaPct ?? margemDesejadaPadrao(editingServiceData.category, editingServiceData.name);
        return (
          <CostDetailDialog
            open={!!editingService}
            onClose={() => setEditingService(null)}
            service={editingServiceData}
            items={getItems(editingServiceData.id)}
            comissaoPctInit={comInit}
            comissaoAssistentePctInit={assInit}
            margemDesejadaPctInit={marInit}
            onSave={(data) => handleSaveItems(editingServiceData.id, data)}
          />
        );
      })()}

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
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── v56: Calculadora de Preço guiada ────────────────────────────────────────
// Decomposição passo a passo de UM serviço até o preço base: produtos + custo
// fixo + comissão (barbeiro/assistente) + taxa cartão + imposto = custo total;
// + margem (slider) = preço base que cobre tudo. Reusa o `analysis` (já com taxa
// e imposto na fórmula) — não duplica cálculo.
function CalculadoraPreco({ analysis, contexto, onImpostoSalvo, apiBase }: {
  analysis: any[];
  contexto: any;
  onImpostoSalvo: () => void;
  apiBase: string;
}) {
  const [servId, setServId] = useState<string>("");
  const [margem, setMargem] = useState<number | null>(null);
  const [impostoStr, setImpostoStr] = useState<string>("");
  const [salvandoImp, setSalvandoImp] = useState(false);

  const serv = analysis.find(s => s.id === servId) || null;
  const taxaPct = contexto?.taxaCartaoPct || 0;
  const impostoPct = contexto?.impostoPct || 0;
  useEffect(() => { setImpostoStr(String(impostoPct)); }, [impostoPct]);
  // margem efetiva: a do slider (se mexeu) ou a desejada do serviço
  const margemEf = margem ?? (serv?.margemDesejadaPct ?? 30);

  // recalcula o preço base com a margem do slider (mesma fórmula do server)
  const precoBase = (() => {
    if (!serv) return null;
    const denom = 1 - (serv.comissaoTotalPct / 100) - (taxaPct / 100) - (impostoPct / 100) - (margemEf / 100);
    if (denom <= 0) return null;
    return (serv.totalCost + serv.custoFixoRateado) / denom;
  })();

  const salvarImposto = async () => {
    setSalvandoImp(true);
    try {
      await fetch(`${apiBase}/api/config/financeira`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impostoPct: Number(impostoStr.replace(",", ".")) || 0 }),
      });
      onImpostoSalvo();
    } finally { setSalvandoImp(false); }
  };

  const linha = (lbl: string, val: number, sub?: string) => (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30 text-sm">
      <span className="text-muted-foreground">{lbl}{sub && <span className="text-[10px] ml-1">{sub}</span>}</span>
      <span className="tabular-nums">{formatCurrency(val)}</span>
    </div>
  );

  return (
    <div className="space-y-4 max-w-[640px]">
      {/* imposto editável */}
      <Card className="bg-card border-card-border"><CardContent className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Imposto sobre faturamento (Simples):</span>
        <Input type="number" min={0} max={100} value={impostoStr} onChange={e => setImpostoStr(e.target.value)} className="h-7 w-20 text-sm" data-testid="input-imposto" />
        <span className="text-xs text-muted-foreground">%</span>
        <Button size="sm" className="h-7 text-xs" disabled={salvandoImp} onClick={salvarImposto} data-testid="btn-salvar-imposto"><Save className="w-3 h-3 mr-1" />Salvar</Button>
        <span className="text-[11px] text-muted-foreground ml-auto">Taxa de cartão: {taxaPct}% (em Configurações)</span>
      </CardContent></Card>

      {/* seletor de serviço */}
      <Select value={servId} onValueChange={(v) => { setServId(v); setMargem(null); }}>
        <SelectTrigger className="h-9" data-testid="calc-select-servico"><SelectValue placeholder="Escolha um serviço para calcular o preço…" /></SelectTrigger>
        <SelectContent>
          {analysis.map(s => <SelectItem key={s.id} value={s.id}>{s.name} · {s.duration}min · {formatCurrency(s.price)}</SelectItem>)}
        </SelectContent>
      </Select>

      {serv && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-primary" /> {serv.name} <span className="text-[11px] text-muted-foreground font-normal">({serv.duration} min)</span></CardTitle></CardHeader>
          <CardContent>
            {/* decomposição do custo */}
            {linha("Produtos usados (ficha)", serv.totalCost, serv.itemCount === 0 ? "⚠ sem ficha" : `${serv.itemCount} itens`)}
            {linha("Custo fixo (estrutura rateada)", serv.custoFixoRateado, `${serv.duration}min × custo/min`)}
            {linha(`Comissão barbeiro (${serv.comissaoPct}%)`, serv.commissionBarbeiro)}
            {serv.comissaoAssistentePct > 0 && linha(`Comissão assistente (${serv.comissaoAssistentePct}%)`, serv.commissionAssistente)}
            {linha(`Taxa de cartão (${taxaPct}%)`, serv.taxaCartaoValor)}
            {linha(`Imposto (${impostoPct}%)`, serv.impostoValor)}
            <div className="flex items-center justify-between py-2 mt-1 border-t border-border font-semibold">
              <span>Custo total</span>
              <span className="tabular-nums text-red-400" data-testid="calc-custo-total">{formatCurrency(serv.custoTotal)}</span>
            </div>

            {/* slider de margem */}
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm">Sua margem de lucro</span>
                <span className="text-sm font-bold text-primary" data-testid="calc-margem-valor">{margemEf.toFixed(0)}%</span>
              </div>
              <input type="range" min={0} max={80} step={1} value={margemEf} onChange={e => setMargem(Number(e.target.value))} className="w-full accent-primary" data-testid="calc-slider-margem" />
            </div>

            {/* preço base */}
            <div className="mt-3 rounded-lg bg-primary/10 border border-primary/30 p-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Preço base sugerido</div>
                <div className="text-[10px] text-muted-foreground">cobre todos os custos + sua margem de {margemEf.toFixed(0)}%</div>
              </div>
              <div className="text-2xl font-bold text-primary tabular-nums" data-testid="calc-preco-base">{precoBase != null ? formatCurrency(precoBase) : "—"}</div>
            </div>
            {precoBase != null && (
              <div className="text-[11px] text-muted-foreground mt-2">
                Preço atual: <strong>{formatCurrency(serv.price)}</strong>
                {serv.price > 0 && precoBase > serv.price && <span className="text-amber-400"> · abaixo do sugerido (R$ {formatCurrency(precoBase - serv.price)} a menos)</span>}
                {serv.price > 0 && precoBase <= serv.price && <span className="text-emerald-400"> · acima do mínimo ✓</span>}
              </div>
            )}
            {serv.itemCount === 0 && <div className="text-[11px] text-amber-400 mt-1">⚠ Sem ficha técnica — preencha os produtos do serviço (aba Ficha de Serviços) pro custo de material entrar.</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── v58: Reajuste de Preços — raio-X de TODOS os serviços ────────────────────
// O dono define o preço; o sistema diz se cada serviço lucra ou dá prejuízo
// (custo × preço atual) e qual o preço pra atingir a margem-alvo (default 30%).
// Custo e preço-alvo já incluem comissão + taxa de cartão + imposto (v56).
function ReajustePrecos({ analysis, contexto, margemAlvo, setMargemAlvo }: {
  analysis: any[];
  contexto: any;
  margemAlvo: number;
  setMargemAlvo: (n: number) => void;
}) {
  const taxaPct = contexto?.taxaCartaoPct || 0;
  const impostoPct = contexto?.impostoPct || 0;

  const linhas = useMemo(() => {
    return analysis.map(s => {
      // preço pra atingir a margem-alvo (mesma fórmula do motor v56)
      const denom = 1 - (s.comissaoTotalPct / 100) - (taxaPct / 100) - (impostoPct / 100) - (margemAlvo / 100);
      const precoAlvo = denom > 0 ? (s.totalCost + s.custoFixoRateado) / denom : null;
      const reajuste = precoAlvo != null ? precoAlvo - s.price : null;
      return { ...s, precoAlvo, reajuste };
    }).sort((a, b) => a.margin - b.margin); // pior (prejuízo) primeiro
  }, [analysis, taxaPct, impostoPct, margemAlvo]);

  const prejuizo = linhas.filter(l => l.margin < 0).length;
  const abaixoAlvo = linhas.filter(l => l.margin >= 0 && l.margin < margemAlvo).length;

  return (
    <div className="space-y-4 max-w-[920px]">
      {/* alvo editável + resumo */}
      <Card className="bg-card border-card-border"><CardContent className="p-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm">Margem-alvo:</span>
        <Input type="number" min={0} max={90} value={margemAlvo} onChange={e => setMargemAlvo(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} className="h-8 w-20 text-sm" data-testid="input-margem-alvo" />
        <span className="text-sm text-muted-foreground">%</span>
        <div className="ml-auto flex gap-3 text-xs">
          {prejuizo > 0 && <span className="text-red-400 font-medium" data-testid="resumo-prejuizo">🔴 {prejuizo} no prejuízo</span>}
          {abaixoAlvo > 0 && <span className="text-amber-400" data-testid="resumo-abaixo">🟡 {abaixoAlvo} abaixo de {margemAlvo}%</span>}
        </div>
      </CardContent></Card>

      <Card className="bg-card border-card-border">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2.5">Serviço</th>
                <th className="text-right p-2.5">Preço atual</th>
                <th className="text-right p-2.5">Custo</th>
                <th className="text-right p-2.5">Margem hoje</th>
                <th className="text-right p-2.5">Preço p/ {margemAlvo}%</th>
                <th className="text-right p-2.5">Reajuste</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => {
                const cor = l.margin < 0 ? "text-red-400" : l.margin < margemAlvo ? "text-amber-400" : "text-emerald-400";
                const semFicha = l.itemCount === 0;
                return (
                  <tr key={l.id} className="border-b border-border/30 hover:bg-muted/20" data-testid={`reaj-${l.id}`}>
                    <td className="p-2.5">
                      <div className="truncate max-w-[200px]" title={l.name}>{l.name}</div>
                      <div className="text-[9px] text-muted-foreground">{l.duration}min{semFicha && <span className="text-amber-400"> · ⚠ sem ficha</span>}</div>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{formatCurrency(l.price)}</td>
                    <td className="p-2.5 text-right tabular-nums text-muted-foreground">{formatCurrency(l.custoTotal)}</td>
                    <td className={`p-2.5 text-right tabular-nums font-semibold ${cor}`}>
                      {l.margin < 0 ? "🔴 " : ""}{formatPercent(l.margin)}
                    </td>
                    <td className="p-2.5 text-right tabular-nums text-primary">{l.precoAlvo != null ? formatCurrency(l.precoAlvo) : "—"}</td>
                    <td className={`p-2.5 text-right tabular-nums font-medium ${l.reajuste != null && l.reajuste > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {l.reajuste != null ? (l.reajuste > 0 ? "+" : "") + formatCurrency(l.reajuste) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="text-[11px] text-muted-foreground space-y-0.5">
        <p>● Custo = produtos (ficha) + custo fixo rateado + comissão + taxa de cartão ({taxaPct}%) + imposto ({impostoPct}%).</p>
        <p>● "Preço p/ {margemAlvo}%" é quanto cobrar pra sobrar {margemAlvo}% depois de tudo. Reajuste = quanto subir do preço atual.</p>
        <p className="text-amber-400">⚠ Serviços "sem ficha" têm custo de material zerado — o custo real é maior, então o reajuste pode ser ainda mais necessário. Preencha as fichas e categorize as fixas pra o custo ficar exato.</p>
      </div>
    </div>
  );
}

// ─── v64: Margem de Produtos (do catálogo importado) ─────────────────────────
// Lista os produtos do catálogo (CSV importado) com preço/comissão e o custo
// EDITÁVEL inline. Margem = preço − custo − comissão − taxa − imposto. O custo
// de compra a Trinks não exporta confiável (vem 0 ou errado) → o dono preenche.
function MargemProdutos({ apiBase }: { apiBase: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = () => {
    setLoading(true);
    fetch(`${apiBase}/api/produtos/catalogo`).then(r => r.json()).then(d => { setData(d); }).finally(() => setLoading(false));
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  // Salva o custo e atualiza a linha LOCALMENTE (sem refetch) — assim a ordem da
  // lista não muda e o foco pode seguir pro próximo campo (preenchimento em massa).
  const salvarCusto = async (nome: string) => {
    const raw = editando[nome];
    if (raw === undefined) return;
    const v = Number((raw || "").replace(",", "."));
    if (!isFinite(v) || v < 0) return;
    setSalvando(nome);
    try {
      await fetch(`${apiBase}/api/produtos/catalogo/custo`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, custo: v }),
      });
      setEditando(e => { const n = { ...e }; delete n[nome]; return n; });
      setData((prev: any) => {
        if (!prev) return prev;
        const taxa = (prev.taxaCartaoPct || 0) / 100, imp = (prev.impostoPct || 0) / 100;
        const produtos = prev.produtos.map((p: any) => {
          if (p.nome !== nome) return p;
          const comV = p.preco * ((p.comissaoPct || 0) / 100), taxaV = p.preco * taxa, impV = p.preco * imp;
          const margem = p.preco - v - comV - taxaV - impV;
          return { ...p, custo: v, semCusto: v <= 0, comissaoValor: Math.round(comV * 100) / 100, taxaCartao: Math.round(taxaV * 100) / 100, imposto: Math.round(impV * 100) / 100, margemReal: Math.round(margem * 100) / 100, margemPct: p.preco > 0 ? Math.round((margem / p.preco) * 10000) / 100 : 0 };
        });
        return { ...prev, produtos, semCusto: produtos.filter((x: any) => x.semCusto).length };
      });
    } finally { setSalvando(null); }
  };

  if (loading) return <div className="text-sm text-muted-foreground p-4">Carregando catálogo…</div>;
  if (!data?.importado) return (
    <Card className="bg-card border-card-border"><CardContent className="p-4 text-sm text-muted-foreground">
      Nenhum catálogo importado ainda. Vá em <strong>Importar Trinks</strong> e suba o relatório de <strong>Produtos</strong> (Nome · Preço · % Comissão · Valor de Compra).
    </CardContent></Card>
  );

  const semaforo = (pct: number) => pct < 0 ? "text-red-400" : pct < 10 ? "text-amber-400" : "text-emerald-400";
  const comCusto = data.produtos.filter((p: any) => !p.semCusto);
  const prejuizo = comCusto.filter((p: any) => p.margemPct < 0).length;

  return (
    <div className="space-y-4 max-w-[920px]">
      <Card className="bg-card border-card-border"><CardContent className="p-3 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-medium">{data.total} produtos no catálogo</span>
        <span className="text-emerald-400">{data.total - data.semCusto} com custo</span>
        {data.semCusto > 0 && <span className="text-amber-400">{data.semCusto} sem custo (preencha pra ver a margem)</span>}
        {prejuizo > 0 && <span className="text-red-400 font-medium">🔴 {prejuizo} no prejuízo</span>}
        <span className="text-muted-foreground ml-auto">taxa {data.taxaCartaoPct}% · imposto {data.impostoPct}%</span>
      </CardContent></Card>

      <Card className="bg-card border-card-border">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2.5">Produto</th>
                <th className="text-right p-2.5">Preço</th>
                <th className="text-right p-2.5">Custo (R$)</th>
                <th className="text-right p-2.5">Comissão</th>
                <th className="text-right p-2.5">Margem</th>
                <th className="p-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {[...data.produtos].sort((a: any, b: any) => (a.categoria || "").localeCompare(b.categoria || "", "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR")).map((p: any) => {
                const emEdicao = editando[p.nome] !== undefined;
                return (
                  <tr key={p.nome} className="border-b border-border/30 hover:bg-muted/20" data-testid={`prod-${p.nome}`}>
                    <td className="p-2.5">
                      <div className="truncate max-w-[220px]" title={p.nome}>{p.nome}</div>
                      <div className="text-[9px] text-muted-foreground">{p.categoria}</div>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{formatCurrency(p.preco)}</td>
                    <td className="p-2.5 text-right">
                      <input
                        type="number" min={0} step="0.01"
                        value={emEdicao ? editando[p.nome] : (p.custo > 0 ? p.custo : "")}
                        placeholder={p.semCusto ? "—" : ""}
                        onChange={e => setEditando(ed => ({ ...ed, [p.nome]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") { const ins = Array.from(document.querySelectorAll('input[data-testid^="custo-"]')) as HTMLElement[]; const i = ins.indexOf(e.currentTarget as HTMLElement); salvarCusto(p.nome); if (i >= 0 && ins[i + 1]) ins[i + 1].focus(); } }}
                        className={`h-6 w-20 rounded border bg-background px-1.5 text-right text-xs ${p.semCusto && !emEdicao ? "border-amber-500/40" : "border-border"}`}
                        data-testid={`custo-${p.nome}`}
                      />
                    </td>
                    <td className="p-2.5 text-right tabular-nums text-muted-foreground">{p.comissaoPct}%</td>
                    <td className={`p-2.5 text-right tabular-nums font-semibold ${p.semCusto ? "text-muted-foreground" : semaforo(p.margemPct)}`}>
                      {p.semCusto ? "—" : `${p.margemPct}%`}
                      {!p.semCusto && <div className="text-[9px] font-normal text-muted-foreground">{formatCurrency(p.margemReal)}</div>}
                    </td>
                    <td className="p-2.5 text-right">
                      {emEdicao && (
                        <Button size="sm" className="h-6 text-[10px] px-2" disabled={salvando === p.nome} onClick={() => salvarCusto(p.nome)} data-testid={`salvar-${p.nome}`}>
                          {salvando === p.nome ? "…" : "Salvar"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="text-[11px] text-muted-foreground space-y-0.5">
        <p>● Margem = preço − custo de compra − comissão − taxa de cartão ({data.taxaCartaoPct}%) − imposto ({data.impostoPct}%).</p>
        <p>● Digite o custo e tecle Enter (ou Salvar). Produtos sem custo ficam sem margem até você preencher.</p>
        <p className="text-amber-400">⚠ Os custos que vieram da Trinks podem estar errados (custo de caixa em vez de unitário) — confira os que estão com margem negativa.</p>
      </div>
    </div>
  );
}

// ─── v70: Visão Geral — todos os itens (serviços + produtos) num lugar só ─────
// Pesquisável, com margem real e semáforo, pra ver onde ganha/perde de relance.
function VisaoGeral({ analysis, apiBase }: { analysis: any[]; apiBase: string }) {
  const [produtos, setProdutos] = useState<any[]>([]);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "servicos" | "produtos">("todos");

  useEffect(() => {
    fetch(`${apiBase}/api/produtos/catalogo`).then(r => r.json()).then(d => { if (d?.produtos) setProdutos(d.produtos); }).catch(() => {});
  }, [apiBase]);

  const itens = useMemo(() => {
    const serv = analysis.map((s: any) => ({
      tipo: "serviço" as const, nome: s.name, categoria: s.category || "",
      preco: s.price, custo: s.custoTotal, margemPct: s.margin, semDados: s.itemCount === 0 && s.totalCost === 0 ? false : false,
    }));
    const prod = produtos.map((p: any) => ({
      tipo: "produto" as const, nome: p.nome, categoria: p.categoria || "",
      preco: p.preco, custo: p.semCusto ? null : Math.round((p.preco - p.margemReal) * 100) / 100,
      margemPct: p.semCusto ? null : p.margemPct, semDados: p.semCusto,
    }));
    let arr = [...serv, ...prod];
    if (filtro === "servicos") arr = arr.filter(i => i.tipo === "serviço");
    if (filtro === "produtos") arr = arr.filter(i => i.tipo === "produto");
    const q = busca.trim().toLowerCase();
    if (q) arr = arr.filter(i => i.nome.toLowerCase().includes(q) || i.categoria.toLowerCase().includes(q));
    // ordena: com dados primeiro (pior margem no topo), sem dados no fim
    return arr.sort((a, b) => {
      if (a.margemPct == null && b.margemPct == null) return a.nome.localeCompare(b.nome);
      if (a.margemPct == null) return 1;
      if (b.margemPct == null) return -1;
      return a.margemPct - b.margemPct;
    });
  }, [analysis, produtos, busca, filtro]);

  const comDados = itens.filter(i => i.margemPct != null);
  const prejuizo = comDados.filter(i => (i.margemPct as number) < 0).length;
  const semaforo = (pct: number) => pct < 0 ? "text-red-400" : pct < 10 ? "text-amber-400" : "text-emerald-400";
  const fmtPctVal = (v: number | null) => v == null ? "—" : `${v.toFixed(1)}%`;

  return (
    <div className="space-y-3 max-w-[960px]">
      {/* busca + filtro + resumo */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input placeholder="🔎 Buscar serviço ou produto…" value={busca} onChange={e => setBusca(e.target.value)} className="h-9 max-w-xs" data-testid="vg-busca" />
        <div className="flex gap-1">
          {(["todos", "servicos", "produtos"] as const).map(f => (
            <Button key={f} size="sm" variant={filtro === f ? "default" : "outline"} className="h-8 text-xs capitalize" onClick={() => setFiltro(f)} data-testid={`vg-filtro-${f}`}>{f}</Button>
          ))}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {comDados.length} c/ margem · {prejuizo > 0 && <span className="text-red-400 font-medium">🔴 {prejuizo} no prejuízo</span>}
        </div>
      </div>

      <Card className="bg-card border-card-border">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2.5">Item</th>
                <th className="text-left p-2.5">Tipo</th>
                <th className="text-right p-2.5">Preço</th>
                <th className="text-right p-2.5">Custo</th>
                <th className="text-right p-2.5">Margem</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i, idx) => (
                <tr key={`${i.tipo}-${i.nome}-${idx}`} className="border-b border-border/30 hover:bg-muted/20" data-testid={`vg-item`}>
                  <td className="p-2.5">
                    <div className="truncate max-w-[260px]" title={i.nome}>{i.nome}</div>
                    {i.categoria && <div className="text-[9px] text-muted-foreground">{i.categoria}</div>}
                  </td>
                  <td className="p-2.5"><span className={`text-[9px] px-1.5 py-0.5 rounded ${i.tipo === "serviço" ? "bg-sky-500/15 text-sky-400" : "bg-purple-500/15 text-purple-400"}`}>{i.tipo}</span></td>
                  <td className="p-2.5 text-right tabular-nums">{formatCurrency(i.preco)}</td>
                  <td className="p-2.5 text-right tabular-nums text-muted-foreground">{i.custo == null ? <span className="text-amber-400">s/ custo</span> : formatCurrency(i.custo)}</td>
                  <td className={`p-2.5 text-right tabular-nums font-semibold ${i.margemPct == null ? "text-muted-foreground" : semaforo(i.margemPct as number)}`}>
                    {i.margemPct != null && (i.margemPct as number) < 0 ? "🔴 " : ""}{fmtPctVal(i.margemPct)}
                  </td>
                </tr>
              ))}
              {itens.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Nenhum item encontrado.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-[10px] text-muted-foreground">● Margem real = preço − custos (fixo por atendimento + produtos/ficha + comissão + taxa + imposto). Produtos "s/ custo" precisam do custo de compra na aba <strong>Custos de Produtos</strong>.</p>
    </div>
  );
}
