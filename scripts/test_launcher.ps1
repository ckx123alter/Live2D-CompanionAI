$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\run.cmd'))
$body = ($source -split '(?m)^# POWERSHELL_PAYLOAD\r?$',2)[1]
$errors = $null; $tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($body, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Invoke-Checked','Get-FileDigest','Initialize-LocalEnvironment')) {
    $fn = $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true) | Where-Object Name -eq $name
    Invoke-Expression $fn.Extent.Text
}
$failed = $false
try { Invoke-Checked (Join-Path $PSHOME 'powershell.exe') @('-NoProfile','-Command','exit 7') } catch { $failed = $true }
if (!$failed) { throw 'Nonzero exit was not rejected' }
$fixture = Join-Path $env:TEMP ('whale-launcher-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $projectPath = Join-Path $fixture 'project with spaces'
    $frontendPath = Join-Path $projectPath 'frontend'
    $pythonPath = Join-Path $projectPath '.venv\Scripts\python.exe'
    $vitePath = Join-Path $frontendPath 'node_modules\vite\bin\vite.js'
    New-Item -ItemType Directory -Path (Join-Path $frontendPath 'public\vendor') -Force | Out-Null
    Set-Content (Join-Path $frontendPath 'public\vendor\live2dcubismcore.min.js') 'mock'
    Set-Content (Join-Path $projectPath 'requirements.txt') 'requirements-v1'
    Set-Content (Join-Path $frontendPath 'package.json') '{}'
    Set-Content (Join-Path $frontendPath 'package-lock.json') '{}'
    Set-Content (Join-Path $projectPath '.env.example') 'demo defaults'
    Set-Content (Join-Path $projectPath '.env') 'existing configuration'
    $script:calls = @(); $script:failPip = $false; $script:hasPip = $false; $script:failEnsurePip = $false
    function Get-Command { param($Name,$ErrorAction) return @{Source=$Name} }
    function Test-PipAvailable { return $script:hasPip }
    # Simulate installers; never install packages or start application services.
    function Invoke-Checked([string]$Executable,[string[]]$Arguments) {
        $script:calls += ($Arguments -join '|')
        if ($Arguments -contains 'ensurepip') {
            if ($script:failEnsurePip) { throw 'simulated pip bootstrap failure' }
            $script:hasPip = $true
        }
        if ($Arguments -contains 'venv') {
            New-Item -ItemType Directory -Path (Split-Path $pythonPath) -Force | Out-Null
            Set-Content $pythonPath 'mock'
        }
        if ($Arguments -contains 'pip' -and $script:failPip) { throw 'simulated install failure' }
        if ($Arguments -contains 'ci') {
            New-Item -ItemType Directory -Path (Split-Path $vitePath) -Force | Out-Null
            Set-Content $vitePath 'mock'
        }
    }
    Initialize-LocalEnvironment
    if (@($calls | Where-Object { $_ -match '\|ensurepip\|' }).Count -ne 1) { throw 'Missing pip was not restored' }
    if (@($calls | Where-Object { $_ -match '\|pip\|' }).Count -ne 1) { throw 'First pip install missing' }
    if (@($calls | Where-Object { $_ -match '\|ci$' }).Count -ne 1) { throw 'First npm install missing' }
    if ((Get-Content (Join-Path $projectPath '.env') -Raw).Trim() -ne 'existing configuration') { throw 'Existing configuration changed' }
    $script:calls = @()
    Initialize-LocalEnvironment
    if (@($calls | Where-Object { $_ -match '\|pip\||\|ensurepip\||\|ci$|\|venv\|' }).Count) { throw 'Unchanged dependencies reinstalled' }
    $script:hasPip = $false; $script:failEnsurePip = $true; $failed = $false
    try { Initialize-LocalEnvironment } catch { $failed = $true }
    if (!$failed) { throw 'Failed pip bootstrap was ignored' }
    $script:failEnsurePip = $false
    Initialize-LocalEnvironment
    if (!$script:hasPip) { throw 'Existing environment pip repair missing' }
    $stamp = Join-Path $projectPath '.venv\whale-requirements.sha256'
    $oldStamp = Get-Content $stamp -Raw
    Set-Content (Join-Path $projectPath 'requirements.txt') 'requirements-v2'
    $script:failPip = $true; $failed = $false
    try { Initialize-LocalEnvironment } catch { $failed = $true }
    if (!$failed -or (Get-Content $stamp -Raw) -ne $oldStamp) { throw 'Failed install marked complete' }
    $script:failPip = $false
    Initialize-LocalEnvironment
    if ((Get-Content $stamp -Raw) -eq $oldStamp) { throw 'Retry did not update requirements stamp' }
    Remove-Item -LiteralPath (Join-Path $projectPath '.env')
    Initialize-LocalEnvironment
    if ((Get-Content (Join-Path $projectPath '.env') -Raw).Trim() -ne 'demo defaults') { throw 'Missing default configuration' }
    Write-Output 'PASS: syntax, command failure, fresh setup, missing-pip repair/retry, unchanged restart, .env preservation/defaults, failed-install retry, paths with spaces.'
} finally {
    $resolved = (Resolve-Path -LiteralPath $fixture).Path
    if ((Split-Path $resolved -Parent) -ne (Resolve-Path -LiteralPath $env:TEMP).Path -or (Split-Path $resolved -Leaf) -notlike 'whale-launcher-test-*') { throw 'Unexpected cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
