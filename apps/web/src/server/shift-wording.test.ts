import { QUESTION_TEMPLATES, SHIFT_LANGUAGES, type CoverNoteFacts, type ShiftQuestionFacts } from "@kin/agent";
import { fakeModel } from "@kin/agent/testing";
import { describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";

import { createRateLimiter } from "./model";
import { WORDING_DEADLINE_MS, firstNameOf, wordedCoverNote, wordedQuestion, worthABadge, type WordingCache, type WordingDeps, type WordingWho } from "./shift-wording";

const said = (text: string) => ({ kind: "json" as const, text: JSON.stringify({ text }) });
const who: WordingWho = { userId: "user-1", accountTypes: "demo" };
const facts: ShiftQuestionFacts = { language: "en", caregiver: "Amara", part: "morning", checkedOutAt: null, title: null };
const note: CoverNoteFacts = { language: "en", when: "Thursday, November 12, 1:00 PM to 5:00 PM", title: null, candidates: [{ name: "Ana", kind: "visit", hoursThatDay: "0 min", hoursThisWeek: "2 h" }] };

function deps(model: WordingDeps["model"], extra: Partial<WordingDeps> = {}): WordingDeps {
  const cache: WordingCache = new Map();
  return { model, cache, limiter: createRateLimiter(10, 60_000), budget: createRateLimiter(100, 60_000), now: () => 1_000, ...extra };
}

describe("the parent's question about a visit", () => {
  it("is the fixed question, without a badge, when the deployment has no model", async () => {
    const wording = await wordedQuestion(deps(null), who, "shift-1", facts);
    expect(wording).toMatchObject({ text: "Was Amara here this morning?", source: "template", provenance: { reason: "not_configured" } });
    expect(worthABadge(wording)).toBe(false);
  });

  it("is the model's wording, with a badge, when the model words it", async () => {
    const wording = await wordedQuestion(deps(fakeModel(said("Did {name} come by this morning?"))), who, "shift-1", facts);
    expect(wording).toMatchObject({ text: "Did Amara come by this morning?", source: "model" });
    expect(worthABadge(wording)).toBe(true);
  });

  it("shows the fixed question, with the reason as a badge, when the model's wording is refused", async () => {
    const wording = await wordedQuestion(deps(fakeModel(said("Did Maria come by this morning?"))), who, "shift-1", facts);
    expect(wording).toMatchObject({ text: "Was Amara here this morning?", source: "template", provenance: { reason: "wording_rejected" } });
    expect(worthABadge(wording)).toBe(true);
  });

  it("asks the model once for the same visit, however often the page is drawn", async () => {
    const model = fakeModel(said("Did {name} come by this morning?"));
    const shared = deps(model);
    await wordedQuestion(shared, who, "shift-1", facts);
    const again = await wordedQuestion(shared, who, "shift-1", facts);
    expect(again.text).toBe("Did Amara come by this morning?");
    expect(model.requests).toHaveLength(1);
    // Another visit, or the same one in another language, is another question.
    await wordedQuestion(shared, who, "shift-2", facts).catch(() => undefined);
    expect(model.requests).toHaveLength(2);
  });

  it("uses no more of the model than the person's limit allows, and says so", async () => {
    const model = fakeModel(said("Did {name} come by?"));
    const limited = deps(model, { limiter: createRateLimiter(1, 60_000) });
    await wordedQuestion(limited, who, "shift-1", facts);
    const second = await wordedQuestion(limited, who, "shift-2", facts);
    expect(second).toMatchObject({ text: "Was Amara here this morning?", provenance: { source: "template", reason: "limit_reached" } });
    expect(model.requests).toHaveLength(1);
  });

  it("does not wait for a slow model beyond the deadline, and keeps its answer for the next look", async () => {
    let release: () => void = () => undefined;
    const slow = Object.assign(
      () => new Promise<{ kind: "json"; text: string }>((resolve) => {
        release = () => resolve(said("Did {name} come by this morning?"));
      }),
      { modelId: "slow" },
    );
    const shared = deps(slow, { deadlineMs: 20 });
    const first = await wordedQuestion(shared, who, "shift-1", facts);
    expect(first).toMatchObject({ text: "Was Amara here this morning?", provenance: { source: "template", reason: "model_unavailable" } });
    release();
    await Promise.resolve();
    const later = await wordedQuestion(shared, who, "shift-1", facts);
    expect(later).toMatchObject({ text: "Did Amara come by this morning?", source: "model" });
    expect(WORDING_DEADLINE_MS).toBeGreaterThan(1_000);
  });

  it("keeps the fixed question for each language, the same as the dictionary's", async () => {
    for (const language of SHIFT_LANGUAGES) {
      const { shifts } = (await getDictionary(language)).dashboard;
      expect(QUESTION_TEMPLATES[language], language).toEqual(shifts.needs.questions);
    }
  });
});

describe("the note about who could cover", () => {
  it("is nothing when nobody could cover", async () => {
    expect(await wordedCoverNote(deps(fakeModel()), who, "shift-1", { ...note, candidates: [] })).toBeNull();
  });

  it("is the model's note with the names put in from the record", async () => {
    const wording = await wordedCoverNote(deps(fakeModel(said("{c1} is free and has 2 h this week."))), who, "shift-1", note);
    expect(wording).toMatchObject({ text: "Ana is free and has 2 h this week.", source: "model" });
  });

  it("is the fixed note when the model is off, and says why only when it was tried", async () => {
    const off = await wordedCoverNote(deps(null), who, "shift-1", note);
    expect(off?.text).toBe("Ana is free then and has 2 h of shifts booked this week.");
    expect(off && worthABadge(off)).toBe(false);
  });
});

describe("a member's first name", () => {
  it("is the first word of their name", () => {
    expect(firstNameOf("Amara  Okafor")).toBe("Amara");
    expect(firstNameOf("Rose")).toBe("Rose");
    expect(firstNameOf("Jean-Luc Picard")).toBe("Jean-Luc");
  });
});
