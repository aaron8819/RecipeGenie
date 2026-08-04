if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion -lt [version]'7.4') {
    throw 'Recipe Genie backup tooling requires PowerShell 7.4 or later (pwsh). Windows PowerShell 5.1 is not supported.'
}

Set-StrictMode -Version Latest

function Protect-RecipeGenieSecret {
    param(
        [AllowEmptyString()] [string]$Text,
        [string[]]$LiteralSecrets = @()
    )
    if ([string]::IsNullOrEmpty($Text)) { return $Text }

    $protected = $Text
    foreach ($secret in $LiteralSecrets) {
        if (-not [string]::IsNullOrEmpty($secret)) {
            $protected = $protected.Replace($secret, '[REDACTED]')
            try {
                $encoded = [Uri]::EscapeDataString($secret)
                if ($encoded -ne $secret) { $protected = $protected.Replace($encoded, '[REDACTED]') }
            } catch { throw "Failed to prepare secret redaction." }
        }
    }

    $patterns = @(
        '(?i)\b(?:postgres(?:ql)?):\/\/[^\s''"<>]+',
        '(?i)\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|PGPASSWORD|DATABASE_URL)\s*[:=]\s*[^\s;]+',
        '(?i)\b(?:sbp|sb_secret|service_role)_[A-Za-z0-9._-]{12,}',
        '\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b',
        '(?i)\bcli_login_postgres(?:\.[A-Za-z0-9_-]+)?\b(?:\s*[:=]\s*[^\s;]+)?',
        '(?i)([?&](?:password|pass|token|apikey|api_key|access_token|sslpassword)=)[^&\s]+',
        '(?i)(password\s*[:=]\s*)[^\s;]+'
    )
    foreach ($pattern in $patterns) {
        $protected = [regex]::Replace($protected, $pattern, '$1[REDACTED]')
    }
    return $protected
}

function Write-SanitizedFile {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [AllowEmptyString()] [string]$Content,
        [string[]]$LiteralSecrets = @()
    )
    $safe = Protect-RecipeGenieSecret -Text $Content -LiteralSecrets $LiteralSecrets
    $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporaryPath = Join-Path $directory ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temporaryPath, $safe, [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporaryPath, $Path, $true)
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) { [IO.File]::Delete($temporaryPath) }
    }
}

