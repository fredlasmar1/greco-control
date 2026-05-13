// Painel de gestão do dicionário "id Trinks legado → nome do profissional".
// Resolve casos como 'Profissional 644414' em Vendas Produtos / Pagamento
// quando o id da transação não bate com nenhum profissional cadastrado
// (geralmente ex-funcionário ou id antigo da Trinks).
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, Trash2, Save, X } from "lucide-react";

interface Mapa { [id: string]: string }

export function ProfsConhecidosManager() {
  const [mapa, setMapa] = useState<Mapa>({});
  const [loading, setLoading] = useState(false);
  const [novoId, setNovoId] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch("/api/profissionais-conhecidos");
      const j = await r.json();
      if (j.ok) setMapa(j.profissionais || {});
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { carregar(); }, []);

  async function adicionar() {
    const id = novoId.trim();
    const nome = novoNome.trim();
    if (!id || !nome) { alert("Preencha ID e nome"); return; }
    const r = await fetch("/api/profissionais-conhecidos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, nome }),
    });
    const j = await r.json();
    if (!j.ok) { alert("Erro: " + (j.error || "")); return; }
    setNovoId(""); setNovoNome("");
    await carregar();
  }

  async function salvarEdit(id: string) {
    const nome = editNome.trim();
    if (!nome) { alert("Nome vazio"); return; }
    await fetch("/api/profissionais-conhecidos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, nome }),
    });
    setEditando(null); setEditNome("");
    await carregar();
  }

  async function remover(id: string) {
    if (!confirm(`Remover mapeamento ${id} → ${mapa[id]}?`)) return;
    await fetch(`/api/profissionais-conhecidos/${id}`, { method: "DELETE" });
    await carregar();
  }

  const entries = Object.entries(mapa).sort((a, b) => a[1].localeCompare(b[1]));
  const exFuncs = entries.filter(([_, n]) => /ex.?func/i.test(n));
  const ativos = entries.filter(([_, n]) => !/ex.?func/i.test(n));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="w-4 h-4" />
          Profissionais — IDs legados da Trinks
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Mapeia IDs antigos (ex: 644414) ao nome real do profissional. Necessário pra resolver "Profissional X" em Vendas Produtos e relatórios.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Adicionar novo */}
        <div className="rounded-md border border-dashed border-card-border p-2 space-y-2">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Adicionar mapeamento</p>
          <div className="flex gap-2">
            <Input
              value={novoId} onChange={e => setNovoId(e.target.value.replace(/\D/g, ""))}
              placeholder="ID Trinks (ex: 644414)"
              className="h-8 text-xs w-[140px] tabular-nums"
            />
            <Input
              value={novoNome} onChange={e => setNovoNome(e.target.value)}
              placeholder="Nome (ex: FERNANDA SILVA ou EX-FUNCIONÁRIO)"
              className="h-8 text-xs flex-1"
            />
            <Button type="button" size="sm" onClick={adicionar} className="h-8">
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
        </div>

        {/* Lista atuais */}
        {loading && <p className="text-xs text-muted-foreground italic">Carregando…</p>}
        {!loading && entries.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nenhum mapeamento cadastrado.</p>
        )}

        {ativos.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Mapeados a profissionais ativos ({ativos.length})</p>
            <div className="space-y-1">
              {ativos.map(([id, nome]) => (
                <Linha
                  key={id} id={id} nome={nome}
                  editando={editando === id}
                  onEdit={() => { setEditando(id); setEditNome(nome); }}
                  onCancel={() => { setEditando(null); setEditNome(""); }}
                  onSave={() => salvarEdit(id)}
                  onRemove={() => remover(id)}
                  editNome={editNome} setEditNome={setEditNome}
                />
              ))}
            </div>
          </div>
        )}
        {exFuncs.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Ex-funcionários / Histórico ({exFuncs.length})</p>
            <div className="space-y-1">
              {exFuncs.map(([id, nome]) => (
                <Linha
                  key={id} id={id} nome={nome}
                  editando={editando === id}
                  onEdit={() => { setEditando(id); setEditNome(nome); }}
                  onCancel={() => { setEditando(null); setEditNome(""); }}
                  onSave={() => salvarEdit(id)}
                  onRemove={() => remover(id)}
                  editNome={editNome} setEditNome={setEditNome}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Linha({ id, nome, editando, editNome, setEditNome, onEdit, onCancel, onSave, onRemove }: {
  id: string; nome: string; editando: boolean; editNome: string;
  setEditNome: (s: string) => void;
  onEdit: () => void; onCancel: () => void; onSave: () => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-card-border/40 bg-background/30 p-2 text-xs">
      <code className="bg-muted/40 px-1.5 py-0.5 rounded text-[10px] tabular-nums w-20 text-center">{id}</code>
      {editando ? (
        <>
          <Input
            value={editNome} onChange={e => setEditNome(e.target.value)}
            className="h-7 text-xs flex-1"
            autoFocus
          />
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onSave} title="Salvar">
            <Save className="w-3 h-3" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel} title="Cancelar">
            <X className="w-3 h-3" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 font-medium">{nome}</span>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={onEdit}>
            Editar
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" onClick={onRemove}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </>
      )}
    </div>
  );
}
