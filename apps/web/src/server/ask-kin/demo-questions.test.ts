import { describe, expect, it, vi } from "vitest";

import type { Session } from "@kin/auth";

import { createRateLimiter } from "../model";
import { DEMO_QUESTIONS, demoQuestions, questionAllowanceFor, questionsLeft } from "./demo-questions";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../auth/session", () => ({ currentSession: async () => session.current }));

describe("whose questions to Kin are counted", () => {
  it("counts five for a demo visitor who has not signed in", async () => {
    session.current = null;
    expect(DEMO_QUESTIONS).toBe(5);
    expect(await questionAllowanceFor({ kind: "visitor", userId: "demo:one" })).toBe(demoQuestions);
    expect(demoQuestions.limit).toBe(5);
  });

  it("counts none for a demo visitor who has also signed in", async () => {
    session.current = { userId: "person" } as unknown as Session;
    expect(await questionAllowanceFor({ kind: "visitor", userId: "demo:two" })).toBeUndefined();
  });

  it("counts none for a person in their own circle", async () => {
    session.current = { userId: "person" } as unknown as Session;
    expect(await questionAllowanceFor({ kind: "person", userId: "person", session: { userId: "person" } as unknown as Session })).toBeUndefined();
  });
});

describe("what is left", () => {
  it("is the allowance less what was used, never below nothing, and nothing to show without one", () => {
    const allowance = createRateLimiter(5, 1_000);
    expect(questionsLeft(allowance, "a", 0)).toBe(5);
    for (let index = 0; index < 7; index++) allowance.record("a", 0);
    expect(questionsLeft(allowance, "a", 0)).toBe(0);
    expect(questionsLeft(allowance, "b", 0)).toBe(5);
    expect(questionsLeft(undefined, "a", 0)).toBeNull();
  });
});

describe("the demo's count when it is full", () => {
  it("still lets a new visitor ask, rather than shutting everyone out for the session's fourteen days", () => {
    for (let index = 0; index < 20_001; index++) demoQuestions.record(`demo:filler-${index}`, 0);
    expect(demoQuestions.allows("demo:newcomer", 1)).toBe(true);
    expect(questionsLeft(demoQuestions, "demo:newcomer", 1)).toBe(5);
  });
});

