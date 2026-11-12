import { NextResponse } from "next/server";

import { confirmEnrolment } from "@/server/auth/authenticator";
import { authConfig } from "@/server/auth/config";
import { defaultLocale, isLocale } from "@/i18n/locales";
import { readCappedText } from "@/server/request-body";
import { currentViewer } from "@/server/viewer";

const MAX_BYTES = 128;

const STATUS = { unavailable: 503, too_many_tries: 429, refused: 403, sign_in_again: 401, wrong_code: 400, invalid: 400 } as const;

function json(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Confirms the authenticator app a person is setting up, with a code from it.
 * The set-up itself was started by a fresh sign-in (`/auth/enrol-authenticator`);
 * this route holds no power over an account on its own. From Kin's own pages only.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") !== authConfig().webOrigin) return json({ ok: false, reason: "refused" }, 403);
  const viewer = await currentViewer();
  if (viewer === null) return json({ ok: false, reason: "sign_in_again" }, 401);
  const text = await readCappedText(request, MAX_BYTES);
  if (text === null) return json({ ok: false, reason: "invalid" }, 413);
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>)["locale"] : undefined;
  const locale = typeof raw === "string" && isLocale(raw) ? raw : defaultLocale;
  const { result, cookies } = await confirmEnrolment(viewer, input, locale);
  const response = json(result, result.ok ? 200 : STATUS[result.reason]);
  for (const cookie of cookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
