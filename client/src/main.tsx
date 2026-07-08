import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Greco Control é dark-first (tema "Noite" premium). Ativa o modo escuro sempre.
document.documentElement.classList.add("dark");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
