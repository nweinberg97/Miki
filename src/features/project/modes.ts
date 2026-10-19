import type { Mode } from "../../data/types";
import { IconCapture, IconCompass, IconExplore, IconLibrary, IconOutline, IconPen, IconSignpost } from "../../ui/icons";

/** The ways of working inside a project. Same material, different views. */
export const MODES: { mode: Mode; label: string; hint: string; icon: typeof IconPen; key: string }[] = [
  { mode: "overview", label: "Overview", hint: "The thread, where you left off, and what's next", icon: IconCompass, key: "1" },
  { mode: "capture", label: "Capture", hint: "Notes, fragments, and voice", icon: IconCapture, key: "2" },
  { mode: "explore", label: "Explore", hint: "The idea space: gather and sort what you have", icon: IconExplore, key: "3" },
  { mode: "arrange", label: "Arrange", hint: "Give the work a shape and sequence", icon: IconOutline, key: "4" },
  { mode: "write", label: "Write", hint: "Drafts and the editor", icon: IconPen, key: "5" },
  { mode: "discern", label: "Discern", hint: "Work through decisions, step by step", icon: IconSignpost, key: "6" },
  { mode: "reference", label: "Reference", hint: "Characters, sources, places, and themes", icon: IconLibrary, key: "7" },
];

export function modeLabel(mode: Mode | undefined): string {
  return MODES.find((m) => m.mode === mode)?.label ?? "Overview";
}

export function isMode(v: string | undefined): v is Mode {
  return MODES.some((m) => m.mode === v);
}
