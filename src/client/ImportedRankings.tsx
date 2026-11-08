import { useEffect, useState } from "react";
type Entry = {
  rank: number;
  product_id: string;
  brand_name_at_capture: string;
  product_name_at_capture: string;
  product_url_at_capture: string;
};
export function ImportedRankings({
  dates,
  categories,
}: {
  dates: string[];
  categories: { code: string; display_name: string }[];
}) {
  const [date, setDate] = useState(
    dates[0] ||
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
        new Date(),
      ),
  );
  const [category, setCategory] = useState("overall");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setEntries([]);
    setError("");
    fetch(
      `/api/rankings?date=${encodeURIComponent(date)}&category=${encodeURIComponent(category)}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw Error("랭킹 조회 실패");
        return r.json() as Promise<Entry[]>;
      })
      .then(setEntries)
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [date, category]);
  return (
    <article>
      <h2>저장된 랭킹</h2>
      <p>
        완료 검증을 통과한 활성 스냅샷만 표시합니다. 가격과 이미지는 표시하지
        않습니다.
      </p>
      <div className="ranking-filters">
        <label>
          날짜{" "}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
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
      </div>
      <p role="status">{error || `${entries.length}개 상품`}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>브랜드</th>
              <th>상품명</th>
              <th>링크</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((r) => (
              <tr key={r.product_id}>
                <td>{r.rank}</td>
                <td>{r.brand_name_at_capture}</td>
                <td>{r.product_name_at_capture}</td>
                <td>
                  {/^https:\/\/www\.oliveyoung\.co\.kr\/store\/goods\/getGoodsDetail\.do\?goodsNo=A\d{12}$/.test(
                    r.product_url_at_capture,
                  ) && (
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
      </div>
      {!entries.length && !error && (
        <p>선택한 날짜·카테고리에 완료된 기록이 없습니다.</p>
      )}
    </article>
  );
}
