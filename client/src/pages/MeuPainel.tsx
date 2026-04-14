import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { authFetch, useAuth } from "@/lib/authStore";
import { formatCurrency } from "@/lib/demoData";
import grecoLogo from "../../logo-greco.png";
import {
  Target, Users, Calendar, TrendingUp, Clock,
  LogOut, Loader2, Trophy, AlertCircle, RefreshCw,
} from "lucide-react";

interface PainelData {
  barberId: string;
  nome: string;
  profissional: { nome: string; comissao: number } | null;
  meta: number;
  faturamento: { dia: number; semana: number; mes: number };
  clientes: { dia: number; semana: number; mes: number };
  restaFaturar: number;
  dailyNeeded: number;
  remainingDays: number;
  daysInMonth: number;
  dayOfMonth: number;
  proximosHoje: { hora: string; cliente: string; servico: string; valor: number }[];
  mes: string;
  dataSync: string | null;
}

export default function MeuPainel() {
  const { user, logout } = useAuth();
  const [data, setData] = useState<PainelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/meu-painel");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Erro ao carregar painel");
        setLoading(false);
        return;
      }
      const d = await res.json();
      setData(d);
    } catch (err: any) {
      setError(err.message || "Erro de conexão");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col bg-background p-4">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <img src={grecoLogo} alt="Greco" className="w-8 h-8 rounded" />
            <span className="font-semibold text-sm">Greco Control</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-sm bg-card border-card-border">
            <CardContent className="p-6 text-center">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <p className="text-sm font-semibold mb-1">Não foi possível carregar</p>
              <p className="text-xs text-muted-foreground mb-4">{error}</p>
              <Button onClick={load} variant="outline" size="sm" className="w-full">
                <RefreshCw className="w-3.5 h-3.5 mr-2" /> Tentar novamente
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const pctMes = data.meta > 0 ? Math.min(100, (data.faturamento.mes / data.meta) * 100) : 0;
  const expectedPct = (data.dayOfMonth / data.daysInMonth) * 100;
  const onTrack = pctMes >= expectedPct * 0.9;
  const now = new Date();
  const saudacao = now.getHours() < 12 ? "Bom dia" : now.getHours() < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header fixo */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <img src={grecoLogo} alt="Greco" className="w-8 h-8 rounded flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground leading-tight">{saudacao},</p>
            <p className="text-sm font-semibold truncate leading-tight">{user?.nome}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={load} className="h-8 w-8 p-0">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={logout} className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Card principal: Meta do Mês */}
        <Card className="bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border-primary/30 overflow-hidden relative">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Minha Meta do Mês</span>
            </div>
            <p className="text-3xl font-bold text-foreground mb-1">
              {formatCurrency(data.faturamento.mes)}
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              de <span className="font-semibold text-foreground">{formatCurrency(data.meta)}</span>
            </p>
            <Progress value={pctMes} className="h-2 mb-2 bg-white/10 [&>div]:bg-primary" />
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-primary">{pctMes.toFixed(1)}% atingido</span>
              <span className={onTrack ? "text-emerald-400" : "text-amber-400"}>
                {onTrack ? "🎯 No ritmo" : "⚠️ Precisa acelerar"}
              </span>
            </div>

            {data.restaFaturar > 0 && (
              <div className="mt-4 pt-4 border-t border-primary/20">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-muted-foreground">Falta faturar</span>
                  <span className="text-lg font-bold text-foreground">{formatCurrency(data.restaFaturar)}</span>
                </div>
                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-xs text-muted-foreground">Por dia ({data.remainingDays} dias)</span>
                  <span className="text-sm font-semibold text-primary">{formatCurrency(data.dailyNeeded)}/dia</span>
                </div>
              </div>
            )}
            {data.restaFaturar === 0 && (
              <div className="mt-4 pt-4 border-t border-primary/20 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-semibold text-emerald-400">Meta batida! Parabéns 🎉</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Faturamento Hoje / Semana / Mês */}
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Faturamento
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <Card className="bg-card border-card-border">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Hoje</p>
                <p className="text-base font-bold truncate">{formatCurrency(data.faturamento.dia)}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Semana</p>
                <p className="text-base font-bold truncate">{formatCurrency(data.faturamento.semana)}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Mês</p>
                <p className="text-base font-bold text-primary truncate">{formatCurrency(data.faturamento.mes)}</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Clientes Atendidos */}
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Clientes Atendidos
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <Card className="bg-card border-card-border">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Hoje</p>
                <p className="text-2xl font-bold">{data.clientes.dia}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Semana</p>
                <p className="text-2xl font-bold">{data.clientes.semana}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Mês</p>
                <p className="text-2xl font-bold text-primary">{data.clientes.mes}</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Próximos agendamentos */}
        {data.proximosHoje.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Próximos de Hoje
              <span className="text-[10px] text-muted-foreground font-normal">({data.proximosHoje.length})</span>
            </h2>
            <Card className="bg-card border-card-border">
              <CardContent className="p-0">
                {data.proximosHoje.map((ag, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-3 ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <div className="w-12 h-12 rounded-md bg-primary/10 flex flex-col items-center justify-center flex-shrink-0">
                      <Clock className="w-3 h-3 text-primary mb-0.5" />
                      <span className="text-xs font-bold text-primary">{ag.hora || "--"}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{ag.cliente}</p>
                      <p className="text-xs text-muted-foreground truncate">{ag.servico}</p>
                    </div>
                    {ag.valor > 0 && (
                      <p className="text-sm font-semibold text-foreground flex-shrink-0">
                        {formatCurrency(ag.valor)}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Footer info */}
        <div className="text-center pt-4">
          <p className="text-[10px] text-muted-foreground">
            {data.profissional?.comissao && `Comissão ${data.profissional.comissao}% · `}
            Dia {data.dayOfMonth} de {data.daysInMonth}
          </p>
          {data.dataSync && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Última atualização: {new Date(data.dataSync).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
