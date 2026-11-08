import type { CheckLinkProblem, CheckLinkReply, PublicCheck } from "@/server/check-link";

const PROBLEMS: readonly string[] = ["link", "early", "state", "short", "busy", "unavailable"];

const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

function readCheck(value: unknown): PublicCheck | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const { action, turned, name, timezone, startsAt, endsAt, checkedInAt, checkedOutAt } = row;
  if ((action !== "in" && action !== "out") || typeof turned !== "boolean" || !isText(name) || !isText(timezone) || !isText(startsAt) || !isText(endsAt) || !isTextOrNull(checkedInAt) || !isTextOrNull(checkedOutAt)) return null;
  return { action, turned, name, timezone, startsAt, endsAt, checkedInAt, checkedOutAt };
}

/** Reads the route's reply. What cannot be read is "unavailable", the same as an outage. */
export function readReply(value: unknown): CheckLinkReply {
  const unavailable: CheckLinkReply = { ok: false, reason: "unavailable" };
  if (value === null || typeof value !== "object") return unavailable;
  const row = value as Record<string, unknown>;
  if (row["ok"] === true) {
    const check = readCheck(row["check"]);
    return check === null ? unavailable : { ok: true, check };
  }
  const reason = row["reason"];
  return isText(reason) && PROBLEMS.includes(reason) ? { ok: false, reason: reason as CheckLinkProblem } : unavailable;
}

/** Taps the link: the token and which key, to the public route. The token goes in the body, never in an address that a log keeps. */
export async function tapLink(token: string, action: "in" | "out"): Promise<CheckLinkReply> {
  try {
    const response = await fetch("/api/check-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, action }), cache: "no-store", referrerPolicy: "no-referrer" });
    return readReply(await response.json().catch(() => null));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
