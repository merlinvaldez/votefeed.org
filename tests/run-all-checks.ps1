$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path $PSScriptRoot -Parent
$nodeNpm = 'C:\Program Files\nodejs\npm.cmd'
$deno = Join-Path $repoRoot 'node_modules\.bin\deno.cmd'
$results = [System.Collections.Generic.List[object]]::new()

function Invoke-Check {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host "`n=== $Name ==="
    $previousLocation = Get-Location
    $exitCode = 1
    try {
        Set-Location $repoRoot
        & $Command @Arguments
        $exitCode = $LASTEXITCODE
    } catch {
        Write-Host $_ -ForegroundColor Red
    } finally {
        Set-Location $previousLocation
    }

    $results.Add([pscustomobject]@{ Name = $Name; ExitCode = $exitCode })
}

Invoke-Check 'PostgreSQL-backed Node test suite' $nodeNpm @('run', 'test:postgres')
Invoke-Check 'Deno notification tests' $deno @(
    'test',
    'supabase/functions/send-vote-notifications/digest.test.ts',
    'supabase/functions/send-vote-notifications/summary.test.ts'
)
Invoke-Check 'Client lint' $nodeNpm @('--prefix', 'client', 'run', 'lint')
Invoke-Check 'Client production build' $nodeNpm @('--prefix', 'client', 'run', 'build')

Write-Host "`n=== Check results ==="
$results | Format-Table -AutoSize

$failedChecks = @($results | Where-Object { $_.ExitCode -ne 0 })
if ($failedChecks.Count -gt 0) {
    $failedNames = ($failedChecks | ForEach-Object Name) -join ', '
    throw "Checks failed: $failedNames. The current PowerShell terminal remains available."
}

Write-Host 'All checks passed.' -ForegroundColor Green
