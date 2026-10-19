import type { EntityRef, Mode, Part, Project } from "../../data/types";
import { href, projectPath } from "../../lib/router";

/**
 * 三木 — three trees, three principles. Every project has three parts:
 *   根 Roots  — intention: what it's for, who it's for, what it grows from
 *   葉 Leaves — ideas: everything captured, spoken or written; fallen leaves too
 *   幹 Trunk  — discernment: the thread, what you carry in order, your choices, the draft
 */
export const PARTS: { part: Part; kanji: string; label: string; principle: string; line: string; key: string }[] = [
  { part: "roots", kanji: "根", label: "Roots", principle: "Intention", line: "The overview, why this piece exists, who it's for, and what it grows from.", key: "1" },
  { part: "leaves", kanji: "葉", label: "Leaves", principle: "Ideas", line: "Everything you've captured, and the storyboard where ideas spread out.", key: "2" },
  { part: "trunk", kanji: "幹", label: "Trunk", principle: "Discernment", line: "The shape, the draft, and the choices that hold it up.", key: "3" },
];

export function partInfo(part: Part) {
  return PARTS.find((p) => p.part === part)!;
}

/** Map any mode name (including older URLs) onto one of the three parts. */
export function toPart(mode: string | undefined, project?: Project): Part {
  switch (mode) {
    case "roots":
    case "overview":
    case "reference":
      return "roots";
    case "leaves":
    case "capture":
    case "explore":
      return "leaves";
    case "trunk":
    case "arrange":
    case "write":
    case "discern":
      return "trunk";
    default:
      // No part given: start where the writer left off, or at the roots (the overview).
      return project?.lastLocation?.mode ? toPart(project.lastLocation.mode) : "roots";
  }
}

export function partLabel(mode: Mode | undefined): string {
  return mode ? partInfo(toPart(mode)).label : "Leaves";
}

export const partPath = (projectId: string, part: Part) => projectPath(projectId, part);

/** Where a piece of project material lives. */
export function entityHref(projectId: string, ref: EntityRef & { group?: string }, extra: Record<string, string> = {}): string {
  const at = (part: Part, q: Record<string, string>) => href(partPath(projectId, part), { ...q, ...extra });
  switch (ref.type) {
    case "document":
      return at("trunk", { view: "draft", doc: ref.id });
    case "card":
      return ref.group === "Storyboard" ? at("leaves", { view: "storyboard", card: ref.id }) : at("trunk", { view: "shape", card: ref.id });
    case "decision":
      return at("trunk", { view: "discern", decision: ref.id });
    case "step":
      return at("trunk", { view: "discern", step: ref.id });
    case "note":
      return at("leaves", { note: ref.id });
    case "transcript":
      return at("leaves", { tr: ref.id });
    case "recording":
      return at("leaves", { rec: ref.id });
    case "reference":
      return at("roots", { view: "sources", ref: ref.id });
    default:
      return at("roots", { view: "overview" });
  }
}

/** Where each of the PRD's views lives now: a part, and a view inside it. */
const VIEW_OF: Record<string, [Part, string | null]> = {
  overview: ["roots", "overview"],
  reference: ["roots", "sources"],
  capture: ["leaves", null],
  explore: ["leaves", "storyboard"],
  arrange: ["trunk", "shape"],
  write: ["trunk", "draft"],
  discern: ["trunk", "discern"],
};

export function viewLoc(projectId: string, view: string, q: Record<string, string> = {}): [string, Record<string, string>] {
  const [part, v] = VIEW_OF[view] ?? [toPart(view), null];
  return [partPath(projectId, part), v ? { view: v, ...q } : q];
}

export const viewHref = (projectId: string, view: string, q: Record<string, string> = {}) => href(...viewLoc(projectId, view, q));
