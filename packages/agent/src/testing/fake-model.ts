import type { StructuredModel, StructuredReply, StructuredRequest } from "../structured-model.ts";

export type FakeModel = StructuredModel & { readonly requests: StructuredRequest[] };

/** Answers each request with the next reply, and keeps what it was asked. */
export function fakeModel(...replies: (StructuredReply | Error)[]): FakeModel {
  const requests: StructuredRequest[] = [];
  const model = async (request: StructuredRequest): Promise<StructuredReply> => {
    requests.push(request);
    const reply = replies.shift();
    if (reply === undefined) throw new Error("The fake model was asked more often than expected");
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return Object.assign(model, { requests });
}

/** A JSON reply with these visits. */
export function visitsReply(visits: readonly { date: string; hours: number; minutes: number; quote: string }[], unclear: readonly string[] = []): StructuredReply {
  return { kind: "json", text: JSON.stringify({ visits, unclear }) };
}
