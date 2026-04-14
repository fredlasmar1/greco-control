import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTrinksStore, getTrinksMonthTotals } from "@/lib/trinksStore";
import { formatCurrency, getMonthTotals } from "@/lib/demoData";
import {
  Building2, CreditCard, Coins, Upload, AlertTriangle, CheckCircle2,
  TrendingDown, Plus, Trash2, FileDown, Percent, ArrowRight,
} from "lucide-react";

const API_BASE = (globalThis as any).__API_BASE__ || "";

type TipoConta = "banco" | "maquininha" | "caixa";
interface Conta {
  id: string;
  nome: string;
  tipo: TipoConta;
  taxaDebito?: number;
  taxaCredito?: number;
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
  tipo?: "pix" | "debito" | "credito" | "outro";
  importedAt: string;
}

// ─── CSV parser simples ────────────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    // Detecta separador: vírgula ou ponto-e-vírgula
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

function parseBrazilianNumber(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d,.\-+]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseDate(s: string): string {
  if (!s) return "";
  s = s.trim();
  // DD/MM/YYYY
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  // DD-MM-YYYY
  const dash = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dash) return `${dash[3]}-${dash[2]}-${dash[1]}`;
  return "";
}

function detectColumns(headers: string[]): { date: number; description: number; amount: number } {
  const dateIdx = headers.findIndex(h => /data|date|dt/i.test(h));
  const descIdx = headers.findIndex(h => /descri|histor|memo|observa/i.test(h));
  const amtIdx = headers.findIndex(h => /valor|amount|credito|debito|montante/i.test(h));
  return {
    date: dateIdx >= 0 ? dateIdx : 0,
    description: descIdx >= 0 ? descIdx : 1,
    amount: amtIdx >= 0 ? amtIdx : 2,
  };
}

