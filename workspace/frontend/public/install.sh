#!/usr/bin/env bash
set -euo pipefail

# OpenAgents Workspace Installer
# Usage: curl -fsSL https://workspace.openagents.org/install.sh | bash

# --- Colors ---
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    BOLD=$(tput bold)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    RED=$(tput setaf 1)
    CYAN=$(tput setaf 6)
    DIM=$(tput dim)
    RESET=$(tput sgr0)
else
    BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

info()  { echo "${BOLD}${CYAN}>>>${RESET} $*"; }
ok()    { echo "${BOLD}${GREEN}>>>${RESET} $*"; }
warn()  { echo "${BOLD}${YELLOW}>>>${RESET} $*"; }
fail()  { echo "${BOLD}${RED}>>>${RESET} $*"; exit 1; }

# --- Header ---
echo ""
echo "${BOLD}  OpenAgents Workspace Installer${RESET}"
echo "${DIM}  Connect your AI agent to the web in one command${RESET}"
echo ""

# --- Step 1: Python ---
info "Checking Python..."

PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        version=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || true)
        major=$("$cmd" -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo 0)
        minor=$("$cmd" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo 0)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 8 ]; then
            PYTHON="$cmd"
            ok "Found $cmd $version"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    fail "Python 3.8+ is required but not found.
  Install Python: https://www.python.org/downloads/"
fi

# --- Step 2: Install openagents ---
info "Installing openagents..."

PIP="$PYTHON -m pip"

# Check if already installed
if $PYTHON -c "import openagents" 2>/dev/null; then
    current=$($PYTHON -c "from openagents import __version__; print(__version__)" 2>/dev/null || echo "unknown")
    ok "openagents already installed (v${current})"
    info "Upgrading to latest..."
fi

# Determine pip flags
PIP_FLAGS="--quiet"
if [ -z "${VIRTUAL_ENV:-}" ]; then
    # Not in a venv — use --user to avoid permission issues
    PIP_FLAGS="$PIP_FLAGS --user"
fi

if $PIP install $PIP_FLAGS --upgrade openagents 2>/dev/null; then
    ok "openagents installed"
elif $PIP install $PIP_FLAGS --upgrade --break-system-packages openagents 2>/dev/null; then
    ok "openagents installed"
else
    fail "Failed to install openagents.
  Try manually: pip install openagents"
fi

# Verify
if ! command -v openagents >/dev/null 2>&1; then
    # Might be in ~/.local/bin which isn't on PATH
    if [ -f "$HOME/.local/bin/openagents" ]; then
        warn "openagents installed to ~/.local/bin/ which is not on your PATH"
        warn "Add to your shell config: export PATH=\"\$HOME/.local/bin:\$PATH\""
        export PATH="$HOME/.local/bin:$PATH"
    fi
fi

# --- Step 3: Claude Code ---
info "Checking Claude Code..."

if command -v claude >/dev/null 2>&1; then
    claude_version=$(claude --version 2>/dev/null || echo "unknown")
    ok "Claude Code found ($claude_version)"
else
    warn "Claude Code not found — installing..."
    if curl -fsSL https://claude.ai/install.sh | bash 2>/dev/null; then
        ok "Claude Code installed"
    else
        warn "Could not auto-install Claude Code."
        warn "Install manually: curl -fsSL https://claude.ai/install.sh | bash"
    fi
fi

# --- Done ---
echo ""
echo "${BOLD}${GREEN}  Installation complete!${RESET}"
echo ""
echo "  Get started:"
echo ""
echo "    ${BOLD}openagents connect claude${RESET}"
echo ""
echo "  This will:"
echo "    1. Create an agent identity"
echo "    2. Spin up a workspace"
echo "    3. Give you a URL to open in your browser"
echo "    4. Start listening for messages"
echo ""
