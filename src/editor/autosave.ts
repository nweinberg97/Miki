// Save lifecycle for a document:
//   change → (recovery copy in localStorage, synchronously) → debounced IndexedDB write → "Saved"
// "Saved" is shown only after the IndexedDB transaction commits. Failed writes keep retrying,
// and the recovery copy survives tab closes and crashes until a write succeeds.
import { useCallback, useEffect, useRef, useState } from "react";
import { saveDocumentContent } from "../data/repo";
import type { DocContent } from "../data/types";
import { docToPlainText } from "./serialize";
import { wordCount } from "../lib/util";

export type SaveStatus = "saved" | "pending" | "saving" | "error";

export interface RecoveryEntry {
  content: DocContent;
  at: number;
}

const recoveryKey = (docId: string) => `miki:recovery:${docId}`;

export function readRecovery(docId: string): RecoveryEntry | null {
  try {
    const raw = localStorage.getItem(recoveryKey(docId));
    if (!raw) return null;
    const v = JSON.parse(raw) as RecoveryEntry;
    return v && v.content?.type === "doc" && typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}

function writeRecovery(docId: string, content: DocContent) {
  try {
    localStorage.setItem(recoveryKey(docId), JSON.stringify({ content, at: Date.now() }));
    return true;
  } catch {
    return false; // quota or disabled storage; IndexedDB save still proceeds
  }
}

export function clearRecovery(docId: string) {
  try {
    localStorage.removeItem(recoveryKey(docId));
  } catch {
    /* ignore */
  }
}

const DEBOUNCE = 700;
const RETRY = [2000, 5000, 15000, 30000];

export interface Autosave {
  status: SaveStatus;
  error: string | null;
  lastSavedAt: number | null;
  /** Timestamps written by this editor session, used to tell our saves apart from external changes. */
  ownWrites: React.MutableRefObject<Set<number>>;
  change: (getContent: () => DocContent) => void;
  flush: () => Promise<void>;
  retry: () => void;
}

export function useAutosave(docId: string): Autosave {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const pending = useRef<(() => DocContent) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const attempts = useRef(0);
  const ownWrites = useRef(new Set<number>());
  const mounted = useRef(true);
  const docIdRef = useRef(docId);
  docIdRef.current = docId;

  const safeSet = <T,>(fn: (v: T) => void, v: T) => {
    if (mounted.current) fn(v);
  };

  const save = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      await inflight.current;
      if (!pending.current) return;
    }
    const get = pending.current;
    if (!get) return;
    pending.current = null;
    const id = docIdRef.current;
    const content = get();
    const plain = docToPlainText(content);
    safeSet(setStatus, "saving");
    const run = (async () => {
      try {
        const at = await saveDocumentContent(id, content, plain, wordCount(plain));
        ownWrites.current.add(at);
        attempts.current = 0;
        safeSet(setError, null);
        safeSet(setLastSavedAt, at);
        if (!pending.current) {
          clearRecovery(id);
          safeSet(setStatus, "saved");
        } else safeSet(setStatus, "pending");
      } catch (e) {
        // Put the content back so the next attempt includes it.
        if (!pending.current) pending.current = () => content;
        writeRecovery(id, content);
        safeSet(setStatus, "error");
        safeSet(setError, e instanceof Error ? e.message : "Couldn't save.");
        const delay = RETRY[Math.min(attempts.current, RETRY.length - 1)];
        attempts.current++;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          void save();
        }, delay);
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    if (pending.current && !timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        void save();
      }, DEBOUNCE);
    }
  }, []);

  const change = useCallback(
    (getContent: () => DocContent) => {
      pending.current = getContent;
      setStatus((s) => (s === "error" ? "error" : "pending"));
      // Recovery copy: cheap insurance against closing the tab mid-debounce.
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
      recoveryTimer.current = setTimeout(() => {
        if (pending.current) writeRecovery(docIdRef.current, pending.current());
      }, 250);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void save();
      }, DEBOUNCE);
    },
    [save],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) writeRecovery(docIdRef.current, pending.current());
    await save();
  }, [save]);

  const retry = useCallback(() => {
    attempts.current = 0;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void save();
  }, [save]);

  useEffect(() => {
    mounted.current = true;
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => void flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) writeRecovery(docIdRef.current, pending.current());
      if (pending.current || inflight.current) {
        void flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      mounted.current = false;
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
      // Commit whatever is pending even though the editor is going away.
      void flush();
    };
  }, [flush]);

  return { status, error, lastSavedAt, ownWrites, change, flush, retry };
}
