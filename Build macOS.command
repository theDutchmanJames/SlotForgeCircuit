#!/usr/bin/env bash
# Builds the SlotForge Circuit macOS DMG (installer) and ZIP (portable app).
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 24 or newer from https://nodejs.org, then run this builder again.' >&2
  if [ -t 0 ]; then read -r -p 'Press Enter to close. ' reply; fi
  exit 1
fi
exec node desktop/build-desktop.cjs "$@"
