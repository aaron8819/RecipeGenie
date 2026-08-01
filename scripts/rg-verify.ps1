[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$NodeDistribution,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$VerificationArguments
)

$ErrorActionPreference = 'Stop'
$verifierArguments = @($VerificationArguments)
$jsonRequested = $verifierArguments -contains '--json'
$isRelease = $verifierArguments.Count -gt 0 -and $verifierArguments[0] -eq 'release'
$usage = 'rg-verify.ps1 [-NodeDistribution ABSOLUTE_PATH] focused|pr|release [verification options]'

function Write-JsonFailure([string]$Message) {
  $document = [ordered]@{
    schemaVersion = 1
    command = 'verification-launcher'
    status = 'FAIL'
    error = [ordered]@{
      code = 'LAUNCHER_RUNTIME_ERROR'
      category = 'RUNTIME'
      message = $Message
      usage = $usage
    }
  }
  [Console]::Out.WriteLine(($document | ConvertTo-Json -Depth 5))
}

function Invoke-DirectProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][Collections.IDictionary]$Environment,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.WorkingDirectory = $WorkingDirectory
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.Environment.Clear()
  foreach ($key in $Environment.Keys) {
    $start.Environment[[string]$key] = [string]$Environment[$key]
  }
  foreach ($argument in $Arguments) {
    [void]$start.ArgumentList.Add([string]$argument)
  }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'Process startup failed.' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    Stdout = $stdoutTask.GetAwaiter().GetResult()
    Stderr = $stderrTask.GetAwaiter().GetResult()
  }
}

function Get-EnvironmentValue([string]$Name) {
  foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
    if ([string]::Equals([string]$entry.Key, $Name, [StringComparison]::OrdinalIgnoreCase)) {
      return [string]$entry.Value
    }
  }
  return $null
}

function Add-ExistingPath([Collections.Generic.List[string]]$Paths, [string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path -LiteralPath $Candidate -PathType Container)) { return }
  $resolved = [IO.Path]::GetFullPath($Candidate)
  $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  if (-not $Paths.Exists({ param($item) [string]::Equals($item, $resolved, $comparison) })) {
    $Paths.Add($resolved)
  }
}

function Test-RuntimeShim([string]$Directory) {
  $names = if ($IsWindows) {
    @('node', 'node.com', 'node.exe', 'node.cmd', 'node.bat', 'node.ps1', 'npm', 'npm.com', 'npm.exe', 'npm.cmd', 'npm.bat', 'npm.ps1', 'npx', 'npx.com', 'npx.exe', 'npx.cmd', 'npx.bat', 'npx.ps1')
  } else {
    @('node', 'npm', 'npx')
  }
  return $null -ne ($names | Where-Object { Test-Path -LiteralPath (Join-Path $Directory $_) } | Select-Object -First 1)
}

