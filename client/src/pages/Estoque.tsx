import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, AlertTriangle, TrendingDown, TrendingUp, RefreshCw, Loader2, Search, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { formatCurrency } from "@/lib/demoData";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface Produto {
  id: number;
  nome: string;
  categoria: string;
  fabricante: string;
  saldo: number;
  minimo: number;
  custoMedio: number;
  valorVenda: number;
  valorEstoque: number;
  nivel: "ok" | "atencao" | "critico";
}

interface Movimentacao {
  id: number;
  data: string;
  produtoId: number;
  produtoNome: string;
  tipo: string;
  quantidade: number;
  valor: number;
  observacao: string;
}

interface Resumo {
  atualizadoEm: string;
  totalProdutos: number;
  produtosEmAlerta: number;
  produtosCriticos: number;
  valorTotalEstoque: number;
  movimentacoesHojeCount: number;
  saidasHoje: number;
  entradasHoje: number;
  produtos: Produto[];
  alertas: Produto[];
  movimentacoesHoje: Movimentacao[];
}

export default function Estoque() {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroNivel, setFiltroNivel] = useState<"todos" | "alerta" | "critico">("todos");

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`${API_BASE}/api/estoque/resumo`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setResumo(data);
    } catch (e: any) {
      setErro(e?.message || "Erro ao carregar estoque");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const produtosFiltrados = useMemo(() => {
    if (!resumo) return [];
    let lista = resumo.produtos;
    if (filtroNivel === "alerta") lista = lista.filter(p => p.nivel !== "ok");
    if (filtroNivel === "critico") lista = lista.filter(p => p.nivel === "critico");
    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(p =>
        p.nome.toLowerCase().includes(q) ||
        p.categoria.toLowerCase().includes(q) ||
        p.fabricante.toLowerCase().includes(q)
      );
    }
    // ordena: críticos primeiro, depois atenção, depois ok (por nome)
    return [...lista].sort((a, b) => {
      const ord = { critico: 0, atencao: 1, ok: 2 };
      if (ord[a.nivel] !== ord[b.nivel]) return ord[a.nivel] - ord[b.nivel];
      return a.nome.localeCompare(b.nome);
    });
  }, [resumo, busca, filtroNivel]);

  const corNivel = (n: string) =>
    n === "critico" ? "bg-red-500/15 text-red-400 border-red-500/30" :
    n === "atencao" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            Controle de Estoque
          </h2>
          <p className="text-sm text-muted-foreground">
            Produtos sincronizados com a Trinks · baixa automática por venda/uso
          </p>
        </div>
        <Button onClick={carregar} disabled={loading} variant="outline" size="sm">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-2">Atualizar</span>
        </Button>
      </div>

      {/* Erro */}
      {erro && (
        <Card className="border-red-500/30">
          <CardContent className="pt-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-red-400">Não foi possível carregar o estoque</div>
              <div className="text-muted-foreground mt-0.5">{erro}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                Pode ser limite da API da Trinks (tenta de novo em alguns minutos) ou endpoint ainda não disponível.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cards resumo */}
      {resumo && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Total de produtos</div>
                <div className="text-2xl font-semibold mt-1">{resumo.totalProdutos}</div>
              </CardContent>
            </Card>
            <Card className={resumo.produtosCriticos > 0 ? "border-red-500/30" : ""}>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Em alerta</div>
                <div className="text-2xl font-semibold mt-1 text-amber-400">
                  {resumo.produtosEmAlerta}
                </div>
                {resumo.produtosCriticos > 0 && (
                  <div className="text-[11px] text-red-400 mt-0.5">
                    {resumo.produtosCriticos} crítico{resumo.produtosCriticos > 1 ? "s" : ""}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Valor em estoque</div>
                <div className="text-2xl font-semibold mt-1">{formatCurrency(resumo.valorTotalEstoque)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Movimentações hoje</div>
                <div className="text-2xl font-semibold mt-1">{resumo.movimentacoesHojeCount}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span className="flex items-center gap-1"><ArrowDownCircle className="w-3 h-3 text-red-400" />{resumo.saidasHoje}</span>
                  <span className="flex items-center gap-1"><ArrowUpCircle className="w-3 h-3 text-emerald-400" />{resumo.entradasHoje}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Alertas */}
          {resumo.alertas.length > 0 && (
            <Card className="border-amber-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Produtos em alerta ({resumo.alertas.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {resumo.alertas.map((p) => (
                    <div key={p.id} className={`flex items-center justify-between px-3 py-2 rounded-md border ${corNivel(p.nivel)}`}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{p.nome}</div>
                        <div className="text-[11px] opacity-80">
                          {p.categoria || "Sem categoria"} · Mínimo: {p.minimo}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <div className="text-sm font-semibold">
                          {p.saldo}
                          <span className="text-[11px] opacity-70 ml-1">em estoque</span>
                        </div>
                        <div className="text-[11px] uppercase tracking-wide opacity-70">
                          {p.nivel === "critico" ? "Crítico" : "Atenção"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Lista completa */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                <span>Todos os produtos</span>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar produto..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="pl-8 h-8 w-48 text-sm"
                    />
                  </div>
                  <div className="flex rounded-md border border-border overflow-hidden">
                    {(["todos", "alerta", "critico"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFiltroNivel(f)}
                        className={`px-3 py-1.5 text-xs ${filtroNivel === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {f === "todos" ? "Todos" : f === "alerta" ? "Alerta" : "Crítico"}
                      </button>
                    ))}
                  </div>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {produtosFiltrados.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  Nenhum produto encontrado
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Produto</th>
                        <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Categoria</th>
                        <th className="text-right py-2 px-2 font-medium">Saldo</th>
                        <th className="text-right py-2 px-2 font-medium hidden sm:table-cell">Mínimo</th>
                        <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Custo un.</th>
                        <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Venda un.</th>
                        <th className="text-right py-2 px-2 font-medium">Valor estoque</th>
                        <th className="text-center py-2 px-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtosFiltrados.map((p) => (
                        <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 px-2">
                            <div className="font-medium">{p.nome}</div>
                            {p.fabricante && (
                              <div className="text-[11px] text-muted-foreground">{p.fabricante}</div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-muted-foreground hidden md:table-cell">
                            {p.categoria || "-"}
                          </td>
                          <td className="py-2 px-2 text-right font-semibold">{p.saldo}</td>
                          <td className="py-2 px-2 text-right text-muted-foreground hidden sm:table-cell">
                            {p.minimo || "-"}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground hidden lg:table-cell">
                            {p.custoMedio > 0 ? formatCurrency(p.custoMedio) : "-"}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground hidden lg:table-cell">
                            {p.valorVenda > 0 ? formatCurrency(p.valorVenda) : "-"}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {formatCurrency(p.valorEstoque)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${corNivel(p.nivel)}`}>
                              {p.nivel === "critico" ? "Crítico" : p.nivel === "atencao" ? "Atenção" : "OK"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Movimentações de hoje */}
          {resumo.movimentacoesHoje.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Movimentações de hoje</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {resumo.movimentacoesHoje.map((m, i) => {
                    const isSaida = /(saída|saida|venda|uso|consumo)/.test(m.tipo);
                    return (
                      <div key={m.id || i} className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/30">
                        <div className="flex items-center gap-2 min-w-0">
                          {isSaida ? (
                            <TrendingDown className="w-4 h-4 text-red-400 flex-shrink-0" />
                          ) : (
                            <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm truncate">{m.produtoNome || "—"}</div>
                            <div className="text-[11px] text-muted-foreground capitalize">
                              {m.tipo || "movimentação"}
                              {m.observacao && ` · ${m.observacao}`}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className={`text-sm font-medium ${isSaida ? "text-red-400" : "text-emerald-400"}`}>
                            {isSaida ? "−" : "+"}{m.quantidade}
                          </div>
                          {m.valor > 0 && (
                            <div className="text-[11px] text-muted-foreground">
                              {formatCurrency(m.valor)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="text-[11px] text-muted-foreground text-center pt-1">
            Atualizado em {new Date(resumo.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          </div>
        </>
      )}

      {/* Estado vazio */}
      {!resumo && !erro && loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
