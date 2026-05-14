import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/demoData";
import { useLocation } from "wouter";
import {
  Users, DollarSign, Search, Plus, Trash2, XCircle, CheckCircle,
  Crown, FileText, ExternalLink, Upload, AlertTriangle, Calendar, Clock,
  Eye, X, Pencil, Banknote, UserPlus,
} from "lucide-react";

const API_BASE = (globalThis as any).__API_BASE__ || "";

const DURATION_OPTIONS = [
  { value: "3", label: "3 meses" },
  { value: "6", label: "6 meses" },
  { value: "12", label: "12 meses" },
];
const STATUS_STYLES: Record<string, { label: string; class: string }> = {
  em_dia: { label: "Em dia", class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/40" },
  inadimplente: { label: "Inadimplente", class: "bg-red-500/10 text-red-400 border-red-500/40" },
  cancelado: { label: "Cancelado", class: "bg-muted text-muted-foreground border-border" },
  expirado: { label: "Expirado", class: "bg-amber-500/10 text-amber-400 border-amber-500/40" },
};
const COLORS = ["#01696F", "#22c55e", "#3b82f6", "#eab308", "#ef4444"];

interface PagamentoMensal {
  mes: string;
  pago: boolean;
  pagoEm?: string;
  valor: number;
  formaPagamento?: 'dinheiro' | 'pix' | 'cartao' | 'infinitepay' | 'outro';
  contaId?: string;
  dataPagamento?: string;
  transacaoBancoId?: string;
}
interface Cliente {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  plan: string;
  planValue: number;
  contractDate: string;
  contractDurationMonths: number;
  contractEndDate: string;
  contractUrl?: string;
  contractFileName?: string;
  paymentDay: number;
  payments: PagamentoMensal[];
  status: string;
  paymentStatus: string;
  notes?: string;
  createdAt: string;
  seller?: string;
  commissionPct?: number;
  commissionPctEfetivo?: number;
  commissionPctFonte?: 'cliente' | 'global';
  comissaoMensalRS?: number;       // legado — sempre 0 com a nova regra
  comissaoAcumuladaRS?: number;    // bônus já recebido (1ª parcela paga)
  comissaoBonusRS?: number;        // valor do bônus (potencial ou recebido)
  comissaoPaga?: boolean;          // true se a 1ª parcela foi paga
  primeiraParcelaMes?: string;     // YYYY-MM da 1ª parcela
  mesesPagos?: number;
}
interface RankingComissao {
  seller: string;
  assinantes: number;
  mesesPagos: number;
  comissaoAcumuladaRS: number;     // bônus de 1ª parcela já pagos
  comissaoPendenteRS: number;      // bônus aguardando 1ª parcela
  comissaoMesAtualRS: number;      // bônus creditados neste mês
  receitaMensalRS: number;
}
interface SugestaoExtrato {
  clienteId: string;
  clienteNome: string;
  mes: string;
  planValue: number;
  transacao: { id: string; date: string; amount: number; description: string; contaId: string; contaNome: string };
}
interface DashboardStats {
  totalAssinantes: number;
  ativos: number;
  inadimplentes: number;
  cancelados: number;
  monthlyRevenue: number;
  planDistribution: { name: string; count: number }[];
  vencendoEmBreve: number;
  pctPlanoPadrao?: number;
  rankingComissoes?: RankingComissao[];
  totalComissaoMesAtual?: number;
  totalComissaoAcumulada?: number;
  assinantesSemVendedor?: number;
}

// Gera lista de meses do contrato
function getContractMonths(contractDate: string, durationMonths: number): string[] {
  const months: string[] = [];
  const d = new Date(contractDate);
  for (let i = 0; i < durationMonths; i++) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

function formatDateBR(s: string): string {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMonthBR(s: string): string {
  const [y, m] = s.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${names[parseInt(m) - 1]}/${y}`;
}

// ─── Main Page ─────────────────────────────────────────────
export default function Assinaturas() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "em_dia" | "inadimplente" | "cancelado">("todos");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [sugestoes, setSugestoes] = useState<SugestaoExtrato[]>([]);
  const [aplicandoSugestoes, setAplicandoSugestoes] = useState(false);
  const loadData = () => {
    setLoading(true);
    const mesAtual = new Date().toISOString().slice(0, 7);
    Promise.all([
      fetch(`${API_BASE}/api/assinaturas/clientes`).then(r => r.json()),
      fetch(`${API_BASE}/api/assinaturas/dashboard`).then(r => r.json()),
      fetch(`${API_BASE}/api/assinaturas/sugestoes-extrato?mes=${mesAtual}`).then(r => r.json()),
    ]).then(([c, s, sug]) => {
      setClientes(Array.isArray(c) ? c : []);
      setStats(s);
      setSugestoes(sug?.sugestoes || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { loadData(); }, []);

  const aplicarTodasSugestoes = async () => {
    if (sugestoes.length === 0) return;
    setAplicandoSugestoes(true);
    try {
      const res = await fetch(`${API_BASE}/api/assinaturas/sugestoes-extrato/aplicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: sugestoes.map(s => ({ clienteId: s.clienteId, mes: s.mes, transacaoId: s.transacao.id })),
        }),
      });
      if (res.ok) {
        const d = await res.json();
        toast({ title: `${d.aplicados} pagamento(s) vinculado(s) ao extrato` });
        loadData();
      }
    } finally { setAplicandoSugestoes(false); }
  };

  const filtered = useMemo(() => {
    let list = clientes;
    if (filtro !== "todos") list = list.filter(c => c.paymentStatus === filtro);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.phone?.includes(q));
    }
    return list;
  }, [clientes, filtro, search]);

  const cancelar = async (id: string) => {
    if (!confirm("Cancelar esta assinatura?")) return;
    await fetch(`${API_BASE}/api/assinaturas/clientes/${id}/cancelar`, { method: "PUT" });
    toast({ title: "Assinatura cancelada" });
    loadData();
  };
  const excluir = async (id: string) => {
    if (!confirm("Excluir este assinante? Esta ação não pode ser desfeita.")) return;
    await fetch(`${API_BASE}/api/assinaturas/clientes/${id}`, { method: "DELETE" });
    toast({ title: "Assinante excluído" });
    loadData();
  };

  const inadCount = clientes.filter(c => c.paymentStatus === "inadimplente").length;

  return (
    <div className="space-y-5 max-w-[1400px] pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-primary" /> Clube Greco
          </h1>
          <p className="text-sm text-muted-foreground">Gestão de assinaturas e contratos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setLocation("/consolidacao")} title="Ver extrato InfinitePay">
            <Banknote className="w-3.5 h-3.5 mr-1.5" /> Extrato InfinitePay
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowBulk(true)} title="Atribuir vendedor a vários assinantes de uma vez">
            <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Atribuir vendedor em lote
            {(stats?.assinantesSemVendedor || 0) > 0 && (
              <span className="ml-1.5 bg-amber-500/20 text-amber-400 text-[9px] px-1.5 py-0.5 rounded-full">
                {stats?.assinantesSemVendedor}
              </span>
            )}
          </Button>
          <Button size="sm" className="bg-primary hover:bg-primary/80 text-white" onClick={() => { setEditingId(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Novo Assinante
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Users className="w-3.5 h-3.5 text-primary" /><span className="text-[10px] text-muted-foreground font-medium uppercase">Ativos</span></div>
            <p className="text-xl font-bold">{stats?.ativos ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><DollarSign className="w-3.5 h-3.5 text-emerald-400" /><span className="text-[10px] text-muted-foreground font-medium uppercase">Receita/mês</span></div>
            <p className="text-xl font-bold text-emerald-400">{formatCurrency(stats?.monthlyRevenue ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className={`border-card-border ${inadCount > 0 ? "bg-red-500/5 border-red-500/20" : "bg-card"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><AlertTriangle className={`w-3.5 h-3.5 ${inadCount > 0 ? "text-red-400" : "text-muted-foreground"}`} /><span className="text-[10px] text-muted-foreground font-medium uppercase">Inadimplentes</span></div>
            <p className={`text-xl font-bold ${inadCount > 0 ? "text-red-400" : ""}`}>{stats?.inadimplentes ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Clock className="w-3.5 h-3.5 text-amber-400" /><span className="text-[10px] text-muted-foreground font-medium uppercase">Vencendo em 30d</span></div>
            <p className="text-xl font-bold">{stats?.vencendoEmBreve ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><XCircle className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[10px] text-muted-foreground font-medium uppercase">Cancelados</span></div>
            <p className="text-xl font-bold text-muted-foreground">{stats?.cancelados ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Comissões de Assinaturas — bônus único de % na 1ª parcela paga */}
      {(() => {
        const ranking = stats?.rankingComissoes || [];
        const pctPadrao = stats?.pctPlanoPadrao ?? 20;
        const totalMes = stats?.totalComissaoMesAtual || 0;
        const totalAcum = stats?.totalComissaoAcumulada || 0;
        const semVendedor = stats?.assinantesSemVendedor || 0;
        if (ranking.length === 0 && semVendedor === 0) return null;
        return (
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  Comissões de Assinaturas <span className="text-[10px] text-muted-foreground font-normal">(bônus único de {pctPadrao}% na 1ª parcela)</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-400">
                    Bônus pagos no mês: <strong>{formatCurrency(totalMes)}</strong>
                  </span>
                  <span className="text-muted-foreground">
                    Total pago: <strong>{formatCurrency(totalAcum)}</strong>
                  </span>
                  {semVendedor > 0 && (
                    <span className="text-amber-400" title="Assinantes sem vendedor cadastrado">
                      <AlertTriangle className="w-3 h-3 inline mr-1" />{semVendedor} sem vendedor
                    </span>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ranking.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  Nenhum vendedor cadastrado ainda. Edite os assinantes e informe quem vendeu para começar a contabilizar a comissão.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Vendedor</th>
                        <th className="text-right py-2 px-2 font-medium">Vendas</th>
                        <th className="text-right py-2 px-2 font-medium hidden md:table-cell">Receita ativa/mês</th>
                        <th className="text-right py-2 px-2 font-medium">Bônus no mês</th>
                        <th className="text-right py-2 px-2 font-medium">Bônus pago</th>
                        <th className="text-right py-2 px-2 font-medium hidden md:table-cell">Bônus pendente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map(r => (
                        <tr key={r.seller} className="border-b border-border/50">
                          <td className="py-2 px-2 font-medium">{r.seller}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.assinantes}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-muted-foreground hidden md:table-cell">{formatCurrency(r.receitaMensalRS)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-emerald-400 font-semibold">{formatCurrency(r.comissaoMesAtualRS)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-semibold">{formatCurrency(r.comissaoAcumuladaRS)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-amber-400 hidden md:table-cell">{formatCurrency(r.comissaoPendenteRS || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Vencimento de contratos — atenção pra renovação */}
      {(() => {
        const hoje = Date.now();
        const ativos = clientes.filter(c => c.status === "active" && c.contractEndDate);
        const proximos = ativos
          .map(c => ({
            ...c,
            diasParaVencer: Math.ceil((new Date(c.contractEndDate).getTime() - hoje) / 86400000),
          }))
          .filter(c => c.diasParaVencer >= 0 && c.diasParaVencer <= 90)
          .sort((a, b) => a.diasParaVencer - b.diasParaVencer);
        const vencidos = ativos
          .map(c => ({
            ...c,
            diasParaVencer: Math.ceil((new Date(c.contractEndDate).getTime() - hoje) / 86400000),
          }))
          .filter(c => c.diasParaVencer < 0)
          .sort((a, b) => a.diasParaVencer - b.diasParaVencer);
        if (proximos.length === 0 && vencidos.length === 0) return null;
        const totalReceitaProx30 = proximos
          .filter(c => c.diasParaVencer <= 30)
          .reduce((s, c) => s + (c.planValue || 0), 0);
        return (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Vencimento de contratos
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {vencidos.length > 0 && (
                    <span className="text-red-400">
                      <strong>{vencidos.length}</strong> vencido{vencidos.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="text-amber-400">
                    <strong>{proximos.filter(c => c.diasParaVencer <= 30).length}</strong> em 30 dias
                    {totalReceitaProx30 > 0 && ` • ${formatCurrency(totalReceitaProx30)}/mês em risco`}
                  </span>
                  <span className="text-muted-foreground">
                    <strong>{proximos.filter(c => c.diasParaVencer > 30 && c.diasParaVencer <= 90).length}</strong> em 31-90 dias
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left py-2 px-2 font-medium">Cliente</th>
                      <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Plano</th>
                      <th className="text-right py-2 px-2 font-medium">Valor</th>
                      <th className="text-right py-2 px-2 font-medium">Vence em</th>
                      <th className="text-right py-2 px-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...vencidos, ...proximos].slice(0, 20).map(c => {
                      const expirado = c.diasParaVencer < 0;
                      const urgente = !expirado && c.diasParaVencer <= 7;
                      const proximo = !expirado && !urgente && c.diasParaVencer <= 30;
                      return (
                        <tr
                          key={c.id}
                          className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                          onClick={() => setDetailId(c.id)}
                          data-testid={`vencimento-${c.id}`}
                        >
                          <td className="py-2 px-2 font-medium">{c.name}</td>
                          <td className="py-2 px-2 text-muted-foreground hidden md:table-cell text-xs">{c.plan}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(c.planValue || 0)}</td>
                          <td className="py-2 px-2 text-right text-xs">
                            {expirado ? `há ${Math.abs(c.diasParaVencer)} dias` : `${c.diasParaVencer} dias`}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {expirado ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-400">vencido</span>
                            ) : urgente ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-400">urgente</span>
                            ) : proximo ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400">renovar</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-muted bg-muted/30 text-muted-foreground">próximo</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-muted-foreground mt-2">
                Clique em uma linha para abrir o cliente. Mostra contratos vencidos + os que vencem nos próximos 90 dias (top 20).
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Sugestões: transações do extrato que provavelmente são assinaturas */}
      {sugestoes.length > 0 && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-emerald-400" />
                Possíveis pagamentos no extrato
                <span className="text-[10px] text-muted-foreground font-normal">
                  ({sugestoes.length} {sugestoes.length === 1 ? "match" : "matches"} de valor + data no mês atual)
                </span>
              </div>
              <Button
                size="sm"
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={aplicarTodasSugestoes}
                disabled={aplicandoSugestoes}
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                {aplicandoSugestoes ? "Aplicando..." : "Confirmar todos"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">Assinante</th>
                    <th className="text-left py-1.5 px-2 font-medium hidden md:table-cell">Conta</th>
                    <th className="text-left py-1.5 px-2 font-medium">Data extrato</th>
                    <th className="text-right py-1.5 px-2 font-medium">Valor</th>
                    <th className="text-right py-1.5 px-2 font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {sugestoes.map(s => (
                    <tr key={`${s.clienteId}-${s.mes}`} className="border-b border-border/30">
                      <td className="py-1.5 px-2 font-medium">{s.clienteNome}</td>
                      <td className="py-1.5 px-2 text-muted-foreground hidden md:table-cell">{s.transacao.contaNome}</td>
                      <td className="py-1.5 px-2">{formatDateBR(s.transacao.date)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-emerald-400 font-semibold">{formatCurrency(s.transacao.amount)}</td>
                      <td className="py-1.5 px-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px]"
                          onClick={() => setDetailId(s.clienteId)}
                        >
                          Revisar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Cada linha é uma entrada no extrato com valor exato da mensalidade, em janela de ±10 dias do dia de pagamento. Clique em "Confirmar todos" pra marcar todas como pagas vinculadas ao extrato.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Filtros + busca */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-muted/30 rounded-md p-1">
          {([
            { key: "todos", label: "Todos" },
            { key: "em_dia", label: "Em dia" },
            { key: "inadimplente", label: `Inadimplentes${inadCount > 0 ? ` (${inadCount})` : ""}` },
            { key: "cancelado", label: "Cancelados" },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setFiltro(t.key)}
              className={`text-xs px-3 py-1 rounded ${filtro === t.key ? (t.key === "inadimplente" ? "bg-red-600 text-white" : "bg-primary text-white") : "text-muted-foreground hover:text-foreground"}`}
            >{t.label}</button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Buscar nome ou telefone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-56 text-xs" />
        </div>
      </div>

      {/* Tabela */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-muted-foreground font-medium">Assinante</th>
                  <th className="text-left p-3 text-muted-foreground font-medium">Plano</th>
                  <th className="text-right p-3 text-muted-foreground font-medium">Valor</th>
                  <th className="text-left p-3 text-muted-foreground font-medium">Vendedor</th>
                  <th className="text-right p-3 text-muted-foreground font-medium">Bônus venda</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Contrato</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Vencimento</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Dia Pgto</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Situação</th>
                  <th className="text-right p-3 text-muted-foreground font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="py-12 text-center text-muted-foreground">Carregando...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="py-12 text-center text-muted-foreground">
                    {clientes.length === 0 ? "Nenhum assinante cadastrado. Clique em 'Novo Assinante' para começar." : "Nenhum resultado encontrado."}
                  </td></tr>
                ) : (
                  filtered.map(c => {
                    const st = STATUS_STYLES[c.paymentStatus] || STATUS_STYLES.em_dia;
                    const daysLeft = Math.ceil((new Date(c.contractEndDate).getTime() - Date.now()) / (86400000));
                    const hasContract = c.contractFileName || c.contractUrl;
                    return (
                      <tr key={c.id} className={`border-b border-border/50 hover:bg-muted/20 ${c.paymentStatus === "inadimplente" ? "bg-red-500/5" : ""}`}>
                        <td className="p-3">
                          <p className="font-medium">{c.name}</p>
                          <p className="text-[10px] text-muted-foreground">{c.phone || c.email || ""}</p>
                        </td>
                        <td className="p-3">
                          <p className="max-w-[200px] truncate" title={c.plan}>{c.plan || "—"}</p>
                        </td>
                        <td className="p-3 text-right font-semibold">{formatCurrency(c.planValue)}</td>
                        <td className="p-3">
                          {c.seller ? (
                            <span className="text-xs">{c.seller}</span>
                          ) : (
                            <span className="text-[10px] text-amber-400">não informado</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className={`text-xs font-semibold tabular-nums ${c.comissaoPaga ? "text-emerald-400" : "text-amber-400"}`}>
                            {formatCurrency(c.comissaoBonusRS || 0)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {c.comissaoPaga ? "pago" : "aguarda 1ª parcela"} • {c.commissionPctEfetivo ?? 20}%
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <div className="text-[10px] text-muted-foreground">
                            {formatDateBR(c.contractDate)} → {formatDateBR(c.contractEndDate)}
                          </div>
                          <div className="text-[10px]">{c.contractDurationMonths} meses</div>
                        </td>
                        <td className="p-3 text-center">
                          {c.status === "active" && daysLeft > 0 ? (
                            <span className={`text-[10px] ${daysLeft <= 30 ? "text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                              {daysLeft}d restantes
                            </span>
                          ) : c.status === "active" ? (
                            <span className="text-[10px] text-red-400 font-semibold">Expirado</span>
                          ) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3 text-center">Dia {c.paymentDay}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] border ${st.class}`}>{st.label}</span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Ver detalhes / pagamentos" onClick={() => setDetailId(c.id)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Editar" onClick={() => { setEditingId(c.id); setShowForm(true); }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {hasContract && (
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Ver contrato" onClick={() => {
                                if (c.contractFileName) window.open(`${API_BASE}/api/assinaturas/contratos/${c.contractFileName}`, "_blank");
                                else if (c.contractUrl) window.open(c.contractUrl, "_blank");
                              }}>
                                <FileText className="w-3.5 h-3.5 text-primary" />
                              </Button>
                            )}
                            {c.status === "active" && (
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" title="Cancelar" onClick={() => cancelar(c.id)}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" title="Excluir" onClick={() => excluir(c.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>


      {/* Dialog: Novo/Editar Assinante */}
      <AssinanteFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditingId(null); }}
        onSaved={() => { setShowForm(false); setEditingId(null); loadData(); }}
        editId={editingId}
      />

      {/* Dialog: Detalhes + Pagamentos */}
      {detailId && (
        <DetalheDialog
          clientId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={loadData}
        />
      )}

      {/* Dialog: Atribuir vendedor em lote */}
      <BulkVendedorDialog
        open={showBulk}
        clientes={clientes}
        onClose={() => setShowBulk(false)}
        onSaved={() => { setShowBulk(false); loadData(); }}
      />
    </div>
  );
}

// ─── Bulk Vendedor Dialog ──────────────────────────────────
function BulkVendedorDialog({ open, clientes, onClose, onSaved }: {
  open: boolean; clientes: Cliente[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [seller, setSeller] = useState("");
  const [pct, setPct] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"sem_vendedor" | "todos">("sem_vendedor");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSeller(""); setPct(""); setSearch("");
      setFilter("sem_vendedor");
      setSelected(new Set());
    }
  }, [open]);

  const lista = useMemo(() => {
    let l = clientes;
    if (filter === "sem_vendedor") l = l.filter(c => !c.seller || !c.seller.trim());
    if (search) {
      const q = search.toLowerCase();
      l = l.filter(c => c.name.toLowerCase().includes(q) || (c.plan || "").toLowerCase().includes(q));
    }
    return l;
  }, [clientes, filter, search]);

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };
  const toggleAll = () => {
    if (selected.size === lista.length) setSelected(new Set());
    else setSelected(new Set(lista.map(c => c.id)));
  };

  const aplicar = async () => {
    if (!seller.trim()) { toast({ title: "Informe o vendedor", variant: "destructive" }); return; }
    if (selected.size === 0) { toast({ title: "Selecione ao menos 1 assinante", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/assinaturas/clientes/bulk-vendedor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          seller: seller.trim(),
          commissionPct: pct === "" ? undefined : Number(pct),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: `${data.atualizados} assinante(s) atualizado(s) com vendedor "${seller}"` });
        onSaved();
      } else {
        toast({ title: data.error || "Erro", variant: "destructive" });
      }
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-card-border max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" /> Atribuir vendedor em lote
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Vendedor (quem fechou)</Label>
              <Input value={seller} onChange={e => setSeller(e.target.value)} placeholder="Ex: CAMILA BARBOSA" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">% Comissão (vazio = padrão 20%)</Label>
              <Input type="number" step="0.5" min="0" max="100" value={pct} onChange={e => setPct(e.target.value)} placeholder="20" />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-muted/30 rounded-md p-1">
              <button onClick={() => setFilter("sem_vendedor")} className={`text-[11px] px-2.5 py-1 rounded ${filter === "sem_vendedor" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
                Sem vendedor ({clientes.filter(c => !c.seller || !c.seller.trim()).length})
              </button>
              <button onClick={() => setFilter("todos")} className={`text-[11px] px-2.5 py-1 rounded ${filter === "todos" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
                Todos ({clientes.length})
              </button>
            </div>
            <div className="relative flex-1 min-w-[150px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Buscar nome ou plano..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={toggleAll}>
              {selected.size === lista.length && lista.length > 0 ? "Limpar seleção" : `Selecionar todos (${lista.length})`}
            </Button>
          </div>

          <div className="border border-border rounded-md max-h-[40vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="text-left p-2 text-muted-foreground font-medium">Assinante</th>
                  <th className="text-left p-2 text-muted-foreground font-medium hidden md:table-cell">Plano</th>
                  <th className="text-right p-2 text-muted-foreground font-medium">Valor</th>
                  <th className="text-left p-2 text-muted-foreground font-medium">Vendedor atual</th>
                </tr>
              </thead>
              <tbody>
                {lista.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Nenhum assinante.</td></tr>
                ) : lista.map(c => {
                  const sel = selected.has(c.id);
                  return (
                    <tr key={c.id} onClick={() => toggleOne(c.id)} className={`border-b border-border/30 cursor-pointer hover:bg-muted/30 ${sel ? "bg-primary/10" : ""}`}>
                      <td className="p-2"><input type="checkbox" checked={sel} onChange={() => toggleOne(c.id)} onClick={e => e.stopPropagation()} /></td>
                      <td className="p-2 font-medium">{c.name}</td>
                      <td className="p-2 text-muted-foreground hidden md:table-cell truncate max-w-[200px]" title={c.plan}>{c.plan}</td>
                      <td className="p-2 text-right tabular-nums">{formatCurrency(c.planValue)}</td>
                      <td className="p-2">
                        {c.seller ? <span className="text-foreground">{c.seller}</span> : <span className="text-amber-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-xs text-muted-foreground">
              <strong className="text-foreground">{selected.size}</strong> selecionado(s) · vendedor: <strong className="text-foreground">{seller || "—"}</strong> · {pct || "20"}%
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button size="sm" className="bg-primary hover:bg-primary/80 text-white" onClick={aplicar} disabled={saving || selected.size === 0 || !seller.trim()}>
                {saving ? "Aplicando..." : `Aplicar a ${selected.size}`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Form Dialog ───────────────────────────────────────────
function AssinanteFormDialog({ open, onClose, onSaved, editId }: {
  open: boolean; onClose: () => void; onSaved: () => void; editId: string | null;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", email: "", plan: "", planValue: "",
    contractDate: new Date().toISOString().split("T")[0],
    contractDurationMonths: "12", paymentDay: "10", contractUrl: "", notes: "",
    seller: "", commissionPct: "",
  });

  useEffect(() => {
    if (open && editId) {
      fetch(`${API_BASE}/api/assinaturas/clientes/${editId}`).then(r => r.json()).then((c: any) => {
        setForm({
          name: c.name || "", phone: c.phone || "", email: c.email || "",
          plan: c.plan || "", planValue: c.planValue?.toString() || "",
          contractDate: c.contractDate?.slice(0, 10) || "",
          contractDurationMonths: c.contractDurationMonths?.toString() || "12",
          paymentDay: c.paymentDay?.toString() || "10",
          contractUrl: c.contractUrl || "", notes: c.notes || "",
          seller: c.seller || "",
          commissionPct: c.commissionPct != null ? String(c.commissionPct) : "",
        });
      });
    } else if (open) {
      setForm({
        name: "", phone: "", email: "", plan: "", planValue: "",
        contractDate: new Date().toISOString().split("T")[0],
        contractDurationMonths: "12", paymentDay: "10", contractUrl: "", notes: "",
        seller: "", commissionPct: "",
      });
    }
  }, [open, editId]);

  const save = async () => {
    if (!form.name.trim()) { toast({ title: "Nome é obrigatório", variant: "destructive" }); return; }
    if (!form.plan) { toast({ title: "Selecione o plano", variant: "destructive" }); return; }
    if (!form.planValue) { toast({ title: "Informe o valor", variant: "destructive" }); return; }
    if (!form.contractDate) { toast({ title: "Data do contrato é obrigatória", variant: "destructive" }); return; }
    if (!form.paymentDay) { toast({ title: "Dia de pagamento é obrigatório", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editId ? `${API_BASE}/api/assinaturas/clientes/${editId}` : `${API_BASE}/api/assinaturas/clientes`;
      const res = await fetch(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ title: editId ? "Assinante atualizado!" : "Assinante cadastrado!" });
        onSaved();
      } else {
        const err = await res.json();
        toast({ title: err.error || "Erro", variant: "destructive" });
      }
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-card-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Editar Assinante" : "Novo Assinante"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Dados pessoais */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Nome completo *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome do assinante" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Telefone</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(62) 99999-9999" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" />
            </div>
          </div>

          <div className="border-t border-border pt-3" />

          {/* Plano */}
          <div className="space-y-1.5">
            <Label className="text-xs">Plano (descreva o que o cliente fechou) *</Label>
            <Input value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })} placeholder="Ex: 02 Cortes + 04 Barbas + 02 Sobrancelhas" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Valor mensal (R$) *</Label>
            <Input type="number" step="0.01" value={form.planValue} onChange={e => setForm({ ...form, planValue: e.target.value })} placeholder="120,00" />
          </div>

          {/* Vendedor + Comissão */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Vendedor (quem fechou a venda)</Label>
              <Input value={form.seller} onChange={e => setForm({ ...form, seller: e.target.value })} placeholder="Ex: Camila, Larissa, Guilherme..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">% Comissão</Label>
              <Input type="number" step="0.5" min="0" max="100" value={form.commissionPct} onChange={e => setForm({ ...form, commissionPct: e.target.value })} placeholder="20" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">
            Vendedor ganha {form.commissionPct || "20"}% como bônus único, creditado quando a 1ª parcela for paga. Deixe em branco para usar o padrão (20%).
          </p>

          <div className="border-t border-border pt-3" />

          {/* Contrato */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Data do contrato *</Label>
              <Input type="date" value={form.contractDate} onChange={e => setForm({ ...form, contractDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Duração *</Label>
              <Select value={form.contractDurationMonths} onValueChange={v => setForm({ ...form, contractDurationMonths: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Dia de pagamento *</Label>
              <Input type="number" min="1" max="31" value={form.paymentDay} onChange={e => setForm({ ...form, paymentDay: e.target.value })} placeholder="10" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Link do contrato (ZapSign)</Label>
            <Input value={form.contractUrl} onChange={e => setForm({ ...form, contractUrl: e.target.value })} placeholder="https://app.zapsign.com.br/..." />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Anotações..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>

          <Button onClick={save} disabled={saving} className="w-full bg-primary hover:bg-primary/80 text-white">
            {saving ? "Salvando..." : (editId ? "Atualizar" : "Cadastrar Assinante")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detalhe + Pagamentos Dialog ───────────────────────────
function DetalheDialog({ clientId, onClose, onChanged }: {
  clientId: string; onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [client, setClient] = useState<Cliente | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pagandoMes, setPagandoMes] = useState<string | null>(null);

  const load = () => {
    fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}`).then(r => r.json()).then(setClient);
  };
  useEffect(() => { load(); }, [clientId]);

  const desmarcarPagamento = async (mes: string) => {
    await fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}/pagamento`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes, pago: false }),
    });
    toast({ title: `${formatMonthBR(mes)} desmarcado` });
    load();
    onChanged();
  };

  const uploadContrato = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}/contrato`, { method: "POST", body: form });
      if (res.ok) { toast({ title: "Contrato salvo!" }); load(); onChanged(); }
    } catch { toast({ title: "Erro no upload", variant: "destructive" }); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  };

  if (!client) return null;

  const months = getContractMonths(client.contractDate, client.contractDurationMonths);
  const pagoMap = new Map(client.payments.map(p => [p.mes, p]));
  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-card-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {client.name}
            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] border ${(STATUS_STYLES[client.paymentStatus] || STATUS_STYLES.em_dia).class}`}>
              {(STATUS_STYLES[client.paymentStatus] || STATUS_STYLES.em_dia).label}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Plano:</span> <span className="font-medium">{client.plan}</span></div>
            <div><span className="text-muted-foreground">Valor:</span> <span className="font-semibold text-emerald-400">{formatCurrency(client.planValue)}/mês</span></div>
            <div><span className="text-muted-foreground">Contrato:</span> {formatDateBR(client.contractDate)} → {formatDateBR(client.contractEndDate)}</div>
            <div><span className="text-muted-foreground">Duração:</span> {client.contractDurationMonths} meses</div>
            <div><span className="text-muted-foreground">Dia pgto:</span> Todo dia {client.paymentDay}</div>
            {client.phone && <div><span className="text-muted-foreground">Tel:</span> {client.phone}</div>}
            <div className="col-span-2 mt-1 p-2 rounded bg-emerald-500/5 border border-emerald-500/20">
              <span className="text-muted-foreground">Vendedor:</span>{" "}
              <span className="font-medium">{client.seller || <span className="text-amber-400">não informado</span>}</span>
              <span className="text-muted-foreground"> • bônus único de {client.commissionPctEfetivo ?? 20}% na 1ª parcela</span>
              <div className="text-[10px] mt-0.5">
                Bônus: <span className={`font-semibold ${client.comissaoPaga ? "text-emerald-400" : "text-amber-400"}`}>{formatCurrency(client.comissaoBonusRS || 0)}</span>
                {" "}
                <span className={client.comissaoPaga ? "text-emerald-400" : "text-amber-400"}>
                  {client.comissaoPaga ? "(pago — 1ª parcela quitada)" : "(pendente — aguarda 1ª parcela)"}
                </span>
                <span className="text-muted-foreground">
                  {" • "}{client.mesesPagos || 0} {(client.mesesPagos || 0) === 1 ? "mensalidade paga no total" : "mensalidades pagas no total"}
                </span>
              </div>
            </div>
          </div>

          {/* Contrato */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Contrato</span>
              <div className="flex items-center gap-2">
                {client.contractUrl && (
                  <a href={client.contractUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> ZapSign
                  </a>
                )}
                {client.contractFileName && (
                  <a href={`${API_BASE}/api/assinaturas/contratos/${client.contractFileName}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    <FileText className="w-3 h-3" /> Ver PDF
                  </a>
                )}
              </div>
            </div>
            <input ref={fileInput} type="file" accept=".pdf" onChange={uploadContrato} className="hidden" />
            <Button size="sm" variant="outline" className="w-full text-xs h-8" onClick={() => fileInput.current?.click()} disabled={uploading}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {uploading ? "Enviando..." : (client.contractFileName ? "Substituir PDF do contrato" : "Enviar PDF do contrato")}
            </Button>
          </div>

          {/* Pagamentos */}
          <div className="border-t border-border pt-3">
            <span className="text-xs font-medium flex items-center gap-1.5 mb-3"><Calendar className="w-3.5 h-3.5" /> Pagamentos mensais</span>
            <div className="space-y-2">
              {months.map(mes => {
                const pg = pagoMap.get(mes);
                const pago = pg?.pago || false;
                const passado = mes <= mesAtual;
                const inadimplente = passado && !pago;
                const formaLabel: Record<string, string> = {
                  dinheiro: "Dinheiro", pix: "PIX", cartao: "Cartão", infinitepay: "InfinitePay", outro: "Outro",
                };
                return (
                  <div key={mes} className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${
                    pago
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : inadimplente
                        ? "border-red-500/40 bg-red-500/10"
                        : "border-border"
                  }`}>
                    <div className="flex items-center gap-2">
                      {pago ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : inadimplente ? <AlertTriangle className="w-4 h-4 text-red-400" /> : <Clock className="w-4 h-4 text-muted-foreground" />}
                      <div>
                        <div className="font-medium">{formatMonthBR(mes)}</div>
                        {pago && pg?.dataPagamento && (
                          <div className="text-[9px] text-muted-foreground">
                            Pago {formatDateBR(pg.dataPagamento)}
                            {pg.formaPagamento && ` • ${formaLabel[pg.formaPagamento] || pg.formaPagamento}`}
                          </div>
                        )}
                        {pago && !pg?.dataPagamento && pg?.pagoEm && (
                          <div className="text-[9px] text-muted-foreground">Pago {formatDateBR(pg.pagoEm.slice(0, 10))}</div>
                        )}
                        {inadimplente && !pago && <div className="text-[9px] text-red-400 font-semibold">Atrasado</div>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={pago ? "outline" : "default"}
                      className={`h-7 text-[10px] ${pago ? "text-muted-foreground" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
                      onClick={() => pago ? desmarcarPagamento(mes) : setPagandoMes(mes)}
                    >
                      {pago ? "Desfazer" : "Marcar Pago"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          {pagandoMes && (
            <MarcarPagoDialog
              clientId={clientId}
              mes={pagandoMes}
              valorSugerido={client.planValue}
              onClose={() => setPagandoMes(null)}
              onSaved={() => { setPagandoMes(null); load(); onChanged(); }}
            />
          )}

          {client.notes && (
            <div className="border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Obs:</span>
              <p className="text-xs mt-1">{client.notes}</p>
            </div>
          )}

          {/* Link para extrato */}
          <div className="border-t border-border pt-3">
            <a href="#/consolidacao" className="flex items-center gap-2 p-3 rounded-lg bg-muted/20 border border-border hover:border-primary/40 transition text-xs">
              <Banknote className="w-4 h-4 text-primary" />
              <div>
                <p className="font-medium">Ver extrato InfinitePay</p>
                <p className="text-[10px] text-muted-foreground">Confira os pagamentos recebidos na aba Consolidação</p>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Marcar Pago Dialog ────────────────────────────────────
// Dois caminhos:
//  1. "Registrar novo": forma + conta + valor → cria transação no fluxo de caixa
//  2. "Vincular ao extrato": busca em transacoesBanco por valor±0,02 e data±10d,
//     usuário escolhe a transação que corresponde — não duplica entrada.
interface ContaConsolidacao { id: string; nome: string; tipo: string; ativa: boolean; }
interface CandidataMatch { id: string; date: string; amount: number; description: string; contaId: string; contaNome: string; }

function MarcarPagoDialog({ clientId, mes, valorSugerido, onClose, onSaved }: {
  clientId: string;
  mes: string;
  valorSugerido: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [aba, setAba] = useState<"registrar" | "vincular">("registrar");
  const [contas, setContas] = useState<ContaConsolidacao[]>([]);
  const [candidatas, setCandidatas] = useState<CandidataMatch[]>([]);
  const [carregandoMatch, setCarregandoMatch] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [forma, setForma] = useState<'dinheiro' | 'pix' | 'cartao' | 'infinitepay' | 'outro'>("pix");
  const [contaId, setContaId] = useState("");
  const [valor, setValor] = useState(String(valorSugerido));
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    fetch(`${API_BASE}/api/consolidacao/contas`).then(r => r.json()).then((c: ContaConsolidacao[]) => {
      const ativas = (c || []).filter(x => x.ativa);
      setContas(ativas);
      setContaId(prev => prev || (ativas[0]?.id ?? ""));
    });
  }, []);

  useEffect(() => {
    if (aba !== "vincular") return;
    setCarregandoMatch(true);
    fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}/match-transacoes?mes=${mes}&janelaDias=10`)
      .then(r => r.json())
      .then(d => setCandidatas(d.candidatas || []))
      .finally(() => setCarregandoMatch(false));
  }, [aba, clientId, mes]);

  const registrar = async () => {
    if (!contaId) { toast({ title: "Selecione a conta destino", variant: "destructive" }); return; }
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0) { toast({ title: "Valor inválido", variant: "destructive" }); return; }
    setSalvando(true);
    try {
      const res = await fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}/pagamento`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, pago: true, formaPagamento: forma, contaId, valor: v, dataPagamento }),
      });
      if (res.ok) { toast({ title: `${formatMonthBR(mes)} pago — entrada criada no caixa` }); onSaved(); }
      else { const e = await res.json(); toast({ title: e.error || "Erro", variant: "destructive" }); }
    } finally { setSalvando(false); }
  };

  const vincular = async (txId: string) => {
    setSalvando(true);
    try {
      const res = await fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}/pagamento`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, pago: true, vincularTransacaoId: txId }),
      });
      if (res.ok) { toast({ title: `${formatMonthBR(mes)} pago — vinculado ao extrato` }); onSaved(); }
      else { const e = await res.json(); toast({ title: e.error || "Erro", variant: "destructive" }); }
    } finally { setSalvando(false); }
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" /> Registrar pagamento — {formatMonthBR(mes)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 bg-muted/30 rounded-md p-1 mb-3">
          <button onClick={() => setAba("registrar")} className={`flex-1 text-xs px-3 py-1.5 rounded ${aba === "registrar" ? "bg-primary text-white" : "text-muted-foreground"}`}>
            Registrar novo
          </button>
          <button onClick={() => setAba("vincular")} className={`flex-1 text-xs px-3 py-1.5 rounded ${aba === "vincular" ? "bg-primary text-white" : "text-muted-foreground"}`}>
            Vincular ao extrato
          </button>
        </div>

        {aba === "registrar" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Forma de pagamento</Label>
                <Select value={forma} onValueChange={(v: any) => setForma(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="cartao">Cartão</SelectItem>
                    <SelectItem value="infinitepay">InfinitePay</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Conta destino</Label>
                <Select value={contaId} onValueChange={setContaId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {contas.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Data do pagamento</Label>
                <Input type="date" value={dataPagamento} onChange={e => setDataPagamento(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor (R$)</Label>
                <Input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Gera uma entrada de {formatCurrency(Number(valor) || 0)} na conta selecionada, marcada como Assinatura.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={registrar} disabled={salvando}>
                {salvando ? "Salvando..." : "Confirmar pagamento"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Procurando entradas de {formatCurrency(valorSugerido)} ±R$ 0,02 numa janela de ±10 dias do vencimento.
            </p>
            {carregandoMatch ? (
              <div className="text-center py-6 text-muted-foreground text-xs">Buscando...</div>
            ) : candidatas.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-xs">
                Nenhuma transação compatível no extrato. Use "Registrar novo" ou importe o extrato em Consolidação.
              </div>
            ) : (
              <div className="border border-border rounded-md max-h-[40vh] overflow-y-auto">
                {candidatas.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 border-b border-border/30 last:border-b-0 hover:bg-muted/30">
                    <div className="text-xs">
                      <div className="font-medium">{formatDateBR(c.date)} • {c.contaNome}</div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[220px]" title={c.description}>{c.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 text-xs font-semibold tabular-nums">{formatCurrency(c.amount)}</span>
                      <Button size="sm" className="h-7 text-[10px] bg-primary hover:bg-primary/80 text-white" onClick={() => vincular(c.id)} disabled={salvando}>
                        Vincular
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

