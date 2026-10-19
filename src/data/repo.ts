// Domain operations. UI components call these; they never touch IndexedDB directly.
import { db, transact, ALL_STORES, type Tx } from "./db";
import { builtInProcess, projectTemplate } from "./templates";
import { uid, now } from "../lib/util";
import { docToPlainText } from "../editor/serialize";
import {
  INBOX,
  type Board,
  type Card,
  type CardType,
  type Decision,
  type DocContent,
  type Document,
  type EntityRef,
  type Link,
  type LinkKind,
  type Mode,
  type Note,
  type NoteKind,
  type Process,
  type ProcessTemplate,
  type Project,
  type ProjectType,
  type Recording,
  type Reference,
  type ReferenceKind,
  type Section,
  type Snapshot,
  type SourceRef,
  type Step,
  type StoreMap,
  type StoreName,
  type TemplateStep,
  type Transcript,
  type TranscriptSegment,
} from "./types";

export const EMPTY_DOC: DocContent = { type: "doc", content: [{ type: "paragraph" }] };

export const CLUSTER_W = 380;
export const CLUSTER_H = 540;
export const CLUSTER_GAP = 48;
export const CARD_W = 220;
export const CARD_H = 148;

/* ================================================================== projects */

export interface NewProjectInput {
  title: string;
  type: ProjectType;
  description?: string;
  isSample?: boolean;
}

export interface CreatedProject {
  project: Project;
  ideasBoard: Board;
  structureBoard: Board;
  process: Process | null;
  docs: Document[];
}

export async function createProject(input: NewProjectInput): Promise<CreatedProject> {
  const t = now();
  const tpl = projectTemplate(input.type);
  const project: Project = {
    id: uid(),
    title: input.title.trim() || "Untitled project",
    description: input.description?.trim() ?? "",
    type: input.type,
    thread: "",
    isSample: Boolean(input.isSample),
    archived: false,
    createdAt: t,
    updatedAt: t,
    lastOpenedAt: t,
  };
  const ideasBoard: Board = { id: uid(), projectId: project.id, kind: "ideas", title: "Idea space", createdAt: t, updatedAt: t };
  const structureBoard: Board = {
    id: uid(),
    projectId: project.id,
    kind: "structure",
    title: tpl.structureLabel,
    createdAt: t,
    updatedAt: t,
  };
  const sections: Section[] = [
    ...tpl.ideaClusters.map((title, i) => ({
      id: uid(),
      projectId: project.id,
      boardId: ideasBoard.id,
      title,
      x: i * (CLUSTER_W + CLUSTER_GAP),
      y: 0,
      w: CLUSTER_W,
      h: CLUSTER_H,
      collapsed: false,
      order: i,
      createdAt: t,
      updatedAt: t,
    })),
    ...tpl.structureSections.map((title, i) => ({
      id: uid(),
      projectId: project.id,
      boardId: structureBoard.id,
      title,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      collapsed: false,
      order: i,
      createdAt: t,
      updatedAt: t,
    })),
  ];
  const docs: Document[] = tpl.starterDocs.map((title, i) => newDocumentRecord(project.id, title, i));
  const procTpl = builtInProcess(tpl.processTemplateId);
  const { process, steps } = procTpl ? buildProcess(project.id, procTpl) : { process: null, steps: [] as Step[] };

  await transact(["projects", "boards", "sections", "documents", "processes", "steps"], "readwrite", (tx) => {
    tx.put("projects", project);
    tx.put("boards", ideasBoard);
    tx.put("boards", structureBoard);
    sections.forEach((s) => tx.put("sections", s));
    docs.forEach((d) => tx.put("documents", d));
    if (process) tx.put("processes", process);
    steps.forEach((s) => tx.put("steps", s));
  });
  return { project, ideasBoard, structureBoard, process, docs };
}

export async function updateProject(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>): Promise<Project> {
  return transact(["projects"], "readwrite", async (tx) => {
    const p = await tx.get("projects", id);
    if (!p) throw new Error("Project not found");
    const next = { ...p, ...patch, updatedAt: now() };
    tx.put("projects", next);
    return next;
  });
}

/** Record where the writer is, without bumping updatedAt. */
export async function touchProject(id: string, location?: Project["lastLocation"]): Promise<void> {
  await transact(["projects"], "readwrite", async (tx) => {
    const p = await tx.get("projects", id);
    if (!p) return;
    tx.put("projects", { ...p, lastOpenedAt: now(), lastLocation: location ?? p.lastLocation });
  });
}

const PROJECT_STORES: StoreName[] = [
  "documents",
  "snapshots",
  "notes",
  "recordings",
  "transcripts",
  "boards",
  "sections",
  "cards",
  "links",
  "references",
  "processes",
  "steps",
  "decisions",
];

