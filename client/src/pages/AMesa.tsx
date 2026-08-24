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
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Loader2, Target, Lightbulb } from "lucide-react";
import { Chip } from "@/components/painel";
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

/**
 * ⛔ PADRÃO VISUAL DO CONTROL — decidido pelo dono em 23/08/2026: escuro com a
 * marca Greco, mas com a DENSIDADE e os gráficos das referências executivas que
 * ele mandou. Ele abriu A Mesa depois do Painel e disse: *"acho que você não
 * entrou o padrão que eu te pedi nessas abas"*. Estava certo — eu tinha aplicado
 * só no Painel.
 *
 * ⚠️ E o padrão ⛔ NÃO é "mais bonito": é ler em três segundos o que antes exigia
 * ler quatro parágrafos. As decisões viravam parede de texto, e parede de texto
 * é como um placar deixa de ser lido.
 */
/**
 * ⛔ ANIMAÇÃO DE ENTRADA DESLIGADA EM TODOS OS GRÁFICOS — e por medição, ⛔ não
 * por gosto.
 *
 * `[23/08/2026]` o donut d'A Mesa e as barras ao lado subiram VAZIOS. Eu tentei
 * três consertos de layout — porcentagem em flex, invólucro de tamanho fixo,
 * bloco de largura total — e no caminho QUEBREI o donut do Painel, que
 * funcionava. Todos os três atacaram a causa errada.
 *
 * A medição do DOM encerrou o chute: o container tinha **440×190**, o `<svg>`
 * existia com as dimensões certas, as camadas `recharts-pie-sector` e
 * `recharts-bar-rectangle` estavam lá — e **sem um único `<path>` dentro**. Esse
 * é o estado INICIAL da animação: recharts cria o grupo e desenha o traçado ao
 * longo dela. A animação ⛔ não completava.
 *
 * ⚠️ E o mesmo defeito já tinha aparecido no Painel sem eu entender: duas
 * capturas com 4 s de intervalo mostraram as barras vazias e depois cheias. Eu
 * li aquilo como "demora" em vez de "às vezes ⛔ não termina".
 *
 * ⛔ Num painel que existe para ser lido, gráfico que às vezes ⛔ não pinta é pior
 * que gráfico sem animação. O ganho estético ⛔ não paga o risco de o dono abrir
 * a tela e ver vazio — foi exatamente o que aconteceu.
 */
const VERMELHO = "#A50101";
const AZUL = "#3B82F6";
const CINZA = "#6B7280";
const VERDE = "#10B981";

const API = (globalThis as any).__API_BASE__ || "";
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const tooltip = {
  contentStyle: { background: "#141416", border: "1px solid #ffffff1f", borderRadius: 12, color: "#E5E7EB", fontSize: 12 },
  labelStyle: { color: "#9CA3AF" },
  cursor: { fill: "#ffffff08" },
} as const;

const SITUACAO: Record<string, { rotulo: string; cor: string; icone: any }> = {
  rascunho: { rotulo: "incompleta", cor: "text-amber-500", icone: AlertTriangle },
  aguardando: { rotulo: "ainda não vale", cor: "text-muted-foreground", icone: Clock },
  valendo: { rotulo: "valendo", cor: "text-sky-500", icone: Target },
  pronta_pra_conferir: { rotulo: "hora de conferir", cor: "text-amber-500", icone: HelpCircle },
  encerrada: { rotulo: "encerrada", cor: "text-emerald-500", icone: CheckCircle2 },
};

