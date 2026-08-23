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
  ok("⛔ o mês em curso tem bloco próprio", /emCurso &&/.test(painelCodigo));
  ok("⛔ e ele é rotulado como parcial", /parcial/.test(painel));
  ok("⛔ a sparkline ⛔ não usa mês em curso", /!m\.emCurso && ler\(m\) != null/.test(painelCodigo));
}

console.log("\n3. ⛔ O QUE O GRÁFICO ⛔ NÃO PODE INVENTAR");
{
  ok("⛔ o primeiro mês sai do gráfico de cliente novo",
    /filter\(\(m\) => !m\.novoInflado\)/.test(painelCodigo),
    "454 novos e 0 recorrentes é o dado começando, não a casa explodindo");
  ok("⛔ a sparkline ⛔ não interpola buraco — só ponto medido",
    /ler\(m\) != null/.test(painelCodigo),
    "R$/hora só existe desde junho; linha inventada é pior que buraco");
  ok("⛔ variação sem os dois lados devolve null, ⛔ não 0%",
    /anterior == null \|\| anterior === 0\s*\?\s*null/.test(painelCodigo));
  ok("   e a tela diz 'sem base' em vez de mostrar zero", /sem base p\/ comparar/.test(painel));
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

console.log("\n6. ⛔ PONTE CAÍDA VIRA AVISO, ⛔ NUNCA R$ 0,00");
{
  for (const [nome, tela] of [["Painel", painel], ["O Preço", preco]]) {
    ok(`⛔ o ${nome} tem estado de erro nomeado`, /não abriu/.test(tela));
    ok(`   e o ${nome} diz que nada foi estimado`, /Nada foi estimado/.test(tela));
  }
}

console.log(`\n${passou} passaram · ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
