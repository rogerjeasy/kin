import { describe, expect, it } from "vitest";

import { fieldEvidence, groundedQuote, highlightSegments, locateQuote } from "./evidence.ts";
import { readLetterText } from "./letter-text.ts";

const LETTER = "Lakeside Water\nAmount due: $73.15\nPlease pay by November 27, 2026.";

describe("finding a quote in the words it came from", () => {
  it("ignores case, spacing and the curly form of an apostrophe", () => {
    expect(locateQuote("Amount   DUE:\n$73.15", "amount due: $73.15")).toEqual({ start: 0, end: 20 });
    expect(locateQuote("Rose’s home", "Rose's home")).toEqual({ start: 0, end: 11 });
  });

  it("treats a quote as words, not as a pattern, and finds nothing for an empty or absent one", () => {
    expect(locateQuote("pay (now) or $5.00+", "(now) or $5.00+")).not.toBeNull();
    expect(locateQuote("pay now", ".*")).toBeNull();
    expect(locateQuote("pay now", "   ")).toBeNull();
    expect(locateQuote("pay now", "pay later")).toBeNull();
  });
});

describe("marking evidence in the original words", () => {
  const join = (segments: readonly { text: string }[]) => segments.map((segment) => segment.text).join("");

  it("cuts the text where a quote starts and ends, and the pieces join back to the text", () => {
    const { segments, missing } = highlightSegments("Pay $73.15 by Friday.", [{ id: "amount", quote: "$73.15" }]);
    expect(segments).toEqual([
      { text: "Pay ", ids: [] },
      { text: "$73.15", ids: ["amount"] },
      { text: " by Friday.", ids: [] },
    ]);
    expect(missing).toEqual([]);
    expect(join(segments)).toBe("Pay $73.15 by Friday.");
  });

  it("reports a quote that is not in the text, and marks nothing for it", () => {
    const { segments, missing } = highlightSegments("Pay now", [{ id: "amount", quote: "$99.00" }, { id: "empty", quote: "" }]);
    expect(segments).toEqual([{ text: "Pay now", ids: [] }]);
    expect(missing).toEqual(["amount", "empty"]);
  });

  it("marks only the first place a repeated quote is written", () => {
    const { segments } = highlightSegments("$5 then $5 again", [{ id: "amount", quote: "$5" }]);
    expect(segments.filter((segment) => segment.ids.length > 0)).toEqual([{ text: "$5", ids: ["amount"] }]);
    expect(segments.map((segment) => segment.text).join("")).toBe("$5 then $5 again");
  });

  it("gives an overlapping stretch to both quotes, and a nested quote to both", () => {
    const { segments } = highlightSegments("Amount due: $73.15 by Friday", [
      { id: "line", quote: "Amount due: $73.15" },
      { id: "amount", quote: "$73.15" },
      { id: "reach", quote: "$73.15 by Friday" },
    ]);
    expect(segments).toEqual([
      { text: "Amount due: ", ids: ["line"] },
      { text: "$73.15", ids: ["line", "amount", "reach"] },
      { text: " by Friday", ids: ["reach"] },
    ]);
  });

  it("returns no segments for no text", () => {
    expect(highlightSegments("", [{ id: "amount", quote: "$5" }])).toEqual({ segments: [], missing: ["amount"] });
  });
});

describe("where a document's fields are written", () => {
  it("quotes the line an amount and a due date are in, and the sender as written", () => {
    const reading = readLetterText(LETTER, { currency: "USD" });
    expect(fieldEvidence(LETTER, reading, "USD")).toEqual([
      { field: "sender", quote: "Lakeside Water" },
      { field: "amount", quote: "Amount due: $73.15" },
      { field: "dueOn", quote: "Please pay by November 27, 2026" },
    ]);
  });

  it("leaves out a field the words do not hold, such as an amount a photograph's reading never wrote", () => {
    expect(fieldEvidence("Greenway Power", { sender: "Greenway Power", amountCents: 8_640, dueOn: "2026-11-20" }, "USD")).toEqual([{ field: "sender", quote: "Greenway Power" }]);
  });

  it("takes the amount that equals the reading's, not the first one written", () => {
    const text = "Account 12\nLast month $50.00\nAmount due: $73.15";
    expect(fieldEvidence(text, { sender: null, amountCents: 7_315, dueOn: null }, "USD")).toEqual([{ field: "amount", quote: "Amount due: $73.15" }]);
  });

  it("returns the words a model's quote points to as written, or nothing", () => {
    expect(groundedQuote(LETTER, "amount DUE: $73.15")).toBe("Amount due: $73.15");
    expect(groundedQuote(LETTER, "Amount due: $99.00")).toBeNull();
    expect(groundedQuote(LETTER, null)).toBeNull();
  });
});
