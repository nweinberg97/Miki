import { deleteProject, updateProject } from "../../data/repo";
import { exportProjectBackup } from "../../data/backup";
import type { Project } from "../../data/types";
import { confirmDialog, promptDialog } from "../../ui/Dialog";
import { toast, toastError } from "../../ui/toast";
import { downloadText, slugify } from "../../lib/util";
import { navigate } from "../../lib/router";

export async function renameProject(p: Project) {
  const title = await promptDialog({ title: "Rename project", label: "Title", initial: p.title, confirmLabel: "Rename" });
  if (!title) return;
  await updateProject(p.id, { title }).catch(toastError);
}

export async function toggleArchive(p: Project) {
  try {
    await updateProject(p.id, { archived: !p.archived });
    toast(p.archived ? `"${p.title}" is back in the studio.` : `"${p.title}" archived. Find it under "Archived".`);
  } catch (e) {
    toastError(e);
  }
}

export async function exportBackup(p: Project) {
  try {
    const backup = await exportProjectBackup(p.id, true);
    downloadText(JSON.stringify(backup), `${slugify(p.title)}.miki.json`, "application/json");
    toast("Backup downloaded. It includes recordings and every version.");
  } catch (e) {
    toastError(e, "Couldn't create the backup.");
  }
}

export async function removeProject(p: Project, afterDelete?: () => void) {
  const ok = await confirmDialog({
    title: `Delete "${p.title}"?`,
    body: (
      <>
        <p>This permanently removes the project and everything in it — drafts, notes, recordings, boards, and decisions — from this browser.</p>
        <p>If you might want it later, archive it or download a backup first.</p>
      </>
    ),
    confirmLabel: "Delete project",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await deleteProject(p.id);
    toast(`Deleted "${p.title}".`);
    if (afterDelete) afterDelete();
    else navigate("/");
  } catch (e) {
    toastError(e, "Couldn't delete the project.");
  }
}
