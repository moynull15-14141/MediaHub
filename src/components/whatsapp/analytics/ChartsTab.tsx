import { AnalyticsFiltersBar, AnalyticsFilters } from './AnalyticsFiltersBar';
import { TrendChartCard } from './TrendChartCard';

const CHARTS: { title: string; metric: string; color: string }[] = [
  { title: 'Campaign trend', metric: 'campaignTrend', color: '#3b82f6' },
  { title: 'Delivery trend', metric: 'deliveryTrend', color: '#10b981' },
  { title: 'Read trend', metric: 'readTrend', color: '#06b6d4' },
  { title: 'Failure trend', metric: 'failureTrend', color: '#ef4444' },
  { title: 'Queue trend', metric: 'queueTrend', color: '#f59e0b' },
  { title: 'Template usage', metric: 'templateUsage', color: '#8b5cf6' },
  { title: 'Contact growth', metric: 'contactGrowth', color: '#ec4899' },
];

export function ChartsTab({ filters, onFiltersChange }: { filters: AnalyticsFilters; onFiltersChange: (f: AnalyticsFilters) => void }) {
  return (
    <div className="space-y-6">
      <AnalyticsFiltersBar filters={filters} onChange={onFiltersChange} showCampaign showTemplate showGroupLabel />
      <div className="grid gap-4 lg:grid-cols-2">
        {CHARTS.map((c) => (
          <div key={c.metric}>
            <TrendChartCard title={c.title} metric={c.metric} filters={filters} color={c.color} />
          </div>
        ))}
      </div>
    </div>
  );
}
