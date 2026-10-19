import { useMemo, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { addLink, createReference, deleteReference, removeLink, updateReference, updateReferenceField } from "../../data/repo";
import { projectTemplate, REFERENCE_KINDS, referenceKindInfo } from "../../data/templates";
import type { Link, Project, Reference, ReferenceKind } from "../../data/types";
import { href, projectPath, setQuery } from "../../lib/router";
import { useIsNarrow } from "../../lib/useMedia";
import { useAutoField } from "../../lib/useAutoField";
import { cx, truncate, uid } from "../../lib/util";
import { IconArrowLeft, IconLibrary, IconLink, IconPlace, IconPlus, IconQuestion, IconResearch, IconScale, IconBookmark, IconUser, IconX, IconTrash, IconSprout } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toastError, toastUndo } from "../../ui/toast";
import { Button, EmptyState, IconButton, InlineEdit, Select, TextArea, TextInput } from "../../ui/ui";
import { EntityChip, EntityPicker, linksFor, useProjectEntities } from "../shared/entities";
import "./reference.css";

const KIND_ICON: Record<ReferenceKind, typeof IconUser> = {
  character: IconUser,
  place: IconPlace,
  research: IconResearch,
  source: IconBookmark,
  theme: IconSprout,
  argument: IconScale,
  question: IconQuestion,
  other: IconLibrary,
};

