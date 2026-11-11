import type { AgReportState, AgWidgetFieldReference, AgWidgetState } from "ag-studio";

import { FAIRNESS, LEDGER, type StudioCopy } from "./studio-sources";
import type { KinRegistry } from "./studio-widgets";

/** Kin's two widgets of its own, beside AG Studio's. */
export const FAIRNESS_GAP_WIDGET = "kin-fairness-gap";
export const PAYPAL_VERIFIED_WIDGET = "kin-paypal-verified";

const ledger = (field: string, aggregation?: "sum"): AgWidgetFieldReference => ({ id: `${LEDGER}.${field}`, ...(aggregation ? { aggregation } : {}) });
const fairness = (field: string, aggregation?: "sum"): AgWidgetFieldReference => ({ id: `${FAIRNESS}.${field}`, ...(aggregation ? { aggregation } : {}) });
const titled = (text: string) => ({ title: { enabled: true, text } });

type Layout = { readonly xTrack: number; readonly yTrack: number; readonly xSpan: number; readonly ySpan: number };

/** One widget of the opening page: its state and where it sits on AG Studio's 24-column canvas. */
export type StudioWidget = { readonly id: string; readonly state: AgWidgetState<KinRegistry>; readonly layout: Layout };

/**
 * The page the studio opens on: the record's story in seven widgets, Kin's two
 * first. Each sums only whole cents from the server's rows.
 */
export function studioWidgets(copy: StudioCopy): StudioWidget[] {
  const { widgets } = copy;
  return [
    {
      id: "verified",
      state: { type: PAYPAL_VERIFIED_WIDGET, dataMapping: { paypalId: [ledger("paypalId")], amount: [ledger("amountCents", "sum")] }, format: titled(widgets.verified.title) },
      layout: { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 16 },
    },
    {
      id: "fairness",
      state: {
        type: FAIRNESS_GAP_WIDGET,
        dataMapping: { member: [fairness("member")], given: [fairness("givenCents", "sum")], agreed: [fairness("agreedCents", "sum")], gap: [fairness("positionCents", "sum")] },
        format: titled(widgets.fairnessGap.title),
      },
      layout: { xTrack: 8, yTrack: 0, xSpan: 16, ySpan: 16 },
    },
    {
      id: "in-out",
      state: { type: "column-chart-grouped", dataMapping: { categoryKey: [ledger("month")], valueKey: [ledger("inCents", "sum"), ledger("outCents", "sum")] }, format: titled(widgets.inOut) },
      layout: { xTrack: 0, yTrack: 16, xSpan: 12, ySpan: 14 },
    },
    {
      id: "caregiver-pay",
      state: { type: "line-chart", dataMapping: { categoryKey: [ledger("month")], valueKey: [ledger("caregiverPayCents", "sum")] }, format: titled(widgets.caregiverPay) },
      layout: { xTrack: 12, yTrack: 16, xSpan: 12, ySpan: 14 },
    },
    {
      id: "proof",
      state: { type: "donut-chart", dataMapping: { categoryKey: [ledger("proof")], valueKey: [ledger("amountCents", "sum")] }, format: titled(widgets.proof) },
      layout: { xTrack: 0, yTrack: 30, xSpan: 10, ySpan: 14 },
    },
    {
      id: "fees",
      state: { type: "column-chart-grouped", dataMapping: { categoryKey: [ledger("month")], valueKey: [ledger("feeCents", "sum")] }, format: titled(widgets.fees) },
      layout: { xTrack: 10, yTrack: 30, xSpan: 14, ySpan: 14 },
    },
    {
      id: "ledger",
      state: { type: "grid", dataMapping: { cols: [ledger("day"), ledger("kind"), ledger("person"), ledger("amountCents"), ledger("feeCents"), ledger("proof"), ledger("paypalId")] }, format: titled(widgets.ledger) },
      layout: { xTrack: 0, yTrack: 44, xSpan: 24, ySpan: 18 },
    },
  ];
}

export const STUDIO_PAGE = "money";

/**
 * The opening report: one page, with AG Studio's side panels folded away so
 * the canvas has the room. The assistant's panel opens only where there is
 * room for it beside the canvas.
 */
export function studioReport(copy: StudioCopy, roomy: boolean): AgReportState<KinRegistry> {
  const widgets = studioWidgets(copy);
  return {
    pages: [{ id: STUDIO_PAGE, widgets: Object.fromEntries(widgets.map(({ id, state }) => [id, state])), widgetLayout: Object.fromEntries(widgets.map(({ id, layout }) => [id, layout])) }],
    selectedPageId: STUDIO_PAGE,
    panels: { filters: { collapsed: true }, data: { collapsed: true }, edit: { collapsed: true }, ai: { collapsed: !roomy } },
  };
}

/** The frame width from which the assistant's panel opens beside the canvas. */
export const ROOMY_WIDTH = 1040;
