import { useMemo, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { createSampleEssay, createSampleStory } from "../../data/sample";
import { projectTemplate } from "../../data/templates";
import { INBOX, type Document, type Project } from "../../data/types";
import { navigate, projectPath, href } from "../../lib/router";
import { openCapture } from "../../lib/store";
import { cx, plural, relativeTime, truncate } from "../../lib/util";
import { IconArchive, IconAudio, IconBook, IconDownload, IconMic, IconMore, IconNote, IconPen, IconPencil, IconPlus, IconTrash, IconUnarchive, IconArrowRight } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toastError } from "../../ui/toast";
import { Badge, Button, EmptyState, IconButton, Segmented, Spinner } from "../../ui/ui";
import { modeLabel } from "../project/modes";
import { exportBackup, removeProject, renameProject, toggleArchive } from "../project/projectActions";
import { NewProjectDialog } from "./NewProjectDialog";
import { Wordmark } from "../../ui/Logo";
import "./studio.css";

interface StudioData {
  projects: Project[];
  words: Map<string, number>;
  docs: Map<string, Document[]>;
  inbox: { id: string; kind: "note" | "recording"; title: string; createdAt: number }[];
}

async function loadStudio(): Promise<StudioData> {
  const [projects, documents, notes, recordings] = await Promise.all([
    db.getAll("projects"),
    db.getAll("documents"),
    db.byIndex("notes", "projectId", INBOX),
    db.byIndex("recordings", "projectId", INBOX),
  ]);
  const words = new Map<string, number>();
  const docs = new Map<string, Document[]>();
  for (const d of documents) {
    words.set(d.projectId, (words.get(d.projectId) ?? 0) + d.wordCount);
    docs.set(d.projectId, [...(docs.get(d.projectId) ?? []), d]);
  }
  const inbox = [
    ...notes.map((n) => ({ id: n.id, kind: "note" as const, title: n.title || truncate(n.body, 90), createdAt: n.createdAt })),
    ...recordings.map((r) => ({ id: r.id, kind: "recording" as const, title: r.title, createdAt: r.createdAt })),
  ].sort((a, b) => b.createdAt - a.createdAt);
  return { projects, words, docs, inbox };
}

type Sort = "recent" | "title";

