# OpenAgents Installer for Windows
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  OpenAgents Installer  v0.9.0" -ForegroundColor Cyan
Write-Host "  Multi-agent orchestration for your local machine" -ForegroundColor DarkGray
Write-Host ""

# Step 1: Check Python
Write-Host ">>> Checking Python 3.10+..." -ForegroundColor Cyan

$pythonCmd = $null
foreach ($cmd in @("python3", "python", "py")) {
    try {
        $ver = & $cmd --version 2>$null
        if ($ver -match "Python (\d+)\.(\d+)") {
            $major = [int]$Matches[1]
            $minor = [int]$Matches[2]
            if (($major -eq 3 -and $minor -ge 10) -or $major -gt 3) {
                $pythonCmd = $cmd
                Write-Host "[OK] Python found: $ver" -ForegroundColor Green
                break
            }
        }
    } catch { continue }
}

if (-not $pythonCmd) {
    Write-Host "[!] Python 3.10+ not found" -ForegroundColor Yellow
    Write-Host ">>> Downloading Python installer..." -ForegroundColor Cyan
    
    $pythonUrl = "https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe"
    $installerPath = "$env:TEMP\python-installer.exe"
    
    try {
        Invoke-WebRequest -Uri $pythonUrl -OutFile $installerPath -UseBasicParsing
        Write-Host ">>> Installing Python (this may take a few minutes)..." -ForegroundColor Cyan
        Start-Process -FilePath $installerPath -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1" -Wait
        Remove-Item $installerPath -Force
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        # Try finding Python again
        foreach ($cmd in @("python3", "python", "py")) {
            try {
                $ver = & $cmd --version 2>$null
                if ($ver) {
                    $pythonCmd = $cmd
                    Write-Host "[OK] Python installed: $ver" -ForegroundColor Green
                    break
                }
            } catch { continue }
        }
    } catch {
        Write-Host "[X] Failed to install Python" -ForegroundColor Red
        Write-Host "Please install Python 3.10+ manually from: https://www.python.org/downloads/" -ForegroundColor Yellow
        exit 1
    }
}

if (-not $pythonCmd) {
    Write-Host "[X] Python installation failed" -ForegroundColor Red
    Write-Host "Please install Python 3.10+ manually from: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Step 2: Install OpenAgents
Write-Host ""
Write-Host ">>> Installing OpenAgents CLI..." -ForegroundColor Cyan

try {
    & $pythonCmd -m pip install --quiet --upgrade openagents 2>$null
    Write-Host "[OK] openagents installed" -ForegroundColor Green
} catch {
    try {
        & $pythonCmd -m pip install --quiet --user --upgrade openagents 2>$null
        Write-Host "[OK] openagents installed" -ForegroundColor Green
    } catch {
        Write-Host "[X] Failed to install openagents" -ForegroundColor Red
        Write-Host "Try manually: pip install openagents" -ForegroundColor Yellow
        exit 1
    }
}

# Step 3: Verify openagents command
Write-Host ""
Write-Host ">>> Verifying openagents CLI..." -ForegroundColor Cyan

if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Write-Host "[OK] openagents CLI is ready" -ForegroundColor Green
} else {
    Write-Host "[!] openagents installed but not on PATH" -ForegroundColor Yellow
    Write-Host "You may need to restart your terminal" -ForegroundColor Yellow
}

# Step 4: Detect agents
Write-Host ""
Write-Host ">>> Detecting local AI agents..." -ForegroundColor Cyan

$agentCount = 0
$agents = @("claude", "aider", "goose", "codex", "gemini", "copilot")

foreach ($agent in $agents) {
    if (Get-Command $agent -ErrorAction SilentlyContinue) {
        Write-Host "[OK] $agent" -ForegroundColor Green
        $agentCount++
    } else {
        Write-Host "  $agent - not installed" -ForegroundColor DarkGray
    }
}

# Done
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""

if ($agentCount -eq 0) {
    Write-Host "  No AI agents found. Install one to get started:" -ForegroundColor Yellow
    Write-Host "  - Claude Code: https://claude.ai/download"
    Write-Host ""
}

Write-Host "  Quick start:"
Write-Host "    openagents          Show all agents"
Write-Host ""
