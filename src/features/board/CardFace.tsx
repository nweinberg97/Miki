import type { Card } from "../../data/types";
import { cx, truncate } from "../../lib/util";
import { IconDoc, IconSource, IconWaypoints } from "../../ui/icons";
import { CARD_META } from "./cardMeta";

/** The visual content of a card, shared by the canvas, the structure columns, and lists. */
export function CardFace({ card, linkCount = 0, refNames = [], highlight }: { card: Card; linkCount?: number; refNames?: string[]; highlight?: string }) {
  const meta = CARD_META[card.type];
  const Icon = meta.icon;
  const title = card.title.trim();
  const body = card.body.trim();
  return (
    <>
      <span className="card-type">
        <Icon size={12} aria-hidden />
        {meta.label}
      </span>
      {title ? <span className="card-title">{mark(title, highlight)}</span> : !body && <span className="card-title is-placeholder">Untitled</span>}
      {body && <span className={cx("card-body", !title && "is-lead")}>{mark(truncate(body, title ? 180 : 240), highlight)}</span>}
      {(card.docId || card.source || linkCount > 0 || refNames.length > 0) && (
        <span className="card-foot">
          {refNames.slice(0, 3).map((n) => (
            <span key={n} className="card-ref">
              {n}
            </span>
          ))}
          {refNames.length > 3 && <span className="card-ref">+{refNames.length - 3}</span>}
          <span className="grow" />
          {card.source && <IconSource size={12} aria-label="Has a source" />}
          {linkCount > 0 && (
            <span className="card-foot-count" title={`${linkCount} connection${linkCount === 1 ? "" : "s"}`}>
              <IconWaypoints size={12} aria-hidden />
              {linkCount}
            </span>
          )}
          {card.docId && <IconDoc size={12} aria-label="Has a draft" />}
        </span>
      )}
    </>
  );
}

function mark(text: string, needle?: string) {
  if (!needle) return text;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}
