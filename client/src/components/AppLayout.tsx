import { useLocation, Link } from "wouter";
import grecoLogo from "../../logo-greco.png";
import { useStore } from "@/lib/store";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
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
  ClipboardCheck,
  Calculator,
  UserX,
  Banknote,
  Crown,
  Package,
} from "lucide-react";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/lancamentos", label: "Lançamentos", icon: Receipt },
  { path: "/equipe", label: "Equipe", icon: Users },
  { path: "/raio-x", label: "Raio-X", icon: ClipboardCheck },
  { path: "/servicos", label: "Serviços", icon: Scissors },
  { path: "/precificacao", label: "Precificação", icon: Calculator },
  { path: "/financeiro", label: "Financeiro", icon: DollarSign },
  { path: "/estoque", label: "Estoque", icon: Package },
  { path: "/consolidacao", label: "Consolidação", icon: Banknote },
  { path: "/assinaturas", label: "Assinaturas", icon: Crown },
  { path: "/fechamento", label: "Fechamento", icon: CalendarCheck },
  { path: "/metas", label: "Metas", icon: Target },
  { path: "/duplicados", label: "Duplicados", icon: UserX },
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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
          fixed lg:static inset-y-0 left-0 z-50
          w-[240px] bg-sidebar border-r border-sidebar-border
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
                  {isActive && (
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-background flex-shrink-0">
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
        <main className="flex-1 overflow-y-auto p-4 lg:p-6" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
