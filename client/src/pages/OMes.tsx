/**
 * O MÊS — o DRE e a régua de preços, lado a lado.
 *
 * Os dois juntos porque respondem a mesma pergunta em escalas diferentes: o DRE
 * diz se o mês fechou no azul; a régua diz de onde o azul veio ou por que não
 * veio. Em julho/2026 o resultado foi +R$ 12.664 e o serviço mais vendido da
 * casa rendia R$ 40,15 por hora contra um custo fixo de R$ 36,92 — o mês fechou
 * bem apesar do carro-chefe, não por causa dele. Uma tela só com o total nunca
 * mostraria isso.
 *
 * ⚠️ Este é o MÊS FECHADO, não o corrente. Mês andando engana: em 02/08 o
 * "mês atual" mostrava dois dias de movimento como se fossem trinta.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Loader2, TrendingDown, TrendingUp } from "lucide-react";

const API = (globalThis as any).__API_BASE__ || "";
const brl = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("pt-BR")}%`);

function mesesRecentes(qtd = 6): string[] {
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return Array.from({ length: qtd }, (_, i) => {
    const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

function Linha({ rotulo, valor, forte, nota }: { rotulo: string; valor: string; forte?: boolean; nota?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${forte ? "border-t pt-2.5" : ""}`}>
      <span className={forte ? "font-semibold" : "text-muted-foreground"}>
        {rotulo}
        {nota && <span className="ml-1.5 text-xs text-muted-foreground">{nota}</span>}
      </span>
      <span className={`tabular-nums ${forte ? "text-lg font-bold" : ""}`}>{valor}</span>
    </div>
  );
}

export default function OMes() {
  const meses = mesesRecentes();
  const [mes, setMes] = useState(meses[0]);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["mes", mes],
    queryFn: async () => {
      const r = await fetch(`${API}/api/mesa/mes/${mes}`);
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "não consegui ler o mês");
      return j;
    },
    refetchOnWindowFocus: false,
  });

  const f = data?.fechamento;
  const g = data?.regua;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Greco Control · o mês
          </p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Entrou, saiu, sobrou</h1>
        </div>
        <select
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          {meses.map((m) => (
            <option key={m} value={m}>
              {m.split("-").reverse().join("/")}
            </option>
          ))}
        </select>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> lendo o fechamento no Greco Metas…
        </div>
      )}

      {error && (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-1 p-6">
            <div className="flex items-center gap-2 font-semibold text-amber-500">
              <AlertTriangle className="h-4 w-4" /> Não consegui ler o mês
            </div>
            <p className="text-sm text-muted-foreground">{String((error as Error).message)}</p>
          </CardContent>
        </Card>
      )}

      {/* O que falta apurar aparece ANTES dos números, não num rodapé. Um mês
          incompleto exibido como completo é a família de erro mais cara aqui. */}
      {f && !f.completo && (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-2 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-500">
              <AlertTriangle className="h-4 w-4" /> Este mês ainda não está fechado
            </div>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {f.faltando.map((x: string, i: number) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Os números abaixo estão incompletos e vão melhorar quando isso for informado no Greco Metas.
            </p>
          </CardContent>
        </Card>
      )}

      {f && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-1 p-5 text-sm">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                O resultado
              </h2>
              <Linha rotulo="Receita que virou dinheiro" valor={brl(f.receita.total)} />
              <Linha
                rotulo="Produziu e não entrou"
                valor={brl(f.receita.naoEntrou.total)}
                nota="pacote consumido + cortesia"
              />
              <Linha rotulo="Comissão paga" valor={`− ${brl(f.custoVariavel.comissao)}`} />
              <Linha rotulo="Insumo e material" valor={`− ${brl(f.custoVariavel.compras)}`} />
              <Linha
                rotulo="Margem de contribuição"
                valor={`${brl(f.margemContribuicao.valor)} · ${pct(f.margemContribuicao.pct)}`}
                forte
              />
              <Linha rotulo="Folha fixa e encargos" valor={`− ${brl(f.custoFixo.folha + f.custoFixo.compras)}`} />
              <Linha rotulo="Custo do dinheiro" valor={`− ${brl(f.custoFixo.dinheiro)}`} nota="juros, tarifa, acordo" />
              <Linha rotulo="Resultado do mês" valor={brl(f.resultado)} forte />
              <div className="pt-2 text-xs text-muted-foreground">
                Obra e expansão: {brl(f.obra)} — fora do resultado de propósito. É capacidade sendo construída,
                não custo de operar. Com ela, o caixa do mês fechou em {brl(f.resultadoComObra)}.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5 text-sm">
              <div>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Quanto precisa vender
                </h2>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">{brl(f.pontoEquilibrio)}</span>
                  <span className="text-xs text-muted-foreground">para empatar</span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs">
                  {f.receita.total >= (f.pontoEquilibrio ?? 0) ? (
                    <>
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-emerald-500">
                        passou em {brl(f.receita.total - (f.pontoEquilibrio ?? 0))}
                      </span>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                      <span className="text-rose-500">
                        faltou {brl((f.pontoEquilibrio ?? 0) - f.receita.total)}
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="space-y-1 border-t pt-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  A folha, nas três linhas
                </h2>
                <Linha rotulo="A equipe ganhou" valor={brl(f.pessoal.bruto)} />
                <Linha rotulo="Devolveu" valor={`− ${brl(f.pessoal.devolvido)}`} nota="consumo, parcela, multa" />
                <Linha rotulo="Encargos de CLT" valor={brl(f.pessoal.encargos)} />
                <Linha rotulo="Saiu do caixa" valor={brl(f.pessoal.liquido)} forte />
                <p className="pt-1 text-xs text-muted-foreground">
                  O custo é o líquido. Quem devolve paga com coisa que a casa já comprou e que já está no custo
                  de compras — contar o bruto e as compras é contar a mesma pomada duas vezes.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {g && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  A hora de cadeira
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cada hora precisa deixar{" "}
                  <strong className="text-foreground tabular-nums">{brl(g.tabela.regua.linha)}</strong> só para
                  pagar o custo fixo. Abaixo disso, o atendimento ocupa a cadeira e não paga o aluguel dela.
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums">{pct(g.ocupacao.ocupacaoPct)}</p>
                <p className="text-xs text-muted-foreground">
                  ocupação — {g.ocupacao.horasOcupadas}h de {g.ocupacao.horasDisponiveis}h
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Abaixo da linha</p>
                <p className="text-xl font-bold tabular-nums">
                  {g.tabela.abaixoDaLinha}
                  <span className="text-sm font-normal text-muted-foreground"> de {g.tabela.itens.length}</span>
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Reajuste renderia</p>
                <p className="text-xl font-bold tabular-nums">{brl(g.tabela.ganhoMes)}</p>
                <p className="text-xs text-muted-foreground">por mês, sem 1 cliente a mais</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Aguenta perder</p>
                <p className="text-xl font-bold tabular-nums">{g.tabela.toleranciaChurnAtend}</p>
                <p className="text-xs text-muted-foreground">
                  atendimentos/mês ({pct(g.tabela.toleranciaChurnPct)}) e ficar igual
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 font-medium">serviço</th>
                    <th className="py-2 text-right font-medium">hoje</th>
                    <th className="py-2 text-right font-medium">novo</th>
                    <th className="py-2 text-right font-medium">deixa por hora</th>
                  </tr>
                </thead>
                <tbody>
                  {g.tabela.itens
                    .filter((i: any) => !i.semBase)
                    .sort((a: any, b: any) => a.sobraPorHora - b.sobraPorHora)
                    .slice(0, 12)
                    .map((i: any) => (
                      <tr key={i.item} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{i.item}</div>
                          <div className="text-xs text-muted-foreground">
                            {Math.round(i.duracaoMin)} min · {i.qtdTotal}x · comissão{" "}
                            {Math.round(i.comissaoPct * 100)}%
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{brl(i.precoTabela)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{brl(i.precoSugerido)}</td>
                        <td className="py-2 text-right tabular-nums">
                          <span className={i.pagaOFixo ? "text-muted-foreground" : "font-semibold text-rose-500"}>
                            {brl(i.sobraPorHora)}
                          </span>
                          <span className="px-1.5 text-muted-foreground">→</span>
                          <span className="text-emerald-500">{brl(i.sobraPorHoraSugerida)}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Os 12 de menor rendimento. Vermelho não paga o próprio custo fixo. O preço sugerido sai da conta
              da casa (custo fixo, duração real e comissão paga) — ele diz quanto você <em>precisa</em> cobrar,
              não quanto o mercado de Anápolis aceita.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
