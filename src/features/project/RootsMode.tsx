import { useEffect, useRef } from "react";
import { updateProject } from "../../data/repo";
import { projectTemplate } from "../../data/templates";
import type { Project } from "../../data/types";
import { setQuery } from "../../lib/router";
import { useAutoField } from "../../lib/useAutoField";
import { toastError } from "../../ui/toast";
import { Segmented, TextArea } from "../../ui/ui";
import { ReferenceMode } from "../reference/ReferenceMode";
import { MikiAsks } from "./MikiAsks";
import { OverviewMode } from "./OverviewMode";

type Field = "purpose" | "audience" | "thread";

/** 根 Roots — intention. Why the piece exists, who it's for, and what it grows from. */
export function RootsMode({ project, query }: { project: Project; query: URLSearchParams }) {
  const v = query.get("view");
  const view =
    v === "sources" || query.get("ref") ? "sources" : v === "overview" ? "overview" : v === "intention" || query.get("focus") ? "intention" : project.purpose?.trim() ? "overview" : "intention";
  const tpl = projectTemplate(project.type);
  const people = tpl.referenceKinds.includes("character");

  return (
    <div className="part-body roots">
      <div className="part-subnav">
        <Segmented
          size="sm"
          label="Roots"
          value={view}
          onChange={(v) => setQuery({ view: v, ref: null, new: null, focus: null })}
          options={[
            { value: "overview", label: "Overview" },
            { value: "intention", label: "Intention" },
            { value: "sources", label: people ? "People, places & sources" : "Sources & themes" },
          ]}
        />
      </div>
      {view === "overview" ? (
        <OverviewMode project={project} />
      ) : view === "intention" ? (
        <Intention project={project} focus={query.get("focus") as Field | null} />
      ) : (
        <ReferenceMode project={project} query={query} />
      )}
    </div>
  );
}

function Intention({ project, focus }: { project: Project; focus: Field | null }) {
  const save = (patch: Partial<Project>) => updateProject(project.id, patch).catch(toastError);
  const purpose = useAutoField(project.purpose ?? "", (v) => save({ purpose: v }));
  const audience = useAutoField(project.audience ?? "", (v) => save({ audience: v }));
  const thread = useAutoField(project.thread, (v) => save({ thread: v }));
  const notes = useAutoField(project.description, (v) => save({ description: v }));
  const refs = { purpose: useRef<HTMLTextAreaElement>(null), audience: useRef<HTMLTextAreaElement>(null), thread: useRef<HTMLTextAreaElement>(null) };

  const focusField = (f: Field) => {
    const el = refs[f].current;
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  useEffect(() => {
    if (focus && refs[focus]) {
      focusField(focus);
      setQuery({ focus: null }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return (
    <div className="intention scroll-y">
      <div className="intention-inner">
        <MikiAsks project={project} part="roots" onFocusField={focusField} />
        <RootQuestion
          n="一"
          label="Why does this piece exist?"
          hint="What should it do — for you, or for whoever reads it? A sentence is enough."
          field={purpose}
          inputRef={refs.purpose}
          placeholder="To show that slowing down is a skill, not a luxury."
        />
        <RootQuestion n="二" label="Who is it for?" hint="Picture one reader. Writing for someone makes every choice easier." field={audience} inputRef={refs.audience} placeholder="A friend who feels guilty for resting." />
        <RootQuestion
          n="三"
          label="The thread"
          hint="What it's really about, in one sentence. It runs up the trunk and holds everything you keep."
          field={thread}
          inputRef={refs.thread}
          placeholder="Speed costs us the very attention it promises to free."
        />
        <section className="root-q is-quiet">
          <label className="root-q-label" htmlFor="roots-notes">
            Anything else in the ground
          </label>
          <p className="root-q-hint">Constraints, a deadline, where it will live, what you're afraid of. Optional.</p>
          <TextArea id="roots-notes" minRows={3} className="root-q-input is-small" value={notes.text} onChange={(e) => notes.onChange(e.target.value)} onBlur={notes.onBlur} placeholder="Around 2,000 words, for my newsletter." />
        </section>
      </div>
    </div>
  );
}

function RootQuestion({
  n,
  label,
  hint,
  field,
  inputRef,
  placeholder,
}: {
  n: string;
  label: string;
  hint: string;
  field: ReturnType<typeof useAutoField>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
}) {
  const id = `root-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section className="root-q">
      <span className="root-q-num" aria-hidden>
        {n}
      </span>
      <label className="root-q-label" htmlFor={id}>
        {label}
      </label>
      <p className="root-q-hint">{hint}</p>
      <TextArea ref={inputRef} id={id} minRows={1} className="root-q-input" value={field.text} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} placeholder={placeholder} />
    </section>
  );
}
