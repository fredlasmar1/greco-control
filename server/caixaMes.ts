/**
 * SAIU DO CAIXA NO MÊS — fonte única do gasto real.
 *
 * O gasto da barbearia estava partido em três gavetas que ninguém somava, e o
 * dono só enxergava a primeira:
 *
 *   1. compras:YYYY-MM ............ fornecedor, boleto, insumo (aba Compras)
 *   2. folha_pagamentos:YYYY-MM ... comissão do mês fechado, PAGA no mês seguinte
 *   3. pagamentos[YYYY-MM].vale ... vale do dia 15
 *   4. fatura de cartão ........... compras com `dataPagamentoFatura` no mês —
 *      o gasto no crédito só sai do caixa quando a fatura é paga (faturaCartao.ts)
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
import { listarCompras, CATEGORIA_TRANSFERENCIA, type Compra } from "./compras";
import { type PagamentoFolhaItem, type PagamentoMes } from "./pagamentos";

/** Categoria de compra que representa pagamento a pessoal (vive na folha). */
export const CATEGORIA_PESSOAL = "Salários & Equipe";

export interface ItemCaixa {
  data: string;      // YYYY-MM-DD em que o dinheiro saiu
  valor: number;
  descricao: string;
  categoria?: string;
  /**
   * ⛔ QUEM E' O LANCAMENTO -- so' para compras e fatura (folha e vale ⛔ nao
   * sao compras e ⛔ nao se editam por aqui).
   *
   * Existe porque o dono pediu para classificar cada compra a partir do painel
   * de gasto: sem `id` + `mes` (o balde em que a compra mora, que ⛔ NAO e' o
   * mes em que o dinheiro saiu -- a fatura paga em agosto guarda compra de
   * julho), a tela mostra o valor e ⛔ nao consegue mexer nele.
   */
  id?: string;
  mes?: string;
  /**
   * ⛔ O QUE O GRUPO DO TELEGRAM JA' SABE E A TELA ⛔ NAO MOSTRAVA.
   *
   * ⚠️ `[31/08/2026]` o dono: *"ja' existe as categorias, a data e imagem do
   * pagamento. Unica coisa que voce ⛔ nao construiu foi essa conciliacao e fica
   * inventando dados. Use os dados de la'."* Ele estava certo: o bot registra
   * comprovante, quem mandou, e o CNPJ do pagador e do recebedor -- e nada
   * disso atravessava a ponte para o Metas, que exibia so' data e valor.
   *
   * ⛔ `docPagador` e `docRecebedor` sao o que permite CONCILIAR com o extrato:
   * dizem de qual conta saiu e para quem foi. Sem eles, conciliar e' casar
   * valor com valor -- e dois PIX de R$ 500 no mesmo dia viram um.
   */
  origem?: string;
  quemMandou?: string;
  temFoto?: boolean;
  fileId?: string;
  docPagador?: string;
  docRecebedor?: string;
  /** pix · compra · boleto · dinheiro — como o dinheiro saiu. */
  formaPagamento?: string;
}

