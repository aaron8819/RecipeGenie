[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$BackupDirectory,
    [Parameter(Mandatory)] [string]$ExpectedProjectReference,
    [ValidateRange(1, 525600)] [int]$MaximumAgeMinutes = 1440,
    [string]$PostgreSqlBinDirectory,
    [switch]$ConfirmDisposableTarget
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RecipeGenieBackup.Common.ps1')

$migrationPath = 'supabase/migrations/016_canonical_recipe_structure_cutover.sql'
$databaseUrlVariable = 'RECIPE_GENIE_DISPOSABLE_RESTORE_DATABASE_URL'

function ConvertFrom-DisposableRestoreDatabaseUrl {
    param([Parameter(Mandatory)] [string]$DatabaseUrl)

    try { $uri = [Uri]$DatabaseUrl } catch { throw 'Disposable restore database URL is invalid.' }
    if ($uri.Scheme -notin @('postgres', 'postgresql') -or -not $uri.Host -or -not $uri.UserInfo) {
        throw 'Disposable restore database URL must be an explicit PostgreSQL URL with credentials.'
    }
    $hostName = ConvertTo-NormalizedHost $uri.Host
    if ($hostName -notin @('localhost', '127.0.0.1', '::1')) {
        throw 'Restore verification is restricted to a loopback disposable database target.'
    }
    $credentialParts = $uri.UserInfo.Split(':', 2)
    if ($credentialParts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($credentialParts[1])) {
        throw 'Disposable restore database URL must include a database password.'
    }
    $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    if ($database -cne 'postgres') { throw 'Disposable restore database URL must identify the postgres database.' }

    [pscustomobject]@{
        Host = $hostName
        Port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
        Database = $database
        User = [Uri]::UnescapeDataString($credentialParts[0])
        Password = [Uri]::UnescapeDataString($credentialParts[1])
        SslMode = 'disable'
    }
}

if (-not $ConfirmDisposableTarget) {
    throw 'Restore verification requires -ConfirmDisposableTarget for the already-restored loopback database.'
}

$databaseUrl = [Environment]::GetEnvironmentVariable($databaseUrlVariable, 'Process')
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw "Required environment variable $databaseUrlVariable is missing." }
$connection = ConvertFrom-DisposableRestoreDatabaseUrl -DatabaseUrl $databaseUrl
$literalSecrets = @($databaseUrl)

$manifestPath = Join-Path $BackupDirectory 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'manifest.json is missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
$definition = Get-RecipeGenieMigrationBackupDefinition -MigrationPath ([string]$manifest.migration.path)
if ($definition.MigrationPath -ne $migrationPath) { throw 'Only migration 016 restore evidence is supported.' }
if ($ExpectedProjectReference -cne $definition.ExpectedProjectReference) { throw 'Expected project reference is not the approved Recipe Genie production project.' }

