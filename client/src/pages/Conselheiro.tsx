import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Loader2,
  Scale,
  Stethoscope,
  Users,
  Search,
  TrendingUp,
  AlertTriangle,
  PiggyBank,
  CheckCircle2,
  RotateCw,
} from "lucide-react";
import { formatCurrency } from "@/lib/demoData";

const API_BASE = (globalThis as any).__API_BASE__ || "";
const ACCENT = "#01696F"; // teal do Greco Control

interface ConselheiroSnapshot {
  periodo: { mes_atual: string; gerado_em: string };
  financeiro: {
    faturamento_mes: number;
    var_faturamento: number;
    despesas_mes: number;
    var_despesas: number;
    resultado_liquido: number;
    var_resultado: number;
    inadimplencia: number;
  };
  meta_mensal?: { target: number; achieved: number; pct: number };
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  timestamp: string;
}

const QUICK_QUESTIONS: Array<{ icon: any; label: string; question: string }> = [
  {
    icon: Stethoscope,
    label: "Saúde financeira do mês",
    question: "Como está a saúde financeira da minha barbearia este mês?",
  },
  {
    icon: Users,
    label: "Devo contratar agora?",
    question: "Baseado nos meus dados, devo contratar mais barbeiros agora?",
  },
  {
    icon: Search,
    label: "Onde estou perdendo dinheiro?",
    question: "Onde estou perdendo dinheiro que posso não estar vendo?",
  },
  {
    icon: TrendingUp,
    label: "Tendência dos próximos 3 meses",
    question: "Qual minha tendência para os próximos 3 meses com base no histórico?",
  },
  {
    icon: AlertTriangle,
    label: "Maiores riscos agora",
    question: "Quais são os maiores riscos do meu negócio agora?",
  },
  {
    icon: PiggyBank,
    label: "Investir ou guardar reserva?",
    question: "Tenho capital disponível. Vale investir ou guardar reserva?",
  },
];

function parseMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:' + ACCENT + ';font-weight:600">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-muted-foreground not-italic">$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li.+<\/li>\n?)+/g, (m) => `<ul class="my-2 space-y-1">${m}</ul>`)
    .replace(/\n/g, "<br/>");
}

