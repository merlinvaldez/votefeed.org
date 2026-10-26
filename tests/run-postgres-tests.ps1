param([string]$TestFile = '*.test.mjs')

$ErrorActionPreference = 'Stop'

$postgresBin = 'C:\Program Files\PostgreSQL\18\bin'
$repoRoot = Split-Path $PSScriptRoot -Parent
$testData = Join-Path $env:TEMP 'voteFeed-test-postgres'
$postgresExe = Join-Path $postgresBin 'postgres.exe'
$pgCtlExe = Join-Path $postgresBin 'pg_ctl.exe'
$initDbExe = Join-Path $postgresBin 'initdb.exe'
$psqlExe = Join-Path $postgresBin 'psql.exe'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$startedHere = $false
$serverProcess = $null
$flags = @('BATCH_STANCES_TEST_POSTGRES', 'ALIGNMENT_TEST_POSTGRES', 'DELEGATION_TEST_POSTGRES', 'ELECTIONS_TEST_POSTGRES')
$previousFlags = @{}

foreach ($flag in $flags) {
    $previousFlags[$flag] = [Environment]::GetEnvironmentVariable($flag, 'Process')
}

Push-Location $repoRoot
try {
    foreach ($path in @($postgresExe, $pgCtlExe, $initDbExe, $psqlExe, $nodeExe)) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Required test tool not found: $path"
        }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $testData 'PG_VERSION'))) {
        & $initDbExe -D $testData -U postgres -A trust -E UTF8
        if ($LASTEXITCODE -ne 0) { throw 'Test database initialization failed' }
    }

    & $pgCtlExe status -D $testData *> $null
    $clusterRunning = $LASTEXITCODE -eq 0
    if (-not $clusterRunning) {
        $portProbe = [System.Net.Sockets.TcpClient]::new()
        try {
            $portProbe.Connect('127.0.0.1', 55439)
            throw 'Port 55439 is already in use by a different process; stopping to avoid running tests against the wrong database.'
        } catch [System.Net.Sockets.SocketException] {
            # The expected state for a stopped test cluster is a refused connection.
        } finally {
            $portProbe.Dispose()
        }

        $runId = [Guid]::NewGuid().ToString('N')
        $stdoutPath = Join-Path $env:TEMP "voteFeed-postgres-$runId.stdout.log"
        $stderrPath = Join-Path $env:TEMP "voteFeed-postgres-$runId.stderr.log"
        $serverProcess = Start-Process -FilePath $postgresExe `
            -ArgumentList @('-D', ('"' + $testData + '"'), '-h', '127.0.0.1', '-p', '55439') `
            -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $startedHere = $true

        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ($serverProcess.HasExited) {
                $details = @()
                foreach ($logPath in @($stdoutPath, $stderrPath)) {
                    if (Test-Path -LiteralPath $logPath) { $details += Get-Content -LiteralPath $logPath }
                }
                throw "PostgreSQL exited during startup. Logs: $($details -join [Environment]::NewLine)"
            }

            $probe = [System.Net.Sockets.TcpClient]::new()
            try {
                $probe.Connect('127.0.0.1', 55439)
                $ready = $true
                break
            } catch [System.Net.Sockets.SocketException] {
                Start-Sleep -Milliseconds 500
            } finally {
                $probe.Dispose()
            }
        }
        if (-not $ready) { throw 'PostgreSQL did not listen on 127.0.0.1:55439 within 30 seconds.' }
    }

    & $psqlExe -X -h 127.0.0.1 -p 55439 -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'The isolated PostgreSQL test database did not accept a SQL connection.' }

    foreach ($flag in $flags) {
        [Environment]::SetEnvironmentVariable($flag, '1', 'Process')
    }

    if ($TestFile -match '[/\\]' -or $TestFile -notlike '*.test.mjs') { throw 'TestFile must be a test filename or pattern within tests.' }
    $testFiles = @(Get-ChildItem -Path .\tests -Filter $TestFile | Sort-Object Name | ForEach-Object FullName)
    if ($testFiles.Count -eq 0) { throw 'No Node test files were found under tests.' }

    Write-Host "Running $($testFiles.Count) test files with PostgreSQL at 127.0.0.1:55439."
    & $nodeExe --test @testFiles
    if ($LASTEXITCODE -ne 0) { throw "Node test runner failed with exit code $LASTEXITCODE." }
} finally {
    foreach ($flag in $flags) {
        [Environment]::SetEnvironmentVariable($flag, $previousFlags[$flag], 'Process')
    }

    if ($startedHere) {
        & $pgCtlExe stop -D $testData -m fast -w *> $null
        if ($LASTEXITCODE -ne 0 -and $serverProcess -and -not $serverProcess.HasExited) {
            Write-Warning 'Graceful PostgreSQL shutdown failed; stopping the test server process.'
            Stop-Process -Id $serverProcess.Id -Force
        }
    }

    Pop-Location
}
