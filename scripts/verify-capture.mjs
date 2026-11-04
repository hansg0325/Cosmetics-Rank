// Read-only check against the local Worker. Never fetches Olive Young.
import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file)
  throw Error(
    "사용법: bash ./pnpmw verify:capture data/oliveyoung-overall-YYYY-MM-DD.json",
  );
const capture = JSON.parse(readFileSync(file, "utf8"));
if (capture.format !== "oliverank-browser-v1" || capture.rows.length !== 100)
  throw Error("캡처 형식 오류");
const token = readFileSync(".dev.vars", "utf8")
  .match(/^LOCAL_DEV_TOKEN=(.*)$/m)?.[1]
  .trim();
const headers = { "x-local-token": token };
const origin = "http://127.0.0.1:8787";
const response = await fetch(
  `${origin}/api/rankings?date=${encodeURIComponent(capture.ranking_date)}&category=overall`,
  { headers },
);
if (!response.ok) throw Error(`조회 오류 ${response.status}`);
const entries = await response.json();
if (entries.length !== 100) throw Error("완료 기록 100개 필요");
for (const r of capture.rows) {
  const stored = entries.find((e) => e.rank === r.rank);
  if (
    !stored ||
    stored.product_id !== r.product_id ||
    stored.brand_name_at_capture !== r.brand_name ||
    stored.product_name_at_capture !== r.product_name ||
    stored.product_url_at_capture !== r.product_url ||
    stored.list_price !== null ||
    stored.sale_price !== null
  )
    throw Error(`${r.rank}위 불일치 또는 가격 저장 오류`);
}
const importsResponse = await fetch(origin + "/api/imports", { headers });
if (!importsResponse.ok) throw Error("이력 조회 실패");
const imports = await importsResponse.json();
const active = imports.filter(
  (r) =>
    r.ranking_date === capture.ranking_date &&
    r.category_code === "overall" &&
    r.is_active === 1,
);
if (
  active.length !== 1 ||
  active[0].status !== "COMPLETE" ||
  !/^(browser|selenium):/.test(active[0].source_ref)
)
  throw Error("단일 활성 COMPLETE 상태 불일치");
console.log(
  JSON.stringify(
    {
      date: capture.ranking_date,
      collected_at: capture.collected_at,
      rows: entries.length,
      all_fields_match: true,
      prices: "ALL_NULL",
      image_fields_in_capture: capture.rows.some((r) => "image_url" in r),
      active_complete_snapshots: active.length,
    },
    null,
    2,
  ),
);
