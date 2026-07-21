import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/authStore";
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
import { KpiTile, RankRow, SectionHeader, GoalBar } from "@/components/premium";
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
  UserPlus,
  Repeat,
  UserMinus,
  Search,
  Trophy,
  Minus,
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
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs">
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
          className="underline hover:text-amber-600"
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
const DASH_FETCH_THROTTLE_MS = 2 * 60 * 60 * 1000; // v54: 2h — economia de cota Trinks (era 60s; martelava a API a cada foco/visita)
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
        className="inline-flex items-center gap-0.5 text-[9px] mt-1 px-1 py-0.5 rounded border border-red-500/40 text-red-300 bg-red-500/10"
        title={titulo || "Carregando da Trinks em background…"}
      >
        <span className="inline-block w-1 h-1 rounded-full bg-red-400 animate-pulse" />
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
        className="inline-flex items-center gap-0.5 text-[9px] mt-1 px-1 py-0.5 rounded border border-red-500/40 text-red-300 bg-red-500/10"
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

// Painel de RECONCILIAÇÃO — "tudo tem que se comunicar": mostra o mesmo
// faturamento por fonte (Gmail oficial = autoridade; API/Metas ao vivo; CSV;
// ranking), com o gap vs o oficial e a explicação de cada divergência.
function ReconciliacaoFontes({ mes, apiBase }: { mes: string; apiBase: string }) {
  const [d, setD] = useState<any>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    let cancel = false;
    fetch(`${apiBase}/api/reconciliacao/${mes}`).then(r => r.json()).then(j => { if (!cancel && j?.ok) setD(j); }).catch(() => {});
    return () => { cancel = true; };
  }, [mes, apiBase]);
  if (!d || !d.fontes?.length) return null;
  const fmt = (n: number) => formatCurrency(n);
  return (
    <Card className="bg-card border-card-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Reconciliação</div>
            <h3 className="text-[15px] font-bold tracking-tight flex items-center gap-2 mt-0.5"><BarChart3 className="w-4 h-4 text-primary" /> As fontes se comunicam?</h3>
          </div>
          <button onClick={() => setAberto(v => !v)} className="text-xs text-muted-foreground hover:text-foreground flex-none">{aberto ? "ocultar" : "ver detalhe"}</button>
        </div>
        <div className="flex flex-col gap-1.5">
          {d.fontes.map((f: any) => {
            const bate = Math.abs(f.diffPct || 0) < 2;
            const cor = bate ? "text-emerald-400" : (f.diff > 0 ? "text-red-400" : "text-amber-400");
            return (
              <div key={f.chave} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold flex items-center gap-2 flex-wrap">
                    {f.nome}
                    {f.autoridade && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">autoridade</span>}
                    {f.qtd ? <span className="text-[10px] text-muted-foreground tabular-nums">{f.qtd} {f.chave === "metas" || f.chave === "csvCaixa" ? "atend." : "tx"}</span> : null}
                  </div>
                  {aberto && <div className="text-[11px] text-muted-foreground mt-0.5">{f.nota}</div>}
                </div>
                <div className="text-right flex-none">
                  <div className="text-[14px] font-extrabold tabular-nums text-foreground">{fmt(f.valor)}</div>
                  {!f.autoridade && <div className={`text-[10.5px] tabular-nums ${cor}`}>{f.diff >= 0 ? "+" : ""}{fmt(f.diff)} ({f.diffPct >= 0 ? "+" : ""}{Number(f.diffPct).toFixed(0)}%)</div>}
                  {/* O movimento de hoje não é divergência — some do diff e aparece à parte. */}
                  {f.hojeRS > 0 && <div className="text-[10px] text-muted-foreground tabular-nums">+ {fmt(f.hojeRS)} hoje{f.hojeQtd ? ` (${f.hojeQtd} tx)` : ""}</div>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10.5px] text-muted-foreground mt-2">O <b className="text-primary">Gmail</b> é a autoridade. {d.mesCorrente ? "Mês em andamento: API/Metas ficam maiores (têm o dia de hoje); o Ranking fica menor (sem Clube)." : "Mês fechado — as fontes devem convergir."}</p>
      </CardContent>
    </Card>
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
  // v104 ANTI-SANGRIA: quando a Trinks está no 429, transacoesPendente NUNCA
  // zera (o dia corrente não tem CSV de caixa pra fechar o flag) → o polling de
  // 5s virava tempestade (720 req/h com o Dashboard aberto). Agora: no MÁXIMO
  // 4 tentativas, a cada 20s, e para. Reseta quando o pendente resolve sozinho.
  const pollHojeRef = useRef(0);
  useEffect(() => {
    if (!hojeCompleto?.transacoesPendente) { pollHojeRef.current = 0; return; }
    if (pollHojeRef.current >= 4) return; // teto rígido — nunca poll infinito
    const interval = setInterval(() => {
      if (pollHojeRef.current >= 4) { clearInterval(interval); return; }
      pollHojeRef.current += 1;
      delete dashFetchCache["hoje-completo"];
      loadHojeCompleto();
    }, 20000);
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
  // Sempre abre no MÊS ATUAL (não lembra o último visto — evitava dar a impressão
  // de "dashboard parado" quando ficava um mês passado salvo no navegador).
  const [selectedMes, setSelectedMes] = useState<string>(() => mesAtualSP());
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
  // Fase 1: totais JÁ calculados pelo mesService (envelope /api/mes/:mes/dados).
  const [canonicoMes, setCanonicoMes] = useState<any>(null);
  // Fase 1: dados de equipe (ranking-aware) p/ ticket/tipo/retenção/top profs.
  const [equipeMesDash, setEquipeMesDash] = useState<any>(null);
  // Fase 1: mês anterior p/ comparação (faturamento + ticket).
  const [mesAnteriorCmp, setMesAnteriorCmp] = useState<{ faturamento: number; ticketMedio: number } | null>(null);
  // v96: contador de consumo da Trinks removido do Dashboard (vive no Greco Metas).

  // Fase 2: agregados de cliente do "Ranking de Clientes" (sem PII).
  const [clientesMes, setClientesMes] = useState<any>(null);

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
          // Fase 1: campos prontos do mesService (faturamento/comandas/breakdown/dias úteis)
          setCanonicoMes(typeof j?.faturamento === "number" ? {
            faturamento: j.faturamento, comandas: Number(j.comandas || 0),
            breakdown: j.breakdown || null,
            diasUteisDecorridos: Number(j.diasUteisDecorridos || 0),
            diasUteisTotal: Number(j.diasUteisTotal || 0),
          } : null);
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

  // Fase 1: equipe (ranking-aware) do mês p/ ticket/tipo/retenção/top profs, +
  // mês anterior p/ comparação. Reusa /api/equipe/mes e /api/mes/dados (sem
  // recriar cálculo). Mês fechado vem do CSV congelado (não quebra em 429).
  useEffect(() => {
    let canceled = false;
    setEquipeMesDash(null);
    setMesAnteriorCmp(null);
    fetch(`${API_BASE}/api/equipe/mes/${selectedMes}`)
      .then((r) => r.json())
      .then((d) => { if (!canceled && d?.ok) setEquipeMesDash(d); })
      .catch(() => {});
    const mesAnt = mesAdjacente(selectedMes, -1);
    Promise.all([
      fetch(`${API_BASE}/api/mes/${mesAnt}/dados`).then((r) => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/equipe/mes/${mesAnt}`).then((r) => r.json()).catch(() => null),
    ]).then(([dadosAnt, eqAnt]) => {
      if (canceled) return;
      const fat = typeof dadosAnt?.faturamento === "number" ? dadosAnt.faturamento : (eqAnt?.totais?.faturamento || 0);
      const tk = eqAnt?.totais?.ticketMedio || 0;
      if (fat > 0 || tk > 0) setMesAnteriorCmp({ faturamento: fat, ticketMedio: tk });
    });
    return () => { canceled = true; };
  }, [selectedMes, API_BASE]);

  // Fase 2: agregados de cliente (ranking de clientes importado). Mês fechado =
  // CSV persistido, nunca Trinks ao vivo. Sem CSV → null (cards não renderizam).
  useEffect(() => {
    let canceled = false;
    setClientesMes(null);
    fetch(`${API_BASE}/api/clientes/ranking/${selectedMes}`)
      .then((r) => r.json())
      .then((d) => { if (!canceled && d?.ok && !d.vazio) setClientesMes(d); })
      .catch(() => {});
    return () => { canceled = true; };
  }, [selectedMes, API_BASE]);

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
  const totalsBase = useMemo(
    () => (hasTrinksDataEffective ? getTrinksMonthTotals(trinksEffective) : getMonthTotals()),
    [hasTrinksDataEffective, trinksEffective]
  );
  // Fase 1 (Parte A): prefere faturamento/comandas JÁ calculados pelo mesService
  // (envelope). Recálculo client vira só fallback quando o campo vier ausente.
  const totals = useMemo(() => {
    if (canonicoMes && typeof canonicoMes.faturamento === "number") {
      return {
        ...totalsBase,
        totalRevenue: canonicoMes.faturamento,
        totalClients: canonicoMes.comandas || totalsBase.totalClients,
      };
    }
    return totalsBase;
  }, [totalsBase, canonicoMes]);

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

  // ─── Fase 1: valores derivados do "Resumo do Mês" (fonte canônica) ───
  const fatMes = (canonicoMes?.faturamento ?? totals.totalRevenue) || 0;
  const comandasMes = (canonicoMes?.comandas ?? totals.totalClients) || 0;
  const duDecorr = canonicoMes?.diasUteisDecorridos || 0;
  const duTotal = canonicoMes?.diasUteisTotal || 0;
  const projecaoMes = duDecorr > 0 ? (fatMes / duDecorr) * duTotal : fatMes;
  const pctMeta = target > 0 ? (fatMes / target) * 100 : 0;
  const pctProjMeta = target > 0 ? (projecaoMes / target) * 100 : 0;
  const faltaMeta = Math.max(0, target - fatMes);
  const eqTot = equipeMesDash?.totais || {};
  const ticketMes = (eqTot.ticketMedio ?? (comandasMes > 0 ? fatMes / comandasMes : 0)) || 0;
  const servicosMes = eqTot.servicosBruto || 0;
  const produtosMes = eqTot.produtosBruto || 0;
  const novosClientesMes = eqTot.novosClientes || 0;
  const retornoMes = eqTot.pctRetornoMedio || 0;
  const mediaComandasDiaUtil = duDecorr > 0 ? comandasMes / duDecorr : 0;
  const topProfsMes = (equipeMesDash?.profissionais || []).slice(0, 5);
  const varFatPct = mesAnteriorCmp && mesAnteriorCmp.faturamento > 0
    ? ((fatMes - mesAnteriorCmp.faturamento) / mesAnteriorCmp.faturamento) * 100 : null;
  const varTicketPct = mesAnteriorCmp && mesAnteriorCmp.ticketMedio > 0
    ? ((ticketMes - mesAnteriorCmp.ticketMedio) / mesAnteriorCmp.ticketMedio) * 100 : null;
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
      {/* v80: aviso de atualização de CSVs (primeiro item, minimalista) */}
      <AvisoCSV />

      {/* v76: Painel executivo — Hoje · Semana · Mês (topo) */}
      <PainelExecutivo />

      {/* Faturamento acumulado do ano */}
      <FaturamentoAno />

      {/* Clientes atendidos & serviços executados mês a mês */}
      <ClientesAtendidosMes />

      {/* Taxa de ocupação mês a mês */}
      <OcupacaoMes />

      {/* Faturamento por fonte (onde atacar) */}
      <FaturamentoPorFonte />

      {/* Data source banner */}
      {hasTrinksData && lastSync ? (
        <SyncBanner
          lastSync={lastSync}
          isSyncing={isSyncing}
          onSync={handleSync}
        />
      ) : csvFresh ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-2">
          <span className="text-emerald-600">📋</span>
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
      {/* v96: contador de tokens Trinks REMOVIDO daqui — é o mesmo da conta,
          já exibido no Greco Metas (era número duplicado). */}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
        <DashboardApiSummaryCard mes={selectedMes} />
        <DashboardImportSummaryCard mes={selectedMes} />
      </div>

      {/* ───────── Retenção de Clientes (jan–jun) ───────── */}
      <RetencaoClientes />

      {/* ───────── Ranking de Colaboradores (evolução mês a mês) ───────── */}
      <RankingColaboradores />

      {/* Clientes sumidos — CTA de reativação em DESTAQUE no topo (dono pediu) */}
      {(clientesMes?.clientesSumidos?.total || 0) > 0 && (
        <div className="rounded-2xl border-2 border-amber-500/50 bg-amber-500/5 p-4 flex items-center justify-between gap-3 flex-wrap" data-testid="sumidos-destaque">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 grid place-items-center flex-none"><UserMinus className="w-5 h-5 text-amber-500" /></div>
            <div>
              <div className="text-[26px] leading-none font-extrabold text-amber-500 tabular-nums">{clientesMes.clientesSumidos.total}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {clientesMes.clientesSumidos.fonte === "metas-vivo"
                  ? "clientes sumidos — base viva do Metas (ao vivo) · dinheiro na mesa pra reativar"
                  : "clientes sumidos há 60+ dias — dinheiro na mesa pra reativar"}
              </div>
            </div>
          </div>
          {(clientesMes.clientesSumidos.lista?.length || 0) > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10">Ver lista pra reativar</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 max-h-96 overflow-y-auto">
                <p className="text-xs font-semibold mb-2 flex items-center gap-1"><UserMinus className="w-3.5 h-3.5 text-amber-600" /> {clientesMes.clientesSumidos.fonte === "metas-vivo" ? "Mais tempo sem vir primeiro" : "Mais recuperáveis primeiro"}</p>
                <div className="space-y-1">
                  {clientesMes.clientesSumidos.lista.map((c: any, i: number) => {
                    const tel = String(c.phone || "").replace(/\D/g, "");
                    const wa = tel.length >= 10 ? `https://wa.me/55${tel.slice(-11)}` : null;
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 text-xs">
                        {wa ? <a href={wa} target="_blank" rel="noreferrer" className="truncate text-emerald-600 hover:underline" title="Abrir WhatsApp">{c.nome}</a> : <span className="truncate">{c.nome}</span>}
                        <span className="text-muted-foreground tabular-nums flex-shrink-0">{c.diasSemVir}d</span>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* ───────── Fase 1: Resumo do Mês (fonte canônica) ───────── */}
      {(canonicoMes || equipeMesDash) && (
        <div className="space-y-4" data-testid="resumo-mes">
          {/* Hero: faturamento + projeção vs meta */}
          <Card className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Faturamento do mês · meta {formatCurrency(target)}</span>
                </div>
                <FonteBadge fonte={fonteMes} trinksAt={fonteTrinksAt} csvAt={fonteCsvAt} />
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <p className="text-3xl font-bold text-foreground" data-testid="resumo-faturamento">{formatCurrency(fatMes)}</p>
                {varFatPct != null && (
                  <span className={`text-xs font-semibold flex items-center gap-0.5 ${varFatPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {varFatPct >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                    {Math.abs(varFatPct).toFixed(1)}% vs mês anterior
                  </span>
                )}
              </div>
              <Progress value={Math.min(100, pctMeta)} className="h-2 my-2 bg-muted/40 [&>div]:bg-primary" />
              <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                <span className="font-semibold text-primary">{pctMeta.toFixed(1)}% da meta</span>
                {faltaMeta > 0 && <span className="text-muted-foreground">Falta {formatCurrency(faltaMeta)}</span>}
              </div>
              {duTotal > 0 && (
                <div className="mt-3 pt-3 border-t border-primary/20 flex items-center justify-between text-xs flex-wrap gap-2">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-primary" /> Projeção fim do mês ({duDecorr}/{duTotal} dias úteis)
                  </span>
                  <span className="font-bold text-foreground">{formatCurrency(projecaoMes)} <span className={`font-semibold ${pctProjMeta >= 100 ? "text-emerald-600" : "text-amber-600"}`}>({pctProjMeta.toFixed(0)}% da meta)</span></span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Metas da casa — 3 barras (Dia / Semana / Mês) do padrão Noite */}
          {isMesCorrente && (() => {
            const metaDia = 5000, metaSemana = 25000, metaMesCasa = target || 100000;
            const vDia = hoje?.total ?? revenueSummary.dayRevenue ?? 0;
            const vSemana = revenueSummary.weekRevenue ?? 0;
            const vMes = fatMes ?? revenueSummary.monthRevenue ?? 0;
            return (
              <Card className="bg-card border-card-border"><CardContent className="p-4 sm:p-5">
                <SectionHeader eyebrow="Metas da casa" title="Progresso do período" icon={<Target className="w-4 h-4 text-primary" />} />
                <div className="flex flex-col gap-3.5">
                  <GoalBar label="Hoje" current={formatCurrency(vDia)} target={formatCurrency(metaDia)} pct={(vDia / metaDia) * 100} />
                  <GoalBar label="Semana" current={formatCurrency(vSemana)} target={formatCurrency(metaSemana)} pct={(vSemana / metaSemana) * 100} />
                  <GoalBar label="Mês" current={formatCurrency(vMes)} target={formatCurrency(metaMesCasa)} pct={(vMes / metaMesCasa) * 100} />
                </div>
              </CardContent></Card>
            );
          })()}

          {/* Cards de métricas — padrão Noite (KPI com chip de ícone) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile
              label="Ticket médio"
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              value={formatCurrency(ticketMes)}
              data-testid="resumo-ticket"
              sub={varTicketPct != null ? `${varTicketPct >= 0 ? "▲" : "▼"} ${Math.abs(varTicketPct).toFixed(1)}% vs mês ant.` : undefined}
              subTone={varTicketPct != null ? (varTicketPct >= 0 ? "up" : "down") : "muted"}
            />
            <KpiTile
              label="Comandas"
              icon={<BarChart3 className="w-3.5 h-3.5" />}
              value={comandasMes}
              data-testid="resumo-comandas"
              sub={mediaComandasDiaUtil > 0 ? `${mediaComandasDiaUtil.toFixed(1)}/dia útil` : undefined}
            />
            <KpiTile
              label="Serviços / Produtos"
              icon={<Package className="w-3.5 h-3.5" />}
              accent="violet"
              value={<span className="text-[19px]">{formatCurrency(servicosMes)}</span>}
              sub={<>serv. · <b className="text-foreground">{formatCurrency(produtosMes)}</b> prod.</>}
            />
            <KpiTile
              label="Retenção"
              icon={<Users className="w-3.5 h-3.5" />}
              accent="emerald"
              value={`${retornoMes.toFixed(0)}%`}
              data-testid="resumo-retencao"
              sub={`${novosClientesMes} novos clientes`}
            />
          </div>

          {/* ── Fase 2: cards de cliente (Ranking de Clientes importado) ── */}
          {clientesMes && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="resumo-clientes">
              {/* Cards do MÊS — só com export mensal */}
              {clientesMes.temMensal && (
                <>
                  {/* Clientes ativos / novos no mês */}
                  <Card className="bg-card border-card-border"><CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1"><UserPlus className="w-4 h-4 text-primary" /><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Clientes no mês</span></div>
                    <p className="text-xl font-bold" data-testid="clientes-total">{clientesMes.totalClientes}</p>
                    <span className="text-[11px] text-muted-foreground">{clientesMes.novosNoMes} novos</span>
                  </CardContent></Card>
                  {/* Recompra */}
                  <Card className="bg-card border-card-border"><CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1"><Repeat className="w-4 h-4 text-primary" /><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Recompra</span></div>
                    <p className="text-xl font-bold" data-testid="clientes-recompra">{Number(clientesMes.recompraPct || 0).toFixed(1)}%</p>
                    <span className="text-[11px] text-muted-foreground">veio + de 1 vez no mês</span>
                  </CardContent></Card>
                </>
              )}
              {/* Clientes sumidos (60+ dias) — card de alerta */}
              {clientesMes.clientesSumidos && (
                <Card className="bg-card border-amber-500/30"><CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-amber-600" /><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Sumidos (60+ dias)</span></div>
                  <p className="text-xl font-bold text-amber-600" data-testid="clientes-sumidos">{clientesMes.clientesSumidos.total || 0}</p>
                  {(clientesMes.clientesSumidos.lista?.length || 0) > 0 ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-[11px] text-primary underline underline-offset-2" data-testid="clientes-sumidos-ver">ver lista</button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 max-h-80 overflow-y-auto">
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1"><UserMinus className="w-3.5 h-3.5 text-amber-600" /> Mais recuperáveis primeiro</p>
                        <div className="space-y-1">
                          {clientesMes.clientesSumidos.lista.map((c: any, i: number) => (
                            <div key={i} className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate">{c.nome}</span>
                              <span className="text-muted-foreground tabular-nums flex-shrink-0">{c.diasSemVir}d</span>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : clientesMes.clientesSumidos.fonte === "mensal" ? (
                    <span className="text-[11px] text-muted-foreground">importe a base (janela longa)</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">nenhum</span>
                  )}
                </CardContent></Card>
              )}
              {/* Ticket médio por cliente — só com export mensal */}
              {clientesMes.temMensal && (
                <Card className="bg-card border-card-border"><CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1"><Target className="w-4 h-4 text-primary" /><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Ticket / cliente</span></div>
                  <p className="text-xl font-bold" data-testid="clientes-ticket">{formatCurrency(clientesMes.ticketMedioClientes || 0)}</p>
                  <span className="text-[11px] text-muted-foreground">gasto médio por cliente</span>
                </CardContent></Card>
              )}
            </div>
          )}

          {/* Ranking de produção — padrão Noite (mini-barra por barbeiro) */}
          {topProfsMes.length > 0 && (() => {
            const maxProf = Math.max(1, ...topProfsMes.map((p: any) => p.faturamento?.total || 0));
            return (
              <Card className="bg-card border-card-border"><CardContent className="p-4">
                <SectionHeader eyebrow="Equipe" title="Ranking de produção · mês" icon={<Users className="w-4 h-4 text-primary" />} />
                <div className="flex flex-col gap-3">
                  {topProfsMes.map((p: any, i: number) => (
                    <div key={p.id} data-testid={`resumo-topprof-${i}`}>
                      <RankRow
                        pos={i + 1}
                        lead={i === 0}
                        name={(p.nome || "").split(" - ").pop()}
                        amount={formatCurrency(p.faturamento?.total || 0)}
                        pct={((p.faturamento?.total || 0) / maxProf) * 100}
                        sub={`tkt ${formatCurrency(p.ticketMedio || 0)} · ret ${Number(p.pctRetorno || 0).toFixed(0)}%`}
                      />
                    </div>
                  ))}
                </div>
              </CardContent></Card>
            );
          })()}
        </div>
      )}

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
                    {hoje.breakdown.cartao > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">Cartão {formatCurrency(hoje.breakdown.cartao)}</span>}
                    {hoje.breakdown.dinheiro > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">Dinheiro {formatCurrency(hoje.breakdown.dinheiro)}</span>}
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
                      ? "bg-emerald-500/15 text-emerald-600"
                      : hojeCompleto && hojeCompleto.progressoPct >= 70
                        ? "bg-amber-500/15 text-amber-600"
                        : "bg-red-500/15 text-red-600"
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
                    <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Já fechado
                    </p>
                    <p className="text-xl sm:text-2xl font-bold text-emerald-600" data-testid="hoje-fechado">
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
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-xs font-medium text-emerald-600">
                            Dia vai bater a meta ({formatPercent(hojeCompleto.progressoPct)})
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle
                            className={`w-3.5 h-3.5 ${
                              hojeCompleto.progressoPct >= 70 ? "text-amber-600" : "text-red-600"
                            }`}
                          />
                          <span
                            className={`text-xs font-medium ${
                              hojeCompleto.progressoPct >= 70 ? "text-amber-600" : "text-red-600"
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
                              <span className="text-[11px] text-emerald-600 font-semibold">
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
                            <td className="p-2 text-right font-semibold whitespace-nowrap text-emerald-600">
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
                      ? "bg-emerald-500/15 text-emerald-600"
                      : amanha && amanha.progressoPct >= 70
                        ? "bg-amber-500/15 text-amber-600"
                        : "bg-red-500/15 text-red-600"
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
                        amanha.atingeMeta ? "text-emerald-600" : "text-red-600"
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
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-xs font-medium text-emerald-600">
                            Meta atingida — {formatPercent(amanha.progressoPct)}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle
                            className={`w-3.5 h-3.5 ${
                              amanha.progressoPct >= 70 ? "text-amber-600" : "text-red-600"
                            }`}
                          />
                          <span
                            className={`text-xs font-medium ${
                              amanha.progressoPct >= 70 ? "text-amber-600" : "text-red-600"
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

      {/* Reconciliação de fontes — "tudo tem que se comunicar" */}
      <ReconciliacaoFontes mes={selectedMes} apiBase={API_BASE} />

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
                    stroke="#AF0000"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#AF0000" }}
                    activeDot={{ r: 5, fill: "#E23B2E" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
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
                            ? "#AF0000"
                            : index < 3
                              ? "#7A0F0F"
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
            <p className="font-medium text-amber-600 mb-1">⚠️ Bot não configurado</p>
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
            <Package className="w-4 h-4 text-amber-600" />
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
                  <div className={`text-[10px] uppercase tracking-wide ${p.nivel === "critico" ? "text-red-600" : "text-amber-600"}`}>
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

// v96: TrinksCotaControls removido — a cota/consumo da Trinks é gerida no Greco
// Metas (fonte única). Aqui virava número duplicado.

// ─── v67: Retenção de Clientes (jan–jun) — entender o gargalo ─────────────────
const NOME_MES_RET: Record<string, string> = { "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez" };

// ─── v96: Ranking de Colaboradores (evolução mês a mês) ──────────────────────
// Melhor→pior por faturamento médio/mês, com média de atendimentos/mês,
// ticket médio e tendência (evoluindo/estagnado/decrescendo). Fonte: /api/equipe/evolucao.
function RankingColaboradores() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [d, setD] = useState<any>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/equipe/evolucao?meses=6`).then((r) => r.json()).then((x) => { if (x?.ok) setD(x); else setErro(true); }).catch(() => setErro(true));
  }, [API_BASE]);
  if (erro || !d || !d.colaboradores?.length) return null;

  const rotMes = (m: string) => NOME_MES_RET[m.slice(5)] || m;
  const janela = d.meses?.length ? `${rotMes(d.meses[0])}–${rotMes(d.meses[d.meses.length - 1])}` : "";
  const fmtR = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const apelido = (nome: string) => (String(nome || "").split(/[-–—]/)[0].trim() || String(nome || ""));
  const n = d.colaboradores.length;

  const trendBadge = (t: string) => {
    if (t === "evoluindo") return <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-semibold"><ArrowUp className="w-3.5 h-3.5" />evoluindo</span>;
    if (t === "decrescendo") return <span className="inline-flex items-center gap-1 text-red-500 text-xs font-semibold"><ArrowDown className="w-3.5 h-3.5" />decrescendo</span>;
    return <span className="inline-flex items-center gap-1 text-muted-foreground text-xs font-semibold"><Minus className="w-3.5 h-3.5" />estagnado</span>;
  };

  return (
    <div className="rounded-2xl border-2 border-amber-500/40 ring-1 ring-white/10 bg-card p-5" data-testid="ranking-colaboradores">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-amber-500 font-semibold flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5" />Ranking de Colaboradores</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Melhor → pior por faturamento médio/mês · {janela} · fonte: ranking Trinks (CSV)</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
              <th className="text-left py-2 px-2">#</th>
              <th className="text-left py-2 px-2">Colaborador</th>
              <th className="text-right py-2 px-2">Atend./mês</th>
              <th className="text-right py-2 px-2">Ticket médio</th>
              <th className="text-right py-2 px-2 hidden sm:table-cell">Fat. médio/mês</th>
              <th className="text-right py-2 px-2">Tendência</th>
            </tr>
          </thead>
          <tbody>
            {d.colaboradores.map((c: any) => {
              const melhor = c.posicao === 1;
              const pior = c.posicao === n && n > 1;
              return (
                <tr key={c.id} className={`border-b border-border/40 ${melhor ? "bg-emerald-500/5" : pior ? "bg-red-500/5" : ""}`} data-testid={`colab-${c.id}`}>
                  <td className="py-2 px-2 tabular-nums font-bold">
                    {melhor ? "🥇" : pior ? <span className="text-red-500">{c.posicao}º</span> : `${c.posicao}º`}
                  </td>
                  <td className="py-2 px-2">
                    <div className="font-medium">{apelido(c.nome)}</div>
                    <div className="text-[10px] text-muted-foreground">{c.mesesAtivos} {c.mesesAtivos === 1 ? "mês" : "meses"} c/ dados</div>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{c.mediaAtendMes.toLocaleString("pt-BR")}</td>
                  <td className="py-2 px-2 text-right tabular-nums">R$ {fmtR(c.ticketMedio)}</td>
                  <td className="py-2 px-2 text-right tabular-nums hidden sm:table-cell">R$ {fmtR(c.mediaFatMes)}</td>
                  <td className="py-2 px-2 text-right">{trendBadge(c.trend)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">Média/mês = total do período ÷ meses com dados. Ticket médio = faturamento ÷ atendimentos. Tendência compara a metade recente vs a antiga do faturamento (±8%). 🥇 melhor · último (vermelho) = atenção.</p>
    </div>
  );
}

function RetencaoClientes() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/clientes/retencao`).then((r) => r.json()).then((x) => { if (x?.ok) setD(x); }).catch(() => {});
  }, [API_BASE]);
  if (!d || !d.meses?.length) return null;
  const rot = (m: string) => NOME_MES_RET[m.slice(5)] || m;
  const apelidoNome = (s: string) => (String(s || "").trim().split(/[\s-]+/)[0] || "—");

  return (
    <div className="rounded-lg border border-card-border bg-card p-4 space-y-3" data-testid="retencao-clientes">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Users className="w-4 h-4 text-red-600" /> Retenção de Clientes
          {d.mesesDisponiveis?.length ? <span className="text-muted-foreground font-normal">({rot(d.mesesDisponiveis[0])}–{rot(d.mesesDisponiveis[d.mesesDisponiveis.length - 1])})</span> : null}
          {d.fonteMesCorrente === "metas-ao-vivo" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-semibold">● mês ao vivo (Metas)</span>}
        </h2>
        <span className="text-[11px] text-muted-foreground">{d.totalClientes.toLocaleString("pt-BR")} clientes únicos no período</span>
      </div>

      {/* destaques / gargalo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded border border-card-border/50 bg-background/30 p-2.5">
          <div className="text-[10px] text-muted-foreground">Vieram 1 vez só</div>
          <div className="text-lg font-bold text-red-600">{d.frequencia.pctUmaVisita}%</div>
          <div className="text-[10px] text-muted-foreground">{d.frequencia.umaVisita} clientes — não voltaram</div>
        </div>
        <div className="rounded border border-card-border/50 bg-background/30 p-2.5">
          <div className="text-[10px] text-muted-foreground">Inativos (sumidos ≥2 meses)</div>
          <div className="text-lg font-bold text-amber-600">{d.pctInativos}%</div>
          <div className="text-[10px] text-muted-foreground">{d.inativos} clientes perdidos</div>
        </div>
        <div className="rounded border border-card-border/50 bg-background/30 p-2.5">
          <div className="text-[10px] text-muted-foreground">Fiéis (4+ meses)</div>
          <div className="text-lg font-bold text-emerald-600">{d.pctFieis}%</div>
          <div className="text-[10px] text-muted-foreground">{d.fieis} clientes — sua base</div>
        </div>
        <div className="rounded border border-card-border/50 bg-background/30 p-2.5">
          <div className="text-[10px] text-muted-foreground">Voltaram 2+ vezes</div>
          <div className="text-lg font-bold text-foreground">{(d.frequencia.duasATres + d.frequencia.quatroMais).toLocaleString("pt-BR")}</div>
          <div className="text-[10px] text-muted-foreground">{d.totalClientes ? Math.round(((d.frequencia.duasATres + d.frequencia.quatroMais) / d.totalClientes) * 100) : 0}% recorrentes</div>
        </div>
      </div>

      {/* tabela mês a mês */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-1.5">Mês</th>
              <th className="text-right p-1.5">Foram</th>
              <th className="text-right p-1.5">Novos</th>
              <th className="text-right p-1.5">Voltaram</th>
              <th className="text-right p-1.5">Perderam*</th>
              <th className="text-right p-1.5">% retorno</th>
            </tr>
          </thead>
          <tbody>
            {d.meses.map((m: any) => (
              <tr key={m.mes} className="border-b border-border/30">
                <td className="p-1.5 font-medium">{rot(m.mes)}</td>
                <td className="p-1.5 text-right tabular-nums">{m.ativos}</td>
                <td className="p-1.5 text-right tabular-nums text-red-600">{m.novos}</td>
                <td className="p-1.5 text-right tabular-nums text-emerald-600">{m.retornaram}</td>
                <td className="p-1.5 text-right tabular-nums text-red-600">{m.perdidos || "—"}</td>
                <td className="p-1.5 text-right tabular-nums">{m.taxaRetorno}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-muted-foreground space-y-0.5">
        <p>● <strong>Perderam*</strong> = clientes que foram no mês anterior e não voltaram no mês seguinte (~{Math.round(d.meses.slice(1).reduce((s: number, m: any) => s + m.perdidos, 0) / Math.max(1, d.meses.length - 1))}/mês em média).</p>
        <p className="text-red-600">🎯 Gargalo: <strong>{d.frequencia.pctUmaVisita}% dos clientes vieram 1 vez só</strong>. Reduzir isso (1ª visita → 2ª) é onde está o maior ganho — campanha de retorno pra quem veio uma vez.</p>
      </div>

      {/* v96: Saúde da carteira + placar de reativação (base viva Reativar/Cobrar do Metas) */}
      {d.reativacao && (
        <div className="border-t border-border/50 pt-3 space-y-2" data-testid="reativacao-metas">
          <span className="text-[10px] uppercase tracking-[0.15em] text-emerald-500 font-semibold">Reativar/Cobrar · base viva do Metas</span>
          <div className="grid grid-cols-3 gap-2">
            {[
              { lbl: "Em dia", v: d.reativacao.saude?.emDia?.total || 0, cor: "text-emerald-600" },
              { lbl: "Atrasados", v: d.reativacao.saude?.atrasados?.total || 0, cor: "text-amber-600" },
              { lbl: "Sumidos", v: d.reativacao.saude?.sumidos?.total || 0, cor: "text-red-600" },
            ].map((x) => (
              <div key={x.lbl} className="rounded-lg bg-muted/40 border border-border p-2 text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{x.lbl}</div>
                <div className={`text-lg font-bold tabular-nums ${x.cor}`}>{x.v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            <span>✅ Reativados no mês: <strong className="text-emerald-600">{d.reativacao.placar?.reativadosMes || 0}</strong></span>
            <span>⏳ Aguardando voltar: <strong className="text-amber-600">{d.reativacao.placar?.aguardando || 0}</strong></span>
            {(d.reativacao.placar?.reativadosPorPessoa || []).slice(0, 3).map((p: any) => (
              <span key={p.pessoa}>{apelidoNome(p.pessoa)}: <strong className="text-foreground">{p.total}</strong></span>
            ))}
          </div>
        </div>
      )}

      {/* Lista pra reativar — prefere a base VIVA do Metas (telefone + quem atende + status) */}
      {Array.isArray(d.reativacao?.topReativar) && d.reativacao.topReativar.length > 0 ? (
        <details className="border-t border-border/50 pt-2">
          <summary className="text-xs font-semibold cursor-pointer text-amber-600">📞 Clientes pra reativar — {d.reativacao.totalReativar} sumidos (base viva do Metas, com telefone)</summary>
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto mt-2">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground border-b border-border sticky top-0 bg-card">
                <tr>
                  <th className="text-left p-1.5">Cliente</th>
                  <th className="text-left p-1.5">Telefone</th>
                  <th className="text-right p-1.5">Visitas</th>
                  <th className="text-right p-1.5">Sem vir</th>
                  <th className="text-left p-1.5 hidden sm:table-cell">Atende</th>
                  <th className="text-right p-1.5">Contato</th>
                </tr>
              </thead>
              <tbody>
                {d.reativacao.topReativar.map((c: any) => {
                  const tel = String(c.phone || "").replace(/\D/g, "");
                  const wa = tel.length >= 10 ? `https://wa.me/55${tel.slice(-11)}` : null;
                  const contatoLabel: Record<string, string> = { contacted: "contatado", responded: "respondeu", returned: "voltou", lost: "não volta" };
                  return (
                    <tr key={c.id} className="border-b border-border/20">
                      <td className="p-1.5 font-medium truncate max-w-[140px]" title={c.nome}>{c.nome}</td>
                      <td className="p-1.5">{wa ? <a href={wa} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">{c.phone}</a> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-1.5 text-right tabular-nums">{c.totalVisitas}</td>
                      <td className="p-1.5 text-right tabular-nums text-amber-600">{c.diasSemVir != null ? `${c.diasSemVir}d` : "—"}</td>
                      <td className="p-1.5 hidden sm:table-cell text-muted-foreground truncate max-w-[100px]" title={c.profissional || ""}>{apelidoNome(c.profissional || "—")}</td>
                      <td className="p-1.5 text-right">{c.statusContato ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{contatoLabel[c.statusContato] || c.statusContato}</span> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Base viva do Greco Metas (Reativar/Cobrar): clientes deduplicados, ordenados por dias sem vir, com telefone (clique = WhatsApp) e status de contato. Substitui a lista antiga do CSV.</p>
        </details>
      ) : Array.isArray(d.listaInativos) && d.listaInativos.length > 0 && (
        <details className="border-t border-border/50 pt-2">
          <summary className="text-xs font-semibold cursor-pointer text-amber-600">📞 Clientes pra reativar — {d.listaInativos.length} sumidos que já vinham (do mais valioso)</summary>
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto mt-2">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground border-b border-border sticky top-0 bg-card">
                <tr>
                  <th className="text-left p-1.5">Cliente</th>
                  <th className="text-right p-1.5">Visitas</th>
                  <th className="text-right p-1.5">Total gasto</th>
                  <th className="text-right p-1.5">Última visita</th>
                  <th className="text-right p-1.5">Sumido há</th>
                </tr>
              </thead>
              <tbody>
                {d.listaInativos.map((c: any, i: number) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="p-1.5 font-medium truncate max-w-[180px]" title={c.nome}>{c.nome}</td>
                    <td className="p-1.5 text-right tabular-nums">{c.visitas}</td>
                    <td className="p-1.5 text-right tabular-nums text-emerald-600">{formatCurrency(c.valorTotal)}</td>
                    <td className="p-1.5 text-right tabular-nums text-muted-foreground">{c.ultimaVisita ? `${c.ultimaVisita.slice(8, 10)}/${c.ultimaVisita.slice(5, 7)}` : "—"}</td>
                    <td className="p-1.5 text-right tabular-nums text-amber-600">{c.mesesSemVir} {c.mesesSemVir === 1 ? "mês" : "meses"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Clientes que vinham 2+ vezes e sumiram há 2+ meses, do que mais gastou pro que menos gastou. Contato pelo cadastro na Trinks. Fonte: Caixa (comparecimento real).</p>
        </details>
      )}
    </div>
  );
}

// ─── v68: Faturamento acumulado do ano (soma dos Caixas mensais) ─────────────
function FaturamentoAno() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [meses, setMeses] = useState<any[] | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/historico/mensal`).then((r) => r.json()).then((d) => { if (d?.ok) setMeses(d.meses || []); }).catch(() => {});
  }, [API_BASE]);
  if (!meses || meses.length === 0) return null;
  const total = meses.reduce((s, m) => s + (m.receita || 0), 0);
  const comandas = meses.reduce((s, m) => s + (m.comandas || 0), 0);
  const media = meses.length ? total / meses.length : 0;
  const melhor = meses.reduce((a, b) => (b.receita > a.receita ? b : a), meses[0]);
  const rot = (m: string) => (NOME_MES_RET[m.slice(5)] || m);
  return (
    <div className="rounded-2xl border-2 border-red-500/60 ring-1 ring-white/10 bg-card p-5" data-testid="faturamento-ano">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-red-600 font-semibold">Faturamento acumulado · 2026</div>
          <div className="text-3xl font-bold text-foreground tabular-nums">{formatCurrency(total)}</div>
          <div className="text-[11px] text-muted-foreground">
            {rot(meses[0].mes)}–{rot(meses[meses.length - 1].mes)} · {comandas.toLocaleString("pt-BR")} atendimentos
          </div>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Média/mês</div>
            <div className="font-semibold tabular-nums">{formatCurrency(media)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Melhor mês</div>
            <div className="font-semibold tabular-nums">{rot(melhor.mes)} · {formatCurrency(melhor.receita)}</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
        {meses.map((m, idx) => {
          const max = Math.max(...meses.map((x) => x.receita), 1);
          const ant = idx > 0 ? meses[idx - 1].receita : 0;
          const varPct = ant > 0 ? ((m.receita - ant) / ant) * 100 : null;
          const subiu = varPct !== null && varPct >= 0;
          return (
            <div key={m.mes} className="flex flex-col items-center gap-1 rounded-lg bg-muted/40 border border-border p-2" title={`${rot(m.mes)}: ${formatCurrency(m.receita)}`}>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{rot(m.mes)}</span>
              <span className="text-[13px] font-bold text-foreground tabular-nums leading-tight">{formatCurrency(m.receita)}</span>
              {varPct === null ? (
                <span className="text-[10px] text-muted-foreground">—</span>
              ) : (
                <span className={`text-[10px] font-semibold tabular-nums ${subiu ? "text-emerald-600" : "text-red-600"}`}>
                  {subiu ? "▲" : "▼"} {subiu ? "+" : ""}{varPct.toFixed(0)}%
                </span>
              )}
              <div className="w-full bg-muted/40 rounded h-1.5 overflow-hidden">
                <div className={`h-full rounded ${subiu || varPct === null ? "bg-emerald-500/50" : "bg-red-500/50"}`} style={{ width: `${Math.max(6, (m.receita / max) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">Fonte: Caixa da Trinks (mês corrente é parcial). % = variação vs. mês anterior. Atualiza ao importar cada mês.</p>
    </div>
  );
}

// ─── v86: Clientes atendidos & serviços executados mês a mês (evolução) ──────
function ClientesAtendidosMes() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [meses, setMeses] = useState<any[] | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/historico/mensal`).then((r) => r.json()).then((d) => { if (d?.ok) setMeses(d.meses || []); }).catch(() => {});
  }, [API_BASE]);
  if (!meses || meses.length === 0) return null;
  const rot = (m: string) => (NOME_MES_RET[m.slice(5)] || m);
  const maxC = Math.max(...meses.map((x) => x.clientesUnicos || 0), 1);
  const maxA = Math.max(...meses.map((x) => x.comandas || 0), 1);
  const totC = meses.reduce((s, m) => s + (m.clientesUnicos || 0), 0);
  const totA = meses.reduce((s, m) => s + (m.comandas || 0), 0);
  const varBadge = (atual: number, ant: number) => {
    if (!ant) return <span className="text-[10px] text-muted-foreground">—</span>;
    const v = ((atual - ant) / ant) * 100;
    const up = v >= 0;
    return <span className={`text-[10px] font-semibold tabular-nums ${up ? "text-emerald-600" : "text-red-600"}`}>{up ? "▲" : "▼"} {up ? "+" : ""}{v.toFixed(0)}%</span>;
  };
  return (
    <div className="rounded-2xl border-2 border-red-400/60 ring-1 ring-white/10 bg-card p-5" data-testid="clientes-atendidos-mes">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-red-600 font-semibold">Clientes & Serviços · 2026</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Evolução de clientes atendidos e serviços executados, mês a mês.</div>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="text-right"><div className="text-[10px] text-muted-foreground">Clientes (Jan–Jun)</div><div className="font-semibold tabular-nums text-foreground">{totC.toLocaleString("pt-BR")}</div></div>
          <div className="text-right"><div className="text-[10px] text-muted-foreground">Serviços (Jan–Jun)</div><div className="font-semibold tabular-nums text-foreground">{totA.toLocaleString("pt-BR")}</div></div>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {meses.map((m, idx) => {
          const antC = idx > 0 ? meses[idx - 1].clientesUnicos : 0;
          const antA = idx > 0 ? meses[idx - 1].comandas : 0;
          return (
            <div key={m.mes} className="flex flex-col gap-1.5 rounded-lg bg-muted/40 border border-border p-2.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">{rot(m.mes)}</span>
              {/* clientes */}
              <div className="flex flex-col items-center">
                <span className="text-[9px] text-red-600/70 uppercase tracking-wide">👤 clientes</span>
                <span className="text-base font-bold text-foreground tabular-nums leading-tight">{(m.clientesUnicos || 0).toLocaleString("pt-BR")}</span>
                {varBadge(m.clientesUnicos, antC)}
                <div className="w-full bg-muted/40 rounded h-1 mt-0.5 overflow-hidden"><div className="h-full bg-red-500/50" style={{ width: `${Math.max(6, (m.clientesUnicos / maxC) * 100)}%` }} /></div>
              </div>
              {/* serviços/atendimentos */}
              <div className="flex flex-col items-center pt-1.5 border-t border-border">
                <span className="text-[9px] text-emerald-600/70 uppercase tracking-wide">✂️ serviços</span>
                <span className="text-base font-bold text-foreground tabular-nums leading-tight">{(m.comandas || 0).toLocaleString("pt-BR")}</span>
                {varBadge(m.comandas, antA)}
                <div className="w-full bg-muted/40 rounded h-1 mt-0.5 overflow-hidden"><div className="h-full bg-emerald-500/50" style={{ width: `${Math.max(6, (m.comandas / maxA) * 100)}%` }} /></div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">Clientes = clientes únicos atendidos no mês. Serviços = atendimentos (comandas) realizados. % = variação vs. mês anterior. Fonte: Caixa da Trinks (mês recente pode ser parcial até reimportar o caixa).</p>
    </div>
  );
}

// ─── v86: Taxa de ocupação mês a mês ─────────────────────────────────────────
function OcupacaoMes() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/ocupacao`).then((r) => r.json()).then((x) => { if (x?.ok) setD(x); }).catch(() => {});
  }, [API_BASE]);
  if (!d || (d.meses || []).length === 0) return null;
  const rot = (m: string) => (NOME_MES_RET[m.slice(5)] || m);
  const meses = d.meses;
  const media = meses.length ? meses.reduce((s: number, m: any) => s + m.ocupacaoPct, 0) / meses.length : 0;
  const cor = (p: number) => (p >= 85 ? "text-red-600" : p >= 65 ? "text-emerald-600" : "text-foreground");
  const corBar = (p: number) => (p >= 85 ? "bg-red-500/60" : p >= 65 ? "bg-emerald-500/60" : "bg-red-500/60");
  return (
    <div className="rounded-2xl border-2 border-red-500/60 ring-1 ring-white/10 bg-card p-5" data-testid="ocupacao-mes">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-red-600 font-semibold">Taxa de Ocupação · 2026</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Quanto da agenda dos barbeiros foi ocupada. Sobra capacidade = dá pra crescer.</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Média do ano</div>
          <div className={`text-2xl font-bold tabular-nums ${cor(media)}`}>{media.toFixed(0)}%</div>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {meses.map((m: any) => (
          <div key={m.mes} className="flex flex-col items-center gap-1 rounded-lg bg-muted/40 border border-border p-2.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{rot(m.mes)}</span>
            <span className={`text-lg font-bold tabular-nums leading-tight ${cor(m.ocupacaoPct)}`}>{m.ocupacaoPct.toFixed(0)}%</span>
            <div className="w-full bg-muted/40 rounded h-1.5 overflow-hidden"><div className={`h-full ${corBar(m.ocupacaoPct)}`} style={{ width: `${Math.min(100, m.ocupacaoPct)}%` }} /></div>
            <span className="text-[9px] text-muted-foreground tabular-nums">{m.atendimentos} atend</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">Premissa: {d.nBarbeiros} barbeiros · ter–sex 11h, sáb 10h · {d.duracaoMin}min/atendimento. Branco &lt;65% (espaço) · verde 65–85% (saudável) · vermelho &gt;85% (no limite). Mês recente pode ser parcial.</p>
    </div>
  );
}

// ─── v75: Faturamento por fonte (onde atacar) ────────────────────────────────
// Serviços (caixa) divididos por função (barbeiro/assistente/secretaria via
// ranking) + Produtos + Planos como fatias próprias. Soma = faturamento total.
function funcaoDoProf(nome: string): "Barbeiros" | "Assistentes" | "Secretarias" {
  const n = (nome || "").toLowerCase();
  // Assistentes (desde jan): Fernanda, Ellen, Débora, Patricia, Larissa.
  // Larissa é dupla (secretaria/assistente) → nos SERVIÇOS conta como assistente.
  if (/fernanda|ellen|d[ée]bora|patr[íi]cia|larissa/.test(n)) return "Assistentes";
  // Secretarias (vendem produto, ~0 serviço): Camila, Bruna.
  if (/camila|bruna/.test(n)) return "Secretarias";
  return "Barbeiros";
}
function FaturamentoPorFonte() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [meses, setMeses] = useState<any[] | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/historico/mensal`).then(r => r.json()).then(d => { if (d?.ok) setMeses(d.meses || []); }).catch(() => {});
  }, [API_BASE]);
  if (!meses || meses.length === 0) return null;

  const totServico = meses.reduce((s, m) => s + (m.servico || 0), 0);
  const totProduto = meses.reduce((s, m) => s + (m.produto || 0), 0);
  const totPlano = meses.reduce((s, m) => s + (m.pacote || 0), 0);
  const totalGeral = totServico + totProduto + totPlano;

  // serviços por função + por profissional (dos meses com ranking)
  const porFuncao: Record<string, number> = { Barbeiros: 0, Assistentes: 0, Secretarias: 0 };
  const porProf: Record<string, { nome: string; func: string; servicos: number }> = {};
  const mesesComRanking = meses.filter(m => m.temRanking);
  for (const m of mesesComRanking) {
    for (const b of (m.barbeiros || [])) {
      const f = funcaoDoProf(b.nome);
      porFuncao[f] += b.servicos || 0;
      const chave = b.nome;
      if (!porProf[chave]) porProf[chave] = { nome: b.nome, func: f, servicos: 0 };
      porProf[chave].servicos += b.servicos || 0;
    }
  }
  const servNoRanking = porFuncao.Barbeiros + porFuncao.Assistentes + porFuncao.Secretarias;
  const profs = Object.values(porProf).filter(p => p.servicos > 0).sort((a, b) => b.servicos - a.servicos);

  const fmtPct = (v: number) => totalGeral > 0 ? `${Math.round((v / totalGeral) * 100)}%` : "—";
  const corFunc: Record<string, string> = { Barbeiros: "bg-red-500", Assistentes: "bg-violet-500", Secretarias: "bg-pink-500" };

  // fatias do total: serviços por função + produtos + planos
  const fatias = [
    { label: "Barbeiros (serviços)", valor: porFuncao.Barbeiros, cor: "bg-red-500" },
    { label: "Assistentes (serviços)", valor: porFuncao.Assistentes, cor: "bg-violet-500" },
    { label: "Secretarias (serviços)", valor: porFuncao.Secretarias, cor: "bg-pink-500" },
    { label: "Planos (Clube Greco)", valor: totPlano, cor: "bg-amber-500" },
    { label: "Produtos", valor: totProduto, cor: "bg-emerald-500" },
  ];
  // se ranking incompleto, mostra serviços não-distribuídos
  const servForaRanking = totServico - servNoRanking;

  return (
    <div className="rounded-2xl border-2 border-red-500/60 ring-1 ring-white/10 bg-card p-5 space-y-3" data-testid="faturamento-por-fonte">
      <h2 className="text-sm font-bold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Faturamento por fonte — onde atacar</h2>

      {/* fatias por tipo */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="rounded border border-card-border/50 bg-background/30 p-2.5"><div className="text-[10px] text-muted-foreground">Serviços</div><div className="text-lg font-bold text-red-600">{formatCurrency(totServico)}</div><div className="text-[10px] text-muted-foreground">{fmtPct(totServico)} do total</div></div>
        <div className="rounded border border-card-border/50 bg-background/30 p-2.5"><div className="text-[10px] text-muted-foreground">Planos (Clube)</div><div className="text-lg font-bold text-amber-600">{formatCurrency(totPlano)}</div><div className="text-[10px] text-muted-foreground">{fmtPct(totPlano)} do total</div></div>
        <div className="rounded border border-card-border/50 bg-background/30 p-2.5"><div className="text-[10px] text-muted-foreground">Produtos</div><div className="text-lg font-bold text-emerald-600">{formatCurrency(totProduto)}</div><div className="text-[10px] text-muted-foreground">{fmtPct(totProduto)} do total</div></div>
      </div>

      {/* serviços divididos por função */}
      <div>
        <div className="text-[11px] text-muted-foreground mb-1">Serviços por equipe {mesesComRanking.length < meses.length && <span className="text-amber-600">(ranking de {mesesComRanking.length} de {meses.length} meses — falta jan/fev)</span>}</div>
        <div className="space-y-1">
          {(["Barbeiros", "Assistentes", "Secretarias"] as const).map(f => (
            <div key={f} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-muted-foreground">{f}</span>
              <div className="flex-1 bg-muted/20 rounded h-4 relative overflow-hidden">
                <div className={`h-full ${corFunc[f]}/40 rounded`} style={{ width: `${servNoRanking > 0 ? (porFuncao[f] / servNoRanking) * 100 : 0}%` }} />
                <span className="absolute inset-y-0 left-2 flex items-center tabular-nums font-medium">{formatCurrency(porFuncao[f])}</span>
              </div>
              <span className="w-10 text-right text-muted-foreground tabular-nums">{servNoRanking > 0 ? Math.round((porFuncao[f] / servNoRanking) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* top profissionais */}
      {profs.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Top profissionais (serviços)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {profs.slice(0, 12).map((p, i) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="py-1 pr-2 truncate max-w-[180px]">{p.nome}</td>
                    <td className="py-1 pr-2"><span className={`text-[9px] px-1.5 py-0.5 rounded text-foreground ${corFunc[p.func] || "bg-slate-500"}/70`}>{p.func.slice(0, -1)}</span></td>
                    <td className="py-1 text-right tabular-nums font-semibold">{formatCurrency(p.servicos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">● Serviços por equipe vêm do ranking (mar–jun); produtos e planos do caixa (ano todo). Onde atacar: fatia pequena com potencial = oportunidade (ex.: produtos {fmtPct(totProduto)}).</p>
    </div>
  );
}

// ─── v77: Painel Executivo PREMIUM (Hoje · Semana · Mês) ─────────────────────
// Cores Greco: fundo preto · consolidados BRANCO · positivo VERDE · negativo
// VERMELHO · detalhe AZUL. Cada grupo na sua caixa colorida.
const _dm = (s: string) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "";
const _corPct = (p: number) => p >= 100 ? "text-emerald-600" : p >= 70 ? "text-red-600" : p >= 40 ? "text-amber-600" : "text-red-600";
const _corBar = (p: number) => p >= 100 ? "bg-emerald-500" : p >= 70 ? "bg-red-500" : p >= 40 ? "bg-amber-500" : "bg-red-500";

// Anel de progresso circular (SVG) — premium
function Anel({ pct, size = 76, stroke = 7 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  const cor = pct >= 100 ? "#34d399" : pct >= 70 ? "#a3e635" : pct >= 40 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={cor} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset .5s" }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="rotate-90" style={{ transformOrigin: "center" }} fill={cor} fontSize={size * 0.22} fontWeight="700">{pct}%</text>
    </svg>
  );
}
function Barra({ pct }: { pct: number }) {
  return <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden"><div className={`h-full ${_corBar(pct)} rounded-full`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

function PainelExecutivo() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [d, setD] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [hojeVivo, setHojeVivo] = useState<any>(null);  // v78: "Hoje ao vivo" carrega separado
  // v89: consulta por dia / semana (premium)
  const [modoConsulta, setModoConsulta] = useState<"dia" | "semana">("dia");
  const [dataConsulta, setDataConsulta] = useState<string>("");
  const [resConsulta, setResConsulta] = useState<any>(null);
  const [buscandoConsulta, setBuscandoConsulta] = useState(false);
  const buscarConsulta = (modo: "dia" | "semana", dt: string) => {
    setModoConsulta(modo); setDataConsulta(dt);
    if (!dt) { setResConsulta(null); return; }
    setBuscandoConsulta(true);
    const q = modo === "dia" ? `dia=${dt}` : `semanaFim=${dt}`;
    fetch(`${API_BASE}/api/dashboard/consultar?${q}`).then(r => r.json()).then(x => { if (x?.ok) setResConsulta(x); }).finally(() => setBuscandoConsulta(false));
  };
  useEffect(() => {
    fetch(`${API_BASE}/api/dashboard/painel`).then(r => r.json()).then(x => {
      if (x?.ok) setD(x);
    }).finally(() => setCarregando(false));
    // sempre busca o snapshot do último dia fechado (banco, 0 token) — pode ser
    // mais recente que o caixa CSV; preenche o card Hoje sem travar a tela.
    fetch(`${API_BASE}/api/dashboard/hoje`).then(r => r.json()).then(h => { if (h?.ok) setHojeVivo(h); }).catch(() => {});
  }, [API_BASE]);
  if (carregando) return <div className="rounded-2xl border-2 border-red-400/60 ring-1 ring-white/10 bg-card p-6 text-sm text-muted-foreground">Carregando painel…</div>;
  if (!d) return null;
  // v79: o snapshot (último dia fechado pelo cron) substitui o "último dia do caixa"
  // quando é mais recente — ambos vêm do banco (0 token).
  const hoje = (hojeVivo && hojeVivo.fonte === "snapshot" && hojeVivo.realizado > 0 && (!d.hoje?.data || hojeVivo.data >= d.hoje.data))
    ? { ...d.hoje, ...hojeVivo }
    : d.hoje;
  const { semana, mes } = d;
  const maxDia = Math.max(1, ...(mes.porDia || []).map((x: any) => x.valor));
  const metaDiaMes = mes.meta / 30;
  const addD = (ymd: string, n: number) => { const dt = new Date(ymd + "T12:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
  const hojeStr = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const metaConsulta = modoConsulta === "dia" ? (hoje.meta || 5000) : (semana.meta || 25000);
  const pctConsulta = resConsulta ? Math.round(((resConsulta.realizado || 0) / metaConsulta) * 100) : 0;

  const cats = [
    { lbl: "Serviços", v: semana.servicos, m: semana.metaServicos, ring: "ring-red-500/30", txt: "text-red-600", bar: "bg-red-500" },
    { lbl: "Planos", v: semana.planos, m: semana.metaPlanos, ring: "ring-amber-500/30", txt: "text-amber-600", bar: "bg-amber-500" },
    { lbl: "Produtos", v: semana.produtos, m: semana.metaProdutos, ring: "ring-emerald-500/30", txt: "text-emerald-600", bar: "bg-emerald-500" },
  ];

  return (
   <div className="space-y-3">
    {/* ───── CONSULTA por dia / semana (v89) ───── */}
    <div className="rounded-2xl border border-border bg-card p-4" data-testid="painel-busca">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-red-600" />
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Consultar período</span>
        </div>
        {/* toggle dia / semana */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {(["dia", "semana"] as const).map((m) => (
            <button key={m} onClick={() => buscarConsulta(m, dataConsulta || hojeStr)}
              className={`px-3 py-1 transition-colors ${modoConsulta === m ? "bg-red-500/20 text-red-300 font-semibold" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`consulta-modo-${m}`}>{m === "dia" ? "Dia" : "Semana"}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* navegação ← data → */}
        <button onClick={() => dataConsulta && buscarConsulta(modoConsulta, addD(dataConsulta, modoConsulta === "dia" ? -1 : -7))}
          className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:bg-muted flex items-center justify-center" data-testid="consulta-prev">‹</button>
        <input type="date" value={dataConsulta} max={hojeStr} onChange={(e) => buscarConsulta(modoConsulta, e.target.value)}
          className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground [color-scheme:light]" data-testid="consulta-data" />
        <button onClick={() => dataConsulta && buscarConsulta(modoConsulta, addD(dataConsulta, modoConsulta === "dia" ? 1 : 7))}
          disabled={!dataConsulta || dataConsulta >= hojeStr}
          className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 flex items-center justify-center" data-testid="consulta-next">›</button>
        {/* atalhos */}
        <div className="flex gap-1.5 ml-1 flex-wrap">
          <button onClick={() => buscarConsulta("dia", addD(hojeStr, -1))} className="px-2.5 py-1 rounded-lg border border-border text-[11px] text-muted-foreground hover:bg-muted">Ontem</button>
          <button onClick={() => buscarConsulta("semana", hojeStr)} className="px-2.5 py-1 rounded-lg border border-border text-[11px] text-muted-foreground hover:bg-muted">Esta semana</button>
          <button onClick={() => buscarConsulta("semana", addD(hojeStr, -7))} className="px-2.5 py-1 rounded-lg border border-border text-[11px] text-muted-foreground hover:bg-muted">Semana passada</button>
        </div>
      </div>

      {/* resultado em card */}
      {buscandoConsulta && !resConsulta && <div className="text-xs text-muted-foreground mt-3">Buscando…</div>}
      {resConsulta && (
        <div className="mt-3 rounded-xl border border-red-400/30 bg-muted/40 p-4 flex items-center gap-4" data-testid="consulta-resultado">
          {(resConsulta.tipo === "dia" && !resConsulta.encontrado) ? (
            <div className="text-sm text-muted-foreground">📭 {_dm(resConsulta.data)} — sem fechamento registrado nesse dia (domingo/segunda fechado, ou ainda não importado).</div>
          ) : (
            <>
              <Anel pct={pctConsulta} />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-red-600/70">
                  {resConsulta.tipo === "dia" ? `Dia ${_dm(resConsulta.data)}` : `Semana ${_dm(resConsulta.inicio)} – ${_dm(resConsulta.fim)}`}
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums leading-tight">{formatCurrency(resConsulta.realizado)}</div>
                <div className="text-[11px] text-muted-foreground">{pctConsulta}% da meta ({formatCurrency(metaConsulta)})
                  {resConsulta.tipo === "dia" && resConsulta.atendimentos > 0 && <span className="text-red-600/80"> · {resConsulta.atendimentos} atendimentos</span>}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* ───── ÚLTIMO FECHAMENTO (ontem) ───── */}
      <div className="rounded-2xl border-2 border-red-400/60 ring-1 ring-white/10 bg-card p-5" data-testid="painel-hoje">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] uppercase tracking-[0.25em] text-red-600 font-semibold">{hoje.ehHoje ? "Hoje" : "Último fechamento"}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border ${hoje.ehHoje ? "border-emerald-500/40 text-emerald-600" : "border-red-500/40 text-red-600"}`}>
            {hoje.ehHoje ? "● hoje" : `${_dm(hoje.data)}`}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Anel pct={hoje.pct} />
          <div className="min-w-0">
            <div className="text-2xl font-bold text-foreground tabular-nums leading-tight">{formatCurrency(hoje.realizado)}</div>
            <div className="text-[11px] text-muted-foreground">de {formatCurrency(hoje.meta)}</div>
            <div className="text-[11px] text-red-600/80 mt-1">{hoje.atendimentos} atendimentos</div>
          </div>
        </div>
        {hoje.trinks429 && <div className="text-[9px] text-amber-600/80 mt-3">⚠ Trinks indisponível — último dia fechado</div>}
      </div>

      {/* ───── SEMANA ───── */}
      <div className="rounded-2xl border-2 border-red-500/60 ring-1 ring-white/10 bg-card p-5" data-testid="painel-semana">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-[0.25em] text-red-600 font-semibold">Semana</span>
          <span className="text-[10px] text-muted-foreground">{_dm(semana.inicio)}–{_dm(semana.fim)}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(semana.realizado)}</span>
          <span className={`text-sm font-bold tabular-nums ${_corPct(semana.pct)}`}>{semana.pct}%</span>
        </div>
        <div className="text-[11px] text-muted-foreground mb-2">de {formatCurrency(semana.meta)}</div>
        <Barra pct={semana.pct} />
        <div className="grid grid-cols-3 gap-2 mt-3">
          {cats.map(c => {
            const p = c.m > 0 ? Math.round((c.v / c.m) * 100) : 0;
            return (
              <div key={c.lbl} className={`rounded-lg bg-muted/40 ring-1 ${c.ring} p-2`}>
                <div className={`text-[9px] uppercase tracking-wide ${c.txt} font-semibold`}>{c.lbl}</div>
                <div className="text-sm font-bold text-foreground tabular-nums my-0.5">{formatCurrency(c.v)}</div>
                <div className="h-1 rounded-full bg-muted/40 overflow-hidden mb-1"><div className={`h-full ${c.bar} rounded-full`} style={{ width: `${Math.min(100, p)}%` }} /></div>
                <div className="text-[9px] text-muted-foreground tabular-nums">{p}% · meta {formatCurrency(c.m)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ───── MÊS ───── */}
      <div className="rounded-2xl border-2 border-red-400/60 ring-1 ring-white/10 bg-card p-5" data-testid="painel-mes">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-[0.25em] text-red-600 font-semibold">Mês · {mes.mes}</span>
          <span className={`text-sm font-bold tabular-nums ${_corPct(mes.pct)}`}>{mes.pct}%</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(mes.realizado)}</span>
        </div>
        <div className="text-[11px] text-muted-foreground mb-2">de {formatCurrency(mes.meta)}{mes.melhorDia && <> · melhor {_dm(mes.melhorDia.dia)} <span className="text-emerald-600">{formatCurrency(mes.melhorDia.valor)}</span></>}</div>
        <Barra pct={mes.pct} />
        <div className="flex items-end gap-[2px] mt-3 h-16">
          {(mes.porDia || []).map((x: any) => (
            <div key={x.dia} className="flex-1 group relative flex flex-col justify-end h-full" title={`${_dm(x.dia)}: ${formatCurrency(x.valor)}`}>
              <div className={`w-full rounded-sm ${x.valor >= metaDiaMes ? "bg-emerald-500/70" : "bg-red-500/60"}`} style={{ height: `${Math.max(8, (x.valor / maxDia) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5"><span>{mes.porDia?.[0] && _dm(mes.porDia[0].dia)}</span><span className="text-emerald-600/60">▮ acima</span><span className="text-red-600/60">▮ abaixo R${Math.round(metaDiaMes)}/dia</span><span>{mes.porDia?.length ? _dm(mes.porDia[mes.porDia.length - 1].dia) : ""}</span></div>
      </div>
    </div>
   </div>
  );
}

// ─── v80: Aviso de atualização de CSVs — minimalista, 1º item do dashboard ───
function AvisoCSV() {
  const API_BASE = (globalThis as any).__API_BASE__ || "";
  const [a, setA] = useState<any>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/dashboard/avisos-csv`).then(r => r.json()).then(x => { if (x?.ok) setA(x); }).catch(() => {});
  }, [API_BASE]);
  if (!a) return null;
  const atual = !a.desatualizado;
  const partes: string[] = [];
  if (a.ultimoCaixaData) partes.push(`dados até ${a.ultimoCaixaData.slice(8, 10)}/${a.ultimoCaixaData.slice(5, 7)}${a.diasDesde > 0 ? ` (${a.diasDesde}d atrás)` : ""}`);
  if (a.faltando?.length) partes.push(`falta: ${a.faltando.join(", ")}`);

  return (
    <Link href="/importar-trinks">
      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors ${atual
          ? "border border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-300/80 hover:bg-emerald-500/[0.08]"
          : "border border-amber-500/30 bg-amber-500/[0.06] text-amber-300 hover:bg-amber-500/[0.1]"}`}
        data-testid="aviso-csv"
      >
        <span>{atual ? "✓" : "📋"}</span>
        <span className="flex-1 truncate">
          {atual ? "CSVs em dia." : "Lembre de atualizar os CSVs"}
          {partes.length > 0 && <span className="text-muted-foreground"> · {partes.join(" · ")}</span>}
        </span>
        <span className="text-[10px] opacity-70 whitespace-nowrap">Importar Trinks →</span>
      </div>
    </Link>
  );
}
