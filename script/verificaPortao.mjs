/**
 * VERIFICADOR DO PORTÃO DE /api — bate na porta de fora e confere quem entra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * `[23/08/2026]` o Control respondia a QUALQUER UM na internet. Medido sem
 * cookie, sem token e sem header:
 *
 *   GET  /api/mesa              → 200 ·  5.375 bytes  (as decisões do dono)
 *   GET  /api/mesa/mes/2026-07  → 200 · 16.834 bytes  (o DRE inteiro)
 *   POST /api/mesa/precos       → 200 · 13.000 bytes  (régua de preço e Clube)
 *
 * A tela de login existia e protegia o front-end — e mais nada.
 *
 * ⛔ PORTÃO SEM VERIFICADOR É PROMESSA. Este arquivo existe para que a
 *    afirmação "está fechado" seja uma MEDIÇÃO, feita de fora, e refeita a cada
 *    vez que alguém duvidar. É o mesmo motivo das travas do Greco Metas.
 *
 * ⚠️ Ele ⛔ NÃO tenta adivinhar senha e ⛔ NÃO envia credencial: só confere que
 *    porta sem credencial devolve 401 e que as exceções declaradas continuam
 *    abertas. Nenhum valor financeiro é impresso — só status e tamanho.
 *
 * Uso:
 *   node script/verificaPortao.mjs                        # produção
 *   node script/verificaPortao.mjs http://localhost:5000  # local
 */

const BASE = (process.argv[2] || "https://grecocontrol.com.br").replace(/\/$/, "");

let passou = 0, falhou = 0;
const ok = (nome, cond, detalhe = "") => {
  if (cond) { passou++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}${detalhe ? " — " + detalhe : ""}`); }
};

async function bater(caminho, metodo = "GET") {
  try {
    const r = await fetch(BASE + caminho, {
      method: metodo,
      headers: metodo === "POST" ? { "Content-Type": "application/json" } : {},
      body: metodo === "POST" ? "{}" : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const t = await r.text();
    return { status: r.status, bytes: t.length };
  } catch (e) {
    return { status: 0, bytes: 0, erro: String(e?.message || e) };
  }
}

console.log(`\nPORTÃO DE /api — ${BASE}\n`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("1. ⛔ AS ROTAS FINANCEIRAS EXIGEM CREDENCIAL — a trava principal");
{
  // As três que estavam abertas em 23/08, e mais quatro do Control antigo que
  // carregam dinheiro. ⛔ Nenhuma pode responder 200 sem credencial.
  const FECHADAS = [
    ["/api/mesa", "GET"],
    ["/api/mesa/mes/2026-07", "GET"],
    ["/api/mesa/precos", "POST"],
    ["/api/assinaturas/clientes", "GET"],
    ["/api/auth/usuarios", "GET"],
    ["/api/auth/me", "GET"],
  ];
  // ⚠️ 401 ou 403 — as duas são RECUSA. `/api/auth/usuarios` já tinha guarda de
  //    admin própria e devolve 403; exigir 401 dela reprovaria uma rota que está
  //    certa. A invariante é "⛔ não entrega sem credencial", ⛔ não o número.
  for (const [rota, metodo] of FECHADAS) {
    const r = await bater(rota, metodo);
    ok(`${metodo} ${rota} recusa`, r.status === 401 || r.status === 403,
      r.erro ? r.erro : `devolveu ${r.status} com ${r.bytes} bytes`);
  }
}

console.log("\n2. As exceções declaradas continuam abertas — senão o sistema cai");
{
  // ⛔ O healthcheck do railway.toml. Fechá-lo faz o Railway reiniciar o serviço
  //    em laço até desistir, e o Control sai do ar sozinho.
  const h = await bater("/api/trinks/status");
  ok("GET /api/trinks/status (healthcheckPath) responde", h.status === 200,
    `devolveu ${h.status}`);

  // ⛔ A porta. Exigir sessão para entrar tranca todo mundo para fora, para sempre.
  //    ⚠️ Sem usuário e senha no corpo, o esperado é 400 — o que prova que a rota
  //    FOI ALCANÇADA, que é justamente o que se quer saber. 401 aqui significaria
  //    que o portão engoliu a própria porta.
  const l = await bater("/api/auth/login", "POST");
  ok("POST /api/auth/login é alcançável (400, não 401)", l.status === 400,
    `devolveu ${l.status}`);
}

console.log("\n3. ⛔ E O 401 ⛔ NÃO ENTREGA NADA");
{
  const r = await bater("/api/mesa/mes/2026-07");
  // Resposta de recusa tem que ser curta. Um 401 de 5 KB estaria devolvendo o
  // conteúdo junto com a recusa — já aconteceu em sistema que loga o payload.
  ok("a recusa é curta (< 200 bytes)", r.status !== 401 || r.bytes < 200,
    `${r.bytes} bytes`);
}

console.log(`\n${passou} passaram · ${falhou} falharam\n`);
if (falhou) {
  console.log("⛔ O PORTÃO NÃO ESTÁ FECHADO. Não trate como resolvido.\n");
}
process.exit(falhou ? 1 : 0);
