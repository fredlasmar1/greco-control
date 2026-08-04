/**
 * A MESA — as decisões do dono com placar.
 *
 * A tela existe porque, em 03/08/2026, quatro decisões foram tomadas em cima de
 * número medido e moravam numa conversa. Em novembro ninguém saberia dizer se
 * deram certo, nem por que foram tomadas.
 *
 * O que ela NUNCA faz: preencher com zero o que não foi apurado. Quando a ponte
 * com o Greco Metas cai, ela diz que caiu. Um placar mostrando R$ 0,00 porque a
 * leitura falhou parece resultado ruim e leva a decisão errada.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Loader2, Target } from "lucide-react";

const API = (globalThis as any).__API_BASE__ || "";
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const SITUACAO: Record<string, { rotulo: string; cor: string; icone: any }> = {
  rascunho: { rotulo: "incompleta", cor: "text-amber-500", icone: AlertTriangle },
  aguardando: { rotulo: "ainda não vale", cor: "text-muted-foreground", icone: Clock },
  valendo: { rotulo: "valendo", cor: "text-sky-500", icone: Target },
  pronta_pra_conferir: { rotulo: "hora de conferir", cor: "text-amber-500", icone: HelpCircle },
  encerrada: { rotulo: "encerrada", cor: "text-emerald-500", icone: CheckCircle2 },
};

export default function AMesa() {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["mesa"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/mesa`);
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "não consegui ler a mesa");
      return j;
    },
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> lendo a mesa no Greco Metas…
      </div>
    );
  }

  // Sem dado, a tela diz o que houve. Ela não inventa um estado "vazio" que
  // pareça "nenhuma decisão em aberto".
  if (error) {
    return (
      <Card className="m-6 border-amber-500/40">
        <CardContent className="space-y-2 p-6">
          <div className="flex items-center gap-2 font-semibold text-amber-500">
            <AlertTriangle className="h-4 w-4" /> Não consegui ler as decisões
          </div>
          <p className="text-sm text-muted-foreground">{String((error as Error).message)}</p>
          <p className="text-xs text-muted-foreground">
            O Control não guarda decisão: ele lê do Greco Metas. Enquanto a ponte não responder, esta tela
            fica em branco de propósito — melhor vazia que com número errado.
          </p>
        </CardContent>
      </Card>
    );
  }

  const mesa = data.mesa;
  const linhas: any[] = mesa.linhas ?? [];
  const pendencias: any[] = mesa.pendencias ?? [];
  const abertas = linhas.filter((l) => l.situacao !== "encerrada");
  const proxima = abertas
    .filter((l) => l.diasAteValer >= 0)
    .sort((a, b) => a.diasAteValer - b.diasAteValer)[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Greco Control · a mesa
        </p>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">O que foi decidido, e o que deu</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Toda decisão aqui tem um número esperado e uma data de conferência. Decisão sem número é intenção —
          essas não entram.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Prometido por mês</p>
            <p className="text-2xl font-bold tabular-nums">{brl(mesa.prometidoPorMes || 0)}</p>
            <p className="text-xs text-muted-foreground">somando as decisões abertas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Decisões abertas</p>
            <p className="text-2xl font-bold tabular-nums">{abertas.length}</p>
            <p className="text-xs text-muted-foreground">
              {linhas.length - abertas.length} já encerrada(s)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Próxima a valer</p>
            <p className="text-2xl font-bold tabular-nums">
              {proxima ? (proxima.diasAteValer === 0 ? "hoje" : `${proxima.diasAteValer} dias`) : "—"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{proxima?.decisao?.titulo ?? "nada marcado"}</p>
          </CardContent>
        </Card>
      </div>

      {pendencias.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-500">
              <AlertTriangle className="h-4 w-4" /> O que precisa de você
            </div>
            <ul className="space-y-2 text-sm">
              {pendencias.map((p, i) => (
                <li key={i} className="flex flex-col gap-0.5 border-l-2 border-amber-500/40 pl-3">
                  <span className="font-medium">{p.decisao.titulo}</span>
                  <span className="text-muted-foreground">{p.o_que}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {linhas.map((l, i) => {
          const s = SITUACAO[l.situacao] ?? SITUACAO.aguardando;
          const Icone = s.icone;
          const v = l.veredito;
          return (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-semibold">{l.decisao.titulo}</h2>
                  <span className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${s.cor}`}>
                    <Icone className="h-3.5 w-3.5" /> {s.rotulo}
                  </span>
                </div>

                <p className="text-sm text-muted-foreground">{l.decisao.porque}</p>

                <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Aposta: </span>
                    <span className="font-medium tabular-nums">
                      {l.decisao.metrica === "assinantes_clube"
                        ? `+${l.decisao.esperado} ${l.metricaRotulo}`
                        : `${brl(l.decisao.esperado)} — ${l.metricaRotulo}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {l.diasAteValer > 0 ? "Passa a valer em: " : "Confere em: "}
                    </span>
                    <span className="font-medium tabular-nums">
                      {l.diasAteValer > 0
                        ? `${l.diasAteValer} dias (${l.decisao.valeEm.split("-").reverse().join("/")})`
                        : `${l.diasAteConferir} dias (${l.decisao.conferirEm.split("-").reverse().join("/")})`}
                    </span>
                  </div>
                </div>

                {l.decisao.limiteTexto && (
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                    <span className="font-semibold">Risco aceito: </span>
                    {l.decisao.limiteTexto}
                  </p>
                )}

                {/* O veredito só aparece quando existe base. "sem base pra julgar"
                    é uma resposta melhor que um percentual inventado. */}
                <p
                  className={`text-xs ${
                    v.atingiu === true ? "text-emerald-500" : v.atingiu === false ? "text-rose-500" : "text-muted-foreground"
                  }`}
                >
                  {v.resumo}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
