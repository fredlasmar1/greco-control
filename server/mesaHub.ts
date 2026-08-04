/**
 * A MESA — o Control lendo o Greco Metas.
 *
 * REGRA DO CONTROL NOVO: ele não calcula nada, não tem tela de digitar e não tem
 * banco de operação. Tudo que ele mostra vem daqui, e toda conta mora no Metas,
 * com teste. Número errado no Control conserta-se LÁ.
 *
 * Foi a duplicação — a mesma regra escrita nos dois lados, divergindo em
 * silêncio — que fez o Conselheiro aconselhar contra R$ 100.000 enquanto o
 * painel da equipe corria atrás de R$ 105.000. E foram 24 telas construídas duas
 * vezes, das quais 23 morreram sem nunca terem sido a fonte de nada.
 *
 * Config: METAS_HUB_URL + HUB_API_KEY (a mesma chave dos dois lados).
 */
const BASE = process.env.METAS_HUB_URL || "https://www.grecopro.com.br";
const KEY = process.env.HUB_API_KEY || "";

export class HubIndisponivel extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "HubIndisponivel";
  }
}

/**
 * Chama o hub. Falha ESTOURA em vez de devolver vazio: uma tela de conselho que
 * mostra zero porque a ponte caiu é pior que uma que diz "não consegui ler" —
 * zero parece um número apurado e leva a decisão errada.
 */
async function hub<T>(caminho: string, init?: RequestInit): Promise<T> {
  if (!KEY) throw new HubIndisponivel("HUB_API_KEY não configurada — o Control lê tudo do Greco Metas.");
  let r: Response;
  try {
    r = await fetch(`${BASE}/api/hub${caminho}`, {
      ...init,
      headers: { "x-hub-key": KEY, "content-type": "application/json", ...(init?.headers || {}) },
      signal: AbortSignal.timeout(init?.method === "POST" ? 180_000 : 20_000),
    });
  } catch (e: any) {
    throw new HubIndisponivel(`não consegui falar com o Greco Metas: ${e?.message || e}`);
  }
  const j = (await r.json().catch(() => null)) as any;
  if (!r.ok || !j?.ok) throw new HubIndisponivel(j?.error || `o Greco Metas respondeu ${r.status}`);
  return j as T;
}

/** As decisões do dono com placar. O Metas congela a linha de base sozinho. */
export const getMesa = () => hub<{ mesa: any; congelou: any[] }>("/mesa");

/** O DRE do mês: entrou, saiu, sobrou, ponto de equilíbrio, obra à parte. */
export const getFechamento = (mes: string) => hub<{ fechamento: any }>(`/fechamento/${mes}`);

/** Custo fixo por hora de cadeira, o que cada serviço deixa, ocupação, tolerância a churn. */
export const getRegua = (mes: string) => hub<{ regua: any }>(`/regua-precos/${mes}`);

/** Reúne o conselho. Demora: são quatro conselheiros consultando o banco em paralelo. */
export const reunirConselho = (pergunta: string, mes?: string) =>
  hub<{ sessao: any }>("/conselho", { method: "POST", body: JSON.stringify({ pergunta, mes }) });

/** Mês fechado mais recente. O corrente ainda está andando e engana. */
export function mesDeReferencia(): string {
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - 1, 1)).toISOString().slice(0, 7);
}
