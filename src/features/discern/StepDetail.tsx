import { useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { addLink, addStep, createDecision, deleteStep, removeLink, reorderSteps, updateStep } from "../../data/repo";
import type { Decision, Link, Process, Project, Step, StepContext } from "../../data/types";
import { href, projectPath, setQuery } from "../../lib/router";
import { useAutoField } from "../../lib/useAutoField";
import { byOrder, plural, relativeTime, truncate } from "../../lib/util";
import { IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp, IconCircleCheck, IconLink, IconMore, IconPlus, IconQuestion, IconRestore, IconSignpost, IconSkip, IconTrash } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toastError, toastUndo } from "../../ui/toast";
import { Button, IconButton, InlineEdit, TextArea } from "../../ui/ui";
import { EntityChip, EntityPicker, linksFor, useProjectEntities } from "../shared/entities";
import { DecisionEditor } from "./DecisionEditor";
import { orderStructure } from "../board/structureDoc";

const CONTEXTS: { value: StepContext; label: string }[] = [
  { value: "none", label: "No particular material" },
  { value: "notes", label: "Notes and captures" },
  { value: "ideas", label: "Idea space" },
  { value: "structure", label: "Structure" },
  { value: "draft", label: "Drafts" },
  { value: "decision", label: "A decision" },
  { value: "references", label: "References" },
];

