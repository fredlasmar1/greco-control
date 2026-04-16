import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/demoData";
import {
  Users, DollarSign, Bell, Search, Plus, RefreshCw, Upload,
  UserPlus, Trash2, Pencil, Settings, XCircle, CheckCircle,
  ArrowLeft, Save, Crown,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const API_BASE = (globalThis as any).__API_BASE__ || "";

const PLAN_LABELS: Record<string, string> = {
  personalizada: "Personalizada",
  express_corte: "Express Corte",
  express_cabelo_barba: "Express Cabelo e Barba",
};
const PLAN_DEFAULTS: Record<string, number> = {
  express_corte: 80,
  express_cabelo_barba: 160,
};
const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  active: { label: "Ativo", class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/40" },
  pending: { label: "Pendente", class: "bg-amber-500/10 text-amber-400 border-amber-500/40" },
  cancelled: { label: "Cancelado", class: "bg-red-500/10 text-red-400 border-red-500/40" },
  inactive: { label: "Inativo", class: "bg-muted text-muted-foreground border-border" },
};
const ALERT_LABELS: Record<string, { label: string; class: string }> = {
  payment_overdue: { label: "Pagamento Atrasado", class: "bg-red-500/10 text-red-400 border-red-500/40" },
  client_inactive: { label: "Cliente Inativo", class: "bg-amber-500/10 text-amber-400 border-amber-500/40" },
  renewal_soon: { label: "Renovação Próxima", class: "bg-blue-500/10 text-blue-400 border-blue-500/40" },
};
const COLORS = ["#01696F", "#22c55e", "#3b82f6", "#eab308", "#ef4444", "#8b5cf6"];

interface Cliente {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  trinksId?: string;
  plan?: string;
  planValue?: number;
  barberId?: string;
  barberName?: string;
  status: string;
  paymentDay?: number;
  paymentAccount?: string;
  paymentMethod?: string;
  selectedServices?: Record<string, number>;
  startDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
interface Alerta {
  id: string;
  type: string;
  message: string;
  clientId?: string;
  clientName?: string;
  isResolved: boolean;
  resolvedAt?: string;
  createdAt: string;
}
interface DashboardStats {
  activeSubscribers: number;
  totalSubscribers: number;
  monthlyRevenue: number;
  activeAlerts: number;
  planDistribution: { name: string; count: number }[];
  revenueByBarber: { name: string; revenue: number }[];
}

// ─── Main Page ─────────────────────────────────────────────
export default function Assinaturas() {
  const [view, setView] = useState<"dashboard" | "clientes" | "alertas" | "setup">("dashboard");
  const [editingClientId, setEditingClientId] = useState<string | null>(null);

  const openSetup = (id: string) => {
    setEditingClientId(id);
    setView("setup");
  };
  const backFromSetup = () => {
    setEditingClientId(null);
    setView("clientes");
  };

  return (
    <div className="space-y-5 max-w-[1400px] pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-primary" />
            Greco Assinaturas
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie o clube de assinaturas da Greco Barbearia
          </p>
        </div>
        {view !== "setup" && (
          <div className="flex items-center gap-1 bg-muted/30 rounded-md p-1">
            {(["dashboard", "clientes", "alertas"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setView(tab)}
                className={`text-xs px-3 py-1.5 rounded capitalize ${view === tab ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                {tab === "dashboard" ? "Visão Geral" : tab === "clientes" ? "Clientes" : "Alertas"}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "dashboard" && <DashboardView onNavigate={setView} />}
      {view === "clientes" && <ClientesView onSetup={openSetup} />}
      {view === "alertas" && <AlertasView />}
      {view === "setup" && editingClientId && <SetupView clientId={editingClientId} onBack={backFromSetup} />}
    </div>
  );
}

// ─── Dashboard View ────────────────────────────────────────
function DashboardView({ onNavigate }: { onNavigate: (v: any) => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/assinaturas/dashboard`).then(r => r.json()).then(setStats).catch(() => {});
    fetch(`${API_BASE}/api/assinaturas/alertas`).then(r => r.json()).then(setAlertas).catch(() => {});
  }, []);

  const activeAlerts = alertas.filter(a => !a.isResolved).slice(0, 5);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase">Assinantes Ativos</p>
                <p className="text-2xl font-bold text-emerald-400">{stats?.activeSubscribers ?? 0}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{stats?.totalSubscribers ?? 0} total cadastrados</p>
              </div>
              <div className="p-3 rounded-lg bg-emerald-500/10"><Users className="w-5 h-5 text-emerald-400" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase">Receita Mensal</p>
                <p className="text-2xl font-bold text-emerald-400">{formatCurrency(stats?.monthlyRevenue ?? 0)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Recorrente</p>
              </div>
              <div className="p-3 rounded-lg bg-emerald-500/10"><DollarSign className="w-5 h-5 text-emerald-400" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border cursor-pointer hover:border-primary/40 transition" onClick={() => onNavigate("alertas")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase">Alertas Ativos</p>
                <p className={`text-2xl font-bold ${(stats?.activeAlerts ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>{stats?.activeAlerts ?? 0}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Pendentes de ação</p>
              </div>
              <div className={`p-3 rounded-lg ${(stats?.activeAlerts ?? 0) > 0 ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
                <Bell className={`w-5 h-5 ${(stats?.activeAlerts ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Distribuição por Plano</CardTitle></CardHeader>
          <CardContent>
            {stats?.planDistribution && stats.planDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={stats.planDistribution.map(p => ({ ...p, name: PLAN_LABELS[p.name] || p.name }))}
                    dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={75} strokeWidth={0}
                  >
                    {stats.planDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados de planos</p>}
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Receita por Barbeiro</CardTitle></CardHeader>
          <CardContent>
            {stats?.revenueByBarber && stats.revenueByBarber.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.revenueByBarber}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="name" tick={{ fill: "#999", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#999", fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", fontSize: 12 }} />
                  <Bar dataKey="revenue" fill="#01696F" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados de receita</p>}
          </CardContent>
        </Card>
      </div>

      {/* Recent Alerts */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Alertas Recentes</CardTitle></CardHeader>
        <CardContent>
          {activeAlerts.length > 0 ? (
            <div className="space-y-2">
              {activeAlerts.map(a => (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20">
                  <Bell className="w-4 h-4 text-amber-400" />
                  <div className="flex-1">
                    <p className="text-sm">{a.message}</p>
                    <p className="text-[10px] text-muted-foreground">{a.clientName}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-emerald-400 text-center py-8">Nenhum alerta ativo. Tudo em ordem!</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Clientes View ─────────────────────────────────────────
function ClientesView({ onSetup }: { onSetup: (id: string) => void }) {
  const { toast } = useToast();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", phone: "", email: "" });
  const [importData, setImportData] = useState<any[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadClientes = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/assinaturas/clientes`)
      .then(r => r.json())
      .then(d => { setClientes(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { loadClientes(); }, []);

  const filtered = useMemo(() => {
    let list = clientes;
    if (tab === "ativos") list = list.filter(c => c.status === "active");
    if (tab === "pendentes") list = list.filter(c => c.status === "pending");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [clientes, tab, search]);

  const createClient = async () => {
    if (!newClient.name.trim()) { toast({ title: "Nome é obrigatório", variant: "destructive" }); return; }
    const res = await fetch(`${API_BASE}/api/assinaturas/clientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newClient),
    });
    if (res.ok) {
      toast({ title: "Cliente adicionado!" });
      setShowAddDialog(false);
      setNewClient({ name: "", phone: "", email: "" });
      loadClientes();
    }
  };

  const deleteClient = async (id: string) => {
    if (!confirm("Excluir este cliente?")) return;
    await fetch(`${API_BASE}/api/assinaturas/clientes/${id}`, { method: "DELETE" });
    toast({ title: "Cliente excluído" });
    loadClientes();
  };

  const cancelSubscription = async (id: string) => {
    if (!confirm("Cancelar a assinatura deste cliente?")) return;
    await fetch(`${API_BASE}/api/assinaturas/clientes/${id}/cancelar`, { method: "PUT" });
    toast({ title: "Assinatura cancelada" });
    loadClientes();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any>(ws);
      const nameH = new Set(["nome", "name", "cliente", "client"]);
      const phoneH = new Set(["telefone", "fone", "celular", "phone", "tel", "whatsapp"]);
      const emailH = new Set(["email", "e-mail", "mail"]);
      const headers = Object.keys(data[0] || {});
      const nameCol = headers.find(h => nameH.has(h.toLowerCase()));
      const phoneCol = headers.find(h => phoneH.has(h.toLowerCase()));
      const emailCol = headers.find(h => emailH.has(h.toLowerCase()));
      const parsed = data.map((row: any) => ({
        name: nameCol ? String(row[nameCol] || "").trim() : "",
        phone: phoneCol ? String(row[phoneCol] || "").trim() || undefined : undefined,
        email: emailCol ? String(row[emailCol] || "").trim() || undefined : undefined,
      })).filter((r: any) => r.name.length >= 2);
      setImportData(parsed);
    };
    reader.readAsBinaryString(file);
  };

  const doImport = async () => {
    const res = await fetch(`${API_BASE}/api/assinaturas/clientes/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clients: importData }),
    });
    if (res.ok) {
      const d = await res.json();
      toast({ title: `${d.imported} clientes importados!` });
      setShowImportDialog(false);
      setImportData([]);
      setImportFile(null);
      loadClientes();
    }
  };

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-muted/30 rounded-md p-1">
          {[
            { key: "all", label: "Todos" },
            { key: "ativos", label: "Ativos" },
            { key: "pendentes", label: "Pendentes" },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`text-xs px-3 py-1 rounded ${tab === t.key ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
            >{t.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-52 text-xs" />
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowImportDialog(true)}>
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Importar
          </Button>
          <Button size="sm" className="h-8 text-xs bg-primary hover:bg-primary/80 text-white" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Novo Cliente
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-muted-foreground font-medium">Nome</th>
                  <th className="text-left p-3 text-muted-foreground font-medium">Telefone</th>
                  <th className="text-left p-3 text-muted-foreground font-medium">Plano</th>
                  <th className="text-right p-3 text-muted-foreground font-medium">Valor</th>
                  <th className="text-left p-3 text-muted-foreground font-medium">Barbeiro</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Dia Pgto</th>
                  <th className="text-center p-3 text-muted-foreground font-medium">Status</th>
                  <th className="text-right p-3 text-muted-foreground font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">Carregando...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">Nenhum cliente encontrado</td></tr>
                ) : (
                  filtered.map(c => {
                    const st = STATUS_LABELS[c.status] || STATUS_LABELS.pending;
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-3">
                          <p className="font-medium">{c.name}</p>
                          {c.email && <p className="text-[10px] text-muted-foreground">{c.email}</p>}
                        </td>
                        <td className="p-3 text-muted-foreground">{c.phone || "—"}</td>
                        <td className="p-3">{PLAN_LABELS[c.plan || ""] || c.plan || "—"}</td>
                        <td className="p-3 text-right">{c.planValue ? formatCurrency(c.planValue) : "—"}</td>
                        <td className="p-3 text-muted-foreground">{c.barberName || "—"}</td>
                        <td className="p-3 text-center">{c.paymentDay || "—"}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] border ${st.class}`}>{st.label}</span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Configurar assinatura" onClick={() => onSetup(c.id)}>
                              <Settings className="w-3.5 h-3.5" />
                            </Button>
                            {c.status === "active" && (
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" title="Cancelar assinatura" onClick={() => cancelSubscription(c.id)}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" title="Excluir" onClick={() => deleteClient(c.id)}>
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

      {/* Add Client Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-card border-card-border max-w-md">
          <DialogHeader><DialogTitle>Adicionar Cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome completo</Label>
              <Input value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} placeholder="Nome do cliente" />
            </div>
            <div>
              <Label className="text-xs">Telefone</Label>
              <Input value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} placeholder="(62) 99999-9999" />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={newClient.email} onChange={e => setNewClient({ ...newClient, email: e.target.value })} placeholder="email@exemplo.com" />
            </div>
            <Button onClick={createClient} className="w-full bg-primary hover:bg-primary/80 text-white">
              <UserPlus className="w-4 h-4 mr-2" /> Adicionar Cliente
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="bg-card border-card-border max-w-md">
          <DialogHeader><DialogTitle>Importar Clientes por Planilha</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="w-full">
              <Upload className="w-4 h-4 mr-2" />
              {importFile ? importFile.name : "Selecionar arquivo"}
            </Button>
            {importData.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">{importData.length} clientes válidos encontrados</p>
                <Button onClick={doImport} className="w-full bg-primary hover:bg-primary/80 text-white">
                  Importar {importData.length} clientes
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Setup View (configurar assinatura) ────────────────────
function SetupView({ clientId, onBack }: { clientId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [client, setClient] = useState<Cliente | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    plan: "",
    barberId: "",
    barberName: "",
    planValue: "",
    paymentDay: "",
    paymentAccount: "",
    paymentMethod: "",
    startDate: new Date().toISOString().split("T")[0],
    notes: "",
    status: "active",
  });

  // Carrega barbeiros do Trinks store (mesma fonte que o Equipe)
  const [barbeiros, setBarbeiros] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // Carrega cliente
    fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}`)
      .then(r => r.json())
      .then((c: Cliente) => {
        setClient(c);
        if (c.plan) {
          setForm({
            plan: c.plan || "",
            barberId: c.barberId || "",
            barberName: c.barberName || "",
            planValue: c.planValue?.toString() || "",
            paymentDay: c.paymentDay?.toString() || "",
            paymentAccount: c.paymentAccount || "",
            paymentMethod: c.paymentMethod || "",
            startDate: c.startDate ? c.startDate.split("T")[0] : new Date().toISOString().split("T")[0],
            notes: c.notes || "",
            status: c.status || "active",
          });
        }
      }).catch(() => {});

    // Carrega barbeiros do store/API
    fetch(`${API_BASE}/api/store`)
      .then(r => r.json())
      .then((data: any) => {
        if (data?.trinksProfessionals && Array.isArray(data.trinksProfessionals)) {
          setBarbeiros(data.trinksProfessionals.map((p: any) => ({
            id: String(p.id || p.idProfissional || ""),
            name: p.nome || p.name || "",
          })).filter((b: any) => b.name));
        }
      }).catch(() => {});
  }, [clientId]);

  const handlePlanChange = (plan: string) => {
    setForm(prev => ({
      ...prev,
      plan,
      planValue: PLAN_DEFAULTS[plan]?.toString() || prev.planValue,
    }));
  };

  const handleBarberChange = (barberId: string) => {
    const barber = barbeiros.find(b => b.id === barberId);
    setForm(prev => ({ ...prev, barberId, barberName: barber?.name || "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.plan) { toast({ title: "Selecione um plano", variant: "destructive" }); return; }
    if (!form.planValue) { toast({ title: "Informe o valor do plano", variant: "destructive" }); return; }
    if (!form.paymentDay) { toast({ title: "Informe o dia de pagamento", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/assinaturas/clientes/${clientId}/assinatura`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ title: "Assinatura configurada!" });
        onBack();
      }
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (!client) return <div className="py-12 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h2 className="text-base font-semibold">{client.plan ? "Editar Assinatura" : "Cadastrar Assinatura"}</h2>
          <p className="text-xs text-muted-foreground">{client.name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Dados da Assinatura</CardTitle>
            <CardDescription className="text-xs">Configure o plano e pagamento</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Plano</Label>
                <Select value={form.plan} onValueChange={handlePlanChange}>
                  <SelectTrigger><SelectValue placeholder="Selecione o plano" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="express_corte">Express Corte (R$ 80)</SelectItem>
                    <SelectItem value="express_cabelo_barba">Express Cabelo e Barba (R$ 160)</SelectItem>
                    <SelectItem value="personalizada">Personalizada</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Barbeiro</Label>
                <Select value={form.barberId} onValueChange={handleBarberChange}>
                  <SelectTrigger><SelectValue placeholder="Selecione o barbeiro" /></SelectTrigger>
                  <SelectContent>
                    {barbeiros.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    {barbeiros.length === 0 && <SelectItem value="_none" disabled>Sincronize a equipe primeiro</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Valor do Plano (R$)</Label>
                <Input type="number" step="0.01" value={form.planValue} onChange={e => setForm({ ...form, planValue: e.target.value })} placeholder="0,00" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Dia de Pagamento</Label>
                <Input type="number" min="1" max="31" value={form.paymentDay} onChange={e => setForm({ ...form, paymentDay: e.target.value })} placeholder="1-31" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Conta de Pagamento</Label>
                <Select value={form.paymentAccount} onValueChange={v => setForm({ ...form, paymentAccount: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="itau">Itaú</SelectItem>
                    <SelectItem value="infinitepay">InfinitePay</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Método de Pagamento</Label>
                <Select value={form.paymentMethod} onValueChange={v => setForm({ ...form, paymentMethod: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="cartao">Cartão</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Data de Início</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Observações</Label>
              <textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Observações sobre o assinante..."
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <Button type="submit" disabled={saving} className="w-full bg-primary hover:bg-primary/80 text-white">
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Salvando..." : "Salvar Assinatura"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

// ─── Alertas View ──────────────────────────────────────────
function AlertasView() {
  const { toast } = useToast();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadAlertas = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/assinaturas/alertas`)
      .then(r => r.json())
      .then(d => { setAlertas(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { loadAlertas(); }, []);

  const generateAlerts = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/assinaturas/alertas/gerar`, { method: "POST" });
      const d = await res.json();
      toast({ title: `${d.generated} alertas gerados` });
      loadAlertas();
    } catch {
      toast({ title: "Erro ao gerar alertas", variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const resolveAlert = async (id: string) => {
    await fetch(`${API_BASE}/api/assinaturas/alertas/${id}/resolver`, { method: "PUT" });
    toast({ title: "Alerta resolvido" });
    loadAlertas();
  };

  const active = alertas.filter(a => !a.isResolved);
  const resolved = alertas.filter(a => a.isResolved);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="text-xs">{active.length} ativos</Badge>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={generateAlerts} disabled={generating}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${generating ? "animate-spin" : ""}`} />
          Gerar Alertas
        </Button>
      </div>

      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Alertas Ativos ({active.length})</CardTitle>
          <CardDescription className="text-xs">Alertas que precisam de ação</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground text-sm">Carregando...</p>
          ) : active.length === 0 ? (
            <div className="py-12 text-center">
              <Bell className="w-10 h-10 text-muted mx-auto mb-3" />
              <p className="text-sm text-emerald-400">Nenhum alerta ativo. Tudo em ordem!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {active.map(a => {
                const info = ALERT_LABELS[a.type] || ALERT_LABELS.payment_overdue;
                return (
                  <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/50">
                    <Bell className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] border ${info.class}`}>{info.label}</span>
                        {a.clientName && <span className="text-[10px] text-muted-foreground">{a.clientName}</span>}
                      </div>
                      <p className="text-sm truncate">{a.message}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-xs flex-shrink-0" onClick={() => resolveAlert(a.id)}>
                      <CheckCircle className="w-3.5 h-3.5 mr-1" /> Resolver
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {resolved.length > 0 && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Resolvidos ({resolved.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {resolved.slice(0, 10).map(a => (
                <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/10 opacity-60">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <p className="text-xs text-muted-foreground truncate">{a.message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
