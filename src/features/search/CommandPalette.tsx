import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { INBOX, type EntityType } from "../../data/types";
import { getTheme, setTheme } from "../../lib/appearance";
import { href, navigate, projectPath } from "../../lib/router";
import { openCapture, ui } from "../../lib/store";
import { cx, truncate } from "../../lib/util";
import { Dialog } from "../../ui/Dialog";
import {
  IconAudio,
  IconDoc,
  IconGrid,
  IconIdea,
  IconInbox,
  IconKeyboard,
  IconLibrary,
  IconMic,
  IconMoon,
  IconNote,
  IconPen,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSignpost,
  IconSun,
} from "../../ui/icons";
import { NewProjectDialog } from "../studio/NewProjectDialog";
import "./search.css";

interface Result {
  key: string;
  group: string;
  title: string;
  detail?: string;
  icon: typeof IconDoc;
  run: () => void;
  score: number;
}

const ICON: Partial<Record<EntityType, typeof IconDoc>> = { document: IconDoc, note: IconNote, card: IconIdea, reference: IconLibrary, transcript: IconAudio, decision: IconSignpost, project: IconGrid };

function snippet(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return truncate(text, 90);
  const start = Math.max(0, i - 36);
  return (start > 0 ? "…" : "") + text.slice(start, i + needle.length + 60).replace(/\s+/g, " ").trim() + "…";
}

function score(title: string, body: string, needle: string): number {
  const t = title.toLowerCase();
  if (t === needle) return 100;
  if (t.startsWith(needle)) return 80;
  if (t.includes(needle)) return 60;
  if (body.toLowerCase().includes(needle)) return 30;
  return 0;
}

