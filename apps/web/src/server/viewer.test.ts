import type { Session } from "@kin/auth";
import { describe, expect, it, vi } from "vitest";

// The viewer module reads cookies through Next.js; only its pure choice is tested here.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { chooseViewer } from "./viewer";

const person: Session = {
  userId: "cognito-sub-1",
  email: "person@example.com",
  emailVerified: true,
  name: "A person",
  accountTypes: ["family_member"],
  authentication: { at: null, methods: ["pwd"], tokenId: null },
};

describe("who is looking at the circle's screens", () => {
  it("is the signed-in person, never the demo, even with a demo cookie still in the browser", () => {
    // Seen on 12 November 2026: signing in after trying the demo landed on the demo circle.
    expect(chooseViewer("demo:visitor-1", person)).toEqual({ kind: "person", userId: "cognito-sub-1", session: person });
  });

  it("is the demo visitor when nobody is signed in", () => {
    expect(chooseViewer("demo:visitor-1", null)).toEqual({ kind: "visitor", userId: "demo:visitor-1" });
  });

  it("is nobody without a session or a demo", () => {
    expect(chooseViewer(null, null)).toBeNull();
  });
});
