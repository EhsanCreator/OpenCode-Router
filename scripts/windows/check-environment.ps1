<#
.SYNOPSIS
    OpenCode Router - Windows Environment Diagnostic Tool
.DESCRIPTION
    Audits Windows operating system, Node.js runtime, OpenCode CLI, and network port availability.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "[AUDIT] OpenCode Router - Windows Environment Diagnostics" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$allPassed = $true

# 1. Operating System
$os = Get-CimInstance Win32_OperatingSystem
$osArch = (Get-CimInstance Win32_Processor).AddressWidth
Write-Host "[[v]] Operating System: " -NoNewline -ForegroundColor Green
Write-Host "$($os.Caption) ($osArch-bit, Build $($os.BuildNumber))"

# 2. Node.js Runtime (better-sqlite3 and Vite 8 require Node.js >= 22.12.0)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = (node -v).Trim().TrimStart('v')
    $parts = $nodeVer.Split('.')
    $major = [int]$parts[0]
    $minor = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }

    $isNodeCompatible = ($major -eq 22 -and $minor -ge 12) -or ($major -gt 22)

    if ($isNodeCompatible) {
        Write-Host "[[v]] Node.js Runtime:  " -NoNewline -ForegroundColor Green
        Write-Host "v$nodeVer ($($nodeCmd.Source))"
    } else {
        Write-Host "[[x]] Node.js Runtime:  " -NoNewline -ForegroundColor Red
        Write-Host "v$nodeVer (Incompatible: better-sqlite3 and Vite 8 strictly require Node.js >= 22.12.0)"
        $allPassed = $false
    }
} else {
    Write-Host "[[x]] Node.js Runtime:  Not found in PATH! (Node.js >= 22.12.0 required: https://nodejs.org)" -ForegroundColor Red
    $allPassed = $false
}

# 3. npm Package Manager
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd) {
    $npmVer = (npm -v).Trim()
    Write-Host "[[v]] npm Package Mgr:  " -NoNewline -ForegroundColor Green
    Write-Host "v$npmVer"
} else {
    Write-Host "[[x]] npm Package Mgr:  Not found in PATH!" -ForegroundColor Red
    $allPassed = $false
}

# 4. OpenCode CLI Detection
$opencodeCmd = Get-Command opencode -ErrorAction SilentlyContinue
if (-not $opencodeCmd -and (Test-Path "$env:APPDATA\npm\opencode.cmd")) {
    $opencodeCmd = [PSCustomObject]@{ Source = "$env:APPDATA\npm\opencode.cmd" }
}

if ($opencodeCmd) {
    try {
        $opencodeVer = (& $opencodeCmd.Source --version 2>$null).Trim()
        Write-Host "[[v]] OpenCode CLI:     " -NoNewline -ForegroundColor Green
        Write-Host "v$opencodeVer ($($opencodeCmd.Source))"
    } catch {
        Write-Host "[[v]] OpenCode CLI:     Found at $($opencodeCmd.Source)" -ForegroundColor Green
    }
} else {
    Write-Host "[!] OpenCode CLI:     Not found in PATH." -ForegroundColor Yellow
    Write-Host "    (You can still install and run OpenCode Router, and install OpenCode later via: npm i -g opencode-ai)" -ForegroundColor Gray
}

# 5. Network Port Availability
$ports = @(
    @{ Port = 3000; Name = "Web Dashboard" },
    @{ Port = 10808; Name = "Xray SOCKS5" },
    @{ Port = 10809; Name = "Xray HTTP Proxy" }
)

Write-Host ""
Write-Host "Checking local port availability..." -ForegroundColor Cyan
foreach ($p in $ports) {
    $listener = Get-NetTCPConnection -LocalPort $p.Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        Write-Host "    [!] Port $($p.Port) ($($p.Name)): In use by PID $($listener.OwningProcess[0])" -ForegroundColor Yellow
    } else {
        Write-Host "    [[v]] Port $($p.Port) ($($p.Name)): Available" -ForegroundColor Green
    }
}

# 6. PowerShell Execution Policy
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq "Restricted" -or $policy -eq "Undefined") {
    $machinePolicy = Get-ExecutionPolicy -Scope LocalMachine
    if ($machinePolicy -eq "Restricted") {
        Write-Host ""
        Write-Host "[!] Note: PowerShell ExecutionPolicy is set to '$policy'." -ForegroundColor Yellow
        Write-Host "    If scripts are blocked, run: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor Gray
    }
}

Write-Host ""
if ($allPassed) {
    Write-Host "[SUCCESS] Environment is ready for OpenCode Router on Windows!" -ForegroundColor Green
} else {
    Write-Host "[WARN]  Please address the missing prerequisites above before proceeding." -ForegroundColor Yellow
}
Write-Host ""
