import { useEffect, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { getPref, setPref } from "../../data/repo";
import type { Part, Project } from "../../data/types";
import { navigate } from "../../lib/router";
import { openCapture } from "../../lib/store";
import { IconX } from "../../ui/icons";
import { toast, toastError } from "../../ui/toast";
import { Button, IconButton } from "../../ui/ui";
import { draftFromStructure } from "../board/structureDoc";
import { partPath } from "./modes";
import { nextQuestion, type ProjectSnapshot, type Suggestion } from "./suggestions";

export async function loadSnapshot(project: Project): Promise<ProjectSnapshot> {
  const id = project.id;
  const [docs, notes, recordings, transcripts, boards, sections, cards, decisions, refs, steps] = await Promise.all([
    db.byIndex("documents", "projectId", id),
    db.byIndex("notes", "projectId", id),
    db.byIndex("recordings", "projectId", id),
    db.byIndex("transcripts", "projectId", id),
    db.byIndex("boards", "projectId", id),
    db.byIndex("sections", "projectId", id),
    db.byIndex("cards", "projectId", id),
    db.byIndex("decisions", "projectId", id),
    db.byIndex("references", "projectId", id),
    db.byIndex("steps", "projectId", id),
  ]);
  const trunk = boards.find((b) => b.kind === "structure");
  return {
    project,
    docs,
    notes,
    recordings,
    transcripts,
    parts: sections.filter((s) => s.boardId === trunk?.id),
    trunkCards: cards.filter((c) => c.boardId === trunk?.id),
    storyCards: cards.filter((c) => c.boardId !== trunk?.id),
    decisions,
    steps,
    refs,
  };
}

/** One gentle question at a time, from simple rules about the work — never generated text. */
export function MikiAsks({ project, part, onFocusField }: { project: Project; part: Part; onFocusField?: (f: "purpose" | "audience" | "thread") => void }) {
  const { data: snap } = useLive(() => loadSnapshot(project), [project], ["documents", "notes", "recordings", "transcripts", "sections", "cards", "decisions", "references", "steps"]);
  const key = `asks:dismissed:${project.id}`;
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    void getPref<string[]>(key, []).then(setDismissed);
  }, [key]);
  if (!snap || !dismissed) return null;
  const q = nextQuestion(snap, part, dismissed);
  if (!q) return null;

  const dismiss = () => {
    const next = [...dismissed, q.id];
    setDismissed(next);
    void setPref(key, next).catch(() => undefined);
  };

  return (
    <aside className="miki-asks" aria-label="Miki asks">
      <span className="miki-asks-label">Miki asks</span>
      <p className="miki-asks-text">{q.text}</p>
      <div className="miki-asks-actions">
        {q.action && q.actionLabel && (
          <Button size="sm" variant="secondary" onClick={() => void run(project, q, onFocusField)}>
            {q.actionLabel}
          </Button>
        )}
        <IconButton icon={IconX} size="sm" label="Not now" title="Not now" onClick={dismiss} />
      </div>
    </aside>
  );
}

async function run(project: Project, q: Suggestion, onFocusField?: (f: "purpose" | "audience" | "thread") => void) {
  const a = q.action;
  if (!a) return;
  switch (a.kind) {
    case "focus":
      if (onFocusField) onFocusField(a.field);
      else navigate(partPath(project.id, "roots"), { focus: a.field });
      return;
    case "go":
      navigate(partPath(project.id, a.part), a.query);
      return;
    case "record":
      openCapture({ tab: "speak", projectId: project.id });
      return;
    case "add-reference":
      navigate(partPath(project.id, "roots"), { view: "sources", new: "character" });
      return;
    case "draft-from-trunk":
      try {
        const doc = await draftFromStructure(project.id, { title: "First draft" });
        toast("A draft has grown from your trunk, in order. Nothing else was changed.");
        navigate(partPath(project.id, "trunk"), { view: "draft", doc: doc.id });
      } catch (e) {
        toastError(e);
      }
  }
}
