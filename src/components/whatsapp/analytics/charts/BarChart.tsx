export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  emptyLabel?: string;
  defaultColor?: string;
}

// Hand-rolled horizontal bar chart, used for Status Breakdown / Template
// Usage - simple percentage-width bars, no SVG needed, fully CSS-var themed.
export function BarChart({ data, height, emptyLabel = 'No data yet', defaultColor = '#3b82f6' }: BarChartProps) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-sm text-[var(--text-muted)]">{emptyLabel}</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-3" style={height ? { maxHeight: height, overflowY: 'auto' } : undefined}>
      {data.map((d) => (
        <div key={d.label} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--text-primary)]">{d.label}</span>
            <span className="text-[var(--text-secondary)]">{d.value}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--panel-bg)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: d.color || defaultColor }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
