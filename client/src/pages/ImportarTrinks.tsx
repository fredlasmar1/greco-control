import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/demoData";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Loader2,
  Info,
  TrendingUp,
  Wallet,
  Users,
  RefreshCw,
} from "lucide-react";

// ─── Tipos espelhando o backend (server/trinksImport.ts) ─────────────────────

type TipoImport = "financeiro" | "dre" | "ranking";

interface ImportItem {
  chave: string;
  tipo: TipoImport;
  mes: string;
  totalValor: number;
  totalLinhas?: number;
  geradoEm?: string;
  importadoEm: string;
  descricao: string;
}

interface PreviewResposta {
  ok: boolean;
  arquivo: string;
  tamanhoBytes: number;
  preview: any;
  chaves: Array<{
    chave: string;
    tipo: TipoImport;
    mes: string;
    totalValor: number;
    totalLinhas?: number;
    descricao: string;
    sobrescreve: ImportItem | null;
  }>;
}

// ─── Helpers de UI ───────────────────────────────────────────────────────────

const TIPO_LABELS: Record<TipoImport, string> = {
  financeiro: "Financeiro",
  dre: "DRE",
  ranking: "Ranking de Profissionais",
};

const TIPO_ICONS: Record<TipoImport, any> = {
  financeiro: Wallet,
  dre: TrendingUp,
  ranking: Users,
};

