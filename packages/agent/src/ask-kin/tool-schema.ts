/**
 * The small part of JSON Schema a tool's input may use. One definition is both
 * what the model is shown and what the gateway checks the model's arguments
 * against, so the two can never disagree.
 */
export type StringProperty = {
  readonly type: "string";
  readonly description: string;
  readonly maxLength: number;
  readonly pattern?: string;
  readonly enum?: readonly string[];
};

export type IntegerProperty = { readonly type: "integer"; readonly description: string; readonly minimum: number; readonly maximum: number };

export type ToolProperty = StringProperty | IntegerProperty;

export type ObjectSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolProperty>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

type ValueOf<P extends ToolProperty> = P extends IntegerProperty ? number : string;

/** The arguments a schema accepts, as a typed object: required keys present, the others optional. */
export type ArgsOf<S extends ObjectSchema> = {
  readonly [K in keyof S["properties"] as K extends S["required"][number] ? K : never]: ValueOf<S["properties"][K]>;
} & {
  readonly [K in keyof S["properties"] as K extends S["required"][number] ? never : K]?: ValueOf<S["properties"][K]>;
};

export type ToolArgs = Readonly<Record<string, string | number>>;

function validProperty(property: ToolProperty, value: unknown): boolean {
  if (property.type === "integer") return typeof value === "number" && Number.isSafeInteger(value) && value >= property.minimum && value <= property.maximum;
  if (typeof value !== "string" || value.length > property.maxLength) return false;
  if (property.enum !== undefined && !property.enum.includes(value)) return false;
  return property.pattern === undefined || new RegExp(property.pattern, "u").test(value);
}

/**
 * The arguments, if they follow the schema exactly: an object with only the
 * listed keys, every required one present, each of the right type and size.
 * Anything else is refused whole; nothing is coerced or trimmed into shape.
 */
export function parseArgs(schema: ObjectSchema, input: unknown): ToolArgs | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.some(([key]) => !Object.hasOwn(schema.properties, key))) return null;
  if (schema.required.some((key) => !Object.hasOwn(input, key))) return null;
  for (const [key, value] of entries) {
    const property = schema.properties[key];
    if (property === undefined || !validProperty(property, value)) return null;
  }
  return Object.fromEntries(entries) as ToolArgs;
}
