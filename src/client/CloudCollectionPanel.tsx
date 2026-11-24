import { useEffect, useRef, useState } from "react";
type Run = {
  dryRun?: boolean;
  issues?: { diagnostic?: { excerpt?: string } }[];
  id: string;
  recoverable?: boolean;
  status: string;
  phase: string;
  rankingCount: number;
  detailIndex: number;
  targetIds: string[];
  targetCount?: number;
  failedDetails?: number;
  stopReason?: string;
  reviews: number;
  ingredients: number;
  disclosures: number;
  staticReused: number;
  browserMs: number;
  closeStatus: string;
  error?: string;
};
type Status = {
  active: Run | null;
  history: Run[];
  budget: {
    usedMs: number;
    limitMs: number;
    estimatedBaseAndBrowserCost: number;
  };
};
const statusLabels: Record<string, string> = {
  RUNNING: "수집 중",
  COMPLETE: "완료",
  FAILED: "실패",
  PARTIAL: "일부 미완료",
  CANCELLED: "중단",
};
const phaseLabels: Record<string, string> = {
  rankings: "랭킹 조회",
  details: "상세 조회",
  save: "저장",
};
const closeLabels: Record<string, string> = {
  OPEN: "실행 중",
  CLOSED: "종료 완료",
  NOT_STARTED: "시작 전",
  CLOSE_RETRY_REQUIRED: "종료 확인 중",
  AWAITING_IDLE_TIMEOUT: "자동 종료 대기",
  IDLE_TIMEOUT_ELAPSED: "유휴 만료시간 경과",
};
export function CloudCollectionPanel({
  onComplete,
}: {
  onComplete?: () => void;
}) {
  const previousRun = useRef<string | null>(null);
  const [data, setData] = useState<Status>();
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const r = await fetch("/api/admin/cloud-collector");
      if (!r.ok) throw Error(`상태 확인 실패 (${r.status})`);
      setData(await r.json());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, []);
  const run = data?.active || data?.history[0];
  const unavailable =
    run?.issues?.filter((i) =>
      i.diagnostic?.excerpt?.includes("상품을 찾을 수 없어요"),
    ).length || 0;
  useEffect(() => {
    if (data && previousRun.current && !data.active) onComplete?.();
    previousRun.current = data?.active?.id || null;
  }, [data, onComplete]);
  return (
    <div aria-live="polite">
      <p>Cloudflare · 브라우저 1개 · 상품 간격 2초 · 매일 오전 6시</p>
      {data && (
        <p>
          이번 결제기간 사용량(예비분 포함):{" "}
          {(data.budget.usedMs / 3600000).toFixed(2)} /{" "}
          {data.budget.limitMs / 3600000}시간 · 기본료+브라우저 예상 $
          {data.budget.estimatedBaseAndBrowserCost.toFixed(2)}
          <br />
          전체 청구액의 확정 상한은 아니며 기타 서비스와 세금은 별도입니다.
        </p>
      )}
      {run && (
        <p>
          {run.dryRun ? "테스트(저장 없음)" : "운영 수집"} ·{" "}
          {statusLabels[run.status] || run.status} ·{" "}
          {phaseLabels[run.phase] || run.phase} ·{" "}
          {!(
            run.dryRun &&
            run.rankingCount === 0 &&
            run.phase !== "rankings"
          ) && <>랭킹 {run.rankingCount}/1000 · </>}
          상세 {run.detailIndex}
          {data?.active
            ? `/${run.targetIds.length}`
            : run.targetCount
              ? `/${run.targetCount}`
              : ""}{" "}
          · 리뷰 {run.reviews} · 제조정보 {run.disclosures} · 성분{" "}
          {run.ingredients} · 정적정보 재사용 {run.staticReused}
          <br />
          브라우저 예산 반영 {(run.browserMs / 60000).toFixed(1)}분 (실행 중
          예약분 포함) · 종료 상태{" "}
          {closeLabels[run.closeStatus] || run.closeStatus}
          {run.error && ` · ${run.error}`}
          {!!run.failedDetails && ` · 상세 누락 ${run.failedDetails}개`}
          {!!unavailable && ` (사이트 상품 없음 응답 ${unavailable}개)`}
          {run.stopReason && !run.error && ` · ${run.stopReason}`}
        </p>
      )}
      {data?.active && (
        <button
          onClick={async () => {
            await fetch("/api/admin/cloud-collector/cancel", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            });
            await refresh();
          }}
        >
          수집 중단 요청
        </button>
      )}
      {run?.recoverable && !data?.active && (
        <button
          onClick={async () => {
            try {
              const r = await fetch("/api/admin/cloud-collector/resume", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id: run.id }),
              });
              if (!r.ok) throw Error(`이어가기 실패 (${r.status})`);
              await refresh();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          중단 지점부터 이어가기
        </button>
      )}
      {error && <p>{error}</p>}
    </div>
  );
}
