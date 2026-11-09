/**
 * When the parent's wishes take effect: only when people say so. A hospital
 * admission is attested by two family members, or by one family member and the
 * caregiver; a move into a care home by two family members. Her coming home is
 * attested the same way, and it ends everything the trigger started. Kin never
 * infers a trigger from a silence, from her voice, or from anything a model
 * says: these rules count people.
 */
import type { CircleRole } from "./roles.ts";
import type { TriggerEvent } from "./wishes.ts";

/** Reported by one person, active once a second confirms it, ended when she is home; a report nobody confirms is dismissed. */
export const WISH_TRIGGER_TRANSITIONS = {
  reported: ["active", "dismissed"],
  active: ["ended"],
  ended: [],
  dismissed: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type WishTriggerState = keyof typeof WISH_TRIGGER_TRANSITIONS;
export const WISH_TRIGGER_STATES = Object.keys(WISH_TRIGGER_TRANSITIONS) as [WishTriggerState, ...WishTriggerState[]];

export const wishTriggerMoveAllowed = (from: WishTriggerState, to: WishTriggerState): boolean =>
  (WISH_TRIGGER_TRANSITIONS[from] as readonly WishTriggerState[]).includes(to);

/** Whether a person says the event began, or that she is home again. */
export const ATTESTATION_STANCES = ["start", "end"] as const;
export type AttestationStance = (typeof ATTESTATION_STANCES)[number];

/** The family members who attest: those who share the cost. */
export const FAMILY_ATTESTERS = ["organizer", "contributor"] as const satisfies readonly CircleRole[];
/** How many different people it takes. */
export const ATTESTATIONS_NEEDED = 2;

export type Attestation = { readonly memberId: string; readonly role: CircleRole; readonly stance: AttestationStance };

/** Whether a member in `role` may attest `event`: a family member always; the caregiver for a hospital admission, who is often the first to know. */
export function mayAttest(role: CircleRole, event: TriggerEvent): boolean {
  if ((FAMILY_ATTESTERS as readonly CircleRole[]).includes(role)) return true;
  return role === "caregiver" && event === "hospital";
}

/**
 * Whether `stance` is attested enough for `event`: two different people who may
 * attest it, at least one of them a family member. The parent, an observer, or
 * the same person twice never counts.
 */
export function attestationMet(event: TriggerEvent, attestations: readonly Attestation[], stance: AttestationStance): boolean {
  const counted = new Map<string, CircleRole>();
  for (const attestation of attestations) {
    if (attestation.stance === stance && mayAttest(attestation.role, event)) counted.set(attestation.memberId, attestation.role);
  }
  const family = [...counted.values()].filter((role) => (FAMILY_ATTESTERS as readonly CircleRole[]).includes(role)).length;
  return counted.size >= ATTESTATIONS_NEEDED && family >= 1;
}

/** Who still needs to say so, as Kin words it: nobody, someone from the family, or anyone who may. */
export function attestationStillNeeded(event: TriggerEvent, attestations: readonly Attestation[], stance: AttestationStance): "none" | "family" | "anyone" {
  if (attestationMet(event, attestations, stance)) return "none";
  const counted = attestations.filter((attestation) => attestation.stance === stance && mayAttest(attestation.role, event));
  return counted.length > 0 && counted.every((attestation) => attestation.role === "caregiver") ? "family" : "anyone";
}
