import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { arrangeStructure, createCard, createSection, deleteCards, deleteSection, reorderSections, updateSection } from "../../data/repo";
import type { Card, CardType, Project } from "../../data/types";
import { navigate, projectPath } from "../../lib/router";
import { cx, plural } from "../../lib/util";
import { promptDialog } from "../../ui/Dialog";
import { IconArrowLeft, IconArrowRight, IconDocPlus, IconMore, IconOutline, IconPlus, IconTrash } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Button, EmptyState, IconButton, InlineEdit } from "../../ui/ui";
import type { BoardData } from "./BoardMode";
import { useLinkCounts, useRefNames } from "./BoardMode";
import { CardFace } from "./CardFace";
import { CARD_META } from "./cardMeta";
import { draftFromStructure, moveInColumns, orderStructure } from "./structureDoc";

interface DragState {
  cardId: string;
  fromSection: string | null;
  overSection: string | null;
  overIndex: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
}

export function StructureBoard({
  project,
  data,
  onOpen,
  cardNoun,
  onToggleOutline,
}: {
  project: Project;
  data: BoardData;
  onOpen: (id: string) => void;
  cardNoun: { type: CardType; label: string };
  onToggleOutline: () => void;
}) {
  const columns = useMemo(() => orderStructure(data.sections, data.cards), [data.sections, data.cards]);
  const refNames = useRefNames(data);
  const linkCounts = useLinkCounts(data);
  const [drag, setDrag] = useState<DragState | null>(null);
  const colRefs = useRef(new Map<string, HTMLElement>());
  const [busy, setBusy] = useState(false);

  const addCard = async (sectionId: string | null) => {
    try {
      const c = await createCard({ projectId: project.id, boardId: data.board.id, sectionId, type: cardNoun.type, x: 0, y: 0 });
      onOpen(c.id);
    } catch (e) {
      toastError(e);
    }
  };
  const addSection = async () => {
    const title = await promptDialog({ title: "New section", label: "Name", placeholder: "e.g. Part two, Act III, The turn", confirmLabel: "Add section" });
    if (title) await createSection({ projectId: project.id, boardId: data.board.id, title }).catch(toastError);
  };
  const moveSection = async (index: number, dir: -1 | 1) => {
    const ids = columns.filter((c) => c.section).map((c) => c.section!.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorderSections(ids).catch(toastError);
  };
  const moveCard = async (cardId: string, toSection: string | null, toIndex: number) => {
    const changed = moveInColumns(columns, cardId, toSection, toIndex);
    if (changed.length) await arrangeStructure(changed).catch(toastError);
  };
  const draft = async () => {
    setBusy(true);
    try {
      const doc = await draftFromStructure(project.id);
      toast("A new draft, scaffolded from your structure. Your existing drafts are untouched.");
      navigate(projectPath(project.id, "write"), { doc: doc.id });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------------- pointer drag between columns */

  const onCardPointerDown = (e: ReactPointerEvent<HTMLElement>, card: Card) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    let state: DragState | null = null;
    const compute = (x: number, y: number): Pick<DragState, "overSection" | "overIndex"> => {
      for (const [key, colEl] of colRefs.current) {
        const r = colEl.getBoundingClientRect();
        if (x >= r.left && x <= r.right) {
          const sectionId = key === "__none" ? null : key;
          const items = [...colEl.querySelectorAll<HTMLElement>("[data-card-id]")].filter((n) => n.dataset.cardId !== card.id);
          let index = items.length;
          for (let i = 0; i < items.length; i++) {
            const ir = items[i].getBoundingClientRect();
            if (y < ir.top + ir.height / 2) {
              index = i;
              break;
            }
          }
          // Translate to an index in the column including the dragged card.
          const col = columns.find((c) => (c.section?.id ?? null) === sectionId);
          const ids = col?.cards.map((c) => c.id) ?? [];
          const before = items[index]?.dataset.cardId;
          const realIndex = before ? ids.indexOf(before) : ids.length;
          return { overSection: sectionId, overIndex: realIndex };
        }
      }
      return { overSection: state?.overSection ?? card.sectionId, overIndex: state?.overIndex ?? 0 };
    };
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true;
      state = {
        cardId: card.id,
        fromSection: card.sectionId,
        ...compute(ev.clientX, ev.clientY),
        x: ev.clientX,
        y: ev.clientY,
        offsetX: sx - rect.left,
        offsetY: sy - rect.top,
        width: rect.width,
      };
      setDrag(state);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const final = state;
      setDrag(null);
      if (!started) {
        onOpen(card.id);
        return;
      }
      if (final) void moveCard(card.id, final.overSection, final.overIndex);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const dragged = drag ? data.cards.find((c) => c.id === drag.cardId) : null;
  const sectionCols = columns.filter((c) => c.section);

  return (
    <div className="structure">
      <div className="structure-bar">
        <div>
          <h2 className="board-name">{data.board.title}</h2>
          <p className="board-hint">
            {plural(data.cards.length, "card")} in {plural(sectionCols.length, "section")} · drag to reorder, or use each card's menu
          </p>
        </div>
        <div className="row gap-2">
          <Button size="sm" variant="ghost" icon={IconOutline} onClick={onToggleOutline}>
            Outline view
          </Button>
          <Button size="sm" icon={IconDocPlus} onClick={() => void draft()} busy={busy} disabled={!data.cards.length}>
            Draft from structure
          </Button>
        </div>
      </div>
      {columns.length === 0 ? (
        <EmptyState
          title="Give the work a shape"
          actions={
            <Button variant="primary" icon={IconPlus} onClick={() => void addSection()}>
              Add a section
            </Button>
          }
        >
          Sections are the big movements — parts, acts, the turn of an argument. Cards are the pieces inside them, in order.
        </EmptyState>
      ) : (
        <div className={cx("columns scroll-x", drag && "is-dragging")}>
          {columns.map((col, ci) => {
            const key = col.section?.id ?? "__none";
            const isOver = drag && (drag.overSection ?? "__none") === key;
            return (
              <section
                key={key}
                className={cx("column", !col.section && "is-unplaced", isOver && "is-over")}
                ref={(el) => {
                  if (el) colRefs.current.set(key, el);
                  else colRefs.current.delete(key);
                }}
                aria-label={col.section?.title ?? "Unplaced cards"}
              >
                <header className="column-head">
                  <span className="column-num" aria-hidden>
                    {col.section ? ci + 1 : "–"}
                  </span>
                  {col.section ? (
                    <InlineEdit label="Section name" className="column-title" value={col.section.title} onCommit={(title) => void updateSection(col.section!.id, { title }).catch(toastError)} />
                  ) : (
                    <span className="column-title">Unplaced</span>
                  )}
                  <span className="column-count">{col.cards.length}</span>
                  {col.section && (
                    <Menu
                      label={`${col.section.title} actions`}
                      trigger={(t) => <IconButton {...t} icon={IconMore} label={`Actions for ${col.section!.title}`} size="sm" />}
                      items={[
                        { label: "Move left", icon: IconArrowLeft, disabled: ci === 0, onSelect: () => void moveSection(ci, -1) },
                        { label: "Move right", icon: IconArrowRight, disabled: ci >= sectionCols.length - 1, onSelect: () => void moveSection(ci, 1) },
                        { separator: true },
                        {
                          label: "Remove section (keep cards)",
                          icon: IconTrash,
                          danger: true,
                          onSelect: () =>
                            void deleteSection(col.section!.id)
                              .then((restore) => toastUndo(`Removed "${col.section!.title}". Its cards moved to Unplaced.`, restore))
                              .catch(toastError),
                        },
                      ]}
                    />
                  )}
                </header>
                <ol className="column-cards" role="list">
                  {col.cards.map((c, i) => {
                    const placeholderHere = isOver && drag && drag.overIndex === i && drag.cardId !== c.id;
                    return (
                      <li key={c.id} className="column-item">
                        {placeholderHere && <div className="drop-slot" aria-hidden />}
                        <div
                          data-card-id={c.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${CARD_META[c.type].label} ${i + 1}: ${c.title || "Untitled"}. Alt + arrow keys to move.`}
                          className={cx("card card-static", `card-${c.type}`, drag?.cardId === c.id && "is-ghosted")}
                          onPointerDown={(e) => onCardPointerDown(e, c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpen(c.id);
                            } else if (e.altKey && e.key === "ArrowUp" && i > 0) {
                              e.preventDefault();
                              void moveCard(c.id, col.section?.id ?? null, i - 1);
                            } else if (e.altKey && e.key === "ArrowDown" && i < col.cards.length - 1) {
                              e.preventDefault();
                              void moveCard(c.id, col.section?.id ?? null, i + 2);
                            } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                              const target = columns[ci + (e.key === "ArrowLeft" ? -1 : 1)];
                              if (target) {
                                e.preventDefault();
                                void moveCard(c.id, target.section?.id ?? null, target.cards.length);
                              }
                            } else if (e.key === "Delete" || e.key === "Backspace") {
                              e.preventDefault();
                              void deleteCards([c.id]).then((r) => toastUndo("Card deleted.", r)).catch(toastError);
                            }
                          }}
                        >
                          <CardFace card={c} linkCount={linkCounts.get(c.id)} refNames={refNames.get(c.id)} />
                        </div>
                      </li>
                    );
                  })}
                  {isOver && drag && drag.overIndex >= col.cards.length && <li className="drop-slot" aria-hidden />}
                </ol>
                <button type="button" className="column-add" onClick={() => void addCard(col.section?.id ?? null)}>
                  <IconPlus size={14} aria-hidden /> {cardNoun.label}
                </button>
              </section>
            );
          })}
          <button type="button" className="column column-new" onClick={() => void addSection()}>
            <IconPlus size={16} aria-hidden />
            Add section
          </button>
        </div>
      )}
      {drag && dragged && (
        <div className="card card-drag-ghost" style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }} aria-hidden>
          <CardFace card={dragged} />
        </div>
      )}
    </div>
  );
}