function Test-RecipeGenieSensitiveText {
    param([AllowEmptyString()] [string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $false }
    $patterns = @(
        '(?i)\b(?:postgres(?:ql)?):\/\/[^\s''"<>]+',
        '(?i)\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|PGPASSWORD|DATABASE_URL)\s*[:=]\s*(?!\[REDACTED\])[^\s;]+',
        '(?i)\b(?:sbp|sb_secret|service_role)_[A-Za-z0-9._-]{12,}',
        '\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b',
        '(?i)\bcli_login_postgres(?:\.[A-Za-z0-9_-]+)?\b(?:\s*[:=]\s*(?!\[REDACTED\])[^\s;]+)?'
    )
    return [bool]($patterns | Where-Object { $Text -match $_ } | Select-Object -First 1)
}

function Get-NormalizedFullPath {
    param([Parameter(Mandatory)] [string]$Path)
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory)] [string]$Candidate,
        [Parameter(Mandatory)] [string]$Parent
    )
    $candidatePath = Get-NormalizedFullPath $Candidate
    $parentPath = Get-NormalizedFullPath $Parent
    if ($candidatePath.Equals($parentPath, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $candidatePath.StartsWith($parentPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Test-RecipeGenieRepositoryRoot {
    param([Parameter(Mandatory)] [string]$RepositoryRoot)

    $document = $null
    try {
        $root = Get-NormalizedFullPath $RepositoryRoot
        $requiredFiles = @(
            'web/package.json',
            'supabase/migrations/001_baseline.sql',
            'scripts/database/Backup-RecipeGenieProduction.ps1',
            'scripts/database/RecipeGenieBackup.Common.ps1'
        )
        foreach ($relativePath in $requiredFiles) {
            if (-not (Test-Path -LiteralPath (Join-Path $root $relativePath) -PathType Leaf)) { return $false }
        }

        $packageText = [IO.File]::ReadAllText((Join-Path $root 'web/package.json'))
        $document = [Text.Json.JsonDocument]::Parse($packageText)
        Assert-NoDuplicateJsonProperties $document.RootElement
        if ($document.RootElement.ValueKind -ne [Text.Json.JsonValueKind]::Object) { return $false }

        $name = [Text.Json.JsonElement]::new()
        $private = [Text.Json.JsonElement]::new()
        if (-not $document.RootElement.TryGetProperty('name', [ref]$name) -or $name.ValueKind -ne [Text.Json.JsonValueKind]::String -or
            -not $document.RootElement.TryGetProperty('private', [ref]$private) -or $private.ValueKind -notin @([Text.Json.JsonValueKind]::True, [Text.Json.JsonValueKind]::False)) {
            return $false
        }
        return $name.GetString() -ceq 'recipe-genie' -and $private.GetBoolean()
    } catch {
        return $false
    } finally {
        if ($document) { $document.Dispose() }
    }
}

function Assert-RecipeGenieCatalogRelationIdentity {
    param(
        [AllowEmptyString()] [string]$SchemaName,
        [AllowEmptyString()] [string]$RelationName,
        [AllowEmptyString()] [string]$RelationKind,
        [AllowEmptyString()] [string]$CandidateCount,
        [Parameter(Mandatory)] [string]$ExpectedRelationName
    )

    $parsedCandidateCount = 0
    if (-not [int]::TryParse($CandidateCount, [ref]$parsedCandidateCount) -or
        $parsedCandidateCount -ne 1 -or
        $SchemaName -cne 'public' -or
        $RelationName -cne $ExpectedRelationName -or
        $RelationKind -cne 'r') {
        throw "Connected database catalog identity failed for public.$ExpectedRelationName."
    }
}

function Assert-RecipeGenieConnectedDatabaseIdentity {
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string[]]$Fields,
        [Parameter(Mandatory)] [string]$ConfiguredDatabase,
        [Parameter(Mandatory)] [string[]]$ExpectedMigrationVersions
    )

    $expectedLedger = $ExpectedMigrationVersions -join ','
    if ($Fields.Count -ne 17 -or
        $Fields[0] -cne 'postgres' -or
        $Fields[0] -cne $ConfiguredDatabase -or
        $Fields[1] -cne 'postgres' -or
        $Fields[16] -cne $expectedLedger) {
        throw 'Connected database does not corroborate the expected Recipe Genie pre-migration identity.'
    }

    Assert-RecipeGenieCatalogRelationIdentity -SchemaName $Fields[4] -RelationName $Fields[5] -RelationKind $Fields[6] -CandidateCount $Fields[7] -ExpectedRelationName 'recipes'
    Assert-RecipeGenieCatalogRelationIdentity -SchemaName $Fields[8] -RelationName $Fields[9] -RelationKind $Fields[10] -CandidateCount $Fields[11] -ExpectedRelationName 'pantry_items'
    Assert-RecipeGenieCatalogRelationIdentity -SchemaName $Fields[12] -RelationName $Fields[13] -RelationKind $Fields[14] -CandidateCount $Fields[15] -ExpectedRelationName 'user_config'
}

function Get-RecipeGenieMigrationBackupDefinition {
    param([Parameter(Mandatory)] [string]$MigrationPath)

    $normalizedPath = $MigrationPath.Replace('\', '/')
    $definition = switch ($normalizedPath) {
        'supabase/migrations/012_enforce_uuid_active_recipe_writes.sql' {
            [ordered]@{
                MigrationPath = $normalizedPath
                PendingMigrationVersion = '012'
                ExpectedAppliedMigrationVersions = @('001','002','003','004','005','006','007','008','009','010','011')
                ExpectedProjectReference = 'eyaoahwzixqetjgfghsh'
                RequireRestoreVerification = $true
            }
        }
        'supabase/migrations/013_allow_uuid_shopping_contribution_replacement.sql' {
            [ordered]@{
                MigrationPath = $normalizedPath
                PendingMigrationVersion = '013'
                ExpectedAppliedMigrationVersions = @('001','002','003','004','005','006','007','008','009','010','011','012')
                ExpectedProjectReference = 'eyaoahwzixqetjgfghsh'
                RequireRestoreVerification = $true
            }
        }
        'supabase/migrations/014_add_recipe_yield_metadata.sql' {
            [ordered]@{
                MigrationPath = $normalizedPath
                PendingMigrationVersion = '014'
                ExpectedAppliedMigrationVersions = @('001','002','003','004','005','006','007','008','009','010','011','012','013')
                ExpectedProjectReference = 'eyaoahwzixqetjgfghsh'
                RequireRestoreVerification = $true
            }
        }
        'supabase/migrations/016_canonical_recipe_structure_cutover.sql' {
            [ordered]@{
                MigrationPath = $normalizedPath
                PendingMigrationVersion = '016'
                ExpectedAppliedMigrationVersions = @('001','002','003','004','005','006','007','008','009','010','011','012','013','014','015')
                ExpectedProjectReference = 'eyaoahwzixqetjgfghsh'
                RequireRestoreVerification = $true
                AllowExternalEvidenceCommit = $true
                ExpectedEvidenceCommitSha = '172958fe5a413f4c8ced08b431b3ead82dc92bf7'
                PreflightPath = 'supabase/verification/canonical_recipe_structure_preflight.sql'
                RestoreAssertionPath = 'scripts/database/restore/016_canonical_recipe_structure_cutover.sql'
                RestorePreparationPath = 'scripts/database/restore/016_prepare_clean_restore.sql'
                RestoreFinalizationPath = 'scripts/database/restore/016_finalize_clean_restore.sql'
                RequiredArchiveTables = @(
                    'public.recipes',
                    'public.recipe_shares',
                    'supabase_migrations.schema_migrations'
                )
                RequiredArchiveFunctions = @(
                    'private.recipe_share_snapshot_is_valid',
                    'public.accept_recipe_share',
                    'public.handle_new_user'
                )
            }
        }
        default { throw 'Migration is not supported by the Recipe Genie production backup gate.' }
    }
    [pscustomobject]$definition
}

function Resolve-GitExecutable {
    param([scriptblock]$CommandLookup)

    if ($CommandLookup) {
        $applicationCommands = @(& $CommandLookup 'git.exe' 'Application')
        $allCommands = @(& $CommandLookup 'git' 'All')
    } else {
        $applicationCommands = @(Get-Command git.exe -All -CommandType Application -ErrorAction SilentlyContinue)
        $allCommands = @(Get-Command git -All -ErrorAction SilentlyContinue)
    }
    if (@($allCommands | Where-Object { $_.CommandType -ne 'Application' }).Count -gt 0) {
        throw 'Git command resolution is shadowed by an alias, function, or script.'
    }
    if (@($applicationCommands | Where-Object { $_.CommandType -ne 'Application' }).Count -gt 0) {
        throw 'Git resolution did not return only application executables.'
    }
    $paths = @($applicationCommands | ForEach-Object {
        $candidate = if ($_.Source) { $_.Source } elseif ($_.Path) { $_.Path } else { $null }
        if ($candidate -and [IO.Path]::IsPathRooted($candidate)) { [IO.Path]::GetFullPath($candidate) }
    } | Sort-Object -Unique)
    if ($paths.Count -eq 0) { throw 'Git executable could not be resolved.' }
    if ($paths.Count -ne 1) { throw 'Git executable resolution is ambiguous.' }
    if (-not (Test-Path -LiteralPath $paths[0] -PathType Leaf)) { throw 'Resolved Git executable does not exist.' }
    return $paths[0]
}

function Invoke-GitCapture {
    param(
        [Parameter(Mandatory)] [string]$GitExecutablePath,
        [Parameter(Mandatory)] [string[]]$ArgumentList
    )
    if (-not [IO.Path]::IsPathRooted($GitExecutablePath)) { throw 'Git executable path must be absolute.' }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $GitExecutablePath
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    foreach ($argument in $ArgumentList) { $process.StartInfo.ArgumentList.Add($argument) }
    try {
        if (-not $process.Start()) { throw 'Git process did not start.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $null = $stderrTask.GetAwaiter().GetResult()
        [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $stdout }
    } finally {
        $process.Dispose()
    }
}

function Get-SanitizedGitVersion {
    param([Parameter(Mandatory)] [string]$GitExecutablePath)
    $result = Invoke-GitCapture $GitExecutablePath @('--version')
    $versionText = if ($result.Output) { $result.Output.Trim() } else { '' }
    if ($result.ExitCode -ne 0 -or $versionText -notmatch '^git version ([0-9]+(?:\.[0-9]+){1,3})(?:\.windows\.[0-9]+)?$') {
        throw 'Git version could not be safely recorded.'
    }
    return "git version $($Matches[1])"
}

function Get-RegisteredGitWorktreePaths {
    param(
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string]$GitExecutablePath
    )

    $result = Invoke-GitCapture $GitExecutablePath @('-C', $RepositoryRoot, 'worktree', 'list', '--porcelain')
    if ($result.ExitCode -ne 0) { throw 'Registered Git worktrees could not be enumerated.' }
    $lines = @($result.Output -split '\r?\n')
    $paths = @($lines | Where-Object { $_ -like 'worktree *' } | ForEach-Object { $_.Substring(9) })
    if ($paths.Count -eq 0) { throw 'Git reported no registered worktrees.' }
    return @($paths | ForEach-Object { Get-NormalizedFullPath $_ } | Sort-Object -Unique)
}

function Assert-ExternalDestination {
    param(
        [Parameter(Mandatory)] [string]$DestinationRoot,
        [Parameter(Mandatory)] [string[]]$RegisteredWorktreePaths
    )
    $candidate = Get-NormalizedFullPath $DestinationRoot
    $cursor = [IO.Path]::GetPathRoot($candidate)
    foreach ($segment in [regex]::Split($candidate.Substring($cursor.Length), '[\\/]+') | Where-Object { $_ }) {
        $cursor = Join-Path $cursor $segment
        if (-not (Test-Path -LiteralPath $cursor)) { break }
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Destination root cannot traverse a filesystem reparse point.'
        }
    }
    foreach ($worktreePath in $RegisteredWorktreePaths) {
        if (Test-PathWithin -Candidate $DestinationRoot -Parent $worktreePath) {
            throw "Destination root must be outside every registered Git worktree."
        }
    }
}

function Get-LinkedProjectReference {
    param([Parameter(Mandatory)] [string]$RepositoryRoot)

    $path = Join-Path $RepositoryRoot 'supabase/.temp/project-ref'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Connected project identity is unavailable. Link this checkout with the Supabase CLI before backup.'
    }
    $reference = [IO.File]::ReadAllText($path).Trim()
    if ($reference -notmatch '^[a-z0-9]{20}$') { throw 'Connected project identity is invalid.' }
    return $reference
}

