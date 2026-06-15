import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FonteBadge } from "@/components/dashboard/FonteBadge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Target,
  Save,
  RefreshCw,
  Calendar,
  CalendarDays,
  CalendarRange,
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

const fmtBRLcurto = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v || 0);

interface MetaApi {
  profissionalId: string;
  nome: string;
  metaReais: number;
  metaAtendimentos: number;
  telegramChatId: string;
  ativoEnvio: boolean;
  atualizadoEm: string;
  // Percentuais de comissão (0-100). Default 0 (sem comissão).
  pctServico?: number;
  pctProduto?: number;
  pctPlano?: number;
  // v20: bônus por meta + salário fixo
  pctBonusExcedente?: number;
  salarioFixo?: number;
  // v26: modo de comissão por profissional ('global' = usa setting da empresa)
  modoComissao?: 'bruto' | 'liquido' | 'global';
}

interface PeriodoStats {
  reais: number;
  count: number;
  avulsoReais: number;
  avulsoCount: number;
  planoReais: number;
  planoCount: number;
  // Quebra item-a-item por dono real (serviço vs produto). Comissões diferentes!
  servicosReais?: number;     // == servicosLiquido (base de comissão)
  servicosCount?: number;
  servicosBruto?: number;     // preço de tabela do item (sem desconto/taxa)
  servicosLiquido?: number;   // bruto × fator(totalPagar/Σitens) × (1 - taxa×fraçãoCartão)
  produtosReais?: number;
  produtosCount?: number;
  produtosBruto?: number;
  produtosLiquido?: number;
}

interface MetasCalculadas {
  mes: { reais: number; atend: number };
  semana: { reais: number; atend: number };
  dia: { reais: number; atend: number };
  diasUteisTotal: number;
  diasUteisDecorridos: number;
}

interface StatusJanela {
  temMeta: boolean;
  percReais: number;
  percAtend: number;
  bateu: boolean;
  farol: "verde" | "vermelho" | "sem-meta";
}

interface LinhaDesempenho {
  profissionalId: string;
  nome: string;
  meta: { metaReais: number; metaAtendimentos: number; telegramChatId: string; ativoEnvio: boolean; pctServico?: number; pctProduto?: number; pctPlano?: number } | null;
  metasCalculadas: MetasCalculadas;
  dia: PeriodoStats;
  semana: PeriodoStats;
  mes: PeriodoStats;
  status: { dia: StatusJanela; semana: StatusJanela; mes: StatusJanela };
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
    periodoCSV?: { inicio: string; fim: string };
  };
  totais: { dia: any; semana: any; mes: any };
  linhas: LinhaDesempenho[];
  fonte?: "trinks-api" | "trinks-import";
  importInfo?: { geradoEm: string | null };
  // v42: profissionais do ranking com Total Serviços > 0 sem categoria de comissão.
  semCategoria?: Array<{ nome: string; totalServicos: number }>;
}

interface ImportItem {
  chave: string;
  tipo: "financeiro" | "dre" | "ranking";
  mes: string;
  totalValor: number;
  totalLinhas?: number;
  importadoEm: string;
  descricao: string;
}

interface DraftMeta {
  metaReais: string;
  metaAtendimentos: string;
  telegramChatId: string;
  ativoEnvio: boolean;
  pctServico: string;
  pctProduto: string;
  pctPlano: string;
  // v20
  pctBonusExcedente: string;
  salarioFixo: string;
  // v26
  modoComissao: 'bruto' | 'liquido' | 'global';
  dirty: boolean;
  saving: boolean;
  editing: boolean;
  lastSavedAt?: string;
}

type JanelaAtiva = "dia" | "semana" | "mes";

