<#
.SYNOPSIS
    Builds the native Windows OpenCode VPN Launcher executable (bin\opencode-vpn.exe)
.DESCRIPTION
    Compiles src\launcher\opencode-vpn-launcher.cs using the built-in Windows .NET C# compiler (csc.exe)
    or Roslyn compiler. This native launcher eliminates cmd.exe argument expansion vulnerabilities
    and preserves console interactivity.
#>

[CmdletBinding()]
param(
    [switch]$Strict
)

$ErrorActionPreference = 'Continue'

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

$sourceFile = Join-Path $projectRoot "src\launcher\opencode-vpn-launcher.cs"
$binDir = Join-Path $projectRoot "bin"
$outputExe = Join-Path $binDir "opencode-vpn.exe"

if (-not (Test-Path $sourceFile)) {
    [Console]::Out.WriteLine("::error::[OpenCode Router] Source file not found: $sourceFile")
    if ($Strict -or $env:OPENCODE_REQUIRE_NATIVE_LAUNCHER -eq "1") {
        [Console]::Error.WriteLine("[OpenCode Router] Source file not found: $sourceFile")
        exit 1
    }
    exit 1
}

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

# Locate C# Compiler (csc.exe) preinstalled on Windows 10/11 or VS/BuildTools
$progFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$progFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
$windir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)

$cscCandidates = @(
    (Join-Path $progFiles "Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $progFilesX86 "Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $progFiles "Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $progFilesX86 "Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $progFiles "Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $progFilesX86 "Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $progFiles "Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $progFilesX86 "Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\Roslyn\csc.exe"),
    (Join-Path $windir "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $windir "Microsoft.NET\Framework\v4.0.30319\csc.exe"),
    "csc.exe"
)

$compiled = $false
$compilationLogs = @()

foreach ($candidate in $cscCandidates) {
    $resolvedPath = $null
    if (Test-Path $candidate) {
        $resolvedPath = $candidate
    } else {
        $found = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($found) { $resolvedPath = $found.Source }
    }

    if (-not $resolvedPath) { continue }

    [Console]::Out.WriteLine("[*] Attempting compilation with $resolvedPath...")

    # Flag options: Note that in csc.exe the /out: switch must NOT have quotes around /out:
    $flagSets = @(
        "/nologo /optimize+ /target:exe /reference:System.dll /reference:System.Core.dll /out:`"$outputExe`" `"$sourceFile`"",
        "/nologo /optimize+ /target:exe /out:`"$outputExe`" `"$sourceFile`""
    )

    foreach ($argsStr in $flagSets) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $resolvedPath
        $psi.Arguments = $argsStr
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true

        try {
            $proc = [System.Diagnostics.Process]::Start($psi)
            $stdout = $proc.StandardOutput.ReadToEnd()
            $stderr = $proc.StandardError.ReadToEnd()
            $proc.WaitForExit()
            $exitCode = $proc.ExitCode

            if ($exitCode -eq 0 -and (Test-Path $outputExe)) {
                [Console]::Out.WriteLine("[+] Native Windows launcher built successfully: $outputExe")
                $compiled = $true
                break
            } else {
                $compilationLogs += "Compiler: $resolvedPath"
                $compilationLogs += "Args: $argsStr"
                $compilationLogs += "ExitCode: $exitCode"
                if ($stdout) { $compilationLogs += "STDOUT: $stdout" }
                if ($stderr) { $compilationLogs += "STDERR: $stderr" }
            }
        } catch {
            $compilationLogs += "Exception launching $resolvedPath`: $_"
        }
    }

    if ($compiled) { break }
}

if (-not $compiled) {
    [Console]::Out.WriteLine("::error::Failed to compile native launcher ($outputExe) with any C# compiler.")
    foreach ($logLine in $compilationLogs) {
        [Console]::Out.WriteLine("::error::$logLine")
    }

    if ($env:GITHUB_STEP_SUMMARY) {
        Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "### Native Windows Launcher Compilation Failure Diagnostics"
        Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value '```text'
        Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ($compilationLogs -join "`n")
        Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value '```'
    }

    if ($Strict -or $env:OPENCODE_REQUIRE_NATIVE_LAUNCHER -eq "1") {
        [Console]::Error.WriteLine("Failed to compile $outputExe. All candidate C# compilers failed. See above diagnostics.")
        exit 1
    }

    Write-Warning "[OpenCode Router] Native launcher could not be compiled. The PowerShell launcher (bin\opencode-vpn.ps1) will be used."
    exit 0
}
