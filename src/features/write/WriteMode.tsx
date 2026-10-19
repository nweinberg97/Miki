import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../data/db";
import { useByProject, useLive } from "../../data/hooks";
import { createDocument, createSnapshot, deleteDocument, duplicateDocument, reorderDocuments, updateDocument } from "../../data/repo";
import type { Document, DocStatus, Project } from "../../data/types";
import { useAutosave, readRecovery, clearRecovery, type SaveStatus } from "../../editor/autosave";
import { Editor, type EditorHandle } from "../../editor/Editor";
import { EXPORT_FORMATS, exportPieces } from "../../editor/exporters";
import { href, setQuery } from "../../lib/router";
import { partPath } from "../project/modes";
import { ui } from "../../lib/store";
import { byOrder, cx, plural, readingMinutes, relativeTime } from "../../lib/util";
import { promptDialog } from "../../ui/Dialog";
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconDocPlus,
  IconFileDown,
  IconHistory,
  IconMaximize,
  IconMinimize,
  IconMore,
  IconPanelClose,
  IconPanelOpen,
  IconPencil,
  IconRetry,
  IconSource,
  IconTrash,
  IconWarning,
  IconCircleCheck,
  IconDoc,
} from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Button, EmptyState, IconButton, InlineEdit, Spinner } from "../../ui/ui";
import { MaterialPanel } from "./MaterialPanel";
import { VersionsDialog } from "./VersionsDialog";
import "./write.css";

const STATUS_LABEL: Record<DocStatus, string> = { draft: "Draft", revising: "Revising", done: "Done" };

