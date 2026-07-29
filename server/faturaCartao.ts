/**
 * FATURA DE CARTÃO — o cartão conta pela FATURA, não pela compra avulsa.
 *
 * Antes: a fatura era digitada à mão como dezenas de linhas soltas (17 no dia
 * 10/07: Fujioka, Facebook+Google Ads, Kapilare, encargos…) E o bot ainda
 * registrava a compra individual quando alguém mandava o comprovante no grupo —
 * o mesmo gasto entrava duas vezes.
 *
 * Agora:
 *   1. o PDF da fatura (Santander/Itaú) sobe na aba Compras;
 *   2. a IA devolve as linhas (data, estabelecimento, valor, categoria sugerida);
 *   3. o dono confere linha a linha, ajusta categoria, marca pessoal/estorno;
 *   4. ao confirmar, cada linha vira uma Compra que entra no caixa NA DATA DO
 *      PAGAMENTO da fatura (regime de caixa, igual à folha — ver caixaMes.ts).
 *
 * ── AS DUAS VALIDAÇÕES ───────────────────────────────────────────────────────
 * (a) SOMA × VALOR PAGO: se a soma das linhas não bate com o que foi pago, algo
 *     ficou de fora (página não lida, parcela, encargo). Avisa ANTES de confirmar.
 * (b) ANTI-DOBRA: casa as compras marcadas `aguardandoFatura` com as linhas da
 *     fatura (valor + estabelecimento + data). A linha casada NÃO cria compra
 *     nova — ela LIBERA a compra que já existe (com foto e itens), carimbando a
 *     data de pagamento. Assim o gasto entra no caixa uma vez só.
 *
 * A data de caixa vive em `Compra.dataPagamentoFatura`: enquanto ela existir, a
 * compra sai do bloco do mês dela e entra no bloco "Fatura de cartão" do mês em
 * que a fatura foi paga.
 */
import { kvGet, kvGetParaEscrita, kvSet } from "./db";
import { CATEGORIAS_COMPRA, type Compra } from "./compras";

/**
 * Prompt de leitura da fatura. Fica aqui (e não na rota) para o teste conferir a
 * MESMA instrução que roda em produção.
 */
export const promptFatura = (vencimento: string) => `Você lê FATURAS DE CARTÃO DE CRÉDITO de uma BARBEARIA (Santander e Itaú). Responda APENAS JSON (sem markdown):
{"cartao":"Santander|Itaú|<nome no documento>","final":"1234","vencimento":"YYYY-MM-DD","totalFatura":1234.56,"linhas":[{"data":"YYYY-MM-DD","estabelecimento":"nome do lançamento","valor":123.45,"parcela":"3/10","tipo":"compra|encargo|estorno|pagamento","categoria":"<uma de: ${CATEGORIAS_COMPRA.join(" | ")}>"}]}

Regras CRÍTICAS:
- Liste TODAS as linhas de lançamento de TODAS as páginas, na ordem em que aparecem. Não resuma, não agrupe, não invente.
- valor: número puro em reais, ponto decimal ("1.234,56" = 1234.56). POSITIVO para gasto.
- NEGATIVO só para estorno/crédito/devolução (tipo "estorno") e para o pagamento da fatura anterior (tipo "pagamento").
- "PAGAMENTO EFETUADO", "PGTO DEBITO AUTOMATICO", "SALDO ANTERIOR", "TOTAL DA FATURA ANTERIOR" → tipo "pagamento" (não é gasto novo).
- Juros, IOF, anuidade, multa, seguro, "encargos" → tipo "encargo", valor positivo, categoria "Impostos & Contador".
- parcela: preencha "3/10" quando a linha indicar parcelamento; o valor é o da PARCELA, não o total da compra.
- data: se a linha só trouxer dia/mês, complete com o ano coerente com o vencimento ${vencimento || "da fatura"} (compra de dezembro numa fatura de janeiro é do ano anterior).
- totalFatura: o "total desta fatura"/"valor total a pagar" impresso no documento.
- Categoria pela natureza do estabelecimento: cosmético/pomada/shampoo/tinta/navalha=Produtos & Insumos; cerveja/refri/água/doce=Bebidas & Bomboniere; limpeza/papel/descartável=Limpeza & Higiene; conserto/obra/material de construção=Manutenção & Reparos; máquina/cadeira/móvel/eletrônico=Equipamentos & Móveis; aluguel=Aluguel; luz/água/internet/telefone=Contas & Utilidades; imposto/taxa/contador/juros/IOF/anuidade=Impostos & Contador; software/app/assinatura (Google, Meta, Trinks, Adobe)=Software & Sistemas; anúncio/tráfego/Facebook Ads/Google Ads/gráfica=Marketing & Publicidade; restaurante/lanche/mercado de comida=Alimentação; resto=Outros.`;

