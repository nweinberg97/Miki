import { test } from "node:test";
import assert from "node:assert/strict";
import { moveInColumns, orderStructure, structureBlocks } from "../../src/features/board/structureDoc.ts";
import { nextQuestion, suggestionsFor, type ProjectSnapshot } from "../../src/features/project/suggestions.ts";
import { splitFragments } from "../../src/features/capture/derive.ts";
import { parseTranscriptFile, timeForExcerpt } from "../../src/transcription/engines.ts";
import { findFreeSpot, CARD_W } from "../../src/data/repo.ts";
import { deriveTitle, relativeTime, slugify, wordCount } from "../../src/lib/util.ts";
import type { Card, Note, Section, Project } from "../../src/data/types.ts";

const t = 1_700_000_000_000;
const section = (id: string, order: number): Section => ({ id, projectId: "p", boardId: "b", title: id.toUpperCase(), x: 0, y: 0, w: 0, h: 0, collapsed: false, order, createdAt: t, updatedAt: t });
const card = (id: string, sectionId: string | null, order: number, extra: Partial<Card> = {}): Card => ({
  id,
  projectId: "p",
  boardId: "b",
  sectionId,
  title: id,
  body: "",
  type: "scene",
  x: 0,
  y: 0,
  order,
  createdAt: t,
  updatedAt: t,
  ...extra,
});

test("structure is ordered by section order, then card order, with unplaced cards last", () => {
  const cols = orderStructure([section("b", 1), section("a", 0)], [card("2", "a", 1), card("1", "a", 0), card("x", null, 0), card("3", "b", 0), card("ghost", "missing", 0)]);
  assert.deepEqual(
    cols.map((c) => [c.section?.id ?? null, c.cards.map((x) => x.id)]),
    [
      ["a", ["1", "2"]],
      ["b", ["3"]],
      [null, ["x", "ghost"]],
    ],
  );
  const blocks = structureBlocks(cols, { includeNotes: true });
  assert.deepEqual(blocks[0], { kind: "h", level: 2, text: "A" });
});

test("moving cards within and between columns", () => {
  const cols = orderStructure([section("a", 0), section("b", 1)], [card("1", "a", 0), card("2", "a", 1), card("3", "a", 2), card("4", "b", 0)]);
  // Down one place in the same column (insert before index 2).
  assert.deepEqual(moveInColumns(cols, "1", "a", 2), [{ sectionId: "a", cardIds: ["2", "1", "3"] }]);
  // Up one place.
  assert.deepEqual(moveInColumns(cols, "3", "a", 1), [{ sectionId: "a", cardIds: ["1", "3", "2"] }]);
  // To the end of another column.
  assert.deepEqual(moveInColumns(cols, "2", "b", 1), [
    { sectionId: "a", cardIds: ["1", "3"] },
    { sectionId: "b", cardIds: ["4", "2"] },
  ]);
  assert.deepEqual(moveInColumns(cols, "missing", "b", 0), []);
});

test("new cards land in free spots, inside a section when given", () => {
  const s = { x: 100, y: 100, w: 400, h: 600 };
  const a = findFreeSpot([], s);
  assert.deepEqual(a, { x: 120, y: 156 });
  const b = findFreeSpot([a], s);
  assert.ok(b.x !== a.x || b.y !== a.y);
  assert.ok(b.x + CARD_W <= s.x + s.w + 20);
});

test("fragments split on paragraphs, or on sentences for a single paragraph", () => {
  assert.deepEqual(splitFragments("One idea.\n\nAnother idea."), ["One idea.", "Another idea."]);
  const sentences = splitFragments("This is the first fairly long sentence that stands alone well. Short one. And here is a third sentence that is long enough to stand.");
  assert.equal(sentences.length, 2);
  assert.match(sentences[0], /^This is the first/);
  assert.deepEqual(splitFragments(""), []);
});

