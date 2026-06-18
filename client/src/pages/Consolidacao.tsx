import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getTrinksMonthTotals } from "@/lib/trinksStore";
import { formatCurrency, getMonthTotals } from "@/lib/demoData";
import { MonthSelector } from "@/components/MonthSelector";
import { useTrinksMonth } from "@/hooks/useTrinksMonth";
import { mesAtualSP } from "@/lib/mesUtils";
import {
  Building2, CreditCard, Coins, Upload, AlertTriangle, CheckCircle2,
  TrendingDown, Plus, Trash2, ArrowRight, Pencil, Zap, Tag,
  Server, UserCog, Home, Droplets, ShoppingBag, Receipt as ReceiptIcon,
  ArrowLeftRight, HelpCircle, Sparkles, Wand2,
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
  transito?: boolean;
  contaDestinoId?: string;
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

// ─── Parser universal: CSV, XLSX ────────────────────────────
async function parseFileToRows(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as any[][];
    return rows.map(r => r.map(c => (c == null ? "" : String(c))));
  }
  // CSV / TXT — tenta UTF-8, se tiver caracteres corrompidos usa Windows-1252
  let text = await file.text();
  if (text.includes('\uFFFD')) {
    const buf = await file.arrayBuffer();
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return parseCSV(text);
}

// ─── CSV parser ────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  // Detecta separador analisando a primeira linha.
  // Prioridade: tab → ponto-e-vírgula → vírgula → 2+ espaços consecutivos
  const firstLine = lines[0];
  let sep = "";
  if (firstLine.includes("\t")) sep = "\t";
  else if (firstLine.includes(";")) sep = ";";
  else if ((firstLine.match(/,/g) || []).length >= 2) sep = ",";

  const rows: string[][] = [];
  for (const line of lines) {
    const cells: string[] = [];
    if (sep) {
      let cur = "";
      let inQuote = false;
      for (const ch of line) {
        if (ch === '"') { inQuote = !inQuote; continue; }
        if (ch === sep && !inQuote) { cells.push(cur.trim()); cur = ""; continue; }
        cur += ch;
      }
      cells.push(cur.trim());
    } else {
      // Fallback: split por 2+ espaços consecutivos
      line.split(/\s{2,}/).forEach(c => cells.push(c.trim()));
    }
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

// Encontra a linha de cabeçalho real (pula metadados como AGENCIA, nome do banco, etc.)
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map(c => (c || "").toLowerCase().trim());
    if (cells.some(c => /^data\b|^date\b|dt\.?lanc|dt\.?mov|data\.?mov/.test(c))) {
      return i;
    }
  }
  return 0;
}