export default function AMesa() {
  /**
   * ⛔ HOOK NO TOPO, ANTES DE QUALQUER `return`.
   *
   * ⚠️ Na primeira versão desta tela eu declarei este `useState` junto do lugar
   * onde ele é usado — depois dos `return` de carregando e de erro. React exige
   * a MESMA quantidade de hooks em toda renderização: no primeiro carregamento
   * a tela retorna cedo, roda 1 hook; quando o dado chega, roda 2, e o React
   * derruba com "Rendered more hooks than during the previous render".
   *
   * ⛔ O typecheck ⛔ NÃO pega isso. Só quebraria na cara do dono.
   */
  const [expandida, setExpandida] = useState<number | null>(null);
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
  const oportunidades: any[] = mesa.oportunidades ?? [];
  const abertas = linhas.filter((l) => l.situacao !== "encerrada");
  const proxima = abertas
    .filter((l) => l.diasAteValer >= 0)
    .sort((a, b) => a.diasAteValer - b.diasAteValer)[0];

  /**
   * ⛔ AGRUPAR ⛔ NÃO É CALCULAR. Contar quantas decisões estão em cada situação é
   * leitura do que o servidor já classificou — a tela ⛔ não decide situação
   * nenhuma, só soma o que veio rotulado.
   */
  const porSituacao = [
    { rotulo: "valendo", n: linhas.filter((l) => l.situacao === "valendo").length, cor: AZUL },
    { rotulo: "ainda não vale", n: linhas.filter((l) => l.situacao === "aguardando").length, cor: CINZA },
    { rotulo: "encerrada", n: linhas.filter((l) => l.situacao === "encerrada").length, cor: VERDE },
  ].filter((f) => f.n > 0);

  /**
   * ⛔ SÓ AS QUE APOSTAM EM DINHEIRO. Pôr "+14 assinantes" numa barra ao lado de
   * "R$ 6.205" seria somar unidades diferentes num gráfico — o jeito mais rápido
   * de inventar uma comparação que ⛔ não existe.
   */
  const porValor = linhas
    .filter((l) => l.decisao.metrica !== "assinantes_clube")
    .map((l) => ({
      curto: String(l.decisao.titulo).length > 22 ? String(l.decisao.titulo).slice(0, 21) + "…" : l.decisao.titulo,
      esperado: Number(l.decisao.esperado) || 0,
    }))
    .sort((a, b) => b.esperado - a.esperado);

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

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Prometido por mês</p>
            <p className="text-2xl font-bold tabular-nums text-[#E23B2E]">{brl(mesa.prometidoPorMes || 0)}</p>
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

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ── O donut de situação ─────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold">Em que pé estão</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              ⛔ nenhuma foi julgada ainda — todas esperam a data de conferência
            </p>
            {/*
              ⚠️ DONUT EM BLOCO PRÓPRIO, com a legenda EMBAIXO — ⛔ não lado a
              lado. Duas tentativas falharam antes desta: `width="45%"` dentro de
              um flex colapsou (o donut virou dois tracinhos), e o invólucro de
              tamanho fixo ⛔ não desenhou. `width="100%"` num bloco de largura
              resolvida é o único formato que este código comprovadamente
              renderiza — é o que os outros gráficos usam.
            */}
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie isAnimationActive={false} data={porSituacao} dataKey="n" nameKey="rotulo" innerRadius={48} outerRadius={78} paddingAngle={3}>
                  {porSituacao.map((f, i) => <Cell key={i} fill={f.cor} stroke="#0E0000" />)}
                </Pie>
                <Tooltip {...tooltip} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">
              {porSituacao.map((f) => (
                <li key={f.rotulo} className="flex items-baseline gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: f.cor }} />
                  <span className="text-muted-foreground">{f.rotulo}</span>
                  <span className="font-semibold tabular-nums">{f.n}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* ── Quanto cada decisão promete ─────────────────────────────────── */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold">Quanto cada uma promete</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              ⚠️ só as que apostam em dinheiro — o Clube aposta em assinantes e ⛔ não entra aqui
            </p>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={porValor} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
                <CartesianGrid stroke="#ffffff10" horizontal={false} />
                <XAxis type="number" tick={{ fill: CINZA, fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <YAxis type="category" dataKey="curto" width={92} tick={{ fill: CINZA, fontSize: 11 }}
                  axisLine={false} tickLine={false} />
                <Tooltip {...tooltip} formatter={(v: any) => brl(Number(v))} />
                <Bar isAnimationActive={false} dataKey="esperado" fill={VERMELHO} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
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

      {/*
        ⛔ O QUE OS NÚMEROS SUGEREM — e por que fica ACIMA das decisões.

        `[23/08/2026]` A Mesa era a aba mais fraca: quatro decisões esperando
        data, e ⛔ nada acontecendo. Era um arquivo, ⛔ não uma mesa. O sistema já
        media tudo que valeria decidir — e ⛔ ninguém era avisado.

        ⛔ E ISTO ⛔ NÃO É DECISÃO. Nada aqui entrou em `decisoes`, e a tela diz
        isso em letras. Decisão só nasce quando o dono decide, com número
        esperado e data de conferência — a regra que o cabeçalho anuncia, e que
        impediu de registrar o reajuste de 01/12, que é INTENÇÃO.
      */}
      {oportunidades.length > 0 && (
        <Card className="border-[#A50101]/25">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Lightbulb className="h-4 w-4 text-[#E23B2E]" />
                  O que os números sugerem
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ⛔ Isto ⛔ não é decisão — é o que a medição aponta. Decisão só entra quando você
                  definir o esperado e a data de conferência.
                </p>
              </div>
              <Chip tom="marca">{oportunidades.length} medidas</Chip>
            </div>

            <div className="mt-4 space-y-3">
              {oportunidades.map((o: any) => (
                <div key={o.id} className="rounded-[12px] border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-medium">{o.titulo}</h3>
                    <div className="flex shrink-0 items-center gap-2">
                      {o.peso === "alta" && <Chip tom="atencao">prioridade</Chip>}
                      {/* ⛔ Esperado 0 ⛔ não vira "R$ 0,00": ⛔ nem toda proposta é
                          aposta de dinheiro — a de catálogo é buraco de dado. */}
                      {o.esperado > 0 && (
                        <span className="font-semibold tabular-nums text-[#E23B2E]">
                          {o.unidade === "R$/mês" ? `${brl(o.esperado)}/mês` : `${o.esperado} ${o.unidade}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="mt-1.5 text-sm text-muted-foreground">{o.porque}</p>

                  {/* ⛔ FONTE E PREMISSA SEMPRE VISÍVEIS. Proposta sem premissa é
                      palpite com aparência de apuração — e este painel tem um
                      operador só, que acredita no que parece pronto. */}
                  <div className="mt-2.5 space-y-1 border-l-2 border-white/10 pl-3 text-[11px] text-muted-foreground">
                    <p><b className="text-slate-400">de onde saiu:</b> {o.fonte}</p>
                    <p className="text-amber-300/80">{o.premissa}</p>
                    <p><b className="text-slate-400">para virar decisão:</b> {o.paraVirarDecisao}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/*
        ⛔ AS DECISÕES VIRARAM LINHA, ⛔ NÃO PARÁGRAFO.

        Cada uma ocupava quatro linhas de prosa antes de mostrar o número. Numa
        tela que existe para COBRAR, texto longo é como o placar deixa de ser
        lido — e o dono disse exatamente isso ao comparar com as referências.

        ⚠️ Mas o "porquê" ⛔ NÃO foi apagado: ele fica atrás de um clique. É o
        registro do raciocínio no dia da decisão, e é o que impede o histórico de
        virar uma lista de números sem memória.
      */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold">As decisões</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            clique numa linha para ver por que ela foi tomada
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Decisão</th>
                  <th className="py-2 text-left font-medium">Situação</th>
                  <th className="py-2 text-right font-medium">Aposta</th>
                  <th className="py-2 text-right font-medium">Prazo</th>
                  <th className="py-2 pl-4 text-left font-medium">Veredito</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const s = SITUACAO[l.situacao] ?? SITUACAO.aguardando;
                  const Icone = s.icone;
                  const v = l.veredito;
                  const aberto = expandida === i;
                  return (
                    <Fragment key={i}>
                      <tr
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                        onClick={() => setExpandida(aberto ? null : i)}
                      >
                        <td className="py-2.5 pr-3 font-medium">{l.decisao.titulo}</td>
                        <td className="py-2.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.cor}`}>
                            <Icone className="h-3 w-3" /> {s.rotulo}
                          </span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {l.decisao.metrica === "assinantes_clube"
                            ? `+${l.decisao.esperado}`
                            : brl(l.decisao.esperado)}
                          <span className="ml-1 text-[11px] text-muted-foreground">{l.metricaRotulo}</span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {l.diasAteValer > 0 ? (
                            <span className="text-muted-foreground">vale em {l.diasAteValer}d</span>
                          ) : (
                            <span>confere em <b>{l.diasAteConferir}d</b></span>
                          )}
                        </td>
                        <td className="py-2.5 pl-4">
                          {/* ⛔ "sem base pra julgar" ⛔ NÃO é falha: é a data ainda
                              não ter chegado. Pintar de vermelho ensinaria o dono
                              a ver defeito onde há espera. */}
                          <span className={
                            v.atingiu === true ? "text-emerald-500"
                            : v.atingiu === false ? "text-rose-500"
                            : "text-muted-foreground"
                          }>
                            {v.atingiu === null ? "aguardando a data" : v.resumo}
                          </span>
                        </td>
                      </tr>
                      {aberto && (
                        <tr className="border-b last:border-0">
                          <td colSpan={5} className="bg-muted/20 px-3 py-3">
                            <p className="text-sm text-muted-foreground">{l.decisao.porque}</p>
                            {l.decisao.limiteTexto && (
                              <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
                                <b>Risco aceito: </b>{l.decisao.limiteTexto}
                              </p>
                            )}
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              decidida em {l.decisao.decididoEm.split("-").reverse().join("/")} ·
                              vale em {l.decisao.valeEm.split("-").reverse().join("/")} ·
                              confere em {l.decisao.conferirEm.split("-").reverse().join("/")}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
