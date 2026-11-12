import { studioTheme } from "ag-studio";

/**
 * AG Studio in Kin's own colours, as the Record's grid is (grid-theme.ts).
 * Every colour is a design token, so the studio follows the light and dark
 * themes with no second definition: warm paper widgets on Kin's background,
 * gold light for focus and selection, and each sibling's share colour first in
 * the charts' palette, so a member keeps their colour from screen to screen.
 */
const gold = (alpha: number) => `rgb(var(--glow-gold) / ${alpha})`;

export const kinStudioTheme = studioTheme.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  textColor: "var(--foreground)",
  subtleTextColor: "var(--muted-foreground)",
  borderColor: "var(--border)",
  accentColor: "var(--ring)",
  invalidColor: "var(--danger)",
  focusShadow: `0 0 0 2px var(--card), 0 0 0 4px var(--ring), 0 0 18px 2px ${gold(0.35)}`,
  inputFocusShadow: `0 0 0 3px ${gold(0.3)}`,
  inputBackgroundColor: "var(--card)",
  inputBorder: { color: "var(--input)" },
  inputFocusBorder: { color: "var(--ring)" },
  menuBackgroundColor: "var(--popover)",
  menuBorder: { color: "var(--border)" },
  rowHoverColor: `color-mix(in oklab, ${gold(1)} 6%, var(--muted))`,
  popupShadow: "var(--shadow-lg)",
  dialogShadow: "var(--shadow-xl)",
  tooltipBackgroundColor: "var(--popover)",
  tooltipTextColor: "var(--popover-foreground)",
  buttonBackgroundColor: "var(--secondary)",
  buttonTextColor: "var(--secondary-foreground)",
  buttonHoverBackgroundColor: "color-mix(in oklab, var(--secondary) 80%, var(--foreground) 8%)",
  checkboxCheckedBackgroundColor: "var(--primary)",
  checkboxCheckedBorderColor: "var(--primary)",
  checkboxCheckedShapeColor: "var(--primary-foreground)",
  toggleButtonOnBackgroundColor: "var(--primary)",
  tabSelectedBorderColor: "var(--ring)",
  borderRadius: 10,
  browserColorScheme: "inherit",
  fontFamily: "inherit",
  studioWrapperBorder: false,
  studioWrapperBackgroundColor: "var(--background)",
  studioCanvasBackgroundColor: "var(--background)",
  studioCanvasGridLineColor: "color-mix(in oklab, var(--border) 60%, transparent)",
  studioPanelContainerBackgroundColor: "var(--card)",
  studioPanelContainerBorder: { color: "var(--border)" },
  studioPanelContainerBorderRadius: 20,
  studioWidgetBackgroundColor: "var(--card)",
  studioWidgetBorder: { color: "var(--border)" },
  studioWidgetBorderRadius: 20,
  studioWidgetShadow: "var(--shadow-sm)",
  studioWidgetSelectedBorderColor: "var(--ring)",
  studioWidgetTitleFontFamily: "var(--font-serif)",
  studioWidgetTitleFontSize: 18,
  studioAiPanelWidth: 320,
  // The canvas fits the frame Kin gives it, so no widget is cut off at its edge.
  studioCanvasMinWidth: 480,
  studioWidgetTitleTextColor: "var(--foreground)",
  studioWidgetSubtitleTextColor: "var(--muted-foreground)",
  // Kin's own minimum: below it the page shows Kin's summary instead (studio-surface.tsx).
  studioMinWidth: 640,
  chartPaletteFills1Color: "var(--share-1)",
  chartPaletteFills2Color: "var(--share-2)",
  chartPaletteFills3Color: "var(--share-3)",
  chartPaletteFills4Color: "var(--gold)",
  chartPaletteFills5Color: "var(--positive)",
  chartPaletteFills6Color: "var(--danger)",
});

/** Below this width of its frame the studio does not open, and the page shows Kin's summary. */
export const STUDIO_MIN_WIDTH = 640;
