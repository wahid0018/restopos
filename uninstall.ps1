param([string]$Dir = 'C:\RestoPOS')
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Dir `"$Dir`""; exit }
Stop-ScheduledTask -TaskName 'RestoPOS' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'RestoPOS' -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName 'RestoPOS' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$Dir*server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$d = [Environment]::GetFolderPath('CommonDesktopDirectory'); Remove-Item "$d\RestoPOS.lnk","$d\RestoPOS - Uninstall.lnk" -ErrorAction SilentlyContinue
$k = Read-Host 'Also delete restaurant DATA (orders, bills, settings)? Type DELETE to confirm, Enter to keep data'
if ($k -eq 'DELETE') { Set-Location C:\; Remove-Item $Dir -Recurse -Force }
else { Get-ChildItem $Dir -Force | Where-Object { $_.Name -notin 'data','clients' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "Data kept in $Dir\data and $Dir\clients" }
Read-Host 'Uninstalled. Press Enter'
