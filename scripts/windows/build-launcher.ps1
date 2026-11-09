<#
.SYNOPSIS
    Builds the native Windows OpenCode VPN Launcher executable (bin\opencode-vpn.exe)
.DESCRIPTION
    Compiles src\launcher\opencode-vpn-launcher.cs using the built-in Windows .NET C# compiler (csc.exe).
    This native launcher eliminates cmd.exe argument expansion vulnerabilities and preserves console interactivity.
#>

[CmdletBinding()]
param(
    [switch]$Strict
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
$sourceFile = Join-Path $projectRoot "src\launcher\opencode-vpn-launcher.cs"
$binDir = Join-Path $projectRoot "bin"
$outputExe = Join-Path $binDir "opencode-vpn.exe"

if (-not (Test-Path $sourceFile)) {
    Write-Error "[OpenCode Router] Source file not found: $sourceFile"
}

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

# Locate C# Compiler (csc.exe) preinstalled on Windows 10/11
$cscCandidates = @(
    "$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:windir\Microsoft.NET\Framework\v4.0.30319\csc.exe",
    "csc.exe"
)

$cscPath = $null
foreach ($candidate in $cscCandidates) {
    if (Test-Path $candidate) {
        $cscPath = $candidate
        break
    } else {
        $found = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($found) {
            $cscPath = $found.Source
            break
        }
    }
}

if ($cscPath) {
    Write-Host "🔨 Compiling native launcher with $cscPath..." -ForegroundColor Cyan
    $compileOutput = & "$cscPath" /nologo /optimize+ /target:exe "/out:$outputExe" "$sourceFile" 2>&1
    Write-Host ($compileOutput | Out-String)
    if ($LASTEXITCODE -eq 0 -and (Test-Path $outputExe)) {
        Write-Host "✅ Native Windows launcher built successfully: $outputExe" -ForegroundColor Green
        exit 0
    } else {
        if ($Strict -or $env:OPENCODE_REQUIRE_NATIVE_LAUNCHER -eq "1") {
            throw "Failed to compile $outputExe (ExitCode: $LASTEXITCODE). Output: $compileOutput"
        }
        Write-Error "Failed to compile $outputExe (ExitCode: $LASTEXITCODE)"
    }
} else {
    # Fallback to dotnet if available
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($dotnet) {
        Write-Host "🔨 Compiling via dotnet..." -ForegroundColor Cyan
    }
    if ($Strict -or $env:OPENCODE_REQUIRE_NATIVE_LAUNCHER -eq "1") {
        throw "[OpenCode Router] Native C# compiler (csc.exe) not found. .NET Framework 4.5+ or .NET SDK is required to compile $outputExe."
    }
    Write-Warning "[OpenCode Router] csc.exe not found. Falling back to PowerShell/CMD launchers."
    exit 0
}
