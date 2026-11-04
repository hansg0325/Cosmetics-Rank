# OliveRank — Phase 0 / Phase 1 / Phase 2

다른 PC에서 이어 작업하려면 [Git 사용·인수인계 안내](docs/git-handoff.md)를 확인하세요. Git에는 소스와 마이그레이션을 저장하며 로컬 DB·토큰·수집 결과는 포함하지 않습니다.

Phase 2 구현 완료: 날짜·카테고리별 조회, 상품명·브랜드 검색, 직전 수집일 대비 등락, 상품 이력, 대시보드와 다중 상품 순위 그래프를 제공합니다. 그래프의 선이나 범례에 마우스를 올리면 해당 상품을 강조하고 나머지는 흐리게 표시합니다. [구현 파일·테스트·실행 보고서](docs/phase2-report.md).

개인용 한국어 랭킹 기록 앱. React + Vite + TypeScript / Hono Worker / Cloudflare D1. 로컬 PC의 Selenium으로 전체 랭킹을 읽고 버튼 한 번으로 저장합니다. 가격·이미지는 추출하지 않으며 유료 서비스·예약 실행·원격 배포는 사용하지 않습니다.

**현재 버튼 수집은 Selenium 방식입니다.** 앱의 ‘지금 수집하고 저장’을 누르면 Chrome 실행 → 100행 검증 → D1 저장까지 이어집니다. **브라우저 확장 프로그램 설치나 파일 업로드는 필요 없습니다.** [실행·설계·실제 검증 결과](docs/selenium-button.md).

이전 브라우저 캡처·확장 연결 방식의 기록은 `docs/actual-rankings.md`, `docs/one-click-collection.md`에 남겨 두었습니다. 현재 버튼에는 확장 프로그램을 연결하지 않습니다.

독립 수집 테스트 기록은 [Selenium 테스트 보고서](docs/selenium-probe.md)에 있습니다. 이후 현재 버튼 및 실제 DB 저장까지 연결·검증했습니다.

## 빠른 시작

이 PC의 Git Bash에서는 별도 설치나 PATH 설정 없이 아래 두 줄로 실행할 수 있습니다.

```bash
cd "/c/Users/admin/Documents/ChatGPT/Cosmetics Rank"
bash ./start-local.sh
```

`start-local.sh`가 프로젝트 위치에서 의존성 확인 → 로컬 설정 → 마이그레이션 → 서버 실행을 순서대로 수행합니다. `pnpmw`는 설치된 Node/pnpm 또는 이 PC의 Codex 번들 런타임을 사용합니다. 개별 명령은 `bash ./pnpmw test`처럼 실행합니다. 서버 종료는 Ctrl+C입니다.

Node.js 22 이상과 pnpm 11을 설치한 환경에서 작업 폴더를 열고 실행합니다.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate
pnpm dev
```

http://127.0.0.1:8787 에 접속하고 `.dev.vars`의 `LOCAL_DEV_TOKEN` 값으로 로그인합니다. 토큰은 로컬 호스트에서만 유효합니다. **랭킹 → 2026-11-04 → 전체**에서 이번에 저장한 실제 상품 100개를 확인할 수 있습니다. 새 기록은 대시보드 또는 가져오기 화면의 **지금 수집하고 저장**으로 수집합니다. 가상 샘플은 별도로 유지하며 실데이터와 합치지 않습니다. 로컬 DB는 `.wrangler/state`에 유지됩니다. 파일과 토큰을 공개 저장소에 올리지 마세요.

이 PC는 Node/pnpm이 PATH에 없어 번들 실행 파일을 사용했습니다. PowerShell에서 다음을 먼저 실행하면 같은 환경을 사용할 수 있습니다.

```powershell
$env:PATH = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;' + $env:PATH
```

`pnpm dev`는 Vite 빌드 후 로컬 Selenium 서비스와 Wrangler를 함께 시작합니다. 최초 한 번 Python/Selenium 실행 환경을 준비합니다. UI를 수정했다면 `pnpm build` 후 브라우저를 새로 고칩니다. `pnpm dev:worker`는 API/UI만 실행하므로 버튼 수집에는 `pnpm dev` 또는 `start-local.sh`를 사용하세요. Chrome은 버튼을 누를 때만 실행합니다.

## 검증

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
# pnpm dev가 별도 터미널에서 실행 중일 때
pnpm test:smoke
```

Vitest는 실제 Miniflare D1에서 새 DB를 구성해 파일 검증, 청크, 트랜잭션, 재처리, 인증을 테스트합니다. Wrangler와 공유하지 않는 임시 DB입니다. Windows D1 RPC 지연을 고려해 개별 테스트 제한은 30초입니다. smoke는 현재 Wrangler 로컬 DB에 샘플을 저장하고 2×100행과 SPA/API 인증을 검증합니다. 동일 파일 재실행은 멱등 처리됩니다.

