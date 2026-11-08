import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";
import type { Page } from "@playwright/test";

import { DEMO_COOKIE } from "../../src/server/auth/demo-cookie.ts";
import { E2E_DATABASE } from "./database-settings.ts";

/**
 * Takes the hourly rate away from every caregiver in the demo visitor's own
 * circle, as the database's administrator would. The demo seed now records a
 * rate for Amara, so a test of what a caregiver sees before the organizer has
 * recorded one starts here. The visitor is the one in the page's cookie jar:
 * the cookie's payload names them, and only their circle is touched, so
 * parallel tests are unaffected.
 */
export async function clearDemoCaregiverRates(page: Page): Promise<number> {
  const cookie = (await page.context().cookies()).find((each) => each.name === DEMO_COOKIE);
  if (!cookie) throw new Error("The page holds no demo visitor's session");
  const claims = JSON.parse(Buffer.from(cookie.value.split(".")[0] ?? "", "base64url").toString("utf8")) as { sub?: unknown };
  if (typeof claims.sub !== "string" || !claims.sub.startsWith("demo:")) throw new Error("The demo cookie names no demo visitor");
  const inherited = process.env[E2E_DATABASE.envKey];
  if (!inherited) throw new Error("The end-to-end database settings were not passed to this worker");
  const admin = connect(readDatabaseConfig(JSON.parse(inherited) as Record<string, string>, ["admin"]), "admin");
  try {
    const cleared = await admin.$client.query(
      `update payees set caregiver_rate_cents_per_hour = null
       where caregiver_rate_cents_per_hour is not null
         and circle_id in (select m.circle_id from members m join circles c on c.id = m.circle_id where m.user_id = $1 and c.demo)`,
      [claims.sub],
    );
    return cleared.rowCount ?? 0;
  } finally {
    await admin.$client.end();
  }
}
