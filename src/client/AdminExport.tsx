import { useState } from "react";
import type { Comparison } from "../shared/analytics";
import { allRankingsWorkbook, downloadFile } from "./exporter";

export function AdminExport({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/export-rankings");
      if (!response.ok) throw Error("랭킹을 불러오지 못했습니다.");
      const comparisons = (await response.json()) as Comparison[];
      const buffer = await allRankingsWorkbook(comparisons);
      downloadFile(
        new Blob([new Uint8Array(buffer)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        "cosmetics-rank.xlsx",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "엑셀 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article>
      <h2>랭킹 내보내기</h2>
      <button disabled={disabled || busy} onClick={() => void save()}>
        {busy ? "엑셀 만드는 중…" : "엑셀 내보내기"}
      </button>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
