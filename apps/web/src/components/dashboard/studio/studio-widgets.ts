import type { AgDataMappingDefinition, AgDefaultWidgetDefinition, AgWidgetFormParams } from "ag-studio";
import { createWidgets, type AgRegistry, type AgWidgetDefinition } from "ag-studio-react";

import { FairnessGapWidget } from "./fairness-gap-widget";
import { PaypalVerifiedWidget } from "./paypal-verified-widget";
import type { FairnessGapState, PaypalVerifiedState } from "./studio-context";
import { FAIRNESS_GAP_WIDGET, PAYPAL_VERIFIED_WIDGET } from "./studio-report";
import type { StudioCopy } from "./studio-sources";

type FairnessGapDefinition = AgWidgetDefinition<typeof FAIRNESS_GAP_WIDGET, FairnessGapState>;
type PaypalVerifiedDefinition = AgWidgetDefinition<typeof PAYPAL_VERIFIED_WIDGET, PaypalVerifiedState>;

/** AG Studio's own widgets and Kin's two. */
export interface KinRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | FairnessGapDefinition | PaypalVerifiedDefinition)[];
}

const money = (): AgDataMappingDefinition<keyof FairnessGapState["dataMapping"]> => ({ type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.member", cardinality: "one" }, required: true });

function fairnessGap(copy: StudioCopy): FairnessGapDefinition {
  const words = copy.widgets.fairnessGap;
  return {
    id: FAIRNESS_GAP_WIDGET,
    label: words.label,
    icon: { className: "kin-studio-icon-scale" },
    dataMapping: {
      member: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true },
      given: money(),
      agreed: money(),
      gap: money(),
    },
    form: (params: AgWidgetFormParams<FairnessGapState>) =>
      params.createDefaults({
        dataMappingItems: [
          { key: "member", label: copy.fields.member },
          { key: "given", label: copy.fields.given },
          { key: "agreed", label: copy.fields.agreed },
          { key: "gap", label: copy.fields.position },
        ],
      }),
    comp: FairnessGapWidget,
    defaultSize: { width: 640, height: 300 },
    minSize: { width: 280, height: 200 },
    ai: { description: words.description },
  };
}

function paypalVerified(copy: StudioCopy): PaypalVerifiedDefinition {
  const words = copy.widgets.verified;
  return {
    id: PAYPAL_VERIFIED_WIDGET,
    label: words.label,
    icon: { className: "kin-studio-icon-shield" },
    dataMapping: {
      paypalId: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true },
      amount: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.paypalId", cardinality: "one" }, required: true },
    },
    form: (params: AgWidgetFormParams<PaypalVerifiedState>) =>
      params.createDefaults({
        dataMappingItems: [
          { key: "paypalId", label: copy.fields.paypalId },
          { key: "amount", label: copy.fields.amount },
        ],
      }),
    comp: PaypalVerifiedWidget,
    defaultSize: { width: 320, height: 300 },
    minSize: { width: 240, height: 200 },
    ai: { description: words.description },
  };
}

/** The widget menu: AG Studio's, with a group of Kin's own. */
export function kinWidgets(copy: StudioCopy) {
  return (defaults: { menu: readonly unknown[] }) =>
    createWidgets<KinRegistry>({
      additionalTypes: [fairnessGap(copy), paypalVerified(copy)],
      menu: [...(defaults.menu as never[]), { label: copy.widgets.group, widgetIds: [FAIRNESS_GAP_WIDGET, PAYPAL_VERIFIED_WIDGET] }],
    });
}
