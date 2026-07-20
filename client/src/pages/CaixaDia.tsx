// Caixa do Dia — Conferência D+1 (v53).
// Vendas do dia (por forma e por tipo) × o que caiu no Itaú: cartão liquida no
// dia útil seguinte (REDE AT=crédito, DB=débito), PIX no mesmo dia. Esperado é
// líquido (menos a taxa da maquininha). Botão "Caixa bate / não bate" + justif.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, RefreshCw, TrendingUp, Landmark, Save, MessageSquare, Trash2, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/authStore";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface Linha { forma: string; vendido: number; taxaPct: number; esperadoLiquido: number; caiu: number; diferenca: number; bate: boolean; }
interface Resp {
  ok: boolean; data: string; dataMais1: string; temVenda: boolean;
  fonteVenda: "trinks" | "csv" | "csv-caixa" | null; trinks429: boolean; qtdVendas: number;
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

      {/* Conciliação bancária do ÚLTIMO caixa fechado (pedido do dono) */}
      <ConciliacaoUltimoCaixa />

      {/* Observações / problemas do caixa */}
      <ObservacoesCaixa />

      {/* v82: fechamentos diários (Trinks/email) pra conferir */}
      <FechamentosDiarios onConferir={(dt) => setData(dt)} />

      {/* v86: caixa em dinheiro + débitos do mês */}
      <CaixaDinheiroMes />

      {loading && !resp && <div className="text-sm text-muted-foreground py-8 text-center">Carregando…</div>}

      {resp && !resp.temVenda && (
        <Card className="border-amber-500/30 bg-amber-500/5"><CardContent className="p-4 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <span>Sem vendas importadas para {labelDia(data)}. Importe o CSV Financeiro do mês (que inclua este dia) em <strong>Importar Trinks</strong>.</span>
        </CardContent></Card>
      )}

      {resp && resp.temVenda && (
        <>
          {/* badge de fonte / aviso 429 */}
          <div className="flex items-center gap-2 text-[11px]" data-testid="caixa-fonte">
            {resp.fonteVenda === "trinks" ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">● Trinks ao vivo</span>
            ) : resp.fonteVenda === "csv-caixa" ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30">● CSV Caixa</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30">● CSV importado</span>
            )}
            {resp.trinks429 && (resp.fonteVenda === "csv" || resp.fonteVenda === "csv-caixa") && (
              <span className="text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Trinks indisponível (429) agora — usando o CSV importado.</span>
            )}
          </div>
          {resp.fonteVenda === "csv-caixa" && (
            <div className="text-[10px] text-amber-600/80 -mt-1">ℹ PIX vem da coluna "Outros" do Caixa (no Trinks o PIX é lançado ali) — pode incluir outras formas além de PIX.</div>
          )}

