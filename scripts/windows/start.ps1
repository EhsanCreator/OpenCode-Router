<#
.SYNOPSIS
    OpenCode Router - Windows Native Startup Script
.DESCRIPTION
    Launches the backend server, verifies health status, opens the dashboard in the default browser,
    and handles graceful shutdown on Ctrl+C.
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")

Set-Location $projectRoot

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🛡️  Starting OpenCode Router (Windows)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Provision Xray if missing
$xrayBin = Join-Path $projectRoot "bin\xray.exe"
if (-not (Test-Path $xrayBin)) {
    Write-Host "📥 Windows Xray binary not found. Provisioning official release..." -ForegroundColor Cyan
    npx tsx scripts/provision-xray.ts
}

# 2. Build frontend if dist/ does not exist
$frontendDist = Join-Path $projectRoot "src\frontend\dist\index.html"
if (-not (Test-Path $frontendDist)) {
    Write-Host "📦 Compiling modern frontend application..." -ForegroundColor Cyan
    npm run build:frontend
}

# 3. Start backend server
Write-Host "🚀 Launching backend server on port $Port..." -ForegroundColor Cyan
$env:PORT = $Port.ToString()

# Start background Node/tsx process
$serverProcess = Start-Process -FilePath "npx.cmd" -ArgumentList "tsx", "src/backend/server.ts" -PassThru -NoNewWindow

# 4. Wait for server readiness
Write-Host "⏳ Waiting for HTTP service readiness..." -ForegroundColor Cyan
$ready = $false
$maxAttempts = 30

for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/status" -TimeoutSec 2 -ErrorAction Stop
        if ($response) {
            $ready = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 400
    }
}

if (-not $ready) {
    Write-Host "❌ Backend server failed to start within timeout." -ForegroundColor Red
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
    exit 1
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "✅ OpenCode Router is LIVE and READY!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "🌐 Web Dashboard: http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "🔌 SOCKS5 Proxy:  127.0.0.1:10808" -ForegroundColor Gray
Write-Host "🔌 HTTP Proxy:    127.0.0.1:10809" -ForegroundColor Gray
Write-Host ""
Write-Host "To use OpenCode CLI with active proxy:" -ForegroundColor Cyan
Write-Host "   opencode-vpn" -ForegroundColor Yellow
Write-Host "   opencode-vpn run `"Hello world`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the router server gracefully." -ForegroundColor Gray
Write-Host ""

# 5. Open browser if not disabled
if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$Port"
}

# 6. Keep process attached and handle clean exit
try {
    Wait-Process -Id $serverProcess.Id
} finally {
    Write-Host "`nShutting down OpenCode Router..." -ForegroundColor Cyan
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    # Also stop any managed Xray instance
    $stopScript = Join-Path $scriptDir "stop.ps1"
    if (Test-Path $stopScript) {
        & $stopScript
    }
    Write-Host "Clean shutdown complete." -ForegroundColor Green
}
