// "Miki asks": one gentle, rule-based question at a time for each part of a project.
// Deterministic — no AI, no claims of analysis. Each rule looks at the material and,
// when useful, offers a single next step.
import type { Card, Decision, Document, Note, Part, Project, Recording, Reference, Section, Transcript } from "../../data/types";

export interface ProjectSnapshot {
  project: Project;
  docs: Document[];
  notes: Note[];
  recordings: Recording[];
  transcripts: Transcript[];
  /** Sections and cards on the trunk (the structure board). */
  parts: Section[];
  trunkCards: Card[];
  decisions: Decision[];
  refs: Reference[];
}

export type SuggestionAction =
  | { kind: "focus"; field: "purpose" | "audience" | "thread" }
  | { kind: "go"; part: Part; query?: Record<string, string> }
  | { kind: "record" }
  | { kind: "add-reference" }
  | { kind: "draft-from-trunk" };

export interface Suggestion {
  /** Stable id (includes the triggering entity), so dismissing one doesn't hide future ones. */
  id: string;
  part: Part;
  text: string;
  actionLabel?: string;
  action?: SuggestionAction;
}

const DAY = 24 * 60 * 60 * 1000;

export function suggestionsFor(s: ProjectSnapshot, now = Date.now()): Suggestion[] {
  const out: Suggestion[] = [];
  const growing = s.notes.filter((n) => !n.fallen);
  const leafCount = growing.length + s.recordings.filter((r) => !r.transcriptId).length;
  const carried = new Set(s.trunkCards.map((c) => c.source?.id).filter(Boolean));
  const p = s.project;

  /* ---------------- roots: intention */
  if (!p.purpose?.trim()) {
    out.push({ id: "roots-purpose", part: "roots", text: "What is this piece for? A sentence is enough — you can change it later.", actionLabel: "Answer", action: { kind: "focus", field: "purpose" } });
  } else if (!p.audience?.trim()) {
    out.push({ id: "roots-audience", part: "roots", text: "Who is it for? Picture one reader.", actionLabel: "Answer", action: { kind: "focus", field: "audience" } });
  }
  if (!p.thread.trim() && leafCount >= 3) {
    out.push({
      id: "roots-thread",
      part: "roots",
      text: `You have ${leafCount} leaves growing. If you had to say what this is about in one sentence, what would it be?`,
      actionLabel: "Name the thread",
      action: { kind: "focus", field: "thread" },
    });
  }
  if ((p.type === "story" || p.type === "memoir") && !s.refs.some((r) => r.kind === "character") && leafCount >= 2) {
    out.push({ id: "roots-people", part: "roots", text: "Who are the people in it? Add them here so they're always close at hand.", actionLabel: "Add a person", action: { kind: "add-reference" } });
  }

  /* ---------------- leaves: ideas */
  if (leafCount === 0 && s.transcripts.length === 0) {
    out.push({ id: "leaves-first", part: "leaves", text: "Start with what you have. Say it out loud, or jot down a single line.", actionLabel: "Talk it through", action: { kind: "record" } });
  }
  const derived = new Set(s.notes.map((n) => n.source?.id).filter(Boolean));
  const fresh = s.transcripts.filter((t) => !derived.has(t.id) && !carried.has(t.id) && t.text.trim().length > 80).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (fresh) {
    out.push({
      id: `leaves-transcript:${fresh.id}`,
      part: "leaves",
      text: `“${fresh.title}” is written out. Which parts are worth keeping as leaves?`,
      actionLabel: "Open it",
      action: { kind: "go", part: "leaves", query: { tr: fresh.id } },
    });
  }
  const uncarried = growing.filter((n) => !carried.has(n.id));
  if (uncarried.length >= 5 && s.trunkCards.length === 0) {
    out.push({
      id: "leaves-discern",
      part: "leaves",
      text: `${uncarried.length} leaves are growing. Which ones matter most? Carry those onto the trunk, and let the rest fall.`,
    });
  }

  /* ---------------- trunk: discernment */
  if (s.trunkCards.length === 0 && leafCount > 0) {
    out.push({
      id: "trunk-empty",
      part: "trunk",
      text: "Nothing on the trunk yet. Go to your leaves and carry the ones that matter here.",
      actionLabel: "Go to Leaves",
      action: { kind: "go", part: "leaves" },
    });
  }
  if (!p.thread.trim() && s.trunkCards.length > 0) {
    out.push({ id: "trunk-thread", part: "trunk", text: "What's the thread holding this together? One sentence.", actionLabel: "Name it", action: { kind: "go", part: "roots", query: { focus: "thread" } } });
  }
  const drafted = s.docs.some((d) => d.wordCount > 30);
  if (s.trunkCards.length >= 3 && !drafted) {
    out.push({ id: "trunk-draft", part: "trunk", text: "There's a shape here. Ready to grow a draft from it?", actionLabel: "Grow a draft", action: { kind: "draft-from-trunk" } });
  }
  const stale = s.decisions.filter((d) => d.status === "open" && now - d.createdAt > 2 * DAY).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (stale) {
    out.push({ id: `trunk-open:${stale.id}`, part: "trunk", text: `One choice is still open: “${stale.question || "untitled"}”.`, actionLabel: "Revisit", action: { kind: "go", part: "trunk", query: { decision: stale.id } } });
  }
  const unexplained = s.decisions.find((d) => d.status === "decided" && !d.rationale.trim());
  if (unexplained) {
    out.push({
      id: `trunk-why:${unexplained.id}`,
      part: "trunk",
      text: `You chose a direction for “${unexplained.question || "a choice"}”. A sentence on why will help you later.`,
      actionLabel: "Add the why",
      action: { kind: "go", part: "trunk", query: { decision: unexplained.id } },
    });
  }
  return out;
}

/** Miki asks one thing at a time. */
export function nextQuestion(s: ProjectSnapshot, part: Part, dismissed: string[], now = Date.now()): Suggestion | undefined {
  return suggestionsFor(s, now).find((q) => q.part === part && !dismissed.includes(q.id));
}
