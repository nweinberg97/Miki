// Pure conversions from Miki's ProseMirror JSON to plain text, Markdown, and HTML.
// No DOM required, so these run in tests and in export code paths.
import type { DocContent } from "../data/types";
import { escapeHtml } from "../lib/util";

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const children = (n: PMNode): PMNode[] => (Array.isArray(n.content) ? n.content : []);

function inlineText(n: PMNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hard_break") return "\n";
  return children(n).map(inlineText).join("");
}

/** Plain text with blank lines between blocks; used for search, word counts, and .txt export. */
export function docToPlainText(doc: DocContent | PMNode): string {
  const blocks: string[] = [];
  const walk = (n: PMNode, prefix = "") => {
    switch (n.type) {
      case "paragraph":
      case "heading":
        blocks.push(prefix + inlineText(n));
        return;
      case "horizontal_rule":
        blocks.push("* * *");
        return;
      case "bullet_list":
        children(n).forEach((li) => children(li).forEach((c, i) => walk(c, i === 0 ? prefix + "• " : prefix + "  ")));
        return;
      case "ordered_list": {
        const start = Number(n.attrs?.order ?? 1);
        children(n).forEach((li, k) => children(li).forEach((c, i) => walk(c, i === 0 ? `${prefix}${start + k}. ` : prefix + "   ")));
        return;
      }
      default:
        children(n).forEach((c) => walk(c, prefix));
    }
  };
  walk(doc as PMNode);
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ------------------------------------------------------------------ markdown */

function escapeMd(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([*_`[\]])/g, "\\$1")
    .replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d+\.\s)/gm, (_m, sp, tok) => `${sp}\\${tok}`);
}

function inlineMd(nodes: PMNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "hard_break") {
      out += "  \n";
      continue;
    }
    if (n.type !== "text") continue;
    let t = escapeMd(n.text ?? "");
    const marks = n.marks ?? [];
    // Keep surrounding whitespace outside of emphasis markers so Markdown stays valid.
    const lead = t.match(/^\s*/)![0];
    const trail = t.match(/\s*$/)![0];
    let core = t.slice(lead.length, t.length - trail.length);
    if (core) {
      if (marks.some((m) => m.type === "em")) core = `*${core}*`;
      if (marks.some((m) => m.type === "strong")) core = `**${core}**`;
      const link = marks.find((m) => m.type === "link");
      if (link) core = `[${core}](${String(link.attrs?.href ?? "").replace(/\)/g, "%29")})`;
    }
    t = lead + core + trail;
    out += t;
  }
  return out;
}

export function docToMarkdown(doc: DocContent | PMNode): string {
  const out: string[] = [];
  const block = (n: PMNode, indent: string): string => {
    switch (n.type) {
      case "paragraph":
        return indent + inlineMd(children(n)).replace(/\n/g, "\n" + indent);
      case "heading":
        return `${"#".repeat(Number(n.attrs?.level ?? 2))} ${inlineMd(children(n))}`;
      case "horizontal_rule":
        return "---";
      case "blockquote":
        return children(n)
          .map((c) => block(c, ""))
          .join("\n\n")
          .split("\n")
          .map((l) => (l ? `${indent}> ${l}` : `${indent}>`))
          .join("\n");
      case "bullet_list":
      case "ordered_list": {
        const ordered = n.type === "ordered_list";
        const start = Number(n.attrs?.order ?? 1);
        return children(n)
          .map((li, k) => {
            const marker = ordered ? `${start + k}. ` : "- ";
            const pad = " ".repeat(marker.length);
            return children(li)
              .map((c, i) => {
                const text = block(c, "");
                const lines = text.split("\n");
                return lines.map((l, j) => (i === 0 && j === 0 ? indent + marker + l : l ? indent + pad + l : "")).join("\n");
              })
              .join("\n");
          })
          .join("\n");
      }
      default:
        return children(n)
          .map((c) => block(c, indent))
          .join("\n\n");
    }
  };
  for (const n of children(doc as PMNode)) out.push(block(n, ""));
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ------------------------------------------------------------------ html */

function safeHref(href: string): string {
  return /^(https?:|mailto:|#|\/)/i.test(href) ? href : "#";
}

function inlineHtml(nodes: PMNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "hard_break") return "<br>";
      if (n.type !== "text") return "";
      let t = escapeHtml(n.text ?? "");
      for (const m of n.marks ?? []) {
        if (m.type === "em") t = `<em>${t}</em>`;
        else if (m.type === "strong") t = `<strong>${t}</strong>`;
        else if (m.type === "link") t = `<a href="${escapeHtml(safeHref(String(m.attrs?.href ?? "")))}">${t}</a>`;
      }
      return t;
    })
    .join("");
}

export function docToHtml(doc: DocContent | PMNode): string {
  const block = (n: PMNode): string => {
    switch (n.type) {
      case "paragraph":
        return `<p>${inlineHtml(children(n))}</p>`;
      case "heading": {
        const l = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 2)));
        return `<h${l}>${inlineHtml(children(n))}</h${l}>`;
      }
      case "horizontal_rule":
        return "<hr>";
      case "blockquote":
        return `<blockquote>${children(n).map(block).join("")}</blockquote>`;
      case "bullet_list":
        return `<ul>${children(n).map(block).join("")}</ul>`;
      case "ordered_list": {
        const start = Number(n.attrs?.order ?? 1);
        return `<ol${start !== 1 ? ` start="${start}"` : ""}>${children(n).map(block).join("")}</ol>`;
      }
      case "list_item":
        return `<li>${children(n).map(block).join("")}</li>`;
      default:
        return children(n).map(block).join("");
    }
  };
  return children(doc as PMNode).map(block).join("\n");
}

/* ------------------------------------------------------------------ builders */

/** Build doc JSON from simple blocks — used to seed documents from cards, outlines, and transcripts. */
export type SimpleBlock =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "bullets"; items: string[] };

const textNode = (text: string): PMNode[] => (text ? [{ type: "text", text }] : []);

function paragraphsFrom(text: string): PMNode[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return [{ type: "paragraph" }];
  return paras.map((p) => {
    const lines = p.split("\n");
    const content: PMNode[] = [];
    lines.forEach((l, i) => {
      if (i > 0) content.push({ type: "hard_break" });
      content.push(...textNode(l));
    });
    return { type: "paragraph", content };
  });
}

export function buildDoc(blocks: SimpleBlock[]): DocContent {
  const content: PMNode[] = [];
  for (const b of blocks) {
    if (b.kind === "h") content.push({ type: "heading", attrs: { level: b.level }, content: textNode(b.text) });
    else if (b.kind === "p") content.push(...paragraphsFrom(b.text));
    else if (b.kind === "quote") content.push({ type: "blockquote", content: paragraphsFrom(b.text) });
    else if (b.kind === "bullets" && b.items.length)
      content.push({
        type: "bullet_list",
        content: b.items.map((it) => ({ type: "list_item", content: [{ type: "paragraph", content: textNode(it) }] })),
      });
  }
  if (!content.length) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

/** Prose-ish text → doc. Recognises "# headings" and blank-line paragraphs only. */
export function plainTextToDoc(text: string): DocContent {
  const blocks: SimpleBlock[] = [];
  for (const chunk of text.split(/\n{2,}/)) {
    const t = chunk.trim();
    if (!t) continue;
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h && !t.includes("\n")) blocks.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
    else blocks.push({ kind: "p", text: t });
  }
  return buildDoc(blocks);
}
