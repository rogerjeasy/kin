import { describe, expect, it } from "vitest";

import { parseProvenance, storedProvenance } from "./provenance";

describe("checking a provenance that crossed a boundary", () => {
  it("accepts Claude with or without a model ID, and a fallback with a known reason", () => {
    expect(parseProvenance({ source: "claude", model: "us.anthropic.claude-opus-4-6-v1" })).toEqual({ source: "claude", model: "us.anthropic.claude-opus-4-6-v1" });
    expect(parseProvenance({ source: "claude", model: null })).toEqual({ source: "claude", model: null });
    expect(parseProvenance({ source: "rules", reason: "model_busy" })).toEqual({ source: "rules", reason: "model_busy" });
    expect(parseProvenance({ source: "template", reason: "wording_rejected" })).toEqual({ source: "template", reason: "wording_rejected" });
  });

  it("refuses anything else, so no badge is better than a wrong one", () => {
    for (const bad of [null, "claude", [], {}, { source: "claude" }, { source: "claude", model: 4 }, { source: "rules" }, { source: "rules", reason: "because" }, { source: "human", reason: "not_configured" }]) {
      expect(parseProvenance(bad)).toBeNull();
    }
  });

  it("reads the one kept beside a stored reading, and nothing for a reading stored before it was kept", () => {
    expect(storedProvenance({ kind: "bill", provenance: { source: "rules", reason: "not_configured" } })).toEqual({ source: "rules", reason: "not_configured" });
    expect(storedProvenance({ kind: "bill", source: "model_text" })).toBeNull();
    expect(storedProvenance(null)).toBeNull();
  });
});
