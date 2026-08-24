/**
 * AS TELAS DECLARAM — a garantia que morreu na mudança e volta aqui.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Em 23/08/2026 a Diretoria saiu do Greco Metas e as telas do dono passaram a
 * morar neste repositório. Sete asserções que provavam que a TELA declarava
 * janela, idade, recorte e suposição morreram junto — e eu as reapontei para o
 * servidor, registrando no commit que aquilo era um **ENFRAQUECIMENTO REAL**:
 *
 *   *"agora se prova que o SERVIDOR ENTREGA essas declarações. É necessário e
 *   ⛔ não é suficiente — a tela no outro repositório pode receber tudo e ⛔ não
 *   mostrar nada."*
 *
 * A dívida dizia que a garantia voltava quando o Control tivesse suíte própria.
 * É esta. Aqui se prova o que a TELA FAZ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ AS DUAS LEIS QUE ESTAS TELAS CARREGAM
 *
 * 1. **QUEM EXIBE DECLARA.** Janela, idade do dado, recorte, suposição — tudo
 *    aparece. `[23/08]` o dono abriu o Painel num domingo e disse "o sistema
 *    está travado a tempos", com o dado fresco de sábado na tela. ⛔ "Não rodou
 *    porque a casa está fechada" e "morreu" são IDÊNTICOS vistos de fora.
 *
 * 2. **A TELA ⛔ NÃO CALCULA.** Toda conta mora no Greco Metas, com teste. Copiar
 *    aritmética para cá é a versão 2026 do defeito que matou 23 das 24 telas
 *    antigas: a mesma regra escrita nos dois lados, divergindo em silêncio.
 *
 * Uso: node test/telaDeclara.test.mjs
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

let passou = 0, falhou = 0;
const ok = (nome, cond, detalhe = "") => {
  if (cond) { passou++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}${detalhe ? " — " + detalhe : ""}`); }
};

const painel = ler("client/src/pages/Painel.tsx");
const preco = ler("client/src/pages/OPreco.tsx");
const mes = ler("client/src/pages/OMes.tsx");
const mesa = ler("client/src/pages/AMesa.tsx");
const conselho = ler("client/src/pages/OConselho.tsx");
const operacao = ler("client/src/pages/AOperacao.tsx");
/**
 * ⛔ AS PEÇAS COMPARTILHADAS. Em 23/08 o card de número, o card de gráfico, o
 * chip e a tabela saíram das telas e viraram `components/painel.tsx` — porque
 * estilo aplicado à mão em cinco telas é a mesma regra escrita cinco vezes, e
 * foi por isso que quatro tentativas de "aplicar o padrão" falharam.
 *
 * ⚠️ As garantias mudaram de LUGAR, ⛔ não deixaram de existir. Estas asserções
 * seguiram a garantia — e ficaram MAIS fortes, porque agora exigem também que as
 * telas USEM a peça em vez de reimplementar por baixo.
 */
const pecas = ler("client/src/components/painel.tsx");

/**
 * ⛔ Tira comentário antes de perguntar o que o código FAZ.
 *
 * ⚠️ Regex sobre arquivo cru ⛔ não distingue código de prosa — e estas telas têm
 * cabeçalhos enormes que citam justamente os defeitos que as travas procuram.
 * Sem isto, uma trava acusaria a própria advertência que a explica.
 */
const soCodigo = (txt) =>
  txt
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");

