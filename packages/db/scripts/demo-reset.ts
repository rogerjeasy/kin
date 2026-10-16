// Gives a demo visitor a fresh copy of Rose's circle, archiving the one they
// had: `pnpm --filter @kin/db run demo:reset -- <visitor-id>`, where the ID is
// the visitor's ("demo:…", in the users table). Without an ID it adds a circle
// nobody can open, which is enough to look at the data locally.
import { readDatabaseConfig } from "@kin/config";

import { connect } from "../src/connection.ts";
import { provisionDemoCircle } from "../src/demo/provision.ts";
import { leaveDemoCircle, membershipsOf } from "../src/people.ts";
import { asPerson } from "../src/scope.ts";

const userId = process.argv.slice(2).find((arg) => arg !== "--") ?? null;
const config = readDatabaseConfig(process.env, ["app", "provisioner"]);
const app = connect(config, "app");
const provisioner = connect(config, "provisioner");
try {
  if (userId !== null) {
    const seats = await asPerson(app, userId, (tx) => membershipsOf(tx, userId));
    for (const seat of seats.filter((each) => each.demoSeat)) {
      await asPerson(app, userId, (tx) => leaveDemoCircle(tx, seat.circleId));
      console.log(`Archived demo circle ${seat.circleId}`);
    }
  }
  const circle = await provisionDemoCircle(provisioner, userId, new Date());
  console.log(`Provisioned Rose's circle ${circle.circleId}${userId === null ? "" : ` for ${userId}`}`);
} finally {
  await Promise.all([app.$client.end(), provisioner.$client.end()]);
}
