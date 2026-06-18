import { useState, useMemo, useEffect } from "react";
import { useStore } from "@/lib/store";
import { MonthSelector } from "@/components/MonthSelector";
import { useTrinksMonth } from "@/hooks/useTrinksMonth";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Consolidacao from "@/pages/Consolidacao";
import Conciliacao from "@/pages/Conciliacao";
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
  TrendingUp, Wallet, Calendar, FileText, Tag,
} from "lucide-react";
import type { DailyEntry } from "@shared/schema";
import SumarioDespesas from "@/components/lancamentos/SumarioDespesas";
import CategoriasRegrasPanel from "@/components/lancamentos/CategoriasRegrasPanel";
import ConciliacaoMultibanco from "@/components/lancamentos/ConciliacaoMultibanco";
import ExtratoDetalhado from "@/components/lancamentos/ExtratoDetalhado";

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
  const [bankTx, setBankTx] = useState<Array<{ id: string; date: string; description: string; amount: number; categoria?: string; tipo?: string; incluidoNoFluxo?: boolean; categoriaId?: string; subcategoria?: string }>>([]);
  // refreshKey força re-fetch das categorias e do sumário quando o usuário muda algo
  const [refreshKey, setRefreshKey] = useState(0);
  // Total de despesas vem via callback do SumarioDespesas
  const [totalDespesasDin, setTotalDespesasDin] = useState(0);
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

  // ── Etapa 2 Bloco 1: breakdown canônico (créd/déb/pix/dinheiro/Clube) ──
  const [canonico, setCanonico] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/mes/${selectedMes}/dados`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setCanonico(d?.breakdown ? d : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedMes, reloadKey]);

  // ── Etapa 2 Bloco 3: conferência esperado × caiu no Itaú ──
  const [conf, setConf] = useState<any>(null);
  const [confAberto, setConfAberto] = useState<string | null>(null); // forma expandida (detalhe sob demanda)
  useEffect(() => {
    let cancelled = false;
    setConf(null);
    fetch(`${API_BASE}/api/lancamentos/conferencia/${selectedMes}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.ok) setConf(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedMes, reloadKey]);

  // ── Etapa 2 Bloco 4: adimplência do Clube no mês (matriz de pagamentos;
  //    status por mês: pago/atrasado/pendente). NÃO soma no caixa. ──
  const [clubeAssin, setClubeAssin] = useState<any[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/assinaturas/matriz-pagamentos?ate=${selectedMes}&meses=1`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setClubeAssin(Array.isArray(d?.linhas) ? d.linhas : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedMes]);

  // Total de despesas vem do SumarioDespesas via callback `onChange`.
  const totalDespesas = totalDespesasDin;
  const resultado = vendas.mes.total - totalDespesas;
  const margemPct = vendas.mes.total > 0 ? (resultado / vendas.mes.total) * 100 : 0;

  // Breakdown canônico (Bloco 1). Fallback no vendas (useTrinksMonth) se ausente.
  const bk = canonico?.breakdown || null;
  const entrou = {
    credito: bk?.cartaoCredito ?? 0,
    debito: bk?.cartaoDebito ?? 0,
    pix: bk?.pix ?? vendas.mes.pix,
    dinheiro: bk?.dinheiro ?? vendas.mes.dinheiro,
    clube: bk?.plano ?? 0,
    outros: bk?.outros ?? 0,
    voucher: bk?.voucher ?? 0,
  };
  const totalEntrou = canonico?.faturamento ?? vendas.mes.total;

  // Bloco 4: contagem de adimplência do Clube.
  const clubeStats = useMemo(() => {
    const arr = clubeAssin || [];
    const st = (l: any) => l?.cells?.[0]?.status;
    const emDia = arr.filter((l: any) => st(l) === "pago").length;
    const atraso = arr.filter((l: any) => st(l) === "atrasado").length;
    const aVencer = arr.filter((l: any) => st(l) === "pendente").length;
    return { emDia, atraso, aVencer, total: arr.length };
  }, [clubeAssin]);

  // ── Conferência Trinks × Banco ──
  const difPix = vendas.mes.pix - banco.entradas.pix;
  const difCartao = vendas.mes.cartao - banco.entradas.cartao;
  const tolerancia = 100;

  // Limpar duplicatas (botão no header)
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
          <TabsTrigger value="conciliacao" data-testid="tab-conciliacao">Banco / Importar extrato</TabsTrigger>
          <TabsTrigger value="extrato" data-testid="tab-extrato">Extrato detalhado</TabsTrigger>
          <TabsTrigger value="orfas" data-testid="tab-orfas">Conciliação Trinks</TabsTrigger>
          <TabsTrigger value="categorias" data-testid="tab-categorias">Categorias & Regras</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="space-y-5 mt-0">

          {/* ═══ BLOCO 1 — O QUE ENTROU (faturamento) ═══ */}
          <Card className="border-emerald-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                1. O que entrou
                <span className="ml-auto text-base font-bold tabular-nums text-emerald-400" data-testid="entrou-total">{formatCurrency(totalEntrou)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                {[
                  { lbl: "💳 Crédito", v: entrou.credito },
                  { lbl: "💳 Débito", v: entrou.debito },
                  { lbl: "📲 PIX", v: entrou.pix },
                  { lbl: "💵 Dinheiro", v: entrou.dinheiro, amber: true },
                ].map((c, i) => (
                  <div key={i} className={`rounded border p-2 ${c.amber ? "border-amber-500/40 bg-amber-500/10" : "border-card-border/50 bg-background/30"}`} data-testid={`entrou-forma-${i}`}>
                    <div className={`text-[10px] ${c.amber ? "text-amber-300" : "text-muted-foreground"}`}>{c.lbl}</div>
                    <div className={`tabular-nums font-semibold ${c.amber ? "text-amber-400" : ""}`}>{formatCurrency(c.v)}</div>
                    <div className="text-[9px] text-muted-foreground">{totalEntrou > 0 ? `${((c.v / totalEntrou) * 100).toFixed(1)}%` : ""}</div>
                  </div>
                ))}
                {/* Clube Greco — origem InfinitePay */}
                <div className="rounded border border-primary/40 bg-primary/10 p-2" data-testid="entrou-clube">
                  <div className="text-[10px] text-primary flex items-center gap-1">🔵 Clube Greco</div>
                  <div className="tabular-nums font-semibold text-primary">{formatCurrency(entrou.clube)}</div>
                  <div className="text-[9px] text-muted-foreground">via InfinitePay</div>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground mt-2">
                Fonte canônica: {canonico?.fonte === "csv" ? "CSV importado" : canonico?.fonte === "trinks" ? "Trinks ao vivo" : (fonte === "csv" ? "CSV importado" : "Trinks")}
                {" "}· blindado contra 429 (não zera).
              </div>
            </CardContent>
          </Card>

          {/* ═══ BLOCO 2 — O QUE SAIU (despesas) ═══ */}
          <SumarioDespesas
            mes={selectedMes}
            comissoesCalc={comissoes.total}
            bonusCalc={0}
            taxaCartaoCalc={comissoes.taxaCartao}
            onChange={setTotalDespesasDin}
            refreshKey={refreshKey}
          />
          <Card className={resultado >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Faturado</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-400">{formatCurrency(totalEntrou)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Total de saídas</div>
                  <div className="text-lg font-bold tabular-nums text-red-400" data-testid="saiu-total">{formatCurrency(totalDespesas)}</div>
                </div>
                <div className="sm:border-l sm:border-border sm:pl-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Sobra</div>
                  <div className={`text-xl font-bold tabular-nums ${(totalEntrou - totalDespesas) >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid="sobra">
                    {formatCurrency(totalEntrou - totalDespesas)}
                  </div>
                  <div className="text-xs text-muted-foreground">{totalEntrou > 0 ? `${(((totalEntrou - totalDespesas) / totalEntrou) * 100).toFixed(1)}% margem` : ""}</div>
                </div>
              </div>
              {(banco.transferenciaInterna > 0 || banco.saidasIgnoradas > 0) && (
                <div className="text-[10px] italic text-muted-foreground space-x-3 mt-2">
                  {banco.transferenciaInterna > 0 && <span>Transf. interna excluída: {formatCurrency(banco.transferenciaInterna)}</span>}
                  {banco.saidasIgnoradas > 0 && <span>Saídas ignoradas: {formatCurrency(banco.saidasIgnoradas)}</span>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ═══ BLOCO 3 — CONFERÊNCIA (esperado × caiu no Itaú) ═══ */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                3. Conferência — esperado × caiu no Itaú
                {conf?.contaItau && <span className="text-[10px] font-normal text-muted-foreground">({conf.contaItau.nome})</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!conf ? (
                <div className="text-xs text-muted-foreground">Carregando conferência…</div>
              ) : !conf.contaItau ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>Conta Itaú não identificada. Importe o extrato e nomeie a conta com "Itaú" em <strong>Conciliação Bancária</strong>.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Cabeçalho */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground px-1">
                    <span>Forma</span><span className="text-right">Esperado</span><span className="text-right">Caiu</span><span className="text-right">Dif.</span>
                  </div>
                  {conf.linhas.map((l: any) => {
                    const formaKey = l.forma === "PIX" ? "pix" : l.forma === "Cartão" ? "cartao" : "dinheiro";
                    const cor = l.status === "verde" ? "text-emerald-400" : l.status === "amarelo" ? "text-amber-400" : "text-red-400";
                    const dot = l.status === "verde" ? "bg-emerald-400" : l.status === "amarelo" ? "bg-amber-400" : "bg-red-400";
                    const detalhe = (conf.detalhe?.[formaKey] || []) as any[];
                    const aberto = confAberto === formaKey;
                    const podeAbrir = l.status !== "verde" && detalhe.length > 0;
                    return (
                      <div key={l.forma} className="rounded border border-card-border/50 bg-background/30">
                        <button
                          type="button"
                          disabled={!podeAbrir}
                          onClick={() => setConfAberto(aberto ? null : formaKey)}
                          className={`w-full grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center p-2 text-xs ${podeAbrir ? "cursor-pointer hover:bg-muted/30" : ""}`}
                          data-testid={`conf-linha-${formaKey}`}
                        >
                          <span className="flex items-center gap-2 text-left">
                            <span className={`w-2 h-2 rounded-full ${dot}`} />
                            {l.forma}
                            {podeAbrir && <span className="text-[9px] text-muted-foreground">{aberto ? "▲" : "▼ ver"}</span>}
                          </span>
                          <span className="text-right tabular-nums">{formatCurrency(l.esperado)}</span>
                          <span className="text-right tabular-nums">{formatCurrency(l.caiu)}</span>
                          <span className={`text-right tabular-nums font-semibold ${cor}`}>{l.diferenca >= 0 ? "+" : ""}{formatCurrency(l.diferenca)}</span>
                        </button>
                        {aberto && (
                          <div className="border-t border-card-border/50 p-2 space-y-1" data-testid={`conf-detalhe-${formaKey}`}>
                            {detalhe.length === 0 ? (
                              <div className="text-[10px] text-muted-foreground">Sem transações no Itaú para esta forma.</div>
                            ) : detalhe.map((t: any, i: number) => (
                              <div key={i} className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="truncate text-muted-foreground">{t.date} · {t.description}</span>
                                <span className="tabular-nums flex-shrink-0">{formatCurrency(t.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Clube Greco — a caminho */}
                  {conf.clube && conf.clube.esperado > 0 && (() => {
                    const cl = conf.clube;
                    const map: any = {
                      verde: { cor: "text-emerald-400", dot: "bg-emerald-400", lbl: "conferido" },
                      a_caminho: { cor: "text-sky-400", dot: "bg-sky-400", lbl: "a caminho" },
                      pendente: { cor: "text-amber-400", dot: "bg-amber-400", lbl: `pendente (+${cl.diasThreshold}d)` },
                    };
                    const s = map[cl.status] || map.a_caminho;
                    return (
                      <div className="rounded border border-primary/30 bg-primary/5 grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center p-2 text-xs" data-testid="conf-clube">
                        <span className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                          🔵 Clube (InfinitePay→Itaú) <span className={`text-[9px] ${s.cor}`}>{s.lbl}</span>
                        </span>
                        <span className="text-right tabular-nums">{formatCurrency(cl.esperado)}</span>
                        <span className="text-right tabular-nums">{formatCurrency(cl.caiu)}</span>
                        <span className={`text-right tabular-nums font-semibold ${s.cor}`}>{cl.diferenca >= 0 ? "+" : ""}{formatCurrency(cl.diferenca)}</span>
                      </div>
                    );
                  })()}
                  <div className="text-[10px] text-muted-foreground px-1">Tolerância ±{formatCurrency(100)}. Clique numa linha amarela/vermelha pra ver as transações.</div>
                  {conf.linhas.every((l: any) => l.caiu === 0) && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between gap-2 mt-1">
                      <div className="text-xs">
                        <p className="font-medium">Nada caiu no Itaú ainda neste mês</p>
                        <p className="text-muted-foreground text-[10px]">Importe o extrato do Itaú pra conferir contra o esperado.</p>
                      </div>
                      <Button type="button" size="sm" onClick={() => setActiveTab("conciliacao" as any)} data-testid="conf-importar-itau">
                        <Upload className="w-4 h-4 mr-1.5" /> Importar extrato do Itaú
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ═══ BLOCO 4 — INFINITEPAY (adimplência do Clube; não soma no caixa) ═══ */}
          <Card className="border-sky-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Tag className="w-4 h-4 text-sky-400" />
                4. InfinitePay — adimplência do Clube
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
                  <div className="text-[10px] text-muted-foreground">Em dia</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-400" data-testid="clube-emdia">{clubeStats.emDia}</div>
                </div>
                <div className="rounded border border-red-500/30 bg-red-500/5 p-2">
                  <div className="text-[10px] text-muted-foreground">Em atraso</div>
                  <div className="text-lg font-bold tabular-nums text-red-400" data-testid="clube-atraso">{clubeStats.atraso}</div>
                </div>
                <div className="rounded border border-card-border/50 bg-background/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Recebido no mês</div>
                  <div className="text-lg font-bold tabular-nums" data-testid="clube-recebido">{formatCurrency(entrou.clube)}</div>
                </div>
              </div>
              {clubeStats.aVencer > 0 && (
                <div className="text-[10px] text-muted-foreground mt-2">{clubeStats.aVencer} ainda a vencer no mês (dentro do prazo).</div>
              )}
              <div className="text-[10px] text-muted-foreground mt-1 flex items-start gap-1">
                <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                Este valor já está contado no Bloco 1 (Clube Greco). Aqui é só o controle de quem pagou.
              </div>
            </CardContent>
          </Card>

          {/* CTA pra abrir Extrato detalhado quando há saídas */}
          {bankTx.filter(t => t.amount < 0).length > 0 && (
            <div className="rounded-md border border-card-border/40 bg-background/30 p-3 flex items-center justify-between gap-2">
              <div className="text-xs">
                <p className="font-medium">Categorize linha-a-linha</p>
                <p className="text-muted-foreground text-[10px]">
                  Filtre por banco, marque transferências internas manualmente, e edite categoria de cada lançamento.
                </p>
              </div>
              <Button type="button" size="sm" onClick={() => setActiveTab("extrato" as any)}>
                Abrir Extrato detalhado
              </Button>
            </div>
          )}

        </TabsContent>

        <TabsContent value="extrato" className="mt-0">
          <ExtratoDetalhado
            mes={selectedMes}
            onChanged={() => { setReloadKey(k => k + 1); setRefreshKey(k => k + 1); }}
          />
        </TabsContent>

        <TabsContent value="conciliacao" className="mt-0">
          <Consolidacao embedded />
        </TabsContent>

        <TabsContent value="orfas" className="mt-0">
          <Conciliacao />
        </TabsContent>

        <TabsContent value="categorias" className="mt-0">
          <CategoriasRegrasPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────────────

