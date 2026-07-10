import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Wallet, Info, Loader2, Send } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/demoData";

interface ContaMensal {
  id: string;
  nome: string;
  diaVencimento: number;
  valor: number | null;
  observacao?: string;
  ativa: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

interface FormState {
  nome: string;
  diaVencimento: string;
  valor: string;
  observacao: string;
  ativa: boolean;
}

const FORM_VAZIO: FormState = {
  nome: "",
  diaVencimento: "",
  valor: "",
  observacao: "",
  ativa: true,
};

function ordenarPorDia(lista: ContaMensal[]): ContaMensal[] {
  return [...lista].sort((a, b) => {
    if (a.diaVencimento !== b.diaVencimento) return a.diaVencimento - b.diaVencimento;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

function ContaDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: ContaMensal | null;
  onSaved: () => void;
}) {
  const editando = !!initial;
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErro(null);
      if (initial) {
        setForm({
          nome: initial.nome,
          diaVencimento: String(initial.diaVencimento),
          valor: initial.valor != null ? String(initial.valor) : "",
          observacao: initial.observacao ?? "",
          ativa: initial.ativa,
        });
      } else {
        setForm(FORM_VAZIO);
      }
    }
  }, [open, initial]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const nome = form.nome.trim();
    if (!nome) {
      setErro("Informe o nome da conta.");
      return;
    }
    const dia = Number(form.diaVencimento);
    if (!Number.isFinite(dia) || dia < 1 || dia > 31) {
      setErro("Dia de vencimento deve estar entre 1 e 31.");
      return;
    }
    const valor =
      form.valor.trim() === "" ? null : Number(form.valor.replace(",", "."));
    if (valor !== null && !Number.isFinite(valor)) {
      setErro("Valor inválido.");
      return;
    }

