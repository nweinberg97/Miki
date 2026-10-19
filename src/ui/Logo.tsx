import { GLYPH_KI, GLYPH_SAN } from "./logoGlyphs";

/**
 * The Miki mark: 三木, "three trees", set vertically like a seal.
 * Drawn from real glyph outlines so it renders identically everywhere.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size * 0.5} height={size} viewBox="0 0 500 1000" aria-hidden fill="currentColor">
      <path transform="translate(0 0) scale(0.5)" d={GLYPH_SAN} />
      <path transform="translate(0 500) scale(0.5)" d={GLYPH_KI} />
    </svg>
  );
}

/** 三木 with MIKI spaced beneath it — the brand lockup. */
export function Wordmark({ size = 22, stacked = false }: { size?: number; stacked?: boolean }) {
  return (
    <span className={stacked ? "wordmark is-stacked" : "wordmark"} style={{ fontSize: size }}>
      <svg width={size * 2} height={size} viewBox="0 0 2000 1000" aria-hidden fill="currentColor">
        <path transform="translate(0 20) scale(0.96)" d={GLYPH_SAN} />
        <path transform="translate(1000 20) scale(0.96)" d={GLYPH_KI} />
      </svg>
      <span className="wordmark-text">MIKI</span>
    </span>
  );
}
