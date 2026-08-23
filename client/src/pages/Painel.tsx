/**
 * O PAINEL — a visão executiva da casa em oito meses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * `[23/08/2026]` o dono abriu o Control e disse: *"cadê os números detalhados e
 * separados, gráficos, abas? Tá muito ruim."* Estava certo. O Control mostrava um
 * mês por vez, num seletor, sem série, sem gráfico e sem comparação — e ele nunca
 * tinha visto que **julho foi o melhor mês da casa**.
 *
 * ⛔ ESTA TELA ⛔ NÃO CALCULA NADA. Tudo vem pronto de `/api/mesa/serie`, que
 * repassa `/api/hub/serie` do Greco Metas. Aqui só se desenha.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ O QUE NENHUM GRÁFICO PODE ESCONDER
 *
 * Gráfico é a forma mais eficiente de mentir com dado verdadeiro: a linha desce e
 * o olho conclui "caiu", sem perguntar se o último mês tem os mesmos dias.
 *
 *   1. **O mês em curso sai TRACEJADO e em cinza**, e ⛔ nunca entra no cálculo
 *      da variação. Agosto com 23 dias ao lado de julho com 31 é uma queda que
 *      ⛔ não existe.
 *   2. **O primeiro mês da base ⛔ não conta como crescimento** de clientes
 *      novos: em janeiro todo mundo aparece pela primeira vez porque o dado
 *      começa ali.
 *   3. **R$/hora começa em junho** e a linha ⛔ não é interpolada para trás. Buraco
 *      no gráfico é honesto; linha inventada, não.
 *   4. **Os avisos do servidor aparecem TODOS**, sem "ver mais". Aviso escondido
 *      atrás de clique é aviso que ninguém lê.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Loader2, Wallet, Users, Scissors, Receipt, Clock3, CalendarClock, Download } from "lucide-react";
import {
  CardNumero, CardGrafico, BotaoFerramenta, Avisos, NaoAbriu, CORES, SERIE, TOOLTIP,
} from "@/components/painel";

const API = (globalThis as any).__API_BASE__ || "";

/** Marca da casa. ⛔ Vermelho é a cor do DADO PRINCIPAL, não de erro. */
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
const VERMELHO = CORES.marca;
const VERMELHO_CLARO = CORES.marcaClara;
const CINZA = CORES.cinza;
/** ⛔ A paleta do donut vem do sistema — multicor, para SEPARAR as fatias.
 *  Antes eram sete tons do mesmo vermelho, e o olho ⛔ não distinguia serviço. */
const PALETA = SERIE;

const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlExato = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const num = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/**
 * ⛔ A VARIAÇÃO, EM UM LUGAR SÓ. Devolve `null` quando falta qualquer um dos dois
 * lados ou quando a base é zero — e a peça escreve "sem base p/ comparar".
 * ⛔ Nunca 0%: zero afirma "ficou igual", e ficar igual ⛔ não é o mesmo que não
 * saber. Antes esta conta estava repetida dentro do card, e repetida diverge.
 */
const pct = (a?: number | null, b?: number | null): number | null =>
  a == null || b == null || b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10;

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotulo = (mes: string) => {
  const [, m] = mes.split("-");
  return MES_CURTO[Number(m) - 1] ?? mes;
};

