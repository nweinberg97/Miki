import { useMemo } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { addStep, createDecision, createProcess, deleteProcess, saveProcessAsTemplate, updateProcess } from "../../data/repo";
import { BUILT_IN_PROCESSES } from "../../data/templates";
import type { Decision, Process, ProcessTemplate, Project, Step } from "../../data/types";
import { href, projectPath, setQuery } from "../../lib/router";
import { useIsNarrow } from "../../lib/useMedia";
import { cx, truncate } from "../../lib/util";
import { promptDialog } from "../../ui/Dialog";
import { IconArrowLeft, IconBookmark, IconCircleCheck, IconCircleDashed, IconMore, IconPencil, IconPlus, IconSignpost, IconSkip, IconTrash, IconWorkflow } from "../../ui/icons";
import { Menu, type MenuItem } from "../../ui/Menu";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Button, EmptyState, IconButton } from "../../ui/ui";
import { DecisionEditor } from "./DecisionEditor";
import { StepDetail } from "./StepDetail";
import "./discern.css";

async function loadDiscern(projectId: string) {
  const [processes, steps, decisions, links, templates] = await Promise.all([
    db.byIndex("processes", "projectId", projectId),
    db.byIndex("steps", "projectId", projectId),
    db.byIndex("decisions", "projectId", projectId),
    db.byIndex("links", "projectId", projectId),
    db.getAll("templates"),
  ]);
  return { processes: processes.sort((a, b) => a.createdAt - b.createdAt), steps, decisions, links, templates };
}

