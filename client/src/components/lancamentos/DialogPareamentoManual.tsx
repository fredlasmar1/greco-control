// Dialog pra parear manualmente uma transação como transferência interna
// com outra do banco oposto. Mostra candidatos rankeados por data + valor.
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRightLeft, Search } from "lucide-react";

interface Tx {
  id: string;
  contaId: string;
  contaNome: string;
  date: string;
  description: string;
  amount: number;
  transferenciaParId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  origem: Tx | null;       // a transação que o usuário escolheu pra parear
  todasTransacoes: Tx[];   // todas as transações do mês
  contas: Array<{ id: string; nome: string }>;
  onPaired?: () => void;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DialogPareamentoManual({ open, onClose, origem, todasTransacoes, contas, onPaired }: Props) {
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  const candidatos = useMemo(() => {
    if (!origem) return [];
    // Pareamento típico: saída (origem.amount<0) → entrada espelho em outro banco
    // Mas também aceita o reverso (entrada → saída em outro banco)
    const tipoOposto = origem.amount < 0 ? +1 : -1;
    const valorAlvo = Math.abs(origem.amount);
    const dataOrig = new Date(origem.date + "T12:00:00").getTime();
    const dia = 24 * 60 * 60 * 1000;

    return todasTransacoes
      .filter(t =>
        t.id !== origem.id
        && t.contaId !== origem.contaId  // banco DIFERENTE
        && Math.sign(t.amount) === tipoOposto
        && !t.transferenciaParId  // não pareada ainda
      )
      .map(t => {
        const dif = Math.abs(Math.abs(t.amount) - valorAlvo);
        const dataT = new Date(t.date + "T12:00:00").getTime();
        const deltaDias = Math.round((dataT - dataOrig) / dia);
        // Score: igualdade exata de valor + proximidade de data (favorece destino DEPOIS da origem se origem é saída)
        const proxValor = 1 / (1 + dif * 0.5);  // dif=0 → 1.0
        const proxData = 1 / (1 + Math.abs(deltaDias) * 0.3); // 0 dias → 1.0; 3 dias → ~0.5
        const score = proxValor * 0.6 + proxData * 0.4;
        return { ...t, dif, deltaDias, score };
      })
      .filter(c => {
        if (!busca.trim()) return true;
        const b = busca.toLowerCase();
        return c.description.toLowerCase().includes(b) || c.contaNome.toLowerCase().includes(b);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
  }, [origem, todasTransacoes, busca]);

  async function parear(candidato: { id: string; amount: number }) {
    if (!origem) return;
    setSalvando(candidato.id);
    try {
      // Endpoint espera outId (saída) e inId (entrada)
      const outId = origem.amount < 0 ? origem.id : candidato.id;
      const inId = origem.amount < 0 ? candidato.id : origem.id;
      const r = await fetch("/api/conciliacao-multibanco/parear-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outId, inId }),
      });
      const j = await r.json();
      if (j.ok) {
        onPaired?.();
        onClose();
      } else {
        alert("Erro: " + (j.error || ""));
      }
    } finally {
      setSalvando(null);
    }
  }

  if (!origem) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-cyan-400" />
            Marcar como transferência interna
          </DialogTitle>
          <DialogDescription>
            Selecione a transação espelho em outro banco. Os dois lançamentos vão sair do cálculo
            de entradas/saídas (deixam de ser dupla-contados).
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-card-border bg-background/40 p-3 text-xs space-y-1">
          <div className="text-muted-foreground text-[10px] uppercase">Transação origem</div>
          <div className="flex items-center justify-between">
            <span className="font-medium">{origem.contaNome.trim()}</span>
            <span>{new Date(origem.date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
          </div>
          <div className="text-muted-foreground">{origem.description}</div>
          <div className={`tabular-nums font-semibold ${origem.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
            {origem.amount < 0 ? "-" : "+"}R$ {fmtBRL(Math.abs(origem.amount))}
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar candidatos por descrição ou banco…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="space-y-1 max-h-[320px] overflow-y-auto">
          {candidatos.length === 0 && (
            <p className="text-xs text-center text-muted-foreground italic py-4">
              Nenhum candidato encontrado em outro banco. Verifique se o extrato do banco oposto foi importado.
            </p>
          )}
          {candidatos.map(c => {
            const cor = c.score >= 0.7 ? "border-emerald-500/40 bg-emerald-500/5"
                      : c.score >= 0.4 ? "border-amber-500/40 bg-amber-500/5"
                      : "border-card-border/40 bg-background/30";
            return (
              <div key={c.id} className={`rounded-md border ${cor} p-2 text-xs flex items-center gap-2`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.contaNome.trim()}</span>
                    <span className="text-muted-foreground">{new Date(c.date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                    {c.deltaDias !== 0 && <span className="text-[10px] text-muted-foreground">({c.deltaDias > 0 ? "+" : ""}{c.deltaDias}d)</span>}
                    {c.dif > 0 && <span className="text-[10px] text-amber-400">Δ R$ {fmtBRL(c.dif)}</span>}
                  </div>
                  <p className="text-muted-foreground truncate">{c.description}</p>
                </div>
                <span className={`tabular-nums font-semibold ${c.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
                  R$ {fmtBRL(Math.abs(c.amount))}
                </span>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => parear(c)}
                  disabled={salvando === c.id}
                >
                  {salvando === c.id ? "…" : "Parear"}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
