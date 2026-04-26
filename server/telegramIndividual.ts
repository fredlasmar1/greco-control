// Mensagens Telegram individuais por profissional (di\u00e1rio, semanal, mensal).

import { enviarMensagem } from "./telegram";
import { getAllMetas, type MetaProfissional } from "./metasProfissional";
import { log } from "./index";

function escapeHtml(s: any): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatCurrency(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function progressBar(pct: number, len = 10): string {
  const filled = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
  return "\u2593".repeat(filled) + "\u2591".repeat(len - filled);
}

function nomePequeno(nome: string): string {
  // pega o primeiro nome
  return (nome || "").trim().split(/\s+/)[0] || "voc\u00ea";
}

// ─── Tipo gen\u00e9rico de desempenho num per\u00edodo ────────────
export interface DesempenhoPeriodo {
  reais: number;
  count: number;
  avulsoReais: number;
  avulsoCount: number;
  planoReais: number;
  planoCount: number;
}

export interface PayloadIndividual {
  profissional: { id: string; nome: string };
  meta: MetaProfissional;
  // Os 3 períodos (todos opcionais — só preenche o que for relevante)
  dia?: DesempenhoPeriodo & { dataReferencia: string };
  semana?: DesempenhoPeriodo & { dataInicio: string; dataFim: string };
  mes?: DesempenhoPeriodo & { mes: string; diasUteisDecorridos: number; diasUteisTotal: number };
  // Posição/ranking opcional
  posicaoEquipeMes?: { posicao: number; total: number };
}

// ─── Resumo DI\u00c1RIO ────────────────────────────────
export function montarResumoDiarioIndividual(p: PayloadIndividual): string {
  const { profissional, meta, dia, mes } = p;
  const nome = nomePequeno(profissional.nome);
  const dataFmt = dia?.dataReferencia
    ? new Date(dia.dataReferencia + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })
    : "";

  let msg = `\ud83c\udf19 <b>Boa noite, ${escapeHtml(nome)}!</b>\n`;
  if (dataFmt) msg += `<i>Fechamento de ${escapeHtml(dataFmt)}</i>\n\n`;

  if (dia) {
    const ticket = dia.count > 0 ? dia.reais / dia.count : 0;
    msg += `\ud83d\udcb0 <b>Hoje</b>\n`;
    msg += `\u251c Faturamento: <b>${formatCurrency(dia.reais)}</b>\n`;
    msg += `\u251c Atendimentos: <b>${dia.count}</b>\n`;
    msg += `\u2514 Ticket m\u00e9dio: ${formatCurrency(ticket)}\n`;
    if (dia.planoCount > 0) {
      msg += `   \ud83c\udfab Plano: ${dia.planoCount} atend. (${formatCurrency(dia.planoReais)} em tabela)\n`;
    }
    msg += `\n`;
  }

  if (mes && meta.metaReais > 0) {
    const pctMes = (mes.reais / meta.metaReais) * 100;
    const pctIdeal = mes.diasUteisTotal > 0 ? (mes.diasUteisDecorridos / mes.diasUteisTotal) * 100 : 0;
    const farol = pctMes >= pctIdeal - 5 ? "\u2705" : pctMes >= pctIdeal - 15 ? "\u26a0\ufe0f" : "\ud83d\udd34";
    msg += `\ud83d\udcc5 <b>Acumulado do m\u00eas</b>\n`;
    msg += `${formatCurrency(mes.reais)} / ${formatCurrency(meta.metaReais)} (<b>${pctMes.toFixed(0)}%</b>) ${farol}\n`;
    msg += `${progressBar(pctMes)}\n`;
    if (meta.metaAtendimentos > 0) {
      const pctAtend = (mes.count / meta.metaAtendimentos) * 100;
      msg += `\ud83d\udc65 ${mes.count} / ${meta.metaAtendimentos} atend. (${pctAtend.toFixed(0)}%)\n`;
    }
    if (mes.diasUteisTotal > mes.diasUteisDecorridos) {
      const restantes = mes.diasUteisTotal - mes.diasUteisDecorridos;
      const ritmoNecessario = (meta.metaReais - mes.reais) / Math.max(1, restantes);
      msg += `\ud83c\udfaf Faltam ${restantes} dias \u00fateis \u00b7 ritmo necess\u00e1rio: ${formatCurrency(ritmoNecessario)}/dia\n`;
    }
    if (p.posicaoEquipeMes) {
      msg += `\ud83c\udfc6 Posi\u00e7\u00e3o no m\u00eas: <b>${p.posicaoEquipeMes.posicao}\u00ba</b> de ${p.posicaoEquipeMes.total}\n`;
    }
  } else if (mes && meta.metaReais === 0) {
    msg += `\ud83d\udcc5 M\u00eas: ${formatCurrency(mes.reais)} \u00b7 ${mes.count} atend.\n`;
  }

  msg += `\n<i>Bom descanso!</i>`;
  return msg;
}

