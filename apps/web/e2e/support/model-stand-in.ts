import { createServer, type IncomingMessage } from "node:http";

import { E2E_PORTS } from "./ports.ts";

/**
 * A stand-in for Claude on Amazon Bedrock's Messages endpoint, for the
 * end-to-end tests only, so the app's real SDK client runs unchanged. It
 * reads "Yesterday N hours" as N hours yesterday, quoting the caregiver, and
 * declines any description that asks it to. It also reads a letter's first
 * line as its sender and its first amount as the amount (a photograph is
 * always a 120.00 bill from Hillside Clinic), and words a verdict by
 * repeating the statement it is given.
 */
export const MODEL_STAND_IN = { port: E2E_PORTS.modelStandIn } as const;

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

/**
 * The two sentences about care shifts, worded from the facts the way the real
 * model is asked to: the question names the caregiver by the slot and the part
 * of the day, the note names each person by their slot and copies their hours.
 */
function shiftWords(user: string): string {
  const facts = JSON.parse(/<facts>\n([\s\S]*)\n<\/facts>/.exec(user)?.[1] ?? "{}") as { part?: string; candidates?: { slot: string; hoursThisWeek: string }[] };
  if (facts.part !== undefined) return `Was {name} here this ${facts.part}?`;
  return (facts.candidates ?? []).map((candidate) => `${candidate.slot} is free and has ${candidate.hoursThisWeek} this week.`).join(" ");
}

/**
 * A person's own agent for quiet shares, read the way the real model is asked
 * to: the amount after "up to", or the first amount they said; the drives or
 * appointments they counted; the hours they said. Nothing is guessed.
 */
function offerReading(user: string): string {
  const words = /<person_words>\n([\s\S]*)\n<\/person_words>/.exec(user)?.[1] ?? "";
  const counts: Record<string, number> = { one: 1, two: 2, three: 3 };
  const trips = /\b(one|two|three|\d+) (?:appointments?|drives?|visits?)\b/i.exec(words)?.[1]?.toLowerCase();
  const hours = /(\d+(?:\.\d+)?) hours?/i.exec(words)?.[1] ?? null;
  const amounts = [...words.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]).filter((amount) => amount !== hours);
  const monthly = /up to (\d+(?:\.\d+)?)/i.exec(words)?.[1] ?? amounts[0] ?? null;
  return JSON.stringify({
    monthly,
    stepUpAmount: null,
    stepUpMonth: null,
    earliestMonth: null,
    careTrips: trips === undefined ? null : (counts[trips] ?? Number(trips)),
    careHours: hours,
    reply: monthly === null ? "Thank you. How much could you give at most?" : "Thank you. I have written that down for you to check.",
  });
}

/**
 * The parent's wishes, drafted the way the real model is asked to: each
 * sentence of her words is one wish; "keep paying" a listed caregiver keeps
 * them paid, "unless X and Y both agree" with an amount asks two people, a
 * listed subscription's first word suspends it, "don't buy" pauses the extras,
 * and anything else is not a rule.
 */
