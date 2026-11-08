import type { ModelConfig } from "@kin/config";

import { bedrockClient, type MessagesClient } from "./bedrock-model.ts";
import type { AssistantBlock, AssistantMessage, AssistantModel, AssistantModelTurn, AssistantRequest } from "./shift-assistant.ts";
import { ModelUnavailableError } from "./structured-model.ts";

/** Answering from a few reads of the calendar is a short, bounded task: medium effort, as Ask Kin (docs/tech-stack.md section 6). */
const EFFORT = "medium";
const MAX_TOKENS = 4_000;

type CreateBody = Parameters<MessagesClient["messages"]["create"]>[0];

const blockParam = (block: AssistantBlock): Exclude<CreateBody["messages"][number]["content"], string>[number] => {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input };
  return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.content, ...(block.is_error ? { is_error: true } : {}) };
};

const messageParam = (message: AssistantMessage): CreateBody["messages"][number] => ({
  role: message.role,
  content: typeof message.content === "string" ? message.content : message.content.map(blockParam),
});

const STOP_REASONS = ["end_turn", "tool_use", "max_tokens", "refusal"] as const;

/**
 * One request to Messages with the widget's tools offered. The widget keeps the
 * conversation and sends it back whole, so there is no thinking block to carry
 * from one request to the next: thinking is off, which the models that allow
 * it (Opus 4.6, which the hosted app runs) accept. Tool choice stays automatic,
 * and the tools are the widget's own, not Kin's strict ones.
 */
export function messagesAssistantModel(client: MessagesClient, model: string): AssistantModel {
  const call = async (request: AssistantRequest): Promise<AssistantModelTurn> => {
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: request.system,
        messages: request.messages.map(messageParam),
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: { ...tool.inputSchema, type: "object" as const } })),
        tool_choice: { type: "auto" },
        thinking: { type: "disabled" },
        output_config: { effort: EFFORT },
      });
    } catch (error) {
      throw new ModelUnavailableError("Claude on Bedrock could not answer", { cause: error });
    }
    const blocks = response.content.flatMap((block): AssistantBlock[] => {
      if (block.type === "text") return [{ type: "text", text: block.text }];
      if (block.type === "tool_use") return [{ type: "tool_use", id: block.id, name: block.name, input: block.input }];
      return [];
    });
    const stopReason = STOP_REASONS.find((reason) => reason === response.stop_reason) ?? "other";
    return { stopReason, blocks, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
  };
  return Object.assign(call, { label: model });
}

/** Claude with the calendar widget's tools, on Amazon Bedrock, through the configured endpoint. */
export function bedrockAssistantModel(config: Extract<ModelConfig, { enabled: true }>): AssistantModel {
  return messagesAssistantModel(bedrockClient(config), config.model);
}
