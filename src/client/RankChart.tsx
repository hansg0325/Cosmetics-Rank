import { useId, useRef, useState } from "react";
import type { HistoryPoint } from "../shared/analytics";
export type RankSeries = {
  id: string;
  name: string;
  brand: string;
  points: HistoryPoint[];
};
export const chartColors = [
  "#2875af",
  "#d36b8e",
  "#52a36c",
  "#e49a32",
  "#9362ac",
  "#39a3a5",
  "#b55f46",
  "#6d83c3",
  "#ba9b32",
  "#599a85",
  "#bc71b5",
  "#74786e",
  "#9f6c36",
  "#5254a3",
  "#d85b65",
  "#7eaa35",
  "#38a6c5",
  "#a3497b",
  "#5f908e",
  "#8c7a6b",
  "#176d49",
  "#b44793",
  "#425e99",
  "#be7225",
  "#7b9143",
  "#6850bc",
  "#b34d51",
  "#257e91",
  "#99663e",
  "#706d30",
];
export function rankY(rank: number, max: number) {
  return 32 + ((rank - 1) / Math.max(1, max - 1)) * 304;
}
export function rankPath(points: HistoryPoint[], max: number) {
  let connected = false;
  return points
    .map((p, i) => {
      if (p.rank === null) {
        connected = false;
        return "";
      }
      const x =
        56 + (points.length === 1 ? 354 : (i / (points.length - 1)) * 708);
      const op = connected ? "L" : "M";
      connected = true;
      return `${op}${x.toFixed(2)},${rankY(p.rank, max).toFixed(2)}`;
    })
    .join(" ");
}
export function RankChart({
  series,
  title = "순위 변동",
}: {
  series: RankSeries[];
  title?: string;
}) {
  const [hover, setHover] = useState<string | null>(null),
    [pin, setPin] = useState<string | null>(null),
    [index, setIndex] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const requested = hover || pin;
  const active = series.some((s) => s.id === requested) ? requested : null;
  const current = series.find((s) => s.id === active);
  const dates = series[0]?.points || [];
  const bestMax = Math.max(
    30,
    ...series.flatMap((s) => s.points.map((p) => p.rank || 0)),
  );
  const max = Math.min(100, Math.ceil(bestMax / 10) * 10);
  const point = current?.points[index ?? Math.max(0, dates.length - 1)];
  const pointer = (clientX: number) => {
    if (!svg.current) return;
    const rect = svg.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 800;
    setIndex(
      Math.min(
        Math.max(
          0,
          Math.round(((x - 56) / 708) * Math.max(0, dates.length - 1)),
        ),
        Math.max(0, dates.length - 1),
      ),
    );
  };
  const hasPoints = series.some((s) => s.points.some((p) => p.rank !== null));
  const ticks = Array.from(
    new Set([
      1,
      ...Array.from({ length: 5 }, (_, i) =>
        Math.round(1 + ((max - 1) * (i + 1)) / 5),
      ),
    ]),
  );
  return (
    <section className="rank-chart" aria-labelledby={titleId}>
      <div className="card-title">
        <h2 id={titleId}>{title}</h2>
      </div>
      {!hasPoints && (
        <p className="empty">선택 기간에 표시할 순위 기록이 없습니다.</p>
      )}
      <div className="chart-layout">
        <div className="chart-plot">
          <svg
            ref={svg}
            viewBox="0 0 800 375"
            role="img"
            aria-label={`${title}: 1위가 위쪽, ${max}위가 아래쪽. ${series.length}개 상품 비교`}
            onPointerMove={(e) => pointer(e.clientX)}
            onPointerLeave={() => {
              setHover(null);
              setIndex(null);
            }}
          >
            <text x="12" y="18" className="axis-label">
              순위
            </text>
            {ticks.map((rank) => (
              <g key={rank}>
                <line
                  x1="56"
                  x2="764"
                  y1={rankY(rank, max)}
                  y2={rankY(rank, max)}
                  stroke="#e8ede4"
                />
                <text
                  x="43"
                  y={rankY(rank, max) + 4}
                  textAnchor="end"
                  className="axis-label"
                >
                  {rank}
                </text>
              </g>
            ))}
            {dates.map((p, i) =>
              i === 0 ||
              i === dates.length - 1 ||
              i % Math.max(1, Math.ceil(dates.length / 5)) === 0 ? (
                <text
                  key={p.date}
                  x={
                    56 +
                    (dates.length === 1 ? 354 : (i / (dates.length - 1)) * 708)
                  }
                  y="363"
                  textAnchor="middle"
                  className="axis-label"
                >
                  {p.date.slice(5)}
                </text>
              ) : null,
            )}
            {series.map((s, n) => (
              <g
                key={s.id}
                data-series={s.id}
                data-active={active === s.id ? "true" : "false"}
                opacity={active && active !== s.id ? 0.14 : 1}
                style={{ transition: "opacity 120ms ease" }}
                onPointerEnter={() => setHover(s.id)}
              >
                <path
                  d={rankPath(s.points, max)}
                  fill="none"
                  stroke={chartColors[n % chartColors.length]}
                  strokeWidth={active === s.id ? 3.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                <path
                  data-line-hit={s.id}
                  aria-hidden="true"
                  d={rankPath(s.points, max)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="16"
                  onPointerMove={(e) => {
                    setHover(s.id);
                    pointer(e.clientX);
                  }}
                />
                {s.points.map((p, i) =>
                  p.rank === null ? null : (
                    <circle
                      data-point={`${s.id}:${p.date}`}
                      key={p.date}
                      cx={
                        56 +
                        (s.points.length === 1
                          ? 354
                          : (i / (s.points.length - 1)) * 708)
                      }
                      cy={rankY(p.rank, max)}
                      r={active === s.id ? 4.5 : 3}
                      fill={chartColors[n % chartColors.length]}
                      stroke="white"
                      strokeWidth="1.3"
                      onPointerEnter={() => {
                        setHover(s.id);
                        setIndex(i);
                      }}
                    />
                  ),
                )}
              </g>
            ))}
            {current && point?.rank != null && (
              <g pointerEvents="none">
                <circle
                  cx={
                    56 +
                    (dates.length === 1
                      ? 354
                      : ((index ?? dates.length - 1) / (dates.length - 1)) *
                        708)
                  }
                  cy={rankY(point.rank, max)}
                  r="6"
                  fill="white"
                  stroke={
                    chartColors[series.indexOf(current) % chartColors.length]
                  }
                  strokeWidth="2.5"
                  pointerEvents="none"
                />
              </g>
            )}
          </svg>
          <div className="chart-readout" aria-live="polite">
            {current && point ? (
              <>
                <b>
                  {current.brand} · {current.name}
                </b>
                <span>
                  {point.date} ·{" "}
                  {point.state === "MISSING"
                    ? "미수집 (결측)"
                    : point.state === "OUTSIDE_TOP100"
                      ? "100위권 밖"
                      : `${point.rank}위`}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="chart-legend" aria-label="비교 상품 범례">
          {series.map((s, n) => (
            <button
              key={s.id}
              type="button"
              className={active === s.id ? "legend-active" : ""}
              aria-pressed={pin === s.id}
              onPointerEnter={() => setHover(s.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(s.id)}
              onBlur={() => setHover(null)}
              onClick={() => {
                setPin(pin === s.id ? null : s.id);
                setIndex(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setIndex((i) =>
                    Math.max(
                      0,
                      Math.min(
                        dates.length - 1,
                        (i ?? dates.length - 1) +
                          (e.key === "ArrowLeft" ? -1 : 1),
                      ),
                    ),
                  );
                }
              }}
              title={`${s.brand} ${s.name}`}
            >
              <span
                className="legend-dot"
                style={{ background: chartColors[n % chartColors.length] }}
              />
              <span>
                {s.brand}
                <small>{s.name}</small>
              </span>
              {pin === s.id && <span aria-label="고정됨">●</span>}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
