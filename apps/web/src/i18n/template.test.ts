import { describe, expect, it } from "vitest";

import { MissingTemplateValueError, fill, parseTemplate, slotsOf } from "./template";

describe("parseTemplate", () => {
  it("splits a template into text and named slots, in order", () => {
    expect(parseTemplate("Paid {amount} to {name}.")).toEqual([
      { kind: "text", text: "Paid " },
      { kind: "slot", name: "amount" },
      { kind: "text", text: " to " },
      { kind: "slot", name: "name" },
      { kind: "text", text: "." },
    ]);
  });

  it("returns plain text unchanged", () => {
    expect(parseTemplate("No slots here.")).toEqual([
      { kind: "text", text: "No slots here." },
    ]);
  });
});

describe("fill", () => {
  it("replaces each slot with its value", () => {
    expect(fill("Above {limit}, ask {name}.", { limit: "$50.00", name: "Rose" })).toBe(
      "Above $50.00, ask Rose.",
    );
  });

  it("refuses to render a sentence with a slot left empty", () => {
    expect(() => fill("Paid {amount}.", {})).toThrow(MissingTemplateValueError);
  });
});

describe("slotsOf", () => {
  it("lists the slot names a template uses, sorted", () => {
    expect(slotsOf("{b} then {a} then {b}")).toEqual(["a", "b"]);
  });
});
