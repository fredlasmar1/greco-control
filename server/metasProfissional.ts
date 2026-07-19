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
  pctProduto?: number;        // % sobre produtos (apenas comissionáveis — exclui bebidas/doces)
  pctPlano?: number;          // % sobre plano/assinatura
  // Bônus de meta: % sobre o que excedeu a meta mensal (serviços).
  // Ex: meta R$10k, fez R$12k, pctBonusExcedente=10 → bônus = R$2k * 10% = R$200
  pctBonusExcedente?: number; // 0..100
  // Salário fixo mensal somado ao saldo (default 0). Camila R$3.000, Guilherme R$1.000.
  salarioFixo?: number;       // R$ por mês
  // Paga por HORA (R$10/h do banco de ponto do Metas) em vez de salarioFixo estático.
  // Débora e Ellen. ⚠️ a Larissa bate ponto mas é CLT → NÃO leva pagaPorHora.
  pagaPorHora?: boolean;
  // Papel, só pra exibição/organização da folha (barbeiro/assistente/secretaria/
  // limpeza/administrativo). Não muda cálculo — o cálculo é regido por pct*/salarioFixo/pagaPorHora.
  papel?: string;
  // Modo de comissão deste profissional. 'global' (default) usa o setting da empresa.
  // 'bruto' = comissão sobre preço cheio. 'liquido' = comissão sobre (preço − insumos).
  modoComissao?: 'bruto' | 'liquido' | 'global';
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
    pctBonusExcedente: 0,
    salarioFixo: 0,
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
