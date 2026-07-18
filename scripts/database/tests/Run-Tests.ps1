Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'RecipeGenieBackup.Common.ps1')
$ref = 'eyaoahwzixqetjgfghsh'
$pwsh = (Get-Process -Id $PID).Path
$repo = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$headCommit = (git -C $repo rev-parse HEAD).Trim()
$migrationPath = 'supabase/migrations/012_enforce_uuid_active_recipe_writes.sql'
$preflightPath = 'scripts/database/preflight/012_enforce_uuid_active_recipe_writes.sql'
$migrationHash = Get-GitBlobSha256 $repo $headCommit $migrationPath
$preflightHash = Get-GitBlobSha256 $repo $headCommit $preflightPath
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
        schemaVersion=2; appName='Recipe Genie'; environment='production'; projectReference=$ref
        createdAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
        gitCommitSha=$headCommit;gitWorktreeClean=$true
        runtime=[ordered]@{edition='Core';version='7.4.0';architecture='Arm64'}
        connectedIdentity=[ordered]@{linkedProjectReference=$ref;endpointAndLinkCorroborated=$true;databaseSchemaCorroborated=$true;migrationLedgerVersions=@('001','002','003','004','005','006','007','008','009','010','011')}
        migration=[ordered]@{path=$migrationPath;commitSha=$headCommit;sha256=$migrationHash;worktreeMatchesCommit=$true}
        preflight=[ordered]@{path=$preflightPath;commitSha=$headCommit;sha256=$preflightHash;readOnly=$true;countOnly=$true;worktreeMatchesCommit=$true}
        backupScope=[ordered]@{type='logical-database-custom-archive';includedSchemas=@('public','private','supabase_migrations');includesStorageObjectPayloads=$false;includesSupabaseManagedAuthConfiguration=$false;includesGlobalRoles=$false;includesSecrets=$false}
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

try {
    $registeredWorktrees = Get-RegisteredGitWorktreePaths $repo
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
    Case 'wrong project reference fails' { Throws { ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@db.aaaaaaaaaaaaaaaaaaaa.supabase.co/postgres' $ref } 'does not identify' }
    Case 'ambiguous identity fails closed' { Throws { ConvertFrom-RecipeGenieDatabaseUrl 'postgresql://postgres:fake@example.test/postgres' $ref } 'does not identify' }
    $session='postgresql://postgres.eyaoahwzixqetjgfghsh:fake@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
    Case 'session pooler requires explicit opt in' { Throws { ConvertFrom-RecipeGenieDatabaseUrl $session $ref } 'explicit' }
    Case 'explicit session pooler accepted' { Must ((ConvertFrom-RecipeGenieDatabaseUrl $session $ref -AllowSessionPooler).EndpointType -eq 'session-pooler') }
    Case 'transaction pooler rejected' { Throws { ConvertFrom-RecipeGenieDatabaseUrl ($session.Replace(':5432/',':6543/')) $ref -AllowSessionPooler } 'Transaction-pooler' }

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
    Case 'unbound migration commit fails' { $d=Fixture 'unbound';Edit $d {param($m)$m.migration.commitSha='0'*40};Must ((Verify $d).ExitCode -ne 0) }
    Case 'uncorroborated connected database fails' { $d=Fixture 'identity';Edit $d {param($m)$m.connectedIdentity.databaseSchemaCorroborated=$false};Must ((Verify $d).ExitCode -ne 0) }
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
    Case 'archive validation distinct from restore verification' { $r=Verify (Fixture 'restore-distinct');Must ($r.ExitCode -eq 0 -and $r.Output -match 'Disposable restore: not verified') }
    Case 'database backup distinct from Storage backup' { $r=Verify (Fixture 'storage-distinct');Must ($r.ExitCode -eq 0 -and $r.Output -match 'Storage files: not backed up') }
    Case 'dump success leaves restore and Storage false' { $d=Fixture 'states';$m=Get-Content (Join-Path $d 'manifest.json') -Raw|ConvertFrom-Json;Must ($m.dumpCompleted -and -not $m.restoreVerified -and -not $m.storageFilesBackedUp) }
    Case 'migration 012 gate requires restore without opt-in flag' { Must ((Gate (Fixture 'migration-012')).ExitCode -ne 0) }
    Case 'restore gate fails when false' { Must ((Gate (Fixture 'restore-false') @('-RequireRestoreVerification')).ExitCode -ne 0) }
    Case 'restore gate passes only when true' { $d=Fixture 'restore-true';Edit $d {param($m)$m.restoreVerified=$true;$m.restoreVerification=[pscustomobject]@{verifiedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}};Must ((Gate $d @('-RequireRestoreVerification')).ExitCode -eq 0) }
    Case 'Storage gate fails when false' { Must ((Gate (Fixture 'storage-false') @('-RequireStorageBackup')).ExitCode -ne 0) }
    Case 'Storage gate passes only when true' { $d=Fixture 'storage-true';Edit $d {param($m)$m.storageFilesBackedUp=$true;$m.restoreVerified=$true;$m.restoreVerification=[pscustomobject]@{verifiedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}};Must ((Gate $d @('-RequireStorageBackup')).ExitCode -eq 0) }
    Case 'migration gate never invokes migrations' { Must ((Get-Content (Join-Path $root 'Assert-RecipeGenieMigrationBackup.ps1') -Raw) -notmatch '(?i)\bsupabase(?:\.exe)?\s+(?:db|migration)|\bdb\s+push\b') }
    Case 'no backup output inside repository' { Must (@(Get-ChildItem $repo -Recurse -Directory -Filter 'recipe-genie-production-*').Count -eq 0) }
} finally {
    if(Test-Path $temp){Remove-Item -LiteralPath $temp -Recurse -Force}
}
"RESULT: $passed passed, $failed failed"
if($failed){exit 1}
