[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$DestinationRoot,
    [switch]$AllowSessionPooler,
    [string]$PostgreSqlBinDirectory,
    [string]$MigrationPath = 'supabase/migrations/012_enforce_uuid_active_recipe_writes.sql'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RecipeGenieBackup.Common.ps1')

$databaseUrlVariable = 'RECIPE_GENIE_PRODUCTION_DATABASE_URL'
$projectReferenceVariable = 'RECIPE_GENIE_PRODUCTION_PROJECT_REF'
$databaseUrl = [Environment]::GetEnvironmentVariable($databaseUrlVariable, 'Process')
$projectReference = [Environment]::GetEnvironmentVariable($projectReferenceVariable, 'Process')
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw "Required environment variable $databaseUrlVariable is missing." }
if ([string]::IsNullOrWhiteSpace($projectReference)) { throw "Required environment variable $projectReferenceVariable is missing." }

$repositoryRoot = (git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $repositoryRoot) { throw "Git repository root could not be established." }
$repositoryRoot = $repositoryRoot.Trim()
$registeredWorktrees = Get-RegisteredGitWorktreePaths -RepositoryRoot $repositoryRoot
Assert-ExternalDestination -DestinationRoot $DestinationRoot -RegisteredWorktreePaths $registeredWorktrees
$linkedProjectReference = Get-LinkedProjectReference -RepositoryRoot $repositoryRoot
if ($linkedProjectReference -ne $projectReference) {
    throw 'Expected project reference does not match the independently linked Supabase project.'
}
$connection = ConvertFrom-RecipeGenieDatabaseUrl -DatabaseUrl $databaseUrl -ExpectedProjectReference $projectReference -AllowSessionPooler:$AllowSessionPooler

$gitCommitSha = (git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $gitCommitSha -notmatch '^[0-9a-f]{40}$') { throw "Git commit SHA could not be captured." }
$migrationRelativePath = $MigrationPath.Replace('\\', '/')
$migrationFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $migrationRelativePath)
if (-not (Test-PathWithin -Candidate $migrationFullPath -Parent $repositoryRoot) -or -not (Test-Path -LiteralPath $migrationFullPath -PathType Leaf)) {
    throw 'Migration file is missing or outside the repository.'
}
$migrationCommitHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $migrationRelativePath
if (-not (Test-GitPathMatchesCommit -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $migrationRelativePath)) { throw 'Migration file differs from the recorded Git commit.' }
$preflightRelativePath = 'scripts/database/preflight/' + [IO.Path]::GetFileName($migrationRelativePath)
$preflightFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $preflightRelativePath)
if (-not (Test-Path -LiteralPath $preflightFullPath -PathType Leaf)) { throw 'Commit-bound migration preflight is missing.' }
$preflightCommitHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $preflightRelativePath
if (-not (Test-GitPathMatchesCommit -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $preflightRelativePath)) { throw 'Migration preflight differs from the recorded Git commit.' }

$destination = Get-NormalizedFullPath $DestinationRoot
[IO.Directory]::CreateDirectory($destination) | Out-Null
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmss.fffZ')
$backupName = "recipe-genie-production-$timestamp"
$finalBackupDirectory = Join-Path $destination $backupName
$backupDirectory = Join-Path $destination "$backupName.incomplete"
if ((Test-Path -LiteralPath $backupDirectory) -or (Test-Path -LiteralPath $finalBackupDirectory)) { throw "Generated backup directory already exists." }
$logsDirectory = Join-Path $backupDirectory 'logs'
[IO.Directory]::CreateDirectory($logsDirectory) | Out-Null
$archivePath = Join-Path $backupDirectory 'database.dump'
$manifestPath = Join-Path $backupDirectory 'manifest.json'
$summaryPath = Join-Path $backupDirectory 'summary.txt'
$literalSecrets = @($databaseUrl, $connection.Password, [Uri]::EscapeDataString($connection.Password))

$manifest = [ordered]@{
    schemaVersion = 2
    appName = 'Recipe Genie'
    environment = 'production'
    projectReference = $projectReference
    createdAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    gitCommitSha = $gitCommitSha
    gitWorktreeClean = $false
    runtime = [ordered]@{
        edition = $PSVersionTable.PSEdition
        version = $PSVersionTable.PSVersion.ToString()
        architecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    }
    connectedIdentity = [ordered]@{
        linkedProjectReference = $linkedProjectReference
        endpointAndLinkCorroborated = $true
        databaseSchemaCorroborated = $false
        migrationLedgerVersions = $null
    }
    migration = [ordered]@{
        path = $migrationRelativePath
        commitSha = $gitCommitSha
        sha256 = $migrationCommitHash
        worktreeMatchesCommit = $true
    }
    preflight = [ordered]@{
        path = $preflightRelativePath
        commitSha = $gitCommitSha
        sha256 = $preflightCommitHash
        readOnly = $true
        countOnly = $true
        worktreeMatchesCommit = $true
    }
    backupScope = [ordered]@{
        type = 'logical-database-custom-archive'
        includedSchemas = @('public', 'private', 'supabase_migrations')
        includesStorageObjectPayloads = $false
        includesSupabaseManagedAuthConfiguration = $false
        includesGlobalRoles = $false
        includesSecrets = $false
    }
    postgresServerVersion = $null
    connectionType = $connection.EndpointType
    toolVersions = [ordered]@{}
    artifacts = @()
    archiveContents = [ordered]@{
        migrationLedgerFound = $false
        expectedApplicationMarkersFound = $false
    }
    commandResults = [ordered]@{
        serverVersionQueryExitCode = $null
        identityQueryExitCode = $null
        pgDumpExitCode = $null
        pgRestoreListExitCode = $null
    }
    dumpCompleted = $false
    archiveValidated = $false
    restoreVerified = $false
    restoreVerification = $null
    storageFilesBackedUp = $false
    backupStatus = 'incomplete'
    migrationAuthorizationGranted = $false
}

