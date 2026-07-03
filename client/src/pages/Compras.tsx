import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, ShoppingCart, Trash2, Pencil, Save, X as XIcon, Plus,
  Send, MessageCircle, CheckCircle2, Bot,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";

type Compra = {
  id: string; mes: string; data: string; valor: number; loja: string;
  categoria: string; descricao?: string; tipo: string; origem: string;
  telegramFrom?: string; confianca?: string; temFoto?: boolean;
};
const API_BASE = (globalThis as any).__API_BASE__ || "";
type Resp = {
  ok: boolean; mes: string; compras: Compra[];
  resumo: { total: number; count: number; categorias: { nome: string; total: number; count: number }[] };
  categorias: string[];
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
  const [novo, setNovo] = useState({ valor: "", loja: "", categoria: "Produtos & Insumos", descricao: "", data: "" });
  const [tg, setTg] = useState<{ configured: boolean; botUsername: string | null; webhookAtivo: boolean; grupoConectado: boolean } | null>(null);
  const [ativando, setAtivando] = useState(false);

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
  const remover = async (c: Compra) => {
    if (!confirm(`Remover a compra de R$ ${fmtBRL(c.valor)} (${c.loja})?`)) return;
    try { await authFetch(`/api/compras/${mes}/${c.id}`, { method: "DELETE" }); await carregar(); }
    catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };
  const adicionar = async () => {
    try {
      const r = await authFetch(`/api/compras/${mes}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: Number(novo.valor.replace(",", ".")), loja: novo.loja, categoria: novo.categoria, descricao: novo.descricao, data: novo.data || undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setAddOpen(false); setNovo({ valor: "", loja: "", categoria: "Produtos & Insumos", descricao: "", data: "" });
      await carregar();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  };

  const cats = data?.categorias || [];
  const total = data?.resumo.total || 0;
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
              <Button size="sm" onClick={() => setAddOpen(v => !v)}><Plus className="w-4 h-4 mr-1" />Manual</Button>
            </div>
          </div>
        </CardHeader>
        {addOpen && (
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end rounded-md border p-3 bg-muted/20">
              <div><label className="text-[10px] text-muted-foreground">Valor</label><Input value={novo.valor} onChange={e => setNovo({ ...novo, valor: e.target.value })} placeholder="0,00" className="h-8" /></div>
              <div className="col-span-2"><label className="text-[10px] text-muted-foreground">Loja / beneficiário</label><Input value={novo.loja} onChange={e => setNovo({ ...novo, loja: e.target.value })} className="h-8" /></div>
              <div><label className="text-[10px] text-muted-foreground">Categoria</label>
                <select value={novo.categoria} onChange={e => setNovo({ ...novo, categoria: e.target.value })} className="h-8 w-full rounded-md border bg-background text-xs px-2">
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label className="text-[10px] text-muted-foreground">Data</label><Input type="date" value={novo.data} onChange={e => setNovo({ ...novo, data: e.target.value })} className="h-8" /></div>
              <Button size="sm" onClick={adicionar} disabled={!(Number(novo.valor.replace(",", ".")) > 0)}><Save className="w-4 h-4" /></Button>
            </div>
          </CardContent>
        )}
      </Card>

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

      {/* Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-card border-card-border border-primary/40">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total do mês</p>
            <p className="text-2xl font-bold text-primary">R$ {fmtBRL(total)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{data?.resumo.count || 0} compra{(data?.resumo.count || 0) !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        {(data?.resumo.categorias || []).slice(0, 3).map(c => (
          <Card key={c.nome} className="bg-card border-card-border">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground truncate">{c.nome}</p>
              <p className="text-xl font-bold">R$ {fmtBRL(c.total)}</p>
              <Progress value={total > 0 ? (c.total / total) * 100 : 0} className="h-1.5 mt-1.5" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lista */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" />Compras registradas — {monthLabel}</CardTitle>
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
                    <th className="py-2 px-2 text-right">Valor</th>
                    <th className="py-2 pl-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.compras.map(c => {
                    const ed = editId === c.id;
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
                                {c.origem === "telegram" && <Badge variant="outline" className="text-[9px] h-4 border-sky-500/40 text-sky-500 bg-sky-500/10 gap-0.5"><Send className="w-2.5 h-2.5" />{c.telegramFrom ? `via ${c.telegramFrom}` : "Telegram"}</Badge>}
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
                    <td className="py-2 pr-2" colSpan={3}>Total</td>
                    <td className="py-2 px-2 text-right tabular-nums text-base text-primary">R$ {fmtBRL(total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
