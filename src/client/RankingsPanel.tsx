import { useEffect, useState } from "react";
import type {
  Comparison,
  ChangeEntry,
  ProductHistory,
} from "../shared/analytics";
import { daysBetween, shiftDay } from "../shared/analytics";
import { params, useData } from "./analyticsApi";
import { RankChart, type RankSeries } from "./RankChart";
export type Category = { code: string; display_name: string };
export type OpenProduct = (id: string, category: string) => void;
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
}: {
  items: ChangeEntry[];
  onProduct: OpenProduct;
  category: string;
}) {
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
            <th>원본</th>
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
  candidates,
  category,
  from,
  to,
  revision,
}: {
  ids: string[];
  candidates: ChangeEntry[];
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
      const series: RankSeries[] = [];
      try {
        for (let i = 0; i < ids.length; i += 3) {
          const group = await Promise.all(
            ids.slice(i, i + 3).map(async (id) => {
              const response = await fetch(
                "/api/products/" +
                  encodeURIComponent(id) +
                  "/history?" +
                  params({ category, from, to }),
                { signal: controller.signal },
              );
              if (!response.ok) throw Error("상품 이력 조회 실패");
              return (await response.json()) as ProductHistory;
            }),
          );
          for (const history of group)
            series.push({
              id: history.product.product_id,
              name: history.product.product_name,
              brand: history.product.brand_name,
              points: history.points,
            });
        }
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
  if (!ids.length)
    return <p>비교할 상품을 선택하세요. 최대 30개까지 비교할 수 있습니다.</p>;
  if (state.key !== key)
    return <p role="status">{ids.length}개 상품의 순위 이력을 불러오는 중…</p>;
  if (state.error) return <p role="alert">{state.error}</p>;
  return (
    <>
      <RankChart series={state.series} />
      <p className="muted">
        선택 상품 {candidates.filter((r) => ids.includes(r.product_id)).length}
        개 · 미수집과 100위권 밖은 날짜별 데이터에서 구분합니다.
      </p>
    </>
  );
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
    [picker, setPicker] = useState("");
  const dates = useData<{ dates: string[] }>(
    "dates?" + params({ category, v: revision }),
  );
  const date = chosenDate || dates.data?.dates[0] || "";
  const data = useData<Comparison>(
    date ? "changes?" + params({ date, category, v: revision }) : null,
  );
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({
      key: "",
      ids: [],
    }),
    [range, setRange] = useState<{ key: string; from: string; to: string }>({
      key: "",
      from: "",
      to: "",
    });
  const key = category + "/" + date + "/" + (data.data?.snapshot_id ?? "none");
  const candidates = data.data?.items || [];
  const defaults = candidates
    .filter((r) => r.rank !== null)
    .sort((a, b) => a.rank! - b.rank!)
    .slice(0, 30)
    .map((r) => r.product_id);
  const ids = selection.key === key ? selection.ids : defaults;
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
        (!needle ||
          (r.brand_name_at_capture + " " + r.product_name_at_capture)
            .toLowerCase()
            .includes(needle)) &&
        (filter === "ALL" || r.movement === filter),
    )
    .sort((a, b) => (a.rank ?? 101) - (b.rank ?? 101));
  return (
    <>
      <article>
        <div className="card-title">
          <h2>
            {chartOnly
              ? "순위 변동 조회"
              : analysis
                ? "직전 수집일 대비 분석"
                : "날짜별 랭킹"}
          </h2>
          <span>완료된 활성 기록만 표시</span>
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
            상품명·브랜드{" "}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명 또는 브랜드 검색"
            />
          </label>
          <label>
            변동{" "}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
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
            <p>
              {data.data.compared_to
                ? `직전 수집 성공일 ${data.data.compared_to} 대비`
                : "이전 수집 기록이 없어 등락을 비교하지 않습니다."}
              {data.data.missing_days > 0 &&
                ` · 중간 ${data.data.missing_days}일 미수집`}
            </p>
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
                <p role="status">{items.length}개 상품</p>
                {!chartOnly && (
                  <RankingTable
                    items={items}
                    category={category}
                    onProduct={onProduct}
                  />
                )}
              </>
            )}
          </>
        )}
        {!date && !dates.loading && !dates.error && (
          <p className="empty">이 카테고리에는 수집 기록이 없습니다.</p>
        )}
      </article>
      {chartOnly && data.data?.has_snapshot && (
        <article>
          <div className="card-title">
            <h2>상품별 순위 변동 비교</h2>
            <span>최대 30개 · 최대 180일</span>
          </div>
          <div className="ranking-filters">
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
          </div>
          <details className="series-picker">
            <summary>비교 상품 선택 ({ids.length}/30)</summary>
            <input
              aria-label="비교 상품 검색"
              type="search"
              placeholder="비교할 상품 찾기"
              value={picker}
              onChange={(e) => setPicker(e.target.value)}
            />
            <div className="picker-options">
              {candidates
                .filter((r) =>
                  (r.brand_name_at_capture + " " + r.product_name_at_capture)
                    .toLowerCase()
                    .includes(picker.toLowerCase()),
                )
                .map((r) => (
                  <label key={r.product_id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(r.product_id)}
                      disabled={!ids.includes(r.product_id) && ids.length >= 30}
                      onChange={(e) =>
                        setSelection({
                          key,
                          ids: e.target.checked
                            ? [...ids, r.product_id]
                            : ids.filter((x) => x !== r.product_id),
                        })
                      }
                    />
                    {r.rank ?? "이탈"} · {r.brand_name_at_capture}{" "}
                    {r.product_name_at_capture}
                  </label>
                ))}
            </div>
          </details>
          <SeriesLoader
            ids={ids}
            candidates={candidates}
            category={category}
            from={from}
            to={to}
            revision={revision}
          />
        </article>
      )}
    </>
  );
}
