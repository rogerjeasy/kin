import type { SignInSecrets } from "@kin/auth";

import { safeNextPath } from "./next-path";

/**
 * A sign-in made to approve one proposal: the person signs in again with a
 * second factor, and their yes is recorded only if the same person returns.
 */
export type StepUp = { readonly proposalId: string; readonly userId: string };

/**
 * A sign-in made to set up an authenticator app: the person signs in again
 * from scratch, and only the same person, back within minutes, may go on.
 */
export type Enrol = { readonly userId: string };

/** What one sign-in remembers between leaving for the provider and coming back. */
export type SignInFlow = SignInSecrets & { readonly next: string; readonly stepUp?: StepUp; readonly enrol?: Enrol };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeFlow(flow: SignInFlow): string {
  return Buffer.from(JSON.stringify(flow)).toString("base64url");
}

/**
 * Reads the sign-in cookie, or `null` when it is missing or not one Kin wrote.
 * Where to go next is checked again here, not trusted from the cookie, so
 * no planted cookie can turn the callback into a redirect to another site.
 */
export function decodeFlow(raw: string | undefined): SignInFlow | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { verifier, state, nonce, next, stepUp, enrol } = value as Record<string, unknown>;
  const texts = [verifier, state, nonce, next];
  if (!texts.every((text) => typeof text === "string" && text !== "")) return null;
  const flow = { verifier: verifier as string, state: state as string, nonce: nonce as string, next: safeNextPath(next as string) };
  // One purpose per sign-in: a cookie that claims both is not one Kin wrote.
  if (stepUp !== undefined && enrol !== undefined) return null;
  if (enrol !== undefined) {
    const parsed = parseEnrol(enrol);
    return parsed === null ? null : { ...flow, enrol: parsed };
  }
  if (stepUp === undefined) return flow;
  const parsed = parseStepUp(stepUp);
  return parsed === null ? null : { ...flow, stepUp: parsed };
}

function parseEnrol(value: unknown): Enrol | null {
  if (typeof value !== "object" || value === null) return null;
  const { userId } = value as Record<string, unknown>;
  return typeof userId === "string" && userId !== "" ? { userId } : null;
}

function parseStepUp(value: unknown): StepUp | null {
  if (typeof value !== "object" || value === null) return null;
  const { proposalId, userId } = value as Record<string, unknown>;
  if (typeof proposalId !== "string" || !UUID.test(proposalId) || typeof userId !== "string" || userId === "") return null;
  return { proposalId, userId };
}
