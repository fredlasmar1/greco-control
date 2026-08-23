import pg from "pg";
import { log } from "./index";

const { Pool } = pg;

// Usa DATABASE_URL se existir (injetada pelo Railway quando se adiciona Postgres)
const DATABASE_URL = process.env.DATABASE_URL || "";

let pool: pg.Pool | null = null;
let dbReady = false;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

  pool.on("error", err => log(`DB error: ${err.message}`, "db"));

  // Cria a tabela kv_store se não existir
  (async () => {
    try {
      await pool!.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      /**
       * ⛔ SESSÃO EM MEMÓRIA MORRE A CADA DEPLOY — e o dono foi deslogado três
       * vezes em 23/08/2026 por causa disso, num único dia de trabalho. Pior que
       * o incômodo: ele passa a ler "não autenticado" como sintoma normal, e no
       * dia em que for defeito de verdade ⛔ não vai desconfiar.
       *
       * ⚠️ A tabela vive aqui, junto de `kv_store`, porque este repositório ⛔ não
       * tem sistema de migration — inventar um só para isto seria fundação nova
       * numa casa que já tem uma. `CREATE TABLE IF NOT EXISTS` é o padrão desta
       * casa, e está documentado como dívida no Metas.
       */
      await pool!.query(`
        CREATE TABLE IF NOT EXISTS sessoes (
          token       TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          expires_at  TIMESTAMPTZ NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool!.query(`CREATE INDEX IF NOT EXISTS sessoes_expira ON sessoes (expires_at)`);
      dbReady = true;
      log("Postgres conectado · kv_store e sessoes prontas", "db");
    } catch (err: any) {
      log(`Erro ao inicializar DB: ${err.message}`, "db");
    }
  })();
} else {
  log("⚠️ DATABASE_URL não configurada, usando arquivos JSON (não persistente no Railway)", "db");
}

export function isDbReady(): boolean {
  return dbReady;
}

// ─── SESSÕES ────────────────────────────────────────────────────────────────
//
// ⛔ Elas continuam vivendo num Map em memória para a LEITURA ser síncrona —
//    `getUserFromToken` é chamado em dezenas de rotas e transformá-lo em async
//    seria um refactor grande num arquivo de 18 mil linhas, com risco alto e
//    ganho zero. O banco é o LASTRO: o Map é cache, a tabela é a verdade.
//
// ⚠️ E a leitura assíncrona existe para o caso que o cache ⛔ não cobre: token
//    criado antes do último restart, ou por outra instância. Sem ela, persistir
//    ⛔ não resolveria nada — o Map novo nasceria vazio do mesmo jeito.

export interface SessaoGravada { token: string; userId: string; expiresAt: number; }

/** Grava. Best-effort: se o banco cair, a sessão ainda vale nesta instância. */
export async function sessaoGravar(s: SessaoGravada): Promise<void> {
  if (!pool || !dbReady) return;
  try {
    await pool.query(
      `INSERT INTO sessoes (token, user_id, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [s.token, s.userId, s.expiresAt],
    );
  } catch (err: any) { log(`sessaoGravar: ${err.message}`, "db"); }
}

/** Apaga uma. ⛔ Logout tem que sumir do banco também, senão o token ressuscita. */
export async function sessaoApagar(token: string): Promise<void> {
  if (!pool || !dbReady) return;
  try { await pool.query(`DELETE FROM sessoes WHERE token = $1`, [token]); }
  catch (err: any) { log(`sessaoApagar: ${err.message}`, "db"); }
}

/** Uma sessão viva, ou null. ⛔ Expirada ⛔ não volta — o filtro é do banco. */
export async function sessaoBuscar(token: string): Promise<SessaoGravada | null> {
  if (!pool || !dbReady) return null;
  try {
    const r = await pool.query(
      `SELECT token, user_id, expires_at FROM sessoes WHERE token = $1 AND expires_at > NOW()`,
      [token],
    );
    const l = r.rows[0];
    return l ? { token: l.token, userId: l.user_id, expiresAt: new Date(l.expires_at).getTime() } : null;
  } catch (err: any) { log(`sessaoBuscar: ${err.message}`, "db"); return null; }
}

/**
 * Todas as vivas, para aquecer o cache no boot. ⛔ Também APAGA as vencidas: sem
 * isso a tabela cresce para sempre e um dia alguém "descobre" 400 mil linhas.
 */
export async function sessoesVivas(): Promise<SessaoGravada[]> {
  if (!pool || !dbReady) return [];
  try {
    await pool.query(`DELETE FROM sessoes WHERE expires_at <= NOW()`);
    const r = await pool.query(`SELECT token, user_id, expires_at FROM sessoes`);
    return r.rows.map((l: any) => ({
      token: l.token, userId: l.user_id, expiresAt: new Date(l.expires_at).getTime(),
    }));
  } catch (err: any) { log(`sessoesVivas: ${err.message}`, "db"); return []; }
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  if (!pool || !dbReady) return null;
  try {
    const r = await pool.query("SELECT value FROM kv_store WHERE key = $1", [key]);
    return r.rows[0]?.value ?? null;
  } catch (err: any) {
    log(`kvGet(${key}) error: ${err.message}`, "db");
    return null;
  }
}

// Igual ao kvGet, mas ESTOURA em vez de devolver null quando a leitura falha.
// Existe porque kvGet achata "não existe" e "não consegui ler" no mesmo null —
// inofensivo em leitura, destrutivo em read-modify-write: um blip de conexão faz
// a lista vir vazia, o código adiciona 1 item e a gravação APAGA o resto.
// Foi exatamente assim que 52 compras de julho viraram 1 (Connection terminated
// unexpectedly). Use SEMPRE esta variante antes de regravar uma coleção inteira.
export async function kvGetParaEscrita<T = any>(key: string): Promise<T | null> {
  if (!pool || !dbReady) throw new Error(`kv indisponível para escrita (key=${key})`);
  const r = await pool.query("SELECT value FROM kv_store WHERE key = $1", [key]);
  return r.rows[0]?.value ?? null;
}

/**
 * Lista as chaves que começam com `prefixo` (só as chaves, nunca os valores —
 * varrer valores de kv inteiro estoura memória: só as fotos de comprovante já
 * são 24 MB). Usada por quem precisa varrer uma família de chaves sem saber os
 * sufixos de antemão, ex.: `folha_pagamentos:` (uma por mês-referência).
 */
export async function kvKeysComPrefixo(prefixo: string): Promise<string[]> {
  if (!pool || !dbReady) return [];
  try {
    const r = await pool.query("SELECT key FROM kv_store WHERE key LIKE $1 ORDER BY key", [`${prefixo}%`]);
    return r.rows.map((x: any) => String(x.key));
  } catch (err: any) {
    log(`kvKeysComPrefixo(${prefixo}) error: ${err.message}`, "db");
    return [];
  }
}

export async function kvSet(key: string, value: any): Promise<boolean> {
  if (!pool || !dbReady) return false;
  try {
    await pool.query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    return true;
  } catch (err: any) {
    log(`kvSet(${key}) error: ${err.message}`, "db");
    return false;
  }
}

/** Aguarda até o DB estar pronto (com timeout). Útil no startup. */
export async function waitForDb(timeoutMs = 5000): Promise<boolean> {
  if (!pool) return false;
  const start = Date.now();
  while (!dbReady && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  return dbReady;
}
