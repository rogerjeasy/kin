/**
 * The demo clock (docs/architecture.md section 20.3): the evening of
 * 30 October 2026, when Rose's month is ready to close. Every "now" on the
 * dashboard reads this, never the real time.
 */
export const DEMO_NOW = new Date("2026-10-30T18:00:00Z");

/** The month the dashboard shows, as YYYY-MM. */
export const DEMO_PERIOD = "2026-10";

/** The month after it, as YYYY-MM. */
export const NEXT_PERIOD = "2026-11";