test("WebVTT and SRT transcripts become text with timestamps", () => {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello there.\n\n00:00:02.600 --> 00:00:04.000\n<v Me>General thoughts.\n\n00:00:09.000 --> 00:00:10.000\nAfter a pause.";
  const r = parseTranscriptFile(vtt, "talk.vtt");
  assert.equal(r.text, "Hello there. General thoughts.\n\nAfter a pause.");
  assert.equal(r.segments.length, 3);
  assert.equal(r.segments[2].start, 9);
  const srt = "1\n00:00:01,000 --> 00:00:02,000\nFirst line\n\n2\n00:00:02,100 --> 00:00:03,000\nSecond line\n";
  assert.equal(parseTranscriptFile(srt, "x.srt").text, "First line Second line");
  assert.deepEqual(parseTranscriptFile("plain words\n", "notes.txt"), { text: "plain words", segments: [] });
  assert.equal(timeForExcerpt("Hello there. General thoughts.", r.segments, "General thoughts."), 2.6);
  assert.equal(timeForExcerpt("x", [], "x"), undefined);
});

test("Miki asks: rule-based, one part at a time, and quiet when nothing is needed", () => {
  const project: Project = { id: "p", title: "P", description: "", type: "essay", purpose: "", audience: "", thread: "", isSample: false, archived: false, createdAt: t, updatedAt: t, lastOpenedAt: t };
  const empty: ProjectSnapshot = { project, docs: [], notes: [], recordings: [], transcripts: [], parts: [], trunkCards: [], decisions: [], refs: [] };
  // A new project is asked about its roots first, and invited to start leafing.
  assert.deepEqual(
    suggestionsFor(empty, t).map((s) => s.id),
    ["roots-purpose", "leaves-first"],
  );
  assert.equal(nextQuestion(empty, "trunk", [], t), undefined);

  const leaf = (id: string, extra: Partial<Note> = {}): Note => ({ id, projectId: "p", title: "", body: id, kind: "note", createdAt: t, updatedAt: t, ...extra });
  const rooted = { ...project, purpose: "To persuade", audience: "Friends" };
  const growing: ProjectSnapshot = { ...empty, project: rooted, notes: ["a", "b", "c", "d", "e"].map((id) => leaf(id)).concat(leaf("f", { fallen: true })) };
  const ids = suggestionsFor(growing, t).map((s) => s.id);
  assert.ok(ids.includes("roots-thread"));
  assert.ok(ids.includes("leaves-discern"));
  assert.ok(ids.includes("trunk-empty"));
  assert.match(suggestionsFor(growing, t).find((s) => s.id === "leaves-discern")!.text, /5 leaves/); // fallen leaves don't count

  const trunk: ProjectSnapshot = {
    ...growing,
    project: { ...rooted, thread: "The thread" },
    trunkCards: [card("s1", null, 0, { source: { type: "note", id: "a" } }), card("s2", null, 1), card("s3", null, 2)],
    decisions: [{ id: "d", projectId: "p", question: "Which way?", options: [], chosenOptionId: null, rationale: "", tradeoffs: "", next: "", status: "open", createdAt: t - 3 * 86400000, updatedAt: t }],
  };
  const trunkIds = suggestionsFor(trunk, t).map((s) => s.id);
  assert.ok(trunkIds.includes("trunk-draft"));
  assert.ok(trunkIds.includes("trunk-open:d"));
  assert.ok(!trunkIds.includes("trunk-empty"));
  // Dismissing one shows the next, and a real draft quiets the draft nudge.
  assert.equal(nextQuestion(trunk, "trunk", [], t)?.id, "trunk-draft");
  assert.equal(nextQuestion(trunk, "trunk", ["trunk-draft"], t)?.id, "trunk-open:d");
  assert.ok(!suggestionsFor({ ...trunk, docs: [{ wordCount: 400 } as never] }, t).some((s) => s.id === "trunk-draft"));
});

test("text utilities", () => {
  assert.equal(wordCount("It’s a well-made, two-part idea."), 5);
  assert.equal(wordCount("  "), 0);
  assert.equal(deriveTitle("# A heading\nmore"), "A heading");
  assert.equal(slugify("The Case for Slowing Down!"), "the-case-for-slowing-down");
  assert.equal(slugify("???"), "untitled");
  assert.equal(relativeTime(t - 30_000, t), "just now");
  assert.equal(relativeTime(t - 2 * 3600_000, t), "2 hr ago");
});
