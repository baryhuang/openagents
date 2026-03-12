# OpenAgents Installer for Windows
# Usage: irm https://openagents.org/install.ps1 | iex

$ErrorActionPreference = "Continue"
$VERSION = "0.9.1"
$MIN_PYTHON_MAJOR = 3
$MIN_PYTHON_MINOR = 10

function Write-Info { Write-Host ">>> " -ForegroundColor Cyan -NoNewline; Write-Host $args }
function Write-Ok { Write-Host "[OK] " -ForegroundColor Green -NoNewline; Write-Host $args }
function Write-Warn { Write-Host "[!] " -ForegroundColor Yellow -NoNewline; Write-Host $args }
function Write-Fail {
    Write-Host "[X] " -ForegroundColor Red -NoNewline
    Write-Host $args
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}
function Write-Step { Write-Host ""; Write-Info $args }

Write-Host ""
Write-Host "  OpenAgents Installer  v$VERSION" -ForegroundColor White
Write-Host "  Multi-agent orchestration for your local machine" -ForegroundColor DarkGray
Write-Host ""

Write-Step "Checking Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+..."

function Find-Python {
    foreach ($cmd in @("python3", "python", "py")) {
        try {
            $version = & $cmd --version 2>$null
            if ($version -match "Python (\d+)\.(\d+)\.(\d+)") {
                $major = [int]$matches[1]
                $minor = [int]$matches[2]
                $micro = [int]$matches[3]
                if (($major -gt $MIN_PYTHON_MAJOR) -or (($major -eq $MIN_PYTHON_MAJOR) -and ($minor -ge $MIN_PYTHON_MINOR))) {
                    return @{
                        Command = $cmd
                        Version = "$major.$minor.$micro"
                    }
                }
            }
        } catch { continue }
    }
    return $null
}

$Python = Find-Python
if ($Python) {
    Write-Ok "Python $($Python.Version) ($($Python.Command))"
} else {
    Write-Warn "Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ not found - attempting install..."
    
    Write-Info "Downloading Python installer..."
    $pythonUrl = "https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe"
    $installerPath = "$env:TEMP\python-installer.exe"
    
    try {
        Invoke-WebRequest -Uri $pythonUrl -OutFile $installerPath -UseBasicParsing
        Write-Info "Running Python installer..."
        Start-Process -FilePath $installerPath -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1" -Wait
        Remove-Item $installerPath -Force
    } catch {
        Write-Fail "Cannot install Python. Please install from https://www.python.org/downloads/"
    }
    
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    $Python = Find-Python
    if ($Python) {
        Write-Ok "Python $($Python.Version) installed"
    } else {
        Write-Fail "Python installation failed. Please install from https://www.python.org/downloads/"
    }
}

Write-Step "Installing OpenAgents CLI..."

$PythonCmd = $Python.Command

try {
    $currentVersion = & $PythonCmd -c "from openagents import __version__; print(__version__)" 2>$null
    if ($currentVersion) {
        Write-Ok "openagents already installed (v${currentVersion})"
        Write-Info "Upgrading to latest..."
    }
} catch {}

$installed = $false
try {
    & $PythonCmd -m pip install --quiet --no-cache-dir --upgrade openagents 2>$null
    $installed = $true
} catch {
    try {
        & $PythonCmd -m pip install --quiet --no-cache-dir --user --upgrade openagents 2>$null
        $installed = $true
    } catch {}
}

if ($installed) {
    try {
        $newVersion = & $PythonCmd -c "from openagents import __version__; print(__version__)" 2>$null
    } catch {
        $newVersion = "unknown"
    }
    Write-Ok "openagents v${newVersion} installed"
} else {
    Write-Fail "Failed to install openagents. Try: pip install openagents"
}

if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Write-Ok "openagents CLI is ready"
} else {
    Write-Warn "openagents installed but not found on PATH"
    Write-Warn "You may need to restart your terminal"
}

Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Run " -NoNewline
Write-Host "openagents" -ForegroundColor White -NoNewline
Write-Host " to:"
Write-Host "    - Install AI agents (Claude, OpenClaw, Codex, Aider, ...)"
Write-Host "    - Manage and configure agents"
Write-Host "    - Connect agents to OpenAgents Workspaces"
Write-Host ""

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Write-Step "Launching OpenAgents..."
    Write-Host ""
    & openagents
}