/** Everything belonging to a project, keyed by store. Used for deletion, undo, and export. */
export async function collectProject(tx: Tx, projectId: string): Promise<Partial<{ [S in StoreName]: StoreMap[S][] }>> {
  const out: Partial<{ [S in StoreName]: StoreMap[S][] }> = {};
  const p = await tx.get("projects", projectId);
  if (p) out.projects = [p];
  for (const store of PROJECT_STORES) {
    (out as Record<string, unknown[]>)[store] = await tx.byIndex(store, "projectId", projectId);
  }
  const audio = [];
  for (const r of out.recordings ?? []) {
    const a = await tx.get("audio", r.id);
    if (a) audio.push(a);
  }
  out.audio = audio;
  return out;
}

export async function deleteProject(projectId: string): Promise<void> {
  await transact(["projects", ...PROJECT_STORES, "audio"], "readwrite", async (tx) => {
    const all = await collectProject(tx, projectId);
    for (const [store, rows] of Object.entries(all) as [StoreName, { id: string }[]][]) {
      for (const row of rows) tx.delete(store, row.id);
    }
  });
}

/* ================================================================== documents */

function newDocumentRecord(projectId: string, title: string, order: number, content: DocContent = EMPTY_DOC): Document {
  const t = now();
  return {
    id: uid(),
    projectId,
    title,
    content,
    plainText: "",
    wordCount: 0,
    status: "draft",
    order,
    createdAt: t,
    updatedAt: t,
  };
}

export async function createDocument(
  projectId: string,
  opts: { title?: string; content?: DocContent; plainText?: string; wordCount?: number; sourceCardId?: string } = {},
): Promise<Document> {
  return transact(["documents", "cards"], "readwrite", async (tx) => {
    const existing = await tx.byIndex("documents", "projectId", projectId);
    const order = existing.reduce((m, d) => Math.max(m, d.order), -1) + 1;
    const doc: Document = {
      ...newDocumentRecord(projectId, opts.title?.trim() || "Untitled", order, opts.content),
      plainText: opts.plainText ?? "",
      wordCount: opts.wordCount ?? 0,
      sourceCardId: opts.sourceCardId,
    };
    tx.put("documents", doc);
    if (opts.sourceCardId) {
      const card = await tx.get("cards", opts.sourceCardId);
      if (card) tx.put("cards", { ...card, docId: doc.id, updatedAt: now() });
    }
    return doc;
  });
}

export async function updateDocument(id: string, patch: Partial<Pick<Document, "title" | "status" | "order">>): Promise<void> {
  await transact(["documents"], "readwrite", async (tx) => {
    const d = await tx.get("documents", id);
    if (!d) throw new Error("Document not found");
    tx.put("documents", { ...d, ...patch, updatedAt: now() });
  });
}

const SNAPSHOT_INTERVAL = 20 * 60 * 1000;

/**
 * Persist editor content. Also keeps an automatic version at most every 20 minutes
 * so earlier states can be recovered.
 */
export async function saveDocumentContent(id: string, content: DocContent, plainText: string, wordCount: number): Promise<number> {
  return transact(["documents", "snapshots"], "readwrite", async (tx) => {
    const d = await tx.get("documents", id);
    if (!d) throw new Error("This document no longer exists.");
    const t = now();
    const snaps = await tx.byIndex("snapshots", "documentId", id);
    const latest = snaps.reduce((m, s) => Math.max(m, s.createdAt), 0);
    if (d.wordCount > 0 && t - latest > SNAPSHOT_INTERVAL && d.plainText !== plainText) {
      tx.put("snapshots", snapshotOf(d, "Automatic"));
    }
    tx.put("documents", { ...d, content, plainText, wordCount, updatedAt: t });
    return t;
  });
}

function snapshotOf(d: Document, label: string): Snapshot {
  return {
    id: uid(),
    documentId: d.id,
    projectId: d.projectId,
    title: d.title,
    content: d.content,
    wordCount: d.wordCount,
    label,
    createdAt: now(),
  };
}

export async function createSnapshot(documentId: string, label: string): Promise<void> {
  await transact(["documents", "snapshots"], "readwrite", async (tx) => {
    const d = await tx.get("documents", documentId);
    if (!d) throw new Error("Document not found");
    tx.put("snapshots", snapshotOf(d, label || "Saved version"));
  });
}

export async function restoreSnapshot(snapshotId: string): Promise<void> {
  await transact(["documents", "snapshots"], "readwrite", async (tx) => {
    const snap = await tx.get("snapshots", snapshotId);
    if (!snap) throw new Error("Version not found");
    const d = await tx.get("documents", snap.documentId);
    if (!d) throw new Error("Document not found");
    tx.put("snapshots", snapshotOf(d, "Before restoring an earlier version"));
    const plain = docToPlainText(snap.content);
    tx.put("documents", { ...d, content: snap.content, plainText: plain, wordCount: snap.wordCount, updatedAt: now() });
  });
}

