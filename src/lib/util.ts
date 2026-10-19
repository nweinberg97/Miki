/** Random, URL-safe identifier (works outside secure contexts, unlike crypto.randomUUID). */
export function uid(size = 16): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % 62];
  return out;
}

export const now = () => Date.now();

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function wordCount(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function relativeTime(ts: number, from = Date.now()): string {
  const s = Math.round((from - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date(from).getFullYear() ? undefined : "numeric" });
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** First line of free text, used to title notes captured without one. */
export function deriveTitle(body: string, max = 64): string {
  const first = body.trim().split(/\n/)[0] ?? "";
  return truncate(first.replace(/^#+\s*/, ""), max);
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, type = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), filename);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function byOrder<T extends { order: number; createdAt: number }>(a: T, b: T) {
  return a.order - b.order || a.createdAt - b.createdAt;
}

export function byUpdatedDesc<T extends { updatedAt: number }>(a: T, b: T) {
  return b.updatedAt - a.updatedAt;
}
