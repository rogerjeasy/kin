import type { StructuredModel, StructuredReply, StructuredRequest } from "../structured-model.ts";
import { refusedSchemaKeywords } from "./structured-schema.ts";

export type FakeModel = StructuredModel & { readonly requests: StructuredRequest[] };

/** Answers each request with the next reply, and keeps what it was asked. */
export function fakeModel(...replies: (StructuredReply | Error)[]): FakeModel {
  const requests: StructuredRequest[] = [];
  const model = async (request: StructuredRequest): Promise<StructuredReply> => {
    // The real API refuses these with a 400, so a prompt test fails here too instead of passing on a fake.
    const refused = refusedSchemaKeywords(request.schema);
    if (refused.length > 0) throw new Error(`Structured output would refuse this schema: ${refused.join(", ")}`);
    requests.push(request);
    const reply = replies.shift();
    if (reply === undefined) throw new Error("The fake model was asked more often than expected");
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return Object.assign(model, { requests, modelId: "fake-model" });
}

/** A JSON reply with these visits. */
export function visitsReply(visits: readonly { date: string; hours: number; minutes: number; quote: string }[], unclear: readonly string[] = []): StructuredReply {
  return { kind: "json", text: JSON.stringify({ visits, unclear }) };
}