function detectColumns(headers: string[], sampleRows: string[][] = []) {
  const h = headers.map(x => (x || "").toLowerCase().trim());
  const dateIdx = h.findIndex(x => /^data\b|^date\b|dt.lanc|dt.mov|data.mov/i.test(x));
  // Primeiro tenta padrões tradicionais de descrição (hist.?ri pega "Histórico" mesmo com encoding quebrado)
  let descIdx = h.findIndex(x => /descri|hist.?ri|memo|observa|lan[çc]amento/i.test(x));
  // Fallback: colunas alternativas como "Nome", "Razão Social", "Detalhe"
  if (descIdx < 0) {
    descIdx = h.findIndex(x => /^nome\b|raz[aã]o|detalhe/i.test(x));
  }
  // Colunas separadas de débito e crédito
  const debIdx = h.findIndex(x => /^d[ée]bito\b|saida|^pago\b|valor.*saida/i.test(x));
  const credIdx = h.findIndex(x => /^cr[eé]dito\b|entrada|recebido|valor.*entrada/i.test(x));
  // Coluna única de valor — aceita "valor", "valor (r$)", "valor (brl)", "valor lançamento" etc.
  // IMPORTANTE: NÃO casa com "saldo" que muitas vezes vem depois de "valor"
  let amtIdx = h.findIndex(x => {
    if (/saldo/.test(x)) return false;
    return /^valor\b|^amount\b|^montante\b/.test(x);
  });
  // ID da coluna de saldo
  const saldoIdx = h.findIndex(x => /saldo/.test(x));

  // ─── Validação: se a coluna detectada tem valores "Documento-like", busca a correta ──
  // Score: quantos valores parecem monetários (com vírgula/ponto decimal)
  const scoreColumn = (idx: number): number => {
    if (idx < 0 || sampleRows.length === 0) return 0;
    let monetarios = 0;
    let total = 0;
    for (const row of sampleRows) {
      const cell = row[idx] || "";
      if (!cell.trim()) continue;
      total++;
      // Valores monetários brasileiros: contém vírgula decimal
      if (/\d+,\d{1,2}/.test(cell)) monetarios++;
    }
    return total > 0 ? monetarios / total : 0;
  };

  // Se a detectada não parece monetária (< 50% com decimal) E há uma melhor, troca
  if (amtIdx >= 0 && sampleRows.length > 0) {
    const currentScore = scoreColumn(amtIdx);
    if (currentScore < 0.5) {
      // Procura a melhor candidata (excluindo data, descrição e saldo)
      let bestIdx = amtIdx;
      let bestScore = currentScore;
      for (let i = 0; i < headers.length; i++) {
        if (i === dateIdx || i === descIdx || i === saldoIdx) continue;
        const s = scoreColumn(i);
        if (s > bestScore) { bestScore = s; bestIdx = i; }
      }
      amtIdx = bestIdx;
    }
  }

  return {
    date: dateIdx >= 0 ? dateIdx : 0,
    description: descIdx >= 0 ? descIdx : 1,
    amount: amtIdx,
    debito: debIdx,
    credito: credIdx,
    saldo: saldoIdx,
    hasDebitoCredito: debIdx >= 0 && credIdx >= 0,
  };
}

// Linha parece um saldo / subtotal / cabeçalho? (ignora)
function isSaldoLine(description: string): boolean {
  const d = (description || "").toLowerCase().trim();
  return /^saldo|^total|^subtotal|^s\s*a\s*l\s*d\s*o|saldo\s*(total|disponivel|anterior|em\s*conta)/i.test(d);
}

