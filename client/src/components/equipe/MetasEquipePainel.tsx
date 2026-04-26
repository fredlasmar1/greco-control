import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Target,
  Send,
  Save,
  RefreshCw,
  Calendar,
  CalendarDays,
  CalendarRange,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Pencil,
  X,
  Sun,
} from "lucide-react";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);

interface MetaApi {
  profissionalId: string;
  nome: string;
  metaReais: number;
  metaAtendimentos: number;
  telegramChatId: string;
  ativoEnvio: boolean;
  atualizadoEm: string;
}

interface PeriodoStats {
  reais: number;
  count: number;
  avulsoReais: number;
  avulsoCount: number;
  planoReais: number;
  planoCount: number;
}

interface LinhaDesempenho {
  profissionalId: string;
  nome: string;
  meta: { metaReais: number; metaAtendimentos: number; telegramChatId: string; ativoEnvio: boolean } | null;
  dia: PeriodoStats;
  semana: PeriodoStats;
  mes: PeriodoStats;
  posicaoMes: number | null;
  totalProfsRanking: number;
}

interface DesempenhoApi {
  ok: boolean;
  referencia: {
    hoje: string;
    semana: { dataInicio: string; dataFim: string };
    mes: string;
    diasUteisTotal: number;
    diasUteisDecorridos: number;
  };
  totais: { dia: any; semana: any; mes: any };
  linhas: LinhaDesempenho[];
}

type TipoEnvio = "matinal" | "semanal" | "mensal";

interface DraftMeta {
  metaReais: string;
  metaAtendimentos: string;
  telegramChatId: string;
  ativoEnvio: boolean;
  dirty: boolean;
  saving: boolean;
  editing: boolean;
  lastSavedAt?: string;
}

