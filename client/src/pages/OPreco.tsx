/**
 * O PREÇO — a régua de R$/hora de cadeira e o simulador do reajuste de 01/12/2026.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ ESTA TELA NÃO CALCULA NADA. NEM UMA MULTIPLICAÇÃO.
 *
 * Ela manda os preços que o dono digitou para `/api/mesa/precos`, que repassa ao
 * Greco Metas, e desenha o que voltar. Todo `ganho`, `R$/hora`, `margem do
 * Clube` e `mensalidade sugerida` vem pronto de `shared/simuladorPreco.ts`, que
 * tem 93 travas lá.
 *
 * ⚠️ Copiar aquela conta para cá seria a versão 2026 do defeito que matou 23 das
 * 24 telas antigas: a mesma regra escrita nos dois lados, divergindo em
 * silêncio. E ninguém compara dois arquivos iguais até eles pararem de ser
 * iguais.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ELA NASCEU AQUI, E NÃO NO METAS
 *
 * `[22/08/2026]` ela foi construída no Metas primeiro, e o dono não a encontrou
 * — porque a sala dele é o Control. Existiam DUAS Diretorias com as mesmas abas,
 * e cada coisa nova caía numa só. A regra que resolve: **o que é do dono mora no
 * Control; o que é número mora no Metas e sai pela ponte.**
 *
 * ⚠️ O debounce existe por isso: como a conta roda do outro lado, cada tecla
 * seria uma ida e volta. 500 ms é o que separa "digitar" de "perguntar".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Loader2, Target, Eraser } from "lucide-react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
} from "recharts";
import { CardGrafico, CORES, TOOLTIP, Chip } from "@/components/painel";

const API = (globalThis as any).__API_BASE__ || "";

const brl = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const nBR = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/**
 * A frase do recorte. ⛔ Cópia consciente e MÍNIMA de `shared/recorte.ts` do
 * Metas: são cinco linhas de formatação de texto, sem uma decisão de negócio
 * dentro. O que ⛔ não se copia é conta — e aqui não há nenhuma.
 */
function fraseRecorte(r: any, oQue = "linhas"): string {
  if (!r || !r.fora) return "";
  const n = (x: number) => x.toLocaleString("pt-BR");
  if (!r.motivos?.length) return `${n(r.total)} ${oQue} · ${n(r.fora)} fora — motivo não declarado`;
  return `${n(r.total)} ${oQue} · ${n(r.fora)} fora (${r.motivos.map((m: any) => `${n(m.n)} ${m.motivo}`).join(", ")})`;
}

