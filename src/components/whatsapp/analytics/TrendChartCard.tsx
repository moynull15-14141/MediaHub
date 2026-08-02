import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Select } from '@/src/components/ui/select';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { LineChart } from './charts/LineChart';
import { AnalyticsFilters, filtersToQuery } from './AnalyticsFiltersBar';

type Granularity = 'daily' | 'weekly' | 'monthly';
interface ChartPoint { period: string; value: number }

interface TrendChartCardProps {
  title: string;
  metric: string;
  filters: AnalyticsFilters;
  color?: string;
}

// One reusable card for every "trend" chart Phase 6 asks for (Campaign,
// Delivery, Read, Failure, Queue, Template Usage, Contact Growth) - only the
// `metric` and label change, the fetch/granularity/render logic is shared.
export function TrendChartCard({ title, metric, filters, color = '#3b82f6' }: TrendChartCardProps) {
  const { token } = useAuth();
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [data, setData] = useState<ChartPoint[] | undefined>(undefined);

  useEffect(() => {
    const query = filtersToQuery(filters);
    whatsappFetch<ChartPoint[]>(token, `/analytics/chart?metric=${metric}&granularity=${granularity}${query ? `&${query}` : ''}`)
      .then(setData)
      .catch(() => setData([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, granularity, JSON.stringify(filters)]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)} className="w-28 py-1 text-xs">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {data === undefined ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <LineChart series={[{ name: title, color, points: data.map((d) => ({ label: d.period, value: d.value })) }]} />
        )}
      </CardContent>
    </Card>
  );
}
