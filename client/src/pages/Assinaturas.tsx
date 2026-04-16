import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/demoData";
import { useLocation } from "wouter";
import {
  Users, DollarSign, Search, Plus, Trash2, XCircle, CheckCircle, Check,
  Crown, FileText, ExternalLink, Upload, AlertTriangle, Calendar, Clock,
  Eye, X, Pencil, Settings, Banknote,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface Plano {
  id: string;
  nome: string;
  valor: number;
  ativo: boolean;
}

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
}
interface DashboardStats {
  totalAssinantes: number;
  ativos: number;
  inadimplentes: number;
  cancelados: number;
  monthlyRevenue: number;
  planDistribution: { name: string; count: number }[];
  vencendoEmBreve: number;
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
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "em_dia" | "inadimplente" | "cancelado">("todos");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showPlanos, setShowPlanos] = useState(false);

  const planLabels = useMemo(() => {
    const m: Record<string, string> = {};
    planos.forEach(p => { m[p.id] = p.nome; });
    return m;
  }, [planos]);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/assinaturas/clientes`).then(r => r.json()),
      fetch(`${API_BASE}/api/assinaturas/dashboard`).then(r => r.json()),
      fetch(`${API_BASE}/api/assinaturas/planos`).then(r => r.json()),
    ]).then(([c, s, p]) => {
      setClientes(Array.isArray(c) ? c : []);
      setStats(s);
      setPlanos(Array.isArray(p) ? p : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { loadData(); }, []);

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
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowPlanos(true)}>
            <Settings className="w-3.5 h-3.5 mr-1.5" /> Planos
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
                  <th className="text-center p-3 text-muted-foreground font-medium">Contrato</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Vencimento</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Dia Pgto</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Situação</th>
                  <th className="text-right p-3 text-muted-foreground font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">Carregando...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">
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
                        <td className="p-3">{planLabels[c.plan] || c.plan}</td>
                        <td className="p-3 text-right font-semibold">{formatCurrency(c.planValue)}</td>
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

      {/* Gráfico de planos */}
      {stats?.planDistribution && stats.planDistribution.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Distribuição por Plano</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie data={stats.planDistribution.map(p => ({ ...p, name: planLabels[p.name] || p.name }))}
                    dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={70} strokeWidth={0}>
                    {stats.planDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {stats.planDistribution.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-xs">{planLabels[p.name] || p.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{p.count} assinante{p.count > 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog: Gerenciar Planos */}
      <PlanosDialog open={showPlanos} onClose={() => setShowPlanos(false)} planos={planos} onChanged={loadData} />

      {/* Dialog: Novo/Editar Assinante */}
      <AssinanteFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditingId(null); }}
        onSaved={() => { setShowForm(false); setEditingId(null); loadData(); }}
        editId={editingId}
        planos={planos.filter(p => p.ativo)}
      />

      {/* Dialog: Detalhes + Pagamentos */}
      {detailId && (
        <DetalheDialog
          clientId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={loadData}
        />
      )}
    </div>
  );
}

// ─── Form Dialog ───────────────────────────────────────────
function AssinanteFormDialog({ open, onClose, onSaved, editId, planos }: {
  open: boolean; onClose: () => void; onSaved: () => void; editId: string | null; planos: Plano[];
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", email: "", plan: "", planValue: "",
    contractDate: new Date().toISOString().split("T")[0],
    contractDurationMonths: "12", paymentDay: "10", contractUrl: "", notes: "",
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
        });
      });
    } else if (open) {
      setForm({
        name: "", phone: "", email: "", plan: "", planValue: "",
        contractDate: new Date().toISOString().split("T")[0],
        contractDurationMonths: "12", paymentDay: "10", contractUrl: "", notes: "",
      });
    }
  }, [open, editId]);

  const handlePlanChange = (plan: string) => {
    const opt = planos.find(p => p.id === plan);
    setForm(prev => ({ ...prev, plan, planValue: opt && opt.valor > 0 ? opt.valor.toString() : prev.planValue }));
  };

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Plano *</Label>
              <Select value={form.plan} onValueChange={handlePlanChange}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {planos.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}{p.valor > 0 ? ` (R$ ${p.valor})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Valor mensal (R$) *</Label>
              <Input type="number" step="0.01" value={form.planValue} onChange={e => setForm({ ...form, planValue: e.target.value })} placeholder="80,00" />
            </div>
          </div>

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

  const load = () => {
    fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}`).then(r => r.json()).then(setClient);
  };
  useEffect(() => { load(); }, [clientId]);

  const togglePayment = async (mes: string, pago: boolean) => {
    await fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}/pagamento`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes, pago }),
    });
    toast({ title: pago ? `${formatMonthBR(mes)} marcado como pago` : `${formatMonthBR(mes)} desmarcado` });
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
                        {pago && pg?.pagoEm && <div className="text-[9px] text-muted-foreground">Pago {formatDateBR(pg.pagoEm.slice(0, 10))}</div>}
                        {inadimplente && !pago && <div className="text-[9px] text-red-400 font-semibold">Atrasado</div>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={pago ? "outline" : "default"}
                      className={`h-7 text-[10px] ${pago ? "text-muted-foreground" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
                      onClick={() => togglePayment(mes, !pago)}
                    >
                      {pago ? "Desfazer" : "Marcar Pago"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

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

// ─── Gerenciar Planos ──────────────────────────────────────
function PlanosDialog({ open, onClose, planos, onChanged }: {
  open: boolean; onClose: () => void; planos: Plano[]; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [novoNome, setNovoNome] = useState("");
  const [novoValor, setNovoValor] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editValor, setEditValor] = useState("");

  const criarPlano = async () => {
    if (!novoNome.trim()) return;
    await fetch(`${API_BASE}/api/assinaturas/planos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: novoNome, valor: Number(novoValor) || 0 }),
    });
    toast({ title: "Plano criado!" });
    setNovoNome(""); setNovoValor("");
    onChanged();
  };

  const salvarEdicao = async () => {
    if (!editId) return;
    await fetch(`${API_BASE}/api/assinaturas/planos/${editId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: editNome, valor: Number(editValor) }),
    });
    toast({ title: "Plano atualizado!" });
    setEditId(null);
    onChanged();
  };

  const excluirPlano = async (id: string) => {
    if (!confirm("Excluir este plano?")) return;
    await fetch(`${API_BASE}/api/assinaturas/planos/${id}`, { method: "DELETE" });
    toast({ title: "Plano excluído" });
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader><DialogTitle>Gerenciar Planos</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Configure os planos disponíveis e seus valores padrão. O valor pode ser ajustado por cliente na hora do cadastro (desconto).</p>

          {/* Lista de planos */}
          <div className="space-y-2">
            {planos.map(p => (
              <div key={p.id} className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/10">
                {editId === p.id ? (
                  <>
                    <Input value={editNome} onChange={e => setEditNome(e.target.value)} className="h-8 text-xs flex-1" />
                    <Input type="number" value={editValor} onChange={e => setEditValor(e.target.value)} className="h-8 text-xs w-24" placeholder="R$" />
                    <Button size="sm" className="h-8 w-8 p-0 bg-emerald-600" onClick={salvarEdicao}><Check className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditId(null)}><X className="w-3.5 h-3.5" /></Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{p.nome}</p>
                      <p className="text-xs text-muted-foreground">{p.valor > 0 ? formatCurrency(p.valor) + "/mês" : "Valor personalizado"}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditId(p.id); setEditNome(p.nome); setEditValor(p.valor.toString()); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" onClick={() => excluirPlano(p.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Novo plano */}
          <div className="border-t border-border pt-3">
            <Label className="text-xs font-medium mb-2 block">Adicionar novo plano</Label>
            <div className="flex items-center gap-2">
              <Input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome do plano" className="h-8 text-xs flex-1" />
              <Input type="number" value={novoValor} onChange={e => setNovoValor(e.target.value)} placeholder="R$" className="h-8 text-xs w-24" />
              <Button size="sm" className="h-8 bg-primary hover:bg-primary/80 text-white" onClick={criarPlano} disabled={!novoNome.trim()}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
