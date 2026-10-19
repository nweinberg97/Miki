import type { Part } from "../data/types";

/** The three drawings from the story: roots below ground, leaves in the air, a trunk that stands. */
export function PartGlyph({ part, size = 40, className }: { part: Part; size?: number; className?: string }) {
  const common = { width: size * 1.25, height: size, viewBox: "0 0 120 96", "aria-hidden": true, className } as const;
  if (part === "roots") {
    return (
      <svg {...common}>
        <path d="M60 8 V52" stroke="var(--bark)" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M8 52 H112" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M60 52 C58 66 46 74 30 88 M60 52 C62 68 74 76 92 90 M60 52 V90" stroke="var(--bark)" strokeWidth="3" strokeLinecap="round" fill="none" />
        <circle cx="60" cy="10" r="4" fill="var(--leaf)" />
      </svg>
    );
  }
  if (part === "leaves") {
    return (
      <svg {...common}>
        <path d="M60 92 V44" stroke="var(--bark)" strokeWidth="5" strokeLinecap="round" fill="none" />
        <ellipse cx="44" cy="30" rx="16" ry="9" transform="rotate(-30 44 30)" fill="var(--leaf)" />
        <ellipse cx="76" cy="28" rx="16" ry="9" transform="rotate(30 76 28)" fill="var(--leaf-2)" />
        <ellipse cx="60" cy="16" rx="9" ry="15" fill="var(--leaf-3)" />
        <ellipse cx="92" cy="80" rx="8" ry="4.5" transform="rotate(20 92 80)" fill="var(--fallen)" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M60 92 V20" stroke="var(--bark)" strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M60 52 L36 34 M60 40 L84 24" stroke="var(--bark)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="34" cy="32" r="7" fill="var(--leaf)" />
      <circle cx="86" cy="22" r="7" fill="var(--leaf)" />
      <circle cx="60" cy="14" r="8" fill="var(--leaf-3)" />
    </svg>
  );
}

export type Stage = "seed" | "rooting" | "leafing" | "standing";

/**
 * A project drawn as a tree. Its shape follows the real state of the work:
 * a seed until it has roots, a sapling while leaves grow, a full tree once it stands on a trunk.
 */
export function Tree({ stage, leaves, trunk, className }: { stage: Stage; leaves: number; trunk: number; className?: string }) {
  if (stage === "seed") {
    return (
      <svg className={className} width="120" height="80" viewBox="0 0 120 80" aria-hidden>
        <ellipse cx="60" cy="66" rx="10" ry="7" fill="var(--fallen)" />
        <path d="M60 60 C60 46 52 40 44 38 M60 56 C62 44 70 38 78 36" stroke="var(--leaf)" strokeWidth="3" strokeLinecap="round" fill="none" strokeDasharray="3 5" />
      </svg>
    );
  }
  if (stage === "rooting") {
    return (
      <svg className={className} width="120" height="110" viewBox="0 0 120 110" aria-hidden>
        <path d="M60 108 V54" stroke="var(--bark)" strokeWidth="6" strokeLinecap="round" />
        <ellipse cx="42" cy="46" rx="18" ry="10" transform="rotate(-25 42 46)" fill="var(--leaf-2)" />
        <ellipse cx="78" cy="40" rx="18" ry="10" transform="rotate(25 78 40)" fill="var(--leaf)" />
        <ellipse cx="60" cy="26" rx="10" ry="17" fill="var(--leaf-3)" />
      </svg>
    );
  }
  // Canopy grows with leaves; trunk thickens with what's been carried onto it.
  const canopy = Math.min(1, 0.55 + leaves / 40);
  const thick = Math.min(12, 6 + trunk);
  if (stage === "leafing") {
    const s = canopy;
    return (
      <svg className={className} width={160} height={180} viewBox="0 0 160 180" aria-hidden>
        <path d="M80 178 V86" stroke="var(--bark)" strokeWidth={thick} strokeLinecap="round" />
        <path d="M80 130 L56 104" stroke="var(--bark)" strokeWidth="4" strokeLinecap="round" />
        <g transform={`translate(80 80) scale(${s}) translate(-80 -80)`}>
          <circle cx="80" cy="66" r="40" fill="var(--leaf-3)" />
          <circle cx="52" cy="98" r="24" fill="var(--leaf)" />
          <circle cx="108" cy="80" r="24" fill="var(--leaf-2)" />
        </g>
      </svg>
    );
  }
  return (
    <svg className={className} width={180} height={230} viewBox="0 0 180 230" aria-hidden>
      <path d="M90 228 V96" stroke="var(--bark)" strokeWidth={thick} strokeLinecap="round" />
      <path d="M90 150 L58 118 M90 128 L124 96" stroke="var(--bark)" strokeWidth="5" strokeLinecap="round" />
      <g transform={`translate(90 80) scale(${canopy}) translate(-90 -80)`}>
        <circle cx="90" cy="70" r="52" fill="var(--leaf)" />
        <circle cx="52" cy="104" r="30" fill="var(--leaf-2)" />
        <circle cx="130" cy="92" r="32" fill="var(--leaf-3)" />
        <circle cx="96" cy="40" r="26" fill="var(--leaf-2)" />
      </g>
    </svg>
  );
}

export function stageOf(p: { purpose?: string; thread: string }, leaves: number, trunk: number, words: number): Stage {
  if (trunk > 0 || words > 30) return "standing";
  if (leaves > 0) return "leafing";
  if (p.purpose?.trim() || p.thread.trim()) return "rooting";
  return "seed";
}

export const STAGE_LABEL: Record<Stage, string> = { seed: "just planted", rooting: "rooting", leafing: "leafing", standing: "standing" };
