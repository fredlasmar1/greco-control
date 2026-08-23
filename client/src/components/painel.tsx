/**
 * AS PEÇAS DO PAINEL — o sistema de design do Control, em um lugar só.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * `[23/08/2026]` o dono mandou duas referências de painel executivo e pediu o
 * padrão. Eu apliquei **à mão, tela por tela**, e errei quatro vezes seguidas —
 * cada aba ficou um pouco diferente, e nenhuma ficou como ele pediu. Ao comparar
 * lado a lado, o que faltava era nomeável:
 *
 *   · ícone colorido em cada card de número   → eu ⛔ não tinha nenhum
 *   · barra de ferramentas no topo do gráfico → eu ⛔ não tinha
 *   · paleta MULTICOR, uma cor por série      → eu tinha um vermelho e cinza
 *   · número grande, rótulo pequeno           → os meus tinham peso parecido
 *   · densidade: 5 KPIs + 3 gráficos por tela → eu tinha 3 e muito vazio
 *
 * ⛔ E a causa de errar quatro vezes ⛔ NÃO foi gosto: foi ⛔ não haver peça
 * compartilhada. Estilo aplicado à mão em cinco telas é a mesma regra escrita
 * cinco vezes — e diverge exatamente como diverge regra de negócio duplicada.
 * Aqui a peça é UMA, e a próxima aba já nasce certa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ O QUE ESTAS PEÇAS ⛔ NÃO FAZEM
 *
 * Elas ⛔ não calculam, ⛔ não formatam número de negócio e ⛔ não decidem o que
 * mostrar. Recebem pronto e desenham. A conta mora no Greco Metas, com teste —
 * uma peça de layout que começasse a arredondar valor viraria a segunda fonte de
 * verdade, e é assim que dois sistemas passam a discordar em silêncio.
 *
 * ⚠️ E `variacao` aceita `null` de propósito: **sem base para comparar, ⛔ não se
 * mostra 0%**. Zero por cento afirma "ficou igual", e ficar igual é diferente de
 * ⛔ não saber.
 */
import type { ReactNode } from "react";
import { ResponsiveContainer, LineChart, Line } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * ⛔ A PALETA. Marca da casa primeiro, e as outras para SEPARAR SÉRIES — ⛔ não
 * para enfeitar. Duas séries da mesma cor num gráfico é o mesmo defeito de duas
 * populações somadas: o olho junta o que ⛔ não deveria.
 *
 * ⚠️ `#A50101` e `#0E0000` são a marca GRECO SPORT BARBER e ⛔ não mudam.
 */
export const CORES = {
  marca: "#A50101",
  marcaClara: "#E23B2E",
  azul: "#3B82F6",
  roxo: "#8B5CF6",
  ambar: "#F59E0B",
  verde: "#10B981",
  rosa: "#F87171",
  cinza: "#6B7280",
  fundo: "#0E0000",
} as const;

/** Sequência para séries múltiplas. A marca lidera; o resto separa. */
export const SERIE = [CORES.marca, CORES.azul, CORES.ambar, CORES.roxo, CORES.verde, CORES.rosa, CORES.cinza];

/** Tooltip escuro, igual em todo gráfico do sistema. */
export const TOOLTIP = {
  contentStyle: {
    background: "#141416",
    border: "1px solid #ffffff1f",
    borderRadius: 12,
    color: "#E5E7EB",
    fontSize: 12,
    padding: "8px 12px",
  },
  labelStyle: { color: "#9CA3AF", marginBottom: 4 },
  cursor: { fill: "#ffffff08" },
} as const;

const nBR = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

// ─────────────────────────────────────────────────────────────────────────────

/**
 * CARD DE NÚMERO — o tijolo do painel.
 *
 * Ícone colorido, rótulo pequeno, número grande, variação com seta, sparkline e
 * a procedência do dado. É o formato das referências, e cada parte tem função:
 * o ícone dá o assunto sem ler, a variação dá a direção, a sparkline dá o
 * caminho, e a procedência responde "de onde saiu" sem ninguém precisar
 * perguntar.
 */
