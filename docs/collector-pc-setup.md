# Windows 수집 PC 설정

운영 Cloudflare는 매일 한국 시간 오전 6시와 관리자 수동 요청 때 같은 큐에 작업을 넣습니다. 수집 PC는 Windows 로그인 상태에서 매일 오전 5시 55분부터 6시 30분까지 1분마다 큐를 확인합니다. 작업을 받으면 GitHub `main`을 내려받아 전체 랭킹을 수집하고 운영 D1에 저장합니다. 확인 시간 밖에 관리자 화면에서 넣은 작업은 다음 날 오전 5시 55분 이후 처리됩니다. Windows 표준 시간대가 `Korea Standard Time`인지 확인하세요.

## 수집 PC의 Codex에 붙여넣을 요청

> 이 Windows PC를 Cosmetics Rank 수집 전용 PC로 설정해줘. GitHub의 `hansg0325/Cosmetics-Rank` 저장소에 있는 `docs/collector-pc-setup.md` 순서대로 진행해줘. 기존 운영 Cloudflare 큐에 연결해줘. 비밀값은 내가 직접 PowerShell에서 입력할 수 있도록 명령을 알려주고, 입력이 끝나면 작업 스케줄러 등록과 검증을 이어서 해줘.

## 1. 실행 환경 준비

수집에 사용할 Windows 계정으로 로그인합니다. Git for Windows, Google Chrome, Python 3.10 이상을 준비합니다. Python 3.12를 사용할 수 있으며, 선택한 `python.exe`와 같은 폴더에 `pythonw.exe`도 필요합니다.

장기간 유지할 폴더에 저장소를 내려받습니다. 이미 복제본이 있다면 해당 폴더에서 `main`으로 전환하고 `git pull --ff-only origin main`을 실행합니다. 예약 작업이 이 폴더의 시작 파일을 참조합니다.

```powershell
git clone https://github.com/hansg0325/Cosmetics-Rank.git
Set-Location .\Cosmetics-Rank
```

저장소 최상위 폴더에서 Python을 확인하고 수집 의존성을 설치합니다. Python이 여러 개 설치돼 있다면 `$collectorPython`에 사용할 실행 파일의 전체 경로를 넣습니다.

```powershell
$collectorPython = (Get-Command python.exe -CommandType Application).Source
& $collectorPython --version
Test-Path -LiteralPath (Join-Path (Split-Path -Parent $collectorPython) 'pythonw.exe')
& $collectorPython -m pip install --target '.local-browser\python-deps' -r 'scripts\requirements-selenium.txt'
```

## 2. 기존 운영 큐 연결

운영 Cloudflare의 **Account ID**와 **`cosmetics-rank-collection` 큐의 Queue ID**를 운영 계정 관리자에게 받습니다. 기존 큐와 예약을 사용합니다. 운영 계정 관리자에게 다음 비밀값 네 개도 준비해 달라고 요청합니다.

| 입력 항목 | 받을 값 |
| --- | --- |
| `CLOUDFLARE_QUEUES_TOKEN` | 운영 계정 범위의 `Queues: Edit` API 토큰 |
| `COLLECTION_API_KEY` | 운영 Worker에 설정된 수집 업로드 API 키 |
| `CF_ACCESS_CLIENT_ID` | 업로드를 허용한 Cloudflare Access 서비스 토큰의 Client ID |
| `CF_ACCESS_CLIENT_SECRET` | 같은 서비스 토큰의 Client Secret |

사용자가 직접 연 PowerShell에서 저장소 최상위 폴더로 이동해 다음 명령을 실행합니다. 새 창이면 1단계의 `$collectorPython`을 다시 설정합니다. 비밀값은 Codex 채팅이나 명령행 인수에 넣지 말고, 스크립트가 표시하는 숨김 입력란에 직접 입력합니다.

```powershell
$collectorAccountId = Read-Host '운영 Cloudflare Account ID'
$collectorQueueId = Read-Host '운영 cosmetics-rank-collection Queue ID'
& $collectorPython .\scripts\queue-collection.py --configure --account-id $collectorAccountId --queue-id $collectorQueueId
```

성공하면 `%LOCALAPPDATA%\CosmeticsRank\queue-collector.json`에 설정이 암호화돼 저장됩니다. 이 PC의 같은 Windows 계정으로 작업을 등록합니다. 다른 PC의 설정 파일을 가져왔다면 이 단계에서 비밀값을 다시 입력합니다.

## 3. Windows 작업 등록

같은 Windows 계정과 저장소 폴더에서 실행합니다. Windows 표준 시간대는 `Korea Standard Time`으로 맞춥니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-queue-collector.ps1 -PythonExe $collectorPython
Get-ScheduledTask -TaskName 'Cosmetics Rank Queue Collector' |
    Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName 'Cosmetics Rank Queue Collector' |
    Select-Object LastRunTime, LastTaskResult, NextRunTime
```

이미 수집기가 설정된 PC에서 스케줄을 갱신할 때도 저장소에서 `git pull --ff-only origin main`을 실행한 뒤 이 등록 명령을 다시 실행합니다. 기존 작업의 시간표가 새 설정으로 교체됩니다.

PC가 켜져 있고 등록한 Windows 계정이 로그인되어 있어야 합니다. 화면 잠금 상태에서도 실행됩니다.

## 4. 확인과 업데이트

- 예약 작업은 매일 05:55~06:30에 1분 간격으로 큐를 확인합니다. 그 시간 밖에 관리자 화면에서 요청한 수집은 다음 날 창이 열릴 때 처리됩니다. 예약 작업의 최근 실행 시각을 확인합니다. `LastTaskResult`가 `0`이어도 큐가 비어 있었을 수 있습니다. 실제 수집 성공은 운영 관리자 화면에서 **최근 수집 이력**을 열어 10개 카테고리 결과가 새로 저장됐는지 확인합니다. 시험하려면 관리자 화면의 **데이터 수집**을 05:55~06:30 사이에 한 번 누릅니다.
- 수집이 실패하면 `%LOCALAPPDATA%\CosmeticsRank\queue-collector.log`를 확인합니다. 전체 수집과 업로드가 성공하면 실행 로그는 정리됩니다.
- 실행할 수집 코드는 작업을 받을 때마다 `%LOCALAPPDATA%\CosmeticsRank\collector-source`에 갱신됩니다. 예약 작업의 시작 파일과 큐 확인 코드는 1단계의 저장소 폴더에서 `git pull --ff-only origin main`으로 갱신합니다.
