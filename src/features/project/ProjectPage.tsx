import { useEffect, useState } from "react";
import { useRecord } from "../../data/hooks";
import { touchProject, updateProject } from "../../data/repo";
import { projectTemplate } from "../../data/templates";
import type { Part, Project } from "../../data/types";
import { href, navigate } from "../../lib/router";
import { ui } from "../../lib/store";
import { cx, isTypingTarget } from "../../lib/util";
import { IconArchive, IconChevronLeft, IconDevice, IconDownload, IconMore, IconPencil, IconTrash, IconUnarchive, IconFileDown } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { PartGlyph } from "../../ui/PartGlyph";
import { toastError } from "../../ui/toast";
import { Badge, Button, EmptyState, IconButton, InlineEdit, Spinner } from "../../ui/ui";
import { PARTS, partPath, toPart } from "./modes";
import { exportBackup, removeProject, renameProject, toggleArchive } from "./projectActions";
import { RootsMode } from "./RootsMode";
import { TrunkMode } from "./TrunkMode";
import { MikiAsks } from "./MikiAsks";
import { CaptureWorkspace } from "../capture/CaptureWorkspace";
import { ManuscriptExportDialog } from "../write/ManuscriptExportDialog";
import "./project.css";

export function ProjectPage({ projectId, mode: rawMode, query }: { projectId: string; mode?: string; query: URLSearchParams }) {
  const { data: project, loading } = useRecord("projects", projectId);
  const part: Part = toPart(rawMode, project ?? undefined);
  const focusMode = ui.use((s) => s.focusMode);
  const [manuscriptOpen, setManuscriptOpen] = useState(false);

  // Remember where the writer was, so the grove can offer to resume.
  const entityId = query.get("doc") ?? undefined;
  useEffect(() => {
    if (project) void touchProject(project.id, { mode: part, entityId: part === "trunk" ? entityId : undefined }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, part, entityId]);

  useEffect(() => {
    if (project) document.title = `${project.title} · Miki`;
    return () => {
      document.title = "Miki";
    };
  }, [project?.title, project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector("dialog[open]")) return;
      const p = PARTS.find((x) => x.key === e.key);
      if (p) {
        e.preventDefault();
        navigate(partPath(projectId, p.part));
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
          title="This tree isn't here"
          actions={
            <Button variant="primary" onClick={() => navigate("/")}>
              Back to the grove
            </Button>
          }
        >
          It may have been deleted, or it lives in a different browser. Miki keeps work on the device where it was written.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={cx("project", `project-part-${part}`, focusMode && "is-focus")}>
      {!focusMode && (
        <header className="project-header">
          <div className="project-header-row">
            <a href="#/" className="project-back" aria-label="Back to the grove">
              <IconChevronLeft size={16} aria-hidden />
              <span>Grove</span>
            </a>
            <div className="project-title-wrap">
              <InlineEdit label="Project title" className="project-title" value={project.title} onCommit={(title) => void updateProject(project.id, { title }).catch(toastError)} />
              {project.isSample && (
                <Badge tone="warm" className="project-sample-badge">
                  Sample
                </Badge>
              )}
              {project.archived && <Badge>Resting</Badge>}
            </div>
            <div className="project-header-actions">
              <a className="storage-pill" href="#/settings" title="Your work is saved in this browser. Nothing is uploaded. Click for storage and backups.">
                <IconDevice size={13} aria-hidden />
                <span>On this device</span>
              </a>
              <ProjectMenu project={project} onManuscript={() => setManuscriptOpen(true)} />
            </div>
          </div>
          <nav className="part-tabs" aria-label="The three parts of this project">
            {PARTS.map((p) => (
              <a
                key={p.part}
                href={href(partPath(project.id, p.part))}
                className={cx("part-tab", `part-tab-${p.part}`, part === p.part && "is-active")}
                aria-current={part === p.part ? "page" : undefined}
                title={`${p.line} (${p.key})`}
              >
                <PartGlyph part={p.part} size={30} className="part-tab-glyph" />
                <span className="part-tab-kanji" aria-hidden>
                  {p.kanji}
                </span>
                <span className="part-tab-text">
                  <span className="part-tab-label">{p.label}</span>
                  <span className="part-tab-principle">{p.principle}</span>
                </span>
              </a>
            ))}
          </nav>
        </header>
      )}
      <div className="project-body">
        <PartView project={project} part={part} query={query} />
      </div>
      <ManuscriptExportDialog open={manuscriptOpen} onClose={() => setManuscriptOpen(false)} project={project} />
    </div>
  );
}

function PartView({ project, part, query }: { project: Project; part: Part; query: URLSearchParams }) {
  switch (part) {
    case "roots":
      return <RootsMode project={project} query={query} />;
    case "trunk":
      return <TrunkMode project={project} query={query} />;
    default:
      return (
        <div className="part-body leaves">
          <CaptureWorkspace projectId={project.id} project={project} query={query} basePath={partPath(project.id, "leaves")} intro={<MikiAsks project={project} part="leaves" />} />
        </div>
      );
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
        { label: project.archived ? "Wake it up" : "Let it rest (archive)", icon: project.archived ? IconUnarchive : IconArchive, onSelect: () => void toggleArchive(project) },
        { separator: true },
        { label: "Delete project…", icon: IconTrash, danger: true, onSelect: () => void removeProject(project) },
      ]}
    />
  );
}
