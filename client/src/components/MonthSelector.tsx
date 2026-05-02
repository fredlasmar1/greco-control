/**
 * Seletor de mês padronizado para uso em qualquer página que explore histórico
 * mensal. Combina:
 *   - Botões prev/next (limita next ao mês corrente)
 *   - Label do mês selecionado
 *   - Sublinha informativa (carregando / erro / fonte / "ao vivo")
 *   - Atalho "Voltar para mês atual" quando aplicável
 *   - Badge de fonte (CSV / Trinks) reusando FonteBadge do Dashboard
 */
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FonteBadge, type FonteUI } from "@/components/dashboard/FonteBadge";
import { mesAdjacente, labelMesPtBR } from "@/lib/mesUtils";

interface Props {
  selectedMes: string;
  onChange: (mes: string) => void;
  mesCorrente: string;
  isMesCorrente: boolean;
  loading?: boolean;
  error?: string | null;
  fonte?: FonteUI;
  trinksAt?: string | null;
  csvAt?: string | null;
  /** Texto adicional opcional (ex: "Sem dados para este mês"). */
  extraInfo?: string;
}

export function MonthSelector({
  selectedMes,
  onChange,
  mesCorrente,
  isMesCorrente,
  loading,
  error,
  fonte = "atual",
  trinksAt = null,
  csvAt = null,
  extraInfo,
}: Props) {
  const subtitle = isMesCorrente
    ? "Mês atual · visão ao vivo"
    : loading
      ? "Carregando dados do mês…"
      : error
        ? `Erro: ${error}`
        : fonte === "trinks"
          ? "Histórico via Trinks"
          : fonte === "csv"
            ? "Histórico via CSV importado"
            : fonte === "nenhuma"
              ? "Sem dados para este mês"
              : extraInfo || "Visão do mês selecionado";

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        onClick={() => onChange(mesAdjacente(selectedMes, -1))}
        aria-label="Mês anterior"
        data-testid="btn-mes-anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <div className="min-w-[180px] text-center">
        <h2 className="text-lg font-semibold leading-tight" data-testid="label-mes-selecionado">
          {labelMesPtBR(selectedMes)}
        </h2>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        <FonteBadge fonte={fonte} trinksAt={trinksAt} csvAt={csvAt} />
      </div>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        onClick={() => onChange(mesAdjacente(selectedMes, +1))}
        disabled={selectedMes >= mesCorrente}
        aria-label="Próximo mês"
        data-testid="btn-mes-proximo"
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
      {!isMesCorrente && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(mesCorrente)}
          data-testid="btn-mes-atual"
        >
          Voltar para mês atual
        </Button>
      )}
    </div>
  );
}
