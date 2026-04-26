import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Sun,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v || 0);

interface StatusJanela {
  temMeta: boolean;
  percReais: number;
  percAtend: number;
  bateu: boolean;
  farol: "verde" | "vermelho" | "sem-meta";
}

interface Linha {
  profissionalId: string;
  nome: string;
  meta: { metaReais: number; metaAtendimentos: number } | null;
  metasCalculadas: {
    mes: { reais: number; atend: number };
    semana: { reais: number; atend: number };
    dia: { reais: number; atend: number };
  };
  dia: { reais: number; count: number };
  semana: { reais: number; count: number };
  mes: { reais: number; count: number };
  status: { dia: StatusJanela; semana: StatusJanela; mes: StatusJanela };
}

interface DesempenhoApi {
  ok: boolean;
  referencia: {
    hoje: string;
    semana: { dataInicio: string; dataFim: string };
    mes: string;
    diasUteisTotal: number;
    diasUteisDecorridos: number;
  };
  linhas: Linha[];
}

type Janela = "dia" | "semana" | "mes";

export default function AcompanhamentoConsolidado() {
  const [data, setData] = useState<DesempenhoApi | null>(null);
  const [loading, setLoading] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch("/api/equipe/desempenho");
      const j = await r.json();
      if (j?.ok) setData(j);
    } catch (err) {
      console.error("[AcompanhamentoConsolidado] erro:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  // Resumos por janela: contar quem bateu, quem não bateu, quem não tem meta
  const resumos = useMemo(() => {
    const linhas = data?.linhas || [];
    function montar(j: Janela) {
      const comMeta = linhas.filter(l => l.status[j].temMeta);
      const bateu = comMeta.filter(l => l.status[j].bateu);
      const naoBateu = comMeta.filter(l => !l.status[j].bateu);
      const semMeta = linhas.filter(l => !l.status[j].temMeta);
      const totalRealizado = linhas.reduce((s, l) => s + (l[j]?.reais || 0), 0);
      const totalMeta = comMeta.reduce((s, l) => s + (l.metasCalculadas[j]?.reais || 0), 0);
      const pctTotal = totalMeta > 0 ? (totalRealizado / totalMeta) * 100 : 0;
      return { bateu, naoBateu, semMeta, total: linhas.length, totalRealizado, totalMeta, pctTotal };
    }
    return {
      dia: montar("dia"),
      semana: montar("semana"),
      mes: montar("mes"),
    };
  }, [data]);

  const cards: { janela: Janela; label: string; sublabel: string; Icon: any }[] = [
    { janela: "dia", label: "Hoje", sublabel: data?.referencia.hoje || "—", Icon: Sun },
    { janela: "semana", label: "Semana", sublabel: data?.referencia ? `${data.referencia.semana.dataInicio.slice(5)} a ${data.referencia.semana.dataFim.slice(5)}` : "—", Icon: CalendarDays },
    { janela: "mes", label: "Mês", sublabel: data?.referencia ? `${data.referencia.mes} (${data.referencia.diasUteisDecorridos}/${data.referencia.diasUteisTotal} dias úteis)` : "—", Icon: CalendarRange },
  ];

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-3 border-b border-card-border">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Acompanhamento Consolidado
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Quem bateu a meta no dia, na semana e no mês — visão da equipe inteira.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={carregar} disabled={loading} data-testid="btn-recarregar-consolidado">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {!data ? (
          <p className="text-xs text-muted-foreground text-center py-4">Carregando acompanhamento...</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {cards.map(({ janela, label, sublabel, Icon }) => {
              const r = resumos[janela];
              const pct = r.pctTotal;
              return (
                <div key={janela} className="rounded-lg border border-card-border/60 bg-background/30 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-4 h-4 text-primary" />
                      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{sublabel}</span>
                  </div>

                  {/* Resumo de equipe */}
                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    <div className="rounded-md border border-green-500/30 bg-green-500/5 p-1.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Bateu</p>
                      <p className="text-base font-bold text-green-400">{r.bateu.length}</p>
                    </div>
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-1.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Não bateu</p>
                      <p className="text-base font-bold text-red-400">{r.naoBateu.length}</p>
                    </div>
                    <div className="rounded-md border border-card-border/50 bg-background/40 p-1.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Sem meta</p>
                      <p className="text-base font-bold text-muted-foreground">{r.semMeta.length}</p>
                    </div>
                  </div>

                  {/* Total realizado vs meta total */}
                  {r.totalMeta > 0 && (
                    <div className="rounded-md border border-card-border/50 bg-background/40 p-2 mb-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="w-2.5 h-2.5" /> Equipe vs meta
                        </span>
                        <span className={`text-[11px] font-bold ${pct >= 100 ? "text-green-400" : "text-red-400"}`}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-xs font-semibold">
                        {fmtBRL(r.totalRealizado)} <span className="text-muted-foreground font-normal">/ {fmtBRL(r.totalMeta)}</span>
                      </p>
                    </div>
                  )}

                  {/* Lista de quem bateu */}
                  {r.bateu.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] text-green-400 font-semibold mb-1 uppercase tracking-wide flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Bateu ({r.bateu.length})
                      </p>
                      <div className="space-y-1">
                        {r.bateu.map(l => (
                          <div key={l.profissionalId} className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-green-500/20 bg-green-500/5 text-[11px]">
                            <span className="truncate font-medium">{l.nome}</span>
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[9px] flex-shrink-0">
                              {l.status[janela].percReais.toFixed(0)}%
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lista de quem não bateu */}
                  {r.naoBateu.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] text-red-400 font-semibold mb-1 uppercase tracking-wide flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Não bateu ({r.naoBateu.length})
                      </p>
                      <div className="space-y-1">
                        {r.naoBateu
                          .sort((a, b) => b.status[janela].percReais - a.status[janela].percReais)
                          .map(l => (
                            <div key={l.profissionalId} className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-red-500/20 bg-red-500/5 text-[11px]">
                              <span className="truncate font-medium">{l.nome}</span>
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px] flex-shrink-0">
                                {l.status[janela].percReais.toFixed(0)}%
                              </Badge>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {r.bateu.length === 0 && r.naoBateu.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-2">
                      Nenhuma meta cadastrada para esta janela.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
