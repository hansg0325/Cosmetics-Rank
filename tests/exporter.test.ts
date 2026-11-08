import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Comparison } from "../src/shared/analytics";
import {
  allRankingsWorkbook,
  exportRows,
  rankingsCsv,
  rankingsWorkbook,
} from "../src/client/exporter";

const comparison: Comparison = {
  date: "2026-11-04",
  category: "overall",
  has_snapshot: true,
  snapshot_id: 1,
  compared_to: "2026-11-03",
  missing_days: 0,
  counts: { UP: 0, DOWN: 0, SAME: 0, NEW: 0, EXIT: 1, UNCOMPARED: 0 },
  items: [
    {
      product_id: "00123",
      rank: null,
      previous_rank: 5,
      rank_change: null,
      movement: "EXIT",
      brand_name_at_capture: "=1+1",
      product_name_at_capture: '크림, "보습"\n한글',
      product_category_at_capture: "스킨케어",
      product_url_at_capture: "https://example.com/123",
      review_count_at_capture: 44987,
      rating_at_capture: 4.9,
      manufacturer_name_at_capture: "(주)코스비전",
      manufacturer_disclosure_at_capture:
        "본품: (주)코스비전/(주)아모레퍼시픽\n증정품: 다른 제조업자/다른 판매업자",
      seller_name_at_capture: "(주)아모레퍼시픽",
      keywords_at_capture: "세라마이드, 나이아신아마이드",
    },
  ],
};
describe("랭킹 내보내기", () => {
  it("CSV 한글, 쉼표, 따옴표, 줄바꿈과 수식 문자열을 안전하게 보존한다", () => {
    const csv = rankingsCsv(comparison, comparison.items);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(rows[0].상품명).toBe(comparison.items[0].product_name_at_capture);
    expect(rows[0].브랜드).toBe("'=1+1");
    expect(rows[0].순위).toBe("");
    expect(rows[0]["비교 기준일"]).toBe("2026-11-03");
    expect(rows[0].변동).toBe("이탈");
    expect(rows[0]["리뷰 수"]).toBe("44987");
    expect(rows[0]["평점 (5점)"]).toBe("4.9");
    expect(rows[0]["제조업자, 판매업자"]).toBe(
      comparison.items[0].manufacturer_disclosure_at_capture,
    );
    expect(rows[0].키워드).toBe("세라마이드, 나이아신아마이드");
  });
  it("선택된 행만 내보내며 가격과 이미지는 포함하지 않는다", () => {
    expect(exportRows(comparison, [])).toEqual([]);
    expect(
      Object.keys(exportRows(comparison, comparison.items)[0]),
    ).toHaveLength(16);
  });
  it("엑셀 파일을 다시 열어 ID, 숫자, 빈 순위와 일반 문자열을 확인한다", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await rankingsWorkbook(comparison, comparison.items),
    );
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("D2").value).toBeNull();
    expect(sheet.getCell("E2").value).toBe(5);
    expect(sheet.getCell("H2").value).toBe("00123");
    expect(sheet.getCell("I2").value).toBe("=1+1");
    expect(sheet.getCell("M2").value).toBe(44987);
    expect(sheet.getCell("N2").value).toBe(4.9);
    expect(sheet.getCell("O2").value).toBe(
      comparison.items[0].manufacturer_disclosure_at_capture,
    );
    expect(sheet.getCell("P2").value).toBe("세라마이드, 나이아신아마이드");
    expect(sheet.getCell("K2").value).toBe(
      comparison.items[0].product_name_at_capture,
    );
  });
  it("전체 카테고리를 각각 시트로 저장하고 이탈·미수집을 제외", async () => {
    const current = {
      ...comparison,
      items: [
        { ...comparison.items[0], rank: 2, movement: "SAME" as const },
        {
          ...comparison.items[0],
          product_id: "current-first",
          rank: 1,
          movement: "SAME" as const,
        },
        comparison.items[0],
      ],
    };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await allRankingsWorkbook([
        current,
        { ...current, category: "skincare" },
      ]),
    );
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "전체",
      "스킨케어",
      "마스크팩",
      "클렌징",
      "선케어",
      "메이크업",
      "더모 코스메틱",
      "헤어케어",
      "바디케어",
      "맨즈에딧",
    ]);
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getCell("H2").value).toBe("current-first");
    expect(sheet.getCell("D2").value).toBe(1);
    expect(sheet.getCell("O2").value).toBe(
      comparison.items[0].manufacturer_disclosure_at_capture,
    );
    expect(workbook.getWorksheet("마스크팩")?.rowCount).toBe(1);
    await expect(allRankingsWorkbook([])).rejects.toThrow(
      "내보낼 수집 기록이 없습니다",
    );
  });
});
