// Importador do CSV de agendamentos enviado por email pela Trinks
// (atendimento@trinks.com). O CSV vem com 13 colunas em ISO-8859-1 e
// representa a AGENDA (planejamento futuro) — não transações fechadas.
//
// Formato esperado:
//   Data;Hora;Profissional;Serviço;Duração;Cliente;Telefones;Valor;
//   Fechamento Conta;Status;Cadastro;Observações Agendamento;Observações Cliente
//
// Datas: dd/mm/yyyy. Hora: HH:MM. Duração: "1h e 10 min" / "50 min" / "30 min".
// Valor: "R$ 120,00". Status: Confirmado | Cancelado | Finalizado.
import { kvGet, kvSet } from "./db";
import { log } from "./index";
import { createHash } from "node:crypto";

export interface AgendamentoCsv {
  id: string;             // hash sintético (data+hora+prof+cliente)
  dataHoraInicio: string; // ISO local SP (YYYY-MM-DDTHH:MM:00-03:00)
  dataHoraTermino?: string;
  duracao: number;        // minutos
  valor: number;          // R$
  status: { nome: string };
  profissional: { id: string; nome: string };
  servico: { id: string; nome: string };
  cliente: { id: string; nome: string; telefone?: string };
  observacoes?: string;
}

export interface ImportAgendamentosCsvData {
  geradoEm: string;       // último import (timestamp da mesclagem mais recente)
  origemEmail?: string;
  totalLinhas: number;    // total acumulado após mesclagem
  totalConfirmados: number;
  totalCancelados: number;
  totalFinalizados: number;
  dataInicio: string;     // menor data dos agendamentos acumulados (YYYY-MM-DD)
  dataFim: string;        // maior data acumulada
  agendamentos: AgendamentoCsv[];
  // v34: histórico de imports (audit trail)
  totalImports?: number;
  imports?: Array<{
    importadoEm: string;
    linhasNoCsv: number;
    novos: number;
    atualizados: number;
    dataInicioCsv: string;
    dataFimCsv: string;
  }>;
}

const KV_KEY = "trinks_csv_agendamentos";

// ─── Helpers de parsing ──────────────────────────────────────────────────────

function decodeBuffer(buf: Buffer): string {
  // Detecta ISO-8859-1 vs UTF-8. CSV da Trinks vem em latin1.
  // Se já vier UTF-8 (BOM ou multibyte), respeita.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf-8");
  }
  // Heurística simples: tenta UTF-8; se aparecer replacement char demais, usa latin1
  const utf8 = buf.toString("utf-8");
  const replacementChars = (utf8.match(/�/g) || []).length;
  if (replacementChars > 5) return buf.toString("latin1");
  // Verifica padrão de mojibake típico de latin1 lido como utf8 (Ã©, Ã§, Ã£, etc.)
  if (/Ã[©£ª¡§]/.test(utf8)) return buf.toString("latin1");
  return utf8;
}

function parseDuracao(s: string): number {
  // "1h e 10 min" / "50 min" / "1h" / "30 min"
  const txt = (s || "").toLowerCase();
  let total = 0;
  const h = txt.match(/(\d+)\s*h/);
  if (h) total += Number(h[1]) * 60;
  const m = txt.match(/(\d+)\s*min/);
  if (m) total += Number(m[1]);
  return total;
}