export interface LinhaFatura {
  id: string;
  data: string;            // YYYY-MM-DD da COMPRA (não do pagamento)
  estabelecimento: string;
  valor: number;           // positivo = gasto; negativo = estorno/crédito na fatura
  categoria: string;
  natureza?: "fixo" | "variavel";
  classe?: "operacional" | "investimento" | "perda";
  parcela?: string;        // "3/10" quando a fatura informa
  /** Gasto pessoal do dono no cartão da empresa: não vira despesa da barbearia. */
  pessoal?: boolean;
  /** Linha que não é gasto (pagamento da fatura anterior, saldo, estorno) — não vira compra. */
  ignorar?: boolean;
  /** Anti-dobra: compra `aguardandoFatura` que já registra este mesmo gasto. */
  compraExistenteId?: string;
  compraExistenteMes?: string;
  /** Preenchido na confirmação: a compra criada (ou liberada) por esta linha. */
  compraGeradaId?: string;
  compraGeradaMes?: string;
}

export interface FaturaCartao {
  id: string;
  mesCaixa: string;        // YYYY-MM do PAGAMENTO (bucket da chave)
  cartao: string;          // "Santander" | "Itaú" | livre
  vencimento: string;      // YYYY-MM-DD
  dataPagamento: string;   // YYYY-MM-DD — é esta data que entra no caixa
  /** Total que o dono pagou (confere contra a soma das linhas). */
  valorPago: number;
  /** Total impresso na fatura, lido pela IA (pode diferir do pago). */
  totalFatura: number;
  linhas: LinhaFatura[];
  status: "rascunho" | "confirmada";
  arquivoNome?: string;
  observacao?: string;
  criadoEm: string;
  atualizadoEm: string;
  confirmadaEm?: string;
}

const kvKey = (mes: string) => `faturas_cartao:${mes}`;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const normLoja = (s: any) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function listarFaturas(mes: string): Promise<FaturaCartao[]> {
  const d = await kvGet<FaturaCartao[]>(kvKey(mes));
  const arr = Array.isArray(d) ? d : [];
  return arr.slice().sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
}

/**
 * Leitura para read-modify-write: ESTOURA se o banco falhar, em vez de devolver
 * lista vazia — foi assim que 52 compras de julho viraram 1 (ver compras.ts).
 */
async function listarFaturasParaEscrita(mes: string): Promise<FaturaCartao[]> {
  const d = await kvGetParaEscrita<FaturaCartao[]>(kvKey(mes));
  if (d !== null && !Array.isArray(d)) throw new Error(`faturas_cartao:${mes} corrompida (esperava array)`);
  return Array.isArray(d) ? d.slice() : [];
}

export async function getFatura(mes: string, id: string): Promise<FaturaCartao | null> {
  const lista = await listarFaturas(mes);
  return lista.find(f => f.id === id) || null;
}