export default function MetasEquipePainel() {
  const [metas, setMetas] = useState<MetaApi[]>([]);
  const [desempenho, setDesempenho] = useState<DesempenhoApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftMeta>>({});
  const [feedback, setFeedback] = useState<{ id: string; type: "ok" | "err"; msg: string } | null>(null);
  const [janelaAtiva, setJanelaAtiva] = useState<JanelaAtiva>("mes");
  // v25 Etapa 3: histórico via CSV importado
  const [importsRanking, setImportsRanking] = useState<ImportItem[]>([]);
  const [mesSelecionado, setMesSelecionado] = useState<string>(""); // "" = mês atual via API
  const [fonteAtiva, setFonteAtiva] = useState<"trinks-api" | "trinks-import" | null>(null);
  // Timestamps da fonte vencedora — alimentam o badge.
  const [fonteTrinksAt, setFonteTrinksAt] = useState<string | null>(null);
  const [fonteCsvAt, setFonteCsvAt] = useState<string | null>(null);

  async function carregar(mesForcado?: string) {
    setLoading(true);
    try {
      // Sempre buscar metas + lista de imports (rankings disponíveis para histórico)
      const [m, importsResp] = await Promise.all([
        fetch("/api/metas-profissional").then(r => r.json()),
        fetch("/api/trinks-import/list").then(r => r.json()).catch(() => ({ items: [] })),
      ]);
      const lista: MetaApi[] = m?.metas || [];
      const imps: ImportItem[] = (importsResp?.items || []).filter((i: ImportItem) => i.tipo === "ranking");
      setImportsRanking(imps);

      // Decisão de fonte:
      //  - mesForcado especificado → sempre /desempenho-import/<mes>
      //  - senão tenta API ao vivo; se vier vazia E houver import do mês atual, faz fallback
      let d: DesempenhoApi | null = null;
      let fonteResolvida: "trinks-api" | "trinks-import" | null = null;
      let trinksAtResolvida: string | null = null;
      let csvAtResolvida: string | null = null;

      // Mês alvo para consultar a fonte vencedora
      const mesAlvo = mesForcado || new Date().toISOString().slice(0, 7);

      // Consulta a fonte vencedora ("mais recente vence" CSV vs Trinks)
      let fonteVencedora: "trinks" | "csv" | "nenhuma" = "nenhuma";
      try {
        const r = await fetch(`/api/mes/${mesAlvo}/fonte`);
        if (r.ok) {
          const j = await r.json();
          if (j?.fonte === "csv" || j?.fonte === "trinks") {
            fonteVencedora = j.fonte;
          }
          trinksAtResolvida = j?.trinksAt || null;
          csvAtResolvida = j?.csvAt || null;
        }
      } catch {}

      if (mesForcado) {
        // Mês histórico forçado: respeita a fonte vencedora se houver, senão tenta CSV import.
        if (fonteVencedora === "csv") {
          try {
            const r = await fetch(`/api/equipe/desempenho-import/${mesForcado}`);
            if (r.ok) {
              d = await r.json();
              fonteResolvida = "trinks-import";
            }
          } catch {}
        } else {
          // "trinks" ou "nenhuma": tenta o import (fallback do antigo) pois /desempenho é sempre mês atual
          try {
            const r = await fetch(`/api/equipe/desempenho-import/${mesForcado}`);
            if (r.ok) {
              d = await r.json();
              fonteResolvida = "trinks-import";
            }
          } catch {}
        }
      } else {
        // Mês atual: aplica "mais recente vence".
        if (fonteVencedora === "csv") {
          // CSV vence → vai direto para o import.
          try {
            const r = await fetch(`/api/equipe/desempenho-import/${mesAlvo}`);
            if (r.ok) {
              d = await r.json();
              fonteResolvida = "trinks-import";
            }
          } catch {}
        }
        if (!d) {
          // Trinks vence (ou indefinido): tenta API ao vivo primeiro.
          try {
            const r = await fetch("/api/equipe/desempenho");
            if (r.ok) {
              const j = await r.json();
              if (j?.ok) {
                const totalMov = (j?.linhas || []).reduce((s: number, l: any) => s + (l?.mes?.reais || 0), 0);
                if (totalMov > 0) {
                  d = j;
                  fonteResolvida = "trinks-api";
                }
              }
            }
          } catch {}
        }
        // Fallback final: API vazia + import do mês atual existe → usa import.
        if (!d) {
          const temImport = imps.some(i => i.mes === mesAlvo);
          if (temImport) {
            try {
              const r = await fetch(`/api/equipe/desempenho-import/${mesAlvo}`);
              if (r.ok) {
                d = await r.json();
                fonteResolvida = "trinks-import";
              }
            } catch {}
          }
        }
      }

      setFonteAtiva(fonteResolvida);
      setFonteTrinksAt(trinksAtResolvida);
      setFonteCsvAt(csvAtResolvida);
      setMetas(lista);
      setDesempenho(d?.ok ? d : null);
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
            pctServico: String(meta.pctServico ?? 0),
            pctProduto: String(meta.pctProduto ?? 0),
            pctPlano: String(meta.pctPlano ?? 0),
            pctBonusExcedente: String(meta.pctBonusExcedente ?? 0),
            salarioFixo: String(meta.salarioFixo ?? 0),
            modoComissao: meta.modoComissao || 'global',
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

  useEffect(() => { carregar(mesSelecionado || undefined); }, [mesSelecionado]);

  // v25 Etapa 3: quando a fonte for CSV importado, só a janela 'mes' tem dados.
  useEffect(() => {
    if (fonteAtiva === "trinks-import" && janelaAtiva !== "mes") {
      setJanelaAtiva("mes");
    }
  }, [fonteAtiva]);

  function atualizarDraft(id: string, patch: Partial<DraftMeta>) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch, dirty: true } }));
  }

  function abrirEdicao(id: string) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], editing: true, dirty: false } }));
  }

  function cancelarEdicao(id: string) {
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
        pctServico: String(meta.pctServico ?? 0),
        pctProduto: String(meta.pctProduto ?? 0),
        pctPlano: String(meta.pctPlano ?? 0),
        pctBonusExcedente: String(meta.pctBonusExcedente ?? 0),
        salarioFixo: String(meta.salarioFixo ?? 0),
        modoComissao: meta.modoComissao || 'global',
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
          pctServico: Number(draft.pctServico.replace(",", ".") || 0),
          pctProduto: Number(draft.pctProduto.replace(",", ".") || 0),
          pctPlano: Number(draft.pctPlano.replace(",", ".") || 0),
          pctBonusExcedente: Number((draft.pctBonusExcedente || "0").replace(",", ".") || 0),
          salarioFixo: Number((draft.salarioFixo || "0").replace(",", ".") || 0),
          modoComissao: draft.modoComissao || 'global',
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setFeedback({ id, type: "ok", msg: "Meta salva — dividida automaticamente por dias úteis" });
        setDrafts(prev => ({
          ...prev,
          [id]: { ...prev[id], dirty: false, saving: false, editing: false, lastSavedAt: new Date().toISOString() },
        }));
        // recarregar para ter desempenho com farol atualizado
        carregar(mesSelecionado || undefined);
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

  // Mapear desempenho por id pra fácil lookup
  const desempenhoMap = useMemo(() => {
    const m = new Map<string, LinhaDesempenho>();
    desempenho?.linhas.forEach(l => m.set(l.profissionalId, l));
    return m;
  }, [desempenho]);

  // Ordenar por desempenho na janela ativa (decrescente)
  const linhasOrdenadas = useMemo(() => {
    return [...metas].sort((a, b) => {
      const da = desempenhoMap.get(a.profissionalId)?.[janelaAtiva].reais || 0;
      const db = desempenhoMap.get(b.profissionalId)?.[janelaAtiva].reais || 0;
      if (db !== da) return db - da;
      return (a.nome || "").localeCompare(b.nome || "");
    });
  }, [metas, desempenhoMap, janelaAtiva]);

  const ref = desempenho?.referencia;

  // Janela meta-info
  const janelaInfo: Record<JanelaAtiva, { label: string; Icon: any; descricao: string }> = {
    dia: { label: "Hoje", Icon: Sun, descricao: ref ? `${ref.hoje}` : "Hoje" },
    semana: { label: "Semana", Icon: CalendarDays, descricao: ref ? `${ref.semana.dataInicio} a ${ref.semana.dataFim}` : "Semana" },
    mes: { label: "Mês", Icon: CalendarRange, descricao: ref ? `${ref.mes} (${ref.diasUteisDecorridos}/${ref.diasUteisTotal} dias úteis)` : "Mês" },
  };

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-3 border-b border-card-border">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Acompanhamento de Metas — Equipe
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Meta mensal definida → dividida automaticamente em meta diária e semanal por dias úteis (ter-sáb).{" "}
              {ref && (
                <span className="text-foreground/70">
                  Mês de referência: {ref.mes} • {ref.diasUteisDecorridos}/{ref.diasUteisTotal} dias úteis decorridos
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => carregar(mesSelecionado || undefined)} disabled={loading} data-testid="btn-recarregar-equipe">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Toggle de janela: Dia / Semana / Mês */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {(["dia", "semana", "mes"] as JanelaAtiva[]).map(j => {
            const { label, Icon, descricao } = janelaInfo[j];
            const ativo = janelaAtiva === j;
            const desabilitado = fonteAtiva === "trinks-import" && j !== "mes";
            return (
              <Button
                key={j}
                size="sm"
                variant={ativo ? "default" : "outline"}
                disabled={desabilitado}
                className={`h-8 text-[11px] ${ativo ? "" : "bg-background/30"} ${desabilitado ? "opacity-40" : ""}`}
                onClick={() => setJanelaAtiva(j)}
                data-testid={`btn-janela-${j}`}
                title={desabilitado ? "Indisponível — CSV de ranking é mensal" : undefined}
              >
                <Icon className="w-3.5 h-3.5 mr-1.5" />
                {label}
                <span className="ml-1.5 text-[10px] opacity-70">{descricao}</span>
              </Button>
            );
          })}
        </div>

        {/* v25 Etapa 3 + Mais recente vence: badge da fonte vencedora + seletor de mês histórico */}
        {(fonteAtiva || importsRanking.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-card-border/50">
            <FonteBadge
              fonte={
                fonteAtiva === "trinks-import" ? "csv" :
                fonteAtiva === "trinks-api" ? "trinks" :
                "nenhuma"
              }
              trinksAt={fonteTrinksAt}
              csvAt={fonteCsvAt}
            />
            {importsRanking.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[10px] text-muted-foreground">Mês:</span>
                <select
                  value={mesSelecionado}
                  onChange={(e) => setMesSelecionado(e.target.value)}
                  className="h-7 text-[11px] rounded border border-card-border bg-background px-2"
                  data-testid="select-mes-historico"
                >
                  <option value="">Mês atual (automático)</option>
                  {importsRanking.map(i => (
                    <option key={i.chave} value={i.mes}>
                      {i.mes} · R$ {i.totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {/* v42: aviso de profissionais sem categoria de comissão (não pagar zero em silêncio) */}
        {desempenho?.semCategoria && desempenho.semCategoria.length > 0 && (
          <div
            data-testid="aviso-sem-categoria"
            className="mx-4 mt-4 mb-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
              <div>
                <strong className="text-amber-100">
                  {desempenho.semCategoria.length} profissional(is) sem categoria de comissão
                </strong>
                <span className="text-amber-200/80"> — comissão NÃO calculada (cadastre a categoria em Configurações):</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {desempenho.semCategoria.map((p) => (
                    <Badge key={p.nome} variant="outline" className="border-amber-500/40 text-amber-100">
                      {p.nome} · {fmtBRL(p.totalServicos)} em serviços
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
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

              // Janela ativa
              const realizado = linha?.[janelaAtiva];
              const status = linha?.status[janelaAtiva];
              const metaJanela = linha?.metasCalculadas[janelaAtiva] || { reais: 0, atend: 0 };
              const realReais = realizado?.reais || 0;
              const realCount = realizado?.count || 0;
              const pctReais = metaJanela.reais > 0 ? Math.min(100, (realReais / metaJanela.reais) * 100) : 0;
              const pctAtend = metaJanela.atend > 0 ? Math.min(100, (realCount / metaJanela.atend) * 100) : 0;

              const farol = status?.farol || "sem-meta";
              const farolBg =
                farol === "verde" ? "bg-green-500/10 border-green-500/30" :
                farol === "vermelho" ? "bg-red-500/10 border-red-500/30" :
                "bg-card-border/30 border-card-border/50";
              const farolText =
                farol === "verde" ? "text-green-400" :
                farol === "vermelho" ? "text-red-400" :
                "text-muted-foreground";

              // Diárias/semanais calculadas (sempre mostradas em modo leitura)
              const metaDiaria = linha?.metasCalculadas.dia.reais || 0;
              const metaSemanal = linha?.metasCalculadas.semana.reais || 0;

              return (
                <div key={id} className="p-4 hover:bg-muted/5" data-testid={`equipe-row-${id}`}>
                  {/* Cabeçalho: nome + posição + farol da janela ativa */}
                  <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{meta.nome}</p>
                      {linha?.posicaoMes && (
                        <Badge variant="outline" className="text-[10px]">
                          #{linha.posicaoMes} de {linha.totalProfsRanking}
                        </Badge>
                      )}
                      {status?.temMeta && (
                        <Badge className={`text-[10px] ${
                          farol === "verde"
                            ? "bg-green-500/15 text-green-400 border-green-500/30"
                            : "bg-red-500/15 text-red-400 border-red-500/30"
                        }`}>
                          {farol === "verde" ? <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> : <AlertCircle className="w-2.5 h-2.5 mr-1" />}
                          {janelaInfo[janelaAtiva].label}: {status.bateu ? "Bateu" : "Não bateu"} ({status.percReais.toFixed(0)}%)
                        </Badge>
                      )}
                      {!status?.temMeta && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Sem meta cadastrada
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Layout: configuração à esquerda + acompanhamento à direita */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                    {/* Coluna esquerda — meta mensal + edição */}
                    <div className="md:col-span-5 grid grid-cols-2 gap-2">
                      {!draft.editing ? (
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
                          {/* Comissões cadastradas (só mostra se algum % > 0) */}
                          {(() => {
                            const pS = linha?.meta?.pctServico || 0;
                            const pP = linha?.meta?.pctProduto || 0;
                            const pL = linha?.meta?.pctPlano   || 0;
                            if (pS === 0 && pP === 0 && pL === 0) return null;
                            return (
                              <div className="col-span-2 rounded-md border border-emerald-500/20 px-2 py-1.5 bg-emerald-500/5">
                                <p className="text-[10px] text-emerald-300/80 mb-1 font-semibold">Comissões cadastradas</p>
                                <div className="grid grid-cols-3 gap-1 text-[11px]">
                                  <div className="text-center">
                                    <span className="text-sky-300/80">✂️ Serv</span>
                                    <p className="font-bold text-sky-300">{pS}%</p>
                                  </div>
                                  <div className="text-center">
                                    <span className="text-orange-300/80">🛍️ Prod</span>
                                    <p className="font-bold text-orange-300">{pP}%</p>
                                  </div>
                                  <div className="text-center">
                                    <span className="text-amber-300/80">📅 Plano</span>
                                    <p className="font-bold text-amber-300">{pL}%</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {/* Metas derivadas (calculadas pelo backend) */}
                          {(metaReaisNum > 0 || metaAtendNum > 0) && (
                            <div className="col-span-2 rounded-md border border-card-border/50 px-2 py-1.5 bg-background/30">
                              <p className="text-[10px] text-muted-foreground mb-1">Divisão automática (ter-sáb)</p>
                              <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div>
                                  <span className="text-muted-foreground">Diária:</span>{" "}
                                  <span className="font-semibold">{fmtBRLcurto(metaDiaria)}</span>
                                  {linha && linha.metasCalculadas.dia.atend > 0 && (
                                    <span className="text-muted-foreground"> / {linha.metasCalculadas.dia.atend.toFixed(1)} at</span>
                                  )}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Semanal:</span>{" "}
                                  <span className="font-semibold">{fmtBRLcurto(metaSemanal)}</span>
                                  {linha && linha.metasCalculadas.semana.atend > 0 && (
                                    <span className="text-muted-foreground"> / {linha.metasCalculadas.semana.atend.toFixed(1)} at</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
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
                        <>
                          <div className="col-span-2 text-[10px] text-muted-foreground bg-background/40 border border-card-border/50 rounded-md px-2 py-1.5">
                            <p className="font-semibold mb-0.5 text-foreground">Como funciona</p>
                            Defina apenas a <span className="text-foreground">meta mensal</span>. O sistema divide automaticamente pelos {ref?.diasUteisTotal || "—"} dias úteis (ter-sáb) do mês para gerar metas diárias e semanais.
                          </div>
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
                            <p className="text-[10px] text-muted-foreground mb-1">Meta atend./mês</p>
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
                            <p className="text-[10px] text-muted-foreground mb-1">Telegram chat_id (opcional)</p>
                            <Input
                              value={draft.telegramChatId}
                              onChange={(e) => atualizarDraft(id, { telegramChatId: e.target.value.replace(/[^\d-]/g, "") })}
                              placeholder="vazio = usa chat principal"
                              className="h-8 text-xs font-mono"
                              inputMode="numeric"
                              data-testid={`input-chat-id-${id}`}
                            />
                          </div>
                          {/* Percentuais de comissão por categoria */}
                          <div className="col-span-2 rounded-md border border-card-border/50 px-2 py-2 bg-background/30">
                            <p className="text-[10px] text-muted-foreground mb-1.5 font-semibold">
                              Comissões (% sobre o realizado)
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <p className="text-[10px] text-sky-300/80 mb-1">✂️ Serviço</p>
                                <Input
                                  value={draft.pctServico}
                                  onChange={(e) => atualizarDraft(id, { pctServico: e.target.value.replace(/[^\d.,]/g, "") })}
                                  placeholder="0"
                                  className="h-8 text-xs"
                                  inputMode="decimal"
                                  data-testid={`input-pct-servico-${id}`}
                                />
                              </div>
                              <div>
                                <p className="text-[10px] text-orange-300/80 mb-1">🛍️ Produto</p>
                                <Input
                                  value={draft.pctProduto}
                                  onChange={(e) => atualizarDraft(id, { pctProduto: e.target.value.replace(/[^\d.,]/g, "") })}
                                  placeholder="0"
                                  className="h-8 text-xs"
                                  inputMode="decimal"
                                  data-testid={`input-pct-produto-${id}`}
                                />
                              </div>
                              <div>
                                <p className="text-[10px] text-amber-300/80 mb-1">📅 Plano</p>
                                <Input
                                  value={draft.pctPlano}
                                  onChange={(e) => atualizarDraft(id, { pctPlano: e.target.value.replace(/[^\d.,]/g, "") })}
                                  placeholder="0"
                                  className="h-8 text-xs"
                                  inputMode="decimal"
                                  data-testid={`input-pct-plano-${id}`}
                                />
                              </div>
                            </div>
                          </div>
                          {/* v20: Bônus por meta + Salário fixo */}
                          <div className="col-span-2 rounded-md border border-card-border/50 px-2 py-2 bg-background/30">
                            <p className="text-[10px] text-muted-foreground mb-1.5 font-semibold">
                              Bônus & Salário fixo (v20)
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <p className="text-[10px] text-emerald-300/80 mb-1">🎯 Bônus % sobre exceder meta</p>
                                <Input
                                  value={draft.pctBonusExcedente}
                                  onChange={(e) => atualizarDraft(id, { pctBonusExcedente: e.target.value.replace(/[^\d.,]/g, "") })}
                                  placeholder="0"
                                  className="h-8 text-xs"
                                  inputMode="decimal"
                                  data-testid={`input-pct-bonus-${id}`}
                                />
                              </div>
                              <div>
                                <p className="text-[10px] text-purple-300/80 mb-1">💰 Salário fixo (R$)</p>
                                <Input
                                  value={draft.salarioFixo}
                                  onChange={(e) => atualizarDraft(id, { salarioFixo: e.target.value.replace(/[^\d.,]/g, "") })}
                                  placeholder="0"
                                  className="h-8 text-xs"
                                  inputMode="decimal"
                                  data-testid={`input-salario-fixo-${id}`}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="col-span-2 rounded-md border border-card-border/50 px-2 py-2 bg-background/30">
                            <p className="text-[10px] text-muted-foreground mb-1.5 font-semibold">
                              Modo de cálculo da comissão
                            </p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {([
                                { v: 'global',  label: 'Padrão da empresa' },
                                { v: 'bruto',   label: 'Bruto (sobre preço)' },
                                { v: 'liquido', label: 'Líquido (− insumos)' },
                              ] as const).map(opt => {
                                const ativo = (draft.modoComissao || 'global') === opt.v;
                                return (
                                  <button
                                    key={opt.v}
                                    type="button"
                                    onClick={() => atualizarDraft(id, { modoComissao: opt.v })}
                                    className={
                                      "h-7 rounded-md border text-[10px] px-1.5 leading-tight transition-colors " +
                                      (ativo
                                        ? (opt.v === 'liquido'
                                            ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                                            : opt.v === 'bruto'
                                              ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
                                              : "border-emerald-500/60 bg-emerald-500/15 text-emerald-300")
                                        : "border-card-border/40 text-muted-foreground hover:bg-muted/30")
                                    }
                                    data-testid={`btn-modo-${opt.v}-${id}`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[9px] text-muted-foreground mt-1">
                              {draft.modoComissao === 'liquido'
                                ? "Comissão sobre (preço − ficha técnica). Ajuda a pagar insumos."
                                : draft.modoComissao === 'bruto'
                                  ? "Comissão sobre o preço cheio. Insumos saem só da empresa."
                                  : "Usa o modo global definido em Configurações."}
                            </p>
                          </div>
                          <div className="col-span-2 flex items-center justify-between gap-2 pt-1 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={draft.ativoEnvio}
                                onCheckedChange={(v) => atualizarDraft(id, { ativoEnvio: v })}
                                data-testid={`switch-ativo-${id}`}
                              />
                              <span className="text-[11px] text-muted-foreground">Envio automático Telegram</span>
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

                    {/* Coluna direita — acompanhamento da janela ativa com farol */}
                    <div className="md:col-span-7 space-y-2">
                      <div className={`rounded-md border-2 p-3 ${farolBg}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              const Icon = janelaInfo[janelaAtiva].Icon;
                              return <Icon className={`w-4 h-4 ${farolText}`} />;
                            })()}
                            <p className={`text-xs font-semibold uppercase tracking-wide ${farolText}`}>
                              {janelaInfo[janelaAtiva].label}
                            </p>
                          </div>
                          {status?.temMeta && (
                            <span className={`text-[11px] font-bold ${farolText}`}>
                              {status.bateu ? "🟢 BATEU" : "🔴 NÃO BATEU"}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Realizado</p>
                            <p className="text-base font-bold">{fmtBRL(realReais)}</p>
                            <p className="text-[10px] text-muted-foreground">{realCount} atend.</p>
                            {(realizado?.planoCount || 0) > 0 && (
                              <p className="text-[10px] text-amber-400 mt-0.5">
                                +{realizado?.planoCount} plano ({fmtBRL(realizado?.planoReais || 0)})
                              </p>
                            )}
                            {/* Serviços × Produtos: comissões diferentes — mostrar separado */}
                            {((realizado?.servicosReais || 0) > 0 || (realizado?.produtosReais || 0) > 0 || (realizado?.planoReais || 0) > 0) && (
                              <div className="mt-1.5 space-y-0.5 border-t border-card-border/30 pt-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-sky-300/80">✂️ Serviços</span>
                                  <span className="text-[10px] font-semibold text-sky-300" title={`Bruto (preço tabela): ${fmtBRL(realizado?.servicosBruto || 0)} → Líquido após descontos/taxa: ${fmtBRL(realizado?.servicosLiquido || 0)}`}>
                                    {fmtBRL(realizado?.servicosLiquido || realizado?.servicosReais || 0)}
                                    <span className="text-muted-foreground ml-1">({realizado?.servicosCount || 0})</span>
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-orange-300/80">🛍️ Produtos</span>
                                  <span className="text-[10px] font-semibold text-orange-300" title={`Bruto (preço tabela): ${fmtBRL(realizado?.produtosBruto || 0)} → Líquido após descontos/taxa: ${fmtBRL(realizado?.produtosLiquido || 0)}`}>
                                    {fmtBRL(realizado?.produtosLiquido || realizado?.produtosReais || 0)}
                                    <span className="text-muted-foreground ml-1">({realizado?.produtosCount || 0})</span>
                                  </span>
                                </div>
                                {/* Comissão estimada (só mostra se tem algum % cadastrado) — sobre LÍQUIDO */}
                                {(() => {
                                  const pctS = linha?.meta?.pctServico || 0;
                                  const pctP = linha?.meta?.pctProduto || 0;
                                  const pctL = linha?.meta?.pctPlano || 0;
                                  if (pctS === 0 && pctP === 0 && pctL === 0) return null;
                                  const baseS = realizado?.servicosLiquido ?? realizado?.servicosReais ?? 0;
                                  const baseP = realizado?.produtosLiquido ?? realizado?.produtosReais ?? 0;
                                  const baseL = realizado?.planoReais   || 0;
                                  const cS = baseS * (pctS / 100);
                                  const cP = baseP * (pctP / 100);
                                  const cL = baseL * (pctL / 100);
                                  const tot = cS + cP + cL;
                                  return (
                                    <div className="mt-1 pt-1 border-t border-card-border/30 flex items-center justify-between">
                                      <span className="text-[10px] text-emerald-300/80 font-semibold">💵 Comissão estimada</span>
                                      <span className="text-[11px] font-bold text-emerald-300" title={`Líquido base — Serviços: ${fmtBRL(cS)} (${pctS}% de ${fmtBRL(baseS)}) • Produtos: ${fmtBRL(cP)} (${pctP}% de ${fmtBRL(baseP)}) • Plano: ${fmtBRL(cL)} (${pctL}% de ${fmtBRL(baseL)})`}>
                                        {fmtBRL(tot)}
                                      </span>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Meta {janelaInfo[janelaAtiva].label.toLowerCase()}</p>
                            <p className="text-base font-bold">
                              {metaJanela.reais > 0 ? fmtBRL(metaJanela.reais) : <span className="text-muted-foreground text-sm">—</span>}
                            </p>
                            {metaJanela.atend > 0 && (
                              <p className="text-[10px] text-muted-foreground">{metaJanela.atend.toFixed(1)} atend.</p>
                            )}
                          </div>
                        </div>

                        {/* Barras de progresso */}
                        {status?.temMeta && (
                          <div className="mt-3 space-y-1.5">
                            {metaJanela.reais > 0 && (
                              <div>
                                <div className="flex justify-between text-[10px] mb-0.5">
                                  <span className="text-muted-foreground">R$</span>
                                  <span className={`font-semibold ${farolText}`}>
                                    {pctReais.toFixed(0)}%
                                  </span>
                                </div>
                                <Progress value={pctReais} className="h-1.5" />
                              </div>
                            )}
                            {metaJanela.atend > 0 && (
                              <div>
                                <div className="flex justify-between text-[10px] mb-0.5">
                                  <span className="text-muted-foreground">Atendimentos</span>
                                  <span className={`font-semibold ${farolText}`}>
                                    {pctAtend.toFixed(0)}%
                                  </span>
                                </div>
                                <Progress value={pctAtend} className="h-1.5" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Mini-resumo das outras 2 janelas */}
                      <div className="grid grid-cols-2 gap-2">
                        {(["dia", "semana", "mes"] as JanelaAtiva[])
                          .filter(j => j !== janelaAtiva)
                          .map(j => {
                            const r = linha?.[j];
                            const s = linha?.status[j];
                            const Icon = janelaInfo[j].Icon;
                            const sFarol = s?.farol || "sem-meta";
                            const sBg =
                              sFarol === "verde" ? "border-green-500/20 bg-green-500/5" :
                              sFarol === "vermelho" ? "border-red-500/20 bg-red-500/5" :
                              "border-card-border/50 bg-background/30";
                            return (
                              <button
                                key={j}
                                onClick={() => setJanelaAtiva(j)}
                                className={`text-left rounded-md border px-2 py-1.5 transition hover:opacity-80 ${sBg}`}
                                data-testid={`mini-${j}-${id}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1">
                                    <Icon className="w-3 h-3 text-muted-foreground" />
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                                      {janelaInfo[j].label}
                                    </span>
                                  </div>
                                  {s?.temMeta && (
                                    <span className={`text-[10px] font-bold ${
                                      sFarol === "verde" ? "text-green-400" :
                                      sFarol === "vermelho" ? "text-red-400" : "text-muted-foreground"
                                    }`}>
                                      {s.percReais.toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-bold mt-0.5">{fmtBRL(r?.reais || 0)}</p>
                                <p className="text-[10px] text-muted-foreground">{r?.count || 0} atend.</p>
                              </button>
                            );
                          })}
                      </div>
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
