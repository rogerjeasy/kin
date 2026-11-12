import { describe, expect, it } from "vitest";

import { authenticatorEnrolledEmail } from "./authenticator-email.ts";
import { TEXT_LOCALES } from "./check-in-text.ts";

describe("the email after an authenticator app is set up", () => {
  it("is written in every language Kin speaks, and in English for any other", () => {
    const subjects = new Set(TEXT_LOCALES.map((locale) => authenticatorEnrolledEmail(locale).subject));
    expect(subjects.size).toBe(TEXT_LOCALES.length);
    expect(authenticatorEnrolledEmail("pt")).toEqual(authenticatorEnrolledEmail("en"));
  });

  it("tells the person what to do if it was not them, and asks them for nothing", () => {
    const { subject, text } = authenticatorEnrolledEmail("en");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(text).toContain("If it was not you, reset your Kin password");
    expect(text).not.toMatch(/https?:\/\//);
    for (const locale of TEXT_LOCALES) expect(authenticatorEnrolledEmail(locale).subject).not.toMatch(/[\r\n]/);
  });
});
