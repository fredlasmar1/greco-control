import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  Trash2,
  Plus,
  Sparkles,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Upload,
  Zap,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  CalendarDays,
  Receipt,
  Scale,
  Users,
  DollarSign,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

// ─── Types ─────────────────────────────────────────────────────
interface FinanceEntry {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: "fixo" | "variavel" | "parcelamento" | "receita" | "investimento";
  subcategory: string;
  recurrent: boolean;
  notes?: string;
  createdAt: string;
}

// ─── Constants ─────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  fixo: "Fixo",
  variavel: "Variável",
  parcelamento: "Parcelamento",
  receita: "Receita",
  investimento: "Investimento",
};

const CATEGORY_COLORS: Record<string, string> = {
  fixo: "bg-red-500/20 text-red-400 border-red-500/30",
  variavel: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  parcelamento: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  receita: "bg-green-500/20 text-green-400 border-green-500/30",
  investimento: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const CHART_COLORS = [
  "#01696F",
  "#ef4444",
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#eab308",
  "#ec4899",
  "#22c55e",
];

const QUICK_FIXED_COSTS = [
  { label: "Cloudia", subcategory: "Cloudia", amount: -89.9, category: "fixo" as const },
  { label: "Trinks", subcategory: "Trinks", amount: -89.9, category: "fixo" as const },
  { label: "Instagram", subcategory: "Instagram", amount: -149.9, category: "fixo" as const },
];

// ─── Helpers ───────────────────────────────────────────────────
function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Map Portuguese month abbreviations to month number
const MONTH_MAP: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
};

/**
 * Extract a clean client/person name from a bank description.
 * E.g. "PIX QRS RODRIGO ROD28/02" → "Rodrigo"
 *      "PIX QRS MARIA SILVA SILVA01/03" → "Maria Silva"
 *      "DÉBITO AUTOMÁTICO TRINKS" → "Trinks"
 */
