import { useEffect, useMemo, useRef, useState } from "react";
import { useAll } from "../../data/hooks";
import { createNote, createTranscript, getPref, saveRecording, setPref } from "../../data/repo";
import { INBOX, type NoteKind } from "../../data/types";
import { href, navigate, projectPath } from "../../lib/router";
import { ui } from "../../lib/store";
import { cx, deriveTitle, formatBytes, formatDuration, modKey, plural, wordCount } from "../../lib/util";
import { liveDictationSupported, startLiveDictation, type LiveDictation } from "../../transcription/engines";
import { recordingSupported, useRecorder } from "../../transcription/recorder";
import { Dialog, confirmDialog } from "../../ui/Dialog";
import { IconMic, IconPause, IconPen, IconPlay, IconStop, IconTrash, IconWarning } from "../../ui/icons";
import { toast, toastError } from "../../ui/toast";
import { Button, Segmented, Select, TextArea, TextInput } from "../../ui/ui";
import "./capture.css";

const KINDS: { value: NoteKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "idea", label: "Idea" },
  { value: "question", label: "Question" },
  { value: "quote", label: "Quote" },
];

/** Capture from anywhere: write or speak, decide where it belongs later (or never). */
export function CaptureDialog() {
  const req = ui.use((s) => s.capture);
  const open = Boolean(req);
  const [tab, setTab] = useState<"write" | "speak">("write");
  const [dest, setDest] = useState<string>(INBOX);
  const [recordingActive, setRecordingActive] = useState(false);
  const { data: projects } = useAll("projects");
  const destinations = useMemo(
    () => [{ value: INBOX, label: "Unsorted" }, ...(projects ?? []).filter((p) => !p.archived).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).map((p) => ({ value: p.id, label: p.title }))],
    [projects],
  );

  useEffect(() => {
    if (req) {
      setTab(req.tab);
      setDest(req.projectId ?? INBOX);
    }
  }, [req]);

  const close = async () => {
    if (recordingActive) {
      const ok = await confirmDialog({ title: "Discard this recording?", body: "It hasn't been saved yet.", confirmLabel: "Discard", tone: "danger", cancelLabel: "Keep recording" });
      if (!ok) return;
    }
    ui.set({ capture: null });
  };

  return (
    <Dialog open={open} onClose={() => void close()} title="Capture" hideTitle size="md" className="capture-dialog">
      <div className="capture-top">
        <Segmented
          label="Capture mode"
          value={tab}
          onChange={(v) => {
            if (!recordingActive) setTab(v);
          }}
          options={[
            { value: "write", label: "Write", icon: IconPen },
            { value: "speak", label: "Speak", icon: IconMic },
          ]}
        />
        <label className="capture-dest">
          <span className="muted small">Save to</span>
          <Select label="Destination" value={dest} onChange={setDest} options={destinations} />
        </label>
      </div>
      {open && (tab === "write" ? <WriteCapture dest={dest} destLabel={destinations.find((d) => d.value === dest)?.label ?? "Unsorted"} onDone={() => ui.set({ capture: null })} /> : <SpeakCapture dest={dest} onActive={setRecordingActive} onDone={() => ui.set({ capture: null })} />)}
    </Dialog>
  );
}

function WriteCapture({ dest, destLabel, onDone }: { dest: string; destLabel: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<NoteKind>("note");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const save = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const note = await createNote({ projectId: dest, title: deriveTitle(body).length < body.trim().length ? deriveTitle(body) : "", body: body.trim(), kind });
      onDone();
      toast(`Saved to ${destLabel}.`, {
        action: {
          label: "Open",
          onClick: () => (dest === INBOX ? navigate("/inbox", { note: note.id }) : navigate(projectPath(dest, "capture"), { note: note.id })),
        },
      });
    } catch (e) {
      toastError(e, "Couldn't save the note.");
      setBusy(false);
    }
  };
  return (
    <div className="stack gap-3 capture-write">
      <TextArea
        ref={ref}
        minRows={5}
        maxHeight={360}
        className="capture-textarea"
        placeholder="Start with what you have. A sentence, a question, a fragment — paste anything."
        value={body}
        aria-label="Your note"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="capture-foot">
        <Segmented size="sm" label="Kind" value={kind} onChange={setKind} options={KINDS} />
        <span className="grow" />
        <span className="faint small hide-narrow">
          {modKey} + Enter
        </span>
        <Button variant="primary" onClick={() => void save()} disabled={!body.trim()} busy={busy}>
          Save
        </Button>
      </div>
    </div>
  );
}

