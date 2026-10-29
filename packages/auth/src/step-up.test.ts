import { describe, expect, it } from "vitest";

import { STEP_UP_WINDOW_SECONDS, assessStepUp } from "./step-up.ts";

const now = new Date("2026-10-26T12:00:00Z");
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);
const signIn = (methods: readonly string[], at: Date | null = secondsAgo(30), tokenId: string | null = "jti-1") => ({ at, methods, tokenId });

describe("the fresh check before approving real money", () => {
  it("accepts a password and authenticator code from moments ago, and keeps what proves it", () => {
    expect(assessStepUp(signIn(["pwd", "otp", "mfa"]), now)).toEqual({ fresh: true, evidence: `cognito:jti-1:${Math.floor(secondsAgo(30).getTime() / 1000)}:pwd+otp+mfa` });
  });

  it("refuses a sign-in with one factor, however recent", () => {
    for (const methods of [[], ["pwd"], ["email_otp"], ["pwd", "otp"], ["swk"]]) {
      expect(assessStepUp(signIn(methods, now), now)).toEqual({ fresh: false, reason: "no_second_factor" });
    }
  });

  it("refuses a second factor that is older than the window, or with no time at all", () => {
    expect(assessStepUp(signIn(["pwd", "otp", "mfa"], secondsAgo(STEP_UP_WINDOW_SECONDS)), now).fresh).toBe(true);
    expect(assessStepUp(signIn(["pwd", "otp", "mfa"], secondsAgo(STEP_UP_WINDOW_SECONDS + 1)), now)).toEqual({ fresh: false, reason: "stale" });
    expect(assessStepUp(signIn(["pwd", "otp", "mfa"], null), now)).toEqual({ fresh: false, reason: "stale" });
  });

  it("refuses a sign-in that claims to come from well ahead of Kin's clock", () => {
    expect(assessStepUp(signIn(["pwd", "otp", "mfa"], secondsAgo(-30)), now).fresh).toBe(true);
    expect(assessStepUp(signIn(["pwd", "otp", "mfa"], secondsAgo(-120)), now)).toEqual({ fresh: false, reason: "stale" });
  });

  it("still records evidence when the token has no ID of its own", () => {
    const verdict = assessStepUp(signIn(["pwd", "otp", "mfa"], now, null), now);
    expect(verdict).toMatchObject({ fresh: true, evidence: expect.stringMatching(/^cognito:no-jti:\d+:pwd\+otp\+mfa$/) });
  });
});
