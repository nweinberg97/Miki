import { useSyncExternalStore } from "react";
import { cx, uid } from "../lib/util";
import { IconX } from "./icons";

export interface Toast {
  id: string;
  message: string;
  tone: "neutral" | "success" | "error";
  action?: { label: string; onClick: () => void | Promise<void> };
  duration: number;
}

let toasts: Toast[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function toast(message: string, opts: Partial<Omit<Toast, "id" | "message">> = {}): string {
  const t: Toast = { id: uid(8), message, tone: opts.tone ?? "neutral", action: opts.action, duration: opts.duration ?? (opts.action ? 7000 : 3200) };
  toasts = [...toasts.slice(-3), t];
  emit();
  if (t.duration > 0) timers.set(t.id, setTimeout(() => dismiss(t.id), t.duration));
  return t.id;
}

export function dismiss(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Report an unexpected error without losing the user's place. */
export function toastError(err: unknown, fallback = "Something went wrong.") {
  const msg = err instanceof Error && err.message ? err.message : fallback;
  console.error(err);
  toast(msg, { tone: "error", duration: 6000 });
}

/** Standard "Deleted. Undo" toast for reversible deletions. */
export function toastUndo(message: string, restore: () => Promise<void>) {
  toast(message, {
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          await restore();
          toast("Restored.");
        } catch (e) {
          toastError(e, "Couldn't restore.");
        }
      },
    },
  });
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      <div aria-live="polite" className="toasts-inner">
        {list.map((t) => (
          <div key={t.id} className={cx("toast", `toast-${t.tone}`)} role={t.tone === "error" ? "alert" : "status"}>
            <span className="grow">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  void t.action!.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <IconX size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
