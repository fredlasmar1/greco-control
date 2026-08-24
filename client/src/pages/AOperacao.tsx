/**
 * A OPERAÇÃO — o que se vende, quem executa, quem paga.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ AS TRÊS LENTES SÃO UMA TELA SÓ, E ISSO É DE PROPÓSITO
 *
 * `[24/08/2026]` o dono pediu categoria, barbeiro e cliente. São três recortes da
 * MESMA agenda, na MESMA janela — em três telas, cada uma escolheria seu período
 * e ele veria três totais para o mesmo ano.
 *
 * ⛔ E ⛔ NADA aqui é calculado. Tudo chega pronto de `/api/mesa/raio-x`, que é
 * proxy do Greco Metas. Se um número estiver errado, o conserto é lá.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ O CARIMBO QUE ⛔ NÃO PODE SUMIR DESTA TELA
 *
 * Os valores saem da AGENDA, que subconta o faturamento oficial em 13–32%. São
 * PISO, ⛔ não caixa. O aviso vem no próprio retorno (`raioX.piso`) em vez de ser
 * escrito aqui — texto escrito na tela alguém apaga sem perceber que apagou uma
 * garantia; dado que chega junto do número ⛔ não se separa dele.
 *
 * ⚠️ O que É confiável é a PROPORÇÃO: o VIP render o dobro do Clássico por hora
 * ⛔ não depende de a agenda ser completa. Por isso a coluna R$/hora é a que a
 * tela destaca, e ⛔ não o valor absoluto.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, Clock, Crown, Loader2, Scissors, Users } from "lucide-react";
import {
  Avisos, CardGrafico, CardNumero, Chip, CORES, NaoAbriu, Tabela, TOOLTIP,
} from "@/components/painel";

const API = (globalThis as any).__API_BASE__ || "";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** ⛔ `null` ⛔ nunca vira "R$ 0". Ausência de medida é ausência, ⛔ não zero. */
const brlOuTraco = (n: number | null | undefined) => (n == null ? "—" : brl(n));

/** Cor fixa por categoria: a mesma barra tem a mesma cor em todo lugar da tela. */
const COR_CAT: Record<string, string> = {
  VIP: CORES.marca,
  CLASSICO: CORES.azul,
  EXPRESS: CORES.ambar,
  ESTETICA: CORES.roxo,
  MASSAGEM: CORES.verde,
};
const corDaCategoria = (c: string) => COR_CAT[c] ?? CORES.cinza;

type Lente = "categorias" | "barbeiros" | "clientes";

