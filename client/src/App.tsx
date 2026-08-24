/**
 * GRECO CONTROL — o conselho do dono.
 *
 * Este app tinha 24 telas e 22.238 linhas. A auditoria de 03/08/2026 achou 9
 * duplicadas (o Greco Metas já fazia, com dado vivo) e 14 mortas — máquinas de
 * digitar que o dado já responde sozinho. A `Precificacao.tsx`, com 2.153 linhas
 * de ficha técnica e margem, é o retrato: era a tela CERTA, alimentada à mão, e
 * no dia em que o dono perguntou "meus preços estão defasados?" ninguém abriu
 * ela — a resposta saiu do banco.
 *
 * Sobraram três telas, e uma regra: **o Control não calcula nada**. Não tem
 * banco de operação, não tem campo de digitar. Ele lê o Metas pela ponte e
 * opina. Se um número está errado aqui, conserta-se lá.
 *
 * QUEM ENTRA: só o dono. A operação inteira — caixa, estoque, compras, Clube,
 * comissão — mora no Greco Metas, onde a equipe já tem login. Recepção e
 * barbeiro que caírem aqui são mandados pra lá, em vez de encontrarem tela
 * quebrada numa terça de manhã.
 */
import { useEffect, useRef } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/lib/authStore";
import { Loader2, ArrowUpRight } from "lucide-react";
import AMesa from "@/pages/AMesa";
import OMes from "@/pages/OMes";
import Painel from "@/pages/Painel";
import OPreco from "@/pages/OPreco";
import AOperacao from "@/pages/AOperacao";
import OConselho from "@/pages/OConselho";
import Login from "@/pages/Login";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";

const METAS = "https://www.grecopro.com.br";

/**
 * A equipe não usa mais o Control. Em vez de esconder o menu e deixar a pessoa
 * girando numa tela vazia, diz onde o trabalho dela passou a morar.
 */
function MudouDeCasa() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold">O trabalho do dia mudou de lugar</h1>
        <p className="text-muted-foreground">
          Caixa, estoque, compras, Clube e comissão agora ficam no <strong>Greco Metas</strong>, com o seu
          mesmo login. Este painel virou o conselho do dono.
        </p>
        <a
          href={METAS}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          Ir para o Greco Metas <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function Conselho() {
  return (
    <AppLayout>
      <ErrorBoundary label="route">
        <Switch>
          <Route path="/" component={Painel} />
          <Route path="/mesa" component={AMesa} />
          <Route path="/mes" component={OMes} />
          <Route path="/preco" component={OPreco} />
          <Route path="/operacao" component={AOperacao} />
          <Route path="/conselho" component={OConselho} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </AppLayout>
  );
}

function AppRouter() {
  const { user, loading, restoreSession } = useAuth();
  const [location, setLocation] = useLocation();
  const restored = useRef(false);

  useEffect(() => {
    if (!restored.current) {
      restored.current = true;
      restoreSession();
    }
  }, [restoreSession]);

  useEffect(() => {
    if (loading) return;
    if (!user && location !== "/login") setLocation("/login");
    else if (user?.role === "admin" && location === "/login") setLocation("/");
  }, [user, loading, location, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route component={Login} />
      </Switch>
    );
  }

  if (user.role !== "admin") return <MudouDeCasa />;

  return <Conselho />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
