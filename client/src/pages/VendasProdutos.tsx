import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  Trophy,
  Package,
  Settings,
  Search,
  Save,
  AlertTriangle,
  DollarSign,
  Percent,
  Pencil,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP } from "@/lib/mesUtils";

// ──────────────────────────────────────────────────────────────────────
// Aba VENDAS DE PRODUTOS (v21) — substitui Raio-X
// ──────────────────────────────────────────────────────────────────────

const API_BASE = (globalThis as any).__API_BASE__ || "";

type Produto = {
  id: string;
  nome: string;
  categoria: string;
  fabricante: string;
  unidades: number;
  receita: number;
  custoTotal: number;
  precoVendaMedio: number;
  custoUnit: number;
  margemRS: number;
  margemPct: number;
  bomboniere?: boolean; // v96: não comissiona
};

type Vendedor = {
  id: number;
  nome: string;
  unidades: number;
  receita: number;
  receitaComissionavel?: number; // v96
  receitaBomboniere?: number;    // v96
  custoTotal: number;
  margemRS: number;
  margemPct: number;
  produtosDistintos: number;
  comandas: number;
  ticketMedio: number;
  // v39.2: comissão sobre produtos
  pctComissao?: number;
  pctComissaoFonte?: "meta" | "default";
  comissaoRS?: number;
};

type RespVendas = {
  ok: boolean;
  mes: string;
  dataInicio: string;
  dataFim: string;
  totais: {
    unidades: number;
    receita: number;
    receitaComissionavel?: number; // v96
    receitaBomboniere?: number;    // v96
    custo: number;
    margemRS: number;
    margemPct: number;
    comandasComProduto: number;
    produtosDistintos: number;
    produtosSemCusto: number;
  };
  produtos: Produto[];
  ranking: Vendedor[];
  rankingHistorico?: Vendedor[]; // v38.1: ex-funcionários separados
  atualizadoEm: string;
};

