import { useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import { useAll, useLive } from "../../data/hooks";
import { deleteNote, moveToProject, updateNote } from "../../data/repo";
import { INBOX, type Note, type NoteKind, type Project } from "../../data/types";
import { href, navigate } from "../../lib/router";
import { entityHref, partPath } from "../project/modes";
import type { EntityRef } from "../../data/types";
import { byOrder, copyText, relativeTime } from "../../lib/util";
import { IconCopy, IconDoc, IconLeafFall, IconMoveTo, IconOutline, IconRestore, IconSource, IconSprout, IconTrash } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Button, Segmented } from "../../ui/ui";
import { orderStructure } from "../board/structureDoc";
import { useProjectEntities } from "../shared/entities";
import { appendToDocument, excerptToStructureCard } from "./derive";

const KINDS: { value: NoteKind; label: string }[] = [
  { value: "note", label: "Leaf" },
  { value: "fragment", label: "Fragment" },
  { value: "idea", label: "Idea" },
  { value: "question", label: "Question" },
  { value: "quote", label: "Quote" },
];

export function NoteDetail({ note, project, onDeleted }: { note: Note; project: Project | null; onDeleted: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const latest = useRef({ title, body });
  latest.current = { title, body };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const projectId = project?.id ?? INBOX;
  const { data: projects } = useAll("projects");
  const { data: entities } = useProjectEntities(projectId);
  const { data: targets } = useLive(
    async () => {
      if (projectId === INBOX) return { docs: [], sections: [] };
      const [docs, boards, sections] = await Promise.all([db.byIndex("documents", "projectId", projectId), db.byIndex("boards", "projectId", projectId), db.byIndex("sections", "projectId", projectId)]);
      const structure = boards.find((b) => b.kind === "structure");
      return { docs: [...docs].sort(byOrder), sections: orderStructure(sections.filter((s) => s.boardId === structure?.id), []).filter((c) => c.section).map((c) => c.section!) };
    },
    [projectId],
    ["documents", "boards", "sections"],
  );

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { title: t, body: b } = latest.current;
    if (t !== note.title || b !== note.body) void updateNote(note.id, { title: t, body: b }).catch(toastError);
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const src = note.source ? entities?.get(`${note.source.type}:${note.source.id}`) : undefined;
  const text = [title, body].filter(Boolean).join("\n\n");
  const ref = { type: "note" as const, id: note.id, excerpt: body.slice(0, 200) };
  const carry = (sectionId: string | null, title: string | null) => {
    flush();
    return excerptToStructureCard(projectId, sectionId, latest.current.body, ref, latest.current.title)
      .then(() =>
        toast(title ? `Carried onto the trunk, in “${title}”.` : "Carried onto the trunk.", {
          action: { label: "See the trunk", onClick: () => navigate(partPath(projectId, "trunk")) },
        }),
      )
      .catch(toastError);
  };
  const run = async (msg: string, fn: () => Promise<unknown>) => {
    flush();
    try {
      await fn();
      toast(msg);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <article className="detail note-detail">
      <div className="note-meta">
        <Segmented size="sm" label="Kind of leaf" value={note.kind} onChange={(kind) => void updateNote(note.id, { kind }).catch(toastError)} options={KINDS} />
        <span className="muted small">Edited {relativeTime(note.updatedAt)}</span>
      </div>
      <input
        className="note-title"
        value={title}
        placeholder="Title (optional)"
        aria-label="Leaf title"
        onChange={(e) => {
          setTitle(e.target.value);
          schedule();
        }}
        onBlur={flush}
      />
      <textarea
        ref={bodyRef}
        className="note-body"
        value={body}
        placeholder="Write freely."
        aria-label="Leaf text"
        onChange={(e) => {
          setBody(e.target.value);
          schedule();
        }}
        onBlur={flush}
      />
      {note.source && (
        <a className="card-source" href={src ? sourceHref(projectId, src, note.source.excerpt) : undefined} aria-disabled={!src}>
          <IconSource size={14} aria-hidden />
          <span className="grow">
            <span className="card-source-label">{src ? `From ${src.type === "transcript" ? "your recording" : src.type === "note" ? "a leaf" : src.group.toLowerCase()}: ${src.title}` : "The source of this leaf was deleted."}</span>
            {note.source.excerpt && <span className="card-source-excerpt">The exact words are kept with this leaf.</span>}
          </span>
        </a>
      )}
      {note.fallen && (
        <p className="note-fallen-line">
          You let this leaf fall. It stays here, out of the way, and can feed something later.
        </p>
      )}
      <div className="note-actions">
        {projectId === INBOX ? (
          <Menu
            label="Plant in a project"
            align="start"
            trigger={(t) => (
              <Button {...t} variant="primary" size="sm" icon={IconSprout}>
                Plant in…
              </Button>
            )}
            items={(projects ?? [])
              .filter((p) => !p.archived)
              .map((p) => ({
                label: p.title,
                onSelect: () =>
                  void moveToProject({ type: "note", id: note.id }, p.id)
                    .then(() => toast(`Planted in “${p.title}”.`, { action: { label: "Go", onClick: () => navigate(partPath(p.id, "leaves"), { note: note.id }) } }))
                    .catch(toastError),
              }))
              .concat((projects ?? []).filter((p) => !p.archived).length ? [] : [{ label: "No trees yet — plant one from the grove", onSelect: () => undefined }])}
          />
        ) : (
          <>
            <Menu
              label="Carry onto the trunk"
              align="start"
              trigger={(t) => (
                <Button {...t} size="sm" variant={note.fallen ? "secondary" : "primary"} icon={IconOutline}>
                  Carry onto the trunk
                </Button>
              )}
              items={[
                { heading: "Which part?" },
                ...(targets?.sections ?? []).map((s) => ({ label: s.title, onSelect: () => void carry(s.id, s.title) })),
                { label: "Not placed yet", onSelect: () => void carry(null, null) },
              ]}
            />
            <Menu
              label="Add to a draft"
              align="start"
              trigger={(t) => (
                <Button {...t} size="sm" variant="secondary" icon={IconDoc}>
                  Add to draft
                </Button>
              )}
              items={
                targets?.docs.length
                  ? targets.docs.flatMap((d) => [
                      { heading: d.title },
                      { label: "As a quote", onSelect: () => void run(`Added to “${d.title}”.`, () => appendToDocument(d.id, text, true)) },
                      { label: "As text", onSelect: () => void run(`Added to “${d.title}”.`, () => appendToDocument(d.id, text, false)) },
                    ])
                  : [{ label: "No drafts yet", disabled: true, onSelect: () => undefined }]
              }
            />
            <Button
              size="sm"
              variant="ghost"
              icon={note.fallen ? IconRestore : IconLeafFall}
              onClick={() =>
                void updateNote(note.id, { fallen: !note.fallen })
                  .then(() => toast(note.fallen ? "Picked back up." : "Let it fall. You'll find it under Fallen."))
                  .catch(toastError)
              }
            >
              {note.fallen ? "Pick back up" : "Let it fall"}
            </Button>
            <Menu
              label="Move"
              align="start"
              trigger={(t) => <Button {...t} size="sm" variant="ghost" icon={IconMoveTo} aria-label="Move this leaf" />}
              items={[
                { heading: "Move this leaf to" },
                { label: "Seeds (no project)", onSelect: () => void moveToProject({ type: "note", id: note.id }, INBOX).then(onDeleted).catch(toastError) },
                ...(projects ?? [])
                  .filter((p) => !p.archived && p.id !== projectId)
                  .map((p) => ({ label: p.title, onSelect: () => void moveToProject({ type: "note", id: note.id }, p.id).then(onDeleted).catch(toastError) })),
              ]}
            />
          </>
        )}
        <span className="grow" />
        <Button size="sm" variant="ghost" icon={IconCopy} onClick={() => void copyText(text).then((ok) => toast(ok ? "Copied." : "Couldn't copy."))}>
          Copy
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={IconTrash}
          className="danger-text"
          onClick={() =>
            void deleteNote(note.id)
              .then((restore) => {
                onDeleted();
                toastUndo("Deleted.", restore);
              })
              .catch(toastError)
          }
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

function sourceHref(projectId: string, src: EntityRef, excerpt?: string) {
  const hl: Record<string, string> = excerpt ? { hl: excerpt.slice(0, 160) } : {};
  if (projectId === INBOX) return href("/seeds", { [src.type === "transcript" ? "tr" : src.type === "note" ? "note" : "rec"]: src.id, ...hl });
  return entityHref(projectId, src, hl);
}
