import { createServer, type IncomingMessage, type Server } from "node:http";

import { MAX_FORM_BYTES, TWILIO_SIGNATURE_HEADER } from "@kin/telephony";

import { handleVoice, type VoiceDeps } from "./office-line-service.ts";

const CONTENT_TYPES = { xml: "text/xml; charset=utf-8", text: "text/plain; charset=utf-8" } as const;
const FORM = "application/x-www-form-urlencoded";
/** A caller's phone company that stalls a request cannot hold a connection forever. */
const REQUEST_TIMEOUT_MS = 15_000;

class BodyTooLarge extends Error {}

/** The request's body, refusing to read past the limit. */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FORM_BYTES) {
        // Stop keeping what arrives, let the rest drain, and answer: closing the socket here would hide the answer.
        request.removeAllListeners("data");
        request.resume();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** Kin's phone service over plain HTTP: the protocol glue around `handleVoice`, which holds every decision. */
export function voiceServer(deps: VoiceDeps): Server {
  const server = createServer((request, response) => {
    const finish = (status: number, type: keyof typeof CONTENT_TYPES, body: string): void => {
      response.writeHead(status, { "content-type": CONTENT_TYPES[type], "cache-control": "no-store", ...(status === 413 ? { connection: "close" } : {}) });
      response.end(body);
    };
    void (async () => {
      try {
        const declared = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
        if (request.method === "POST" && declared !== FORM) {
          finish(415, "text", "Unsupported media type");
          return;
        }
        const body = request.method === "POST" ? await readBody(request) : "";
        const signature = request.headers[TWILIO_SIGNATURE_HEADER];
        const reply = await handleVoice(
          { method: request.method ?? "GET", target: request.url ?? "/", signature: typeof signature === "string" ? signature : undefined, body },
          deps,
        );
        finish(reply.status, reply.type, reply.body);
      } catch (error) {
        if (error instanceof BodyTooLarge) finish(413, "text", "Too large");
        else finish(500, "text", "Server error");
      }
    })();
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}
