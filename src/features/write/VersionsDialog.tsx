import { useState } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { restoreSnapshot } from "../../data/repo";
import type { Document, Snapshot } from "../../data/types";
import { docToHtml } from "../../editor/serialize";
import { cx, plural, relativeTime } from "../../lib/util";
import { Dialog, confirmDialog } from "../../ui/Dialog";
import { IconHistory, IconRestore } from "../../ui/icons";
import { toast, toastError } from "../../ui/toast";
import { Button, EmptyState } from "../../ui/ui";

export function VersionsDialog({
  open,
  onClose,
  doc,
  onBeforeRestore,
  onSaveVersion,
}: {
  open: boolean;
  onClose: () => void;
  doc: Document;
  onBeforeRestore: () => Promise<void>;
  onSaveVersion: () => void;
}) {
  const { data } = useLive(() => (open ? db.byIndex("snapshots", "documentId", doc.id) : Promise.resolve([] as Snapshot[])), [doc.id, open], ["snapshots"]);
  const versions = [...(data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const [selected, setSelected] = useState<string | null>(null);
  const current = versions.find((v) => v.id === selected) ?? versions[0];

  const restore = async (v: Snapshot) => {
    const ok = await confirmDialog({
      title: "Restore this version?",
      body: "The current text will be saved as its own version first, so you can always come back to it.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    try {
      await onBeforeRestore();
      await restoreSnapshot(v.id);
      toast("Version restored. The text you replaced is saved in History.");
      onClose();
    } catch (e) {
      toastError(e, "Couldn't restore that version.");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="History"
      description="Miki keeps a version automatically every 20 minutes of editing, plus any you save by name (⌘/Ctrl + S)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onSaveVersion}>Save current as a version</Button>
        </>
      }
    >
      {versions.length === 0 ? (
        <EmptyState compact icon={IconHistory} title="No earlier versions yet">
          They'll appear here as you write.
        </EmptyState>
      ) : (
        <div className="versions">
          <ul className="versions-list" role="listbox" aria-label="Versions">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={current?.id === v.id}
                  className={cx("list-row", current?.id === v.id && "is-active")}
                  onClick={() => setSelected(v.id)}
                >
                  <span className="grow">
                    <span className="list-row-title" style={{ display: "block" }}>
                      {v.label}
                    </span>
                    <span className="list-row-meta">
                      {new Date(v.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {relativeTime(v.createdAt)} ·{" "}
                      {plural(v.wordCount, "word")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <div className="versions-preview">
              <div className="versions-preview-head">
                <p className="muted small">Preview — read only</p>
                <Button size="sm" icon={IconRestore} onClick={() => void restore(current)}>
                  Restore this version
                </Button>
              </div>
              <div className="prose versions-prose" dangerouslySetInnerHTML={{ __html: docToHtml(current.content) }} />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