export async function duplicateDocument(id: string): Promise<Document> {
  return transact(["documents"], "readwrite", async (tx) => {
    const d = await tx.get("documents", id);
    if (!d) throw new Error("Document not found");
    const siblings = await tx.byIndex("documents", "projectId", d.projectId);
    const t = now();
    const copy: Document = {
      ...d,
      id: uid(),
      title: `${d.title} (copy)`,
      order: siblings.reduce((m, s) => Math.max(m, s.order), -1) + 1,
      sourceCardId: undefined,
      createdAt: t,
      updatedAt: t,
    };
    tx.put("documents", copy);
    return copy;
  });
}

export async function reorderDocuments(ids: string[]): Promise<void> {
  await transact(["documents"], "readwrite", async (tx) => {
    for (const [i, id] of ids.entries()) {
      const d = await tx.get("documents", id);
      if (d && d.order !== i) tx.put("documents", { ...d, order: i });
    }
  });
}

/* ================================================================== deletion with undo */

export type Restore = () => Promise<void>;
type Rec = Exclude<StoreMap[StoreName], { key: string }>;
type Row = [StoreName, Rec];
interface Removal {
  remove: Row[];
  /** Records changed as a side effect (e.g. cards unlinked from a deleted section). Undo restores the originals. */
  modify?: { store: StoreName; original: Rec; updated: Rec }[];
}

/** Delete records and return a function that puts everything back exactly as it was. */
async function deleteWithUndo(stores: StoreName[], collect: (tx: Tx) => Promise<Removal>): Promise<Restore> {
  const removal = await transact(stores, "readwrite", async (tx) => {
    const r = await collect(tx);
    for (const [store, row] of r.remove) tx.delete(store, row.id);
    for (const m of r.modify ?? []) tx.put(m.store, m.updated as never);
    return r;
  });
  return async () => {
    await transact(stores, "readwrite", (tx) => {
      for (const [store, row] of removal.remove) tx.put(store, row as never);
      for (const m of removal.modify ?? []) tx.put(m.store, m.original as never);
    });
  };
}

const linkRows = (links: Link[]): Row[] => links.map((l) => ["links", l]);

export function deleteDocument(id: string): Promise<Restore> {
  return deleteWithUndo(["documents", "snapshots", "cards", "links"], async (tx) => {
    const d = await tx.get("documents", id);
    if (!d) return { remove: [] };
    const remove: Row[] = [["documents", d]];
    for (const s of await tx.byIndex("snapshots", "documentId", id)) remove.push(["snapshots", s]);
    remove.push(...linkRows(await linksTouching(tx, d.projectId, { type: "document", id })));
    const modify = (await tx.byIndex("cards", "projectId", d.projectId))
      .filter((c) => c.docId === id)
      .map((c) => ({ store: "cards" as StoreName, original: c, updated: { ...c, docId: undefined } }));
    return { remove, modify };
  });
}

export function deleteNote(id: string): Promise<Restore> {
  return deleteWithUndo(["notes", "links"], async (tx) => {
    const n = await tx.get("notes", id);
    if (!n) return { remove: [] };
    return { remove: [["notes", n], ...linkRows(await linksTouching(tx, n.projectId, { type: "note", id }))] };
  });
}

export function deleteCards(ids: string[]): Promise<Restore> {
  return deleteWithUndo(["cards", "links"], async (tx) => {
    const remove: Row[] = [];
    for (const id of ids) {
      const c = await tx.get("cards", id);
      if (!c) continue;
      remove.push(["cards", c]);
      for (const l of await linksTouching(tx, c.projectId, { type: "card", id })) {
        if (!remove.some(([, r]) => r.id === l.id)) remove.push(["links", l]);
      }
    }
    return { remove };
  });
}

export function deleteReference(id: string): Promise<Restore> {
  return deleteWithUndo(["references", "links", "cards"], async (tx) => {
    const r = await tx.get("references", id);
    if (!r) return { remove: [] };
    const modify = (await tx.byIndex("cards", "projectId", r.projectId))
      .filter((c) => c.referenceId === id)
      .map((c) => ({ store: "cards" as StoreName, original: c, updated: { ...c, referenceId: undefined } }));
    return { remove: [["references", r], ...linkRows(await linksTouching(tx, r.projectId, { type: "reference", id }))], modify };
  });
}

