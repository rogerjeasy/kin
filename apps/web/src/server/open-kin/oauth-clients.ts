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
 * redirects, two seconds to start answering and five in all (the name
 * lookup included), five kilobytes at most, and the address the check
 * approved is the one connected to. Fetches are budgeted per document host
 * and per requesting address, so slow hosts cannot crowd out other clients.
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

/** Who a client ID names. `from` is the requesting address, which may wait on one stranger's document at a time. */
export type ClientResolver = (clientId: string, from?: string) => Promise<OAuthClient | null>;

const MAX_DOCUMENT_BYTES = 5_120;
const FIRST_BYTE_MS = 2_000;
const DEADLINE_MS = 5_000;
const CACHE_MS = 10 * 60_000;
const CACHE_ENTRIES = 200;

export type FetchBudget = {
  /** Fetches from one document host at once. */
  readonly perHost: number;
  /** Fetches one requesting address may be waiting on at once. */
  readonly perRequester: number;
  /** All fetches at once on this server: a backstop, well above what the other two allow in normal use. */
  readonly total: number;
};

const DEFAULT_BUDGET: FetchBudget = { perHost: 2, perRequester: 1, total: 32 };

class DocumentError extends Error {}

type Resolved = { readonly address: string; readonly family: number };

export type FetcherOptions = {
  /** Resolves a host name. The real one asks DNS. */
  readonly resolve?: (host: string) => Promise<readonly Resolved[]>;
  /** Whether an address may be connected to. The real one allows public addresses only. */
  readonly allowed?: (address: string) => boolean;
  /** Sends the request. The real one is https. */
  readonly send?: (url: URL, options: RequestOptions, onResponse: (response: IncomingMessage) => void) => ClientRequest;
  /** How long the host may take to start answering, the name lookup included. */
  readonly firstByteMs?: number;
  /** The whole fetch's deadline. */
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

/** Reads the body of one 200 answer, no further than the size limit, saying when the answer begins. */
function readBody(url: URL, lookupPinned: LookupFunction, send: NonNullable<FetcherOptions["send"]>, signal: AbortSignal, onAnswer: () => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const outgoing = send(url, { method: "GET", lookup: lookupPinned, headers: { accept: "application/json" }, signal }, (response) => {
      onAnswer();
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
 * A fetcher of client ID metadata documents. Two deadlines cover the whole
 * fetch: the host must start answering within two seconds of the start (its
 * name lookup included), and finish within five, so a host that is slow to
 * start, or drips its body a byte at a time, is cut off.
 */
export function documentFetcher(options: FetcherOptions = {}): FetchDocument {
  const resolve = options.resolve ?? resolveWithDns;
  const allowed = options.allowed ?? isPublicAddress;
  const send = options.send ?? ((url, requestOptions, onResponse) => httpsRequest(url, requestOptions, onResponse));
  const firstByteMs = options.firstByteMs ?? FIRST_BYTE_MS;
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  return async (url) => {
    const controller = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let answered = false;
    const cutOff = new Promise<never>((_resolve, reject) => {
      const stop = (why: string) => {
        controller.abort();
        reject(new DocumentError(why));
      };
      timers.push(setTimeout(() => stop("deadline"), deadlineMs));
      timers.push(
        setTimeout(() => {
          if (!answered) stop("slow to answer");
        }, firstByteMs),
      );
    });
    const fetchOnce = async () => {
      const addresses = await resolve(url.hostname);
      const [chosen] = addresses;
      if (chosen === undefined || !addresses.every((each) => allowed(each.address))) throw new DocumentError("not a public host");
      return JSON.parse(await readBody(url, pinned(chosen), send, controller.signal, () => (answered = true))) as unknown;
    };
    try {
      return await Promise.race([fetchOnce(), cutOff]);
    } finally {
      for (const timer of timers) clearTimeout(timer);
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

/** Counts what is in flight per key, and frees a slot when its fetch ends. */
function counter() {
  const counts = new Map<string, number>();
  return {
    of: (key: string) => counts.get(key) ?? 0,
    add: (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1),
    remove: (key: string) => {
      const left = (counts.get(key) ?? 1) - 1;
      if (left <= 0) counts.delete(key);
      else counts.set(key, left);
    },
  };
}

/**
 * The resolver the routes use. `signingKey` signs registered clients' IDs;
 * without one, only metadata-document clients are known. A document is
 * fetched once however many requests name it at the same moment; a new fetch
 * starts only while its host, the requesting address and the server are all
 * within budget (otherwise the client is unknown for now, and nothing is
 * cached against it); each document is cached ten minutes, so a consent
 * screen and its answer read the same one.
 */
export function clientResolver(signingKey: string | null, fetchDocument: FetchDocument = fetchClientDocument, now: () => number = Date.now, budget: FetchBudget = DEFAULT_BUDGET): ClientResolver {
  const key = signingKey === null ? null : clientRegistrationKey(signingKey);
  const cache = new Map<string, { readonly at: number; readonly client: OAuthClient | null }>();
  const inFlight = new Map<string, Promise<OAuthClient | null>>();
  const perHost = counter();
  const perRequester = counter();

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

  return async (clientId, from = "unknown") => {
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
    if (perHost.of(url.hostname) >= budget.perHost || perRequester.of(from) >= budget.perRequester || inFlight.size >= budget.total) return null;
    perHost.add(url.hostname);
    perRequester.add(from);
    const started = fetchClient(url).finally(() => {
      inFlight.delete(clientId);
      perHost.remove(url.hostname);
      perRequester.remove(from);
    });
    inFlight.set(clientId, started);
    return started;
  };
}