export function WriteMode({ project, query }: { project: Project; query: URLSearchParams }) {
  const { data: docs } = useByProject("documents", project.id);
  const sorted = useMemo(() => [...(docs ?? [])].sort(byOrder), [docs]);
  const requested = query.get("doc");
  const current = sorted.find((d) => d.id === requested) ?? (requested ? undefined : [...sorted].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
  const focusMode = ui.use((s) => s.focusMode);
  const [materialOpen, setMaterialOpen] = useState(() => {
    try {
      return localStorage.getItem("miki:material") !== "0";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("miki:material", materialOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [materialOpen]);

  // Keep the URL pointing at the open document so reloads and "resume" land in the same place.
  useEffect(() => {
    if (current && requested !== current.id) setQuery({ doc: current.id }, { replace: true });
  }, [current, requested]);

  useEffect(() => () => ui.set({ focusMode: false }), []);
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) ui.set({ focusMode: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  const newDoc = async () => {
    try {
      const d = await createDocument(project.id, { title: "Untitled" });
      setQuery({ doc: d.id });
    } catch (e) {
      toastError(e, "Couldn't create a document.");
    }
  };

  if (!docs) return <div className="write" aria-busy />;

  return (
    <div className={cx("write", focusMode && "is-focus", materialOpen && !focusMode && "has-material")}>
      {!focusMode && (
        <aside className="doc-nav" aria-label="Documents">
          <div className="doc-nav-head">
            <h2 className="eyebrow">Drafts</h2>
            <IconButton icon={IconDocPlus} label="New draft" size="sm" onClick={() => void newDoc()} />
          </div>
          {sorted.length === 0 ? (
            <p className="doc-nav-empty">No drafts yet.</p>
          ) : (
            <ul role="list" className="doc-list">
              {sorted.map((d, i) => (
                <DocRow key={d.id} doc={d} active={d.id === current?.id} project={project} index={i} all={sorted} />
              ))}
            </ul>
          )}
        </aside>
      )}
      <section className="write-main">
        {current ? (
          <DocEditor key={current.id} doc={current} docs={sorted} onNewDoc={() => void newDoc()} project={project} materialOpen={materialOpen} onToggleMaterial={() => setMaterialOpen((o) => !o)} />
        ) : requested ? (
          <EmptyState
            icon={IconDoc}
            title="That document isn't here anymore"
            actions={
              <Button variant="primary" onClick={() => setQuery({ doc: null })}>
                Open the latest draft
              </Button>
            }
          >
            It may have been deleted.
          </EmptyState>
        ) : (
          <EmptyState
            icon={IconPencil}
            title="A blank page, when you want one"
            actions={
              <Button variant="primary" icon={IconDocPlus} onClick={() => void newDoc()}>
                New draft
              </Button>
            }
          >
            The draft grows along the trunk. Start a blank page, or go to Shape and grow a draft from what you carried — your leaves and trunk stay beside you here.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function DocRow({ doc, active, project, index, all }: { doc: Document; active: boolean; project: Project; index: number; all: Document[] }) {
  const move = async (dir: -1 | 1) => {
    const ids = all.map((d) => d.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorderDocuments(ids).catch(toastError);
  };
  const rename = async () => {
    const title = await promptDialog({ title: "Rename document", label: "Title", initial: doc.title, confirmLabel: "Rename" });
    if (title) await updateDocument(doc.id, { title }).catch(toastError);
  };
  const remove = async () => {
    try {
      const restore = await deleteDocument(doc.id);
      clearRecovery(doc.id);
      toastUndo(`Deleted "${doc.title}".`, restore);
      if (active) setQuery({ doc: null });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <li className={cx("doc-row", active && "is-active")}>
      <a className="doc-row-link" href={href(partPath(project.id, "trunk"), { view: "draft", doc: doc.id })} aria-current={active ? "page" : undefined}>
        <span className={cx("doc-status-dot", `is-${doc.status}`)} aria-hidden />
        <span className="grow">
          <span className="doc-row-title">{doc.title || "Untitled"}</span>
          <span className="doc-row-meta">{plural(doc.wordCount, "word")}</span>
        </span>
      </a>
      <Menu
        label={`${doc.title} actions`}
        trigger={(t) => <IconButton {...t} icon={IconMore} label={`Actions for ${doc.title}`} size="sm" className="doc-row-menu" />}
        items={[
          { label: "Rename", icon: IconPencil, onSelect: () => void rename() },
          { label: "Duplicate", icon: IconCopy, onSelect: () => void duplicateDocument(doc.id).then((d) => setQuery({ doc: d.id })).catch(toastError) },
          { label: "Move up", icon: IconArrowUp, disabled: index === 0, onSelect: () => void move(-1) },
          { label: "Move down", icon: IconArrowDown, disabled: index === all.length - 1, onSelect: () => void move(1) },
          { separator: true },
          { heading: "Status" },
          ...(["draft", "revising", "done"] as DocStatus[]).map((s) => ({
            label: STATUS_LABEL[s],
            checked: doc.status === s,
            onSelect: () => void updateDocument(doc.id, { status: s }).catch(toastError),
          })),
          { separator: true },
          { label: "Delete", icon: IconTrash, danger: true, onSelect: () => void remove() },
        ]}
      />
    </li>
  );
}

function DocEditor({
  doc,
  docs,
  onNewDoc,
  project,
  materialOpen,
  onToggleMaterial,
}: {
  doc: Document;
  docs: Document[];
  onNewDoc: () => void;
  project: Project;
  materialOpen: boolean;
  onToggleMaterial: () => void;
}) {
  const autosave = useAutosave(doc.id);
  const editor = useRef<EditorHandle>(null);
  const [stats, setStats] = useState({ words: doc.wordCount, selectionWords: 0 });
  const [versionsOpen, setVersionsOpen] = useState(false);
  const focusMode = ui.use((s) => s.focusMode);
  const [recovery, setRecovery] = useState(() => {
    const r = readRecovery(doc.id);
    return r && r.at > doc.updatedAt + 500 && JSON.stringify(r.content) !== JSON.stringify(doc.content) ? r : null;
  });
  const { data: sourceCard } = useLive(() => (doc.sourceCardId ? db.get("cards", doc.sourceCardId) : Promise.resolve(undefined)), [doc.sourceCardId], ["cards"]);

  const saveVersion = async () => {
    const label = await promptDialog({ title: "Save a version", label: "Name this version", initial: `Version — ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, confirmLabel: "Save version" });
    if (!label) return;
    try {
      await autosave.flush();
      await createSnapshot(doc.id, label);
      toast("Version saved. Find it under History.");
    } catch (e) {
      toastError(e, "Couldn't save the version.");
    }
  };

  const exportAs = async (format: (typeof EXPORT_FORMATS)[number]["format"]) => {
    try {
      await autosave.flush();
      await exportPieces(format, doc.title, [{ title: doc.title, content: editor.current?.getJSON() ?? doc.content }], { includeTitles: false });
    } catch (e) {
      toastError(e, "Export failed.");
    }
  };

  return (
    <div className="doc-editor">
      <div className="doc-bar" role="toolbar" aria-label="Document">
        <div className="doc-bar-left">
          <span className="doc-switch">
            <Menu
              label="Documents"
              align="start"
              trigger={(t) => <IconButton {...t} icon={IconDoc} label="Switch document" />}
              items={[
                { heading: "Drafts" },
                ...docs.map((d) => ({ label: d.title || "Untitled", checked: d.id === doc.id, onSelect: () => setQuery({ doc: d.id }) })),
                { separator: true },
                { label: "New document", icon: IconDocPlus, onSelect: onNewDoc },
              ]}
            />
          </span>
          <SaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} error={autosave.error} onRetry={autosave.retry} />
          <span className="doc-bar-stat" aria-live="off">
            {stats.selectionWords > 0 ? `${plural(stats.selectionWords, "word")} selected · ` : ""}
            {plural(stats.words, "word")}
            {stats.words > 200 && <span className="faint"> · {readingMinutes(stats.words)} min read</span>}
          </span>
        </div>
        <div className="doc-bar-right">
          {!focusMode && (
            <span className={cx("doc-status-pill", `is-${doc.status}`)}>
              <span className={cx("doc-status-dot", `is-${doc.status}`)} aria-hidden />
              {STATUS_LABEL[doc.status]}
            </span>
          )}
          <IconButton icon={IconHistory} label="History and versions" onClick={() => setVersionsOpen(true)} />
          <Menu
            label="Export"
            trigger={(t) => <IconButton {...t} icon={IconFileDown} label="Export this document" />}
            items={[{ heading: "Export this document" }, ...EXPORT_FORMATS.map((f) => ({ label: f.label, onSelect: () => void exportAs(f.format) }))]}
          />
          <IconButton icon={focusMode ? IconMinimize : IconMaximize} label={focusMode ? "Leave focus mode (Esc)" : "Focus mode"} onClick={() => ui.set((s) => ({ focusMode: !s.focusMode }))} />
          {!focusMode && <IconButton icon={materialOpen ? IconPanelClose : IconPanelOpen} label={materialOpen ? "Hide the trunk and leaves" : "Show the trunk and leaves beside the draft"} pressed={materialOpen} onClick={onToggleMaterial} />}
        </div>
      </div>

      <div className="doc-scroll scroll-y">
        <div className="doc-page">
          {recovery && (
            <div className="banner" role="alert">
              <IconWarning size={16} aria-hidden />
              <p className="grow">
                Miki found unsaved changes from {relativeTime(recovery.at)} that didn't reach storage — probably the tab closed mid-save.
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  editor.current?.reset(recovery.content);
                  setRecovery(null);
                  toast("Recovered your unsaved changes.");
                }}
              >
                Restore them
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearRecovery(doc.id);
                  setRecovery(null);
                }}
              >
                Discard
              </Button>
            </div>
          )}
          {autosave.status === "error" && (
            <div className="banner banner-danger" role="alert">
              <IconWarning size={16} aria-hidden />
              <p className="grow">
                Your latest changes haven't been saved: {autosave.error} They're still here in the editor, a backup copy is kept in this browser, and Miki is retrying.
              </p>
              <Button size="sm" icon={IconRetry} onClick={autosave.retry}>
                Retry now
              </Button>
            </div>
          )}
          <header className="doc-head">
            <InlineEdit label="Document title" className="doc-title" value={doc.title} onCommit={(title) => void updateDocument(doc.id, { title: title || "Untitled" }).catch(toastError)} />
            {sourceCard && (
              <a className="chip doc-source" href={href(partPath(project.id, "trunk"), { view: "shape", card: sourceCard.id })}>
                <IconSource size={13} aria-hidden />
                <span>From the trunk: {sourceCard.title || "Untitled"}</span>
              </a>
            )}
          </header>
          <Editor ref={editor} doc={doc} autosave={autosave} onStats={setStats} onSaveVersion={() => void saveVersion()} onToggleFocus={() => ui.set((s) => ({ focusMode: !s.focusMode }))} />
        </div>
      </div>
      {materialOpen && !focusMode && <MaterialPanel project={project} onInsert={(content) => editor.current?.insert(content)} onClose={onToggleMaterial} />}
      <VersionsDialog
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        doc={doc}
        onBeforeRestore={() => autosave.flush()}
        onSaveVersion={() => void saveVersion()}
      />
    </div>
  );
}

export function SaveIndicator({ status, lastSavedAt, error, onRetry }: { status: SaveStatus; lastSavedAt: number | null; error: string | null; onRetry: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={cx("save-indicator", `is-${status}`)} role="status" aria-live="polite" title={error ?? "Saved in this browser's local storage. Not synced to other devices."}>
      {status === "saving" && <Spinner size={12} />}
      {status === "saved" && <IconCircleCheck size={13} aria-hidden />}
      {status === "pending" && <span className="save-dot" aria-hidden />}
      {status === "error" && <IconWarning size={13} aria-hidden />}
      <span>
        {status === "saved" && (lastSavedAt ? `Saved on this device · ${relativeTime(lastSavedAt)}` : "Saved on this device")}
        {status === "pending" && "Editing…"}
        {status === "saving" && "Saving…"}
        {status === "error" && (
          <>
            Not saved —{" "}
            <button type="button" className="link-btn" onClick={onRetry}>
              retry
            </button>
          </>
        )}
      </span>
    </span>
  );
}
