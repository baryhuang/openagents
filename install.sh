#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# OpenAgents Installer
# Usage: curl -fsSL https://openagents.org/install.sh | bash
#
# Installs the OpenAgents CLI (agent-connector), detects local AI agents,
# and gets you running. Works on macOS, Linux, and Windows (WSL/Git Bash).
# =============================================================================

VERSION="1.0.0"
NPM_PACKAGE="@openagents-org/agent-connector"
MIN_NODE_MAJOR=18

# --- Colors (safe for pipes) ---
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
ok()    { echo "${BOLD}${GREEN} ✓${RESET} $*"; }
warn()  { echo "${BOLD}${YELLOW} !${RESET} $*"; }
fail()  { echo "${BOLD}${RED} ✗${RESET} $*"; exit 1; }
step()  { echo ""; info "$*"; }

# --- Header ---
echo ""
echo "${BOLD}  OpenAgents Installer${RESET}  ${DIM}v${VERSION}${RESET}"
echo "${DIM}  Multi-agent orchestration for your local machine${RESET}"
echo ""

# --- Detect OS ---
OS="unknown"
ARCH="$(uname -m)"
case "$(uname -s)" in
    Linux*)   OS="linux";;
    Darwin*)  OS="macos";;
    MINGW*|MSYS*|CYGWIN*) OS="windows";;
esac

# =========================================================================
# Step 1: Node.js
# =========================================================================
step "Checking Node.js ${MIN_NODE_MAJOR}+..."

find_node() {
    for cmd in node nodejs; do
        if command -v "$cmd" >/dev/null 2>&1; then
            major=$("$cmd" -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>/dev/null || echo 0)
            if [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
                echo "$cmd"
                return 0
            fi
        fi
    done
    return 1
}

NODE=""
if NODE=$(find_node); then
    node_version=$($NODE --version)
    ok "Node.js $node_version ($NODE)"
else
    warn "Node.js ${MIN_NODE_MAJOR}+ not found — installing..."

    case "$OS" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                info "Installing Node.js via Homebrew..."
                brew install node 2>/dev/null || true
            else
                info "Downloading Node.js..."
                if [ "$ARCH" = "arm64" ]; then
                    NODE_URL="https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-arm64.tar.gz"
                else
                    NODE_URL="https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-x64.tar.gz"
                fi
                mkdir -p "$HOME/.openagents/nodejs"
                curl -fsSL "$NODE_URL" | tar xz -C "$HOME/.openagents/nodejs" --strip-components=1
                export PATH="$HOME/.openagents/nodejs/bin:$PATH"
            fi
            ;;
        linux)
            if command -v apt-get >/dev/null 2>&1; then
                info "Installing Node.js via apt..."
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - 2>/dev/null || true
                sudo apt-get install -y -qq nodejs 2>/dev/null || true
            elif command -v dnf >/dev/null 2>&1; then
                info "Installing Node.js via dnf..."
                sudo dnf install -y nodejs 2>/dev/null || true
            else
                info "Downloading Node.js portable..."
                NODE_URL="https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz"
                mkdir -p "$HOME/.openagents/nodejs"
                curl -fsSL "$NODE_URL" | tar xJ -C "$HOME/.openagents/nodejs" --strip-components=1
                export PATH="$HOME/.openagents/nodejs/bin:$PATH"
            fi
            ;;
        windows)
            fail "On Windows, please install Node.js from https://nodejs.org or use install.ps1"
            ;;
        *)
            fail "Unsupported OS. Please install Node.js ${MIN_NODE_MAJOR}+ manually: https://nodejs.org"
            ;;
    esac

    if NODE=$(find_node); then
        node_version=$($NODE --version)
        ok "Node.js $node_version installed"
    else
        fail "Node.js installation did not succeed.
  Please install Node.js ${MIN_NODE_MAJOR}+ manually: https://nodejs.org"
    fi
fi

# =========================================================================
# Step 2: Install/upgrade agent-connector
# =========================================================================
step "Installing OpenAgents CLI..."

