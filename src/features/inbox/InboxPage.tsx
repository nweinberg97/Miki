import { INBOX } from "../../data/types";
import { useRoute } from "../../lib/router";
import { CaptureWorkspace } from "../capture/CaptureWorkspace";

/** Seeds: thoughts planted before knowing which tree they belong to. */
export function InboxPage() {
  const route = useRoute();
  return (
    <div className="inbox-page">
      <CaptureWorkspace
        projectId={INBOX}
        project={null}
        query={route.query}
        basePath="/seeds"
        intro={
          <header className="inbox-head">
            <h1 className="page-title inbox-title">Seeds</h1>
            <p className="muted small">Thoughts that don't know where they belong yet. Plant each one in a project when it's clear — or let it wait.</p>
          </header>
        }
      />
    </div>
  );
}
