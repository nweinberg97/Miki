import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark, wrapIn, lift, joinUp, joinDown, selectParentNode } from "prosemirror-commands";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, undo } from "prosemirror-history";
import { ellipsis, emDash, InputRule, inputRules, smartQuotes, textblockTypeInputRule, wrappingInputRule, undoInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { DOMParser as PMDOMParser, Fragment, Slice, type MarkType, type NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, Plugin, type Command, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { schema } from "./schema";

const { nodes, marks } = schema;

/* ---------------------------------------------------------------- commands */

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks || $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

export function blockActive(state: EditorState, type: NodeType, attrs?: Record<string, unknown>): boolean {
  const { $from, to } = state.selection;
  if (to > $from.end()) return false;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type === type && (!attrs || Object.entries(attrs).every(([k, v]) => n.attrs[k] === v))) return true;
  }
  return false;
}

export const toggleHeading =
  (level: number): Command =>
  (state, dispatch) => {
    if (blockActive(state, nodes.heading, { level })) return setBlockType(nodes.paragraph)(state, dispatch);
    return setBlockType(nodes.heading, { level })(state, dispatch);
  };

export const toggleBlockquote: Command = (state, dispatch) => {
  if (blockActive(state, nodes.blockquote)) return lift(state, dispatch);
  return wrapIn(nodes.blockquote)(state, dispatch);
};

export const toggleList =
  (type: NodeType): Command =>
  (state, dispatch, view) => {
    if (blockActive(state, type)) return liftListItem(nodes.list_item)(state, dispatch, view);
    const other = type === nodes.bullet_list ? nodes.ordered_list : nodes.bullet_list;
    if (blockActive(state, other)) {
      // Switch list type in place.
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === other) {
          if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(d), type));
          return true;
        }
      }
    }
    return wrapInList(type)(state, dispatch, view);
  };

export const toggleBold = toggleMark(marks.strong);
export const toggleItalic = toggleMark(marks.em);

/** The extent and target of the link under the cursor, if any. */
export function linkAtCursor(state: EditorState): { from: number; to: number; href: string } | null {
  const { $from } = state.selection;
  const start = $from.start();
  const spans: { from: number; to: number; href: string }[] = [];
  $from.parent.forEach((child, offset) => {
    const link = marks.link.isInSet(child.marks);
    if (!link) return;
    const from = start + offset;
    const to = from + child.nodeSize;
    const last = spans[spans.length - 1];
    if (last && last.to === from && last.href === link.attrs.href) last.to = to;
    else spans.push({ from, to, href: link.attrs.href as string });
  });
  return spans.find((s) => s.from <= $from.pos && s.to >= $from.pos) ?? null;
}

export function setLink(href: string | null): Command {
  return (state, dispatch) => {
    let { from, to } = state.selection;
    if (state.selection.empty) {
      const existing = linkAtCursor(state);
      if (!existing) return false;
      from = existing.from;
      to = existing.to;
    }
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, marks.link);
      if (href) tr.addMark(from, to, marks.link.create({ href }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function normalizeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(v)) return `mailto:${v}`;
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return `https://${v}`;
  return null;
}

/* ---------------------------------------------------------------- input rules */

function buildInputRules() {
  const rules: InputRule[] = [...smartQuotes, ellipsis, emDash];
  rules.push(wrappingInputRule(/^\s*>\s$/, nodes.blockquote));
  rules.push(wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list, (m) => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]));
  rules.push(wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list));
  rules.push(textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (m) => ({ level: m[1].length })));
  // ---, *** or ___ on an empty line → divider
  rules.push(
    new InputRule(/^(?:---|\*\*\*|___)$/, (state, _m, start, end) => {
      const $start = state.doc.resolve(start);
      if (!$start.parent.isTextblock || $start.parent.type !== nodes.paragraph) return null;
      return state.tr.replaceRangeWith($start.before(), $start.after() > end ? end : $start.after(), nodes.horizontal_rule.create()).scrollIntoView();
    }),
  );
  // **bold** and *italic* as you type
  const markRule = (re: RegExp, type: MarkType) =>
    new InputRule(re, (state, match, start, end) => {
      const text = match[2];
      if (!text) return null;
      const tr = state.tr;
      const textStart = start + match[0].indexOf(match[1]);
      tr.replaceWith(textStart, end, schema.text(text, [type.create()]));
      tr.removeStoredMark(type);
      return tr;
    });
  rules.push(markRule(/(\*\*([^*\s][^*]*[^*\s]|[^*\s])\*\*)$/, marks.strong));
  rules.push(markRule(/(?:^|[^*\w])(\*([^*\s][^*]*[^*\s]|[^*\s])\*)$/, marks.em));
  return inputRules({ rules });
}

