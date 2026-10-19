import type { EntityRef, Mode, Part, Project } from "../../data/types";
import { href, projectPath } from "../../lib/router";

/**
 * 三木 — three trees, three principles. Every project has three parts:
 *   根 Roots  — intention: what it's for, who it's for, what it grows from
 *   葉 Leaves — ideas: everything captured, spoken or written; fallen leaves too
 *   幹 Trunk  — discernment: the thread, what you carry in order, your choices, the draft
 */
export const PARTS: { part: Part; kanji: string; label: string; principle: string; line: string; key: string }[] = [
  { part: "roots", kanji: "根", label: "Roots", principle: "Intention", line: "Why this piece exists, and who it's for.", key: "1" },
  { part: "leaves", kanji: "葉", label: "Leaves", principle: "Ideas", line: "Everything you've captured. Let it grow freely.", key: "2" },
  { part: "trunk", kanji: "幹", label: "Trunk", principle: "Discernment", line: "What you choose to carry, in order — and the draft.", key: "3" },
];

export function partInfo(part: Part) {
  return PARTS.find((p) => p.part === part)!;
}

/** Map any mode name (including older URLs) onto one of the three parts. */
export function toPart(mode: string | undefined, project?: Project): Part {
  switch (mode) {
    case "roots":
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
      // No part given: start where the work is. Unrooted projects begin at the roots.
      if (project && !project.purpose?.trim() && !project.thread.trim()) return "roots";
      return project?.lastLocation?.mode ? toPart(project.lastLocation.mode) : "leaves";
  }
}

export function partLabel(mode: Mode | undefined): string {
  return mode ? partInfo(toPart(mode)).label : "Leaves";
}

export const partPath = (projectId: string, part: Part) => projectPath(projectId, part);

/** Where a piece of project material lives. */
export function entityHref(projectId: string, ref: EntityRef, extra: Record<string, string> = {}): string {
  const at = (part: Part, q: Record<string, string>) => href(partPath(projectId, part), { ...q, ...extra });
  switch (ref.type) {
    case "document":
      return at("trunk", { view: "draft", doc: ref.id });
    case "card":
      return at("trunk", { view: "shape", card: ref.id });
    case "decision":
      return at("trunk", { view: "choices", decision: ref.id });
    case "step":
      return at("trunk", {});
    case "note":
      return at("leaves", { note: ref.id });
    case "transcript":
      return at("leaves", { tr: ref.id });
    case "recording":
      return at("leaves", { rec: ref.id });
    case "reference":
      return at("roots", { view: "sources", ref: ref.id });
    default:
      return at("roots", {});
  }
}
