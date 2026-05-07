// Drill-down: clicar numa categoria abre dialog com TODAS as transações
// daquela categoria no mês (bank + manual). Permite remover a categoria
// individualmente pra mover pra outro lugar.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Building2, FileText } from "lucide-react";

interface Item {
  fonte: "bank" | "manual";
  id: string;
  date: string;
  description: string;
  amount: number;
  contaId: string | null;
  contaNome: string;
  subcategoria?: string;
  regraIdAplicada?: string;
}

interface ApiResp {
  ok: boolean;
  total: number;
  qtd: number;
  itens: Item[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  mes: string;
  categoriaId: string | null;   // "_sem" pra "sem categoria"
  categoriaNome: string;
  categoriaCor?: string;
  onChanged?: () => void;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DialogCategoriaDetalhe({ open, onClose, mes, categoriaId, categoriaNome, categoriaCor, onChanged }: Props) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !categoriaId) return;
    setLoading(true);
    fetch(`/api/expenses/categoria/${encodeURIComponent(categoriaId)}/${mes}`)
      .then(r => r.json())
      .then((j: ApiResp) => setData(j))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, categoriaId, mes]);

  async function removerCategoria(item: Item) {
    if (!confirm(`Remover esta despesa da categoria "${categoriaNome}"?\nVai ficar sem categoria — você pode atribuir outra depois.`)) return;
    await fetch(`/api/expenses/${item.fonte}/${item.id}/categoria`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoriaId: null }),
    });
    // Atualiza local
    setData(prev => {
      if (!prev) return prev;
      const itens = prev.itens.filter(i => i.id !== item.id);
      const total = itens.reduce((s, i) => s + Math.abs(i.amount), 0);
      return { ...prev, itens, total, qtd: itens.length };
    });
    onChanged?.();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {categoriaCor && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: categoriaCor }} />}
            <span>{categoriaNome}</span>
            {data && <span className="text-sm text-muted-foreground font-normal">· {data.qtd} lançamento{data.qtd !== 1 ? "s" : ""} · R$ {fmtBRL(data.total)}</span>}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Todas as despesas desta categoria em {mes}. Confira se cada lançamento realmente pertence aqui.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-xs text-muted-foreground italic text-center py-4">Carregando…</p>}

        {!loading && data && data.itens.length === 0 && (
          <p className="text-xs text-muted-foreground italic text-center py-4">Nenhum lançamento nesta categoria no mês.</p>
        )}

        {!loading && data && data.itens.length > 0 && (
          <div className="space-y-1 max-h-[420px] overflow-y-auto">
            {data.itens.map(item => (
              <div key={item.fonte + item.id} className="rounded-md border border-card-border/40 bg-background/30 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums w-20 shrink-0">
                    {new Date(item.date + "T12:00:00").toLocaleDateString("pt-BR")}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground w-24 shrink-0">
                    {item.fonte === "bank" ? <Building2 className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                    {item.contaNome}
                  </span>
                  <span className="flex-1 truncate">{item.description}</span>
                  {item.subcategoria && <span className="text-[10px] text-muted-foreground">({item.subcategoria})</span>}
                  <span className="tabular-nums text-red-400 font-medium w-24 text-right">-R$ {fmtBRL(Math.abs(item.amount))}</span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={() => removerCategoria(item)} title="Remover desta categoria">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                {item.regraIdAplicada && (
                  <div className="text-[9px] text-cyan-400/70 mt-0.5 ml-[5.75rem]">↳ classificada por regra automática</div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
