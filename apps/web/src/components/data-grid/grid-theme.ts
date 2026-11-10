import { themeQuartz } from "ag-grid-community";

/**
 * AG Grid in Kin's own colours. Every colour is a design token, so the grid
 * follows the light and dark themes (and any contrast the tokens carry) with
 * no second definition: warm paper rows on the card, a soft header in the
 * muted tone, and gold light for focus and selection. Rows are at least 48
 * pixels tall, above the 44 pixel touch target of AGENTS.md section 8.
 */
const gold = (alpha: number) => `rgb(var(--glow-gold) / ${alpha})`;

export const kinGridTheme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  textColor: "var(--foreground)",
  chromeBackgroundColor: "color-mix(in oklab, var(--muted) 85%, var(--card))",
  headerBackgroundColor: "color-mix(in oklab, var(--muted) 85%, var(--card))",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 600,
  headerCellHoverBackgroundColor: "var(--secondary)",
  headerRowBorder: { color: "var(--border)" },
  borderColor: "var(--border)",
  rowBorder: { color: "color-mix(in oklab, var(--border) 70%, transparent)" },
  accentColor: "var(--ring)",
  // Fixed, never the reader's: --ring is the gold that passes AA on the card in both themes.
  focusShadow: `0 0 0 2px var(--card), 0 0 0 4px var(--ring), 0 0 18px 2px ${gold(0.35)}`,
  inputFocusShadow: `0 0 0 3px ${gold(0.3)}`,
  selectedRowBackgroundColor: `color-mix(in oklab, ${gold(1)} 12%, var(--card))`,
  rowHoverColor: `color-mix(in oklab, ${gold(1)} 6%, var(--muted))`,
  rangeSelectionBorderColor: "var(--ring)",
  pinnedColumnBorder: { color: "color-mix(in oklab, var(--border) 80%, transparent)" },
  checkboxCheckedBackgroundColor: "var(--primary)",
  checkboxCheckedBorderColor: "var(--primary)",
  checkboxCheckedShapeColor: "var(--primary-foreground)",
  checkboxUncheckedBorderColor: "var(--input)",
  checkboxBorderRadius: 6,
  inputBackgroundColor: "var(--card)",
  inputBorder: { color: "var(--input)" },
  inputFocusBorder: { color: "var(--ring)" },
  inputBorderRadius: 10,
  iconButtonHoverBackgroundColor: "var(--secondary)",
  iconButtonHoverColor: "var(--foreground)",
  menuBackgroundColor: "var(--popover)",
  menuBorder: { color: "var(--border)" },
  popupShadow: "var(--shadow-lg)",
  cardShadow: "var(--shadow-md)",
  borderRadius: 10,
  browserColorScheme: "inherit",
  fontFamily: "inherit",
  fontSize: 15,
  headerFontSize: 13,
  rowHeight: 56,
  headerHeight: 48,
  spacing: 8,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerColumnBorder: false,
});
