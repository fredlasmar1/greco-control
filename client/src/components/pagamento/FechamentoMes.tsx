// Bloco "Fechamento do Mês" plugado na aba Pagamento.
// Consolida tudo que importa pra fechar contábil/financeiramente o mês:
//   1. Receita Trinks por meio (cartão, PIX, dinheiro, planos)
//   2. Entradas líquidas por banco × Trinks (gap = dinheiro pendente / liquidação D+30)
//   3. Transferências internas detectadas (3 contas)
//   4. Cobranças bancárias automáticas (juros, IOF, tarifa, fatura cartão) — botão "Justificar"
//   5. Resultado consolidado do mês
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  TrendingUp, TrendingDown, ArrowRightLeft, AlertCircle, CheckCircle2,
  ChevronDown, ChevronRight, RefreshCw, FileText, Building2, Banknote
} from "lucide-react";

interface Banco {
  id: string; nome: string; transito: boolean;
  entradasBrutas: number; entradasLiquidas: number; entradasQtd: number;
  saidasBrutas: number; saidasLiquidas: number; saidasQtd: number;
  transferOut: number; transferIn: number;
}
interface Par {
  outId: string; inId: string; valor: number; data: string;
  confianca: number; outConta: string; inConta: string;
}
interface Cobranca {
  tipo: string; rotulo: string;
  id: string; date: string; description: string; amount: number;
  contaId: string; contaNome: string;
  categoriaId?: string; justificativa?: string;
}
interface FechamentoApi {
  ok: boolean;
  mes: string;
  trinks: { total: number; pix: number; cartao: number; dinheiro: number; outros: number; qtd: number };
  bancos: Banco[];
  pares: Par[];
  cobrancas: { porTipo: Record<string, { rotulo: string; total: number; qtd: number; itens: Cobranca[] }>; total: number; qtd: number };
  totais: {
    entradasLiquidas: number; saidasLiquidas: number; fluxoMes: number;
    gapTrinksBanco: number; gapDinheiroFisico: number;
  };
}

