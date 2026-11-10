#!/usr/bin/env python3
"""MCP server for browser automation with Google Gemini and TypeSafe Jev Ultrafast."""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

from mcp.server.fastmcp import FastMCP

# Ensure python directory is in sys.path to import from run.py
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from run import BrowserOptions, resolve_provider, run

mcp = FastMCP(
    name="browser-use",
    instructions=(
        "Automate web tasks using Google Gemini (multimodal Playwright) or TypeSafe Jev Ultrafast. "
        "Allows navigating, clicking, typing, extracting data, and verifying web pages."
    ),
)


@mcp.tool()
async def browser_use(
    task: str,
    provider: str = "google",
    url: str | None = None,
    headed: bool = False,
) -> str:
    """Automate web tasks using Google Gemini or TypeSafe Jev Ultrafast.

    Args:
        task: The goal or question to execute in the browser.
        provider: Engine provider ('google' or 'jev'). Defaults to 'google'.
        url: Optional starting URL to navigate to.
        headed: Show the browser window (defaults to False for headless).

    Returns:
        The result string or extracted content from the browser execution.
    """
    prov = resolve_provider(provider)
    options = BrowserOptions(
        headed=headed,
        url=url,
    )
    return await run(prov, task, options)


if __name__ == "__main__":
    mcp.run(transport="stdio")
