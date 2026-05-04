/**
 * DRE consolidada — visão "coração da empresa".
 *
 * Mostra entradas e saídas detalhadas do mês selecionado lado a lado com o
 * mês anterior, calculando variação percentual. Dados vêm do endpoint
 * /api/financeiro/dre/:mes que agrega:
 *   - Trinks (serviços por categoria de profissional, planos, produtos)
 *   - Pagamento (comissões, taxa de cartão)
 *   - Vendas Produtos (custos)
 *   - /api/financeiro entries (despesas manuais por categoria)
 *   - Consolidação (saldo bancário)
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, TrendingDown, Minus, ArrowDown, ArrowUp } from "lucide-react";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";
import { authFetch } from "@/lib/authStore";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface DREMes {
  mes: string;
  dataInicio: string;
  dataFim: string;
  entradas: {
    servicosBarbeiros: number;
    servicosEstetica: number;
    planos: number;
    produtosVendidos: number;
    outrasReceitas: number;
    total: number;
    atendimentos: number;
  };
  saidas: {
    comissoes: number;
    taxaCartao: number;
    custoProdutos: number;
    despesasFixas: number;
    despesasVariaveis: number;
    parcelamentos: number;
    investimentos: number;
    total: number;
  };
  resultadoLiquido: number;
  margem: number;
  saldoBancario: { entradas: number; saidas: number; saldo: number };
}

interface DREResponse {
  ok: boolean;
  atual: DREMes;
  anterior: DREMes | null;
  fetchedAt: string;
}

const fmt = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function VarBadge({ atual, anterior, inverter = false }: { atual: number; anterior: number | undefined; inverter?: boolean }) {
  if (anterior === undefined || anterior === null) return null;
  if (anterior === 0 && atual === 0) return null;
  const diff = atual - anterior;
  const pct = anterior !== 0 ? (diff / Math.abs(anterior)) * 100 : (atual > 0 ? 100 : -100);
  const isUp = diff >= 0;
  const isGood = inverter ? !isUp : isUp;
  const color = isGood ? "text-emerald-500" : "text-red-500";
  const Icon = isUp ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] ${color} ml-1.5 tabular-nums`}>
      <Icon className="w-3 h-3" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function LinhaDRE({
  label, atual, anterior, inverter, indentado = false, destaque = false,
}: {
  label: string; atual: number; anterior?: number; inverter?: boolean; indentado?: boolean; destaque?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between py-1.5 ${destaque ? "border-t border-border pt-2 mt-1 font-semibold" : ""} ${indentado ? "pl-4" : ""}`}>
      <span className={`text-sm ${destaque ? "" : "text-muted-foreground"}`}>{label}</span>
      <div className="flex items-baseline gap-1 tabular-nums">
        <span className={`text-sm ${destaque ? "font-semibold" : ""}`}>{fmt(atual)}</span>
        <VarBadge atual={atual} anterior={anterior} inverter={inverter} />
      </div>
    </div>
  );
}

interface Props {
  selectedMes: string;
  onChangeMes: (mes: string) => void;
}

export default function DREView({ selectedMes, onChangeMes }: Props) {
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [data, setData] = useState<DREResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    authFetch(`${API_BASE}/api/financeiro/dre/${selectedMes}`)
      .then(r => r.json())
      .then((d: DREResponse) => {
        if (cancelled) return;
        if (!d.ok) throw new Error((d as any).error || "Erro ao carregar DRE");
        setData(d);
      })
      .catch((e: any) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedMes]);

  const atual = data?.atual;
  const anterior = data?.anterior;
  const labelMesAtual = labelMesPtBR(selectedMes);
  const labelMesAnterior = anterior ? labelMesPtBR(anterior.mes) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">DRE — Demonstração de Resultado</h3>
          <p className="text-xs text-muted-foreground">
            {labelMesAtual}{anterior && ` × ${labelMesAnterior}`}
          </p>
        </div>
        <MonthSelector
          selectedMes={selectedMes}
          onChange={onChangeMes}
          mesCorrente={mesCorrente}
          isMesCorrente={selectedMes === mesCorrente}
          loading={loading}
          error={error || undefined}
          extraInfo="DRE consolidada do mês"
        />
      </div>

      {loading && !data && (
        <Card><CardContent className="p-8 flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Calculando DRE...</span>
        </CardContent></Card>
      )}

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-400">Erro: {error}</CardContent></Card>
      )}

      {atual && (
        <>
          {/* Resumo executivo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-emerald-500/5 border-emerald-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Entradas</span>
                </div>
                <div className="text-xl font-bold tabular-nums">{fmt(atual.entradas.total)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{atual.entradas.atendimentos} atendimentos</div>
                <VarBadge atual={atual.entradas.total} anterior={anterior?.entradas.total} />
              </CardContent>
            </Card>
            <Card className="bg-red-500/5 border-red-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Saídas</span>
                </div>
                <div className="text-xl font-bold tabular-nums">{fmt(atual.saidas.total)}</div>
                <VarBadge atual={atual.saidas.total} anterior={anterior?.saidas.total} inverter />
              </CardContent>
            </Card>
            <Card className={`${atual.resultadoLiquido >= 0 ? "bg-primary/5 border-primary/20" : "bg-amber-500/5 border-amber-500/20"}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Minus className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Resultado Líquido</span>
                </div>
                <div className={`text-xl font-bold tabular-nums ${atual.resultadoLiquido < 0 ? "text-red-500" : ""}`}>{fmt(atual.resultadoLiquido)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Margem {atual.margem.toFixed(1)}%</div>
                <VarBadge atual={atual.resultadoLiquido} anterior={anterior?.resultadoLiquido} />
              </CardContent>
            </Card>
          </div>

          {/* Detalhamento */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ENTRADAS */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  Entradas (Receita Bruta)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <LinhaDRE label="Serviços (barbeiros)" atual={atual.entradas.servicosBarbeiros} anterior={anterior?.entradas.servicosBarbeiros} />
                <LinhaDRE label="Serviços de estética" atual={atual.entradas.servicosEstetica} anterior={anterior?.entradas.servicosEstetica} />
                <LinhaDRE label="Planos / Assinaturas" atual={atual.entradas.planos} anterior={anterior?.entradas.planos} />
                <LinhaDRE label="Vendas de Produtos" atual={atual.entradas.produtosVendidos} anterior={anterior?.entradas.produtosVendidos} />
                {atual.entradas.outrasReceitas > 0 && (
                  <LinhaDRE label="Outras Receitas" atual={atual.entradas.outrasReceitas} anterior={anterior?.entradas.outrasReceitas} />
                )}
                <LinhaDRE label="TOTAL DE ENTRADAS" atual={atual.entradas.total} anterior={anterior?.entradas.total} destaque />
              </CardContent>
            </Card>

            {/* SAÍDAS */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  Saídas
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <LinhaDRE label="Comissões + bônus" atual={atual.saidas.comissoes} anterior={anterior?.saidas.comissoes} inverter />
                <LinhaDRE label="Taxa de cartão" atual={atual.saidas.taxaCartao} anterior={anterior?.saidas.taxaCartao} inverter />
                <LinhaDRE label="Custo de produtos vendidos" atual={atual.saidas.custoProdutos} anterior={anterior?.saidas.custoProdutos} inverter />
                <LinhaDRE label="Despesas fixas" atual={atual.saidas.despesasFixas} anterior={anterior?.saidas.despesasFixas} inverter />
                <LinhaDRE label="Despesas variáveis" atual={atual.saidas.despesasVariaveis} anterior={anterior?.saidas.despesasVariaveis} inverter />
                {atual.saidas.parcelamentos > 0 && (
                  <LinhaDRE label="Parcelamentos" atual={atual.saidas.parcelamentos} anterior={anterior?.saidas.parcelamentos} inverter />
                )}
                {atual.saidas.investimentos > 0 && (
                  <LinhaDRE label="Investimentos" atual={atual.saidas.investimentos} anterior={anterior?.saidas.investimentos} inverter />
                )}
                <LinhaDRE label="TOTAL DE SAÍDAS" atual={atual.saidas.total} anterior={anterior?.saidas.total} inverter destaque />
              </CardContent>
            </Card>
          </div>

          {/* Saldo bancário */}
          {(atual.saldoBancario.entradas > 0 || atual.saldoBancario.saidas > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Movimentação Bancária (Conciliação)</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Entradas no banco</div>
                    <div className="text-base font-semibold tabular-nums text-emerald-500">{fmt(atual.saldoBancario.entradas)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Saídas do banco</div>
                    <div className="text-base font-semibold tabular-nums text-red-500">{fmt(atual.saldoBancario.saidas)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Saldo do mês</div>
                    <div className="text-base font-semibold tabular-nums">{fmt(atual.saldoBancario.saldo)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
