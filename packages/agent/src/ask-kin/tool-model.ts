import type { ObjectSchema } from "./tool-schema.ts";

/**
 * Claude with tools, as Ask Kin reaches it: the Bedrock adapter in production,
 * a scripted fake in tests. Kin's own loop drives it (docs/architecture.md
 * section 9.3), so every call the model asks for passes the tool gateway.
 */

/** A tool as the model is shown it. */
export type ToolSpec = { readonly name: string; readonly description: string; readonly inputSchema: ObjectSchema };

/** One call the model asked for. Its input is untrusted until the gateway has parsed it. */
export type ToolUse = { readonly id: string; readonly name: string; readonly input: unknown };

export type ToolResultBlock = { readonly type: "tool_result"; readonly tool_use_id: string; readonly content: string; readonly is_error?: true };

/**
 * The assistant's content exactly as the model returned it: text, tool calls
 * and any thinking blocks, which must go back unchanged on the next request.
 * Kin never reads or edits it; the adapter that made it sends it back.
 */
export type AssistantContent = { readonly blocks: readonly unknown[] };

export type ToolMessage =
  | { readonly role: "user"; readonly content: string | readonly ToolResultBlock[] }
  | { readonly role: "assistant"; readonly content: AssistantContent | string };

export type ToolStopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "other";

export type ToolTurn = {
  readonly stopReason: ToolStopReason;
  /** The text blocks of the turn, joined. */
  readonly text: string;
  readonly toolUses: readonly ToolUse[];
  readonly content: AssistantContent;
};

export type ToolRequest = {
  readonly system: string;
  readonly messages: readonly ToolMessage[];
  readonly tools: readonly ToolSpec[];
  /** Aborted when the question's deadline passes: the adapter stops waiting for the model, retries included. */
  readonly signal?: AbortSignal;
};

export type ToolModel = ((request: ToolRequest) => Promise<ToolTurn>) & {
  /** The model's ID, shown to people beside what it wrote. */
  readonly label: string;
};
