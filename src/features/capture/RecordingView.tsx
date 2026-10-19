import { partPath } from "../project/modes";
import { useEffect, useRef, useState } from "react";
import { useAll, useLive, useRecord } from "../../data/hooks";
import { createTranscript, deleteRecording, getAudio, getPref, moveToProject, setPref, updateRecording } from "../../data/repo";
import { Menu } from "../../ui/Menu";
import { navigate, } from "../../lib/router";
import type { Project, Recording } from "../../data/types";
import { formatBytes, formatDuration, relativeTime } from "../../lib/util";
import { getServerStatus, parseTranscriptFile, transcribeOnServer, TranscriptionError, type ServerStatus } from "../../transcription/engines";
import { confirmDialog } from "../../ui/Dialog";
import { IconMoveTo, IconAudio, IconDownload, IconImport, IconPen, IconRetry, IconTrash, IconWarning, IconInfo } from "../../ui/icons";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Badge, Button, InlineEdit, Spinner, TextArea } from "../../ui/ui";
import { downloadBlob, slugify } from "../../lib/util";
import { TranscriptView } from "./TranscriptView";

/** A saved recording and every honest path to text: a configured service, an imported file, or typing it out. */
export function RecordingView({ recording, project, highlight, onDeleted }: { recording: Recording; project: Project | null; highlight?: string | null; onDeleted: () => void }) {
  const { data: transcript } = useRecord("transcripts", recording.transcriptId);
  const { data: audioUrl } = useLive(
    async () => {
      const blob = await getAudio(recording.id);
      return blob ? URL.createObjectURL(blob) : null;
    },
    [recording.id],
    [],
  );
  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const remove = async () => {
    const ok = await confirmDialog({
      title: "Delete this recording?",
      body: "The audio and its transcript will be removed. Leaves and trunk parts you kept from it stay.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const restore = await deleteRecording(recording.id);
      onDeleted();
      toastUndo("Recording deleted.", restore);
    } catch (e) {
      toastError(e);
    }
  };

  const download = async () => {
    const blob = await getAudio(recording.id);
    if (!blob) return toast("The audio for this recording is missing.", { tone: "error" });
    const ext = /mp4|aac|m4a/.test(recording.mimeType) ? "m4a" : /ogg/.test(recording.mimeType) ? "ogg" : "webm";
    downloadBlob(blob, `${slugify(recording.title)}.${ext}`);
  };

  if (transcript) {
    return (
      <div className="detail">
        <TranscriptView transcript={transcript} project={project} highlight={highlight} />
        <footer className="detail-foot">
          {!project && <MoveRecording recording={recording} />}
          <Button size="sm" variant="ghost" icon={IconDownload} onClick={() => void download()}>
            Download audio
          </Button>
          <Button size="sm" variant="ghost" icon={IconTrash} className="danger-text" onClick={() => void remove()}>
            Delete recording
          </Button>
        </footer>
      </div>
    );
  }

  return (
    <div className="detail">
      <header className="transcript-head">
        <InlineEdit label="Recording title" className="detail-title" value={recording.title} onCommit={(title) => void updateRecording(recording.id, { title }).catch(toastError)} />
        <div className="row gap-2 wrap">
          <Badge>
            <IconAudio size={12} aria-hidden /> {formatDuration(recording.duration)}
          </Badge>
          <span className="muted small">
            {formatBytes(recording.size)} · recorded {relativeTime(recording.createdAt)}
          </span>
        </div>
      </header>
      {audioUrl ? <audio controls src={audioUrl} className="transcript-audio" /> : <p className="muted small">Loading audio…</p>}
      <TranscribePanel recording={recording} />
      <footer className="detail-foot">
        {!project && <MoveRecording recording={recording} />}
        <Button size="sm" variant="ghost" icon={IconDownload} onClick={() => void download()}>
          Download audio
        </Button>
        <Button size="sm" variant="ghost" icon={IconTrash} className="danger-text" onClick={() => void remove()}>
          Delete recording
        </Button>
      </footer>
    </div>
  );
}

function TranscribePanel({ recording }: { recording: Recording }) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const working = recording.status === "transcribing";

  useEffect(() => {
    void getServerStatus().then(setStatus);
  }, []);
  useEffect(() => () => abort.current?.abort(), []);

  // A "transcribing" status left over from a closed tab is stale: let the writer retry.
  useEffect(() => {
    if (recording.status === "transcribing" && !abort.current && Date.now() - recording.updatedAt > 5 * 60_000) {
      void updateRecording(recording.id, { status: "failed", error: "Transcription was interrupted." });
    }
  }, [recording]);

  const transcribe = async () => {
    if (!status?.available) return;
    const consentKey = `transcription:consent:${status.provider}`;
    const consented = await getPref<boolean>(consentKey, false);
    if (!consented) {
      const ok = await confirmDialog({
        title: "Send this recording for transcription?",
        body: (
          <>
            <p>
              The audio will be sent through this Miki server to <strong>{status.provider}</strong>
              {status.model ? ` (${status.model})` : ""} to be converted to text. Only this recording is sent — never your drafts or notes.
            </p>
            <p>You'll only be asked once for this service.</p>
          </>
        ),
        confirmLabel: "Transcribe",
      });
      if (!ok) return;
      await setPref(consentKey, true);
    }
    const blob = await getAudio(recording.id);
    if (!blob) {
      toast("The audio for this recording is missing.", { tone: "error" });
      return;
    }
    if (status.maxBytes && blob.size > status.maxBytes) {
      await updateRecording(recording.id, { status: "failed", error: `This recording is ${formatBytes(blob.size)}; the service accepts up to ${formatBytes(status.maxBytes)}.` });
      return;
    }
    abort.current = new AbortController();
    await updateRecording(recording.id, { status: "transcribing", error: undefined });
    try {
      const result = await transcribeOnServer(blob, abort.current.signal);
      await createTranscript({ projectId: recording.projectId, recordingId: recording.id, title: recording.title, text: result.text, segments: result.segments, engine: result.engine });
      toast("Transcribed. Select any passage to put it to work.");
    } catch (e) {
      const msg = e instanceof TranscriptionError ? e.message : "Transcription failed.";
      await updateRecording(recording.id, { status: "failed", error: msg }).catch(() => undefined);
    } finally {
      abort.current = null;
    }
  };

  const importFile = async (file: File) => {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("That file is too large to be a transcript.");
      const raw = await file.text();
      const { text, segments } = parseTranscriptFile(raw, file.name);
      if (!text.trim()) throw new Error("That file doesn't contain any text.");
      await createTranscript({ projectId: recording.projectId, recordingId: recording.id, title: recording.title, text, segments, engine: `Imported from ${file.name}` });
      toast("Transcript imported.");
    } catch (e) {
      toastError(e, "Couldn't read that file.");
    }
  };

  const saveTyped = async () => {
    if (!typed.trim()) return;
    try {
      await createTranscript({ projectId: recording.projectId, recordingId: recording.id, title: recording.title, text: typed.trim(), engine: "Written by you" });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <section className="transcribe">
      <h3 className="section-title">Turn it into text</h3>
      {recording.status === "failed" && (
        <div className="banner banner-danger" role="alert">
          <IconWarning size={16} aria-hidden />
          <p className="grow">{recording.error ?? "Transcription failed."} The recording is safe.</p>
          {status?.available && (
            <Button size="sm" icon={IconRetry} onClick={() => void transcribe()}>
              Retry
            </Button>
          )}
        </div>
      )}
      {working ? (
        <div className="transcribe-working" role="status">
          <Spinner size={16} />
          <span>Transcribing with {status?.provider ?? "the service"}… You can keep working; this recording is already saved.</span>
          {abort.current && (
            <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <div className="transcribe-options">
          {status === null ? (
            <p className="muted small">Checking for a transcription service…</p>
          ) : status.available ? (
            <button type="button" className="transcribe-option is-primary" onClick={() => void transcribe()}>
              <IconAudio size={18} aria-hidden />
              <span className="grow">
                <strong>Transcribe</strong>
                <span className="muted small">
                  via {status.provider}
                  {status.model ? ` · ${status.model}` : ""}
                </span>
              </span>
            </button>
          ) : (
            <div className="transcribe-unavailable">
              <IconInfo size={16} aria-hidden />
              <p>
                <strong>No transcription service is connected.</strong> {status.reason} Your recording is saved and you can listen to it any time.{" "}
                <a className="link-btn" href="#/settings?section=transcription">
                  How to connect one
                </a>
              </p>
            </div>
          )}
          <button type="button" className="transcribe-option" onClick={() => fileRef.current?.click()}>
            <IconImport size={18} aria-hidden />
            <span className="grow">
              <strong>Import a transcript</strong>
              <span className="muted small">A .txt, .vtt, or .srt file from another app</span>
            </span>
          </button>
          <button type="button" className="transcribe-option" onClick={() => setTyping((t) => !t)} aria-expanded={typing}>
            <IconPen size={18} aria-hidden />
            <span className="grow">
              <strong>Write it out yourself</strong>
              <span className="muted small">Listen back and jot down what matters</span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.vtt,.srt,text/plain,text/vtt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
          {typing && (
            <div className="stack gap-2">
              <TextArea autoFocus minRows={6} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="What did you say? Rough is fine." aria-label="Transcript text" />
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                <Button variant="ghost" onClick={() => setTyping(false)}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={!typed.trim()} onClick={() => void saveTyped()}>
                  Save as transcript
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MoveRecording({ recording }: { recording: Recording }) {
  const { data: projects } = useAll("projects");
  const active = (projects ?? []).filter((p) => !p.archived);
  return (
    <Menu
      label="Plant in a project"
      align="start"
      trigger={(t) => (
        <Button {...t} size="sm" variant="primary" icon={IconMoveTo}>
          Plant in…
        </Button>
      )}
      items={
        active.length
          ? active.map((p) => ({
              label: p.title,
              onSelect: () =>
                void moveToProject({ type: "recording", id: recording.id }, p.id)
                  .then(() => {
                    toast(`Planted in “${p.title}”.`);
                    navigate(partPath(p.id, "leaves"), { rec: recording.id });
                  })
                  .catch(toastError),
            }))
          : [{ label: "No trees yet — plant one from the grove", disabled: true, onSelect: () => undefined }]
      }
    />
  );
}
