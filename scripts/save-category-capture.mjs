import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const origin = "http://127.0.0.1:8787";
const token = readFileSync(".dev.vars", "utf8").match(
  /^LOCAL_DEV_TOKEN=(.*)$/m,
)?.[1];
const line = readFileSync("data/category-collection-output.txt", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("OLIVERANK_CAPTURE "));
if (!line) throw Error("수집 결과 없음");
const capture = JSON.parse(line.slice("OLIVERANK_CAPTURE ".length));
if (
  capture.rows.length !== 100 ||
  capture.rows.some(
    (r) =>
      !r.product_category ||
      /^\d+$/.test(r.product_category) ||
      r.product_category.includes(">"),
  )
)
  throw Error("100개 대분류 검증 실패");
async function request(path, body) {
  const res = await fetch(origin + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-local-token": token,
      origin,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await res.json();
  if (!res.ok) throw Error(JSON.stringify(value));
  return value;
}
const rows = capture.rows.map((r) => ({
  ...r,
  ranking_date: capture.ranking_date,
  category_code: "overall",
}));
const run = await request("imports", {
  ranking_date: capture.ranking_date,
  category_code: "overall",
  collected_at: capture.collected_at,
  source_ref:
    "selenium:" +
    createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  source_type: "MANUAL",
  replace: true,
});
if (!run.already_complete) {
  for (let i = 0; i < 100; i += 20)
    await request(`imports/${run.id}/chunks`, { rows: rows.slice(i, i + 20) });
  await request(`imports/${run.id}/complete`, { replace: true });
}
const saved = await request(
  `rankings?category=overall&date=${capture.ranking_date}`,
);
if (
  saved.length !== 100 ||
  saved.some(
    (r, i) => r.product_category_at_capture !== rows[i].product_category,
  )
)
  throw Error("저장 후 카테고리 불일치");
const history = await request(
  `products/${rows[0].product_id}/history?category=overall&from=${capture.ranking_date}&to=${capture.ranking_date}`,
);
if (history.product.product_category !== rows[0].product_category)
  throw Error("상품 이력 불일치");
const counts = {};
for (const r of saved)
  counts[r.product_category_at_capture] =
    (counts[r.product_category_at_capture] || 0) + 1;
writeFileSync(
  "data/overall-product-categories.json",
  JSON.stringify(
    {
      date: capture.ranking_date,
      counts,
      products: saved.map((r) => ({
        rank: r.rank,
        product_id: r.product_id,
        product_name: r.product_name_at_capture,
        category: r.product_category_at_capture,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ verified: 100, history: "PASS", counts }, null, 2),
);
