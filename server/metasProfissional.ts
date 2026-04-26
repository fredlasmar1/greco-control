// Storage e helpers para metas individuais por profissional.
// Persistido em kv_store (Postgres) sob a chave "metas_profissional".
import { kvGet, kvSet } from "./db";
import { log } from "./index";

export interface MetaProfissional {
  profissionalId: string;
  nome: string;
  metaReais: number;          // meta mensal em R$
  metaAtendimentos: number;   // meta mensal de quantidade
  telegramChatId: string;     // chat_id próprio (vazio = cai no chat principal)
  ativoEnvio: boolean;        // se recebe resumos individuais
  atualizadoEm: string;       // ISO timestamp
  // Percentuais de comissão (0-100) por categoria — default 0 (sem comissão)
  pctServico?: number;        // % sobre serviços
  pctProduto?: number;        // % sobre produtos
  pctPlano?: number;          // % sobre plano/assinatura
}

const KV_KEY = "metas_profissional";

export async function getAllMetas(): Promise<Record<string, MetaProfissional>> {
  try {
    const data = await kvGet<Record<string, MetaProfissional>>(KV_KEY);
    return data || {};
  } catch (err: any) {
    log(`getAllMetas error: ${err.message}`, "metas");
    return {};
  }
}

export async function getMeta(profissionalId: string): Promise<MetaProfissional | null> {
  const all = await getAllMetas();
  return all[profissionalId] || null;
}

export async function upsertMeta(input: Partial<MetaProfissional> & { profissionalId: string; nome: string }): Promise<MetaProfissional> {
  const all = await getAllMetas();
  const atual = all[input.profissionalId] || {
    profissionalId: input.profissionalId,
    nome: input.nome,
    metaReais: 0,
    metaAtendimentos: 0,
    telegramChatId: "",
    ativoEnvio: false,
    atualizadoEm: new Date().toISOString(),
    pctServico: 0,
    pctProduto: 0,
    pctPlano: 0,
  };
  const novo: MetaProfissional = {
    ...atual,
    ...input,
    atualizadoEm: new Date().toISOString(),
  };
  all[input.profissionalId] = novo;
  await kvSet(KV_KEY, all);
  return novo;
}

export async function deleteMeta(profissionalId: string): Promise<void> {
  const all = await getAllMetas();
  delete all[profissionalId];
  await kvSet(KV_KEY, all);
}

export async function listMetasAtivas(): Promise<MetaProfissional[]> {
  const all = await getAllMetas();
  return Object.values(all).filter(m => m.ativoEnvio);
}
