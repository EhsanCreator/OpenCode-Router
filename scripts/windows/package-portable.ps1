<#
.SYNOPSIS
    OpenCode Router - Windows Portable Packager
.DESCRIPTION
    Creates a standalone portable ZIP distribution of OpenCode Router for Windows.
#>
[CmdletBinding()]
param()

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

Set-Location $projectRoot
npx tsx scripts/package-portable.ts
