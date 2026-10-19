# Miki

**Find the thread.** Miki is a visual writing studio for people juggling several pieces of writing — essays, memoir, fiction, books, half-formed ideas. Capture rough thoughts by voice or text, spread them out in a bounded idea space, decide what matters (and keep a record of why), give the work a sequence, and draft it in a quiet editor. All on the same underlying material.

Miki is **local-first**: your writing lives in your browser's own database on your device. No account, no tracking, nothing uploaded unless you explicitly send a recording to a transcription service.

---

## Cost: free

Nothing in Miki requires a paid service, an account, or an API key.

- **The app** is open-source code with no paid dependencies; fonts are open-licensed and bundled.
- **Hosting** is free on GitHub Pages, Netlify, Cloudflare Pages, or Vercel's Hobby plan — or just run it locally.
- **Storage** is your own browser. There's no database bill because there's no database server.
- **Turning voice into text** has three free paths: live dictation in Chrome/Edge/Safari, importing or typing a transcript, or a free Whisper server on your own machine (`docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu`, then set `TRANSCRIPTION_API_BASE` — see `.env.example`). A paid provider such as OpenAI is supported but never needed.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — rebuilds and reloads on change
```

Production:

```bash
npm run build      # → dist/ (static files + service worker)
npm start          # serves dist/ and the optional transcription relay on http://localhost:4173
```

A single self-contained HTML file (handy for sharing a demo):

```bash
npm run build:single   # → dist-single/miki.html
```

Requires Node 20+.

## Hosting

`dist/` is a static site; any static host works (Netlify, Cloudflare Pages, GitHub Pages). Routing uses `#/` URLs, so no rewrite rules are needed.

**Vercel (recommended):** import the repo. `vercel.json` sets the build command and output directory, and the `api/` folder provides `/api/health` and `/api/transcribe` as serverless functions. To enable transcription, add `TRANSCRIPTION_API_KEY` (or `TRANSCRIPTION_API_BASE`) in the project's environment variables. Note Vercel's ~4.5 MB request limit (≈5–8 minutes of compressed speech).

Each visitor's data stays in their own browser — a hosted Miki is a private studio per device, not a shared workspace.

## Testing

```bash
npm run typecheck      # TypeScript, strict
npm run test:unit      # serialization, structure logic, suggestions, transcript parsing, server relay
npm run build && npm run test:e2e   # full user journeys in headless Chromium (Playwright)
```

The end-to-end suite uses a fake microphone and a local mock transcription service, so it's offline and free. It covers: starting an essay through to Markdown export and reload; recording → transcription → extracting a linked fragment; the no-engine path; denied microphone; organising a story with characters and reordering; working through a decision; a simulated save failure with recovery; backup round-trip into a fresh profile; malformed backups; and small-screen use.

If Playwright's browser isn't installed: `npx playwright install chromium`.

## How it's built

| Piece | Choice |
| --- | --- |
| UI | React 19 + TypeScript, hand-written CSS with design tokens (light & dark) |
| Bundling | esbuild (`scripts/build.mjs`, `scripts/dev.mjs`) — no framework server needed |
| Editor | ProseMirror, with a small schema (headings, lists, quotes, links, emphasis), Markdown-aware paste and input rules |
| Storage | IndexedDB via a thin typed layer (`src/data/db.ts`) with versioned migrations, transactions, and cross-tab change notifications |
| Validation | zod, for backup import |
| Exports | Markdown, plain text, standalone HTML, print/PDF, and Word (`docx`, loaded on demand) |
| Offline | Service worker caches the app shell; your data never touches it |
| Server (optional) | `server/transcribe.mjs` — a dependency-free relay to any OpenAI-compatible transcription API, shared by `server/server.mjs` and the Vercel functions |
| Type | Fraunces (display), Literata (prose), Instrument Sans (interface) — self-hosted, SIL OFL |

```
src/
  data/        types, IndexedDB layer, domain operations (repo.ts), templates, backups, samples
  editor/      ProseMirror schema/setup, Editor component, autosave + recovery, serializers, exporters
  features/
    studio/    home, new project
    project/   project shell, modes, Overview, rule-based suggestions
    capture/   capture dialog, voice recording, transcripts, notes, extraction
    board/     Idea space (bounded canvas), structure board, outline/list views, card panel
    write/     documents, editor chrome, material panel, versions, manuscript export
    discern/   process steps and decisions
    reference/ characters, places, sources, themes
    search/    ⌘K palette
    settings/  storage, backups, transcription, appearance, diagnostics
  transcription/  MediaRecorder hook, transcription adapters
server/, api/  optional transcription relay (local server / Vercel)
tests/         unit (node:test) and end-to-end (Playwright)
```

### The ideas behind the structure

- **One workspace, several ways of looking.** Overview · Capture · Explore · Arrange · Write · Discern · Reference are views over the same records. A card keeps its identity whether it's on the idea space, in the outline, linked to a decision, or the source of a draft.
- **Bounded, not infinite.** The idea space is a sheet that grows with your material but can't be panned into the void. Clusters (*Collecting · Promising · Set aside*) make discernment physical; "Set aside" is deliberately not "delete". Fit-to-content (`F`) and focus-on-selection keep everything findable.
- **The thread.** Every project has one sentence at its centre — what it's really about. Set it directly, from a promising idea, or from a decision.
- **Decisions are objects.** The question, the options, the choice, the reason, the trade-offs, and what it unlocks — linked to the cards and notes it affects.
- **Provenance.** Material pulled from a transcript keeps a link to the exact passage (and timestamp when the engine provides one). Transcripts keep the verbatim original alongside your working copy.

