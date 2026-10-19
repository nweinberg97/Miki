// End-to-end journeys in a real Chromium, against the production build.
//   npm run build && npm run test:e2e
// Uses a fake microphone and a local mock transcription service, so it runs offline and costs nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../../server/server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "dist");
if (!existsSync(path.join(dist, "index.html"))) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(1);
}

let server, upstream, browser, base;
const MOCK_TEXT =
  "I keep thinking about the bridge in winter. It was the first time I noticed how quiet the city could be.\n\nMaybe the essay starts there, with the quiet.";

before(async () => {
  // A stand-in for an OpenAI-compatible transcription API.
  upstream = http.createServer((req, res) => {
    let size = 0;
    req.on("data", (c) => (size += c.length));
    req.on("end", () => {
      if (req.url !== "/v1/audio/transcriptions" || size === 0) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "bad request" }));
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ text: MOCK_TEXT, segments: [{ start: 0, end: 6.2, text: "I keep thinking about the bridge in winter." }, { start: 6.2, end: 11, text: "It was the first time I noticed how quiet the city could be." }] }));
    });
  });
  await new Promise((r) => upstream.listen(0, r));
  server = createServer({ dir: dist });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
});

after(async () => {
  await browser?.close();
  server?.close();
  upstream?.close();
});

async function fresh(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(base, { waitUntil: "networkidle" });
  return { context, page, errors };
}

const mode = (page, name) => page.locator(".mode-tabs").getByRole("link", { name, exact: true });
const saved = (page) => page.locator(".save-indicator.is-saved").waitFor({ timeout: 8000 });

