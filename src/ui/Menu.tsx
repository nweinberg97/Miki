import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/util";
import { IconCheck } from "./icons";

type IconComp = ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;

export type MenuItem =
  | { label: string; icon?: IconComp; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string; checked?: boolean }
  | { separator: true }
  | { heading: string };

export interface MenuTriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
}

/** Popover menu with full keyboard support (arrows, Home/End, typeahead-free, Escape returns focus). */
export function Menu({
  trigger,
  items,
  align = "end",
  label,
}: {
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  align?: "start" | "end";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerEl = useRef<HTMLButtonElement | null>(null);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerEl.current?.focus();
  }, []);
  return (
    <>
      {trigger({
        ref: (el) => {
          triggerEl.current = el;
        },
        onClick: () => setOpen((o) => !o),
        "aria-haspopup": "menu",
        "aria-expanded": open,
      })}
      {open && <MenuPopover anchor={triggerEl.current} items={typeof items === "function" ? items() : items} align={align} onClose={close} label={label} />}
    </>
  );
}

export function MenuPopover({
  anchor,
  point,
  items,
  align = "end",
  onClose,
  label,
}: {
  anchor?: HTMLElement | null;
  point?: { x: number; y: number };
  items: MenuItem[];
  align?: "start" | "end";
  onClose: (refocus?: boolean) => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let top: number;
    let left: number;
    if (point) {
      top = point.y;
      left = point.x;
    } else if (anchor) {
      const r = anchor.getBoundingClientRect();
      top = r.bottom + 6;
      left = align === "end" ? r.right - mw : r.left;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    } else {
      top = window.innerHeight / 2 - mh / 2;
      left = window.innerWidth / 2 - mw / 2;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
    setPos({ top, left });
  }, [anchor, point, align]);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose(false);
    };
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchor, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === "Tab") {
      onClose(false);
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="menu"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => {
        if ("separator" in item) return <div key={i} className="menu-sep" role="separator" />;
        if ("heading" in item)
          return (
            <div key={i} className="menu-heading" role="presentation">
              {item.heading}
            </div>
          );
        const Icon = item.icon;
        return (
          <button
            key={i}
            type="button"
            role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            className={cx("menu-item", item.danger && "is-danger")}
            onClick={() => {
              if (item.disabled) return;
              onClose(false);
              item.onSelect();
            }}
          >
            <span className="menu-item-icon" aria-hidden>
              {item.checked ? <IconCheck size={15} /> : Icon ? <Icon size={15} /> : null}
            </span>
            <span className="grow">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
