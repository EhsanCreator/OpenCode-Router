<#
.SYNOPSIS
    Dedicated OpenCode VPN Launcher for PowerShell
.DESCRIPTION
    Injects the active local proxy specifically for OpenCode without system-wide routing changes.
    Enforces isolated standalone execution to prevent silently reusing unproxied background services.
    Preserves real interactive console handles (TTY), raw keyboard input, ANSI sequences, and Ctrl+C.
#>

$httpPort = if ($env:OPENCODE_HTTP_PROXY_PORT) { $env:OPENCODE_HTTP_PROXY_PORT } else { "10809" }
$socksPort = if ($env:OPENCODE_SOCKS_PROXY_PORT) { $env:OPENCODE_SOCKS_PROXY_PORT } else { "10808" }

# Snapshot original proxy environment variables using canonical case-insensitive keys.
# On Windows, environment variable names are case-insensitive; duplicate case variants in hashtables cause parser errors.
$oldEnv = @{
    HTTP_PROXY  = [Environment]::GetEnvironmentVariable("HTTP_PROXY", "Process")
    HTTPS_PROXY = [Environment]::GetEnvironmentVariable("HTTPS_PROXY", "Process")
    ALL_PROXY   = [Environment]::GetEnvironmentVariable("ALL_PROXY", "Process")
    NO_PROXY    = [Environment]::GetEnvironmentVariable("NO_PROXY", "Process")
}

$httpProxyUrl = "http://127.0.0.1:$httpPort"
$socksProxyUrl = "socks5://127.0.0.1:$socksPort"
$noProxyList = "localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1"

$env:HTTP_PROXY  = $httpProxyUrl
$env:HTTPS_PROXY = $httpProxyUrl
$env:ALL_PROXY   = $socksProxyUrl
$env:NO_PROXY    = $noProxyList

$env:http_proxy  = $httpProxyUrl
$env:https_proxy = $httpProxyUrl
$env:all_proxy   = $socksProxyUrl
$env:no_proxy    = $noProxyList

# Check for external server targeting
foreach ($arg in $args) {
    if ($arg -match "^(--attach|--server|attach)" -or $arg -eq "attach") {
        Write-Warning "[OpenCode Router] Explicit --attach/--server targets an external OpenCode server. Network routing is determined by that server's process, NOT by this launcher's active proxy!"
        break
    }
}

try {
    $targetBin = $env:OPENCODE_BIN
    if (-not $targetBin -or -not (Test-Path $targetBin)) {
        if (Test-Path "$env:LOCALAPPDATA\Programs\opencode\opencode.exe") {
            $targetBin = "$env:LOCALAPPDATA\Programs\opencode\opencode.exe"
        } elseif (Test-Path "$env:APPDATA\npm\node_modules\opencode-ai\bin\opencode.exe") {
            $targetBin = "$env:APPDATA\npm\node_modules\opencode-ai\bin\opencode.exe"
        } elseif (Test-Path "$env:APPDATA\npm\opencode.exe") {
            $targetBin = "$env:APPDATA\npm\opencode.exe"
        } else {
            $cmd = Get-Command opencode -ErrorAction SilentlyContinue
            if ($cmd) {
                $targetBin = $cmd.Source
            } elseif (Test-Path "$env:APPDATA\npm\opencode.cmd") {
                $targetBin = "$env:APPDATA\npm\opencode.cmd"
            } else {
                $targetBin = "opencode"
            }
        }
    }

    # Standalone injection logic
    $injectStandalone = $false
    $firstArg = if ($args.Count -gt 0) { $args[0] } else { $null }
    $excludedSubcommands = @('serve', 'web', 'attach', 'completion', 'models', 'providers', 'auth', 'stats', 'export', 'import', 'github', 'pr', 'session', 'plugin', 'db', 'debug', 'upgrade', 'uninstall', 'acp', 'mcp')

    if (-not $firstArg) {
        $injectStandalone = $true
    } elseif ($firstArg -eq 'run') {
        $injectStandalone = $true
    } elseif (-not $firstArg.StartsWith('-') -and ($excludedSubcommands -notcontains $firstArg)) {
        $injectStandalone = $true
    }

    if ($args -contains '--standalone') {
        $injectStandalone = $false
    }

    $finalArgs = @()
    if ($injectStandalone) {
        $helpText = & "$targetBin" --help 2>&1 | Out-String
        if ($helpText -match "--standalone") {
            if ($firstArg -eq 'run') {
                $remaining = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }
                $finalArgs = @('run', '--standalone') + $remaining
            } else {
                $finalArgs = @('--standalone') + $args
            }
        } else {
            $finalArgs = $args
        }
    } else {
        $finalArgs = $args
    }

    if ($finalArgs.Count -gt 0) {
        & "$targetBin" @finalArgs
    } else {
        & "$targetBin"
    }
    $global:LASTEXITCODE = $LASTEXITCODE
    exit $LASTEXITCODE
} finally {
    foreach ($k in $oldEnv.Keys) {
        $origVal = $oldEnv[$k]
        if ($null -ne $origVal) {
            [Environment]::SetEnvironmentVariable($k, $origVal, "Process")
            [Environment]::SetEnvironmentVariable($k.ToLowerInvariant(), $origVal, "Process")
        } else {
            [Environment]::SetEnvironmentVariable($k, $null, "Process")
            [Environment]::SetEnvironmentVariable($k.ToLowerInvariant(), $null, "Process")
        }
    }
}
