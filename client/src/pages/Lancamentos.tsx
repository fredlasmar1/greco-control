import { useState, useMemo, useEffect } from "react";
import { useStore } from "@/lib/store";
import { MonthSelector } from "@/components/MonthSelector";
import { useTrinksMonth } from "@/hooks/useTrinksMonth";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Consolidacao from "@/pages/Consolidacao";
import { formatCurrency } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  CalendarCheck, Plus, Upload, Eye, EyeOff, Trash2, Sparkles, CheckCircle2, AlertCircle,
  TrendingUp, Wallet, Calendar, FileText,
} from "lucide-react";
import type { DailyEntry } from "@shared/schema";

const API_BASE = (globalThis as any).__API_BASE__ || "";

// ─── Dialog: Fechar Dia (mantido do componente anterior) ─────────────
function FecharDiaDialog() {
  const { addEntry } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ clients: '', revenue: '', pix: '', cartao: '', dinheiro: '', notes: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: DailyEntry = {
      id: `rev-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      type: 'receita',
      description: 'Fechamento do dia',
      amount: Number(form.revenue) || 0,
      clients: Number(form.clients) || 0,
      pix: Number(form.pix) || 0,
      cartao: Number(form.cartao) || 0,
      dinheiro: Number(form.dinheiro) || 0,
      notes: form.notes,
    };
    addEntry(entry);
    setOpen(false);
    setForm({ clients: '', revenue: '', pix: '', cartao: '', dinheiro: '', notes: '' });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="fechar-dia-lancamentos">
          <CalendarCheck className="w-4 h-4 mr-1.5" /> Fechar Dia
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader><DialogTitle>Fechar o Dia (manual)</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Clientes</Label><Input type="number" value={form.clients} onChange={e => setForm(p => ({ ...p, clients: e.target.value }))} /></div>
            <div><Label className="text-xs">Faturamento (R$)</Label><Input type="number" value={form.revenue} onChange={e => setForm(p => ({ ...p, revenue: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">Pix</Label><Input type="number" value={form.pix} onChange={e => setForm(p => ({ ...p, pix: e.target.value }))} /></div>
            <div><Label className="text-xs">Cartão</Label><Input type="number" value={form.cartao} onChange={e => setForm(p => ({ ...p, cartao: e.target.value }))} /></div>
            <div><Label className="text-xs">Dinheiro</Label><Input type="number" value={form.dinheiro} onChange={e => setForm(p => ({ ...p, dinheiro: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs">Observações</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          <Button type="submit" className="w-full bg-primary hover:bg-primary/80 text-white">Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: Adicionar Despesa Manual ─────────────────────────────────
function AddExpenseDialog({ onAdded }: { onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: 'fixo' as 'fixo' | 'variavel' | 'parcelamento' | 'investimento',
    subcategory: '',
    description: '',
    amount: '',
    recurrent: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = Math.abs(Number(form.amount.replace(',', '.')) || 0);
    if (!valor) return;
    await fetch(`${API_BASE}/api/financeiro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: form.date,
        description: form.description,
        amount: -valor, // sempre negativo
        category: form.category,
        subcategory: form.subcategory,
        recurrent: form.recurrent,
      }),
    });
    setOpen(false);
    setForm({ date: new Date().toISOString().slice(0, 10), category: 'fixo', subcategory: '', description: '', amount: '', recurrent: false });
    onAdded?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="add-expense-btn">
          <Plus className="w-4 h-4 mr-1.5" /> Nova Despesa
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-sm">
        <DialogHeader><DialogTitle>Nova Despesa</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div><Label className="text-xs">Data</Label><Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v as any }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixo">Fixa (aluguel, energia, internet…)</SelectItem>
                <SelectItem value="variavel">Variável (produtos, manutenção…)</SelectItem>
                <SelectItem value="parcelamento">Parcelamento</SelectItem>
                <SelectItem value="investimento">Investimento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Subcategoria (opcional)</Label><Input value={form.subcategory} onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))} placeholder="Aluguel, Energia, Produtos…" /></div>
          <div><Label className="text-xs">Descrição</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
          <div><Label className="text-xs">Valor (R$)</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
          <Button type="submit" className="w-full bg-primary hover:bg-primary/80 text-white">Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function getInicioSemana(d: Date): Date {
  const dia = d.getDay(); // 0=dom, 1=seg
  const offset = dia === 0 ? -6 : 1 - dia;
  const seg = new Date(d);
  seg.setDate(d.getDate() + offset);
  return seg;
}

