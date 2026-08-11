# DramaBox home app-layer relay → production (starnexus-s4)
#
# SOCKS CONNECT is NOT enough: Akamai JA3-blocks datacenter curl even when the
# TCP egress IP is residential. This script:
#   1. Runs scripts/dramabox-home-relay.mjs on 127.0.0.1:18080
#   2. Reverse-forwards it to s4 via ssh -R
# Keep this window open while VIP imports run.
#
# Prod:
#   DRAMABOX_API_RELAY=http://127.0.0.1:18080
#   DRAMABOX_RELAY_SECRET=<same as local>
#   # prefer clearing DRAMABOX_HTTPS_PROXY while using the relay
#   pm2 restart velvet-api --update-env

$ErrorActionPreference = 'Stop'
$Port = if ($env:DRAMABOX_HOME_RELAY_PORT) { [int]$env:DRAMABOX_HOME_RELAY_PORT } else { 18080 }
$RepoRoot = Split-Path -Parent $PSScriptRoot
$RelayJs = Join-Path $PSScriptRoot 'dramabox-home-relay.mjs'
$Remote = if ($env:DRAMABOX_TUNNEL_HOST) { $env:DRAMABOX_TUNNEL_HOST } else { 'starnexus-s4' }

if (-not $env:DRAMABOX_RELAY_SECRET) {
  # Stable local default; prod must match. Override via env for stronger secret.
  $env:DRAMABOX_RELAY_SECRET = 'velvet-dramabox-home-relay'
}

if (-not (Test-Path $RelayJs)) {
  throw "Missing $RelayJs"
}

$env:DRAMABOX_HOME_RELAY_PORT = "$Port"
Write-Host "[relay] starting home relay on 127.0.0.1:$Port"
$relay = Start-Process -PassThru -NoNewWindow -FilePath 'node' -ArgumentList @($RelayJs) `
  -WorkingDirectory $RepoRoot

try {
  Start-Sleep -Seconds 1
  if ($relay.HasExited) {
    throw "Relay process exited early (code $($relay.ExitCode))"
  }

  Write-Host "[relay] ssh -R 127.0.0.1:$Port:127.0.0.1:$Port $Remote"
  Write-Host "[relay] keep this window open; Ctrl+C to stop"
  ssh -o ExitOnForwardFailure=yes `
    -o ServerAliveInterval=30 `
    -o ServerAliveCountMax=3 `
    -N -R "127.0.0.1:${Port}:127.0.0.1:${Port}" `
    $Remote
}
finally {
  if ($relay -and -not $relay.HasExited) {
    Stop-Process -Id $relay.Id -Force -ErrorAction SilentlyContinue
  }
}
