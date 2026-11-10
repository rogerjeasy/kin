import { describe, expect, it } from "vitest";

import { rulesNamed } from "./refill-tool";

const rule = (item: string) => ({ rule: { item } });
const prescription = rule("Monthly prescription refill (30 days)");
const drops = rule("Eye drops");

describe("which refill rule a person's words name", () => {
  it("takes every rule when no item is named, and the rule whose own name was given", () => {
    expect(rulesNamed(undefined, [prescription, drops])).toEqual([prescription, drops]);
    expect(rulesNamed("eye drops", [prescription, drops])).toEqual([drops]);
  });

  it("finds the one rule that shares a word with what was asked", () => {
    expect(rulesNamed("Rose's refill", [prescription])).toEqual([prescription]);
    expect(rulesNamed("her prescription", [prescription, drops])).toEqual([prescription]);
  });

  it("never guesses: no shared word names nothing, and a word several rules share is left for the person to choose", () => {
    expect(rulesNamed("insulin pens", [prescription])).toEqual([]);
    expect(rulesNamed("her medicine refill", [rule("Pharmacy refill"), rule("Grocery refill")])).toEqual([]);
    // Several rules the exact name check accepts are all returned, and the tool then asks which one.
    expect(rulesNamed("monthly", [rule("Monthly prescription refill"), rule("Monthly eye drops")])).toHaveLength(2);
  });

  it("ignores words under four letters, so 'her pill' does not match 'her refill'", () => {
    expect(rulesNamed("her pill", [rule("her refill")])).toEqual([]);
  });
});