function Get-GitBlobSha256 {
    param(
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string]$CommitSha,
        [Parameter(Mandatory)] [string]$RepositoryRelativePath,
        [Parameter(Mandatory)] [string]$GitExecutablePath
    )

    if ($CommitSha -notmatch '^[0-9a-f]{40}$') { throw 'Git commit SHA is invalid.' }
    if ([IO.Path]::IsPathRooted($RepositoryRelativePath) -or $RepositoryRelativePath -match '(^|[\\/])\.\.([\\/]|$)') {
        throw 'Migration path must be repository-relative and cannot escape the repository.'
    }
    $spec = "$CommitSha`:$($RepositoryRelativePath.Replace('\\','/'))"
    $blobResult = Invoke-GitCapture $GitExecutablePath @('-C', $RepositoryRoot, 'rev-parse', $spec)
    if ($blobResult.ExitCode -ne 0 -or -not $blobResult.Output) { throw 'Migration evidence is not present at the recorded Git commit.' }
    $blobId = $blobResult.Output.Trim()
    if ($blobId -notmatch '^[0-9a-f]{40,64}$') { throw 'Git blob identity is invalid.' }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $GitExecutablePath
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    foreach ($argument in @('-C', $RepositoryRoot, 'cat-file', 'blob', $blobId)) { $process.StartInfo.ArgumentList.Add($argument) }
    try {
        if (-not $process.Start()) { throw 'Git blob process did not start.' }
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $hashBytes = $algorithm.ComputeHash($process.StandardOutput.BaseStream) } finally { $algorithm.Dispose() }
        $process.WaitForExit()
        $null = $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'Migration evidence could not be read from the recorded Git commit.' }
        return [Convert]::ToHexString($hashBytes).ToLowerInvariant()
    } finally {
        $process.Dispose()
    }
}

