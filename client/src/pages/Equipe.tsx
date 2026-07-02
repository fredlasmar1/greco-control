import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  RefreshCw,
  Pencil,
  Save,
  X as XIcon,
  ChevronRight,
  ChevronDown,
  Crown,
  AlertTriangle,
  CheckCircle2,
  Printer,
  Download,
  Users,
  Wallet,
  TrendingUp,
  Percent,
  Scissors,
  Package,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";
import ProdutosSemComissaoCard from "@/components/equipe/ProdutosSemComissaoCard";
import ConfigFinanceiraCard from "@/components/equipe/ConfigFinanceiraCard";

// ─────────────────────────────────────────────────────────────────────────
// Aba PAGAMENTO DA EQUIPE (refeita do zero — v1)
// Objetivo: fechar o pagamento da equipe num lugar só, com a lógica de dados
// GMAIL → CSV → API (0 token no caminho normal). Puxa do /api/pagamento (folha
// completa: comissões, bônus, salário fixo, Clube, saldo) e do /api/equipe/mes
// (produção por barbeiro). Não bate na API da Trinks no caminho normal.
//
//   1. Resumo geral (topo): produção da equipe, total a pagar, % da folha
//   2. Composição da folha: comissões | bônus | salário fixo | descontos
//   3. Tabela por pessoa: produção · % · comissões · bônus · fixo · vale/ajuste · a pagar
//   4. Exportar / Imprimir a folha do mês
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
  modoComissao?: "bruto" | "liquido";
  categoriaRanking?: "barbeiro" | "assistente";
  socio?: boolean;
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
    ajuste: number;
    ajusteNota: string;
    consumoInterno: number;
    consumoInternoNota: string;
    saldoAReceber: number;
    fechado: boolean;
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
  faturamento?: {
    totalReais: number;
    totalAtendimentos: number;
    servicosBruto: number;
    produtosBruto: number;
    planoReais: number;
  };
  conferencia?: {
    oficialTrinks: number;
    producaoRankingServicos: number;
    planoVendido?: number;
    planoMensal?: number;
    temRanking: boolean;
    apiPeriodo: number;
    temOficial: boolean;
  };
};

const fmtBRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Equipe() {
  const { toast } = useToast();
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [mes, setMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("equipe.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("equipe.selectedMes", mes); } catch {}
  }, [mes]);
  const isMesCorrente = mes === mesCorrente;

  const [data, setData] = useState<RespApi | null>(null);
  const [equipe, setEquipe] = useState<any>(null);   // /api/equipe/mes — fonte + semRanking
  const [loading, setLoading] = useState(false);
  const [buscandoApi, setBuscandoApi] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ vale: "", valeNota: "", ajuste: "", ajusteNota: "", consumoInterno: "", consumoInternoNota: "", horaExtra: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const VALOR_HORA = 10; // R$ 10,00 / hora extra (regra do dono)

  // Caminho normal = 0 token (Ranking / gap do dia). force=1 só no botão "Buscar na API".
  const carregar = async (force = false) => {
    if (force) setBuscandoApi(true); else setLoading(true);
    try {
      const qs = force ? "?force=true" : "";
      const [r1, r2] = await Promise.all([
        authFetch(`/api/pagamento/${mes}${qs}`),
        authFetch(`/api/equipe/mes/${mes}${force ? "?force=1" : ""}`).catch(() => null),
      ]);
      const j1: RespApi = await r1.json();
      if (!j1.ok) throw new Error((j1 as any).error || "Erro ao carregar a folha");
      setData(j1);
      if (r2) { try { setEquipe(await r2.json()); } catch { setEquipe(null); } }
      if (force) toast({ title: "Atualizado", description: "Dados frescos da Trinks para este mês." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setBuscandoApi(false);
    }
  };

  useEffect(() => { carregar(false); /* eslint-disable-next-line */ }, [mes]);

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
      horaExtra: "",
    });
  };
  const cancelarEdicao = () => {
    setEditandoId(null);
    setEdit({ vale: "", valeNota: "", ajuste: "", ajusteNota: "", consumoInterno: "", consumoInternoNota: "", horaExtra: "" });
  };
  // Converte horas extras (× R$10) direto no campo Ajuste, com nota automática.
  const aplicarHoraExtra = () => {
    const h = Number(String(edit.horaExtra).replace(",", ".")) || 0;
    if (h <= 0) return;
    const valor = Math.round(h * VALOR_HORA * 100) / 100;
    setEdit(prev => ({ ...prev, ajuste: String(valor), ajusteNota: `${h}h extra × R$ ${VALOR_HORA},00` }));
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
      toast({ title: "Salvo", description: `${l.nome} atualizado.` });
      cancelarEdicao();
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const monthLabel = labelMesPtBR(mes);
  const fonte = equipe?.fonte as string | undefined;
  const semRanking = !!equipe?.semRanking;

  // ── Linhas com movimento (esconde profissionais zerados) ──
  const linhas = useMemo(() => {
    if (!data) return [];
    return data.linhas
      .map(l => ({
        ...l,
        _producao: (l.bases.servicosLiquido || 0) + (l.bases.produtosLiquidoTotal || 0),
        _comissaoTotal: l.calculos.comissaoServicos + l.calculos.comissaoProdutos + l.calculos.comissaoPlano + l.calculos.comissaoClubeGreco,
        _bonus: l.calculos.bonusExcedente + l.calculos.bonusRanking,
      }))
      .filter(l =>
        l.calculos.totalBruto > 0 || l._producao > 0 ||
        l.percentuais.metaReais > 0 || l.percentuais.salarioFixo > 0 ||
        l.pagamento.vale > 0 || l.pagamento.ajuste !== 0 || l.pagamento.consumoInterno > 0)
      .sort((a, b) => b._producao - a._producao);
  }, [data]);

  const producaoEquipe = linhas.reduce((s, l) => s + l._producao, 0);
  const faturamentoMes = data?.faturamento?.totalReais || 0;
  const totalPagar = data?.totais.totalSaldo || 0;
  const totalBruto = data?.totais.totalBruto || 0;
  // % da folha = custo de pessoal (bruto, antes de vale/ajuste) sobre o faturamento oficial do mês
  const baseFolhaPct = faturamentoMes > 0 ? faturamentoMes : producaoEquipe;
  const pctFolha = baseFolhaPct > 0 ? (totalBruto / baseFolhaPct) * 100 : 0;

  // ── Exportar CSV da folha ──
  const exportarCSV = () => {
    if (!linhas.length) return;
    const head = ["Profissional", "Categoria", "Producao", "% do total", "Com. Servicos", "Com. Produtos", "Com. Pacotes/Clube", "Bonus", "Salario fixo", "Vale", "Consumo", "Ajuste", "A pagar"];
    const rows = linhas.map(l => {
      const pct = producaoEquipe > 0 ? (l._producao / producaoEquipe) * 100 : 0;
      return [
        l.nome,
        l.categoriaRanking === "assistente" ? "Assistente" : "Barbeiro",
        fmtBRL(l._producao), pct.toFixed(1) + "%",
        fmtBRL(l.calculos.comissaoServicos), fmtBRL(l.calculos.comissaoProdutos),
        fmtBRL(l.calculos.comissaoPlano + l.calculos.comissaoClubeGreco),
        fmtBRL(l._bonus), fmtBRL(l.percentuais.salarioFixo),
        fmtBRL(l.pagamento.vale), fmtBRL(l.pagamento.consumoInterno), fmtBRL(l.pagamento.ajuste),
        fmtBRL(l.pagamento.saldoAReceber),
      ];
    });
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pagamento-equipe-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* ── Header ── */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="w-4 h-4 text-primary" />
                Pagamento da Equipe
                <Badge variant="outline" className="text-xs">{monthLabel}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Feito pra fechar o pagamento — dados <strong>Gmail → CSV → API</strong> (0 token no caminho normal).
                {fonte === "ranking-csv" && <span className="text-emerald-500 ml-1">• Comissão definitiva (Ranking CSV)</span>}
                {fonte === "ao-vivo" && <span className="text-amber-500 ml-1">• Provisório (ao vivo)</span>}
              </p>
            </div>
            <MonthSelector
              selectedMes={mes}
              onChange={setMes}
              mesCorrente={mesCorrente}
              isMesCorrente={isMesCorrente}
              loading={loading}
              extraInfo={isMesCorrente ? "Mês atual · fecha ao vivo" : "Mês fechado"}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => carregar(false)} disabled={loading || buscandoApi}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Recarregar (0 token)
            </Button>
            <Button variant="outline" size="sm" onClick={exportarCSV} disabled={!linhas.length}>
              <Download className="w-4 h-4 mr-2" />Exportar CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!linhas.length}>
              <Printer className="w-4 h-4 mr-2" />Imprimir folha
            </Button>
            {data?.conferencia && (
              <div className="ml-auto">
                {(() => {
                  const c = data.conferencia!;
                  const ratio = c.oficialTrinks > 0 ? c.producaoRankingServicos / c.oficialTrinks : 0;
                  if (!c.temRanking || !c.temOficial)
                    return <Badge variant="outline" className="gap-1"><AlertTriangle className="w-3 h-3" />Conferência parcial</Badge>;
                  return ratio >= 0.55
                    ? <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="w-3 h-3" />Bate com a Trinks</Badge>
                    : <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Ranking parece incompleto</Badge>;
                })()}
              </div>
            )}
          </div>

          {/* Aviso: mês passado sem Ranking (0 token — não bateu na API) */}
          {semRanking && (
            <div className="mt-3 flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-md px-3 py-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                O <strong>Ranking de Profissionais de {monthLabel}</strong> não foi importado — a folha deste mês está
                vazia (e <strong>não gastou token</strong>). Suba o CSV em <em>Importar Trinks</em> (0 token) ou clique{" "}
                <button onClick={() => carregar(true)} disabled={buscandoApi}
                  className="underline font-medium text-amber-900 hover:text-amber-700">Buscar na API</button>{" "}
                pra uma consulta ao vivo (gasta token, só desta vez).
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Resumo geral (topo) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Produção da equipe" valor={producaoEquipe}
          sub={faturamentoMes > 0 ? `Oficial Trinks: R$ ${fmtBRL(faturamentoMes)}` : "serviços + produtos"} />
        <KpiCard icon={<Wallet className="w-4 h-4" />} label="Total a pagar (folha)" valor={totalPagar} destaque
          sub={`${linhas.length} pessoa${linhas.length !== 1 ? "s" : ""}`} />
        <KpiCard icon={<Percent className="w-4 h-4" />} label="Folha sobre faturamento" valorTexto={`${pctFolha.toFixed(1)}%`}
          sub={`Custo bruto: R$ ${fmtBRL(totalBruto)}`} />
        <KpiCard icon={<Users className="w-4 h-4" />} label="Comissão de serviços" valor={data?.totais.totalComissaoServicos || 0}
          sub={`Produtos: R$ ${fmtBRL(data?.totais.totalComissaoProdutos || 0)}`} />
      </div>

      {/* ── Composição da folha (4 blocos) ── */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wide text-emerald-500 font-semibold mb-2">Comissões</div>
            <div className="space-y-1 text-xs">
              <Row label="Serviços" valor={data.totais.totalComissaoServicos || 0} />
              <Row label="Produtos" valor={data.totais.totalComissaoProdutos || 0} />
              <Row label="Planos (Trinks)" valor={data.totais.totalComissaoPlano || 0} />
              {(data.totais.totalComissaoClubeGreco || 0) > 0 && (
                <Row label={<span className="flex items-center gap-1"><Crown className="w-3 h-3 text-purple-400" />Clube Greco</span>} valor={data.totais.totalComissaoClubeGreco || 0} />
              )}
            </div>
          </div>
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wide text-yellow-500 font-semibold mb-2">Bônus</div>
            <div className="space-y-1 text-xs">
              <Row label="🥇 Top 1 (barbeiro + assist.)" valor={data.totais.totalBonusRanking || 0} />
              <Row label="Excedente de meta" valor={data.totais.totalBonusExcedente || 0} />
              {(data.totais.totalBonusRanking || 0) + (data.totais.totalBonusExcedente || 0) === 0 && (
                <div className="text-muted-foreground italic">Sem bônus.</div>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wide text-sky-500 font-semibold mb-2">Salário fixo (assistentes)</div>
            <div className="space-y-1 text-xs">
              <Row label="Fixo do mês" valor={data.totais.totalSalarioFixo || 0} />
              <div className="text-[10px] text-muted-foreground pt-1">
                Assistente: <strong>R$ 1.500 fixo</strong> + hora extra a <strong>R$ 10/h</strong> (lançada no Ajuste, pelo editor da linha). Fixo por pessoa configurável em <strong>Metas</strong>.
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wide text-red-500 font-semibold mb-2">Descontos</div>
            <div className="space-y-1 text-xs">
              <Row label="Vales" valor={-(data.totais.totalVale || 0)} />
              <Row label="Consumo interno" valor={-(data.totais.totalConsumoInterno || 0)} />
              <Row label="Ajustes" valor={data.totais.totalAjuste || 0} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tabela por pessoa ── */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Folha por pessoa — {monthLabel}
            </CardTitle>
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Pencil className="w-3 h-3" /> Para lançar <strong>vale / consumo / ajuste</strong>, clique no lápis na linha da pessoa
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : linhas.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {semRanking ? "Suba o Ranking de Profissionais deste mês (0 token) para ver a folha." : "Sem profissionais com movimento neste mês."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Profissional</th>
                    <th className="py-2 px-2 text-right">Produção</th>
                    <th className="py-2 px-2 text-left min-w-[110px]">% do total</th>
                    <th className="py-2 px-2 text-right bg-emerald-500/5">Comissões</th>
                    <th className="py-2 px-2 text-right bg-yellow-500/5">Bônus</th>
                    <th className="py-2 px-2 text-right bg-sky-500/5">Fixo</th>
                    <th className="py-2 px-2 text-right bg-red-500/5">Vale/Ajuste</th>
                    <th className="py-2 px-2 text-right font-semibold">A pagar</th>
                    <th className="py-2 pl-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(l => {
                    const editando = editandoId === l.profissionalId;
                    const expandido = expandedId === l.profissionalId;
                    const pct = producaoEquipe > 0 ? (l._producao / producaoEquipe) * 100 : 0;
                    const descontos = l.pagamento.vale + l.pagamento.consumoInterno - l.pagamento.ajuste;
                    return (
                      <Fragment key={l.profissionalId}>
                        <tr
                          className={`border-b ${expandido ? "bg-muted/10" : "hover:bg-muted/5"} cursor-pointer`}
                          onClick={(e) => {
                            const t = e.target as HTMLElement;
                            if (t.closest("button") || t.closest("input")) return;
                            setExpandedId(expandido ? null : l.profissionalId);
                          }}
                        >
                          {/* Profissional */}
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              {expandido ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              <span className="font-medium">{l.nome}</span>
                              {l.posicaoRanking === 1 && l._bonus > 0 && (
                                <Badge variant="outline" className="text-[9px] h-5 border-yellow-500/50 text-yellow-600 bg-yellow-500/15">🥇 Top 1</Badge>
                              )}
                              {l.categoriaRanking === "assistente" && (
                                <Badge variant="outline" className="text-[9px] h-5 border-pink-500/40 text-pink-500 bg-pink-500/10">Assist.</Badge>
                              )}
                              {l.socio && (
                                <Badge variant="outline" className="text-[9px] h-5 border-purple-500/40 text-purple-500 bg-purple-500/10" title="Sócio — não recebe bônus">Sócio · sem bônus</Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Meta R$ {fmtBRL(l.percentuais.metaReais)} · {l.percentuais.pctServico}%/{l.percentuais.pctProduto}%/{l.percentuais.pctPlano}%
                            </div>
                          </td>
                          {/* Produção */}
                          <td className="py-2 px-2 text-right tabular-nums">
                            <div className="font-semibold">R$ {fmtBRL(l._producao)}</div>
                            <div className="text-[10px] text-muted-foreground">
                              serv {fmtBRL(l.bases.servicosLiquido)} · prod {fmtBRL(l.bases.produtosLiquidoTotal)}
                            </div>
                          </td>
                          {/* % do total */}
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <Progress value={pct} className="h-1.5 flex-1 max-w-[70px]" />
                              <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                          {/* Comissões */}
                          <td className="py-2 px-2 text-right tabular-nums bg-emerald-500/5">
                            <div className="text-emerald-500 font-semibold">R$ {fmtBRL(l._comissaoTotal)}</div>
                            <div className="text-[10px] text-muted-foreground">
                              serv {fmtBRL(l.calculos.comissaoServicos)} · prod {fmtBRL(l.calculos.comissaoProdutos)}
                            </div>
                          </td>
                          {/* Bônus */}
                          <td className="py-2 px-2 text-right tabular-nums bg-yellow-500/5">
                            <span className={l._bonus > 0 ? "text-yellow-600 font-semibold" : "text-muted-foreground"}>
                              {l._bonus > 0 ? `R$ ${fmtBRL(l._bonus)}` : "—"}
                            </span>
                          </td>
                          {/* Fixo */}
                          <td className="py-2 px-2 text-right tabular-nums bg-sky-500/5">
                            <span className={l.percentuais.salarioFixo > 0 ? "text-sky-600 font-semibold" : "text-muted-foreground"}>
                              {l.percentuais.salarioFixo > 0 ? `R$ ${fmtBRL(l.percentuais.salarioFixo)}` : "—"}
                            </span>
                          </td>
                          {/* Vale/Ajuste (inline edit) */}
                          <td className="py-2 px-2 text-right tabular-nums bg-red-500/5">
                            {editando ? (
                              <div className="flex flex-col items-end gap-1" onClick={e => e.stopPropagation()}>
                                <Input type="number" step="0.01" value={edit.vale} onChange={e => setEdit({ ...edit, vale: e.target.value })} className="w-24 h-7 text-right text-xs" placeholder="vale" />
                                <Input type="number" step="0.01" value={edit.ajuste} onChange={e => setEdit({ ...edit, ajuste: e.target.value })} className="w-24 h-7 text-right text-xs" placeholder="ajuste ±" />
                              </div>
                            ) : (
                              <div className="text-[11px]">
                                {l.pagamento.vale > 0 && <div className="text-red-500">−{fmtBRL(l.pagamento.vale)} vale</div>}
                                {l.pagamento.consumoInterno > 0 && <div className="text-red-500">−{fmtBRL(l.pagamento.consumoInterno)} cons.</div>}
                                {l.pagamento.ajuste !== 0 && <div className={l.pagamento.ajuste > 0 ? "text-emerald-500" : "text-red-500"}>{l.pagamento.ajuste > 0 ? "+" : "−"}{fmtBRL(Math.abs(l.pagamento.ajuste))} aj.</div>}
                                {descontos === 0 && l.pagamento.ajuste === 0 && <span className="text-muted-foreground">—</span>}
                              </div>
                            )}
                          </td>
                          {/* A pagar */}
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
                                  <Button size="sm" variant="ghost" onClick={cancelarEdicao} className="h-8 px-2"><XIcon className="w-3 h-3" /></Button>
                                </>
                              ) : (
                                !l.pagamento.fechado && (
                                  <Button size="sm" variant="outline" onClick={() => iniciarEdicao(l)} className="h-8 px-2 gap-1" title="Lançar vale / consumo / ajuste">
                                    <Pencil className="w-3 h-3" /><span className="text-[11px]">Vale/Desc</span>
                                  </Button>
                                )
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Detalhe expandido — memória de cálculo */}
                        {expandido && (
                          <tr className="bg-muted/10 border-b">
                            <td colSpan={9} className="py-3 px-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase tracking-wide text-emerald-500 font-semibold mb-1 flex items-center gap-1"><Scissors className="w-3 h-3" />Comissões</div>
                                  <Row label={`Serviços (${l.percentuais.pctServico}% × ${fmtBRL(l.bases.baseComissaoServicos || l.bases.servicosLiquido)})`} valor={l.calculos.comissaoServicos} />
                                  <Row label={`Produtos (${l.percentuais.pctProduto}% × ${fmtBRL(l.bases.produtosLiquidoComissionavel)})`} valor={l.calculos.comissaoProdutos} />
                                  <Row label={`Planos (${l.percentuais.pctPlano}% × ${fmtBRL(l.bases.planoReais)})`} valor={l.calculos.comissaoPlano} />
                                  {(l.clubeGreco?.assinantes || 0) > 0 && (
                                    <Row label={<span className="flex items-center gap-1"><Crown className="w-3 h-3 text-purple-400" />Clube Greco ({l.clubeGreco?.assinantes})</span>} valor={l.calculos.comissaoClubeGreco} />
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase tracking-wide text-yellow-500 font-semibold mb-1">Bônus & Fixo</div>
                                  {l.calculos.bonusRanking > 0 && <Row label={`🥇 Top 1 ${l.categoriaRanking === "assistente" ? "Assistente" : "Barbeiro"}`} valor={l.calculos.bonusRanking} />}
                                  {l.percentuais.pctBonusExcedente > 0 && <Row label={`Excedente meta (${l.percentuais.pctBonusExcedente}% × ${fmtBRL(l.calculos.excedenteMeta)})`} valor={l.calculos.bonusExcedente} />}
                                  {l.percentuais.salarioFixo > 0 && <Row label="Salário fixo" valor={l.percentuais.salarioFixo} />}
                                  {l._bonus === 0 && l.percentuais.salarioFixo === 0 && <div className="text-muted-foreground italic">Sem bônus/fixo.</div>}
                                </div>
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase tracking-wide text-red-500 font-semibold mb-1 flex items-center gap-1"><Package className="w-3 h-3" />Descontos / Ajustes</div>
                                  {l.pagamento.vale > 0 && <Row label={`Vale${l.pagamento.valeNota ? ` — ${l.pagamento.valeNota}` : ""}`} valor={-l.pagamento.vale} />}
                                  {l.pagamento.consumoInterno > 0 && <Row label={`Consumo${l.pagamento.consumoInternoNota ? ` — ${l.pagamento.consumoInternoNota}` : ""}`} valor={-l.pagamento.consumoInterno} />}
                                  {l.pagamento.ajuste !== 0 && <Row label={`Ajuste${l.pagamento.ajusteNota ? ` — ${l.pagamento.ajusteNota}` : ""}`} valor={l.pagamento.ajuste} />}
                                  {l.pagamento.vale === 0 && l.pagamento.consumoInterno === 0 && l.pagamento.ajuste === 0 && <div className="text-muted-foreground italic">Sem descontos.</div>}
                                </div>
                              </div>
                              {editando && (
                                <div className="mt-3 space-y-3" onClick={e => e.stopPropagation()}>
                                {/* Hora extra: horas × R$10 → Ajuste */}
                                <div className="flex items-end gap-2 flex-wrap rounded-md border border-sky-500/30 bg-sky-500/5 p-2">
                                  <div>
                                    <label className="text-[10px] text-muted-foreground block mb-1">Horas extras (× R$ {VALOR_HORA},00)</label>
                                    <Input type="number" step="0.5" value={edit.horaExtra} onChange={e => setEdit({ ...edit, horaExtra: e.target.value })} className="h-8 text-xs w-28" placeholder="ex: 11.4" />
                                  </div>
                                  <Button size="sm" variant="outline" className="h-8" onClick={aplicarHoraExtra} disabled={!(Number(String(edit.horaExtra).replace(",", ".")) > 0)}>
                                    = R$ {fmtBRL((Number(String(edit.horaExtra).replace(",", ".")) || 0) * VALOR_HORA)} no Ajuste
                                  </Button>
                                  <span className="text-[10px] text-muted-foreground">Assistente: R$ 1.500 fixo + hora extra a R$ {VALOR_HORA}/h</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div><label className="text-[10px] text-muted-foreground block mb-1">Nota do vale</label><Input value={edit.valeNota} onChange={e => setEdit({ ...edit, valeNota: e.target.value })} className="h-8 text-xs" placeholder="opcional" /></div>
                                  <div><label className="text-[10px] text-muted-foreground block mb-1">Nota do consumo</label><Input value={edit.consumoInternoNota} onChange={e => setEdit({ ...edit, consumoInternoNota: e.target.value })} className="h-8 text-xs" placeholder="ex: 2 cervejas" /></div>
                                  <div><label className="text-[10px] text-muted-foreground block mb-1">Nota do ajuste</label><Input value={edit.ajusteNota} onChange={e => setEdit({ ...edit, ajusteNota: e.target.value })} className="h-8 text-xs" placeholder="ex: horas extras, falta, prêmio" /></div>
                                </div>
                                </div>
                              )}
                              <div className="mt-3 pt-3 border-t flex items-center justify-end gap-6 text-sm">
                                <span className="text-muted-foreground">Bruto: <strong className="text-foreground">R$ {fmtBRL(l.calculos.totalBruto)}</strong></span>
                                <span className="text-muted-foreground">Descontos: <strong className="text-red-500">−R$ {fmtBRL(descontos)}</strong></span>
                                <span className="text-base"><strong>A pagar: R$ {fmtBRL(l.pagamento.saldoAReceber)}</strong></span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {/* Linha de total */}
                  <tr className="border-t-2 font-semibold bg-muted/20">
                    <td className="py-2 pr-3">Total da equipe</td>
                    <td className="py-2 px-2 text-right tabular-nums">R$ {fmtBRL(producaoEquipe)}</td>
                    <td className="py-2 px-2 text-left text-muted-foreground text-xs">100%</td>
                    <td className="py-2 px-2 text-right tabular-nums bg-emerald-500/5 text-emerald-600">R$ {fmtBRL((data?.totais.totalComissaoServicos || 0) + (data?.totais.totalComissaoProdutos || 0) + (data?.totais.totalComissaoPlano || 0) + (data?.totais.totalComissaoClubeGreco || 0))}</td>
                    <td className="py-2 px-2 text-right tabular-nums bg-yellow-500/5 text-yellow-600">R$ {fmtBRL((data?.totais.totalBonusRanking || 0) + (data?.totais.totalBonusExcedente || 0))}</td>
                    <td className="py-2 px-2 text-right tabular-nums bg-sky-500/5 text-sky-600">R$ {fmtBRL(data?.totais.totalSalarioFixo || 0)}</td>
                    <td className="py-2 px-2 text-right tabular-nums bg-red-500/5 text-red-500">−R$ {fmtBRL((data?.totais.totalVale || 0) + (data?.totais.totalConsumoInterno || 0) - (data?.totais.totalAjuste || 0))}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-base">R$ {fmtBRL(totalPagar)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Configurações da folha (recolhível) ── */}
      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium flex items-center gap-2">
          <Percent className="w-4 h-4 text-muted-foreground" />
          Configurações da folha (taxa de cartão · produtos sem comissão)
        </summary>
        <div className="px-4 pb-4 space-y-4">
          <ConfigFinanceiraCard />
          <ProdutosSemComissaoCard />
        </div>
      </details>
    </div>
  );
}

// ── Helpers ──
function KpiCard({ icon, label, valor, valorTexto, sub, destaque }: { icon: ReactNode; label: string; valor?: number; valorTexto?: string; sub?: string; destaque?: boolean }) {
  return (
    <Card className={`bg-card border-card-border ${destaque ? "border-primary/40" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
          <div className="w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center text-primary">{icon}</div>
          <p className="text-xs">{label}</p>
        </div>
        <p className={`font-bold ${destaque ? "text-2xl text-primary" : "text-xl"}`}>
          {valorTexto != null ? valorTexto : `R$ ${fmtBRL(valor || 0)}`}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, valor, bold }: { label: ReactNode; valor: number; bold?: boolean }) {
  const positivo = valor >= 0;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={`text-muted-foreground ${bold ? "text-foreground" : ""}`}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""} ${positivo ? "text-emerald-500" : "text-red-500"}`}>
        {positivo ? "" : "−"}R$ {fmtBRL(Math.abs(valor))}
      </span>
    </div>
  );
}
