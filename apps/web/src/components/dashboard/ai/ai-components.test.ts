import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import english from "@/i18n/dictionaries/en.json";

import { EvidenceText } from "./evidence-text";
import { LetterEvidence } from "./letter-evidence";
import { ProvenanceBadge } from "./provenance-badge";
import { VisitReadingResult } from "./visit-reading-result";

const copy = english.aiProvenance;
const badge = (provenance: Parameters<typeof ProvenanceBadge>[0]["provenance"], kind: "read" | "worded") => renderToStaticMarkup(createElement(ProvenanceBadge, { provenance, kind, copy }));

describe("the badge that says who made a result", () => {
  it("says Claude read or worded it, and names the model in words and in the tooltip", () => {
    const read = badge({ source: "claude", model: "us.anthropic.claude-opus-4-6-v1" }, "read");
    expect(read).toContain("Read by Claude");
    expect(read).toContain("Model: us.anthropic.claude-opus-4-6-v1");
    expect(read).toContain('title="Model: us.anthropic.claude-opus-4-6-v1"');
    expect(badge({ source: "claude", model: null }, "worded")).toContain("Worded by Claude");
  });

  it("says fixed rules or fixed wording, honestly, with the reason the model was not used", () => {
    const rules = badge({ source: "rules", reason: "model_busy" }, "read");
    expect(rules).toContain("Read by fixed rules (the model was not used)");
    expect(rules).toContain("The model was busy.");
    expect(rules).not.toContain("Claude");
    const fixed = badge({ source: "template", reason: "wording_rejected" }, "worded");
    expect(fixed).toContain("Fixed wording");
    expect(fixed).toContain("did not match the record");
    expect(fixed).not.toContain("Worded by Claude");
  });

  it("never lets a fallback pass for Claude, whatever the reason or kind", () => {
    for (const reason of Object.keys(copy.reasons)) {
      for (const source of ["rules", "template"] as const) {
        for (const kind of ["read", "worded"] as const) {
          expect(badge({ source, reason: reason as keyof typeof copy.reasons }, kind)).not.toMatch(/by Claude/);
        }
      }
    }
  });
});

describe("the original words with the evidence marked", () => {
  it("marks each quoted place with a mark element, and leaves the rest as plain words", () => {
    const html = renderToStaticMarkup(createElement(EvidenceText, { text: "Amount due: $73.15 by Friday", highlights: [{ id: "amount", quote: "Amount due: $73.15" }], copy: copy.evidence }));
    expect(html).toContain("<mark");
    expect(html).toMatch(/<mark[^>]*>Amount due: \$73\.15<\/mark>/);
    expect(html).toContain("<span> by Friday</span>");
    expect(html).toContain("underline");
  });

  it("marks nothing for a quote the words do not hold", () => {
    expect(renderToStaticMarkup(createElement(EvidenceText, { text: "Pay now", highlights: [{ id: "amount", quote: "$9.00" }], copy: copy.evidence }))).not.toContain("<mark");
  });
});

describe("the evidence beside a letter's fields", () => {
  const reading = { kind: "bill", sender: "Lakeside Water", amountCents: 7_315, dueOn: "2026-11-27", pressure: false, source: "model_text" } as const;
  const evidence = {
    fields: [
      { field: "sender", quote: "Lakeside Water" },
      { field: "amount", quote: "Amount due: $73.15" },
    ],
    claudeQuote: { text: "Amount due: $73.15", checked: true },
  } as const;
  const render = (over: Partial<Parameters<typeof LetterEvidence>[0]>) =>
    renderToStaticMarkup(createElement(LetterEvidence, { reading, evidence, provenance: { source: "claude", model: "m" }, sourceText: "Lakeside Water\nAmount due: $73.15", locale: "en", currency: "USD", copy: copy.evidence, ...over }));

  it("shows each field with the words it was found in, and says so for one it did not find", () => {
    const html = render({});
    expect(html).toContain("Written in the letter as “Amount due: $73.15”");
    expect(html).toContain("Amount: </span>$73.15");
    expect(html).toContain("Not found written in the words, so check it against the letter.");
    expect(html).toContain("Claude quoted “Amount due: $73.15”");
  });

  it("says a reading by fixed rules quoted nothing", () => {
    expect(render({ provenance: { source: "rules", reason: "not_configured" }, evidence: { fields: evidence.fields, claudeQuote: null } })).toContain("Claude quoted nothing.");
  });

  it("gives a photograph's quote only as Claude's word, and marks no words", () => {
    const html = render({ sourceText: null, evidence: { fields: [], claudeQuote: { text: "Amount due: $73.15", checked: false } } });
    expect(html).toContain("Kin cannot check that against typed words");
    expect(html).not.toContain("<mark");
  });
});

describe("what Kin read from a description of visits", () => {
  it("shows who read it, each day with how long and the words it came from, and those words marked", () => {
    const outcome = { visits: [{ date: "2026-11-02", minutes: 240, quotes: ["Monday and Tuesday this week, 4 hours each"] }, { date: "2026-11-05", minutes: 150, quotes: ["Thursday from 9 to 11:30"] }], unclear: [], dropped: 0, provenance: { source: "claude", model: "m" } } as const;
    const html = renderToStaticMarkup(createElement(VisitReadingResult, { outcome, sourceText: "Monday and Tuesday this week, 4 hours each, and on Thursday from 9 to 11:30 in the morning.", locale: "en", copy }));
    expect(html).toContain("Read by Claude");
    expect(html).toContain("Monday, November 2, 2026");
    expect(html).toContain("4 h");
    expect(html).toContain("2 h 30 min");
    expect(html).toContain("Read from “Thursday from 9 to 11:30”");
    expect(html.match(/<mark/g)).toHaveLength(2);
  });
});