function categorizarFormaPagamento(nome: string): "pix" | "cartao" | "dinheiro" | "outros" {
  const n = (nome || "").toLowerCase();
  if (n.includes("pix")) return "pix";
  if (/cart|créd|cred|déb|deb/.test(n)) return "cartao";
  if (/dinhe|espécie|especie|à vista|a vista/.test(n)) return "dinheiro";
  return "outros";
}

function categorizarBancoPorDesc(t: { description?: string; tipo?: string }): "pix" | "cartao" | "dinheiro" | "outros" {
  const tipo = (t.tipo || "").toLowerCase();
  if (tipo === "pix") return "pix";
  if (/cred|deb/.test(tipo)) return "cartao";
  const d = (t.description || "").toLowerCase();
  if (d.includes("pix")) return "pix";
  if (/maquin|cart|cred|deb|antecip/.test(d)) return "cartao";
  if (/deposit|dep dinh/.test(d)) return "dinheiro";
  return "outros";
}

// Mapeia categoria do banco/manual para o agrupamento de despesas da Lançamentos
function classificarDespesa(categoria?: string): "fixa" | "variavel" | "imposto" | "outros" {
  const c = (categoria || "").toLowerCase();
  if (["aluguel", "agua_luz", "sistema", "funcionario", "fixo"].includes(c)) return "fixa";
  if (["produtos", "esporadica", "variavel", "manutencao", "marketing"].includes(c)) return "variavel";
  if (c === "imposto") return "imposto";
  return "outros";
}

