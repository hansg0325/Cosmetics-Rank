# Git 관리와 다른 PC에서 이어 작업하기

## 현재 구현

- 무료 Cloudflare Workers/Hono + D1, React/Vite/TypeScript 앱.
- 대시보드의 버튼으로 로컬 Selenium/Chrome 실행 → 전체 랭킹 100개 검증 → D1 저장.
- 순위, 상품 ID, 브랜드, 상품명, 상품 링크, 상품 카테고리 수집. 카테고리는 숫자 코드와 하위 분류를 제외한 첫 분류명만 저장.
- 가격·이미지 수집 제외. 성분 개선 보류. 수동 파일 가져오기 화면 제거.
- 날짜·카테고리별 랭킹, 검색, 직전 성공 수집일 대비 등락, 상품 이력, 대시보드 구현.
- 별도 ‘순위 변동’ 탭. 현재 상위 30개 상품을 기본 선택. 최대 180일. 호버 강조와 범례 고정, 정보는 그래프 아래 표시.
- 가상 예시 생성 스크립트와 테스트 포함. 내보내기 및 원격 배포는 미구현.

## Git에 포함하는 항목

소스, 테스트, 마이그레이션, 설정, lockfile, 문서, 가상 fixtures를 포함합니다. `.dev.vars`, `.env*`, `.wrangler/`, `data/`, `.local-browser/`, `node_modules/`, `dist/`는 제외합니다.

로그인 토큰은 PC마다 새로 생성합니다. `.dev.vars.example`은 형식 안내용입니다.

## 새 Windows PC

1. Git/Git Bash, Node.js 22 이상, pnpm 11, Python 3.10 이상, Google Chrome을 준비합니다. Codex 번들 런타임이 있으면 프로젝트 실행기가 이를 사용할 수 있습니다.
2. 저장소를 clone한 뒤 프로젝트 폴더로 이동합니다.

```bash
git clone <저장소 주소>
cd <저장소 폴더>
bash ./start-local.sh
```

3. http://127.0.0.1:8787 에 접속하고 새 `.dev.vars`의 `LOCAL_DEV_TOKEN`으로 로그인합니다. 시작 스크립트가 의존성, 로컬 설정과 마이그레이션을 준비합니다.
4. 대시보드에서 수집합니다. 빈 DB로 시작하는 것이 정상입니다. 기존 기록을 옮기려면 다음 절차를 따릅니다.

## 기존 수집 기록도 옮기기

Git은 데이터베이스를 동기화하지 않습니다. 양쪽 PC의 서버를 종료한 상태에서 기존 PC의 `.wrangler` 폴더를 개인 저장매체로 새 PC의 프로젝트에 복사합니다. 새 PC에 기존 `.wrangler`가 있다면 먼저 별도로 백업하고 어느 DB를 사용할지 정합니다. 두 DB를 폴더 복사로 병합할 수는 없습니다.

필요하면 `data` 폴더도 별도로 복사합니다. 두 폴더와 로그인 토큰을 Git 저장소에 강제로 추가하지 않습니다. 새 PC에서 다시 `bash ./start-local.sh`를 실행합니다. 여러 PC에서 동시에 쓰는 공유 DB는 아직 구성하지 않았습니다.

## 일상 작업

작업 시작 시 `git pull --ff-only`, 변경 후 다음 명령을 사용합니다.

```bash
git status
git add <수정한 파일>
git commit -m "변경 내용"
git push
```

```bash
bash ./pnpmw typecheck
bash ./pnpmw lint
bash ./pnpmw test
bash ./pnpmw build
```

UI 수정 후 빌드와 브라우저 새로고침이 필요합니다. 로컬 수집 서비스의 Python 코드를 수정했다면 실행 중인 개발 서버를 재시작합니다.

Codex에서는 이 저장소 폴더를 프로젝트로 열고 이 문서, README 및 관련 코드를 먼저 확인하도록 요청하면 됩니다. 기존 채팅 내용은 Git에 포함되지 않습니다.