type ProdutoCusto = {
  id: string;
  nome: string;
  categoria: string;
  fabricante: string;
  precoVenda: number;            // efetivo (manual > catálogo > observado)
  precoVendaManual?: number | null;
  precoVendaCatalogo?: number;
  precoVendaObservado?: number;
  custo: number;
  atualizadoEm: string | null;
};

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VendasProdutos() {
  const { toast } = useToast();
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [mes, setMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("vendas-produtos.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("vendas-produtos.selectedMes", mes); } catch {}
  }, [mes]);
  const [data, setData] = useState<RespVendas | null>(null);
  const [csvProd, setCsvProd] = useState<any>(null); // v24: Ranking de Produtos (CSV, 0 tokens)
  const [loading, setLoading] = useState(false);
  const [showCustos, setShowCustos] = useState(false);
  const [ordemProdutos, setOrdemProdutos] = useState<"receita" | "unidades" | "margem">("receita");
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const produtosOrdenados = useMemo(() => {
    if (!data) return [];
    const arr = [...data.produtos];
    if (ordemProdutos === "unidades") arr.sort((a, b) => b.unidades - a.unidades);
    else if (ordemProdutos === "margem") arr.sort((a, b) => b.margemRS - a.margemRS);
    else arr.sort((a, b) => b.receita - a.receita);
    return arr;
  }, [data, ordemProdutos]);

  const carregar = async () => {
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    setLoading(true);
    try {
      const r = await authFetch(`${API_BASE}/api/vendas-produtos/${mes}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Erro");
      setData(j);
      // v24: Ranking de Produtos do CSV (0 tokens) — comissionável × bomboniere por categoria
      authFetch(`${API_BASE}/api/ranking-produtos/${mes}`).then(x => x.json()).then(x => { if (x?.ok) setCsvProd(x); }).catch(() => setCsvProd(null));
    } catch (e: any) {
      toast({ title: "Erro ao carregar", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-8" data-testid="vendas-produtos-page">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-5 w-5" />
              Vendas de Produtos
              <Badge variant="outline" className="text-xs">v23</Badge>
            </CardTitle>
            <MonthSelector
              selectedMes={mes}
              onChange={setMes}
              mesCorrente={mesCorrente}
              isMesCorrente={mes === mesCorrente}
              loading={loading}
              extraInfo="Produtos vendidos no mês selecionado"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Button onClick={carregar} disabled={loading} variant="outline" size="sm">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Atualizar
            </Button>
            <Button onClick={() => setShowCustos(true)} variant="outline" size="sm" data-testid="abrir-custos">
              <Settings className="h-4 w-4 mr-1" />
              Preços de compra/venda
            </Button>
          </div>

          {data && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
              <Stat icon={<Package className="h-4 w-4" />} label="Unidades" valor={data.totais.unidades} />
              <Stat icon={<DollarSign className="h-4 w-4" />} label="Receita" reais={data.totais.receita} bold />
              <Stat label="Custo total" reais={data.totais.custo} muted />
              <Stat icon={<TrendingUp className="h-4 w-4" />} label="Margem R$" reais={data.totais.margemRS} bold />
              <Stat icon={<Percent className="h-4 w-4" />} label="Margem %" valor={Number(data.totais.margemPct.toFixed(1))} suffix="%" />
              <Stat label="Produtos sem custo" valor={data.totais.produtosSemCusto} alerta={data.totais.produtosSemCusto > 0} />
            </div>
          )}

          {/* v96: split comissionável vs bomboniere — SÓ como fallback da API quando
              NÃO há o Ranking de Produtos CSV. Com CSV, a seção "Produtos (CSV)" abaixo
              é a autoritativa (0 token) e este card fica escondido pra não duplicar. */}
          {data && !csvProd?.temCsv && (() => {
            const com = data.totais.receitaComissionavel ?? 0;
            const bom = data.totais.receitaBomboniere ?? 0;
            return (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border-2 border-emerald-500/50 bg-emerald-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Comissionável · dá % pra equipe</div>
                  <div className="text-xl font-bold tabular-nums text-slate-900">R$ {fmtBRL(com)}</div>
                </div>
                <div className="rounded-lg border-2 border-amber-500/50 bg-amber-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Bomboniere · não comissiona</div>
                  <div className="text-xl font-bold tabular-nums text-slate-900">R$ {fmtBRL(bom)}</div>
                </div>
              </div>
            );
          })()}

          {data && data.totais.produtosSemCusto > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong>{data.totais.produtosSemCusto}</strong> produto(s) sem custo cadastrado — a margem está incompleta. Clique em
                <em> Cadastrar custos</em> para atualizar.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* v24: Ranking de Produtos via CSV (0 tokens) — comissionável × bomboniere por categoria */}
      {csvProd?.temCsv && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5" />
              Produtos vendidos (CSV · 0 tokens)
              <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600">sem API</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div className="rounded-lg border p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Total vendido</div>
                <div className="text-lg font-bold tabular-nums text-slate-900">R$ {fmtBRL(csvProd.total)}</div>
              </div>
              <div className="rounded-lg border-2 border-emerald-500/50 bg-emerald-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Comissionável · % equipe</div>
                <div className="text-lg font-bold tabular-nums text-slate-900">R$ {fmtBRL(csvProd.comissionavel)}</div>
              </div>
              <div className="rounded-lg border-2 border-amber-500/50 bg-amber-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Bomboniere · não comissiona</div>
                <div className="text-lg font-bold tabular-nums text-slate-900">R$ {fmtBRL(csvProd.bomboniere)}</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Produto</th>
                    <th className="py-2 px-2">Categoria</th>
                    <th className="py-2 px-2 text-right">Qtd</th>
                    <th className="py-2 px-2 text-right">Valor</th>
                    <th className="py-2 px-2 text-center">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {csvProd.produtos.map((p: any, i: number) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 pr-2 font-medium">{p.produto}</td>
                      <td className="py-1.5 px-2 text-muted-foreground text-xs">{p.categoria || "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{p.quantidade}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">R$ {fmtBRL(p.valor)}</td>
                      <td className="py-1.5 px-2 text-center">
                        {p.bomboniere
                          ? <Badge variant="outline" className="text-[9px] h-4 border-amber-500/50 text-amber-600 bg-amber-500/10">bomboniere</Badge>
                          : <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/50 text-emerald-600 bg-emerald-500/10">% equipe</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              Fonte: relatório "Ranking de Produtos" da Trinks (importado, 0 tokens). Bomboniere = categorias BEBIDAS/DOCES. Este ranking é por produto (sem vendedor); "quem vendeu" está no ranking de vendedores abaixo.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ranking de vendedores */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-5 w-5" />
            Ranking de vendedores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-xs text-muted-foreground">
                    <th className="py-2 px-2 w-12">#</th>
                    <th className="py-2 px-2">Profissional</th>
                    <th className="py-2 px-2 text-right">Comandas</th>
                    <th className="py-2 px-2 text-right">Unidades</th>
                    <th className="py-2 px-2 text-right">Receita</th>
                    <th className="py-2 px-2 text-right">Custo</th>
                    <th className="py-2 px-2 text-right">Margem R$</th>
                    <th className="py-2 px-2 text-right">Margem %</th>
                    <th className="py-2 px-2 text-right">Ticket médio</th>
                    <th className="py-2 px-2 text-right">% Comissão</th>
                    <th className="py-2 px-2 text-right">Comissão R$</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ranking.map((v, i) => (
                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2">
                        {i === 0 ? <span className="text-yellow-500">🥇</span>
                          : i === 1 ? <span className="text-gray-400">🥈</span>
                          : i === 2 ? <span className="text-amber-600">🥉</span>
                          : <span className="text-muted-foreground">{i + 1}</span>}
                      </td>
                      <td className="py-2 px-2 font-medium">{v.nome}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{v.comandas}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{v.unidades}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">R$ {fmtBRL(v.receita)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">R$ {fmtBRL(v.custoTotal)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">R$ {fmtBRL(v.margemRS)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{v.margemPct.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-right tabular-nums">R$ {fmtBRL(v.ticketMedio)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {v.pctComissao !== undefined ? (
                          <span title={v.pctComissaoFonte === "meta" ? "% configurada na meta deste profissional" : "% padrão global (Configurações)"}>
                            {v.pctComissao.toFixed(0)}%
                            {v.pctComissaoFonte === "default" && <span className="text-[9px] text-muted-foreground ml-0.5">*</span>}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium text-emerald-400">
                        R$ {fmtBRL(v.comissaoRS ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* v38.1: Bloco de ex-funcionários — fora do ranking principal */}
          {data?.rankingHistorico && data.rankingHistorico.length > 0 && (
            <div className="mt-4 pt-3 border-t border-card-border/50">
              <p className="text-[11px] uppercase text-muted-foreground mb-2 flex items-center gap-2">
                📜 Vendas históricas (ex-funcionários) — fora do ranking
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {data.rankingHistorico.map((v) => (
                      <tr key={v.id} className="border-b last:border-0 text-muted-foreground">
                        <td className="py-1.5 px-2 font-medium">{v.nome}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{v.comandas} comandas</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{v.unidades} un.</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">R$ {fmtBRL(v.receita)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{v.margemPct.toFixed(1)}% margem</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ranking de produtos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-5 w-5" />
            Ranking de produtos mais vendidos
            <Badge variant="outline" className="text-xs">por {ordemProdutos === "receita" ? "receita" : "unidades"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-muted-foreground">Ordenar por:</span>
            <Button
              size="sm"
              variant={ordemProdutos === "receita" ? "default" : "outline"}
              onClick={() => setOrdemProdutos("receita")}
              className="h-7"
            >
              Receita (R$)
            </Button>
            <Button
              size="sm"
              variant={ordemProdutos === "unidades" ? "default" : "outline"}
              onClick={() => setOrdemProdutos("unidades")}
              className="h-7"
            >
              Quantidade
            </Button>
            <Button
              size="sm"
              variant={ordemProdutos === "margem" ? "default" : "outline"}
              onClick={() => setOrdemProdutos("margem")}
              className="h-7"
            >
              Margem R$
            </Button>
          </div>
          {!data || data.produtos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-xs text-muted-foreground">
                    <th className="py-2 px-2 w-12">#</th>
                    <th className="py-2 px-2">Produto</th>
                    <th className="py-2 px-2">Categoria</th>
                    <th className="py-2 px-2 text-right">Unid.</th>
                    <th className="py-2 px-2 text-right">Preço venda</th>
                    <th className="py-2 px-2 text-right">Custo unit.</th>
                    <th className="py-2 px-2 text-right">Receita</th>
                    <th className="py-2 px-2 text-right">Custo total</th>
                    <th className="py-2 px-2 text-right">Margem R$</th>
                    <th className="py-2 px-2 text-right">Margem %</th>
                    <th className="py-2 px-2 w-10 text-center">✏️</th>
                  </tr>
                </thead>
                <tbody>
                  {produtosOrdenados.map((p, i) => (
                    <tr key={p.id} className={`border-b last:border-0 hover:bg-muted/30 ${i < 3 ? "bg-muted/20" : ""}`}>
                      <td className="py-2 px-2 text-base">
                        {i === 0 ? <span title="1º lugar">🥇</span>
                          : i === 1 ? <span title="2º lugar">🥈</span>
                          : i === 2 ? <span title="3º lugar">🥉</span>
                          : <span className="text-muted-foreground text-sm">{i + 1}</span>}
                      </td>
                      <td className="py-2 px-2 font-medium">
                        {p.nome}
                        {p.bomboniere
                          ? <Badge variant="outline" className="ml-2 text-[9px] h-4 border-amber-500/50 text-amber-600 bg-amber-500/10">bomboniere</Badge>
                          : <Badge variant="outline" className="ml-2 text-[9px] h-4 border-emerald-500/50 text-emerald-600 bg-emerald-500/10">% equipe</Badge>}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">{p.categoria || "—"}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">{p.unidades}</td>
                      <td className="py-2 px-2 text-right tabular-nums">R$ {fmtBRL(p.precoVendaMedio)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {p.custoUnit > 0 ? `R$ ${fmtBRL(p.custoUnit)}` : <span className="text-yellow-600 text-xs">sem custo</span>}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">R$ {fmtBRL(p.receita)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">R$ {fmtBRL(p.custoTotal)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">R$ {fmtBRL(p.margemRS)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{p.margemPct.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => setEditandoId(p.id)}
                          title="Editar preço de compra e venda"
                          data-testid={`btn-editar-${p.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-card-border bg-muted/40 font-semibold">
                    <td className="py-2.5 px-2" colSpan={3}>
                      TOTAL — {produtosOrdenados.length} produtos
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {produtosOrdenados.reduce((s, p) => s + p.unidades, 0)}
                    </td>
                    <td className="py-2.5 px-2"></td>
                    <td className="py-2.5 px-2"></td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-emerald-400">
                      R$ {fmtBRL(produtosOrdenados.reduce((s, p) => s + p.receita, 0))}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                      R$ {fmtBRL(produtosOrdenados.reduce((s, p) => s + p.custoTotal, 0))}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-emerald-400">
                      R$ {fmtBRL(produtosOrdenados.reduce((s, p) => s + p.margemRS, 0))}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {(() => {
                        const rec = produtosOrdenados.reduce((s, p) => s + p.receita, 0);
                        const mar = produtosOrdenados.reduce((s, p) => s + p.margemRS, 0);
                        return rec > 0 ? `${((mar / rec) * 100).toFixed(1)}%` : "—";
                      })()}
                    </td>
                    <td className="py-2.5 px-2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showCustos && <CustosModal onClose={() => { setShowCustos(false); carregar(); }} />}
      {editandoId && (
        <EditarPrecoModal
          produtoId={editandoId}
          onClose={() => setEditandoId(null)}
          onSalvo={() => { setEditandoId(null); carregar(); }}
        />
      )}
    </div>
  );
}

// ─── Modal de edição rápida (1 produto: custo + preço venda) ────────────────
function EditarPrecoModal({
  produtoId,
  onClose,
  onSalvo,
}: {
  produtoId: string;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [produto, setProduto] = useState<ProdutoCusto | null>(null);
  const [custo, setCusto] = useState("");
  const [precoVenda, setPrecoVenda] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(`${API_BASE}/api/produtos/custos`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        const p = (j.produtos || []).find((x: ProdutoCusto) => String(x.id) === String(produtoId));
        if (!p) throw new Error("Produto não encontrado");
        setProduto(p);
        setCusto(p.custo > 0 ? String(p.custo) : "");
        setPrecoVenda(p.precoVendaManual && p.precoVendaManual > 0 ? String(p.precoVendaManual) : "");
      } catch (e: any) {
        toast({ title: "Erro", description: e.message, variant: "destructive" });
        onClose();
      } finally {
        setCarregando(false);
      }
    })();
    /* eslint-disable-next-line */
  }, [produtoId]);

  const parse = (v: string) => Number(String(v).replace(",", ".")) || 0;
  const custoNum = parse(custo);
  const vendaNum = parse(precoVenda);
  const margem = vendaNum > 0 ? ((vendaNum - custoNum) / vendaNum) * 100 : 0;

  const salvar = async () => {
    setSalvando(true);
    try {
      const body: any = { custo: custoNum };
      body.precoVenda = precoVenda.trim() === "" ? null : vendaNum;
      const r = await authFetch(`${API_BASE}/api/produtos/custos/${produtoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao salvar");
      toast({ title: "Atualizado", description: produto?.nome });
      onSalvo();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Editar preços
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{produto?.nome || "—"}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0"><X className="h-4 w-4" /></Button>
        </div>

        {carregando ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Preço de compra (R$)</label>
                <Input type="number" step="0.01" min="0" value={custo} onChange={e => setCusto(e.target.value)} placeholder="0,00" />
                <p className="text-[11px] text-muted-foreground mt-1">Quanto você paga ao fornecedor.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Preço de venda (R$)</label>
                <Input
                  type="number" step="0.01" min="0"
                  value={precoVenda}
                  onChange={e => setPrecoVenda(e.target.value)}
                  placeholder={produto?.precoVendaCatalogo ? `Trinks: ${produto.precoVendaCatalogo.toFixed(2)}` : "0,00"}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {produto?.precoVendaCatalogo ? <>Trinks: R$ {fmtBRL(produto.precoVendaCatalogo)}. </> : null}
                  Deixe em branco para usar o do Trinks.
                </p>
              </div>
              {custoNum > 0 && vendaNum > 0 && (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex items-center justify-between">
                  <span className="text-muted-foreground">Margem</span>
                  <span className={`font-semibold ${margem < 30 ? "text-red-500" : margem < 50 ? "text-amber-500" : "text-emerald-500"}`}>
                    R$ {fmtBRL(vendaNum - custoNum)} ({margem.toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
              <Button size="sm" onClick={salvar} disabled={salvando}>
                {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────
function Stat({
  icon, label, valor, reais, suffix, muted, bold, alerta,
}: {
  icon?: React.ReactNode;
  label: string;
  valor?: number;
  reais?: number;
  suffix?: string;
  muted?: boolean;
  bold?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className={`rounded border px-3 py-2 ${alerta ? "border-yellow-300 bg-yellow-50" : "bg-card"}`}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`tabular-nums ${bold ? "font-bold" : muted ? "text-muted-foreground" : ""}`}>
        {reais !== undefined ? `R$ ${fmtBRL(reais)}` : `${valor ?? 0}${suffix || ""}`}
      </div>
    </div>
  );
}

// ─── Modal de cadastro de custos ──────────────────────────────────────
function CustosModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [produtos, setProdutos] = useState<ProdutoCusto[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");
  // edits: { [id]: { custo?: string, precoVenda?: string } }
  const [edits, setEdits] = useState<Record<string, { custo?: string; precoVenda?: string }>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(`${API_BASE}/api/produtos/custos`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setProdutos(j.produtos || []);
      } catch (e: any) {
        toast({ title: "Erro ao carregar", description: e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
    /* eslint-disable-next-line */
  }, []);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return produtos;
    return produtos.filter(p => p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
  }, [produtos, busca]);

  const parse = (v: string) => Number(String(v).replace(",", ".")) || 0;
  const setEditCusto = (id: string, v: string) =>
    setEdits(e => ({ ...e, [id]: { ...(e[id] || {}), custo: v } }));
  const setEditVenda = (id: string, v: string) =>
    setEdits(e => ({ ...e, [id]: { ...(e[id] || {}), precoVenda: v } }));

  const salvarTudo = async () => {
    const items = Object.entries(edits).map(([id, ed]) => {
      const it: any = { id };
      if (ed.custo !== undefined) it.custo = parse(ed.custo);
      if (ed.precoVenda !== undefined) {
        it.precoVenda = ed.precoVenda.trim() === "" ? null : parse(ed.precoVenda);
      }
      return it;
    });
    if (items.length === 0) {
      toast({ title: "Nada para salvar" });
      return;
    }
    setSalvando(true);
    try {
      const r = await authFetch(`${API_BASE}/api/produtos/custos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      toast({ title: "Preços atualizados", description: `${j.count} produto(s)` });
      // Atualiza visual
      setProdutos(prev => prev.map(p => {
        const ed = edits[p.id];
        if (!ed) return p;
        const next: ProdutoCusto = { ...p, atualizadoEm: new Date().toISOString() };
        if (ed.custo !== undefined) next.custo = parse(ed.custo);
        if (ed.precoVenda !== undefined) {
          if (ed.precoVenda.trim() === "") {
            next.precoVendaManual = null;
            next.precoVenda = next.precoVendaCatalogo || next.precoVendaObservado || 0;
          } else {
            const novoVenda = parse(ed.precoVenda);
            next.precoVendaManual = novoVenda;
            next.precoVenda = novoVenda;
          }
        }
        return next;
      }));
      setEdits({});
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg max-w-5xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <h2 className="font-semibold">Preços de compra e venda dos produtos</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
        </div>

        <div className="px-5 py-3 border-b flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar produto..."
              className="pl-8"
            />
          </div>
          <Button onClick={salvarTudo} disabled={salvando || Object.keys(edits).length === 0}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar {Object.keys(edits).length > 0 ? `(${Object.keys(edits).length})` : ""}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 px-2">Produto</th>
                  <th className="py-2 px-2">Categoria</th>
                  <th className="py-2 px-2 text-right w-32">Preço compra</th>
                  <th className="py-2 px-2 text-right w-32">Preço venda</th>
                  <th className="py-2 px-2 text-right w-20">Margem</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(p => {
                  const ed = edits[p.id] || {};
                  const custoAtual = ed.custo !== undefined ? parse(ed.custo) : p.custo;
                  // valor exibido no campo de venda: edit ou precoVendaManual (NUNCA o catálogo)
                  let vendaStr: string;
                  if (ed.precoVenda !== undefined) vendaStr = ed.precoVenda;
                  else if (p.precoVendaManual && p.precoVendaManual > 0) vendaStr = String(p.precoVendaManual);
                  else vendaStr = "";
                  const vendaAtual = vendaStr.trim() !== ""
                    ? parse(vendaStr)
                    : (p.precoVendaCatalogo || p.precoVendaObservado || p.precoVenda || 0);
                  const margem = vendaAtual > 0 ? ((vendaAtual - custoAtual) / vendaAtual) * 100 : 0;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium">{p.nome}</td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">{p.categoria || "—"}</td>
                      <td className="py-2 px-2 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={ed.custo !== undefined ? ed.custo : (p.custo || "")}
                          onChange={e => setEditCusto(p.id, e.target.value)}
                          className="w-24 h-8 text-right ml-auto"
                          placeholder="0,00"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={vendaStr}
                          onChange={e => setEditVenda(p.id, e.target.value)}
                          className="w-24 h-8 text-right ml-auto"
                          placeholder={p.precoVendaCatalogo ? `Trinks: ${p.precoVendaCatalogo.toFixed(2)}` : "0,00"}
                          title={p.precoVendaCatalogo ? `Preço do Trinks: R$ ${fmtBRL(p.precoVendaCatalogo)}` : ""}
                        />
                      </td>
                      <td className={`py-2 px-2 text-right tabular-nums text-xs ${custoAtual > 0 && vendaAtual > 0 ? (margem < 30 ? "text-red-600" : margem < 50 ? "text-yellow-600" : "text-green-600") : "text-muted-foreground"}`}>
                        {custoAtual > 0 && vendaAtual > 0 ? `${margem.toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtrados.length} produto(s) listado(s)</span>
          <span>Preço de venda em branco = usar o cadastrado no Trinks</span>
        </div>
      </div>
    </div>
  );
}
