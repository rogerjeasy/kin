import { ModelUnavailableError, type StructuredModel } from "./structured-model.ts";
import { VISIT_SCHEMA, visitSystemPrompt, visitUserMessage } from "./visit-prompt.ts";

/** The longest description Kin reads at once. */
export const MAX_DESCRIPTION_LENGTH = 1_000;
/** How far back a description may reach: a bill covers recent visits. */
export const MAX_DAYS_BACK = 62;
const MINUTES_IN_A_DAY = 1_440;
const DAY_MS = 86_400_000;

export type ReadVisitsRequest = {
  readonly description: string;
  /** The caregiver's today, as YYYY-MM-DD in the circle's timezone. */
  readonly today: string;
  readonly timezone: string;
  /** The English weekday of `today`, so "on Monday" can be resolved. */
  readonly weekday: string;
};

export type ReadVisitsResult =
  | {
      readonly kind: "visits";
      /** One per day, oldest first, each traced to the caregiver's own words. */
      readonly visits: readonly { readonly date: string; readonly minutes: number }[];
      /** What the model could not place, in the caregiver's words. */
      readonly unclear: readonly string[];
      /** Entries left out because they could not be traced to the description, or were not real visits. */
      readonly dropped: number;
    }
  | { readonly kind: "refused" }
  | { readonly kind: "unreadable" };

/**
 * Reads a caregiver's description of their visits into service days and
 * durations, and nothing else: no amount, no rate. The model only proposes;
 * every entry is checked here, and each must quote the description, so a day
 * the caregiver never wrote cannot appear. The caregiver then reviews the
 * result like any visits they typed, and the server values it.
 */
export async function readVisits(model: StructuredModel, request: ReadVisitsRequest): Promise<ReadVisitsResult> {
  const description = request.description.trim();
  if (description === "" || description.length > MAX_DESCRIPTION_LENGTH) return { kind: "unreadable" };
  const reply = await model({
    system: visitSystemPrompt({ date: request.today, weekday: request.weekday, timezone: request.timezone }),
    user: visitUserMessage(description),
    schema: VISIT_SCHEMA,
  });
  if (reply.kind === "refused") return { kind: "refused" };
  if (reply.kind === "cut_off") return { kind: "unreadable" };
  return checkAnswer(parse(reply.text), description, request.today);
}

type Answer = { visits: { date: string; hours: number; minutes: number; quote: string }[]; unclear: string[] };

function parse(text: string): Answer {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ModelUnavailableError("The model's answer was not JSON", { cause: error });
  }
  const row = value as Partial<Answer> | null;
  if (row === null || typeof row !== "object" || !Array.isArray(row.visits) || !Array.isArray(row.unclear)) {
    throw new ModelUnavailableError("The model's answer did not follow the schema");
  }
  return { visits: row.visits, unclear: row.unclear.filter((each): each is string => typeof each === "string") };
}

function checkAnswer(answer: Answer, description: string, today: string): ReadVisitsResult {
  const words = normalize(description);
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - MAX_DAYS_BACK * DAY_MS).toISOString().slice(0, 10);
  const byDay = new Map<string, number>();
  let dropped = 0;
  for (const visit of answer.visits) {
    const minutes = isWhole(visit.hours) && isWhole(visit.minutes) && visit.minutes < 60 ? visit.hours * 60 + visit.minutes : 0;
    const grounded = typeof visit.quote === "string" && visit.quote.trim() !== "" && words.includes(normalize(visit.quote));
    if (!grounded || !isDay(visit.date) || visit.date > today || visit.date < earliest || minutes <= 0) {
      dropped += 1;
      continue;
    }
    byDay.set(visit.date, (byDay.get(visit.date) ?? 0) + minutes);
  }
  // A day that adds up to more than a day cannot be right: it is left for the caregiver.
  const unclear = [...answer.unclear.map((each) => each.trim()).filter((each) => each !== "").slice(0, 10)];
  const visits = [...byDay].filter(([, minutes]) => minutes <= MINUTES_IN_A_DAY).map(([date, minutes]) => ({ date, minutes }));
  dropped += byDay.size - visits.length;
  return { kind: "visits", visits: visits.toSorted((a, b) => a.date.localeCompare(b.date)), unclear, dropped };
}

function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
