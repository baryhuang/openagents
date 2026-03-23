# =============================================================================
# OpenAgents Installer for Windows
# Usage: irm https://openagents.org/install.ps1 | iex
#
# Installs the OpenAgents CLI (openagents), detects local AI agents,
# and gets you running. Requires PowerShell 5.1+ (built into Windows 10/11).
# =============================================================================

$ErrorActionPreference = "Stop"
$VERSION = "1.0.0"
$NPM_PACKAGE = "@openagents-org/agent-launcher"
$MIN_NODE_MAJOR = 18

# --- Helpers ---
function Info($msg)  { Write-Host ">>> " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Ok($msg)    { Write-Host " +  " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Warn($msg)  { Write-Host " !  " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Fail($msg)  { Write-Host " X  " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }
function Step($msg)  { Write-Host ""; Info $msg }

# --- Header ---
Write-Host ""
Write-Host "  OpenAgents Installer" -ForegroundColor White -NoNewline
Write-Host "  v$VERSION" -ForegroundColor DarkGray
Write-Host "  Multi-agent orchestration for your local machine" -ForegroundColor DarkGray
Write-Host ""

# =========================================================================
# Step 1: Node.js
# =========================================================================
Step "Checking Node.js $MIN_NODE_MAJOR+..."

function Find-Node {
    $exe = Get-Command node -ErrorAction SilentlyContinue
    if ($exe) {
        try {
            $ver = & $exe.Source --version 2>$null
            $major = [int]($ver -replace '^v','').Split('.')[0]
            if ($major -ge $MIN_NODE_MAJOR) {
                return @{ Path = $exe.Source; Version = $ver }
            }
        } catch {}
    }
    # Check bundled Node.js
    $bundled = Join-Path $env:USERPROFILE ".openagents\nodejs\node.exe"
    if (Test-Path $bundled) {
        $ver = & $bundled --version 2>$null
        return @{ Path = $bundled; Version = $ver }
    }
    return $null
}

$node = Find-Node
if ($node) {
    Ok "Node.js $($node.Version) ($($node.Path))"
} else {
    Warn "Node.js $MIN_NODE_MAJOR+ not found - installing portable Node.js..."

    $nodeVersion = "v22.14.0"
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $url = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-$arch.zip"
    $zipPath = Join-Path $env:TEMP "node-$nodeVersion.zip"
    $nodejsDir = Join-Path $env:USERPROFILE ".openagents\nodejs"

    Info "Downloading $url..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

    Info "Extracting to $nodejsDir..."
    New-Item -ItemType Directory -Force -Path $nodejsDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $nodejsDir -Force

    # Move contents from nested folder
    $nested = Get-ChildItem $nodejsDir -Directory | Where-Object { $_.Name -like "node-*" } | Select-Object -First 1
    if ($nested) {
        Get-ChildItem $nested.FullName | Move-Item -Destination $nodejsDir -Force -ErrorAction SilentlyContinue
        Remove-Item $nested.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }

    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    # Add to PATH for this session
    $env:PATH = "$nodejsDir;$env:PATH"

    $node = Find-Node
    if ($node) {
        Ok "Node.js $($node.Version) installed (portable)"
    } else {
        Fail "Node.js installation failed. Please install from https://nodejs.org"
    }
}

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
Step "Installing OpenAgents CLI..."

# Find npm
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $bundledNpm = Join-Path $env:USERPROFILE ".openagents\nodejs\npm.cmd"
    if (Test-Path $bundledNpm) {
        $env:PATH = (Join-Path $env:USERPROFILE ".openagents\nodejs") + ";$env:PATH"
    }
}

# Check if already installed (ignore old Python openagents)
$existing = Get-Command openagents -ErrorAction SilentlyContinue
if ($existing) {
    $currentVer = cmd /c "openagents --version 2>nul" 2>$null
    if ($currentVer -and "$currentVer" -match 'agent-launcher|agent-connector') {
        Ok "openagents already installed ($currentVer)"
        Info "Upgrading to latest..."
    }
}

# Install globally
try {
    & npm install -g "$NPM_PACKAGE@latest" 2>&1 | Select-Object -Last 5
} catch {
    Warn "Global install failed, trying with --prefix..."
    $globalDir = Join-Path $env:USERPROFILE ".openagents\npm-global"
    New-Item -ItemType Directory -Force -Path $globalDir | Out-Null
    & npm install --prefix $globalDir -g "$NPM_PACKAGE@latest" 2>&1 | Select-Object -Last 5
    $env:PATH = "$globalDir;$env:PATH"
}

# Verify
$acCmd = Get-Command openagents -ErrorAction SilentlyContinue
if ($acCmd) {
    $newVer = & openagents --version 2>$null
    Ok "openagents $newVer installed"
} else {
    # Check npm global bin
    $npmBin = Join-Path $env:APPDATA "npm"
    if (Test-Path (Join-Path $npmBin "openagents.cmd")) {
        $env:PATH = "$npmBin;$env:PATH"
        $newVer = & openagents --version 2>$null
        Ok "openagents $newVer installed"
        Warn "Add to PATH: $npmBin"
    } else {
        Fail "Failed to install openagents. Try: npm install -g $NPM_PACKAGE"
    }
}

# =========================================================================
# Step 3: Detect local AI agents
# =========================================================================
Step "Detecting local AI agents..."

$agentCount = 0

function Detect-Agent($name, $binary) {
    $cmd = Get-Command $binary -ErrorAction SilentlyContinue
    if ($cmd) {
        $ver = try { & $binary --version 2>$null | Select-Object -First 1 } catch { "" }
        if ($ver) { Ok "$name ($ver)" } else { Ok $name }
        $script:agentCount++
    } else {
        Write-Host "  $name - not installed" -ForegroundColor DarkGray
    }
}

Detect-Agent "Claude Code"    "claude"
Detect-Agent "OpenClaw"       "openclaw"
Detect-Agent "OpenAI Codex"   "codex"
Detect-Agent "Aider"          "aider"
Detect-Agent "Goose"          "goose"
Detect-Agent "Gemini CLI"     "gemini"
Detect-Agent "Copilot CLI"    "copilot"
Detect-Agent "Amp"            "amp"
Detect-Agent "OpenCode"       "opencode"

if ($agentCount -eq 0) {
    Write-Host ""
    Warn "No AI agents found. Install one to get started:"
    Write-Host ""
    Write-Host "  openagents install openclaw" -ForegroundColor White
    Write-Host "  openagents install claude" -ForegroundColor White
    Write-Host "  openagents install codex" -ForegroundColor White
    Write-Host ""
}

# =========================================================================
# Step 4: Show status
# =========================================================================
$acExists = Get-Command openagents -ErrorAction SilentlyContinue
if ($acExists) {
    Step "Agent status"
    Write-Host ""
    & openagents status 2>$null
}

# =========================================================================
# Done
# =========================================================================
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""

if ($agentCount -gt 0) {
    Write-Host "  Quick start:"
    Write-Host ""
    Write-Host "    openagents status" -ForegroundColor White -NoNewline; Write-Host "         Show all agents"
    Write-Host "    openagents up" -ForegroundColor White -NoNewline; Write-Host "             Start the daemon"
    Write-Host "    openagents search" -ForegroundColor White -NoNewline; Write-Host "         Browse agent catalog"
    Write-Host ""
} else {
    Write-Host "  Next steps:"
    Write-Host ""
    Write-Host "    1. Install an AI agent:"
    Write-Host "       openagents install openclaw" -ForegroundColor White
    Write-Host ""
    Write-Host "    2. Start the daemon:"
    Write-Host "       openagents up" -ForegroundColor White
    Write-Host ""
}
