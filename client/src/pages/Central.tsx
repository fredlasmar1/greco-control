import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/demoData";
import { apiRequest } from "@/lib/queryClient";
import { Radar, MessageSquare, Copy, Check, Loader2 } from "lucide-react";

// ── Tipos (espelham o /api/central/clientes) ────────────────────────────────
interface Cliente {
  id: string;
  nome: string;
  visitas: number;
  ltv: number;
  ticket: number;
  freqDias: number;
  diasSemVir: number;
  ultima: string;
  proxima: string;
  bucket: string;
  telefone: string;
  aniversario: string;
}
interface Resumo {
  bucket: string;
  clientes: number;
  ltvTotal: number;
}
interface CentralData {
  ok: boolean;
  totalClientes: number;
  ltvMedio: number;
  ticketMedio: number;
  resumo: Resumo[];
  clientes: Cliente[];
}

// ── Metadados dos buckets RFM (ordem = prioridade de venda) ──────────────────
// PERDIDO e EM_RISCO na frente: é onde está o dinheiro parado (a mina de winback).
const BUCKETS: Record<string, { label: string; hint: string; mina?: boolean }> = {
  PERDIDO: { label: "Perdidos", hint: "90+ dias sem vir — a maior mina de retorno", mina: true },
  EM_RISCO: { label: "Em risco", hint: "Atrasando o corte — pega antes de perder", mina: true },
  VIP: { label: "VIP", hint: "Top da casa — trata como rei" },
  RECORRENTE: { label: "Recorrentes", hint: "Fiéis — mantém o ritmo" },
  OCASIONAL: { label: "Ocasionais", hint: "Vêm de vez em quando" },
  NOVO: { label: "Novos", hint: "Vieram pouco — puxa pra 2ª visita" },
};
const ORDEM = ["PERDIDO", "EM_RISCO", "VIP", "RECORRENTE", "OCASIONAL", "NOVO"];

function fmtData(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export default function Central() {
  const { data, isLoading, error } = useQuery<CentralData>({
    queryKey: ["/api/central/clientes"],
  });

  const [bucketSel, setBucketSel] = useState<string>("PERDIDO");
  const [alvo, setAlvo] = useState<Cliente | null>(null);
  const [mensagem, setMensagem] = useState<string>("");
  const [fonte, setFonte] = useState<string>("");
  const [copiado, setCopiado] = useState(false);

  const gerar = useMutation({
    mutationFn: async (c: Cliente) => {
      const res = await apiRequest("POST", "/api/central/mensagem", {
        nome: c.nome,
        bucket: c.bucket,
        diasSemVir: c.diasSemVir,
        ticket: c.ticket,
        visitas: c.visitas,
      });
      return (await res.json()) as { ok: boolean; mensagem: string; fonte: string };
    },
    onSuccess: (r) => {
      setMensagem(r.mensagem || "");
      setFonte(r.fonte || "");
    },
  });

  function abrirRegua(c: Cliente) {
    setAlvo(c);
    setMensagem("");
    setFonte("");
    setCopiado(false);
    gerar.mutate(c);
  }

  function copiar() {
    if (!mensagem) return;
    navigator.clipboard?.writeText(mensagem).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    });
  }

  const waLink =
    alvo?.telefone && mensagem
      ? `https://wa.me/${alvo.telefone}?text=${encodeURIComponent(mensagem)}`
      : "";

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando a Central de Vendas…
      </div>
    );
  }
  if (error || !data?.ok) {
    return (
      <div className="p-8 text-destructive">
        Não consegui carregar a Central. {(error as any)?.message || ""}
      </div>
    );
  }

  const resumoMap = new Map(data.resumo.map((r) => [r.bucket, r]));
  const listaBucket = data.clientes.filter((c) => c.bucket === bucketSel);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Radar className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-xl tracking-wide">Central de Vendas</h1>
          <p className="text-sm text-muted-foreground">
            Quem chamar de volta e o que falar — direto do faturamento real.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi titulo="Clientes na base" valor={data.totalClientes.toLocaleString("pt-BR")} />
        <Kpi titulo="LTV médio" valor={formatCurrency(data.ltvMedio)} />
        <Kpi titulo="Ticket médio" valor={formatCurrency(data.ticketMedio)} />
      </div>

      {/* Buckets RFM clicáveis */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {ORDEM.map((b) => {
          const meta = BUCKETS[b];
          const r = resumoMap.get(b);
          if (!meta) return null;
          const ativo = bucketSel === b;
          return (
            <button
              key={b}
              onClick={() => setBucketSel(b)}
              className={[
                "rounded-xl border p-4 text-left transition-colors",
                ativo
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-muted",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{meta.label}</span>
                {meta.mina && (
                  <Badge variant="destructive" className="text-[10px]">
                    mina
                  </Badge>
                )}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">
                {(r?.clientes ?? 0).toLocaleString("pt-BR")}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatCurrency(r?.ltvTotal ?? 0)} em LTV
              </div>
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{meta.hint}</p>
            </button>
          );
        })}
      </div>

      {/* Lista de clientes do bucket selecionado */}
      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {BUCKETS[bucketSel]?.label ?? bucketSel}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({listaBucket.length.toLocaleString("pt-BR")} clientes)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Visitas</TableHead>
                  <TableHead className="text-right">LTV</TableHead>
                  <TableHead className="text-right">Ticket</TableHead>
                  <TableHead className="text-right">Sem vir</TableHead>
                  <TableHead>Última</TableHead>
                  <TableHead className="text-right">Régua</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaBucket.slice(0, 300).map((c) => (
                  <TableRow key={c.id || c.nome}>
                    <TableCell className="font-medium">{c.nome || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.visitas}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(c.ltv)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(c.ticket)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.diasSemVir}d</TableCell>
                    <TableCell className="text-muted-foreground">{fmtData(c.ultima)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => abrirRegua(c)}>
                        <MessageSquare className="mr-1 h-3.5 w-3.5" /> Gerar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {listaBucket.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Nenhum cliente neste grupo.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {listaBucket.length > 300 && (
            <p className="p-3 text-xs text-muted-foreground">
              Mostrando os 300 de maior LTV de {listaBucket.length.toLocaleString("pt-BR")}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Dialog da régua assistida */}
      <Dialog open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mensagem pra {alvo?.nome?.split(/\s+/)[0] || "cliente"}</DialogTitle>
            <DialogDescription>
              {alvo ? `${BUCKETS[alvo.bucket]?.label ?? alvo.bucket} · ${alvo.diasSemVir} dias sem vir` : ""}
            </DialogDescription>
          </DialogHeader>

          {gerar.isPending ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Escrevendo a mensagem…
            </div>
          ) : (
            <>
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
              />
              {fonte === "fallback" && (
                <p className="text-xs text-muted-foreground">
                  IA indisponível — mensagem padrão (dá pra editar acima).
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copiar}>
                  {copiado ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                  {copiado ? "Copiado" : "Copiar"}
                </Button>
                {waLink ? (
                  <Button size="sm" asChild>
                    <a href={waLink} target="_blank" rel="noreferrer">
                      <MessageSquare className="mr-1 h-3.5 w-3.5" /> Abrir no WhatsApp
                    </a>
                  </Button>
                ) : (
                  <span className="self-center text-xs text-muted-foreground">
                    Sem telefone na base — copie e busque o cliente no WhatsApp.
                  </span>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <Card className="rounded-xl">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
      </CardContent>
    </Card>
  );
}
