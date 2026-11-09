<#
.SYNOPSIS
    OpenCode Router - Windows Uninstallation Script
.DESCRIPTION
    Removes OpenCode Router PATH integration and shortcuts from Windows.
#>
[CmdletBinding()]
param(
    [switch]$PurgeData
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🗑️  Uninstalling OpenCode Router (Windows)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))

# 1. Stop all running processes
$stopScript = Join-Path $scriptDir "stop.ps1"
if (Test-Path $stopScript) {
    & $stopScript
}

# 2. Remove bin directory from user PATH
$binDir = Join-Path $projectRoot "bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -like "*$binDir*") {
    $cleanPath = ($currentPath.Split(';') | Where-Object { $_ -ne $binDir -and $_ -ne "" }) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $cleanPath, "User")
    Write-Host "[✓] Removed '$binDir' from User PATH." -ForegroundColor Green
}

# 3. Remove Desktop Shortcut
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "OpenCode Router.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item -Path $shortcutPath -Force -ErrorAction SilentlyContinue
    Write-Host "[✓] Removed Desktop shortcut." -ForegroundColor Green
}

# 4. AppData cleanup if requested
$appDataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "OpenCode-Router"
} else {
    Join-Path $env:USERPROFILE "AppData\Local\OpenCode-Router"
}
$legacyAppData = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "OpenCodeRouter"
} else {
    Join-Path $env:USERPROFILE "AppData\Local\OpenCodeRouter"
}

if ($PurgeData) {
    if (Test-Path $appDataDir) {
        Remove-Item -Path $appDataDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "[✓] Purged application data at $appDataDir" -ForegroundColor Green
    }
    if (Test-Path $legacyAppData) {
        Remove-Item -Path $legacyAppData -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "[ℹ] Preserved application data and database at: $appDataDir" -ForegroundColor Gray
    Write-Host "    (Use -PurgeData to permanently remove databases and cache)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "OpenCode Router has been uninstalled." -ForegroundColor Green
Write-Host ""
