import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, AlertTriangle, TrendingDown, RefreshCw, Loader2, Search, Info, Trophy, User, Pencil, Save, X } from "lucide-react";
import { formatCurrency } from "@/lib/demoData";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface Produto {
  id: number;
  nome: string;
  categoria: string;
  fabricante: string;
  saldo: number;
  minimo: number;
  custoMedio: number;
  custo?: number;
  precoVendaManual?: number | null;
  precoVendaCatalogo?: number;
  precoVendaObservado?: number;
  valorVenda: number;
  valorEstoque: number;
  nivel: "ok" | "atencao" | "critico";
  vendidos30d: number;
  faturamento30d: number;
  ultimaVenda: string | null;
  diasDesdeUltimaVenda: number | null;
}

interface Movimentacao {
  id: string | number;
  data: string;
  produtoId: number;
  produtoNome: string;
  tipo: string;
  quantidade: number;
  valor: number;
  valorUnitario?: number;
  vendedorId?: number | null;
  vendedor?: string;
  clienteNome?: string;
  comandaId?: number;
  observacao?: string;
}

interface VendedorRanking {
  id: number;
  nome: string;
  unidades: number;
  faturamento: number;
  produtosDistintos: number;
  comandas: number;
}

interface Resumo {
  atualizadoEm: string;
  fonte?: string;
  limitacaoApi?: string;
  janela?: { dataInicio: string; dataFim: string };
  totalProdutos: number;
  produtosEmAlerta: number;
  produtosCriticos: number;
  valorTotalEstoque: number;
  movimentacoesHojeCount: number;
  saidasHoje: number;
  entradasHoje: number;
  faturamentoProdutos30d?: number;
  produtos: Produto[];
  alertas: Produto[];
  movimentacoesHoje: Movimentacao[];
  rankingVendedores?: VendedorRanking[];
}

function formatarDiasUltimaVenda(dias: number | null): string {
  if (dias === null) return "nunca vendido";
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return "há +30 dias";
}

