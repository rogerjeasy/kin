import { describe, expect, it } from "vitest";

import { messagesModel } from "./bedrock-model.ts";
import { ModelUnavailableError } from "./structured-model.ts";

type Params = { model: string; system: string; messages: { role: string; content: unknown }[]; output_config: { effort: string; format: { type: string; schema: unknown } } };

function clientAnswering(answer: { stop_reason: string; content: { type: string; text?: string }[] } | Error) {
  const calls: Params[] = [];
  const client = {
    messages: {
      create: async (params: Params) => {
        calls.push(params);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
  // The fake carries only the part of the SDK client that Kin calls.
  return { client: client as unknown as Parameters<typeof messagesModel>[0], calls };
}

const request = { system: "rules", user: "words", schema: { type: "object" } };

describe("the Bedrock adapter", () => {
  it("sends the schema and the words, and returns the text for the caller to check", async () => {
    const { client, calls } = clientAnswering({ stop_reason: "end_turn", content: [{ type: "text", text: '{"a":1}' }] });
    await expect(messagesModel(client, "us.anthropic.claude-opus-4-6-v1")(request)).resolves.toEqual({ kind: "json", text: '{"a":1}' });
    expect(calls[0]).toMatchObject({ model: "us.anthropic.claude-opus-4-6-v1", system: "rules", messages: [{ role: "user", content: "words" }], output_config: { format: { type: "json_schema", schema: { type: "object" } } } });
  });

  it("puts photographs before the words", async () => {
    const { client, calls } = clientAnswering({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] });
    await messagesModel(client, "m")({ ...request, images: [{ mediaType: "image/png", base64: "AAAA" }] });
    expect(calls[0]?.messages[0]?.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "text", text: "words" },
    ]);
  });

  it("reports a refusal and a cut-off answer as such", async () => {
    await expect(messagesModel(clientAnswering({ stop_reason: "refusal", content: [] }).client, "m")(request)).resolves.toEqual({ kind: "refused" });
    await expect(messagesModel(clientAnswering({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }).client, "m")(request)).resolves.toEqual({ kind: "cut_off" });
  });

  it("says the model is unavailable when the call fails or answers with no text", async () => {
    await expect(messagesModel(clientAnswering(new Error("403")).client, "m")(request)).rejects.toBeInstanceOf(ModelUnavailableError);
    await expect(messagesModel(clientAnswering({ stop_reason: "end_turn", content: [] }).client, "m")(request)).rejects.toBeInstanceOf(ModelUnavailableError);
  });
});
