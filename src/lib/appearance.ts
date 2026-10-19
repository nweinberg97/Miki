// Appearance preferences live in localStorage so they apply before first paint.
export type Theme = "system" | "light" | "dark";
export type ProseSize = "small" | "medium" | "large";
export type Measure = "narrow" | "medium" | "wide";

const SIZES: Record<ProseSize, string> = { small: "1.0625rem", medium: "1.1875rem", large: "1.3125rem" };
const MEASURES: Record<Measure, string> = { narrow: "34rem", medium: "38rem", wide: "44rem" };

function read<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage disabled: the setting applies for this session only */
  }
}

export const getTheme = () => read<Theme>("miki:theme", "system", ["system", "light", "dark"]);
export const getProseSize = () => read<ProseSize>("miki:proseSize", "medium", ["small", "medium", "large"]);
export const getMeasure = () => read<Measure>("miki:measure", "medium", ["narrow", "medium", "wide"]);

export function applyAppearance() {
  const root = document.documentElement;
  const theme = getTheme();
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Only override the size on wide screens; small screens use their own default.
  if (window.matchMedia("(min-width: 769px)").matches) root.style.setProperty("--prose-size", SIZES[getProseSize()]);
  root.style.setProperty("--prose-measure", MEASURES[getMeasure()]);
}

export function setTheme(t: Theme) {
  write("miki:theme", t);
  applyAppearance();
}
export function setProseSize(s: ProseSize) {
  write("miki:proseSize", s);
  applyAppearance();
}
export function setMeasure(m: Measure) {
  write("miki:measure", m);
  applyAppearance();
}
