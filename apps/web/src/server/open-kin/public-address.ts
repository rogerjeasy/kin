import { BlockList, isIP } from "node:net";

/**
 * Whether Kin may connect to an address on a stranger's say-so (a client ID
 * metadata document's host, decision 112): never this machine, a private or
 * shared network, link-local (the cloud's metadata service), documentation,
 * multicast or reserved space, and never an IPv6 address that only wraps one
 * of those IPv4 addresses (mapped, compatible, NAT64, 6to4, Teredo).
 */

const IPV4_BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  IPV4_BLOCKED.addSubnet(network, prefix, "ipv4");
}

// No rule for IPv4-mapped addresses (::ffff:0:0/96): BlockList would match every IPv4 address with one, so they are unwrapped below instead.
const IPV6_BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  IPV6_BLOCKED.addSubnet(network, prefix, "ipv6");
}

/** An IPv6 address as eight 16-bit groups, a trailing dotted IPv4 part included; `null` when it is not one. */
function hextets(address: string): number[] | null {
  let text = address.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/u.exec(text)?.[1];
  if (dotted !== undefined) {
    const parts = dotted.split(".").map(Number);
    if (parts.some((part) => part > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = parts;
    text = `${text.slice(0, -dotted.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (half: string | undefined) => (half === undefined || half === "" ? [] : half.split(":").map((group) => Number.parseInt(group, 16)));
  const head = groups(halves[0]);
  const tail = groups(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<number>(halves.length === 1 ? 0 : missing).fill(0), ...tail];
  return all.length === 8 && all.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? all : null;
}

const ipv4Of = (high: number, low: number) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

/**
 * Every IPv4 address an IPv6 address carries inside it: IPv4-mapped
 * (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4
 * (2002:AABB:CCDD::/16) and Teredo (2001::/32: the server, and the client
 * with its bits inverted).
 */
export function embeddedIPv4(address: string): string[] {
  const groups = hextets(address);
  if (groups === null) return [];
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const found: string[] = [];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) found.push(ipv4Of(g6, g7));
  if (g0 === 0x64 && g1 === 0xff9b) found.push(ipv4Of(g6, g7));
  if (g0 === 0x2002) found.push(ipv4Of(g1, g2));
  if (g0 === 0x2001 && g1 === 0) found.push(ipv4Of(g2, g3), ipv4Of(g6 ^ 0xffff, g7 ^ 0xffff));
  return found;
}

/** Whether an address is one a stranger's document may be fetched from. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !IPV4_BLOCKED.check(address, "ipv4");
  if (family !== 6) return false;
  if (embeddedIPv4(address).some((inner) => IPV4_BLOCKED.check(inner, "ipv4"))) return false;
  return !IPV6_BLOCKED.check(address, "ipv6");
}
