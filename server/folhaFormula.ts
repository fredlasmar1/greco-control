/**
 * FÓRMULA CANÔNICA DA COMISSÃO — fonte única da tela Pagamento, da aba Equipe e
 * do recibo. Definida pelo dono (01/08/2026):
 *
 *   SERVIÇOS + PLANOS + PRODUTOS − VALES − PRODUTOS CONSUMIDOS − DESCONTOS
 *   = COMISSÃO DO MÊS
 *   (+) salário fixo (+) bônus = TOTAL A PAGAR
 *
 * Antes disso cada saída montava a própria conta: em jul/2026 os 13 recibos
 * divergiam da tela em R$ 4.698,84 (o recibo não somava Clube nem banco de horas
 * e não abatia os descontos do Metas). Qualquer novo consumidor DEVE usar
 * `montarFormula` — nunca somar componentes na mão.
 *
 * As três origens de desconto e a trava anti-dobra estão em `montarDescontos`.
 */

export type OrigemDesconto = "folha" | "compras" | "metas";
export type GrupoDesconto = "vale" | "consumo" | "desconto";

export interface ItemDesconto {
  grupo: GrupoDesconto;
  origem: OrigemDesconto;
  valor: number;
  descricao: string;
  data?: string;
  /** id da compra / id do lançamento no Metas — rastro pra conferir o comprovante */
  ref?: string;
}

export interface EntradaFormula {
  /** Comissões já calculadas (serviços = ranking/Metas × %, ou valor do ranking). */
  comissaoServicos: number;
  comissaoProdutos: number;
  /** Plano avulso + Clube Greco viram UMA linha só ("planos"), decisão do dono. */
  comissaoPlano: number;
  comissaoClubeGreco: number;

  /** Estado mensal (kv `pagamentos`) — vale do dia 15, consumo, multa, cartão. */
  vale: number;
  valeNota?: string;
  consumoInterno: number;
  consumoInternoNota?: string;
  multa: number;
  multaNota?: string;
  comprasCartao: number;
  comprasCartaoNota?: string;
  ajuste: number;
  ajusteNota?: string;

  /** Lançamentos do Greco Metas (API), já separados por tipo. */
  metasPorTipo?: Record<string, number>;
  metasItens?: Array<{ id?: number | string; tipo?: string; valor?: number; motivo?: string; createdAt?: string }>;

  /** Vales encontrados na aba Compras do mês pra esta pessoa (comprovante do PIX). */
  valesEmCompras?: Array<{ id: string; valor: number; data: string; descricao?: string }>;

  /** Somam DEPOIS da comissão. */
  salarioFixo: number;
  bonusExcedente: number;
  bonusRanking: number;
  bonusMetaCategoria: number;
}

