export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  size?: number;
  emptyLabel?: string;
}

// Hand-rolled SVG donut (stroke-dasharray trick on a circle) for status
// breakdowns - no charting library, ~30 lines, themeable via passed colors.
export function DonutChart({ data, size = 180, emptyLabel = 'No data yet' }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = size / 2 - 14;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3" style={{ height: size }}>
        <div className="rounded-full border-8 border-[var(--panel-bg)]" style={{ width: size - 28, height: size - 28 }} />
        <p className="text-xs text-[var(--text-muted)]">{emptyLabel}</p>
      </div>
    );
  }

  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--panel-bg)" strokeWidth={14} />
          {data
            .filter((d) => d.value > 0)
            .map((d) => {
              const length = (d.value / total) * circumference;
              const dasharray = `${length} ${circumference - length}`;
              const dashoffset = -offset;
              offset += length;
              return (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={14}
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset}
                  strokeLinecap="butt"
                />
              );
            })}
        </g>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-[var(--text-primary)]" style={{ fontSize: 20, fontWeight: 600 }}>
          {total}
        </text>
      </svg>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-[var(--text-primary)]">{d.label}</span>
            <span className="text-[var(--text-secondary)]">({d.value})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
