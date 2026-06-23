// Caixa do Dia — Conferência D+1 (v53).
// Vendas do dia (por forma e por tipo) × o que caiu no Itaú: cartão liquida no
// dia útil seguinte (REDE AT=crédito, DB=débito), PIX no mesmo dia. Esperado é
// líquido (menos a taxa da maquininha). Botão "Caixa bate / não bate" + justif.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, RefreshCw, TrendingUp } from "lucide-react";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface Linha { forma: string; vendido: number; taxaPct: number; esperadoLiquido: number; caiu: number; diferenca: number; bate: boolean; }
interface Resp {
  ok: boolean; data: string; dataMais1: string; temVenda: boolean;
  vendido: { credito: number; debito: number; pix: number; dinheiro: number; plano: number; outros: number };
  porTipo: { servico: number; produto: number; pacote: number };
  linhas: Linha[]; todasBatem: boolean; taxaPct: number; tolerancia: number;
  fechamento: null | { data: string; status: "bate" | "nao_bate"; justificativa: string; fechadoEm: string };
}

function fmt(v: number): string { return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function hojeYMD(): string { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function addDias(ymd: string, n: number): string { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function labelDia(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  const dias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return `${dias[d.getDay()]}, ${d.toLocaleDateString("pt-BR")}`;
}

export default function CaixaDia() {
  const [data, setData] = useState<string>(hojeYMD());
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [justif, setJustif] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/caixa-dia/conferencia/${data}`);
      const j: Resp = await r.json();
      if (j.ok) { setResp(j); setJustif(j.fechamento?.justificativa || ""); }
    } finally { setLoading(false); }
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [data]);

  async function salvar(status: "bate" | "nao_bate") {
    setSalvando(true);
    try {
      await fetch(`${API_BASE}/api/caixa-dia/conferencia/${data}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, justificativa: justif }),
      });
      await carregar();
    } finally { setSalvando(false); }
  }

  const v = resp?.vendido;
  const t = resp?.porTipo;
  const pulouFds = resp ? addDias(resp.data, 1) !== resp.dataMais1 : false;

  return (
    <div className="space-y-5 max-w-[900px]">
      {/* Header + seletor de dia */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Caixa do Dia — Conferência</h2>
          <p className="text-sm text-muted-foreground">Vendas do dia × o que caiu no Itaú (cartão no dia útil seguinte, PIX no dia).</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setData(addDias(data, -1))}><ChevronLeft className="w-4 h-4" /></Button>
          <div className="px-3 py-1.5 rounded-md border border-border bg-card text-sm font-medium flex items-center gap-2 min-w-[190px] justify-center">
            <Calendar className="w-4 h-4 text-primary" /> {labelDia(data)}
          </div>
          <Button variant="outline" size="sm" onClick={() => setData(addDias(data, 1))} disabled={data >= hojeYMD()}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="ghost" size="sm" onClick={carregar} title="Recarregar"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      {loading && !resp && <div className="text-sm text-muted-foreground py-8 text-center">Carregando…</div>}

      {resp && !resp.temVenda && (
        <Card className="border-amber-500/30 bg-amber-500/5"><CardContent className="p-4 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <span>Sem vendas importadas para {labelDia(data)}. Importe o CSV Financeiro do mês (que inclua este dia) em <strong>Importar Trinks</strong>.</span>
        </CardContent></Card>
      )}

      {resp && resp.temVenda && (
        <>
          {/* Vendido no dia — por forma */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> Vendido no dia</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {[["💳 Crédito", v!.credito], ["💳 Débito", v!.debito], ["📲 PIX", v!.pix], ["💵 Dinheiro", v!.dinheiro], ["🔵 Plano", v!.plano]].map(([lbl, val]: any) => (
                  <div key={lbl} className="rounded border border-card-border/50 bg-background/30 p-2">
                    <div className="text-[10px] text-muted-foreground">{lbl}</div>
                    <div className="tabular-nums font-semibold">{fmt(val)}</div>
                  </div>
                ))}
              </div>
              {(t!.servico + t!.produto + t!.pacote) > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 flex gap-4 text-[11px] text-muted-foreground">
                  <span>Serviços: <strong className="text-foreground">{fmt(t!.servico)}</strong></span>
                  <span>Produtos: <strong className="text-foreground">{fmt(t!.produto)}</strong></span>
                  <span>Pacotes: <strong className="text-foreground">{fmt(t!.pacote)}</strong></span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Conferência D+1 */}
          <Card className={resp.todasBatem ? "border-emerald-500/40" : "border-red-500/40"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                Conferência — caiu no Itaú em <span className="text-primary">{labelDia(resp.dataMais1)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pulouFds && (
                <div className="mb-2 text-[11px] text-amber-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  A liquidação caiu após o fim de semana — pode incluir vendas do sábado junto. Confira antes de marcar.
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                    <th className="text-left py-1.5">Forma</th>
                    <th className="text-right py-1.5">Vendido</th>
                    <th className="text-right py-1.5">Esperado líq.</th>
                    <th className="text-right py-1.5">Caiu</th>
                    <th className="text-right py-1.5">Dif.</th>
                    <th className="text-right py-1.5">Status</th>
                  </tr></thead>
                  <tbody>
                    {resp.linhas.map(l => (
                      <tr key={l.forma} className="border-b border-border/30" data-testid={`conf-${l.forma}`}>
                        <td className="py-2">{l.forma}{l.taxaPct > 0 && <span className="text-[9px] text-muted-foreground"> −{l.taxaPct}%</span>}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(l.vendido)}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(l.esperadoLiquido)}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(l.caiu)}</td>
                        <td className={`py-2 text-right tabular-nums font-semibold ${Math.abs(l.diferenca) <= resp.tolerancia ? "text-muted-foreground" : l.diferenca < 0 ? "text-red-400" : "text-amber-400"}`}>{l.diferenca >= 0 ? "+" : ""}{fmt(l.diferenca)}</td>
                        <td className="py-2 text-right">{l.bate ? <span className="text-emerald-400">🟢 bate</span> : <span className="text-red-400">🔴 não</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Tolerância ±{fmt(resp.tolerancia)}. Crédito/Débito caem no dia útil seguinte; PIX no mesmo dia. Esperado já desconta a taxa da maquininha.</div>
            </CardContent>
          </Card>

          {/* Veredito + botões */}
          <Card className="bg-card border-card-border">
            <CardContent className="p-4 space-y-3">
              <div className={`text-center py-2 rounded-md font-semibold ${resp.todasBatem ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                {resp.todasBatem ? "✓ Tudo confere — o caixa bate" : "✗ Há divergência — confira e justifique"}
              </div>
              {!resp.todasBatem && (
                <Textarea value={justif} onChange={e => setJustif(e.target.value)} rows={2} placeholder="O que está faltando / justificativa da divergência…" className="text-sm" data-testid="conf-justificativa" />
              )}
              <div className="flex gap-2">
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={salvando} onClick={() => salvar("bate")} data-testid="btn-bate">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Caixa bate
                </Button>
                <Button variant="outline" className="flex-1 border-red-500/40 text-red-400 hover:bg-red-500/10" disabled={salvando} onClick={() => salvar("nao_bate")} data-testid="btn-nao-bate">
                  <AlertCircle className="w-4 h-4 mr-1.5" /> Caixa não bate
                </Button>
              </div>
              {resp.fechamento && (
                <div className={`text-[11px] text-center ${resp.fechamento.status === "bate" ? "text-emerald-400" : "text-red-400"}`} data-testid="conf-status-salvo">
                  Marcado como <strong>{resp.fechamento.status === "bate" ? "caixa bate" : "caixa não bate"}</strong> em {new Date(resp.fechamento.fechadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  {resp.fechamento.justificativa && <> · "{resp.fechamento.justificativa}"</>}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
