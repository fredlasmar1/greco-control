import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  X,
  Send,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  Sparkles,
  Loader2,
} from "lucide-react";

const API_BASE = (globalThis as any).__API_BASE__ || "";

interface Evidencias {
  sqlUsado: string;
  dados: any[];
}

interface CopilotResponse {
  texto: string;
  intentCode: string;
  evidencias: Evidencias;
  acoesSugeridas: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  evidencias?: Evidencias;
  acoesSugeridas?: string[];
  feedback?: "up" | "down";
}

const QUICK_SUGGESTIONS = [
  "Como foi hoje?",
  "Quem piorou?",
  "Assinantes em risco?",
];

export function CopilotDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(
    new Set()
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const toggleEvidence = (id: string) => {
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const setFeedback = (id: string, feedback: "up" | "down") => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, feedback } : m))
    );
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/copilot/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: text.trim() }),
      });

      if (!res.ok) {
        throw new Error(`Erro ${res.status}: ${res.statusText}`);
      }

      const data: CopilotResponse = await res.json();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.texto,
        evidencias: data.evidencias,
        acoesSugeridas: data.acoesSugeridas,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "error",
        content:
          err?.message || "Erro ao se comunicar com o Copiloto. Tente novamente.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-[60] w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
        style={{ backgroundColor: "#01696F" }}
        aria-label="Abrir Copiloto"
        data-testid="copilot-fab"
      >
        {isOpen ? (
          <X className="w-6 h-6 text-white" />
        ) : (
          <Sparkles className="w-6 h-6 text-white" />
        )}
      </button>

      {/* Backdrop (mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`
          fixed top-0 right-0 z-[60] h-full
          w-full sm:w-[420px]
          bg-card border-l border-card-border
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
        data-testid="copilot-drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-card-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: "#01696F" }}
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-card-foreground leading-tight">
                Copiloto Greco
              </h2>
              <span className="text-[10px] text-muted-foreground leading-tight">
                Assistente inteligente
              </span>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            aria-label="Fechar Copiloto"
            data-testid="copilot-close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: "#01696F20" }}
              >
                <MessageSquare
                  className="w-6 h-6"
                  style={{ color: "#01696F" }}
                />
              </div>
              <p className="text-sm font-medium text-card-foreground mb-1">
                Olá! Sou o Copiloto Greco.
              </p>
              <p className="text-xs text-muted-foreground">
                Pergunte qualquer coisa sobre sua barbearia. Uso dados reais
                para responder.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id}>
              {/* User message */}
              {msg.role === "user" && (
                <div className="flex justify-end">
                  <div
                    className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm text-white"
                    style={{ backgroundColor: "#01696F" }}
                  >
                    {msg.content}
                  </div>
                </div>
              )}

              {/* Error message */}
              {msg.role === "error" && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm bg-destructive/15 text-destructive border border-destructive/20">
                    {msg.content}
                  </div>
                </div>
              )}

              {/* Assistant message */}
              {msg.role === "assistant" && (
                <div className="flex justify-start">
                  <div className="max-w-[90%] space-y-2">
                    {/* Text */}
                    <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm bg-muted text-card-foreground">
                      {msg.content}
                    </div>

                    {/* Evidence toggle */}
                    {msg.evidencias && (
                      <div>
                        <button
                          onClick={() => toggleEvidence(msg.id)}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-card-foreground transition-colors px-1"
                        >
                          <ChevronDown
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${
                              expandedEvidence.has(msg.id) ? "rotate-180" : ""
                            }`}
                          />
                          Ver evidencias
                        </button>
                        {expandedEvidence.has(msg.id) && (
                          <div className="mt-1.5 rounded-lg border border-card-border bg-background p-3 space-y-2">
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                SQL
                              </span>
                              <pre className="mt-1 text-[11px] text-muted-foreground bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">
                                {msg.evidencias.sqlUsado}
                              </pre>
                            </div>
                            {msg.evidencias.dados &&
                              msg.evidencias.dados.length > 0 && (
                                <div>
                                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                    Dados
                                  </span>
                                  <pre className="mt-1 text-[11px] text-muted-foreground bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">
                                    {JSON.stringify(
                                      msg.evidencias.dados,
                                      null,
                                      2
                                    )}
                                  </pre>
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Suggested actions */}
                    {msg.acoesSugeridas && msg.acoesSugeridas.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 px-1">
                        {msg.acoesSugeridas.map((acao, i) => (
                          <button
                            key={i}
                            onClick={() => sendMessage(acao)}
                            className="text-xs px-2.5 py-1 rounded-full border border-card-border bg-background text-muted-foreground hover:text-card-foreground hover:border-muted-foreground transition-colors"
                          >
                            {acao}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Feedback */}
                    <div className="flex items-center gap-1 px-1">
                      <button
                        onClick={() => setFeedback(msg.id, "up")}
                        className={`p-1 rounded transition-colors ${
                          msg.feedback === "up"
                            ? "text-green-400"
                            : "text-muted-foreground hover:text-card-foreground"
                        }`}
                        aria-label="Resposta util"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setFeedback(msg.id, "down")}
                        className={`p-1 rounded transition-colors ${
                          msg.feedback === "down"
                            ? "text-red-400"
                            : "text-muted-foreground hover:text-card-foreground"
                        }`}
                        aria-label="Resposta nao util"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-muted flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick suggestions */}
        {messages.length === 0 && (
          <div className="flex gap-2 px-4 pb-2 flex-wrap">
            {QUICK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                disabled={isLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-card-border bg-background text-muted-foreground hover:text-card-foreground hover:border-muted-foreground transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-card-border p-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Perguntar ao Copiloto..."
              disabled={isLoading}
              className="flex-1 bg-background border-card-border text-sm"
              data-testid="copilot-input"
            />
            <Button
              size="icon"
              onClick={() => sendMessage(inputValue)}
              disabled={!inputValue.trim() || isLoading}
              className="flex-shrink-0"
              style={{
                backgroundColor:
                  inputValue.trim() && !isLoading ? "#01696F" : undefined,
              }}
              data-testid="copilot-send"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
