import { ModelUnavailableError, type StructuredModel } from "./structured-model.ts";

/** Why an answer was not Claude's. Typed, so a screen words each reason in the person's language. */
export const FALLBACK_REASONS = [
  /** This deployment has no model switched on. */
  "not_configured",
  /** The person did not ask for the model's wording. */
  "not_requested",
  /** This person or this server has used the model as much as is allowed for now. */
  "limit_reached",
  /** The model service said it was throttled or overloaded. */
  "model_busy",
  /** The model service could not be reached or failed. */
  "model_unavailable",
  /** The model declined to answer. */
  "model_refused",
  /** The model's answer ran out or could not be used. */
  "unreadable",
  /** The model's wording failed the number guard, so the fixed wording stands. */
  "wording_rejected",
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/**
 * Who produced a result a person sees, so the screen never lets fixed code
 * pass for the model, nor the model for fixed code. `claude` names the
 * configured model; `rules` is plain code reading a document; `template` is
 * Kin's fixed wording. The two fallbacks always say why.
 */
export type Provenance =
  | { readonly source: "claude"; readonly model: string | null }
  | { readonly source: "rules" | "template"; readonly reason: FallbackReason };

/** Claude made it, with the model's own ID when it is known. */
export function byClaude(model: StructuredModel): Provenance {
  return { source: "claude", model: model.modelId ?? null };
}

const REASONS = { busy: "model_busy", unreachable: "model_unavailable", unusable: "unreadable" } as const satisfies Record<ModelUnavailableError["kind"], FallbackReason>;

/** The reason a model call failed: busy when the service said so, unusable when it answered badly, unreachable otherwise. */
export function reasonForFailure(error: unknown): FallbackReason {
  return error instanceof ModelUnavailableError ? REASONS[error.kind] : "unreadable";
}