const painelCodigo = soCodigo(painel);
const precoCodigo = soCodigo(preco);
const mesCodigo = soCodigo(mes);
const mesaCodigo = soCodigo(mesa);
const conselhoCodigo = soCodigo(conselho);
const operacaoCodigo = soCodigo(operacao);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. ⛔ O PAINEL DECLARA A IDADE DO DADO");
{
  // O caso de 23/08, e antes dele o de 17/08, que custou uma tarde.
  //
  // ⚠️ ESTA TRAVA JÁ FALHOU EM PROVAR O QUE PROMETIA. A primeira versão só
  //    procurava a string `data.idade` no arquivo — e passou VERDE com um
  //    defeito plantado que trocava `{data.idade && (` por `{false && (`. A
  //    faixa sumia da tela e o teste não via, porque a string sobrevivia dentro
  //    do bloco morto. ⛔ Provar TEXTO ⛔ não é provar COMPORTAMENTO.
  //
  //    Agora se exige a GUARDA de renderização inteira: o JSX só aparece quando
  //    `data.idade` existe. Trocar a condição por `false`, por `0` ou por
  //    qualquer outra coisa quebra o casamento.
  ok("⛔ a faixa de idade é renderizada sob a guarda de `data.idade`",
    /\{data\.idade &&/.test(painelCodigo),
    "número de agenda sem idade ao lado é mentira na tela");
  ok("⛔ e ⛔ não há bloco desligado com `false &&` na tela",
    !/\{\s*false\s*&&/.test(painelCodigo),
    "JSX morto some da tela sem sumir do arquivo");
  ok("   e mostra a frase que o servidor manda", /idade\.frase/.test(painelCodigo));
  ok("⛔ o vermelho depende de `atrasado`, ⛔ não de tempo decorrido",
    /idade\.atrasado/.test(painelCodigo) && !/horas?\s*>\s*\d/.test(painelCodigo),
    "job 2-6 parado no domingo faz 40 horas e está saudável");
}

console.log("\n2. ⛔ O MÊS EM CURSO APARECE — E FICA FORA DA COMPARAÇÃO");
{
  ok("a variação compara só meses FECHADOS",
    /filter\(\(m\) => !m\.emCurso\)/.test(painelCodigo),
    "senão todo dia 2 o painel anuncia um desabamento");
  // ⚠️ A guarda mudou de `emCurso &&` para `regua &&` quando a régua da meta
  //    entrou. A INVARIANTE ⛔ não mudou: o mês em curso tem bloco próprio, é
  //    rotulado como parcial e ⛔ não ganha variação percentual.
  ok("⛔ o mês em curso tem bloco próprio", /\{regua && \(/.test(painelCodigo));
  ok("⛔ e ele é rotulado como parcial", /parcial/.test(painelCodigo));
  ok("⛔ e ⛔ NÃO recebe variação vs mês anterior",
    !/regua[\s\S]{0,900}?vs mês anterior/.test(painelCodigo),
    "agosto com 23 dias contra julho com 31 é uma queda que não existe");
  ok("⛔ a sparkline ⛔ não recebe o mês em curso",
    /meses\.filter\(\(m\) => !m\.emCurso\)\.map/.test(painelCodigo),
    "a tela filtra antes de entregar a série ao card");
}

console.log("\n3. ⛔ O QUE O GRÁFICO ⛔ NÃO PODE INVENTAR");
{
  ok("⛔ o primeiro mês sai do gráfico de cliente novo",
    /filter\(\(m\) => !m\.novoInflado\)/.test(painelCodigo),
    "454 novos e 0 recorrentes é o dado começando, não a casa explodindo");
  ok("⛔ a sparkline ⛔ não interpola buraco — só ponto medido",
    /filter\(\(v\): v is number => v != null\)/.test(pecas),
    "R$/hora só existe desde junho; linha inventada é pior que buraco");
  ok("⛔ variação sem os dois lados devolve null, ⛔ não 0%",
    /a == null \|\| b == null \|\| b === 0\s*\?\s*null/.test(painelCodigo),
    "a conta da variação mora num helper único");
  ok("   e a PEÇA escreve 'sem base' em vez de zero", /sem base p\/ comparar/.test(pecas));
  ok("⛔ a cauda do donut aparece COM contagem", /outros/.test(painelCodigo) && /\{f\.qtd\}/.test(painelCodigo));
  // ⚠️ ESTA ASSERÇÃO ERROU DUAS VEZES, E AS DUAS FORAM O MESMO DESCUIDO:
  //    1. procurou `data\.avisos.*\.map` e ⛔ não casou através do `??` que a
  //       tela usa — `(data.avisos ?? []).map(`;
  //    2. procurou "ver mais" no ARQUIVO CRU e acusou o COMENTÁRIO que explica
  //       que ⛔ não há "ver mais". Instrumento reprovando a própria advertência.
  //    ⛔ A varredura de "o que o código FAZ" usa `painelCodigo`, sempre.
  ok("⛔ e os avisos aparecem TODOS, sem 'ver mais'",
    /data\.avisos\b/.test(painelCodigo) && /\.map\(/.test(painelCodigo)
      && !/ver mais/i.test(painelCodigo));
}

console.log("\n4. ⛔ O PREÇO DECLARA JANELA, IDADE E RECORTE");
{
  ok("⛔ a janela da medição aparece", /casa\.janela/.test(precoCodigo));
  ok("⛔ a idade do catálogo aparece", /catalogoLidoEm/.test(precoCodigo));
  ok("⛔ o recorte é mostrado", /fraseRecorte\(/.test(precoCodigo));
  ok("⛔ e os sem preço são declarados", /sim\.semBase/.test(precoCodigo));
  ok("⛔ preço ausente ⛔ NÃO vira R$ 0,00",
    /function SemPreco/.test(precoCodigo) && /sem preço/.test(preco));
  ok("⛔ a suposição de volume constante está na tela",
    /volume constante/.test(preco) && /elasticidade/i.test(preco));
  ok("⛔ preço recusado pelo servidor é mostrado", /data\.recusados/.test(precoCodigo));
}

console.log("\n4d. ⛔ O QUADRANTE DO PREÇO — a decisão de 01/12 numa olhada");
{
  ok("o quadrante existe", /ScatterChart/.test(precoCodigo));

  // ⛔ EIXO X É O R$/HORA DE TABELA. O realizado carrega as horas do Clube a
  //    zero e absolveria todo serviço — comparar tabela com realizado é a
  //    mistura de populações que publicou R$ 113,98/h em 22/08.
  ok("⛔ o eixo X usa o R$/hora que o servidor já calculou",
    /x: l\.rsHoraAtual/.test(precoCodigo));
  ok("⛔ e a linha de referência é a da CASA, de tabela",
    /ReferenceLine x=\{casa\.rsHoraTabela\}/.test(precoCodigo),
    "sem a referência o gráfico vira nuvem sem veredito");

  // ⛔ EIXO Y É PAGANTE, não atendimento: assinante não responde a reajuste.
  ok("⛔ o eixo Y é pagantes/mês, ⛔ não atendimentos",
    /y: l\.pagantesMes/.test(precoCodigo) && !/y: l\.atend/.test(precoCodigo));

  // ⛔ Sem preço não vira zero no eixo — zero afirmaria "rende nada".
  ok("⛔ serviço sem R$/hora fica FORA do gráfico",
    /rsHoraAtual != null/.test(precoCodigo));

  ok("⛔ a cor vem do veredito do servidor, ⛔ não de conta na tela",
    /l\.acimaDaCasa === false/.test(precoCodigo));
  ok("⛔ e sem animação", /isAnimationActive=\{false\}/.test(precoCodigo));
}

console.log("\n5. ⛔ AS TELAS ⛔ NÃO CALCULAM — toda conta mora no Metas");
{
  // ⚠️ A invariante é sobre ARITMÉTICA DE NEGÓCIO, ⛔ não sobre todo operador:
  //    somar índice de array ou multiplicar por 100 para virar % de barra é
  //    layout. O que ⛔ não pode é a tela refazer o que o servidor já respondeu.
  const proibido = [
    [/pagantesMes\s*\*/, "ganho = pagantes × delta"],
    [/\*\s*60\s*\/\s*\w*[Dd]uracao/, "R$/hora"],
    [/clubePagaMes\s*-/, "margem do Clube"],
    [/\/\s*assinantes/, "mensalidade média"],
    [/oficial\.total\s*\/\s*\w*[Aa]tendimentos/, "ticket cruzando populações"],
  ];
  for (const [re, oQue] of proibido) {
    ok(`⛔ nenhuma tela recalcula ${oQue}`, !re.test(painelCodigo) && !re.test(precoCodigo));
  }

  ok("⛔ o Preço recebe a simulação PRONTA do servidor",
    /data\??\.?\.?simulacao/.test(precoCodigo) || /data\?\.simulacao/.test(precoCodigo));

  // ⛔ E O DEFEITO REPLANTADO: a trava tem que pegar a conta se ela voltar.
  ok("⛔ e a trava pega o defeito replantado",
    /pagantesMes\s*\*/.test("const ganho = l.pagantesMes * delta;"));
}

console.log("\n3b. ⛔ A RÉGUA DA META — projeção ⛔ NUNCA se confunde com medição");
{
  ok("⛔ a tela mostra a meta ao lado do realizado", /regua\.metaMes/.test(painelCodigo));
  ok("⛔ e a barra só fica verde quando BATEU", /pctDaMeta >= 100 \? CORES\.verde/.test(painelCodigo));
  ok("⛔ a projeção é rotulada como projeção", /projeção do mês/.test(painelCodigo));
  ok("⛔ e vem com a PREMISSA escrita", /regua\.premissa/.test(painelCodigo));
  ok("⛔ e diz explicitamente que ⛔ não é medição",
    /Projeção, ⛔ não medição/.test(painelCodigo),
    "número estimado com cara de apurado é a família de defeito da casa");
  ok("⛔ o que falta por dia é PONDERADO pelo servidor, ⛔ não dividido na tela",
    /regua\.precisaPorDia/.test(painelCodigo) && !/falta\s*\/\s*dias/.test(painelCodigo),
    "sábado não vale o mesmo que terça");
}

console.log("\n4b. ⛔ A CASCATA DO MÊS — montagem, ⛔ nunca cálculo");
{
  ok("a cascata existe", /const cascata =/.test(mesCodigo));
  // ⛔ O TOTAL VEM DO SERVIDOR. Se a tela somasse receita menos custos para achar
  //    o resultado, viraria a segunda fonte de verdade — e um dia discordaria do
  //    DRE ao lado sem ninguém saber qual está certo.
  ok("⛔ o resultado vem do servidor, ⛔ ⛔ NÃO da soma da tela",
    /const resultado = Number\(f\.resultado\)/.test(mesCodigo));
  ok("⛔ e a tela ⛔ não recalcula margem nem ponto de equilíbrio",
    !/margemContribuicao\s*=/.test(mesCodigo) && !/pontoEquilibrio\s*=/.test(mesCodigo));

  // ⚠️ A base transparente é o degrau. Sem ela a cascata vira barras soltas.
  ok("⛔ a base da cascata é invisível", /fill="transparent"/.test(mesCodigo));

  // ⛔ Chip que aparece sempre ⛔ não informa — o olho aprende a pular.
  ok("⛔ o selo dos juros só aparece com peso alto", /pesoJuros >= 25/.test(mesCodigo));
  ok("   e o peso é medido contra o resultado", /juros \/ res/.test(mesCodigo));

  ok("⛔ sem animação, como o resto do sistema",
    (mesCodigo.match(/isAnimationActive=\{false\}/g) || []).length >= 2);
  ok("⛔ e usa as peças do sistema", /from "@\/components\/painel"/.test(mesCodigo));
}

console.log("\n4c. ⛔ A MESA PROPÕE — e proposta ⛔ NUNCA vira decisão sozinha");
{
  ok("as oportunidades aparecem", /oportunidades\.map/.test(mesaCodigo));

  // ⛔ A REGRA QUE A PRÓPRIA TELA ANUNCIA: decisão sem número é intenção, e
  //    intenção não entra. Foi ela que impediu de registrar o reajuste de 01/12.
  ok("⛔ a tela diz que proposta ⛔ NÃO é decisão", /⛔ não é decisão/.test(mesa));
  ok("⛔ e ⛔ NÃO há caminho de criar decisão a partir da proposta",
    !/criarDecisao|POST.*decisoes|salvarDecisao/i.test(mesaCodigo),
    "decisão nasce quando o dono decide, nunca por sugestão aceita em um clique");

  // ⛔ Proposta sem premissa é palpite com aparência de apuração.
  ok("⛔ cada proposta mostra DE ONDE saiu", /o\.fonte/.test(mesaCodigo));
  ok("⛔ e mostra a PREMISSA", /o\.premissa/.test(mesaCodigo));
  ok("   e o que falta para virar decisão", /o\.paraVirarDecisao/.test(mesaCodigo));

  // ⛔ Nem toda proposta é aposta de dinheiro — a de catálogo é buraco de dado.
  ok("⛔ esperado zero ⛔ não vira R$ 0,00", /o\.esperado > 0 &&/.test(mesaCodigo));

  ok("⛔ e a tela ⛔ não calcula o esperado", !/pagantesMes|rsHora\(/.test(mesaCodigo));
}

console.log("\n5b. ⛔ AS TELAS USAM AS PEÇAS — ninguém reimplementa por baixo");
{
  ok("o Painel importa o sistema de design",
    /from "@\/components\/painel"/.test(painelCodigo));
  ok("⛔ e ⛔ NÃO tem card de número próprio",
    !/function Kpi\(/.test(painelCodigo) && !/function Campo\(/.test(painelCodigo),
    "estilo à mão em cinco telas diverge como regra duplicada diverge");
  ok("⛔ nem card de gráfico próprio", !/function Bloco\(/.test(painelCodigo));
  ok("⛔ nem tooltip próprio", !/const tooltip = \{/.test(painelCodigo));

  // ⛔ A marca é a marca. Hex solto numa tela é como a paleta começa a divergir.
  ok("⛔ a paleta vem do sistema, ⛔ não de hex solto",
    /CORES\.marca/.test(painelCodigo) && !/"#A50101"/.test(painelCodigo));
  ok("   e a peça guarda a marca da casa", /marca: "#A50101"/.test(pecas));

  // O item das referências que faltava em TODAS as minhas telas.
  ok("⛔ existe barra de ferramentas no card de gráfico", /ferramentas/.test(pecas));
  ok("   e o Painel usa pelo menos uma", /<BotaoFerramenta/.test(painelCodigo));

  // ⛔ Sem animação: gráfico que às vezes não pinta é pior que sem animação.
  ok("⛔ a sparkline da peça ⛔ não depende de animação",
    /isAnimationActive=\{false\}/.test(pecas));
}

console.log("\n6. ⛔ PONTE CAÍDA VIRA AVISO, ⛔ NUNCA R$ 0,00");
{
  // ⛔ A peça `NaoAbriu` é a única forma de mostrar falha de ponte — e ela já
  //    carrega o "nada foi estimado". Cada tela só precisa usá-la.
  ok("⛔ a peça de erro existe e diz que nada foi estimado",
    /export function NaoAbriu/.test(pecas) && /Nada foi estimado/.test(pecas));
  ok("⛔ e o Painel usa a peça", /<NaoAbriu/.test(painelCodigo));
  ok("⛔ o Preço tem estado de erro nomeado", /não abriu/.test(preco));
  ok("   e diz que nada foi estimado", /Nada foi estimado/.test(preco));
}

console.log("\n4e. ⛔ A MEMÓRIA DO CONSELHO — parecer velho DIZ que é velho");
{
  ok("o histórico é lido", /conselho\/historico/.test(conselhoCodigo));

  // ⛔ A GARANTIA CENTRAL DESTA TELA. Reabrir um parecer de duas semanas atrás
  //    sem dizer a data é a mesma doença do painel sem carimbo de atualização —
  //    e aqui é pior, porque parecer TEM cara de conclusão, não de medição.
  ok("⛔ sessão reaberta se declara GRAVADA",
    /sessao\?\.gravadaEm &&/.test(conselhoCodigo) && /gravadaEm: h\.criadoEm/.test(conselhoCodigo),
    "parecer antigo lido como de hoje decide com número de outro dia");
  ok("⛔ e mostra a data da reunião, ⛔ não a de hoje",
    /new Date\(sessao\.gravadaEm\)/.test(conselhoCodigo) && !/new Date\(\)\.toLocale/.test(conselhoCodigo));
  ok("   com o fuso da casa declarado",
    /timeZone: "America\/Sao_Paulo"/.test(conselhoCodigo),
    "created_at é UTC; sem fuso, a sessão da noite aparece no dia seguinte");

  // ⛔ Reabrir é LEITURA DE REGISTRO. Se reabrir disparasse a reunião de novo,
  //    a memória viraria o oposto do que existe para ser: duas respostas para a
  //    mesma pergunta, com o dado tendo andado no meio.
  //
  // ⚠️ AMARRADO AO CORPO DE `reabrir`, ⛔ não a uma janela de N caracteres. A
  //    primeira versão desta trava varria 400 chars depois de `const reabrir` e
  //    acusava o `reunir.mutate` da função SEGUINTE — regex sem escopo acusando
  //    código correto, que é a mesma armadilha que o `soCodigo` acima resolve.
  const corpoReabrir = (() => {
    const i = conselhoCodigo.indexOf("const reabrir");
    return i < 0 ? "" : conselhoCodigo.slice(i, conselhoCodigo.indexOf("\n  };", i));
  })();
  ok("⛔ reabrir ⛔ NÃO chama a IA de novo",
    /setSessao/.test(corpoReabrir) && !/reunir\.mutate|fetch\(/.test(corpoReabrir),
    "reabrir que reúne de novo devolve resposta diferente para a mesma pergunta");

  // ⛔ Histórico vazio ⛔ não vira caixa vazia prometendo conteúdo.
  ok("⛔ lista vazia esconde a seção", /historico\.data\?\.length \?\? 0\) > 0/.test(conselhoCodigo));

  // ⛔ A tela ⛔ não resume o parecer: o produto é a DISCORDÂNCIA, e resumo de
  //    quatro lentes é a pior das quatro.
  ok("⛔ o placar mostra os três lados", /ap\.aFavor/.test(conselhoCodigo) && /ap\.contra/.test(conselhoCodigo)
    && /ap\.depende/.test(conselhoCodigo));

  // ⚠️ COMPARAR ⛔ NÃO É CALCULAR. A primeira versão procurava `posicaoDaMesa =`
  //    e acusava o `posicaoDaMesa === "dividido"` que a tela usa para ESCOLHER O
  //    RÓTULO — código certo, condenado por um `=` a mais no regex.
  ok("⛔ e a tela ⛔ não apura nada",
    !/(posicaoDaMesa|aFavor|contra|depende)\s*=[^=]/.test(conselhoCodigo)
      && !/filter\([^)]*a_favor/.test(conselhoCodigo),
    "a apuração vem pronta do Metas — refazê-la aqui daria dois placares");

  ok("usa a peça do sistema", /<Chip/.test(conselhoCodigo));
}

console.log("\n4f. ⛔ A OPERAÇÃO — piso é piso, e ausência ⛔ não vira zero");
{
  // ⛔ O CARIMBO VIAJA COM O DADO. Escrito à mão na tela, alguém o apaga sem
  //    perceber que apagou uma garantia; vindo no retorno, ⛔ não se separa do
  //    número. É a diferença entre aviso e propriedade do dado.
  ok("⛔ o aviso de PISO vem do servidor, ⛔ não é digitado na tela",
    /d\.piso/.test(operacaoCodigo) && !/subconta o faturamento oficial/.test(operacaoCodigo),
    "aviso digitado na tela some numa refatoração e o número continua parecendo caixa");

  // ⛔ AUSÊNCIA ⛔ NÃO É ZERO. Categoria sem duração medida ⛔ não "rende R$ 0/h" —
  //    ⛔ não se sabe quanto ela rende, e as duas coisas ⛔ não são a mesma.
  ok("⛔ valor nulo vira travessão, ⛔ nunca R$ 0",
    /brlOuTraco/.test(operacaoCodigo) && /n == null \? "—"/.test(operacaoCodigo));
  ok("⛔ e quem ⛔ não tem hora medida fica FORA da comparação",
    /rsHora != null/.test(operacaoCodigo),
    "misturar quem não tem duração puxa a régua de R$/hora para baixo sem ninguém ver");

  // ⛔ A TELA ⛔ NÃO CALCULA. Toda conta mora no Metas — a régua de R$/hora, a
  //    porcentagem da casa, o ticket. Refazer aqui daria dois números.
  ok("⛔ a tela ⛔ não divide caixa por hora",
    !/caixa\s*\/\s*hora|\/\s*60|minutos\s*\//.test(operacaoCodigo));
  ok("⛔ nem soma o caixa para achar a porcentagem",
    !/reduce\(\(.*caixa/.test(operacaoCodigo) && /pctDaCasa/.test(operacaoCodigo));

  // ⛔ RECORTE DECLARADO (Armadilha 10): o top 25 diz quantos ficaram fora.
  ok("⛔ o corte da lista de clientes é declarado",
    /clientes\?\.fora > 0/.test(operacaoCodigo) && /d\.clientes\.total/.test(operacaoCodigo),
    "top-N silencioso lê-se como 'só existem 25 clientes'");

  // ⚠️ DADO SUJO APARECE. A régua junta as grafias para o ranking não mentir,
  //    mas quem corrige a Trinks é o dono — e ele só corrige o que enxerga.
  ok("⚠️ nome duplicado de profissional é MOSTRADO",
    /nomesDuplicados\?\.length \?\? 0\) > 0/.test(operacaoCodigo) && /n\.grafias\.join/.test(operacaoCodigo));
  ok("   e a linha do ranking marca quantas grafias juntou", /b\.grafias > 1/.test(operacaoCodigo));

  // ⛔ Variação só quando HÁ os dois lados — senão quem entrou em março aparece
  //    com queda de 100% contra um mês em que ⛔ não trabalhava.
  ok("⛔ subida/queda exige os DOIS meses",
    /temDois = b\.atendPrimeiroMes > 0 && b\.atendUltimoMes > 0/.test(operacaoCodigo));
  ok("   e o ticket diz quando ⛔ não tem os dois", /sem os dois meses/.test(operacaoCodigo));

  ok("⛔ ponte caída vira aviso, ⛔ não zero", /<NaoAbriu/.test(operacaoCodigo));
  ok("usa as peças do sistema",
    /<CardNumero/.test(operacaoCodigo) && /<CardGrafico/.test(operacaoCodigo)
      && /<Tabela/.test(operacaoCodigo) && /<Avisos/.test(operacaoCodigo));
  ok("⛔ e ⛔ não reimplementa card por baixo", !/rounded-\[18px\] border border-white\/10 bg-white/.test(operacaoCodigo));
  ok("⛔ gráfico sem animação", /isAnimationActive=\{false\}/.test(operacaoCodigo));
  ok("está no menu", /path: "\/operacao"/.test(ler("client/src/components/AppLayout.tsx")));

  // ═══ O PAPEL — e por que ele é dinheiro, ⛔ não enfeite ═══════════════════
  //
  // ⛔ A apuração de comissão faz `rate || 0`: quem ⛔ não tem linha em
  //    `commission_rates` tem a comissão calculada como ZERO, calado. A produção
  //    aparece certa na folha e a comissão errada — o pior formato de defeito,
  //    porque a linha existe e parece conferida.
  ok("⛔ quem atende sem cadastro de comissão é ACUSADO",
    /semPapel\?\.length \?\? 0\) > 0/.test(operacaoCodigo) && /d\.semPapel\.map/.test(operacaoCodigo),
    "sem cadastro a comissão sai zero e nada avisa");
  ok("   e a acusação mostra a PRODUÇÃO em jogo", /p\.producao/.test(operacaoCodigo));

  // ⛔ Célula vazia lê-se como "ainda ⛔ não carregou". O que há é cadastro
  //    faltando, e isso tem nome.
  //
  // ⚠️ AMARRADA AO CHIP DA CÉLULA, ⛔ não à string solta. A primeira versão
  //    procurava "sem cadastro" em qualquer lugar do arquivo — e o card do topo
  //    tem a MESMA string (`papel ?? "sem cadastro"`). Apagando o chip da
  //    tabela, a trava continuava verde pela string do card: passava por
  //    ACIDENTE, ⛔ não por estar certa. Provado plantando o defeito.
  ok("⛔ papel ausente vira 'sem cadastro', ⛔ não célula vazia",
    /b\.papel \?/.test(operacaoCodigo)
      && /<Chip tom="ruim">sem cadastro<\/Chip>/.test(operacaoCodigo),
    "célula vazia lê-se como 'ainda não carregou'; o que há é cadastro faltando");

  // ⚠️ A LISTA ⛔ NÃO É DE BARBEIROS. Chamar assistente e recepção de "barbeiro"
  //    e ordenar todos pelo caixa compara papéis diferentes com a mesma régua.
  ok("⚠️ a tela declara que a lista mistura papéis",
    /barbeiro, assistente e recep/.test(operacao),
    "ranking que soma papéis diferentes sem dizer compara o incomparável");
  ok("⛔ e a coluna ⛔ não se chama 'barbeiro'",
    /\{ nome: "profissional" \}/.test(operacaoCodigo) && !/\{ nome: "barbeiro" \}/.test(operacaoCodigo));
}

console.log(`\n${passou} passaram · ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
