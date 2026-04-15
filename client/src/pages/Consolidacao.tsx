import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTrinksStore, getTrinksMonthTotals } from "@/lib/trinksStore";
import { formatCurrency, getMonthTotals } from "@/lib/demoData";
import {
  Building2, CreditCard, Coins, Upload, AlertTriangle, CheckCircle2,
  TrendingDown, Plus, Trash2, ArrowRight, Pencil, Zap, Tag,
  Server, UserCog, Home, Droplets, ShoppingBag, Receipt as ReceiptIcon,
  ArrowLeftRight, HelpCircle, Sparkles,
} from "lucide-react";

const API_BASE = (globalThis as any).__API_BASE__ || "";

type TipoConta = "banco" | "maquininha" | "caixa";
type Meio = "pix" | "debito" | "credito" | "dinheiro";
type TipoTransacao = "pix" | "debito" | "credito" | "antecipacao" | "tarifa" | "transferencia" | "outro";
type CategoriaGasto = "sistema" | "funcionario" | "aluguel" | "agua_luz" | "produtos" | "imposto" | "transferencia_interna" | "esporadica" | "outros";

const CATEGORIAS_INFO: Record<CategoriaGasto, { label: string; icon: any; color: string }> = {
  sistema: { label: "Sistema", icon: Server, color: "text-blue-400 border-blue-500/40 bg-blue-500/10" },
  funcionario: { label: "Funcionário", icon: UserCog, color: "text-violet-400 border-violet-500/40 bg-violet-500/10" },
  aluguel: { label: "Aluguel", icon: Home, color: "text-amber-400 border-amber-500/40 bg-amber-500/10" },
  agua_luz: { label: "Água/Luz", icon: Droplets, color: "text-cyan-400 border-cyan-500/40 bg-cyan-500/10" },
  produtos: { label: "Produtos", icon: ShoppingBag, color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
  imposto: { label: "Imposto", icon: ReceiptIcon, color: "text-red-400 border-red-500/40 bg-red-500/10" },
  transferencia_interna: { label: "Transf. Interna", icon: ArrowLeftRight, color: "text-muted-foreground border-border bg-muted/30" },
  esporadica: { label: "Esporádica", icon: Sparkles, color: "text-pink-400 border-pink-500/40 bg-pink-500/10" },
  outros: { label: "Outros", icon: HelpCircle, color: "text-muted-foreground border-border bg-muted/30" },
};

interface Conta {
  id: string;
  nome: string;
  tipo: TipoConta;
  meios: Meio[];
  taxaDebito?: number;
  taxaCredito?: number;
  taxaPix?: number;
  taxaAntecipacao?: number;
  diasLiquidacaoDebito?: number;
  diasLiquidacaoCredito?: number;
  ativa: boolean;
  createdAt: string;
}
interface TransacaoBanco {
  id: string;
  contaId: string;
  date: string;
  description: string;
  amount: number;
  tipo?: TipoTransacao;
  categoria?: CategoriaGasto;
  importedAt: string;
}

// ─── CSV parser ────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    const sep = line.includes(";") ? ";" : ",";
    const cells: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === sep && !inQuote) { cells.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

function parseBR(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d,.\-+]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseDate(s: string): string {
  if (!s) return "";
  s = s.trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const dash = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dash) return `${dash[3]}-${dash[2]}-${dash[1]}`;
  return "";
}

function detectColumns(headers: string[]) {
  const dateIdx = headers.findIndex(h => /data|date|dt/i.test(h));
  const descIdx = headers.findIndex(h => /descri|histor|memo|observa|lan[çc]amento/i.test(h));
  const amtIdx = headers.findIndex(h => /valor|amount|montante|cr[eé]dito/i.test(h));
  return {
    date: dateIdx >= 0 ? dateIdx : 0,
    description: descIdx >= 0 ? descIdx : 1,
    amount: amtIdx >= 0 ? amtIdx : 2,
  };
}

