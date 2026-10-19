import { Schema, type DOMOutputSpec } from "prosemirror-model";

const pDOM: DOMOutputSpec = ["p", 0];

/** Miki's document schema: deliberately small — the elements prose actually needs. */
export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => pDOM,
    },
    heading: {
      attrs: { level: { default: 2, validate: "number" } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
        { tag: "h4", attrs: { level: 3 } },
        { tag: "h5", attrs: { level: 3 } },
        { tag: "h6", attrs: { level: 3 } },
      ],
      toDOM: (node) => ["h" + node.attrs.level, 0],
    },
    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    horizontal_rule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    },
    ordered_list: {
      attrs: { order: { default: 1, validate: "number" } },
      content: "list_item+",
      group: "block",
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom) => ({ order: (dom as HTMLElement).hasAttribute("start") ? Number((dom as HTMLElement).getAttribute("start")) || 1 : 1 }),
        },
      ],
      toDOM: (node) => (node.attrs.order === 1 ? ["ol", 0] : ["ol", { start: node.attrs.order }, 0]),
    },
    bullet_list: {
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", 0],
    },
    list_item: {
      content: "paragraph block*",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
    text: { group: "inline" },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
  },
  marks: {
    link: {
      attrs: { href: { validate: "string" }, title: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute("href"), title: (dom as HTMLElement).getAttribute("title") }),
        },
      ],
      toDOM: (node) => ["a", { href: node.attrs.href, title: node.attrs.title, rel: "noopener noreferrer", target: "_blank" }, 0],
    },
    em: {
      parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }, { style: "font-style=normal", clearMark: (m) => m.type.name === "em" }],
      toDOM: () => ["em", 0],
    },
    strong: {
      parseDOM: [
        { tag: "strong" },
        { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
        { style: "font-weight=400", clearMark: (m) => m.type.name === "strong" },
        { style: "font-weight", getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null },
      ],
      toDOM: () => ["strong", 0],
    },
  },
});
