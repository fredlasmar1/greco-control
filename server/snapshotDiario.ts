// Snapshot diário persistente — o "Cérebro de Dados".
//
// Captura uma fotografia do dia (faturamento, agendamentos finalizados,
// breakdown por meio, comissões previstas) em uma das 3 fontes possíveis,
// em cascata de prioridade:
//   1. API Trinks ao vivo (dado mais preciso)
//   2. CSV de agendamentos vindo por email (boa cobertura, status pode ter lag)
//   3. CSV financeiro importado manual (último recurso)
//
// Snapshot vira fonte da verdade pra todos os endpoints históricos. Quando
// algo já foi capturado, NÃO precisa mais bater na Trinks. Mês passado
// fica preservado para sempre — mesmo que a Trinks suma amanhã.
//
// Chave kv_store: `snapshot_dia:YYYY-MM-DD` → SnapshotDia
//        kv_store: `snapshot_dia_meta` → { ultimoCapturadoEm, totalSnapshots }
import { kvGet, kvSet } from "./db";
import { log } from "./index";

export type FonteSnapshot =
  | "trinks-api"           // API Trinks respondeu com dados completos
  | "csv-agendamentos"     // CSV do email (cobertura por status)
  | "csv-financeiro"       // CSV financeiro Trinks (mensal, fallback)
  | "vazio";               // Nenhuma fonte disponível — não apaga snapshot existente

export interface SnapshotDia {
  data: string;                  // YYYY-MM-DD
  fonte: FonteSnapshot;
  capturadoEm: string;           // ISO timestamp
  // Resumo de faturamento
  faturamento: {
    total: number;
    pix: number;
    cartao: number;
    dinheiro: number;
    plano: number;          // pagamento via saldo de plano
    voucher: number;        // cortesia
    outros: number;
    qtdTransacoes: number;
  };
  // Agendamentos do dia (finalizados + confirmados que aconteceram)
  agendamentos: {
    finalizados: number;
    confirmados: number;
    cancelados: number;
    noShow: number;
  };
  // Comissões previstas/realizadas (chave: nome normalizado do profissional)
  comissoesPorProf?: Record<string, {
    nome: string;
    servicosLiquido: number;
    produtosLiquido: number;
    planoReais: number;
    qtdAtendimentos: number;
  }>;
  // Detalhe bruto pra reprocessamentos (opcional, pesa pouco em kv)
  transacoesIds?: string[];
  agendamentosIds?: string[];
  // v36 Fase 3: dados brutos pra reusar em endpoints downstream
  // (calcularPeriodoPorProfissional, ranking, etc) sem precisar refazer fetch.
  // agendamentosRaw é o que veio do CSV (sempre disponível pra dias capturados)
  // transacoesRaw só está disponível quando fonte = trinks-api
  agendamentosRaw?: any[];
  transacoesRaw?: any[];
  // Erros/avisos durante a captura
  avisos?: string[];
}

const KV_PREFIX = "snapshot_dia:";
const KV_META = "snapshot_dia_meta";

function kvKey(data: string): string {
  return `${KV_PREFIX}${data}`;
}

export async function getSnapshot(data: string): Promise<SnapshotDia | null> {
  return (await kvGet<SnapshotDia>(kvKey(data))) || null;
}

export async function listSnapshotsDoMes(mes: string): Promise<SnapshotDia[]> {
  // Tenta carregar dia por dia (mais barato que list-all-keys)
  if (!/^\d{4}-\d{2}$/.test(mes)) return [];
  const [y, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  const promises: Promise<SnapshotDia | null>[] = [];
  for (let d = 1; d <= ultimoDia; d++) {
    const data = `${mes}-${String(d).padStart(2, "0")}`;
    promises.push(getSnapshot(data));
  }
  const results = await Promise.all(promises);
  return results.filter((s): s is SnapshotDia => s !== null);
}

export async function saveSnapshot(snap: SnapshotDia): Promise<void> {
  await kvSet(kvKey(snap.data), snap);
  // Atualiza meta
  const meta = (await kvGet<{ ultimoCapturadoEm: string; totalSnapshots: number }>(KV_META)) || { ultimoCapturadoEm: "", totalSnapshots: 0 };
  meta.ultimoCapturadoEm = snap.capturadoEm;
  // Recalcula totalSnapshots? Caro. Só incrementa se for novo (saimos com aproximação).
  meta.totalSnapshots = (meta.totalSnapshots || 0) + 1;
  await kvSet(KV_META, meta);
  log(`snapshot_dia ${snap.data} salvo (fonte=${snap.fonte} fat=R$${snap.faturamento.total.toFixed(2)})`, "snapshot");
}

/** Estrutura zerada — usada quando NENHUMA fonte tem dado. NÃO sobrescreve
 *  snapshot anterior; só serve como retorno padrão pra UI. */
export function snapshotVazio(data: string): SnapshotDia {
  return {
    data, fonte: "vazio",
    capturadoEm: new Date().toISOString(),
    faturamento: { total: 0, pix: 0, cartao: 0, dinheiro: 0, plano: 0, voucher: 0, outros: 0, qtdTransacoes: 0 },
    agendamentos: { finalizados: 0, confirmados: 0, cancelados: 0, noShow: 0 },
    avisos: ["Nenhuma fonte (Trinks API, CSV agendamentos, CSV financeiro) disponível pra esta data."],
  };
}

/** Helper: classifica forma de pagamento Trinks pra um bucket do snapshot. */
export function classificarFormaPagamento(nome: string): keyof SnapshotDia["faturamento"] {
  const n = (nome || "").toLowerCase();
  if (n.includes("pix")) return "pix";
  if (n.includes("créd") || n.includes("cred") || n.includes("déb") || n.includes("deb") || n.includes("cart")) return "cartao";
  if (n.includes("dinhe") || n.includes("espéc") || n.includes("espec")) return "dinheiro";
  if (n.includes("depós") || n.includes("depos") || n.includes("saldo") || n.includes("plano") || n.includes("assinat")) return "plano";
  if (n.includes("voucher") || n.includes("cortes") || n.includes("promo")) return "voucher";
  return "outros";
}
