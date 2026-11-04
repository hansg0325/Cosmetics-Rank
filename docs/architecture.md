# 설계

요청 범위는 Phase 0·1입니다. 첨부 프롬프트의 ‘다음 단계 진행’ 문구는 이번 사용자 요청의 범위를 확대하는 승인으로 해석하지 않았습니다. 데이터 설계 기준은 제공 SQL이며 0001은 바이트 그대로 복사했습니다. 추가 보호는 별도 0002 migration입니다.

## 입력과 정합성

브라우저에서 CSV 또는 XLSX 첫 시트를 파싱하고 전체 날짜/카테고리 그룹을 검증합니다. 파일은 10MB 제한이며 전체 파일 파싱이 브라우저 메모리에서 이루어집니다. Worker는 JSON만 받고 요청 본문은 64KiB, 청크는 20행으로 제한합니다. 상품 ID는 문자열 그대로 사용합니다. URL/브랜드/이름 길이, 실재 날짜, 정수 가격, 순위 범위는 서버에서 다시 검증합니다.

파일당 복수 그룹을 각각 독립적인 ingestion_run으로 처리합니다. 앞 그룹 성공 후 뒷 그룹 실패 시 앞 그룹은 보존됩니다. 파일 전체 단위 원자성은 제공하지 않습니다. 브라우저에서 정렬된 그룹의 SHA-256을 source_ref로 생성합니다. 같은 source_ref의 활성 COMPLETE가 있으면 기존 실행을 반환합니다. source_ref는 클라이언트 멱등키 계약이며 서버가 콘텐츠 해시를 재계산하지 않습니다. 다른 source_ref는 명시적 교체 확인이 필요합니다. 동일 내용을 다른 직렬화 방식으로 보내면 변경본으로 간주할 수 있습니다.

청크는 D1 batch 트랜잭션입니다. 20행 × (상품 insert + 순위 insert) + 카운트 갱신 = 최대 41문장, 사전 조회 포함 42회로 무료 호출당 50쿼리 안에 있습니다. 문장당 최대 8바인딩으로 100개 이하입니다. 개별 행 SQL 매개변수 바인딩만 사용합니다. 동일 청크 재전송은 데이터가 같으면 무시하고, 기존 순위의 내용이 다르면 trigger로 전체 batch를 롤백합니다. 다른 순위에 동일 상품 ID를 쓰는 경우 unique 제약이 batch를 롤백합니다. 완료/취소 후 청크도 DB에서 거부합니다.

완료 시 count/min/max와 DB unique 제약으로 1~100 전체 순위를 검증합니다. 기존 활성 버전 해제, 신규 COMPLETE 활성화, 상품 최신 정보 갱신, 실행 COMPLETE 전환을 같은 D1 batch에서 수행합니다. 활성 버전은 unique partial index로 하나만 허용합니다. 중간 실패 시 이전 활성 버전도 복구됩니다. 완료 trigger는 서버 코드 외부에서의 불완전 완료도 거부합니다. 명시적 교체 없이 동시에 완료하면 unique index가 후발 완료를 막습니다.

조회 SQL은 반드시 `status='COMPLETE' AND is_active=1`을 사용합니다. 취소 데이터는 FAILED/비활성으로 남겨 감사 이력을 유지하며 삭제하지 않습니다. 가져오기 이력에는 관리 목적으로 미완성 스냅샷 상태/행 수가 표시됩니다. 브라우저 오류 시 실패 상태 기록을 시도하며, 탭을 닫았거나 네트워크가 끊기면 RUNNING이 남을 수 있습니다. 가져오기 이력에서 취소할 수 있습니다. 자동 정리/중단된 청크 재개 UI는 후속 범위입니다.

## 보안

Static Assets의 `run_worker_first: true`로 UI·다운로드·API 모두 인증합니다. 원격 환경은 Access JWT 서명, issuer, audience, 이메일을 jose/JWKS로 검증합니다. 환경변수가 빠지면 거부합니다. Cloudflare Access의 Worker-level 정책도 실제 배포 전에 설정해야 합니다. 로컬 토큰은 localhost/127.0.0.1에서만 허용하며 일반 원격 호스트에서는 같은 토큰을 보내도 거부합니다. 로컬 로그인 쿠키는 HttpOnly/SameSite=Strict입니다. 원격 HTTP에서 로컬 인증을 사용하지 않으며 토큰 파일은 Git에서 제외됩니다.

POST는 현재 요청 origin과 Origin 헤더가 일치해야 합니다. 토큰 기반 로컬 테스트도 Origin을 명시합니다. 입력은 Zod로 검증하고 400, 인증 401, Origin 403, 상태/DB 충돌 409, 불완전 순위 422, 본문 초과 413을 반환합니다. DB 원문 오류는 서버 로그에만 기록하고 응답에는 담지 않습니다. 현재 DB 오류 응답은 409로 통합되어 있으므로 운영용 장애 코드 세분화는 후속 개선입니다.

외부 문자열은 React 텍스트 노드로 렌더링합니다. XLSX 수식 셀은 입력 시 거부합니다. CSV 텍스트의 수식 중화 헬퍼는 단위 테스트를 제공하지만, 실제 내보내기에 적용하는 기능은 Phase 3에 구현합니다. 입력 상품명은 원형을 유지합니다.

## 비용과 성능

서버 런타임은 Workers + Hono + D1만 사용합니다. 사진·원문 HTML은 저장하지 않습니다. ExcelJS는 브라우저에서 XLSX 선택 시 지연 로딩합니다. 클라이언트가 파싱하고 Worker는 작은 JSON 청크만 검증합니다. 인증 때문에 정적 요청도 Worker를 호출하므로 Workers 요청 한도에 포함될 수 있습니다.

청크 처리 시 D1 rows_read/rows_written를 구조화 로그로 출력합니다. 제품·랭킹 인덱스 쓰기도 사용량에 포함됩니다. 정기 DB 크기 경보/백업/CPU 대시보드는 Phase 4 범위입니다. 로컬 wall time이나 Miniflare RPC 지연은 원격 Worker CPU 시간이 아닙니다. 원격 CPU 10ms 준수는 배포 후 실제 Workers 메트릭으로 확인해야 합니다.

공식 설계 참고: [Static Assets Worker routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Worker-level Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
