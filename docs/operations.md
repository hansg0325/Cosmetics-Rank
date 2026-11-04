# 실행과 운영

## 로컬

README 빠른 시작을 따릅니다. `.dev.vars.example`은 형식 예시이고 `pnpm setup:local`은 무작위 토큰을 생성합니다. 기존 토큰은 덮어쓰지 않습니다. `wrangler dev --ip 127.0.0.1`로 외부 인터페이스에 바인딩하지 않습니다. Wrangler 로컬 Explorer는 개발 환경에서 D1을 직접 조작할 수 있으므로 로컬 포트를 인터넷에 노출하지 마세요.

`pnpm db:migrate`는 로컬 DB에만 적용합니다. 마이그레이션은 Wrangler가 적용 이력을 관리합니다. 테스트는 별도 임시 D1에서 실행합니다. 제공 샘플은 가상 데이터입니다.

## 무료 계정 배포 준비 — 이번 작업에서 실행하지 않음

1. Cloudflare Workers Free / D1 Free / Zero Trust Access Free 계정에서 시작합니다. 유료 플랜이나 카드 등록을 요구하는 기능을 추가하지 않습니다.
2. `pnpm exec wrangler login`으로 계정 로그인, `pnpm exec wrangler d1 create olive-rank`로 DB 생성 후 반환 ID를 `wrangler.jsonc`의 database_id에 설정합니다. 현재 0으로 채운 ID는 로컬 전용 자리표시자입니다.
3. Cloudflare Workers 대시보드에서 해당 Worker에 Worker-level Cloudflare Access 보호를 설정합니다. 본인 이메일만 허용하고 workers.dev 및 preview 경로까지 보호되는지 확인합니다. 설정 전에 실데이터를 업로드하지 마세요. 계정 UI 흐름상 Worker 생성이 먼저 필요하면 기본 인증 거부 상태로만 빈 Worker를 생성하고 Access를 먼저 설정합니다.
4. `ACCESS_TEAM`(팀 슬러그), `ACCESS_AUD`(Access application audience), `ALLOWED_EMAIL`(본인 이메일)을 Worker 환경변수/secret으로 설정합니다. 로컬 토큰을 원격 secret으로 등록하지 마세요. 현재 기본값은 빈 문자열이므로 원격은 401로 닫힙니다.
5. `pnpm exec wrangler d1 migrations apply olive-rank --remote`, `pnpm build`, `pnpm exec wrangler deploy`. 실제 URL은 해당 계정에서 생성됩니다. 이번 작업에서는 계정 로그인·원격 DB 생성·배포를 하지 않았습니다.
6. 로그아웃/시크릿 브라우저, 다른 사용자, JWT 누락/변조, preview URL, 정적 JS/CSV 직접 URL을 각각 확인합니다. 모두 본인만 접근하도록 설정한 후 데이터를 사용합니다. 로컬 mock 테스트는 배포 Access 정책 검증을 대신하지 않습니다.

## 무료 한도와 측정

[D1 공식 한도](https://developers.cloudflare.com/d1/platform/limits/) 기준 Free DB당 500MB, 계정 5GB, 호출당 50쿼리, 문장당 100바인딩을 설계 상한으로 둡니다. 읽기/쓰기 일일 할당량과 Workers 요청/CPU는 [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)에서 배포 시 재확인합니다. 월 0원 목표이며 한도 초과 시 중단될 수 있습니다. 자동 유료 전환을 설정하지 마세요.

Workers 대시보드에서 업로드/완료/JWT 인증 경로의 CPU p50/p95/p99를 실제로 측정하세요. 10ms 예산에 가까우면 청크 크기/쿼리를 줄여야 합니다. 로컬 검증 결과에 원격 CPU 수치를 대신 기록하지 않습니다. D1 로그의 rows_read/rows_written와 DB 저장 크기를 매월 점검하고 300~400MB에서 아카이브 계획을 수립합니다. 자동 경보·장기 보관·연도별 DB 분리는 아직 구현하지 않았습니다.

## 백업과 데이터 공급

실데이터 변경 전 `pnpm exec wrangler d1 export olive-rank --remote --output=backup.sql`로 로컬 백업합니다. 월 1회 오프라인 백업을 권장하며 backup 파일은 Git에서 제외합니다. D1 Free Time Travel의 보존기간은 [공식 한도](https://developers.cloudflare.com/d1/platform/limits/)에서 확인합니다. 로컬 데이터 복원도 별도 환경에서 검증한 후 원격에 적용하세요.

자동 수집 허가는 확인하지 않았습니다. 크롤러, 우회, CAPTCHA 처리, Cron은 없습니다. 현재 상태는 `DISABLED_NO_APPROVED_SOURCE`이며 수동 CSV/XLSX와 가상 샘플만 사용합니다.
