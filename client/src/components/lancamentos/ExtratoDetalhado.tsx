// Aba "Extrato detalhado" — central operacional pro fechamento do mês.
// Filtros por banco × tipo × categoria, edição inline, marcação manual de
// transferência interna via dialog, e drill-down clicando em qualquer linha.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Eye, EyeOff, Trash2, Search, Filter, Building2, X as XIcon } from "lucide-react";
import DialogPareamentoManual from "./DialogPareamentoManual";

interface Tx {
  id: string;
  contaId: string;
  date: string;
  description: string;
  amount: number;
  categoria?: string;       // legado
  categoriaId?: string;
  subcategoria?: string;
  tipo?: string;
  incluidoNoFluxo?: boolean;
  transferenciaParId?: string;
  transferenciaConfianca?: number;
  regraIdAplicada?: string;
  justificativa?: string;
}

// Comportamento contábil do tipo da categoria (espelha o server tipoConta).
function tipoContaCli(tipo?: string): "entrada" | "saida" | "neutro" {
  if (tipo === "faturamento") return "entrada";
  if (tipo === "neutro") return "neutro";
  return "saida";
}

interface Conta { id: string; nome: string; transito?: boolean; contaDestinoId?: string }
interface Cat { id: string; nome: string; tipo: string; cor: string }

interface Props {
  mes: string;
  onChanged?: () => void;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ExtratoDetalhado({ mes, onChanged }: Props) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(false);

  const [filtroConta, setFiltroConta] = useState<string>("__todas");
  const [filtroTipo, setFiltroTipo] = useState<"todas" | "entradas" | "saidas">("todas");
  const [filtroCat, setFiltroCat] = useState<string>("__todas"); // "__todas" | "_sem" | catId
  const [filtroSoNaoPareadas, setFiltroSoNaoPareadas] = useState(false);
  const [busca, setBusca] = useState("");

  const [pairOrigem, setPairOrigem] = useState<Tx | null>(null);

