import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { db, getSetting } from '../db/database';
import { ErrorClassifier, ClassificationResult } from './error-classifier';
import { Platform } from '../platform/platform';

export const APPROVED_FREE_MODELS = [
  'opencode/deepseek-v4.1-flash-free',
  'opencode/beam-free',
  'opencode/crouton-alpha-free',
  'opencode/flint-40b-free',
  'opencode/glm-5.3-flash-free',
  'opencode/iceman-free',
  'opencode/inkling-2-small-free',
  'opencode/mimo-v2.6-flash-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode/nemotron-3.5-super-vl-free'
] as const;

export type ApprovedFreeModel = typeof APPROVED_FREE_MODELS[number];

export interface OpenCodeInfo {
  installed: boolean;
  version?: string;
  binaryPath: string;
  configPath?: string;
  defaultModel?: string;
}

export class OpenCodeService {
  private static instance: OpenCodeService | null = null;
  private binaryPath: string;
  private launcherPath: string;
  private cachedInfo: OpenCodeInfo | null = null;
  private lastInfoCheck: number = 0;

  private constructor() {
    const projectRoot = Platform.getProjectRoot();
    this.launcherPath = path.join(
      projectRoot,
      'bin',
      Platform.isWindows() ? 'opencode-vpn.cmd' : 'opencode-vpn'
    );
    this.binaryPath = Platform.resolveOpenCodeBinary();

    this.ensureLauncherScript();
  }

  public static getInstance(): OpenCodeService {
    if (!this.instance) {
      this.instance = new OpenCodeService();
    }
    return this.instance;
  }

  public getInfo(): OpenCodeInfo {
    const now = Date.now();
    // Cache info for 30 seconds to avoid blocking execSync on every progress event
    if (this.cachedInfo && (now - this.lastInfoCheck < 30000)) {
      return this.cachedInfo;
    }

    // Refresh binary resolution
    this.binaryPath = Platform.resolveOpenCodeBinary();
    const installed = fs.existsSync(this.binaryPath) || Boolean(Platform.lookupPathCommand('opencode'));
    let version: string | undefined;
    let configPath: string | undefined;
    let defaultModel: string | undefined;

    if (installed) {
      try {
        version = execSync(`"${this.binaryPath}" --version`, {
          encoding: 'utf-8',
          timeout: 3000,
          windowsHide: true
        }).trim();
      } catch {
        // ignore
      }

      const userConfigCandidates = Platform.getUserConfigPaths();
      for (const p of userConfigCandidates) {
        if (fs.existsSync(p)) {
          configPath = p;
          try {
            const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
            if (cfg.model) {
              defaultModel = cfg.model;
              break;
            }
          } catch {
            // ignore
          }
        }
      }
    }

    this.cachedInfo = {
      installed,
      version,
      binaryPath: this.binaryPath,
      configPath,
      defaultModel
    };
    this.lastInfoCheck = now;

    return this.cachedInfo;
  }

  public getLauncherPath(): string {
    return this.launcherPath;
  }

