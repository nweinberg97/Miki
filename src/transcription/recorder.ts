// Audio capture with MediaRecorder. Reports honest states: it never shows "recording"
// unless the microphone stream is live and the recorder has started.
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "paused" | "stopped" | "error";

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => {
    try {
      return MediaRecorder.isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

export function recordingSupported(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: false };
  if (!window.isSecureContext) return { ok: false, reason: "Recording needs a secure connection (https or localhost)." };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "This browser doesn't allow microphone access." };
  if (typeof MediaRecorder === "undefined") return { ok: false, reason: "This browser can't record audio." };
  return { ok: true };
}

function describeError(err: unknown): string {
  const name = (err as DOMException)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was blocked. Allow it in your browser's site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect one and try again.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is busy or unavailable. Another app may be using it.";
    default:
      return (err as Error)?.message || "Recording couldn't start.";
  }
}

export interface RecorderResult {
  blob: Blob;
  duration: number;
  mimeType: string;
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(48).fill(0));
  const [result, setResult] = useState<RecorderResult | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const accumulated = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardOnStop = useRef(false);

  const teardown = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  useEffect(() => () => {
    discardOnStop.current = true;
    try {
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    } catch {
      /* ignore */
    }
    teardown();
  }, [teardown]);

  const start = useCallback(async () => {
    const support = recordingSupported();
    if (!support.ok) {
      setError(support.reason ?? "Recording isn't supported here.");
      setState("error");
      return false;
    }
    setError(null);
    setResult(null);
    setState("requesting");
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      setError(describeError(err));
      setState("error");
      return false;
    }
    stream.current = s;
    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
    } catch (err) {
      teardown();
      setError(`This browser can't record in a supported format. ${(err as Error).message ?? ""}`.trim());
      setState("error");
      return false;
    }
    chunks.current = [];
    discardOnStop.current = false;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onerror = () => {
      setError("Recording stopped unexpectedly. Anything captured so far has been kept.");
    };
    rec.onstop = () => {
      const duration = accumulated.current + (startedAt.current ? (performance.now() - startedAt.current) / 1000 : 0);
      startedAt.current = 0;
      teardown();
      if (discardOnStop.current) {
        chunks.current = [];
        setState("idle");
        return;
      }
      const type = rec.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      chunks.current = [];
      if (blob.size === 0) {
        setError("Nothing was captured. Check that the right microphone is selected.");
        setState("error");
        return;
      }
      setResult({ blob, duration, mimeType: type });
      setState("stopped");
    };
    // Level meter
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtx.current = ctx;
      const src = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        raf.current = requestAnimationFrame(tick);
        if (t - last < 70) return;
        last = t;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        setLevels((prev) => [...prev.slice(1), rms]);
      };
      raf.current = requestAnimationFrame(tick);
    } catch {
      /* the meter is decorative; recording continues without it */
    }
    rec.start(1000);
    recorder.current = rec;
    accumulated.current = 0;
    startedAt.current = performance.now();
    setElapsed(0);
    timer.current = setInterval(() => {
      setElapsed(accumulated.current + (startedAt.current ? (performance.now() - startedAt.current) / 1000 : 0));
    }, 250);
    setState("recording");
    return true;
  }, [teardown]);

  const pause = useCallback(() => {
    const r = recorder.current;
    if (!r || r.state !== "recording" || typeof r.pause !== "function") return;
    r.pause();
    accumulated.current += (performance.now() - startedAt.current) / 1000;
    startedAt.current = 0;
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    const r = recorder.current;
    if (!r || r.state !== "paused") return;
    r.resume();
    startedAt.current = performance.now();
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  /** Stop and throw away whatever was captured. */
  const discard = useCallback(() => {
    discardOnStop.current = true;
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
    else teardown();
    setResult(null);
    setElapsed(0);
    setLevels(Array(48).fill(0));
    setState("idle");
  }, [teardown]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setElapsed(0);
    setLevels(Array(48).fill(0));
    setState("idle");
  }, []);

  return { state, error, elapsed, levels, result, start, pause, resume, stop, discard, reset, canPause: typeof MediaRecorder !== "undefined" && "pause" in MediaRecorder.prototype };
}
