import { useMemo, useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import {
  useTrinksStore,
  getTrinksMonthTotals,
  getTrindsDailyRevenueChart,
  getTrinksBarberRanking,
  getTrinksPaymentMethodData,
  getTrinksRevenueSummary,
  getTrinksRevenueByRange,
  formatLastSync,
} from "@/lib/trinksStore";
import {
  getMonthTotals,
  getDailyRevenueChartData,
  formatCurrency,
  formatPercent,
  getBarberRankingData,
  getPaymentMethodData,
  getRevenueSummary,
  getRevenueByRange,
} from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TrendingUp,
  Users,
  BarChart3,
  CalendarCheck,
  ArrowUp,
  ArrowDown,
  Info,
  RefreshCw,
  Clock,
  Calendar,
  CalendarDays,
  CalendarRange,
  Filter,
  Target,
  CheckCircle2,
  AlertTriangle,
  CalendarPlus,
  Send,
  Bell,
  Package,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { Link } from "wouter";
import DashboardImportSummaryCard from "@/components/dashboard/DashboardImportSummaryCard";
import DashboardApiSummaryCard from "@/components/dashboard/DashboardApiSummaryCard";
import { FonteBadge } from "@/components/dashboard/FonteBadge";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Helpers de mês em SP (timezone America/Sao_Paulo)
function mesAtualSP(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  });
  return fmt.format(new Date()).slice(0, 7); // YYYY-MM
}
function mesAdjacente(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function labelMesPtBR(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const txt = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

interface KPICardProps {
  title: string;
  value: string;
  trend: number;
  icon: React.ReactNode;
  prefix?: string;
}

function KPICard({ title, value, trend, icon }: KPICardProps) {
  const isPositive = trend >= 0;
  return (
    <Card className="bg-card border-card-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {title}
            </p>
            <p
              className="text-xl font-bold mt-1 truncate"
              data-testid={`kpi-${title.toLowerCase().replace(/\s/g, "-")}`}
            >
              {value}
            </p>
            <div className="flex items-center gap-1 mt-1">
              {isPositive ? (
                <ArrowUp className="w-3 h-3 text-green-500" />
              ) : (
                <ArrowDown className="w-3 h-3 text-red-500" />
              )}
              <span
                className={`text-xs font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}
              >
                {isPositive ? "+" : ""}
                {trend}%
              </span>
              <span className="text-xs text-muted-foreground">
                vs mês anterior
              </span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FecharDiaDialog() {
  const { addEntry } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    clients: "",
    revenue: "",
    pix: "",
    cartao: "",
    dinheiro: "",
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(form.revenue) || 0;
    const entry = {
      id: `rev-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "receita" as const,
      description: "Fechamento do dia",
      amount: total,
      clients: Number(form.clients) || 0,
      pix: Number(form.pix) || 0,
      cartao: Number(form.cartao) || 0,
      dinheiro: Number(form.dinheiro) || 0,
      notes: form.notes,
    };
    addEntry(entry);
    setOpen(false);
    setForm({
      clients: "",
      revenue: "",
      pix: "",
      cartao: "",
      dinheiro: "",
      notes: "",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="bg-primary hover:bg-primary/80 text-white"
          data-testid="fechar-dia-btn"
        >
          <CalendarCheck className="w-4 h-4 mr-2" />
          Fechar o Dia
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader>
          <DialogTitle>Fechar o Dia</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Total de Clientes</Label>
              <Input
                type="number"
                value={form.clients}
                onChange={(e) =>
                  setForm((p) => ({ ...p, clients: e.target.value }))
                }
                placeholder="0"
                data-testid="input-clients"
              />
            </div>
            <div>
              <Label className="text-xs">Faturamento Total (R$)</Label>
              <Input
                type="number"
                value={form.revenue}
                onChange={(e) =>
                  setForm((p) => ({ ...p, revenue: e.target.value }))
                }
                placeholder="0,00"
                data-testid="input-revenue"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Pix (R$)</Label>
              <Input
                type="number"
                value={form.pix}
                onChange={(e) =>
                  setForm((p) => ({ ...p, pix: e.target.value }))
                }
                placeholder="0"
                data-testid="input-pix"
              />
            </div>
            <div>
              <Label className="text-xs">Cartão (R$)</Label>
              <Input
                type="number"
                value={form.cartao}
                onChange={(e) =>
                  setForm((p) => ({ ...p, cartao: e.target.value }))
                }
                placeholder="0"
                data-testid="input-cartao"
              />
            </div>
            <div>
              <Label className="text-xs">Dinheiro (R$)</Label>
              <Input
                type="number"
                value={form.dinheiro}
                onChange={(e) =>
                  setForm((p) => ({ ...p, dinheiro: e.target.value }))
                }
                placeholder="0"
                data-testid="input-dinheiro"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={form.notes}
              onChange={(e) =>
                setForm((p) => ({ ...p, notes: e.target.value }))
              }
              placeholder="Notas sobre o dia..."
              rows={2}
              data-testid="input-notes"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/80 text-white"
            data-testid="submit-fechar-dia"
          >
            Salvar Fechamento
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">Dia {label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium" style={{ color: p.color }}>
          {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

function DemoBanner() {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500"
      data-testid="demo-banner"
    >
      <Info className="w-4 h-4 flex-shrink-0" />
      <p className="text-xs">
        Dados de demonstração —{" "}
        <Link
          href="/configuracoes"
          className="underline hover:text-amber-400"
        >
          conecte a Trinks nas Configurações
        </Link>
      </p>
    </div>
  );
}

function SyncBanner({
  lastSync,
  isSyncing,
  onSync,
}: {
  lastSync: string;
  isSyncing: boolean;
  onSync: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20"
      data-testid="sync-banner"
    >
      <Clock className="w-4 h-4 text-primary flex-shrink-0" />
      <p className="text-xs text-primary flex-1">
        Dados Trinks — Última sincronização: {formatLastSync(lastSync)}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-primary hover:bg-primary/10"
        onClick={onSync}
        disabled={isSyncing}
      >
        <RefreshCw
          className={`w-3 h-3 mr-1 ${isSyncing ? "animate-spin" : ""}`}
        />
        <span className="text-[10px]">Atualizar</span>
      </Button>
    </div>
  );
}

interface HojeData {
  data: string;
  total: number;
  count: number;
  breakdown: { pix: number; cartao: number; dinheiro: number; outros: number };
  comandas: { id: string; hora: string; cliente: string; profissional: string; total: number; meios: string[] }[];
  fetchedAt: string;
  fromCache?: boolean;
}

interface HojeCompletoData {
  data: string;
  horaAgora: string;
  previsto: number;
  fechado: number;
  restante: number;
  totalEsperado: number;
  breakdown: { pix: number; cartao: number; dinheiro: number; outros: number };
  agendamentosCount: number;
  agendamentosRestantesCount: number;
  agendamentosJaPassaramCount: number;
  comandasCount: number;
  metaDiaria: number;
  atingeMeta: boolean;
  falta: number;
  progressoPct: number;
  progressoFechadoPct: number;
  porProfissional: {
    nome: string;
    previsto: number;
    fechado: number;
    countPrevisto: number;
    countFechado: number;
    total: number;
  }[];
  agendamentos: {
    id: string | number;
    hora: string;
    cliente: string;
    profissional: string;
    servico: string;
    valor: number;
    status: string;
  }[];
  comandas: {
    id: string | number;
    hora: string;
    cliente: string;
    profissional: string;
    total: number;
    meios: string[];
  }[];
  fetchedAt: string;
  fromCache?: boolean;
  // v34: fonte dos dados — pra UI mostrar badge embaixo dos cards
  fonteAgendamentos?: "csv" | "trinks-api";
  fonteTransacoes?: "trinks-api";
  transacoesOk?: boolean;
  transacoesPendente?: boolean; // v35: API rodando em background
  csvGeradoEm?: string | null;
}

interface AmanhaData {
  data: string;              // YYYY-MM-DD
  proxDiaUtil: boolean;      // true quando pulou fim de semana/folga
  total: number;             // faturamento previsto
  count: number;             // número de agendamentos válidos
  metaDiaria: number;
  atingeMeta: boolean;
  falta: number;
  progressoPct: number;
  porProfissional: { nome: string; total: number; count: number }[];
  agendamentos: {
    id: string | number;
    hora: string;
    cliente: string;
    profissional: string;
    servico: string;
    valor: number;
    status: string;
  }[];
  fetchedAt: string;
  fromCache?: boolean;
  // v34: fonte (CSV ou API Trinks)
  fonteAgendamentos?: "csv" | "trinks-api";
  csvGeradoEm?: string | null;
}

// Otimização E: throttle module-level entre montagens do Dashboard.
// Evita refazer fetches dos endpoints leves /trinks/hoje, /hoje-completo, /amanha
// quando o usuário navega para outra aba e volta em poucos minutos.
// O backend já cacheia esses endpoints, mas isso elimina até a ida ao backend.
const DASH_FETCH_THROTTLE_MS = 60 * 1000; // 60s — reduzido de 3min pra dado mais fresco
const dashFetchCache: Record<string, { payload: any; ts: number }> = {};
// v34: helper pra invalidar todo o cache do Dashboard (usado pelo botão Atualizar)
function invalidateDashFetchCache() {
  for (const k of Object.keys(dashFetchCache)) delete dashFetchCache[k];
}

// v34: Badge pequeno que mostra de onde veio o dado de um card.
// CSV = dado importado do email da Trinks (auditável, exato, confiável)
// trinks-api = dado vindo da API ao vivo (pode estar em 429)
// indisponivel = API falhou e CSV não cobre — dado provavelmente desatualizado
function FonteSourceBadge({
  fonte,
  csvGeradoEm,
  titulo,
}: {
  fonte?: "csv" | "trinks-api" | "indisponivel" | "carregando";
  csvGeradoEm?: string | null;
  titulo?: string;
}) {
  if (!fonte) return null;
  if (fonte === "carregando") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] mt-1 px-1 py-0.5 rounded border border-cyan-500/40 text-cyan-300 bg-cyan-500/10"
        title={titulo || "Carregando da Trinks em background…"}
      >
        <span className="inline-block w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
        🔄 Carregando…
      </span>
    );
  }
  if (fonte === "csv") {
    const tip = csvGeradoEm
      ? `Dado importado do CSV da Trinks por email. Última atualização: ${new Date(csvGeradoEm).toLocaleString("pt-BR")}`
      : "Dado importado do CSV da Trinks por email";
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] mt-1 px-1 py-0.5 rounded border border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
        title={tip}
      >
        📋 CSV
      </span>
    );
  }
  if (fonte === "trinks-api") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] mt-1 px-1 py-0.5 rounded border border-blue-500/40 text-blue-300 bg-blue-500/10"
        title={titulo || "Dado vindo da API Trinks ao vivo"}
      >
        🔄 Trinks API
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] mt-1 px-1 py-0.5 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10"
      title={titulo || "API Trinks indisponível neste momento"}
    >
      ⚠️ API offline
    </span>
  );
}

