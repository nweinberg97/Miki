import { INBOX } from "../../data/types";
import { useRoute } from "../../lib/router";
import { CaptureWorkspace } from "../capture/CaptureWorkspace";

/** Unsorted: everything captured before deciding where it belongs. */
export function InboxPage() {
  const route = useRoute();
  return (
    <div className="inbox-page">
      <CaptureWorkspace
        projectId={INBOX}
        project={null}
        query={route.query}
        basePath="/inbox"
        intro={
          <header className="inbox-head">
            <h1 className="page-title inbox-title">Unsorted</h1>
            <p className="muted small">Thoughts that don't have a home yet. Move them into a project whenever it's clear where they belong — or leave them be.</p>
          </header>
        }
      />
    </div>
  );
}
