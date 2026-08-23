/**
 * ENTRAR COM GOOGLE — só o dono, e sem token na barra de endereço.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * Decisão do dono em 23/08/2026: *"como somente eu vou usar esse sistema, tem
 * como tirar todos os acessos e eu entrar com minha conta Google?"*. As outras
 * três contas já foram desativadas no mesmo dia; isto é a segunda metade.
 *
 * ⚠️ A SENHA DO `admin` CONTINUA VALENDO, de propósito. Se o Google cair, o
 * projeto for suspenso ou o OAuth for mal configurado, o dono fica trancado
 * fora do próprio DRE. Porta principal nova ⛔ não significa arrancar a porta
 * dos fundos no mesmo dia. Quando ele tiver entrado pelo Google algumas vezes e
 * confiar, é uma linha para desativar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ TRÊS DECISÕES DE SEGURANÇA QUE ⛔ NÃO SÃO NEGOCIÁVEIS
 *
 * 1. **⛔ O TOKEN DE SESSÃO ⛔ NUNCA VAI NA URL.** Seria o caminho mais curto —
 *    redirecionar para `/#/?token=abc` e deixar a tela guardar. Mas URL entra no
 *    histórico do navegador, no log do servidor, no `Referer` de qualquer imagem
 *    da página e no que a pessoa cola no WhatsApp sem pensar. Um token de 30
 *    dias nesses lugares é a chave do DRE espalhada.
 *
 *    Em vez disso o callback devolve um **TICKET**: aleatório, de **uso único**
 *    e que morre em **60 segundos**. A tela troca o ticket pelo token por POST e
 *    limpa a barra de endereço. Se o ticket vazar, ele já foi usado ou já
 *    expirou.
 *
 * 2. **A LISTA DE PERMITIDOS É EXPLÍCITA E CURTA.** ⛔ Ter uma Conta do Google
 *    ⛔ não é credencial: qualquer pessoa do planeta tem uma. Sem a lista, "entrar
 *    com Google" seria uma porta aberta com aparência de fechadura.
 *
 * 3. **`email_verified` É OBRIGATÓRIO.** Sem ele, um e-mail ⛔ não é prova de
 *    identidade — só de digitação.
 *
 * ⚠️ E O `state` EXISTE CONTRA CSRF: sem ele, alguém induz o dono a abrir um
 * callback forjado e a sessão criada é de outra pessoa. É a mesma família do
 * "vínculo existente não é evidência de identidade".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIGURAÇÃO (Railway → greco-control)
 *   GOOGLE_CLIENT_ID       do Google Cloud Console
 *   GOOGLE_CLIENT_SECRET   idem — ⛔ nunca no código, nunca no repositório
 *   GOOGLE_EMAILS          lista separada por vírgula. Padrão abaixo.
 *   APP_URL                opcional; padrão https://grecocontrol.com.br
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { log } from "./index";

/** ⛔ Quem pode entrar. Um e-mail que ⛔ não esteja aqui é recusado, e ponto. */
const PERMITIDOS_PADRAO = ["fredlasmar@gmail.com"];

const APP_URL = (process.env.APP_URL || "https://grecocontrol.com.br").replace(/\/$/, "");
const REDIRECT_URI = `${APP_URL}/api/auth/google/callback`;

