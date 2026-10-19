import { PARTS, viewHref } from "./modes";
import { useRef } from "react";
import { db } from "../../data/db";
import { useLive } from "../../data/hooks";
import { updateProject } from "../../data/repo";
import type { Project } from "../../data/types";
import { cx, plural, relativeTime, truncate } from "../../lib/util";
import { IconArrowRight, IconAudio, IconCircleCheck, IconDoc, IconIdea, IconNote, IconSignpost, IconSprout } from "../../ui/icons";
import { toastError } from "../../ui/toast";
import { MikiAsks } from "./MikiAsks";

async function loadOverview(project: Project) {
  const id = project.id;
  const [docs, notes, recordings, transcripts, boards, sections, cards, decisions, steps] = await Promise.all([
    db.byIndex("documents", "projectId", id),
    db.byIndex("notes", "projectId", id),
    db.byIndex("recordings", "projectId", id),
    db.byIndex("transcripts", "projectId", id),
    db.byIndex("boards", "projectId", id),
    db.byIndex("sections", "projectId", id),
    db.byIndex("cards", "projectId", id),
    db.byIndex("decisions", "projectId", id),
    db.byIndex("steps", "projectId", id),
  ]);
  return { project, docs, notes, recordings, transcripts, boards, sections, cards, decisions, steps };
}

