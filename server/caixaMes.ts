/**
 * SAIU DO CAIXA NO MÊS — fonte única do gasto real.
 *
 * O gasto da barbearia estava partido em três gavetas que ninguém somava, e o
 * dono só enxergava a primeira:
 *
 *   1. compras:YYYY-MM ............ fornecedor, boleto, insumo (aba Compras)
 *   2. folha_pagamentos:YYYY-MM ... comissão do mês fechado, PAGA no mês seguinte
 *   3. pagamentos[YYYY-MM].vale ... vale do dia 15
 *
 * Em julho/2026 isso significava ver R$ 34.747 quando tinham saído R$ 63.934 —
 * 54% do real. A conta de "quanto sobrou" errava por R$ 29 mil.
 *
 * ── REGIME DE CAIXA, NÃO COMPETÊNCIA ──────────────────────────────────────────
 * A folha é gravada sob o mês de REFERÊNCIA (comissão de junho vive em
 * `folha_pagamentos:2026-06`) mas o dinheiro sai no mês seguinte, na data do
 * comprovante. Somar por competência faz todo mês parecer barato, porque a maior
 * despesa da casa sempre cai no balde do mês anterior. Aqui varremos TODAS as
 * chaves de folha e filtramos por `item.data` — a data em que o PIX saiu.
 *
 * ── AS DUAS TRAVAS ANTI-DOBRA ────────────────────────────────────────────────
 * (a) Compra com categoria "Salários & Equipe" é pagamento a pessoal e já está
 *     na folha/vale. Contar de novo dobra. (Caso real: os R$ 100 do vale do
 *     Guilherme em 20/07 estavam nas duas gavetas.)
 * (b) `comprasCartao` NÃO é saída de caixa: é gasto que já saiu pelo cartão
 *     (portanto já está em Compras) e que será DESCONTADO da folha da pessoa.
 *     Somar aqui seria contar duas vezes e ainda com o sinal trocado.
 */

import { kvGet, kvKeysComPrefixo } from "./db";
import { listarCompras, type Compra } from "./compras";
import { type PagamentoFolhaItem, type PagamentoMes } from "./pagamentos";

/** Categoria de compra que representa pagamento a pessoal (vive na folha). */
export const CATEGORIA_PESSOAL = "Salários & Equipe";

export interface ItemCaixa {
  data: string;      // YYYY-MM-DD em que o dinheiro saiu
  valor: number;
  descricao: string;
  categoria?: string;
}

export interface BlocoCaixa {
  chave: "compras" | "folha" | "vales";
  titulo: string;
  total: number;
  count: number;
  itens: ItemCaixa[];
}

export interface SaidasCaixaMes {
  mes: string;                    // YYYY-MM
  total: number;                  // o número que importa: saiu do caixa
  blocos: BlocoCaixa[];
  /** Lançamentos ignorados por já estarem contados em outra gaveta. */
  excluidos: { motivo: string; valor: number; descricao: string }[];
  /** Quanto foi ignorado no total (para conferência: total + excluido = soma bruta). */
  totalExcluido: number;
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Soma tudo que saiu do caixa no mês, por REGIME DE CAIXA.
 * `mes` no formato YYYY-MM.
 */
export async function calcularSaidasCaixa(mes: string): Promise<SaidasCaixaMes> {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error(`mês inválido: ${mes} (esperado YYYY-MM)`);

  const excluidos: SaidasCaixaMes["excluidos"] = [];

  // ── 1) COMPRAS ──────────────────────────────────────────────────────────────
  // Tudo que saiu: operacional, investimento e perda. "Investimento" não entra
  // no lucro do mês, mas SAIU do caixa — quem paga a obra sente no extrato.
  const compras: Compra[] = await listarCompras(mes).catch(() => []);
  const itensCompras: ItemCaixa[] = [];
  for (const c of compras) {
    const valor = num(c.valor);
    if (valor <= 0) continue;
    if (String(c.categoria) === CATEGORIA_PESSOAL) {
      // Trava (a): já está na folha ou no vale.
      excluidos.push({
        motivo: "pagamento a pessoal — já contado na folha/vale",
        valor,
        descricao: `${c.data} ${c.loja || c.descricao || ""}`.trim(),
      });
      continue;
    }
    itensCompras.push({
      data: String(c.data || ""),
      valor,
      descricao: String(c.loja || c.descricao || "—"),
      categoria: String(c.categoria || "Outros"),
    });
  }

  // ── 2) FOLHA (regime de caixa) ──────────────────────────────────────────────
  // Varre TODA chave folha_pagamentos:* e pega o que foi PAGO dentro do mês,
  // independente de qual mês a comissão referencia.
  const itensFolha: ItemCaixa[] = [];
  const chavesFolha = await kvKeysComPrefixo("folha_pagamentos:");
  for (const chave of chavesFolha) {
    const mesRef = chave.split(":")[1] || "?";
    const lista = (await kvGet<PagamentoFolhaItem[]>(chave)) || [];
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      const valor = num(item?.valor);
      const data = String(item?.data || "");
      if (valor <= 0 || !data.startsWith(mes)) continue;
      itensFolha.push({
        data,
        valor,
        descricao: `${item.nome || "—"} — comissão ${mesRef}`,
        categoria: CATEGORIA_PESSOAL,
      });
    }
  }

  // ── 3) VALES ────────────────────────────────────────────────────────────────
  // O vale do dia 15 é adiantamento do mês corrente: o mês da chave já é o mês
  // de caixa. `comprasCartao`, `multa` e `ajuste` NÃO entram — ver trava (b) e,
  // no caso de multa/ajuste, porque são correções contábeis do saldo a pagar,
  // não dinheiro saindo.
  const todosPagamentos = (await kvGet<Record<string, Record<string, PagamentoMes>>>("pagamentos")) || {};
  const doMes = todosPagamentos?.[mes] || {};
  const itensVales: ItemCaixa[] = [];
  for (const p of Object.values(doMes)) {
    const vale = num(p?.vale);
    const cartao = num(p?.comprasCartao);
    if (cartao > 0) {
      excluidos.push({
        motivo: "compra no cartão — já contada em Compras e descontada da folha",
        valor: cartao,
        descricao: String(p?.comprasCartaoNota || `prof ${p?.profissionalId}`),
      });
    }
    if (vale <= 0) continue;
    itensVales.push({
      data: `${mes}-15`, // vale é do dia 15; a data exata vive na nota
      valor: vale,
      descricao: String(p?.valeNota || `vale — prof ${p?.profissionalId}`),
      categoria: CATEGORIA_PESSOAL,
    });
  }

  const bloco = (chave: BlocoCaixa["chave"], titulo: string, itens: ItemCaixa[]): BlocoCaixa => ({
    chave,
    titulo,
    total: itens.reduce((s, i) => s + i.valor, 0),
    count: itens.length,
    itens: itens.slice().sort((a, b) => String(a.data).localeCompare(String(b.data))),
  });

  const blocos = [
    bloco("compras", "Compras e contas", itensCompras),
    bloco("folha", "Folha paga no mês", itensFolha),
    bloco("vales", "Vales do dia 15", itensVales),
  ];

  return {
    mes,
    total: blocos.reduce((s, b) => s + b.total, 0),
    blocos,
    excluidos,
    totalExcluido: excluidos.reduce((s, e) => s + e.valor, 0),
  };
}
