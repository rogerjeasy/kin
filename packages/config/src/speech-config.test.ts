import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { readSpeechConfig } from "./speech-config.ts";

describe("the speech settings", () => {
  it("are off without a region, and name the region when set", () => {
    expect(readSpeechConfig({})).toEqual({ enabled: false });
    expect(readSpeechConfig({ KIN_SPEECH_REGION: "us-east-1" })).toEqual({ enabled: true, region: "us-east-1" });
  });

  it("refuse a region that is not one", () => {
    expect(() => readSpeechConfig({ KIN_SPEECH_REGION: "east" })).toThrow(ConfigError);
  });
});
