import { ConfigError } from "@kin/config";
import { isOfficeLocale, type OfficeLocale } from "@kin/telephony";

/** The settings of the office line. Secrets come from the environment, which the task fills from Secrets Manager. */
export const VOICE_ENV = {
  numbers: "KIN_OFFICE_LINE_NUMBERS",
  authToken: "KIN_TWILIO_AUTH_TOKEN",
  stateKey: "KIN_VOICE_STATE_KEY",
  publicUrl: "KIN_VOICE_PUBLIC_URL",
  port: "PORT",
} as const;

/** What a dialled number stands for: the one circle it answers for, and the language of the call. */
export type LineTarget = { readonly circleId: string; readonly locale: OfficeLocale };

export type VoiceConfig = {
  /**
   * Dialled number in E.164 form, to the circle behind it. The only thing that picks a circle on the office
   * line. Empty when `KIN_OFFICE_LINE_NUMBERS` is unset: every inbound call then hears the fixed "no record"
   * answer, and the shift-call routes (which take their circle from a sealed token) work as usual.
   */
  readonly numbers: ReadonlyMap<string, LineTarget>;
  /** Twilio's auth token: signs every webhook Twilio sends. */
  readonly authToken: string;
  /** Seals the state carried between turns. Not Twilio's token, so neither leak reveals the other. */
  readonly stateKey: string;
  /** The address Twilio calls, with no trailing slash. Twilio signs the URL it called, so Kin must rebuild exactly that. */
  readonly publicUrl: string;
  readonly port: number;
};

type Env = Readonly<Record<string, string | undefined>>;

const E164 = /^\+[1-9][0-9]{6,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_AUTH_TOKEN_CHARS = 16;
const MIN_STATE_KEY_CHARS = 32;
const DEFAULT_PORT = 4200;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Reads `{"+15551234567": "<circle uuid>"}`, where a value may also be
 * `{"circleId": "<uuid>", "locale": "fr"}` to answer in another language than
 * English. Anything else refuses to start: a wrong line must not take calls.
 */
export function readLineNumbers(text: string): ReadonlyMap<string, LineTarget> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigError(`${VOICE_ENV.numbers} is not JSON`);
  }
  if (!isObject(parsed) || Object.keys(parsed).length === 0) throw new ConfigError(`${VOICE_ENV.numbers} must map phone numbers to circles`);
  const numbers = new Map<string, LineTarget>();
  for (const [number, value] of Object.entries(parsed)) {
    if (!E164.test(number)) throw new ConfigError(`${VOICE_ENV.numbers} holds a number that is not in E.164 form`);
    numbers.set(number, readTarget(value));
  }
  const circles = [...numbers.values()].map((target) => target.circleId.toLowerCase());
  if (new Set(circles).size !== circles.length) throw new ConfigError(`${VOICE_ENV.numbers} gives one circle two numbers`);
  return numbers;
}

function readTarget(value: unknown): LineTarget {
  if (typeof value === "string") return readTarget({ circleId: value });
  if (!isObject(value) || !Object.keys(value).every((key) => key === "circleId" || key === "locale")) throw new ConfigError(`${VOICE_ENV.numbers} holds a circle it cannot read`);
  const { circleId, locale = "en" } = value;
  if (typeof circleId !== "string" || !UUID.test(circleId)) throw new ConfigError(`${VOICE_ENV.numbers} holds a circle ID that is not a UUID`);
  if (typeof locale !== "string" || !isOfficeLocale(locale)) throw new ConfigError(`${VOICE_ENV.numbers} names a language Kin does not speak`);
  return { circleId: circleId.toLowerCase(), locale };
}

/**
 * The office line is a separate feature from Kin's call about a shift, so the service starts without it:
 * unset, or blank as an empty line of a `.env` file is, means no numbers. A value that is set is read
 * exactly as before, so an empty object or a malformed value still refuses to start.
 */
function readOfficeLine(text: string | undefined): ReadonlyMap<string, LineTarget> {
  if (text === undefined || text.trim() === "") return new Map();
  return readLineNumbers(text);
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is not set`);
  return value;
}

export function readVoiceConfig(env: Env): VoiceConfig {
  const authToken = required(env, VOICE_ENV.authToken);
  const stateKey = required(env, VOICE_ENV.stateKey);
  if (authToken.length < MIN_AUTH_TOKEN_CHARS) throw new ConfigError(`${VOICE_ENV.authToken} is too short to be Twilio's`);
  if (stateKey.length < MIN_STATE_KEY_CHARS) throw new ConfigError(`${VOICE_ENV.stateKey} must be at least ${MIN_STATE_KEY_CHARS} characters`);
  if (stateKey === authToken) throw new ConfigError(`${VOICE_ENV.stateKey} must differ from ${VOICE_ENV.authToken}`);
  const publicUrl = required(env, VOICE_ENV.publicUrl).replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/?#]+$/.test(publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl)) {
    throw new ConfigError(`${VOICE_ENV.publicUrl} must be the https address Twilio calls, with no path`);
  }
  const port = env[VOICE_ENV.port]?.trim() ? Number(env[VOICE_ENV.port]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new ConfigError(`${VOICE_ENV.port} is not a port`);
  return { numbers: readOfficeLine(env[VOICE_ENV.numbers]), authToken, stateKey, publicUrl, port };
}
