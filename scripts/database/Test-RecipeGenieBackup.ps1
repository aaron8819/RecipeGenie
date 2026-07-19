[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$BackupDirectory,
    [Parameter(Mandatory)] [string]$ExpectedProjectReference,
    [ValidateRange(1, 525600)] [int]$MaximumAgeMinutes = 60,
    [string]$ExpectedMigrationPath,
    [string]$ExpectedGitCommitSha
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RecipeGenieBackup.Common.ps1')

try {
    if (-not (Test-Path -LiteralPath $BackupDirectory -PathType Container)) { throw "Backup directory does not exist." }
    if ((Split-Path -Leaf $BackupDirectory) -match '(?i)(failed|quarantine|incomplete)') { throw "Failed, incomplete, or quarantined backup directories are not accepted." }
    $manifestPath = Join-Path $BackupDirectory 'manifest.json'
    $summaryPath = Join-Path $BackupDirectory 'summary.txt'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "manifest.json is missing." }
    if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) { throw "summary.txt is missing." }
    $manifestText = [IO.File]::ReadAllText($manifestPath)
    $summaryText = [IO.File]::ReadAllText($summaryPath)
    if (Test-RecipeGenieSensitiveText ($manifestText + [Environment]::NewLine + $summaryText)) {
        throw "Manifest or summary contains credential-shaped content or a complete database URL."
    }
    try { $manifest = $manifestText | ConvertFrom-Json -ErrorAction Stop } catch { throw "manifest.json is malformed." }
    if ($manifest.schemaVersion -ne 3) { throw "Unsupported manifest schema version; version 3 control-plane identity evidence is required." }
    if ($manifest.appName -ne 'Recipe Genie' -or $manifest.environment -ne 'production') { throw "Backup does not identify Recipe Genie production." }
    if ($manifest.projectReference -ne $ExpectedProjectReference) { throw "Backup project reference does not match the expected project." }
    $definition = Get-RecipeGenieMigrationBackupDefinition -MigrationPath ([string]$manifest.migration.path)
    if ($ExpectedProjectReference -cne $definition.ExpectedProjectReference) { throw 'Backup does not identify the approved Recipe Genie production project.' }
    $identity = $manifest.identityVerification
    if ($identity.verified -ne $true -or
        $identity.expectedProjectReference -ne $ExpectedProjectReference -or
        $identity.repositoryIdentityMatched -ne $true -or
        $identity.repositoryLinkedReferenceMatched -ne $true -or
        $identity.controlPlaneProjectReferenceMatched -ne $true -or
        $identity.controlPlaneProjectStatus -ne 'ACTIVE_HEALTHY' -or
        $identity.controlPlaneDatabaseHostMatched -ne $true -or
        $identity.endpointType -notin @('direct','session-pooler') -or
        $identity.connectedDatabase -ne 'postgres' -or
        $identity.connectedUserClass -ne $identity.endpointType -or
        $identity.postgresServerVersionAvailable -ne $true -or
        $identity.migrationLedgerFound -ne $true -or
        (@($identity.migrationLedgerVersions) -join ',') -cne ($definition.ExpectedAppliedMigrationVersions -join ',') -or
        $identity.applicationMarkersFound -ne $true) {
        throw "Backup lacks required control-plane, repository, or connected-database identity evidence."
    }
    $recordedRuntime = [version]'0.0'
    if ($manifest.runtime.edition -ne 'Core' -or -not [version]::TryParse([string]$manifest.runtime.version, [ref]$recordedRuntime) -or $recordedRuntime -lt [version]'7.4') {
        throw "Backup was not created under a supported PowerShell runtime."
    }
    if ($manifest.gitCommitSha -notmatch '^[0-9a-f]{40}$' -or $manifest.migration.commitSha -ne $manifest.gitCommitSha) {
        throw "Migration evidence is not bound to the recorded Git commit."
    }
    if ($manifest.toolVersions.git -notmatch '^git version [0-9]+(?:\.[0-9]+){1,3}$') { throw 'Sanitized Git version evidence is missing or invalid.' }
    if ($manifest.migration.path -notmatch '^supabase/migrations/[0-9]{3}_[A-Za-z0-9_.-]+\.sql$' -or $manifest.migration.sha256 -notmatch '^[0-9a-f]{64}$' -or $manifest.migration.worktreeMatchesCommit -ne $true) {
        throw "Migration evidence is incomplete or invalid."
    }
    if ($manifest.preflight.commitSha -ne $manifest.gitCommitSha -or
        $manifest.preflight.path -ne ('scripts/database/preflight/' + [IO.Path]::GetFileName([string]$manifest.migration.path)) -or
        $manifest.preflight.sha256 -notmatch '^[0-9a-f]{64}$' -or
        $manifest.preflight.readOnly -ne $true -or $manifest.preflight.countOnly -ne $true -or
        $manifest.preflight.worktreeMatchesCommit -ne $true) {
        throw "Migration preflight evidence is incomplete or is not commit-bound."
    }
    if ($ExpectedMigrationPath -and $manifest.migration.path -ne $ExpectedMigrationPath.Replace('\\', '/')) { throw "Backup is bound to a different migration file." }
    if ($ExpectedGitCommitSha -and $manifest.gitCommitSha -ne $ExpectedGitCommitSha) { throw "Backup is bound to a different Git commit." }
    $includedSchemas = @($manifest.backupScope.includedSchemas)
    if ($manifest.backupScope.type -ne 'logical-database-custom-archive' -or
        (Compare-Object @('public','private','supabase_migrations') $includedSchemas) -or
        $manifest.backupScope.includesStorageObjectPayloads -ne $false -or
        $manifest.backupScope.includesSupabaseManagedAuthConfiguration -ne $false -or
        $manifest.backupScope.includesGlobalRoles -ne $false -or
        $manifest.backupScope.includesSecrets -ne $false) {
        throw "Backup scope is missing or ambiguous."
    }
    if ($manifest.backupStatus -ne 'successful') { throw "Backup status is not successful." }
    if ($manifest.dumpCompleted -ne $true) { throw "Logical dump did not complete successfully." }
    if ($manifest.archiveValidated -ne $true) { throw "Archive structure was not validated." }
    if ($manifest.archiveContents.migrationLedgerFound -ne $true) { throw "Authoritative migration ledger marker is missing." }
    if ($manifest.archiveContents.expectedApplicationMarkersFound -ne $true) { throw "Expected Recipe Genie archive markers are missing." }
    foreach ($name in @('serverVersionQueryExitCode','identityQueryExitCode','pgDumpExitCode','pgRestoreListExitCode')) {
        $property = $manifest.commandResults.PSObject.Properties[$name]
        if ($null -eq $property -or $property.Value -ne 0) { throw "Command result $name is missing or unsuccessful." }
    }
    foreach ($log in @(Get-ChildItem -LiteralPath (Join-Path $BackupDirectory 'logs') -File -ErrorAction SilentlyContinue)) {
        if (Test-RecipeGenieSensitiveText ([IO.File]::ReadAllText($log.FullName))) { throw "A persisted log contains credential-shaped content." }
    }

    $artifact = Get-ManifestArtifact $manifest
    $archivePath = Join-Path $BackupDirectory $artifact.fileName
    if (-not (Test-PathWithin -Candidate $archivePath -Parent $BackupDirectory)) { throw "Artifact path escapes the backup directory." }
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw "database.dump is missing." }
    $archive = Get-Item -LiteralPath $archivePath
    if ($archive.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "database.dump cannot be a reparse point." }
    if ($archive.Length -le 0) { throw "database.dump is empty." }
    if ([int64]$artifact.sizeBytes -ne $archive.Length) { throw "database.dump size does not match the manifest." }
    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if (-not $hash.Equals([string]$artifact.sha256, [StringComparison]::OrdinalIgnoreCase)) {
        throw "database.dump SHA-256 does not match the manifest."
    }
    $created = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$manifest.createdAtUtc, [ref]$created)) {
        throw "Manifest creation timestamp is invalid."
    }
    $age = [DateTimeOffset]::UtcNow - $created.ToUniversalTime()
    if ($age.TotalMinutes -lt -5) { throw "Backup creation timestamp is unacceptably in the future." }
    if ($age.TotalMinutes -gt $MaximumAgeMinutes) { throw "Backup is older than the allowed maximum age." }

    Write-Output 'Logical database backup: verified'
    Write-Output 'Archive structure: validated'
    Write-Output 'Migration ledger: present'
    if ($manifest.restoreVerified -eq $true) {
        Write-Output 'Disposable restore: verified'
    } else {
        Write-Output 'Disposable restore: not verified'
    }
    if ($manifest.storageFilesBackedUp -eq $true) {
        Write-Output 'Supabase Storage files: backed up'
    } else {
        Write-Output 'Supabase Storage files: not backed up'
    }
    Write-Output 'Migration authorization: not granted'
} catch {
    Write-Error "Backup verification failed: $($_.Exception.Message)"
    exit 1
}
