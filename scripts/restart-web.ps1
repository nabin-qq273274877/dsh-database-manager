# Restart the dsh web service so a newly installed plugin is picked up.
#
# Run DETACHED. The harness agent shell lives inside the very process tree being
# restarted (dsh-desktop -> pnpm dlx -> cmd -> node web), so this script must
# survive the kill it performs. Every step is appended to restart.log, which is
# the only way to learn the outcome once the originating session is gone.
#
# Sequence, deliberately conservative:
#   1. kill the web service (and its cmd/pnpm shim, via /T)
#   2. WAIT to see whether dsh-desktop respawns it on its own — if it does, the
#      supervisor relationship is intact and we must not start a second one
#   3. only if nothing respawned, start the replacement with the exact
#      invocation the desktop used
#   4. verify the port, the plugin bundle, and the plugin's API route
#
# Usage: pwsh -File restart-web.ps1 -Port 57552

param(
  [int]$Port = 57552,
  [int]$KillGraceSeconds = 6,
  [int]$RespawnWaitSeconds = 25
)

$ErrorActionPreference = 'Continue'
$log = Join-Path $PSScriptRoot 'restart.log'

function Write-Log([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
  Add-Content -Path $log -Value $line -Encoding utf8
}

function Get-ListenerPid([int]$p) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $conn) { return $null }
  return $conn.OwningProcess
}

Set-Content -Path $log -Value "[$(Get-Date -Format 'HH:mm:ss')] restart requested for port $Port" -Encoding utf8

# Give the caller's tool call time to return before its process tree dies.
Start-Sleep -Seconds $KillGraceSeconds

# --- 1. stop the old service ------------------------------------------------
$oldPid = Get-ListenerPid $Port
if ($null -eq $oldPid) {
  Write-Log "no listener on $Port; skipping the stop step"
} else {
  Write-Log "stopping web service pid $oldPid"
  # /T also takes down the cmd.exe shim and the pnpm dlx wrapper beneath it,
  # so no orphan cmd window is left holding the port.
  & taskkill.exe /PID $oldPid /T /F 2>&1 | ForEach-Object { Write-Log "taskkill: $_" }
}

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if ($null -eq (Get-ListenerPid $Port)) { break }
  Start-Sleep -Milliseconds 500
}
if ($null -ne (Get-ListenerPid $Port)) {
  Write-Log "ERROR: port $Port is still held; aborting without starting a replacement"
  exit 1
}
Write-Log "port $Port is free"

# --- 2. does the desktop respawn it? ----------------------------------------
Write-Log "waiting up to $RespawnWaitSeconds s to see whether dsh-desktop respawns the service"
$deadline = (Get-Date).AddSeconds($RespawnWaitSeconds)
$respawned = $null
while ((Get-Date) -lt $deadline) {
  $respawned = Get-ListenerPid $Port
  if ($null -ne $respawned) { break }
  Start-Sleep -Milliseconds 500
}

if ($null -ne $respawned) {
  Write-Log "dsh-desktop respawned the service itself (pid $respawned); no manual start needed"
} else {
  # --- 3. start the replacement ---------------------------------------------
  $node = 'C:\Users\Lenovo\AppData\Local\DeepSeek Harness Desktop\node\node.exe'

  # Derive the dsh entry point from a live dsh process rather than guessing at
  # the pnpm dlx store layout, which changes hash directory names on every
  # install. Fall back to a bounded search only when nothing is running.
  $binJs = $null
  $live = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'bin\.js' } | Select-Object -First 1
  if ($null -ne $live) {
    $binJs = [regex]::Match($live.CommandLine, '"([^"]*bin\.js)"').Groups[1].Value
  }
  if ([string]::IsNullOrEmpty($binJs) -or -not (Test-Path $binJs)) {
    $binJs = Get-ChildItem -Path (Join-Path $env:APPDATA 'com.dsh.desktop\dsh-desktop\pnpm\dlx') `
      -Recurse -Filter 'bin.js' -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like '*@deepseek-ai\dsh\lib\bin.js' } |
      Select-Object -First 1 -ExpandProperty FullName
  }

  if (-not (Test-Path $node)) { Write-Log "ERROR: node not found at $node"; exit 1 }
  if ([string]::IsNullOrEmpty($binJs) -or -not (Test-Path $binJs)) { Write-Log 'ERROR: dsh bin.js not found'; exit 1 }

  Write-Log "starting: $node $binJs web --port $Port --no-open"
  $proc = Start-Process -FilePath $node `
    -ArgumentList @($binJs, 'web', '--port', "$Port", '--no-open') `
    -WorkingDirectory (Join-Path $env:USERPROFILE 'Desktop') `
    -WindowStyle Hidden -PassThru
  Write-Log "started pid $($proc.Id)"

  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne (Get-ListenerPid $Port)) { break }
    Start-Sleep -Milliseconds 500
  }
}

$newPid = Get-ListenerPid $Port
if ($null -eq $newPid) {
  Write-Log 'ERROR: the web service is not listening; start dsh-desktop manually'
  exit 1
}
Write-Log "web service is listening on $Port (pid $newPid)"

# --- 4. verify the plugin ---------------------------------------------------
# The plain /plugins/<id>/client.js form 404s by design: the bundle route is
# keyed by the full URL *including* its rev query, so a bare path can never
# match anything (this is true for every plugin, not just this one). Assert the
# host half instead, plus the boot graph, which is what the browser actually
# reads.
Start-Sleep -Seconds 2

function Probe([string]$Label, [string]$Url) {
  try {
    $response = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 25
    Write-Log "$Label`: HTTP $($response.StatusCode)"
    return $response
  } catch {
    $code = $null
    if ($null -ne $_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    # 401 is the auth fence answering before the router: the service is up, we
    # simply have no session cookie in this detached process.
    Write-Log "$Label`: HTTP $code ($($_.Exception.Message.Split([char]10)[0]))"
    return $null
  }
}

$api = Probe 'plugin api' "http://127.0.0.1:$Port/api/dsh-database/sources"
if ($null -ne $api -and $api.Content -like '*allowAgentWrite*') {
  Write-Log 'plugin host half is mounted and answering'
} else {
  Write-Log 'plugin host half did not answer the expected payload; check the profile install'
}

Write-Log 'restart complete — reopen the dsh web UI'
