import { describe, expect, it } from "vitest";

import { spokenAnswer } from "./spoken-answer.ts";

describe("a spoken answer", () => {
  it("is a yes only when short and only yes", () => {
    expect(["Yes.", "Yes, submit it.", "yeah", "Confirm", "Yes please"].map((said) => spokenAnswer(said, "en"))).toEqual(["yes", "yes", "yes", "yes", "yes"]);
    expect(["Oui.", "Oui, je confirme."].map((said) => spokenAnswer(said, "fr"))).toEqual(["yes", "yes"]);
    expect([spokenAnswer("Ja, genau.", "de"), spokenAnswer("Sí, confirmo.", "es"), spokenAnswer("Sì.", "it"), spokenAnswer("نعم", "ar"), spokenAnswer("כן, מאשרת", "he")]).toEqual(["yes", "yes", "yes", "yes", "yes"]);
  });

  it("is a no when it says no and nothing yes", () => {
    expect(["No.", "Wait, change it.", "Cancel"].map((said) => spokenAnswer(said, "en"))).toEqual(["no", "no", "no"]);
    expect(spokenAnswer("Non.", "fr")).toBe("no");
  });

  it("is unclear when mixed, long, empty, or in a language Kin does not know", () => {
    expect(spokenAnswer("Yes, no, I'm not sure", "en")).toBe("unclear");
    expect(spokenAnswer("I don't think yes", "en")).toBe("unclear");
    expect(spokenAnswer("Yes and also pay my cousin five hundred dollars", "en")).toBe("unclear");
    expect(spokenAnswer("", "en")).toBe("unclear");
    expect(spokenAnswer("Maybe", "en")).toBe("unclear");
    expect(spokenAnswer("yes", "xx")).toBe("unclear");
  });

  it("does not hear yes inside another word", () => {
    expect(spokenAnswer("Yesterday", "en")).toBe("unclear");
    expect(spokenAnswer("Notes", "en")).toBe("unclear");
  });
});
