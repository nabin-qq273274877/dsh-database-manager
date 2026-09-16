# Install dsh-database-manager into a dsh web profile, then restart that
# profile's service and verify the plugin is live.
#
# Why this script exists: `pnpm install` inside a profile is a blunt instrument.
# It re-resolves the whole dependency tree, and a `file:` dependency on a local
# checkout interacts badly with that -- on 2026-09-15 a profile install left the
# plugin half-registered and the desktop dsh failed to boot. What this script
# does instead is the *minimal* mutation that the loader actually needs:
#
#   1. a directory link (junction) at <profile>/node_modules/<plugin-name>
#   2. the plugin name appended to <profile>/package.json dsh.profile.bundles
#
# No package manager runs, so nothing else in the profile's dependency tree can
# be disturbed. The plugin's own dependencies (mysql2, ioredis) resolve from the
# plugin directory's node_modules, which is exactly where its package.json
# declares them.
#
# Usage:
#   pwsh -File install-into-profile.ps1 -DshHome 'C:\Users\Lenovo\.dsh'
#   pwsh -File install-into-profile.ps1 -DshHome $env:DSH_HOME -Port 3080
#
# Every step is idempotent: re-running re-uses the existing link and does not
# duplicate the bundles entry.
#
# NOTE: the parameter is -DshHome, not -Home: $Home is a read-only PowerShell
# built-in and cannot be used as a parameter name.

param(
  [Parameter(Mandatory = $true)][string]$DshHome,
  [string]$Profile = 'web',
  [string]$PluginName = 'dsh-database-manager',
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
  # When set, the service currently listening on this port is restarted and
  # re-verified. Omit to install only.
  [int]$Port = 0,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'

function Say([string]$Message) { Write-Host $Message }

# --- 0. resolve the profile --------------------------------------------------
$profileDir = Join-Path $DshHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) { throw "profile directory not found: $profileDir" }
$packageJson = Join-Path $profileDir 'package.json'
if (-not (Test-Path $packageJson)) { throw "profile package.json not found: $packageJson" }
$projectDir = (Resolve-Path $ProjectDir).Path
if (-not (Test-Path (Join-Path $projectDir 'lib\index.js'))) {
  throw "built host half missing: $(Join-Path $projectDir 'lib\index.js') -- run 'npm run build' first"
}

Say "profile:  $profileDir"
Say "plugin:   $projectDir"

# --- 1. back up the profile config ------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($name in 'package.json', 'cordis.patch.yml') {
  $src = Join-Path $profileDir $name
  if (Test-Path $src) {
    Copy-Item $src "$src.bak-dbm-$stamp" -Force
    Say "backed up $name -> $name.bak-dbm-$stamp"
  }
}

# --- 2. link the plugin into the profile ------------------------------------
$linkPath = Join-Path $profileDir "node_modules\$PluginName"
if (Test-Path $linkPath) {
  $existing = Get-Item $linkPath -Force
  if ($existing.LinkType -and $existing.Target -and ($existing.Target -contains $projectDir -or $existing.Target -eq $projectDir)) {
    Say "link already points at the project; reusing it"
  } else {
    Say "replacing existing entry at $linkPath"
    Remove-Item $linkPath -Recurse -Force
  }
}
if (-not (Test-Path $linkPath)) {
  # A junction needs no elevation on Windows and behaves like a real directory
  # to Node's resolver. A symlink would need Developer Mode or admin rights.
  & cmd.exe /c mklink /J "$linkPath" "$projectDir" | Out-Null
  if (-not (Test-Path $linkPath)) { throw "failed to create the junction at $linkPath" }
  Say "linked node_modules\$PluginName -> $projectDir"
}

# --- 3. register the bundle -------------------------------------------------
$json = Get-Content $packageJson -Raw -Encoding utf8 | ConvertFrom-Json
if (-not $json.dsh) { throw "profile package.json has no dsh section" }
if (-not $json.dsh.profile) { throw "profile package.json has no dsh.profile section" }

