import { themeQuartz } from "ag-grid-community";

/**
 * AG Grid in Kin's own colours. Every colour is a design token, so the grid
 * follows the light and dark themes with no second definition.
 */
export const ledgerGridTheme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  chromeBackgroundColor: "var(--muted)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 500,
  borderColor: "var(--border)",
  accentColor: "var(--ring)",
  selectedRowBackgroundColor: "var(--secondary)",
  rowHoverColor: "color-mix(in srgb, var(--muted) 70%, transparent)",
  browserColorScheme: "inherit",
  fontFamily: "inherit",
  fontSize: 15,
  headerFontSize: 14,
  rowHeight: 68,
  headerHeight: 44,
  spacing: 8,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerColumnBorder: false,
});
