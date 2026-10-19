// Tiny hash router. Hash URLs work on any static host (GitHub Pages, a file share, the single-file demo).
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

let cache: { hash: string; route: Route } | null = null;

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const clean = path.startsWith("/") ? path : "/" + path;
  return { path: clean, segments: clean.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

function current(): Route {
  const h = typeof location !== "undefined" ? location.hash : "";
  if (!cache || cache.hash !== h) cache = { hash: h, route: parse(h) };
  return cache.route;
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current, current);
}

export function href(path: string, query?: Record<string, string | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}

export function navigate(path: string, query?: Record<string, string | undefined | null>, opts: { replace?: boolean } = {}) {
  const target = href(path, query);
  if (target === location.hash) return;
  if (opts.replace) {
    history.replaceState(history.state, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else location.hash = target;
}

/** Update query params on the current path. */
export function setQuery(patch: Record<string, string | undefined | null>, opts: { replace?: boolean } = {}) {
  const r = current();
  const q: Record<string, string> = {};
  r.query.forEach((v, k) => (q[k] = v));
  for (const [k, v] of Object.entries(patch)) {
    if (v) q[k] = v;
    else delete q[k];
  }
  navigate(r.path, q, opts);
}

export const projectPath = (projectId: string, mode?: string) => `/p/${encodeURIComponent(projectId)}${mode && mode !== "overview" ? `/${mode}` : ""}`;

export function Link({ to, query, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; query?: Record<string, string | undefined | null> }) {
  return (
    <a
      href={href(to, query)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
      }}
      {...rest}
    />
  );
}
