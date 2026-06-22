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
  options: { parseMode?: "HTML" | "MarkdownV2"; disableWebPagePreview?: boolean; chatId?: string } = {},
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  if (!BOT_TOKEN) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN não configurado no ambiente" };
  }

  // Se chatId fornecido (e não vazio), usa ele; senão cai no chat principal do dono.
  const targetChatId = (options.chatId && String(options.chatId).trim()) ? String(options.chatId).trim() : CHAT_ID;

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: targetChatId,
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
  // Atendimentos cobertos por plano de assinatura (não geram comanda).
  plano?: {
    count: number;
    valorTabela: number;
    atendimentos?: { hora: string; cliente: string; profissional: string; servico: string; valor: number; status: string }[];
    porProfissional?: { nome: string; count: number; valor: number }[];
  };
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

/** Item de pagamento a aparecer no aviso matinal (contas e equipe). */
export interface PagamentoHojeItem {
  tipo: "conta" | "equipe";
  nome: string;            // "Aluguel", "Vale dos barbeiros"
  valor?: number | null;   // null = varia / não informado
  observacao?: string;
}

/**
 * Monta o resumo da manhã (é a ÚNICA mensagem do dia desde 21/06/2026):
 *   1º bloco: FECHAMENTO de ontem (faturamento real + comandas + quem não bateu meta)
 *   2º bloco: PREVISÃO de hoje (agendamentos + Clube Greco + meta)
 *   3º bloco: PAGAMENTOS de hoje (contas mensais + salário/vale dos barbeiros)
 *
 * Envia às 8h ter-sáb.
 */
