$ErrorActionPreference = 'Stop'
$postgresBin = 'C:\Program Files\PostgreSQL\18\bin'
$testData = Join-Path $env:TEMP 'voteFeed-test-postgres'
$startedHere = $false
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    if (-not (Test-Path (Join-Path $testData 'PG_VERSION'))) {
        & "$postgresBin\initdb.exe" -D $testData -U postgres -A trust -E UTF8
        if ($LASTEXITCODE -ne 0) { throw 'Test database initialization failed' }
    }
    & "$postgresBin\pg_ctl.exe" status -D $testData
    if ($LASTEXITCODE -ne 0) {
        & "$postgresBin\pg_ctl.exe" start -D $testData -l (Join-Path $env:TEMP 'voteFeed-batch-postgres.log') -o '-h 127.0.0.1 -p 55439' -w
        if ($LASTEXITCODE -ne 0) { throw 'Test database startup failed' }
        $startedHere = $true
    }
    & 'C:\Program Files\nodejs\node.exe' --test tests/batch-stances.test.mjs tests/combined-card-responses.test.mjs tests/card-response-identity.test.mjs tests/alignment-summary.test.mjs tests/alignment-refresh.test.mjs tests/vote-position.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Batch stance tests failed' }
} finally {
    if ($startedHere) { & "$postgresBin\pg_ctl.exe" stop -D $testData -m fast -w }
    Pop-Location
}
