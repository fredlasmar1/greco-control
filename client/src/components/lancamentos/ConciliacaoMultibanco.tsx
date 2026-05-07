// Conciliação multibanco — para o caso Greco onde Santander/InfinityPay
// recebem vendas e transferem pro Itaú. Detecta transferências internas
// pra não dupla-contar entradas, e bate o total contra o Trinks (com
// diagnóstico de divergência apontando provável depósito em dinheiro).
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, Building2, RefreshCw, CheckCircle2, AlertCircle, X, Sparkles } from "lucide-react";

interface ResumoConta {
  id: string;
  nome: string;
  transito: boolean;
  contaDestinoId?: string;
  entradasBrutas: number; entradasQtd: number;
  saidasBrutas: number; saidasQtd: number;
  transferOut: number; transferOutQtd: number;
  transferIn: number; transferInQtd: number;
  entradasLiquidas: number; saidasLiquidas: number;
}
interface Par {
  outId: string; inId: string;
  valor: number; data: string; confianca: number;
  outConta: string; inConta: string;
}
interface VisaoApi {
  ok: boolean;
  mes: string;
  contas: ResumoConta[];
  pares: Par[];
  totais: {
    entradasBrutas: number;
    entradasLiquidas: number;
    saidasBrutas: number;
    saidasLiquidas: number;
    transferenciasInternas: number;
  };
}

interface TrinksMes {
  total: number; pix: number; cartao: number; dinheiro: number; outros: number;
}

