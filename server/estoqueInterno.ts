// Estoque INTERNO da barbearia (decisão do dono 07/07): o cadastro de produtos é
// NOSSO, não o catálogo da Trinks. O dono passa o estoque que tem dentro da loja;
// a Trinks (Gmail→API→CSV) serve só pra DAR BAIXA das vendas. Custa ~0 token: esta
// lista vive no kv_store, e o saldo vem das movimentações (pente fino + baixas).
//
// kv_store: chave "estoque_produtos_internos" → ProdutoInterno[].

import { kvGet, kvSet } from "./db";
import { randomUUID } from "crypto";

export interface ProdutoInterno {
  id: string;            // id interno (uuid) — NÃO é o id da Trinks
  nome: string;
  categoria?: string;
  minimo?: number;       // pra alerta de reposição
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

const KV_KEY = "estoque_produtos_internos";

let cache: ProdutoInterno[] | null = null;
let cacheAt = 0;
const TTL = 15_000;

// normaliza nome pra casar com o que vier da Trinks (baixa/vendidos): sem acento,
// minúsculo, espaços colapsados.
export function normProdNome(s: any): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

export async function listarProdutosInternos(): Promise<ProdutoInterno[]> {
  const agora = Date.now();
  if (cache && agora - cacheAt < TTL) return cache;
  const arr = await kvGet<ProdutoInterno[]>(KV_KEY).catch(() => null);
  cache = Array.isArray(arr) ? arr : [];
  cacheAt = agora;
  return cache;
}

function invalidate() { cache = null; cacheAt = 0; }

async function salvar(lista: ProdutoInterno[]): Promise<void> {
  await kvSet(KV_KEY, lista);
  invalidate();
}

export async function addProdutoInterno(input: { nome: string; categoria?: string; minimo?: number }): Promise<ProdutoInterno> {
  const nome = String(input.nome || "").trim();
  if (!nome) throw new Error("nome obrigatório");
  const lista = await listarProdutosInternos();
  // dedup por nome normalizado — não cria repetido
  const existente = lista.find(p => normProdNome(p.nome) === normProdNome(nome));
  const agora = new Date().toISOString();
  if (existente) {
    if (input.categoria != null) existente.categoria = String(input.categoria).trim() || undefined;
    if (input.minimo != null) existente.minimo = Math.max(0, Number(input.minimo) || 0);
    existente.ativo = true;
    existente.atualizadoEm = agora;
    await salvar(lista);
    return existente;
  }
  const novo: ProdutoInterno = {
    id: randomUUID(),
    nome,
    categoria: input.categoria ? String(input.categoria).trim() : undefined,
    minimo: input.minimo != null ? Math.max(0, Number(input.minimo) || 0) : undefined,
    ativo: true,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  lista.push(novo);
  await salvar(lista);
  return novo;
}

export async function atualizarProdutoInterno(id: string, patch: Partial<ProdutoInterno>): Promise<ProdutoInterno | null> {
  const lista = await listarProdutosInternos();
  const p = lista.find(x => x.id === id);
  if (!p) return null;
  if (patch.nome != null) p.nome = String(patch.nome).trim() || p.nome;
  if (patch.categoria !== undefined) p.categoria = patch.categoria ? String(patch.categoria).trim() : undefined;
  if (patch.minimo !== undefined) p.minimo = patch.minimo != null ? Math.max(0, Number(patch.minimo) || 0) : undefined;
  if (patch.ativo !== undefined) p.ativo = !!patch.ativo;
  p.atualizadoEm = new Date().toISOString();
  await salvar(lista);
  return p;
}

export async function removerProdutoInterno(id: string): Promise<boolean> {
  const lista = await listarProdutosInternos();
  const nova = lista.filter(p => p.id !== id);
  if (nova.length === lista.length) return false;
  await salvar(nova);
  return true;
}

/**
 * Importa/atualiza uma lista do estoque do dono de uma vez. Cada item:
 * { nome, categoria?, minimo? }. Retorna quantos criados/atualizados. Não duplica
 * (casa por nome normalizado). NÃO mexe no saldo — a contagem/pente fino é à parte.
 */
export async function importarProdutosInternos(itens: Array<{ nome: string; categoria?: string; minimo?: number }>): Promise<{ criados: number; atualizados: number }> {
  const lista = await listarProdutosInternos();
  const porNome = new Map(lista.map(p => [normProdNome(p.nome), p]));
  const agora = new Date().toISOString();
  let criados = 0, atualizados = 0;
  for (const it of itens) {
    const nome = String(it?.nome || "").trim();
    if (!nome) continue;
    const chave = normProdNome(nome);
    const ex = porNome.get(chave);
    if (ex) {
      if (it.categoria != null && String(it.categoria).trim()) ex.categoria = String(it.categoria).trim();
      if (it.minimo != null && it.minimo !== undefined) ex.minimo = Math.max(0, Number(it.minimo) || 0);
      ex.ativo = true; ex.atualizadoEm = agora; atualizados++;
    } else {
      const novo: ProdutoInterno = {
        id: randomUUID(), nome,
        categoria: it.categoria ? String(it.categoria).trim() : undefined,
        minimo: it.minimo != null ? Math.max(0, Number(it.minimo) || 0) : undefined,
        ativo: true, criadoEm: agora, atualizadoEm: agora,
      };
      lista.push(novo); porNome.set(chave, novo); criados++;
    }
  }
  await salvar(lista);
  return { criados, atualizados };
}
