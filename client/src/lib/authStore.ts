import { create } from "zustand";

const API_BASE = () => (globalThis as any).__API_BASE__ || "";
/**
 * ⛔ A chave do token mora AQUI e é exportada. Em 23/08 eu a reescrevi à mão em
 * `tokenNoFetch.ts` e errei o nome — o interceptador leria `null` para sempre e
 * TODA chamada voltaria 401, sem erro nenhum apontando a causa. Chave copiada é
 * chave que diverge calada.
 */
export const TOKEN_KEY = "greco_auth_token";

export interface AuthUser {
  id: string;
  username: string;
  nome: string;
  role: "admin" | "barbeiro" | "recepcao";
  barberId?: string;
  ativo: boolean;
  createdAt: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string; user?: AuthUser }>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  isAdmin: () => boolean;
  isBarbeiro: () => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  loading: true,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API_BASE()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        set({ loading: false, error: data.error || "Erro no login" });
        return { ok: false, error: data.error };
      }
      localStorage.setItem(TOKEN_KEY, data.token);
      set({ token: data.token, user: data.user, loading: false, error: null });
      return { ok: true, user: data.user };
    } catch (err: any) {
      set({ loading: false, error: err.message || "Erro de conexão" });
      return { ok: false, error: err.message };
    }
  },

  logout: async () => {
    const token = get().token;
    if (token) {
      try {
        await fetch(`${API_BASE()}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null, error: null });
  },

  restoreSession: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const res = await fetch(`${API_BASE()}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        set({ token: null, user: null, loading: false });
        return;
      }
      const user = await res.json();
      set({ token, user, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  isAdmin: () => get().user?.role === "admin",
  isBarbeiro: () => get().user?.role === "barbeiro",
}));

// Helper para fazer requests autenticados
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = useAuth.getState().token;
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE()}${url}`, { ...options, headers });
}
