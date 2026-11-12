import { clientRegistrationKey, isRegisteredClientId, parseClientIdUrl, parseClientMetadata, readClientRegistration } from "@kin/auth";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import { isPublicAddress } from "./public-address";

/**
 * Who an OAuth client is (decision 112). A client Kin registered carries its
 * name and redirect URIs in its signed ID. A client that names itself by an
 * https URL (a client ID metadata document, which the MCP specification
 * prefers) is read from that URL, carefully: Kin fetches a stranger's
 * address, so only a public host, only https on the usual port, no
 * redirects, five seconds in all (the name lookup included) and five
 * kilobytes at most, the address the check approved is the one connected
 * to, one fetch at a time per client and a few at a time per server.
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
const DEADLINE_MS = 5_000;
const CACHE_MS = 10 * 60_000;
const CACHE_ENTRIES = 200;
/** At most this many documents are being fetched at once by this server; beyond it a client is, for now, unknown. */
const MAX_CONCURRENT_FETCHES = 8;

class DocumentError extends Error {}

type Resolved = { readonly address: string; readonly family: number };

export type FetcherOptions = {
  /** Resolves a host name. The real one asks DNS. */
  readonly resolve?: (host: string) => Promise<readonly Resolved[]>;
  /** Whether an address may be connected to. The real one allows public addresses only. */
  readonly allowed?: (address: string) => boolean;
  /** Sends the request. The real one is https. */
  readonly send?: (url: URL, options: RequestOptions, onResponse: (response: IncomingMessage) => void) => ClientRequest;
  /** The whole fetch's deadline, the name lookup included. */
  readonly deadlineMs?: number;
};

const resolveWithDns = (host: string) => lookup(host, { all: true, verbatim: true });

/** A lookup that answers with the address already checked, so the connection goes where the check approved (no DNS rebinding). */
const pinned =
  (chosen: Resolved): LookupFunction =>
  (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) callback(null, [{ address: chosen.address, family: chosen.family }]);
    else callback(null, chosen.address, chosen.family);
  };

/** Reads the body of one 200 answer, no further than the size limit. */
function readBody(url: URL, lookupPinned: LookupFunction, send: NonNullable<FetcherOptions["send"]>, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const outgoing = send(url, { method: "GET", lookup: lookupPinned, headers: { accept: "application/json" }, signal }, (response) => {
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
          reject(new DocumentError("too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/**
 * A fetcher of client ID metadata documents. One deadline covers the whole
 * fetch: a host that answers its name slowly, or drips its body a byte at a
 * time, is cut off when it passes, not each time it goes quiet.
 */
export function documentFetcher(options: FetcherOptions = {}): FetchDocument {
  const resolve = options.resolve ?? resolveWithDns;
  const allowed = options.allowed ?? isPublicAddress;
  const send = options.send ?? ((url, requestOptions, onResponse) => httpsRequest(url, requestOptions, onResponse));
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  return async (url) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DocumentError("deadline"));
      }, deadlineMs);
    });
    const fetchOnce = async () => {
      const addresses = await resolve(url.hostname);
      const [chosen] = addresses;
      if (chosen === undefined || !addresses.every((each) => allowed(each.address))) throw new DocumentError("not a public host");
      return JSON.parse(await readBody(url, pinned(chosen), send, controller.signal)) as unknown;
    };
    try {
      return await Promise.race([fetchOnce(), deadline]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

/** Fetches a client ID metadata document from a public host, or throws. */
export const fetchClientDocument: FetchDocument = documentFetcher();

/** Reads a client ID metadata document into a client, or `null` when it is not one Kin can trust (the draft's section 4). */
export function clientFromDocument(url: URL, document: unknown): OAuthClient | null {
  if (typeof document !== "object" || document === null || (document as Record<string, unknown>)["client_id"] !== url.href) return null;
  const metadata = parseClientMetadata(document, "document");
  if (!metadata.ok) return null;
  return { clientId: url.href, name: metadata.name, redirectUris: metadata.redirectUris, documentHost: url.host };
}

/**
 * The resolver the routes use. `signingKey` signs registered clients' IDs;
 * without one, only metadata-document clients are known. A document is
 * fetched once however many requests name it at the same moment, at most a
 * few documents are fetched at once, and each is cached ten minutes, so a
 * consent screen and its answer read the same one.
 */
export function clientResolver(signingKey: string | null, fetchDocument: FetchDocument = fetchClientDocument, now: () => number = Date.now, maxConcurrent = MAX_CONCURRENT_FETCHES): ClientResolver {
  const key = signingKey === null ? null : clientRegistrationKey(signingKey);
  const cache = new Map<string, { readonly at: number; readonly client: OAuthClient | null }>();
  const inFlight = new Map<string, Promise<OAuthClient | null>>();

  const fetchClient = async (url: URL): Promise<OAuthClient | null> => {
    let client: OAuthClient | null;
    try {
      client = clientFromDocument(url, await fetchDocument(url));
    } catch {
      // Unreachable, private, too slow, too large or not JSON: an unknown client, and nothing about why.
      client = null;
    }
    if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value ?? "");
    cache.set(url.href, { at: now(), client });
    return client;
  };

  return async (clientId) => {
    if (isRegisteredClientId(clientId)) {
      const registration = key === null ? null : readClientRegistration(key, clientId);
      return registration === null ? null : { clientId, name: registration.name, redirectUris: registration.redirectUris, documentHost: null };
    }
    const url = parseClientIdUrl(clientId);
    if (url === null) return null;
    const cached = cache.get(clientId);
    if (cached !== undefined && now() - cached.at < CACHE_MS) return cached.client;
    const running = inFlight.get(clientId);
    if (running !== undefined) return running;
    // Too many strangers' documents at once: this one is unknown for now, and nothing is cached, so a later try can succeed.
    if (inFlight.size >= maxConcurrent) return null;
    const started = fetchClient(url).finally(() => inFlight.delete(clientId));
    inFlight.set(clientId, started);
    return started;
  };
}
