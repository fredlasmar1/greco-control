/**
 * v25 — Importação de relatórios CSV exportados pelo painel da Trinks.
 *
 * Suporta 3 tipos de relatório, com auto-detecção pelo cabeçalho:
 *   1. financeiro    — pagamentos linha-a-linha (forma de pagamento, cliente, valor)
 *   2. dre           — DRE consolidado mensal (receitas, despesas, resultado)
 *   3. ranking       — ranking comparativo de profissionais (2 períodos lado a lado)
 *
 * Encoding esperado: ISO-8859-1 (latin1). Convertemos para UTF-8 antes de parsear.
 * Separador: ponto-e-vírgula. Valores entre aspas duplas. Quebras CRLF.
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type TrinksImportType = "financeiro" | "dre" | "ranking" | "caixa" | "clientes";

export interface FinanceiroRow {
  data: string;                  // YYYY-MM-DD (Data Atendimento/Venda)
  diaSemana: string;
  tipoFormaPagamento: string;    // Crédito, Débito, À Vista, PIX, Outros
  formaPagamento: string;        // Cartão de Crédito, Dinheiro, PIX, Voucher, Depósito...
  parcela: string;
  antecipada: boolean;
  tipo: string;                  // Pagamento, Troco
  cliente: string;
  valorPago: number;
  descontoOperadora: number;
  valorReceber: number;
  quemFechou: string;
  comentario: string;
  contaFinanceira: string;
}

export interface FinanceiroPayload {
  tipo: "financeiro";
  mes: string;                   // YYYY-MM
  periodoInicio: string;         // YYYY-MM-DD
  periodoFim: string;            // YYYY-MM-DD
  geradoEm: string;              // ISO datetime do relatório
  totalLinhas: number;
  totalValor: number;            // soma de valorReceber (ignora linha "Total")
  rows: FinanceiroRow[];
  resumoPorForma: Record<string, number>;
  resumoPorDia: Record<string, number>;
}

export interface DRESubgrupo {
  nome: string;                  // "Despesas Fixas", "Despesas Variáveis", "Pessoal"...
  total: number;
  itens: Record<string, number>; // detalhes (Aluguel, Compra de Produto, etc.)
}

export interface DREPayload {
  tipo: "dre";
  mes: string;                   // YYYY-MM
  geradoEm: string;
  receitas: Record<string, number>;
  totalReceitas: number;
  /** Detalhe completo das despesas, agrupadas por subgrupo da Trinks. */
  despesasSubgrupos: DRESubgrupo[];
  /** Atalho: somatório plano de itens de despesa (compatibilidade). */
  despesas: Record<string, number>;
  totalDespesas: number;
  resultadoPeriodo: number;
}

export interface RankingProfissional {
  posicao: number;
  profissional: string;
  funcao: string;
  qtdAtendimentos: number;
  novosClientes: number;
  pctRetorno: number;
  clientesDistintos: number;
  totalServicos: number;
  numServicosRealizados: number;
  totalProdutos: number;
  unidadesProdutos: number;
  valorTotal: number;
  ticketMedio: number;
  pctSobreTotal: number;
}

export interface RankingPeriodo {
  mes: string;                   // YYYY-MM
  periodoInicio: string;
  periodoFim: string;
  profissionais: RankingProfissional[];
  total: number;
}

export interface RankingPayload {
  tipo: "ranking";
  geradoEm: string;
  periodos: RankingPeriodo[];    // 1 ou 2 períodos (lado a lado no relatório)
}

// v39: Caixa (relatório por comanda com breakdown de pagamento detalhado)
export interface CaixaRow {
  data: string;                   // YYYY-MM-DD (atendimento/venda)
  dataPagamento: string;          // ISO ou string completa
  tipo: string;                   // Pagamento | Estorno
  clienteId: string;
  clienteNome: string;
  totalServico: number;
  qtdServico: number;
  totalProdutos: number;
  qtdProdutos: number;
  totalPacotes: number;
  qtdPacotes: number;
  totalVale: number;              // vale-presente
  qtdVale: number;
  creditoCliente: number;
  totalDescontos: number;
  motivoDesconto: string;
  totalCredito: number;           // cartão crédito
  totalDebito: number;            // cartão débito
  totalDinheiro: number;
  totalPrePago: number;
  totalOutros: number;
  totalTroco: number;
  totalGorjeta: number;
  totalGeral: number;
  quemFechou: string;
  comentarioFechamento: string;
  comentarioEstorno: string;
}

export interface CaixaPayload {
  tipo: "caixa";
  mes: string;
  periodoInicio: string;
  periodoFim: string;
  geradoEm: string;
  totalLinhas: number;
  totalValor: number;
  totalServico: number;
  totalProdutos: number;
  totalPorForma: {
    credito: number;
    debito: number;
    dinheiro: number;
    prePago: number;
    outros: number;
  };
  rows: CaixaRow[];
  resumoPorDia: Record<string, { total: number; servico: number; produtos: number; comandas: number }>;
}

// ─── Clientes (Ranking de Clientes — Fase 2) ────────────────────────────────
// Relatório "Ranking de Clientes" do Trinks: 1 linha por cliente, com gasto no
// período (serviços/produtos/pacotes/total), nº de visitas pagas, último
// atendimento e dados de cadastro. Liga cliente → consumo, NÃO cliente → barbeiro.

