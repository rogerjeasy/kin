import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createPayPalClient, type Fetch } from "./client.ts";
import { PayPalShapeError } from "./json.ts";
import { PayPalError } from "./paypal-error.ts";
import { readFixture, replayPool, type RecordedExchange } from "./testing/replay.ts";
import { leftThePool, maskEmail, parsePayoutItemTransactionId, parseTransactionSearch, searchTransaction, type TransactionRecord } from "./transaction-search.ts";

// Derived from PayPal's documentation, not recorded: see fixtures/README.md.
type Recording = { payoutLeft: unknown; empty: unknown; payoutItem: unknown };
const recording = JSON.parse(readFileSync(new URL("./fixtures/transaction-search-documented-2026-11-09.json", import.meta.url), "utf8")) as Recording;

const TRANSACTION_ID = "5TY05013RG002845M";

function clientAnswering(reply: { status: number; body: unknown }) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 32_400 });
    sent.push({ url, init });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
  return { client: createPayPalClient({ apiUrl: "https://paypal.test", clientId: "id", clientSecret: "secret", fetch, now: () => new Date("2026-11-09T09:00:00Z"), sleep: async () => {}, log: () => {} }), sent };
}

function withAmount(value: string, status = "S", fee?: string): unknown {
  return {
    transaction_details: [
      {
        transaction_info: {
          transaction_id: TRANSACTION_ID,
          transaction_status: status,
          transaction_initiation_date: "2026-11-05T14:02:11+0000",
          transaction_amount: { currency_code: "USD", value },
          ...(fee === undefined ? {} : { fee_amount: { currency_code: "USD", value: fee } }),
        },
      },
    ],
  };
}

describe("reading a Transaction Search answer", () => {
  it("reads a payout that left the account, in signed integer cents, with the fee as a positive amount", () => {
    expect(parseTransactionSearch(recording.payoutLeft)).toEqual([
      {
        transactionId: TRANSACTION_ID,
        status: "S",
        eventCode: "T0400",
        amountCents: -26_400,
        currency: "USD",
        initiatedAt: "2026-11-05T14:02:11+0000",
        feeCents: 25,
        counterpartyEmailMasked: "c***@example.com",
        counterpartyAccountId: "CGVR7ZUW4Q7PS",
      },
    ]);
  });

  it("never carries the whole address", () => {
    expect(JSON.stringify(parseTransactionSearch(recording.payoutLeft))).not.toContain("caregiver@");
  });

  it("masks only the local part, and drops an address it cannot read", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
    expect(maskEmail("@example.com")).toBeNull();
    expect(maskEmail("nobody")).toBeNull();
    expect(maskEmail("jane@")).toBeNull();
  });

  it("reads an answer with no records as an empty list", () => {
    expect(parseTransactionSearch(recording.empty)).toEqual([]);
    expect(parseTransactionSearch({})).toEqual([]);
  });

  it("reads amounts from their digits, so a value a float would round stays exact", () => {
    expect(parseTransactionSearch(withAmount("-90071992547409.91"))[0]?.amountCents).toBe(-9_007_199_254_740_991);
    expect(parseTransactionSearch(withAmount("0.10"))[0]?.amountCents).toBe(10);
    expect(parseTransactionSearch(withAmount("-0.00"))[0]?.amountCents).toBe(0);
  });

  it("refuses an amount it cannot read exactly", () => {
    for (const value of ["-1.005", "1e3", "--1", "abc", "+5.00"]) {
      expect(() => parseTransactionSearch(withAmount(value))).toThrow(PayPalShapeError);
    }
  });

  it("accepts a record without payer or fee", () => {
    expect(parseTransactionSearch(withAmount("5.00"))[0]).toMatchObject({ feeCents: null, counterpartyEmailMasked: null, counterpartyAccountId: null, eventCode: "" });
  });

  it("reads a negative fee the same as a positive one", () => {
    expect(parseTransactionSearch(withAmount("-5.00", "S", "-0.25"))[0]?.feeCents).toBe(25);
  });
});

describe("whether money left the pool", () => {
  const base: TransactionRecord = { transactionId: TRANSACTION_ID, status: "S", eventCode: "T0400", amountCents: -100, currency: "USD", initiatedAt: "x", feeCents: null, counterpartyEmailMasked: null, counterpartyAccountId: null };

  it("is true only for a successful record with a negative amount", () => {
    expect(leftThePool(base)).toBe(true);
    expect(leftThePool({ ...base, amountCents: 100 })).toBe(false);
    expect(leftThePool({ ...base, amountCents: 0 })).toBe(false);
    for (const status of ["P", "D", "V"]) expect(leftThePool({ ...base, status })).toBe(false);
  });
});

