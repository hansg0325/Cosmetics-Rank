import type { Workbook } from "exceljs";
import collectionCategories from "../shared/collectionCategories.json";
import Papa from "papaparse";
import type { ChangeEntry, Comparison } from "../shared/analytics";

const movementNames = {
  UP: "상승",
  DOWN: "하락",
  SAME: "동일",
  NEW: "신규 진입",
  EXIT: "이탈",
  UNCOMPARED: "비교 없음",
};
export function exportRows(comparison: Comparison, items: ChangeEntry[]) {
  return items.map((item) => ({
    날짜: comparison.date,
    카테고리: comparison.category,
    "비교 기준일": comparison.compared_to ?? "",
    순위: item.rank,
    "이전 순위": item.previous_rank,
    등락: item.rank_change,
    변동: movementNames[item.movement],
    "상품 ID": item.product_id,
    브랜드: item.brand_name_at_capture,
    "상품 대분류": item.product_category_at_capture ?? "",
    상품명: item.product_name_at_capture,
    링크: item.product_url_at_capture,
    "리뷰 수": item.review_count_at_capture ?? null,
    "평점 (5점)": item.rating_at_capture ?? null,
    "제조업자, 판매업자": item.manufacturer_disclosure_at_capture ?? "",
    키워드: item.keywords_at_capture ?? "",
  }));
}
export function rankingsCsv(comparison: Comparison, items: ChangeEntry[]) {
  return (
    "\uFEFF" +
    Papa.unparse(exportRows(comparison, items), {
      newline: "\r\n",
      escapeFormulae: true,
    })
  );
}
const headers = [
  "날짜",
  "카테고리",
  "비교 기준일",
  "순위",
  "이전 순위",
  "등락",
  "변동",
  "상품 ID",
  "브랜드",
  "상품 대분류",
  "상품명",
  "링크",
  "리뷰 수",
  "평점 (5점)",
  "제조업자, 판매업자",
  "키워드",
];
function addRankingSheet(
  workbook: Workbook,
  comparison: Comparison,
  name: string,
) {
  const sheet = workbook.addWorksheet(name);
  const rows = exportRows(comparison, comparison.items);
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: header === "상품명" || header === "링크" ? 55 : 18,
  }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "P1" };
}
export async function rankingsWorkbook(
  comparison: Comparison,
  items: ChangeEntry[],
) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (!items.length) throw Error("내보낼 상품이 없습니다.");
  addRankingSheet(workbook, { ...comparison, items }, "랭킹");
  return workbook.xlsx.writeBuffer();
}
export async function allRankingsWorkbook(comparisons: Comparison[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (
    !comparisons.some(
      (c) => c.has_snapshot && c.items.some((r) => r.rank !== null),
    )
  )
    throw Error("내보낼 수집 기록이 없습니다.");
  for (const [category, info] of Object.entries(collectionCategories)) {
    const comparison = comparisons.find((c) => c.category === category);
    const empty: Comparison = {
      category,
      date: "",
      has_snapshot: false,
      snapshot_id: null,
      compared_to: null,
      missing_days: 0,
      items: [],
      counts: { UP: 0, DOWN: 0, SAME: 0, NEW: 0, EXIT: 0, UNCOMPARED: 0 },
    };
    addRankingSheet(
      workbook,
      comparison
        ? {
            ...comparison,
            items: comparison.has_snapshot
              ? comparison.items
                  .filter((r) => r.rank !== null)
                  .sort((a, b) => a.rank! - b.rank!)
              : [],
          }
        : empty,
      info.name,
    );
  }
  return workbook.xlsx.writeBuffer();
}
export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
