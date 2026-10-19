// Transcription adapters. Miki never fabricates a transcript: each path either produces real text
// from a real engine, imports text the writer provides, or reports clearly that it isn't available.
import type { TranscriptSegment } from "../data/types";

export interface ServerStatus {
  available: boolean;
  provider?: string;
  model?: string;
  maxBytes?: number;
  reason?: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  engine: string;
}

let cached: { at: number; status: ServerStatus } | null = null;

/** Ask the Miki server (if there is one) whether a transcription provider is configured. */
export async function getServerStatus(force = false): Promise<ServerStatus> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.status;
  let status: ServerStatus;
  if (__MIKI_SINGLE__ || location.protocol === "file:") {
    status = { available: false, reason: "This standalone copy of Miki has no server, so it can't reach a transcription service." };
  } else {
    try {
      const res = await fetch("./api/health", { headers: { Accept: "application/json" }, cache: "no-store" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("json")) throw new Error("no api");
      const body = (await res.json()) as { transcription?: ServerStatus };
      status = body.transcription ?? { available: false, reason: "The server didn't report a transcription service." };
    } catch {
      status = navigator.onLine
        ? { available: false, reason: "This copy of Miki is hosted without its server, so no transcription service is connected." }
        : { available: false, reason: "You're offline. Transcription needs a connection to the transcription service." };
    }
  }
  cached = { at: Date.now(), status };
  return status;
}

export class TranscriptionError extends Error {}

export async function transcribeOnServer(blob: Blob, signal?: AbortSignal): Promise<TranscriptionResult> {
  let res: Response;
  try {
    res = await fetch("./api/transcribe", { method: "POST", body: blob, headers: { "Content-Type": blob.type || "audio/webm" }, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new TranscriptionError("Transcription was cancelled.");
    throw new TranscriptionError(navigator.onLine ? "Couldn't reach the Miki server." : "You're offline. Your recording is saved — try again when you're connected.");
  }
  let body: { text?: string; segments?: TranscriptSegment[]; engine?: string; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new TranscriptionError(body.error || `Transcription failed (${res.status}).`);
  if (typeof body.text !== "string") throw new TranscriptionError("The transcription service returned no text.");
  if (!body.text.trim()) throw new TranscriptionError("The service didn't hear any speech in this recording.");
  return { text: body.text, segments: body.segments ?? [], engine: body.engine ?? "Server transcription" };
}

/* ---------------------------------------------------------------- imported transcripts */

function parseTimestamp(t: string): number {
  const m = t.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
}

/** Accepts .txt, .md, WebVTT (.vtt), and SubRip (.srt). */
export function parseTranscriptFile(raw: string, filename: string): { text: string; segments: TranscriptSegment[] } {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const isCaptions = /\.(vtt|srt)$/i.test(filename) || /^WEBVTT/.test(text) || /^\d+\n\d\d:\d\d:\d\d[,.]\d+ -->/m.test(text);
  if (!isCaptions) return { text: text.trim(), segments: [] };
  const segments: TranscriptSegment[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() && !/^WEBVTT|^NOTE|^\d+$/.test(l.trim()));
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const [a, b] = lines[timing].split("-->");
    const content = lines
      .slice(timing + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (content) segments.push({ start: parseTimestamp(a), end: parseTimestamp(b), text: content });
  }
  // Join captions into readable paragraphs, breaking on long pauses.
  let out = "";
  segments.forEach((s, i) => {
    const gap = i > 0 ? s.start - segments[i - 1].end : 0;
    out += i === 0 ? s.text : gap > 2.5 ? `\n\n${s.text}` : ` ${s.text}`;
  });
  return { text: out.trim(), segments };
}

/* ---------------------------------------------------------------- live browser dictation */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const liveDictationSupported = () => typeof window !== "undefined" && recognitionCtor() !== null;

export interface LiveDictation {
  stop: () => string;
  abort: () => void;
}

/**
 * The browser's own speech recognition, running alongside the recording.
 * In Chrome and Edge this sends audio to the browser vendor's speech service; Miki discloses this before use.
 */
export function startLiveDictation(onText: (finalText: string, interim: string) => void, onError: (msg: string) => void): LiveDictation | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  let stopped = false;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += (finalText && !finalText.endsWith(" ") ? " " : "") + r[0].transcript.trim();
      else interim += r[0].transcript;
    }
    onText(finalText, interim);
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    onError(e.error === "not-allowed" ? "The browser blocked live transcription." : e.error === "network" ? "Live transcription needs a network connection." : `Live transcription stopped (${e.error}).`);
  };
  // Browsers end recognition after silence; keep it going until the recording stops.
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    }
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      return finalText.trim();
    },
    abort: () => {
      stopped = true;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

/* ---------------------------------------------------------------- passages ↔ time */

/** Approximate the recording time for a passage, using segment timestamps when the engine provided them. */
export function timeForExcerpt(original: string, segments: TranscriptSegment[], excerpt: string): number | undefined {
  if (!segments.length || !excerpt.trim()) return undefined;
  const at = original.indexOf(excerpt.trim().slice(0, 40));
  if (at < 0) return undefined;
  let cursor = 0;
  for (const s of segments) {
    const idx = original.indexOf(s.text.slice(0, 24), cursor);
    if (idx < 0) continue;
    const end = idx + s.text.length;
    if (at <= end) return s.start;
    cursor = end;
  }
  return segments[segments.length - 1]?.start;
}
