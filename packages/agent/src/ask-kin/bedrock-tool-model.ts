import type { ModelConfig } from "@kin/config";

import { bedrockClient, type MessagesClient } from "../bedrock-model.ts";
import { ModelUnavailableError } from "../structured-model.ts";
import type { ToolMessage, ToolModel, ToolSpec, ToolStopReason, ToolTurn } from "./tool-model.ts";
import type { ToolProperty } from "./tool-schema.ts";

/**
 * Answering a question is a short, bounded read of the record with a few tool
 * calls: medium effort (docs/tech-stack.md section 6), with adaptive thinking.
 */
const EFFORT = "medium";
/** Room for thinking, a few tool calls and a short answer. Non-streaming stays well inside the SDK's timeout. */
const MAX_TOKENS = 8_000;

type CreateBody = Parameters<MessagesClient["messages"]["create"]>[0];
type MessageParam = CreateBody["messages"][number];

function messageParam(message: ToolMessage): MessageParam {
  if (message.role === "user") {
    if (typeof message.content === "string") return { role: "user", content: message.content };
    return { role: "user", content: message.content.map((block) => ({ type: "tool_result", tool_use_id: block.tool_use_id, content: block.content, ...(block.is_error ? { is_error: true } : {}) })) };
  }
  if (typeof message.content === "string") return { role: "assistant", content: message.content };
  // These blocks are the model's own reply from the previous request, sent back unchanged so its thinking and tool calls stay intact.
  return { role: "assistant", content: message.content.blocks as Exclude<MessageParam["content"], string> };
}

/**
 * Strict tool use, so the model's arguments follow the schema (docs/tech-stack.md section 6). Bedrock's strict mode
 * refuses an integer's bounds (seen on 8 November 2026), so those are left to the gateway, which checks every bound
 * again whatever the model sent; each bound is also written in the property's description.
 */
function strictProperty(property: ToolProperty) {
  if (property.type !== "integer") return property;
  return { type: property.type, description: property.description };
}

function toolParam(spec: ToolSpec) {
  const properties = Object.fromEntries(Object.entries(spec.inputSchema.properties).map(([name, property]) => [name, strictProperty(property)]));
  return {
    name: spec.name,
    description: spec.description,
    strict: true,
    input_schema: { type: "object" as const, properties, required: [...spec.inputSchema.required], additionalProperties: false },
  };
}

const STOP_REASONS: readonly ToolStopReason[] = ["end_turn", "tool_use", "max_tokens", "refusal", "pause_turn"];

/** One request to Messages with Kin's tools offered, and the reply as a `ToolTurn`. Tool choice stays automatic. */
export function messagesToolModel(client: MessagesClient, model: string): ToolModel {
  const call = async (request: Parameters<ToolModel>[0]): Promise<ToolTurn> => {
    let response;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: request.system,
          messages: request.messages.map(messageParam),
          tools: request.tools.map(toolParam),
          tool_choice: { type: "auto" },
          thinking: { type: "adaptive" },
          output_config: { effort: EFFORT },
        },
        // The question's deadline ends the request, and any retry the SDK would still make, so a throttled model cannot hold a question for minutes.
        { signal: request.signal ?? null },
      );
    } catch (error) {
      // The SDK has already retried what can be retried; the loop decides what to tell the person.
      throw new ModelUnavailableError("Claude on Bedrock could not answer", { cause: error });
    }
    const stopReason = STOP_REASONS.find((reason) => reason === response.stop_reason) ?? (response.stop_reason === "stop_sequence" ? "end_turn" : "other");
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const toolUses = response.content.flatMap((block) => (block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : []));
    return { stopReason, text, toolUses, content: { blocks: response.content } };
  };
  return Object.assign(call, { label: model });
}

/** Claude with Kin's tools, on Amazon Bedrock, through the configured endpoint. */
export function bedrockToolModel(config: Extract<ModelConfig, { enabled: true }>): ToolModel {
  return messagesToolModel(bedrockClient(config), config.model);
}
