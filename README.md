# cosmetics rank

올리브영 랭킹을 날짜별로 보관하고 비교하는 개인용 앱입니다. React/Vite 화면, Hono Worker API, Cloudflare D1을 사용합니다.

## 현재 기능

- 전체·스킨케어·마스크팩·클렌징·선케어·메이크업·더모 코스메틱·헤어케어·바디케어·맨즈에딧 랭킹을 각각 100위까지 수집합니다.
- 상품명, 브랜드, 상품 대분류, 상품 링크와 상세페이지의 리뷰 수·평점·상품정보 제공고시 원문·성분 키워드를 저장합니다. 가격과 이미지는 수집하지 않습니다.
- 대시보드, 랭킹, 순위 변동, 상품 이력, 점유율 분석, 키워드 설정, 관리자 화면을 제공합니다.
- 관리자에서 10개 카테고리를 순차 수집하고, 저장된 최신 랭킹을 10개 시트의 XLSX로 내려받습니다. 최근 수집 이력은 20건씩 이전·다음 페이지로 조회합니다.
- 상세페이지는 한 상품을 읽은 뒤 다음 상품을 열기 전 2초 기다립니다. 접속 제한이 감지되면 남은 상세조회는 중단하고 확인하지 못한 값은 비워 둡니다.

## 로컬 실행

Windows Git Bash에서 저장소를 받은 뒤 실행합니다.

```bash
git clone https://github.com/hansg0325/Cosmetics-Rank.git
cd Cosmetics-Rank
bash ./start-local.sh
```

다른 위치에 clone했다면 해당 저장소 폴더에서 `bash ./start-local.sh`를 실행하세요. 실행 후 <http://127.0.0.1:8787>을 엽니다. 로컬 화면에는 토큰 입력이 필요하지 않습니다. 첫 실행 시 의존성, 로컬 설정, D1 마이그레이션을 준비합니다. `Ctrl+C`로 종료합니다.

Node.js 22 이상과 pnpm 11을 이미 설치한 환경에서는 `pnpm install --frozen-lockfile`, `pnpm setup:local`, `pnpm db:migrate`, `pnpm dev` 순서로 실행할 수도 있습니다. Python 3.10 이상과 Chrome은 수집에 필요합니다.

## 검증

```bash
bash ./pnpmw lint
bash ./pnpmw test
bash ./pnpmw build
```

Python 수집기 테스트는 `tests/test_*.py`에 있습니다. `pnpm test:smoke`는 로컬 DB에 샘플 데이터를 쓰므로 빈 DB 상태를 유지하려면 실행하지 마세요.

## 배포 상태

별도 Windows PC를 수집기로 등록할 때는 [수집 PC 설정 가이드](docs/collector-pc-setup.md)를 따르세요. 새 PC의 Codex에 붙여넣을 요청도 들어 있습니다.

Cloudflare Worker와 원격 D1은 배포되어 있습니다. 일반 방문자는 로그인 없이 조회하고 성분 키워드를 편집할 수 있습니다. `/admin`과 `/api/admin/*`에는 Cloudflare Access가 적용되며 Worker가 관리자 이메일을 확인합니다. Actions 수집은 `/api/imports` 및 하위 경로에서 Service Auth와 API 키를 사용합니다. 절차와 제한은 [운영 가이드](docs/operations.md)를 참고하세요.

Git에는 소스와 마이그레이션만 포함합니다. `.dev.vars`, `.wrangler/`, `data/`, `.local-browser/`, `dist/`는 제외합니다. 로컬 DB는 GitHub에 올라가지 않습니다.
