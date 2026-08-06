[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$BackupDirectory,
    [Parameter(Mandatory)] [string]$ExpectedProjectReference,
    [ValidateRange(1, 525600)] [int]$MaximumAgeMinutes = 60,
    [string]$MigrationPath = 'supabase/migrations/014_add_recipe_yield_metadata.sql',
    [string]$EvidenceCommitSha,
    [switch]$RequireRestoreVerification,
    [switch]$RequireStorageBackup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RecipeGenieBackup.Common.ps1')
$testScript = Join-Path $PSScriptRoot 'Test-RecipeGenieBackup.ps1'

try {
    $gitExecutablePath = Resolve-GitExecutable
    $rootResult = Invoke-GitCapture $gitExecutablePath @('-C', $PSScriptRoot, 'rev-parse', '--show-toplevel')
    if ($rootResult.ExitCode -ne 0 -or -not $rootResult.Output) { throw 'Git repository root could not be established.' }
    $repositoryRoot = $rootResult.Output.Trim()
    $headResult = Invoke-GitCapture $gitExecutablePath @('-C', $repositoryRoot, 'rev-parse', 'HEAD')
    $toolingCommit = if ($headResult.Output) { $headResult.Output.Trim() } else { '' }
    if ($headResult.ExitCode -ne 0 -or $toolingCommit -notmatch '^[0-9a-f]{40}$') { throw 'Current Git commit could not be established.' }
    $definition = Get-RecipeGenieMigrationBackupDefinition -MigrationPath $MigrationPath
    if ($ExpectedProjectReference -cne $definition.ExpectedProjectReference) { throw 'Expected project reference is not the approved Recipe Genie production project.' }
    $allowExternalEvidence = $definition.PSObject.Properties['AllowExternalEvidenceCommit'] -and $definition.AllowExternalEvidenceCommit -eq $true
    $hasBoundRestoreEvidence = $null -ne $definition.PSObject.Properties['RestoreAssertionPath']
    if ($allowExternalEvidence) {
        if ($EvidenceCommitSha -cne [string]$definition.ExpectedEvidenceCommitSha) { throw 'Migration 016 requires the exact approved evidence commit SHA.' }
        $evidenceCommit = $EvidenceCommitSha
    } else {
        if ($EvidenceCommitSha) { throw 'A separate evidence commit is not permitted for this migration.' }
        $evidenceCommit = $toolingCommit
    }
    $normalizedMigrationPath = $definition.MigrationPath
    & $testScript -BackupDirectory $BackupDirectory -ExpectedProjectReference $ExpectedProjectReference -MaximumAgeMinutes $MaximumAgeMinutes -ExpectedMigrationPath $normalizedMigrationPath -ExpectedGitCommitSha $evidenceCommit
    $manifest = Get-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.json') -Raw | ConvertFrom-Json
    if ($allowExternalEvidence -and $manifest.toolingCommitSha -ne $toolingCommit) { throw 'Backup recovery-tooling commit does not match the current commit.' }
    if ($allowExternalEvidence) {
        $statusResult = Invoke-GitCapture $gitExecutablePath @('-C', $repositoryRoot, 'status', '--porcelain')
        if ($statusResult.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($statusResult.Output)) { throw 'Recovery-tooling worktree must be clean.' }
    }
    $migrationHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $evidenceCommit -RepositoryRelativePath $normalizedMigrationPath -GitExecutablePath $gitExecutablePath
    if ($manifest.migration.sha256 -ne $migrationHash) { throw 'Backup migration hash does not match the recorded commit.' }
    if (-not $allowExternalEvidence) {
        $migrationFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $normalizedMigrationPath)
        if (-not (Test-Path -LiteralPath $migrationFullPath -PathType Leaf) -or -not (Test-GitPathMatchesCommit $repositoryRoot $evidenceCommit $normalizedMigrationPath $gitExecutablePath)) {
            throw 'Migration worktree file does not match the recorded commit.'
        }
    }
    $preflightPath = if ($definition.PSObject.Properties['PreflightPath']) { [string]$definition.PreflightPath } else { 'scripts/database/preflight/' + [IO.Path]::GetFileName($normalizedMigrationPath) }
    $preflightHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $evidenceCommit -RepositoryRelativePath $preflightPath -GitExecutablePath $gitExecutablePath
    if ($manifest.preflight.path -ne $preflightPath -or $manifest.preflight.sha256 -ne $preflightHash) { throw 'Backup preflight hash does not match the recorded commit.' }
    if (-not $allowExternalEvidence) {
        $preflightFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $preflightPath)
        if (-not (Test-Path -LiteralPath $preflightFullPath -PathType Leaf) -or -not (Test-GitPathMatchesCommit $repositoryRoot $evidenceCommit $preflightPath $gitExecutablePath)) {
            throw 'Migration preflight worktree file does not match the recorded commit.'
        }
    }
    if ($hasBoundRestoreEvidence) {
        $restoreAssertionPath = [string]$definition.RestoreAssertionPath
        $restoreAssertionHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $toolingCommit -RepositoryRelativePath $restoreAssertionPath -GitExecutablePath $gitExecutablePath
        if ($manifest.restoreAssertion.path -ne $restoreAssertionPath -or $manifest.restoreAssertion.commitSha -ne $toolingCommit -or $manifest.restoreAssertion.sha256 -ne $restoreAssertionHash) {
            throw 'Backup restore assertion does not match the recovery-tooling commit.'
        }
        foreach ($stage in @(
            [pscustomobject]@{ Name = 'preparation'; Path = [string]$definition.RestorePreparationPath },
            [pscustomobject]@{ Name = 'finalization'; Path = [string]$definition.RestoreFinalizationPath }
        )) {
            $stageHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $toolingCommit -RepositoryRelativePath $stage.Path -GitExecutablePath $gitExecutablePath
            $entry = $manifest.restoreProcedure.($stage.Name)
            if ($entry.path -ne $stage.Path -or $entry.commitSha -ne $toolingCommit -or $entry.sha256 -ne $stageHash) {
                throw "Backup restore $($stage.Name) does not match the recovery-tooling commit."
            }
        }
    }
    $restoreRequired = $RequireRestoreVerification -or $definition.RequireRestoreVerification
    if ($restoreRequired -and $manifest.restoreVerified -ne $true) {
        throw "Disposable restore verification is required for this migration."
    }
    if ($RequireStorageBackup -and $manifest.storageFilesBackedUp -ne $true) {
        throw "Supabase Storage backup is required for this migration."
    }
    Write-Output 'PASS: Recipe Genie production logical-database-backup prerequisite satisfied.'
    if ($manifest.restoreVerified -eq $true) {
        Write-Output 'Restore verification: verified.'
    } else {
        Write-Output 'Restore verification: not performed and not required by this invocation.'
    }
    if ($manifest.storageFilesBackedUp -eq $true) {
        Write-Output 'Supabase Storage backup: verified.'
    } else {
        Write-Output 'Supabase Storage backup: not performed and not required by this invocation.'
    }
    Write-Output 'Migration authorization: not granted by this script.'
} catch {
    Write-Error "FAIL: $($_.Exception.Message)"
    Write-Output 'Migration authorization: not granted.'
    exit 1
}
