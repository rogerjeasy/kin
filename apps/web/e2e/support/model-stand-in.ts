import { createServer, type IncomingMessage } from "node:http";

/**
 * A stand-in for Claude on Amazon Bedrock's Messages endpoint, for the
 * end-to-end tests only, so the app's real SDK client runs unchanged. It
 * reads "Yesterday N hours" as N hours yesterday, quoting the caregiver, and
 * declines any description that asks it to. It also reads a letter's first
 * line as its sender and its first amount as the amount (a photograph is
 * always a 120.00 bill from Hillside Clinic), and words a verdict by
 * repeating the statement it is given.
 */
export const MODEL_STAND_IN = { port: 3103 } as const;

async function body(request: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  return text;
}

function reading(user: string): string {
  if (/attached photograph/.test(user)) return JSON.stringify({ kind: "bill", sender: "Hillside Clinic", amount: "120.00", dueOn: null, demandsPayment: true, pressure: false, quote: "Hillside Clinic" });
  const words = /<document>\n([\s\S]*)\n<\/document>/.exec(user)?.[1] ?? "";
  const sender = words.split("\n")[0]?.trim() ?? "";
  const amount = /(\d+\.\d{2})/.exec(words)?.[1] ?? null;
  return JSON.stringify({
    kind: amount === null ? "letter" : "bill",
    sender: sender === "" ? null : sender,
    amount,
    dueOn: null,
    demandsPayment: amount !== null,
    pressure: /gift card/i.test(words),
    quote: sender === "" ? null : sender,
  });
}

function answer(system: string, user: string): { stop_reason: string; text: string } {
  if (/decline/i.test(user)) return { stop_reason: "refusal", text: "" };
  if (/You read one letter/.test(system)) return { stop_reason: "end_turn", text: reading(user) };
  if (/You put a result into/.test(system)) return { stop_reason: "end_turn", text: JSON.stringify({ text: /<statement>\n([\s\S]*)\n<\/statement>/.exec(user)?.[1] ?? "" }) };
  const today = /Today is \w+, (\d{4}-\d{2}-\d{2})/.exec(system)?.[1];
  const said = /Yesterday (\d+) hours/i.exec(user);
  if (!today || !said) return { stop_reason: "end_turn", text: JSON.stringify({ visits: [], unclear: ["nothing I could place"] }) };
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { stop_reason: "end_turn", text: JSON.stringify({ visits: [{ date: yesterday, hours: Number(said[1]), minutes: 0, quote: said[0] }], unclear: [] }) };
}

type Sent = { model: string; system: string; messages: { role: string; content: string | { type: string; text?: string }[] }[]; tools?: { name: string }[] };

/**
 * Ask Kin, the one request that offers tools: a question about payment calls
 * the payout tool, one about fairness the fairness tool, a reorder the refill
 * tool, anything else no tool. Once a tool has answered, it ends with words
 * that hold no figure, so they pass the number guard.
 */
function agentTurn(sent: Sent): { stop_reason: string; content: unknown[] } {
  const last = sent.messages.at(-1);
  if (last && Array.isArray(last.content) && last.content.some((block) => block.type === "tool_result")) {
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Kin read the record for you." }] };
  }
  const question = typeof last?.content === "string" ? last.content : "";
  const offered = new Set((sent.tools ?? []).map((tool) => tool.name));
  const wanted = /paid/i.test(question) ? { name: "get_paypal_payout_status", input: { payee: "Amara" } } : /owes/i.test(question) ? { name: "get_fairness", input: {} } : /reorder/i.test(question) ? { name: "propose_refill", input: {} } : null;
  if (wanted === null || !offered.has(wanted.name)) return { stop_reason: "end_turn", content: [{ type: "text", text: "Kin cannot show that from your seat." }] };
  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_stand_in", ...wanted }] };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${MODEL_STAND_IN.port}`);
  if (request.method === "GET" && url.pathname === "/health") return response.writeHead(200).end("ok");
  if (request.method !== "POST" || !url.pathname.endsWith("/v1/messages")) return response.writeHead(404).end();
  body(request)
    .then((raw) => {
      const sent = JSON.parse(raw) as Sent;
      // Only Ask Kin offers tools; extraction never carries them (AGENTS.md section 7).
      if (sent.tools !== undefined) {
        if (!sent.system.startsWith("You are Kin, the assistant of a family circle")) return response.writeHead(400).end();
        const { stop_reason, content } = agentTurn(sent);
        return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_stand_in", type: "message", role: "assistant", model: sent.model, content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      }
      // A request about words sends them as plain text; one about a photograph sends the picture, then the words.
      const first = sent.messages[0]?.content ?? "";
      const user = typeof first === "string" ? first : first.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("");
      const { stop_reason, text } = answer(sent.system, user);
      const content = stop_reason === "refusal" ? [] : [{ type: "text", text }];
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ id: "msg_stand_in", type: "message", role: "assistant", model: sent.model, content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
      );
    })
    .catch(() => response.writeHead(500).end());
});

if (import.meta.url === `file://${process.argv[1]}`) server.listen(MODEL_STAND_IN.port);
