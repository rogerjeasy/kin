import { authorize } from "@kin/auth";
import { RefillError, asDelegate, asPerson, proposeRefill, type CircleSnapshot, type Database, type RefillMandate, type RefillReason } from "@kin/db";

export type RefillContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  /**
   * Set when a member's own assistant asks, through Kin's MCP server. The refill then never rides the parent's
   * standing permission and always waits for a person's yes in Kin; the database refuses any approval in that write.
   */
  readonly delegationId?: string;
};

export type RefillResult = { readonly ok: true; readonly id: string; readonly mandate: RefillMandate } | { readonly ok: false; readonly reason: RefillReason };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The one request boundary for asking Kin to reorder. The body names a rule
 * and nothing else: the amount, the seller and the approvals come from the
 * record and the agreement, never from the request. Kin only proposes; the
 * purchase is made after the yes the plan asks for.
 */
export async function runRefill(context: RefillContext, input: unknown): Promise<RefillResult> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "refill.propose").allowed) return { ok: false, reason: "refused" };
  const body = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (body === null || Object.keys(body).some((key) => key !== "ruleId") || typeof body["ruleId"] !== "string" || !UUID.test(body["ruleId"])) return { ok: false, reason: "invalid" };
  const ruleId = body["ruleId"];
  const circleId = context.circle.circle.id;
  const now = context.circle.circle.now;
  try {
    const { delegationId } = context;
    const proposed =
      delegationId === undefined
        ? await asPerson(context.db, context.userId, (tx) => proposeRefill(tx, { circleId, ruleId, now }))
        : await asDelegate(context.db, context.userId, delegationId, (tx) => proposeRefill(tx, { circleId, ruleId, now, standingPermission: false }));
    return { ok: true, ...proposed };
  } catch (error) {
    if (error instanceof RefillError) return { ok: false, reason: error.reason };
    throw error;
  }
}