/** Discern: an optional, lightweight process for moments when structure helps. */
export function DiscernMode({ project, query }: { project: Project; query: URLSearchParams }) {
  const { data } = useLive(() => loadDiscern(project.id), [project.id], ["processes", "steps", "decisions", "links", "templates"]);
  const narrow = useIsNarrow();
  const stepId = query.get("step");
  const decisionId = query.get("decision");
  const processId = query.get("process");

  const step = data?.steps.find((s) => s.id === stepId);
  const process: Process | undefined = data
    ? (data.processes.find((p) => p.id === (step?.processId ?? processId)) ?? data.processes[data.processes.length - 1])
    : undefined;
  const steps = useMemo(() => (data && process ? data.steps.filter((s) => s.processId === process.id).sort((a, b) => a.order - b.order) : []), [data, process]);
  const decision = data?.decisions.find((d) => d.id === decisionId);
  const activeStep = step ?? (!decision ? (steps.find((s) => s.status === "open") ?? steps[0]) : undefined);

  if (!data) return <div className="discern" aria-busy />;

  const startProcess = async (tpl: Pick<ProcessTemplate, "id" | "name" | "steps"> | null) => {
    try {
      let title: string | undefined;
      if (!tpl) {
        const t = await promptDialog({ title: "A new process", label: "What are you working through?", placeholder: "e.g. Decide the ending", confirmLabel: "Start" });
        if (!t) return;
        title = t;
      }
      const p = await createProcess(project.id, tpl, title);
      if (!tpl) await addStep(p.id, { title: "Define the question", objective: "Say what you're trying to figure out.", prompt: "What would be different once this is resolved?", context: "none" });
      setQuery({ process: p.id, step: null, decision: null });
    } catch (e) {
      toastError(e);
    }
  };
  const newDecision = async () => {
    try {
      const d = await createDecision(project.id);
      setQuery({ decision: d.id, step: null });
    } catch (e) {
      toastError(e);
    }
  };

  const templateItems = (): MenuItem[] => [
    { heading: "Start from" },
    ...BUILT_IN_PROCESSES.map((t) => ({ label: `${t.name} — ${t.steps.length} steps`, icon: IconWorkflow, onSelect: () => void startProcess(t) })),
    ...(data.templates.length ? [{ separator: true } as const, { heading: "Your templates" }] : []),
    ...data.templates.map((t) => ({ label: `${t.name} — ${t.steps.length} steps`, icon: IconBookmark, onSelect: () => void startProcess(t) })),
    { separator: true },
    { label: "A blank process", icon: IconPlus, onSelect: () => void startProcess(null) },
  ];

  const openDecisions = data.decisions.filter((d) => d.status === "open").sort((a, b) => b.updatedAt - a.updatedAt);
  const decided = data.decisions.filter((d) => d.status === "decided").sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  const showDetail = Boolean(activeStep || decision);
  const hideNav = narrow && (stepId || decisionId);

  return (
    <div className="discern">
      {!hideNav && (
        <aside className="discern-nav" aria-label="Process and decisions">
          {process ? (
            <>
              <div className="discern-nav-head">
                <div className="grow">
                  <p className="eyebrow">Process</p>
                  <h2 className="discern-process-title">{process.title}</h2>
                </div>
                <ProcessMenu process={process} templateItems={templateItems} hasMany={data.processes.length > 1} processes={data.processes} />
              </div>
              <Progress steps={steps} />
              <ol className="step-list" role="list">
                {steps.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={href(projectPath(project.id, "discern"), { step: s.id })}
                      className={cx("step-row", activeStep?.id === s.id && "is-active", `is-${s.status}`)}
                      aria-current={activeStep?.id === s.id ? "step" : undefined}
                    >
                      <span className="step-icon" aria-hidden>
                        {s.status === "done" ? <IconCircleCheck size={17} /> : s.status === "skipped" ? <IconSkip size={15} /> : <IconCircleDashed size={17} />}
                      </span>
                      <span className="grow">
                        <span className="step-row-title">
                          <span className="step-num">{i + 1}.</span> {s.title}
                        </span>
                        {s.response && <span className="step-row-meta">{truncate(s.response, 60)}</span>}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
              <Button size="sm" variant="ghost" icon={IconPlus} onClick={() => void addStep(process.id).then((s) => setQuery({ step: s.id, decision: null })).catch(toastError)}>
                Add a step
              </Button>
            </>
          ) : (
            <div className="discern-start">
              <h2 className="section-title">Work through it, one step at a time</h2>
              <p className="muted small">When a piece feels tangled, a short sequence of questions helps. Entirely optional — skip, reorder, or rename any step.</p>
              <Menu label="Start a process" align="start" trigger={(t) => <Button {...t} variant="primary" size="sm" icon={IconWorkflow}>Start a process</Button>} items={templateItems} />
            </div>
          )}

          <div className="discern-decisions">
            <div className="discern-nav-head">
              <h2 className="eyebrow grow">Decisions</h2>
              <IconButton icon={IconPlus} label="New decision" size="sm" onClick={() => void newDecision()} />
            </div>
            {data.decisions.length === 0 && <p className="muted small">Record a choice and why you made it. Decisions stay linked to the ideas they affect.</p>}
            <ul role="list" className="decision-list">
              {[...openDecisions, ...decided].map((d) => (
                <DecisionRow key={d.id} d={d} active={d.id === decision?.id} projectId={project.id} />
              ))}
            </ul>
          </div>
        </aside>
      )}
      <section className="discern-main scroll-y">
        {narrow && (stepId || decisionId) && (
          <button type="button" className="capture-back" onClick={() => setQuery({ step: null, decision: null })}>
            <IconArrowLeft size={16} aria-hidden /> Steps and decisions
          </button>
        )}
        {decision ? (
          <div className="discern-detail">
            <DecisionEditor key={decision.id} decision={decision} project={project} links={data.links} onDeleted={() => setQuery({ decision: null })} />
          </div>
        ) : activeStep && process ? (
          <StepDetail key={activeStep.id} step={activeStep} steps={steps} process={process} project={project} decisions={data.decisions} links={data.links} />
        ) : !showDetail ? (
          <EmptyState
            icon={IconSignpost}
            title="Find the thread, then follow it"
            actions={
              <>
                <Menu label="Start a process" align="start" trigger={(t) => <Button {...t} variant="primary" icon={IconWorkflow}>Start a process</Button>} items={templateItems} />
                <Button icon={IconSignpost} onClick={() => void newDecision()}>
                  Record a decision
                </Button>
              </>
            }
          >
            Discern is for the moments that need deliberate thinking: what this piece is really about, which direction to take, and why. You can ignore it entirely and still write.
          </EmptyState>
        ) : null}
      </section>
    </div>
  );
}

function Progress({ steps }: { steps: Step[] }) {
  const done = steps.filter((s) => s.status !== "open").length;
  return (
    <div className="progress" aria-label={`${done} of ${steps.length} steps settled`}>
      {steps.map((s) => (
        <span key={s.id} className={cx("progress-seg", `is-${s.status}`)} />
      ))}
    </div>
  );
}

function DecisionRow({ d, active, projectId }: { d: Decision; active: boolean; projectId: string }) {
  const chosen = d.options.find((o) => o.id === d.chosenOptionId);
  return (
    <li>
      <a className={cx("step-row", active && "is-active", d.status === "decided" ? "is-done" : "is-open")} href={href(projectPath(projectId, "discern"), { decision: d.id })}>
        <span className="step-icon" aria-hidden>
          {d.status === "decided" ? <IconCircleCheck size={17} /> : <IconSignpost size={16} />}
        </span>
        <span className="grow">
          <span className="step-row-title">{d.question || "Untitled decision"}</span>
          <span className="step-row-meta">{d.status === "decided" ? (chosen ? `→ ${truncate(chosen.text, 50)}` : "Decided") : "Open"}</span>
        </span>
      </a>
    </li>
  );
}

function ProcessMenu({ process, templateItems, hasMany, processes }: { process: Process; templateItems: () => MenuItem[]; hasMany: boolean; processes: Process[] }) {
  const items = (): MenuItem[] => [
    ...(hasMany ? [{ heading: "Switch to" } as MenuItem, ...processes.map((p) => ({ label: p.title, checked: p.id === process.id, onSelect: () => setQuery({ process: p.id, step: null, decision: null }) }))] : []),
    ...(hasMany ? [{ separator: true } as const] : []),
    {
      label: "Rename",
      icon: IconPencil,
      onSelect: async () => {
        const title = await promptDialog({ title: "Rename process", label: "Name", initial: process.title });
        if (title) await updateProcess(process.id, { title }).catch(toastError);
      },
    },
    {
      label: "Save as a template",
      icon: IconBookmark,
      onSelect: async () => {
        const name = await promptDialog({ title: "Save as a template", label: "Template name", initial: process.title, confirmLabel: "Save template" });
        if (!name) return;
        await saveProcessAsTemplate(process.id, name, "")
          .then(() => toast("Saved. It's available whenever you start a process."))
          .catch(toastError);
      },
    },
    { separator: true },
    ...templateItems().map((i) => ("heading" in i && i.heading === "Start from" ? { heading: "Start another process" } : i)),
    { separator: true },
    {
      label: "Delete this process",
      icon: IconTrash,
      danger: true,
      onSelect: () =>
        void deleteProcess(process.id)
          .then((restore) => {
            setQuery({ process: null, step: null });
            toastUndo("Process deleted. Decisions you recorded are kept.", restore);
          })
          .catch(toastError),
    },
  ];
  return <Menu label="Process actions" trigger={(t) => <IconButton {...t} icon={IconMore} label="Process actions" size="sm" />} items={items} />;
}
