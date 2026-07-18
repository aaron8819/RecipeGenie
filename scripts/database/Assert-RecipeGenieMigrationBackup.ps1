[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$BackupDirectory,
    [Parameter(Mandatory)] [string]$ExpectedProjectReference,
    [ValidateRange(1, 525600)] [int]$MaximumAgeMinutes = 60,
    [string]$MigrationPath = 'supabase/migrations/012_enforce_uuid_active_recipe_writes.sql',
    [switch]$RequireRestoreVerification,
    [switch]$RequireStorageBackup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RecipeGenieBackup.Common.ps1')
$testScript = Join-Path $PSScriptRoot 'Test-RecipeGenieBackup.ps1'

try {
    $repositoryRoot = (git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $repositoryRoot) { throw 'Git repository root could not be established.' }
    $repositoryRoot = $repositoryRoot.Trim()
    $headCommit = (git -C $repositoryRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $headCommit -notmatch '^[0-9a-f]{40}$') { throw 'Current Git commit could not be established.' }
    $normalizedMigrationPath = $MigrationPath.Replace('\\', '/')
    & $testScript -BackupDirectory $BackupDirectory -ExpectedProjectReference $ExpectedProjectReference -MaximumAgeMinutes $MaximumAgeMinutes -ExpectedMigrationPath $normalizedMigrationPath -ExpectedGitCommitSha $headCommit
    $manifest = Get-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.json') -Raw | ConvertFrom-Json
    $migrationHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $headCommit -RepositoryRelativePath $normalizedMigrationPath
    if ($manifest.migration.sha256 -ne $migrationHash) { throw 'Backup migration hash does not match the recorded commit.' }
    $migrationFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $normalizedMigrationPath)
    if (-not (Test-Path -LiteralPath $migrationFullPath -PathType Leaf) -or -not (Test-GitPathMatchesCommit $repositoryRoot $headCommit $normalizedMigrationPath)) {
        throw 'Migration worktree file does not match the recorded commit.'
    }
    $preflightPath = 'scripts/database/preflight/' + [IO.Path]::GetFileName($normalizedMigrationPath)
    $preflightHash = Get-GitBlobSha256 -RepositoryRoot $repositoryRoot -CommitSha $headCommit -RepositoryRelativePath $preflightPath
    if ($manifest.preflight.path -ne $preflightPath -or $manifest.preflight.sha256 -ne $preflightHash) { throw 'Backup preflight hash does not match the recorded commit.' }
    $preflightFullPath = Get-NormalizedFullPath (Join-Path $repositoryRoot $preflightPath)
    if (-not (Test-Path -LiteralPath $preflightFullPath -PathType Leaf) -or -not (Test-GitPathMatchesCommit $repositoryRoot $headCommit $preflightPath)) {
        throw 'Migration preflight worktree file does not match the recorded commit.'
    }
    $restoreRequired = $RequireRestoreVerification -or [IO.Path]::GetFileName($normalizedMigrationPath) -eq '012_enforce_uuid_active_recipe_writes.sql'
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
