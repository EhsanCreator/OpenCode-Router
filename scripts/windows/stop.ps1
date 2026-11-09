<#
.SYNOPSIS
    OpenCode Router - Windows Stop & Cleanup Script
.DESCRIPTION
    Stops running backend server and managed Xray instances on Windows.
    Implements graceful termination first, PID verification to prevent killing unrelated apps,
    and cleanup of active connection state across local and AppData directories.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Stopping OpenCode Router processes..." -ForegroundColor Cyan

# 1. Stop backend on port 3000 (verifies process is Node.js to prevent killing unrelated services)
$connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    if ($conn.OwningProcess -and $conn.OwningProcess -gt 0) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and ($proc.ProcessName -like "*node*" -or $proc.ProcessName -like "*tsx*")) {
            Write-Host "   Gracefully stopping backend server (PID $($conn.OwningProcess))..." -ForegroundColor Yellow
            Stop-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            Wait-Process -Id $conn.OwningProcess -Timeout 2 -ErrorAction SilentlyContinue
            if (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue) {
                Write-Host "   Forcefully terminating backend server (PID $($conn.OwningProcess))..." -ForegroundColor Yellow
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# 2. Stop owned Xray process verified against active connection ownership record
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$projectRoot = $null
if ($scriptDir -and (Test-Path (Join-Path $scriptDir "..\..\package.json"))) {
    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
} elseif (Test-Path "package.json") {
    $projectRoot = (Get-Location).Path
} else {
    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
}
$stateFiles = @(
    (Join-Path $projectRoot "data\active-connection.json"),
    (Join-Path $env:LOCALAPPDATA "OpenCode-Router\active-connection.json"),
    (Join-Path $env:LOCALAPPDATA "OpenCodeRouter\active-connection.json")
)

$targetPidsToStop = @()

foreach ($sf in $stateFiles) {
    if (Test-Path $sf) {
        try {
            $stateJson = Get-Content -Path $sf -Raw | ConvertFrom-Json
            if ($stateJson.pid) {
                $pInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($stateJson.pid)" -ErrorAction SilentlyContinue
                if ($pInfo) {
                    # Verify process command line references active-xray-config.json
                    $cmdLine = ($pInfo.CommandLine -as [string])
                    if ($cmdLine -and $cmdLine.ToLower().Contains("active-xray-config.json")) {
                        $targetPidsToStop += $stateJson.pid
                    } else {
                        Write-Warning "[OpenCode Router] Stale PID $($stateJson.pid) does not match OpenCode Router Xray ownership fingerprint. Skipping termination."
                    }
                }
            }
        } catch {}
    }
}

# Stop strictly owned Xray processes
foreach ($targetPid in ($targetPidsToStop | Select-Object -Unique)) {
    Write-Host "   Gracefully stopping owned Xray proxy (PID $targetPid)..." -ForegroundColor Yellow
    Stop-Process -Id $targetPid -ErrorAction SilentlyContinue
    Wait-Process -Id $targetPid -Timeout 2 -ErrorAction SilentlyContinue
    if (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) {
        Write-Host "   Forcefully terminating owned Xray proxy (PID $targetPid)..." -ForegroundColor Yellow
        Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
    }
}

# 3. Clean up active state files only after process has terminated
foreach ($sf in $stateFiles) {
    if (Test-Path $sf) {
        Remove-Item -Path $sf -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "OpenCode Router stopped cleanly." -ForegroundColor Green
