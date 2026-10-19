import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "../lib/util";
import { IconX } from "./icons";
import { Button, IconButton, TextInput } from "./ui";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Hide the visible title (still announced to screen readers). */
  hideTitle?: boolean;
}

/** Accessible modal built on the native <dialog> element (focus trap and Escape for free). */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", className, hideTitle }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      returnFocus.current = document.activeElement;
      el.showModal();
      const auto = el.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
      auto?.focus();
    } else if (!open && el.open) {
      el.close();
      if (returnFocus.current instanceof HTMLElement && document.contains(returnFocus.current)) returnFocus.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx("dialog", `dialog-${size}`, className)}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog-inner">
          <header className={cx("dialog-header", hideTitle && "is-bare")}>
            <div className="grow">
              <h2 id={titleId} className={cx("dialog-title", hideTitle && "sr-only")}>
                {title}
              </h2>
              {description && <p className="dialog-desc">{description}</p>}
            </div>
            <IconButton icon={IconX} label="Close" onClick={onClose} size="sm" />
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/* ------------------------------------------------------------------ imperative confirm / prompt */

interface ConfirmRequest {
  kind: "confirm";
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  resolve: (v: boolean) => void;
}
interface PromptRequest {
  kind: "prompt";
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  resolve: (v: string | null) => void;
}
type Request = ConfirmRequest | PromptRequest;

let current: Request | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function confirmDialog(opts: Omit<ConfirmRequest, "kind" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    current?.kind === "confirm" ? current.resolve(false) : current?.resolve(null);
    current = { kind: "confirm", ...opts, resolve };
    emit();
  });
}

export function promptDialog(opts: Omit<PromptRequest, "kind" | "resolve">): Promise<string | null> {
  return new Promise((resolve) => {
    current?.kind === "confirm" ? current.resolve(false) : current?.resolve(null);
    current = { kind: "prompt", ...opts, resolve };
    emit();
  });
}

export function DialogHost() {
  const req = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
  const [value, setValue] = useState("");
  useEffect(() => {
    if (req?.kind === "prompt") setValue(req.initial ?? "");
  }, [req]);

  const finish = (result: boolean | string | null) => {
    if (!req) return;
    current = null;
    emit();
    if (req.kind === "confirm") req.resolve(Boolean(result));
    else req.resolve(typeof result === "string" ? result : null);
  };

  if (!req) return null;
  if (req.kind === "confirm") {
    return (
      <Dialog
        open
        size="sm"
        onClose={() => finish(false)}
        title={req.title}
        footer={
          <>
            <Button variant="ghost" onClick={() => finish(false)}>
              {req.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={req.tone === "danger" ? "danger" : "primary"} onClick={() => finish(true)} data-autofocus>
              {req.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {req.body && <div className="dialog-text">{req.body}</div>}
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      size="sm"
      onClose={() => finish(null)}
      title={req.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="prompt-form" disabled={!value.trim()}>
            {req.confirmLabel ?? "Save"}
          </Button>
        </>
      }
    >
      <form
        id="prompt-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) finish(value.trim());
        }}
      >
        <label className="field-label" htmlFor="prompt-input">
          {req.label}
        </label>
        <TextInput id="prompt-input" data-autofocus value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} />
      </form>
    </Dialog>
  );
}
