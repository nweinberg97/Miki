// Turning captured material into working material, always keeping a link back to the source.
import { db } from "../../data/db";
import { createCard, createNote, saveDocumentContent } from "../../data/repo";
import type { DocContent, NoteKind, SourceRef } from "../../data/types";
import { docToPlainText, type PMNode } from "../../editor/serialize";
import { deriveTitle, wordCount } from "../../lib/util";
import { projectTemplate } from "../../data/templates";

export async function excerptToNote(projectId: string, excerpt: string, source: SourceRef, kind: NoteKind = "fragment") {
  return createNote({ projectId, title: deriveTitle(excerpt, 56) === excerpt.trim() ? "" : deriveTitle(excerpt, 56), body: excerpt.trim(), kind, source });
}

async function boardOf(projectId: string, kind: "ideas" | "structure") {
  const b = (await db.byIndex("boards", "projectId", projectId)).find((x) => x.kind === kind);
  if (!b) throw new Error("This project has no board for that.");
  return b;
}

export async function excerptToIdeaCard(projectId: string, excerpt: string, source: SourceRef, title = "") {
  const board = await boardOf(projectId, "ideas");
  const sections = await db.byIndex("sections", "boardId", board.id);
  // New material lands in the first "collecting"-style cluster if there is one.
  const inbox = sections.find((s) => /collect|inbox|raw/i.test(s.title)) ?? null;
  return createCard({ projectId, boardId: board.id, sectionId: inbox?.id ?? null, title, body: excerpt.trim(), type: "idea", source });
}

export async function excerptToStructureCard(projectId: string, sectionId: string | null, excerpt: string, source: SourceRef, title = "") {
  const board = await boardOf(projectId, "structure");
  const project = await db.get("projects", projectId);
  const type = project ? projectTemplate(project.type).cardNoun.type : "idea";
  return createCard({ projectId, boardId: board.id, sectionId, title: title || deriveTitle(excerpt, 60), body: excerpt.trim(), type, x: 0, y: 0, source });
}

/** Append a passage to the end of a draft, as a quote (verbatim) or as plain paragraphs (editable prose). */
export async function appendToDocument(docId: string, excerpt: string, asQuote: boolean) {
  const doc = await db.get("documents", docId);
  if (!doc) throw new Error("That document no longer exists.");
  const paras: PMNode[] = excerpt
    .trim()
    .split(/\n{2,}/)
    .map((p) => ({ type: "paragraph", content: p.trim() ? [{ type: "text", text: p.trim() }] : undefined }));
  const blocks: PMNode[] = asQuote ? [{ type: "blockquote", content: paras }] : paras;
  const existing = (doc.content.content ?? []) as PMNode[];
  // Replace a lone empty paragraph rather than leaving a blank line at the top.
  const base = existing.length === 1 && existing[0].type === "paragraph" && !existing[0].content?.length ? [] : existing;
  const content: DocContent = { type: "doc", content: [...base, ...blocks] };
  const plain = docToPlainText(content);
  await saveDocumentContent(docId, content, plain, wordCount(plain));
}

/** Split text into candidate fragments: paragraphs, or sentences when there's only one paragraph. */
export function splitFragments(text: string): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length > 1) return paras;
  const one = paras[0] ?? "";
  const sentences = one.match(/[^.!?]+[.!?]+["”’)]?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  // Group short sentences in pairs so fragments carry a whole thought.
  const out: string[] = [];
  for (const s of sentences) {
    const last = out[out.length - 1];
    if (last && (last.length < 60 || s.length < 30)) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out;
}