/** ⌘K: jump anywhere, find anything, start anything. Searches only this device's data. */
export function CommandPalette() {
  const open = ui.use((s) => s.palette);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const { data } = useLive(
    async () => {
      if (!open) return null;
      const [projects, documents, notes, cards, references, transcripts, decisions] = await Promise.all([
        db.getAll("projects"),
        db.getAll("documents"),
        db.getAll("notes"),
        db.getAll("cards"),
        db.getAll("references"),
        db.getAll("transcripts"),
        db.getAll("decisions"),
      ]);
      return { projects, documents, notes, cards, references, transcripts, decisions };
    },
    [open],
    [],
  );

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
    }
  }, [open]);

  const close = () => ui.set({ palette: false });

  const results = useMemo((): Result[] => {
    const needle = q.trim().toLowerCase();
    const go = (fn: () => void) => () => {
      close();
      fn();
    };
    const commands: Result[] = [
      { key: "c:new", group: "Actions", title: "New project", icon: IconPlus, run: () => { close(); setNewOpen(true); }, score: 0 },
      { key: "c:capture", group: "Actions", title: "Capture a thought", detail: "C", icon: IconPen, run: go(() => openCapture({ tab: "write" })), score: 0 },
      { key: "c:record", group: "Actions", title: "Record a voice note", detail: "R", icon: IconMic, run: go(() => openCapture({ tab: "speak" })), score: 0 },
      { key: "c:studio", group: "Actions", title: "Go to the studio", icon: IconGrid, run: go(() => navigate("/")), score: 0 },
      { key: "c:inbox", group: "Actions", title: "Open Unsorted", icon: IconInbox, run: go(() => navigate("/inbox")), score: 0 },
      { key: "c:settings", group: "Actions", title: "Settings, backups, and storage", icon: IconSettings, run: go(() => navigate("/settings")), score: 0 },
      {
        key: "c:theme",
        group: "Actions",
        title: getTheme() === "dark" ? "Switch to the paper theme" : "Switch to the night theme",
        icon: getTheme() === "dark" ? IconSun : IconMoon,
        run: go(() => setTheme(getTheme() === "dark" ? "light" : "dark")),
        score: 0,
      },
      { key: "c:keys", group: "Actions", title: "Keyboard shortcuts", detail: "?", icon: IconKeyboard, run: go(() => ui.set({ shortcuts: true })), score: 0 },
    ];
    if (!data) return commands;
    const projectTitle = new Map(data.projects.map((p) => [p.id, p.title]));
    const where = (pid: string) => (pid === INBOX ? "Unsorted" : (projectTitle.get(pid) ?? ""));
    if (!needle) {
      const recent = [...data.projects]
        .filter((p) => !p.archived)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
        .slice(0, 5)
        .map((p) => ({ key: `p:${p.id}`, group: "Recent projects", title: p.title, detail: p.thread || p.description, icon: IconGrid, run: go(() => navigate(projectPath(p.id, p.lastLocation?.mode))), score: 0 }));
      return [...recent, ...commands];
    }
    const out: Result[] = commands.filter((c) => c.title.toLowerCase().includes(needle)).map((c) => ({ ...c, score: 50 }));
    for (const p of data.projects) {
      const s = score(p.title, `${p.thread} ${p.description}`, needle);
      if (s) out.push({ key: `p:${p.id}`, group: "Projects", title: p.title, detail: p.thread || p.description, icon: ICON.project!, run: go(() => navigate(projectPath(p.id))), score: s + 5 });
    }
    for (const d of data.documents) {
      const s = score(d.title, d.plainText, needle);
      if (s) out.push({ key: `d:${d.id}`, group: "Drafts", title: d.title, detail: `${where(d.projectId)} · ${s < 60 ? snippet(d.plainText, needle) : `${d.wordCount} words`}`, icon: IconDoc, run: go(() => navigate(projectPath(d.projectId, "write"), { doc: d.id })), score: s });
    }
    for (const n of data.notes) {
      const s = score(n.title, n.body, needle);
      if (s)
        out.push({
          key: `n:${n.id}`,
          group: "Notes",
          title: n.title || truncate(n.body, 60),
          detail: `${where(n.projectId)} · ${snippet(n.body, needle)}`,
          icon: IconNote,
          run: go(() => (n.projectId === INBOX ? navigate("/inbox", { note: n.id }) : navigate(projectPath(n.projectId, "capture"), { note: n.id }))),
          score: s,
        });
    }
    for (const c of data.cards) {
      const s = score(c.title, c.body, needle);
      if (!s) continue;
      out.push({
        key: `c:${c.id}`,
        group: "Cards",
        title: c.title || truncate(c.body, 60),
        detail: `${where(c.projectId)} · ${snippet(c.body, needle)}`,
        icon: IconIdea,
        run: go(async () => {
          const b = await db.get("boards", c.boardId);
          navigate(projectPath(c.projectId, b?.kind === "structure" ? "arrange" : "explore"), { card: c.id });
        }),
        score: s,
      });
    }
    for (const r of data.references) {
      const s = score(r.title, `${r.summary} ${r.body}`, needle);
      if (s) out.push({ key: `r:${r.id}`, group: "References", title: r.title, detail: `${where(r.projectId)} · ${r.kind}`, icon: IconLibrary, run: go(() => navigate(projectPath(r.projectId, "reference"), { ref: r.id })), score: s });
    }
    for (const t of data.transcripts) {
      const s = score(t.title, t.text, needle);
      if (s)
        out.push({
          key: `t:${t.id}`,
          group: "Transcripts",
          title: t.title,
          detail: `${where(t.projectId)} · ${snippet(t.text, needle)}`,
          icon: IconAudio,
          run: go(() => (t.projectId === INBOX ? navigate("/inbox", { tr: t.id, hl: q.trim() }) : navigate(projectPath(t.projectId, "capture"), { tr: t.id }))),
          score: s,
        });
    }
    for (const d of data.decisions) {
      const s = score(d.question, `${d.rationale} ${d.options.map((o) => o.text).join(" ")}`, needle);
      if (s) out.push({ key: `x:${d.id}`, group: "Decisions", title: d.question || "Untitled decision", detail: where(d.projectId), icon: IconSignpost, run: go(() => navigate(projectPath(d.projectId, "discern"), { decision: d.id })), score: s });
    }
    const order = ["Actions", "Projects", "Drafts", "Notes", "Cards", "Transcripts", "References", "Decisions"];
    return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.score - a.score).slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  let lastGroup = "";
  return (
    <>
      <Dialog open={open} onClose={close} title="Search" hideTitle size="lg" className="palette">
        <div className="palette-input">
          <IconSearch size={18} aria-hidden />
          <input
            autoFocus
            data-autofocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search drafts, notes, cards, transcripts… or type a command"
            aria-label="Search everything"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[index] ? `pr-${index}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                results[index]?.run();
              }
            }}
          />
        </div>
        <ul className="palette-results" id="palette-results" role="listbox" ref={listRef} aria-label="Results">
          {results.length === 0 && <li className="palette-empty">Nothing matches “{q}”. Search looks through everything stored in this browser.</li>}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <li key={r.key} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <div
                  id={`pr-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  className={cx("palette-item", i === index && "is-active")}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => r.run()}
                >
                  <r.icon size={16} aria-hidden />
                  <span className="grow">
                    <span className="palette-title">{r.title}</span>
                    {r.detail && <span className="palette-detail">{r.detail}</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="palette-foot">
          <span>↑↓ to move · Enter to open · Esc to close</span>
          <a href={href("/settings")} onClick={close}>
            Searching this device only
          </a>
        </p>
      </Dialog>
      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}
