import { describe, expect, it } from "vitest";

import { OFFICE_LOCALES } from "../office-words.ts";
import { TWILIO_VOICES, sayAndHangUp, sayAndListen } from "./twiml.ts";
import { escapeXml } from "./xml.ts";

describe("escaping text for TwiML", () => {
  it("turns every character XML reserves into an entity", () => {
    expect(escapeXml(`<Hangup/> & "x" 'y'`)).toBe("&lt;Hangup/&gt; &amp; &quot;x&quot; &apos;y&apos;");
  });

  it("drops the control characters XML forbids and keeps ordinary and non-Latin text", () => {
    expect(escapeXml("a\u0000b\u0008c\u001Fd")).toBe("abcd");
    expect(escapeXml("שלום\nمرحباً")).toBe("שלום\nمرحباً");
  });
});

describe("TwiML", () => {
  it("speaks each sentence, listens for speech and says where the answer goes", () => {
    const twiml = sayAndListen("en", ["Hello.", "Who is calling, please?"], "https://voice.example/voice/turn?s=abc");
    expect(twiml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Say voice="Polly.Joanna" language="en-US">Hello.</Say><Say voice="Polly.Joanna" language="en-US">Who is calling, please?</Say>' +
        '<Gather input="speech" language="en-US" speechTimeout="auto" timeout="6" method="POST" actionOnEmptyResult="true" action="https://voice.example/voice/turn?s=abc"/>' +
        '<Redirect method="POST">https://voice.example/voice/turn?s=abc</Redirect></Response>',
    );
  });

  it("escapes the address and the words, so nothing in them can add a verb", () => {
    const twiml = sayAndListen("en", ["</Say><Dial>+1555</Dial><Say>"], 'https://voice.example/x?a=1&b="2"');
    expect(twiml).not.toContain("<Dial>");
    expect(twiml).toContain("&lt;/Say&gt;&lt;Dial&gt;");
    expect(twiml).toContain('action="https://voice.example/x?a=1&amp;b=&quot;2&quot;"');
  });

  it("ends a call with a hang-up, with or without a last sentence", () => {
    expect(sayAndHangUp("fr", ["Au revoir."])).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Lea" language="fr-FR">Au revoir.</Say><Hangup/></Response>');
    expect(sayAndHangUp("en", [])).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });

  it("names a language for every locale, and no Polly voice for Hebrew, which has none", () => {
    expect(Object.keys(TWILIO_VOICES).toSorted()).toEqual([...OFFICE_LOCALES].toSorted());
    expect(sayAndHangUp("he", ["שלום."])).toContain('<Say language="he-IL">שלום.</Say>');
    expect(TWILIO_VOICES.he.voice).toBeNull();
    for (const locale of OFFICE_LOCALES.filter((each) => each !== "he")) expect(TWILIO_VOICES[locale].voice).toMatch(/^Polly\.[A-Za-z]+(-Neural)?$/);
  });
});
