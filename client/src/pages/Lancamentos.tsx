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

  const [activeTab, setActiveTab] = useState<"entradas" | "saidas" | "visao" | "conciliacao">("entradas");
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

  // ── v52: saídas unificadas (manual + extrato) com Fixa/Variável ──
  const [saidas, setSaidas] = useState<any>(null);
  const carregarSaidas = () => {
    fetch(`${API_BASE}/api/lancamentos/saidas/${selectedMes}`)
      .then(r => r.json())
      .then(d => { if (d?.ok) setSaidas(d); })
      .catch(() => {});
  };
  useEffect(() => { setSaidas(null); carregarSaidas(); /* eslint-disable-next-line */ }, [selectedMes, reloadKey]);
  const setTipoDespesa = async (id: string, tipoDespesa: "fixa" | "variavel" | null) => {
    await fetch(`${API_BASE}/api/lancamentos/despesa/${id}/tipo`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoDespesa }),
    });
    setReloadKey(k => k + 1); // recalcula saídas + viabilidade
  };

  // ── v49: resumo do livro do Itaú (Entrou/Saiu/Neutro + comparação Trinks) ──
  const [resumo, setResumo] = useState<any>(null);
  const carregarResumo = () => {
    fetch(`${API_BASE}/api/lancamentos/resumo/${selectedMes}`)
      .then(r => r.json())
      .then(d => { if (d?.ok) setResumo(d); })
      .catch(() => {});
  };
  useEffect(() => { setResumo(null); carregarResumo(); /* eslint-disable-next-line */ }, [selectedMes, reloadKey]);

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
          <TabsTrigger value="entradas" data-testid="tab-entradas">Entradas</TabsTrigger>
          <TabsTrigger value="saidas" data-testid="tab-saidas">Saídas</TabsTrigger>
          <TabsTrigger value="visao" data-testid="tab-visao">Visão do Mês</TabsTrigger>
          <TabsTrigger value="conciliacao" data-testid="tab-conciliacao">Banco / Importar extrato</TabsTrigger>
          <TabsTrigger value="orfas" data-testid="tab-orfas">Conciliação Trinks</TabsTrigger>
          <TabsTrigger value="categorias" data-testid="tab-categorias">Categorias & Regras</TabsTrigger>
        </TabsList>

        {/* ═══ ENTRADAS (faturamento — fonte canônica, zero digitação) ═══ */}
        <TabsContent value="entradas" className="space-y-4 mt-0">
          <Card className="border-emerald-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" /> Entradas do mês
                <span className="ml-auto text-base font-bold tabular-nums text-emerald-400" data-testid="entradas-total">{formatCurrency(totalEntrou)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                {[
                  { lbl: "💳 Crédito", v: entrou.credito },
                  { lbl: "💳 Débito", v: entrou.debito },
                  { lbl: "📲 PIX", v: entrou.pix },
                  { lbl: "💵 Dinheiro", v: entrou.dinheiro, amber: true },
                  { lbl: "🔵 Clube", v: entrou.clube, primary: true },
                ].map((c, i) => (
                  <div key={i} className={`rounded border p-2 ${c.amber ? "border-amber-500/40 bg-amber-500/10" : c.primary ? "border-primary/40 bg-primary/10" : "border-card-border/50 bg-background/30"}`} data-testid={`entradas-forma-${i}`}>
                    <div className={`text-[10px] ${c.amber ? "text-amber-300" : c.primary ? "text-primary" : "text-muted-foreground"}`}>{c.lbl}</div>
                    <div className={`tabular-nums font-semibold ${c.amber ? "text-amber-400" : c.primary ? "text-primary" : ""}`}>{formatCurrency(c.v)}</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-2">Fonte canônica (mesma da Viabilidade) · blindado contra 429 · sem digitação.</div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ SAÍDAS (Fixas / Variáveis / A classificar) ═══ */}
        <TabsContent value="saidas" className="space-y-4 mt-0">
          {!saidas ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Carregando saídas…</div>
          ) : (() => {
            const linha = (i: any) => (
              <div key={i.id} className={`flex items-center justify-between gap-2 text-xs p-2 rounded border ${!i.efetivo ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card"}`} data-testid={`saida-${i.id}`}>
                <span className="flex-1 min-w-0">
                  <span className="text-muted-foreground">{i.date.slice(8)}/{i.date.slice(5,7)}</span> {i.description}
                  <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{i.origem}</span>
                  {i.categoria && <span className="ml-1 text-[9px] text-muted-foreground/70">· {i.categoria}</span>}
                  {i.conflito && <span className="ml-1 text-[9px] text-amber-400" title="o toggle diverge da categoria">override</span>}
                </span>
                <span className="tabular-nums text-red-400 flex-shrink-0">{formatCurrency(i.valor)}</span>
                <div className="flex gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => setTipoDespesa(i.id, i.efetivo === "fixa" ? null : "fixa")}
                    className={`text-[10px] px-2 py-1 rounded border ${i.efetivo === "fixa" ? "border-sky-500/50 bg-sky-500/15 text-sky-400" : "border-border text-muted-foreground hover:bg-muted/30"}`}
                    data-testid={`btn-fixa-${i.id}`}>Fixa</button>
                  <button type="button" onClick={() => setTipoDespesa(i.id, i.efetivo === "variavel" ? null : "variavel")}
                    className={`text-[10px] px-2 py-1 rounded border ${i.efetivo === "variavel" ? "border-orange-500/50 bg-orange-500/15 text-orange-400" : "border-border text-muted-foreground hover:bg-muted/30"}`}
                    data-testid={`btn-var-${i.id}`}>Variável</button>
                </div>
              </div>
            );
            const fixas = saidas.itens.filter((i: any) => i.efetivo === "fixa");
            const vars = saidas.itens.filter((i: any) => i.efetivo === "variavel");
            const aClass = saidas.itens.filter((i: any) => !i.efetivo);
            return (
              <>
                {/* resumo */}
                <div className="grid grid-cols-3 gap-2">
                  <Card className="border-sky-500/30"><CardContent className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Fixas</div><div className="text-lg font-bold text-sky-400 tabular-nums" data-testid="saidas-fixas">{formatCurrency(saidas.totalFixas)}</div></CardContent></Card>
                  <Card className="border-orange-500/30"><CardContent className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Variáveis</div><div className="text-lg font-bold text-orange-400 tabular-nums" data-testid="saidas-variaveis">{formatCurrency(saidas.totalVariaveis)}</div></CardContent></Card>
                  <Card className="border-card-border"><CardContent className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Total saídas</div><div className="text-lg font-bold tabular-nums" data-testid="saidas-total">{formatCurrency(saidas.total)}</div></CardContent></Card>
                </div>

                {aClass.length > 0 && (
                  <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-amber-400"><AlertCircle className="w-4 h-4" /> A classificar ({aClass.length}) · {formatCurrency(saidas.totalAClassificar)}</CardTitle></CardHeader>
                    <CardContent className="space-y-1"><p className="text-[11px] text-muted-foreground -mt-1 mb-1">Marque Fixa ou Variável — sem isso não entram no resultado da Viabilidade.</p>{aClass.map(linha)}</CardContent>
                  </Card>
                )}
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-sky-400">Despesas Fixas · {formatCurrency(saidas.totalFixas)}</CardTitle></CardHeader><CardContent className="space-y-1">{fixas.length ? fixas.map(linha) : <p className="text-xs text-muted-foreground">Nenhuma despesa fixa marcada.</p>}</CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-orange-400">Despesas Variáveis · {formatCurrency(saidas.totalVariaveis)}</CardTitle></CardHeader><CardContent className="space-y-1">{vars.length ? vars.map(linha) : <p className="text-xs text-muted-foreground">Nenhuma despesa variável marcada.</p>}</CardContent></Card>
              </>
            );
          })()}
        </TabsContent>

        <TabsContent value="visao" className="space-y-5 mt-0">

          {/* ═══ RESUMO DO MÊS — livro do Itaú categorizado ═══ */}
          {resumo && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="border-emerald-500/30"><CardContent className="p-4">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Entrou (faturamento)</div>
                  <p className="text-xl font-bold text-emerald-400" data-testid="resumo-entrou">{formatCurrency(resumo.entrou?.total || 0)}</p>
                </CardContent></Card>
                <Card className="border-red-500/30"><CardContent className="p-4">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Saiu (despesas)</div>
                  <p className="text-xl font-bold text-red-400" data-testid="resumo-saiu">{formatCurrency(resumo.saiu?.total || 0)}</p>
                </CardContent></Card>
                <Card className={(resumo.sobra || 0) >= 0 ? "border-emerald-500/30" : "border-red-500/30"}><CardContent className="p-4">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Sobra</div>
                  <p className={`text-xl font-bold ${(resumo.sobra || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid="resumo-sobra">{formatCurrency(resumo.sobra || 0)}</p>
                </CardContent></Card>
                <Card className={((resumo.aClassificarEntrada || 0) + (resumo.aClassificarSaida || 0)) > 0 ? "border-amber-500/40" : "border-card-border"}><CardContent className="p-4">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">A classificar</div>
                  <p className="text-xl font-bold text-amber-400" data-testid="resumo-classificar">{formatCurrency((resumo.aClassificarEntrada || 0) + (resumo.aClassificarSaida || 0))}</p>
                  {(resumo.neutro?.total || 0) > 0 && <span className="text-[10px] text-muted-foreground">neutro (não conta): {formatCurrency(resumo.neutro.total)}</span>}
                </CardContent></Card>
              </div>

              {resumo.trinks && (
                <Card className="bg-card border-card-border"><CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Faturamento: marcado no extrato × Trinks</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div><div className="text-[10px] text-muted-foreground">Extrato (faturamento)</div><div className="font-bold tabular-nums text-emerald-400">{formatCurrency(resumo.entrou?.total || 0)}</div></div>
                    <div><div className="text-[10px] text-muted-foreground">Trinks (canônico)</div><div className="font-bold tabular-nums">{formatCurrency(resumo.trinks.canonico || 0)}</div></div>
                    <div><div className="text-[10px] text-muted-foreground">Trinks API</div><div className="tabular-nums">{formatCurrency(resumo.trinks.api || 0)}</div></div>
                    <div><div className="text-[10px] text-muted-foreground">Trinks CSV</div><div className="tabular-nums">{formatCurrency(resumo.trinks.csvFinanceiro || resumo.trinks.csvCaixa || 0)}</div></div>
                  </div>
                  <div className="text-[11px] mt-2">Diferença extrato − Trinks: <strong className={Math.abs(resumo.diffFaturamentoVsTrinks || 0) <= 100 ? "text-emerald-400" : "text-amber-400"}>{formatCurrency(resumo.diffFaturamentoVsTrinks || 0)}</strong></div>
                </CardContent></Card>
              )}
            </>
          )}

          {/* ═══ LIVRO DO ITAÚ — editável (categoria + justificativa + 👁 conta-no-mês) ═══ */}
          <ExtratoDetalhado
            mes={selectedMes}
            onChanged={() => { setReloadKey(k => k + 1); setRefreshKey(k => k + 1); carregarResumo(); }}
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