// Detecta tipo de transação pela descrição
function detectTipo(description: string): TipoTransacao | undefined {
  const d = description.toLowerCase();
  if (/antecip/.test(d)) return "antecipacao";
  if (/pix/.test(d)) return "pix";
  if (/d[ée]bito|deb\.|cart.*deb/.test(d)) return "debito";
  if (/cr[ée]dito|cred\.|cart.*cred|parcelad/.test(d)) return "credito";
  if (/tarifa|tar\b|tar\.|iof\b|taxa|anuidade|juros\b|manuten[çc][aã]o/.test(d)) return "tarifa";
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
interface ConsolidacaoProps {
  /** Quando true, omite o header próprio (título e MonthSelector) — útil quando
   *  embutido como sub-aba dentro de outra página (ex: Lançamentos). */
  embedded?: boolean;
}

export default function Consolidacao({ embedded = false }: ConsolidacaoProps = {}) {
  const { toast } = useToast();

  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("consolidacao.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("consolidacao.selectedMes", selectedMes); } catch {}
  }, [selectedMes]);

  const {
    trinks, hasTrinksData, loading, error,
    fonte, trinksAt, csvAt, isMesCorrente,
  } = useTrinksMonth(selectedMes);

  const [contas, setContas] = useState<Conta[]>([]);
  const [transacoes, setTransacoes] = useState<TransacaoBanco[]>([]);

  const loadData = async () => {
    try {
      const [rContas, rTx] = await Promise.all([
        fetch(`${API_BASE}/api/consolidacao/contas`).then(r => r.json()),
        fetch(`${API_BASE}/api/consolidacao/transacoes?mes=${selectedMes}`).then(r => r.json()),
      ]);
      // Contas de observação (InfinitePay) não entram na contabilidade — só o
      // Itaú conta aqui. Elas são geridas na aba Assinaturas.
      const todas = Array.isArray(rContas) ? rContas : [];
      const contabeis = todas.filter((c: any) => !c.observacao);
      const idsObs = new Set(todas.filter((c: any) => c.observacao).map((c: any) => c.id));
      setContas(contabeis);
      setTransacoes(Array.isArray(rTx) ? rTx.filter((t: any) => !idsObs.has(t.contaId)) : []);
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
    if (hasTrinksData && trinks) return getTrinksMonthTotals(trinks);
    return isMesCorrente ? getMonthTotals() : { totalRevenue: 0, totalExpenses: 0, netProfit: 0, totalClients: 0, avgTicket: 0, totalPix: 0, totalCartao: 0, totalDinheiro: 0, daysOpen: 0, occupationRate: 0 };
  }, [hasTrinksData, trinks, isMesCorrente]);

  // IDs de contas de trânsito (ex: InfinityPay) e nomes pra detectar por descrição
  const idsTransito = useMemo(() => new Set(contas.filter(c => c.transito).map(c => c.id)), [contas]);
  const nomesTransito = useMemo(
    () => contas.filter(c => c.transito).map(c => c.nome.toLowerCase().replace(/\s+/g, "")),
    [contas]
  );
  const isTransferenciaDeTransito = (desc: string) => {
    const d = (desc || "").toLowerCase().replace(/\s+/g, "");
    return nomesTransito.some(n => n && d.includes(n));
  };

  // ─── Totais por meio (somando antecipações como crédito) ──
  const totaisPorMeio = useMemo(() => {
    let pix = 0, debito = 0, credito = 0, dinheiro = 0, tarifas = 0;
    transacoes.forEach(t => {
      const conta = contas.find(c => c.id === t.contaId);
      if (!conta) return;

      // Entradas em contas de trânsito contam (é o dinheiro real chegando).
      // Entradas na conta destino que venham da conta de trânsito NÃO contam
      // (para evitar duplicação). Como não temos matching exato de transações,
      // usamos heurística: se existem contas de trânsito, as transferências
      // recebidas na conta destino são marcadas como tipo "transferencia"
      // e já são excluídas no bloco abaixo.

      // Para contas de trânsito: considerar só as entradas (não contar a transferência saída)
      if (conta.transito && t.amount < 0) {
        // Saída de conta de trânsito é transferência interna, ignora
        return;
      }

      // Tarifas/taxas (negativos) — agrupam separado
      if (t.tipo === "tarifa" || t.tipo === "transferencia") {
        if (t.amount < 0) tarifas += Math.abs(t.amount);
        return;
      }

      // Entrada que veio de uma conta de trânsito: ignora (já foi contada na origem)
      if (!conta.transito && t.amount > 0 && isTransferenciaDeTransito(t.description)) {
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
    <div className={embedded ? "space-y-5" : "space-y-5 max-w-[1400px] pb-8"}>
      {/* Header — oculto quando embutido (parent já tem header) */}
      {!embedded && (
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 flex-wrap border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold">Consolidação Bancária</h1>
          <p className="text-sm text-muted-foreground">
            Compare o fechamento do Trinks com seus extratos bancários
          </p>
        </div>
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
      </div>
      )}

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
          <ContaDialog onSaved={loadData} todasContas={contas} />
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
              <ContaCard
                key={c.id}
                conta={c}
                totalTx={transacoes.filter(t => t.contaId === c.id).length}
                onReload={loadData}
                mes={selectedMes}
                onChangeMes={setSelectedMes}
                todasContas={contas}
              />
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
        <TransacoesList
          transacoes={transacoes}
          contas={contas}
          onChanged={loadData}
        />
      )}
    </div>
  );
}

// ─── Lista de Transações com filtro Entrada/Saída e inverter sinal ───
function TransacoesList({ transacoes, contas, onChanged }: {
  transacoes: TransacaoBanco[];
  contas: Conta[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [filtro, setFiltro] = useState<"todas" | "entradas" | "saidas">("todas");

  const flipSinal = async (id: string) => {
    await fetch(`${API_BASE}/api/consolidacao/transacoes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flipSign: true }),
    });
    toast({ title: "Sinal invertido", description: "Entrada ↔ Saída" });
    onChanged();
  };

  const filtradas = transacoes.filter(t => {
    if (filtro === "entradas") return t.amount > 0;
    if (filtro === "saidas") return t.amount < 0;
    return true;
  });
  const totalEntradas = transacoes.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalSaidas = Math.abs(transacoes.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 bg-primary rounded-full" />
          <h2 className="text-base font-semibold">Transações Importadas</h2>
          <Badge variant="secondary" className="text-[10px]">{filtradas.length}/{transacoes.length}</Badge>
        </div>
        <div className="flex items-center gap-1 bg-muted/30 rounded-md p-1">
          <button
            onClick={() => setFiltro("todas")}
            className={`text-xs px-3 py-1 rounded ${filtro === "todas" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            Todas
          </button>
          <button
            onClick={() => setFiltro("entradas")}
            className={`text-xs px-3 py-1 rounded ${filtro === "entradas" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-emerald-400"}`}
          >
            Entradas · {formatCurrency(totalEntradas)}
          </button>
          <button
            onClick={() => setFiltro("saidas")}
            className={`text-xs px-3 py-1 rounded ${filtro === "saidas" ? "bg-red-600 text-white" : "text-muted-foreground hover:text-red-400"}`}
          >
            Saídas · {formatCurrency(totalSaidas)}
          </button>
        </div>
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
                <th className="text-center p-2.5 text-muted-foreground font-medium w-12">↕</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.slice().sort((a, b) => b.date.localeCompare(a.date)).map(t => {
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
                    <td className="p-2.5 truncate max-w-[260px]">{t.description}</td>
                    <td className={`p-2.5 text-right font-semibold whitespace-nowrap ${t.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.amount >= 0 ? "+" : ""}{formatCurrency(t.amount)}
                    </td>
                    <td className="p-2.5 text-center">
                      <button
                        onClick={() => flipSinal(t.id)}
                        className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded hover:bg-muted/30"
                        title="Inverter sinal (entrada ↔ saída)"
                      >
                        ↕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Dialog de criar/editar conta ─────────────────────────
function ContaDialog({ onSaved, conta, trigger, todasContas = [] }: { onSaved: () => void; conta?: Conta; trigger?: React.ReactNode; todasContas?: Conta[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoConta>("banco");
  const [meios, setMeios] = useState<Meio[]>(["pix"]);
  const [taxaPix, setTaxaPix] = useState("");
  const [taxaDebito, setTaxaDebito] = useState("");
  const [taxaCredito, setTaxaCredito] = useState("");
  const [taxaAntecipacao, setTaxaAntecipacao] = useState("");
  const [transito, setTransito] = useState(false);
  const [contaDestinoId, setContaDestinoId] = useState("");
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
        setTransito(!!conta.transito);
        setContaDestinoId(conta.contaDestinoId || "");
      } else {
        setNome(""); setTipo("banco"); setMeios(["pix"]);
        setTaxaPix(""); setTaxaDebito(""); setTaxaCredito(""); setTaxaAntecipacao("");
        setTransito(false); setContaDestinoId("");
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
          transito,
          contaDestinoId: transito && contaDestinoId ? contaDestinoId : undefined,
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

          {/* Conta de trânsito */}
          <div className="border-t border-border pt-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={transito} onCheckedChange={v => setTransito(!!v)} />
              <div className="flex-1">
                <span className="text-sm font-medium">Conta de trânsito</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Marque se esta conta só recebe e transfere pra outra (ex: InfinityPay → Itaú). Evita contar o valor 2 vezes.
                </p>
              </div>
            </label>
            {transito && (
              <div>
                <Label className="text-xs">Transfere para qual conta?</Label>
                <Select value={contaDestinoId} onValueChange={setContaDestinoId}>
                  <SelectTrigger><SelectValue placeholder="Selecione a conta destino" /></SelectTrigger>
                  <SelectContent>
                    {todasContas
                      .filter(c => c.id !== conta?.id && !c.transito)
                      .map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Button onClick={save} disabled={saving} className="w-full bg-primary hover:bg-primary/80 text-white">
            {saving ? "Salvando..." : (conta ? "Atualizar" : "Criar conta")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card de conta ──────────────────────────────────────────
function ContaCard({ conta, totalTx, onReload, mes, onChangeMes, todasContas = [] }: { conta: Conta; totalTx: number; onReload: () => void; mes: string; onChangeMes?: (m: string) => void; todasContas?: Conta[] }) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const aiFileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingAI, setUploadingAI] = useState(false);

  const handleFileAI = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAI(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("contaId", conta.id);
      form.append("mes", mes);
      const res = await fetch(`${API_BASE}/api/consolidacao/upload-ia`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha no processamento com IA");
      }
      const data = await res.json();
      // Se as transações inseridas são de outro mês, trocar o seletor automaticamente
      if (data.mesPredominante && data.mesPredominante !== mes && onChangeMes) {
        onChangeMes(data.mesPredominante);
        toast({
          title: `${data.inserted} transações importadas`,
          description: `Mês ajustado para ${data.mesPredominante} (extrato é desse mês).`,
        });
      } else {
        toast({ title: "IA processou!", description: `${data.inserted} transações extraídas.` });
      }
      if (data.matchesAssinaturas > 0) {
        toast({
          title: `${data.matchesAssinaturas} assinatura(s) vinculada(s) automaticamente`,
          description: "Pagamentos identificados no extrato — confira em Assinaturas.",
        });
      }
      onReload();
    } catch (err: any) {
      toast({ title: "Erro no processamento IA", description: err.message, variant: "destructive" });
    } finally {
      setUploadingAI(false);
      if (aiFileInput.current) aiFileInput.current.value = "";
    }
  };

  const Icon = conta.tipo === "banco" ? Building2 : conta.tipo === "maquininha" ? CreditCard : Coins;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const name = file.name.toLowerCase();

      // PDF: envia pro backend extrair via IA
      if (name.endsWith(".pdf")) {
        const form = new FormData();
        form.append("file", file);
        form.append("contaId", conta.id);
        form.append("mes", mes);
        const res = await fetch(`${API_BASE}/api/consolidacao/upload-pdf`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao processar PDF");
        }
        const data = await res.json();
        if (data.mesPredominante && data.mesPredominante !== mes && onChangeMes) {
          onChangeMes(data.mesPredominante);
          toast({
            title: `${data.inserted} transações importadas`,
            description: `Mês ajustado para ${data.mesPredominante} (extrato é desse mês).`,
          });
        } else {
          toast({
            title: "PDF processado!",
            description: `${data.inserted} transações extraídas via IA.`,
          });
        }
        if (data.matchesAssinaturas > 0) {
          toast({
            title: `${data.matchesAssinaturas} assinatura(s) vinculada(s) automaticamente`,
            description: "Pagamentos identificados no extrato — confira em Assinaturas.",
          });
        }
        onReload();
        return;
      }

      const rows = await parseFileToRows(file);
      if (rows.length < 2) throw new Error("Arquivo vazio");

      const headerIdx = findHeaderRow(rows);
      const headers = rows[headerIdx];
      const dataRows = rows.slice(headerIdx + 1);
      const cols = detectColumns(headers, dataRows.slice(0, 20));
      const transacoes: any[] = [];

      for (const row of dataRows) {
        if (row.length < 2) continue;
        const date = parseDate(row[cols.date] || "");
        const description = (row[cols.description] || "").trim();

        // Ignora linhas de saldo / subtotal / cabeçalho repetido
        if (!date || isSaldoLine(description)) continue;

        // Calcula valor: se tiver colunas separadas de débito/crédito, usa ambas
        let amount = 0;
        if (cols.hasDebitoCredito) {
          const deb = parseBR(row[cols.debito] || "0");
          const cred = parseBR(row[cols.credito] || "0");
          // Débito = saída (negativo), Crédito = entrada (positivo)
          amount = cred - deb;
        } else if (cols.amount >= 0) {
          amount = parseBR(row[cols.amount] || "0");
        } else {
          // Fallback: procura coluna numérica razoável, pulando a de saldo explicitamente
          for (let j = 2; j < row.length; j++) {
            if (j === cols.saldo) continue; // NÃO usar saldo como valor
            const v = parseBR(row[j] || "0");
            if (v !== 0 && Math.abs(v) < 10_000_000) {
              amount = v;
              break;
            }
          }
        }

        if (amount === 0) continue;
        // Sanidade por linha: rejeita valores absurdos (> 10 milhões) que indicam parse errado
        if (Math.abs(amount) > 10_000_000) continue;

        const tipo = detectTipo(description);
        transacoes.push({ date, description, amount, tipo });
      }

      // Sanidade agregada: se o total é absurdo (>R$ 10M) ou valor médio > R$ 500k,
      // provavelmente pegamos a coluna errada. Aborta e sugere IA.
      const totalAbs = transacoes.reduce((s, t) => s + Math.abs(t.amount), 0);
      const avg = transacoes.length > 0 ? totalAbs / transacoes.length : 0;
      if (totalAbs > 10_000_000 || avg > 500_000) {
        toast({
          title: "Parsing com valores suspeitos",
          description: `Total parece errado (${formatCurrency(totalAbs)}). Tente 'Importar com IA' — Claude vai analisar o arquivo corretamente.`,
          variant: "destructive",
        });
        return;
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
      if (data.mesPredominante && data.mesPredominante !== mes && onChangeMes) {
        onChangeMes(data.mesPredominante);
        toast({
          title: `${data.inserted} transações importadas`,
          description: `Mês ajustado para ${data.mesPredominante}${antecipacoes > 0 ? ` · ${antecipacoes} antecipações` : ""}.`,
        });
      } else {
        toast({
          title: "Importado!",
          description: `${data.inserted} transações${antecipacoes > 0 ? ` (${antecipacoes} antecipações detectadas)` : ""}.`,
        });
      }
      if (data.matchesAssinaturas > 0) {
        toast({
          title: `${data.matchesAssinaturas} assinatura(s) vinculada(s) automaticamente`,
          description: "Pagamentos identificados no extrato — confira em Assinaturas.",
        });
      }
      onReload();
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const limparMes = async () => {
    if (!confirm(`Limpar todas as transações de ${conta.nome} no mês ${mes}?\n(as transações importadas serão removidas — a conta continua salva)`)) return;
    await fetch(`${API_BASE}/api/consolidacao/transacoes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contaId: conta.id, mes }),
    });
    toast({ title: "Transações removidas" });
    onReload();
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
              todasContas={todasContas}
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
        <input ref={fileInput} type="file" accept=".csv,.txt,.xlsx,.xls,.pdf" onChange={handleFile} className="hidden" />
        <input ref={aiFileInput} type="file" accept=".csv,.txt,.xlsx,.xls,.pdf" onChange={handleFileAI} className="hidden" />
        <div className="space-y-1.5">
          <div className="flex gap-2" data-testid="conciliacao-import-card">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || uploadingAI}
              title="Aceita CSV, Excel (.xlsx) ou PDF"
              data-testid="btn-import"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {uploading ? "Importando..." : "Importar extrato"}
            </Button>
            {totalTx > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 text-red-400 hover:text-red-300 hover:border-red-500/50"
                onClick={limparMes}
                title="Limpar transações deste mês"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs h-8 border-primary/40 text-primary hover:bg-primary/10 hover:border-primary"
            onClick={() => aiFileInput.current?.click()}
            disabled={uploading || uploadingAI}
            title="Usa IA (Claude) para extrair transações quando o parser normal falha"
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5" />
            {uploadingAI ? "IA processando..." : "Importar com IA"}
          </Button>
        </div>
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
