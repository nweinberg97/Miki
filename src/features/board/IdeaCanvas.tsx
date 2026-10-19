import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  addLink,
  CARD_H,
  CARD_W,
  createCard,
  createSection,
  deleteCards,
  deleteSection,
  findFreeSpot,
  moveSection,
  updateBoard,
  updateCards,
  updateSection,
} from "../../data/repo";
import type { Card, CardType, LinkKind, Project, Section } from "../../data/types";
import { clamp, cx, isTypingTarget, plural } from "../../lib/util";
import { promptDialog } from "../../ui/Dialog";
import {
  IconChevronDown,
  IconChevronRight,
  IconConnect,
  IconFilter,
  IconFit,
  IconMinus,
  IconMore,
  IconMoveTo,
  IconPencil,
  IconPlus,
  IconSection,
  IconTrash,
  IconX,
} from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toastError, toastUndo } from "../../ui/toast";
import { Button, IconButton, InlineEdit } from "../../ui/ui";
import type { BoardData } from "./BoardMode";
import { useLinkCounts, useRefNames } from "./BoardMode";
import { CardFace } from "./CardFace";
import { CARD_META, LINK_KINDS } from "./cardMeta";

const MIN_Z = 0.25;
const MAX_Z = 1.6;
const EDGE = 120; // how much of the sheet must stay on screen while panning
const MARGIN = 240; // breathing room around the content
const COLLAPSED_H = 64;

interface View {
  x: number;
  y: number;
  zoom: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const cardRect = (c: Pick<Card, "x" | "y">): Rect => ({ x: c.x, y: c.y, w: CARD_W, h: CARD_H });
const sectionRect = (s: Section): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.collapsed ? COLLAPSED_H : s.h });
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const contains = (r: Rect, px: number, py: number) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where the line from a card's centre towards a target leaves the card's rectangle. */
function edgePoint(cx: number, cy: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const k = 1 / Math.max(Math.abs(dx) / (CARD_W / 2 + 6), Math.abs(dy) / (CARD_H / 2 + 6));
  return [cx + dx * Math.min(k, 1), cy + dy * Math.min(k, 1)];
}

