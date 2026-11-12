import { clientRegistrationKey, isRegisteredClientId, parseClientIdUrl, parseClientMetadata, readClientRegistration } from "@kin/auth";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Who an OAuth client is (decision 111). A client Kin registered carries its
 * name and redirect URIs in its signed ID. A client that names itself by an
 * https URL (a client ID metadata document, which the MCP specification
 * prefers) is read from that URL, carefully: Kin fetches a stranger's
 * address, so only a public host, only https on the usual port, no
 * redirects, five seconds and five kilobytes at most, and the address the
 * check approved is the one connected to.
 */

export type OAuthClient = {
  readonly clientId: string;
  /** The name the client gives itself. Nobody vouches for it, and the consent screen says so. */
  readonly name: string | null;
  readonly redirectUris: readonly string[];
  /** For a metadata document, the host that published it; the consent screen shows it beside the name. */
  readonly documentHost: string | null;
};

export type FetchDocument = (url: URL) => Promise<unknown>;

export type ClientResolver = (clientId: string) => Promise<OAuthClient | null>;

const MAX_DOCUMENT_BYTES = 5_120;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_MS = 10 * 60_000;
const CACHE_ENTRIES = 200;

/** Addresses no metadata document may live at: this machine, private networks, link-local (the cloud's metadata service) and anything not routable. */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // No rule for IPv4-mapped addresses (::ffff:0:0/96): BlockList checks them against the IPv4 rules above, and such a rule would match every IPv4 address.
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

/** Whether an address is one a stranger's document may be fetched from. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

class DocumentError extends Error {}

/** Resolves the host once, refuses it if any address is not public, and returns a lookup that connects to the checked address only. */
async function pinnedLookup(host: string): Promise<LookupFunction> {
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || !addresses.every((each) => isPublicAddress(each.address))) throw new DocumentError("not a public host");
  const [chosen] = addresses;
  if (chosen === undefined) throw new DocumentError("no address");
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) callback(null, [{ address: chosen.address, family: chosen.family }]);
    else callback(null, chosen.address, chosen.family);
  };
}

/** Fetches a client ID metadata document from a public host, or throws. */
export const fetchClientDocument: FetchDocument = async (url) => {
  const lookupPinned = await pinnedLookup(url.hostname);
  const body = await new Promise<string>((resolve, reject) => {
    const outgoing = httpsRequest(url, { method: "GET", lookup: lookupPinned, headers: { accept: "application/json" }, timeout: FETCH_TIMEOUT_MS }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new DocumentError(`status ${String(response.statusCode)}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES) {
          outgoing.destroy(new DocumentError("too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", reject);
    });
    outgoing.on("timeout", () => outgoing.destroy(new DocumentError("timeout")));
    outgoing.on("error", reject);
    outgoing.end();
  });
  return JSON.parse(body) as unknown;
};

/** Reads a client ID metadata document into a client, or `null` when it is not one Kin can trust (the draft's section 4). */
export function clientFromDocument(url: URL, document: unknown): OAuthClient | null {
  if (typeof document !== "object" || document === null || (document as Record<string, unknown>)["client_id"] !== url.href) return null;
  const metadata = parseClientMetadata(document, "document");
  if (!metadata.ok) return null;
  return { clientId: url.href, name: metadata.name, redirectUris: metadata.redirectUris, documentHost: url.host };
}

/**
 * The resolver the routes use. `signingKey` signs registered clients' IDs;
 * without one, only metadata-document clients are known. Documents are
 * cached ten minutes, so a consent screen and its answer read the same one.
 */
export function clientResolver(signingKey: string | null, fetchDocument: FetchDocument = fetchClientDocument, now: () => number = Date.now): ClientResolver {
  const key = signingKey === null ? null : clientRegistrationKey(signingKey);
  const cache = new Map<string, { readonly at: number; readonly client: OAuthClient | null }>();
  return async (clientId) => {
    if (isRegisteredClientId(clientId)) {
      const registration = key === null ? null : readClientRegistration(key, clientId);
      return registration === null ? null : { clientId, name: registration.name, redirectUris: registration.redirectUris, documentHost: null };
    }
    const url = parseClientIdUrl(clientId);
    if (url === null) return null;
    const cached = cache.get(clientId);
    if (cached !== undefined && now() - cached.at < CACHE_MS) return cached.client;
    let client: OAuthClient | null;
    try {
      client = clientFromDocument(url, await fetchDocument(url));
    } catch {
      // Unreachable, private, too slow, too large or not JSON: an unknown client, and nothing about why.
      client = null;
    }
    if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value ?? "");
    cache.set(clientId, { at: now(), client });
    return client;
  };
}
