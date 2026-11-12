import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";

import { ASSISTANT_LOCALE_HEADER } from "@/content/circle/shift-assistant-protocol";

/**
 * AG Studio's model adapter, pointed at Kin's own route. AG Studio runs its
 * agents in the page and executes their tools here; each turn is sent to
 * /api/record/studio/assistant, which checks the viewer, holds the tools to a
 * list, puts Kin's rules first and reaches Claude through packages/agent. The
 * browser never holds a key and never calls the model itself.
 */
export const STUDIO_ASSISTANT_URL = "/api/record/studio/assistant";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };
type Message = { role: "user" | "assistant"; content: Block[] };

/** The Messages-style request Kin's route reads. */
export type StudioRequestBody = {
  system: { type: "text"; text: string }[];
  messages: Message[];
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parsedArguments(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text === "" ? "{}" : text);
    return isRecord(value) ? value : {};
  } catch {
    // The model's arguments did not parse; AG Studio reports that to it on the next turn, so an empty call is sent.
    return {};
  }
}

/** One conversation item as a block of a message, and whose message it belongs to. `null` for what the model need not see again. */
function blockOf(item: AgAiConversationItem): { role: Message["role"]; block: Block } | null {
  switch (item.type) {
    case "message": {
      const text = item.content.flatMap((part) => (part.type === "text" ? [part.text] : part.type === "refusal" ? [part.refusal] : [])).join("\n");
      if (text.trim() === "") return null;
      return { role: item.role === "assistant" ? "assistant" : "user", block: { type: "text", text } };
    }
    case "function_call":
      return { role: "assistant", block: { type: "tool_use", id: item.callId, name: item.name, input: parsedArguments(item.arguments) } };
    case "function_call_output":
      return { role: "user", block: { type: "tool_result", tool_use_id: item.callId, content: item.output } };
    default:
      return null;
  }
}

/** AG Studio's request as the route's: its instructions as notes, its conversation as alternating messages, its tools by name. */
export function studioRequestBody(request: AgLlmRequest): StudioRequestBody {
  const notes = [request.instructions ?? "", ...request.input.flatMap((item) => (item.type === "message" && item.role === "system" ? item.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []))].filter((note) => note.trim() !== "");
  const messages: Message[] = [];
  for (const item of request.input) {
    if (item.type === "message" && item.role === "system") continue;
    const next = blockOf(item);
    if (next === null) continue;
    const last = messages.at(-1);
    if (last?.role === next.role) last.content.push(next.block);
    else messages.push({ role: next.role, content: [next.block] });
  }
  return {
    system: notes.map((text) => ({ type: "text", text })),
    messages,
    tools: (request.tools ?? []).filter((tool) => tool.kind !== "provided").map((tool) => ({ name: tool.name, description: tool.description, input_schema: isRecord(tool.parameters) ? tool.parameters : {} })),
  };
}

/** What the route answers: the model's text and tool calls, or a refusal. */
export type StudioResponseBody =
  | { ok: true; content: Block[]; stop_reason: string; usage?: { input_tokens: number; output_tokens: number } }
  | { ok: false; reason?: string };

/** The route's answer as AG Studio's: output items for the turn, and the events that stream them into the panel. */
export function studioResponse(body: unknown, id: string, now: number, failed: string): { response: AgLlmResponse; events: AgAiEvent[] } {
  const parsed = isRecord(body) && body["ok"] === true && Array.isArray(body["content"]) ? (body as StudioResponseBody & { ok: true }) : null;
  if (parsed === null) {
    return { response: { id, createdAt: now, status: "failed", output: [], error: { code: "kin_refused", message: failed } }, events: [] };
  }
  const output: AgAiOutputItem[] = [];
  const events: AgAiEvent[] = [];
  parsed.content.forEach((block, index) => {
    if (block.type === "text") {
      const messageId = `${id}-text-${index}`;
      output.push({ id: messageId, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: block.text, annotations: [] }] });
      events.push({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" }, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: block.text }, { type: "TEXT_MESSAGE_END", messageId });
    } else if (block.type === "tool_use") {
      const args = JSON.stringify(block.input);
      output.push({ id: `${id}-call-${index}`, kind: "output", type: "function_call", callId: block.id, name: block.name, arguments: args, status: "completed" });
      events.push({ type: "TOOL_CALL_START", toolCallId: block.id, toolCallName: block.name }, { type: "TOOL_CALL_ARGS", toolCallId: block.id, delta: args }, { type: "TOOL_CALL_END", toolCallId: block.id });
    }
  });
  const usage = parsed.usage ? { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens } : undefined;
  return { response: { id, createdAt: now, status: "completed", output, ...(usage ? { usage } : {}) }, events };
}

async function* replay(events: Promise<AgAiEvent[]>): AsyncGenerator<AgAiEvent> {
  for (const event of await events) yield event;
}

/** The adapter AG Studio drives: one POST to Kin's route per turn, answered whole. */
export function kinStudioAdapter(options: { readonly locale: string; readonly failed: string; readonly fetch?: typeof fetch }): AgLlmAdapter {
  const send = options.fetch ?? fetch;
  let turns = 0;
  return {
    executeTurn(request, turnOptions) {
      turns += 1;
      const id = `kin-turn-${turns}`;
      const answer = (async () => {
        try {
          const reply = await send(STUDIO_ASSISTANT_URL, {
            method: "POST",
            headers: { "content-type": "application/json", [ASSISTANT_LOCALE_HEADER]: options.locale },
            body: JSON.stringify(studioRequestBody(request)),
            ...(turnOptions?.signal ? { signal: turnOptions.signal } : {}),
          });
          const body: unknown = reply.ok ? await reply.json() : null;
          return studioResponse(body, id, Date.now(), options.failed);
        } catch (error) {
          if (turnOptions?.signal?.aborted) return { response: { id, createdAt: Date.now(), status: "cancelled" as const, output: [] }, events: [] };
          // A network failure is the turn's failure: AG Studio shows it and the person can ask again.
          return studioResponse({ ok: false, reason: error instanceof Error ? error.name : "network" }, id, Date.now(), options.failed);
        }
      })();
      return { stream: replay(answer.then((each) => each.events)), complete: answer.then((each) => each.response) };
    },
  };
}
