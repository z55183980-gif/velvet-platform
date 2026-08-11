# DramaBox home SOCKS reverse tunnel → production (starnexus-s4)
#
# On this Windows PC (VN residential IP):
#   1. Ensures local SOCKS5 on 127.0.0.1:18080
#   2. Reverse-forwards it to s4 as 127.0.0.1:18080
# Keep this window open while importing VIP DramaBox episodes.
#
# Prod should have:
#   DRAMABOX_HTTPS_PROXY=socks5h://127.0.0.1:18080
# then: pm2 restart velvet-api --update-env

$ErrorActionPreference = 'Stop'
$Port = if ($env:DRAMABOX_HOME_SOCKS_PORT) { [int]$env:DRAMABOX_HOME_SOCKS_PORT } else { 18080 }
$RepoRoot = Split-Path -Parent $PSScriptRoot
$SocksJs = Join-Path $PSScriptRoot 'dramabox-home-socks.mjs'
$Remote = if ($env:DRAMABOX_TUNNEL_HOST) { $env:DRAMABOX_TUNNEL_HOST } else { 'starnexus-s4' }

if (-not (Test-Path $SocksJs)) {
  throw "Missing $SocksJs"
}

$env:DRAMABOX_HOME_SOCKS_PORT = "$Port"
Write-Host "[tunnel] starting local SOCKS on 127.0.0.1:$Port"
$socks = Start-Process -PassThru -NoNewWindow -FilePath 'node' -ArgumentList @($SocksJs) `
  -WorkingDirectory $RepoRoot

try {
  Start-Sleep -Seconds 1
  if ($socks.HasExited) {
    throw "SOCKS process exited early (code $($socks.ExitCode))"
  }

  Write-Host "[tunnel] ssh -R 127.0.0.1:$Port:127.0.0.1:$Port $Remote"
  Write-Host "[tunnel] keep this window open; Ctrl+C to stop"
  ssh -o ExitOnForwardFailure=yes `
    -o ServerAliveInterval=30 `
    -o ServerAliveCountMax=3 `
    -N -R "127.0.0.1:${Port}:127.0.0.1:${Port}" `
    $Remote
}
finally {
  if ($socks -and -not $socks.HasExited) {
    Stop-Process -Id $socks.Id -Force -ErrorAction SilentlyContinue
  }
}
