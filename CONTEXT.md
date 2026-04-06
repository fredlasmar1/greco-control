# Greco Control — Context for Development

## Project Structure
- Express + Vite + React + Tailwind + shadcn/ui + Zustand
- Server: `server/routes.ts` (Express on port 5000)
- Frontend: `client/src/pages/*.tsx`
- State: `client/src/lib/store.ts` (Zustand) + `client/src/lib/trinksStore.ts` (Trinks API)
- Schema: `shared/schema.ts`
- Routing: hash-based (`useHashLocation` from wouter)
- App layout: `client/src/components/AppLayout.tsx` — sidebar nav + header
- NO localStorage/sessionStorage (sandbox restriction)

## Design System
- Dark theme (barbershop aesthetic)
- Primary: #01696F (teal), accent highlights
- Background: dark grays from index.css
- All text in Brazilian Portuguese (PT-BR)
- Currency: R$ with Brazilian formatting (dots thousands, comma decimals)
- Use `formatCurrency` from `@/lib/demoData` for currency
- Icons: lucide-react
- Charts: recharts
- Mobile responsive required

## Owner
- Fred Lasmar, owner of Greco Barbearia Anápolis
- 16+ professionals (barbeiros + assistentes)  
- Revenue goal: R$150,000/month
- Fixed costs: Cloudia, Trinks, Instagram subscription

## Current Nav Items (in AppLayout.tsx)
Dashboard, Lançamentos, Equipe, Serviços, Financeiro, Fechamento, Metas, Configurações

## Important Rules
- Use `useHashLocation` for routing
- Use `apiRequest` from `@/lib/queryClient` for HTTP requests (never raw fetch)
- Add `data-testid` to interactive elements
- Use shadcn components from `@/components/ui/*`
- `import { useToast } from "@/hooks/use-toast"` for notifications
