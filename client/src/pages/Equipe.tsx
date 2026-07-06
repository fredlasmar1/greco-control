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
  PiggyBank,
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
    bonusMetaCategoria?: number;
    categoriaMetaBruta?: string;
    metaBrutaCategoria?: number;
    servicosBruto?: number;
    bateuMetaCategoria?: boolean;
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
    multa?: number;
    multaNota?: string;
    comprasCartao?: number;
    comprasCartaoNota?: string;
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
    totalBonusMetaCategoria?: number;
    totalSalarioFixo?: number;
    totalVale: number;
    totalAjuste: number;
    totalConsumoInterno: number;
    totalMulta?: number;
    totalComprasCartao?: number;
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
  aguardandoRanking?: boolean;
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
  const [edit, setEdit] = useState({ vale: "", valeNota: "", ajuste: "", ajusteNota: "", consumoInterno: "", consumoInternoNota: "", multa: "", multaNota: "", comprasCartao: "", comprasCartaoNota: "", horaExtra: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [caixinha, setCaixinha] = useState<{ totalReais: number; totalDias: number; mesCorrenteReais: number; mesCorrenteDias: number; threshold: number; perDia: number } | null>(null);
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
  useEffect(() => {
    const ano = mes.slice(0, 4);
    authFetch(`/api/caixinha/${ano}`).then(r => r.json()).then(j => { if (j.ok) setCaixinha(j); }).catch(() => {});
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
      multa: String(l.pagamento.multa || 0),
      multaNota: l.pagamento.multaNota || "",
      comprasCartao: String(l.pagamento.comprasCartao || 0),
      comprasCartaoNota: l.pagamento.comprasCartaoNota || "",
      horaExtra: "",
    });
  };
  const cancelarEdicao = () => {
    setEditandoId(null);
    setEdit({ vale: "", valeNota: "", ajuste: "", ajusteNota: "", consumoInterno: "", consumoInternoNota: "", multa: "", multaNota: "", comprasCartao: "", comprasCartaoNota: "", horaExtra: "" });
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
          multa: Number(edit.multa.replace(",", ".")) || 0,
          multaNota: edit.multaNota,
          comprasCartao: Number(edit.comprasCartao.replace(",", ".")) || 0,
          comprasCartaoNota: edit.comprasCartaoNota,
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
        _bonus: l.calculos.bonusExcedente + l.calculos.bonusRanking + (l.calculos.bonusMetaCategoria || 0),
      }))
      .filter(l =>
        l.calculos.totalBruto > 0 || l._producao > 0 ||
        l.percentuais.metaReais > 0 || l.percentuais.salarioFixo > 0 ||
        l.pagamento.vale > 0 || l.pagamento.ajuste !== 0 || l.pagamento.consumoInterno > 0)
      .sort((a, b) => b._producao - a._producao);
  }, [data]);

  const producaoEquipe = linhas.reduce((s, l) => s + l._producao, 0);
  // Faturamento OFICIAL do mês = receita do e-mail diário da Trinks (Gmail),
  // fonte canônica. A soma do ranking (produção) é fallback, e a produção da
  // equipe é o último recurso. NUNCA rotular a produção do ranking como "oficial".
  const oficialTrinks = data?.conferencia?.oficialTrinks || 0;
  const faturamentoRanking = data?.faturamento?.totalReais || 0;
  const totalPagar = data?.totais.totalSaldo || 0;
  const totalBruto = data?.totais.totalBruto || 0;
  // % da folha = custo de pessoal (bruto, antes de vale/ajuste) sobre o faturamento OFICIAL (Gmail).
  const baseFolhaPct = oficialTrinks > 0 ? oficialTrinks : (faturamentoRanking > 0 ? faturamentoRanking : producaoEquipe);
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

      {/* Aviso: mês corrente sem Ranking de Profissionais → produção por barbeiro = 0 */}
      {data?.aguardandoRanking && (
        <Card className="bg-amber-500/5 border-amber-500/40">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Produção por barbeiro ainda não disponível para {monthLabel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  O e-mail diário (Gmail) traz só o <strong>total da loja</strong> — a produção e a comissão por barbeiro vêm do <strong>Ranking de Profissionais</strong> (CSV, 0 token). Suba o ranking deste mês em <strong>Importar Trinks</strong> pra ver os números por pessoa. Salário fixo, vale, multas e descontos já funcionam abaixo.
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => carregar(true)} disabled={buscandoApi} className="flex-shrink-0">
              {buscandoApi ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}Buscar na API (gasta token)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Resumo geral (topo) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Produção da equipe" valor={producaoEquipe}
          sub={oficialTrinks > 0 ? `Oficial Trinks (Gmail): R$ ${fmtBRL(oficialTrinks)}` : "serviços + produtos"} />
        <KpiCard icon={<Wallet className="w-4 h-4" />} label="Total a pagar (folha)" valor={totalPagar} destaque
          sub={`${linhas.length} pessoa${linhas.length !== 1 ? "s" : ""}`} />
        <KpiCard icon={<Percent className="w-4 h-4" />} label="Folha sobre faturamento" valorTexto={`${pctFolha.toFixed(1)}%`}
          sub={oficialTrinks > 0 ? `Custo bruto R$ ${fmtBRL(totalBruto)} ÷ oficial` : `Custo bruto: R$ ${fmtBRL(totalBruto)}`} />
        <KpiCard icon={<Users className="w-4 h-4" />} label="Comissão de serviços" valor={data?.totais.totalComissaoServicos || 0}
          sub={`Produtos: R$ ${fmtBRL(data?.totais.totalComissaoProdutos || 0)}`} />
      </div>

      {/* ── Caixinha de fim de ano (fundo único da equipe) ── */}
      {caixinha && (
        <Card className="bg-card border-card-border border-amber-500/40">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0"><PiggyBank className="w-5 h-5 text-amber-500" /></div>
              <div>
                <p className="text-sm font-semibold">🐷 Caixinha de fim de ano <span className="text-xs font-normal text-muted-foreground">· {mes.slice(0, 4)}</span></p>
                <p className="text-[11px] text-muted-foreground">R$ {fmtBRL(caixinha.perDia)} por dia em que a loja vendeu ≥ R$ {fmtBRL(caixinha.threshold)} (fundo único da equipe).</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Este mês</p>
                <p className="text-lg font-bold text-amber-600">R$ {fmtBRL(caixinha.mesCorrenteReais)}</p>
                <p className="text-[10px] text-muted-foreground">{caixinha.mesCorrenteDias} dia{caixinha.mesCorrenteDias !== 1 ? "s" : ""}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Acumulado no ano</p>
                <p className="text-2xl font-bold text-amber-500">R$ {fmtBRL(caixinha.totalReais)}</p>
                <p className="text-[10px] text-muted-foreground">{caixinha.totalDias} dia{caixinha.totalDias !== 1 ? "s" : ""} batidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
              <Row label="🍽️ Jantar (meta categoria)" valor={data.totais.totalBonusMetaCategoria || 0} />
              <Row label="🥇 Top 1 (barbeiro + assist.)" valor={data.totais.totalBonusRanking || 0} />
              <Row label="Excedente de meta" valor={data.totais.totalBonusExcedente || 0} />
              {(data.totais.totalBonusRanking || 0) + (data.totais.totalBonusExcedente || 0) + (data.totais.totalBonusMetaCategoria || 0) === 0 && (
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
              <Row label="Multas" valor={-(data.totais.totalMulta || 0)} />
              <Row label="Compras/cursos no cartão" valor={-(data.totais.totalComprasCartao || 0)} />
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
                    const descontos = l.pagamento.vale + l.pagamento.consumoInterno + (l.pagamento.multa || 0) + (l.pagamento.comprasCartao || 0) - l.pagamento.ajuste;
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
                                <Input type="number" step="0.01" value={edit.multa} onChange={e => setEdit({ ...edit, multa: e.target.value })} className="w-24 h-7 text-right text-xs" placeholder="multa" />
                                <Input type="number" step="0.01" value={edit.comprasCartao} onChange={e => setEdit({ ...edit, comprasCartao: e.target.value })} className="w-24 h-7 text-right text-xs" placeholder="compras cartão" />
                                <Input type="number" step="0.01" value={edit.ajuste} onChange={e => setEdit({ ...edit, ajuste: e.target.value })} className="w-24 h-7 text-right text-xs" placeholder="ajuste ±" />
                              </div>
                            ) : (
                              <div className="text-[11px]">
                                {l.pagamento.vale > 0 && <div className="text-red-500">−{fmtBRL(l.pagamento.vale)} vale</div>}
                                {l.pagamento.consumoInterno > 0 && <div className="text-red-500">−{fmtBRL(l.pagamento.consumoInterno)} cons.</div>}
                                {(l.pagamento.multa || 0) > 0 && <div className="text-red-500">−{fmtBRL(l.pagamento.multa || 0)} multa</div>}
                                {(l.pagamento.comprasCartao || 0) > 0 && <div className="text-red-500">−{fmtBRL(l.pagamento.comprasCartao || 0)} cartão</div>}
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
                                  {(l.calculos.bonusMetaCategoria || 0) > 0 && <Row label={`🍽️ Jantar — bateu meta ${l.calculos.categoriaMetaBruta || ""} (${fmtBRL(l.calculos.servicosBruto || 0)} ≥ ${fmtBRL(l.calculos.metaBrutaCategoria || 0)})`} valor={l.calculos.bonusMetaCategoria || 0} />}
                                  {(l.calculos.bonusMetaCategoria || 0) === 0 && (l.calculos.metaBrutaCategoria || 0) > 0 && <div className="text-[10px] text-muted-foreground">Jantar {l.calculos.categoriaMetaBruta}: falta {fmtBRL(Math.max(0, (l.calculos.metaBrutaCategoria || 0) - (l.calculos.servicosBruto || 0)))} pra bater {fmtBRL(l.calculos.metaBrutaCategoria || 0)}</div>}
                                  {l.calculos.bonusRanking > 0 && <Row label={`🥇 Top 1 ${l.categoriaRanking === "assistente" ? "Assistente" : "Barbeiro"}`} valor={l.calculos.bonusRanking} />}
                                  {l.percentuais.pctBonusExcedente > 0 && <Row label={`Excedente meta (${l.percentuais.pctBonusExcedente}% × ${fmtBRL(l.calculos.excedenteMeta)})`} valor={l.calculos.bonusExcedente} />}
                                  {l.percentuais.salarioFixo > 0 && <Row label="Salário fixo" valor={l.percentuais.salarioFixo} />}
                                  {l._bonus === 0 && l.percentuais.salarioFixo === 0 && (l.calculos.metaBrutaCategoria || 0) === 0 && <div className="text-muted-foreground italic">Sem bônus/fixo.</div>}
                                </div>
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase tracking-wide text-red-500 font-semibold mb-1 flex items-center gap-1"><Package className="w-3 h-3" />Descontos / Ajustes</div>
                                  {l.pagamento.vale > 0 && <Row label={`Vale${l.pagamento.valeNota ? ` — ${l.pagamento.valeNota}` : ""}`} valor={-l.pagamento.vale} />}
                                  {l.pagamento.consumoInterno > 0 && <Row label={`Consumo${l.pagamento.consumoInternoNota ? ` — ${l.pagamento.consumoInternoNota}` : ""}`} valor={-l.pagamento.consumoInterno} />}
                                  {(l.pagamento.multa || 0) > 0 && <Row label={`Multa${l.pagamento.multaNota ? ` — ${l.pagamento.multaNota}` : ""}`} valor={-(l.pagamento.multa || 0)} />}
                                  {(l.pagamento.comprasCartao || 0) > 0 && <Row label={`Compras/cursos no cartão${l.pagamento.comprasCartaoNota ? ` — ${l.pagamento.comprasCartaoNota}` : ""}`} valor={-(l.pagamento.comprasCartao || 0)} />}
                                  {l.pagamento.ajuste !== 0 && <Row label={`Ajuste${l.pagamento.ajusteNota ? ` — ${l.pagamento.ajusteNota}` : ""}`} valor={l.pagamento.ajuste} />}
                                  {l.pagamento.vale === 0 && l.pagamento.consumoInterno === 0 && (l.pagamento.multa || 0) === 0 && (l.pagamento.comprasCartao || 0) === 0 && l.pagamento.ajuste === 0 && <div className="text-muted-foreground italic">Sem descontos.</div>}
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
                                  <div><label className="text-[10px] text-muted-foreground block mb-1">Nota da multa</label><Input value={edit.multaNota} onChange={e => setEdit({ ...edit, multaNota: e.target.value })} className="h-8 text-xs" placeholder="ex: atraso 3 dias" /></div>
                                  <div><label className="text-[10px] text-muted-foreground block mb-1">Nota compras/cursos no cartão</label><Input value={edit.comprasCartaoNota} onChange={e => setEdit({ ...edit, comprasCartaoNota: e.target.value })} className="h-8 text-xs" placeholder="ex: curso de barba R$ 200" /></div>
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

      {/* ── Vouchers do mês (dono decide comissão caso a caso) ── */}
      <VoucherCard mes={mes} />
      <LeadsMetasCard mes={mes} />

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

function TogglePill({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`inline-flex rounded-md border border-card-border overflow-hidden text-[10px] ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      <button onClick={() => onChange(true)} className={`px-2 py-0.5 ${on ? "bg-emerald-500 text-white" : "text-muted-foreground"}`}>SIM</button>
      <button onClick={() => onChange(false)} className={`px-2 py-0.5 ${!on ? "bg-red-500 text-white" : "text-muted-foreground"}`}>NÃO</button>
    </div>
  );
}

function KpiMini({ label, valor, valorTexto, cor, destaque }: { label: string; valor?: number; valorTexto?: string; cor?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${destaque ? "border-red-500/30 bg-red-500/5" : "border-card-border"}`}>
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className={`text-lg font-bold ${cor || ""}`}>{valorTexto != null ? valorTexto : `R$ ${fmtBRL(valor || 0)}`}</p>
    </div>
  );
}

function VoucherCard({ mes }: { mes: string }) {
  const [d, setD] = useState<any>(null);
  const carregar = () => { authFetch(`/api/voucher/${mes}`).then(r => r.json()).then(x => { if (x?.ok) setD(x); }).catch(() => {}); };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mes]);
  const toggle = async (id: string, campo: "ehVoucher" | "pagaComissao", valor: boolean) => {
    setD((prev: any) => prev ? { ...prev, itens: prev.itens.map((it: any) => it.id === id ? { ...it, [campo]: valor } : it) } : prev);
    await authFetch(`/api/voucher/${mes}/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [campo]: valor }) }).catch(() => {});
    carregar();
  };
  if (!d) return null;
  const t = d.totais || {};
  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">🎟️ Vouchers do mês — {labelMesPtBR(mes)}</CardTitle>
        <p className="text-xs text-muted-foreground">Candidatos: pagos por <strong>voucher/pré-pago/cortesia</strong> ou <strong>R$ 0</strong>. Marque <strong>é voucher?</strong> e <strong>paga comissão?</strong> — o custo aparece em cima.</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <KpiMini label="Vouchers" valorTexto={String(t.nVouchers || 0)} />
          <KpiMini label="Valor de tabela" valor={t.valorTabela} cor="text-amber-500" />
          <KpiMini label="Desconto dado" valorTexto={`R$ ${fmtBRL(t.desconto || 0)}`} cor="text-red-500" />
          <KpiMini label="% desconto médio" valorTexto={`${(t.pctDescontoMedio || 0).toFixed(1)}%`} cor="text-red-500" />
          <KpiMini label="Custo total (tabela+com.)" valor={t.custoTotal} cor="text-red-500" destaque />
        </div>
        {d.itens.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum candidato a voucher neste mês (nenhum atendimento por voucher/cortesia ou R$ 0).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2">Data</th><th className="py-2 px-2">Cliente / serviço</th><th className="py-2 px-2">Profissional</th><th className="py-2 px-2 text-right">Valor tabela</th><th className="py-2 px-2 text-right">Desconto</th><th className="py-2 px-2 text-center">É voucher?</th><th className="py-2 px-2 text-center">Paga comissão?</th>
              </tr></thead>
              <tbody>{d.itens.map((it: any) => (
                <tr key={it.id} className={`border-b ${it.ehVoucher ? "" : "opacity-50"}`}>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{(it.data || "").split("-").reverse().join("/")}</td>
                  <td className="py-1.5 px-2"><div className="font-medium">{it.cliente}</div><div className="text-[10px] text-muted-foreground">{it.servico} · {it.forma}</div></td>
                  <td className="py-1.5 px-2">{it.profissional}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">R$ {fmtBRL(it.valorTabela)}<div className="text-[10px] text-muted-foreground">com. R$ {fmtBRL(it.comissaoPotencial)}</div></td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-red-500">{(it.desconto || 0) > 0 ? <>−R$ {fmtBRL(it.desconto)}<div className="text-[10px]">{(it.pctDesconto || 0).toFixed(0)}%</div></> : "—"}</td>
                  <td className="py-1.5 px-2 text-center"><TogglePill on={it.ehVoucher} onChange={v => toggle(it.id, "ehVoucher", v)} /></td>
                  <td className="py-1.5 px-2 text-center"><TogglePill on={it.pagaComissao} disabled={!it.ehVoucher} onChange={v => toggle(it.id, "pagaComissao", v)} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {d.porBarbeiro?.length > 0 && (
          <div className="mt-3 border-t border-card-border pt-2">
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Resumo por profissional (só os marcados como voucher)</p>
            {d.porBarbeiro.map((p: any) => (
              <div key={p.nome} className="flex justify-between text-xs py-0.5"><span>{p.nome} · {p.qtd} atend.</span><span className="tabular-nums text-muted-foreground">tabela R$ {fmtBRL(p.valorTabela)} · desconto R$ {fmtBRL(p.desconto || 0)} · comissão R$ {fmtBRL(p.comissao)}</span></div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Leads (cliente novo com desconto) puxados do Greco Metas via HUB — pro fechamento.
function LeadsMetasCard({ mes }: { mes: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { authFetch(`/api/leads-metas/${mes}`).then(r => r.json()).then(setD).catch(() => setD(null)); }, [mes]);
  if (!d) return null;
  const t = d.totais || {};
  const fonteBadge = (f: string) => f === "instagram" ? "bg-pink-500/15 text-pink-500 border-pink-500/30" : f === "google" ? "bg-sky-500/15 text-sky-500 border-sky-500/30" : "bg-purple-500/15 text-purple-500 border-purple-500/30";
  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">🎯 Clientes novos com desconto (Greco Metas) — {labelMesPtBR(mes)}</CardTitle>
        <p className="text-xs text-muted-foreground">Leads cadastrados no Greco Metas (Instagram/Google/Vouchers) com o desconto de 1ª visita. Puxado ao vivo do Metas, 0 token.</p>
      </CardHeader>
      <CardContent>
        {!d.disponivel ? (
          <div className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded p-3">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />Não consegui conectar ao Greco Metas. {d.motivo || "Verifique a HUB_API_KEY nos dois sistemas."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <KpiMini label="Leads no mês" valorTexto={String(t.leads || 0)} />
              <KpiMini label="Compareceram" valorTexto={`${t.compareceram || 0}/${t.leads || 0}`} cor="text-emerald-500" />
              <KpiMini label="Desconto dado" valor={t.descontoRS || 0} cor="text-red-500" />
              <KpiMini label="Líquido faturado" valor={t.liquido || 0} cor="text-emerald-500" />
            </div>
            {(d.leads || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">Nenhum lead com desconto cadastrado neste mês.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Cliente</th><th className="py-2 px-2">Fonte</th><th className="py-2 px-2">Serviço</th><th className="py-2 px-2">Barbeiro</th><th className="py-2 px-2 text-right">Desconto</th><th className="py-2 px-2 text-right">Tabela → líquido</th><th className="py-2 px-2 text-center">Veio?</th>
                  </tr></thead>
                  <tbody>{d.leads.map((l: any) => (
                    <tr key={l.id} className="border-b">
                      <td className="py-1.5 pr-2 font-medium">{l.nome}{l.telefone ? <div className="text-[10px] text-muted-foreground">{l.telefone}</div> : null}</td>
                      <td className="py-1.5 px-2"><span className={`text-[9px] px-1.5 py-0.5 rounded border ${fonteBadge(l.fonte)}`}>{l.fonte}</span></td>
                      <td className="py-1.5 px-2 text-xs">{l.servico || "—"}</td>
                      <td className="py-1.5 px-2 text-xs">{l.profissionalNome || "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-red-500">{l.desconto === "gratis" ? "grátis (100%)" : `${l.pctDesconto}%`}<div className="text-[10px]">−R$ {fmtBRL(l.descontoRS)}</div></td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-xs">R$ {fmtBRL(l.valorTabela)} → <strong>R$ {fmtBRL(l.valorLiquido)}</strong></td>
                      <td className="py-1.5 px-2 text-center">{l.compareceu ? <span className="text-emerald-500">✓</span> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {(d.porBarbeiro || []).length > 0 && (
              <div className="mt-3 border-t border-card-border pt-2">
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Desconto por barbeiro</p>
                {d.porBarbeiro.map((p: any) => (
                  <div key={p.profissional} className="flex justify-between text-xs py-0.5"><span>{p.profissional} · {p.compareceram}/{p.leads} vieram</span><span className="tabular-nums text-muted-foreground">desconto R$ {fmtBRL(p.descontoRS)} · líquido R$ {fmtBRL(p.liquido)}</span></div>
                ))}
              </div>
            )}
          </>
        )}
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
