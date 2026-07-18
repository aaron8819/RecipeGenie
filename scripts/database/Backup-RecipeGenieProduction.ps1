[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$DestinationRoot,
    [switch]$AllowSessionPooler,
    [string]$PostgreSqlBinDirectory,
    [ValidateRange(1, 60)] [int]$ManagementApiTimeoutSeconds = 10,
    [string]$MigrationPath = 'supabase/migrations/012_enforce_uuid_active_recipe_writes.sql'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RecipeGenieBackup.Common.ps1')

$databaseUrlVariable = 'RECIPE_GENIE_PRODUCTION_DATABASE_URL'
$projectReferenceVariable = 'RECIPE_GENIE_PRODUCTION_PROJECT_REF'
$accessTokenVariable = 'RECIPE_GENIE_SUPABASE_ACCESS_TOKEN'
$databaseUrl = [Environment]::GetEnvironmentVariable($databaseUrlVariable, 'Process')
$projectReference = [Environment]::GetEnvironmentVariable($projectReferenceVariable, 'Process')
$accessToken = [Environment]::GetEnvironmentVariable($accessTokenVariable, 'Process')
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw "Required environment variable $databaseUrlVariable is missing." }
if ([string]::IsNullOrWhiteSpace($projectReference)) { throw "Required environment variable $projectReferenceVariable is missing." }
if ([string]::IsNullOrWhiteSpace($accessToken)) { throw "Required environment variable $accessTokenVariable is missing." }

$gitExecutablePath = Resolve-GitExecutable
$gitVersion = Get-SanitizedGitVersion $gitExecutablePath
$rootResult = Invoke-GitCapture $gitExecutablePath @('-C', $PSScriptRoot, 'rev-parse', '--show-toplevel')
if ($rootResult.ExitCode -ne 0 -or -not $rootResult.Output) { throw "Git repository root could not be established." }
$repositoryRoot = $rootResult.Output.Trim()
$packagePath = Join-Path $repositoryRoot 'package.json'
try { $repositoryPackage = [IO.File]::ReadAllText($packagePath) | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Recipe Genie repository identity could not be established.' }
if ($repositoryPackage.name -ne 'recipe-genie' -or -not (Test-Path -LiteralPath (Join-Path $repositoryRoot 'supabase/migrations/001_baseline.sql') -PathType Leaf)) {
    throw 'Current repository is not the expected Recipe Genie repository.'
}
$registeredWorktrees = Get-RegisteredGitWorktreePaths -RepositoryRoot $repositoryRoot -GitExecutablePath $gitExecutablePath
Assert-ExternalDestination -DestinationRoot $DestinationRoot -RegisteredWorktreePaths $registeredWorktrees
$linkedProjectReference = Get-LinkedProjectReference -RepositoryRoot $repositoryRoot
if ($linkedProjectReference -ne $projectReference) {
    throw 'Expected project reference does not match the independently linked Supabase project.'
}
$connection = ConvertFrom-RecipeGenieDatabaseUrl -DatabaseUrl $databaseUrl -ExpectedProjectReference $projectReference -AllowSessionPooler:$AllowSessionPooler
$controlPlane = Invoke-SupabaseProjectMetadata -AccessToken $accessToken -ExpectedProjectReference $projectReference -Connection $connection -TimeoutSeconds $ManagementApiTimeoutSeconds

$commitResult = Invoke-GitCapture $gitExecutablePath @('-C', $repositoryRoot, 'rev-parse', 'HEAD')
$gitCommitSha = if ($commitResult.Output) { $commitResult.Output.Trim() } else { '' }
if ($commitResult.ExitCode -ne 0 -or $gitCommitSha -notmatch '^[0-9a-f]{40}$') { throw "Git commit SHA could not be captured." }
$migrationRelativePath = $MigrationPath.Replace('\\', '/')
$migrationFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $migrationRelativePath)
if (-not (Test-PathWithin -Candidate $migrationFullPath -Parent $repositoryRoot) -or -not (Test-Path -LiteralPath $migrationFullPath -PathType Leaf)) {
    throw 'Migration file is missing or outside the repository.'
}
$migrationCommitHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $migrationRelativePath -GitExecutablePath $gitExecutablePath
if (-not (Test-GitPathMatchesCommit -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $migrationRelativePath -GitExecutablePath $gitExecutablePath)) { throw 'Migration file differs from the recorded Git commit.' }
$preflightRelativePath = 'scripts/database/preflight/' + [IO.Path]::GetFileName($migrationRelativePath)
$preflightFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $preflightRelativePath)
if (-not (Test-Path -LiteralPath $preflightFullPath -PathType Leaf)) { throw 'Commit-bound migration preflight is missing.' }
$preflightCommitHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $preflightRelativePath -GitExecutablePath $gitExecutablePath
if (-not (Test-GitPathMatchesCommit -RepositoryRoot $repositoryRoot -CommitSha $gitCommitSha -RepositoryRelativePath $preflightRelativePath -GitExecutablePath $gitExecutablePath)) { throw 'Migration preflight differs from the recorded Git commit.' }

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
$literalSecrets = @($databaseUrl, $connection.Password, [Uri]::EscapeDataString($connection.Password), $accessToken)

