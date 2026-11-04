import { z } from "zod";
import { parseBrowserCapture } from "../shared/browserCapture";
const jobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["RUNNING", "COMPLETE", "FAILED"]),
  capture: z.unknown().optional(),
  message: z.string().optional(),
});
async function request(path: string, body?: unknown) {
  const response = await fetch("/api/collector/" + path, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await response.json()) as { message?: string; error?: string };
  if (!response.ok)
    throw new Error(data.message || data.error || "수집 서비스 요청 실패");
  return jobSchema.parse(data);
}
export async function collectRankings(progress: (message: string) => void) {
  progress("Chrome을 실행해 전체 랭킹을 수집하고 있습니다…");
  let job = await request("jobs", {});
  const started = Date.now();
  while (job.status === "RUNNING") {
    if (Date.now() - started > 120000)
      throw new Error(
        "수집 대기 시간이 초과됐습니다. 기존 데이터는 유지됩니다. 잠시 후 다시 시도하세요.",
      );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    job = await request("jobs/" + job.id);
    progress(
      `전체 랭킹 수집 중… ${Math.floor((Date.now() - started) / 1000)}초`,
    );
  }
  if (job.status === "FAILED")
    throw new Error(
      job.message || "랭킹 수집에 실패했습니다. 기존 데이터는 유지됩니다.",
    );
  return parseBrowserCapture(job.capture);
}
