/**
 * What Claude's structured output refuses in a schema (the API answers 400, so
 * every real call fails while a fake would pass). Limits such as a list's
 * length belong in the code that parses the answer, not in the schema.
 */
const REFUSED_KEYWORDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "uniqueItems"] as const;

/** Every keyword in `schema` that structured output refuses, as a path to it. Empty when the schema may be sent. */
export function refusedSchemaKeywords(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((each, index) => refusedSchemaKeywords(each, `${path}[${index}]`));
  if (schema === null || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const found: string[] = REFUSED_KEYWORDS.filter((keyword) => keyword in node).map((keyword) => `${path}.${keyword}`);
  if (typeof node["minItems"] === "number" && node["minItems"] > 1) found.push(`${path}.minItems`);
  const isObject = node["type"] === "object" || (Array.isArray(node["type"]) && node["type"].includes("object"));
  if (isObject && node["additionalProperties"] !== false) found.push(`${path}.additionalProperties`);
  for (const [key, value] of Object.entries(node)) {
    // An object's property names are names, not keywords: a property called "maximum" is fine.
    if (key === "properties" && value !== null && typeof value === "object") {
      for (const [name, property] of Object.entries(value)) found.push(...refusedSchemaKeywords(property, `${path}.properties.${name}`));
    } else if (typeof value === "object") {
      found.push(...refusedSchemaKeywords(value, `${path}.${key}`));
    }
  }
  return found;
}
