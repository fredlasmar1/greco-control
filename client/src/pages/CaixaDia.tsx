// Caixa do Dia — dupla confirmação de fechamento diário.
// Compara vendas Trinks (por meio) × entradas no banco × dinheiro físico
// esperado vs contado. Usuário digita o contado, sistema calcula diferença
// e salva o fechamento histórico.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Calendar, ChevronLeft, ChevronRight, Banknote, Building2, TrendingUp,
  CheckCircle2, AlertCircle, Save, Lock, Unlock, RefreshCw,
} from "lucide-react";
import { mesAtualSP } from "@/lib/mesUtils";

interface Banco {
  id: string; nome: string; transito: boolean;
  entradas: number; entradasQtd: number; saidas: number; saidasQtd: number;
  depositosATM: number; transferOut: number; transferIn: number;
  itens: Array<{ id: string; description: string; amount: number; categoriaId?: string; transferenciaParId?: string; justificativa?: string }>;
}
interface ApiResp {
  ok: boolean;
  data: string;
  trinks: { total: number; pix: number; cartao: number; dinheiro: number; outros: number; qtd: number };
  bancos: Banco[];
  depositosATMDia: number;
  esperadoCaixa: number;
  fechamento: null | {
    data: string; esperado: number; contado: number; diferenca: number;
    observacao?: string; status: "aberto" | "fechado_ok" | "fechado_divergente"; fechadoEm: string;
  };
}