function Export-GitBlobToFile {
    param(
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string]$CommitSha,
        [Parameter(Mandatory)] [string]$RepositoryRelativePath,
        [Parameter(Mandatory)] [string]$GitExecutablePath,
        [Parameter(Mandatory)] [string]$DestinationPath
    )

    if ($CommitSha -notmatch '^[0-9a-f]{40}$') { throw 'Git commit SHA is invalid.' }
    if ([IO.Path]::IsPathRooted($RepositoryRelativePath) -or $RepositoryRelativePath -match '(^|[\\/])\.\.([\\/]|$)') {
        throw 'Evidence path must be repository-relative and cannot escape the repository.'
    }
    $spec = "$CommitSha`:$($RepositoryRelativePath.Replace('\\','/'))"
    $blobResult = Invoke-GitCapture $GitExecutablePath @('-C', $RepositoryRoot, 'rev-parse', $spec)
    if ($blobResult.ExitCode -ne 0 -or -not $blobResult.Output) { throw 'Evidence is not present at the recorded Git commit.' }
    $blobId = $blobResult.Output.Trim()
    if ($blobId -notmatch '^[0-9a-f]{40,64}$') { throw 'Git blob identity is invalid.' }

    $destinationDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($DestinationPath))
    [IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $GitExecutablePath
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    foreach ($argument in @('-C', $RepositoryRoot, 'cat-file', 'blob', $blobId)) { $process.StartInfo.ArgumentList.Add($argument) }
    try {
        if (-not $process.Start()) { throw 'Git blob process did not start.' }
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $stream = [IO.File]::Open($DestinationPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $process.StandardOutput.BaseStream.CopyTo($stream) } finally { $stream.Dispose() }
        $process.WaitForExit()
        $null = $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'Evidence could not be read from the recorded Git commit.' }
    } finally {
        $process.Dispose()
    }
}