/** Track a pointer gesture with a small dead zone so clicks stay clicks. */
function track(e: ReactPointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp: (moved: boolean, ev: PointerEvent) => void) {
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    onMove(dx, dy, ev);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onUp(moved, ev);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

export function IdeaCanvas({ project, data, onOpen, selectedId }: { project: Project; data: BoardData; onOpen: (id: string) => void; selectedId: string | null }) {
  const { board, sections, cards, links } = data;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(board.viewport ?? { x: 48, y: 72, zoom: 0.9 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [selection, setSelection] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));
  const [drag, setDrag] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [frameDrag, setFrameDrag] = useState<{ id: string; dx: number; dy: number; mode: "move" | "resize" } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<CardType | null>(null);
  const [panning, setPanning] = useState(false);
  const refNames = useRefNames(data);
  const linkCounts = useLinkCounts(data);
  const collapsed = useMemo(() => new Set(sections.filter((s) => s.collapsed).map((s) => s.id)), [sections]);

  useEffect(() => {
    if (selectedId) setSelection((s) => (s.has(selectedId) ? s : new Set([selectedId])));
  }, [selectedId]);

  /* ---------------------------------------------------------------- geometry */

  const pos = useCallback(
    (c: Card) => (drag && drag.ids.includes(c.id) ? { x: c.x + drag.dx, y: c.y + drag.dy } : { x: c.x, y: c.y }),
    [drag],
  );
  const frame = useCallback(
    (s: Section): Rect => {
      const r = sectionRect(s);
      if (frameDrag?.id !== s.id) return r;
      if (frameDrag.mode === "move") return { ...r, x: r.x + frameDrag.dx, y: r.y + frameDrag.dy };
      return { ...r, w: Math.max(260, r.w + frameDrag.dx), h: s.collapsed ? r.h : Math.max(180, r.h + frameDrag.dy) };
    },
    [frameDrag],
  );
  const visibleCards = useMemo(() => cards.filter((c) => !c.sectionId || !collapsed.has(c.sectionId)), [cards, collapsed]);

  const contentBounds = useMemo(
    () => unionRects([...sections.map(sectionRect), ...visibleCards.map(cardRect)]) ?? { x: 0, y: 0, w: 1200, h: 700 },
    [sections, visibleCards],
  );
  // The sheet: the bounded working area. Grows with the work, never infinite.
  const sheet = useMemo<Rect>(() => {
    const x = Math.min(contentBounds.x, 0) - MARGIN;
    const y = Math.min(contentBounds.y, 0) - MARGIN;
    const w = Math.max(contentBounds.x + contentBounds.w, 1400) + MARGIN - x;
    const h = Math.max(contentBounds.y + contentBounds.h, 900) + MARGIN - y;
    return { x, y, w, h };
  }, [contentBounds]);

  const clampView = useCallback(
    (v: View): View => {
      const el = viewportRef.current;
      if (!el) return v;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const z = clamp(v.zoom, MIN_Z, MAX_Z);
      const x = clamp(v.x, EDGE - (sheet.x + sheet.w) * z, W - EDGE - sheet.x * z);
      const y = clamp(v.y, EDGE - (sheet.y + sheet.h) * z, H - EDGE - sheet.y * z);
      return { x, y, zoom: z };
    },
    [sheet],
  );

  const toWorld = (clientX: number, clientY: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };

  const fitTo = useCallback(
    (rect: Rect | null, maxZoom = 1.1) => {
      const el = viewportRef.current;
      if (!el || !rect) return;
      const W = el.clientWidth;
      const H = el.clientHeight - 70; // leave room for the toolbar
      const pad = 60;
      const zoom = clamp(Math.min((W - pad * 2) / Math.max(rect.w, 1), (H - pad * 2) / Math.max(rect.h, 1), maxZoom), MIN_Z, MAX_Z);
      const x = (W - rect.w * zoom) / 2 - rect.x * zoom;
      const y = (H - rect.h * zoom) / 2 - rect.y * zoom + 10;
      setView(clampView({ x, y, zoom }));
    },
    [clampView],
  );

  const fitAll = useCallback(() => fitTo(unionRects([...sections.map(sectionRect), ...visibleCards.map(cardRect)])), [fitTo, sections, visibleCards]);

  // First visit: frame everything. Afterwards, restore where the writer left the view.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (!board.viewport) fitAll();
    else if (selectedId) {
      const c = cards.find((x) => x.id === selectedId);
      if (c) fitTo({ x: c.x - 200, y: c.y - 160, w: CARD_W + 400, h: CARD_H + 320 }, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the viewport, quietly.
  useEffect(() => {
    const t = setTimeout(() => void updateBoard(board.id, { viewport: view }).catch(() => undefined), 700);
    return () => clearTimeout(t);
  }, [view, board.id]);

  // Wheel: pan with two fingers / wheel; zoom with pinch or ⌘/Ctrl + wheel.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".board-toolbar, .card-panel")) return;
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.0075), MIN_Z, MAX_Z);
        const k = zoom / v.zoom;
        setView(clampView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k }));
      } else {
        setView(clampView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clampView]);

  const zoomBy = (factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const v = viewRef.current;
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    const zoom = clamp(v.zoom * factor, MIN_Z, MAX_Z);
    const k = zoom / v.zoom;
    setView(clampView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k }));
  };

  /* ---------------------------------------------------------------- actions */

  const sectionAt = (px: number, py: number): Section | undefined =>
    [...sections].sort((a, b) => b.order - a.order).find((s) => contains(sectionRect(s), px, py));

  const addCardAt = async (wx?: number, wy?: number) => {
    try {
      let x = wx;
      let y = wy;
      if (x === undefined || y === undefined) {
        const el = viewportRef.current!;
        const r = el.getBoundingClientRect();
        const c = toWorld(r.left + el.clientWidth / 2, r.top + el.clientHeight / 2 - 40);
        x = c.x - CARD_W / 2;
        y = c.y - CARD_H / 2;
      }
      const s = sectionAt(x + CARD_W / 2, y + CARD_H / 2);
      const card = await createCard({ projectId: project.id, boardId: board.id, sectionId: s && !s.collapsed ? s.id : null, x: Math.round(x), y: Math.round(y), type: "idea" });
      setSelection(new Set([card.id]));
      onOpen(card.id);
    } catch (e) {
      toastError(e, "Couldn't add a card.");
    }
  };

  const addCluster = async () => {
    const title = await promptDialog({ title: "New cluster", label: "Name", placeholder: "e.g. Openings, Evidence, Maybe later", confirmLabel: "Add cluster" });
    if (!title) return;
    try {
      const s = await createSection({ projectId: project.id, boardId: board.id, title });
      fitTo({ x: s.x - 40, y: s.y - 40, w: s.w + 80, h: s.h + 80 }, 0.95);
    } catch (e) {
      toastError(e);
    }
  };

  const removeSelected = async (ids = [...selection]) => {
    if (!ids.length) return;
    try {
      const restore = await deleteCards(ids);
      setSelection(new Set());
      toastUndo(ids.length === 1 ? "Card deleted." : `${ids.length} cards deleted.`, restore);
    } catch (e) {
      toastError(e);
    }
  };

  const moveSelectedTo = async (sectionId: string | null) => {
    const ids = [...selection];
    const target = sections.find((s) => s.id === sectionId);
    const placed: Pick<Card, "x" | "y">[] = cards.filter((c) => !ids.includes(c.id) && (target ? c.sectionId === target.id : true));
    const patches = ids.map((id) => {
      const spot = target ? findFreeSpot(placed, target) : findFreeSpot(placed);
      placed.push(spot);
      return { id, patch: { sectionId: target?.id ?? null, ...spot } };
    });
    await updateCards(patches).catch(toastError);
  };

  const connect = async (kind: LinkKind) => {
    const [a, b] = [...selection];
    if (!a || !b) return;
    await addLink(project.id, { type: "card", id: a }, { type: "card", id: b }, kind).catch(toastError);
  };

  /* ---------------------------------------------------------------- pointer handlers */

  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".card, .frame, .board-toolbar, .board-corner")) return;
    viewportRef.current?.focus({ preventScroll: true });
    if (e.shiftKey) {
      const start = toWorld(e.clientX, e.clientY);
      track(
        e,
        (_dx, _dy, ev) => {
          const now = toWorld(ev.clientX, ev.clientY);
          setMarquee({ x: Math.min(start.x, now.x), y: Math.min(start.y, now.y), w: Math.abs(now.x - start.x), h: Math.abs(now.y - start.y) });
        },
        (moved, ev) => {
          if (moved) {
            const now = toWorld(ev.clientX, ev.clientY);
            const m = { x: Math.min(start.x, now.x), y: Math.min(start.y, now.y), w: Math.abs(now.x - start.x), h: Math.abs(now.y - start.y) };
            setSelection((s) => new Set([...s, ...visibleCards.filter((c) => intersects(cardRect(c), m)).map((c) => c.id)]));
          }
          setMarquee(null);
        },
      );
      return;
    }
    const start = viewRef.current;
    track(
      e,
      (dx, dy) => {
        setPanning(true);
        setView(clampView({ ...start, x: start.x + dx, y: start.y + dy }));
      },
      (moved) => {
        setPanning(false);
        if (!moved) setSelection(new Set());
      },
    );
  };

  const onCardPointerDown = (e: ReactPointerEvent, card: Card) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let ids: string[];
    if (additive) {
      const next = new Set(selection);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      setSelection(next);
      ids = [...next];
    } else if (selection.has(card.id)) ids = [...selection];
    else {
      setSelection(new Set([card.id]));
      ids = [card.id];
    }
    if (!ids.includes(card.id)) return;
    const z = viewRef.current.zoom;
    track(
      e,
      (dx, dy) => setDrag({ ids, dx: dx / z, dy: dy / z }),
      (moved, ev) => {
        if (!moved) {
          setDrag(null);
          return;
        }
        const dx = (ev.clientX - e.clientX) / z;
        const dy = (ev.clientY - e.clientY) / z;
        const placed: Pick<Card, "x" | "y">[] = cards.filter((c) => !ids.includes(c.id));
        const patches = ids.map((id) => {
          const c = cards.find((x) => x.id === id)!;
          let x = Math.round(c.x + dx);
          let y = Math.round(c.y + dy);
          const s = sectionAt(x + CARD_W / 2, y + CARD_H / 2);
          if (s?.collapsed) {
            // Dropped onto a folded cluster: tuck it inside, at a free spot.
            const spot = findFreeSpot(placed, s);
            x = spot.x;
            y = spot.y;
          }
          placed.push({ x, y });
          return { id, patch: { x, y, sectionId: s?.id ?? null } };
        });
        void updateCards(patches)
          .catch(toastError)
          .finally(() => setDrag(null));
      },
    );
  };

  const onFramePointerDown = (e: ReactPointerEvent, s: Section, mode: "move" | "resize") => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("textarea, button")) return;
    e.stopPropagation();
    const z = viewRef.current.zoom;
    track(
      e,
      (dx, dy) => setFrameDrag({ id: s.id, dx: dx / z, dy: dy / z, mode }),
      (moved, ev) => {
        if (!moved) {
          setFrameDrag(null);
          return;
        }
        const dx = Math.round((ev.clientX - e.clientX) / z);
        const dy = Math.round((ev.clientY - e.clientY) / z);
        const p = mode === "move" ? moveSection(s.id, dx, dy) : updateSection(s.id, { w: Math.max(260, s.w + dx), h: s.collapsed ? s.h : Math.max(180, s.h + dy) });
        void p.catch(toastError).finally(() => setFrameDrag(null));
      },
    );
  };

  /* ---------------------------------------------------------------- keyboard */

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isTypingTarget(e.target) || e.metaKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && e.key === "a" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSelection(new Set(visibleCards.map((c) => c.id)));
      }
      return;
    }
    const step = e.shiftKey ? 48 : 12;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key in arrows && selection.size) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      void updateCards([...selection].map((id) => {
        const c = cards.find((x) => x.id === id)!;
        const x = c.x + dx;
        const y = c.y + dy;
        const s = sectionAt(x + CARD_W / 2, y + CARD_H / 2);
        return { id, patch: { x, y, sectionId: s && !s.collapsed ? s.id : null } };
      })).catch(toastError);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selection.size) {
        e.preventDefault();
        void removeSelected();
      }
    } else if (e.key === "Escape") {
      setSelection(new Set());
    } else if (e.key === "Enter" && selection.size === 1) {
      e.preventDefault();
      onOpen([...selection][0]);
    } else if (e.key.toLowerCase() === "n" && !e.ctrlKey) {
      e.preventDefault();
      void addCardAt();
    } else if (e.key.toLowerCase() === "f" && !e.ctrlKey) {
      e.preventDefault();
      if (selection.size) fitTo(unionRects(cards.filter((c) => selection.has(c.id)).map(cardRect)), 1);
      else fitAll();
    } else if (e.key === "=" || e.key === "+") {
      zoomBy(1.2);
    } else if (e.key === "-") {
      zoomBy(1 / 1.2);
    } else if (e.key === "0" && e.ctrlKey) {
      setView((v) => clampView({ ...v, zoom: 1 }));
    }
  };

  /* ---------------------------------------------------------------- render */

  const needle = filter.trim().toLowerCase();
  const matches = (c: Card) => (!needle || `${c.title} ${c.body}`.toLowerCase().includes(needle)) && (!typeFilter || c.type === typeFilter);
  const filtering = Boolean(needle || typeFilter);
  const matchCount = filtering ? visibleCards.filter(matches).length : visibleCards.length;
  const cardById = new Map(visibleCards.map((c) => [c.id, c]));
  const edges = links.filter((l) => l.kind !== "features" && l.from.type === "card" && l.to.type === "card" && cardById.has(l.from.id) && cardById.has(l.to.id));
  const selected = [...selection].filter((id) => cardById.has(id));

  return (
    <div
      ref={viewportRef}
      className={cx("canvas", panning && "is-panning", drag && "is-dragging")}
      tabIndex={-1}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest(".card, .frame-head, .board-toolbar, .board-corner, .frame-resize")) return;
        const w = toWorld(e.clientX, e.clientY);
        void addCardAt(w.x - CARD_W / 2, w.y - 30);
      }}
      onKeyDown={onKeyDown}
      aria-label="Idea space. Cards can be moved with the arrow keys once selected."
      role="application"
    >
      <div className="canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <div className="canvas-sheet" style={{ left: sheet.x, top: sheet.y, width: sheet.w, height: sheet.h }} aria-hidden />
        {sections.map((s) => {
          const r = frame(s);
          const count = cards.filter((c) => c.sectionId === s.id).length;
          const setAside = /set aside|later|parked/i.test(s.title);
          const promising = /promising|keep|strong/i.test(s.title);
          return (
            <section
              key={s.id}
              className={cx("frame", s.collapsed && "is-collapsed", setAside && "is-set-aside", promising && "is-promising", frameDrag?.id === s.id && "is-moving")}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
              aria-label={`${s.title}, ${plural(count, "card")}`}
            >
              <header className="frame-head" onPointerDown={(e) => onFramePointerDown(e, s, "move")}>
                <button
                  type="button"
                  className="frame-toggle"
                  aria-label={s.collapsed ? `Expand ${s.title}` : `Collapse ${s.title}`}
                  aria-expanded={!s.collapsed}
                  onClick={() => void updateSection(s.id, { collapsed: !s.collapsed }).catch(toastError)}
                >
                  {s.collapsed ? <IconChevronRight size={15} aria-hidden /> : <IconChevronDown size={15} aria-hidden />}
                </button>
                <InlineEdit label="Cluster name" className="frame-title" value={s.title} onCommit={(title) => void updateSection(s.id, { title }).catch(toastError)} />
                <span className="frame-count">{count}</span>
                <Menu
                  label={`${s.title} actions`}
                  trigger={(t) => <IconButton {...t} icon={IconMore} label={`Actions for ${s.title}`} size="sm" className="frame-menu" />}
                  items={[
                    {
                      label: "Add a card here",
                      icon: IconPlus,
                      onSelect: () => {
                        const spot = findFreeSpot(cards.filter((c) => c.sectionId === s.id), s);
                        if (s.collapsed) void updateSection(s.id, { collapsed: false });
                        void addCardAt(spot.x, spot.y);
                      },
                    },
                    { label: s.collapsed ? "Expand" : "Collapse", icon: s.collapsed ? IconChevronDown : IconChevronRight, onSelect: () => void updateSection(s.id, { collapsed: !s.collapsed }) },
                    { label: "Zoom to this cluster", icon: IconFit, onSelect: () => fitTo(sectionRect(s), 1.1) },
                    { separator: true },
                    {
                      label: "Remove cluster (keep cards)",
                      icon: IconTrash,
                      danger: true,
                      onSelect: () =>
                        void deleteSection(s.id)
                          .then((restore) => toastUndo(`Removed "${s.title}". Its cards are still on the board.`, restore))
                          .catch(toastError),
                    },
                  ]}
                />
              </header>
              {s.collapsed && count > 0 && <p className="frame-collapsed-hint">{plural(count, "card")} tucked away</p>}
              {!s.collapsed && <div className="frame-resize" onPointerDown={(e) => onFramePointerDown(e, s, "resize")} aria-hidden />}
            </section>
          );
        })}

        <svg className="canvas-edges" style={{ left: sheet.x, top: sheet.y, width: sheet.w, height: sheet.h }} aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((l) => {
            const a = pos(cardById.get(l.from.id)!);
            const b = pos(cardById.get(l.to.id)!);
            const acx = a.x + CARD_W / 2 - sheet.x;
            const acy = a.y + CARD_H / 2 - sheet.y;
            const bcx = b.x + CARD_W / 2 - sheet.x;
            const bcy = b.y + CARD_H / 2 - sheet.y;
            // Start and end at the card edges, not their centres, so lines stay visible between cards.
            const [ax, ay] = edgePoint(acx, acy, bcx, bcy);
            const [bx, by] = edgePoint(bcx, bcy, acx, acy);
            const len = Math.hypot(bx - ax, by - ay) || 1;
            const bend = Math.min(40, len * 0.15);
            const mx = (ax + bx) / 2 + (-(by - ay) / len) * bend;
            const my = (ay + by) / 2 + ((bx - ax) / len) * bend;
            const dim = filtering && !(matches(cardById.get(l.from.id)!) && matches(cardById.get(l.to.id)!));
            return (
              <g key={l.id} className={cx("edge", `edge-${l.kind}`, dim && "is-dim")}>
                <path d={`M${ax},${ay} Q${mx},${my} ${bx},${by}`} markerEnd={l.kind === "leads" || l.kind === "depends" || l.kind === "supports" ? "url(#arrow)" : undefined} />
                {l.kind !== "related" && (
                  <text x={(ax + 2 * mx + bx) / 4} y={(ay + 2 * my + by) / 4 + 4} textAnchor="middle">
                    {LINK_KINDS.find((k) => k.kind === l.kind)?.label.toLowerCase()}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {visibleCards.map((c) => {
          const p = pos(c);
          const isSel = selection.has(c.id);
          const dim = filtering && !matches(c);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={`${CARD_META[c.type].label}: ${c.title || c.body.slice(0, 60) || "Untitled"}`}
              className={cx("card", `card-${c.type}`, isSel && "is-selected", drag?.ids.includes(c.id) && "is-dragging", dim && "is-dim")}
              style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
              onPointerDown={(e) => onCardPointerDown(e, c)}
              onDoubleClick={() => onOpen(c.id)}
              onFocus={() => {
                if (!selection.has(c.id)) setSelection(new Set([c.id]));
              }}
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                  onOpen(c.id);
                }
              }}
            >
              <CardFace card={c} linkCount={linkCounts.get(c.id)} refNames={refNames.get(c.id)} highlight={needle || undefined} />
            </div>
          );
        })}

        {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      </div>

      {cards.length === 0 && sections.length === 0 && (
        <div className="canvas-empty">
          <p className="canvas-empty-title">An open space for early ideas.</p>
          <p className="muted">Double-click anywhere to add a card, or press N.</p>
        </div>
      )}

      <div className="board-corner">
        <p className="board-name">{board.title}</p>
        <p className="board-hint">
          {filtering ? `${matchCount} of ${plural(visibleCards.length, "card")} match` : `${plural(cards.length, "card")} · double-click to add · shift-drag to select`}
        </p>
      </div>

      <div className="board-toolbar" role="toolbar" aria-label="Board tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {selected.length > 0 ? (
          <>
            <span className="toolbar-label">{selected.length} selected</span>
            {selected.length === 1 && (
              <Button size="sm" variant="ghost" icon={IconPencil} onClick={() => onOpen(selected[0])}>
                Open
              </Button>
            )}
            <Menu
              label="Move to cluster"
              align="start"
              trigger={(t) => (
                <Button {...t} size="sm" variant="ghost" icon={IconMoveTo}>
                  Move to
                </Button>
              )}
              items={[...sections.map((s) => ({ label: s.title, onSelect: () => void moveSelectedTo(s.id) })), { separator: true as const }, { label: "Out of any cluster", onSelect: () => void moveSelectedTo(null) }]}
            />
            {selected.length === 2 && (
              <Menu
                label="Connect the two selected cards"
                align="start"
                trigger={(t) => (
                  <Button {...t} size="sm" variant="ghost" icon={IconConnect}>
                    Connect
                  </Button>
                )}
                items={[{ heading: "First card…" }, ...LINK_KINDS.map((k) => ({ label: k.verb, onSelect: () => void connect(k.kind) }))]}
              />
            )}
            <IconButton icon={IconTrash} label="Delete selected" size="sm" onClick={() => void removeSelected()} />
            <IconButton icon={IconX} label="Clear selection" size="sm" onClick={() => setSelection(new Set())} />
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" icon={IconPlus} onClick={() => void addCardAt()} title="New card (N)">
              Card
            </Button>
            <Button size="sm" variant="ghost" icon={IconSection} onClick={() => void addCluster()}>
              Cluster
            </Button>
            <span className="toolbar-sep" />
            <label className="toolbar-search">
              <span className="sr-only">Find on board</span>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find…" onKeyDown={(e) => e.key === "Escape" && setFilter("")} />
            </label>
            <Menu
              label="Filter by type"
              trigger={(t) => <IconButton {...t} icon={IconFilter} label="Filter by type" size="sm" pressed={Boolean(typeFilter)} />}
              items={[
                { label: "All types", checked: !typeFilter, onSelect: () => setTypeFilter(null) },
                ...(Object.keys(CARD_META) as CardType[]).map((t) => ({ label: CARD_META[t].label, checked: typeFilter === t, onSelect: () => setTypeFilter(t) })),
              ]}
            />
          </>
        )}
        <span className="toolbar-sep" />
        <IconButton icon={IconMinus} label="Zoom out" size="sm" onClick={() => zoomBy(1 / 1.2)} />
        <button type="button" className="toolbar-zoom" onClick={() => setView((v) => clampView({ ...v, zoom: 1 }))} title="Reset to 100%">
          {Math.round(view.zoom * 100)}%
        </button>
        <IconButton icon={IconPlus} label="Zoom in" size="sm" onClick={() => zoomBy(1.2)} />
        <IconButton icon={IconFit} label="Fit everything (F)" size="sm" onClick={fitAll} />
      </div>
    </div>
  );
}