// Detecta tipo de transação pela descrição
function detectTipo(description: string): TipoTransacao | undefined {
  const d = description.toLowerCase();
  if (/antecip/.test(d)) return "antecipacao";
  if (/pix/.test(d)) return "pix";
  if (/d[ée]bito|deb\.|cart.*deb/.test(d)) return "debito";
  if (/cr[ée]dito|cred\.|cart.*cred|parcelad/.test(d)) return "credito";
  if (/tarifa|tar\.|iof|taxa|anuidade/.test(d)) return "tarifa";
  if (/ted|doc|transfer/.test(d)) return "transferencia";
  return undefined;
}

function formatMonth(s: string): string {
  const [y, m] = s.split("-");
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[parseInt(m)-1]}/${y}`;
}

const MEIO_LABELS: Record<Meio, string> = {
  pix: "Pix",
  debito: "Débito",
  credito: "Crédito",
  dinheiro: "Dinheiro",
};

// ─── Page ───────────────────────────────────────────────────
export default function Consolidacao() {
  const { toast } = useToast();
  const { trinks, isConnected } = useTrinksStore();
  const hasTrinksData = isConnected && trinks !== null;

  const [contas, setContas] = useState<Conta[]>([]);
  const [transacoes, setTransacoes] = useState<TransacaoBanco[]>([]);
  const [selectedMes, setSelectedMes] = useState(() => new Date().toISOString().slice(0, 7));

  const loadData = async () => {
    try {
      const [rContas, rTx] = await Promise.all([
        fetch(`${API_BASE}/api/consolidacao/contas`).then(r => r.json()),
        fetch(`${API_BASE}/api/consolidacao/transacoes?mes=${selectedMes}`).then(r => r.json()),
      ]);
      setContas(Array.isArray(rContas) ? rContas : []);
      setTransacoes(Array.isArray(rTx) ? rTx : []);
    } catch {}
  };

  useEffect(() => { loadData(); }, [selectedMes]);

  // Atualiza categoria de uma transação (e opcionalmente aprende o padrão)
  const atualizarCategoria = async (txId: string, categoria: CategoriaGasto | null, aprenderRegra = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/consolidacao/transacoes/${txId}/categoria`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria, aprenderRegra }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.aplicadaEm > 0) {
          toast({ title: "Padrão aprendido!", description: `Aplicado em outras ${data.aplicadaEm} transação${data.aplicadaEm > 1 ? "ões" : ""}.` });
        }
        loadData();
      }
    } catch {}
  };

  const trinksTotals = useMemo(() => {
    if (hasTrinksData) return getTrinksMonthTotals(trinks!);
    return getMonthTotals();
  }, [hasTrinksData, trinks]);

  // ─── Totais por meio (somando antecipações como crédito) ──
  const totaisPorMeio = useMemo(() => {
    let pix = 0, debito = 0, credito = 0, dinheiro = 0, tarifas = 0;
    transacoes.forEach(t => {
      const conta = contas.find(c => c.id === t.contaId);
      if (!conta) return;

      // Tarifas/taxas (negativos) — agrupam separado
      if (t.tipo === "tarifa" || t.tipo === "transferencia") {
        if (t.amount < 0) tarifas += Math.abs(t.amount);
        return;
      }

      if (t.amount <= 0) return;

      // Antecipações = crédito recebido antecipado
      if (t.tipo === "antecipacao") {
        credito += t.amount;
        return;
      }

      if (t.tipo === "pix") { pix += t.amount; return; }
      if (t.tipo === "debito") { debito += t.amount; return; }
      if (t.tipo === "credito") { credito += t.amount; return; }

      // Sem tipo — usa os meios da conta
      if (conta.meios?.includes("dinheiro")) dinheiro += t.amount;
      else if (conta.meios?.length === 1) {
        const m = conta.meios[0];
        if (m === "pix") pix += t.amount;
        else if (m === "debito") debito += t.amount;
        else if (m === "credito") credito += t.amount;
      } else {
        // Conta multi-meios sem tipo claro: tenta detectar pela descrição
        const det = detectTipo(t.description);
        if (det === "pix") pix += t.amount;
        else if (det === "debito") debito += t.amount;
        else if (det === "credito" || det === "antecipacao") credito += t.amount;
      }
    });
    return { pix, debito, credito, cartao: debito + credito, dinheiro, tarifas, total: pix + debito + credito + dinheiro };
  }, [transacoes, contas]);

  // ─── Gastos por categoria ─────────────────────────────
  const gastos = useMemo(() => {
    return transacoes
      .filter(t => t.amount < 0 && t.tipo !== "tarifa" && t.tipo !== "transferencia")
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [transacoes]);

  const gastosPorCategoria = useMemo(() => {
    const m: Record<string, { total: number; count: number }> = {};
    let semCategoria = 0;
    let semCategoriaCount = 0;
    gastos.forEach(g => {
      const cat = g.categoria || "_sem_";
      if (cat === "_sem_") {
        semCategoria += Math.abs(g.amount);
        semCategoriaCount++;
      } else {
        if (!m[cat]) m[cat] = { total: 0, count: 0 };
        m[cat].total += Math.abs(g.amount);
        m[cat].count++;
      }
    });
    const totalGastos = Object.values(m).reduce((s, v) => s + v.total, 0) + semCategoria;
    return { porCategoria: m, semCategoria, semCategoriaCount, total: totalGastos };
  }, [gastos]);

  // ─── Discrepâncias Trinks vs Banco ───────────────────
  const discrepancias = useMemo(() => {
    const trinksPix = trinksTotals.totalPix || 0;
    const trinksCartao = trinksTotals.totalCartao || 0;
    const trinksDinheiro = trinksTotals.totalDinheiro || 0;

    return [
      { meio: "Pix", trinks: trinksPix, banco: totaisPorMeio.pix, diff: totaisPorMeio.pix - trinksPix },
      { meio: "Cartão", trinks: trinksCartao, banco: totaisPorMeio.cartao, diff: totaisPorMeio.cartao - trinksCartao,
        detalhe: `Débito ${formatCurrency(totaisPorMeio.debito)} + Crédito ${formatCurrency(totaisPorMeio.credito)}` },
      { meio: "Dinheiro", trinks: trinksDinheiro, banco: totaisPorMeio.dinheiro, diff: totaisPorMeio.dinheiro - trinksDinheiro },
    ];
  }, [trinksTotals, totaisPorMeio]);

  return (
    <div className="space-y-5 max-w-[1400px] pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold">Consolidação Bancária</h1>
          <p className="text-sm text-muted-foreground">
            Compare o fechamento do Trinks com seus extratos bancários
          </p>
        </div>
        <Input type="month" value={selectedMes} onChange={e => setSelectedMes(e.target.value)} className="h-9 w-40" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Entrou no banco</span>
            </div>
            <p className="text-lg font-bold">{formatCurrency(totaisPorMeio.total)}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">{formatMonth(selectedMes)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Trinks no mês</span>
            </div>
            <p className="text-lg font-bold">{formatCurrency(trinksTotals.totalRevenue)}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">bruto vendido</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Tarifas pagas</span>
            </div>
            <p className="text-lg font-bold text-red-400">{formatCurrency(totaisPorMeio.tarifas)}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">tarifas + transferências</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Building2 className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Contas ativas</span>
            </div>
            <p className="text-lg font-bold">{contas.filter(c => c.ativa).length}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">{transacoes.length} transações no mês</p>
          </CardContent>
        </Card>
      </div>

      {/* Conciliação */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 bg-primary rounded-full" />
          <h2 className="text-base font-semibold">Conciliação Trinks × Banco</h2>
          <span className="text-xs text-muted-foreground">(antecipações somadas como crédito)</span>
        </div>
        <Card className="bg-card border-card-border">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Meio</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Trinks (vendas)</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Banco (recebido)</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Diferença</th>
                  <th className="text-center p-3 text-xs text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {discrepancias.map(d => {
                  const pct = d.trinks > 0 ? (d.diff / d.trinks) * 100 : 0;
                  const ok = Math.abs(d.diff) < Math.max(d.trinks * 0.05, 50);
                  const negativo = d.diff < -10;
                  return (
                    <tr key={d.meio} className="border-b border-border/50">
                      <td className="p-3">
                        <div className="font-medium">{d.meio}</div>
                        {d.detalhe && <div className="text-[10px] text-muted-foreground mt-0.5">{d.detalhe}</div>}
                      </td>
                      <td className="p-3 text-right">{formatCurrency(d.trinks)}</td>
                      <td className="p-3 text-right">{formatCurrency(d.banco)}</td>
                      <td className={`p-3 text-right font-semibold ${negativo ? "text-red-400" : d.diff > 50 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {d.diff >= 0 ? "+" : ""}{formatCurrency(d.diff)}
                        {d.trinks > 0 && <span className="text-[10px] ml-1">({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
                      </td>
                      <td className="p-3 text-center">
                        {ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                        ) : (
                          <AlertTriangle className={`w-4 h-4 inline ${negativo ? "text-red-400" : "text-amber-400"}`} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(trinksTotals.totalRevenue === 0 || totaisPorMeio.total === 0) && (
              <div className="p-4 text-xs text-muted-foreground text-center border-t border-border">
                {trinksTotals.totalRevenue === 0 ? "Sincronize a Trinks para ver as vendas" : "Faça upload do extrato para comparar"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-primary rounded-full" />
            <h2 className="text-base font-semibold">Contas Cadastradas</h2>
          </div>
          <ContaDialog onSaved={loadData} />
        </div>
        {contas.length === 0 ? (
          <Card className="bg-card border-card-border">
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              Nenhuma conta cadastrada. Adicione seus bancos, contas de plano (InfinityPay) e maquininhas.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {contas.map(c => (
              <ContaCard key={c.id} conta={c} totalTx={transacoes.filter(t => t.contaId === c.id).length} onReload={loadData} mes={selectedMes} />
            ))}
          </div>
        )}
      </div>

      {/* Gastos do mês */}
      {gastos.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-primary rounded-full" />
            <h2 className="text-base font-semibold">Gastos do Mês</h2>
            <Badge variant="secondary" className="text-[10px]">
              {formatCurrency(gastosPorCategoria.total)}
            </Badge>
            {gastosPorCategoria.semCategoriaCount > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40 bg-amber-500/10">
                {gastosPorCategoria.semCategoriaCount} sem categoria
              </Badge>
            )}
          </div>

          {/* Resumo por categoria */}
          {Object.keys(gastosPorCategoria.porCategoria).length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
              {Object.entries(gastosPorCategoria.porCategoria)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([cat, v]) => {
                  const info = CATEGORIAS_INFO[cat as CategoriaGasto];
                  if (!info) return null;
                  const Icon = info.icon;
                  return (
                    <Card key={cat} className="bg-card border-card-border">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{info.label}</span>
                        </div>
                        <p className="text-sm font-bold truncate">{formatCurrency(v.total)}</p>
                        <p className="text-[10px] text-muted-foreground">{v.count} transação{v.count > 1 ? "ões" : ""}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              {gastosPorCategoria.semCategoria > 0 && (
                <Card className="bg-amber-500/5 border-amber-500/20">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wide">Sem categoria</span>
                    </div>
                    <p className="text-sm font-bold text-amber-300 truncate">{formatCurrency(gastosPorCategoria.semCategoria)}</p>
                    <p className="text-[10px] text-muted-foreground">{gastosPorCategoria.semCategoriaCount} pendente{gastosPorCategoria.semCategoriaCount > 1 ? "s" : ""}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Lista de gastos categorizáveis */}
          <Card className="bg-card border-card-border">
            <CardContent className="p-0 max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card border-b border-border">
                  <tr>
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Data</th>
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Descrição</th>
                    <th className="text-right p-2.5 text-muted-foreground font-medium">Valor</th>
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {gastos.map(g => {
                    const conta = contas.find(c => c.id === g.contaId);
                    return (
                      <tr key={g.id} className={`border-b border-border/50 hover:bg-muted/20 ${!g.categoria ? "bg-amber-500/5" : ""}`}>
                        <td className="p-2.5 font-mono whitespace-nowrap">{g.date.slice(8)}/{g.date.slice(5,7)}</td>
                        <td className="p-2.5">
                          <div className="truncate max-w-[260px]" title={g.description}>{g.description}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{conta?.nome}</div>
                        </td>
                        <td className="p-2.5 text-right font-semibold whitespace-nowrap text-red-400">
                          {formatCurrency(g.amount)}
                        </td>
                        <td className="p-2.5">
                          <CategoriaSelector
                            value={g.categoria}
                            onChange={(cat, aprender) => atualizarCategoria(g.id, cat, aprender)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Lista de transações */}
      {transacoes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-primary rounded-full" />
            <h2 className="text-base font-semibold">Transações Importadas</h2>
            <Badge variant="secondary" className="text-[10px]">{transacoes.length}</Badge>
          </div>
          <Card className="bg-card border-card-border">
            <CardContent className="p-0 max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card border-b border-border">
                  <tr>
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Data</th>
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Conta</th>
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Tipo</th>
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Descrição</th>
                    <th className="text-right p-2.5 text-muted-foreground font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {transacoes.slice().sort((a, b) => b.date.localeCompare(a.date)).map(t => {
                    const conta = contas.find(c => c.id === t.contaId);
                    return (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-2.5 font-mono whitespace-nowrap">{t.date.slice(8)}/{t.date.slice(5,7)}</td>
                        <td className="p-2.5 truncate max-w-[120px]">{conta?.nome || "?"}</td>
                        <td className="p-2.5">
                          {t.tipo === "antecipacao" ? (
                            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40 bg-amber-500/10">
                              <Zap className="w-2.5 h-2.5 mr-0.5" />Antec
                            </Badge>
                          ) : t.tipo === "pix" ? (
                            <Badge variant="outline" className="text-[10px]">Pix</Badge>
                          ) : t.tipo === "debito" ? (
                            <Badge variant="outline" className="text-[10px]">Débito</Badge>
                          ) : t.tipo === "credito" ? (
                            <Badge variant="outline" className="text-[10px]">Crédito</Badge>
                          ) : t.tipo === "tarifa" ? (
                            <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">Tarifa</Badge>
                          ) : null}
                        </td>
                        <td className="p-2.5 truncate max-w-[280px]">{t.description}</td>
                        <td className={`p-2.5 text-right font-semibold whitespace-nowrap ${t.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {t.amount >= 0 ? "+" : ""}{formatCurrency(t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Dialog de criar/editar conta ─────────────────────────
function ContaDialog({ onSaved, conta, trigger }: { onSaved: () => void; conta?: Conta; trigger?: React.ReactNode }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoConta>("banco");
  const [meios, setMeios] = useState<Meio[]>(["pix"]);
  const [taxaPix, setTaxaPix] = useState("");
  const [taxaDebito, setTaxaDebito] = useState("");
  const [taxaCredito, setTaxaCredito] = useState("");
  const [taxaAntecipacao, setTaxaAntecipacao] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset form quando abrir
  useEffect(() => {
    if (open) {
      if (conta) {
        setNome(conta.nome);
        setTipo(conta.tipo);
        setMeios(conta.meios || []);
        setTaxaPix(conta.taxaPix?.toString() || "");
        setTaxaDebito(conta.taxaDebito?.toString() || "");
        setTaxaCredito(conta.taxaCredito?.toString() || "");
        setTaxaAntecipacao(conta.taxaAntecipacao?.toString() || "");
      } else {
        setNome(""); setTipo("banco"); setMeios(["pix"]);
        setTaxaPix(""); setTaxaDebito(""); setTaxaCredito(""); setTaxaAntecipacao("");
      }
    }
  }, [open, conta]);

  const toggleMeio = (m: Meio) => {
    setMeios(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  // Sugestões padrão por tipo
  const onChangeTipo = (t: TipoConta) => {
    setTipo(t);
    if (!conta) {
      if (t === "banco") setMeios(["pix"]);
      else if (t === "maquininha") setMeios(["debito", "credito"]);
      else if (t === "caixa") setMeios(["dinheiro"]);
    }
  };

  const save = async () => {
    if (!nome.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    if (meios.length === 0) { toast({ title: "Selecione ao menos um meio de recebimento", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/consolidacao/contas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: conta?.id, nome, tipo, meios,
          taxaPix: meios.includes("pix") && taxaPix ? Number(taxaPix) : undefined,
          taxaDebito: meios.includes("debito") && taxaDebito ? Number(taxaDebito) : undefined,
          taxaCredito: meios.includes("credito") && taxaCredito ? Number(taxaCredito) : undefined,
          taxaAntecipacao: meios.includes("credito") && taxaAntecipacao ? Number(taxaAntecipacao) : undefined,
          ativa: true,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: conta ? "Conta atualizada" : "Conta criada" });
      setOpen(false);
      onSaved();
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="bg-primary hover:bg-primary/80 text-white">
            <Plus className="w-4 h-4 mr-1" /> Nova conta
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader><DialogTitle>{conta ? "Editar conta" : "Nova conta"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome da conta</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Itaú PJ, InfinityPay, Cielo..." />
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={v => onChangeTipo(v as TipoConta)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="banco">Banco / Conta de plano</SelectItem>
                <SelectItem value="maquininha">Maquininha / Adquirente</SelectItem>
                <SelectItem value="caixa">Caixa (dinheiro)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Meios de recebimento</Label>
            <p className="text-[10px] text-muted-foreground mb-2">Marque tudo que essa conta recebe (ex: InfinityPay = Pix + Crédito)</p>
            <div className="grid grid-cols-2 gap-2">
              {(["pix", "debito", "credito", "dinheiro"] as Meio[]).map(m => (
                <label key={m} className="flex items-center gap-2 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/30">
                  <Checkbox checked={meios.includes(m)} onCheckedChange={() => toggleMeio(m)} />
                  <span className="text-sm">{MEIO_LABELS[m]}</span>
                </label>
              ))}
            </div>
          </div>

          {(meios.includes("pix") || meios.includes("debito") || meios.includes("credito")) && (
            <div className="border-t border-border pt-3 space-y-2">
              <Label className="text-xs">Taxas (%)</Label>
              <div className="grid grid-cols-2 gap-2">
                {meios.includes("pix") && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Pix</Label>
                    <Input type="number" step="0.01" value={taxaPix} onChange={e => setTaxaPix(e.target.value)} placeholder="0" />
                  </div>
                )}
                {meios.includes("debito") && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Débito</Label>
                    <Input type="number" step="0.01" value={taxaDebito} onChange={e => setTaxaDebito(e.target.value)} placeholder="1.99" />
                  </div>
                )}
                {meios.includes("credito") && (
                  <>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Crédito</Label>
                      <Input type="number" step="0.01" value={taxaCredito} onChange={e => setTaxaCredito(e.target.value)} placeholder="3.29" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Antecipação</Label>
                      <Input type="number" step="0.01" value={taxaAntecipacao} onChange={e => setTaxaAntecipacao(e.target.value)} placeholder="2.99" />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <Button onClick={save} disabled={saving} className="w-full bg-primary hover:bg-primary/80 text-white">
            {saving ? "Salvando..." : (conta ? "Atualizar" : "Criar conta")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card de conta ──────────────────────────────────────────
function ContaCard({ conta, totalTx, onReload, mes }: { conta: Conta; totalTx: number; onReload: () => void; mes: string }) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const Icon = conta.tipo === "banco" ? Building2 : conta.tipo === "maquininha" ? CreditCard : Coins;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error("CSV vazio");

      const headers = rows[0];
      const cols = detectColumns(headers);
      const transacoes: any[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2) continue;
        const date = parseDate(row[cols.date] || "");
        const description = row[cols.description] || "";
        const amount = parseBR(row[cols.amount] || "0");
        if (!date || amount === 0) continue;
        const tipo = detectTipo(description);
        transacoes.push({ date, description, amount, tipo });
      }

      if (transacoes.length === 0) {
        toast({ title: "Nenhuma transação detectada", description: "Verifique o formato do CSV.", variant: "destructive" });
        return;
      }

      const res = await fetch(`${API_BASE}/api/consolidacao/transacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contaId: conta.id, transacoes, replaceMonth: mes }),
      });
      if (!res.ok) throw new Error("upload falhou");
      const data = await res.json();
      const antecipacoes = transacoes.filter(t => t.tipo === "antecipacao").length;
      toast({
        title: "Importado!",
        description: `${data.inserted} transações${antecipacoes > 0 ? ` (${antecipacoes} antecipações detectadas)` : ""}.`,
      });
      onReload();
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const deleteConta = async () => {
    if (!confirm(`Excluir conta "${conta.nome}" e todas suas transações?`)) return;
    await fetch(`${API_BASE}/api/consolidacao/contas/${conta.id}`, { method: "DELETE" });
    toast({ title: "Conta removida" });
    onReload();
  };

  return (
    <Card className="bg-card border-card-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{conta.nome}</p>
              <p className="text-[10px] text-muted-foreground capitalize">{conta.tipo}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <ContaDialog
              conta={conta}
              onSaved={onReload}
              trigger={
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary" title="Editar">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              }
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-300" onClick={deleteConta} title="Excluir">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Meios */}
        {conta.meios && conta.meios.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {conta.meios.map(m => (
              <Badge key={m} variant="outline" className="text-[10px]">{MEIO_LABELS[m]}</Badge>
            ))}
          </div>
        )}

        {/* Taxas */}
        {(conta.taxaPix || conta.taxaDebito || conta.taxaCredito || conta.taxaAntecipacao) && (
          <div className="flex flex-wrap gap-1 mb-3 text-[10px]">
            {conta.taxaPix != null && <Badge variant="outline" className="text-[10px]">Pix {conta.taxaPix}%</Badge>}
            {conta.taxaDebito != null && <Badge variant="outline" className="text-[10px]">D {conta.taxaDebito}%</Badge>}
            {conta.taxaCredito != null && <Badge variant="outline" className="text-[10px]">C {conta.taxaCredito}%</Badge>}
            {conta.taxaAntecipacao != null && <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">Antec {conta.taxaAntecipacao}%</Badge>}
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-3">{totalTx} transações em {formatMonth(mes)}</p>
        <input ref={fileInput} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-8"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {uploading ? "Importando..." : "Importar CSV"}
        </Button>
      </CardContent>
    </Card>
  );
}


// ─── Seletor de categoria com aprendizado ─────────────────
function CategoriaSelector({ value, onChange }: {
  value?: CategoriaGasto;
  onChange: (cat: CategoriaGasto | null, aprenderRegra: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const info = value ? CATEGORIAS_INFO[value] : null;
  const Icon = info?.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {value && info && Icon ? (
          <button className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] border ${info.color} hover:opacity-80 transition`}>
            <Icon className="w-3 h-3" />
            <span>{info.label}</span>
          </button>
        ) : (
          <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] border border-dashed border-amber-500/40 text-amber-400 bg-amber-500/5 hover:bg-amber-500/10 transition">
            <Tag className="w-3 h-3" />
            <span>Categorizar</span>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader><DialogTitle className="text-base">Categorizar gasto</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Escolha a categoria que melhor representa este gasto.</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(CATEGORIAS_INFO) as CategoriaGasto[]).map(cat => {
              const i = CATEGORIAS_INFO[cat];
              const I = i.icon;
              const selected = value === cat;
              return (
                <button
                  key={cat}
                  onClick={() => { onChange(cat, true); setOpen(false); }}
                  className={`flex items-center gap-2 p-2.5 rounded-md border text-left transition ${selected ? i.color : "border-border hover:bg-muted/30"}`}
                >
                  <I className="w-4 h-4 flex-shrink-0" />
                  <span className="text-xs font-medium">{i.label}</span>
                </button>
              );
            })}
          </div>
          {value && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => { onChange(null, false); setOpen(false); }}
            >
              Remover categoria
            </Button>
          )}
          <p className="text-[10px] text-muted-foreground text-center pt-2 border-t border-border">
            ✨ O sistema aprende com sua escolha e categoriza transações similares automaticamente
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
