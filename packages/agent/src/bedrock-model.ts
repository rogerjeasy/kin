import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { ModelConfig } from "@kin/config";

import { ModelUnavailableError, type StructuredModel, type StructuredRequest } from "./structured-model.ts";

/** Extraction is a short, well-specified read: low effort (docs/tech-stack.md section 6). */
const EFFORT = "low";
/** Room for adaptive thinking and a short JSON answer. */
const MAX_TOKENS = 8_000;
const TIMEOUT_MS = 60_000;

/** Plain text for a request about words; the photographs first, then the words, for one about a picture. */
function userContent(request: StructuredRequest) {
  if (request.images === undefined || request.images.length === 0) return request.user;
  return [
    ...request.images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 } })),
    { type: "text" as const, text: request.user },
  ];
}

/**
 * Claude on Amazon Bedrock, through its Messages endpoint. Credentials come
 * from the AWS provider chain (the task's role in AWS, a profile locally).
 * No tools are sent, and the answer must follow the request's JSON schema.
 */
export function bedrockModel(config: Extract<ModelConfig, { enabled: true }>): StructuredModel {
  const client = new AnthropicBedrockMantle({
    awsRegion: config.region,
    timeout: TIMEOUT_MS,
    maxRetries: 2,
    ...(config.endpoint === null ? {} : { baseURL: config.endpoint, skipAuth: true }),
  });
  return async (request) => {
    let response;
    try {
      response = await client.messages.create({
        model: config.model,
        max_tokens: MAX_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: userContent(request) }],
        output_config: { effort: EFFORT, format: { type: "json_schema", schema: request.schema } },
      });
    } catch (error) {
      // The SDK has already retried what can be retried; the caller decides what to tell the person.
      throw new ModelUnavailableError("Claude on Bedrock could not answer", { cause: error });
    }
    if (response.stop_reason === "refusal") return { kind: "refused" };
    if (response.stop_reason === "max_tokens") return { kind: "cut_off" };
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    if (text === "") throw new ModelUnavailableError(`Claude answered with no text (stop reason ${response.stop_reason})`);
    return { kind: "json", text };
  };
}
