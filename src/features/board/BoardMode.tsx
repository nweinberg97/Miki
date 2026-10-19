import { useMemo, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { projectTemplate } from "../../data/templates";
import type { Board, BoardKind, Card, Link, Project, Reference, Section } from "../../data/types";
import { setQuery } from "../../lib/router";
import { useIsNarrow } from "../../lib/useMedia";
import { Spinner } from "../../ui/ui";
import { CardPanel } from "./CardPanel";
import { IdeaCanvas } from "./IdeaCanvas";
import { StructureBoard } from "./StructureBoard";
import { BoardList } from "./BoardList";
import "./board.css";

export interface BoardData {
  board: Board;
  otherBoard: Board | undefined;
  sections: Section[];
  otherSections: Section[];
  cards: Card[];
  links: Link[];
  refs: Reference[];
}

async function loadBoard(projectId: string, kind: BoardKind): Promise<BoardData | null> {
  const boards = await db.byIndex("boards", "projectId", projectId);
  const board = boards.find((b) => b.kind === kind);
  if (!board) return null;
  const otherBoard = boards.find((b) => b.kind !== kind);
  const [sections, cards, links, refs, otherSections] = await Promise.all([
    db.byIndex("sections", "boardId", board.id),
    db.byIndex("cards", "boardId", board.id),
    db.byIndex("links", "projectId", projectId),
    db.byIndex("references", "projectId", projectId),
    otherBoard ? db.byIndex("sections", "boardId", otherBoard.id) : Promise.resolve([]),
  ]);
  return { board, otherBoard, sections, cards, links, refs, otherSections };
}

/** Card id → names of references it features (e.g. characters in a scene). */
export function useRefNames(data: BoardData | null | undefined) {
  return useMemo(() => {
    const map = new Map<string, string[]>();
    if (!data) return map;
    const byId = new Map(data.refs.map((r) => [r.id, r.title]));
    for (const l of data.links) {
      if (l.from.type === "card" && l.to.type === "reference" && byId.has(l.to.id)) map.set(l.from.id, [...(map.get(l.from.id) ?? []), byId.get(l.to.id)!]);
      if (l.to.type === "card" && l.from.type === "reference" && byId.has(l.from.id)) map.set(l.to.id, [...(map.get(l.to.id) ?? []), byId.get(l.from.id)!]);
    }
    return map;
  }, [data]);
}

export function useLinkCounts(data: BoardData | null | undefined) {
  return useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    for (const l of data.links) {
      if (l.kind === "features") continue;
      if (l.from.type === "card") map.set(l.from.id, (map.get(l.from.id) ?? 0) + 1);
      if (l.to.type === "card") map.set(l.to.id, (map.get(l.to.id) ?? 0) + 1);
    }
    return map;
  }, [data]);
}

export function BoardMode({ project, kind, query }: { project: Project; kind: BoardKind; query: URLSearchParams }) {
  const { data, loading } = useLive(() => loadBoard(project.id, kind), [project.id, kind], ["boards", "sections", "cards", "links", "references"]);
  const narrow = useIsNarrow();
  const openCardId = query.get("card");
  const openCard = data?.cards.find((c) => c.id === openCardId);
  const [outline, setOutline] = useState(false);
  const tpl = projectTemplate(project.type);

  if (loading && !data) {
    return (
      <div className="board-loading">
        <Spinner label="Loading board" />
      </div>
    );
  }
  if (!data) return <div className="board-loading">This project has no {kind === "ideas" ? "idea space" : "structure"} board.</div>;

  const closePanel = () => setQuery({ card: null });
  const open = (id: string) => setQuery({ card: id });

  return (
    <div className={`board-mode board-${kind}`}>
      {narrow || (kind === "structure" && outline) ? (
        <BoardList project={project} data={data} kind={kind} onOpen={open} cardNoun={tpl.cardNoun} outline={outline} onToggleOutline={() => setOutline((o) => !o)} narrow={narrow} />
      ) : kind === "ideas" ? (
        <IdeaCanvas project={project} data={data} onOpen={open} selectedId={openCardId} />
      ) : (
        <StructureBoard project={project} data={data} onOpen={open} cardNoun={tpl.cardNoun} onToggleOutline={() => setOutline(true)} />
      )}
      {openCard && <CardPanel key={openCard.id} project={project} card={openCard} data={data} onClose={closePanel} />}
    </div>
  );
}
