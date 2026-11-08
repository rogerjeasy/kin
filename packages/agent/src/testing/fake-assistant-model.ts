import type { AssistantBlock, AssistantModel, AssistantModelTurn, AssistantRequest } from "../shift-assistant.ts";

export type FakeAssistantModel = AssistantModel & { readonly requests: AssistantRequest[] };

const usage = { inputTokens: 1, outputTokens: 1 };

/** Answers each request with the next turn, and keeps what it was asked. */
export function fakeAssistantModel(...turns: (AssistantModelTurn | Error)[]): FakeAssistantModel {
  const requests: AssistantRequest[] = [];
  const model = async (request: AssistantRequest): Promise<AssistantModelTurn> => {
    requests.push(request);
    const turn = turns.shift();
    if (turn === undefined) throw new Error("The fake assistant was asked more often than expected");
    if (turn instanceof Error) throw turn;
    return turn;
  };
  return Object.assign(model, { requests, label: "fake-assistant" });
}

export const assistantSays = (text: string): AssistantModelTurn => ({ stopReason: "end_turn", blocks: [{ type: "text", text }], usage });

export const assistantCalls = (...calls: { id: string; name: string; input?: unknown }[]): AssistantModelTurn => ({
  stopReason: "tool_use",
  blocks: calls.map((call): AssistantBlock => ({ type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} })),
  usage,
});
