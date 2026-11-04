import { useState } from "react";
import type { DashboardData } from "../shared/analytics";
import { params, useData } from "./analyticsApi";
import { RankingTable, type Category, type OpenProduct } from "./RankingsPanel";
export function DashboardPanel({
  categories,
  onProduct,
  revision,
}: {
  categories: Category[];
  onProduct: OpenProduct;
  revision: string;
}) {
  const [category, setCategory] = useState("overall");
  const data = useData<DashboardData>(
    "dashboard?" + params({ category, v: revision }),
  );
  const d = data.data;
  return (
    <>
      <article>
        <div className="card-title">
          <h2>랭킹 현황</h2>
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
        {data.loading && <p role="status">현황을 불러오는 중…</p>}
        {data.error && <p role="alert">{data.error}</p>}
        {d && (
          <>
            <div className="history-summary">
              <span>
                최근 수집일 <b>{d.latest_date || "기록 없음"}</b>
              </span>
              <span>
                활성 스냅샷 <b>{d.active_snapshots}개</b>
              </span>
              <span>
                보존된 완료 버전 <b>{d.stored_versions}개</b>
              </span>
            </div>
            <p>
              {d.compared_to
                ? `${d.compared_to} 직전 성공일 대비${d.missing_days ? " · 중간 " + d.missing_days + "일 미수집" : ""}`
                : "이전 성공 기록이 없어 등락 비교를 하지 않습니다."}
            </p>
            <h3>최근 7일 실행 상태</h3>
            <div className="execution-days">
              {d.days.map((day) => (
                <div
                  key={day.date}
                  className={"execution-day status-" + day.status}
                >
                  <span>{day.date.slice(5)}</span>
                  <b>
                    {
                      {
                        COMPLETE: "완료",
                        FAILED: "실패/취소",
                        RUNNING: "진행 중",
                        MISSING: "미실행",
                      }[day.status]
                    }
                  </b>
                  <small>
                    완료 {day.complete} · 실패/취소 {day.failed}
                    {day.running ? " · 진행 " + day.running : ""}
                  </small>
                </div>
              ))}
            </div>
            <p className="muted">
              실행 날짜는 KST 기준입니다. 과거 날짜 파일을 오늘 가져온 경우
              오늘의 실행으로 표시합니다.
            </p>
          </>
        )}
      </article>
      {d?.latest_date ? (
        <>
          <article>
            <h2>{d.latest_date} TOP 10</h2>
            <RankingTable
              items={d.top}
              category={category}
              onProduct={onProduct}
            />
          </article>
          <article>
            <h2>순위 상승 TOP 10</h2>
            <RankingTable
              items={d.rising}
              category={category}
              onProduct={onProduct}
            />
          </article>
          <article>
            <h2>신규 진입 TOP 10</h2>
            <p>
              직전 성공일의 100위권에 없던 상품입니다. 최초 판매 상품이라는 뜻은
              아닙니다.
            </p>
            <RankingTable
              items={d.new_entries}
              category={category}
              onProduct={onProduct}
            />
          </article>
        </>
      ) : (
        !data.loading &&
        !data.error && (
          <article>
            <h2>첫 번째 랭킹을 기록하세요</h2>
            <p>
              수집 버튼 또는 가져오기로 데이터를 저장하면 TOP 10과 변동 정보가
              표시됩니다.
            </p>
          </article>
        )
      )}
    </>
  );
}
