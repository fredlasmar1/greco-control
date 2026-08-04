/**
 * O CONSELHO — quatro lentes que discordam na frente do dono.
 *
 * O conselheiro antigo era UMA IA lendo um resumo fixo. Ela nunca teria achado o
 * assinante que consome R$ 560 pagando R$ 255, nem as 202 horas de assistente
 * que a casa paga e não atribui a serviço nenhum: esses números não estavam no
 * resumo, apareceram porque alguém foi PROCURAR. Aqui os conselheiros consultam
 * o banco antes de opinar.
 *
 * O produto desta tela é a DISCORDÂNCIA. Ela não mostra uma resposta média —
 * média de quatro lentes distintas é a pior das quatro, porque some justamente a
 * informação que fazia valer a pena ter quatro. Quando a mesa se divide, ela
 * mostra dividida, e lista o que decidiria o impasse.
 *
 * E unanimidade vira ALERTA, não selo: quatro "sim" costuma significar que a
 * pergunta já trazia a resposta dentro.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2, MinusCircle, Scale, ThumbsDown, ThumbsUp, Users } from "lucide-react";

const API = (globalThis as any).__API_BASE__ || "";

const POSICAO: Record<string, { rotulo: string; cor: string; icone: any }> = {
  a_favor: { rotulo: "a favor", cor: "text-emerald-500", icone: ThumbsUp },
  contra: { rotulo: "contra", cor: "text-rose-500", icone: ThumbsDown },
  depende: { rotulo: "depende", cor: "text-amber-500", icone: MinusCircle },
};

const SUGESTOES = [
  "Devo liberar o corte Express para todos os barbeiros, a R$ 45, com a comissão caindo de 50% para 42%?",
  "Vale contratar mais barbeiros agora, ou o gargalo é outro?",
  "O Clube Greco está me dando lucro ou estou dando desconto para quem viria de qualquer jeito?",
  "Como encher a terça e a quarta de manhã sem baixar preço?",
];

export default function OConselho() {
  const [pergunta, setPergunta] = useState("");
  const [sessao, setSessao] = useState<any>(null);

  const reunir = useMutation({
    mutationFn: async (p: string) => {
      const r = await fetch(`${API}/api/mesa/conselho`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pergunta: p }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "o conselho não conseguiu se reunir");
      return j.sessao;
    },
    onSuccess: setSessao,
  });

  const enviar = (p: string) => {
    const t = p.trim();
    if (t.length < 10 || reunir.isPending) return;
    setPergunta(t);
    reunir.mutate(t);
  };

  const a = sessao?.apuracao;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Greco Control · o conselho
        </p>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Quatro cabeças, de propósito</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          O Contador e o Sócio Cético consultam os números da casa. O Barbeiro da Esquina e o Cliente da
          Cadeira <strong>não têm acesso a eles</strong> — é assim de propósito, senão viram quatro contadores.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-3 p-5">
          <Textarea
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            placeholder="O que você quer decidir?"
            rows={3}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviar(pergunta);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => enviar(pergunta)} disabled={pergunta.trim().length < 10 || reunir.isPending}>
              {reunir.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> reunindo…
                </>
              ) : (
                <>
                  <Users className="mr-2 h-4 w-4" /> Reunir o conselho
                </>
              )}
            </Button>
            {reunir.isPending && (
              <span className="text-xs text-muted-foreground">
                os quatro estão consultando o banco em paralelo — leva um minuto
              </span>
            )}
          </div>

          {!sessao && !reunir.isPending && (
            <div className="flex flex-wrap gap-2 pt-1">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {reunir.isError && (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-1 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-500">
              <AlertTriangle className="h-4 w-4" /> O conselho não se reuniu
            </div>
            <p className="text-sm text-muted-foreground">{String((reunir.error as Error).message)}</p>
          </CardContent>
        </Card>
      )}

      {a && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold uppercase tracking-wider">
                  {a.posicaoDaMesa === "dividido"
                    ? "A mesa se dividiu"
                    : a.posicaoDaMesa === null
                    ? "Ninguém conseguiu se posicionar"
                    : `A mesa: ${POSICAO[a.posicaoDaMesa]?.rotulo ?? a.posicaoDaMesa}`}
                </span>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {a.aFavor} a favor · {a.contra} contra · {a.depende} depende
                {a.semBase > 0 && ` · ${a.semBase} sem base`}
              </span>
            </div>

            {/* Unanimidade é suspeita, não selo. */}
            {a.alerta && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                {a.alerta}
              </p>
            )}

            {a.oQueDecidiria.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  O que decidiria isso
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {a.oQueDecidiria.map((x: string, i: number) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}

            {a.riscosLevantados.length > 0 && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Riscos que ninguém tinha falado
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {a.riscosLevantados.map((x: string, i: number) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sessao?.conselheiros?.map((c: any) => {
        const p = c.parecer;
        const pos = POSICAO[p.posicao] ?? POSICAO.depende;
        const Icone = pos.icone;
        return (
          <Card key={c.id}>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{c.nome}</h2>
                  <p className="text-xs text-muted-foreground">
                    {c.lente} · {c.base === "dado_da_casa" ? "consulta os números" : "não vê os números"}
                  </p>
                </div>
                <span className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${pos.cor}`}>
                  <Icone className="h-3.5 w-3.5" />
                  {pos.rotulo}
                  {p.semBase && <span className="text-muted-foreground">(sem base)</span>}
                </span>
              </div>

              <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.argumento}</p>

              {p.mudariaDeIdeiaSe && (
                <p className="border-l-2 pl-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Mudaria de ideia se: </span>
                  {p.mudariaDeIdeiaSe}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