export interface RankingClienteRow {
  posicao: number;
  nome: string;
  email: string;
  telefones: string;
  dataNascimento: string;         // YYYY-MM-DD ("" se vazio)
  dataCadastro: string;           // YYYY-MM-DD ("" se vazio)
  novoCliente: boolean;
  ultimoAtendimento: string;      // YYYY-MM-DD ("" se vazio)
  visitasPeriodo: number;
  servicos: number;
  produtos: number;
  pacotes: number;
  total: number;
  ticketMedio: number;
}

export interface ClientesPayload {
  tipo: "clientes";
  mes: string;                    // derivado do período (data inicial)
  periodoInicio: string;
  periodoFim: string;
  geradoEm: string;
  totalClientes: number;
  rows: RankingClienteRow[];
}

export type TrinksImportPayload = FinanceiroPayload | DREPayload | RankingPayload | CaixaPayload | ClientesPayload;

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Decodifica buffer para string. Trinks exporta em ISO-8859-1. */
export function decodeCsvBuffer(buf: Buffer): string {
  // Tenta detectar BOM UTF-8
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf-8").slice(1);
  }
  // Heurística: se tiver bytes 0x80-0xFF e nenhum padrão UTF-8 multi-byte válido frequente,
  // assume latin1. Trinks sempre exporta em latin1.
  const sample = buf.slice(0, Math.min(buf.length, 4096));
  let highByte = false;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] >= 0x80) { highByte = true; break; }
  }
  if (highByte) {
    // latin1 default Trinks
    return buf.toString("latin1");
  }
  return buf.toString("utf-8");
}

/** Quebra texto em linhas tratando CRLF/CR/LF e remove BOM. */
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Parse de uma linha CSV com aspas e separador ;.
 * Trata aspas duplas escapadas ("") e ignora ; dentro de aspas.
 */
