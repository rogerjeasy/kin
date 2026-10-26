import { createServer, type IncomingMessage } from "node:http";

/**
 * A stand-in for Claude on Amazon Bedrock's Messages endpoint, for the
 * end-to-end tests only, so the app's real SDK client runs unchanged. It
 * reads "Yesterday N hours" as N hours yesterday, quoting the caregiver, and
 * declines any description that asks it to.
 */
export const MODEL_STAND_IN = { port: 3103 } as const;

async function body(request: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  return text;
}

function answer(system: string, user: string): { stop_reason: string; text: string } {
  if (/decline/i.test(user)) return { stop_reason: "refusal", text: "" };
  const today = /Today is \w+, (\d{4}-\d{2}-\d{2})/.exec(system)?.[1];
  const said = /Yesterday (\d+) hours/i.exec(user);
  if (!today || !said) return { stop_reason: "end_turn", text: JSON.stringify({ visits: [], unclear: ["nothing I could place"] }) };
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { stop_reason: "end_turn", text: JSON.stringify({ visits: [{ date: yesterday, hours: Number(said[1]), minutes: 0, quote: said[0] }], unclear: [] }) };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${MODEL_STAND_IN.port}`);
  if (request.method === "GET" && url.pathname === "/health") return response.writeHead(200).end("ok");
  if (request.method !== "POST" || !url.pathname.endsWith("/v1/messages")) return response.writeHead(404).end();
  body(request)
    .then((raw) => {
      const sent = JSON.parse(raw) as { model: string; system: string; messages: { content: string }[]; tools?: unknown };
      // Extraction never carries tools (AGENTS.md section 7).
      if (sent.tools !== undefined) return response.writeHead(400).end();
      const { stop_reason, text } = answer(sent.system, sent.messages[0]?.content ?? "");
      const content = stop_reason === "refusal" ? [] : [{ type: "text", text }];
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ id: "msg_stand_in", type: "message", role: "assistant", model: sent.model, content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
      );
    })
    .catch(() => response.writeHead(500).end());
});

if (import.meta.url === `file://${process.argv[1]}`) server.listen(MODEL_STAND_IN.port);
