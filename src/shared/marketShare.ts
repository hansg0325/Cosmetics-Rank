import type { ChangeEntry } from "./analytics";

export type CategoryShare = {
  category: string;
  count: number;
  share: number;
  top_brands: { name: string; count: number; share: number }[];
  keywords: { name: string; count: number }[];
  keyword_checked: number;
};
export type MarketShare = {
  date: string;
  has_snapshot: boolean;
  total: number;
  items: CategoryShare[];
};

export function categoryShares(
  entries: Partial<ChangeEntry>[],
): CategoryShare[] {
  const ranked = entries.filter((r) => r.rank != null);
  const groups = new Map<string, typeof ranked>();
  for (const row of ranked) {
    const category = row.product_category_at_capture?.trim() || "미분류";
    groups.set(category, [...(groups.get(category) || []), row]);
  }
  return [...groups]
    .map(([category, rows]) => {
      const brands = new Map<string, number>();
      const keywords = new Map<string, number>();
      for (const row of rows) {
        const brand = row.brand_name_at_capture?.trim();
        if (brand) brands.set(brand, (brands.get(brand) || 0) + 1);
        for (const keyword of new Set(
          (row.keywords_at_capture || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )) {
          keywords.set(keyword, (keywords.get(keyword) || 0) + 1);
        }
      }
      const max = Math.max(0, ...brands.values());
      return {
        category,
        count: rows.length,
        share: (rows.length / ranked.length) * 100,
        top_brands: [...brands]
          .filter(([, count]) => count === max)
          .map(([name, count]) => ({
            name,
            count,
            share: (count / rows.length) * 100,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "ko")),
        keywords: [...keywords]
          .map(([name, count]) => ({ name, count }))
          .sort(
            (a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"),
          ),
        keyword_checked: rows.filter((r) => r.keywords_at_capture != null)
          .length,
      };
    })
    .sort(
      (a, b) => b.count - a.count || a.category.localeCompare(b.category, "ko"),
    );
}
