import { useMemo, useRef, useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { createNote, createTranscript } from "../../data/repo";
import type { Note, Project, Recording, Transcript } from "../../data/types";
import { href, setQuery } from "../../lib/router";
import { openCapture } from "../../lib/store";
import { useIsNarrow } from "../../lib/useMedia";
import { cx, deriveTitle, formatDuration, modKey, relativeTime, truncate } from "../../lib/util";
import { parseTranscriptFile } from "../../transcription/engines";
import { IconArrowLeft, IconAudio, IconCapture, IconImport, IconMic, IconNote, IconQuestion, IconIdea, IconQuote } from "../../ui/icons";
import { toast, toastError } from "../../ui/toast";
import { Badge, Button, EmptyState, IconButton, Segmented, TextArea } from "../../ui/ui";
import { NoteDetail } from "./NoteDetail";
import { RecordingView } from "./RecordingView";
import { TranscriptView } from "./TranscriptView";
import "./capture.css";

type Filter = "all" | "notes" | "voice";
type Item =
  | { kind: "note"; id: string; at: number; note: Note }
  | { kind: "rec"; id: string; at: number; rec: Recording }
  | { kind: "tr"; id: string; at: number; tr: Transcript };

const NOTE_ICON = { note: IconNote, fragment: IconNote, idea: IconIdea, question: IconQuestion, quote: IconQuote };

/** The capture surface for a project, or for Unsorted (projectId = INBOX). */
export function CaptureWorkspace({ projectId, project, query, basePath, intro }: { projectId: string; project: Project | null; query: URLSearchParams; basePath: string; intro?: React.ReactNode }) {
  const { data } = useLive(
    async () => {
      const [notes, recordings, transcripts] = await Promise.all([
        db.byIndex("notes", "projectId", projectId),
        db.byIndex("recordings", "projectId", projectId),
        db.byIndex("transcripts", "projectId", projectId),
      ]);
      return { notes, recordings, transcripts };
    },
    [projectId],
    ["notes", "recordings", "transcripts"],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [quick, setQuick] = useState("");
  const narrow = useIsNarrow();
  const fileRef = useRef<HTMLInputElement>(null);

  const items = useMemo((): Item[] => {
    if (!data) return [];
    const withRecording = new Set(data.recordings.map((r) => r.id));
    const all: Item[] = [
      ...data.notes.map((n) => ({ kind: "note" as const, id: n.id, at: n.updatedAt, note: n })),
      ...data.recordings.map((r) => ({ kind: "rec" as const, id: r.id, at: r.createdAt, rec: r })),
      ...data.transcripts.filter((t) => !t.recordingId || !withRecording.has(t.recordingId)).map((t) => ({ kind: "tr" as const, id: t.id, at: t.createdAt, tr: t })),
    ];
    return all.filter((i) => filter === "all" || (filter === "notes" ? i.kind === "note" : i.kind !== "note")).sort((a, b) => b.at - a.at);
  }, [data, filter]);

  const selNote = query.get("note");
  const selRec = query.get("rec");
  const selTr = query.get("tr");
  const hl = query.get("hl");
  const note = data?.notes.find((n) => n.id === selNote);
  const rec = data?.recordings.find((r) => r.id === selRec) ?? (selTr ? data?.recordings.find((r) => r.transcriptId === selTr) : undefined);
  const tr = !rec && selTr ? data?.transcripts.find((t) => t.id === selTr) : undefined;
  const hasSelection = Boolean(note || rec || tr);
  const clear = () => setQuery({ note: null, rec: null, tr: null, hl: null });

  const addQuick = async () => {
    const body = quick.trim();
    if (!body) return;
    try {
      const n = await createNote({ projectId, title: deriveTitle(body).length < body.length ? deriveTitle(body) : "", body });
      setQuick("");
      if (!narrow) setQuery({ note: n.id, rec: null, tr: null, hl: null });
    } catch (e) {
      toastError(e, "Couldn't save.");
    }
  };

  const importTranscript = async (file: File) => {
    try {
      const raw = await file.text();
      const { text, segments } = parseTranscriptFile(raw, file.name);
      if (!text.trim()) throw new Error("That file doesn't contain any text.");
      const t = await createTranscript({ projectId, title: file.name.replace(/\.[^.]+$/, ""), text, segments, engine: `Imported from ${file.name}` });
      setQuery({ tr: t.id, note: null, rec: null, hl: null });
      toast("Transcript imported.");
    } catch (e) {
      toastError(e, "Couldn't import that file.");
    }
  };

  const showList = !narrow || !hasSelection;
  const showDetail = !narrow || hasSelection;

  return (
    <div className={cx("capture", hasSelection && "has-selection")}>
      {showList && (
        <aside className="capture-list" aria-label="Captured material">
          {intro}
          <div className="quick-add">
            <TextArea
              minRows={2}
              maxHeight={200}
              placeholder="Start with what you have…"
              value={quick}
              aria-label="Quick note"
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void addQuick();
                }
              }}
            />
            <div className="quick-add-foot">
              <span className="faint small">{modKey} + Enter to save</span>
              <span className="grow" />
              <IconButton icon={IconImport} label="Import a transcript file (.txt, .vtt, .srt)" size="sm" onClick={() => fileRef.current?.click()} />
              <Button size="sm" icon={IconMic} onClick={() => openCapture({ tab: "speak", projectId })}>
                Record
              </Button>
              <Button size="sm" variant="primary" disabled={!quick.trim()} onClick={() => void addQuick()}>
                Save
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".txt,.md,.vtt,.srt,text/plain,text/vtt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importTranscript(f);
                e.target.value = "";
              }}
            />
          </div>
          <Segmented
            size="sm"
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "notes", label: "Notes" },
              { value: "voice", label: "Voice" },
            ]}
          />
          <ul className="capture-items scroll-y" role="list">
            {items.length === 0 && (
              <li>
                <EmptyState compact icon={IconCapture} title={filter === "voice" ? "No recordings yet" : "Nothing captured yet"}>
                  {filter === "voice" ? "Talk an idea through — Miki keeps the audio and helps you pull out what matters." : "Jot something above, or press C anywhere."}
                </EmptyState>
              </li>
            )}
            {items.map((i) => {
              const active = (i.kind === "note" && i.id === note?.id) || (i.kind === "rec" && i.id === rec?.id) || (i.kind === "tr" && i.id === tr?.id);
              const to = href(basePath, { [i.kind]: i.id });
              if (i.kind === "note") {
                const Icon = NOTE_ICON[i.note.kind] ?? IconNote;
                return (
                  <li key={i.id}>
                    <a className={cx("capture-item", active && "is-active")} href={to} aria-current={active ? "true" : undefined}>
                      <Icon size={15} aria-hidden className="capture-item-icon" />
                      <span className="grow">
                        <span className="capture-item-title">{i.note.title || truncate(i.note.body, 80) || "Empty note"}</span>
                        {i.note.title && i.note.body && <span className="capture-item-body">{truncate(i.note.body, 110)}</span>}
                        <span className="capture-item-meta">
                          {i.note.kind !== "note" && `${i.note.kind} · `}
                          {relativeTime(i.at)}
                          {i.note.source && " · from a recording"}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              }
              if (i.kind === "rec") {
                return (
                  <li key={i.id}>
                    <a className={cx("capture-item", active && "is-active")} href={to} aria-current={active ? "true" : undefined}>
                      <IconAudio size={15} aria-hidden className="capture-item-icon" />
                      <span className="grow">
                        <span className="capture-item-title">{i.rec.title}</span>
                        <span className="capture-item-meta">
                          {formatDuration(i.rec.duration)} · {relativeTime(i.at)}{" "}
                          {i.rec.status === "transcribed" ? (
                            <Badge tone="moss">Transcribed</Badge>
                          ) : i.rec.status === "failed" ? (
                            <Badge tone="danger">Needs attention</Badge>
                          ) : i.rec.status === "transcribing" ? (
                            <Badge tone="warm">Transcribing</Badge>
                          ) : (
                            <Badge>Audio only</Badge>
                          )}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              }
              return (
                <li key={i.id}>
                  <a className={cx("capture-item", active && "is-active")} href={to} aria-current={active ? "true" : undefined}>
                    <IconAudio size={15} aria-hidden className="capture-item-icon" />
                    <span className="grow">
                      <span className="capture-item-title">{i.tr.title}</span>
                      <span className="capture-item-meta">
                        transcript · {relativeTime(i.at)}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
      {showDetail && (
        <section className="capture-detail scroll-y" aria-label="Selected item">
          {narrow && hasSelection && (
            <button type="button" className="capture-back" onClick={clear}>
              <IconArrowLeft size={16} aria-hidden /> All captures
            </button>
          )}
          {note ? (
            <NoteDetail key={note.id} note={note} project={project} onDeleted={clear} />
          ) : rec ? (
            <RecordingView key={rec.id} recording={rec} project={project} highlight={hl} onDeleted={clear} />
          ) : tr ? (
            <div className="detail">
              <TranscriptView key={tr.id} transcript={tr} project={project} highlight={hl} />
            </div>
          ) : (selNote || selRec || selTr) && data ? (
            <EmptyState compact title="That item isn't here">It may have been deleted or moved to another project.</EmptyState>
          ) : (
            <EmptyState icon={IconCapture} title="Capture before you organize">
              Write or talk your way into it. Select anything on the left to shape it into notes, cards, or a draft — with a link back to where it came from.
            </EmptyState>
          )}
        </section>
      )}
    </div>
  );
}
