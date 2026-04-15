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
      dbReady = true;
      log("Postgres conectado e tabela kv_store pronta", "db");
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
