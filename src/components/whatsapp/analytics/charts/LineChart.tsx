import { useId, useState } from 'react';

export interface LineSeries {
  name: string;
  color: string;
  points: { label: string; value: number }[];
}

interface LineChartProps {
  series: LineSeries[];
  height?: number;
  emptyLabel?: string;
}

// Hand-rolled SVG line chart - zero new dependency, themed entirely through
// the colors the caller passes (which come from CSS custom properties at the
// call site), so dark/light mode "just work" without a chart-library theme
// config to keep in sync.
export function LineChart({ series, height = 220, emptyLabel = 'No data for this range' }: LineChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<{ x: number; label: string; values: { name: string; value: number; color: string }[] } | null>(null);

  // Series may cover different bucket sets (e.g. "Sent" and "Delivered"
  // timelines don't necessarily have data in the same hours), so the x-axis
  // is the union of every series' labels, sorted, with each series looked up
  // by label (defaulting to 0) rather than assumed to align by array index.
  const labels = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.label)))).sort();
  const valueFor = (s: LineSeries, label: string) => s.points.find((p) => p.label === label)?.value ?? 0;
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const maxValue = Math.max(1, ...allValues);

  if (labels.length === 0) {
    return <div className="flex items-center justify-center rounded-2xl border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)]" style={{ height }}>{emptyLabel}</div>;
  }

  const width = 600;
  const padding = 28;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const xFor = (i: number) => padding + stepX * i;
  const yFor = (v: number) => padding + innerH - (v / maxValue) * innerH;

  const pathFor = (s: LineSeries) => labels.map((label, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(valueFor(s, label))}`).join(' ');

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padding} x2={width - padding} y1={padding + innerH * (1 - f)} y2={padding + innerH * (1 - f)} stroke="var(--border)" strokeWidth={1} />
        ))}
        {series.map((s) => (
          <g key={s.name} className="text-current" style={{ color: s.color }}>
            <path d={`${pathFor(s)} L ${xFor(labels.length - 1)} ${padding + innerH} L ${xFor(0)} ${padding + innerH} Z`} fill={`url(#${gradientId})`} stroke="none" />
            <path d={pathFor(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
        {labels.map((label, i) => (
          <rect
            key={label + i}
            x={xFor(i) - stepX / 2}
            y={0}
            width={stepX || innerW}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHover({ x: xFor(i), label, values: series.map((s) => ({ name: s.name, value: valueFor(s, label), color: s.color })) })}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {hover && <line x1={hover.x} x2={hover.x} y1={padding} y2={padding + innerH} stroke="var(--border)" strokeWidth={1} strokeDasharray="4 4" />}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute top-2 -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-[var(--shadow-card)]"
          style={{ left: `${(hover.x / width) * 100}%` }}
        >
          <p className="mb-1 font-medium text-[var(--text-primary)]">{hover.label}</p>
          {hover.values.map((v) => (
            <p key={v.name} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v.color }} /> {v.name}: {v.value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
