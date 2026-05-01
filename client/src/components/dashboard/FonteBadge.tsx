/**
 * Badge discreto que indica a fonte dos dados do mês (Trinks ao vivo vs CSV
 * importado), aplicando a regra "mais recente vence". Mostra também há quanto
 * tempo a fonte foi atualizada (ex.: "Fonte: Trinks · sync há 2h").
 *
 * Não exibe nada quando fonte é "atual" (mês corrente sem meta) ou "nenhuma".
 */
import { Database, FileSpreadsheet } from "lucide-react";

export type FonteUI = "atual" | "trinks" | "csv" | "nenhuma";

interface Props {
  fonte: FonteUI;
  trinksAt: string | null;
  csvAt: string | null;
  className?: string;
}

function tempoDesde(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "agora";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "há 1 dia";
  if (d < 30) return `há ${d} dias`;
  const m = Math.floor(d / 30);
  if (m === 1) return "há 1 mês";
  return `há ${m} meses`;
}

export function FonteBadge({ fonte, trinksAt, csvAt, className }: Props) {
  if (fonte === "nenhuma") return null;
  if (fonte === "atual") return null;

  const isCsv = fonte === "csv";
  const ts = isCsv ? csvAt : trinksAt;
  const label = isCsv ? "CSV" : "Trinks";
  const Icon = isCsv ? FileSpreadsheet : Database;
  const palette = isCsv
    ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
    : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";

  return (
    <span
      className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${palette} ${className || ""}`}
      data-testid={`fonte-badge-${fonte}`}
      title={`Fonte ${label}${ts ? ` · ${new Date(ts).toLocaleString("pt-BR")}` : ""}`}
    >
      <Icon className="w-3 h-3" />
      <span>Fonte: {label}</span>
      {ts && <span className="opacity-70">· {tempoDesde(ts)}</span>}
    </span>
  );
}
