// Miki build script.
//   node scripts/build.mjs            → dist/ (static app, PWA service worker)
//   node scripts/build.mjs --single   → dist-single/miki.html (one self-contained file, for demos)
// Also exported as `buildApp` for the dev server.
import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

/** @param {{ outdir?: string, dev?: boolean, single?: boolean }} opts */
export async function esbuildOptions({ outdir, dev = false, single = false }) {
  return {
    absWorkingDir: root,
    entryPoints: { app: "src/main.tsx" },
    bundle: true,
    // The single file uses a classic script: inline module scripts reject HTML-comment-like sequences.
    format: single ? "iife" : "esm",
    splitting: !single,
    // The single-file demo can't load lazy chunks, so everything is bundled into one script.
    outdir,
    write: !single,
    metafile: true,
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    target: ["es2022", "safari16"],
    jsx: "automatic",
    entryNames: dev || single ? "[name]" : "[name]-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    loader: { ".woff": single ? "dataurl" : "file", ".svg": "text" },
    define: {
      "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
      __MIKI_VERSION__: JSON.stringify(pkg.version),
      __MIKI_SINGLE__: JSON.stringify(single),
      __MIKI_DEV__: JSON.stringify(dev),
    },
    legalComments: "none",
    logLevel: "warning",
  };
}

/**
 * Make a bundle safe to inline in <script>: "<!--", "<script" and "</script" change how HTML parses
 * script content. They only occur inside string/regex/template literals, where \x3C is equivalent.
 */
export function escapeInlineScript(js) {
  return js.replace(/<(!--|script|\/script)/gi, "\\x3C$1");
}

export async function renderIndexHtml({ scripts, styles, dev = false, inlineJs = "", inlineCss = "" }) {
  let html = await readFile(path.join(root, "src/index.html"), "utf8");
  const head = [
    ...styles.map((s) => `<link rel="stylesheet" href="./${s}">`),
    inlineCss ? `<style>${inlineCss}</style>` : "",
  ].join("\n    ");
  const body = [
    ...scripts.map((s) => `<script type="module" src="./${s}"></script>`),
    inlineJs ? `<script>${escapeInlineScript(inlineJs)}</script>` : "",
    dev
      ? `<script>new EventSource("/__reload").addEventListener("reload",()=>location.reload())</script>`
      : "",
  ].join("\n    ");
  // Function replacers: the bundle contains "$&"-style sequences that string replacements would expand.
  return html.replace("<!--HEAD-->", () => head).replace("<!--BODY-->", () => body);
}

async function buildDist() {
  const outdir = path.join(root, "dist");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const result = await esbuild.build(await esbuildOptions({ outdir }));
  const outputs = Object.entries(result.metafile.outputs);
  const entry = outputs.find(([, o]) => o.entryPoint === "src/main.tsx");
  if (!entry) throw new Error("No entry output");
  const js = path.relative(outdir, entry[0]);
  const css = entry[1].cssBundle ? path.relative(outdir, entry[1].cssBundle) : null;
  await cp(path.join(root, "public"), outdir, { recursive: true });
  await cp(path.join(root, "src/assets/fonts"), path.join(outdir, "fonts-licenses"), {
    recursive: true,
    filter: (f) => !f.endsWith(".woff"),
  });
  const html = await renderIndexHtml({ scripts: [js], styles: css ? [css] : [] });
  await writeFile(path.join(outdir, "index.html"), html);

  // Service worker: precache the app shell with a content-derived version.
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(path.relative(outdir, p));
    }
  }
  await walk(outdir);
  const precache = files.filter((f) => !f.endsWith(".txt") && f !== "sw.js").map((f) => "./" + f.split(path.sep).join("/"));
  const hash = createHash("sha256");
  for (const f of precache) hash.update(f);
  const version = hash.digest("hex").slice(0, 12);
  const swTemplate = await readFile(path.join(root, "src/sw.template.js"), "utf8");
  await writeFile(
    path.join(outdir, "sw.js"),
    swTemplate.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(["./", ...precache])),
  );
  const size = outputs.reduce((n, [, o]) => n + o.bytes, 0);
  console.log(`Built dist/ (${(size / 1024).toFixed(0)} KB of JS/CSS/assets, sw ${version})`);
}

async function buildSingle() {
  const outdir = path.join(root, "dist-single");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const result = await esbuild.build(await esbuildOptions({ outdir, single: true }));
  const jsFile = result.outputFiles.find((f) => f.path.endsWith(".js"));
  const cssFile = result.outputFiles.find((f) => f.path.endsWith(".css"));
  const icon = await readFile(path.join(root, "public/icon.svg"), "utf8");
  let html = await renderIndexHtml({ scripts: [], styles: [], inlineJs: jsFile.text, inlineCss: cssFile?.text ?? "" });
  html = html
    .replace(/<link rel="manifest"[^>]*>/, "")
    .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}">`)
    .replace(/<link rel="apple-touch-icon"[^>]*>/, "");
  await writeFile(path.join(outdir, "miki.html"), html);
  // A body-only variant for hosts that supply their own document skeleton (e.g. a claude.ai artifact).
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, "");
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  await writeFile(path.join(outdir, "miki-embed.html"), `${head.trim()}\n${body.trim()}\n`);
  console.log(`Built dist-single/miki.html (${(html.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!existsSync(path.join(root, "node_modules"))) {
    console.error("Run `npm install` first.");
    process.exit(1);
  }
  if (process.argv.includes("--single")) await buildSingle();
  else await buildDist();
}
