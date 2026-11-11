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
    expect(rulesNamed("her prescription", [prescription, drops])).toEqual([prescription]);
    expect(rulesNamed("the eye drops refill", [prescription, drops])).toEqual([drops]);
    // "refill" alone links nothing: Rose's insulin refill must not become her prescription.
    expect(rulesNamed("Rose's insulin refill", [prescription], ["Rose"])).toEqual([]);
  });

  it("never guesses: no shared word names nothing, and a word several rules share is left for the person to choose", () => {
    expect(rulesNamed("insulin pens", [prescription])).toEqual([]);
    expect(rulesNamed("her medicine refill", [rule("Pharmacy refill"), rule("Grocery refill")])).toEqual([]);
    // Several rules the exact name check accepts are all returned, and the tool then asks which one.
    expect(rulesNamed("monthly", [rule("Monthly prescription refill"), rule("Monthly eye drops")])).toHaveLength(2);
  });

  it("treats a person's name or the word refill as no item: the circle's only refill, or every rule to ask about", () => {
    expect(rulesNamed("Rose", [prescription], ["Rose", "Elena"])).toEqual([prescription]);
    expect(rulesNamed("Rose's refill", [prescription], ["Rose"])).toEqual([prescription]);
    expect(rulesNamed("her usual refill", [prescription, drops], ["Rose"])).toEqual([prescription, drops]);
    // A person's name beside an item still has to name that item.
    expect(rulesNamed("Rose's insulin", [prescription], ["Rose"])).toEqual([]);
  });

  it("ignores words under four letters, so 'her pill' does not match 'her refill'", () => {
    expect(rulesNamed("her pill", [rule("her refill")])).toEqual([]);
  });
});
