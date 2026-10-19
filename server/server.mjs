// Production server: serves the static build and the optional transcription relay.
//   npm run build && npm start      (PORT defaults to 4173)
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleHealth, handleTranscribe } from "./transcribe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
};

/**
 * @param {{ dir: string, onRequest?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean }} opts
 */
export function createServer({ dir, onRequest }) {
  return http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url || "/", "http://localhost");
    if (onRequest && onRequest(req, res)) return;
    if (url.pathname === "/api/health") return handleHealth(req, res);
    if (url.pathname === "/api/transcribe") return handleTranscribe(req, res);
    if (url.pathname.startsWith("/api/")) {
      res.statusCode = 404;
      return res.end("Not found");
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(dir, path.normalize(rel));
    if (!file.startsWith(dir)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }
    let target = file;
    try {
      const s = await stat(target);
      if (s.isDirectory()) target = path.join(target, "index.html");
    } catch {
      target = path.join(dir, "index.html"); // SPA fallback
    }
    try {
      await stat(target);
    } catch {
      res.statusCode = 404;
      return res.end("Not found");
    }
    const ext = path.extname(target);
    res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
    const immutable = /-[A-Z0-9]{8}\.(js|css|woff)$/i.test(target);
    res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
    createReadStream(target).pipe(res);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 4173;
  const dir = path.join(root, process.env.MIKI_DIST || "dist");
  createServer({ dir }).listen(port, () => {
    console.log(`Miki is running at http://localhost:${port}`);
  });
}