export default function Dashboard() {
  const { isConnected, trinks, lastSync, isSyncing, syncData } =
    useTrinksStore();
  // v35: também considera CSV importado por email como fonte válida de dados.
  // Se Trinks API está em 429 mas o CSV foi sincronizado nas últimas 24h,
  // o Dashboard usa o CSV — sai do modo demo.
  const [csvFresh, setCsvFresh] = useState<boolean>(false);
  useEffect(() => {
    let cancel = false;
    fetch("/api/trinks-csv/agendamentos/status")
      .then(r => r.json())
      .then(d => { if (!cancel && d?.importado && d?.ageFresco) setCsvFresh(true); })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);
  const hasTrinksData = (isConnected && trinks !== null) || csvFresh;

  // "Hoje" em tempo-quase-real (1 chamada leve à API, cacheada 3 min)
  const [hoje, setHoje] = useState<HojeData | null>(
    (dashFetchCache["hoje"]?.payload as HojeData) || null
  );
  const [hojeLoading, setHojeLoading] = useState(false);
  const API_BASE = (globalThis as any).__API_BASE__ || "";

  const loadHoje = useCallback(async () => {
    if (!isConnected) return;
    const cached = dashFetchCache["hoje"];
    if (cached && Date.now() - cached.ts < DASH_FETCH_THROTTLE_MS) {
      setHoje(cached.payload);
      return;
    }
    setHojeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trinks/hoje`);
      if (res.ok) {
        const data = await res.json();
        setHoje(data);
        dashFetchCache["hoje"] = { payload: data, ts: Date.now() };
      }
    } catch {}
    setHojeLoading(false);
  }, [isConnected, API_BASE]);

  useEffect(() => { loadHoje(); }, [loadHoje]);

  // Hoje completo (previsto + fechado + restante)
  const [hojeCompleto, setHojeCompleto] = useState<HojeCompletoData | null>(
    (dashFetchCache["hoje-completo"]?.payload as HojeCompletoData) || null
  );
  const [hojeCompletoLoading, setHojeCompletoLoading] = useState(false);
  const [hojeExpanded, setHojeExpanded] = useState<"none" | "agend" | "fech">("none");

  const loadHojeCompleto = useCallback(async () => {
    if (!isConnected) return;
    const cached = dashFetchCache["hoje-completo"];
    if (cached && Date.now() - cached.ts < DASH_FETCH_THROTTLE_MS) {
      setHojeCompleto(cached.payload);
      return;
    }
    setHojeCompletoLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trinks/hoje-completo`);
      if (res.ok) {
        const data = await res.json();
        setHojeCompleto(data);
        dashFetchCache["hoje-completo"] = { payload: data, ts: Date.now() };
      }
    } catch {}
    setHojeCompletoLoading(false);
  }, [isConnected, API_BASE]);

  useEffect(() => { loadHojeCompleto(); }, [loadHojeCompleto]);

  // v35: Polling enquanto transações estão sendo carregadas em background.
  // Sai do polling assim que transacoesPendente vira false (API respondeu).
  useEffect(() => {
    if (!hojeCompleto?.transacoesPendente) return;
    const interval = setInterval(() => {
      // Invalida o cache local pra forçar nova request
      delete dashFetchCache["hoje-completo"];
      loadHojeCompleto();
    }, 5000);
    return () => clearInterval(interval);
  }, [hojeCompleto?.transacoesPendente, loadHojeCompleto]);

  // Previsão do próximo dia útil
  const [amanha, setAmanha] = useState<AmanhaData | null>(
    (dashFetchCache["amanha"]?.payload as AmanhaData) || null
  );
  const [amanhaLoading, setAmanhaLoading] = useState(false);
  const [amanhaExpanded, setAmanhaExpanded] = useState(false);

  const loadAmanha = useCallback(async () => {
    if (!isConnected) return;
    const cached = dashFetchCache["amanha"];
    if (cached && Date.now() - cached.ts < DASH_FETCH_THROTTLE_MS) {
      setAmanha(cached.payload);
      return;
    }
    setAmanhaLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trinks/amanha`);
      if (res.ok) {
        const data = await res.json();
        setAmanha(data);
        dashFetchCache["amanha"] = { payload: data, ts: Date.now() };
      }
    } catch {}
    setAmanhaLoading(false);
  }, [isConnected, API_BASE]);

  useEffect(() => { loadAmanha(); }, [loadAmanha]);

  // v34: re-fetch quando a aba do navegador volta a ter foco (após estar oculta)
  // OU quando o usuário foca a janela. Mantém o Dashboard sempre fresco quando
  // o usuário volta de outra aba/tarefa.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        invalidateDashFetchCache();
        loadHoje();
        loadHojeCompleto();
        loadAmanha();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [loadHoje, loadHojeCompleto, loadAmanha]);

  // ─── Seletor de mês (Dashboard pode visualizar meses passados) ───
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesAtualSP();
    return localStorage.getItem("dashboard.selectedMes") || mesAtualSP();
  });
  useEffect(() => {
    try { localStorage.setItem("dashboard.selectedMes", selectedMes); } catch {}
  }, [selectedMes]);
  const isMesCorrente = selectedMes === mesCorrente;

  // Quando o mês selecionado NÃO é o corrente, busca o pacote do mês pelo
  // endpoint resolutor /api/mes/:mes/dados — "mais recente vence" entre CSV e
  // Trinks (mesmo formato de TrinksData no campo `dados`).
  const [trinksMes, setTrinksMes] = useState<any>(null);
  const [trinksMesLoading, setTrinksMesLoading] = useState(false);
  const [trinksMesError, setTrinksMesError] = useState<string | null>(null);
  // Fonte ativa: "atual" (store), "trinks" (Trinks ao vivo do mês), "csv" (CSV vence), "nenhuma".
  const [fonteMes, setFonteMes] = useState<"atual" | "trinks" | "csv" | "nenhuma">("atual");
  // Timestamps para o badge (em ISO).
  const [fonteTrinksAt, setFonteTrinksAt] = useState<string | null>(null);
  const [fonteCsvAt, setFonteCsvAt] = useState<string | null>(null);

  // Também busca a meta da fonte para o mês corrente — alimenta o badge.
  useEffect(() => {
    let canceled = false;
    if (!isMesCorrente) return; // o effect abaixo já cobre mês não-corrente
    fetch(`${API_BASE}/api/mes/${selectedMes}/fonte`)
      .then((r) => r.json())
      .then((m) => {
        if (canceled || !m) return;
        setFonteMes((m.fonte === "csv" || m.fonte === "trinks" || m.fonte === "nenhuma") ? m.fonte : "atual");
        setFonteTrinksAt(m.trinksAt || null);
        setFonteCsvAt(m.csvAt || null);
      })
      .catch(() => {});
    return () => { canceled = true; };
  }, [selectedMes, isMesCorrente, API_BASE]);

  useEffect(() => {
    let canceled = false;
    // v35: carrega trinksMes TAMBÉM pra mês corrente como fallback do trinks da store.
    // Quando a API Trinks está em 429, o sync da store falha mas o resolutor
    // /api/mes/:mes/dados pode entregar dados do CSV (fonte alternativa).
    // Antes: pulava o fetch pra mês corrente, deixando Dashboard em demo.
    setTrinksMesLoading(true);
    setTrinksMesError(null);
    // Limpa os dados anteriores ao trocar de mês — evita race condition onde
    // a tela mostra label do mês novo mas ainda renderiza dados do mês antigo
    // até o fetch terminar.
    setTrinksMes(null);
    fetch(`${API_BASE}/api/mes/${selectedMes}/dados`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (canceled) return;
        if (!r.ok) {
          setTrinksMesError(j?.error || `Falha ao carregar ${selectedMes}.`);
          setTrinksMes(null);
          setFonteMes("nenhuma");
          setFonteTrinksAt(null);
          setFonteCsvAt(null);
        } else {
          // O endpoint resolutor devolve { fonte, trinksAt, csvAt, motivo, dados }
          setTrinksMes(j?.dados || null);
          setFonteMes(j?.fonte === "csv" || j?.fonte === "trinks" || j?.fonte === "nenhuma" ? j.fonte : "atual");
          setFonteTrinksAt(j?.trinksAt || null);
          setFonteCsvAt(j?.csvAt || null);
        }
      })
      .catch((e) => {
        if (canceled) return;
        setTrinksMesError(String(e?.message || e));
        setTrinksMes(null);
      })
      .finally(() => { if (!canceled) setTrinksMesLoading(false); });
    return () => { canceled = true; };
  }, [selectedMes, isMesCorrente, API_BASE]);

  // v35: prefere o que tem dado real. Em mês corrente, store pode estar vazia
  // (sync da API Trinks falhou por 429); nesse caso usa trinksMes do resolutor
  // (que tenta CSV antes da API).
  const trinksEffective: any = isMesCorrente
    ? ((trinks && Array.isArray((trinks as any)?.transacoes)) ? trinks : trinksMes)
    : trinksMes;
  const hasTrinksDataEffective = isMesCorrente
    ? (hasTrinksData || (trinksMes !== null && Array.isArray(trinksMes?.transacoes)))
    : (trinksMes !== null && Array.isArray(trinksMes?.transacoes));

  // Period filter state
  const [periodFilter, setPeriodFilter] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Calculate period date range
  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    const today = new Date();
    const toStr = (d: Date) => d.toISOString().split("T")[0];
    const todayStr = toStr(today);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const dow = today.getDay();
    const mondayOff = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOff);

    const lastSunday = new Date(monday);
    lastSunday.setDate(monday.getDate() - 1);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);

    const formatBR = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

    switch (periodFilter) {
      case "hoje":
        return { periodStart: todayStr, periodEnd: todayStr, periodLabel: `Hoje — ${formatBR(today)}` };
      case "ontem":
        return { periodStart: toStr(yesterday), periodEnd: toStr(yesterday), periodLabel: `Ontem — ${formatBR(yesterday)}` };
      case "semana":
        return { periodStart: toStr(monday), periodEnd: todayStr, periodLabel: `Esta Semana — ${formatBR(monday)} a ${formatBR(today)}` };
      case "sem-passada":
        return { periodStart: toStr(lastMonday), periodEnd: toStr(lastSunday), periodLabel: `Semana Passada — ${formatBR(lastMonday)} a ${formatBR(lastSunday)}` };
      case "mes":
        return { periodStart: toStr(monthStart), periodEnd: todayStr, periodLabel: `Este Mês — ${formatBR(monthStart)} a ${formatBR(today)}` };
      case "mes-passado":
        return { periodStart: toStr(lastMonthStart), periodEnd: toStr(lastMonthEnd), periodLabel: `Mês Passado — ${formatBR(lastMonthStart)} a ${formatBR(lastMonthEnd)}` };
      case "custom":
        if (customStart && customEnd) {
          return { periodStart: customStart, periodEnd: customEnd, periodLabel: `${formatBR(new Date(customStart + "T12:00:00"))} a ${formatBR(new Date(customEnd + "T12:00:00"))}` };
        }
        return { periodStart: "", periodEnd: "", periodLabel: "" };
      default:
        return { periodStart: "", periodEnd: "", periodLabel: "" };
    }
  }, [periodFilter, customStart, customEnd]);

  const periodRevenue = useMemo(() => {
    if (!periodStart || !periodEnd) return 0;
    return hasTrinksDataEffective
      ? getTrinksRevenueByRange(trinksEffective, periodStart, periodEnd)
      : getRevenueByRange(periodStart, periodEnd);
  }, [hasTrinksDataEffective, trinksEffective, periodStart, periodEnd]);

  // Calculate data from either Trinks (mês selecionado) or demo
  const totals = useMemo(
    () => (hasTrinksDataEffective ? getTrinksMonthTotals(trinksEffective) : getMonthTotals()),
    [hasTrinksDataEffective, trinksEffective]
  );

  const revenueSummary = useMemo(
    () =>
      hasTrinksDataEffective
        ? getTrinksRevenueSummary(trinksEffective)
        : getRevenueSummary(),
    [hasTrinksDataEffective, trinksEffective]
  );

  const chartData = useMemo(
    () =>
      hasTrinksDataEffective
        ? getTrindsDailyRevenueChart(trinksEffective)
        : getDailyRevenueChartData(),
    [hasTrinksDataEffective, trinksEffective]
  );

  const barberData = useMemo(
    () =>
      hasTrinksDataEffective ? getTrinksBarberRanking(trinksEffective) : getBarberRankingData(),
    [hasTrinksDataEffective, trinksEffective]
  );

  const paymentData = useMemo(
    () =>
      hasTrinksDataEffective
        ? getTrinksPaymentMethodData(trinksEffective)
        : getPaymentMethodData(),
    [hasTrinksDataEffective, trinksEffective]
  );

  const target = 150000;
  const progressPercent = (totals.totalRevenue / target) * 100;
  const todayClients = hasTrinksDataEffective
    ? totals.todayClients
    : chartData[chartData.length - 1]?.clients || 0;

  // Label do mês: usa o selectedMes (não sempre o atual)
  const monthLabelCapital = labelMesPtBR(selectedMes);

  const handleSync = () => {
    syncData(true);
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Data source banner */}
      {hasTrinksData && lastSync ? (
        <SyncBanner
          lastSync={lastSync}
          isSyncing={isSyncing}
          onSync={handleSync}
        />
      ) : csvFresh ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-2">
          <span className="text-emerald-400">📋</span>
          <div className="text-sm">
            <span className="font-medium text-emerald-300">Dados do CSV (email Trinks)</span>
            <span className="text-muted-foreground text-xs ml-2">
              — API Trinks indisponível ou em rate limit. Usando agendamentos importados por email automaticamente.
            </span>
          </div>
        </div>
      ) : (
        <DemoBanner />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSelectedMes(mesAdjacente(selectedMes, -1))}
            aria-label="Mês anterior"
            data-testid="btn-mes-anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-[180px] text-center">
            <h2 className="text-lg font-semibold leading-tight" data-testid="label-mes-selecionado">{monthLabelCapital}</h2>
            <p className="text-[11px] text-muted-foreground">
              {isMesCorrente ? "Mês atual · visão ao vivo" : (
                trinksMesLoading ? "Carregando dados do mês…" :
                trinksMesError ? `Erro: ${trinksMesError}` :
                fonteMes === "trinks" ? "Histórico via Trinks" :
                fonteMes === "csv" ? "Histórico via CSV importado" :
                fonteMes === "nenhuma" ? "Sem dados para este mês" :
                "Visão do mês selecionado"
              )}
            </p>
            <FonteBadge fonte={fonteMes} trinksAt={fonteTrinksAt} csvAt={fonteCsvAt} />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSelectedMes(mesAdjacente(selectedMes, +1))}
            disabled={selectedMes >= mesCorrente}
            aria-label="Próximo mês"
            data-testid="btn-mes-proximo"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          {!isMesCorrente && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedMes(mesCorrente)}
              data-testid="btn-mes-atual"
            >
              Voltar para mês atual
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              invalidateDashFetchCache();
              loadHoje();
              loadHojeCompleto();
              loadAmanha();
            }}
            data-testid="btn-atualizar-dashboard"
            title="Forçar recarga dos dados do Dashboard"
          >
            🔄 Atualizar
          </Button>
          <FecharDiaDialog />
        </div>
      </div>

      {/* v40: 2 painéis lado a lado — Trinks API (canônico) + CSV importado
          (auditoria). Cada um com seus próprios totais e badges. Em telas
          pequenas empilha vertical. */}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
        <DashboardApiSummaryCard mes={selectedMes} />
        <DashboardImportSummaryCard mes={selectedMes} />
      </div>

      {/* Revenue Highlight */}
      <div className={`grid gap-4 ${isMesCorrente ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1"}`}>
        {isMesCorrente && (
          <>
            <Card className="bg-card border-card-border relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hoje</span>
                  {hoje && hoje.count > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-auto">{hoje.count} comanda{hoje.count !== 1 ? "s" : ""}</span>
                  )}
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground" data-testid="revenue-today">
                  {formatCurrency(hoje?.total ?? revenueSummary.dayRevenue)}
                </p>
                {hoje && hoje.total > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {hoje.breakdown.pix > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">Pix {formatCurrency(hoje.breakdown.pix)}</span>}
                    {hoje.breakdown.cartao > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Cartão {formatCurrency(hoje.breakdown.cartao)}</span>}
                    {hoje.breakdown.dinheiro > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Dinheiro {formatCurrency(hoje.breakdown.dinheiro)}</span>}
                    {hoje.breakdown.outros > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Outros {formatCurrency(hoje.breakdown.outros)}</span>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                    <CalendarDays className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Esta Semana</span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground" data-testid="revenue-week">
                  {formatCurrency(revenueSummary.weekRevenue)}
                </p>
              </CardContent>
            </Card>
          </>
        )}

        <Card className="bg-card border-card-border relative overflow-hidden border-primary/30">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
          <CardContent className="p-4 relative">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <CalendarRange className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {isMesCorrente ? "Este Mês" : monthLabelCapital}
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-primary" data-testid="revenue-month">
              {(!isMesCorrente && (trinksMesLoading || !hasTrinksDataEffective))
                ? "—"
                : formatCurrency(revenueSummary.monthRevenue)}
            </p>
            {!isMesCorrente && trinksMesLoading && (
              <p className="text-xs text-muted-foreground mt-1">Carregando…</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Hoje (previsto + fechado em tempo real) — só no mês corrente */}
      {isConnected && isMesCorrente && (
        <Card
          className={`bg-card border-card-border relative overflow-hidden ${
            hojeCompleto?.atingeMeta
              ? "border-emerald-500/40"
              : hojeCompleto && hojeCompleto.progressoPct >= 70
                ? "border-amber-500/40"
                : hojeCompleto
                  ? "border-red-500/40"
                  : ""
          }`}
          data-testid="card-hoje-completo"
        >
          <div
            className={`absolute inset-0 pointer-events-none bg-gradient-to-br ${
              hojeCompleto?.atingeMeta
                ? "from-emerald-500/10"
                : hojeCompleto && hojeCompleto.progressoPct >= 70
                  ? "from-amber-500/10"
                  : "from-red-500/10"
            } to-transparent`}
          />
          <CardHeader className="pb-3 relative">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    hojeCompleto?.atingeMeta
                      ? "bg-emerald-500/15 text-emerald-400"
                      : hojeCompleto && hojeCompleto.progressoPct >= 70
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-red-500/15 text-red-400"
                  }`}
                >
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium">
                    Hoje · tempo real
                  </CardTitle>
                  {hojeCompleto && (
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(hojeCompleto.data + "T12:00:00").toLocaleDateString("pt-BR", {
                        weekday: "long", day: "2-digit", month: "2-digit",
                      })}
                      {" · agora "}
                      {hojeCompleto.horaAgora}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-primary hover:bg-primary/10"
                onClick={loadHojeCompleto}
                disabled={hojeCompletoLoading}
                data-testid="btn-refresh-hoje-completo"
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${hojeCompletoLoading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="relative pt-0">
            {!hojeCompleto ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {hojeCompletoLoading ? "Carregando dia..." : "Sem dados ainda"}
              </div>
            ) : (
              <div className="space-y-4">
                {/* 4 métricas principais */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-2 rounded-md bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] uppercase tracking-wide text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Já fechado
                    </p>
                    <p className="text-xl sm:text-2xl font-bold text-emerald-400" data-testid="hoje-fechado">
                      {formatCurrency(hojeCompleto.fechado)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hojeCompleto.comandasCount} comanda{hojeCompleto.comandasCount !== 1 ? "s" : ""}
                    </p>
                    <FonteSourceBadge
                      fonte={hojeCompleto.transacoesPendente
                        ? "carregando"
                        : hojeCompleto.transacoesOk === false
                          ? "indisponivel"
                          : "trinks-api"}
                      titulo={hojeCompleto.transacoesPendente
                        ? "Buscando comandas pagas em background — atualiza em segundos"
                        : hojeCompleto.transacoesOk === false
                          ? "Trinks API com erro — sem dado de comandas pagas"
                          : "Comandas pagas vêm da API Trinks (transações)"}
                    />
                  </div>

                  <div className="p-2 rounded-md bg-primary/5 border border-primary/20">
                    <p className="text-[10px] uppercase tracking-wide text-primary font-medium flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Restante
                    </p>
                    <p className="text-xl sm:text-2xl font-bold text-primary" data-testid="hoje-restante">
                      {formatCurrency(hojeCompleto.restante)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hojeCompleto.agendamentosRestantesCount} agend. ainda
                    </p>
                    <FonteSourceBadge fonte={hojeCompleto.fonteAgendamentos} csvGeradoEm={hojeCompleto.csvGeradoEm} />
                  </div>

                  <div className="p-2 rounded-md bg-muted/30 border border-border">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      Previsto total
                    </p>
                    <p className="text-xl sm:text-2xl font-bold" data-testid="hoje-esperado">
                      {formatCurrency(hojeCompleto.totalEsperado)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hojeCompleto.agendamentosCount} agend. no dia
                    </p>
                    <FonteSourceBadge fonte={hojeCompleto.fonteAgendamentos} csvGeradoEm={hojeCompleto.csvGeradoEm} />
                  </div>

                  <div className="p-2 rounded-md bg-muted/30 border border-border">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1">
                      <Target className="w-3 h-3" /> Meta
                    </p>
                    <p className="text-xl sm:text-2xl font-bold text-muted-foreground">
                      {formatCurrency(hojeCompleto.metaDiaria)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hojeCompleto.atingeMeta
                        ? `+${formatCurrency(hojeCompleto.totalEsperado - hojeCompleto.metaDiaria)} sobre meta`
                        : `faltam ${formatCurrency(hojeCompleto.falta)}`}
                    </p>
                  </div>
                </div>

                {/* Barra de progresso composta */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {hojeCompleto.atingeMeta ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-xs font-medium text-emerald-400">
                            Dia vai bater a meta ({formatPercent(hojeCompleto.progressoPct)})
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle
                            className={`w-3.5 h-3.5 ${
                              hojeCompleto.progressoPct >= 70 ? "text-amber-400" : "text-red-400"
                            }`}
                          />
                          <span
                            className={`text-xs font-medium ${
                              hojeCompleto.progressoPct >= 70 ? "text-amber-400" : "text-red-400"
                            }`}
                          >
                            {formatPercent(hojeCompleto.progressoPct)} previsto — falta{" "}
                            {formatCurrency(hojeCompleto.falta)}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Fechado: {formatPercent(hojeCompleto.progressoFechadoPct)}
                    </span>
                  </div>
                  {/* Barra composta: fechado (sólido) + restante (translucido) */}
                  <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full ${
                        hojeCompleto.atingeMeta
                          ? "bg-emerald-500"
                          : hojeCompleto.progressoPct >= 70
                            ? "bg-amber-500"
                            : "bg-red-500"
                      } opacity-40`}
                      style={{ width: `${Math.min(100, hojeCompleto.progressoPct)}%` }}
                    />
                    <div
                      className="absolute left-0 top-0 h-full bg-emerald-500"
                      style={{ width: `${Math.min(100, hojeCompleto.progressoFechadoPct)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ■ verde sólido = já fechado · ■ translucido = previsto para o restante do dia
                  </p>
                </div>

                {/* Ranking por profissional */}
                {hojeCompleto.porProfissional.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
                      Por profissional
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {hojeCompleto.porProfissional.slice(0, 9).map((p) => {
                        const metaVisual = Math.max(p.previsto, p.fechado, 1);
                        const pctFech = (p.fechado / metaVisual) * 100;
                        return (
                          <div key={p.nome} className="px-2.5 py-1.5 rounded-md bg-muted/20">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium truncate">{p.nome}</p>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {p.countFechado}/{p.countPrevisto || p.countFechado} agend.
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <span className="text-[11px] text-emerald-400 font-semibold">
                                {formatCurrency(p.fechado)}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                de {formatCurrency(Math.max(p.previsto, p.fechado))}
                              </span>
                            </div>
                            <div className="relative h-1 rounded-full bg-muted mt-1 overflow-hidden">
                              <div
                                className="absolute left-0 top-0 h-full bg-emerald-500"
                                style={{ width: `${Math.min(100, pctFech)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Toggles de listas */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-primary hover:bg-primary/10 px-2"
                    onClick={() => setHojeExpanded((v) => (v === "fech" ? "none" : "fech"))}
                    data-testid="btn-toggle-hoje-fechadas"
                  >
                    {hojeExpanded === "fech" ? "Ocultar" : "Ver"} {hojeCompleto.comandasCount} fechada{hojeCompleto.comandasCount !== 1 ? "s" : ""}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-primary hover:bg-primary/10 px-2"
                    onClick={() => setHojeExpanded((v) => (v === "agend" ? "none" : "agend"))}
                    data-testid="btn-toggle-hoje-agendamentos"
                  >
                    {hojeExpanded === "agend" ? "Ocultar" : "Ver"} {hojeCompleto.agendamentosRestantesCount} agendamento{hojeCompleto.agendamentosRestantesCount !== 1 ? "s" : ""} restante{hojeCompleto.agendamentosRestantesCount !== 1 ? "s" : ""}
                  </Button>
                </div>

                {hojeExpanded === "fech" && hojeCompleto.comandas.length > 0 && (
                  <div className="max-h-72 overflow-auto border border-card-border rounded-md">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card border-b border-border">
                        <tr>
                          <th className="text-left p-2 text-muted-foreground font-medium">Hora</th>
                          <th className="text-left p-2 text-muted-foreground font-medium">Cliente</th>
                          <th className="text-left p-2 text-muted-foreground font-medium">Profissional</th>
                          <th className="text-left p-2 text-muted-foreground font-medium">Meios</th>
                          <th className="text-right p-2 text-muted-foreground font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hojeCompleto.comandas.map((c) => (
                          <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="p-2 font-mono whitespace-nowrap">{c.hora || "—"}</td>
                            <td className="p-2 truncate max-w-[160px]">{c.cliente}</td>
                            <td className="p-2 truncate max-w-[120px] text-muted-foreground">{c.profissional}</td>
                            <td className="p-2 text-[10px] text-muted-foreground uppercase">{c.meios.join(", ")}</td>
                            <td className="p-2 text-right font-semibold whitespace-nowrap text-emerald-400">
                              {formatCurrency(c.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {hojeExpanded === "agend" && hojeCompleto.agendamentos.length > 0 && (
                  <div className="max-h-72 overflow-auto border border-card-border rounded-md">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card border-b border-border">
                        <tr>
                          <th className="text-left p-2 text-muted-foreground font-medium">Hora</th>
                          <th className="text-left p-2 text-muted-foreground font-medium">Cliente</th>
                          <th className="text-left p-2 text-muted-foreground font-medium">Profissional</th>
                          <th className="text-left p-2 text-muted-foreground font-medium">Serviço</th>
                          <th className="text-right p-2 text-muted-foreground font-medium">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hojeCompleto.agendamentos
                          .filter(a => (a.hora || "99:99") >= hojeCompleto.horaAgora)
                          .map((a) => (
                          <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="p-2 font-mono whitespace-nowrap text-primary">{a.hora || "—"}</td>
                            <td className="p-2 truncate max-w-[160px]">{a.cliente}</td>
                            <td className="p-2 truncate max-w-[120px] text-muted-foreground">{a.profissional}</td>
                            <td className="p-2 truncate max-w-[160px] text-muted-foreground">{a.servico}</td>
                            <td className="p-2 text-right font-semibold whitespace-nowrap">
                              {a.valor > 0 ? formatCurrency(a.valor) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {hojeCompleto.fromCache && (
                  <p className="text-[10px] text-muted-foreground">
                    Em cache · atualiza a cada 2 minutos
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Previsão de Amanhã — só no mês corrente */}
      {isConnected && isMesCorrente && (
        <Card
          className={`bg-card border-card-border relative overflow-hidden ${
            amanha?.atingeMeta
              ? "border-emerald-500/40"
              : amanha && amanha.progressoPct >= 70
                ? "border-amber-500/40"
                : amanha
                  ? "border-red-500/40"
                  : ""
          }`}
          data-testid="card-amanha"
        >
          <div
            className={`absolute inset-0 pointer-events-none bg-gradient-to-br ${
              amanha?.atingeMeta
                ? "from-emerald-500/10"
                : amanha && amanha.progressoPct >= 70
                  ? "from-amber-500/10"
                  : "from-red-500/10"
            } to-transparent`}
          />
          <CardHeader className="pb-3 relative">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    amanha?.atingeMeta
                      ? "bg-emerald-500/15 text-emerald-400"
                      : amanha && amanha.progressoPct >= 70
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-red-500/15 text-red-400"
                  }`}
                >
                  <CalendarPlus className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium">
                    Previsão {amanha?.proxDiaUtil ? "próximo dia útil" : "de Amanhã"}
                  </CardTitle>
                  {amanha && (
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(amanha.data + "T12:00:00").toLocaleDateString("pt-BR", {
                        weekday: "long", day: "2-digit", month: "2-digit",
                      })}
                      {" · "}
                      {amanha.count} agendamento{amanha.count !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-primary hover:bg-primary/10"
                onClick={loadAmanha}
                disabled={amanhaLoading}
                data-testid="btn-refresh-amanha"
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${amanhaLoading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="relative pt-0">
            {!amanha ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {amanhaLoading ? "Carregando previsão..." : "Sem dados ainda"}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      Faturamento previsto
                    </p>
                    <p
                      className="text-2xl sm:text-3xl font-bold"
                      data-testid="amanha-total"
                    >
                      {formatCurrency(amanha.total)}
                    </p>
                    <FonteSourceBadge fonte={amanha.fonteAgendamentos} csvGeradoEm={amanha.csvGeradoEm} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1">
                      <Target className="w-3 h-3" /> Meta diária
                    </p>
                    <p className="text-2xl sm:text-3xl font-bold text-muted-foreground">
                      {formatCurrency(amanha.metaDiaria)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      {amanha.atingeMeta ? "Excedendo meta em" : "Falta para meta"}
                    </p>
                    <p
                      className={`text-2xl sm:text-3xl font-bold ${
                        amanha.atingeMeta ? "text-emerald-400" : "text-red-400"
                      }`}
                      data-testid="amanha-falta"
                    >
                      {amanha.atingeMeta
                        ? `+${formatCurrency(amanha.total - amanha.metaDiaria)}`
                        : formatCurrency(amanha.falta)}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {amanha.atingeMeta ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-xs font-medium text-emerald-400">
                            Meta atingida — {formatPercent(amanha.progressoPct)}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle
                            className={`w-3.5 h-3.5 ${
                              amanha.progressoPct >= 70 ? "text-amber-400" : "text-red-400"
                            }`}
                          />
                          <span
                            className={`text-xs font-medium ${
                              amanha.progressoPct >= 70 ? "text-amber-400" : "text-red-400"
                            }`}
                          >
                            {formatPercent(amanha.progressoPct)} da meta — falta{" "}
                            {formatCurrency(amanha.falta)}
                          </span>
                        </>
                      )}
                    </div>
                    {amanha.count > 0 && (() => {
                      const ticketMedioAtual = amanha.total / amanha.count;
                      const agendFaltando = ticketMedioAtual > 0
                        ? Math.ceil(amanha.falta / ticketMedioAtual)
                        : 0;
                      if (amanha.atingeMeta || agendFaltando <= 0) return null;
                      return (
                        <span className="text-[10px] text-muted-foreground">
                          ~{agendFaltando} agend. a mais (ticket {formatCurrency(ticketMedioAtual)})
                        </span>
                      );
                    })()}
                  </div>
                  <Progress
                    value={Math.min(100, amanha.progressoPct)}
                    className={`h-2 ${
                      amanha.atingeMeta
                        ? "[&>div]:bg-emerald-500"
                        : amanha.progressoPct >= 70
                          ? "[&>div]:bg-amber-500"
                          : "[&>div]:bg-red-500"
                    }`}
                  />
                </div>

                {amanha.porProfissional.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
                      Por profissional
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {amanha.porProfissional.slice(0, 8).map((p) => (
                        <div
                          key={p.nome}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-muted/20"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{p.nome}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {p.count} agend.
                            </p>
                          </div>
                          <span className="text-xs font-semibold whitespace-nowrap ml-2">
                            {formatCurrency(p.total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {amanha.agendamentos.length > 0 && (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary hover:bg-primary/10 px-2"
                      onClick={() => setAmanhaExpanded((v) => !v)}
                      data-testid="btn-toggle-amanha-lista"
                    >
                      {amanhaExpanded ? "Ocultar" : "Ver"} lista de agendamentos
                      ({amanha.agendamentos.length})
                    </Button>
                    {amanhaExpanded && (
                      <div className="mt-2 max-h-72 overflow-auto border border-card-border rounded-md">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-card border-b border-border">
                            <tr>
                              <th className="text-left p-2 text-muted-foreground font-medium">Hora</th>
                              <th className="text-left p-2 text-muted-foreground font-medium">Cliente</th>
                              <th className="text-left p-2 text-muted-foreground font-medium">Profissional</th>
                              <th className="text-left p-2 text-muted-foreground font-medium">Serviço</th>
                              <th className="text-right p-2 text-muted-foreground font-medium">Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {amanha.agendamentos.map((a) => (
                              <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20">
                                <td className="p-2 font-mono whitespace-nowrap">{a.hora || "—"}</td>
                                <td className="p-2 truncate max-w-[160px]">{a.cliente}</td>
                                <td className="p-2 truncate max-w-[120px] text-muted-foreground">{a.profissional}</td>
                                <td className="p-2 truncate max-w-[160px] text-muted-foreground">{a.servico}</td>
                                <td className="p-2 text-right font-semibold whitespace-nowrap">
                                  {a.valor > 0 ? formatCurrency(a.valor) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {amanha.fromCache && (
                  <p className="text-[10px] text-muted-foreground">
                    Em cache · atualiza a cada 5 minutos
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}


      {/* Estoque em alerta */}
      {isConnected && <EstoqueAlertaCard apiBase={API_BASE} />}

      {/* Telegram Notifications */}
      {isConnected && <TelegramCard apiBase={API_BASE} />}

      {/* Period Filter */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Faturamento por Período</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { label: "Hoje", key: "hoje" },
                { label: "Ontem", key: "ontem" },
                { label: "Esta Semana", key: "semana" },
                { label: "Sem. Passada", key: "sem-passada" },
                { label: "Este Mês", key: "mes" },
                { label: "Mês Passado", key: "mes-passado" },
              ].map((p) => (
                <Button
                  key={p.key}
                  variant={periodFilter === p.key ? "default" : "outline"}
                  size="sm"
                  className={
                    periodFilter === p.key
                      ? "bg-primary hover:bg-primary/80 text-white h-7 text-xs"
                      : "h-7 text-xs"
                  }
                  onClick={() => {
                    setPeriodFilter(p.key);
                    setCustomStart("");
                    setCustomEnd("");
                  }}
                >
                  {p.label}
                </Button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={periodFilter === "custom" ? "default" : "outline"}
                    size="sm"
                    className={
                      periodFilter === "custom"
                        ? "bg-primary hover:bg-primary/80 text-white h-7 text-xs"
                        : "h-7 text-xs"
                    }
                  >
                    <CalendarRange className="w-3 h-3 mr-1" />
                    Personalizado
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3 bg-card border-card-border" align="end">
                  <div className="flex items-center gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">De</Label>
                      <Input
                        type="date"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                        className="h-8 text-xs w-36"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Até</Label>
                      <Input
                        type="date"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                        className="h-8 text-xs w-36"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/80 text-white h-8 mt-4"
                      disabled={!customStart || !customEnd}
                      onClick={() => setPeriodFilter("custom")}
                    >
                      Filtrar
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {periodFilter && (
            <div className="mt-3 pt-3 border-t border-card-border flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{periodLabel}</p>
                <p className="text-2xl font-bold text-primary" data-testid="revenue-period">
                  {formatCurrency(periodRevenue)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => {
                  setPeriodFilter("");
                  setCustomStart("");
                  setCustomEnd("");
                }}
              >
                Limpar filtro
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Ticket Médio"
          value={(!isMesCorrente && (trinksMesLoading || !hasTrinksDataEffective)) ? "—" : formatCurrency(totals.avgTicket)}
          trend={3.2}
          icon={<BarChart3 className="w-4 h-4 text-primary" />}
        />
        <KPICard
          title="Taxa de Ocupação"
          value={(!isMesCorrente && (trinksMesLoading || !hasTrinksDataEffective)) ? "—" : formatPercent(totals.occupationRate)}
          trend={-1.5}
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
        />
        {isMesCorrente && (
          <KPICard
            title="Atendimentos Hoje"
            value={`${todayClients} clientes`}
            trend={12.0}
            icon={<Users className="w-4 h-4 text-primary" />}
          />
        )}
      </div>

      {/* Revenue Chart + Goal Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Faturamento Diário — {monthLabelCapital}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" stroke="#666" fontSize={11} />
                  <YAxis
                    stroke="#666"
                    fontSize={11}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#1E3A5F"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#1E3A5F" }}
                    activeDot={{ r: 5, fill: "#5B8AC4" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Goal Progress */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Meta Mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-3">
                <p className="text-2xl font-bold text-primary">
                  {formatPercent(progressPercent)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatCurrency(totals.totalRevenue)} de{" "}
                  {formatCurrency(target)}
                </p>
              </div>
              <Progress
                value={progressPercent}
                className="h-2 [&>div]:bg-primary"
              />
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Faltam {formatCurrency(target - totals.totalRevenue)} para a
                meta
              </p>
            </CardContent>
          </Card>

          {/* Payment Methods */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Formas de Pagamento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {paymentData.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="text-xs">{p.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-medium">
                        {formatCurrency(p.value)}
                      </span>
                      {totals.totalRevenue > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          (
                          {formatPercent(
                            (p.value / totals.totalRevenue) * 100
                          )}
                          )
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom row: Barber ranking */}
      {barberData.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Ranking de Barbeiros — {monthLabelCapital}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barberData}
                  layout="vertical"
                  margin={{ left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#333"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    stroke="#666"
                    fontSize={11}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="#666"
                    fontSize={11}
                    width={55}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: "#1a1a1a",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {barberData.map((_, index) => (
                      <Cell
                        key={index}
                        fill={
                          index === 0
                            ? "#1E3A5F"
                            : index < 3
                              ? "#152D4A"
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
    </div>
  );
}

// ─── TelegramCard ─────────────────────────────────────────────
interface TelegramStatus {
  configured: boolean;
  chatId: string;
  schedules: { morning: string; evening: string };
}

function TelegramCard({ apiBase }: { apiBase: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [sending, setSending] = useState<"test" | "manha" | "noite" | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/telegram/status`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, chatId: "", schedules: { morning: "", evening: "" } }));
  }, [apiBase]);

  async function enviar(endpoint: string, kind: "test" | "manha" | "noite", label: string) {
    setSending(kind);
    try {
      const res = await fetch(`${apiBase}${endpoint}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast({ title: "✅ Enviado!", description: `${label} foi enviado no seu Telegram.` });
      } else {
        toast({
          title: "❌ Falha no envio",
          description: data.error || "Verifique TELEGRAM_BOT_TOKEN no Railway.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSending(null);
    }
  }

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary/15 text-primary">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-sm font-medium">Notificações no Telegram</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              @fredgreco_bot · {status?.chatId ? `Chat ${status.chatId}` : "—"}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {status === null ? (
          <div className="text-xs text-muted-foreground">Carregando...</div>
        ) : !status.configured ? (
          <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs">
            <p className="font-medium text-amber-400 mb-1">⚠️ Bot não configurado</p>
            <p className="text-muted-foreground">
              Configure a variável <code className="bg-muted/40 px-1 rounded">TELEGRAM_BOT_TOKEN</code>{" "}
              no Railway com o token do @fredgreco_bot (obtido no @BotFather) e redeploy.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-md bg-muted/20 border border-border">
                <p className="text-muted-foreground text-[10px] uppercase">Resumo da manhã</p>
                <p className="font-medium">{status.schedules.morning}</p>
              </div>
              <div className="p-2 rounded-md bg-muted/20 border border-border">
                <p className="text-muted-foreground text-[10px] uppercase">Fechamento do dia</p>
                <p className="font-medium">{status.schedules.evening}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => enviar("/api/telegram/testar", "test", "Teste")}
                disabled={!!sending}
                data-testid="btn-telegram-teste"
              >
                <Send className="w-3 h-3 mr-1" />
                {sending === "test" ? "Enviando..." : "Enviar teste"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => enviar("/api/telegram/resumo-manha", "manha", "Resumo da manhã")}
                disabled={!!sending}
                data-testid="btn-telegram-manha"
              >
                ☀️ {sending === "manha" ? "Enviando..." : "Enviar resumo da manhã"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => enviar("/api/telegram/resumo-noite", "noite", "Fechamento do dia")}
                disabled={!!sending}
                data-testid="btn-telegram-noite"
              >
                🌙 {sending === "noite" ? "Enviando..." : "Enviar fechamento"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Envios automáticos: toda terça a sábado às 08:00 e 20:00 (Brasília).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── EstoqueAlertaCard ───────────────────────────────────────
function EstoqueAlertaCard({ apiBase }: { apiBase: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`${apiBase}/api/estoque/resumo`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e: any) {
      setErro(e?.message || "falhou");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  if (!data && !erro) return null;
  // Se deu erro, não mostra nada no dashboard (evita poluir quando Trinks está fora)
  if (erro) return null;
  // Se não tem alerta nenhum e carregou, não mostra nada
  if (data && (data.produtosEmAlerta || 0) === 0) return null;

  const formatarDias = (dias: number | null | undefined): string => {
    if (dias === null || dias === undefined) return "sem vendas";
    if (dias >= 999) return "sem vendas";
    if (dias === 0) return "hoje";
    if (dias === 1) return "ontem";
    if (dias < 30) return `há ${dias} dias`;
    return "+30 dias";
  };

  return (
    <Card className="bg-card border-card-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium">Produtos sem giro</span>
            {data && (
              <span className="text-xs text-muted-foreground">
                {data.produtosEmAlerta} produto{data.produtosEmAlerta !== 1 ? "s" : ""}
                {data.produtosCriticos > 0 && ` · ${data.produtosCriticos} parado${data.produtosCriticos > 1 ? "s" : ""} +30d`}
              </span>
            )}
          </div>
          <a href="#/estoque" className="text-xs text-primary hover:underline">Ver tudo →</a>
        </div>
        {erro ? (
          <div className="text-xs text-muted-foreground">
            Não foi possível carregar os produtos no momento. {erro}
          </div>
        ) : data && Array.isArray(data.alertas) && data.alertas.length > 0 ? (
          <div className="space-y-1">
            {data.alertas.slice(0, 5).map((p: any, i: number) => (
              <div key={p?.id ?? i} className="flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-muted/30">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.nome}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.categoria || "Sem categoria"} · última venda {formatarDias(p.diasDesdeUltimaVenda)}
                  </div>
                </div>
                <div className="text-right ml-3">
                  <div className={`text-[10px] uppercase tracking-wide ${p.nivel === "critico" ? "text-red-400" : "text-amber-400"}`}>
                    {p.nivel === "critico" ? "Parado +30d" : "Parado 14-30d"}
                  </div>
                </div>
              </div>
            ))}
            {data.alertas.length > 5 && (
              <a href="#/estoque" className="block text-xs text-muted-foreground hover:text-primary pt-1 text-center">
                +{data.alertas.length - 5} outros produtos
              </a>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