function MetricCard({
  label,
  value,
  delta,
  invertColor = false,
  loading,
}: {
  label: string;
  value: string;
  delta?: number;
  invertColor?: boolean;
  loading?: boolean;
}) {
  const isUp = (delta ?? 0) >= 0;
  const isGood = invertColor ? !isUp : isUp;
  const sign = isUp ? "+" : "";

  return (
    <Card className="bg-card border-card-border" data-testid={`metric-${label.toLowerCase()}`}>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
          {label}
        </div>
        <div className="text-base font-semibold text-card-foreground">
          {loading ? <span className="text-muted-foreground">—</span> : value}
        </div>
        {!loading && delta !== undefined && (
          <div className={`text-[11px] mt-0.5 ${isGood ? "text-green-400" : "text-red-400"}`}>
            {sign}
            {delta.toFixed(1)}% vs mês anterior
          </div>
        )}
        {loading && (
          <div className="text-[11px] mt-0.5 text-muted-foreground">Carregando...</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Conselheiro() {
  const [snapshot, setSnapshot] = useState<ConselheiroSnapshot | null>(null);
  const [snapError, setSnapError] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/conselheiro/dados`)
      .then((r) => {
        if (!r.ok) throw new Error("dados");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch(() => {
        if (!cancelled) setSnapError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/conselheiro/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensagem: trimmed,
          historico: [...messages, userMsg]
            .filter((m) => m.role !== "error")
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          dados_empresa: snapshot,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data.resposta || "Não consegui processar sua pergunta.";
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: reply,
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "error",
          content: "Erro ao conectar com o Conselheiro. Verifique a configuração da ANTHROPIC_API_KEY.",
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const f = snapshot?.financeiro;
  const meta = snapshot?.meta_mensal;
  const showWelcome = messages.length === 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-7rem)]" data-testid="conselheiro-page">
      {/* SIDEBAR de métricas + perguntas rápidas */}
      <aside className="w-full lg:w-[280px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto pr-1">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 px-1">
            Este Mês
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
            <MetricCard
              label="Faturamento"
              value={formatCurrency(f?.faturamento_mes ?? 0)}
              delta={f?.var_faturamento}
              loading={!snapshot && !snapError}
            />
            <MetricCard
              label="Despesas"
              value={formatCurrency(f?.despesas_mes ?? 0)}
              delta={f?.var_despesas}
              invertColor
              loading={!snapshot && !snapError}
            />
            <MetricCard
              label="Resultado"
              value={formatCurrency(f?.resultado_liquido ?? 0)}
              delta={f?.var_resultado}
              loading={!snapshot && !snapError}
            />
            <MetricCard
              label="Inadimplência"
              value={formatCurrency(f?.inadimplencia ?? 0)}
              invertColor
              loading={!snapshot && !snapError}
            />
          </div>
        </div>

        {meta && meta.target > 0 && (
          <Card className="bg-card border-card-border">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Meta do mês
              </div>
              <div className="text-base font-semibold text-card-foreground">
                {meta.pct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {formatCurrency(meta.achieved)} de {formatCurrency(meta.target)}
              </div>
            </CardContent>
          </Card>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 px-1">
            Perguntas Rápidas
          </div>
          <div className="space-y-1.5">
            {QUICK_QUESTIONS.map(({ icon: Icon, label, question }) => (
              <button
                key={label}
                onClick={() => sendMessage(question)}
                disabled={loading}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-md border border-card-border bg-card text-left text-xs text-muted-foreground hover:text-card-foreground hover:border-muted-foreground transition-colors disabled:opacity-50"
                data-testid={`quick-${label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />
                <span className="leading-snug">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* CHAT AREA */}
      <div className="flex-1 flex flex-col bg-card border border-card-border rounded-lg overflow-hidden min-h-0">
        {/* Header da área de chat */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-card-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: ACCENT }}
            >
              <Scale className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-card-foreground leading-tight">
                Conselheiro
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                Inteligência estratégica
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {snapshot ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                <span className="capitalize">{snapshot.periodo.mes_atual}</span>
              </>
            ) : snapError ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Contexto geral</span>
              </>
            ) : (
              <>
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                <span>Sincronizando...</span>
              </>
            )}
          </div>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {showWelcome && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-8">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-4 border"
                style={{ borderColor: ACCENT, backgroundColor: `${ACCENT}15` }}
              >
                <Scale className="w-7 h-7" style={{ color: ACCENT }} />
              </div>
              <h2 className="text-xl font-semibold text-card-foreground mb-2">
                Bom dia, Empreendedor.
              </h2>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                Estou com acesso completo aos dados da sua barbearia. Pergunte qualquer
                coisa — finanças, equipe, riscos, oportunidades. Vou analisar com base
                nos seus números reais.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" && (
                <div className="flex justify-end" data-testid="msg-user">
                  <div className="max-w-[80%] flex flex-col items-end gap-1">
                    <div
                      className="rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm text-white"
                      style={{ backgroundColor: ACCENT }}
                    >
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-muted-foreground tracking-wider px-1">
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              )}

              {msg.role === "assistant" && (
                <div className="flex justify-start" data-testid="msg-assistant">
                  <div className="max-w-[88%] flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-1">
                      <span
                        className="text-[9px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded border"
                        style={{ color: ACCENT, borderColor: ACCENT, backgroundColor: `${ACCENT}10` }}
                      >
                        Conselheiro
                      </span>
                      <span className="text-[10px] text-muted-foreground tracking-wider">
                        {msg.timestamp}
                      </span>
                    </div>
                    <div
                      className="rounded-2xl rounded-bl-md px-4 py-3 text-sm bg-muted text-card-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }}
                    />
                  </div>
                </div>
              )}

              {msg.role === "error" && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm bg-destructive/15 text-destructive border border-destructive/20">
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-muted flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: ACCENT, animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: ACCENT, animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: ACCENT, animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-card-border p-3 flex-shrink-0 bg-card">
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte ao Conselheiro sobre sua barbearia, mercado ou estratégia..."
              disabled={loading}
              rows={1}
              className="flex-1 resize-none min-h-[40px] max-h-[120px] bg-background border-card-border text-sm"
              data-testid="conselheiro-input"
            />
            <Button
              size="icon"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="flex-shrink-0"
              style={{
                backgroundColor: input.trim() && !loading ? ACCENT : undefined,
              }}
              data-testid="conselheiro-send"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wider text-center mt-2">
            ENTER para enviar · SHIFT+ENTER para quebrar linha
          </div>
        </div>
      </div>
    </div>
  );
}
