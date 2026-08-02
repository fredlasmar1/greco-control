/**
 * Compras da barbearia — comprovantes de PIX e notas enviados no grupo do
 * Telegram, lidos por IA (Claude vision) e registrados por mês. Persistido em
 * kv_store (Postgres Railway) → sobrevive a deploys. Não gasta token da Trinks.
 *
 * Fluxo: foto no grupo → webhook → Claude extrai {valor,data,loja,categoria} →
 * salvarCompra → bot confirma no grupo → aparece na aba "Compras do Mês".
 */
import { kvGet, kvGetParaEscrita, kvSet } from "./db";

// Categorias de compra — os principais gastos de uma barbearia. A IA escolhe uma.
export const CATEGORIAS_COMPRA = [
  "Salários & Equipe",       // PIX/pagamento a barbeiros, assistentes, secretárias
  "Produtos & Insumos",      // cosméticos, pomada, shampoo, tinta, navalha, lâmina
  "Bebidas & Bomboniere",    // cerveja, refri, energético, água, doces (revenda)
  "Limpeza & Higiene",       // produtos de limpeza, papel, descartáveis
  "Manutenção & Reparos",    // conserto, obra, elétrica, hidráulica, pintura
  "Equipamentos & Móveis",   // máquina, cadeira, secador, espelho, móveis
  "Aluguel",                 // aluguel do ponto
  "Contas & Utilidades",     // água, luz, energia, internet, telefone
  "Impostos & Contador",     // impostos, taxas, DAS/Simples, honorário contábil
  "Software & Sistemas",     // Trinks, sistemas, apps, assinaturas de software
  "Marketing & Publicidade", // anúncio, tráfego, gráfica, panfleto, brinde
  "Alimentação",             // comida/lanche da equipe
  // Dinheiro que trocou de banco dentro da própria empresa (PIX em que o CNPJ do
  // recebedor é o mesmo do pagador). NÃO é gasto e NÃO é folha — fica fora do
  // caixa e do lucro. Antes disso, o PIX de R$ 4.000 Santander→Nubank de 30/07/2026
  // virou "salário do André" e ainda contou como saída de caixa.
  "Transferência entre contas",
  "Outros",
] as const;

/** Categoria que representa dinheiro movido entre contas da própria empresa. */
export const CATEGORIA_TRANSFERENCIA = "Transferência entre contas";

/**
 * CONTAS DA EMPRESA QUE SÃO, NA VERDADE, PAGAMENTO A UMA PESSOA.
 *
 * O André recebe partido em duas contas por um arranjo pessoal: R$ 8.000 fixos no
 * CPF dele (C6) e o restante numa conta Nubank que está NO NOME DA GRECO — chave
 * (62) 99938-84448. No comprovante esse PIX sai como recebedor "GRECO BARBEARIA"
 * com o MESMO CNPJ do pagador, ou seja, tem exatamente a cara de transferência
 * entre contas próprias. Não é: é salário. Sem esta exceção, a trava de CNPJ igual
 * jogaria o pagamento dele fora da folha (e o André já sumiu da conta uma vez).
 */
export interface ContaPropriaDePessoa {
  chavePix: string;        // só dígitos
  profissionalId: string;
  nome: string;
  motivo: string;
}
export const CONTAS_PROPRIAS_DE_PESSOA: ContaPropriaDePessoa[] = [
  {
    // Como o dono passou: (62) 9993884448. O comprovante vem mascarado
    // ("(62) * ****-*448"), então o casamento é por DDD + últimos dígitos visíveis
    // (casaChavePixMascarada) — não depende de o cadastro estar formatado igual.
    chavePix: "629993884448",
    profissionalId: "825249",
    nome: "CARLOS ANDRÉ",
    motivo: "Conta Nubank no nome da Greco usada para a 2ª parte do pagamento do André (sócio).",
  },
];