function parseValor(s: string): number {
  // "R$ 120,00" → 120.00 ; "R$ 1.234,50" → 1234.50
  const cleaned = (s || "").replace(/r\$/i, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

function parseDataBr(s: string): string | null {
  // dd/mm/yyyy → YYYY-MM-DD
  const m = (s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

function toIsoLocalSP(date: string, hora: string, durMin = 0): { inicio: string; fim?: string } {
  // Constrói ISO com offset -03:00 (SP, sem DST atual). Aceitável: a app
  // sempre interpreta com offset local.
  const horaSafe = (hora || "00:00").trim().padEnd(5, "0").slice(0, 5);
  const inicio = `${date}T${horaSafe}:00-03:00`;
  if (durMin <= 0) return { inicio };
  const ms = new Date(inicio).getTime() + durMin * 60 * 1000;
  const fim = new Date(ms).toISOString();
  return { inicio, fim };
}

function hashId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

// Lê uma linha CSV com separador `;` respeitando aspas duplas opcionais.
function splitCsvLine(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// ─── Parser principal ────────────────────────────────────────────────────────

export function parseCsvAgendamentos(input: Buffer | string): ImportAgendamentosCsvData {
  const text = typeof input === "string" ? input : decodeBuffer(input);
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error("CSV vazio");

  // Header
  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  // Mapeia índice de cada coluna esperada (tolerante a ordem)
  const idx = (cands: string[]) => {
    for (const c of cands) {
      const i = header.findIndex(h => h === c || h.includes(c));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iData    = idx(["data"]);
  const iHora    = idx(["hora"]);
  const iProf    = idx(["profissional"]);
  const iServico = idx(["serviço", "servico"]);
  const iDur     = idx(["duração", "duracao"]);
  const iCliente = idx(["cliente"]);
  const iTel     = idx(["telefones", "telefone"]);
  const iValor   = idx(["valor"]);
  const iStatus  = idx(["status"]);
  const iObs     = idx(["observações agendamento", "observacoes agendamento"]);

  if (iData < 0 || iHora < 0 || iProf < 0 || iServico < 0 || iCliente < 0 || iStatus < 0) {
    throw new Error("CSV inválido: faltam colunas obrigatórias (Data, Hora, Profissional, Serviço, Cliente, Status)");
  }

  const agendamentos: AgendamentoCsv[] = [];
  let totalConf = 0, totalCanc = 0, totalFin = 0;
  let dataMin = "9999-99-99", dataMax = "0000-00-00";

  for (let n = 1; n < lines.length; n++) {
    const cols = splitCsvLine(lines[n]);
    const data = parseDataBr(cols[iData] || "");
    if (!data) continue; // pula linhas inválidas (rodapé etc.)

    const hora = (cols[iHora] || "").trim();
    const profNome = (cols[iProf] || "").trim();
    const servNome = (cols[iServico] || "").trim();
    const cliNome  = (cols[iCliente] || "").trim();
    if (!profNome || !servNome || !cliNome) continue;

    const dur = iDur >= 0 ? parseDuracao(cols[iDur] || "") : 0;
    const valor = iValor >= 0 ? parseValor(cols[iValor] || "") : 0;
    const tel = iTel >= 0 ? (cols[iTel] || "").trim() : undefined;
    const obs = iObs >= 0 ? (cols[iObs] || "").trim() || undefined : undefined;
    const statusRaw = (cols[iStatus] || "").trim();
    const statusLower = statusRaw.toLowerCase();
    if (statusLower.includes("cancel")) totalCanc++;
    else if (statusLower.includes("finaliz")) totalFin++;
    else if (statusLower.includes("confirm")) totalConf++;

    const { inicio, fim } = toIsoLocalSP(data, hora, dur);
    const id = hashId(data, hora, profNome, cliNome, servNome);

    agendamentos.push({
      id,
      dataHoraInicio: inicio,
      dataHoraTermino: fim,
      duracao: dur,
      valor,
      status: { nome: statusRaw || "?" },
      profissional: { id: hashId("prof", profNome), nome: profNome },
      servico: { id: hashId("svc", servNome), nome: servNome },
      cliente: { id: hashId("cli", cliNome, tel || ""), nome: cliNome, telefone: tel },
      observacoes: obs,
    });

    if (data < dataMin) dataMin = data;
    if (data > dataMax) dataMax = data;
  }

  return {
    geradoEm: new Date().toISOString(),
    totalLinhas: agendamentos.length,
    totalConfirmados: totalConf,
    totalCancelados: totalCanc,
    totalFinalizados: totalFin,
    dataInicio: dataMin === "9999-99-99" ? "" : dataMin,
    dataFim: dataMax === "0000-00-00" ? "" : dataMax,
    agendamentos,
  };
}

// ─── Persistência ────────────────────────────────────────────────────────────

/** Salva uma nova importação MESCLANDO com a anterior. Agendamentos com
 *  mesmo `id` (hash data+hora+prof+cliente) são sobrescritos pelo mais recente
 *  — o que permite corrigir status (ex: Confirmado → Finalizado) ao receber um
 *  CSV mais novo. Agendamentos antigos não presentes no CSV novo são
 *  preservados. Retorna stats da mesclagem. */
export async function salvarImportAgendamentos(novo: ImportAgendamentosCsvData): Promise<{
  totalAcumulado: number; novos: number; atualizados: number;
}> {
  const anterior = (await kvGet<ImportAgendamentosCsvData>(KV_KEY)) || null;
  const merged = new Map<string, AgendamentoCsv>();

  if (anterior?.agendamentos) {
    for (const a of anterior.agendamentos) merged.set(a.id, a);
  }
  let novos = 0, atualizados = 0;
  for (const a of novo.agendamentos) {
    if (merged.has(a.id)) atualizados++;
    else novos++;
    merged.set(a.id, a);
  }

  const todos = Array.from(merged.values());
  // Recalcula totais e range agregados
  let conf = 0, canc = 0, fin = 0;
  let dMin = "9999-99-99", dMax = "0000-00-00";
  for (const a of todos) {
    const st = (a.status?.nome || "").toLowerCase();
    if (st.includes("cancel")) canc++;
    else if (st.includes("finaliz")) fin++;
    else if (st.includes("confirm")) conf++;
    const d = (a.dataHoraInicio || "").slice(0, 10);
    if (d && d < dMin) dMin = d;
    if (d && d > dMax) dMax = d;
  }
  const importLog = anterior?.imports ? [...anterior.imports] : [];
  importLog.push({
    importadoEm: novo.geradoEm,
    linhasNoCsv: novo.agendamentos.length,
    novos, atualizados,
    dataInicioCsv: novo.dataInicio,
    dataFimCsv: novo.dataFim,
  });
  // Mantém últimos 50 imports no log (audit trail enxuto)
  while (importLog.length > 50) importLog.shift();

  const consolidado: ImportAgendamentosCsvData = {
    geradoEm: novo.geradoEm,
    origemEmail: novo.origemEmail || anterior?.origemEmail,
    totalLinhas: todos.length,
    totalConfirmados: conf,
    totalCancelados: canc,
    totalFinalizados: fin,
    dataInicio: dMin === "9999-99-99" ? "" : dMin,
    dataFim: dMax === "0000-00-00" ? "" : dMax,
    agendamentos: todos,
    totalImports: importLog.length,
    imports: importLog,
  };
  await kvSet(KV_KEY, consolidado);
  log(`csv-agendamentos: mesclou +${novos} novos / ~${atualizados} atualizados → ${todos.length} total (${consolidado.dataInicio}..${consolidado.dataFim})`, "csv");
  return { totalAcumulado: todos.length, novos, atualizados };
}

/** Apaga TODOS os agendamentos importados — use com cuidado, só pra reset manual. */
export async function resetImportAgendamentos(): Promise<void> {
  await kvSet(KV_KEY, null);
  log(`csv-agendamentos: RESET total — todos os agendamentos importados foram apagados`, "csv");
}

export async function getUltimoImportAgendamentos(): Promise<ImportAgendamentosCsvData | null> {
  return (await kvGet<ImportAgendamentosCsvData>(KV_KEY)) || null;
}

/** Helper: usado em endpoints que precisam de agendamentos. Devolve a lista
 *  do CSV se o último import for fresco (≤ 24h), senão null. */
export async function getAgendamentosCsvFreshOrNull(maxAgeHours = 24): Promise<AgendamentoCsv[] | null> {
  const last = await getUltimoImportAgendamentos();
  if (!last) return null;
  const ageMs = Date.now() - new Date(last.geradoEm).getTime();
  if (ageMs > maxAgeHours * 60 * 60 * 1000) return null;
  return last.agendamentos;
}