/** Characters, places, sources, themes — one flexible kind of record, linked to the work. */
export function ReferenceMode({ project, query }: { project: Project; query: URLSearchParams }) {
  const { data } = useLive(
    async () => {
      const [refs, links] = await Promise.all([db.byIndex("references", "projectId", project.id), db.byIndex("links", "projectId", project.id)]);
      return { refs, links };
    },
    [project.id],
    ["references", "links"],
  );
  const narrow = useIsNarrow();
  const [kindFilter, setKindFilter] = useState<ReferenceKind | "all">("all");
  const [q, setQ] = useState("");
  const tpl = projectTemplate(project.type);
  const selected = data?.refs.find((r) => r.id === query.get("ref"));

  const kindsOrder = useMemo(() => [...tpl.referenceKinds, ...REFERENCE_KINDS.map((k) => k.kind).filter((k) => !tpl.referenceKinds.includes(k))], [tpl]);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const refs = (data?.refs ?? []).filter((r) => (kindFilter === "all" || r.kind === kindFilter) && (!needle || `${r.title} ${r.summary} ${r.body}`.toLowerCase().includes(needle)));
    return kindsOrder.map((k) => ({ kind: k, refs: refs.filter((r) => r.kind === k).sort((a, b) => a.title.localeCompare(b.title)) })).filter((g) => g.refs.length);
  }, [data, kindFilter, q, kindsOrder]);

  const create = async (kind: ReferenceKind) => {
    const info = referenceKindInfo(kind);
    try {
      const r = await createReference({ projectId: project.id, title: `New ${info.label.toLowerCase()}`, kind, fieldLabels: info.fields });
      setQuery({ ref: r.id });
    } catch (e) {
      toastError(e);
    }
  };

  const newMenu = (variant: "primary" | "secondary" = "secondary") => (
    <Menu
      label="New reference"
      align="start"
      trigger={(t) => (
        <Button {...t} size="sm" variant={variant} icon={IconPlus}>
          New
        </Button>
      )}
      items={kindsOrder.map((k) => ({ label: referenceKindInfo(k).label, icon: KIND_ICON[k], onSelect: () => void create(k) }))}
    />
  );

  if (!data) return <div className="refs" aria-busy />;
  const showList = !narrow || !selected;

  return (
    <div className="refs">
      {showList && (
        <aside className="refs-list" aria-label="References">
          <div className="refs-list-head">
            <h2 className="eyebrow grow">References</h2>
            {newMenu()}
          </div>
          <TextInput placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a reference" className="material-search" />
          <Select
            label="Kind"
            value={kindFilter}
            onChange={(v) => setKindFilter(v as ReferenceKind | "all")}
            options={[{ value: "all", label: "All kinds" }, ...kindsOrder.map((k) => ({ value: k, label: referenceKindInfo(k).plural }))]}
          />
          <div className="refs-groups scroll-y">
            {groups.length === 0 && <p className="muted small">{data.refs.length ? "Nothing matches." : "Nothing here yet."}</p>}
            {groups.map((g) => {
              const Icon = KIND_ICON[g.kind];
              return (
                <section key={g.kind}>
                  <h3 className="material-group">{referenceKindInfo(g.kind).plural}</h3>
                  <ul role="list" className="refs-items">
                    {g.refs.map((r) => (
                      <li key={r.id}>
                        <a className={cx("list-row", r.id === selected?.id && "is-active")} href={href(projectPath(project.id, "reference"), { ref: r.id })}>
                          <Icon size={15} aria-hidden className="faint" />
                          <span className="grow">
                            <span className="list-row-title" style={{ display: "block" }}>
                              {r.title}
                            </span>
                            {r.summary && <span className="list-row-meta">{truncate(r.summary, 60)}</span>}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </aside>
      )}
      <section className="refs-main scroll-y">
        {narrow && selected && (
          <button type="button" className="capture-back" onClick={() => setQuery({ ref: null })}>
            <IconArrowLeft size={16} aria-hidden /> All references
          </button>
        )}
        {selected ? (
          <ReferenceDetail key={selected.id} reference={selected} project={project} links={data.links} />
        ) : (
          <EmptyState icon={IconLibrary} title={tpl.referenceKinds.includes("character") ? "The people and places in the work" : "The material behind the work"} actions={newMenu("primary")}>
            Keep characters, places, sources, themes, and arguments in one place — each linked to the scenes, ideas, and decisions it touches. Add only what helps.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function ReferenceDetail({ reference: r, project, links }: { reference: Reference; project: Project; links: Link[] }) {
  const save = (patch: Partial<Reference>) => updateReference(r.id, patch).catch(toastError);
  const summary = useAutoField(r.summary, (summary) => save({ summary }));
  const body = useAutoField(r.body, (b) => save({ body: b }));
  const [picker, setPicker] = useState(false);
  const { data: entities } = useProjectEntities(project.id);
  const related = linksFor(links, { type: "reference", id: r.id });
  const info = referenceKindInfo(r.kind);
  const Icon = KIND_ICON[r.kind];

  return (
    <article className="ref-detail">
      <div className="ref-kind">
        <Icon size={15} aria-hidden />
        <Select label="Kind" value={r.kind} onChange={(v) => void save({ kind: v as ReferenceKind })} options={REFERENCE_KINDS.map((k) => ({ value: k.kind, label: k.label }))} />
      </div>
      <InlineEdit label="Name" className="ref-title" value={r.title} onCommit={(title) => void save({ title })} />
      <TextArea minRows={2} className="ref-summary" value={summary.text} onChange={(e) => summary.onChange(e.target.value)} onBlur={summary.onBlur} placeholder={`Who or what is this ${info.label.toLowerCase()}, in a sentence?`} aria-label="Summary" />

      <section className="ref-fields">
        {r.fields.map((f) => (
          <FieldRow key={f.id} label={f.label} value={f.value} onChange={(patch) => void updateReferenceField(r.id, f.id, patch).catch(toastError)} onRemove={() => void save({ fields: r.fields.filter((x) => x.id !== f.id) })} />
        ))}
        <Button size="sm" variant="ghost" icon={IconPlus} onClick={() => void save({ fields: [...r.fields, { id: uid(), label: "New detail", value: "" }] })}>
          Add a detail
        </Button>
      </section>

      <label className="decision-label" htmlFor={`refbody-${r.id}`}>
        Notes
      </label>
      <TextArea id={`refbody-${r.id}`} minRows={4} className="ref-body" value={body.text} onChange={(e) => body.onChange(e.target.value)} onBlur={body.onBlur} placeholder="Anything worth remembering." />

      <section className="decision-links">
        <span className="decision-label">{r.kind === "character" || r.kind === "place" ? "Appears in" : "Connected to"}</span>
        <div className="chip-row">
          {related.map(({ link, other }) => {
            const e = entities?.get(`${other.type}:${other.id}`);
            return e ? <EntityChip key={link.id} projectId={project.id} info={e} onRemove={() => void removeLink(link.id).catch(toastError)} /> : null;
          })}
          <button type="button" className="chip" onClick={() => setPicker(true)}>
            <IconLink size={13} aria-hidden />
            <span>{r.kind === "character" ? "Link a scene" : "Link material"}</span>
          </button>
        </div>
      </section>

      <footer className="detail-foot">
        <span className="grow" />
        <Button
          size="sm"
          variant="ghost"
          icon={IconTrash}
          className="danger-text"
          onClick={() =>
            void deleteReference(r.id)
              .then((restore) => {
                setQuery({ ref: null });
                toastUndo(`Deleted “${r.title}”.`, restore);
              })
              .catch(toastError)
          }
        >
          Delete
        </Button>
      </footer>
      <EntityPicker
        open={picker}
        onClose={() => setPicker(false)}
        projectId={project.id}
        title={`Connect ${r.title}`}
        exclude={[`reference:${r.id}`, ...related.map((x) => `${x.other.type}:${x.other.id}`)]}
        onPick={(ref) => void addLink(project.id, ref, { type: "reference", id: r.id }, ref.type === "card" ? "features" : "related").catch(toastError)}
      />
    </article>
  );
}

function FieldRow({ label, value, onChange, onRemove }: { label: string; value: string; onChange: (p: { label?: string; value?: string }) => void; onRemove: () => void }) {
  const v = useAutoField(value, async (next) => onChange({ value: next }));
  return (
    <div className="ref-field">
      <InlineEdit label="Detail name" className="ref-field-label" value={label} onCommit={(l) => onChange({ label: l })} />
      <TextArea minRows={1} className="ref-field-value" value={v.text} onChange={(e) => v.onChange(e.target.value)} onBlur={v.onBlur} placeholder="—" aria-label={label} />
      <IconButton icon={IconX} size="sm" label={`Remove ${label}`} onClick={onRemove} className="ref-field-remove" />
    </div>
  );
}
