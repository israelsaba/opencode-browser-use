import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Plugin } from "@opencode/plugin";
import type { BrowserUseRpc, StoreSecretParams } from "./rpc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function resolveGoogleKey(
  ctx: Plugin.Context,
): Promise<string | undefined> {
  // 1. Check OpenCode's active integration connection (OAuth / stored keys)
  const connection = await ctx.integration.connection.active("google");
  if (connection) {
    const cred = await ctx.integration.connection.resolve(connection);
    if (typeof cred === "string") return cred;
    if (cred && typeof cred === "object" && "apiKey" in cred) {
      return (cred as { apiKey: string }).apiKey;
    }
  }

  // 2. Check OpenCode's provider configuration
  const provider = await ctx.provider.get({ providerID: "google" });
  const providerSettings = (provider?.data?.settings ||
    (provider as any)?.settings) as Record<string, unknown> | undefined;
  if (providerSettings?.apiKey && typeof providerSettings.apiKey === "string") {
    return providerSettings.apiKey;
  }

  // 3. Fallback to process environment or macOS Keychain
  return process.env.GOOGLE_API_KEY;
}

export function runProcess(
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", args, { env, signal });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => {
      stdout += d;
    });
    proc.stderr?.on("data", (d) => {
      stderr += d;
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `Browser runner failed (exit ${code}): ${stderr || stdout}`,
          ),
        );
    });
    proc.on("error", (err) => {
      reject(err);
    });
  });
}

export function buildRunnerArgs(
  runnerPath: string,
  task: string,
  provider: "google" | "jev",
  url?: string,
  headed?: boolean,
): string[] {
  const args = [runnerPath, "--provider", provider, task];
  if (url) args.push("--url", url);
  if (headed) args.push("--headed");
  return args;
}

export default Plugin.define({
  id: "browser-use",
  async setup(ctx: Plugin.Context) {
    // Implement RPC methods for TUI
    const rpc: BrowserUseRpc = {
      async storeKeychainSecret({ service, secret }: StoreSecretParams) {
        if (!service || !secret) {
          throw new Error(
            "Invalid parameters: service and secret are required",
          );
        }
        return new Promise((resolve, reject) => {
          const proc = spawn("/usr/bin/security", [
            "add-generic-password",
            "-U",
            "-a",
            process.env.USER || "",
            "-s",
            service,
            "-w",
            secret,
          ]);
          proc.on("close", (code) => {
            if (code === 0) resolve();
            else
              reject(
                new Error(`Failed to store Keychain secret (exit ${code})`),
              );
          });
          proc.on("error", (err) => reject(err));
        });
      },
      async getActiveProvider() {
        const saved = await ctx.storage.get("provider");
        return (saved as "google" | "jev") || "google";
      },
      async setActiveProvider(provider: "google" | "jev") {
        if (provider !== "google" && provider !== "jev") {
          throw new Error(`Invalid provider: ${provider}`);
        }
        await ctx.storage.set("provider", provider);
      },
    };

    // Register tool transform
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "browser_use",
        description:
          "Automate web tasks using Google Gemini or TypeSafe Jev Ultrafast.",
        input: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "The goal or question to execute in the browser.",
            },
            provider: {
              type: "string",
              enum: ["google", "jev"],
              description: "Engine provider (default: google or saved default)",
            },
            url: { type: "string", description: "Optional starting URL." },
            headed: {
              type: "boolean",
              description: "Show browser window.",
              default: false,
            },
          },
          required: ["task"],
          additionalProperties: false,
        },
        execute: async (input, toolCtx) => {
          const task = (input as { task: string }).task;
          const requestedProvider =
            (input as { provider?: "google" | "jev" }).provider ||
            (await rpc.getActiveProvider());
          const url = (input as { url?: string }).url;
          const headed = (input as { headed?: boolean }).headed;

          // Gate execution with OpenCode permission rules
          await ctx.permission.assert({
            sessionID: toolCtx.sessionID,
            action: "browser_use",
            resources: [url || "web"],
          });

          // Build process environment with OpenCode provider key reuse
          const runnerEnv = { ...process.env };
          const googleKey = await resolveGoogleKey(ctx);
          if (googleKey) {
            runnerEnv.GOOGLE_API_KEY = googleKey;
          }

          const runnerPath = join(__dirname, "../python/run.py");
          const args = buildRunnerArgs(
            runnerPath,
            task,
            requestedProvider,
            url,
            headed,
          );

          try {
            const result = await runProcess(args, runnerEnv, toolCtx.signal);

            // Emit cost/usage event for TUI prompt footer
            const costEstimate = requestedProvider === "jev" ? 0.002 : 0.004;
            const emitFn = (ctx as any).event?.emit;
            if (typeof emitFn === "function") {
              await emitFn("browser-use:usage", {
                cost: costEstimate,
                steps: 1,
                provider: requestedProvider,
              });
            }

            return { content: result };
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes("is missing from the macOS Keychain")) {
              const emitFn = (ctx as any).event?.emit;
              if (typeof emitFn === "function") {
                await emitFn("browser-use:missing-key", {
                  provider: requestedProvider,
                  service:
                    requestedProvider === "jev"
                      ? "typesafe_ai_api"
                      : "browser-use-google-api-key",
                });
              }
            }
            throw err;
          }
        },
      });
    });

    return () => {};
  },
});
