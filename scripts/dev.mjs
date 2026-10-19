// Development server: rebuilds on change and reloads the page.
//   npm run dev      → http://localhost:5173
import * as esbuild from "esbuild";
import { mkdir, rm, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esbuildOptions, renderIndexHtml } from "./build.mjs";
import { createServer } from "../server/server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, ".dev");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(path.join(root, "public"), outdir, { recursive: true });
await rm(path.join(outdir, "sw.js"), { force: true });
await writeFile(path.join(outdir, "index.html"), await renderIndexHtml({ scripts: ["app.js"], styles: ["app.css"], dev: true }));

const clients = new Set();
const reloadPlugin = {
  name: "reload",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      for (const res of clients) res.write("event: reload\ndata: x\n\n");
      console.log(`[miki] rebuilt ${new Date().toLocaleTimeString()}`);
    });
  },
};

const ctx = await esbuild.context({ ...(await esbuildOptions({ outdir, dev: true })), plugins: [reloadPlugin] });
await ctx.watch();

const port = Number(process.env.PORT) || 5173;
createServer({
  dir: outdir,
  onRequest(req, res) {
    if (req.url !== "/__reload") return false;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return true;
  },
}).listen(port, () => console.log(`Miki dev server: http://localhost:${port}`));
