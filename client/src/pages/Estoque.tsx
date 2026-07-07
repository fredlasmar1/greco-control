import { useEffect, useState, useMemo, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, AlertTriangle, TrendingDown, TrendingUp, RefreshCw, Loader2, Search, Info, Trophy, User, Pencil, Save, X, Plus, Minus, ClipboardList, History, Trash2, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
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
  nivel: "ok" | "atencao" | "critico" | "ruptura";
  giroLento?: boolean;
  parado?: boolean;
  vendidos30d: number;
  vendidosMes?: number;
  reporSugerido?: number;
  faturamento30d: number;
  ultimaVenda: string | null;
  diasDesdeUltimaVenda: number | null;
}

interface MovimentacaoManual {
  id: string;
  produtoId: string;
  produtoNome?: string;
  tipo: "entrada" | "saida" | "inventario";
  quantidade: number;
  delta: number;
  custoUnitario: number;
  motivo: string;
  data: string;
  usuario?: string;
  saldoAnterior?: number;
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
  // v38.3: status de frescor (quando alguma fonte veio do cache)
  cacheUsado?: boolean;
  cacheIdadeHoras?: number | null;
  fontesCache?: { produtos: string | null; profissionais: string | null; transacoes: string | null };
  limitacaoApi?: string;
  janela?: { dataInicio: string; dataFim: string };
  totalProdutos: number;
  produtosEmAlerta: number;
  produtosCriticos: number;
  produtosGiroLento?: number;
  produtosParados?: number;
  valorEmGiroLento?: number;
  valorParado?: number;
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

// KPI premium no padrão do Dashboard (label uppercase + valor bold + ícone em quadrado).
function KpiTile({ icon, label, value, sub, valorCor, accent }: { icon: ReactNode; label: string; value: string; sub?: string; valorCor?: string; accent?: "red" | "amber" | "emerald" | "primary" }) {
  const ring = accent === "red" ? "bg-red-500/10 text-red-500" : accent === "amber" ? "bg-amber-500/10 text-amber-500" : accent === "emerald" ? "bg-emerald-500/10 text-emerald-500" : "bg-primary/10 text-primary";
  return (
    <Card className="bg-card border-card-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-xl font-bold mt-1 truncate ${valorCor || ""}`}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${ring}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
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
  const [filtroNivel, setFiltroNivel] = useState<"todos" | "alerta" | "critico" | "ruptura">("todos");
  const [editando, setEditando] = useState<Produto | null>(null);
  const [ajustando, setAjustando] = useState<Produto | null>(null);
  const [historicoDe, setHistoricoDe] = useState<Produto | null>(null);
  const [penteFino, setPenteFino] = useState(false);

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
    if (filtroNivel === "ruptura") lista = lista.filter(p => p.nivel === "ruptura");
    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(p =>
        p.nome.toLowerCase().includes(q) ||
        p.categoria.toLowerCase().includes(q) ||
        p.fabricante.toLowerCase().includes(q)
      );
    }
    // ordena: ruptura primeiro, depois críticos, atenção, ok (mais vendidos primeiro)
    return [...lista].sort((a, b) => {
      const ord: Record<string, number> = { ruptura: 0, critico: 1, atencao: 2, ok: 3 };
      if (ord[a.nivel] !== ord[b.nivel]) return ord[a.nivel] - ord[b.nivel];
      if (b.vendidos30d !== a.vendidos30d) return b.vendidos30d - a.vendidos30d;
      return a.nome.localeCompare(b.nome);
    });
  }, [resumo, busca, filtroNivel]);

  const corNivel = (n: string) =>
    n === "ruptura" ? "bg-red-600/20 text-red-400 border-red-600/40" :
    n === "critico" ? "bg-red-500/15 text-red-400 border-red-500/30" :
    n === "atencao" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";

  const labelNivel = (n: string) =>
    n === "ruptura" ? "Estoque baixo" :
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
            Pente fino, baixa automática das vendas e alerta de reposição — saldo, vendidos e o que repor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setPenteFino(v => !v)} variant={penteFino ? "default" : "outline"} size="sm">
            <ClipboardList className="w-4 h-4 mr-1" />{penteFino ? "Sair do pente fino" : "Pente fino"}
          </Button>
          <Button onClick={carregar} disabled={loading} variant="outline" size="sm">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>
      </div>

      {/* Baixa automática (status + consolidar ontem) */}
      <BaixaAutomaticaCard />

      {/* Pente fino — contagem física de todos os produtos */}
      {penteFino && resumo && (
        <PenteFinoSection produtos={resumo.produtos} onSalvo={() => { setPenteFino(false); carregar(); }} />
      )}

      {/* Como funciona (discreto, premium) */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-3 flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><Info className="w-3.5 h-3.5" /></div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            O saldo vem do <strong className="text-foreground">pente fino</strong> (contagem física) mais as <strong className="text-foreground">baixas automáticas</strong> das vendas do dia. Faça o pente fino, cadastre o mínimo, e a partir daí o estoque se mantém sozinho — com alerta toda terça do que repor.
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
          {(() => {
            const rup = resumo.produtos.filter(p => p.nivel === "ruptura").length;
            const parados = resumo.produtos.filter(p => p.nivel === "critico" || p.nivel === "atencao").length;
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiTile icon={<Package className="w-4 h-4" />} label="Produtos" value={String(resumo.totalProdutos)} sub={`${formatCurrency(resumo.valorTotalEstoque || 0)} em estoque`} />
                <KpiTile icon={<ArrowDownCircle className="w-4 h-4" />} label="Repor (estoque baixo)" value={String(rup)} valorCor={rup > 0 ? "text-red-500" : "text-emerald-500"} accent={rup > 0 ? "red" : "emerald"} sub={rup > 0 ? "cadastre o mínimo e conte" : "tudo ok"} />
                <KpiTile icon={<TrendingDown className="w-4 h-4" />} label="Sem giro" value={String(parados)} valorCor="text-amber-500" accent="amber" sub={`${resumo.produtosCriticos || 0} parados +30d`} />
                <KpiTile icon={<TrendingUp className="w-4 h-4" />} label="Faturamento produtos" value={formatCurrency(resumo.faturamentoProdutos30d || 0)} sub="últimos 30 dias" />
              </div>
            );
          })()}

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

          {/* Giro lento — produtos que pesam capital sem girar */}
          {(() => {
            const giroLento = resumo.produtos.filter(p => p.giroLento);
            const parados = resumo.produtos.filter(p => p.parado);
            if (giroLento.length === 0 && parados.length === 0) return null;
            return (
              <Card className="border-amber-500/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-4 h-4 text-amber-400" />
                      Giro lento (capital parado)
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {parados.length > 0 && (
                        <span className="text-red-400">
                          <strong>{parados.length}</strong> parado{parados.length !== 1 ? "s" : ""}
                          {(resumo.valorParado || 0) > 0 && ` • ${formatCurrency(resumo.valorParado || 0)}`}
                        </span>
                      )}
                      {giroLento.length > 0 && (
                        <span className="text-amber-400">
                          <strong>{giroLento.length}</strong> giro lento
                          {(resumo.valorEmGiroLento || 0) > 0 && ` • ${formatCurrency(resumo.valorEmGiroLento || 0)}`}
                        </span>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="text-left py-2 px-2 font-medium">Produto</th>
                          <th className="text-right py-2 px-2 font-medium">Saldo</th>
                          <th className="text-right py-2 px-2 font-medium hidden sm:table-cell">Vend. 30d</th>
                          <th className="text-right py-2 px-2 font-medium hidden md:table-cell">Última venda</th>
                          <th className="text-right py-2 px-2 font-medium">R$ parado</th>
                          <th className="text-right py-2 px-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...parados, ...giroLento]
                          .sort((a, b) => (b.valorEstoque || 0) - (a.valorEstoque || 0))
                          .slice(0, 15)
                          .map(p => (
                            <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-2 px-2 font-medium">{p.nome}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{p.saldo}</td>
                              <td className="py-2 px-2 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{p.vendidos30d}</td>
                              <td className="py-2 px-2 text-right text-muted-foreground hidden md:table-cell text-xs">
                                {formatarDiasUltimaVenda(p.diasDesdeUltimaVenda)}
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums font-medium">{formatCurrency(p.valorEstoque)}</td>
                              <td className="py-2 px-2 text-right">
                                {p.parado ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-400">parado</span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400">giro lento</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-2">
                    <strong>Parado</strong>: tem saldo mas sem venda há 60+ dias.
                    {" "}<strong>Giro lento</strong>: tem saldo, vende ≤ 2 unidades em 30 dias.
                    {" "}Ordenado por valor parado decrescente (top 15).
                  </div>
                </CardContent>
              </Card>
            );
          })()}

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
                    {(["todos", "ruptura", "alerta", "critico"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFiltroNivel(f)}
                        className={`px-3 py-1.5 text-xs ${filtroNivel === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {f === "todos" ? "Todos" : f === "ruptura" ? "Estoque baixo" : f === "alerta" ? "Parados" : "Sem giro +30d"}
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
                        <th className="text-right py-2 px-2 font-medium">Saldo</th>
                        <th className="text-right py-2 px-2 font-medium">Vend. mês</th>
                        <th className="text-right py-2 px-2 font-medium">Repor</th>
                        <th className="text-right py-2 px-2 font-medium hidden md:table-cell">Vendidos (30d)</th>
                        <th className="text-right py-2 px-2 font-medium hidden sm:table-cell">Faturamento (30d)</th>
                        <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Preço compra</th>
                        <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Preço venda</th>
                        <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Última venda</th>
                        <th className="text-center py-2 px-2 font-medium">Status</th>
                        <th className="text-center py-2 px-2 font-medium w-28">Ações</th>
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
                          <td className="py-2 px-2 text-right">
                            <div className={`font-semibold ${p.nivel === "ruptura" ? "text-red-400" : ""}`}>
                              {p.saldo}
                            </div>
                            {p.minimo > 0 && (
                              <div className="text-[10px] text-muted-foreground">mín {p.minimo}</div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-semibold">
                            {(p.vendidosMes ?? 0) > 0 ? p.vendidosMes : <span className="text-muted-foreground">-</span>}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {(p.reporSugerido ?? 0) > 0
                              ? <span className="font-bold text-red-500">{p.reporSugerido}</span>
                              : <span className="text-emerald-500 text-xs">ok</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground hidden md:table-cell">
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
                            <div className="flex items-center justify-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setAjustando(p)}
                                title="Ajustar saldo (entrada/saída/inventário)"
                                data-testid={`btn-ajustar-${p.id}`}
                              >
                                <ClipboardList className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setHistoricoDe(p)}
                                title="Histórico de movimentações"
                                data-testid={`btn-historico-${p.id}`}
                              >
                                <History className="w-3.5 h-3.5" />
                              </Button>
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
                            </div>
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

          <div className="text-[11px] text-muted-foreground text-center pt-1 space-y-1">
            <div>Atualizado em {new Date(resumo.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
            {resumo.cacheUsado && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10">
                ⚠️ Trinks API indisponível — usando cache de {resumo.cacheIdadeHoras !== null && resumo.cacheIdadeHoras !== undefined ? `${resumo.cacheIdadeHoras}h atrás` : "sessão anterior"}
              </div>
            )}
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

      {/* Modal de ajuste de saldo */}
      {ajustando && (
        <AjustarSaldoModal
          produto={ajustando}
          onClose={() => setAjustando(null)}
          onSalvo={() => {
            setAjustando(null);
            carregar();
          }}
          onErro={(msg) => toast({ title: "Erro", description: msg, variant: "destructive" })}
          onSucesso={(msg) => toast({ title: "Saldo atualizado", description: msg })}
        />
      )}

      {/* Modal de histórico de movimentações */}
      {historicoDe && (
        <HistoricoMovimentacoesModal
          produto={historicoDe}
          onClose={() => setHistoricoDe(null)}
          onAlterado={() => {
            carregar();
          }}
          onErro={(msg) => toast({ title: "Erro", description: msg, variant: "destructive" })}
          onSucesso={(msg) => toast({ title: "Removido", description: msg })}
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
  const [comissao, setComissao] = useState<string>(
    (produto as any).comissaoPct != null ? String((produto as any).comissaoPct) : ""
  );
  const [salvando, setSalvando] = useState(false);

  const parse = (v: string) => Number(String(v).replace(",", ".")) || 0;
  const custoNum = parse(custo);
  const vendaNum = parse(precoVenda);
  const comNum = parse(comissao);
  const comissaoRS = vendaNum * (comNum / 100);
  // margem real = venda − custo − comissão do barbeiro
  const margem = vendaNum > 0 ? ((vendaNum - custoNum - comissaoRS) / vendaNum) * 100 : 0;

  const salvar = async () => {
    setSalvando(true);
    try {
      const body: any = { custo: custoNum };
      if (precoVenda.trim() === "") {
        body.precoVenda = null; // limpa manual, volta a usar Trinks
      } else {
        body.precoVenda = vendaNum;
      }
      body.comissaoPct = comissao.trim() === "" ? null : comNum;
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

          <div>
            <label className="text-xs text-muted-foreground block mb-1">% de comissão do barbeiro</label>
            <Input
              type="number"
              step="1"
              min="0"
              max="100"
              value={comissao}
              onChange={(e) => setComissao(e.target.value)}
              placeholder="ex: 10 (branco = padrão global)"
              data-testid="input-comissao-produto"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Quanto o barbeiro ganha ao vender ESTE produto. Bomboniere = 0. Em branco usa os 10% padrão.
            </p>
          </div>

          {custoNum > 0 && vendaNum > 0 && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Comissão do barbeiro ({comNum || 0}%)</span>
                <span className="tabular-nums">{comissaoRS.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Margem real (venda − custo − comissão)</span>
                <span className={`font-semibold ${margem < 30 ? "text-red-400" : margem < 50 ? "text-amber-400" : "text-emerald-400"}`}>
                  {(vendaNum - custoNum - comissaoRS).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ({margem.toFixed(1)}%)
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

// ─── Modal de ajuste de saldo (entrada/saída/inventário) + estoque mínimo ──
function AjustarSaldoModal({
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
  const [tipo, setTipo] = useState<"entrada" | "saida" | "inventario">("entrada");
  const [quantidade, setQuantidade] = useState<string>("");
  const [motivo, setMotivo] = useState<string>("");
  const [minimo, setMinimo] = useState<string>(produto.minimo > 0 ? String(produto.minimo) : "");
  const [salvando, setSalvando] = useState(false);
  const [salvandoMin, setSalvandoMin] = useState(false);

  const parse = (v: string) => Number(String(v).replace(",", ".")) || 0;
  const qtdNum = parse(quantidade);

  // saldo final previsto após o ajuste
  const saldoFinal = useMemo(() => {
    if (tipo === "entrada") return produto.saldo + qtdNum;
    if (tipo === "saida") return Math.max(0, produto.saldo - qtdNum);
    return qtdNum; // inventário: o saldo vira a contagem
  }, [tipo, qtdNum, produto.saldo]);

  const submeterMovimentacao = async () => {
    if (qtdNum < 0 || (tipo !== "inventario" && qtdNum <= 0)) {
      onErro("Informe uma quantidade válida");
      return;
    }
    setSalvando(true);
    try {
      const r = await authFetch(`${API_BASE}/api/estoque/movimentacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          produtoId: String(produto.id),
          tipo,
          quantidade: qtdNum,
          motivo: motivo.trim(),
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao salvar");
      onSucesso(`${produto.nome}: saldo agora é ${saldoFinal}`);
      onSalvo();
    } catch (e: any) {
      onErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const salvarMinimo = async () => {
    setSalvandoMin(true);
    try {
      const minNum = minimo.trim() === "" ? null : parse(minimo);
      const r = await authFetch(`${API_BASE}/api/produtos/minimo/${produto.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimo: minNum }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao salvar mínimo");
      onSucesso(`Estoque mínimo de ${produto.nome} atualizado`);
      onSalvo();
    } catch (e: any) {
      onErro(e.message);
    } finally {
      setSalvandoMin(false);
    }
  };

  const tipoLabel: Record<string, string> = {
    entrada: "Entrada (compra/reposição)",
    saida: "Saída (perda/uso interno)",
    inventario: "Inventário (contagem física)",
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-lg max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="ajustar-saldo-modal"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Ajustar saldo
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{produto.nome}</p>
            <p className="text-[11px] text-muted-foreground">
              Saldo atual: <span className="font-medium text-foreground">{produto.saldo}</span>
              {produto.minimo > 0 && <> · mínimo {produto.minimo}</>}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Tipo de movimentação */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Tipo de movimentação</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["entrada", "saida", "inventario"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTipo(t)}
                  className={`px-2 py-2 text-xs rounded-md border transition ${
                    tipo === t
                      ? t === "entrada"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                        : t === "saida"
                          ? "bg-red-500/15 border-red-500/40 text-red-400"
                          : "bg-blue-500/15 border-blue-500/40 text-blue-400"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  data-testid={`btn-tipo-${t}`}
                >
                  <div className="flex items-center justify-center gap-1">
                    {t === "entrada" && <Plus className="w-3 h-3" />}
                    {t === "saida" && <Minus className="w-3 h-3" />}
                    {t === "inventario" && <ClipboardList className="w-3 h-3" />}
                    {t === "entrada" ? "Entrada" : t === "saida" ? "Saída" : "Inventário"}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">{tipoLabel[tipo]}</p>
          </div>

          {/* Quantidade */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {tipo === "inventario" ? "Quantidade contada (saldo final)" : "Quantidade"}
            </label>
            <Input
              type="number"
              step="1"
              min="0"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              placeholder="0"
              data-testid="input-quantidade"
            />
            {qtdNum > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Após o ajuste, saldo será: <strong className="text-foreground">{saldoFinal}</strong>
                {tipo === "saida" && qtdNum > produto.saldo && (
                  <span className="text-amber-400 ml-1">(mais que o saldo atual; ficará em 0)</span>
                )}
              </p>
            )}
          </div>

          {/* Motivo */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Motivo (opcional)</label>
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                tipo === "entrada"
                  ? "ex: compra fornecedor X"
                  : tipo === "saida"
                    ? "ex: quebra, uso interno"
                    : "ex: contagem física mensal"
              }
              data-testid="input-motivo"
            />
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={submeterMovimentacao} disabled={salvando || qtdNum < 0} data-testid="btn-confirmar-ajuste">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Registrar ajuste
            </Button>
          </div>

          {/* Estoque mínimo */}
          <div className="border-t pt-4">
            <label className="text-xs text-muted-foreground block mb-1">
              Estoque mínimo (alerta)
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="1"
                min="0"
                value={minimo}
                onChange={(e) => setMinimo(e.target.value)}
                placeholder="ex: 5"
                className="flex-1"
                data-testid="input-minimo"
              />
              <Button size="sm" variant="outline" onClick={salvarMinimo} disabled={salvandoMin}>
                {salvandoMin ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar mínimo"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Quando o saldo ficar igual ou abaixo do mínimo, o produto entra em alerta (vermelho) e aparece no resumo diário do Telegram. Deixe em branco para desativar.
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de histórico de movimentações ────────────────────────────────────
function HistoricoMovimentacoesModal({
  produto,
  onClose,
  onAlterado,
  onErro,
  onSucesso,
}: {
  produto: Produto;
  onClose: () => void;
  onAlterado: () => void;
  onErro: (msg: string) => void;
  onSucesso: (msg: string) => void;
}) {
  const [movs, setMovs] = useState<MovimentacaoManual[]>([]);
  const [loading, setLoading] = useState(true);
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    try {
      const r = await authFetch(
        `${API_BASE}/api/estoque/movimentacoes?produtoId=${produto.id}&limit=200`
      );
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao carregar");
      setMovs(j.movimentacoes || []);
    } catch (e: any) {
      onErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produto.id]);

  const remover = async (id: string) => {
    if (!confirm("Remover este ajuste? O saldo será recalculado.")) return;
    setRemovendoId(id);
    try {
      const r = await authFetch(`${API_BASE}/api/estoque/movimentacoes/${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao remover");
      onSucesso("Ajuste removido");
      await carregar();
      onAlterado();
    } catch (e: any) {
      onErro(e.message);
    } finally {
      setRemovendoId(null);
    }
  };

  const tipoIcon = (tipo: string) =>
    tipo === "entrada" ? <ArrowUpCircle className="w-4 h-4 text-emerald-400" /> :
    tipo === "saida" ? <ArrowDownCircle className="w-4 h-4 text-red-400" /> :
    <ClipboardList className="w-4 h-4 text-blue-400" />;

  const tipoLabel = (tipo: string) =>
    tipo === "entrada" ? "Entrada" : tipo === "saida" ? "Saída" : "Inventário";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-lg max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="historico-modal"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <History className="h-4 w-4" />
              Histórico de movimentações
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{produto.nome} · saldo atual: {produto.saldo}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : movs.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              Nenhum ajuste manual registrado para este produto ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {movs.map((m) => {
                const dataFmt = new Date(m.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
                return (
                  <div key={m.id} className="flex items-start gap-3 px-3 py-2 rounded-md border border-border">
                    <div className="mt-0.5">{tipoIcon(m.tipo)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{tipoLabel(m.tipo)}</span>
                        <span className={`text-sm font-semibold ${
                          m.delta > 0 ? "text-emerald-400" : m.delta < 0 ? "text-red-400" : "text-muted-foreground"
                        }`}>
                          {m.delta > 0 ? "+" : ""}{m.delta}
                        </span>
                        {m.tipo === "inventario" && (
                          <span className="text-[11px] text-muted-foreground">
                            (de {m.saldoAnterior ?? 0} para {m.quantidade})
                          </span>
                        )}
                      </div>
                      {m.motivo && (
                        <div className="text-xs text-muted-foreground mt-0.5">{m.motivo}</div>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {dataFmt}{m.usuario ? ` · ${m.usuario}` : ""}
                        {m.custoUnitario > 0 && (
                          <> · custo unit. {formatCurrency(m.custoUnitario)}</>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => remover(m.id)}
                      disabled={removendoId === m.id}
                      title="Remover este ajuste"
                    >
                      {removendoId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}

// Baixa automática de estoque — status + consolidar vendas de ontem.
function BaixaAutomaticaCard() {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function carregar() {
    try { const r = await fetch(`${API_BASE}/api/estoque/consolidacao-status`); const j = await r.json(); if (j.ok) setSt(j); } catch {}
  }
  useEffect(() => { carregar(); }, []);
  async function consolidarOntem() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/estoque/consolidar/ontem`, { method: "POST" });
      const j = await r.json();
      setMsg(j.consolidado ? `Baixa de ${j.data}: ${j.produtos} produtos, ${j.unidades} un.` : `${j.data}: ${j.motivo || "nada a fazer"}`);
      await carregar();
    } catch { setMsg("Erro ao consolidar."); } finally { setBusy(false); }
  }
  if (!st) return null;
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs">
          <div className="font-semibold text-sm flex items-center gap-1.5"><ArrowDownCircle className="w-4 h-4 text-emerald-500" />Baixa automática de estoque</div>
          <div className="text-muted-foreground mt-0.5">
            Última contagem (pente fino): <strong>{st.ultimaContagem ? st.ultimaContagem.split("-").reverse().join("/") : "nunca — faça o pente fino"}</strong>.
            Todo dia 8h30 o sistema dá baixa das vendas de ontem (raw da API, 0 token).
          </div>
          {st.dias?.length > 0 && <div className="text-[10px] text-muted-foreground mt-1">Últimos dias baixados: {st.dias.slice(0, 6).map((d: any) => `${d.data.slice(8)}/${d.data.slice(5, 7)} (${d.unidades}un)`).join(" · ")}</div>}
          {msg && <div className="text-[11px] text-emerald-600 mt-1">{msg}</div>}
        </div>
        <Button size="sm" variant="outline" onClick={consolidarOntem} disabled={busy} className="flex-shrink-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}Consolidar ontem
        </Button>
      </CardContent>
    </Card>
  );
}

// Pente fino — contagem física de TODOS os produtos de uma vez.
function PenteFinoSection({ produtos, onSalvo }: { produtos: any[]; onSalvo: () => void }) {
  const [cont, setCont] = useState<Record<string, string>>({});
  const [min, setMin] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const lista = produtos.filter(p => !busca.trim() || String(p.nome).toLowerCase().includes(busca.toLowerCase()));
  const preenchidos = Object.values(cont).filter(v => v !== "" && v != null).length;
  async function salvar() {
    setSalvando(true);
    try {
      const itens = produtos
        .filter(p => (cont[p.id] != null && cont[p.id] !== "") || (min[p.id] != null && min[p.id] !== ""))
        .map(p => ({ produtoId: p.id, contado: cont[p.id] !== "" ? cont[p.id] : undefined, minimo: min[p.id] !== "" ? min[p.id] : undefined }));
      if (!itens.length) { setSalvando(false); return; }
      const r = await fetch(`${API_BASE}/api/estoque/inventario-lote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens }) });
      const j = await r.json();
      if (j.ok) onSalvo();
    } finally { setSalvando(false); }
  }
  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><ClipboardList className="w-4 h-4 text-primary" />Pente fino — contagem física de hoje</CardTitle>
          <div className="flex items-center gap-2">
            <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="filtrar produto..." className="h-8 w-40 text-xs" />
            <Button size="sm" onClick={salvar} disabled={salvando || preenchidos === 0}>{salvando ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}Salvar contagem ({preenchidos})</Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Conte o físico e digite a quantidade REAL de cada produto (e o mínimo pra alerta). O saldo vira a contagem; a partir de amanhã as vendas dão baixa sozinhas.</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card"><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2">Produto</th><th className="py-2 px-2 text-right">Saldo atual</th><th className="py-2 px-2 text-right w-28">Contei</th><th className="py-2 px-2 text-right w-24">Mínimo</th>
            </tr></thead>
            <tbody>{lista.map(p => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-1.5 pr-2"><div className="font-medium">{p.nome}</div>{p.categoria && <div className="text-[10px] text-muted-foreground">{p.categoria}</div>}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{p.saldo}</td>
                <td className="py-1.5 px-2 text-right"><Input type="number" value={cont[p.id] ?? ""} onChange={e => setCont({ ...cont, [p.id]: e.target.value })} placeholder="—" className="h-7 w-24 text-right text-xs" /></td>
                <td className="py-1.5 px-2 text-right"><Input type="number" value={min[p.id] ?? (p.minimo > 0 ? String(p.minimo) : "")} onChange={e => setMin({ ...min, [p.id]: e.target.value })} placeholder="mín" className="h-7 w-20 text-right text-xs" /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
