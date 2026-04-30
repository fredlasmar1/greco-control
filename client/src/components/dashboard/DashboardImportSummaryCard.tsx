/**
 * v25 Etapa 3 — Cartão "Resumo do mês via CSV importado".
 *
 * Aparece apenas quando há pelo menos uma importação (ranking, DRE ou financeiro)
 * para o mês de referência. Funciona como complemento aos cartões "hoje/amanhã"
 * que dependem da API ao vivo da Trinks. Quando a API estiver fora (HTTP 429),
 * este cartão garante visibilidade dos números do mês fechado.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileUp, TrendingUp, Users, Receipt } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface DashboardImport {
  ok: boolean;
  fonte: "trinks-import";
  mes: string;
  disponivel: { financeiro: boolean; dre: boolean; ranking: boolean };
  financeiro?: {
    totalLinhas: number;
    totalValor: number;
    periodoInicio: string;
    periodoFim: string;
    resumoPorForma: Record<string, number>;
  };
  dre?: {
    totalReceitas: number;
    totalDespesas: number;
    resultadoPeriodo: number;
    despesasSubgrupos: { nome: string; total: number }[];
  };
  ranking?: {
    periodoInicio: string;
    periodoFim: string;
    totalProfs: number;
    total: number;
    top10: { nome: string; funcao: string; valorTotal: number; atendimentos: number; ticketMedio: number }[];
  };
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);

interface Props {
  /** Mês YYYY-MM. Se omitido, usa o mês corrente. */
  mes?: string;
}

export default function DashboardImportSummaryCard({ mes: mesProp }: Props) {
  const mes = mesProp || new Date().toISOString().slice(0, 7);
  const [data, setData] = useState<DashboardImport | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setErro(null);
      try {
        const r = await fetch(`/api/dashboard/import/${mes}`);
        if (!alive) return;
        if (r.ok) {
          const j: DashboardImport = await r.json();
          setData(j);
        } else if (r.status === 404) {
          setData(null);
        } else {
          setErro(`HTTP ${r.status}`);
        }
      } catch (e: any) {
        if (alive) setErro(e?.message || "erro");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [mes]);

  // Só renderiza se houver pelo menos um tipo importado para o mês
  const temAlgumDado =
    data?.ok && (data.disponivel.ranking || data.disponivel.dre || data.disponivel.financeiro);

  if (loading) return null;
  if (erro || !temAlgumDado) return null;

  return (
    <Card className="bg-card border-card-border" data-testid="card-resumo-import">
      <CardHeader className="pb-3 border-b border-card-border">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileUp className="w-4 h-4 text-amber-400" />
              Resumo do mês — {data!.mes} (CSV importado)
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Dados consolidados a partir dos relatórios CSV exportados do painel da Trinks.
              Use enquanto a API ao vivo estiver indisponível.
            </p>
          </div>
          <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30">
            Fonte: CSV
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Bloco Financeiro */}
        {data!.financeiro && (
          <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
            <div className="flex items-center gap-1.5 mb-2">
              <Receipt className="w-3.5 h-3.5 text-blue-400" />
              <p className="text-xs font-semibold">Financeiro (recebimentos)</p>
            </div>
            <p className="text-xl font-bold text-blue-400">{fmtBRL(data!.financeiro.totalValor)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {data!.financeiro.totalLinhas} pagamento(s) · {data!.financeiro.periodoInicio} a {data!.financeiro.periodoFim}
            </p>
            {Object.keys(data!.financeiro.resumoPorForma).length > 0 && (
              <ul className="mt-2 space-y-0.5 max-h-24 overflow-y-auto">
                {Object.entries(data!.financeiro.resumoPorForma)
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
        )}

        {/* Bloco DRE */}
        {data!.dre && (
          <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
              <p className="text-xs font-semibold">DRE (resultado do mês)</p>
            </div>
            <p className={`text-xl font-bold ${data!.dre.resultadoPeriodo >= 0 ? "text-green-400" : "text-red-400"}`}>
              {fmtBRL(data!.dre.resultadoPeriodo)}
            </p>
            <div className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">
              <div className="flex justify-between">
                <span>Receitas</span>
                <span className="font-mono text-foreground/80">{fmtBRL(data!.dre.totalReceitas)}</span>
              </div>
              <div className="flex justify-between">
                <span>Despesas</span>
                <span className="font-mono text-foreground/80">{fmtBRL(data!.dre.totalDespesas)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Bloco Ranking */}
        {data!.ranking && (
          <div className="border border-card-border/60 rounded-md p-3 bg-background/30">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-3.5 h-3.5 text-purple-400" />
              <p className="text-xs font-semibold">Top profissionais</p>
            </div>
            <p className="text-xl font-bold text-purple-400">{fmtBRL(data!.ranking.total)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {data!.ranking.totalProfs} profissionais · {data!.ranking.periodoInicio} a {data!.ranking.periodoFim}
            </p>
            {data!.ranking.top10.length > 0 && (
              <ul className="mt-2 space-y-0.5 max-h-24 overflow-y-auto">
                {data!.ranking.top10.slice(0, 5).map((p, i) => (
                  <li key={p.nome} className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground truncate mr-2">
                      <span className="text-foreground/70 mr-1">#{i + 1}</span>
                      {p.nome}
                    </span>
                    <span className="font-mono">{fmtBRL(p.valorTotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>

      <div className="px-4 pb-3 flex items-center justify-end">
        <Link href="/importar-trinks">
          <Button size="sm" variant="outline" className="h-7 text-[11px]">
            <FileUp className="w-3 h-3 mr-1.5" />
            Gerenciar importações
          </Button>
        </Link>
      </div>
    </Card>
  );
}
