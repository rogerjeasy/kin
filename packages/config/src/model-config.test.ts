import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { BEDROCK_DEFAULT_MODEL, readModelConfig } from "./model-config.ts";

describe("the model settings", () => {
  it("are off without a region, so nothing calls the model", () => {
    expect(readModelConfig({})).toEqual({ enabled: false });
    expect(readModelConfig({ KIN_BEDROCK_REGION: "  " })).toEqual({ enabled: false });
  });

  it("name Claude Opus 5.5 on Bedrock unless another model is set", () => {
    expect(readModelConfig({ KIN_BEDROCK_REGION: "us-east-1" })).toEqual({ enabled: true, region: "us-east-1", model: BEDROCK_DEFAULT_MODEL, endpoint: null });
    expect(readModelConfig({ KIN_BEDROCK_REGION: "eu-central-1", KIN_BEDROCK_MODEL: "us.anthropic.claude-opus-5-5" })).toMatchObject({ model: "us.anthropic.claude-opus-5-5" });
  });

  it("refuse a malformed region or model, and a stand-in that is not on this machine", () => {
    expect(() => readModelConfig({ KIN_BEDROCK_REGION: "mars" })).toThrow(ConfigError);
    expect(() => readModelConfig({ KIN_BEDROCK_REGION: "us-east-1", KIN_BEDROCK_MODEL: "claude opus" })).toThrow(ConfigError);
    expect(() => readModelConfig({ KIN_BEDROCK_REGION: "us-east-1", KIN_BEDROCK_ENDPOINT: "https://evil.example" })).toThrow(ConfigError);
    expect(readModelConfig({ KIN_BEDROCK_REGION: "us-east-1", KIN_BEDROCK_ENDPOINT: "http://127.0.0.1:3103" })).toMatchObject({ endpoint: "http://127.0.0.1:3103" });
  });
});
