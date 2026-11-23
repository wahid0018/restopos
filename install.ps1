# RestoPOS installer for Windows (run via install.bat). Installs to C:\RestoPOS, opens the firewall,
# starts the server automatically at boot (hidden, auto-restart) and creates desktop shortcuts.
param([string]$Client = '', [int]$Port = 3000, [string]$Dir = 'C:\RestoPOS')
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Client `"$Client`" -Port $Port -Dir `"$Dir`""; exit
}
$src = Split-Path -Parent $PSCommandPath
Write-Host "`n=== RestoPOS installer ===`n"

# 1. Node.js
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host 'Node.js not found - installing (needs internet)...'
  try { winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements | Out-Null } catch {}
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node -and (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { $node = "$env:ProgramFiles\nodejs\node.exe" }
  if (-not $node) { Start-Process 'https://nodejs.org'; throw 'Install Node.js LTS from nodejs.org, then run this installer again.' }
}
Write-Host "Node.js: $node"

$ver = [int]((& $node -v).TrimStart('v').Split('.')[0])
if ($ver -lt 18) {
  Write-Host "Node.js $ver is too old (need 18+) - upgrading..."
  try { winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --force | Out-Null } catch {}
  $n2 = "$env:ProgramFiles\nodejs\node.exe"
  if (Test-Path $n2) { $node = $n2; $ver = [int]((& $node -v).TrimStart('v').Split('.')[0]) }
  if ($ver -lt 18) { Start-Process 'https://nodejs.org'; throw 'Please uninstall the old Node.js, install Node.js LTS from nodejs.org, then run this installer again.' }
}

# 2. Options
if (-not $PSBoundParameters.ContainsKey('Client')) { $c = Read-Host 'Client / restaurant folder name (Enter = default)'; if ($c) { $Client = ($c.ToLower() -replace '[^a-z0-9_-]','') } }
if (-not $PSBoundParameters.ContainsKey('Port'))   { $p = Read-Host 'Port (Enter = 3000)'; if ($p -match '^\d+$') { $Port = [int]$p } }

# 3. Stop old copy, copy files (never touch data / clients on upgrade)
Stop-ScheduledTask -TaskName 'RestoPOS' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$Dir*server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
robocopy $src $Dir /E /XD data clients node_modules .git /XF install.ps1.log /NFL /NDL /NJH /NJS /NP | Out-Null
if (-not (Test-Path "$Dir\data") -and -not $Client) { New-Item -ItemType Directory -Force -Path "$Dir\data" | Out-Null }
if ($Client) {
  $cd = "$Dir\clients\$Client"; New-Item -ItemType Directory -Force -Path "$cd\backups" | Out-Null
  if (-not (Test-Path "$cd\config.json")) { (@{ name = $Client; port = $Port; cloud = $null } | ConvertTo-Json) | Set-Content "$cd\config.json" -Encoding UTF8 }
}
$argsText = 'server.js --port ' + $Port; if ($Client) { $argsText += " --client $Client" }

# 4. Firewall (private networks) 
Remove-NetFirewallRule -DisplayName 'RestoPOS' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'RestoPOS' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null

# 5. Start at boot, hidden, restart on failure
Unregister-ScheduledTask -TaskName 'RestoPOS' -Confirm:$false -ErrorAction SilentlyContinue
$act = New-ScheduledTaskAction -Execute $node -Argument $argsText -WorkingDirectory $Dir
$trg = New-ScheduledTaskTrigger -AtStartup
$set = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'RestoPOS' -Action $act -Trigger $trg -Settings $set -User 'SYSTEM' -RunLevel Highest | Out-Null
Start-ScheduledTask -TaskName 'RestoPOS'

# 6. Shortcuts
$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('CommonDesktopDirectory')
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$s = $ws.CreateShortcut("$desk\RestoPOS.lnk")
if ($chrome) { $s.TargetPath = $chrome; $s.Arguments = "--kiosk-printing --app=http://localhost:$Port" } else { $s.TargetPath = "http://localhost:$Port" }
$s.Save()
$u = $ws.CreateShortcut("$desk\RestoPOS - Uninstall.lnk"); $u.TargetPath = "$Dir\uninstall.bat"; $u.Save()

Start-Sleep 2
$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))' }).IPAddress
Write-Host "`nInstalled in $Dir and running (starts automatically with Windows)."
Write-Host "This computer : http://localhost:$Port"
foreach ($i in $ips) { Write-Host "Tablets/phones: http://${i}:$Port   <- open on the restaurant Wi-Fi" }
Write-Host "`nA 'RestoPOS' shortcut is on the desktop (opens Chrome full-screen with silent printing; set your printer as Windows default)."
Read-Host "`nPress Enter to close"
