<#
.SYNOPSIS
    OpenCode Router - Windows Native Installation & Setup Script
.DESCRIPTION
    Per-user automated installation for Windows 10/11:
    - Installs dependencies
    - Builds modern frontend
    - Provisions official Windows Xray-core
    - Configures user PATH for opencode-vpn
    - Initializes user AppData storage
#>
[CmdletBinding()]
param(
    [switch]$SkipFrontendBuild,
    [switch]$SkipPathRegistration,
    [switch]$CreateShortcut,
    [switch]$RequireNativeLauncher
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")

Set-Location $projectRoot

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🛡️  Installing OpenCode Router on Windows" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Project Directory: $projectRoot"
Write-Host ""

# 1. Environment Verification
$diagScript = Join-Path $scriptDir "check-environment.ps1"
if (Test-Path $diagScript) {
    & $diagScript
}

# 2. Install Dependencies
Write-Host "📦 Installing project dependencies..." -ForegroundColor Cyan
if (Test-Path "package-lock.json") {
    npm ci
} else {
    npm install
}

# 3. Build Frontend
if (-not $SkipFrontendBuild) {
    Write-Host ""
    Write-Host "🏗️  Compiling modern React dashboard..." -ForegroundColor Cyan
    npm run build:frontend
} else {
    Write-Host "⏩ Skipping frontend build (-SkipFrontendBuild specified)." -ForegroundColor Yellow
}

# 4. Provision Windows Xray-core
Write-Host ""
Write-Host "📥 Provisioning official Windows Xray-core..." -ForegroundColor Cyan
npx tsx scripts/provision-xray.ts

# 5. Initialize AppData Directory
$appDataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "OpenCode-Router"
} else {
    Join-Path $env:USERPROFILE "AppData\Local\OpenCode-Router"
}

# Migrate legacy unhyphenated directory if exists
$legacyAppData = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "OpenCodeRouter"
} else {
    Join-Path $env:USERPROFILE "AppData\Local\OpenCodeRouter"
}
if ((Test-Path $legacyAppData) -and -not (Test-Path $appDataDir)) {
    Write-Host "   Migrating existing user data from $legacyAppData to $appDataDir..." -ForegroundColor Yellow
    Copy-Item -Path "$legacyAppData\*" -Destination $appDataDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "📁 Initializing application data storage..." -ForegroundColor Cyan
$subdirs = @("data", "configs", "logs", "bin")
foreach ($d in $subdirs) {
    $target = Join-Path $appDataDir $d
    if (-not (Test-Path $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
    }
}
Write-Host "   AppData directory: $appDataDir" -ForegroundColor Green

# 6. Ensure Windows launchers exist in bin/ and compile native launcher
$binDir = Join-Path $projectRoot "bin"
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

$buildLauncherScript = Join-Path $projectRoot "scripts\windows\build-launcher.ps1"
if (Test-Path $buildLauncherScript) {
    Write-Host ""
    Write-Host "🔨 Compiling native Windows OpenCode launcher (opencode-vpn.exe)..." -ForegroundColor Cyan
    $strictFlag = if ($RequireNativeLauncher) { "-Strict" } else { "" }
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$buildLauncherScript" $strictFlag
    $compiledExe = Join-Path $binDir "opencode-vpn.exe"
    if (-not (Test-Path $compiledExe)) {
        if ($RequireNativeLauncher) {
            throw "[OpenCode Router ERROR] -RequireNativeLauncher was specified but opencode-vpn.exe could not be compiled. Ensure .NET Framework 4.5+ or .NET SDK is installed."
        }
        Write-Warning "[OpenCode Router] Native launcher ($compiledExe) was not built. .NET Framework csc.exe compiler was not detected. The native PowerShell launcher ($binDir\opencode-vpn.ps1) will be used."
    } else {
        Write-Host "   Native launcher verified: $compiledExe" -ForegroundColor Green
    }
}

# 7. Configure user PATH for opencode-vpn
if (-not $SkipPathRegistration) {
    Write-Host ""
    Write-Host "🔗 Configuring user PATH environment variable..." -ForegroundColor Cyan
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$binDir*") {
        $newPath = "$binDir;$currentPath"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$binDir;$env:Path"
        Write-Host "   Added '$binDir' to User PATH." -ForegroundColor Green
        Write-Host "   (You can now run 'opencode-vpn' from any new terminal window)" -ForegroundColor Gray
    } else {
        Write-Host "   User PATH already contains '$binDir'." -ForegroundColor Green
    }
}

# 8. Create Desktop Shortcut if requested
if ($CreateShortcut) {
    Write-Host ""
    Write-Host "📌 Creating Desktop Shortcut..." -ForegroundColor Cyan
    $wscript = New-Object -ComObject WScript.Shell
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "OpenCode Router.lnk"
    $shortcut = $wscript.CreateShortcut($shortcutPath)
    $startScript = Join-Path $scriptDir "start.ps1"
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$startScript`""
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = "OpenCode Router Control Plane"
    $shortcut.Save()
    Write-Host "   Created shortcut at $shortcutPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "🎉 OpenCode Router installed successfully on Windows!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application:" -ForegroundColor Cyan
Write-Host "  powershell -File scripts/windows/start.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "To use OpenCode with proxy:" -ForegroundColor Cyan
Write-Host "  opencode-vpn" -ForegroundColor Yellow
Write-Host "  opencode-vpn run `"Explain this code`"" -ForegroundColor Yellow
Write-Host ""
