[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$PythonExe,
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'CosmeticsRank\queue-collector.json')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskName = 'Cosmetics Rank Queue Collector'

if (-not $PythonExe) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if ($env:COSMETICS_RANK_PYTHON) {
        $PythonExe = $env:COSMETICS_RANK_PYTHON
    } elseif (Test-Path -LiteralPath $bundledPython -PathType Leaf) {
        $PythonExe = $bundledPython
    } else {
        $PythonExe = (Get-Command python.exe -CommandType Application).Source
    }
}

$PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
$pythonw = Join-Path (Split-Path -Parent $PythonExe) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw -PathType Leaf)) {
    throw 'Select a Python installation with both python.exe and pythonw.exe using -PythonExe.'
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Configure the queue collector first. Configuration file not found: $ConfigPath"
}
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path

$privatePackages = Join-Path $repoRoot '.local-browser\python-deps'
$previousPythonPath = $env:PYTHONPATH
try {
    if (Test-Path -LiteralPath $privatePackages -PathType Container) {
        $env:PYTHONPATH = (@($privatePackages, $previousPythonPath) | Where-Object { $_ }) -join [IO.Path]::PathSeparator
    }
    & $PythonExe -c 'import sys; assert sys.version_info >= (3, 10); import selenium'
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.10+ with Selenium is required. Install dependencies with: & '$PythonExe' -m pip install --target '$privatePackages' -r '$repoRoot\scripts\requirements-selenium.txt'"
    }
} finally {
    $env:PYTHONPATH = $previousPythonPath
}

$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$launcher = Join-Path $PSScriptRoot 'queue-collector-launch.pyw'
$arguments = '"{0}" "{1}" --config "{2}"' -f $launcher, $PythonExe, $ConfigPath

if ($PSCmdlet.ShouldProcess($taskName, 'Register queue collector')) {
    $action = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments -WorkingDirectory $repoRoot
    $periodic = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Hours 6) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($periodic, $logon) `
        -Principal $principal -Settings $settings -Description 'Poll the Cloudflare queue and collect rankings.' -Force | Out-Null

    Write-Output "Registered: $taskName (polls every minute while signed in)"
    Write-Output "Log: $(Join-Path (Split-Path -Parent $ConfigPath) 'queue-collector.log')"
}
