import { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { ModelConfig } from "@kin/config";

import { ModelUnavailableError, type StructuredModel, type StructuredRequest } from "./structured-model.ts";

/** HTTP statuses that mean "too many requests" or "overloaded": a short wait usually helps. */
const BUSY_STATUSES: readonly number[] = [429, 503, 529];

function isBusy(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" && BUSY_STATUSES.includes(error.status);
}

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

/** The part of either Bedrock client that Kin uses. */
export type MessagesClient = Pick<AnthropicBedrock | AnthropicBedrockMantle, "messages">;

/** One request to Messages, and the reply as a `StructuredReply`. Both endpoints speak the same body. */
export function messagesModel(client: MessagesClient, model: string): StructuredModel {
  const ask: StructuredModel = async (request) => {
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: userContent(request) }],
        output_config: { effort: EFFORT, format: { type: "json_schema", schema: request.schema } },
      });
    } catch (error) {
      // The SDK has already retried what can be retried; the caller decides what to tell the person.
      throw new ModelUnavailableError("Claude on Bedrock could not answer", { cause: error, kind: isBusy(error) ? "busy" : "unreachable" });
    }
    if (response.stop_reason === "refusal") return { kind: "refused" };
    if (response.stop_reason === "max_tokens") return { kind: "cut_off" };
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    if (text === "") throw new ModelUnavailableError(`Claude answered with no text (stop reason ${response.stop_reason})`, { kind: "unusable" });
    return { kind: "json", text };
  };
  return Object.assign(ask, { modelId: model });
}

/**
 * Claude on Amazon Bedrock. `mantle` is the Messages endpoint of the newest
 * models; `invoke` is the Bedrock Runtime InvokeModel API that every account
 * with model access has (docs/architecture.md decision 67). Credentials come
 * from the AWS provider chain (the task's role in AWS, a profile locally).
 * No tools are sent, and the answer must follow the request's JSON schema.
 */
export function bedrockModel(config: Extract<ModelConfig, { enabled: true }>): StructuredModel {
  return messagesModel(bedrockClient(config), config.model);
}

/** The Bedrock client for the configured endpoint, shared by the structured and the tool-using model. */
export function bedrockClient(config: Extract<ModelConfig, { enabled: true }>): MessagesClient {
  // Bedrock throttles this account (a 429 on a few calls in a hundred); the SDK backs off between tries, so four tries keep a throttled call from falling back to the fixed wording.
  const options = { awsRegion: config.region, timeout: TIMEOUT_MS, maxRetries: 4 };
  const standIn = config.endpoint === null ? {} : { baseURL: config.endpoint, skipAuth: true };
  return config.api === "invoke" ? new AnthropicBedrock({ ...options, ...standIn }) : new AnthropicBedrockMantle({ ...options, ...standIn });
}
