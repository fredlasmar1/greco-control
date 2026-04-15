import { create } from 'zustand';
import type { Barber, Service, DailyEntry, Settings } from "@shared/schema";
import {
  barbers as demoBarbers,
  services as demoServices,
  dailyEntries as demoDailyEntries,
  defaultSettings,
  weeklySummaries as demoWeeklySummaries,
} from './demoData';
import type { WeeklySummary } from "@shared/schema";

const API_BASE = () => (globalThis as any).__API_BASE__ || "";

interface AppState {
  barbers: Barber[];
  services: Service[];
  entries: DailyEntry[];
  settings: Settings;
  weeklySummaries: WeeklySummary[];
  sidebarOpen: boolean;
  loaded: boolean; // true após carregar do servidor

  // Actions
  loadFromServer: () => Promise<void>;
  addEntry: (entry: DailyEntry) => void;
  updateEntry: (id: string, data: Partial<DailyEntry>) => void;
  removeEntry: (id: string) => void;
  updateBarber: (id: string, data: Partial<Barber>) => void;
  addBarber: (barber: Barber) => void;
  removeBarber: (id: string) => void;
  updateService: (id: string, data: Partial<Service>) => void;
  addService: (service: Service) => void;
  removeService: (id: string) => void;
  updateSettings: (settings: Partial<Settings>) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

// ─── Sync com servidor (debounced) ────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleServerSave(payload: Partial<AppState>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(`${API_BASE()}/api/store`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: payload.settings,
        barbers: payload.barbers,
        services: payload.services,
        entries: payload.entries,
        weeklySummaries: payload.weeklySummaries,
      }),
    }).catch(() => { /* silencioso, retentar próxima alteração */ });
  }, 300); // debounce de 300ms
}

function persist(state: AppState) {
  scheduleServerSave({
    settings: state.settings,
    barbers: state.barbers,
    services: state.services,
    entries: state.entries,
    weeklySummaries: state.weeklySummaries,
  });
}

export const useStore = create<AppState>((set, get) => ({
  // valores iniciais (substituídos pelo loadFromServer)
  barbers: demoBarbers,
  services: demoServices,
  entries: demoDailyEntries,
  settings: defaultSettings,
  weeklySummaries: demoWeeklySummaries,
  sidebarOpen: false,
  loaded: false,

  loadFromServer: async () => {
    try {
      const res = await fetch(`${API_BASE()}/api/store`);
      if (!res.ok) {
        set({ loaded: true });
        return;
      }
      const data = await res.json();
      const update: Partial<AppState> = { loaded: true };
      if (data && typeof data === "object") {
        if (data.settings && typeof data.settings === "object") update.settings = { ...defaultSettings, ...data.settings };
        if (Array.isArray(data.barbers) && data.barbers.length > 0) update.barbers = data.barbers;
        if (Array.isArray(data.services) && data.services.length > 0) update.services = data.services;
        if (Array.isArray(data.entries)) update.entries = data.entries;
        if (Array.isArray(data.weeklySummaries) && data.weeklySummaries.length > 0) update.weeklySummaries = data.weeklySummaries;
      }
      set(update);
      // Se o servidor não tinha nada salvo, persiste os valores iniciais (demo)
      if (!data?.settings && !Array.isArray(data?.barbers)) {
        const s = get();
        persist(s);
      }
    } catch {
      set({ loaded: true });
    }
  },

  addEntry: (entry) => {
    set((state) => {
      const next = { entries: [entry, ...state.entries] };
      persist({ ...state, ...next });
      return next;
    });
  },
  updateEntry: (id, data) => {
    set((state) => {
      const next = { entries: state.entries.map(e => e.id === id ? { ...e, ...data } : e) };
      persist({ ...state, ...next });
      return next;
    });
  },
  removeEntry: (id) => {
    set((state) => {
      const next = { entries: state.entries.filter(e => e.id !== id) };
      persist({ ...state, ...next });
      return next;
    });
  },

  updateBarber: (id, data) => {
    set((state) => {
      const next = { barbers: state.barbers.map(b => b.id === id ? { ...b, ...data } : b) };
      persist({ ...state, ...next });
      return next;
    });
  },
  addBarber: (barber) => {
    set((state) => {
      const next = { barbers: [...state.barbers, barber] };
      persist({ ...state, ...next });
      return next;
    });
  },
  removeBarber: (id) => {
    set((state) => {
      const next = { barbers: state.barbers.filter(b => b.id !== id) };
      persist({ ...state, ...next });
      return next;
    });
  },

  updateService: (id, data) => {
    set((state) => {
      const next = { services: state.services.map(s => s.id === id ? { ...s, ...data } : s) };
      persist({ ...state, ...next });
      return next;
    });
  },
  addService: (service) => {
    set((state) => {
      const next = { services: [...state.services, service] };
      persist({ ...state, ...next });
      return next;
    });
  },
  removeService: (id) => {
    set((state) => {
      const next = { services: state.services.filter(s => s.id !== id) };
      persist({ ...state, ...next });
      return next;
    });
  },

  updateSettings: (newSettings) => {
    set((state) => {
      const next = { settings: { ...state.settings, ...newSettings } };
      persist({ ...state, ...next });
      return next;
    });
  },

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
