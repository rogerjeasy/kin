import type { CircleSnapshot } from "@kin/db";

import type { Formatters } from "@/lib/format";

import { parentNameOf } from "./members";
import { openPeriod } from "./period";

/** The values the circle's copy is filled with: its parent, its month and its name. */
export function circleSlots(circle: CircleSnapshot, format: Formatters) {
  return {
    parent: parentNameOf(circle),
    month: format.month(openPeriod(circle)),
    circle: circle.circle.name,
  };
}
