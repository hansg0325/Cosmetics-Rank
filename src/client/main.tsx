import { formatCollectedAt } from "../shared/dateTime";
import { AdminExport } from "./AdminExport";
import { invalidateDataCache, useData } from "./analyticsApi";
import { MarketSharePanel } from "./MarketSharePanel";
import { KeywordSettings } from "./KeywordSettings";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RankingRow } from "../shared/schemas";
import type { BrowserCapture } from "../shared/browserCapture";
import "./style.css";
import { RankingsPanel } from "./RankingsPanel";
import { ProductHistoryPanel } from "./ProductHistoryPanel";
import { DashboardPanel } from "./DashboardPanel";
import { collectRankings } from "./collector";
import {
  collectionCategories,
  type CollectionCategory,
} from "../shared/browserCapture";
type Run = {
  id: string;
  ranking_date: string;
  collected_at?: string | null;
  category_code: string;
  status: string;
  entry_count: number;
  is_active: number;
  source_ref: string;
  detail_status: string;
  detail_total: number;
  detail_succeeded: number;
  detail_access_limited: number;
};
async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = (await r.json()) as {
    error?: string;
    count?: number;
    details?: unknown;
  };
  if (!r.ok)
    throw new Error(
      data.error +
        (data.count !== undefined ? ` (${data.count}/100)` : "") +
        (data.details ? ": " + JSON.stringify(data.details) : ""),
    );
  return data as T;
}
function App() {
  const localApp = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname,
  );
  const collectionLock = useRef(false);
  const [role, setRole] = useState<"admin" | "viewer" | null>(null);
  const [productId, setProductId] = useState<string | null>(null),
    [productCategory, setProductCategory] = useState("overall");
  const [page, setPage] = useState("대시보드"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [runs, setRuns] = useState<Run[]>([]),
    [runPage, setRunPage] = useState(0),
    [localCollectionCategory, setLocalCollectionCategory] =
      useState<CollectionCategory>("skincare"),
    [runsLoading, setRunsLoading] = useState(false),
    [hasNextRuns, setHasNextRuns] = useState(false),
    [categories, setCategories] = useState<
      { code: string; display_name: string }[]
    >([]);
  const loadRuns = async (index: number) => {
    setRunsLoading(true);
    try {
      const rows = await api<Run[]>(`admin/imports?offset=${index * 20}&limit=21`);
      setRuns(rows.slice(0, 20));
      setHasNextRuns(rows.length > 20);
      setRunPage(index);
    } finally {
      setRunsLoading(false);
    }
  };
  const refresh = async (isAdmin = role === "admin") => {
    await Promise.all([
      ...(isAdmin ? [loadRuns(runPage)] : []),
      api<{ code: string; display_name: string }[]>("categories").then(
        setCategories,
      ),
    ]);
  };
  useEffect(() => {
    const adminEntry = window.location.pathname.replace(/\/$/, "") === "/admin";
    const sessionPath = adminEntry ? "admin/session" : "me";
    api<{ role: "admin" | "viewer" }>(sessionPath)
      .then(async ({ role: nextRole }) => {
        setRole(adminEntry && nextRole === "admin" ? "admin" : "viewer");
        if (adminEntry && nextRole === "admin") setPage("관리자");
        await refresh(adminEntry && nextRole === "admin");
      })
      .catch((e) => {
        setRole("viewer");
        if (adminEntry) {
          window.history.replaceState(null, "", "/");
          setMessage("관리자 로그인이 필요합니다. 다시 관리자 탭을 선택하세요.");
        } else {
          setMessage(String(e));
        }
      });
  }, []);
  async function upload(inputRows: RankingRow[], inputCapture: BrowserCapture) {
    let current: string | undefined;
    try {
      const groups = new Map<string, RankingRow[]>();
      for (const r of inputRows) {
        const key = r.ranking_date + "/" + r.category_code;
        groups.set(key, [...(groups.get(key) || []), r]);
      }
      let done = 0;
      for (const group of groups.values()) {
        group.sort((a, b) => a.rank - b.rank);
        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify(group)),
            ),
          ),
        )
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
        const run = await api<{ id: string; already_complete: boolean }>(
          "imports",
          {
            ranking_date: group[0].ranking_date,
            category_code: group[0].category_code,
            collected_at:
              inputCapture?.collected_at || new Date().toISOString(),
            source_ref: "selenium:" + hash,
            replace: true,
            source_type: "MANUAL",
            ...(inputCapture.detail_summary
              ? { detail_summary: inputCapture.detail_summary }
              : {}),
          },
        );
        if (!run.already_complete) {
          current = run.id;
          for (let i = 0; i < group.length; i += 20) {
            await api(`imports/${run.id}/chunks`, {
              rows: group.slice(i, i + 20),
            });
            setMessage(`${done + i + 20}/${inputRows.length}행 저장 중`);
          }
          await api(`imports/${run.id}/complete`, { replace: true });
          current = undefined;
        }
        done += group.length;
      }
      invalidateDataCache();
      setMessage(`${done}행 처리 완료 · 동일한 내용은 중복 저장하지 않습니다`);
      await refresh();
    } catch (e) {
      invalidateDataCache();
      if (current)
        await api(`imports/${current}/cancel`, { failed: true }).catch(
          () => {},
        );
      setMessage(String(e));
      await refresh();
      throw e;
    }
  }
  async function collectNow() {
    if (busy || collectionLock.current) return;
    collectionLock.current = true;
    if (!localApp) {
      window.open("https://github.com/hansg0325/Cosmetics-Rank/actions/workflows/daily-collection.yml", "_blank", "noopener,noreferrer");
      setMessage("GitHub Actions에서 Run workflow를 눌러 수집을 시작하세요.");
      return;
    }
    setBusy(true);
    setMessage(
      `${collectionCategories[localCollectionCategory].name} 랭킹을 불러오는 중…`,
    );
    try {
      const targets = [localCollectionCategory];
      const failed: string[] = [];
      let completed = 0;
      const coverage = {
        total: 0,
        manufacturers: 0,
        sellers: 0,
        ingredients: 0,
        reviews: 0,
        ratings: 0,
      };
      for (const [index, category] of targets.entries()) {
        const name = collectionCategories[category].name;
        try {
          const parsed = await collectRankings(
            (text) => setMessage(`${index + 1}/${targets.length} · ${text}`),
            category,
          );
          await upload(parsed.rows, parsed.capture);
          completed++;
          for (const field of Object.keys(
            coverage,
          ) as (keyof typeof coverage)[]) {
            coverage[field] +=
              parsed.coverage?.[field] ??
              (field === "total"
                ? parsed.rows.length
                : parsed.rows.filter(
                    (r) =>
                      (field === "manufacturers"
                        ? r.manufacturer_name
                        : field === "sellers"
                          ? r.seller_name
                          : field === "ingredients"
                            ? r.keywords
                            : field === "reviews"
                              ? r.review_count
                              : r.rating) != null,
                  ).length);
          }
        } catch (error) {
          failed.push(`${name}: ${String(error)}`);
        }
      }
      setMessage(
        `${targets.length}개 카테고리 취합 완료 · 성공 ${completed}개 (${completed * 100}행) · 실패 ${failed.length}개${failed.length ? " · " + failed.join(" / ") : ""} · 제조업자 ${coverage.manufacturers}/${coverage.total} · 판매업자 ${coverage.sellers}/${coverage.total} · 성분 ${coverage.ingredients}/${coverage.total} · 리뷰 수 ${coverage.reviews}/${coverage.total} · 평점 ${coverage.ratings}/${coverage.total}`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      collectionLock.current = false;
      setBusy(false);
    }
  }
  const revision = runs
    .map((r) => r.id + ":" + r.status + ":" + r.is_active)
    .join("|")
    .split("")
    .reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) | 0, 0)
    .toString(36);
  const collectionStatus = useData<{ latest_collected_at: string | null }>(
    "collection-status?v=" + revision,
  );
  const lastCollected = collectionStatus.data?.latest_collected_at;
  const lastCollectedDate = lastCollected
    ? formatCollectedAt(lastCollected)
    : null;
  const openProduct = (id: string, category: string) => {
    setProductId(id);
    setProductCategory(category);
    setPage("상품 이력");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div className="shell">
      <header className="app-header">
        <div className="brand-lockup">
          <a className="logo" href="/">
            cosmetics <span>rank</span>
          </a>
          <img
            className="company-logo"
            src="/mark-teams-logo.png"
            alt="MARK & TEAMS · Global Cosmetics Full Service"
          />
        </div>
        <nav aria-label="주 메뉴">
          {[
            "대시보드",
            "랭킹",
            "순위 변동",
            "상품 이력",
            "점유율 분석",
            "설정",
            "관리자",
          ].map((p) => (
            <button
              key={p}
              className={p === page ? "selected" : ""}
              aria-current={p === page ? "page" : undefined}
              onClick={() => {
                if (p === "관리자" && role !== "admin") {
                  window.location.assign("/admin");
                  return;
                }
                setPage(p);
              }}
            >
              {p}
            </button>
          ))}
        </nav>
        <div className="app-last-collection" aria-label="최근 수집일">
          <span>최근 수집일</span>
          <b>
            {collectionStatus.error
              ? "조회 실패"
              : collectionStatus.loading
                ? "확인 중"
                : lastCollectedDate || "수집 기록 없음"}
          </b>
        </div>
      </header>
      <main>
        <p role="status" className="message">
          {message}
        </p>
        {page === "대시보드" && (
          <DashboardPanel onProduct={openProduct} revision={revision} />
        )}
        {role === "admin" && page === "관리자" && (
          <article>
            <h2>랭킹 데이터 수집</h2>
            {localApp && (
              <label className="local-collection-category">
                수집 카테고리
                <select
                  value={localCollectionCategory}
                  disabled={busy}
                  onChange={(event) =>
                    setLocalCollectionCategory(
                      event.target.value as CollectionCategory,
                    )
                  }
                >
                  {Object.entries(collectionCategories).map(([code, item]) => (
                    <option key={code} value={code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {localApp && (
              <p>이 PC의 로컬 DB에 선택한 카테고리만 저장합니다.</p>
            )}
            <button
              className="primary"
              disabled={busy}
              onClick={() => void collectNow()}
            >
              {busy ? "데이터 수집 중…" : "데이터 수집"}
            </button>
          </article>
        )}
        {page === "점유율 분석" && <MarketSharePanel revision={revision} />}
        {page === "설정" && (
          <>
            {role === "admin" && <AdminExport disabled={busy} />}
            <KeywordSettings />
          </>
        )}
        {["랭킹", "순위 변동"].includes(page) && (
          <RankingsPanel
            key={page}
            categories={categories.filter((category) =>
              Object.hasOwn(collectionCategories, category.code),
            )}
            onProduct={openProduct}
            revision={revision}
            chartOnly={page === "순위 변동"}
          />
        )}
        {page === "상품 이력" && (
          <ProductHistoryPanel
            key={productCategory}
            productId={productId}
            initialCategory={productCategory}
            categories={categories}
            revision={revision}
          />
        )}
        {role === "admin" && page === "관리자" && (
          <article>
            <div className="card-title">
              <h2>최근 수집 이력</h2>
              <button
                disabled={busy}
                onClick={() =>
                  void refresh().catch((e) => setMessage(String(e)))
                }
              >
                새로고침
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>수집 일시 (KST)</th>
                    <th>카테고리</th>
                    <th>저장 행</th>
                    <th>랭킹 상태</th>
                    <th>상세 조회</th>
                    <th>입력 경로</th>
                    <th>활성</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{formatCollectedAt(r.collected_at)}</td>
                      <td>{r.category_code}</td>
                      <td>{r.entry_count}/100</td>
                      <td>
                        <span className={`badge status-${r.status}`}>
                          {r.status === "COMPLETE"
                            ? "랭킹 완료"
                            : r.status === "FAILED"
                              ? "랭킹 실패"
                              : r.status === "RUNNING"
                                ? "수집 중"
                                : r.status === "PARTIAL"
                                  ? "부분 성공"
                                : r.status === "CANCELLED"
                                  ? "취소"
                                  : r.status}
                        </span>
                      </td>
                      <td>
                        <span className={`badge status-${r.detail_status}`}>
                          {r.detail_status === "COMPLETE"
                            ? "상세 완료"
                            : r.detail_status === "PARTIAL"
                              ? "상세 부분 실패"
                              : r.detail_status === "FAILED"
                                ? "상세 실패"
                                : r.detail_status === "NOT_COLLECTED"
                                  ? "미수집"
                                  : "기록 없음"}
                        </span>
                        {r.detail_total > 0 && (
                          <small className="detail-coverage">
                            {r.detail_succeeded}/{r.detail_total} 성공
                            {r.detail_access_limited > 0 &&
                              ` · 접속 제한 ${r.detail_access_limited}`}
                          </small>
                        )}
                      </td>
                      <td>
                        {r.source_ref?.startsWith("selenium:")
                          ? "Selenium · 버튼 수집"
                          : r.source_ref?.startsWith("browser:")
                            ? "실제 랭킹 · 브라우저"
                            : r.source_ref?.startsWith("fixture:")
                              ? "가상 샘플"
                              : "수동/샘플"}
                      </td>
                      <td>
                        {r.is_active ? "활성" : "—"}{" "}
                        {r.status === "RUNNING" && (
                          <button
                            onClick={() =>
                              void api(`admin/imports/${r.id}/cancel`, {})
                                .then(() => refresh())
                                .catch((e) => setMessage(String(e)))
                            }
                          >
                            취소
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!runs.length && runPage === 0 && !runsLoading && (
                <p className="empty">아직 수집한 데이터가 없습니다.</p>
              )}
            </div>
            <div className="pagination">
              <button
                disabled={runPage === 0 || runsLoading}
                onClick={() =>
                  void loadRuns(runPage - 1).catch((e) => setMessage(String(e)))
                }
              >
                이전
              </button>
              <span>{runPage + 1}페이지</span>
              <button
                disabled={!hasNextRuns || runsLoading}
                onClick={() =>
                  void loadRuns(runPage + 1).catch((e) => setMessage(String(e)))
                }
              >
                다음
              </button>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
