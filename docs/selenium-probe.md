# 첨부 리뷰 수집 코드를 참고한 Selenium 상품 수집 테스트

2026-11-04 15:01:43 KST 기준 최종 실행 결과입니다. 앱 버튼·Worker·D1에는 연결하지 않고 독립 진단 스크립트만 구현했습니다.

## 결과

| 대상 | 최종 확인 시간 | 결과 |
| --- | --- | --- |
| 전체 랭킹 | 13.9초 | 실제 100개, 1~100 연속 순위·상품 ID 100개 고유 검증 성공 |
| 상품 상세 | 12.2초 | 에스트라 상품 1개 ID·브랜드·상품명·링크 추출 성공 |

전체 랭킹은 첫 실행에서도 14.7초 만에 100개를 읽었고, 최종 재실행에서도 성공했습니다. 첫 상세 페이지 테스트는 정상 페이지에 도달했으나 첨부 코드의 예전 XPath와 DOM 선택자가 맞지 않아 필드 추출에 실패했습니다. 실제 DOM을 확인해 현재 상품명 `h3[class*="GoodsDetailInfo_title__"]`, 브랜드 버튼 `[class*="GoodsDetailInfo_goods-info"] button[class*="TopUtils_btn-brand__"]`를 추가한 뒤 성공했습니다. CSS 모듈 해시 전체는 고정하지 않았습니다.

추출 항목은 순위(랭킹만), 상품 ID, 브랜드, 상품명, 상품 링크입니다. 가격·이미지·리뷰는 추출하지 않았고, DB에 쓰지 않았습니다. 결과 파일의 모든 상품 행에 허용 항목 외 필드가 없는지도 별도로 검사했습니다.

## 재현한 설정

- Selenium 4.52.0 / 실제 설치된 Chrome 156.0.8078.80
- 첨부 코드처럼 `--headless`, `--no-sandbox`, Chrome 58 User-Agent 문자열 사용
- 페이지 접속 후 10초 고정 대기. 불완전하면 같은 페이지에서 DOM을 최대 20초 더 관찰
- 새 임시 브라우저 프로필 사용. 개인 브라우저 쿠키나 이전 인증 프로필을 복사하지 않음
- ChromeDriver 준비는 `webdriver_manager` 대신 Selenium Manager 사용
- 최초 페이지 이동 전에 30초 로딩 제한 적용(첨부 코드에서 호출 순서 수정)
- CAPTCHA 클릭·수동 인증·별도 CAPTCHA 서비스·프록시·무한 재요청 없음
- 두 대상 페이지를 각각 별도의 브라우저에서 확인하고 반드시 종료

이 구성 전체에서 성공한 사실을 확인했습니다. 이전 기본 Selenium 테스트와 달리 이번에는 오래된 User-Agent와 `--no-sandbox` 등 여러 조건을 함께 재현했으므로 어느 하나가 결정적인 원인이라고 확정할 수 없습니다. 실행 시점의 사이트 상태도 달랐을 수 있습니다. 반복·예약·장기 운영, GitHub Actions 환경은 이번에 검증하지 않았습니다.

## 파일

- `scripts/probe-selenium.py`: 독립 실행 진단 스크립트. 결과에 실패가 있으면 종료 코드 2, 두 대상 모두 성공하면 0.
- `scripts/requirements-selenium.txt`: 테스트 버전 의존성.
- `data/selenium-reference-probe.json`: 최종 성공 결과 및 실제 상품 100개+상세 1개. `data/`는 Git에서 제외.
- `data/selenium-product-inspection.json`: 상세 페이지의 옛 선택자가 실패했던 중간 진단 기록. 최종 성공 기록과 구분.

## 같은 PC에서 다시 실행

PowerShell에서 프로젝트 폴더를 열고 실행합니다. 테스트용 패키지는 프로젝트·앱의 Python 환경과 분리된 임시 폴더에 설치합니다.

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m pip install --target "$env:TEMP\cosmetics-rank-selenium-test" -r scripts/requirements-selenium.txt
$env:PYTHONPATH = Join-Path $env:TEMP 'cosmetics-rank-selenium-test'
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -u -X utf8 scripts/probe-selenium.py --chrome-binary 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

`--target overall` 또는 `--target product`로 한 대상만 검사할 수 있습니다. `--output`으로 결과 JSON 경로를 지정할 수 있습니다. 출력 파일은 진단 형식이므로 앱의 브라우저 캡처 JSON과 다른 형식입니다. 이번 작업에서는 실제 DB 기록이나 기존 앱의 수집 버튼 동작을 변경하지 않았습니다.
