import Papa from "papaparse";
import { validateRows, type RankingRow } from "../shared/schemas";
const aliases: Record<string, string> = {
  날짜: "ranking_date",
  카테고리: "category_code",
  순위: "rank",
  "상품 ID": "product_id",
  브랜드: "brand_name",
  상품명: "product_name",
  URL: "product_url",
  정가: "list_price",
  판매가: "sale_price",
};
export function mapRecords(records: Record<string, unknown>[]): RankingRow[] {
  return validateRows(
    records.map((record) => {
      const r: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(record)) {
        const k = aliases[key.trim()] || key.trim();
        if (["list_price", "sale_price", "image_url"].includes(k)) continue;
        r[k] = ["rank", "sale_price", "list_price"].includes(k)
          ? v === "" || v == null
            ? null
            : Number(String(v).replaceAll(",", ""))
          : String(v ?? "").trim();
      }
      return r;
    }),
  );
}
export function parseCsv(csv: string) {
  const p = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
  });
  if (p.errors.length) throw new Error(`CSV: ${p.errors[0].message}`);
  return mapRecords(p.data);
}
export async function parseXlsx(buffer: ArrayBuffer) {
  const { Workbook, ValueType } = await import("exceljs");
  const wb = new Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("워크시트 없음");
  const headers: string[] = [];
  sheet.getRow(1).eachCell((c, n) => (headers[n] = c.text));
  const records: Record<string, unknown>[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const r: Record<string, unknown> = {};
    for (let i = 1; i < headers.length; i++) {
      if (
        ["list_price", "sale_price", "image_url"].includes(
          aliases[headers[i]] || headers[i],
        )
      )
        continue;
      const cell = row.getCell(i);
      if (cell.type === ValueType.Formula)
        throw new Error(`${n}행: 수식 셀은 허용하지 않습니다`);
      r[headers[i]] = cell.text;
    }
    records.push(r);
  });
  return mapRecords(records);
}
