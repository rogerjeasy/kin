import qrcode from "qrcode-generator";

/** A QR code as one SVG path on a grid of `size` by `size` cells, ready to draw with no markup from outside. */
export type QrCode = { readonly size: number; readonly path: string };

/** Cells of white around the code. The standard asks for four, and a scanner needs them. */
export const QR_QUIET_CELLS = 4;
const MAX_QR_CHARS = 400;

/** The text cannot be a QR code Kin would print or show. */
export class QrTextError extends Error {
  readonly retryable = false;

  constructor() {
    super("The text is empty or too long for a QR code");
    this.name = "QrTextError";
  }
}

/**
 * Makes a QR code on the server, so the browser never loads the generator and
 * the address (which can hold a secret) is never put in a URL to be fetched.
 * Medium error correction: a scuffed print or a glare on a phone still reads.
 * Dark cells are drawn as runs, so the path stays short.
 */
export function qrCode(text: string): QrCode {
  if (text === "" || text.length > MAX_QR_CHARS) throw new QrTextError();
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const modules = code.getModuleCount();
  const runs: string[] = [];
  for (let row = 0; row < modules; row += 1) {
    let column = 0;
    while (column < modules) {
      if (!code.isDark(row, column)) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < modules && code.isDark(row, column)) column += 1;
      runs.push(`M${start + QR_QUIET_CELLS} ${row + QR_QUIET_CELLS}h${column - start}v1h-${column - start}z`);
    }
  }
  return { size: modules + 2 * QR_QUIET_CELLS, path: runs.join("") };
}