function Test-GitPathMatchesCommit {
    param(
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string]$CommitSha,
        [Parameter(Mandatory)] [string]$RepositoryRelativePath,
        [Parameter(Mandatory)] [string]$GitExecutablePath
    )

    $result = Invoke-GitCapture $GitExecutablePath @('-C', $RepositoryRoot, 'diff', '--quiet', $CommitSha, '--', $RepositoryRelativePath)
    if ($result.ExitCode -eq 0) { return $true }
    if ($result.ExitCode -eq 1) { return $false }
    throw 'Git could not compare migration evidence with the recorded commit.'
}

function ConvertTo-NormalizedHost {
    param([Parameter(Mandatory)] [string]$HostName)
    $value = $HostName.Trim().TrimEnd('.')
    if ($value.StartsWith('[') -and $value.EndsWith(']')) { $value = $value.Substring(1, $value.Length - 2) }
    $address = $null
    if ([Net.IPAddress]::TryParse($value, [ref]$address)) { return $address.ToString().ToLowerInvariant() }
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match '[/:\\\s]') { throw 'Database host is invalid.' }
    try { return ([Globalization.IdnMapping]::new().GetAscii($value)).ToLowerInvariant() } catch { throw 'Database host is invalid.' }
}

function Assert-NoDuplicateJsonProperties {
    param([Parameter(Mandatory)] [Text.Json.JsonElement]$Element)
    if ($Element.ValueKind -eq [Text.Json.JsonValueKind]::Object) {
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($property in $Element.EnumerateObject()) {
            if (-not $names.Add($property.Name)) { throw 'Management API response contains duplicate JSON fields.' }
            Assert-NoDuplicateJsonProperties $property.Value
        }
    } elseif ($Element.ValueKind -eq [Text.Json.JsonValueKind]::Array) {
        foreach ($item in $Element.EnumerateArray()) { Assert-NoDuplicateJsonProperties $item }
    }
}