/**
 * Casa a chave do comprovante (quase sempre MASCARADA, ex.: "(62) * ****-*448")
 * com uma chave cadastrada. Compara os dígitos VISÍVEIS: prefixo antes da máscara
 * e sufixo depois dela. Exige pelo menos 3 dígitos de sufixo para não casar por
 * acidente.
 */
export function casaChavePixMascarada(doComprovante: string, cadastrada: string): boolean {
  const alvo = String(cadastrada || "").replace(/\D/g, "");
  const bruta = String(doComprovante || "");
  if (!alvo || !bruta) return false;
  const soDigitosEMascara = bruta.replace(/[^\d*]/g, "");
  if (!soDigitosEMascara.includes("*")) {
    const d = soDigitosEMascara.replace(/\D/g, "");
    return !!d && (d === alvo || alvo.endsWith(d) || d.endsWith(alvo));
  }
  const partes = soDigitosEMascara.split(/\*+/).filter(Boolean);
  if (!partes.length) return false;
  const prefixo = partes[0];
  const sufixo = partes[partes.length - 1];
  if (sufixo.length < 3) return false;
  const prefixoOk = partes.length === 1 || alvo.startsWith(prefixo);
  return prefixoOk && alvo.endsWith(sufixo);
}

/** Se o PIX for para uma conta da empresa que na verdade paga uma pessoa, quem é. */
export function pessoaPorChaveDeContaPropria(chaveDoComprovante: string): ContaPropriaDePessoa | null {
  for (const c of CONTAS_PROPRIAS_DE_PESSOA) {
    if (casaChavePixMascarada(chaveDoComprovante, c.chavePix)) return c;
  }
  return null;
}

/**
 * Natureza padrão de cada categoria: custo FIXO (todo mês, previsível — aluguel,
 * salário, luz, imposto, software) ou VARIÁVEL (varia com o movimento — produtos,
 * bebidas, limpeza, marketing). É só o palpite inicial; cada compra pode ser
 * ajustada individualmente pelo dono na tela.
 */
export const NATUREZA_PADRAO: Record<string, "fixo" | "variavel"> = {
  "Salários & Equipe": "fixo",
  "Aluguel": "fixo",
  "Contas & Utilidades": "fixo",
  "Impostos & Contador": "fixo",
  "Software & Sistemas": "fixo",
  "Produtos & Insumos": "variavel",
  "Bebidas & Bomboniere": "variavel",
  "Limpeza & Higiene": "variavel",
  "Manutenção & Reparos": "variavel",
  "Equipamentos & Móveis": "variavel",
  "Marketing & Publicidade": "variavel",
  "Alimentação": "variavel",
  "Transferência entre contas": "variavel", // não entra no custo — ver CATEGORIA_TRANSFERENCIA
  "Outros": "variavel",
};

/** Natureza de uma compra: usa o que foi definido na compra, senão o padrão da categoria. */
export function naturezaDaCompra(c: { natureza?: string; categoria?: string }): "fixo" | "variavel" {
  if (c.natureza === "fixo" || c.natureza === "variavel") return c.natureza;
  return NATUREZA_PADRAO[c.categoria || "Outros"] || "variavel";
}

