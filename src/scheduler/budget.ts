export const MONTHLY_BROWSER_LIMIT_MS = 45 * 60 * 60 * 1000;
export const RUN_BROWSER_LIMIT_MS = 90 * 60 * 1000;
export const STEP_RESERVATION_MS = 120_000;

export function billingPeriod(date = new Date(), anchorDay = 8) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - (date.getUTCDate() < anchorDay ? 1 : 0);
  return new Date(Date.UTC(year, month, anchorDay)).toISOString().slice(0, 10);
}

export function browserCost(milliseconds: number) {
  return Math.max(0, Math.round(milliseconds / 3_600_000) - 10) * 0.09;
}

export function canReserve(
  monthMs: number,
  runMs: number,
  limit = RUN_BROWSER_LIMIT_MS,
) {
  return (
    monthMs + STEP_RESERVATION_MS <= MONTHLY_BROWSER_LIMIT_MS &&
    runMs + STEP_RESERVATION_MS <= limit
  );
}

export function chunksByBytes<T>(
  rows: T[],
  maxBytes = 48 * 1024,
  maxRows = 20,
): T[][] {
  const chunks: T[][] = [];
  let chunk: T[] = [];
  for (const row of rows) {
    const candidate = [...chunk, row];
    const bytes = new TextEncoder().encode(
      JSON.stringify({ rows: candidate }),
    ).byteLength;
    if (bytes > maxBytes && !chunk.length) throw Error("ROW_TOO_LARGE");
    if (candidate.length > maxRows || bytes > maxBytes) {
      chunks.push(chunk);
      chunk = [row];
      if (
        new TextEncoder().encode(JSON.stringify({ rows: chunk })).byteLength >
        maxBytes
      )
        throw Error("ROW_TOO_LARGE");
    } else chunk = candidate;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
