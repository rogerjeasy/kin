import { CIRCLE_ROLES, type CircleRole } from "@kin/domain";
import { describe, expect, it, vi } from "vitest";

import { ASK_KIN_TOOL_NAMES, type AskKinToolName } from "./ask-kin-tools.ts";
import { toolGateway, toolsForRole, type ToolCallRecord, type ToolImplementations, type ToolOutput } from "./tool-gateway.ts";

const ok = (data: ToolOutput["data"] = { found: true }): ToolOutput => ({ data, fact: "A fact." });

function implementations(overrides: Partial<ToolImplementations> = {}): ToolImplementations {
  const each = vi.fn(async () => ok());
  return { ...(Object.fromEntries(ASK_KIN_TOOL_NAMES.map((name) => [name, each])) as unknown as ToolImplementations), ...overrides };
}

function gateway(role: CircleRole, options: { implementations?: ToolImplementations; records?: ToolCallRecord[] } = {}) {
  const records = options.records ?? [];
  return toolGateway({
    context: { circleId: "circle-1", memberId: "member-1", role },
    implementations: options.implementations ?? implementations(),
    recorder: (record) => records.push(record),
    clock: () => 1_000,
  });
}

const use = (name: string, input: unknown = {}) => ({ id: `toolu_${name}`, name, input });

/** The tools each role is offered: the role table, as packages/auth decides it. */
/** The parent's Purse is hers alone: nobody else is offered the tool that spends it. */
const FAMILY_TOOLS = ASK_KIN_TOOL_NAMES.filter((name) => name !== "propose_gift");
const OFFERED: Record<CircleRole, readonly AskKinToolName[]> = {
  organizer: FAMILY_TOOLS,
  contributor: FAMILY_TOOLS,
  parent: ASK_KIN_TOOL_NAMES,
  observer: ["get_pool", "list_bills", "get_fairness", "list_proposals", "get_record", "get_paypal_payout_status", "get_paypal_topup_status", "get_subscription_status"],
  caregiver: ["list_bills", "list_proposals", "get_paypal_payout_status"],
};

describe("the tools offered to the model", () => {
  it.each(CIRCLE_ROLES)("are filtered by role for a %s", (role) => {
    expect(toolsForRole(role).map((tool) => tool.name)).toEqual(OFFERED[role]);
  });

  it("never include a tool that approves, pays or edits", () => {
    expect(ASK_KIN_TOOL_NAMES.filter((name) => /approve|pay_|execute|send|edit|delete|capture|payout_create/u.test(name))).toEqual([]);
  });

  it("show each tool's strict schema", () => {
    for (const tool of toolsForRole("organizer")) expect(tool.inputSchema.additionalProperties).toBe(false);
  });
});

