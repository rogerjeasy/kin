export const themeChoices = ["light", "dark", "system"] as const;

export type ThemeChoice = (typeof themeChoices)[number];

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "kin-theme";

export const THEME_ATTRIBUTE = "data-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseThemeChoice(raw: string | null): ThemeChoice {
  return themeChoices.find((choice) => choice === raw) ?? "system";
}

export function resolveTheme(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): Theme {
  if (choice === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return choice;
}

/**
 * Runs in <head> before the first paint, so the page never flashes the wrong
 * theme. It cannot import anything, so it restates resolveTheme in plain
 * script. theme.test.ts runs both against the same cases.
 */
export const themeScript = `(function(){var c=null;try{c=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}var d=c==="dark"||(c!=="light"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches);document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},d?"dark":"light")})()`;

export function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

export function onSystemThemeChange(listener: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
