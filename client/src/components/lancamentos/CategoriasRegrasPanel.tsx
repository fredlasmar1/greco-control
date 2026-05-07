// Painel de gerenciamento de categorias + regras de auto-classificação.
// Renderizado na 3ª aba de Lançamentos.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Save, X, Tag, Filter } from "lucide-react";

type ExpenseTipo =
  | "fixo" | "variavel" | "recorrente" | "cartao"
  | "comissao" | "bonus" | "imposto" | "insumo"
  | "investimento" | "outros";

interface Categoria {
  id: string;
  nome: string;
  tipo: ExpenseTipo;
  cor: string;
  ativa: boolean;
  ordem: number;
  criadoEm: string;
}

interface Regra {
  id: string;
  pattern: string;
  categoriaId: string;
  subcategoria?: string;
  ativa: boolean;
  criadaEm: string;
  vezesAplicada?: number;
}

const TIPOS: { v: ExpenseTipo; label: string }[] = [
  { v: "fixo",         label: "Fixo (não varia com volume)" },
  { v: "variavel",     label: "Variável (varia com volume)" },
  { v: "recorrente",   label: "Recorrente (assinatura mensal)" },
  { v: "cartao",       label: "Cartão (taxa / fatura)" },
  { v: "comissao",     label: "Comissão" },
  { v: "bonus",        label: "Bônus" },
  { v: "imposto",      label: "Imposto" },
  { v: "insumo",       label: "Insumo (ficha técnica)" },
  { v: "investimento", label: "Investimento (CapEx)" },
  { v: "outros",       label: "Outros" },
];

const CORES_PRESET = ["#ef4444","#f59e0b","#eab308","#84cc16","#10b981","#14b8a6","#0ea5e9","#6366f1","#8b5cf6","#a855f7","#ec4899","#f43f5e","#64748b"];

