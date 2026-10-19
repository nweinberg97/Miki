import { useMemo, useRef, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { createNote, moveToProject } from "../../data/repo";
import { createSampleEssay, createSampleStory } from "../../data/sample";
import { INBOX, type Project, type ProjectType } from "../../data/types";

const KIND_SHORT: Record<ProjectType, string> = { essay: "Essay", memoir: "Memoir", story: "Story", book: "Book", exploration: "Exploration", blank: "Tree" };
import { href, navigate, projectPath } from "../../lib/router";
import { openCapture } from "../../lib/store";
import { cx, deriveTitle, plural, relativeTime, truncate } from "../../lib/util";
import { IconArchive, IconArrowRight, IconBook, IconDownload, IconMic, IconMore, IconPencil, IconTrash, IconUnarchive } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { PartGlyph, STAGE_LABEL, Tree, stageOf, type Stage } from "../../ui/PartGlyph";
import { toast, toastError } from "../../ui/toast";
import { Button, EmptyState, IconButton, Spinner } from "../../ui/ui";
import { Wordmark } from "../../ui/Logo";
import { PARTS, partInfo, partPath, toPart } from "../project/modes";
import { exportBackup, removeProject, renameProject, toggleArchive } from "../project/projectActions";
import { NewProjectDialog } from "./NewProjectDialog";
import "./studio.css";

interface Growth {
  leaves: number;
  trunk: number;
  words: number;
  stage: Stage;
}

interface Seed {
  id: string;
  kind: "note" | "recording";
  text: string;
  createdAt: number;
}

async function loadGrove() {
  const [projects, documents, notes, recordings, boards, cards] = await Promise.all([
    db.getAll("projects"),
    db.getAll("documents"),
    db.getAll("notes"),
    db.getAll("recordings"),
    db.getAll("boards"),
    db.getAll("cards"),
  ]);
  const trunkBoards = new Set(boards.filter((b) => b.kind === "structure").map((b) => b.id));
  const growth = new Map<string, Growth>();
  for (const p of projects) {
    const leaves = notes.filter((n) => n.projectId === p.id && !n.fallen).length + recordings.filter((r) => r.projectId === p.id).length;
    const trunk = cards.filter((c) => c.projectId === p.id && trunkBoards.has(c.boardId)).length;
    const words = documents.filter((d) => d.projectId === p.id).reduce((n, d) => n + d.wordCount, 0);
    growth.set(p.id, { leaves, trunk, words, stage: stageOf(p, leaves, trunk, words) });
  }
  const seeds: Seed[] = [
    ...notes.filter((n) => n.projectId === INBOX).map((n) => ({ id: n.id, kind: "note" as const, text: n.title || n.body, createdAt: n.createdAt })),
    ...recordings.filter((r) => r.projectId === INBOX).map((r) => ({ id: r.id, kind: "recording" as const, text: r.title, createdAt: r.createdAt })),
  ].sort((a, b) => b.createdAt - a.createdAt);
  return { projects, growth, seeds };
}

/** The grove: every project is a tree, and you can see how each one is growing. */
export function StudioPage() {
  const { data, loading, error } = useLive(loadGrove, [], ["projects", "documents", "notes", "recordings", "boards", "cards"]);
  const [newOpen, setNewOpen] = useState(false);
  const [showResting, setShowResting] = useState(false);
  const [sampleBusy, setSampleBusy] = useState<string | null>(null);

  const active = useMemo(() => (data?.projects ?? []).filter((p) => !p.archived).sort((a, b) => Math.max(b.lastOpenedAt, b.updatedAt) - Math.max(a.lastOpenedAt, a.updatedAt)), [data]);
  const resting = useMemo(() => (data?.projects ?? []).filter((p) => p.archived), [data]);
  const last = active[0];

  const openSample = async (kind: "essay" | "story") => {
    setSampleBusy(kind);
    try {
      const id = kind === "essay" ? await createSampleEssay() : await createSampleStory();
      navigate(projectPath(id));
    } catch (e) {
      toastError(e, "Couldn't create the sample.");
    } finally {
      setSampleBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="page" aria-busy>
        <Spinner label="Opening your grove" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="page">
        <EmptyState title="Couldn't open your grove">{error.message}</EmptyState>
      </div>
    );
  }

  const isEmpty = active.length === 0 && resting.length === 0;
  const shown = showResting ? resting : active;

  return (
    <div className="grove">
      <div className="grove-main">
        <header className="grove-top">
          <div className="grove-brand-mobile">
            <Wordmark size={22} />
          </div>
          <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="grove-title">What's taking root today?</h1>
          <PlantForm />
          <p className="grove-hint">Unplanted thoughts wait in Seeds until you know which tree they belong to.</p>
        </header>

        {isEmpty ? (
          <Story onNew={() => setNewOpen(true)} onSample={(k) => void openSample(k)} busy={sampleBusy} />
        ) : (
          <>
            {last && !showResting && <Resume project={last} />}
            <section className="grove-trees" aria-label={showResting ? "Resting trees" : "Your trees"}>
              <div className="grove-trees-head">
                <h2 className="grove-section-title">{showResting ? "Resting" : "Your grove"}</h2>
                {(resting.length > 0 || showResting) && (
                  <Button size="sm" variant="ghost" icon={showResting ? IconUnarchive : IconArchive} onClick={() => setShowResting((v) => !v)}>
                    {showResting ? "Back to the grove" : `Resting (${resting.length})`}
                  </Button>
                )}
              </div>
              <ul className="trees" role="list">
                {shown.map((p) => (
                  <TreeItem key={p.id} project={p} growth={data!.growth.get(p.id)!} />
                ))}
                {!showResting && (
                  <li className="tree-item">
                    <button type="button" className="tree-link tree-new" onClick={() => setNewOpen(true)}>
                      <Tree stage="seed" leaves={0} trunk={0} className="tree-svg" />
                      <span className="tree-title">Plant a new tree</span>
                      <span className="tree-meta">Start with why</span>
                    </button>
                  </li>
                )}
                {showResting && shown.length === 0 && <li className="muted">Nothing is resting.</li>}
              </ul>
              <div className="ground" aria-hidden />
            </section>
          </>
        )}
      </div>

      <Seeds seeds={data?.seeds ?? []} projects={active} />
      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function PlantForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const plant = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const n = await createNote({ projectId: INBOX, title: deriveTitle(body).length < body.length ? deriveTitle(body) : "", body });
      setText("");
      toast("Planted in Seeds.", { action: { label: "Open", onClick: () => navigate("/seeds", { note: n.id }) } });
    } catch (e) {
      toastError(e, "Couldn't plant that.");
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };
  return (
    <form
      className="plant"
      onSubmit={(e) => {
        e.preventDefault();
        void plant();
      }}
    >
      <label htmlFor="plant-input" className="sr-only">
        Plant a thought
      </label>
      <input ref={ref} id="plant-input" className="plant-input" placeholder="Plant a thought — say it or type it" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      <button type="button" className="plant-mic" aria-label="Speak it" title="Speak it (R)" onClick={() => openCapture({ tab: "speak" })}>
        <IconMic size={22} aria-hidden />
      </button>
      <button type="submit" className="plant-go" disabled={!text.trim() || busy}>
        Plant
      </button>
    </form>
  );
}

function Resume({ project }: { project: Project }) {
  const part = toPart(project.lastLocation?.mode, project);
  const info = partInfo(part);
  const query = part === "trunk" && project.lastLocation?.entityId ? { view: "draft", doc: project.lastLocation.entityId } : undefined;
  return (
    <a className="resume" href={href(partPath(project.id, part), query)}>
      <PartGlyph part={part} size={32} className="resume-glyph" />
      <span className="grow">
        <span className="resume-eyebrow">
          Pick up where you left off · {info.kanji} {info.label}
        </span>
        <span className="resume-title">{project.title}</span>
        {project.thread ? <span className="resume-thread">“{truncate(project.thread, 140)}”</span> : project.purpose ? <span className="resume-thread">{truncate(project.purpose, 140)}</span> : null}
      </span>
      <IconArrowRight size={20} aria-hidden className="resume-go" />
    </a>
  );
}

function TreeItem({ project: p, growth }: { project: Project; growth: Growth }) {
  const to = href(projectPath(p.id));
  return (
    <li className="tree-item">
      <a className={cx("tree-link", p.archived && "is-resting")} href={to}>
        <Tree stage={growth.stage} leaves={growth.leaves} trunk={growth.trunk} className="tree-svg" />
        <span className="tree-title">{p.title}</span>
        <span className="tree-meta">
          {p.isSample ? "Sample " : ""}
          {p.isSample ? KIND_SHORT[p.type].toLowerCase() : KIND_SHORT[p.type]} · {plural(growth.leaves, "leaf", "leaves")} · {STAGE_LABEL[growth.stage]}
        </span>
      </a>
      <div className="tree-menu">
        <Menu
          label={`${p.title} actions`}
          trigger={(t) => <IconButton {...t} icon={IconMore} label={`Actions for ${p.title}`} size="sm" />}
          items={[
            { label: "Rename", icon: IconPencil, onSelect: () => void renameProject(p) },
            { label: p.archived ? "Wake it up" : "Let it rest (archive)", icon: p.archived ? IconUnarchive : IconArchive, onSelect: () => void toggleArchive(p) },
            { label: "Download backup", icon: IconDownload, onSelect: () => void exportBackup(p) },
            { separator: true },
            { label: "Delete…", icon: IconTrash, danger: true, onSelect: () => void removeProject(p, () => undefined) },
          ]}
        />
      </div>
    </li>
  );
}

function Seeds({ seeds, projects }: { seeds: Seed[]; projects: Project[] }) {
  return (
    <aside className="seeds" aria-label="Seeds">
      <div className="seeds-head">
        <h2 className="grove-section-title">Seeds</h2>
        <span className="muted small">not yet planted</span>
      </div>
      {seeds.length === 0 ? (
        <p className="seeds-empty">
          Nothing waiting. Plant a thought above, or press <kbd className="kbd">C</kbd> anywhere — it lands here until you know where it belongs.
        </p>
      ) : (
        <ul role="list" className="seed-list">
          {seeds.slice(0, 5).map((s) => (
            <li key={s.id} className="seed">
              <a className="seed-text" href={href("/seeds", { [s.kind === "note" ? "note" : "rec"]: s.id })}>
                {truncate(s.text, 140) || "Untitled"}
              </a>
              <div className="seed-foot">
                <span>
                  {s.kind === "note" ? "Written" : "Spoken"} · {relativeTime(s.createdAt)}
                </span>
                <Menu
                  label="Plant in a project"
                  trigger={(t) => (
                    <button {...t} type="button" className="seed-plant">
                      Plant in…
                    </button>
                  )}
                  items={
                    projects.length
                      ? projects.map((p) => ({
                          label: p.title,
                          onSelect: () =>
                            void moveToProject({ type: s.kind, id: s.id }, p.id)
                              .then(() => toast(`Planted in “${p.title}”.`, { action: { label: "Go", onClick: () => navigate(partPath(p.id, "leaves"), { [s.kind === "note" ? "note" : "rec"]: s.id }) } }))
                              .catch(toastError),
                        }))
                      : [{ label: "Plant a tree first", disabled: true, onSelect: () => undefined }]
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {seeds.length > 5 && (
        <a className="link-btn" href="#/seeds">
          All {seeds.length} seeds
        </a>
      )}
    </aside>
  );
}

/** First visit: the story of the three trees, then a way in. */
function Story({ onNew, onSample, busy }: { onNew: () => void; onSample: (k: "essay" | "story") => void; busy: string | null }) {
  const copy: Record<string, [string, string, string]> = {
    roots: ["Rooted", "Know why before you write. Every piece begins in the ground: what it's for, and who it's for.", "Each project starts with its roots — one sentence of purpose that everything else grows from."],
    leaves: ["Leafing", "A tree brings life. Let ideas come freely — spoken, scribbled, more than you need.", "Speak or jot a thought from anywhere. Leaves you let fall are kept, and can feed what grows next."],
    trunk: ["Standing", "A tree holds all of it and still stands. Choose what you carry. The trunk is your thread.", "Carry the leaves that matter onto the trunk, in order. The draft grows along it."],
  };
  return (
    <section className="story" aria-label="How Miki works">
      <p className="story-kicker">mi · three &nbsp; ki · tree</p>
      <h2 className="story-title">Three trees. A place for your thoughts to take root.</h2>
      <div className="story-cols">
        {PARTS.map((p) => (
          <div key={p.part} className="story-col">
            <PartGlyph part={p.part} size={64} />
            <h3 className="story-col-title">
              <span className="story-kanji">{p.kanji}</span> {copy[p.part][0]}
            </h3>
            <p className="story-principle">{p.principle}</p>
            <p className="story-line">{copy[p.part][1]}</p>
            <p className="story-how">{copy[p.part][2]}</p>
          </div>
        ))}
      </div>
      <div className="story-foot">
        <Button variant="primary" onClick={onNew}>
          Plant your first tree
        </Button>
        <span className="muted small">or look around a sample first:</span>
        <Button size="sm" icon={IconBook} onClick={() => onSample("essay")} busy={busy === "essay"}>
          An essay
        </Button>
        <Button size="sm" icon={IconBook} onClick={() => onSample("story")} busy={busy === "story"}>
          A short story
        </Button>
      </div>
      <p className="story-coda">Rooted. Leafing. Standing. Three trees make a forest — 森. This is your grove.</p>
    </section>
  );
}
