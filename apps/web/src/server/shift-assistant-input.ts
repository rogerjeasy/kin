import type { AssistantBlock, AssistantMessage, AssistantTool } from "@kin/agent";

/**
 * What the calendar widget may send to the assistant's route, checked as
 * strictly as the widget's own protocol allows (an Anthropic-style Messages
 * request: system, tools, messages and two numbers). Every size is capped,
 * every key is known, and the tools are held to a list: the read and filter
 * tools the widget has are let through, the tools of the widget that would
 * add, change or remove a record or alter its look are dropped before the
 * model is shown the list, and a tool no one has heard of refuses the request.
 */

export const MAX_ASSISTANT_BYTES = 131_072;

/** What one assistant's widget may send: the sizes it is held to and the tools it may offer the model. */
export type AssistantInputPolicy = {
  /** The tools the model may be offered. */
  readonly allowed: ReadonlySet<string>;
  /** Tools the widget can have that the model must never be offered: dropped from the list, not refused. */
  readonly dropped: ReadonlySet<string>;
  readonly maxText: number;
  readonly maxSystemText: number;
  readonly maxResult: number;
  readonly maxMessages: number;
  readonly maxBlocks: number;
  readonly maxTools: number;
  readonly maxSystemParts: number;
  readonly maxSchemaJson: number;
  readonly maxDescription: number;
};
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const TOOL_ID = /^[A-Za-z0-9_-]{1,100}$/u;

/** The calendar widget's tools that only read the calendar or change what is shown of it. The assistant is offered these and no others. */
export const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "getEvents",
  "getResources",
  "getColumns",
  "getNextAvailableSlot",
  "filterEvents",
  "unfilterEvents",
  "filterResources",
  "unfilterResources",
  "highlightEvents",
  "highlightCells",
  "unhighlightAll",
  "selectEvents",
  "selectResources",
  "scrollToDate",
  "changeTimeSpan",
  "changeTimeRangeContext",
  "askUser",
]);

/** Tools the widget can have that the assistant must never be offered: they change a record, the theme, how rows are ordered or which lines the calendar draws. Dropped, not refused. */
export const DROPPED_TOOLS: ReadonlySet<string> = new Set([
  "addEvents",
  "addResources",
  "addEvent",
  "addResource",
  "updateEvents",
  "updateResources",
  "updateEvent",
  "updateResource",
  "removeEvents",
  "removeResources",
  "removeEvent",
  "removeResource",
  "deleteEvents",
  "deleteResources",
  "assignEvents",
  "assignEvent",
  "unassignEvents",
  "unassignEvent",
  "reassignEvents",
  "moveEvents",
  "copyEvents",
  "createDependency",
  "removeDependency",
  "changeTheme",
  "showCurrentTimeLine",
  "sortResources",
  "groupResources",
  "createPlan",
  "completePlanSteps",
]);

const SHIFT_POLICY: AssistantInputPolicy = {
  allowed: ALLOWED_TOOLS,
  dropped: DROPPED_TOOLS,
  maxText: 20_000,
  maxSystemText: 20_000,
  maxResult: 60_000,
  maxMessages: 60,
  maxBlocks: 30,
  maxTools: 40,
  maxSystemParts: 8,
  maxSchemaJson: 12_000,
  maxDescription: 4_000,
};