function parseCsvLine(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === sep) { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** "1.234,56" → 1234.56  |  "80,00" → 80  |  "" → 0 */
function parseBR(num: string): number {
  if (!num) return 0;
  const t = num.trim().replace(/\s/g, "");
  if (!t) return 0;
  // remove separador de milhar (.) e troca decimal (,) por (.)
  const norm = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : 0;
}

/** "29,50 %" → 29.5  |  "100,00%" → 100 */
function parsePct(s: string): number {
  if (!s) return 0;
  return parseBR(s.replace("%", "").trim());
}

/** "01/04/2026" → "2026-04-01"  |  "" → "" */
function parseDateBR(s: string): string {
  if (!s) return "";
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "Abril / 2026" → "2026-04" */
function parseMesPtBR(s: string): string {
  if (!s) return "";
  const meses: Record<string, string> = {
    "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03",
    "abril": "04", "maio": "05", "junho": "06", "julho": "07",
    "agosto": "08", "setembro": "09", "outubro": "10",
    "novembro": "11", "dezembro": "12",
  };
  const m = s.toLowerCase().match(/(\w+)\s*\/\s*(\d{4})/);
  if (!m) return "";
  const mm = meses[m[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
  if (!mm) return "";
  return `${m[2]}-${mm}`;
}

/** Extrai mês YYYY-MM do período (usa mês de início). */
function mesDoPeriodo(inicio: string): string {
  // inicio em YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return inicio.slice(0, 7);
  return "";
}

// ─── Auto-detecção ───────────────────────────────────────────────────────────

/**
 * Detecta o tipo do CSV inspecionando as primeiras 12 linhas.
 * Retorna null se nenhum tipo bater.
 */
export function detectTrinksType(text: string): TrinksImportType | null {
  const all = splitLines(text);
  const head = all.slice(0, 15).join("\n").toLowerCase();
  const full = all.join("\n").toLowerCase();

  // Clientes (Fase 2): cabeçalho "Posição;Nome Cliente;...;Visitas com pagamento
  // no período;...". Assinatura exclusiva — não colide com o ranking de
  // profissionais (que tem "Profissional" + "Quantidade de Atendimentos").
  if (head.includes("posição") && head.includes("nome cliente") &&
      head.includes("visitas com pagamento")) {
    return "clientes";
  }

  // Ranking: tem cabeçalho com "Posição;Profissional;Função;Quantidade de Atendimentos"
  if (head.includes("posição") && head.includes("profissional") &&
      head.includes("quantidade de atendimentos") && head.includes("ticket médio")) {
    return "ranking";
  }

  // v39: Caixa (relatório por comanda) — tem 'data de atendimento/venda' +
  // 'total (r$) serviço' + 'quem fechou a conta'. Granularidade por comanda
  // com breakdown de forma de pagamento (crédito/débito/dinheiro/pré-pago).
  if (head.includes("data de atendimento/venda") &&
      head.includes("total (r$) serviço") &&
      head.includes("total (r$) produtos") &&
      head.includes("quem fechou a conta")) {
    return "caixa";
  }

  // Financeiro: tem "Mês de Previsão de Recebimento" e "Forma de Pagamento" e "Cliente"
  if (head.includes("mês de previsão de recebimento") &&
      head.includes("forma de pagamento") &&
      head.includes("cliente") &&
      head.includes("valor pago")) {
    return "financeiro";
  }

  // DRE: tem seção "RECEITAS" no início + ("Total de Receitas" OU "Resultado do Período" OU "Total de Despesas")
  // Esses marcadores aparecem em linhas espalhadas, então usamos o texto completo.
  if (head.includes("receitas") &&
      (full.includes("total de receitas") || full.includes("total de despesas") || full.includes("resultado do período"))) {
    return "dre";
  }

  return null;
}

// ─── Parser: Financeiro ──────────────────────────────────────────────────────

const FINANCEIRO_HEADER_REGEX = /^"?M[eê]s de Previs[aã]o de Recebimento"?/i;

export function parseFinanceiro(text: string): FinanceiroPayload {
  const lines = splitLines(text);

  let periodoInicio = "";
  let periodoFim = "";
  let geradoEm = "";
  let headerIdx = -1;

  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const l = lines[i];
    const cells = parseCsvLine(l);
    const c0 = (cells[0] || "").trim();
    if (/^Data In[ií]cio:/i.test(c0)) {
      periodoInicio = parseDateBR(c0.replace(/^Data In[ií]cio:\s*/i, "").trim());
    } else if (/^Data Fim:/i.test(c0)) {
      periodoFim = parseDateBR(c0.replace(/^Data Fim:\s*/i, "").trim());
    } else if (/^Relat[oó]rio gerado em/i.test(c0)) {
      geradoEm = c0.replace(/^Relat[oó]rio gerado em\s*/i, "").trim();
    }
    if (FINANCEIRO_HEADER_REGEX.test(l)) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error("Cabeçalho do relatório financeiro não encontrado.");
  }

  const headerCells = parseCsvLine(lines[headerIdx]);
  const idx = (name: string) => headerCells.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());

  const cTipoFP = idx("Tipo de Forma de Pagamento");
  const cFP = idx("Forma de Pagamento");
  const cData = idx("Data Atendimento/Venda");
  const cDiaSem = idx("Dia da Semana Atendimento/Venda");
  const cParcela = idx("Parcela");
  const cAnt = idx("Antecipada");
  const cTipo = idx("Tipo");
  const cCliente = idx("Cliente");
  const cValorPago = idx("Valor Pago");
  const cDescOp = idx("Valor de Desconto da Operadora (R$)");
  const cValorRec = idx("Valor a ser Recebido");
  const cQuem = idx("Quem Fechou a Conta");
  const cComent = idx("Comentário sobre o Fechamento");
  const cConta = idx("Conta Financeira");

  const rows: FinanceiroRow[] = [];
  const resumoPorForma: Record<string, number> = {};
  const resumoPorDia: Record<string, number> = {};
  let totalValor = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const cells = parseCsvLine(l);
    if (cells.length < 5) continue;

    const tipo = (cells[cTipo] || "").trim();
    // Linha "Total" no final do relatório vem com Tipo=Total e cliente="Total"
    if (tipo === "Total") continue;

    const dataBR = (cells[cData] || "").trim();
    const dataISO = parseDateBR(dataBR);
    if (!dataISO) continue;  // descarta linhas sem data válida

    const valorReceber = parseBR(cells[cValorRec] || "0");

    const row: FinanceiroRow = {
      data: dataISO,
      diaSemana: (cells[cDiaSem] || "").trim(),
      tipoFormaPagamento: (cells[cTipoFP] || "").trim(),
      formaPagamento: (cells[cFP] || "").trim(),
      parcela: (cells[cParcela] || "").trim(),
      antecipada: (cells[cAnt] || "").trim().toLowerCase() === "sim",
      tipo,
      cliente: (cells[cCliente] || "").trim(),
      valorPago: parseBR(cells[cValorPago] || "0"),
      descontoOperadora: parseBR(cells[cDescOp] || "0"),
      valorReceber,
      quemFechou: (cells[cQuem] || "").trim(),
      comentario: (cells[cComent] || "").trim(),
      contaFinanceira: (cells[cConta] || "").trim(),
    };
    rows.push(row);

    totalValor += valorReceber;
    resumoPorForma[row.formaPagamento] = (resumoPorForma[row.formaPagamento] || 0) + valorReceber;
    resumoPorDia[row.data] = (resumoPorDia[row.data] || 0) + valorReceber;
  }

  const mes = mesDoPeriodo(periodoInicio) || (rows[0] ? rows[0].data.slice(0, 7) : "");

  return {
    tipo: "financeiro",
    mes,
    periodoInicio,
    periodoFim,
    geradoEm,
    totalLinhas: rows.length,
    totalValor: Math.round(totalValor * 100) / 100,
    rows,
    resumoPorForma,
    resumoPorDia,
  };
}

// ─── Parser: DRE ─────────────────────────────────────────────────────────────

/**
 * Estrutura do DRE da Trinks:
 *   RECEITAS                       ← cabeçalho
 *     Serviços; Produtos; ...      ← itens diretos
 *   Total de Receitas
 *   (-) DESPESAS                    ← cabeçalho
 *     Despesas Fixas; <total>      ← SUBGRUPO (linha com nome+valor)
 *       Aluguel; <valor>           ← ITENS do subgrupo
 *     <linha vazia>
 *     Despesas Variáveis; <total> ← próximo SUBGRUPO
 *       ...
 *   Total de Despesas
 *   Resultado do Período
 *
 * Como diferençamos um SUBGRUPO de um ITEM dentro do mesmo subgrupo?
 * Pelo padrão: subgrupo é sempre precedido de linha em branco (ou (-) DESPESAS).
 * Itens vêm logo depois do subgrupo, antes da próxima linha em branco.
 */
export function parseDRE(text: string): DREPayload {
  const lines = splitLines(text);

  let mes = "";
  let geradoEm = "";
  const receitas: Record<string, number> = {};
  const despesasFlat: Record<string, number> = {};
  const despesasSubgrupos: DRESubgrupo[] = [];
  let totalReceitas = 0;
  let totalDespesas = 0;
  let resultadoPeriodo = 0;

  // Mês (linha 2: ";"abril / 2026")
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const cells = parseCsvLine(lines[i]);
    for (const c of cells) {
      const m = parseMesPtBR(c);
      if (m) { mes = m; break; }
    }
    if (mes) break;
  }

  type Secao = "none" | "receita" | "despesa";
  let secao: Secao = "none";
  let prevWasBlank = true;       // controla início de novo subgrupo
  let currentSubgrupo: DRESubgrupo | null = null;

  for (const line of lines) {
    const cells = parseCsvLine(line);
    const label = (cells[0] || "").trim();
    const valorRaw = (cells[1] || "").trim();
    const labelLower = label.toLowerCase();

    // Linha em branco encerra o subgrupo atual; próxima linha não-vazia será novo subgrupo
    if (!label && !valorRaw) {
      currentSubgrupo = null;
      prevWasBlank = true;
      continue;
    }

    // Cabeçalho RECEITAS
    if (labelLower === "receitas") {
      secao = "receita";
      prevWasBlank = true;
      continue;
    }
    // Cabeçalho DESPESAS
    if (labelLower === "despesas" || labelLower === "(-) despesas") {
      secao = "despesa";
      prevWasBlank = true;
      currentSubgrupo = null;
      continue;
    }
    if (/^relat[oó]rio gerado/i.test(label)) {
      geradoEm = label.replace(/^Relat[oó]rio gerado em\s*/i, "").trim();
      continue;
    }

    const valor = parseBR(valorRaw);

    // Linhas-resumo finais
    if (labelLower === "total de receitas") {
      totalReceitas = valor;
      secao = "none";
      currentSubgrupo = null;
      continue;
    }
    if (labelLower === "total de despesas") {
      totalDespesas = valor;
      secao = "none";
      currentSubgrupo = null;
      continue;
    }
    if (labelLower === "resultado do período" || labelLower === "resultado do periodo") {
      resultadoPeriodo = valor;
      continue;
    }

    // Conteúdo das seções
    if (secao === "receita" && valorRaw !== "") {
      receitas[label] = valor;
      prevWasBlank = false;
      continue;
    }

    if (secao === "despesa" && valorRaw !== "") {
      // Se a linha anterior foi em branco (ou cabeçalho), é subgrupo. Senão, é item.
      if (prevWasBlank || !currentSubgrupo) {
        currentSubgrupo = { nome: label, total: valor, itens: {} };
        despesasSubgrupos.push(currentSubgrupo);
      } else {
        currentSubgrupo.itens[label] = valor;
        despesasFlat[label] = valor;
      }
      prevWasBlank = false;
      continue;
    }

    prevWasBlank = false;
  }

  return {
    tipo: "dre",
    mes,
    geradoEm,
    receitas,
    totalReceitas,
    despesasSubgrupos,
    despesas: despesasFlat,
    totalDespesas,
    resultadoPeriodo,
  };
}