export default function MetasEquipePainel() {
  const [metas, setMetas] = useState<MetaApi[]>([]);
  const [desempenho, setDesempenho] = useState<DesempenhoApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftMeta>>({});
  const [enviando, setEnviando] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ id: string; type: "ok" | "err"; msg: string } | null>(null);
  const [enviarEmMassaTipo, setEnviarEmMassaTipo] = useState<TipoEnvio | null>(null);

  async function carregar() {
    setLoading(true);
    try {
      const [m, d] = await Promise.all([
        fetch("/api/metas-profissional").then(r => r.json()),
        fetch("/api/equipe/desempenho").then(r => r.json()),
      ]);
      const lista: MetaApi[] = m?.metas || [];
      setMetas(lista);
      setDesempenho(d?.ok ? d : null);
      // Inicializar drafts (preserva 'editing' se já estava aberto)
      setDrafts(prev => {
        const novos: Record<string, DraftMeta> = {};
        lista.forEach(meta => {
          const id = meta.profissionalId;
          const editing = prev[id]?.editing || false;
          novos[id] = {
            metaReais: String(meta.metaReais || 0),
            metaAtendimentos: String(meta.metaAtendimentos || 0),
            telegramChatId: meta.telegramChatId || "",
            ativoEnvio: !!meta.ativoEnvio,
            dirty: false,
            saving: false,
            editing,
            lastSavedAt: meta.atualizadoEm,
          };
        });
        return novos;
      });
    } catch (err) {
      console.error("[MetasEquipePainel] erro carregar:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  function atualizarDraft(id: string, patch: Partial<DraftMeta>) {
    setDrafts(prev => ({
      ...prev,
      [id]: { ...prev[id], ...patch, dirty: true },
    }));
  }

  function abrirEdicao(id: string) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], editing: true, dirty: false } }));
  }

  function cancelarEdicao(id: string) {
    // Restaura valores originais a partir das metas
    const meta = metas.find(m => m.profissionalId === id);
    if (!meta) return;
    setDrafts(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        metaReais: String(meta.metaReais || 0),
        metaAtendimentos: String(meta.metaAtendimentos || 0),
        telegramChatId: meta.telegramChatId || "",
        ativoEnvio: !!meta.ativoEnvio,
        dirty: false,
        editing: false,
      },
    }));
  }

  async function salvarMeta(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    const meta = metas.find(m => m.profissionalId === id);
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], saving: true } }));
    try {
      const r = await fetch(`/api/metas-profissional/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: meta?.nome || "",
          metaReais: Number(draft.metaReais.replace(",", ".") || 0),
          metaAtendimentos: Number(draft.metaAtendimentos || 0),
          telegramChatId: draft.telegramChatId.trim(),
          ativoEnvio: draft.ativoEnvio,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setFeedback({ id, type: "ok", msg: "Meta salva" });
        setDrafts(prev => ({
          ...prev,
          [id]: { ...prev[id], dirty: false, saving: false, editing: false, lastSavedAt: new Date().toISOString() },
        }));
        // Recarregar desempenho para refletir novos números
        fetch("/api/equipe/desempenho").then(r => r.json()).then(d => { if (d?.ok) setDesempenho(d); });
      } else {
        setFeedback({ id, type: "err", msg: j.error || "Erro ao salvar" });
        setDrafts(prev => ({ ...prev, [id]: { ...prev[id], saving: false } }));
      }
    } catch (err: any) {
      setFeedback({ id, type: "err", msg: err.message });
      setDrafts(prev => ({ ...prev, [id]: { ...prev[id], saving: false } }));
    }
    setTimeout(() => setFeedback(null), 4000);
  }

  async function enviarAgora(id: string, tipo: TipoEnvio) {
    setEnviando(prev => ({ ...prev, [`${id}-${tipo}`]: true }));
    try {
      const r = await fetch(`/api/telegram/individual/${tipo}/${id}`, { method: "POST" });
      const j = await r.json();
      if (j.ok || j.enviado) {
        setFeedback({ id, type: "ok", msg: `${tipoLabel(tipo)} enviado${j.viaProprio ? "" : " (chat principal)"}` });
      } else {
        setFeedback({ id, type: "err", msg: j.error || "Falha ao enviar" });
      }
    } catch (err: any) {
      setFeedback({ id, type: "err", msg: err.message });
    } finally {
      setEnviando(prev => ({ ...prev, [`${id}-${tipo}`]: false }));
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  async function enviarMassa(tipo: TipoEnvio) {
    if (!confirm(`Enviar resumo ${tipoLabel(tipo).toLowerCase()} agora para todos os profissionais com envio ativo?`)) return;
    setEnviarEmMassaTipo(tipo);
    try {
      const r = await fetch(`/api/telegram/individual/${tipo}`, { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        const oks = (j.results || []).filter((x: any) => x.ok).length;
        setFeedback({ id: "_bulk", type: "ok", msg: `${oks}/${j.total} ${tipoLabel(tipo).toLowerCase()}s enviados` });
      } else {
        setFeedback({ id: "_bulk", type: "err", msg: j.error || "Falha" });
      }
    } catch (err: any) {
      setFeedback({ id: "_bulk", type: "err", msg: err.message });
    } finally {
      setEnviarEmMassaTipo(null);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  function tipoLabel(t: TipoEnvio) {
    return t === "matinal" ? "Manhã" : t === "semanal" ? "Semanal" : "Mensal";
  }

  // Mapear desempenho por id pra fácil lookup
  const desempenhoMap = useMemo(() => {
    const m = new Map<string, LinhaDesempenho>();
    desempenho?.linhas.forEach(l => m.set(l.profissionalId, l));
    return m;
  }, [desempenho]);

  // Ordenar profissionais — primeiro com meta, depois por faturamento mensal
  const linhasOrdenadas = useMemo(() => {
    return [...metas].sort((a, b) => {
      const da = desempenhoMap.get(a.profissionalId)?.mes.reais || 0;
      const db = desempenhoMap.get(b.profissionalId)?.mes.reais || 0;
      if (db !== da) return db - da;
      return (a.nome || "").localeCompare(b.nome || "");
    });
  }, [metas, desempenhoMap]);

  const ref = desempenho?.referencia;

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-3 border-b border-card-border">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Metas e Desempenho — Equipe
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              {ref ? (
                <>
                  Hoje: {ref.hoje} • Semana: {ref.semana.dataInicio} a {ref.semana.dataFim} • Mês: {ref.mes} ({ref.diasUteisDecorridos}/{ref.diasUteisTotal} dias úteis)
                </>
              ) : (
                "Carregando referência..."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="sm" variant="outline" onClick={carregar} disabled={loading} data-testid="btn-recarregar-equipe">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" variant="outline" onClick={() => enviarMassa("matinal")} disabled={enviarEmMassaTipo !== null} data-testid="btn-bulk-matinal">
              <Sun className="w-3.5 h-3.5 mr-1.5" /> Manhã (todos)
            </Button>
            <Button size="sm" variant="outline" onClick={() => enviarMassa("semanal")} disabled={enviarEmMassaTipo !== null} data-testid="btn-bulk-semanal">
              <Send className="w-3.5 h-3.5 mr-1.5" /> Semanal (todos)
            </Button>
            <Button size="sm" variant="outline" onClick={() => enviarMassa("mensal")} disabled={enviarEmMassaTipo !== null} data-testid="btn-bulk-mensal">
              <Send className="w-3.5 h-3.5 mr-1.5" /> Mensal (todos)
            </Button>
          </div>
        </div>
        {feedback && feedback.id === "_bulk" && (
          <div className={`mt-2 px-3 py-1.5 rounded-md text-xs flex items-center gap-2 ${
            feedback.type === "ok"
              ? "bg-green-500/10 border border-green-500/20 text-green-400"
              : "bg-red-500/10 border border-red-500/20 text-red-400"
          }`}>
            {feedback.type === "ok" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {feedback.msg}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {loading && metas.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Carregando metas e desempenho...</div>
        ) : metas.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Nenhum profissional encontrado. Verifique a conexão com a Trinks.
          </div>
        ) : (
          <div className="divide-y divide-card-border/50">
            {linhasOrdenadas.map((meta) => {
              const id = meta.profissionalId;
              const draft = drafts[id];
              const linha = desempenhoMap.get(id);
              if (!draft) return null;

              const metaReaisNum = Number(draft.metaReais.replace(",", ".") || 0);
              const metaAtendNum = Number(draft.metaAtendimentos || 0);
              const mesReais = linha?.mes.reais || 0;
              const mesCount = linha?.mes.count || 0;
              const pctReais = metaReaisNum > 0 ? Math.min(100, (mesReais / metaReaisNum) * 100) : 0;
              const pctAtend = metaAtendNum > 0 ? Math.min(100, (mesCount / metaAtendNum) * 100) : 0;

              return (
                <div key={id} className="p-4 hover:bg-muted/5" data-testid={`equipe-row-${id}`}>
                  {/* Cabeçalho da linha */}
                  <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{meta.nome}</p>
                      {linha?.posicaoMes && (
                        <Badge variant="outline" className="text-[10px]">
                          #{linha.posicaoMes} de {linha.totalProfsRanking}
                        </Badge>
                      )}
                      {draft.ativoEnvio && draft.telegramChatId && (
                        <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">
                          <Send className="w-2.5 h-2.5 mr-1" /> Telegram ativo
                        </Badge>
                      )}
                      {draft.ativoEnvio && !draft.telegramChatId && (
                        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
                          Ativo (chat principal)
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-2"
                        onClick={() => enviarAgora(id, "matinal")}
                        disabled={!!enviando[`${id}-matinal`]}
                        data-testid={`btn-enviar-matinal-${id}`}
                      >
                        <Sun className="w-3 h-3 mr-1" /> Manhã
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-2"
                        onClick={() => enviarAgora(id, "semanal")}
                        disabled={!!enviando[`${id}-semanal`]}
                        data-testid={`btn-enviar-semanal-${id}`}
                      >
                        <CalendarDays className="w-3 h-3 mr-1" /> Semanal
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-2"
                        onClick={() => enviarAgora(id, "mensal")}
                        disabled={!!enviando[`${id}-mensal`]}
                        data-testid={`btn-enviar-mensal-${id}`}
                      >
                        <CalendarRange className="w-3 h-3 mr-1" /> Mensal
                      </Button>
                    </div>
                  </div>

                  {/* Painel de configuração de meta + desempenho */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                    {/* Inputs de meta + telegram (modo leitura por padrão, edição via lápis) */}
                    <div className="md:col-span-5 grid grid-cols-2 gap-2">
                      {!draft.editing ? (
                        // ── Modo leitura ──
                        <>
                          <div className="col-span-2 grid grid-cols-2 gap-2">
                            <div className="rounded-md border border-card-border/50 px-2 py-1.5 bg-background/30">
                              <p className="text-[10px] text-muted-foreground">Meta R$/mês</p>
                              <p className="text-xs font-semibold">{metaReaisNum > 0 ? fmtBRL(metaReaisNum) : <span className="text-muted-foreground">— não definida</span>}</p>
                            </div>
                            <div className="rounded-md border border-card-border/50 px-2 py-1.5 bg-background/30">
                              <p className="text-[10px] text-muted-foreground">Meta atend./mês</p>
                              <p className="text-xs font-semibold">{metaAtendNum > 0 ? metaAtendNum : <span className="text-muted-foreground">— não definida</span>}</p>
                            </div>
                          </div>
                          <div className="col-span-2 rounded-md border border-card-border/50 px-2 py-1.5 bg-background/30">
                            <p className="text-[10px] text-muted-foreground">Telegram chat_id</p>
                            <p className="text-xs font-mono truncate">{draft.telegramChatId || <span className="text-muted-foreground font-sans">— vazio (usa chat principal)</span>}</p>
                          </div>
                          <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
                            <span className="text-[11px] text-muted-foreground">
                              Envio automático:{" "}
                              <span className={draft.ativoEnvio ? "text-green-400 font-semibold" : "text-amber-400 font-semibold"}>
                                {draft.ativoEnvio ? "ATIVO" : "DESLIGADO"}
                              </span>
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] px-2.5"
                              onClick={() => abrirEdicao(id)}
                              data-testid={`btn-editar-${id}`}
                            >
                              <Pencil className="w-3 h-3 mr-1" /> Editar
                            </Button>
                          </div>
                          {feedback && feedback.id === id && (
                            <div className={`col-span-2 text-[10px] flex items-center gap-1 ${
                              feedback.type === "ok" ? "text-green-400" : "text-red-400"
                            }`}>
                              {feedback.type === "ok" ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                              {feedback.msg}
                            </div>
                          )}
                        </>
                      ) : (
                        // ── Modo edição ──
                        <>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Meta R$/mês</p>
                            <Input
                              value={draft.metaReais}
                              onChange={(e) => atualizarDraft(id, { metaReais: e.target.value })}
                              placeholder="0,00"
                              className="h-8 text-xs"
                              inputMode="decimal"
                              data-testid={`input-meta-reais-${id}`}
                            />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Meta atendimentos/mês</p>
                            <Input
                              value={draft.metaAtendimentos}
                              onChange={(e) => atualizarDraft(id, { metaAtendimentos: e.target.value.replace(/[^\d]/g, "") })}
                              placeholder="0"
                              className="h-8 text-xs"
                              inputMode="numeric"
                              data-testid={`input-meta-atend-${id}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <p className="text-[10px] text-muted-foreground mb-1">Telegram chat_id</p>
                            <Input
                              value={draft.telegramChatId}
                              onChange={(e) => atualizarDraft(id, { telegramChatId: e.target.value.replace(/[^\d-]/g, "") })}
                              placeholder="ex: 123456789 — vazio usa chat principal"
                              className="h-8 text-xs font-mono"
                              inputMode="numeric"
                              data-testid={`input-chat-id-${id}`}
                            />
                          </div>
                          <div className="col-span-2 flex items-center justify-between gap-2 pt-1 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={draft.ativoEnvio}
                                onCheckedChange={(v) => atualizarDraft(id, { ativoEnvio: v })}
                                data-testid={`switch-ativo-${id}`}
                              />
                              <span className="text-[11px] text-muted-foreground">Envio automático ativo</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] px-2.5"
                                onClick={() => cancelarEdicao(id)}
                                disabled={draft.saving}
                                data-testid={`btn-cancelar-${id}`}
                              >
                                <X className="w-3 h-3 mr-1" /> Cancelar
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-[11px] px-2.5"
                                onClick={() => salvarMeta(id)}
                                disabled={draft.saving}
                                data-testid={`btn-salvar-${id}`}
                              >
                                <Save className="w-3 h-3 mr-1" />
                                {draft.saving ? "Salvando..." : "Salvar"}
                              </Button>
                            </div>
                          </div>
                          {feedback && feedback.id === id && (
                            <div className={`col-span-2 text-[10px] flex items-center gap-1 ${
                              feedback.type === "ok" ? "text-green-400" : "text-red-400"
                            }`}>
                              {feedback.type === "ok" ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                              {feedback.msg}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Desempenho dia/semana/mês */}
                    <div className="md:col-span-7 grid grid-cols-3 gap-2">
                      {/* Dia */}
                      <div className="rounded-md border border-card-border/50 p-2 bg-background/40">
                        <div className="flex items-center gap-1 mb-1">
                          <Calendar className="w-3 h-3 text-primary" />
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Dia</p>
                        </div>
                        <p className="text-sm font-bold">{fmtBRL(linha?.dia.reais || 0)}</p>
                        <p className="text-[10px] text-muted-foreground">{linha?.dia.count || 0} atend.</p>
                        {(linha?.dia.planoCount || 0) > 0 && (
                          <p className="text-[10px] text-amber-400 mt-0.5">
                            +{linha?.dia.planoCount} plano ({fmtBRL(linha?.dia.planoReais || 0)})
                          </p>
                        )}
                      </div>
                      {/* Semana */}
                      <div className="rounded-md border border-card-border/50 p-2 bg-background/40">
                        <div className="flex items-center gap-1 mb-1">
                          <CalendarDays className="w-3 h-3 text-primary" />
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Semana</p>
                        </div>
                        <p className="text-sm font-bold">{fmtBRL(linha?.semana.reais || 0)}</p>
                        <p className="text-[10px] text-muted-foreground">{linha?.semana.count || 0} atend.</p>
                        {(linha?.semana.planoCount || 0) > 0 && (
                          <p className="text-[10px] text-amber-400 mt-0.5">
                            +{linha?.semana.planoCount} plano ({fmtBRL(linha?.semana.planoReais || 0)})
                          </p>
                        )}
                      </div>
                      {/* Mês */}
                      <div className="rounded-md border border-primary/30 p-2 bg-primary/5">
                        <div className="flex items-center gap-1 mb-1">
                          <CalendarRange className="w-3 h-3 text-primary" />
                          <p className="text-[10px] uppercase tracking-wide text-primary font-semibold">Mês</p>
                        </div>
                        <p className="text-sm font-bold">{fmtBRL(mesReais)}</p>
                        <p className="text-[10px] text-muted-foreground">{mesCount} atend.</p>
                        {(linha?.mes.planoCount || 0) > 0 && (
                          <p className="text-[10px] text-amber-400 mt-0.5">
                            +{linha?.mes.planoCount} plano ({fmtBRL(linha?.mes.planoReais || 0)})
                          </p>
                        )}
                      </div>

                      {/* Barras de progresso da meta */}
                      {(metaReaisNum > 0 || metaAtendNum > 0) && (
                        <div className="col-span-3 mt-1 space-y-1.5">
                          {metaReaisNum > 0 && (
                            <div>
                              <div className="flex justify-between text-[10px] mb-0.5">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <TrendingUp className="w-2.5 h-2.5" /> Meta R$ — {fmtBRL(mesReais)} / {fmtBRL(metaReaisNum)}
                                </span>
                                <span className={pctReais >= 100 ? "text-green-400 font-semibold" : "text-muted-foreground"}>
                                  {pctReais.toFixed(0)}%
                                </span>
                              </div>
                              <Progress value={pctReais} className="h-1.5" />
                            </div>
                          )}
                          {metaAtendNum > 0 && (
                            <div>
                              <div className="flex justify-between text-[10px] mb-0.5">
                                <span className="text-muted-foreground">Meta atend. — {mesCount} / {metaAtendNum}</span>
                                <span className={pctAtend >= 100 ? "text-green-400 font-semibold" : "text-muted-foreground"}>
                                  {pctAtend.toFixed(0)}%
                                </span>
                              </div>
                              <Progress value={pctAtend} className="h-1.5" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
