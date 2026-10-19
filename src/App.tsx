import { useEffect, useState } from "react";
import { openDB, diagnostics } from "./data/db";
import { getPref } from "./data/repo";
import { useRoute, navigate } from "./lib/router";
import { ui, openCapture } from "./lib/store";
import { isTypingTarget } from "./lib/util";
import { Rail, MobileNav } from "./shell/Rail";
import { StudioPage } from "./features/studio/StudioPage";
import { InboxPage } from "./features/inbox/InboxPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { ProjectPage } from "./features/project/ProjectPage";
import { CaptureDialog } from "./features/capture/CaptureDialog";
import { CommandPalette } from "./features/search/CommandPalette";
import { ShortcutsDialog } from "./shell/ShortcutsDialog";
import { DialogHost } from "./ui/Dialog";
import { ToastHost } from "./ui/toast";
import { Button, EmptyState, Spinner } from "./ui/ui";
import { IconWarning } from "./ui/icons";
import { LogoMark } from "./ui/Logo";
import type { StoreName } from "./data/types";

export function App() {
  const [boot, setBoot] = useState<"loading" | "ready" | Error>("loading");

  useEffect(() => {
    openDB()
      .then(async () => {
        const failing = await getPref<StoreName[]>("diagnostics:failWrites", []);
        failing.forEach((s) => diagnostics.failWritesTo.add(s));
        setBoot("ready");
      })
      .catch((err: Error) => setBoot(err));
    const onVersion = () => setBoot(new Error("Miki was updated in another tab. Reload this tab to keep working safely."));
    window.addEventListener("miki:db-versionchange", onVersion);
    return () => window.removeEventListener("miki:db-versionchange", onVersion);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.defaultPrevented) return;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.set((s) => ({ palette: !s.palette }));
        return;
      }
      if (e.defaultPrevented || mod || e.altKey || isTypingTarget(e.target) || document.querySelector("dialog[open]")) return;
      if (e.key === "/") {
        e.preventDefault();
        ui.set({ palette: true });
      } else if (e.key === "c") {
        e.preventDefault();
        openCapture({ tab: "write", projectId: projectIdFromHash() });
      } else if (e.key === "r") {
        e.preventDefault();
        openCapture({ tab: "speak", projectId: projectIdFromHash() });
      } else if (e.key === "?") {
        e.preventDefault();
        ui.set({ shortcuts: true });
      } else if (e.key === "g") {
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (boot === "loading") {
    return (
      <div className="boot" aria-busy>
        <LogoMark size={36} />
        <Spinner size={18} label="Opening your studio" />
      </div>
    );
  }
  if (boot instanceof Error) {
    return (
      <div className="boot">
        <EmptyState
          icon={IconWarning}
          title="Miki can't open your studio"
          actions={
            <Button variant="primary" onClick={() => location.reload()}>
              Reload
            </Button>
          }
        >
          <p>{boot.message}</p>
          <p style={{ marginTop: 8 }}>
            Your work is stored in this browser's local database. Nothing has been deleted; Miki just can't reach it right now. If you're in a private
            window, try a regular one.
          </p>
        </EmptyState>
      </div>
    );
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app">
        <Rail />
        <main id="main" className="app-main" tabIndex={-1}>
          <Routes />
        </main>
        <MobileNav />
      </div>
      <CaptureDialog />
      <CommandPalette />
      <ShortcutsDialog />
      <DialogHost />
      <ToastHost />
    </>
  );
}

function projectIdFromHash(): string | undefined {
  const m = location.hash.match(/^#\/p\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

function Routes() {
  const route = useRoute();
  const [first, second, third] = route.segments;
  useEffect(() => {
    document.getElementById("main")?.scrollTo?.(0, 0);
  }, [route.path]);
  if (!first) return <StudioPage />;
  if (first === "inbox") return <InboxPage />;
  if (first === "settings") return <SettingsPage />;
  if (first === "p" && second) return <ProjectPage projectId={second} mode={third} query={route.query} />;
  return (
    <EmptyState
      title="Nothing here"
      actions={
        <Button variant="primary" onClick={() => navigate("/")}>
          Back to the studio
        </Button>
      }
    >
      That page doesn't exist.
    </EmptyState>
  );
}