// ─── Parser: Ranking comparativo (2 períodos lado a lado) ────────────────────

export function parseRanking(text: string): RankingPayload {
  const lines = splitLines(text);

  let geradoEm = "";
  // Cabeçalho do bloco da direita começa em col 19 (conforme amostra). Achamos o índice
  // dinamicamente procurando pela 2ª ocorrência de "Posição" no header row.
  let headerRowIdx = -1;
  let metaInicios: { lado: "esq" | "dir"; texto: string }[] = [];

  // Scan inicial: até linha do header da tabela
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cells = parseCsvLine(lines[i]);
    const lower = lines[i].toLowerCase();
    if (lower.includes("posição") && lower.includes("profissional")) {
      headerRowIdx = i;
      break;
    }
    // Captura metadados
    for (const c of cells) {
      const t = c.trim();
      if (/^Data In[ií]cio:/i.test(t) || /^Data Fim:/i.test(t)) {
        // armazenamos posicionalmente decidindo lado depois (col < 10 = esq, senão dir)
        const idx = cells.indexOf(c);
        metaInicios.push({ lado: idx < 10 ? "esq" : "dir", texto: t });
      }
      if (/^Relat[oó]rio gerado em/i.test(t)) {
        geradoEm = t.replace(/^Relat[oó]rio gerado em\s*\xE0?s?\s*/i, "").replace(/^Relat[oó]rio gerado em\s*/i, "").trim();
      }
    }
  }

  if (headerRowIdx === -1) {
    throw new Error("Cabeçalho do ranking não encontrado.");
  }

  const headerCells = parseCsvLine(lines[headerRowIdx]);
  // Acha índices das DUAS ocorrências de "Posição"
  const posIdxs: number[] = [];
  headerCells.forEach((c, i) => {
    if (c.trim().toLowerCase() === "posição") posIdxs.push(i);
  });
  if (posIdxs.length === 0) throw new Error("Coluna 'Posição' não encontrada no ranking.");

  // Função para extrair um bloco (14 colunas a partir do início)
  const COLS_PER_BLOCK = 14;
  const extractRow = (cells: string[], startIdx: number): RankingProfissional | null => {
    const slice = cells.slice(startIdx, startIdx + COLS_PER_BLOCK);
    if (slice.length < COLS_PER_BLOCK) return null;
    const posStr = (slice[0] || "").trim();
    const prof = (slice[1] || "").trim();
    if (!posStr || !prof) return null;
    if (posStr.toLowerCase() === "posição") return null;
    const pos = parseInt(posStr, 10);
    if (!Number.isFinite(pos)) return null;
    return {
      posicao: pos,
      profissional: prof,
      funcao: (slice[2] || "").trim(),
      qtdAtendimentos: parseBR(slice[3]),
      novosClientes: parseBR(slice[4]),
      pctRetorno: parsePct(slice[5]),
      clientesDistintos: parseBR(slice[6]),
      totalServicos: parseBR(slice[7]),
      numServicosRealizados: parseBR(slice[8]),
      totalProdutos: parseBR(slice[9]),
      unidadesProdutos: parseBR(slice[10]),
      valorTotal: parseBR(slice[11]),
      ticketMedio: parseBR(slice[12]),
      pctSobreTotal: parsePct(slice[13]),
    };
  };

  // Constrói períodos a partir dos metadados (esq/dir)
  const buildPeriodo = (lado: "esq" | "dir"): { inicio: string; fim: string; mes: string } => {
    const ini = metaInicios.find(m => m.lado === lado && /Data In[ií]cio/i.test(m.texto));
    const fim = metaInicios.find(m => m.lado === lado && /Data Fim/i.test(m.texto));
    const inicioISO = ini ? parseDateBR(ini.texto.replace(/^Data In[ií]cio:\s*/i, "").trim()) : "";
    const fimISO = fim ? parseDateBR(fim.texto.replace(/^Data Fim:\s*/i, "").trim()) : "";
    return { inicio: inicioISO, fim: fimISO, mes: mesDoPeriodo(inicioISO) };
  };

  const periodos: RankingPeriodo[] = [];
  posIdxs.forEach((startIdx, blockNum) => {
    const lado = blockNum === 0 ? "esq" : "dir";
    const { inicio, fim, mes } = buildPeriodo(lado);
    const profissionais: RankingProfissional[] = [];
    let total = 0;
    for (let i = headerRowIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) continue;
      const cells = parseCsvLine(l);
      // Se for linha de "Total" (label na col startIdx+1 == "Total" e col 0 vazia)
      const r = extractRow(cells, startIdx);
      if (r) {
        profissionais.push(r);
        total += r.valorTotal;
      }
    }
    if (profissionais.length > 0) {
      periodos.push({ mes, periodoInicio: inicio, periodoFim: fim, profissionais, total: Math.round(total * 100) / 100 });
    }
  });

  return { tipo: "ranking", geradoEm, periodos };
}

