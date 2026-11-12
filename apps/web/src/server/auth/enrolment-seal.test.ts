import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ENROLMENT_SECONDS, openEnrolment, sealEnrolment } from "./enrolment-seal";

const key = randomBytes(32);
const now = new Date("2026-11-12T10:00:00Z");
const enrolment = { userId: "person-1", accessToken: "access.token.value", refreshToken: "refresh-1", secret: "JBSWY3DPEHPK3PXP", startedAt: now.getTime() - 60_000 };

describe("the sealed enrolment", () => {
  it("opens with the key it was sealed with, and shows the browser nothing of the token", () => {
    const sealed = sealEnrolment(key, enrolment);
    expect(sealed).not.toContain("access");
    expect(Buffer.from(sealed.slice(3), "base64url").toString("latin1")).not.toContain("access.token.value");
    expect(openEnrolment(key, sealed, now)).toEqual(enrolment);
  });

  it("refuses another key, a changed byte, a missing cookie and something not sealed", () => {
    const sealed = sealEnrolment(key, enrolment);
    expect(openEnrolment(randomBytes(32), sealed, now)).toBeNull();
    const bytes = Buffer.from(sealed.slice(3), "base64url");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(openEnrolment(key, `v1.${bytes.toString("base64url")}`, now)).toBeNull();
    expect(openEnrolment(key, undefined, now)).toBeNull();
    expect(openEnrolment(key, Buffer.from(JSON.stringify(enrolment)).toString("base64url"), now)).toBeNull();
  });

  it("lasts ten minutes from the fresh sign-in, and no longer", () => {
    const sealed = sealEnrolment(key, enrolment);
    expect(openEnrolment(key, sealed, new Date(enrolment.startedAt + ENROLMENT_SECONDS * 1000))).not.toBeNull();
    expect(openEnrolment(key, sealed, new Date(enrolment.startedAt + ENROLMENT_SECONDS * 1000 + 1))).toBeNull();
    expect(openEnrolment(key, sealed, new Date(enrolment.startedAt - 1))).toBeNull();
  });
});
