import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/authStore";
import grecoLogo from "../../logo-greco.png";
import { Loader2, AlertCircle } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, user, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
            <img src={grecoLogo} alt="Greco" className="w-16 h-16 mb-3 rounded-lg" />
            <h1 className="text-lg font-bold">Greco Control</h1>
            <p className="text-xs text-muted-foreground mt-1">Entre com seu usuário e senha</p>
          </div>

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
            Greco Barbearia &middot; Sistema de gestão
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