function Invoke-SupabaseProjectMetadata {
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$AccessToken,
        [Parameter(Mandatory)] [string]$ExpectedProjectReference,
        [Parameter(Mandatory)] [object]$Connection,
        [ValidateRange(1, 60)] [int]$TimeoutSeconds = 10,
        [scriptblock]$HttpInvoker
    )
    if ([string]::IsNullOrWhiteSpace($AccessToken)) { throw 'Supabase Management API access token is required.' }
    if ($ExpectedProjectReference -notmatch '^[a-z0-9]{20}$') { throw 'Expected project reference is invalid.' }
    $requestUri = [Uri]"https://api.supabase.com/v1/projects/$ExpectedProjectReference"
    try {
        if ($HttpInvoker) {
            $response = & $HttpInvoker $requestUri $AccessToken $TimeoutSeconds
        } else {
            $handler = [Net.Http.HttpClientHandler]::new()
            $handler.AllowAutoRedirect = $false
            $client = [Net.Http.HttpClient]::new($handler)
            $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $requestUri)
            $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $AccessToken)
            $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
            try {
                $httpResponse = $client.Send($request)
                $content = $httpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                $location = if ($httpResponse.Headers.Location) { $httpResponse.Headers.Location.ToString() } else { $null }
                $response = [pscustomobject]@{ StatusCode = [int]$httpResponse.StatusCode; Content = $content; Location = $location }
            } finally {
                $request.Dispose(); $client.Dispose(); $handler.Dispose()
            }
        }
    } catch {
        throw 'Supabase Management API request failed or timed out.'
    }
    if ($null -eq $response -or $null -eq $response.PSObject.Properties['StatusCode']) { throw 'Supabase Management API response is invalid.' }
    $statusCode = [int]$response.StatusCode
    if ($statusCode -ge 300 -and $statusCode -lt 400) { throw 'Supabase Management API redirect was rejected.' }
    if ($statusCode -ne 200) { throw "Supabase Management API request failed with HTTP status $statusCode." }
    $content = [string]$response.Content
    if ([Text.Encoding]::UTF8.GetByteCount($content) -gt 1048576) { throw 'Supabase Management API response is too large.' }
    $document = $null
    try {
        $document = [Text.Json.JsonDocument]::Parse($content)
        Assert-NoDuplicateJsonProperties $document.RootElement
        if ($document.RootElement.ValueKind -ne [Text.Json.JsonValueKind]::Object) { throw 'invalid' }
        $refElement = [Text.Json.JsonElement]::new()
        $statusElement = [Text.Json.JsonElement]::new()
        $databaseElement = [Text.Json.JsonElement]::new()
        $hostElement = [Text.Json.JsonElement]::new()
        if (-not $document.RootElement.TryGetProperty('ref', [ref]$refElement) -or $refElement.ValueKind -ne [Text.Json.JsonValueKind]::String -or
            -not $document.RootElement.TryGetProperty('status', [ref]$statusElement) -or $statusElement.ValueKind -ne [Text.Json.JsonValueKind]::String -or
            -not $document.RootElement.TryGetProperty('database', [ref]$databaseElement) -or $databaseElement.ValueKind -ne [Text.Json.JsonValueKind]::Object -or
            -not $databaseElement.TryGetProperty('host', [ref]$hostElement) -or $hostElement.ValueKind -ne [Text.Json.JsonValueKind]::String) { throw 'invalid' }
        $project = $content | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw 'Supabase Management API response JSON is malformed or ambiguous.'
    } finally {
        if ($document) { $document.Dispose() }
    }
    foreach ($name in @('ref','status','database')) {
        if ($null -eq $project.PSObject.Properties[$name]) { throw "Supabase Management API response is missing required project metadata." }
    }
    if ([string]$project.ref -cne $ExpectedProjectReference) { throw 'Management API project reference does not match the expected project.' }
    if ([string]$project.status -cne 'ACTIVE_HEALTHY') { throw 'Management API project status is not acceptable for backup.' }
    if ($null -eq $project.database -or $null -eq $project.database.PSObject.Properties['host'] -or [string]::IsNullOrWhiteSpace([string]$project.database.host)) {
        throw 'Management API database host is missing.'
    }
    $apiHost = ConvertTo-NormalizedHost ([string]$project.database.host)
    $configuredHost = ConvertTo-NormalizedHost ([string]$Connection.Host)
    $expectedDirectHost = ConvertTo-NormalizedHost "db.$ExpectedProjectReference.supabase.co"
    if ($apiHost -cne $expectedDirectHost) { throw 'Management API project metadata is internally inconsistent.' }
    if ($Connection.EndpointType -eq 'direct') {
        if ($configuredHost -cne $apiHost) { throw 'Configured direct database host does not match Management API metadata.' }
    } elseif ($Connection.EndpointType -eq 'session-pooler') {
        if ($configuredHost -notmatch '^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$' -or $Connection.User -cne "postgres.$ExpectedProjectReference") {
            throw 'Configured session-pooler endpoint does not identify the Management API project.'
        }
    } else {
        throw 'Configured endpoint type is ambiguous.'
    }
    [pscustomobject]@{
        ProjectReference = [string]$project.ref
        ProjectStatus = [string]$project.status
        DatabaseHost = $apiHost
        DatabaseHostMatched = $true
        EndpointType = [string]$Connection.EndpointType
    }
}

