// Vercel serverless function: GET /api/health — reports whether transcription is configured.
import { handleHealth } from "../server/transcribe.mjs";

export default function handler(req, res) {
  return handleHealth(req, res);
}
