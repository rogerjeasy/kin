import { describe, expect, it } from "vitest";

import { csvCell, csvRow, defuseFormula } from "./csv-cell.ts";

describe("defuseFormula", () => {
  it.each(["=SUM(A1)", "+1", "-2", "@cmd", "\tTab", "\rReturn"])("writes %j as text, not a formula", (value) => {
    expect(defuseFormula(value)).toBe(`'${value}`);
  });

  it("leaves ordinary text and plain amounts alone", () => {
    expect(defuseFormula("Marcus’s contribution")).toBe("Marcus’s contribution");
    expect(defuseFormula("409.13")).toBe("409.13");
  });
});

describe("csvCell", () => {
  it("quotes a cell with a comma, a quote or a line break, and doubles the quotes", () => {
    expect(csvCell("Gas, water")).toBe('"Gas, water"');
    expect(csvCell('Rose said "hi"')).toBe('"Rose said ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  it("keeps right-to-left text whole", () => {
    expect(csvCell("مساهمة ماركوس")).toBe("مساهمة ماركوس");
    expect(csvCell("תרומה, של מרקוס")).toBe('"תרומה, של מרקוס"');
  });

  it("defuses a formula before it quotes", () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });
});

describe("csvRow", () => {
  it("joins cells with commas", () => {
    expect(csvRow(["a", "b,c", ""])).toBe('a,"b,c",');
  });
});