export function deleteRecording(id: string): Promise<Restore> {
  return deleteWithUndo(["recordings", "audio", "transcripts"], async (tx) => {
    const r = await tx.get("recordings", id);
    if (!r) return { remove: [] };
    const remove: Row[] = [["recordings", r]];
    const a = await tx.get("audio", id);
    if (a) remove.push(["audio", a]);
    for (const t of await tx.byIndex("transcripts", "recordingId", id)) remove.push(["transcripts", t]);
    return { remove };
  });
}

export function deleteTranscript(id: string): Promise<Restore> {
  return deleteWithUndo(["transcripts", "recordings"], async (tx) => {
    const t = await tx.get("transcripts", id);
    if (!t) return { remove: [] };
    const modify = [];
    if (t.recordingId) {
      const r = await tx.get("recordings", t.recordingId);
      if (r) modify.push({ store: "recordings" as StoreName, original: r, updated: { ...r, status: "saved" as const, transcriptId: undefined } });
    }
    return { remove: [["transcripts", t]], modify };
  });
}

export function deleteDecision(id: string): Promise<Restore> {
  return deleteWithUndo(["decisions", "links", "steps", "cards"], async (tx) => {
    const d = await tx.get("decisions", id);
    if (!d) return { remove: [] };
    const modify: Removal["modify"] = [];
    for (const s of await tx.byIndex("steps", "projectId", d.projectId)) {
      if (s.decisionId === id) modify.push({ store: "steps", original: s, updated: { ...s, decisionId: undefined } });
    }
    for (const c of await tx.byIndex("cards", "projectId", d.projectId)) {
      if (c.decisionId === id) modify.push({ store: "cards", original: c, updated: { ...c, decisionId: undefined } });
    }
    return { remove: [["decisions", d], ...linkRows(await linksTouching(tx, d.projectId, { type: "decision", id }))], modify };
  });
}

export function deleteStep(id: string): Promise<Restore> {
  return deleteWithUndo(["steps", "links"], async (tx) => {
    const s = await tx.get("steps", id);
    if (!s) return { remove: [] };
    return { remove: [["steps", s], ...linkRows(await linksTouching(tx, s.projectId, { type: "step", id }))] };
  });
}

export function deleteProcess(id: string): Promise<Restore> {
  return deleteWithUndo(["processes", "steps"], async (tx) => {
    const p = await tx.get("processes", id);
    if (!p) return { remove: [] };
    const steps = await tx.byIndex("steps", "processId", id);
    return { remove: [["processes", p], ...steps.map((s) => ["steps", s] as Row)] };
  });
}

/** Removes a section; its cards stay on the board, unassigned. */
export function deleteSection(id: string): Promise<Restore> {
  return deleteWithUndo(["sections", "cards"], async (tx) => {
    const s = await tx.get("sections", id);
    if (!s) return { remove: [] };
    const modify = (await tx.byIndex("cards", "boardId", s.boardId))
      .filter((c) => c.sectionId === id)
      .map((c) => ({ store: "cards" as StoreName, original: c, updated: { ...c, sectionId: null } }));
    return { remove: [["sections", s]], modify };
  });
}

async function linksTouching(tx: Tx, projectId: string, ref: EntityRef): Promise<Link[]> {
  const links = await tx.byIndex("links", "projectId", projectId);
  return links.filter((l) => (l.from.type === ref.type && l.from.id === ref.id) || (l.to.type === ref.type && l.to.id === ref.id));
}

/* ================================================================== notes */

export async function createNote(input: { projectId?: string; title?: string; body: string; kind?: NoteKind; source?: SourceRef }): Promise<Note> {
  const t = now();
  const note: Note = {
    id: uid(),
    projectId: input.projectId || INBOX,
    title: input.title?.trim() ?? "",
    body: input.body,
    kind: input.kind ?? "note",
    source: input.source,
    createdAt: t,
    updatedAt: t,
  };
  await db.put("notes", note);
  return note;
}

export async function updateNote(id: string, patch: Partial<Pick<Note, "title" | "body" | "kind" | "projectId">>): Promise<void> {
  await transact(["notes"], "readwrite", async (tx) => {
    const n = await tx.get("notes", id);
    if (!n) throw new Error("Note not found");
    tx.put("notes", { ...n, ...patch, updatedAt: now() });
  });
}

/* ================================================================== recordings & transcripts */

