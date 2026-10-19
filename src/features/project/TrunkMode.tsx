import { updateProject } from "../../data/repo";
import type { Project } from "../../data/types";
import { setQuery } from "../../lib/router";
import { toastError } from "../../ui/toast";
import { InlineEdit, Segmented } from "../../ui/ui";
import { BoardMode } from "../board/BoardMode";
import { DiscernMode } from "../discern/DiscernMode";
import { WriteMode } from "../write/WriteMode";
import { MikiAsks } from "./MikiAsks";

export type TrunkView = "shape" | "draft" | "discern";

export function trunkView(query: URLSearchParams): TrunkView {
  const v = query.get("view");
  if (v === "shape" || v === "draft" || v === "discern") return v;
  if (v === "choices") return "discern";
  if (query.get("doc")) return "draft";
  if (query.get("decision") || query.get("step") || query.get("process")) return "discern";
  return "shape";
}

/** 幹 Trunk — discernment. The thread, the shape you give the work, the draft, and the choices that hold it up. */
export function TrunkMode({ project, query }: { project: Project; query: URLSearchParams }) {
  const view = trunkView(query);
  return (
    <div className={`part-body trunk trunk-${view}`}>
      <div className="part-subnav">
        <Segmented
          size="sm"
          label="Trunk"
          value={view}
          onChange={(v) => setQuery({ view: v, card: null, decision: null, step: null, process: null, doc: v === "draft" ? query.get("doc") : null })}
          options={[
            { value: "shape", label: "Shape" },
            { value: "draft", label: "Draft" },
            { value: "discern", label: "Discern" },
          ]}
        />
        <div className="trunk-thread">
          <span className="trunk-thread-label">Thread</span>
          <InlineEdit
            label="The thread"
            className="trunk-thread-text"
            value={project.thread}
            placeholder="What is this really about? One sentence."
            onCommit={(thread) => void updateProject(project.id, { thread }).catch(toastError)}
          />
        </div>
      </div>
      {view === "shape" && <MikiAsks project={project} part="trunk" />}
      <div className="trunk-view">
        {view === "shape" ? <BoardMode project={project} kind="structure" query={query} /> : view === "draft" ? <WriteMode project={project} query={query} /> : <DiscernMode project={project} query={query} />}
      </div>
    </div>
  );
}
