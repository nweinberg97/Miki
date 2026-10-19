import { useEffect, useRef, useState } from "react";
import { applyImport, exportEverything, planImport, type ImportPlan } from "../../data/backup";
import { deleteEverything, diagnostics, requestPersistence, storageStatus } from "../../data/db";
import { getPref, setPref } from "../../data/repo";
import type { StoreName } from "../../data/types";
import { getMeasure, getProseSize, getTheme, setMeasure, setProseSize, setTheme, type Measure, type ProseSize, type Theme } from "../../lib/appearance";
import { useRoute } from "../../lib/router";
import { ui } from "../../lib/store";
import { downloadText, formatBytes, plural } from "../../lib/util";
import { getServerStatus, liveDictationSupported, type ServerStatus } from "../../transcription/engines";
import { Dialog } from "../../ui/Dialog";
import { IconDevice, IconDownload, IconKeyboard, IconRetry, IconShield, IconUpload, IconWarning } from "../../ui/icons";
import { toast, toastError } from "../../ui/toast";
import { Badge, Button, Segmented, TextInput } from "../../ui/ui";
import "./settings.css";

export function SettingsPage() {
  const route = useRoute();
  const section = route.query.get("section");
  useEffect(() => {
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);
  return (
    <div className="page page-narrow settings">
      <header className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">How Miki stores your work, and how it looks while you do it.</p>
        </div>
      </header>
      <StorageSection />
      <BackupSection />
      <TranscriptionSection />
      <AppearanceSection />
      <SyncSection />
      <DiagnosticsSection />
      <DangerSection />
      <section className="settings-section">
        <h2 className="section-title">About</h2>
        <p className="muted small">
          Miki {__MIKI_VERSION__}. Typefaces: Fraunces, Literata, and Instrument Sans (SIL Open Font License), served from this app — no font CDNs.
        </p>
        <Button size="sm" variant="ghost" icon={IconKeyboard} onClick={() => ui.set({ shortcuts: true })}>
          Keyboard shortcuts
        </Button>
      </section>
    </div>
  );
}

function StorageSection() {
  const [s, setS] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null);
  const refresh = () => void storageStatus().then(setS);
  useEffect(refresh, []);
  return (
    <section className="settings-section" id="settings-storage">
      <h2 className="section-title">
        <IconDevice size={17} aria-hidden /> Where your work lives
      </h2>
      <p>
        Everything you write in Miki — drafts, notes, recordings, boards, decisions — is stored <strong>only in this browser, on this device</strong>, in its local database. There's no
        account and nothing is uploaded. Miki has no analytics or tracking.
      </p>
      <p className="muted small">
        That also means a different browser or device won't see this work, and clearing this site's data in your browser settings would erase it. Download a backup now and then.
      </p>
      {s && (
        <dl className="settings-facts">
          <div>
            <dt>Protected from automatic cleanup</dt>
            <dd>{s.persisted === null ? "Unknown in this browser" : s.persisted ? <Badge tone="moss">Yes</Badge> : <Badge tone="warm">Not yet</Badge>}</dd>
          </div>
          {s.usage !== null && (
            <div>
              <dt>Space used</dt>
              <dd>
                {formatBytes(s.usage)}
                {s.quota ? ` of about ${formatBytes(s.quota)} available` : ""}
              </dd>
            </div>
          )}
        </dl>
      )}
      {s && s.persisted === false && (
        <Button
          size="sm"
          icon={IconShield}
          onClick={async () => {
            const ok = await requestPersistence();
            toast(ok ? "Your browser will keep Miki's data even when space is low." : "The browser declined for now. It often grants this after you've used Miki for a while, or when it's installed as an app.");
            refresh();
          }}
        >
          Ask the browser to keep this data
        </Button>
      )}
    </section>
  );
}

