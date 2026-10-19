import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { deleteTranscript, getAudio, updateTranscript } from "../../data/repo";
import { INBOX, type Project, type SourceRef, type Transcript } from "../../data/types";
import { href } from "../../lib/router";
import { partPath } from "../project/modes";
import { byOrder, copyText, cx, plural, truncate, wordCount, formatDuration } from "../../lib/util";
import { timeForExcerpt } from "../../transcription/engines";
import { Dialog } from "../../ui/Dialog";
import { IconCopy, IconDoc, IconIdea, IconLeaf, IconOutline, IconPlay, IconQuestion, IconScissors, IconTrash, IconCheck } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Badge, Button, InlineEdit, Segmented } from "../../ui/ui";
import { appendToDocument, excerptToIdeaCard, excerptToNote, excerptToStructureCard, splitFragments } from "./derive";
import { orderStructure } from "../board/structureDoc";

export function TranscriptView({ transcript, project, highlight }: { transcript: Transcript; project: Project | null; highlight?: string | null }) {
  const projectId = project?.id ?? INBOX;
  const [view, setView] = useState<"working" | "original">("working");
  const [text, setText] = useState(transcript.text);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [fragmentsOpen, setFragmentsOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);
  latest.current = text;
  const edited = text !== transcript.original;

  const { data: audioUrl } = useLive(
    async () => {
      if (!transcript.recordingId) return null;
      const blob = await getAudio(transcript.recordingId);
      return blob ? URL.createObjectURL(blob) : null;
    },
    [transcript.recordingId],
    [],
  );
  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const { data: ctx } = useLive(
    async () => {
      if (projectId === INBOX) return { docs: [], sections: [], derived: [] as { id: string; title: string; kind: "note" | "card"; to: string }[] };
      const [docs, boards, sections, notes, cards] = await Promise.all([
        db.byIndex("documents", "projectId", projectId),
        db.byIndex("boards", "projectId", projectId),
        db.byIndex("sections", "projectId", projectId),
        db.byIndex("notes", "projectId", projectId),
        db.byIndex("cards", "projectId", projectId),
      ]);
      const structure = boards.find((b) => b.kind === "structure");
      const derived = [
        ...notes.filter((n) => n.source?.id === transcript.id).map((n) => ({ id: n.id, title: n.title || truncate(n.body, 50), kind: "note" as const, to: href(partPath(projectId, "leaves"), { note: n.id }) })),
        ...cards
          .filter((c) => c.source?.id === transcript.id)
          .filter((c) => c.boardId === structure?.id)
          .map((c) => ({ id: c.id, title: c.title || truncate(c.body, 50), kind: "card" as const, to: href(partPath(projectId, "trunk"), { card: c.id }) })),
      ];
      return { docs: [...docs].sort(byOrder), sections: orderStructure(sections.filter((s) => s.boardId === structure?.id), []).filter((c) => c.section).map((c) => c.section!), derived };
    },
    [projectId, transcript.id],
    ["documents", "boards", "sections", "notes", "cards"],
  );

  useEffect(() => {
    if (document.activeElement !== area.current) setText(transcript.text);
  }, [transcript.text]);

  // Arriving from a derived note or card: select the passage it came from.
  useEffect(() => {
    if (!highlight || !area.current) return;
    const i = transcript.text.indexOf(highlight.slice(0, 80));
    if (i < 0) return;
    const el = area.current;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(i, i + highlight.length);
      setSel({ start: i, end: i + highlight.length });
      const lineHeight = 28;
      const before = transcript.text.slice(0, i).split("\n").length + Math.floor(i / 70);
      el.closest(".scroll-y")?.scrollTo({ top: Math.max(0, before * lineHeight - 160), behavior: "smooth" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, transcript.id]);

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (latest.current !== transcript.text) void updateTranscript(transcript.id, { text: latest.current }).catch(() => undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const autosize = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autosize, [text, view]);

  const excerpt = sel ? text.slice(sel.start, sel.end).trim() : "";
  const source = (): SourceRef => ({ type: "transcript", id: transcript.id, excerpt: truncate(excerpt, 280), start: sel?.start, end: sel?.end, time: timeForExcerpt(transcript.original, transcript.segments, excerpt) });
  const time = excerpt ? timeForExcerpt(transcript.original, transcript.segments, excerpt) : undefined;
  const inInbox = projectId === INBOX;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast(label);
    } catch (e) {
      toastError(e);
    }
  };

  const updateSel = () => {
    const el = area.current;
    if (!el) return;
    setSel(el.selectionStart !== el.selectionEnd ? { start: el.selectionStart, end: el.selectionEnd } : null);
  };
  // Track selection however it changes (mouse, keyboard, touch handles, assistive tech).
  useEffect(() => {
    const onChange = () => {
      if (document.activeElement === area.current) updateSel();
    };
    const el = area.current;
    document.addEventListener("selectionchange", onChange);
    el?.addEventListener("select", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      el?.removeEventListener("select", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <article className="transcript">
      <header className="transcript-head">
        <InlineEdit label="Transcript title" className="detail-title" value={transcript.title} onCommit={(title) => void updateTranscript(transcript.id, { title }).catch(toastError)} />
        <div className="row gap-2 wrap">
          <Badge>{transcript.engine}</Badge>
          {edited ? <Badge tone="warm">Edited — original kept</Badge> : <Badge tone="moss">Verbatim</Badge>}
          <span className="muted small">{plural(wordCount(text), "word")}</span>
        </div>
      </header>
      {audioUrl && <audio ref={audio} controls src={audioUrl} className="transcript-audio" />}
      <div className="transcript-tools">
        <Segmented
          size="sm"
          label="Version"
          value={view}
          onChange={setView}
          options={[
            { value: "working", label: "Working copy" },
            { value: "original", label: "Original" },
          ]}
        />
        <span className="grow" />
        <Button size="sm" variant="ghost" icon={IconScissors} onClick={() => setFragmentsOpen(true)}>
          Find the leaves
        </Button>
        <Menu
          label="Transcript actions"
          trigger={(t) => <Button {...t} size="sm" variant="ghost" icon={IconTrash} aria-label="Delete transcript" />}
          items={[
            {
              label: "Delete transcript (keep recording)",
              danger: true,
              icon: IconTrash,
              onSelect: () => void deleteTranscript(transcript.id).then((r) => toastUndo("Transcript deleted.", r)).catch(toastError),
            },
          ]}
        />
      </div>

      {sel && excerpt && view === "working" && (
        <div className="extract-bar" role="toolbar" aria-label="Use the selected passage" onMouseDown={(e) => e.preventDefault()}>
          <span className="extract-count">{plural(wordCount(excerpt), "word")}</span>
          <Button size="sm" variant="ghost" icon={IconLeaf} onClick={() => void run(inInbox ? "Kept as a seed, linked to this passage." : "Kept as a leaf, linked to this passage.", () => excerptToNote(projectId, excerpt, source(), "fragment"))}>
            {inInbox ? "Keep" : "Leaf"}
          </Button>
          {!inInbox && (
            <>
              <Button size="sm" variant="ghost" icon={IconIdea} onClick={() => void run("Put on the storyboard, linked to this passage.", () => excerptToIdeaCard(projectId, excerpt, source()))}>
                Storyboard
              </Button>
              <Menu
                label="Carry onto the trunk"
                align="start"
                trigger={(t) => (
                  <Button {...t} size="sm" variant="ghost" icon={IconOutline}>
                    Trunk
                  </Button>
                )}
                items={[
                  { heading: "Carry onto the trunk, in" },
                  ...(ctx?.sections ?? []).map((s) => ({ label: s.title, onSelect: () => void run(`Carried onto the trunk, in “${s.title}”.`, () => excerptToStructureCard(projectId, s.id, excerpt, source())) })),
                  { label: "Not placed yet", onSelect: () => void run("Carried onto the trunk.", () => excerptToStructureCard(projectId, null, excerpt, source())) },
                ]}
              />
              <Menu
                label="Add to a draft"
                align="start"
                trigger={(t) => (
                  <Button {...t} size="sm" variant="ghost" icon={IconDoc}>
                    Draft
                  </Button>
                )}
                items={
                  ctx?.docs.length
                    ? ctx.docs.flatMap((d) => [
                        { heading: d.title },
                        { label: "Add as a quote", onSelect: () => void run(`Added to “${d.title}”.`, () => appendToDocument(d.id, excerpt, true)) },
                        { label: "Add as text", onSelect: () => void run(`Added to “${d.title}”.`, () => appendToDocument(d.id, excerpt, false)) },
                      ])
                    : [{ label: "No drafts yet — grow one on the trunk", disabled: true, onSelect: () => undefined }]
                }
              />
            </>
          )}
          <Button size="sm" variant="ghost" icon={IconCopy} onClick={() => void copyText(excerpt).then((ok) => toast(ok ? "Copied." : "Couldn't copy."))}>
            Copy
          </Button>
          {time !== undefined && audio.current && (
            <Button
              size="sm"
              variant="ghost"
              icon={IconPlay}
              onClick={() => {
                if (audio.current) {
                  audio.current.currentTime = time;
                  void audio.current.play();
                }
              }}
            >
              {formatDuration(time)}
            </Button>
          )}
        </div>
      )}
      {!sel && view === "working" && <p className="extract-hint muted small">Select any passage worth keeping: make it a leaf, put it on the storyboard, carry it onto the trunk, or add it to the draft. The transcript itself stays as it is.</p>}
      {inInbox && sel && <p className="muted small">Plant this recording in a project to carry passages onto its trunk or into a draft.</p>}

      {view === "working" ? (
        <textarea
          ref={area}
          className="transcript-text"
          value={text}
          aria-label="Transcript (working copy)"
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
              saveTimer.current = null;
              void updateTranscript(transcript.id, { text: latest.current }).catch(toastError);
            }, 600);
          }}
          onSelect={updateSel}
          onKeyUp={updateSel}
          onMouseUp={updateSel}
          onBlur={() => setTimeout(updateSel, 0)}
        />
      ) : (
        <div className="transcript-original" aria-label="Original transcript, read only">
          {transcript.original}
          {edited && (
            <div className="row gap-2" style={{ marginTop: 16 }}>
              <Button size="sm" onClick={() => void updateTranscript(transcript.id, { text: transcript.original }).then(() => setView("working")).catch(toastError)}>
                Reset working copy to the original
              </Button>
            </div>
          )}
        </div>
      )}

      {ctx && ctx.derived.length > 0 && (
        <section className="derived">
          <h3 className="eyebrow">Kept from this recording</h3>
          <div className="chip-row">
            {ctx.derived.map((d) => (
              <a key={d.id} className="chip" href={d.to}>
                {d.kind === "note" ? <IconLeaf size={13} aria-hidden /> : <IconOutline size={13} aria-hidden />}
                <span>{d.title || "Untitled"}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      <FragmentsDialog open={fragmentsOpen} onClose={() => setFragmentsOpen(false)} transcript={{ ...transcript, text }} projectId={projectId} />
    </article>
  );
}

function FragmentsDialog({ open, onClose, transcript, projectId }: { open: boolean; onClose: () => void; transcript: Transcript; projectId: string }) {
  const fragments = useMemo(() => (open ? splitFragments(transcript.text) : []), [open, transcript.text]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  
  const [as, setAs] = useState<"leaves" | "storyboard">("leaves");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPicked(new Set());
  }, [open]);
  const save = async () => {
    setBusy(true);
    try {
      for (const i of [...picked].sort((a, b) => a - b)) {
        const f = fragments[i];
        const start = transcript.text.indexOf(f);
        const src: SourceRef = { type: "transcript", id: transcript.id, excerpt: truncate(f, 280), start, end: start + f.length, time: timeForExcerpt(transcript.original, transcript.segments, f) };
        if (as === "storyboard" && projectId !== INBOX) await excerptToIdeaCard(projectId, f, src);
        else await excerptToNote(projectId, f, src, "fragment");
      }
      toast(as === "storyboard" && projectId !== INBOX ? `${plural(picked.size, "card")} put on the storyboard, each linked to its passage.` : `${plural(picked.size, projectId === INBOX ? "seed" : "leaf", projectId === INBOX ? "seeds" : "leaves")} kept, each linked to its passage.`);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Find the leaves"
      description="Miki split the transcript at paragraph and sentence breaks — nothing is rewritten or summarised. Keep the ones that matter; the rest stay in the transcript."
      footer={
        <>
          {projectId !== INBOX && (
            <Segmented
              size="sm"
              label="Keep as"
              value={as}
              onChange={setAs}
              options={[
                { value: "leaves", label: "Leaves" },
                { value: "storyboard", label: "Storyboard cards" },
              ]}
            />
          )}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.size} busy={busy} onClick={() => void save()}>
            Keep {picked.size || ""}
          </Button>
        </>
      }
    >
      <ul className="fragments" role="list">
        {fragments.map((f, i) => (
          <li key={i}>
            <label className={cx("fragment", picked.has(i) && "is-picked")}>
              <input
                type="checkbox"
                checked={picked.has(i)}
                onChange={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
              />
              <span className="fragment-text">{f}</span>
              {picked.has(i) && <IconCheck size={15} aria-hidden className="fragment-check" />}
            </label>
          </li>
        ))}
        {fragments.length === 0 && (
          <li className="muted">
            <IconQuestion size={14} aria-hidden /> The transcript is empty.
          </li>
        )}
      </ul>
    </Dialog>
  );
}

