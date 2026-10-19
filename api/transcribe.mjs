// Vercel serverless function: POST /api/transcribe
// Note: Vercel limits request bodies to ~4.5 MB (≈ 5–8 minutes of compressed speech).
import { handleTranscribe } from "../server/transcribe.mjs";

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  return handleTranscribe(req, res);
}
