import type { CardType, LinkKind } from "../../data/types";
import { IconDoc, IconIdea, IconNote, IconQuestion, IconResearch, IconSignpost, IconUser } from "../../ui/icons";

export const CARD_META: Record<CardType, { label: string; icon: typeof IconIdea }> = {
  idea: { label: "Idea", icon: IconIdea },
  scene: { label: "Scene", icon: IconDoc },
  question: { label: "Question", icon: IconQuestion },
  decision: { label: "Decision", icon: IconSignpost },
  character: { label: "Character", icon: IconUser },
  research: { label: "Research", icon: IconResearch },
  note: { label: "Note", icon: IconNote },
};

export const LINK_KINDS: { kind: LinkKind; label: string; verb: string }[] = [
  { kind: "related", label: "Related", verb: "relates to" },
  { kind: "supports", label: "Supports", verb: "supports" },
  { kind: "contradicts", label: "Contradicts", verb: "pushes against" },
  { kind: "depends", label: "Depends on", verb: "depends on" },
  { kind: "leads", label: "Leads to", verb: "leads to" },
];

export function linkLabel(kind: LinkKind): string {
  return LINK_KINDS.find((k) => k.kind === kind)?.label ?? (kind === "features" ? "Features" : "Related");
}