export function montarResumoManha(
  hoje: ResumoDiaData,
  amanha: ResumoAmanhaData | null,
  ontem?: ResumoDiaData | null,
  pagamentosHoje?: PagamentoHojeItem[],
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
    const profsOntem = (ontem.porProfissional || []).filter(p => p.fechado > 0 || p.countFechado > 0);
    const rankOntem = profsOntem.slice().sort((a, b) => b.fechado - a.fechado).slice(0, 3);
    if (rankOntem.length > 0) {
      msg += `\n🏆 <b>Top de ontem</b>\n`;
      rankOntem.forEach((p, i) => {
        const icon = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
        msg += `${icon} ${escapeHtml(p.nome)}: ${formatCurrency(p.fechado)} (${p.countFechado})\n`;
      });
    }

    // Quem NÃO bateu meta individual de ontem.
    // Critério: tem meta individual (metaIndividual no payload? por enquanto usamos
    // metaDiaria / N profissionais como aproximação se não vier explícita)
    // O ideal é que o backend mande metaIndividual por profissional no futuro.
    // Por ora, marcamos como "abaixo da média" quem ficou < 80% do top do dia.
    if (profsOntem.length >= 2) {
      const topVal = rankOntem[0]?.fechado || 0;
      const abaixo = profsOntem.filter(p => p.fechado > 0 && p.fechado < topVal * 0.5);
      if (abaixo.length > 0) {
        msg += `\n⚠️ <b>Abaixo da média ontem</b>\n`;
        abaixo.slice(0, 5).forEach(p => {
          msg += `· ${escapeHtml(p.nome)}: ${formatCurrency(p.fechado)} (${p.countFechado})\n`;
        });
      }
    }

    // Atendimentos de plano de ontem
    if (ontem.plano && ontem.plano.count > 0) {
      msg += `\n🎫 <b>Plano de assinatura</b>: ${ontem.plano.count} atend. (${formatCurrency(ontem.plano.valorTabela)} em tabela)\n`;
      const rankPlano = (ontem.plano.porProfissional || []).slice(0, 3);
      rankPlano.forEach(p => {
        msg += `· ${escapeHtml(p.nome)}: ${p.count}\n`;
      });
    }
    msg += `\n`;
  }

  // ── 2º bloco: Previsão de hoje (serviços + Clube Greco) ──
  const planoHojeValor = (hoje.plano?.valorTabela) || 0;
  const planoHojeCount = (hoje.plano?.count) || 0;
  const totalEsperadoCompleto = hoje.totalEsperado + planoHojeValor;
  const progressoCompleto = hoje.metaDiaria > 0
    ? (totalEsperadoCompleto / hoje.metaDiaria) * 100
    : 0;
  const emojiCompleto = progressoEmoji(progressoCompleto);
  const atingeCompleto = totalEsperadoCompleto >= hoje.metaDiaria;

  msg += `📅 <b>Previsão de hoje</b>\n`;
  msg += `├ Agendamentos: <b>${hoje.agendamentosCount}</b>${planoHojeCount > 0 ? ` + ${planoHojeCount} plano` : ""}\n`;
  msg += `├ Serviços: ${formatCurrency(hoje.totalEsperado)}\n`;
  if (planoHojeValor > 0) {
    msg += `├ Clube Greco: ${formatCurrency(planoHojeValor)}\n`;
  }
  msg += `├ <b>Total previsto: ${formatCurrency(totalEsperadoCompleto)}</b>\n`;
  msg += `├ Meta diária: ${formatCurrency(hoje.metaDiaria)}\n`;
  if (atingeCompleto) {
    msg += `└ ${emojiCompleto} <b>Meta já projetada!</b> (+${formatCurrency(totalEsperadoCompleto - hoje.metaDiaria)})\n`;
  } else {
    const faltaCompleto = hoje.metaDiaria - totalEsperadoCompleto;
    msg += `└ ${emojiCompleto} Falta projetar <b>${formatCurrency(faltaCompleto)}</b> para a meta\n`;
  }
  msg += `\n<code>${barra(progressoCompleto)}</code> ${progressoCompleto.toFixed(0)}%\n\n`;

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

  // ── 3º bloco: Pagamentos de hoje (contas + equipe) ──
  if (pagamentosHoje && pagamentosHoje.length > 0) {
    const contas = pagamentosHoje.filter(p => p.tipo === "conta");
    const equipe = pagamentosHoje.filter(p => p.tipo === "equipe");
    msg += `💸 <b>Pagamentos de hoje</b>\n`;
    if (contas.length > 0) {
      contas.forEach((c, i) => {
        const last = (i === contas.length - 1) && equipe.length === 0;
        const prefix = last ? "└" : "├";
        const valorTxt = c.valor != null && c.valor > 0
          ? ` — <b>${formatCurrency(c.valor)}</b>`
          : ` — <i>valor variável</i>`;
        msg += `${prefix} ${escapeHtml(c.nome)}${valorTxt}\n`;
      });
    }
    if (equipe.length > 0) {
      equipe.forEach((e, i) => {
        const last = i === equipe.length - 1;
        const prefix = last ? "└" : "├";
        msg += `${prefix} 👥 ${escapeHtml(e.nome)}${e.observacao ? ` — <i>${escapeHtml(e.observacao)}</i>` : ""}\n`;
      });
    }
    msg += `\n`;
  }

  // Dica motivacional / alerta (usa total esperado com Clube Greco)
  if (!atingeCompleto && (hoje.agendamentosCount + planoHojeCount) > 0) {
    const ticketMedio = totalEsperadoCompleto / Math.max(1, hoje.agendamentosCount + planoHojeCount);
    const faltaCompleto = hoje.metaDiaria - totalEsperadoCompleto;
    const agFaltam = Math.ceil(faltaCompleto / Math.max(1, ticketMedio));
    msg += `💡 ~${agFaltam} agendamentos extras (ticket médio ${formatCurrency(ticketMedio)}) fecham a meta.\n`;
  } else if (hoje.agendamentosCount === 0 && planoHojeCount === 0) {
    msg += `⚠️ Nenhum agendamento confirmado ainda. Corre atrás!\n`;
  }

  msg += `\n🔗 <a href="https://grecocontrol.com.br/">Abrir Dashboard</a>`;

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

  // Atendimentos de plano de assinatura
  if (hoje.plano && hoje.plano.count > 0) {
    msg += `🎫 <b>Plano de assinatura</b>\n`;
    msg += `├ Atendimentos: <b>${hoje.plano.count}</b>\n`;
    msg += `└ Valor de tabela consumido: ${formatCurrency(hoje.plano.valorTabela)}\n`;
    const rankPlano = (hoje.plano.porProfissional || []).slice(0, 3);
    if (rankPlano.length > 0) {
      rankPlano.forEach(p => {
        msg += `· ${escapeHtml(p.nome)}: ${p.count}\n`;
      });
    }
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