export default function CategoriasRegrasPanel() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  // Edição inline
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatDraft, setEditCatDraft] = useState<Partial<Categoria>>({});
  const [novaCatDraft, setNovaCatDraft] = useState<Partial<Categoria>>({ nome: "", tipo: "fixo", cor: "#64748b", ativa: true, ordem: 50 });
  const [mostrandoNovaCat, setMostrandoNovaCat] = useState(false);

  const [novaRegraDraft, setNovaRegraDraft] = useState<{ pattern: string; categoriaId: string; subcategoria: string }>({ pattern: "", categoriaId: "", subcategoria: "" });
  const [filtroRegraCat, setFiltroRegraCat] = useState<string>("__todas");

  async function carregar() {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        fetch("/api/expense-categorias").then(x => x.json()),
        fetch("/api/expense-regras").then(x => x.json()),
      ]);
      setCategorias(c?.categorias || []);
      setRegras(r?.regras || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  const catMap = useMemo(() => new Map(categorias.map(c => [c.id, c])), [categorias]);

  async function salvarCat(input: Partial<Categoria>) {
    const r = await fetch("/api/expense-categorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const j = await r.json();
    if (!j.ok) { alert("Erro: " + (j.error || "")); return null; }
    return j.categoria as Categoria;
  }

  async function deletarCat(id: string) {
    if (!confirm("Excluir esta categoria? Lançamentos já classificados ficam sem categoria.")) return;
    const r = await fetch(`/api/expense-categorias/${id}`, { method: "DELETE" });
    const j = await r.json();
    if (!j.ok) { alert("Erro: " + (j.error || "")); return; }
    await carregar();
  }

  async function salvarRegra(input: Partial<Regra>) {
    const r = await fetch("/api/expense-regras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const j = await r.json();
    if (!j.ok) { alert("Erro: " + (j.error || "")); return null; }
    return j.regra as Regra;
  }

  async function deletarRegra(id: string) {
    if (!confirm("Excluir esta regra?")) return;
    await fetch(`/api/expense-regras/${id}`, { method: "DELETE" });
    await carregar();
  }

  async function adicionarNovaCat() {
    if (!novaCatDraft.nome?.trim()) return;
    setSalvando("nova-cat");
    try {
      const c = await salvarCat(novaCatDraft);
      if (c) {
        await carregar();
        setNovaCatDraft({ nome: "", tipo: "fixo", cor: "#64748b", ativa: true, ordem: 50 });
        setMostrandoNovaCat(false);
      }
    } finally { setSalvando(null); }
  }

  async function salvarEdicaoCat() {
    if (!editCatId) return;
    setSalvando(editCatId);
    try {
      const c = await salvarCat({ id: editCatId, ...editCatDraft });
      if (c) {
        await carregar();
        setEditCatId(null);
        setEditCatDraft({});
      }
    } finally { setSalvando(null); }
  }

  async function adicionarNovaRegra() {
    if (!novaRegraDraft.pattern.trim() || !novaRegraDraft.categoriaId) {
      alert("Preencha o padrão e selecione uma categoria");
      return;
    }
    setSalvando("nova-regra");
    try {
      const r = await salvarRegra({
        pattern: novaRegraDraft.pattern,
        categoriaId: novaRegraDraft.categoriaId,
        subcategoria: novaRegraDraft.subcategoria || undefined,
        ativa: true,
      });
      if (r) {
        await carregar();
        setNovaRegraDraft({ pattern: "", categoriaId: "", subcategoria: "" });
      }
    } finally { setSalvando(null); }
  }

  async function toggleRegra(id: string, ativa: boolean) {
    const reg = regras.find(r => r.id === id);
    if (!reg) return;
    await salvarRegra({ ...reg, ativa });
    await carregar();
  }

  const regrasFiltradas = useMemo(() => {
    if (filtroRegraCat === "__todas") return regras;
    return regras.filter(r => r.categoriaId === filtroRegraCat);
  }, [regras, filtroRegraCat]);

  return (
    <div className="space-y-5">
      {/* CATEGORIAS */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-400" />
              Categorias ({categorias.length})
            </span>
            <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setMostrandoNovaCat(!mostrandoNovaCat)}>
              <Plus className="w-3 h-3 mr-1" /> Nova categoria
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {mostrandoNovaCat && (
            <div className="rounded-md border border-card-border bg-background/40 p-2 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input placeholder="Nome da categoria" value={novaCatDraft.nome || ""} onChange={e => setNovaCatDraft(p => ({ ...p, nome: e.target.value }))} className="h-8 text-xs" />
                <Select value={novaCatDraft.tipo} onValueChange={(v) => setNovaCatDraft(p => ({ ...p, tipo: v as ExpenseTipo }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tipo contábil" /></SelectTrigger>
                  <SelectContent>{TIPOS.map(t => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center gap-1 flex-wrap">
                  {CORES_PRESET.map(c => (
                    <button key={c} type="button" className={`w-5 h-5 rounded-full border ${novaCatDraft.cor === c ? "ring-2 ring-foreground" : ""}`} style={{ backgroundColor: c }} onClick={() => setNovaCatDraft(p => ({ ...p, cor: c }))} />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setMostrandoNovaCat(false); setNovaCatDraft({ nome: "", tipo: "fixo", cor: "#64748b", ativa: true, ordem: 50 }); }}>Cancelar</Button>
                <Button type="button" size="sm" className="h-7 text-[11px]" onClick={adicionarNovaCat} disabled={salvando === "nova-cat"}>
                  <Save className="w-3 h-3 mr-1" /> Salvar
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {categorias.map(c => {
              const editando = editCatId === c.id;
              if (editando) {
                return (
                  <div key={c.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 space-y-1.5">
                    <Input value={editCatDraft.nome ?? c.nome} onChange={e => setEditCatDraft(p => ({ ...p, nome: e.target.value }))} className="h-7 text-xs" />
                    <Select value={editCatDraft.tipo ?? c.tipo} onValueChange={(v) => setEditCatDraft(p => ({ ...p, tipo: v as ExpenseTipo }))}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{TIPOS.map(t => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <div className="flex items-center gap-1 flex-wrap">
                      {CORES_PRESET.map(cor => (
                        <button key={cor} type="button" className={`w-4 h-4 rounded-full border ${(editCatDraft.cor ?? c.cor) === cor ? "ring-2 ring-foreground" : ""}`} style={{ backgroundColor: cor }} onClick={() => setEditCatDraft(p => ({ ...p, cor }))} />
                      ))}
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setEditCatId(null); setEditCatDraft({}); }}><X className="w-3 h-3" /></Button>
                      <Button type="button" size="sm" className="h-6 text-[10px]" onClick={salvarEdicaoCat} disabled={salvando === c.id}><Save className="w-3 h-3" /></Button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={c.id} className="rounded-md border border-card-border/50 bg-background/30 p-2 flex items-center gap-2 hover:bg-muted/30">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.cor }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{c.nome}</p>
                    <p className="text-[10px] text-muted-foreground">{TIPOS.find(t => t.v === c.tipo)?.label || c.tipo}</p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditCatId(c.id); setEditCatDraft({ nome: c.nome, tipo: c.tipo, cor: c.cor, ordem: c.ordem }); }}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={() => deletarCat(c.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* REGRAS */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-cyan-400" />
              Regras de auto-classificação ({regras.length})
            </span>
            <Select value={filtroRegraCat} onValueChange={setFiltroRegraCat}>
              <SelectTrigger className="h-7 text-[11px] w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__todas">Todas as categorias</SelectItem>
                {categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="rounded-md border border-card-border bg-background/40 p-2 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <Input placeholder='Padrão (ex: "ifood", "vivo")' value={novaRegraDraft.pattern} onChange={e => setNovaRegraDraft(p => ({ ...p, pattern: e.target.value }))} className="h-8 text-xs" />
              <Select value={novaRegraDraft.categoriaId} onValueChange={(v) => setNovaRegraDraft(p => ({ ...p, categoriaId: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>{categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Subcategoria (opcional)" value={novaRegraDraft.subcategoria} onChange={e => setNovaRegraDraft(p => ({ ...p, subcategoria: e.target.value }))} className="h-8 text-xs" />
              <Button type="button" size="sm" className="h-8 text-[11px]" onClick={adicionarNovaRegra} disabled={salvando === "nova-regra"}>
                <Plus className="w-3 h-3 mr-1" /> Adicionar
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              O padrão é comparado <b>case-insensitive</b> contra a descrição da despesa (substring). Ex: "vivo" casa com "VIVO MOVEL", "VIVO FIXO" etc.
            </p>
          </div>

          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {regrasFiltradas.length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-4">
                {filtroRegraCat === "__todas" ? "Nenhuma regra cadastrada." : "Nenhuma regra para esta categoria."}
              </p>
            )}
            {regrasFiltradas.map(r => {
              const cat = catMap.get(r.categoriaId);
              return (
                <div key={r.id} className="flex items-center gap-2 rounded-md border border-card-border/40 bg-background/20 px-2 py-1.5 text-xs">
                  <Switch checked={r.ativa} onCheckedChange={(v) => toggleRegra(r.id, v)} className="scale-75" />
                  <code className="bg-muted/50 px-1.5 py-0.5 rounded text-[10px]">{r.pattern}</code>
                  <span className="text-muted-foreground">→</span>
                  {cat && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.cor }} />}
                  <span className="font-medium">{cat?.nome || "(categoria removida)"}</span>
                  {r.subcategoria && <span className="text-muted-foreground text-[10px]">/ {r.subcategoria}</span>}
                  <span className="ml-auto text-[10px] text-muted-foreground">{r.vezesAplicada || 0}×</span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={() => deletarRegra(r.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