export type AssistantInput = {
  /** The widget's own notes about its data, as data. */
  readonly notes: readonly string[];
  readonly messages: readonly AssistantMessage[];
  /** Only the tools the assistant may be offered. */
  readonly tools: readonly AssistantTool[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (row: Record<string, unknown>, allowed: readonly string[]) => Object.keys(row).every((key) => allowed.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const smallJson = (value: unknown, policy: AssistantInputPolicy): boolean => JSON.stringify(value).length <= policy.maxSchemaJson;

function block(value: unknown, role: "user" | "assistant", policy: AssistantInputPolicy): AssistantBlock | null {
  if (!isRecord(value)) return null;
  if (value["type"] === "text" && onlyKeys(value, ["type", "text"]) && text(value["text"], policy.maxText)) return { type: "text", text: value["text"] };
  if (role === "assistant" && value["type"] === "tool_use" && onlyKeys(value, ["type", "id", "name", "input"])) {
    const { id, name, input } = value;
    if (typeof id !== "string" || !TOOL_ID.test(id) || typeof name !== "string" || !policy.allowed.has(name) || !isRecord(input) || !smallJson(input, policy)) return null;
    return { type: "tool_use", id, name, input };
  }
  if (role === "user" && value["type"] === "tool_result" && onlyKeys(value, ["type", "tool_use_id", "content", "is_error"])) {
    const id = value["tool_use_id"];
    if (typeof id !== "string" || !TOOL_ID.test(id) || !text(value["content"], policy.maxResult)) return null;
    if (value["is_error"] !== undefined && value["is_error"] !== true) return null;
    return { type: "tool_result", tool_use_id: id, content: value["content"], ...(value["is_error"] === true ? { is_error: true as const } : {}) };
  }
  return null;
}

function message(value: unknown, policy: AssistantInputPolicy): AssistantMessage | null {
  if (!isRecord(value) || !onlyKeys(value, ["role", "content"]) || (value["role"] !== "user" && value["role"] !== "assistant")) return null;
  const role = value["role"];
  const { content } = value;
  if (typeof content === "string") return text(content, policy.maxText) ? { role, content } : null;
  if (!Array.isArray(content) || content.length === 0 || content.length > policy.maxBlocks) return null;
  const blocks = content.map((each) => block(each, role, policy));
  return blocks.every((each): each is AssistantBlock => each !== null) ? { role, content: blocks } : null;
}

function system(value: unknown, policy: AssistantInputPolicy): string[] | null {
  if (value === undefined) return [];
  if (typeof value === "string") return text(value, policy.maxSystemText) ? [value] : null;
  if (!Array.isArray(value) || value.length > policy.maxSystemParts) return null;
  const parts: string[] = [];
  for (const part of value) {
    if (!isRecord(part) || part["type"] !== "text" || !onlyKeys(part, ["type", "text"]) || !text(part["text"], policy.maxSystemText)) return null;
    parts.push(part["text"]);
  }
  return parts;
}

/** The tools to offer, or `null` when the list is malformed or names a tool that is neither allowed nor known to be dropped. */
function tools(value: unknown, policy: AssistantInputPolicy): AssistantTool[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > policy.maxTools) return null;
  const offered: AssistantTool[] = [];
  for (const tool of value) {
    if (!isRecord(tool) || !onlyKeys(tool, ["name", "description", "input_schema"])) return null;
    const { name, description, input_schema: schema } = tool;
    if (typeof name !== "string" || !TOOL_NAME.test(name) || !text(description, policy.maxDescription) || !isRecord(schema) || !smallJson(schema, policy)) return null;
    if (policy.dropped.has(name)) continue;
    if (!policy.allowed.has(name)) return null;
    offered.push({ name, description, inputSchema: schema });
  }
  return offered;
}

/** The widget's request, or `null` for anything else. */
export function parseAssistantInput(input: unknown): AssistantInput | null {
  return parseAssistantInputWith(SHIFT_POLICY, input);
}

/** A widget's Messages-style request held to `policy`, or `null` for anything else. */
export function parseAssistantInputWith(policy: AssistantInputPolicy, input: unknown): AssistantInput | null {
  if (!isRecord(input) || !onlyKeys(input, ["messages", "tools", "system", "max_tokens", "temperature", "model"])) return null;
  const { messages, max_tokens: maxTokens, temperature, model } = input;
  if (maxTokens !== undefined && (typeof maxTokens !== "number" || !Number.isSafeInteger(maxTokens))) return null;
  if (temperature !== undefined && typeof temperature !== "number") return null;
  if (model !== undefined && !text(model, 200)) return null;
  const notes = system(input["system"], policy);
  const offered = tools(input["tools"], policy);
  if (notes === null || offered === null || !Array.isArray(messages) || messages.length === 0 || messages.length > policy.maxMessages) return null;
  const parsed = messages.map((each) => message(each, policy));
  if (!parsed.every((each): each is AssistantMessage => each !== null)) return null;
  // A conversation starts with the person and ends with them (or with the widget's tool results on their behalf).
  if (parsed[0]?.role !== "user" || parsed.at(-1)?.role !== "user") return null;
  return { notes, messages: parsed, tools: offered };
}
