import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentType,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "../lib/util";

type IconComp = ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean }>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "quiet";
  size?: "sm" | "md" | "lg";
  icon?: IconComp;
  iconRight?: IconComp;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, iconRight: IconRight, busy, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("btn", `btn-${variant}`, `btn-${size}`, busy && "is-busy", className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner size={14} /> : Icon ? <Icon size={size === "sm" ? 14 : 16} aria-hidden /> : null}
      {children != null && <span className="btn-label">{children}</span>}
      {IconRight && <IconRight size={14} aria-hidden />}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconComp;
  label: string;
  size?: "sm" | "md";
  variant?: "ghost" | "secondary" | "quiet";
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = "md", variant = "ghost", pressed, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx("icon-btn", `icon-btn-${size}`, `icon-btn-${variant}`, pressed && "is-pressed", className)}
      {...rest}
    >
      <Icon size={size === "sm" ? 15 : 17} aria-hidden />
    </button>
  );
});

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <svg className="spin spinner" width={size} height={size} viewBox="0 0 24 24" role={label ? "img" : undefined} aria-label={label} aria-hidden={!label}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "moss" | "warm" | "danger"; className?: string }) {
  return <span className={cx("badge", `badge-${tone}`, className)}>{children}</span>;
}

export function Field({ label, hint, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cx("field", className)}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cx("input", className)} {...rest} />;
});

interface AutoTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
  maxHeight?: number;
}

/** Textarea that grows with its content. */
export const TextArea = forwardRef<HTMLTextAreaElement, AutoTextAreaProps>(function TextArea({ className, minRows = 3, maxHeight, value, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    const h = el.scrollHeight + 2;
    el.style.height = `${maxHeight ? Math.min(h, maxHeight) : h}px`;
    el.style.overflowY = maxHeight && h > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      rows={minRows}
      value={value}
      className={cx("input textarea", className)}
      {...rest}
    />
  );
});

/**
 * An input that looks like plain text until focused. Commits on blur or Enter;
 * Escape reverts. Used for titles everywhere.
 */
export function InlineEdit({
  value,
  onCommit,
  placeholder,
  className,
  label,
  multiline,
  autoFocus,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  label: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const draft = useRef(value);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.value = value;
      draft.current = value;
      resize();
    }
  }, [value]);
  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [autoFocus]);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(resize, []);
  const commit = () => {
    const v = (ref.current?.value ?? "").replace(multiline ? /\r/g : /\s*\n\s*/g, multiline ? "" : " ");
    if (v !== value) onCommit(v.trim() === "" && !multiline ? value : v);
  };
  return (
    <textarea
      ref={ref}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      rows={1}
      spellCheck
      className={cx("inline-edit", className)}
      onInput={resize}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (ref.current) ref.current.value = value;
          resize();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  className,
  compact,
}: {
  icon?: IconComp;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cx("empty", compact && "empty-compact", className)}>
      {Icon && (
        <div className="empty-icon" aria-hidden>
          <Icon size={compact ? 18 : 22} />
        </div>
      )}
      <h3 className="empty-title">{title}</h3>
      {children && <div className="empty-body">{children}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: IconComp; title?: string }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("segmented", `segmented-${size}`)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={cx("segmented-item", value === o.value && "is-active")}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value);
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              onChange(options[(i + 1) % options.length].value);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              onChange(options[(i - 1 + options.length) % options.length].value);
            }
          }}
          tabIndex={value === o.value ? 0 : -1}
        >
          {o.icon && <o.icon size={size === "sm" ? 13 : 15} aria-hidden />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  className,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  className?: string;
  id?: string;
}) {
  return (
    <span className={cx("select-wrap", className)}>
      <select id={id} aria-label={label} className="input select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
