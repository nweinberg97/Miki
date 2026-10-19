// Server-side transcription relay. Keeps provider credentials on the server.
// Works with any OpenAI-compatible /audio/transcriptions endpoint:
//   - OpenAI (default):        TRANSCRIPTION_API_KEY=sk-...
//   - Groq, etc.:              TRANSCRIPTION_API_BASE=https://api.groq.com/openai/v1  TRANSCRIPTION_MODEL=whisper-large-v3
//   - A local Whisper server:  TRANSCRIPTION_API_BASE=http://localhost:8000/v1 (e.g. Speaches / faster-whisper-server)
// If neither TRANSCRIPTION_API_KEY nor TRANSCRIPTION_API_BASE is set, transcription is reported as unavailable.

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function transcriptionConfig(env = process.env) {
  const key = env.TRANSCRIPTION_API_KEY || "";
  const base = (env.TRANSCRIPTION_API_BASE || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env.TRANSCRIPTION_MODEL || "whisper-1";
  const available = Boolean(key || env.TRANSCRIPTION_API_BASE);
  let provider = "unknown";
  try {
    provider = new URL(base).host;
  } catch {
    /* invalid base url */
  }
  const maxBytes = Number(env.TRANSCRIPTION_MAX_BYTES) || MAX_AUDIO_BYTES;
  return { key, base, model, available, provider, maxBytes };
}

export function health(env = process.env) {
  const c = transcriptionConfig(env);
  return {
    ok: true,
    transcription: c.available
      ? { available: true, provider: c.provider, model: c.model, maxBytes: c.maxBytes }
      : { available: false, reason: "No transcription provider is configured on this server." },
  };
}

function extensionFor(mime) {
  if (/webm/.test(mime)) return "webm";
  if (/ogg/.test(mime)) return "ogg";
  if (/mp4|m4a|aac/.test(mime)) return "m4a";
  if (/mpeg|mp3/.test(mime)) return "mp3";
  if (/wav/.test(mime)) return "wav";
  return "webm";
}

/**
 * @param {Uint8Array} audio
 * @param {string} mime
 * @param {{ language?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [opts]
 */
export async function transcribe(audio, mime, opts = {}) {
  const c = transcriptionConfig(opts.env);
  const doFetch = opts.fetchImpl || fetch;
  if (!c.available) return { status: 503, body: { error: "Transcription is not configured on this server." } };
  if (!audio || audio.byteLength === 0) return { status: 400, body: { error: "The recording is empty." } };
  if (audio.byteLength > c.maxBytes) {
    return {
      status: 413,
      body: { error: `This recording is ${(audio.byteLength / 1048576).toFixed(1)} MB; the limit is ${(c.maxBytes / 1048576).toFixed(0)} MB.` },
    };
  }
  const cleanMime = (mime || "audio/webm").split(";")[0];

  async function attempt(format) {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: cleanMime }), `recording.${extensionFor(cleanMime)}`);
    form.append("model", c.model);
    form.append("response_format", format);
    if (format === "verbose_json") form.append("timestamp_granularities[]", "segment");
    if (opts.language) form.append("language", opts.language);
    const headers = c.key ? { Authorization: `Bearer ${c.key}` } : {};
    return doFetch(`${c.base}/audio/transcriptions`, { method: "POST", headers, body: form });
  }

  let res;
  try {
    res = await attempt("verbose_json");
    if (res.status === 400) {
      const text = await res.text();
      // Some models (e.g. gpt-4o-transcribe) only support "json". Retry without segments.
      if (/response_format|verbose_json|timestamp/i.test(text)) res = await attempt("json");
      else return { status: 502, body: { error: `The provider rejected the audio: ${text.slice(0, 300)}` } };
    }
  } catch (err) {
    return { status: 502, body: { error: `Could not reach the transcription provider (${c.provider}). ${err?.message ?? ""}`.trim() } };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint = res.status === 401 ? " Check the server's TRANSCRIPTION_API_KEY." : "";
    return { status: 502, body: { error: `The provider returned ${res.status}.${hint} ${text.slice(0, 300)}`.trim() } };
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data.text !== "string") {
    return { status: 502, body: { error: "The provider returned an unexpected response." } };
  }
  const segments = Array.isArray(data.segments)
    ? data.segments
        .filter((s) => typeof s?.text === "string")
        .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text).trim() }))
    : [];
  return {
    status: 200,
    body: { text: data.text.trim(), segments, language: data.language ?? null, engine: `${c.provider} · ${c.model}` },
  };
}

/** Read a Node request body into a Uint8Array with a size cap. */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

/** Node (req, res) handler shared by the local server and the Vercel function. */
export async function handleTranscribe(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") return send(405, { error: "Use POST." });
  const c = transcriptionConfig();
  if (!c.available) return send(503, { error: "Transcription is not configured on this server." });
  let audio;
  try {
    audio = await readBody(req, c.maxBytes + 1024);
  } catch (err) {
    if (err?.code === "TOO_LARGE") return send(413, { error: "This recording is too large for the server." });
    return send(400, { error: "Could not read the upload." });
  }
  const lang = typeof req.headers["x-miki-language"] === "string" ? req.headers["x-miki-language"] : undefined;
  const result = await transcribe(audio, String(req.headers["content-type"] || "audio/webm"), { language: lang });
  return send(result.status, result.body);
}

export function handleHealth(_req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(health()));
}
