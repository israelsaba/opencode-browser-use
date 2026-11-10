import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Plugin } from "@opencode/plugin";
import type { StoreSecretParams } from "./rpc.js";
import { BrowserUseRpc } from "./rpc.js";

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

export interface ProcessResult {
  stdout: string;
  steps: number;
  provider?: string;
}

export function runProcess(
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<ProcessResult> {
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
      if (code === 0) {
        let steps = 1;
        let provider: string | undefined;
        for (const line of stderr.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("{") && trimmed.includes('"usage"')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.usage?.steps) {
                steps = parsed.usage.steps;
              }
              if (parsed.usage?.provider) {
                provider = parsed.usage.provider;
              }
            } catch {
              // Ignore parse errors on stderr
            }
          }
        }
        resolve({ stdout: stdout.trim(), steps, provider });
      } else {
        reject(
          new Error(
            `Browser runner failed (exit ${code}): ${stderr || stdout}`,
          ),
        );
      }
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
    // Register RPC methods & events for TUI and external clients
    const registration = await ctx.rpc.register(BrowserUseRpc, {
      storeKeychainSecret: async (input) => {
        const { service, secret } = input as StoreSecretParams;
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
            if (code === 0) resolve({});
            else
              reject(
                new Error(`Failed to store Keychain secret (exit ${code})`),
              );
          });
          proc.on("error", (err) => reject(err));
        });
      },
      getActiveProvider: async () => {
        const saved = await ctx.storage.get("provider");
        const provider = (saved as "google" | "jev") || "jev";
        return { provider };
      },
      setActiveProvider: async (input) => {
        const { provider } = input as { provider: "google" | "jev" };
        if (provider !== "google" && provider !== "jev") {
          throw new Error(`Invalid provider: ${provider}`);
        }
        await ctx.storage.set("provider", provider);
        return {};
      },
    });

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
              description: "Engine provider (default: jev or saved default)",
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
          const savedProvider = (await ctx.storage.get("provider")) as
            | "google"
            | "jev"
            | undefined;
          const requestedProvider =
            (input as { provider?: "google" | "jev" }).provider ||
            savedProvider ||
            "jev";
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
            const { stdout: result, steps } = await runProcess(
              args,
              runnerEnv,
              toolCtx.signal,
            );

            // Emit cost/usage event for TUI prompt footer
            const perActionCost = requestedProvider === "jev" ? 0.002 : 0.004;
            const costEstimate = Number((steps * perActionCost).toFixed(4));

            await registration.events.emit("usage", {
              cost: costEstimate,
              steps,
              provider: requestedProvider,
              sessionID: toolCtx.sessionID,
            });

            return { content: result };
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes("is missing from the macOS Keychain")) {
              await registration.events.emit("missing_key", {
                provider: requestedProvider,
                service:
                  requestedProvider === "jev"
                    ? "typesafe_ai_api"
                    : "browser-use-google-api-key",
              });
            }
            throw err;
          }
        },
      });
    });
  },
});
