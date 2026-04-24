import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Nome para identificar onde o erro aconteceu */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: string;
}

/**
 * ErrorBoundary: impede que um crash em um componente desmonte a árvore inteira.
 * Mostra uma mensagem amigável + detalhes técnicos (colapsáveis).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, info: "" };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    // Log completo no console pra facilitar debug
    console.error(
      `[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`,
      error,
      errorInfo
    );
    this.setState({ info: errorInfo.componentStack || "" });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, info: "" });
    // Recarrega a página pra tentar de novo do zero
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-lg border border-card-border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold mb-2 text-destructive">
              Algo deu errado ao carregar esta área
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Um erro inesperado impediu a renderização. Você pode tentar recarregar — suas demais abas continuam funcionando.
            </p>
            {this.state.error && (
              <details className="text-xs text-muted-foreground mb-4 bg-muted/30 rounded p-3">
                <summary className="cursor-pointer font-medium text-foreground">
                  Detalhes técnicos
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-all">
                  {this.state.error.name}: {this.state.error.message}
                  {this.state.info && `\n\nStack:\n${this.state.info}`}
                </pre>
              </details>
            )}
            <div className="flex gap-2">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                Recarregar
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null, info: "" })}
                className="px-4 py-2 rounded-md border border-card-border text-sm font-medium hover:bg-muted"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
