import { useEffect, useRef } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { useTrinksStore } from "@/lib/trinksStore";
import Dashboard from "@/pages/Dashboard";
import Lancamentos from "@/pages/Lancamentos";
import Equipe from "@/pages/Equipe";
import Servicos from "@/pages/Servicos";
import Financeiro from "@/pages/Financeiro";
import Fechamento from "@/pages/Fechamento";
import Metas from "@/pages/Metas";
import Configuracoes from "@/pages/Configuracoes";
import RaioX from "@/pages/RaioX";
import NotFound from "@/pages/not-found";

function AppRouter() {
  const loadSavedConfig = useTrinksStore((s) => s.loadSavedConfig);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      loadSavedConfig();
    }
  }, [loadSavedConfig]);

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/lancamentos" component={Lancamentos} />
        <Route path="/equipe" component={Equipe} />
        <Route path="/servicos" component={Servicos} />
        <Route path="/financeiro" component={Financeiro} />
        <Route path="/fechamento" component={Fechamento} />
        <Route path="/metas" component={Metas} />
        <Route path="/configuracoes" component={Configuracoes} />
        <Route path="/raio-x" component={RaioX} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
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