## 파일 구성

수동으로 구성한 Vite/Workers 프로젝트이며 템플릿 생성 파일에 의존하지 않습니다.

| 경로                                                                      | 역할                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/client/main.tsx`, `style.css`                                        | 반응형 한국어 대시보드·가져오기·설정·가져오기 이력        |
| `src/client/importer.ts`                                                  | 브라우저 CSV 파싱, ExcelJS 동적 import, 한글 XLSX 열 매핑 |
| `src/shared/schemas.ts`                                                   | Zod 행/날짜/URL/가격 검증, 100행 연속 순위 검증           |
| `src/worker/index.ts`                                                     | Hono API, JWT/로컬 인증, CSRF, D1 청크 저장·완료·취소     |
| `src/worker/providers/*`                                                  | 수동/가상 데이터 공급자 계약; 자동 공급자 없음            |
| `migrations/0001_initial.sql`                                             | 제공 스키마 원본, 22개 카테고리 seed                      |
| `migrations/0002_import_guards.sql`                                       | 미완성 저장·변경된 청크 재전송·완료 무결성 DB 보호        |
| `fixtures/`, `public/`                                                    | 제공 CSV 원본 및 인증 후 다운로드 사본                    |
| `tests/import.test.ts`                                                    | 단위/실제 D1 통합 테스트                                  |
| `scripts/local-setup.mjs`, `smoke.mjs`                                    | 로컬 토큰 생성 / Wrangler HTTP 검증                       |
| `wrangler.jsonc`                                                          | 단일 Worker Static Assets, D1 바인딩, 기본 인증 거부      |
| `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `eslint.config.js` | 빌드·타입·테스트·린트 설정                                |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`                                   | 의존성 고정 및 esbuild/workerd 빌드 허용                  |
| `docs/architecture.md`, `operations.md`, `phase-report.md`                | 설계·운영·실제 결과                                       |

## 현재 API

모든 UI·정적 자산·API는 Worker 인증을 먼저 거칩니다. 로컬 로그인 화면만 인증 진입점으로 제공합니다.

- `GET /api/health`, `/api/categories`, `/api/imports?offset=0`
- `GET /api/rankings?date=2026-11-04&category=skincare&query=` — 현재 순위와 등락, 상품명·브랜드 검색
- `GET /api/changes?date=2026-11-04&category=skincare` — 비교 기준일, 현재 상품과 이탈 상품
- `GET /api/dates?category=skincare` — 수집 완료 날짜, before 커서 지원
- `GET /api/products?query=&limit=20` — 상품 검색, next_cursor로 다음 페이지 조회
- `GET /api/products/:id/history?category=skincare&from=2026-11-03&to=2026-11-04` — 최대 180일 이력과 요약
- `GET /api/dashboard?category=overall` — 최신 순위·상승·신규 및 최근 7일 실행 현황
- `POST /api/imports` — **날짜·카테고리 한 쌍**당 실행/스냅샷 생성
- `POST /api/imports/:id/chunks` — `{rows: [...]}` 최대 20행
- `POST /api/imports/:id/complete` — `{replace: false}` 검증/원자 활성화
- `POST /api/imports/:id/cancel` — `{failed: false}` 취소, 실패 보고는 true

일반 가져오기 파일은 영어 열 이름을 사용합니다. XLSX는 첫 번째 시트의 `날짜, 카테고리, 순위, 상품 ID, 브랜드, 상품명, URL`도 지원합니다. 카테고리 값은 `skincare` 같은 등록 코드여야 합니다. 빈 URL은 제공 샘플과 호환하도록 허용하고, 값이 있으면 HTTP(S)만 허용합니다. 날짜는 KST 날짜 문자열, `collected_at`은 브라우저가 생성하는 UTC 시각입니다. 실제 랭킹 JSON은 화면을 읽은 원래 시각을 보존합니다. 기존 파일의 가격/이미지 열은 무시하고 새 순위 행의 가격은 항상 NULL로 저장합니다. 기존 DB에 이미 있던 값은 삭제하지 않습니다.

## 다음 단계와 배포

Phase 2 조회/검색/등락/상품 차트까지 구현했습니다. Phase 3 내보내기와 Phase 4 실제 Access/배포/성능 확인은 후속 범위입니다.

무료 계정 D1 생성 → ID 교체 → Access Worker-level 본인 이메일 정책 설정 → 인증 환경변수 설정 → 원격 마이그레이션 → 빌드/배포 → 익명/다른 사용자/미리보기 URL 차단 확인 순서입니다. 구체적인 절차는 [운영 가이드](docs/operations.md)를 참고하세요. 계정 인증을 하지 않았으므로 배포 URL과 원격 CPU 측정값은 없습니다. 실데이터 접근 허가는 미확인이며 자동 수집 상태는 `DISABLED_NO_APPROVED_SOURCE`입니다.