interface Historico {
  ok: boolean;
  mes: string;
  total: number;
  totalDif: number;
  fechamentos: Array<{ data: string; esperado: number; contado: number; diferenca: number; status: string }>;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hojeYMD(): string {
  // Local time (SP)
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
function ymdAddDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function labelDia(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  const dias = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  return `${dias[d.getDay()]} ${d.toLocaleDateString("pt-BR")}`;
}

export default function CaixaDia() {
  const [data, setData] = useState<string>(hojeYMD());
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [hist, setHist] = useState<Historico | null>(null);
  const [loading, setLoading] = useState(false);
  const [contadoStr, setContadoStr] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch(`/api/caixa-dia/${data}`);
      const j: ApiResp = await r.json();
      setResp(j);
      if (j.fechamento) {
        setContadoStr(String(j.fechamento.contado).replace(".", ","));
        setObs(j.fechamento.observacao || "");
      } else {
        setContadoStr("");
        setObs("");
      }
      // Histórico do mês
      const mes = data.slice(0, 7);
      const h = await fetch(`/api/caixa-dia-historico/${mes}`).then(x => x.json());
      setHist(h);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [data]);

  const contado = useMemo(() => {
    const n = Number(contadoStr.replace(",", "."));
    return isFinite(n) && n >= 0 ? n : null;
  }, [contadoStr]);

  const diferenca = useMemo(() => {
    if (!resp || contado === null) return null;
    return Number((contado - resp.esperadoCaixa).toFixed(2));
  }, [contado, resp]);

  async function salvar() {
    if (!resp || contado === null) return;
    setSalvando(true);
    try {
      const r = await fetch(`/api/caixa-dia/${data}/fechar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contado,
          esperado: resp.esperadoCaixa,
          observacao: obs.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!j.ok) { alert("Erro: " + (j.error || "")); return; }
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function reabrir() {
    if (!confirm("Reabrir o fechamento deste dia? Você poderá redigitar o valor contado.")) return;
    await fetch(`/api/caixa-dia/${data}`, { method: "DELETE" });
    await carregar();
  }

  const mes = data.slice(0, 7);
  const isHoje = data === hojeYMD();
  const status = resp?.fechamento?.status;
  const fechado = !!resp?.fechamento;

  return (
    <div className="space-y-4 p-4 max-w-[1400px]">

      {/* Header com seletor de data */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-emerald-400" />
              Caixa do Dia
              <Badge variant="outline" className="text-[10px]">v30</Badge>
            </span>
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => carregar()} disabled={loading}>
                <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Recarregar
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" size="sm" variant="outline" onClick={() => setData(d => ymdAddDays(d, -1))}>
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <div className="px-3 py-1.5 rounded-md border border-border bg-background min-w-[260px] text-center">
              <div className="text-sm font-semibold">{labelDia(data)}</div>
              <div className="text-[10px] text-muted-foreground">{isHoje ? "📅 Hoje" : ""}</div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setData(d => ymdAddDays(d, 1))} disabled={data >= hojeYMD()}>
              <ChevronRight className="w-3 h-3" />
            </Button>
            <Input type="date" value={data} onChange={e => setData(e.target.value)} max={hojeYMD()} className="h-8 w-[160px] text-xs" />
            <Button type="button" size="sm" variant="outline" onClick={() => setData(hojeYMD())}>Hoje</Button>
          </div>

          {/* Status */}
          {fechado && (
            <div className={`mt-3 rounded-md border p-2 text-xs flex items-center gap-2 ${status === "fechado_ok" ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-400" : "border-amber-500/40 bg-amber-500/5 text-amber-400"}`}>
              {status === "fechado_ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span className="font-medium">
                {status === "fechado_ok" ? "Dia fechado — caixa bate" : `Dia fechado com divergência de R$ ${fmtBRL(Math.abs(resp?.fechamento?.diferenca || 0))}`}
              </span>
              <span className="text-muted-foreground ml-auto text-[10px]">
                {resp?.fechamento?.fechadoEm && new Date(resp.fechamento.fechadoEm).toLocaleString("pt-BR")}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {!resp ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">Carregando…</CardContent></Card>
      ) : (
        <>
          {/* BLOCO 1: VENDAS TRINKS DO DIA (com breakdown) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Vendas Trinks — {resp.trinks.qtd} {resp.trinks.qtd === 1 ? "comanda" : "comandas"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="rounded border border-card-border/50 bg-background/30 p-2">
                  <div className="text-[10px] text-muted-foreground">💳 Cartão</div>
                  <div className="tabular-nums font-semibold">R$ {fmtBRL(resp.trinks.cartao)}</div>
                </div>
                <div className="rounded border border-card-border/50 bg-background/30 p-2">
                  <div className="text-[10px] text-muted-foreground">📦 Outros</div>
                  <div className="tabular-nums font-semibold">R$ {fmtBRL(resp.trinks.outros)}</div>
                </div>
                <div className="rounded border border-card-border/50 bg-background/30 p-2">
                  <div className="text-[10px] text-muted-foreground">📲 PIX</div>
                  <div className="tabular-nums font-semibold">R$ {fmtBRL(resp.trinks.pix)}</div>
                </div>
                <div className="rounded border-2 border-amber-500/40 bg-amber-500/10 p-2">
                  <div className="text-[10px] text-amber-300">💵 Dinheiro</div>
                  <div className="tabular-nums font-semibold text-amber-400">R$ {fmtBRL(resp.trinks.dinheiro)}</div>
                </div>
                <div className="rounded border-2 border-emerald-500/40 bg-emerald-500/10 p-2">
                  <div className="text-[10px] text-emerald-300">TOTAL</div>
                  <div className="tabular-nums font-bold text-emerald-400">R$ {fmtBRL(resp.trinks.total)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* BLOCO 2: BANCO DO DIA */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="w-4 h-4 text-cyan-400" />
                Movimentação bancária do dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {resp.bancos.map(b => {
                  const algumaCoisa = b.entradasQtd + b.saidasQtd > 0;
                  return (
                    <div key={b.id} className={`rounded-md border p-2 text-xs ${b.transito ? "border-amber-500/30" : "border-emerald-500/30"} ${algumaCoisa ? "bg-background/30" : "bg-background/10 opacity-60"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{b.nome}</span>
                        <Badge variant="outline" className={`text-[9px] ${b.transito ? "border-amber-500/40 text-amber-300" : "border-emerald-500/40 text-emerald-300"}`}>
                          {b.transito ? "Trânsito" : "Consolida"}
                        </Badge>
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-emerald-400/80">+ entradas ({b.entradasQtd})</span>
                          <span className="tabular-nums text-emerald-400">R$ {fmtBRL(b.entradas)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-red-400/80">− saídas ({b.saidasQtd})</span>
                          <span className="tabular-nums text-red-400">R$ {fmtBRL(b.saidas)}</span>
                        </div>
                        {b.depositosATM > 0 && (
                          <div className="flex justify-between text-amber-400/90 border-t border-border/40 pt-0.5 mt-0.5">
                            <span>↳ depósito ATM (dinheiro)</span>
                            <span className="tabular-nums">R$ {fmtBRL(b.depositosATM)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* BLOCO 3: DUPLA CONFIRMAÇÃO DO CAIXA FÍSICO */}
          <Card className="border-2 border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Banknote className="w-4 h-4 text-amber-400" />
                Caixa físico — dupla confirmação
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

                {/* ESPERADO */}
                <div className="rounded-md border border-card-border bg-background/30 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">Sistema (esperado)</div>
                  <div className="text-2xl font-bold tabular-nums text-amber-400">R$ {fmtBRL(resp.esperadoCaixa)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1.5 space-y-0.5">
                    <div>+ Trinks dinheiro: R$ {fmtBRL(resp.trinks.dinheiro)}</div>
                    <div>− Depósito ATM: R$ {fmtBRL(resp.depositosATMDia)}</div>
                  </div>
                </div>

                {/* CONTADO */}
                <div className="rounded-md border border-card-border bg-background/30 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">Você contou no caixa</div>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={contadoStr}
                    onChange={e => setContadoStr(e.target.value.replace(/[^\d.,]/g, ""))}
                    disabled={fechado}
                    className="text-2xl font-bold h-12 text-center tabular-nums"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1.5">
                    Conte cédulas + moedas + sangrias do dia
                  </div>
                </div>

                {/* DIFERENÇA */}
                <div className={`rounded-md border-2 p-3 ${diferenca === null ? "border-card-border/40 bg-background/30"
                  : Math.abs(diferenca) < 0.01 ? "border-emerald-500/50 bg-emerald-500/10"
                  : diferenca > 0 ? "border-blue-500/50 bg-blue-500/10"
                  : "border-red-500/50 bg-red-500/10"}`}>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">Diferença</div>
                  {diferenca === null ? (
                    <div className="text-2xl font-bold text-muted-foreground">—</div>
                  ) : (
                    <>
                      <div className={`text-2xl font-bold tabular-nums ${Math.abs(diferenca) < 0.01 ? "text-emerald-400"
                        : diferenca > 0 ? "text-blue-400"
                        : "text-red-400"}`}>
                        {diferenca >= 0 ? "+" : ""}R$ {fmtBRL(diferenca)}
                      </div>
                      <div className="text-[10px] mt-1.5">
                        {Math.abs(diferenca) < 0.01 ? "✅ Bate certinho" :
                         diferenca > 0 ? "📈 Sobrou caixa — investigar (entrada não registrada?)" :
                         "🚨 Faltou caixa — vazamento ou troco perdido"}
                      </div>
                    </>
                  )}
                </div>

              </div>

              {/* Observação + ações */}
              <div className="mt-3 space-y-2">
                <Textarea
                  value={obs}
                  onChange={e => setObs(e.target.value)}
                  placeholder="Observação (opcional): justifique sobra/falta, troco perdido, sangria pra despesa pequena, etc."
                  rows={2}
                  disabled={fechado}
                  className="text-xs"
                />
                <div className="flex justify-end gap-2">
                  {fechado ? (
                    <Button type="button" variant="outline" onClick={reabrir}>
                      <Unlock className="w-3 h-3 mr-1.5" /> Reabrir dia
                    </Button>
                  ) : (
                    <Button type="button" onClick={salvar} disabled={contado === null || salvando}>
                      <Lock className="w-3 h-3 mr-1.5" /> {salvando ? "Salvando…" : "Fechar dia"}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* BLOCO 4: HISTÓRICO DO MÊS */}
          {hist && hist.fechamentos.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <Calendar className="w-4 h-4 text-cyan-400" />
                  Histórico — {mes}
                  <Badge variant="outline" className="text-[10px]">{hist.total} dias fechados</Badge>
                  <span className={`ml-auto text-xs tabular-nums font-semibold ${Math.abs(hist.totalDif) < 1 ? "text-emerald-400" : hist.totalDif > 0 ? "text-blue-400" : "text-red-400"}`}>
                    Acumulado: {hist.totalDif >= 0 ? "+" : ""}R$ {fmtBRL(hist.totalDif)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-1.5">
                  {hist.fechamentos.map(f => {
                    const cor = Math.abs(f.diferenca) < 0.01 ? "border-emerald-500/40 bg-emerald-500/10"
                              : Math.abs(f.diferenca) <= 5     ? "border-amber-500/40 bg-amber-500/10"
                              : "border-red-500/40 bg-red-500/10";
                    const ativo = f.data === data;
                    return (
                      <button
                        key={f.data} type="button"
                        onClick={() => setData(f.data)}
                        className={`rounded border p-1.5 text-[10px] hover:opacity-80 ${cor} ${ativo ? "ring-2 ring-foreground" : ""}`}
                      >
                        <div className="font-medium">{new Date(f.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
                        <div className="tabular-nums text-[9px]">{f.diferenca >= 0 ? "+" : ""}R$ {fmtBRL(Math.abs(f.diferenca))}</div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

        </>
      )}
    </div>
  );
}