export interface ResultadoFormula {
  comissao: {
    servicos: number;
    planos: number;
    produtos: number;
    subtotal: number;
  };
  descontos: {
    vales: number;
    produtosConsumidos: number;
    outros: number;
    subtotal: number;
    itens: ItemDesconto[];
    /** Vale que está na aba Compras e NÃO estava na folha (entrou por aqui). */
    valeSomenteEmCompras: number;
    /** Vale lançado na folha sem comprovante correspondente na aba Compras. */
    valeSemComprovante: number;
  };
  comissaoDoMes: number;
  adicionais: {
    salarioFixo: number;
    bonus: number;
    bonusExcedente: number;
    bonusRanking: number;
    bonusMetaCategoria: number;
    subtotal: number;
  };
  totalAPagar: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Tipos do Metas que são consumo de produto (a linha "produtos consumidos"). */
const TIPOS_CONSUMO = new Set(["consumo", "produto", "produtos"]);
/** Tipos do Metas que são adiantamento (entram em VALES, com trava anti-dobra). */
const TIPOS_VALE = new Set(["vale", "adiantamento"]);

/**
 * Monta as três linhas de desconto a partir das três origens, sem dobrar.
 *
 * A trava: o bot do Telegram grava o MESMO vale em dois lugares — cria a compra
 * em "Salários & Equipe" E soma no campo `vale` da folha (routes.ts, callback
 * `qv|`). Somar os dois pagaria o desconto duas vezes. Por isso VALE usa
 * `max(folha, compras)` em vez de soma: fica com o maior sinal, e ainda cobre o
 * caso inverso — o PIX virou compra mas o callback falhou, então a folha está
 * zerada e o valor entra pela compra. Em jul/2026: R$ 8.350 na folha × R$ 350 na
 * aba Compras (8 vales foram lançados à mão, sem comprovante).
 */
export function montarDescontos(e: EntradaFormula): ResultadoFormula["descontos"] {
  const itens: ItemDesconto[] = [];
  const porTipo = e.metasPorTipo || {};

  // ── VALES ──────────────────────────────────────────────────────────────
  const valeFolha = r2(e.vale);
  const compras = e.valesEmCompras || [];
  const valeCompras = r2(compras.reduce((s, c) => s + (Number(c.valor) || 0), 0));
  let valeMetas = 0;
  for (const [tipo, v] of Object.entries(porTipo)) {
    if (TIPOS_VALE.has(String(tipo).toLowerCase())) valeMetas += Number(v) || 0;
  }
  valeMetas = r2(valeMetas);

  const valeBase = Math.max(valeFolha, valeCompras);
  const vales = r2(valeBase + valeMetas);

  // O detalhe mostra SEMPRE os comprovantes da aba Compras (é o que o dono
  // confere), e o resto do valor da folha como uma linha "sem comprovante".
  for (const c of compras) {
    itens.push({
      grupo: "vale", origem: "compras", valor: r2(c.valor), ref: c.id, data: c.data,
      descricao: c.descricao || `Vale (PIX ${c.data.split("-").reverse().join("/")})`,
    });
  }
  const valeSemComprovante = r2(Math.max(0, valeFolha - valeCompras));
  if (valeSemComprovante > 0) {
    itens.push({
      grupo: "vale", origem: "folha", valor: valeSemComprovante,
      descricao: e.valeNota ? `Vale sem comprovante na aba Compras — ${e.valeNota}` : "Vale sem comprovante na aba Compras",
    });
  }
  if (valeMetas > 0) {
    itens.push({ grupo: "vale", origem: "metas", valor: valeMetas, descricao: "Vale lançado no Greco Metas" });
  }

  // ── PRODUTOS CONSUMIDOS ────────────────────────────────────────────────
  let consumoMetas = 0;
  for (const [tipo, v] of Object.entries(porTipo)) {
    if (TIPOS_CONSUMO.has(String(tipo).toLowerCase())) consumoMetas += Number(v) || 0;
  }
  consumoMetas = r2(consumoMetas);
  const consumoManual = r2(e.consumoInterno);
  const produtosConsumidos = r2(consumoManual + consumoMetas);

  for (const it of e.metasItens || []) {
    if (!TIPOS_CONSUMO.has(String(it.tipo || "").toLowerCase())) continue;
    itens.push({
      grupo: "consumo", origem: "metas", valor: r2(it.valor || 0), ref: it.id != null ? String(it.id) : undefined,
      data: String(it.createdAt || "").slice(0, 10) || undefined,
      descricao: it.motivo ? String(it.motivo) : "Consumo lançado no Metas",
    });
  }
  if (consumoManual > 0) {
    itens.push({
      grupo: "consumo", origem: "folha", valor: consumoManual,
      descricao: e.consumoInternoNota ? `Consumo interno — ${e.consumoInternoNota}` : "Consumo interno",
    });
  }

  // ── DESCONTOS (o resto) ────────────────────────────────────────────────
  // Multa, compras/cursos no cartão da barbearia, vouchers e qualquer outro tipo
  // que o Metas venha a mandar. O ajuste manual entra aqui com o sinal trocado
  // (ajuste positivo = menos desconto), pra conta nunca ter linha invisível.
  const multa = r2(e.multa);
  const comprasCartao = r2(e.comprasCartao);
  let outrosMetas = 0;
  for (const [tipo, v] of Object.entries(porTipo)) {
    const t = String(tipo).toLowerCase();
    if (TIPOS_CONSUMO.has(t) || TIPOS_VALE.has(t)) continue;
    outrosMetas += Number(v) || 0;
  }
  outrosMetas = r2(outrosMetas);
  const ajuste = r2(e.ajuste);
  const outros = r2(multa + comprasCartao + outrosMetas - ajuste);

  if (multa > 0) itens.push({ grupo: "desconto", origem: "folha", valor: multa, descricao: e.multaNota ? `Multa — ${e.multaNota}` : "Multa" });
  if (comprasCartao > 0) itens.push({ grupo: "desconto", origem: "folha", valor: comprasCartao, descricao: e.comprasCartaoNota ? `Compras/cursos no cartão — ${e.comprasCartaoNota}` : "Compras/cursos no cartão da barbearia" });
  for (const it of e.metasItens || []) {
    const t = String(it.tipo || "").toLowerCase();
    if (TIPOS_CONSUMO.has(t) || TIPOS_VALE.has(t)) continue;
    itens.push({
      grupo: "desconto", origem: "metas", valor: r2(it.valor || 0), ref: it.id != null ? String(it.id) : undefined,
      data: String(it.createdAt || "").slice(0, 10) || undefined,
      descricao: `${it.tipo || "Desconto"}${it.motivo ? ` — ${it.motivo}` : ""}`,
    });
  }
  if (ajuste !== 0) {
    itens.push({
      grupo: "desconto", origem: "folha", valor: r2(-ajuste),
      descricao: e.ajusteNota ? `Ajuste manual — ${e.ajusteNota}` : "Ajuste manual",
    });
  }

  return {
    vales,
    produtosConsumidos,
    outros,
    subtotal: r2(vales + produtosConsumidos + outros),
    itens,
    valeSomenteEmCompras: r2(Math.max(0, valeCompras - valeFolha)),
    valeSemComprovante,
  };
}

/** A conta inteira, na ordem em que o dono lê. */
export function montarFormula(e: EntradaFormula): ResultadoFormula {
  const servicos = r2(e.comissaoServicos);
  // Plano avulso + Clube Greco = uma linha só.
  const planos = r2(e.comissaoPlano + e.comissaoClubeGreco);
  const produtos = r2(e.comissaoProdutos);
  const subtotalComissao = r2(servicos + planos + produtos);

  const descontos = montarDescontos(e);
  const comissaoDoMes = r2(subtotalComissao - descontos.subtotal);

  const bonus = r2(e.bonusExcedente + e.bonusRanking + e.bonusMetaCategoria);
  const salarioFixo = r2(e.salarioFixo);
  const adicionais = {
    salarioFixo,
    bonus,
    bonusExcedente: r2(e.bonusExcedente),
    bonusRanking: r2(e.bonusRanking),
    bonusMetaCategoria: r2(e.bonusMetaCategoria),
    subtotal: r2(salarioFixo + bonus),
  };

  return {
    comissao: { servicos, planos, produtos, subtotal: subtotalComissao },
    descontos,
    comissaoDoMes,
    adicionais,
    totalAPagar: r2(comissaoDoMes + adicionais.subtotal),
  };
}
