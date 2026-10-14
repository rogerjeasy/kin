import { describe, expect, it } from "vitest";

import { getDictionary } from "./dictionary";
import { defaultLocale, locales } from "./locales";
import { slotsOf } from "./template";

type Shape = string | Shape[] | { [key: string]: Shape };

// What a translation must keep: the same keys, the same list lengths, the same
// slots in each sentence, and text wherever English has text.
function shapeOf(value: unknown): Shape {
  if (typeof value === "string") {
    return `${value === "" ? "empty" : "text"}:${slotsOf(value).join(",")}`;
  }
  if (Array.isArray(value)) {
    return value.map(shapeOf);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, shapeOf(child)]),
    );
  }
  throw new Error(`A dictionary holds only text, lists and groups, got ${typeof value}`);
}

describe.each(locales)("the %s dictionary", (locale) => {
  it("has exactly the structure of the English one", async () => {
    const english = await getDictionary(defaultLocale);
    const translated = await getDictionary(locale);

    expect(shapeOf(translated)).toEqual(shapeOf(english));
  });
});
