import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Local-only fictional examples; never writes to a remote D1 database.
const origin = "http://127.0.0.1:8787";
const token = readFileSync(".dev.vars", "utf8").match(
  /^LOCAL_DEV_TOKEN=(.*)$/m,
)?.[1];
async function request(path, body) {
  const response = await fetch(origin + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-local-token": token,
      origin,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(JSON.stringify(data));
  return data;
}
const stories = [
  {
    id: "rise",
    name: "[예시] 꾸준히 상승하는 세럼",
    ranks: [28, 25, 21, 18, 15, null, 10, 7, 4, 2],
  },
  {
    id: "fall",
    name: "[예시] 하락하는 크림",
    ranks: [2, 4, 7, 9, 12, null, 16, 20, 24, 29],
  },
  {
    id: "new",
    name: "[예시] 신규 진입 선크림",
    ranks: [null, null, null, 25, 19, null, 12, 8, 5, 3],
  },
  {
    id: "return",
    name: "[예시] 이탈 후 재진입 토너",
    ranks: [8, 10, 15, 22, null, null, null, null, 18, 12],
  },
  {
    id: "wave",
    name: "[예시] 오르내리는 앰플",
    ranks: [15, 6, 18, 5, 20, null, 4, 17, 6, 9],
  },
  {
    id: "steady",
    name: "[예시] 순위 유지 클렌저",
    ranks: [14, 14, 14, 14, 14, null, 14, 14, 14, 14],
  },
];
const allRows = [];
for (let day = 0; day < 10; day++) {
  if (day === 5) continue; // Oct 31 is deliberately missing, not a rank of zero.
  const date = new Date(Date.UTC(2026, 9, 26 + day)).toISOString().slice(0, 10);
  const occupied = new Map(
    stories.filter((s) => s.ranks[day] !== null).map((s) => [s.ranks[day], s]),
  );
  let filler = 1;
  const rows = Array.from({ length: 100 }, (_, i) => {
    const story = occupied.get(i + 1);
    const id = story?.id ?? `base-${String(filler++).padStart(3, "0")}`;
    return {
      ranking_date: date,
      category_code: "chart_demo",
      rank: i + 1,
      product_id: "CHART-DEMO-" + id,
      brand_name: "가상 예시 · 실제 상품 아님",
      product_name: story?.name ?? `[예시] 비교 상품 ${id.slice(5)}`,
      product_url: "",
    };
  });
  allRows.push(...rows);
  const run = await request("imports", {
    ranking_date: date,
    category_code: "chart_demo",
    collected_at: date + "T03:00:00.000Z",
    source_type: "FIXTURE",
    source_ref: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  });
  if (!run.already_complete) {
    for (let i = 0; i < 100; i += 20)
      await request(`imports/${run.id}/chunks`, {
        rows: rows.slice(i, i + 20),
      });
    await request(`imports/${run.id}/complete`, {});
  }
  console.log(date + " · 100개 예시 저장 확인");
}
writeFileSync(
  "fixtures/chart-demo.json",
  JSON.stringify(allRows, null, 2) + "\n",
);
for (const story of stories) {
  const history = await request(
    `products/CHART-DEMO-${story.id}/history?category=chart_demo&from=2026-10-26&to=2026-11-04`,
  );
  if (history.points.some((p, i) => p.rank !== story.ranks[i]))
    throw Error("이력 불일치: " + story.id);
}
const changes = await request("changes?category=chart_demo&date=2026-10-29");
if (
  changes.items.find((p) => p.product_id === "CHART-DEMO-new")?.movement !==
  "NEW"
)
  throw Error("신규 진입 검증 실패");
console.log("PASS: 6가지 추이, 미수집일, 신규 진입 검증");
