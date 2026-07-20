import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2, ShoppingCart, Trash2, Pencil, Save, X as XIcon, Plus,
  Send, MessageCircle, CheckCircle2, Bot, CalendarClock, AlertTriangle,
  RefreshCw, Repeat, Wallet, CalendarDays, List as ListIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";

type Natureza = "fixo" | "variavel";
type Compra = {
  id: string; mes: string; data: string; valor: number; loja: string;
  categoria: string; natureza?: Natureza; descricao?: string; tipo: string; origem: string;
  telegramFrom?: string; confianca?: string; temFoto?: boolean;
};
const API_BASE = (globalThis as any).__API_BASE__ || "";
type Resp = {
  ok: boolean; mes: string; compras: Compra[];
  resumo: { total: number; count: number; fixo: number; variavel: number; categorias: { nome: string; total: number; count: number }[] };
  categorias: string[]; naturezaPadrao: Record<string, Natureza>;
};

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso: string) => (iso || "").split("-").reverse().join("/");

export default function Compras() {
  const { toast } = useToast();
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [mes, setMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("compras.selectedMes") || mesCorrente;
  });
  useEffect(() => { try { localStorage.setItem("compras.selectedMes", mes); } catch {} }, [mes]);

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ valor: "", loja: "", categoria: "", descricao: "", data: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [novo, setNovo] = useState({ valor: "", loja: "", categoria: "Produtos & Insumos", natureza: "" as "" | Natureza, descricao: "", data: "" });
  const [tg, setTg] = useState<{ configured: boolean; botUsername: string | null; webhookAtivo: boolean; grupoConectado: boolean } | null>(null);
  const [ativando, setAtivando] = useState(false);

  const naturezaPadrao = data?.naturezaPadrao || {};
  const natDe = (c: { natureza?: Natureza; categoria: string }): Natureza =>
    c.natureza || naturezaPadrao[c.categoria] || "variavel";

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/compras/${mes}`);
      const j: Resp = await r.json();
      if (j.ok) setData(j);
    } catch { /* */ } finally { setLoading(false); }
  };
  const carregarTg = async () => {
    try { const r = await authFetch(`/api/telegram/compras/status`); setTg(await r.json()); } catch { /* */ }
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);
  useEffect(() => { carregarTg(); }, []);

  const ativarGrupo = async () => {
    setAtivando(true);
    try {
      const r = await authFetch(`/api/telegram/compras/setup`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao ativar");
      toast({ title: "Grupo ativado!", description: `Adicione @${j.botUsername} ao seu grupo e mande uma foto.` });
      await carregarTg();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setAtivando(false); }
  };

  const iniciarEdit = (c: Compra) => {
    setEditId(c.id);
    setEdit({ valor: String(c.valor), loja: c.loja, categoria: c.categoria, descricao: c.descricao || "", data: c.data });
  };
  const salvarEdit = async (c: Compra) => {
    try {
      const r = await authFetch(`/api/compras/${mes}/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: Number(edit.valor.replace(",", ".")), loja: edit.loja, categoria: edit.categoria, descricao: edit.descricao, data: edit.data }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setEditId(null); await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const toggleNatureza = async (c: Compra) => {
    const nova: Natureza = natDe(c) === "fixo" ? "variavel" : "fixo";
    try {
      const r = await authFetch(`/api/compras/${mes}/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ natureza: nova }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const remover = async (c: Compra) => {
    if (!confirm(`Remover a compra de R$ ${fmtBRL(c.valor)} (${c.loja})?`)) return;
    try { await authFetch(`/api/compras/${mes}/${c.id}`, { method: "DELETE" }); await carregar(); }
    catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const adicionar = async () => {
    try {
      const r = await authFetch(`/api/compras/${mes}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: Number(novo.valor.replace(",", ".")), loja: novo.loja, categoria: novo.categoria, natureza: novo.natureza || undefined, descricao: novo.descricao, data: novo.data || undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setAddOpen(false); setNovo({ valor: "", loja: "", categoria: "Produtos & Insumos", natureza: "", descricao: "", data: "" });
      await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };

  const cats = data?.categorias || [];
  const total = data?.resumo.total || 0;
  const fixo = data?.resumo.fixo || 0;
  const variavel = data?.resumo.variavel || 0;
  const monthLabel = labelMesPtBR(mes);

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Header */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="w-4 h-4 text-primary" /> Compras do Mês
                <Badge variant="outline" className="text-xs">{monthLabel}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Comprovantes de PIX e notas mandados no grupo do Telegram — lidos por IA e registrados aqui. <strong>Não gasta token da Trinks.</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <MonthSelector selectedMes={mes} onChange={setMes} mesCorrente={mesCorrente} isMesCorrente={mes === mesCorrente} loading={loading} />
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="compras" className="space-y-6">
        <TabsList>
          <TabsTrigger value="compras"><ShoppingCart className="w-3.5 h-3.5 mr-1.5" />Compras</TabsTrigger>
          <TabsTrigger value="agenda"><CalendarClock className="w-3.5 h-3.5 mr-1.5" />Agenda de Pagamentos</TabsTrigger>
        </TabsList>

        {/* ─────────────────────────── COMPRAS ─────────────────────────── */}
        <TabsContent value="compras" className="space-y-6 mt-0">
          {addOpen && (
            <Card className="bg-card border-card-border">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end rounded-md border p-3 bg-muted/20">
                  <div><label className="text-[10px] text-muted-foreground">Valor</label><Input value={novo.valor} onChange={e => setNovo({ ...novo, valor: e.target.value })} placeholder="0,00" className="h-8" /></div>
                  <div className="col-span-2"><label className="text-[10px] text-muted-foreground">Loja / beneficiário</label><Input value={novo.loja} onChange={e => setNovo({ ...novo, loja: e.target.value })} className="h-8" /></div>
                  <div><label className="text-[10px] text-muted-foreground">Categoria</label>
                    <select value={novo.categoria} onChange={e => setNovo({ ...novo, categoria: e.target.value })} className="h-8 w-full rounded-md border bg-background text-xs px-2">
                      {cats.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[10px] text-muted-foreground">Tipo</label>
                    <select value={novo.natureza} onChange={e => setNovo({ ...novo, natureza: e.target.value as any })} className="h-8 w-full rounded-md border bg-background text-xs px-2">
                      <option value="">Auto ({naturezaPadrao[novo.categoria] === "fixo" ? "Fixo" : "Variável"})</option>
                      <option value="fixo">Fixo</option>
                      <option value="variavel">Variável</option>
                    </select>
                  </div>
                  <div><label className="text-[10px] text-muted-foreground">Data</label><Input type="date" value={novo.data} onChange={e => setNovo({ ...novo, data: e.target.value })} className="h-8" /></div>
                  <Button size="sm" onClick={adicionar} disabled={!(Number(novo.valor.replace(",", ".")) > 0)}><Save className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Setup do grupo do Telegram (só aparece se ainda não conectou) */}
          {tg && (!tg.webhookAtivo || !tg.grupoConectado) && (
            <Card className="bg-card border-primary/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0"><Bot className="w-5 h-5 text-primary" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Ativar o grupo de comprovantes</p>
                    {!tg.configured ? (
                      <p className="text-xs text-muted-foreground mt-1">O bot do Telegram não está configurado no servidor (falta <code>TELEGRAM_BOT_TOKEN</code>). Configure-o para usar este recurso.</p>
                    ) : (
                      <ol className="text-xs text-muted-foreground mt-1 space-y-1 list-decimal list-inside">
                        <li>Clique em <strong>Ativar</strong> abaixo {tg.webhookAtivo && <span className="text-emerald-500">(✓ já ativo)</span>}</li>
                        <li>Crie um grupo no Telegram e adicione o bot {tg.botUsername ? <strong>@{tg.botUsername}</strong> : ""}</li>
                        <li>Mande <code>/id</code> no grupo (o bot confirma) e depois a <strong>foto de um comprovante</strong> 📸</li>
                      </ol>
                    )}
                    {tg.grupoConectado && <p className="text-xs text-emerald-500 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Grupo conectado</p>}
                  </div>
                  {tg.configured && (
                    <Button size="sm" onClick={ativarGrupo} disabled={ativando}>
                      {ativando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Ativar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resumo: total + FIXO x VARIÁVEL */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-card border-card-border border-primary/40">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total do mês</p>
                <p className="text-2xl font-bold text-primary">R$ {fmtBRL(total)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{data?.resumo.count || 0} compra{(data?.resumo.count || 0) !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border border-red-500/40">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Custo fixo</p>
                <p className="text-2xl font-bold text-red-500">R$ {fmtBRL(fixo)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{total > 0 ? Math.round((fixo / total) * 100) : 0}% do mês</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border border-amber-500/40">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Custo variável</p>
                <p className="text-2xl font-bold text-amber-500">R$ {fmtBRL(variavel)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{total > 0 ? Math.round((variavel / total) * 100) : 0}% do mês</p>
              </CardContent>
            </Card>
            {(data?.resumo.categorias || []).slice(0, 1).map(c => (
              <Card key={c.nome} className="bg-card border-card-border">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground truncate">Maior categoria: {c.nome}</p>
                  <p className="text-xl font-bold">R$ {fmtBRL(c.total)}</p>
                  <Progress value={total > 0 ? (c.total / total) * 100 : 0} className="h-1.5 mt-1.5" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Lista */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" />Compras registradas — {monthLabel}</CardTitle>
                <Button size="sm" onClick={() => setAddOpen(v => !v)}><Plus className="w-4 h-4 mr-1" />Manual</Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Clique no selo <strong>Fixo/Variável</strong> de cada linha pra trocar. O padrão vem da categoria.</p>
            </CardHeader>
            <CardContent>
              {loading && !data ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : !data?.compras.length ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Nenhuma compra ainda neste mês. Mande a foto de um comprovante no grupo do Telegram ou clique em <strong>Manual</strong>.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-2">Data</th>
                        <th className="py-2 px-2">Loja / beneficiário</th>
                        <th className="py-2 px-2">Categoria</th>
                        <th className="py-2 px-2">Tipo</th>
                        <th className="py-2 px-2 text-right">Valor</th>
                        <th className="py-2 pl-2 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.compras.map(c => {
                        const ed = editId === c.id;
                        const nat = natDe(c);
                        return (
                          <tr key={c.id} className="border-b hover:bg-muted/5">
                            <td className="py-2 pr-2 whitespace-nowrap">
                              {ed ? <Input type="date" value={edit.data} onChange={e => setEdit({ ...edit, data: e.target.value })} className="h-7 w-32 text-xs" /> : dataBR(c.data)}
                            </td>
                            <td className="py-2 px-2">
                              {ed ? <Input value={edit.loja} onChange={e => setEdit({ ...edit, loja: e.target.value })} className="h-7 text-xs" /> : (
                                <div>
                                  <span className="font-medium">{c.loja}</span>
                                  {c.descricao && <div className="text-[10px] text-muted-foreground">{c.descricao}</div>}
                                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                    {c.origem === "telegram" && <Badge variant="outline" className="text-[9px] h-4 border-red-500/40 text-red-500 bg-red-500/10 gap-0.5"><Send className="w-2.5 h-2.5" />{c.telegramFrom ? `via ${c.telegramFrom}` : "Telegram"}</Badge>}
                                    {c.origem === "manual" && <Badge variant="outline" className="text-[9px] h-4">manual</Badge>}
                                    {c.tipo === "pix" && <Badge variant="outline" className="text-[9px] h-4">PIX</Badge>}
                                    {c.confianca === "baixa" && <Badge variant="outline" className="text-[9px] h-4 border-amber-500/40 text-amber-500">confira</Badge>}
                                    {c.temFoto && <a href={`${API_BASE}/api/compras/${mes}/${c.id}/foto`} target="_blank" rel="noreferrer" className="text-[9px] h-4 px-1 rounded border border-primary/40 text-primary hover:bg-primary/10 inline-flex items-center gap-0.5">📷 nota</a>}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2">
                              {ed ? (
                                <select value={edit.categoria} onChange={e => setEdit({ ...edit, categoria: e.target.value })} className="h-7 rounded-md border bg-background text-xs px-1">
                                  {cats.map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                              ) : <Badge variant="secondary" className="text-[10px]">{c.categoria}</Badge>}
                            </td>
                            <td className="py-2 px-2">
                              <button
                                type="button" onClick={() => toggleNatureza(c)} title="Clique para alternar fixo/variável"
                                className={`text-[10px] h-5 px-2 rounded-full border font-medium transition-colors ${nat === "fixo"
                                  ? "border-red-500/40 text-red-500 bg-red-500/10 hover:bg-red-500/20"
                                  : "border-amber-500/40 text-amber-500 bg-amber-500/10 hover:bg-amber-500/20"}`}
                              >{nat === "fixo" ? "Fixo" : "Variável"}</button>
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums font-semibold">
                              {ed ? <Input value={edit.valor} onChange={e => setEdit({ ...edit, valor: e.target.value })} className="h-7 w-24 text-right text-xs" /> : `R$ ${fmtBRL(c.valor)}`}
                            </td>
                            <td className="py-2 pl-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {ed ? (
                                  <>
                                    <Button size="sm" variant="default" className="h-7 px-2" onClick={() => salvarEdit(c)}><Save className="w-3 h-3" /></Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditId(null)}><XIcon className="w-3 h-3" /></Button>
                                  </>
                                ) : (
                                  <>
                                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => iniciarEdit(c)}><Pencil className="w-3 h-3" /></Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500" onClick={() => remover(c)}><Trash2 className="w-3 h-3" /></Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 font-semibold bg-muted/20">
                        <td className="py-2 pr-2" colSpan={4}>Total</td>
                        <td className="py-2 px-2 text-right tabular-nums text-base text-primary">R$ {fmtBRL(total)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ──────────────────────── AGENDA DE PAGAMENTOS ──────────────────────── */}
        <TabsContent value="agenda" className="space-y-6 mt-0">
          <Agenda mes={mes} monthLabel={monthLabel} cats={cats} naturezaPadrao={naturezaPadrao} onPago={carregar} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════ Agenda de Pagamentos ═══════════════════════════
type ItemAgenda = {
  id: string; mes: string; vencimento: string; descricao: string; beneficiario: string;
  valor: number; categoria: string; natureza: Natureza; recorrente: boolean;
  status: "pendente" | "pago"; pagoEm?: string;
};
type AgendaResp = {
  ok: boolean; mes: string; hoje: string; itens: ItemAgenda[];
  resumo: { total: number; pendente: number; pago: number; atrasado: number; proximos: number; count: number; countPendente: number; countPago: number; countAtrasado: number };
  categorias: string[]; naturezaPadrao: Record<string, Natureza>;
};

function Agenda({ mes, monthLabel, cats, naturezaPadrao, onPago }: {
  mes: string; monthLabel: string; cats: string[]; naturezaPadrao: Record<string, Natureza>; onPago: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<AgendaResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [view, setView] = useState<"calendario" | "lista">(() => {
    if (typeof window === "undefined") return "calendario";
    return (localStorage.getItem("agenda.view") as any) || "calendario";
  });
  useEffect(() => { try { localStorage.setItem("agenda.view", view); } catch {} }, [view]);
  const catInicial = cats[0] || "Aluguel";
  const [novo, setNovo] = useState({ descricao: "", beneficiario: "", valor: "", vencimento: "", categoria: catInicial, natureza: "" as "" | Natureza, recorrente: true });

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/agenda/${mes}`);
      const j: AgendaResp = await r.json();
      if (j.ok) setData(j);
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);

  const adicionar = async () => {
    try {
      const r = await authFetch(`/api/agenda/${mes}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: novo.descricao, beneficiario: novo.beneficiario,
          valor: Number(novo.valor.replace(",", ".")), vencimento: novo.vencimento || undefined,
          categoria: novo.categoria, natureza: novo.natureza || undefined, recorrente: novo.recorrente,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setAddOpen(false); setNovo({ descricao: "", beneficiario: "", valor: "", vencimento: "", categoria: catInicial, natureza: "", recorrente: true });
      await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const marcarPago = async (it: ItemAgenda) => {
    if (!confirm(`Marcar "${it.descricao}" como pago? Isso lança R$ ${fmtBRL(it.valor)} nas Compras do mês.`)) return;
    try {
      const r = await authFetch(`/api/agenda/${mes}/${it.id}/pagar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      toast({ title: "Pago!", description: j.compraId ? "Lançado também nas Compras do mês." : "Marcado como pago." });
      await carregar(); onPago();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const desmarcar = async (it: ItemAgenda) => {
    try {
      await authFetch(`/api/agenda/${mes}/${it.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "pendente" }),
      });
      await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const remover = async (it: ItemAgenda) => {
    if (!confirm(`Remover "${it.descricao}" da agenda?`)) return;
    try { await authFetch(`/api/agenda/${mes}/${it.id}`, { method: "DELETE" }); await carregar(); }
    catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const gerarRecorrentes = async () => {
    setGerando(true);
    try {
      const r = await authFetch(`/api/agenda/${mes}/gerar-recorrentes`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      toast({ title: j.criados ? `${j.criados} pagamento(s) trazido(s)` : "Nada novo", description: j.criados ? "Recorrentes do mês passado adicionados como pendentes." : "Nenhum recorrente novo do mês anterior (ou já estavam aqui)." });
      await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setGerando(false); }
  };

  const r = data?.resumo;
  const hoje = data?.hoje || "";
  const itens = data?.itens || [];
  const statusVenc = (it: ItemAgenda): "pago" | "atrasado" | "hoje" | "pendente" => {
    if (it.status === "pago") return "pago";
    if (it.vencimento && it.vencimento < hoje) return "atrasado";
    if (it.vencimento && it.vencimento === hoje) return "hoje";
    return "pendente";
  };

  return (
    <>
      {/* Resumo da agenda */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-card border-card-border border-primary/40">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="w-3 h-3" />A pagar (pendente)</p>
            <p className="text-2xl font-bold text-primary">R$ {fmtBRL(r?.pendente || 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{r?.countPendente || 0} conta{(r?.countPendente || 0) !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card className={`bg-card border-card-border ${(r?.atrasado || 0) > 0 ? "border-red-500/50" : ""}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Atrasado</p>
            <p className={`text-2xl font-bold ${(r?.atrasado || 0) > 0 ? "text-red-500" : ""}`}>R$ {fmtBRL(r?.atrasado || 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{r?.countAtrasado || 0} vencida{(r?.countAtrasado || 0) !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border border-amber-500/40">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><CalendarClock className="w-3 h-3" />Vence em 7 dias</p>
            <p className="text-2xl font-bold text-amber-500">R$ {fmtBRL(r?.proximos || 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">próximos vencimentos</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border border-emerald-500/40">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Já pago no mês</p>
            <p className="text-2xl font-bold text-emerald-500">R$ {fmtBRL(r?.pago || 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{r?.countPago || 0} pagamento{(r?.countPago || 0) !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
      </div>

      {/* Form de novo pagamento */}
      {addOpen && (
        <Card className="bg-card border-card-border">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-8 gap-2 items-end rounded-md border p-3 bg-muted/20">
              <div className="col-span-2"><label className="text-[10px] text-muted-foreground">O que é (descrição)</label><Input value={novo.descricao} onChange={e => setNovo({ ...novo, descricao: e.target.value })} placeholder="Aluguel do ponto" className="h-8" /></div>
              <div className="col-span-2"><label className="text-[10px] text-muted-foreground">Beneficiário</label><Input value={novo.beneficiario} onChange={e => setNovo({ ...novo, beneficiario: e.target.value })} placeholder="Pra quem paga" className="h-8" /></div>
              <div><label className="text-[10px] text-muted-foreground">Valor</label><Input value={novo.valor} onChange={e => setNovo({ ...novo, valor: e.target.value })} placeholder="0,00" className="h-8" /></div>
              <div><label className="text-[10px] text-muted-foreground">Vencimento</label><Input type="date" value={novo.vencimento} onChange={e => setNovo({ ...novo, vencimento: e.target.value })} className="h-8" /></div>
              <div><label className="text-[10px] text-muted-foreground">Categoria</label>
                <select value={novo.categoria} onChange={e => setNovo({ ...novo, categoria: e.target.value })} className="h-8 w-full rounded-md border bg-background text-xs px-2">
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label className="text-[10px] text-muted-foreground">Tipo</label>
                <select value={novo.natureza} onChange={e => setNovo({ ...novo, natureza: e.target.value as any })} className="h-8 w-full rounded-md border bg-background text-xs px-2">
                  <option value="">Auto ({naturezaPadrao[novo.categoria] === "fixo" ? "Fixo" : "Variável"})</option>
                  <option value="fixo">Fixo</option>
                  <option value="variavel">Variável</option>
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-xs h-8 select-none cursor-pointer col-span-2 md:col-span-1">
                <input type="checkbox" checked={novo.recorrente} onChange={e => setNovo({ ...novo, recorrente: e.target.checked })} className="accent-primary" />
                <Repeat className="w-3 h-3" />Recorrente
              </label>
              <Button size="sm" onClick={adicionar} disabled={!novo.descricao.trim()}><Save className="w-4 h-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista da agenda */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" />Agenda de pagamentos — {monthLabel}</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-md border overflow-hidden">
                <button type="button" onClick={() => setView("calendario")} className={`text-xs h-8 px-2.5 inline-flex items-center gap-1 ${view === "calendario" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted/40"}`}><CalendarDays className="w-3.5 h-3.5" />Calendário</button>
                <button type="button" onClick={() => setView("lista")} className={`text-xs h-8 px-2.5 inline-flex items-center gap-1 border-l ${view === "lista" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted/40"}`}><ListIcon className="w-3.5 h-3.5" />Lista</button>
              </div>
              <Button size="sm" variant="outline" onClick={gerarRecorrentes} disabled={gerando} title="Trazer aluguel, luz, DAS, salário… do mês passado">
                {gerando ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}Recorrentes do mês passado
              </Button>
              <Button size="sm" onClick={() => setAddOpen(v => !v)}><Plus className="w-4 h-4 mr-1" />Novo</Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">O que a barbearia tem a pagar e quando. Ao marcar <strong>Pago</strong>, o valor entra automaticamente nas Compras do mês.</p>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : !itens.length ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhum pagamento agendado neste mês. Clique em <strong>Novo</strong> para adicionar, ou em <strong>Recorrentes do mês passado</strong> para trazer os fixos (aluguel, luz, salário…).
            </div>
          ) : view === "calendario" ? (
            <CalendarioPagamentos mes={mes} itens={itens} hoje={hoje} onMarcarPago={marcarPago} onDesmarcar={desmarcar} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Vencimento</th>
                    <th className="py-2 px-2">O que / beneficiário</th>
                    <th className="py-2 px-2">Categoria</th>
                    <th className="py-2 px-2">Tipo</th>
                    <th className="py-2 px-2 text-right">Valor</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 pl-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map(it => {
                    const st = statusVenc(it);
                    return (
                      <tr key={it.id} className={`border-b hover:bg-muted/5 ${st === "atrasado" ? "bg-red-500/5" : ""}`}>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          <span className={st === "atrasado" ? "text-red-500 font-medium" : st === "hoje" ? "text-amber-500 font-medium" : ""}>{dataBR(it.vencimento)}</span>
                        </td>
                        <td className="py-2 px-2">
                          <div>
                            <span className="font-medium">{it.descricao}</span>
                            {it.recorrente && <Badge variant="outline" className="ml-1.5 text-[9px] h-4 gap-0.5"><Repeat className="w-2.5 h-2.5" />mensal</Badge>}
                            {it.beneficiario && it.beneficiario !== "—" && <div className="text-[10px] text-muted-foreground">{it.beneficiario}</div>}
                          </div>
                        </td>
                        <td className="py-2 px-2"><Badge variant="secondary" className="text-[10px]">{it.categoria}</Badge></td>
                        <td className="py-2 px-2">
                          <span className={`text-[10px] h-5 px-2 rounded-full border font-medium inline-flex items-center ${it.natureza === "fixo" ? "border-red-500/40 text-red-500 bg-red-500/10" : "border-amber-500/40 text-amber-500 bg-amber-500/10"}`}>{it.natureza === "fixo" ? "Fixo" : "Variável"}</span>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold">R$ {fmtBRL(it.valor)}</td>
                        <td className="py-2 px-2">
                          {st === "pago" ? <Badge className="text-[10px] h-5 bg-emerald-500/15 text-emerald-500 border border-emerald-500/40 gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" />Pago {it.pagoEm ? dataBR(it.pagoEm) : ""}</Badge>
                            : st === "atrasado" ? <Badge className="text-[10px] h-5 bg-red-500/15 text-red-500 border border-red-500/40 gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />Atrasado</Badge>
                            : st === "hoje" ? <Badge className="text-[10px] h-5 bg-amber-500/15 text-amber-500 border border-amber-500/40">Vence hoje</Badge>
                            : <Badge variant="outline" className="text-[10px] h-5">Pendente</Badge>}
                        </td>
                        <td className="py-2 pl-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {it.status === "pago" ? (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => desmarcar(it)} title="Desfazer">Desfazer</Button>
                            ) : (
                              <Button size="sm" variant="default" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => marcarPago(it)}><CheckCircle2 className="w-3 h-3 mr-1" />Pago</Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500" onClick={() => remover(it)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 font-semibold bg-muted/20">
                    <td className="py-2 pr-2" colSpan={4}>Total a pagar (pendente)</td>
                    <td className="py-2 px-2 text-right tabular-nums text-base text-primary">R$ {fmtBRL(r?.pendente || 0)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ── Calendário do mês com todos os pagamentos ──────────────────────────────
function CalendarioPagamentos({ mes, itens, hoje, onMarcarPago, onDesmarcar }: {
  mes: string; itens: ItemAgenda[]; hoje: string;
  onMarcarPago: (it: ItemAgenda) => void; onDesmarcar: (it: ItemAgenda) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [y, m] = mes.split("-").map(Number);
  const primeiroDow = new Date(y, m - 1, 1).getDay();
  const diasNoMes = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < primeiroDow; i++) cells.push(null);
  for (let d = 1; d <= diasNoMes; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const ymd = (d: number) => `${mes}-${String(d).padStart(2, "0")}`;
  const porDia: Record<string, ItemAgenda[]> = {};
  for (const it of itens) {
    const key = (it.vencimento || "").slice(0, 10);
    if (!key.startsWith(mes)) continue;
    (porDia[key] ||= []).push(it);
  }
  const st = (it: ItemAgenda): "pago" | "atrasado" | "hoje" | "pendente" =>
    it.status === "pago" ? "pago" : it.vencimento < hoje ? "atrasado" : it.vencimento === hoje ? "hoje" : "pendente";
  const chipCls = (s: string) => s === "pago" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 line-through"
    : s === "atrasado" ? "bg-red-500/15 text-red-600 border-red-500/40"
    : s === "hoje" ? "bg-amber-500/15 text-amber-600 border-amber-500/40"
    : "bg-red-500/15 text-red-600 border-red-500/30";
  const totalDia = (arr: ItemAgenda[]) => arr.reduce((s, it) => s + (Number(it.valor) || 0), 0);
  const pendenteDia = (arr: ItemAgenda[]) => arr.filter(it => it.status !== "pago").reduce((s, it) => s + (Number(it.valor) || 0), 0);
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const selItens = sel ? (porDia[sel] || []) : [];

  return (
    <div className="space-y-3">
      {/* Legenda */}
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Atrasado</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />Vence hoje</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Pendente</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />Pago</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {weekdays.map(w => <div key={w} className="text-[10px] font-medium text-muted-foreground text-center py-1">{w}</div>)}
          </div>
          {/* Semanas */}
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((d, di) => {
                  if (d == null) return <div key={di} className="min-h-[92px] rounded-md bg-muted/10" />;
                  const key = ymd(d);
                  const arr = porDia[key] || [];
                  const isHoje = key === hoje;
                  const temAtrasado = arr.some(it => st(it) === "atrasado");
                  const pend = pendenteDia(arr);
                  return (
                    <button
                      key={di} type="button" onClick={() => setSel(sel === key ? null : key)}
                      className={`min-h-[92px] rounded-md border p-1 text-left flex flex-col gap-0.5 transition-colors hover:bg-muted/30
                        ${isHoje ? "ring-2 ring-primary border-primary/40" : ""}
                        ${temAtrasado ? "bg-red-500/5" : ""}
                        ${sel === key ? "bg-muted/40" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-semibold ${isHoje ? "text-primary" : ""}`}>{d}</span>
                        {pend > 0 && <span className="text-[9px] tabular-nums text-muted-foreground">R$ {fmtBRL(pend)}</span>}
                      </div>
                      {arr.slice(0, 3).map(it => (
                        <div key={it.id} title={`${it.descricao} — R$ ${fmtBRL(it.valor)}`}
                          className={`text-[9px] leading-tight px-1 py-0.5 rounded border truncate ${chipCls(st(it))}`}>
                          {it.descricao}
                        </div>
                      ))}
                      {arr.length > 3 && <span className="text-[9px] text-muted-foreground pl-0.5">+{arr.length - 3} mais</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detalhe do dia selecionado */}
      {sel && (
        <Card className="bg-muted/20 border-card-border">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-primary" />Pagamentos de {dataBR(sel)}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Total do dia: <strong className="text-foreground">R$ {fmtBRL(totalDia(selItens))}</strong></span>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setSel(null)}><XIcon className="w-3 h-3" /></Button>
              </div>
            </div>
            {!selItens.length ? (
              <p className="text-xs text-muted-foreground py-2">Nenhum pagamento neste dia.</p>
            ) : (
              <div className="space-y-1.5">
                {selItens.map(it => {
                  const s = st(it);
                  return (
                    <div key={it.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s === "pago" ? "bg-emerald-500" : s === "atrasado" ? "bg-red-500" : s === "hoje" ? "bg-amber-500" : "bg-red-500"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{it.descricao}{it.recorrente && <Badge variant="outline" className="ml-1.5 text-[9px] h-4 gap-0.5"><Repeat className="w-2.5 h-2.5" />mensal</Badge>}</div>
                        {it.beneficiario && it.beneficiario !== "—" && <div className="text-[10px] text-muted-foreground truncate">{it.beneficiario} · {it.categoria}</div>}
                      </div>
                      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">R$ {fmtBRL(it.valor)}</span>
                      {it.status === "pago" ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onDesmarcar(it)}>Desfazer</Button>
                      ) : (
                        <Button size="sm" variant="default" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => onMarcarPago(it)}><CheckCircle2 className="w-3 h-3 mr-1" />Pago</Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {!sel && <p className="text-[11px] text-muted-foreground text-center">Clique em um dia para ver os pagamentos e dar baixa.</p>}
    </div>
  );
}