export function OverviewMode({ project }: { project: Project }) {
  const { data } = useLive(
    () => loadOverview(project),
    [project],
    ["documents", "notes", "recordings", "transcripts", "boards", "sections", "cards", "decisions", "steps"],
  );
  const threadRef = useRef<HTMLDivElement>(null);

  if (!data) return <div className="overview" aria-busy />;

  const ideas = data.boards.find((b) => b.kind === "ideas");
  const structure = data.boards.find((b) => b.kind === "structure");
  const ideaCards = data.cards.filter((c) => c.boardId === ideas?.id);
  const structureCards = data.cards.filter((c) => c.boardId === structure?.id);
  const promisingSection = data.sections.find((s) => s.boardId === ideas?.id && /promising/i.test(s.title));
  const promising = promisingSection ? ideaCards.filter((c) => c.sectionId === promisingSection.id) : [];
  const words = data.docs.reduce((n, d) => n + d.wordCount, 0);
  const lastDoc = [...data.docs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const openDecisions = data.decisions.filter((d) => d.status === "open");
  const decided = data.decisions.filter((d) => d.status === "decided").sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  const doneSteps = data.steps.filter((s) => s.status === "done").length;
  const nextStep = [...data.steps].sort((a, b) => a.order - b.order).find((s) => s.status === "open");

  const recent = [
    ...data.notes.map((n) => ({ id: n.id, icon: IconNote, title: n.title || truncate(n.body, 70), at: n.updatedAt, to: viewHref(project.id, "capture", { note: n.id }) })),
    ...data.transcripts.map((t) => ({ id: t.id, icon: IconAudio, title: t.title, at: t.updatedAt, to: viewHref(project.id, "capture", { tr: t.id }) })),
    ...ideaCards.map((c) => ({ id: c.id, icon: IconIdea, title: c.title || truncate(c.body, 70), at: c.updatedAt, to: viewHref(project.id, "explore", { card: c.id }) })),
    ...data.docs.map((d) => ({ id: d.id, icon: IconDoc, title: d.title, at: d.updatedAt, to: viewHref(project.id, "write", { doc: d.id }) })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  const threadSourceDecision = project.threadSource?.type === "decision" ? data.decisions.find((d) => d.id === project.threadSource!.id) : undefined;

  return (
    <div className="overview scroll-y">
      <div className="overview-inner">
        <section className="thread" ref={threadRef} aria-labelledby="thread-label">
          <p className="eyebrow" id="thread-label">
            The thread
          </p>
          <div className="thread-text">
            <ThreadEditor project={project} />
          </div>
          {threadSourceDecision && (
            <p className="thread-source">
              From your choice:{" "}
              <a className="link-btn" href={viewHref(project.id, "discern", { decision: threadSourceDecision.id })}>
                {threadSourceDecision.question || "Untitled decision"}
              </a>
            </p>
          )}
          {!project.thread.trim() && promising.length > 0 && (
            <div className="thread-picks">
              <span className="muted">Start from a promising leaf on the storyboard:</span>
              {promising.slice(0, 4).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  onClick={() => void updateProject(project.id, { thread: c.title || c.body, threadSource: { type: "card", id: c.id } }).catch(toastError)}
                >
                  <IconSprout size={13} aria-hidden />
                  <span>{truncate(c.title || c.body, 48)}</span>
                </button>
              ))}
            </div>
          )}
          {project.description && <p className="overview-desc">{project.description}</p>}
        </section>

        <div className="overview-asks">
          {PARTS.map((p) => (
            <MikiAsks key={p.part} project={project} part={p.part} />
          ))}
        </div>

        <div className="overview-grid">
          <section className="overview-card">
            <h2 className="section-title">Where you left off</h2>
            {lastDoc ? (
              <a className="ov-resume" href={viewHref(project.id, "write", { doc: lastDoc.id })}>
                <IconDoc size={18} aria-hidden />
                <div className="grow">
                  <p className="ov-resume-title">{lastDoc.title}</p>
                  <p className="ov-resume-meta">
                    {plural(lastDoc.wordCount, "word")} · edited {relativeTime(lastDoc.updatedAt)}
                  </p>
                  {lastDoc.plainText && <p className="ov-resume-excerpt">{truncate(lastDoc.plainText.split("\n").filter(Boolean).slice(-1)[0] ?? "", 160)}</p>}
                </div>
                <IconArrowRight size={16} aria-hidden />
              </a>
            ) : (
              <p className="muted small">
                No drafts yet.{" "}
                <a className="link-btn" href={viewHref(project.id, "write")}>
                  Start writing
                </a>{" "}
                whenever you're ready — there's no required order.
              </p>
            )}
            {nextStep && (
              <a className="ov-resume ov-resume-step" href={viewHref(project.id, "discern", { step: nextStep.id })}>
                <IconSignpost size={18} aria-hidden />
                <div className="grow">
                  <p className="ov-resume-title">Next step: {nextStep.title}</p>
                  <p className="ov-resume-meta">{nextStep.objective}</p>
                </div>
                <IconArrowRight size={16} aria-hidden />
              </a>
            )}
          </section>

          <section className="overview-card">
            <h2 className="section-title">The shape of it</h2>
            <dl className="shape">
              <ShapeRow label="Leaves" value={plural(data.notes.filter((n) => !n.fallen).length + data.recordings.length, "leaf", "leaves")} to={viewHref(project.id, "capture")} />
              <ShapeRow label="Storyboard" value={`${ideaCards.length}${promising.length ? ` · ${promising.length} promising` : ""}`} to={viewHref(project.id, "explore")} />
              <ShapeRow
                label="Trunk"
                value={`${plural(data.sections.filter((s) => s.boardId === structure?.id).length, "part")} · ${plural(structureCards.length, "piece")}`}
                to={viewHref(project.id, "arrange")}
              />
              <ShapeRow label="Drafts" value={`${plural(data.docs.length, "document")} · ${plural(words, "word")}`} to={viewHref(project.id, "write")} />
              <ShapeRow
                label="Choices"
                value={`${decided.length} made${openDecisions.length ? ` · ${openDecisions.length} open` : ""}${data.steps.length ? ` · ${doneSteps}/${data.steps.length} steps` : ""}`}
                to={viewHref(project.id, "discern")}
              />
            </dl>
          </section>

          {decided.length > 0 && (
            <section className="overview-card">
              <h2 className="section-title">Choices so far</h2>
              <ul className="decision-log" role="list">
                {decided.slice(0, 4).map((d) => {
                  const chosen = d.options.find((o) => o.id === d.chosenOptionId);
                  return (
                    <li key={d.id}>
                      <a href={viewHref(project.id, "discern", { decision: d.id })} className="decision-log-item">
                        <IconCircleCheck size={16} aria-hidden />
                        <div className="grow">
                          <p className="decision-log-q">{d.question || "Untitled decision"}</p>
                          {chosen && <p className="decision-log-a">{chosen.text}</p>}
                          {d.rationale && <p className="decision-log-why">{truncate(d.rationale, 160)}</p>}
                        </div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className={cx("overview-card", decided.length === 0 && "span-2")}>
            <h2 className="section-title">Recently touched</h2>
            {recent.length ? (
              <ul className="recent" role="list">
                {recent.map((r) => (
                  <li key={r.id}>
                    <a className="list-row" href={r.to}>
                      <r.icon size={15} aria-hidden className="faint" />
                      <span className="grow list-row-title">{r.title || "Untitled"}</span>
                      <span className="list-row-meta">{relativeTime(r.at)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing here yet. Start with what you have — a sentence, a memo, a question.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ShapeRow({ label, value, to }: { label: string; value: string; to: string }) {
  return (
    <a className="shape-row" href={to}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </a>
  );
}

function ThreadEditor({ project }: { project: Project }) {
  return (
    <textarea
      key={project.id + project.thread}
      className="thread-input"
      aria-label="The thread: the central idea of this project"
      defaultValue={project.thread}
      placeholder="What's this really about? Find the thread."
      rows={1}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
      ref={(el) => {
        if (el) {
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v !== project.thread) void updateProject(project.id, { thread: v, threadSource: undefined }).catch(toastError);
      }}
    />
  );
}