export interface Compra {
  id: string;
  mes: string;          // YYYY-MM (bucket)
  data: string;         // YYYY-MM-DD (data do comprovante)
  valor: number;        // positivo, em reais
  loja: string;         // beneficiário / estabelecimento
  categoria: string;
  natureza?: "fixo" | "variavel"; // custo fixo x variável (default: pela categoria)
  // Classe da despesa no resultado do mês (default "operacional"):
  //  - operacional: entra no lucro do mês (a maioria);
  //  - investimento: obra/reforma do ponto — NÃO entra no lucro do mês (é ativo);
  //  - perda: golpe/fraude/prejuízo — sai do caixa mas não é custo operacional.
  // investimento e perda são EXCLUÍDOS do lucro operacional (Viabilidade).
  classe?: "operacional" | "investimento" | "perda";
  descricao?: string;
  tipo: "pix" | "compra" | "boleto" | "outro";
  origem: "telegram" | "manual" | "fatura";
  // ── CARTÃO DE CRÉDITO: o gasto conta pela FATURA, não pela compra avulsa ──
  /** Comprada no crédito e ainda sem fatura importada: fica FORA do caixa. */
  aguardandoFatura?: boolean;
  /** Data em que a fatura foi paga — é ela que manda no regime de caixa. */
  dataPagamentoFatura?: string; // YYYY-MM-DD
  /** Fatura que liberou (ou criou) esta compra. */
  faturaId?: string;
  /** Cartão do gasto ("Santander", "Itaú"). */
  cartao?: string;
  /** PIX em que o CNPJ/CPF do recebedor é o mesmo do pagador (conta própria). */
  transferenciaPropria?: boolean;
  docRecebedor?: string;
  docPagador?: string;
  /** Chave PIX do recebedor como veio no comprovante (pode estar mascarada). */
  chaveRecebedor?: string;
  telegramFileId?: string;
  telegramFrom?: string; // quem mandou no grupo
  confianca?: "alta" | "media" | "baixa";
  temFoto?: boolean;     // imagem da nota guardada em kv compras_foto:${id}
  fotoMime?: string;
  criadoEm: string;
  atualizadoEm: string;
}

const kvKey = (mes: string) => `compras:${mes}`;

export async function listarCompras(mes: string): Promise<Compra[]> {
  const d = await kvGet<Compra[]>(kvKey(mes));
  const arr = Array.isArray(d) ? d : [];
  return arr.slice().sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
}

// Leitura para read-modify-write: estoura se o banco falhar, em vez de devolver
// lista vazia. Sem isso, um blip de conexão faz a regravação apagar o mês inteiro.
async function listarComprasParaEscrita(mes: string): Promise<Compra[]> {
  const d = await kvGetParaEscrita<Compra[]>(kvKey(mes));
  if (d !== null && !Array.isArray(d)) throw new Error(`compras:${mes} corrompida (esperava array)`);
  return Array.isArray(d) ? d.slice() : [];
}

