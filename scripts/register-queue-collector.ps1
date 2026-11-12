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
$now = Get-Date
$firstPoll = $now.Date.AddHours(5).AddMinutes(55)
if ($firstPoll -le $now) {
    $firstPoll = $firstPoll.AddDays(1)
}
$startBoundary = $firstPoll.ToString("yyyy-MM-dd'T'HH:mm:ss")
$xmlUserId = [Security.SecurityElement]::Escape($userId)
$xmlPythonw = [Security.SecurityElement]::Escape($pythonw)
$xmlArguments = [Security.SecurityElement]::Escape($arguments)
$xmlWorkingDirectory = [Security.SecurityElement]::Escape($repoRoot)
$xmlDescription = [Security.SecurityElement]::Escape('Poll the Cloudflare queue from 05:55 to 06:30 local time.')
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>$xmlDescription</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1M</Interval>
        <Duration>PT35M</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="CollectorUser">
      <UserId>$xmlUserId</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT6H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="CollectorUser">
    <Exec>
      <Command>$xmlPythonw</Command>
      <Arguments>$xmlArguments</Arguments>
      <WorkingDirectory>$xmlWorkingDirectory</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

if ($PSCmdlet.ShouldProcess($taskName, 'Register queue collector')) {
    Register-ScheduledTask -TaskName $taskName -Xml $taskXml -Force | Out-Null

    Write-Output "Registered: $taskName (polls every minute from 05:55 through 06:30 local time)"
    Write-Output "Log: $(Join-Path (Split-Path -Parent $ConfigPath) 'queue-collector.log')"
}