function permitidos(): string[] {
  const cru = (process.env.GOOGLE_EMAILS || "").trim();
  const lista = cru ? cru.split(",") : PERMITIDOS_PADRAO;
  return lista.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function googleConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ─── ESTADOS E TICKETS, os dois de vida curta ───────────────────────────────
//
// ⚠️ Em memória de propósito: os dois vivem MINUTOS. Persistir no banco daria a
//    eles a durabilidade que justamente ⛔ não devem ter — e um restart no meio
//    de um login só custa clicar de novo.

const estados = new Map<string, number>();
const tickets = new Map<string, { token: string; expira: number }>();
const VIDA_ESTADO_MS = 10 * 60 * 1000;
const VIDA_TICKET_MS = 60 * 1000;

/** ⛔ Sem isto os dois Maps crescem para sempre — é vazamento lento, não bug agudo. */
function limpar(): void {
  // ⚠️ `Array.from` porque o tsconfig desta casa mira ES5 — iterar Map direto
  //    quebra o build. E copiar antes de apagar é o certo de qualquer forma:
  //    apagar durante a iteração é defeito clássico.
  const agora = Date.now();
  Array.from(estados.keys()).forEach((k) => { if ((estados.get(k) ?? 0) < agora) estados.delete(k); });
  Array.from(tickets.keys()).forEach((k) => { if ((tickets.get(k)?.expira ?? 0) < agora) tickets.delete(k); });
}

const aleatorio = (): string => crypto.randomBytes(32).toString("hex");

/**
 * Lê o corpo do id_token. ⛔ ⛔ NÃO confia nele por si só — quem valida é
 * `validarIdToken`, e o token chegou por HTTPS direto do endpoint do Google,
 * ⛔ não pelo navegador.
 */
function corpoDoJwt(idToken: string): any | null {
  try {
    const partes = String(idToken).split(".");
    if (partes.length !== 3) return null;
    return JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
  } catch { return null; }
}

/**
 * ⛔ As quatro conferências. Falhar QUALQUER uma recusa o login — e a mensagem
 * devolvida ao navegador ⛔ não diz qual falhou: detalhe de recusa é mapa para
 * quem está tentando entrar.
 */
function validarIdToken(idToken: string): { email: string; nome: string } | null {
  const c = corpoDoJwt(idToken);
  if (!c) return null;

  const emissorOk = c.iss === "accounts.google.com" || c.iss === "https://accounts.google.com";
  const paraNos = c.aud === process.env.GOOGLE_CLIENT_ID;
  const noPrazo = typeof c.exp === "number" && c.exp * 1000 > Date.now();
  // ⛔ E-mail não verificado ⛔ não é identidade — é digitação.
  const verificado = c.email_verified === true || c.email_verified === "true";

  if (!emissorOk || !paraNos || !noPrazo || !verificado) return null;

  const email = String(c.email || "").toLowerCase();
  if (!email || !permitidos().includes(email)) return null;

  return { email, nome: String(c.name || email) };
}

export interface GoogleAuthDeps {
  /** Cria a sessão do `admin` e devolve o token. Quem sabe fazer isso é o routes.ts. */
  abrirSessaoDoDono: (email: string, nome: string) => Promise<string | null>;
}

export function registrarGoogleAuth(app: Express, deps: GoogleAuthDeps): void {
  /** Onde o login começa. ⛔ 503 explicado quando falta configuração — nunca 500 mudo. */
  app.get("/api/auth/google", (_req: Request, res: Response) => {
    if (!googleConfigurado()) {
      return res.status(503).send("Login com Google não está configurado neste servidor.");
    }
    limpar();
    const state = aleatorio();
    estados.set(state, Date.now() + VIDA_ESTADO_MS);

    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    u.searchParams.set("redirect_uri", REDIRECT_URI);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", state);
    // ⚠️ `select_account` de propósito: o dono tem duas contas Google no mesmo
    //    Chrome, e sem isto o Google escolheria a ativa em silêncio — e ele veria
    //    "acesso negado" sem entender que entrou com a conta errada.
    u.searchParams.set("prompt", "select_account");
    res.redirect(u.toString());
  });

  /** A volta do Google. ⛔ Erro aqui vira mensagem em português, não stack trace. */
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const recusa = (motivo: string) =>
      res.redirect(`${APP_URL}/#/login?erro=${encodeURIComponent(motivo)}`);
    try {
      const state = String(req.query.state || "");
      const code = String(req.query.code || "");
      // ⛔ `state` é de uso único: aceitar duas vezes reabre a janela de CSRF.
      if (!state || !estados.delete(state)) return recusa("sessao_invalida");
      if (!code) return recusa("sem_codigo");

      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(15000),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j?.id_token) return recusa("google_recusou");

      const quem = validarIdToken(j.id_token);
      if (!quem) {
        // ⚠️ O log diz que houve recusa e ⛔ NÃO grava o e-mail tentado: dado de
        //    pessoa em log é vazamento, e aqui ele nem serviria para nada.
        log("login Google recusado (fora da lista ou token inválido)", "auth");
        return recusa("nao_autorizado");
      }

      const token = await deps.abrirSessaoDoDono(quem.email, quem.nome);
      if (!token) return recusa("conta_local_ausente");

      // ⛔ O token vai para um TICKET, ⛔ não para a URL.
      limpar();
      const ticket = aleatorio();
      tickets.set(ticket, { token, expira: Date.now() + VIDA_TICKET_MS });
      log(`login Google aceito para ${quem.email.replace(/(.{2}).*(@.*)/, "$1***$2")}`, "auth");
      res.redirect(`${APP_URL}/#/login?ticket=${ticket}`);
    } catch (err: any) {
      log(`callback Google: ${err?.message || err}`, "auth");
      recusa("erro_inesperado");
    }
  });

  /** A troca. ⛔ Uso único: o ticket some no ato, dê certo ou não. */
  app.post("/api/auth/google/trocar", (req: Request, res: Response) => {
    limpar();
    const ticket = String(req.body?.ticket || "");
    const guardado = tickets.get(ticket);
    tickets.delete(ticket);
    if (!guardado || guardado.expira < Date.now()) {
      return res.status(401).json({ ok: false, error: "ticket inválido ou expirado" });
    }
    res.json({ ok: true, token: guardado.token });
  });

  /** A tela pergunta se deve mostrar o botão. ⛔ Não expõe nada além do sim/não. */
  app.get("/api/auth/google/disponivel", (_req: Request, res: Response) => {
    res.json({ ok: true, disponivel: googleConfigurado() });
  });
}
