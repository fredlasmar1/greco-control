import { create } from 'zustand';
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
  updateBarber: (id: string, data: Partial<Barber>) => void;
  addBarber: (barber: Barber) => void;
  updateService: (id: string, data: Partial<Service>) => void;
  addService: (service: Service) => void;
  updateSettings: (settings: Partial<Settings>) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  barbers: demoBarbers,
  services: demoServices,
  entries: demoDailyEntries,
  settings: defaultSettings,
  weeklySummaries: demoWeeklySummaries,
  sidebarOpen: false,

  addEntry: (entry) => set((state) => ({ entries: [entry, ...state.entries] })),
  
  updateBarber: (id, data) => set((state) => ({
    barbers: state.barbers.map(b => b.id === id ? { ...b, ...data } : b),
  })),

  addBarber: (barber) => set((state) => ({ barbers: [...state.barbers, barber] })),
  
  updateService: (id, data) => set((state) => ({
    services: state.services.map(s => s.id === id ? { ...s, ...data } : s),
  })),

  addService: (service) => set((state) => ({ services: [...state.services, service] })),
  
  updateSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings },
  })),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