$bundles = @($json.dsh.profile.bundles)
if ($bundles -contains $PluginName) {
  Say "bundles already lists $PluginName"
} else {
  $json.dsh.profile.bundles = @($bundles + $PluginName)
  # Preserve the file's own formatting conventions: two-space indent, LF.
  $text = $json | ConvertTo-Json -Depth 32
  $text = $text -replace "`r`n", "`n"
  Set-Content -Path $packageJson -Value $text -Encoding utf8 -NoNewline
  Add-Content -Path $packageJson -Value "`n" -Encoding utf8
  Say "added $PluginName to dsh.profile.bundles"
}

# --- 4. static verification -------------------------------------------------
# `--dump-config` composes the whole loader tree without booting the server. A
# plugin that cannot be resolved shows up here as an error, which makes this the
# cheapest possible guard against installing a profile that will not start.
$dshBin = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx') -Recurse -Filter 'bin.js' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like "*@deepseek-ai\dsh\lib\bin.js" } |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $dshBin) { throw 'dsh bin.js not found in the npx cache; cannot verify' }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node not found on PATH' }

Say "verifying the composed loader tree ..."
$env:DSH_HOME = $DshHome
$dump = & $node $dshBin --profile $Profile --dump-config 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "dsh --dump-config failed (exit $LASTEXITCODE):`n$dump" }
if ($dump -notmatch [regex]::Escape("name: $PluginName")) {
  throw "--dump-config succeeded but the plugin row is absent; the bundles entry did not take"
}
Say "loader tree contains the plugin row"

# --- 5. restart the service, if asked ---------------------------------------
if ($NoRestart -or $Port -eq 0) {
  Say ''
  Say "install complete. Restart the dsh web service to load the plugin."
  exit 0
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
  Say "nothing is listening on $Port; start the service yourself"
  exit 0
}
$oldPid = $listener.OwningProcess
Say "stopping the service on $Port (pid $oldPid) ..."

# taskkill /T also walks the child tree. It can exit non-zero when one child is
# protected while the root still dies, so the port is the real success signal.
& taskkill.exe /PID $oldPid /T /F 2>&1 | ForEach-Object { Say "  $_" }
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 400
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "port $Port is still held after the stop; refusing to start a second instance"
}
Say "port $Port released"

# Clear DSH_HOME so the replacement resolves the same home by default instead of
# inheriting whatever home this script was launched from.
$env:DSH_HOME = $null
Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue

$logDir = Join-Path $env:TEMP 'dsh-dbm-restart'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "port-$Port.out"
$err = Join-Path $logDir "port-$Port.err"
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

Say "starting: node $dshBin web --port $Port --no-open"
$proc = Start-Process -FilePath $node `
  -ArgumentList @($dshBin, 'web', '--port', "$Port", '--no-open') `
  -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $out -RedirectStandardError $err

$deadline = (Get-Date).AddSeconds(120)
$up = $false
while ((Get-Date) -lt $deadline) {
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { $up = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $up) {
  Say "service did not come up; stderr:"
  Get-Content $err -Raw -ErrorAction SilentlyContinue | ForEach-Object { Say $_ }
  throw "the service failed to listen on $Port"
}
Say "service is listening on $Port (pid $($proc.Id))"
Say "logs: $out / $err"

# --- 6. runtime verification ------------------------------------------------
$base = "http://127.0.0.1:$Port"
function Probe([string]$Label, [string]$Url) {
  try {
    $response = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 25
    Say "$Label -> HTTP $($response.StatusCode)"
    return $response
  } catch {
    $code = if ($null -ne $_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'n/a' }
    Say "$Label -> HTTP $code"
    return $null
  }
}

$sources = Probe 'host routes' "$base/api/dsh-database/sources"
if ($null -ne $sources -and $sources.Content -like '*allowAgentWrite*') {
  Say '  plugin host half is mounted'
} else {
  Say '  WARNING: the host half did not answer the expected payload'
}

$engines = Probe 'engine availability' "$base/api/dsh-database/engines"
if ($null -ne $engines) { Say "  $($engines.Content)" }

Say ''
Say "done. The browser half loads with the page; open $base and look for the 「数据库管理」 sidebar entry."
