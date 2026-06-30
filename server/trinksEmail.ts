// v81: Leitura automática do e-mail "Resumo do dia" da Trinks (atendimento@trinks.com).
// Conecta no Gmail por IMAP (senha de app em GMAIL_USER/GMAIL_APP_PASSWORD), filtra
// pelos e-mails de fechamento, extrai o Valor Total (oficial) + breakdown e grava o
// snapshot do dia com fonte "trinks-email" (verdade absoluta). 0 token Trinks.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { saveSnapshot, getSnapshot, type SnapshotDia } from "./snapshotDiario";
import { kvSet } from "./db";
import { log } from "./index";

function numBR(s: string): number {
  const n = Number(String(s || "").replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

// HTML do e-mail → texto plano (tags viram espaço, decodifica entidades, colapsa).
function htmlParaTexto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&#?\w+;/g, " ")
    .replace(/[ \t\r\n]+/g, " ").trim();
}

// Extrai os campos do e-mail "Resumo do dia". Recebe HTML (preferido) ou texto;
// tolera o espaçamento de tabela ("Serviços 63 R$ 3.150,00", "Serviços 0 R$ 0,00").
const MESES_PT: Record<string, string> = {
  janeiro: "01", fevereiro: "02", "março": "03", marco: "03", abril: "04", maio: "05", junho: "06",
  julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};
export function parseFechamentoTrinks(corpo: string): {
  data: string | null; total: number; servicos: number; produtos: number; pacotes: number;
  finalizados: number; confirmados: number; cancelados: number; noShow: number; clientesPagantes: number;
  totalMes: number; mesRef: string | null;
} {
  const t = /<[a-z]/i.test(corpo) ? htmlParaTexto(corpo) : corpo.replace(/[ \t\r\n]+/g, " ");
  const mData = t.match(/fechamento\s+no\s+dia\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const data = mData ? `${mData[3]}-${mData[2]}-${mData[1]}` : null;
  const pega = (re: RegExp) => { const m = t.match(re); return m ? numBR(m[1]) : 0; };
  // "[^R]{0,14}" pula a coluna QNTD (ex.: " 63 ", " 12 UN ") até chegar no "R$".
  const total = pega(/Valor\s+Total[^R]{0,14}R\$\s*(-?[\d.,]+)/i);
  const servicos = pega(/Servi[çc]os[^R]{0,14}R\$\s*([\d.,]+)/i);
  const produtos = pega(/Produtos[^R]{0,14}R\$\s*([\d.,]+)/i);
  const pacotes = pega(/Pacotes[^R]{0,14}R\$\s*([\d.,]+)/i);
  const clientesPagantes = pega(/clientes\s+com\s+pagamento\D{0,6}(\d+)/i);
  // "Total Junho/2026 R$ 84.719,25" = receita OFICIAL do mês acumulada
  let totalMes = 0, mesRef: string | null = null;
  const mTM = t.match(/Total\s+(Janeiro|Fevereiro|Mar[çc]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*\/?\s*(\d{4})[^R]{0,8}R\$\s*([\d.,]+)/i);
  if (mTM) { totalMes = numBR(mTM[3]); const mm = MESES_PT[mTM[1].toLowerCase()]; if (mm) mesRef = `${mTM[2]}-${mm}`; }
  // Agendamentos: "...cliente faltou 95 10 55 24 6" (total, confirmado, finalizado, cancelado, faltou)
  let finalizados = 0, confirmados = 0, cancelados = 0, noShow = 0;
  const mAg = t.match(/cliente\s+faltou\D{0,6}(\d+)\D+(\d+)\D+(\d+)\D+(\d+)\D+(\d+)/i);
  if (mAg) { confirmados = +mAg[2]; finalizados = +mAg[3]; cancelados = +mAg[4]; noShow = +mAg[5]; }
  return { data, total, servicos, produtos, pacotes, finalizados, confirmados, cancelados, noShow, clientesPagantes, totalMes, mesRef };
}

export async function sincronizarEmailsTrinks(opts?: { dias?: number; max?: number }): Promise<{
  ok: boolean; erro?: string; processados: number; resultados: Array<{ data: string; total: number; fonteAntiga?: string }>;
}> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { ok: false, erro: "GMAIL_USER/GMAIL_APP_PASSWORD nao configurados", processados: 0, resultados: [] };

  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  const resultados: Array<{ data: string; total: number; fonteAntiga?: string }> = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date();
      since.setDate(since.getDate() - (opts?.dias ?? 7));
      // filtra pelo ASSUNTO "Resumo do dia" — a Trinks manda muitos outros e-mails
      const uids = await client.search({ from: "atendimento@trinks.com", subject: "Resumo do dia", since }, { uid: true });
      const lista = Array.isArray(uids) ? uids.slice(-(opts?.max ?? 12)) : [];
      const totaisMes = new Map<string, number>(); // mesRef → maior "Total Mês" oficial visto
      for (const uid of lista) {
        const msg: any = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg?.source) continue;
        const parsed = await simpleParser(msg.source);
        const corpo = (parsed.html || parsed.text || "").toString();
        const f = parseFechamentoTrinks(corpo);
        // "Total Mês" oficial — guarda o maior (= email mais recente do mês), mesmo
        // que o dia já esteja gravado. É a RECEITA do mês (inclui Clube/recorrente).
        if (f.totalMes > 0 && f.mesRef) {
          if (f.totalMes > (totaisMes.get(f.mesRef) || 0)) totaisMes.set(f.mesRef, f.totalMes);
        }
        if (!f.data || f.total <= 0) continue; // domingo/dia fechado = 0 → ignora (já é 0 no sistema)
        const anterior = await getSnapshot(f.data);
        if (anterior?.fonte === "trinks-email" && Math.abs((anterior.faturamento?.total || 0) - f.total) < 0.01) continue;
        const snap: SnapshotDia = {
          data: f.data,
          fonte: "trinks-email",
          capturadoEm: new Date().toISOString(),
          faturamento: {
            total: f.total,
            pix: 0, cartao: 0, dinheiro: 0, plano: f.pacotes, voucher: 0,
            outros: Math.max(0, f.total - f.servicos - f.produtos - f.pacotes),
            qtdTransacoes: f.clientesPagantes || anterior?.faturamento?.qtdTransacoes || 0,
          },
          agendamentos: {
            finalizados: f.finalizados || anterior?.agendamentos?.finalizados || 0,
            confirmados: f.confirmados || anterior?.agendamentos?.confirmados || 0,
            cancelados: f.cancelados || anterior?.agendamentos?.cancelados || 0,
            noShow: f.noShow || anterior?.agendamentos?.noShow || 0,
          },
          comissoesPorProf: anterior?.comissoesPorProf,
          agendamentosRaw: anterior?.agendamentosRaw,
          avisos: [`E-mail Trinks "Resumo do dia": servicos R$${f.servicos} + produtos R$${f.produtos} + pacotes R$${f.pacotes}.`],
        };
        await saveSnapshot(snap);
        resultados.push({ data: f.data, total: f.total, fonteAntiga: anterior?.fonte });
      }
      // grava o "Total Mês" oficial de cada mês visto (receita real, com Clube/recorrente)
      for (const [mesRef, total] of totaisMes) {
        await kvSet(`trinks_total_mes:${mesRef}`, { total, atualizadoEm: new Date().toISOString() });
      }
    } finally { lock.release(); }
    await client.logout();
    return { ok: true, processados: resultados.length, resultados };
  } catch (err: any) {
    try { await client.close(); } catch {}
    log(`[trinks-email] erro: ${err.message}`, "trinks-email");
    return { ok: false, erro: err.message, processados: resultados.length, resultados };
  }
}
