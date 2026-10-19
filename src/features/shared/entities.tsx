import { useMemo, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import type { EntityRef, EntityType, Link, LinkKind } from "../../data/types";
import { href, projectPath } from "../../lib/router";
import { cx, truncate } from "../../lib/util";
import { Dialog } from "../../ui/Dialog";
import { IconAudio, IconDoc, IconIdea, IconLibrary, IconNote, IconOutline, IconSignpost, IconX, IconChecklist } from "../../ui/icons";
import { Segmented, TextInput } from "../../ui/ui";
import { linkLabel } from "../board/cardMeta";

export interface EntityInfo extends EntityRef {
  title: string;
  detail: string;
  group: string;
}

const ICONS: Partial<Record<EntityType, typeof IconDoc>> = {
  document: IconDoc,
  note: IconNote,
  transcript: IconAudio,
  card: IconIdea,
  reference: IconLibrary,
  decision: IconSignpost,
  step: IconChecklist,
};

/** Everything linkable in a project, with display titles. */
export function useProjectEntities(projectId: string) {
  return useLive(
    async () => {
      const [docs, notes, transcripts, boards, cards, refs, decisions, steps] = await Promise.all([
        db.byIndex("documents", "projectId", projectId),
        db.byIndex("notes", "projectId", projectId),
        db.byIndex("transcripts", "projectId", projectId),
        db.byIndex("boards", "projectId", projectId),
        db.byIndex("cards", "projectId", projectId),
        db.byIndex("references", "projectId", projectId),
        db.byIndex("decisions", "projectId", projectId),
        db.byIndex("steps", "projectId", projectId),
      ]);
      const structureId = boards.find((b) => b.kind === "structure")?.id;
      const list: EntityInfo[] = [
        ...cards.map((c) => ({
          type: "card" as const,
          id: c.id,
          title: c.title || truncate(c.body, 60) || "Untitled card",
          detail: c.title ? truncate(c.body, 90) : "",
          group: c.boardId === structureId ? "Structure" : "Ideas",
        })),
        ...notes.map((n) => ({ type: "note" as const, id: n.id, title: n.title || truncate(n.body, 60) || "Untitled note", detail: n.title ? truncate(n.body, 90) : "", group: "Notes" })),
        ...docs.map((d) => ({ type: "document" as const, id: d.id, title: d.title, detail: `${d.wordCount} words`, group: "Drafts" })),
        ...transcripts.map((t) => ({ type: "transcript" as const, id: t.id, title: t.title, detail: truncate(t.text, 90), group: "Transcripts" })),
        ...refs.map((r) => ({ type: "reference" as const, id: r.id, title: r.title, detail: r.summary ? truncate(r.summary, 90) : r.kind, group: "References" })),
        ...decisions.map((d) => ({ type: "decision" as const, id: d.id, title: d.question || "Untitled decision", detail: d.status === "decided" ? "Decided" : "Open", group: "Decisions" })),
        ...steps.map((s) => ({ type: "step" as const, id: s.id, title: s.title, detail: s.objective, group: "Process" })),
      ];
      return new Map(list.map((e) => [`${e.type}:${e.id}`, e]));
    },
    [projectId],
    ["documents", "notes", "transcripts", "boards", "cards", "references", "decisions", "steps"],
  );
}

export function entityHref(projectId: string, ref: EntityRef, extra: Record<string, string> = {}): string {
  const p = (mode: string, q: Record<string, string>) => href(projectPath(projectId, mode), { ...q, ...extra });
  switch (ref.type) {
    case "document":
      return p("write", { doc: ref.id });
    case "note":
      return p("capture", { note: ref.id });
    case "transcript":
      return p("capture", { tr: ref.id });
    case "recording":
      return p("capture", { rec: ref.id });
    case "reference":
      return p("reference", { ref: ref.id });
    case "decision":
      return p("discern", { decision: ref.id });
    case "step":
      return p("discern", { step: ref.id });
    case "card":
      return p("explore", { card: ref.id });
    default:
      return p("overview", {});
  }
}

export function EntityChip({ projectId, info, onRemove, kind, cardBoard }: { projectId: string; info: EntityInfo; onRemove?: () => void; kind?: LinkKind; cardBoard?: "explore" | "arrange" }) {
  const Icon = ICONS[info.type] ?? IconOutline;
  const to = info.type === "card" && (cardBoard || info.group === "Structure") ? href(projectPath(projectId, cardBoard ?? "arrange"), { card: info.id }) : entityHref(projectId, info);
  return (
    <span className="chip entity-chip">
      <Icon size={13} aria-hidden />
      {kind && kind !== "related" && <em className="chip-kind">{linkLabel(kind)}</em>}
      <a href={to} className="entity-chip-link">
        {truncate(info.title, 44)}
      </a>
      {onRemove && (
        <button type="button" className="chip-remove" aria-label={`Remove link to ${info.title}`} onClick={onRemove}>
          <IconX size={12} aria-hidden />
        </button>
      )}
    </span>
  );
}

/** Links touching an entity, resolved to the entity on the other side. */
export function linksFor(links: Link[], ref: EntityRef): { link: Link; other: EntityRef }[] {
  return links
    .filter((l) => (l.from.type === ref.type && l.from.id === ref.id) || (l.to.type === ref.type && l.to.id === ref.id))
    .map((l) => ({ link: l, other: l.from.type === ref.type && l.from.id === ref.id ? l.to : l.from }));
}

/** A searchable chooser for linking project material. */
export function EntityPicker({
  open,
  onClose,
  projectId,
  onPick,
  title = "Link material",
  exclude = [],
  allowKinds,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onPick: (ref: EntityRef, kind: LinkKind) => void;
  title?: string;
  exclude?: string[];
  allowKinds?: LinkKind[];
}) {
  const { data } = useProjectEntities(projectId);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<LinkKind>(allowKinds?.[0] ?? "related");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(data?.values() ?? [])].filter((e) => !exclude.includes(`${e.type}:${e.id}`) && (!needle || `${e.title} ${e.detail}`.toLowerCase().includes(needle)));
  }, [data, q, exclude]);
  const groups = useMemo(() => {
    const m = new Map<string, EntityInfo[]>();
    for (const e of list) m.set(e.group, [...(m.get(e.group) ?? []), e]);
    return [...m.entries()];
  }, [list]);

  return (
    <Dialog open={open} onClose={onClose} title={title} size="md">
      <div className="stack gap-3">
        <TextInput data-autofocus placeholder="Search notes, cards, drafts, references…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search project material" />
        {allowKinds && allowKinds.length > 1 && (
          <Segmented size="sm" label="Relationship" value={kind} onChange={setKind} options={allowKinds.map((k) => ({ value: k, label: linkLabel(k) }))} />
        )}
        <div className="picker-list">
          {groups.length === 0 && <p className="muted small">Nothing to link{q ? " matches that search" : " yet"}.</p>}
          {groups.map(([group, items]) => (
            <section key={group}>
              <h3 className="material-group">{group}</h3>
              <ul role="list" className="picker-items">
                {items.map((e) => {
                  const Icon = ICONS[e.type] ?? IconOutline;
                  return (
                    <li key={`${e.type}:${e.id}`}>
                      <button
                        type="button"
                        className={cx("list-row")}
                        onClick={() => {
                          onPick({ type: e.type, id: e.id }, kind);
                          onClose();
                        }}
                      >
                        <Icon size={15} aria-hidden className="faint" />
                        <span className="grow">
                          <span className="list-row-title" style={{ display: "block" }}>
                            {e.title}
                          </span>
                          {e.detail && <span className="list-row-meta">{e.detail}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
