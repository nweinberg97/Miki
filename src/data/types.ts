// Core entities. Every record has a stable string id and timestamps (ms since epoch).
// Content that can belong to "no project yet" uses INBOX as its projectId.

export const INBOX = "inbox";

export type ProjectType = "essay" | "memoir" | "story" | "book" | "exploration" | "blank";

export type Mode = "overview" | "capture" | "explore" | "arrange" | "write" | "discern" | "reference";

export interface Project {
  id: string;
  title: string;
  description: string;
  type: ProjectType;
  /** The central idea, argument, or question — "the thread". */
  thread: string;
  threadSource?: EntityRef;
  isSample: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  lastLocation?: { mode: Mode; entityId?: string };
}

export type EntityType =
  | "project"
  | "document"
  | "note"
  | "recording"
  | "transcript"
  | "card"
  | "section"
  | "reference"
  | "decision"
  | "step";

export interface EntityRef {
  type: EntityType;
  id: string;
}

/** Where a piece of derived material came from (e.g. a passage of a transcript). */
export interface SourceRef extends EntityRef {
  excerpt?: string;
  start?: number;
  end?: number;
  /** Seconds into the recording, when known. */
  time?: number;
}

export type DocStatus = "draft" | "revising" | "done";

/** ProseMirror JSON. */
export type DocContent = { type: "doc"; content?: unknown[] };

export interface Document {
  id: string;
  projectId: string;
  title: string;
  content: DocContent;
  plainText: string;
  wordCount: number;
  status: DocStatus;
  order: number;
  sourceCardId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Snapshot {
  id: string;
  documentId: string;
  projectId: string;
  title: string;
  content: DocContent;
  wordCount: number;
  label: string;
  createdAt: number;
}

export type NoteKind = "note" | "fragment" | "idea" | "quote" | "question";

export interface Note {
  id: string;
  projectId: string; // INBOX when unsorted
  title: string;
  body: string;
  kind: NoteKind;
  source?: SourceRef;
  createdAt: number;
  updatedAt: number;
}

export type RecordingStatus = "saved" | "transcribing" | "transcribed" | "failed";

export interface Recording {
  id: string;
  projectId: string; // INBOX when unsorted
  title: string;
  mimeType: string;
  duration: number; // seconds
  size: number; // bytes
  status: RecordingStatus;
  error?: string;
  transcriptId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AudioBlob {
  id: string; // same as recording id
  blob: Blob;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  id: string;
  projectId: string;
  recordingId?: string;
  title: string;
  /** Verbatim text as produced by the engine or import. Never modified. */
  original: string;
  /** The writer's working copy. */
  text: string;
  segments: TranscriptSegment[];
  engine: string;
  createdAt: number;
  updatedAt: number;
}

export type BoardKind = "ideas" | "structure";

export interface Board {
  id: string;
  projectId: string;
  kind: BoardKind;
  title: string;
  viewport?: { x: number; y: number; zoom: number };
  createdAt: number;
  updatedAt: number;
}

export interface Section {
  id: string;
  projectId: string;
  boardId: string;
  title: string;
  /** Spatial frame (ideas board). */
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
  /** Sequence (structure board). */
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type CardType = "idea" | "scene" | "question" | "decision" | "character" | "research" | "note";

export interface Card {
  id: string;
  projectId: string;
  boardId: string;
  sectionId: string | null;
  title: string;
  body: string;
  type: CardType;
  x: number;
  y: number;
  /** Order within its section on the structure board. */
  order: number;
  docId?: string;
  decisionId?: string;
  referenceId?: string;
  source?: SourceRef;
  createdAt: number;
  updatedAt: number;
}

export type LinkKind = "supports" | "contradicts" | "depends" | "leads" | "related" | "features";

export interface Link {
  id: string;
  projectId: string;
  from: EntityRef;
  to: EntityRef;
  kind: LinkKind;
  createdAt: number;
}

export type ReferenceKind = "character" | "place" | "research" | "source" | "theme" | "argument" | "question" | "other";

export interface Reference {
  id: string;
  projectId: string;
  title: string;
  kind: ReferenceKind;
  summary: string;
  body: string;
  /** Free-form labelled attributes, e.g. { Wants: "...", Fears: "..." } as ordered pairs. */
  fields: { id: string; label: string; value: string }[];
  createdAt: number;
  updatedAt: number;
}

export interface Process {
  id: string;
  projectId: string;
  title: string;
  templateId?: string;
  createdAt: number;
  updatedAt: number;
}

export type StepStatus = "open" | "done" | "skipped";

/** Hints that let a step surface relevant project material. */
export type StepContext = "notes" | "ideas" | "structure" | "draft" | "decision" | "references" | "none";

export interface Step {
  id: string;
  processId: string;
  projectId: string;
  title: string;
  objective: string;
  prompt: string;
  response: string;
  status: StepStatus;
  context: StepContext;
  order: number;
  decisionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DecisionOption {
  id: string;
  text: string;
  note: string;
}

export interface Decision {
  id: string;
  projectId: string;
  question: string;
  options: DecisionOption[];
  chosenOptionId: string | null;
  rationale: string;
  tradeoffs: string;
  next: string;
  status: "open" | "decided";
  decidedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateStep {
  title: string;
  objective: string;
  prompt: string;
  context: StepContext;
}

export interface ProcessTemplate {
  id: string;
  name: string;
  description: string;
  steps: TemplateStep[];
  builtIn: boolean;
  createdAt: number;
}

export interface Pref {
  key: string;
  value: unknown;
}

export interface StoreMap {
  projects: Project;
  documents: Document;
  snapshots: Snapshot;
  notes: Note;
  recordings: Recording;
  audio: AudioBlob;
  transcripts: Transcript;
  boards: Board;
  sections: Section;
  cards: Card;
  links: Link;
  references: Reference;
  processes: Process;
  steps: Step;
  decisions: Decision;
  templates: ProcessTemplate;
  prefs: Pref;
}

export type StoreName = keyof StoreMap;
