import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import grecoLogo from "../../greco-logo-dark.png";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/authStore";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

// Rotas que a RECEPÇÃO pode acessar (sem financeiro/folha).
const RECEPCAO_ROTAS = ["/caixa-dia", "/estoque", "/compras", "/assinaturas"];

const API_BASE = (globalThis as any).__API_BASE__ || "";
import {
  LayoutDashboard,
  Receipt,
  Users,
  Scissors,
  DollarSign,
  CalendarCheck,
  Settings,
  Menu,
  X,
  Bell,
  TrendingUp,
  Calculator,
  LineChart,
  Banknote,
  Crown,
  Package,
  GitMerge,
  Wallet,
  FileUp,
  Scale,
  Activity,
  ShoppingCart,
  Radar,
  Tag,
  LogOut,
} from "lucide-react";

// TRÊS TELAS. Eram 19 no menu, de 24 construídas — 9 duplicavam o Greco Metas e
// 14 eram máquinas de digitar que o dado já responde. O Control não opera nada:
// ele lê o Metas e opina.
const navItems = [
  { path: "/", label: "O painel", icon: LayoutDashboard },
  { path: "/mesa", label: "A mesa", icon: Scale },
  { path: "/mes", label: "O mês", icon: Calculator },
  { path: "/preco", label: "O preço", icon: Tag },
  { path: "/conselho", label: "O conselho", icon: Users },
];

function GrecoLogo({ className = "h-6 w-auto" }: { className?: string }) {
  // Wordmark oficial GRECO SPORT BARBER (branco+/// vermelho, fundo transparente).
  return (
    <img src={grecoLogo} alt="Greco Sport Barber" className={`${className} object-contain`} />
  );
}

function getPageTitle(path: string): string {
  // Central mora fora das abas (botão destacado no header), mas ainda dá título.
  const item = navItems.find(n => n.path === path);
  return item?.label || "O painel";
}

/** Duas letras a partir do nome. ⛔ Sem nome, ⛔ não se inventa sigla: "?" é honesto. */
function iniciais(nome?: string | null): string {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const primeira = partes[0][0] || "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] || "" : "";
  return (primeira + ultima).toUpperCase();
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { sidebarOpen, setSidebarOpen } = useStore();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const itensVisiveis = user?.role === "recepcao"
    ? navItems.filter((n) => RECEPCAO_ROTAS.includes(n.path))
    : navItems;

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
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border">
          <GrecoLogo />
          <span className="font-display text-[11px] tracking-[0.28em] text-muted-foreground self-end mb-2.5">CONTROL</span>
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
          {itensVisiveis.map(({ path, label, icon: Icon }) => {
            const isActive = location === path || (path !== "/" && location.startsWith(path));
            return (
              <Link key={path} href={path}>
                <div
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer
                    transition-colors duration-150 mb-0.5
                    ${isActive
                      ? "bg-[#1B1B1B] text-white shadow-[inset_2px_0_0_0_#AF0000]"
                      : "text-muted-foreground hover:text-white hover:bg-white/[0.04]"
                    }
                  `}
                  data-testid={`nav-${path.replace("/", "") || "dashboard"}`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-[#AF0000]" : ""}`} />
                  <span>{label}</span>
                  {isActive && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#AF0000]" />
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
        <header className="h-14 border-b border-border/70 flex items-center justify-between px-4 bg-background/70 backdrop-blur-xl sticky top-0 z-30 flex-shrink-0 shadow-[0_1px_0_0_hsl(0_0%_100%/0.04)]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="lg:hidden p-2.5 rounded-md hover:bg-muted"
              onClick={() => setSidebarOpen(true)}
              data-testid="open-sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <GrecoLogo className="h-5 w-auto" />
            <span className="text-muted-foreground hidden sm:block" aria-hidden>·</span>
            <h1 className="text-base font-medium text-muted-foreground truncate" data-testid="page-title">
              {getPageTitle(location)}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Central de Vendas — destaque FORA das abas, do outro lado do header.
                É a frente de crescimento (winback/LTV), então ganha o vermelho da
                marca pra puxar o olho, separada do trabalho financeiro do dia a dia.
                Admin + recepção (liberado 23/jul pelo dono): a régua de reativação é
                trabalho da recepção (Larissa/Camila). Guilherme já é admin. */}
            {(user?.role === "admin" || user?.role === "recepcao") && (
              <Link href="/central">
                <div
                  className={`
                    flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer
                    transition-colors duration-150 border
                    ${location.startsWith("/central")
                      ? "bg-[#AF0000] text-white border-[#AF0000] shadow-[0_0_0_3px_rgba(175,0,0,0.15)]"
                      : "bg-[#AF0000]/10 text-white border-[#AF0000]/40 hover:bg-[#AF0000]/20"
                    }
                  `}
                  data-testid="nav-central-destaque"
                >
                  <Radar className={`w-4 h-4 flex-shrink-0 ${location.startsWith("/central") ? "text-white" : "text-[#AF0000]"}`} />
                  <span className="hidden sm:block">Central de Vendas</span>
                </div>
              </Link>
            )}
            <button className="p-1.5 rounded-md hover:bg-muted relative" data-testid="notifications">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary rounded-full" />
            </button>
            {/*
              ⛔ QUEM ESTÁ LOGADO SAI DA SESSÃO, NÃO DO CÓDIGO.

              Até 23/08/2026 este bloco escrevia "FL / Fred Lasmar" CHUMBADO.
              Guilherme, Larissa e Camila logavam e viam o nome do DONO no canto
              — e não havia como saber quem estava usando olhando a tela. Num
              sistema que mostra DRE, folha e carteira, isso é pior que feio.

              ⛔ E NÃO HAVIA COMO SAIR. Nenhum logout, em lugar nenhum: tela de
              login, sessão de 30 dias agora persistida em banco, e nenhuma porta
              de saída. Só se descobriu porque o dono foi testar o login do
              Google e não conseguiu deslogar para provar que funcionava.
            */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white" data-testid="user-avatar">
                {iniciais(user?.nome || user?.username)}
              </div>
              <span className="text-sm font-medium hidden sm:block" data-testid="user-name">
                {user?.nome || user?.username || "—"}
              </span>
              <button
                onClick={() => { void logout(); }}
                title="Sair do sistema"
                className="ml-1 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                data-testid="logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
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
