import { describe, expect, it } from "vitest";

import { readCappedText } from "./request-body";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://kin.test/api", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("readCappedText", () => {
  it("reads a body within the limit, byte for byte", async () => {
    expect(await readCappedText(post('{"amount":"25.00","note":"é"}'), 100)).toBe('{"amount":"25.00","note":"é"}');
    expect(await readCappedText(post(null), 100)).toBe("");
  });

  it("refuses a body that declares more than the limit, without reading it", async () => {
    expect(await readCappedText(post("x", { "content-length": "100000000" }), 100)).toBeNull();
  });

  it("stops reading a body that runs past the limit, whatever it declared", async () => {
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(new Uint8Array(64));
      },
    });
    expect(await readCappedText(post(endless), 1000)).toBeNull();
    expect(sent).toBeLessThan(40);
  });
});
