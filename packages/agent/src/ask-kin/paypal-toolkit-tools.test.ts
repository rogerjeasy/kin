import { DELEGATION_SCOPES } from "@kin/auth";
import { CIRCLE_ROLES, type CircleRole } from "@kin/domain";
import { describe, expect, it, vi } from "vitest";

import { ASK_KIN_TOOLS, ASK_KIN_TOOL_NAMES } from "./ask-kin-tools.ts";
import { messagesToolModel } from "./bedrock-tool-model.ts";
import { PAYPAL_TOOLKIT_TOOLS, PAYPAL_TOOLKIT_TOOL_NAMES } from "./paypal-toolkit-tools.ts";
import { mayUseTool, toolGateway, toolsForRole, type ToolImplementations, type ToolOutput } from "./tool-gateway.ts";

const ok = (): ToolOutput => ({ data: { found: true }, fact: "A fact." });
const MAY_READ_MONEY: readonly CircleRole[] = ["organizer", "contributor", "parent", "observer"];

function gateway(role: CircleRole, run = vi.fn(async () => ok())) {
  const implementations = Object.fromEntries(ASK_KIN_TOOL_NAMES.map((name) => [name, run])) as unknown as ToolImplementations;
  return toolGateway({ context: { circleId: "circle-1", memberId: "member-1", role }, implementations, recorder: () => undefined, clock: () => 0 });
}

describe("Ask Kin's PayPal Agent Toolkit tools", () => {
  it("are in the catalogue, each only reading what the circle's money lets a person see", () => {
    expect(PAYPAL_TOOLKIT_TOOL_NAMES).toEqual(["get_paypal_order", "get_paypal_invoice", "list_paypal_disputes"]);
    for (const name of PAYPAL_TOOLKIT_TOOL_NAMES) {
      expect(ASK_KIN_TOOLS[name]).toBe(PAYPAL_TOOLKIT_TOOLS[name]);
      expect(ASK_KIN_TOOLS[name]).toMatchObject({ kind: "read", action: "money.view" });
      expect(ASK_KIN_TOOLS[name].description).toContain("PayPal Agent Toolkit");
    }
  });

  it("take no PayPal ID from the model: a member's name at most", () => {
    for (const name of PAYPAL_TOOLKIT_TOOL_NAMES) {
      const { properties, additionalProperties } = ASK_KIN_TOOLS[name].inputSchema;
      expect(additionalProperties).toBe(false);
      expect(Object.keys(properties).filter((key) => key !== "member")).toEqual([]);
    }
  });

  it("send Bedrock's strict tool mode closed objects with no integer bounds and no list limits", async () => {
    const calls: { tools: { name: string; input_schema: unknown }[] }[] = [];
    const client = { messages: { create: async (params: { tools: { name: string; input_schema: unknown }[] }) => (calls.push(params), { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] }) } };
    await messagesToolModel(client as unknown as Parameters<typeof messagesToolModel>[0], "m")({ system: "rules", messages: [{ role: "user", content: "q" }], tools: toolsForRole("organizer") });
    for (const name of PAYPAL_TOOLKIT_TOOL_NAMES) {
      const sent = JSON.stringify(calls[0]?.tools.find((tool) => tool.name === name));
      expect(sent).toContain('"strict":true');
      expect(sent).toContain('"additionalProperties":false');
      expect(sent).not.toMatch(/minimum|maximum|maxItems|minItems|uniqueItems|"type":"array"|"type":"integer"/u);
    }
  });

  it.each(MAY_READ_MONEY)("are offered to a %s, and under either delegation scope", (role) => {
    for (const name of PAYPAL_TOOLKIT_TOOL_NAMES) {
      expect(toolsForRole(role).map((tool) => tool.name)).toContain(name);
      for (const scope of DELEGATION_SCOPES) expect(mayUseTool(role, name, scope)).toBe(true);
    }
  });

  it.each(PAYPAL_TOOLKIT_TOOL_NAMES)("are refused to a caregiver, who sees only their own pay: %s runs nothing", async (name) => {
    const run = vi.fn(async () => ok());
    const done = await gateway("caregiver", run).call({ id: "toolu_1", name, input: {} });
    expect(done.record.outcome).toBe("refused");
    expect(done.block.is_error).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(toolsForRole("caregiver").map((tool) => tool.name)).not.toContain(name);
    for (const scope of DELEGATION_SCOPES) expect(mayUseTool("caregiver", name, scope)).toBe(false);
  });

  it("refuse a PayPal ID or any key but member as invalid, before anything runs", async () => {
    const run = vi.fn(async () => ok());
    for (const input of [{ id: "1SN482215K962041J" }, { order_id: "1SN482215K962041J" }, { member: "Elena", invoice_id: "INV2-YB8W-YH4M-95PN-B53B" }, { member: "<tag>" }, { member: "x".repeat(81) }]) {
      expect((await gateway("organizer", run).call({ id: "toolu_1", name: "get_paypal_order", input })).record.outcome).toBe("invalid");
    }
    expect((await gateway("organizer", run).call({ id: "toolu_1", name: "list_paypal_disputes", input: { member: "Elena" } })).record.outcome).toBe("invalid");
    expect(run).not.toHaveBeenCalled();
  });

  it("let none of the toolkit's writes through, by any name", async () => {
    const run = vi.fn(async () => ok());
    for (const name of ["create_order", "pay_order", "create_refund", "send_invoice", "cancel_sent_invoice", "accept_dispute_claim", "list_transactions", "get_paypal_order_and_capture"]) {
      expect((await gateway("organizer", run).call({ id: "toolu_1", name, input: {} })).record.outcome).toBe("unknown_tool");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("are refused to exactly the roles the role table leaves out", () => {
    for (const role of CIRCLE_ROLES) for (const name of PAYPAL_TOOLKIT_TOOL_NAMES) expect(mayUseTool(role, name)).toBe(MAY_READ_MONEY.includes(role));
  });
});