export default function Estoque() {
  const { toast } = useToast();
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroNivel, setFiltroNivel] = useState<"todos" | "alerta" | "critico">("todos");
  const [editando, setEditando] = useState<Produto | null>(null);

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
    // ordena: críticos primeiro, depois atenção, depois ok (mais vendidos primeiro)
    return [...lista].sort((a, b) => {
      const ord = { critico: 0, atencao: 1, ok: 2 };
      if (ord[a.nivel] !== ord[b.nivel]) return ord[a.nivel] - ord[b.nivel];
      if (b.vendidos30d !== a.vendidos30d) return b.vendidos30d - a.vendidos30d;
      return a.nome.localeCompare(b.nome);
    });
  }, [resumo, busca, filtroNivel]);

  const corNivel = (n: string) =>
    n === "critico" ? "bg-red-500/15 text-red-400 border-red-500/30" :
    n === "atencao" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";

  const labelNivel = (n: string) =>
    n === "critico" ? "Parado +30d" :
    n === "atencao" ? "Parado 14–30d" :
    "Ativo";

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            Controle de Produtos
          </h2>
          <p className="text-sm text-muted-foreground">
            Análise de produtos e ranking de vendedores baseado nas comandas dos últimos 30 dias (Trinks)
          </p>
        </div>
        <Button onClick={carregar} disabled={loading} variant="outline" size="sm">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-2">Atualizar</span>
        </Button>
      </div>

      {/* Aviso sobre limitação da API */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            A API da Trinks não expõe saldo atual, custo médio nem estoque mínimo.
            Por isso, a análise abaixo usa o <strong className="text-foreground">histórico de comandas (transações)</strong> dos
            últimos 30 dias para identificar produtos parados, produtos ativos e
            <strong className="text-foreground"> quem vendeu cada item</strong> (profissional responsável pela venda).
            Para saldo exato, consulte diretamente o sistema Trinks.
          </div>
        </CardContent>
      </Card>

      {/* Erro */}
      {erro && (
        <Card className="border-red-500/30">
          <CardContent className="pt-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-red-400">Não foi possível carregar os produtos</div>
              <div className="text-muted-foreground mt-0.5">{erro}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                Pode ser limite da API da Trinks. Tente novamente em alguns minutos.
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
                <div className="text-xs text-muted-foreground">Produtos parados</div>
                <div className="text-2xl font-semibold mt-1 text-amber-400">
                  {resumo.produtosEmAlerta}
                </div>
                {resumo.produtosCriticos > 0 && (
                  <div className="text-[11px] text-red-400 mt-0.5">
                    {resumo.produtosCriticos} há mais de 30 dias
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Faturamento produtos (30d)</div>
                <div className="text-2xl font-semibold mt-1">
                  {formatCurrency(resumo.faturamentoProdutos30d || 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Vendas hoje</div>
                <div className="text-2xl font-semibold mt-1">{resumo.movimentacoesHojeCount}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  itens vendidos
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Alertas - produtos parados */}
          {resumo.alertas.length > 0 && (
            <Card className="border-amber-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Produtos sem giro ({resumo.alertas.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {resumo.alertas.map((p) => (
                    <div key={p.id} className={`flex items-center justify-between px-3 py-2 rounded-md border ${corNivel(p.nivel)}`}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{p.nome}</div>
                        <div className="text-[11px] opacity-80">
                          {p.categoria || "Sem categoria"} · Última venda: {formatarDiasUltimaVenda(p.diasDesdeUltimaVenda)}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <div className="text-[11px] uppercase tracking-wide opacity-70">
                          {labelNivel(p.nivel)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ranking de vendedores de produtos */}
          {resumo.rankingVendedores && resumo.rankingVendedores.length > 0 && (
            <Card className="border-amber-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  Ranking de vendedores de produtos (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">#</th>
                        <th className="text-left py-2 px-2 font-medium">Profissional</th>
                        <th className="text-right py-2 px-2 font-medium">Unidades</th>
                        <th className="text-right py-2 px-2 font-medium">Faturamento</th>
                        <th className="text-right py-2 px-2 font-medium hidden sm:table-cell">Produtos distintos</th>
                        <th className="text-right py-2 px-2 font-medium hidden md:table-cell">Comandas</th>
                        <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Ticket médio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumo.rankingVendedores.map((v, idx) => {
                        const ticketMedio = v.comandas > 0 ? v.faturamento / v.comandas : 0;
                        const medalha = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "";
                        return (
                          <tr key={v.id} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-2 px-2 text-muted-foreground font-medium">
                              {medalha || idx + 1}
                            </td>
                            <td className="py-2 px-2">
                              <div className="font-medium">{v.nome}</div>
                              <div className="text-[10px] text-muted-foreground">ID {v.id}</div>
                            </td>
                            <td className="py-2 px-2 text-right font-semibold">{v.unidades}</td>
                            <td className="py-2 px-2 text-right text-emerald-400 font-medium">
                              {formatCurrency(v.faturamento)}
                            </td>
                            <td className="py-2 px-2 text-right text-muted-foreground hidden sm:table-cell">
                              {v.produtosDistintos}
                            </td>
                            <td className="py-2 px-2 text-right text-muted-foreground hidden md:table-cell">
                              {v.comandas}
                            </td>
                            <td className="py-2 px-2 text-right text-muted-foreground hidden lg:table-cell">
                              {ticketMedio > 0 ? formatCurrency(ticketMedio) : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  Base: campo <code className="px-1 rounded bg-muted">IdProfissionalQueRealizouAVenda</code> das comandas (Trinks).
                  Itens sem profissional registrado não entram no ranking.
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
                        {f === "todos" ? "Todos" : f === "alerta" ? "Parados" : "Sem giro +30d"}
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
                        <th className="text-right py-2 px-2 font-medium">Vendidos (30d)</th>
                        <th className="text-right py-2 px-2 font-medium hidden sm:table-cell">Faturamento (30d)</th>
                        <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Preço compra</th>
                        <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Preço venda</th>
                        <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Última venda</th>
                        <th className="text-center py-2 px-2 font-medium">Status</th>
                        <th className="text-center py-2 px-2 font-medium w-16">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtosFiltrados.map((p) => {
                        const custo = Number(p.custo ?? p.custoMedio ?? 0);
                        const precoVenda = Number(p.valorVenda || 0);
                        return (
                        <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 px-2">
                            <div className="font-medium">{p.nome}</div>
                            {p.categoria && (
                              <div className="text-[11px] text-muted-foreground">{p.categoria}</div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-semibold">
                            {p.vendidos30d}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground hidden sm:table-cell">
                            {p.faturamento30d > 0 ? formatCurrency(p.faturamento30d) : "-"}
                          </td>
                          <td className="py-2 px-2 text-right hidden lg:table-cell">
                            {custo > 0 ? (
                              <span className="text-muted-foreground">{formatCurrency(custo)}</span>
                            ) : (
                              <span className="text-amber-400 text-xs">cadastrar</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground hidden lg:table-cell">
                            {precoVenda > 0 ? (
                              <span className={p.precoVendaManual ? "text-emerald-400" : ""}>
                                {formatCurrency(precoVenda)}
                                {p.precoVendaManual ? <span className="ml-1 text-[10px]">(manual)</span> : null}
                              </span>
                            ) : "-"}
                          </td>
                          <td className="py-2 px-2 text-muted-foreground text-xs hidden md:table-cell">
                            {formatarDiasUltimaVenda(p.diasDesdeUltimaVenda)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${corNivel(p.nivel)}`}>
                              {labelNivel(p.nivel)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setEditando(p)}
                              title="Editar preço de compra e venda"
                              data-testid={`btn-editar-${p.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                        );
                      })}
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
                <CardTitle className="text-sm">Vendas de produtos hoje</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {resumo.movimentacoesHoje.map((m, i) => {
                    const hora = m.data ? new Date(m.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";
                    return (
                      <div key={String(m.id) || i} className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/30">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <TrendingDown className="w-4 h-4 text-red-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate font-medium">{m.produtoNome || "—"}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                              {m.vendedor && m.vendedor !== "—" && (
                                <span className="inline-flex items-center gap-1 text-amber-400">
                                  <User className="w-3 h-3" />
                                  {m.vendedor}
                                </span>
                              )}
                              {m.clienteNome && (
                                <span className="truncate">→ {m.clienteNome}</span>
                              )}
                              {hora && <span>· {hora}</span>}
                              {m.comandaId && <span className="opacity-70">#{m.comandaId}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="text-sm font-medium text-red-400">
                            −{m.quantidade}
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

      {/* Modal de edição de preços */}
      {editando && (
        <EditarProdutoModal
          produto={editando}
          onClose={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            carregar();
          }}
          onErro={(msg) => toast({ title: "Erro ao salvar", description: msg, variant: "destructive" })}
          onSucesso={(msg) => toast({ title: "Atualizado", description: msg })}
        />
      )}
    </div>
  );
}

// ─── Modal de edição de preços (custo + venda) ──────────────────────────
function EditarProdutoModal({
  produto,
  onClose,
  onSalvo,
  onErro,
  onSucesso,
}: {
  produto: Produto;
  onClose: () => void;
  onSalvo: () => void;
  onErro: (msg: string) => void;
  onSucesso: (msg: string) => void;
}) {
  const [custo, setCusto] = useState<string>(
    produto.custo && produto.custo > 0 ? String(produto.custo) : ""
  );
  const [precoVenda, setPrecoVenda] = useState<string>(
    produto.precoVendaManual && produto.precoVendaManual > 0 ? String(produto.precoVendaManual) : ""
  );
  const [salvando, setSalvando] = useState(false);

  const parse = (v: string) => Number(String(v).replace(",", ".")) || 0;
  const custoNum = parse(custo);
  const vendaNum = parse(precoVenda);
  const margem = vendaNum > 0 && custoNum >= 0 ? ((vendaNum - custoNum) / vendaNum) * 100 : 0;

  const salvar = async () => {
    setSalvando(true);
    try {
      const body: any = { custo: custoNum };
      if (precoVenda.trim() === "") {
        body.precoVenda = null; // limpa manual, volta a usar Trinks
      } else {
        body.precoVenda = vendaNum;
      }
      const r = await authFetch(`${API_BASE}/api/produtos/custos/${produto.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao salvar");
      onSucesso(`${produto.nome} atualizado`);
      onSalvo();
    } catch (e: any) {
      onErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-lg max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
        data-testid="editar-produto-modal"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Editar preços
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{produto.nome}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Preço de compra (R$)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={custo}
              onChange={(e) => setCusto(e.target.value)}
              placeholder="0,00"
              data-testid="input-custo"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Quanto você paga ao fornecedor por unidade.
            </p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Preço de venda (R$)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={precoVenda}
              onChange={(e) => setPrecoVenda(e.target.value)}
              placeholder={
                produto.precoVendaCatalogo && produto.precoVendaCatalogo > 0
                  ? `Trinks: ${produto.precoVendaCatalogo.toFixed(2)}`
                  : "0,00"
              }
              data-testid="input-preco-venda"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {produto.precoVendaCatalogo && produto.precoVendaCatalogo > 0 ? (
                <>Trinks: {formatCurrency(produto.precoVendaCatalogo)}. </>
              ) : null}
              Deixe em branco para usar o preço do Trinks.
            </p>
          </div>

          {custoNum > 0 && vendaNum > 0 && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Margem</span>
                <span className={`font-semibold ${margem < 30 ? "text-red-400" : margem < 50 ? "text-amber-400" : "text-emerald-400"}`}>
                  {(vendaNum - custoNum).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ({margem.toFixed(1)}%)
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={salvar} disabled={salvando} data-testid="btn-salvar">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
