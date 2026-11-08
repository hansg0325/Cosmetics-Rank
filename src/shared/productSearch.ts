import type { ChangeEntry } from "./analytics";

export const productSearchPlaceholder =
  "상품명, 브랜드, 제조업자, 판매업자, 키워드";

export function matchesProductSearch(row: Partial<ChangeEntry>, query: string) {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    [
      row.product_name_at_capture,
      row.brand_name_at_capture,
      row.manufacturer_name_at_capture,
      row.seller_name_at_capture,
      row.manufacturer_disclosure_at_capture,
      row.keywords_at_capture,
    ].some((value) => value?.toLowerCase().includes(needle))
  );
}
