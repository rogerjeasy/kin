/**
 * The ports the end-to-end servers listen on. `KIN_E2E_PORT_OFFSET` shifts all
 * of them together, so two checkouts on one machine can run the suite at once;
 * unset, they are the usual 3100 to 3103 and 54339.
 */
const offset = Number(process.env.KIN_E2E_PORT_OFFSET ?? "0");
if (!Number.isInteger(offset) || offset < 0 || offset > 500) throw new Error("KIN_E2E_PORT_OFFSET must be a whole number from 0 to 500");

export const E2E_PORTS = {
  app: 3100 + offset * 10,
  identityProvider: 3101 + offset * 10,
  databaseHealth: 3102 + offset * 10,
  modelStandIn: 3103 + offset * 10,
  database: 54339 + offset,
} as const;

export const E2E_APP_ORIGIN = `http://localhost:${E2E_PORTS.app}`;