export function CardNumero({
  rotulo, valor, icone: Icone, cor = CORES.marca,
  variacao, sufixoVariacao = "vs mês anterior",
  serie, nota, destaque, aoClicar,
}: {
  rotulo: string;
  valor: string;
  icone: any;
  cor?: string;
  /** ⛔ `null` = sem base para comparar. A peça escreve isso; ⛔ nunca 0%. */
  variacao?: number | null;
  sufixoVariacao?: string;
  /** Pontos da sparkline. ⛔ Só valores MEDIDOS — buraco ⛔ não se interpola. */
  serie?: (number | null)[];
  nota?: string;
  destaque?: boolean;
  aoClicar?: () => void;
}) {
  const temVar = variacao != null && Number.isFinite(variacao);
  const Seta = !temVar ? Minus : variacao! >= 0 ? TrendingUp : TrendingDown;
  const corVar = !temVar ? "text-slate-500" : variacao! >= 0 ? "text-emerald-400" : "text-red-400";

  // ⛔ Só ponto medido entra na sparkline. Um `null` no meio vira buraco, e
  //    buraco é honesto: linha inventada afirma um caminho que ⛔ não houve.
  const pontos = (serie ?? []).filter((v): v is number => v != null).map((v) => ({ v }));

  return (
    <div
      onClick={aoClicar}
      className={`group relative rounded-[18px] border p-4 transition-colors ${
        destaque ? "border-[#A50101]/40 bg-[#A50101]/[0.07]" : "border-white/10 bg-white/[0.03]"
      } ${aoClicar ? "cursor-pointer hover:border-white/25" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: `${cor}22`, color: cor }}
        >
          <Icone className="h-4 w-4" />
        </span>
        {aoClicar && (
          <span className="text-slate-600 transition-colors group-hover:text-slate-300">↗</span>
        )}
      </div>

      <p className="mt-3 text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`mt-0.5 font-display text-[26px] font-black leading-tight ${destaque ? "text-[#E23B2E]" : "text-white"}`}>
        {valor}
      </p>

      <div className="mt-1.5 flex items-end justify-between gap-2">
        <span className={`flex items-center gap-1 text-[11px] ${corVar}`}>
          <Seta className="h-3 w-3" />
          {temVar
            ? `${variacao! > 0 ? "+" : ""}${nBR(variacao!)}% ${sufixoVariacao}`
            : "sem base p/ comparar"}
        </span>
        {pontos.length >= 2 && (
          <div className="h-7 w-16 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pontos}>
                {/* ⛔ Sem animação: gráfico que às vezes não pinta é pior que
                    gráfico sem animação — foi o defeito de 23/08. */}
                <Line type="monotone" dataKey="v" stroke={cor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {nota && <p className="mt-1.5 text-[10px] text-slate-500">{nota}</p>}
    </div>
  );
}

/**
 * CARD DE GRÁFICO — título, subtítulo, barra de ferramentas e o desenho.
 *
 * ⚠️ O `subtitulo` ⛔ NÃO é enfeite: é onde mora a declaração que a casa exige —
 * janela, recorte, o que o número ⛔ não diz. Card de gráfico sem subtítulo neste
 * sistema é gráfico que ⛔ não declarou nada.
 */
export function CardGrafico({
  titulo, subtitulo, ferramentas, children, className = "",
}: {
  titulo: string;
  subtitulo?: string;
  /** Botões do canto: período, filtro, exportar. */
  ferramentas?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[18px] border border-white/10 bg-white/[0.03] p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-black uppercase tracking-tight text-white">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p>}
        </div>
        {ferramentas && <div className="flex shrink-0 items-center gap-2">{ferramentas}</div>}
      </div>
      {children}
    </section>
  );
}

/** Botão pequeno da barra de ferramentas. */
export function BotaoFerramenta({
  children, aoClicar, ativo,
}: { children: ReactNode; aoClicar?: () => void; ativo?: boolean }) {
  return (
    <button
      onClick={aoClicar}
      className={`inline-flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-xs transition-colors ${
        ativo
          ? "border-[#A50101]/50 bg-[#A50101]/15 text-white"
          : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * CHIP DE SITUAÇÃO.
 *
 * ⛔ `neutro` é o padrão de propósito. Em 23/08 "sem base pra julgar" aparecia em
 * quatro decisões e eu quase pintei de vermelho — mas ⛔ não era falha: era a data
 * de conferência ⛔ não ter chegado. Vermelho onde há espera ensina a ignorar o
 * vermelho, e aí o de verdade ⛔ não é mais lido.
 */
export function Chip({
  children, tom = "neutro", icone: Icone,
}: {
  children: ReactNode;
  tom?: "neutro" | "bom" | "ruim" | "atencao" | "marca";
  icone?: any;
}) {
  const tons = {
    neutro: "border-white/15 bg-white/5 text-slate-400",
    bom: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    ruim: "border-red-500/35 bg-red-500/10 text-red-300",
    atencao: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    marca: "border-[#A50101]/40 bg-[#A50101]/12 text-[#E23B2E]",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tons[tom]}`}>
      {Icone && <Icone className="h-3 w-3" />}
      {children}
    </span>
  );
}

/**
 * TABELA — cabeçalho, linhas e rolagem horizontal declarada.
 *
 * ⚠️ `min-w` obrigatório: tabela que encolhe até quebrar a coluna de número faz o
 * dono ler o valor errado no celular. Melhor rolar do que espremer.
 */
export function Tabela({
  colunas, children, minLargura = 680,
}: { colunas: { nome: string; alinha?: "esq" | "dir" }[]; children: ReactNode; minLargura?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: minLargura }}>
        <thead className="text-[10px] uppercase tracking-wide text-slate-500">
          <tr className="border-b border-white/10">
            {colunas.map((c) => (
              <th key={c.nome} className={`py-2 font-medium ${c.alinha === "dir" ? "text-right" : "text-left"}`}>
                {c.nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * FAIXA DE AVISO — o que os números ⛔ não dizem.
 *
 * ⛔ Aparece sempre que houver aviso, sem "ver mais": aviso atrás de clique é
 * aviso que ninguém lê, e a lei da casa é que todo recorte se declara.
 */
export function Avisos({ itens, titulo = "O que estes números ⛔ não dizem" }: { itens: string[]; titulo?: string }) {
  if (!itens?.length) return null;
  return (
    <section className="rounded-[18px] border border-amber-500/25 bg-amber-500/[0.05] p-5">
      <p className="text-[11px] uppercase tracking-wide text-amber-300/80">{titulo}</p>
      <ul className="mt-2 space-y-1.5 text-sm text-amber-100/80">
        {itens.map((a, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-amber-400">·</span>
            {a}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Estado de erro nomeado. ⛔ Ponte caída ⛔ nunca vira R$ 0,00. */
export function NaoAbriu({ titulo, motivo }: { titulo: string; motivo?: string }) {
  return (
    <section className="rounded-[18px] border border-amber-500/30 bg-amber-500/[0.06] p-6">
      <p className="font-display text-base font-black uppercase text-white">{titulo} não abriu</p>
      <p className="mt-1 text-sm text-slate-400">{motivo || "o Greco Metas não respondeu"}</p>
      <p className="mt-2 text-xs text-slate-500">
        ⛔ Nada foi estimado. Tela mostrando zero porque a ponte caiu leva à decisão errada com cara de
        número apurado.
      </p>
    </section>
  );
}
