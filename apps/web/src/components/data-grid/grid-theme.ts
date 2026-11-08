import { themeQuartz } from "ag-grid-community";

/**
 * AG Grid in Kin's own colours. Every colour is a design token, so the grid
 * follows the light and dark themes (and any contrast the tokens carry) with
 * no second definition. Rows are at least 48 pixels tall, above the 44 pixel
 * touch target of AGENTS.md section 8.
 */
export const kinGridTheme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  chromeBackgroundColor: "var(--muted)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 600,
  borderColor: "var(--border)",
  accentColor: "var(--ring)",
  selectedRowBackgroundColor: "var(--secondary)",
  rowHoverColor: "color-mix(in srgb, var(--muted) 70%, transparent)",
  inputBorder: { color: "var(--input)" },
  inputFocusBorder: { color: "var(--ring)" },
  menuBackgroundColor: "var(--popover)",
  popupShadow: "0 8px 24px color-mix(in srgb, var(--foreground) 18%, transparent)",
  browserColorScheme: "inherit",
  fontFamily: "inherit",
  fontSize: 15,
  headerFontSize: 14,
  rowHeight: 52,
  headerHeight: 48,
  spacing: 8,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerColumnBorder: false,
});