export function StepDetail({ step, steps, process, project, decisions, links }: { step: Step; steps: Step[]; process: Process; project: Project; decisions: Decision[]; links: Link[] }) {
  const response = useAutoField(step.response, (response) => updateStep(step.id, { response }).catch(toastError));
  const [picker, setPicker] = useState(false);
  const [editPrompt, setEditPrompt] = useState(false);
  const { data: entities } = useProjectEntities(project.id);
  const index = steps.findIndex((s) => s.id === step.id);
  const prev = steps[index - 1];
  const next = steps[index + 1];
  const decision = decisions.find((d) => d.id === step.decisionId);
  const related = linksFor(links, { type: "step", id: step.id });

  const go = (s: Step | undefined) => s && setQuery({ step: s.id, decision: null });
  const move = async (dir: -1 | 1) => {
    const ids = steps.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorderSteps(ids).catch(toastError);
  };
  const setStatus = async (status: Step["status"]) => {
    response.flush();
    await updateStep(step.id, { status }).catch(toastError);
    if (status !== "open" && next) go(next);
  };

  return (
    <div className="discern-detail step-detail">
      <p className="eyebrow">
        Step {index + 1} of {steps.length} · {process.title}
      </p>
      <InlineEdit label="Step title" className="step-title" value={step.title} onCommit={(title) => void updateStep(step.id, { title }).catch(toastError)} />
      <InlineEdit label="What this step is for" className="step-objective" value={step.objective} placeholder="What is this step for?" multiline onCommit={(objective) => void updateStep(step.id, { objective }).catch(toastError)} />

      {(step.prompt || editPrompt) && (
        <div className="step-prompt">
          <IconQuestion size={16} aria-hidden />
          {editPrompt ? (
            <InlineEdit
              autoFocus
              label="Guiding question"
              className="grow"
              multiline
              value={step.prompt}
              placeholder="A question to help you think"
              onCommit={(prompt) => {
                setEditPrompt(false);
                void updateStep(step.id, { prompt }).catch(toastError);
              }}
            />
          ) : (
            <p className="grow" onDoubleClick={() => setEditPrompt(true)}>
              {step.prompt}
            </p>
          )}
        </div>
      )}

      <label className="decision-label" htmlFor={`resp-${step.id}`}>
        Your thinking
      </label>
      <TextArea
        id={`resp-${step.id}`}
        minRows={5}
        className="step-response"
        value={response.text}
        onChange={(e) => response.onChange(e.target.value)}
        onBlur={response.onBlur}
        placeholder="Think out loud. Nothing here needs to be polished — and nothing is required."
      />

      <StepContextPanel step={step} project={project} />

      {step.context === "decision" || decision ? (
        decision ? (
          <DecisionEditor decision={decision} project={project} links={links} compact />
        ) : (
          <button
            type="button"
            className="card-action"
            onClick={() => void createDecision(project.id, { question: step.title, linkTo: { type: "step", id: step.id } }).catch(toastError)}
          >
            <IconSignpost size={15} aria-hidden />
            <span className="grow">Record this as a decision — the options, the choice, and why</span>
            <IconArrowRight size={14} aria-hidden />
          </button>
        )
      ) : null}

      <div className="decision-links">
        <span className="decision-label">Material for this step</span>
        <div className="chip-row">
          {related.map(({ link, other }) => {
            const info = entities?.get(`${other.type}:${other.id}`);
            return info ? <EntityChip key={link.id} projectId={project.id} info={info} onRemove={() => void removeLink(link.id).catch(toastError)} /> : null;
          })}
          <button type="button" className="chip" onClick={() => setPicker(true)}>
            <IconLink size={13} aria-hidden />
            <span>Link material</span>
          </button>
        </div>
      </div>

      <footer className="step-foot">
        <IconButton icon={IconArrowLeft} label={prev ? `Previous: ${prev.title}` : "No previous step"} disabled={!prev} onClick={() => go(prev)} />
        {step.status === "open" ? (
          <>
            <Button variant="primary" icon={IconCircleCheck} onClick={() => void setStatus("done")}>
              Done{next ? " — next step" : ""}
            </Button>
            <Button variant="ghost" icon={IconSkip} onClick={() => void setStatus("skipped")}>
              Skip
            </Button>
          </>
        ) : (
          <Button icon={IconRestore} onClick={() => void setStatus("open")}>
            {step.status === "done" ? `Done ${relativeTime(step.updatedAt)} · Reopen` : "Skipped · Reopen"}
          </Button>
        )}
        <span className="grow" />
        <Menu
          label="Step actions"
          trigger={(t) => <IconButton {...t} icon={IconMore} label="Step actions" />}
          items={[
            { label: "Edit the guiding question", onSelect: () => setEditPrompt(true) },
            { label: "Move up", icon: IconArrowUp, disabled: index === 0, onSelect: () => void move(-1) },
            { label: "Move down", icon: IconArrowDown, disabled: index === steps.length - 1, onSelect: () => void move(1) },
            { label: "Add a step after this", icon: IconPlus, onSelect: () => void addStep(process.id, {}, step.order).then((s) => go(s)).catch(toastError) },
            { separator: true },
            { heading: "Show material from" },
            ...CONTEXTS.map((c) => ({ label: c.label, checked: step.context === c.value, onSelect: () => void updateStep(step.id, { context: c.value }).catch(toastError) })),
            { separator: true },
            {
              label: "Delete step",
              icon: IconTrash,
              danger: true,
              onSelect: () =>
                void deleteStep(step.id)
                  .then((restore) => {
                    setQuery({ step: next?.id ?? prev?.id ?? null });
                    toastUndo("Step deleted.", restore);
                  })
                  .catch(toastError),
            },
          ]}
        />
        <IconButton icon={IconArrowRight} label={next ? `Next: ${next.title}` : "No next step"} disabled={!next} onClick={() => go(next)} />
      </footer>
      <EntityPicker
        open={picker}
        onClose={() => setPicker(false)}
        projectId={project.id}
        title="Link material to this step"
        exclude={[`step:${step.id}`, ...related.map((r) => `${r.other.type}:${r.other.id}`)]}
        onPick={(ref) => void addLink(project.id, { type: "step", id: step.id }, ref, "related").catch(toastError)}
      />
    </div>
  );
}

