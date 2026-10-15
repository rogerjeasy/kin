import { describe, expect, it } from "vitest";

import { SIGN_IN_EMAIL_KINDS, signInEmail } from "./sign-in-email.ts";

describe("a sign-in email", () => {
  it.each(SIGN_IN_EMAIL_KINDS)("for %s carries the code, and Kin's rule never to ask for it", (kind) => {
    const { subject, text } = signInEmail(kind, "482915");

    expect(subject).toMatch(/Kin|email address/);
    expect(text).toContain("482915");
    expect(text).toContain("Kin will never ask you for this code");
  });

  it("names a sign-in code as one", () => {
    expect(signInEmail("sign_in", "1").text).toMatch(/^Your code to sign in to Kin is 1\./);
  });

  it("refuses to send an email with no code in it", () => {
    expect(() => signInEmail("sign_in", " ")).toThrow();
  });
});
