$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'run-postgres-tests.ps1')
