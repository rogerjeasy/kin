import { DOCUMENT_SCHEMA, documentSystemPrompt, documentUserMessage } from "./document-prompt.ts";
import { ModelUnavailableError, type StructuredImage, type StructuredModel } from "./structured-model.ts";

/** The longest document text Kin reads at once. */
export const MAX_DOCUMENT_TEXT = 6_000;

export const DOCUMENT_KINDS = ["bill", "receipt", "quote", "letter", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** What the model said the document holds, shaped but not yet believed: the caller grounds each field. */
export type RawReading = {
  readonly kind: DocumentKind;
  readonly sender: string | null;
  readonly amount: string | null;
  readonly dueOn: string | null;
  readonly demandsPayment: boolean;
  readonly pressure: boolean;
  readonly quote: string | null;
};

export type ReadDocumentRequest = {
  /** The document's words, when it was typed or pasted. */
  readonly text: string | null;
  /** A photograph of it, when it was held up. At least one of the two is given. */
  readonly image: StructuredImage | null;
  readonly today: string;
  readonly currency: string;
};

export type ReadDocumentResult = { readonly kind: "read"; readonly reading: RawReading } | { readonly kind: "refused" } | { readonly kind: "unreadable" };

/**
 * Asks Claude what a document says, with no tools: the document is content
 * to extract from, never instructions (AGENTS.md section 7). The answer is
 * only shaped here; `@kin/documents` checks every field against the source.
 */
export async function readDocument(model: StructuredModel, request: ReadDocumentRequest): Promise<ReadDocumentResult> {
  const text = request.text?.trim() ?? "";
  if (text === "" && request.image === null) return { kind: "unreadable" };
  if (text.length > MAX_DOCUMENT_TEXT) return { kind: "unreadable" };
  const reply = await model({
    system: documentSystemPrompt({ date: request.today, currency: request.currency }),
    user: documentUserMessage(text === "" ? null : text),
    ...(request.image === null ? {} : { images: [request.image] }),
    schema: DOCUMENT_SCHEMA,
  });
  if (reply.kind === "refused") return { kind: "refused" };
  if (reply.kind === "cut_off") return { kind: "unreadable" };
  return { kind: "read", reading: parse(reply.text) };
}

const isText = (value: unknown): value is string | null => value === null || typeof value === "string";
const isKind = (value: unknown): value is DocumentKind => DOCUMENT_KINDS.some((kind) => kind === value);

function parse(text: string): RawReading {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ModelUnavailableError("The model's answer was not JSON", { cause: error });
  }
  const row = value as Partial<Record<keyof RawReading, unknown>> | null;
  if (
    row === null ||
    typeof row !== "object" ||
    !isKind(row.kind) ||
    !isText(row.sender) ||
    !isText(row.amount) ||
    !isText(row.dueOn) ||
    !isText(row.quote) ||
    typeof row.demandsPayment !== "boolean" ||
    typeof row.pressure !== "boolean"
  ) {
    throw new ModelUnavailableError("The model's answer did not follow the schema");
  }
  return { kind: row.kind, sender: row.sender, amount: row.amount, dueOn: row.dueOn, demandsPayment: row.demandsPayment, pressure: row.pressure, quote: row.quote };
}