$previousPgEnvironment = @{}
$pgNames = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE')
foreach ($name in $pgNames) {
    $previousPgEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    $tools = [ordered]@{}
    foreach ($name in @('pg_dump','pg_restore','psql')) {
        $tools[$name] = Resolve-PostgreSqlTool -Name $name -BinDirectory $PostgreSqlBinDirectory
        $out = Join-Path $logsDirectory "$name-version.stdout.log"
        $err = Join-Path $logsDirectory "$name-version.stderr.log"
        $result = Invoke-RecipeGenieNativeProcess -ExecutablePath $tools[$name] -ArgumentList @('--version') -StdOutPath $out -StdErrPath $err -LiteralSecrets $literalSecrets
        Assert-NativeExitCode $result "$name --version"
        $manifest.toolVersions[$name] = (Protect-RecipeGenieSecret -Text ([IO.File]::ReadAllText($out)) -LiteralSecrets $literalSecrets).Trim()
    }

    [Environment]::SetEnvironmentVariable('PGHOST', $connection.Host, 'Process')
    [Environment]::SetEnvironmentVariable('PGPORT', [string]$connection.Port, 'Process')
    [Environment]::SetEnvironmentVariable('PGDATABASE', $connection.Database, 'Process')
    [Environment]::SetEnvironmentVariable('PGUSER', $connection.User, 'Process')
    [Environment]::SetEnvironmentVariable('PGPASSWORD', $connection.Password, 'Process')
    [Environment]::SetEnvironmentVariable('PGSSLMODE', $connection.SslMode, 'Process')

    $identityOut = Join-Path $logsDirectory 'identity.stdout.log'
    $identityErr = Join-Path $logsDirectory 'identity.stderr.log'
    $identitySql = @"
select current_database(), current_user, current_setting('server_version_num'), version(),
       to_regclass('public.recipes')::text,
       coalesce((select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations), '');
"@
    $identityArguments = @('-X','--no-psqlrc','-At','--field-separator=|','--set=ON_ERROR_STOP=1', '--command', $identitySql)
    $identityResult = Invoke-RecipeGenieNativeProcess -ExecutablePath $tools.psql -ArgumentList $identityArguments -StdOutPath $identityOut -StdErrPath $identityErr -LiteralSecrets $literalSecrets
    $manifest.commandResults.identityQueryExitCode = $identityResult.ExitCode
    $manifest.commandResults.serverVersionQueryExitCode = $identityResult.ExitCode
    Assert-NativeExitCode $identityResult 'Read-only server identity query'
    $identityLine = ([IO.File]::ReadAllLines($identityOut) | Where-Object { $_.Trim() } | Select-Object -First 1)
    $identityParts = @($identityLine -split '\|', 6)
    $expectedLedger = '001,002,003,004,005,006,007,008,009,010,011'
    if ($identityParts.Count -ne 6 -or $identityParts[0] -ne $connection.Database -or $identityParts[1] -ne 'postgres' -or
        $identityParts[4] -ne 'public.recipes' -or $identityParts[5] -ne $expectedLedger) {
        throw "Connected database does not corroborate the expected Recipe Genie pre-migration identity."
    }
    $manifest.connectedIdentity.databaseSchemaCorroborated = $true
    $manifest.connectedIdentity.migrationLedgerVersions = @($identityParts[5].Split(','))
    $serverVersionNumber = 0
    if (-not [int]::TryParse($identityParts[2], [ref]$serverVersionNumber)) { throw "Server version response was invalid." }
    $serverMajor = [Math]::Floor($serverVersionNumber / 10000)
    $clientMajor = Get-PostgreSqlMajorVersion $manifest.toolVersions.pg_dump
    if ($clientMajor -ne $serverMajor) { throw "pg_dump major version must match the PostgreSQL server major version." }
    $manifest.postgresServerVersion = Protect-RecipeGenieSecret -Text $identityParts[3] -LiteralSecrets $literalSecrets

    $manifest.gitWorktreeClean = -not [bool](git -C $repositoryRoot status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "Git worktree state could not be captured." }

    $dumpOut = Join-Path $logsDirectory 'pg_dump.stdout.log'
    $dumpErr = Join-Path $logsDirectory 'pg_dump.stderr.log'
    $dumpArguments = @(
        '--format=custom',
        '--compress=6',
        '--no-owner',
        '--no-privileges',
        '--schema=public',
        '--schema=private',
        '--schema=supabase_migrations',
        '--file',
        $archivePath
    )
    $dumpResult = Invoke-RecipeGenieNativeProcess -ExecutablePath $tools.pg_dump -ArgumentList $dumpArguments -StdOutPath $dumpOut -StdErrPath $dumpErr -LiteralSecrets $literalSecrets
    $manifest.commandResults.pgDumpExitCode = $dumpResult.ExitCode
    Assert-NativeExitCode $dumpResult 'pg_dump'
    $manifest.dumpCompleted = $true
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw "pg_dump did not create database.dump." }
    $archive = Get-Item -LiteralPath $archivePath
    if ($archive.Length -le 0) { throw "database.dump is empty." }

    $tocOut = Join-Path $logsDirectory 'pg_restore-list.stdout.log'
    $tocErr = Join-Path $logsDirectory 'pg_restore-list.stderr.log'
    $tocArguments = @('--list', $archivePath)
    $tocResult = Invoke-RecipeGenieNativeProcess -ExecutablePath $tools.pg_restore -ArgumentList $tocArguments -StdOutPath $tocOut -StdErrPath $tocErr -LiteralSecrets $literalSecrets
    $manifest.commandResults.pgRestoreListExitCode = $tocResult.ExitCode
    Assert-NativeExitCode $tocResult 'pg_restore --list'
    $contents = Test-ArchiveTableOfContents ([IO.File]::ReadAllText($tocOut))
    if (-not $contents.MigrationLedgerFound) { throw "Archive does not contain the authoritative migration ledger." }
    if (-not $contents.ExpectedApplicationMarkersFound) { throw "Archive does not contain expected Recipe Genie tables and functions." }
    $manifest.archiveContents.migrationLedgerFound = $true
    $manifest.archiveContents.expectedApplicationMarkersFound = $true
    $manifest.archiveValidated = $true
    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest.artifacts = @([ordered]@{
        fileName = 'database.dump'
        sizeBytes = $archive.Length
        sha256 = $hash
    })
    $manifest.backupStatus = 'successful'

    Write-SanitizedFile -Path $manifestPath -Content ($manifest | ConvertTo-Json -Depth 8) -LiteralSecrets $literalSecrets
    $summaryLines = @(
        'Recipe Genie production logical database backup',
        "Created (UTC): $($manifest.createdAtUtc)",
        "Project reference: $projectReference",
        "Connection type: $($connection.EndpointType)",
        'Logical database backup: verified',
        'Archive structure: validated',
        'Migration ledger: present',
        "Migration: $migrationRelativePath at commit $gitCommitSha (SHA-256 $migrationCommitHash)",
        "Preflight: $preflightRelativePath (SHA-256 $preflightCommitHash)",
        'Included schemas: public, private, supabase_migrations',
        'Supabase Auth configuration and global roles: not backed up',
        'Disposable restore: not verified',
        'Supabase Storage object payloads: not backed up',
        'Migration authorization: not granted',
        "Artifact: database.dump ($($archive.Length) bytes, SHA-256 $hash)"
    )
    Write-SanitizedFile -Path $summaryPath -Content ($summaryLines -join [Environment]::NewLine) -LiteralSecrets $literalSecrets
    Move-Item -LiteralPath $backupDirectory -Destination $finalBackupDirectory
    $backupDirectory = $finalBackupDirectory
} catch {
    $manifest.backupStatus = 'failed'
    $safeMessage = Protect-RecipeGenieSecret -Text $_.Exception.Message -LiteralSecrets $literalSecrets
    try {
        if (Test-Path -LiteralPath $backupDirectory -PathType Container) {
            $manifestPath = Join-Path $backupDirectory 'manifest.json'
            $summaryPath = Join-Path $backupDirectory 'summary.txt'
            Write-SanitizedFile -Path $manifestPath -Content ($manifest | ConvertTo-Json -Depth 8) -LiteralSecrets $literalSecrets
            $failedSummary = @('FAILED backup attempt. Artifact is quarantined and must not be used.', 'Migration authorization: not granted.')
            Write-SanitizedFile -Path $summaryPath -Content ($failedSummary -join [Environment]::NewLine) -LiteralSecrets $literalSecrets
            $failedDirectory = Join-Path $destination "$backupName.failed"
            if (-not (Test-Path -LiteralPath $failedDirectory)) { Move-Item -LiteralPath $backupDirectory -Destination $failedDirectory }
        }
    } catch {
        $safeMessage = "$safeMessage Failure evidence could not be finalized; any incomplete directory remains unusable."
    }
    Write-Error $safeMessage
    exit 1
} finally {
    foreach ($name in $pgNames) {
        [Environment]::SetEnvironmentVariable($name, $previousPgEnvironment[$name], 'Process')
    }
}

Write-Output "Backup created and validated: $backupDirectory"
Write-Output "Disposable restore: not verified"
Write-Output "Supabase Storage object payloads: not backed up"
Write-Output "Migration authorization: not granted"
