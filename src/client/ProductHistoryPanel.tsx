import { useState } from "react";
import {
  shiftDay,
  type ProductHistory,
  type ProductSummary,
} from "../shared/analytics";
import { params, useData, useDebouncedValue } from "./analyticsApi";
import { RankChart } from "./RankChart";
import type { Category, OpenProduct } from "./RankingsPanel";
export function ProductHistoryPanel({
  productId,
  initialCategory,
  categories,
  onProduct,
  revision,
}: {
  productId: string | null;
  initialCategory: string;
  categories: Category[];
  onProduct: OpenProduct;
  revision: string;
}) {
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState(""),
    [category, setCategory] = useState(initialCategory);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const [from, setFrom] = useState(shiftDay(today, -29)),
    [to, setTo] = useState(today);
  const debounced = useDebouncedValue(search);
  const products = useData<{
    items: ProductSummary[];
    next_cursor: string | null;
  }>(
    "products?" +
      params({
        query: debounced,
        limit: 20,
        ...(cursor ? { cursor } : {}),
        v: revision,
      }),
  );
  const history = useData<ProductHistory>(
    productId && from && to
      ? "products/" +
          encodeURIComponent(productId) +
          "/history?" +
          params({ category, from, to, v: revision })
      : null,
  );
  return (
    <>
      <article>
        <h2>상품 찾기</h2>
        <div className="ranking-filters">
          <label>
            상품명·브랜드{" "}
            <input
              type="search"
              placeholder="상품명 또는 브랜드 검색"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor("");
              }}
            />
          </label>
        </div>
        {products.error && <p role="alert">{products.error}</p>}
        {products.loading && <p role="status">상품을 검색하는 중…</p>}
        <div className="product-results">
          {products.data?.items.map((p) => (
            <button
              key={p.product_id}
              className={
                p.product_id === productId
                  ? "product-result selected-product"
                  : "product-result"
              }
              onClick={() => onProduct(p.product_id, category)}
            >
              <b>{p.brand_name}</b>
              <span>{p.product_name}</span>
              <small>카테고리: {p.product_category || "미수집"}</small>
              <small>
                {p.product_id} · 마지막 기록 {p.ranking_date}
              </small>
            </button>
          ))}
        </div>
        {products.data && !products.data.items.length && (
          <p>검색 결과가 없습니다.</p>
        )}
        <div className="pagination">
          {cursor && <button onClick={() => setCursor("")}>첫 페이지</button>}
          {products.data?.next_cursor && (
            <button onClick={() => setCursor(products.data!.next_cursor!)}>
              다음 20개
            </button>
          )}
        </div>
      </article>
      {productId ? (
        <article>
          <div className="ranking-filters">
            <label>
              카테고리{" "}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              시작일{" "}
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              종료일{" "}
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <p>한 번에 최대 180일 · 미수집일은 선을 연결하지 않습니다.</p>
          {history.error && <p role="alert">{history.error}</p>}
          {history.loading && <p role="status">상품 이력을 불러오는 중…</p>}
          {history.data && (
            <>
              <h2>
                {history.data.product.brand_name} ·{" "}
                {history.data.product.product_name}
              </h2>
              <p>
                상품 ID: {history.data.product.product_id} · 카테고리:{" "}
                {history.data.product.product_category || "미수집"}
              </p>
              <div className="history-summary">
                <span>
                  최초 진입{" "}
                  <b>{history.data.summary.first_entry_date || "기록 없음"}</b>
                </span>
                <span>
                  최고 순위{" "}
                  <b>
                    {history.data.summary.best_rank
                      ? history.data.summary.best_rank + "위"
                      : "기록 없음"}
                  </b>
                </span>
                <span>
                  마지막 기록{" "}
                  <b>{history.data.summary.last_record_date || "기록 없음"}</b>
                </span>
              </div>
              <p>요약은 선택한 카테고리의 전체 활성 기록 기준입니다.</p>
              {history.data.summary.last_record_date && (
                <button
                  onClick={() => {
                    const end = history.data!.summary.last_record_date!;
                    setTo(end);
                    const start = history.data!.summary.first_entry_date!;
                    setFrom(
                      start > shiftDay(end, -29) ? start : shiftDay(end, -29),
                    );
                  }}
                >
                  최근 기록이 있는 기간 보기
                </button>
              )}
              <RankChart
                title="상품 순위 이력"
                series={[
                  {
                    id: productId,
                    name: history.data.product.product_name,
                    brand: history.data.product.brand_name,
                    points: history.data.points,
                  },
                ]}
              />
            </>
          )}
        </article>
      ) : (
        <article>
          <p className="empty">
            상품을 선택하면 날짜별 순위와 기록 요약을 볼 수 있습니다.
          </p>
        </article>
      )}
    </>
  );
}
