// ─── Telegram Bot Module ────────────────────────────────────────────
// Envia mensagens via @fredgreco_bot para o Chat ID configurado.
// Configurado por variáveis de ambiente:
//   TELEGRAM_BOT_TOKEN  = token do bot (do @BotFather)
//   TELEGRAM_CHAT_ID    = 5565354217 (default, do dono)

import { log } from "./index";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "5565354217";

export function isTelegramConfigured(): boolean {
  return !!BOT_TOKEN;
}

export function getChatId(): string {
  return CHAT_ID;
}

/**
 * Envia mensagem no Telegram (formato HTML).
 * Retorna { ok, error?, messageId? }
 */
export async function enviarMensagem(
  texto: string,
  options: { parseMode?: "HTML" | "MarkdownV2"; disableWebPagePreview?: boolean } = {},
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  if (!BOT_TOKEN) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN não configurado no ambiente" };
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: texto,
        parse_mode: options.parseMode || "HTML",
        disable_web_page_preview: options.disableWebPagePreview ?? true,
      }),
    });

    const data: any = await res.json();
    if (!data.ok) {
      log(`[telegram] erro: ${data.description || "desconhecido"}`, "telegram");
      return { ok: false, error: data.description || `HTTP ${res.status}` };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (err: any) {
    log(`[telegram] exce\u00e7\u00e3o: ${err.message}`, "telegram");
    return { ok: false, error: err.message };
  }
}

// ─── Helpers de formatação ───────────────────────────────────────────
export function formatCurrency(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(v || 0));
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Resumos ──────────────────────────────────────────────────────────
export interface ResumoDiaData {
  data: string;                  // YYYY-MM-DD
  previsto: number;
  fechado: number;
  restante: number;
  totalEsperado: number;
  agendamentosCount: number;
  agendamentosRestantesCount: number;
  comandasCount: number;
  metaDiaria: number;
  atingeMeta: boolean;
  falta: number;
  progressoPct: number;
  progressoFechadoPct: number;
  porProfissional: {
    nome: string;
    previsto: number;
    fechado: number;
    countPrevisto: number;
    countFechado: number;
    total: number;
  }[];
}

export interface ResumoAmanhaData {
  data: string;
  proxDiaUtil: boolean;
  total: number;
  count: number;
  metaDiaria: number;
  atingeMeta: boolean;
  falta: number;
  progressoPct: number;
  porProfissional: { nome: string; total: number; count: number }[];
}

function progressoEmoji(pct: number): string {
  if (pct >= 100) return "✅";
  if (pct >= 85) return "🟢";
  if (pct >= 60) return "🟡";
  return "🔴";
}

function barra(pct: number, blocos = 10): string {
  const p = Math.min(100, Math.max(0, pct));
  const cheios = Math.round((p / 100) * blocos);
  return "█".repeat(cheios) + "░".repeat(blocos - cheios);
}

