import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, X, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────────
// Aba CONCILIAÇÃO
// 1. Topo: lista de itens órfãos (sem profissional vinculado no Trinks).
//    Botão pra atribuir manualmente um profissional ou marcar como "ignorar".
// 2. Meio: tabela diária comparativa Trinks (caixa) vs Equipe (com dono) vs
//    Diferença — evidencia onde a soma da equipe não bate o caixa.
// 3. Indicadores no topo: total e valor de órfãs pendentes.
// ─────────────────────────────────────────────────────────────────────────

type Orfa = {
  transacaoId: string;
  dataHora: string;
  cliente: string;
  tipo: "servico" | "produto";
  index: number;
  descricao: string;
  valor: number;
  overrideProfId?: string;
  overrideProfNome?: string;
  overrideSkip?: boolean;
};

type LinhaBatimento = {
  dia: string;
  trinksTotal: number;
  trinksCount: number;
  equipeTotal: number;
  diferenca: number;
};

type RespostaApi = {
  ok: boolean;
  mes: string;
  periodo: { dataInicio: string; dataFim: string };
  orfas: Orfa[];
  pendentes: number;
  totalOrfas: number;
  valorOrfas: number;
  batimento: LinhaBatimento[];
  totaisPeriodo: { trinksTotal: number; equipeTotal: number; diferenca: number };
  profissionais: { id: string; nome: string }[];
  fetchedAt: string;
};

const fmtBRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtData = (iso: string) => {
  if (!iso) return "—";
  // 2026-04-22T17:18:17 → 22/04 17:18
  try {
    const d = iso.replace("T", " ");
    const [data, hora] = d.split(" ");
    const [, m, dd] = data.split("-");
    return `${dd}/${m} ${hora?.slice(0, 5) || ""}`;
  } catch {
    return iso;
  }
};

