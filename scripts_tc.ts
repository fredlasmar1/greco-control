import { saidasDoMes } from "/Users/frederico/dev/greco-control/server/caixaMes.js";
const r: any = await saidasDoMes("2026-08");
console.log("TOTAL:", r.total.toFixed(2));
for (const b of r.blocos) console.log(` ${b.chave.padEnd(9)} R$ ${b.total.toFixed(2).padStart(11)} · ${b.itens.length} itens`);
process.exit(0);
