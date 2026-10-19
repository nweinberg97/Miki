import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — plain ESM module without type declarations
import { health, transcribe, transcriptionConfig } from "../../server/transcribe.mjs";

const audio = new Uint8Array([1, 2, 3, 4]);

test("transcription is unavailable unless configured", async () => {
  assert.equal(health({}).transcription.available, false);
  const r = await transcribe(audio, "audio/webm", { env: {} });
  assert.equal(r.status, 503);
});

test("config reads key, base url, and model; never exposes the key in health", () => {
  const env = { TRANSCRIPTION_API_KEY: "sk-secret", TRANSCRIPTION_MODEL: "whisper-1" };
  const c = transcriptionConfig(env);
  assert.equal(c.available, true);
  assert.equal(c.provider, "api.openai.com");
  assert.ok(!JSON.stringify(health(env)).includes("sk-secret"));
  assert.equal(transcriptionConfig({ TRANSCRIPTION_API_BASE: "http://localhost:8000/v1/" }).base, "http://localhost:8000/v1");
});

test("successful transcription returns text, segments, and the engine name", async () => {
  let seen: { url: string; auth: string | null } | null = null;
  const fetchImpl = async (url: string, init: RequestInit) => {
    seen = { url, auth: new Headers(init.headers).get("authorization") };
    return new Response(JSON.stringify({ text: " Hello world. ", segments: [{ start: 0, end: 1.5, text: " Hello world. " }] }), { status: 200 });
  };
  const r = await transcribe(audio, "audio/webm;codecs=opus", { env: { TRANSCRIPTION_API_KEY: "k" }, fetchImpl });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.segments, [{ start: 0, end: 1.5, text: "Hello world." }]);
  assert.equal(r.body.text, "Hello world.");
  assert.equal(seen!.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(seen!.auth, "Bearer k");
});

test("falls back to plain json for models without timestamps", async () => {
  const formats: string[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const f = (init.body as FormData).get("response_format") as string;
    formats.push(f);
    if (f === "verbose_json") return new Response("response_format 'verbose_json' is not compatible", { status: 400 });
    return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
  };
  const r = await transcribe(audio, "audio/mp4", { env: { TRANSCRIPTION_API_KEY: "k", TRANSCRIPTION_MODEL: "gpt-4o-transcribe" }, fetchImpl });
  assert.equal(r.status, 200);
  assert.deepEqual(formats, ["verbose_json", "json"]);
});

test("errors are reported clearly", async () => {
  const unauthorized = await transcribe(audio, "audio/webm", { env: { TRANSCRIPTION_API_KEY: "bad" }, fetchImpl: async () => new Response("nope", { status: 401 }) });
  assert.equal(unauthorized.status, 502);
  assert.match(unauthorized.body.error, /TRANSCRIPTION_API_KEY/);
  const offline = await transcribe(audio, "audio/webm", {
    env: { TRANSCRIPTION_API_KEY: "k" },
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(offline.status, 502);
  assert.match(offline.body.error, /Could not reach/);
  const tooBig = await transcribe(new Uint8Array(30), "audio/webm", { env: { TRANSCRIPTION_API_KEY: "k", TRANSCRIPTION_MAX_BYTES: "10" } });
  assert.equal(tooBig.status, 413);
  const empty = await transcribe(new Uint8Array(0), "audio/webm", { env: { TRANSCRIPTION_API_KEY: "k" } });
  assert.equal(empty.status, 400);
});
