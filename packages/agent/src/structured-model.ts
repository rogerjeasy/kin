/**
 * The one way Kin asks Claude for structured data. The model is reached
 * through this interface: the Bedrock adapter in production, a fake in
 * tests. A request carries no tools, so reading someone's words can never
 * act on anything.
 */
/** A photograph the model reads. Only these formats are sent. */
export type StructuredImage = { readonly mediaType: "image/jpeg" | "image/png" | "image/webp"; readonly base64: string };

export type StructuredRequest = {
  /** Kin's own instructions, versioned with the prompt that wrote them. */
  readonly system: string;
  /** The person's words, wrapped as data. */
  readonly user: string;
  /** Photographs to read, when the task is a picture of something. Data, like `user`. */
  readonly images?: readonly StructuredImage[];
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

export type StructuredModel = ((request: StructuredRequest) => Promise<StructuredReply>) & {
  /** The configured model's own ID, so a result can say which model made it. Absent for a stand-in that has none. */
  readonly modelId?: string;
};

/** The model could not be reached, or answered in a way Kin cannot use. A retry may help. */
export class ModelUnavailableError extends Error {
  readonly retryable = true;
  /**
   * `busy`: the service said it was throttled or overloaded, so waiting a little will probably help.
   * `unusable`: it answered, but not with anything Kin can use. `unreachable`: it could not be reached or failed.
   */
  readonly kind: "busy" | "unreachable" | "unusable";

  constructor(message: string, options?: { cause?: unknown; kind?: "busy" | "unreachable" | "unusable" }) {
    super(message, options);
    this.name = "ModelUnavailableError";
    this.kind = options?.kind ?? "unreachable";
  }
}
