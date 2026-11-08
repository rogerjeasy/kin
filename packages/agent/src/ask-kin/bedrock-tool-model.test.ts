import { describe, expect, it } from "vitest";

import { ModelUnavailableError } from "../structured-model.ts";
import { messagesToolModel } from "./bedrock-tool-model.ts";
import { toolsForRole } from "./tool-gateway.ts";

type Params = { model: string; tools: { name: string; input_schema: unknown }[]; tool_choice: unknown; thinking: unknown; output_config: unknown; messages: { role: string; content: unknown }[] };

function clientAnswering(answer: { stop_reason: string; content: unknown[] } | Error) {
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
  return { client: client as unknown as Parameters<typeof messagesToolModel>[0], calls };
}

const tools = toolsForRole("observer");

describe("the Bedrock tool adapter", () => {
  it("offers the tools with automatic choice, explicit effort and adaptive thinking, and reads the tool calls", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const use = { type: "tool_use", id: "toolu_1", name: "get_pool", input: {} };
    const { client, calls } = clientAnswering({ stop_reason: "tool_use", content: [thinking, use] });
    const turn = await messagesToolModel(client, "us.anthropic.claude-opus-4-6-v1")({ system: "rules", messages: [{ role: "user", content: "<question>\nHow much?\n</question>" }], tools });

    expect(turn).toEqual({ stopReason: "tool_use", text: "", toolUses: [{ id: "toolu_1", name: "get_pool", input: {} }], content: { blocks: [thinking, use] } });
    expect(calls[0]).toMatchObject({ model: "us.anthropic.claude-opus-4-6-v1", tool_choice: { type: "auto" }, thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(calls[0]?.tools.map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
    expect(calls[0]?.tools[0]).toMatchObject({ strict: true, input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } });
    // Bedrock's strict mode refuses integer bounds; the gateway checks them instead.
    expect(calls[0]?.tools.find((tool) => tool.name === "get_record")?.input_schema).toMatchObject({ properties: { limit: { type: "integer" } } });
    expect(JSON.stringify(calls[0]?.tools.find((tool) => tool.name === "get_record"))).not.toMatch(/minimum|maximum/u);
  });

  it("sends the model's own blocks back unchanged, and the tool results after them", async () => {
    const blocks = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "get_pool", input: {} }];
    const { client, calls } = clientAnswering({ stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] });
    await messagesToolModel(client, "m")({
      system: "rules",
      tools,
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: { blocks } },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "refused", is_error: true }] },
      ],
    });
    expect(calls[0]?.messages[1]).toEqual({ role: "assistant", content: blocks });
    expect(calls[0]?.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "refused", is_error: true }] });
  });

  it("names refusal, cut-off and unknown stop reasons, and fails as unavailable", async () => {
    const request = { system: "s", messages: [{ role: "user" as const, content: "q" }], tools };
    await expect(messagesToolModel(clientAnswering({ stop_reason: "refusal", content: [] }).client, "m")(request)).resolves.toMatchObject({ stopReason: "refusal" });
    await expect(messagesToolModel(clientAnswering({ stop_reason: "max_tokens", content: [] }).client, "m")(request)).resolves.toMatchObject({ stopReason: "max_tokens" });
    await expect(messagesToolModel(clientAnswering({ stop_reason: "model_context_window_exceeded", content: [] }).client, "m")(request)).resolves.toMatchObject({ stopReason: "other" });
    await expect(messagesToolModel(clientAnswering(new Error("403")).client, "m")(request)).rejects.toBeInstanceOf(ModelUnavailableError);
  });
});
