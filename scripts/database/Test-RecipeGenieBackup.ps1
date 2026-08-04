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
    $allowExternalEvidence = $definition.PSObject.Properties['AllowExternalEvidenceCommit'] -and $definition.AllowExternalEvidenceCommit -eq $true
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
    if ($allowExternalEvidence -and
        ($manifest.gitCommitSha -cne [string]$definition.ExpectedEvidenceCommitSha -or $manifest.gitWorktreeClean -ne $true)) {
        throw 'Migration 016 evidence is not bound to the exact reviewed head and clean recovery tooling.'
    }
    if ($manifest.toolVersions.git -notmatch '^git version [0-9]+(?:\.[0-9]+){1,3}$') { throw 'Sanitized Git version evidence is missing or invalid.' }
    $migrationSourceIsValid = $manifest.migration.worktreeMatchesCommit -eq $true
    if ($allowExternalEvidence) {
        $migrationSourceIsValid = ($manifest.migration.source -eq 'tooling-worktree' -and $manifest.migration.worktreeMatchesCommit -eq $true) -or
            ($manifest.migration.source -eq 'exact-git-commit' -and $manifest.migration.worktreeMatchesCommit -eq $false)
    }
    if ($manifest.migration.path -notmatch '^supabase/migrations/[0-9]{3}_[A-Za-z0-9_.-]+\.sql$' -or $manifest.migration.sha256 -notmatch '^[0-9a-f]{64}$' -or -not $migrationSourceIsValid) {
        throw "Migration evidence is incomplete or invalid."
    }
    $expectedPreflightPath = if ($definition.PSObject.Properties['PreflightPath']) {
        [string]$definition.PreflightPath
    } else {
        'scripts/database/preflight/' + [IO.Path]::GetFileName([string]$manifest.migration.path)
    }
    $preflightSourceIsValid = $manifest.preflight.worktreeMatchesCommit -eq $true
    if ($allowExternalEvidence) {
        $preflightSourceIsValid = ($manifest.preflight.source -eq 'tooling-worktree' -and $manifest.preflight.worktreeMatchesCommit -eq $true) -or
            ($manifest.preflight.source -eq 'exact-git-commit' -and $manifest.preflight.worktreeMatchesCommit -eq $false)
    }
    if ($manifest.preflight.commitSha -ne $manifest.gitCommitSha -or
        $manifest.preflight.path -ne $expectedPreflightPath -or
        $manifest.preflight.sha256 -notmatch '^[0-9a-f]{64}$' -or
        $manifest.preflight.readOnly -ne $true -or $manifest.preflight.countOnly -ne $true -or
        -not $preflightSourceIsValid) {
        throw "Migration preflight evidence is incomplete or is not commit-bound."
    }
    if ($allowExternalEvidence) {
        if ($manifest.toolingCommitSha -notmatch '^[0-9a-f]{40}$' -or
            $manifest.restoreAssertion.path -ne [string]$definition.RestoreAssertionPath -or
            $manifest.restoreAssertion.commitSha -ne $manifest.toolingCommitSha -or
            $manifest.restoreAssertion.sha256 -notmatch '^[0-9a-f]{64}$' -or
            $manifest.restoreAssertion.worktreeMatchesCommit -ne $true) {
            throw 'Migration 016 restore assertion evidence is incomplete or invalid.'
        }
        foreach ($stage in @(
            [pscustomobject]@{ Name = 'preparation'; Path = [string]$definition.RestorePreparationPath },
            [pscustomobject]@{ Name = 'finalization'; Path = [string]$definition.RestoreFinalizationPath }
        )) {
            $entry = $manifest.restoreProcedure.($stage.Name)
            if ($entry.path -ne $stage.Path -or
                $entry.commitSha -ne $manifest.toolingCommitSha -or
                $entry.sha256 -notmatch '^[0-9a-f]{64}$' -or
                $entry.worktreeMatchesCommit -ne $true) {
                throw "Migration 016 restore $($stage.Name) evidence is incomplete or invalid."
            }
        }
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
    if ($allowExternalEvidence) {
        $requiredTables = @($manifest.backupScope.requiredTables)
        $requiredFunctions = @($manifest.backupScope.requiredFunctions)
        if ((Compare-Object @($definition.RequiredArchiveTables) $requiredTables) -or
            (Compare-Object @($definition.RequiredArchiveFunctions) $requiredFunctions) -or
            $null -eq $manifest.recoveryCounts -or
            [int64]$manifest.recoveryCounts.recipes -lt 0 -or
            [int64]$manifest.recoveryCounts.recipeShares -lt 0) {
            throw 'Migration 016 recovery scope or aggregate source counts are missing or invalid.'
        }
    }
    if ($manifest.backupStatus -ne 'successful') { throw "Backup status is not successful." }
    if ($manifest.dumpCompleted -ne $true) { throw "Logical dump did not complete successfully." }
    if ($manifest.archiveValidated -ne $true) { throw "Archive structure was not validated." }
    if ($manifest.archiveContents.migrationLedgerFound -ne $true) { throw "Authoritative migration ledger marker is missing." }
    if ($manifest.archiveContents.expectedApplicationMarkersFound -ne $true) { throw "Expected Recipe Genie archive markers are missing." }
    if ($allowExternalEvidence -and
        ($manifest.archiveContents.requiredTablesFound -ne $true -or $manifest.archiveContents.requiredFunctionsFound -ne $true)) {
        throw 'Migration 016 archive is missing required recipe/share recovery objects.'
    }
    foreach ($name in @('serverVersionQueryExitCode','identityQueryExitCode','pgDumpExitCode','pgRestoreListExitCode')) {
        $property = $manifest.commandResults.PSObject.Properties[$name]
        if ($null -eq $property -or $property.Value -ne 0) { throw "Command result $name is missing or unsuccessful." }
    }
    if ($allowExternalEvidence -and $manifest.commandResults.recoveryScopeQueryExitCode -ne 0) {
        throw 'Migration 016 recovery-scope query evidence is missing or unsuccessful.'
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

    if ($allowExternalEvidence -and $manifest.restoreVerified -eq $true) {
        $restoreTimestamp = [DateTimeOffset]::MinValue
        $restore = $manifest.restoreVerification
        if ($null -eq $restore -or
            -not [DateTimeOffset]::TryParse([string]$restore.verifiedAtUtc, [ref]$restoreTimestamp) -or
            $restore.targetType -ne 'local-loopback-disposable' -or
            -not ([string]$restore.archiveSha256).Equals([string]$artifact.sha256, [StringComparison]::OrdinalIgnoreCase) -or
            $restore.assertionPath -ne [string]$definition.RestoreAssertionPath -or
            $restore.assertionCommitSha -ne $manifest.toolingCommitSha -or
            $restore.assertionSha256 -ne $manifest.restoreAssertion.sha256 -or
            $restore.preparationSha256 -ne $manifest.restoreProcedure.preparation.sha256 -or
            $restore.finalizationSha256 -ne $manifest.restoreProcedure.finalization.sha256 -or
            (@($restore.migrationBaseline) -join ',') -cne ($definition.ExpectedAppliedMigrationVersions -join ',') -or
            $restore.authTriggerPresent -ne $true -or
            $restore.recipeCountMatched -ne $true -or
            $restore.shareCountMatched -ne $true -or
            $restore.shareSnapshotsValid -ne $true) {
            throw 'Migration 016 disposable restore evidence is incomplete or invalid.'
        }
    }

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