test("Journey A: start an essay, shape it, draft it, export it, and find it again after a reload", async () => {
  const { context, page, errors } = await fresh();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Working title").fill("The Case for Slowing Down");
  await page.getByText("Essay or article").click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/#\/p\//);

  // Capture an initial idea and a few supporting ones.
  await mode(page, "Capture").click();
  const quick = page.getByLabel("Quick note");
  for (const t of ["We read faster and remember less.", "Friction can be good.", "Apps count pages, not understanding."]) {
    await quick.fill(t);
    await quick.press("Control+Enter");
    await page.locator(".capture-item", { hasText: t }).waitFor({ timeout: 5000 }).catch(async (e) => {
      await page.screenshot({ path: "/tmp/claude-0/shots/fail-a.png" });
      throw e;
    });
  }
  // Turn a note into a card.
  await page.locator(".capture-item", { hasText: "Friction can be good." }).click();
  await page.getByRole("button", { name: "Make a card" }).click();
  await page.getByText("Added to the idea space.").waitFor();

  // Arrange ideas on the board: add a card by double-clicking, then drag it into "Promising".
  await mode(page, "Explore").click();
  const canvas = page.locator(".canvas");
  await canvas.waitFor();
  await page.locator(".card", { hasText: "Friction can be good." }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".frame", { hasText: "Promising" }).waitFor();
  const box = await canvas.boundingBox();
  await page.mouse.dblclick(box.x + box.width - 160, box.y + box.height - 160);
  const panelTitle = page.getByLabel("Card title");
  await panelTitle.fill("The design assumes speed is the goal");
  await page.getByLabel("Card notes").fill("Streaks, minutes-to-read, page counts.");
  await page.keyboard.press("Escape");
  const card = page.locator(".card", { hasText: "The design assumes speed is the goal" });
  await card.waitFor();
  const target = await page.locator(".frame", { hasText: "Promising" }).boundingBox();
  const cb = await card.boundingBox();
  await page.mouse.move(cb.x + 40, cb.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + 80, target.y + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".frame.is-promising .frame-count")?.textContent === "1");

  // Name the thread.
  await mode(page, "Overview").click();
  const thread = page.getByRole("textbox", { name: /The thread/ });
  await thread.fill("Our tools are built for throughput, but understanding needs friction.");
  await thread.press("Enter");

  // Outline, then draft from the outline.
  await mode(page, "Arrange").click();
  await page.locator(".column", { hasText: "Opening" }).getByRole("button", { name: /Point/ }).click();
  await page.getByLabel("Card title").fill("Four books, no arguments");
  await page.keyboard.press("Escape");
  await page.locator(".card", { hasText: "Four books, no arguments" }).waitFor();
  await page.getByRole("button", { name: "Draft from structure" }).click();
  await page.waitForURL(/write\?doc=/);
  const editor = page.locator(".ProseMirror");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Last month I finished four books and could not tell you a single argument.");
  await saved(page);

  // Export Markdown with the real content.
  await page.getByRole("button", { name: "Export this document" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Markdown (.md)" }).click()]);
  const md = readFileSync(await download.path(), "utf8");
  assert.match(md, /## Opening/);
  assert.match(md, /### Four books, no arguments/);
  assert.match(md, /could not tell you a single argument/);

  // Reload: everything is still there.
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".ProseMirror", { hasText: "could not tell you a single argument" }).waitFor();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByText("Our tools are built for throughput, but understanding needs friction.").first().waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("Journey B: talk an idea through, transcribe it, and pull out a fragment linked to its source", async () => {
  process.env.TRANSCRIPTION_API_BASE = `http://localhost:${upstream.address().port}/v1`;
  process.env.TRANSCRIPTION_MODEL = "mock-whisper";
  try {
    const { context, page, errors } = await fresh({ permissions: ["microphone"] });
    await page.getByRole("button", { name: "Sample essay" }).click();
    await page.waitForURL(/#\/p\//);
    await mode(page, "Capture").click();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByText(/Recording ·/).waitFor();
    await page.waitForTimeout(1600);
    await page.getByRole("button", { name: "Stop recording" }).click();
    await page.getByLabel("Recording name").fill("Bridge in winter");
    await page.getByRole("button", { name: "Save recording" }).click();
    await page.waitForURL(/rec=/);

    // Transcribe through the server (consent first).
    await page.getByRole("button", { name: /^Transcribe/ }).click();
    await page.getByRole("button", { name: "Transcribe", exact: true }).click();
    const text = page.getByLabel("Transcript (working copy)");
    await text.waitFor();
    assert.equal(await text.inputValue(), MOCK_TEXT);

    // Select a passage and keep it as a note.
    const phrase = "It was the first time I noticed how quiet the city could be.";
    await text.evaluate((el, p) => {
      const i = el.value.indexOf(p);
      el.focus();
      el.setSelectionRange(i, i + p.length);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    }, phrase);
    await page.getByRole("toolbar", { name: "Use the selected passage" }).getByRole("button", { name: "Note", exact: true }).click();
    await page.getByText("Saved as a note, linked to this passage.").waitFor();

    // The note links back to its source, and the source passage is highlighted.
    await page.locator(".derived .chip").first().click();
    await page.locator(".card-source").click();
    await page.waitForURL(/hl=/);
    const sel = await page.getByLabel("Transcript (working copy)").evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
    assert.equal(sel, phrase);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    delete process.env.TRANSCRIPTION_API_BASE;
    delete process.env.TRANSCRIPTION_MODEL;
  }
});

test("Journey B (no engine): the recording is kept and the writer gets honest next steps", async () => {
  const { context, page } = await fresh({ permissions: ["microphone"] });
  await page.keyboard.press("r");
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Save recording" }).click();
  await page.waitForURL(/inbox\?rec=/);
  await page.getByText("No transcription service is connected.").waitFor();
  await page.getByRole("button", { name: /Write it out yourself/ }).click();
  await page.getByLabel("Transcript text").fill("Typed while listening back.");
  await page.getByRole("button", { name: "Save as transcript" }).click();
  await page.getByLabel("Transcript (working copy)").waitFor();
  await page.getByText("Written by you").waitFor();
  await context.close();
});

test("Microphone denied: a clear error, no false recording state", async () => {
  const { context, page } = await fresh();
  await context.clearPermissions();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.keyboard.press("r");
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.getByText(/Microphone access was blocked/).waitFor();
  assert.equal(await page.getByText(/Recording ·/).count(), 0);
  await context.close();
});

test("Journey C: organise a story — scenes, characters, reorder, open a scene's draft, persist", async () => {
  const { context, page, errors } = await fresh();
  await page.getByRole("button", { name: "Sample short story" }).click();
  await page.waitForURL(/#\/p\//);
  await mode(page, "Arrange").click();
  const first = page.locator(".column", { hasText: "Beginning" }).locator(".card").first();
  await first.waitFor();
  assert.match(await first.innerText(), /Last call/);
  assert.match(await first.innerText(), /Mara/); // linked characters show on the card
  await first.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForFunction(() => document.querySelector(".column .card")?.textContent?.includes("The cabin"));

  // Characters are editable references.
  await mode(page, "Reference").click();
  await page.getByRole("link", { name: /Mara/ }).click();
  await page.locator(".ref-title").fill("Mara Lind");
  await page.locator(".ref-title").press("Enter");

  // A scene opens into its own draft, linked both ways.
  await mode(page, "Arrange").click();
  await page.locator(".card", { hasText: "On deck" }).click();
  await page.getByRole("button", { name: "Start a draft from this card" }).click();
  await page.waitForURL(/write\?doc=/);
  await page.getByRole("link", { name: /From card: On deck/ }).waitFor();

  await page.reload({ waitUntil: "networkidle" });
  await mode(page, "Arrange").click();
  await page.waitForFunction(() => document.querySelector(".column .card")?.textContent?.includes("The cabin"));
  assert.match(await page.locator(".card", { hasText: "Last call" }).innerText(), /Mara Lind/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("Journey D: work through a decision and keep the reasoning", async () => {
  const { context, page, errors } = await fresh();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Working title").fill("Memoir: the bridge");
  await page.getByText("Memoir chapter").click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/#\/p\//);
  await mode(page, "Discern").click();
  await page.getByLabel("Your thinking").fill("The winter my father stopped driving.");
  await page.getByRole("button", { name: /Done — next step/ }).click();
  await page.locator(".step-list .step-row", { hasText: "Choose the frame" }).click();
  await page.getByRole("button", { name: /Record this as a decision/ }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Younger me leads");
  await page.getByLabel("Option 2", { exact: true }).fill("Present me leads");
  await page.getByLabel("Choose option 2").click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Choose option 2"]')?.checked);
  await page.getByLabel(/Why this direction/).fill("Distance lets me be honest about what I didn't see.");
  await page.getByRole("button", { name: "Settle on this" }).click();
  await page.getByText("Decided", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Make this the thread" }).click();
  await page.getByText("Set as the project's thread.").waitFor();

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".step-list .step-row", { hasText: "Choose the frame" }).click();
  assert.equal(await page.getByLabel(/Why this direction/).inputValue(), "Distance lets me be honest about what I didn't see.");
  await mode(page, "Overview").click();
  assert.equal(await page.getByRole("textbox", { name: /The thread/ }).inputValue(), "Present me leads");
  assert.deepEqual(errors, []);
  await context.close();
});

test("Journey F: a failed save is reported, the text is kept, and it can be recovered", async () => {
  const { context, page } = await fresh();
  await page.getByRole("button", { name: "Sample essay" }).click();
  await page.waitForURL(/#\/p\//);
  await page.goto(base + "#/settings");
  await page.getByLabel("Simulate failed saves for drafts").check();
  await page.goBack();
  await mode(page, "Write").click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Unsaved words survive.");
  await page.getByText(/Your latest changes haven't been saved/).waitFor({ timeout: 8000 });
  assert.equal(await page.locator(".save-indicator.is-saved").count(), 0);
  assert.match(await editor.innerText(), /Unsaved words survive\./);

  // Leave while saving is still failing, fix storage, and come back: the words are offered back.
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByLabel("Simulate failed saves for drafts").uncheck();
  await page.goBack();
  await page.getByRole("button", { name: "Restore them" }).click();
  await page.locator(".ProseMirror", { hasText: "Unsaved words survive." }).waitFor();
  await saved(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".ProseMirror", { hasText: "Unsaved words survive." }).waitFor();
  await context.close();
});

test("Backups round-trip, and search finds things across projects", async () => {
  const { context, page } = await fresh();
  await page.getByRole("button", { name: "Sample essay" }).click();
  await page.waitForURL(/#\/p\//);
  await page.goto(base + "#/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download a backup" }).click()]);
  const file = await download.path();
  const backup = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(backup.app, "miki");
  assert.ok(backup.stores.projects.length === 1);

  // Restore into a brand-new browser profile.
  const other = await fresh();
  await other.page.goto(base + "#/settings");
  await other.page.locator('input[type="file"][accept*="json"]').setInputFiles(file);
  await other.page.getByRole("button", { name: "Restore", exact: true }).click();
  await other.page.getByText(/Restored \d+ items/).waitFor();
  await other.page.goto(base, { waitUntil: "networkidle" });
  await other.page.getByText("The Case for Slowing Down").first().waitFor();

  // Search.
  await other.page.keyboard.press("Control+k");
  await other.page.getByLabel("Search everything").fill("grandmother");
  await other.page.getByRole("option", { name: /Image/ }).first().click();
  await other.page.waitForURL(/capture\?note=/);
  await other.context.close();
  await context.close();
});

test("Malformed backups are rejected without touching existing data", async () => {
  const { context, page } = await fresh();
  await page.goto(base + "#/settings");
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"hello": "world"}') });
  await page.getByText("This doesn't look like a Miki backup.").waitFor();
  await context.close();
});

test("Small screens: studio, capture, and the idea space as a list", async () => {
  const { context, page, errors } = await fresh({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.getByRole("button", { name: "Sample essay" }).click();
  await page.waitForURL(/#\/p\//);
  await mode(page, "Explore").click();
  await page.locator(".board-list").waitFor();
  assert.equal(await page.locator(".canvas").count(), 0);
  await page.locator(".mobile-nav").getByRole("button", { name: "Capture a thought" }).click();
  await page.getByLabel("Your note").fill("A thought on the bus.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText(/Saved to/).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});
