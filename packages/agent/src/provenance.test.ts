import { describe, expect, it } from "vitest";

import { narrateWithProvenance } from "./narrate.ts";
import { byClaude, reasonForFailure } from "./provenance.ts";
import { ModelUnavailableError } from "./structured-model.ts";
import { fakeModel } from "./testing/fake-model.ts";

const facts = { figures: ["$86.40"], statement: "Greenway Power wants $86.40.", language: "English" };
const template = "Greenway Power wants $86.40.";
const json = (value: unknown) => ({ kind: "json", text: JSON.stringify(value) }) as const;

describe("who made a result", () => {
  it("names the configured model for an answer Claude gave, and says it could not name one otherwise", () => {
    expect(byClaude(fakeModel())).toEqual({ source: "claude", model: "fake-model" });
    expect(byClaude(async () => ({ kind: "refused" }))).toEqual({ source: "claude", model: null });
  });

  it("tells a throttled service from an unreachable one and from an answer that could not be used", () => {
    expect(reasonForFailure(new ModelUnavailableError("slow down", { kind: "busy" }))).toBe("model_busy");
    expect(reasonForFailure(new ModelUnavailableError("down"))).toBe("model_unavailable");
    expect(reasonForFailure(new ModelUnavailableError("nonsense", { kind: "unusable" }))).toBe("unreadable");
    expect(reasonForFailure(new SyntaxError("not json"))).toBe("unreadable");
  });
});

describe("wording with provenance", () => {
  it("says Claude worded it, with the model's ID, only when the wording passed the guard", async () => {
    const result = await narrateWithProvenance(fakeModel(json({ text: "Greenway Power is asking for $86.40." })), facts, template);
    expect(result).toMatchObject({ source: "model", provenance: { source: "claude", model: "fake-model" } });
  });

  it("gives the fixed wording and the reason for each way the model can fail to word it", async () => {
    const reason = async (reply: Parameters<typeof fakeModel>[0], model = fakeModel(reply)) => (await narrateWithProvenance(model, facts, template)).provenance;
    expect(await reason({ kind: "refused" })).toEqual({ source: "template", reason: "model_refused" });
    expect(await reason({ kind: "cut_off" })).toEqual({ source: "template", reason: "unreadable" });
    expect(await reason(json({ text: "It is $860.40." }))).toEqual({ source: "template", reason: "wording_rejected" });
    expect(await reason(json({ nope: 1 }))).toEqual({ source: "template", reason: "unreadable" });
    expect(await reason(new ModelUnavailableError("throttled", { kind: "busy" }))).toEqual({ source: "template", reason: "model_busy" });
    expect(await reason(new ModelUnavailableError("down"))).toEqual({ source: "template", reason: "model_unavailable" });
    expect((await narrateWithProvenance(null, facts, template)).provenance).toEqual({ source: "template", reason: "not_configured" });
  });
});
