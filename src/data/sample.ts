// Sample projects for first-run exploration. They are clearly labelled as samples in the UI
// (project.isSample) and can be deleted like any other project. Nothing here pretends to be AI output;
// the "transcript" is labelled as sample text, not a real recording.
import { buildDoc, docToPlainText } from "../editor/serialize";
import { wordCount } from "../lib/util";
import {
  addLink,
  createCard,
  createDecision,
  createDocument,
  createNote,
  createProject,
  createReference,
  createTranscript,
  updateDecision,
  updateProject,
  updateReference,
  updateNote,
} from "./repo";
import { db } from "./db";
import type { Section } from "./types";

export async function createSampleEssay(): Promise<string> {
  const { project, structureBoard } = await createProject({
    title: "The Case for Slowing Down",
    type: "essay",
    purpose: "To give busy readers permission to read slower — and show them why it works.",
    description: "Around 2,000 words, for my newsletter.",
    isSample: true,
  });
  await updateProject(project.id, { audience: "Newsletter readers who feel guilty about the pile of books by their bed." });
  const sections = (await db.byIndex("sections", "projectId", project.id)) as Section[];
  const col = (t: string) => sections.find((s) => s.boardId === structureBoard.id && s.title === t)!;

  const transcriptText =
    "So the thing I keep coming back to is that I read faster than ever and remember less than ever. Like, I finished four books last month and I could not tell you the argument of any of them.\n\nAnd I think it's not a discipline problem. It's that everything around reading is built for throughput. The apps count pages. The newsletters tell you how many minutes.\n\nMaybe the essay is about friction. Good friction. The kind that makes you stay with something long enough for it to change you.";
  const transcript = await createTranscript({
    projectId: project.id,
    title: "Walking thoughts on reading (sample text)",
    text: transcriptText,
    engine: "Sample text — not a real recording",
  });

  await createNote({
    projectId: project.id,
    title: "Throughput vs. understanding",
    body: "I read faster than ever and remember less than ever.",
    kind: "fragment",
    source: { type: "transcript", id: transcript.id, excerpt: "I read faster than ever and remember less than ever.", start: 47, end: 99 },
  });
  await createNote({ projectId: project.id, title: "", body: "Ask: is slowness a luxury? Who gets to be slow?", kind: "question" });
  await createNote({ projectId: project.id, title: "Image", body: "My grandmother shelling peas on the porch — the only time she ever sat still.", kind: "idea" });

  // Leaves: everything captured, including one the writer let fall.
  const ideas = [
    { t: "Good friction", b: "The kind that makes you stay with something long enough for it to change you.", kind: "idea" as const },
    { t: "Speed as a default setting", b: "Apps count pages; newsletters tell you the minutes. The design assumes faster is better.", kind: "idea" as const },
    { t: "Memory needs time", b: "Look for research on spacing and consolidation.", kind: "note" as const },
    { t: "Productivity guilt", b: "Too broad. Probably a different essay.", kind: "idea" as const, fallen: true },
  ];
  const leaves = [];
  for (const i of ideas) {
    const n = await createNote({ projectId: project.id, title: i.t, body: i.b, kind: i.kind });
    if (i.fallen) await updateNote(n.id, { fallen: true });
    leaves.push(n);
  }

  const outline: [string, string, string][] = [
    ["Opening", "Four books, no arguments", "Open on the confession: I finished four books and can't recall one argument."],
    ["The argument", "Our tools optimize for throughput", "Counters, streaks, minutes-to-read. The design assumes speed is the goal."],
    ["The argument", "Understanding needs friction", "Memory and meaning need time to settle."],
    ["Complication", "Who gets to be slow?", "Acknowledge that slowness can be a privilege — and why small slowness is still available."],
    ["Close", "The porch", "Return to the image of my grandmother shelling peas."],
  ];
  for (const [section, title, body] of outline) {
    // "Understanding needs friction" was carried from the "Good friction" leaf.
    const source = title === "Understanding needs friction" ? { type: "note" as const, id: leaves[0].id, excerpt: leaves[0].body } : undefined;
    await createCard({ projectId: project.id, boardId: structureBoard.id, sectionId: col(section).id, title, body, type: "idea", source });
  }

  const decision = await createDecision(project.id, { question: "What is this essay fundamentally arguing?" });
  const [optA, optB] = decision.options;
  await updateDecision(decision.id, {
    options: [
      { ...optA, text: "Slowness is a moral good", note: "Feels preachy." },
      { ...optB, text: "Our tools are designed for throughput, and understanding needs friction", note: "Specific, arguable, personal." },
    ],
    chosenOptionId: optB.id,
    rationale: "It's the version I can support with my own experience and with research, and it points at something readers can change.",
    tradeoffs: "Leaves out the broader productivity-culture critique. That can be its own piece.",
    next: "Outline around throughput vs. friction.",
    status: "decided",
  });
  await addLink(project.id, { type: "decision", id: decision.id }, { type: "note", id: leaves[0].id }, "related");
  await addLink(project.id, { type: "note", id: leaves[1].id }, { type: "note", id: leaves[0].id }, "supports");
  await updateProject(project.id, {
    thread: "Our tools are built for throughput, but understanding needs friction.",
    threadSource: { type: "decision", id: decision.id },
  });

  await createSource(project.id, "Make It Stick (Brown, Roediger, McDaniel)", "Effortful retrieval and spacing improve long-term retention.");
  const doc = buildDoc([
    {
      kind: "p",
      text: "Last month I finished four books. I could not tell you the argument of a single one. I don’t think that’s a failure of discipline. I think it’s a design problem.",
    },
    {
      kind: "p",
      text: "Almost every tool I read with is built for throughput. The app counts pages. The newsletter tells me it’s a seven-minute read, as if the point were to be done.",
    },
    { kind: "quote", text: "Understanding needs friction — the kind that makes you stay with something long enough for it to change you." },
  ]);
  await createDocument(project.id, { title: "Draft", content: doc, plainText: docToPlainText(doc), wordCount: wordCount(docToPlainText(doc)) }).then(async (d) => {
    // The template created an empty "Draft"; keep the sample's draft first and remove the empty one.
    const docs = await db.byIndex("documents", "projectId", project.id);
    const empty = docs.find((x) => x.id !== d.id && x.wordCount === 0);
    if (empty) await db.delete("documents", empty.id);
    await db.put("documents", { ...d, order: 0 });
  });
  return project.id;
}

