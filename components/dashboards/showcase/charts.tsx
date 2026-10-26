"use client";

import { useEffect, useId, useRef, useState } from "react";

// Мини-графики витрины. Цвета — только из токенов темы (--chart-*, --ok/--bad),
// поэтому работают и в светлой, и в тёмной теме.

function useMeasure(): [React.RefObject<HTMLDivElement>, { w: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(40, e.contentRect.width));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, { w }];
}

export function Sparkline({
  data,
  color = "hsl(var(--chart-1))",
  height = 42,
  fill = true,
  strokeWidth = 1.75,
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const [ref, { w }] = useMeasure();
  const uid = useId().replace(/:/g, "");
  // Нужно ≥2 точки: иначе min/max по пустому → ±Infinity, а i/(len-1) → NaN.
  if (data.length < 2) return <div ref={ref} style={{ width: "100%", height }} />;
  const min = Math.min(...data),
    max = Math.max(...data);
  const rng = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * (w - 2) + 1;
  const y = (v: number) => height - 3 - ((v - min) / rng) * (height - 6);
  const path = data
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={w} height={height} style={{ display: "block" }}>
        <defs>
          <linearGradient id={`s${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {fill && <path d={`${path} L${x(data.length - 1)} ${height} L${x(0)} ${height} Z`} fill={`url(#s${uid})`} />}
        <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
