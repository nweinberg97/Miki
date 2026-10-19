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
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setDescription("");
      setBusy(false);
    }
  }, [open, initialTitle]);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const { project } = await createProject({ title, type, description });
      onClose();
      navigate(projectPath(project.id));
    } catch (e) {
      toastError(e, "Couldn't create the project.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start a project"
      description="Pick a shape to begin with. You can change everything later."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-project" disabled={!title.trim()} busy={busy}>
            Create project
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
          <legend className="field-label">What is it, roughly?</legend>
          <div className="type-grid">
            {PROJECT_TEMPLATES.map((t) => (
              <label key={t.type} className={cx("type-option", type === t.type && "is-selected")}>
                <input type="radio" name="project-type" value={t.type} checked={type === t.type} onChange={() => setType(t.type)} className="sr-only" />
                <span className="type-option-label">{t.label}</span>
                <span className="type-option-blurb">{t.blurb}</span>
                <span className="type-option-detail">
                  {t.structureSections.length ? `${t.structureLabel}: ${t.structureSections.join(" · ")}` : "No starting structure"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="A line about it" hint="Optional. What you're circling around, in your own words." htmlFor="np-desc">
          <TextInput id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="An essay about attention and speed." />
        </Field>
      </form>
    </Dialog>
  );
}
