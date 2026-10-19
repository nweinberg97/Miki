import { db } from "../data/db";
import { useLive } from "../data/hooks";
import { INBOX } from "../data/types";
import { href, useRoute } from "../lib/router";
import { openCapture, ui } from "../lib/store";
import { cx } from "../lib/util";
import { IconGrid, IconInbox, IconMic, IconPen, IconSearch, IconSettings } from "../ui/icons";
import { LogoMark } from "../ui/Logo";

function useInboxCount() {
  const { data } = useLive(
    async () => {
      const [notes, recs] = await Promise.all([db.byIndex("notes", "projectId", INBOX), db.byIndex("recordings", "projectId", INBOX)]);
      return notes.length + recs.length;
    },
    [],
    ["notes", "recordings"],
  );
  return data ?? 0;
}

function currentProjectId(path: string): string | undefined {
  const m = path.match(/^\/p\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export function Rail() {
  const route = useRoute();
  const count = useInboxCount();
  const first = route.segments[0];
  const projectId = currentProjectId(route.path);
  return (
    <nav className="rail" aria-label="Main">
      <a href="#/" className="rail-logo" aria-label="Miki — studio home">
        <LogoMark size={30} />
      </a>
      <div className="rail-group">
        <a href="#/" className={cx("rail-item", (!first || first === "p") && "is-active")} aria-current={!first ? "page" : undefined}>
          <IconGrid size={19} aria-hidden />
          <span>Studio</span>
        </a>
        <a href="#/inbox" className={cx("rail-item", first === "inbox" && "is-active")} aria-current={first === "inbox" ? "page" : undefined}>
          <span className="rail-icon-wrap">
            <IconInbox size={19} aria-hidden />
            {count > 0 && <span className="rail-dot" aria-label={`${count} unsorted`} />}
          </span>
          <span>Unsorted</span>
        </a>
        <button type="button" className="rail-item" onClick={() => ui.set({ palette: true })} title="Search (⌘K)">
          <IconSearch size={19} aria-hidden />
          <span>Search</span>
        </button>
      </div>
      <div className="rail-group rail-capture">
        <button type="button" className="rail-capture-btn" onClick={() => openCapture({ tab: "write", projectId })} title="Capture a thought (C)">
          <IconPen size={18} aria-hidden />
          <span className="sr-only">Capture a thought</span>
        </button>
        <button type="button" className="rail-capture-btn is-voice" onClick={() => openCapture({ tab: "speak", projectId })} title="Record a voice note (R)">
          <IconMic size={18} aria-hidden />
          <span className="sr-only">Record a voice note</span>
        </button>
      </div>
      <div className="rail-spacer" />
      <a href="#/settings" className={cx("rail-item", first === "settings" && "is-active")} aria-current={first === "settings" ? "page" : undefined}>
        <IconSettings size={19} aria-hidden />
        <span>Settings</span>
      </a>
    </nav>
  );
}

export function MobileNav() {
  const route = useRoute();
  const count = useInboxCount();
  const first = route.segments[0];
  const projectId = currentProjectId(route.path);
  return (
    <nav className="mobile-nav" aria-label="Main">
      <a href={href("/")} className={cx("mobile-nav-item", (!first || first === "p") && "is-active")}>
        <IconGrid size={20} aria-hidden />
        <span>Studio</span>
      </a>
      <a href="#/inbox" className={cx("mobile-nav-item", first === "inbox" && "is-active")}>
        <span className="rail-icon-wrap">
          <IconInbox size={20} aria-hidden />
          {count > 0 && <span className="rail-dot" />}
        </span>
        <span>Unsorted</span>
      </a>
      <div className="mobile-capture">
        <button type="button" className="mobile-capture-btn" onClick={() => openCapture({ tab: "write", projectId })} aria-label="Capture a thought">
          <IconPen size={20} aria-hidden />
        </button>
        <button type="button" className="mobile-capture-btn is-voice" onClick={() => openCapture({ tab: "speak", projectId })} aria-label="Record a voice note">
          <IconMic size={20} aria-hidden />
        </button>
      </div>
      <button type="button" className="mobile-nav-item" onClick={() => ui.set({ palette: true })}>
        <IconSearch size={20} aria-hidden />
        <span>Search</span>
      </button>
      <a href="#/settings" className={cx("mobile-nav-item", first === "settings" && "is-active")}>
        <IconSettings size={20} aria-hidden />
        <span>Settings</span>
      </a>
    </nav>
  );
}
