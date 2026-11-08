const BYTE_ORDER_MARK = "﻿";

/** CSV text with the mark that makes Excel read it as UTF-8, so accents and Arabic and Hebrew survive. */
export function withByteOrderMark(csv: string): string {
  return csv.startsWith(BYTE_ORDER_MARK) ? csv : `${BYTE_ORDER_MARK}${csv}`;
}

/** Hands the browser a CSV file to save. The file is built in the page from rows the person already sees. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([withByteOrderMark(csv)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the time the task ends; the address can go.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