function wishDrafts(user: string): string {
  const said = /<parent_words>\n([\s\S]*)\n<\/parent_words>/.exec(user)?.[1] ?? "";
  const slots = [...user.matchAll(/^(c|m|s)(\d+): ([^(\n]+?)(?: \(.*\))?$/gm)].map((match) => ({ slot: `${match[1]}${match[2]}`, kind: match[1], name: (match[3] ?? "").trim() }));
  const slotOf = (kind: string, sentence: string) => slots.filter((each) => each.kind === kind && sentence.toLowerCase().includes((each.name.split(" ")[0] ?? "").toLowerCase()));
  const blank = { payee: null, subscriptions: [], amount: null, approvers: [], successor: null, why: null };
  const wishes = (said.match(/[^.!?]+[.!?]?/g) ?? []).map((sentence) => sentence.trim()).filter((sentence) => sentence !== "").map((quote) => {
    const trigger = /home/i.test(quote) && !/hospital/i.test(quote) ? "care_home" : /hospital/i.test(quote) && !/home/i.test(quote) ? "hospital" : "either";
    const caregiver = slotOf("c", quote)[0];
    if (/keep paying/i.test(quote) && caregiver) return { ...blank, quote, kind: "keep_paying", trigger, payee: caregiver.slot };
    const amount = /(\$?\d[\d,]*(?: dollars)?)/.exec(quote)?.[1] ?? null;
    if (/both agree/i.test(quote) && amount !== null) return { ...blank, quote, kind: "new_payee_approvals", trigger, amount, approvers: slotOf("m", quote).map((each) => each.slot) };
    const subscriptions = slots.filter((each) => each.kind === "s" && each.name.split(" ").some((word) => word.length > 3 && quote.toLowerCase().includes(word.toLowerCase())));
    if (subscriptions.length > 0) return { ...blank, quote, kind: "suspend_subscriptions", trigger, subscriptions: subscriptions.map((each) => each.slot) };
    if (/don't buy|do not buy/i.test(quote)) return { ...blank, quote, kind: "pause_discretionary", trigger };
    return { ...blank, quote, kind: "not_a_rule", trigger, why: "Not one of the rule kinds." };
  });
  return JSON.stringify({ wishes });
}

function answer(system: string, user: string): { stop_reason: string; text: string } {
  if (/Split what she said into separate wishes/.test(system)) return { stop_reason: "end_turn", text: wishDrafts(user) };
  if (/decline/i.test(user)) return { stop_reason: "refusal", text: "" };
  if (/own private Kin agent/.test(system)) return { stop_reason: "end_turn", text: offerReading(user) };
  if (/You read one letter/.test(system)) return { stop_reason: "end_turn", text: reading(user) };
  if (/You put facts that Kin already decided into one calm/.test(system)) return { stop_reason: "end_turn", text: JSON.stringify({ text: shiftWords(user) }) };
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

/**
 * The calendar assistant: a question naming Ana filters the calendar to her
 * visit with the widget's own filter tool and, once the tool has
 * answered, says so in words that hold no figure; a request to book, move or
 * cancel is declined in words; a request to remove one calls a tool the route
 * never offers, which the route must refuse; anything else is answered in a
 * sentence with no tool.
 */
function assistantTurn(sent: Sent): { stop_reason: string; content: unknown[] } {
  const last = sent.messages.at(-1);
  if (last && Array.isArray(last.content) && last.content.some((block) => block.type === "tool_result")) {
    return { stop_reason: "end_turn", content: [{ type: "text", text: "I filtered the calendar to Ana's visit." }] };
  }
  const question = typeof last?.content === "string" ? last.content : "";
  if (/remove/i.test(question)) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_assistant", name: "removeEvents", input: {} }] };
  if (/book|move|cancel|pay/i.test(question)) return { stop_reason: "end_turn", content: [{ type: "text", text: "I cannot book, move or cancel anything. Use the calendar's own forms." }] };
  if (/ana/i.test(question)) {
    const input = { eventConditions: { type: "and", conditions: [{ field: "name", operator: "*", value: "Ana" }] } };
    return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_assistant", name: "filterEvents", input }] };
  }
  return { stop_reason: "end_turn", content: [{ type: "text", text: "Amara is on the calendar." }] };
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
        const assistant = sent.system.startsWith("You are Kin's calendar assistant");
        if (!assistant && !sent.system.startsWith("You are Kin, the assistant of a family circle")) return response.writeHead(400).end();
        // The assistant is never given a tool that changes a record, so the stand-in checks it was not offered one.
        if (assistant && sent.tools.some((tool) => /^(add|update|remove|delete|assign|unassign)/.test(tool.name))) return response.writeHead(400).end();
        const { stop_reason, content } = assistant ? assistantTurn(sent) : agentTurn(sent);
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
