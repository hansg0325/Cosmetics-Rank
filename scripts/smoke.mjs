import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Papa from "papaparse";
const origin = "http://127.0.0.1:8787";
const token = readFileSync(".dev.vars", "utf8").match(
  /^LOCAL_DEV_TOKEN=(.*)$/m,
)?.[1];
async function request(path, body) {
  const r = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-local-token": token,
      origin,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw Error(`${path} ${r.status} ${JSON.stringify(json)}`);
  return json;
}
if ((await fetch(origin + "/api/categories")).status !== 401)
  throw Error("API auth guard failed");
if ((await fetch(origin + "/")).status !== 401)
  throw Error("UI auth guard failed");
const html = await fetch(origin + "/", { headers: { "x-local-token": token } });
if (html.status !== 200 || !(await html.text()).includes('id="root"'))
  throw Error("SPA missing");
const rows = Papa.parse(
  readFileSync("fixtures/sample_rankings_2days.csv", "utf8"),
  { header: true, skipEmptyLines: true },
).data.map((r) => ({
  ...r,
  rank: Number(r.rank),
  list_price: r.list_price === "" ? null : Number(r.list_price),
  sale_price: r.sale_price === "" ? null : Number(r.sale_price),
}));
const results = [];
for (const date of [...new Set(rows.map((r) => r.ranking_date))]) {
  const data = rows.filter((r) => r.ranking_date === date);
  const run = await request("/api/imports", {
    ranking_date: date,
    category_code: "skincare",
    collected_at: new Date().toISOString(),
    source_ref: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    source_type: "FIXTURE",
  });
  if (!run.already_complete) {
    for (let i = 0; i < data.length; i += 20)
      await request(`/api/imports/${run.id}/chunks`, {
        rows: data.slice(i, i + 20),
      });
    await request(`/api/imports/${run.id}/complete`, {});
  }
  const rankings = await request(
    `/api/rankings?date=${date}&category=skincare`,
  );
  if (rankings.length !== 100) throw Error("Expected 100 rows");
  results.push({ date, count: rankings.length });
}
console.log(
  JSON.stringify(
    {
      auth: "PASS",
      spa: "PASS",
      categories: (await request("/api/categories")).length,
      snapshots: results,
    },
    null,
    2,
  ),
);
