import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  onSystemThemeChange,
  parseThemeChoice,
  resolveTheme,
  systemPrefersDark,
  type Theme,
  type ThemeChoice,
} from "./theme";

const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage is blocked (private mode, strict settings). Follow the device.
    return "system";
  }
}

function apply(): void {
  const theme = resolveTheme(readChoice(), systemPrefersDark());
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  listeners.forEach((listener) => listener());
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  const stopSystem = onSystemThemeChange(apply);
  // Another tab changed the choice.
  window.addEventListener("storage", apply);
  return () => {
    listeners.delete(listener);
    stopSystem();
    window.removeEventListener("storage", apply);
  };
}

export function currentChoice(): ThemeChoice {
  return readChoice();
}

export function currentTheme(): Theme {
  return resolveTheme(readChoice(), systemPrefersDark());
}

export function chooseTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage is blocked, so the choice cannot outlive this page. Nothing else
    // can be done about that, and the page itself still follows the device.
  }
  apply();
}