/* ---------------------------------------------------------------- keymap */

export interface EditorHooks {
  onLinkRequest: () => void;
  onSaveVersion: () => void;
  onToggleFocus: () => void;
}

function buildKeymap(hooks: EditorHooks) {
  const mac = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);
  const keys: Record<string, Command> = {
    "Mod-z": undo,
    "Shift-Mod-z": redo,
    "Backspace": undoInputRule,
    "Mod-b": toggleBold,
    "Mod-B": toggleBold,
    "Mod-i": toggleItalic,
    "Mod-I": toggleItalic,
    "Mod-k": (state) => {
      if (state.selection.empty && !marks.link.isInSet(state.selection.$from.marks())) return false;
      hooks.onLinkRequest();
      return true;
    },
    "Mod-s": () => {
      hooks.onSaveVersion();
      return true;
    },
    "Shift-Mod-f": () => {
      hooks.onToggleFocus();
      return true;
    },
    "Mod-Alt-0": setBlockType(nodes.paragraph),
    "Mod-Alt-1": toggleHeading(1),
    "Mod-Alt-2": toggleHeading(2),
    "Mod-Alt-3": toggleHeading(3),
    "Shift-Mod-8": toggleList(nodes.bullet_list),
    "Shift-Mod-7": toggleList(nodes.ordered_list),
    "Shift-Mod-9": toggleBlockquote,
    "Alt-ArrowUp": joinUp,
    "Alt-ArrowDown": joinDown,
    "Escape": selectParentNode,
    "Enter": splitListItem(nodes.list_item),
    "Tab": sinkListItem(nodes.list_item),
    "Shift-Tab": liftListItem(nodes.list_item),
    "Mod-Enter": chainCommands(exitCode, (state, dispatch) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
      return true;
    }),
    "Shift-Enter": (state, dispatch) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
      return true;
    },
  };
  if (!mac) keys["Mod-y"] = redo;
  return keymap(keys);
}

/* ---------------------------------------------------------------- placeholder */

function placeholderPlugin(text: string) {
  return new Plugin({
    props: {
      decorations(state) {
        const doc = state.doc;
        if (doc.childCount === 1 && doc.firstChild!.isTextblock && doc.firstChild!.content.size === 0) {
          return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild!.nodeSize, { class: "is-empty", "data-placeholder": text })]);
        }
        return null;
      },
    },
  });
}

/* ---------------------------------------------------------------- paste */

const MARKDOWN_HINT = /(^|\n)(#{1,3} |[-*+] |\d+\. |> )|\*\*[^*\n]+\*\*|\[[^\]]+\]\([^)]+\)/;

export function markdownToFragmentHtml(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function htmlToSlice(html: string): Slice {
  const dom = document.createElement("div");
  dom.innerHTML = html;
  return PMDOMParser.fromSchema(schema).parseSlice(dom);
}

/** Parse a block of Markdown into a ProseMirror slice (used for paste and imports). */
export function markdownToSlice(md: string): Slice {
  return htmlToSlice(markdownToFragmentHtml(md));
}

function plainTextSlice(text: string): Slice {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const nodesOut = paras.map((p) => {
    const parts = p.split("\n");
    const content = [];
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) content.push(nodes.hard_break.create());
      if (parts[i]) content.push(schema.text(parts[i]));
    }
    return nodes.paragraph.create(null, content);
  });
  return new Slice(Fragment.from(nodesOut), 1, 1);
}

/* ---------------------------------------------------------------- state */

export function createEditorState(json: unknown, hooks: EditorHooks, placeholder: string): EditorState {
  let doc;
  try {
    doc = schema.nodeFromJSON(json);
    doc.check();
  } catch {
    doc = schema.node("doc", null, [schema.node("paragraph")]);
  }
  return EditorState.create({
    doc,
    plugins: [
      buildInputRules(),
      buildKeymap(hooks),
      keymap(baseKeymap),
      history({ depth: 500, newGroupDelay: 600 }),
      dropCursor({ color: "var(--moss)", width: 2 }),
      gapCursor(),
      placeholderPlugin(placeholder),
    ],
  });
}

export const editorProps = {
  clipboardTextParser(text: string, _$ctx: unknown, plain: boolean) {
    if (!plain && MARKDOWN_HINT.test(text)) {
      try {
        return markdownToSlice(text);
      } catch {
        /* fall through to plain text */
      }
    }
    return plainTextSlice(text);
  },
  transformPastedHTML(html: string) {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "img", "video", "audio", "iframe", "table"] });
  },
};

export type { Transaction };
export { nodes, marks };