function ConvertFrom-RecipeGenieDatabaseUrl {
    param(
        [Parameter(Mandatory)] [string]$DatabaseUrl,
        [Parameter(Mandatory)] [string]$ExpectedProjectReference,
        [switch]$AllowSessionPooler
    )
    if ($ExpectedProjectReference -notmatch '^[a-z0-9]{20}$') {
        throw "Expected project reference must be an explicit 20-character Supabase project reference."
    }
    try { $uri = [Uri]$DatabaseUrl } catch { throw "Database URL is invalid." }
    if ($uri.Scheme -notin @('postgres', 'postgresql') -or -not $uri.Host -or -not $uri.UserInfo) {
        throw "Database URL must be an explicit PostgreSQL URL with host and credentials."
    }
    $parts = $uri.UserInfo.Split(':', 2)
    if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[1])) {
        throw "Database URL must include a database password."
    }
    $user = [Uri]::UnescapeDataString($parts[0])
    $password = [Uri]::UnescapeDataString($parts[1])
    $database = $uri.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($database)) { throw "Database URL must name a database." }
    if ([Uri]::UnescapeDataString($database) -cne 'postgres') { throw 'Database URL must identify the expected postgres database.' }

    $normalizedHost = ConvertTo-NormalizedHost $uri.Host
    $directHost = ConvertTo-NormalizedHost "db.$ExpectedProjectReference.supabase.co"
    $isPooler = $normalizedHost -match '^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$'
    if ($normalizedHost -ceq $directHost) {
        $endpointType = 'direct'
        if ($user -ne 'postgres') { throw "Direct endpoint must use the expected Supabase postgres login." }
    } elseif ($isPooler) {
        if ($uri.Port -eq 6543) { throw "Transaction-pooler connections are not supported for pg_dump." }
        if ($uri.Port -ne 5432) { throw "Pooler endpoint is ambiguous; expected the compatible session-pooler port 5432." }
        if (-not $AllowSessionPooler) { throw "Session-pooler use requires the explicit -AllowSessionPooler switch." }
        if ($user -ne "postgres.$ExpectedProjectReference") { throw "Session-pooler login does not identify the expected project." }
        $endpointType = 'session-pooler'
    } else {
        throw "Database endpoint does not identify the expected Recipe Genie Supabase project."
    }

    $sslMode = 'require'
    foreach ($pair in $uri.Query.TrimStart('?').Split('&', [StringSplitOptions]::RemoveEmptyEntries)) {
        $queryParts = $pair.Split('=', 2)
        if ([Uri]::UnescapeDataString($queryParts[0]) -eq 'sslmode' -and $queryParts.Count -eq 2) {
            $sslMode = [Uri]::UnescapeDataString($queryParts[1])
        }
    }
    if ($sslMode -notin @('require', 'verify-ca', 'verify-full')) { throw "Database URL must require TLS." }

    [pscustomobject]@{
        Host = $normalizedHost
        Port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
        Database = [Uri]::UnescapeDataString($database)
        User = $user
        Password = $password
        SslMode = $sslMode
        EndpointType = $endpointType
        ProjectReference = $ExpectedProjectReference
    }
}

function Resolve-PostgreSqlTool {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [string]$BinDirectory
    )
    $extension = if ($IsWindows) { '.exe' } else { '' }
    if ($BinDirectory) {
        $candidate = Join-Path $BinDirectory ($Name + $extension)
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Required tool not found: $Name" }
        return (Get-Item -LiteralPath $candidate).FullName
    }
    $command = Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
    return $command.Source
}