// ─── Resumo SEMANAL ────────────────────────────────
export function montarResumoSemanalIndividual(p: PayloadIndividual): string {
  const { profissional, meta, semana, mes } = p;
  const nome = nomePequeno(profissional.nome);
  let msg = `\ud83d\udcca <b>Sua semana, ${escapeHtml(nome)}</b>\n`;
  if (semana) {
    const di = new Date(semana.dataInicio + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const df = new Date(semana.dataFim + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    msg += `<i>${di} a ${df} (ter\u00e7a a s\u00e1bado)</i>\n\n`;

    const ticket = semana.count > 0 ? semana.reais / semana.count : 0;
    msg += `\ud83d\udcb0 Faturamento: <b>${formatCurrency(semana.reais)}</b>\n`;
    msg += `\ud83d\udc65 Atendimentos: <b>${semana.count}</b>\n`;
    msg += `\ud83c\udfaf Ticket m\u00e9dio: ${formatCurrency(ticket)}\n`;
    if (semana.planoCount > 0) {
      msg += `\ud83c\udfab Plano: ${semana.planoCount} atend. (${formatCurrency(semana.planoReais)})\n`;
    }
    msg += `\n`;
  }

  if (mes && meta.metaReais > 0) {
    const pctMes = (mes.reais / meta.metaReais) * 100;
    const pctIdeal = mes.diasUteisTotal > 0 ? (mes.diasUteisDecorridos / mes.diasUteisTotal) * 100 : 0;
    const farol = pctMes >= pctIdeal - 5 ? "\u2705 no ritmo" : pctMes >= pctIdeal - 15 ? "\u26a0\ufe0f um pouco atr\u00e1s" : "\ud83d\udd34 abaixo do ritmo";
    msg += `\ud83d\udcc5 <b>Acumulado do m\u00eas</b>\n`;
    msg += `${formatCurrency(mes.reais)} / ${formatCurrency(meta.metaReais)} \u00b7 <b>${pctMes.toFixed(0)}%</b>\n`;
    msg += `${progressBar(pctMes)} ${farol}\n`;
    if (p.posicaoEquipeMes) {
      msg += `\ud83c\udfc6 Posi\u00e7\u00e3o: <b>${p.posicaoEquipeMes.posicao}\u00ba</b> de ${p.posicaoEquipeMes.total}\n`;
    }
  }
  return msg;
}

// ─── Resumo MENSAL ────────────────────────────────
export function montarResumoMensalIndividual(p: PayloadIndividual): string {
  const { profissional, meta, mes } = p;
  const nome = nomePequeno(profissional.nome);
  let msg = `\ud83c\udfc1 <b>Fechamento do m\u00eas, ${escapeHtml(nome)}</b>\n`;
  if (mes) {
    const mesFmt = new Date(mes.mes + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    msg += `<i>${escapeHtml(mesFmt)}</i>\n\n`;

    const ticket = mes.count > 0 ? mes.reais / mes.count : 0;
    msg += `\ud83d\udcb0 Faturamento: <b>${formatCurrency(mes.reais)}</b>\n`;
    if (meta.metaReais > 0) {
      const pct = (mes.reais / meta.metaReais) * 100;
      const bateu = mes.reais >= meta.metaReais;
      msg += `${bateu ? "\ud83c\udf89" : "\u26a0\ufe0f"} Meta: ${formatCurrency(meta.metaReais)} \u00b7 <b>${pct.toFixed(0)}%</b>\n`;
      msg += `${progressBar(pct)}\n`;
    }
    msg += `\ud83d\udc65 Atendimentos: <b>${mes.count}</b>`;
    if (meta.metaAtendimentos > 0) {
      const pctA = (mes.count / meta.metaAtendimentos) * 100;
      msg += ` / ${meta.metaAtendimentos} (${pctA.toFixed(0)}%)`;
    }
    msg += `\n`;
    msg += `\ud83c\udfaf Ticket m\u00e9dio: ${formatCurrency(ticket)}\n`;
    if (mes.planoCount > 0) {
      msg += `\ud83c\udfab Plano: ${mes.planoCount} atend. (${formatCurrency(mes.planoReais)} em tabela)\n`;
      msg += `   Avulso: ${mes.avulsoCount} atend. (${formatCurrency(mes.avulsoReais)})\n`;
    }
  }

  if (p.posicaoEquipeMes) {
    msg += `\n\ud83c\udfc6 Posi\u00e7\u00e3o final: <b>${p.posicaoEquipeMes.posicao}\u00ba</b> de ${p.posicaoEquipeMes.total}\n`;
  }
  msg += `\n<i>Obrigado pelo m\u00eas, ${escapeHtml(nome)}!</i>`;
  return msg;
}

// ─── Envio com fallback de chat_id ────────────────────────────────
export async function enviarParaProfissional(
  meta: MetaProfissional,
  texto: string,
): Promise<{ ok: boolean; error?: string; viaProprio: boolean }> {
  const chatId = (meta.telegramChatId || "").trim();
  if (chatId) {
    const r = await enviarMensagem(texto, { chatId });
    if (r.ok) return { ok: true, viaProprio: true };
    log(`[telegram-indiv] falha enviando p/ ${meta.nome} (${chatId}): ${r.error} \u2014 caindo no chat principal`, "telegram");
    // Fallback: manda pro chat principal com cabe\u00e7alho identificando
    const r2 = await enviarMensagem(`\u26a0\ufe0f Mensagem que era pra ${escapeHtml(meta.nome)} (chat n\u00e3o respondeu):\n\n${texto}`);
    return { ok: r2.ok, error: r2.error, viaProprio: false };
  }
  // Sem chat_id pr\u00f3prio: manda pro chat principal com cabe\u00e7alho
  const r = await enviarMensagem(`\ud83d\udc64 <b>${escapeHtml(meta.nome)}</b>\n\n${texto}`);
  return { ok: r.ok, error: r.error, viaProprio: false };
}

// ─── Helper p\u00fablico: lista as metas ativas de envio ────────────
export async function listarMetasAtivas(): Promise<MetaProfissional[]> {
  const all = await getAllMetas();
  return Object.values(all).filter(m => m.ativoEnvio);
}