export default function OPreco() {
  /** O que o dono digitou. É o ÚNICO estado que esta tela possui. */
  const [novos, setNovos] = useState<Record<string, number>>({});
  /** A cópia que já foi perguntada ao Metas — atrasada pelo debounce. */
  const [enviados, setEnviados] = useState<Record<string, number>>({});
  const [alvo, setAlvo] = useState<number | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setEnviados(novos), 500);
    return () => clearTimeout(timer.current);
  }, [novos]);

  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ["precos", enviados],
    queryFn: async () => {
      const r = await fetch(`${API}/api/mesa/precos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novos: enviados }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "não consegui ler os preços");
      return j;
    },
    refetchOnWindowFocus: false,
    placeholderData: (anterior: any) => anterior,
  });

  const casa = data?.casa;
  const sim = data?.simulacao;
  const linhas: any[] = sim?.linhas ?? [];

  /**
   * ⛔ Ordena por pagantes/mês — quem decide o mês é volume, não preço. O
   * critério é o mesmo do Metas (`porImpacto`), e é ORDENAÇÃO, não conta.
   */
  const ordenadas = useMemo(
    () => [...linhas].sort((a, b) => (b.pagantesMes ?? 0) - (a.pagantesMes ?? 0)),
    [linhas],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> medindo…
      </div>
    );
  }
  if (error || !casa || !sim) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 pt-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
          <div>
            <p className="font-semibold">O Preço não abriu</p>
            <p className="text-sm text-muted-foreground">
              {(error as any)?.message || "o Greco Metas não respondeu"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              ⛔ Nada foi estimado. Uma tela de decisão mostrando R$ 0,00 porque a ponte caiu leva à
              decisão errada com cara de número apurado.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  /**
   * ⛔ MONTAGEM, ⛔ NÃO CÁLCULO. `rsHoraAtual` e `pagantesMes` vêm prontos do
   * servidor; a tela só decide o eixo de cada bolha e a cor.
   *
   * ⚠️ Serviço sem preço ou sem duração ⛔ NÃO entra: ele ⛔ não tem R$/hora, e pôr
   * no zero do eixo diria que rende nada — que é uma afirmação, e é falsa.
   */
  const pontos = linhas
    .filter((l: any) => l.rsHoraAtual != null && l.pagantesMes > 0)
    .map((l: any) => ({
      nome: l.nome,
      x: l.rsHoraAtual,
      y: l.pagantesMes,
      z: l.pagantesMes,
      preco: l.precoTabela,
      abaixo: l.acimaDaCasa === false,
    }));
  const abaixoDaLinha = pontos.filter((p) => p.abaixo).length;

  const alvoEfetivo = alvo ?? Math.round(casa.rsHoraTabela ?? 0);

  /** ⛔ SÓ SOBE. Quem já rende acima do alvo fica onde está. */
  const puxarParaOAlvo = () => {
    const m: Record<string, number> = {};
    for (const l of linhas) {
      if (l.precoTabela == null || l.duracaoMin == null || l.duracaoMin <= 0) continue;
      const p = Math.ceil((alvoEfetivo * l.duracaoMin) / 60 / 5) * 5;
      if (p > l.precoTabela) m[l.nome] = p;
    }
    setNovos(m);
  };

  return (
    <div className="space-y-6">
      {/* ── A casa: TRÊS réguas, e a tela diz qual é qual ───────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">A hora de cadeira da casa</h2>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              medido em {casa.janela} · 3 meses fechados
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Campo
              rotulo="R$/h de tabela — o mix"
              valor={brl(casa.rsHoraTabela)}
              nota="a referência: o que a casa PEDE por hora"
              destaque
            />
            <Campo
              rotulo="R$/h realizado — só pagante"
              valor={brl(casa.rsHoraPagante)}
              nota="a distância é desconto + duração real"
            />
            <Campo
              rotulo="R$/h realizado — com o Clube"
              valor={brl(casa.rsHoraRealizado)}
              nota="as horas do assinante entram a R$ 0"
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Caixa de serviço / mês" valor={brl(casa.caixaMes)} />
            <Campo rotulo="Horas ocupadas / mês" valor={`${nBR(casa.horasMes)} h`} />
            <Campo rotulo="Assinantes do Clube" valor={String(casa.assinantes ?? "—")} />
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Preço isolado não decide nada: o que a casa vende é <b>hora de cadeira</b>. O mesmo R$ 60
            rende R$ 90/h num corte de 40 min e R$ 120/h numa barba de 30 min. A comparação abaixo é
            contra o <b>R$/h de tabela</b> — única régua na mesma unidade.
          </p>

          {/* ⛔ Recorte declarado. */}
          {casa.atendSemDuracao > 0 && (
            <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              ⚠️ {casa.atendSemDuracao.toLocaleString("pt-BR")} atendimentos da janela (
              {brl(casa.caixaSemDuracao)}) <b>não têm duração registrada</b> e ficam fora de todo
              R$/hora acima. Somar a receita deles sem as horas deles inflaria a régua — foi o defeito
              que pôs R$ 113,98/h nesta conta em 22/08.
            </p>
          )}

          {data.catalogoLidoEm && (
            <p className="mt-2 text-xs text-muted-foreground">
              Catálogo da Trinks lido em{" "}
              {new Date(data.catalogoLidoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── O simulador ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">
                O que subir
                {isFetching && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin opacity-60" />}
              </h2>
              <p className="text-sm text-muted-foreground">
                Ordenado por <b>pagantes por mês</b> — quem decide o mês é volume, não preço.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label className="text-muted-foreground">
                alvo R$/h
                <input
                  type="number"
                  value={alvoEfetivo}
                  onChange={(e) => setAlvo(Number(e.target.value) || null)}
                  className="ml-2 w-20 rounded-md border bg-background px-2 py-1 text-right tabular-nums"
                />
              </label>
              <button
                onClick={puxarParaOAlvo}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 hover:bg-primary/20"
              >
                <Target className="h-3.5 w-3.5" /> puxar para o alvo
              </button>
              {sim.alterados > 0 && (
                <button
                  onClick={() => setNovos({})}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Eraser className="h-3.5 w-3.5" /> limpar
                </button>
              )}
            </div>
          </div>

          {/*
            ⛔ O QUADRANTE — a decisão de 01/12 numa olhada.

            A tabela abaixo tem 27 linhas. Para achar "muito volume, pouco
            R$/hora" — que é EXATAMENTE o que se sobe — o dono precisava ler
            todas e comparar duas colunas de cabeça. Num plano, esse canto salta.

            ⚠️ EIXO X = R$/hora de TABELA, ⛔ nunca o realizado. O realizado
            carrega as horas do Clube a zero e absolveria todo serviço.
            ⚠️ EIXO Y = pagantes/mês, ⛔ não atendimentos: assinante ⛔ não responde
            a reajuste, e incluí-lo faria o volume parecer maior do que o que
            de fato reage ao preço.
          */}
          {pontos.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  cada bolha é um serviço · quanto mais à ESQUERDA, menos a cadeira rende ·
                  quanto mais ALTO, mais gente paga por ele
                </p>
                <Chip tom="atencao">{abaixoDaLinha} abaixo da linha da casa</Chip>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart margin={{ top: 10, right: 16, bottom: 4, left: -8 }}>
                  <CartesianGrid stroke="#ffffff10" />
                  <XAxis type="number" dataKey="x" name="R$/hora"
                    tick={{ fill: CORES.cinza, fontSize: 11 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${v}`} />
                  <YAxis type="number" dataKey="y" name="pagantes/mês"
                    tick={{ fill: CORES.cinza, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <ZAxis type="number" dataKey="z" range={[60, 520]} />
                  {/* ⛔ A LINHA DA CASA. É contra ela que se decide — sem a
                      referência, o gráfico vira uma nuvem sem veredito. */}
                  <ReferenceLine x={casa.rsHoraTabela} stroke={CORES.ambar} strokeDasharray="5 4"
                    label={{ value: `casa ${Math.round(casa.rsHoraTabela)}`, fill: CORES.ambar, fontSize: 11, position: "top" }} />
                  <Tooltip {...TOOLTIP}
                    formatter={(_v: any, _n: any, p: any) =>
                      [`${brl(p.payload.preco)} · ${p.payload.x} R$/h · ${nBR(p.payload.y)} pagantes/mês`, p.payload.nome]} />
                  <Scatter data={pontos} isAnimationActive={false}>
                    {pontos.map((p, i) => (
                      <Cell key={i} fill={p.abaixo ? CORES.marca : CORES.azul} fillOpacity={0.75} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Serviço</th>
                  <th className="py-2 text-right font-medium">Hoje</th>
                  <th className="py-2 text-right font-medium">Dur.</th>
                  <th className="py-2 text-right font-medium">R$/h</th>
                  <th className="py-2 text-right font-medium">Pagantes</th>
                  <th className="py-2 text-right font-medium">Clube</th>
                  <th className="py-2 text-right font-medium">Novo</th>
                  <th className="py-2 text-right font-medium">R$/h depois</th>
                  <th className="py-2 text-right font-medium">Ganho/mês</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((l) => (
                  <tr key={l.nome} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {l.nome}
                      {l.descontoPct != null && l.descontoPct >= 8 && (
                        <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                          balcão cobra {nBR(l.descontoPct)}% abaixo
                        </span>
                      )}
                      {l.descontoPct != null && l.descontoPct <= -5 && (
                        <span className="ml-2 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-600 dark:text-sky-300">
                          balcão já cobra {nBR(-l.descontoPct)}% acima
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {l.precoTabela != null ? brl(l.precoTabela) : <SemPreco />}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {l.duracaoMin != null ? `${l.duracaoMin}′` : "—"}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        l.acimaDaCasa === false ? "text-amber-600 dark:text-amber-400" : ""
                      }`}
                    >
                      {nBR(l.rsHoraAtual)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{nBR(l.pagantesMes)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {l.clubeMes > 0 ? nBR(l.clubeMes) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {l.semBase ? (
                        <span className="text-xs text-muted-foreground">sem base</span>
                      ) : (
                        <input
                          type="number"
                          step="5"
                          placeholder="—"
                          value={novos[l.nome] ?? ""}
                          onChange={(e) =>
                            setNovos((m) => {
                              const c = { ...m };
                              if (e.target.value === "") delete c[l.nome];
                              else c[l.nome] = Number(e.target.value);
                              return c;
                            })
                          }
                          className="w-20 rounded-md border bg-background px-2 py-1 text-right tabular-nums"
                        />
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{nBR(l.rsHoraNovo)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {l.ganhoMes > 0 ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {brl(l.ganhoMes)}
                        </span>
                      ) : l.ganhoMes < 0 ? (
                        <span className="text-red-500">{brl(l.ganhoMes)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fraseRecorte(data.servicos, "serviços") && (
            <p className="mt-3 text-xs text-muted-foreground">
              {fraseRecorte(data.servicos, "serviços")}
            </p>
          )}
          {sim.semBase > 0 && (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
              {sim.semBase} serviço(s) sem preço no catálogo da Trinks — aparecem na lista, mas ficam
              fora de toda soma. Sem preço de tabela não há aumento que se possa calcular.
            </p>
          )}
          {data.recusados?.length > 0 && (
            <p className="mt-1.5 text-xs text-red-500">
              {data.recusados.length} preço(s) recusado(s) por não serem número válido — não entraram
              na simulação.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── O resultado: caixa e margem do Clube, SEPARADOS ──────────────────── */}
      {sim.alterados > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-bold">O que este cenário faz</h2>
            <p className="text-sm text-muted-foreground">{sim.alterados} serviço(s) alterado(s).</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Entra no caixa
                </p>
                <p className="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {brl(sim.ganhoCaixaMes)}
                  <span className="ml-1 text-sm font-normal opacity-70">/mês</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{brl(sim.ganhoCaixaAno)} no ano</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Só os pagantes de balcão. Assinante do Clube entra a R$ 0 e não responde a reajuste.
                </p>
              </div>

              <div
                className={`rounded-xl border p-4 ${
                  sim.clubeMargemDepois < 0 ? "border-red-500/40 bg-red-500/[0.07]" : ""
                }`}
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Margem do Clube
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {brl(sim.clubeMargemAntes)} <span className="mx-1 opacity-50">→</span>
                  <span className={sim.clubeMargemDepois < 0 ? "text-red-500" : ""}>
                    {brl(sim.clubeMargemDepois)}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  o Clube consome {brl(sim.clubeExtraMes)}/mês a mais e continua pagando o mesmo
                </p>
                {sim.mensalidadeMediaParaManter != null && sim.clubeExtraMes > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    Para manter a margem de hoje, a mensalidade média precisa ir de{" "}
                    <b>{brl(sim.mensalidadeMediaHoje)}</b> para{" "}
                    <b>{brl(sim.mensalidadeMediaParaManter)}</b> — reajuste de{" "}
                    <b>{nBR(sim.reajusteClubePct)}%</b>, com aviso aos {casa.assinantes} assinantes.
                  </p>
                )}
              </div>
            </div>

            <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              ⚠️ Estes valores supõem <b>volume constante</b>. A casa tem 8 meses de histórico e o
              reajuste de agosto/2026 é jovem demais para medir reação — não há como apurar
              elasticidade. É a única suposição da tela; o resto é medido.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Campo({ rotulo, valor, nota, destaque }: {
  rotulo: string; valor: string; nota?: string; destaque?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={`mt-0.5 font-bold tabular-nums ${destaque ? "text-2xl text-primary" : "text-lg"}`}>
        {valor}
      </p>
      {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

/** ⛔ Preço ausente NÃO é R$ 0,00. Zero na tela é uma afirmação, e seria falsa. */
function SemPreco() {
  return <span className="text-xs text-muted-foreground">sem preço</span>;
}