export function StudioPage() {
  const { data, loading, error } = useLive(loadStudio, [], ["projects", "documents", "notes", "recordings"]);
  const [newOpen, setNewOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("recent");
  const [showArchived, setShowArchived] = useState(false);
  const [sampleBusy, setSampleBusy] = useState<string | null>(null);

  const active = useMemo(() => (data?.projects ?? []).filter((p) => !p.archived), [data]);
  const archived = useMemo(() => (data?.projects ?? []).filter((p) => p.archived), [data]);
  const sorted = useMemo(() => {
    const list = [...(showArchived ? archived : active)];
    return sort === "title" ? list.sort((a, b) => a.title.localeCompare(b.title)) : list.sort((a, b) => Math.max(b.lastOpenedAt, b.updatedAt) - Math.max(a.lastOpenedAt, a.updatedAt));
  }, [active, archived, sort, showArchived]);
  const last = useMemo(() => [...active].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0], [active]);

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
        <Spinner label="Loading projects" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="page">
        <EmptyState title="Couldn't load your projects">{error.message}</EmptyState>
      </div>
    );
  }

  const isEmpty = active.length === 0 && archived.length === 0;

  return (
    <div className="page studio">
      <header className="studio-top">
        <div className="studio-brand-mobile">
          <Wordmark size={22} />
        </div>
        <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="page-title studio-title">{isEmpty ? "Find the thread." : last ? "Pick up the thread." : "Start with what you have."}</h1>
        {isEmpty && <p className="page-sub studio-sub">A place for your thoughts to become something. Capture rough ideas, see their shape, and turn them into finished work.</p>}
        <div className="studio-actions">
          <Button variant="primary" icon={IconPlus} onClick={() => setNewOpen(true)}>
            New project
          </Button>
          <Button icon={IconPen} onClick={() => openCapture({ tab: "write" })}>
            Capture a thought
          </Button>
          <Button icon={IconMic} onClick={() => openCapture({ tab: "speak" })}>
            Talk it through
          </Button>
        </div>
      </header>

      {isEmpty ? (
        <section className="studio-welcome">
          <div className="welcome-steps">
            {[
              ["Capture", "Speak or jot a thought without deciding where it goes."],
              ["Explore", "Spread ideas out in a bounded space and sort what's promising."],
              ["Discern", "Choose a direction — and keep a record of why."],
              ["Arrange & write", "Give it a sequence, then draft in a quiet editor."],
            ].map(([t, d], i) => (
              <div key={t} className="welcome-step">
                <span className="welcome-num">{i + 1}</span>
                <h2>{t}</h2>
                <p>{d}</p>
              </div>
            ))}
          </div>
          <div className="welcome-samples panel">
            <div>
              <h2 className="section-title">Want to look around first?</h2>
              <p className="muted">Open a sample project, clearly marked as a sample. Delete it whenever you like.</p>
            </div>
            <div className="row gap-2 wrap">
              <Button icon={IconBook} onClick={() => void openSample("essay")} busy={sampleBusy === "essay"}>
                Sample essay
              </Button>
              <Button icon={IconBook} onClick={() => void openSample("story")} busy={sampleBusy === "story"}>
                Sample short story
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {last && !showArchived && <ContinueCard project={last} words={data!.words.get(last.id) ?? 0} docs={data!.docs.get(last.id) ?? []} />}
          <div className="studio-grid-head">
            <h2 className="section-title">{showArchived ? "Archived" : "Projects"}</h2>
            <div className="row gap-2">
              <Segmented
                size="sm"
                label="Sort projects"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "recent", label: "Recent" },
                  { value: "title", label: "A–Z" },
                ]}
              />
              {(archived.length > 0 || showArchived) && (
                <Button size="sm" variant="ghost" icon={showArchived ? IconUnarchive : IconArchive} onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? "Active projects" : `Archived (${archived.length})`}
                </Button>
              )}
            </div>
          </div>
          {sorted.length === 0 ? (
            <EmptyState compact title={showArchived ? "Nothing archived" : "No active projects"}>
              {showArchived ? "Archived projects will rest here." : "Everything is archived. Start something new, or bring one back."}
            </EmptyState>
          ) : (
            <ul className="project-grid" role="list">
              {sorted.map((p) => (
                <ProjectCard key={p.id} project={p} words={data!.words.get(p.id) ?? 0} />
              ))}
              {!showArchived && (
                <li>
                  <button type="button" className="project-card project-card-new" onClick={() => setNewOpen(true)}>
                    <IconPlus size={20} aria-hidden />
                    <span>New project</span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      <section className="studio-unsorted">
        <div className="studio-grid-head">
          <h2 className="section-title">Unsorted</h2>
          {(data?.inbox.length ?? 0) > 0 && (
            <a className="link-btn" href="#/inbox">
              View all {data!.inbox.length}
            </a>
          )}
        </div>
        {(data?.inbox.length ?? 0) === 0 ? (
          <p className="muted studio-unsorted-empty">
            Captures that don't belong anywhere yet land here. Press <kbd className="kbd">C</kbd> anytime to jot something down.
          </p>
        ) : (
          <ul className="unsorted-list" role="list">
            {data!.inbox.slice(0, 4).map((item) => (
              <li key={item.id}>
                <a className="list-row" href={href("/inbox", { [item.kind === "note" ? "note" : "rec"]: item.id })}>
                  <span className="unsorted-icon">{item.kind === "note" ? <IconNote size={15} aria-hidden /> : <IconAudio size={15} aria-hidden />}</span>
                  <span className="grow list-row-title">{item.title || "Untitled"}</span>
                  <span className="list-row-meta">{relativeTime(item.createdAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function ContinueCard({ project, words, docs }: { project: Project; words: number; docs: Document[] }) {
  const loc = project.lastLocation;
  const doc = loc?.mode === "write" && loc.entityId ? docs.find((d) => d.id === loc.entityId) : undefined;
  const query = loc?.mode === "write" && doc ? { doc: doc.id } : undefined;
  return (
    <a className="continue-card" href={href(projectPath(project.id, loc?.mode), query)}>
      <div className="grow">
        <p className="eyebrow">
          Continue · {modeLabel(loc?.mode)}
          {doc ? ` · ${doc.title}` : ""}
        </p>
        <h2 className="continue-title">{project.title}</h2>
        {project.thread ? <p className="continue-thread">{project.thread}</p> : <p className="continue-thread muted">No thread yet — what is this really about?</p>}
        <p className="continue-meta">
          {plural(words, "word")} · last opened {relativeTime(project.lastOpenedAt)}
        </p>
      </div>
      <span className="continue-go" aria-hidden>
        <IconArrowRight size={20} />
      </span>
    </a>
  );
}

function ProjectCard({ project: p, words }: { project: Project; words: number }) {
  const tpl = projectTemplate(p.type);
  return (
    <li className="project-card-wrap">
      <a className={cx("project-card", p.archived && "is-archived")} href={href(projectPath(p.id, p.lastLocation?.mode))}>
        <div className="project-card-top">
          <span className="eyebrow">{tpl.label}</span>
          {p.isSample && <Badge tone="warm">Sample</Badge>}
        </div>
        <h3 className="project-card-title">{p.title}</h3>
        <p className={cx("project-card-thread", !p.thread && !p.description && "muted")}>{p.thread ? `“${truncate(p.thread, 120)}”` : p.description ? truncate(p.description, 120) : "Still finding the thread."}</p>
        <p className="project-card-meta">
          {plural(words, "word")} · {relativeTime(Math.max(p.updatedAt, p.lastOpenedAt))}
        </p>
      </a>
      <div className="project-card-menu">
        <Menu
          label={`${p.title} actions`}
          trigger={(t) => <IconButton {...t} icon={IconMore} label={`Actions for ${p.title}`} size="sm" />}
          items={[
            { label: "Rename", icon: IconPencil, onSelect: () => void renameProject(p) },
            { label: p.archived ? "Unarchive" : "Archive", icon: p.archived ? IconUnarchive : IconArchive, onSelect: () => void toggleArchive(p) },
            { label: "Download backup", icon: IconDownload, onSelect: () => void exportBackup(p) },
            { separator: true },
            { label: "Delete…", icon: IconTrash, danger: true, onSelect: () => void removeProject(p, () => undefined) },
          ]}
        />
      </div>
    </li>
  );
}
