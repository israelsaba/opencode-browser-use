#!/bin/bash
# Wrapper script to start the browser-use MCP server.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server="$script_dir/python/mcp_server.py"

if [ ! -f "$server" ]; then
    echo "MCP server script not found at $server" >&2
    exit 127
fi

py="${PYTHON3:-python3}"
if ! command -v "$py" >/dev/null 2>&1; then
    echo "python3 not found (tried: $py)" >&2
    exit 127
fi

exec "$py" "$server" "$@"
