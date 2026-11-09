import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import type { BrowserUseUsageEvent, MissingKeyEvent } from "./rpc.js";

export default Plugin.define({
  id: "browser-use.tui",
  setup(context) {
    const [stats, setStats] = createSignal<{ steps: number; cost: number }>({
      steps: 0,
      cost: 0,
    });

    // Listen to usage events from the server plugin
    context.data.on("browser-use:usage" as any, (event: any) => {
      const usage = event as BrowserUseUsageEvent;
      setStats((prev) => ({
        steps: prev.steps + (usage.steps || 1),
        cost: prev.cost + (usage.cost || 0),
      }));
    });

    // Listen for missing key events and prompt user immediately
    context.data.on("browser-use:missing-key" as any, async (event: any) => {
      const missing = event as MissingKeyEvent;
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

      await (context.client as any).plugin?.call?.({
        id: "browser-use",
        method: "storeKeychainSecret",
        params: { service: missing.service, secret },
      });

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
              await promptAuth(context);
            } else if (sub === "provider") {
              await promptProvider(context);
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
              if (choice === "auth") await promptAuth(context);
              if (choice === "provider") await promptProvider(context);
            }
          },
        },
      ],
    }));

    // Mount token/cost counter in the prompt footer status slot
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const current = stats();
        if (current.steps === 0) return null;

        // Default info (Sky Blue), amber if single-session cost exceeds $0.05
        const color =
          current.cost > 0.05
            ? context.theme.warning
            : (context.theme.info ?? "#38bdf8");

        return (
          <text fg={color}>
            {` · 🌐 Browser: ${current.steps} acts ($${current.cost.toFixed(3)})`}
          </text>
        );
      },
    });
  },
});

async function promptAuth(context: any) {
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

  await (context.client as any).plugin?.call?.({
    id: "browser-use",
    method: "storeKeychainSecret",
    params: { service: provider, secret },
  });
  context.ui.toast.show({
    title: "Browser Use",
    message: `Saved ${provider} to Keychain`,
    variant: "success",
  });
}

async function promptProvider(context: any) {
  const choice = await context.ui.dialog.select({
    title: "Select Active Provider",
    options: [
      {
        title: "Google Gemini (gemini-flash-lite-latest)",
        value: "google",
        description: "Multimodal Playwright agent",
      },
      {
        title: "TypeSafe Jev Ultrafast",
        value: "jev",
        description: "Sub-100ms action space classifier",
      },
    ],
  });
  if (!choice) return;

  await (context.client as any).plugin?.call?.({
    id: "browser-use",
    method: "setActiveProvider",
    params: choice as "google" | "jev",
  });
  context.ui.toast.show({
    title: "Browser Use",
    message: `Default provider set to ${choice}`,
    variant: "success",
  });
}
