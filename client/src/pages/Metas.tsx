/**
 * Aba Metas — visualização simples e direta.
 *
 * Para o mês corrente: usa /api/equipe/desempenho (que tem dia/semana/mês
 * + linhas por profissional já com meta cadastrada). Para mês passado:
 * usa /api/equipe/mes/:mes (só mensal). Persistência de metas via:
 *   - /api/metas (meta da empresa)
 *   - /api/metas/diaria (meta diária)
 *   - /api/metas/barbeiros/:mes (metas por profissional)
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatCurrency } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Target, TrendingUp, Calendar, Pencil, Save, X, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MonthSelector } from "@/components/MonthSelector";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface DesempenhoLinha {
  profissionalId: string;
  nome: string;
  meta: { metaReais: number; metaAtendimentos: number };
  dia?: { reais: number; count: number };
  semana?: { reais: number; count: number };
  mes?: { reais: number; count: number };
}

interface DesempenhoResp {
  ok: boolean;
  referencia: { mes: string; semana: { dataInicio: string; dataFim: string }; dia: string };
  totais: {
    dia: { reais: number; count: number };
    semana: { reais: number; count: number };
    mes: { reais: number; count: number };
  };
  linhas: DesempenhoLinha[];
}

interface EquipeMesResp {
  ok: boolean;
  fonte?: "ranking-csv" | "ao-vivo";
  totais: { faturamento: number; atendimentos: number; ticketMedio: number };
  profissionais: Array<{
    id: string;
    nome: string;
    faturamento: { total: number };
    atendimentos: { total: number };
    comissaoServicos?: number;
    comissaoServicosFonte?: "ranking-csv" | "ao-vivo";
  }>;
}

function StatusBadge({ pct }: { pct: number }) {
  if (pct >= 100) return <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 tabular-nums">{pct.toFixed(0)}% ✓</span>;
  if (pct >= 70) return <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 tabular-nums">{pct.toFixed(0)}%</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-400 tabular-nums">{pct.toFixed(0)}%</span>;
}

function ProgressBar({ pct }: { pct: number }) {
  const fill = Math.min(100, Math.max(0, pct));
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${fill}%` }} />
    </div>
  );
}

export default function Metas() {
  const { settings, updateSettings } = useStore();
  const { toast } = useToast();

  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("metas.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("metas.selectedMes", selectedMes); } catch {}
  }, [selectedMes]);
  const isMesCorrente = selectedMes === mesCorrente;

  // ─── Meta da empresa (settings.monthlyTarget) ─────────────
  const [target, setTarget] = useState(settings.monthlyTarget || 100000);
  const [editTarget, setEditTarget] = useState(false);
  const [targetInput, setTargetInput] = useState(String(target));
  useEffect(() => {
    setTarget(settings.monthlyTarget || 100000);
    setTargetInput(String(settings.monthlyTarget || 100000));
  }, [settings.monthlyTarget]);
  const salvarTarget = () => {
    const novo = parseFloat(targetInput.replace(",", ".")) || 0;
    updateSettings({ monthlyTarget: novo });
    setTarget(novo);
    setEditTarget(false);
    toast({ title: "Meta da empresa atualizada" });
  };

  // ─── Meta diária ─────────────────────────────────────────
  const [metaDiaria, setMetaDiaria] = useState(0);
  const [editDiaria, setEditDiaria] = useState(false);
  const [diariaInput, setDiariaInput] = useState("");
  const [savingDiaria, setSavingDiaria] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/metas/diaria`)
      .then(r => r.json())
      .then(d => {
        if (typeof d.valor === "number") {
          setMetaDiaria(d.valor);
          setDiariaInput(String(Math.round(d.valor)));
        }
      })
      .catch(() => {});
  }, []);
  const salvarDiaria = async () => {
    const valor = parseFloat(diariaInput.replace(",", ".")) || 0;
    setSavingDiaria(true);
    try {
      await fetch(`${API_BASE}/api/metas/diaria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor }),
      });
      setMetaDiaria(valor);
      setEditDiaria(false);
      toast({ title: "Meta diária atualizada" });
    } catch {
      toast({ title: "Erro ao salvar meta diária", variant: "destructive" });
    } finally {
      setSavingDiaria(false);
    }
  };

  // ─── Realizado: mês corrente usa /api/equipe/desempenho; passado usa /api/equipe/mes ──
  const [desempenho, setDesempenho] = useState<DesempenhoResp | null>(null);
  const [equipeMes, setEquipeMes] = useState<EquipeMesResp | null>(null);
  const [loadingDados, setLoadingDados] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoadingDados(true);
    // v42.4 (#1): o MÊS vem SEMPRE de /api/equipe/mes (ranking-aware, fonte única —
    // mesmo motor da folha/Pagamento). dia/semana ao vivo só no mês corrente.
    const pMes = fetch(`${API_BASE}/api/equipe/mes/${selectedMes}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setEquipeMes(d); })
      .catch(() => {});
    let pDia: Promise<any> = Promise.resolve();
    if (isMesCorrente) {
      pDia = fetch(`${API_BASE}/api/equipe/desempenho`)
        .then(r => r.json())
        .then(d => { if (!cancelled) setDesempenho(d); })
        .catch(() => {});
    } else if (!cancelled) {
      setDesempenho(null);
    }
    Promise.all([pMes, pDia]).finally(() => { if (!cancelled) setLoadingDados(false); });
    return () => { cancelled = true; };
  }, [selectedMes, isMesCorrente]);

  // ─── Metas por barbeiro ─────────────────────────────────
  const [metasBarbeiros, setMetasBarbeiros] = useState<Record<string, number>>({});
  const [editingBarberId, setEditingBarberId] = useState<string | null>(null);
  const [editBarberValue, setEditBarberValue] = useState("");
  const [savingBarber, setSavingBarber] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/metas/barbeiros/${selectedMes}`)
      .then(r => r.json())
      .then(d => setMetasBarbeiros(d || {}))
      .catch(() => {});
  }, [selectedMes]);

  const salvarMetaBarbeiro = async (id: string) => {
    const valor = parseFloat(editBarberValue.replace(",", ".")) || 0;
    setSavingBarber(true);
    try {
      await fetch(`${API_BASE}/api/metas/barbeiros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMes, barberId: id, meta: valor }),
      });
      setMetasBarbeiros(prev => ({ ...prev, [id]: valor }));
      setEditingBarberId(null);
      toast({ title: "Meta atualizada" });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally {
      setSavingBarber(false);
    }
  };

  // ─── Cálculos derivados ──────────────────────────────────
  // v42.4: realizado do MÊS sempre do /api/equipe/mes (ranking quando existe).
  const realizadoMes = equipeMes?.totais.faturamento || 0;
  const realizadoHoje = isMesCorrente ? (desempenho?.totais.dia.reais || 0) : 0;
  const realizadoSemana = isMesCorrente ? (desempenho?.totais.semana.reais || 0) : 0;

  const pctMes = target > 0 ? (realizadoMes / target) * 100 : 0;
  const pctHoje = metaDiaria > 0 ? (realizadoHoje / metaDiaria) * 100 : 0;
  const metaSemanal = metaDiaria * 6;
  const pctSemana = metaSemanal > 0 ? (realizadoSemana / metaSemanal) * 100 : 0;

  // Linhas de barbeiros (com meta + realizado)
  const linhasBarbeiros = useMemo(() => {
    // v42.4: sempre do equipeMes (ranking-aware) — receita + comissão por barbeiro.
    const fonte = (equipeMes?.profissionais || []).map(p => ({
      id: p.id,
      nome: p.nome,
      meta: metasBarbeiros[p.id] || 0,
      realizado: p.faturamento.total,
      comissao: Number(p.comissaoServicos || 0),
    }));
    return fonte
      .filter(l => l.meta > 0 || l.realizado > 0)
      .sort((a, b) => b.realizado - a.realizado);
  }, [desempenho, equipeMes, metasBarbeiros, isMesCorrente]);

  const totalMetaBarbeiros = linhasBarbeiros.reduce((s, l) => s + l.meta, 0);
  const totalRealizadoBarbeiros = linhasBarbeiros.reduce((s, l) => s + l.realizado, 0);

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Metas — {labelMesPtBR(selectedMes)}</h2>
          <p className="text-sm text-muted-foreground">Acompanhamento da equipe vs meta cadastrada</p>
        </div>
        <MonthSelector
          selectedMes={selectedMes}
          onChange={setSelectedMes}
          mesCorrente={mesCorrente}
          isMesCorrente={isMesCorrente}
          loading={loadingDados}
        />
      </div>

      {/* Meta da Empresa */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Meta da Empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Meta:</span>
              {editTarget ? (
                <div className="flex items-center gap-1">
                  <Input type="number" value={targetInput} onChange={e => setTargetInput(e.target.value)} className="w-32 h-7 text-sm" />
                  <Button size="sm" variant="ghost" onClick={salvarTarget} className="h-7 px-2"><Save className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditTarget(false); setTargetInput(String(target)); }} className="h-7 px-2"><X className="w-3 h-3" /></Button>
                </div>
              ) : (
                <>
                  <span className="text-xl font-bold tabular-nums">{formatCurrency(target)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditTarget(true)} className="h-6 px-1.5"><Pencil className="w-3 h-3" /></Button>
                </>
              )}
            </div>
            <span className="text-muted-foreground">→</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Realizado:</span>
              <span className={`text-xl font-bold tabular-nums ${pctMes >= 100 ? "text-emerald-500" : pctMes >= 70 ? "text-amber-500" : "text-red-500"}`}>{formatCurrency(realizadoMes)}</span>
              <StatusBadge pct={pctMes} />
            </div>
          </div>
          <ProgressBar pct={pctMes} />
          <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
            <span>{isMesCorrente ? "Em curso" : "Mês fechado"}</span>
            {pctMes < 100 && (
              <span>Falta {formatCurrency(Math.max(0, target - realizadoMes))}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Meta Diária + Semanal (só mês corrente) */}
      {isMesCorrente && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                Meta Diária
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Meta:</span>
                {editDiaria ? (
                  <div className="flex items-center gap-1">
                    <Input type="number" value={diariaInput} onChange={e => setDiariaInput(e.target.value)} className="w-28 h-7 text-sm" />
                    <Button size="sm" variant="ghost" onClick={salvarDiaria} disabled={savingDiaria} className="h-7 px-2">
                      {savingDiaria ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditDiaria(false); setDiariaInput(String(Math.round(metaDiaria))); }} className="h-7 px-2"><X className="w-3 h-3" /></Button>
                  </div>
                ) : (
                  <>
                    <span className="text-base font-semibold tabular-nums">{formatCurrency(metaDiaria)}</span>
                    <Button size="sm" variant="ghost" onClick={() => setEditDiaria(true)} className="h-6 px-1.5"><Pencil className="w-3 h-3" /></Button>
                  </>
                )}
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Hoje:</span>
                <span className="text-base font-semibold tabular-nums">{formatCurrency(realizadoHoje)}</span>
                {metaDiaria > 0 && <StatusBadge pct={pctHoje} />}
              </div>
              {metaDiaria > 0 && <ProgressBar pct={pctHoje} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Meta Semanal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Meta (diária × 6):</span>
                <span className="text-base font-semibold tabular-nums">{formatCurrency(metaSemanal)}</span>
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Esta semana:</span>
                <span className="text-base font-semibold tabular-nums">{formatCurrency(realizadoSemana)}</span>
                {metaSemanal > 0 && <StatusBadge pct={pctSemana} />}
              </div>
              {metaSemanal > 0 && <ProgressBar pct={pctSemana} />}
              <p className="text-[11px] text-muted-foreground mt-2">Calculada automaticamente a partir da meta diária (6 dias úteis seg-sáb).</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Meta por Barbeiro */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Meta por Barbeiro
              {/* v42.4 (#8): fonte da comissão exibida */}
              {equipeMes?.fonte === "ranking-csv" ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">CSV definitivo</span>
              ) : equipeMes?.fonte === "ao-vivo" ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400">ao vivo</span>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              Total: {formatCurrency(totalRealizadoBarbeiros)} / {formatCurrency(totalMetaBarbeiros)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {linhasBarbeiros.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {loadingDados ? "Carregando..." : "Nenhum dado para este mês."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 px-2 font-medium">Barbeiro</th>
                    <th className="text-right py-2 px-2 font-medium">Meta</th>
                    <th className="text-right py-2 px-2 font-medium">Realizado</th>
                    <th className="text-right py-2 px-2 font-medium hidden md:table-cell">Comissão</th>
                    <th className="text-right py-2 px-2 font-medium hidden sm:table-cell w-32">Progresso</th>
                    <th className="text-right py-2 px-2 font-medium">%</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {linhasBarbeiros.map(l => {
                    const pct = l.meta > 0 ? (l.realizado / l.meta) * 100 : 0;
                    const editing = editingBarberId === l.id;
                    return (
                      <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 px-2 font-medium">{l.nome}</td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {editing ? (
                            <Input
                              type="number"
                              value={editBarberValue}
                              onChange={e => setEditBarberValue(e.target.value)}
                              className="w-24 h-7 text-right text-sm ml-auto"
                              autoFocus
                            />
                          ) : (
                            formatCurrency(l.meta)
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(l.realizado)}</td>
                        <td className="py-2 px-2 text-right tabular-nums hidden md:table-cell text-muted-foreground">{formatCurrency(l.comissao)}</td>
                        <td className="py-2 px-2 hidden sm:table-cell">
                          {l.meta > 0 && <ProgressBar pct={pct} />}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {l.meta > 0 ? <StatusBadge pct={pct} /> : <span className="text-[10px] text-muted-foreground">sem meta</span>}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {editing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => salvarMetaBarbeiro(l.id)} disabled={savingBarber} className="h-6 px-1.5">
                                {savingBarber ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingBarberId(null)} className="h-6 px-1.5"><X className="w-3 h-3" /></Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => { setEditingBarberId(l.id); setEditBarberValue(String(l.meta)); }} className="h-6 px-1.5">
                              <Pencil className="w-3 h-3" />
                            </Button>
                          )}
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
    </div>
  );
}
