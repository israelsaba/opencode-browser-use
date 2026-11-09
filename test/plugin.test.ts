import type { Plugin } from "@opencode/plugin";
import { describe, expect, it, vi } from "vitest";
import { buildRunnerArgs, resolveGoogleKey } from "../src/index.js";

describe("Browser Use Plugin", () => {
  describe("buildRunnerArgs (Injection safety & array construction)", () => {
    it("constructs process arguments correctly without shell concatenation", () => {
      const runner = "/path/to/python/run.py";
      const task = "Search for latest AI papers";
      const args = buildRunnerArgs(
        runner,
        task,
        "google",
        "https://arxiv.org",
        true,
      );

      expect(args).toEqual([
        runner,
        "--provider",
        "google",
        task,
        "--url",
        "https://arxiv.org",
        "--headed",
      ]);
    });

    it("prevents shell injection payloads by keeping them contained in array elements", () => {
      const runner = "/path/to/python/run.py";
      const injectionPayload = "test; rm -rf / && echo $(whoami)";
      const maliciousUrl =
        "https://example.com/login?param=1&evil=$(cat /etc/passwd)";

      const args = buildRunnerArgs(
        runner,
        injectionPayload,
        "jev",
        maliciousUrl,
        false,
      );

      // Verify that shell metacharacters are NOT split or parsed as commands
      expect(args[0]).toBe(runner);
      expect(args[1]).toBe("--provider");
      expect(args[2]).toBe("jev");
      expect(args[3]).toBe(injectionPayload);
      expect(args[4]).toBe("--url");
      expect(args[5]).toBe(maliciousUrl);
      expect(args.length).toBe(6);
    });
  });

  describe("resolveGoogleKey waterfall fallback", () => {
    it("Layer 1: resolves active OpenCode integration credential", async () => {
      const mockCtx = {
        integration: {
          connection: {
            active: vi.fn().mockResolvedValue("google-conn-id"),
            resolve: vi.fn().mockResolvedValue("google-secret-oauth-key"),
          },
        },
        provider: {
          get: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Plugin.Context;

      const key = await resolveGoogleKey(mockCtx);
      expect(key).toBe("google-secret-oauth-key");
    });

    it("Layer 1 (object): resolves active credential object with apiKey", async () => {
      const mockCtx = {
        integration: {
          connection: {
            active: vi.fn().mockResolvedValue("google-conn-id"),
            resolve: vi
              .fn()
              .mockResolvedValue({ apiKey: "google-api-key-object" }),
          },
        },
        provider: {
          get: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Plugin.Context;

      const key = await resolveGoogleKey(mockCtx);
      expect(key).toBe("google-api-key-object");
    });

    it("Layer 2: falls back to OpenCode provider settings if connection is absent", async () => {
      const mockCtx = {
        integration: {
          connection: {
            active: vi.fn().mockResolvedValue(undefined),
            resolve: vi.fn(),
          },
        },
        provider: {
          get: vi.fn().mockResolvedValue({
            settings: { apiKey: "provider-configured-key" },
          }),
        },
      } as unknown as Plugin.Context;

      const key = await resolveGoogleKey(mockCtx);
      expect(key).toBe("provider-configured-key");
    });

    it("Layer 3: falls back to process.env.GOOGLE_API_KEY when OpenCode has no keys", async () => {
      const prev = process.env.GOOGLE_API_KEY;
      try {
        process.env.GOOGLE_API_KEY = "env-google-key-12345";
        const mockCtx = {
          integration: {
            connection: {
              active: vi.fn().mockResolvedValue(undefined),
              resolve: vi.fn(),
            },
          },
          provider: {
            get: vi.fn().mockResolvedValue(undefined),
          },
        } as unknown as Plugin.Context;

        const key = await resolveGoogleKey(mockCtx);
        expect(key).toBe("env-google-key-12345");
      } finally {
        if (prev !== undefined) process.env.GOOGLE_API_KEY = prev;
        else process.env.GOOGLE_API_KEY = "";
      }
    });
  });
});
