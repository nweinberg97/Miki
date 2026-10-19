import { useEffect } from "react";
import { useRecord } from "../../data/hooks";
import { touchProject, updateProject } from "../../data/repo";
import { projectTemplate } from "../../data/templates";
import type { Mode, Project } from "../../data/types";
import { href, navigate, projectPath } from "../../lib/router";
import { ui } from "../../lib/store";
import { cx, isTypingTarget } from "../../lib/util";
import { IconArchive, IconChevronLeft, IconDevice, IconDownload, IconMore, IconPencil, IconTrash, IconUnarchive, IconFileDown } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toastError } from "../../ui/toast";
import { Badge, Button, EmptyState, IconButton, InlineEdit, Spinner } from "../../ui/ui";
import { MODES, isMode } from "./modes";
import { exportBackup, removeProject, renameProject, toggleArchive } from "./projectActions";
import { OverviewMode } from "./OverviewMode";
import { CaptureMode } from "../capture/CaptureMode";
import { BoardMode } from "../board/BoardMode";
import { WriteMode } from "../write/WriteMode";
import { DiscernMode } from "../discern/DiscernMode";
import { ReferenceMode } from "../reference/ReferenceMode";
import { ManuscriptExportDialog } from "../write/ManuscriptExportDialog";
import { useState } from "react";
import "./project.css";

export function ProjectPage({ projectId, mode: rawMode, query }: { projectId: string; mode?: string; query: URLSearchParams }) {
  const { data: project, loading } = useRecord("projects", projectId);
  const mode: Mode = isMode(rawMode) ? rawMode : "overview";
  const focusMode = ui.use((s) => s.focusMode);
  const [manuscriptOpen, setManuscriptOpen] = useState(false);

  // Remember where the writer was, so the studio can offer to resume.
  const entityId = query.get("doc") ?? undefined;
  useEffect(() => {
    if (project) void touchProject(project.id, { mode, entityId: mode === "write" ? entityId : undefined }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, mode, entityId]);

  useEffect(() => {
    if (project) document.title = `${project.title} · Miki`;
    return () => {
      document.title = "Miki";
    };
  }, [project?.title, project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector("dialog[open]")) return;
      const m = MODES.find((x) => x.key === e.key);
      if (m) {
        e.preventDefault();
        navigate(projectPath(projectId, m.mode));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectId]);

  if (loading && !project) {
    return (
      <div className="page" aria-busy>
        <Spinner label="Opening project" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="page">
        <EmptyState
          title="This project isn't here"
          actions={
            <Button variant="primary" onClick={() => navigate("/")}>
              Back to the studio
            </Button>
          }
        >
          It may have been deleted, or it lives in a different browser. Miki keeps work on the device where it was written.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={cx("project", `project-mode-${mode}`, focusMode && "is-focus")}>
      {!focusMode && (
        <header className="project-header">
          <div className="project-header-row">
            <a href="#/" className="project-back" aria-label="Back to the studio">
              <IconChevronLeft size={16} aria-hidden />
              <span>Studio</span>
            </a>
            <div className="project-title-wrap">
              <InlineEdit
                label="Project title"
                className="project-title"
                value={project.title}
                onCommit={(title) => void updateProject(project.id, { title }).catch(toastError)}
              />
              {project.isSample && (
                <Badge tone="warm" className="project-sample-badge">
                  Sample
                </Badge>
              )}
              {project.archived && <Badge>Archived</Badge>}
            </div>
            <div className="project-header-actions">
              <a className="storage-pill" href="#/settings" title="Your work is saved in this browser. Nothing is uploaded. Click for storage and backups.">
                <IconDevice size={13} aria-hidden />
                <span>On this device</span>
              </a>
              <ProjectMenu project={project} onManuscript={() => setManuscriptOpen(true)} />
            </div>
          </div>
          <nav className="mode-tabs" aria-label="Project modes">
            {MODES.map((m) => (
              <a
                key={m.mode}
                href={href(projectPath(project.id, m.mode))}
                className={cx("mode-tab", mode === m.mode && "is-active")}
                aria-current={mode === m.mode ? "page" : undefined}
                title={`${m.hint} (${m.key})`}
              >
                <m.icon size={15} aria-hidden />
                <span>{m.label}</span>
              </a>
            ))}
          </nav>
        </header>
      )}
      <div className="project-body">
        <ModeView project={project} mode={mode} query={query} />
      </div>
      <ManuscriptExportDialog open={manuscriptOpen} onClose={() => setManuscriptOpen(false)} project={project} />
    </div>
  );
}

function ModeView({ project, mode, query }: { project: Project; mode: Mode; query: URLSearchParams }) {
  switch (mode) {
    case "capture":
      return <CaptureMode project={project} query={query} />;
    case "explore":
      return <BoardMode project={project} kind="ideas" query={query} />;
    case "arrange":
      return <BoardMode project={project} kind="structure" query={query} />;
    case "write":
      return <WriteMode project={project} query={query} />;
    case "discern":
      return <DiscernMode project={project} query={query} />;
    case "reference":
      return <ReferenceMode project={project} query={query} />;
    default:
      return <OverviewMode project={project} />;
  }
}

function ProjectMenu({ project, onManuscript }: { project: Project; onManuscript: () => void }) {
  const tpl = projectTemplate(project.type);
  return (
    <Menu
      label="Project actions"
      trigger={(t) => <IconButton {...t} icon={IconMore} label="Project actions" />}
      items={[
        { heading: tpl.label },
        { label: "Rename", icon: IconPencil, onSelect: () => void renameProject(project) },
        { label: "Export writing…", icon: IconFileDown, onSelect: onManuscript },
        { label: "Download backup", icon: IconDownload, onSelect: () => void exportBackup(project) },
        { label: project.archived ? "Unarchive" : "Archive", icon: project.archived ? IconUnarchive : IconArchive, onSelect: () => void toggleArchive(project) },
        { separator: true },
        { label: "Delete project…", icon: IconTrash, danger: true, onSelect: () => void removeProject(project) },
      ]}
    />
  );
}
