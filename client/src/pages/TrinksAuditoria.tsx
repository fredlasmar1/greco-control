import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
} from "lucide-react";

// Tipo retornado por GET /api/trinks/audit
interface BucketDia {
  dia: string;
  total: number;
  ok: number;
  rate429: number;
  erros: number;
  porHora: Record<string, number>;
  porEndpoint: Record<string, number>;
  porOrigem: Record<string, number>;
  primeiroEventoAt: string | null;
  ultimoEventoAt: string | null;
  ultimoStatus429At: string | null;
}

interface AuditResponse {
  ok: boolean;
  diaInicio: string;
  diaFim: string;
  totais: { total: number; ok: number; rate429: number; erros: number };
  porDia: BucketDia[];
  topEndpoints: Array<{ endpoint: string; count: number }>;
  topOrigens: Array<{ origem: string; count: number }>;
  porHoraAgregada: Record<string, number>;
  rateLimiterEmMemoria?: {
    monthKey: string;
    requestsThisMonth: number;
    maxPerMonth: number;
    totalRequestsSession: number;
    uptimeSec: number;
  };
}

export default function TrinksAuditoria() {
  const [dias, setDias] = useState(7);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [uni, setUni] = useState<any>(null);
  const [conf, setConf] = useState<any>(null);
  const [mesConf, setMesConf] = useState<string>(() => new Date().toISOString().slice(0, 7));

  const carregar = async (n: number) => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`/api/trinks/audit?dias=${n}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: AuditResponse = await r.json();
      setData(j);
    } catch (e: any) {
      setErro(e?.message || "Falha ao carregar auditoria");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar(dias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias]);

  // Conta Trinks UNIFICADA (Control + Metas, mesma conta) — Passo 3.
  useEffect(() => {
    fetch(`/api/trinks/quota-unificada`).then(r => r.json()).then(j => { if (j?.ok) setUni(j); }).catch(() => {});
  }, []);

  // Conferência de números Control × Metas — Passo 4.
  useEffect(() => {
    setConf(null);
    fetch(`/api/trinks/conferencia/${mesConf}`).then(r => r.json()).then(j => { if (j?.ok) setConf(j); }).catch(() => {});
  }, [mesConf]);

  const formatarData = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    } catch {
      return iso;
    }
  };

  // Pega o maior valor de hora pra normalizar barras
  const horaMax = data
    ? Math.max(1, ...Object.values(data.porHoraAgregada || {}))
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" />
            Auditoria de Consumo Trinks
          </h1>
          <p className="text-sm text-muted-foreground">
            Conta cada chamada real à API Trinks (sucesso, 429, erro). Persistido no banco — sobrevive a deploys.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border rounded px-3 py-2 text-sm bg-background"
            value={dias}
            onChange={(e) => setDias(parseInt(e.target.value, 10))}
          >
            <option value={1}>Hoje</option>
            <option value={3}>Últimos 3 dias</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={14}>Últimos 14 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => carregar(dias)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {erro && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {erro}
          </CardContent>
        </Card>
      )}

      {/* Conta Trinks UNIFICADA — Control + Metas na mesma conta (Passo 3) */}
      {uni && (() => {
        const tone = uni.alerta === "estourou" || uni.alerta === "critico" ? "bg-rose-500"
          : uni.alerta === "atencao" ? "bg-amber-500" : "bg-emerald-500";
        const pct = Math.min(100, uni.percent);
        return (
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Conta Trinks — total real do mês <span className="text-[11px] font-normal text-muted-foreground">(Greco Control + Greco Metas, mesma conta)</span>
                </span>
                <span className="text-sm tabular-nums"><b>{uni.total.toLocaleString("pt-BR")}</b> / {uni.teto.toLocaleString("pt-BR")} <span className="text-muted-foreground">({uni.percent.toFixed(0)}%)</span></span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5 text-[11px] text-muted-foreground">
                <span>
                  Control <b className="text-foreground">{uni.controlUsados.toLocaleString("pt-BR")}</b> ·
                  Metas <b className="text-foreground">{uni.metasDisponivel ? uni.metasUsados.toLocaleString("pt-BR") : "—"}</b> ·
                  restam <b className="text-foreground">{uni.restante.toLocaleString("pt-BR")}</b>
                </span>
                {uni.alerta === "estourou" ? <span className="text-rose-600 font-semibold">✖ conta estourada</span>
                  : uni.alerta === "critico" ? <span className="text-rose-600 font-semibold">⚠ passou de 90%</span>
                  : uni.alerta === "atencao" ? <span className="text-amber-600 font-semibold">⚠ passou de 75%</span>
                  : <span className="text-emerald-600 font-semibold">✓ dentro do limite</span>}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Conferência de números Control × Metas — Passo 4 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" /> Conferência de números — Control × Metas
            </CardTitle>
            <input type="month" value={mesConf} onChange={(e) => setMesConf(e.target.value)}
              className="border rounded px-2 py-1 text-xs bg-background" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Cada número na sua fonte canônica. Faturamento vem do Gmail (tudo); ranking/atendimento do CSV (mais completo). O Metas (ao vivo) só conta serviço finalizado — por isso fica menor.</p>
        </CardHeader>
        <CardContent>
          {!conf ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Carregando conferência…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Faturamento oficial · <b className="text-emerald-600">canônico</b></p>
                  <p className="text-xl font-bold tabular-nums">R$ {(conf.faturamento.oficialGmail || 0).toLocaleString("pt-BR")}</p>
                  <p className="text-[10px] text-muted-foreground">{conf.faturamento.fonte}</p>
                </div>
                <div className="rounded-lg border border-card-border p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Serviço (Metas, ref.)</p>
                  <p className="text-xl font-bold tabular-nums text-muted-foreground">R$ {(conf.faturamento.servicoMetas || 0).toLocaleString("pt-BR")}</p>
                  <p className="text-[10px] text-muted-foreground">sem produto/plano</p>
                </div>
                <div className="rounded-lg border border-card-border p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Atendimentos</p>
                  <p className="text-xl font-bold tabular-nums">{conf.atendimentos.control ?? "—"} <span className="text-xs font-normal text-muted-foreground">CSV</span></p>
                  <p className="text-[10px] text-muted-foreground">Metas (ao vivo): {conf.atendimentos.metas ?? "—"}</p>
                </div>
              </div>
              {!conf.metasDisponivel && (
                <p className="text-[11px] text-amber-500">⚠ Metas não respondeu — mostrando só os números do Control.</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-2 font-medium">Barbeiro</th>
                      <th className="text-right py-2 px-2 font-medium">Atend. Control</th>
                      <th className="text-right py-2 px-2 font-medium">Atend. Metas</th>
                      <th className="text-right py-2 px-2 font-medium">Gap</th>
                      <th className="text-right py-2 px-2 font-medium">Total Control</th>
                      <th className="text-right py-2 px-2 font-medium">Serviço Metas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conf.porBarbeiro.map((b: any, i: number) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-1.5 px-2">
                          {b.nome}
                          {!b.casou && <span className="ml-1 text-[9px] text-amber-500" title="só aparece em um dos sistemas">só 1 sistema</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{b.atControl ?? "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{b.atMetas ?? "—"}</td>
                        <td className={`py-1.5 px-2 text-right tabular-nums ${b.gapAt != null && Math.abs(b.gapAt) > 20 ? "text-rose-500 font-semibold" : "text-muted-foreground"}`}>{b.gapAt ?? "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{b.totalControl != null ? `R$ ${b.totalControl.toLocaleString("pt-BR")}` : "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{b.servicoMetas != null ? `R$ ${b.servicoMetas.toLocaleString("pt-BR")}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fontes canônicas — Fase C: de onde vem cada número (definição fechada) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Fontes canônicas dos números
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">Cada número tem UMA fonte oficial. Só o Greco Metas fala ao vivo com a Trinks; o Control é offline (Gmail/CSV, 0 token) e complementa.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">Número</th>
                  <th className="text-left py-2 px-2 font-medium">Fonte canônica</th>
                  <th className="text-left py-2 px-2 font-medium">Sistema</th>
                  <th className="text-center py-2 px-2 font-medium">Token</th>
                  <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Por quê</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Faturamento oficial (dia/mês, tudo)", "E-mail Trinks (Gmail)", "Control", "0", "Trinks manda o total certo por e-mail; a API dava só ~55% em 429"],
                  ["Ranking / atendimento por barbeiro", "CSV de ranking", "Control", "0", "Trinks pré-agrega (credita assistente e status final); a API só vê o profissional agendado"],
                  ["Vendas de produto (item / % ganho)", "CSV (fechado) · API (ao vivo)", "Control · Metas", "0", "CSV pro mês fechado; product_sales do Metas pro corrente"],
                  ["Agendamento / ocupação ao vivo", "API /v1/agendamentos", "Metas", "1ª vez", "Metas captura no banco; o Control lê do HUB (0 token na repetição)"],
                  ["Transações (comandas ao vivo)", "API /v1/transacoes", "Metas", "1ª vez", "Proxy do Metas com cache; mês fechado usa CSV (0 token)"],
                  ["Clientes / recorrência / ficha", "rec_clients", "Metas", "sim", "O Metas é o CRM ao vivo (dedup, recorrência, ficha)"],
                  ["Assinantes Clube Greco", "Contratos do Clube", "Control", "0", "O Control gerencia os contratos (plano, valor, vendedor)"],
                  ["Consumo de token Trinks", "Contador unificado", "Ambos", "—", "Metas + Control somam na MESMA conta (teto ~5.000/mês)"],
                ].map((r, i) => (
                  <tr key={i} className="border-b border-border/40 align-top">
                    <td className="py-1.5 px-2 font-medium">{r[0]}</td>
                    <td className="py-1.5 px-2">{r[1]}</td>
                    <td className="py-1.5 px-2">{r[2]}</td>
                    <td className="py-1.5 px-2 text-center">
                      <span className={r[3] === "0" ? "text-emerald-600 font-semibold" : r[3] === "—" ? "text-muted-foreground" : "text-amber-600"}>{r[3]}</span>
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground hidden md:table-cell">{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5 text-[11px] text-muted-foreground">
            <b className="text-amber-600">Ressalva importante:</b> o <b>total</b> canônico é o do Gmail (inclui serviço + produto + plano/Clube). A <b>soma por barbeiro</b> (CSV) pode ficar um pouco menor porque a receita de <b>plano/Clube não é rateada</b> por barbeiro no ranking da Trinks. Não é erro — são recortes diferentes: use o Gmail pro total, o CSV pra atribuição por pessoa.
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          {/* Cards de totais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total de chamadas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.totais.total.toLocaleString("pt-BR")}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.diaInicio} → {data.diaFim}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  OK
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{data.totais.ok.toLocaleString("pt-BR")}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.totais.total > 0
                    ? `${((data.totais.ok / data.totais.total) * 100).toFixed(1)}%`
                    : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  Rate Limit (429)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">{data.totais.rate429.toLocaleString("pt-BR")}</div>
                <p className="text-xs text-muted-foreground mt-1">Bloqueio Trinks</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                  Erros
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">{data.totais.erros.toLocaleString("pt-BR")}</div>
                <p className="text-xs text-muted-foreground mt-1">Falhas de rede / 4xx / 5xx</p>
              </CardContent>
            </Card>
          </div>

          {/* Contador em memória (referência) */}
          {data.rateLimiterEmMemoria && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Contador em memória (zera a cada deploy)
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>
                  Mês <span className="font-mono">{data.rateLimiterEmMemoria.monthKey}</span>:{" "}
                  <span className="font-bold">{data.rateLimiterEmMemoria.requestsThisMonth}</span> /{" "}
                  {data.rateLimiterEmMemoria.maxPerMonth}
                </div>
                <div className="text-muted-foreground">
                  Sessão atual: {data.rateLimiterEmMemoria.totalRequestsSession} reqs · uptime{" "}
                  {Math.round(data.rateLimiterEmMemoria.uptimeSec / 60)} min
                </div>
                <div className="text-xs text-muted-foreground pt-2">
                  ⚠️ Este contador é só do processo atual. O total real (que a Trinks vê) é a soma da auditoria persistente acima.
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabela por dia */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Por dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Dia</th>
                      <th className="py-2 pr-4 font-medium text-right">Total</th>
                      <th className="py-2 pr-4 font-medium text-right">OK</th>
                      <th className="py-2 pr-4 font-medium text-right">429</th>
                      <th className="py-2 pr-4 font-medium text-right">Erros</th>
                      <th className="py-2 pr-4 font-medium">Último 429</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porDia.slice().reverse().map((b) => (
                      <tr key={b.dia} className="border-b last:border-b-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-mono">{b.dia}</td>
                        <td className="py-2 pr-4 text-right font-medium">{b.total}</td>
                        <td className="py-2 pr-4 text-right text-green-600">{b.ok}</td>
                        <td className={`py-2 pr-4 text-right ${b.rate429 > 0 ? "text-amber-600 font-bold" : "text-muted-foreground"}`}>
                          {b.rate429}
                        </td>
                        <td className={`py-2 pr-4 text-right ${b.erros > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {b.erros}
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {formatarData(b.ultimoStatus429At)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Distribuição por hora */}
          {data.totais.total > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuição por hora do dia (agregado)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-12 md:grid-cols-24 gap-1 items-end" style={{ minHeight: "120px" }}>
                  {Array.from({ length: 24 }, (_, h) => {
                    const hora = String(h).padStart(2, "0");
                    const valor = data.porHoraAgregada[hora] || 0;
                    const altura = Math.round((valor / horaMax) * 100);
                    return (
                      <div key={hora} className="flex flex-col items-center gap-1">
                        <div
                          className="w-full bg-primary/80 rounded-sm hover:bg-primary transition-colors relative group"
                          style={{ height: `${Math.max(2, altura)}%`, minHeight: valor > 0 ? "4px" : "2px" }}
                          title={`${hora}h: ${valor} reqs`}
                        >
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                            {valor}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{hora}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top endpoints e top origens */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top endpoints</CardTitle>
              </CardHeader>
              <CardContent>
                {data.topEndpoints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.topEndpoints.slice(0, 15).map((it) => (
                      <li key={it.endpoint} className="flex items-center justify-between border-b last:border-b-0 py-1.5">
                        <span className="font-mono text-xs">{it.endpoint}</span>
                        <span className="font-medium">{it.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top origens</CardTitle>
                <p className="text-xs text-muted-foreground">
                  De onde os requests partiram (cron, dashboard, sync ad-hoc)
                </p>
              </CardHeader>
              <CardContent>
                {data.topOrigens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.topOrigens.slice(0, 15).map((it) => (
                      <li key={it.origem} className="flex items-center justify-between border-b last:border-b-0 py-1.5">
                        <span className="font-mono text-xs">{it.origem}</span>
                        <span className="font-medium">{it.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
