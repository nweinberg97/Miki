import { db } from "../../data/db";
import { createDocument } from "../../data/repo";
import type { Card, Section } from "../../data/types";
import { buildDoc, docToPlainText, type SimpleBlock } from "../../editor/serialize";
import { wordCount } from "../../lib/util";

export interface OrderedColumn {
  section: Section | null;
  cards: Card[];
}

/** Sections in sequence, each with its cards in order. Unsectioned cards come last. */
export function orderStructure(sections: Section[], cards: Card[]): OrderedColumn[] {
  const cols: OrderedColumn[] = [...sections]
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    .map((section) => ({ section, cards: cards.filter((c) => c.sectionId === section.id).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt) }));
  const known = new Set(sections.map((s) => s.id));
  const rest = cards.filter((c) => !c.sectionId || !known.has(c.sectionId)).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  if (rest.length) cols.push({ section: null, cards: rest });
  return cols;
}

/** Move a card within/between ordered columns and return the columns that changed. */
export function moveInColumns(columns: OrderedColumn[], cardId: string, toSection: string | null, toIndex: number) {
  const cols = columns.map((c) => ({ sectionId: c.section?.id ?? null, cardIds: c.cards.map((x) => x.id) }));
  const from = cols.find((c) => c.cardIds.includes(cardId));
  let to = cols.find((c) => c.sectionId === toSection);
  if (!to) {
    to = { sectionId: toSection, cardIds: [] };
    cols.push(to);
  }
  if (!from) return [];
  const fromIdx = from.cardIds.indexOf(cardId);
  from.cardIds.splice(fromIdx, 1);
  let idx = toIndex;
  if (from === to && fromIdx < toIndex) idx -= 1;
  to.cardIds.splice(Math.max(0, Math.min(idx, to.cardIds.length)), 0, cardId);
  return from === to ? [to] : [from, to];
}

/** The structure as outline blocks: a heading per section, a sub-heading per card with its notes as a quote. */
export function structureBlocks(columns: OrderedColumn[], opts: { includeNotes: boolean }): SimpleBlock[] {
  const blocks: SimpleBlock[] = [];
  for (const col of columns) {
    if (!col.cards.length && !col.section) continue;
    blocks.push({ kind: "h", level: 2, text: col.section?.title ?? "Unplaced" });
    for (const c of col.cards) {
      blocks.push({ kind: "h", level: 3, text: c.title || "Untitled" });
      if (opts.includeNotes && c.body.trim()) blocks.push({ kind: "quote", text: c.body.trim() });
      else blocks.push({ kind: "p", text: "" });
    }
  }
  return blocks;
}

/** Create a new document scaffolded from the structure board. Never modifies existing drafts. */
export async function draftFromStructure(projectId: string, opts: { includeNotes?: boolean; title?: string } = {}) {
  const boards = await db.byIndex("boards", "projectId", projectId);
  const structure = boards.find((b) => b.kind === "structure");
  if (!structure) throw new Error("This project has no structure board.");
  const [sections, cards] = await Promise.all([db.byIndex("sections", "boardId", structure.id), db.byIndex("cards", "boardId", structure.id)]);
  if (!cards.length) throw new Error("Add a few cards to the structure first.");
  const content = buildDoc(structureBlocks(orderStructure(sections, cards), { includeNotes: opts.includeNotes ?? true }));
  const plain = docToPlainText(content);
  return createDocument(projectId, { title: opts.title ?? `Draft from ${structure.title.toLowerCase()}`, content, plainText: plain, wordCount: wordCount(plain) });
}
