// Lista de produtos que NÃO entram no cálculo de comissão.
// Tipicamente bebidas, doces, snacks — itens vendidos no balcão que
// a barbearia revende mas não remunera o profissional.
//
// Persistido em kv_store sob a chave "produtos_sem_comissao" como um Set
// de IDs Trinks (string). Frontend gerencia a lista.

import { kvGet, kvSet } from "./db";
import { log } from "./index";

const KV_KEY = "produtos_sem_comissao";

// Heurística de detecção automática (case-insensitive):
// se o nome do produto contém qualquer destas palavras, marcamos como "sem comissão"
// na primeira inicialização. Usuário pode editar livremente depois.
const PALAVRAS_AUTO = [
  "agua", "água", "coca", "guarana", "guaraná", "corona", "heineken",
  "energetico", "energético", "cerveja", "refrigerante", "gelos", "gelo",
  "amendoim", "babalu", "pastilha", "snickers", "trento", "trident",
  "chocolate", "bala", "chiclete",
];

let cache: Set<string> | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function getProdutosSemComissao(): Promise<Set<string>> {
  const agora = Date.now();
  if (cache && agora - cacheAt < TTL_MS) return cache;
  try {
    const arr = await kvGet<string[]>(KV_KEY);
    cache = new Set(Array.isArray(arr) ? arr.map(String) : []);
    cacheAt = agora;
    return cache;
  } catch (err: any) {
    log(`getProdutosSemComissao error: ${err.message}`, "produtos");
    return new Set();
  }
}

export function invalidateProdutosSemComissaoCache() {
  cache = null;
  cacheAt = 0;
}

export async function setProdutosSemComissao(ids: string[]): Promise<string[]> {
  const list = Array.from(new Set((ids || []).map(String).filter(Boolean)));
  await kvSet(KV_KEY, list);
  invalidateProdutosSemComissaoCache();
  return list;
}

// Sugere automaticamente quais produtos do catálogo Trinks devem ser
// excluídos da comissão (bebidas/doces). Usado pelo frontend para
// pré-marcar a primeira vez ou via botão "sugerir".
export function sugerirSemComissao(produtosTrinks: any[]): string[] {
  const sugestoes: string[] = [];
  for (const p of produtosTrinks || []) {
    const id = String(p?.id || "");
    const nome = String(p?.nome || p?.descricao || "").toLowerCase();
    if (!id || !nome) continue;
    if (PALAVRAS_AUTO.some(w => nome.includes(w))) sugestoes.push(id);
  }
  return sugestoes;
}
