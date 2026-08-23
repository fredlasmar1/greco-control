/**
 * O PORTÃO DE /api — as invariantes que não podem cair.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ O QUE ACONTECEU EM 23/08/2026
 *
 * As 284 rotas `/api` do Control respondiam a QUALQUER UM na internet. Medido de
 * fora, sem cookie, sem token e sem header:
 *
 *   GET  /api/mesa                 → 200 ·  5.375 bytes  as decisões do dono
 *   GET  /api/mesa/mes/2026-07     → 200 · 16.834 bytes  o DRE inteiro
 *   POST /api/mesa/precos          → 200 · 13.000 bytes  régua de preço e Clube
 *   GET  /api/assinaturas/clientes → 200 · 96.749 bytes  a base do Clube com comissões
 *
 * A tela de login existia e funcionava — e protegia o FRONT-END e mais nada.
 *
 * ⚠️ E `/api/mesa/precos`, subida no dia anterior, NASCEU aberta: herdou o
 * padrão das vizinhas. Ninguém percebeu, nem quem a escreveu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ AS DUAS MANEIRAS DE ISTO VOLTAR — e é contra elas que este arquivo existe
 *
 * 1. **Alguém remove o portão** (ou o move para depois das rotas, que é o mesmo
 *    que remover, porque o Express casa middleware na ordem de registro).
 * 2. **A lista de exceção cresce.** Cada rota nova "que só precisa ficar aberta
 *    um instante" é um furo permanente. Aqui ela tem TETO e cada entrada precisa
 *    de motivo escrito.
 *
 * ⚠️ E há um terceiro, que é o oposto e igualmente fatal: **fechar demais**.
 * Fechar o healthcheck faz o Railway reiniciar o serviço em laço até desistir —
 * o Control sai do ar sozinho, por causa da própria proteção. Por isso a trava
 * lê o `railway.toml` e exige que o healthcheckPath esteja na lista.
 *
 * Uso: node test/portao.test.mjs
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

const rotas = ler("server/routes.ts");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. ⛔ O PORTÃO EXISTE, E VEM ANTES DAS ROTAS");
{
  const iPortao = rotas.indexOf('app.use("/api", async (req');
  ok("o middleware de /api existe", iPortao > 0, "ninguém está guardando a porta");

  // ⛔ Ordem é tudo: o Express casa middleware na ordem de REGISTRO. Um portão
  //    declarado depois de uma rota não protege aquela rota.
  const primeiraRota = rotas.search(/app\.(get|post|put|delete|patch)\("\/api/);
  ok("⛔ e vem ANTES da primeira rota /api", iPortao > 0 && iPortao < primeiraRota,
    `portão em ${iPortao}, primeira rota em ${primeiraRota}`);

  ok("⛔ o portão recusa com 401 seco", /status\(401\)\.json\(\{ ok: false, error: "não autenticado" \}\)/.test(rotas));

  // ⚠️ Amarrada ao BLOCO DO PORTÃO, ⛔ não ao arquivo. A primeira versão varria
  //    as 18 mil linhas e acusava `error: "chave do hub inválida"` da linha
  //    13490 — que é de OUTRA rota (requireHubKey) e está certa onde está.
  //    Regex sem escopo acusa código correto: é a Armadilha 18.
  const doPortao = rotas.slice(rotas.indexOf('app.use("/api", async (req'), rotas.indexOf('app.use("/api", async (req') + 2500);
  ok("⛔ e ⛔ NÃO diz qual credencial faltou",
    !/(sess[ãa]o inv[áa]lida|token expirado|chave inv[áa]lida)/.test(doPortao),
    "mensagem detalhada de recusa é mapa para quem está tentando entrar");
}

console.log("\n2. ⛔ AS TRÊS CREDENCIAIS ACEITAS, E SÓ ELAS");
{
  ok("sessão válida entra", /if \(getUserFromToken\(token\)\) return next\(\)/.test(rotas));
  ok("a chave do hub entra — é como o Greco Metas lê o Control",
    /x-hub-key/.test(rotas) && /recebida === esperada/.test(rotas));
  ok("⛔ e chave VAZIA ⛔ não vira passe livre",
    /esperada && recebida === esperada/.test(rotas),
    "sem HUB_API_KEY configurada, qualquer um entraria mandando header vazio");
  ok("a lista de abertas é consultada", /ROTAS_ABERTAS\.some\(/.test(rotas));
}

console.log("\n3. ⛔ A LISTA DE EXCEÇÃO É CURTA — e cresce só com motivo");
{
  const bloco = rotas.slice(rotas.indexOf("const ROTAS_ABERTAS"), rotas.indexOf("app.use(\"/api\""));
  const entradas = (bloco.match(/^\s*\/\^/gm) || []).length;

  // ⛔ TETO EXPLÍCITO. Sem número, "só mais uma" repetido dez vezes vira dez
  //    furos, e cada um pareceu razoável no dia em que entrou.
  ok("⛔ no máximo 4 rotas abertas", entradas > 0 && entradas <= 4, `${entradas} entradas`);

  ok("⛔ /auth/login está aberta — exigir sessão para ENTRAR tranca todo mundo",
    /\/\^\\\/auth\\\/login/.test(bloco));
  ok("cada exceção tem motivo escrito em comentário",
    (bloco.match(/^\s*\/\//gm) || []).length >= 3, "exceção sem motivo é furo sem dono");

  // ⛔ O que NUNCA pode entrar na lista.
  for (const proibida of ["mesa", "assinaturas", "auth/usuarios", "conselheiro", "pagamento"]) {
    ok(`⛔ "${proibida}" ⛔ NÃO está na lista de abertas`, !bloco.includes(proibida));
  }
}

console.log("\n4. ⛔ E FECHAR DEMAIS DERRUBA O SISTEMA SOZINHO");
{
  // ⚠️ O healthcheck do Railway. Fechá-lo faz o serviço reiniciar em laço até
  //    desistir — a proteção tirando o Control do ar. Esta trava lê o
  //    railway.toml, ⛔ não uma cópia do caminho: cópia diverge calada.
  const toml = ler("railway.toml");
  const m = toml.match(/healthcheckPath\s*=\s*"([^"]+)"/);
  ok("o railway.toml declara um healthcheckPath", Boolean(m), "sem isso não dá para conferir");

  if (m) {
    const caminho = m[1];
    const bloco = rotas.slice(rotas.indexOf("const ROTAS_ABERTAS"), rotas.indexOf("app.use(\"/api\""));
    // Dentro de app.use("/api"), o Express já tirou o prefixo.
    const semPrefixo = caminho.replace(/^\/api/, "");
    const coberto = bloco.includes(semPrefixo.replace(/\//g, "\\/"));
    ok(`⛔ ${caminho} está na lista de abertas`, coberto,
      "fechá-lo faz o Railway reiniciar em laço e o Control sai do ar sozinho");
  }
}

console.log("\n5. ⛔ O CLIENTE MANDA O TOKEN — em UM lugar, não em 63");
{
  const inter = ler("client/src/lib/tokenNoFetch.ts");
  const store = ler("client/src/lib/authStore.ts");
  const main = ler("client/src/main.tsx");

  ok("o interceptador é instalado no boot", /instalarTokenNoFetch\(\)/.test(main));
  // ⚠️ Compara a CHAMADA com a renderização. A primeira versão usava indexOf de
  //    "instalarTokenNoFetch()" e casava a linha do `import` — que vem primeiro
  //    por construção, então a trava passava por acidente, ⛔ não por estar certa.
  const iChamada = main.search(/^\s*instalarTokenNoFetch\(\);/m);
  const iRender = main.indexOf("createRoot(");
  ok("⛔ e ANTES de renderizar — instalado depois, a primeira chamada sai sem token",
    iChamada > 0 && iRender > 0 && iChamada < iRender, `chamada=${iChamada} render=${iRender}`);

  // ⚠️ A chave do localStorage é IMPORTADA, ⛔ não reescrita. Em 23/08 eu a
  //    digitei à mão aqui e errei o nome: o interceptador leria null para
  //    sempre e TODA chamada voltaria 401, sem nada apontando a causa.
  ok("⛔ a chave do token é IMPORTADA do authStore, ⛔ não copiada",
    /import \{ TOKEN_KEY \} from "\.\/authStore"/.test(inter));
  ok("   e o authStore a exporta", /export const TOKEN_KEY/.test(store));
  ok("⛔ e ⛔ não há string de chave literal no interceptador",
    !/"greco_[a-z_]*token"/.test(inter));

  ok("⛔ só toca em /api da PRÓPRIA origem — credencial ⛔ não vaza para terceiro",
    /alvo\.origin === nossa\.origin/.test(inter) && /startsWith\("\/api\/"\)/.test(inter));
  ok("⛔ respeita header que já veio", /if \(headers\.has\("Authorization"\)\) return original/.test(inter));
  ok("⛔ e ⛔ NÃO redireciona no 401",
    !/location\.(href|hash)\s*=/.test(inter) && !/logout\(\)/.test(inter),
    "deslogar sozinho transforma rota quebrada em 'sessão expirou'");
}

console.log("\n6. ⛔ DÁ PARA SAIR — e o nome no canto é de quem entrou");
{
  const layout = ler("client/src/components/AppLayout.tsx");
  ok("⛔ existe botão de sair", /data-testid="logout"/.test(layout) && /logout\(\)/.test(layout),
    "sessão de 30 dias sem porta de saída");
  ok("⛔ o nome vem da SESSÃO, ⛔ não chumbado",
    /user\?\.nome \|\| user\?\.username/.test(layout) && !/>Fred Lasmar</.test(layout),
    "qualquer um que logasse via o nome do dono");
  ok("⛔ sem nome, as iniciais ⛔ não são inventadas", /return "\?"/.test(layout));
}

console.log(`\n${passou} passaram · ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