function BackupSection() {
  const [includeAudio, setIncludeAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    setBusy(true);
    try {
      const b = await exportEverything(includeAudio);
      downloadText(JSON.stringify(b), `miki-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
      await setPref("backup:lastAt", Date.now());
      toast("Backup downloaded.");
    } catch (e) {
      toastError(e, "Couldn't create the backup.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File) => {
    try {
      setPlan(await planImport(await f.text()));
    } catch (e) {
      toastError(e, "Couldn't read that backup.");
    }
  };

  return (
    <section className="settings-section" id="settings-backup">
      <h2 className="section-title">
        <IconDownload size={17} aria-hidden /> Backups
      </h2>
      <p>A backup is a single file with everything in Miki. Use it to keep a copy somewhere safe, or to move your grove to another browser or device.</p>
      <label className="check-row">
        <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} />
        <span className="grow">Include voice recordings (makes the file larger)</span>
      </label>
      <div className="row gap-2 wrap">
        <Button variant="primary" icon={IconDownload} busy={busy} onClick={() => void exportAll()}>
          Download a backup
        </Button>
        <Button icon={IconUpload} onClick={() => fileRef.current?.click()}>
          Restore from a backup…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <ImportDialog plan={plan} onClose={() => setPlan(null)} />
    </section>
  );
}

function ImportDialog({ plan, onClose }: { plan: ImportPlan | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (mode: "merge" | "overwrite") => {
    if (!plan) return;
    setBusy(true);
    try {
      const n = await applyImport(plan, mode);
      toast(`Restored ${plural(n, "item")}.`);
      onClose();
    } catch (e) {
      toastError(e, "The restore didn't complete. Nothing was half-written: it runs as a single transaction.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(plan)}
      onClose={onClose}
      title="Restore from backup"
      size="md"
      footer={
        plan && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {plan.conflicts > 0 && (
              <Button onClick={() => void run("overwrite")} busy={busy}>
                Replace matching items
              </Button>
            )}
            <Button variant="primary" onClick={() => void run("merge")} busy={busy} disabled={!plan.valid.length}>
              {plan.conflicts > 0 ? "Add only what's missing" : "Restore"}
            </Button>
          </>
        )
      }
    >
      {plan && (
        <div className="stack gap-3 dialog-text">
          <p>
            This backup contains {plural(plan.valid.length, "item")}
            {plan.projectTitles.length ? ` across ${plural(plan.projectTitles.length, "project")}: ${plan.projectTitles.slice(0, 5).join(", ")}${plan.projectTitles.length > 5 ? "…" : ""}` : ""}.
          </p>
          {plan.conflicts > 0 && <p>{plural(plan.conflicts, "item")} already exist here. You can keep your current versions and add only what's missing, or replace them with the backup's versions.</p>}
          {plan.skippedInvalid > 0 && (
            <p className="banner">
              <IconWarning size={15} aria-hidden /> {plural(plan.skippedInvalid, "record")} looked damaged and will be skipped.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function TranscriptionSection() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [live, setLive] = useState(false);
  const refresh = () => {
    setStatus(null);
    void getServerStatus(true).then(setStatus);
  };
  useEffect(() => {
    refresh();
    void getPref<boolean>("capture:liveDictation", false).then(setLive);
  }, []);
  return (
    <section className="settings-section" id="settings-transcription">
      <h2 className="section-title">Transcription</h2>
      <p>Recordings are always saved on this device. Turning them into text is optional, and Miki only ever uses an engine that's actually available:</p>
      <div className="engine">
        <div className="engine-head">
          <strong>Server transcription</strong>
          {status === null ? <Badge>Checking…</Badge> : status.available ? <Badge tone="moss">Connected</Badge> : <Badge>Not connected</Badge>}
          <span className="grow" />
          <Button size="sm" variant="ghost" icon={IconRetry} onClick={refresh}>
            Check again
          </Button>
        </div>
        {status?.available ? (
          <p className="small">
            Recordings you choose to transcribe are sent through this Miki server to <strong>{status.provider}</strong> ({status.model}). You'll be asked before the first one.
          </p>
        ) : (
          <div className="small stack gap-2">
            <p className="muted">{status?.reason}</p>
            <p>
              To connect one, run Miki with its server (<code>npm start</code>, or deploy to Vercel) and set an environment variable. Any OpenAI-compatible speech-to-text service works,
              including one running on your own machine:
            </p>
            <pre className="code">{`# Free: a Whisper server on your own machine (nothing leaves it)
TRANSCRIPTION_API_BASE=http://localhost:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small

# Or a paid hosted service, e.g. OpenAI
TRANSCRIPTION_API_KEY=sk-...`}</pre>
            <p className="muted">Keys stay on the server. They're never sent to the browser.</p>
          </div>
        )}
      </div>
      <div className="engine">
        <div className="engine-head">
          <strong>Live transcript while recording</strong>
          {liveDictationSupported() ? <Badge tone={live ? "moss" : "neutral"}>{live ? "On" : "Off"}</Badge> : <Badge>Not supported in this browser</Badge>}
        </div>
        <p className="small">
          Uses your browser's built-in speech recognition. In Chrome and Edge, audio is sent to the browser maker's speech service while you record; Safari may process it on the
          device. Off by default.
        </p>
        {liveDictationSupported() && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => {
                setLive(e.target.checked);
                void setPref("capture:liveDictation", e.target.checked);
              }}
            />
            <span className="grow">Offer a live transcript when I record</span>
          </label>
        )}
      </div>
      <div className="engine">
        <div className="engine-head">
          <strong>Import or write it yourself</strong>
          <Badge tone="moss">Always available</Badge>
        </div>
        <p className="small">Attach a transcript from another app (.txt, .vtt, .srt) to any recording, or write out what matters while listening back.</p>
      </div>
    </section>
  );
}

function AppearanceSection() {
  const [theme, setT] = useState<Theme>(getTheme());
  const [size, setS] = useState<ProseSize>(getProseSize());
  const [measure, setM] = useState<Measure>(getMeasure());
  return (
    <section className="settings-section" id="settings-appearance">
      <h2 className="section-title">Appearance</h2>
      <div className="settings-row">
        <span>Theme</span>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(v) => {
            setT(v);
            setTheme(v);
          }}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Paper" },
            { value: "dark", label: "Night" },
          ]}
        />
      </div>
      <div className="settings-row">
        <span>Writing size</span>
        <Segmented
          label="Writing size"
          value={size}
          onChange={(v) => {
            setS(v);
            setProseSize(v);
          }}
          options={[
            { value: "small", label: "Small" },
            { value: "medium", label: "Medium" },
            { value: "large", label: "Large" },
          ]}
        />
      </div>
      <div className="settings-row">
        <span>Line length</span>
        <Segmented
          label="Line length"
          value={measure}
          onChange={(v) => {
            setM(v);
            setMeasure(v);
          }}
          options={[
            { value: "narrow", label: "Narrow" },
            { value: "medium", label: "Medium" },
            { value: "wide", label: "Wide" },
          ]}
        />
      </div>
      <p className="muted small">Motion follows your system's “reduce motion” setting.</p>
    </section>
  );
}

function SyncSection() {
  return (
    <section className="settings-section" id="settings-sync">
      <h2 className="section-title">Sync and collaboration</h2>
      <p>
        Miki doesn't sync between devices or support shared editing yet — so it never pretends to. To share writing, use <strong>Export writing</strong> from a project's menu (Markdown,
        Word, web page, or print/PDF): only the drafts you pick are included. To move everything to another device, use a backup.
      </p>
    </section>
  );
}

function DiagnosticsSection() {
  const [failing, setFailing] = useState(diagnostics.failWritesTo.has("documents"));
  return (
    <section className="settings-section" id="settings-diagnostics">
      <h2 className="section-title">Diagnostics</h2>
      <p className="small">For checking that Miki recovers gracefully. When on, saving drafts fails on purpose: you'll see the error, your text stays in the editor, and a recovery copy is kept until saving works again.</p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={failing}
          onChange={(e) => {
            const on = e.target.checked;
            setFailing(on);
            const stores: StoreName[] = ["documents"];
            stores.forEach((s) => (on ? diagnostics.failWritesTo.add(s) : diagnostics.failWritesTo.delete(s)));
            void setPref("diagnostics:failWrites", on ? stores : []).catch(toastError);
          }}
        />
        <span className="grow">Simulate failed saves for drafts</span>
      </label>
    </section>
  );
}

function DangerSection() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="settings-section settings-danger" id="settings-danger">
      <h2 className="section-title">Delete everything</h2>
      <p className="small">Permanently remove all projects, notes, recordings, and settings from this browser.</p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete all data…
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete everything in Miki?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== "DELETE"}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteEverything();
                  try {
                    Object.keys(localStorage)
                      .filter((k) => k.startsWith("miki:"))
                      .forEach((k) => localStorage.removeItem(k));
                  } catch {
                    /* ignore */
                  }
                  location.hash = "#/";
                  location.reload();
                } catch (e) {
                  toastError(e);
                  setBusy(false);
                }
              }}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <div className="stack gap-3 dialog-text">
          <p>This can't be undone. If there's anything you might want, download a backup first.</p>
          <label className="field-label" htmlFor="confirm-delete">
            Type DELETE to confirm
          </label>
          <TextInput id="confirm-delete" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </div>
      </Dialog>
    </section>
  );
}