    setSalvando(true);
    try {
      const body = {
        nome,
        diaVencimento: dia,
        valor,
        observacao: form.observacao.trim() || undefined,
        ativa: form.ativa,
      };
      if (editando && initial) {
        await apiRequest("PUT", `/api/contas-mensais/${initial.id}`, body);
      } else {
        await apiRequest("POST", `/api/contas-mensais`, body);
      }
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      setErro(err?.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editando ? "Editar conta mensal" : "Nova conta mensal"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input
              value={form.nome}
              onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
              placeholder="Ex: Aluguel, Cartão Itaú, Internet…"
              data-testid="conta-nome"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Dia do vencimento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={form.diaVencimento}
                onChange={(e) =>
                  setForm((p) => ({ ...p, diaVencimento: e.target.value }))
                }
                placeholder="1 a 31"
                data-testid="conta-dia"
              />
            </div>
            <div>
              <Label className="text-xs">Valor (R$, opcional)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.valor}
                onChange={(e) =>
                  setForm((p) => ({ ...p, valor: e.target.value }))
                }
                placeholder="Vazio = varia"
                data-testid="conta-valor"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Observação (opcional)</Label>
            <Input
              value={form.observacao}
              onChange={(e) =>
                setForm((p) => ({ ...p, observacao: e.target.value }))
              }
              placeholder="Ex: débito automático no Itaú"
              data-testid="conta-obs"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-card-border px-3 py-2">
            <div>
              <div className="text-sm font-medium">Ativa</div>
              <div className="text-xs text-muted-foreground">
                Quando desativada, não entra no aviso da manhã.
              </div>
            </div>
            <Switch
              checked={form.ativa}
              onCheckedChange={(v) => setForm((p) => ({ ...p, ativa: v }))}
              data-testid="conta-ativa"
            />
          </div>

          {erro && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {erro}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/80 text-white"
              disabled={salvando}
            >
              {salvando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editando ? "Salvar alterações" : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ContasMensais() {
  const [contas, setContas] = useState<ContaMensal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<ContaMensal | null>(null);
  const [enviandoTg, setEnviandoTg] = useState(false);
  const [tgMsg, setTgMsg] = useState<string | null>(null);

  async function enviarResumoTelegram() {
    setEnviandoTg(true);
    setTgMsg(null);
    try {
      const res = await apiRequest("POST", "/api/telegram/contas-mes");
      const j = await res.json();
      setTgMsg(j?.enviado
        ? `✓ Resumo enviado no Telegram — total ${formatCurrency(j.total || 0)} (${j.qtdContas} contas)`
        : `Não enviado: ${j?.error || "Telegram não configurado"}`);
    } catch (e: any) {
      setTgMsg(`Erro: ${e?.message || "falha ao enviar"}`);
    } finally {
      setEnviandoTg(false);
    }
  }

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const res = await apiRequest("GET", "/api/contas-mensais");
      const data = (await res.json()) as ContaMensal[];
      setContas(ordenarPorDia(data));
    } catch (err: any) {
      setErro(err?.message || "Erro ao carregar contas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function deletar(c: ContaMensal) {
    if (!confirm(`Excluir a conta "${c.nome}"? Essa ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await apiRequest("DELETE", `/api/contas-mensais/${c.id}`);
      await carregar();
    } catch (err: any) {
      alert(err?.message || "Erro ao excluir.");
    }
  }

  function abrirNova() {
    setEditando(null);
    setDialogOpen(true);
  }

  function abrirEdicao(c: ContaMensal) {
    setEditando(c);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 max-w-[1100px]">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Contas Mensais
          </h2>
          <p className="text-sm text-muted-foreground">
            Despesas recorrentes que vencem todo mês. Avisadas no resumo das
            08:00 do Telegram.
          </p>
        </div>
        <Button
          onClick={abrirNova}
          className="bg-primary hover:bg-primary/80 text-white"
          data-testid="add-conta-btn"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nova conta
        </Button>
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          Se o dia do vencimento cair em fim de semana ou feriado nacional, o
          aviso é antecipado para o último dia útil anterior. Comissões dos
          barbeiros (dia 1) e vale (dia 15) já entram automaticamente — não
          precisa cadastrar aqui.
        </p>
      </div>

      {/* Total do mês a pagar + enviar resumo no Telegram */}
      {!loading && contas && contas.length > 0 && (() => {
        const comValor = contas.filter((c) => c.valor != null && (c.valor as number) > 0);
        const total = comValor.reduce((s, c) => s + (c.valor || 0), 0);
        const variaveis = contas.length - comValor.length;
        return (
          <div className="rounded-2xl border-2 border-primary/40 ring-1 ring-white/10 bg-card p-4 flex items-center justify-between gap-3 flex-wrap" data-testid="contas-total">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Total do mês a pagar</div>
              <div className="text-2xl font-bold text-foreground tabular-nums mt-1">{formatCurrency(total)}</div>
              <div className="text-[11px] text-muted-foreground">{contas.length} contas{variaveis > 0 ? ` · ${variaveis} de valor variável (não somadas)` : ""}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                onClick={enviarResumoTelegram}
                disabled={enviandoTg}
                className="border-primary/40 text-primary hover:bg-primary/10"
                data-testid="enviar-contas-telegram"
              >
                {enviandoTg ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Enviar resumo no Telegram
              </Button>
              {tgMsg && <span className="text-[11px] text-muted-foreground max-w-[240px] text-right">{tgMsg}</span>}
            </div>
          </div>
        );
      })()}

      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {loading
              ? "Carregando…"
              : `${contas?.length ?? 0} conta${(contas?.length ?? 0) === 1 ? "" : "s"} cadastrada${(contas?.length ?? 0) === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {erro && (
            <div className="m-4 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {erro}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando contas…
            </div>
          )}

          {!loading && contas && contas.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma conta cadastrada. Clique em <b>Nova conta</b> para
              adicionar.
            </div>
          )}

          {!loading && contas && contas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-xs text-muted-foreground font-medium">
                      Conta
                    </th>
                    <th className="text-center p-3 text-xs text-muted-foreground font-medium">
                      Dia
                    </th>
                    <th className="text-right p-3 text-xs text-muted-foreground font-medium">
                      Valor
                    </th>
                    <th className="text-left p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">
                      Observação
                    </th>
                    <th className="text-center p-3 text-xs text-muted-foreground font-medium">
                      Ativa
                    </th>
                    <th className="text-right p-3 text-xs text-muted-foreground font-medium">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contas.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border/50 hover:bg-muted/30"
                      data-testid={`conta-row-${c.id}`}
                    >
                      <td className="p-3 font-medium">{c.nome}</td>
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary text-xs font-semibold">
                          {c.diaVencimento}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {c.valor != null ? (
                          <span className="font-medium">
                            {formatCurrency(c.valor)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            varia
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs hidden sm:table-cell">
                        {c.observacao || "—"}
                      </td>
                      <td className="p-3 text-center">
                        {c.ativa ? (
                          <span className="text-xs text-green-500 font-medium">
                            Sim
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Não
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => abrirEdicao(c)}
                            data-testid={`conta-edit-${c.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deletar(c)}
                            className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            data-testid={`conta-delete-${c.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ContaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editando}
        onSaved={carregar}
      />
    </div>
  );
}
