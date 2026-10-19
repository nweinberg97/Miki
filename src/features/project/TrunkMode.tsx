import { updateProject } from "../../data/repo";
import type { Project } from "../../data/types";
import { setQuery } from "../../lib/router";
import { toastError } from "../../ui/toast";
import { InlineEdit, Segmented } from "../../ui/ui";
import { BoardMode } from "../board/BoardMode";
import { ChoicesView } from "../discern/ChoicesView";
import { WriteMode } from "../write/WriteMode";
import { MikiAsks } from "./MikiAsks";

export type TrunkView = "shape" | "draft" | "choices";

export function trunkView(query: URLSearchParams): TrunkView {
  const v = query.get("view");
  if (v === "shape" || v === "draft" || v === "choices") return v;
  if (query.get("doc")) return "draft";
  if (query.get("decision")) return "choices";
  return "shape";
}

/** 幹 Trunk — discernment. The thread, what you chose to carry (in order), your choices, and the draft. */
export function TrunkMode({ project, query }: { project: Project; query: URLSearchParams }) {
  const view = trunkView(query);
  return (
    <div className={`part-body trunk trunk-${view}`}>
      <div className="part-subnav">
        <Segmented
          size="sm"
          label="Trunk"
          value={view}
          onChange={(v) => setQuery({ view: v, card: null, decision: null, doc: v === "draft" ? query.get("doc") : null })}
          options={[
            { value: "shape", label: "Shape" },
            { value: "draft", label: "Draft" },
            { value: "choices", label: "Choices" },
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
        {view === "shape" ? <BoardMode project={project} kind="structure" query={query} /> : view === "draft" ? <WriteMode project={project} query={query} /> : <ChoicesView project={project} query={query} />}
      </div>
    </div>
  );
}
