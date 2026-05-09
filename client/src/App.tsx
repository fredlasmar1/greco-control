import { useEffect, useRef } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { useTrinksStore } from "@/lib/trinksStore";
import { useAuth } from "@/lib/authStore";
import { useStore } from "@/lib/store";
import { Loader2 } from "lucide-react";
import Dashboard from "@/pages/Dashboard";
import Lancamentos from "@/pages/Lancamentos";
import CaixaDia from "@/pages/CaixaDia";
import Equipe from "@/pages/Equipe";
import Servicos from "@/pages/Servicos";
import Precificacao from "@/pages/Precificacao";
import Financeiro from "@/pages/Financeiro";
import Fechamento from "@/pages/Fechamento";
import Metas from "@/pages/Metas";
import Configuracoes from "@/pages/Configuracoes";
import ClientesDuplicados from "@/pages/ClientesDuplicados";
import VendasProdutos from "@/pages/VendasProdutos";
import Consolidacao from "@/pages/Consolidacao";
import Conciliacao from "@/pages/Conciliacao";
import Pagamento from "@/pages/Pagamento";
import Assinaturas from "@/pages/Assinaturas";
import Estoque from "@/pages/Estoque";
import ImportarTrinks from "@/pages/ImportarTrinks";
import Conselheiro from "@/pages/Conselheiro";
import TrinksAuditoria from "@/pages/TrinksAuditoria";
import Login from "@/pages/Login";
import { CopilotDrawer } from "@/components/CopilotDrawer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import MeuPainel from "@/pages/MeuPainel";
import NotFound from "@/pages/not-found";

// Redirect helper para rotas antigas (ex: /consolidacao → /lancamentos)
function RedirectTo({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(to); }, [to, setLocation]);
  return null;
}

function AdminRoutes() {
  const loadSavedConfig = useTrinksStore((s) => s.loadSavedConfig);
  const loadStoreFromServer = useStore((s) => s.loadFromServer);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      loadSavedConfig();
      loadStoreFromServer();
    }
  }, [loadSavedConfig, loadStoreFromServer]);

  return (
    <AppLayout>
      <ErrorBoundary label="route">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/lancamentos" component={Lancamentos} />
          <Route path="/caixa-dia" component={CaixaDia} />
          <Route path="/equipe" component={Equipe} />
          {/* /servicos foi unificada em /precificacao (aba interna 'Catálogo') */}
          <Route path="/servicos">{() => <RedirectTo to="/precificacao" />}</Route>
          <Route path="/precificacao" component={Precificacao} />
          <Route path="/financeiro" component={Financeiro} />
          <Route path="/estoque" component={Estoque} />
          {/* /consolidacao foi unificada em /lancamentos (aba interna 'Conciliação') */}
          <Route path="/consolidacao">{() => <RedirectTo to="/lancamentos" />}</Route>
          <Route path="/conciliacao" component={Conciliacao} />
          <Route path="/pagamento" component={Pagamento} />
          <Route path="/assinaturas" component={Assinaturas} />
          <Route path="/fechamento" component={Fechamento} />
          <Route path="/metas" component={Metas} />
          <Route path="/duplicados" component={ClientesDuplicados} />
          <Route path="/configuracoes" component={Configuracoes} />
          <Route path="/vendas-produtos" component={VendasProdutos} />
          <Route path="/importar-trinks" component={ImportarTrinks} />
          <Route path="/conselheiro" component={Conselheiro} />
          <Route path="/trinks-auditoria" component={TrinksAuditoria} />
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

  // Redireciona quando o estado de auth muda
  useEffect(() => {
    if (loading) return;
    if (!user && location !== "/login") {
      setLocation("/login");
    } else if (user?.role === "barbeiro" && location !== "/meu-painel" && location !== "/login") {
      setLocation("/meu-painel");
    } else if (user?.role === "admin" && location === "/login") {
      setLocation("/");
    }
  }, [user, loading, location, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Sem login: só mostra a tela de login
  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route component={Login} />
      </Switch>
    );
  }

  // Barbeiro: vê só o próprio painel
  if (user.role === "barbeiro") {
    return (
      <Switch>
        <Route path="/meu-painel" component={MeuPainel} />
        <Route component={MeuPainel} />
      </Switch>
    );
  }

  // Admin: acesso completo
  return <AdminRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
        <CopilotDrawer />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