          {/* Vendido no dia — por forma */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-600" /> Vendido no dia</CardTitle></CardHeader>
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
                <div className="mb-2 text-[11px] text-amber-600 flex items-start gap-1.5">
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
                        <td className={`py-2 text-right tabular-nums font-semibold ${Math.abs(l.diferenca) <= resp.tolerancia ? "text-muted-foreground" : l.diferenca < 0 ? "text-red-600" : "text-amber-600"}`}>{l.diferenca >= 0 ? "+" : ""}{fmt(l.diferenca)}</td>
                        <td className="py-2 text-right">{l.bate ? <span className="text-emerald-600">🟢 bate</span> : <span className="text-red-600">🔴 não</span>}</td>
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
              <div className={`text-center py-2 rounded-md font-semibold ${resp.todasBatem ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
                {resp.todasBatem ? "✓ Tudo confere — o caixa bate" : "✗ Há divergência — confira e justifique"}
              </div>
              {!resp.todasBatem && (
                <Textarea value={justif} onChange={e => setJustif(e.target.value)} rows={2} placeholder="O que está faltando / justificativa da divergência…" className="text-sm" data-testid="conf-justificativa" />
              )}
              <div className="flex gap-2">
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={salvando} onClick={() => salvar("bate")} data-testid="btn-bate">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Caixa bate
                </Button>
                <Button variant="outline" className="flex-1 border-red-500/40 text-red-600 hover:bg-red-500/10" disabled={salvando} onClick={() => salvar("nao_bate")} data-testid="btn-nao-bate">
                  <AlertCircle className="w-4 h-4 mr-1.5" /> Caixa não bate
                </Button>
              </div>
              {resp.fechamento && (
                <div className={`text-[11px] text-center ${resp.fechamento.status === "bate" ? "text-emerald-600" : "text-red-600"}`} data-testid="conf-status-salvo">
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

// ─── v83: Fechamentos do mês (email Trinks) + calculadora por forma ──────────
// Observações / problemas do caixa — log com autor e data.
function ObservacoesCaixa() {
  const user = useAuth((s) => s.user);
  const [lista, setLista] = useState<any[]>([]);
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<"problema" | "observacao">("problema");
  const [salvando, setSalvando] = useState(false);
  async function carregar() { try { const r = await fetch(`${API_BASE}/api/caixa-observacoes`); const j = await r.json(); if (j.ok) setLista(j.observacoes || []); } catch { /* */ } }
  useEffect(() => { carregar(); }, []);
  async function adicionar() {
    if (!texto.trim()) return;
    setSalvando(true);
    try { await fetch(`${API_BASE}/api/caixa-observacoes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto, tipo, autor: user?.nome }) }); setTexto(""); await carregar(); }
    finally { setSalvando(false); }
  }
  async function resolver(id: string, resolvido: boolean) { await fetch(`${API_BASE}/api/caixa-observacoes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolvido }) }); await carregar(); }
  async function remover(id: string) { if (!confirm("Remover esta observação?")) return; await fetch(`${API_BASE}/api/caixa-observacoes/${id}`, { method: "DELETE" }); await carregar(); }
  const abertos = lista.filter(o => !o.resolvido);
  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" />Observações / Problemas do caixa {abertos.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">{abertos.length} em aberto</span>}</CardTitle>
        <p className="text-xs text-muted-foreground">Registre qualquer problema do caixa (divergência, falta, erro, etc.) — fica gravado com quem escreveu e quando.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border p-2 space-y-2">
          <div className="inline-flex rounded-md border overflow-hidden text-xs">
            <button type="button" onClick={() => setTipo("problema")} className={`px-2.5 py-1 flex items-center gap-1 ${tipo === "problema" ? "bg-red-500 text-white" : "bg-background"}`}><AlertTriangle className="w-3 h-3" />Problema</button>
            <button type="button" onClick={() => setTipo("observacao")} className={`px-2.5 py-1 border-l ${tipo === "observacao" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Observação</button>
          </div>
          <Textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} placeholder="Descreva o problema ou a observação..." className="text-sm" />
          <div className="flex justify-end"><Button size="sm" onClick={adicionar} disabled={salvando || !texto.trim()}>{salvando ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}Registrar</Button></div>
        </div>
        {lista.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">Nenhuma observação registrada.</p>
        ) : (
          <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
            {lista.map(o => (
              <div key={o.id} className={`flex items-start gap-2 rounded-md border p-2 text-sm ${o.resolvido ? "opacity-60" : o.tipo === "problema" ? "border-red-500/30 bg-red-500/5" : ""}`}>
                <div className="flex-shrink-0 mt-0.5">{o.tipo === "problema" ? <AlertTriangle className="w-4 h-4 text-red-500" /> : <MessageSquare className="w-4 h-4 text-muted-foreground" />}</div>
                <div className="flex-1 min-w-0">
                  <div className={o.resolvido ? "line-through" : ""}>{o.texto}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{o.autor || "—"} · {(o.data || "").split("-").reverse().join("/")}{o.resolvido ? " · ✓ resolvido" : ""}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => resolver(o.id, !o.resolvido)}>{o.resolvido ? "Reabrir" : "Resolver"}</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-1.5 text-red-500" onClick={() => remover(o.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Conciliação bancária do ÚLTIMO caixa fechado (checklist do dono).
function ConciliacaoUltimoCaixa() {
  const user = useAuth((s) => s.user);
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  async function carregar() {
    const r = await fetch(`${API_BASE}/api/caixa-dia/conciliacao/ultimo`);
    const j = await r.json();
    if (!j.ok) return;
    setD(j);
    const c = j.conciliacao;
    const gap = (vend: number, caiu: number) => Math.max(0, Math.round((vend - caiu) * 100) / 100);
    setF(c ? {
      credito: c.credito, debito: c.debito, pix: c.pix, dinheiro: c.dinheiro,
      planosQtd: c.planosQtd, infinitepay: c.infinitepay,
      quemFechou: c.quemFechou || "", quemConferiu: c.quemConferiu || "", obs: c.obs || "",
    } : {
      credito: { bateu: null, faltando: gap(j.vendido.credito, j.caiuItau.credito) },
      debito: { bateu: null, faltando: gap(j.vendido.debito, j.caiuItau.debito) },
      pix: { bateu: null, valor: j.vendido.pix },
      dinheiro: { bateu: null, valor: j.cashDrawer?.recebido ?? j.vendido.dinheiro },
      planosQtd: j.planosQtd,
      infinitepay: { teve: (j.infinitepay?.total || 0) > 0, quem: (j.infinitepay?.itens || []).map((x: any) => x.descricao).join("; ").slice(0, 200), valor: j.infinitepay?.total || 0 },
      quemFechou: "", quemConferiu: user?.nome || "", obs: "",
    });
    setSalvo(!!c);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);
  if (!d || !f) return null;

  const setForma = (k: string, patch: any) => { setF({ ...f, [k]: { ...f[k], ...patch } }); setSalvo(false); };
  async function salvar() {
    setSalvando(true);
    try {
      await fetch(`${API_BASE}/api/caixa-dia/conciliacao/${d.data}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f),
      });
      setSalvo(true);
    } finally { setSalvando(false); }
  }

  const Toggle = ({ on, onSet }: { on: boolean | null; onSet: (v: boolean) => void }) => (
    <div className="inline-flex rounded-md border overflow-hidden text-xs">
      <button type="button" onClick={() => onSet(true)} className={`px-2 py-0.5 ${on === true ? "bg-emerald-500 text-white" : "bg-background"}`}>bateu</button>
      <button type="button" onClick={() => onSet(false)} className={`px-2 py-0.5 border-l ${on === false ? "bg-red-500 text-white" : "bg-background"}`}>não</button>
    </div>
  );
  const FormaLinha = ({ label, k, vendido, caiu }: { label: string; k: string; vendido: number; caiu: number }) => (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0 flex-wrap">
      <div className="text-sm font-medium min-w-[80px]">{label}</div>
      <div className="text-xs text-muted-foreground tabular-nums">vendido R$ {fmt(vendido)} · caiu R$ {fmt(caiu)}</div>
      <div className="flex items-center gap-2">
        <Toggle on={f[k].bateu} onSet={v => setForma(k, { bateu: v })} />
        {f[k].bateu === false && (
          <div className="flex items-center gap-1"><span className="text-[10px] text-muted-foreground">faltou R$</span>
            <Input type="number" step="0.01" value={f[k].faltando ?? 0} onChange={e => setForma(k, { faltando: Number(e.target.value) || 0 })} className="w-24 h-7 text-right text-xs" /></div>
        )}
      </div>
    </div>
  );

  return (
    <Card className="rounded-2xl border-2 border-primary/40 ring-1 ring-white/10 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">
          <Landmark className="w-3.5 h-3.5" />Conciliação do último caixa · {labelDia(d.data)}
        </div>
        <div className="flex items-end justify-between flex-wrap gap-2 mt-1">
          <div className="text-2xl font-bold text-foreground tabular-nums">R$ {fmt(d.totalDia)}</div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div>{d.comandas} comandas · confira cada forma contra o banco</div>
            <div>{salvo ? <span className="text-emerald-500 font-semibold">✓ conferido</span> : <span className="text-amber-500 font-semibold">● pendente</span>}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl bg-muted/40 border border-border p-3">
          {d.fonteVendido === "api" || d.fonteVendido === "csv" ? (
            <>
              <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                Split por forma: {d.fonteVendido === "api" ? "API Trinks ao vivo (via Greco Metas, 0 token)" : "CSV Caixa importado"}
              </div>
              <FormaLinha label="Débito" k="debito" vendido={d.vendido.debito} caiu={d.caiuItau.debito} />
              <FormaLinha label="Crédito" k="credito" vendido={d.vendido.credito} caiu={d.caiuItau.credito} />
            </>
          ) : (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2.5 mb-1">
              <div className="text-xs font-semibold text-amber-500 flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5" />Só o total do dia (R$ {fmt(d.totalDia)}) — sem detalhe por forma</div>
              <p className="text-[11px] text-muted-foreground mt-1">A API da Trinks (via Greco Metas) não respondeu agora e não há CSV Caixa deste dia. Tente atualizar, ou importe o CSV de {labelDia(d.data)}. Você ainda pode lançar os valores na mão abaixo.</p>
            </div>
          )}
          {/* PIX */}
          <div className="flex items-center justify-between gap-2 py-1.5 border-b flex-wrap">
            <div className="text-sm font-medium min-w-[80px]">PIX</div>
            <div className="text-xs text-muted-foreground tabular-nums">vendido R$ {fmt(d.vendido.pix)} · caiu R$ {fmt(d.caiuItau.pix)}</div>
            <div className="flex items-center gap-1"><span className="text-[10px] text-muted-foreground">recebemos R$</span>
              <Input type="number" step="0.01" value={f.pix.valor ?? 0} onChange={e => setForma("pix", { valor: Number(e.target.value) || 0 })} className="w-28 h-7 text-right text-xs" /></div>
          </div>
          {/* Dinheiro */}
          <div className="flex items-center justify-between gap-2 py-1.5 flex-wrap">
            <div className="text-sm font-medium min-w-[80px]">Dinheiro</div>
            <div className="text-xs text-muted-foreground tabular-nums">caixa: recebido R$ {fmt(d.cashDrawer?.recebido || 0)} · saldo R$ {fmt(d.cashDrawer?.saldo || 0)}</div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1"><span className="text-[10px] text-muted-foreground">R$</span><Input type="number" step="0.01" value={f.dinheiro.valor ?? 0} onChange={e => setForma("dinheiro", { valor: Number(e.target.value) || 0 })} className="w-24 h-7 text-right text-xs" /></div>
              <Toggle on={f.dinheiro.bateu} onSet={v => setForma("dinheiro", { bateu: v })} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/40 border border-border p-3">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Clientes de plano (quantos)</label>
            <Input type="number" value={f.planosQtd ?? 0} onChange={e => { setF({ ...f, planosQtd: Number(e.target.value) || 0 }); setSalvo(false); }} className="h-8 mt-1 w-28" />
          </div>
          <div className="rounded-xl bg-muted/40 border border-border p-3">
            <label className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">InfinitePay — algum pagamento?</label>
            <div className="flex items-center gap-2 mt-1">
              <Toggle on={f.infinitepay.teve} onSet={v => { setF({ ...f, infinitepay: { ...f.infinitepay, teve: v } }); setSalvo(false); }} />
              {f.infinitepay.teve && <Input value={f.infinitepay.quem} onChange={e => { setF({ ...f, infinitepay: { ...f.infinitepay, quem: e.target.value } }); setSalvo(false); }} placeholder="quem / o quê" className="h-8 flex-1 text-xs" />}
            </div>
            {(d.infinitepay?.total || 0) > 0 && <p className="text-[10px] text-muted-foreground mt-1">Banco: R$ {fmt(d.infinitepay.total)} ({(d.infinitepay.itens || []).length} lançamento(s))</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className="text-[10px] uppercase text-muted-foreground">Quem fechou o caixa</label><Input value={f.quemFechou} onChange={e => { setF({ ...f, quemFechou: e.target.value }); setSalvo(false); }} placeholder="nome" className="h-8 mt-1" /></div>
          <div><label className="text-[10px] uppercase text-muted-foreground">Quem conferiu</label><Input value={f.quemConferiu} onChange={e => { setF({ ...f, quemConferiu: e.target.value }); setSalvo(false); }} placeholder="nome" className="h-8 mt-1" /></div>
        </div>
        <Textarea value={f.obs} onChange={e => { setF({ ...f, obs: e.target.value }); setSalvo(false); }} placeholder="Observações da conciliação..." rows={2} className="text-sm" />

        <div className="flex items-center justify-end gap-2">
          {d.conciliacao?.conferidoEm && <span className="text-[10px] text-muted-foreground">conferido em {new Date(d.conciliacao.conferidoEm).toLocaleString("pt-BR")}</span>}
          <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}{salvo ? "Salvo" : "Salvar conciliação"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FechamentosDiarios({ onConferir }: { onConferir: (data: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const mesAtual = hojeYMD().slice(0, 7);
  const [mes] = useState<string>(mesAtual);
  useEffect(() => {
    fetch(`${API_BASE}/api/caixa-dia-fechamentos?mes=${mes}`).then(r => r.json()).then(x => { if (x?.ok) setD(x); }).finally(() => setCarregando(false));
  }, [mes]);
  if (carregando || !d) return null;
  const c = d.calculadora || {};
  const fechamentos = d.fechamentos || [];
  const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const mesLabel = new Date(mes + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const formas = [
    { lbl: "PIX", v: c.pix, cor: "text-red-600" },
    { lbl: "Crédito", v: c.credito, cor: "text-violet-600" },
    { lbl: "Débito", v: c.debito, cor: "text-amber-600" },
    { lbl: "Dinheiro", v: c.dinheiro, cor: "text-emerald-600" },
    { lbl: "Planos (Clube)", v: c.planos, cor: "text-pink-400" },
  ];

  return (
    <div className="space-y-3">
      {/* CALCULADORA DO MÊS por forma */}
      <div className="rounded-2xl border-2 border-red-400/50 ring-1 ring-white/10 bg-card p-4" data-testid="calculadora-mes">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-[0.2em] text-red-600 font-semibold">Recebimentos · {mesLabel}</span>
          <span className="text-[10px] text-muted-foreground">fonte: Caixa Trinks</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {formas.map(f => (
            <div key={f.lbl} className="rounded-lg bg-muted/40 border border-border p-2.5">
              <div className={`text-[10px] uppercase tracking-wide ${f.cor} font-semibold`}>{f.lbl}</div>
              <div className="text-base font-bold text-foreground tabular-nums mt-0.5">R$ {fmt(f.v || 0)}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="text-[10px] text-emerald-600/70 uppercase tracking-wide">Receita do mês (oficial Trinks)</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">R$ {fmt(c.totalOficial > 0 ? c.totalOficial : c.totalCaixa)}</div>
          </div>
          <div className="text-right text-[10px] text-muted-foreground space-y-0.5">
            <div>Passou pelo caixa: <span className="text-foreground tabular-nums">R$ {fmt(c.totalCaixa || 0)}</span></div>
            {c.recorrente > 0 && <div>A conciliar (caixa parcial): <span className="text-amber-600/80 tabular-nums">R$ {fmt(c.recorrente)}</span></div>}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">Receita oficial = "Total do mês" do e-mail Trinks (bate com a Trinks). A diferença pro caixa = dias ainda não importados no CSV de Caixa. As formas acima são o que já entrou pelo caixa.</div>
      </div>

      {/* FECHAMENTOS por dia */}
      <div className="rounded-lg border border-card-border bg-card overflow-hidden" data-testid="fechamentos-diarios">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold">Fechamentos do mês ({fechamentos.length} dias)</span>
          <span className="text-[10px] text-muted-foreground">clique pra conferir o dia</span>
        </div>
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-muted-foreground border-b border-border/50 sticky top-0 bg-card">
              <tr>
                <th className="text-left p-2">Dia</th>
                <th className="text-right p-2">Fechamento Trinks</th>
                <th className="text-right p-2">Caiu no Itaú</th>
              </tr>
            </thead>
            <tbody>
              {fechamentos.map((f: any) => (
                <tr key={f.data} className="border-b border-border/20 hover:bg-muted/20 cursor-pointer" onClick={() => onConferir(f.data)} data-testid={`fech-${f.data}`}>
                  <td className="p-2 font-medium">{dm(f.data)}</td>
                  <td className="p-2 text-right tabular-nums font-semibold">R$ {fmt(f.fechamentoTrinks)}</td>
                  <td className="p-2 text-right tabular-nums">{f.caiuItau > 0 ? <span className="text-muted-foreground">R$ {fmt(f.caiuItau)}</span> : <span className="text-muted-foreground/40">aguardando extrato</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border/50">Fechamento Trinks = total oficial do e-mail. "Caiu no Itaú" preenche conforme você importa o extrato.</div>
      </div>
    </div>
  );
}

// ─── v86 Tier2: Caixa em dinheiro + débitos do mês (fonte: e-mail Trinks) ─────
function CaixaDinheiroMes() {
  const [d, setD] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const mes = hojeYMD().slice(0, 7);
  useEffect(() => {
    fetch(`${API_BASE}/api/caixa-dinheiro?mes=${mes}`).then(r => r.json()).then(x => { if (x?.ok) setD(x); }).finally(() => setCarregando(false));
  }, [mes]);
  if (carregando || !d || (d.dias || []).length === 0) return null;
  const t = d.totaisCaixa || {};
  const deb = d.debitoAtual || {};
  const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const mesLabel = new Date(mes + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const reconcOK = Math.abs((d.reconciliacao || 0) - (t.saldo || 0)) < 1;

  return (
    <div className="space-y-3">
      {/* Caixa em dinheiro */}
      <div className="rounded-2xl border-2 border-emerald-500/40 ring-1 ring-white/10 bg-card p-4" data-testid="caixa-dinheiro">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-600 font-semibold">Caixa em Dinheiro · {mesLabel}</span>
          <span className="text-[10px] text-muted-foreground">fonte: e-mail Trinks</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[["Recebido", t.recebido, "text-emerald-600"], ["Despesas", t.despesas, "text-red-600"], ["Sangria", t.sangria, "text-amber-600"], ["Saldo", t.saldo, "text-foreground"]].map(([lbl, v, cor]: any) => (
            <div key={lbl} className="rounded-lg bg-muted/40 border border-border p-2.5">
              <div className={`text-[10px] uppercase tracking-wide ${cor} font-semibold`}>{lbl}</div>
              <div className="text-base font-bold text-foreground tabular-nums mt-0.5">R$ {fmt(v || 0)}</div>
            </div>
          ))}
        </div>
        <div className={`text-[10px] mt-2 ${reconcOK ? "text-emerald-600/70" : "text-amber-600"}`}>
          {reconcOK ? "✓" : "⚠"} Reconciliação: Abertura + Recebido + Troco − Despesas − Sangria = R$ {fmt(d.reconciliacao || 0)} {reconcOK ? "(bate com o saldo)" : `(saldo informado: R$ ${fmt(t.saldo || 0)})`}
        </div>
        <details className="mt-2">
          <summary className="text-[11px] text-muted-foreground cursor-pointer">Ver por dia ({(d.dias || []).length} dias)</summary>
          <div className="overflow-x-auto max-h-[280px] overflow-y-auto mt-2">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground border-b border-border/50 sticky top-0 bg-card">
                <tr><th className="text-left p-1.5">Dia</th><th className="text-right p-1.5">Recebido</th><th className="text-right p-1.5">Despesas</th><th className="text-right p-1.5">Sangria</th><th className="text-right p-1.5">Saldo</th></tr>
              </thead>
              <tbody>
                {(d.dias || []).map((x: any) => (
                  <tr key={x.data} className="border-b border-border/20">
                    <td className="p-1.5 font-medium">{dm(x.data)}</td>
                    <td className="p-1.5 text-right tabular-nums">R$ {fmt(x.recebido || 0)}</td>
                    <td className="p-1.5 text-right tabular-nums text-red-600/80">{x.despesas ? `R$ ${fmt(x.despesas)}` : "—"}</td>
                    <td className="p-1.5 text-right tabular-nums text-amber-600/80">{x.sangria ? `R$ ${fmt(x.sangria)}` : "—"}</td>
                    <td className="p-1.5 text-right tabular-nums font-semibold">R$ {fmt(x.saldo || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {/* Débitos de clientes */}
      <div className="rounded-lg border border-card-border bg-card p-3" data-testid="debitos-clientes">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold">Débitos de clientes (em aberto)</span>
          {(deb.totalDebito || 0) === 0 ? (
            <span className="text-xs text-emerald-600">✓ Nenhum cliente em débito</span>
          ) : (
            <span className="text-xs text-red-600 tabular-nums">{deb.clientesEmDebito} cliente(s) · R$ {fmt(deb.totalDebito)} (serviços R$ {fmt(deb.servicosDebito)} + produtos R$ {fmt(deb.produtosDebito)})</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Valor que clientes ficaram devendo (fiado). Fonte: e-mail Trinks. Mostra o saldo do último dia do mês.</p>
      </div>
    </div>
  );
}
