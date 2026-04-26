// v20: Card para gerenciar quais produtos NÃO entram no cálculo de comissão.
// Tipicamente bebidas, doces e snacks vendidos no balcão.
// O backend mantém um Set de IDs Trinks; toggle por produto ou aplicar sugestão.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Pencil, X, CheckCircle2, RefreshCw, Sparkles, Coffee } from "lucide-react";

interface ProdutoApi {
  id: string;
  nome: string;
  valorVenda: number;
  isSemComissao: boolean;
}

interface RespApi {
  ok: boolean;
  produtos: ProdutoApi[];
  ids: string[];
  sugestoes: string[];
  total: number;
  totalSemComissao: number;
}

const fmtBRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProdutosSemComissaoCard() {
  const [data, setData] = useState<RespApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState("");
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch("/api/produtos/sem-comissao");
      const j: RespApi = await r.json();
      if (j.ok) {
        setData(j);
        setDraft(new Set(j.ids));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const produtosFiltrados = useMemo(() => {
    if (!data) return [] as ProdutoApi[];
    const f = filtro.trim().toLowerCase();
    if (!f) return data.produtos;
    return data.produtos.filter(p => p.nome.toLowerCase().includes(f));
  }, [data, filtro]);

  function toggle(id: string) {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function aplicarSugestoes() {
    if (!data) return;
    setDraft(prev => {
      const next = new Set(prev);
      data.sugestoes.forEach(id => next.add(id));
      return next;
    });
    setFeedback({ type: "ok", msg: `${data.sugestoes.length} sugestões aplicadas (revise e salve).` });
    setTimeout(() => setFeedback(null), 4000);
  }

  function limparTudo() {
    setDraft(new Set());
  }

  function cancelar() {
    if (data) setDraft(new Set(data.ids));
    setEditing(false);
  }

  async function salvar() {
    setSaving(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/produtos/sem-comissao", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(draft) }),
      });
      const j = await r.json();
      if (j.ok) {
        setFeedback({ type: "ok", msg: `${j.total} produto(s) marcados como sem comissão.` });
        setEditing(false);
        await carregar();
      } else {
        setFeedback({ type: "err", msg: j.error || "Erro ao salvar" });
      }
    } catch (err: any) {
      setFeedback({ type: "err", msg: err.message });
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  const totalMarcadosDraft = draft.size;
  const dirty = useMemo(() => {
    if (!data) return false;
    if (data.ids.length !== draft.size) return true;
    for (const id of data.ids) if (!draft.has(id)) return true;
    return false;
  }, [data, draft]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Coffee className="w-4 h-4 text-orange-400" />
            Produtos sem comissão
            <Badge variant="outline" className="text-xs">v20</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={carregar} disabled={loading} className="h-8">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
            {!editing ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-8">
                <Pencil className="w-3 h-3 mr-1" />
                Editar
              </Button>
            ) : (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={salvar}
                  disabled={saving || !dirty}
                  className="h-8"
                >
                  {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                  Salvar
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelar} className="h-8">
                  <X className="w-3 h-3" />
                </Button>
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Itens marcados aqui não geram comissão para o profissional (mantêm bruto/líquido para rastreabilidade).
          Tipicamente bebidas, doces e snacks vendidos no balcão.
        </p>

        {data && (
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <Badge variant="secondary">{data.total} produto(s) cadastrados</Badge>
            <Badge variant="outline" className="border-orange-300 text-orange-300">
              {editing ? totalMarcadosDraft : data.totalSemComissao} sem comissão
            </Badge>
            {editing && data.sugestoes.length > 0 && (
              <Button variant="outline" size="sm" onClick={aplicarSugestoes} className="h-7">
                <Sparkles className="w-3 h-3 mr-1" />
                Aplicar sugestões automáticas ({data.sugestoes.length})
              </Button>
            )}
            {editing && totalMarcadosDraft > 0 && (
              <Button variant="ghost" size="sm" onClick={limparTudo} className="h-7 text-xs">
                Limpar todos
              </Button>
            )}
          </div>
        )}

        <Input
          placeholder="Filtrar por nome..."
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          className="mb-3 h-8 text-sm"
        />

        {feedback && (
          <div className={`mb-3 px-2 py-1 rounded text-xs ${feedback.type === "ok" ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" : "bg-red-500/10 text-red-300 border border-red-500/20"}`}>
            {feedback.type === "ok" && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
            {feedback.msg}
          </div>
        )}

        <div className="border rounded max-h-96 overflow-y-auto">
          {loading && !data ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : produtosFiltrados.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {filtro ? "Nenhum produto com esse filtro." : "Sem produtos cadastrados."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 px-3">Produto</th>
                  <th className="py-2 px-2 text-right">Preço</th>
                  <th className="py-2 px-2 text-center w-24">Sem comissão</th>
                </tr>
              </thead>
              <tbody>
                {produtosFiltrados.map(p => {
                  const marcado = editing ? draft.has(p.id) : p.isSemComissao;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 px-3">{p.nome}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                        R$ {fmtBRL(p.valorVenda)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <Switch
                          checked={marcado}
                          disabled={!editing}
                          onCheckedChange={() => toggle(p.id)}
                          data-testid={`switch-sem-comissao-${p.id}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
