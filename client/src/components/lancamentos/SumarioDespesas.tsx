// SumarioDespesas — substitui o bloco hard-coded de "Fixas / Variáveis / etc."
// Renderiza dinamicamente as categorias do mês a partir de /api/expenses/sumario/:mes,
// agrupadas por TIPO contábil (fixo, variavel, recorrente, cartão…), com expansão pra
// ver subcategorias. Cada subcategoria mostra qtd de lançamentos.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, ChevronRight, ChevronDown, Sparkles, AlertCircle, RefreshCw } from "lucide-react";

type TipoContabil =
  | "fixo" | "variavel" | "recorrente" | "cartao"
  | "comissao" | "bonus" | "imposto" | "insumo"
  | "investimento" | "outros" | "sem_categoria";

interface CategoriaBucket {
  categoriaId: string | null;
  categoriaNome: string;
  tipo: TipoContabil;
  cor: string;
  total: number;
  qtd: number;
  subcategorias: Record<string, { total: number; qtd: number }>;
}

interface SumarioApi {
  ok: boolean;
  mes: string;
  totalGeral: number;
  porTipo: Record<string, { total: number; qtd: number }>;
  categorias: CategoriaBucket[];
}

const TIPO_LABEL: Record<TipoContabil, string> = {
  fixo:          "Despesas Fixas",
  variavel:      "Despesas Variáveis",
  recorrente:    "Recorrentes (assinaturas)",
  cartao:        "Cartão (taxa + crédito)",
  comissao:      "Comissões",
  bonus:         "Bônus",
  imposto:       "Impostos",
  insumo:        "Insumos / Ficha técnica",
  investimento:  "Investimentos (CapEx)",
  outros:        "Outros",
  sem_categoria: "⚠ Sem categoria",
};

const TIPO_ORDEM: TipoContabil[] = [
  "fixo", "recorrente", "variavel", "cartao",
  "comissao", "bonus", "imposto", "insumo",
  "investimento", "outros", "sem_categoria",
];

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  mes: string;            // YYYY-MM
  /** Inclui comissões/bônus calculados externamente (vindos do Pagamento). */
  comissoesCalc?: number;
  bonusCalc?: number;
  taxaCartaoCalc?: number;
  /** Disparado quando algo muda — pra parent recalcular total. */
  onChange?: (totalDespesas: number) => void;
  /** Pra reagir quando lançamentos externos mudam. */
  refreshKey?: number;
}

