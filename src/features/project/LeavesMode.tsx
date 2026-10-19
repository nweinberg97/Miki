import type { Project } from "../../data/types";
import { setQuery } from "../../lib/router";
import { Segmented } from "../../ui/ui";
import { BoardMode } from "../board/BoardMode";
import { CaptureWorkspace } from "../capture/CaptureWorkspace";
import { MikiAsks } from "./MikiAsks";
import { partPath } from "./modes";

/** 葉 Leaves — ideas. Everything captured, and the storyboard where ideas spread out and find each other. */
export function LeavesMode({ project, query }: { project: Project; query: URLSearchParams }) {
  const view = query.get("view") === "storyboard" || (query.get("card") && query.get("view") !== "list") ? "storyboard" : "list";
  return (
    <div className={`part-body leaves leaves-${view}`}>
      <div className="part-subnav">
        <Segmented
          size="sm"
          label="Leaves"
          value={view}
          onChange={(v) => setQuery({ view: v, card: null, note: null, rec: null, tr: null, hl: null })}
          options={[
            { value: "list", label: "Captured" },
            { value: "storyboard", label: "Storyboard" },
          ]}
        />
        <span className="part-subnav-hint">
          {view === "list" ? "Everything you've written or spoken. Put the promising ones on the storyboard." : "Spread ideas out, cluster them, connect them. Carry the strongest onto the trunk."}
        </span>
      </div>
      {view === "list" ? (
        <CaptureWorkspace projectId={project.id} project={project} query={query} basePath={partPath(project.id, "leaves")} intro={<MikiAsks project={project} part="leaves" />} />
      ) : (
        <BoardMode project={project} kind="ideas" query={query} />
      )}
    </div>
  );
}
