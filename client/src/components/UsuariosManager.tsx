import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { authFetch, AuthUser, useAuth } from "@/lib/authStore";
import { useTrinksStore, mapTrinksProfissionais } from "@/lib/trinksStore";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus, Trash2, Key, Users as UsersIcon, ShieldCheck, Scissors, Power,
} from "lucide-react";

export function UsuariosManager() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { trinks, isConnected } = useTrinksStore();
  const [usuarios, setUsuarios] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/auth/usuarios");
      if (res.ok) setUsuarios(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const barbeirosTrinks = isConnected && trinks ? mapTrinksProfissionais(trinks).filter(b => b.active) : [];

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UsersIcon className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">Usuários do Sistema</CardTitle>
          </div>
          <NovoUsuarioDialog onSaved={load} barbeiros={barbeirosTrinks} />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Carregando...</div>
        ) : usuarios.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Nenhum usuário cadastrado.</div>
        ) : (
          <div className="divide-y divide-border">
            {usuarios.map(u => (
              <UsuarioRow
                key={u.id}
                usuario={u}
                isCurrentUser={u.id === currentUser?.id}
                onChanged={load}
                barbeiros={barbeirosTrinks}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UsuarioRow({
  usuario, isCurrentUser, onChanged, barbeiros,
}: {
  usuario: AuthUser;
  isCurrentUser: boolean;
  onChanged: () => void;
  barbeiros: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const barbeiroNome = usuario.barberId ? barbeiros.find(b => b.id === usuario.barberId)?.name : null;

  const toggleAtivo = async () => {
    await authFetch(`/api/auth/usuarios/${usuario.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: !usuario.ativo }),
    });
    toast({ title: usuario.ativo ? "Usuário desativado" : "Usuário ativado" });
    onChanged();
  };

  const excluir = async () => {
    if (!confirm(`Excluir usuário "${usuario.nome}"?`)) return;
    const res = await authFetch(`/api/auth/usuarios/${usuario.id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "Usuário excluído" });
      onChanged();
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Erro", description: err.error, variant: "destructive" });
    }
  };

  return (
    <div className="flex items-center gap-3 p-3">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${usuario.role === "admin" ? "bg-primary/20" : "bg-emerald-500/15"}`}>
        {usuario.role === "admin" ? (
          <ShieldCheck className="w-4 h-4 text-primary" />
        ) : (
          <Scissors className="w-4 h-4 text-emerald-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold truncate">{usuario.nome}</p>
          {isCurrentUser && <Badge variant="outline" className="text-[10px]">você</Badge>}
          {!usuario.ativo && <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/40">inativo</Badge>}
        </div>
        <p className="text-[10px] text-muted-foreground">
          @{usuario.username} · {usuario.role === "admin" ? "Admin" : "Barbeiro"}
          {barbeiroNome && ` · ${barbeiroNome}`}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <ResetPasswordDialog usuario={usuario} />
        <EditUsuarioDialog usuario={usuario} onSaved={onChanged} barbeiros={barbeiros} />
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground" onClick={toggleAtivo} title={usuario.ativo ? "Desativar" : "Ativar"}>
          <Power className="w-3.5 h-3.5" />
        </Button>
        {!isCurrentUser && (
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400 hover:text-red-300" onClick={excluir} title="Excluir">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function NovoUsuarioDialog({ onSaved, barbeiros }: { onSaved: () => void; barbeiros: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [role, setRole] = useState<"admin" | "barbeiro">("barbeiro");
  const [barberId, setBarberId] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!username.trim() || !password.trim() || !nome.trim()) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    if (password.length < 4) {
      toast({ title: "Senha muito curta", description: "Mínimo 4 caracteres.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/auth/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, nome, role, barberId: role === "barbeiro" ? barberId : undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Erro", description: err.error || "Não foi possível criar", variant: "destructive" });
        return;
      }
      toast({ title: "Usuário criado!" });
      setOpen(false);
      setUsername(""); setPassword(""); setNome(""); setBarberId("");
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-primary hover:bg-primary/80 text-white h-8">
          <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Novo
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome completo *</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Lucas Silva" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Usuário *</Label>
              <Input value={username} onChange={e => setUsername(e.target.value.replace(/\s/g, ""))} placeholder="lucas" autoCapitalize="none" />
            </div>
            <div>
              <Label className="text-xs">Senha *</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={role} onValueChange={v => setRole(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin (acesso total)</SelectItem>
                <SelectItem value="barbeiro">Barbeiro (só painel próprio)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === "barbeiro" && (
            <div>
              <Label className="text-xs">Vincular ao profissional do Trinks</Label>
              <Select value={barberId} onValueChange={setBarberId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {barbeiros.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {barbeiros.length === 0 && (
                <p className="text-[10px] text-amber-400 mt-1">Conecte a Trinks primeiro para vincular</p>
              )}
            </div>
          )}
          <Button onClick={save} disabled={saving} className="w-full bg-primary hover:bg-primary/80 text-white">
            {saving ? "Criando..." : "Criar usuário"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditUsuarioDialog({ usuario, onSaved, barbeiros }: { usuario: AuthUser; onSaved: () => void; barbeiros: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(usuario.nome);
  const [barberId, setBarberId] = useState(usuario.barberId || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNome(usuario.nome);
      setBarberId(usuario.barberId || "");
    }
  }, [open, usuario]);

  const save = async () => {
    setSaving(true);
    try {
      await authFetch(`/api/auth/usuarios/${usuario.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          barberId: usuario.role === "barbeiro" ? (barberId || undefined) : undefined,
        }),
      });
      toast({ title: "Usuário atualizado" });
      setOpen(false);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" title="Editar">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader><DialogTitle>Editar {usuario.nome}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          {usuario.role === "barbeiro" && (
            <div>
              <Label className="text-xs">Vincular ao profissional do Trinks</Label>
              <Select value={barberId} onValueChange={setBarberId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">(nenhum)</SelectItem>
                  {barbeiros.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={save} disabled={saving} className="w-full bg-primary hover:bg-primary/80 text-white">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ usuario }: { usuario: AuthUser }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = async () => {
    if (password.length < 4) { toast({ title: "Senha muito curta", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await authFetch(`/api/auth/usuarios/${usuario.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        toast({ title: "Senha resetada!", description: `Nova senha de ${usuario.nome}: ${password}` });
        setOpen(false);
        setPassword("");
      } else {
        toast({ title: "Erro", variant: "destructive" });
      }
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-amber-400" title="Resetar senha">
          <Key className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-sm">
        <DialogHeader><DialogTitle className="text-base">Resetar senha de {usuario.nome}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nova senha</Label>
            <Input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Digite a nova senha" />
            <p className="text-[10px] text-muted-foreground mt-1">Anote antes de confirmar — avisaremos apenas uma vez.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button size="sm" className="flex-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={reset} disabled={saving}>
              {saving ? "Salvando..." : "Resetar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
