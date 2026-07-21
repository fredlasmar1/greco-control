// ─── Telegram Bot Module ────────────────────────────────────────────
// Envia mensagens via @fredgreco_bot para o Chat ID configurado.
// Configurado por variáveis de ambiente:
//   TELEGRAM_BOT_TOKEN  = token do bot (do @BotFather)
//   TELEGRAM_CHAT_ID    = 5565354217 (default, do dono)

import { log } from "./index";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "5565354217";
// Bot DEDICADO pro grupo de compras/comprovantes (@grecocontrol_bot). Separado
// do bot do resumo matinal (@fredgreco_bot). Cai no BOT_TOKEN se não configurado.
const COMPRAS_BOT_TOKEN = process.env.TELEGRAM_COMPRAS_BOT_TOKEN || BOT_TOKEN;

export function isTelegramConfigured(): boolean {
  return !!BOT_TOKEN;
}

export function isComprasBotConfigured(): boolean {
  return !!COMPRAS_BOT_TOKEN;
}

/** Um botão do teclado inline. `data` volta no callback_query (máx 64 bytes). */
export interface BotaoCompras { texto: string; data: string; }

/**
 * Envia mensagem pelo bot de COMPRAS (grupo de comprovantes).
 * `botoes` (opcional) monta um teclado inline — usado pra PERGUNTAR em vez de
 * adivinhar: "esse pagamento é de quem?" / "que categoria?". Decisão do dono
 * (19/07): a IA só classifica o óbvio; na dúvida, pergunta.
 */
export async function enviarMensagemCompras(
  texto: string,
  chatId: string,
  botoes?: BotaoCompras[][],
): Promise<{ ok: boolean; error?: string }> {
  if (!COMPRAS_BOT_TOKEN) return { ok: false, error: "TELEGRAM_COMPRAS_BOT_TOKEN não configurado" };
  try {
    const body: any = { chat_id: chatId, text: texto, parse_mode: "HTML", disable_web_page_preview: true };
    if (botoes?.length) {
      body.reply_markup = { inline_keyboard: botoes.map(l => l.map(b => ({ text: b.texto, callback_data: b.data }))) };
    }
    const res = await fetch(`https://api.telegram.org/bot${COMPRAS_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();
    return data.ok ? { ok: true } : { ok: false, error: data.description || `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/** Tira o "relógio girando" do botão que o dono tocou. */
export async function responderCallbackCompras(callbackId: string, texto?: string): Promise<void> {
  if (!COMPRAS_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${COMPRAS_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text: texto || "" }),
    });
  } catch { /* cosmético */ }
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

/** Baixa um arquivo (foto/documento) do Telegram pelo file_id. */
export async function baixarArquivoTelegram(
  fileId: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!COMPRAS_BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${COMPRAS_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const j: any = await r.json();
    if (!j.ok || !j.result?.file_path) return null;
    const path = String(j.result.file_path);
    const fr = await fetch(`https://api.telegram.org/file/bot${COMPRAS_BOT_TOKEN}/${path}`);
    if (!fr.ok) return null;
    const ab = await fr.arrayBuffer();
    const lower = path.toLowerCase();
    const mime = lower.endsWith(".png") ? "image/png"
      : lower.endsWith(".pdf") ? "application/pdf"
      : lower.endsWith(".webp") ? "image/webp"
      : "image/jpeg";
    return { buffer: Buffer.from(ab), mime };
  } catch (err: any) {
    log(`[telegram] baixarArquivo erro: ${err.message}`, "telegram");
    return null;
  }
}

/** Configura o webhook do bot (recebe mensagens do grupo de comprovantes). */
export async function setWebhookTelegram(
  url: string,
  secretToken?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!COMPRAS_BOT_TOKEN) return { ok: false, error: "TELEGRAM_COMPRAS_BOT_TOKEN não configurado" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${COMPRAS_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        // PRECISA de callback_query, senão o Telegram descarta os toques de botão
        // (o dono não conseguia classificar a compra — "botão inválido", 20/jul).
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      }),
    });
    const j: any = await r.json();
    return j.ok ? { ok: true } : { ok: false, error: j.description || `HTTP ${r.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/** Dados do bot (username etc.) — pra montar as instruções do grupo. */
export async function getMeTelegram(): Promise<{ id: number; username?: string; first_name?: string } | null> {
  if (!COMPRAS_BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${COMPRAS_BOT_TOKEN}/getMe`);
    const j: any = await r.json();
    return j.ok ? j.result : null;
  } catch { return null; }
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
 * Monta o resumo da manhã — formato enxuto inspirado no e-mail do Trinks.
 * Desde 26/06/2026 contém SOMENTE:
 *   1) Fechamento de ontem (faturamento total + comandas + ticket + meta)
 *   2) Top de ontem (até 3 profissionais)
 *   3) Pagamentos de hoje (contas mensais + salário/vale)
 *
 * Os parâmetros `hoje` e `amanha` continuam na assinatura por compatibilidade
 * com chamadas existentes, mas NÃO são exibidos. Quem quiser previsão abre o
 * dashboard pelo link no fim da mensagem.
 *
 * Envia às 8h ter-sáb.
 */
