import { useState } from "react";
import { addLink, deleteDecision, removeLink, updateDecision, updateDecisionOption, updateProject } from "../../data/repo";
import type { Decision, Link, Project } from "../../data/types";
import { useAutoField } from "../../lib/useAutoField";
import { cx, uid } from "../../lib/util";
import { IconCircleCheck, IconLink, IconPlus, IconRestore, IconSprout, IconTrash, IconX } from "../../ui/icons";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Badge, Button, IconButton, InlineEdit, TextArea } from "../../ui/ui";
import { EntityChip, EntityPicker, linksFor, useProjectEntities } from "../shared/entities";

/** A decision is more than a checkbox: the question, the options, the choice, and why. */
export function DecisionEditor({ decision, project, links, compact, onDeleted }: { decision: Decision; project: Project; links: Link[]; compact?: boolean; onDeleted?: () => void }) {
  const [picker, setPicker] = useState(false);
  const { data: entities } = useProjectEntities(project.id);
  const save = (patch: Partial<Decision>) => updateDecision(decision.id, patch).catch(toastError);
  const rationale = useAutoField(decision.rationale, (v) => save({ rationale: v }));
  const tradeoffs = useAutoField(decision.tradeoffs, (v) => save({ tradeoffs: v }));
  const next = useAutoField(decision.next, (v) => save({ next: v }));
  const chosen = decision.options.find((o) => o.id === decision.chosenOptionId);
  const related = linksFor(links, { type: "decision", id: decision.id });
  const isThread = project.threadSource?.type === "decision" && project.threadSource.id === decision.id;

  const setOption = (id: string, patch: Partial<{ text: string; note: string }>) => updateDecisionOption(decision.id, id, patch).catch(toastError);

  return (
    <div className={cx("decision", compact && "is-compact", decision.status === "decided" && "is-decided")}>
      <div className="decision-head">
        <span className="eyebrow">Decision</span>
        {decision.status === "decided" ? <Badge tone="moss">Decided</Badge> : <Badge tone="warm">Open</Badge>}
      </div>
      <InlineEdit label="The question being decided" className="decision-question" value={decision.question} placeholder="What are you deciding?" multiline onCommit={(question) => void save({ question })} />

      <fieldset className="options">
        <legend className="decision-label">Directions you're weighing</legend>
        {decision.options.map((o, i) => (
          <div key={o.id} className={cx("option", decision.chosenOptionId === o.id && "is-chosen")}>
            <input
              type="radio"
              name={`choice-${decision.id}`}
              aria-label={`Choose option ${i + 1}`}
              checked={decision.chosenOptionId === o.id}
              onChange={() => void save({ chosenOptionId: o.id })}
            />
            <div className="grow option-fields">
              <OptionText value={o.text} placeholder={`Option ${i + 1}`} onSave={(text) => setOption(o.id, { text })} className="option-text" label={`Option ${i + 1}`} />
              <OptionText value={o.note} placeholder="What's appealing or worrying about it?" onSave={(note) => setOption(o.id, { note })} className="option-note" label={`Notes on option ${i + 1}`} />
            </div>
            {decision.options.length > 1 && (
              <IconButton
                icon={IconX}
                size="sm"
                label={`Remove option ${i + 1}`}
                onClick={() => void save({ options: decision.options.filter((x) => x.id !== o.id), chosenOptionId: decision.chosenOptionId === o.id ? null : decision.chosenOptionId })}
              />
            )}
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={IconPlus} onClick={() => void save({ options: [...decision.options, { id: uid(), text: "", note: "" }] })}>
          Add a direction
        </Button>
      </fieldset>

      <label className="decision-label" htmlFor={`why-${decision.id}`}>
        Why this direction{chosen?.text ? ` — “${chosen.text}”` : ""}?
      </label>
      <TextArea id={`why-${decision.id}`} minRows={2} className="decision-text" value={rationale.text} onChange={(e) => rationale.onChange(e.target.value)} onBlur={rationale.onBlur} placeholder="A sentence is enough. Future you will be glad you wrote it." />

      {!compact || decision.tradeoffs || decision.next ? (
        <div className="decision-grid">
          <div>
            <label className="decision-label" htmlFor={`trade-${decision.id}`}>
              Trade-offs and uncertainties
            </label>
            <TextArea id={`trade-${decision.id}`} minRows={2} className="decision-text" value={tradeoffs.text} onChange={(e) => tradeoffs.onChange(e.target.value)} onBlur={tradeoffs.onBlur} placeholder="What are you choosing not to do?" />
          </div>
          <div>
            <label className="decision-label" htmlFor={`next-${decision.id}`}>
              What this makes possible
            </label>
            <TextArea id={`next-${decision.id}`} minRows={2} className="decision-text" value={next.text} onChange={(e) => next.onChange(e.target.value)} onBlur={next.onBlur} placeholder="The next move, now that this is settled." />
          </div>
        </div>
      ) : null}

      <div className="decision-links">
        <span className="decision-label">Connected to</span>
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

      <div className="decision-actions">
        {decision.status === "open" ? (
          <Button
            variant="primary"
            size="sm"
            icon={IconCircleCheck}
            onClick={() => {
              rationale.flush();
              void save({ status: "decided" }).then(() => toast(chosen ? `Decided: “${chosen.text || "your choice"}”.` : "Marked as decided."));
            }}
          >
            {chosen ? "Settle on this" : "Mark decided"}
          </Button>
        ) : (
          <Button size="sm" icon={IconRestore} onClick={() => void save({ status: "open" })}>
            Reopen
          </Button>
        )}
        {chosen?.text && !isThread && (
          <Button
            size="sm"
            variant="ghost"
            icon={IconSprout}
            onClick={() => void updateProject(project.id, { thread: chosen.text, threadSource: { type: "decision", id: decision.id } }).then(() => toast("Set as the project's thread.")).catch(toastError)}
          >
            Make this the thread
          </Button>
        )}
        {isThread && <span className="muted small">This is the project's thread.</span>}
        <span className="grow" />
        <Button
          size="sm"
          variant="ghost"
          icon={IconTrash}
          className="danger-text"
          onClick={() =>
            void deleteDecision(decision.id)
              .then((restore) => {
                onDeleted?.();
                toastUndo("Decision deleted.", restore);
              })
              .catch(toastError)
          }
        >
          Delete
        </Button>
      </div>
      <EntityPicker
        open={picker}
        onClose={() => setPicker(false)}
        projectId={project.id}
        title="Connect this decision"
        exclude={[`decision:${decision.id}`, ...related.map((r) => `${r.other.type}:${r.other.id}`)]}
        onPick={(ref) => void addLink(project.id, { type: "decision", id: decision.id }, ref, "related").catch(toastError)}
      />
    </div>
  );
}

function OptionText({ value, onSave, placeholder, className, label }: { value: string; onSave: (v: string) => Promise<unknown>; placeholder: string; className: string; label: string }) {
  const f = useAutoField(value, onSave);
  return <input className={className} value={f.text} placeholder={placeholder} aria-label={label} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur} />;
}
