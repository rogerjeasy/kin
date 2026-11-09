/** Why a ZIP could not be written. Retrying cannot help: the input has to change. */
export class ZipError extends Error {
  readonly retryable = false;
  readonly reason: "unsafe_name" | "duplicate_name" | "too_large" | "bad_date";

  constructor(reason: ZipError["reason"], detail: string) {
    super(`ZIP not written: ${detail}`);
    this.name = "ZipError";
    this.reason = reason;
  }
}

export type ZipFile = { readonly name: string; readonly data: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, the one ZIP uses) of the bytes, as an unsigned number. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** UTF-8 by hand, so the writer needs no runtime library. A lone surrogate becomes U+FFFD. */
function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let code = char.codePointAt(0) ?? 0xfffd;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(bytes);
}

/** A name that stays inside the archive: relative, forward slashes, no `..` segment, no control characters. */
function checkName(name: string): void {
  const hasControl = [...name].some((char) => (char.codePointAt(0) ?? 0) < 0x20 || char === "\u007f");
  const unsafe = name === "" || name.startsWith("/") || name.includes("\\") || hasControl || name.split("/").some((segment) => segment === "..");
  if (unsafe) throw new ZipError("unsafe_name", "an entry name is empty, absolute, uses a backslash or control character, or climbs out with '..'");
}

/** MS-DOS time and date words from a UTC date; DOS counts seconds in twos and years from 1980. */
function dosStamp(date: Date): { time: number; date: number } {
  const year = date.getUTCFullYear();
  if (!(year >= 1980 && year <= 2107)) throw new ZipError("bad_date", "ZIP dates run from 1980 to 2107");
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
// Bit 11: the names are UTF-8.
const UTF8_NAMES = 0x0800;
const VERSION_NEEDED = 20;

/**
 * A ZIP archive with every file stored, not compressed (the records are
 * already compact, and stored entries keep the writer to a few dozen lines).
 * Names are UTF-8 with the language-encoding flag, and every entry carries
 * `modified` (UTC), so the same input is always the same bytes. There is no
 * ZIP64: more than 65,535 entries or 4 GiB is refused.
 */
export function zipStore(files: readonly ZipFile[], modified: Date): Uint8Array {
  if (files.length > MAX_16) throw new ZipError("too_large", "more than 65,535 entries");
  const stamp = dosStamp(modified);
  const seen = new Set<string>();
  const entries = files.map((file) => {
    checkName(file.name);
    if (seen.has(file.name)) throw new ZipError("duplicate_name", "two entries share a name");
    seen.add(file.name);
    return { name: utf8(file.name), data: file.data, crc: crc32(file.data) };
  });

  let size = END_RECORD;
  for (const entry of entries) size += LOCAL_HEADER + CENTRAL_HEADER + 2 * entry.name.length + entry.data.length;
  if (size > MAX_32) throw new ZipError("too_large", "more than 4 GiB");

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (value: number): void => {
    view.setUint16(at, value, true);
    at += 2;
  };
  const u32 = (value: number): void => {
    view.setUint32(at, value, true);
    at += 4;
  };
  const bytes = (data: Uint8Array): void => {
    out.set(data, at);
    at += data.length;
  };

  const offsets: number[] = [];
  for (const entry of entries) {
    offsets.push(at);
    u32(0x04034b50);
    u16(VERSION_NEEDED);
    u16(UTF8_NAMES);
    u16(0); // stored
    u16(stamp.time);
    u16(stamp.date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0);
    bytes(entry.name);
    bytes(entry.data);
  }
  const directory = at;
  entries.forEach((entry, index) => {
    u32(0x02014b50);
    u16(VERSION_NEEDED); // made by
    u16(VERSION_NEEDED);
    u16(UTF8_NAMES);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[index] ?? 0);
    bytes(entry.name);
  });
  const directorySize = at - directory;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(directorySize);
  u32(directory);
  u16(0);
  return out;
}
