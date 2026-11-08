import { productSearchPlaceholder } from "../shared/productSearch";
import { useEffect, useState } from "react";
import { type ProductHistoryTable } from "../shared/analytics";
import { collectionCategories } from "../shared/browserCapture";
import { params, useData, useDebouncedValue } from "./analyticsApi";
import type { Category } from "./RankingsPanel";

export function ProductHistoryPanel({
  productId,
  initialCategory,
  categories,
  revision,
}: {
  productId: string | null;
  initialCategory: string;
  categories: Category[];
  revision: string;
}) {
  const [category, setCategory] = useState(initialCategory),
    [search, setSearch] = useState(""),
    [cursors, setCursors] = useState<string[]>([""]),
    [status, setStatus] = useState("ALL"),
    [focus, setFocus] = useState(productId);
  useEffect(() => {
    setFocus(productId);
    setCursors([""]);
  }, [productId]);
  useEffect(() => {
    setCursors([""]);
  }, [revision]);
  const cursor = cursors[cursors.length - 1];
  const debounced = useDebouncedValue(search);
  const history = useData<ProductHistoryTable>(
    "product-history?" +
      params({
        category,
        include_dates: "0",
        query: debounced,
        status,
        v: revision,
        ...(cursor ? { cursor } : {}),
        ...(focus ? { product_id: focus } : {}),
      }),
  );
  const rank = (value: number | null, average = false) =>
    value === null ? "기록 없음" : `${average ? value.toFixed(1) : value}위`;
  return (
    <article>
      <div className="card-title">
        <h2>상품별 순위 이력</h2>
      </div>
      <div className="ranking-filters">
        <label>
          카테고리{" "}
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setCursors([""]);
              setFocus(null);
            }}
          >
            {categories
              .filter((c) => Object.hasOwn(collectionCategories, c.code))
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.display_name}
                </option>
              ))}
          </select>
        </label>
        <label>
          검색{" "}
          <input
            type="search"
            value={search}
            placeholder={productSearchPlaceholder}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursors([""]);
              setFocus(null);
            }}
          />
        </label>
        <label>
          현재 상태{" "}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursors([""]);
            }}
          >
            <option value="ALL">전체 (이탈 포함)</option>
            <option value="RANKED">순위권</option>
            <option value="EXIT">이탈</option>
          </select>
        </label>
      </div>
      {focus && (
        <p>
          선택한 상품의 이력을 표시합니다.{" "}
          <button
            onClick={() => {
              setFocus(null);
              setCursors([""]);
            }}
          >
            전체 상품 보기
          </button>
        </p>
      )}
      <p className="muted">
        최근 수집일의 순위순으로 표시합니다. 이탈 상품은 뒤에 마지막 기록
        순위순으로 표시합니다. 최고·최저·평균은 해당 카테고리 전체 기록
        기준이며, 순위를 알 수 없는 이탈일과 미수집일은 통계에서 제외합니다.
      </p>
      {history.error && <p role="alert">{history.error}</p>}
      {history.loading && <p role="status">상품 이력을 불러오는 중…</p>}
      {history.data && (
        <>
          <p role="status">
            {history.data.items.length}개 상품 · 현재 상태 기준일{" "}
            {history.data.latest_date || "기록 없음"}
          </p>
          <div
            className="table-wrap history-matrix"
            tabIndex={0}
            aria-label="상품별 순위 요약 표"
          >
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">브랜드</th>
                  <th scope="col">상품명</th>
                  <th scope="col">상품 대분류</th>
                  <th scope="col">현재 순위·상태</th>
                  <th scope="col">최고 순위</th>
                  <th scope="col">최저 순위</th>
                  <th scope="col">평균 순위</th>
                  <th scope="col">순위 기록일</th>
                  <th scope="col">최초 진입</th>
                  <th scope="col">마지막 순위 기록</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((item) => (
                  <tr key={item.product.product_id}>
                    <td>{item.product.brand_name}</td>
                    <td>
                      <span>{item.product.product_name}</span>
                      <small className="history-product-id">
                        {item.product.product_id}
                      </small>
                      {/^https?:\/\//.test(item.product.product_url) && (
                        <a
                          href={item.product.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          상품 보기
                        </a>
                      )}
                    </td>
                    <td>{item.product.product_category || "미수집"}</td>
                    <td>
                      {item.current_rank === null ? (
                        <span className="movement movement-EXIT">이탈</span>
                      ) : (
                        rank(item.current_rank)
                      )}
                    </td>
                    <td>{rank(item.summary.best_rank)}</td>
                    <td>{rank(item.summary.worst_rank)}</td>
                    <td>{rank(item.summary.average_rank, true)}</td>
                    <td>{item.summary.ranked_days}일</td>
                    <td>{item.summary.first_entry_date}</td>
                    <td>{item.summary.last_record_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!history.data.items.length && (
            <p className="empty">조건에 맞는 상품 이력이 없습니다.</p>
          )}
          <div className="pagination">
            <button
              disabled={
                cursors.length <= 1 || history.loading || debounced !== search
              }
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
            >
              이전
            </button>
            <button
              disabled={
                !history.data.next_cursor ||
                history.loading ||
                debounced !== search
              }
              onClick={() => {
                const next = history.data?.next_cursor;
                if (next) setCursors((previous) => [...previous, next]);
              }}
            >
              다음
            </button>
          </div>
        </>
      )}
    </article>
  );
}