async function createSource(projectId: string, title: string, point: string) {
  const ref = await createReference({ projectId, title, kind: "source", fieldLabels: ["Author", "Link", "Key point"] });
  await updateReference(ref.id, { summary: point, fields: ref.fields.map((f) => (f.label === "Key point" ? { ...f, value: point } : f)) });
}

export async function createSampleStory(): Promise<string> {
  const { project, structureBoard } = await createProject({
    title: "Night Ferry",
    type: "story",
    purpose: "To write about grief that hasn't found words yet — through two strangers who never quite say it.",
    description: "A short story, under 5,000 words.",
    isSample: true,
  });
  await updateProject(project.id, { audience: "Readers of quiet literary fiction.", thread: "Some things are carried, not said." });
  const sections = await db.byIndex("sections", "projectId", project.id);
  const col = (t: string) => sections.find((s) => s.boardId === structureBoard.id && s.title === t)!;
  const mara = await createReference({ projectId: project.id, title: "Mara", kind: "character", fieldLabels: ["Wants", "Fears", "Relationships"] });
  await updateReference(mara.id, {
    summary: "Ferry deckhand, 34. Has worked the night crossing for nine years.",
    fields: mara.fields.map((f) =>
      f.label === "Wants" ? { ...f, value: "To leave the island, without admitting she wants to." } : f.label === "Fears" ? { ...f, value: "That she's already stayed too long." } : f,
    ),
  });
  const eli = await createReference({ projectId: project.id, title: "Eli", kind: "character", fieldLabels: ["Wants", "Fears", "Relationships"] });
  await updateReference(eli.id, { summary: "A passenger carrying an urn he hasn't told anyone about." });
  const ferry = await createReference({ projectId: project.id, title: "The ferry", kind: "place", fieldLabels: ["When", "Atmosphere"] });
  await updateReference(ferry.id, { summary: "Forty minutes of dark water. Fluorescent cabin, cold deck." });

  const scenes: [string, string, string, string[]][] = [
    ["Beginning", "Last call", "Mara ropes off the ramp; Eli runs for it.", [mara.id, eli.id]],
    ["Beginning", "The cabin", "Eli won't put the bag down.", [eli.id]],
    ["Middle", "On deck", "Mara finds him at the rail, too close to the edge.", [mara.id, eli.id]],
    ["Middle", "The urn", "He tells her what's in the bag.", [eli.id]],
    ["End", "Landing", "She lowers the ramp. Neither of them moves.", [mara.id, eli.id]],
  ];
  for (const [section, title, body, refs] of scenes) {
    const c = await createCard({ projectId: project.id, boardId: structureBoard.id, sectionId: col(section).id, title, body, type: "scene" });
    for (const r of refs) await addLink(project.id, { type: "card", id: c.id }, { type: "reference", id: r }, "features");
  }
  await createNote({ projectId: project.id, title: "What if Eli never says it aloud?", body: "The urn could stay unexplained.", kind: "question" });
  await createNote({ projectId: project.id, title: "The sound of the engine changing", body: "Use it to mark the middle of the crossing.", kind: "idea" });
  await createNote({ projectId: project.id, title: "", body: "The fluorescent hum in the cabin, like a held breath.", kind: "note" });
  return project.id;
}
