import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgAiTool, type AgCoreStudioApi, type AgLlmAdapter, type AgStudioApi } from "ag-studio";

/** The Kin agent's id among AG Studio's built-in team (lead, planning, data, page, widget). */
export const KIN_AGENT = "kin";
const BUILT_IN_TARGETS = ["data", "page", "planning", "widget"] as const;

export type StudioAgentOptions = {
  readonly adapter: AgLlmAdapter;
  /** The Kin agent's instructions, from packages/agent, where every prompt lives. */
  readonly instructions: string;
  /** The name of the one tool of Kin's own, from packages/agent. */
  readonly toolName: string;
  readonly toolDescription: string;
  /** The record's figures, already written for people by Kin's formatter on the server. */
  readonly facts: readonly string[];
  readonly kinDescription: string;
  readonly leadNote: string;
  readonly starters: readonly AgAiPromptStarter[];
  /** An observer may only look: the Kin agent fronts the conversation alone, with tools that only read. */
  readonly readOnly: boolean;
};

function factsTool(api: AgStudioApi, options: StudioAgentOptions): AgAiTool {
  return api.defineAiTool({
    name: options.toolName,
    description: options.toolDescription,
    params: (s) => s.object({}),
    execute: (_args, ctx) => ctx.success(options.facts.join("\n"), { facts: options.facts }),
  });
}

/**
 * The studio's agents. AG Studio's own team builds the dashboard; Kin adds an
 * agent of its own that answers from the record's figures, and gives the lead
 * a wider delegation so it can hand questions about the family's money to
 * Kin. Every agent reaches Claude through the one adapter, which is Kin's
 * route. An observer gets the Kin agent alone, with tools that only read.
 */
export function kinStudioAgents(options: StudioAgentOptions): AgAiHarnessSetup {
  return ({ api: given }) => {
    const api = studioApi(given);
    return createAiHarness(api, ({ builtIn, tools }) => {
      const { studio } = tools;
      const kin = directLlmRunner({
        id: KIN_AGENT,
        name: "Kin",
        description: options.kinDescription,
        adapter: options.adapter,
        schema: (s) => s.undefined(),
        instructions: () => options.instructions,
        tools: () => [factsTool(api, options), studio.viewSchema(), studio.viewPage(), studio.executeQuery()],
      });
      if (options.readOnly) return { agents: [kin], primary: KIN_AGENT, promptStarters: [...options.starters] };
      const lead = directLlmRunner({
        ...builtIn.lead,
        adapter: options.adapter,
        instructions: (context, params) => [builtIn.lead.instructions?.(context, params) ?? "", options.leadNote].join("\n\n"),
        tools: (context, params) => [...(builtIn.lead.tools?.(context, params) ?? []).filter((tool) => tool.name !== "delegate_to"), tools.delegateTo([...BUILT_IN_TARGETS, KIN_AGENT])],
      });
      const team = BUILT_IN_TARGETS.map((id) => directLlmRunner({ ...builtIn[id], adapter: options.adapter }));
      return { agents: [lead, ...team, kin], primary: "lead", promptStarters: [...options.starters] };
    });
  };
}

/** AG Studio declares the harness's api as its core API; at run time it is the full studio API, which defines tools. */
function studioApi(api: AgCoreStudioApi): AgStudioApi {
  if (!isStudioApi(api)) throw new TypeError("AG Studio handed the harness an API that cannot define tools");
  return api;
}

function isStudioApi(api: AgCoreStudioApi): api is AgStudioApi {
  return "defineAiTool" in api && typeof api.defineAiTool === "function";
}
