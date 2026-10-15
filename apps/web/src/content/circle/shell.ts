import type { CircleSnapshot } from "@kin/db";

import { parentOf } from "./members";

/** The circle as its frame shows it: name, the parent's portrait, demo or not. */
export function shellCircle(circle: CircleSnapshot) {
  const parent = parentOf(circle);
  return { name: circle.circle.name, portrait: parent?.portrait ?? null, parentName: parent?.displayName ?? circle.circle.name, demo: circle.circle.demo };
}
