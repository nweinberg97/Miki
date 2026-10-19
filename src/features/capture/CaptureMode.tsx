import type { Project } from "../../data/types";
import { projectPath } from "../../lib/router";
import { CaptureWorkspace } from "./CaptureWorkspace";

export function CaptureMode({ project, query }: { project: Project; query: URLSearchParams }) {
  return <CaptureWorkspace projectId={project.id} project={project} query={query} basePath={projectPath(project.id, "capture")} />;
}