export async function saveRecording(blob: Blob, meta: { projectId?: string; title?: string; duration: number }): Promise<Recording> {
  const t = now();
  const rec: Recording = {
    id: uid(),
    projectId: meta.projectId || INBOX,
    title: meta.title?.trim() || `Voice note · ${new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
    mimeType: blob.type || "audio/webm",
    duration: meta.duration,
    size: blob.size,
    status: "saved",
    createdAt: t,
    updatedAt: t,
  };
  await transact(["recordings", "audio"], "readwrite", (tx) => {
    tx.put("recordings", rec);
    tx.put("audio", { id: rec.id, blob });
  });
  return rec;
}

export async function updateRecording(id: string, patch: Partial<Omit<Recording, "id" | "createdAt">>): Promise<void> {
  await transact(["recordings"], "readwrite", async (tx) => {
    const r = await tx.get("recordings", id);
    if (!r) throw new Error("Recording not found");
    tx.put("recordings", { ...r, ...patch, updatedAt: now() });
  });
}

export async function getAudio(recordingId: string): Promise<Blob | null> {
  const a = await db.get("audio", recordingId);
  return a?.blob ?? null;
}

export async function createTranscript(input: {
  projectId: string;
  recordingId?: string;
  title: string;
  text: string;
  segments?: TranscriptSegment[];
  engine: string;
}): Promise<Transcript> {
  const t = now();
  const transcript: Transcript = {
    id: uid(),
    projectId: input.projectId || INBOX,
    recordingId: input.recordingId,
    title: input.title,
    original: input.text,
    text: input.text,
    segments: input.segments ?? [],
    engine: input.engine,
    createdAt: t,
    updatedAt: t,
  };
  await transact(["transcripts", "recordings"], "readwrite", async (tx) => {
    tx.put("transcripts", transcript);
    if (input.recordingId) {
      const r = await tx.get("recordings", input.recordingId);
      if (r) tx.put("recordings", { ...r, status: "transcribed", error: undefined, transcriptId: transcript.id, updatedAt: t });
    }
  });
  return transcript;
}

export async function updateTranscript(id: string, patch: Partial<Pick<Transcript, "text" | "title">>): Promise<void> {
  await transact(["transcripts"], "readwrite", async (tx) => {
    const tr = await tx.get("transcripts", id);
    if (!tr) throw new Error("Transcript not found");
    tx.put("transcripts", { ...tr, ...patch, updatedAt: now() });
  });
}

/** Move captured material (note, recording + its transcript) to a project or back to the inbox. */
export async function moveToProject(ref: EntityRef, projectId: string): Promise<void> {
  await transact(["notes", "recordings", "transcripts"], "readwrite", async (tx) => {
    if (ref.type === "note") {
      const n = await tx.get("notes", ref.id);
      if (n) tx.put("notes", { ...n, projectId, updatedAt: now() });
    } else if (ref.type === "recording") {
      const r = await tx.get("recordings", ref.id);
      if (r) tx.put("recordings", { ...r, projectId, updatedAt: now() });
      for (const tr of await tx.byIndex("transcripts", "recordingId", ref.id)) tx.put("transcripts", { ...tr, projectId });
    } else if (ref.type === "transcript") {
      const tr = await tx.get("transcripts", ref.id);
      if (tr) tx.put("transcripts", { ...tr, projectId, updatedAt: now() });
    }
  });
}

/* ================================================================== boards */

export async function getBoards(projectId: string): Promise<{ ideas: Board | undefined; structure: Board | undefined }> {
  const boards = await db.byIndex("boards", "projectId", projectId);
  return { ideas: boards.find((b) => b.kind === "ideas"), structure: boards.find((b) => b.kind === "structure") };
}

export async function updateBoard(id: string, patch: Partial<Pick<Board, "title" | "viewport">>): Promise<void> {
  await transact(["boards"], "readwrite", async (tx) => {
    const b = await tx.get("boards", id);
    if (b) tx.put("boards", { ...b, ...patch, updatedAt: now() });
  });
}

export interface NewCardInput {
  projectId: string;
  boardId: string;
  sectionId?: string | null;
  title?: string;
  body?: string;
  type?: CardType;
  x?: number;
  y?: number;
  source?: SourceRef;
  referenceId?: string;
}

/** Create a card. On the ideas board, lands in a free spot (inside its section when given). */
export async function createCard(input: NewCardInput): Promise<Card> {
  return transact(["cards", "sections"], "readwrite", async (tx) => {
    const t = now();
    const cards = await tx.byIndex("cards", "boardId", input.boardId);
    const sectionId = input.sectionId ?? null;
    let { x, y } = input;
    if (x === undefined || y === undefined) {
      const section = sectionId ? await tx.get("sections", sectionId) : undefined;
      const spot = findFreeSpot(cards, section);
      x = spot.x;
      y = spot.y;
    }
    const order = cards.filter((c) => c.sectionId === sectionId).reduce((m, c) => Math.max(m, c.order), -1) + 1;
    const card: Card = {
      id: uid(),
      projectId: input.projectId,
      boardId: input.boardId,
      sectionId,
      title: input.title?.trim() ?? "",
      body: input.body ?? "",
      type: input.type ?? "idea",
      x,
      y,
      order,
      source: input.source,
      referenceId: input.referenceId,
      createdAt: t,
      updatedAt: t,
    };
    tx.put("cards", card);
    return card;
  });
}

/** Find an unoccupied grid slot, inside a section frame if one is given, otherwise below everything. */
export function findFreeSpot(cards: Pick<Card, "x" | "y">[], section?: Pick<Section, "x" | "y" | "w" | "h">): { x: number; y: number } {
  const occupied = (x: number, y: number) => cards.some((c) => Math.abs(c.x - x) < CARD_W * 0.6 && Math.abs(c.y - y) < CARD_H * 0.6);
  if (section) {
    const pad = 20;
    const cols = Math.max(1, Math.floor((section.w - pad) / (CARD_W + 12)));
    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < cols; col++) {
        const x = section.x + pad + col * (CARD_W + 12);
        const y = section.y + 56 + row * (CARD_H + 12);
        if (!occupied(x, y)) return { x, y };
      }
    }
    return { x: section.x + pad, y: section.y + 56 };
  }
  const maxY = cards.reduce((m, c) => Math.max(m, c.y), -Infinity);
  const baseY = Number.isFinite(maxY) ? Math.max(maxY + CARD_H + 24, CLUSTER_H + 48) : CLUSTER_H + 48;
  for (let col = 0; col < 12; col++) {
    const x = col * (CARD_W + 16);
    if (!occupied(x, baseY - CARD_H - 24)) return { x, y: baseY - CARD_H - 24 > CLUSTER_H + 40 ? baseY - CARD_H - 24 : baseY };
  }
  return { x: 0, y: baseY };
}

export async function updateCard(id: string, patch: Partial<Omit<Card, "id" | "projectId" | "createdAt">>): Promise<void> {
  await transact(["cards"], "readwrite", async (tx) => {
    const c = await tx.get("cards", id);
    if (!c) throw new Error("Card not found");
    tx.put("cards", { ...c, ...patch, updatedAt: now() });
  });
}

export async function updateCards(patches: { id: string; patch: Partial<Omit<Card, "id" | "projectId" | "createdAt">> }[]): Promise<void> {
  await transact(["cards"], "readwrite", async (tx) => {
    for (const { id, patch } of patches) {
      const c = await tx.get("cards", id);
      if (c) tx.put("cards", { ...c, ...patch, updatedAt: now() });
    }
  });
}

/** Copy a card onto another board (e.g. a promising idea into the outline). Keeps a source link back. */
export async function sendCardToBoard(cardId: string, boardId: string, sectionId: string | null): Promise<Card> {
  const c = await db.get("cards", cardId);
  if (!c) throw new Error("Card not found");
  return createCard({
    projectId: c.projectId,
    boardId,
    sectionId,
    title: c.title,
    body: c.body,
    type: c.type === "idea" ? "scene" : c.type,
    source: c.source ?? { type: "card", id: c.id, excerpt: c.title || c.body.slice(0, 120) },
  });
}

export async function createSection(input: { projectId: string; boardId: string; title: string; x?: number; y?: number; w?: number; h?: number }): Promise<Section> {
  return transact(["sections"], "readwrite", async (tx) => {
    const t = now();
    const siblings = await tx.byIndex("sections", "boardId", input.boardId);
    const right = siblings.reduce((m, s) => Math.max(m, s.x + s.w), -CLUSTER_GAP);
    const section: Section = {
      id: uid(),
      projectId: input.projectId,
      boardId: input.boardId,
      title: input.title.trim() || "Untitled",
      x: input.x ?? right + CLUSTER_GAP,
      y: input.y ?? 0,
      w: input.w ?? CLUSTER_W,
      h: input.h ?? CLUSTER_H,
      collapsed: false,
      order: siblings.reduce((m, s) => Math.max(m, s.order), -1) + 1,
      createdAt: t,
      updatedAt: t,
    };
    tx.put("sections", section);
    return section;
  });
}

export async function updateSection(id: string, patch: Partial<Omit<Section, "id" | "projectId" | "boardId" | "createdAt">>): Promise<void> {
  await transact(["sections"], "readwrite", async (tx) => {
    const s = await tx.get("sections", id);
    if (s) tx.put("sections", { ...s, ...patch, updatedAt: now() });
  });
}

/** Move a section frame and every card inside it by the same offset. */
export async function moveSection(id: string, dx: number, dy: number): Promise<void> {
  await transact(["sections", "cards"], "readwrite", async (tx) => {
    const s = await tx.get("sections", id);
    if (!s) return;
    tx.put("sections", { ...s, x: s.x + dx, y: s.y + dy, updatedAt: now() });
    for (const c of await tx.byIndex("cards", "boardId", s.boardId)) {
      if (c.sectionId === id) tx.put("cards", { ...c, x: c.x + dx, y: c.y + dy });
    }
  });
}

export async function reorderSections(ids: string[]): Promise<void> {
  await transact(["sections"], "readwrite", async (tx) => {
    for (const [i, id] of ids.entries()) {
      const s = await tx.get("sections", id);
      if (s && s.order !== i) tx.put("sections", { ...s, order: i });
    }
  });
}

/** Structure board: set the full ordered membership of one or more sections at once. */
export async function arrangeStructure(columns: { sectionId: string | null; cardIds: string[] }[]): Promise<void> {
  await transact(["cards"], "readwrite", async (tx) => {
    for (const col of columns) {
      for (const [i, id] of col.cardIds.entries()) {
        const c = await tx.get("cards", id);
        if (c && (c.order !== i || c.sectionId !== col.sectionId)) tx.put("cards", { ...c, sectionId: col.sectionId, order: i, updatedAt: now() });
      }
    }
  });
}

/* ================================================================== links */

export async function addLink(projectId: string, from: EntityRef, to: EntityRef, kind: LinkKind = "related"): Promise<Link> {
  return transact(["links"], "readwrite", async (tx) => {
    const existing = (await tx.byIndex("links", "projectId", projectId)).find(
      (l) =>
        (l.from.id === from.id && l.to.id === to.id) || (kind !== "supports" && kind !== "depends" && kind !== "leads" && l.from.id === to.id && l.to.id === from.id),
    );
    if (existing) {
      if (existing.kind !== kind) {
        const updated = { ...existing, kind };
        tx.put("links", updated);
        return updated;
      }
      return existing;
    }
    const link: Link = { id: uid(), projectId, from, to, kind, createdAt: now() };
    tx.put("links", link);
    return link;
  });
}

export async function removeLink(id: string): Promise<void> {
  await db.delete("links", id);
}

/* ================================================================== references */

export async function createReference(input: { projectId: string; title: string; kind: ReferenceKind; summary?: string; fieldLabels?: string[] }): Promise<Reference> {
  const t = now();
  const ref: Reference = {
    id: uid(),
    projectId: input.projectId,
    title: input.title.trim() || "Untitled",
    kind: input.kind,
    summary: input.summary ?? "",
    body: "",
    fields: (input.fieldLabels ?? []).map((label) => ({ id: uid(), label, value: "" })),
    createdAt: t,
    updatedAt: t,
  };
  await db.put("references", ref);
  return ref;
}

export async function updateReference(id: string, patch: Partial<Omit<Reference, "id" | "projectId" | "createdAt">>): Promise<void> {
  await transact(["references"], "readwrite", async (tx) => {
    const r = await tx.get("references", id);
    if (!r) throw new Error("Reference not found");
    tx.put("references", { ...r, ...patch, updatedAt: now() });
  });
}

export async function updateReferenceField(id: string, fieldId: string, patch: Partial<{ label: string; value: string }>): Promise<void> {
  await transact(["references"], "readwrite", async (tx) => {
    const r = await tx.get("references", id);
    if (!r) throw new Error("Reference not found");
    tx.put("references", { ...r, fields: r.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)), updatedAt: now() });
  });
}

/* ================================================================== process */

function buildProcess(projectId: string, tpl: Pick<ProcessTemplate, "id" | "name" | "steps">, title?: string): { process: Process; steps: Step[] } {
  const t = now();
  const process: Process = { id: uid(), projectId, title: title ?? tpl.name, templateId: tpl.id, createdAt: t, updatedAt: t };
  const steps = tpl.steps.map((s, i) => newStepRecord(process, s, i));
  return { process, steps };
}

function newStepRecord(process: Process, s: TemplateStep, order: number): Step {
  const t = now();
  return {
    id: uid(),
    processId: process.id,
    projectId: process.projectId,
    title: s.title,
    objective: s.objective,
    prompt: s.prompt,
    response: "",
    status: "open",
    context: s.context,
    order,
    createdAt: t,
    updatedAt: t,
  };
}

export async function createProcess(projectId: string, template: Pick<ProcessTemplate, "id" | "name" | "steps"> | null, title?: string): Promise<Process> {
  const tpl = template ?? { id: "custom", name: title || "My process", steps: [] };
  const { process, steps } = buildProcess(projectId, tpl, title);
  await transact(["processes", "steps"], "readwrite", (tx) => {
    tx.put("processes", process);
    steps.forEach((s) => tx.put("steps", s));
  });
  return process;
}

export async function updateProcess(id: string, patch: Partial<Pick<Process, "title">>): Promise<void> {
  await transact(["processes"], "readwrite", async (tx) => {
    const p = await tx.get("processes", id);
    if (p) tx.put("processes", { ...p, ...patch, updatedAt: now() });
  });
}

export async function addStep(processId: string, input: Partial<TemplateStep> = {}, afterOrder?: number): Promise<Step> {
  return transact(["processes", "steps"], "readwrite", async (tx) => {
    const process = await tx.get("processes", processId);
    if (!process) throw new Error("Process not found");
    const steps = (await tx.byIndex("steps", "processId", processId)).sort((a, b) => a.order - b.order);
    const insertAt = afterOrder === undefined ? steps.length : afterOrder + 1;
    steps.forEach((s, i) => {
      const order = i >= insertAt ? i + 1 : i;
      if (s.order !== order) tx.put("steps", { ...s, order });
    });
    const step = newStepRecord(
      process,
      { title: input.title ?? "New step", objective: input.objective ?? "", prompt: input.prompt ?? "", context: input.context ?? "none" },
      insertAt,
    );
    tx.put("steps", step);
    return step;
  });
}

export async function updateStep(id: string, patch: Partial<Omit<Step, "id" | "processId" | "projectId" | "createdAt">>): Promise<void> {
  await transact(["steps"], "readwrite", async (tx) => {
    const s = await tx.get("steps", id);
    if (!s) throw new Error("Step not found");
    tx.put("steps", { ...s, ...patch, updatedAt: now() });
  });
}

export async function reorderSteps(ids: string[]): Promise<void> {
  await transact(["steps"], "readwrite", async (tx) => {
    for (const [i, id] of ids.entries()) {
      const s = await tx.get("steps", id);
      if (s && s.order !== i) tx.put("steps", { ...s, order: i });
    }
  });
}

export async function saveProcessAsTemplate(processId: string, name: string, description: string): Promise<ProcessTemplate> {
  const steps = (await db.byIndex("steps", "processId", processId)).sort((a, b) => a.order - b.order);
  const tpl: ProcessTemplate = {
    id: uid(),
    name: name.trim() || "My process",
    description: description.trim(),
    builtIn: false,
    createdAt: now(),
    steps: steps.map((s) => ({ title: s.title, objective: s.objective, prompt: s.prompt, context: s.context })),
  };
  await db.put("templates", tpl);
  return tpl;
}

/* ================================================================== decisions */

export async function createDecision(projectId: string, input: Partial<Pick<Decision, "question" | "options">> & { linkTo?: EntityRef } = {}): Promise<Decision> {
  const t = now();
  const decision: Decision = {
    id: uid(),
    projectId,
    question: input.question ?? "",
    options: input.options ?? [
      { id: uid(), text: "", note: "" },
      { id: uid(), text: "", note: "" },
    ],
    chosenOptionId: null,
    rationale: "",
    tradeoffs: "",
    next: "",
    status: "open",
    createdAt: t,
    updatedAt: t,
  };
  await transact(["decisions", "links", "steps", "cards"], "readwrite", async (tx) => {
    tx.put("decisions", decision);
    if (input.linkTo) {
      tx.put("links", { id: uid(), projectId, from: { type: "decision", id: decision.id }, to: input.linkTo, kind: "related", createdAt: t });
      if (input.linkTo.type === "step") {
        const s = await tx.get("steps", input.linkTo.id);
        if (s) tx.put("steps", { ...s, decisionId: decision.id, updatedAt: t });
      }
      if (input.linkTo.type === "card") {
        const c = await tx.get("cards", input.linkTo.id);
        if (c) tx.put("cards", { ...c, decisionId: decision.id, type: "decision", updatedAt: t });
      }
    }
  });
  return decision;
}

export async function updateDecision(id: string, patch: Partial<Omit<Decision, "id" | "projectId" | "createdAt">>): Promise<void> {
  await transact(["decisions"], "readwrite", async (tx) => {
    const d = await tx.get("decisions", id);
    if (!d) throw new Error("Decision not found");
    const next = { ...d, ...patch, updatedAt: now() };
    if (patch.status === "decided" && d.status !== "decided") next.decidedAt = now();
    tx.put("decisions", next);
  });
}

/** Update one option in place (read-modify-write in a single transaction, so concurrent edits don't clobber). */
export async function updateDecisionOption(id: string, optionId: string, patch: Partial<{ text: string; note: string }>): Promise<void> {
  await transact(["decisions"], "readwrite", async (tx) => {
    const d = await tx.get("decisions", id);
    if (!d) throw new Error("Decision not found");
    tx.put("decisions", { ...d, options: d.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)), updatedAt: now() });
  });
}

/* ================================================================== prefs */

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  const p = await db.get("prefs", key);
  return p ? (p.value as T) : fallback;
}

export async function setPref(key: string, value: unknown): Promise<void> {
  await db.put("prefs", { key, value });
}

/* ================================================================== misc */

export type LastLocation = { mode: Mode; entityId?: string };

export { ALL_STORES };
