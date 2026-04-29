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

export type TrinksImportType = "financeiro" | "dre" | "ranking";

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

export type TrinksImportPayload = FinanceiroPayload | DREPayload | RankingPayload;

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

  // Ranking: tem cabeçalho com "Posição;Profissional;Função;Quantidade de Atendimentos"
  if (head.includes("posição") && head.includes("profissional") &&
      head.includes("quantidade de atendimentos") && head.includes("ticket médio")) {
    return "ranking";
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

// ─── Parser unificado ────────────────────────────────────────────────────────

export function parseTrinksCsv(buf: Buffer): TrinksImportPayload {
  const text = decodeCsvBuffer(buf);
  const tipo = detectTrinksType(text);
  if (!tipo) {
    throw new Error("Tipo de relatório não reconhecido. Esperado: financeiro, DRE ou ranking de profissionais.");
  }
  if (tipo === "financeiro") return parseFinanceiro(text);
  if (tipo === "dre") return parseDRE(text);
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
  // ranking — pode ter múltiplos meses; chamamos summarize por período fora
  const p = payload.periodos.find(x => x.mes === mesOverride) || payload.periodos[0];
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
