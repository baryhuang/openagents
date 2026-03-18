# OpenAgents Installer for Windows
# Usage: irm https://openagents.org/install.ps1 | iex

$ErrorActionPreference = "Continue"
$VERSION = "0.9.3"
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

function Show-Progress {
    param([string]$Activity, [scriptblock]$Action)
    $job = Start-Job -ScriptBlock $Action
    $spinner = @("|", "/", "-", "\")
    $i = 0
    while ($job.State -eq "Running") {
        $char = $spinner[$i % 4]
        Write-Host "`r    $char $Activity..." -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 200
        $i++
    }
    Write-Host "`r" -NoNewline
    # Clear the progress line
    Write-Host ("`r" + (" " * ($Activity.Length + 10)) + "`r") -NoNewline
    $result = Receive-Job -Job $job
    $exitCode = $job.ChildJobs[0].JobStateInfo.Reason
    Remove-Job -Job $job -Force
    return $result
}

function Run-WithProgress {
    param([string]$Activity, [string]$Command)
    $spinner = @("|", "/", "-", "\")
    $i = 0
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $Command" -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\oa_stdout.txt" -RedirectStandardError "$env:TEMP\oa_stderr.txt"
    while (-not $process.HasExited) {
        $char = $spinner[$i % 4]
        Write-Host "`r    $char $Activity..." -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 250
        $i++
    }
    # Clear progress line
    $blank = " " * ($Activity.Length + 10)
    Write-Host "`r$blank`r" -NoNewline
    $exitCode = $process.ExitCode
    $stdout = ""; $stderr = ""
    if (Test-Path "$env:TEMP\oa_stdout.txt") { $stdout = Get-Content "$env:TEMP\oa_stdout.txt" -Raw -ErrorAction SilentlyContinue; Remove-Item "$env:TEMP\oa_stdout.txt" -Force -ErrorAction SilentlyContinue }
    if (Test-Path "$env:TEMP\oa_stderr.txt") { $stderr = Get-Content "$env:TEMP\oa_stderr.txt" -Raw -ErrorAction SilentlyContinue; Remove-Item "$env:TEMP\oa_stderr.txt" -Force -ErrorAction SilentlyContinue }
    return @{ ExitCode = $exitCode; Stdout = $stdout; Stderr = $stderr }
}

Write-Host ""
Write-Host "  OpenAgents Installer  v$VERSION" -ForegroundColor White
Write-Host "  Multi-agent orchestration for your local machine" -ForegroundColor DarkGray
Write-Host ""

# =========================================================================
# Step 1: Python
# =========================================================================
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

    $pythonUrl = "https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe"
    $installerPath = "$env:TEMP\python-installer.exe"

    try {
        Write-Info "Downloading Python installer..."
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $pythonUrl -OutFile $installerPath -UseBasicParsing
        $ProgressPreference = 'Continue'
        $result = Run-WithProgress "Installing Python" "$installerPath /quiet InstallAllUsers=1 PrependPath=1"
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
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

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
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
$pipResult = Run-WithProgress "Installing openagents" "$PythonCmd -m pip install --no-cache-dir --upgrade openagents"
if ($pipResult.ExitCode -eq 0) {
    $installed = $true
} else {
    $pipResult = Run-WithProgress "Installing openagents (user mode)" "$PythonCmd -m pip install --no-cache-dir --user --upgrade openagents"
    if ($pipResult.ExitCode -eq 0) {
        $installed = $true
    }
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

if (-not (Get-Command openagents -ErrorAction SilentlyContinue)) {
    # Try to find and add the scripts directory to PATH
    $scriptsDir = & $PythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
    $userScripts = & $PythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))" 2>$null

    foreach ($dir in @($scriptsDir, $userScripts)) {
        if ($dir -and (Test-Path "$dir\openagents.exe")) {
            $env:Path = "$dir;$env:Path"
            # Persist to user PATH so it survives terminal restarts
            $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
            if ($userPath -notlike "*$dir*") {
                [System.Environment]::SetEnvironmentVariable("Path", "$dir;$userPath", "User")
                Write-Ok "Added $dir to user PATH (persistent)"
            }
            break
        }
    }
}

if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Write-Ok "openagents CLI is ready"
} else {
    Write-Warn "openagents installed but not found on PATH"
    Write-Warn "Restart your terminal, or run: $PythonCmd -m openagents"
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
