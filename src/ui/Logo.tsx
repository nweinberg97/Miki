/**
 * The Miki mark: a page-like frame left open at one corner, with a single point of focus.
 * It reads as "looking closely" — the aperture where the essential idea comes into view.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M38 13H21a8 8 0 0 0-8 8v22a8 8 0 0 0 8 8h22a8 8 0 0 0 8-8V26" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <circle cx="43.5" cy="20.5" r="5" fill="var(--moss)" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <LogoMark size={size * 1.1} />
      <span className="wordmark-text">miki</span>
    </span>
  );
}
