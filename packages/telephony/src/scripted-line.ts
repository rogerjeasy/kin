import type { CallLine } from "./call-line.ts";

/**
 * A caller who says the given lines in turn and then hangs up. It is the
 * fake adapter of the telephony interface: the simulator screen and every
 * test place calls through it.
 */
export function scriptedLine(callerLines: readonly string[]): CallLine {
  let next = 0;
  return {
    say: () => Promise.resolve(),
    listen: () => Promise.resolve(next < callerLines.length ? (callerLines[next++] ?? "") : null),
    hangUp: () => Promise.resolve(),
  };
}
