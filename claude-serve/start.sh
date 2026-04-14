#!/bin/bash
# Wrapper script for launchd: builds full shell environment

# Load shell profile for full environment
if [ -f ~/.zprofile ]; then source ~/.zprofile 2>/dev/null; fi
if [ -f ~/.zshrc ]; then source ~/.zshrc 2>/dev/null; fi
if [ -f ~/.bash_profile ]; then source ~/.bash_profile 2>/dev/null; fi

# Ensure common paths are in PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

# nvm node path (if nvm installed)
if [ -d "$HOME/.nvm" ]; then
  NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//')
  if [ -n "$NODE_VERSION" ] && [ -d "$HOME/.nvm/versions/node/v${NODE_VERSION}/bin" ]; then
    export PATH="$HOME/.nvm/versions/node/v${NODE_VERSION}/bin:${PATH}"
  fi
fi

# Additional tool paths
[ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:${PATH}"
[ -d "$HOME/.local/bin" ] && export PATH="$HOME/.local/bin:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "${SCRIPT_DIR}/server.js"
