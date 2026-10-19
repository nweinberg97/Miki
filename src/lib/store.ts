// Minimal external store for transient UI state (not persisted).
import { useSyncExternalStore } from "react";

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      subs.forEach((s) => s());
    },
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    use<U>(selector: (s: T) => U): U {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSyncExternalStore(this.subscribe, () => selector(state));
    },
  };
}

export interface CaptureRequest {
  tab: "write" | "speak";
  projectId?: string;
}

export const ui = createStore({
  capture: null as CaptureRequest | null,
  palette: false,
  focusMode: false,
  shortcuts: false,
});

export function openCapture(req: Partial<CaptureRequest> = {}) {
  ui.set({ capture: { tab: req.tab ?? "write", projectId: req.projectId } });
}
