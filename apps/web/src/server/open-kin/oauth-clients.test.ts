import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { clientResolver, documentFetcher } from "./oauth-clients";
import { embeddedIPv4, isPublicAddress } from "./public-address";

/**
 * Fetching a stranger's client ID metadata document (decision 112): which
 * addresses Kin may connect to, the one deadline over the whole fetch, the
 * size limit, and how many fetches run at once.
 */

const KEY = "a server signing key of at least thirty-two characters";
const DOCUMENT_ID = "https://app.example/oauth/client.json";
const document = { client_id: DOCUMENT_ID, client_name: "Example", redirect_uris: ["http://127.0.0.1:3000/callback"] };

describe("the addresses a document may be fetched from", () => {
  it.each([
    ["this machine", "127.0.0.1"],
    ["the unspecified address", "0.0.0.0"],
    ["a private network", "10.1.2.3"],
    ["a private network", "172.20.0.1"],
    ["a private network", "192.168.1.1"],
    ["the cloud's metadata service", "169.254.169.254"],
    ["shared address space", "100.64.0.1"],
    ["benchmarking", "198.18.0.1"],
    ["6to4 relay anycast", "192.88.99.1"],
    ["multicast", "224.0.0.1"],
    ["reserved", "240.0.0.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unspecified", "::"],
    ["IPv4-compatible", "::a00:1"],
    ["IPv4-compatible, public inside", "::5db8:d822"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped metadata service, hex", "::ffff:a9fe:a9fe"],
    ["IPv4-mapped, public inside: outside global unicast", "::ffff:93.184.216.34"],
    ["IPv4-translated loopback", "::ffff:0:127.0.0.1"],
    ["IPv4-translated, public inside", "::ffff:0:93.184.216.34"],
    ["benchmarking", "2001:2::1"],
    ["IPv6 documentation (2024)", "3fff::1"],
    ["NAT64", "64:ff9b::7f00:1"],
    ["NAT64, public inside", "64:ff9b::5db8:d822"],
    ["local-use NAT64", "64:ff9b:1::1"],
    ["discard-only", "100::1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["documentation", "2001:db8::1"],
    ["6to4", "2002:c0a8:0101::1"],
    ["6to4, public inside", "2002:5db8:d822::1"],
    ["unique local", "fd00::1"],
    ["link-local", "fe80::1"],
    ["site-local", "fec0::1"],
    ["multicast", "ff02::1"],
    ["not an address", "app.example"],
  ])("refuses %s (%s)", (_case, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700::1111", "2a00:1450:4001:80b::200e"])("allows the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("finds the IPv4 address every IPv6 wrapping carries", () => {
    expect(embeddedIPv4("::ffff:10.0.0.1")).toEqual(["10.0.0.1"]);
    expect(embeddedIPv4("::ffff:a00:1")).toEqual(["10.0.0.1"]);
    expect(embeddedIPv4("::10.0.0.1")).toEqual(["10.0.0.1"]);
    expect(embeddedIPv4("::ffff:0:127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(embeddedIPv4("64:ff9b::a9fe:a9fe")).toEqual(["169.254.169.254"]);
    expect(embeddedIPv4("2002:a9fe:a9fe::1")).toEqual(["169.254.169.254"]);
    // Teredo: the server's address, and the client's with every bit inverted.
    expect(embeddedIPv4("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toEqual(["65.54.227.120", "192.0.2.45"]);
    expect(embeddedIPv4("2606:4700::1111")).toEqual([]);
  });
});

describe("one fetch of a document", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = null;
  });

  /** A local server, reached as if it were the public host the check approved. */
  async function serve(handler: Parameters<typeof createServer>[1]) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const fetchDocument = documentFetcher({ resolve: async () => [{ address: "127.0.0.1", family: 4 }], allowed: () => true, send: (url, options, onResponse) => httpRequest(url, options, onResponse), deadlineMs: 600 });
    return { url: new URL(`http://app.example:${String(port)}/client.json`), fetchDocument };
  }

  it("reads a document from the address the check approved", async () => {
    const { url, fetchDocument } = await serve((_request, response) => response.end(JSON.stringify(document)));
    expect(await fetchDocument(url)).toEqual(document);
  });

  it("is cut off at the deadline when the server drips its body, though it never goes quiet", async () => {
    const { url, fetchDocument } = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      const drip = setInterval(() => response.write(" "), 50);
      response.on("close", () => clearInterval(drip));
    });
    const started = Date.now();
    await expect(fetchDocument(url)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("is cut off early when the host is slow to start answering, before the whole deadline", async () => {
    server = createServer((_request, response) => {
      setTimeout(() => response.end(JSON.stringify(document)), 1_500);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const fetchDocument = documentFetcher({ resolve: async () => [{ address: "127.0.0.1", family: 4 }], allowed: () => true, send: (url, options, onResponse) => httpRequest(url, options, onResponse), firstByteMs: 200, deadlineMs: 5_000 });
    const started = Date.now();
    await expect(fetchDocument(new URL(`http://app.example:${String(port)}/client.json`))).rejects.toThrow("slow to answer");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("is cut off at the deadline when the name lookup never answers", async () => {
    const fetchDocument = documentFetcher({ resolve: () => new Promise(() => undefined), allowed: () => true, deadlineMs: 200 });
    const started = Date.now();
    await expect(fetchDocument(new URL(DOCUMENT_ID))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("stops reading past five kilobytes", async () => {
    const { url, fetchDocument } = await serve((_request, response) => response.end(JSON.stringify({ ...document, padding: "x".repeat(10_000) })));
    await expect(fetchDocument(url)).rejects.toThrow();
  });

  it("refuses a host with any address that is not public, and follows no redirect", async () => {
    const privateHost = documentFetcher({ resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }] });
    await expect(privateHost(new URL(DOCUMENT_ID))).rejects.toThrow("not a public host");
    const { url, fetchDocument } = await serve((_request, response) => response.writeHead(302, { location: "http://169.254.169.254/" }).end());
    await expect(fetchDocument(url)).rejects.toThrow("status 302");
  });
});

describe("fetches at once", () => {
  it("fetch a document once however many requests name it at the same moment", async () => {
    let fetched = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clients = clientResolver(KEY, async () => {
      fetched += 1;
      await gate;
      return document;
    });
    const all = Promise.all([clients(DOCUMENT_ID), clients(DOCUMENT_ID), clients(DOCUMENT_ID)]);
    release();
    expect((await all).map((client) => client?.name)).toEqual(["Example", "Example", "Example"]);
    expect(fetched).toBe(1);
  });

  /** A fetch that holds documents on hosts named slow… until the test releases them. */
  function gated() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchDocument = async (url: URL) => {
      if (url.hostname.startsWith("slow")) await gate;
      return { ...document, client_id: url.href };
    };
    return { fetchDocument, release: () => release() };
  }

  it("are budgeted per host, so slow hosts cannot block another host's client, and nothing is cached against a refusal", async () => {
    const { fetchDocument, release } = gated();
    const clients = clientResolver(KEY, fetchDocument);
    const held = [clients("https://slow.example/one.json", "10.0.0.1"), clients("https://slow.example/two.json", "10.0.0.2")];
    // The slow host has its two; a third document there is unknown for now.
    expect(await clients("https://slow.example/three.json", "10.0.0.3")).toBeNull();
    // Another host's client is still read at once.
    expect(await clients("https://fast.example/client.json", "10.0.0.4")).toMatchObject({ clientId: "https://fast.example/client.json" });
    release();
    await Promise.all(held);
    expect(await clients("https://slow.example/three.json", "10.0.0.3")).toMatchObject({ clientId: "https://slow.example/three.json" });
  });

  it("let one requesting address wait on one stranger's document at a time", async () => {
    const { fetchDocument, release } = gated();
    const clients = clientResolver(KEY, fetchDocument);
    const first = clients("https://slow.example/one.json", "10.0.0.9");
    expect(await clients("https://slow-other.example/two.json", "10.0.0.9")).toBeNull();
    // Another address asking for the same document is not refused.
    const other = clients("https://slow-other.example/two.json", "10.0.0.10");
    release();
    await first;
    expect(await other).toMatchObject({ clientId: "https://slow-other.example/two.json" });
  });

  it("stop at a server-wide ceiling, whatever the hosts and addresses", async () => {
    const { fetchDocument, release } = gated();
    const clients = clientResolver(KEY, fetchDocument, Date.now, { perHost: 2, perRequester: 1, total: 2 });
    const held = [clients("https://slow-a.example/c.json", "1"), clients("https://slow-b.example/c.json", "2")];
    expect(await clients("https://slow-c.example/c.json", "3")).toBeNull();
    release();
    await Promise.all(held);
  });
});
