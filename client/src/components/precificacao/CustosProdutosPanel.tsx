/**
 * Painel de gerenciamento de custos e preços de produtos.
 *
 * Versão "embedded" do CustosModal de Vendas Produtos — mesma lógica e
 * mesmos endpoints (/api/produtos/custos GET/PUT), mas sem overlay/Dialog
 * para ser usada como conteúdo de uma sub-aba dentro da página Precificação.
 *
 * Mostra cada produto com preço de compra, preço de venda (manual ou catálogo
 * Trinks) e margem percentual com cores semafóricas (<30% vermelho, <50%
 * amarelo, ≥50% verde).
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";

const API_BASE = (globalThis as any).__API_BASE__ || "";

type ProdutoCusto = {
  id: string;
  nome: string;
  categoria: string;
  custo: number;
  precoVenda: number;
  precoVendaCatalogo?: number;
  precoVendaObservado?: number;
  precoVendaManual?: number | null;
  atualizadoEm?: string;
};

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CustosProdutosPanel() {
  const { toast } = useToast();
  const [produtos, setProdutos] = useState<ProdutoCusto[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");
  const [edits, setEdits] = useState<Record<string, { custo?: string; precoVenda?: string }>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(`${API_BASE}/api/produtos/custos`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setProdutos(j.produtos || []);
      } catch (e: any) {
        toast({ title: "Erro ao carregar produtos", description: e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return produtos;
    return produtos.filter(p => p.nome.toLowerCase().includes(q) || (p.categoria || "").toLowerCase().includes(q));
  }, [produtos, busca]);

  const parse = (v: string) => Number(String(v).replace(",", ".")) || 0;
  const setEditCusto = (id: string, v: string) =>
    setEdits(e => ({ ...e, [id]: { ...(e[id] || {}), custo: v } }));
  const setEditVenda = (id: string, v: string) =>
    setEdits(e => ({ ...e, [id]: { ...(e[id] || {}), precoVenda: v } }));

  const salvarTudo = async () => {
    const items = Object.entries(edits).map(([id, ed]) => {
      const it: any = { id };
      if (ed.custo !== undefined) it.custo = parse(ed.custo);
      if (ed.precoVenda !== undefined) {
        it.precoVenda = ed.precoVenda.trim() === "" ? null : parse(ed.precoVenda);
      }
      return it;
    });
    if (items.length === 0) {
      toast({ title: "Nada para salvar" });
      return;
    }
    setSalvando(true);
    try {
      const r = await authFetch(`${API_BASE}/api/produtos/custos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      toast({ title: "Preços atualizados", description: `${j.count} produto(s)` });
      setProdutos(prev => prev.map(p => {
        const ed = edits[p.id];
        if (!ed) return p;
        const next: ProdutoCusto = { ...p, atualizadoEm: new Date().toISOString() };
        if (ed.custo !== undefined) next.custo = parse(ed.custo);
        if (ed.precoVenda !== undefined) {
          if (ed.precoVenda.trim() === "") {
            next.precoVendaManual = null;
            next.precoVenda = next.precoVendaCatalogo || next.precoVendaObservado || 0;
          } else {
            const novoVenda = parse(ed.precoVenda);
            next.precoVendaManual = novoVenda;
            next.precoVenda = novoVenda;
          }
        }
        return next;
      }));
      setEdits({});
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const editsCount = Object.keys(edits).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar produto por nome ou categoria..."
            className="pl-8"
          />
        </div>
        <Button onClick={salvarTudo} disabled={salvando || editsCount === 0}>
          {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Salvar {editsCount > 0 ? `(${editsCount})` : ""}
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 px-2">Produto</th>
                  <th className="py-2 px-2">Categoria</th>
                  <th className="py-2 px-2 text-right w-32">Preço compra</th>
                  <th className="py-2 px-2 text-right w-32">Preço venda</th>
                  <th className="py-2 px-2 text-right w-20">Margem</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(p => {
                  const ed = edits[p.id] || {};
                  const custoAtual = ed.custo !== undefined ? parse(ed.custo) : p.custo;
                  let vendaStr: string;
                  if (ed.precoVenda !== undefined) vendaStr = ed.precoVenda;
                  else if (p.precoVendaManual && p.precoVendaManual > 0) vendaStr = String(p.precoVendaManual);
                  else vendaStr = "";
                  const vendaAtual = vendaStr.trim() !== ""
                    ? parse(vendaStr)
                    : (p.precoVendaCatalogo || p.precoVendaObservado || p.precoVenda || 0);
                  const margem = vendaAtual > 0 ? ((vendaAtual - custoAtual) / vendaAtual) * 100 : 0;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium">{p.nome}</td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">{p.categoria || "—"}</td>
                      <td className="py-2 px-2 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={ed.custo !== undefined ? ed.custo : (p.custo || "")}
                          onChange={e => setEditCusto(p.id, e.target.value)}
                          className="w-24 h-8 text-right ml-auto"
                          placeholder="0,00"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={vendaStr}
                          onChange={e => setEditVenda(p.id, e.target.value)}
                          className="w-24 h-8 text-right ml-auto"
                          placeholder={p.precoVendaCatalogo ? `Trinks: ${p.precoVendaCatalogo.toFixed(2)}` : "0,00"}
                          title={p.precoVendaCatalogo ? `Preço do Trinks: R$ ${fmtBRL(p.precoVendaCatalogo)}` : ""}
                        />
                      </td>
                      <td className={`py-2 px-2 text-right tabular-nums text-xs ${custoAtual > 0 && vendaAtual > 0 ? (margem < 30 ? "text-red-600" : margem < 50 ? "text-yellow-600" : "text-green-600") : "text-muted-foreground"}`}>
                        {custoAtual > 0 && vendaAtual > 0 ? `${margem.toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground flex items-center justify-between">
        <span>{filtrados.length} produto(s) listado(s)</span>
        <span>Preço de venda em branco = usar o cadastrado no Trinks</span>
      </div>
    </div>
  );
}