## Persistence and privacy

- Everything is stored in IndexedDB in the current browser profile. Miki asks the browser for persistent storage (Settings → *Where your work lives*).
- **Autosave** is debounced and only shows "Saved" after the IndexedDB transaction commits. While edits are pending, a recovery copy is written to `localStorage`; if a tab closes mid-save or storage fails, Miki offers to restore it the next time the document opens. Failed saves retry with backoff and are shown plainly.
- **Versions:** an automatic snapshot at most every 20 minutes of editing, plus named versions (⌘/Ctrl+S). Restoring saves the current text as a version first.
- **Deletes are undoable** (toast → Undo) for cards, notes, drafts, references, decisions, steps, recordings. Deleting a project asks for confirmation.
- **Backups:** Settings → Download a backup (optionally with audio). Restore validates every record, skips damaged ones, and lets you add only what's missing or replace matching items — in one transaction.
- No analytics, no third-party requests at runtime. Fonts are bundled.
- Audio leaves the device only when you press *Transcribe* and confirm the provider (asked once per provider). API keys live on the server and are never sent to the browser.
- Miki does **not** sync between devices and does not claim to.

## Transcription

Recording always works (where the browser supports MediaRecorder); turning audio into text uses whichever real path is available:

1. **Server relay** to an OpenAI-compatible endpoint — a free **local Whisper server** (fully on your machine), or optionally a paid service like OpenAI. See `.env.example`.
2. **Live dictation** while recording, using the browser's speech recognition (opt-in; Chrome/Edge send audio to the vendor's service — disclosed in the UI).
3. **Import** a `.txt`, `.vtt`, or `.srt` transcript from another app, or **write it out** yourself while listening back.

If none is configured, the recording is kept and the UI says so — no placeholder text is ever shown as a transcript.

## Implemented

- Studio: projects (create from 6 templates, rename, archive, delete, back up), continue-where-you-left-off, Unsorted inbox, clearly labelled sample projects
- Global capture (`C` / `R`): text or voice, to any project or Unsorted; move later
- Voice: permission handling, level meter, pause/resume, discard with confirmation, review before saving, download audio
- Transcripts: verbatim original + editable working copy, select a passage → note / key idea / idea card / outline item / append to draft (quote or text) / copy / play from timestamp; "pull out fragments" (deterministic split, user picks); derived items link back
- Idea space: pan, zoom, fit, drag, multi-select (shift-click, shift-drag), keyboard nudge/delete/open, clusters (create, rename, move, resize, collapse), typed cards, connections (supports / contradicts / depends / leads), find & filter, persistent viewport
- Structure: ordered sections and cards, drag between columns, Alt+arrow keyboard reordering, outline view, "Draft from structure", scene → its own draft (linked both ways), referenced characters shown on cards
- Editor: headings, bold/italic, lists, quotes, links, dividers, undo/redo, Markdown shortcuts and paste, smart quotes, selection toolbar, word count and reading time, focus mode, project material side panel, versions, exports (MD, TXT, HTML, print/PDF, DOCX), manuscript export of chosen drafts
- Discern: processes from templates or blank, editable/reorderable/skippable steps, guiding questions, context panels that surface existing material, decisions with options/rationale/trade-offs/next, "make this the thread", save your own process templates
- References: characters, places, research, sources, themes, arguments, questions — editable fields, notes, links to scenes and material
- Rule-based suggestions on Overview (dismissible), ⌘K search across everything, keyboard shortcuts (`?`), light/dark/system theme, writing size and line length, responsive layouts for phones, reduced-motion support, installable PWA with offline app shell

## Not implemented (and why)

- **Cloud sync / real-time collaboration** — needs identity, authorization, shared storage, and conflict resolution. The data layer is isolated behind `src/data/` so a sync engine can be added; nothing in the UI pretends otherwise. Sharing today = exports and backups.
- **On-device transcription in the browser** (e.g. Whisper via WebGPU) — not verifiable in this build environment and adds a large model download. A local Whisper *server* is supported via the relay instead.
- **AI assistance** — intentionally absent. Suggestions are rule-based and labelled as such.
- **Lint step** — the project uses strict TypeScript; no ESLint/TS config is included.
- No `package-lock.json` is committed: this build was produced in an environment without registry access. Run `npm install` to generate one.

## Most valuable next steps

1. **Optional sync** (e.g. CRDT-backed, end-to-end encrypted) so the same studio follows you across devices.
2. **On-device transcription** (Whisper in a Web Worker with WebGPU) for private, free speech-to-text.
3. **Opt-in AI, in context:** summarise a transcript, compare outlines, find contradictions — always as suggestions beside the writer's words.
4. **Comments and suggested edits** on drafts, building toward shared projects.
5. **Richer structure views:** timeline for fiction, argument map for nonfiction.
6. **Publishing hand-offs** (Substack-ready HTML, EPUB).
