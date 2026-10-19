// Export writing to portable formats. Everything runs locally in the browser.
import type { DocContent } from "../data/types";
import { downloadBlob, downloadText, escapeHtml, slugify } from "../lib/util";
import { docToHtml, docToMarkdown, docToPlainText, type PMNode } from "./serialize";

export type ExportFormat = "md" | "txt" | "html" | "docx" | "print";

export interface ExportPiece {
  title: string;
  content: DocContent;
}

export const EXPORT_FORMATS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "md", label: "Markdown (.md)", hint: "For Substack, Obsidian, GitHub, and most editors" },
  { format: "docx", label: "Word (.docx)", hint: "For editors, agents, and Google Docs import" },
  { format: "html", label: "Web page (.html)", hint: "A clean, readable page to share" },
  { format: "txt", label: "Plain text (.txt)", hint: "Just the words" },
  { format: "print", label: "Print or save as PDF", hint: "Opens a print-ready page" },
];

function piecesToMarkdown(pieces: ExportPiece[], includeTitles: boolean): string {
  return pieces
    .map((p) => {
      const body = docToMarkdown(p.content).trim();
      const hasOwnTitle = firstHeadingText(p.content) === p.title;
      return includeTitles && !hasOwnTitle ? `# ${p.title}\n\n${body}` : body;
    })
    .join("\n\n---\n\n")
    .concat("\n");
}

function piecesToText(pieces: ExportPiece[], includeTitles: boolean): string {
  return pieces
    .map((p) => {
      const body = docToPlainText(p.content);
      const hasOwnTitle = firstHeadingText(p.content) === p.title;
      return includeTitles && !hasOwnTitle ? `${p.title.toUpperCase()}\n\n${body}` : body;
    })
    .join("\n\n* * *\n\n")
    .concat("\n");
}

function firstHeadingText(content: DocContent): string | null {
  const first = (content.content?.[0] ?? null) as PMNode | null;
  if (!first || first.type !== "heading") return null;
  return (first.content ?? []).map((n) => n.text ?? "").join("");
}

