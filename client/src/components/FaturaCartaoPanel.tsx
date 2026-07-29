/**
 * FATURA DE CARTÃO — upload do PDF, conferência linha a linha e lançamento no caixa.
 *
 * O cartão conta pela FATURA, não pela compra avulsa: sobe o PDF (Santander/Itaú),
 * a IA devolve as linhas, o dono confere/ajusta e confirma. Aí cada linha vira uma
 * compra que entra no caixa NA DATA DO PAGAMENTO da fatura.
 *
 * Duas travas visíveis na tela: a soma das linhas × o valor pago (avisa antes de
 * confirmar se não fecha) e o selo "já registrada" nas linhas que casaram com uma
 * compra que veio do grupo do Telegram — essa não é criada de novo, é liberada.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, CreditCard, Upload, CheckCircle2, AlertTriangle, Undo2,
  Trash2, Save, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";

type Natureza = "fixo" | "variavel";
export type LinhaFatura = {
  id: string; data: string; estabelecimento: string; valor: number;
  categoria: string; natureza?: Natureza; parcela?: string;
  pessoal?: boolean; ignorar?: boolean;
  compraExistenteId?: string; compraExistenteMes?: string;
  compraGeradaId?: string; compraGeradaMes?: string;
};
type Conferencia = {
  somaLinhas: number; somaLancavel: number; totalPessoal: number; totalIgnorado: number;
  totalJaRegistrado: number; valorPago: number; diferenca: number; fecha: boolean;
  qtdLinhas: number; qtdJaRegistradas: number; qtdSemCategoria: number; avisos: string[];
};
export type Fatura = {
  id: string; mesCaixa: string; cartao: string; vencimento: string; dataPagamento: string;
  valorPago: number; totalFatura: number; linhas: LinhaFatura[];
  status: "rascunho" | "confirmada"; arquivoNome?: string; confirmadaEm?: string;
  conferencia: Conferencia;
};
type Aguardando = { id: string; mes: string; data: string; valor: number; loja: string; categoria: string };
type Resp = { ok: boolean; mes: string; faturas: Fatura[]; aguardando: Aguardando[]; categorias: string[] };

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso: string) => (iso || "").split("-").reverse().join("/");
const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export default function FaturaCartaoPanel({ mes, monthLabel, onMudou }: { mes: string; monthLabel: string; onMudou?: () => void }) {
  const { toast } = useToast();
  const [dados, setDados] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [form, setForm] = useState({ cartao: "Santander", vencimento: "", dataPagamento: "", valorPago: "" });
  const [file, setFile] = useState<File | null>(null);
  // Conferência em andamento: as linhas editadas ficam aqui até "Salvar conferência".
  const [edits, setEdits] = useState<Record<string, LinhaFatura[]>>({});

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/fatura-cartao/${mes}`);
      const j: Resp = await r.json();
      if (j.ok) { setDados(j); setEdits({}); }
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);

  const cats = dados?.categorias || [];
  const linhasDe = (f: Fatura) => edits[f.id] || f.linhas;
  const sujo = (f: Fatura) => !!edits[f.id];

  // Conferência local (enquanto o dono mexe, antes de salvar) — mesma regra do servidor.
  const confLocal = (f: Fatura) => {
    const linhas = linhasDe(f);
    let soma = 0, lancavel = 0, pessoal = 0, jaReg = 0, semCat = 0;
    for (const l of linhas) {
      const v = Number(l.valor) || 0;
      if (l.ignorar) continue;
      soma += v;
      if (l.pessoal) { pessoal += v; continue; }
      if (l.compraExistenteId) jaReg += v;
      if (!l.categoria || l.categoria === "Outros") semCat++;
      lancavel += v;
    }
    const dif = Math.round((soma - (Number(f.valorPago) || 0)) * 100) / 100;
    return { soma, lancavel, pessoal, jaReg, semCat, dif, fecha: (Number(f.valorPago) || 0) > 0 && Math.abs(dif) <= 0.5 };
  };

  const importar = async () => {
    if (!file) return;
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("cartao", form.cartao);
      if (form.vencimento) fd.append("vencimento", form.vencimento);
      fd.append("dataPagamento", form.dataPagamento || hojeISO());
      if (form.valorPago) fd.append("valorPago", form.valorPago);
      const r = await authFetch(`/api/fatura-cartao/importar`, { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "falha ao ler a fatura");
      toast({ title: "Fatura lida", description: `${j.fatura.linhas.length} lançamentos. Confira linha a linha antes de lançar.` });
      setFile(null);
      await carregar();
    } catch (e: any) {
      toast({ title: "Não consegui ler a fatura", description: e.message, variant: "destructive" });
    } finally { setEnviando(false); }
  };

  const patchLinha = (f: Fatura, id: string, patch: Partial<LinhaFatura>) => {
    setEdits(prev => ({ ...prev, [f.id]: (prev[f.id] || f.linhas).map(l => (l.id === id ? { ...l, ...patch } : l)) }));
  };

  const salvarConferencia = async (f: Fatura, extra?: Record<string, any>) => {
    setSalvando(f.id);
    try {
      const r = await authFetch(`/api/fatura-cartao/${mes}/${f.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linhas: linhasDe(f), ...extra }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      await carregar();
      return true;
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
      return false;
    } finally { setSalvando(null); }
  };

  const confirmar = async (f: Fatura) => {
    if (sujo(f) && !(await salvarConferencia(f))) return;
    const c = confLocal(f);
    if (!c.fecha) {
      const msg = (Number(f.valorPago) || 0) <= 0
        ? "Você não informou o valor pago da fatura, então não dá pra conferir a soma."
        : `A soma das linhas (R$ ${fmtBRL(c.soma)}) não bate com o valor pago (R$ ${fmtBRL(f.valorPago)}) — diferença de R$ ${fmtBRL(Math.abs(c.dif))}.`;
      if (!confirm(`${msg}\n\nLançar assim mesmo no caixa de ${monthLabel}?`)) return;
    }
    setSalvando(f.id);
    try {
      const r = await authFetch(`/api/fatura-cartao/${mes}/${f.id}/confirmar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmarMesmoAssim: true }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      const semPar = (j.estornosSemPar || []) as string[];
      toast({
        title: "Fatura lançada no caixa",
        description: `${j.criadas} lançamento(s) novo(s) e ${j.liberadas} compra(s) que já estavam esperando, na data ${dataBR(f.dataPagamento)}.`
          + (semPar.length ? ` Estorno sem par (não abateu nada): ${semPar.join(", ")}.` : ""),
      });
      await carregar(); onMudou?.();
    } catch (e: any) {
      toast({ title: "Erro ao lançar", description: e.message, variant: "destructive" });
    } finally { setSalvando(null); }
  };

  const reverter = async (f: Fatura) => {
    if (!confirm(`Desfazer o lançamento da fatura ${f.cartao}? As compras criadas por ela serão apagadas.`)) return;
    setSalvando(f.id);
    try {
      const r = await authFetch(`/api/fatura-cartao/${mes}/${f.id}/reverter`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      toast({ title: "Lançamento desfeito", description: `${j.removidas} apagada(s), ${j.devolvidas} voltou(aram) a esperar fatura.` });
      await carregar(); onMudou?.();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setSalvando(null); }
  };

  const apagar = async (f: Fatura) => {
    if (!confirm(`Apagar o rascunho da fatura ${f.cartao}?`)) return;
    try {
      const r = await authFetch(`/api/fatura-cartao/${mes}/${f.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "não foi possível apagar");
      await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };

  const aguardando = dados?.aguardando || [];
  const totalAguardando = useMemo(() => aguardando.reduce((s, a) => s + (Number(a.valor) || 0), 0), [aguardando]);

  return (
    <div className="space-y-6">
      {/* ─── Upload ─────────────────────────────────────────────────────── */}
      <Card className="bg-card border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />Importar fatura de cartão
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            O gasto no crédito só sai do caixa quando a fatura é paga. Suba o PDF, confira linha a linha e lance —
            as linhas entram no caixa na <strong>data do pagamento</strong>.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <div>
              <label className="text-[10px] text-muted-foreground">Cartão</label>
              <select value={form.cartao} onChange={e => setForm({ ...form, cartao: e.target.value })} className="h-9 w-full rounded-md border bg-background text-xs px-2">
                <option>Santander</option><option>Itaú</option><option>Outro</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Vencimento</label>
              <Input type="date" value={form.vencimento} onChange={e => setForm({ ...form, vencimento: e.target.value })} className="h-9" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Pagamento (entra no caixa)</label>
              <Input type="date" value={form.dataPagamento} onChange={e => setForm({ ...form, dataPagamento: e.target.value })} className="h-9" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Valor pago</label>
              <Input value={form.valorPago} onChange={e => setForm({ ...form, valorPago: e.target.value })} placeholder="0,00" className="h-9" />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-muted-foreground">PDF da fatura</label>
              <Input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} className="h-9 text-xs" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Button size="sm" onClick={importar} disabled={!file || enviando}>
              {enviando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              {enviando ? "Lendo a fatura…" : "Ler fatura"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              A leitura demora alguns segundos. Fatura com senha: salve uma cópia sem senha antes.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Compras esperando fatura ───────────────────────────────────── */}
      {aguardando.length > 0 && (
        <Card className="bg-card border-amber-500/40">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-500" /> No crédito, esperando a fatura
            </p>
            <p className="text-2xl font-bold text-amber-500">R$ {fmtBRL(totalAguardando)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {aguardando.length} compra(s) fora do caixa até a fatura ser importada:{" "}
              {aguardando.map(a => `${dataBR(a.data)} ${a.loja} R$ ${fmtBRL(a.valor)}`).join(" · ")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ─── Faturas do mês ─────────────────────────────────────────────── */}
      {loading && !dados ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !dados?.faturas.length ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          Nenhuma fatura importada com pagamento em {monthLabel}.
        </div>
      ) : dados.faturas.map(f => {
        const linhas = linhasDe(f);
        const c = confLocal(f);
        const confirmada = f.status === "confirmada";
        return (
          <Card key={f.id} className={`bg-card ${confirmada ? "border-emerald-500/40" : "border-card-border"}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />
                  {f.cartao} · venc {dataBR(f.vencimento)}
                  {confirmada
                    ? <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">lançada no caixa</Badge>
                    : <Badge variant="outline">rascunho</Badge>}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {!confirmada && sujo(f) && (
                    <Button size="sm" variant="outline" onClick={() => salvarConferencia(f)} disabled={salvando === f.id}>
                      <Save className="w-4 h-4 mr-1" />Salvar conferência
                    </Button>
                  )}
                  {!confirmada ? (
                    <>
                      <Button size="sm" onClick={() => confirmar(f)} disabled={salvando === f.id}>
                        {salvando === f.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                        Lançar no caixa
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => apagar(f)}><Trash2 className="w-4 h-4" /></Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => reverter(f)} disabled={salvando === f.id}>
                      <Undo2 className="w-4 h-4 mr-1" />Desfazer
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Conferência: soma × valor pago */}
              <div className={`rounded-md border p-3 ${c.fecha ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5"}`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Soma das linhas</p>
                    <p className="text-lg font-semibold">R$ {fmtBRL(c.soma)}</p>
                    <p className="text-[10px] text-muted-foreground">{linhas.length} lançamentos</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Valor pago</p>
                    <p className="text-lg font-semibold">R$ {fmtBRL(f.valorPago)}</p>
                    <p className="text-[10px] text-muted-foreground">pago em {dataBR(f.dataPagamento)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Diferença</p>
                    <p className={`text-lg font-semibold ${c.fecha ? "text-emerald-600" : "text-amber-600"}`}>R$ {fmtBRL(Math.abs(c.dif))}</p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      {c.fecha
                        ? <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> fecha com o pago</>
                        : <><AlertTriangle className="w-3 h-3 text-amber-600" /> {c.dif > 0 ? "soma acima do pago" : "falta linha pra fechar"}</>}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Vai pro caixa</p>
                    <p className="text-lg font-semibold text-primary">R$ {fmtBRL(c.lancavel)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {c.pessoal > 0 && <>R$ {fmtBRL(c.pessoal)} pessoal · </>}
                      {c.jaReg > 0 && <>R$ {fmtBRL(c.jaReg)} já registrado</>}
                      {c.pessoal <= 0 && c.jaReg <= 0 && "tudo é despesa da barbearia"}
                    </p>
                  </div>
                </div>
                {!confirmada && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    <label className="text-[10px] text-muted-foreground">Ajustar o valor pago</label>
                    <Input
                      defaultValue={f.valorPago ? String(f.valorPago) : ""}
                      placeholder="0,00"
                      className="h-7 w-32 text-xs"
                      onBlur={e => {
                        const v = Number(e.target.value.replace(/\./g, "").replace(",", "."));
                        if (Number.isFinite(v) && Math.abs(v - f.valorPago) > 0.001) salvarConferencia(f, { valorPago: v });
                      }}
                    />
                    {c.semCat > 0 && (
                      <span className="text-[11px] text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />{c.semCat} linha(s) em "Outros" — categorize pro custo sair certo
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Linhas */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-2">Data</th>
                      <th className="py-2 px-2">Estabelecimento</th>
                      <th className="py-2 px-2">Categoria</th>
                      <th className="py-2 px-2 text-right">Valor</th>
                      <th className="py-2 pl-2 text-right">Conferência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map(l => {
                      const fora = l.ignorar || l.pessoal;
                      return (
                        <tr key={l.id} className={`border-b hover:bg-muted/5 ${fora ? "opacity-50" : ""}`}>
                          <td className="py-1.5 pr-2 whitespace-nowrap text-xs">
                            {confirmada ? dataBR(l.data) : (
                              <Input type="date" value={l.data} onChange={e => patchLinha(f, l.id, { data: e.target.value })} className="h-7 w-32 text-xs" />
                            )}
                          </td>
                          <td className="py-1.5 px-2">
                            {confirmada ? l.estabelecimento : (
                              <Input value={l.estabelecimento} onChange={e => patchLinha(f, l.id, { estabelecimento: e.target.value })} className="h-7 text-xs" />
                            )}
                            {l.parcela && <Badge variant="outline" className="ml-1 text-[10px]">parcela {l.parcela}</Badge>}
                          </td>
                          <td className="py-1.5 px-2">
                            {confirmada ? <span className="text-xs">{l.categoria}</span> : (
                              <select
                                value={l.categoria}
                                onChange={e => patchLinha(f, l.id, { categoria: e.target.value })}
                                className={`h-7 w-full rounded-md border bg-background text-xs px-1 ${l.categoria === "Outros" ? "border-amber-500/60" : ""}`}
                              >
                                {cats.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                              </select>
                            )}
                          </td>
                          <td className={`py-1.5 px-2 text-right whitespace-nowrap font-medium ${Number(l.valor) < 0 ? "text-emerald-600" : ""}`}>
                            R$ {fmtBRL(l.valor)}
                          </td>
                          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                            <div className="flex items-center gap-1 justify-end flex-wrap">
                              {l.compraExistenteId && (
                                <Badge className="bg-sky-500/15 text-sky-600 border-sky-500/30 text-[10px]">já registrada</Badge>
                              )}
                              {!confirmada && (
                                <>
                                  <button
                                    onClick={() => patchLinha(f, l.id, { pessoal: !l.pessoal })}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${l.pessoal ? "bg-violet-500/15 text-violet-600 border-violet-500/40" : "text-muted-foreground"}`}
                                    title="Gasto pessoal: não vira despesa da barbearia"
                                  >pessoal</button>
                                  <button
                                    onClick={() => patchLinha(f, l.id, { ignorar: !l.ignorar })}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${l.ignorar ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                                    title="Não compõe esta fatura (pagamento anterior, saldo) — fica fora da soma"
                                  >fora da fatura</button>
                                </>
                              )}
                              {confirmada && l.pessoal && <Badge variant="outline" className="text-[10px]">pessoal</Badge>}
                              {confirmada && l.ignorar && <Badge variant="outline" className="text-[10px]">fora da fatura</Badge>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground">
                <strong>Já registrada</strong> = essa compra já entrou pelo grupo do Telegram e está esperando a fatura;
                ao lançar, ela é <em>liberada</em> (com a foto original), não duplicada.
                {" "}<strong>Pessoal</strong> sai da despesa da barbearia. <strong>Fora da fatura</strong> é o que não compõe o total
                (pagamento da fatura anterior, saldo) e fica fora da soma.
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
