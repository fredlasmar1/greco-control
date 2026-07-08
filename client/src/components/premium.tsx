import React from "react";

/**
 * Componentes visuais do padrão "Noite" (escuro premium).
 * Reutilizáveis em todas as abas para dar o mesmo acabamento do mockup:
 * KPI com "chip" de ícone, rankings com mini-barra, cabeçalho de seção.
 */

type Accent = "blue" | "red" | "emerald" | "amber" | "violet";

const ACCENT_CHIP: Record<Accent, string> = {
  blue: "bg-primary/15 text-primary",
  red: "bg-red-500/15 text-red-400",
  emerald: "bg-emerald-500/15 text-emerald-400",
  amber: "bg-amber-500/15 text-amber-400",
  violet: "bg-violet-500/15 text-violet-400",
};
const BAR_FILL: Record<Accent, string> = {
  blue: "from-[#205080] to-[#4f92cf]",
  red: "from-[#8f1f1a] to-[#d0453a]",
  emerald: "from-emerald-700 to-emerald-400",
  amber: "from-amber-700 to-amber-400",
  violet: "from-violet-700 to-violet-400",
};

/** Cabeçalho de seção: sobrancelha + título (padrão do mockup). */
export function SectionHeader({
  eyebrow,
  title,
  icon,
  right,
}: {
  eyebrow?: string;
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</div>
        )}
        <h3 className="text-[15px] font-bold tracking-tight flex items-center gap-2 mt-0.5">
          {icon}
          {title}
        </h3>
      </div>
      {right}
    </div>
  );
}

/** KPI premium: chip de ícone + rótulo + número grande + subtexto. */
export function KpiTile({
  label,
  value,
  sub,
  subTone,
  icon,
  accent = "blue",
  className = "",
  ...rest
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  subTone?: "up" | "down" | "muted";
  icon?: React.ReactNode;
  accent?: Accent;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const subCls =
    subTone === "up" ? "text-emerald-400 font-semibold" : subTone === "down" ? "text-red-400 font-semibold" : "text-muted-foreground";
  return (
    <div
      className={`rounded-2xl border border-card-border bg-card p-4 shadow-[var(--shadow-sm)] ${className}`}
      {...rest}
    >
      <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {icon && <span className={`grid place-items-center w-6 h-6 rounded-lg flex-none ${ACCENT_CHIP[accent]}`}>{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-[26px] leading-none font-extrabold tracking-[-0.02em] tabular-nums">{value}</div>
      {sub != null && sub !== "" && <div className={`mt-1.5 text-[11.5px] tabular-nums ${subCls}`}>{sub}</div>}
    </div>
  );
}

/** Barra de meta rotulada (Dia / Semana / Mês do mockup). */
export function GoalBar({
  label,
  current,
  target,
  pct,
  accent = "blue",
}: {
  label: string;
  current: string;
  target: string;
  pct: number;
  accent?: Accent;
}) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex justify-between items-baseline text-[12.5px] mb-1.5">
        <span className="text-muted-foreground">{label} · meta {target}</span>
        <span>
          <b className="tabular-nums">{current}</b> · <span className="text-primary font-extrabold tabular-nums">{p.toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-[9px] rounded-full bg-muted overflow-hidden">
        <span className={`block h-full rounded-full bg-gradient-to-r ${BAR_FILL[accent]} transition-[width] duration-700`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/** Linha de ranking com mini-barra + selo opcional (padrão do mockup). */
export function RankRow({
  pos,
  name,
  tag,
  amount,
  pct,
  sub,
  lead,
  accent = "blue",
}: {
  pos: number;
  name: string;
  tag?: string;
  amount: React.ReactNode;
  pct: number;
  sub?: React.ReactNode;
  lead?: boolean;
  accent?: Accent;
}) {
  const p = Math.max(2, Math.min(100, pct));
  return (
    <div className="grid grid-cols-[18px_1fr_auto] items-center gap-3">
      <span className="text-[12px] font-extrabold text-muted-foreground tabular-nums">{pos}</span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-2">
          {lead && <span className="text-[#d9b46a]">♦</span>}
          <span className="truncate">{name}</span>
          {tag && (
            <span className={`text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded ${ACCENT_CHIP[accent]} flex-none`}>{tag}</span>
          )}
          {sub && <span className="text-[10.5px] text-muted-foreground ml-auto tabular-nums flex-none">{sub}</span>}
        </div>
        <div className="h-[5px] rounded-full bg-muted mt-1.5 overflow-hidden">
          <span className={`block h-full rounded-full bg-gradient-to-r ${BAR_FILL[accent]}`} style={{ width: `${p}%` }} />
        </div>
      </div>
      <span className="text-[13px] font-extrabold tabular-nums">{amount}</span>
    </div>
  );
}