export default function SumarioDespesas({ mes, comissoesCalc = 0, bonusCalc = 0, taxaCartaoCalc = 0, onChange, refreshKey }: Props) {
  const [data, setData] = useState<SumarioApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [classificando, setClassificando] = useState(false);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/expenses/sumario/${mes}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: SumarioApi = await r.json();
      setData(j);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar sumário");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mes, refreshKey]);

  async function classificarTudo(force: boolean) {
    if (classificando) return;
    setClassificando(true);
    try {
      const r = await fetch("/api/expenses/classificar-tudo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const j = await r.json();
      if (j.ok) {
        const total = (j.bank?.atualizadas || 0) + (j.manual?.atualizadas || 0);
        alert(`✅ ${total} despesa(s) classificadas usando ${j.regrasUsadas} regra(s).`);
        await carregar();
      } else {
        alert("Erro: " + (j.error || "desconhecido"));
      }
    } catch (err: any) {
      alert("Erro: " + err.message);
    } finally {
      setClassificando(false);
    }
  }

  // Agrupa por TIPO e injeta comissão/bônus/taxa cartão calculados externamente
  const grupos = useMemo(() => {
    const g: Record<string, CategoriaBucket[]> = {};
    if (data) {
      for (const c of data.categorias) {
        const k = String(c.tipo);
        if (!g[k]) g[k] = [];
        g[k].push(c);
      }
    }
    return g;
  }, [data]);

  // Total geral inclui comissões/bônus/taxa-cartão calculados (não duplica os do extrato).
  // O backend já contabiliza despesas categorizadas — comissão/bônus/taxa cartão geralmente
  // vêm calculados do Pagamento e NÃO aparecem como saída no extrato (saem direto na conta).
  // Por isso somamos por cima — caller deve passar 0 se já tiver lançamento manual disso.
  const totalDespesas = (data?.totalGeral || 0) + comissoesCalc + bonusCalc + taxaCartaoCalc;

  useEffect(() => { onChange?.(totalDespesas); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [totalDespesas]);

  function toggle(k: string) {
    setExpandidos(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }

  const semCatTotal = grupos["sem_categoria"]?.reduce((s, c) => s + c.total, 0) || 0;
  const semCatQtd = grupos["sem_categoria"]?.reduce((s, c) => s + c.qtd, 0) || 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-red-400" />
            Despesas categorizadas
          </span>
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => carregar()} disabled={loading}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Recarregar
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => classificarTudo(false)} disabled={classificando}>
              <Sparkles className="w-3 h-3 mr-1" /> {classificando ? "Classificando…" : "Auto-classificar"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="text-xs text-red-400 mb-2">⚠ {error}</p>}

        {semCatTotal > 0 && (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-amber-300 font-medium">
                {semCatQtd} lançamento(s) sem categoria · R$ {fmtBRL(semCatTotal)}
              </p>
              <p className="text-[10px] text-amber-300/80">
                Use "Auto-classificar" pra aplicar regras automaticamente, ou abra "Saídas do extrato" abaixo pra atribuir manualmente.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {TIPO_ORDEM.map(tipo => {
            const cats = grupos[tipo] || [];
            const subtotal = cats.reduce((s, c) => s + c.total, 0);
            const qtd = cats.reduce((s, c) => s + c.qtd, 0);

            // Injeta valores externos pros tipos comissao/bonus/cartao quando relevante
            const externo = tipo === "comissao" ? comissoesCalc
                          : tipo === "bonus"    ? bonusCalc
                          : tipo === "cartao"   ? taxaCartaoCalc
                          : 0;
            const totalTipo = subtotal + externo;
            if (totalTipo === 0 && cats.length === 0) return null;

            const isOpen = expandidos.has(tipo);
            return (
              <div key={tipo} className="rounded-md border border-card-border/40 bg-background/30">
                <button
                  type="button"
                  onClick={() => toggle(tipo)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className={`text-sm font-medium ${tipo === "sem_categoria" ? "text-amber-400" : ""}`}>
                      {TIPO_LABEL[tipo]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {qtd > 0 ? `${qtd} lanç.` : ""}
                      {externo > 0 ? (qtd > 0 ? " · +calc" : "calculado") : ""}
                    </span>
                  </div>
                  <span className="text-sm tabular-nums text-red-400">R$ {fmtBRL(totalTipo)}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-2 pt-1 space-y-1 border-t border-card-border/40">
                    {externo > 0 && (
                      <div className="flex items-center justify-between text-xs py-1 italic">
                        <span className="text-cyan-300">↪ Calculado pelo Pagamento</span>
                        <span className="tabular-nums text-cyan-300">R$ {fmtBRL(externo)}</span>
                      </div>
                    )}
                    {cats.length === 0 && externo === 0 && (
                      <p className="text-[10px] text-muted-foreground italic py-1">— sem lançamentos</p>
                    )}
                    {cats.map(c => {
                      const subs = Object.entries(c.subcategorias || {}).filter(([, v]) => v.total > 0);
                      return (
                        <div key={c.categoriaId || "_sem"} className="text-xs py-1">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.cor }} />
                              {c.categoriaNome}
                              <span className="text-[10px] text-muted-foreground">({c.qtd})</span>
                            </span>
                            <span className="tabular-nums">R$ {fmtBRL(c.total)}</span>
                          </div>
                          {subs.length > 0 && subs[0][0] !== "—" && (
                            <div className="ml-4 mt-0.5 space-y-0.5">
                              {subs.map(([sub, v]) => (
                                <div key={sub} className="flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span>↳ {sub} ({v.qtd})</span>
                                  <span className="tabular-nums">R$ {fmtBRL(v.total)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3 mt-3 font-semibold">
          <span>Total de Despesas</span>
          <span className="tabular-nums text-red-400">R$ {fmtBRL(totalDespesas)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
