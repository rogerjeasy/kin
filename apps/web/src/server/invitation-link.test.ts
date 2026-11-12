import { InvitationError, type InvitationLink } from "@kin/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationLinkStatus, type InvitationLinkDeps } from "./invitation-link";
import { createRateLimiter } from "./model";

const TOKEN = "A".repeat(43);
const link: InvitationLink = { inviterFirstName: "Priya", parentFirstName: "Meera", role: "caregiver", state: "open" };

const deps = (overrides: Partial<InvitationLinkDeps> = {}, limit = 20): InvitationLinkDeps => ({ read: () => Promise.resolve(link), limiter: createRateLimiter(limit, 60_000), now: () => 1_000, ...overrides });

afterEach(() => vi.restoreAllMocks());

describe("the invitation link page", () => {
  it("shows the invitation a well-formed token opens", async () => {
    expect(await invitationLinkStatus(TOKEN, new Headers(), deps())).toEqual({ ok: true, invitation: link });
  });

  it("answers a malformed token and an unknown one the same way, without asking the database about the first", async () => {
    const read = vi.fn(() => Promise.resolve(link));
    expect(await invitationLinkStatus("short", new Headers(), deps({ read }))).toEqual({ ok: false, reason: "link" });
    expect(read).not.toHaveBeenCalled();
    expect(await invitationLinkStatus(TOKEN, new Headers(), deps({ read: () => Promise.reject(new InvitationError("refused")) }))).toEqual({ ok: false, reason: "link" });
  });

  it("slows one address down, and says Kin is unavailable on a fault without logging the token", async () => {
    const limited = deps({}, 1);
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    expect((await invitationLinkStatus(TOKEN, headers, limited)).ok).toBe(true);
    expect(await invitationLinkStatus(TOKEN, headers, limited)).toEqual({ ok: false, reason: "busy" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await invitationLinkStatus(TOKEN, new Headers(), deps({ read: () => Promise.reject(new Error(`boom ${TOKEN}`)) }))).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
  });
});
