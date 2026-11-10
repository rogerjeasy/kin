import { fill } from "../../src/i18n/template";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The overview's heading greets by the circle's clock, so a test accepts any of the three greetings, exactly. */
export function greetingFor(greetings: Readonly<Record<"morning" | "afternoon" | "evening", string>>, name: string): RegExp {
  return new RegExp(`^(${Object.values(greetings).map((each) => escape(fill(each, { name }))).join("|")})$`, "u");
}