  async function carregar() {
    setLoading(true);
    try {
      const [tRes, cRes, catRes] = await Promise.all([
        fetch(`/api/consolidacao/transacoes?mes=${mes}`).then(r => r.json()),
        fetch("/api/consolidacao/contas").then(r => r.json()),
        fetch("/api/expense-categorias").then(r => r.json()),
      ]);
      setTxs(Array.isArray(tRes) ? tRes : []);
      setContas(Array.isArray(cRes) ? cRes : []);
      setCats(catRes?.categorias || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);

  const contasMap = useMemo(() => new Map(contas.map(c => [c.id, c])), [contas]);
  const catsMap = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);

  const filtradas = useMemo(() => {
    return txs.filter(t => {
      if (filtroConta !== "__todas" && t.contaId !== filtroConta) return false;
      if (filtroTipo === "entradas" && t.amount <= 0) return false;
      if (filtroTipo === "saidas" && t.amount >= 0) return false;
      if (filtroCat === "_sem") { if (t.amount >= 0 || t.categoriaId) return false; }
      else if (filtroCat !== "__todas") { if (t.categoriaId !== filtroCat) return false; }
      if (filtroSoNaoPareadas && t.transferenciaParId) return false;
      if (busca.trim()) {
        const b = busca.toLowerCase();
        if (!t.description.toLowerCase().includes(b)) return false;
      }
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [txs, filtroConta, filtroTipo, filtroCat, filtroSoNaoPareadas, busca]);

  const stats = useMemo(() => {
    let entradas = 0, saidas = 0, qtd = 0, pareadas = 0, semCat = 0;
    for (const t of filtradas) {
      qtd++;
      if (t.amount > 0) entradas += t.amount; else saidas += Math.abs(t.amount);
      if (t.transferenciaParId) pareadas++;
      if (t.amount < 0 && !t.categoriaId) semCat++;
    }
    return { entradas, saidas, qtd, pareadas, semCat };
  }, [filtradas]);

  async function setCategoria(tx: Tx, novaCatId: string | null) {
    await fetch(`/api/expenses/bank/${tx.id}/categoria`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoriaId: novaCatId }),
    });
    setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, categoriaId: novaCatId || undefined, regraIdAplicada: undefined } : t));
    onChanged?.();
  }

  // Categorias oferecidas por linha: entrada → faturamento + neutro; saída → despesa + neutro.
  function catsParaLinha(amount: number): Cat[] {
    const querEntrada = amount >= 0;
    return cats.filter(c => {
      const tc = tipoContaCli(c.tipo);
      if (tc === "neutro") return true;
      return querEntrada ? tc === "entrada" : tc === "saida";
    });
  }

  async function salvarJustificativa(tx: Tx, texto: string) {
    await fetch(`/api/expenses/bank/${tx.id}/justificativa`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justificativa: texto }),
    });
    setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, justificativa: texto } : t));
    onChanged?.();
  }

  async function toggleFluxo(tx: Tx) {
    const novo = tx.incluidoNoFluxo === false ? true : false;
    await fetch(`/api/consolidacao/transacoes/${tx.id}/fluxo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incluido: novo }),
    });
    setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, incluidoNoFluxo: novo } : t));
    onChanged?.();
  }

  async function apagar(tx: Tx) {
    if (!confirm("Apagar esta transação? Não pode ser desfeito.")) return;
    await fetch(`/api/consolidacao/transacoes/${tx.id}`, { method: "DELETE" });
    setTxs(prev => prev.filter(t => t.id !== tx.id));
    onChanged?.();
  }

  async function desfazerPar(tx: Tx) {
    if (!tx.transferenciaParId) return;
    if (!confirm("Desfazer este pareamento? Vai voltar a contar como entrada/saída separadas.")) return;
    await fetch("/api/conciliacao-multibanco/desfazer-par", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txId: tx.id }),
    });
    setTxs(prev => prev.map(t => {
      if (t.id === tx.id || t.id === tx.transferenciaParId) {
        return { ...t, transferenciaParId: undefined, transferenciaConfianca: undefined };
      }
      return t;
    }));
    onChanged?.();
  }

  // Pra dialog de pareamento, passa lista enriquecida com contaNome
  const txsEnrich = useMemo(() => {
    return txs.map(t => ({
      id: t.id, contaId: t.contaId, contaNome: contasMap.get(t.contaId)?.nome.trim() || "?",
      date: t.date, description: t.description, amount: t.amount,
      transferenciaParId: t.transferenciaParId,
    }));
  }, [txs, contasMap]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-cyan-400" />
          Extrato detalhado — {filtradas.length} de {txs.length} lançamentos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          {/* Banco — pills */}
          <div className="md:col-span-5 flex flex-wrap gap-1">
            <button type="button"
              onClick={() => setFiltroConta("__todas")}
              className={`h-7 px-2.5 rounded-md text-[11px] border ${filtroConta === "__todas" ? "border-foreground bg-muted/50" : "border-card-border/40 hover:bg-muted/30"}`}
            >Todos os bancos</button>
            {contas.map(c => (
              <button key={c.id} type="button"
                onClick={() => setFiltroConta(c.id)}
                className={`h-7 px-2.5 rounded-md text-[11px] border flex items-center gap-1.5 ${filtroConta === c.id ? "border-foreground bg-muted/50" : "border-card-border/40 hover:bg-muted/30"}`}
              >
                <Building2 className="w-3 h-3" />{c.nome.trim()}
                {c.transito && <span className="text-[9px] text-amber-400">trânsito</span>}
              </button>
            ))}
          </div>

          {/* Tipo — pills */}
          <div className="md:col-span-3 flex gap-1">
            {(["saidas", "entradas", "todas"] as const).map(t => (
              <button key={t} type="button"
                onClick={() => setFiltroTipo(t)}
                className={`flex-1 h-7 px-2 rounded-md text-[11px] border ${filtroTipo === t ? "border-foreground bg-muted/50" : "border-card-border/40 hover:bg-muted/30"}`}
              >{t === "saidas" ? "Saídas" : t === "entradas" ? "Entradas" : "Todas"}</button>
            ))}
          </div>

          {/* Categoria */}
          <div className="md:col-span-2">
            <Select value={filtroCat} onValueChange={setFiltroCat}>
              <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__todas">Todas categorias</SelectItem>
                <SelectItem value="_sem">⚠ Sem categoria</SelectItem>
                {cats.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.cor }} />{c.nome}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Pareadas? */}
          <div className="md:col-span-2 flex items-center gap-1.5">
            <input
              id="filtro-nao-pareadas"
              type="checkbox"
              checked={filtroSoNaoPareadas}
              onChange={e => setFiltroSoNaoPareadas(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <label htmlFor="filtro-nao-pareadas" className="text-[11px] text-muted-foreground">só não-pareadas</label>
          </div>
        </div>

        {/* Busca */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar na descrição…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Resumo do filtro */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
            <div className="text-[10px] text-muted-foreground">Entradas</div>
            <div className="font-semibold tabular-nums text-emerald-400">R$ {fmtBRL(stats.entradas)}</div>
          </div>
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2">
            <div className="text-[10px] text-muted-foreground">Saídas</div>
            <div className="font-semibold tabular-nums text-red-400">R$ {fmtBRL(stats.saidas)}</div>
          </div>
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2">
            <div className="text-[10px] text-muted-foreground">Pareadas (transf. interna)</div>
            <div className="font-semibold tabular-nums text-cyan-400">{stats.pareadas}/{stats.qtd}</div>
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="text-[10px] text-muted-foreground">Saídas sem categoria</div>
            <div className="font-semibold tabular-nums text-amber-400">{stats.semCat}</div>
          </div>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] text-muted-foreground">
                <th className="text-left py-2 px-2 font-medium">Data</th>
                <th className="text-left py-2 px-2 font-medium">Banco</th>
                <th className="text-left py-2 px-2 font-medium">Descrição</th>
                <th className="text-left py-2 px-2 font-medium">Categoria</th>
                <th className="text-right py-2 px-2 font-medium">Valor</th>
                <th className="text-right py-2 px-2 font-medium w-32">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground italic">Carregando…</td></tr>}
              {!loading && filtradas.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground italic">Nenhum lançamento bate com os filtros.</td></tr>}
              {filtradas.map(t => {
                const conta = contasMap.get(t.contaId);
                const cat = t.categoriaId ? catsMap.get(t.categoriaId) : null;
                const incluido = t.incluidoNoFluxo !== false;
                const par = t.transferenciaParId;
                return (
                  <tr key={t.id} className={`border-b border-border/30 hover:bg-muted/20 ${!incluido ? "opacity-40" : ""} ${par ? "bg-cyan-500/5" : ""}`}>
                    <td className="py-2 px-2 whitespace-nowrap tabular-nums">{new Date(t.date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className="flex items-center gap-1 text-[10px]">
                        <Building2 className="w-3 h-3 text-muted-foreground" />
                        {conta?.nome.trim() || "?"}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <div className="max-w-[280px] truncate" title={t.description}>{t.description}</div>
                      {par && (
                        <Badge variant="outline" className="text-[9px] h-4 mt-0.5 border-cyan-500/40 text-cyan-300">
                          ↔ Transf. interna {t.transferenciaConfianca ? `(${Math.round(t.transferenciaConfianca * 100)}%)` : ""}
                        </Badge>
                      )}
                      <input
                        type="text"
                        defaultValue={t.justificativa || ""}
                        placeholder="+ justificativa…"
                        title="Justificativa / nota (ex.: repus o dinheiro do caixa)"
                        className="mt-1 w-full max-w-[280px] bg-transparent border-b border-border/40 focus:border-primary/60 outline-none text-[10px] text-muted-foreground placeholder:text-muted-foreground/50 py-0.5"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.justificativa || "")) salvarJustificativa(t, v); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </td>
                    <td className="py-2 px-2">
                      <Select value={t.categoriaId || "__sem"} onValueChange={v => setCategoria(t, v === "__sem" ? null : v)}>
                        <SelectTrigger className={`h-6 text-[10px] w-[160px] ${!t.categoriaId ? "border-amber-500/50 text-amber-400" : ""}`}>
                          <SelectValue placeholder="classificar…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__sem"><span className="text-muted-foreground">— Sem categoria —</span></SelectItem>
                          {catsParaLinha(t.amount).map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.cor }} />{c.nome}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {cat && tipoContaCli(cat.tipo) === "neutro" && <div className="text-[9px] text-slate-400 mt-0.5">não conta no resultado</div>}
                      {cat && t.regraIdAplicada && <div className="text-[9px] text-cyan-400/70 mt-0.5">por regra</div>}
                    </td>
                    <td className={`py-2 px-2 text-right tabular-nums font-medium whitespace-nowrap ${t.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {t.amount < 0 ? "-" : "+"}R$ {fmtBRL(Math.abs(t.amount))}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {par ? (
                          <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-cyan-400" onClick={() => desfazerPar(t)} title="Desfazer pareamento">
                            <XIcon className="w-3 h-3" />
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setPairOrigem(t)} title="Marcar como transferência interna (escolher par)">
                            <ArrowRightLeft className="w-3 h-3" />
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => toggleFluxo(t)} title={incluido ? "Ignorar no fluxo" : "Incluir de novo"}>
                          {incluido ? <Eye className="w-3 h-3 text-emerald-400" /> : <EyeOff className="w-3 h-3 text-muted-foreground" />}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-red-400" onClick={() => apagar(t)} title="Apagar">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtradas.length > 100 && (
          <p className="text-[10px] text-center text-muted-foreground italic">
            Mostrando todas {filtradas.length} linhas — use a busca pra estreitar.
          </p>
        )}
      </CardContent>

      <DialogPareamentoManual
        open={!!pairOrigem}
        onClose={() => setPairOrigem(null)}
        origem={pairOrigem ? {
          id: pairOrigem.id, contaId: pairOrigem.contaId,
          contaNome: contasMap.get(pairOrigem.contaId)?.nome.trim() || "?",
          date: pairOrigem.date, description: pairOrigem.description, amount: pairOrigem.amount,
          transferenciaParId: pairOrigem.transferenciaParId,
        } : null}
        todasTransacoes={txsEnrich}
        contas={contas}
        onPaired={() => { carregar(); onChanged?.(); }}
      />
    </Card>
  );
}