$manifest = [ordered]@{
    schemaVersion = 3
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
    identityVerification = [ordered]@{
        verified = $false
        expectedProjectReference = $projectReference
        repositoryIdentityMatched = $true
        repositoryLinkedReferenceMatched = $true
        controlPlaneProjectReferenceMatched = $true
        controlPlaneProjectStatus = $controlPlane.ProjectStatus
        controlPlaneDatabaseHostMatched = $controlPlane.DatabaseHostMatched
        endpointType = $connection.EndpointType
        connectedDatabase = $null
        connectedUserClass = $null
        postgresServerVersionAvailable = $false
        migrationLedgerFound = $false
        migrationLedgerVersions = $null
        applicationMarkersFound = $false
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
    toolVersions = [ordered]@{ git = $gitVersion }
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
       to_regclass('public.recipes')::text, to_regclass('public.pantry_items')::text,
       to_regclass('public.user_config')::text,
       coalesce((select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations), '');
"@
    $identityArguments = @('-X','--no-psqlrc','-At','--field-separator=|','--set=ON_ERROR_STOP=1', '--command', $identitySql)
    $identityResult = Invoke-RecipeGenieNativeProcess -ExecutablePath $tools.psql -ArgumentList $identityArguments -StdOutPath $identityOut -StdErrPath $identityErr -LiteralSecrets $literalSecrets
    $manifest.commandResults.identityQueryExitCode = $identityResult.ExitCode
    $manifest.commandResults.serverVersionQueryExitCode = $identityResult.ExitCode
    Assert-NativeExitCode $identityResult 'Read-only server identity query'
    $identityLine = ([IO.File]::ReadAllLines($identityOut) | Where-Object { $_.Trim() } | Select-Object -First 1)
    $identityParts = @($identityLine -split '\|', 8)
    $expectedLedger = '001,002,003,004,005,006,007,008,009,010,011'
    if ($identityParts.Count -ne 8 -or $identityParts[0] -ne 'postgres' -or $identityParts[0] -ne $connection.Database -or $identityParts[1] -ne 'postgres' -or
        $identityParts[4] -ne 'public.recipes' -or $identityParts[5] -ne 'public.pantry_items' -or
        $identityParts[6] -ne 'public.user_config' -or $identityParts[7] -ne $expectedLedger) {
        throw "Connected database does not corroborate the expected Recipe Genie pre-migration identity."
    }
    $manifest.identityVerification.connectedDatabase = 'postgres'
    $manifest.identityVerification.connectedUserClass = $connection.EndpointType
    $manifest.identityVerification.migrationLedgerFound = $true
    $manifest.identityVerification.migrationLedgerVersions = @($identityParts[7].Split(','))
    $manifest.identityVerification.applicationMarkersFound = $true
    $serverVersionNumber = 0
    if (-not [int]::TryParse($identityParts[2], [ref]$serverVersionNumber)) { throw "Server version response was invalid." }
    $serverMajor = [Math]::Floor($serverVersionNumber / 10000)
    $clientMajor = Get-PostgreSqlMajorVersion $manifest.toolVersions.pg_dump
    if ($clientMajor -ne $serverMajor) { throw "pg_dump major version must match the PostgreSQL server major version." }
    $manifest.postgresServerVersion = Protect-RecipeGenieSecret -Text $identityParts[3] -LiteralSecrets $literalSecrets
    $manifest.identityVerification.postgresServerVersionAvailable = $true
    $manifest.identityVerification.verified = $true

    $statusResult = Invoke-GitCapture $gitExecutablePath @('-C', $repositoryRoot, 'status', '--porcelain')
    if ($statusResult.ExitCode -ne 0) { throw "Git worktree state could not be captured." }
    $manifest.gitWorktreeClean = [string]::IsNullOrWhiteSpace($statusResult.Output)

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
        'Control-plane project identity: verified',
        'Connected database identity: verified',
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
