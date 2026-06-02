/**
 * Resumo do mês via mesService (fonte canônica unificada).
 * Chama /api/mes/:mes/canonico — o serviço escolhe a melhor fonte e
 * devolve TODAS as outras pra auditoria visual.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Receipt, Loader2, GitCompareArrows } from "lucide-react";

interface FonteAudit {
  disponivel: boolean;
  faturamento: number;
  comandas?: number;
  pagamentos?: number;
  capturadoEm?: string | null;
  geradoEm?: string | null;
}
interface CanonicoResponse {
  mes: string;
  fonte: "api-trinks" | "csv-caixa" | "csv-financeiro" | "snapshot" | "vazio";
  comandas: number;
  faturamento: number;
  breakdown: { pix: number; cartaoCredito: number; cartaoDebito: number; dinheiro: number; plano: number; voucher: number; outros: number };
  fontesAuditoria: { apiTrinks: FonteAudit; csvCaixa: FonteAudit; csvFinanceiro: FonteAudit };
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

const fonteLabel = (f: CanonicoResponse["fonte"]): string => {
  switch (f) {
    case "api-trinks": return "API Trinks";
    case "csv-caixa": return "CSV Caixa";
    case "csv-financeiro": return "CSV Financeiro";
    case "snapshot": return "Snapshot";
    case "vazio": return "Vazio";
  }
};

const fonteCor = (f: CanonicoResponse["fonte"]): string => {
  switch (f) {
    case "api-trinks": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "csv-caixa":
    case "csv-financeiro": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "snapshot": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "vazio": return "bg-muted text-muted-foreground";
  }
};

interface Props { mes?: string; }

export default function DashboardApiSummaryCard({ mes: mesProp }: Props) {
  const mes = mesProp || new Date().toISOString().slice(0, 7);
  const [data, setData] = useState<CanonicoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setErro(null);
      setData(null);
      try {
        const r = await fetch(`/api/mes/${mes}/canonico`);
        if (!alive) return;
        if (!r.ok) {
          setErro(`HTTP ${r.status}`);
          setLoading(false);
          return;
        }
        const j: CanonicoResponse = await r.json();
        if (alive) setData(j);
      } catch (e: any) {
        if (alive) setErro(e?.message || "erro");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [mes]);

  return (
    <Card className="bg-card border-card-border" data-testid="card-resumo-canonico">
      <CardHeader className="pb-3 border-b border-card-border">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Resumo canônico — {mes}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Fonte única da verdade. O serviço compara todas as fontes e escolhe a mais completa.
            </p>
          </div>
          {data && (
            <Badge className={`text-[10px] border ${fonteCor(data.fonte)}`}>
              Fonte escolhida: {fonteLabel(data.fonte)}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
          </div>
        )}
        {erro && !loading && (
          <div className="text-sm text-red-400">Erro: {erro}</div>
        )}
        {data && !loading && (
          <>
            {/* Total + breakdown da fonte escolhida */}
            <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
              <div className="flex items-center gap-1.5 mb-2">
                <Receipt className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-xs font-semibold">Financeiro (recebimentos)</p>
              </div>
              <p className="text-2xl font-bold text-blue-400">{fmtBRL(data.faturamento)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{data.comandas} comandas</p>
              <ul className="mt-2 space-y-0.5">
                {data.breakdown.pix > 0 && <li className="flex justify-between text-[10px]"><span className="text-muted-foreground">PIX</span><span className="font-mono">{fmtBRL(data.breakdown.pix)}</span></li>}
                {data.breakdown.cartaoCredito > 0 && <li className="flex justify-between text-[10px]"><span className="text-muted-foreground">Cartão Crédito</span><span className="font-mono">{fmtBRL(data.breakdown.cartaoCredito)}</span></li>}
                {data.breakdown.cartaoDebito > 0 && <li className="flex justify-between text-[10px]"><span className="text-muted-foreground">Cartão Débito</span><span className="font-mono">{fmtBRL(data.breakdown.cartaoDebito)}</span></li>}
                {data.breakdown.dinheiro > 0 && <li className="flex justify-between text-[10px]"><span className="text-muted-foreground">Dinheiro</span><span className="font-mono">{fmtBRL(data.breakdown.dinheiro)}</span></li>}
                {data.breakdown.plano > 0 && <li className="flex justify-between text-[10px]"><span className="text-muted-foreground">Pré-Pago/Plano</span><span className="font-mono">{fmtBRL(data.breakdown.plano)}</span></li>}
                {data.breakdown.voucher > 0 && <li className="flex justify-between text-[10px]"><span className="text-muted-foreground">Voucher</span><span className="font-mono">{fmtBRL(data.breakdown.voucher)}</span></li>}
                {data.breakdown.outros > 0 && <li className="flex justify-between text-[10px]"><span className="text-muted-foreground">Outros</span><span className="font-mono">{fmtBRL(data.breakdown.outros)}</span></li>}
              </ul>
            </div>

            {/* Auditoria de TODAS as fontes — confirma que as contas batem */}
            <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
              <div className="flex items-center gap-1.5 mb-2">
                <GitCompareArrows className="w-3.5 h-3.5 text-purple-400" />
                <p className="text-xs font-semibold">Auditoria — todas as fontes</p>
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground border-b border-card-border/30">
                    <th className="text-left py-1 font-normal">Fonte</th>
                    <th className="text-right py-1 font-normal">Faturamento</th>
                    <th className="text-right py-1 font-normal">Itens</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={data.fonte === "api-trinks" ? "bg-emerald-500/5" : ""}>
                    <td className="py-1">
                      <span className="text-emerald-400">API Trinks</span>
                      {!data.fontesAuditoria.apiTrinks.disponivel && <span className="text-muted-foreground ml-1">(indisponível)</span>}
                    </td>
                    <td className="py-1 text-right font-mono">{fmtBRL(data.fontesAuditoria.apiTrinks.faturamento)}</td>
                    <td className="py-1 text-right font-mono">{data.fontesAuditoria.apiTrinks.comandas || 0}</td>
                  </tr>
                  <tr className={data.fonte === "csv-caixa" ? "bg-amber-500/5" : ""}>
                    <td className="py-1">
                      <span className="text-amber-400">CSV Caixa</span>
                      {!data.fontesAuditoria.csvCaixa.disponivel && <span className="text-muted-foreground ml-1">(não importado)</span>}
                    </td>
                    <td className="py-1 text-right font-mono">{fmtBRL(data.fontesAuditoria.csvCaixa.faturamento)}</td>
                    <td className="py-1 text-right font-mono">{data.fontesAuditoria.csvCaixa.comandas || 0}</td>
                  </tr>
                  <tr className={data.fonte === "csv-financeiro" ? "bg-amber-500/5" : ""}>
                    <td className="py-1">
                      <span className="text-amber-400">CSV Financeiro</span>
                      {!data.fontesAuditoria.csvFinanceiro.disponivel && <span className="text-muted-foreground ml-1">(não importado)</span>}
                    </td>
                    <td className="py-1 text-right font-mono">{fmtBRL(data.fontesAuditoria.csvFinanceiro.faturamento)}</td>
                    <td className="py-1 text-right font-mono">{data.fontesAuditoria.csvFinanceiro.pagamentos || 0}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-2">
                ✓ A linha destacada é a escolhida. Se houver grande divergência entre fontes, considere re-importar o CSV mais recente.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
