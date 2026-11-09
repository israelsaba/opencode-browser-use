# opencode-browser-use

![CI](https://github.com/israelsaba/opencode-browser-use/actions/workflows/ci.yml/badge.svg)
![Security](https://github.com/israelsaba/opencode-browser-use/actions/workflows/codeql.yml/badge.svg)
![OpenCode V2](https://img.shields.io/badge/OpenCode-V2%20Compatible-blue.svg)
![Release](https://img.shields.io/github/v/release/israelsaba/opencode-browser-use)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

Official OpenCode V2 dual-engine browser automation plugin powered by **Google Gemini** and **TypeSafe Jev Ultrafast**.

---

## Features

- **Dual Automation Engines**:
  - **Google Gemini**: Multimodal vision-driven Playwright agent (`gemini-flash-lite-latest`).
  - **TypeSafe Jev Ultrafast**: Sub-100ms ultra-low latency action space classifier.
- **Zero Configuration Key Reuse (Waterfall Fallback)**:
  - Automatically reuses Google keys already configured in OpenCode:
    1. Layer 1: Active OpenCode integration connection credential (`google`).
    2. Layer 2: OpenCode provider configuration (`ctx.provider.get({ providerID: "google" })`).
    3. Layer 3: System environment (`GOOGLE_API_KEY`) and macOS Keychain (`browser-use-google-api-key`).
- **Interactive TUI Management (`/browser-use`)**:
  - `/browser-use auth`: Interactive dialogs to configure and save credentials securely in the macOS Keychain (`typesafe_ai_api` or `browser-use-google-api-key`).
  - `/browser-use provider`: Seamlessly toggle between Google Gemini and TypeSafe Jev Ultrafast engines.
  - Running `/browser-use` without arguments opens an interactive selector menu.
- **Auto-Trigger Missing Key Modals**:
  - Emits missing key alerts when a task is executed without the requisite credential, triggering an in-TUI confirmation and input modal so you never have to leave the terminal.
- **Reactive Prompt Footer Badge**:
  - Displays real-time browser actions and estimated spend directly under the prompt box:
    ```text
    · 🌐 Browser: 3 acts ($0.006)
    ```
  - Automatically shifts color from info sky blue (`#38bdf8`) to warning amber (`#fbbf24`) when single-session costs exceed threshold limits ($0.05).
- **Strict Subprocess Containment**:
  - Browser processes are executed with array-based argument vectors, neutralizing shell injection vulnerabilities.

---

## Installation

### Method 1: Local Plugin Directory (Recommended)

Place or symlink the repository into your OpenCode plugins directory:

```bash
mkdir -p ~/.config/opencode/plugins/
git clone https://github.com/israelsaba/opencode-browser-use.git ~/.config/opencode/plugins/browser-use
cd ~/.config/opencode/plugins/browser-use
npm install
npm run build
```

### Method 2: Global Configuration (`opencode.jsonc`)

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-browser-use"
  ]
}
```

---

## Usage

### Slash Command

Within any OpenCode session:

```text
/browser-use
/browser-use auth
/browser-use provider
```

### Tool Execution (`browser_use`)

OpenCode agents automatically invoke `browser_use` for web navigation and inspection tasks:

```json
{
  "task": "Navigate to GitHub trending repositories and extract top 3 TypeScript projects",
  "provider": "google",
  "url": "https://github.com/trending/typescript",
  "headed": false
}
```

---

## Development & Testing

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Run Biome linter and formatter
npm run lint

# Run Vitest test suite
npm test

# Verify Python runner compilation
python3 -m py_compile python/run.py
```

---

## License

[MIT](LICENSE) © 2026 Israel Saba
