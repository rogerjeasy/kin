import { readDatabaseConfig } from "@kin/config";
import { asService, connect, readLineRecord, recordLineCall } from "@kin/db";
import { CALL_STATE_TTL_MS } from "@kin/telephony";

import { callBook } from "./call-book.ts";
import { readVoiceConfig } from "./config.ts";
import { type VoiceLog } from "./office-line-service.ts";
import { voiceServer } from "./server.ts";
import { shiftCallStoreOn } from "./shift/shift-call-store.ts";

/**
 * Kin's phone service: Twilio's Programmable Voice webhook for the family
 * office line, and for Kin's own call to a parent about a shift. It holds the
 * service role, limited in each transaction to one circle: the one the dialled
 * number belongs to, or the one a verified, sealed token names; the web app
 * never holds it (decision 38).
 */

// Aurora pauses when idle and took 74 seconds to resume (decision 43).
const CONNECT_TIMEOUT_MS = 90_000;

const log: VoiceLog = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

const config = readVoiceConfig(process.env);
const db = connect(readDatabaseConfig(process.env, ["service"]), "service", { connectTimeoutMs: CONNECT_TIMEOUT_MS });

const server = voiceServer({
  config,
  store: {
    read: (circleId) => asService(db, circleId, (tx) => readLineRecord(tx, circleId)),
    record: (input) => asService(db, input.circleId, (tx) => recordLineCall(tx, input)),
  },
  calls: callBook(Date.now, CALL_STATE_TTL_MS),
  // Kin's call to a parent about a shift: the circle comes from a sealed token, so one service answers for many circles.
  shiftCalls: shiftCallStoreOn(db),
  now: Date.now,
  log,
});

server.listen(config.port, () => log({ level: "info", message: "voice.listening", port: config.port, numbers: config.numbers.size }));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log({ level: "info", message: "voice.stopping", signal });
    server.close(() => process.exit(0));
  });
}