function SpeakCapture({ dest, onActive, onDone }: { dest: string; onActive: (v: boolean) => void; onDone: () => void }) {
  const rec = useRecorder();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveText, setLiveText] = useState({ final: "", interim: "" });
  const [liveError, setLiveError] = useState<string | null>(null);
  const live = useRef<LiveDictation | null>(null);
  const finalLive = useRef("");
  const audioUrl = useMemo(() => (rec.result ? URL.createObjectURL(rec.result.blob) : null), [rec.result]);
  const support = recordingSupported();
  const canLive = liveDictationSupported();

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);
  useEffect(() => {
    void getPref<boolean>("capture:liveDictation", false).then(setLiveEnabled);
  }, []);
  useEffect(() => {
    onActive(rec.state === "recording" || rec.state === "paused" || rec.state === "stopped");
  }, [rec.state, onActive]);
  useEffect(() => () => live.current?.abort(), []);

  const begin = async () => {
    const ok = await rec.start();
    if (ok && liveEnabled && canLive) {
      setLiveText({ final: "", interim: "" });
      setLiveError(null);
      live.current = startLiveDictation(
        (f, i) => setLiveText({ final: f, interim: i }),
        (msg) => setLiveError(msg),
      );
    }
  };
  const finish = () => {
    finalLive.current = live.current?.stop() ?? "";
    live.current = null;
    rec.stop();
  };
  const discard = async () => {
    const ok = rec.elapsed < 4 || (await confirmDialog({ title: "Discard this recording?", body: "This can't be undone.", confirmLabel: "Discard", tone: "danger" }));
    if (!ok) return;
    live.current?.abort();
    live.current = null;
    rec.discard();
  };
  const save = async () => {
    if (!rec.result || busy) return;
    setBusy(true);
    try {
      const r = await saveRecording(rec.result.blob, { projectId: dest, title, duration: rec.result.duration });
      const text = finalLive.current || liveText.final;
      if (text.trim()) {
        await createTranscript({ projectId: dest, recordingId: r.id, title: r.title, text: text.trim(), engine: "Browser live dictation" });
      }
      onActive(false);
      onDone();
      const go = () => (dest === INBOX ? navigate("/inbox", { rec: r.id }) : navigate(projectPath(dest, "capture"), { rec: r.id }));
      go();
      toast(text.trim() ? "Recording and live transcript saved." : "Recording saved. You can transcribe it whenever you like.");
    } catch (e) {
      toastError(e, "Couldn't save the recording. It's still here — try again.");
      setBusy(false);
    }
  };

  if (!support.ok) {
    return (
      <div className="speak-unsupported">
        <IconWarning size={18} aria-hidden />
        <div>
          <p>
            <strong>Recording isn't available here.</strong> {support.reason}
          </p>
          <p className="muted small">
            You can still{" "}
            <a className="link-btn" href={href("/inbox")} onClick={onDone}>
              import a recording's transcript
            </a>{" "}
            or write the thought down.
          </p>
        </div>
      </div>
    );
  }

  const recording = rec.state === "recording" || rec.state === "paused";
  const words = wordCount(liveText.final);
  return (
    <div className="speak">
      {rec.state !== "stopped" && (
        <>
          <div className={cx("meter", recording && "is-live", rec.state === "paused" && "is-paused")} aria-hidden>
            {rec.levels.map((l, i) => (
              <span key={i} style={{ height: `${Math.max(6, l * 100)}%` }} />
            ))}
          </div>
          <div className="speak-status" role="status" aria-live="polite">
            {rec.state === "idle" && <p className="muted">Speak freely. Nothing leaves this device unless you choose to transcribe.</p>}
            {rec.state === "requesting" && <p className="muted">Waiting for microphone permission…</p>}
            {recording && (
              <p className="speak-time">
                <span className={cx("rec-dot", rec.state === "paused" && "is-paused")} aria-hidden />
                {rec.state === "paused" ? "Paused" : "Recording"} · <span className="tabular">{formatDuration(rec.elapsed)}</span>
              </p>
            )}
            {rec.state === "error" && (
              <p className="speak-error">
                <IconWarning size={15} aria-hidden /> {rec.error}
              </p>
            )}
          </div>
          {recording && liveEnabled && canLive && (
            <div className="live-text" aria-live="off">
              {liveText.final || liveText.interim ? (
                <>
                  {liveText.final} <span className="faint">{liveText.interim}</span>
                </>
              ) : (
                <span className="faint">Live transcript will appear here…</span>
              )}
              {liveError && <p className="speak-error small">{liveError}</p>}
            </div>
          )}
          <div className="speak-controls">
            {!recording ? (
              <button type="button" className="rec-btn" onClick={() => void begin()} disabled={rec.state === "requesting"} aria-label="Start recording">
                <IconMic size={26} aria-hidden />
              </button>
            ) : (
              <>
                <Button variant="ghost" icon={IconTrash} onClick={() => void discard()}>
                  Discard
                </Button>
                {rec.canPause && (
                  <Button icon={rec.state === "paused" ? IconPlay : IconPause} onClick={rec.state === "paused" ? rec.resume : rec.pause}>
                    {rec.state === "paused" ? "Resume" : "Pause"}
                  </Button>
                )}
                <button type="button" className="rec-btn is-stop" onClick={finish} aria-label="Stop recording">
                  <IconStop size={22} aria-hidden />
                </button>
              </>
            )}
          </div>
          {rec.state === "idle" || rec.state === "error" ? (
            canLive ? (
              <label className="live-toggle">
                <input
                  type="checkbox"
                  checked={liveEnabled}
                  onChange={(e) => {
                    setLiveEnabled(e.target.checked);
                    void setPref("capture:liveDictation", e.target.checked);
                  }}
                />
                <span>
                  <strong>Live transcript</strong> while recording, using your browser's speech recognition.{" "}
                  <span className="muted">In Chrome and Edge, this sends audio to the browser maker's speech service.</span>
                </span>
              </label>
            ) : null
          ) : null}
        </>
      )}
      {rec.state === "stopped" && rec.result && audioUrl && (
        <div className="review">
          <audio controls src={audioUrl} className="review-audio" />
          <p className="muted small">
            {formatDuration(rec.result.duration)} · {formatBytes(rec.result.blob.size)} · {rec.result.mimeType.split(";")[0]}
          </p>
          {(finalLive.current || liveText.final) && (
            <p className="review-live">
              Live transcript captured · {plural(wordCount(finalLive.current || liveText.final) || words, "word")}. It'll be saved with the recording as an editable transcript.
            </p>
          )}
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name it (optional)" aria-label="Recording name" />
          <div className="capture-foot">
            <Button variant="ghost" icon={IconTrash} onClick={() => void discard()}>
              Discard
            </Button>
            <span className="grow" />
            <Button variant="primary" onClick={() => void save()} busy={busy}>
              Save recording
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
