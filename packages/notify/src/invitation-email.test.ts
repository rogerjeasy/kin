import { describe, expect, it } from "vitest";

import { TEXT_LOCALES } from "./check-in-text.ts";
import { INVITATION_ROLES, INVITATION_WORDS, InvitationEmailError, invitationEmail, type InvitationFacts } from "./invitation-email.ts";

const LINK = "https://kin.example.com/fr/join/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const FACTS: InvitationFacts = { locale: "en", inviterName: "Priya Shah", parentName: "Meera", role: "caregiver", expiresAt: new Date("2026-11-26T12:00:00Z"), link: LINK };

describe("the invitation email", () => {
  it("names the inviter, the parent and the role, gives the link on its own line, and the date it closes", () => {
    const email = invitationEmail(FACTS);
    expect(email.subject).toBe("Priya Shah invited you to Meera’s circle on Kin");
    expect(email.text).toContain("Priya Shah has invited you to join the circle that looks after Meera");
    expect(email.text).toContain("Your place in the circle: caregiver.");
    expect(email.text.split("\n")).toContain(LINK);
    expect(email.text).toContain("November 26, 2026");
    expect(email.text).toContain("never ask you for a password, a code or money");
  });

  it("has words for every language and role Kin speaks", () => {
    for (const locale of TEXT_LOCALES) {
      for (const role of INVITATION_ROLES) {
        const email = invitationEmail({ ...FACTS, locale, role });
        expect(email.text).toContain(INVITATION_WORDS[locale].roles[role]);
        expect(email.text).not.toMatch(/\{\w+\}/);
        expect(email.subject).not.toMatch(/[\r\n{}]/);
      }
    }
  });

  it("drops line breaks, markup and control characters from names, so nothing typed can add a header or a link", () => {
    const email = invitationEmail({ ...FACTS, inviterName: "Eve\r\nBcc: victim@example.com <a href=x>", parentName: "\u0007Meera" });
    expect(email.subject).not.toMatch(/[\r\n<>@:]/);
    expect(email.text).not.toMatch(/[<>@]|Bcc:/);
    expect(email.subject).toContain("Meera");
  });

  it("speaks of a parent when the circle names none yet", () => {
    expect(invitationEmail({ ...FACTS, parentName: " " }).subject).toBe("Priya Shah invited you to a parent’s circle on Kin");
  });

  it("isolates names in Arabic and Hebrew, and leaves the link bare", () => {
    const email = invitationEmail({ ...FACTS, locale: "he" });
    expect(email.text).toContain("⁨Priya Shah⁩");
    expect(email.text.split("\n")).toContain(LINK);
  });

  it("refuses a link that is not plain https, and an inviter with no name", () => {
    for (const link of ["http://kin.example.com/x", "https://u:p@kin.example.com/x", "not a link", `https://kin.example.com/${"a".repeat(400)}`]) {
      expect(() => invitationEmail({ ...FACTS, link })).toThrow(InvitationEmailError);
    }
    expect(() => invitationEmail({ ...FACTS, inviterName: "<>" })).toThrow(InvitationEmailError);
  });
});
