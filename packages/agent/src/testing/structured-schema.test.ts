import { describe, expect, it } from "vitest";

import { refusedSchemaKeywords } from "./structured-schema.ts";

describe("what structured output refuses in a schema", () => {
  it("finds length, number and list limits wherever they sit, and an object left open", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        items: { type: "array", maxItems: 8, minItems: 2, items: { type: "object", properties: { name: { type: "string", maxLength: 80 } } } },
        cents: { type: "integer", minimum: 0 },
      },
    };
    expect(refusedSchemaKeywords(schema)).toEqual([
      "$.properties.items.maxItems",
      "$.properties.items.minItems",
      "$.properties.items.items.additionalProperties",
      "$.properties.items.items.properties.name.maxLength",
      "$.properties.cents.minimum",
    ]);
  });

  it("lets through what it accepts, and a property merely named like a keyword", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["maximum"],
      properties: { maximum: { type: ["string", "null"], enum: ["a", "b", null] }, list: { type: "array", minItems: 1, items: { type: "string", format: "date" } } },
    };
    expect(refusedSchemaKeywords(schema)).toEqual([]);
  });
});