function formatMonth(s: string): string {
  const [y, m] = s.split("-");
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[parseInt(m)-1]}/${y}`;
}

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
    } catch { /* ignore */ }
  };

  useEffect(() => { loadData(); }, [selectedMes]);

  // ─── Totais do Trinks para o mês selecionado ──────────
  const trinksTotals = useMemo(() => {
    if (hasTrinksData) return getTrinksMonthTotals(trinks!);
    return getMonthTotals();
  }, [hasTrinksData, trinks]);

  // ─── Análise de taxas por maquininha ──────────────────
  const analiseTaxas = useMemo(() => {
    const maquininhas = contas.filter(c => c.tipo === "maquininha" && c.ativa);
    return maquininhas.map(m => {
      const txMes = transacoes.filter(t => t.contaId === m.id && t.amount > 0);
      const totalRecebido = txMes.reduce((s, t) => s + t.amount, 0);
      // Taxa esperada = media entre debito e credito (aproximacao)
      const taxaContratadaMedia = ((m.taxaDebito || 0) + (m.taxaCredito || 0)) / 2;
      // Taxa real = precisamos comparar gross vs net. Por enquanto, usamos taxaContratada
      return {
        conta: m,
        totalRecebido,
        taxaContratadaMedia,
        taxaEstimadaPaga: totalRecebido * (taxaContratadaMedia / 100),
        nTransacoes: txMes.length,
      };
    });
  }, [contas, transacoes]);

  const totalTaxasPagas = analiseTaxas.reduce((s, a) => s + a.taxaEstimadaPaga, 0);

  // ─── Total entradas por tipo ─────────────────────────
  const totaisPorTipo = useMemo(() => {
    let pix = 0, cartao = 0, outros = 0, caixa = 0;
    transacoes.forEach(t => {
      if (t.amount <= 0) return;
      const conta = contas.find(c => c.id === t.contaId);
      if (!conta) return;
      if (conta.tipo === "caixa") caixa += t.amount;
      else if (conta.tipo === "maquininha") cartao += t.amount;
      else if (t.tipo === "pix" || /pix/i.test(t.description)) pix += t.amount;
      else outros += t.amount;
    });
    return { pix, cartao, outros, caixa, total: pix + cartao + outros + caixa };
  }, [transacoes, contas]);

  // ─── Discrepâncias Trinks vs Banco ───────────────────
  const discrepancias = useMemo(() => {
    const trinksPix = trinksTotals.totalPix || 0;
    const trinksCartao = trinksTotals.totalCartao || 0;
    const trinksDinheiro = trinksTotals.totalDinheiro || 0;

    return [
      {
        meio: "Pix",
        trinks: trinksPix,
        banco: totaisPorTipo.pix,
        diff: totaisPorTipo.pix - trinksPix,
      },
      {
        meio: "Cartão",
        trinks: trinksCartao,
        banco: totaisPorTipo.cartao,
        diff: totaisPorTipo.cartao - trinksCartao,
      },
      {
        meio: "Dinheiro",
        trinks: trinksDinheiro,
        banco: totaisPorTipo.caixa,
        diff: totaisPorTipo.caixa - trinksDinheiro,
      },
    ];
  }, [trinksTotals, totaisPorTipo]);

  return (
    <div className="space-y-6 max-w-[1400px] pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold">Consolidação Bancária</h1>
          <p className="text-sm text-muted-foreground">
            Compare o fechamento do Trinks com o extrato dos seus bancos e maquininhas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={selectedMes}
            onChange={e => setSelectedMes(e.target.value)}
            className="h-9 w-40"
          />
        </div>
      </div>

      {/* KPIs de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Entrou no banco</span>
            </div>
            <p className="text-lg font-bold">{formatCurrency(totaisPorTipo.total)}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">{formatMonth(selectedMes)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Taxas estimadas</span>
            </div>
            <p className="text-lg font-bold text-red-400">{formatCurrency(totalTaxasPagas)}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">{analiseTaxas.length} maquininha{analiseTaxas.length !== 1 ? "s" : ""}</p>
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
              <Building2 className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Contas ativas</span>
            </div>
            <p className="text-lg font-bold">{contas.filter(c => c.ativa).length}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">{transacoes.length} transações no mês</p>
          </CardContent>
        </Card>
      </div>

      {/* Discrepâncias */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 bg-primary rounded-full" />
          <h2 className="text-base font-semibold">Conciliação Trinks × Banco</h2>
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
                  const ok = Math.abs(d.diff) < d.trinks * 0.05; // menos de 5%
                  const negativo = d.diff < 0 && Math.abs(d.diff) > 10;
                  return (
                    <tr key={d.meio} className="border-b border-border/50">
                      <td className="p-3 font-medium">{d.meio}</td>
                      <td className="p-3 text-right">{formatCurrency(d.trinks)}</td>
                      <td className="p-3 text-right">{formatCurrency(d.banco)}</td>
                      <td className={`p-3 text-right font-semibold ${negativo ? "text-red-400" : d.diff > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
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
            {(trinksTotals.totalRevenue === 0 || totaisPorTipo.total === 0) && (
              <div className="p-4 text-xs text-muted-foreground text-center border-t border-border">
                {trinksTotals.totalRevenue === 0
                  ? "Sincronize a Trinks para ver as vendas do mês"
                  : "Faça upload do extrato do banco para comparar"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Análise de Taxas */}
      {analiseTaxas.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-primary rounded-full" />
            <h2 className="text-base font-semibold">Análise de Taxas</h2>
            <span className="text-xs text-muted-foreground">por maquininha</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {analiseTaxas.map(a => (
              <Card key={a.conta.id} className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">{a.conta.nome}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{a.nTransacoes} tx</Badge>
                  </div>
                  <div className="space-y-1.5 mt-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total recebido</span>
                      <span className="font-medium">{formatCurrency(a.totalRecebido)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Taxa contratada</span>
                      <span className="font-medium text-primary">
                        D {a.conta.taxaDebito || 0}% / C {a.conta.taxaCredito || 0}%
                      </span>
                    </div>
                    <div className="flex justify-between text-xs pt-1.5 border-t border-border">
                      <span className="text-muted-foreground">Taxa estimada no mês</span>
                      <span className="font-semibold text-red-400">-{formatCurrency(a.taxaEstimadaPaga)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Gestão de Contas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-primary rounded-full" />
            <h2 className="text-base font-semibold">Contas Cadastradas</h2>
          </div>
          <ContaForm onSaved={loadData} />
        </div>
        {contas.length === 0 ? (
          <Card className="bg-card border-card-border">
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              Nenhuma conta cadastrada. Adicione seus bancos, maquininhas e caixa para começar.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {contas.map(c => (
              <ContaCard
                key={c.id}
                conta={c}
                totalTx={transacoes.filter(t => t.contaId === c.id).length}
                onReload={loadData}
                mes={selectedMes}
              />
            ))}
          </div>
        )}
      </div>

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
                    <th className="text-left p-2.5 text-muted-foreground font-medium">Descrição</th>
                    <th className="text-right p-2.5 text-muted-foreground font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {transacoes.slice().sort((a, b) => b.date.localeCompare(a.date)).map(t => {
                    const conta = contas.find(c => c.id === t.contaId);
                    return (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-2.5 font-mono">{t.date.slice(8)}/{t.date.slice(5,7)}</td>
                        <td className="p-2.5 truncate max-w-[120px]">{conta?.nome || "?"}</td>
                        <td className="p-2.5 truncate max-w-[280px]">{t.description}</td>
                        <td className={`p-2.5 text-right font-semibold ${t.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
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

// ─── Formulário de conta ──────────────────────────────────
function ContaForm({ onSaved, conta }: { onSaved: () => void; conta?: Conta }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(conta?.nome || "");
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo || "banco");
  const [taxaDebito, setTaxaDebito] = useState(conta?.taxaDebito?.toString() || "");
  const [taxaCredito, setTaxaCredito] = useState(conta?.taxaCredito?.toString() || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!nome.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/consolidacao/contas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: conta?.id,
          nome, tipo,
          taxaDebito: tipo === "maquininha" && taxaDebito ? Number(taxaDebito) : undefined,
          taxaCredito: tipo === "maquininha" && taxaCredito ? Number(taxaCredito) : undefined,
          ativa: true,
        }),
      });
      if (!res.ok) throw new Error("erro");
      toast({ title: conta ? "Conta atualizada" : "Conta criada" });
      setOpen(false);
      if (!conta) { setNome(""); setTaxaDebito(""); setTaxaCredito(""); }
      onSaved();
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-primary hover:bg-primary/80 text-white">
          <Plus className="w-4 h-4 mr-1" /> Nova conta
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader><DialogTitle>{conta ? "Editar conta" : "Nova conta"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: NuBank PJ, Cielo Loja..." />
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={v => setTipo(v as TipoConta)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="banco">Banco (Pix / depósito)</SelectItem>
                <SelectItem value="maquininha">Maquininha (cartão)</SelectItem>
                <SelectItem value="caixa">Caixa (dinheiro)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tipo === "maquininha" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Taxa Débito (%)</Label>
                <Input type="number" step="0.01" value={taxaDebito} onChange={e => setTaxaDebito(e.target.value)} placeholder="1.99" />
              </div>
              <div>
                <Label className="text-xs">Taxa Crédito (%)</Label>
                <Input type="number" step="0.01" value={taxaCredito} onChange={e => setTaxaCredito(e.target.value)} placeholder="3.29" />
              </div>
            </div>
          )}
          <Button onClick={save} disabled={saving} className="w-full bg-primary hover:bg-primary/80 text-white">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card de conta com upload e delete ────────────────────
function ContaCard({ conta, totalTx, onReload, mes }: { conta: Conta; totalTx: number; onReload: () => void; mes: string }) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const icon = conta.tipo === "banco" ? Building2 : conta.tipo === "maquininha" ? CreditCard : Coins;
  const Icon = icon;

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
        const amount = parseBrazilianNumber(row[cols.amount] || "0");
        if (!date || amount === 0) continue;
        // Detecta tipo pela descrição
        let tipo: any;
        const d = description.toLowerCase();
        if (/pix/.test(d)) tipo = "pix";
        else if (/deb|débito/.test(d)) tipo = "debito";
        else if (/cred|crédito/.test(d)) tipo = "credito";
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
      toast({ title: "Importado!", description: `${data.inserted} transações adicionadas para ${conta.nome}.` });
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
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-300" onClick={deleteConta}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        {conta.tipo === "maquininha" && (
          <div className="flex gap-2 mb-3 text-[10px]">
            <Badge variant="outline" className="text-[10px]">D {conta.taxaDebito || 0}%</Badge>
            <Badge variant="outline" className="text-[10px]">C {conta.taxaCredito || 0}%</Badge>
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
