import { AGENT_TOOLKIT_METHODS, type AgentToolkit } from "../agent-toolkit.ts";

export type FakeAgentToolkit = AgentToolkit & {
  /** Every call the toolkit was asked to run, in order. */
  readonly calls: { readonly name: string; readonly input: Readonly<Record<string, string | number>> }[];
};

/**
 * A stand-in for the toolkit's Bedrock entry. It lists the tools it was made
 * with and answers each call from `answers`, encoded exactly as version 1.11.0
 * encodes them: PayPal's JSON stringified, then stringified again. A method it
 * has no answer for answers as the toolkit does when PayPal says no.
 */
export function fakeAgentToolkit(
  answers: Readonly<Record<string, (input: Readonly<Record<string, string | number>>) => unknown>>,
  enabled: readonly string[] = AGENT_TOOLKIT_METHODS,
): FakeAgentToolkit {
  const calls: FakeAgentToolkit["calls"] = [];
  return {
    calls,
    getTools: () => enabled.map((name) => ({ toolSpec: { name } })),
    async handleToolCall(call) {
      calls.push({ name: call.name, input: call.input });
      const answer = answers[call.name];
      const output = answer === undefined ? { ok: false, status: 404, code: "PAYPAL_API_HTTP_ERROR", message: "RESOURCE_NOT_FOUND" } : answer(call.input);
      return { content: [{ text: JSON.stringify(JSON.stringify(output)) }] };
    },
  };
}
