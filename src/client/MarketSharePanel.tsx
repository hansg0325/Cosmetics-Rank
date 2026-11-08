import { useState } from "react";
import type { MarketShare } from "../shared/marketShare";
import { params, useData } from "./analyticsApi";

const percent = (value: number) => `${Number(value.toFixed(1))}%`;
export function MarketSharePanel({ revision }: { revision: string }) {
  const [chosenDate, setDate] = useState("");
  const dates = useData<{ dates: string[] }>(
    "dates?" + params({ category: "overall", v: revision }),
  );
  const date = chosenDate || dates.data?.dates[0] || "";
  const data = useData<MarketShare>(
    date ? "market-share?" + params({ date, v: revision }) : null,
  );
  const d = data.data;
  return (
    <article className="share-panel">
      <div className="share-heading">
        <label>
          수집일
          <select
            aria-label="점유율 분석 수집일"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!dates.data?.dates.length}
          >
            {!dates.data?.dates.length && (
              <option value="">수집 기록 없음</option>
            )}
            {dates.data?.dates.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(dates.loading || data.loading) && (
        <p role="status">점유율을 불러오는 중…</p>
      )}
      {(dates.error || data.error) && (
        <p role="alert">{dates.error || data.error}</p>
      )}
      {!dates.loading && !dates.error && !date && (
        <div className="share-empty">
          전체 랭킹을 수집하면 점유율 분석이 표시됩니다.
        </div>
      )}
      {d && (
        <>
          {!d.has_snapshot ? (
            <div className="share-empty">
              해당 날짜에 완료된 전체 랭킹이 없습니다.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="share-table">
                <thead>
                  <tr>
                    <th>카테고리명</th>
                    <th>전체 랭킹 내 상품 수</th>
                    <th>최대 점유 브랜드</th>
                    <th>키워드</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((row) => (
                    <tr key={row.category}>
                      <td>
                        <b>{row.category}</b>
                      </td>
                      <td>
                        <div className="share-count">
                          <b>{row.count}개</b>
                          <span>{percent(row.share)}</span>
                        </div>
                        <div className="share-track">
                          <div style={{ width: `${row.share}%` }} />
                        </div>
                      </td>
                      <td>
                        <div className="share-brands">
                          {row.top_brands.length ? (
                            row.top_brands.map((brand) => (
                              <span key={brand.name}>
                                {brand.name} <b>{percent(brand.share)}</b>
                                <small>({brand.count}개)</small>
                              </span>
                            ))
                          ) : (
                            <span className="share-muted">브랜드 미수집</span>
                          )}
                        </div>
                        {row.top_brands.length > 1 && (
                          <small className="share-muted">공동 1위</small>
                        )}
                      </td>
                      <td>
                        <div className="share-keywords">
                          {row.keywords.map((keyword) => (
                            <span key={keyword.name}>
                              {keyword.name}
                              <b>{keyword.count}</b>
                            </span>
                          ))}
                        </div>
                        {!row.keywords.length && (
                          <span className="share-muted">
                            {row.keyword_checked
                              ? "확인된 키워드 없음"
                              : "성분 미수집"}
                          </span>
                        )}
                        <small className="share-coverage">
                          성분 확인 {row.keyword_checked}/{row.count}개
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="share-footnote">
            브랜드 점유율은 해당 카테고리 상품 수 기준입니다. 키워드 옆 숫자는
            해당 키워드가 수집된 상품 수이며, 한 상품에 여러 키워드가 포함될 수
            있습니다.
          </p>
        </>
      )}
    </article>
  );
}
