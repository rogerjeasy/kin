import type { ToolModel, ToolRequest, ToolStopReason, ToolTurn, ToolUse } from "../ask-kin/tool-model.ts";

export type FakeToolModel = ToolModel & { readonly requests: ToolRequest[] };

/** Plays each scripted turn in order, and keeps every request it was sent. */
export function fakeToolModel(...turns: (ToolTurn | Error)[]): FakeToolModel {
  const requests: ToolRequest[] = [];
  const model = async (request: ToolRequest): Promise<ToolTurn> => {
    // A copy, so a later push onto the loop's own list does not rewrite what this request held.
    requests.push({ ...request, messages: [...request.messages] });
    const turn = turns.shift();
    if (turn === undefined) throw new Error("The fake tool model was asked more often than expected");
    if (turn instanceof Error) throw turn;
    return turn;
  };
  return Object.assign(model, { requests, label: "fake-model" });
}

let next = 0;

/** A turn in which the model asks for these tool calls. */
export function toolCalls(...calls: readonly { readonly name: string; readonly input?: unknown }[]): ToolTurn {
  const toolUses: ToolUse[] = calls.map((call) => ({ id: `toolu_fake_${(next += 1)}`, name: call.name, input: call.input ?? {} }));
  return { stopReason: "tool_use", text: "", toolUses, content: { blocks: toolUses.map((use) => ({ type: "tool_use", ...use })) } };
}

/** A turn that ends with this text, or stops for another reason. */
export function finalTurn(text: string, stopReason: ToolStopReason = "end_turn"): ToolTurn {
  return { stopReason, text, toolUses: [], content: { blocks: text === "" ? [] : [{ type: "text", text }] } };
}
