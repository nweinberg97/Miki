import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { createDecision } from "../../data/repo";
import type { Decision, Project } from "../../data/types";
import { href, setQuery } from "../../lib/router";
import { useIsNarrow } from "../../lib/useMedia";
import { cx, truncate } from "../../lib/util";
import { IconArrowLeft, IconCircleCheck, IconPlus, IconSignpost } from "../../ui/icons";
import { toastError } from "../../ui/toast";
import { Button, EmptyState } from "../../ui/ui";
import { partPath } from "../project/modes";
import { DecisionEditor } from "./DecisionEditor";
import "./discern.css";

/** The choices that shaped the trunk — what you weighed, what you chose, and why. */
export function ChoicesView({ project, query }: { project: Project; query: URLSearchParams }) {
  const { data } = useLive(
    async () => {
      const [decisions, links] = await Promise.all([db.byIndex("decisions", "projectId", project.id), db.byIndex("links", "projectId", project.id)]);
      return { decisions, links };
    },
    [project.id],
    ["decisions", "links"],
  );
  const narrow = useIsNarrow();
  const decisionId = query.get("decision");
  if (!data) return <div className="discern" aria-busy />;
  const open = data.decisions.filter((d) => d.status === "open").sort((a, b) => b.updatedAt - a.updatedAt);
  const decided = data.decisions.filter((d) => d.status === "decided").sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  const decision = data.decisions.find((d) => d.id === decisionId) ?? (narrow ? undefined : (open[0] ?? decided[0]));

  const add = async () => {
    try {
      const d = await createDecision(project.id);
      setQuery({ view: "choices", decision: d.id });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="discern">
      {!(narrow && decision) && (
        <aside className="discern-nav" aria-label="Choices">
          <div className="discern-decisions">
            <div className="discern-nav-head">
              <h2 className="eyebrow grow">Choices</h2>
              <Button size="sm" variant="ghost" icon={IconPlus} onClick={() => void add()}>
                New
              </Button>
            </div>
            {data.decisions.length === 0 && <p className="muted small">When you're torn between directions, write them down here, choose one, and say why. The reasons stay with the work.</p>}
            {open.length > 0 && <h3 className="material-group">Still open</h3>}
            <ul role="list" className="decision-list">
              {open.map((d) => (
                <Row key={d.id} d={d} active={d.id === decision?.id} projectId={project.id} />
              ))}
            </ul>
            {decided.length > 0 && <h3 className="material-group">Chosen</h3>}
            <ul role="list" className="decision-list">
              {decided.map((d) => (
                <Row key={d.id} d={d} active={d.id === decision?.id} projectId={project.id} />
              ))}
            </ul>
          </div>
        </aside>
      )}
      <section className="discern-main scroll-y">
        {narrow && decision && (
          <button type="button" className="capture-back" onClick={() => setQuery({ decision: null })}>
            <IconArrowLeft size={16} aria-hidden /> All choices
          </button>
        )}
        {decision ? (
          <div className="discern-detail">
            <DecisionEditor key={decision.id} decision={decision} project={project} links={data.links} onDeleted={() => setQuery({ decision: null })} />
          </div>
        ) : (
          <EmptyState
            icon={IconSignpost}
            title="Discernment is choosing"
            actions={
              <Button variant="primary" icon={IconPlus} onClick={() => void add()}>
                Weigh a choice
              </Button>
            }
          >
            Which ending? Which argument leads? Lay out the directions, pick one, and keep a sentence on why — so the trunk stands on reasons, not moods.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function Row({ d, active, projectId }: { d: Decision; active: boolean; projectId: string }) {
  const chosen = d.options.find((o) => o.id === d.chosenOptionId);
  return (
    <li>
      <a className={cx("step-row", active && "is-active", d.status === "decided" ? "is-done" : "is-open")} href={href(partPath(projectId, "trunk"), { view: "choices", decision: d.id })}>
        <span className="step-icon" aria-hidden>
          {d.status === "decided" ? <IconCircleCheck size={17} /> : <IconSignpost size={16} />}
        </span>
        <span className="grow">
          <span className="step-row-title">{d.question || "Untitled choice"}</span>
          <span className="step-row-meta">{d.status === "decided" ? (chosen ? `→ ${truncate(chosen.text, 50)}` : "Chosen") : "Open"}</span>
        </span>
      </a>
    </li>
  );
}
