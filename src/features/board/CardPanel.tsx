import { useEffect, useRef, useState } from "react";
import { addLink, createDecision, createDocument, deleteCards, removeLink, sendCardToBoard, updateCard } from "../../data/repo";
import type { Card, CardType, Project } from "../../data/types";
import { buildDoc, docToPlainText } from "../../editor/serialize";
import { navigate, projectPath, href } from "../../lib/router";
import { cx, wordCount } from "../../lib/util";
import { IconArrowRight, IconConnect, IconDoc, IconMoveTo, IconSignpost, IconSource, IconTrash, IconX } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { toast, toastError, toastUndo } from "../../ui/toast";
import { Button, IconButton, Select } from "../../ui/ui";
import { EntityChip, EntityPicker, entityHref, linksFor, useProjectEntities } from "../shared/entities";
import type { BoardData } from "./BoardMode";
import { CARD_META, LINK_KINDS } from "./cardMeta";
import { orderStructure } from "./structureDoc";

/** The focused editing surface for a card. Slides over the board so the card keeps its place. */
export function CardPanel({ project, card, data, onClose }: { project: Project; card: Card; data: BoardData; onClose: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, body });
  latest.current = { title, body };
  const { data: entities } = useProjectEntities(project.id);
  const isNew = !card.title && !card.body;

  // Save text edits shortly after typing stops, and always on close.
  const persist = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const { title: t, body: b } = latest.current;
    if (t !== card.title || b !== card.body) void updateCard(card.id, { title: t, body: b }).catch(toastError);
  };
  const schedule = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 500);
  };
  useEffect(() => () => persist(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (isNew ? titleRef.current : null)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]") && !document.querySelector(".menu")) {
        persist();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    autosize(titleRef.current);
    autosize(bodyRef.current);
  }, [title, body]);

  const isIdeas = data.board.kind === "ideas";
  const otherSections = data.otherBoard ? orderStructure(data.otherSections, []).filter((c) => c.section) : [];
  const links = linksFor(data.links, { type: "card", id: card.id });

  const sendToOther = async (sectionId: string | null) => {
    if (!data.otherBoard) return;
    try {
      persist();
      const copy = await sendCardToBoard(card.id, data.otherBoard.id, sectionId);
      toast(isIdeas ? "Added to the structure. The original stays here." : "Copied to the idea space.", {
        action: { label: "Go there", onClick: () => navigate(projectPath(project.id, isIdeas ? "arrange" : "explore"), { card: copy.id }) },
      });
    } catch (e) {
      toastError(e);
    }
  };

  const startDraft = async () => {
    try {
      persist();
      const content = buildDoc([{ kind: "h", level: 2, text: title || "Untitled" }, ...(body.trim() ? [{ kind: "quote" as const, text: body.trim() }] : []), { kind: "p", text: "" }]);
      const plain = docToPlainText(content);
      const doc = await createDocument(project.id, { title: title || "Untitled", content, plainText: plain, wordCount: wordCount(plain), sourceCardId: card.id });
      navigate(projectPath(project.id, "write"), { doc: doc.id });
    } catch (e) {
      toastError(e);
    }
  };

  const recordDecision = async () => {
    try {
      persist();
      const d = await createDecision(project.id, { question: title || body.slice(0, 120), linkTo: { type: "card", id: card.id } });
      navigate(projectPath(project.id, "discern"), { decision: d.id });
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    try {
      const restore = await deleteCards([card.id]);
      onClose();
      toastUndo("Card deleted.", restore);
    } catch (e) {
      toastError(e);
    }
  };

  const source = card.source ? entities?.get(`${card.source.type}:${card.source.id}`) : undefined;

  return (
    <aside className="card-panel" aria-label="Card details" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <header className="card-panel-head">
        <Menu
          label="Card type"
          align="start"
          trigger={(t) => {
            const M = CARD_META[card.type];
            return (
              <button {...t} type="button" className="card-type-btn">
                <M.icon size={14} aria-hidden />
                {M.label}
              </button>
            );
          }}
          items={(Object.keys(CARD_META) as CardType[]).map((t) => ({
            label: CARD_META[t].label,
            icon: CARD_META[t].icon,
            checked: card.type === t,
            onSelect: () => void updateCard(card.id, { type: t }).catch(toastError),
          }))}
        />
        <span className="grow" />
        <IconButton
          icon={IconX}
          label="Close (Esc)"
          size="sm"
          onClick={() => {
            persist();
            onClose();
          }}
        />
      </header>
      <div className="card-panel-body scroll-y">
        <textarea
          ref={titleRef}
          className="card-panel-title"
          value={title}
          rows={1}
          placeholder="Name it in a few words"
          aria-label="Card title"
          onChange={(e) => {
            setTitle(e.target.value.replace(/\n/g, " "));
            schedule();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              bodyRef.current?.focus();
            }
          }}
        />
        <textarea
          ref={bodyRef}
          className="card-panel-text"
          value={body}
          rows={4}
          placeholder="What's the idea? Write as much or as little as you like."
          aria-label="Card notes"
          onChange={(e) => {
            setBody(e.target.value);
            schedule();
          }}
          onBlur={persist}
        />

        {source && (
          <a className="card-source" href={entityHref(project.id, source, card.source?.excerpt ? { hl: card.source.excerpt.slice(0, 160) } : {})}>
            <IconSource size={14} aria-hidden />
            <span className="grow">
              <span className="card-source-label">From {source.type === "transcript" ? "your recording" : source.group.toLowerCase()}: {source.title}</span>
              {card.source?.excerpt && <span className="card-source-excerpt">“{card.source.excerpt}”</span>}
            </span>
          </a>
        )}

        <section className="card-panel-section">
          <h3 className="card-panel-label">{isIdeas ? "Cluster" : "Section"}</h3>
          <Select
            label={isIdeas ? "Cluster" : "Section"}
            value={card.sectionId ?? ""}
            onChange={(v) => {
              if (isIdeas) {
                const s = data.sections.find((x) => x.id === v);
                const patch = s ? { sectionId: s.id, x: s.x + 20, y: s.y + 56 + data.cards.filter((c) => c.sectionId === s.id).length * 116 } : { sectionId: null };
                void updateCard(card.id, patch).catch(toastError);
              } else {
                const count = data.cards.filter((c) => c.sectionId === (v || null)).length;
                void updateCard(card.id, { sectionId: v || null, order: count }).catch(toastError);
              }
            }}
            options={[{ value: "", label: isIdeas ? "No cluster" : "Unplaced" }, ...[...data.sections].sort((a, b) => a.order - b.order).map((s) => ({ value: s.id, label: s.title }))]}
          />
        </section>

        <section className="card-panel-section">
          <div className="card-panel-row">
            <h3 className="card-panel-label">Connections</h3>
            <Button size="sm" variant="ghost" icon={IconConnect} onClick={() => setPickerOpen(true)}>
              Connect
            </Button>
          </div>
          {links.length === 0 ? (
            <p className="muted small">Link related ideas, characters, sources, or notes. Optional — only when it helps.</p>
          ) : (
            <div className="chip-row">
              {links.map(({ link, other }) => {
                const info = entities?.get(`${other.type}:${other.id}`);
                if (!info) return null;
                return <EntityChip key={link.id} projectId={project.id} info={info} kind={link.kind} onRemove={() => void removeLink(link.id).catch(toastError)} />;
              })}
            </div>
          )}
        </section>

        <section className="card-panel-section">
          <h3 className="card-panel-label">Next</h3>
          <div className="card-actions">
            {card.docId ? (
              <a className="card-action" href={href(projectPath(project.id, "write"), { doc: card.docId })}>
                <IconDoc size={15} aria-hidden />
                <span className="grow">Open its draft</span>
                <IconArrowRight size={14} aria-hidden />
              </a>
            ) : (
              <button type="button" className="card-action" onClick={() => void startDraft()}>
                <IconDoc size={15} aria-hidden />
                <span className="grow">Start a draft from this card</span>
                <IconArrowRight size={14} aria-hidden />
              </button>
            )}
            {data.otherBoard && (
              <Menu
                label={isIdeas ? "Add to structure" : "Copy to idea space"}
                align="start"
                trigger={(t) => (
                  <button {...t} type="button" className="card-action">
                    <IconMoveTo size={15} aria-hidden />
                    <span className="grow">{isIdeas ? "Add to the structure…" : "Copy to the idea space"}</span>
                    <IconArrowRight size={14} aria-hidden />
                  </button>
                )}
                items={
                  isIdeas
                    ? [...otherSections.map((c) => ({ label: c.section!.title, onSelect: () => void sendToOther(c.section!.id) })), { separator: true as const }, { label: "Unplaced", onSelect: () => void sendToOther(null) }]
                    : [{ label: "Copy to the idea space", onSelect: () => void sendToOther(null) }]
                }
              />
            )}
            {card.decisionId ? (
              <a className="card-action" href={href(projectPath(project.id, "discern"), { decision: card.decisionId })}>
                <IconSignpost size={15} aria-hidden />
                <span className="grow">Open the decision</span>
                <IconArrowRight size={14} aria-hidden />
              </a>
            ) : (
              (card.type === "decision" || card.type === "question") && (
                <button type="button" className="card-action" onClick={() => void recordDecision()}>
                  <IconSignpost size={15} aria-hidden />
                  <span className="grow">Work through this as a decision</span>
                  <IconArrowRight size={14} aria-hidden />
                </button>
              )
            )}
          </div>
        </section>
      </div>
      <footer className="card-panel-foot">
        <span className="faint small">Edits save automatically</span>
        <Button size="sm" variant="ghost" icon={IconTrash} className={cx("danger-text")} onClick={() => void remove()}>
          Delete
        </Button>
      </footer>
      <EntityPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        projectId={project.id}
        title="Connect this card"
        exclude={[`card:${card.id}`, ...links.map((l) => `${l.other.type}:${l.other.id}`)]}
        allowKinds={["related", ...LINK_KINDS.filter((k) => k.kind !== "related").map((k) => k.kind)]}
        onPick={(ref, kind) => void addLink(project.id, { type: "card", id: card.id }, ref, ref.type === "reference" && kind === "related" ? "features" : kind).catch(toastError)}
      />
    </aside>
  );
}
