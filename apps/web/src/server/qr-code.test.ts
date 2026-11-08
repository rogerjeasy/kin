import { describe, expect, it } from "vitest";

import { QR_QUIET_CELLS, QrTextError, qrCode } from "./qr-code";

describe("the QR code", () => {
  it("is a square of cells with a quiet border, drawn as one path of runs", () => {
    const code = qrCode("https://kin.example/en/c/abc");
    // Version 1 is 21 cells; the address needs a little more.
    expect(code.size).toBeGreaterThanOrEqual(21 + 2 * QR_QUIET_CELLS);
    expect(code.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });

  it("keeps every cell inside the grid, border included", () => {
    const { size, path } = qrCode("https://kin.example/fr/dashboard/shifts");
    const cells = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]), run: Number(match[3]) }));
    expect(cells.length).toBeGreaterThan(20);
    for (const { x, y, run } of cells) {
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_CELLS);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_CELLS);
      expect(x + run).toBeLessThanOrEqual(size - QR_QUIET_CELLS);
      expect(y).toBeLessThan(size - QR_QUIET_CELLS);
    }
  });

  it("makes the same code for the same text and a different one for other text", () => {
    expect(qrCode("https://kin.example/a").path).toBe(qrCode("https://kin.example/a").path);
    expect(qrCode("https://kin.example/a").path).not.toBe(qrCode("https://kin.example/b").path);
  });

  it("refuses nothing and too much", () => {
    expect(() => qrCode("")).toThrow(QrTextError);
    expect(() => qrCode("x".repeat(401))).toThrow(QrTextError);
  });
});
