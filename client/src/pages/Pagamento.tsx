import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authStore";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP } from "@/lib/mesUtils";

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
  calculos: {
    comissaoServicos: number;
    comissaoProdutos: number;
    comissaoPlano: number;
    excedenteMeta: number;
    bonusExcedente: number;
    salarioFixo: number;
    totalBruto: number;
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
  totais: { totalBruto: number; totalVale: number; totalAjuste: number; totalConsumoInterno: number; totalTaxaCartao: number; totalSaldo: number };
  faturamento?: {
    totalReais: number;
    totalAtendimentos: number;
    servicosBruto: number;
    servicosLiquido: number;
    produtosBruto: number;
    produtosLiquido: number;
    planoReais: number;
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
              Aba Pagamento
              <Badge variant="outline" className="text-xs">v20.2</Badge>
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
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Profissional</th>
                    <th className="py-2 px-2 text-right">Serviços líq.</th>
                    <th className="py-2 px-2 text-right">Produtos com.</th>
                    <th className="py-2 px-2 text-right">Plano</th>
                    <th className="py-2 px-2 text-right">Bônus meta</th>
                    <th className="py-2 px-2 text-right">Total bruto</th>
                    <th className="py-2 px-2 text-right">Vale (15)</th>
                    <th className="py-2 px-2 text-right">Consumo</th>
                    <th className="py-2 px-2 text-right">Ajuste</th>
                    <th className="py-2 px-2 text-right font-semibold">Saldo</th>
                    <th className="py-2 pl-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.map(l => {
                    const editando = editandoId === l.profissionalId;
                    const fechado = l.pagamento.fechado;
                    return (
                      <tr key={l.profissionalId} className={`border-b ${fechado ? "bg-muted/20" : ""}`}>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {fechado && <Lock className="w-3 h-3 text-muted-foreground" />}
                            <span className="font-medium">{l.nome}</span>
                            {l.modoComissao === 'liquido' && (
                              <Badge
                                variant="outline"
                                className="text-[9px] h-5 border-amber-500/40 text-amber-400 bg-amber-500/10"
                                title={l.modoFonte === 'profissional' ? "Modo override deste profissional" : "Modo padrão da empresa"}
                              >
                                Líquido{l.modoFonte === 'profissional' ? '*' : ''}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Meta R$ {fmtBRL(l.percentuais.metaReais)} · {l.percentuais.pctServico}%/{l.percentuais.pctProduto}%/{l.percentuais.pctPlano}%
                            {l.percentuais.pctBonusExcedente > 0 ? ` · Bônus ${l.percentuais.pctBonusExcedente}%` : ""}
                            {l.percentuais.salarioFixo > 0 ? ` · Fixo R$ ${fmtBRL(l.percentuais.salarioFixo)}` : ""}
                            {l.modoComissao === 'liquido' && l.bases.custoInsumos != null && l.bases.custoInsumos > 0 && (
                              <span className="text-amber-400"> · Insumos R$ {fmtBRL(l.bases.custoInsumos)} descontados</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          R$ {fmtBRL(l.bases.servicosLiquido)}
                          <div className="text-[10px] text-muted-foreground">→ R$ {fmtBRL(l.calculos.comissaoServicos)}</div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          R$ {fmtBRL(l.bases.produtosLiquidoComissionavel)}
                          <div className="text-[10px] text-muted-foreground">→ R$ {fmtBRL(l.calculos.comissaoProdutos)}</div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          R$ {fmtBRL(l.bases.planoReais)}
                          <div className="text-[10px] text-muted-foreground">→ R$ {fmtBRL(l.calculos.comissaoPlano)}</div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          R$ {fmtBRL(l.calculos.bonusExcedente)}
                          {l.calculos.excedenteMeta > 0 && (
                            <div className="text-[10px] text-muted-foreground">excd R$ {fmtBRL(l.calculos.excedenteMeta)}</div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold">
                          R$ {fmtBRL(l.calculos.totalBruto)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {editando ? (
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="1000"
                              value={edit.vale}
                              onChange={e => setEdit({ ...edit, vale: e.target.value })}
                              className="w-24 h-8 text-right"
                              data-testid={`vale-${l.profissionalId}`}
                            />
                          ) : (
                            <>R$ {fmtBRL(l.pagamento.vale)}</>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {editando ? (
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={edit.consumoInterno}
                              onChange={e => setEdit({ ...edit, consumoInterno: e.target.value })}
                              className="w-24 h-8 text-right"
                              data-testid={`consumo-${l.profissionalId}`}
                            />
                          ) : (
                            <>R$ {fmtBRL(l.pagamento.consumoInterno)}</>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {editando ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={edit.ajuste}
                              onChange={e => setEdit({ ...edit, ajuste: e.target.value })}
                              className="w-24 h-8 text-right"
                              data-testid={`ajuste-${l.profissionalId}`}
                            />
                          ) : (
                            <>R$ {fmtBRL(l.pagamento.ajuste)}</>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-bold">
                          R$ {fmtBRL(l.pagamento.saldoAReceber)}
                        </td>
                        <td className="py-2 pl-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {editando ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => salvarEdicao(l)}
                                  disabled={salvando}
                                  className="h-8"
                                >
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
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => reabrirMes(l)}
                                    disabled={acaoLinha === l.profissionalId}
                                    className="h-8 px-2"
                                    title="Reabrir mês"
                                  >
                                    <Unlock className="w-3 h-3" />
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => fecharMes(l)}
                                    disabled={acaoLinha === l.profissionalId}
                                    className="h-8 px-2"
                                    title="Fechar mês"
                                  >
                                    <Lock className="w-3 h-3" />
                                  </Button>
                                )}
                              </>
                            )}
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
