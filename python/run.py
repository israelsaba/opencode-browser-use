#!/usr/bin/env python3
"""Run a local open-source Browser Use task with Google (Gemini) or Jev Ultrafast (TypeSafe)."""

from __future__ import annotations

import argparse
import asyncio
import base64
from dataclasses import dataclass, field
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any, Protocol

from browser_use import Agent as GoogleAgent, BrowserProfile, ChatGoogle
from browser_use.browser.profile import ProxySettings, ViewportSize

# Load .env files if present (cwd, skill directory, and ~/.config/opencode/.env)
def _load_env() -> None:
    candidate_paths = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent / ".env",
        Path("~/.config/opencode/.env").expanduser(),
    ]
    try:
        from dotenv import load_dotenv
        for p in candidate_paths:
            if p.is_file():
                load_dotenv(p, override=False)
    except ImportError:
        for p in candidate_paths:
            if p.is_file():
                for line in p.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip("'\""))

_load_env()

KEYCHAIN_SERVICE_GOOGLE = "browser-use-google-api-key"
KEYCHAIN_SERVICE_TYPESAFE = "typesafe_ai_api"
KEYCHAIN_SERVICE_TYPESAFE_FALLBACK = "browser-use-typesafe-api-key"


def get_keychain_secret(
    service: str,
    fallback_services: list[str] | None = None,
    env_var: str | None = None,
    label: str | None = None,
) -> str:
    """Retrieve an API secret from the macOS Keychain or environment fallback."""
    if env_var and os.environ.get(env_var):
        val = os.environ[env_var].strip()
        if val:
            return val

    services = [service] + (fallback_services or [])
    for svc in services:
        try:
            result = subprocess.run(
                [
                    "/usr/bin/security",
                    "find-generic-password",
                    "-a",
                    getpass.getuser(),
                    "-s",
                    svc,
                    "-w",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            api_key = result.stdout.strip()
            if api_key:
                return api_key
        except FileNotFoundError as exc:
            raise RuntimeError("macOS security command was not found") from exc
        except subprocess.CalledProcessError:
            continue

    lbl = label or f"Secret '{service}'"
    env_msg = f" or export {env_var}" if env_var else ""
    raise RuntimeError(
        f"{lbl} is missing from the macOS Keychain. "
        f"Store it with:\n  security add-generic-password -a \"$USER\" -s \"{service}\" -w{env_msg}"
    )


def try_get_keychain_secret(
    service: str,
    fallback_services: list[str] | None = None,
    env_var: str | None = None,
) -> str | None:
    """Attempt to retrieve an API secret; return None if unavailable."""
    try:
        return get_keychain_secret(service, fallback_services, env_var)
    except Exception:
        return None


@dataclass
class BrowserOptions:
    max_steps: int = 100
    headed: bool = False
    manual_captcha: bool = False
    screenshots_dir: Path | None = None
    record_video_dir: Path | None = None
    record_video_framerate: int = 30
    record_har_path: Path | None = None
    traces_dir: Path | None = None
    downloads_path: Path | None = None
    storage_state: Path | None = None
    viewport: ViewportSize | None = None
    window_size: ViewportSize | None = None
    allowed_domains: list[str] = field(default_factory=list)
    prohibited_domains: list[str] = field(default_factory=list)
    proxy_server: str | None = None
    no_vision: bool = False
    wait_page_load: float = 0.1
    wait_between_actions: float = 0.1
    url: str | None = None


def parse_size(value: str | None) -> ViewportSize | None:
    if value is None:
        return None
    match = re.fullmatch(r"(\d+)x(\d+)", value)
    if match is None:
        raise ValueError(f"Size must use WIDTHxHEIGHT format: {value}")
    return ViewportSize(width=int(match.group(1)), height=int(match.group(2)))


def save_screenshots_from_history(history: object, output_dir: Path | None) -> list[Path]:
    if output_dir is None:
        return []

    screenshots = history.screenshots()  # type: ignore[attr-defined]
    output_dir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    for index, screenshot in enumerate(screenshots, start=1):
        if not screenshot:
            continue
        if isinstance(screenshot, bytes):
            data = screenshot
        else:
            encoded = str(screenshot).split(",", 1)[-1]
            data = base64.b64decode(encoded)
        path = output_dir / f"screenshot-{index:03d}.png"
        path.write_bytes(data)
        saved.append(path)
    return saved


class BrowserProvider(Protocol):
    """Protocol for pluggable browser agent backends."""

    async def run(self, task: str, options: BrowserOptions) -> str:
        ...


class GoogleBrowserProvider:
    """Browser Use runner using Google Gemini."""

    async def run(self, task: str, options: BrowserOptions) -> str:
        api_key = get_keychain_secret(
            service=KEYCHAIN_SERVICE_GOOGLE,
            env_var="GOOGLE_API_KEY",
            label="Google API key",
        )

        if options.manual_captcha:
            task = (
                f"{task}\n\n"
                "If a CAPTCHA, bot check, or anti-automation challenge appears, "
                "stop immediately and report that manual completion is required. "
                "Do not attempt to bypass, defeat, or automate the challenge."
            )

        agent = GoogleAgent(
            task=task,
            llm=ChatGoogle(model="gemini-flash-lite-latest", api_key=api_key),
            flash_mode=True,
            use_vision=not options.no_vision,
            browser_profile=BrowserProfile(
                minimum_wait_page_load_time=options.wait_page_load,
                wait_between_actions=options.wait_between_actions,
                headless=not (options.headed or options.manual_captcha),
                viewport=options.viewport,
                window_size=options.window_size,
                record_video_dir=options.record_video_dir,
                record_video_framerate=options.record_video_framerate,
                record_har_path=options.record_har_path,
                traces_dir=options.traces_dir,
                downloads_path=options.downloads_path,
                storage_state=options.storage_state,
                allowed_domains=options.allowed_domains or None,
                prohibited_domains=options.prohibited_domains or None,
                proxy=ProxySettings(server=options.proxy_server) if options.proxy_server else None,
                captcha_solver=False,
                is_local=True,
            ),
        )

        history = await agent.run(max_steps=options.max_steps)
        saved_screenshots = save_screenshots_from_history(history, options.screenshots_dir)
        if saved_screenshots:
            print(
                json.dumps({"screenshots": [str(path) for path in saved_screenshots]}),
                file=sys.stderr,
            )

        result = history.final_result()
        if result is None:
            raise RuntimeError(
                "Browser Use finished without a final result "
                f"(done={history.is_done()}, successful={history.is_successful()})"
            )
        return str(result)


class JevBrowserProvider:
    """Ultrafast browser runner using TypeSafe Jev (https://github.com/browser-use/jev-ultrafast)."""

    async def run(self, task: str, options: BrowserOptions) -> str:
        try:
            from jev_ultrafast import Agent as JevAgent
        except ImportError as exc:
            raise RuntimeError(
                "jev-ultrafast is not installed. Install with:\n"
                "  uv pip install 'git+https://github.com/browser-use/jev-ultrafast.git' 'browser-harness==0.1.13'"
            ) from exc

        # 1. Authenticate TypeSafe API key
        typesafe_key = get_keychain_secret(
            service=KEYCHAIN_SERVICE_TYPESAFE,
            fallback_services=[KEYCHAIN_SERVICE_TYPESAFE_FALLBACK],
            env_var="TYPESAFE_API_KEY",
            label="TypeSafe API key (typesafe_ai_api)",
        )
        os.environ["TYPESAFE_API_KEY"] = typesafe_key

        # 2. Configure text model helper (for TYPE_TEXT operations)
        # Jev calls an OpenAI-compatible /chat/completions endpoint for typing.
        if not os.environ.get("TEXT_MODEL_API_KEY"):
            # Check if user has Google API key in Keychain; Gemini provides an OpenAI-compatible endpoint!
            google_key = try_get_keychain_secret(
                service=KEYCHAIN_SERVICE_GOOGLE,
                env_var="GOOGLE_API_KEY",
            )
            if google_key:
                os.environ["TEXT_MODEL_API_KEY"] = google_key
                os.environ["TEXT_MODEL_BASE_URL"] = "https://generativelanguage.googleapis.com/v1beta/openai"
                os.environ.setdefault("TEXT_MODEL", "gemini-2.5-flash")
                os.environ.setdefault("TEXT_MODEL_REASONING", "none")
            else:
                text_key = try_get_keychain_secret(
                    service="browser-use-text-model-api-key",
                    env_var="TEXT_MODEL_API_KEY",
                )
                if text_key:
                    os.environ["TEXT_MODEL_API_KEY"] = text_key

        # 3. Determine target URL
        url = options.url
        if not url:
            # Extract first URL found in task text
            match = re.search(r"https?://[^\s]+", task)
            if match:
                url = match.group(0).rstrip(".,'\")>]")
            else:
                url = "https://www.google.com"

        # 4. Execute the Jev agent loop
        return await asyncio.to_thread(self._run_jev_sync, JevAgent, url, task, options)

    def _run_jev_sync(self, agent_cls: Any, url: str, task: str, options: BrowserOptions) -> str:
        record_dir = options.record_video_dir or options.traces_dir
        screenshots_enabled = bool(options.screenshots_dir) or bool(record_dir)

        saved_screenshots: list[Path] = []
        if options.screenshots_dir:
            options.screenshots_dir.mkdir(parents=True, exist_ok=True)

        with agent_cls(url, task, record_dir=record_dir, screenshots=screenshots_enabled) as agent:
            step_count = 0
            last_state = agent.snapshot()

            if options.screenshots_dir and last_state.get("page", {}).get("screenshot"):
                path = options.screenshots_dir / "screenshot-000.jpg"
                path.write_bytes(base64.b64decode(last_state["page"]["screenshot"]))
                saved_screenshots.append(path)

            for state in agent.run():
                step_count += 1
                last_state = state
                if options.screenshots_dir and state.get("page", {}).get("screenshot"):
                    path = options.screenshots_dir / f"screenshot-{step_count:03d}.jpg"
                    path.write_bytes(base64.b64decode(state["page"]["screenshot"]))
                    saved_screenshots.append(path)
                if step_count >= options.max_steps:
                    break

        if saved_screenshots:
            print(
                json.dumps({"screenshots": [str(path) for path in saved_screenshots]}),
                file=sys.stderr,
            )

        status = last_state.get("status")
        if status == "blocked":
            raise RuntimeError(
                f"Jev stopped in BLOCKED state after {step_count} actions. "
                f"Final URL: {last_state.get('page', {}).get('url')}"
            )

        page = last_state.get("page", {})
        final_url = page.get("url", url)
        final_title = page.get("title", "")
        history = last_state.get("history", [])

        actions_taken = [
            f"Step {h.get('step')}: {h.get('action')}" + (f" -> '{h.get('text')}'" if h.get("text") else "")
            for h in history
            if h.get("action")
        ]

        result_sections = [
            f"Goal: {task}",
            f"Status: {status.upper() if status else 'COMPLETED'}",
            f"Destination: {final_title} ({final_url})",
            f"Actions Executed ({len(actions_taken)}):",
            *actions_taken,
        ]

        page_text = page.get("text", "").strip()
        if page_text:
            snippet = page_text[:2000]
            result_sections.append(f"\nVisible Content:\n{snippet}")

        return "\n".join(result_sections)


# Provider Registry
PROVIDERS: dict[str, type[BrowserProvider]] = {
    "google": GoogleBrowserProvider,
    "jev": JevBrowserProvider,
}


def resolve_provider(cli_provider: str | None) -> str:
    """Resolve provider from CLI flag, env var, or default ('google')."""
    provider = cli_provider or os.environ.get("BROWSER_USE_PROVIDER") or "google"
    normalized = provider.strip().lower()
    if normalized not in PROVIDERS:
        valid = ", ".join(PROVIDERS.keys())
        raise ValueError(
            f"Unknown provider '{provider}'. Must be one of: {valid}. "
            "Set via --provider or $BROWSER_USE_PROVIDER."
        )
    return normalized


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a local Browser Use task with Google Gemini or TypeSafe Jev Ultrafast."
    )
    parser.add_argument(
        "task",
        nargs="*",
        help="Task text. If omitted, read the task from standard input.",
    )
    parser.add_argument(
        "--provider",
        choices=["google", "jev"],
        type=str.lower,
        default=None,
        help="Browser agent provider ('google' or 'jev'). Defaults to $BROWSER_USE_PROVIDER or 'google'.",
    )
    parser.add_argument(
        "--url",
        help="Initial URL to navigate to (optional; auto-detected from task or defaults to https://www.google.com).",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=100,
        help="Maximum agent steps (default: 100).",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Show the browser window instead of running headless.",
    )
    parser.add_argument(
        "--manual-captcha",
        action="store_true",
        help="Show the browser and stop if a CAPTCHA or bot check appears.",
    )
    parser.add_argument("--screenshots-dir", type=Path)
    parser.add_argument("--record-video-dir", type=Path)
    parser.add_argument("--record-video-framerate", type=int, default=30)
    parser.add_argument("--record-har-path", type=Path)
    parser.add_argument("--traces-dir", type=Path)
    parser.add_argument("--downloads-path", type=Path)
    parser.add_argument("--storage-state", type=Path)
    parser.add_argument("--viewport", metavar="WIDTHxHEIGHT")
    parser.add_argument("--window-size", metavar="WIDTHxHEIGHT")
    parser.add_argument("--allowed-domain", action="append", default=[])
    parser.add_argument("--prohibited-domain", action="append", default=[])
    parser.add_argument("--proxy-server")
    parser.add_argument("--no-vision", action="store_true")
    parser.add_argument("--wait-page-load", type=float, default=0.1)
    parser.add_argument("--wait-between-actions", type=float, default=0.1)
    return parser.parse_args()


async def run(provider_name: str, task: str, options: BrowserOptions) -> str:
    provider_cls = PROVIDERS[provider_name]
    provider = provider_cls()
    return await provider.run(task, options)


def main() -> int:
    args = parse_args()

    task = " ".join(args.task).strip()
    if not task and not sys.stdin.isatty():
        task = sys.stdin.read().strip()
    if not task:
        print("Provide a task argument or pipe one on standard input.", file=sys.stderr)
        return 2

    try:
        provider_name = resolve_provider(args.provider)
        options = BrowserOptions(
            max_steps=args.max_steps,
            headed=args.headed,
            manual_captcha=args.manual_captcha,
            screenshots_dir=args.screenshots_dir,
            record_video_dir=args.record_video_dir,
            record_video_framerate=args.record_video_framerate,
            record_har_path=args.record_har_path,
            traces_dir=args.traces_dir,
            downloads_path=args.downloads_path,
            storage_state=args.storage_state,
            viewport=parse_size(args.viewport),
            window_size=parse_size(args.window_size),
            allowed_domains=args.allowed_domain,
            prohibited_domains=args.prohibited_domain,
            proxy_server=args.proxy_server,
            no_vision=args.no_vision,
            wait_page_load=args.wait_page_load,
            wait_between_actions=args.wait_between_actions,
            url=args.url,
        )
        result = asyncio.run(run(provider_name, task, options))
    except Exception as exc:
        print(f"browser-use: {exc}", file=sys.stderr)
        return 1

    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
