import { Plugin } from "@opencode/plugin/tui";
import type { BrowserUseUsageEvent, MissingKeyEvent } from "./rpc.js";
import { BrowserUseRpc } from "./rpc.js";

interface SessionBrowserStats {
  steps: number;
  cost: number;
  provider?: "google" | "jev";
}

interface BrowserStore {
  bySession: Record<string, SessionBrowserStats>;
}

export default Plugin.define({
  id: "browser-use.tui",
  setup(context) {
    const [stats, setStats] = context.storage.store<BrowserStore>(
      "browser_use_stats",
      {
        initial: {
          bySession: {},
        },
      },
    );

    const rpc = context.client.rpc(BrowserUseRpc);

    // Listen to usage events from the server plugin
    const stopUsage = rpc.events.on("usage", (event) => {
      const usage = event.data as unknown as BrowserUseUsageEvent;
      const steps = usage.steps || 1;
      const cost = usage.cost || 0;
      const sid = usage.sessionID;
      const provider = usage.provider || "jev";

      if (sid) {
        void setStats((draft) => {
          const prev = draft.bySession[sid] || { steps: 0, cost: 0, provider };
          draft.bySession[sid] = {
            steps: prev.steps + steps,
            cost: Number((prev.cost + cost).toFixed(4)),
            provider,
          };
        });
      }
    });

    // Listen for missing key events and prompt user immediately
    const stopMissingKey = rpc.events.on("missing_key", async (event) => {
      const missing = event.data as unknown as MissingKeyEvent;
      const confirm = await context.ui.dialog.confirm({
        title: "Browser Use: Key Missing",
        message: `The ${missing.provider.toUpperCase()} API key (${missing.service}) is missing from Keychain. Configure it now?`,
        label: { confirm: "Enter Key", cancel: "Cancel" },
      });
      if (!confirm) return;

      const secret = await context.ui.dialog.prompt({
        title: `Enter ${missing.provider.toUpperCase()} API Key`,
        placeholder:
          "Paste key here (will be stored securely in macOS Keychain)...",
      });
      if (!secret) return;

      await rpc.storeKeychainSecret({ service: missing.service, secret });

      context.ui.toast.show({
        title: "Browser Use",
        message: `${missing.service} saved to macOS Keychain!`,
        variant: "success",
      });
    });

    // Register unified /browser-use <auth|provider> slash command
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "browser-use.command",
          title: "Browser Use Settings",
          slash: { name: "browser-use", arguments: true },
          run: async (input?: string) => {
            const sub = input?.trim().toLowerCase();
            if (sub === "auth") {
              await promptAuth(context, rpc);
            } else if (sub === "provider") {
              await promptProvider(context, rpc);
            } else {
              const choice = await context.ui.dialog.select({
                title: "Browser Use Settings",
                options: [
                  {
                    title: "Configure API Keys",
                    value: "auth",
                    description:
                      "Store TypeSafe or Gemini keys in macOS Keychain",
                  },
                  {
                    title: "Select Default Provider",
                    value: "provider",
                    description:
                      "Choose between Google Gemini and TypeSafe Jev",
                  },
                ],
              });
              if (choice === "auth") await promptAuth(context, rpc);
              if (choice === "provider") await promptProvider(context, rpc);
            }
          },
        },
      ],
    }));

    // Mount token/cost counter in the prompt footer status slot
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        const sid = input?.sessionID;
        if (!sid) return null;

        // Check stored session stats
        const sessionStats = stats.bySession[sid];
        let steps = sessionStats?.steps ?? 0;
        let cost = sessionStats?.cost ?? 0;
        let historicalProvider: "google" | "jev" = "jev";

        // If not in store yet or 0, inspect session messages for historical tool calls
        if (steps === 0) {
          try {
            const msgs = context.data.session.message.list(sid) ?? [];
            let callCount = 0;
            for (const m of msgs) {
              if (m.type === "assistant" && Array.isArray((m as any).content)) {
                for (const part of (m as any).content) {
                  if (part.type === "tool") {
                    if (
                      part.name === "browser_use" ||
                      part.name === "browser-use"
                    ) {
                      callCount++;
                      if (part.state?.input?.provider === "google") {
                        historicalProvider = "google";
                      }
                    } else if (part.name === "execute") {
                      const inputStr = JSON.stringify(part.state?.input ?? "");
                      if (
                        inputStr.includes("browser_use") ||
                        inputStr.includes("browser-use")
                      ) {
                        callCount++;
                        if (
                          inputStr.includes('"provider":"google"') ||
                          inputStr.includes('"provider": "google"')
                        ) {
                          historicalProvider = "google";
                        }
                      }
                    }
                  }
                }
              }
            }
            if (callCount > 0) {
              steps = callCount;
              cost = Number((callCount * 0.004).toFixed(4));
            }
          } catch {
            // Data sync or parse fallback
          }
        }

        if (steps === 0) return null;

        const provider = sessionStats?.provider ?? historicalProvider;
        const providerLabel = provider === "jev" ? "JEV" : "Google";
        const roundedCost = (Math.ceil(cost * 100) / 100).toFixed(2);

        return (
          <text fg={context.theme.text.muted}>
            {`browser-use: $${roundedCost}·${providerLabel}`}
          </text>
        );
      },
    });

    return () => {
      stopUsage();
      stopMissingKey();
    };
  },
});

async function promptAuth(context: any, rpc: any) {
  const provider = await context.ui.dialog.select({
    title: "Select Key to Configure",
    options: [
      { title: "TypeSafe Jev (typesafe_ai_api)", value: "typesafe_ai_api" },
      {
        title: "Google Gemini (browser-use-google-api-key)",
        value: "browser-use-google-api-key",
      },
    ],
  });
  if (!provider) return;

  const secret = await context.ui.dialog.prompt({
    title: `Enter API Key for ${provider}`,
    placeholder: "Paste key here...",
  });
  if (!secret) return;

  await rpc.storeKeychainSecret({ service: provider, secret });
  context.ui.toast.show({
    title: "Browser Use",
    message: `Saved ${provider} to Keychain`,
    variant: "success",
  });
}

async function promptProvider(context: any, rpc: any) {
  const choice = await context.ui.dialog.select({
    title: "Select Active Provider",
    options: [
      {
        title: "TypeSafe Jev Ultrafast (Recommended)",
        value: "jev",
        description: "Sub-100ms action space classifier",
      },
      {
        title: "Google Gemini (gemini-flash-lite-latest)",
        value: "google",
        description: "Multimodal Playwright agent",
      },
    ],
  });
  if (!choice) return;

  await rpc.setActiveProvider({ provider: choice as "google" | "jev" });
  context.ui.toast.show({
    title: "Browser Use",
    message: `Default provider set to ${choice.toUpperCase()}`,
    variant: "success",
  });
}
