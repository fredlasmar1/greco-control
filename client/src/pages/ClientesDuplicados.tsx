import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatNumber } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Search,
  AlertTriangle,
  Copy,
  ChevronDown,
  ChevronUp,
  Phone,
  Calendar,
  Mail,
  UserX,
  UserCheck,
  Info,
  ExternalLink,
  Loader2,
} from "lucide-react";

interface DuplicateClient {
  id: number;
  nome: string;
  email: string | null;
  dataCadastro: string;
  telefoneOriginal: string;
  telefoneNormalizado: string;
}

interface DuplicateGroup {
  telefone: string;
  telefoneFormatado: string;
  count: number;
  clientes: DuplicateClient[];
}

interface DuplicateData {
  totalClientes: number;
  clientsWithPhone: number;
  clientsWithoutPhone: number;
  totalGruposDuplicados: number;
  totalClientesDuplicados: number;
  potencialReducao: number;
  grupos: DuplicateGroup[];
}

export default function ClientesDuplicados() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<DuplicateData>({
    queryKey: ["/api/clientes/duplicados"],
  });

  const filteredGroups = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.grupos;
    const term = search.toLowerCase();
    return data.grupos.filter(g =>
      g.clientes.some(c =>
        c.nome.toLowerCase().includes(term) ||
        c.telefoneOriginal.includes(term) ||
        c.telefoneNormalizado.includes(term)
      )
    );
  }, [data, search]);

  const toggleExpand = (phone: string) => {
    setExpanded(prev => ({ ...prev, [phone]: !prev[phone] }));
  };

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    filteredGroups.forEach(g => { allExpanded[g.telefone] = true; });
    setExpanded(allExpanded);
  };

  const collapseAll = () => setExpanded({});

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Analisando clientes duplicados...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <h2 className="text-lg font-semibold">Clientes Duplicados</h2>
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <p className="text-xs">Erro ao carregar dados de clientes. Verifique a conexão com a Trinks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Clientes Duplicados</h2>
        <p className="text-sm text-muted-foreground">
          Identificação por número de telefone — organize sua base na Trinks
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-[#01696F]/15 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-[#01696F]" />
              </div>
              <p className="text-xs text-muted-foreground">Total de Clientes</p>
            </div>
            <p className="text-xl font-bold">{formatNumber(data.totalClientes)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {data.clientsWithPhone} com telefone
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-red-500/15 flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              </div>
              <p className="text-xs text-muted-foreground">Grupos Duplicados</p>
            </div>
            <p className="text-xl font-bold text-red-400">{formatNumber(data.totalGruposDuplicados)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              telefones com mais de 1 cadastro
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-orange-500/15 flex items-center justify-center">
                <UserX className="w-3.5 h-3.5 text-orange-400" />
              </div>
              <p className="text-xs text-muted-foreground">Cadastros Duplicados</p>
            </div>
            <p className="text-xl font-bold text-orange-400">{formatNumber(data.totalClientesDuplicados)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              clientes envolvidos em duplicações
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-green-500/15 flex items-center justify-center">
                <UserCheck className="w-3.5 h-3.5 text-green-500" />
              </div>
              <p className="text-xs text-muted-foreground">Redução Potencial</p>
            </div>
            <p className="text-xl font-bold text-green-500">{formatNumber(data.potencialReducao)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              cadastros que podem ser unificados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Without phone warning */}
      {data.clientsWithoutPhone > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <Phone className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs">
            <strong>{data.clientsWithoutPhone}</strong> clientes sem telefone cadastrado — não puderam ser analisados.
          </p>
        </div>
      )}

      {/* Search + controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="pl-9 h-9"
            data-testid="search-duplicates"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll} className="text-xs h-8">
            <ChevronDown className="w-3 h-3 mr-1" />
            Expandir Todos
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll} className="text-xs h-8">
            <ChevronUp className="w-3 h-3 mr-1" />
            Recolher
          </Button>
        </div>
        <Badge variant="outline" className="text-xs">
          {filteredGroups.length} grupo{filteredGroups.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Duplicate groups */}
      {filteredGroups.length === 0 ? (
        <Card className="bg-card border-card-border">
          <CardContent className="p-8 text-center text-muted-foreground">
            {search ? "Nenhum resultado para essa busca." : "Nenhum cliente duplicado encontrado."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredGroups.map((group) => {
            const isExpanded = !!expanded[group.telefone];

            return (
              <Card key={group.telefone} className="bg-card border-card-border">
                <CardContent className="p-0">
                  {/* Group header */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/5 transition-colors"
                    onClick={() => toggleExpand(group.telefone)}
                  >
                    <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-red-400">{group.count}x</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Phone className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm font-mono font-medium">{group.telefoneFormatado}</span>
                        <Badge className="bg-red-500/15 text-red-400 border-0 text-[10px]">
                          {group.count} cadastros
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {group.clientes.slice(0, 3).map((c, i) => (
                          <span key={c.id} className="text-xs text-muted-foreground">
                            {i > 0 && "• "}
                            {c.nome}
                          </span>
                        ))}
                        {group.count > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{group.count - 3} mais</span>
                        )}
                      </div>
                    </div>

                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border/50 p-3 bg-muted/5 space-y-2">
                      {group.clientes.map((client, idx) => (
                        <div
                          key={client.id}
                          className={`flex items-start gap-3 p-2.5 rounded-md border ${
                            idx === 0
                              ? "border-green-500/30 bg-green-500/5"
                              : "border-border/50 bg-card"
                          }`}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {idx === 0 ? (
                              <Badge className="bg-green-500/15 text-green-500 border-0 text-[9px]">
                                Mais antigo
                              </Badge>
                            ) : (
                              <Badge className="bg-red-500/10 text-red-400 border-0 text-[9px]">
                                Duplicado
                              </Badge>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold">{client.nome}</p>
                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {client.telefoneOriginal}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatDate(client.dataCadastro)}
                              </span>
                              {client.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3 h-3" />
                                  {client.email}
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-muted-foreground/50">
                                ID: {client.id}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(client.nome, String(client.id));
                              }}
                            >
                              <Copy className="w-3 h-3 mr-1" />
                              {copiedId === String(client.id) ? "Copiado!" : "Nome"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`https://app.trinks.com/clientes/${client.id}`, "_blank");
                              }}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              Trinks
                            </Button>
                          </div>
                        </div>
                      ))}

                      <div className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
                        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <p>
                          O cadastro <strong>mais antigo</strong> (verde) geralmente é o principal.
                          Abra na Trinks para unificar os cadastros duplicados manualmente.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Summary info */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-[#01696F]/10 border border-[#01696F]/20">
        <Info className="w-4 h-4 text-[#01696F] flex-shrink-0 mt-0.5" />
        <div className="text-xs text-[#01696F]">
          <p className="font-medium mb-1">Como organizar:</p>
          <p>1. Expanda cada grupo para ver os cadastros duplicados</p>
          <p>2. O cadastro <strong>mais antigo</strong> (verde) geralmente é o principal — mantenha esse</p>
          <p>3. Clique em "Trinks" para abrir o cadastro do cliente diretamente na Trinks</p>
          <p>4. Na Trinks, transfira os agendamentos do duplicado para o principal e exclua o duplicado</p>
          <p className="mt-1">A análise é feita pelos últimos 8-9 dígitos do telefone, ignorando formatação.</p>
        </div>
      </div>
    </div>
  );
}