export default function Conciliacao() {
  const { toast } = useToast();
  const hojeMes = new Date().toISOString().slice(0, 7);
  const [mes, setMes] = useState(hojeMes);
  const [data, setData] = useState<RespostaApi | null>(null);
  const [loading, setLoading] = useState(false);
  // Map de seleção por linha — qual profissional o usuário escolheu no select
  const [seleciona, setSeleciona] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/conciliacao/orfas?mes=${mes}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Erro ao carregar conciliação");
      setData(j);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  const keyOrfa = (o: Orfa) => `${o.transacaoId}:${o.tipo === "servico" ? "s" : "p"}:${o.index}`;

  const atribuir = async (o: Orfa, opts: { profId?: string; skip?: boolean }) => {
    const k = keyOrfa(o);
    setSalvando(k);
    try {
      const tipo = o.tipo === "servico" ? "s" : "p";
      const r = await fetch("/api/conciliacao/atribuir", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transacaoId: o.transacaoId,
          tipo,
          index: o.index,
          profissionalId: opts.profId || "",
          skip: !!opts.skip,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Erro ao salvar");
      toast({
        title: opts.skip ? "Item ignorado" : "Profissional atribuído",
        description: opts.skip
          ? `${o.descricao} marcado para ignorar.`
          : `${o.descricao} atribuído.`,
      });
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSalvando(null);
    }
  };

  const remover = async (o: Orfa) => {
    const k = keyOrfa(o);
    setSalvando(k);
    try {
      const tipo = o.tipo === "servico" ? "s" : "p";
      const r = await fetch("/api/conciliacao/atribuir", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transacaoId: o.transacaoId, tipo, index: o.index }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Erro ao remover");
      toast({ title: "Atribuição removida", description: `${o.descricao} voltou a ser órfã.` });
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSalvando(null);
    }
  };

  const orfasPendentes = useMemo(
    () => (data?.orfas || []).filter(o => !o.overrideProfId && !o.overrideSkip),
    [data],
  );
  const orfasResolvidas = useMemo(
    () => (data?.orfas || []).filter(o => o.overrideProfId || o.overrideSkip),
    [data],
  );

  // Opções de mês: os últimos 6 meses
  const opcoesMes = useMemo(() => {
    const hoje = new Date();
    const arr: { v: string; lbl: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const lbl = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      arr.push({ v, lbl: lbl.charAt(0).toUpperCase() + lbl.slice(1) });
    }
    return arr;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Conciliação</h1>
          <p className="text-sm text-muted-foreground">
            Resolve transações sem profissional e confere o caixa contra a soma da equipe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mes}
            onChange={e => setMes(e.target.value)}
            className="border border-border bg-background rounded-md px-3 py-1.5 text-sm"
          >
            {opcoesMes.map(o => (
              <option key={o.v} value={o.v}>{o.lbl}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Cards-resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Órfãs pendentes</div>
            <div className="text-2xl font-bold flex items-center gap-2">
              {data?.pendentes ?? "—"}
              {(data?.pendentes ?? 0) > 0 && (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              )}
              {(data?.pendentes ?? -1) === 0 && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              precisam de atribuição manual
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total órfãs (mês)</div>
            <div className="text-2xl font-bold">{data?.totalOrfas ?? "—"}</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              R$ {fmtBRL(data?.valorOrfas || 0)} em itens sem dono
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Caixa Trinks (mês)</div>
            <div className="text-2xl font-bold">
              R$ {fmtBRL(data?.totaisPeriodo?.trinksTotal || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Soma da equipe</div>
            <div className="text-2xl font-bold">
              R$ {fmtBRL(data?.totaisPeriodo?.equipeTotal || 0)}
            </div>
            <div className="text-[11px] mt-1">
              <span className="text-muted-foreground">Diferença: </span>
              <span className={
                Math.abs(data?.totaisPeriodo?.diferenca || 0) < 0.01
                  ? "text-emerald-500"
                  : "text-amber-500"
              }>
                R$ {fmtBRL(data?.totaisPeriodo?.diferenca || 0)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de órfãs PENDENTES */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Itens sem profissional ({orfasPendentes.length})</span>
            {orfasPendentes.length === 0 && (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                Tudo conciliado
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : orfasPendentes.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhum item pendente neste mês. A equipe e o caixa estão alinhados.
            </div>
          ) : (
            <div className="space-y-2">
              {orfasPendentes.map(o => {
                const k = keyOrfa(o);
                const profSel = seleciona[k] || "";
                const isSaving = salvando === k;
                return (
                  <div
                    key={k}
                    className="flex flex-wrap items-center gap-3 p-3 rounded-md border border-border bg-card/40"
                  >
                    <Badge variant="outline" className="capitalize text-xs">{o.tipo}</Badge>
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-sm font-medium">{o.descricao}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtData(o.dataHora)} · {o.cliente || "Cliente sem nome"} · #{o.transacaoId}
                      </div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums w-24 text-right">
                      R$ {fmtBRL(o.valor)}
                    </div>
                    <select
                      value={profSel}
                      onChange={e => setSeleciona(s => ({ ...s, [k]: e.target.value }))}
                      className="border border-border bg-background rounded-md px-2 py-1 text-xs min-w-[180px]"
                      disabled={isSaving}
                    >
                      <option value="">Atribuir a…</option>
                      {(data?.profissionais || []).map(p => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      onClick={() => atribuir(o, { profId: profSel })}
                      disabled={!profSel || isSaving}
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Atribuir"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => atribuir(o, { skip: true })}
                      disabled={isSaving}
                      title="Ignorar este item (cortesia, erro de lançamento)"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Itens já resolvidos */}
      {orfasResolvidas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Itens já resolvidos ({orfasResolvidas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {orfasResolvidas.map(o => {
                const k = keyOrfa(o);
                const isSaving = salvando === k;
                return (
                  <div
                    key={k}
                    className="flex flex-wrap items-center gap-3 p-3 rounded-md border border-border bg-card/20"
                  >
                    <Badge variant="outline" className="capitalize text-xs">{o.tipo}</Badge>
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-sm font-medium">{o.descricao}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtData(o.dataHora)} · {o.cliente || "Cliente sem nome"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums w-24 text-right">
                      R$ {fmtBRL(o.valor)}
                    </div>
                    {o.overrideSkip ? (
                      <Badge variant="outline" className="bg-muted/30 text-muted-foreground">
                        Ignorado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                        → {o.overrideProfNome || o.overrideProfId}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remover(o)}
                      disabled={isSaving}
                      title="Desfazer atribuição"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabela de batimento diário */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batimento diário · Caixa Trinks vs Equipe</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left py-2 pr-4">Data</th>
                  <th className="text-right py-2 pr-4">Trinks</th>
                  <th className="text-right py-2 pr-4">Trans.</th>
                  <th className="text-right py-2 pr-4">Equipe</th>
                  <th className="text-right py-2">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {(data?.batimento || []).map(b => (
                  <tr key={b.dia} className="border-b border-border/30">
                    <td className="py-2 pr-4 tabular-nums text-xs">
                      {b.dia.split("-").reverse().slice(0, 2).join("/")}
                    </td>
                    <td className="text-right py-2 pr-4 tabular-nums">R$ {fmtBRL(b.trinksTotal)}</td>
                    <td className="text-right py-2 pr-4 tabular-nums text-xs text-muted-foreground">{b.trinksCount}</td>
                    <td className="text-right py-2 pr-4 tabular-nums">R$ {fmtBRL(b.equipeTotal)}</td>
                    <td className={
                      "text-right py-2 tabular-nums font-medium " +
                      (Math.abs(b.diferenca) < 0.01
                        ? "text-emerald-500"
                        : b.diferenca > 0 ? "text-amber-500" : "text-rose-500")
                    }>
                      R$ {fmtBRL(b.diferenca)}
                    </td>
                  </tr>
                ))}
                {(data?.batimento || []).length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground text-sm">
                      Nenhum dia com movimento neste mês.
                    </td>
                  </tr>
                )}
              </tbody>
              {(data?.batimento || []).length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 pr-4">Total</td>
                    <td className="text-right py-2 pr-4 tabular-nums">
                      R$ {fmtBRL(data?.totaisPeriodo?.trinksTotal || 0)}
                    </td>
                    <td></td>
                    <td className="text-right py-2 pr-4 tabular-nums">
                      R$ {fmtBRL(data?.totaisPeriodo?.equipeTotal || 0)}
                    </td>
                    <td className={
                      "text-right py-2 tabular-nums " +
                      (Math.abs(data?.totaisPeriodo?.diferenca || 0) < 0.01
                        ? "text-emerald-500"
                        : "text-amber-500")
                    }>
                      R$ {fmtBRL(data?.totaisPeriodo?.diferenca || 0)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="text-[11px] text-muted-foreground mt-3">
            Diferença = Caixa Trinks − Soma da equipe. Quando &gt; 0, há transações que não estão entrando no
            cálculo de algum profissional (geralmente porque algum item está sem dono — atribua acima).
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