function extractCleanDescription(raw: string): string {
  let desc = raw.trim();

  // Remove trailing date-like references (e.g. "ROD28/02", "28/02", "SIL01/03")
  desc = desc.replace(/\s*[A-Z]{0,4}\d{2}\/\d{2}\s*$/i, "").trim();

  // Common bank prefixes to remove
  const prefixes = [
    /^PIX\s+(QRS|QRSO|REC|RECEB|ENV|ENVI|TRANSF?)\s*/i,
    /^PIX\s+/i,
    /^TED\s+/i,
    /^DOC\s+/i,
    /^TRANSF(ERENCIA)?\s*/i,
    /^DEB\.?\s*AUT\.?\s*/i,
    /^DÉBITO\s+AUTOMÁTICO\s*/i,
    /^DEBITO\s+AUTOMATICO\s*/i,
    /^PAG\s+/i,
    /^PGTO\s+/i,
    /^COMPRA\s+(VISA|MASTER|ELO|CARTAO)?\s*/i,
  ];
  for (const re of prefixes) {
    desc = desc.replace(re, "").trim();
  }

  if (!desc) return raw.trim();

  // Title case: "RODRIGO" → "Rodrigo", "MARIA SILVA" → "Maria Silva"
  return desc
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function parseBankStatement(text: string): Partial<FinanceEntry>[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const results: Partial<FinanceEntry>[] = [];
  const currentYear = new Date().getFullYear();
  const today = getTodayStr();

  for (const line of lines) {
    // Split by tab — bank statements often use tab-separated columns
    const parts = line.split("\t").map(p => p.trim()).filter(Boolean);

    let date = today;
    let description = "";
    let amountRaw = "";

    // ── Format A: Tab-separated (DD/mmm\tDESCRIPTION\tVALUE) ──
    if (parts.length >= 2) {
      const dateStr = parts[0];

      // Try DD/mmm (month abbreviated in Portuguese)
      const abbrMatch = dateStr.match(/^(\d{1,2})\/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)$/i);
      // Also try DD/MM or DD/MM/YYYY
      const numMatch = dateStr.match(/^(\d{1,2})\/(\d{2})(?:\/(\d{2,4}))?$/);

      if (abbrMatch) {
        const day = abbrMatch[1].padStart(2, "0");
        const monthNum = MONTH_MAP[abbrMatch[2].toLowerCase()];
        date = `${currentYear}-${monthNum}-${day}`;
      } else if (numMatch) {
        const day = numMatch[1].padStart(2, "0");
        const month = numMatch[2];
        let year = numMatch[3] ? (numMatch[3].length === 2 ? "20" + numMatch[3] : numMatch[3]) : String(currentYear);
        date = `${year}-${month}-${day}`;
      }

      if (parts.length >= 3) {
        description = parts.slice(1, -1).join(" ");
        amountRaw = parts[parts.length - 1];
      } else {
        const lastAsNum = parts[1].replace(/\./g, "").replace(",", ".").replace(/^[-+R$\s]+/, "");
        if (/^\d+\.?\d*$/.test(lastAsNum)) {
          description = dateStr;
          amountRaw = parts[1];
        } else {
          description = parts[1];
        }
      }
    }

    // ── Format B: Fallback — no tabs, space-separated ──
    if (parts.length < 2 || !amountRaw) {
      const abbrMatchLine = line.match(/^(\d{1,2})\/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i);
      const numMatchLine = line.match(/^(\d{1,2})\/(\d{2})(?:\/(\d{2,4}))?\b/);
      let rest = line;

      if (abbrMatchLine) {
        const day = abbrMatchLine[1].padStart(2, "0");
        const monthNum = MONTH_MAP[abbrMatchLine[2].toLowerCase()];
        date = `${currentYear}-${monthNum}-${day}`;
        rest = line.slice(abbrMatchLine[0].length).trim();
      } else if (numMatchLine) {
        const day = numMatchLine[1].padStart(2, "0");
        const month = numMatchLine[2];
        let year = numMatchLine[3] ? (numMatchLine[3].length === 2 ? "20" + numMatchLine[3] : numMatchLine[3]) : String(currentYear);
        date = `${year}-${month}-${day}`;
        rest = line.slice(numMatchLine[0].length).trim();
      }

      const valMatch = rest.match(/[-+]?R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*$/);
      if (valMatch) {
        amountRaw = valMatch[0];
        description = rest.slice(0, rest.length - valMatch[0].length).trim();
      } else {
        description = rest;
      }
    }

    // ── Parse amount ──
    if (!amountRaw) continue;
    const isNegativeSign = amountRaw.includes("-");
    const cleanAmt = amountRaw.replace(/[R$\s+]/g, "").replace(/\./g, "").replace(",", ".").replace(/^-/, "");
    let amount = parseFloat(cleanAmt);
    if (isNaN(amount) || amount === 0) continue;
    if (isNegativeSign) amount = -amount;

    // ── Determine income vs expense ──
    const lowerLine = line.toLowerCase();
    const isExpense =
      isNegativeSign ||
      lowerLine.includes("pagamento") ||
      lowerLine.includes("deb. aut") ||
      lowerLine.includes("débito automático") ||
      lowerLine.includes("debito automatico") ||
      lowerLine.includes("compra") ||
      lowerLine.includes("tarifa") ||
      lowerLine.includes("taxa");

    const isIncome =
      !isExpense &&
      (
        lowerLine.includes("pix") ||
        lowerLine.includes("recebido") ||
        lowerLine.includes("crédito") ||
        lowerLine.includes("deposito") ||
        lowerLine.includes("depósito") ||
        lowerLine.includes("ted")
      );

    const finalAmount = isExpense ? -Math.abs(amount) : Math.abs(amount);

    // ── Clean description ──
    const cleanDesc = extractCleanDescription(description) || "Lançamento importado";

    // ── Guess category ──
    let category: FinanceEntry["category"] = finalAmount >= 0 ? "receita" : "variavel";
    if (
      lowerLine.includes("parcela") ||
      lowerLine.includes("cartão") ||
      lowerLine.includes("cartao")
    ) {
      category = "parcelamento";
    } else if (
      lowerLine.includes("aluguel") ||
      lowerLine.includes("cloudia") ||
      lowerLine.includes("trinks") ||
      lowerLine.includes("instagram")
    ) {
      category = "fixo";
    }

    results.push({
      date,
      description: cleanDesc,
      amount: finalAmount,
      category,
      subcategory: "",
      recurrent: category === "fixo",
    });
  }

  return results;
}

