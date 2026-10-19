// Full-fidelity backups (JSON) and validated import.
import { z } from "zod";
import { ALL_STORES, transact } from "./db";
import { collectProject } from "./repo";
import type { StoreMap, StoreName } from "./types";

export const BACKUP_FORMAT = 1;

const id = z.string().min(1).max(200);
const ts = z.number().finite();
const ref = z.object({ type: z.string(), id }).passthrough();

/** Minimal shape checks per store. Unknown fields are kept (forward compatibility). */
const SCHEMAS: Record<StoreName, z.ZodTypeAny> = {
  projects: z.object({ id, title: z.string(), type: z.string(), createdAt: ts, updatedAt: ts }).passthrough(),
  documents: z.object({ id, projectId: id, title: z.string(), content: z.object({ type: z.literal("doc") }).passthrough(), createdAt: ts, updatedAt: ts }).passthrough(),
  snapshots: z.object({ id, documentId: id, projectId: id, content: z.object({ type: z.literal("doc") }).passthrough(), createdAt: ts }).passthrough(),
  notes: z.object({ id, projectId: id, body: z.string(), createdAt: ts, updatedAt: ts }).passthrough(),
  recordings: z.object({ id, projectId: id, title: z.string(), mimeType: z.string(), createdAt: ts }).passthrough(),
  audio: z.object({ id, dataUrl: z.string().startsWith("data:") }).passthrough(),
  transcripts: z.object({ id, projectId: id, original: z.string(), text: z.string(), createdAt: ts }).passthrough(),
  boards: z.object({ id, projectId: id, kind: z.enum(["ideas", "structure"]) }).passthrough(),
  sections: z.object({ id, projectId: id, boardId: id, title: z.string() }).passthrough(),
  cards: z.object({ id, projectId: id, boardId: id, x: z.number(), y: z.number() }).passthrough(),
  links: z.object({ id, projectId: id, from: ref, to: ref, kind: z.string() }).passthrough(),
  references: z.object({ id, projectId: id, title: z.string(), kind: z.string() }).passthrough(),
  processes: z.object({ id, projectId: id, title: z.string() }).passthrough(),
  steps: z.object({ id, processId: id, projectId: id, title: z.string(), order: z.number() }).passthrough(),
  decisions: z.object({ id, projectId: id, question: z.string() }).passthrough(),
  templates: z.object({ id, name: z.string(), steps: z.array(z.object({ title: z.string() }).passthrough()) }).passthrough(),
  prefs: z.object({ key: z.string() }).passthrough(),
};

const backupSchema = z.object({
  app: z.literal("miki"),
  format: z.number().int(),
  exportedAt: ts,
  stores: z.record(z.array(z.unknown())),
});

export type Backup = z.infer<typeof backupSchema>;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

type Dump = Partial<{ [S in StoreName]: StoreMap[S][] }>;

async function serialize(dump: Dump, includeAudio: boolean): Promise<Backup> {
  const stores: Record<string, unknown[]> = {};
  for (const [store, rows] of Object.entries(dump) as [StoreName, unknown[]][]) {
    if (store === "audio") continue;
    // Internal bookkeeping (one-time migrations) belongs to this browser, not to the backup.
    stores[store] = store === "prefs" ? (rows as { key: string }[]).filter((r) => !r.key.startsWith("migrated:")) : rows;
  }
  if (includeAudio && dump.audio) {
    stores.audio = await Promise.all(dump.audio.map(async (a) => ({ id: a.id, dataUrl: await blobToDataUrl(a.blob) })));
  }
  return { app: "miki", format: BACKUP_FORMAT, exportedAt: Date.now(), stores };
}

export async function exportEverything(includeAudio: boolean): Promise<Backup> {
  const dump = await transact(ALL_STORES, "readonly", async (tx) => {
    const out: Dump = {};
    for (const s of ALL_STORES) (out as Record<string, unknown[]>)[s] = await tx.getAll(s);
    return out;
  });
  return serialize(dump, includeAudio);
}

export async function exportProjectBackup(projectId: string, includeAudio: boolean): Promise<Backup> {
  const dump = await transact(ALL_STORES, "readonly", (tx) => collectProject(tx, projectId));
  return serialize(dump as Dump, includeAudio);
}

export interface ImportPlan {
  valid: { store: StoreName; row: Record<string, unknown> }[];
  skippedInvalid: number;
  unknownStores: string[];
  projectTitles: string[];
  conflicts: number;
}

/** Parse and validate a backup file without writing anything. */
export async function planImport(text: string): Promise<ImportPlan> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) throw new Error("This doesn't look like a Miki backup.");
  if (parsed.data.format > BACKUP_FORMAT) throw new Error("This backup was made by a newer version of Miki.");
  const valid: ImportPlan["valid"] = [];
  let skippedInvalid = 0;
  const unknownStores: string[] = [];
  for (const [store, rows] of Object.entries(parsed.data.stores)) {
    const schema = SCHEMAS[store as StoreName];
    if (!schema) {
      unknownStores.push(store);
      continue;
    }
    for (const row of rows) {
      const r = schema.safeParse(row);
      if (r.success) valid.push({ store: store as StoreName, row: r.data });
      else skippedInvalid++;
    }
  }
  const existing = await transact(
    [...new Set(valid.map((v) => v.store))],
    "readonly",
    async (tx) => {
      let n = 0;
      for (const v of valid) {
        const key = (v.row.id ?? v.row.key) as string;
        if (await tx.get(v.store, key)) n++;
      }
      return n;
    },
  ).catch(() => 0);
  const projectTitles = valid.filter((v) => v.store === "projects").map((v) => String(v.row.title));
  return { valid, skippedInvalid, unknownStores, projectTitles, conflicts: existing };
}

/**
 * Write a validated plan. "merge" keeps existing records with the same id;
 * "overwrite" replaces them with the backup's version.
 */
export async function applyImport(plan: ImportPlan, mode: "merge" | "overwrite"): Promise<number> {
  const rows: { store: StoreName; row: Record<string, unknown> }[] = [];
  for (const v of plan.valid) {
    if (v.store === "audio") {
      rows.push({ store: "audio", row: { id: v.row.id, blob: await dataUrlToBlob(String(v.row.dataUrl)) } });
    } else rows.push(v);
  }
  const stores = [...new Set(rows.map((r) => r.store))];
  if (!stores.length) return 0;
  return transact(stores, "readwrite", async (tx) => {
    let written = 0;
    for (const { store, row } of rows) {
      const key = (row.id ?? row.key) as string;
      if (mode === "merge" && (await tx.get(store, key))) continue;
      tx.put(store, row as never);
      written++;
    }
    return written;
  });
}
