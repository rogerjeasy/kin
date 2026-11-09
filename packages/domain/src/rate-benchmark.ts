/**
 * Whether a caregiver's hourly rate is close to what care costs. The table is
 * dated data with its source named, never a model's guess. It holds the
 * national median only: a state's own figure is added as a row when it is
 * sourced, and until then a rate is compared with the national one.
 */
export type RateBenchmark = {
  readonly currency: "USD";
  /** Median hourly price of a non-medical in-home caregiver, in cents. */
  readonly medianCentsPerHour: number;
  readonly source: string;
  readonly url: string;
  readonly collected: string;
};

export const RATE_BENCHMARKS: readonly RateBenchmark[] = [
  {
    currency: "USD",
    medianCentsPerHour: 3500,
    source: "CareScout Cost of Care Survey 2025, national median for in-home non-medical caregivers",
    url: "https://www.carescout.com/cost-of-care",
    collected: "July to November 2025",
  },
];

/** A rate under 60% of the median, or over 150% of it, is far from market and is marked. */
export const RATE_LOW_BPS = 6000;
export const RATE_HIGH_BPS = 15_000;

export type RateJudgement = "below" | "near" | "above" | "unknown";

export function judgeRate(rateCentsPerHour: number, currency: string): { readonly judgement: RateJudgement; readonly benchmark: RateBenchmark | null } {
  const benchmark = RATE_BENCHMARKS.find((row) => row.currency === currency) ?? null;
  if (benchmark === null || !Number.isSafeInteger(rateCentsPerHour) || rateCentsPerHour <= 0) return { judgement: "unknown", benchmark };
  // rate / median against the two bounds, cross-multiplied so no division happens.
  const scaled = rateCentsPerHour * 10_000;
  if (scaled < benchmark.medianCentsPerHour * RATE_LOW_BPS) return { judgement: "below", benchmark };
  if (scaled > benchmark.medianCentsPerHour * RATE_HIGH_BPS) return { judgement: "above", benchmark };
  return { judgement: "near", benchmark };
}
