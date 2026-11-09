import {
  matchesProductSearch,
  productSearchPlaceholder,
} from "../shared/productSearch";
import { useEffect, useState } from "react";
import type {
  Comparison,
  ChangeEntry,
} from "../shared/analytics";
import { daysBetween, shiftDay } from "../shared/analytics";
import { getData, params, useData } from "./analyticsApi";
import { RankChart, type RankSeries } from "./RankChart";
export type Category = { code: string; display_name: string };
export type OpenProduct = (id: string, category: string) => void;
type RankingSortField = "rank" | "reviews" | "rating";
type SortDirection = "asc" | "desc";
type RankingSort = { field: RankingSortField; direction: SortDirection };
export function MovementBadge({ entry }: { entry: ChangeEntry }) {
  const text =
    entry.movement === "UP"
      ? `▲ ${entry.rank_change}`
      : entry.movement === "DOWN"
        ? `▼ ${Math.abs(entry.rank_change!)}`
        : entry.movement === "SAME"
          ? "—"
          : entry.movement === "NEW"
            ? "NEW"
            : entry.movement === "EXIT"
              ? "EXIT"
              : "비교 없음";
  return <span className={"movement movement-" + entry.movement}>{text}</span>;
}
export function RankingTable({
  items,
  onProduct,
  category,
  sort,
  onSort,
}: {
  items: ChangeEntry[];
  onProduct: OpenProduct;
  category: string;
  sort: RankingSort;
  onSort: (field: RankingSortField, direction: SortDirection) => void;
}) {
  function sortButtons(field: RankingSortField, label: string) {
    return (
      <div className="ranking-sort-buttons">
        {([
          ["asc", "↑ 오름"],
          ["desc", "↓ 내림"],
        ] as const).map(([direction, text]) => (
          <button
            key={direction}
            type="button"
            className="ranking-sort-button"
            aria-label={`${label} ${direction === "asc" ? "오름차순" : "내림차순"}`}
            aria-pressed={sort.field === field && sort.direction === direction}
            onClick={() => onSort(field, direction)}
          >
            {text}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="ranking-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>이전 순위</th>
            <th>변동</th>
            <th>브랜드</th>
            <th>카테고리</th>
            <th>상품명</th>
            <th>제조업자, 판매업자</th>
            <th>키워드</th>
            <th>
              <div className="ranking-sort-heading">
                <span>리뷰 수</span>
                {sortButtons("reviews", "리뷰 수")}
              </div>
            </th>
            <th>
              <div className="ranking-sort-heading">
                <span>평점 (5점)</span>
                {sortButtons("rating", "평점")}
              </div>
            </th>
            <th>링크</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.product_id}>
              <td>{r.rank ?? "—"}</td>
              <td>{r.previous_rank ?? "—"}</td>
              <td>
                <MovementBadge entry={r} />
              </td>
              <td>{r.brand_name_at_capture}</td>
              <td>{r.product_category_at_capture || "미수집"}</td>
              <td>
                <button
                  className="text-link"
                  onClick={() => onProduct(r.product_id, category)}
                >
                  {r.product_name_at_capture}
                </button>
              </td>
              <td
                className="product-detail-column"
                title={r.manufacturer_disclosure_at_capture || undefined}
              >
                {r.manufacturer_disclosure_at_capture || ""}
              </td>
              <td
                className="product-keywords-column"
                title={
                  r.keywords_at_capture == null
                    ? "성분 미수집"
                    : r.keywords_at_capture === ""
                      ? "지정 키워드 없음"
                      : "모든 성분 항목에서 문자열 일치"
                }
              >
                {r.keywords_at_capture || ""}
              </td>
              <td>
                {r.review_count_at_capture == null
                  ? "미수집"
                  : `${r.review_count_at_capture.toLocaleString("ko-KR")}건`}
              </td>
              <td>
                {r.rating_at_capture == null
                  ? r.review_count_at_capture === 0
                    ? "평가 없음"
                    : "미수집"
                  : r.rating_at_capture.toFixed(1)}
              </td>
              <td>
                {/^https?:\/\//.test(r.product_url_at_capture) && (
                  <a
                    href={r.product_url_at_capture}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    상품 보기
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="empty">표시할 상품이 없습니다.</p>}
    </div>
  );
}
function SeriesLoader({
  ids,
  category,
  from,
  to,
  revision,
}: {
  ids: string[];
  category: string;
  from: string;
  to: string;
  revision: string;
}) {
  const [state, setState] = useState<{
    key: string;
    series: RankSeries[];
    error: string;
  }>({ key: "", series: [], error: "" });
  const key = JSON.stringify({ ids, category, from, to, revision });
  const valid =
    !!from &&
    !!to &&
    Number.isFinite(daysBetween(from, to)) &&
    daysBetween(from, to) >= 0 &&
    daysBetween(from, to) <= 179;
  useEffect(() => {
    if (!valid || !ids.length) return;
    const controller = new AbortController();
    let ignored = false;
    async function load() {
      try {
        const query = new URLSearchParams({ category, from, to });
        for (const id of ids) query.append("id", id);
        const result = await getData<{ series: RankSeries[] }>(
          "rank-series?" + query,
          controller.signal,
        );
        const series = result.series;
        if (!ignored) setState({ key, series, error: "" });
      } catch (e) {
        if (!ignored) setState({ key, series: [], error: String(e) });
      }
    }
    void load();
    return () => {
      ignored = true;
      controller.abort();
    };
  }, [key]); // key contains every request parameter
  if (!valid)
    return <p role="alert">시작일부터 최대 180일 범위를 선택하세요.</p>;
  if (!ids.length) return <p>검색 조건에 맞는 상품이 없습니다.</p>;
  if (state.key !== key)
    return <p role="status">{ids.length}개 상품의 순위 이력을 불러오는 중…</p>;
  if (state.error) return <p role="alert">{state.error}</p>;
  return <RankChart series={state.series} />;
}
export function RankingsPanel({
  categories,
  onProduct,
  revision,
  analysis = false,
  chartOnly = false,
}: {
  categories: Category[];
  onProduct: OpenProduct;
  revision: string;
  analysis?: boolean;
  chartOnly?: boolean;
}) {
  const [category, setCategory] = useState("overall"),
    [chosenDate, setDate] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("ALL"),
    [sort, setSort] = useState<RankingSort>({ field: "rank", direction: "asc" });
  const dates = useData<{ dates: string[] }>(
    "dates?" + params({ category, v: revision }),
  );
  const date = chosenDate || dates.data?.dates[0] || "";
  const data = useData<Comparison>(
    date ? "changes?" + params({ date, category, v: revision }) : null,
  );
  const [range, setRange] = useState<{ key: string; from: string; to: string }>(
    { key: "", from: "", to: "" },
  );
  const key = category + "/" + date + "/" + (data.data?.snapshot_id ?? "none");
  const candidates = data.data?.items || [];
  const ids = candidates
    .filter((r) => r.rank !== null && matchesProductSearch(r, search))
    .sort((a, b) => a.rank! - b.rank!)
    .slice(0, 30)
    .map((r) => r.product_id);
  const earliest = dates.data?.dates.filter((d) => d <= date).at(-1);
  const defaultFrom = date ? shiftDay(date, -13) : "";
  const from =
      range.key === key
        ? range.from
        : earliest && earliest > defaultFrom
          ? earliest
          : defaultFrom,
    to = range.key === key ? range.to : date;
  const needle = search.trim().toLowerCase();
  const items = candidates
    .filter(
      (r) =>
        (analysis || r.rank !== null) &&
        matchesProductSearch(r, needle) &&
        (filter === "ALL" || r.movement === filter),
    )
    .sort((a, b) => {
      const left =
          sort.field === "rank"
            ? a.rank
            : sort.field === "reviews"
              ? a.review_count_at_capture
              : a.rating_at_capture,
        right =
          sort.field === "rank"
            ? b.rank
            : sort.field === "reviews"
              ? b.review_count_at_capture
              : b.rating_at_capture;
      if (left == null && right == null) return (a.rank ?? 101) - (b.rank ?? 101);
      if (left == null) return 1;
      if (right == null) return -1;
      const difference = Number(left) - Number(right);
      if (difference !== 0)
        return sort.direction === "asc" ? difference : -difference;
      return (a.rank ?? 101) - (b.rank ?? 101);
    });
  return (
    <>
      {!chartOnly && (
        <article>
          <div className="card-title">
            <h2>
              {chartOnly
                ? "순위 변동 조회"
                : analysis
                  ? "직전 수집일 대비 분석"
                  : "날짜별 랭킹"}
            </h2>
          </div>
          <div className="ranking-filters">
            <label>
              카테고리{" "}
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setDate("");
                  setFilter("ALL");
                }}
              >
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              날짜{" "}
              <input
                aria-label="랭킹 날짜"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              검색{" "}
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={productSearchPlaceholder}
              />
            </label>
            <label>
              변동{" "}
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  ["ALL", "전체"],
                  ["UP", "상승"],
                  ["DOWN", "하락"],
                  ["SAME", "동일"],
                  ["NEW", "신규 진입"],
                  ...(analysis ? [["EXIT", "이탈"]] : []),
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(data.error || dates.error) && (
            <p role="alert">{data.error || dates.error}</p>
          )}
          {(data.loading || dates.loading) && (
            <p role="status">랭킹을 불러오는 중…</p>
          )}
          {data.data && (
            <>
              <div className="change-stats">
                {(["UP", "DOWN", "NEW", "EXIT"] as const).map((m) => (
                  <span key={m}>
                    {{ UP: "상승", DOWN: "하락", NEW: "신규", EXIT: "이탈" }[m]}{" "}
                    <b>{data.data!.counts[m]}</b>
                  </span>
                ))}
              </div>
              {!data.data.has_snapshot ? (
                <p className="empty">
                  선택한 날짜에 완료된 수집 기록이 없습니다.
                </p>
              ) : (
                <>
                  {!chartOnly && (
                    <>
                      <p className="ranking-results-count">
                        현재 표시 상품 {items.length}개
                      </p>
                      <RankingTable
                        items={items}
                        category={category}
                        onProduct={onProduct}
                        sort={sort}
                        onSort={(field, direction) =>
                          setSort({ field, direction })
                        }
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
          {!date && !dates.loading && !dates.error && (
            <p className="empty">이 카테고리에는 수집 기록이 없습니다.</p>
          )}
        </article>
      )}
      {chartOnly && (
        <article>
          <div className="card-title">
            <h2>상품별 순위 변동 비교</h2>
            <span>최대 30개 · 최대 180일</span>
          </div>
          <div className="ranking-filters">
            <label>
              카테고리{" "}
              <select
                aria-label="순위 변동 카테고리"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setDate("");
                  setSearch("");
                }}
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
                onChange={(e) => setRange({ key, from: e.target.value, to })}
              />
            </label>
            <label>
              종료일{" "}
              <input
                type="date"
                value={to}
                onChange={(e) => setRange({ key, from, to: e.target.value })}
              />
            </label>
            <label>
              검색{" "}
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={productSearchPlaceholder}
              />
            </label>
          </div>
          {(data.error || dates.error) && (
            <p role="alert">{data.error || dates.error}</p>
          )}
          {data.loading || dates.loading ? (
            <p role="status">순위 이력을 불러오는 중…</p>
          ) : !data.data?.has_snapshot ? (
            <p className="empty">수집 기록이 없습니다.</p>
          ) : (
            <SeriesLoader
              ids={ids}
              category={category}
              from={from}
              to={to}
              revision={revision}
            />
          )}
        </article>
      )}
    </>
  );
}
