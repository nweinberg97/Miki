import { useEffect, useMemo, useState } from "react";
import { useByProject } from "../../data/hooks";
import type { Project } from "../../data/types";
import { EXPORT_FORMATS, exportPieces, type ExportFormat } from "../../editor/exporters";
import { byOrder, plural } from "../../lib/util";
import { Dialog } from "../../ui/Dialog";
import { toast, toastError } from "../../ui/toast";
import { Button, EmptyState } from "../../ui/ui";

/** Export a chosen set of drafts as one manuscript — share the writing without exposing the whole project. */
export function ManuscriptExportDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const { data } = useByProject("documents", project.id);
  const docs = useMemo(() => [...(data ?? [])].sort(byOrder), [data]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>("md");
  const [titles, setTitles] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setChosen(new Set(docs.filter((d) => d.wordCount > 0).map((d) => d.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = docs.filter((d) => chosen.has(d.id));
  const words = selected.reduce((n, d) => n + d.wordCount, 0);

  const run = async () => {
    setBusy(true);
    try {
      await exportPieces(
        format,
        project.title,
        selected.map((d) => ({ title: d.title, content: d.content })),
        { includeTitles: titles },
      );
      toast(format === "print" ? "Opened a print-ready page." : "Exported.");
      onClose();
    } catch (e) {
      toastError(e, "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export writing"
      description="Choose which drafts to include, in order. Notes, boards, and decisions are never included."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={!selected.length} busy={busy}>
            Export {selected.length > 1 ? `${selected.length} documents` : ""}
          </Button>
        </>
      }
    >
      {docs.length === 0 ? (
        <EmptyState compact title="No drafts to export yet" />
      ) : (
        <div className="stack gap-4">
          <fieldset className="export-docs">
            <legend className="field-label">Documents</legend>
            {docs.map((d) => (
              <label key={d.id} className="check-row">
                <input
                  type="checkbox"
                  checked={chosen.has(d.id)}
                  onChange={(e) =>
                    setChosen((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(d.id);
                      else n.delete(d.id);
                      return n;
                    })
                  }
                />
                <span className="grow">{d.title || "Untitled"}</span>
                <span className="muted small">{plural(d.wordCount, "word")}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="export-docs">
            <legend className="field-label">Format</legend>
            {EXPORT_FORMATS.map((f) => (
              <label key={f.format} className="check-row">
                <input type="radio" name="fmt" checked={format === f.format} onChange={() => setFormat(f.format)} />
                <span className="grow">
                  {f.label}
                  <span className="muted small" style={{ display: "block" }}>
                    {f.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="check-row">
            <input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} />
            <span className="grow">Use document titles as chapter headings</span>
          </label>
          <p className="muted small">{plural(words, "word")} selected.</p>
        </div>
      )}
    </Dialog>
  );
}
