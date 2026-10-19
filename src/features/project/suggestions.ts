// Rule-based, dismissible nudges. Deterministic — no AI, no analysis claims.
// Each rule looks at the project's material and, when useful, offers one next action.
import type { Board, Card, Decision, Document, Note, Project, Recording, Section, Step, Transcript } from "../../data/types";

export interface ProjectSnapshot {
  project: Project;
  docs: Document[];
  notes: Note[];
  recordings: Recording[];
  transcripts: Transcript[];
  boards: Board[];
  sections: Section[];
  cards: Card[];
  decisions: Decision[];
  steps: Step[];
}

export type SuggestionAction =
  | { kind: "go"; mode: string; query?: Record<string, string> }
  | { kind: "draft-from-structure" }
  | { kind: "focus-thread" };

export interface Suggestion {
  /** Stable id including the triggering entity, so dismissing one doesn't hide future ones. */
  id: string;
  text: string;
  actionLabel: string;
  action: SuggestionAction;
}

const DAY = 24 * 60 * 60 * 1000;

export function suggestionsFor(s: ProjectSnapshot, now = Date.now()): Suggestion[] {
  const out: Suggestion[] = [];
  const ideas = s.boards.find((b) => b.kind === "ideas");
  const structure = s.boards.find((b) => b.kind === "structure");
  const ideaCards = s.cards.filter((c) => c.boardId === ideas?.id);
  const structureCards = s.cards.filter((c) => c.boardId === structure?.id);
  const derivedFrom = new Set([...s.notes, ...s.cards].map((x) => x.source?.id).filter(Boolean));

  // A transcript nobody has pulled anything out of yet.
  const fresh = s.transcripts.filter((t) => !derivedFrom.has(t.id) && t.text.trim().length > 80).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (fresh) {
    out.push({
      id: `transcript-extract:${fresh.id}`,
      text: `“${fresh.title}” is transcribed. Want to pull out the key ideas?`,
      actionLabel: "Open transcript",
      action: { kind: "go", mode: "capture", query: { tr: fresh.id } },
    });
  }

  // Loose ideas floating outside any cluster.
  const loose = ideaCards.filter((c) => !c.sectionId);
  if (loose.length >= 4) {
    out.push({
      id: `group-loose:${loose.length >= 8 ? "8" : "4"}`,
      text: `${loose.length} ideas are floating loose. Want to give them a place?`,
      actionLabel: "Open idea space",
      action: { kind: "go", mode: "explore" },
    });
  }

  // Several promising ideas but no thread.
  const promising = s.sections.find((x) => x.boardId === ideas?.id && /promising/i.test(x.title));
  const promisingCount = promising ? ideaCards.filter((c) => c.sectionId === promising.id).length : 0;
  if (!s.project.thread.trim() && promisingCount >= 2) {
    out.push({
      id: "thread-from-promising",
      text: `You've marked ${promisingCount} ideas as promising. What's the thread that connects them?`,
      actionLabel: "Name the thread",
      action: { kind: "focus-thread" },
    });
  } else if (!s.project.thread.trim() && s.notes.length + ideaCards.length >= 5) {
    out.push({
      id: "thread-from-material",
      text: "There's a fair amount collected here. What matters most in it?",
      actionLabel: "Name the thread",
      action: { kind: "focus-thread" },
    });
  }

  // Unsorted notes on the project that never made it onto a board.
  const onBoard = new Set(s.cards.map((c) => c.source?.id).filter(Boolean));
  const unplaced = s.notes.filter((n) => !onBoard.has(n.id));
  if (unplaced.length >= 5 && ideaCards.length < 3) {
    out.push({
      id: `notes-to-board:${unplaced.length >= 10 ? "10" : "5"}`,
      text: `${unplaced.length} notes haven't been laid out yet. Seeing them side by side can help.`,
      actionLabel: "Review notes",
      action: { kind: "go", mode: "capture" },
    });
  }

  // A structure with no draft yet.
  const drafted = s.docs.some((d) => d.wordCount > 30);
  if (structureCards.length >= 3 && !drafted) {
    out.push({
      id: "draft-from-structure",
      text: "There's a structure taking shape. Ready to start a draft from it?",
      actionLabel: "Draft from structure",
      action: { kind: "draft-from-structure" },
    });
  }

  // A decision left open for a while.
  const stale = s.decisions.filter((d) => d.status === "open" && now - d.createdAt > 2 * DAY).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (stale) {
    out.push({
      id: `open-decision:${stale.id}`,
      text: `One decision is still open: “${stale.question || "Untitled decision"}”.`,
      actionLabel: "Revisit",
      action: { kind: "go", mode: "discern", query: { decision: stale.id } },
    });
  }

  // A decided question without a reason recorded.
  const unexplained = s.decisions.find((d) => d.status === "decided" && !d.rationale.trim());
  if (unexplained) {
    out.push({
      id: `decision-rationale:${unexplained.id}`,
      text: `You chose a direction for “${unexplained.question || "a decision"}”. A sentence on why will help future you.`,
      actionLabel: "Add the why",
      action: { kind: "go", mode: "discern", query: { decision: unexplained.id } },
    });
  }

  // A step with thinking written but never closed.
  const lingering = s.steps.find((st) => st.status === "open" && st.response.trim().length > 40 && now - st.updatedAt > DAY);
  if (lingering) {
    out.push({
      id: `step-close:${lingering.id}`,
      text: `“${lingering.title}” has some thinking in it. Is it settled enough to mark done?`,
      actionLabel: "Open step",
      action: { kind: "go", mode: "discern", query: { step: lingering.id } },
    });
  }

  return out;
}
