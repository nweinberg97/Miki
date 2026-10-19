import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { DocContent, Document } from "../data/types";
import { promptDialog } from "../ui/Dialog";
import { IconBold, IconBullets, IconH2, IconH3, IconItalic, IconLink, IconNumbers, IconQuote } from "../ui/icons";
import { cx } from "../lib/util";
import type { Autosave } from "./autosave";
import { schema } from "./schema";
import { docToPlainText } from "./serialize";
import {
  blockActive,
  createEditorState,
  editorProps,
  linkAtCursor,
  markActive,
  marks,
  nodes,
  normalizeHref,
  setLink,
  toggleBlockquote,
  toggleBold,
  toggleHeading,
  toggleItalic,
  toggleList,
} from "./setup";
import { toast } from "../ui/toast";
import { wordCount } from "../lib/util";
import "./editor.css";

export interface EditorHandle {
  focus: () => void;
  /** Insert content at the cursor (or the end of the document if the editor hasn't been focused). */
  insert: (content: DocContent) => void;
  getJSON: () => DocContent;
  /** Replace the whole document (e.g. after restoring a version). */
  reset: (content: DocContent) => void;
}

interface Props {
  doc: Document;
  autosave: Autosave;
  placeholder?: string;
  onStats?: (s: { words: number; selectionWords: number }) => void;
  onSaveVersion: () => void;
  onToggleFocus: () => void;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ doc, autosave, placeholder = "Start with a sentence. Any sentence.", onStats, onSaveVersion, onToggleFocus }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [, setTick] = useState(0);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const hooksRef = useRef({ onSaveVersion, onToggleFocus, onStats, autosave });
  hooksRef.current = { onSaveVersion, onToggleFocus, onStats, autosave };
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusPos = useRef<number | null>(null);

  const requestLink = async () => {
    const v = view.current;
    if (!v) return;
    const existing = linkAtCursor(v.state);
    const { from, to } = v.state.selection;
    const result = await promptDialog({
      title: existing ? "Edit link" : "Add link",
      label: "Web address",
      initial: existing?.href ?? "",
      placeholder: "https://",
      confirmLabel: existing ? "Update" : "Add link",
    });
    const view2 = view.current;
    if (!view2) return;
    view2.focus();
    if (result === null) return;
    const href = normalizeHref(result);
    if (!href) {
      toast("That doesn't look like a web or email address.", { tone: "error" });
      return;
    }
    // Restore the selection the dialog took focus from.
    view2.dispatch(view2.state.tr.setSelection(TextSelection.create(view2.state.doc, Math.min(from, view2.state.doc.content.size), Math.min(to, view2.state.doc.content.size))));
    setLink(href)(view2.state, view2.dispatch);
  };

  const emitStats = (v: EditorView) => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(() => {
      const words = wordCount(docToPlainText(v.state.doc.toJSON() as DocContent));
      const { from, to } = v.state.selection;
      const selectionWords = from === to ? 0 : wordCount(v.state.doc.textBetween(from, to, " "));
      hooksRef.current.onStats?.({ words, selectionWords });
    }, 200);
  };

  const updateBubble = (v: EditorView) => {
    const sel = v.state.selection;
    if (sel.empty || !v.hasFocus() || !(sel instanceof TextSelection)) {
      setBubble(null);
      return;
    }
    const start = v.coordsAtPos(sel.from);
    const end = v.coordsAtPos(sel.to);
    const top = Math.min(start.top, end.top);
    const left = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
    setBubble({ top, left });
  };

  useLayoutEffect(() => {
    if (!mount.current) return;
    const state = createEditorState(doc.content, { onLinkRequest: () => void requestLink(), onSaveVersion: () => hooksRef.current.onSaveVersion(), onToggleFocus: () => hooksRef.current.onToggleFocus() }, placeholder);
    const v = new EditorView(mount.current, {
      state,
      ...editorProps,
      attributes: { class: "prose", "aria-label": `${doc.title} — document text`, role: "textbox", "aria-multiline": "true", spellcheck: "true" },
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        if (tr.docChanged) {
          hooksRef.current.autosave.change(() => next.doc.toJSON() as DocContent);
        }
        if (tr.docChanged || tr.selectionSet) emitStats(v);
        lastFocusPos.current = next.selection.to;
        updateBubble(v);
        setTick((t) => t + 1);
      },
      handleDOMEvents: {
        blur: () => {
          setTimeout(() => {
            if (view.current && !view.current.hasFocus()) setBubble(null);
          }, 120);
          return false;
        },
        focus: () => {
          updateBubble(v);
          return false;
        },
      },
    });
    view.current = v;
    emitStats(v);
    return () => {
      if (statsTimer.current) clearTimeout(statsTimer.current);
      v.destroy();
      view.current = null;
    };
    // The editor is keyed by document id by its parent, so it mounts once per document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up changes made elsewhere (restored version, text appended from a transcript, another tab)
  // as long as there are no unsaved edits here.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (autosave.ownWrites.current.has(doc.updatedAt)) return;
    if (autosave.status !== "saved") return;
    const current = JSON.stringify(v.state.doc.toJSON());
    if (current === JSON.stringify(doc.content)) return;
    const pos = v.state.selection.from;
    v.updateState(createEditorState(doc.content, { onLinkRequest: () => void requestLink(), onSaveVersion: () => hooksRef.current.onSaveVersion(), onToggleFocus: () => hooksRef.current.onToggleFocus() }, placeholder));
    try {
      v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(Math.min(pos, v.state.doc.content.size)))));
    } catch {
      /* selection is best-effort */
    }
    emitStats(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.updatedAt]);

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    getJSON: () => (view.current?.state.doc.toJSON() as DocContent) ?? doc.content,
    insert: (content: DocContent) => {
      const v = view.current;
      if (!v) return;
      const frag = Fragment.fromJSON(schema, content.content ?? []);
      const atEnd = lastFocusPos.current === null;
      let tr = v.state.tr;
      if (atEnd) tr = tr.setSelection(TextSelection.atEnd(tr.doc));
      const $pos = tr.selection.$from;
      // Insert after the current block so we never split a paragraph mid-sentence.
      const insertAt = $pos.depth > 0 ? $pos.after(1) : tr.doc.content.size;
      tr = tr.insert(insertAt, frag);
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + frag.size, tr.doc.content.size)), -1)).scrollIntoView();
      v.dispatch(tr);
      v.focus();
    },
    reset: (content: DocContent) => {
      const v = view.current;
      if (!v) return;
      const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, Fragment.fromJSON(schema, content.content ?? [{ type: "paragraph" }]));
      v.dispatch(tr);
    },
  }));

  const v = view.current;
  const run = (cmd: (s: EditorView["state"], d: EditorView["dispatch"]) => boolean) => {
    if (!v) return;
    cmd(v.state, v.dispatch);
    v.focus();
  };

  return (
    <>
      <div ref={mount} className="editor-mount" />
      {bubble && v && (
        <div
          className="bubble"
          role="toolbar"
          aria-label="Formatting"
          style={{ top: bubble.top, left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <BubbleBtn label="Bold" icon={IconBold} active={markActive(v.state, marks.strong)} onClick={() => run(toggleBold)} />
          <BubbleBtn label="Italic" icon={IconItalic} active={markActive(v.state, marks.em)} onClick={() => run(toggleItalic)} />
          <BubbleBtn label="Link" icon={IconLink} active={markActive(v.state, marks.link)} onClick={() => void requestLink()} />
          <span className="bubble-sep" />
          <BubbleBtn label="Heading" icon={IconH2} active={blockActive(v.state, nodes.heading, { level: 2 })} onClick={() => run(toggleHeading(2))} />
          <BubbleBtn label="Subheading" icon={IconH3} active={blockActive(v.state, nodes.heading, { level: 3 })} onClick={() => run(toggleHeading(3))} />
          <BubbleBtn label="Quote" icon={IconQuote} active={blockActive(v.state, nodes.blockquote)} onClick={() => run(toggleBlockquote)} />
          <BubbleBtn label="Bulleted list" icon={IconBullets} active={blockActive(v.state, nodes.bullet_list)} onClick={() => run(toggleList(nodes.bullet_list))} />
          <BubbleBtn label="Numbered list" icon={IconNumbers} active={blockActive(v.state, nodes.ordered_list)} onClick={() => run(toggleList(nodes.ordered_list))} />
        </div>
      )}
    </>
  );
});

function BubbleBtn({ label, icon: Icon, active, onClick }: { label: string; icon: typeof IconBold; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx("bubble-btn", active && "is-active")} aria-label={label} aria-pressed={active} title={label} onClick={onClick}>
      <Icon size={15} aria-hidden />
    </button>
  );
}

/** Imperative helpers for toolbar buttons outside the editor. */
export { toggleBold, toggleItalic, toggleHeading, toggleBlockquote, toggleList, nodes };
