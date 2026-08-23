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
import { AlertTriangle, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";

const API = (globalThis as any).__API_BASE__ || "";

/** Marca da casa. ⛔ Vermelho é a cor do DADO PRINCIPAL, não de erro. */
const VERMELHO = "#A50101";
const VERMELHO_CLARO = "#E23B2E";
const CINZA = "#6B7280";
const PALETA = [VERMELHO, "#E23B2E", "#F87171", "#FCA5A5", "#9CA3AF", "#6B7280", "#374151"];

const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlExato = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const num = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

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

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> medindo oito meses…
      </div>
    );
  }
  if (error || !atual) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400" />
          <div>
            <p className="font-semibold text-white">O Painel não abriu</p>
            <p className="mt-1 text-sm text-slate-400">
              {(error as any)?.message || "o Greco Metas não respondeu"}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              ⛔ Nada foi estimado. Painel mostrando zero porque a ponte caiu leva à decisão errada
              com cara de número apurado.
            </p>
          </div>
        </div>
      </div>
    );
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
          <Kpi rotulo="Faturamento oficial" valor={brl(atual.oficial?.total)}
            atual={atual.oficial?.total ?? null} anterior={anterior?.oficial?.total ?? null}
            serie={meses} extrair={(m) => m.oficial?.total ?? null}
            nota="Gmail + API + CSV" destaque />
          <Kpi rotulo="Clientes atendidos" valor={num(atual.clientes)}
            atual={atual.clientes} anterior={anterior?.clientes}
            serie={meses} campo="clientes" />
          <Kpi rotulo="Atendimentos" valor={num(atual.atendimentos)}
            atual={atual.atendimentos} anterior={anterior?.atendimentos}
            serie={meses} campo="atendimentos" />
          <Kpi rotulo="Ticket médio" valor={brlExato(atual.ticket)}
            atual={atual.ticket} anterior={anterior?.ticket}
            serie={meses} campo="ticket" />
          <Kpi rotulo="R$ por hora de cadeira" valor={brlExato(atual.rsHora)}
            atual={atual.rsHora} anterior={anterior?.rsHora}
            serie={meses} campo="rsHora"
            nota={atual.rsHora == null ? "sem duração medida neste mês" : undefined} />
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
      <Bloco
        titulo="O dinheiro, mês a mês"
        sub="vermelho = faturamento oficial · cinza = o que a agenda viu · tracejado = mês em curso"
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
            <Tooltip {...tooltip} formatter={(v: any) => brl(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12, color: CINZA }} />
            <Line type="monotone" dataKey="fechado" name="faturamento oficial" stroke={VERMELHO}
              strokeWidth={2.5} dot={{ r: 3, fill: VERMELHO }} connectNulls />
            <Line type="monotone" dataKey="agenda" name="o que a agenda viu" stroke={CINZA}
              strokeWidth={1.5} dot={false} connectNulls />
            <Line type="monotone" dataKey="curso" name="em curso (parcial)" stroke={VERMELHO_CLARO}
              strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: VERMELHO_CLARO }} />
          </LineChart>
        </ResponsiveContainer>
      </Bloco>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Cliente novo × recorrente ────────────────────────────────────── */}
        <Bloco
          titulo="Quem veio: novo × recorrente"
          sub={`${rotulo(meses[0]?.mes ?? "")} fica de fora — é o primeiro mês da base, e ali todo mundo é "novo"`}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={meses.filter((m) => !m.novoInflado).map((m) => ({
              mes: rotulo(m.mes), novos: m.novos, recorrentes: m.recorrentes, emCurso: m.emCurso,
            }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#ffffff12" vertical={false} />
              <XAxis dataKey="mes" tick={{ fill: CINZA, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: CINZA, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 12, color: CINZA }} />
              <Bar dataKey="recorrentes" name="voltaram" stackId="a" fill={VERMELHO} radius={[0, 0, 0, 0]} />
              <Bar dataKey="novos" name="primeira vez" stackId="a" fill="#F87171" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Bloco>

        {/* ── Mix de serviço ───────────────────────────────────────────────── */}
        <Bloco
          titulo={`O que a casa vende — ${rotulo(data.mix?.mes ?? "")}`}
          sub={data.mix?.outros ? `a cauda está agrupada, com a contagem à vista` : "todos os serviços cabem no gráfico"}
        >
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="55%" height={240}>
              <PieChart>
                <Pie
                  data={[...(data.mix?.fatias ?? []), ...(data.mix?.outros ? [data.mix.outros] : [])]}
                  dataKey="receita" nameKey="nome" innerRadius={52} outerRadius={92} paddingAngle={2}
                >
                  {[...(data.mix?.fatias ?? []), ...(data.mix?.outros ? [data.mix.outros] : [])]
                    .map((_: any, i: number) => <Cell key={i} fill={PALETA[i % PALETA.length]} stroke="#0E0000" />)}
                </Pie>
                <Tooltip {...tooltip} formatter={(v: any) => brl(Number(v))} />
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
        </Bloco>
      </div>

      {/* ── Ocupação por profissional ──────────────────────────────────────── */}
      <Bloco
        titulo={`A hora de cadeira, por profissional — ${rotulo(data.ocupacao?.mes ?? "")}`}
        sub="quem trabalhou menos de 10h no mês fica fora: R$/hora de duas horas não descreve nada"
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
      </Bloco>

      {/* ── ⛔ OS AVISOS. TODOS. SEM "VER MAIS". ────────────────────────────── */}
      {(data.avisos ?? []).length > 0 && (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] p-5">
          <p className="text-[11px] uppercase tracking-wide text-amber-300/80">
            O que estes números ⛔ não dizem
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-amber-100/80">
            {(data.avisos ?? []).map((a: string, i: number) => (
              <li key={i} className="flex gap-2"><span className="text-amber-400">·</span>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const tooltip = {
  contentStyle: {
    background: "#141416", border: "1px solid #ffffff1f", borderRadius: 12,
    color: "#E5E7EB", fontSize: 12,
  },
  labelStyle: { color: "#9CA3AF" },
  cursor: { fill: "#ffffff08" },
} as const;

function Bloco({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="font-display text-lg font-black uppercase tracking-tight text-white">{titulo}</h2>
      {sub && <p className="mb-3 mt-0.5 text-xs text-slate-500">{sub}</p>}
      {children}
    </section>
  );
}

/**
 * Cartão de número com variação e sparkline.
 *
 * ⛔ A variação é `null` quando falta qualquer um dos dois lados — e aí a tela
 * diz "sem base", ⛔ nunca 0%. Zero por cento é uma afirmação: significa "ficou
 * igual", e ficar igual é diferente de não saber.
 */
function Kpi({ rotulo: r, valor, atual, anterior, serie, campo, extrair, nota, destaque }: {
  rotulo: string; valor: string;
  atual: number | null; anterior: number | null | undefined;
  serie: any[]; campo?: string;
  /** Para números que moram aninhados, como `oficial.total`. */
  extrair?: (m: any) => number | null;
  nota?: string; destaque?: boolean;
}) {
  const varia =
    atual == null || anterior == null || anterior === 0
      ? null
      : Math.round(((atual - anterior) / anterior) * 1000) / 10;

  // ⛔ A sparkline só usa mês FECHADO e só ponto MEDIDO. Interpolar o buraco de
  //    R$/hora de jan–mai desenharia uma linha que nunca existiu.
  const ler = extrair ?? ((m: any) => (campo ? m[campo] : null));
  const pontos = serie
    .filter((m) => !m.emCurso && ler(m) != null)
    .map((m) => ({ v: ler(m) }));

  const Icone = varia == null ? Minus : varia >= 0 ? TrendingUp : TrendingDown;
  const cor = varia == null ? "text-slate-500" : varia >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className={`rounded-2xl border p-4 ${destaque ? "border-[#A50101]/40 bg-[#A50101]/[0.07]" : "border-white/10 bg-white/[0.03]"}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{r}</p>
      <p className={`mt-1 font-display text-2xl font-black ${destaque ? "text-[#E23B2E]" : "text-white"}`}>{valor}</p>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1 text-xs ${cor}`}>
          <Icone className="h-3 w-3" />
          {varia == null ? "sem base p/ comparar" : `${varia > 0 ? "+" : ""}${varia.toLocaleString("pt-BR")}% vs mês anterior`}
        </span>
        {pontos.length >= 2 && (
          <div className="h-7 w-20">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pontos}>
                <Line type="monotone" dataKey="v" stroke={VERMELHO_CLARO} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {nota && <p className="mt-1 text-[11px] text-amber-300/70">{nota}</p>}
    </div>
  );
}
