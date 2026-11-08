import type { Dictionary } from "@/i18n/dictionary";

type Answered = Dictionary["dashboard"]["approvals"]["answered"];
type DecidedState = keyof Answered["states"];

/**
 * What an answered proposal says about its payment. A demo circle's payments
 * are simulated, so they never claim PayPal is paying or has confirmed them.
 */
export function answeredStatus(answered: Answered, simulated: boolean, state: DecidedState): string {
  if (simulated && Object.hasOwn(answered.simulatedStates, state)) return answered.simulatedStates[state as keyof Answered["simulatedStates"]];
  return answered.states[state];
}
