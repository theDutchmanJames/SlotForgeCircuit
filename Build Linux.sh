#!/usr/bin/env bash
# Builds the SlotForge Circuit Linux .deb (installer) and AppImage (portable app).
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 24 or newer, then run this builder again.' >&2
  exit 1
fi
exec node desktop/build-desktop.cjs "$@"
