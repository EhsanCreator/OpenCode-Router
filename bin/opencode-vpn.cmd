@echo off
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
echo   powershell -File "%~dp0..\scripts\windows\build-launcher.ps1" 1>&2
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

if exist "%LOCALAPPDATA%\Programs\opencode\opencode.exe" (
    set "TARGET_BIN=%LOCALAPPDATA%\Programs\opencode\opencode.exe"
    goto :run
)

if exist "%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe" (
    set "TARGET_BIN=%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe"
    goto :run
)

if exist "%APPDATA%\npm\opencode.exe" (
    set "TARGET_BIN=%APPDATA%\npm\opencode.exe"
    goto :run
)

for %%X in (opencode.exe opencode.cmd opencode) do (
    if not "%%~$PATH:X"=="" (
        set "TARGET_BIN=%%~$PATH:X"
        goto :run
    )
)

if exist "%APPDATA%\npm\opencode.cmd" (
    set "TARGET_BIN=%APPDATA%\npm\opencode.cmd"
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