export interface BlocoCaixa {
  chave: "compras" | "folha" | "vales" | "cartao";
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

export interface ResultadoMes {
  mes: string;
  entrou: number;                  // faturamento OFICIAL (inclui Clube e produtos)
  entrouFonte: "oficial-trinks" | "snapshots";
  entrouAtualizadoEm: string | null;
  saiu: number;                    // saídas de caixa (as três gavetas)
  sobrou: number;                  // entrou − saiu
  margemPct: number;
  saidas: SaidasCaixaMes;
  /** Motivos para NÃO confiar no "sobrou". Vazio = número pode ser anunciado. */
  avisos: string[];
  confiavel: boolean;
}

/**
 * Entrou × saiu × sobrou do mês — o único lugar que responde "deu lucro?".
 *
 * O faturamento vem de `trinks_total_mes:<mes>` (o "Total do Mês" do e-mail
 * Trinks, gravado pelo cron das 7h): é a AUTORIDADE porque inclui Clube Greco e
 * venda de produtos. Somar snapshot diário NÃO serve — o snapshot vem da agenda
 * e ignora tudo que não é atendimento agendado. Em julho/2026 a soma dos
 * snapshots dava R$ 79.515,50 contra R$ 87.327,95 oficiais: R$ 7.812,45 de
 * faturamento invisível, e era o número menor que ia para o Telegram.
 *
 * Só cai na soma de snapshots quando o oficial ainda não existe (mês novo, antes
 * do primeiro e-mail) — e nesse caso `entrouFonte` avisa que é estimativa.
 */
export async function calcularResultadoMes(
  mes: string,
  somarSnapshots?: (mes: string) => Promise<number>,
): Promise<ResultadoMes> {
  const oficial = await kvGet<{ total: number; atualizadoEm: string }>(`trinks_total_mes:${mes}`);
  let entrou = num(oficial?.total);
  let entrouFonte: ResultadoMes["entrouFonte"] = "oficial-trinks";
  if (!(entrou > 0)) {
    entrou = somarSnapshots ? num(await somarSnapshots(mes).catch(() => 0)) : 0;
    entrouFonte = "snapshots";
  }
  const saidas = await calcularSaidasCaixa(mes);
  const sobrou = entrou - saidas.total;

  // "Sobrou" só vale quando os dois lados existem. Junho/2026 é o caso didático:
  // o grupo de comprovantes só nasceu em 03/07, então junho tem faturamento e
  // zero gasto — a conta crua diz "margem de 100%", que é mentira perigosa.
  const avisos: string[] = [];
  if (entrou <= 0) avisos.push("sem faturamento registrado neste mês");
  if (saidas.total <= 0) avisos.push("nenhum gasto registrado neste mês — a sobra não é real");
  else if (saidas.blocos.find(b => b.chave === "folha")!.total <= 0)
    avisos.push("nenhuma folha paga registrada — falta a maior despesa da casa");
  if (entrouFonte === "snapshots")
    avisos.push("faturamento estimado pela agenda (sem o total oficial da Trinks) — subconta Clube e produtos");

  return {
    mes,
    entrou,
    entrouFonte,
    entrouAtualizadoEm: oficial?.atualizadoEm || null,
    saiu: saidas.total,
    sobrou,
    margemPct: entrou > 0 ? (sobrou / entrou) * 100 : 0,
    saidas,
    avisos,
    confiavel: avisos.length === 0,
  };
}

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
  /* ⛔ As compras que SÃO pagamento a pessoal — a fonte com comprovante. */
  const itensPessoalDaCompra: ItemCaixa[] = [];
  for (const c of compras) {
    const valor = num(c.valor);
    if (valor <= 0) continue;
    // Compra no CRÉDITO ainda não saiu do caixa: sai quando a fatura é paga, e a
    // fatura entra pela tela de importação (linha a linha, conferida). Contar as
    // duas pontas dobraria — foi o risco que apareceu com a Ecoville de 29/07.
    if (c.aguardandoFatura === true) {
      excluidos.push({
        motivo: "no crédito — entra quando a fatura for importada",
        valor,
        descricao: `${c.data} ${c.loja || c.descricao || ""}`.trim(),
      });
      continue;
    }
    // Já tem fatura paga: o dinheiro saiu na data DELA (pode ser outro mês), então
    // esta compra é contada no bloco "Fatura de cartão", nunca aqui.
    if (c.dataPagamentoFatura) continue;
    if (String(c.categoria) === CATEGORIA_PESSOAL) {
      /*
        ⛔ A COMPRA É A FONTE; O LEDGER É CÓPIA (31/08/2026, desenho do dono):
        *"o correto seria: definimos os valores em Compras, e a parte de vales
        iria para os Descontos SEM PODER DE EDIÇÃO, somente como organização
        para somar. Então não deveria superestimar, e sim só REPLICAR em outras
        abas os valores que preciso."*

        ⚠️ Ele descreveu o defeito e a cura. `[medido 31/08]` as 29 compras de
        pessoal somam **R$ 40.550,88** e o ledger soma **R$ 44.182,42** — os
        R$ 3.631,54 de diferença são o mesmo PIX gravado duas vezes (Larissa e
        Andreia). **26 das 29 compras têm par no ledger.**

        ⛔ A COMPRA GANHA porque ela tem PROVA: veio do grupo com comprovante,
        CNPJ do recebedor e a data em que o dinheiro saiu. O ledger é digitado.
        Quando os dois descrevem o mesmo pagamento, contar o ledger é contar a
        cópia e ignorar o original.

        ⚠️ Mas o ledger ⛔ NÃO some: ele guarda o que ⛔ não passou pelo grupo
        (3 dos 29 em agosto). Por isso a exclusão aqui deixou de ser cega — ela
        marca a compra como PAR, e a folha/vale só conta o que ⛔ não tem par.
      */
      itensPessoalDaCompra.push({
        data: String(c.data || ""), valor,
        descricao: `${c.loja || c.descricao || "—"}`,
        categoria: CATEGORIA_PESSOAL,
        id: String((c as any).id || ""), mes,
      });
      excluidos.push({
        motivo: "pagamento a pessoal — contado uma vez, pela compra (tem comprovante)",
        valor,
        descricao: `${c.data} ${c.loja || c.descricao || ""}`.trim(),
      });
      continue;
    }
    if (String(c.categoria) === CATEGORIA_TRANSFERENCIA) {
      // Trava (c): o dinheiro trocou de banco dentro da empresa. Não saiu.
      excluidos.push({
        motivo: "transferência entre contas próprias — o dinheiro não saiu da empresa",
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
      id: String((c as any).id || ""),
      mes,
      /* ⛔ O QUE VEIO DO GRUPO ATRAVESSA A PONTE. Ate' 31/08 a tela do Metas
         recebia so' data e valor, e por isso o dono via um card mudo enquanto o
         Telegram tinha comprovante, autor e os documentos das duas pontas. */
      origem: String((c as any).origem || ""),
      quemMandou: (c as any).telegramFrom ? String((c as any).telegramFrom) : undefined,
      temFoto: (c as any).temFoto === true,
      fileId: (c as any).telegramFileId ? String((c as any).telegramFileId) : undefined,
      docPagador: (c as any).docPagador ? String((c as any).docPagador) : undefined,
      docRecebedor: (c as any).docRecebedor ? String((c as any).docRecebedor) : undefined,
      formaPagamento: (c as any).tipo ? String((c as any).tipo) : undefined,
    });
  }

  /*
    ⛔ TEM PAR NA COMPRA? — a régua que impede a dobra.

    ⚠️ Casa por DATA + VALOR ao centavo, ⛔ nao por nome: o histórico da compra
    é o que o Telegram escreveu ("PIX para LARISSA COSTA PACHECO") e o do ledger
    é montado ("LARISSA COSTA — comissão 2026-07"). Casar por nome erraria nos
    dois sentidos; data + valor é o que o banco também usa.

    ⛔ E CADA COMPRA CASA UMA VEZ SÓ. Sem isso, dois vales legítimos de R$ 500
    no mesmo dia casariam com a MESMA compra e um deles sumiria do caixa — o
    erro oposto, e pior, porque esconde dinheiro que saiu.
  */
  const comprasPessoalLivres = itensPessoalDaCompra.slice();
  const temParNaCompra = (data: string, valor: number): boolean => {
    const i = comprasPessoalLivres.findIndex(
      (x) => String(x.data) === String(data) && Math.abs(num(x.valor) - num(valor)) < 0.01
    );
    if (i < 0) return false;
    comprasPessoalLivres.splice(i, 1);
    return true;
  };

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
      /* ⛔ Já contado pela COMPRA (que tem comprovante): ⛔ não conta de novo. */
      if (temParNaCompra(data, valor)) {
        excluidos.push({
          motivo: "comissão que já entrou pela compra do grupo — contada uma vez",
          valor,
          descricao: `${data} ${item.nome || "—"}`,
        });
        continue;
      }
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

    /*
      ⛔ O VALE É UM ACUMULADO, e a DATA de cada pagamento só existe dentro da
      nota ("15/08/2026 R$ 650,00 · 17/08/2026 R$ 650,00"). Para saber o que já
      entrou pela compra, é preciso abrir a nota parte por parte — comparar o
      TOTAL com uma compra nunca casaria, e foi assim que a dobra passou.
    */
    const nota = String(p?.valeNota || "");
    const re = /(\d{2})\/(\d{2})\/(\d{4})\s+R\$\s*([\d.]+,\d{2})/g;
    const partes: Array<{ data: string; valor: number }> = [];
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(nota))) {
      const v = Number(mm[4].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(v)) partes.push({ data: `${mm[3]}-${mm[2]}-${mm[1]}`, valor: v });
    }
    const somaPartes = Math.round(partes.reduce((a, x) => a + x.valor, 0) * 100) / 100;

    /* ⛔ Só usa as partes quando elas FECHAM com o total: nota incompleta ⛔ não
       pode reduzir o que a pessoa recebeu. */
    if (partes.length && Math.abs(somaPartes - vale) < 0.01) {
      for (const parte of partes) {
        if (temParNaCompra(parte.data, parte.valor)) {
          excluidos.push({
            motivo: "vale que já entrou pela compra do grupo — contado uma vez",
            valor: parte.valor,
            descricao: `${parte.data} prof ${p?.profissionalId}`,
          });
          continue;
        }
        itensVales.push({
          data: parte.data, valor: parte.valor,
          descricao: String(p?.valeNota || `vale — prof ${p?.profissionalId}`),
          categoria: CATEGORIA_PESSOAL,
        });
      }
      continue;
    }

    itensVales.push({
      data: `${mes}-15`, // vale é do dia 15; a data exata vive na nota
      valor: vale,
      descricao: String(p?.valeNota || `vale — prof ${p?.profissionalId}`),
      categoria: CATEGORIA_PESSOAL,
    });
  }

  // ── 4) FATURA DE CARTÃO (regime de caixa) ───────────────────────────────────
  // A compra no crédito de julho só vira dinheiro que saiu quando a fatura de
  // agosto é paga. Cada compra ligada a uma fatura carrega `dataPagamentoFatura`
  // — é por ela que a linha entra no mês, venha do bucket que vier (parcela
  // antiga inclusive). Mesmo padrão da folha: varre as chaves, filtra pela data
  // em que o dinheiro saiu.
  const itensCartao: ItemCaixa[] = [];
  const chavesCompras = await kvKeysComPrefixo("compras:");
  for (const chave of chavesCompras) {
    const lista = (await kvGet<Compra[]>(chave)) || [];
    if (!Array.isArray(lista)) continue;
    for (const c of lista) {
      const pago = String(c?.dataPagamentoFatura || "");
      const valor = num(c?.valor);
      if (!pago.startsWith(mes) || valor <= 0) continue;
      if (String(c.categoria) === CATEGORIA_PESSOAL) {
        excluidos.push({
          motivo: "pagamento a pessoal — já contado na folha/vale",
          valor,
          descricao: `${c.data} ${c.loja || c.descricao || ""}`.trim(),
        });
        continue;
      }
      if (String(c.categoria) === CATEGORIA_TRANSFERENCIA) {
        excluidos.push({
          motivo: "transferência entre contas próprias — o dinheiro não saiu da empresa",
          valor,
          descricao: `${c.data} ${c.loja || c.descricao || ""}`.trim(),
        });
        continue;
      }
      itensCartao.push({
        data: pago,
        valor,
        descricao: `${c.loja || c.descricao || "—"}${c.cartao ? ` — ${c.cartao}` : ""} (compra ${c.data})`,
        categoria: String(c.categoria || "Outros"),
        id: String((c as any).id || ""),
        /* ⛔ O BALDE EM QUE ELA MORA, ⛔ nao o mes do pagamento: a fatura paga
           em agosto carrega compra de julho, e editar em `compras:2026-08`
           ⛔ nao acharia a linha. */
        mes: String(chave.split(":")[1] || ""),
      });
    }
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
    /*
      ⛔ A FOLHA SOMA AS COMPRAS DE PESSOAL **MAIS** O QUE ⛔ NÃO TEM PAR.
      ⚠️ Antes ela somava só o ledger e a compra era excluída — e quando os dois
      descreviam o mesmo PIX, contava a CÓPIA e ignorava o original. Agora conta
      o original (que tem comprovante) e o ledger só entra onde ⛔ não há compra.
      A soma dos dois é a mesma de sempre quando ⛔ não há dobra; onde há, ela
      cai para o valor certo.
    */
    bloco("folha", "Folha paga no mês", [...itensPessoalDaCompra, ...itensFolha]),
    bloco("vales", "Vales do dia 15", itensVales),
    bloco("cartao", "Fatura de cartão paga no mês", itensCartao),
  ];

  return {
    mes,
    total: blocos.reduce((s, b) => s + b.total, 0),
    blocos,
    excluidos,
    totalExcluido: excluidos.reduce((s, e) => s + e.valor, 0),
  };
}
