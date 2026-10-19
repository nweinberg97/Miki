import { useEffect, useRef, useState } from "react";
import { db, subscribe } from "./db";
import type { StoreName } from "./types";

export interface Live<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
}

/**
 * Run an async query and re-run it whenever one of `stores` changes (in this tab or another).
 * Keeps showing the previous result while refreshing, so the UI never flickers to empty.
 */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], stores: StoreName[]): Live<T> {
  const [state, setState] = useState<Live<T>>({ data: undefined, loading: true, error: null });
  const queryRef = useRef(query);
  queryRef.current = query;
  const storesKey = stores.join(",");

  useEffect(() => {
    let cancelled = false;
    let seq = 0;
    const run = () => {
      const mine = ++seq;
      queryRef
        .current()
        .then((data) => {
          if (!cancelled && mine === seq) setState({ data, loading: false, error: null });
        })
        .catch((error: unknown) => {
          if (!cancelled && mine === seq) setState((s) => ({ data: s.data, loading: false, error: error instanceof Error ? error : new Error(String(error)) }));
        });
    };
    setState((s) => ({ ...s, loading: true }));
    run();
    const watched = new Set(storesKey.split(","));
    const unsub = subscribe((changed) => {
      for (const s of changed) {
        if (watched.has(s)) {
          run();
          return;
        }
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, storesKey]);

  return state;
}

export function useRecord<S extends StoreName>(store: S, id: string | null | undefined) {
  return useLive(() => (id ? db.get(store, id) : Promise.resolve(undefined)), [store, id], [store]);
}

export function useByProject<S extends StoreName>(store: S, projectId: string | null | undefined) {
  return useLive(() => (projectId ? db.byIndex(store, "projectId", projectId) : Promise.resolve([])), [store, projectId], [store]);
}

export function useAll<S extends StoreName>(store: S) {
  return useLive(() => db.getAll(store), [store], [store]);
}
