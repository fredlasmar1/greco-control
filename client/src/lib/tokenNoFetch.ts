/**
 * O TOKEN VAI EM TODA CHAMADA — instalado UMA vez, no boot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 *
 * `[23/08/2026]` o portão de `/api` subiu no servidor e passou a exigir sessão.
 * Do lado do cliente havia **63 chamadas `fetch` cruas** contra **16** usando o
 * `authFetch` — inclusive as quatro telas do dono (A Mesa, O Mês, O Preço, O
 * Conselho), que faziam `fetch()` sem header nenhum. Sem esta ponte, o portão
 * derrubaria exatamente as telas que ele usa.
 *
 * ⛔ E A CORREÇÃO ⛔ NÃO É EDITAR AS 63. Trocar `fetch` por `authFetch` em 63
 * lugares deixa o token dependendo de alguém lembrar — e a 64ª chamada, escrita
 * daqui a um mês, nasce sem ele. É o mesmo raciocínio do portão do servidor:
 * porta fechada em 63 lugares reabre na 64ª.
 *
 * ⚠️ TROCAR O `fetch` GLOBAL É INVASIVO, E É DE PROPÓSITO. O contrato é
 * estreito e verificável:
 *
 *   - só mexe em requisição para `/api/` da PRÓPRIA origem;
 *   - só ACRESCENTA o header `Authorization`, e ⛔ só quando ele ⛔ não veio;
 *   - ⛔ não lê corpo, ⛔ não reescreve resposta, ⛔ não engole erro;
 *   - sem token guardado, ⛔ não faz nada — a chamada segue igual.
 *
 * ⛔ E ELE ⛔ NÃO REDIRECIONA NO 401. Deslogar sozinho ao ver um 401 transforma
 * qualquer rota quebrada em "sua sessão expirou", e a pessoa passa a relogar
 * atrás de um defeito que ⛔ não é de sessão. Quem trata 401 é a tela.
 */

import { TOKEN_KEY } from "./authStore";

/** A mesma origem que o `authStore` usa. Vazio = servidor que serviu a página. */
const baseDaApi = (): string => (globalThis as any).__API_BASE__ || "";

/**
 * A requisição é para a nossa API? ⛔ Chamada para terceiro ⛔ nunca leva o token
 * — mandar credencial para fora é vazamento, ⛔ não conveniência.
 */
function ehNossaApi(url: string): boolean {
  try {
    const base = baseDaApi();
    const alvo = new URL(url, base || window.location.origin);
    const nossa = new URL(base || window.location.origin, window.location.origin);
    return alvo.origin === nossa.origin && alvo.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

let instalado = false;

/** Chamado uma vez, antes de renderizar. Repetir é inofensivo. */
export function instalarTokenNoFetch(): void {
  if (instalado || typeof window === "undefined") return;
  instalado = true;

  const original = window.fetch.bind(window);

  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof entrada === "string" ? entrada
      : entrada instanceof URL ? entrada.toString()
      : entrada.url;

    if (!ehNossaApi(url)) return original(entrada as any, init);

    let token: string | null = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch { /* modo privado */ }
    if (!token) return original(entrada as any, init);

    // ⛔ Respeita quem já mandou o header — `authFetch` continua funcionando
    //    igual, e um dia que alguém precise de outra credencial, manda e vence.
    const headers = new Headers(
      init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined),
    );
    if (headers.has("Authorization")) return original(entrada as any, init);
    headers.set("Authorization", `Bearer ${token}`);

    return original(entrada as any, { ...init, headers });
  };
}
