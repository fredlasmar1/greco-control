import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/demoData";
import { TrendingUp, Users, Scissors } from "lucide-react";

const API_BASE = (globalThis as any).__API_BASE__ || "";
const NOME_MES: Record<string, string> = {
  "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun",
  "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};
const rotulo = (mes: string) => `${NOME_MES[mes.slice(5)] || mes} ${mes.slice(0, 4)}`;

export default function Evolucao() {
  const [meses, setMeses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesBarbeiro, setMesBarbeiro] = useState<string>("");

  useEffect(() => {
    fetch(`${API_BASE}/api/historico/mensal`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setMeses(d.meses || []);
          const comRanking = (d.meses || []).filter((m: any) => m.temRanking);
          if (comRanking.length) setMesBarbeiro(comRanking[comRanking.length - 1].mes);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const maxReceita = useMemo(() => Math.max(1, ...meses.map((m) => m.receita)), [meses]);
  const maxClientes = useMemo(() => Math.max(1, ...meses.map((m) => m.clientesUnicos)), [meses]);
  const barbeirosDoMes = useMemo(() => meses.find((m) => m.mes === mesBarbeiro)?.barbeiros || [], [meses, mesBarbeiro]);
  const mesesComRanking = useMemo(() => meses.filter((m) => m.temRanking), [meses]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Carregando histórico…</div>;
  if (!meses.length) return <div className="p-6 text-sm text-muted-foreground">Nenhum mês com Caixa importado ainda. Importe os relatórios em <strong>Importar Trinks</strong>.</div>;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1000px]">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" /> Evolução da Barbearia</h1>
        <p className="text-xs text-muted-foreground">Números reais mês a mês — receita, clientes e barbeiros (fonte: Caixa + Ranking da Trinks).</p>
      </div>

      {/* Faturamento mês a mês */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> Faturamento por mês</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {meses.map((m) => (
              <div key={m.mes} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-muted-foreground">{rotulo(m.mes)}</span>
                <div className="flex-1 bg-muted/20 rounded h-5 relative overflow-hidden">
                  <div className="h-full bg-emerald-500/30 rounded" style={{ width: `${(m.receita / maxReceita) * 100}%` }} />
                  <span className="absolute inset-y-0 left-2 flex items-center font-semibold tabular-nums">{formatCurrency(m.receita)}</span>
                </div>
                <span className="w-16 text-right text-muted-foreground tabular-nums">{m.comandas} com.</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Clientes mês a mês */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-red-400" /> Clientes por mês (novos × recorrentes)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left p-2">Mês</th>
                <th className="text-right p-2">Clientes únicos</th>
                <th className="text-right p-2">Novos</th>
                <th className="text-right p-2">Recorrentes</th>
                <th className="text-right p-2">% recorrência</th>
                <th className="text-right p-2">Ticket médio</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const pctRec = m.clientesUnicos ? Math.round((m.clientesRecorrentes / m.clientesUnicos) * 100) : 0;
                return (
                  <tr key={m.mes} className="border-b border-border/30">
                    <td className="p-2 font-medium">{rotulo(m.mes)}</td>
                    <td className="p-2 text-right tabular-nums">{m.clientesUnicos}</td>
                    <td className="p-2 text-right tabular-nums text-red-400">{m.clientesNovos}</td>
                    <td className="p-2 text-right tabular-nums text-emerald-400">{m.clientesRecorrentes}</td>
                    <td className="p-2 text-right tabular-nums">{pctRec}%</td>
                    <td className="p-2 text-right tabular-nums">{formatCurrency(m.ticketMedio)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground mt-2">● "Novo" = primeira vez que o cliente aparece no histórico (a partir de janeiro). A recorrência subindo = base fidelizando.</p>
        </CardContent>
      </Card>

      {/* Barbeiros */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2"><Scissors className="w-4 h-4 text-primary" /> Barbeiros</CardTitle>
            {mesesComRanking.length > 0 && (
              <Select value={mesBarbeiro} onValueChange={setMesBarbeiro}>
                <SelectTrigger className="h-7 w-32 text-xs" data-testid="evol-select-mes"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {mesesComRanking.map((m) => <SelectItem key={m.mes} value={m.mes}>{rotulo(m.mes)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {mesesComRanking.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum mês com Ranking de Profissionais importado. Importe o ranking de cada mês em <strong>Importar Trinks</strong>.</p>
          ) : barbeirosDoMes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem dados de barbeiro para {rotulo(mesBarbeiro)}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-2">Barbeiro</th>
                    <th className="text-right p-2">Atend.</th>
                    <th className="text-right p-2">Serviços</th>
                    <th className="text-right p-2">Produtos</th>
                    <th className="text-right p-2">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {barbeirosDoMes.map((b: any, i: number) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="p-2 font-medium truncate max-w-[200px]" title={b.nome}>{b.nome}</td>
                      <td className="p-2 text-right tabular-nums">{b.atendimentos}</td>
                      <td className="p-2 text-right tabular-nums">{formatCurrency(b.servicos)}</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">{formatCurrency(b.produtos)}</td>
                      <td className="p-2 text-right tabular-nums text-amber-400">{formatCurrency(b.comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mesesComRanking.length > 0 && mesesComRanking.length < meses.length && (
            <p className="text-[10px] text-amber-400 mt-2">⚠ Faltam rankings de: {meses.filter((m) => !m.temRanking).map((m) => rotulo(m.mes)).join(", ")} — importe pra completar o histórico de barbeiros.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