interface Props {
  mes: string;
  trinksMes: TrinksMes;
  /** Quando algo muda, força refresh de blocos paralelos. */
  onChanged?: () => void;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ConciliacaoMultibanco({ mes, trinksMes, onChanged }: Props) {
  const [data, setData] = useState<VisaoApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [detectando, setDetectando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/conciliacao-multibanco/${mes}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: VisaoApi = await r.json();
      setData(j);
    } catch (err: any) {
      setError(err.message || "Erro");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);

  async function detectar(force: boolean) {
    if (detectando) return;
    setDetectando(true);
    try {
      const r = await fetch(`/api/conciliacao-multibanco/detectar/${mes}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const j = await r.json();
      if (j.ok) {
        await carregar();
        onChanged?.();
        const msg = `${j.pareados} par(es) detectado(s). Sem-par: ${j.naoCasadas.outs} saída(s), ${j.naoCasadas.ins} entrada(s).`;
        if (j.pareados > 0 || j.naoCasadas.outs + j.naoCasadas.ins > 0) alert(msg);
      } else {
        alert("Erro: " + (j.error || ""));
      }
    } catch (err: any) {
      alert("Erro: " + err.message);
    } finally {
      setDetectando(false);
    }
  }

  async function desfazerPar(txId: string) {
    if (!confirm("Desfazer este pareamento? As duas transações voltam a contar como entrada/saída separadas.")) return;
    await fetch(`/api/conciliacao-multibanco/desfazer-par`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txId }),
    });
    await carregar();
    onChanged?.();
  }

  const divergencia = useMemo(() => {
    if (!data) return null;
    const entradasLiq = data.totais.entradasLiquidas;
    const trinks = trinksMes.total;
    const dif = trinks - entradasLiq;
    return {
      trinks,
      entradasLiq,
      dif,
      pctDif: trinks > 0 ? (dif / trinks) * 100 : 0,
      bate: Math.abs(dif) < 50, // tolerância R$50
    };
  }, [data, trinksMes]);

  if (loading && !data) {
    return <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">Carregando conciliação multibanco…</CardContent></Card>;
  }
  if (error) {
    return <Card><CardContent className="p-6 text-center text-red-400 text-sm">⚠ {error}</CardContent></Card>;
  }
  if (!data) return null;

  const contasOrdenadas = [...data.contas].sort((a, b) => {
    // Não-trânsito primeiro (consolidador), depois trânsito
    if (a.transito !== b.transito) return a.transito ? 1 : -1;
    return b.entradasBrutas - a.entradasBrutas;
  });
  const consolidador = contasOrdenadas.find(c => !c.transito);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-cyan-400" />
            Conciliação Multibanco × Trinks
          </span>
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => carregar()} disabled={loading}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Recarregar
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => detectar(false)} disabled={detectando}>
              <Sparkles className="w-3 h-3 mr-1" /> {detectando ? "Detectando…" : "Detectar transferências"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Cards por conta */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {contasOrdenadas.map(c => {
            const corBorda = c.transito ? "border-amber-500/30" : "border-emerald-500/30";
            const transferLabel = c.transito
              ? `Transferiu p/ destino: R$ ${fmtBRL(c.transferOut)} (${c.transferOutQtd}x)`
              : `Recebeu de trânsito: R$ ${fmtBRL(c.transferIn)} (${c.transferInQtd}x)`;
            return (
              <div key={c.id} className={`rounded-md border ${corBorda} bg-background/30 p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 font-medium text-sm">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                    {c.nome.trim()}
                  </span>
                  <Badge variant="outline" className={`text-[9px] ${c.transito ? "border-amber-500/40 text-amber-300" : "border-emerald-500/40 text-emerald-300"}`}>
                    {c.transito ? "Trânsito" : "Consolidador"}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Entradas brutas</span>
                    <span className="tabular-nums">R$ {fmtBRL(c.entradasBrutas)}</span>
                  </div>
                  {c.transferIn > 0 && (
                    <div className="flex justify-between text-amber-400/80">
                      <span>↪ vindo de trânsito</span>
                      <span className="tabular-nums">−R$ {fmtBRL(c.transferIn)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t border-border/40 pt-1">
                    <span className="text-emerald-300">Entradas líquidas</span>
                    <span className="tabular-nums text-emerald-400">R$ {fmtBRL(c.entradasLiquidas)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground pt-1">
                    <span>{transferLabel}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Comparativo Trinks × Banco */}
        {divergencia && (
          <div className={`rounded-md border p-3 ${divergencia.bate ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
            <div className="flex items-center gap-2 mb-2">
              {divergencia.bate
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                : <AlertCircle className="w-4 h-4 text-amber-400" />}
              <span className="text-sm font-medium">
                {divergencia.bate ? "Trinks bate com extrato" : "Divergência Trinks × Extrato"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Trinks (vendas)</div>
                <div className="text-base font-semibold tabular-nums">R$ {fmtBRL(divergencia.trinks)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Entradas líquidas (extrato)</div>
                <div className="text-base font-semibold tabular-nums">R$ {fmtBRL(divergencia.entradasLiq)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Diferença</div>
                <div className={`text-base font-semibold tabular-nums ${divergencia.dif > 0 ? "text-amber-400" : divergencia.dif < 0 ? "text-blue-400" : "text-emerald-400"}`}>
                  {divergencia.dif >= 0 ? "+" : ""}R$ {fmtBRL(divergencia.dif)}
                </div>
                <div className="text-[10px] text-muted-foreground">{divergencia.pctDif.toFixed(1)}% do faturamento</div>
              </div>
            </div>
            {!divergencia.bate && (
              <p className="text-[11px] mt-2 text-amber-300/90">
                {divergencia.dif > 0
                  ? `Trinks > banco em R$ ${fmtBRL(divergencia.dif)}. Provável: depósito em dinheiro ainda não feito${consolidador ? `, ou pendente de cair n${consolidador.nome.toLowerCase().includes("itaú") ? "o" : "a"} ${consolidador.nome.trim()}` : ""}.`
                  : `Banco > Trinks em R$ ${fmtBRL(Math.abs(divergencia.dif))}. Investigar entradas não relacionadas a vendas (estornos, empréstimos, devoluções).`}
              </p>
            )}
          </div>
        )}

        {/* Quebra Trinks por meio */}
        <div className="rounded-md border border-card-border/40 bg-background/30 p-3">
          <div className="text-[10px] uppercase text-muted-foreground mb-2">Trinks — quebra do mês por meio</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground">PIX</span>
              <span className="tabular-nums font-medium">R$ {fmtBRL(trinksMes.pix)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground">Cartão</span>
              <span className="tabular-nums font-medium">R$ {fmtBRL(trinksMes.cartao)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground">Dinheiro</span>
              <span className="tabular-nums font-medium">R$ {fmtBRL(trinksMes.dinheiro)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground">Outros</span>
              <span className="tabular-nums font-medium">R$ {fmtBRL(trinksMes.outros)}</span>
            </div>
          </div>
        </div>

        {/* Pares de transferência detectados */}
        {data.pares.length > 0 && (
          <div className="rounded-md border border-card-border/40 bg-background/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                Transferências internas detectadas ({data.pares.length})
              </span>
              <span className="text-[10px] text-muted-foreground">Total: R$ {fmtBRL(data.totais.transferenciasInternas)}</span>
            </div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto">
              {data.pares.map(p => {
                const conf = (p.confianca * 100).toFixed(0);
                const confCor = p.confianca >= 0.8 ? "text-emerald-400"
                              : p.confianca >= 0.5 ? "text-amber-400"
                              : "text-red-400";
                return (
                  <div key={p.outId} className="flex items-center gap-2 text-xs py-1 border-b border-border/30 last:border-0">
                    <span className="text-muted-foreground tabular-nums w-20">{new Date(p.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                    <span className="font-medium">{p.outConta.trim()}</span>
                    <ArrowRightLeft className="w-3 h-3 text-muted-foreground" />
                    <span className="font-medium">{p.inConta.trim()}</span>
                    <span className="ml-auto tabular-nums">R$ {fmtBRL(p.valor)}</span>
                    <span className={`text-[10px] ${confCor} w-10 text-right`}>{conf}%</span>
                    <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={() => desfazerPar(p.outId)} title="Desfazer pareamento">
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.pares.length === 0 && (
          <div className="text-center text-xs text-muted-foreground italic py-2">
            Nenhuma transferência interna detectada. Clique "Detectar transferências" pra rodar o casamento.
          </div>
        )}

      </CardContent>
    </Card>
  );
}
