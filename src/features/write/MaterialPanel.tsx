import { useMemo, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import type { DocContent, Project } from "../../data/types";
import { buildDoc } from "../../editor/serialize";
import { href, projectPath } from "../../lib/router";
import { truncate } from "../../lib/util";
import { IconPlus, IconQuote, IconX } from "../../ui/icons";
import { IconButton, Segmented, TextInput } from "../../ui/ui";
import { orderStructure } from "../board/structureDoc";

type Tab = "structure" | "ideas" | "notes" | "refs";

interface Item {
  id: string;
  title: string;
  body: string;
  meta?: string;
  to: string;
}

/** Supporting material beside the draft, so writing never means losing the rest of the project. */
export function MaterialPanel({ project, onInsert, onClose }: { project: Project; onInsert: (c: DocContent) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("structure");
  const [q, setQ] = useState("");
  const { data } = useLive(
    async () => {
      const [boards, sections, cards, notes, transcripts, refs] = await Promise.all([
        db.byIndex("boards", "projectId", project.id),
        db.byIndex("sections", "projectId", project.id),
        db.byIndex("cards", "projectId", project.id),
        db.byIndex("notes", "projectId", project.id),
        db.byIndex("transcripts", "projectId", project.id),
        db.byIndex("references", "projectId", project.id),
      ]);
      return { boards, sections, cards, notes, transcripts, refs };
    },
    [project.id],
    ["boards", "sections", "cards", "notes", "transcripts", "references"],
  );

  const groups = useMemo((): { label: string; items: Item[] }[] => {
    if (!data) return [];
    const ideas = data.boards.find((b) => b.kind === "ideas");
    const structure = data.boards.find((b) => b.kind === "structure");
    if (tab === "structure") {
      return orderStructure(
        data.sections.filter((s) => s.boardId === structure?.id),
        data.cards.filter((c) => c.boardId === structure?.id),
      ).map((col) => ({
        label: col.section?.title ?? "Unplaced",
        items: col.cards.map((c) => ({ id: c.id, title: c.title, body: c.body, to: projectPath(project.id, "arrange") + `?card=${c.id}` })),
      }));
    }
    if (tab === "ideas") {
      const secs = data.sections.filter((s) => s.boardId === ideas?.id).sort((a, b) => a.order - b.order);
      const cards = data.cards.filter((c) => c.boardId === ideas?.id);
      return [
        ...secs.map((s) => ({ label: s.title, items: cards.filter((c) => c.sectionId === s.id) })),
        { label: "Loose", items: cards.filter((c) => !c.sectionId || !secs.some((s) => s.id === c.sectionId)) },
      ].map((g) => ({ label: g.label, items: g.items.map((c) => ({ id: c.id, title: c.title, body: c.body, to: projectPath(project.id, "explore") + `?card=${c.id}` })) }));
    }
    if (tab === "notes") {
      return [
        { label: "Notes", items: [...data.notes].sort((a, b) => b.updatedAt - a.updatedAt).map((n) => ({ id: n.id, title: n.title, body: n.body, meta: n.kind, to: projectPath(project.id, "capture") + `?note=${n.id}` })) },
        { label: "Transcripts", items: data.transcripts.map((t) => ({ id: t.id, title: t.title, body: t.text, meta: "transcript", to: projectPath(project.id, "capture") + `?tr=${t.id}` })) },
      ];
    }
    return [
      {
        label: "References",
        items: data.refs.map((r) => ({
          id: r.id,
          title: r.title,
          body: [r.summary, ...r.fields.filter((f) => f.value).map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join("\n"),
          meta: r.kind,
          to: projectPath(project.id, "reference") + `?ref=${r.id}`,
        })),
      },
    ];
  }, [data, tab, project.id]);

  const needle = q.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({ ...g, items: needle ? g.items.filter((i) => `${i.title} ${i.body}`.toLowerCase().includes(needle)) : g.items }))
    .filter((g) => g.items.length > 0);

  return (
    <aside className="material" aria-label="Project material">
      <div className="material-head">
        <h2 className="eyebrow">Material</h2>
        <IconButton icon={IconX} label="Close material panel" size="sm" onClick={onClose} />
      </div>
      {project.thread && <p className="material-thread">“{project.thread}”</p>}
      <Segmented
        size="sm"
        label="Material type"
        value={tab}
        onChange={setTab}
        options={[
          { value: "structure", label: "Structure" },
          { value: "ideas", label: "Ideas" },
          { value: "notes", label: "Notes" },
          { value: "refs", label: "Refs" },
        ]}
      />
      <TextInput className="material-search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter material" />
      <div className="material-list scroll-y">
        {filtered.length === 0 ? (
          <p className="muted small material-empty">{needle ? "Nothing matches." : "Nothing here yet."}</p>
        ) : (
          filtered.map((g) => (
            <section key={g.label}>
              <h3 className="material-group">{g.label}</h3>
              <ul role="list" className="material-items">
                {g.items.map((i) => (
                  <li key={i.id} className="material-item">
                    <a className="material-item-title" href={href(i.to.split("?")[0], Object.fromEntries(new URLSearchParams(i.to.split("?")[1] ?? "")))}>
                      {i.title || truncate(i.body, 60) || "Untitled"}
                    </a>
                    {i.body && i.title && <p className="material-item-body">{truncate(i.body, 180)}</p>}
                    <div className="material-actions">
                      <button
                        type="button"
                        className="chip"
                        onClick={() => onInsert(buildDoc([...(i.title ? [{ kind: "h" as const, level: 3 as const, text: i.title }] : []), ...(i.body ? [{ kind: "p" as const, text: i.body }] : [])]))}
                        title="Insert below the cursor as text you can edit"
                      >
                        <IconPlus size={12} aria-hidden />
                        <span>Insert</span>
                      </button>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => onInsert(buildDoc([{ kind: "quote", text: i.body || i.title }]))}
                        title="Insert below the cursor as a quoted note"
                      >
                        <IconQuote size={12} aria-hidden />
                        <span>As quote</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