function Invoke-RecipeGenieNativeProcess {
    param(
        [Parameter(Mandatory)] [string]$ExecutablePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)] [string]$StdOutPath,
        [Parameter(Mandatory)] [string]$StdErrPath,
        [string[]]$LiteralSecrets = @()
    )
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $ExecutablePath
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    foreach ($argument in $ArgumentList) { $process.StartInfo.ArgumentList.Add($argument) }
    $stdout = ''
    $stderr = ''
    $exitCode = $null
    try {
        if (-not $process.Start()) { throw 'Native process did not start.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
    } finally {
        Write-SanitizedFile -Path $StdOutPath -Content $stdout -LiteralSecrets $LiteralSecrets
        Write-SanitizedFile -Path $StdErrPath -Content $stderr -LiteralSecrets $LiteralSecrets
        $process.Dispose()
    }
    if ($null -eq $exitCode) {
        throw "Native process did not provide an exit code."
    }
    [pscustomobject]@{ ExitCode = [int]$exitCode }
}

function Assert-NativeExitCode {
    param(
        [Parameter(Mandatory)] [object]$Result,
        [Parameter(Mandatory)] [string]$Operation
    )
    $property = $Result.PSObject.Properties['ExitCode']
    if ($null -eq $property -or $null -eq $property.Value) { throw "$Operation did not provide a native exit code." }
    if ([int]$property.Value -ne 0) { throw "$Operation failed with exit code $($property.Value)." }
}

function Get-PostgreSqlMajorVersion {
    param([Parameter(Mandatory)] [string]$VersionText)
    $match = [regex]::Match($VersionText, '(?i)(?:PostgreSQL\)?\s+)?(\d+)(?:\.\d+)?')
    if (-not $match.Success) { throw "PostgreSQL major version could not be determined." }
    return [int]$match.Groups[1].Value
}

function Test-ArchiveTableOfContents {
    param(
        [Parameter(Mandatory)] [string]$Contents,
        [object]$Definition
    )
    $ledger = $Contents -match '(?im)\b(?:TABLE|TABLE DATA)\s+supabase_migrations\s+schema_migrations\b'
    $core = $Contents -match '(?im)\bTABLE\s+public\s+recipes\b'
    $function = $Contents -match '(?im)\bFUNCTION\s+(?:public|private)\s+'
    $requiredTablesFound = $true
    $requiredFunctionsFound = $true
    if ($Definition -and $Definition.PSObject.Properties['RequiredArchiveTables']) {
        foreach ($table in @($Definition.RequiredArchiveTables)) {
            $parts = ([string]$table).Split('.', 2)
            if ($parts.Count -ne 2) { throw 'Required archive table definition is invalid.' }
            $schema = [regex]::Escape($parts[0])
            $name = [regex]::Escape($parts[1])
            if ($Contents -notmatch "(?im)\b(?:TABLE|TABLE DATA)\s+$schema\s+$name\b") {
                $requiredTablesFound = $false
            }
        }
    }
    if ($Definition -and $Definition.PSObject.Properties['RequiredArchiveFunctions']) {
        foreach ($requiredFunction in @($Definition.RequiredArchiveFunctions)) {
            $parts = ([string]$requiredFunction).Split('.', 2)
            if ($parts.Count -ne 2) { throw 'Required archive function definition is invalid.' }
            $schema = [regex]::Escape($parts[0])
            $name = [regex]::Escape($parts[1])
            if ($Contents -notmatch "(?im)\bFUNCTION\s+$schema\s+$name(?:\(|\s)") {
                $requiredFunctionsFound = $false
            }
        }
    }
    [pscustomobject]@{
        MigrationLedgerFound = $ledger
        CoreApplicationTableFound = $core
        ApplicationFunctionFound = $function
        RequiredTablesFound = $requiredTablesFound
        RequiredFunctionsFound = $requiredFunctionsFound
        ExpectedApplicationMarkersFound = ($core -and $function -and $requiredTablesFound -and $requiredFunctionsFound)
    }
}

function Get-ManifestArtifact {
    param([Parameter(Mandatory)] [object]$Manifest)
    $artifacts = @($Manifest.artifacts | Where-Object { $_.fileName -eq 'database.dump' })
    if ($artifacts.Count -ne 1) { throw "Manifest must contain exactly one database.dump artifact." }
    return $artifacts[0]
}
