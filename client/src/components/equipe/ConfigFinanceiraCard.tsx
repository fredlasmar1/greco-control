// Card de configuração financeira global da equipe.
// Por enquanto: taxa única de cartão (% que abate do líquido proporcionalmente
// à fração da transação paga em cartão). Futuramente: outros custos.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreditCard, Save, Pencil, X, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

interface ConfigApi {
  taxaCartaoPct: number;
  atualizadoEm: string;
}

export default function ConfigFinanceiraCard({ onChange }: { onChange?: () => void }) {
  const [cfg, setCfg] = useState<ConfigApi | null>(null);
  const [draft, setDraft] = useState<string>("0");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch("/api/config/financeira");
      const j = await r.json();
      if (j.ok) {
        setCfg(j.config);
        setDraft(String(j.config.taxaCartaoPct ?? 0));
      }
    } catch (err) {
      console.error("[ConfigFinanceiraCard] erro carregar:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  async function salvar() {
    setSaving(true);
    try {
      const r = await fetch("/api/config/financeira", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxaCartaoPct: Number(draft.replace(",", ".") || 0) }),
      });
      const j = await r.json();
      if (j.ok) {
        setCfg(j.config);
        setEditing(false);
        setFeedback({ type: "ok", msg: "Taxa salva — comissões já recalculadas" });
        if (onChange) onChange();
      } else {
        setFeedback({ type: "err", msg: j.error || "Erro ao salvar" });
      }
    } catch (err: any) {
      setFeedback({ type: "err", msg: err.message });
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  function cancelar() {
    setDraft(String(cfg?.taxaCartaoPct ?? 0));
    setEditing(false);
  }

  const taxa = cfg?.taxaCartaoPct ?? 0;

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-3 border-b border-card-border">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Custo de Cartão (taxa global)
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Taxa única (média) que abate do líquido antes de calcular comissão.
              Aplicada apenas sobre a parte da transação paga em cartão.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={carregar} disabled={loading} className="h-7 text-[11px]">
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Recarregar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        {!editing ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-orange-400">{taxa.toFixed(2)}%</span>
              <span className="text-[11px] text-muted-foreground">
                {taxa === 0
                  ? "— sem desconto (paga sobre bruto)"
                  : `desconta ${taxa.toFixed(2)}% do que vier em cartão`}
              </span>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEditing(true)}>
              <Pencil className="w-3 h-3 mr-1" /> Editar
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <p className="text-[10px] text-muted-foreground mb-1">Taxa cartão (%)</p>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0"
                inputMode="decimal"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={cancelar} disabled={saving}>
                <X className="w-3 h-3 mr-1" /> Cancelar
              </Button>
              <Button size="sm" className="h-8 text-[11px]" onClick={salvar} disabled={saving}>
                <Save className="w-3 h-3 mr-1" />
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        )}
        {feedback && (
          <div className={`mt-2 text-[11px] flex items-center gap-1 ${
            feedback.type === "ok" ? "text-green-400" : "text-red-400"
          }`}>
            {feedback.type === "ok" ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {feedback.msg}
          </div>
        )}
        {cfg?.atualizadoEm && cfg.atualizadoEm !== "1970-01-01T00:00:00.000Z" && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Atualizado em {new Date(cfg.atualizadoEm).toLocaleString("pt-BR")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
