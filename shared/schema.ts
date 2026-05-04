import { z } from "zod";

// Types for the CRM - we use plain TS types since this is demo/in-memory

export interface Barber {
  id: string;
  name: string;
  initials: string;
  commission: number; // percentage
  revenue: number;
  clients: number;
  avgTicket: number;
  occupationRate: number;
  active: boolean;
}

export interface Service {
  id: string;
  name: string;
  price: number;
  avgDuration: number; // minutes
  cost: number;
  margin: number;
  popularity: number; // count this month
}

export interface DailyEntry {
  id: string;
  date: string; // YYYY-MM-DD
  type: 'receita' | 'despesa';
  description: string;
  amount: number;
  clients?: number;
  pix?: number;
  cartao?: number;
  dinheiro?: number;
  category?: string;
  notes?: string;
}

export interface WeeklySummary {
  id: string;
  weekLabel: string;
  startDate: string;
  endDate: string;
  revenue: number;
  expenses: number;
  profit: number;
  clients: number;
  notes: string;
}

export interface MonthlyGoal {
  month: string; // YYYY-MM
  target: number;
  achieved: number;
}

export interface Settings {
  shopName: string;
  address: string;
  hours: string;
  trinksApiKey: string;
  trinksEstablishmentId: string;
  perplexityApiKey: string;
  defaultCommission: number;
  monthlyTarget: number;
  chairs: number;
  // Configuração de categorização de profissionais (afeta DRE e cálculo de comissão).
  // Listas com NOMES (maiúsculas, primeiro nome ou nome completo) — case-insensitive.
  profissionaisEstetica?: string[];   // entram em "Serviços de estética" no DRE
  profissionaisVip?: string[];         // ganham comissão VIP (default 50%)
  profissionaisExpress?: string[];     // ganham comissão Express (default 50%)
  comissaoVipExpressPct?: number;      // default 50
  comissaoPadraoPct?: number;          // default 40
}

// Zod schemas for form validation
export const dailyEntrySchema = z.object({
  date: z.string(),
  type: z.enum(['receita', 'despesa']),
  description: z.string().min(1),
  amount: z.number().min(0),
  clients: z.number().optional(),
  pix: z.number().optional(),
  cartao: z.number().optional(),
  dinheiro: z.number().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
});

export const barberSchema = z.object({
  name: z.string().min(1),
  commission: z.number().min(0).max(100),
});

export const serviceSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
  avgDuration: z.number().min(0),
  cost: z.number().min(0),
});

export const settingsSchema = z.object({
  shopName: z.string(),
  address: z.string(),
  hours: z.string(),
  trinksApiKey: z.string(),
  trinksEstablishmentId: z.string(),
  perplexityApiKey: z.string(),
  defaultCommission: z.number(),
  monthlyTarget: z.number(),
  chairs: z.number(),
});

export type InsertDailyEntry = z.infer<typeof dailyEntrySchema>;
export type InsertBarber = z.infer<typeof barberSchema>;
export type InsertService = z.infer<typeof serviceSchema>;
export type InsertSettings = z.infer<typeof settingsSchema>;

// Keep original user types for template compatibility
export interface User {
  id: string;
  username: string;
  password: string;
}
export interface InsertUser {
  username: string;
  password: string;
}