export default function AOperacao() {
  const [lente, setLente] = useState<Lente>("categorias");

  const q = useQuery({
    queryKey: ["raio-x"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/mesa/raio-x`);
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "o Greco Metas não respondeu");
      return j.raioX as any;
    },
  });

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> medindo o ano inteiro de agenda…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="p-4 md:p-6">
        <NaoAbriu titulo="A operação" motivo={String((q.error as Error)?.message || "")} />
      </div>
    );
  }

  const d = q.data;
  const cats: any[] = d.categorias?.linhas ?? [];
  const barbs: any[] = d.barbeiros?.linhas ?? [];
  const clis: any[] = d.clientes?.linhas ?? [];

  // ⛔ O TOPO DA CASA vem da lista JÁ ORDENADA pelo servidor. Reordenar aqui
  //    seria a tela decidindo o critério — e o critério é regra de negócio.
  const maiorBarbeiro = barbs[0];

  // ⚠️ Só categorias COM hora medida entram na comparação de R$/hora. Misturar
  //    quem ⛔ não tem duração puxaria a régua para baixo sem ninguém ver.
  const comHora = cats.filter((c) => c.rsHora != null);
  const melhorHora = comHora[0]
    ? comHora.reduce((a, b) => (b.rsHora > a.rsHora ? b : a))
    : null;

  const avisos: string[] = [d.piso];
  if (d.clientes?.fora > 0) {
    avisos.push(
      `A lista de clientes mostra ${clis.length} de ${d.clientes.total} — ` +
        (d.clientes.motivos ?? []).map((m: any) => `${m.n} ${m.motivo}`).join(", ") + ".",
    );
  }
  const semHora = cats.filter((c) => c.rsHora == null);
  if (semHora.length) {
    avisos.push(
      `${semHora.map((c: any) => c.categoria).join(", ")} ⛔ não tem duração medida na agenda — ` +
        "sem hora de cadeira ⛔ não dá para dizer quanto rende por hora.",
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Greco Control · a operação
        </p>
        <h1 className="font-display text-2xl font-black uppercase tracking-tight text-white md:text-3xl">
          O que se vende, quem executa, quem paga
        </h1>
        <p className="text-sm text-slate-400">{d.janela?.rotulo}</p>
      </header>

      {/*
        ⚠️ NOME DUPLICADO É DADO SUJO, E ELE APARECE — ⛔ não fica só consertado
        por baixo. A régua junta as grafias para o ranking ⛔ não mentir, mas quem
        corrige a Trinks é o dono, e ele só corrige o que enxerga.
      */}
      {(d.nomesDuplicados?.length ?? 0) > 0 && (
        <section className="rounded-[18px] border border-amber-500/30 bg-amber-500/[0.06] p-5">
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> Mesmo profissional cadastrado com duas grafias
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-100/80">
            {d.nomesDuplicados.map((n: any) => (
              <li key={n.nome}>
                {n.grafias.join("  ·  ")} — juntados aqui, separados na Trinks
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            ⛔ O ranking abaixo já os trata como uma pessoa. Sem isso, cada um apareceria duas vezes,
            com metade do número — e metade ⛔ não chama atenção como um erro chamaria.
          </p>
        </section>
      )}

      {/*
        ⛔ QUEM ATENDE E ⛔ NÃO TEM PAPEL CADASTRADO — e isto é DINHEIRO, ⛔ não
        cosmético. A apuração de comissão usa a taxa OU zero: sem cadastro, a
        comissão sai ZERO e ⛔ nada avisa. A produção aparece certa na folha e a
        comissão, errada — que é o pior formato possível de defeito, porque a
        linha existe e parece conferida.
      */}
      {(d.semPapel?.length ?? 0) > 0 && (
        <section className="rounded-[18px] border border-red-500/40 bg-red-500/[0.07] p-5">
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Atende e ⛔ não tem comissão cadastrada
          </p>
          <ul className="mt-2 space-y-1 text-sm text-red-100/85">
            {d.semPapel.map((p: any) => (
              <li key={p.nome} className="flex flex-wrap justify-between gap-2">
                <span>{p.nome}</span>
                <span className="tabular-nums text-red-200/70">
                  {p.atend} atendimentos · {brl(p.producao)} de produção
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            ⛔ Sem cadastro de comissão, a apuração calcula <strong>zero</strong> — e ⛔ não avisa.
            Cadastrar o papel e a taxa resolve.
          </p>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CardNumero
          rotulo="Caixa na agenda (piso)"
          valor={brl(d.caixaJanela)}
          icone={Scissors}
          nota="⛔ ⛔ não é o faturamento oficial"
        />
        <CardNumero
          rotulo="Rende mais por hora"
          valor={melhorHora ? melhorHora.categoria : "—"}
          icone={Clock}
          cor={melhorHora ? corDaCategoria(melhorHora.categoria) : CORES.cinza}
          nota={melhorHora ? `${brl(melhorHora.rsHora)} por hora de cadeira` : "sem duração medida"}
          destaque
        />
        <CardNumero
          rotulo="Maior cadeira da casa"
          valor={maiorBarbeiro ? `${maiorBarbeiro.pctDaCasa}%` : "—"}
          icone={Crown}
          cor={CORES.ambar}
          nota={
            maiorBarbeiro
              ? `${maiorBarbeiro.nome.split(" ")[0]} (${maiorBarbeiro.papel ?? "sem cadastro"}) — ${brl(maiorBarbeiro.caixa)}`
              : ""
          }
        />
        <CardNumero
          rotulo="Clientes que vieram"
          valor={String(d.clientes?.total ?? 0)}
          icone={Users}
          cor={CORES.azul}
          nota="com ficha, no ano"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ["categorias", "O que se vende"],
          ["barbeiros", "Quem executa"],
          ["clientes", "Quem paga"],
        ] as [Lente, string][]).map(([k, rotulo]) => (
          <button
            key={k}
            onClick={() => setLente(k)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
              lente === k
                ? "border-[#A50101]/50 bg-[#A50101]/15 text-[#E23B2E]"
                : "border-white/10 text-slate-400 hover:border-white/25"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {lente === "categorias" && (
        <>
          <CardGrafico
            titulo="Quanto cada categoria paga pela hora de cadeira"
            subtitulo={
              `${d.janela?.rotulo}. ⛔ Só atendimentos COM duração medida entram — numerador e ` +
              "denominador da mesma população, senão a régua infla."
            }
          >
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comHora} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff12" vertical={false} />
                  <XAxis dataKey="categoria" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `R$${v}`} />
                  <Tooltip {...TOOLTIP} formatter={(v: any) => [`${brl(Number(v))}/hora`, "rende"]} />
                  <Bar dataKey="rsHora" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {comHora.map((c) => (
                      <Cell key={c.categoria} fill={corDaCategoria(c.categoria)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardGrafico>

          <CardGrafico titulo="A tabela inteira" subtitulo="ticket é a média de QUEM PAGOU — Clube (valor zero) fora, senão o ticket afunda sozinho">
            <Tabela
              colunas={[
                { nome: "categoria" }, { nome: "atend", alinha: "dir" }, { nome: "caixa (piso)", alinha: "dir" },
                { nome: "ticket", alinha: "dir" }, { nome: "R$/hora", alinha: "dir" },
                { nome: "sem valor", alinha: "dir" }, { nome: "1º mês → último", alinha: "dir" },
              ]}
              minLargura={760}
            >
              {cats.map((c) => (
                <tr key={c.categoria} className="border-b border-white/5">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: corDaCategoria(c.categoria) }} />
                      {c.categoria}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{c.atend}</td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{brl(c.caixa)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{brlOuTraco(c.ticketPagante)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-white">
                    {brlOuTraco(c.rsHora)}
                    {c.rsHora != null && (
                      <span className="ml-1 text-[10px] font-normal text-slate-500">({c.atendComDuracao})</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">{c.semValor}</td>
                  <td className="py-2 text-right tabular-nums text-slate-400">
                    {brl(c.primeiroMes)} → {brl(c.ultimoMes)}
                  </td>
                </tr>
              ))}
            </Tabela>
          </CardGrafico>
        </>
      )}

      {lente === "barbeiros" && (
        <CardGrafico
          titulo="Como cada cadeira andou no ano"
          subtitulo={
            "atendimentos e ticket no PRIMEIRO e no ÚLTIMO mês fechado. " +
            "⚠️ A lista é de TODO MUNDO QUE ATENDEU — barbeiro, assistente e recepção. " +
            "⛔ Comparar assistente com barbeiro pelo caixa é comparar papéis diferentes: " +
            "o papel está na coluna ao lado. Grafias do mesmo nome já vêm juntas."
          }
        >
          <Tabela
            colunas={[
              { nome: "profissional" }, { nome: "papel" }, { nome: "atend", alinha: "dir" }, { nome: "caixa (piso)", alinha: "dir" },
              { nome: "% da casa", alinha: "dir" }, { nome: "atend 1º → últ.", alinha: "dir" },
              { nome: "ticket 1º → últ.", alinha: "dir" },
            ]}
            minLargura={760}
          >
            {barbs.map((b) => {
              // ⛔ Só chama de subida/queda quando HÁ os dois lados. Comparar
              //    contra um mês em que a pessoa ⛔ não trabalhou inventaria uma
              //    variação de −100% para quem foi contratada em março.
              const temDois = b.atendPrimeiroMes > 0 && b.atendUltimoMes > 0;
              const subiu = temDois && b.atendUltimoMes > b.atendPrimeiroMes;
              const caiu = temDois && b.atendUltimoMes < b.atendPrimeiroMes;
              const tkTemDois = b.ticketPrimeiroMes != null && b.ticketUltimoMes != null;
              return (
                <tr key={b.nome} className="border-b border-white/5">
                  <td className="py-2 text-slate-200">
                    {b.nome}
                    {b.grafias > 1 && (
                      <span className="ml-2 text-[10px] text-amber-400/70">{b.grafias} grafias</span>
                    )}
                  </td>
                  {/* ⛔ SEM PAPEL ⛔ NÃO VIRA CÉLULA VAZIA. Vazio lê-se como "ainda
                      ⛔ não carregou"; o que há é cadastro faltando, e ele custa
                      a comissão da pessoa. */}
                  <td className="py-2">
                    {b.papel ? (
                      <Chip tom={b.papel === "barbeiro" ? "marca" : "neutro"}>
                        {b.papel}{b.taxa != null ? ` ${b.taxa}%` : ""}
                      </Chip>
                    ) : (
                      <Chip tom="ruim">sem cadastro</Chip>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{b.atend}</td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{brl(b.caixa)}</td>
                  <td className="py-2 text-right tabular-nums">
                    <Chip tom={b.pctDaCasa >= 25 ? "atencao" : "neutro"}>{b.pctDaCasa}%</Chip>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <span className={subiu ? "text-emerald-400" : caiu ? "text-red-400" : "text-slate-400"}>
                      {b.atendPrimeiroMes} → {b.atendUltimoMes}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-400">
                    {tkTemDois
                      ? `${brl(b.ticketPrimeiroMes)} → ${brl(b.ticketUltimoMes)}`
                      : "sem os dois meses"}
                  </td>
                </tr>
              );
            })}
          </Tabela>
        </CardGrafico>
      )}

      {lente === "clientes" && (
        <CardGrafico
          titulo="Quem mais gasta na casa"
          subtitulo={
            "visita é DIA distinto, ⛔ não linha de serviço — cabelo e barba no mesmo dia é UMA visita. " +
            "⚠️ Assinante do Clube gasta na agenda o que ⛔ não paga no balcão."
          }
        >
          <Tabela
            colunas={[
              { nome: "#", alinha: "dir" }, { nome: "cliente" }, { nome: "visitas", alinha: "dir" },
              { nome: "gastou (piso)", alinha: "dir" }, { nome: "por visita", alinha: "dir" },
              { nome: "última vinda", alinha: "dir" },
            ]}
            minLargura={720}
          >
            {clis.map((c, i) => (
              <tr key={c.id} className="border-b border-white/5">
                <td className="py-2 text-right tabular-nums text-slate-600">{i + 1}</td>
                <td className="py-2 text-slate-200">
                  {c.nome}
                  {c.clube && <span className="ml-2"><Chip tom="marca">clube</Chip></span>}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-300">{c.visitas}</td>
                <td className="py-2 text-right tabular-nums font-semibold text-white">{brl(c.gastou)}</td>
                <td className="py-2 text-right tabular-nums text-slate-300">{brlOuTraco(c.porVisita)}</td>
                <td className="py-2 text-right tabular-nums text-slate-500">
                  {c.ultimaVinda
                    ? new Date(c.ultimaVinda + "T12:00:00").toLocaleDateString("pt-BR")
                    : "—"}
                </td>
              </tr>
            ))}
          </Tabela>
        </CardGrafico>
      )}

      <Avisos itens={avisos} />
    </div>
  );
}
