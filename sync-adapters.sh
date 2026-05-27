#!/usr/bin/env bash
# Link adapter files into OpenCLI's discovery directory.
# Usage: ./sync-adapters.sh [link|unlink|status]
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADAPTERS_DIR="$PROJECT_DIR/adapters/moonvy"
OPENCLI_DIR="$HOME/.opencli/clis/moonvy"

cmd="${1:-link}"

case "$cmd" in
  link)
    mkdir -p "$OPENCLI_DIR"
    for f in "$ADAPTERS_DIR"/*.js; do
      target="$OPENCLI_DIR/$(basename "$f")"
      if [ -L "$target" ]; then rm "$target"; fi
      ln -s "$f" "$target"
    done
    echo "Linked $(ls "$ADAPTERS_DIR"/*.js | wc -l) adapters to $OPENCLI_DIR"
    ;;
  unlink)
    rm -f "$OPENCLI_DIR"/*.js
    echo "Removed symlinks from $OPENCLI_DIR"
    ;;
  status)
    echo "=== Project adapters ==="
    ls -1 "$ADAPTERS_DIR"/*.js 2>/dev/null | xargs -I{} basename {}
    echo ""
    echo "=== OpenCLI symlinks ==="
    ls -la "$OPENCLI_DIR"/*.js 2>/dev/null || echo "(none)"
    ;;
  *)
    echo "Usage: $0 [link|unlink|status]"
    exit 1
    ;;
esac
