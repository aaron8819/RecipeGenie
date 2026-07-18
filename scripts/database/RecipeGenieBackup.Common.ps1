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

function Get-RegisteredGitWorktreePaths {
    param([Parameter(Mandatory)] [string]$RepositoryRoot)

    $lines = @(git -C $RepositoryRoot worktree list --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Registered Git worktrees could not be enumerated.' }
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
        [Parameter(Mandatory)] [string]$RepositoryRelativePath
    )

    if ($CommitSha -notmatch '^[0-9a-f]{40}$') { throw 'Git commit SHA is invalid.' }
    if ([IO.Path]::IsPathRooted($RepositoryRelativePath) -or $RepositoryRelativePath -match '(^|[\\/])\.\.([\\/]|$)') {
        throw 'Migration path must be repository-relative and cannot escape the repository.'
    }
    $spec = "$CommitSha`:$($RepositoryRelativePath.Replace('\\','/'))"
    $blobId = (git -C $RepositoryRoot rev-parse $spec 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $blobId) { throw 'Migration evidence is not present at the recorded Git commit.' }
    $blobId = $blobId.Trim()
    if ($blobId -notmatch '^[0-9a-f]{40,64}$') { throw 'Git blob identity is invalid.' }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = 'git'
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

function Test-GitPathMatchesCommit {
    param(
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string]$CommitSha,
        [Parameter(Mandatory)] [string]$RepositoryRelativePath
    )

    git -C $RepositoryRoot diff --quiet $CommitSha -- $RepositoryRelativePath
    if ($LASTEXITCODE -eq 0) { return $true }
    if ($LASTEXITCODE -eq 1) { return $false }
    throw 'Git could not compare migration evidence with the recorded commit.'
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

    $directHost = "db.$ExpectedProjectReference.supabase.co"
    $isPooler = $uri.Host -match '(?i)\.pooler\.supabase\.com$'
    if ($uri.Host.Equals($directHost, [StringComparison]::OrdinalIgnoreCase)) {
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
        Host = $uri.Host
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
    param([Parameter(Mandatory)] [string]$Contents)
    $ledger = $Contents -match '(?im)\b(?:TABLE|TABLE DATA)\s+supabase_migrations\s+schema_migrations\b'
    $core = $Contents -match '(?im)\bTABLE\s+public\s+recipes\b'
    $function = $Contents -match '(?im)\bFUNCTION\s+(?:public|private)\s+'
    [pscustomobject]@{
        MigrationLedgerFound = $ledger
        CoreApplicationTableFound = $core
        ApplicationFunctionFound = $function
        ExpectedApplicationMarkersFound = ($core -and $function)
    }
}

function Get-ManifestArtifact {
    param([Parameter(Mandatory)] [object]$Manifest)
    $artifacts = @($Manifest.artifacts | Where-Object { $_.fileName -eq 'database.dump' })
    if ($artifacts.Count -ne 1) { throw "Manifest must contain exactly one database.dump artifact." }
    return $artifacts[0]
}
