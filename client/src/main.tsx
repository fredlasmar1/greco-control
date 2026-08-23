import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { instalarTokenNoFetch } from "./lib/tokenNoFetch";

// ⛔ ANTES de renderizar. Instalado depois, a primeira chamada de cada tela sai
//    sem token e volta 401 — e o defeito só aparece no primeiro carregamento,
//    que é o mais difícil de reproduzir.
instalarTokenNoFetch();

// Greco Control é dark-first (tema "Noite" premium). Ativa o modo escuro sempre.
document.documentElement.classList.add("dark");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
