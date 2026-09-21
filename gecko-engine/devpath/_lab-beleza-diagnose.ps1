# Browse Beleza no lab + tap WSL no 4100 em paralelo → replay
$ErrorActionPreference = "Stop"
$Repo = "c:\RPJ\Coding\Projects\Seven\Websete\Websete Speculum"
$env:WAIT_AFTER_NAV_MS = "90000"
$tap = Start-Job -ScriptBlock {
  wsl -d Ubuntu -- bash '/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/devpath/_capture-tap4100.sh'
}
Start-Sleep -Seconds 3
node "$Repo\gecko-engine\devpath\lab-capture-replay.mjs" "https://www.belezanaweb.com.br/"
$tap | Wait-Job | Receive-Job
node "$Repo\gecko-engine\devpath\projected-replay.mjs" "$Repo\gecko-engine\devpath\captures" 2>$null
