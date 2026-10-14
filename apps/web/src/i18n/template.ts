export type TemplatePart =
  | { kind: "text"; text: string }
  | { kind: "slot"; name: string };

/** A translated sentence names a slot that the caller gave no value for. */
export class MissingTemplateValueError extends Error {
  readonly retryable = false;

  constructor(slot: string, template: string) {
    super(`No value for {${slot}} in "${template}"`);
    this.name = "MissingTemplateValueError";
  }
}

const slotPattern = /\{(\w+)\}/g;

/** Splits "Paid {amount}." into text and named slots, in reading order. */
export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let cursor = 0;
  for (const match of template.matchAll(slotPattern)) {
    const [whole, name = ""] = match;
    if (match.index > cursor) {
      parts.push({ kind: "text", text: template.slice(cursor, match.index) });
    }
    parts.push({ kind: "slot", name });
    cursor = match.index + whole.length;
  }
  if (cursor < template.length) {
    parts.push({ kind: "text", text: template.slice(cursor) });
  }
  return parts;
}

export function fill(template: string, values: Record<string, string>): string {
  return parseTemplate(template)
    .map((part) => {
      if (part.kind === "text") {
        return part.text;
      }
      const value = values[part.name];
      if (value === undefined) {
        throw new MissingTemplateValueError(part.name, template);
      }
      return value;
    })
    .join("");
}

export function slotsOf(template: string): string[] {
  const names = parseTemplate(template).flatMap((part) =>
    part.kind === "slot" ? [part.name] : [],
  );
  return [...new Set(names)].sort();
}