NPM="npm"
if ! command -v npm >/dev/null 2>&1; then
    # Try common locations
    for d in "$HOME/.openagents/nodejs/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
        if [ -x "$d/npm" ]; then
            NPM="$d/npm"
            break
        fi
    done
fi

# Check if already installed
if command -v agent-connector >/dev/null 2>&1; then
    current=$(agent-connector --version 2>/dev/null | head -1 || echo "unknown")
    ok "agent-connector already installed ($current)"
    info "Upgrading to latest..."
fi

# Install globally — use --prefix on macOS/Linux to avoid sudo
if [ "$OS" != "windows" ]; then
    GLOBAL_DIR="$HOME/.openagents/npm-global"
    mkdir -p "$GLOBAL_DIR"
    $NPM install --prefix "$GLOBAL_DIR" -g "$NPM_PACKAGE@latest" 2>&1 | tail -5
    export PATH="$GLOBAL_DIR/bin:$PATH"
else
    $NPM install -g "$NPM_PACKAGE@latest" 2>&1 | tail -5
fi

if command -v agent-connector >/dev/null 2>&1; then
    new_version=$(agent-connector --version 2>/dev/null | head -1 || echo "unknown")
    ok "agent-connector $new_version installed"
else
    # Check in --prefix bin
    if [ -x "$GLOBAL_DIR/bin/agent-connector" ]; then
        new_version=$("$GLOBAL_DIR/bin/agent-connector" --version 2>/dev/null | head -1 || echo "unknown")
        ok "agent-connector $new_version installed"
        warn "Add to PATH: export PATH=\"$GLOBAL_DIR/bin:\$PATH\""
    else
        fail "Failed to install agent-connector.
  Try manually: npm install -g $NPM_PACKAGE"
    fi
fi

# =========================================================================
# Step 3: Detect local AI agents
# =========================================================================
step "Detecting local AI agents..."

agent_count=0

detect_agent() {
    local name="$1"
    local binary="$2"
    if command -v "$binary" >/dev/null 2>&1; then
        local ver
        ver=$("$binary" --version 2>/dev/null | head -1 || echo "")
        ok "$name${ver:+ ($ver)}"
        agent_count=$((agent_count + 1))
    else
        echo "  ${DIM}$name — not installed${RESET}"
    fi
}

detect_agent "Claude Code"    claude
detect_agent "OpenClaw"       openclaw
detect_agent "OpenAI Codex"   codex
detect_agent "Aider"          aider
detect_agent "Goose"          goose
detect_agent "Gemini CLI"     gemini
detect_agent "Copilot CLI"    copilot
detect_agent "Amp"            amp
detect_agent "OpenCode"       opencode

if [ "$agent_count" -eq 0 ]; then
    echo ""
    warn "No AI agents found. Install one to get started:"
    echo ""
    echo "  ${BOLD}agent-connector install openclaw${RESET}"
    echo "  ${BOLD}agent-connector install claude${RESET}"
    echo "  ${BOLD}agent-connector install codex${RESET}"
    echo ""
fi

# =========================================================================
# Step 4: Show status
# =========================================================================
if command -v agent-connector >/dev/null 2>&1; then
    step "Agent status"
    echo ""
    agent-connector status 2>/dev/null || true
fi

# =========================================================================
# Done
# =========================================================================
echo ""
echo "${BOLD}${GREEN}  Installation complete!${RESET}"
echo ""

if [ "$agent_count" -gt 0 ]; then
    echo "  Quick start:"
    echo ""
    echo "    ${BOLD}agent-connector status${RESET}         Show all agents"
    echo "    ${BOLD}agent-connector up${RESET}             Start the daemon"
    echo "    ${BOLD}agent-connector search${RESET}         Browse agent catalog"
    echo ""
else
    echo "  Next steps:"
    echo ""
    echo "    1. Install an AI agent:"
    echo "       ${BOLD}agent-connector install openclaw${RESET}"
    echo ""
    echo "    2. Start the daemon:"
    echo "       ${BOLD}agent-connector up${RESET}"
    echo ""
fi
