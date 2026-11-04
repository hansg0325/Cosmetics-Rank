import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RankingRow } from "../shared/schemas";
import type { BrowserCapture } from "../shared/browserCapture";
import "./style.css";
import { RankingsPanel } from "./RankingsPanel";
import { ProductHistoryPanel } from "./ProductHistoryPanel";
import { DashboardPanel } from "./DashboardPanel";
import { collectRankings } from "./collector";
type Run = {
  id: string;
  ranking_date: string;
  category_code: string;
  status: string;
  entry_count: number;
  is_active: number;
  source_ref: string;
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
  const collectionLock = useRef(false);
  const [productId, setProductId] = useState<string | null>(null),
    [productCategory, setProductCategory] = useState("overall");
  const [page, setPage] = useState("대시보드"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [runs, setRuns] = useState<Run[]>([]),
    [categories, setCategories] = useState<
      { code: string; display_name: string }[]
    >([]);
  const refresh = async () => {
    setRuns(await api<Run[]>("imports"));
    setCategories(
      await api<{ code: string; display_name: string }[]>("categories"),
    );
  };
  useEffect(() => {
    refresh().catch((e) => setMessage(String(e)));
  }, []);
  async function upload(inputRows: RankingRow[], inputCapture: BrowserCapture) {
    setBusy(true);
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
      setMessage(`${done}행 처리 완료 · 동일한 내용은 중복 저장하지 않습니다`);
      await refresh();
    } catch (e) {
      if (current)
        await api(`imports/${current}/cancel`, { failed: true }).catch(
          () => {},
        );
      setMessage(String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function collectNow() {
    if (busy || collectionLock.current) return;
    collectionLock.current = true;
    setBusy(true);
    setMessage("Chrome에서 전체 랭킹을 불러오는 중…");
    try {
      const parsed = await collectRankings(setMessage);
      await upload(parsed.rows, parsed.capture);
    } catch (error) {
      setMessage(String(error));
    } finally {
      collectionLock.current = false;
      setBusy(false);
    }
  }
  const complete = runs.filter((r) => r.status === "COMPLETE");
  const revision = runs
    .map((r) => r.id + ":" + r.status + ":" + r.is_active)
    .join("|")
    .split("")
    .reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) | 0, 0)
    .toString(36);
  const openProduct = (id: string, category: string) => {
    setProductId(id);
    setProductCategory(category);
    setPage("상품 이력");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div className="shell">
      <aside>
        <a className="logo" href="/">
          olive<span>rank</span>
          <small>나만의 랭킹 아카이브</small>
        </a>
        <nav>
          {[
            "대시보드",
            "랭킹",
            "분석",
            "순위 변동",
            "상품 이력",
            "내보내기",
            "설정",
          ].map((p) => (
            <button
              key={p}
              className={p === page ? "selected" : ""}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
        </nav>
        <div className="aside-foot">
          PRIVATE WORKSPACE
          <br />
          개인 랭킹 기록
        </div>
      </aside>
      <main>
        <header>
          <span>개인 데이터 워크스페이스</span>
          <span>
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              dateStyle: "long",
            }).format(new Date())}{" "}
            KST
          </span>
        </header>
        <section className="heading">
          <p className="eyebrow">OLIVERANK / OVERVIEW</p>
          <h1>{page}</h1>
          <p>매일의 순위를, 오래 남는 기록으로.</p>
        </section>
        <div className="notice">
          <span className="dot" />
          예약 수집 비활성화 · 버튼으로 전체 랭킹을 수집합니다.
          <small>DISABLED_NO_APPROVED_SOURCE</small>
        </div>
        <p role="status" className="message">
          {message}
        </p>
        {page === "대시보드" && (
          <article>
            <h2>실제 전체 랭킹 수집</h2>
            <p>
              버튼을 누르면 이 PC에서 Chrome을 실행해 100개를 읽고 바로
              저장합니다. 가격과 이미지는 제외합니다. 같은 날의 변경된 기록은 새
              버전으로 저장하며 이전 버전은 보존합니다.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void collectNow()}
            >
              {busy ? "수집·저장 중…" : "지금 수집하고 저장"}
            </button>{" "}
            <a
              href="/collector-help.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              수집 실행 안내
            </a>
          </article>
        )}
        {page === "대시보드" && (
          <>
            <div className="stats">
              <article>
                <label>완료 스냅샷 · 최근 100건</label>
                <strong>{complete.length}</strong>
                <small>검증된 날짜별 기록</small>
              </article>
              <article>
                <label>등록 카테고리</label>
                <strong>{categories.length}</strong>
                <small>제공 스키마 기준</small>
              </article>
              <article>
                <label>데이터 입력 방식</label>
                <strong className="text-value">버튼 수집</strong>
                <small>Chrome 자동 실행 · 전체 랭킹 수집</small>
              </article>
            </div>
            <DashboardPanel
              categories={categories}
              onProduct={openProduct}
              revision={revision}
            />
          </>
        )}
        {page === "설정" && (
          <article>
            <h2>무료 · 비공개 운영</h2>
            <p>
              허가된 자동 데이터 공급자는 연결되지 않았습니다. 로컬 인증으로
              기능을 검증하고, 실제 배포 전 Cloudflare Access에서 본인만
              허용해야 합니다.
            </p>
            <p>
              활성 카테고리: {categories.map((c) => c.display_name).join(", ")}
            </p>
          </article>
        )}
        {(page === "랭킹" || page === "분석" || page === "순위 변동") && (
          <RankingsPanel
            key={page}
            categories={categories}
            onProduct={openProduct}
            revision={revision}
            analysis={page === "분석"}
            chartOnly={page === "순위 변동"}
          />
        )}
        {page === "상품 이력" && (
          <ProductHistoryPanel
            key={productCategory}
            productId={productId}
            initialCategory={productCategory}
            categories={categories}
            onProduct={openProduct}
            revision={revision}
          />
        )}
        {![
          "대시보드",
          "설정",
          "랭킹",
          "분석",
          "순위 변동",
          "상품 이력",
        ].includes(page) && (
          <article>
            <h2>후속 단계에서 구현할 화면입니다</h2>
            <p>내보내기는 다음 단계에서 추가합니다.</p>
          </article>
        )}
        {page === "대시보드" && (
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
                    <th>날짜</th>
                    <th>카테고리</th>
                    <th>저장 행</th>
                    <th>상태</th>
                    <th>입력 경로</th>
                    <th>활성</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.ranking_date}</td>
                      <td>{r.category_code}</td>
                      <td>{r.entry_count}/100</td>
                      <td>
                        <span className="badge">{r.status}</span>
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
                              void api(`imports/${r.id}/cancel`, {})
                                .then(refresh)
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
              {!runs.length && (
                <p className="empty">아직 수집한 데이터가 없습니다.</p>
              )}
            </div>
          </article>
        )}
        <footer>
          OliveRank · 브라우저에서 가져온 실제 랭킹과 가상 샘플은 별도 출처로
          기록합니다.
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
