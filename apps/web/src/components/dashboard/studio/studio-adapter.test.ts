import type { AgAiConversationItem, AgLlmRequest } from "ag-studio";
import { describe, expect, it } from "vitest";

import { kinStudioAdapter, STUDIO_ASSISTANT_URL, studioRequestBody, studioResponse } from "./studio-adapter";

const asked: AgAiConversationItem = { id: "m1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Show caregiver pay by month" }] };
const called: AgAiConversationItem = { id: "c1", kind: "output", type: "function_call", callId: "toolu_1", name: "view_schema", arguments: "{}" };
const answered: AgAiConversationItem = { type: "function_call_output", callId: "toolu_1", output: "tables: ledger, fairness", status: "completed" };

const request = (input: AgAiConversationItem[], extra: Partial<AgLlmRequest> = {}): AgLlmRequest => ({
  input,
  instructions: "You are the lead agent.",
  tools: [{ name: "view_schema", description: "The data model", parameters: { type: "object", properties: {} } }],
  responseFormat: { type: "text" },
  ...extra,
});

describe("AG Studio's turn, as Kin's route reads it", () => {
  it("carries the agent's instructions as notes, the conversation as alternating messages and the tools by name", () => {
    expect(studioRequestBody(request([asked, called, answered]))).toEqual({
      system: [{ type: "text", text: "You are the lead agent." }],
      messages: [
        { role: "user", content: [{ type: "text", text: "Show caregiver pay by month" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "view_schema", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "tables: ledger, fairness" }] },
      ],
      tools: [{ name: "view_schema", description: "The data model", input_schema: { type: "object", properties: {} } }],
    });
  });

  it("puts several tool calls of one turn into one assistant message, and drops reasoning", () => {
    const second: AgAiConversationItem = { ...called, id: "c2", callId: "toolu_2", name: "view_page" };
    const reasoning: AgAiConversationItem = { id: "r1", kind: "output", type: "reasoning", summary: [{ type: "summary", text: "Thinking" }] };
    const body = studioRequestBody(request([asked, reasoning, called, second]));
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]?.content.map((block) => block.type === "tool_use" && block.id)).toEqual(["toolu_1", "toolu_2"]);
  });

  it("sends a system message of AG Studio's as a note, never as the person's words", () => {
    const context: AgAiConversationItem = { id: "s1", kind: "input", type: "message", role: "system", status: "completed", content: [{ type: "text", text: "The page has 7 widgets." }] };
    const body = studioRequestBody(request([context, asked]));
    expect(body.system.map((part) => part.text)).toEqual(["You are the lead agent.", "The page has 7 widgets."]);
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Show caregiver pay by month" }] }]);
  });

  it("never offers the model a tool the provider would run", () => {
    const body = studioRequestBody(request([asked], { tools: [{ name: "web_search", description: "Search", parameters: {}, kind: "provided", provider: { type: "web_search" } }] }));
    expect(body.tools).toEqual([]);
  });
});

describe("Kin's answer, as AG Studio reads it", () => {
  it("turns the model's tool calls into AG Studio's calls and events", () => {
    const { response, events } = studioResponse({ ok: true, content: [{ type: "tool_use", id: "toolu_9", name: "add_widget", input: { type: "line-chart" } }], stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 2 } }, "t1", 10, "failed");
    expect(response).toMatchObject({ id: "t1", status: "completed", usage: { inputTokens: 5, outputTokens: 2 }, output: [{ type: "function_call", callId: "toolu_9", name: "add_widget", arguments: '{"type":"line-chart"}' }] });
    expect(events.map((event) => event.type)).toEqual(["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
  });

  it("streams a text answer as one assistant message", () => {
    const { response, events } = studioResponse({ ok: true, content: [{ type: "text", text: "The chart is on the page." }], stop_reason: "end_turn" }, "t2", 10, "failed");
    expect(response.output).toEqual([{ id: "t2-text-0", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "The chart is on the page.", annotations: [] }] }]);
    expect(events.map((event) => event.type)).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]);
  });

  it("fails the turn, in Kin's words, when the route refuses", () => {
    expect(studioResponse({ ok: false, reason: "invalid" }, "t3", 10, "The assistant could not answer.").response).toEqual({ id: "t3", createdAt: 10, status: "failed", output: [], error: { code: "kin_refused", message: "The assistant could not answer." } });
    expect(studioResponse("<html>", "t4", 10, "x").response.status).toBe("failed");
  });
});

describe("the adapter", () => {
  it("posts each turn to Kin's own route, in the viewer's language, and nowhere else", async () => {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const fake: typeof fetch = async (url, init) => {
      sent.push({ url: String(url), init });
      return Response.json({ ok: true, content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" });
    };
    const adapter = kinStudioAdapter({ locale: "fr", failed: "x", fetch: fake });
    const handler = adapter.executeTurn(request([asked]));
    const events = [];
    for await (const event of handler.stream) events.push(event);
    expect((await handler.complete).status).toBe("completed");
    expect(events).toHaveLength(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(STUDIO_ASSISTANT_URL);
    expect(new Headers(sent[0]?.init?.headers).get("x-kin-locale")).toBe("fr");
  });

  it("fails the turn when the network does", async () => {
    const adapter = kinStudioAdapter({ locale: "en", failed: "Try again.", fetch: async () => Promise.reject(new TypeError("offline")) });
    expect(await adapter.executeTurn(request([asked])).complete).toMatchObject({ status: "failed", error: { message: "Try again." } });
  });
});
