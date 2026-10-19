import type { CardType, ProjectType, ProcessTemplate, ReferenceKind, TemplateStep } from "./types";

export interface ProjectTemplate {
  type: ProjectType;
  label: string;
  blurb: string;
  /** Clusters on the idea board. "Set aside" is deliberate: discernment, not deletion. */
  ideaClusters: string[];
  /** Columns on the structure board, in sequence. */
  structureSections: string[];
  structureLabel: string;
  cardNoun: { type: CardType; label: string };
  referenceKinds: ReferenceKind[];
  starterDocs: string[];
  processTemplateId: string | null;
}

const IDEA_CLUSTERS = ["Collecting", "Promising", "Set aside"];

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    type: "essay",
    label: "Essay or article",
    blurb: "An argument, a reflection, a Substack piece.",
    ideaClusters: IDEA_CLUSTERS,
    structureSections: ["Opening", "The argument", "Complication", "Close"],
    structureLabel: "Outline",
    cardNoun: { type: "idea", label: "Point" },
    referenceKinds: ["source", "argument", "theme"],
    starterDocs: ["Draft"],
    processTemplateId: "tpl-essay",
  },
  {
    type: "memoir",
    label: "Memoir chapter",
    blurb: "A remembered moment and what it came to mean.",
    ideaClusters: IDEA_CLUSTERS,
    structureSections: ["Before", "The turn", "After", "What it meant"],
    structureLabel: "Chapter shape",
    cardNoun: { type: "scene", label: "Scene" },
    referenceKinds: ["character", "place", "theme"],
    starterDocs: ["Chapter draft"],
    processTemplateId: "tpl-memoir",
  },
  {
    type: "story",
    label: "Short story",
    blurb: "Characters, scenes, and a shape that holds them.",
    ideaClusters: IDEA_CLUSTERS,
    structureSections: ["Beginning", "Middle", "End"],
    structureLabel: "Scene sequence",
    cardNoun: { type: "scene", label: "Scene" },
    referenceKinds: ["character", "place", "theme"],
    starterDocs: ["Story draft"],
    processTemplateId: "tpl-story",
  },
  {
    type: "book",
    label: "Book or long-form",
    blurb: "Parts, chapters, research, and a long arc.",
    ideaClusters: IDEA_CLUSTERS,
    structureSections: ["Part one", "Part two", "Part three"],
    structureLabel: "Chapter map",
    cardNoun: { type: "scene", label: "Chapter" },
    referenceKinds: ["character", "research", "source", "theme"],
    starterDocs: [],
    processTemplateId: "tpl-book",
  },
  {
    type: "exploration",
    label: "Open exploration",
    blurb: "Not a project yet. Just something pulling at you.",
    ideaClusters: IDEA_CLUSTERS,
    structureSections: ["Threads"],
    structureLabel: "Threads",
    cardNoun: { type: "idea", label: "Idea" },
    referenceKinds: ["research", "question", "theme"],
    starterDocs: [],
    processTemplateId: "tpl-exploration",
  },
  {
    type: "blank",
    label: "Blank",
    blurb: "An empty studio. Add structure when you want it.",
    ideaClusters: [],
    structureSections: [],
    structureLabel: "Structure",
    cardNoun: { type: "idea", label: "Card" },
    referenceKinds: ["character", "place", "research", "source", "theme", "argument", "question", "other"],
    starterDocs: [],
    processTemplateId: null,
  },
];

export function projectTemplate(type: ProjectType): ProjectTemplate {
  return PROJECT_TEMPLATES.find((t) => t.type === type) ?? PROJECT_TEMPLATES[PROJECT_TEMPLATES.length - 1];
}

const s = (title: string, objective: string, prompt: string, context: TemplateStep["context"]): TemplateStep => ({
  title,
  objective,
  prompt,
  context,
});