describe("the tool gateway", () => {
  const refusals = CIRCLE_ROLES.flatMap((role) => ASK_KIN_TOOL_NAMES.filter((name) => !OFFERED[role].includes(name)).map((name) => [role, name] as const));

  it("refuses at least the tools an observer and a caregiver may not use", () => {
    expect(refusals).toContainEqual(["observer", "propose_refill"]);
    expect(refusals).toContainEqual(["observer", "check_claim"]);
    expect(refusals).toContainEqual(["caregiver", "get_pool"]);
    expect(refusals).toContainEqual(["caregiver", "propose_refill"]);
    for (const role of CIRCLE_ROLES.filter((each) => each !== "parent")) expect(refusals).toContainEqual([role, "propose_gift"]);
    expect(refusals.filter(([role]) => role === "parent")).toEqual([]);
  });

  it.each(refusals)("refuses a %s calling %s, and runs nothing", async (role, name) => {
    const run = vi.fn(async () => ok());
    const records: ToolCallRecord[] = [];
    const done = await gateway(role, { implementations: implementations({ [name]: run }), records }).call(use(name, name === "check_claim" ? { payee: "Harbor Gas" } : {}));
    expect(run).not.toHaveBeenCalled();
    expect(done.block.is_error).toBe(true);
    expect(done.record.outcome).toBe("refused");
    expect(records).toHaveLength(1);
  });

  it("runs an allowed tool with parsed arguments and the caller's context", async () => {
    const check = vi.fn(async () => ok({ verdict: "no_match" }));
    const done = await gateway("parent", { implementations: implementations({ check_claim: check }) }).call(use("check_claim", { payee: "Harbor Gas", amount: "300" }));
    expect(check).toHaveBeenCalledWith({ payee: "Harbor Gas", amount: "300" }, { circleId: "circle-1", memberId: "member-1", role: "parent" });
    expect(done.block).toEqual({ type: "tool_result", tool_use_id: "toolu_check_claim", content: '{"verdict":"no_match"}' });
    expect(done.record.outcome).toBe("ok");
  });

  it.each([
    ["an extra key", { payee: "Harbor Gas", circleId: "another-circle" }],
    ["a missing required key", {}],
    ["an amount that is not plain digits", { payee: "Harbor Gas", amount: "300; DROP TABLE" }],
    ["a number where text belongs", { payee: 300 }],
    ["text too long", { payee: "x".repeat(81) }],
    ["not an object", "Harbor Gas"],
  ])("refuses %s, and runs nothing", async (_, input) => {
    const check = vi.fn(async () => ok());
    const done = await gateway("organizer", { implementations: implementations({ check_claim: check }) }).call(use("check_claim", input));
    expect(check).not.toHaveBeenCalled();
    expect(done.record.outcome).toBe("invalid");
  });

  it("refuses a tool it does not know, such as one that would pay", async () => {
    const done = await gateway("organizer").call(use("create_payout", { amount: "264.00" }));
    expect(done.record).toMatchObject({ tool: "[unknown]", outcome: "unknown_tool", args: {} });
  });

  it("stops after six calls in a question, and after one proposal", async () => {
    const g = gateway("organizer");
    const outcomes = [];
    for (let i = 0; i < 7; i += 1) outcomes.push((await g.call(use("get_pool"))).record.outcome);
    expect(outcomes).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "limit"]);

    const h = gateway("organizer");
    expect((await h.call(use("propose_refill"))).record.outcome).toBe("ok");
    expect((await h.call(use("propose_refill"))).record.outcome).toBe("limit");
  });

  it("never hands an exception's words to the model", async () => {
    const failing = vi.fn(async (): Promise<ToolOutput> => {
      throw new Error("password=hunter2 at db.internal:5432");
    });
    const done = await gateway("organizer", { implementations: implementations({ get_pool: failing }) }).call(use("get_pool"));
    expect(done.record.outcome).toBe("failed");
    expect(done.block.content).not.toMatch(/hunter2|5432/u);
  });

  it("gives up on a slow tool and says its outcome is unknown", async () => {
    vi.useFakeTimers();
    try {
      const slow = vi.fn(() => new Promise<ToolOutput>(() => undefined));
      const pending = gateway("organizer", { implementations: implementations({ get_pool: slow }) }).call(use("get_pool"));
      await vi.advanceTimersByTimeAsync(8_001);
      const done = await pending;
      expect(done.record.outcome).toBe("timeout");
      expect(done.block.content).toMatch(/unknown/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a result too large to hand back", async () => {
    const huge = vi.fn(async () => ok({ text: "x".repeat(7_000) }));
    expect((await gateway("organizer", { implementations: implementations({ get_record: huge }) }).call(use("get_record"))).record.outcome).toBe("too_large");
  });

  it("records every call with free text masked", async () => {
    const records: ToolCallRecord[] = [];
    const g = gateway("organizer", { records });
    await g.call(use("check_claim", { payee: "Harbor Gas", amount: "300" }));
    await g.call(use("list_bills", { status: "paid" }));
    await g.call(use("get_record", { limit: 3 }));
    expect(records.map((record) => [record.tool, record.args, record.outcome])).toEqual([
      ["check_claim", { payee: "[text:10]", amount: "[text:3]" }, "ok"],
      ["list_bills", { status: "paid" }, "ok"],
      ["get_record", { limit: 3 }, "ok"],
    ]);
    expect(records[0]?.at).toEqual(new Date(1_000));
  });
});