/** Surfaces what the project already has, so the writer never has to repeat themselves. */
function StepContextPanel({ step, project }: { step: Step; project: Project }) {
  const { data } = useLive(
    async () => {
      if (step.context === "none" || step.context === "decision") return null;
      const id = project.id;
      if (step.context === "notes") {
        const [notes, transcripts] = await Promise.all([db.byIndex("notes", "projectId", id), db.byIndex("transcripts", "projectId", id)]);
        return {
          title: "From your captures",
          link: { to: href(projectPath(id, "capture")), label: "Open Capture" },
          summary: `${plural(notes.length, "note")} · ${plural(transcripts.length, "transcript")}`,
          items: [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((n) => ({ id: n.id, text: n.title || truncate(n.body, 100), to: href(projectPath(id, "capture"), { note: n.id }) })),
        };
      }
      if (step.context === "ideas") {
        const [boards, sections, cards] = await Promise.all([db.byIndex("boards", "projectId", id), db.byIndex("sections", "projectId", id), db.byIndex("cards", "projectId", id)]);
        const ideas = boards.find((b) => b.kind === "ideas");
        const promising = sections.find((s) => s.boardId === ideas?.id && /promising/i.test(s.title));
        const ideaCards = cards.filter((c) => c.boardId === ideas?.id);
        const shown = promising ? ideaCards.filter((c) => c.sectionId === promising.id) : ideaCards;
        return {
          title: promising && shown.length ? "Your promising ideas" : "From your idea space",
          link: { to: href(projectPath(id, "explore")), label: "Open idea space" },
          summary: plural(ideaCards.length, "idea"),
          items: shown.slice(0, 6).map((c) => ({ id: c.id, text: c.title || truncate(c.body, 100), to: href(projectPath(id, "explore"), { card: c.id }) })),
        };
      }
      if (step.context === "structure") {
        const [boards, sections, cards] = await Promise.all([db.byIndex("boards", "projectId", id), db.byIndex("sections", "projectId", id), db.byIndex("cards", "projectId", id)]);
        const structure = boards.find((b) => b.kind === "structure");
        const cols = orderStructure(sections.filter((s) => s.boardId === structure?.id), cards.filter((c) => c.boardId === structure?.id));
        return {
          title: "Your structure so far",
          link: { to: href(projectPath(id, "arrange")), label: "Open structure" },
          summary: `${plural(cols.filter((c) => c.section).length, "section")} · ${plural(cols.reduce((n, c) => n + c.cards.length, 0), "card")}`,
          items: cols.map((c) => ({ id: c.section?.id ?? "none", text: `${c.section?.title ?? "Unplaced"} — ${c.cards.map((x) => x.title || "Untitled").join(" · ") || "empty"}`, to: href(projectPath(id, "arrange")) })),
        };
      }
      if (step.context === "draft") {
        const docs = (await db.byIndex("documents", "projectId", id)).sort(byOrder);
        return {
          title: "Your drafts",
          link: { to: href(projectPath(id, "write")), label: "Open Write" },
          summary: plural(docs.reduce((n, d) => n + d.wordCount, 0), "word"),
          items: docs.map((d) => ({ id: d.id, text: `${d.title} — ${plural(d.wordCount, "word")}`, to: href(projectPath(id, "write"), { doc: d.id }) })),
        };
      }
      const refs = await db.byIndex("references", "projectId", id);
      return {
        title: "Your references",
        link: { to: href(projectPath(id, "reference")), label: "Open references" },
        summary: plural(refs.length, "reference"),
        items: refs.slice(0, 8).map((r) => ({ id: r.id, text: `${r.title}${r.summary ? ` — ${truncate(r.summary, 80)}` : ""}`, to: href(projectPath(id, "reference"), { ref: r.id }) })),
      };
    },
    [step.context, project.id],
    ["notes", "transcripts", "boards", "sections", "cards", "documents", "references"],
  );
  if (!data) return null;
  return (
    <section className="step-context">
      <div className="step-context-head">
        <h3 className="decision-label">{data.title}</h3>
        <span className="muted small">{data.summary}</span>
        <span className="grow" />
        <a className="link-btn small" href={data.link.to}>
          {data.link.label}
        </a>
      </div>
      {data.items.length ? (
        <ul role="list" className="step-context-items">
          {data.items.map((i) => (
            <li key={i.id}>
              <a href={i.to}>{i.text}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing here yet — that's fine.</p>
      )}
    </section>
  );
}

