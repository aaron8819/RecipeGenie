Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'RecipeGenieBackup.Common.ps1')
$ref = 'eyaoahwzixqetjgfghsh'
$pwsh = (Get-Process -Id $PID).Path
$gitExecutable = Resolve-GitExecutable
$repo = (Invoke-GitCapture $gitExecutable @('-C', $PSScriptRoot, 'rev-parse', '--show-toplevel')).Output.Trim()
$headCommit = (Invoke-GitCapture $gitExecutable @('-C', $repo, 'rev-parse', 'HEAD')).Output.Trim()
$migrationPath = 'supabase/migrations/012_enforce_uuid_active_recipe_writes.sql'
$preflightPath = 'scripts/database/preflight/012_enforce_uuid_active_recipe_writes.sql'
$migrationHash = Get-GitBlobSha256 $repo $headCommit $migrationPath $gitExecutable
$preflightHash = Get-GitBlobSha256 $repo $headCommit $preflightPath $gitExecutable
$temp = Join-Path ([IO.Path]::GetTempPath()) ('rg-backup-tests-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
$passed = 0
$failed = 0

function Case($name, [scriptblock]$body) {
    try { & $body; $script:passed++; "PASS: $name" }
    catch { $script:failed++; "FAIL: $name - $($_.Exception.Message)" }
}
function Must($condition, $message = 'assertion failed') { if (-not $condition) { throw $message } }
function Throws([scriptblock]$body, $pattern) {
    try { & $body; throw 'expected exception' }
    catch {
        if ($_.Exception.Message -eq 'expected exception') { throw }
        if ($pattern -and $_.Exception.Message -notmatch $pattern) { throw "wrong exception: $($_.Exception.Message)" }
    }
}
function Child($scriptPath, [string[]]$arguments) {
    $id = [Guid]::NewGuid().ToString('N')
    $out = Join-Path $temp "$id.out"
    $err = Join-Path $temp "$id.err"
    $args = @('-NoProfile','-File',('"' + $scriptPath + '"')) + $arguments
    $p = Start-Process $pwsh -ArgumentList $args -RedirectStandardOutput $out -RedirectStandardError $err -Wait -PassThru -NoNewWindow
    [pscustomobject]@{ ExitCode=$p.ExitCode; Output=([IO.File]::ReadAllText($out)+[IO.File]::ReadAllText($err)) }
}
function Fixture($name) {
    $dir = Join-Path $temp $name
    [IO.Directory]::CreateDirectory($dir) | Out-Null
    $dump = Join-Path $dir 'database.dump'
    [IO.File]::WriteAllBytes($dump, [byte[]](1,2,3,4,5,6))
    $hash = (Get-FileHash $dump -Algorithm SHA256).Hash
    $m = [ordered]@{
        schemaVersion=3; appName='Recipe Genie'; environment='production'; projectReference=$ref
        createdAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
        gitCommitSha=$headCommit;gitWorktreeClean=$true
        runtime=[ordered]@{edition='Core';version='7.4.0';architecture='Arm64'}
        identityVerification=[ordered]@{verified=$true;expectedProjectReference=$ref;repositoryIdentityMatched=$true;repositoryLinkedReferenceMatched=$true;controlPlaneProjectReferenceMatched=$true;controlPlaneProjectStatus='ACTIVE_HEALTHY';controlPlaneDatabaseHostMatched=$true;endpointType='direct';connectedDatabase='postgres';connectedUserClass='direct';postgresServerVersionAvailable=$true;migrationLedgerFound=$true;migrationLedgerVersions=@('001','002','003','004','005','006','007','008','009','010','011');applicationMarkersFound=$true}
        migration=[ordered]@{path=$migrationPath;commitSha=$headCommit;sha256=$migrationHash;worktreeMatchesCommit=$true}
        preflight=[ordered]@{path=$preflightPath;commitSha=$headCommit;sha256=$preflightHash;readOnly=$true;countOnly=$true;worktreeMatchesCommit=$true}
        backupScope=[ordered]@{type='logical-database-custom-archive';includedSchemas=@('public','private','supabase_migrations');includesStorageObjectPayloads=$false;includesSupabaseManagedAuthConfiguration=$false;includesGlobalRoles=$false;includesSecrets=$false}
        toolVersions=[ordered]@{git='git version 2.50.1'}
        artifacts=@([ordered]@{fileName='database.dump';sizeBytes=6;sha256=$hash})
        archiveContents=[ordered]@{migrationLedgerFound=$true;expectedApplicationMarkersFound=$true}
        commandResults=[ordered]@{serverVersionQueryExitCode=0;identityQueryExitCode=0;pgDumpExitCode=0;pgRestoreListExitCode=0}
        dumpCompleted=$true;archiveValidated=$true;restoreVerified=$false;restoreVerification=$null
        storageFilesBackedUp=$false;backupStatus='successful';migrationAuthorizationGranted=$false
    }
    [IO.File]::WriteAllText((Join-Path $dir 'manifest.json'),($m|ConvertTo-Json -Depth 8))
    [IO.File]::WriteAllText((Join-Path $dir 'summary.txt'),'Migration authorization: not granted')
    $dir
}
function Edit($dir,[scriptblock]$body) {
    $path=Join-Path $dir 'manifest.json'; $m=Get-Content $path -Raw|ConvertFrom-Json
    & $body $m
    [IO.File]::WriteAllText($path,($m|ConvertTo-Json -Depth 8))
}
function Verify($dir,$expected=$ref,$age=60) {
    Child (Join-Path $root 'Test-RecipeGenieBackup.ps1') @('-BackupDirectory',('"'+$dir+'"'),'-ExpectedProjectReference',$expected,'-MaximumAgeMinutes',[string]$age)
}
function Gate($dir,[string[]]$extra=@()) {
    Child (Join-Path $root 'Assert-RecipeGenieMigrationBackup.ps1') (@('-BackupDirectory',('"'+$dir+'"'),'-ExpectedProjectReference',$ref)+$extra)
}
function ApiResponse([int]$statusCode, [string]$content, [string]$location=$null) {
    [pscustomobject]@{StatusCode=$statusCode;Content=$content;Location=$location}
}
function ProjectJson([string]$projectRef=$ref,[string]$status='ACTIVE_HEALTHY',[string]$databaseHost="db.$ref.supabase.co") {
    [ordered]@{id='safe-id';ref=$projectRef;organization_id='safe-org';name='Recipe Genie';region='us-east-1';created_at='2026-01-01T00:00:00Z';status=$status;database=[ordered]@{host=$databaseHost;version='17';postgres_engine='17';release_channel='ga'}} | ConvertTo-Json -Compress -Depth 4
}

try {
    $registeredWorktrees = Get-RegisteredGitWorktreePaths $repo $gitExecutable
    Case 'destination inside repository rejected' { Throws { Assert-ExternalDestination (Join-Path $repo 'x') $registeredWorktrees } 'outside' }
    Case 'destination inside another registered worktree rejected' {
        $other = @($registeredWorktrees | Where-Object { $_ -ne $repo } | Select-Object -First 1)
        if ($other.Count -eq 0) { throw 'test requires another registered worktree' }
        Throws { Assert-ExternalDestination (Join-Path $other[0] 'backup-output') $registeredWorktrees } 'every registered'
    }
    Case 'external destination accepted' { Assert-ExternalDestination $temp $registeredWorktrees }
    Case 'reparse-point alias cannot bypass worktree protection' {
        $junction = Join-Path $temp 'worktree-alias'
        try {
            New-Item -ItemType Junction -Path $junction -Target $repo | Out-Null
            Throws { Assert-ExternalDestination (Join-Path $junction 'backup-output') $registeredWorktrees } 'reparse point'
        } finally {
            if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction) }
        }
    }
    Case 'linked project identity is read independently' {
        $fakeRepo = Join-Path $temp 'linked'; [IO.Directory]::CreateDirectory((Join-Path $fakeRepo 'supabase/.temp')) | Out-Null
        [IO.File]::WriteAllText((Join-Path $fakeRepo 'supabase/.temp/project-ref'), $ref)
        Must ((Get-LinkedProjectReference $fakeRepo) -eq $ref)
    }
    Case 'missing linked project identity fails closed' { Throws { Get-LinkedProjectReference (Join-Path $temp 'unlinked') } 'identity is unavailable' }
    Case 'Windows PowerShell 5.1 is rejected explicitly' {
        $windowsPowerShell = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
        $commonPath = Join-Path $root 'RecipeGenieBackup.Common.ps1'
        $command = "try { . '$($commonPath.Replace("'", "''"))'; exit 0 } catch { [Console]::Error.WriteLine(`$_.Exception.Message); exit 7 }"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $out = Join-Path $temp 'ps5.out'; $err = Join-Path $temp 'ps5.err'
        $result = Invoke-RecipeGenieNativeProcess $windowsPowerShell @('-NoProfile','-EncodedCommand',$encoded) $out $err
        Must ($result.ExitCode -eq 7); Must (([IO.File]::ReadAllText($err)) -match 'requires PowerShell 7\.4')
    }
    Case 'missing project reference fails' {
        $oldUrl=$env:RECIPE_GENIE_PRODUCTION_DATABASE_URL; $oldRef=$env:RECIPE_GENIE_PRODUCTION_PROJECT_REF
        try {
            $env:RECIPE_GENIE_PRODUCTION_DATABASE_URL='postgresql://postgres:fake@db.eyaoahwzixqetjgfghsh.supabase.co/postgres'
            $env:RECIPE_GENIE_PRODUCTION_PROJECT_REF=''
            Must ((Child (Join-Path $root 'Backup-RecipeGenieProduction.ps1') @('-DestinationRoot',('"'+$temp+'"'))).ExitCode -ne 0)
        } finally { $env:RECIPE_GENIE_PRODUCTION_DATABASE_URL=$oldUrl; $env:RECIPE_GENIE_PRODUCTION_PROJECT_REF=$oldRef }
    }
    Case 'direct endpoint accepted' { Must ((ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@db.eyaoahwzixqetjgfghsh.supabase.co/postgres' $ref).EndpointType -eq 'direct') }
    Case 'direct endpoint normalizes case and trailing dot' { Must ((ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@DB.EYAOAHWZIXQETJGFGHSH.SUPABASE.CO./postgres' $ref).Host -eq "db.$ref.supabase.co") }
    Case 'unexpected database name fails' { Throws { ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@db.eyaoahwzixqetjgfghsh.supabase.co/template1' $ref } 'expected postgres' }
    Case 'wrong project reference fails' { Throws { ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@db.aaaaaaaaaaaaaaaaaaaa.supabase.co/postgres' $ref } 'does not identify' }
    Case 'ambiguous identity fails closed' { Throws { ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@example.test/postgres' $ref } 'does not identify' }
    $session='postgresql://postgres.eyaoahwzixqetjgfghsh:fake@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
    Case 'session pooler requires explicit opt in' { Throws { ConvertFrom-RecipeGenieDatabaseUrl $session $ref } 'explicit' }
    Case 'explicit session pooler accepted' { Must ((ConvertFrom-RecipeGenieDatabaseUrl $session $ref -AllowSessionPooler).EndpointType -eq 'session-pooler') }
    Case 'transaction pooler rejected' { Throws { ConvertFrom-RecipeGenieDatabaseUrl ($session.Replace(':5432/',':6543/')) $ref -AllowSessionPooler } 'Transaction-pooler' }

    Case 'valid explicit Git executable resolves' { Must ((Resolve-GitExecutable) -eq $gitExecutable) }
    Case 'explicit Git executable path is used' {
        $result = Invoke-GitCapture $gitExecutable @('--version')
        Must ($result.ExitCode -eq 0 -and $result.Output -match '^git version')
    }
    Case 'missing Git fails closed' { Throws { Resolve-GitExecutable { param($name,$type) @() } } 'could not be resolved' }
    Case 'Git alias is rejected' {
        Throws { Resolve-GitExecutable { param($name,$type) if($name -eq 'git.exe'){[pscustomobject]@{CommandType='Application';Source=$gitExecutable}}else{[pscustomobject]@{CommandType='Alias';Source=''}} } } 'shadowed'
    }
    Case 'Git function is rejected' {
        Throws { Resolve-GitExecutable { param($name,$type) if($name -eq 'git.exe'){[pscustomobject]@{CommandType='Application';Source=$gitExecutable}}else{[pscustomobject]@{CommandType='Function';Source=''}} } } 'shadowed'
    }
    Case 'non-application git.exe result is rejected' {
        Throws { Resolve-GitExecutable { param($name,$type) [pscustomobject]@{CommandType='ExternalScript';Source=$gitExecutable} } } 'application executables|shadowed'
    }
    Case 'ambiguous Git executables are rejected' {
        Throws { Resolve-GitExecutable { param($name,$type) if($name -eq 'git.exe'){@([pscustomobject]@{CommandType='Application';Source=$gitExecutable},[pscustomobject]@{CommandType='Application';Source=$pwsh})}else{@([pscustomobject]@{CommandType='Application';Source=$gitExecutable},[pscustomobject]@{CommandType='Application';Source=$pwsh})} } } 'ambiguous'
    }
    Case 'Git executable path containing spaces works' {
        Must ($gitExecutable -match '\s')
        $resolved=Resolve-GitExecutable {param($name,$type)[pscustomobject]@{CommandType='Application';Source=$gitExecutable}}
        Must ($resolved -eq $gitExecutable)
        $result=Invoke-GitCapture $resolved @('--version');Must ($result.ExitCode -eq 0)
    }
    Case 'command-name Git invocation is absent from production tooling' {
        foreach($file in @('RecipeGenieBackup.Common.ps1','Backup-RecipeGenieProduction.ps1','Assert-RecipeGenieMigrationBackup.ps1')) {
            $text=[IO.File]::ReadAllText((Join-Path $root $file))
            Must ($text -notmatch '(?m)^\s*&?\s*git(?:\.exe)?\s')
            Must ($text -notmatch 'FileName\s*=\s*["'']git(?:\.exe)?["'']')
        }
    }

    $direct=ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@db.eyaoahwzixqetjgfghsh.supabase.co/postgres' $ref
    $sessionConnection=ConvertFrom-RecipeGenieDatabaseUrl $session $ref -AllowSessionPooler
    $goodInvoker={param($uri,$token,$timeout) ApiResponse 200 (ProjectJson)}
    Case 'Management API matching direct project passes' { $m=Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 $goodInvoker;Must ($m.DatabaseHostMatched -and $m.ProjectStatus -eq 'ACTIVE_HEALTHY') }
    Case 'Management API matching session pooler passes' { $m=Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $sessionConnection 10 $goodInvoker;Must ($m.EndpointType -eq 'session-pooler') }
    Case 'Management API wrong returned ref fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 (ProjectJson 'aaaaaaaaaaaaaaaaaaaa')} } 'reference' }
    Case 'Management API endpoint ref conflict fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 (ProjectJson 'bbbbbbbbbbbbbbbbbbbb')} } 'reference' }
    Case 'Management API inactive project fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 (ProjectJson $ref 'INACTIVE')} } 'status' }
    Case 'Management API missing status fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 '{"ref":"eyaoahwzixqetjgfghsh","database":{"host":"db.eyaoahwzixqetjgfghsh.supabase.co"}}'} } 'malformed|missing' }
    Case 'Management API missing database host fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 '{"ref":"eyaoahwzixqetjgfghsh","status":"ACTIVE_HEALTHY","database":{}}'} } 'malformed|host' }
    Case 'Management API internally inconsistent database host fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 (ProjectJson $ref 'ACTIVE_HEALTHY' 'db.aaaaaaaaaaaaaaaaaaaa.supabase.co')} } 'inconsistent' }
    Case 'Management API direct configured-host mismatch fails' {
        $bad=[pscustomobject]@{Host='db.aaaaaaaaaaaaaaaaaaaa.supabase.co';User='postgres';EndpointType='direct'}
        Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $bad 10 $goodInvoker } 'does not match'
    }
    Case 'Management API session pooler mismatch fails' {
        $bad=[pscustomobject]@{Host='aws-1-us-east-1.pooler.supabase.com';User='postgres.aaaaaaaaaaaaaaaaaaaa';EndpointType='session-pooler'}
        Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $bad 10 $goodInvoker } 'does not identify'
    }
    Case 'Management API unrecognized session pooler host fails' {
        $bad=[pscustomobject]@{Host='pooler.example.test';User="postgres.$ref";EndpointType='session-pooler'}
        Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $bad 10 $goodInvoker } 'does not identify'
    }
    Case 'Management API malformed JSON fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 '{'} } 'malformed' }
    Case 'Management API duplicate JSON field fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 '{"ref":"eyaoahwzixqetjgfghsh","ref":"eyaoahwzixqetjgfghsh","status":"ACTIVE_HEALTHY","database":{"host":"db.eyaoahwzixqetjgfghsh.supabase.co"}}'} } 'ambiguous' }
    Case 'Management API case-ambiguous JSON field fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 200 '{"ref":"eyaoahwzixqetjgfghsh","Ref":"eyaoahwzixqetjgfghsh","status":"ACTIVE_HEALTHY","database":{"host":"db.eyaoahwzixqetjgfghsh.supabase.co"}}'} } 'ambiguous' }
    foreach($httpStatus in @(401,403,404,429,500)) { Case "Management API HTTP $httpStatus fails" { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse $httpStatus '{}'} } "HTTP status $httpStatus" } }
    Case 'Management API timeout fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 1 {param($u,$t,$s)throw 'timeout with safe-test-token'} } 'failed or timed out' }
    Case 'Management API unexpected redirect fails' { Throws { Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($u,$t,$s)ApiResponse 302 '' 'https://evil.example/'} } 'redirect' }
    Case 'Management API token absent fails' { Throws { Invoke-SupabaseProjectMetadata '' $ref $direct 10 $goodInvoker } 'token is required' }
    Case 'Management API token is redacted from exception' {
        $token='management-api-test-secret-never-echo';try{Invoke-SupabaseProjectMetadata $token $ref $direct 10 {param($u,$t,$s)throw "failure $t"};throw 'expected'}catch{Must ($_.Exception.Message -notmatch [regex]::Escape($token))}
    }
    Case 'Management API token is redacted from logs' {
        $token='management-api-test-secret-never-log';$path=Join-Path $temp 'api-error.log';Write-SanitizedFile $path "failure $token" @($token);Must (([IO.File]::ReadAllText($path)) -notmatch [regex]::Escape($token))
    }
    Case 'Management API full response is not persisted' {
        $before=@(Get-ChildItem $temp -Recurse -File).Count;$null=Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 $goodInvoker;$after=@(Get-ChildItem $temp -Recurse -File).Count;Must ($before -eq $after)
    }
    Case 'Management API request is fixed read-only TLS endpoint' {
        $observed=$null;$null=Invoke-SupabaseProjectMetadata 'safe-test-token' $ref $direct 10 {param($uri,$token,$timeout)$script:observed=$uri;ApiResponse 200 (ProjectJson)}
        Must ($script:observed.Scheme -eq 'https' -and $script:observed.Host -eq 'api.supabase.com' -and $script:observed.AbsolutePath -eq "/v1/projects/$ref")
    }

    $secretCases=@(
        @('complete URL','postgresql://postgres:plainSecret@db.eyaoahwzixqetjgfghsh.supabase.co/postgres',@('plainSecret'),'plainSecret|postgresql://'),
        @('URL encoded password','password=p%40ss%20word',@('p@ss word'),'p%40ss%20word'),
        @('service role key','service_role_abcdefghijklmnopqrstuvwxyz',@(),'service_role_abcdefghijklmnopqrstuvwxyz'),
        @('JWT','eyJabcdefghijk.eyJabcdefghijkl.mnopqrstuvwxyz',@(),'eyJabcdefghijk'),
        @('temporary CLI credential','cli_login_postgres.project=password123',@(),'password123')
    )
    foreach($item in $secretCases) {
        Case "$($item[0]) redacted" { Must ((Protect-RecipeGenieSecret $item[1] $item[2]) -notmatch $item[3]) }
    }

    Case 'native stderr with zero exit succeeds' {
        $native=Join-Path $temp 'zero.ps1';[IO.File]::WriteAllText($native,"[Console]::Error.WriteLine('progress');exit 0")
        $r=Invoke-RecipeGenieNativeProcess $pwsh @('-NoProfile','-File',$native) (Join-Path $temp 'z.out') (Join-Path $temp 'z.err')
        Assert-NativeExitCode $r 'test'; Must ((Get-Content (Join-Path $temp 'z.err') -Raw) -match 'progress')
    }
    Case 'native stderr with nonzero exit fails' {
        $native=Join-Path $temp 'fail.ps1';[IO.File]::WriteAllText($native,"[Console]::Error.WriteLine('failure');exit 7")
        $r=Invoke-RecipeGenieNativeProcess $pwsh @('-NoProfile','-File',$native) (Join-Path $temp 'f.out') (Join-Path $temp 'f.err')
        Throws { Assert-NativeExitCode $r 'test' } 'exit code 7'
    }
    Case 'native credential output is sanitized before persistence' {
        $secret='raw-secret-never-on-disk';$native=Join-Path $temp 'secret.ps1'
        [IO.File]::WriteAllText($native,"[Console]::Error.WriteLine('password=$secret');exit 9")
        $out=Join-Path $temp 'secret.out';$err=Join-Path $temp 'secret.err'
        $r=Invoke-RecipeGenieNativeProcess $pwsh @('-NoProfile','-File',$native) $out $err @($secret)
        Must ($r.ExitCode -eq 9);Must (([IO.File]::ReadAllText($err)) -notmatch [regex]::Escape($secret))
        Must (@(Get-ChildItem $temp -File -Filter '*.tmp').Count -eq 0)
    }
    Case 'missing native exit code fails closed' { Throws { Assert-NativeExitCode ([pscustomobject]@{x=1}) 'test' } 'did not provide' }
    Case 'archive list command failure fails' { Throws { Assert-NativeExitCode ([pscustomobject]@{ExitCode=2}) 'pg_restore --list' } 'exit code 2' }
    Case 'TOC markers require ledger table and function' {
        $toc=@('1; TABLE public recipes postgres','2; TABLE DATA supabase_migrations schema_migrations postgres','3; FUNCTION public delete_recipe(uuid) postgres') -join [Environment]::NewLine
        $m=Test-ArchiveTableOfContents $toc; Must ($m.MigrationLedgerFound -and $m.ExpectedApplicationMarkersFound)
    }
    Case 'migration 012 preflight is read-only and rolls back' {
        $sql = [IO.File]::ReadAllText((Join-Path $repo $preflightPath))
        Must ($sql -match '(?im)^begin transaction read only;\s*$'); Must ($sql -match '(?im)^rollback;\s*$')
    }
    Case 'migration 012 preflight requires exact 001 through 011 ledger' {
        $sql = [IO.File]::ReadAllText((Join-Path $repo $preflightPath))
        Must ($sql -match "'001','002','003','004','005','006','007','008','009','010','011'")
        Must ($sql -match 'actual_versions is distinct from expected_versions')
    }
    Case 'migration 012 preflight fails on every active planner orphan class' {
        $sql = [IO.File]::ReadAllText((Join-Path $repo $preflightPath))
        foreach($message in @('unresolved weekly recipe membership','unresolved weekly assignment key','unresolved weekly made-recipe reference')) { Must ($sql -match $message) }
    }
    Case 'migration 012 preflight incorporates count-only repository audits' {
        $sql = [IO.File]::ReadAllText((Join-Path $repo $preflightPath))
        Must ($sql -match 'stage2a_uuid_reference_audit\.sql'); Must ($sql -match 'active_planner_reference_audit\.sql')
    }

    Case 'valid fixture passes' { Must ((Verify (Fixture 'valid')).ExitCode -eq 0) }
    Case 'missing archive fails' { $d=Fixture 'missing';Remove-Item (Join-Path $d 'database.dump');Must ((Verify $d).ExitCode -ne 0) }
    Case 'zero byte archive fails' { $d=Fixture 'zero';[IO.File]::WriteAllBytes((Join-Path $d 'database.dump'),[byte[]]@());Must ((Verify $d).ExitCode -ne 0) }
    Case 'size mismatch fails' { $d=Fixture 'size';Edit $d {param($m)$m.artifacts[0].sizeBytes=99};Must ((Verify $d).ExitCode -ne 0) }
    Case 'hash mismatch fails' { $d=Fixture 'hash';Edit $d {param($m)$m.artifacts[0].sha256='0'*64};Must ((Verify $d).ExitCode -ne 0) }
    Case 'stale backup fails' { $d=Fixture 'stale';Edit $d {param($m)$m.createdAtUtc=[DateTimeOffset]::UtcNow.AddHours(-2).ToString('o')};Must ((Verify $d).ExitCode -ne 0) }
    Case 'malformed manifest fails' { $d=Fixture 'badjson';[IO.File]::WriteAllText((Join-Path $d 'manifest.json'),'{');Must ((Verify $d).ExitCode -ne 0) }
    Case 'unsupported schema fails' { $d=Fixture 'schema';Edit $d {param($m)$m.schemaVersion=99};Must ((Verify $d).ExitCode -ne 0) }
    Case 'old manifest without control-plane evidence fails' { $d=Fixture 'schema-v2';Edit $d {param($m)$m.schemaVersion=2;$m.PSObject.Properties.Remove('identityVerification')};Must ((Verify $d).ExitCode -ne 0) }
    Case 'unbound migration commit fails' { $d=Fixture 'unbound';Edit $d {param($m)$m.migration.commitSha='0'*40};Must ((Verify $d).ExitCode -ne 0) }
    Case 'unverified identity fails' { $d=Fixture 'identity';Edit $d {param($m)$m.identityVerification.verified=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'missing control-plane project-ref match fails' { $d=Fixture 'cp-ref';Edit $d {param($m)$m.identityVerification.controlPlaneProjectReferenceMatched=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'control-plane host mismatch fails' { $d=Fixture 'cp-host';Edit $d {param($m)$m.identityVerification.controlPlaneDatabaseHostMatched=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'unacceptable control-plane status fails' { $d=Fixture 'cp-status';Edit $d {param($m)$m.identityVerification.controlPlaneProjectStatus='INACTIVE'};Must ((Verify $d).ExitCode -ne 0) }
    Case 'missing repository linked-ref match fails' { $d=Fixture 'linked-ref';Edit $d {param($m)$m.identityVerification.repositoryLinkedReferenceMatched=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'control-plane success plus connected-schema failure fails' { $d=Fixture 'schema-fail';Edit $d {param($m)$m.identityVerification.applicationMarkersFound=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'connected-schema success plus control-plane failure fails' { $d=Fixture 'control-fail';Edit $d {param($m)$m.identityVerification.controlPlaneProjectReferenceMatched=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'connected database evidence is required' { $d=Fixture 'db-evidence';Edit $d {param($m)$m.identityVerification.connectedDatabase=$null};Must ((Verify $d).ExitCode -ne 0) }
    Case 'ambiguous backup scope fails' { $d=Fixture 'scope';Edit $d {param($m)$m.backupScope.includesStorageObjectPayloads=$true};Must ((Verify $d).ExitCode -ne 0) }
    Case 'unsupported recorded runtime fails' { $d=Fixture 'runtime';Edit $d {param($m)$m.runtime.version='7.3.9'};Must ((Verify $d).ExitCode -ne 0) }
    Case 'wrong fixture project fails' { Must ((Verify (Fixture 'wrongref') 'aaaaaaaaaaaaaaaaaaaa').ExitCode -ne 0) }
    Case 'missing ledger marker fails' { $d=Fixture 'ledger';Edit $d {param($m)$m.archiveContents.migrationLedgerFound=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'missing application markers fail' { $d=Fixture 'markers';Edit $d {param($m)$m.archiveContents.expectedApplicationMarkersFound=$false};Must ((Verify $d).ExitCode -ne 0) }
    Case 'failed artifact rejected' { $d=Fixture 'failed';Edit $d {param($m)$m.backupStatus='failed'};Must ((Verify $d).ExitCode -ne 0) }
    Case 'quarantined artifact rejected' { Must ((Verify (Fixture 'quarantined-backup')).ExitCode -ne 0) }
    Case 'credential failure output does not echo secret' {
        $d=Fixture 'secret';[IO.File]::WriteAllText((Join-Path $d 'summary.txt'),'postgresql://postgres:do-not-echo@example.test/postgres')
        $r=Verify $d;Must ($r.ExitCode -ne 0);Must ($r.Output -notmatch 'do-not-echo')
    }
    Case 'manifest contains no credential material' { $d=Fixture 'manifest-secret-free';$text=[IO.File]::ReadAllText((Join-Path $d 'manifest.json'));Must (-not (Test-RecipeGenieSensitiveText $text)) }
    Case 'archive validation distinct from restore verification' { $r=Verify (Fixture 'restore-distinct');Must ($r.ExitCode -eq 0 -and $r.Output -match 'Disposable restore: not verified') }
    Case 'database backup distinct from Storage backup' { $r=Verify (Fixture 'storage-distinct');Must ($r.ExitCode -eq 0 -and $r.Output -match 'Storage files: not backed up') }
    Case 'dump success leaves restore and Storage false' { $d=Fixture 'states';$m=Get-Content (Join-Path $d 'manifest.json') -Raw|ConvertFrom-Json;Must ($m.dumpCompleted -and -not $m.restoreVerified -and -not $m.storageFilesBackedUp) }
    Case 'migration 012 gate requires restore without opt-in flag' { Must ((Gate (Fixture 'migration-012')).ExitCode -ne 0) }
    Case 'restore gate fails when false' { Must ((Gate (Fixture 'restore-false') @('-RequireRestoreVerification')).ExitCode -ne 0) }
    Case 'restore gate passes only when true' { $d=Fixture 'restore-true';Edit $d {param($m)$m.restoreVerified=$true;$m.restoreVerification=[pscustomobject]@{verifiedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}};Must ((Gate $d @('-RequireRestoreVerification')).ExitCode -eq 0) }
    Case 'Storage gate fails when false' { Must ((Gate (Fixture 'storage-false') @('-RequireStorageBackup')).ExitCode -ne 0) }
    Case 'Storage gate passes only when true' { $d=Fixture 'storage-true';Edit $d {param($m)$m.storageFilesBackedUp=$true;$m.restoreVerified=$true;$m.restoreVerification=[pscustomobject]@{verifiedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}};Must ((Gate $d @('-RequireStorageBackup')).ExitCode -eq 0) }
    Case 'migration gate never invokes migrations' { Must ((Get-Content (Join-Path $root 'Assert-RecipeGenieMigrationBackup.ps1') -Raw) -notmatch '(?i)\bsupabase(?:\.exe)?\s+(?:db|migration)|\bdb\s+push\b') }
    Case 'Management API write methods are absent' { $text=Get-Content (Join-Path $root 'RecipeGenieBackup.Common.ps1') -Raw;Must ($text -notmatch 'HttpMethod\]::(?:Post|Put|Patch|Delete)|Invoke-RestMethod.+-Method\s+(?:Post|Put|Patch|Delete)') }
    Case 'backup tooling constructs no migration command' {
        $text=Get-Content (Join-Path $root 'Backup-RecipeGenieProduction.ps1') -Raw
        Must ($text -notmatch '(?i)\bsupabase(?:\.exe)?\s+(?:db|migration)|\bdb\s+push\b')
        Must ($text -notmatch '(?im)^.*Invoke-RecipeGenieNativeProcess.*MigrationPath.*$')
        Must ($text -match '(?s)\$identitySql\s*=\s*@"\s*select\s+current_database\(\).*?"@')
    }
    Case 'missing token prevents production database and API access' {
        $oldUrl=$env:RECIPE_GENIE_PRODUCTION_DATABASE_URL;$oldRef=$env:RECIPE_GENIE_PRODUCTION_PROJECT_REF;$oldToken=$env:RECIPE_GENIE_SUPABASE_ACCESS_TOKEN
        try{$env:RECIPE_GENIE_PRODUCTION_DATABASE_URL='postgresql://postgres:fake@db.eyaoahwzixqetjgfghsh.supabase.co/postgres';$env:RECIPE_GENIE_PRODUCTION_PROJECT_REF=$ref;$env:RECIPE_GENIE_SUPABASE_ACCESS_TOKEN='';$d=Join-Path $temp 'must-not-connect';$r=Child (Join-Path $root 'Backup-RecipeGenieProduction.ps1') @('-DestinationRoot',('"'+$d+'"'));Must ($r.ExitCode -ne 0 -and -not (Test-Path $d))}finally{$env:RECIPE_GENIE_PRODUCTION_DATABASE_URL=$oldUrl;$env:RECIPE_GENIE_PRODUCTION_PROJECT_REF=$oldRef;$env:RECIPE_GENIE_SUPABASE_ACCESS_TOKEN=$oldToken}
    }
    Case '.gitignore excludes backup artifacts and tracked env secrets' {
        foreach($path in @('probe.dump','recipe-genie-production-probe/database.dump','scripts/database/backups/probe.dump','.env.production.local')) {
            $result=Invoke-GitCapture $gitExecutable @('-C',$repo,'check-ignore','--no-index','--quiet',$path);Must ($result.ExitCode -eq 0) "not ignored: $path"
        }
    }
    Case 'tracked-artifact scan is clean' {
        $result=Invoke-GitCapture $gitExecutable @('-C',$repo,'ls-files');Must ($result.ExitCode -eq 0)
        Must (-not (@($result.Output -split '\r?\n') | Where-Object { $_ -match '(?i)(^|/)(?:recipe-genie-production-|backups/)|\.(?:dump|backup)$|(^|/)\.env(?:$|\.local$|\.(?:development|test|production)\.local$|\.e2e\.local$)' }))
    }
    Case 'no backup output inside repository' { Must (@(Get-ChildItem $repo -Recurse -Directory -Filter 'recipe-genie-production-*').Count -eq 0) }
} finally {
    if(Test-Path $temp){Remove-Item -LiteralPath $temp -Recurse -Force}
}
"RESULT: $passed passed, $failed failed"
if($failed){exit 1}
