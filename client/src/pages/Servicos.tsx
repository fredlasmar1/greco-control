import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { useTrinksStore, mapTrinksServicos } from "@/lib/trinksStore";
import { formatCurrency, formatPercent } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Scissors, Info } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Link } from "wouter";
import type { Service } from "@shared/schema";

function AddServiceDialog() {
  const { addService, services } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    price: "",
    duration: "",
    cost: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(form.price) || 0;
    const cost = Number(form.cost) || 0;
    const service: Service = {
      id: String(services.length + 1),
      name: form.name,
      price,
      avgDuration: Number(form.duration) || 30,
      cost,
      margin: price > 0 ? ((price - cost) / price) * 100 : 0,
      popularity: 0,
    };
    addService(service);
    setOpen(false);
    setForm({ name: "", price: "", duration: "", cost: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="bg-primary hover:bg-primary/80 text-white"
          data-testid="add-service-btn"
        >
          <Plus className="w-4 h-4 mr-2" />
          Adicionar Serviço
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-card-border max-w-sm">
        <DialogHeader>
          <DialogTitle>Novo Serviço</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs">Nome do Serviço</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Ex: Corte"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Preço (R$)</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) =>
                  setForm((p) => ({ ...p, price: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs">Duração (min)</Label>
              <Input
                type="number"
                value={form.duration}
                onChange={(e) =>
                  setForm((p) => ({ ...p, duration: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs">Custo (R$)</Label>
              <Input
                type="number"
                value={form.cost}
                onChange={(e) =>
                  setForm((p) => ({ ...p, cost: e.target.value }))
                }
              />
            </div>
          </div>
          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/80 text-white"
          >
            Salvar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Servicos() {
  const { services: demoServices } = useStore();
  const { isConnected, trinks } = useTrinksStore();
  const hasTrinksData = isConnected && trinks !== null;

  const services = useMemo(() => {
    if (hasTrinksData) {
      const mapped = mapTrinksServicos(trinks!);
      return mapped.length > 0 ? mapped : demoServices;
    }
    return demoServices;
  }, [hasTrinksData, trinks, demoServices]);

  const popularityChart = [...services]
    .sort((a, b) => b.popularity - a.popularity)
    .map((s) => ({ name: s.name, quantidade: s.popularity }));

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Serviços</h2>
          <p className="text-sm text-muted-foreground">
            {services.length} serviços cadastrados
            {hasTrinksData && (
              <span className="text-primary ml-1">• Dados Trinks</span>
            )}
          </p>
        </div>
        <AddServiceDialog />
      </div>

      {!hasTrinksData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <Info className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs">
            Dados de demonstração —{" "}
            <Link
              href="/configuracoes"
              className="underline hover:text-amber-400"
            >
              conecte a Trinks nas Configurações
            </Link>
          </p>
        </div>
      )}

      {/* Popularity chart */}
      {popularityChart.some((p) => p.quantidade > 0) && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Serviços Mais Populares
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={popularityChart}
                  layout="vertical"
                  margin={{ left: 10 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#333"
                    horizontal={false}
                  />
                  <XAxis type="number" stroke="#666" fontSize={11} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="#666"
                    fontSize={11}
                    width={120}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1a1a1a",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="quantidade" radius={[0, 4, 4, 0]}>
                    {popularityChart.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          i === 0
                            ? "#1E3A5F"
                            : i < 3
                              ? "#152D4A"
                              : "#1a3a3c"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Services table */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">
                    Serviço
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">
                    Preço
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">
                    Duração
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">
                    Custo
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">
                    Margem
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">
                    Qtd. Mês
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr
                    key={service.id}
                    className="border-b border-border/50 hover:bg-muted/30"
                    data-testid={`service-row-${service.id}`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Scissors className="w-3.5 h-3.5 text-primary" />
                        <span className="font-medium">{service.name}</span>
                      </div>
                    </td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(service.price)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground hidden sm:table-cell">
                      {service.avgDuration} min
                    </td>
                    <td className="p-3 text-right text-muted-foreground hidden sm:table-cell">
                      {formatCurrency(service.cost)}
                    </td>
                    <td className="p-3 text-right">
                      <span
                        className={`text-xs font-medium ${service.margin >= 85 ? "text-green-500" : service.margin >= 80 ? "text-yellow-500" : "text-orange-500"}`}
                      >
                        {formatPercent(service.margin)}
                      </span>
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {service.popularity}
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
