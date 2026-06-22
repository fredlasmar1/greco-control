// Motor de Viabilidade — Fase A (margem real ao vivo + guia de fixas).
// Junta receita (mesService) − variável (comissão v42 + taxa cartão + material +
// extrato) − fixo (extrato categorizado) = resultado real do negócio. Tudo ao
// vivo dos endpoints; zero digitação. Guia de fixas destrava o totalFixas furado.
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonthSelector } from "@/components/MonthSelector";
import { useTrinksMonth } from "@/hooks/useTrinksMonth";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";
import { formatCurrency } from "@/lib/demoData";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Wallet, ArrowDown } from "lucide-react";

const API_BASE = (globalThis as any).__API_BASE__ || "";

export default function Viabilidade() {
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("viabilidade.selectedMes") || mesCorrente;
  });
  useEffect(() => { try { localStorage.setItem("viabilidade.selectedMes", selectedMes); } catch {} }, [selectedMes]);
  const isMesCorrente = selectedMes === mesCorrente;
  const { mesCorrente: mc, fonte, trinksAt, csvAt, loading: loadingMes, error } = useTrinksMonth(selectedMes);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [catsFixas, setCatsFixas] = useState<Array<{ id: string; nome: string; tipo: string; cor: string }>>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const carregar = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/viabilidade/${selectedMes}`).then(r => r.json()),
      fetch(`${API_BASE}/api/expense-categorias`).then(r => r.json()),
    ]).then(([v, c]) => {
      if (v?.ok) setData(v);
      const cats = (c?.categorias || []).filter((x: any) => x.tipo === "fixo" || x.tipo === "recorrente");
      setCatsFixas(cats);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { setData(null); carregar(); /* eslint-disable-next-line */ }, [selectedMes, reloadKey]);

  const categorizar = async (txId: string, categoriaId: string) => {
    await fetch(`${API_BASE}/api/expenses/bank/${txId}/categoria`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoriaId }),
    });
    setReloadKey(k => k + 1); // recalcula a viabilidade ao vivo
  };

  const resultado = data?.resultado ?? 0;
  const margemPct = data?.margemRealPct ?? 0;
  const corResultado = resultado < 0 ? "text-red-400" : margemPct < 10 ? "text-amber-400" : "text-emerald-400";
  const v = data?.variavel || {};

  return (
    <div className="space-y-5 max-w-[1100px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Viabilidade — {labelMesPtBR(selectedMes)}</h2>
          <p className="text-sm text-muted-foreground">Receita − custos reais = lucro do negócio, ao vivo. Sem digitar nada.</p>
        </div>
        <MonthSelector selectedMes={selectedMes} onChange={setSelectedMes} mesCorrente={mc || mesCorrente} isMesCorrente={isMesCorrente} loading={loadingMes} error={error} fonte={fonte} trinksAt={trinksAt} csvAt={csvAt} />
      </div>

      {loading && !data && <div className="text-sm text-muted-foreground py-8 text-center">Calculando viabilidade…</div>}

      {data && (
        <>
          {/* Cascata */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Resultado do mês</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Receita */}
              <div className="flex items-center justify-between" data-testid="via-receita">
                <span className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> Receita</span>
                <span className="text-base font-bold tabular-nums text-emerald-400">{formatCurrency(data.receita)}</span>
              </div>
              {/* Variável (detalhe) */}
              <div className="pl-6 border-l-2 border-red-500/20 ml-2 space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><ArrowDown className="w-3 h-3" /> Variável</span>
                  <span className="tabular-nums text-red-400">− {formatCurrency(v.total || 0)}</span>
                </div>
                {[
                  ["Comissões", v.comissao], ["Taxa de cartão", v.taxaCartao],
                  ["Material (fichas)", v.material], ["Outras variáveis (extrato)", v.outrosExtrato],
                ].map(([lbl, val]: any) => (
                  <div key={lbl} className="flex items-center justify-between text-[11px] text-muted-foreground/80">
                    <span>{lbl}{lbl === "Material (fichas)" && (val === 0) ? " ⚠ vazias" : ""}</span>
                    <span className="tabular-nums">{formatCurrency(val || 0)}</span>
                  </div>
                ))}
              </div>
              {/* Margem de contribuição */}
              <div className="flex items-center justify-between border-t border-border/50 pt-2" data-testid="via-margem-contrib">
                <span className="text-sm font-medium">= Margem de contribuição</span>
                <span className="text-sm font-bold tabular-nums">{formatCurrency(data.margemContribuicao)}</span>
              </div>
              {/* Fixo */}
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-2"><ArrowDown className="w-3 h-3 text-red-400" /> Custos fixos {data.guiaFixas?.implausivel && <span className="text-[10px] text-amber-400">(parece incompleto)</span>}</span>
                <span className="tabular-nums text-red-400">− {formatCurrency(data.fixo)}</span>
              </div>
              {/* Resultado */}
              <div className="flex items-center justify-between border-t border-border pt-2" data-testid="via-resultado">
                <span className="text-base font-semibold flex items-center gap-2">
                  {resultado < 0 ? <TrendingDown className="w-5 h-5 text-red-400" /> : <TrendingUp className="w-5 h-5 text-emerald-400" />}
                  Resultado
                </span>
                <div className="text-right">
                  <div className={`text-xl font-bold tabular-nums ${corResultado}`}>{formatCurrency(resultado)}</div>
                  <div className={`text-xs font-semibold ${corResultado}`}>{margemPct.toFixed(1)}% da receita</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Guia de fixas */}
          {data.guiaFixas?.implausivel && (
            <Card className="border-amber-500/40 bg-amber-500/5" data-testid="guia-fixas">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
                  <AlertTriangle className="w-4 h-4" /> Suas fixas parecem incompletas (R$ {formatCurrency(data.guiaFixas.totalFixasAtual)})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground -mt-1">
                  Com fixas incompletas o resultado fica otimista. Categorize abaixo — uma vez feito, todo mês que você importar o extrato já entra certo.
                </p>

                {/* Checklist */}
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">O que toda barbearia tem</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {(data.guiaFixas.checklist || []).map((c: any) => (
                      <div key={c.item} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${c.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-border bg-card text-muted-foreground"}`} data-testid={`check-${c.item}`}>
                        {c.ok ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> : <span className="w-3 h-3 rounded-full border border-muted-foreground/40 flex-shrink-0" />}
                        <span className="truncate">{c.item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Candidatas a categorizar */}
                {(data.guiaFixas.candidatas?.length || 0) > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Transações do Itaú que parecem fixas — classifique aqui</p>
                    <div className="space-y-1">
                      {data.guiaFixas.candidatas.map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded border border-border bg-card" data-testid={`cand-${t.id}`}>
                          <span className="flex-1 min-w-0">
                            <span className="text-muted-foreground">{t.date.slice(8)}/{t.date.slice(5, 7)}</span> <span className="truncate">{t.description}</span>
                          </span>
                          <span className="tabular-nums text-red-400 flex-shrink-0">{formatCurrency(t.valor)}</span>
                          <Select onValueChange={(catId) => categorizar(t.id, catId)}>
                            <SelectTrigger className="h-7 text-[10px] w-[140px] flex-shrink-0"><SelectValue placeholder="categorizar…" /></SelectTrigger>
                            <SelectContent>
                              {catsFixas.map(c => (
                                <SelectItem key={c.id} value={c.id}>
                                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.cor }} />{c.nome}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Placeholder A2 — margem por categoria */}
          <Card className="bg-card border-card-border border-dashed">
            <CardContent className="p-4 text-xs text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span><strong>Margem por categoria (Express / Clássico / Estética / VIP / Produtos)</strong> entra na Fase B, quando você subir o relatório da Trinks por serviço.</span>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