interface Props { mes: string }

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FechamentoMes({ mes }: Props) {
  const [data, setData] = useState<FechamentoApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiposExpandidos, setTiposExpandidos] = useState<Set<string>>(new Set(["juros_limite"]));
  const [justificando, setJustificando] = useState<Cobranca | null>(null);
  const [textoJustif, setTextoJustif] = useState("");
  const [salvandoJustif, setSalvandoJustif] = useState(false);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/fechamento-mes/${mes}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: FechamentoApi = await r.json();
      setData(j);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar fechamento");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);

  function toggleTipo(t: string) {
    setTiposExpandidos(prev => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t); else n.add(t);
      return n;
    });
  }

  async function salvarJustificativa() {
    if (!justificando) return;
    setSalvandoJustif(true);
    try {
      await fetch(`/api/expenses/bank/${justificando.id}/justificativa`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ justificativa: textoJustif.trim() }),
      });
      setJustificando(null);
      setTextoJustif("");
      await carregar();
    } finally {
      setSalvandoJustif(false);
    }
  }

  const trinksBate = useMemo(() => {
    if (!data) return { ok: false, dif: 0 };
    const dif = data.trinks.total - data.totais.entradasLiquidas;
    return { ok: Math.abs(dif) < 50, dif };
  }, [data]);

  if (loading && !data) return (
    <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">Carregando fechamento…</CardContent></Card>
  );
  if (error) return (
    <Card><CardContent className="p-6 text-center text-red-400 text-sm">⚠ {error}</CardContent></Card>
  );
  if (!data) return null;

  const cobrancasTipos = Object.entries(data.cobrancas.porTipo).sort((a, b) => b[1].total - a[1].total);

  return (
    <Card className="border-2 border-cyan-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Fechamento do Mês
            <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-300">v29</Badge>
          </span>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => carregar()} disabled={loading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Recarregar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* ── BLOCO 1: TRINKS (RECEITA REAL) ── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold">1. Receita do mês — Trinks</span>
            <Badge variant="outline" className="text-[10px]">{data.trinks.qtd} transações</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <div className="rounded border border-card-border/50 bg-background/30 p-2">
              <div className="text-[10px] text-muted-foreground">💳 Cartão</div>
              <div className="tabular-nums font-semibold">R$ {fmtBRL(data.trinks.cartao)}</div>
              <div className="text-[9px] text-muted-foreground">{data.trinks.total > 0 ? `${((data.trinks.cartao/data.trinks.total)*100).toFixed(1)}%` : ""}</div>
            </div>
            <div className="rounded border border-card-border/50 bg-background/30 p-2">
              <div className="text-[10px] text-muted-foreground">📦 Outros (planos)</div>
              <div className="tabular-nums font-semibold">R$ {fmtBRL(data.trinks.outros)}</div>
              <div className="text-[9px] text-muted-foreground">{data.trinks.total > 0 ? `${((data.trinks.outros/data.trinks.total)*100).toFixed(1)}%` : ""}</div>
            </div>
            <div className="rounded border border-card-border/50 bg-background/30 p-2">
              <div className="text-[10px] text-muted-foreground">📲 PIX</div>
              <div className="tabular-nums font-semibold">R$ {fmtBRL(data.trinks.pix)}</div>
              <div className="text-[9px] text-muted-foreground">{data.trinks.total > 0 ? `${((data.trinks.pix/data.trinks.total)*100).toFixed(1)}%` : ""}</div>
            </div>
            <div className="rounded border border-card-border/50 bg-background/30 p-2">
              <div className="text-[10px] text-muted-foreground">💵 Dinheiro</div>
              <div className="tabular-nums font-semibold">R$ {fmtBRL(data.trinks.dinheiro)}</div>
              <div className="text-[9px] text-muted-foreground">{data.trinks.total > 0 ? `${((data.trinks.dinheiro/data.trinks.total)*100).toFixed(1)}%` : ""}</div>
            </div>
            <div className="rounded border-2 border-emerald-500/40 bg-emerald-500/10 p-2">
              <div className="text-[10px] text-emerald-300">TOTAL Trinks</div>
              <div className="tabular-nums font-bold text-emerald-400">R$ {fmtBRL(data.trinks.total)}</div>
            </div>
          </div>
        </div>

        {/* ── BLOCO 2: BANCOS (ENTRADAS LÍQUIDAS) ── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold">2. Entradas líquidas por banco</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {data.bancos.map(b => {
              const corBorda = b.transito ? "border-amber-500/30" : "border-emerald-500/30";
              return (
                <div key={b.id} className={`rounded-md border ${corBorda} bg-background/30 p-2 text-xs`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{b.nome}</span>
                    <Badge variant="outline" className={`text-[9px] ${b.transito ? "border-amber-500/40 text-amber-300" : "border-emerald-500/40 text-emerald-300"}`}>
                      {b.transito ? "Trânsito" : "Consolida"}
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Brutas</span><span className="tabular-nums">R$ {fmtBRL(b.entradasBrutas)}</span>
                    </div>
                    {b.transferIn > 0 && (
                      <div className="flex justify-between text-amber-400/80">
                        <span>↪ da Greco</span><span className="tabular-nums">−R$ {fmtBRL(b.transferIn)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold border-t border-border/40 pt-0.5 text-emerald-400">
                      <span>Líquidas</span><span className="tabular-nums">R$ {fmtBRL(b.entradasLiquidas)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Comparativo Trinks × Bancos */}
          <div className={`mt-2 rounded-md border p-2 text-xs ${trinksBate.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
            <div className="flex items-center gap-2 mb-1">
              {trinksBate.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}
              <span className="font-medium">Batimento Trinks × Bancos</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><div className="text-[10px] text-muted-foreground">Trinks</div><div className="tabular-nums font-semibold">R$ {fmtBRL(data.trinks.total)}</div></div>
              <div><div className="text-[10px] text-muted-foreground">Bancos (líq.)</div><div className="tabular-nums font-semibold">R$ {fmtBRL(data.totais.entradasLiquidas)}</div></div>
              <div>
                <div className="text-[10px] text-muted-foreground">Diferença</div>
                <div className={`tabular-nums font-semibold ${trinksBate.dif > 0 ? "text-amber-400" : trinksBate.dif < 0 ? "text-blue-400" : "text-emerald-400"}`}>
                  {trinksBate.dif >= 0 ? "+" : ""}R$ {fmtBRL(trinksBate.dif)}
                </div>
              </div>
            </div>
            {data.totais.gapDinheiroFisico > 50 && (
              <p className="text-[10px] mt-1.5 text-amber-300/90 flex items-center gap-1">
                <Banknote className="w-3 h-3" />
                R$ {fmtBRL(data.totais.gapDinheiroFisico)} de dinheiro físico ainda não depositado
                (Trinks dinheiro R$ {fmtBRL(data.trinks.dinheiro)} − ATM R$ {fmtBRL(data.trinks.dinheiro - data.totais.gapDinheiroFisico)})
              </p>
            )}
          </div>
        </div>

        {/* ── BLOCO 3: TRANSFERÊNCIAS INTERNAS ── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ArrowRightLeft className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold">3. Transferências internas detectadas</span>
            <Badge variant="outline" className="text-[10px]">{data.pares.length} pares</Badge>
            {data.pares.length > 0 && <span className="text-[10px] text-muted-foreground">total R$ {fmtBRL(data.pares.reduce((s, p) => s + p.valor, 0))}</span>}
          </div>
          {data.pares.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">Nenhuma transferência interna detectada. Use a aba Lançamentos → Extrato detalhado pra parear manualmente.</p>
          ) : (
            <div className="rounded-md border border-card-border/40 bg-background/20 max-h-[200px] overflow-y-auto">
              <table className="w-full text-[11px]">
                <tbody>
                  {data.pares.map(p => (
                    <tr key={p.outId} className="border-b border-border/30 last:border-0">
                      <td className="py-1 px-2 text-muted-foreground tabular-nums w-20">{new Date(p.data + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                      <td className="py-1 px-2"><span className="font-medium">{p.outConta}</span> <ArrowRightLeft className="inline w-2.5 h-2.5 mx-1" /> <span className="font-medium">{p.inConta}</span></td>
                      <td className="py-1 px-2 text-right tabular-nums font-medium">R$ {fmtBRL(p.valor)}</td>
                      <td className="py-1 px-2 text-right text-[9px] w-12">
                        <span className={p.confianca >= 0.8 ? "text-emerald-400" : p.confianca >= 0.5 ? "text-amber-400" : "text-red-400"}>
                          {Math.round(p.confianca * 100)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── BLOCO 4: COBRANÇAS BANCÁRIAS AUTOMÁTICAS ── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold">4. Cobranças bancárias automáticas</span>
            <Badge variant="outline" className="text-[10px]">{data.cobrancas.qtd} mov</Badge>
            <span className="ml-auto text-sm font-bold tabular-nums text-red-400">R$ {fmtBRL(data.cobrancas.total)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mb-2 px-1">
            Juros, tarifas, IOF, DARF e faturas de cartão que o banco descontou direto. Clique em <b>Justificar</b> pra anotar a explicação.
          </p>

          {cobrancasTipos.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">Nenhuma cobrança bancária detectada neste mês 🎉</p>
          ) : (
            <div className="space-y-1">
              {cobrancasTipos.map(([tipo, info]) => {
                const open = tiposExpandidos.has(tipo);
                const justificadas = info.itens.filter(i => i.justificativa).length;
                const pctJust = (justificadas / info.qtd) * 100;
                return (
                  <div key={tipo} className="rounded-md border border-card-border/40 bg-background/30">
                    <button type="button" onClick={() => toggleTipo(tipo)} className="w-full flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-muted/30">
                      <div className="flex items-center gap-2">
                        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span className="text-xs font-medium">{info.rotulo}</span>
                        <span className="text-[10px] text-muted-foreground">({info.qtd} mov)</span>
                        {justificadas > 0 && (
                          <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/40 text-emerald-300">
                            {justificadas}/{info.qtd} justificadas {pctJust >= 100 ? "✓" : ""}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs tabular-nums font-semibold text-red-400">R$ {fmtBRL(info.total)}</span>
                    </button>
                    {open && (
                      <div className="px-2 pb-2 pt-0.5 space-y-1 border-t border-border/30">
                        {info.itens.map(c => (
                          <div key={c.id} className="rounded border border-card-border/30 bg-background/20 p-1.5 text-[11px]">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground tabular-nums w-16 shrink-0">{new Date(c.date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                              <span className="text-[10px] text-muted-foreground w-20 shrink-0">{c.contaNome}</span>
                              <span className="flex-1 truncate" title={c.description}>{c.description}</span>
                              <span className="tabular-nums font-medium text-red-400 shrink-0">−R$ {fmtBRL(Math.abs(c.amount))}</span>
                              <Button
                                type="button" size="sm"
                                variant={c.justificativa ? "outline" : "default"}
                                className="h-6 text-[10px] px-2 shrink-0"
                                onClick={() => { setJustificando(c); setTextoJustif(c.justificativa || ""); }}
                              >
                                {c.justificativa ? "Editar" : "Justificar"}
                              </Button>
                            </div>
                            {c.justificativa && (
                              <div className="text-[10px] text-emerald-300/90 mt-1 pl-[6.5rem] italic">
                                ↳ {c.justificativa}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── BLOCO 5: RESULTADO CONSOLIDADO ── */}
        <div className={`rounded-md border-2 p-3 ${data.totais.fluxoMes >= 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold">5. Resultado consolidado do fluxo de caixa</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Entradas líquidas</div>
              <div className="text-lg font-bold tabular-nums text-emerald-400">R$ {fmtBRL(data.totais.entradasLiquidas)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Saídas líquidas</div>
              <div className="text-lg font-bold tabular-nums text-red-400">R$ {fmtBRL(data.totais.saidasLiquidas)}</div>
            </div>
            <div className="border-l border-border pl-3">
              <div className="text-[10px] uppercase text-muted-foreground">Fluxo do mês</div>
              <div className={`text-xl font-bold tabular-nums ${data.totais.fluxoMes >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.totais.fluxoMes >= 0 ? "+" : ""}R$ {fmtBRL(data.totais.fluxoMes)}
              </div>
            </div>
          </div>
        </div>

      </CardContent>

      {/* DIALOG: Justificar cobrança */}
      <Dialog open={!!justificando} onOpenChange={v => !v && setJustificando(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Justificar cobrança</DialogTitle>
            <DialogDescription className="text-xs">
              Anote o motivo dessa cobrança. A nota fica gravada e aparece nas próximas análises e na auditoria.
            </DialogDescription>
          </DialogHeader>
          {justificando && (
            <div className="space-y-3">
              <div className="rounded-md border border-card-border bg-background/40 p-2 text-xs space-y-0.5">
                <div className="flex justify-between">
                  <span className="font-medium">{justificando.contaNome}</span>
                  <span>{new Date(justificando.date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                </div>
                <div className="text-muted-foreground">{justificando.description}</div>
                <div className="tabular-nums font-semibold text-red-400">−R$ {fmtBRL(Math.abs(justificando.amount))}</div>
              </div>
              <Textarea
                value={textoJustif}
                onChange={e => setTextoJustif(e.target.value)}
                placeholder="Ex: 'juros porque conta entrou no negativo dia 06 — corrigir em maio com transferência antecipada do Santander'"
                rows={4}
                className="text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setJustificando(null)} disabled={salvandoJustif}>Cancelar</Button>
                <Button type="button" size="sm" onClick={salvarJustificativa} disabled={salvandoJustif}>
                  {salvandoJustif ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
