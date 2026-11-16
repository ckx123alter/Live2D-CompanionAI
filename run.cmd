@echo off
setlocal
set "WHALE_LAUNCHER=%~f0"
set "WHALE_LAUNCH_OPTION=%~1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$source=[IO.File]::ReadAllText($env:WHALE_LAUNCHER); $body=($source -split '(?m)^# POWERSHELL_PAYLOAD\r?$',2)[1]; & ([ScriptBlock]::Create($body)) -NoBrowser:($env:WHALE_LAUNCH_OPTION -eq '--no-browser')"
if errorlevel 1 (
    echo.
    echo Startup failed. See the message above.
    pause
    exit /b 1
)
exit /b 0
# POWERSHELL_PAYLOAD
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -LiteralPath $env:WHALE_LAUNCHER
$pythonPath = Join-Path $projectPath '.venv\Scripts\python.exe'
$frontendPath = Join-Path $projectPath 'frontend'
$vitePath = Join-Path $frontendPath 'node_modules\vite\bin\vite.js'
$logPath = Join-Path $env:TEMP 'whale-companion-startup'

function Get-PortOwner([int]$Port) {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($connection) {
        return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
    }
}

function Assert-ProjectPort([int]$Port, [string]$Marker) {
    $owner = Get-PortOwner $Port
    if (!$owner) { return $false }
    if (!$owner.CommandLine -or $owner.CommandLine.IndexOf($Marker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Port $Port is used by another process (PID $($owner.ProcessId)). Close that process and try again."
    }
    return $true
}

function Wait-Service([string]$Url, $Process, [string]$ErrorLog) {
    $deadline = (Get-Date).AddSeconds(60)
    do {
        if ($Process -and $Process.HasExited) {
            throw "Service exited before becoming ready. See $ErrorLog"
        }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Service did not become ready: $Url. See $ErrorLog"
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Executable. Fix the error above and run again." }
}

function Test-PipAvailable {
    & $pythonPath -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('pip') else 1)"
    return $LASTEXITCODE -eq 0
}

function Get-FileDigest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Initialize-LocalEnvironment {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (!$nodeCommand -or !$npmCommand) { throw 'Install Node.js 22, then reopen run.cmd.' }
    if (!(Test-Path -LiteralPath $pythonPath)) {
        $pythonCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        $pythonArguments = @('-3')
        if (!$pythonCommand) {
            $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
            $pythonArguments = @()
        }
        if (!$pythonCommand) { throw 'Install Python 3.11 or later with Add Python to PATH enabled, then reopen run.cmd.' }
        Write-Host 'Preparing Python environment...'
        Invoke-Checked $pythonCommand.Source ($pythonArguments + @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'))
        Invoke-Checked $pythonCommand.Source ($pythonArguments + @('-m', 'venv', (Join-Path $projectPath '.venv')))
    }
    if (!(Test-PipAvailable)) {
        Write-Host 'Restoring pip in the project Python environment...'
        Invoke-Checked $pythonPath @('-m', 'ensurepip', '--upgrade')
        if (!(Test-PipAvailable)) { throw 'pip could not be restored. Repair your Python installation and run again.' }
    }
    $requirements = Join-Path $projectPath 'requirements.txt'
    $pythonStamp = Join-Path $projectPath '.venv\whale-requirements.sha256'
    $pythonHash = Get-FileDigest $requirements
    if (!(Test-Path -LiteralPath $pythonStamp) -or (Get-Content -LiteralPath $pythonStamp -Raw).Trim() -ne $pythonHash) {
        Write-Host 'Installing Python dependencies (first run or requirements changed)...'
        Invoke-Checked $pythonPath @('-m', 'pip', 'install', '-r', $requirements)
        Set-Content -LiteralPath $pythonStamp -Value $pythonHash -Encoding ASCII
    }
    $npmStamp = Join-Path $frontendPath 'node_modules\whale-packages.sha256'
    $npmHash = ((Get-FileDigest (Join-Path $frontendPath 'package.json')) +
                (Get-FileDigest (Join-Path $frontendPath 'package-lock.json')))
    if (!(Test-Path -LiteralPath $vitePath) -or !(Test-Path -LiteralPath $npmStamp) -or (Get-Content -LiteralPath $npmStamp -Raw).Trim() -ne $npmHash) {
        Write-Host 'Installing frontend dependencies (first run or packages changed)...'
        Invoke-Checked $npmCommand.Source @('--prefix', $frontendPath, 'ci')
        Set-Content -LiteralPath $npmStamp -Value $npmHash -Encoding ASCII
    }
    if (!(Test-Path -LiteralPath (Join-Path $frontendPath 'public\vendor\live2dcubismcore.min.js'))) {
        throw 'Live2D Core missing. Place live2dcubismcore.min.js in frontend/public/vendor, then run again.'
    }
    Invoke-Checked $pythonPath @((Join-Path $projectPath 'scripts\prepare_model.py'))
    $envPath = Join-Path $projectPath '.env'
    if (!(Test-Path -LiteralPath $envPath)) {
        Copy-Item -LiteralPath (Join-Path $projectPath '.env.example') -Destination $envPath
        Write-Host 'Created .env. Fill LLM_API_KEY for AI chat; fixed replies work without it.'
    }
}

try {
    # Validate both ports before starting either service. Never stop unrelated processes.
    $backendRunning = Assert-ProjectPort 8000 $pythonPath
    $frontendRunning = Assert-ProjectPort 5173 $vitePath
    # Do not replace installed packages or model files while either service uses them.
    if (!$backendRunning -and !$frontendRunning) { Initialize-LocalEnvironment }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    $runId = [guid]::NewGuid().ToString('N')
    $backendError = Join-Path $logPath "$runId-backend.err.log"
    $frontendError = Join-Path $logPath "$runId-frontend.err.log"
    $backendProcess = $null
    $frontendProcess = $null
    if (!$backendRunning) {
        Write-Host 'Starting backend...'
        $backendProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath "$runId-backend.out.log") -RedirectStandardError $backendError
    }
    Wait-Service 'http://127.0.0.1:8000/api/health' $backendProcess $backendError
    if (!$frontendRunning) {
        Write-Host 'Starting frontend...'
        $frontendProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"{0}"' -f $vitePath), '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $frontendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath "$runId-frontend.out.log") -RedirectStandardError $frontendError
    }
    Wait-Service 'http://127.0.0.1:5173/' $frontendProcess $frontendError
    Wait-Service 'http://127.0.0.1:5173/api/health' $frontendProcess $frontendError
    Write-Host 'Ready: http://127.0.0.1:5173/'
    if (!$NoBrowser) { Start-Process 'http://127.0.0.1:5173/' }
    exit 0
} catch {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
