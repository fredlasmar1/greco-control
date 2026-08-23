/**
 * A SUÍTE DO GRECO CONTROL — roda tudo e mostra o resumo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ELA NASCE SÓ AGORA (23/08/2026)
 *
 * Este repositório ⛔ não tinha `npm test`. Passou o dia sem — e o dia teve:
 *
 *   · 284 rotas `/api` respondendo sem autenticação nenhuma;
 *   · nenhum botão de sair, num sistema com sessão de 30 dias;
 *   · o nome do dono CHUMBADO no canto, para qualquer um que logasse;
 *   · uma tela nova cujo dado ⛔ não declarava a própria idade.
 *
 * ⚠️ E o gatilho foi outro: quando a Diretoria saiu do Greco Metas e as telas
 * do dono passaram a morar AQUI, sete asserções que provavam que a TELA declara
 * janela, recorte e suposição morreram junto — e eu as reapontei para o
 * servidor, registrando que aquilo era um ENFRAQUECIMENTO real. A dívida dizia:
 * "a garantia de renderização volta quando o Control tiver suíte própria".
 *
 * É esta.
 *
 * ⛔ A REGRA DAS TRAVAS DESTA CASA: elas afirmam a INVARIANTE, ⛔ não o formato
 * do bug que as originou. Trava escrita no formato do defeito passa verde para
 * sempre na próxima vez que ele voltar com outra roupa.
 *
 * Uso: npm test
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const DIR = path.join(RAIZ, "test");

const arquivos = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith(".test.mjs")).sort()
  : [];

if (!arquivos.length) {
  console.log("nenhum teste encontrado em test/");
  process.exit(0);
}

let falharam = 0;
let totalOk = 0;

console.log(`\nGRECO CONTROL — ${arquivos.length} arquivo(s) de teste\n`);

for (const f of arquivos) {
  const nome = f.replace(/\.test\.mjs$/, "");
  try {
    const saida = execSync(`node ${JSON.stringify(path.join(DIR, f))}`, {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const m = saida.match(/(\d+) passaram/);
    const n = m ? Number(m[1]) : 0;
    totalOk += n;
    console.log(`  ✓ ${nome.padEnd(22)} ${n} passaram`);
  } catch (e) {
    falharam++;
    const saida = String(e.stdout || "") + String(e.stderr || "");
    const m = saida.match(/(\d+) passaram · (\d+) falharam/);
    console.log(`  ✗ ${nome.padEnd(22)} ${m ? `${m[1]} passaram · ${m[2]} falharam` : "quebrou"}`);
    // ⛔ Mostra as linhas que falharam. Resumo sem o motivo faz ninguém consertar.
    for (const l of saida.split("\n")) if (l.includes("✗")) console.log(`      ${l.trim()}`);
  }
}

console.log(`\n${totalOk} testes passaram${falharam ? ` · ${falharam} arquivo(s) com falha` : ""}\n`);
process.exit(falharam ? 1 : 0);
