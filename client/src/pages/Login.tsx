import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/authStore";
import grecoLogo from "../../greco-mark.png";
import { Loader2, AlertCircle } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, user, loading, adotarToken } = useAuth();
  const [google, setGoogle] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  /**
   * A VOLTA DO GOOGLE. O callback manda um TICKET na URL — ⛔ nunca o token, que
   * ficaria no histórico, no log do servidor e no Referer.
   *
   * ⛔ E a barra de endereço é limpa no ato, dê certo ou não: ticket usado ⛔ não
   * pode continuar visível para ser colado em lugar nenhum.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const ticket = q.get("ticket");
    const erro = q.get("erro");

    if (erro) {
      const dito: Record<string, string> = {
        nao_autorizado: "Essa conta Google não tem acesso a este sistema.",
        sessao_invalida: "O login expirou antes de terminar. Tente de novo.",
        google_recusou: "O Google não confirmou o login.",
        conta_local_ausente: "Não há conta ativa aqui para receber a sessão.",
        sem_codigo: "O Google voltou sem o código de autorização.",
      };
      setError(dito[erro] || "Não consegui entrar pelo Google.");
      window.location.hash = "#/login";
      return;
    }

    if (!ticket) return;
    window.location.hash = "#/login";
    setTrocando(true);
    (async () => {
      try {
        const r = await fetch(`${(globalThis as any).__API_BASE__ || ""}/api/auth/google/trocar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket }),
        });
        const j = await r.json();
        if (!j?.ok || !j.token) throw new Error(j?.error || "ticket recusado");
        const res = await adotarToken(j.token);
        if (!res.ok) throw new Error(res.error);
      } catch (e: any) {
        setError(e?.message || "não consegui concluir o login pelo Google");
      } finally {
        setTrocando(false);
      }
    })();
  }, [adotarToken]);

  /** O botão só aparece se o servidor disser que está configurado. */
  useEffect(() => {
    fetch(`${(globalThis as any).__API_BASE__ || ""}/api/auth/google/disponivel`)
      .then((r) => r.json())
      .then((j) => setGoogle(Boolean(j?.disponivel)))
      .catch(() => setGoogle(false));
  }, []);

  // Redireciona se já estiver logado
  useEffect(() => {
    if (user) {
      setLocation(user.role === "admin" ? "/" : "/meu-painel");
    }
  }, [user, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Preencha usuário e senha.");
      return;
    }
    setSubmitting(true);
    setError("");
    const result = await login(username.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || "Erro no login");
    } else {
      const role = result.user?.role;
      setLocation(role === "admin" ? "/" : "/meu-painel");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm bg-card border-card-border">
        <CardContent className="p-6">
          <div className="flex flex-col items-center mb-6">
            <img src={grecoLogo} alt="Greco Sport Barber" className="w-16 h-16 mb-3 rounded-xl" />
            <h1 className="font-display text-3xl tracking-wide leading-none">GRECO <span className="text-primary">SPORT BARBER</span></h1>
            <p className="text-xs text-muted-foreground mt-1">Entre com seu usuário e senha</p>
          </div>

          {google && (
            <div className="mb-5">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={trocando || submitting}
                onClick={() => {
                  window.location.href = `${(globalThis as any).__API_BASE__ || ""}/api/auth/google`;
                }}
                data-testid="login-google"
              >
                {trocando ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> entrando…</>
                ) : (
                  <>Entrar com Google</>
                )}
              </Button>
              {/* ⚠️ A senha CONTINUA valendo, de propósito: se o Google cair, o
                  dono não fica trancado fora do próprio DRE. */}
              <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> ou com usuário e senha
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-xs">Usuário</Label>
              <Input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="seu-usuario"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="login-username"
                disabled={submitting}
              />
            </div>

            <div>
              <Label className="text-xs">Senha</Label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                data-testid="login-password"
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary hover:bg-primary/80 text-white"
              data-testid="login-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Entrando...
                </>
              ) : "Entrar"}
            </Button>
          </form>

          <p className="text-[10px] text-muted-foreground text-center mt-6">
            Greco Sport Barber &middot; Sistema de gestão
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
