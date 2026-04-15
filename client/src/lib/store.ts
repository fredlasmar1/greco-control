import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Barber, Service, DailyEntry, Settings } from "@shared/schema";
import { barbers as demoBarbers, services as demoServices, dailyEntries as demoDailyEntries, defaultSettings, weeklySummaries as demoWeeklySummaries } from './demoData';
import type { WeeklySummary } from "@shared/schema";

interface AppState {
  barbers: Barber[];
  services: Service[];
  entries: DailyEntry[];
  settings: Settings;
  weeklySummaries: WeeklySummary[];
  sidebarOpen: boolean;

  // Actions
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

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      barbers: demoBarbers,
      services: demoServices,
      entries: demoDailyEntries,
      settings: defaultSettings,
      weeklySummaries: demoWeeklySummaries,
      sidebarOpen: false,

      addEntry: (entry) => set((state) => ({ entries: [entry, ...state.entries] })),
      updateEntry: (id, data) => set((state) => ({
        entries: state.entries.map(e => e.id === id ? { ...e, ...data } : e),
      })),
      removeEntry: (id) => set((state) => ({
        entries: state.entries.filter(e => e.id !== id),
      })),

      updateBarber: (id, data) => set((state) => ({
        barbers: state.barbers.map(b => b.id === id ? { ...b, ...data } : b),
      })),
      addBarber: (barber) => set((state) => ({ barbers: [...state.barbers, barber] })),
      removeBarber: (id) => set((state) => ({
        barbers: state.barbers.filter(b => b.id !== id),
      })),

      updateService: (id, data) => set((state) => ({
        services: state.services.map(s => s.id === id ? { ...s, ...data } : s),
      })),
      addService: (service) => set((state) => ({ services: [...state.services, service] })),
      removeService: (id) => set((state) => ({
        services: state.services.filter(s => s.id !== id),
      })),

      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings },
      })),

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'greco-control-store',
      storage: createJSONStorage(() => localStorage),
      // Não persistir o sidebar (é estado de UI)
      partialize: (state) => ({
        barbers: state.barbers,
        services: state.services,
        entries: state.entries,
        settings: state.settings,
        weeklySummaries: state.weeklySummaries,
      }),
    }
  )
);
