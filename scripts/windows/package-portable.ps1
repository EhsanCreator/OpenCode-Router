<#
.SYNOPSIS
    OpenCode Router - Windows Portable Packager
.DESCRIPTION
    Creates a standalone portable ZIP distribution of OpenCode Router for Windows.
#>
[CmdletBinding()]
param()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))

Set-Location $projectRoot
npx tsx scripts/package-portable.ts