describe("a payout item's transaction ID", () => {
  it("is read from the item PayPal answers with, and is null while there is none", () => {
    expect(parsePayoutItemTransactionId(recording.payoutItem)).toBe(TRANSACTION_ID);
    expect(parsePayoutItemTransactionId({ payout_item_id: "9MLQ4GCDZ2HRG" })).toBeNull();
    expect(() => parsePayoutItemTransactionId("nope")).toThrow(PayPalShapeError);
  });
});

describe("searching for one transaction", () => {
  const around = new Date("2026-11-05T14:02:11.456Z");

  it("asks for a 30-day window around the date, for that ID, with the payer's fields", async () => {
    const { client, sent } = clientAnswering({ status: 200, body: recording.payoutLeft });
    const found = await searchTransaction(client, { transactionId: TRANSACTION_ID, around });
    expect(found).toMatchObject({ transactionId: TRANSACTION_ID, amountCents: -26_400 });
    const url = new URL(sent[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/reporting/transactions");
    expect(sent[0]?.init.method).toBe("GET");
    expect(url.searchParams.get("start_date")).toBe("2026-10-21T14:02:11Z");
    expect(url.searchParams.get("end_date")).toBe("2026-11-20T14:02:11Z");
    expect(url.searchParams.get("transaction_id")).toBe(TRANSACTION_ID);
    expect(url.searchParams.get("fields")).toBe("transaction_info,payer_info");
    const days = (Date.parse(url.searchParams.get("end_date") ?? "") - Date.parse(url.searchParams.get("start_date") ?? "")) / 86_400_000;
    expect(days).toBeLessThanOrEqual(31);
  });

  it("is null when PayPal returns nothing, such as a payout not yet available", async () => {
    const { client } = clientAnswering({ status: 200, body: recording.empty });
    expect(await searchTransaction(client, { transactionId: TRANSACTION_ID, around })).toBeNull();
  });

  it("is null when PayPal returns only another transaction", async () => {
    const other = (recording.payoutLeft as { transaction_details: { transaction_info: Record<string, unknown> }[] });
    const { client } = clientAnswering({ status: 200, body: { transaction_details: [{ transaction_info: { ...other.transaction_details[0]?.transaction_info, transaction_id: "OTHER000000000000" } }] } });
    expect(await searchTransaction(client, { transactionId: TRANSACTION_ID, around })).toBeNull();
  });

  it("throws PayPal's refusal, such as an app without Transaction Search", async () => {
    const { client } = clientAnswering({ status: 403, body: { name: "NOT_AUTHORIZED" } });
    await expect(searchTransaction(client, { transactionId: TRANSACTION_ID, around })).rejects.toMatchObject({ outcome: "rejected", status: 403 });
    await expect(searchTransaction(client, { transactionId: TRANSACTION_ID, around })).rejects.toBeInstanceOf(PayPalError);
  });
});

describe("a payout found in Transaction Search, as the sandbox answered (recorded 11 November 2026)", () => {
  // The demo caregiver payout of 5.00 the worker paid through the sandbox, looked up by its payout item four hours later.
  const { exchanges } = readFixture<{ exchanges: RecordedExchange[] }>("transaction-search-sandbox-2026-11-11.json");

  it("reads the payout out of the pool as a negative amount, the fee as a positive one, and the counterparty masked", async () => {
    const { pool, sent } = replayPool(exchanges);
    const found = await pool.getPayoutTransaction("DA9N36VBMB3UN", new Date("2026-11-11T23:00:00Z"));
    expect(found).toEqual({
      transactionId: "0X8758998N995083U",
      status: "S",
      eventCode: "T0001",
      amountCents: -500,
      currency: "USD",
      initiatedAt: "2026-11-11T18:59:08Z",
      // PayPal sent the fee as -0.25.
      feeCents: 25,
      counterpartyEmailMasked: "s***@personal.example.com",
      counterpartyAccountId: "PLACEHOLDER",
    });
    expect(found !== null && leftThePool(found)).toBe(true);
    expect(sent[1]?.path).toContain("transaction_id=0X8758998N995083U");
  });
});