& (Join-Path $PSScriptRoot 'Test-RecipeGenieBackup.ps1') `
    -BackupDirectory $BackupDirectory `
    -ExpectedProjectReference $ExpectedProjectReference `
    -MaximumAgeMinutes $MaximumAgeMinutes `
    -ExpectedMigrationPath $migrationPath `
    -ExpectedGitCommitSha ([string]$manifest.gitCommitSha)
if (-not $?) { throw 'Backup verification failed before disposable restore confirmation.' }

$gitExecutablePath = Resolve-GitExecutable
$rootResult = Invoke-GitCapture $gitExecutablePath @('-C', $PSScriptRoot, 'rev-parse', '--show-toplevel')
if ($rootResult.ExitCode -ne 0 -or -not $rootResult.Output) { throw 'Git repository root could not be established.' }
$repositoryRoot = $rootResult.Output.Trim()
$headResult = Invoke-GitCapture $gitExecutablePath @('-C', $repositoryRoot, 'rev-parse', 'HEAD')
$toolingCommitSha = if ($headResult.Output) { $headResult.Output.Trim() } else { '' }
if ($headResult.ExitCode -ne 0 -or $toolingCommitSha -notmatch '^[0-9a-f]{40}$' -or $manifest.toolingCommitSha -ne $toolingCommitSha) {
    throw 'Current recovery tooling does not match the backup tooling commit.'
}
$statusResult = Invoke-GitCapture $gitExecutablePath @('-C', $repositoryRoot, 'status', '--porcelain')
if ($statusResult.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($statusResult.Output)) {
    throw 'Recovery-tooling worktree must be clean before restore evidence is recorded.'
}

$assertionPath = [string]$definition.RestoreAssertionPath
$assertionFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $assertionPath)
$assertionHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $toolingCommitSha -RepositoryRelativePath $assertionPath -GitExecutablePath $gitExecutablePath
if ($manifest.restoreAssertion.path -ne $assertionPath -or
    $manifest.restoreAssertion.commitSha -ne $toolingCommitSha -or
    $manifest.restoreAssertion.sha256 -ne $assertionHash -or
    -not (Test-Path -LiteralPath $assertionFullPath -PathType Leaf) -or
    -not (Test-GitPathMatchesCommit -RepositoryRoot $repositoryRoot -CommitSha $toolingCommitSha -RepositoryRelativePath $assertionPath -GitExecutablePath $gitExecutablePath)) {
    throw 'Restore assertion does not match the backup recovery-tooling commit.'
}
$procedureHashes = [ordered]@{}
foreach ($stage in @(
    [pscustomobject]@{ Name = 'preparation'; Path = [string]$definition.RestorePreparationPath },
    [pscustomobject]@{ Name = 'finalization'; Path = [string]$definition.RestoreFinalizationPath }
)) {
    $stageHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $toolingCommitSha -RepositoryRelativePath $stage.Path -GitExecutablePath $gitExecutablePath
    $stageFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $stage.Path)
    $entry = $manifest.restoreProcedure.($stage.Name)
    if ($entry.path -ne $stage.Path -or $entry.commitSha -ne $toolingCommitSha -or $entry.sha256 -ne $stageHash -or
        -not (Test-Path -LiteralPath $stageFullPath -PathType Leaf) -or
        -not (Test-GitPathMatchesCommit -RepositoryRoot $repositoryRoot -CommitSha $toolingCommitSha -RepositoryRelativePath $stage.Path -GitExecutablePath $gitExecutablePath)) {
        throw "Restore $($stage.Name) does not match the backup recovery-tooling commit."
    }
    $procedureHashes[$stage.Name] = $stageHash
}

$artifact = Get-ManifestArtifact $manifest
$archivePath = Get-NormalizedFullPath (Join-Path $BackupDirectory ([string]$artifact.fileName))
if (-not (Test-PathWithin -Candidate $archivePath -Parent $BackupDirectory)) { throw 'Backup artifact path escapes the backup directory.' }
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not $archiveHash.Equals([string]$artifact.sha256, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup artifact hash changed before restore verification.' }

$logsDirectory = Join-Path $BackupDirectory 'logs'
[IO.Directory]::CreateDirectory($logsDirectory) | Out-Null
$psql = Resolve-PostgreSqlTool -Name 'psql' -BinDirectory $PostgreSqlBinDirectory
$previousPgEnvironment = @{}
$pgNames = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE')
foreach ($name in $pgNames) { $previousPgEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
    [Environment]::SetEnvironmentVariable('PGHOST', $connection.Host, 'Process')
    [Environment]::SetEnvironmentVariable('PGPORT', [string]$connection.Port, 'Process')
    [Environment]::SetEnvironmentVariable('PGDATABASE', $connection.Database, 'Process')
    [Environment]::SetEnvironmentVariable('PGUSER', $connection.User, 'Process')
    [Environment]::SetEnvironmentVariable('PGPASSWORD', $connection.Password, 'Process')
    [Environment]::SetEnvironmentVariable('PGSSLMODE', $connection.SslMode, 'Process')

    $stdoutPath = Join-Path $logsDirectory 'migration-016-restore-assertion.stdout.log'
    $stderrPath = Join-Path $logsDirectory 'migration-016-restore-assertion.stderr.log'
    $arguments = @(
        '-X', '--no-psqlrc', '--set=ON_ERROR_STOP=1',
        "--set=expected_recipe_count=$([int64]$manifest.recoveryCounts.recipes)",
        "--set=expected_share_count=$([int64]$manifest.recoveryCounts.recipeShares)",
        '--file', $assertionFullPath
    )
    $result = Invoke-RecipeGenieNativeProcess -ExecutablePath $psql -ArgumentList $arguments -StdOutPath $stdoutPath -StdErrPath $stderrPath -LiteralSecrets $literalSecrets
    Assert-NativeExitCode $result 'Migration 016 disposable restore assertion'
    $assertionLines = @([IO.File]::ReadAllLines($stdoutPath) | Where-Object { $_.Trim() -match '^\{.*\}$' })
    if ($assertionLines.Count -ne 1) { throw 'Restore assertion output is missing or ambiguous.' }
    try { $assertionResult = $assertionLines[0] | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Restore assertion output is malformed.' }
    foreach ($propertyName in @('ledgerBaselineExact','legacyColumnsPresent','canonicalColumnsAbsent','requiredFunctionsPresent','authTriggerPresent','recipeCountMatched','shareCountMatched','shareSnapshotsValid')) {
        if ($assertionResult.$propertyName -ne $true) { throw "Restore assertion did not confirm $propertyName." }
    }

    $verifiedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $manifest.restoreVerified = $true
    $manifest.restoreVerification = [ordered]@{
        verifiedAtUtc = $verifiedAtUtc
        targetType = 'local-loopback-disposable'
        archiveSha256 = $archiveHash
        assertionPath = $assertionPath
        assertionCommitSha = $toolingCommitSha
        assertionSha256 = $assertionHash
        preparationSha256 = $procedureHashes.preparation
        finalizationSha256 = $procedureHashes.finalization
        migrationBaseline = @($definition.ExpectedAppliedMigrationVersions)
        authTriggerPresent = $true
        recipeCountMatched = $true
        shareCountMatched = $true
        shareSnapshotsValid = $true
    }
    Write-SanitizedFile -Path $manifestPath -Content ($manifest | ConvertTo-Json -Depth 12) -LiteralSecrets $literalSecrets

    $summaryPath = Join-Path $BackupDirectory 'summary.txt'
    $summary = [IO.File]::ReadAllText($summaryPath)
    if ($summary -match '(?m)^Disposable restore: not verified\s*$') {
        $summary = [regex]::Replace($summary, '(?m)^Disposable restore: not verified\s*$', 'Disposable restore: verified')
    } elseif ($summary -notmatch '(?m)^Disposable restore: verified\s*$') {
        $summary += [Environment]::NewLine + 'Disposable restore: verified' + [Environment]::NewLine
    }
    Write-SanitizedFile -Path $summaryPath -Content $summary -LiteralSecrets $literalSecrets
} finally {
    foreach ($name in $pgNames) { [Environment]::SetEnvironmentVariable($name, $previousPgEnvironment[$name], 'Process') }
}

Write-Output 'Migration 016 disposable restore: verified'
Write-Output 'Migration baseline: 001 through 015'
Write-Output 'Recipe/share aggregates: matched'
Write-Output 'Migration authorization: not granted'
