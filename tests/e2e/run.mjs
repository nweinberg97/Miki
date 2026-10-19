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

const part = (page, name) => page.locator(".part-tabs").getByRole("link", { name: new RegExp(`^${name}`) });
const view = (page, name) => page.getByRole("radio", { name, exact: true });
const saved = (page) => page.locator(".save-indicator.is-saved").waitFor({ timeout: 8000 });

test("Journey A: plant an essay, grow leaves, carry what matters onto the trunk, draft it, export it, find it after a reload", async () => {
  const { context, page, errors } = await fresh();
  // The empty grove tells the story of the three trees, then offers a way in.
  await page.getByText("Three trees. A place for your thoughts to take root.").waitFor();
  await page.getByRole("button", { name: "Plant your first tree" }).click();
  await page.getByLabel("Working title").fill("The Case for Slowing Down");
  await page.getByText("Essay or article").click();
  await page.getByLabel("Why are you writing it?").fill("To give busy readers permission to read slower.");
  await page.getByRole("button", { name: "Plant it" }).click();
  await page.waitForURL(/#\/p\/[^/]+\/leaves/);

  // Leaves: let ideas come freely.
  const quick = page.getByLabel("Add a leaf");
  for (const t of ["We read faster and remember less.", "Friction can be good.", "Apps count pages, not understanding."]) {
    await quick.fill(t);
    await quick.press("Control+Enter");
    await page.locator(".capture-item", { hasText: t }).waitFor({ timeout: 5000 });
  }
  // Discernment: carry one onto the trunk, let another fall (kept, not deleted).
  await page.locator(".capture-item", { hasText: "Friction can be good." }).click();
  await page.getByRole("button", { name: "Carry onto the trunk" }).click();
  await page.getByRole("menuitem", { name: "The argument" }).click();
  await page.getByText("Carried onto the trunk, in “The argument”.").waitFor();
  await page.locator(".capture-item", { hasText: "Friction can be good." }).getByText("on the trunk").waitFor();
  await page.locator(".capture-item", { hasText: "Apps count pages" }).click();
  await page.getByRole("button", { name: "Let it fall" }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll(".capture-item")].some((n) => n.textContent.includes("Apps count pages")));
  await view(page, "Fallen · 1").click();
  await page.locator(".capture-item", { hasText: "Apps count pages" }).waitFor();

  // The storyboard: put a leaf on it, then drag a new card into "Promising".
  await view(page, "Growing").click();
  await page.locator(".capture-item", { hasText: "We read faster" }).click();
  await page.getByRole("button", { name: "Put on the storyboard" }).click();
  await page.getByText("Put on the storyboard.").waitFor();
  await view(page, "Storyboard").click();
  const canvas = page.locator(".canvas");
  await canvas.waitFor();
  await page.locator(".card", { hasText: "We read faster" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".frame", { hasText: "Promising" }).waitFor();
  const box = await canvas.boundingBox();
  await page.mouse.dblclick(box.x + box.width - 160, box.y + box.height - 160);
  await page.getByLabel("Title", { exact: true }).fill("The design assumes speed is the goal");
  await page.getByLabel("Notes", { exact: true }).fill("Streaks, minutes-to-read, page counts.");
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

  // Roots: name the thread.
  await part(page, "Roots").click();
  await view(page, "Intention").click();
  assert.equal(await page.getByLabel("Why does this piece exist?").inputValue(), "To give busy readers permission to read slower.");
  const thread = page.getByLabel("The thread", { exact: true });
  await thread.fill("Our tools are built for throughput, but understanding needs friction.");
  await page.getByLabel("Who is it for?").click();

  // Trunk: the thread runs up it; add a piece, then grow a draft along it.
  await part(page, "Trunk").click();
  await page.locator(".trunk-thread-text").waitFor();
  assert.equal(await page.locator(".trunk-thread-text").inputValue(), "Our tools are built for throughput, but understanding needs friction.");
  await page.locator(".card", { hasText: "Friction can be good." }).waitFor();
  await page.locator(".column", { hasText: "Opening" }).getByRole("button", { name: /Point/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Four books, no arguments");
  await page.keyboard.press("Escape");
  await page.locator(".card", { hasText: "Four books, no arguments" }).waitFor();
  await page.getByRole("button", { name: "Grow a draft" }).click();
  await page.waitForURL(/view=draft/);
  const editor = page.locator(".ProseMirror");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Last month I finished four books and could not tell you a single argument.");
  await saved(page);

  // Export Markdown with the real content, in trunk order.
  await page.getByRole("button", { name: "Export this document" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Markdown (.md)" }).click()]);
  const md = readFileSync(await download.path(), "utf8");
  assert.match(md, /## Opening[\s\S]*### Four books, no arguments[\s\S]*## The argument[\s\S]*Friction can be good/);
  assert.match(md, /could not tell you a single argument/);

  // Reload: everything is still there, and the grove offers to pick up where we left off.
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".ProseMirror", { hasText: "could not tell you a single argument" }).waitFor();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".resume", { hasText: "Our tools are built for throughput" }).waitFor();
  await page.locator(".tree-link", { hasText: "The Case for Slowing Down" }).getByText(/standing/).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("Journey B: talk an idea through, transcribe it, and keep a passage as a leaf linked to its source", async () => {
  process.env.TRANSCRIPTION_API_BASE = `http://localhost:${upstream.address().port}/v1`;
  process.env.TRANSCRIPTION_MODEL = "mock-whisper";
  try {
    const { context, page, errors } = await fresh({ permissions: ["microphone"] });
    await page.getByRole("button", { name: "An essay" }).click();
    await page.waitForURL(/#\/p\//);
    await part(page, "Leaves").click();
    await page.getByRole("button", { name: "Speak", exact: true }).click();
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByText(/Recording ·/).waitFor();
    await page.waitForTimeout(1600);
    await page.getByRole("button", { name: "Stop recording" }).click();
    await page.getByLabel("Recording name").fill("Bridge in winter");
    await page.getByRole("button", { name: "Save recording" }).click();
    await page.waitForURL(/leaves\?rec=/);

    // Transcribe through the server (consent first).
    await page.getByRole("button", { name: /^Transcribe/ }).click();
    await page.getByRole("button", { name: "Transcribe", exact: true }).click();
    const text = page.getByLabel("Transcript (working copy)");
    await text.waitFor();
    assert.equal(await text.inputValue(), MOCK_TEXT);

    // Select a passage and keep it as a leaf.
    const phrase = "It was the first time I noticed how quiet the city could be.";
    await text.evaluate((el, p) => {
      const i = el.value.indexOf(p);
      el.focus();
      el.setSelectionRange(i, i + p.length);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    }, phrase);
    await page.getByRole("toolbar", { name: "Use the selected passage" }).getByRole("button", { name: "Leaf", exact: true }).click();
    await page.getByText("Kept as a leaf, linked to this passage.").waitFor();

    // The leaf links back to its source, and the source passage is highlighted.
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
  await page.waitForURL(/seeds\?rec=/);
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

test("Journey C: a story's trunk — scenes in order, characters in the roots, a scene's own draft, persisted", async () => {
  const { context, page, errors } = await fresh();
  await page.getByRole("button", { name: "A short story" }).click();
  await page.waitForURL(/#\/p\//);
  await part(page, "Trunk").click();
  const first = page.locator(".column", { hasText: "Beginning" }).locator(".card").first();
  await first.waitFor();
  assert.match(await first.innerText(), /Last call/);
  assert.match(await first.innerText(), /Mara/); // linked characters show on the card
  await first.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForFunction(() => document.querySelector(".column .card")?.textContent?.includes("The cabin"));

  // Characters live in the roots: what the story grows from.
  await part(page, "Roots").click();
  await view(page, "People, places & sources").click();
  await page.getByRole("link", { name: /Mara/ }).click();
  await page.locator(".ref-title").fill("Mara Lind");
  await page.locator(".ref-title").press("Enter");

  // A scene opens into its own draft, linked both ways.
  await part(page, "Trunk").click();
  await page.locator(".card", { hasText: "On deck" }).click();
  await page.getByRole("button", { name: "Start a draft from this piece" }).click();
  await page.waitForURL(/view=draft/);
  await page.getByRole("link", { name: /From the trunk: On deck/ }).waitFor();

  await page.reload({ waitUntil: "networkidle" });
  await part(page, "Trunk").click();
  await page.waitForFunction(() => document.querySelector(".column .card")?.textContent?.includes("The cabin"));
  assert.match(await page.locator(".card", { hasText: "Last call" }).innerText(), /Mara Lind/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("Journey D: start from why, work through the guided steps, weigh a choice, and let it become the thread", async () => {
  const { context, page, errors } = await fresh();
  await page.getByRole("button", { name: "Plant your first tree" }).click();
  await page.getByLabel("Working title").fill("Memoir: the bridge");
  await page.getByText("Memoir chapter").click();
  await page.getByRole("button", { name: "Plant it" }).click();
  // No purpose yet, so the tree starts at its roots, and Miki asks one thing.
  await page.waitForURL(/\/roots/);
  await page.getByText("What is this piece for?").waitFor();
  await page.getByLabel("Why does this piece exist?").fill("To understand the winter my father stopped driving.");
  await page.getByLabel("Who is it for?").click();
  await page.getByText("Who is it for? Picture one reader.").waitFor();

  // Discern: the memoir's guided steps, then a choice recorded from a step.
  await part(page, "Trunk").click();
  await view(page, "Discern").click();
  await page.getByLabel("Your thinking").fill("The winter my father stopped driving.");
  await page.getByRole("button", { name: /Done — next step/ }).click();
  await page.locator(".step-list .step-row", { hasText: "Choose the frame" }).click();
  await page.getByRole("button", { name: /Record this as a decision/ }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Younger me leads");
  await page.getByLabel("Option 2", { exact: true }).fill("Present me leads");
  await page.getByLabel("Choose option 2").click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Choose option 2"]')?.checked);
  await page.getByLabel(/Why this direction/).fill("Distance lets me be honest about what I didn't see.");
  await page.getByRole("button", { name: "Choose this" }).click();
  await page.getByText("Chosen", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Make this the thread" }).click();
  await page.getByText("Set as the project's thread.").waitFor();
  assert.equal(await page.locator(".trunk-thread-text").inputValue(), "Present me leads");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".step-list .step-row", { hasText: "Choose the frame" }).click();
  assert.equal(await page.getByLabel(/Why this direction/).inputValue(), "Distance lets me be honest about what I didn't see.");
  // The overview shows the thread and the choice behind it.
  await part(page, "Roots").click();
  await view(page, "Overview").click();
  assert.equal(await page.getByRole("textbox", { name: /The thread/ }).inputValue(), "Present me leads");
  await page.getByText("From your choice:").waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("Journey F: a failed save is reported, the text is kept, and it can be recovered", async () => {
  const { context, page } = await fresh();
  await page.getByRole("button", { name: "An essay" }).click();
  await page.waitForURL(/#\/p\//);
  await page.goto(base + "#/settings");
  await page.getByLabel("Simulate failed saves for drafts").check();
  await page.goBack();
  await part(page, "Trunk").click();
  await view(page, "Draft").click();
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
  await page.getByRole("button", { name: "An essay" }).click();
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
  await other.page.waitForURL(/leaves\?note=/);
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

test("Small screens: the grove, the trunk as a list, and planting from anywhere", async () => {
  const { context, page, errors } = await fresh({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.getByRole("button", { name: "An essay" }).click();
  await page.waitForURL(/#\/p\//);
  await part(page, "Trunk").click();
  await page.locator(".board-list").waitFor();
  // On a phone, the storyboard becomes grouped lists.
  await part(page, "Leaves").click();
  await view(page, "Storyboard").click();
  await page.locator(".board-list").getByText("Promising").first().waitFor();
  assert.equal(await page.locator(".canvas").count(), 0);
  await page.locator(".mobile-nav").getByRole("button", { name: "Plant a thought" }).click();
  await page.getByLabel("Your thought").fill("A thought on the bus.");
  await page.getByRole("button", { name: "Plant", exact: true }).click();
  await page.getByText(/A new leaf on/).waitFor();
  await page.locator(".mobile-nav").getByRole("link", { name: "Grove" }).click();
  await page.locator(".tree-link", { hasText: "The Case for Slowing Down" }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});