try {
  if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }
  $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $webDirectory = Join-Path $repositoryRoot 'web'
  $verificationScript = Join-Path $webDirectory 'scripts\workflow\verification.mjs'
  $expectedNode = (Get-Content -LiteralPath (Join-Path $webDirectory '.nvmrc') -Raw).Trim()
  $package = Get-Content -LiteralPath (Join-Path $webDirectory 'package.json') -Raw | ConvertFrom-Json
  $expectedNpm = ([string]$package.packageManager -replace '^npm@', '')
  if ($expectedNode -ne '22.23.1' -or $expectedNpm -ne '10.9.8') { throw 'Repository runtime policy is not approved.' }

  $candidates = [Collections.Generic.List[string]]::new()
  if ($NodeDistribution) {
    if (-not [IO.Path]::IsPathFullyQualified($NodeDistribution)) { throw 'Node distribution must be an absolute path.' }
    Add-ExistingPath $candidates $NodeDistribution
  } elseif ($IsWindows) {
    Get-ChildItem -LiteralPath ([IO.Path]::GetPathRoot($PSScriptRoot)) -Directory -Filter "node-v$expectedNode-win-*" -ErrorAction SilentlyContinue |
      ForEach-Object { Add-ExistingPath $candidates $_.FullName }
    Add-ExistingPath $candidates (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'nodejs')
  } else {
    $homeDirectory = [Environment]::GetFolderPath('UserProfile')
    Add-ExistingPath $candidates (Join-Path $homeDirectory ".nvm/versions/node/v$expectedNode")
    Get-ChildItem -Path "/opt/node-v$expectedNode-*", "/usr/local/node-v$expectedNode-*" -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Add-ExistingPath $candidates $_.FullName }
    Add-ExistingPath $candidates '/usr/local'
    Add-ExistingPath $candidates '/usr'
  }
  if ($candidates.Count -eq 0) { throw 'Approved Node distribution is unavailable.' }

  $bootstrapEnvironment = [ordered]@{}
  foreach ($key in @('TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE')) {
    $value = Get-EnvironmentValue $key
    if ($null -ne $value) { $bootstrapEnvironment[$key] = $value }
  }
  if ($IsWindows) {
    $bootstrapEnvironment['SystemRoot'] = [IO.Path]::GetDirectoryName([Environment]::SystemDirectory)
    $bootstrapEnvironment['windir'] = $bootstrapEnvironment.SystemRoot
  }
  $runtime = $null
  foreach ($candidate in $candidates) {
    $nodeExecutable = if ($IsWindows) { Join-Path $candidate 'node.exe' } else { Join-Path $candidate 'bin/node' }
    $npmCli = if ($IsWindows) {
      Join-Path $candidate 'node_modules/npm/bin/npm-cli.js'
    } else {
      Join-Path $candidate 'lib/node_modules/npm/bin/npm-cli.js'
    }
    $npmManifest = Join-Path (Split-Path -Parent (Split-Path -Parent $npmCli)) 'package.json'
    if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $npmCli -PathType Leaf) -or -not (Test-Path -LiteralPath $npmManifest -PathType Leaf)) { continue }
    $manifest = Get-Content -LiteralPath $npmManifest -Raw | ConvertFrom-Json
    if ([string]$manifest.version -ne $expectedNpm) { continue }
    $nodeVersion = Invoke-DirectProcess $nodeExecutable @('--version') $bootstrapEnvironment $webDirectory
    $npmVersion = Invoke-DirectProcess $nodeExecutable @($npmCli, '--version') $bootstrapEnvironment $webDirectory
    if ($nodeVersion.ExitCode -eq 0 -and $nodeVersion.Stdout.Trim() -eq "v$expectedNode" -and $npmVersion.ExitCode -eq 0 -and $npmVersion.Stdout.Trim() -eq $expectedNpm) {
      $runtime = [pscustomobject]@{ Directory = $candidate; Node = $nodeExecutable; NpmCli = $npmCli }
      break
    }
  }
  if ($null -eq $runtime) { throw 'Approved Node and npm runtime validation failed.' }

  $localBin = Join-Path $webDirectory 'node_modules/.bin'
  if (Test-RuntimeShim $localBin) { throw 'Project-local runtime shim is not allowed.' }
  $environment = [ordered]@{}
  $platformKeys = @(
    'CI', 'COLORTERM', 'FORCE_COLOR', 'GITHUB_ACTIONS', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'NEXT_TELEMETRY_DISABLED', 'NO_COLOR', 'TEMP', 'TERM', 'TMP', 'TMPDIR', 'TZ'
  )
  if ($IsWindows) {
    $platformKeys += @(
      'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'OS',
      'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION',
      'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'SystemDrive', 'SystemRoot',
      'USERPROFILE', 'windir'
    )
  }
  foreach ($key in $platformKeys) {
    $value = Get-EnvironmentValue $key
    if ($null -ne $value) { $environment[$key] = $value }
  }
  if ($IsWindows) {
    $systemRoot = [IO.Path]::GetDirectoryName([Environment]::SystemDirectory)
    $programFiles = [Environment]::GetFolderPath('ProgramFiles')
    $trustedPowerShell = [Environment]::ProcessPath
    if (
      -not [IO.Path]::IsPathFullyQualified($systemRoot) -or
      -not [IO.Path]::IsPathFullyQualified($programFiles) -or
      -not [IO.Path]::IsPathFullyQualified($trustedPowerShell) -or
      -not (Test-Path -LiteralPath $systemRoot -PathType Container) -or
      -not (Test-Path -LiteralPath $programFiles -PathType Container) -or
      -not (Test-Path -LiteralPath $trustedPowerShell -PathType Leaf) -or
      [IO.Path]::GetFileName($trustedPowerShell) -ine 'pwsh.exe'
    ) { throw 'Trusted Windows runtime locations are unavailable.' }
    $environment['SystemRoot'] = $systemRoot
    $environment['windir'] = $environment.SystemRoot
    $environment['ProgramFiles'] = $programFiles
    $environment['RG_VERIFICATION_WINDOWS_SYSTEM_ROOT'] = $systemRoot
    $environment['RG_VERIFICATION_WINDOWS_PROGRAM_FILES'] = $programFiles
    $environment['RG_VERIFICATION_POWERSHELL'] = $trustedPowerShell
  }
  if ($isRelease) {
    foreach ($key in @('GH_TOKEN', 'GITHUB_TOKEN', 'RG_BRANCH', 'RG_EXPECTED_GIT_SHA', 'RG_EXPECTED_SUPABASE_PROJECT_REF', 'RG_PRODUCTION_URL', 'RG_REPOSITORY', 'RECIPE_GENIE_PRODUCTION_PROJECT_REF')) {
      $value = Get-EnvironmentValue $key
      if ($null -ne $value) { $environment[$key] = $value }
    }
  }

  $trustedPaths = [Collections.Generic.List[string]]::new()
  Add-ExistingPath $trustedPaths $runtime.Directory
  if (-not $IsWindows) { Add-ExistingPath $trustedPaths (Join-Path $runtime.Directory 'bin') }
  Add-ExistingPath $trustedPaths $localBin
  if ($IsWindows) {
    $systemRoot = $environment.SystemRoot
    $programFiles = $environment.ProgramFiles
    $windowsTrustedPaths = @(
      (Join-Path $systemRoot 'System32'), $systemRoot, (Join-Path $systemRoot 'System32/Wbem'),
      (Join-Path $systemRoot 'System32/WindowsPowerShell/v1.0'), (Join-Path $programFiles 'PowerShell/7'),
      (Join-Path $programFiles 'Git/cmd')
    )
    if ($isRelease) { $windowsTrustedPaths += (Join-Path $programFiles 'GitHub CLI') }
    foreach ($path in $windowsTrustedPaths) { Add-ExistingPath $trustedPaths $path }
  } else {
    foreach ($path in @('/usr/local/bin', '/usr/bin', '/bin', '/usr/local/sbin', '/usr/sbin', '/sbin')) { Add-ExistingPath $trustedPaths $path }
  }
  $pathKey = if ($IsWindows) { 'Path' } else { 'PATH' }
  $pathSeparator = [IO.Path]::PathSeparator
  $environment[$pathKey] = [string]::Join($pathSeparator, $trustedPaths)
  $shell = if ($IsWindows) { Join-Path $environment.SystemRoot 'System32/cmd.exe' } else { '/bin/sh' }
  if (-not (Test-Path -LiteralPath $shell -PathType Leaf)) { throw 'Trusted platform shell is unavailable.' }
  $environment['npm_execpath'] = $runtime.NpmCli
  $environment['npm_node_execpath'] = $runtime.Node
  $environment['npm_config_script_shell'] = $shell
  $environment['npm_config_node_options'] = ''
  $environment['npm_config_ignore_scripts'] = 'false'
  $environment['npm_config_if_present'] = 'false'
  $environment['npm_config_scripts_prepend_node_path'] = 'true'
  $environment['npm_config_userconfig'] = if ($IsWindows) { 'NUL' } else { '/dev/null' }
  $environment['npm_config_globalconfig'] = Join-Path (Split-Path -Parent (Split-Path -Parent $runtime.NpmCli)) '.npmrc'
  if ($isRelease) { $environment['npm_config_user_agent'] = "npm/$expectedNpm node/v$expectedNode" }
  if ($IsWindows) {
    $environment['ComSpec'] = $shell
    $environment['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'
  } else {
    $environment['SHELL'] = $shell
  }

  $processArguments = @($verificationScript) + $verifierArguments
  $result = Invoke-DirectProcess $runtime.Node $processArguments $environment $webDirectory
  if ($jsonRequested) {
    try {
      $json = [Text.Json.JsonDocument]::Parse($result.Stdout)
      if ($json.RootElement.ValueKind -ne [Text.Json.JsonValueKind]::Object) { throw 'JSON root is not an object.' }
      $json.Dispose()
      [Console]::Out.Write($result.Stdout)
    } catch {
      Write-JsonFailure 'Trusted verification process failed before producing one JSON document.'
      exit 1
    }
  } else {
    [Console]::Out.Write($result.Stdout)
    [Console]::Error.Write($result.Stderr)
  }
  exit $result.ExitCode
} catch {
  if ($jsonRequested) {
    Write-JsonFailure 'Trusted verification launcher could not establish the approved runtime boundary.'
  } else {
    [Console]::Error.WriteLine('Trusted verification launcher could not establish the approved runtime boundary.')
  }
  exit 1
}
