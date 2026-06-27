import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import grecoLogo from "../../logo-greco.png";
import { useStore } from "@/lib/store";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

const API_BASE = (globalThis as any).__API_BASE__ || "";
import {
  LayoutDashboard,
  Receipt,
  Users,
  Scissors,
  DollarSign,
  CalendarCheck,
  Target,
  Settings,
  Menu,
  X,
  Bell,
  TrendingUp,
  Calculator,
  LineChart,
  UserX,
  Banknote,
  Crown,
  Package,
  GitMerge,
  Wallet,
  FileUp,
  Scale,
  Activity,
} from "lucide-react";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/conselheiro", label: "Conselheiro", icon: Scale },
  { path: "/lancamentos", label: "Lançamentos", icon: Receipt },
  { path: "/caixa-dia", label: "Caixa do Dia", icon: Banknote },
  { path: "/equipe", label: "Equipe", icon: Users },
  { path: "/vendas-produtos", label: "Vendas Produtos", icon: TrendingUp },
  { path: "/precificacao", label: "Serviços & Precificação", icon: Scissors },
  { path: "/viabilidade", label: "Viabilidade", icon: Calculator },
  { path: "/evolucao", label: "Evolução", icon: LineChart },
  { path: "/financeiro", label: "Financeiro", icon: DollarSign },
  { path: "/estoque", label: "Estoque", icon: Package },
  { path: "/pagamento", label: "Pagamento", icon: Wallet },
  { path: "/assinaturas", label: "Assinaturas", icon: Crown },
  { path: "/fechamento", label: "Fechamento", icon: CalendarCheck },
  { path: "/metas", label: "Metas", icon: Target },
  { path: "/duplicados", label: "Duplicados", icon: UserX },
  { path: "/importar-trinks", label: "Importar Trinks", icon: FileUp },
  { path: "/trinks-auditoria", label: "Auditoria Trinks", icon: Activity },
  { path: "/contas-mensais", label: "Contas Mensais", icon: Wallet },
  { path: "/configuracoes", label: "Configurações", icon: Settings },
];

function GrecoLogo() {
  return (
    <img src={grecoLogo} alt="Greco Barbearia" className="w-8 h-8 rounded-lg object-contain" />
  );
}

function getPageTitle(path: string): string {
  const item = navItems.find(n => n.path === path);
  return item?.label || "Dashboard";
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { sidebarOpen, setSidebarOpen } = useStore();

  // Badge global de duplicados pendentes (alerta na sidebar)
  const [duplicadosCount, setDuplicadosCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/clientes/duplicados`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setDuplicadosCount(d.totalGruposDuplicados ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          data-testid="sidebar-overlay"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50
          w-[240px] h-screen lg:h-screen
          bg-sidebar border-r border-sidebar-border
          flex flex-col transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
        data-testid="sidebar"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-sidebar-border">
          <GrecoLogo />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground leading-tight">Greco Control</span>
            <span className="text-[10px] text-muted-foreground leading-tight">Gestão de Barbearia</span>
          </div>
          <button
            className="ml-auto lg:hidden p-1 rounded hover:bg-sidebar-accent"
            onClick={() => setSidebarOpen(false)}
            data-testid="close-sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 px-2 overflow-y-auto">
          {navItems.map(({ path, label, icon: Icon }) => {
            const isActive = location === path || (path !== "/" && location.startsWith(path));
            return (
              <Link key={path} href={path}>
                <div
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer
                    transition-colors duration-150 mb-0.5
                    ${isActive
                      ? "bg-primary/15 text-[#5B8AC4]"
                      : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    }
                  `}
                  data-testid={`nav-${path.replace("/", "") || "dashboard"}`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-primary" : ""}`} />
                  <span>{label}</span>
                  {path === "/duplicados" && duplicadosCount !== null && duplicadosCount > 0 && (
                    <span
                      className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 tabular-nums"
                      title={`${duplicadosCount} grupo${duplicadosCount !== 1 ? "s" : ""} de clientes duplicados`}
                      data-testid="badge-duplicados"
                    >
                      {duplicadosCount}
                    </span>
                  )}
                  {isActive && !(path === "/duplicados" && duplicadosCount && duplicadosCount > 0) && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-sidebar-border">
          <PerplexityAttribution />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-background sticky top-0 z-30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2.5 rounded-md hover:bg-muted"
              onClick={() => setSidebarOpen(true)}
              data-testid="open-sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base font-semibold truncate" data-testid="page-title">
              {getPageTitle(location)}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-1.5 rounded-md hover:bg-muted relative" data-testid="notifications">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary rounded-full" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white" data-testid="user-avatar">
                FL
              </div>
              <span className="text-sm font-medium hidden sm:block" data-testid="user-name">Fred Lasmar</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