// ─── Parser: Caixa (v39) ────────────────────────────────────────────────────
// Relatório por comanda com breakdown completo: serviço/produto/pacote separados
// + forma de pagamento detalhada (crédito/débito/dinheiro/pré-pago).

export function parseCaixa(text: string): CaixaPayload {
  const lines = splitLines(text);
  let geradoEm = "";
  let periodoInicio = "";
  let periodoFim = "";
  // Preâmbulo
  for (const line of lines.slice(0, 10)) {
    const ini = line.match(/Data In[ií]cio:\s*(\d{2}\/\d{2}\/\d{4})/i);
    const fim = line.match(/Data Fim:\s*(\d{2}\/\d{2}\/\d{4})/i);
    const ger = line.match(/Relat[oó]rio gerado em\s+(.+?)["\s]*$/i);
    if (ini) periodoInicio = parseDateBR(ini[1]);
    if (fim) periodoFim = parseDateBR(fim[1]);
    if (ger) geradoEm = ger[1].trim();
  }

  const headerIdx = lines.findIndex(l => /Data de Atendimento\/Venda.*Total \(R\$\)\s*Serviço/i.test(l));
  if (headerIdx < 0) throw new Error("Cabeçalho de Caixa não encontrado");

  const rows: CaixaRow[] = [];
  const resumoPorDia: Record<string, { total: number; servico: number; produtos: number; comandas: number }> = {};
  let totalValor = 0, totalServico = 0, totalProdutos = 0;
  let totCred = 0, totDeb = 0, totDin = 0, totPre = 0, totOut = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 24) continue;
    const dataBr = cols[0];
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dataBr)) continue;
    const data = parseDateBR(dataBr);
    const row: CaixaRow = {
      data,
      dataPagamento: cols[1] || "",
      tipo: cols[2] || "Pagamento",
      clienteId: cols[3] || "",
      clienteNome: cols[4] || "",
      totalServico: parseBR(cols[5]),
      qtdServico: parseInt(cols[6] || "0", 10) || 0,
      totalProdutos: parseBR(cols[7]),
      qtdProdutos: parseInt(cols[8] || "0", 10) || 0,
      totalPacotes: parseBR(cols[9]),
      qtdPacotes: parseInt(cols[10] || "0", 10) || 0,
      totalVale: parseBR(cols[11]),
      qtdVale: parseInt(cols[12] || "0", 10) || 0,
      creditoCliente: parseBR(cols[13]),
      totalDescontos: parseBR(cols[14]),
      motivoDesconto: cols[15] || "",
      totalCredito: parseBR(cols[16]),
      totalDebito: parseBR(cols[17]),
      totalDinheiro: parseBR(cols[18]),
      totalPrePago: parseBR(cols[19]),
      totalOutros: parseBR(cols[20]),
      totalTroco: parseBR(cols[21]),
      totalGorjeta: parseBR(cols[22]),
      totalGeral: parseBR(cols[23]),
      quemFechou: cols[24] || "",
      comentarioFechamento: cols[25] || "",
      comentarioEstorno: cols[26] || "",
    };
    rows.push(row);
    totalValor += row.totalGeral;
    totalServico += row.totalServico;
    totalProdutos += row.totalProdutos;
    totCred += row.totalCredito;
    totDeb += row.totalDebito;
    totDin += row.totalDinheiro;
    totPre += row.totalPrePago;
    totOut += row.totalOutros;
    if (!resumoPorDia[data]) resumoPorDia[data] = { total: 0, servico: 0, produtos: 0, comandas: 0 };
    resumoPorDia[data].total += row.totalGeral;
    resumoPorDia[data].servico += row.totalServico;
    resumoPorDia[data].produtos += row.totalProdutos;
    resumoPorDia[data].comandas += 1;
  }

  // Mês predominante
  const mesContagem: Record<string, number> = {};
  for (const r of rows) {
    const m = r.data.slice(0, 7);
    mesContagem[m] = (mesContagem[m] || 0) + 1;
  }
  const mes = Object.entries(mesContagem).sort((a, b) => b[1] - a[1])[0]?.[0] || periodoInicio.slice(0, 7);

  return {
    tipo: "caixa", mes, periodoInicio, periodoFim, geradoEm,
    totalLinhas: rows.length,
    totalValor: Math.round(totalValor * 100) / 100,
    totalServico: Math.round(totalServico * 100) / 100,
    totalProdutos: Math.round(totalProdutos * 100) / 100,
    totalPorForma: {
      credito: Math.round(totCred * 100) / 100,
      debito: Math.round(totDeb * 100) / 100,
      dinheiro: Math.round(totDin * 100) / 100,
      prePago: Math.round(totPre * 100) / 100,
      outros: Math.round(totOut * 100) / 100,
    },
    rows,
    resumoPorDia,
  };
}

