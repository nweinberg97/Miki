import { useMemo } from "react";
import { arrangeStructure, createCard, createSection } from "../../data/repo";
import type { BoardKind, Card, CardType, Project } from "../../data/types";
import { cx, plural } from "../../lib/util";
import { promptDialog } from "../../ui/Dialog";
import { IconArrowDown, IconArrowUp, IconColumns, IconPlus } from "../../ui/icons";
import { toastError } from "../../ui/toast";
import { Button, IconButton } from "../../ui/ui";
import type { BoardData } from "./BoardMode";
import { useRefNames } from "./BoardMode";
import { CardFace } from "./CardFace";
import { moveInColumns, orderStructure } from "./structureDoc";

/**
 * A linear view of a board: the structure as an outline, or (on small screens) the idea space as grouped lists.
 * Fully keyboard- and touch-friendly — the alternative to dragging.
 */
export function BoardList({
  project,
  data,
  kind,
  onOpen,
  cardNoun,
  outline,
  onToggleOutline,
  narrow,
}: {
  project: Project;
  data: BoardData;
  kind: BoardKind;
  onOpen: (id: string) => void;
  cardNoun: { type: CardType; label: string };
  outline: boolean;
  onToggleOutline: () => void;
  narrow: boolean;
}) {
  const refNames = useRefNames(data);
  const groups = useMemo(() => {
    if (kind === "structure") return orderStructure(data.sections, data.cards);
    const secs = [...data.sections].sort((a, b) => a.order - b.order);
    const byPos = (a: Card, b: Card) => a.y - b.y || a.x - b.x;
    const known = new Set(secs.map((s) => s.id));
    const out = secs.map((s) => ({ section: s, cards: data.cards.filter((c) => c.sectionId === s.id).sort(byPos) }));
    const loose = data.cards.filter((c) => !c.sectionId || !known.has(c.sectionId)).sort(byPos);
    if (loose.length) out.push({ section: null as never, cards: loose });
    return out;
  }, [data, kind]);

  const add = async (sectionId: string | null) => {
    try {
      const c = await createCard({ projectId: project.id, boardId: data.board.id, sectionId, type: kind === "structure" ? cardNoun.type : "idea" });
      onOpen(c.id);
    } catch (e) {
      toastError(e);
    }
  };
  const move = async (cardId: string, sectionId: string | null, index: number) => {
    const changed = moveInColumns(groups, cardId, sectionId, index);
    if (changed.length) await arrangeStructure(changed).catch(toastError);
  };

  return (
    <div className="board-list scroll-y">
      <div className="board-list-inner">
        <div className="structure-bar">
          <div>
            <h2 className="board-name">{kind === "structure" ? "What you carry, in order" : "Storyboard"}</h2>
            <p className="board-hint">{kind === "structure" ? "In order, top to bottom." : narrow ? "Grouped by cluster. Open the storyboard on a larger screen to arrange it spatially." : ""}</p>
          </div>
          {!narrow && outline && (
            <Button size="sm" variant="ghost" icon={IconColumns} onClick={onToggleOutline}>
              Columns view
            </Button>
          )}
        </div>
        {groups.map((g, gi) => (
          <section key={g.section?.id ?? "loose"} className={cx("list-group", g.section && /set aside/i.test(g.section.title) && "is-set-aside")}>
            <header className="list-group-head">
              {kind === "structure" && <span className="column-num">{g.section ? gi + 1 : "–"}</span>}
              <h3>{g.section?.title ?? (kind === "structure" ? "Unplaced" : "Loose ideas")}</h3>
              <span className="column-count">{plural(g.cards.length, "card")}</span>
            </header>
            <ol className="list-group-cards" role="list">
              {g.cards.map((c, i) => (
                <li key={c.id} className="list-card-row">
                  <div
                    role="button"
                    tabIndex={0}
                    className={cx("card card-static", `card-${c.type}`)}
                    onClick={() => onOpen(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(c.id);
                      } else if (kind === "structure" && e.altKey && e.key === "ArrowUp" && i > 0) {
                        e.preventDefault();
                        void move(c.id, g.section?.id ?? null, i - 1);
                      } else if (kind === "structure" && e.altKey && e.key === "ArrowDown" && i < g.cards.length - 1) {
                        e.preventDefault();
                        void move(c.id, g.section?.id ?? null, i + 2);
                      }
                    }}
                  >
                    <CardFace card={c} refNames={refNames.get(c.id)} />
                  </div>
                  {kind === "structure" && (
                    <div className="list-card-moves">
                      <IconButton icon={IconArrowUp} label="Move up" size="sm" disabled={i === 0} onClick={() => void move(c.id, g.section?.id ?? null, i - 1)} />
                      <IconButton icon={IconArrowDown} label="Move down" size="sm" disabled={i === g.cards.length - 1} onClick={() => void move(c.id, g.section?.id ?? null, i + 2)} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <button type="button" className="column-add" onClick={() => void add(g.section?.id ?? null)}>
              <IconPlus size={14} aria-hidden /> {kind === "structure" ? cardNoun.label : "Idea"}
            </button>
          </section>
        ))}
        <Button
          variant="ghost"
          icon={IconPlus}
          onClick={async () => {
            const title = await promptDialog({ title: kind === "structure" ? "New section" : "New cluster", label: "Name", confirmLabel: "Add" });
            if (title) await createSection({ projectId: project.id, boardId: data.board.id, title }).catch(toastError);
          }}
        >
          {kind === "structure" ? "Add section" : "Add cluster"}
        </Button>
      </div>
    </div>
  );
}
