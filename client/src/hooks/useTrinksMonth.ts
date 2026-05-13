/**
 * useTrinksMonth — fonte de dados Trinks para qualquer mês selecionado.
 *
 * Para o mês corrente: usa o cache global do useTrinksStore (sync ao vivo).
 * Para meses passados: busca via /api/mes/:mes/dados (resolutor "mais recente
 * vence" entre CSV e Trinks).
 *
 * Padroniza a forma como cada página explora histórico mensal sem duplicar
 * lógica de fetch/state.
 */
import { useEffect, useState, useMemo } from "react";
import { useTrinksStore, type TrinksData } from "@/lib/trinksStore";
import { mesAtualSP } from "@/lib/mesUtils";

const API_BASE = (globalThis as any).__API_BASE__ || "";

export type FonteUI = "atual" | "trinks" | "csv" | "nenhuma";

export interface UseTrinksMonthResult {
  /** Pacote efetivo de dados Trinks (transacoes, agendamentos, etc.) — pode ser null. */
  trinks: TrinksData | null;
  /** True quando há transações ou agendamentos disponíveis. */
  hasTrinksData: boolean;
  /** True enquanto busca dados do mês (apenas para meses não-corrente). */
  loading: boolean;
  /** Mensagem de erro se o fetch falhou. */
  error: string | null;
  /** Fonte vencedora (CSV vs Trinks) para badge. */
  fonte: FonteUI;
  trinksAt: string | null;
  csvAt: string | null;
  /** True se o mês selecionado é o corrente (em SP). */
  isMesCorrente: boolean;
  /** Mês corrente em SP (YYYY-MM) — útil para limites do seletor. */
  mesCorrente: string;
}

export function useTrinksMonth(selectedMes: string): UseTrinksMonthResult {
  const { isConnected, trinks: trinksAtual } = useTrinksStore();
  const mesCorrente = useMemo(() => mesAtualSP(), []);
  const isMesCorrente = selectedMes === mesCorrente;

  const [trinksMes, setTrinksMes] = useState<TrinksData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fonte, setFonte] = useState<FonteUI>("atual");
  const [trinksAt, setTrinksAt] = useState<string | null>(null);
  const [csvAt, setCsvAt] = useState<string | null>(null);

  // v37: SEMPRE busca o pacote completo via resolutor. Antes só fazia pra meses
  // passados — pro mês corrente dependia 100% da useTrinksStore que fica vazia
  // quando API Trinks está em 429. Agora o resolutor (que tenta snapshot →
  // csv-financeiro → csv-agendamentos → trinks) é fonte secundária garantida.
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/mes/${selectedMes}/dados`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (canceled) return;
        if (!r.ok) {
          setError(j?.error || `Falha ao carregar ${selectedMes}.`);
          setTrinksMes(null);
          setFonte("nenhuma");
          setTrinksAt(null);
          setCsvAt(null);
          return;
        }
        setTrinksMes(j?.dados || null);
        const f = j?.fonte;
        setFonte(f === "csv" || f === "trinks" || f === "nenhuma" ? f : "atual");
        setTrinksAt(j?.trinksAt || null);
        setCsvAt(j?.csvAt || null);
      })
      .catch((e) => {
        if (canceled) return;
        setError(String(e?.message || e));
        setTrinksMes(null);
      })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [selectedMes, isMesCorrente]);

  // v37: pra mês corrente prefere store (live) quando tem dado, senão usa
  // resolutor (snapshot/CSV). Pra meses passados, usa só o resolutor.
  const storeTemDado = isMesCorrente && trinksAtual && Array.isArray((trinksAtual as any)?.transacoes) && ((trinksAtual as any).transacoes.length > 0);
  const trinks = isMesCorrente
    ? (storeTemDado ? trinksAtual : trinksMes)
    : trinksMes;
  const hasTrinksData = !!trinks && (
    (Array.isArray((trinks as any)?.transacoes) && (trinks as any).transacoes.length > 0) ||
    (Array.isArray((trinks as any)?.agendamentos) && (trinks as any).agendamentos.length > 0)
  );

  return {
    trinks,
    hasTrinksData,
    loading,
    error,
    fonte,
    trinksAt,
    csvAt,
    isMesCorrente,
    mesCorrente,
  };
}