function mesLabel(mes: string): string {
  if (!/^\d{4}-\d{2}$/.test(mes)) return mes;
  const [y, m] = mes.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${meses[parseInt(m, 10) - 1]}/${y}`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function ImportarTrinks() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResposta | null>(null);
  const [erroPreview, setErroPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [removerChave, setRemoverChave] = useState<{ tipo: TipoImport; mes: string } | null>(null);

  // Lista de importações já feitas
  const { data: listResp, isLoading: loadingList } = useQuery<{ ok: boolean; items: ImportItem[] }>({
    queryKey: ["/api/trinks-import/list"],
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/trinks-import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao processar o CSV.");
      return data as PreviewResposta;
    },
    onSuccess: (data) => {
      setPreview(data);
      setErroPreview(null);
    },
    onError: (err: any) => {
      setPreview(null);
      setErroPreview(err.message || "Falha ao processar o CSV.");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/trinks-import/confirm", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
      return data;
    },
    onSuccess: (data) => {
      const n = data?.importadas?.length || 0;
      toast({
        title: "Importação concluída",
        description: `${n} chave${n === 1 ? "" : "s"} salva${n === 1 ? "" : "s"} com sucesso.`,
      });
      setArquivo(null);
      setPreview(null);
      setErroPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["/api/trinks-import/list"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao importar",
        description: err.message || "Falha ao salvar.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ tipo, mes }: { tipo: TipoImport; mes: string }) => {
      return apiRequest("DELETE", `/api/trinks-import/${tipo}/${mes}`);
    },
    onSuccess: () => {
      toast({ title: "Importação removida", description: "Os dados foram apagados." });
      qc.invalidateQueries({ queryKey: ["/api/trinks-import/list"] });
      setRemoverChave(null);
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao remover",
        description: err.message || "Falha ao remover.",
        variant: "destructive",
      });
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const onSelectFile = useCallback((file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({
        title: "Formato inválido",
        description: "Envie um arquivo .csv exportado pela Trinks.",
        variant: "destructive",
      });
      return;
    }
    setArquivo(file);
    setPreview(null);
    setErroPreview(null);
    previewMutation.mutate(file);
  }, [previewMutation, toast]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onSelectFile(file);
  }, [onSelectFile]);

  const onConfirm = () => {
    if (!arquivo) return;
    confirmMutation.mutate(arquivo);
  };

  const onCancelar = () => {
    setArquivo(null);
    setPreview(null);
    setErroPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const items = listResp?.items || [];
  const sobrescreveAlguma = preview?.chaves.some(c => c.sobrescreve) || false;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Importar Relatórios da Trinks</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Suba os CSVs exportados pelo painel da Trinks. Tipos suportados:
          <strong className="text-foreground mx-1">Financeiro</strong>·
          <strong className="text-foreground mx-1">DRE</strong>·
          <strong className="text-foreground mx-1">Ranking de Profissionais</strong>.
          O sistema detecta o tipo automaticamente.
        </p>
      </div>

      {/* Card de upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Novo arquivo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!arquivo && !preview && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                transition-colors
                ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}
              `}
              data-testid="dropzone"
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Arraste o CSV aqui ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground mt-1">
                Aceita .csv exportado pelo painel da Trinks
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSelectFile(f);
            }}
            data-testid="file-input"
          />

          {/* Loading do preview */}
          {arquivo && previewMutation.isPending && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">{arquivo.name}</p>
                <p className="text-xs text-muted-foreground">Analisando o arquivo...</p>
              </div>
            </div>
          )}

          {/* Erro do preview */}
          {erroPreview && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">Não foi possível processar o arquivo</p>
                  <p className="text-xs text-muted-foreground mt-1">{erroPreview}</p>
                </div>
                <Button variant="outline" size="sm" onClick={onCancelar} data-testid="btn-cancelar-erro">
                  Tentar outro
                </Button>
              </div>
            </div>
          )}

          {/* Preview do conteúdo */}
          {preview && !erroPreview && (
            <PreviewBlock
              preview={preview}
              onConfirm={onConfirm}
              onCancelar={onCancelar}
              loading={confirmMutation.isPending}
              sobrescreveAlguma={sobrescreveAlguma}
            />
          )}
        </CardContent>
      </Card>

      {/* Lista de importações já feitas */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Importações salvas
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/trinks-import/list"] })}
            data-testid="btn-refresh-list"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Info className="w-6 h-6 mx-auto mb-2 opacity-50" />
              Nenhuma importação ainda. Suba um relatório acima para começar.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const Icon = TIPO_ICONS[item.tipo];
                return (
                  <div
                    key={item.chave}
                    className="flex items-center gap-3 p-3 rounded-md border border-border bg-card/50 hover:bg-muted/30"
                    data-testid={`import-item-${item.chave}`}
                  >
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {TIPO_LABELS[item.tipo]}
                        </Badge>
                        <span className="text-sm font-medium">{mesLabel(item.mes)}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          Importado em {new Date(item.importadoEm).toLocaleString("pt-BR", {
                            day: "2-digit", month: "2-digit", year: "2-digit",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.descricao}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setRemoverChave({ tipo: item.tipo, mes: item.mes })}
                      data-testid={`btn-remove-${item.chave}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bloco "Como usar" */}
      <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 border border-border">
        <p className="font-medium text-foreground mb-1">Como exportar da Trinks</p>
        <p>
          No painel da Trinks, vá em <strong>Relatórios</strong> e exporte em CSV. Os 3 relatórios
          que o sistema reconhece são:
        </p>
        <ul className="mt-1 ml-4 list-disc space-y-0.5">
          <li><strong>Relatório Financeiro</strong> (receitas/recebimentos detalhados por dia, forma de pagamento e cliente)</li>
          <li><strong>DRE</strong> (demonstração mensal de receitas vs despesas com totais por categoria)</li>
          <li><strong>Ranking de Profissionais — Comparativo</strong> (atendimentos, ticket médio e valor total por profissional, em 2 períodos lado a lado)</li>
        </ul>
        <p className="mt-1">
          Ao reimportar o mesmo período, o anterior é <strong>sobrescrito</strong> (você verá um aviso antes de confirmar).
        </p>
      </div>

      {/* Diálogo de confirmação para remover */}
      <AlertDialog open={!!removerChave} onOpenChange={(open) => !open && setRemoverChave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover importação?</AlertDialogTitle>
            <AlertDialogDescription>
              {removerChave && (
                <>
                  Os dados de <strong>{TIPO_LABELS[removerChave.tipo]}</strong> de
                  {" "}<strong>{mesLabel(removerChave.mes)}</strong> serão apagados.
                  Esta ação não pode ser desfeita (mas você pode reimportar o CSV depois).
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-remove">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removerChave && deleteMutation.mutate(removerChave)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="btn-confirm-remove"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Bloco de preview (dentro do card de upload) ─────────────────────────────

function PreviewBlock({
  preview,
  onConfirm,
  onCancelar,
  loading,
  sobrescreveAlguma,
}: {
  preview: PreviewResposta;
  onConfirm: () => void;
  onCancelar: () => void;
  loading: boolean;
  sobrescreveAlguma: boolean;
}) {
  const tipo = preview.preview.tipo as TipoImport;
  const Icon = TIPO_ICONS[tipo];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-md border border-primary/30 bg-primary/5">
        <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{TIPO_LABELS[tipo]}</span>
            <Badge variant="outline" className="text-[10px]">{preview.arquivo}</Badge>
            <span className="text-xs text-muted-foreground">{fmtBytes(preview.tamanhoBytes)}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Detectado automaticamente. Confira os dados abaixo antes de confirmar.
          </p>
        </div>
      </div>

      {/* Aviso de sobrescrita */}
      {sobrescreveAlguma && (
        <div className="flex items-start gap-3 p-3 rounded-md border border-amber-400/40 bg-amber-400/10">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Já existe importação para algum dos meses
            </p>
            <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
              {preview.chaves.filter(c => c.sobrescreve).map(c => (
                <li key={c.chave}>
                  · <strong>{TIPO_LABELS[c.tipo]} {mesLabel(c.mes)}</strong>: substituirá importação
                  de {new Date(c.sobrescreve!.importadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Detalhes específicos por tipo */}
      {tipo === "financeiro" && <PreviewFinanceiro p={preview.preview} />}
      {tipo === "dre" && <PreviewDRE p={preview.preview} />}
      {tipo === "ranking" && <PreviewRanking p={preview.preview} />}

      {/* Resumo das chaves a salvar */}
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Será salvo:</p>
        <div className="space-y-1">
          {preview.chaves.map(c => (
            <div key={c.chave} className="text-xs flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3 text-primary" />
              <span><strong>{TIPO_LABELS[c.tipo]}</strong> {mesLabel(c.mes)} · {c.descricao}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancelar} disabled={loading} data-testid="btn-cancelar">
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={loading} data-testid="btn-confirmar">
          {loading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
          ) : sobrescreveAlguma ? (
            "Confirmar e substituir"
          ) : (
            "Confirmar importação"
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Previews por tipo ───────────────────────────────────────────────────────

function PreviewFinanceiro({ p }: { p: any }) {
  const formas = Object.entries(p.resumoPorForma || {})
    .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Mês" value={mesLabel(p.mes)} />
        <Stat label="Período" value={`${formatDateBR(p.periodoInicio)} → ${formatDateBR(p.periodoFim)}`} mono />
        <Stat label="Lançamentos" value={String(p.totalLinhas)} />
        <Stat label="Total a receber" value={formatCurrency(p.totalValor)} highlight />
      </div>
      {formas.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Por forma de pagamento</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {formas.map(([forma, valor]) => (
              <div key={forma} className="flex items-center justify-between text-xs px-2 py-1 rounded border border-border bg-card/50">
                <span className="truncate">{forma}</span>
                <span className="font-mono font-medium">{formatCurrency(valor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewDRE({ p }: { p: any }) {
  const receitas = Object.entries(p.receitas || {}).filter(([, v]) => (v as number) > 0) as [string, number][];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Mês" value={mesLabel(p.mes)} />
        <Stat label="Receitas" value={formatCurrency(p.totalReceitas)} positive />
        <Stat label="Despesas" value={formatCurrency(p.totalDespesas)} negative />
        <Stat label="Resultado" value={formatCurrency(p.resultadoPeriodo)} highlight />
      </div>
      {receitas.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Receitas</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {receitas.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs px-2 py-1 rounded border border-border bg-card/50">
                <span className="truncate">{k}</span>
                <span className="font-mono font-medium">{formatCurrency(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {p.despesasSubgrupos?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Despesas por categoria</p>
          <div className="space-y-1">
            {p.despesasSubgrupos.map((sg: any) => (
              <div key={sg.nome} className="text-xs px-2 py-1 rounded border border-border bg-card/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{sg.nome}</span>
                  <span className="font-mono font-medium">{formatCurrency(sg.total)}</span>
                </div>
                {Object.keys(sg.itens || {}).length > 0 && (
                  <div className="mt-0.5 ml-2 text-muted-foreground">
                    {Object.entries(sg.itens).map(([k, v]: any) => (
                      <div key={k} className="flex items-center justify-between">
                        <span>· {k}</span>
                        <span className="font-mono">{formatCurrency(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewRanking({ p }: { p: any }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(p.periodos || []).map((per: any, idx: number) => (
          <div key={idx} className="rounded-md border border-border bg-card/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{mesLabel(per.mes)}</span>
              <span className="text-xs text-muted-foreground font-mono">
                {formatDateBR(per.periodoInicio)} → {formatDateBR(per.periodoFim)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <Stat label="Profissionais" value={String(per.qtdProfissionais)} />
              <Stat label="Total" value={formatCurrency(per.total)} highlight />
            </div>
            {per.top3?.length > 0 && (
              <div className="space-y-0.5 text-xs">
                <p className="font-medium text-muted-foreground mb-1">Top 3</p>
                {per.top3.map((pr: any) => (
                  <div key={pr.posicao} className="flex items-center justify-between">
                    <span className="truncate">#{pr.posicao} {pr.profissional}</span>
                    <span className="font-mono">{formatCurrency(pr.valorTotal)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat box reutilizável ───────────────────────────────────────────────────

function Stat({
  label,
  value,
  highlight,
  positive,
  negative,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  positive?: boolean;
  negative?: boolean;
  mono?: boolean;
}) {
  const valueClass = [
    "text-sm font-semibold mt-0.5 truncate",
    highlight ? "text-primary" : "",
    positive ? "text-emerald-500" : "",
    negative ? "text-rose-500" : "",
    mono ? "font-mono text-xs" : "",
  ].join(" ");

  return (
    <div className="px-2.5 py-1.5 rounded-md border border-border bg-card/50">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={valueClass}>{value}</p>
    </div>
  );
}

function formatDateBR(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