export default function Painel() {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["serie"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/mesa/serie`);
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "não consegui ler a série");
      return j;
    },
    refetchOnWindowFocus: false,
  });

  const meses: any[] = data?.meses ?? [];

  /**
   * ⛔ A COMPARAÇÃO É ENTRE MESES INTEIROS. O mês em curso fica de fora da conta
   *    de variação — senão todo dia 2 o painel anuncia um desabamento.
   */
  const { atual, anterior } = useMemo(() => {
    const fechados = meses.filter((m) => !m.emCurso);
    return {
      atual: fechados[fechados.length - 1] ?? null,
      anterior: fechados[fechados.length - 2] ?? null,
    };
  }, [meses]);

  const emCurso = meses.find((m) => m.emCurso) ?? null;

  /**
   * ⛔ EXPORTA O QUE ESTÁ NA TELA, e nada além. Sem consulta nova, sem recorte
   * diferente — o CSV tem que bater com o gráfico que o dono está olhando, senão
   * ele confere um contra o outro e encontra divergência que ⛔ não existe.
   *
   * ⚠️ O mês em curso vai marcado como parcial na própria linha: planilha perde
   * a cor e o tracejado, e um agosto pela metade solto numa coluna vira queda.
   */
  const exportar = () => {
    const linhas = [
      ["mes", "faturamento_oficial", "caixa_agenda", "clientes", "atendimentos", "ticket", "rs_hora", "parcial"],
      ...meses.map((m: any) => [
        m.mes, m.oficial?.total ?? "", m.caixa ?? "", m.clientes ?? "",
        m.atendimentos ?? "", m.ticket ?? "", m.rsHora ?? "", m.emCurso ? "SIM" : "",
      ]),
    ];
    const csv = linhas.map((l) => l.join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `greco-painel-${meses[0]?.mes ?? ""}-a-${meses[meses.length - 1]?.mes ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> medindo oito meses…
      </div>
    );
  }
  if (error || !atual) {
    return <NaoAbriu titulo="O Painel" motivo={(error as any)?.message} />;
  }

  return (
    <div className="space-y-6">
      {/* ── Os números que decidem ─────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-white">
            A casa em oito meses
          </h1>
          <span className="text-[11px] uppercase tracking-wide text-slate-500">
            último mês fechado: {rotulo(atual.mes)}/{atual.mes.slice(2, 4)}
          </span>
        </div>

        {/*
          ⛔ A IDADE DO DADO, NO TOPO — e o motivo dela existir.

          `[23/08/2026]` o dono abriu este painel num DOMINGO e disse: *"o sistema
          está travado a tempos em questão de números"*. Nada estava travado: o
          sync roda terça a sábado, o último foi sábado 23:00, e havia 276
          agendamentos futuros. ⛔ Mas nenhuma tela dizia isso.

          ⚠️ Foi a SEGUNDA vez. A primeira, em 17/08, custou uma tarde dele.

          ⛔ E o vermelho só aparece quando passou do PRÓXIMO DISPARO ESPERADO —
          nunca por "faz X horas". Vermelho em dia fechado ensina a ignorar o
          aviso, e aí ninguém vê o dia em que parar de verdade.
        */}
        {data.idade && (
          <div
            className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] ${
              data.idade.atrasado
                ? "border-red-500/40 bg-red-500/[0.08] text-red-300"
                : "border-white/10 bg-white/[0.03] text-slate-400"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${data.idade.atrasado ? "bg-red-400" : "bg-emerald-400"}`} />
            <span>Agenda {data.idade.frase}</span>
          </div>
        )}

        {/*
          ⛔ O MÊS EM CURSO VEM PRIMEIRO, E GRANDE.

          Ele estava num rodapé cinza, e o título dizia "último mês fechado:
          jul". No dia 23 do mês, isso passa a sensação de sistema parado em
          julho — quando agosto é a informação que o dono mais precisa.

          ⚠️ Mas ele CONTINUA fora de toda comparação: o cartão diz "parcial" e
          ⛔ não tem variação percentual. Agosto com 23 dias contra julho com 31
          é uma queda que ⛔ não existe.
        */}
        {emCurso && (
          <div className="mt-4 rounded-2xl border border-white/15 bg-white/[0.04] p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                  {rotulo(emCurso.mes)} · mês em curso —{" "}
                  <span className="text-amber-300/90">parcial, ⛔ fora de comparação</span>
                </p>
                <p className="mt-1 font-display text-4xl font-black text-white">
                  {brl(emCurso.oficial?.total)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">faturamento oficial até agora</p>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-400">
                <span><b className="text-slate-200">{num(emCurso.clientes)}</b> clientes</span>
                <span><b className="text-slate-200">{num(emCurso.atendimentos)}</b> atendimentos</span>
                <span>ticket <b className="text-slate-200">{brlExato(emCurso.ticket)}</b></span>
                <span>R$/h <b className="text-slate-200">{brlExato(emCurso.rsHora)}</b></span>
              </div>
            </div>
          </div>
        )}

        <p className="mt-5 text-[11px] uppercase tracking-wide text-slate-500">
          O último mês FECHADO — {rotulo(atual.mes)}
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {/* ⛔ O DINHEIRO é o faturamento OFICIAL (Gmail + API + CSV), ⛔ nunca a
              agenda — que [medido 23/08] subconta de 13% a 32% conforme o mês. */}
          <CardNumero
            rotulo="Faturamento oficial" icone={Wallet} cor={CORES.marca} destaque
            valor={brl(atual.oficial?.total)}
            variacao={pct(atual.oficial?.total, anterior?.oficial?.total)}
            serie={meses.filter((m) => !m.emCurso).map((m) => m.oficial?.total ?? null)}
            nota="Gmail + API + CSV"
          />
          <CardNumero
            rotulo="Clientes atendidos" icone={Users} cor={CORES.azul}
            valor={num(atual.clientes)}
            variacao={pct(atual.clientes, anterior?.clientes)}
            serie={meses.filter((m) => !m.emCurso).map((m) => m.clientes ?? null)}
            nota="da agenda"
          />
          <CardNumero
            rotulo="Atendimentos" icone={Scissors} cor={CORES.roxo}
            valor={num(atual.atendimentos)}
            variacao={pct(atual.atendimentos, anterior?.atendimentos)}
            serie={meses.filter((m) => !m.emCurso).map((m) => m.atendimentos ?? null)}
            nota="da agenda"
          />
          <CardNumero
            rotulo="Ticket médio" icone={Receipt} cor={CORES.ambar}
            valor={brlExato(atual.ticket)}
            variacao={pct(atual.ticket, anterior?.ticket)}
            serie={meses.filter((m) => !m.emCurso).map((m) => m.ticket ?? null)}
            nota="caixa da agenda ÷ atendimentos da agenda"
          />
          <CardNumero
            rotulo="R$ por hora de cadeira" icone={Clock3} cor={CORES.verde}
            valor={brlExato(atual.rsHora)}
            variacao={pct(atual.rsHora, anterior?.rsHora)}
            serie={meses.filter((m) => !m.emCurso).map((m) => m.rsHora ?? null)}
            nota={atual.rsHora == null ? "sem duração medida" : "só desde junho"}
          />
        </div>
      </section>

      {/* ── Faturamento mês a mês ──────────────────────────────────────────── */}
      {/*
        ⛔ DUAS LINHAS, E A DIFERENÇA ENTRE ELAS É INFORMAÇÃO.

        A vermelha é o faturamento OFICIAL; a cinza é o que a AGENDA registrou.
        `[medido 23/08]` a agenda subconta de **13% a 32%** conforme o mês — em
        junho, quase um terço da receita ⛔ não virou linha de agendamento.

        ⚠️ Mostrar só a agenda faria o dono ver menos do que ele fatura. Mostrar
        só o oficial esconderia que a agenda ⛔ não é confiável para dinheiro.
      */}
      <CardGrafico
        titulo="O dinheiro, mês a mês"
        subtitulo="vermelho = faturamento oficial · cinza = o que a agenda viu · tracejado = mês em curso"
        ferramentas={
          <>
            <BotaoFerramenta ativo>mês a mês</BotaoFerramenta>
            {/* ⚠️ Exporta o que ESTÁ na tela, com a janela no nome do arquivo —
                CSV sem período vira um arquivo que ninguém sabe de quando é. */}
            <BotaoFerramenta aoClicar={exportar}>
              <Download className="h-3.5 w-3.5" /> exportar
            </BotaoFerramenta>
          </>
        }
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={meses.map((m) => ({
            mes: rotulo(m.mes),
            fechado: m.emCurso ? null : (m.oficial?.total ?? null),
            curso: m.emCurso ? (m.oficial?.total ?? null) : null,
            agenda: m.emCurso ? null : m.caixa,
          }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#ffffff12" vertical={false} />
            <XAxis dataKey="mes" tick={{ fill: CINZA, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: CINZA, fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip {...TOOLTIP} formatter={(v: any) => brl(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12, color: CINZA }} />
            <Line isAnimationActive={false} type="monotone" dataKey="fechado" name="faturamento oficial" stroke={VERMELHO}
              strokeWidth={2.5} dot={{ r: 3, fill: VERMELHO }} connectNulls />
            <Line isAnimationActive={false} type="monotone" dataKey="agenda" name="o que a agenda viu" stroke={CINZA}
              strokeWidth={1.5} dot={false} connectNulls />
            <Line isAnimationActive={false} type="monotone" dataKey="curso" name="em curso (parcial)" stroke={VERMELHO_CLARO}
              strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: VERMELHO_CLARO }} />
          </LineChart>
        </ResponsiveContainer>
      </CardGrafico>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Cliente novo × recorrente ────────────────────────────────────── */}
        <CardGrafico
          titulo="Quem veio: novo × recorrente"
          subtitulo={`${rotulo(meses[0]?.mes ?? "")} fica de fora — é o primeiro mês da base, e ali todo mundo é "novo"`}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={meses.filter((m) => !m.novoInflado).map((m) => ({
              mes: rotulo(m.mes), novos: m.novos, recorrentes: m.recorrentes, emCurso: m.emCurso,
            }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#ffffff12" vertical={false} />
              <XAxis dataKey="mes" tick={{ fill: CINZA, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: CINZA, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 12, color: CINZA }} />
              <Bar isAnimationActive={false} dataKey="recorrentes" name="voltaram" stackId="a" fill={VERMELHO} radius={[0, 0, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="novos" name="primeira vez" stackId="a" fill="#F87171" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardGrafico>

        {/* ── Mix de serviço ───────────────────────────────────────────────── */}
        <CardGrafico
          titulo={`O que a casa vende — ${rotulo(data.mix?.mes ?? "")}`}
          subtitulo={data.mix?.outros ? `a cauda está agrupada, com a contagem à vista` : "todos os serviços cabem no gráfico"}
        >
          <div className="flex items-center gap-4">
            {/*
              ⚠️ `width="55%"` VOLTOU, e a razão está registrada: em 23/08 eu
              troquei por um invólucro de tamanho fixo achando que estava
              consertando — e QUEBREI este donut, que funcionava. O defeito real
              estava n'A Mesa, num card mais estreito, e eu "corrigi" os dois.
              ⛔ Conserto sem reproduzir o defeito no lugar certo é palpite.
            */}
            <ResponsiveContainer width="55%" height={240}>
              <PieChart>
                <Pie
                  data={[...(data.mix?.fatias ?? []), ...(data.mix?.outros ? [data.mix.outros] : [])]}
                  dataKey="receita" nameKey="nome" innerRadius={52} outerRadius={92} paddingAngle={2}
                >
                  {[...(data.mix?.fatias ?? []), ...(data.mix?.outros ? [data.mix.outros] : [])]
                    .map((_: any, i: number) => <Cell key={i} fill={PALETA[i % PALETA.length]} stroke="#0E0000" />)}
                </Pie>
                <Tooltip {...TOOLTIP} formatter={(v: any) => brl(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-1.5 text-sm">
              {[...(data.mix?.fatias ?? []), ...(data.mix?.outros ? [data.mix.outros] : [])]
                .map((f: any, i: number) => (
                  <li key={f.nome} className="flex items-baseline gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: PALETA[i % PALETA.length] }} />
                    <span className="min-w-0 flex-1 truncate text-slate-300">{f.nome}</span>
                    <span className="tabular-nums text-slate-500">{f.qtd}×</span>
                    <span className="tabular-nums text-white">{brl(f.receita)}</span>
                  </li>
                ))}
            </ul>
          </div>
        </CardGrafico>
      </div>

      {/* ── Ocupação por profissional ──────────────────────────────────────── */}
      <CardGrafico
        titulo={`A hora de cadeira, por profissional — ${rotulo(data.ocupacao?.mes ?? "")}`}
        subtitulo="quem trabalhou menos de 10h no mês fica fora: R$/hora de duas horas não descreve nada"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-white/10">
                <th className="py-2 text-left font-medium">Profissional</th>
                <th className="py-2 text-right font-medium">Horas</th>
                <th className="py-2 text-right font-medium">Produção</th>
                <th className="py-2 text-right font-medium">R$ / hora</th>
                <th className="py-2 pl-4 text-left font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {(data.ocupacao?.linhas ?? []).map((l: any) => {
                const teto = Math.max(...(data.ocupacao?.linhas ?? []).map((x: any) => x.rsHora), 1);
                return (
                  <tr key={l.nome} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-slate-200">{l.nome}</td>
                    <td className="py-2 text-right tabular-nums text-slate-400">{num(l.horas)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-300">{brl(l.producao)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-white">
                      {brlExato(l.rsHora)}
                    </td>
                    <td className="w-40 py-2 pl-4">
                      <div className="h-2 w-full rounded-full bg-white/5">
                        <div className="h-2 rounded-full"
                          style={{ width: `${(l.rsHora / teto) * 100}%`, background: VERMELHO }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardGrafico>

      {/* ── ⛔ OS AVISOS. TODOS. SEM "VER MAIS". ────────────────────────────── */}
      {/* ⛔ TODOS os avisos, sem "ver mais". A peça garante isso. */}
      <Avisos itens={data.avisos ?? []} />
    </div>
  );
}

/*
 * ⛔ O `Bloco` LOCAL MORREU AQUI. Virou `CardGrafico`, que já traz a barra de
 * ferramentas — o item das referências que faltava em todas as minhas telas.
 */

/*
 * ⛔ O `Kpi` LOCAL MORREU AQUI (23/08/2026). Ele virou `CardNumero` em
 * `components/painel.tsx`, junto com o card de gráfico, o chip e a tabela.
 *
 * ⚠️ Ele era a razão de as cinco abas nunca ficarem iguais: estilo aplicado à
 * mão, tela por tela, é a mesma regra escrita cinco vezes — e diverge exatamente
 * como diverge regra de negócio duplicada. Quatro tentativas de "aplicar o
 * padrão" falharam por isso, ⛔ não por gosto.
 */
