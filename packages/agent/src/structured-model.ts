/**
 * The one way Kin asks Claude for structured data. The model is reached
 * through this interface: the Bedrock adapter in production, a fake in
 * tests. A request carries no tools, so reading someone's words can never
 * act on anything.
 */
export type StructuredRequest = {
  /** Kin's own instructions, versioned with the prompt that wrote them. */
  readonly system: string;
  /** The person's words, wrapped as data. */
  readonly user: string;
  /** The JSON schema the answer must follow. */
  readonly schema: Readonly<Record<string, unknown>>;
};

export type StructuredReply =
  /** The model's answer, as JSON text, still to be checked. */
  | { readonly kind: "json"; readonly text: string }
  /** The model declined: nothing to read. */
  | { readonly kind: "refused" }
  /** The answer ran out of room before it finished. */
  | { readonly kind: "cut_off" };

export type StructuredModel = (request: StructuredRequest) => Promise<StructuredReply>;

/** The model could not be reached, or answered in a way Kin cannot use. A retry may help. */
export class ModelUnavailableError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelUnavailableError";
  }
}