// ─── Componente Principal ─────────────────────────────────────────────
export default function Lancamentos() {
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("lancamentos.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("lancamentos.selectedMes", selectedMes); } catch {}
  }, [selectedMes]);
  const isMesCorrente = selectedMes === mesCorrente;

  const { trinks, hasTrinksData, loading, error, fonte, trinksAt, csvAt } = useTrinksMonth(selectedMes);

  const [activeTab, setActiveTab] = useState<"visao" | "conciliacao">("visao");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  // ── Vendas Trinks: agrupa por dia/semana/mês + breakdown por meio ──
  const vendas = useMemo(() => {
    const empty = {
      mes: { total: 0, count: 0, pix: 0, cartao: 0, dinheiro: 0, outros: 0 },
      semana: { total: 0, count: 0 },
      hoje: { total: 0, count: 0 },
    };
    if (!trinks) return empty;
    const transacoes: any[] = trinks.transacoes || [];
    const hojeStr = ymd(new Date());
    const inicioSem = ymd(getInicioSemana(new Date()));
    const fimSem = new Date(); // sábado/hoje

    let mesTotal = 0, mesCount = 0, mesPix = 0, mesCartao = 0, mesDinheiro = 0, mesOutros = 0;
    let semTotal = 0, semCount = 0;
    let hojeTotal = 0, hojeCount = 0;

    for (const t of transacoes) {
      const data = (t.dataHora || t.dataReferencia || t.data || "").slice(0, 10);
      const valor = Number(t.totalPagar || t.valor || 0);
      mesTotal += valor;
      mesCount += 1;

      const formas = t.formasPagamentos || t.formasPagamento || [];
      if (Array.isArray(formas)) {
        for (const fp of formas) {
          const v = Number(fp.valor || 0);
          const cat = categorizarFormaPagamento(fp.nome || fp.descricao || "");
          if (cat === "pix") mesPix += v;
          else if (cat === "cartao") mesCartao += v;
          else if (cat === "dinheiro") mesDinheiro += v;
          else mesOutros += v;
        }
      }

      if (isMesCorrente) {
        if (data === hojeStr) { hojeTotal += valor; hojeCount += 1; }
        if (data >= inicioSem && data <= ymd(fimSem)) { semTotal += valor; semCount += 1; }
      }
    }
    return {
      mes: { total: mesTotal, count: mesCount, pix: mesPix, cartao: mesCartao, dinheiro: mesDinheiro, outros: mesOutros },
      semana: { total: semTotal, count: semCount },
      hoje: { total: hojeTotal, count: hojeCount },
    };
  }, [trinks, isMesCorrente]);

  // ── Extrato bancário (entradas + saídas) ──
  const [bankTx, setBankTx] = useState<Array<{ id: string; date: string; description: string; amount: number; categoria?: string; tipo?: string; incluidoNoFluxo?: boolean }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/consolidacao/transacoes?mes=${selectedMes}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setBankTx(Array.isArray(d) ? d : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedMes, reloadKey]);

  const banco = useMemo(() => {
    let entrPix = 0, entrCartao = 0, entrDinheiro = 0, entrOutros = 0, entrTotal = 0;
    let saidaTotal = 0;
    const saidasPorClass: Record<"fixa" | "variavel" | "imposto" | "outros", number> = { fixa: 0, variavel: 0, imposto: 0, outros: 0 };
    let saidasSemCategoria = 0;
    let transferenciaInterna = 0;
    let saidasIgnoradas = 0;

    for (const t of bankTx) {
      if (t.amount > 0) {
        entrTotal += t.amount;
        const cat = categorizarBancoPorDesc(t);
        if (cat === "pix") entrPix += t.amount;
        else if (cat === "cartao") entrCartao += t.amount;
        else if (cat === "dinheiro") entrDinheiro += t.amount;
        else entrOutros += t.amount;
      } else if (t.amount < 0) {
        const v = Math.abs(t.amount);
        if (t.incluidoNoFluxo === false) { saidasIgnoradas += v; continue; }
        if (t.categoria === "transferencia_interna") { transferenciaInterna += v; continue; }
        saidaTotal += v;
        if (!t.categoria) { saidasSemCategoria += v; continue; }
        const cls = classificarDespesa(t.categoria);
        saidasPorClass[cls] += v;
      }
    }
    return { entradas: { pix: entrPix, cartao: entrCartao, dinheiro: entrDinheiro, outros: entrOutros, total: entrTotal },
             saidas: { ...saidasPorClass, semCategoria: saidasSemCategoria, total: saidaTotal },
             transferenciaInterna, saidasIgnoradas };
  }, [bankTx]);

  // ── Comissões + Bônus (do Pagamento) ──
  const [comissoes, setComissoes] = useState({ total: 0, taxaCartao: 0 });
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/pagamento/${selectedMes}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d?.totais) setComissoes({ total: d.totais.totalBruto || 0, taxaCartao: d.totais.totalTaxaCartao || 0 });
      })
      .catch(() => {});
  }, [selectedMes]);

  // ── Despesas manuais (financeEntries do mês) ──
  const [despManuais, setDespManuais] = useState<Array<{ id: string; date: string; description: string; amount: number; category: string; subcategory: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/financeiro`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const lista = Array.isArray(d) ? d : [];
        setDespManuais(lista.filter((e: any) => (e.date || "").slice(0, 7) === selectedMes && e.amount < 0));
      })
      .catch(() => {});
  }, [selectedMes, reloadKey]);

  const despesasManuaisAgrup = useMemo(() => {
    const out = { fixa: 0, variavel: 0, imposto: 0, outros: 0, parcelamento: 0, investimento: 0 };
    for (const e of despManuais) {
      const v = Math.abs(e.amount || 0);
      const c = (e.category || "").toLowerCase();
      if (c === "fixo") out.fixa += v;
      else if (c === "variavel") out.variavel += v;
      else if (c === "parcelamento") out.parcelamento += v;
      else if (c === "investimento") out.investimento += v;
      else out.outros += v;
    }
    return out;
  }, [despManuais]);

  // ── Totalizações finais ──
  const totalDespesasFixas = banco.saidas.fixa + despesasManuaisAgrup.fixa;
  const totalDespesasVariaveis = banco.saidas.variavel + despesasManuaisAgrup.variavel;
  const totalImpostosJuros = banco.saidas.imposto + despesasManuaisAgrup.imposto;
  const totalParcelamento = despesasManuaisAgrup.parcelamento;
  const totalInvestimentos = despesasManuaisAgrup.investimento;
  const totalOutros = banco.saidas.outros + despesasManuaisAgrup.outros;
  const totalSemCategoria = banco.saidas.semCategoria;
  const totalDespesas =
    totalDespesasFixas + totalDespesasVariaveis + totalImpostosJuros +
    totalParcelamento + totalInvestimentos + totalOutros + totalSemCategoria +
    comissoes.total + comissoes.taxaCartao;

  const resultado = vendas.mes.total - totalDespesas;
  const margemPct = vendas.mes.total > 0 ? (resultado / vendas.mes.total) * 100 : 0;

  // ── Conferência Trinks × Banco ──
  const difPix = vendas.mes.pix - banco.entradas.pix;
  const difCartao = vendas.mes.cartao - banco.entradas.cartao;
  const tolerancia = 100;

  // ── Ações nas saídas do extrato ──
  const toggleFluxoTx = async (id: string, incluido: boolean) => {
    await fetch(`${API_BASE}/api/consolidacao/transacoes/${id}/fluxo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incluido }),
    });
    reload();
  };
  const deleteTx = async (id: string) => {
    if (!confirm("Apagar esta transação? Não pode ser desfeito.")) return;
    await fetch(`${API_BASE}/api/consolidacao/transacoes/${id}`, { method: "DELETE" });
    reload();
  };
  const dedupSaidas = async () => {
    if (!confirm("Limpar duplicatas de SAÍDAS (entradas são preservadas)?")) return;
    const r = await fetch(`${API_BASE}/api/consolidacao/dedup`, { method: "POST" });
    const d = await r.json();
    alert(`${d.removidas} duplicatas de saída removidas.`);
    reload();
  };

  // ── Render ──
  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Lançamentos — {labelMesPtBR(selectedMes)}</h2>
          <p className="text-sm text-muted-foreground">Vendas, conferência banco × Trinks e despesas categorizadas</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveTab("conciliacao");
              setTimeout(() => {
                const el = document.querySelector('[data-testid="conciliacao-import-card"]') || document.querySelector('[data-testid="btn-import"]');
                if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
              }, 200);
            }}
          >
            <Upload className="w-4 h-4 mr-1.5" /> Importar Extrato
          </Button>
          {bankTx.some(t => t.amount < 0) && (
            <Button type="button" variant="outline" size="sm" onClick={dedupSaidas} title="Remove saídas duplicadas (entradas preservadas)">
              <Sparkles className="w-4 h-4 mr-1.5" /> Limpar duplicatas
            </Button>
          )}
          <AddExpenseDialog onAdded={reload} />
          <FecharDiaDialog />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="visao" data-testid="tab-visao">Visão do Mês</TabsTrigger>
          <TabsTrigger value="conciliacao" data-testid="tab-conciliacao">Conciliação Bancária</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="space-y-5 mt-0">

          {/* ─── SEÇÃO 1: VENDAS (Trinks) ─── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                1. Vendas {isMesCorrente ? "— Hoje, Semana, Mês" : "— Mês"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`grid ${isMesCorrente ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1"} gap-3`}>
                {isMesCorrente && (
                  <>
                    <div className="rounded-md border border-border p-3 bg-muted/20">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Hoje</div>
                      <div className="text-xl font-bold tabular-nums">{formatCurrency(vendas.hoje.total)}</div>
                      <div className="text-xs text-muted-foreground">{vendas.hoje.count} {vendas.hoje.count === 1 ? "comanda" : "comandas"}</div>
                    </div>
                    <div className="rounded-md border border-border p-3 bg-muted/20">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Semana</div>
                      <div className="text-xl font-bold tabular-nums">{formatCurrency(vendas.semana.total)}</div>
                      <div className="text-xs text-muted-foreground">{vendas.semana.count} atendimentos</div>
                    </div>
                  </>
                )}
                <div className="rounded-md border border-emerald-500/30 p-3 bg-emerald-500/5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Mês</div>
                  <div className="text-xl font-bold tabular-nums text-emerald-400">{formatCurrency(vendas.mes.total)}</div>
                  <div className="text-xs text-muted-foreground">{vendas.mes.count} atendimentos</div>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground mt-2">
                Origem: {fonte === "csv" ? "CSV Trinks importado" : "Trinks API ao vivo"}
                {trinksAt && fonte !== "csv" && ` · sincronizado ${new Date(trinksAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`}
                {csvAt && fonte === "csv" && ` · CSV importado ${new Date(csvAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`}
              </div>
            </CardContent>
          </Card>

          {/* ─── SEÇÃO 2: CONFERÊNCIA TRINKS × BANCO ─── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                2. Conferência: Trinks × Banco
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bankTx.length === 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    Nenhum extrato bancário importado para {labelMesPtBR(selectedMes)}.
                    {" "}Para conferir se o que o Trinks vendeu bateu com o que entrou no banco, suba o extrato em <strong>Conciliação Bancária</strong>.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Meio</th>
                        <th className="text-right py-2 px-2 font-medium">Trinks</th>
                        <th className="text-right py-2 px-2 font-medium">Banco</th>
                        <th className="text-right py-2 px-2 font-medium">Diferença</th>
                        <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <LinhaConferencia label="Pix" tr={vendas.mes.pix} bk={banco.entradas.pix} tolerancia={tolerancia} />
                      <LinhaConferencia label="Cartão" tr={vendas.mes.cartao} bk={banco.entradas.cartao} tolerancia={tolerancia} />
                      <tr className="border-b border-border/40">
                        <td className="py-2 px-2 font-medium">Dinheiro</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(vendas.mes.dinheiro)}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground italic">—</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(vendas.mes.dinheiro)}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground hidden md:table-cell">Espécie não cai no banco</td>
                      </tr>
                      {(vendas.mes.outros > 0 || banco.entradas.outros > 0) && (
                        <tr className="border-b border-border/40">
                          <td className="py-2 px-2 font-medium">Outros</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(vendas.mes.outros)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(banco.entradas.outros)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(vendas.mes.outros - banco.entradas.outros)}</td>
                          <td className="py-2 px-2 text-xs text-muted-foreground hidden md:table-cell">Voucher, depósito, transferência…</td>
                        </tr>
                      )}
                      <tr className="font-semibold">
                        <td className="py-2 px-2">Total</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(vendas.mes.total)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(banco.entradas.total)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(vendas.mes.total - banco.entradas.total)}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground hidden md:table-cell">
                          {Math.abs(vendas.mes.total - banco.entradas.total) <= tolerancia ? "Conciliado" : "Verificar pendências"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Diferença positiva = Trinks vendeu mais do que caiu no banco (pendentes ou em trânsito).
                {" "}Diferença negativa = entrou no banco mais do que o Trinks registrou (revisar conta).
              </p>
            </CardContent>
          </Card>

          {/* ─── SEÇÃO 3: DESPESAS DO MÊS ─── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wallet className="w-4 h-4 text-red-400" />
                3. Despesas — {labelMesPtBR(selectedMes)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-sm">
                <LinhaDespesa label="Fixas" valor={totalDespesasFixas} sub={`Manuais ${formatCurrency(despesasManuaisAgrup.fixa)} · Extrato ${formatCurrency(banco.saidas.fixa)}`} />
                <LinhaDespesa label="Variáveis" valor={totalDespesasVariaveis} sub={`Manuais ${formatCurrency(despesasManuaisAgrup.variavel)} · Extrato ${formatCurrency(banco.saidas.variavel)}`} />
                <LinhaDespesa label="Comissões + Bônus" valor={comissoes.total} sub={comissoes.total > 0 ? "calculado pelo Pagamento" : ""} />
                <LinhaDespesa label="Taxa de cartão" valor={comissoes.taxaCartao} sub={comissoes.taxaCartao > 0 ? "descontado pela maquininha" : ""} />
                {totalImpostosJuros > 0 && <LinhaDespesa label="Impostos / Juros" valor={totalImpostosJuros} />}
                {totalParcelamento > 0 && <LinhaDespesa label="Parcelamentos" valor={totalParcelamento} sub="manuais" />}
                {totalInvestimentos > 0 && <LinhaDespesa label="Investimentos" valor={totalInvestimentos} sub="manuais" />}
                {totalOutros > 0 && <LinhaDespesa label="Outros" valor={totalOutros} />}
                {totalSemCategoria > 0 && (
                  <LinhaDespesa
                    label="Sem categoria"
                    valor={totalSemCategoria}
                    sub="classifique na Conciliação Bancária"
                    alerta
                  />
                )}
                {banco.transferenciaInterna > 0 && (
                  <div className="flex items-center justify-between py-1 text-xs italic text-muted-foreground">
                    <span>Transf. interna (excluída do total)</span>
                    <span className="tabular-nums">{formatCurrency(banco.transferenciaInterna)}</span>
                  </div>
                )}
                {banco.saidasIgnoradas > 0 && (
                  <div className="flex items-center justify-between py-1 text-xs italic text-muted-foreground">
                    <span>Saídas marcadas como ignoradas</span>
                    <span className="tabular-nums">{formatCurrency(banco.saidasIgnoradas)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2 mt-2 font-semibold">
                  <span>Total de Despesas</span>
                  <span className="tabular-nums text-red-400">{formatCurrency(totalDespesas)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ─── SEÇÃO 4: RESULTADO ─── */}
          <Card className={resultado >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                4. Resultado do Mês
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Entradas (Trinks)</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-400">{formatCurrency(vendas.mes.total)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Despesas</div>
                  <div className="text-lg font-bold tabular-nums text-red-400">{formatCurrency(totalDespesas)}</div>
                </div>
                <div className="sm:border-l sm:border-border sm:pl-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Resultado</div>
                  <div className={`text-xl font-bold tabular-nums ${resultado >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatCurrency(resultado)}
                  </div>
                  <div className="text-xs text-muted-foreground">{margemPct.toFixed(1)}% margem</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ─── SEÇÃO 5: SAÍDAS DO EXTRATO (com ações) ─── */}
          {bankTx.filter(t => t.amount < 0).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  Saídas do extrato — gerencie inclusão / categorização
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Data</th>
                        <th className="text-left py-2 px-2 font-medium">Descrição</th>
                        <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Categoria</th>
                        <th className="text-right py-2 px-2 font-medium">Valor</th>
                        <th className="text-right py-2 px-2 font-medium w-24">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankTx.filter(t => t.amount < 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(t => {
                        const incluido = t.incluidoNoFluxo !== false;
                        return (
                          <tr key={t.id} className={`border-b border-border/40 hover:bg-muted/30 ${!incluido ? "opacity-50" : ""}`}>
                            <td className="py-2 px-2 text-xs whitespace-nowrap">{new Date(t.date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                            <td className="py-2 px-2 text-xs">{t.description}</td>
                            <td className="py-2 px-2 text-xs hidden md:table-cell">{t.categoria ? <Badge variant="outline" className="text-[10px]">{t.categoria}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-red-400">-{formatCurrency(Math.abs(t.amount))}</td>
                            <td className="py-2 px-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => toggleFluxoTx(t.id, !incluido)} title={incluido ? "Ignorar no fluxo" : "Incluir de novo"}>
                                  {incluido ? <Eye className="w-3.5 h-3.5 text-emerald-400" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                                </Button>
                                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-red-400 hover:text-red-500 hover:bg-red-500/10" onClick={() => deleteTx(t.id)} title="Apagar">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {bankTx.filter(t => t.amount < 0).length > 30 && (
                  <p className="text-[11px] text-muted-foreground mt-2 text-center">
                    Mostrando 30 mais recentes de {bankTx.filter(t => t.amount < 0).length}. Para gerenciar todas, use a tab Conciliação.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

        </TabsContent>

        <TabsContent value="conciliacao" className="mt-0">
          <Consolidacao embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────────────
function LinhaConferencia({ label, tr, bk, tolerancia }: { label: string; tr: number; bk: number; tolerancia: number }) {
  const dif = tr - bk;
  const conciliado = Math.abs(dif) <= tolerancia;
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 px-2 font-medium">{label}</td>
      <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(tr)}</td>
      <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(bk)}</td>
      <td className={`py-2 px-2 text-right tabular-nums ${conciliado ? "text-emerald-400" : dif > 0 ? "text-amber-400" : "text-blue-400"}`}>
        {dif >= 0 ? "+" : ""}{formatCurrency(dif)}
      </td>
      <td className="py-2 px-2 text-xs text-muted-foreground hidden md:table-cell">
        {conciliado ? "✓ Bate" : dif > 0 ? "Trinks > Banco (pendente)" : "Banco > Trinks (revisar)"}
      </td>
    </tr>
  );
}

function LinhaDespesa({ label, valor, sub, alerta }: { label: string; valor: number; sub?: string; alerta?: boolean }) {
  if (valor === 0 && !alerta) return null;
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-border/40">
      <div>
        <div className="text-sm">{label}</div>
        {sub && <div className={`text-[10px] ${alerta ? "text-amber-400" : "text-muted-foreground"}`}>{sub}</div>}
      </div>
      <div className="tabular-nums text-sm">{formatCurrency(valor)}</div>
    </div>
  );
}