// ─── Parser unificado ────────────────────────────────────────────────────────

// ─── Parser: Clientes (Ranking de Clientes — Fase 2) ─────────────────────────
// Preâmbulo: «"Atendimentos/Vendas entre 01/06/2026 e 14/06/2026"» (→ período/mês)
// + «"Relatório gerado em DD/MM/YYYY às HH:MM"». Header de 14 colunas. 1 linha/cliente.

export function parseClientes(text: string): ClientesPayload {
  const lines = splitLines(text);

  let periodoInicio = "";
  let periodoFim = "";
  let geradoEm = "";
  // Preâmbulo (primeiras linhas antes do header)
  for (const line of lines.slice(0, 10)) {
    const per = line.match(/entre\s+(\d{2}\/\d{2}\/\d{4})\s+e\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (per) { periodoInicio = parseDateBR(per[1]); periodoFim = parseDateBR(per[2]); }
    const ger = line.match(/Relat[oó]rio gerado em\s+(.+?)["\s]*$/i);
    if (ger) geradoEm = ger[1].trim();
  }

  const headerIdx = lines.findIndex(l => {
    const lo = l.toLowerCase();
    return lo.includes("posição") && lo.includes("nome cliente") && lo.includes("visitas com pagamento");
  });
  if (headerIdx < 0) throw new Error("Cabeçalho do Ranking de Clientes não encontrado.");

  const rows: RankingClienteRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const c = parseCsvLine(l);
    if (c.length < 14) continue;
    const pos = parseInt((c[0] || "").trim(), 10);
    if (!Number.isFinite(pos)) continue;           // pula linhas de total/rótulo
    const nome = (c[1] || "").trim();
    if (!nome) continue;
    rows.push({
      posicao: pos,
      nome,
      email: (c[2] || "").trim(),
      telefones: (c[3] || "").trim(),
      dataNascimento: parseDateBR((c[4] || "").trim()),
      dataCadastro: parseDateBR((c[5] || "").trim()),
      novoCliente: /^s/i.test((c[6] || "").trim()),  // "Sim" → true, "Não" → false
      ultimoAtendimento: parseDateBR((c[7] || "").trim()),
      visitasPeriodo: parseBR(c[8]),
      servicos: parseBR(c[9]),
      produtos: parseBR(c[10]),
      pacotes: parseBR(c[11]),
      total: parseBR(c[12]),
      ticketMedio: parseBR(c[13]),
    });
  }

  const mes = mesDoPeriodo(periodoInicio);
  return {
    tipo: "clientes",
    mes,
    periodoInicio,
    periodoFim,
    geradoEm,
    totalClientes: rows.length,
    rows,
  };
}

export function parseTrinksCsv(buf: Buffer): TrinksImportPayload {
  const text = decodeCsvBuffer(buf);
  const tipo = detectTrinksType(text);
  if (!tipo) {
    throw new Error("Tipo de relatório não reconhecido. Esperado: financeiro, DRE, ranking, caixa ou clientes.");
  }
  if (tipo === "financeiro") return parseFinanceiro(text);
  if (tipo === "dre") return parseDRE(text);
  if (tipo === "caixa") return parseCaixa(text);
  if (tipo === "clientes") return parseClientes(text);
  return parseRanking(text);
}

// ─── Persistência (chaves kv_store) ──────────────────────────────────────────

/** Chave única por mês+tipo. Ranking pode salvar 2 chaves (1 por período). */
export function kvKeyFor(tipo: TrinksImportType, mes: string): string {
  return `trinks_import:${tipo}:${mes}`;
}

/** Resumo curto de uma importação (para listagem). */
export interface ImportSummary {
  tipo: TrinksImportType;
  mes: string;
  totalValor: number;
  totalLinhas?: number;
  geradoEm?: string;
  importadoEm: string;
  // descrição amigável
  descricao: string;
}

// ─── Helpers de integração (Etapa 3) ─────────────────────────────────────────
//
// O CSV "Ranking comparativo" da Trinks traz, por profissional, valores agregados
// já consolidados (qtdAtendimentos, totalServicos, totalProdutos, valorTotal,
// ticketMedio, etc). Convertendo para o mesmo formato usado pelo endpoint
// /api/equipe/desempenho permitimos que a tela Equipe siga funcionando quando
// a API Trinks estiver indisponível (HTTP 429).
//
// IMPORTANTE: o CSV não distingue avulso × plano nem tem detalhe de comissão.
// Aproximamos: total = valorTotal; serviços = totalServicos; produtos =
// totalProdutos; avulso recebe o total (plano = 0) — pode ser ajustado se o
// usuário decidir tratar plano à parte no futuro.

/** Normaliza nome para matching (lowercase + sem acentos). */
function normalizaNome(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export interface ImportPeriodoStats {
  reais: number;
  count: number;
}

export interface ImportPeriodoProfissional {
  profissionalId: string;
  nome: string;
  idsConhecidos: string[];
  avulso: ImportPeriodoStats;
  plano: ImportPeriodoStats;
  servicos: ImportPeriodoStats & { bruto: number; liquido: number };
  produtos: ImportPeriodoStats & { bruto: number; liquido: number; liquidoComissionavel: number; brutoComissionavel: number };
  taxaCartao: number;
  total: ImportPeriodoStats;
}

export interface ImportPeriodoTotais {
  reais: number; count: number;
  avulsoReais: number; avulsoCount: number;
  planoReais: number; planoCount: number;
  servicosReais: number; servicosCount: number; servicosBruto: number; servicosLiquido: number;
  produtosReais: number; produtosCount: number; produtosBruto: number; produtosLiquido: number;
  produtosLiquidoComissionavel: number; produtosBrutoComissionavel: number;
}

export interface ImportPeriodoResultado {
  dataInicio: string;
  dataFim: string;
  porProfissional: Record<string, ImportPeriodoProfissional>;
  totais: ImportPeriodoTotais;
  config: { taxaCartaoPct: number };
  fetchedAt: string;
  fonte: "trinks-import";
}

/**
 * Converte um período de ranking importado em formato compatível com
 * calcularPeriodoPorProfissional. Faz match profissional → ID por nome usando
 * o mapa fornecido (geralmente das metas cadastradas).
 */
export function rankingPeriodoParaResultado(
  periodo: RankingPeriodo,
  nomeParaIdPrimario: Map<string, string>,
  config: { taxaCartaoPct: number } = { taxaCartaoPct: 0 },
): ImportPeriodoResultado {
  const porProfissional: Record<string, ImportPeriodoProfissional> = {};
  const totais: ImportPeriodoTotais = {
    reais: 0, count: 0,
    avulsoReais: 0, avulsoCount: 0,
    planoReais: 0, planoCount: 0,
    servicosReais: 0, servicosCount: 0, servicosBruto: 0, servicosLiquido: 0,
    produtosReais: 0, produtosCount: 0, produtosBruto: 0, produtosLiquido: 0,
    produtosLiquidoComissionavel: 0, produtosBrutoComissionavel: 0,
  };

  periodo.profissionais.forEach((p, idx) => {
    const nomeNorm = normalizaNome(p.profissional);
    const idPrim = nomeParaIdPrimario.get(nomeNorm) || `import:${nomeNorm || idx}`;
    const servicosReais = p.totalServicos;
    const produtosReais = p.totalProdutos;
    const totalReais = p.valorTotal;
    const totalCount = p.qtdAtendimentos;
    const numServ = p.numServicosRealizados;
    const unidProd = p.unidadesProdutos;

    porProfissional[idPrim] = {
      profissionalId: idPrim,
      nome: p.profissional,
      idsConhecidos: [idPrim],
      avulso: { reais: totalReais, count: totalCount },
      plano:  { reais: 0, count: 0 },
      servicos: { reais: servicosReais, count: numServ, bruto: servicosReais, liquido: servicosReais },
      produtos: { reais: produtosReais, count: unidProd, bruto: produtosReais, liquido: produtosReais, liquidoComissionavel: produtosReais, brutoComissionavel: produtosReais },
      taxaCartao: 0,
      total: { reais: totalReais, count: totalCount },
    };

    totais.reais += totalReais;
    totais.count += totalCount;
    totais.avulsoReais += totalReais;
    totais.avulsoCount += totalCount;
    totais.servicosReais += servicosReais;
    totais.servicosCount += numServ;
    totais.servicosBruto += servicosReais;
    totais.servicosLiquido += servicosReais;
    totais.produtosReais += produtosReais;
    totais.produtosCount += unidProd;
    totais.produtosBruto += produtosReais;
    totais.produtosLiquido += produtosReais;
    totais.produtosLiquidoComissionavel += produtosReais;
    totais.produtosBrutoComissionavel += produtosReais;
  });

  return {
    dataInicio: periodo.periodoInicio,
    dataFim: periodo.periodoFim,
    porProfissional,
    totais,
    config,
    fetchedAt: new Date().toISOString(),
    fonte: "trinks-import",
  };
}

/** Vazio em formato compatível (para janelas dia/semana sem dado importado). */
export function periodoVazio(dataInicio: string, dataFim: string): ImportPeriodoResultado {
  return {
    dataInicio,
    dataFim,
    porProfissional: {},
    totais: {
      reais: 0, count: 0,
      avulsoReais: 0, avulsoCount: 0,
      planoReais: 0, planoCount: 0,
      servicosReais: 0, servicosCount: 0, servicosBruto: 0, servicosLiquido: 0,
      produtosReais: 0, produtosCount: 0, produtosBruto: 0, produtosLiquido: 0,
      produtosLiquidoComissionavel: 0, produtosBrutoComissionavel: 0,
    },
    config: { taxaCartaoPct: 0 },
    fetchedAt: new Date().toISOString(),
    fonte: "trinks-import",
  };
}

export function summarize(payload: TrinksImportPayload, importadoEm: string, mesOverride?: string): ImportSummary {
  if (payload.tipo === "financeiro") {
    return {
      tipo: "financeiro",
      mes: payload.mes,
      totalValor: payload.totalValor,
      totalLinhas: payload.totalLinhas,
      geradoEm: payload.geradoEm,
      importadoEm,
      descricao: `Financeiro · ${payload.totalLinhas} pagamentos · R$ ${payload.totalValor.toFixed(2).replace(".", ",")}`,
    };
  }
  if (payload.tipo === "dre") {
    return {
      tipo: "dre",
      mes: payload.mes,
      totalValor: payload.resultadoPeriodo,
      geradoEm: payload.geradoEm,
      importadoEm,
      descricao: `DRE · Receitas R$ ${payload.totalReceitas.toFixed(2).replace(".", ",")} − Despesas R$ ${payload.totalDespesas.toFixed(2).replace(".", ",")} = R$ ${payload.resultadoPeriodo.toFixed(2).replace(".", ",")}`,
    };
  }
  if (payload.tipo === "caixa") {
    return {
      tipo: "caixa",
      mes: payload.mes,
      totalValor: payload.totalValor,
      totalLinhas: payload.totalLinhas,
      geradoEm: payload.geradoEm,
      importadoEm,
      descricao: `Caixa · ${payload.totalLinhas} comandas · R$ ${payload.totalValor.toFixed(2).replace(".", ",")} (serv R$ ${payload.totalServico.toFixed(2)} · prod R$ ${payload.totalProdutos.toFixed(2)})`,
    };
  }
  if (payload.tipo === "clientes") {
    const novos = payload.rows.filter(r => r.novoCliente).length;
    const totalReais = payload.rows.reduce((s, r) => s + r.total, 0);
    return {
      tipo: "clientes",
      mes: payload.mes,
      totalValor: totalReais,
      totalLinhas: payload.totalClientes,
      geradoEm: payload.geradoEm,
      importadoEm,
      descricao: `Clientes · ${payload.totalClientes} clientes · ${novos} novos · R$ ${totalReais.toFixed(2).replace(".", ",")}`,
    };
  }
  // ranking — pode ter múltiplos meses; chamamos summarize por período fora
  const p = payload.periodos.find((x: any) => x.mes === mesOverride) || payload.periodos[0];
  return {
    tipo: "ranking",
    mes: p?.mes || "",
    totalValor: p?.total || 0,
    totalLinhas: p?.profissionais.length || 0,
    geradoEm: payload.geradoEm,
    importadoEm,
    descricao: `Ranking · ${p?.profissionais.length || 0} profissionais · R$ ${(p?.total || 0).toFixed(2).replace(".", ",")}`,
  };
}
