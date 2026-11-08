import { describe, expect, it } from "vitest";
import { categoryShares } from "../src/shared/marketShare";

describe("전체 랭킹 카테고리 점유율", () => {
  it("카테고리 상품 수·전체 대비 비율·카테고리 내 브랜드 비율·중복 없는 키워드 상품 수", () => {
    const rows = categoryShares([
      {
        rank: 1,
        product_category_at_capture: "스킨케어",
        brand_name_at_capture: "A",
        keywords_at_capture: "PDRN, PDRN, 세라마이드",
      },
      {
        rank: 2,
        product_category_at_capture: "스킨케어",
        brand_name_at_capture: "A",
        keywords_at_capture: "PDRN",
      },
      {
        rank: 3,
        product_category_at_capture: "스킨케어",
        brand_name_at_capture: "B",
        keywords_at_capture: "",
      },
      {
        rank: 4,
        product_category_at_capture: "메이크업",
        brand_name_at_capture: "C",
        keywords_at_capture: null,
      },
      {
        rank: null,
        product_category_at_capture: "스킨케어",
        brand_name_at_capture: "B",
        keywords_at_capture: "이탈키워드",
      },
    ]);
    expect(rows[0]).toEqual({
      category: "스킨케어",
      count: 3,
      share: 75,
      top_brands: [{ name: "A", count: 2, share: (2 / 3) * 100 }],
      keywords: [
        { name: "PDRN", count: 2 },
        { name: "세라마이드", count: 1 },
      ],
      keyword_checked: 3,
    });
    expect(rows[1]).toMatchObject({
      category: "메이크업",
      count: 1,
      share: 25,
      keywords: [],
      keyword_checked: 0,
    });
  });
  it("공동 1위와 미분류·브랜드 누락을 유지하고 빈 랭킹을 처리", () => {
    const rows = categoryShares([
      { rank: 1, brand_name_at_capture: "B" },
      { rank: 2, brand_name_at_capture: "A" },
      { rank: 3 },
    ]);
    expect(rows[0].category).toBe("미분류");
    expect(rows[0].count).toBe(3);
    expect(
      rows[0].top_brands.map(({ name, count }) => ({ name, count })),
    ).toEqual([
      { name: "A", count: 1 },
      { name: "B", count: 1 },
    ]);
    for (const brand of rows[0].top_brands)
      expect(brand.share).toBeCloseTo(100 / 3);
    expect(categoryShares([])).toEqual([]);
    expect(categoryShares([{ rank: 1 }])[0].top_brands).toEqual([]);
  });
});
