import { describe, expect, it } from "vitest";

import { reviewFindings, type ReviewItem } from "./audit-review.ts";
import { ModelUnavailableError } from "./structured-model.ts";
import { fakeModel } from "./testing/fake-model.ts";

const items: ReviewItem[] = [
  { id: "a", severity: "attention", entryId: "e1", figures: ["$85.00", "Oct 14"], template: "A payment of $85.00 on Oct 14 is above usual." },
  { id: "b", severity: "info", entryId: null, figures: [], template: "The record mixes simulated and sandbox entries." },
];
const said = (...list: { id: string; text: string }[]) => ({ kind: "json", text: JSON.stringify({ items: list }) }) as const;

describe("the independent auditor", () => {
  it("uses the fixed sentences with no model", async () => {
    const reviewed = await reviewFindings(null, items, "English");
    expect(reviewed.map((item) => [item.text, item.source])).toEqual(items.map((item) => [item.template, "template"]));
  });

  it("uses a model sentence only when every number in it is the finding's own", async () => {
    const model = fakeModel(said({ id: "a", text: "On Oct 14 a payment of $85.00 was larger than usual." }, { id: "b", text: "Simulated and sandbox entries are mixed in 2 places." }));
    const reviewed = await reviewFindings(model, items, "English");
    expect(reviewed.map((item) => item.source)).toEqual(["model", "template"]);
    expect(reviewed[1]?.text).toBe(items[1]?.template);
    expect(Object.keys(model.requests[0] ?? {}).toSorted()).toEqual(["schema", "system", "user"]);
  });

  it("refuses a sentence that spells out a number the finding does not hold, and asks for digits", async () => {
    const model = fakeModel(said({ id: "a", text: "A payment of eighty-six dollars was larger than usual." }, { id: "b", text: "Simulated and sandbox entries are mixed." }));
    const reviewed = await reviewFindings(model, items, "English");
    expect(reviewed.map((item) => item.source)).toEqual(["template", "model"]);
    expect(model.requests[0]?.system).toContain("as digits, never in words");
  });

  it("keeps every finding once and in order when the model omits one, invents one or fails", async () => {
    const partial = await reviewFindings(fakeModel(said({ id: "zzz", text: "Invented." })), items, "English");
    expect(partial.map((item) => item.id)).toEqual(["a", "b"]);
    expect(partial.every((item) => item.source === "template")).toBe(true);
    const down = await reviewFindings(fakeModel(new ModelUnavailableError("down")), items, "English");
    expect(down.every((item) => item.source === "template")).toBe(true);
  });

  it("says for each finding who worded it, and why the fixed sentence stands when it is not Claude", async () => {
    const mixed = await reviewFindings(fakeModel(said({ id: "a", text: "On Oct 14 a payment of $85.00 was larger than usual." }, { id: "b", text: "Mixed in 2 places." })), items, "English");
    expect(mixed.map((item) => item.provenance)).toEqual([{ source: "claude", model: "fake-model" }, { source: "template", reason: "wording_rejected" }]);
    const missing = await reviewFindings(fakeModel(said({ id: "a", text: "On Oct 14 a payment of $85.00 was larger than usual." })), items, "English");
    expect(missing[1]?.provenance).toEqual({ source: "template", reason: "unreadable" });
    const provenances = async (...args: Parameters<typeof reviewFindings>) => (await reviewFindings(...args)).map((item) => item.provenance);
    const only = (reason: string) => items.map(() => ({ source: "template", reason }));
    expect(await provenances(null, items, "English")).toEqual(only("not_configured"));
    expect(await provenances(null, items, "English", "not_requested")).toEqual(only("not_requested"));
    expect(await provenances(null, items, "English", "limit_reached")).toEqual(only("limit_reached"));
    expect(await provenances(fakeModel({ kind: "refused" }), items, "English")).toEqual(only("model_refused"));
    expect(await provenances(fakeModel(new ModelUnavailableError("throttled", { kind: "busy" })), items, "English")).toEqual(only("model_busy"));
    expect(await provenances(fakeModel(new ModelUnavailableError("down")), items, "English")).toEqual(only("model_unavailable"));
  });
});
