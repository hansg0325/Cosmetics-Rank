# 실행과 운영

## 로컬

README 빠른 시작을 따릅니다. `.dev.vars.example`은 형식 예시이고 `pnpm setup:local`은 무작위 토큰을 생성합니다. 기존 토큰은 덮어쓰지 않습니다. `wrangler dev --ip 127.0.0.1`로 외부 인터페이스에 바인딩하지 않습니다. Wrangler 로컬 Explorer는 개발 환경에서 D1을 직접 조작할 수 있으므로 로컬 포트를 인터넷에 노출하지 마세요.

`pnpm db:migrate`는 로컬 DB에만 적용합니다. 마이그레이션은 Wrangler가 적용 이력을 관리합니다. 테스트는 별도 임시 D1에서 실행합니다. 제공 샘플은 가상 데이터입니다.

## 공개 조회와 관리자 Access 경로

1. Cloudflare Workers Free / D1 Free / Zero Trust Access Free 계정에서 시작합니다. 유료 플랜이나 카드 등록을 요구하는 기능을 추가하지 않습니다.
2. `pnpm exec wrangler login`으로 계정에 로그인합니다. APAC 리전의 원격 D1 `cosmetics-rank`는 생성됐고 반환된 ID를 `wrangler.jsonc`에 설정했습니다. 새 Cloudflare 계정에서 다시 배포할 경우 해당 계정의 D1을 새로 만들어 ID를 교체해야 합니다.
3. Cloudflare Access에서 Worker 전체 보호는 사용하지 않습니다. 다음 경로에만 Access 앱을 둡니다.
   - `cosmetics-rank.hansg0325.workers.dev/admin` 및 `/api/admin/*`: 관리자 이메일 하나만 허용합니다.
   - `cosmetics-rank.hansg0325.workers.dev/api/imports*`: 관리자 이메일과 수집용 Service Auth 토큰을 허용합니다. Actions에는 Service Auth 자격 증명과 `COLLECTION_API_KEY`가 모두 필요합니다.
   일반 사이트와 조회 API는 로그인 없이 열고, 쓰기 API는 Worker에서 거부하는지 확인합니다. Access path 앱을 설정한 뒤 Worker-level Access 보호를 해제해야 경로별 보호가 적용됩니다.
4. `ACCESS_TEAM`(팀 슬러그), `ACCESS_AUD`(관리자 경로 Access 앱 audience), `ALLOWED_EMAIL`(관리자 이메일)을 Worker secret으로 설정합니다. `VIEWER_EMAILS`는 사용하지 않습니다. 로컬 토큰을 원격 secret으로 등록하지 마세요. `/api/admin/*`는 유효한 관리자 JWT가 없으면 거부됩니다.
5. `pnpm exec wrangler d1 migrations apply cosmetics-rank --remote`, `pnpm build`, `pnpm exec wrangler deploy` 순서로 배포합니다.
6. 시크릿 브라우저에서 루트/GET API가 로그인 없이 조회되는지, 변경 API가 거부되는지, 관리자 탭 클릭 시 Cloudflare 로그인으로 이동하는지, 비관리자 이메일은 관리자 기능에 들어갈 수 없는지, GitHub Actions Service Auth로 수집만 가능한지 확인합니다. 로컬 검증은 원격 Access 정책 검증을 대신하지 않습니다.

비로그인 사용자는 대시보드·랭킹·순위 변동·상품 이력·점유율 분석·엑셀 내보내기·성분 키워드 설정을 사용할 수 있습니다. 키워드 추가·수정·저장도 방문자에게 허용됩니다. 수집 이력과 관리자 기능은 관리자 로그인 후 사용할 수 있습니다. 로컬 개발 서버는 관리자 권한으로 동작하며 외부에 공개하지 마세요.

## 무료 한도와 측정

[D1 공식 한도](https://developers.cloudflare.com/d1/platform/limits/) 기준 Free DB당 500MB, 계정 5GB, 호출당 50쿼리, 문장당 100바인딩을 설계 상한으로 둡니다. 읽기/쓰기 일일 할당량과 Workers 요청/CPU는 [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)에서 배포 시 재확인합니다. 월 0원 목표이며 한도 초과 시 중단될 수 있습니다. 자동 유료 전환을 설정하지 마세요.

Workers 대시보드에서 업로드/완료/JWT 인증 경로의 CPU p50/p95/p99를 실제로 측정하세요. 10ms 예산에 가까우면 청크 크기/쿼리를 줄여야 합니다. 로컬 검증 결과에 원격 CPU 수치를 대신 기록하지 않습니다. D1 로그의 rows_read/rows_written와 DB 저장 크기를 매월 점검하고 300~400MB에서 아카이브 계획을 수립합니다. 자동 경보·장기 보관·연도별 DB 분리는 아직 구현하지 않았습니다.

## 백업과 데이터 공급

실데이터 변경 전 `pnpm exec wrangler d1 export cosmetics-rank --remote --output=backup.sql`로 로컬 백업합니다. 월 1회 오프라인 백업을 권장하며 backup 파일은 Git에서 제외합니다. D1 Free Time Travel의 보존기간은 [공식 한도](https://developers.cloudflare.com/d1/platform/limits/)에서 확인합니다. 로컬 데이터 복원도 별도 환경에서 검증한 후 원격에 적용하세요.

자동 수집 허가는 확인하지 않았습니다. 크롤러, 우회, CAPTCHA 처리, Cron은 없습니다. 현재 상태는 `DISABLED_NO_APPROVED_SOURCE`이며 수동 CSV/XLSX와 가상 샘플만 사용합니다.