export async function salvarFatura(
  input: Omit<FaturaCartao, "id" | "criadoEm" | "atualizadoEm"> & { id?: string },
): Promise<FaturaCartao> {
  const lista = await listarFaturasParaEscrita(input.mesCaixa);
  const agora = new Date().toISOString();
  const nova: FaturaCartao = {
    ...input,
    id: input.id || `fatura_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  lista.push(nova);
  await kvSet(kvKey(input.mesCaixa), lista);
  return nova;
}

export async function atualizarFatura(
  mes: string, id: string, patch: Partial<FaturaCartao>,
): Promise<FaturaCartao | null> {
  const lista = await listarFaturasParaEscrita(mes);
  const i = lista.findIndex(f => f.id === id);
  if (i < 0) return null;
  lista[i] = { ...lista[i], ...patch, id, mesCaixa: mes, atualizadoEm: new Date().toISOString() };
  await kvSet(kvKey(mes), lista);
  return lista[i];
}

export async function removerFatura(mes: string, id: string): Promise<boolean> {
  const lista = await listarFaturasParaEscrita(mes);
  const nova = lista.filter(f => f.id !== id);
  if (nova.length === lista.length) return false;
  await kvSet(kvKey(mes), nova);
  return true;
}

export interface ConferenciaFatura {
  somaLinhas: number;        // o que compõe a fatura (estorno negativo entra; ignorada não)
  somaLancavel: number;      // o que vira despesa da barbearia
  totalPessoal: number;
  totalIgnorado: number;
  totalJaRegistrado: number; // linhas casadas com compra que já existe
  valorPago: number;
  diferenca: number;         // somaLinhas − valorPago
  fecha: boolean;            // |diferença| ≤ 0,50
  qtdLinhas: number;
  qtdJaRegistradas: number;
  qtdSemCategoria: number;   // caíram em "Outros" — o dono precisa olhar
  avisos: string[];
}

/** Tolerância da conferência: centavos de arredondamento não são divergência. */
const TOLERANCIA = 0.5;

export function conferirFatura(f: FaturaCartao): ConferenciaFatura {
  const linhas = f.linhas || [];
  let somaLinhas = 0, somaLancavel = 0, totalPessoal = 0, totalIgnorado = 0, totalJaRegistrado = 0;
  let qtdJaRegistradas = 0, qtdSemCategoria = 0;
  for (const l of linhas) {
    const v = num(l.valor);
    // Linha ignorada é o que NÃO compõe esta fatura (pagamento da anterior, saldo
    // do mês passado). Fica de fora da soma — senão a conferência nunca fecha.
    if (l.ignorar) { totalIgnorado += v; continue; }
    somaLinhas += v;
    if (l.pessoal) { totalPessoal += v; continue; }
    if (l.compraExistenteId) { totalJaRegistrado += v; qtdJaRegistradas++; }
    if (!l.categoria || l.categoria === "Outros") qtdSemCategoria++;
    somaLancavel += v;
  }
  const valorPago = num(f.valorPago);
  const diferenca = r2(somaLinhas - valorPago);
  const fecha = valorPago > 0 ? Math.abs(diferenca) <= TOLERANCIA : false;

  const avisos: string[] = [];
  if (!linhas.length) avisos.push("nenhuma linha lida — confira o PDF");
  if (valorPago <= 0) avisos.push("informe o valor pago da fatura para conferir a soma");
  else if (!fecha) {
    avisos.push(
      diferenca > 0
        ? `a soma das linhas está R$ ${r2(diferenca).toFixed(2)} ACIMA do valor pago — pode ter linha repetida`
        : `faltam R$ ${r2(-diferenca).toFixed(2)} para fechar com o valor pago — pode ter página ou encargo sem ler`,
    );
  }
  if (qtdSemCategoria > 0) avisos.push(`${qtdSemCategoria} linha(s) em "Outros" — categorize para o custo do mês sair certo`);

  return {
    somaLinhas: r2(somaLinhas), somaLancavel: r2(somaLancavel), totalPessoal: r2(totalPessoal),
    totalIgnorado: r2(totalIgnorado), totalJaRegistrado: r2(totalJaRegistrado),
    valorPago: r2(valorPago), diferenca, fecha,
    qtdLinhas: linhas.length, qtdJaRegistradas, qtdSemCategoria, avisos,
  };
}

// ─── ANTI-DOBRA ───────────────────────────────────────────────────────────────

const diffDias = (a: string, b: string) => {
  const ta = Date.parse(`${a}T12:00:00Z`), tb = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 999;
  return Math.abs(ta - tb) / 86400000;
};

/** Nomes "parecidos": um contém o outro, ou compartilham uma palavra de 4+ letras. */
export function lojaParecida(a: string, b: string): boolean {
  const na = normLoja(a), nb = normLoja(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter(t => t.length >= 4));
  return nb.split(" ").some(t => t.length >= 4 && ta.has(t));
}

/**
 * Casa as linhas da fatura com as compras que estão esperando ela.
 * Só entram compras com `aguardandoFatura` ainda em aberto (sem fatura ligada).
 * Regra: valor tem que bater (± 2 centavos) E o nome tem que parecer OU a data
 * cair a até 3 dias — cartão lança com data de processamento, não a da compra.
 */
export function casarLinhasComCompras(
  linhas: LinhaFatura[],
  compras: (Compra & { aguardandoFatura?: boolean; dataPagamentoFatura?: string })[],
): LinhaFatura[] {
  const candidatas = compras.filter(c => (c as any).aguardandoFatura === true && !(c as any).dataPagamentoFatura);
  const usadas = new Set<string>();
  return linhas.map(l => {
    if (l.compraExistenteId || num(l.valor) <= 0) return l;
    const alvo = num(l.valor);
    const match = candidatas.find(c => {
      if (usadas.has(c.id)) return false;
      if (Math.abs(num(c.valor) - alvo) > 0.02) return false;
      return lojaParecida(c.loja, l.estabelecimento) || diffDias(String(c.data), l.data) <= 3;
    });
    if (!match) return l;
    usadas.add(match.id);
    return { ...l, compraExistenteId: match.id, compraExistenteMes: match.mes };
  });
}

/**
 * ESTORNO abate o gasto; não vira lançamento negativo (compra é sempre positiva).
 * Cada crédito da fatura é descontado da linha do MESMO estabelecimento — senão o
 * caixa registraria o bruto e ficaria acima do que o dono pagou de verdade.
 * Devolve quanto abater de cada linha e os estornos que não acharam par (esses
 * são reportados na tela: some do lançamento, nunca do conhecimento do dono).
 */
export function calcularAbatimentos(linhas: LinhaFatura[]): { abatimento: Record<string, number>; semPar: { estabelecimento: string; valor: number }[] } {
  const abatimento: Record<string, number> = {};
  const semPar: { estabelecimento: string; valor: number }[] = [];
  for (const neg of linhas) {
    if (neg.ignorar || neg.pessoal || num(neg.valor) >= 0) continue;
    const credito = Math.abs(num(neg.valor));
    const par = linhas.find(p =>
      !p.ignorar && !p.pessoal && num(p.valor) > 0 &&
      num(p.valor) - (abatimento[p.id] || 0) >= credito &&
      lojaParecida(p.estabelecimento, neg.estabelecimento),
    );
    if (!par) { semPar.push({ estabelecimento: neg.estabelecimento, valor: credito }); continue; }
    abatimento[par.id] = r2((abatimento[par.id] || 0) + credito);
  }
  return { abatimento, semPar };
}

/** Meses que uma fatura pode alcançar: o do pagamento e os 2 anteriores. */
export function mesesDeBusca(mesCaixa: string): string[] {
  const [a, m] = mesCaixa.split("-").map(Number);
  const out: string[] = [];
  for (let k = 0; k < 3; k++) {
    const d = new Date(Date.UTC(a, m - 1 - k, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
