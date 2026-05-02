import { useState, useMemo, useEffect } from "react";
import { useStore } from "@/lib/store";
import { MonthSelector } from "@/components/MonthSelector";
import { useTrinksMonth } from "@/hooks/useTrinksMonth";
import { mesAtualSP, labelMesPtBR } from "@/lib/mesUtils";
import { formatCurrency } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, Plus, Filter, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import type { DailyEntry } from "@shared/schema";

function FecharDiaDialog() {
  const { addEntry } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ clients: '', revenue: '', pix: '', cartao: '', dinheiro: '', notes: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: DailyEntry = {
      id: `rev-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      type: 'receita',
      description: 'Fechamento do dia',
      amount: Number(form.revenue) || 0,
      clients: Number(form.clients) || 0,
      pix: Number(form.pix) || 0,
      cartao: Number(form.cartao) || 0,
      dinheiro: Number(form.dinheiro) || 0,
      notes: form.notes,
    };
    addEntry(entry);
    setOpen(false);
    setForm({ clients: '', revenue: '', pix: '', cartao: '', dinheiro: '', notes: '' });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/80 text-white" data-testid="fechar-dia-lancamentos">
          <CalendarCheck className="w-4 h-4 mr-2" />
          Fechar o Dia
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-md">
        <DialogHeader>
          <DialogTitle>Fechar o Dia</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Clientes</Label>
              <Input type="number" value={form.clients} onChange={e => setForm(p => ({ ...p, clients: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <Label className="text-xs">Faturamento (R$)</Label>
              <Input type="number" value={form.revenue} onChange={e => setForm(p => ({ ...p, revenue: e.target.value }))} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Pix</Label>
              <Input type="number" value={form.pix} onChange={e => setForm(p => ({ ...p, pix: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Cartão</Label>
              <Input type="number" value={form.cartao} onChange={e => setForm(p => ({ ...p, cartao: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Dinheiro</Label>
              <Input type="number" value={form.dinheiro} onChange={e => setForm(p => ({ ...p, dinheiro: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
          </div>
          <Button type="submit" className="w-full bg-primary hover:bg-primary/80 text-white">Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddExpenseDialog() {
  const { addEntry } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: '', category: '', description: '', amount: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: DailyEntry = {
      id: `exp-${Date.now()}`,
      date: form.date || new Date().toISOString().split('T')[0],
      type: 'despesa',
      description: form.description,
      amount: Number(form.amount) || 0,
      category: form.category,
    };
    addEntry(entry);
    setOpen(false);
    setForm({ date: '', category: '', description: '', amount: '' });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="add-expense-btn">
          <Plus className="w-4 h-4 mr-2" />
          Adicionar Despesa
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova Despesa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs">Data</Label>
            <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {['Aluguel', 'Folha', 'Produtos', 'Energia', 'Água', 'Internet', 'Manutenção', 'Marketing', 'Outros'].map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Valor (R$)</Label>
            <Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <Button type="submit" className="w-full bg-primary hover:bg-primary/80 text-white">Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Lancamentos() {
  const { entries: demoEntries } = useStore();

  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const [selectedMes, setSelectedMes] = useState<string>(() => {
    if (typeof window === "undefined") return mesCorrente;
    return localStorage.getItem("lancamentos.selectedMes") || mesCorrente;
  });
  useEffect(() => {
    try { localStorage.setItem("lancamentos.selectedMes", selectedMes); } catch {}
  }, [selectedMes]);

  const {
    trinks, hasTrinksData, loading, error,
    fonte, trinksAt, csvAt, isMesCorrente,
  } = useTrinksMonth(selectedMes);

  const [filter, setFilter] = useState<'todos' | 'receita' | 'despesa'>('todos');

  // Derive entries from Trinks data when available
  const entries = useMemo((): DailyEntry[] => {
    if (!hasTrinksData || !trinks) return isMesCorrente ? demoEntries : [];

    const transacoes = trinks.transacoes || [];
    const dailyMap: Record<string, { revenue: number; clients: number; pix: number; cartao: number; dinheiro: number }> = {};

    transacoes.forEach((t: any) => {
      const raw = t.dataHoraInicio || t.dataHora || t.dataReferencia || t.data || t.date || "";
      const date = typeof raw === "string" ? raw.split("T")[0] : "";
      if (!date) return;

      if (!dailyMap[date]) dailyMap[date] = { revenue: 0, clients: 0, pix: 0, cartao: 0, dinheiro: 0 };
      dailyMap[date].revenue += Number(t.totalPagar || t.valor || 0);
      dailyMap[date].clients += 1;

      const formas = t.formasPagamentos || t.formasPagamento || [];
      if (Array.isArray(formas)) {
        formas.forEach((fp: any) => {
          const nome = (fp.nome || fp.descricao || fp.formaPagamento?.nome || "").toLowerCase();
          const val = Number(fp.valor || 0);
          if (nome.includes("pix")) dailyMap[date].pix += val;
          else if (nome.includes("créd") || nome.includes("cred") || nome.includes("déb") || nome.includes("deb") || nome.includes("cart")) dailyMap[date].cartao += val;
          else if (nome.includes("dinhe") || nome.includes("espécie")) dailyMap[date].dinheiro += val;
        });
      }
    });

    return Object.entries(dailyMap)
      .map(([date, data]) => ({
        id: `trinks-${date}`,
        date,
        type: 'receita' as const,
        description: `Faturamento do dia`,
        amount: data.revenue,
        clients: data.clients,
        pix: data.pix,
        cartao: data.cartao,
        dinheiro: data.dinheiro,
      }));
  }, [hasTrinksData, trinks, demoEntries, isMesCorrente]);

  const filtered = useMemo(() => {
    let list = [...entries];
    if (filter !== 'todos') list = list.filter(e => e.type === filter);
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, filter]);

  const totalReceita = entries.filter(e => e.type === 'receita').reduce((s, e) => s + e.amount, 0);
  const totalDespesa = entries.filter(e => e.type === 'despesa').reduce((s, e) => s + e.amount, 0);

  const monthLabelCapital = labelMesPtBR(selectedMes);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Lançamentos</h2>
          <p className="text-sm text-muted-foreground">
            Receitas e despesas de {monthLabelCapital}
            {hasTrinksData && <span className="text-primary ml-1">• Dados Trinks</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <MonthSelector
            selectedMes={selectedMes}
            onChange={setSelectedMes}
            mesCorrente={mesCorrente}
            isMesCorrente={isMesCorrente}
            loading={loading}
            error={error}
            fonte={fonte}
            trinksAt={trinksAt}
            csvAt={csvAt}
          />
          <AddExpenseDialog />
          <FecharDiaDialog />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4 flex items-center gap-3">
            <ArrowUpCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total Receitas</p>
              <p className="text-lg font-bold text-green-500" data-testid="total-receita">{formatCurrency(totalReceita)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4 flex items-center gap-3">
            <ArrowDownCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total Despesas</p>
              <p className="text-lg font-bold text-red-500" data-testid="total-despesa">{formatCurrency(totalDespesa)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Saldo</p>
              <p className={`text-lg font-bold ${totalReceita - totalDespesa >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid="saldo">
                {formatCurrency(totalReceita - totalDespesa)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['todos', 'receita', 'despesa'] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f)}
            className={filter === f ? 'bg-primary hover:bg-primary/80 text-white' : ''}
            data-testid={`filter-${f}`}
          >
            {f === 'todos' ? 'Todos' : f === 'receita' ? 'Receitas' : 'Despesas'}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Data</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Tipo</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Descrição</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">Categoria</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30" data-testid={`entry-${entry.id}`}>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={entry.type === 'receita' ? 'default' : 'destructive'}
                        className={`text-[10px] ${entry.type === 'receita' ? 'bg-green-500/15 text-green-500 hover:bg-green-500/20' : 'bg-red-500/15 text-red-500 hover:bg-red-500/20'}`}
                      >
                        {entry.type === 'receita' ? 'Receita' : 'Despesa'}
                      </Badge>
                    </td>
                    <td className="p-3 text-sm">
                      {entry.description}
                      {entry.clients != null && entry.clients > 0 && (
                        <span className="text-xs text-muted-foreground ml-2">({entry.clients} clientes)</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground hidden sm:table-cell">{entry.category || '—'}</td>
                    <td className={`p-3 text-right font-medium ${entry.type === 'receita' ? 'text-green-500' : 'text-red-500'}`}>
                      {entry.type === 'despesa' ? '-' : ''}{formatCurrency(entry.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
