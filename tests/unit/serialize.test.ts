import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDoc, docToHtml, docToMarkdown, docToPlainText, plainTextToDoc } from "../../src/editor/serialize.ts";
import type { DocContent } from "../../src/data/types.ts";

const doc: DocContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Slowing Down" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Read " },
        { type: "text", text: "slowly", marks: [{ type: "em" }] },
        { type: "text", text: " and " },
        { type: "text", text: "well", marks: [{ type: "strong" }] },
        { type: "text", text: ". See " },
        { type: "text", text: "this", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        { type: "text", text: "." },
      ],
    },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Friction is good." }] }] },
    {
      type: "bullet_list",
      content: [
        { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
        { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
      ],
    },
    { type: "ordered_list", attrs: { order: 3 }, content: [{ type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] }] },
    { type: "horizontal_rule" },
    { type: "paragraph", content: [{ type: "text", text: "line" }, { type: "hard_break" }, { type: "text", text: "break" }] },
  ],
};

test("markdown keeps headings, emphasis, links, quotes, and lists", () => {
  const md = docToMarkdown(doc);
  assert.match(md, /^# Slowing Down$/m);
  assert.match(md, /Read \*slowly\* and \*\*well\*\*\. See \[this\]\(https:\/\/example\.com\)\./);
  assert.match(md, /^> Friction is good\.$/m);
  assert.match(md, /^- one\n- two$/m);
  assert.match(md, /^3\. three$/m);
  assert.match(md, /^---$/m);
  assert.match(md, /line {2}\nbreak/);
});

test("markdown escapes characters that would change meaning", () => {
  const md = docToMarkdown({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "# not a heading *or* [link]" }] }] });
  assert.equal(md.trim(), "\\# not a heading \\*or\\* \\[link\\]");
});

test("html escapes text and drops unsafe link targets", () => {
  const html = docToHtml({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "<b>hi</b>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
  });
  assert.equal(html, '<p><a href="#">&lt;b&gt;hi&lt;/b&gt;</a></p>');
  assert.match(docToHtml(doc), /<ol start="3"><li><p>three<\/p><\/li><\/ol>/);
});

test("plain text is readable and used for word counts", () => {
  const text = docToPlainText(doc);
  assert.match(text, /^Slowing Down\n\nRead slowly and well\. See this\./);
  assert.match(text, /• one\n\n• two/);
  assert.match(text, /3\. three/);
});

test("buildDoc and plainTextToDoc produce valid structures", () => {
  const d = buildDoc([
    { kind: "h", level: 2, text: "Opening" },
    { kind: "p", text: "First para\n\nSecond para" },
    { kind: "quote", text: "Verbatim" },
    { kind: "bullets", items: ["a", "b"] },
  ]);
  assert.equal(d.content?.length, 5);
  assert.equal(docToMarkdown(d).trim(), "## Opening\n\nFirst para\n\nSecond para\n\n> Verbatim\n\n- a\n- b");
  const p = plainTextToDoc("# Title\n\nBody text");
  assert.equal(docToMarkdown(p).trim(), "# Title\n\nBody text");
  assert.deepEqual(buildDoc([]), { type: "doc", content: [{ type: "paragraph" }] });
});
