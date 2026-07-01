import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  Pencil,
  Save,
  X as XIcon,
  Lock,
  Unlock,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Crown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP } from "@/lib/mesUtils";
import FechamentoMes from "@/components/pagamento/FechamentoMes";

// ─────────────────────────────────────────────────────────────────────────
// Aba PAGAMENTO (v20)
// 1. Topo: seletor de mês + status de conciliação (gate visual)
// 2. Tabela: cada profissional com coluna editável de Vale + Ajuste + Saldo
// 3. Ações por linha: salvar, recibo PDF, fechar/reabrir mês
// ─────────────────────────────────────────────────────────────────────────

type Linha = {
  profissionalId: string;
  nome: string;
  bases: {
    servicosLiquido: number;
    produtosLiquidoComissionavel: number;
    produtosLiquidoTotal: number;
    planoReais: number;
    custoInsumos?: number;
    baseComissaoServicos?: number;
    taxaCartaoEstimada?: number;
  };
  percentuais: {
    pctServico: number; pctProduto: number; pctPlano: number; pctBonusExcedente: number;
    metaReais: number; salarioFixo: number;
  };
  modoComissao?: 'bruto' | 'liquido';
  modoFonte?: 'profissional' | 'global';
  categoriaRanking?: 'barbeiro' | 'assistente';
  posicaoRanking?: number | null;
  calculos: {
    comissaoServicos: number;
    comissaoProdutos: number;
    comissaoPlano: number;
    comissaoClubeGreco: number;
    excedenteMeta: number;
    bonusExcedente: number;
    bonusRanking: number;
    salarioFixo: number;
    totalBruto: number;
  };
  clubeGreco?: {
    assinantes: number;
    valorVendasRS: number;
    comissaoRS: number;
    pctEfetivo: number;
  };
  pagamento: {
    vale: number;
    valeNota: string;
    valePagoEm: string | null;
    ajuste: number;
    ajusteNota: string;
    consumoInterno: number;
    consumoInternoNota: string;
    saldoAReceber: number;
    fechado: boolean;
    fechadoEm: string | null;
    snapshot: any;
  };
};

type RespApi = {
  ok: boolean;
  mes: string;
  dataInicio: string;
  dataFim: string;
  linhas: Linha[];
  totais: {
    totalBruto: number;
    totalComissaoServicos?: number;
    totalComissaoProdutos?: number;
    totalComissaoPlano?: number;
    totalComissaoClubeGreco?: number;
    totalBonusExcedente?: number;
    totalBonusRanking?: number;
    totalSalarioFixo?: number;
    totalVale: number;
    totalAjuste: number;
    totalConsumoInterno: number;
    totalTaxaCartao: number;
    totalSaldo: number;
  };
  clubeOrfaos?: Array<{ seller: string; assinantes: number; valorVendasRS: number; comissaoRS: number }>;
  faturamento?: {
    totalReais: number;
    totalAtendimentos: number;
    servicosBruto: number;
    servicosLiquido: number;
    produtosBruto: number;
    produtosLiquido: number;
    planoReais: number;
  };
  conferencia?: {
    oficialTrinks: number;
    producaoRankingServicos: number;
    temRanking: boolean;
    apiPeriodo: number;
    temOficial: boolean;
  };
};

type StatusConcil = {
  ok: boolean;
  pendentes: number;
  totalOrfas: number;
  diferenca: number;
};

const fmtBRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Pagamento() {
  const { toast } = useToast();
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [mes, setMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("pagamento.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("pagamento.selectedMes", mes); } catch {}
  }, [mes]);
  const isMesCorrente = mes === mesCorrente;
  const [data, setData] = useState<RespApi | null>(null);
  const [status, setStatus] = useState<StatusConcil | null>(null);
  const [loading, setLoading] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ vale: string; valeNota: string; ajuste: string; ajusteNota: string; consumoInterno: string; consumoInternoNota: string }>({
    vale: "", valeNota: "", ajuste: "", ajusteNota: "", consumoInterno: "", consumoInternoNota: "",
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [acaoLinha, setAcaoLinha] = useState<string | null>(null);
  const [atualizandoTrinks, setAtualizandoTrinks] = useState(false);
  const [ultimoForceAt, setUltimoForceAt] = useState<number>(0);

  const carregar = async (force = false) => {
    if (force) setAtualizandoTrinks(true);
    else setLoading(true);
    try {
      const url = force ? `/api/pagamento/${mes}?force=true` : `/api/pagamento/${mes}`;
      const [r1, r2] = await Promise.all([
        authFetch(url),
        authFetch(`/api/conciliacao/status?mes=${mes}`).catch(() => null),
      ]);
      const j1: RespApi = await r1.json();
      if (!j1.ok) throw new Error((j1 as any).error || "Erro ao carregar pagamento");
      setData(j1);
      if (r2) {
        try { setStatus(await r2.json()); } catch { setStatus(null); }
      }
      if (force) {
        setUltimoForceAt(Date.now());
        toast({ title: "Dados atualizados", description: "Cache do Trinks renovado para este mês." });
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setAtualizandoTrinks(false);
    }
  };

  // Cooldown de 5 minutos entre force refresh para não estourar rate limit do Trinks
  const podeAtualizarTrinks = Date.now() - ultimoForceAt > 5 * 60 * 1000;
  const segundosRestantes = podeAtualizarTrinks ? 0 : Math.ceil((5 * 60 * 1000 - (Date.now() - ultimoForceAt)) / 1000);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  const iniciarEdicao = (l: Linha) => {
    if (l.pagamento.fechado) return;
    setEditandoId(l.profissionalId);
    setEdit({
      vale: String(l.pagamento.vale || 0),
      valeNota: l.pagamento.valeNota || "",
      ajuste: String(l.pagamento.ajuste || 0),
      ajusteNota: l.pagamento.ajusteNota || "",
      consumoInterno: String(l.pagamento.consumoInterno || 0),
      consumoInternoNota: l.pagamento.consumoInternoNota || "",
    });
  };

  const cancelarEdicao = () => {
    setEditandoId(null);
    setEdit({ vale: "", valeNota: "", ajuste: "", ajusteNota: "", consumoInterno: "", consumoInternoNota: "" });
  };

  const salvarEdicao = async (l: Linha) => {
    setSalvando(true);
    try {
      const r = await authFetch(`/api/pagamento/${mes}/${l.profissionalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vale: Number(edit.vale.replace(",", ".")) || 0,
          valeNota: edit.valeNota,
          ajuste: Number(edit.ajuste.replace(",", ".")) || 0,
          ajusteNota: edit.ajusteNota,
          consumoInterno: Number(edit.consumoInterno.replace(",", ".")) || 0,
          consumoInternoNota: edit.consumoInternoNota,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Erro ao salvar");
      toast({ title: "Salvo", description: `Pagamento de ${l.nome} atualizado.` });
      cancelarEdicao();
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const fecharMes = async (l: Linha) => {
    if (!confirm(`Fechar mês para ${l.nome}? O snapshot ficará travado e só poderá ser editado após reabrir.`)) return;
    setAcaoLinha(l.profissionalId);
    try {
      const r = await authFetch(`/api/pagamento/${mes}/${l.profissionalId}/fechar`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Erro ao fechar");
      toast({ title: "Mês fechado", description: `Snapshot salvo para ${l.nome}.` });
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setAcaoLinha(null);
    }
  };

  const reabrirMes = async (l: Linha) => {
    if (!confirm(`Reabrir mês para ${l.nome}? Os valores poderão ser editados novamente.`)) return;
    setAcaoLinha(l.profissionalId);
    try {
      const r = await authFetch(`/api/pagamento/${mes}/${l.profissionalId}/reabrir`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Erro ao reabrir");
      toast({ title: "Mês reaberto", description: `${l.nome} pode ser editado novamente.` });
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setAcaoLinha(null);
    }
  };

  const abrirRecibo = (l: Linha) => {
    const url = `/api/pagamento/${mes}/recibo/${l.profissionalId}`;
    window.open(url, "_blank");
  };

  const linhasFiltradas = useMemo(() => {
    if (!data) return [];
    // Mostra apenas profissionais com algum movimento OU meta cadastrada não-zero
    return data.linhas.filter(l =>
      l.calculos.totalBruto > 0 ||
      l.bases.servicosLiquido > 0 ||
      l.bases.produtosLiquidoComissionavel > 0 ||
      l.percentuais.metaReais > 0 ||
      l.pagamento.vale > 0 ||
      l.pagamento.ajuste !== 0 ||
      l.pagamento.consumoInterno > 0
    );
  }, [data]);

  return (
    <div className="space-y-4 p-4">
      {/* Header com seletor de mês */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              Pagamentos de Comissões
              <Badge variant="outline" className="text-xs">v21</Badge>
            </CardTitle>
            <MonthSelector
              selectedMes={mes}
              onChange={setMes}
              mesCorrente={mesCorrente}
              isMesCorrente={isMesCorrente}
              loading={loading}
              extraInfo={isMesCorrente ? "Mês atual · cálculo ao vivo" : "Cálculo do mês selecionado"}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" size="sm" onClick={() => carregar(false)} disabled={loading || atualizandoTrinks}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Recarregar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => carregar(true)}
              disabled={atualizandoTrinks || loading || !podeAtualizarTrinks}
              title={
                !podeAtualizarTrinks
                  ? `Aguarde ${segundosRestantes}s antes de atualizar novamente (cooldown para não estourar rate limit do Trinks)`
                  : "Invalida o cache e busca dados frescos do Trinks. Pode demorar até 1 minuto."
              }
              data-testid="btn-atualizar-trinks"
            >
              {atualizandoTrinks
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-2" />
              }
              {atualizandoTrinks
                ? "Atualizando Trinks..."
                : !podeAtualizarTrinks
                  ? `Atualizar Trinks (${segundosRestantes}s)`
                  : "Atualizar dados Trinks"
              }
            </Button>
            {/* Gate de conciliação */}
            {status && (
              <div className="ml-auto">
                {status.pendentes > 0 ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {status.pendentes} órfã{status.pendentes > 1 ? "s" : ""} pendente{status.pendentes > 1 ? "s" : ""} na Conciliação
                  </Badge>
                ) : (
                  <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700">
                    <CheckCircle2 className="w-3 h-3" />
                    Conciliação em dia
                  </Badge>
                )}
              </div>
            )}
          </div>
          {data && (
            <>
              {/* CONFERÊNCIA DE FECHAMENTO — bate a produção do RANKING (base da folha) com o oficial da Trinks (v21) */}
              {data.conferencia && (() => {
                const c = data.conferencia!;
                const oficial = c.oficialTrinks || 0;
                const rankProd = c.producaoRankingServicos || 0;
                // Serviços costumam ser ~75-85% da receita total (resto = produto + Clube).
                // ratio ≥ 55% → Ranking coerente com o mês; < 55% → provavelmente incompleto.
                const ratio = oficial > 0 ? rankProd / oficial : 0;
                const semBase = !c.temRanking || !c.temOficial;
                const confere = c.temRanking && oficial > 0 && ratio >= 0.55;
                return (
                  <div className={`mt-3 mb-2 p-3 rounded-lg border ${semBase ? "border-slate-200 bg-slate-50" : confere ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <div className="text-xs uppercase tracking-wide font-semibold text-slate-600">Conferência do fechamento — antes de pagar</div>
                      {!c.temRanking ? (
                        <Badge variant="outline" className="gap-1"><AlertTriangle className="w-3 h-3" />Sem ranking do mês — cálculo ao vivo</Badge>
                      ) : !c.temOficial ? (
                        <Badge variant="outline" className="gap-1"><AlertTriangle className="w-3 h-3" />Sem total oficial do e-mail</Badge>
                      ) : confere ? (
                        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="w-3 h-3" />Ranking coerente com a Trinks</Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Ranking parece incompleto</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <Stat label="Oficial Trinks (e-mail do mês)" valor={oficial} bold />
                      <Stat label="Serviços no Ranking (base da folha)" valor={rankProd} muted />
                      <div className="rounded border p-2">
                        <div className="text-xs text-muted-foreground">Serviços / oficial</div>
                        <div className={`tabular-nums text-sm font-medium ${semBase ? "" : confere ? "text-emerald-600" : "text-amber-600"}`}>{oficial > 0 ? (ratio * 100).toFixed(0) + "%" : "—"}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      A folha paga a comissão de serviços sobre o <strong>Ranking de Profissionais (CSV)</strong>. Serviços costumam ser ~75–85% da receita oficial (o resto é produto + Clube). Se essa fatia vier muito baixa, o Ranking de {data.mes} pode estar incompleto — reenvie em <strong>Importar Trinks</strong> antes de pagar. Oficial e conferência vêm do e-mail diário da Trinks (0 tokens). {c.apiPeriodo > 0 && <>API do período (informativo): R$ {fmtBRL(c.apiPeriodo)}.</>}
                    </div>
                  </div>
                );
              })()}
              {data.faturamento && (
                <div className="mt-3 mb-2 p-3 rounded-md border border-emerald-500/20 bg-emerald-500/5">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Faturamento bruto do período (Trinks)</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 text-sm">
                    <Stat label="Total faturado" valor={data.faturamento.totalReais} bold />
                    <div className="rounded border p-2 opacity-80">
                      <div className="text-xs text-muted-foreground">Atendimentos</div>
                      <div className="tabular-nums text-sm font-medium">{data.faturamento.totalAtendimentos}</div>
                    </div>
                    <Stat label="Serviços (bruto)" valor={data.faturamento.servicosBruto} muted />
                    <Stat label="Produtos (bruto)" valor={data.faturamento.produtosBruto} muted />
                    <Stat label="Plano" valor={data.faturamento.planoReais} muted />
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Bases para o cálculo de comissão abaixo. Soma = receita total registrada na Trinks no intervalo {data.dataInicio} a {data.dataFim}.
                  </div>
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                <Stat label="Total bruto (folha)" valor={data.totais.totalBruto} />
                <Stat label="Total vale" valor={data.totais.totalVale} muted />
                <Stat label="Total consumo" valor={data.totais.totalConsumoInterno || 0} muted />
                <Stat label="Total ajuste" valor={data.totais.totalAjuste} muted />
                <Stat label="Taxa cartão (info)" valor={data.totais.totalTaxaCartao || 0} muted />
                <Stat label="Total a pagar" valor={data.totais.totalSaldo} bold />
              </div>
              {/* Breakdown da folha — 3 blocos visuais */}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold mb-2">Comissões da folha</div>
                  <div className="space-y-1 text-xs">
                    <Row label="Serviços" valor={data.totais.totalComissaoServicos || 0} />
                    <Row label="Produtos" valor={data.totais.totalComissaoProdutos || 0} />
                    <Row label="Plano (Trinks)" valor={data.totais.totalComissaoPlano || 0} />
                    {(data.totais.totalComissaoClubeGreco || 0) > 0 && (
                      <Row
                        label={<span className="flex items-center gap-1"><Crown className="w-3 h-3 text-purple-400" />Clube Greco</span>}
                        valor={data.totais.totalComissaoClubeGreco || 0}
                      />
                    )}
                    {(data.totais.totalSalarioFixo || 0) > 0 && (
                      <Row label="Salário fixo" valor={data.totais.totalSalarioFixo || 0} />
                    )}
                  </div>
                </div>
                <div className="rounded border border-yellow-500/30 bg-yellow-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-yellow-400 font-semibold mb-2">Bônus da folha</div>
                  <div className="space-y-1 text-xs">
                    <Row label="🥇 Top 1 (barbeiro + assist.)" valor={data.totais.totalBonusRanking || 0} />
                    <Row label="Excedente de meta" valor={data.totais.totalBonusExcedente || 0} />
                    {(data.totais.totalBonusRanking || 0) + (data.totais.totalBonusExcedente || 0) === 0 && (
                      <div className="text-muted-foreground italic">Sem bônus distribuídos.</div>
                    )}
                  </div>
                </div>
                <div className="rounded border border-red-500/30 bg-red-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-red-400 font-semibold mb-2">Descontos da folha</div>
                  <div className="space-y-1 text-xs">
                    <Row label="Vales" valor={-(data.totais.totalVale || 0)} />
                    <Row label="Consumo interno" valor={-(data.totais.totalConsumoInterno || 0)} />
                    <Row label="Ajustes" valor={data.totais.totalAjuste || 0} />
                  </div>
                </div>
              </div>
              {/* Aviso: sellers do Clube Greco sem match em profissional */}
              {(data.clubeOrfaos && data.clubeOrfaos.length > 0) && (
                <div className="mt-3 p-3 rounded border border-amber-500/30 bg-amber-500/5 text-xs">
                  <div className="flex items-center gap-2 mb-2 text-amber-400 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {data.clubeOrfaos.length} vendedor(es) do Clube Greco sem profissional correspondente
                  </div>
                  <div className="text-muted-foreground mb-2">
                    Estes vendedores receberam comissão de assinaturas pagas no mês mas não bateram com nenhum profissional ativo na folha. A comissão deles não está sendo somada ao "A pagar". Cadastre-os ou ajuste o nome em <strong>Assinaturas</strong>.
                  </div>
                  <ul className="space-y-0.5">
                    {data.clubeOrfaos.map(o => (
                      <li key={o.seller} className="flex items-baseline justify-between">
                        <span>{o.seller} ({o.assinantes} assinat.)</span>
                        <span className="tabular-nums text-amber-400">R$ {fmtBRL(o.comissaoRS)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Tabela principal */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Folha do mês</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : linhasFiltradas.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Sem profissionais com movimento neste mês.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {/* Cabeçalho com 3 blocos visuais: Comissões | Bônus | Descontos */}
                <thead>
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    <th className="py-1 pr-3"></th>
                    <th colSpan={3} className="py-1 px-2 text-center border-b border-emerald-500/30 bg-emerald-500/5 rounded-t">
                      Comissões
                    </th>
                    <th className="py-1 px-2 text-center border-b border-yellow-500/30 bg-yellow-500/5 rounded-t">
                      Bônus
                    </th>
                    <th colSpan={3} className="py-1 px-2 text-center border-b border-red-500/30 bg-red-500/5 rounded-t">
                      Descontos
                    </th>
                    <th colSpan={2} className="py-1 px-2"></th>
                  </tr>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Profissional</th>
                    <th className="py-2 px-2 text-right bg-emerald-500/5">Serviços</th>
                    <th className="py-2 px-2 text-right bg-emerald-500/5">Produtos</th>
                    <th className="py-2 px-2 text-right bg-emerald-500/5">Pacotes/Assin.</th>
                    <th className="py-2 px-2 text-right bg-yellow-500/5">Bônus</th>
                    <th className="py-2 px-2 text-right bg-red-500/5">Vale</th>
                    <th className="py-2 px-2 text-right bg-red-500/5">Consumo</th>
                    <th className="py-2 px-2 text-right bg-red-500/5">Ajuste</th>
                    <th className="py-2 px-2 text-right font-semibold">A pagar</th>
                    <th className="py-2 pl-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.map(l => {
                    const editando = editandoId === l.profissionalId;
                    const expandido = expandedId === l.profissionalId;
                    const fechado = l.pagamento.fechado;
                    const bonusTotal = l.calculos.bonusExcedente + l.calculos.bonusRanking;
                    const pacotesValor = l.bases.planoReais + (l.clubeGreco?.valorVendasRS || 0);
                    const pacotesComissao = l.calculos.comissaoPlano + l.calculos.comissaoClubeGreco;
                    const pctDoFaturamento = l.bases.servicosLiquido + l.bases.produtosLiquidoComissionavel > 0
                      ? (l.pagamento.saldoAReceber / (l.bases.servicosLiquido + l.bases.produtosLiquidoComissionavel + l.bases.planoReais)) * 100
                      : 0;
                    return (
                      <Fragment key={l.profissionalId}>
                        <tr
                          className={`border-b ${fechado ? "bg-muted/20" : ""} ${expandido ? "bg-muted/10" : "hover:bg-muted/5"} cursor-pointer`}
                          onClick={(e) => {
                            // só expande se não tiver clicado em botão ou input
                            const target = e.target as HTMLElement;
                            if (target.closest("button") || target.closest("input")) return;
                            setExpandedId(expandido ? null : l.profissionalId);
                          }}
                        >
                          {/* Profissional */}
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              {expandido ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              {fechado && <Lock className="w-3 h-3 text-muted-foreground" />}
                              <span className="font-medium">{l.nome}</span>
                              {l.posicaoRanking === 1 && l.calculos.bonusRanking > 0 && (
                                <Badge variant="outline" className="text-[9px] h-5 border-yellow-500/50 text-yellow-300 bg-yellow-500/15" title={`Top 1 ${l.categoriaRanking === 'assistente' ? 'assistente' : 'barbeiro'} do mês`}>
                                  🥇 Top 1
                                </Badge>
                              )}
                              {l.categoriaRanking === 'assistente' && (
                                <Badge variant="outline" className="text-[9px] h-5 border-pink-500/40 text-pink-300 bg-pink-500/10">Assist.</Badge>
                              )}
                              {l.modoComissao === 'liquido' && (
                                <Badge variant="outline" className="text-[9px] h-5 border-amber-500/40 text-amber-400 bg-amber-500/10" title={l.modoFonte === 'profissional' ? "Modo override" : "Modo padrão"}>
                                  Líquido{l.modoFonte === 'profissional' ? '*' : ''}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Meta R$ {fmtBRL(l.percentuais.metaReais)} · {l.percentuais.pctServico}%/{l.percentuais.pctProduto}%/{l.percentuais.pctPlano}%
                              {pctDoFaturamento > 0 && <span> · <strong className="text-foreground">{pctDoFaturamento.toFixed(1)}%</strong> do faturamento</span>}
                            </div>
                          </td>

                          {/* Comissões — Serviços */}
                          <td className="py-2 px-2 text-right tabular-nums bg-emerald-500/5">
                            <div className="text-emerald-400 font-semibold">R$ {fmtBRL(l.calculos.comissaoServicos)}</div>
                            <div className="text-[10px] text-muted-foreground">{l.percentuais.pctServico}% de {fmtBRL(l.bases.servicosLiquido)}</div>
                          </td>
                          {/* Comissões — Produtos */}
                          <td className="py-2 px-2 text-right tabular-nums bg-emerald-500/5">
                            <div className="text-emerald-400 font-semibold">R$ {fmtBRL(l.calculos.comissaoProdutos)}</div>
                            <div className="text-[10px] text-muted-foreground">{l.percentuais.pctProduto}% de {fmtBRL(l.bases.produtosLiquidoComissionavel)}</div>
                          </td>
                          {/* Comissões — Pacotes/Assinaturas (Trinks + Clube Greco) */}
                          <td className="py-2 px-2 text-right tabular-nums bg-emerald-500/5">
                            <div className="text-emerald-400 font-semibold">R$ {fmtBRL(pacotesComissao)}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {l.percentuais.pctPlano}% de {fmtBRL(pacotesValor)}
                              {(l.clubeGreco?.assinantes || 0) > 0 && (
                                <span className="text-purple-400" title={`${l.clubeGreco?.assinantes} assinaturas do Clube Greco vendidas`}>
                                  {" "}· Clube +{fmtBRL(l.clubeGreco?.comissaoRS || 0)}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Bônus — soma excedente + ranking */}
                          <td className="py-2 px-2 text-right tabular-nums bg-yellow-500/5">
                            <div className={`font-semibold ${bonusTotal > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
                              R$ {fmtBRL(bonusTotal)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {l.calculos.bonusRanking > 0 && <span>🥇 {fmtBRL(l.calculos.bonusRanking)} </span>}
                              {l.calculos.bonusExcedente > 0 && <span>· meta+{fmtBRL(l.calculos.bonusExcedente)}</span>}
                              {bonusTotal === 0 && <span>—</span>}
                            </div>
                          </td>

                          {/* Descontos — Vale */}
                          <td className="py-2 px-2 text-right tabular-nums bg-red-500/5">
                            {editando ? (
                              <Input type="number" step="0.01" min="0" max="1000" value={edit.vale} onChange={e => setEdit({ ...edit, vale: e.target.value })} className="w-20 h-8 text-right" data-testid={`vale-${l.profissionalId}`} onClick={e => e.stopPropagation()} />
                            ) : (
                              <span className={l.pagamento.vale > 0 ? "text-red-400" : "text-muted-foreground"}>
                                {l.pagamento.vale > 0 ? `−${fmtBRL(l.pagamento.vale)}` : "—"}
                              </span>
                            )}
                          </td>
                          {/* Descontos — Consumo */}
                          <td className="py-2 px-2 text-right tabular-nums bg-red-500/5">
                            {editando ? (
                              <Input type="number" step="0.01" min="0" value={edit.consumoInterno} onChange={e => setEdit({ ...edit, consumoInterno: e.target.value })} className="w-20 h-8 text-right" data-testid={`consumo-${l.profissionalId}`} onClick={e => e.stopPropagation()} />
                            ) : (
                              <span className={l.pagamento.consumoInterno > 0 ? "text-red-400" : "text-muted-foreground"}>
                                {l.pagamento.consumoInterno > 0 ? `−${fmtBRL(l.pagamento.consumoInterno)}` : "—"}
                              </span>
                            )}
                          </td>
                          {/* Descontos — Ajuste (pode ser positivo ou negativo) */}
                          <td className="py-2 px-2 text-right tabular-nums bg-red-500/5">
                            {editando ? (
                              <Input type="number" step="0.01" value={edit.ajuste} onChange={e => setEdit({ ...edit, ajuste: e.target.value })} className="w-20 h-8 text-right" data-testid={`ajuste-${l.profissionalId}`} onClick={e => e.stopPropagation()} />
                            ) : (
                              <span className={l.pagamento.ajuste > 0 ? "text-emerald-400" : l.pagamento.ajuste < 0 ? "text-red-400" : "text-muted-foreground"}>
                                {l.pagamento.ajuste !== 0 ? `${l.pagamento.ajuste > 0 ? "+" : ""}${fmtBRL(l.pagamento.ajuste)}` : "—"}
                              </span>
                            )}
                          </td>

                          {/* TOTAL A PAGAR */}
                          <td className="py-2 px-2 text-right tabular-nums font-bold text-base">
                            R$ {fmtBRL(l.pagamento.saldoAReceber)}
                          </td>

                          {/* Ações */}
                          <td className="py-2 pl-2 text-right">
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              {editando ? (
                                <>
                                  <Button size="sm" variant="default" onClick={() => salvarEdicao(l)} disabled={salvando} className="h-8">
                                    {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={cancelarEdicao} className="h-8 px-2">
                                    <XIcon className="w-3 h-3" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  {!fechado && (
                                    <Button size="sm" variant="outline" onClick={() => iniciarEdicao(l)} className="h-8 px-2">
                                      <Pencil className="w-3 h-3" />
                                    </Button>
                                  )}
                                  <Button size="sm" variant="outline" onClick={() => abrirRecibo(l)} className="h-8 px-2" title="Recibo">
                                    <FileText className="w-3 h-3" />
                                  </Button>
                                  {fechado ? (
                                    <Button size="sm" variant="ghost" onClick={() => reabrirMes(l)} disabled={acaoLinha === l.profissionalId} className="h-8 px-2" title="Reabrir mês">
                                      <Unlock className="w-3 h-3" />
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="ghost" onClick={() => fecharMes(l)} disabled={acaoLinha === l.profissionalId} className="h-8 px-2" title="Fechar mês">
                                      <Lock className="w-3 h-3" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Linha expandida — memória de cálculo */}
                        {expandido && (
                          <tr className="bg-muted/10 border-b">
                            <td colSpan={10} className="py-3 px-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                {/* Comissões — detalhe */}
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold mb-1">Comissões</div>
                                  <Row label={`Serviços (${l.percentuais.pctServico}% × ${fmtBRL(l.bases.baseComissaoServicos || l.bases.servicosLiquido)})`} valor={l.calculos.comissaoServicos} />
                                  <Row label={`Produtos (${l.percentuais.pctProduto}% × ${fmtBRL(l.bases.produtosLiquidoComissionavel)})`} valor={l.calculos.comissaoProdutos} />
                                  <Row label={`Plano Trinks (${l.percentuais.pctPlano}% × ${fmtBRL(l.bases.planoReais)})`} valor={l.calculos.comissaoPlano} />
                                  {(l.clubeGreco?.assinantes || 0) > 0 && (
                                    <Row
                                      label={
                                        <span className="flex items-center gap-1">
                                          <Crown className="w-3 h-3 text-purple-400" />
                                          Clube Greco ({l.clubeGreco?.assinantes} assinat. · {l.clubeGreco?.pctEfetivo?.toFixed(0)}% × {fmtBRL(l.clubeGreco?.valorVendasRS || 0)})
                                        </span>
                                      }
                                      valor={l.calculos.comissaoClubeGreco}
                                    />
                                  )}
                                  {l.percentuais.salarioFixo > 0 && (
                                    <Row label="Salário fixo" valor={l.percentuais.salarioFixo} />
                                  )}
                                  <div className="border-t border-emerald-500/20 pt-1 mt-1">
                                    <Row label={<strong>Subtotal comissões</strong>} valor={l.calculos.comissaoServicos + l.calculos.comissaoProdutos + l.calculos.comissaoPlano + l.calculos.comissaoClubeGreco + l.percentuais.salarioFixo} bold />
                                  </div>
                                </div>

                                {/* Bônus — detalhe */}
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase tracking-wide text-yellow-400 font-semibold mb-1">Bônus</div>
                                  {l.calculos.bonusRanking > 0 && (
                                    <Row label={`🥇 Top 1 ${l.categoriaRanking === 'assistente' ? 'Assistente' : 'Barbeiro'}`} valor={l.calculos.bonusRanking} />
                                  )}
                                  {l.percentuais.pctBonusExcedente > 0 && (
                                    <Row
                                      label={`Excedente meta (${l.percentuais.pctBonusExcedente}% × ${fmtBRL(l.calculos.excedenteMeta)})`}
                                      valor={l.calculos.bonusExcedente}
                                    />
                                  )}
                                  {bonusTotal === 0 && (
                                    <div className="text-muted-foreground italic">Sem bônus neste mês.</div>
                                  )}
                                  {bonusTotal > 0 && (
                                    <div className="border-t border-yellow-500/20 pt-1 mt-1">
                                      <Row label={<strong>Subtotal bônus</strong>} valor={bonusTotal} bold />
                                    </div>
                                  )}
                                </div>

                                {/* Descontos — detalhe */}
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase tracking-wide text-red-400 font-semibold mb-1">Descontos / Ajustes</div>
                                  {l.pagamento.vale > 0 && (
                                    <Row label={`Vale${l.pagamento.valeNota ? ` — ${l.pagamento.valeNota}` : ""}`} valor={-l.pagamento.vale} />
                                  )}
                                  {l.pagamento.consumoInterno > 0 && (
                                    <Row label={`Consumo interno${l.pagamento.consumoInternoNota ? ` — ${l.pagamento.consumoInternoNota}` : ""}`} valor={-l.pagamento.consumoInterno} />
                                  )}
                                  {l.pagamento.ajuste !== 0 && (
                                    <Row label={`Ajuste${l.pagamento.ajusteNota ? ` — ${l.pagamento.ajusteNota}` : ""}`} valor={l.pagamento.ajuste} />
                                  )}
                                  {l.pagamento.vale === 0 && l.pagamento.consumoInterno === 0 && l.pagamento.ajuste === 0 && (
                                    <div className="text-muted-foreground italic">Sem descontos.</div>
                                  )}
                                  {l.bases.taxaCartaoEstimada != null && l.bases.taxaCartaoEstimada > 0 && (
                                    <div className="text-[10px] text-muted-foreground pt-1">
                                      Taxa cartão (info, já abatida do líquido): R$ {fmtBRL(l.bases.taxaCartaoEstimada)}
                                    </div>
                                  )}
                                  {l.modoComissao === 'liquido' && l.bases.custoInsumos != null && l.bases.custoInsumos > 0 && (
                                    <div className="text-[10px] text-amber-400 pt-1">
                                      Insumos descontados da base de serviços: R$ {fmtBRL(l.bases.custoInsumos)}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Linha do total no detalhe */}
                              <div className="mt-3 pt-3 border-t flex items-center justify-end gap-6 text-sm">
                                <div className="text-muted-foreground">
                                  Bruto: <strong className="text-foreground">R$ {fmtBRL(l.calculos.totalBruto)}</strong>
                                </div>
                                <div className="text-muted-foreground">
                                  Descontos: <strong className="text-red-400">−R$ {fmtBRL(l.pagamento.vale + l.pagamento.consumoInterno - l.pagamento.ajuste)}</strong>
                                </div>
                                <div className="text-base">
                                  <strong>Total a pagar: R$ {fmtBRL(l.pagamento.saldoAReceber)}</strong>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bloco de Fechamento do Mês — visão consolidada de receita, transferências,
          cobranças bancárias e resultado, com botões de "Justificar" cobrança a cobrança. */}
      <FechamentoMes mes={mes} />

      {/* Edição da nota (linha em modo edit) */}
      {editandoId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Notas da edição</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nota do vale</label>
                <Input
                  value={edit.valeNota}
                  onChange={e => setEdit({ ...edit, valeNota: e.target.value })}
                  placeholder="opcional"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nota do consumo</label>
                <Input
                  value={edit.consumoInternoNota}
                  onChange={e => setEdit({ ...edit, consumoInternoNota: e.target.value })}
                  placeholder="ex: 2 cervejas + amendoim"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nota do ajuste</label>
                <Input
                  value={edit.ajusteNota}
                  onChange={e => setEdit({ ...edit, ajusteNota: e.target.value })}
                  placeholder="ex: vale-transporte, falta, prêmio..."
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, valor, bold, muted }: { label: string; valor: number; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`rounded border p-2 ${muted ? "opacity-80" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${bold ? "text-base font-bold" : "text-sm font-medium"}`}>R$ {fmtBRL(valor)}</div>
    </div>
  );
}

function Row({ label, valor, bold }: { label: ReactNode; valor: number; bold?: boolean }) {
  const positivo = valor >= 0;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={`text-muted-foreground ${bold ? "text-foreground" : ""}`}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""} ${positivo ? "text-emerald-400" : "text-red-400"}`}>
        {positivo ? "" : "−"}R$ {fmtBRL(Math.abs(valor))}
      </span>
    </div>
  );
}