export interface AcumuladoSemanaMes {
  semana: { dias: number; total: number; inicio: string; fim: string };
  mes:    { dias: number; total: number; inicio: string; fim: string };
}

export function montarResumoManha(
  hoje: ResumoDiaData,
  _amanha: ResumoAmanhaData | null,
  ontem?: ResumoDiaData | null,
  pagamentosHoje?: PagamentoHojeItem[],
  acumulado?: AcumuladoSemanaMes | null,
): string {
  // `hoje` é usado só para a data de cabeçalho (já está no fuso correto)
  const dataStr = formatarDataBR(hoje.data);

  let msg = `☀️ <b>Bom dia, Fred!</b>\n`;
  msg += `<i>${escapeHtml(dataStr)}</i>\n\n`;

  // ── 1) Fechamento de ontem ──
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

    // ── 2) Top de ontem (até 3) ──
    const profsOntem = (ontem.porProfissional || []).filter(
      p => p.fechado > 0 || p.countFechado > 0,
    );
    const rankOntem = profsOntem
      .slice()
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
  } else {
    msg += `<i>Sem dados de ontem ainda — checa o dashboard.</i>\n\n`;
  }

  // ── 3) Acumulado da semana e do mês ──
  if (acumulado && (acumulado.semana.dias > 0 || acumulado.mes.dias > 0)) {
    msg += `📈 <b>Acumulado</b>\n`;
    if (acumulado.semana.dias > 0) {
      const lbl = acumulado.semana.dias === 1 ? "dia" : "dias";
      msg += `├ Semana (${acumulado.semana.dias} ${lbl}): <b>${formatCurrency(acumulado.semana.total)}</b>\n`;
    }
    if (acumulado.mes.dias > 0) {
      const lbl = acumulado.mes.dias === 1 ? "dia" : "dias";
      msg += `└ Mês (${acumulado.mes.dias} ${lbl}): <b>${formatCurrency(acumulado.mes.total)}</b>\n`;
    }
    msg += `\n`;
  }

  // ── 4) Pagamentos de hoje (contas + equipe) ──
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
    // Total das contas de hoje (soma só as com valor; sinaliza as variáveis).
    const totalHoje = contas.reduce((s, c) => s + (c.valor != null && c.valor > 0 ? c.valor : 0), 0);
    const variaveis = contas.filter(c => c.valor == null || c.valor <= 0).length;
    if (totalHoje > 0 || variaveis > 0) {
      msg += `<b>Σ Total de hoje: ${formatCurrency(totalHoje)}</b>`;
      msg += variaveis > 0 ? ` <i>(+${variaveis} valor variável)</i>\n` : `\n`;
    }
    msg += `\n`;
  }

  msg += `🔗 <a href="https://grecocontrol.com.br/">Abrir Dashboard</a>`;

  return msg;
}

/**
 * Resumo do MÊS: todas as contas ativas por dia de vencimento + total geral.
 * Enviado sob demanda (botão na página Contas Mensais).
 */
export function montarResumoContasMes(
  resumo: {
    contas: { nome: string; diaVencimento: number; valor: number | null; observacao?: string }[];
    totalConhecido: number;
    qtdContas: number;
    qtdVariaveis: number;
  },
  mesLabel: string,
): string {
  let msg = `📋 <b>Contas do mês</b>\n<i>${escapeHtml(mesLabel)}</i>\n\n`;
  if (resumo.contas.length === 0) {
    msg += `Nenhuma conta cadastrada.\n\n`;
  } else {
    resumo.contas.forEach((c, i) => {
      const last = i === resumo.contas.length - 1;
      const prefix = last ? "└" : "├";
      const dia = String(c.diaVencimento).padStart(2, "0");
      const valorTxt = c.valor != null && c.valor > 0 ? `<b>${formatCurrency(c.valor)}</b>` : `<i>variável</i>`;
      msg += `${prefix} Dia ${dia} · ${escapeHtml(c.nome)} — ${valorTxt}\n`;
    });
  }
  msg += `\n<b>Σ Total do mês: ${formatCurrency(resumo.totalConhecido)}</b>`;
  if (resumo.qtdVariaveis > 0) msg += ` <i>(+${resumo.qtdVariaveis} valor variável, não somado)</i>`;
  msg += `\n\n🔗 <a href="https://grecocontrol.com.br/contas-mensais">Abrir Contas</a>`;
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
