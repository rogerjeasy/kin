/** Fills each `{name}` in fixed words with its value. A blank with no value throws: a sentence is never spoken half empty. */
export const fillTemplate = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for {${name}} in "${template}"`);
    return value;
  });
