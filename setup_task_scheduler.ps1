# setup_task_scheduler.ps1 - Automate Macro Dashboard Data Refresh
# Registers a Windows Scheduled Task to update macro data automatically 3 times a day (9:00 AM, 1:00 PM, 6:00 PM).

$TaskName = "MacroDashboard_AutoRefresh"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonPath = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
$ScriptPath = Join-Path $ScriptDir "fetch_data.py"

if (-not $PythonPath) {
    Write-Error "Python executable could not be located in your system PATH. Please ensure Python is installed."
    Exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Setting up Windows Task Scheduler for Macro Dashboard" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Working Directory : $ScriptDir"
Write-Host "Python Path       : $PythonPath"
Write-Host "Script            : $ScriptPath"
Write-Host ""

# Unregister previous task if exists
$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) {
    Write-Host "Removing existing task '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create Scheduled Action (runs minimized/hidden)
$Action = New-ScheduledTaskAction -Execute $PythonPath -Argument "`"$ScriptPath`"" -WorkingDirectory $ScriptDir

# Create Triggers: 9:00 AM, 1:00 PM, 6:00 PM every day
$Trigger1 = New-ScheduledTaskTrigger -Daily -At "09:00AM"
$Trigger2 = New-ScheduledTaskTrigger -Daily -At "01:00PM"
$Trigger3 = New-ScheduledTaskTrigger -Daily -At "06:00PM"

# Settings: run only when network is available, don't stop on battery
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RunOnlyIfNetworkAvailable -StartWhenAvailable

# Register Task under current user
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($Trigger1, $Trigger2, $Trigger3) -Settings $Settings -Description "Automatically refreshes Macroeconomic Dashboard indicators from official sources."

Write-Host ""
Write-Host "[SUCCESS] Task '$TaskName' registered successfully in Windows Task Scheduler!" -ForegroundColor Green
Write-Host "It will run daily at 9:00 AM, 1:00 PM, and 6:00 PM." -ForegroundColor Green
Write-Host "You can also run update_dashboard.bat anytime for an immediate update." -ForegroundColor Cyan