function formatarDataBR(iso: string): string {
  try {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-BR", {
      weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Monta o resumo da manhã:
 *   1º bloco: FECHAMENTO de ontem (faturamento real + comandas)
 *   2º bloco: PREVISÃO de hoje (agendamentos + meta)
 *
 * Envia geralmente às 8h. Substitui a versão anterior, que mostrava só
 * previsão do dia atual e não trazia o resultado do dia anterior.
 */
export function montarResumoManha(
  hoje: ResumoDiaData,
  amanha: ResumoAmanhaData | null,
  ontem?: ResumoDiaData | null,
): string {
  const emoji = progressoEmoji(hoje.progressoPct);
  const dataStr = formatarDataBR(hoje.data);

  let msg = `☀️ <b>Bom dia, Fred!</b>\n`;
  msg += `<i>${escapeHtml(dataStr)}</i>\n\n`;

  // ── 1º bloco: Fechamento de ontem ──
  if (ontem) {
    const ontemStr = formatarDataBR(ontem.data).split(",")[0];
    const bateu = ontem.fechado >= ontem.metaDiaria;
    const emojiO = bateu ? "✅" : "🔴";
    const ticketMedio = ontem.fechado / Math.max(1, ontem.comandasCount);

    msg += `📊 <b>Fechamento de ontem</b> (${escapeHtml(ontemStr)})\n`;
    msg += `├ Faturamento: <b>${formatCurrency(ontem.fechado)}</b>\n`;
    msg += `├ Comandas: <b>${ontem.comandasCount}</b>\n`;
    msg += `├ Ticket médio: ${formatCurrency(ticketMedio)}\n`;
    msg += `├ Meta: ${formatCurrency(ontem.metaDiaria)}\n`;
    if (bateu) {
      const sobra = ontem.fechado - ontem.metaDiaria;
      msg += `└ ${emojiO} <b>Bateu a meta!</b> +${formatCurrency(sobra)} acima\n`;
    } else {
      const falta = ontem.metaDiaria - ontem.fechado;
      msg += `└ ${emojiO} Faltaram ${formatCurrency(falta)} para a meta\n`;
    }

    // Top profissionais de ontem (fechado)
    const rankOntem = (ontem.porProfissional || [])
      .filter(p => p.fechado > 0)
      .sort((a, b) => b.fechado - a.fechado)
      .slice(0, 3);
    if (rankOntem.length > 0) {
      msg += `\n🏆 <b>Top de ontem</b>\n`;
      rankOntem.forEach((p, i) => {
        const icon = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
        msg += `${icon} ${escapeHtml(p.nome)}: ${formatCurrency(p.fechado)} (${p.countFechado})\n`;
      });
    }
    msg += `\n`;
  }

  // ── 2º bloco: Previsão de hoje ──
  msg += `📅 <b>Previsão de hoje</b>\n`;
  msg += `├ Agendamentos: <b>${hoje.agendamentosCount}</b>\n`;
  msg += `├ Faturamento previsto: <b>${formatCurrency(hoje.totalEsperado)}</b>\n`;
  msg += `├ Meta diária: ${formatCurrency(hoje.metaDiaria)}\n`;
  if (hoje.atingeMeta) {
    msg += `└ ${emoji} <b>Meta já projetada!</b> (+${formatCurrency(hoje.totalEsperado - hoje.metaDiaria)})\n`;
  } else {
    msg += `└ ${emoji} Falta projetar <b>${formatCurrency(hoje.falta)}</b> para a meta\n`;
  }
  msg += `\n<code>${barra(hoje.progressoPct)}</code> ${hoje.progressoPct.toFixed(0)}%\n\n`;

  // Ranking profissional (top 5)
  const rank = hoje.porProfissional
    .filter(p => p.countPrevisto > 0 || p.countFechado > 0)
    .slice(0, 5);
  if (rank.length > 0) {
    msg += `👥 <b>Agenda por profissional</b>\n`;
    rank.forEach((p, i) => {
      const icon = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "▫️";
      const count = p.countPrevisto || p.countFechado;
      msg += `${icon} ${escapeHtml(p.nome)}: ${count} agend. · ${formatCurrency(Math.max(p.previsto, p.fechado))}\n`;
    });
    msg += `\n`;
  }

  // Previsão de amanhã (mantida como terçeiro bloco — útil em sextas)
  if (amanha && amanha.count > 0) {
    const labelAmanha = amanha.proxDiaUtil ? "próximo dia útil" : "amanhã";
    const emojiA = progressoEmoji(amanha.progressoPct);
    msg += `🔮 <b>Previsão ${labelAmanha}</b> (${formatarDataBR(amanha.data).split(",")[0]})\n`;
    msg += `├ ${amanha.count} agendamentos já marcados\n`;
    msg += `├ Previsto: <b>${formatCurrency(amanha.total)}</b>\n`;
    if (amanha.atingeMeta) {
      msg += `└ ${emojiA} Meta já garantida\n`;
    } else {
      msg += `└ ${emojiA} Falta ${formatCurrency(amanha.falta)} para meta\n`;
    }
    msg += `\n`;
  }

  // Dica motivacional / alerta
  if (!hoje.atingeMeta && hoje.agendamentosCount > 0) {
    const ticketMedio = hoje.totalEsperado / Math.max(1, hoje.agendamentosCount);
    const agFaltam = Math.ceil(hoje.falta / Math.max(1, ticketMedio));
    msg += `💡 ~${agFaltam} agendamentos extras (ticket médio ${formatCurrency(ticketMedio)}) fecham a meta.\n`;
  } else if (hoje.agendamentosCount === 0) {
    msg += `⚠️ Nenhum agendamento confirmado ainda. Corre atrás!\n`;
  }

  msg += `\n🔗 <a href="https://greco-control-production.up.railway.app/">Abrir Dashboard</a>`;

  return msg;
}

/**
 * Monta o resumo da noite: fechamento do dia.
 * Envia geralmente às 20h.
 */
export function montarResumoNoite(hoje: ResumoDiaData): string {
  const emoji = progressoEmoji(hoje.progressoFechadoPct);
  const dataStr = formatarDataBR(hoje.data);
  const bateuMeta = hoje.fechado >= hoje.metaDiaria;

  let msg = `🌙 <b>Fechamento do dia</b>\n`;
  msg += `<i>${escapeHtml(dataStr)}</i>\n\n`;

  msg += `💰 <b>Faturamento fechado</b>\n`;
  msg += `├ Total: <b>${formatCurrency(hoje.fechado)}</b>\n`;
  msg += `├ Comandas: <b>${hoje.comandasCount}</b>\n`;
  msg += `├ Ticket médio: ${formatCurrency(hoje.fechado / Math.max(1, hoje.comandasCount))}\n`;
  msg += `└ Meta: ${formatCurrency(hoje.metaDiaria)}\n\n`;

  msg += `<code>${barra(hoje.progressoFechadoPct)}</code> ${hoje.progressoFechadoPct.toFixed(0)}%\n\n`;

  if (bateuMeta) {
    const sobra = hoje.fechado - hoje.metaDiaria;
    msg += `🎉 <b>Meta batida!</b> +${formatCurrency(sobra)} acima da meta ${emoji}\n\n`;
  } else {
    const faltou = hoje.metaDiaria - hoje.fechado;
    msg += `${emoji} Faltaram <b>${formatCurrency(faltou)}</b> para a meta\n\n`;
  }

  // Ranking final por profissional
  const rank = hoje.porProfissional
    .filter(p => p.fechado > 0)
    .sort((a, b) => b.fechado - a.fechado)
    .slice(0, 5);
  if (rank.length > 0) {
    msg += `🏆 <b>Top profissionais (fechado)</b>\n`;
    rank.forEach((p, i) => {
      const icon = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "▫️";
      msg += `${icon} ${escapeHtml(p.nome)}: ${formatCurrency(p.fechado)} (${p.countFechado})\n`;
    });
    msg += `\n`;
  }

  // Comparação previsto vs realizado
  if (hoje.previsto > 0) {
    const diff = hoje.fechado - hoje.previsto;
    const diffPct = (diff / hoje.previsto) * 100;
    const arrow = diff >= 0 ? "📈" : "📉";
    msg += `${arrow} <b>Previsto vs Realizado</b>\n`;
    msg += `Previsto: ${formatCurrency(hoje.previsto)} · Fechado: ${formatCurrency(hoje.fechado)}\n`;
    msg += `Diferença: ${diff >= 0 ? "+" : ""}${formatCurrency(diff)} (${diffPct.toFixed(1)}%)\n\n`;
  }

  msg += `🔗 <a href="https://greco-control-production.up.railway.app/">Ver detalhes</a>`;

  return msg;
}

// ─── Alertas de Produtos (giro / sem movimento) ─────────────────────────
// OBS: A API Trinks não expõe saldo real; alertas são baseados em dias sem venda.
export interface AlertaEstoque {
  id?: number | string;
  nome: string;
  saldo?: number;
  minimo?: number;
  nivel: "critico" | "atencao" | "ok";
  diasDesdeUltimaVenda?: number | null;
  ultimaVenda?: string | null;
  vendidos30d?: number;
}

function formatarDiasSemVenda(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return "sem vendas registradas";
  if (dias >= 999) return "sem vendas registradas";
  if (dias === 0) return "vendeu hoje";
  if (dias === 1) return "vendeu ontem";
  if (dias < 30) return `última venda há ${dias} dias`;
  return "sem venda há +30 dias";
}

/**
 * Monta bloco de alertas de produtos sem giro para anexar aos resumos.
 * Retorna string vazia se não houver alertas relevantes.
 */
export function montarAlertasEstoque(alertas: AlertaEstoque[]): string {
  if (!Array.isArray(alertas) || alertas.length === 0) return "";

  const criticos = alertas.filter(a => a.nivel === "critico");
  const atencao = alertas.filter(a => a.nivel === "atencao");

  if (criticos.length === 0 && atencao.length === 0) return "";

  let msg = `📦 <b>Produtos sem giro</b>\n`;

  if (criticos.length > 0) {
    msg += `🔴 <b>Parados +30d (${criticos.length})</b>\n`;
    criticos.slice(0, 8).forEach(a => {
      msg += `├ ${escapeHtml(a.nome)}: ${formatarDiasSemVenda(a.diasDesdeUltimaVenda)}\n`;
    });
    if (criticos.length > 8) {
      msg += `└ <i>+${criticos.length - 8} outros sem giro</i>\n`;
    }
  }

  if (atencao.length > 0) {
    msg += `🟡 <b>Parados 14–30d (${atencao.length})</b>\n`;
    atencao.slice(0, 5).forEach(a => {
      msg += `├ ${escapeHtml(a.nome)}: ${formatarDiasSemVenda(a.diasDesdeUltimaVenda)}\n`;
    });
    if (atencao.length > 5) {
      msg += `└ <i>+${atencao.length - 5} outros em atenção</i>\n`;
    }
  }

  msg += `\n`;
  return msg;
}

/**
 * Monta alerta imediato (para notificação pontual quando muitos produtos parados).
 */
export function montarAlertaImediatoEstoque(alertas: AlertaEstoque[]): string {
  const criticos = (alertas || []).filter(a => a.nivel === "critico");
  if (criticos.length === 0) return "";

  let msg = `⚠️ <b>Alerta de giro de produtos</b>\n`;
  msg += `<i>${criticos.length} produto(s) sem vendas há mais de 30 dias</i>\n\n`;
  criticos.slice(0, 10).forEach(a => {
    msg += `🔴 ${escapeHtml(a.nome)}: ${formatarDiasSemVenda(a.diasDesdeUltimaVenda)}\n`;
  });
  if (criticos.length > 10) {
    msg += `\n<i>+${criticos.length - 10} outros…</i>\n`;
  }
  msg += `\n🔗 <a href="https://greco-control-production.up.railway.app/#/estoque">Ver detalhes</a>`;
  return msg;
}
