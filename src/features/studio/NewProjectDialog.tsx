import { useEffect, useState } from "react";
import { createProject } from "../../data/repo";
import { PROJECT_TEMPLATES } from "../../data/templates";
import type { ProjectType } from "../../data/types";
import { navigate, projectPath } from "../../lib/router";
import { cx } from "../../lib/util";
import { Dialog } from "../../ui/Dialog";
import { toastError } from "../../ui/toast";
import { Button, Field, TextInput } from "../../ui/ui";

export function NewProjectDialog({ open, onClose, initialTitle = "" }: { open: boolean; onClose: () => void; initialTitle?: string }) {
  const [title, setTitle] = useState(initialTitle);
  const [type, setType] = useState<ProjectType>("essay");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setPurpose("");
      setBusy(false);
    }
  }, [open, initialTitle]);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const { project } = await createProject({ title, type, purpose });
      onClose();
      navigate(projectPath(project.id, purpose.trim() ? "leaves" : "roots"));
    } catch (e) {
      toastError(e, "Couldn't create the project.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Plant a new tree"
      description="Every piece starts in the ground: what it is, and why. You can change all of it later."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-project" disabled={!title.trim()} busy={busy}>
            Plant it
          </Button>
        </>
      }
    >
      <form
        id="new-project"
        className="stack gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Working title" htmlFor="np-title">
          <TextInput id="np-title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Case for Slowing Down" autoComplete="off" />
        </Field>
        <fieldset className="type-picker">
          <legend className="field-label">What kind of tree?</legend>
          <div className="type-grid">
            {PROJECT_TEMPLATES.map((t) => (
              <label key={t.type} className={cx("type-option", type === t.type && "is-selected")}>
                <input type="radio" name="project-type" value={t.type} checked={type === t.type} onChange={() => setType(t.type)} className="sr-only" />
                <span className="type-option-label">{t.label}</span>
                <span className="type-option-blurb">{t.blurb}</span>
                <span className="type-option-detail">
                  {t.structureSections.length ? `Trunk: ${t.structureSections.join(" · ")}` : "A bare trunk — shape it yourself"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Why are you writing it?" hint="One sentence of purpose — the root everything else grows from. Optional for now." htmlFor="np-purpose">
          <TextInput id="np-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="To convince busy friends that slowness isn't laziness." autoComplete="off" />
        </Field>
      </form>
    </Dialog>
  );
}
