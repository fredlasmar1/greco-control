import { useState } from "react";
import { useStore } from "@/lib/store";
import { useTrinksStore, formatLastSync } from "@/lib/trinksStore";
import { formatCurrency } from "@/lib/demoData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Settings,
  Key,
  CheckCircle,
  XCircle,
  Building,
  Clock,
  Percent,
  Target,
  Armchair,
  RefreshCw,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";

export default function Configuracoes() {
  const { settings, updateSettings } = useStore();
  const { toast } = useToast();
  const [form, setForm] = useState({ ...settings });
  const [apiKeyEditing, setApiKeyEditing] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [newEstablishmentId, setNewEstablishmentId] = useState('');

  const {
    isConnected,
    isSyncing,
    isTesting,
    isLoadingConfig,
    lastSync,
    trinks,
    establishmentName,
    savedMaskedKey,
    savedEstablishmentId,
    fromCache,
    rateLimited,
    warning,
    saveConfig,
    testConnection,
    syncData,
    clearCache,
  } = useTrinksStore();

  // Pre-fill establishment ID from saved config
  useState(() => {
    if (savedEstablishmentId && !newEstablishmentId) {
      setNewEstablishmentId(savedEstablishmentId);
    }
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(form);
    toast({
      title: "Configurações salvas",
      description: "As alterações foram aplicadas com sucesso.",
    });
  };

  const handleTestConnection = async () => {
    // Use the new key if editing, otherwise rely on saved config
    const keyToUse = apiKeyEditing ? newApiKey : '';
    const estIdToUse = apiKeyEditing ? newEstablishmentId : (savedEstablishmentId || '');

    if (!keyToUse && !savedMaskedKey) {
      toast({
        title: "Erro",
        description: "Insira a chave da API Trinks antes de testar.",
        variant: "destructive",
      });
      return;
    }

    // If there's a new key, save it to backend first
    if (keyToUse) {
      await saveConfig(keyToUse, estIdToUse);
      setApiKeyEditing(false);
      setNewApiKey('');
    }

    // Test the connection
    const result = await testConnection();
    if (result.ok) {
      toast({
        title: "Conexão realizada com sucesso!",
        description: `Estabelecimento: ${result.name}`,
      });
    } else {
      toast({
        title: "Erro de conexão",
        description: result.error || "Verifique as credenciais da API.",
        variant: "destructive",
      });
    }
  };

  const handleSync = async (force: boolean = false) => {
    if (!isConnected && !savedMaskedKey) {
      toast({
        title: "Erro",
        description: "Teste a conexão antes de sincronizar.",
        variant: "destructive",
      });
      return;
    }

    if (force) {
      await clearCache();
    }

    const result = await syncData(force);
    if (result.ok) {
      toast({
        title: force ? "Dados atualizados" : "Sincronização concluída",
        description: force
          ? "Dados buscados diretamente da Trinks."
          : "Dados da Trinks carregados.",
      });
    } else {
      toast({
        title: "Erro na sincronização",
        description: result.error || "Não foi possível sincronizar os dados.",
        variant: "destructive",
      });
    }
  };

  const update = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6 max-w-[800px]">
      <div>
        <h2 className="text-lg font-semibold">Configurações</h2>
        <p className="text-sm text-muted-foreground">
          Dados da barbearia e integrações
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Shop Info */}
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building className="w-4 h-4 text-primary" />
              Informações da Barbearia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={form.shopName}
                onChange={(e) => update("shopName", e.target.value)}
                data-testid="input-shop-name"
              />
            </div>
            <div>
              <Label className="text-xs">Endereço</Label>
              <Input
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                data-testid="input-address"
              />
            </div>
            <div>
              <Label className="text-xs">Horário de Funcionamento</Label>
              <Input
                value={form.hours}
                onChange={(e) => update("hours", e.target.value)}
                data-testid="input-hours"
              />
            </div>
          </CardContent>
        </Card>

        {/* API Keys + Connection */}
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              Integração Trinks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Connection status banner */}
            {isConnected && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-500/10 border border-green-500/20">
                <Wifi className="w-4 h-4 text-green-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-green-500">
                    Conectado à Trinks
                  </p>
                  {establishmentName && (
                    <p className="text-[10px] text-green-500/70 truncate">
                      {establishmentName}
                    </p>
                  )}
                </div>
                {lastSync && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatLastSync(lastSync)}
                  </p>
                )}
              </div>
            )}

            {/* Loading state */}
            {isLoadingConfig && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/40">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Carregando credenciais salvas...</p>
              </div>
            )}

            {/* Saved key display or edit form */}
            {savedMaskedKey && !apiKeyEditing ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Trinks API Key</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 px-3 py-2 rounded-md border border-border bg-muted/30 text-sm font-mono text-muted-foreground">
                      {savedMaskedKey}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setApiKeyEditing(true);
                        setNewEstablishmentId(savedEstablishmentId || '');
                      }}
                      className="text-xs"
                    >
                      Alterar
                    </Button>
                  </div>
                  <p className="text-[10px] text-green-500/70 mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Chave salva no servidor
                  </p>
                </div>
                {savedEstablishmentId && (
                  <div>
                    <Label className="text-xs">Trinks Establishment ID</Label>
                    <div className="px-3 py-2 rounded-md border border-border bg-muted/30 text-sm text-muted-foreground mt-1">
                      {savedEstablishmentId}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Trinks API Key</Label>
                  <Input
                    type="password"
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    placeholder="Insira a chave da API Trinks"
                    data-testid="input-trinks-key"
                  />
                </div>
                <div>
                  <Label className="text-xs">Trinks Establishment ID</Label>
                  <Input
                    value={newEstablishmentId}
                    onChange={(e) => setNewEstablishmentId(e.target.value)}
                    placeholder="ID do estabelecimento no Trinks (opcional)"
                    data-testid="input-trinks-id"
                  />
                </div>
                {apiKeyEditing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setApiKeyEditing(false)}
                    className="text-xs text-muted-foreground"
                  >
                    Cancelar alteração
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={isTesting}
                data-testid="test-connection-btn"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Testando...
                  </>
                ) : (
                  "Testar Conexão"
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSync(false)}
                disabled={isSyncing}
                data-testid="sync-data-btn"
                className={
                  isConnected
                    ? "border-primary/30 text-primary hover:bg-primary/10"
                    : ""
                }
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 mr-2" />
                    Sincronizar
                  </>
                )}
              </Button>

              {isConnected && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync(true)}
                  disabled={isSyncing}
                  data-testid="force-sync-btn"
                  className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  Forçar Atualização
                </Button>
              )}

              {isConnected && (
                <CheckCircle className="w-4 h-4 text-green-500" />
              )}
            </div>

            {/* Cache/rate limit info */}
            {isConnected && (fromCache || rateLimited || warning) && (
              <div className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
                rateLimited
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                  : 'bg-muted/30 text-muted-foreground'
              }`}>
                <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div>
                  {rateLimited && <p className="font-medium">Limite de requisições atingido</p>}
                  {fromCache && !rateLimited && <p>Dados carregados do cache.</p>}
                  {warning && <p>{warning}</p>}
                  <p className="mt-0.5 opacity-70">
                    Use "Forçar Atualização" para buscar dados novos da Trinks.
                    O cache evita exceder o limite de 5.000 requisições/mês.
                  </p>
                </div>
              </div>
            )}

            {/* Sync summary */}
            {trinks && (
              <div className="border-t border-border pt-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
                  Dados sincronizados
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="px-2 py-1.5 rounded bg-muted/40 text-center">
                    <p className="text-sm font-semibold">
                      {trinks.profissionais.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Profissionais
                    </p>
                  </div>
                  <div className="px-2 py-1.5 rounded bg-muted/40 text-center">
                    <p className="text-sm font-semibold">
                      {trinks.servicos.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Serviços
                    </p>
                  </div>
                  <div className="px-2 py-1.5 rounded bg-muted/40 text-center">
                    <p className="text-sm font-semibold">
                      {trinks.agendamentos.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Agendamentos
                    </p>
                  </div>
                  <div className="px-2 py-1.5 rounded bg-muted/40 text-center">
                    <p className="text-sm font-semibold">
                      {trinks.transacoes.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Transações
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <Label className="text-xs">Perplexity API Key</Label>
              <Input
                type="password"
                value={form.perplexityApiKey}
                onChange={(e) => update("perplexityApiKey", e.target.value)}
                placeholder="Insira a chave da API Perplexity"
                data-testid="input-perplexity-key"
              />
            </div>
          </CardContent>
        </Card>

        {/* Business Settings */}
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" />
              Parâmetros do Negócio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Percent className="w-3 h-3" />
                  Comissão Padrão (%)
                </Label>
                <Input
                  type="number"
                  value={form.defaultCommission}
                  onChange={(e) =>
                    update("defaultCommission", Number(e.target.value))
                  }
                  data-testid="input-commission"
                />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Meta Mensal (R$)
                </Label>
                <Input
                  type="number"
                  value={form.monthlyTarget}
                  onChange={(e) =>
                    update("monthlyTarget", Number(e.target.value))
                  }
                  data-testid="input-target"
                />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Armchair className="w-3 h-3" />
                  Nº de Cadeiras
                </Label>
                <Input
                  type="number"
                  value={form.chairs}
                  onChange={(e) => update("chairs", Number(e.target.value))}
                  data-testid="input-chairs"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button
          type="submit"
          className="bg-primary hover:bg-primary/80 text-white w-full"
          data-testid="save-settings"
        >
          Salvar Configurações
        </Button>
      </form>
    </div>
  );
}
