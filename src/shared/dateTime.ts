const formatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function formatCollectedAt(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return formatter.format(new Date(value));
}