export async function salvarCompra(
  input: Omit<Compra, "id" | "criadoEm" | "atualizadoEm"> & { id?: string },
): Promise<Compra> {
  const lista = await listarComprasParaEscrita(input.mes);
  const agora = new Date().toISOString();
  const nova: Compra = {
    ...input,
    id: input.id || `compra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    criadoEm: agora,
    atualizadoEm: agora,
  } as Compra;
  lista.push(nova);
  await kvSet(kvKey(input.mes), lista);
  return nova;
}

export async function atualizarCompra(mes: string, id: string, patch: Partial<Compra>): Promise<Compra | null> {
  const lista = await listarComprasParaEscrita(mes);
  const i = lista.findIndex(c => c.id === id);
  if (i < 0) return null;
  lista[i] = { ...lista[i], ...patch, id, mes, atualizadoEm: new Date().toISOString() };
  await kvSet(kvKey(mes), lista);
  return lista[i];
}

export async function removerCompra(mes: string, id: string): Promise<boolean> {
  const lista = await listarComprasParaEscrita(mes);
  const nova = lista.filter(c => c.id !== id);
  if (nova.length === lista.length) return false;
  await kvSet(kvKey(mes), nova);
  return true;
}

export function resumoCompras(compras: Compra[]) {
  const total = compras.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const porCategoria: Record<string, { total: number; count: number }> = {};
  let fixo = 0, variavel = 0;
  for (const c of compras) {
    const k = c.categoria || "Outros";
    if (!porCategoria[k]) porCategoria[k] = { total: 0, count: 0 };
    const v = Number(c.valor) || 0;
    porCategoria[k].total += v;
    porCategoria[k].count += 1;
    if (naturezaDaCompra(c) === "fixo") fixo += v; else variavel += v;
  }
  const categorias = Object.entries(porCategoria)
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.total - a.total);
  return { total, count: compras.length, categorias, fixo, variavel };
}

/** Normaliza a categoria vinda da IA pra uma das oficiais (fallback Outros). */
export function normalizarCategoria(cat: string | undefined | null): string {
  if (!cat) return "Outros";
  const n = String(cat).toLowerCase();
  const match = CATEGORIAS_COMPRA.find(c => c.toLowerCase() === n);
  if (match) return match;
  // heurística leve por palavra-chave (fallback quando a IA devolve algo fora da lista)
  if (/salári|salario|comiss|vale|equipe|barbeiro|assistente|funcion|secretár|secretar/.test(n)) return "Salários & Equipe";
  if (/limp|higien|papel|detergen|desinfe|descartáv|descartav/.test(n)) return "Limpeza & Higiene";
  if (/manut|conserto|reparo|obra|elétric|eletric|hidrául|hidraul|pintura|encanad/.test(n)) return "Manutenção & Reparos";
  if (/equip|máquina|maquina|cadeira|secador|espelho|móvel|movel|mobíli|mobili/.test(n)) return "Equipamentos & Móveis";
  if (/aluguel|locaç|locac/.test(n)) return "Aluguel";
  if (/conta|luz|energia|água|agua|internet|telefone|celular|utilidad/.test(n)) return "Contas & Utilidades";
  if (/imposto|taxa|contador|contábil|contabil|\bdas\b|simples/.test(n)) return "Impostos & Contador";
  if (/software|sistema|assinatura|trinks|\bapp\b|licenç|licenc/.test(n)) return "Software & Sistemas";
  if (/market|anúncio|anuncio|impuls|tráfego|trafego|publicid|gráfic|grafic|panfleto|brinde/.test(n)) return "Marketing & Publicidade";
  if (/comida|lanche|aliment|refei|restaurante|ifood|padaria/.test(n)) return "Alimentação";
  if (/bebida|cerveja|refri|energétic|energetic|doce|choc|bombon/.test(n)) return "Bebidas & Bomboniere";
  if (/produto|insumo|cosmétic|cosmetic|pomada|shampoo|condicion|óleo|oleo|tinta|navalha|lâmina|lamina|pente/.test(n)) return "Produtos & Insumos";
  return "Outros";
}

// ─── MEMÓRIA DO BENEFICIÁRIO (o dono responde 1×, o bot lembra) ──────────────
// Quando o dono classifica uma conta ("Aluguel, todo mês"), guardamos por
// beneficiário. Na 2ª vez que o mesmo nome cair, o bot já sabe e só CONFIRMA em
// vez de reperguntar. natureza = fixo (recorrente/todo mês) | variavel (avulsa).
export interface MemoriaBeneficiario { categoria: string; natureza: "fixo" | "variavel"; nome: string; atualizadoEm: string; }
const MEM_KEY = "compras_memoria";
const normLoja = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export async function getMemoriaBeneficiario(loja: string): Promise<MemoriaBeneficiario | null> {
  const k = normLoja(loja);
  if (!k) return null;
  const all = await kvGet<Record<string, MemoriaBeneficiario>>(MEM_KEY);
  return (all && all[k]) || null;
}

export async function setMemoriaBeneficiario(loja: string, categoria: string, natureza: "fixo" | "variavel"): Promise<void> {
  const k = normLoja(loja);
  if (!k) return;
  // leitura estrita: não apaga o mapa inteiro num blip de conexão
  const all = (await kvGetParaEscrita<Record<string, MemoriaBeneficiario>>(MEM_KEY)) || {};
  all[k] = { categoria, natureza, nome: loja, atualizadoEm: new Date().toISOString() };
  await kvSet(MEM_KEY, all);
}