export function piecesToHtmlPage(title: string, pieces: ExportPiece[], includeTitles: boolean, opts: { autoPrint?: boolean } = {}): string {
  const body = pieces
    .map((p) => {
      const hasOwnTitle = firstHeadingText(p.content) === p.title;
      const heading = includeTitles && !hasOwnTitle ? `<h1>${escapeHtml(p.title)}</h1>\n` : "";
      return `<article>\n${heading}${docToHtml(p.content)}\n</article>`;
    })
    .join('\n<hr class="break">\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Miki">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f7f5f0; color: #252722; font-family: "Iowan Old Style", "Palatino Linotype", Charter, Georgia, serif; font-size: 19px; line-height: 1.7; }
  main { max-width: 38rem; margin: 0 auto; padding: 72px 24px 96px; }
  h1, h2, h3 { line-height: 1.2; font-weight: 500; letter-spacing: -0.01em; }
  h1 { font-size: 2.1em; margin: 0 0 0.6em; }
  h2 { font-size: 1.4em; margin: 1.8em 0 0.5em; }
  h3 { font-size: 1.12em; margin: 1.5em 0 0.4em; font-weight: 600; }
  p { margin: 0 0 0.95em; }
  blockquote { margin: 1.2em 0; padding-left: 1.1em; border-left: 2px solid #5f6e52; font-style: italic; color: #464842; }
  a { color: #3c4733; text-underline-offset: 3px; }
  hr { border: 0; text-align: center; margin: 2.2em 0; }
  hr::after { content: "∗  ∗  ∗"; color: #9a9b94; letter-spacing: 0.4em; }
  hr.break { margin: 4em 0; }
  ul, ol { padding-left: 1.4em; }
  @media print {
    body { background: #fff; font-size: 12pt; }
    main { padding: 0; max-width: none; }
    hr.break { break-after: page; visibility: hidden; margin: 0; }
    a { color: inherit; }
  }
</style>
</head>
<body>
<main>
${body}
</main>${opts.autoPrint ? '\n<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250))</script>' : ""}
</body>
</html>`;
}

/* ---------------------------------------------------------------- docx */

async function piecesToDocx(pieces: ExportPiece[], includeTitles: boolean, title: string): Promise<Blob> {
  const docx = await import("docx");
  const { Document: DocxDocument, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, AlignmentType, PageBreak } = docx;
  type Child = InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>;

  const runs = (nodes: PMNode[] = []): Child[] => {
    const out: Child[] = [];
    for (const n of nodes) {
      if (n.type === "hard_break") {
        out.push(new TextRun({ text: "", break: 1 }));
        continue;
      }
      if (n.type !== "text") continue;
      const m = n.marks ?? [];
      const opts = { text: n.text ?? "", bold: m.some((x) => x.type === "strong"), italics: m.some((x) => x.type === "em") };
      const link = m.find((x) => x.type === "link");
      if (link) out.push(new ExternalHyperlink({ link: String(link.attrs?.href ?? ""), children: [new TextRun({ ...opts, style: "Hyperlink" })] }));
      else out.push(new TextRun(opts));
    }
    return out;
  };

  const paragraphs: InstanceType<typeof Paragraph>[] = [];
  const block = (n: PMNode, ctx: { quote?: boolean; list?: { ref: string; level: number } }) => {
    const kids = n.content ?? [];
    switch (n.type) {
      case "heading": {
        const level = Number(n.attrs?.level ?? 2);
        paragraphs.push(new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runs(kids) }));
        return;
      }
      case "paragraph":
        paragraphs.push(
          new Paragraph({
            children: runs(kids),
            ...(ctx.list ? { numbering: { reference: ctx.list.ref, level: ctx.list.level } } : {}),
            ...(ctx.quote ? { indent: { left: 720 }, style: "Quote" } : {}),
            spacing: { after: 160 },
          }),
        );
        return;
      case "horizontal_rule":
        paragraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("*   *   *")] }));
        return;
      case "blockquote":
        kids.forEach((k) => block(k, { ...ctx, quote: true }));
        return;
      case "bullet_list":
      case "ordered_list": {
        const ref = n.type === "bullet_list" ? "bullets" : "numbers";
        const level = ctx.list ? Math.min(ctx.list.level + 1, 3) : 0;
        kids.forEach((li) => (li.content ?? []).forEach((k, i) => block(k, { ...ctx, list: i === 0 ? { ref, level } : undefined })));
        return;
      }
      default:
        kids.forEach((k) => block(k, ctx));
    }
  };

  pieces.forEach((p, i) => {
    if (i > 0) paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
    if (includeTitles && firstHeadingText(p.content) !== p.title) paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(p.title)] }));
    (p.content.content as PMNode[] | undefined)?.forEach((n) => block(n, {}));
  });

  const d = new DocxDocument({
    title,
    creator: "Miki",
    styles: {
      default: { document: { run: { font: "Georgia", size: 24 }, paragraph: { spacing: { line: 360 } } } },
      paragraphStyles: [{ id: "Quote", name: "Quote", basedOn: "Normal", run: { italics: true, color: "464842" } }],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [0, 1, 2, 3].map((level) => ({ level, format: "bullet" as const, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })),
        },
        {
          reference: "numbers",
          levels: [0, 1, 2, 3].map((level) => ({ level, format: "decimal" as const, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })),
        },
      ],
    },
    sections: [{ children: paragraphs }],
  });
  return Packer.toBlob(d);
}

/* ---------------------------------------------------------------- entry point */

export async function exportPieces(format: ExportFormat, title: string, pieces: ExportPiece[], opts: { includeTitles?: boolean } = {}): Promise<void> {
  const includeTitles = opts.includeTitles ?? pieces.length > 1;
  const base = slugify(title);
  switch (format) {
    case "md":
      downloadText(piecesToMarkdown(pieces, includeTitles), `${base}.md`, "text/markdown;charset=utf-8");
      return;
    case "txt":
      downloadText(piecesToText(pieces, includeTitles), `${base}.txt`);
      return;
    case "html":
      downloadText(piecesToHtmlPage(title, pieces, includeTitles), `${base}.html`, "text/html;charset=utf-8");
      return;
    case "docx":
      downloadBlob(await piecesToDocx(pieces, includeTitles, title), `${base}.docx`);
      return;
    case "print": {
      const html = piecesToHtmlPage(title, pieces, includeTitles, { autoPrint: true });
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const w = window.open(url, "_blank");
      if (!w) {
        URL.revokeObjectURL(url);
        throw new Error("Your browser blocked the print window. Allow pop-ups for Miki, or export as HTML and print that.");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
  }
}

export { piecesToMarkdown, piecesToText };