// ─── AI Analysis Renderer ──────────────────────────────────────
function AIAnalysisCard({ text }: { text: string }) {
  const sections = text.split(/(?=##\s)/);

  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const lines = section.trim().split("\n");
        const headingLine = lines[0];
        const isHeading = headingLine.startsWith("##");
        const heading = isHeading ? headingLine.replace(/^#+\s*/, "") : null;
        const body = isHeading ? lines.slice(1).join("\n").trim() : section.trim();

        if (!body && !heading) return null;

        return (
          <div key={i} className="space-y-2">
            {heading && (
              <h4 className="text-sm font-semibold text-[#01696F] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#01696F] inline-block" />
                {heading}
              </h4>
            )}
            {body && (
              <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap pl-3 border-l border-border">
                {body.split("\n").map((line, j) => {
                  const trimmed = line.trim();
                  if (!trimmed) return <div key={j} className="h-2" />;
                  if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
                    return (
                      <div key={j} className="flex items-start gap-2 py-0.5">
                        <span className="text-[#01696F] mt-1 flex-shrink-0">•</span>
                        <span>{trimmed.slice(2)}</span>
                      </div>
                    );
                  }
                  return <p key={j} className="py-0.5">{trimmed}</p>;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────
export default function Financeiro() {
  const { toast } = useToast();
  const qClient = useQueryClient();

  // ─── Active view ───────────────────────────────────────────
  const [activeView, setActiveView] = useState<"extrato" | "lancamentos">("extrato");

  // ─── Query ─────────────────────────────────────────────────
  const { data: entries = [], isLoading } = useQuery<FinanceEntry[]>({
    queryKey: ["/api/financeiro"],
  });

  // ─── Local form state ───────────────────────────────────────
  const [formDate, setFormDate] = useState(getTodayStr());
  const [formDesc, setFormDesc] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState<FinanceEntry["category"]>("variavel");
  const [formSubcategory, setFormSubcategory] = useState("");
  const [formRecurrent, setFormRecurrent] = useState(false);

  // ─── Paste textarea state ───────────────────────────────────
  const [pasteText, setPasteText] = useState("");
  const [parsedPreview, setParsedPreview] = useState<Partial<FinanceEntry>[]>([]);
  const [showPasteArea, setShowPasteArea] = useState(false);

  // ─── Filter tab ─────────────────────────────────────────────
  const [filterTab, setFilterTab] = useState("todos");

  // ─── AI Analysis state ──────────────────────────────────────
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // ─── Mutations ──────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: async (entry: Omit<FinanceEntry, "id" | "createdAt">) => {
      const res = await apiRequest("POST", "/api/financeiro", entry);
      return res.json();
    },
    onSuccess: () => {
      qClient.invalidateQueries({ queryKey: ["/api/financeiro"] });
      toast({ description: "Lançamento adicionado com sucesso." });
      setFormDesc("");
      setFormAmount("");
      setFormSubcategory("");
      setFormRecurrent(false);
    },
    onError: (err: any) => {
      toast({ description: err.message || "Erro ao adicionar lançamento.", variant: "destructive" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async (entries: Omit<FinanceEntry, "id" | "createdAt">[]) => {
      const res = await apiRequest("POST", "/api/financeiro/bulk", { entries });
      return res.json();
    },
    onSuccess: (data) => {
      qClient.invalidateQueries({ queryKey: ["/api/financeiro"] });
      toast({ description: `${data.added} lançamentos importados com sucesso.` });
      setPasteText("");
      setParsedPreview([]);
      setShowPasteArea(false);
    },
    onError: (err: any) => {
      toast({ description: err.message || "Erro ao importar lançamentos.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/financeiro/${id}`);
      return res.json();
    },
    onSuccess: () => {
      qClient.invalidateQueries({ queryKey: ["/api/financeiro"] });
      toast({ description: "Lançamento removido." });
    },
    onError: (err: any) => {
      toast({ description: err.message || "Erro ao remover lançamento.", variant: "destructive" });
    },
  });

  // ─── Consolidated Analysis (EXTRATO BANCÁRIO) ──────────────
  const analysis = useMemo(() => {
    const receitas = entries.filter(e => e.amount > 0);
    const despesas = entries.filter(e => e.amount < 0);

    const totalReceitas = receitas.reduce((s, e) => s + e.amount, 0);
    const totalDespesas = despesas.reduce((s, e) => s + Math.abs(e.amount), 0);
    const saldo = totalReceitas - totalDespesas;
    const margemLucro = totalReceitas > 0 ? ((saldo / totalReceitas) * 100) : 0;

    // ── Despesas por categoria ──
    const fixos = entries.filter(e => e.category === "fixo").reduce((s, e) => s + Math.abs(e.amount), 0);
    const variaveis = entries.filter(e => e.category === "variavel" || e.category === "parcelamento")
      .reduce((s, e) => s + Math.abs(e.amount), 0);
    const investimentos = entries.filter(e => e.category === "investimento").reduce((s, e) => s + Math.abs(e.amount), 0);

    // ── Evolução diária (acumulado) ──
    const byDay: Record<string, { receita: number; despesa: number }> = {};
    entries.forEach(e => {
      const day = e.date.slice(8, 10);
      if (!byDay[day]) byDay[day] = { receita: 0, despesa: 0 };
      if (e.amount > 0) byDay[day].receita += e.amount;
      else byDay[day].despesa += Math.abs(e.amount);
    });

    const dailyData = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, val]) => ({ dia: day, receita: val.receita, despesa: val.despesa }));

    // Acumulado
    let accReceita = 0, accDespesa = 0;
    const dailyCumulative = dailyData.map(d => {
      accReceita += d.receita;
      accDespesa += d.despesa;
      return { dia: d.dia, receita: accReceita, despesa: accDespesa, saldo: accReceita - accDespesa };
    });

    // ── Top receitas (por pessoa/descrição) ──
    const topReceitasMap: Record<string, number> = {};
    receitas.forEach(e => {
      topReceitasMap[e.description] = (topReceitasMap[e.description] || 0) + e.amount;
    });
    const topReceitas = Object.entries(topReceitasMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    // ── Top despesas ──
    const topDespesasMap: Record<string, number> = {};
    despesas.forEach(e => {
      topDespesasMap[e.description] = (topDespesasMap[e.description] || 0) + Math.abs(e.amount);
    });
    const topDespesas = Object.entries(topDespesasMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    // ── Pie by category ──
    const pieByCategory = [
      { name: "Fixos", value: fixos, color: "#ef4444" },
      { name: "Variáveis", value: variaveis, color: "#f97316" },
      { name: "Investimentos", value: investimentos, color: "#3b82f6" },
    ].filter(d => d.value > 0);

    // ── Qtd lançamentos ──
    const totalLancamentos = entries.length;
    const diasComMovimento = Object.keys(byDay).length;
    const mediaReceitaDia = diasComMovimento > 0 ? totalReceitas / diasComMovimento : 0;

    return {
      totalReceitas,
      totalDespesas,
      saldo,
      margemLucro,
      fixos,
      variaveis,
      investimentos,
      dailyCumulative,
      dailyData,
      topReceitas,
      topDespesas,
      pieByCategory,
      totalLancamentos,
      diasComMovimento,
      mediaReceitaDia,
    };
  }, [entries]);

  // ─── Filtered entries ────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    if (filterTab === "todos") return entries;
    if (filterTab === "receitas") return entries.filter(e => e.category === "receita" || e.amount > 0);
    return entries.filter(e => e.category === filterTab);
  }, [entries, filterTab]);

  const filteredTotal = useMemo(() => {
    return filteredEntries.reduce((s, e) => s + e.amount, 0);
  }, [filteredEntries]);

  // ─── Handlers ───────────────────────────────────────────────
  function handleAddEntry() {
    const amountRaw = formAmount.replace(",", ".").replace(/[^\d.-]/g, "");
    const amount = parseFloat(amountRaw);
    if (!formDesc || isNaN(amount)) {
      toast({ description: "Preencha descrição e valor.", variant: "destructive" });
      return;
    }
    addMutation.mutate({
      date: formDate,
      description: formDesc,
      amount,
      category: formCategory,
      subcategory: formSubcategory,
      recurrent: formRecurrent,
    });
  }

  function handleQuickAdd(item: typeof QUICK_FIXED_COSTS[0]) {
    addMutation.mutate({
      date: getTodayStr(),
      description: item.label,
      amount: item.amount,
      category: item.category,
      subcategory: item.subcategory,
      recurrent: true,
    });
  }

  function handleParsePaste() {
    const parsed = parseBankStatement(pasteText);
    setParsedPreview(parsed);
    if (parsed.length === 0) {
      toast({ description: "Nenhuma linha reconhecida. Verifique o formato do extrato.", variant: "destructive" });
    }
  }

  function handleImportParsed() {
    if (parsedPreview.length === 0) return;
    const complete = parsedPreview.filter(
      e => e.date && e.description && e.amount !== undefined && e.category
    ) as Omit<FinanceEntry, "id" | "createdAt">[];
    bulkMutation.mutate(complete);
  }

  async function handleAIAnalysis() {
    setAiLoading(true);
    setAiError(null);
    setShowAnalysis(true);
    try {
      const res = await apiRequest("POST", "/api/financeiro/analyze");
      const data = await res.json();
      setAiAnalysis(data.analysis);
    } catch (err: any) {
      const msg = err.message?.includes(":") ? err.message.split(":").slice(1).join(":").trim() : err.message;
      setAiError(msg || "Erro ao processar análise com IA.");
    } finally {
      setAiLoading(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────
  const currentMonth = new Date().toLocaleString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header with view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold capitalize">
            Financeiro — {currentMonth}
          </h2>
          <p className="text-sm text-muted-foreground">
            Extrato bancário, fechamento e análise financeira
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={activeView === "extrato" ? "default" : "outline"}
            size="sm"
            className={activeView === "extrato"
              ? "bg-[#01696F] hover:bg-[#015a5f] text-white h-8 text-xs"
              : "h-8 text-xs border-border"}
            onClick={() => setActiveView("extrato")}
            data-testid="btn-view-extrato"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
            Fechamento
          </Button>
          <Button
            variant={activeView === "lancamentos" ? "default" : "outline"}
            size="sm"
            className={activeView === "lancamentos"
              ? "bg-[#01696F] hover:bg-[#015a5f] text-white h-8 text-xs"
              : "h-8 text-xs border-border"}
            onClick={() => setActiveView("lancamentos")}
            data-testid="btn-view-lancamentos"
          >
            <Receipt className="w-3.5 h-3.5 mr-1.5" />
            Lançamentos
          </Button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ VIEW: FECHAMENTO (EXTRATO BANCÁRIO) ═══════════════ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {activeView === "extrato" && (
        <>
          {/* ─── KPI Cards — Consolidado do Extrato ───────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-card border-card-border" data-testid="kpi-receitas-extrato">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">Entradas (Receita)</p>
                  <ArrowUpRight className="w-4 h-4 text-green-500" />
                </div>
                <p className="text-xl font-bold text-green-500">{formatCurrency(analysis.totalReceitas)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {entries.filter(e => e.amount > 0).length} lançamentos
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border" data-testid="kpi-despesas-extrato">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">Saídas (Despesas)</p>
                  <ArrowDownRight className="w-4 h-4 text-red-400" />
                </div>
                <p className="text-xl font-bold text-red-400">{formatCurrency(analysis.totalDespesas)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {entries.filter(e => e.amount < 0).length} lançamentos
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border" data-testid="kpi-saldo-extrato">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">Saldo do Mês</p>
                  <Scale className={`w-4 h-4 ${analysis.saldo >= 0 ? "text-green-500" : "text-red-500"}`} />
                </div>
                <p className={`text-xl font-bold ${analysis.saldo >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {formatCurrency(analysis.saldo)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Margem: {analysis.margemLucro.toFixed(1)}%
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border" data-testid="kpi-media-extrato">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">Média Receita/Dia</p>
                  <CalendarDays className="w-4 h-4 text-[#01696F]" />
                </div>
                <p className="text-xl font-bold text-foreground">{formatCurrency(analysis.mediaReceitaDia)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {analysis.diasComMovimento} dias com movimento
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ─── Composição de Despesas ────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-card border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Custos Fixos</p>
                  <Wallet className="w-3.5 h-3.5 text-red-400" />
                </div>
                <p className="text-lg font-bold text-red-400">{formatCurrency(analysis.fixos)}</p>
                {analysis.totalDespesas > 0 && (
                  <div className="mt-2">
                    <div className="w-full bg-muted/30 rounded-full h-1.5">
                      <div
                        className="bg-red-400 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (analysis.fixos / analysis.totalDespesas) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {((analysis.fixos / analysis.totalDespesas) * 100).toFixed(0)}% das despesas
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Custos Variáveis + Parc.</p>
                  <TrendingDown className="w-3.5 h-3.5 text-orange-400" />
                </div>
                <p className="text-lg font-bold text-orange-400">{formatCurrency(analysis.variaveis)}</p>
                {analysis.totalDespesas > 0 && (
                  <div className="mt-2">
                    <div className="w-full bg-muted/30 rounded-full h-1.5">
                      <div
                        className="bg-orange-400 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (analysis.variaveis / analysis.totalDespesas) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {((analysis.variaveis / analysis.totalDespesas) * 100).toFixed(0)}% das despesas
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Investimentos</p>
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <p className="text-lg font-bold text-blue-400">{formatCurrency(analysis.investimentos)}</p>
                {analysis.totalDespesas > 0 && (
                  <div className="mt-2">
                    <div className="w-full bg-muted/30 rounded-full h-1.5">
                      <div
                        className="bg-blue-400 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (analysis.investimentos / analysis.totalDespesas) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {analysis.totalDespesas > 0 ? ((analysis.investimentos / analysis.totalDespesas) * 100).toFixed(0) : 0}% das despesas
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Evolução do Mês (acumulado) ──────────────────── */}
          {analysis.dailyCumulative.length > 0 && (
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Evolução Acumulada — Extrato Bancário</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analysis.dailyCumulative} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                      <defs>
                        <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradDespesa" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#888" }} />
                      <YAxis
                        tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
                        tick={{ fontSize: 10, fill: "#888" }}
                      />
                      <RechartsTooltip
                        formatter={(v: number, name: string) => [
                          formatCurrency(v),
                          name === "receita" ? "Receitas" : name === "despesa" ? "Despesas" : "Saldo",
                        ]}
                        contentStyle={{
                          backgroundColor: "#1a1a1a",
                          border: "1px solid #333",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="receita"
                        stroke="#22c55e"
                        fill="url(#gradReceita)"
                        strokeWidth={2}
                        name="receita"
                      />
                      <Area
                        type="monotone"
                        dataKey="despesa"
                        stroke="#ef4444"
                        fill="url(#gradDespesa)"
                        strokeWidth={2}
                        name="despesa"
                      />
                      <Area
                        type="monotone"
                        dataKey="saldo"
                        stroke="#01696F"
                        fill="none"
                        strokeWidth={2}
                        strokeDasharray="5 3"
                        name="saldo"
                      />
                      <Legend
                        formatter={(v: string) => (
                          <span className="text-xs text-foreground">
                            {v === "receita" ? "Receitas" : v === "despesa" ? "Despesas" : "Saldo"}
                          </span>
                        )}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── Top Receitas e Despesas ──────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Receitas */}
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="w-4 h-4 text-green-500" />
                  Top Receitas (por cliente/descrição)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analysis.topReceitas.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Sem receitas registradas</p>
                ) : (
                  <div className="space-y-2">
                    {analysis.topReceitas.map((item, i) => {
                      const maxVal = analysis.topReceitas[0]?.value || 1;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-5 text-right font-mono">{i + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-sm truncate">{item.name}</span>
                              <span className="text-sm font-medium text-green-500 ml-2 whitespace-nowrap">
                                {formatCurrency(item.value)}
                              </span>
                            </div>
                            <div className="w-full bg-muted/20 rounded-full h-1">
                              <div
                                className="bg-green-500/60 h-1 rounded-full transition-all"
                                style={{ width: `${(item.value / maxVal) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Despesas */}
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-red-400" />
                  Top Despesas (por descrição)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analysis.topDespesas.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Sem despesas registradas</p>
                ) : (
                  <div className="space-y-2">
                    {analysis.topDespesas.map((item, i) => {
                      const maxVal = analysis.topDespesas[0]?.value || 1;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-5 text-right font-mono">{i + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-sm truncate">{item.name}</span>
                              <span className="text-sm font-medium text-red-400 ml-2 whitespace-nowrap">
                                {formatCurrency(item.value)}
                              </span>
                            </div>
                            <div className="w-full bg-muted/20 rounded-full h-1">
                              <div
                                className="bg-red-400/60 h-1 rounded-full transition-all"
                                style={{ width: `${(item.value / maxVal) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Distribuição de Despesas (Pie) + Diário (Bar) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Distribuição de Despesas</CardTitle>
              </CardHeader>
              <CardContent>
                {analysis.pieByCategory.length === 0 ? (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados de despesas
                  </div>
                ) : (
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analysis.pieByCategory}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {analysis.pieByCategory.map((item, i) => (
                            <Cell key={i} fill={item.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(v: number) => formatCurrency(v)}
                          contentStyle={{
                            backgroundColor: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Legend
                          formatter={(v: string) => (
                            <span className="text-xs text-foreground">{v}</span>
                          )}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Receitas vs Despesas por Dia</CardTitle>
              </CardHeader>
              <CardContent>
                {analysis.dailyData.length === 0 ? (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados diários
                  </div>
                ) : (
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analysis.dailyData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#888" }} />
                        <YAxis
                          tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
                          tick={{ fontSize: 10, fill: "#888" }}
                        />
                        <RechartsTooltip
                          formatter={(v: number, name: string) => [
                            formatCurrency(v),
                            name === "receita" ? "Receita" : "Despesa",
                          ]}
                          contentStyle={{
                            backgroundColor: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Bar dataKey="receita" fill="#22c55e" radius={[3, 3, 0, 0]} name="receita" />
                        <Bar dataKey="despesa" fill="#ef4444" radius={[3, 3, 0, 0]} name="despesa" />
                        <Legend
                          formatter={(v: string) => (
                            <span className="text-xs text-foreground">{v === "receita" ? "Receitas" : "Despesas"}</span>
                          )}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Análise com IA ────────────────────────────────── */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#01696F]" />
                  Análise de Fechamento com IA
                </CardTitle>
                <Button
                  onClick={handleAIAnalysis}
                  disabled={aiLoading || entries.length === 0}
                  className="bg-[#01696F] hover:bg-[#015a5f] text-white h-8 text-xs"
                  data-testid="btn-ai-analyze"
                >
                  {aiLoading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      Analisando...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 mr-1" />
                      Analisar Extrato
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                A IA analisa todos os lançamentos do extrato para identificar gargalos, oportunidades e gerar recomendações.
              </p>
            </CardHeader>

            {showAnalysis && (
              <CardContent className="pt-0">
                {aiLoading && (
                  <div className="flex items-center gap-3 py-6 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin text-[#01696F]" />
                    <div>
                      <p className="text-sm">Analisando seu extrato bancário...</p>
                      <p className="text-xs opacity-60 mt-0.5">Isso pode levar alguns segundos</p>
                    </div>
                  </div>
                )}

                {aiError && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-red-400 font-medium">Erro na análise</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{aiError}</p>
                    </div>
                  </div>
                )}

                {aiAnalysis && !aiLoading && (
                  <div className="rounded-lg border border-[#01696F]/20 bg-[#01696F]/5 p-4">
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#01696F]/10">
                      <Sparkles className="w-4 h-4 text-[#01696F]" />
                      <span className="text-xs font-medium text-[#01696F]">Análise de fechamento gerada por IA</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date().toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    <AIAnalysisCard text={aiAnalysis} />
                  </div>
                )}
              </CardContent>
            )}

            {!showAnalysis && entries.length === 0 && (
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">
                  Importe seu extrato bancário para habilitar a análise de IA.
                </p>
              </CardContent>
            )}
          </Card>

          {/* ─── Resumo de Fechamento ────────────────────────── */}
          {entries.length > 0 && (
            <Card className="bg-card border-card-border border-[#01696F]/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-[#01696F]" />
                  Resumo de Fechamento do Mês
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total de Lançamentos</p>
                    <p className="text-lg font-bold">{analysis.totalLancamentos}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Dias com Movimento</p>
                    <p className="text-lg font-bold">{analysis.diasComMovimento}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Receita Bruta</p>
                    <p className="text-lg font-bold text-green-500">{formatCurrency(analysis.totalReceitas)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Resultado Líquido</p>
                    <p className={`text-lg font-bold ${analysis.saldo >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatCurrency(analysis.saldo)}
                    </p>
                  </div>
                </div>

                {/* Progress toward meta */}
                <div className="mt-4 pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Meta mensal: R$ 150.000,00</span>
                    <span className="text-xs font-medium text-[#01696F]">
                      {((analysis.totalReceitas / 150000) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted/30 rounded-full h-2">
                    <div
                      className="bg-[#01696F] h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (analysis.totalReceitas / 150000) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Faltam {formatCurrency(Math.max(0, 150000 - analysis.totalReceitas))} para atingir a meta
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ VIEW: LANÇAMENTOS (IMPORTAR + LISTA) ═════════════ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {activeView === "lancamentos" && (
        <>
          {/* ─── Lançar Extrato ─────────────────────────────────── */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#01696F]" />
                Importar Extrato Bancário
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Cole o extrato direto do app do banco. O sistema reconhece datas, nomes e valores automaticamente.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Paste bank statement — always visible */}
              <div className="space-y-3">
                <Textarea
                  placeholder={`Cole o extrato bancário aqui (copie direto do app do banco).\nFormatos reconhecidos:\n02/mar\tPIX QRS RODRIGO ROD28/02\t75,00\n19/03\tDÉBITO AUTOMÁTICO TRINKS\t89,90\n20/03/2026 Aluguel -R$ 3.500,00`}
                  value={pasteText}
                  onChange={e => {
                    setPasteText(e.target.value);
                    setParsedPreview([]);
                  }}
                  rows={6}
                  className="text-sm bg-background font-mono"
                  data-testid="textarea-paste"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleParsePaste}
                    disabled={!pasteText.trim()}
                    data-testid="btn-parse-paste"
                  >
                    Interpretar extrato
                  </Button>
                  {parsedPreview.length > 0 && (
                    <Button
                      size="sm"
                      className="bg-[#01696F] hover:bg-[#015a5f] text-white"
                      onClick={handleImportParsed}
                      disabled={bulkMutation.isPending}
                      data-testid="btn-import-parsed"
                    >
                      {bulkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Importar {parsedPreview.length} lançamentos
                    </Button>
                  )}
                </div>

                {parsedPreview.length > 0 && (
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/20">
                        <tr>
                          <th className="text-left p-2 text-muted-foreground">Data</th>
                          <th className="text-left p-2 text-muted-foreground">Descrição</th>
                          <th className="text-left p-2 text-muted-foreground">Categoria</th>
                          <th className="text-right p-2 text-muted-foreground">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedPreview.map((e, i) => (
                          <tr key={i} className="border-t border-border/50">
                            <td className="p-2 font-mono">{e.date}</td>
                            <td className="p-2 max-w-[200px] truncate">{e.description}</td>
                            <td className="p-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] border ${CATEGORY_COLORS[e.category || "variavel"]}`}>
                                {CATEGORY_LABELS[e.category || "variavel"]}
                              </span>
                            </td>
                            <td className={`p-2 text-right font-medium ${(e.amount || 0) >= 0 ? "text-green-500" : "text-red-400"}`}>
                              {formatCurrency(e.amount || 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ─── Lançamento Manual ──────────────────────────────── */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#01696F]" />
                Lançamento Manual
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Quick add fixed costs */}
              <div className="flex flex-wrap gap-2">
                <p className="text-xs text-muted-foreground self-center mr-1">Adicionar fixo:</p>
                {QUICK_FIXED_COSTS.map(item => (
                  <Button
                    key={item.label}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-border hover:border-[#01696F] hover:text-[#01696F]"
                    onClick={() => handleQuickAdd(item)}
                    disabled={addMutation.isPending}
                    data-testid={`btn-quick-${item.label.toLowerCase()}`}
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    {item.label} ({formatCurrency(Math.abs(item.amount))})
                  </Button>
                ))}
              </div>

              {/* Manual entry form */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input
                    type="date"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    className="h-8 text-sm bg-background"
                    data-testid="input-date"
                  />
                </div>

                <div className="space-y-1 col-span-2 sm:col-span-1 lg:col-span-2">
                  <Label className="text-xs">Descrição</Label>
                  <Input
                    placeholder="Ex: Compra material..."
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    className="h-8 text-sm bg-background"
                    data-testid="input-description"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input
                    placeholder="-150,00"
                    value={formAmount}
                    onChange={e => setFormAmount(e.target.value)}
                    className="h-8 text-sm bg-background"
                    data-testid="input-amount"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Categoria</Label>
                  <Select value={formCategory} onValueChange={v => setFormCategory(v as FinanceEntry["category"])}>
                    <SelectTrigger className="h-8 text-sm bg-background" data-testid="select-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receita">Receita</SelectItem>
                      <SelectItem value="fixo">Fixo</SelectItem>
                      <SelectItem value="variavel">Variável</SelectItem>
                      <SelectItem value="parcelamento">Parcelamento</SelectItem>
                      <SelectItem value="investimento">Investimento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Subcategoria</Label>
                  <Input
                    placeholder="Aluguel, Trinks..."
                    value={formSubcategory}
                    onChange={e => setFormSubcategory(e.target.value)}
                    className="h-8 text-sm bg-background"
                    data-testid="input-subcategory"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formRecurrent}
                    onChange={e => setFormRecurrent(e.target.checked)}
                    className="rounded"
                    data-testid="checkbox-recurrent"
                  />
                  Custo recorrente
                </label>

                <Button
                  onClick={handleAddEntry}
                  disabled={addMutation.isPending}
                  className="bg-[#01696F] hover:bg-[#015a5f] text-white h-8 text-sm ml-auto"
                  data-testid="btn-add-entry"
                >
                  {addMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                  Adicionar
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ─── Extrato do Mês (tabela) ───────────────────────── */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Extrato do Mês</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Filter tabs */}
              <div className="px-4 pb-3">
                <Tabs value={filterTab} onValueChange={setFilterTab}>
                  <TabsList className="h-8 bg-muted/30">
                    <TabsTrigger value="todos" className="text-xs h-6 px-3" data-testid="tab-todos">Todos</TabsTrigger>
                    <TabsTrigger value="fixo" className="text-xs h-6 px-3" data-testid="tab-fixo">Fixos</TabsTrigger>
                    <TabsTrigger value="variavel" className="text-xs h-6 px-3" data-testid="tab-variavel">Variáveis</TabsTrigger>
                    <TabsTrigger value="parcelamento" className="text-xs h-6 px-3" data-testid="tab-parcelamento">Parcelamentos</TabsTrigger>
                    <TabsTrigger value="receitas" className="text-xs h-6 px-3" data-testid="tab-receitas">Receitas</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Carregando lançamentos...</span>
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Wallet className="w-8 h-8 opacity-30" />
                  <p className="text-sm">Nenhum lançamento encontrado</p>
                  <p className="text-xs opacity-60">Importe seu extrato bancário acima</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 text-xs text-muted-foreground font-medium">Data</th>
                        <th className="text-left p-3 text-xs text-muted-foreground font-medium">Descrição</th>
                        <th className="text-left p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">Subcategoria</th>
                        <th className="text-left p-3 text-xs text-muted-foreground font-medium">Categoria</th>
                        <th className="text-right p-3 text-xs text-muted-foreground font-medium">Valor</th>
                        <th className="p-3 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map(entry => (
                        <tr
                          key={entry.id}
                          className="border-b border-border/40 hover:bg-muted/10 transition-colors"
                          data-testid={`row-entry-${entry.id}`}
                        >
                          <td className="p-3 text-xs text-muted-foreground font-mono whitespace-nowrap">
                            {entry.date.slice(8, 10)}/{entry.date.slice(5, 7)}
                          </td>
                          <td className="p-3 max-w-[180px]">
                            <span className="truncate block">{entry.description}</span>
                            {entry.recurrent && (
                              <span className="text-[10px] text-[#01696F] opacity-70">↻ recorrente</span>
                            )}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground hidden sm:table-cell">
                            {entry.subcategory || "—"}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 h-5 ${CATEGORY_COLORS[entry.category]}`}
                              data-testid={`badge-category-${entry.id}`}
                            >
                              {CATEGORY_LABELS[entry.category]}
                            </Badge>
                          </td>
                          <td className={`p-3 text-right font-medium whitespace-nowrap ${entry.amount >= 0 ? "text-green-500" : "text-red-400"}`}>
                            {formatCurrency(entry.amount)}
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => deleteMutation.mutate(entry.id)}
                              disabled={deleteMutation.isPending}
                              className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded"
                              data-testid={`btn-delete-${entry.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/20 border-t border-border">
                        <td colSpan={4} className="p-3 text-xs font-semibold text-muted-foreground">
                          Total ({filteredEntries.length} lançamentos)
                        </td>
                        <td className={`p-3 text-right font-bold ${filteredTotal >= 0 ? "text-green-500" : "text-red-400"}`}>
                          {formatCurrency(filteredTotal)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
