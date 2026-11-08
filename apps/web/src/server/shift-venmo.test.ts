import type { CircleSnapshot } from "@kin/db";
import { describe, expect, it } from "vitest";

import { venmoNote } from "./shift-venmo";

const circle = (demo: boolean) => ({ circle: { demo } }) as CircleSnapshot;

describe("the note beside the Venmo choice", () => {
  it("says a real circle's Venmo payout would fail against PayPal's sandbox", () => {
    expect(venmoNote(circle(false), true)).toBe("refused");
  });

  it("says a demo circle's Venmo payout is simulated, whether or not the sandbox is configured", () => {
    expect(venmoNote(circle(true), true)).toBe("simulated");
    expect(venmoNote(circle(true), false)).toBe("simulated");
  });

  it("warns of nothing when no PayPal sandbox is configured for a real circle", () => {
    expect(venmoNote(circle(false), false)).toBeNull();
  });
});
