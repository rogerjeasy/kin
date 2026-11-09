import { describe, expect, it } from "vitest";

import { hasTool, runOn } from "./testing/external-tools.ts";
import { ZipError, crc32, zipStore } from "./zip.ts";

const text = (value: string) => Uint8Array.from([...value].map((char) => char.charCodeAt(0)));
const modified = new Date("2026-11-09T14:30:08Z");
const files = [
  { name: "README.txt", data: text("Records for the attorney.\n") },
  { name: "records/payouts.csv", data: text("date,amount\n2026-10-01,264.00\n") },
  { name: "records/Café Müller – note.txt", data: text("utf-8 name") },
  { name: "empty.txt", data: new Uint8Array(0) },
];

describe("CRC-32", () => {
  it("is the standard check value for 123456789", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("a stored ZIP", () => {
  it("has the local, central and end records in order, with the stored method and the UTF-8 flag", () => {
    const zip = zipStore(files, modified);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x0800);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(files.length);
    const directory = view.getUint32(zip.length - 6, true);
    expect(view.getUint32(directory, true)).toBe(0x02014b50);
    expect(view.getUint32(directory + 16, true)).toBe(crc32(files[0]?.data ?? new Uint8Array(0)));
  });

  it("writes the given time as a DOS date, in UTC and in twos of seconds", () => {
    const view = new DataView(zipStore(files, modified).buffer);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (30 << 5) | 4);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 9);
  });

  it("is the same bytes for the same input", () => {
    expect(zipStore(files, modified)).toEqual(zipStore(files.map((file) => ({ ...file })), new Date(modified)));
  });

  it("refuses names that could escape the folder it is unpacked into, and repeated names", () => {
    for (const name of ["../x.txt", "a/../x.txt", "/etc/passwd", "a\\b.txt", "", "a\u0000b", "records/.."]) {
      expect(() => zipStore([{ name, data: text("x") }], modified), name).toThrow(ZipError);
    }
    expect(() => zipStore([files[0] ?? { name: "a", data: text("") }, files[0] ?? { name: "a", data: text("") }], modified)).toThrow(expect.objectContaining({ reason: "duplicate_name" }));
    expect(() => zipStore(files, new Date("1979-12-31T00:00:00Z"))).toThrow(expect.objectContaining({ reason: "bad_date" }));
  });

  it("allows a file name that merely contains two dots", () => {
    expect(() => zipStore([{ name: "report..final.txt", data: text("x") }], modified)).not.toThrow();
  });

  it.skipIf(!hasTool("unzip", ["-v"]))("passes unzip -t and lists every name", () => {
    const zip = zipStore(files, modified);
    const test = runOn(zip, "packet.zip", "unzip", (path) => ["-t", path]);
    expect(test.status, test.stdout + test.stderr).toBe(0);
    expect(test.stdout).toContain("No errors detected");
  });

  it.skipIf(!hasTool("python3", ["--version"]))("is read back by Python's zipfile, names and contents intact", () => {
    const script = "import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({'bad':z.testzip(),'files':{n:z.read(n).decode() for n in z.namelist()},'method':[i.compress_type for i in z.infolist()],'time':list(z.infolist()[0].date_time)}))";
    const result = runOn(zipStore(files, modified), "packet.zip", "python3", (path) => ["-I", "-c", script, path]);
    expect(result.status, result.stderr).toBe(0);
    const read = JSON.parse(result.stdout) as { bad: string | null; files: Record<string, string>; method: number[]; time: number[] };
    expect(read.bad).toBeNull();
    expect(read.method).toEqual([0, 0, 0, 0]);
    expect(read.time).toEqual([2026, 11, 9, 14, 30, 8]);
    expect(read.files["records/Café Müller – note.txt"]).toBe("utf-8 name");
    expect(read.files["README.txt"]).toBe("Records for the attorney.\n");
    expect(read.files["empty.txt"]).toBe("");
  });
});