export const BUILT_IN_PROCESSES: ProcessTemplate[] = [
  {
    id: "tpl-essay",
    name: "Essay",
    description: "From a hunch to an argument worth reading.",
    builtIn: true,
    createdAt: 0,
    steps: [
      s("Define the objective", "Say what this piece should do, in plain words.", "If this essay works, what will be different for the reader afterward?", "none"),
      s("Audience and effect", "Picture who you're writing for and what you want them to feel or understand.", "Who is this for? What do they already believe? What should they feel at the end?", "none"),
      s("Explore approaches", "Collect the possible angles before committing to one.", "What are three different ways into this? Which one surprises you?", "ideas"),
      s("Choose the central argument", "Decide what the essay is fundamentally trying to communicate.", "What is the most interesting idea here? What evidence or experience supports it? What are you deliberately not covering?", "decision"),
      s("Develop the structure", "Give the argument an order the reader can follow.", "What does the reader need to understand first? Where does the turn happen?", "structure"),
      s("Open questions", "Name what's missing before it stalls the draft.", "What do you still need to find out, verify, or remember?", "notes"),
      s("Draft", "Write it through, without polishing.", "What's the one paragraph you're most eager to write?", "draft"),
      s("Review and refine", "Read it as the reader would.", "Where does it drag? Where does the argument wobble? What can go?", "draft"),
    ],
  },
  {
    id: "tpl-memoir",
    name: "Memoir chapter",
    description: "Find the moment, then what it meant.",
    builtIn: true,
    createdAt: 0,
    steps: [
      s("Find the moment", "Locate the scene this chapter turns on.", "What's the image you can't stop seeing? Where were you, exactly?", "notes"),
      s("Then and now", "Separate what you knew then from what you understand now.", "What did this mean to you at the time? What does it mean today?", "none"),
      s("Choose the frame", "Decide how the chapter is told.", "Whose understanding leads — the younger you or the present you? Where does the chapter begin?", "decision"),
      s("Lay out the scenes", "Put the scenes in an order that earns the ending.", "Which scene comes first? Which one holds the turn?", "structure"),
      s("People and places", "Get the details right for the people who appear.", "Who appears here? What do they want? What do you owe them?", "references"),
      s("Draft", "Write the chapter through.", "Start in the middle of the moment.", "draft"),
      s("Revise", "Make it true and make it move.", "Where are you explaining instead of showing? What would you cut if you had to?", "draft"),
    ],
  },
  {
    id: "tpl-story",
    name: "Short story",
    description: "Premise, people, point of view, scenes.",
    builtIn: true,
    createdAt: 0,
    steps: [
      s("Premise", "State the situation in a sentence or two.", "Who wants what, and what's in the way?", "ideas"),
      s("Characters", "Know your people before you move them.", "What does each character want? What are they afraid of?", "references"),
      s("Point of view and tense", "Choose how the story is told.", "Whose eyes? How close? Past or present?", "decision"),
      s("Scene list", "Arrange the scenes into a shape.", "What has to happen? What's the last image?", "structure"),
      s("Draft", "Write it through.", "Which scene are you most excited to write?", "draft"),
      s("Revise", "Tighten, deepen, sharpen.", "Where does tension drop? What does the ending owe the beginning?", "draft"),
    ],
  },
  {
    id: "tpl-book",
    name: "Book",
    description: "A promise to the reader and a long arc that keeps it.",
    builtIn: true,
    createdAt: 0,
    steps: [
      s("The promise", "Say what this book offers its reader.", "Why would someone pick this up? What will they have when they finish?", "none"),
      s("Reader", "Describe the reader you're writing for.", "Who are they? What are they looking for that they haven't found?", "none"),
      s("Choose the spine", "Decide the organizing idea that holds the book together.", "Is this chronological, thematic, argumentative? What's the throughline?", "decision"),
      s("Chapter map", "Lay out parts and chapters.", "What does each chapter do for the whole?", "structure"),
      s("Research gaps", "List what you need to learn or confirm.", "Which claims need sources? Who should you talk to?", "references"),
      s("Draft chapters", "Write chapter by chapter, in any order.", "Which chapter would you write first if no one were watching?", "draft"),
      s("Revise the whole", "Read it as one thing.", "Does every chapter earn its place? Where does the promise slip?", "draft"),
    ],
  },
  {
    id: "tpl-exploration",
    name: "Exploration",
    description: "A light way to see whether something is worth pursuing.",
    builtIn: true,
    createdAt: 0,
    steps: [
      s("What's pulling at you", "Name the itch.", "What made you want to think about this today?", "notes"),
      s("Collect", "Gather fragments without judging them.", "What else connects to this? Talk it through or jot it down.", "ideas"),
      s("Find the thread", "Choose what matters most here.", "Of everything you've collected, what's the one idea that would still interest you in a month?", "decision"),
      s("Next move", "Decide what this becomes, if anything.", "Is this an essay, a chapter, a story — or something to set aside for now?", "none"),
    ],
  },
];

export function builtInProcess(id: string | null | undefined): ProcessTemplate | undefined {
  return BUILT_IN_PROCESSES.find((p) => p.id === id);
}

export const CARD_TYPES: { type: CardType; label: string; hint: string }[] = [
  { type: "idea", label: "Idea", hint: "A thought worth keeping" },
  { type: "scene", label: "Scene / section", hint: "A unit of the finished work" },
  { type: "question", label: "Question", hint: "Something unresolved" },
  { type: "decision", label: "Decision", hint: "A choice and its reasons" },
  { type: "character", label: "Character / entity", hint: "A person, place, or thing" },
  { type: "research", label: "Research", hint: "A source, fact, or reference" },
  { type: "note", label: "Note", hint: "Anything else" },
];

export const REFERENCE_KINDS: { kind: ReferenceKind; label: string; plural: string; fields: string[] }[] = [
  { kind: "character", label: "Character", plural: "Characters", fields: ["Wants", "Fears", "Relationships"] },
  { kind: "place", label: "Place", plural: "Places", fields: ["When", "Atmosphere"] },
  { kind: "research", label: "Research", plural: "Research", fields: ["Finding", "Confidence"] },
  { kind: "source", label: "Source", plural: "Sources", fields: ["Author", "Link", "Key point"] },
  { kind: "theme", label: "Theme", plural: "Themes", fields: [] },
  { kind: "argument", label: "Argument", plural: "Arguments", fields: ["Claim", "Evidence", "Strongest objection"] },
  { kind: "question", label: "Open question", plural: "Open questions", fields: ["Why it matters"] },
  { kind: "other", label: "Other", plural: "Other", fields: [] },
];

export function referenceKindInfo(kind: ReferenceKind) {
  return REFERENCE_KINDS.find((k) => k.kind === kind) ?? REFERENCE_KINDS[REFERENCE_KINDS.length - 1];
}
