import { Rpc } from "@opencode/plugin/rpc";

export const BrowserUseRpc = Rpc.define({
  id: "browser-use",
  methods: {
    storeKeychainSecret: {
      input: {
        type: "object",
        properties: {
          service: { type: "string" },
          secret: { type: "string" },
        },
        required: ["service", "secret"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        additionalProperties: false,
      },
    },
    getActiveProvider: {
      input: {
        type: "object",
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["google", "jev"] },
        },
        required: ["provider"],
        additionalProperties: false,
      },
    },
    setActiveProvider: {
      input: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["google", "jev"] },
        },
        required: ["provider"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        additionalProperties: false,
      },
    },
  },
  events: {
    usage: {
      schema: {
        type: "object",
        properties: {
          cost: { type: "number" },
          steps: { type: "number" },
          provider: { type: "string" },
          sessionID: { type: "string" },
        },
        required: ["cost", "steps", "provider"],
        additionalProperties: true,
      },
    },
    missing_key: {
      schema: {
        type: "object",
        properties: {
          provider: { type: "string" },
          service: { type: "string" },
        },
        required: ["provider", "service"],
        additionalProperties: false,
      },
    },
  },
});

export interface BrowserUseUsageEvent {
  cost: number;
  steps: number;
  provider: "google" | "jev";
  sessionID?: string;
}

export interface MissingKeyEvent {
  provider: "google" | "jev";
  service: "typesafe_ai_api" | "browser-use-google-api-key";
}

export interface StoreSecretParams {
  service: string;
  secret: string;
}