  public ensureLauncherScript(): void {
    const projectRoot = Platform.getProjectRoot();
    const binDir = path.join(projectRoot, 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    // 1. Linux/macOS Bash Launcher
    const bashScriptPath = path.join(binDir, 'opencode-vpn');
    const bashScript = `#!/usr/bin/env bash
# Dedicated OpenCode VPN Launcher
# Injects the active local proxy specifically for OpenCode without system-wide routing changes.
# Enforces isolated standalone execution to prevent silently reusing unproxied background services.

HTTP_PORT="\${OPENCODE_HTTP_PROXY_PORT:-10809}"
SOCKS_PORT="\${OPENCODE_SOCKS_PROXY_PORT:-10808}"

export http_proxy="http://127.0.0.1:\${HTTP_PORT}"
export https_proxy="http://127.0.0.1:\${HTTP_PORT}"
export HTTP_PROXY="http://127.0.0.1:\${HTTP_PORT}"
export HTTPS_PROXY="http://127.0.0.1:\${HTTP_PORT}"
export all_proxy="socks5://127.0.0.1:\${SOCKS_PORT}"
export ALL_PROXY="socks5://127.0.0.1:\${SOCKS_PORT}"
export no_proxy="localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1"
export NO_PROXY="localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1"

OPENCODE_BIN="${this.binaryPath}"
if [ ! -x "\$OPENCODE_BIN" ]; then
  OPENCODE_BIN=\$(which opencode 2>/dev/null || echo "opencode")
fi

# Detect explicit attach/server parameters to warn about external server routing
for arg in "\$@"; do
  if [[ "\$arg" == "--attach" || "\$arg" == "--server" || "\$arg" == "attach" || "\$arg" == --attach=* || "\$arg" == --server=* ]]; then
    echo "[OpenCode Router WARNING] Detected explicit --attach/--server parameter. Outgoing requests from an external OpenCode server are controlled by that server's process and may NOT route through this active proxy tunnel!" >&2
    break
  fi
done

# Decide whether to inject --standalone for private proxy-isolated execution
INJECT_STANDALONE=false
FIRST_ARG="\$1"

if [ -z "\$FIRST_ARG" ]; then
  INJECT_STANDALONE=true
elif [ "\$FIRST_ARG" = "run" ]; then
  INJECT_STANDALONE=true
elif [[ ! "\$FIRST_ARG" =~ ^- ]] && [[ ! " serve web attach completion models providers auth stats export import github pr session plugin db debug upgrade uninstall acp mcp " =~ " \$FIRST_ARG " ]]; then
  INJECT_STANDALONE=true
fi

for arg in "\$@"; do
  if [ "\$arg" = "--standalone" ]; then
    INJECT_STANDALONE=false
    break
  fi
done

if [ "\$INJECT_STANDALONE" = true ]; then
  # Inject --standalone only if supported by this OpenCode binary (OpenCode v2+)
  if "\$OPENCODE_BIN" --help 2>&1 | grep -q -- '--standalone'; then
    if [ "\$FIRST_ARG" = "run" ]; then
      shift
      exec "\$OPENCODE_BIN" run --standalone "\$@"
    else
      exec "\$OPENCODE_BIN" --standalone "\$@"
    fi
  else
    exec "\$OPENCODE_BIN" "\$@"
  fi
else
  exec "\$OPENCODE_BIN" "\$@"
fi
`;
    try {
      fs.writeFileSync(bashScriptPath, bashScript, { encoding: 'utf-8', mode: 0o755 });
    } catch {}

    // Link to ~/.local/bin/opencode-vpn on Linux if directory exists
    if (!Platform.isWindows()) {
      const userLocalBin = path.join(process.env.HOME || os.homedir(), '.local', 'bin');
      if (fs.existsSync(userLocalBin)) {
        const userLink = path.join(userLocalBin, 'opencode-vpn');
        try {
          if (!fs.existsSync(userLink)) {
            fs.symlinkSync(bashScriptPath, userLink);
          }
        } catch {
          // ignore
        }
      }
    }

    // 2. Windows CMD Launcher (bin/opencode-vpn.cmd)
    const cmdScriptPath = path.join(binDir, 'opencode-vpn.cmd');
    const cmdScript = `@echo off
rem ============================================================================
rem OpenCode Router - Dedicated Windows OpenCode VPN Launcher (CMD)
rem Injects the active local proxy specifically for OpenCode without system-wide routing changes.
rem Enforces isolated standalone execution to prevent silently reusing unproxied background services.
rem ============================================================================

setlocal DisableDelayedExpansion

rem If native Windows launcher is compiled, prefer it to completely eliminate CMD syntax expansion
if exist "%~dp0opencode-vpn.exe" (
    "%~dp0opencode-vpn.exe" %*
    exit /b %ERRORLEVEL%
)

echo [OpenCode Router NOTICE] Native launcher (opencode-vpn.exe) not found. 1>&2
echo For guaranteed argument fidelity without CMD metacharacter expansion, build via: 1>&2
echo   powershell -File "%~dp0..\\scripts\\windows\\build-launcher.ps1" 1>&2
echo Or invoke PowerShell launcher directly: 1>&2
echo   powershell -File "%~dp0opencode-vpn.ps1" 1>&2
echo. 1>&2

if defined OPENCODE_STRICT_ARG_SAFETY (
    echo [OpenCode Router ERROR] Refusing unsafe batch argument forwarding because OPENCODE_STRICT_ARG_SAFETY=1 is set. 1>&2
    exit /b 1
)

if not defined OPENCODE_HTTP_PROXY_PORT set "OPENCODE_HTTP_PROXY_PORT=10809"
if not defined OPENCODE_SOCKS_PROXY_PORT set "OPENCODE_SOCKS_PROXY_PORT=10808"

set "http_proxy=http://127.0.0.1:%OPENCODE_HTTP_PROXY_PORT%"
set "https_proxy=http://127.0.0.1:%OPENCODE_HTTP_PROXY_PORT%"
set "HTTP_PROXY=http://127.0.0.1:%OPENCODE_HTTP_PROXY_PORT%"
set "HTTPS_PROXY=http://127.0.0.1:%OPENCODE_HTTP_PROXY_PORT%"
set "all_proxy=socks5://127.0.0.1:%OPENCODE_SOCKS_PROXY_PORT%"
set "ALL_PROXY=socks5://127.0.0.1:%OPENCODE_SOCKS_PROXY_PORT%"
set "no_proxy=localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1"
set "NO_PROXY=localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1"

rem Check for external server targeting using string search rather than parenthesis loops to avoid syntax breaks
echo "%* " | findstr /i /c:"--attach" /c:"--server" /c:" attach " >nul 2>&1
if not errorlevel 1 (
    echo [OpenCode Router WARNING] Detected explicit --attach/--server parameter. Outgoing requests from an external OpenCode server are controlled by that server's process, NOT by this launcher's active proxy! 1>&2
)

if defined OPENCODE_BIN if exist "%OPENCODE_BIN%" (
    set "TARGET_BIN=%OPENCODE_BIN%"
    goto :run
)

if exist "%LOCALAPPDATA%\\Programs\\opencode\\opencode.exe" (
    set "TARGET_BIN=%LOCALAPPDATA%\\Programs\\opencode\\opencode.exe"
    goto :run
)

if exist "%APPDATA%\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe" (
    set "TARGET_BIN=%APPDATA%\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe"
    goto :run
)

if exist "%APPDATA%\\npm\\opencode.exe" (
    set "TARGET_BIN=%APPDATA%\\npm\\opencode.exe"
    goto :run
)

for %%X in (opencode.exe opencode.cmd opencode) do (
    if not "%%~$PATH:X"=="" (
        set "TARGET_BIN=%%~$PATH:X"
        goto :run
    )
)

if exist "%APPDATA%\\npm\\opencode.cmd" (
    set "TARGET_BIN=%APPDATA%\\npm\\opencode.cmd"
    goto :run
)

set "TARGET_BIN=opencode"

:run
rem Check excluded subcommands that should never receive --standalone
for %%S in (serve web attach completion models providers auth stats export import github pr session plugin db debug upgrade uninstall acp mcp) do (
    if /i "%~1"=="%%S" goto :exec_direct
)

:exec_standalone
rem Check whether installed OpenCode binary supports --standalone (OpenCode v2+)
"%TARGET_BIN%" --help 2>&1 | findstr /c:"--standalone" >nul 2>&1
if errorlevel 1 (
    "%TARGET_BIN%" %*
) else (
    "%TARGET_BIN%" --standalone %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:exec_direct
"%TARGET_BIN%" %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
`;
    try {
      fs.writeFileSync(cmdScriptPath, cmdScript, { encoding: 'utf-8' });
    } catch {}

    // 3. Windows PowerShell Launcher (bin/opencode-vpn.ps1)
    const psScriptPath = path.join(binDir, 'opencode-vpn.ps1');
    const psScript = `<#
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
        if (Test-Path "$env:LOCALAPPDATA\\Programs\\opencode\\opencode.exe") {
            $targetBin = "$env:LOCALAPPDATA\\Programs\\opencode\\opencode.exe"
        } elseif (Test-Path "$env:APPDATA\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe") {
            $targetBin = "$env:APPDATA\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe"
        } elseif (Test-Path "$env:APPDATA\\npm\\opencode.exe") {
            $targetBin = "$env:APPDATA\\npm\\opencode.exe"
        } else {
            $cmd = Get-Command opencode -ErrorAction SilentlyContinue
            if ($cmd) {
                $targetBin = $cmd.Source
            } elseif (Test-Path "$env:APPDATA\\npm\\opencode.cmd") {
                $targetBin = "$env:APPDATA\\npm\\opencode.cmd"
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
`;
    try {
      fs.writeFileSync(psScriptPath, psScript, { encoding: 'utf-8' });
    } catch {}
  }

  private supportsStandaloneCache: boolean | null = null;

  /**
   * Detect whether the installed OpenCode binary supports the --standalone flag (OpenCode v2+).
   * OpenCode v1.x runs in-process or per-command and rejects --standalone as an unknown option.
   */
  public supportsStandalone(): boolean {
    if (this.supportsStandaloneCache !== null) {
      return this.supportsStandaloneCache;
    }
    try {
      const output = execSync(`"${this.binaryPath}" --help`, {
        timeout: 3000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      this.supportsStandaloneCache = output.includes('--standalone');
    } catch {
      this.supportsStandaloneCache = false;
    }
    return this.supportsStandaloneCache;
  }

  /**
   * Get the strictly approved OpenCode free verification model.
   * Never falls back to configured default models or paid providers.
   */
  public getApprovedVerificationModel(): string {
    const configured = getSetting('opencode_verification_model', 'opencode/deepseek-v4.1-flash-free');
    if (APPROVED_FREE_MODELS.includes(configured as any)) {
      return configured;
    }
    return 'opencode/deepseek-v4.1-flash-free';
  }

  /**
   * Run a controlled, non-interactive OpenCode test through the specific candidate proxy.
   * Strictly enforces using an approved OpenCode free-tier model.
   * Never calls paid providers (e.g. litellm/*) or unauthorized models.
   */
  public async testOpenCodeConnection(
    httpPort: number = 10809,
    socksPort: number = 10808,
    timeoutSeconds: number = 18,
    modelOverride?: string
  ): Promise<ClassificationResult> {
    const targetModel = modelOverride || this.getApprovedVerificationModel();

    // Strict model allowlist guard
    if (!APPROVED_FREE_MODELS.includes(targetModel as any)) {
      return {
        category: 'AUTH_ERROR',
        isRecoverableBySwitchingVpn: false,
        userMessage: `Verification blocked: Model '${targetModel || 'unspecified'}' is not in the approved OpenCode free models allowlist. Paid/third-party providers are strictly disabled for automated candidate screening.`
      };
    }

    const prompt = 'Reply with exactly: CONNECTION_OK';
    const args = ['run'];
    if (this.supportsStandalone()) {
      args.push('--standalone');
    }
    args.push(
      '-m', targetModel,
      '--title', 'opencode-proxy-probe',
      prompt,
      '--pure',
      '--format', 'json',
      '--print-logs'
    );

    // Write an ephemeral probe config to prevent stalling on offline remote MCP servers (e.g. windows-opencode)
    const probeConfigPath = path.join(os.tmpdir(), 'opencode-proxy-probe-config.json');
    try {
      fs.writeFileSync(probeConfigPath, JSON.stringify({
        mcp: {},
        model: targetModel,
        small_model: targetModel
      }), { mode: 0o600 });
    } catch {}

    // Proxy settings injected exclusively into this process
    const proxyEnv: NodeJS.ProcessEnv = {
      ...process.env,
      http_proxy: `http://127.0.0.1:${httpPort}`,
      https_proxy: `http://127.0.0.1:${httpPort}`,
      HTTP_PROXY: `http://127.0.0.1:${httpPort}`,
      HTTPS_PROXY: `http://127.0.0.1:${httpPort}`,
      all_proxy: `socks5://127.0.0.1:${socksPort}`,
      ALL_PROXY: `socks5://127.0.0.1:${socksPort}`,
      no_proxy: 'localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1',
      NO_PROXY: 'localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1',
      OPENCODE_CONFIG: probeConfigPath,
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true'
    };

    return new Promise<ClassificationResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let isDone = false;

      const child = Platform.safeSpawn(this.binaryPath, args, {
        env: proxyEnv,
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      const timer = setTimeout(async () => {
        if (!isDone) {
          isDone = true;
          if (child.pid) {
            await Platform.terminateProcess(child.pid);
          }
          resolve({
            category: 'NETWORK_ERROR',
            isRecoverableBySwitchingVpn: true,
            userMessage: `OpenCode test timed out after ${timeoutSeconds}s through proxy.`,
            rawDetails: stderr || stdout
          });
        }
      }, timeoutSeconds * 1000);

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          resolve({
            category: 'CONFIG_ERROR',
            isRecoverableBySwitchingVpn: false,
            userMessage: `Failed to execute OpenCode binary: ${err.message}`,
            rawDetails: err.stack
          });
        }
      });

      child.on('exit', (code) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);

          let rawHeaders: Record<string, string> | undefined;
          // If quota reached or rate-limited, query endpoint directly through proxy to capture exact HTTP headers
          const combined = `${stdout}\n${stderr}`.toLowerCase();
          if (combined.includes('free usage limit') || combined.includes('rate limit') || combined.includes('429')) {
            try {
              const probeCmd = `curl -s -i --max-time 3 --proxy http://127.0.0.1:${httpPort} https://opencode.ai/inference/openai/v1/chat/completions -H "Authorization: Bearer public" -H "User-Agent: opencode/1.19.5" -H "Content-Type: application/json" -d '{"model":"${targetModel}","messages":[{"role":"user","content":"ping"}],"stream":false}'`;
              const probeOut = execSync(probeCmd, { encoding: 'utf-8', timeout: 3500 });
              rawHeaders = {};
              for (const line of probeOut.split('\n')) {
                const parts = line.split(':');
                if (parts.length >= 2) {
                  rawHeaders[parts[0].trim().toLowerCase()] = parts.slice(1).join(':').trim();
                }
              }
            } catch {
              // fallback to stderr parsing
            }
          }

          const classification = ErrorClassifier.classify(code, stdout, stderr, targetModel, rawHeaders);
          classification.rawDetails = stderr.slice(0, 1000) || stdout.slice(0, 1000);
          resolve(classification);
        }
      });
    });
  }
}
