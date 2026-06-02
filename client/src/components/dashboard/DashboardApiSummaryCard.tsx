/**
 * Resumo do mês via API Trinks ao vivo — espelho do DashboardImportSummaryCard,
 * mas alimentado por /api/equipe/mes/:mes e /api/financeiro/dre/:mes.
 * Mostrado lado a lado com o card de CSV importado para auditoria/comparação.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, Users, Receipt, Loader2 } from "lucide-react";

interface ApiSummary {
  faturamento: number;
  atendimentos: number;
  breakdown: Record<string, number>;
  dreReceitas: number;
  dreDespesas: number;
  dreResultado: number;
  topProfs: { nome: string; total: number }[];
  totalProfs: number;
  periodoInicio: string;
  periodoFim: string;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);

interface Props {
  mes?: string;
}

export default function DashboardApiSummaryCard({ mes: mesProp }: Props) {
  const mes = mesProp || new Date().toISOString().slice(0, 7);
  const [data, setData] = useState<ApiSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setErro(null);
      setData(null);
      try {
        const [dadosRes, dreRes] = await Promise.all([
          fetch(`/api/mes/${mes}/dados`),
          fetch(`/api/financeiro/dre/${mes}`).catch(() => null),
        ]);
        if (!alive) return;
        if (!dadosRes.ok) {
          setErro(`HTTP ${dadosRes.status}`);
          setLoading(false);
          return;
        }
        const dadosJson = await dadosRes.json();
        const trans = dadosJson?.dados?.transacoes || [];

        // Faturamento + breakdown forma pagamento
        let faturamento = 0;
        const breakdown: Record<string, number> = {};
        for (const t of trans) {
          faturamento += Number(t.totalPagar || 0);
          const formas = t.formasPagamentos || t.formasPagamento || [];
          for (const fp of formas) {
            const nome = (fp.nome || "").trim() || "Outros";
            breakdown[nome] = (breakdown[nome] || 0) + Number(fp.valor || 0);
          }
        }

        // DRE
        let dreReceitas = 0, dreDespesas = 0, dreResultado = 0;
        if (dreRes && dreRes.ok) {
          const dreJson = await dreRes.json();
          const atual = dreJson?.atual;
          if (atual) {
            dreReceitas = atual.entradas?.total || 0;
            dreDespesas = atual.saidas?.total || 0;
            dreResultado = atual.resultadoLiquido || 0;
          }
        }

        // Top profs (via /api/equipe/mes/:mes pra pegar ranking com filtros aplicados)
        let topProfs: { nome: string; total: number }[] = [];
        let totalProfs = 0;
        try {
          const eqRes = await fetch(`/api/equipe/mes/${mes}`);
          if (eqRes.ok) {
            const eqJson = await eqRes.json();
            const profs = (eqJson?.profissionais || [])
              .map((p: any) => ({ nome: p.nome || "—", total: p.faturamento?.total || 0 }))
              .sort((a: any, b: any) => b.total - a.total);
            topProfs = profs.slice(0, 5);
            totalProfs = profs.length;
          }
        } catch { /* ok ficar vazio */ }

        if (!alive) return;
        setData({
          faturamento,
          atendimentos: trans.length,
          breakdown,
          dreReceitas, dreDespesas, dreResultado,
          topProfs, totalProfs,
          periodoInicio: `${mes}-01`,
          periodoFim: mes,
        });
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
    <Card className="bg-card border-card-border" data-testid="card-resumo-api">
      <CardHeader className="pb-3 border-b border-card-border">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Resumo do mês — {mes} (API Trinks)
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Dados consolidados da API Trinks ao vivo. Fonte canônica — comparar com o CSV importado para auditar.
            </p>
          </div>
          <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
            Fonte: API
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading && (
          <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando da API Trinks…
          </div>
        )}
        {erro && !loading && (
          <div className="col-span-full text-sm text-red-400">Erro: {erro}</div>
        )}
        {data && !loading && (
          <>
            {/* Financeiro */}
            <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
              <div className="flex items-center gap-1.5 mb-2">
                <Receipt className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-xs font-semibold">Financeiro (recebimentos)</p>
              </div>
              <p className="text-xl font-bold text-blue-400">{fmtBRL(data.faturamento)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.atendimentos} comanda(s) · mês {mes}
              </p>
              {Object.keys(data.breakdown).length > 0 && (
                <ul className="mt-2 space-y-0.5 max-h-24 overflow-y-auto">
                  {Object.entries(data.breakdown)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([forma, valor]) => (
                      <li key={forma} className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground truncate mr-2">{forma}</span>
                        <span className="font-mono">{fmtBRL(valor)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {/* DRE */}
            <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                <p className="text-xs font-semibold">DRE (resultado do mês)</p>
              </div>
              <p className={`text-xl font-bold ${data.dreResultado >= 0 ? "text-green-400" : "text-red-400"}`}>
                {fmtBRL(data.dreResultado)}
              </p>
              <div className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">
                <div className="flex justify-between">
                  <span>Receitas</span>
                  <span className="font-mono text-foreground/80">{fmtBRL(data.dreReceitas)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Despesas</span>
                  <span className="font-mono text-foreground/80">{fmtBRL(data.dreDespesas)}</span>
                </div>
              </div>
            </div>

            {/* Top profissionais */}
            <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="w-3.5 h-3.5 text-purple-400" />
                <p className="text-xs font-semibold">Top profissionais</p>
              </div>
              <p className="text-xl font-bold text-purple-400">
                {fmtBRL(data.topProfs.reduce((s, p) => s + p.total, 0))}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.totalProfs} profissionais
              </p>
              {data.topProfs.length > 0 && (
                <ul className="mt-2 space-y-0.5 max-h-24 overflow-y-auto">
                  {data.topProfs.map((p, i) => (
                    <li key={p.nome + i} className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground truncate mr-2">
                        <span className="text-foreground/70 mr-1">#{i + 1}</span>
                        {p.nome}
                      </span>
                      <span className="font-mono">{fmtBRL(p.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
